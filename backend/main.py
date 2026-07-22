import asyncio
import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from models import (
    AlertRuleCreate,
    AlertRuleResponse,
    AlertRuleUpdate,
    ApiKeyCreateRequest,
    ApiKeyCreateResponse,
    ApiKeyResponse,
    ClaimedOutput,
    CloseSessionResponse,
    DemoRunResponse,
    ReceiptResponse,
    RevokeApiKeyResponse,
    SessionResponse,
    ToolCallRequest,
    ToolRecordRequest,
    VerifyRequest,
    VerifyResponse,
    WhoamiResponse,
)
from database import (
    create_alert_rule,
    delete_alert_rule,
    get_alert_rule,
    get_alert_rules,
    init_db,
    insert_receipt,
    get_receipts_for_session,
    get_receipt_for_session,
    get_all_receipts,
    get_stats,
    get_all_sessions,
    get_session,
    list_api_keys,
    revoke_api_key,
    update_alert_rule,
    upsert_session,
    create_empty_session,
    close_session,
    get_open_sessions_older_than,
    update_session_verdict,
)
from tools import execute_tool, TOOL_REGISTRY
from signer import build_receipt
from verifier import run_verify, derive_verdict
from auto_verify import auto_verify
from alerts import fire_alerts, build_alert_payload
from auth import require_viewer, require_proxy, require_admin, seed_api_keys, create_api_key
from settings import get_settings
from logging_config import configure_logging, get_logger

settings = get_settings()
configure_logging(level=settings.log_level, json_output=settings.log_json)
logger = get_logger("receipts.api")


