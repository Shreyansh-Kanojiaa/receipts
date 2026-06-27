# Receipts MCP Proxy

`receipts_mcp/` is a stdio MCP server that sits between an MCP client and one or more upstream MCP servers.

For each tool call:

1. The client calls the Receipts proxy.
2. The proxy forwards the call to the real upstream MCP server.
3. The real output is captured.
4. The proxy POSTs that result to `POST /tools/record` on the Receipts backend.
5. The real result is returned to the client even if receipting fails.

Upstream tools are namespaced as `<server>__<tool>` so collisions do not clobber each other.

If no upstream config file exists, the proxy falls back to the built-in demo tools:

- `write_file`
- `http_fetch`
- `db_query`

Those demo tools are forwarded to the backend's `/tools/call` endpoint.

## Setup

```bash
pip install receipts-mcp
cp upstreams.json.example upstreams.json
```

## Configuration

`receipts_mcp/config.py` reads environment variables and an upstreams JSON file.

Environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `RECEIPTS_URL` | `http://localhost:8000` | Receipts backend URL |
| `RECEIPTS_API_KEY` | empty | Proxy-role API key used for `/tools/record` |
| `UPSTREAMS_PATH` | `receipts_mcp/upstreams.json` | Path to upstream config |
| `TOOL_TIMEOUT_SECONDS` | `60` | Max time for an upstream tool call |
| `RECORD_TIMEOUT_SECONDS` | `5` | Max time for backend receipting |

The upstreams file supports:

- `stdio`
- `sse`
- `streamable_http`

`${ENV_VAR}` references inside `env` and `headers` are expanded from the process environment.

Example:

```json
{
  "include_demo_tools": false,
  "upstreams": {
    "github": {
      "transport": "stdio",
      "command": "/path/to/github-mcp",
      "args": [],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

## Claude Code / Cursor config

Add this to `~/.claude/claude_mcp_config.json` or the equivalent Cursor MCP config:

```json
{
  "mcpServers": {
    "receipts": {
      "command": "/home/shreyansh/receipts/.venv/bin/python3",
      "args": ["-m", "receipts_mcp.server"],
      "cwd": "/home/shreyansh/receipts",
      "env": {
        "RECEIPTS_URL": "http://localhost:8000",
        "RECEIPTS_API_KEY": "<proxy-key>",
        "UPSTREAMS_PATH": "receipts_mcp/upstreams.json",
        "PYTHONPATH": "/home/shreyansh/receipts"
      }
    }
  }
}
```

Restart the MCP client after changing the config.

## Runtime behavior

- One proxy process gets one `mcp-<hex>` session ID.
- All tool calls from that process share that session so they can be reconciled together.
- If the backend is unreachable, the tool result still returns and the receipt is skipped.
- If the backend rejects the API key, the proxy logs it as a configuration error.

## Run

```bash
python3 -m receipts_mcp
```

or

```bash
python3 -m receipts_mcp.server
```
