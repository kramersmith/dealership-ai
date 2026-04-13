from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.deal_state import DealState
from app.models.enums import (
    InsightsFollowupKind,
    InsightsFollowupStatus,
    InsightsFollowupStepStatus,
    MessageRole,
)
from app.models.insights_followup_job import InsightsFollowupJob
from app.models.message import Message
from app.models.session import ChatSession
from app.services.claude import (
    ChatLoopResult,
    build_context_message,
    build_messages,
    build_system_prompt,
    empty_usage_summary,
    get_buyer_chat_tools,
    merge_usage_summary,
    stream_chat_loop,
)
from app.services.deal_state import deal_state_to_dict
from app.services.panel import stream_ai_panel_cards_with_usage
from app.services.turn_context import TurnContext
from app.services.usage_tracking import (
    SessionUsageSummary,
    build_request_usage,
    message_usage_payload,
)

logger = logging.getLogger(__name__)

_FOLLOWUP_RECONCILE_TRIGGER = (
    "Detached follow-up reconcile task: review the full conversation above and "
    "bring structured deal state up to date. Use tools only for material changes. "
    "Do not produce user-facing reply text. If nothing should change, return no text and no tools."
)

_FOLLOWUP_RECONCILE_SYSTEM = [
    {
        "type": "text",
        "text": (
            "DETACHED FOLLOW-UP RECONCILE: You are reconciling structured state after the assistant reply has already been delivered. "
            "Do not write any user-visible prose. Use the conversation transcript and current structured state to decide whether tools are needed. "
            "Call tools only for real state changes; otherwise return no text and no tools."
        ),
    }
]


@dataclass(frozen=True)
class LinkedInsightsFollowupResult:
    cards: list[dict]
    assistant_message_id: str
    usage: dict[str, int] | None = None


def _history_up_to_assistant(
    history_rows: Sequence[Message], assistant_message_id: str
) -> list[Message]:
    anchored_rows: list[Message] = []
    for row in history_rows:
        anchored_rows.append(row)
        if row.id == assistant_message_id:
            break
    return anchored_rows


def _merge_message_usage(
    existing: dict[str, int] | None,
    additional_usage_summary: dict[str, int],
) -> dict[str, int]:
    current = existing or {}
    return {
        "requests": current.get("requests", 0)
        + additional_usage_summary.get("requests", 0),
        "inputTokens": current.get("inputTokens", 0)
        + additional_usage_summary.get("input_tokens", 0),
        "outputTokens": current.get("outputTokens", 0)
        + additional_usage_summary.get("output_tokens", 0),
        "cacheCreationInputTokens": current.get("cacheCreationInputTokens", 0)
        + additional_usage_summary.get("cache_creation_input_tokens", 0),
        "cacheReadInputTokens": current.get("cacheReadInputTokens", 0)
        + additional_usage_summary.get("cache_read_input_tokens", 0),
        "totalTokens": current.get("totalTokens", 0)
        + additional_usage_summary.get("total_tokens", 0),
    }


def _replace_insights_panel_tool_call(
    existing_tool_calls: list[dict] | None,
    cards: list[dict],
) -> list[dict]:
    tool_calls = [
        tool_call
        for tool_call in list(existing_tool_calls or [])
        if tool_call.get("name") != "update_insights_panel"
    ]
    tool_calls.append(
        {
            "name": "update_insights_panel",
            "args": {"cards": cards},
        }
    )
    return tool_calls


def _parse_sse_chunk(chunk: str) -> tuple[str, dict]:
    event_name = "message"
    data: dict = {}
    for line in chunk.strip().splitlines():
        if line.startswith("event: "):
            event_name = line.removeprefix("event: ")
        elif line.startswith("data: "):
            data = json.loads(line.removeprefix("data: "))
    return event_name, data


def _panel_error_sse(message: str = "Insights follow-up failed") -> str:
    return f"event: panel_error\ndata: {json.dumps({'message': message})}\n\n"


