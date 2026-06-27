"""
Smoke test for the Receipts production receipting path.

Exercises the same backend endpoint the MCP proxy uses (`/tools/record`) against a live
backend, and confirms the receipt + session appear. The full proxy↔upstream flow is covered
by the pytest suite (tests/test_proxy.py); this is a quick manual check against a running server.

Run with:  python3 test_mcp.py
Requires:  backend running at http://localhost:8000 with a proxy-role API key
           (default 'devproxy' from the documented Quick start).
"""
import asyncio
import os
import sys
import uuid

import httpx

RECEIPTS_URL = os.environ.get("RECEIPTS_URL", "http://localhost:8000")
API_KEY = os.environ.get("RECEIPTS_API_KEY", "devproxy")
HEADERS = {"Authorization": f"Bearer {API_KEY}"}


def _pass(msg: str) -> None:
    print(f"  PASS  {msg}")


def _fail(msg: str) -> None:
    print(f"  FAIL  {msg}")


async def run_tests() -> int:
    failures = 0
    session_id = f"smoke-{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient(timeout=10.0, headers=HEADERS) as client:
        # 1. backend reachable + authed
        print("1. Checking backend is reachable and key is valid …")
        try:
            resp = await client.get(f"{RECEIPTS_URL}/stats")
            resp.raise_for_status()
            before = resp.json().get("total_receipts", 0)
            _pass(f"Backend online — {before} receipts so far")
        except Exception as exc:
            _fail(f"Backend unreachable or unauthorized: {exc}")
            _fail("Start it:  cd backend && RECEIPT_SECRET=dev-secret "
                  "API_KEYS='proxy:proxy:devproxy' python3 -m uvicorn main:app --reload")
            return 1

        # 2. record an already-executed call (the proxy path)
        print("\n2. Recording a tool call via /tools/record …")
        resp = await client.post(
            f"{RECEIPTS_URL}/tools/record",
            json={
                "session_id": session_id,
                "tool_name": "smoke__echo",
                "tool_input": {"message": "hello"},
                "tool_output": {"content": [{"type": "text", "text": "hello"}], "isError": False},
                "status": "success",
            },
        )
        if resp.status_code == 201:
            receipt = resp.json()
            _pass(f"Receipt created: {receipt['id'][:8]} ({receipt['tool_name']})")
        else:
            _fail(f"/tools/record returned HTTP {resp.status_code}: {resp.text}")
            return failures + 1

        # 3. receipt count went up
        resp = await client.get(f"{RECEIPTS_URL}/stats")
        after = resp.json().get("total_receipts", 0)
        if after > before:
            _pass(f"Receipt count increased ({before} → {after})")
        else:
            _fail(f"Receipt count did not increase ({before} → {after})")
            failures += 1

        # 4. session is visible
        print("\n3. Checking session is visible in /sessions …")
        resp = await client.get(f"{RECEIPTS_URL}/sessions/{session_id}")
        if resp.status_code == 200:
            sess = resp.json()
            _pass(f"Session {session_id}: status={sess.get('status')}, "
                  f"receipts={sess.get('receipt_count')}")
        else:
            _fail(f"Session not found (HTTP {resp.status_code})")
            failures += 1

        # 5. auth is actually enforced
        print("\n4. Checking auth is enforced …")
        resp = await client.get(f"{RECEIPTS_URL}/stats", headers={"Authorization": "Bearer nope"})
        if resp.status_code == 401:
            _pass("Invalid key rejected with 401")
        else:
            _fail(f"Expected 401 for invalid key, got {resp.status_code}")
            failures += 1

    print(f"\n{'─' * 40}")
    print("All checks passed." if failures == 0 else f"{failures} check(s) failed.")
    return failures


if __name__ == "__main__":
    sys.exit(asyncio.run(run_tests()))
