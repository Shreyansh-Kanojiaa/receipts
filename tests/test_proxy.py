"""Proxy integration test: real upstream MCP server in, receipt out.

Spins up tests/fixtures/mock_upstream.py as a real stdio MCP server, connects the
proxy's ClientSessionGroup to it, and asserts:
  - the upstream tool is exposed namespaced (mockupstream__echo)
  - calling it returns the REAL upstream output
  - a receipt for that exact call is POSTed to the backend /tools/record
The backend is faked with httpx.MockTransport so the test needs no live server.
"""
import asyncio
import json
import os
import sys
from pathlib import Path

import httpx
from mcp.client.stdio import StdioServerParameters
from mcp.client.session_group import ClientSessionGroup

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from receipts_mcp.proxy import namespacing_hook, call_and_record, normalize_result  # noqa: E402
from receipts_mcp.config import ProxySettings  # noqa: E402


def test_proxy_forwards_real_output_and_records():
    async def run():
        captured = {}

        def backend_handler(request: httpx.Request) -> httpx.Response:
            captured["path"] = request.url.path
            captured["auth"] = request.headers.get("authorization")
            captured["json"] = json.loads(request.content)
            return httpx.Response(201, json={"id": "receipt-1"})

        transport = httpx.MockTransport(backend_handler)
        settings = ProxySettings(receipts_url="http://backend", receipts_api_key="proxy-key")

        params = StdioServerParameters(
            command=sys.executable,
            args=["-m", "tests.fixtures.mock_upstream"],
            env={**os.environ, "PYTHONPATH": str(ROOT)},
            cwd=str(ROOT),
        )

        async with ClientSessionGroup(component_name_hook=namespacing_hook) as group:
            await group.connect_to_server(params)
            assert "mockupstream__echo" in group.tools

            async with httpx.AsyncClient(transport=transport) as client:
                result = await call_and_record(
                    group, client, settings, "mockupstream__echo", {"message": "hi"}
                )

        # Real upstream output came back through the proxy (text content carrying
        # the real JSON the upstream produced — proof it actually executed there).
        norm = normalize_result(result)
        text = norm["content"][0]["text"]
        assert "hi" in text and "mock-upstream" in text
        assert result.isError is False

        # The call was receipted with the real output + auth header.
        assert captured["path"] == "/tools/record"
        assert captured["auth"] == "Bearer proxy-key"
        body = captured["json"]
        assert body["tool_name"] == "mockupstream__echo"
        assert body["status"] == "success"
        assert "mock-upstream" in body["tool_output"]["content"][0]["text"]

    asyncio.run(run())


def test_proxy_records_error_on_unknown_tool():
    async def run():
        captured = {}

        def backend_handler(request: httpx.Request) -> httpx.Response:
            captured["json"] = json.loads(request.content)
            return httpx.Response(201, json={"id": "r"})

        transport = httpx.MockTransport(backend_handler)
        settings = ProxySettings(receipts_url="http://backend", receipts_api_key="proxy-key")
        params = StdioServerParameters(
            command=sys.executable,
            args=["-m", "tests.fixtures.mock_upstream"],
            env={**os.environ, "PYTHONPATH": str(ROOT)},
            cwd=str(ROOT),
        )
        async with ClientSessionGroup(component_name_hook=namespacing_hook) as group:
            await group.connect_to_server(params)
            async with httpx.AsyncClient(transport=transport) as client:
                result = await call_and_record(
                    group, client, settings, "mockupstream__does_not_exist", {}
                )

        # Failed call is surfaced as an error AND still receipted as status=error.
        assert result.isError is True
        assert captured["json"]["status"] == "error"

    asyncio.run(run())
