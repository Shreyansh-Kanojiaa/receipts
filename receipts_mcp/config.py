"""Configuration for the Receipts MCP proxy.

Two inputs:
  1. Environment (via pydantic-settings): where the Receipts backend is and the API
     key to authenticate to it.
  2. An upstreams file (JSON): the company's real MCP servers to front. Format mirrors
     the familiar ``mcpServers`` convention. ``${ENV_VAR}`` references inside ``env`` and
     ``headers`` are expanded from the process environment so upstream secrets are never
     committed to the file.
"""
import json
import os
import re
from pathlib import Path
from typing import Any

from pydantic_settings import BaseSettings, SettingsConfigDict

from mcp.client.stdio import StdioServerParameters
from mcp.client.session_group import SseServerParameters, StreamableHttpParameters

_ENV_REF = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


class ProxySettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    receipts_url: str = "http://localhost:8000"
    receipts_api_key: str | None = None          # proxy-role key for /tools/record
    upstreams_path: str = "receipts_mcp/upstreams.json"
    record_timeout_seconds: float = 5.0          # backend POST timeout
    tool_timeout_seconds: float = 60.0           # upstream tool-call timeout


def _expand(value: Any) -> Any:
    """Recursively expand ${ENV_VAR} references in strings."""
    if isinstance(value, str):
        return _ENV_REF.sub(lambda m: os.environ.get(m.group(1), ""), value)
    if isinstance(value, dict):
        return {k: _expand(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_expand(v) for v in value]
    return value


def load_upstreams(path: str) -> tuple[dict[str, Any], bool]:
    """Load and validate the upstreams file.

    Returns ``(server_params_by_key, include_demo_tools)`` where each value is an
    SDK params object ready for ``ClientSessionGroup.connect_to_server``.
    """
    p = Path(path)
    if not p.exists():
        return {}, False
    data = json.loads(p.read_text())
    include_demo = bool(data.get("include_demo_tools", False))

    result: dict[str, Any] = {}
    for key, spec in (data.get("upstreams") or {}).items():
        spec = _expand(spec)
        transport = (spec.get("transport") or "stdio").lower()
        if transport == "stdio":
            result[key] = StdioServerParameters(
                command=spec["command"],
                args=spec.get("args", []),
                env={**os.environ, **spec.get("env", {})} if spec.get("env") else None,
                cwd=spec.get("cwd"),
            )
        elif transport == "sse":
            result[key] = SseServerParameters(
                url=spec["url"], headers=spec.get("headers"),
            )
        elif transport in ("streamable_http", "http"):
            result[key] = StreamableHttpParameters(
                url=spec["url"], headers=spec.get("headers"),
            )
        else:
            raise ValueError(f"upstream '{key}': unknown transport '{transport}'")
    return result, include_demo
