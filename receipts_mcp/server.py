"""Receipts MCP proxy — stdio server.

Sits between an MCP client (Claude Code / Cursor) and a company's REAL MCP servers.
On startup it connects to every upstream listed in the upstreams file, aggregates their
tools, and re-exposes them to the agent. Each tool call is forwarded to the real upstream,
its real output captured and receipted via the Receipts backend, then returned to the agent.

If no upstreams are configured (or the file is missing) the proxy falls back to exposing the
three built-in demo tools, which forward to the backend's ``/tools/call`` — preserving the
original demo behavior so a fresh checkout still works end-to-end.

Run:  python -m receipts_mcp.server
"""
import asyncio
import logging
import sys
from typing import Any

import httpx
import mcp.types as types
from mcp.server.lowlevel import Server
from mcp.server.stdio import stdio_server
from mcp.client.session_group import ClientSessionGroup

from .config import ProxySettings, load_upstreams
from .proxy import SESSION_ID, namespacing_hook, call_and_record

logger = logging.getLogger("receipts.proxy")


# ── built-in demo tools (fallback when no upstreams are configured) ─────────────

_DEMO_TOOLS = [
    types.Tool(
        name="write_file",
        description="Write content to a file path. Every call is cryptographically receipted.",
        inputSchema={
            "type": "object",
            "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
            "required": ["path", "content"],
        },
    ),
    types.Tool(
        name="http_fetch",
        description="Make an HTTP request to a URL. Every call is cryptographically receipted.",
        inputSchema={
            "type": "object",
            "properties": {"url": {"type": "string"}, "method": {"type": "string"}},
            "required": ["url"],
        },
    ),
    types.Tool(
        name="db_query",
        description="Execute a database query. Every call is cryptographically receipted.",
        inputSchema={
            "type": "object",
            "properties": {"query": {"type": "string"}, "params": {"type": "array"}},
            "required": ["query"],
        },
    ),
]


async def _demo_call(
    client: httpx.AsyncClient, settings: ProxySettings, name: str, arguments: dict[str, Any]
) -> types.CallToolResult:
    """Forward a demo tool to the backend's /tools/call (which executes the mock)."""
    headers = {}
    if settings.receipts_api_key:
        headers["Authorization"] = f"Bearer {settings.receipts_api_key}"
    try:
        resp = await client.post(
            f"{settings.receipts_url}/tools/call",
            json={"tool_name": name, "tool_input": arguments, "session_id": SESSION_ID},
            headers=headers,
            timeout=settings.record_timeout_seconds,
        )
        resp.raise_for_status()
        output = resp.json().get("tool_output", {})
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=str(output))],
            structuredContent=output if isinstance(output, dict) else None,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("demo tool call failed", extra={"tool_name": name, "error": str(exc)})
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=f"RECEIPTS PROXY ERROR: {exc}")],
            isError=True,
        )


# ── proxy runtime ───────────────────────────────────────────────────────────────

async def run_proxy() -> None:
    settings = ProxySettings()
    upstreams, include_demo = load_upstreams(settings.upstreams_path)
    server = Server("receipts")

    async with httpx.AsyncClient() as client:
        if not upstreams:
            # No real upstreams → demo fallback.
            logger.info("no upstreams configured — exposing built-in demo tools")

            @server.list_tools()
            async def list_demo() -> list[types.Tool]:
                return _DEMO_TOOLS

            @server.call_tool()
            async def call_demo(name: str, arguments: dict) -> types.CallToolResult:
                return await _demo_call(client, settings, name, arguments)

            await _serve(server)
            return

        # Real proxy: connect to every upstream and aggregate their tools.
        async with ClientSessionGroup(component_name_hook=namespacing_hook) as group:
            connected = 0
            for key, params in upstreams.items():
                try:
                    await group.connect_to_server(params)
                    connected += 1
                    logger.info("connected upstream", extra={"upstream": key})
                except Exception:
                    logger.exception("failed to connect upstream", extra={"upstream": key})

            logger.info(
                "proxy ready",
                extra={"upstreams": connected, "tools": len(group.tools), "session_id": SESSION_ID},
            )

            @server.list_tools()
            async def list_proxied() -> list[types.Tool]:
                tools = list(group.tools.values())
                if include_demo:
                    tools = tools + _DEMO_TOOLS
                return tools

            @server.call_tool()
            async def call_proxied(name: str, arguments: dict) -> types.CallToolResult:
                if include_demo and name in {t.name for t in _DEMO_TOOLS}:
                    return await _demo_call(client, settings, name, arguments)
                return await call_and_record(group, client, settings, name, arguments)

            await _serve(server)


async def _serve(server: Server) -> None:
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream, write_stream, server.create_initialization_options()
        )


def _configure_logging() -> None:
    # Logs go to STDERR — stdout is the MCP stdio transport and must stay clean.
    logging.basicConfig(
        level=logging.INFO,
        stream=sys.stderr,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def main() -> None:
    _configure_logging()
    asyncio.run(run_proxy())


if __name__ == "__main__":
    main()
