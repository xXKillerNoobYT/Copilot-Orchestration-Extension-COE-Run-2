# 15 --- Agent Tree Architecture v10.0

**Version**: 10.0
**Last Updated**: February 2026
**Status**: IMPLEMENTED
**Depends On**: [03-Agent-Teams-and-Roles](03-Agent-Teams-and-Roles.md), [02-System-Architecture-and-Design](02-System-Architecture-and-Design.md), [08-Context-Management-and-Safety](08-Context-Management-and-Safety.md)
**Changelog**: v10.0 --- Group-based agent tree (6 branches, 10-slot groups, mandatory composition), 12-state ticket lifecycle, 5 LLM profiles, upward reporting chain, tool assignment system, 20 bootstrap startup tickets, Boss AI resilience (degraded mode, timeout guards), LLM model reload handling (400/503 backoff), circuit breaker.

---

## How to Read This Document

This document describes the v10.0 agent tree architecture: how agents are organized into groups, how work flows through the tree, how tools are assigned, and how the system bootstraps itself on first run.

---

## 1. Group-Based Tree Structure

### 1.1 Overview

v10.0 replaces the flat L0-L9 skeleton with a group-based architecture. Every level below L0 (Boss AI) is organized into **groups of 10 agents** with mandatory composition rules.

```
L0: Boss AI (single node, no group)
L1: Top Orchestrator Group (1 group, 10 slots)
L2: 6 Branch Head Groups (6 groups, 60 slots total)
L3: Branch Sub-Groups (6 groups, 60 slots total)
L4+: Self-building expansion (demand-driven)
```

### 1.2 The Six Branches

| Branch | Purpose | Niche Agents |
|--------|---------|--------------|
| Planning | Architecture, decomposition, estimation, dependency analysis | ~80 |
| Verification | Unit test, integration test, security audit, performance | ~80 |
| CodingExecution | Language-specific, framework-specific, DevOps, DB work | ~150 |
| CoDirector | Project management, coordination, reporting | ~60 |
| Data | Schema design, migration, ETL, analytics, ML | ~100 |
| Orchestrator | Routing, scheduling, load balancing | ~30 |

### 1.3 Mandatory Group Composition (10 Slots)

Every group MUST follow this composition:

| Slot | Role | Count Rule | Notes |
|------|------|------------|-------|
| 0 | HeadOrchestrator | Exactly 1 | Always slot 0, routes work within group |
| 1 | Planning | Exactly 1 | Plans and decomposes within group scope |
| 2 | Verification | Exactly 1 | Verifies work output |
| 3 | Review | Exactly 1 | Reviews quality before upward report |
| 4 | Observation | Exactly 1 | Monitors patterns, detects issues |
| 5 | StructureImprovement | Exactly 1 | Suggests tree/group improvements |
| 6-8 | Orchestrator (x3) | Recommended 3 | Sub-routing agents (soft rule, warns if fewer) |
| 9 | OpenSlot | Exactly 1 | Never auto-filled, reserved for dynamic assignment |

**Hard rules** (errors): Missing mandatory roles, wrong slot positions for HeadOrch (must be 0) and OpenSlot (must be 9), duplicate mandatory roles.

**Soft rules** (warnings): Fewer than 3 Orchestrators.

### 1.4 Self-Building Rules

- **L2**: Self-building optional --- Boss AI can trigger
- **L3**: Self-building mandatory --- groups auto-populate based on ticket demand
- **L4+**: Self-building locked --- only the tree itself can add nodes (no user/Boss override)
- Each spawn validates group composition before adding

---

## 2. Work Flow: Upward Reporting Chain

### 2.1 Report Types

| Type | When Used |
|------|-----------|
| `completion` | Worker finished a task, reporting results up |
| `issue` | Worker encountered a problem it cannot resolve |
| `escalation` | Work requires capabilities beyond agent's level |
| `reroute` | Work belongs to a different branch |

### 2.2 Report Flow

```
Worker (L10) -> Group Orchestrator (L3 HeadOrch)
    -> Branch Head (L2 HeadOrch)
        -> Top Orchestrator (L1 HeadOrch)
            -> Boss AI (L0)
```

Each level can:
- **Approve/pass-up**: Forward the report to the next level
- **Request rework**: Send back to the originating agent
- **Reroute**: Transfer to a different branch

