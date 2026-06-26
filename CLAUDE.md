# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Receipts — AI Agent Outcome Verifier

## What we're building
A Python FastAPI proxy that sits between an AI agent and its tools. Every tool call gets intercepted, executed, and signed with an HMAC receipt. A reconciliation engine checks if the agent's claimed output matches what actually happened.

## Stack
- Backend: Python + FastAPI + SQLite
- Frontend: React 19 + Vite 8 + Tailwind 3 (built, running)
- Auth/signing: HMAC-SHA256

## Key rules
- Never trust the agent's self-report — always verify independently
- Every tool call must produce a signed receipt
- Green = verified, Red = agent lied

## Commands

```bash
# Install dependencies (from repo root)
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Terminal 1 — run the backend
source .venv/bin/activate
cd backend
RECEIPT_SECRET=dev-secret python3 -m uvicorn main:app --reload
# → http://localhost:8000  (docs at /docs)

# Terminal 2 — from the repository root, run the frontend
cd frontend
npm install   # first time only
npm run dev
# → http://localhost:5173

# From the repository root, run backend tests
python -m pytest

# Run a single test by name
python -m pytest tests/test_verification.py::test_name -v
```

`RECEIPT_SECRET` seeds the HMAC signing key. Omitting it falls back to a dev default — never use the default outside local development.

### Run the demo agent (CLI)

With the backend running on `localhost:8000`, run these from the repository root:

```bash
python3 demo_agent.py --mode normal   # honest agent — claims match receipts → VERIFIED
python3 demo_agent.py --mode lying    # agent reports output but never called any tool (no receipts) → UNVERIFIED
python3 demo_agent.py --mode replit   # agent claims a write_file it never ran (only db_query) → CONTRADICTED
```

Or use the live buttons in the frontend at `http://localhost:5173`.

## Architecture

### Frontend (`frontend/`)

React 19 + Vite 8. It is a **dashboard-only SPA** — there is no landing page. All app logic lives in two files (alongside `main.jsx` entry point, `index.css`/`App.css` styles, and `assets/`):
- `frontend/src/App.jsx` — every component, hook, and view (~1400 lines, all in one file)
- `frontend/src/animations.js` — exports only `countUp(from, to, duration, onUpdate)` (easeOutQuart, used by LedgerView stat counters)

No routing library, no state management library.

- `vite.config.js` — proxies `/demo`, `/tools`, `/receipts`, `/verify`, `/stats`, `/sessions` to `localhost:8000`
- `tailwind.config.js` — Tailwind is wired up (`@tailwind` directives in `index.css`) but `theme.extend` is empty; the app is styled almost entirely with **inline `style={{}}` objects** referencing JS constants (`BG`, `TEXT`, `BLUE`, `MONO`, `SANS`, …) at the top of App.jsx, which in turn reference CSS custom properties.
- `src/index.css` — `@tailwind` directives, design tokens under `:root` (`--mono` = JetBrains Mono, `--sans` = Inter, plus color vars), and all `@keyframes` (`row-highlight`, `pill-in`, `view-exit`/`view-enter`, `toast-in`/`toast-out`, `skeleton-pulse`, `spin`).

**Layout:** fixed `Sidebar` (220px) + `Header` bar + `main` content area. `App` (bottom of App.jsx) holds the top-level state: `view`, `proxyOnline`, `toast`, `showFullHashes`, `reconcileSession`.

**Four views** (sidebar `NAV_ITEMS`), switched by `switchView(next)` — plays a 150ms `view-exit` animation, swaps `view`, then a 200ms `view-enter`:
1. **`ledger`** — `LedgerView`. Polls `/stats` + `/receipts/all` + `/sessions` every 3s (toggle via `autoRefresh`). Four stat cards: **Total Receipts**, **Verified** (`verdict='VERIFIED'`), **Successful Calls** (`status='success'`), **Tamper Alerts** (`verdict='TAMPERED'`) — successful-call and verified counts are intentionally distinct (a tool can run fine while the agent lies about its output). Stats count up from 0 on first load. New receipt rows are diffed against the previous id set and highlighted (`row-highlight`). Rows expand on click (`expandedId`). Has search, verdict filter, and time filter. Each row links to reconciliation via `onReconcile`.
2. **`sessions`** — `SessionsView`. Polls `/sessions` every 5s; status pills and a per-session "reconcile" link (`onReconcile`).
3. **`reconciliation`** — `ReconciliationView`. Session dropdown (from `/sessions`); see "Reconciliation flow" below. Reached from the other views via `goReconcile(sessionId)`, which sets `reconcileSession` and switches view.
4. **`settings`** — `SettingsView`. Toggles `showFullHashes` (full vs. truncated hashes in the ledger).

