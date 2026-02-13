# AI Use System – Architecture & Workflow Diagrams

**Purpose**: Visual reference for how agents, tickets, and UI components interact.

---

## 📊 System Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     COE Multi-Agent Orchestration System                  │
└──────────────────────────────────────────────────────────────────────────┘

┌─────────────────────┐         ┌──────────────────────────────────────┐
│  GitHub Issues      │         │   Planning Team (Independent)        │
│  (Source of Work)   │ ──────> │  - Analyze issue                     │
└─────────────────────┘         │  - Decompose into atomic tasks       │
                                │  - Estimate P1/P2/P3 effort         │
                                │  - Create task queue entries         │
                                └──────────────────┬───────────────────┘
                                                   │
                                                   ▼
                            ┌──────────────────────────────────────┐
                            │   Task Queue                         │
                            │   (PriorityQueue<Task>)              │
                            │   Already EXISTS ✅                  │
                            │   Reuse for agent jobs!              │
                            └──────────────────┬───────────────────┘
                                               │
                                               ▼
                    ┌──────────────────────────────────────────────────┐
                    │  Programming Orchestrator (Coding Director)      │
                    │  [NEW: Task 2 in P1 phase]                      │
                    │  - Pulls next task from queue                   │
                    │  - Sends to Copilot with super-detailed prompt  │
                    │  - Monitors for blocks (>30s inactivity)        │
                    │  - Auto-escalates → Ticket System               │
                    └──────────────────┬───────────────────────────────┘
                                       │
                            ┌──────────┴──────────┐
                            │                     │
                    ┌───────▼────────┐   ┌────────▼────────┐
                    │ GitHub Copilot │   │ Ticket System   │
                    │ (Coding AI)    │   │ [NEW: P1 Task 1]│
                    │ Does the work  │   │ SQLite @ .coe/  │
                    │ 3rd-party tool │   │ Stores agent ↔  │
                    └───────┬────────┘   │ user comm       │
                            │            │ Blockers, Q&A   │
                    ┌───────▼────────┐   └────────┬────────┘
                    │ MCP Tools:     │            │
                    │ - getNextTask  │   ┌────────▼─────────────┐
                    │ - reportStatus │   │ Clarity Agent        │
                    │ - askQuestion  │   │ (Ticket Quality)     │
                    │ - reportTestFail   │ - Score reply <0-100>│
                    └────────────────┘   │ - Ask follow-ups     │
                                         └──────────────────────┘
                            │
                    ┌───────▼────────────────────┐
                    │ File Changes Detected      │
                    │ [60s delay for stability]  │
                    └───────┬────────────────────┘
                            │
                    ┌───────▼────────────────┐
                    │ Verification Team      │
                    │ (Test & Verify)        │
                    │ - Run Jest tests       │
                    │ - Check coverage       │
                    │ - Report pass/fail     │
                    └───────┬────────────────┘
                            │
                    ┌───────▼────────────────┐
                    │ Verification Panel (UI)│
                    │ [NEW: P3 Feature]      │
                    │ Show results, allow    │
                    │ re-run / approve       │
                    └────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│  VS Code Sidebar (UI Layer) [NEW P2/P3]                           │
