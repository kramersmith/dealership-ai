# ADR-0005: Turn/Step Chat Loop Replacing Three-Stage Pipeline

**Status:** Accepted
**Date:** 2026-03
**Deciders:** Kramer Smith

## Context

The backend's Claude integration originally used a three-stage sequential pipeline for every user message:

1. **Chat stage** — Stream a text-only response from Claude (no tools). The model was instructed to respond conversationally but had no ability to modify deal state during this call.
2. **Extraction stage** — A separate, non-streaming Claude call (`process_post_chat()`) with a consolidated extraction tool. This call received the conversation history plus the assistant's text response and was asked to extract structured deal data (vehicle info, deal numbers, red flags, etc.) into a single monolithic tool schema. The results were merged into deal state via `merge_extraction_results()`.
3. **Panel generation stage** — A third Claude call to generate AI insight cards for the buyer's dashboard, using the updated deal state as context.

This architecture had several problems:

- **Latency:** Every user message required at least two sequential Claude API calls (chat + extraction) before the frontend could update deal state. The extraction call alone added 2-5 seconds of wall time per message.
- **Redundant processing:** The extraction call re-read the entire conversation to identify what changed, duplicating work the chat model had already done internally to formulate its response.
- **Monolithic extraction schema:** All deal state mutations were packed into a single tool with a deeply nested schema. Claude had to produce one large JSON blob covering vehicles, deals, numbers, health, red flags, information gaps, and more. This made partial failures hard to handle and encouraged the model to hallucinate fields it was uncertain about rather than omit them.
- **No multi-step reasoning:** The pipeline was strictly one-shot. If the model needed to create a vehicle before creating a deal referencing it, there was no mechanism for sequential tool calls within a single user turn. The extraction had to handle ordering internally.
- **Brittle error handling:** A failure in the extraction stage meant the entire deal state update was lost, even if the chat response had already been streamed to the user. There was no way to retry individual tool operations.

The panel generation stage was not part of the problem — it operates on finalized deal state and remains a separate post-loop call.

## Decision

Replace the three-stage pipeline with a **turn/step loop** where Claude has direct access to 17 individual operational tools during the main chat call. The architecture is implemented in `stream_chat_loop()` in `apps/backend/app/services/claude.py`.

### Terminology

- **Turn:** The full outer exchange — user sends a message, the system delivers a final assistant response. One turn per user message.
- **Step:** One inner cycle within a turn — call Claude, stream text and accumulate `tool_use` blocks, execute tools against deal state, feed `tool_result` messages back into the conversation, repeat. The loop iterates steps until Claude responds with text-only (no tool calls) or hits the step limit.

### Step loop mechanics

1. Call Claude with the system prompt, conversation history, and 17 tools (`CHAT_TOOLS`) using `tool_choice: auto`. Stream the response via `_stream_step_with_retry()`.
2. As the response streams, emit `text` SSE events for conversation chunks in real time. Simultaneously accumulate `tool_use` content blocks by tracking `content_block_start`, `input_json_delta`, and `content_block_stop` events to build complete tool call objects (id, name, parsed JSON input).
3. When the stream completes, check the `stop_reason`:
   - `end_turn` or no tool calls: the loop is done. Emit a `done` SSE event with the final text. Populate `ChatLoopResult` and return.
   - `tool_use`: tools were called. Proceed to execution.
   - `max_tokens`: the response was truncated. Retry with an escalated `max_tokens` budget (multiplicative factor, bounded by `CLAUDE_MAX_TOKENS_CAP`, up to `CLAUDE_MAX_TOKENS_RETRIES` attempts). Emit a `retry` SSE event so the frontend can reset its text buffer.
4. Execute accumulated tool calls using `build_execution_plan()` (from `deal_state.py`), which groups tools into priority-ordered batches:
   - Priority 0 (structural): `set_vehicle`, `remove_vehicle` — must complete before anything references the vehicle.
   - Priority 1 (context switches): `create_deal`, `switch_active_deal` — must complete before field updates target the right deal.
   - Priority 2 (default): all other tools — independent field updates that run concurrently via `asyncio.gather()` in `_execute_tool_batch()`.
   Each concurrent tool gets its own `AsyncSession` to avoid shared-session conflicts. On success, changes are committed immediately. On failure, only the failing tool rolls back; other tools' changes persist. Results are yielded in original call order regardless of completion order.