**Other behavior:**
- `proxyOnline` is polled every 5s by fetching `/stats`; `OfflineBanner` shows when the backend is unreachable.
- `generateReport()` (Sidebar "Report" button) fetches `/receipts/all` + `/stats` and downloads a JSON audit file via a Blob; surfaces a `Toast`.
- `JsonHighlight`, `Pill`, `Dot`, `StatCard`, `ReceiptCard`, `LedgerRow` are the shared presentational components.

**Status display:** no emojis in the UI. CONTRADICTED/TAMPERED render as bold red; VERIFIED renders green via `verdictColor()` + `Dot`/`Pill`.

### Backend (`backend/`)

All backend code lives in `backend/`. Five focused modules with no internal abstraction layers:

- **`signer.py`** — all cryptographic logic: `hash_dict()` (stable JSON → SHA256), `sign_receipt()` (HMAC-SHA256 over 7 canonical fields), `verify_receipt_signature()` (constant-time validation), `build_receipt()` (assembles the full receipt dict), `compute_claimed_hash()` (alias for `hash_dict`, used by `/verify`). The canonical form uses `json.dumps(sort_keys=True)` so dict key ordering never affects hashes.

- **`tools.py`** — mock tool implementations (`write_file`, `http_fetch`, `db_query`) and `execute_tool(tool_name, tool_input)` dispatcher. Tools are called with `**tool_input` so dict keys must match function parameter names. To add a new tool: implement a function that returns a `dict`, then register it in `TOOL_REGISTRY`.

- **`database.py`** — sqlite3 CRUD: `init_db()`, `insert_receipt()`, `update_receipt_verdict()`, `get_receipts_for_session()`, `get_receipt_for_session()`, `get_all_receipts(limit)`, `get_stats()`, plus session functions: `upsert_session()`, `close_session()`, `get_session()`, `get_all_sessions()`, `get_open_sessions_older_than()`, `update_session_verdict()`, `update_session_status()`. DB file is `backend/receipts.db`. Per-call connections (no shared state). `init_db()` runs `ALTER TABLE ADD COLUMN` migrations so existing DBs upgrade automatically. `get_stats()` keys: `total_receipts`, `verified` (receipt `verdict='VERIFIED'` — claim verified), `successful_calls` (receipt `status='success'` — tool ran without error), `tamper_alerts` (receipt `verdict='TAMPERED'`), `sessions`, `total_sessions`, `open_sessions`, `verified_sessions`, `failed_sessions`.
  - `receipts` schema: `id, session_id, tool_name, timestamp, input_hash, output_hash, status, hmac_signature, verdict, tool_input, tool_output`
  - `sessions` schema: `session_id, created_at, last_activity, closed_at, status, auto_verdict, auto_verified_at, receipt_count, verification_scope`
  - `verification_scope` values: `'signature_only'` (auto-verify result) or `'full_claim'` (manual reconciliation or demo_run result). `update_session_verdict(session_id, verdict, verified_at, scope='signature_only')` accepts the scope kwarg.

- **`models.py`** — Pydantic v2 request/response schemas. `ReceiptResponse` includes optional `verdict`, `tool_input`, `tool_output`. `SessionResponse` includes `verification_scope: str | None`. Each `ClaimedOutput` requires `receipt_id`.

- **`verifier.py`** — `run_verify(session_id, claimed_outputs)` and `derive_verdict(verdicts)`. Called by `/verify`, `/sessions/{id}/verify-claim`, and `demo_run`. Writes per-receipt verdicts as a side effect. `derive_verdict` severity ordering: TAMPERED > CONTRADICTED > UNVERIFIED — a provable mismatch (receipt exists, valid signature, claim differs) outranks a missing receipt.

- **`auto_verify.py`** — checks HMAC signatures only (does NOT use `run_verify`). Detects `TAMPERED` (bad signature) or `VERIFIED` (all intact). Writes `verdict='TAMPERED'` to individual receipt rows for tampered receipts (so the ledger and tamper_alerts stat reflect tampering caught on this path); does not stamp `VERIFIED` on receipt rows since a valid signature alone doesn't verify the agent's claim. Cannot detect `CONTRADICTED` or `UNVERIFIED` without the agent's original claims. Skips if `verification_scope='full_claim'` already set. Returns `None` for sessions with no receipts (status set to `'closed'`, no verdict written).

- **`main.py`** — route handlers. `/tools/call` executes → signs → stores → upserts session → returns receipt. `/receipts/all` defined before `/receipts/{session_id}` to avoid FastAPI routing conflict. `/verify` delegates to `run_verify`. `/demo/run?mode=X` orchestrates a full scenario, runs verify, then persists the session verdict with `scope='full_claim'`. Session routes: `GET /sessions`, `GET /sessions/{id}`, `POST /sessions/{id}/close` (triggers async auto_verify), `POST /sessions/{id}/verify-claim` (full-claim manual reconciliation, writes `scope='full_claim'`; guards against re-verifying a session that already has a `full_claim` verdict — returns `{already_verified, verdict, verification_scope, message}` instead, unless `?force=true` is passed). Lifespan starts `timeout_checker_loop` which closes and auto-verifies sessions idle for 30s.

