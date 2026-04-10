# Architecture Decision Records (ADRs)

This directory records significant architecture decisions for the Dealership AI project. Each ADR describes the context, decision, alternatives considered, and consequences.

## Format

Each ADR follows the template in `0000-template.md`. ADRs are numbered sequentially (0001, 0002, ...) and immutable once accepted — supersede rather than edit.

## Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [0001](0001-monorepo-and-tech-stack.md) | Monorepo and tech stack | Accepted | 2026-03 |
| [0002](0002-sse-over-websockets.md) | SSE over WebSockets for streaming | Accepted | 2026-03 |
| [0003](0003-single-mutable-deal-state.md) | Single mutable deal state row | Superseded by 0010 | 2026-03 |
| [0004](0004-jwt-authentication.md) | JWT authentication | Accepted | 2026-03 |
| [0005](0005-turn-step-chat-loop.md) | Turn/step chat loop | Accepted | 2026-03 |
| [0006](0006-concurrent-tool-execution.md) | Concurrent tool execution | Accepted | 2026-03 |
| [0007](0007-ai-generated-panel-cards.md) | AI-generated panel cards | Accepted | 2026-03 |
| [0008](0008-vehicle-intelligence-integrations.md) | Vehicle intelligence integrations | Accepted | 2026-03 |
| [0009](0009-streaming-resilience.md) | Streaming resilience | Accepted | 2026-03 |
| [0010](0010-multi-vehicle-deal-architecture.md) | Multi-vehicle/deal architecture | Accepted | 2026-03 |
| [0011](0011-usage-tracking-and-cost-accounting.md) | Usage tracking and cost accounting | Accepted | 2026-04 |
| [0012](0012-two-phase-chat-panel-sse-contract.md) | Two-phase chat/panel SSE contract | Accepted | 2026-04 |
| [0013](0013-canonical-panel-contract-and-step-loop-guardrails.md) | Canonical panel contract and step-loop guardrails | Accepted | 2026-04 |
| [0014](0014-confirmed-vin-decode-promotion.md) | Confirmed VIN decode promotion | Accepted | 2026-04 |
| [0015](0015-prompt-cache-break-detection.md) | Prompt cache break detection via request fingerprinting | Accepted | 2026-04 |
| [0016](0016-chat-error-resilience-and-orphan-cleanup.md) | Chat error resilience — API error mapping and orphan cleanup | Accepted | 2026-04 |
| [0017](0017-context-compaction-custom.md) | Custom context compaction (buyer chat) | Accepted | 2026-04 |
| [0018](0018-multi-vehicle-panel-and-chat-tables.md) | Multi-vehicle panel presentation and chat-rendered comparison tables | Accepted | 2026-04 |
| [0019](0019-pre-persisted-user-messages-for-vin-intercept.md) | Pre-persisted user messages for gated pre-stream flows (VIN intercept) | Accepted | 2026-04 |
| [0020](0020-chat-branch-from-user-message.md) | Branch chat timeline from a user message | Accepted | 2026-04 |
| [0021](0021-chat-harness-logging.md) | Chat harness logging (full vs lite `chat_turn_summary`) | Accepted | 2026-04 |
| [0022](0022-client-side-message-queue.md) | Client-side message queue for buyer chat | Accepted | 2026-04 |
| [0023](0023-stop-generation-cancellation-contract.md) | Stop generation cancellation contract | Accepted | 2026-04 |
| [0024](0024-panel-update-policy-and-user-settings.md) | Centralized panel update policy and user settings | Accepted | 2026-04 |