│                                                                    │
│  📁 Explorer | 🔍 Search | 🌳 Source Control | ▶️ Debug         │
│                                                                    │
│  ✨ Copilot Orchestration (NEW PARENT)                           │
│  ├─ 🤖 Agents Tab (P2)                                          │
│  │   ├─ Planning Team (Idle)                                    │
│  │   ├─ Orchestrator (Working on TK-042)                       │
│  │   ├─ Answer Team (Idle)                                     │
│  │   ├─ Verification Team (Last check: 2m ago)                │
│  │   └─ Clarity Agent (Processing 3 tickets)                  │
│  │                                                              │
│  ├─ 🎫 Tickets Tab (P2)                                        │
│  │   ├─ 📋 Open (7)                                           │
│  │   │   ├─ TK-001 [P1] Clarify DB schema                     │
│  │   │   ├─ TK-002 [P2] Where save uploads?                   │
│  │   │   └─ ...                                               │
│  │   ├─ ✅ Resolved (12)                                       │
│  │   ├─ 🚨 Escalated (1)                                       │
│  │   └─ 🔄 In Review (3)                                       │
│  │                                                              │
│  └─ 📋 Tasks (EXISTING, unchanged)                             │
│      ├─ [P1] Implement feature X                              │
│      └─ ...                                                    │
│                                                                │
│  [Webview below when user clicks item]                        │
│  ┌─ Ticket TK-001: Clarify DB schema ─────────────────────┐  │
│  │ Status: Open | Priority: P1 | Creator: PlanningTeam    │  │
│  │                                                         │  │
│  │ Should tasks table include 'metadata' column?          │  │
│  │                                                         │  │
│  │ ──── Thread ────                                        │  │
│  │ [PlanningTeam] Question (Clarity: 95%)                 │  │
│  │ [User] Yes, add it for custom fields (Clarity: 88%)    │  │
│  │                                                         │  │
│  │ [Reply box + buttons: Send / Close & Resolve]          │  │
│  └─────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Core Workflows

### Workflow 1: Task Assignment & Execution

```
Planning Team Creates Task
        │
        ▼
  Queue Entry
  {
    id: "TASK-42",
    priority: "P1",
    agent_assignment: "Programming Orchestrator",
    title: "Implement getUserTasks function",
    description: "...",
    acceptance_criteria: [...],
    design_references: [...],
    file_contexts: [...]
  }
        │
        ▼
Programming Orchestrator.getNextTask()
        │
        ├─ Pull TASK-42 from queue
        ├─ Bundle with super-detailed prompt
        └─ Send to Copilot via LLM call (streaming mode enabled)
        │
        ▼
GitHub Copilot Receives Task
        │
        ├─ Reads prompt (with acceptance criteria, design refs, file contexts)
        ├─ Starts implementation
        │
        ├─ [If confused beyond simple ambiguity]
        │  ├─ Call MCP askQuestion()
        │  └─ Answer Team responds with context
        │
        ├─ Implements feature
        ├─ Calls reportTaskStatus('completed')
        │
        └─ Waits 60s (File stability delay)
        │
        ▼
Verification Team (Auto-triggered)
        │
        ├─ Run Jest tests
        ├─ Check coverage
        ├─ Report results via reportVerificationResult()
        │
        └─ [If test fails]
           ├─ Call reportTestFailure()
           └─ Create investigation ticket (ai_to_human)
        │
        ▼
Task Complete / Blocked
```

---

### Workflow 2: Blocker Detection & Escalation

```
Orchestrator starts task
        │
        └─ Start streaming LLM call (stream: true)
        │
        ├─ token_timer = now()
        ├─ response_buffer = ""
        │
        ▼
LLM Streams Response
        │
    ┌─ Loop: while (now - token_timer < config.llm.timeoutSeconds)
    │   │
    │   ├─ Receive next token
    │   ├─ response_buffer += token
    │   ├─ token_timer = now() [UPDATE TIME]
    │   └─ Continue
    │
    └─ If NO token for timeoutSeconds (inactivity):
           │
           ├─ Exit loop gracefully
           ├─ Log warning: "LLM inactivity detected"
           │
           └─ Create ESCALATION TICKET
              {
                type: "ai_to_human",
                priority: 1,
                title: "Copilot blocked on TASK-42",
                description: "No LLM response for {N} seconds. Accumulated {M} tokens.",
                task_id: "TASK-42",
                creator: "Programming Orchestrator"
              }
           │
           └─ Call MCP askQuestion()
              {
                question: "Copilot stuck on getUserTasks. Context: {...}",
                context: {
                  taskId: "TASK-42",
                  taskDescription: "...",
                  fileContext: ["src/services/user.ts"],
                  lastTokens: "..." // Last N tokens received
                }
              }
           │
           └─ Answer Team responds ASAP (P1)
              └─ Clarification added to ticket thread
```

**Key Detail**: `config.llm.timeoutSeconds` is **max inactivity between tokens**, NOT total request timeout.
- Default: 300 seconds (5 minutes)
- Never written to in code (read-only)
- Prevents local LLM hangs from blocking Copilot forever

---

### Workflow 3: Human-AI Communication via Tickets

