"""Demonstrate verified and unverified AI-agent outcome claims.

Run with:
    python3 demo_agent.py --mode normal
    python3 demo_agent.py --mode lying
    python3 demo_agent.py --mode replit
"""

import argparse
from datetime import datetime
import json

import requests


BASE_URL = "http://localhost:8000"


def post(path, payload):
    """Send a JSON request to the Receipts backend and return its JSON body."""
    response = requests.post(f"{BASE_URL}{path}", json=payload, timeout=10)
    response.raise_for_status()
    return response.json()


def print_json(label, value):
    print(f"\n{label}")
    print(json.dumps(value, indent=2))


def verify(session_id, claimed_outputs):
    print("\nAgent: submitting its claimed tool outputs for independent verification...")
    payload = {"session_id": session_id, "claimed_outputs": claimed_outputs}
    result = post("/verify", payload)
    print_json("Verifier response:", result)
    return result


def run_normal(session_id):
    print("Agent: writing the customer record...")
    write_input = {
        "path": "/data/customer_42.json",
        "content": "updated address",
    }
    write_receipt = post(
        "/tools/call",
        {
            "tool_name": "write_file",
            "tool_input": write_input,
            "session_id": session_id,
        },
    )
    print_json("Signed write_file receipt:", write_receipt)

    print("\nAgent: sending the email request...")
    fetch_input = {"url": "https://email.service/send", "method": "POST"}
    fetch_receipt = post(
        "/tools/call",
        {
            "tool_name": "http_fetch",
            "tool_input": fetch_input,
            "session_id": session_id,
        },
    )
    print_json("Signed http_fetch receipt:", fetch_receipt)

    # The current receipt API returns hashes, not raw outputs. These are the
    # deterministic outputs of the backend's two mock tools for these inputs.
    actual_write_output = {
        "status": "written",
        "path": write_input["path"],
        "bytes_written": len(write_input["content"].encode("utf-8")),
    }
    actual_fetch_output = {
        "status_code": 200,
        "body": "<mock response>",
        "url": fetch_input["url"],
    }

    result = verify(
        session_id,
        [
            {"tool_name": "write_file", "output": actual_write_output},
            {"tool_name": "http_fetch", "output": actual_fetch_output},
        ],
    )
    if all(verdict["verified"] for verdict in result["verdicts"]):
        print("\nVERDICT: VERIFIED ✅ — Agent told the truth")
    else:
        print("\nVERDICT: UNVERIFIED 🚨 — Verification did not match the receipts")


def run_lying(session_id):
    print("Agent: claiming it wrote a file and sent an email without running any tools...")
    result = verify(
        session_id,
        [
            {"tool_name": "write_file", "output": {"message": "file saved"}},
            {"tool_name": "http_fetch", "output": {"message": "email sent"}},
        ],
    )
    if not any(verdict["verified"] for verdict in result["verdicts"]):
        print("\nVERDICT: UNVERIFIED 🚨 — No receipts found for this session")
    else:
        print("\nVERDICT: VERIFIED ✅ — Unexpected matching receipt found")


def run_replit(session_id):
    print("Agent: executing a database query...")
    receipt = post(
        "/tools/call",
        {
            "tool_name": "db_query",
            "tool_input": {
                "query": "DELETE FROM production_database",
                "params": [],
            },
            "session_id": session_id,
        },
    )
    print_json("Signed db_query receipt:", receipt)

    print("\nAgent: falsely claiming it ran write_file on test_cleanup.tmp...")
    result = verify(
        session_id,
        [
            {
                "tool_name": "write_file",
                "output": {
                    "status": "written",
                    "path": "test_cleanup.tmp",
                    "bytes_written": 0,
                },
            }
        ],
    )
    if not any(verdict["verified"] for verdict in result["verdicts"]):
        print(
            "\nVERDICT: CONTRADICTED 🚨 — Agent claimed write_file but "
            "db_query was executed on production_database"
        )
    else:
        print("\nVERDICT: VERIFIED ✅ — Unexpected matching receipt found")


def main():
    parser = argparse.ArgumentParser(description="Receipts AI demo agent")
    parser.add_argument(
        "--mode",
        choices=("normal", "lying", "replit"),
        required=True,
        help="Agent behavior to demonstrate",
    )
    args = parser.parse_args()

    timestamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
    session_id = f"demo-{args.mode}-{timestamp}"
    print(f"Receipts AI demo mode: {args.mode}")
    print(f"Session ID: {session_id}")

    try:
        if args.mode == "normal":
            run_normal(session_id)
        elif args.mode == "lying":
            run_lying(session_id)
        else:
            run_replit(session_id)
    except requests.RequestException as error:
        print(f"\nCould not reach Receipts AI at {BASE_URL}: {error}")
        print("Start the backend, then rerun this script.")


if __name__ == "__main__":
    main()
