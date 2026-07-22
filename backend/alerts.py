"""Alert delivery: fires webhook, email, or Slack notifications after any verdict."""
import asyncio
import json
import smtplib
import socket
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import httpx

from database import get_enabled_rules_for_verdict, has_delivered, record_alert_delivery
from logging_config import get_logger

logger = get_logger("receipts.alerts")

_RETRY_DELAY_SECONDS = 1.0


async def fire_alerts(verdict: str, session_id: str, receipt: dict) -> None:
    """Called after any verdict is determined. Fires all matching enabled rules.

    Dedups on (rule, session, receipt, verdict): the same underlying event can reach
    here from auto_verify, /verify, and /sessions/{id}/verify-claim independently, and
    should only ever notify once. Each send is retried once before being recorded as
    failed, and every attempt (sent or failed) is persisted for audit/observability.
    """
    receipt_id = receipt.get("id")
    rules = get_enabled_rules_for_verdict(verdict)
    for rule in rules:
        if has_delivered(rule["id"], session_id, receipt_id, verdict):
            continue

        config = json.loads(rule["config"])
        error = None
        for attempt in (1, 2):
            try:
                if rule["channel"] == "webhook":
                    await send_webhook(rule, config, verdict, session_id, receipt)
                elif rule["channel"] == "email":
                    await send_email(rule, config, verdict, session_id, receipt)
                elif rule["channel"] == "slack":
                    await send_slack(rule, config, verdict, session_id, receipt)
                error = None
                break
            except Exception as e:
                error = str(e)
                if attempt == 1:
                    await asyncio.sleep(_RETRY_DELAY_SECONDS)

        if error is None:
            record_alert_delivery(rule["id"], session_id, receipt_id, verdict, "sent")
        else:
            logger.error(
                "alert delivery failed after retry",
                extra={
                    "rule_id": rule["id"], "channel": rule["channel"],
                    "verdict": verdict, "session_id": session_id, "error": error,
                },
            )
            record_alert_delivery(rule["id"], session_id, receipt_id, verdict, "failed", error=error)


async def send_webhook(rule, config, verdict, session_id, receipt):
    payload = build_alert_payload(verdict, session_id, receipt)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(config["url"], json=payload)
        resp.raise_for_status()
    logger.info("webhook alert fired", extra={"url": config["url"], "verdict": verdict})


async def send_email(rule, config, verdict, session_id, receipt):
    subject = f"[Receipts] {verdict} — Session {session_id[:16]}..."
    body = build_email_body(verdict, session_id, receipt)

    msg = MIMEMultipart()
    msg["From"] = config["smtp_user"]
    msg["To"] = config["to"]
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))

    await asyncio.get_event_loop().run_in_executor(
        None,
        lambda: _send_smtp(config, msg),
    )
    logger.info("email alert sent", extra={"to": config["to"], "verdict": verdict})


def _send_smtp(config, msg):
    host = config["smtp_host"]
    port = int(config["smtp_port"])
    # Force IPv4. smtplib tries resolved addresses sequentially (no Happy Eyeballs),
    # so when getaddrinfo returns an IPv6 address first and the Docker bridge has no
    # IPv6 route, the connect fails with [Errno 101] Network is unreachable before it
    # ever reaches the IPv4 address. Resolving to IPv4 ourselves sidesteps that; we
    # restore the hostname on the object so STARTTLS still validates the cert via SNI.
    ipv4 = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)[0][4][0]
    with smtplib.SMTP(ipv4, port, timeout=15) as server:
        server._host = host
        server.starttls()
        server.login(config["smtp_user"], config["smtp_pass"])
        server.send_message(msg)


async def send_slack(rule, config, verdict, session_id, receipt):
    payload = {
        "text": f"*[Receipts] {verdict}*",
        "blocks": [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": (
                        f"*Verdict:* `{verdict}`\n"
                        f"*Session:* `{session_id}`\n"
                        f"*Tool:* `{receipt.get('tool_name')}`\n"
                        f"*Time:* {receipt.get('timestamp')}"
                    ),
                },
            }
        ],
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(config["webhook_url"], json=payload)
        resp.raise_for_status()
    logger.info("slack alert fired", extra={"verdict": verdict})


def build_alert_payload(verdict, session_id, receipt):
    return {
        "event": f"verdict.{verdict.lower()}",
        "verdict": verdict,
        "session_id": session_id,
        "receipt_id": receipt.get("id"),
        "tool_name": receipt.get("tool_name"),
        "timestamp": receipt.get("timestamp"),
        "input_hash": receipt.get("input_hash"),
        "output_hash": receipt.get("output_hash"),
        "hmac_signature": receipt.get("hmac_signature"),
        "source": "receipts-v1",
    }


def build_email_body(verdict, session_id, receipt):
    return f"""Receipts Alert — {verdict}

Session:   {session_id}
Tool:      {receipt.get('tool_name')}
Verdict:   {verdict}
Timestamp: {receipt.get('timestamp')}
Receipt:   {receipt.get('id')}

Signature: {receipt.get('hmac_signature')}

---
This alert was sent by Receipts.
View your dashboard at http://localhost:5173
"""
