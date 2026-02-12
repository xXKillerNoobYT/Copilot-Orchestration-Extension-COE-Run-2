# Agent Instructions — Copilot Orchestration Extension (COE)

> This file is mirrored across CLAUDE.md, AGENTS.md, and GEMINI.md so the same instructions load in any AI environment.

You operate within a 3-layer architecture that separates concerns to maximize reliability. LLMs are probabilistic, whereas most business logic is deterministic and requires consistency. This system fixes that mismatch.

## The 3-Layer Architecture

**Layer 1: Directive (What to do)**
- SOPs written in Markdown, live in `directives/`
- Define goals, inputs, tools to use, outputs, and edge cases
- Currently 5+ directives: planning, verification, evolution, custom-agents, fresh-restart, github-sync, mcp-protocol, marketplace-publishing, plan-builder
- Natural language instructions — like you'd give a mid-level employee

**Layer 2: Orchestration (Decision making)**
- This is you. Your job: intelligent routing.
- Read directives, call the right agents/services in order, handle errors, ask for clarification
- You're the glue between intent and execution
- Key file: `src/agents/orchestrator.ts` — routes messages to 8 specialist agents via intent classification

**Layer 3: Execution (Doing the work)**
- TypeScript services in `src/core/` — deterministic, testable, fast
- SQLite database via `node:sqlite` (built-in, no native compilation)
- MCP server on port 3030 bridging COE to external coding agents
- All agent logic in `src/agents/` with a common `BaseAgent` interface

**Why this works:** 90% accuracy per step = 59% success over 5 steps. Push complexity into deterministic code. You focus on decision-making.

## Project Architecture

```
src/
├── agents/          # 8 AI agents (orchestrator, planning, answer, verification, research, clarity, boss, custom)
├── core/            # Deterministic services
│   ├── database.ts      — SQLite, 9+ tables, WAL mode, full CRUD
│   ├── llm-service.ts   — OpenAI-compatible client, 3-tier timeout, serial queue, caching
│   ├── config.ts        — .coe/config.json with live reload
│   ├── file-watcher.ts  — File change monitoring → verification triggers
│   ├── test-runner.ts   — Execute npm test, parse Jest output
│   ├── github-client.ts — GitHub API with rate limiting
│   ├── github-sync.ts   — Bi-directional issue sync
│   ├── evolution-service.ts — Pattern detection, auto-proposals, rollback
│   └── directive-updater.ts — Auto-append learnings to directives
├── mcp/
│   ├── server.ts        — HTTP + JSON-RPC MCP server (6 tools)
│   └── stdio-transport.ts — Stdio MCP for external clients
├── views/           # Webview panels (plan builder, ticket detail, verification)
├── webapp/          # Browser dashboard (app.ts + api.ts)
├── types/           # All TypeScript interfaces and enums
├── extension.ts     # VS Code extension entry point
└── commands.ts      # 43+ VS Code commands
```

## Key Configuration

- **LLM Endpoint**: `http://192.168.1.205:1234/v1` (LM Studio on network)
- **Model**: `mistralai/ministral-3-14b-reasoning`
- **Timeouts**: startup 300s, stall 120s, total 900s
- **Database**: `.coe/tickets.db` (SQLite, WAL mode)
- **MCP Port**: 3030 (auto-increments if busy)

## Operating Principles

**1. Check for existing tools first**
Before creating anything, check `src/core/` and `src/agents/` for existing services. Only create new files if nothing exists.

**2. Self-anneal when things break**
- Read error message and stack trace
- Fix the code and test it again (unless it uses paid tokens/credits — check with user first)
- Update the directive with what you learned (API limits, timing, edge cases)
- The system has an EvolutionService that detects patterns automatically every 20 AI calls

**3. Update directives as you learn**
Directives are living documents. When you discover constraints, better approaches, or common errors — update the directive. Don't create or overwrite directives without asking unless explicitly told to.

**4. Ultra-granular task decomposition**
Every task must be 15-45 minutes. If a task exceeds 45 minutes, auto-decompose it into sub-tasks. Max 3 levels of recursion. Each step must be so explicit that a non-thinking LLM can follow it. Every `step_by_step_implementation` entry is ONE unambiguous action.

**5. Real verification over hallucinated verification**
The VerificationAgent uses a real TestRunnerService to execute `npm test` and parse results. Never hallucinate test results. If no test runner is available, set `test_results` to `null`.

