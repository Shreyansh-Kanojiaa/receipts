"""Central configuration for the Receipts backend.

Every tunable that used to be a hardcoded literal (the signing secret, the DB path,
CORS origins, the session-timeout intervals) is read from the environment here, so the
same image can run in dev, CI, and production without code changes.

Production safety: the dev signing-secret fallback only applies when
``ENVIRONMENT`` is not ``production``. In production a missing/weak
``RECEIPT_SECRET`` is a hard startup failure — signatures must never be forgeable.

Env vars are read un-prefixed by field name (uppercased): ``ENVIRONMENT``,
``RECEIPT_SECRET``, ``DATABASE_URL``, ``CORS_ORIGINS``, ``API_KEYS``, etc.
"""
from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

# Used only in dev/CI when RECEIPT_SECRET is unset. Never reached in production
# (resolved_secret() raises there instead).
_DEV_SECRET = "dev-secret-do-not-use"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ── environment ──────────────────────────────────────────────────────────
    # "development" | "production". Drives secret fail-fast and CORS defaults.
    # A Literal so a typo (e.g. "prod") fails fast at startup instead of silently
    # falling back to the insecure dev signing key in what is really production.
    environment: Literal["development", "production"] = "development"

    # ── signing ──────────────────────────────────────────────────────────────
    # Maps to the existing RECEIPT_SECRET env var (no RECEIPTS_ prefix) for
    # backwards compatibility with the documented setup.
    receipt_secret: str | None = None

    # ── storage ──────────────────────────────────────────────────────────────
    # SQLAlchemy-style URL so a Postgres DSN can slot in later. Today only the
    # sqlite:/// form is honored (parsed into a filesystem path in database.py).
    database_url: str = "sqlite:///./receipts.db"

    # ── http / cors ──────────────────────────────────────────────────────────
    # Comma-separated origins, or "*" for dev. Locked down via env in production.
    cors_origins: str = "*"

    # ── auth ─────────────────────────────────────────────────────────────────
    # Bootstrap API keys: comma-separated "label:role:rawkey" entries. Seeded
    # into the api_keys table on first startup if the table is empty.
    api_keys: str = ""

    # ── behavior ─────────────────────────────────────────────────────────────
    enable_demo_tools: bool = True
    inactivity_timeout_seconds: int = 30
    checker_interval_seconds: int = 10

    # ── ops ──────────────────────────────────────────────────────────────────
    log_level: str = "INFO"
    log_json: bool = True
    rate_limit: str = "120/minute"

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() == "production"

    @property
    def cors_origin_list(self) -> list[str]:
        raw = self.cors_origins.strip()
        if raw == "*":
            return ["*"]
        return [o.strip() for o in raw.split(",") if o.strip()]

    def resolved_secret(self) -> bytes:
        """Return the HMAC signing key, enforcing production safety.

        In production a missing or short (<16 char) secret raises immediately.
        In dev/CI an unset secret falls back to a well-known dev value.
        """
        secret = self.receipt_secret
        if self.is_production:
            if not secret or len(secret) < 16:
                raise RuntimeError(
                    "RECEIPT_SECRET must be set to at least 16 characters when "
                    "ENVIRONMENT=production — refusing to start with a "
                    "forgeable signing key."
                )
            return secret.encode("utf-8")
        return (secret or _DEV_SECRET).encode("utf-8")


@lru_cache
def get_settings() -> Settings:
    return Settings()
