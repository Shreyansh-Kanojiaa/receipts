from contextlib import asynccontextmanager
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from models import (
    ClaimedOutput,
    DemoRunResponse,
    ReceiptResponse,
    ToolCallRequest,
    VerifyRequest,
    VerifyResponse,
    VerifyVerdict,
)
from database import (
    init_db, insert_receipt, get_receipts_for_session,
    get_latest_receipt_for_tool, get_all_receipts, get_stats,
)
from tools import execute_tool
from signer import build_receipt, compute_claimed_hash


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Receipts AI", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/tools/call", response_model=ReceiptResponse, status_code=201)
def call_tool(req: ToolCallRequest):
    try:
        output = execute_tool(req.tool_name, req.tool_input)
        status = "success"
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown tool: {req.tool_name}")
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
    insert_receipt(receipt)
    return receipt


@app.get("/receipts/all", response_model=list[ReceiptResponse])
def list_all_receipts(limit: int = 50):
    return get_all_receipts(limit)


@app.get("/stats")
def get_statistics():
    return get_stats()


@app.get("/receipts/{session_id}", response_model=list[ReceiptResponse])
def list_receipts(session_id: str):
    return get_receipts_for_session(session_id)


@app.post("/verify", response_model=VerifyResponse)
def verify(req: VerifyRequest):
    verdicts: list[VerifyVerdict] = []

    for claimed in req.claimed_outputs:
        claimed_hash = compute_claimed_hash(claimed.output)
        stored = get_latest_receipt_for_tool(req.session_id, claimed.tool_name)

        if stored is None:
            verdicts.append(VerifyVerdict(
                tool_name=claimed.tool_name,
                verified=False,
                claimed_hash=claimed_hash,
                actual_hash=None,
            ))
        else:
            actual_hash = stored["output_hash"]
            verdicts.append(VerifyVerdict(
                tool_name=claimed.tool_name,
                verified=(claimed_hash == actual_hash),
                claimed_hash=claimed_hash,
                actual_hash=actual_hash,
            ))

    return VerifyResponse(session_id=req.session_id, verdicts=verdicts)


@app.post("/demo/run", response_model=DemoRunResponse)
def demo_run(mode: str = "normal"):
    if mode not in ("normal", "lying", "replit"):
        raise HTTPException(status_code=400, detail=f"Unknown mode: {mode}")

    ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    session_id = f"demo-{mode}-{ts}"
    receipts_stored: list[dict] = []

    if mode == "normal":
        write_input = {"path": "/data/customer_42.json", "content": "updated address"}
        write_output = execute_tool("write_file", write_input)
        r1 = build_receipt(session_id, "write_file", write_input, write_output, "success")
        insert_receipt(r1)
        receipts_stored.append(r1)

        fetch_input = {"url": "https://email.service/send", "method": "POST"}
        fetch_output = execute_tool("http_fetch", fetch_input)
        r2 = build_receipt(session_id, "http_fetch", fetch_input, fetch_output, "success")
        insert_receipt(r2)
        receipts_stored.append(r2)

        claimed = [
            ClaimedOutput(tool_name="write_file", output=write_output),
            ClaimedOutput(tool_name="http_fetch", output=fetch_output),
        ]

    elif mode == "lying":
        claimed = [
            ClaimedOutput(tool_name="write_file", output={"message": "file saved"}),
            ClaimedOutput(tool_name="http_fetch", output={"message": "email sent"}),
        ]

    else:  # replit
        db_input = {"query": "DELETE FROM production_database", "params": []}
        db_output = execute_tool("db_query", db_input)
        r1 = build_receipt(session_id, "db_query", db_input, db_output, "success")
        insert_receipt(r1)
        receipts_stored.append(r1)

        claimed = [
            ClaimedOutput(
                tool_name="write_file",
                output={"status": "written", "path": "test_cleanup.tmp", "bytes_written": 0},
            ),
        ]

    verify_result = verify(VerifyRequest(session_id=session_id, claimed_outputs=claimed))

    all_verified = all(v.verified for v in verify_result.verdicts)
    if all_verified:
        verdict = "VERIFIED"
    elif receipts_stored:
        verdict = "CONTRADICTED"
    else:
        verdict = "UNVERIFIED"

    return DemoRunResponse(
        session_id=session_id,
        mode=mode,
        receipts=[ReceiptResponse(**r) for r in receipts_stored],
        verify_result=verify_result,
        verdict=verdict,
    )
