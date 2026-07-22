"""Core verification logic — reused by the /verify endpoint and auto_verify."""
from models import VerifyVerdict
from database import get_receipt_for_session, update_receipt_verdict
from signer import compute_claimed_hash, verify_receipt_signature, verify_receipt_content


def run_verify(session_id: str, claimed_outputs: list) -> list[VerifyVerdict]:
    """Verify a list of ClaimedOutput objects against the stored ledger.

    Accepts Pydantic ClaimedOutput instances or plain dicts with the same keys.
    Writes per-receipt verdicts back to the DB as a side effect.
    """
    verdicts: list[VerifyVerdict] = []

    for claimed in claimed_outputs:
        if hasattr(claimed, "receipt_id"):
            receipt_id = claimed.receipt_id
            tool_name  = claimed.tool_name
            output     = claimed.output
        else:
            receipt_id = claimed["receipt_id"]
            tool_name  = claimed["tool_name"]
            output     = claimed["output"]

        claimed_hash = compute_claimed_hash(output)
        stored = get_receipt_for_session(receipt_id, session_id)

        if stored is None:
            verdicts.append(VerifyVerdict(
                receipt_id=receipt_id,
                tool_name=tool_name,
                verified=False,
                claimed_hash=claimed_hash,
                actual_hash=None,
                signature_valid=None,
                reason="receipt_not_found",
            ))
            continue

        actual_hash     = stored["output_hash"]
        signature_valid = verify_receipt_signature(stored) and verify_receipt_content(stored)
        tool_matches    = stored["tool_name"] == tool_name
        output_matches  = claimed_hash == actual_hash

        reason = (
            "tool_name_mismatch"  if not tool_matches    else
            "signature_invalid"   if not signature_valid else
            "output_hash_mismatch" if not output_matches  else
            None
        )
        row_verdict = (
            "TAMPERED"     if not signature_valid else
            "VERIFIED"     if (tool_matches and output_matches) else
            "CONTRADICTED"
        )
        update_receipt_verdict(receipt_id, row_verdict)
        verdicts.append(VerifyVerdict(
            receipt_id=receipt_id,
            tool_name=tool_name,
            verified=(tool_matches and signature_valid and output_matches),
            claimed_hash=claimed_hash,
            actual_hash=actual_hash,
            signature_valid=signature_valid,
            reason=reason,
        ))

    return verdicts


def derive_verdict(verdicts: list[VerifyVerdict]) -> str:
    """Compute the session-level verdict from a list of per-receipt verdicts."""
    if not verdicts:
        return "UNVERIFIED"
    if any(v.signature_valid is False for v in verdicts):
        return "TAMPERED"
    if all(v.verified for v in verdicts):
        return "VERIFIED"
    # Severity: a provable mismatch (receipt exists, signature valid, but the
    # claim differs) outranks a missing receipt. Only when the sole problem is
    # missing receipts can we say nothing more than UNVERIFIED.
    if any(v.signature_valid is True and not v.verified for v in verdicts):
        return "CONTRADICTED"
    return "UNVERIFIED"
