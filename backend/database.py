import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from settings import get_settings


def _resolve_db_path() -> Path:
    """Parse the sqlite:/// URL from settings into a filesystem path.

    Only the sqlite form is supported today; a future Postgres DSN would branch here.
    Relative URLs resolve against the backend/ directory so the default matches the
    historical ``backend/receipts.db`` location.
    """
    url = get_settings().database_url
    if url.startswith("sqlite:///"):
        raw = url[len("sqlite:///"):]
        path = Path(raw)
        if not path.is_absolute():
            path = Path(__file__).parent / path
        return path
    # Non-sqlite URLs are not yet supported by this module.
    return Path(__file__).parent / "receipts.db"


# Module global so tests can monkeypatch it directly; get_connection reads it at call time.
DB_PATH = _resolve_db_path()


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS receipts (
                id             TEXT PRIMARY KEY,
                session_id     TEXT NOT NULL,
                tool_name      TEXT NOT NULL,
                timestamp      TEXT NOT NULL,
                input_hash     TEXT NOT NULL,
                output_hash    TEXT NOT NULL,
                status         TEXT NOT NULL CHECK(status IN ('success', 'error')),
                hmac_signature TEXT NOT NULL,
                verdict        TEXT,
                tool_input     TEXT,
                tool_output    TEXT
            )
        """)
        for col in ("verdict TEXT", "tool_input TEXT", "tool_output TEXT"):
            try:
                conn.execute(f"ALTER TABLE receipts ADD COLUMN {col}")
            except Exception:
                pass

        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                session_id          TEXT PRIMARY KEY,
                created_at          TEXT NOT NULL,
                last_activity       TEXT NOT NULL,
                closed_at           TEXT,
                status              TEXT NOT NULL DEFAULT 'open',
                auto_verdict        TEXT,
                auto_verified_at    TEXT,
                receipt_count       INTEGER DEFAULT 0,
                verification_scope  TEXT
            )
        """)
        for col in ("verification_scope TEXT",):
            try:
                conn.execute(f"ALTER TABLE sessions ADD COLUMN {col}")
            except Exception:
                pass
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_session ON receipts(session_id)"
        )

        # API keys. Only SHA-256 hashes are stored, never raw keys. tenant_id is
        # nullable today (single-tenant) so multi-tenancy can slot in later without
        # a meaning-changing migration.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS api_keys (
                id          TEXT PRIMARY KEY,
                key_hash    TEXT NOT NULL UNIQUE,
                label       TEXT NOT NULL,
                role        TEXT NOT NULL CHECK(role IN ('proxy', 'viewer', 'admin')),
                tenant_id   TEXT,
                created_at  TEXT NOT NULL,
                revoked_at  TEXT
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_api_key_hash ON api_keys(key_hash)"
        )

        conn.execute("""
            CREATE TABLE IF NOT EXISTS alert_rules (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                enabled     INTEGER NOT NULL DEFAULT 1,
                trigger     TEXT NOT NULL,
                channel     TEXT NOT NULL,
                config      TEXT NOT NULL,
                created_at  TEXT NOT NULL
            )
        """)
        conn.commit()


# ── api keys ──────────────────────────────────────────────────────────────────

