# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Receipts — AI Agent Outcome Verifier

## What we're building
A Python FastAPI proxy that sits between an AI agent and its tools. Every tool call gets intercepted, executed, and signed with an HMAC receipt. A reconciliation engine checks if the agent's claimed output matches what actually happened.

## Stack
- Backend: Python + FastAPI + SQLite
- Frontend: React 18 + Vite 5 + Tailwind 3 (built, running)
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

# Run the backend
source .venv/bin/activate
cd backend
RECEIPT_SECRET=dev-secret python3 -m uvicorn main:app --reload
# → http://localhost:8000  (docs at /docs)

# Run the frontend
cd frontend
npm install   # first time only
npm run dev
# → http://localhost:5173
```

`RECEIPT_SECRET` seeds the HMAC signing key. Omitting it falls back to a dev default — never use the default outside local development.

### Run the demo agent (CLI)

With the backend running on `localhost:8000`:

```bash
python3 demo_agent.py --mode normal
python3 demo_agent.py --mode lying
python3 demo_agent.py --mode replit
```

Or use the live buttons in the frontend at `http://localhost:5173`.

## Architecture

### Frontend (`frontend/`)

React 18 + Vite 5 + Tailwind 3. All UI lives in two files:
- `frontend/src/App.jsx` — all components, hooks, and view logic
- `frontend/src/animations.js` — scroll animation system (`initAnimations`, `countUp`)

No routing library, no state management library.

- `vite.config.js` — proxies `/demo`, `/tools`, `/receipts`, `/verify`, `/stats` to `localhost:8000`
- `tailwind.config.js` — extends with `beige: #f5f0e8`, `rust: #c4622d`, `font-serif: Source Serif 4`, `font-mono: JetBrains Mono`
- `src/index.css` — Tailwind directives + all keyframes and animation classes

**Design tokens (App.jsx constants):**
`BG='#ede7da'`, `DARK='#1c1815'`, `RUST='#b85a2a'`, `GREEN='#4a7c4a'`, `RED='#b94a3a'`, `CREAM='#faf4e8'`, `MUTED='#6b5e52'`, `MID='#3c342c'`, `TMBG='#1a1612'`, `TMFG='#d9d4c8'`

**Design rule: zero emojis.** Status indicators use CSS dots (`.dot`, `.dot-green`, `.dot-red`, `.dot-rust`). CONTRADICTED = bold red uppercase. VERIFIED = green CSS dot + green monospace text.

**Two views:** Landing (full page) and Dashboard (Verdicts + Live Ledger). Switched via `switchView()` — 200ms exit animation, then swap state, then 300ms enter animation.

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
- Stats count up from 0 on first load (`hasCountedRef` guards against repeat).
- New rows detected via `prevIdsRef` set diff — highlighted with `.row-new` (amber 2s fade).
- Click any row to expand full detail via `expandedId` state + `max-height` transition (`.row-detail`).

### Backend (`backend/`)

All backend code lives in `backend/`. Five focused modules with no internal abstraction layers:

- **`signer.py`** — all cryptographic logic: `hash_dict()` (stable JSON → SHA256), `sign_receipt()` (HMAC-SHA256 over 7 canonical fields), `build_receipt()` (assembles the full receipt dict), `compute_claimed_hash()` (alias for `hash_dict`, used by `/verify`). The canonical form uses `json.dumps(sort_keys=True)` so dict key ordering never affects hashes.

- **`tools.py`** — mock tool implementations (`write_file`, `http_fetch`, `db_query`) and `execute_tool(tool_name, tool_input)` dispatcher. Tools are called with `**tool_input` so dict keys must match function parameter names. To add a new tool: implement a function that returns a `dict`, then register it in `TOOL_REGISTRY`.

- **`database.py`** — sqlite3 CRUD: `init_db()`, `insert_receipt()`, `get_receipts_for_session()`, `get_latest_receipt_for_tool()`, `get_all_receipts(limit)`, `get_stats()`. DB file is `backend/receipts.db`, created at startup. Per-call connections (no shared state).

- **`models.py`** — Pydantic v2 request/response schemas. `ReceiptResponse` is the canonical shape returned by `/tools/call` and `/receipts/{id}`.

- **`main.py`** — thin route handlers. `/tools/call` executes → signs → stores → returns receipt. `/receipts/all` must be defined BEFORE `/receipts/{session_id}` to avoid FastAPI routing conflict. `/verify` hashes claimed outputs and compares against stored `output_hash` fields. `/demo/run?mode=X` orchestrates a full scenario. CORS middleware is enabled (allow all origins). Verdict derivation: all verified → `"VERIFIED"`; receipts stored but claims don't match → `"CONTRADICTED"`; no receipts at all → `"UNVERIFIED"`.

- **`demo_agent.py`** — standalone `requests`-based demonstration client at the repository root. The frontend's live demo buttons call `/demo/run` instead.

### Verify flow
`/verify` accepts `{session_id, claimed_outputs: [{tool_name, output}]}`. For each entry it re-hashes the claimed output dict using the same `hash_dict()` from `signer.py` and compares it to the `output_hash` stored in the most recent receipt for that `(session_id, tool_name)` pair. A mismatch means the agent reported a different result than what was actually executed.

## Known limitations (not yet implemented)
- `/verify` matches only the *most recent* receipt per `(session_id, tool_name)` — multiple calls to the same tool in a session are not individually addressable
- HMAC signatures are written on receipt creation but never re-verified on read; `/verify` only compares output hashes
- All tool implementations are mocks — no real file I/O, HTTP, or DB access occurs
- No authentication or API keys on any endpoint
- No tests exist in the codebase
