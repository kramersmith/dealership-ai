"""Per-request ASGI context for structured logging (``X-Request-ID`` correlation)."""

from __future__ import annotations

import contextvars
import re
import uuid
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

# Accept only printable ASCII request ids; reject control chars / CRLF (log + header
# injection hardening). Bound length so a hostile client can't bloat logs.
_REQUEST_ID_HEADER = b"x-request-id"
_REQUEST_ID_SAFE = re.compile(r"^[A-Za-z0-9._\-:+/=]{1,128}$")

http_request_id: contextvars.ContextVar[str] = contextvars.ContextVar(
    "http_request_id", default="-"
)
http_request_method: contextvars.ContextVar[str] = contextvars.ContextVar(
    "http_request_method", default="-"
)
http_request_path: contextvars.ContextVar[str] = contextvars.ContextVar(
    "http_request_path", default="-"
)


def _reset_tokens(tokens: list[tuple[contextvars.ContextVar[str], Any]]) -> None:
    for var, token in reversed(tokens):
        var.reset(token)


def _normalize_request_id(raw_header: bytes | None) -> str | None:
    if raw_header is None:
        return None
    try:
        candidate = raw_header.decode("latin-1").strip()
    except UnicodeDecodeError:
        return None
    if not candidate:
        return None
    if not _REQUEST_ID_SAFE.match(candidate):
        return None
    return candidate


def _upsert_response_header(
    headers: list[tuple[bytes, bytes]], *, name: bytes, value: bytes
) -> list[tuple[bytes, bytes]]:
    filtered = [(key, existing) for key, existing in headers if key.lower() != name]
    filtered.append((name, value))
    return filtered


class RequestContextMiddleware:
    """Honor or generate ``X-Request-ID``; bind path/method/id to contextvars for logs."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers") or [])
        request_id = _normalize_request_id(headers.get(_REQUEST_ID_HEADER)) or str(
            uuid.uuid4()
        )

        method = scope.get("method", "-")
        path = scope.get("path", "-")

        tokens: list[tuple[contextvars.ContextVar[str], Any]] = [
            (http_request_id, http_request_id.set(request_id)),
            (http_request_method, http_request_method.set(method)),
            (http_request_path, http_request_path.set(path)),
        ]

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                response_headers = _upsert_response_header(
                    list(message.get("headers") or []),
                    name=_REQUEST_ID_HEADER,
                    value=request_id.encode("latin-1"),
                )
                updated_message = dict(message)
                updated_message["headers"] = response_headers
                await send(updated_message)
            else:
                await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            _reset_tokens(tokens)
