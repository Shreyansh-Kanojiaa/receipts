import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
import sys

import httpx
import pytest


BACKEND_DIR = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND_DIR))

import database  # noqa: E402
import main  # noqa: E402
import alerts  # noqa: E402
import auth  # noqa: E402


@pytest.fixture
def isolated_database(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "receipts.db")
    database.init_db()


def _fake_async_client(handler):
    """Monkeypatch target for alerts.httpx.AsyncClient that forces a MockTransport,
    mirroring the pattern used in tests/test_proxy.py for the real backend."""
    transport = httpx.MockTransport(handler)

    class FakeAsyncClient(httpx.AsyncClient):
        def __init__(self, *args, **kwargs):
            kwargs["transport"] = transport
            super().__init__(*args, **kwargs)

    return FakeAsyncClient


FAKE_RECEIPT = {
    "id": "r1",
    "tool_name": "write_file",
    "timestamp": "2026-01-01T00:00:00+00:00",
    "input_hash": "a" * 64,
    "output_hash": "b" * 64,
    "hmac_signature": "c" * 64,
}


def test_send_webhook_posts_expected_payload(monkeypatch):
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content)
        return httpx.Response(200)

    monkeypatch.setattr(alerts.httpx, "AsyncClient", _fake_async_client(handler))

    asyncio.run(alerts.send_webhook(
        {"id": "rule-1"}, {"url": "http://example.test/hook"}, "TAMPERED", "sess-1", FAKE_RECEIPT,
    ))

    assert captured["url"] == "http://example.test/hook"
    assert captured["body"] == alerts.build_alert_payload("TAMPERED", "sess-1", FAKE_RECEIPT)


