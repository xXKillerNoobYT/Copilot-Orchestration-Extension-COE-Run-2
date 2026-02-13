# AI Use System – Incremental Implementation Plan

**Version**: 1.0  
**Date**: January 26, 2026  
**Status**: Planning (No code yet)  
**Target Audience**: COE maintainers (beginners) & Copilot integration engineers  
**Success Criteria**: Multi-agent orchestration + ticket system + simple UI for GitHub Copilot, reusing existing queue/sidebar/LLM loop

---

## 📋 Overview

The **AI Use System** transforms COE from a planning-only tool into a **multi-agent orchestration platform** that:

- **Coordinates agents** (Planning Team generates tasks → Programming Orchestrator directs Copilot → Answer Team clarifies → Verification Team checks)
- **Manages tickets** (SQLite-backed communication channel between agents and user, replacing ad-hoc chat)
- **Provides simple UI** (Two new sidebar tabs: "Agents" for team status, "Tickets" for task/clarification tracking)
- **Streams LLM responses** (Inactivity timeout ~60s, uses config timeout as max wait between tokens—read-only, never overwrites)

**Philosophy**: Reuse the existing task queue, sidebar pattern, LLM infrastructure, and MCP server. Add tickets as a new coordination layer. No self-coding, no heavy UI—focus on clean integration.

**User Story**: _As a noob using Copilot, I want agents planning/tracking/verifying my tasks so I can hand Copilot perfect context. As a maintainer, I want a clear, atomic roadmap that reuses existing code and doesn't break what works._

---

## 🔄 Reuse of Existing Code

| Component | Current State | How We Reuse |
|-----------|---------------|-------------|
| **Task Queue** | ✅ In-memory + SQLite, PriorityQueue<Task>, P1/P2/P3 | Agent-generated tasks → same queue, separate agent job type |
| **Sidebar (tasksTreeView.ts)** | ✅ VS Code tree view, refresh/clear commands | Two new TreeDataProvider classes: AgentsTreeProvider, TicketsTreeProvider |
| **LLM Config** | ✅ FileConfigManager (llm.timeoutSeconds, llm.model) | Read timeout **only** for max inactivity; Streaming mode watches last token time |
| **LLM Call Loop** | ✅ openai/mistral clients, response handling | Attach streaming listener; no rewrites, config stays unchanged |
| **MCP Server** | ✅ 6 tools (getNextTask, reportTaskStatus, etc.) | Add new MCP tools: createTicket, replyToTicket, getTickets |
| **PRD Generation** | ✅ Python notebook + TypeScript PRD sync | PRD.md updated when agents assign tasks (new section: Agent State) |

**Integration Strategy**: New code extends, never duplicates. Tickets feed into the task queue as "agent coordination tasks" with tag `type: 'agent_communication'`.

---

## � Task Size Standard (MVP)

**All MVP atomic tasks must fit 15–45 minutes.** This is enforced by Planning Team, Orchestrator, and Task Decomposition Agent.

**Why?** Keeps context tight, enables atomic verification, prevents context overflow mid-task.

**See**: [MODULAR-EXECUTION-PHILOSOPHY.md](MODULAR-EXECUTION-PHILOSOPHY.md) "3. Time Box" + [02-Agent-Role-Definitions.md](02-Agent-Role-Definitions.md) "Planning Team → Decomposition Agent Boundary" for full rationale.

---

## �👥 Agents & Roles (Team Structure)

### Agent Team Hierarchy

