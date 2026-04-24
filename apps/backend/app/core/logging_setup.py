"""JSON Lines logging (stdout/stderr) with request context fields."""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Final

from pythonjsonlogger.json import JsonFormatter

from app.core.request_context import (
    http_request_id,
    http_request_method,
    http_request_path,
)

# Uvicorn access logger supplies these on the LogRecord when present.
_OPTIONAL_ACCESS_FIELDS: Final = ("client_addr", "request_line", "status_code")


class RequestContextFilter(logging.Filter):
    """Attach correlation and HTTP path fields; pad uvicorn access-only attributes."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = http_request_id.get()
        record.http_method = http_request_method.get()
        record.http_path = http_request_path.get()
        for key in _OPTIONAL_ACCESS_FIELDS:
            if not hasattr(record, key):
                setattr(record, key, "-")
        return True


def build_json_log_formatter() -> JsonFormatter:
    return JsonFormatter(
        "%(asctime)s %(levelname)s %(name)s %(message)s %(request_id)s "
        "%(http_method)s %(http_path)s %(client_addr)s %(request_line)s %(status_code)s",
        rename_fields={
            "asctime": "timestamp",
            "levelname": "level",
        },
        json_ensure_ascii=False,
    )


_NOISY_THIRD_PARTY_LOGGERS: Final = (
    "anthropic",
    "anthropic._base_client",
    "httpcore",
    "httpcore.http11",
    "httpcore.connection",
    "httpx",
)


def _remove_and_close_handlers(logger: logging.Logger) -> None:
    for existing_handler in logger.handlers[:]:
        logger.removeHandler(existing_handler)
        try:
            existing_handler.close()
        except OSError:
            pass


def configure_logging(
    level_name: str,
    *,
    third_party_level_name: str = "WARNING",
    local_ndjson_path: str | None = None,
) -> None:
    """Configure root + uvicorn loggers for one JSON line per record.

    When ``local_ndjson_path`` is set, the same records are appended to that file
    (clean NDJSON for agents; no ``docker compose`` line prefix).
    """
    level = getattr(logging, level_name.upper(), logging.INFO)
    third_party_level = getattr(
        logging, third_party_level_name.upper(), logging.WARNING
    )
    stream_handler = logging.StreamHandler(sys.stderr)
    stream_handler.addFilter(RequestContextFilter())
    stream_handler.setFormatter(build_json_log_formatter())

    root = logging.getLogger()
    _remove_and_close_handlers(root)
    root.addHandler(stream_handler)
    path_raw = (local_ndjson_path or "").strip()
    if path_raw:
        try:
            path = Path(path_raw)
            if not path.is_absolute():
                path = Path.cwd() / path
            path.parent.mkdir(parents=True, exist_ok=True)
            file_handler = logging.FileHandler(path, encoding="utf-8")
            file_handler.addFilter(RequestContextFilter())
            file_handler.setFormatter(build_json_log_formatter())
            root.addHandler(file_handler)
            # One immediate line so the host file exists after restart (not only after first request).
            sink_log = logging.getLogger("app.logging_setup")
            sink_log.info("Local NDJSON log sink ready (%s)", path.resolve())
            try:
                file_handler.flush()
            except OSError:
                pass
        except OSError:
            # Degrade gracefully: structured stderr logging still works even
            # if the local NDJSON sink cannot be created (permissions, RO FS,
            # missing volume, etc.). Never crash app startup over observability.
            logging.getLogger(__name__).exception(
                "Failed to attach local NDJSON log file handler at %s; "
                "continuing with stderr logging only",
                path_raw,
            )
    root.setLevel(level)

    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(name)
        _remove_and_close_handlers(uvicorn_logger)
        uvicorn_logger.propagate = True

    for name in _NOISY_THIRD_PARTY_LOGGERS:
        logging.getLogger(name).setLevel(third_party_level)


def flush_logging_handlers() -> None:
    """Best-effort flush so harness lines reach the sink before abrupt process exit."""

    for handler in logging.root.handlers:
        try:
            handler.flush()
        except Exception:
            pass
