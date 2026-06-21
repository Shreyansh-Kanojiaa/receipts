# Receipts AI

A FastAPI proxy that intercepts AI agent tool calls, executes them, and produces HMAC-SHA256 signed receipts. A reconciliation engine checks whether the agent's claimed outputs match what actually ran. A React + Vite frontend visualizes every receipt and verdict in real time.

## Stack

- **Backend:** Python 3 + FastAPI + SQLite (`backend/`)
- **Frontend:** React 18 + Vite 5 + Tailwind 3 (`frontend/`)
- **Signing:** HMAC-SHA256 over 7 canonical receipt fields

## Quick start

```bash
# 1. Install Python dependencies (repo root)
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 2. Run the backend
cd backend
RECEIPT_SECRET=your-secret python3 -m uvicorn main:app --reload
# → http://localhost:8000   (docs at /docs)

# 3. Run the frontend (new terminal)
cd frontend
npm install   # first time only
npm run dev
# → http://localhost:5173
```

`RECEIPT_SECRET` seeds the HMAC signing key. Omitting it falls back to a dev default — never use the default outside local development.

## Demo agent (CLI)

```bash
python3 demo_agent.py --mode normal   # claims match receipts → VERIFIED
python3 demo_agent.py --mode lying    # no tools called → UNVERIFIED
python3 demo_agent.py --mode replit   # wrong tool claimed → CONTRADICTED
```

Or click the live buttons in the frontend at `http://localhost:5173`.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/tools/call` | Execute a tool, get back a signed receipt |
| `GET`  | `/receipts/{session_id}` | All receipts for a session |
| `GET`  | `/receipts/all` | Most recent 50 receipts across all sessions |
| `GET`  | `/stats` | Aggregate counts (receipts, sessions, unique tools) |
| `POST` | `/verify` | Compare agent claims against stored receipt hashes |
| `POST` | `/demo/run?mode=X` | Orchestrate a full demo scenario end-to-end |

### Example — call a tool

```bash
curl -s -X POST http://localhost:8000/tools/call \
  -H "Content-Type: application/json" \
  -d '{"tool_name":"write_file","tool_input":{"path":"/tmp/out.txt","content":"hello"},"session_id":"sess-1"}' \
  | python3 -m json.tool
```

Available tools: `write_file`, `http_fetch`, `db_query`.

### Example — verify an agent's claim

```bash
curl -s -X POST http://localhost:8000/verify \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "sess-1",
    "claimed_outputs": [
      {"tool_name":"write_file","output":{"status":"written","path":"/tmp/out.txt","bytes_written":5}}
    ]
  }' | python3 -m json.tool
```

`verified: true` — hash matches the stored receipt. `verified: false` — the agent lied.

## Known limitations

- `/verify` matches only the *most recent* receipt per `(session_id, tool_name)` — multiple calls to the same tool in a session are not individually addressable
- HMAC signatures are written on creation but not re-verified on read; `/verify` only compares output hashes
- All tool implementations are mocks — no real file I/O, HTTP, or DB access
- No authentication or API keys on any endpoint
- No automated tests
