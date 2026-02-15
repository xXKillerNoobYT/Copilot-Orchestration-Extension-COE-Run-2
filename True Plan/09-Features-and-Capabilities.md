# 09 — Features & Capabilities

**Version**: 3.0  
**Last Updated**: February 2026  
**Status**: ✅ Current  
**Depends On**: [02-System-Architecture-and-Design](02-System-Architecture-and-Design.md), [04-Workflows-and-How-It-Works](04-Workflows-and-How-It-Works.md)  
**Changelog**: v3.0 — Standardized header, added User/Dev views, expanded feature descriptions, added dependency graph, added cross-references

---

## How to Read This Document

This is the complete feature catalog for COE — every capability the system provides, organized by category. Each feature has a description explaining what it does, a status indicator, and implementation notes. Use this document to understand what COE can do today and what's planned.

> **👤 User View**: This is your feature reference guide. Green checkmarks (✅) mean the feature is ready to use. Wrench icons (🔧) mean it's partially working. Clipboard icons (📋) mean it's planned but not yet built. You don't need to read every feature — scan the categories that interest you.

> **🔧 Developer View**: Each feature maps to specific source files and services. The status notes include file paths and API endpoints for quick navigation. The Implementation Audit Summary at the bottom provides a compliance snapshot — use it to identify gaps and plan next work.

---

## Overview

COE includes 50+ features across 10 categories. This document lists every capability the system provides, organized by what it does for the user.

**Status Legend**: ✅ Implemented | 🔧 In Progress | 📋 Planned

---

## Category 1: Planning & Design (7 Features)

### Interactive Plan Builder ✅
An adaptive wizard that guides users through project planning with dynamic question paths, live impact simulation, and intelligent task generation.
**Status**: Implemented in webapp Planning page + `POST /api/plans/generate`. 5-step wizard with scale/focus/priority selection.

### Plan Decomposition Engine ✅
Automatically breaks complex requirements into atomic, dependency-aware tasks (15–45 minutes each) with clear acceptance criteria.
**Status**: Implemented in `src/core/task-decomposition-engine.ts` (6 deterministic rules) + Planning Agent LLM fallback. Max 3 levels.

### Adaptive Wizard Paths 🔧
Tailors the planning experience based on project scale and focus — MVP projects get 6 questions in 15 minutes; enterprise projects get the full flow.
**Status**: Partially implemented. Wizard collects scale/focus/priorities but sends all to LLM in one prompt. UI-level branching (different question counts per scale) not yet implemented.

### Real-Time Impact Simulator 📋
Shows live estimates of task count, timeline, risks, and technology implications as the user answers planning questions.
**Status**: Not yet implemented. Frontend-only feature — no API changes needed. Requires client-side estimation logic.

### Plan Updating Process ✅
Handles plan changes through a controlled pipeline: detect trigger → generate proposal → validate → apply → monitor results.
**Status**: Implemented via `PUT /api/plans/:id`, task reordering, and evolution service monitoring.

### Plan Drift Detection 🔧
Continuously compares the current codebase against the plan to detect when they've diverged, flagging drift before it becomes a problem.
**Status**: Partially implemented. `scanCodeBase` MCP tool exists (on-demand). No scheduled/continuous scans. Boss Agent now detects drift via failed/recheck task ratio.

### PRD Auto-Generation 📋
Automatically generates and maintains a Product Requirements Document from plans, GitHub issues, and task definitions.
**Status**: Not yet implemented. Planned as post-MVP feature.

---

## Category 2: Task Management (8 Features)

### Task Queue with Dependencies ✅
Priority-based task queue that respects dependency ordering — tasks are only released when their prerequisites are complete.
**Status**: Implemented in `database.getReadyTasks()` + MCP `getNextTask`. Full CRUD via webapp API.

### Atomic Task Enforcement ✅
Ensures every task meets the 5 atomicity criteria: single responsibility, atomic completion, 15–45 minute time box, verification closure, and token safety.
**Status**: Enforced by Planning Agent prompt + TaskDecompositionEngine auto-decompose for >45 min tasks.

### Task Decomposition Agent ✅
Automatically breaks down tasks estimated over 45 minutes into smaller subtasks while preserving parent-child relationships.
**Status**: Implemented in `src/core/task-decomposition-engine.ts` with 6 rules + Planning Agent LLM fallback. Max 3 levels.

