# Changelog

All notable changes to the Copilot Orchestration Extension will be documented in this file.

## [1.0.0] - 2026-02-11

### Added
- **Visual Plan Builder**: Mac-style sidebar with collapsible task tree, drag-and-drop reordering, responsive UI design specs per task with viewport toggles (Mobile/Tablet/Desktop)
- **GitHub Issues Bi-Directional Sync**: Import issues, convert to tasks, push local changes, checksum-based change detection, full web app GitHub tab
- **Evolution System**: Pattern detection every 20 AI calls, auto-apply non-P1 proposals, 48-hour monitoring with rollback, directive auto-updater
- **MCP JSON-RPC 2.0 Transport**: Full MCP protocol compliance via `POST /mcp`, SSE discovery via `GET /mcp/sse`, stdio transport for external clients
- **Token-Aware Context Building**: Agents track token budget, prioritize system prompt and current request, add newest conversation history first, truncate when budget exceeded
- **TestRunnerService**: Executes `npx jest`, parses JSON and text output, integrates with Verification Agent for real test results
- **Ultra-Granular Agent Prompts**: All 7 agent system prompts rewritten with explicit instructions, examples, and output format specifications
- **Multi-Keyword Intent Classification**: Scores all categories simultaneously, tie-breaks by priority order (verification > planning > question > research > custom > general)
- **Auto-Decomposition**: Tasks over 45 minutes automatically split into subtasks (max depth 3)
- **Batch Classification**: Single LLM call for N classifications with individual fallback
- **Response Caching**: 5-minute TTL, 100-entry cache for non-streaming low-temperature requests
- **LLM Health Monitoring**: Rate-limited health checks, cached health status
- **Error Boundaries**: All agent calls wrapped in try/catch, investigation tickets created on failure
- **Checkpoint Commits**: Tracks verified tasks since last checkpoint, opens VS Code SCM view
- **Task Reordering**: Multi-select tasks and batch-update priorities
- **Verification Pipeline**: File watcher triggers re-verification, plan change detection, retry with investigation ticket escalation

### Changed
- MCP server version bumped to 1.0.0
- Web app now includes GitHub Issues tab with sync, filter, and convert-to-task functionality
- Agent routing uses scoring instead of first-match early return
- Verification agent now runs real tests before LLM evaluation
- Answer agent escalation threshold changed from 70 to 50

## [0.1.0] - 2026-02-09

### Added
- Initial release with core architecture
- 8 AI agents: Orchestrator, Planning, Answer, Verification, Research, Clarity, Boss, Custom
- 6 MCP tools: getNextTask, reportTaskDone, askQuestion, getErrors, callCOEAgent, scanCodeBase
- 43 VS Code commands
- Web dashboard with task management, ticket system, planning wizard
- SQLite database with 9 tables (WAL mode)
- LM Studio integration with 3-tier timeout system
- File watcher for code and plan changes
- Custom agent framework with YAML config and safety hardlocks