## Self-Annealing Loop

Errors are learning opportunities:
1. Fix the code
2. Update the service/agent
3. Test it — `npm run build && npx tsc --noEmit && npx jest`
4. Update the directive with what you learned
5. System is now stronger

## File Organization

**Directory structure:**
- `src/` — TypeScript source (agents, core services, MCP, views, webapp)
- `tests/` — Jest test suites (target: 100% E2E coverage)
- `directives/` — SOPs in Markdown (the instruction set)
- `True Plan/` — 10 definitive design documents (developer's source of truth)
- `resources/` — Extension assets (icons, etc.)
- `.coe/` — Runtime data (SQLite DB, config, custom agents, offline cache)
- `dist/` — Bundled output (esbuild)

**Build & Test:**
- `npm run build` — esbuild bundles to `dist/extension.js`
- `npx tsc --noEmit` — type-check only
- `npx jest` — run all tests
- `npx jest --coverage` — run with coverage report (target: 100%)

**Key principle:** The `True Plan/` folder is the developer's design reference. Keep it in sync with implementation. Every new feature gets documented there.

## Development Roadmap (v0.1.0 → v1.0.0)

The full 3-month plan is in `.claude/plans/buzzing-watching-fairy.md`. Summary:

**Month 1 — Foundation Hardening:**
- Rewrite all 7 agent system prompts to be ultra-granular (explicit output formats, examples, thresholds)
- Fix intent classification (multi-keyword scoring, expanded keyword map)
- Create TestRunnerService for real test execution in verification
- Wire file watcher to trigger re-verification on code changes
- Add github_issues database table + CRUD
- Add auto-decomposition (tasks >45 min auto-split into sub-tasks)
- LLM caching, batch classification, health monitoring, offline mode

**Month 2 — Feature Completion:**
- GitHub Issues bi-directional sync (GitHubClient + GitHubSyncService)
- Evolution system runtime (pattern detection, auto-proposals, 48h monitoring, rollback)
- Visual Plan Builder (Mac-style tree sidebar, drag-and-drop, responsive UI design specs per task with mobile/tablet/desktop breakpoint previews)
- MCP JSON-RPC + SSE + stdio transports
- Token-aware context building, checkpoint commits, task reordering

**Month 3 — Polish + Marketplace:**
- Error boundaries on all agent calls
- Directive auto-updater (append learnings when evolution applies proposals)
- VS Code Marketplace preparation (metadata, CHANGELOG, LICENSE, README, .vscodeignore, icon)
- 100% E2E test coverage (integration pipeline, MCP compliance, GitHub sync, plan builder)
- Performance profiling, security audit, all 43+ commands validated
- True Plan documents — final pass, all features documented
- Version bump to 1.0.0

## Known Patterns (Bugs to Remember)

- **Native modules in VS Code extensions**: `better-sqlite3` causes NODE_MODULE_VERSION mismatch. Fix: use `node:sqlite` (built-in)
- **Falsy zero in maps**: `prioOrder['P1'] = 0` is falsy — always use `??` not `||` when map values include 0
- **AbortError detection**: Node.js `fetch` throws `DOMException` — use string-based detection, not `instanceof Error`
- **HTTP server cleanup in tests**: `server.close()` doesn't close connections — use `closeAllConnections()` + async/await
- **Stream vs non-stream defaults**: Helper methods (classify, score) must explicitly pass `stream: false`

## Summary

COE is a plan-driven orchestration layer for AI-assisted development. You sit between human intent (directives + True Plan) and deterministic execution (TypeScript agents + SQLite + MCP). Read instructions, make decisions, call the right agents, handle errors, and continuously improve the system.

Be pragmatic. Be reliable. Self-anneal.

## Developer's source of truth. Every new feature, service, agent, or architectural change gets documented in `True Plan/` with detailed design decisions and rationale. This is the single source of truth for how the system works and why.

NOTE: The developer may update true plan. With changes he wants. And other things. He'll let you know when he does that. When he does, read it thoroughly. He'll usually drop the specific files with the highlighted area. In the chat.

NOTE: Make sure to follow the true plan. As much as possible and when I'm asking you. To do updates and so on, make sure to update the true plan so that the true plan. Stays In Sync with the. Future plan of. Programming. Project and. That the programming project follows the true plan as much as possible.