### Context Bundle Builder ✅
Packages each task with all the context the coding AI needs: plan excerpts, related files, architecture docs, and dependency information.
**Status**: Implemented in MCP `getNextTask` tool + `ContextFeeder` service.

### Verification Tracking ✅
Tracks every task through verification states: not started → in progress → pending verification → verified/needs re-check/failed.
**Status**: Full state machine in database + Verification Agent + webapp API approval/rejection endpoints.

### Progress Dashboard ✅
Real-time view of project progress with completion percentages, blocker counts, and timeline estimates.
**Status**: Implemented in webapp Dashboard page + `GET /api/dashboard`. Shows progress bars, task counts, agent status.

### Checkpoint System 📋
Automatic checkpoint commits every 5–10 completed tasks; tagged releases at each priority level completion.
**Status**: Not yet implemented. Requires git integration for auto-commits.

### Fresh Restart 📋
One-click state reset that reloads everything from disk, verifies consistency, and presents a clean starting point.
**Status**: Not yet implemented. Planned for System page in webapp.

---

## Category 3: Agent Management (6 Features)

### Multi-Agent Orchestration ✅
Routes work to specialized agents based on intent classification, with fallback strategies and timeout detection.
**Status**: Implemented in `src/agents/orchestrator.ts`. Two-stage classification (keyword + LLM), 6 routing categories, error boundaries, verification retry.

### Boss AI Supervisor ✅
Top-level oversight agent that monitors system health, resolves inter-team conflicts, enforces plan alignment, and limits task overload.
**Status**: Implemented in `src/agents/boss-agent.ts`. All 7 thresholds active: task overload, agent failure, plan drift, escalation backlog, repeated failures, stale tickets, user escalation.

### Custom Agent Builder ✅
Visual interface for creating specialized read-only agents with goals, checklists, routing rules, and permission controls.
**Status**: Implemented in `src/agents/custom-agent.ts` with YAML parsing, hardlock enforcement, safety limits (20 goals, 50 LLM calls, 30 min max), loop detection.

### Agent Gallery ✅
Browse, manage, enable, and disable available agents (built-in and custom).
**Status**: Implemented in webapp Agents page. Shows all agents with status badges.

### Agent Evolution (UV Tasks) ✅
System for agents to propose their own improvements through "Update & Validate" tasks, with human gates for critical changes.
**Status**: Implemented in `src/core/evolution-service.ts`. Pattern detection, auto-apply for non-P1, 48h monitoring, rollback.

### Agent Configuration Templates ✅
YAML-based profiles for each agent defining prompts, limits, behaviors, and routing rules.
**Status**: Implemented in Custom Agent YAML parser with full validation.

---

## Category 4: Execution & Monitoring (6 Features)

### MCP Server (6 Tools) ✅
Communication bridge between COE and external coding agents, exposing `getNextTask`, `reportTaskDone`, `askQuestion`, `getErrors`, `callCOEAgent`, and `scanCodeBase`.
**Status**: All 6 tools implemented in `src/mcp/server.ts`. HTTP + JSON-RPC 2.0 + SSE. Port 3030 with auto-increment.

### Visual Verification Panel 🔧
Webview showing test results, coverage metrics, design system references, and manual approval controls.
**Status**: API endpoints implemented (`POST /api/verification/:id/approve|reject`). Dedicated VS Code webview panel not yet built.

### Automated Verification ✅
Runs tests and compares results against acceptance criteria after a 60-second stability delay.
**Status**: Implemented in Verification Agent + Orchestrator `runVerificationWithRetry()`. Real test execution via TestRunnerService.

### Loop Detection & Recovery 🔧
Monitors AI calls for repetitive patterns (same errors, identical responses) and intervenes before resources are wasted.
**Status**: Partially implemented. Custom Agent has loop detection (3 similar = halt). LLMService has serial queue (max 5). Orchestrator-level loop detection across agents not yet implemented.

### Execution Dashboard ✅
Programming Orchestrator dashboard showing current task, queue status, agent activity, and system health.
**Status**: Implemented in webapp Dashboard page with real-time stats, progress bars, agent status, recent audit.

### Audit Logging ✅
Complete record of every decision, change, agent action, approval, and escalation for traceability.
**Status**: Implemented throughout all agents and API endpoints. TransparencyLogger provides append-only logging with JSON/CSV export.

---

## Category 5: Integration & Sync (4 Features)

### GitHub Issues Bi-Directional Sync ✅
Syncs GitHub issues to local Markdown files and back, with batching, caching, and 99%+ accuracy.
**Status**: Implemented in `src/core/github-sync.ts` + `src/core/github-client.ts`. Rate limiting, Markdown conversion, webapp GitHub page.

