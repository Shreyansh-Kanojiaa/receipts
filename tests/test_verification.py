import asyncio
import json
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
    from datetime import datetime, timezone
    from fastapi.testclient import TestClient
    import auth

    # Seed a proxy key directly (settings-based seeding is empty in tests).
    auth_key = "test-proxy-key"
    database.insert_api_key(
        id="k1", key_hash=auth.hash_key(auth_key), label="test",
        role="proxy", created_at=datetime.now(timezone.utc).isoformat(),
    )
    headers = {"Authorization": f"Bearer {auth_key}"}

    with TestClient(main.app) as client:
        resp = client.post(
            "/tools/call",
            json={
                "tool_name": "write_file",
                "tool_input": {"path": "/tmp/out.txt", "content": "hello"},
                "session_id": "session-close",
            },
            headers=headers,
        )
        assert resp.status_code == 201

        resp = client.post("/sessions/session-close/close", headers=headers)
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


def test_record_endpoint_signs_real_output(isolated_database):
    """The proxy path: /tools/record signs an already-executed call without running it."""
    from datetime import datetime, timezone
    from fastapi.testclient import TestClient
    import auth
    from signer import verify_receipt_signature

    database.insert_api_key(
        id="kp", key_hash=auth.hash_key("proxy-key"), label="t",
        role="proxy", created_at=datetime.now(timezone.utc).isoformat(),
    )
    with TestClient(main.app) as client:
        resp = client.post(
            "/tools/record",
            json={
                "session_id": "rec-sess",
                "tool_name": "github__create_issue",
                "tool_input": {"title": "bug"},
                "tool_output": {"number": 7, "url": "http://x/7"},
                "status": "success",
            },
            headers={"Authorization": "Bearer proxy-key"},
        )
    assert resp.status_code == 201
    receipt = resp.json()
    assert receipt["tool_name"] == "github__create_issue"
    assert receipt["tool_output"] == {"number": 7, "url": "http://x/7"}
    assert verify_receipt_signature(receipt)


def test_auth_required_and_role_enforced(isolated_database):
    from datetime import datetime, timezone
    from fastapi.testclient import TestClient
    import auth

    database.insert_api_key(
        id="kv", key_hash=auth.hash_key("viewer-key"), label="t",
        role="viewer", created_at=datetime.now(timezone.utc).isoformat(),
    )
    with TestClient(main.app) as client:
        # No key → 401
        assert client.get("/stats").status_code == 401
        # Invalid key → 401
        assert client.get(
            "/stats", headers={"Authorization": "Bearer nope"}
        ).status_code == 401
        # Viewer key on a read endpoint → 200
        assert client.get(
            "/stats", headers={"Authorization": "Bearer viewer-key"}
        ).status_code == 200
        # Viewer key on a write endpoint → 403
        resp = client.post(
            "/tools/record",
            json={
                "session_id": "s", "tool_name": "t",
                "tool_input": {}, "tool_output": {}, "status": "success",
            },
            headers={"Authorization": "Bearer viewer-key"},
        )
        assert resp.status_code == 403
        # Health endpoints need no auth
        assert client.get("/healthz").status_code == 200
        assert client.get("/readyz").status_code == 200


def test_readyz_returns_503_when_db_unavailable(isolated_database, monkeypatch):
    from fastapi.testclient import TestClient

    def broken_get_stats():
        raise RuntimeError("db down")

    monkeypatch.setattr(main, "get_stats", broken_get_stats)
    with TestClient(main.app) as client:
        resp = client.get("/readyz")
        assert resp.status_code == 503


def test_content_tamper_detected_when_hashes_untouched(isolated_database):
    """A direct edit to the raw tool_output blob, leaving input_hash/output_hash/
    hmac_signature untouched, must still be caught — the HMAC only covers the hash
    columns, not the raw payload (see signer.verify_receipt_content)."""
    receipt = call_write_file("session-content-tamper", "hello")

    with database.get_connection() as conn:
        conn.execute(
            "UPDATE receipts SET tool_output = ? WHERE id = ?",
            (json.dumps({"status": "written", "path": "/tmp/out.txt", "bytes_written": 999}), receipt["id"]),
        )
        conn.commit()

    # Signature-only sweep must flag it.
    verdict = asyncio.run(av.auto_verify("session-content-tamper"))
    assert verdict == "TAMPERED"

    # Full-claim verification must flag it too, even when the claim happens to
    # match the (tampered) stored content.
    tampered_claim = verify(
        "session-content-tamper", receipt["id"], "write_file",
        {"status": "written", "path": "/tmp/out.txt", "bytes_written": 999},
    )
    assert tampered_claim["signature_valid"] is False


def test_lying_demo_fires_alert_for_unmatched_receipt_id(isolated_database, monkeypatch):
    """Regression: an agent claiming a receipt_id that was never recorded must still
    trigger alerts for the resulting non-VERIFIED verdict, not just receipts that
    exist in the ledger. See main._receipt_for_alert."""
    from fastapi.testclient import TestClient
    import auth

    database.insert_api_key(
        id="kp-lying", key_hash=auth.hash_key("proxy-key-lying"), label="t",
        role="proxy", created_at=datetime.now(timezone.utc).isoformat(),
    )

    fired = []

    async def fake_fire_alerts(verdict, session_id, receipt):
        fired.append((verdict, session_id, receipt))

    monkeypatch.setattr(main, "fire_alerts", fake_fire_alerts)

    with TestClient(main.app) as client:
        resp = client.post(
            "/demo/run", params={"mode": "lying"},
            headers={"Authorization": "Bearer proxy-key-lying"},
        )
        assert resp.status_code == 200
        assert resp.json()["verdict"] == "UNVERIFIED"

    assert len(fired) == 2  # one per fabricated claimed_output
    for verdict, session_id, receipt in fired:
        assert verdict != "VERIFIED"
        assert receipt["hmac_signature"] is None  # synthetic fallback, not a real receipt


