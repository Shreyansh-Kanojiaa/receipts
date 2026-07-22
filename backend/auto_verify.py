"""Auto-verification: checks HMAC integrity of all receipts in a session.

This only detects TAMPERED (signature mismatch) or VERIFIED (all intact).
It cannot detect CONTRADICTED or UNVERIFIED because those require the agent's
original claimed output — which is only available in manual reconciliation.
"""
from datetime import datetime, timezone

from database import (
    get_receipts_for_session,
    get_session,
    update_session_verdict,
    update_session_status,
    update_receipt_verdict,
)
from signer import verify_receipt_signature, verify_receipt_content
from logging_config import get_logger
from alerts import fire_alerts

logger = get_logger("receipts.verify")


async def auto_verify(session_id: str) -> str | None:
    """Check HMAC signatures for every receipt in the session.

    Returns 'TAMPERED', 'VERIFIED', or None (no receipts — scope unknown).
    """
    t0 = datetime.now(timezone.utc)

    # Don't overwrite a full-claim verdict set by demo_run or manual reconciliation.
    existing = get_session(session_id)
    if existing and existing.get("verification_scope") == "full_claim":
        logger.info(
            "auto_verify skipped: full_claim verdict already set",
            extra={"session_id": session_id},
        )
        return existing.get("auto_verdict")

    receipts = get_receipts_for_session(session_id)

    if not receipts:
        # Session exists but no tools were called — we know nothing.
        # Don't write a verdict; just mark it closed.
        update_session_status(session_id, "closed")
        logger.info(
            "auto_verify: no receipts, verdict deferred to manual reconciliation",
            extra={"session_id": session_id},
        )
        return None

    tampered = [
        r for r in receipts
        if not verify_receipt_signature(r) or not verify_receipt_content(r)
    ]

    # Record the per-receipt verdict for tampered rows so the ledger and the
    # tamper_alerts stat reflect tampering caught on this signature-only path.
    # Intact receipts are left unmarked: a valid signature does not prove the
    # agent's *claim* was correct, so we don't write 'VERIFIED' here.
    for r in tampered:
        update_receipt_verdict(r["id"], "TAMPERED")
        await fire_alerts("TAMPERED", session_id, r)

    verdict = "TAMPERED" if tampered else "VERIFIED"
    now = datetime.now(timezone.utc).isoformat()
    update_session_verdict(session_id, verdict, now, scope="signature_only")

    duration_ms = int((datetime.now(timezone.utc) - t0).total_seconds() * 1000)
    logger.info(
        "auto_verify complete (signature-only)",
        extra={
            "session_id": session_id,
            "verdict": verdict,
            "scope": "signature_only",
            "receipt_count": len(receipts),
            "duration_ms": duration_ms,
        },
    )

    return verdict
