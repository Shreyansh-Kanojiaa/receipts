# Changelog

All notable changes to this project are documented here.

## [0.2.0]

### Round 2 — regression fix, provisioning/CI, alert reliability, audit integrity, resilience

- Fixed a regression from the previous round: `verify_receipt_content` was misclassifying
  receipts with legacy/NULL `tool_input`/`tool_output` columns as `TAMPERED`.
- Added `POST /api-keys` to mint new API keys (the previous round shipped revoke/list
  but no way to provision a new key afterward) and `GET /whoami` for self-lockout warnings.
- Added a CI workflow (`.github/workflows/ci.yml`) running the full backend test suite,
  frontend lint, and frontend build on every push/PR; fixed `publish.yml` to run the full
  test suite instead of a subset.
- Alert delivery is now persisted (`alert_deliveries` table), deduplicated across
  `auto_verify`/`verify`/`verify-claim` call paths, and retried once before being
  recorded as failed.
- Fixed the ledger and audit-report export silently capping at 50 receipts; added a
  fetch-limit control and a truncation indicator.
- Fixed several remaining silent-failure spots in the dashboard (Sessions/Reconciliation/
  Alerts views, session-close, API-key revoke).
- SQLite connections now run in WAL mode with a busy_timeout, and are explicitly closed.
- The MCP proxy now retries a failed receipt POST and upstream connection once, and logs
  an aggregate "N of M calls not receipted" warning at shutdown instead of only per-call
  warnings.
- Documented the `http` transport alias and four previously-undocumented env vars in
  README/`.env.example`; added upper-bound version pins to dependencies.

### Round 1 — hardening pass (commit `cb70ce8`)

- Gated `/demo/run` behind `ENABLE_DEMO_TOOLS`; redacted alert channel secrets (SMTP
  password, webhook/Slack URLs) from viewer-role reads.
- Added `verify_receipt_content` to catch direct database edits to raw `tool_input`/
  `tool_output` that leave the hash columns untouched.
- Added API key revocation (`GET/POST /api-keys/{id}/revoke`, admin-only).
- `ENVIRONMENT` is now a strict `Literal["development", "production"]` so a typo fails
  startup instead of silently falling back to the dev signing secret.
- Fixed alerts never firing when an agent claims a `receipt_id` that was never recorded
  (the "lying agent" case), across `/verify`, `/verify-claim`, and `/demo/run`.
- Fixed ledger pagination dead-ends, silent auth-error swallowing in the dashboard,
  fire-and-forget tamper alerts, and a proxy crash on a malformed upstream config entry.
- Added a manual "close session" action, real alert-delivery logging/status checks/config
  validation, an admin-gated Settings API-keys section, delete confirmations, keyboard
  accessibility on the ledger/sessions accordions, and persisted UI preferences.
- Added test coverage for alerts, rate limiting, CORS, `verify-claim?force=true`, and
  `/readyz`'s failure branch; fixed stale docs; added container healthchecks.