```
┌─────────────────────────────────────────────────────┐
│         COE Multi-Agent Orchestration               │
└─────────────────────────────────────────────────────┘
         │
    ┌────┴────────────────────────────┐
    │                                 │
┌───▼──────────────────┐    ┌─────────▼────────────┐
│ Planning Team         │    │ Programming Orchestr │
│ (Independent Upstream)│    │ (Coding Director)    │
│ - Decompose tasks     │    │ - Routes to Copilot  │
│ - Estimate effort     │    │ - Monitors progress  │
│ - Create task queue   │    │ - Escalates blockers │
└───┬──────────────────┘    └─────────┬────────────┘
    │                                 │
    └────────────────┬────────────────┘
                     │
              ┌──────▼─────────┐
              │ GitHub Copilot │
              │ (Coding AI)    │
              └──────┬─────────┘
                     │
        ┌────────────┼─────────────┐
        │            │            │
   ┌────▼────┐ ┌────▼───────┐ ┌──▼─────────────┐
   │Answer    │ │Verification│ │ Clarity Agent  │
   │Team      │ │Team        │ │(Ticket Quality)│
   │(Help)    │ │(Test/Verify│ │                │
   └──────────┘ └────────────┘ └────────────────┘
```

### Roles Summary

| Role | Responsibility | Triggered By | Outputs |
|------|----------------|--------------|---------|
| **Planning Team** | Decompose user/issue into atomic tasks; estimate P1/P2/P3 | GitHub Issue or user request | Task queue entries + PRD updates |
| **Programming Orchestrator** | Direct Copilot task-by-task; monitor progress; ask for clarifications | Task queue (role='orchestrator') | Status updates via MCP reportTaskStatus |
| **Answer Team** | Provide context-aware Q&A for Copilot mid-task | MCP askQuestion tool | Structured answers, field-specific guidance |
| **Verification Team** | Run tests, check results, verify code quality post-execution (60s delay for file stability) | File changes detected | Verification tickets / Pass-fail reports |
| **Clarity Agent** | Review ticket replies; score clarity 0–100; ask follow-ups if <85 | Ticket reply created | Clarity score + follow-up requests (in thread) |

### Agent-to-Agent Communication

- **Planning → Orchestrator**: Via task queue (JSON task object with agent assignment)
- **Orchestrator → Copilot**: Via MCP tools (getNextTask, reportTaskStatus)
- **Copilot → Answer Team**: Via MCP askQuestion (embeds task ID, file context)
- **Copilot → Verification**: Via MCP reportTestFailure (automatic escalation)
- **Agents ↔ User**: Via **Ticket System** (ai_to_human / human_to_ai types)

---

## 🎫 Ticket System & Database

### SQLite Schema (`.coe/tickets.db`)

```sql
-- Tickets table
CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  type TEXT CHECK(type IN ('ai_to_human', 'human_to_ai')),
  status TEXT CHECK(status IN ('open', 'in_review', 'resolved', 'rejected', 'escalated')),
  priority INTEGER (1-3),
  creator TEXT,
  assignee TEXT DEFAULT 'Clarity Agent',
  task_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Ticket replies/thread
CREATE TABLE ticket_replies (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  author TEXT,
  content TEXT,
  clarity_score INTEGER (0-100),
  needs_followup BOOLEAN,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(ticket_id) REFERENCES tickets(id)
);

-- Index for fast lookups
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_assignee ON tickets(assignee);
```

### CRUD Operations

- **Create**: `createTicket(type, title, description, priority, createdBy)` → returns ticket ID
- **Read**: `getTicket(id)` → full ticket + thread; `getTickets(filters)` → paginated list
- **Update**: `updateTicketStatus(id, newStatus)` → timestamp updated_at
- **Reply**: `addReply(ticketId, author, content)` → auto-calls Clarity Agent
- **Delete**: Soft delete via status='archived' (no actual DB removal)

### Fallback Strategy

If SQLite fails to initialize:
- Use in-memory `Map<string, Ticket>` 
- Log warning to user ("DB unavailable; tickets will not persist across sessions")
- Still provide full UI/API (no crashes)

---

## 🔄 Workflows

### Workflow 1: Task Assignment (Orchestrator Routes Copilot)

```
1. Planning Team creates task → Queue
2. Orchestrator calls getNextTask() → MCP
3. MCP returns task + super-detailed prompt (with design refs, file contexts, AC)
4. Orchestrator sends to Copilot via editor command or LLM call
5. Copilot works; if blocked → calls askQuestion() → Answer Team replies
6. Copilot calls reportTaskStatus('completed' or 'failed')
7. If completed → Verification Team (60s delay) runs tests
8. If tests fail → reportTestFailure() creates investigation task
```

