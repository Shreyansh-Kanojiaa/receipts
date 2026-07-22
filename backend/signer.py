import hashlib
import hmac
import json
import uuid
from datetime import datetime, timezone

from settings import get_settings

# Resolved once at import. In production a missing/weak RECEIPT_SECRET raises here
# (fail-fast); in dev/CI it falls back to a well-known dev key. See settings.py.
SECRET: bytes = get_settings().resolved_secret()


def _stable_json(obj: dict) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def hash_dict(obj: dict) -> str:
    return hashlib.sha256(_stable_json(obj).encode("utf-8")).hexdigest()


def sign_receipt(fields: dict) -> str:
    canonical = {
        k: fields[k]
        for k in ("id", "session_id", "tool_name", "timestamp", "input_hash", "output_hash", "status")
    }
    message = _stable_json(canonical).encode("utf-8")
    return hmac.new(SECRET, message, hashlib.sha256).hexdigest()


def verify_receipt_signature(receipt: dict) -> bool:
    """Return whether a stored receipt still matches its HMAC signature."""
    return hmac.compare_digest(
        sign_receipt(receipt),
        receipt["hmac_signature"],
    )


def verify_receipt_content(receipt: dict) -> bool:
    """Return whether the stored raw tool_input/tool_output still hash to the
    stored input_hash/output_hash columns.

    The HMAC only covers the hash columns, not the raw payload (see sign_receipt),
    so a direct edit to the raw tool_input/tool_output blobs that leaves the hash
    columns untouched passes verify_receipt_signature. This catches that case.

    tool_input/tool_output are nullable columns (added after the fact via ALTER
    TABLE), so a row that never had them populated has nothing to check content
    tampering against — that's "unknown", not "tampered", so it passes here.
    """
    if receipt.get("tool_input") is None or receipt.get("tool_output") is None:
        return True
    return (
        hash_dict(receipt["tool_input"]) == receipt["input_hash"]
        and hash_dict(receipt["tool_output"]) == receipt["output_hash"]
    )


def build_receipt(
    session_id: str,
    tool_name: str,
    tool_input: dict,
    tool_output: dict,
    status: str,
) -> dict:
    partial = {
        "id": str(uuid.uuid4()),
        "session_id": session_id,
        "tool_name": tool_name,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "input_hash": hash_dict(tool_input),
        "output_hash": hash_dict(tool_output),
        "status": status,
    }
    partial["hmac_signature"] = sign_receipt(partial)
    return partial


def compute_claimed_hash(output: dict) -> str:
    return hash_dict(output)
