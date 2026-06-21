import hashlib
import hmac
import json
import os
import uuid
from datetime import datetime, timezone

SECRET: bytes = os.environ.get("RECEIPT_SECRET", "dev-secret-do-not-use").encode("utf-8")


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