async def _get_or_create_followup_job(
    *,
    db: AsyncSession,
    session_id: str,
    assistant_message_id: str,
    kind: InsightsFollowupKind,
) -> InsightsFollowupJob:
    existing = await db.scalar(
        select(InsightsFollowupJob).where(
            InsightsFollowupJob.session_id == session_id,
            InsightsFollowupJob.assistant_message_id == assistant_message_id,
            InsightsFollowupJob.kind == kind.value,
        )
    )
    if existing is not None:
        return existing

    job = InsightsFollowupJob(
        session_id=session_id,
        assistant_message_id=assistant_message_id,
        kind=kind.value,
    )
    db.add(job)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = await db.scalar(
            select(InsightsFollowupJob).where(
                InsightsFollowupJob.session_id == session_id,
                InsightsFollowupJob.assistant_message_id == assistant_message_id,
                InsightsFollowupJob.kind == kind.value,
            )
        )
        if existing is not None:
            return existing
        raise
    await db.refresh(job)
    return job


async def _load_assistant_message(
    *,
    db: AsyncSession,
    session_id: str,
    assistant_message_id: str,
) -> Message:
    assistant_message = await db.scalar(
        select(Message).where(
            Message.id == assistant_message_id,
            Message.session_id == session_id,
            Message.role == MessageRole.ASSISTANT.value,
        )
    )
    if assistant_message is None:
        raise ValueError("Assistant message not found for this session")
    return assistant_message


def _build_followup_reconcile_messages(
    *,
    deal_state_dict: dict,
    anchored_history_rows: list[Message],
) -> list[dict]:
    history = [
        {"role": row.role, "content": row.content}
        for row in anchored_history_rows
        if row.role in (MessageRole.USER, MessageRole.ASSISTANT)
    ]
    context_message = build_context_message(
        deal_state_dict,
        user_turn_text=_FOLLOWUP_RECONCILE_TRIGGER,
    )
    return build_messages(
        history,
        _FOLLOWUP_RECONCILE_TRIGGER,
        None,
        context_message,
    )