def insert_api_key(id: str, key_hash: str, label: str, role: str,
                   created_at: str, tenant_id: str | None = None) -> None:
    with get_connection() as conn:
        conn.execute(
            """INSERT OR IGNORE INTO api_keys
               (id, key_hash, label, role, tenant_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (id, key_hash, label, role, tenant_id, created_at),
        )
        conn.commit()


def get_api_key_by_hash(key_hash: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL",
            (key_hash,),
        ).fetchone()
        return dict(row) if row else None


def count_api_keys() -> int:
    with get_connection() as conn:
        return conn.execute("SELECT COUNT(*) AS n FROM api_keys").fetchone()["n"]


# ── receipts ──────────────────────────────────────────────────────────────────

def insert_receipt(receipt: dict) -> None:
    import json as _json
    row = dict(receipt)
    for key in ("tool_input", "tool_output"):
        if key in row and isinstance(row[key], (dict, list)):
            row[key] = _json.dumps(row[key])
    with get_connection() as conn:
        conn.execute(
            """INSERT INTO receipts
               (id, session_id, tool_name, timestamp, input_hash, output_hash,
                status, hmac_signature, tool_input, tool_output)
               VALUES
               (:id, :session_id, :tool_name, :timestamp, :input_hash, :output_hash,
                :status, :hmac_signature, :tool_input, :tool_output)""",
            {**row, "tool_input": row.get("tool_input"), "tool_output": row.get("tool_output")},
        )
        conn.commit()


def update_receipt_verdict(receipt_id: str, verdict: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "UPDATE receipts SET verdict = ? WHERE id = ?",
            (verdict, receipt_id),
        )
        conn.commit()


def _deserialize(row: dict) -> dict:
    import json as _json
    for key in ("tool_input", "tool_output"):
        if isinstance(row.get(key), str):
            try:
                row[key] = _json.loads(row[key])
            except Exception:
                pass
    return row


def get_receipts_for_session(session_id: str) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM receipts WHERE session_id = ? ORDER BY timestamp ASC",
            (session_id,),
        ).fetchall()
    return [_deserialize(dict(row)) for row in rows]


def get_all_receipts(limit: int = 50) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM receipts ORDER BY timestamp DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [_deserialize(dict(row)) for row in rows]


def get_receipt_for_session(receipt_id: str, session_id: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM receipts WHERE id = ? AND session_id = ?",
            (receipt_id, session_id),
        ).fetchone()
    return _deserialize(dict(row)) if row else None


# ── sessions ──────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def upsert_session(session_id: str) -> bool:
    """Insert or update a session row. Returns True if the session is new."""
    now = _now()
    with get_connection() as conn:
        existing = conn.execute(
            "SELECT session_id FROM sessions WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        if existing is None:
            conn.execute(
                """INSERT INTO sessions
                   (session_id, created_at, last_activity, status, receipt_count)
                   VALUES (?, ?, ?, 'open', 1)""",
                (session_id, now, now),
            )
            conn.commit()
            return True
        conn.execute(
            """UPDATE sessions
               SET last_activity = ?, receipt_count = receipt_count + 1
               WHERE session_id = ?""",
            (now, session_id),
        )
        conn.commit()
        return False


def close_session(session_id: str) -> dict | None:
    """Mark a session closed. Returns the updated session row or None."""
    now = _now()
    with get_connection() as conn:
        conn.execute(
            "UPDATE sessions SET status = 'closed', closed_at = ? WHERE session_id = ? AND status = 'open'",
            (now, session_id),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM sessions WHERE session_id = ?",
            (session_id,),
        ).fetchone()
    return dict(row) if row else None


def get_session(session_id: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM sessions WHERE session_id = ?",
            (session_id,),
        ).fetchone()
    return dict(row) if row else None


def get_open_sessions_older_than(seconds: int) -> list[dict]:
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM sessions WHERE status = 'open' AND last_activity < ?",
            (cutoff,),
        ).fetchall()
    return [dict(row) for row in rows]


def update_session_verdict(session_id: str, verdict: str, verified_at: str, scope: str = "signature_only") -> None:
    with get_connection() as conn:
        conn.execute(
            """UPDATE sessions
               SET auto_verdict = ?, auto_verified_at = ?, status = 'verified',
                   verification_scope = ?
               WHERE session_id = ?""",
            (verdict, verified_at, scope, session_id),
        )
        conn.commit()


def update_session_status(session_id: str, status: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "UPDATE sessions SET status = ? WHERE session_id = ?",
            (status, session_id),
        )
        conn.commit()


def get_all_sessions(limit: int = 50) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM sessions ORDER BY last_activity DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


# ── stats ─────────────────────────────────────────────────────────────────────

# ── alert rules ───────────────────────────────────────────────────────────────

def create_alert_rule(name: str, trigger: str, channel: str, config: str) -> dict:
    import uuid
    rule_id = str(uuid.uuid4())
    now = _now()
    with get_connection() as conn:
        conn.execute(
            """INSERT INTO alert_rules (id, name, enabled, trigger, channel, config, created_at)
               VALUES (?, ?, 1, ?, ?, ?, ?)""",
            (rule_id, name, trigger, channel, config, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM alert_rules WHERE id = ?", (rule_id,)).fetchone()
    return dict(row)


def get_alert_rules() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM alert_rules ORDER BY created_at DESC"
        ).fetchall()
    return [dict(row) for row in rows]


def get_alert_rule(rule_id: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM alert_rules WHERE id = ?", (rule_id,)
        ).fetchone()
    return dict(row) if row else None


def update_alert_rule(rule_id: str, **kwargs) -> dict | None:
    allowed = {"name", "enabled", "trigger", "channel", "config"}
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if fields:
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        values = list(fields.values()) + [rule_id]
        with get_connection() as conn:
            conn.execute(f"UPDATE alert_rules SET {set_clause} WHERE id = ?", values)
            conn.commit()
    return get_alert_rule(rule_id)


def delete_alert_rule(rule_id: str) -> bool:
    with get_connection() as conn:
        cursor = conn.execute("DELETE FROM alert_rules WHERE id = ?", (rule_id,))
        conn.commit()
    return cursor.rowcount > 0


def get_enabled_rules_for_verdict(verdict: str) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM alert_rules WHERE enabled = 1 AND (trigger = ? OR trigger = 'ANY')",
            (verdict,),
        ).fetchall()
    return [dict(row) for row in rows]


def get_stats() -> dict:
    with get_connection() as conn:
        total_receipts    = conn.execute("SELECT COUNT(*) FROM receipts").fetchone()[0]
        verified_receipts = conn.execute("SELECT COUNT(*) FROM receipts WHERE verdict = 'VERIFIED'").fetchone()[0]
        successful_calls  = conn.execute("SELECT COUNT(*) FROM receipts WHERE status = 'success'").fetchone()[0]
        tamper_alerts     = conn.execute("SELECT COUNT(*) FROM receipts WHERE verdict = 'TAMPERED'").fetchone()[0]
        total_sessions    = conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
        open_sessions     = conn.execute("SELECT COUNT(*) FROM sessions WHERE status = 'open'").fetchone()[0]
        verified_sessions = conn.execute("SELECT COUNT(*) FROM sessions WHERE status = 'verified'").fetchone()[0]
        failed_sessions   = conn.execute("SELECT COUNT(*) FROM sessions WHERE status = 'failed'").fetchone()[0]
    return {
        # receipt-level counts
        "total_receipts":    total_receipts,
        "verified":          verified_receipts,   # verdict='VERIFIED' (claim verified)
        "successful_calls":  successful_calls,    # status='success' (tool executed without error)
        "tamper_alerts":     tamper_alerts,
        "sessions":          total_sessions,
        # new session-level keys
        "total_sessions":    total_sessions,
        "open_sessions":     open_sessions,
        "verified_sessions": verified_sessions,
        "failed_sessions":   failed_sessions,
    }