### 2.3 Cross-Branch Rerouting

When an agent detects work outside its domain:
1. Agent submits `UpwardReport` with type `reroute`
2. Report bubbles up to the nearest orchestrator that spans both branches
3. Orchestrator routes ticket to the correct branch
4. Original agent is freed for new work

---

## 3. Ticket Lifecycle (12 States)

### 3.1 State Machine

```
Open -> Validated -> [Blocked] -> Decomposing -> ReadyForWork
    -> InReview -> UnderReview -> Verified -> Completed
    -> Failed (from any state)
    -> Cancelled (from any state)
```

### 3.2 State Descriptions

| State | Description | Who Transitions |
|-------|-------------|-----------------|
| Open | Newly created ticket | System |
| Validated | Boss AI has approved the ticket | Boss only |
| Blocked | Dependencies not met | Any agent |
| Decomposing | Being broken into sub-tickets | Planning agent |
| ReadyForWork | All dependencies met, assigned to worker | Orchestrator |
| InReview | Work submitted for review | Worker |
| UnderReview | Going through bubble-up review chain | Review agent |
| Verified | Verification agent approved | Verification agent |
| Completed | Boss has signed off | Boss only |
| Failed | Terminal failure | Any agent |
| Cancelled | Cancelled by user or Boss | Boss or system |

### 3.3 Boss-Only Completion Gate

- Only Boss AI can transition a ticket to `Completed`
- Other agents can move tickets to `Verified` but never to `Completed`
- Boss reviews verified tickets and either completes or sends back for rework

### 3.4 Ticket Todos

Each ticket can have sub-items (todos):
- Agents add/complete todos as they work
- Boss reviews todo completion during completion assessment
- Todos are tracked with: description, completed flag, completed_by (node ID), completed_at timestamp

---

## 4. LLM Profile System

### 4.1 Five Profile Types

| Profile | Use Case |
|---------|----------|
| Base | General text generation, simple tasks |
| Tool | Function calling, tool use, MCP integration |
| Vision | Image analysis, screenshot understanding |
| Thinking | Deep reasoning, complex problem solving (long timeout) |
| AllRounder | Multi-capability, preferred when available |

### 4.2 Single-Model Constraint

LM Studio loads one model at a time. The profile system enforces this:
- Only one profile is `is_active = true` at any time
- Switching profiles emits `model:profile_switching` / `model:profile_switched` events
- Queue drains before model switch

### 4.3 Capability Resolution

When an agent needs a specific capability:
1. Check if active profile already has it (no switch needed)
2. Find all profiles with the capability
3. Prefer AllRounder type if available
4. Use first match otherwise
5. Return null if no profiles support the capability

---

## 5. Tool Assignment System

### 5.1 Available Tools (16)

| Tool | Description |
|------|-------------|
| file_read | Read files from the project |
| file_write | Write/modify files |
| terminal | Execute shell commands |
| git | Git operations |
| test_run | Execute test suites |
| web_search | Search the web |
| code_analyze | Static code analysis |
| db_query | Database queries |
| llm_call | Make LLM API calls |
| ticket_manage | Create/update tickets |
| tree_manage | Modify agent tree |
| report_submit | Submit upward reports |
| lint | Run linters |
| format | Run formatters |
| refactor | Automated refactoring |
| deploy | Deployment operations |

### 5.2 Default Tools by Role

| Role | Default Tools |
|------|---------------|
| HeadOrchestrator | file_read, code_analyze, git, lint |
| Planning | file_read, code_analyze |
| Verification | file_read, test_run, code_analyze, lint |
| Review | file_read, code_analyze, lint |
| Observation | file_read, code_analyze |
| StructureImprovement | file_read, code_analyze, refactor |
| Orchestrator | file_read, code_analyze |
| Worker | file_read, file_write, code_analyze, lint, format |
| OpenSlot | (none) |

### 5.3 Inheritance Rules

Only 3 tools are inheritable from parent chain:
- `file_read`, `code_analyze`, `lint`

All other tools (file_write, terminal, git, etc.) must be explicitly granted. Non-inheritable tools require escalation to parent.

### 5.4 Escalation Flow

1. Agent needs a tool it doesn't have
2. `checkToolAccess()` returns `{ allowed: false, reason: 'escalation_needed' }`
3. Agent submits upward report requesting the tool
4. Parent evaluates and grants/denies
5. Tool access re-checked after parent response