async def stream_linked_insights_followup(
    *,
    db: AsyncSession,
    session: ChatSession,
    session_id: str,
    assistant_message_id: str,
    force_rerun: bool = False,
    followup_enabled: bool = True,
) -> AsyncIterator[str]:
    # Preamble: load the persisted assistant anchor and the durable job row.
    try:
        assistant_message = await _load_assistant_message(
            db=db,
            session_id=session_id,
            assistant_message_id=assistant_message_id,
        )
        if not followup_enabled:
            yield _panel_error_sse(
                "Insights follow-up is unavailable while live updates are paused."
            )
            return
        job = await _get_or_create_followup_job(
            db=db,
            session_id=session_id,
            assistant_message_id=assistant_message_id,
            kind=InsightsFollowupKind.LINKED_RECONCILE_PANEL,
        )
    except Exception:
        logger.exception(
            "Failed to initialize linked insights follow-up: session_id=%s assistant_message_id=%s",
            session_id,
            assistant_message_id,
        )
        yield _panel_error_sse()
        return

    if job.status == InsightsFollowupStatus.SUCCEEDED.value and not force_rerun:
        yield (
            "event: panel_done\n"
            f"data: {json.dumps({'cards': assistant_message.panel_cards or [], 'usage': job.usage or {}, 'assistant_message_id': assistant_message.id})}\n\n"
        )
        return

    if job.status == InsightsFollowupStatus.RUNNING.value:
        yield _panel_error_sse("Insights follow-up is already running.")
        return

    # Preamble: load history and mark job as running.
    try:
        history_rows = (
            (
                await db.execute(
                    select(Message)
                    .where(Message.session_id == session_id)
                    .order_by(Message.created_at, Message.id)
                )
            )
            .scalars()
            .all()
        )
        anchored_history_rows = _history_up_to_assistant(
            history_rows, assistant_message.id
        )

        job.status = InsightsFollowupStatus.RUNNING.value
        job.reconcile_status = InsightsFollowupStepStatus.RUNNING.value
        job.panel_status = InsightsFollowupStepStatus.PENDING.value
        job.attempts += 1
        job.error = None
        job.cancel_reason = None
        job.started_at = datetime.now(timezone.utc)
        job.finished_at = None
        await db.commit()
    except Exception:
        logger.exception(
            "Failed to prepare follow-up job: session_id=%s assistant_message_id=%s",
            session_id,
            assistant_message_id,
        )
        yield _panel_error_sse()
        return

    logger.info(
        "Insights follow-up started: session_id=%s, assistant_message_id=%s, attempt=%d",
        session_id,
        assistant_message_id,
        job.attempts,
    )

    try:
        panel_started_emitted = False
        total_followup_usage_summary = empty_usage_summary()
        followup_request_usage_summary = empty_usage_summary()
        panel_started_emitted = True
        yield "event: panel_started\ndata: {}\n\n"

        deal_state = await db.scalar(
            select(DealState).where(DealState.session_id == session_id)
        )
        if deal_state is None:
            raise RuntimeError("Deal state not found")

        model_history = [
            {"role": row.role, "content": row.content}
            for row in anchored_history_rows
            if row.role in (MessageRole.USER, MessageRole.ASSISTANT)
        ]
        deal_state_dict = await deal_state_to_dict(deal_state, db)
        reconcile_messages = _build_followup_reconcile_messages(
            deal_state_dict=deal_state_dict,
            anchored_history_rows=anchored_history_rows,
        )
        reconcile_result = ChatLoopResult()
        session_usage = SessionUsageSummary.from_dict(session.usage)
        turn_context = TurnContext.create(session=session, deal_state=deal_state, db=db)

        async for reconcile_event in stream_chat_loop(
            [*build_system_prompt(), *_FOLLOWUP_RECONCILE_SYSTEM],
            reconcile_messages,
            get_buyer_chat_tools(
                allow_persistence_affecting_tools=True,
                allow_chat_only_tools=False,
            ),
            turn_context,
            reconcile_result,
            emit_done_event=False,
            linked_messages=None,
            prompt_cache_prior_chat=session_usage.prompt_cache_chat_last,
        ):
            event_name, data = _parse_sse_chunk(reconcile_event)
            if event_name == "tool_result":
                yield reconcile_event
            elif event_name == "error":
                message = data.get("message") or "Insights reconcile failed"
                raise RuntimeError(str(message))

        if reconcile_result.failed or reconcile_result.interrupted:
            raise RuntimeError("Insights reconcile failed")

        logger.info(
            "Insights reconcile step succeeded: session_id=%s, tool_calls=%d",
            session_id,
            len(reconcile_result.tool_calls),
        )

        merge_usage_summary(
            followup_request_usage_summary, reconcile_result.usage_summary
        )
        merge_usage_summary(
            total_followup_usage_summary, reconcile_result.usage_summary
        )
        job.reconcile_status = InsightsFollowupStepStatus.SUCCEEDED.value
        job.panel_status = InsightsFollowupStepStatus.RUNNING.value
        await db.commit()

        refreshed_deal_state = await db.scalar(
            select(DealState).where(DealState.session_id == session_id)
        )
        if refreshed_deal_state is None:
            raise RuntimeError("Deal state not found")
        deal_state = refreshed_deal_state
        updated_state_dict = await deal_state_to_dict(deal_state, db)
        panel_usage_summary: dict[str, int] | None = None
        latest_cards: list[dict] = assistant_message.panel_cards or []
        panel_done_emitted = False
        panel_prompt_cache: dict[str, object] = {
            "prior": session_usage.prompt_cache_panel_last,
            "breaks_delta": 0,
        }

        async for panel_event in stream_ai_panel_cards_with_usage(
            updated_state_dict,
            assistant_message.content,
            model_history,
            session_id=session_id,
            panel_prompt_cache=panel_prompt_cache,
        ):
            if panel_event.type == "panel_started":
                if not panel_started_emitted:
                    panel_started_emitted = True
                    yield (
                        f"event: panel_started\ndata: {json.dumps(panel_event.data)}\n\n"
                    )
            elif panel_event.type == "panel_done":
                panel_done_emitted = True
                latest_cards = panel_event.data.get("cards", latest_cards)
                panel_usage_summary = panel_event.data.get("usage_summary") or {}
            elif panel_event.type == "panel_error":
                message = panel_event.data.get("message") or "Insights follow-up failed"
                raise RuntimeError(str(message))

        if not panel_done_emitted:
            raise RuntimeError(
                "Insights follow-up ended without a terminal panel result"
            )

        merge_usage_summary(followup_request_usage_summary, panel_usage_summary or {})
        merge_usage_summary(total_followup_usage_summary, panel_usage_summary or {})

        deal_state.ai_panel_cards = latest_cards
        assistant_message.panel_cards = latest_cards
        assistant_message.usage = _merge_message_usage(
            assistant_message.usage,
            total_followup_usage_summary,
        )
        assistant_message.tool_calls = _replace_insights_panel_tool_call(
            assistant_message.tool_calls,
            latest_cards,
        )

        session_usage = SessionUsageSummary.from_dict(session.usage)
        if reconcile_result.prompt_cache_chat_last is not None:
            session_usage.prompt_cache_chat_last = (
                reconcile_result.prompt_cache_chat_last
            )
        session_usage.prompt_cache_break_count += reconcile_result.prompt_cache_breaks
        panel_prompt_cache_last = panel_prompt_cache.get("last")
        if isinstance(panel_prompt_cache_last, dict):
            session_usage.prompt_cache_panel_last = panel_prompt_cache_last
        session_usage.prompt_cache_break_count += int(
            panel_prompt_cache.get("breaks_delta", 0)
        )
        if followup_request_usage_summary.get("requests", 0) > 0:
            session_usage.add_request(
                build_request_usage(
                    model=settings.CLAUDE_MODEL,
                    usage_summary=followup_request_usage_summary,
                )
            )
        session.usage = session_usage.to_dict()
        session.updated_at = datetime.now(timezone.utc)

        job.status = InsightsFollowupStatus.SUCCEEDED.value
        job.panel_status = InsightsFollowupStepStatus.SUCCEEDED.value
        job.usage = message_usage_payload(total_followup_usage_summary)
        job.finished_at = datetime.now(timezone.utc)
        await db.commit()

        logger.info(
            "Insights follow-up succeeded: session_id=%s, assistant_message_id=%s, cards=%d",
            session_id,
            assistant_message_id,
            len(latest_cards),
        )

        payload = {
            "cards": latest_cards,
            "usage": message_usage_payload(total_followup_usage_summary),
            "assistant_message_id": assistant_message.id,
        }
        yield f"event: panel_done\ndata: {json.dumps(payload)}\n\n"
    except Exception:
        logger.exception(
            "Linked insights follow-up failed: session_id=%s assistant_message_id=%s",
            session_id,
            assistant_message_id,
        )
        job_id = job.id
        reconcile_was_running = (
            job.reconcile_status == InsightsFollowupStepStatus.RUNNING.value
        )
        panel_was_running = job.panel_status == InsightsFollowupStepStatus.RUNNING.value
        await db.rollback()
        refetched_job = await db.get(InsightsFollowupJob, job_id)
        if refetched_job is None:
            logger.error(
                "Insights follow-up job disappeared after rollback: job_id=%s session_id=%s",
                job_id,
                session_id,
            )
            yield _panel_error_sse()
            return
        refetched_job.status = InsightsFollowupStatus.FAILED.value
        if reconcile_was_running:
            refetched_job.reconcile_status = InsightsFollowupStepStatus.FAILED.value
        if panel_was_running:
            refetched_job.panel_status = InsightsFollowupStepStatus.FAILED.value
        refetched_job.error = "Insights follow-up failed"
        refetched_job.finished_at = datetime.now(timezone.utc)
        await db.commit()
        yield _panel_error_sse()


async def run_linked_insights_followup_to_completion(
    *,
    db: AsyncSession,
    session: ChatSession,
    session_id: str,
    assistant_message_id: str,
    force_rerun: bool = False,
    followup_enabled: bool = True,
) -> LinkedInsightsFollowupResult:
    async for chunk in stream_linked_insights_followup(
        db=db,
        session=session,
        session_id=session_id,
        assistant_message_id=assistant_message_id,
        force_rerun=force_rerun,
        followup_enabled=followup_enabled,
    ):
        event_name, data = _parse_sse_chunk(chunk)
        if event_name == "panel_done":
            return LinkedInsightsFollowupResult(
                cards=data.get("cards", []),
                assistant_message_id=data["assistant_message_id"],
                usage=data.get("usage"),
            )
        if event_name == "panel_error":
            raise RuntimeError(data.get("message") or "Insights follow-up failed")

    raise RuntimeError("Insights follow-up did not complete")
