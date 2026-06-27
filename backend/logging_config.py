"""Structured logging setup.

Replaces the project's ad-hoc ``print()`` calls with the stdlib ``logging`` module
emitting one JSON object per line (when ``LOG_JSON=true``), so logs are greppable and
ingestible by log aggregators. Extra context (session_id, tool_name, verdict, …) passed
via ``logger.info(msg, extra={...})`` is merged into the JSON record.
"""
import json
import logging
import sys
from datetime import datetime, timezone

# Attributes present on every LogRecord — anything NOT in here that a caller attached
# via extra={} is treated as structured context and included in the JSON output.
_RESERVED = set(
    logging.makeLogRecord({}).__dict__.keys()
) | {"message", "asctime", "taskName"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key not in _RESERVED:
                payload[key] = value
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO", json_output: bool = True) -> None:
    handler = logging.StreamHandler(sys.stdout)
    if json_output:
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
        )

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