5. Append the assistant's content blocks (text + tool_use) as an assistant message and all `tool_result` blocks as a user message to the conversation history.
6. Increment the step counter. If below `CHAT_LOOP_MAX_STEPS` (5), go to step 1. Otherwise, emit a `done` event with whatever text has accumulated and log a warning.

After the loop completes, panel generation runs as a separate post-loop call (`generate_ai_panel_cards_with_usage()`) — unchanged from the previous architecture.

### Key constants and configuration

| Constant / Setting | Value | Purpose |
|---|---|---|
| `CHAT_LOOP_MAX_STEPS` | 5 | Maximum steps per turn before forced completion |
| `CLAUDE_MAX_TOKENS` | (env) | Initial `max_tokens` budget per step |
| `CLAUDE_MAX_TOKENS_RETRIES` | (env) | Max truncation retries per step |
| `CLAUDE_MAX_TOKENS_ESCALATION_FACTOR` | (env) | Multiplier for escalating `max_tokens` on truncation |
| `CLAUDE_MAX_TOKENS_CAP` | (env) | Upper bound on `max_tokens` escalation |
| `CLAUDE_STREAM_IDLE_TIMEOUT` | (env) | Idle timeout before stream retry |
| `CLAUDE_STREAM_MAX_RETRIES` | (env) | Max retries for stalled/failed streams |

### SSE event protocol

The step loop emits these SSE events to the frontend:

- `text` — Streamed conversation text chunks (emitted as they arrive from Claude).
- `tool_result` — Individual tool execution results with updated deal state fields. The frontend's `dealStore.applyToolCall()` processes these to update the UI in real time.
- `tool_error` — Tool execution failure (malformed JSON input or runtime error). Reported back to Claude as an error `tool_result` so the model can adjust.
- `step` — Notification that a new step is starting (emitted for steps > 0) so the frontend can show a thinking indicator.
- `retry` — Stream retry (idle timeout, connection error, or `max_tokens` truncation). Includes `reset_text: true` so the frontend clears partial text.
- `done` — Final text when the loop completes, plus per-turn `usage` and cumulative `sessionUsage`.
- `error` — Unrecoverable failure (exception during streaming). The loop terminates.

### ChatLoopResult

A mutable container (`ChatLoopResult`) is passed into `stream_chat_loop()` and populated as the loop runs. After iteration completes, the caller (the chat route) reads:

- `full_text` — Accumulated text across all steps (with paragraph breaks between multi-step text).
- `tool_calls` — All executed tool calls with their arguments.
- `completed` — Whether the loop finished normally.
- `failed` — Whether an unrecoverable error occurred.
- `usage_summary` — Aggregated token usage across all steps (input, output, cache creation, cache read, total tokens, request count).

### The 17 operational tools

Each tool maps 1:1 to a `deal_state.py` handler via `execute_tool()` and to the frontend's `dealStore.applyToolCall()` routing:

`set_vehicle`, `create_deal`, `update_deal_numbers`, `update_deal_phase`, `update_scorecard`, `update_deal_health`, `update_deal_red_flags`, `update_session_red_flags`, `update_deal_information_gaps`, `update_session_information_gaps`, `update_deal_comparison`, `update_negotiation_context`, `update_checklist`, `update_buyer_context`, `switch_active_deal`, `remove_vehicle`, `update_quick_actions`

## Alternatives Considered

### Option A: Three-stage sequential pipeline (previous architecture)

The original design: text-only chat streaming, then a separate extraction call with a monolithic tool schema, then panel generation.

- Pros: Simple mental model — each stage has one job. The chat call has no tools, so there is no risk of the model calling tools incorrectly during conversation. Extraction is isolated and can be tested independently.
- Cons: Adds a full API call per message (2-5 seconds of latency). The extraction call duplicates reasoning the chat model already performed. A single monolithic extraction schema is fragile — partial failures lose everything, and the model tends to hallucinate uncertain fields rather than omit them. No support for multi-step tool chains (e.g., create vehicle then create deal referencing it). The `merge_extraction_results()` function was complex merge logic that was difficult to maintain and test.

