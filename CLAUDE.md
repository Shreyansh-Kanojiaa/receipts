# CLAUDE.md

This file is for Claude Code when working in this repository.

## Project summary

Receipts is an audit layer for AI tool use.

- The MCP proxy forwards real tool calls to real upstream MCP servers.
- The backend signs and stores the resulting tool input/output as receipts.
- Verification compares agent claims with stored receipts and records verdicts.
- The dashboard shows the ledger, sessions, reconciliation, alerts, help, and settings.

## Important invariants

- Do not trust the agent's self-report. Verification must come from stored receipts.
- `/tools/record` is the production receipting path. It signs already executed calls.
- `/tools/call` is demo-only mock execution and is gated by `ENABLE_DEMO_TOOLS`.
- `signature_only` and `full_claim` are different scopes. Do not overwrite a richer `full_claim` verdict with a later signature-only sweep.
- The `verify-claim` endpoint guards against circular re-verification: if a `full_claim` verdict already exists, it returns the stored verdict rather than re-running (re-running uses stored receipts as the claim source, which always collapses to VERIFIED). Pass `?force=true` to override.
- The dashboard is a SPA with no router. Views live in `frontend/src/App.jsx`.
- The frontend bundle must not ship backend secrets. In production nginx injects the proxy key header.
- The real upstream result is ALWAYS returned to the agent, even if receipting fails — backend outages must not break agent tools.
- Raw API keys are never stored. Only SHA-256 hashes live in the `api_keys` table.

## Code map

### Backend

- `backend/main.py` — FastAPI routes, lifespan startup, timeout loop, alerts, demo run, rate limiting setup
- `backend/database.py` — SQLite schema (receipts, sessions, api_keys, alert_rules), CRUD, session state, alert rules
- `backend/signer.py` — canonical hashing (`json.dumps(sort_keys=True)`), HMAC signing, receipt assembly, signature verification
- `backend/verifier.py` — claim verification (`run_verify`) and session verdict derivation (`derive_verdict`)
- `backend/auto_verify.py` — signature-only verification for session close / inactivity; skips sessions with existing full_claim verdicts
- `backend/alerts.py` — alert delivery: webhook (httpx), email (SMTP/STARTTLS with IPv4 resolution), Slack (Block Kit)
- `backend/auth.py` — bearer / X-API-Key auth, three-tier role hierarchy (viewer < proxy < admin), bootstrap key seeding from `API_KEYS` env
- `backend/settings.py` — pydantic-settings env-based config; production safety: missing/short RECEIPT_SECRET raises at startup
- `backend/tools.py` — built-in demo tools (`write_file`, `http_fetch`, `db_query`) + `execute_tool()` dispatcher
- `backend/models.py` — Pydantic v2 request/response schemas (ToolCallRequest, ToolRecordRequest, ReceiptResponse, ClaimedOutput, VerifyRequest, VerifyVerdict, VerifyResponse, DemoRunResponse, SessionResponse, CloseSessionResponse, AlertRule*)
- `backend/logging_config.py` — structured JSON logging (JsonFormatter), context fields merged from `extra={}`, `prefers-reduced-motion` respected
- `backend/Dockerfile` — Python 3.12-slim, uvicorn, healthcheck on `/healthz`

### Frontend

- `frontend/src/App.jsx` — all dashboard views and state (~2300 lines, inline-styled)
  - Design tokens: CSS variables (`--bg`, `--surface`, `--green`, `--red`, `--amber`, `--blue`, `--mono`, `--sans`)
  - Views: LedgerView, SessionsView, ReconciliationView, AlertsView, HelpView, SettingsView
  - Shared components: Sidebar, Header, Toast, OfflineBanner, Pill, Dot, JsonHighlight, StatCard, LedgerRow, ReceiptCard
  - `apiFetch()` injects `VITE_RECEIPTS_VIEWER_KEY` during local dev
- `frontend/src/animations.js` — `countUp()` (easeOutQuart via rAF)
- `frontend/src/index.css` — CSS variables, keyframe animations (row-highlight, pill-in, view transitions, toast, skeleton-pulse, spin), reduced-motion media query
- `frontend/src/App.css` — legacy Vite scaffold styles (unused by dashboard)
- `frontend/nginx.conf` — production SPA + API reverse proxy; envsubst injects `${BACKEND_HOST}` and `${PROXY_KEY}` at container start
- `frontend/vite.config.js` — dev proxy rules for `/demo`, `/tools`, `/receipts`, `/verify`, `/stats`, `/sessions`, `/alerts`
- `frontend/Dockerfile` — Node 20 build stage → nginx 1.27 serve stage

### MCP proxy

- `receipts_mcp/server.py` — stdio MCP server entrypoint; connects upstreams via `ClientSessionGroup`, falls back to demo tools
- `receipts_mcp/proxy.py` — upstream forwarding (`call_and_record`), receipting (`record_receipt`), tool namespacing (`<server>__<tool>`), result normalization
- `receipts_mcp/config.py` — `ProxySettings` (pydantic-settings), `load_upstreams()` with `${ENV_VAR}` expansion, transport support (stdio/sse/streamable_http)
- `receipts_mcp/upstreams.json.example` — example upstream config (filesystem + github)
- `receipts_mcp/__init__.py` — package marker
- `receipts_mcp/__main__.py` — `python -m receipts_mcp` entry

### Tests

- `tests/test_verification.py` — verification logic, receipt-ID requirements, repeated tool calls, output mismatches, tampered signatures, cross-session rejection, tool name mismatch, all three demo modes, auto-verify (VERIFIED/TAMPERED/empty session), session timeout detection, explicit close endpoint, `/tools/record` signing, auth enforcement (401/403/200)
- `tests/test_proxy.py` — real upstream via `tests/fixtures/mock_upstream.py`, proxy forwarding + receipting, namespacing, error recording
- `tests/fixtures/mock_upstream.py` — minimal stdio MCP server exposing `echo` tool
- `test_mcp.py` — smoke test against a live backend (receipting path, session visibility, auth)

