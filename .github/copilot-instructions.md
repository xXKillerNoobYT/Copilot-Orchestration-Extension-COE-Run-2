# Copilot Instructions — COE

## What This Is

A VS Code extension that orchestrates AI coding agents. It breaks projects into atomic tasks, feeds them one-at-a-time to external coding agents (via MCP on port 3030), verifies results, and self-improves. Think of it as an intelligent project manager between the developer and AI.

## How We Work Together

The developer is the **designer** — they provide the vision, the architecture, and the general direction. You are the **coder** — you take those ideas and implement them with high detail and high quality. The developer may explain things loosely or give a general idea; your job is to carry that out in a thorough, production-grade fashion.

- **Ask clarifying questions when planning** — Before diving into implementation, ask about ambiguous requirements, unclear scope, or conflicting instructions. Better to ask once than to build the wrong thing.
- **Always look for what to do next** — After finishing a task, don't stop. Check the True Plan, scan the codebase, look at the task queue. Suggest what should be tackled next.
- **Suggest areas of improvement** — When you see code that could be cleaner, a feature that's half-wired, a test that's missing, or a True Plan section that's stale — say so and propose the fix.
- **Turn general ideas into detailed implementations** — The developer gives direction; you fill in the details. Error handling, edge cases, type safety, test coverage, documentation — all your responsibility. Don't wait to be told to add these.

## Architecture (3 Layers)

1. **Directives** (`directives/*.md`) — Markdown SOPs telling agents what to do. Living documents; update them when you learn something new.
2. **Agents** (`src/agents/`) — 8 specialists routed by `orchestrator.ts` via keyword-based intent classification. All extend `BaseAgent` (`base-agent.ts`) which provides LLM access, token management, and audit logging.
3. **Core Services** (`src/core/`) — Deterministic TypeScript. Database, LLM client, file watcher, test runner, evolution engine, etc. This is where most business logic lives.

**Key data flow:** User message → `Orchestrator.classifyIntent()` (keyword scoring, NOT LLM) → specialist agent → LLM call via `LLMService.chat()` → result stored in SQLite → response to user.

## Critical Files

| File | Role |
|------|------|
| `src/extension.ts` | VS Code entry. Initializes all services in dependency order, wires them together. |
| `src/agents/orchestrator.ts` | Central router. `KEYWORD_MAP` + `INTENT_PRIORITY` determine routing. Never answer directly — always delegate. |
| `src/core/database.ts` | SQLite via `node:sqlite` (Node built-in, NOT `better-sqlite3`). WAL mode, 15+ tables, full CRUD. |
| `src/core/llm-service.ts` | OpenAI-compatible HTTP client. Serial queue (max 5), 5-min response cache, health checks. |
| `src/core/event-bus.ts` | Pub/sub system. All database mutations and agent completions emit typed events. |
| `src/mcp/server.ts` | HTTP + JSON-RPC server (port 3030). 6 tools: `getNextTask`, `reportTaskDone`, `askQuestion`, `getErrors`, `callCOEAgent`, `scanCodeBase`. |
| `src/types/index.ts` | All enums, interfaces, and types. Single source of truth — never duplicate type definitions elsewhere. |

## LLM Configuration

- **Endpoint**: `http://192.168.1.205:1234/v1` (LM Studio on local network)
- **Model**: `mistralai/ministral-3-14b-reasoning`
- **Timeouts**: startup 300s, stall 120s, total 900s
- **Database**: `.coe/tickets.db` (SQLite, WAL mode)
- **MCP Port**: 3030 (auto-increments if busy)

Don't change the endpoint or model without asking — it's a shared local server.

## Build & Debug

```bash
npm run build          # esbuild → dist/extension.js (production)
npm run watch          # esbuild watch mode (dev)
npx tsc --noEmit       # Type-check only (no emit)
npx jest               # Run all tests
npx jest --coverage    # Tests + coverage report
```

**F5 debugging**: `.vscode/launch.json` launches an Extension Development Host. The default build task runs `npm run watch` (esbuild).

