"""The proxy core: connect to upstream MCP servers, forward tool calls, receipt them.

Flow per tool call:
  agent → this proxy → upstream MCP server (real execution) → real result
                     → POST /tools/record (sign + store) → return real result to agent

The real result is ALWAYS returned to the agent, even if receipting fails — a backend
outage must not break the agent's tools. A 401 (misconfigured key) is logged loudly so it
is not silently mistaken for a transient outage.
"""
import asyncio
import json
import logging
import re
import uuid
from typing import Any

import httpx
from mcp.client.session_group import ClientSessionGroup
import mcp.types as types

from .config import ProxySettings

logger = logging.getLogger("receipts.proxy")

# One Receipts session per proxy process — groups all of an agent session's calls.
SESSION_ID = f"mcp-{uuid.uuid4().hex[:12]}"

_RECORD_RETRY_DELAY_SECONDS = 1.0

# Per-process counters so a whole-session backend outage is reported as one summary
# line at shutdown, not just a stream of easy-to-miss per-call warnings.
_receipt_stats = {"attempted": 0, "recorded": 0}


def log_receipt_summary() -> None:
    attempted, recorded = _receipt_stats["attempted"], _receipt_stats["recorded"]
    if attempted and recorded < attempted:
        logger.warning(
            "%d of %d tool calls this session were not receipted",
            attempted - recorded, attempted,
            extra={"attempted": attempted, "recorded": recorded, "session_id": SESSION_ID},
        )

_SAFE = re.compile(r"[^A-Za-z0-9_]")


def namespacing_hook(name: str, server_info: types.Implementation) -> str:
    """Prefix every upstream tool with its server's advertised name.

    Guarantees collisions across upstreams never clobber each other and makes each
    receipt unambiguously attributable to the real server that ran the tool, e.g.
    ``github__create_issue``.
    """
    prefix = _SAFE.sub("_", (server_info.name or "tool")).strip("_") or "tool"
    return f"{prefix}__{name}"


def normalize_result(result: types.CallToolResult) -> dict[str, Any]:
    """Turn an upstream CallToolResult into a JSON-serializable dict for receipting.

    Prefers structuredContent when present; otherwise serializes content blocks
    (text verbatim, non-text by type) so the receipt captures exactly what ran.
    """
    if result.structuredContent is not None:
        return {"structured": result.structuredContent, "isError": bool(result.isError)}
    blocks: list[dict[str, Any]] = []
    for block in result.content or []:
        if isinstance(block, types.TextContent):
            blocks.append({"type": "text", "text": block.text})
        else:
            # Image/audio/embedded/etc. — record type + a JSON-safe dump.
            blocks.append(json.loads(block.model_dump_json()))
    return {"content": blocks, "isError": bool(result.isError)}


async def record_receipt(
    client: httpx.AsyncClient,
    settings: ProxySettings,
    tool_name: str,
    tool_input: dict[str, Any],
    tool_output: dict[str, Any],
    status: str,
) -> None:
    """POST the executed call to the backend to be signed and stored.

    Never raises — receipting is best-effort relative to returning the agent's result.
    Retries once on a transient connect/timeout failure before giving up on this call;
    a whole-session outage is still summarized at shutdown via log_receipt_summary().
    """
    _receipt_stats["attempted"] += 1
    headers = {}
    if settings.receipts_api_key:
        headers["Authorization"] = f"Bearer {settings.receipts_api_key}"

    for attempt in (1, 2):
        try:
            resp = await client.post(
                f"{settings.receipts_url}/tools/record",
                json={
                    "session_id": SESSION_ID,
                    "tool_name": tool_name,
                    "tool_input": tool_input,
                    "tool_output": tool_output,
                    "status": status,
                },
                headers=headers,
                timeout=settings.record_timeout_seconds,
            )
            if resp.status_code == 401 or resp.status_code == 403:
                logger.error(
                    "receipting rejected — check RECEIPTS_API_KEY (proxy role required)",
                    extra={"status_code": resp.status_code, "tool_name": tool_name},
                )
                return
            resp.raise_for_status()
            logger.info(
                "receipt recorded", extra={"tool_name": tool_name, "status": status}
            )
            _receipt_stats["recorded"] += 1
            return
        except (httpx.ConnectError, httpx.TimeoutException):
            if attempt == 1:
                await asyncio.sleep(_RECORD_RETRY_DELAY_SECONDS)
                continue
            logger.warning(
                "Receipts backend unreachable — tool ran but was NOT receipted",
                extra={"tool_name": tool_name, "receipts_url": settings.receipts_url},
            )
        except Exception:
            logger.exception("failed to record receipt", extra={"tool_name": tool_name})
            return


async def call_and_record(
    group: ClientSessionGroup,
    client: httpx.AsyncClient,
    settings: ProxySettings,
    name: str,
    arguments: dict[str, Any],
) -> types.CallToolResult:
    """Forward one tool call to its upstream, receipt it, return the real result."""
    status = "success"
    try:
        result = await asyncio.wait_for(
            group.call_tool(name, arguments),
            timeout=settings.tool_timeout_seconds,
        )
        if result.isError:
            status = "error"
    except (asyncio.TimeoutError, Exception) as exc:  # noqa: BLE001
        # A failed/hung upstream is itself auditable: record an error receipt and
        # surface an MCP error to the agent.
        status = "error"
        result = types.CallToolResult(
            content=[types.TextContent(type="text", text=f"upstream error: {exc}")],
            isError=True,
        )
        logger.warning("upstream tool call failed", extra={"tool_name": name, "error": str(exc)})

    await record_receipt(
        client, settings, name, arguments, normalize_result(result), status
    )
    return result