- **`demo_agent.py`** — standalone `requests`-based demonstration client at the repository root. It drives `/tools/call` + `/verify` directly (not `/demo/run`). `/demo/run` is exercised by the test suite and by curl/`/docs`; the dashboard frontend does not call it.

### API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/tools/call` | Execute a tool, get back a signed receipt |
| `GET`  | `/receipts/{session_id}` | All receipts for a session |
| `GET`  | `/receipts/all` | Most recent 50 receipts across all sessions |
| `GET`  | `/stats` | Aggregate counts (receipts, sessions, tamper alerts) |
| `POST` | `/verify` | Verify exact receipt IDs, output hashes, and HMAC signatures |
| `GET`  | `/sessions` | All sessions (most recent 50) |
| `GET`  | `/sessions/{session_id}` | Single session detail |
| `POST` | `/sessions/{session_id}/close` | Explicitly close a session; schedules auto-verify |
| `POST` | `/sessions/{session_id}/verify-claim` | Full-claim reconciliation; writes `scope='full_claim'` |
| `POST` | `/demo/run?mode=X` | Orchestrate a full demo scenario end-to-end |

### Verify flow
`/verify` accepts `{session_id, claimed_outputs: [{receipt_id, tool_name, output}]}`. For each entry it loads that exact receipt within the session, re-hashes the claimed output using `hash_dict()`, and re-validates the stored HMAC signature. A claim is verified only when the receipt exists, its tool name and output hash match, and its signature is valid. Every verdict includes `receipt_id`, `signature_valid`, and an optional failure `reason`. After computing each verdict, `/verify` writes it back to the DB row via `update_receipt_verdict()`.

### Verification scope — two distinct checks

Two different things can be verified, and the system tracks which has been done:

| Scope | Endpoint | What it checks | Can detect |
|-------|----------|----------------|------------|
| `signature_only` | auto-verify (timeout/close) | HMAC signatures on stored receipts | TAMPERED, VERIFIED |
| `full_claim` | `/sessions/{id}/verify-claim`, `demo_run` | Agent's claimed output vs. stored receipts | TAMPERED, VERIFIED, CONTRADICTED, UNVERIFIED |

`auto_verify` skips sessions that already have `scope='full_claim'` so it never overwrites a more informative verdict. The frontend shows a `sig. only` sub-label on verdict pills when `verification_scope='signature_only'`.

### Session lifecycle
`open` → tool calls arrive, `upsert_session` increments `receipt_count`  
`closed` → explicit `POST /sessions/{id}/close` or 30s inactivity timeout  
`verified` → `auto_verify` or `verify-claim` completes and writes verdict + scope

### Reconciliation flow (frontend)
Session dropdown populated from `/sessions`. Clicking "Run Reconciliation" fetches `/receipts/{session_id}` to get stored `tool_output`, builds `claimed_outputs` from those actual values, and POSTs to `/sessions/{id}/verify-claim` (not `/verify`) so the result is persisted with `scope='full_claim'`. Results show a full-width verdict banner and one `ReceiptCard` per receipt with a 4-field comparison table. The Live Ledger's expanded row detail has a "Reconcile this session →" button.

**Circular re-run guard.** Reconciliation builds the claim from the *stored* receipts, so re-verifying a session always collapses to VERIFIED (the claim is its own source of truth) — which would silently destroy a `CONTRADICTED`/`UNVERIFIED` verdict from `demo_run`. So when a selected session already has `verification_scope='full_claim'` with an `auto_verdict`, `ReconciliationView` (via `showStoredVerdict`) renders the **stored** verdict immediately without calling `verify-claim` — top banner from `auto_verdict`, per-receipt cards synthesized from each receipt's stored `verdict` string — and shows an "ON RECORD / Full claim verification on record" label. The button changes to "Re-run Reconciliation" with a warning, and only an explicit click POSTs with `?force=true` to override the backend guard. The backend enforces the same guard server-side (returns `already_verified` unless forced), which `runForSession` also handles defensively.

### Tests

`tests/test_verification.py` (12 tests) uses isolated temporary SQLite databases. Covers: exact receipt matching for repeated tool calls, tampered signatures, missing/cross-session/tool-mismatched references, all demo modes, auto_verify signature-only logic, session timeout detection, and explicit close endpoint with background auto-verify.

## Repo hygiene note
A `.gitignore` is in the repo root. `backend/receipts.db`, `__pycache__/`, `.venv/`, and `frontend/node_modules/` are excluded. `current_state.md` is a scratch/reference artifact not part of the build (it is currently tracked but is not used by the app).

## Known limitations (not yet implemented)
- All tool implementations are mocks — no real file I/O, HTTP, or DB access occurs
- No authentication or API keys on any endpoint. `RECEIPT_SECRET` also falls back to a hardcoded dev default when unset, so signatures are forgeable unless it is exported — never run outside local dev without it