async def timeout_checker_loop() -> None:
    while True:
        await asyncio.sleep(settings.checker_interval_seconds)
        try:
            stale = get_open_sessions_older_than(settings.inactivity_timeout_seconds)
            for session in stale:
                sid = session["session_id"]
                row = close_session(sid)
                count = row["receipt_count"] if row else None
                logger.info(
                    "session closed (timeout)",
                    extra={"session_id": sid, "receipt_count": count},
                )
                await auto_verify(sid)
        except Exception:
            logger.exception("timeout checker error")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not settings.is_production and not settings.receipt_secret:
        logger.warning(
            "RECEIPT_SECRET is unset — using the insecure dev signing key. "
            "Never run outside local development without it."
        )
    init_db()
    seed_api_keys()
    logger.info("receipts backend started", extra={"environment": settings.environment})
    task = asyncio.create_task(timeout_checker_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Receipts", version="0.1.0", lifespan=lifespan)

# Rate limiting: a global per-client-IP default applied via middleware (no per-route
# decorators, so route signatures stay clean and unit-callable).
limiter = Limiter(key_func=get_remote_address, default_limits=[settings.rate_limit])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── health ─────────────────────────────────────────────────────────────────────

@app.get("/healthz")
def healthz():
    """Liveness: the process is up. Always 200, no auth."""
    return {"status": "ok"}


@app.get("/readyz")
def readyz():
    """Readiness: dependencies (DB) are reachable. No auth."""
    try:
        get_stats()
    except Exception:
        raise HTTPException(status_code=503, detail="database unavailable")
    return {"status": "ready"}


# ── receipt persistence (shared) ───────────────────────────────────────────────

def _persist_receipt(
    session_id: str,
    tool_name: str,
    tool_input: dict,
    tool_output: dict,
    status: str,
) -> dict:
    """Sign, store, and attach a receipt to its session. No tool execution here."""
    receipt = build_receipt(
        session_id=session_id,
        tool_name=tool_name,
        tool_input=tool_input,
        tool_output=tool_output,
        status=status,
    )
    receipt["tool_input"]  = tool_input
    receipt["tool_output"] = tool_output
    insert_receipt(receipt)

    is_new = upsert_session(session_id)
    if is_new:
        logger.info("session opened", extra={"session_id": session_id})
    logger.info(
        "receipt recorded",
        extra={"session_id": session_id, "tool_name": tool_name, "status": status},
    )
    return receipt


# ── tool calls ────────────────────────────────────────────────────────────────

@app.post("/tools/record", response_model=ReceiptResponse, status_code=201)
def record_tool(req: ToolRecordRequest, _auth: dict = Depends(require_proxy)):
    """Receipt an already-executed tool call (the MCP proxy path).

    The upstream MCP server has already run the tool; we only sign and store the
    real input/output. This is the production entry point — execution lives at the
    edge (the proxy), receipting lives here.
    """
    return _persist_receipt(
        session_id=req.session_id,
        tool_name=req.tool_name,
        tool_input=req.tool_input,
        tool_output=req.tool_output,
        status=req.status,
    )


@app.post("/tools/call", response_model=ReceiptResponse, status_code=201)
def call_tool(req: ToolCallRequest, _auth: dict = Depends(require_proxy)):
    """Execute a built-in mock tool and receipt it (demo only).

    Disabled in production unless ENABLE_DEMO_TOOLS=true. Real deployments use the
    MCP proxy + /tools/record instead.
    """
    if not settings.enable_demo_tools:
        raise HTTPException(status_code=404, detail="Demo tools are disabled")
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

    return _persist_receipt(
        session_id=req.session_id,
        tool_name=req.tool_name,
        tool_input=req.tool_input,
        tool_output=output,
        status=status,
    )


# ── receipts ──────────────────────────────────────────────────────────────────

@app.get("/receipts/all", response_model=list[ReceiptResponse])
def list_all_receipts(limit: int = 50, _auth: dict = Depends(require_viewer)):
    return get_all_receipts(limit)


@app.get("/receipts/{session_id}", response_model=list[ReceiptResponse])
def list_receipts(session_id: str, _auth: dict = Depends(require_viewer)):
    return get_receipts_for_session(session_id)


# ── verify ────────────────────────────────────────────────────────────────────

@app.post("/verify", response_model=VerifyResponse)
def verify(req: VerifyRequest, background_tasks: BackgroundTasks = None, _auth: dict = Depends(require_proxy)):
    verdicts = run_verify(req.session_id, req.claimed_outputs)
    if background_tasks:
        for v_obj in verdicts:
            r_verdict = _verdict_str(v_obj)
            if r_verdict != "VERIFIED":
                receipt = _receipt_for_alert(v_obj.receipt_id, req.session_id, v_obj.tool_name, v_obj)
                background_tasks.add_task(fire_alerts, r_verdict, req.session_id, receipt)
    return VerifyResponse(session_id=req.session_id, verdicts=verdicts)


# ── sessions ──────────────────────────────────────────────────────────────────

@app.get("/sessions", response_model=list[SessionResponse])
def list_sessions(limit: int = 50, _auth: dict = Depends(require_viewer)):
    return get_all_sessions(limit)


@app.post("/sessions/{session_id}")
def create_session_endpoint(session_id: str, _auth: dict = Depends(require_proxy)):
    """Create an empty session with no receipts. Used by agents that may not call any tools."""
    created = create_empty_session(session_id)
    return {"session_id": session_id, "created": created}


@app.get("/sessions/{session_id}", response_model=SessionResponse)
def get_session_detail(session_id: str, _auth: dict = Depends(require_viewer)):
    session = get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")
    return session


@app.post("/sessions/{session_id}/close", response_model=CloseSessionResponse)
async def close_session_endpoint(
    session_id: str,
    background_tasks: BackgroundTasks,
    _auth: dict = Depends(require_proxy),
):
    row = close_session(session_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")
    count = row["receipt_count"]
    logger.info(
        "session closed (explicit)",
        extra={"session_id": session_id, "receipt_count": count},
    )
    background_tasks.add_task(auto_verify, session_id)
    return CloseSessionResponse(
        session_id=session_id,
        status="closed",
        receipt_count=count,
        auto_verify_scheduled=True,
    )


@app.post("/sessions/{session_id}/verify-claim")
def verify_claim(
    session_id: str,
    req: VerifyRequest,
    background_tasks: BackgroundTasks,
    force: bool = False,
    _auth: dict = Depends(require_proxy),
):
    """Full-claim reconciliation: verify agent claimed_outputs against stored receipts.

    Updates the session verdict with scope='full_claim' so the frontend can distinguish
    this from a signature-only auto-verify result.

    Guard: if the session already carries a full_claim verdict, re-running here would
    re-verify the stored receipts against themselves (the caller has no copy of the
    original agent claim), which always collapses to VERIFIED — silently destroying a
    CONTRADICTED verdict from demo_run. So unless ?force=true is passed, return the
    verdict already on record and let the caller decide whether to force a re-run.
    """
    session = get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")

    if not force and session.get("verification_scope") == "full_claim" and session.get("auto_verdict"):
        return {
            "already_verified": True,
            "verdict": session["auto_verdict"],
            "verification_scope": "full_claim",
            "message": "Session already has full claim verification on record",
        }

    verdicts = run_verify(session_id, req.claimed_outputs)
    verdict  = derive_verdict(verdicts)

    now = datetime.now(timezone.utc).isoformat()
    verdicts_json = json.dumps([v.model_dump() for v in verdicts])
    update_session_verdict(session_id, verdict, now, scope="full_claim", verdicts_json=verdicts_json)

    for v_obj in verdicts:
        r_verdict = _verdict_str(v_obj)
        if r_verdict != "VERIFIED":
            receipt = _receipt_for_alert(v_obj.receipt_id, session_id, v_obj.tool_name, v_obj)
            background_tasks.add_task(fire_alerts, r_verdict, session_id, receipt)

    return VerifyResponse(session_id=session_id, verdicts=verdicts)


# ── alerts ────────────────────────────────────────────────────────────────────

def _deserialize_rule(rule: dict) -> dict:
    if isinstance(rule.get("config"), str):
        rule["config"] = json.loads(rule["config"])
    rule["enabled"] = bool(rule["enabled"])
    return rule


def _redact_config(channel: str, config: dict) -> dict:
    """Mask channel secrets before returning a rule to a viewer-role caller."""
    redacted = dict(config)
    if channel == "email":
        if "smtp_pass" in redacted:
            redacted["smtp_pass"] = "••••••••"
        if "smtp_user" in redacted:
            redacted["smtp_user"] = "••••••••"
    elif channel == "webhook" and "url" in redacted:
        redacted["url"] = _mask_url(redacted["url"])
    elif channel == "slack" and "webhook_url" in redacted:
        redacted["webhook_url"] = _mask_url(redacted["webhook_url"])
    return redacted


def _mask_url(url: str) -> str:
    from urllib.parse import urlparse
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}/••••••••"


def _redact_rule(rule: dict) -> dict:
    rule = dict(rule)
    rule["config"] = _redact_config(rule["channel"], rule["config"])
    return rule


def _verdict_str(v) -> str:
    """Map a VerifyVerdict object to its string verdict."""
    if v is None:
        return "UNVERIFIED"
    if v.signature_valid is False:
        return "TAMPERED"
    if v.verified:
        return "VERIFIED"
    return "CONTRADICTED"


def _receipt_for_alert(receipt_id: str, session_id: str, tool_name: str, v_obj) -> dict:
    """Look up the stored receipt for an alert, falling back to a synthetic one.

    An agent can claim a receipt_id that was never recorded (the "lying agent"
    case this product exists to catch) — get_receipt_for_session then returns
    None. Alerts must still fire for that verdict, so build a minimal stand-in
    from the verdict itself rather than skipping delivery.
    """
    receipt = get_receipt_for_session(receipt_id, session_id)
    if receipt:
        return receipt
    return {
        "id": receipt_id,
        "tool_name": tool_name,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "input_hash": None,
        "output_hash": v_obj.claimed_hash if v_obj else None,
        "hmac_signature": None,
    }


_REQUIRED_ALERT_CONFIG_KEYS = {
    "webhook": ["url"],
    "email":   ["smtp_host", "smtp_port", "smtp_user", "smtp_pass", "to"],
    "slack":   ["webhook_url"],
}


def _validate_alert_config(channel: str, config: dict) -> None:
    missing = [k for k in _REQUIRED_ALERT_CONFIG_KEYS[channel] if not config.get(k)]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"channel '{channel}' config is missing required key(s): {', '.join(missing)}",
        )