def test_send_webhook_raises_on_http_error(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    monkeypatch.setattr(alerts.httpx, "AsyncClient", _fake_async_client(handler))

    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(alerts.send_webhook(
            {"id": "rule-1"}, {"url": "http://example.test/hook"}, "TAMPERED", "sess-1", FAKE_RECEIPT,
        ))


def test_send_slack_posts_expected_payload(monkeypatch):
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(200)

    monkeypatch.setattr(alerts.httpx, "AsyncClient", _fake_async_client(handler))

    asyncio.run(alerts.send_slack(
        {"id": "rule-1"}, {"webhook_url": "http://example.test/slack"}, "CONTRADICTED", "sess-2", FAKE_RECEIPT,
    ))

    assert "CONTRADICTED" in captured["body"]["text"]
    assert "sess-2" in captured["body"]["blocks"][0]["text"]["text"]


def test_send_email_uses_ipv4_and_delivers(monkeypatch):
    sent = {}

    class FakeSMTP:
        def __init__(self, host, port, timeout=None):
            sent["host"] = host
            sent["port"] = port

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def starttls(self):
            sent["starttls"] = True

        def login(self, user, password):
            sent["login"] = (user, password)

        def send_message(self, msg):
            sent["subject"] = msg["Subject"]

    monkeypatch.setattr(alerts.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(
        alerts.socket, "getaddrinfo",
        lambda host, port, *a, **kw: [(None, None, None, None, ("127.0.0.1", port))],
    )

    config = {
        "smtp_host": "smtp.example.test", "smtp_port": 587,
        "smtp_user": "bot@example.test", "smtp_pass": "secret",
        "to": "oncall@example.test",
    }
    asyncio.run(alerts.send_email({"id": "rule-1"}, config, "UNVERIFIED", "sess-3", FAKE_RECEIPT))

    assert sent["host"] == "127.0.0.1"
    assert sent["starttls"] is True
    assert sent["login"] == ("bot@example.test", "secret")
    assert "UNVERIFIED" in sent["subject"]


def test_fire_alerts_continues_after_one_rule_fails(isolated_database, monkeypatch):
    good_rule = database.create_alert_rule(
        name="good", trigger="TAMPERED", channel="webhook",
        config=json.dumps({"url": "http://good.test/hook"}),
    )
    bad_rule = database.create_alert_rule(
        name="bad", trigger="TAMPERED", channel="webhook",
        config=json.dumps({"url": "http://bad.test/hook"}),
    )

    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        if "bad.test" in str(request.url):
            return httpx.Response(500)
        return httpx.Response(200)

    monkeypatch.setattr(alerts.httpx, "AsyncClient", _fake_async_client(handler))

    # Must not raise even though one of the two rules fails delivery.
    asyncio.run(alerts.fire_alerts("TAMPERED", "sess-4", FAKE_RECEIPT))

    assert any("good.test" in c for c in calls)
    assert any("bad.test" in c for c in calls)


def _sent_deliveries(rule_id):
    with database.get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM alert_deliveries WHERE rule_id = ?", (rule_id,)
        ).fetchall()
    return [dict(r) for r in rows]


def test_fire_alerts_retries_once_before_recording_failure(isolated_database, monkeypatch):
    monkeypatch.setattr(alerts, "_RETRY_DELAY_SECONDS", 0)
    rule = database.create_alert_rule(
        name="flaky", trigger="TAMPERED", channel="webhook",
        config=json.dumps({"url": "http://flaky.test/hook"}),
    )

    attempts = []

    def handler(request: httpx.Request) -> httpx.Response:
        attempts.append(1)
        if len(attempts) == 1:
            return httpx.Response(500)
        return httpx.Response(200)

    monkeypatch.setattr(alerts.httpx, "AsyncClient", _fake_async_client(handler))
    asyncio.run(alerts.fire_alerts("TAMPERED", "sess-retry", FAKE_RECEIPT))

    assert len(attempts) == 2  # failed once, succeeded on retry
    deliveries = _sent_deliveries(rule["id"])
    assert len(deliveries) == 1
    assert deliveries[0]["status"] == "sent"


def test_fire_alerts_records_failure_after_exhausting_retry(isolated_database, monkeypatch):
    monkeypatch.setattr(alerts, "_RETRY_DELAY_SECONDS", 0)
    rule = database.create_alert_rule(
        name="always-down", trigger="TAMPERED", channel="webhook",
        config=json.dumps({"url": "http://down.test/hook"}),
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    monkeypatch.setattr(alerts.httpx, "AsyncClient", _fake_async_client(handler))
    asyncio.run(alerts.fire_alerts("TAMPERED", "sess-down", FAKE_RECEIPT))

    deliveries = _sent_deliveries(rule["id"])
    assert len(deliveries) == 1
    assert deliveries[0]["status"] == "failed"
    assert deliveries[0]["error"]


def test_fire_alerts_dedups_repeated_event(isolated_database, monkeypatch):
    """The same (rule, session, receipt, verdict) event can reach fire_alerts from
    multiple verification paths (auto_verify, /verify, /verify-claim) — it must only
    ever be delivered once."""
    rule = database.create_alert_rule(
        name="dedup", trigger="TAMPERED", channel="webhook",
        config=json.dumps({"url": "http://dedup.test/hook"}),
    )

    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(200)

    monkeypatch.setattr(alerts.httpx, "AsyncClient", _fake_async_client(handler))

    asyncio.run(alerts.fire_alerts("TAMPERED", "sess-dedup", FAKE_RECEIPT))
    asyncio.run(alerts.fire_alerts("TAMPERED", "sess-dedup", FAKE_RECEIPT))

    assert len(calls) == 1  # second call is a no-op due to dedup
    assert len(_sent_deliveries(rule["id"])) == 1


# ── /alerts CRUD routes ────────────────────────────────────────────────────────

def _proxy_headers(key="proxy-key"):
    database.insert_api_key(
        id=f"kp-{key}", key_hash=auth.hash_key(key), label="t",
        role="proxy", created_at=datetime.now(timezone.utc).isoformat(),
    )
    return {"Authorization": f"Bearer {key}"}


def _viewer_headers(key="viewer-key"):
    database.insert_api_key(
        id=f"kv-{key}", key_hash=auth.hash_key(key), label="t",
        role="viewer", created_at=datetime.now(timezone.utc).isoformat(),
    )
    return {"Authorization": f"Bearer {key}"}


def test_create_alert_rejects_incomplete_webhook_config(isolated_database):
    from fastapi.testclient import TestClient
    headers = _proxy_headers()
    with TestClient(main.app) as client:
        resp = client.post(
            "/alerts",
            json={"name": "r", "trigger": "ANY", "channel": "webhook", "config": {}},
            headers=headers,
        )
    assert resp.status_code == 422


def test_create_alert_success_and_viewer_sees_redacted_config(isolated_database):
    from fastapi.testclient import TestClient
    proxy_headers = _proxy_headers("proxy-a")
    viewer_headers = _viewer_headers("viewer-a")

    with TestClient(main.app) as client:
        created = client.post(
            "/alerts",
            json={
                "name": "email-rule", "trigger": "ANY", "channel": "email",
                "config": {
                    "smtp_host": "smtp.test", "smtp_port": 587,
                    "smtp_user": "bot@test", "smtp_pass": "topsecret",
                    "to": "oncall@test",
                },
            },
            headers=proxy_headers,
        )
        assert created.status_code == 201
        rule_id = created.json()["id"]
        # The proxy-role creator gets the real config back.
        assert created.json()["config"]["smtp_pass"] == "topsecret"

        listed = client.get("/alerts", headers=viewer_headers)
        assert listed.status_code == 200
        rule = next(r for r in listed.json() if r["id"] == rule_id)
        assert rule["config"]["smtp_pass"] != "topsecret"

        got = client.get(f"/alerts/{rule_id}", headers=viewer_headers)
        assert got.json()["config"]["smtp_pass"] != "topsecret"


def test_update_alert_validates_config_on_channel_change(isolated_database):
    from fastapi.testclient import TestClient
    headers = _proxy_headers("proxy-b")
    with TestClient(main.app) as client:
        created = client.post(
            "/alerts",
            json={"name": "r", "trigger": "ANY", "channel": "webhook", "config": {"url": "http://x.test"}},
            headers=headers,
        ).json()

        # Flip to slack without providing webhook_url — must be rejected.
        resp = client.patch(f"/alerts/{created['id']}", json={"channel": "slack"}, headers=headers)
        assert resp.status_code == 422


def test_delete_alert_then_404(isolated_database):
    from fastapi.testclient import TestClient
    headers = _proxy_headers("proxy-c")
    with TestClient(main.app) as client:
        created = client.post(
            "/alerts",
            json={"name": "r", "trigger": "ANY", "channel": "webhook", "config": {"url": "http://x.test"}},
            headers=headers,
        ).json()
        assert client.delete(f"/alerts/{created['id']}", headers=headers).status_code == 204
        assert client.delete(f"/alerts/{created['id']}", headers=headers).status_code == 404
