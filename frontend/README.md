# Receipts Frontend

This is the dashboard for the Receipts backend. It is a single React + Vite SPA with no router or separate state library.

## What it shows

The app lives mostly in `src/App.jsx` and has these views:

- Live Ledger
- Sessions
- Reconciliation
- Alerts
- Help
- Settings

The Live Ledger polls the backend and shows receipts, verdicts, and session state in near real time. Reconciliation compares stored receipts to claimed outputs and persists full-claim verification on the backend. Alerts lets operators create, toggle, test, and delete verdict notification rules.

## Stack

- React 19
- Vite 8
- Tailwind 3
- Plain CSS and inline style objects for most of the UI

## Files

- `src/App.jsx` - all views, components, and fetch logic
- `src/animations.js` - shared animation helper, currently `countUp()`
- `src/index.css` - design tokens and keyframes
- `nginx.conf` - production container reverse proxy

## Development

```bash
npm install
npm run dev
```

By default the app talks to the backend on the same origin through Vite proxy rules. During local development set:

- `VITE_BACKEND_URL` if the backend is not on the default origin
- `VITE_RECEIPTS_VIEWER_KEY` so the dashboard can call read and reconciliation endpoints

Example:

```bash
echo "VITE_RECEIPTS_VIEWER_KEY=devproxy" > .env.local
```

## Production container

The frontend Docker image builds the Vite bundle and serves it through nginx. The nginx config proxies backend API paths and injects the proxy API key at request time, so the browser bundle does not contain secrets.

Relevant environment variables:

- `BACKEND_HOST`
- `PROXY_KEY`

## Behavior notes

- The dashboard is intentionally dense and operational, not a marketing page.
- The Live Ledger polls `/stats`, `/receipts/all`, and `/sessions`.
- Reconciliation uses `/sessions/{id}/verify-claim`.
- The report button exports a JSON audit snapshot from the current ledger and stats.

## Build and lint

```bash
npm run build
npm run lint
```
