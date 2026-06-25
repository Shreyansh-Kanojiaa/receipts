import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from models import (
    ClaimedOutput,
    CloseSessionResponse,
    DemoRunResponse,
    ReceiptResponse,
    SessionResponse,
    ToolCallRequest,
    VerifyRequest,
    VerifyResponse,
)
from database import (
    init_db,
    insert_receipt,
    get_receipts_for_session,
    get_receipt_for_session,
    get_all_receipts,
    get_stats,
    get_all_sessions,
    get_session,
    upsert_session,
    close_session,
    get_open_sessions_older_than,
    update_session_verdict,
)
from tools import execute_tool, TOOL_REGISTRY
from signer import build_receipt
from verifier import run_verify, derive_verdict
from auto_verify import auto_verify


INACTIVITY_TIMEOUT_SECONDS = 30
CHECKER_INTERVAL_SECONDS   = 10


async def timeout_checker_loop() -> None:
    while True:
        await asyncio.sleep(CHECKER_INTERVAL_SECONDS)
        try:
            stale = get_open_sessions_older_than(INACTIVITY_TIMEOUT_SECONDS)
            for session in stale:
                sid = session["session_id"]
                row = close_session(sid)
                count = row["receipt_count"] if row else "?"
                print(f"[SESSION] Closed (timeout): {sid} ({count} receipts)")
                await auto_verify(sid)
        except Exception as e:
            print(f"[WARN] Timeout checker error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    task = asyncio.create_task(timeout_checker_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Receipts", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── tool calls ────────────────────────────────────────────────────────────────

@app.post("/tools/call", response_model=ReceiptResponse, status_code=201)
def call_tool(req: ToolCallRequest):
    if req.tool_name not in TOOL_REGISTRY:
        raise HTTPException(status_code=404, detail=f"Unknown tool: {req.tool_name}")

    try:
        output = execute_tool(req.tool_name, req.tool_input)
        status = "success"
    except TypeError as e:
        raise HTTPException(status_code=422, detail=f"Invalid tool input: {e}")
    except Exception as e:
        output = {"error": str(e)}
        status = "error"

    receipt = build_receipt(
        session_id=req.session_id,
        tool_name=req.tool_name,
        tool_input=req.tool_input,
        tool_output=output,
        status=status,
    )
    receipt["tool_input"]  = req.tool_input
    receipt["tool_output"] = output
    insert_receipt(receipt)

    is_new = upsert_session(req.session_id)
    if is_new:
        print(f"[SESSION] Opened: {req.session_id}")
    print(f"[RECEIPT] {req.session_id} → {req.tool_name} → {status}")

    return receipt


# ── receipts ──────────────────────────────────────────────────────────────────

@app.get("/receipts/all", response_model=list[ReceiptResponse])
def list_all_receipts(limit: int = 50):
    return get_all_receipts(limit)


@app.get("/receipts/{session_id}", response_model=list[ReceiptResponse])
def list_receipts(session_id: str):
    return get_receipts_for_session(session_id)


# ── verify ────────────────────────────────────────────────────────────────────

@app.post("/verify", response_model=VerifyResponse)
def verify(req: VerifyRequest):
    verdicts = run_verify(req.session_id, req.claimed_outputs)
    return VerifyResponse(session_id=req.session_id, verdicts=verdicts)


# ── sessions ──────────────────────────────────────────────────────────────────

@app.get("/sessions", response_model=list[SessionResponse])
def list_sessions(limit: int = 50):
    return get_all_sessions(limit)


@app.get("/sessions/{session_id}", response_model=SessionResponse)
def get_session_detail(session_id: str):
    session = get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")
    return session


@app.post("/sessions/{session_id}/close", response_model=CloseSessionResponse)
async def close_session_endpoint(session_id: str, background_tasks: BackgroundTasks):
    row = close_session(session_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")
    count = row["receipt_count"]
    print(f"[SESSION] Closed (explicit): {session_id} ({count} receipts)")
    background_tasks.add_task(auto_verify, session_id)
    return CloseSessionResponse(
        session_id=session_id,
        status="closed",
        receipt_count=count,
        auto_verify_scheduled=True,
    )


@app.post("/sessions/{session_id}/verify-claim")
def verify_claim(session_id: str, req: VerifyRequest):
    """Full-claim reconciliation: verify agent claimed_outputs against stored receipts.

    Updates the session verdict with scope='full_claim' so the frontend can distinguish
    this from a signature-only auto-verify result.
    """
    verdicts = run_verify(session_id, req.claimed_outputs)
    verdict  = derive_verdict(verdicts)

    now = datetime.now(timezone.utc).isoformat()
    update_session_verdict(session_id, verdict, now, scope="full_claim")

    return VerifyResponse(session_id=session_id, verdicts=verdicts)


# ── stats ─────────────────────────────────────────────────────────────────────

@app.get("/stats")
def get_statistics():
    return get_stats()


# ── demo ──────────────────────────────────────────────────────────────────────

@app.post("/demo/run", response_model=DemoRunResponse)
def demo_run(mode: str = "normal"):
    if mode not in ("normal", "lying", "replit"):
        raise HTTPException(status_code=400, detail=f"Unknown mode: {mode}")

    ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    session_id = f"demo-{mode}-{ts}"
    receipts_stored: list[dict] = []

    if mode == "normal":
        write_input  = {"path": "/data/customer_42.json", "content": "updated address"}
        write_output = execute_tool("write_file", write_input)
        r1 = build_receipt(session_id, "write_file", write_input, write_output, "success")
        r1["tool_input"] = write_input; r1["tool_output"] = write_output
        insert_receipt(r1)
        upsert_session(session_id)
        receipts_stored.append(r1)

        fetch_input  = {"url": "https://email.service/send", "method": "POST"}
        fetch_output = execute_tool("http_fetch", fetch_input)
        r2 = build_receipt(session_id, "http_fetch", fetch_input, fetch_output, "success")
        r2["tool_input"] = fetch_input; r2["tool_output"] = fetch_output
        insert_receipt(r2)
        upsert_session(session_id)
        receipts_stored.append(r2)

        claimed = [
            ClaimedOutput(receipt_id=r1["id"], tool_name="write_file", output=write_output),
            ClaimedOutput(receipt_id=r2["id"], tool_name="http_fetch", output=fetch_output),
        ]

    elif mode == "lying":
        claimed = [
            ClaimedOutput(
                receipt_id=f"{session_id}-write-file",
                tool_name="write_file",
                output={"message": "file saved"},
            ),
            ClaimedOutput(
                receipt_id=f"{session_id}-http-fetch",
                tool_name="http_fetch",
                output={"message": "email sent"},
            ),
        ]

    else:  # replit
        db_input  = {"query": "DELETE FROM production_database", "params": []}
        db_output = execute_tool("db_query", db_input)
        r1 = build_receipt(session_id, "db_query", db_input, db_output, "success")
        r1["tool_input"] = db_input; r1["tool_output"] = db_output
        insert_receipt(r1)
        upsert_session(session_id)
        receipts_stored.append(r1)

        claimed = [
            ClaimedOutput(
                receipt_id=r1["id"],
                tool_name="write_file",
                output={"status": "written", "path": "test_cleanup.tmp", "bytes_written": 0},
            ),
        ]

    verify_req    = VerifyRequest(session_id=session_id, claimed_outputs=claimed)
    verify_result = verify(verify_req)

    verdicts      = verify_result.verdicts
    # demo_run derives its own verdict (never TAMPERED) so the response stays within
    # DemoRunResponse's VERIFIED/UNVERIFIED/CONTRADICTED literal.
    all_verified  = all(v.verified for v in verdicts)
    if all_verified:
        verdict = "VERIFIED"
    elif receipts_stored:
        verdict = "CONTRADICTED"
    else:
        verdict = "UNVERIFIED"

    now = datetime.now(timezone.utc).isoformat()
    update_session_verdict(session_id, verdict, now, scope="full_claim")

    return DemoRunResponse(
        session_id=session_id,
        mode=mode,
        receipts=[ReceiptResponse(**r) for r in receipts_stored],
        verify_result=verify_result,
        verdict=verdict,
    )