---

## 6. Boss AI Resilience

### 6.1 Timeout Guards

All Boss LLM calls wrapped in `Promise.race()` with 30s timeout:
- `selectNextTicket` --- falls back to oldest open ticket
- `assessTicketCompletion` --- falls back to auto-approve
- `validateNextTicket` --- falls back to `{ valid: true }`
- `checkSystemHealth` --- falls back to basic health check

### 6.2 Degraded Mode

- `consecutiveFailures` counter tracks sequential LLM failures
- After 3 consecutive failures: Boss enters degraded mode, emits `boss:degraded`
- In degraded mode: all LLM calls skipped, deterministic fallbacks used
- On any successful LLM call: counter resets, emits `boss:recovered`

### 6.3 LLM Model Reload Handling

LM Studio unloads models after idle period, returning 400/503:
- `isModelReloadError(status)` detects 400 or 503 status codes
- Separate backoff schedule: 5s, 10s, 20s, 30s (longer than normal retry)
- Emits `model:reloading` event during backoff
- Normal backoff: 1s, 2s, 4s, 8s, 16s (capped at 30s)

### 6.4 Circuit Breaker

- Threshold: 5 consecutive ticket processing failures
- Action: Pause queue for 60s, emit `system:circuit_break`
- Auto-recovery: Queue resumes after 60s cooldown
- Resets on any successful processing

---

## 7. Bootstrap (20 Startup Tickets)

On first activation, 20 self-contained tickets bootstrap the system in dependency order:

**Phase 1 --- Foundation (tickets 1-2):**
1. Validate LLM connection and profile setup
2. Build L0-L1 tree skeleton

**Phase 2 --- Branch Structure (tickets 3-9):**
3. Build L2 branch heads
4-9. Build L3 sub-groups (one per branch)

**Phase 3 --- Niche Agent Seeding (tickets 10-15):**
10-15. Seed niche agent definitions (one per domain: Planning, Verification, Coding, CoDirector, Data, Orchestrator)

**Phase 4 --- Configuration (tickets 16-20):**
16. Configure default tool assignments
17. Run initial system health check
18. Validate group composition for all L1-L3 groups
19. Generate welcome report for user
20. Mark system as initialized

---

## 8. Key Files

| File | Purpose |
|------|---------|
| `src/types/index.ts` | GroupRole, Branch, LLMProfileType, AgentGroup, GroupMember, UpwardReport, ToolAssignment, TicketTodo, TicketStatus (12 states), TICKET_TRANSITIONS |
| `src/core/database.ts` | 6 new tables: agent_groups, group_members, llm_profiles, upward_reports, tool_assignments, ticket_todos |
| `src/core/agent-tree-manager.ts` | Group builder, composition validator, V10 skeleton, L3 sub-groups, upward reports |
| `src/core/llm-profile-manager.ts` | 5 profile types, single-model queue, capability resolution, switching |
| `src/core/tool-assignment-manager.ts` | 16 tools, role defaults, inheritance (3 inheritable), escalation |
| `src/core/startup-tickets.ts` | 20 bootstrap tickets with dependency chains |
| `src/agents/boss-agent.ts` | Degraded mode, timeout guards, consecutive failure tracking |
| `src/core/llm-service.ts` | Model reload detection (400/503), dual backoff, thinking timeout (90 min) |
| `src/core/ticket-processor.ts` | Circuit breaker, 12-state lifecycle, transition validator |
| `src/webapp/api.ts` | 26 new v10 API endpoints (groups, reports, tools, todos, profiles, bootstrap) |

---

## 9. Database Tables (v10.0)

| Table | Key Columns |
|-------|-------------|
| `agent_groups` | id, branch, level, parent_group_id, head_node_id, max_members, created_at |
| `group_members` | id, group_id, node_id, role, slot_index, is_filled |
| `llm_profiles` | id, type, model_name, endpoint, capabilities (JSON), is_active |
| `upward_reports` | id, from_node_id, to_node_id, ticket_id, report_type, content, metadata, acknowledged |
| `tool_assignments` | id, node_id, tool_name, assigned_by, granted_at |
| `ticket_todos` | id, ticket_id, description, completed, completed_by, completed_at |
