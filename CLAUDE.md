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
python3 demo_agent.py --mode lying    # agent tampers with reported output → CONTRADICTED
python3 demo_agent.py --mode replit   # agent reports results with no tool calls → UNVERIFIED
```

Or use the live buttons in the frontend at `http://localhost:5173`.

## Architecture

### Frontend (`frontend/`)

React 19 + Vite 8 + Tailwind 3. All app logic lives in two files (alongside `main.jsx` entry point, `index.css`/`App.css` styles, and `assets/`):
- `frontend/src/App.jsx` — all components, hooks, and view logic
- `frontend/src/animations.js` — scroll animation system (`initAnimations`, `countUp`)

No routing library, no state management library.

- `vite.config.js` — proxies `/demo`, `/tools`, `/receipts`, `/verify`, `/stats`, `/sessions` to `localhost:8000`
- `tailwind.config.js` — extends with `beige: #f5f0e8`, `rust: #c4622d`, `font-serif: Source Serif 4`, `font-mono: JetBrains Mono`
- `src/index.css` — Tailwind directives + all keyframes and animation classes

**Design tokens:** App.jsx constants reference CSS custom properties. Light and dark values are defined in `src/index.css` under `:root` and `[data-theme="dark"]`.

**Design rule: zero emojis.** Status indicators use CSS dots (`.dot`, `.dot-green`, `.dot-red`, `.dot-rust`). CONTRADICTED = bold red uppercase. VERIFIED = green CSS dot + green monospace text.

**Two views:** Landing (full page) and Dashboard (Verdicts + Live Ledger). Switched via `switchView()` — 200ms exit animation, then swap state, then 300ms enter animation. Dashboard has four tabs: Live Ledger, Sessions, Reconciliation. Navigating from Live Ledger or Sessions to Reconciliation uses `goReconcile(sessionId)` which sets `reconcileSession` state in `App`. ReconciliationView checks the session's `verification_scope` on mount — if `full_claim` already exists it shows the stored verdict without re-running; if `signature_only` or no scope it auto-runs.

**Landing page sections (in order):**
1. **Nav** — sticky, transparent → frosted at 100px scroll (`[data-nav]` / `.nav-scrolled`). Active section underline slides via `data-nav-link`.
2. **Hero** — staggered `data-animate="fade-up"` (0/150/300/450/600ms). Receipt card: `data-animate="fade-right"`, then continuous float at −2.2deg.
3. **How It Works** — 2×3 bordered grid, 6 steps, `stagger-children` 100ms.
4. **Incidents** — two story cards (left/right). Viewport-triggered typing animation via `IntersectionObserver` → `setTimeout(play, 900)`, fires once. Replay button resets.
5. **Anatomy** — left sticky block fades from left; right 7-field table rows stagger up 80ms.
6. **Three Verdicts** — three live demo columns, each calls `POST /demo/run`, `stagger-children` 120ms.
7. **Quickstart** — split layout, setup terminal on right.
8. **Footer**

**Animation system (`animations.js`):**
- `initAnimations()` returns a cleanup function. Called in `useEffect([view])` with a 50ms delay after view change.
- Single `IntersectionObserver` at 15% threshold handles all `[data-animate]` elements. Stagger containers get per-child `transitionDelay` set before `is-visible` is added.
- `watchNavScroll()` — toggles `.nav-scrolled` at 100px scroll.
- `watchActiveSections()` — slides active link underline in/out per section at 35% threshold.
- `countUp(from, to, duration, onUpdate)` — easeOutQuart, exported for use in LiveSection.
- `prefers-reduced-motion` fully respected: elements revealed instantly, animations disabled via CSS.

**Story hooks (`useStory1`, `useStory2`):**
- `play()` / `clear()` callbacks manage `setInterval` / `setTimeout` timers via a `useRef` array.
- `useEffect` only runs cleanup (no auto-play on mount).
- Per-component `IntersectionObserver` in `Story1` / `Story2` triggers `setTimeout(play, 900)` once on viewport entry.
- Typing uses functional state updaters (`setL1(S1_CMD.slice(0, i))`) to avoid stale closures.

**LiveSection:**
- Polls `/stats` + `/receipts/all` every 3 seconds.
- Receipt stat cards (top row): **Total Receipts**, **Verified Claims** (`verdict='VERIFIED'`, green), **Successful Calls** (`status='success'`, blue), **Tamper Alerts** (`verdict='TAMPERED'`, red). Note: a tool can run successfully but the agent can still lie about its output — these two counts are intentionally distinct.
- Stats count up from 0 on first load (`hasCountedRef` guards against repeat).
- New rows detected via `prevIdsRef` set diff — highlighted with `.row-new` (amber 2s fade).
- Click any row to expand full detail via `expandedId` state + `max-height` transition (`.row-detail`).

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

- **`main.py`** — route handlers. `/tools/call` executes → signs → stores → upserts session → returns receipt. `/receipts/all` defined before `/receipts/{session_id}` to avoid FastAPI routing conflict. `/verify` delegates to `run_verify`. `/demo/run?mode=X` orchestrates a full scenario, runs verify, then persists the session verdict with `scope='full_claim'`. Session routes: `GET /sessions`, `GET /sessions/{id}`, `POST /sessions/{id}/close` (triggers async auto_verify), `POST /sessions/{id}/verify-claim` (full-claim manual reconciliation, writes `scope='full_claim'`). Lifespan starts `timeout_checker_loop` which closes and auto-verifies sessions idle for 30s.

- **`demo_agent.py`** — standalone `requests`-based demonstration client at the repository root. The frontend's live demo buttons call `/demo/run` instead.

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
Session dropdown populated from `/sessions`. Clicking "Run Reconciliation" fetches `/receipts/{session_id}` to get stored `tool_output`, builds `claimed_outputs` from those actual values, and POSTs to `/sessions/{id}/verify-claim` (not `/verify`) so the result is persisted with `scope='full_claim'`. Results show a full-width verdict banner and one `ReceiptCard` per receipt with a 4-field comparison table. The Live Ledger's expanded row detail has a "Reconcile this session →" button. If the session already has a `full_claim` verdict, the view shows it without auto-running (to avoid overwriting a CONTRADICTED verdict from `demo_run` with a self-referential VERIFIED).

### Tests

`tests/test_verification.py` (12 tests) uses isolated temporary SQLite databases. Covers: exact receipt matching for repeated tool calls, tampered signatures, missing/cross-session/tool-mismatched references, all demo modes, auto_verify signature-only logic, session timeout detection, and explicit close endpoint with background auto-verify.

## Repo hygiene note
A `.gitignore` is in the repo root. `backend/receipts.db`, `__pycache__/`, `.venv/`, and `frontend/node_modules/` are excluded. `current_state.md` and the root `Receipts Landing.html` (1.4MB) are scratch/reference artifacts not part of the build — they are not excluded by the current `.gitignore` and should not be committed.

## Known limitations (not yet implemented)
- All tool implementations are mocks — no real file I/O, HTTP, or DB access occurs
- No authentication or API keys on any endpoint. `RECEIPT_SECRET` also falls back to a hardcoded dev default when unset, so signatures are forgeable unless it is exported — never run outside local dev without it