```
Agent Encounters Context Gap
        │
        ├─ Decision point: "Which framework for API?"
        └─ Can't resolve locally → escalate
        │
        ▼
Agent Creates Ticket
MCP.createTicket({
  type: "ai_to_human",
  title: "Framework choice: Express vs Hapi?",
  description: "Need guidance on framework...",
  priority: 2,
  creator: "Planning Team",
  assignee: "Clarity Agent"
})
        │
        ▼
Clarity Agent Auto-Assigned (Default)
        │
        ├─ Reads ticket
        ├─ Scores clarity (0-100)
        └─ If <85: replies with follow-up questions
           If >85: marks for user review
        │
        ▼
User Notices Ticket in Sidebar
        │
        └─ Clicks Tickets Tab → sees "TK-042 [P2] Framework choice"
           │
           ├─ Click ticket → Webview opens
           ├─ User reads description + Clarity feedback
           └─ User replies: "Use Express for simplicity"
           │
           ▼
Clarity Agent Scores User Reply
        │
        └─ Score: 92% (clear, specific, actionable)
           │
           └─ Mark resolved + notify agent
           │
           ▼
Agent Resumes Task with New Context
        │
        └─ Reads resolved ticket content
           └─ Implements with Express
```

---

### Workflow 4: State Flow Diagram

```
┌──────────────────╖
│  Task in Queue   ║
└──────────────┬───╜
               │
        START: Orchestrator.getNextTask()
               │
        ┌──────▼──────┐
        │   ASSIGNED  │
        │  to Copilot │
        └──────┬──────┘
               │
        ┌──────▼─────────────────┐
        │ Copilot Working...     │
        │ (Streaming response)   │
        └──────┬─────────────────┘
               │
        ┌──────┴──────────────────────┐
        │                             │
    ┌───▼──────┐            ┌────────▼───────┐
    │ Blocked? │            │  Completed?    │
    │ (30s+)   │            │ Work done?     │
    └───┬──────┘            └────────┬───────┘
        │ YES                        │ YES
    ┌───▼──────────────────┐   ┌─────▼─────────┐
    │ 📋 Create Ticket     │   │ reportStatus  │
    │ (Priority: P1)       │   │ ('completed') │
    │ Escalate to user     │   └─────┬─────────┘
    │ Ask Answer Team      │         │
    └────┬─────────────────┘   ┌─────▼──────────────┐
         │                     │ ⏱️ Wait 60 seconds │
    User replies               │ (file stability)   │
    Ticket resolved            └─────┬──────────────┘
    Agent continues                 │
                            ┌────────▼─────────────┐
                            │ Verification Team    │
                            │ (Auto-triggered)     │
                            │ Run tests            │
                            └────────┬─────────────┘
                                     │
                            ┌────────┴────────┐
                            │                 │
                        ┌───▼────┐      ┌────▼──────┐
                        │ PASS   │      │ FAIL      │
                        ├────────┤      ├───────────┤
                        │ ✅ Done │      │ 🚨 Blocked│
                        └────────┘      │ Create    │
                                        │ inv. task │
                                        └───────────┘
```

---

## 📐 Database Schema Visualization

```
┌─────────────────────────────────────────┐
│          tickets                        │
├─────────────────────────────────────────┤
│ id (PK)           | TK-001              │
│ type              | 'ai_to_human'       │
│ status            | 'open'              │
│ priority          | 1                   │
│ creator           | 'PlanningTeam'      │
│ assignee          | 'Clarity Agent'     │
│ task_id (FK)      | 'TASK-42'           │
│ title             | "Clarify DB schema" │
│ description       | "Should tasks ..." │
│ created_at        | 2026-01-26 10:30 │
│ updated_at        | 2026-01-26 10:45 │
└─────────────────────────────────────────┘
        │
        │ 1 ---→ Many
        │
┌─────────────────────────────────────────┐
│       ticket_replies                    │
├─────────────────────────────────────────┤
│ id (PK)           | TR-001              │
│ ticket_id (FK)    | TK-001              │
│ author            | 'PlanningTeam'      │
│ content           | "Question: ..."     │
│ clarity_score     | 95                  │
│ needs_followup    | false               │
│ created_at        | 2026-01-26 10:30 │
├─────────────────────────────────────────┤
│ id (PK)           | TR-002              │
│ ticket_id (FK)    | TK-001              │
│ author            | 'User'              │
│ content           | "Yes, add it..."    │
│ clarity_score     | 88                  │
│ needs_followup    | false               │
│ created_at        | 2026-01-26 10:45 │
└─────────────────────────────────────────┘
```

