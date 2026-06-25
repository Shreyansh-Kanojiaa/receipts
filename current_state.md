# Current State — Receipts

**Date:** 2026-06-22

## What exists

Both backend and frontend are fully built and running. A standalone Python demo agent is also available.

## Backend (`backend/`)

Five focused modules, no internal abstraction layers:

- **`signer.py`** — `hash_dict()`, `sign_receipt()`, `verify_receipt_signature()`, `build_receipt()`. Canonical form uses `json.dumps(sort_keys=True)`.
- **`tools.py`** — mock tools (`write_file`, `http_fetch`, `db_query`) + `execute_tool()` dispatcher.
- **`database.py`** — sqlite3 CRUD: `init_db`, `insert_receipt`, `get_receipts_for_session`, `get_receipt_for_session`, `get_all_receipts`, `get_stats`. DB file: `backend/receipts.db`.
- **`models.py`** — Pydantic v2 request/response schemas.
- **`main.py`** — route handlers:
  - `POST /tools/call`
  - `GET /receipts/{session_id}`
  - `GET /receipts/all` (defined before `/{session_id}` to avoid routing conflict)
  - `GET /stats`
  - `POST /verify`
  - `POST /demo/run?mode=normal|lying|replit`

CORS middleware enabled (allow all origins).

### Verification flow

`POST /verify` accepts `{session_id, claimed_outputs: [{receipt_id, tool_name, output}]}`. Each claim is matched to that exact receipt within the session. It is verified only when the receipt's tool name and output hash match the claim and its HMAC signature is valid. Verdicts include `signature_valid` and a machine-readable `reason` when verification fails.

The three built-in demos produce these outcomes:

- `normal` — matching claims and receipts: `VERIFIED`
- `lying` — invented receipt IDs with no tool calls: `UNVERIFIED`
- `replit` — executes `db_query` but claims `write_file`: `CONTRADICTED`

## Frontend (`frontend/`)

React 19 + Vite 8 + Tailwind 3. Runs at `http://localhost:5173`. All UI in `frontend/src/App.jsx` + `frontend/src/animations.js`. No routing library, no state management library.

### Design tokens (App.jsx)

```
BG='var(--bg)'  DARK='var(--fg)'  RUST='var(--rust)'  GREEN='var(--green)'
RED='var(--red)'  CREAM='var(--cream)'  MUTED='var(--muted)'  MID='var(--mid)'
TMBG='var(--tmbg)'  TMFG='var(--tmfg)'
SERIF="'Source Serif 4','Times New Roman',serif"
MONO="'JetBrains Mono',ui-monospace,..."
```

**Design rule: zero emojis.** Status indicators use CSS dots and color. CONTRADICTED = bold red uppercase. VERIFIED = green dot + green text.

### Two views (tab switching)

- **Landing** — full marketing page, 8 sections
- **Dashboard** — Verdicts + Live Ledger only

Tab transition: 200ms fade-out+slide-left → swap view → 300ms fade-in+slide-right. Implemented via `viewAnim` state + `switchView()` in App root.

### Landing page sections

1. **Nav** — sticky, transparent → frosted at 100px scroll (`[data-nav]` / `.nav-scrolled`). Active section underline slides from left via `data-nav-link` + `nav-link-active`.
2. **Hero** — serif headings with staggered `data-animate="fade-up"` (0/150/300/450/600ms). Receipt card slides in from right (`data-animate="fade-right"`), then floats at -2.2deg continuously.
3. **How It Works** — 2×3 bordered grid, 6 steps, `stagger-children` 100ms.
4. **Incidents** — two story cards side by side. Left slides from left, right from right (700ms). Each card has a viewport-triggered typing animation (`IntersectionObserver` → `setTimeout(play, 900)`, fires once). Replay button resets.
5. **Anatomy** — left sticky block fades from left; right 7-field table rows stagger up 80ms.
6. **Three Verdicts** — live demo columns with `stagger-children` 120ms. Each calls `POST /demo/run`. Results show receipt cards + verdict badge.
7. **Quickstart** — split layout, setup terminal on right.
8. **Footer**

### Animation system (`frontend/src/animations.js`)

`initAnimations()` — called once per view change (50ms after mount). Returns cleanup fn.

- `watchScrollAnimations()` — single `IntersectionObserver` at 15% threshold, handles all `[data-animate]` elements. Stagger containers get per-child `transitionDelay` before `is-visible` is added (double-rAF to ensure initial hidden state paints first).
- `watchNavScroll()` — toggles `.nav-scrolled` at 100px.
- `watchActiveSections()` — watches `#how`, `#incidents`, `#anatomy`, `#verdicts` at 35% threshold, slides underline in/out.
- `countUp(from, to, duration, onUpdate)` — exported separately, used by LiveSection for stats. EaseOutQuart via `requestAnimationFrame`.

`prefers-reduced-motion` respected: all `[data-animate]` elements get `is-visible` immediately, animations disabled via CSS media query.

### Live Ledger (`LiveSection`)

- Polls `/stats` + `/receipts/all` every 3 seconds.
- Stats count up from 0 on first load (once, tracked by `hasCountedRef`).
- New rows detected via `prevIdsRef` — highlighted amber for 2s (`.row-new` keyframe).
- First 10 rows fade up with 40ms stagger on mount.
- Click any row to expand full receipt detail (max-height transition, 320ms).

## How to run

```bash
# Terminal 1 — backend
cd ~/receipts && source .venv/bin/activate
cd backend
RECEIPT_SECRET=dev-secret python3 -m uvicorn main:app --reload

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

`tests/test_verification.py` uses isolated temporary SQLite databases. It covers receipt-ID requirements, repeated tool calls, output mismatches, tampered signatures, invalid receipt references, and all demo verdicts.

## What does NOT exist yet

- Real tool implementations (everything is mocked — no actual file I/O, HTTP, or DB)
- Authentication / API keys on any endpoint

## Compatibility note

`/verify` requires `receipt_id` for every claim. Legacy callers using only `tool_name` and `output` must be updated.
