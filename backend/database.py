import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "receipts.db"


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
                hmac_signature TEXT NOT NULL
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_session ON receipts(session_id)"
        )
        conn.commit()


def insert_receipt(receipt: dict) -> None:
    with get_connection() as conn:
        conn.execute(
            """INSERT INTO receipts
               (id, session_id, tool_name, timestamp, input_hash, output_hash, status, hmac_signature)
               VALUES
               (:id, :session_id, :tool_name, :timestamp, :input_hash, :output_hash, :status, :hmac_signature)""",
            receipt,
        )
        conn.commit()


def get_receipts_for_session(session_id: str) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM receipts WHERE session_id = ? ORDER BY timestamp ASC",
            (session_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def get_all_receipts(limit: int = 50) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM receipts ORDER BY timestamp DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def get_stats() -> dict:
    with get_connection() as conn:
        total    = conn.execute("SELECT COUNT(*) FROM receipts").fetchone()[0]
        sessions = conn.execute("SELECT COUNT(DISTINCT session_id) FROM receipts").fetchone()[0]
        tools    = conn.execute("SELECT COUNT(DISTINCT tool_name) FROM receipts").fetchone()[0]
    return {"total_receipts": total, "sessions": sessions, "unique_tools": tools}


def get_latest_receipt_for_tool(session_id: str, tool_name: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            """SELECT * FROM receipts
               WHERE session_id = ? AND tool_name = ?
               ORDER BY timestamp DESC LIMIT 1""",
            (session_id, tool_name),
        ).fetchone()
    return dict(row) if row else None