---

## 🧩 Component Integration Map

```
┌─────────────────────────────────────────────────────────────┐
│  extension.ts (Main Entry)                                  │
│  [Activates all extensions, registers commands/trees]       │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┼────────────┬────────────┐
        │            │            │            │
    ┌───▼────────────┴────┐   ┌──▼────────┐   │
    │ Task Queue System   │   │ MCP Server│   │
    │ (EXISTING ✅)       │   │ (EXISTING)│   │
    │ - Priority queue    │   │ 6 tools   │   │
    │ - DB fetch/save     │   │ JSON-RPC  │   │
    └────────┬────────────┘   └──┬───────┬┘   │
             │                   │       │    │
    ┌────────▼────────────────────┴───┐  │    │
    │  Programming Orchestrator (NEW) │  │    │
    │  [Task 2 - P1]                  │  │    │
    │  - Reads task queue             │  │    │
    │  - Sends to Copilot             │  │    │
    │  - Detects blocks               │  │    │
    │  - Creates tickets on block     │  │    │
    └────────┬────────────────────────┘  │    │
             │                            │    │
    ┌────────▼───────────────────────────┴─┐  │
    │  Ticket System (NEW) [Task 1 - P1]   │  │
    │  - SQL CRUD                          │  │
    │  - In-memory fallback                │  │
    │  - Thread replies                    │  │
    └────────┬───────────────────────────┬─┘  │
             │                           │    │
    ┌────────▼────────────┐   ┌──────────▼─┐ │
    │ Agents TreeView     │   │ LLM Service│ │
    │ (NEW) [P2]          │   │ (EXISTING) │ │
    │ - 5 agents list     │   │ Streaming  │ │
    │ - Status display    │   │ Timeout    │ │
    └────────┬────────────┘   └──────┬─────┘ │
             │                       │       │
    ┌────────▼────────────┐   ┌──────▼────────┐
    │ Tickets TreeView    │   │ Config Manager│
    │ (NEW) [P2]          │   │ (EXISTING)    │
    │ - Filtered list     │   │ Read-only     │
    │ - Status grouping   │   │ Never write    │
    └────────┬────────────┘   └────────────────┘
             │
    ┌────────▼────────────┐
    │ Ticket Web view     │
    │ (NEW) [P3]          │
    │ - Details display   │
    │ - Thread replies    │
    │ - User input        │
    └─────────────────────┘
```

---

## ✅ Checklist: System Consistency

After implementation, verify:

- [ ] **Queue integrity**: New agent tasks don't conflict with user tasks (separate agent_type field)
- [ ] **Config safety**: No writes to config during execution (only reads for timeout)
- [ ] **DB fallback**: If SQLite unavailable, in-memory Map still works
- [ ] **Streaming stability**: Token timeout from config applied consistently across all LLM calls
- [ ] **UI coherence**: All new tabs follow tasksTreeView pattern (no custom logic)
- [ ] **MCP tools**: New tools (createTicket, etc.) follow JSON-RPC 2.0 protocol
- [ ] **Logging**: All agent decisions logged to `agents.log` (JSON lines format)
- [ ] **Test coverage**: All new code ≥75% (≥80% for services)

---

## 🎯 What This Diagram Helps With

1. **Onboarding**: New devs see the full picture before coding
2. **API Design**: Understand input/output for each component
3. **Data Flow**: Track how tickets move through the system
4. **Error Handling**: See where fallbacks apply (DB, LLM timeout)
5. **Testing**: Know what to test at each integration point
6. **Documentation**: Reference when writing comments/JSDoc

---

**Next**: To implement, start with **Workflow 1** (Task Assignment) and **Workflow 3** (Tickets), focusing on P1 tasks in the main plan document.

