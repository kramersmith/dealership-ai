# ADR-0002: SSE over WebSockets for Streaming

**Status:** Accepted
**Date:** 2026-03
**Deciders:** Kramer Smith

## Context

The core user experience requires streaming AI responses in real-time. When a user sends a chat message, the backend calls Claude's API, which returns a streamed response containing both conversational text and structured tool calls (e.g., `update_deal_numbers`, `update_scorecard`). The frontend must receive these incrementally to:

1. Display text tokens as they arrive (typewriter effect)
2. Update dashboard components immediately when tool calls complete
3. Signal when the full response is done

The communication pattern is inherently unidirectional for each request: the client sends one message (HTTP POST), and the server streams back a sequence of events. There is no need for the server to push unsolicited messages outside of an active request-response cycle.

## Decision

Use Server-Sent Events (SSE) for streaming Claude responses from backend to frontend. The client sends a standard HTTP POST to `/api/chat/{session_id}/message`, and the backend returns an SSE stream with three event types:

- `event: text` — conversational text chunks (partial tokens)
- `event: tool_result` — structured JSON payloads from Claude tool calls (dashboard updates)
- `event: done` — signals the response is complete

The frontend's `useChat` hook processes these events via `EventSource`-compatible parsing and dispatches tool results to the appropriate Zustand stores.

## Alternatives Considered

### Option A: WebSockets
- Pros: Full-duplex communication, well-supported across platforms, could handle future features like typing indicators or real-time collaboration
- Cons: More complex connection lifecycle (upgrade handshake, heartbeats, reconnection logic). Bidirectionality is unnecessary — the app's interaction model is strictly request/response. WebSocket connections can be problematic through certain proxies, load balancers, and CDNs (especially on Railway, Fly.io, and similar platforms). Requires additional state management for connection health.

### Option B: Long polling
- Pros: Works everywhere, no special protocol support needed
- Cons: High latency between chunks, inefficient for streaming tokens (each poll is a separate HTTP request), poor UX for real-time text display

### Option C: gRPC streaming
- Pros: Efficient binary protocol, strong typing with protobuf, built-in streaming support
- Cons: Requires protobuf tooling, not natively supported in browsers (needs grpc-web proxy), adds significant complexity for a two-endpoint streaming use case, overkill for MVP

## Consequences

- **Positive:** SSE maps directly to Claude's streaming API pattern — the Anthropic SDK streams message chunks, and the backend forwards them as SSE events with minimal transformation. Implementation is straightforward: FastAPI's `StreamingResponse` with `text/event-stream` content type.
- **Positive:** SSE works reliably through HTTP proxies, CDNs, and platform load balancers without special configuration. No connection upgrade negotiation.
- **Positive:** Simpler error handling — SSE rides on standard HTTP, so auth failures return normal 401/403 responses before the stream begins. No need to handle auth inside an established socket connection.
- **Negative:** SSE is unidirectional (server-to-client only). If future features require server-initiated pushes (e.g., deal alerts, real-time notifications from the dealer app), a separate mechanism (push notifications, polling, or upgrading to WebSockets) would be needed.
- **Negative:** SSE has a browser limit of ~6 concurrent connections per domain (HTTP/1.1). Not an issue for this app's single-stream-at-a-time pattern, but worth noting.
- **Neutral:** If the app later needs bidirectional real-time features, this decision can be revisited. The SSE event format (`text`, `tool_result`, `done`) is transport-agnostic and could be sent over WebSockets with minimal refactoring.

## References

- [Architecture doc — streaming flow](../architecture.md)
- [MDN: Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
- [FastAPI StreamingResponse](https://fastapi.tiangolo.com/advanced/custom-response/#streamingresponse)