## Working rules

- Prefer the repo's existing patterns. This codebase is intentionally direct and low abstraction.
- Keep backend and README docs in sync with actual endpoints and behavior.
- Do not rename verdicts or scopes casually. `VERIFIED`, `UNVERIFIED`, `CONTRADICTED`, and `TAMPERED` are used across backend and UI.
- If you touch verification logic, update the session scope handling and the dashboard labels together.
- If you touch auth or settings, make sure the Quick Start, `.env.example`, and container defaults still line up.
- If you touch the proxy, keep the "real result still returns even if receipting fails" behavior intact.
- If you add an endpoint, update `frontend/vite.config.js` proxy rules and `frontend/nginx.conf` location regex.
- If you add a model, update `backend/models.py` and the response type annotation on the route.

## Local commands

```bash
# Install backend and proxy dependencies
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Run the backend
cd backend
RECEIPT_SECRET=dev-secret \
API_KEYS="dashboard:viewer:devviewer,proxy:proxy:devproxy" \
python3 -m uvicorn main:app --reload

# Run the frontend
cd frontend
npm install
echo "VITE_RECEIPTS_VIEWER_KEY=devproxy" > .env.local
npm run dev

# Run tests
python -m pytest

# Smoke test the backend receipting path
python3 test_mcp.py

# Run the MCP proxy (standalone)
python3 -m receipts_mcp

# Run demo scenarios
python3 demo_agent.py --mode normal
python3 demo_agent.py --mode lying
python3 demo_agent.py --mode replit

# Docker deployment
cp .env.example .env  # fill in secrets
docker compose up --build
```

## Frontend notes

- The app is dashboard-only. There is no landing page or routing library.
- All views are in `App.jsx`: ledger, sessions, reconciliation, alerts, help, settings.
- `apiFetch()` injects `VITE_RECEIPTS_VIEWER_KEY` during local dev.
- The Live Ledger polls `/stats`, `/receipts/all`, and `/sessions` every 3s (toggleable auto-refresh).
- Ledger supports search (session/tool name), verdict filter, time filter, and pagination (20 rows/page).
- New receipt rows are highlighted amber for 2 seconds via `.row-new` keyframe.
- Stats count up from 0 on first load (once, tracked by `hasCountedRef`).
- Reconciliation uses `/sessions/{id}/verify-claim`, not `/verify`, so verdicts persist with `scope='full_claim'`.
- If a session already has a `full_claim` verdict, the reconciliation view shows the stored verdict without re-running.
- View transitions: 150ms exit → swap → 200ms enter (opacity fade).
- Design rule: zero emojis. Status indicators use CSS dots and color.

## Backend notes

- `backend/main.py` exposes:
  - `/tools/record` and `/tools/call`
  - `/verify`
  - `/sessions`, `/sessions/{id}`, `/sessions/{id}/close`, `/sessions/{id}/verify-claim`
  - `/receipts/all`, `/receipts/{session_id}`
  - `/stats`
  - `/alerts`, `/alerts/{id}`, `/alerts/{id}/test`
  - `/demo/run`
  - `/healthz` and `/readyz`
- API keys are stored hashed only. Bootstrap keys come from `API_KEYS`.
- The background timeout loop closes stale sessions after `INACTIVITY_TIMEOUT_SECONDS` (default 30s) of inactivity.
- `auto_verify()` is signature-only and should not stamp intact receipts as verified rows (only tampered rows get a verdict written).
- `auto_verify()` skips sessions with an existing `full_claim` verdict to avoid overwriting richer verdicts.
- Rate limiting: global per-client-IP via slowapi, default `120/minute`.
- Structured JSON logging: every log line is a JSON object with `ts`, `level`, `logger`, `message`, and context fields (session_id, tool_name, verdict, etc.).
- Production safety: missing/short `RECEIPT_SECRET` raises at startup when `ENVIRONMENT=production`.
- CORS origins are configurable; default `*` in dev, locked down in production.

## Proxy notes

- Upstream tools are namespaced as `<server>__<tool>`.
- If no upstreams file exists, the proxy falls back to `write_file`, `http_fetch`, and `db_query`.
- `receipts_mcp/upstreams.json` supports `stdio`, `sse`, and `streamable_http` transports.
- `${ENV_VAR}` references inside upstream configs are expanded at runtime.
- Each proxy process uses one `mcp-<hex>` session ID.
- `record_receipt()` never raises — receipting is best-effort relative to returning the agent's result.
- A 401/403 from the backend during receipting is logged as an error (misconfigured key) so it's not silently mistaken for a transient outage.
- Upstream timeouts default to 60s (`TOOL_TIMEOUT_SECONDS`); backend POST timeout defaults to 5s (`RECORD_TIMEOUT_SECONDS`).

## Alert notes

- Alert rules are stored in the `alert_rules` SQLite table.
- Each rule has: name, trigger (`CONTRADICTED`/`TAMPERED`/`UNVERIFIED`/`ANY`), channel (`webhook`/`email`/`slack`), config (channel-specific JSON), enabled flag.
- Alerts fire as background tasks after verification verdicts.
- Email delivery uses SMTP/STARTTLS with forced IPv4 resolution (avoids Docker bridge IPv6 issues).
- The `/alerts/{id}/test` endpoint sends a test alert with a fake receipt.
- Webhook payload includes: event, verdict, session_id, receipt_id, tool_name, timestamp, hashes, hmac_signature, source.
