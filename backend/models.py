from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel


class ToolCallRequest(BaseModel):
    tool_name: str
    tool_input: dict[str, Any]
    session_id: str


class ToolRecordRequest(BaseModel):
    """An already-executed tool call to be signed and stored.

    Used by the MCP proxy: the upstream MCP server runs the tool, and the proxy
    sends the real input/output here to be receipted. Unlike ToolCallRequest, the
    backend does NOT execute anything — it only signs and persists.
    """
    tool_name: str
    tool_input: dict[str, Any]
    tool_output: dict[str, Any]
    status: Literal["success", "error"]
    session_id: str


class ReceiptResponse(BaseModel):
    id: str
    session_id: str
    tool_name: str
    timestamp: str
    input_hash: str
    output_hash: str
    status: Literal["success", "error"]
    hmac_signature: str
    verdict:     str             | None = None
    tool_input:  dict[str, Any] | None = None
    tool_output: dict[str, Any] | None = None


class ClaimedOutput(BaseModel):
    receipt_id: str
    tool_name: str
    output: dict[str, Any]


class VerifyRequest(BaseModel):
    session_id: str
    claimed_outputs: list[ClaimedOutput]


class VerifyVerdict(BaseModel):
    receipt_id: str
    tool_name: str
    verified: bool
    claimed_hash: str
    actual_hash: str | None
    signature_valid: bool | None
    reason: str | None = None


class VerifyResponse(BaseModel):
    session_id: str
    verdicts: list[VerifyVerdict]


class DemoRunResponse(BaseModel):
    session_id: str
    mode: str
    receipts: list[ReceiptResponse]
    verify_result: VerifyResponse
    verdict: Literal["VERIFIED", "UNVERIFIED", "CONTRADICTED"]


class SessionResponse(BaseModel):
    session_id: str
    created_at: str
    last_activity: str
    closed_at: str | None = None
    status: str
    auto_verdict: str | None = None
    auto_verified_at: str | None = None
    receipt_count: int
    verification_scope: str | None = None  # 'signature_only' | 'full_claim' | None


class CloseSessionResponse(BaseModel):
    session_id: str
    status: str
    receipt_count: int
    auto_verify_scheduled: bool


class AlertRuleCreate(BaseModel):
    name: str
    trigger: Literal["CONTRADICTED", "TAMPERED", "UNVERIFIED", "ANY"]
    channel: Literal["webhook", "email", "slack"]
    config: dict[str, Any]


class AlertRuleUpdate(BaseModel):
    name: str | None = None
    enabled: bool | None = None
    trigger: Literal["CONTRADICTED", "TAMPERED", "UNVERIFIED", "ANY"] | None = None
    channel: Literal["webhook", "email", "slack"] | None = None
    config: dict[str, Any] | None = None


class AlertRuleResponse(BaseModel):
    id: str
    name: str
    enabled: bool
    trigger: str
    channel: str
    config: dict[str, Any]
    created_at: str
