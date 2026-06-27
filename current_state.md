# Current State — Receipts

**Date:** 2026-06-27

## What exists

Backend, frontend dashboard, MCP proxy, CLI demo agent, Docker deployment, structured logging, API-key auth, rate limiting, and alert delivery are all fully built and running.

## Backend (`backend/`)

Twelve focused modules, no internal abstraction layers:

- **`main.py`** — FastAPI routes, lifespan startup (DB init, key seeding, timeout loop), rate limiting via slowapi. All endpoints listed below.
- **`database.py`** — sqlite3 CRUD: receipts, sessions, api_keys, alert_rules tables. Module-level `DB_PATH` resolved from `DATABASE_URL` setting. `get_connection()` returns `Row`-factory connections.
- **`signer.py`** — `hash_dict()`, `sign_receipt()`, `verify_receipt_signature()`, `build_receipt()`. Canonical form: `json.dumps(sort_keys=True, separators=(",",":"))`. Secret resolved once at import via `settings.resolved_secret()`.
- **`verifier.py`** — `run_verify()` verifies claimed outputs against stored receipts (per-receipt verdicts written back to DB). `derive_verdict()` computes session-level verdict with severity ordering: TAMPERED > CONTRADICTED > UNVERIFIED.
- **`auto_verify.py`** — signature-only verification for session close/inactivity. Skips sessions with existing `full_claim` verdict. Only writes `TAMPERED` per-receipt verdicts (intact receipts left unmarked). Fires TAMPERED alerts via `asyncio.create_task`.
- **`alerts.py`** — `fire_alerts()` dispatches to `send_webhook()`, `send_email()`, `send_slack()`. Email uses SMTP/STARTTLS with forced IPv4 resolution (Docker bridge IPv6 workaround). Slack uses Block Kit formatting.
- **`auth.py`** — `require_role()` FastAPI dependency. Role hierarchy: `viewer(1) < proxy(2) < admin(3)`. Keys via `Authorization: Bearer <key>` or `X-API-Key`. Bootstrap seeding from `API_KEYS` env on first startup.
- **`settings.py`** — `pydantic-settings` `BaseSettings` subclass. Production safety: `resolved_secret()` raises if `RECEIPT_SECRET` is missing/short when `ENVIRONMENT=production`. All tunables (timeouts, rate limits, CORS, logging) env-configurable.
- **`tools.py`** — mock tools (`write_file`, `http_fetch`, `db_query`) + `execute_tool()` dispatcher + `TOOL_REGISTRY`.
- **`models.py`** — Pydantic v2 schemas: `ToolCallRequest`, `ToolRecordRequest`, `ReceiptResponse`, `ClaimedOutput`, `VerifyRequest`, `VerifyVerdict`, `VerifyResponse`, `DemoRunResponse`, `SessionResponse`, `CloseSessionResponse`, `AlertRuleCreate`, `AlertRuleUpdate`, `AlertRuleResponse`.
- **`logging_config.py`** — `JsonFormatter` emitting one JSON object per line (ts, level, logger, message + context). `configure_logging()` called at startup.
- **`Dockerfile`** — Python 3.12-slim, layer-cached pip install, healthcheck on `/healthz`.

### Route handlers

- `POST /tools/record` — receipt an already-executed tool call (proxy path, production entry point)
- `POST /tools/call` — execute a mock tool and receipt it (demo only, gated by `ENABLE_DEMO_TOOLS`)
- `GET /receipts/all` — all receipts, `?limit=50`
- `GET /receipts/{session_id}` — receipts for one session
- `POST /verify` — compare claimed outputs against stored receipts
- `GET /sessions` — list sessions, `?limit=50`
- `GET /sessions/{id}` — session detail
- `POST /sessions/{id}/close` — close session + schedule auto-verify
- `POST /sessions/{id}/verify-claim` — full-claim reconciliation with verdict persistence (guarded against circular re-verification)
- `GET /stats` — aggregate counts (receipt-level and session-level)
- `GET /alerts` — list alert rules
- `POST /alerts` — create alert rule
- `GET /alerts/{id}` — get alert rule
- `PATCH /alerts/{id}` — update alert rule
- `DELETE /alerts/{id}` — delete alert rule
- `POST /alerts/{id}/test` — send test alert with fake receipt
- `POST /demo/run?mode=normal|lying|replit` — run demo scenario
- `GET /healthz` — liveness (always 200, no auth)
- `GET /readyz` — readiness (checks DB, no auth)

CORS middleware enabled (configurable origins). Rate limiting via slowapi middleware.

### Verification flow

`POST /verify` accepts `{session_id, claimed_outputs: [{receipt_id, tool_name, output}]}`. Each claim is matched to that exact receipt within the session. Verdicts: `VERIFIED` (all match), `CONTRADICTED` (receipt exists but claim differs), `UNVERIFIED` (no receipt found), `TAMPERED` (signature invalid).

`POST /sessions/{id}/verify-claim` additionally persists the verdict with `scope='full_claim'` on the session row. Guard: if a full_claim verdict already exists, returns it instead of re-running (`?force=true` to override).

The three built-in demos produce these outcomes:

- `normal` — matching claims and receipts: `VERIFIED`
- `lying` — invented receipt IDs with no tool calls: `UNVERIFIED`
- `replit` — executes `db_query` but claims `write_file`: `CONTRADICTED`

