from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel



class ToolCallRequest(BaseModel):
    tool_name: str
    tool_input: dict[str, Any]
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


class ClaimedOutput(BaseModel):
    tool_name: str
    output: dict[str, Any]


class VerifyRequest(BaseModel):
    session_id: str
    claimed_outputs: list[ClaimedOutput]


class VerifyVerdict(BaseModel):
    tool_name: str
    verified: bool
    claimed_hash: str
    actual_hash: str | None


class VerifyResponse(BaseModel):
    session_id: str
    verdicts: list[VerifyVerdict]


class DemoRunResponse(BaseModel):
    session_id: str
    mode: str
    receipts: list[ReceiptResponse]
    verify_result: VerifyResponse
    verdict: Literal["VERIFIED", "UNVERIFIED", "CONTRADICTED"]
