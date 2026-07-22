"""API-key authentication.

Keys are presented as ``Authorization: Bearer <key>`` (or ``X-API-Key: <key>``) and
validated against SHA-256 hashes stored in the ``api_keys`` table. Three roles:

- ``viewer`` — read-only dashboard access (stats, receipts, sessions).
- ``proxy``  — may record receipts and run verification (the MCP proxy uses this).
- ``admin``  — everything.

Self-hosted bootstrap: the ``API_KEYS`` setting (``label:role:rawkey`` entries,
comma-separated) seeds the table on first startup when it is empty. Raw keys live only
in the operator's env/secret store; the DB only ever holds hashes.
"""
import hashlib
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import Depends, Header, HTTPException, status

from database import insert_api_key, get_api_key_by_hash, count_api_keys
from settings import get_settings
from logging_config import get_logger

logger = get_logger("receipts.auth")

# Role hierarchy: a key satisfies any requirement at or below its level.
_ROLE_RANK = {"viewer": 1, "proxy": 2, "admin": 3}


def hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def create_api_key(label: str, role: str) -> dict:
    """Mint a new API key. Returns the row plus the raw key — the only time it is
    ever available; only its SHA-256 hash is persisted."""
    raw = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc).isoformat()
    key_id = str(uuid.uuid4())
    insert_api_key(id=key_id, key_hash=hash_key(raw), label=label, role=role, created_at=now)
    return {"id": key_id, "label": label, "role": role, "created_at": now, "revoked_at": None, "key": raw}


def seed_api_keys() -> None:
    """Seed api_keys from the API_KEYS setting if the table is empty."""
    if count_api_keys() > 0:
        return
    raw = get_settings().api_keys.strip()
    if not raw:
        return
    now = datetime.now(timezone.utc).isoformat()
    seeded = 0
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        parts = entry.split(":")
        if len(parts) != 3:
            logger.warning("ignoring malformed API_KEYS entry (want label:role:key)")
            continue
        label, role, key = (p.strip() for p in parts)
        if role not in _ROLE_RANK:
            logger.warning("ignoring API_KEYS entry with unknown role", extra={"role": role})
            continue
        insert_api_key(
            id=str(uuid.uuid4()), key_hash=hash_key(key),
            label=label, role=role, created_at=now,
        )
        seeded += 1
    if seeded:
        logger.info("seeded API keys", extra={"count": seeded})


def _extract_key(authorization: str | None, x_api_key: str | None) -> str | None:
    if authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer" and token:
            return token.strip()
    if x_api_key:
        return x_api_key.strip()
    return None


def require_role(required: str):
    """Build a FastAPI dependency enforcing a minimum role.

    Returns the matched api_keys row (incl. tenant_id) so handlers can carry tenant
    context once multi-tenancy lands.
    """
    min_rank = _ROLE_RANK[required]

    async def _dep(
        authorization: str | None = Header(default=None),
        x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    ) -> dict:
        presented = _extract_key(authorization, x_api_key)
        if not presented:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing API key",
                headers={"WWW-Authenticate": "Bearer"},
            )
        record = get_api_key_by_hash(hash_key(presented))
        if record is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid API key",
                headers={"WWW-Authenticate": "Bearer"},
            )
        if _ROLE_RANK.get(record["role"], 0) < min_rank:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires '{required}' role",
            )
        return record

    return _dep


# Convenience dependencies for the route layer.
require_viewer = require_role("viewer")
require_proxy = require_role("proxy")
require_admin = require_role("admin")