### GitHub Copilot Integration 🔧
Managed connection to Copilot via MCP, with instructions/skills/agents management and token brakes.
**Status**: MCP server operational. Copilot connects via MCP tools. Instructions/skills management not yet built.

### Copilot Workspace Integration 📋
Orchestrates Copilot Workspace sessions with scoped instructions per task and token management.
**Status**: P3 feature. Not yet implemented.

### File Import & Sync 🔧
Watches for coding agent file changes, compares against plan acceptance criteria, and auto-creates follow-up tasks for gaps.
**Status**: File watcher infrastructure exists. Comparison against acceptance criteria handled by Verification Agent on `reportTaskDone`.

---

## Category 6: Collaboration (2 Features)

### Ticket System ✅
Structured communication channel for all AI↔human interactions with priority handling, clarity enforcement, and thread-based discussions.
**Status**: Implemented in database + webapp Tickets page. Full CRUD, threaded replies, clarity scoring, priority badges.

### Clarity Agent ✅
Dedicated agent that scores every ticket reply for clarity (0–100) and requests follow-ups when answers are incomplete or ambiguous.
**Status**: Implemented in `src/agents/clarity-agent.ts`. Scores 0-100, max 5 rounds, auto-escalates. Thresholds: 85+=clear, 70-84=mostly clear, <70=unclear.

---

## Category 7: UX & Extensibility (2 Features)

### VS Code Extension UI ✅
Full sidebar experience with Agents, Tickets, Tasks, and Conversations tabs, plus 55+ registered commands.
**Status**: Implemented. VS Code sidebar views + webapp with 10 pages (Dashboard, Tasks, Tickets, Planning, Agents, Designer, Coding, Settings, GitHub, System).

### Settings Panel ✅
8-tab configuration interface with secure credential storage and live preview of setting changes.
**Status**: Implemented in webapp Settings page. 8 tabs: LLM, Agents, Tasks, Verification, GitHub, Designer, Appearance, Advanced.

---

## Category 8: Context Management (4 Features) — v1.1 ✅

### Token Budget Management ✅
Model-aware token budget tracking with configurable warning (70%) and critical (90%) thresholds, per-model profiles, and real-time utilization reporting.

### Intelligent Context Feeding ✅
Priority-based context window composition that selects the most relevant items (task details, plan excerpts, code snippets) within the available token budget.

### Context Breaking Chain ✅
Multi-strategy context overflow recovery: summarize long contexts, trim low-priority items, compress repeated patterns. Prevents token limit crashes.

### Deterministic Task Decomposition ✅
Pattern-based task splitting engine that decomposes tasks without LLM calls. Falls back to LLM only for unrecognized patterns.

---

## Category 9: Ethics & Transparency (3 Features) — v2.0 ✅

### FreedomGuard_AI Ethics Engine ✅
6 freedom modules (Privacy, Speech, Self-Protection, Data Sovereignty, Transparency, Consent) with 4 sensitivity levels. Absolute blocks that cannot be overridden: no backdoors, spyware, unauthorized data collection, system file deletion, or data exfiltration. Every check is audited.

### Transparency Logger ✅
Append-only action logging for all service operations. Every action by every service is recorded with source, category, severity, correlation IDs, and entity references. Export to JSON/CSV. Sync-aware with device attribution.

### Ethics Override Audit Trail ✅
When authorized users override an ethics block, the justification is permanently recorded with who, when, why, and what was overridden.

---

## Category 10: Multi-Device Sync & Visual Design (5 Features) — v2.0 ✅

### Multi-Device Sync Service ✅
Pluggable sync backends (Cloud REST, NAS file-based, P2P direct) with vector clocks for causal ordering, advisory locking with 5-minute stale detection, and exponential backoff retry.

### Conflict Resolution Engine ✅
SHA-256 hash-based conflict detection with field-level auto-merge for non-overlapping changes. 5 resolution strategies: KeepLocal, KeepRemote, Merge, LastWriteWins, UserChoice.

### Component Schema Library ✅
37 default component schemas across 5 categories (Primitive Inputs, Containers, Interactive Logic, Data & Sync, Ethics & Rights) with code templates for React TSX, HTML, and CSS.

### Integrated Coding Agent ✅
NL command processing with 2-stage intent classification (keyword scoring + LLM fallback), 6 intent handlers (build, modify, explain, fix, automate, query), code generation from component schemas, and diff approval flow.

