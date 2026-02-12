# MCP Protocol Transport

## Purpose
COE exposes its tools via the Model Context Protocol (MCP), enabling external AI coding agents to interact with the orchestration system.

## Transports

### HTTP JSON-RPC (Primary)
- **Endpoint**: `POST http://localhost:3030/mcp`
- **Format**: JSON-RPC 2.0
- **Discovery**: `GET http://localhost:3030/mcp/sse` (Server-Sent Events)

### Stdio (Alternative)
- **Class**: `StdioMCPTransport`
- **Format**: Newline-delimited JSON-RPC 2.0
- **Usage**: For CLI tools and external process integrations

### Legacy HTTP (Backward Compatible)
- **List tools**: `GET http://localhost:3030/tools`
- **Call tool**: `POST http://localhost:3030/call`
- These endpoints remain for backward compatibility

## Protocol Methods

### `initialize`
```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
```
Returns: `protocolVersion`, `capabilities`, `serverInfo`

### `tools/list`
```json
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
```
Returns: Array of tool definitions with name, description, inputSchema

### `tools/call`
```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"getNextTask","arguments":{}}}
```
Returns: MCP content format `[{type: "text", text: "..."}]`

## Available Tools
1. **getNextTask** — Get highest-priority ready task with context
2. **reportTaskDone** — Mark task complete, trigger verification
3. **askQuestion** — Ask for clarification during implementation
4. **getErrors** — Report errors, auto-creates investigation tasks
5. **callCOEAgent** — Call a specific agent directly
6. **scanCodeBase** — Check plan-vs-implementation drift

## Error Codes
- `-32700`: Parse error (malformed JSON)
- `-32600`: Invalid Request (missing jsonrpc: "2.0")
- `-32601`: Method not found
- `-32602`: Invalid params (tool not found)
- `-32603`: Internal error (tool execution failed)

## SSE Discovery
The `/mcp/sse` endpoint sends:
1. `event: endpoint` with the JSON-RPC URL
2. Periodic pings to keep the connection alive