### Workflow 2: Agent-to-User Communication (Ticket System)

```
1. Agent encounters context gap or decision point
2. Agent creates ticket (ai_to_human, type='question')
3. Ticket appears in user's Tickets tab (sidebar)
4. User opens ticket webview, reads context, adds reply
5. Clarity Agent scores reply; if <85 clarity → asks follow-up in thread
6. User clarifies; once >85, agent marks resolved
7. Agent resumes task with new context
```

### Workflow 3: Streaming LLM Response with Inactivity Timeout

```
1. Agent/Copilot calls LLM with stream=true
2. Streaming listener records last token timestamp
3. Loop: while (time_since_last_token < config.timeoutSeconds)
   - Read next token
   - Append to response buffer
   - Update last_token_time
4. If no new token for timeoutSeconds:
   - Graceful close (don't retry, use accumulated buffer)
   - Log warning: "LLM inactivity detected"
5. Return final response buffer
```

**Config Integration**: 
- Read `config.llm.timeoutSeconds` (default 300 = 5 min max between tokens)
- **Never write to config**—just read on startup
- If missing, fallback to 60 seconds

---

## 🎨 UI Design (Simple Sidebar Tabs)

### Layout

```
VS Code Sidebar
├── Explorer (existing)
├── Search (existing)
├── Source Control (existing)
├── Run & Debug (existing)
├── Extensions (existing)
└── [NEW] Copilot Orchestration
    ├── 🤖 Agents (new tab)
    │   ├── Planning Team (status icon + uptime)
    │   ├── Programming Orchestrator (active task count)
    │   ├── Answer Team (response time avg)
    │   ├── Verification Team (last check time)
    │   └── Clarity Agent (queued tickets)
    │
    ├── 🎫 Tickets (new tab)
    │   ├── 📋 Open (count)
    │   │   ├── TK-001 [P1] Clarify DB schema
    │   │   ├── TK-002 [P2] Where save uploads?
    │   │   └── ...
    │   ├── ✅ Resolved (count)
    │   │   └── ...
    │   └── 🚨 Escalated (count)
    │
    └── Tasks (existing tab, unchanged)
```

### Agents Tab (TreeView)

**Display**: Agent name, status ("Idle" / "Working on TK-001" / "Awaiting response"), uptime, last activity
**Actions** (right-click): View logs, reset agent, escalate to user

### Tickets Tab (TreeView)

**Display**: Ticket ID, title, priority badge (P1/P2/P3), assignee, status icon (open/in_review/resolved)
**Click**: Open webview with full ticket details + reply thread

### Ticket Details Webview

```
┌────────────────────────────────────────────┐
│ Ticket TK-001: Clarify DB schema  [Close]  │
├────────────────────────────────────────────┤
│ Status: Open  | Priority: P1 | Creator: PlanningTeam │
│                                             │
│ Description:                                │
│ Should tasks table include 'metadata'      │
│ column for custom fields?                   │
│                                             │
│ ──────────── Thread ──────────────         │
│ [PlanningTeam] Asking clarification...     │
│ Clarity Score: 95%  ✓                      │
│                                             │
│ [User] Yes, add it. Needed for...          │
│ Clarity Score: 88% (AI auto-scored)        │
│                                             │
│ ──────────── Reply Box ──────────           │
│ [Text input]  [Send]  [Close & Resolve]    │
└────────────────────────────────────────────┘
```

**Design Principle**: No complex React. Use webview + simple HTML + minimal CSS. Extend existing webview pattern from LLM config panel.

---

## 🔗 Integration Points