### Device Registration & Management ✅
Register/unregister devices, track device presence, sync-enabled flags, and per-device vector clock counters for distributed ordering.

---

## Feature Priorities (What Gets Built First)

| Priority | Count | What |
|----------|-------|------|
| **P1 (Must Have)** | 12 | Ticket DB, orchestrator routing, sidebar UI, agent coordination, verification, MCP tools |
| **P2 (Should Have)** | 13 | Custom agents, GitHub sync, evolution system, context management, planning wizard |
| **P2+ (v2.0)** | 12 | Ethics engine, transparency logger, sync service, conflict resolver, coding agent, component schemas |
| **P3 (Nice to Have)** | 10 | Advanced analytics, RL optimization, Copilot Workspace integration, Docker MCP toolkit |

---

## Core Feature Interactions

```mermaid
flowchart TB
    subgraph "Planning"
        WIZARD[Planning Wizard] --> DECOMP[Decomposition Engine]
        DECOMP --> PRD[PRD Auto-Generation]
    end

    subgraph "Execution"
        QUEUE[Task Queue] --> MCP[MCP Server]
        MCP --> VERIFY[Verification]
    end

    subgraph "Intelligence"
        BOSS[Boss AI] --> AGENTS[Agent Orchestration]
        AGENTS --> EVOLVE[Self-Improvement]
    end

    subgraph "Communication"
        TICKETS[Ticket System] --> CLARITY[Clarity Agent]
        GITHUB[GitHub Sync] --> TICKETS
    end

    DECOMP --> QUEUE
    MCP --> AGENTS
    VERIFY --> TICKETS
    BOSS --> QUEUE
    EVOLVE --> AGENTS
```

---

## Success Metrics

| Category | Metric | Target |
|----------|--------|--------|
| **Adoption** | User adoption rate | 80% within 3 months |
| **Adoption** | Visual verification usage | 90% of UI tasks |
| **Adoption** | Developer satisfaction | 4.0/5.0 average |
| **Performance** | Planning time reduction | 50% reduction |
| **Performance** | Agent autonomous success rate | 70% |
| **Performance** | Time to first task | <5 minutes |
| **Performance** | MCP tool response time | <200ms (p95) |
| **Performance** | Autonomous question resolution | 80% |
| **Quality** | First-time task completion rate | 85% |
| **Quality** | GitHub sync accuracy | 99% |
| **Quality** | Plan validation pass rate | 75% first submission |
| **Quality** | Test coverage improvement | +15% |

---

## Risk Management

| Risk | Severity | Mitigation |
|------|----------|------------|
| Scope creep | Medium | Strict change control, P1-first philosophy |
| UI complexity | Medium | Minimalist design, user testing |
| AI performance issues | Medium | Testing + fallback strategies |
| Context overflows | High | Layered breaking strategies + fresh start recovery |
| Database corruption | High | Optimistic locking, WAL mode, backup on restart |
| Security vulnerabilities | High | VS Code security model, input validation, secrets API |
| User adoption resistance | Medium | Tutorials, gradual rollout, polished UX |
| GitHub API rate limiting | Low | Batching, caching, offline fallback |

---

## Implementation Audit Summary (February 13, 2026)

**Audit Scope**: Full comparison of plan intent vs actual code behavior across all agents, services, MCP tools, and webapp.

### Overall Status

| Category | Total | Implemented | In Progress | Planned | Coverage |
|----------|-------|------------|-------------|---------|----------|
| Planning & Design | 7 | 3 | 2 | 2 | 43% |
| Task Management | 8 | 6 | 0 | 2 | 75% |
| Agent Management | 6 | 6 | 0 | 0 | 100% |
| Execution & Monitoring | 6 | 4 | 2 | 0 | 67% |
| Integration & Sync | 4 | 1 | 2 | 1 | 25% |
| Collaboration | 2 | 2 | 0 | 0 | 100% |
| UX & Extensibility | 2 | 2 | 0 | 0 | 100% |
| Context Management (v1.1) | 4 | 4 | 0 | 0 | 100% |
| Ethics & Transparency (v2.0) | 3 | 3 | 0 | 0 | 100% |
| Multi-Device Sync (v2.0) | 5 | 5 | 0 | 0 | 100% |
| **TOTAL** | **47** | **36** | **6** | **5** | **77%** |

### Agent Compliance (Plan Intent vs Actual)