@app.get("/alerts", response_model=list[AlertRuleResponse])
def list_alerts(_auth: dict = Depends(require_viewer)):
    return [_redact_rule(_deserialize_rule(r)) for r in get_alert_rules()]


@app.post("/alerts", response_model=AlertRuleResponse, status_code=201)
def create_alert(req: AlertRuleCreate, _auth: dict = Depends(require_proxy)):
    _validate_alert_config(req.channel, req.config)
    rule = create_alert_rule(
        name=req.name,
        trigger=req.trigger,
        channel=req.channel,
        config=json.dumps(req.config),
    )
    return _deserialize_rule(rule)


@app.get("/alerts/{rule_id}", response_model=AlertRuleResponse)
def get_alert(rule_id: str, _auth: dict = Depends(require_viewer)):
    rule = get_alert_rule(rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail=f"Alert rule not found: {rule_id}")
    return _redact_rule(_deserialize_rule(rule))


@app.patch("/alerts/{rule_id}", response_model=AlertRuleResponse)
def update_alert(rule_id: str, req: AlertRuleUpdate, _auth: dict = Depends(require_proxy)):
    rule = get_alert_rule(rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail=f"Alert rule not found: {rule_id}")

    effective_channel = req.channel if req.channel is not None else rule["channel"]
    effective_config  = req.config if req.config is not None else json.loads(rule["config"])
    if req.channel is not None or req.config is not None:
        _validate_alert_config(effective_channel, effective_config)

    kwargs = {}
    if req.name is not None:
        kwargs["name"] = req.name
    if req.enabled is not None:
        kwargs["enabled"] = 1 if req.enabled else 0
    if req.trigger is not None:
        kwargs["trigger"] = req.trigger
    if req.channel is not None:
        kwargs["channel"] = req.channel
    if req.config is not None:
        kwargs["config"] = json.dumps(req.config)
    updated = update_alert_rule(rule_id, **kwargs)
    return _deserialize_rule(updated)


