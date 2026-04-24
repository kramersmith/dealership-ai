"""Request correlation middleware and JSON log shape."""

from __future__ import annotations

import io
import json
import logging

import pytest
from app.core import logging_setup
from app.core.config import settings
from app.core.logging_setup import (
    RequestContextFilter,
    build_json_log_formatter,
    configure_logging,
    flush_logging_handlers,
)
from app.core.request_context import (
    RequestContextMiddleware,
    http_request_id,
    http_request_method,
    http_request_path,
)
from app.main import app
from fastapi import FastAPI, Response
from httpx import ASGITransport, AsyncClient


@pytest.mark.asyncio
async def test_health_echoes_generated_x_request_id() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/health")
    assert response.status_code == 200
    request_id = response.headers.get("x-request-id")
    assert request_id
    assert len(request_id) >= 8


@pytest.mark.asyncio
async def test_health_preserves_incoming_x_request_id() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get(
            "/health", headers={"X-Request-ID": "custom-req-id"}
        )
    assert response.status_code == 200
    assert response.headers.get("x-request-id") == "custom-req-id"


@pytest.mark.asyncio
async def test_health_replaces_invalid_incoming_x_request_id() -> None:
    transport = ASGITransport(app=app)
    invalid_request_id = "bad request id"
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get(
            "/health", headers={"X-Request-ID": invalid_request_id}
        )
    assert response.status_code == 200
    assert response.headers.get("x-request-id")
    assert response.headers.get("x-request-id") != invalid_request_id


@pytest.mark.asyncio
async def test_middleware_replaces_existing_response_x_request_id_header() -> None:
    custom_app = FastAPI()
    custom_app.add_middleware(RequestContextMiddleware)

    @custom_app.get("/header")
    def header() -> Response:
        response = Response("ok")
        response.headers["X-Request-ID"] = "from-handler"
        return response

    transport = ASGITransport(app=custom_app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get(
            "/header", headers={"X-Request-ID": "custom-req-id"}
        )

    assert response.headers.get_list("x-request-id") == ["custom-req-id"]


def test_request_context_filter_sets_record_fields() -> None:
    request_context_filter = RequestContextFilter()
    record = logging.LogRecord("n", logging.INFO, __file__, 1, "msg", (), None)
    request_id_token = http_request_id.set("rid-1")
    request_method_token = http_request_method.set("POST")
    request_path_token = http_request_path.set("/api/chat")
    try:
        assert request_context_filter.filter(record) is True
    finally:
        http_request_id.reset(request_id_token)
        http_request_method.reset(request_method_token)
        http_request_path.reset(request_path_token)
    assert getattr(record, "request_id") == "rid-1"
    assert getattr(record, "http_method") == "POST"
    assert getattr(record, "http_path") == "/api/chat"
    assert getattr(record, "client_addr") == "-"


def test_json_formatter_emits_one_line_with_correlation_fields() -> None:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(build_json_log_formatter())
    handler.addFilter(RequestContextFilter())
    test_logger = logging.getLogger("fmt.test.request_ctx")
    test_logger.handlers.clear()
    test_logger.propagate = False
    test_logger.addHandler(handler)
    test_logger.setLevel(logging.INFO)

    request_id_token = http_request_id.set("abc-123")
    request_method_token = http_request_method.set("GET")
    request_path_token = http_request_path.set("/health")
    try:
        test_logger.info("ping")
    finally:
        http_request_id.reset(request_id_token)
        http_request_method.reset(request_method_token)
        http_request_path.reset(request_path_token)

    line = stream.getvalue().strip()
    payload = json.loads(line)
    assert payload["message"] == "ping"
    assert payload["request_id"] == "abc-123"
    assert payload["http_method"] == "GET"
    assert payload["http_path"] == "/health"
    assert payload["level"] == "INFO"
    assert "timestamp" in payload


def test_configure_logging_writes_local_ndjson_file(tmp_path) -> None:
    log_file = tmp_path / "out.ndjson"
    configure_logging(
        "INFO",
        third_party_level_name=settings.LOG_THIRD_PARTY_LEVEL,
        local_ndjson_path=str(log_file),
    )
    test_logger = logging.getLogger("t.local.ndjson.file")
    request_id_token = http_request_id.set("req-ndjson-file-1")
    try:
        test_logger.info("file_line_ok")
    finally:
        http_request_id.reset(request_id_token)
    flush_logging_handlers()
    lines = log_file.read_text(encoding="utf-8").strip().splitlines()
    assert lines
    bootstrap = json.loads(lines[0])
    assert "Local NDJSON log sink ready" in bootstrap["message"]
    payload = json.loads(lines[-1])
    assert payload["message"] == "file_line_ok"
    assert payload["request_id"] == "req-ndjson-file-1"

    configure_logging(
        settings.LOG_LEVEL,
        third_party_level_name=settings.LOG_THIRD_PARTY_LEVEL,
        local_ndjson_path=settings.LOG_LOCAL_NDJSON_PATH.strip() or None,
    )


def test_configure_logging_degrades_gracefully_when_local_ndjson_sink_fails(
    monkeypatch,
) -> None:
    def _raise_os_error(*args, **kwargs):
        raise OSError("read only")

    monkeypatch.setattr(logging_setup.logging, "FileHandler", _raise_os_error)

    configure_logging(
        "INFO",
        third_party_level_name=settings.LOG_THIRD_PARTY_LEVEL,
        local_ndjson_path="logs/blocked.ndjson",
    )

    root = logging.getLogger()
    assert len(root.handlers) == 1
    assert isinstance(root.handlers[0], logging.StreamHandler)

    request_id_token = http_request_id.set("req-stderr-only")
    try:
        logging.getLogger("t.local.ndjson.fallback").info("stderr_only_ok")
    finally:
        http_request_id.reset(request_id_token)
    flush_logging_handlers()

    configure_logging(
        settings.LOG_LEVEL,
        third_party_level_name=settings.LOG_THIRD_PARTY_LEVEL,
        local_ndjson_path=settings.LOG_LOCAL_NDJSON_PATH.strip() or None,
    )


@pytest.mark.asyncio
async def test_request_context_middleware_resets_context_after_exception() -> None:
    seen_context: dict[str, str] = {}

    async def failing_app(scope, receive, send) -> None:
        seen_context.update(
            {
                "request_id": http_request_id.get(),
                "method": http_request_method.get(),
                "path": http_request_path.get(),
            }
        )
        raise RuntimeError("boom")

    middleware = RequestContextMiddleware(failing_app)
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/boom",
        "headers": [(b"x-request-id", b"req-123")],
    }

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        return None

    with pytest.raises(RuntimeError, match="boom"):
        await middleware(scope, receive, send)

    assert seen_context == {
        "request_id": "req-123",
        "method": "POST",
        "path": "/boom",
    }
    assert http_request_id.get() == "-"
    assert http_request_method.get() == "-"
    assert http_request_path.get() == "-"