| Agent | Compliance | Notes |
|-------|-----------|-------|
| Orchestrator | 85% | Core routing solid. Missing: orchestrator-level loop detection |
| Planning Agent | 100% | Fully matches plan spec |
| Answer Agent | 100% | Fully matches plan spec |
| Verification Agent | 100% | Fully matches plan spec |
| Research Agent | 100% | Fixed: ESCALATE parsing + auto-escalation |
| Clarity Agent | 100% | Fully matches plan spec |
| Boss Agent | 100% | Fixed: All 7 thresholds now active |
| Custom Agent | 100% | Fully matches plan spec including hardlocks |
| CodingAgentService | 100% | All 6 intents, ethics gate, code gen, diffs |

### v2.0 Service Compliance

| Service | Compliance | Notes |
|---------|-----------|-------|
| EthicsEngine | 100% | 6 modules, 4 levels, absolute blocks, override audit |
| TransparencyLogger | 100% | Append-only, 7 categories, JSON/CSV export |
| SyncService | 100% | 3 backends, vector clocks, advisory locks |
| ConflictResolver | 100% | SHA-256, field-level merge, 5 strategies |
| ComponentSchemaService | 100% | 37 schemas, 5 categories, code templates |

### Test Coverage

- **Test suites**: 40
- **Total tests**: 1,520+
- **Coverage target**: 100% (enforced in jest.config.js)

### v3.0 Features (February 14, 2026)

#### Design Quality Pipeline ✅
- **Design Architect Agent** — Reviews design structure, scores 0-100 across 6 categories
- **Gap Hunter Agent** — 15 deterministic checks + LLM analysis for nuanced gaps
- **Design Hardener Agent** — Creates draft component proposals for human review
- **Design QA Panel** — Shows scores, gaps, drafts with Approve All/Reject All buttons
- **Draft Component Rendering** — Dashed outlines on canvas, draggable, approve/reject

#### Ticket System Overhaul ✅
- **Ticket Auto-Processing** — TicketProcessorService with dual queues (main + boss)
- **Agent Routing** — Maps operation_type + title patterns to correct agent
- **Verification System** — Dual-mode: clarity score for communication, deliverable check for work
- **Tiered Retry** — Auto-retry 3x → Boss severity classification → user escalation
- **Ghost Ticket System** — P1 tickets auto-created when tasks are blocked. 3-strike dismiss rule.
- **Cancel Button** — Cancel (not Resolve) for auto-created tickets
- **Agent Display** — Assigned agent badge, stage badge, acceptance criteria, verification result in ticket detail
- **Active Ticket SSE Feedback** — Real-time status banners (Processing, Verifying, Retrying)
- **Ticket Limits** — Max 10 active. P1 bumps P3 when at limit.

#### User Communication Queue ✅
- **Question Popup** — Focused 1-question-at-a-time popup (replaces free-form chat)
- **Navigation Buttons** — Navigate to relevant page/area from question
- **Previous Decision Context** — Shows past answers when similar question detected
- **Conflict Detection** — Warns when new answer conflicts with existing decision
- **Queue Badge** — P1 questions pulse red

#### Decision Memory ✅
- **Decision Tracking** — `user_decisions` table stores every user answer
- **Auto-Answer** — Repeat questions auto-answered from history
- **Conflict Detection** — Contradictory answers flagged with impact panel
- **Stale Filtering** — Outdated questions auto-dismissed when design regenerated
- **13 Categories** — authentication, database, styling, ui_ux, api_design, etc.

#### Lifecycle Orchestration ✅
- **8-Phase Model** — Planning → Designing → DesignReview → TaskGeneration → Coding → Verification → Complete (with DesignUpdate loop)
- **Phase Gates** — Explicit criteria per phase, no manual override
- **Phase Progress UI** — Grouped by 3 stages, current phase highlighted
- **Design Approval** — "Approve Design" button creates frozen version snapshot
- **Version-Aware Coding** — Impact analysis when features branch merges
- **Layered Task Generation** — Scaffold tasks first, then feature tasks

#### Boss AI Enhancements ✅
- **Event-Driven Activation** — Triggers on ticket resolved, task completed, agent error, phase transition
- **Idle Watchdog** — Configurable timeout (default 5 min) triggers health check
- **Separate Boss Queue** — Boss tickets process independently of main queue
- **Nav Indicator** — Boss AI status chip in webapp navigation