def test_demo_run_disabled_when_demo_tools_off(isolated_database, monkeypatch):
    monkeypatch.setattr(main.settings, "enable_demo_tools", False)
    from fastapi.testclient import TestClient
    import auth

    database.insert_api_key(
        id="kp-nodemo", key_hash=auth.hash_key("proxy-key-nodemo"), label="t",
        role="proxy", created_at=datetime.now(timezone.utc).isoformat(),
    )
    with TestClient(main.app) as client:
        resp = client.post(
            "/demo/run", params={"mode": "normal"},
            headers={"Authorization": "Bearer proxy-key-nodemo"},
        )
        assert resp.status_code == 404


def test_verify_claim_force_override(isolated_database):
    from fastapi.testclient import TestClient
    import auth

    database.insert_api_key(
        id="kp-vc", key_hash=auth.hash_key("proxy-key-vc"), label="t",
        role="proxy", created_at=datetime.now(timezone.utc).isoformat(),
    )
    headers = {"Authorization": "Bearer proxy-key-vc"}

    with TestClient(main.app) as client:
        rec = client.post(
            "/tools/call",
            json={
                "tool_name": "write_file",
                "tool_input": {"path": "/tmp/x", "content": "a"},
                "session_id": "vc-sess",
            },
            headers=headers,
        ).json()

        claimed = [{"receipt_id": rec["id"], "tool_name": "write_file", "output": {"bad": True}}]

        first = client.post(
            "/sessions/vc-sess/verify-claim",
            json={"session_id": "vc-sess", "claimed_outputs": claimed},
            headers=headers,
        )
        assert first.status_code == 200
        assert first.json()["verdicts"][0]["verified"] is False

        # Re-running without force returns the cached verdict, not a fresh VerifyResponse.
        second = client.post(
            "/sessions/vc-sess/verify-claim",
            json={"session_id": "vc-sess", "claimed_outputs": claimed},
            headers=headers,
        )
        assert second.status_code == 200
        assert second.json().get("already_verified") is True

        # force=true actually re-runs verification instead of returning the cache.
        third = client.post(
            "/sessions/vc-sess/verify-claim?force=true",
            json={"session_id": "vc-sess", "claimed_outputs": claimed},
            headers=headers,
        )
        assert third.status_code == 200
        assert "already_verified" not in third.json()
        assert third.json()["verdicts"][0]["verified"] is False


def test_rate_limit_enforced(isolated_database, monkeypatch):
    from fastapi.testclient import TestClient
    from slowapi import Limiter
    from slowapi.util import get_remote_address

    monkeypatch.setattr(
        main.app.state, "limiter",
        Limiter(key_func=get_remote_address, default_limits=["2/minute"]),
    )

    with TestClient(main.app) as client:
        assert client.get("/healthz").status_code == 200
        assert client.get("/healthz").status_code == 200
        assert client.get("/healthz").status_code == 429


def test_cors_respects_configured_origin_list(isolated_database):
    """Asserts the CORS behavior actually wired into main.app honors whatever
    cors_origin_list this environment resolves to (wildcard in dev, or a locked-down
    explicit list in production), rather than assuming one or the other."""
    from fastapi.testclient import TestClient

    allowed = main.settings.cors_origin_list
    with TestClient(main.app) as client:
        if allowed == ["*"]:
            resp = client.get("/healthz", headers={"Origin": "http://anything.example"})
            assert resp.headers.get("access-control-allow-origin") == "*"
        else:
            ok = client.get("/healthz", headers={"Origin": allowed[0]})
            assert ok.headers.get("access-control-allow-origin") == allowed[0]

            blocked = client.get("/healthz", headers={"Origin": "http://not-allowed.example"})
            assert blocked.headers.get("access-control-allow-origin") is None


def test_cors_origin_list_parses_wildcard_and_explicit_list():
    from settings import Settings

    assert Settings(cors_origins="*").cors_origin_list == ["*"]
    assert Settings(cors_origins="https://a.com, https://b.com").cors_origin_list == [
        "https://a.com", "https://b.com",
    ]


def test_environment_rejects_unknown_value():
    from settings import Settings

    with pytest.raises(ValidationError):
        Settings(environment="prod")


def test_api_key_revocation(isolated_database):
    from fastapi.testclient import TestClient
    import auth

    database.insert_api_key(
        id="k-admin", key_hash=auth.hash_key("admin-key"), label="admin",
        role="admin", created_at=datetime.now(timezone.utc).isoformat(),
    )
    database.insert_api_key(
        id="k-target", key_hash=auth.hash_key("target-key"), label="target",
        role="proxy", created_at=datetime.now(timezone.utc).isoformat(),
    )
    admin_headers  = {"Authorization": "Bearer admin-key"}
    target_headers = {"Authorization": "Bearer target-key"}

    with TestClient(main.app) as client:
        # Non-admin can't list or revoke keys.
        assert client.get("/api-keys", headers=target_headers).status_code == 403

        # The key still works before revocation.
        assert client.get("/stats", headers=target_headers).status_code == 200

        listed = client.get("/api-keys", headers=admin_headers)
        assert listed.status_code == 200
        assert any(k["id"] == "k-target" for k in listed.json())

        revoke = client.post("/api-keys/k-target/revoke", headers=admin_headers)
        assert revoke.status_code == 200
        assert revoke.json()["revoked"] is True

        # Revoking again 404s.
        assert client.post("/api-keys/k-target/revoke", headers=admin_headers).status_code == 404

        # The revoked key no longer authenticates.
        assert client.get("/stats", headers=target_headers).status_code == 401
