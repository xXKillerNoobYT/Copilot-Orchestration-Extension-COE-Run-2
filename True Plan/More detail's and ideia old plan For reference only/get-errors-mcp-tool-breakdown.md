# get_errors MCP Tool Breakdown
**Last Updated**: February 1, 2026  
**Status**: Partial (New MCP tool definition)
**Original Request**: "Fix the 'get_errors' properly" (MCP Tool)
**Date**: 2026-01-29
**Reason for Breakdown**: Implementation + registration + tests estimated >20 minutes.

## Scope Decision
Implement a new MCP tool named `getErrors` that exposes quality-gate diagnostics stored in `.vscode/quality-diagnostics.json` (TypeScript errors, skipped tests, coverage warnings). This allows agents to query errors directly via MCP.

## Acceptance Criteria (Overall)
- MCP tool `getErrors` returns a structured response with:
  - `typeScriptErrors` (file, line, column, code, message)
  - `skippedTests` (file, line, pattern, match)
  - `underCoverageFiles` (file, coverage)
  - `timestamp` (ISO string)
- Handles missing/invalid diagnostics file gracefully (returns empty arrays + `source: 'none'`).
- Tool is registered in MCP server integration and appears in registered tools list.
- Jest tests cover: missing file, valid diagnostics, invalid JSON.

---

## Atomic Tasks (~20 minutes each)

### Task 1: Implement `getErrors` MCP tool + registration
- **Time**: ~20 min
- **Files**:
  - `src/mcpServer/tools/getErrors.ts` (new)
  - `src/mcpServer/integration.ts` (register tool)
  - `tests/integration.spec/initializeMCPServer.web.spec.ts` (update tool count/expectations)
- **Concern**: Tool implementation + MCP registration
- **Test**: Existing integration tests updated to include `getErrors`

### Task 2: Add unit tests for `getErrors`
- **Time**: ~20 min
- **Files**:
  - `tests/getErrors.spec/getErrors.web.spec.ts` (new)
- **Concern**: Validate tool behavior for missing file, valid file, invalid JSON
- **Test**: Jest tests pass

## Execution Order
1. Task 1 → test updated integration spec
2. Task 2 → run Jest unit tests

---

## Notes
- Data source: `.vscode/quality-diagnostics.json` written by `tests/__tests__/quality-gates.test.ts`.
- Follow existing tool patterns (Zod validation + MCPProtocolError handling).