#### Settings Page ✅
- **Configurable Thresholds** — QA score, ticket limits, retry counts, clarification rounds, Boss timeouts, clarity scores
- **LLM Connection** — Endpoint, model, test connection
- **AI Level** — Manual, Suggestions, Smart, Hybrid

#### MCP Integration ✅
- **Ticket Processor Drives Task Queue** — `getNextTask` uses TicketProcessorService
- **Tool Recommendations** — `reportTaskDone` and `askQuestion` include `next_recommended_tool`

#### Planning State Persistence ✅
- **SSE Auto-Reload** — Real-time updates via Server-Sent Events
- **State Restoration** — Full state restored on page load/reboot from SQLite
- **Guided Tour** — Welcome tour for first-time users when no plans exist

#### JSON Repair ✅
- **Progressive Repair** — 7-step `repairJson()` function fixes malformed LLM JSON output
- **3-Tier Parsing** — Fast parse → repair → retry LLM with simplified prompt

### v3.0 Service Compliance

| Service | Compliance | Notes |
|---------|-----------|-------|
| TicketProcessorService | 100% | Dual queues, routing, verification, retry, ghost tickets, idle watchdog |
| DesignArchitectAgent | 100% | 6-category scoring, configurable threshold |
| GapHunterAgent | 100% | 15 deterministic + LLM, hybrid approach |
| DesignHardenerAgent | 100% | Draft components, human-in-the-loop |
| DecisionMemoryAgent | 100% | Keyword fast path + LLM, 13 categories, conflict detection |
| Phase Management | 100% | 8 phases, gate checks, design approval |

### Updated Test Coverage

- **Test suites**: 52+
- **Total tests**: 2,500+
- **Coverage target**: 100% (enforced in jest.config.js)

### Remaining Gaps (Planned)

1. **Adaptive Wizard Paths** — UI-level question branching by project scale
2. **Impact Simulator** — Live task/timeline/risk estimates during planning
3. **Checkpoint System** — Auto-commit every 5-10 tasks + tagged releases
4. **Fresh Restart** — One-click state reset from System page
5. **Copilot Workspace Integration** — P3 feature, session orchestration
6. **PRD Auto-Generation** — Automatic PRD maintenance from plans
7. **Orchestrator Loop Detection** — Pattern tracking across all agent calls
8. **Visual Verification Webview** — Dedicated VS Code panel (API ready)

---

## Feature Dependency Map

The features don't exist in isolation — they depend on each other. This table shows which features must be working before others can function:

| Feature | Hard Dependencies | Soft Dependencies |
|---------|------------------|-------------------|
| Planning Wizard | Database, LLM Service | Settings Panel |
| Task Decomposition | Planning Wizard output | — |
| Task Queue | Database, Task Decomposition | Boss AI |
| MCP Server | Database, Task Queue | GitHub Sync |
| Verification | MCP Server, Task Queue | Test Runner Service |
| Boss AI | Database, Event Bus | All agents |
| Custom Agents | YAML Parser, LLM Service | Agent Gallery |
| GitHub Sync | GitHub Client, Database | File Watcher |
| Evolution System | Database, Pattern Detection | RL Pipeline |
| Ethics Engine | LLM Service | Transparency Logger |
| Sync Service | Database, Conflict Resolver | Vector Clocks |
| Coding Agent | Component Schema, LLM Service | Ethics Engine |
| Design QA Pipeline | Design Architect, Gap Hunter, Hardener | — |
| Ticket Processor | Database, Agent Router, Verification | Ghost Tickets |
| Decision Memory | Database, LLM Service | Question Queue |

---

## Cross-References

| Topic | Document |
|-------|----------|
| Architecture where features are implemented | [02-System-Architecture-and-Design](02-System-Architecture-and-Design.md) |
| Agents that power these features | [03-Agent-Teams-and-Roles](03-Agent-Teams-and-Roles.md) |
| Workflows these features enable | [04-Workflows-and-How-It-Works](04-Workflows-and-How-It-Works.md) |
| UI that exposes these features | [05-User-Experience-and-Interface](05-User-Experience-and-Interface.md) |
| User stories for these features | [06-User-and-Developer-Stories](06-User-and-Developer-Stories.md) |
| Safety systems protecting features | [08-Context-Management-and-Safety](08-Context-Management-and-Safety.md) |
| Agile stories tracking implementation | [12-Agile-Stories-and-Tasks](12-Agile-Stories-and-Tasks.md) |
| Implementation timeline | [13-Implementation-Plan](13-Implementation-Plan.md) |