| Component | Integration | Details |
|-----------|-------------|---------|
| **Task Queue** | Agent jobs separate | Add `agent_name` + `agent_type` fields; same PriorityQueue logic |
| **MCP Server** | New tools | createTicket, replyToTicket, getTickets, getTicket |
| **Config** | Read-only timeout | Line: `const inactivityTimeout = config.llm.timeoutSeconds \|\| 60;` |
| **PRD.md** | Agent assignments | New YAML in PRD: `agents: { orchestrator: assigned, planning: idle, ... }` |
| **Sidebar** | Two new tabs | Extend `extension.ts` registerWebviewPanel; add TreeProviders |
| **File Watchers** | Verification trigger | 60s delay after file change before running tests |
| **LLM Streaming** | Config-aware inactivity | Never call LLM without timeout listener attached |

---

## 📝 Atomic Implementation Tasks (P1 → P3)

### ✅ P1: Ticket Database & CRUD Layer

**Task**: Create SQLite schema, implement CRUD operations, test in-memory fallback

**Acceptance Criteria**:
- ✓ Ticket table created with correct schema
- ✓ CRUD functions (create, read, update, reply, delete-soft)
- ✓ In-memory fallback if DB init fails
- ✓ Unit tests for all operations (75%+ coverage)
- ✓ No crashes when DB unavailable

**Files Affected**: `src/services/ticketService.ts`, `src/utils/ticketDb.ts`, tests

**Estimated**: 4–6 hours | **Blockers**: None | **Dependencies**: None

**Test Checklist**:
- [ ] Create ticket → returns valid ID
- [ ] Read ticket → full object with thread
- [ ] Update status → timestamp changes
- [ ] Add reply → appears in thread
- [ ] In-memory mode → works without .coe/tickets.db
- [ ] Concurrent writes → no data corruption

---

### ✅ P1: Programming Orchestrator – Basic Routing

**Task**: Extend existing Orchestrator to route Copilot tasks, track status, detect blockers

**Acceptance Criteria**:
- ✓ getNextTask() returns task with agent assignment
- ✓ Orchestrator tracks in-progress task (current MCP call)
- ✓ reportTaskStatus('completed') updates queue
- ✓ If blocked >30s: auto-create ticket + send askQuestion
- ✓ Logs all routing decisions (audit trail)

**Files Affected**: `src/orchestrator/programmingOrchestrator.ts`, MCP tool updates

**Estimated**: 3–4 hours | **Blockers**: Ticket service (P1 task above) | **Dependencies**: Task queue (existing ✅)

**Test Checklist**:
- [ ] Boss retrieves P1 task from queue
- [ ] Task sent to Copilot via MCP
- [ ] Status updates reflected in queue
- [ ] Blocker detected after 30s no-token
- [ ] Escalation ticket created automatically

---

### 🔄 P2: Agents Tab – Sidebar TreeView

**Task**: Create AgentsTreeProvider, display team status, add refresh command

**Acceptance Criteria**:
- ✓ Tree shows 5 agents (Planning, Orchestrator, Answer, Verification, Clarity)
- ✓ Status indicator per agent (Idle / Working / Waiting)
- ✓ Click agent → open webview with logs/stats
- ✓ Right-click → reset/escalate menu
- ✓ Auto-refresh every 5s (configurable)

**Files Affected**: `src/ui/agentsTreeView.ts`, `src/ui/agentsPanel.ts` (webview)

**Estimated**: 3–4 hours | **Blockers**: P1 tasks | **Dependencies**: tasksTreeView pattern (existing ✅)

**Test Checklist**:
- [ ] Tree renders all 5 agents
- [ ] Status updates in real-time
- [ ] Click opens webview
- [ ] Menu actions trigger correctly

---

### 🔄 P2: Tickets Tab – Sidebar TreeView

**Task**: Create TicketsTreeProvider, display ticket list grouped by status, add filters

**Acceptance Criteria**:
- ✓ Tree groups by status (Open / In Review / Resolved / Escalated)
- ✓ Shows ticket ID, title, priority badge
- ✓ Click ticket → open webview with details + thread
- ✓ Filter by priority (P1 / P2 / P3)
- ✓ Count for each group

