"""A minimal real MCP server used as a proxy upstream in tests.

Exposes one tool, ``echo``, that returns structured content. Run over stdio:
    python -m tests.fixtures.mock_upstream
"""
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("mockupstream")


@mcp.tool(description="Echo the message back with a marker proving real execution.")
def echo(message: str) -> dict:
    return {"echoed": message, "ran_on": "mock-upstream"}


if __name__ == "__main__":
    mcp.run(transport="stdio")