@app.delete("/alerts/{rule_id}", status_code=204)
def delete_alert(rule_id: str, _auth: dict = Depends(require_proxy)):
    if not delete_alert_rule(rule_id):
        raise HTTPException(status_code=404, detail=f"Alert rule not found: {rule_id}")


@app.post("/alerts/{rule_id}/test")
async def test_alert(rule_id: str, _auth: dict = Depends(require_proxy)):
    rule = get_alert_rule(rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail=f"Alert rule not found: {rule_id}")
    fake_receipt = {
        "id": "test-receipt-00000000",
        "tool_name": "test_tool",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "input_hash": "0" * 64,
        "output_hash": "0" * 64,
        "hmac_signature": "0" * 64,
    }
    try:
        rule_copy = dict(rule)
        rule_copy["enabled"] = 1
        config = json.loads(rule_copy["config"])
        from alerts import send_webhook, send_email, send_slack
        verdict = rule_copy["trigger"] if rule_copy["trigger"] != "ANY" else "CONTRADICTED"
        if rule_copy["channel"] == "webhook":
            await send_webhook(rule_copy, config, verdict, "test-session", fake_receipt)
        elif rule_copy["channel"] == "email":
            await send_email(rule_copy, config, verdict, "test-session", fake_receipt)
        elif rule_copy["channel"] == "slack":
            await send_slack(rule_copy, config, verdict, "test-session", fake_receipt)
        return {"sent": True}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Alert delivery failed: {e}")


# ── api keys ──────────────────────────────────────────────────────────────────

@app.get("/api-keys", response_model=list[ApiKeyResponse])
def list_keys(_auth: dict = Depends(require_admin)):
    return list_api_keys()


@app.post("/api-keys", response_model=ApiKeyCreateResponse, status_code=201)
def create_key(req: ApiKeyCreateRequest, _auth: dict = Depends(require_admin)):
    return create_api_key(label=req.label, role=req.role)


@app.post("/api-keys/{key_id}/revoke", response_model=RevokeApiKeyResponse)
def revoke_key(key_id: str, _auth: dict = Depends(require_admin)):
    revoked = revoke_api_key(key_id)
    if not revoked:
        raise HTTPException(status_code=404, detail=f"API key not found or already revoked: {key_id}")
    return RevokeApiKeyResponse(id=key_id, revoked=True)


@app.get("/whoami", response_model=WhoamiResponse)
def whoami(_auth: dict = Depends(require_viewer)):
    return WhoamiResponse(id=_auth["id"], label=_auth["label"], role=_auth["role"])


# ── stats ─────────────────────────────────────────────────────────────────────

@app.get("/stats")
def get_statistics(_auth: dict = Depends(require_viewer)):
    return get_stats()


# ── demo ──────────────────────────────────────────────────────────────────────

@app.post("/demo/run", response_model=DemoRunResponse)
def demo_run(mode: str = "normal", background_tasks: BackgroundTasks = None, _auth: dict = Depends(require_proxy)):
    if not settings.enable_demo_tools:
        raise HTTPException(status_code=404, detail="Demo tools are disabled")
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
        create_empty_session(session_id)
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
    verdicts_json = json.dumps([v.model_dump() for v in verdicts])
    update_session_verdict(session_id, verdict, now, scope="full_claim", verdicts_json=verdicts_json)

    if background_tasks:
        for v_obj in verdicts:
            r_verdict = _verdict_str(v_obj)
            if r_verdict != "VERIFIED":
                receipt = _receipt_for_alert(v_obj.receipt_id, session_id, v_obj.tool_name, v_obj)
                background_tasks.add_task(fire_alerts, r_verdict, session_id, receipt)

    return DemoRunResponse(
        session_id=session_id,
        mode=mode,
        receipts=[ReceiptResponse(**r) for r in receipts_stored],
        verify_result=verify_result,
        verdict=verdict,
    )