**Files Affected**: `src/ui/ticketsTreeView.ts`, `src/ui/ticketDetailsPanel.ts` (webview)

**Estimated**: 3–4 hours | **Blockers**: Ticket service (P1) | **Dependencies**: tasksTreeView pattern

**Test Checklist**:
- [ ] Tree groups tickets by status
- [ ] Click opens correct webview
- [ ] Filter works (P1 only shows P1) 
- [ ] Counts match DB

---

### 🔄 P2: Streaming LLM Mode with Inactivity Timeout

**Task**: Attach streaming listener to LLM calls; track token time; graceful close on inactivity

**Acceptance Criteria**:
- ✓ LLM clients (OpenAI, Mistral) support stream: true
- ✓ Streaming listener records last token time
- ✓ Loop exits if config.timeoutSeconds exceeded
- ✓ Graceful close (no exception) + log warning
- ✓ Response buffer returned fully
- ✓ Config never written to; read-only

**Files Affected**: `src/services/llmService.ts`, LLM client wrappers

**Estimated**: 2–3 hours | **Blockers**: None | **Dependencies**: Config reader (existing ✅)

**Test Checklist**:
- [ ] Stream starts and receives tokens
- [ ] Token time tracked correctly
- [ ] Timeout triggers after N seconds no-token
- [ ] Buffer accumulated (partial response OK)
- [ ] Config not modified
- [ ] Warning logged to console/output

---

### 💬 P3: Ticket Details Webview with Reply Thread

**Task**: Build webview UI for full ticket + reply thread; auto-score clarities; allow user replies

**Acceptance Criteria**:
- ✓ Webview displays ticket header (ID, status, priority, creator)
- ✓ Description visible
- ✓ Thread shows all replies (author, content, clarity score, timestamp)
- ✓ Reply input box at bottom
- ✓ Send reply → calls addReply() → Clarity Agent auto-scores
- ✓ Resolve/Close button
- ✓ No CSS bloat (use VS Code theme colors)

**Files Affected**: `src/ui/ticketDetailsPanel.ts`, `src/webviews/ticketDetails.html`

**Estimated**: 3–4 hours | **Blockers**: Tickets tab (P2), ticket service (P1) | **Dependencies**: LLM config panel webview pattern

**Test Checklist**:
- [ ] Webview loads without errors
- [ ] All ticket fields display correctly
- [ ] Reply added to DB
- [ ] Clarity score calculated
- [ ] UI updates on status change

---

### 👀 P3: Agent Status Monitoring & Logs

**Task**: Add logging infrastructure for agent actions; display logs in agent webview; track metrics (response time, task count, uptime)

**Acceptance Criteria**:
- ✓ All agent actions logged to `src/logs/agents.log` (JSON lines)
- ✓ Agent webview shows last 20 log entries
- ✓ Metrics calculated: avg response time, tasks completed, uptime
- ✓ Colors indicate agent state (green=Idle, blue=Working, yellow=Waiting)
- ✓ Log rotation (max 10 MB, keep 5 old files)

**Files Affected**: `src/utils/logger.ts` (agent logs), `src/ui/agentsPanel.ts`

**Estimated**: 2–3 hours | **Blockers**: Agents tab (P2) | **Dependencies**: Logger (existing)

**Test Checklist**:
- [ ] Logs created with correct format
- [ ] Metrics calculated correctly
- [ ] Webview displays logs
- [ ] Log rotation works

---

### ✨ P3: Verification Panel – UI for Test Results

**Task**: Create webview panel showing Verification Team test results; allow re-run, approve, or escalate

**Acceptance Criteria**:
- ✓ Panel shows test output (failed/passed counts, stack traces)
- ✓ File links are clickable (jump to editor)
- ✓ Three buttons: Re-Run Tests, Approve Changes, Escalate
- ✓ Auto-hides after 10s if all pass (configurable)
- ✓ Integrates with reportVerificationResult MCP tool

**Files Affected**: `src/ui/verificationPanel.ts`, `src/webviews/verification.html`

