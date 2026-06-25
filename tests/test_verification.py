import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import time

import pytest
from pydantic import ValidationError


BACKEND_DIR = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND_DIR))

import database  # noqa: E402
import main  # noqa: E402
import auto_verify as av  # noqa: E402
from models import ClaimedOutput, ToolCallRequest, VerifyRequest  # noqa: E402


@pytest.fixture
def isolated_database(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "receipts.db")
    database.init_db()


def call_write_file(session_id, content):
    return main.call_tool(
        ToolCallRequest(
            session_id=session_id,
            tool_name="write_file",
            tool_input={"path": "/tmp/out.txt", "content": content},
        )
    )


def verify(session_id, receipt_id, tool_name, output):
    result = main.verify(
        VerifyRequest(
            session_id=session_id,
            claimed_outputs=[
                ClaimedOutput(
                    receipt_id=receipt_id,
                    tool_name=tool_name,
                    output=output,
                )
            ],
        )
    )
    return result.verdicts[0].model_dump()


def test_claimed_output_requires_receipt_id():
    with pytest.raises(ValidationError):
        ClaimedOutput(tool_name="write_file", output={})


def test_verifies_exact_receipt_for_repeated_tool_calls(isolated_database):
    first = call_write_file("session-1", "one")
    second = call_write_file("session-1", "two two")

    first_verdict = verify(
        "session-1",
        first["id"],
        "write_file",
        {"status": "written", "path": "/tmp/out.txt", "bytes_written": 3},
    )
    second_verdict = verify(
        "session-1",
        second["id"],
        "write_file",
        {"status": "written", "path": "/tmp/out.txt", "bytes_written": 7},
    )

    assert first_verdict["verified"] is True
    assert second_verdict["verified"] is True
    assert first_verdict["receipt_id"] == first["id"]
    assert second_verdict["receipt_id"] == second["id"]


def test_rejects_mismatched_output_and_tampered_signature(isolated_database):
    receipt = call_write_file("session-1", "hello")

    mismatched = verify(
        "session-1",
        receipt["id"],
        "write_file",
        {"status": "written", "path": "/tmp/out.txt", "bytes_written": 0},
    )
    assert mismatched["verified"] is False
    assert mismatched["signature_valid"] is True
    assert mismatched["reason"] == "output_hash_mismatch"

    with database.get_connection() as conn:
        conn.execute(
            "UPDATE receipts SET hmac_signature = ? WHERE id = ?",
            ("tampered", receipt["id"]),
        )
        conn.commit()

    tampered = verify(
        "session-1",
        receipt["id"],
        "write_file",
        {"status": "written", "path": "/tmp/out.txt", "bytes_written": 5},
    )
    assert tampered["verified"] is False
    assert tampered["signature_valid"] is False
    assert tampered["reason"] == "signature_invalid"


def test_rejects_missing_cross_session_and_tool_mismatched_receipts(isolated_database):
    receipt = call_write_file("session-1", "hello")

    missing = verify(
        "session-1",
        "missing-receipt",
        "write_file",
        {"status": "written", "path": "/tmp/out.txt", "bytes_written": 5},
    )
    assert missing["verified"] is False
    assert missing["signature_valid"] is None
    assert missing["reason"] == "receipt_not_found"

    cross_session = verify(
        "session-2",
        receipt["id"],
        "write_file",
        {"status": "written", "path": "/tmp/out.txt", "bytes_written": 5},
    )
    assert cross_session["reason"] == "receipt_not_found"

    tool_mismatch = verify(
        "session-1",
        receipt["id"],
        "db_query",
        {"status": "written", "path": "/tmp/out.txt", "bytes_written": 5},
    )
    assert tool_mismatch["verified"] is False
    assert tool_mismatch["signature_valid"] is True
    assert tool_mismatch["reason"] == "tool_name_mismatch"


@pytest.mark.parametrize(
    ("mode", "expected_verdict"),
    [
        ("normal", "VERIFIED"),
        ("lying", "UNVERIFIED"),
        ("replit", "CONTRADICTED"),
    ],
)
def test_demo_modes(isolated_database, mode, expected_verdict):
    result = main.demo_run(mode)

    assert result.verdict == expected_verdict
    for verdict in result.verify_result.verdicts:
        assert verdict.receipt_id
        assert verdict.signature_valid in (True, False, None)


# ── auto-verify tests ─────────────────────────────────────────────────────────

def test_auto_verify_verified(isolated_database):
    receipt = call_write_file("session-av", "hello")
    verdict = asyncio.run(av.auto_verify("session-av"))
    assert verdict == "VERIFIED"

    session = database.get_session("session-av")
    assert session is not None
    assert session["auto_verdict"] == "VERIFIED"
    assert session["status"] == "verified"
    assert session["verification_scope"] == "signature_only"


def test_auto_verify_tampered(isolated_database):
    receipt = call_write_file("session-tampered", "hello")

    with database.get_connection() as conn:
        conn.execute(
            "UPDATE receipts SET hmac_signature = 'bad-sig' WHERE id = ?",
            (receipt["id"],),
        )
        conn.commit()

    verdict = asyncio.run(av.auto_verify("session-tampered"))
    assert verdict == "TAMPERED"

    session = database.get_session("session-tampered")
    assert session["auto_verdict"] == "TAMPERED"
    assert session["verification_scope"] == "signature_only"


def test_auto_verify_empty_session(isolated_database):
    # Create a session entry with no receipts — auto_verify should defer (return None)
    database.upsert_session("session-empty")

    verdict = asyncio.run(av.auto_verify("session-empty"))
    assert verdict is None  # no receipts → no verdict, deferred to manual reconciliation

    session = database.get_session("session-empty")
    assert session["auto_verdict"] is None
    assert session["status"] == "closed"  # marked closed but not 'verified'


def test_session_timeout_detection(isolated_database):
    call_write_file("session-old", "data")

    # Backdate last_activity to 60 seconds ago
    old_time = (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()
    with database.get_connection() as conn:
        conn.execute(
            "UPDATE sessions SET last_activity = ? WHERE session_id = ?",
            (old_time, "session-old"),
        )
        conn.commit()

    stale = database.get_open_sessions_older_than(30)
    assert any(s["session_id"] == "session-old" for s in stale)

    # A recently active session must NOT appear
    call_write_file("session-new", "data")
    stale2 = database.get_open_sessions_older_than(30)
    assert not any(s["session_id"] == "session-new" for s in stale2)


def test_explicit_close_endpoint(isolated_database):
    from fastapi.testclient import TestClient

    with TestClient(main.app) as client:
        resp = client.post(
            "/tools/call",
            json={
                "tool_name": "write_file",
                "tool_input": {"path": "/tmp/out.txt", "content": "hello"},
                "session_id": "session-close",
            },
        )
        assert resp.status_code == 201

        resp = client.post("/sessions/session-close/close")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "closed"
        assert data["auto_verify_scheduled"] is True
        assert data["receipt_count"] == 1

    # Background task runs before TestClient context exits
    session = database.get_session("session-close")
    assert session is not None
    assert session["status"] == "verified"
    assert session["auto_verdict"] == "VERIFIED"