### Database schema

Four tables: `receipts`, `sessions`, `api_keys`, `alert_rules`. All with `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ADD COLUMN` migrations for forwards compatibility.

## Frontend (`frontend/`)

React 19 + Vite 8 + Tailwind 3. Runs at `http://localhost:5173`. All UI in `frontend/src/App.jsx` (~2300 lines, inline-styled) + `frontend/src/animations.js`.

### Design tokens (CSS variables in index.css)

```
--bg: #0a0a0a   --surface: #111111   --surface-2: #1a1a1a
--border: #222222   --border-2: #2a2a2a
--text: #e8e8e8   --text-muted: #666666   --text-dim: #444444
--green: #22c55e   --red: #ef4444   --amber: #f59e0b   --blue: #3b82f6
--mono: 'JetBrains Mono', ui-monospace, monospace
--sans: 'Inter', system-ui, sans-serif
```

**Design rule: zero emojis.** Status indicators use CSS dots and color. CONTRADICTED = amber. VERIFIED = green. TAMPERED/UNVERIFIED = red.

### Six views (sidebar navigation)

1. **Live Ledger** — polls `/stats`, `/receipts/all`, `/sessions` every 3s. Stats count up from 0 on first load. New rows highlighted amber for 2s. Search, verdict filter, time filter, auto-refresh toggle, pagination (20/page).
2. **Sessions** — polls `/sessions` every 5s. Shows session_id, started, duration, receipt count, status pill, scope pill, verdict. Click row → reconciliation.
3. **Reconciliation** — select session from dropdown, run validation via `/sessions/{id}/verify-claim`. Per-receipt cards with field-level match status (tool_name, output_hash, hmac_signature, executed_at). On-record warning for existing full_claim verdicts. Export JSON.
4. **Alerts** — CRUD for alert rules. Multi-step creation wizard (trigger → channel → config → name). Enable/disable toggle, test delivery, delete. Channels: webhook, email, Slack.
5. **Help** — setup guides for Claude Code, Cursor, Slack, Gmail, Alertmanager, custom webhooks. Collapsible sections with code blocks.
6. **Settings** — system config display table + raw hash toggle.

### Animation system

- View transitions: 150ms exit (opacity) → swap → 200ms enter (opacity)
- Row highlight: 2s amber fade-out keyframe
- Pill fade-in: 200ms scale(0.9→1) + opacity
- Skeleton loaders: 1.4s pulse
- `prefers-reduced-motion` respected: all animations disabled

## MCP Proxy (`receipts_mcp/`)

- **`server.py`** — stdio MCP server. Connects to upstreams via `ClientSessionGroup` with `namespacing_hook`. Falls back to demo tools if no upstreams configured. Demo calls forward to backend `/tools/call`.
- **`proxy.py`** — `call_and_record()`: forward → receipt → return. `record_receipt()`: never raises (best-effort). `normalize_result()`: structured → text fallback. `SESSION_ID`: one per process.
- **`config.py`** — `ProxySettings` (pydantic-settings). `load_upstreams()`: reads JSON, expands `${ENV_VAR}`, builds SDK params for stdio/sse/streamable_http.

## How to run

```bash
# Terminal 1 — backend
cd ~/receipts && source .venv/bin/activate
cd backend
RECEIPT_SECRET=dev-secret \
API_KEYS="dashboard:viewer:devviewer,proxy:proxy:devproxy" \
python3 -m uvicorn main:app --reload

# Terminal 2 — frontend
cd ~/receipts/frontend
npm run dev
# → http://localhost:5173
```

## Tests

```bash
cd ~/receipts && source .venv/bin/activate
python -m pytest
```

- `tests/test_verification.py` — isolated temporary SQLite databases. Covers: receipt-ID requirements, repeated tool calls, output mismatches, tampered signatures, invalid receipt references, cross-session rejection, all demo verdicts, auto-verify (VERIFIED/TAMPERED/empty), session timeout detection, explicit close endpoint, `/tools/record` signing, auth enforcement (401/403/200).
- `tests/test_proxy.py` — real upstream via `tests/fixtures/mock_upstream.py`. Covers: proxy forwarding + receipting, tool namespacing, error recording.
- `test_mcp.py` — smoke test against live backend. Covers: receipting path, receipt count, session visibility, auth enforcement.

## Docker

```bash
cp .env.example .env  # fill in RECEIPT_SECRET, API_KEYS, RECEIPTS_PROXY_KEY
docker compose up --build
```

- Backend: port 8000, SQLite in `receipts-data` volume
- Frontend: port 8080, nginx reverse proxy with `PROXY_KEY` injection

## What exists (complete list)

- ✅ Production receipting path (`/tools/record`)
- ✅ Demo tool execution (`/tools/call`)
- ✅ HMAC-SHA256 signing and verification
- ✅ Full-claim and signature-only verification scopes
- ✅ Session lifecycle (open → close → auto-verify)
- ✅ Background inactivity timeout loop
- ✅ API-key authentication with three roles
- ✅ Rate limiting (slowapi)
- ✅ Structured JSON logging
- ✅ Alert delivery (webhook, email, Slack)
- ✅ Dashboard with 6 views
- ✅ Docker + compose deployment
- ✅ Test coverage (pytest + smoke tests)
- ✅ MCP proxy with upstream aggregation