**Estimated**: 2–3 hours | **Blockers**: P2/P3 tasks | **Dependencies**: Verification Team (existing ✅)

**Test Checklist**:
- [ ] Panel loads test output correctly
- [ ] File links clickable
- [ ] Button actions call correct MCP tools
- [ ] Auto-hide timer works

---

## ✅ Testing Plan

### Test Coverage Targets

- **Ticket Service**: ≥80% (CRUD, thread, fallback)
- **Orchestrator Routing**: ≥75% (task assignment, blocker detection)
- **Streaming**: ≥70% (token tracking, timeout, config read-only)
- **UI (Tree views)**: Manual E2E (automated testing harder for VS Code tree views)

### Pre-Implementation Checklist

- [ ] Agents reuse task queue (no duplicate queue creation)
- [ ] UI extends existing sidebar pattern (no new extension files)
- [ ] Config read-only (verify no `config.write()` calls added)
- [ ] Fallback to in-memory Map if DB unavailable
- [ ] No breaking changes to existing task processing

### Manual Test After P1 Completion

```
1. Create ticket via MCP createTicket()
2. Refresh sidebar Tickets tab → ticket appears
3. Click ticket → webview opens without crash
4. Add reply → thread updates
5. Check .coe/tickets.db → row exists
6. Restart extension → ticket still there
7. Stop SQLite → switch to in-memory → no crash
```

---

## 🔗 Reference Links

### VS Code Extensibility
- **Tree View API**: https://code.visualstudio.com/api/extension-guides/tree-view
- **Webview Guide**: https://code.visualstudio.com/api/extension-guides/webview
- **Commands API**: https://code.visualstudio.com/api/extension-guides/command

### LLM Integration
- **OpenAI Streaming**: https://platform.openai.com/docs/api-reference/chat/create (set `stream: true`)
- **Mistral Streaming**: https://docs.mistral.ai/api/ (similar streaming pattern)
- **LM Studio API**: http://localhost:1234/v1/chat/completions (compatible with OpenAI format)
- **Inactivity Timeout Pattern**: https://stackoverflow.com/questions/61632649/how-to-detect-no-data-in-stream-nodejs

### Database
- **SQLite3 Node**: https://github.com/TryGhost/node-sqlite3#readme
- **Better-SQLite3 (lightweight)**: https://github.com/WiseLibs/better-sqlite3

---

## 📊 Timeline & Rollout

| Phase | Tasks | Duration | Target Launch |
|-------|-------|----------|----------------|
| **Phase 1 (P1)** | Ticket DB + Orchestrator routing | 7–10 days | Feb 5, 2026 |
| **Phase 2 (P2)** | Agents + Tickets sidebar tabs; Streaming | 5–7 days | Feb 10, 2026 |
| **Phase 3 (P3)** | Details webviews, logging, verification panel | 5–7 days | Feb 15, 2026 |
| **Stabilization** | Bug fixes, performance tuning, docs | 1–2 days | Feb 15, 2026 |

**MVP Launch**: Feb 15, 2026 (all features 🟢 Green)

---

## 🎯 Success Metrics

After implementation, verify:

1. ✅ **No broken tests**: Existing suite passes 100%
2. ✅ **Config integrity**: `.coe/config.json` unchanged after extension run
3. ✅ **Ticket persistence**: Close + reopen extension → tickets still there
4. ✅ **Streaming stability**: 10 consecutive LLM calls with inactivity timeout → no crashes
5. ✅ **UI responsiveness**: Sidebar refresh <500ms for 100 tickets
6. ✅ **Agent coordination**: Copilot retrieves task → asks question → gets answer → completes → all log entries present
7. ✅ **Database fallback**: Disable SQLite → in-memory mode activated → full functionality without DB
8. ✅ **Beginner-friendliness**: Average dev onboards in <2 hours using this plan

---

**Next Step**: Pick P1 tasks from section **8.** and convert to GitHub Issues with atomic acceptance criteria. Then pair each issue with implementation code following the team's TypeScript standards.