**esbuild externals**: `vscode` and `node:sqlite` are marked external in `esbuild.config.js` — they're provided by the VS Code runtime.

## Testing Patterns

- Tests live in `tests/*.test.ts`, one per service/agent. Jest + ts-jest, `node` environment.
- `vscode` module is mocked via `tests/__mocks__/vscode.ts`.
- Database tests use temp directories (`fs.mkdtempSync` in `beforeEach`, `fs.rmSync` in `afterEach`).
- Path aliases: `@core/*`, `@agents/*`, `@mcp/*`, `@types/*` — mapped in both `tsconfig.json` and `jest.config.js`.
- HTTP servers in tests: always call `server.closeAllConnections()` before `server.close()`, then await the close. Otherwise connections linger and tests hang.

## Conventions

- **Nullish coalescing**: Always use `??` instead of `||` when default values could be `0` or `""`. The priority map (`INTENT_PRIORITY`) uses `0` as a valid value.
- **LLM helper calls**: Methods like `classify()` and `score()` must explicitly pass `stream: false`. The default may differ.
- **AbortError detection**: Node's `fetch` throws `DOMException`, not `Error`. Use string-based detection (`error.name === 'AbortError'`), never `instanceof`.
- **Task granularity**: Every task must be 15–45 minutes. Auto-decompose if over 45 min. Max 3 nesting levels.
- **Enums over strings**: Use `TaskStatus.InProgress` not `'in_progress'`. All enums are in `src/types/index.ts`.
- **Agent structure**: Agents never write files or execute code directly. They return structured `AgentResponse` objects. Only the MCP bridge and `TestRunnerService` execute side effects.

## Design Reference — True Plan

The `True Plan/` folder contains 12 design documents — the developer's source of truth for what the system should do and why.

- **Read before building**: When the developer drops a True Plan file in chat, read it thoroughly before making changes.
- **Stay in sync**: Every new feature, service, agent, or architectural change must be reflected in the relevant True Plan document. Code follows the plan; the plan reflects the code.
- **Update when you change things**: If you add, remove, or modify a feature — update the True Plan doc that covers it. Don't let them drift.
- **Don't contradict the plan**: If you think the plan is wrong, raise it with the developer. Don't silently deviate.

## Autonomous Operation

This project is designed to run with **minimal user interference**. Act accordingly:

- **Hunt for problems proactively** — Don't wait to be told something is broken. When you touch a file, check neighboring code for issues, missing error handling, incomplete implementations, or drift from the True Plan.
- **Implement fully, not partially** — Every change should compile, pass type-checking (`npx tsc --noEmit`), and not break existing tests. If you add a feature, wire it up end-to-end: types → service → agent → MCP tool → UI (if applicable). Don't leave stubs or TODOs unless explicitly asked.
- **Fix what you find** — If you encounter a bug, a type error, a missing import, or dead code while working on something else, fix it. Don't report it and move on.
- **Verify your own work** — After making changes, run `npm run build` to confirm compilation. If tests exist for what you changed, run them. If they don't exist, consider writing them.
- **Self-correct without asking** — If a build fails after your change, read the error, fix it, and try again. Only escalate to the user if you've tried 3 times and are stuck.
- **Follow the task pipeline** — The system's whole point is: Plan → Decompose → Feed to agent → Verify → Next. When implementing features, respect this flow. Every piece of work should be traceable to a task.

## What NOT to Do

- Don't use `better-sqlite3` — it causes native module version mismatches in VS Code's Electron. The project uses `node:sqlite` (built-in).
- Don't create new agent types without adding them to `AgentType` enum, `KEYWORD_MAP`, and the orchestrator's routing logic.
- Don't hallucinate test results — `VerificationAgent` runs real tests via `TestRunnerService`. If unavailable, set `test_results` to `null`.
- Don't overwrite directives in `directives/` without asking — they're living SOPs maintained by the developer.
- Don't leave broken code behind — if it doesn't compile, you're not done.
- Don't ask "should I implement this?" when the True Plan already specifies it — just do it.
