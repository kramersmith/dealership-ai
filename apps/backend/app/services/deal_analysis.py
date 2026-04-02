from __future__ import annotations

import json
import logging

import anthropic

from app.core.config import settings
from app.models.enums import (
    GapPriority,
    HealthStatus,
    RedFlagSeverity,
    ScoreStatus,
)
from app.services.panel import _build_conversation_context

logger = logging.getLogger(__name__)

# Standalone analyst tool used by the deals PATCH endpoint for re-assessment.
# This is a combined tool (unlike the individual CHAT_TOOLS) because analyze_deal
# runs as a single non-streaming call and needs all assessment fields at once.
_STANDALONE_ANALYST_TOOL = {
    "name": "analyze_deal",
    "description": "Assess the deal quality, identify risks, and surface information gaps.",
    "input_schema": {
        "type": "object",
        "properties": {
            "health": {
                "type": "object",
                "properties": {
                    "deal_id": {"type": "string"},
                    "status": {
                        "type": "string",
                        "enum": [h.value for h in HealthStatus],
                    },
                    "summary": {"type": "string"},
                    "recommendation": {"type": "string"},
                },
                "required": ["status", "summary", "recommendation"],
            },
            "scorecard": {
                "type": "object",
                "properties": {
                    "deal_id": {"type": "string"},
                    "score_price": {
                        "type": "string",
                        "enum": [s.value for s in ScoreStatus],
                    },
                    "score_financing": {
                        "type": "string",
                        "enum": [s.value for s in ScoreStatus],
                    },
                    "score_trade_in": {
                        "type": "string",
                        "enum": [s.value for s in ScoreStatus],
                    },
                    "score_fees": {
                        "type": "string",
                        "enum": [s.value for s in ScoreStatus],
                    },
                    "score_overall": {
                        "type": "string",
                        "enum": [s.value for s in ScoreStatus],
                    },
                },
            },
            "deal_red_flags": {
                "type": "object",
                "properties": {
                    "deal_id": {"type": "string"},
                    "flags": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "severity": {
                                    "type": "string",
                                    "enum": [s.value for s in RedFlagSeverity],
                                },
                                "message": {"type": "string"},
                            },
                            "required": ["id", "severity", "message"],
                        },
                    },
                },
            },
            "session_red_flags": {
                "type": "object",
                "properties": {
                    "flags": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "severity": {
                                    "type": "string",
                                    "enum": [s.value for s in RedFlagSeverity],
                                },
                                "message": {"type": "string"},
                            },
                            "required": ["id", "severity", "message"],
                        },
                    },
                },
            },
            "deal_information_gaps": {
                "type": "object",
                "properties": {
                    "deal_id": {"type": "string"},
                    "gaps": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string"},
                                "reason": {"type": "string"},
                                "priority": {
                                    "type": "string",
                                    "enum": [p.value for p in GapPriority],
                                },
                            },
                            "required": ["label", "reason", "priority"],
                        },
                    },
                },
            },
            "session_information_gaps": {
                "type": "object",
                "properties": {
                    "gaps": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string"},
                                "reason": {"type": "string"},
                                "priority": {
                                    "type": "string",
                                    "enum": [p.value for p in GapPriority],
                                },
                            },
                            "required": ["label", "reason", "priority"],
                        },
                    },
                },
            },
            "comparison": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string"},
                    "recommendation": {"type": "string"},
                    "best_deal_id": {"type": "string"},
                    "highlights": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string"},
                                "values": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "deal_id": {"type": "string"},
                                            "value": {"type": "string"},
                                            "is_winner": {"type": "boolean"},
                                        },
                                        "required": ["deal_id", "value", "is_winner"],
                                    },
                                },
                                "note": {"type": "string"},
                            },
                            "required": ["label", "values"],
                        },
                    },
                },
            },
        },
    },
}


async def analyze_deal(
    deal_state_dict: dict,
    messages: list[dict],
    assistant_text: str,
) -> dict:
    """Standalone deal analysis for re-assessment (e.g., after inline corrections).

    Used by the deals PATCH endpoint. Uses Sonnet with cached tool definition.
    """
    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    state_json = json.dumps(deal_state_dict, indent=2, default=str)
    conversation_context = _build_conversation_context(messages, assistant_text)

    try:
        response = await client.messages.create(  # type: ignore[call-overload]
            model=settings.CLAUDE_MODEL,
            max_tokens=1536,
            tools=[
                {**_STANDALONE_ANALYST_TOOL, "cache_control": {"type": "ephemeral"}},
            ],
            tool_choice={"type": "auto"},
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Current deal state:\n```json\n{state_json}\n```\n\n"
                        f"Conversation:\n{conversation_context}\n\n"
                        "Assess the deal quality, identify risks, and surface information gaps. "
                        "Health summary must reference the buyer's actual data. "
                        "Recommendation must be specific. Missing info is NEVER a red flag."
                    ),
                }
            ],
        )

        # Log cache usage
        usage = response.usage
        logger.info(
            "Cache [analyze_deal]: creation=%d read=%d uncached=%d",
            getattr(usage, "cache_creation_input_tokens", 0) or 0,
            getattr(usage, "cache_read_input_tokens", 0) or 0,
            usage.input_tokens,
        )

        for block in response.content:
            if block.type == "tool_use" and block.name == "analyze_deal":
                result = block.input
                logger.debug(
                    "Analyst returned keys: %s",
                    list(result.keys()) if result else "(empty)",
                )
                return result if isinstance(result, dict) else {}

        logger.debug("Analyst did not call tool — no assessment changes")
        return {}

    except Exception:
        logger.exception("Deal analysis failed")
        return {}
