from typing import Any


def write_file(path: str, content: str) -> dict:
    return {
        "status": "written",
        "path": path,
        "bytes_written": len(content.encode("utf-8")),
    }


def http_fetch(url: str, method: str = "GET") -> dict:
    return {
        "status_code": 200,
        "body": "<mock response>",
        "url": url,
    }


def db_query(query: str, params: list | None = None) -> dict:
    mock_rows = [{"id": 1, "value": "mock_a"}, {"id": 2, "value": "mock_b"}]
    return {
        "rows": mock_rows,
        "row_count": len(mock_rows),
        "query": query,
    }


TOOL_REGISTRY: dict[str, Any] = {
    "write_file": write_file,
    "http_fetch": http_fetch,
    "db_query": db_query,
}


def execute_tool(tool_name: str, tool_input: dict) -> dict:
    fn = TOOL_REGISTRY[tool_name]
    return fn(**tool_input)