### Option B: Single Claude call with no looping (one-shot tool use)

Call Claude once with tools, execute whatever tool calls come back, but do not feed results back for another call.

- Pros: Simplest possible architecture. No loop state to manage. Predictable cost — exactly one API call per user message (plus panel generation).
- Cons: Claude cannot react to tool execution results. If a tool fails, the model has no opportunity to retry or adjust. Multi-step operations (create vehicle, then reference it in a deal) would require the model to batch everything optimistically in a single response, which is unreliable. The model cannot confirm tool success before building on it in subsequent tool calls.

### Option C: Client-side tool orchestration

Move tool execution to the frontend — Claude returns tool call intents, the frontend executes them via API calls, then sends results back for the next Claude call.

- Pros: Reduces backend complexity. The frontend already has `dealStore.applyToolCall()` routing.
- Cons: Dramatically increases round trips (frontend → backend → Claude → frontend → backend for each tool). Exposes tool execution logic to the client, creating a larger attack surface. Latency compounds across network hops. The backend loses the ability to enforce tool execution ordering and priority batching.

## Consequences

- **Positive:** Eliminates one full Claude API call per user message. The model extracts and updates deal state as part of its natural conversational response, reducing latency by 2-5 seconds per message.
- **Positive:** 17 granular tools replace one monolithic extraction schema. Each tool has a focused schema, making partial failures recoverable — if `update_deal_health` fails, `update_deal_numbers` still commits. Claude can also choose to call only the tools relevant to the current message.
- **Positive:** Multi-step tool chains are now possible. Claude can create a vehicle in step 1, observe the result, and create a deal referencing that vehicle in step 2 — up to 5 steps per turn.
- **Positive:** Priority-based concurrent execution (`build_execution_plan()`) ensures structural operations (vehicle creation) complete before dependent operations (deal creation, field updates) while allowing independent updates to run in parallel via `asyncio.gather()`.
- **Positive:** Real-time deal state updates via SSE `tool_result` events. The frontend updates the insights panel as each tool completes, rather than waiting for the entire pipeline to finish.
- **Positive:** Usage tracking is aggregated across all steps within a turn via `merge_usage_summary()`, giving accurate per-turn cost accounting even for multi-step exchanges.
- **Negative:** The step loop is inherently more complex than a linear pipeline. `stream_chat_loop()` manages streaming state, tool accumulation, JSON parsing, truncation retries, error recovery, priority batching, and message history construction in a single function.
- **Negative:** Each step is a full Claude API call with the complete message history, so a 3-step turn costs 3x the input tokens of a single call. The `CHAT_LOOP_MAX_STEPS` limit of 5 bounds the worst case, but multi-step turns are more expensive than the old pipeline's two fixed calls.
- **Negative:** The model can now call tools incorrectly during conversation (wrong tool, wrong arguments, hallucinated data). The system prompt includes detailed tool-use instructions and grounding rules to mitigate this, and tool execution errors are fed back to Claude as error `tool_result` messages so it can self-correct.
- **Neutral:** Panel generation remains a separate post-loop call. It operates on finalized deal state and does not benefit from being inside the step loop, so it was intentionally kept separate.
- **Neutral:** `analyze_deal()` for the deals PATCH endpoint retains its own inline tool schema, independent of the chat loop. On-demand re-assessment does not use `stream_chat_loop()`.

## References

- [Step loop implementation — `stream_chat_loop()`](../../apps/backend/app/services/claude.py)
- [Tool execution and priority batching — `build_execution_plan()`, `execute_tool()`](../../apps/backend/app/services/deal_state.py)
- [Panel generation — `generate_ai_panel_cards_with_usage()`](../../apps/backend/app/services/panel.py)
- [Chat SSE endpoint](../../apps/backend/app/routes/chat.py)
- [Commit: feat(ai): turn loop replacing three-stage pipeline](https://github.com/kramersmith/dealership-ai/commit/fab40c8)
- [Commit: refactor(ai): disambiguate turn/step terminology](https://github.com/kramersmith/dealership-ai/commit/8cabb8e)
