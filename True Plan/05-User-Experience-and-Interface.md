# 05 — User Experience & Interface Design

**Version**: 7.0
**Last Updated**: February 2026
**Status**: ✅ Current
**Depends On**: [02-System-Architecture-and-Design](02-System-Architecture-and-Design.md), [09-Features-and-Capabilities](09-Features-and-Capabilities.md)
**Changelog**: v7.0 — Tickets tab team queue grouping/filtering, Coding tab "NOT READY" status display, Boss AI nav indicator per-queue breakdown, queue status display in Progress Dashboard | v4.0 — Added User/Dev views, expanded Planning Wizard (adaptive paths, backend/AI paths, hybrid plan builder), notification system, accessibility, keyboard shortcuts, cross-references

---

## How to Read This Document

This document describes what COE looks and feels like — every screen, every interaction, every visual element. ASCII mockups show the layout; behavioral notes explain what happens when you click things.

> **👤 User View**: This is YOUR document. Everything described here is something you'll see, click, or interact with. The ASCII mockups are approximations of the actual UI — the real thing looks better but follows the same layout.

> **🔧 Developer View**: UI components are built with HTML/CSS/JS webviews served from `src/webapp/`. The sidebar uses VS Code's TreeView API (`src/views/`). All state comes from SQLite via HTTP API (port 3030). Real-time updates use Server-Sent Events (SSE). When adding new UI, follow the pattern: `src/webapp/<page>.html` + `src/webapp/<page>.js` + API endpoint in `src/mcp/server.ts`.

---

## Overview

This document describes what COE looks and feels like to the user — every screen, every interaction, and every visual element they encounter.

---

## Sidebar Layout

COE lives in the VS Code sidebar as a dedicated view container. When the user clicks the COE icon, they see:

```
╔══════════════════════════════════════╗
║  ✨ Copilot Orchestration            ║
╠══════════════════════════════════════╣
║                                      ║
║  🤖 AGENTS                           ║
║  ├── Planning Team (Idle)            ║
║  ├── Orchestrator (Working: TK-042)  ║
║  ├── Answer Agent (Idle)             ║
║  ├── Verification (Last: 2m ago)     ║
║  └── Clarity Agent (3 tickets)       ║
║                                      ║
║  🎫 TICKETS                          ║
║  ├── 📋 Open (7)                     ║
║  │   ├── TK-001 [P1] Clarify DB     ║
║  │   ├── TK-002 [P2] Upload path?   ║
║  │   └── TK-003 [P3] Color choice   ║
║  ├── ✅ Resolved (12)                ║
║  ├── 🚨 Escalated (1)                ║
║  └── 🔄 In Review (3)                ║
║                                      ║
║  📋 TASKS                            ║
║  ├── [P1] Implement auth endpoint    ║
║  ├── [P1] Create user model          ║
║  └── [P2] Add pagination             ║
║                                      ║
║  💬 CONVERSATIONS                    ║
║  └── (Chat history with Coding agents)      ║
║                                      ║
╚══════════════════════════════════════╝
```

### Agents Tab
Shows each agent's current status in real-time:
- **Idle** — Waiting for work
- **Working on [task]** — Currently processing
- **Last activity: X minutes ago** — Time since last action

### Tickets Tab
Organized by status with priority badges:
- **Open** — Awaiting response
- **Resolved** — Completed and closed
- **Escalated** — Needs human or Boss AI attention
- **In Review** — Clarity Agent checking response

#### Team Queue Grouping (v7.0)

Tickets can be filtered and grouped by their assigned team queue. A dropdown at the top of the Tickets tab allows selecting:

```
┌──────────────────────────────────────┐
│ Filter by Team: [All Teams ▼]       │
│   ○ All Teams                        │
│   ○ Orchestrator (catch-all)         │
│   ○ Planning                         │
│   ○ Verification                     │
│   ○ Coding Director                  │
└──────────────────────────────────────┘
```

Each ticket displays a **team queue badge** showing which team it's assigned to:

| Badge Color | Team Queue | Label |
|-------------|-----------|-------|
| Gray | Orchestrator | `ORCH` |
| Blue | Planning | `PLAN` |
| Green | Verification | `VERIFY` |
| Orange | Coding Director | `CODE` |

The badge appears next to the priority badge (e.g., `[P1] [PLAN] Decompose auth module`).

> **👤 User View**: Tickets are now organized by team. Use the dropdown to see only tickets from a specific team, or view all at once. Each ticket shows a colored team badge so you can quickly identify which part of the system is handling it.

> **🔧 Developer View**: Team queue assignment is stored in the `assigned_queue` column on the `tickets` table. The badge is rendered based on `ticket.assigned_queue` value matching the `LeadAgentQueue` enum. Filtering calls `GET /api/tickets?queue=planning` (query parameter). The `GET /api/queues` endpoint returns per-team queue depths for the overview.

### Tasks Tab
Current task queue sorted by priority, showing:
- Priority level (P1/P2/P3)
- Task title
- Status (not started / in progress / blocked / testing / complete)

---

## Planning Wizard

The Planning Wizard is the primary way users create new project plans. It's an adaptive, guided experience that adjusts based on user answers.

### Flow

```
Step 1: Project Scale
──────────────────────
"How big is this project?"
○ MVP (quick prototype)
○ Small (single feature)
○ Medium (multi-page app)
○ Large (multiple modules)
○ Enterprise (scalability + compliance)


Step 2: Primary Focus
──────────────────────
"What's your main focus?"
○ Frontend / Visual Design
○ Backend / Data / APIs
○ Full Stack
○ Custom


Step 3: Quick Priority Triage (Medium+ only)
──────────────────────
"Which parts matter most right now?" (select all that apply)
☐ Core business logic
☐ User authentication
☐ Visual design & UX
☐ Scalability & performance
☐ Third-party integrations
```

### Adaptive Paths

Based on the first two answers, the wizard adapts its entire question set, skip logic, and time estimate:

| Selection | What Happens | Questions Shown | Time to Complete |
|-----------|-------------|-----------------|-----------------|
| MVP + Backend | Skip all UI questions, condense to ~6 backend-focused questions | Q0, Q1, Q5–Q7 (condensed), Q9 | 15–20 min |
| MVP + Frontend | Skip deep backend, focus on layout + colors | Q0, Q1, Q2–Q4, Q7 | 12–18 min |
| Small + Any | Moderate question set, auto-suggest priorities | Q0–Q7 (skip Q8–Q9) | 18–22 min |
| Medium + Frontend | Skip deep backend questions, emphasize layout & colors | Q0–Q4, Q7, Q10 | 18–22 min |
| Medium + Backend | Skip UI polish, expand data/API questions | Q0–Q1, Q5–Q10 | 20–25 min |
| Large + Full Stack | Full 10-question flow with extra validation steps | All Q0–Q10 + validation | 40–55 min |
| Enterprise + Any | Full flow + compliance, security, and scaling add-ons | All Q0–Q10 + extras | 50–70 min |
| Any + AI/LLM Integration | Backend path + AI-specific questions (model, context, orchestration) | Q0–Q1, Q5–Q10 + Q7a–Q7c, Q9a | 25–35 min |
| Any + Custom | Show all questions with drag-drop reordering | All (user-controlled order) | User-controlled |

> **👤 User View**: You never see the path logic — the wizard just feels natural. If you pick "MVP + Backend", you only see 6 questions instead of 10. If you change your mind mid-wizard and switch from Backend to Full Stack, the questions instantly re-adapt (< 300ms transition).

> **🔧 Developer View**: Path selection is computed in `wizardState.pathMode` after questions 0 and 1 are answered. The `skipQuestions()` function adds question IDs to a `Set<number>` that the renderer checks before showing each question. Watch for the `watch()` on `wizardState.answers` in the Planning page component.

### Adaptive Path Decision Tree

```mermaid
graph TD
    A[Start Wizard] --> B[Question 0: Project Scale<br>MVP / Small / Medium / Large / Enterprise]
    B --> C[Question 1: Primary Focus<br>Frontend/UI • Backend/Data • AI/LLM • Full Stack • Custom]
    C --> D{User selected role/focus?}
    D -->|Frontend/UI| E[Visual Designer Path<br>15–20 min • Skip Q6–9]
    D -->|Backend/Data| F[Backend-Focused Path<br>18–25 min • Skip Q1–4, condense Q5–10]
    D -->|AI/LLM Integration| FA[AI/LLM Path<br>25–35 min • Skip Q1–4, add Q7a–Q7c, Q9a]
    D -->|Full Stack| G[Technical Architect Path<br>40–55 min • Full 10 questions]
    D -->|Custom| H[Show all 10 questions<br>with reordering option]
    E --> I[Dynamic Priority Suggestion<br>UI components → P1 by default]
    F --> J[Dynamic Priority Suggestion<br>Data & API → P1 by default]
    FA --> JA[Dynamic Priority Suggestion<br>LLM tooling + Data → P1 by default]
    G --> K[Manual Priority Assignment<br>Full control]
    H --> L[User reorders via drag-drop]
```

### Dynamic Path Examples

**Example 1: "MVP – Backend-Focused" User** (e.g., To Do List API first)
- Q0: Project Scale → MVP
- Q1: Primary Focus → Backend/Data
- Path chosen: Backend-Focused (18–22 min)
- **Skipped**: Q1 (Page Layout), Q2 (Color Theme), Q3 (Task Display Format), Q4 (Dependency Viz style)
- **Condensed**: Q5–Q10 into 4 combined questions
- **Auto-suggested priorities**:
  - P1: Data Storage, AI Assistance Level
  - P2: Timeline Representation
  - P3: Collaboration Model, Visual Designer extras
- **Preview Panel**: Shows simplified backend architecture diagram instead of full UI mock

**Example 2: "Medium – Frontend-Heavy" User** (e.g., Calendar UI polish)
- Q0: Medium
- Q1: Frontend/UI
- Path: Visual Designer + partial full-stack
- **Skipped**: Deep backend questions (Q8 Collaboration Model, Q9 Data Storage details)
- **Kept + emphasized**: Layout, Colors, Task Display, Dependency Viz
- **Auto-priority**:
  - P1: Page Layout, Color Theme, Task Display
  - P2: Dependency Visualization, User Input Style
  - P3: AI Assistance, Data Storage

**Example 3: "Large – AI/LLM Integration" User** (e.g., Multi-agent orchestration system)
- Q0: Large
- Q1: AI/LLM Integration
- Path: AI-focused (25–35 min)
- **Skipped**: Q1–Q4 (UI polish)
- **Added AI-specific questions**:
  - Q7a: Preferred LLM Deployment — Local 14B / Cloud API / Hybrid
  - Q7b: Max Context Window — 3,500 (safe) / 8,000 / 32,000 / Custom
  - Q7c: Agent Orchestration Style — Sequential / Hierarchical (Boss) / Swarm / Custom
  - Q9a: Primary Data Store — SQLite / PostgreSQL / MongoDB / Vector DB (for RAG)
- **Auto-priority**:
  - P1: Agent Routing, LLM Tool Calls, Data Layer
  - P2: API Endpoints, Auth Strategy
  - P3: UI Polish, Collaboration Model

### Planning Style Selection (Backend/AI Focus Only)

When users select Backend or AI/LLM as their primary focus, an additional triage question appears:

```
Question 2.5: Planning Style
──────────────────────
"How do you want to build the plan?"
○ AI-Driven (maximum automation, minimal human input)
○ Human-Guided (AI suggests, human approves every major decision)
● Balanced Hybrid (Recommended — human sets guardrails, AI fills details)
○ Pure Manual (human defines everything, AI only validates)
```

**Balanced Hybrid flow** (adapted for backend/AI projects):

1. **Stage 1: Human Guardrails** (3–5 min) — User enters 3–8 main domain objects, declares non-negotiable constraints, and locks P1 priorities via drag-drop
2. **Stage 2: AI-Augmented Architecture** (5–12 min) — AI asks targeted backend/AI questions: Data Layer → API Layer → LLM Integration → Orchestration Style
3. **Stage 3: Human Review & Lock-In** (3–6 min) — Editable summary, highlighted P1 items, "Lock P1 Decisions" button, "Override AI Suggestion" fields
4. **Stage 4: Generate Backend-First Plan** — Tasks ordered with all P1 backend/AI tasks first, dependency-enforced, human review gate after P1 completion

### The 10 Core Design Questions

1. **Page Layout** — Sidebar, tabs, wizard, or custom
2. **Color Theme** — Light, dark, high contrast, or custom
3. **Task Display Format** — Tree, kanban, grid, or custom
4. **Dependency Visualization** — Network graph, hierarchy, timeline, or list
5. **Timeline Representation** — Gantt chart, linear, kanban, or calendar
6. **User Input Style** — Inline, modal, sidebar, or full page
7. **AI Assistance Level** — Manual, suggestions, smart defaults, or hybrid
8. **Collaboration Model** — Solo, async team, real-time, or custom
9. **Data Storage** — Local, cloud, hybrid, or custom backend
10. **Project Type Specifics** — Based on web app / extension / CLI / library selection

### Real-Time Impact Simulator

As the user answers questions, a live preview panel shows the downstream impact:

```
┌───────────────────────────────────────────────────┐
│               Plan Impact Simulator               │
├─────────────┬─────────────────────┬───────────────┤
│ Metric      │ Current Estimate    │ Notes         │
├─────────────┼─────────────────────┼───────────────┤
│ Total Tasks │ 28                  │ +4 from last  │
│ P1 Tasks    │ 12                  │ Focused       │
│ Timeline    │ ~18–24 hours        │ 9-task        │
│             │                     │ critical path │
│ Risks       │ Medium              │ Local storage │
│             │                     │ sync concern  │
│ Tech Stack  │ Vue + SQLite + Node │ Pinia for     │
│             │                     │ state mgmt    │
└─────────────┴─────────────────────┴───────────────┘
```

Updates in <400ms as the user changes answers. Shows:
- Total and P1 task count estimates
- Rough timeline and critical path
- Risk and trade-off flags
- Suggested technology stack

---

## Ticket View (Webview Panel)

When a user clicks on a ticket, a detailed panel opens:

```
┌─────────────────────────────────────────────────────┐
│  Ticket TK-001: Clarify DB Schema                   │
│  Status: Open │ Priority: P1 │ Creator: Planning    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Should the tasks table include a 'metadata'        │
│  column for custom fields?                          │
│                                                     │
│  ──── Thread ────                                   │
│                                                     │
│  [Planning Team] Original question (Clarity: 95%)   │
│  "We need to know if tasks should support           │
│   arbitrary metadata for extensibility."             │
│                                                     │
│  [User] Yes, add it (Clarity: 88%)                  │
│  "Include a JSON metadata column for custom          │
│   fields. Keep it optional."                        │
│                                                     │
│  [Clarity Agent] ✅ Clear — resolved                │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │  Type your reply...                          │   │
│  │                                              │   │
│  │                     [Send]  [Close & Resolve] │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

> **👤 User View**: Tickets are your direct communication channel with the AI system. When the AI needs a decision from you, a ticket appears here. You reply in natural language — the Clarity Agent scores your reply for clarity and either marks it resolved or asks a follow-up. P1 tickets pulse a red badge to grab your attention. You can close tickets manually even if the Clarity Agent hasn't auto-resolved them.

> **🔧 Developer View**: Tickets are stored in the `tickets` table in SQLite. The webview panel loads via `src/webapp/tickets.html` and communicates with `src/mcp/server.ts` endpoints: `GET /api/tickets/:id` for detail, `POST /api/tickets/:id/reply` for responses. Real-time updates arrive via SSE (`/api/events`). The Clarity Agent's scoring threshold (default: 75 for auto-resolve) is configurable in the settings page.

### Ticket View States

| State | What the User Sees | Developer Trigger |
|-------|-------------------|-------------------|
| **Loading** | Spinner with "Loading ticket..." text | API call to `/api/tickets/:id` pending |
| **Empty thread** | "No replies yet. The AI is working on this." | Thread array is empty |
| **Active conversation** | Full thread with clarity scores per message | Thread populated from DB |
| **Resolved** | Green ✅ banner, reply box hidden, "Reopen" button visible | `status = 'resolved'` in DB |
| **Escalated** | Orange ⚠ banner: "This ticket needs human review" | `status = 'escalated'`, Boss AI flagged |
| **Error** | Red banner: "Could not load ticket. [Retry]" | API returned error/timeout |

---

## Verification Panel

Shows verification results with design system references:

```
┌─────────────────────────────────────────────────┐
│  Verification: Task #42 — Navigation Component  │
├─────────────────────────────────────────────────┤
│                                                 │
│  Automated Tests                                │
│  ✅ Unit tests: 8 passed, 0 failed              │
│  ✅ Coverage: 87%                                │
│                                                 │
│  Visual Checklist                               │
│  ✅ Button styling matches design system         │
│  ✅ Form validation works correctly              │
│  ☐  Mobile responsive (not yet checked)         │
│                                                 │
│  Plan Reference                                 │
│  "Sidebar collapses to hamburger menu           │
│   on mobile (< 768px breakpoint)"               │
│                                                 │
│  Design System Reference                        │
│  Primary: #3B82F6 │ Font: Segoe UI              │
│                                                 │
│  [Re-Run Tests]  [Approve]  [Reject + Create Task] │
└─────────────────────────────────────────────────┘
```
> **👤 User View**: After the coding agent completes a task, this panel shows you the verification results. Green checkmarks mean everything passed; unfilled checkboxes mean something still needs checking. You can re-run tests, approve the task (moves it to "complete"), or reject it (creates a new follow-up task automatically). The design system reference at the bottom reminds you what the plan originally specified.

> **🔧 Developer View**: Verification is driven by `VerificationAgent` which calls `TestRunnerService.runTests()`. Results are stored in the `verifications` table. The panel loads from `src/webapp/verification.html`. "Reject + Create Task" calls `POST /api/tasks` with `parent_id` set to the rejected task, creating a child task. Coverage percentage comes from Jest's `--coverage` output.

### Verification Panel States

| State | What the User Sees | Developer Trigger |
|-------|-------------------|-------------------|
| **No verification yet** | "Task not yet verified. [Run Verification]" button | No `verifications` row for this task |
| **Running** | Spinner: "Running tests..." with live output stream | `TestRunnerService` executing |
| **All passed** | Green banner: "All checks passed!" with Approve prominent | All test results passing |
| **Partial pass** | Yellow banner: "3 of 5 checks passed" with details | Mixed pass/fail results |
| **All failed** | Red banner: "Verification failed" with Reject prominent | All tests failing |
| **Error** | "Could not run tests. [Retry]" with error details | TestRunnerService threw exception |
---

## Custom Agent Builder

A visual interface for creating specialized agents without writing code:

```
┌────────────────────────────────────────────────────┐
│  Create Custom Agent                               │
├────────────────────────────────────────────────────┤
│                                                    │
│  Name: ________________________________________    │
│  Description: _________________________________    │
│                                                    │
│  System Prompt:                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │ You are a specialized agent for...           │  │
│  │ Your role is to...                           │  │
│  │                                              │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  Goals (drag to reorder):                          │
│  1. [Primary goal description        ] [Priority ▼]│
│  2. [Secondary goal                  ] [Priority ▼]│
│  [+ Add Goal]                                      │
│                                                    │
│  Checklist:                                        │
│  ☑ Verify input parameters                         │
│  ☑ Check for edge cases                            │
│  ☐ Document findings in ticket                     │
│  [+ Add Item]                                      │
│                                                    │
│  Routing Keywords: analyze, investigate, explain   │
│                                                    │
│  Permissions:                                      │
│  ✅ Read files       ✅ Search code                 │
│  ✅ Create tickets   ✅ Call LLM                    │
│  🔒 Write files (locked — always off)              │
│  🔒 Execute code (locked — always off)             │
│                                                    │
│  [Preview]  [Save Agent]  [Cancel]                 │
└────────────────────────────────────────────────────┘
```

> **👤 User View**: This is where you create your own specialized AI agents without writing any code. Give it a name, describe what it should do, set its goals and checklist, and assign routing keywords — words that, when you type them in chat, will automatically activate your custom agent. The locked permissions (Write files, Execute code) are safety features that can never be enabled for custom agents.

> **🔧 Developer View**: Custom agents are stored as YAML configs in the `custom_agents` table. The builder UI is in `src/webapp/custom-agents.html`. On "Save Agent", the config is validated by `CustomAgentBuilder.validateConfig()` which enforces: max 5 goals, max 10 checklist items, no reserved keywords (plan, verify, answer, etc.), no profanity in prompts. The resulting `CustomAgentConfig` is passed to `CustomAgentService` for registration. Hardlock protections prevent custom agents from ever gaining file-write or code-execution permissions — this is enforced at the `BaseAgent` level, not just the UI.

### Custom Agent Builder Validation Rules

| Field | Constraint | Error Message |
|-------|-----------|---------------|
| Name | 3–50 chars, alphanumeric + spaces | "Agent name must be 3–50 characters" |
| Description | 10–500 chars | "Description must be 10–500 characters" |
| System Prompt | 20–2000 chars | "System prompt too short/long" |
| Goals | 1–5 goals, each 10–200 chars | "Add at least one goal" |
| Checklist | 0–10 items | "Maximum 10 checklist items" |
| Keywords | 1–10 keywords, each 2–30 chars, no reserved words | "Keyword 'plan' is reserved" |
| Permissions | Write/Execute always locked off | Cannot be unlocked |

---

## Next Actions Panel (Copilot Integration)

A quick-copy panel for sending pre-filled prompts to Copilot:

```
┌─────────────────────────────────┐
│ Next Actions for Copilot        │
├─────────────────────────────────┤
│                                 │
│ Update Linting Skill            │
│ @lint-agent Update instructions │
│ with new ESLint rules. Align    │
│ to P1 modules.                  │
│ [📋 Copy]  [Edit]  [Preview]   │
│                                 │
│ Run Test Suite                  │
│ @test-agent Run all test        │
│ suites, report failures.        │
│ [📋 Copy]  [Edit]  [Preview]   │
│                                 │
└─────────────────────────────────┘
```

Prompts are dynamically generated based on current priorities, active tasks, and recent patterns.

> **👤 User View**: These are pre-built prompts ready to copy-paste into your AI coding agent (Copilot, Cursor, etc.). COE generates them based on what needs to happen next — you don't have to think about what to tell the AI. Click "Copy" to put the prompt on your clipboard, "Edit" to customize it first, or "Preview" to see what the AI will receive.

> **🔧 Developer View**: Prompts are generated by `CodingAgentService.generatePrompt()` which reads the current task queue, priorities, and recent patterns from SQLite. The Next Actions panel in the sidebar uses `TreeDataProvider` with items that have inline action buttons. Copy uses `vscode.env.clipboard.writeText()`. The prompt template is in `directives/mcp-protocol.md` §Coding Agent Prompt.

---

## Evolution Dashboard

A collapsible sidebar section showing how the system is learning:

```
┌───────────────────────────────────────┐
│ 🌱 System Evolution                   │
├───────────────────────────────────────┤
│                                       │
│ Active Patterns (Top 3):              │
│ ⚠️ TOKEN_LIMIT on askQuestion (12×)   │
│    Impact: P1 Blocked ×3             │
│    [View Proposal] [Approve] [Ignore]│
│                                       │
│ Recent Improvements:                  │
│ ✅ Verification template v1.5         │
│    Added eslint check                │
│    Result: Linting misses ↓78%       │
│ ✅ Context limit ↑ 800→1200 tokens    │
│    Result: Token errors ↓83%         │
│                                       │
│ [Manual Evolution] [View All]         │
└───────────────────────────────────────┘
```

---

## v2.0 Webapp UI (Browser-Based) — IMPLEMENTED

The primary COE interface is now a full webapp served on localhost (port 3030) and opened in the user's browser. The VS Code sidebar shows a minimal tree view with status information.

### Phase Progress Indicator

Displayed at the top of the Planning page, grouped by 3 stages:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Stage 1: Plan & Design              Stage 2: Code    Stage 3: Verify    │
│ ● Plan  ● Design  ◉ Review  ○ Tasks │ ○ Coding       │ ○ Verify  ○ Done│
│                     ▲ current        │                │                  │
│ v1.0  |  2 min in phase  |  Blockers: 1 question  |  3 drafts pending │
└──────────────────────────────────────────────────────────────────────────┘
```

- Filled circles (●) = completed phases
- Current phase (◉) = highlighted with accent color + subtle pulse
- Empty circles (○) = upcoming phases
- Phases are NOT clickable (no manual override)

### Design QA Panel

Below the Visual Designer canvas:

```
┌─────────────────────────────────────────────────────────┐
│ Design Quality                           [Run QA ▸]     │
├─────────────────────────────────────────────────────────┤
│ Score: ●●●●●●●●○○ 82/100         Gaps: 3 ⚠ 1 🔴 2 🟡   │
│                                                          │
│ ✓ Architect Review: 82/100 (completed 2 min ago)        │
│ ✓ Gap Analysis: 5 gaps found (3 major, 1 critical, 1m) │
│ ◉ Hardening: 5 draft proposals ready                    │
│                                                          │
│ Pending Drafts: 5  [Approve All] [Reject All]           │
└─────────────────────────────────────────────────────────┘
```

- Score badge: green (>=80), yellow (60-79), red (<60)
- Gap indicator badges on page tabs for critical/major gaps
- Draft components render on canvas with dashed outline, "DRAFT" badge, and approve/reject controls
- **Click-to-select pattern**: Draft components use persistent click-based selection (not hover). Click a draft to show Approve/Reject buttons below it; click again or click elsewhere to deselect. Buttons persist until explicitly dismissed.

### Progress Dashboard — IMPLEMENTED (v4.0, updated v7.0)

Live ticket processing dashboard on the Planning page:

```
┌─────────────────────────────────────────────────────────────┐
│ [Processing Progress]  [spinner]             2m 34s elapsed │
│ [====================--------] 62% (23/37 tickets)          │
│ Current: TK-014 Develop admin panel   Queue: 8   Phase: 3  │
│ [Planning Team badge]                                       │
├─────────────────────────────────────────────────────────────┤
│ Team Queues:  ORCH: 2  │  PLAN: 3  │  VERIFY: 1  │ CODE: 2│
│ Slots: 1/1 active      │  2/2      │  1/1        │ 0/0    │
└─────────────────────────────────────────────────────────────┘
```

- Shows progress bar, current ticket, queue depth, phase, elapsed timer, agent badge
- **v7.0**: Per-team queue depth and slot utilization shown in bottom row
- Auto-appears when ticket processing starts (via SSE `ticket:processing_started` event)
- Auto-hides when processing completes with 5s delay
- Polls `/api/processing/status` for updates; queue data from `GET /api/queues`
- Persists across page navigation via localStorage (`generationInProgress`, `generationStartTime`)

### Project Status Click-to-Select — IMPLEMENTED (v4.0)

Page cards in the Project Status view use a persistent click-to-select pattern (same as draft components). Clicking a card highlights it with a blue border and loads its detail panel. Clicking again deselects.

### Plan Generation State Recovery — IMPLEMENTED (v4.0)

Plan generation progress is persisted to localStorage. If the user navigates away during generation and returns to the Planning page, the progress dashboard resumes showing elapsed time and SSE events will clear the generation flag when complete.

### Designer Auto-Open — IMPLEMENTED (v4.0)

On page load, the designer only auto-opens if the active plan has design data (checked via `GET /api/design/pages?plan_id=X`). This prevents opening a blank designer on fresh projects with no design components yet.

### User Communication Popup

Replaces free-form AI chat with focused 1-question-at-a-time popup:

```
┌─────────────────────────────────────┐
│ Questions  (3 pending)       _ ✕    │
├─────────────────────────────────────┤
│ ▸ Go to: Planning & Design          │
├─────────────────────────────────────┤
│ From: Planning Team                  │
│                                      │
│ What authentication method should    │
│ this project use?                    │
│                                      │
│ AI recommends: OAuth 2.0             │
│                                      │
│ ▸ Show Technical Details             │
│                                      │
│ ○ OAuth 2.0 (Recommended)           │
│ ○ JWT + Session                      │
│ ○ Basic Auth                         │
│ ○ Other: [_______________]           │
│                                      │
│ [Submit Answer]                      │
├─────────────────────────────────────┤
│ Question 1 of 3  ■■■□□□ Progress    │
└─────────────────────────────────────┘
```

- Navigate button links to relevant page/designer/ticket
- Collapsible technical details section
- Previous decision context shown when Decision Memory finds similar past answer
- Conflict detection panel when contradictory answers found
- P1 questions pulse red badge in nav bar

### Boss AI Nav Indicator (updated v7.0)

```
┌─────────────────────────────────────┐
│ Boss AI Supervisor          [Run ▸] │
├─────────────────────────────────────┤
│ Status: Idle (last check: 2 min)   │
│ Phase: Stage 1 — Designing         │
│ Total Queue: 8 tickets | 0 errors  │
│ ┌─────────────────────────────────┐ │
│ │ ORCH: 2  PLAN: 3  VER: 1  CD: 2│ │
│ │ Slots: 1+2+1+0 / 4 total       │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│ Last Assessment:                    │
│ "Planning queue overloaded. Moving  │
│  2 slots from orchestrator to       │
│  planning team."                    │
└─────────────────────────────────────┘
```

- Gray (idle), blue+spinner (checking), red+badge (issues found)
- Event-driven activation (not polling)
- **v7.0**: Shows per-team queue depths and slot allocation breakdown
- Boss assessment messages now reference specific team queues and slot rebalancing decisions

### Settings Page

```
┌─────────────────────────────────────────────────────────┐
│ Settings                                                 │
├─────────────────────────────────────────────────────────┤
│ ▼ Design Quality                                        │
│   QA Score Threshold    [====●=====] 80  (min 50)       │
│ ▼ Ticket Processing                                     │
│   Max active tickets / Max retries / Max clarifications  │
│ ▼ Boss AI                                               │
│   Idle timeout / Stuck phase / Thresholds               │
│ ▼ Clarity Agent                                         │
│   Auto-resolve score / Clarification score              │
│ ▼ AI Level Default                                      │
│   ○ Manual  ○ Suggestions  ● Smart  ○ Hybrid            │
│ ▼ LLM Connection                                        │
│   Endpoint / Model / [Test Connection]                  │
│ [Save Settings]                                          │
└─────────────────────────────────────────────────────────┘
```

### Coding Tab — NOT READY Status (v7.0)

The Coding tab in the webapp shows the status of the Coding Director and external coding agent:

```
┌─────────────────────────────────────────────────────────┐
│ Coding Agent                                             │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ When NO task is pending:                                 │
│ ┌──────────────────────────────────────────────────────┐ │
│ │  🔴 Pending Task... NOT READY                        │ │
│ │  No coding tasks in queue.                           │ │
│ │  Tasks will appear here when the Planning team       │ │
│ │  creates code_generation tickets.                    │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ When a task IS active:                                   │
│ ┌──────────────────────────────────────────────────────┐ │
│ │  🟢 Active: Implement user authentication module     │ │
│ │  Prepared context: 12 files, 3 plan sections         │ │
│ │  Prerequisites: ✅ All met                           │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ When tasks are pending in queue:                         │
│ ┌──────────────────────────────────────────────────────┐ │
│ │  🟡 Pending (3 in queue)                             │ │
│ │  Next: TK-089 Add pagination to API endpoints        │ │
│ │  Prerequisites: ⚠ 1 missing (blocked by TK-087)     │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

- Polls `GET /api/coding/status` every 5 seconds for current state
- Shows `hasPendingTask`, `currentTask`, and `queueDepth` from CodingDirectorAgent
- Red indicator when no tasks available (NOT READY)
- Green indicator when actively processing a coding task
- Yellow indicator when tasks are queued but prerequisites may be blocking

> **👤 User View**: The Coding tab shows you what the external coding agent is working on (or waiting for). "NOT READY" means there's nothing in the coding queue yet — the Planning team needs to create coding tasks first. Once tasks flow in, you'll see the active task and queue depth.

> **🔧 Developer View**: Status comes from `CodingDirectorAgent.getQueueStatus()` exposed via `GET /api/coding/status`. The endpoint returns `{ hasPendingTask, currentTask, queueDepth }`. The UI polls this every 5s. SSE events (`ticket:enqueued` with `queue=coding_director`) can trigger immediate refresh.

### Guided Tour (First Run)

When no plans exist, shows a welcome tour explaining the 3-stage model with a "Create Your First Plan" button.

### State Persistence

Planning page fully restores state after reboot — phase indicator, tasks, design, QA scores, question count — all from SQLite via API. SSE events drive real-time updates without page reload.

---

## Accessibility Requirements

COE targets **WCAG 2.1 Level AA** compliance across all UI surfaces. Accessibility is not optional — it's a core design constraint.

### Color Contrast

| Element | Foreground | Background | Ratio | Target |
|---------|-----------|------------|-------|--------|
| Body text | `#D4D4D4` | `#1E1E1E` | 10.5:1 | AA (4.5:1 min) ✅ |
| Primary buttons | `#FFFFFF` | `#3B82F6` | 8.6:1 | AA ✅ |
| Error text | `#F87171` | `#1E1E1E` | 5.3:1 | AA ✅ |
| Warning text | `#FBBF24` | `#1E1E1E` | 11.2:1 | AA ✅ |
| Success text | `#34D399` | `#1E1E1E` | 8.9:1 | AA ✅ |
| Disabled text | `#6B7280` | `#1E1E1E` | 4.6:1 | AA (borderline) |
| Status badges | White on priority color | — | ≥4.5:1 | AA ✅ |

### Keyboard Navigation

All interactive elements must be reachable via keyboard. Tab order follows visual reading order (top-to-bottom, left-to-right).

| Context | Key | Action |
|---------|-----|--------|
| **Global** | `Tab` / `Shift+Tab` | Move focus forward / backward |
| **Global** | `Escape` | Close modal, dismiss popup, cancel action |
| **Global** | `Enter` | Activate focused button/link |
| **Sidebar tree** | `↑` / `↓` | Navigate tree items |
| **Sidebar tree** | `→` / `←` | Expand / collapse tree node |
| **Sidebar tree** | `Space` | Toggle selection |
| **Planning Wizard** | `Enter` | Select option / advance to next question |
| **Planning Wizard** | `←` / `→` | Switch between options in single-select |
| **Planning Wizard** | `Space` | Toggle checkbox in multi-select |
| **Ticket reply** | `Ctrl+Enter` | Send reply |
| **Custom Agent Builder** | `Ctrl+S` | Save agent |
| **Verification Panel** | `R` | Re-run tests (when panel is focused) |
| **Modal dialogs** | `Tab` traps focus inside modal | Focus cannot escape until dismissed |

### Screen Reader Support

| Element | ARIA Label/Role | Screen Reader Announcement |
|---------|----------------|---------------------------|
| Agent status icon | `role="status"` + `aria-label="Planning Team: Idle"` | "Planning Team status: Idle" |
| Priority badge | `aria-label="Priority 1"` | "Priority 1" |
| Ticket count | `aria-live="polite"` | Announces count changes without focus |
| Phase indicator | `role="progressbar"` + `aria-valuenow` | "Phase 3 of 8: Design Review" |
| Error banners | `role="alert"` | Immediately announced on appearance |
| Toast notifications | `role="status"` + `aria-live="polite"` | Announced after current speech completes |
| Buttons | Descriptive `aria-label` when icon-only | "Re-run tests" not just icon |
| Form fields | `aria-describedby` linking to help text | "Agent name, 3 to 50 characters" |

### Focus Management Rules

1. **Modal open** → Focus moves to first interactive element inside modal
2. **Modal close** → Focus returns to the element that opened the modal
3. **Toast notification** → Focus stays where it is (toast is `aria-live`)
4. **Page navigation** → Focus moves to page heading (`<h1>`)
5. **Dynamic content load** → Announce via `aria-live` region, don't steal focus
6. **Error state** → Focus moves to error message, then user can Tab to the retry button

> **👤 User View**: Every part of COE works with keyboard alone — no mouse required. Screen readers announce status changes, errors, and navigation automatically. If you use high-contrast mode in VS Code, COE respects those settings.

> **🔧 Developer View**: Use semantic HTML (`<button>`, `<nav>`, `<main>`, `<section>`) instead of styled `<div>` elements. Always add `aria-label` to icon-only buttons. Test with NVDA/VoiceOver before shipping new UI. The VS Code webview inherits the editor's color theme via CSS variables (`--vscode-editor-background`, etc.) — use those, don't hardcode colors.

---

## Keyboard Shortcuts

### VS Code Command Palette Commands

All COE commands are available via `Ctrl+Shift+P` → type "COE":

| Command | Shortcut | Description |
|---------|----------|-------------|
| `COE: Open Dashboard` | `Ctrl+Shift+D` | Opens the webapp in browser |
| `COE: Create New Plan` | — | Launches the Planning Wizard |
| `COE: Show Next Task` | — | Shows the next task for the coding agent |
| `COE: Answer Ticket` | — | Opens the oldest open ticket |
| `COE: Run Verification` | — | Runs verification on the current task |
| `COE: Fresh Restart` | — | Resets the system to a clean state |
| `COE: Show Agent Status` | — | Opens a quick-pick showing all agent statuses |
| `COE: Create Custom Agent` | — | Opens the Custom Agent Builder |

### Webapp Keyboard Shortcuts

| Page | Shortcut | Action |
|------|----------|--------|
| **Any page** | `?` | Show keyboard shortcut overlay |
| **Any page** | `Ctrl+K` | Open quick search (tickets, tasks, plans) |
| **Planning** | `N` | Start new plan |
| **Tasks** | `J` / `K` | Navigate up/down in task list |
| **Tasks** | `Enter` | Open selected task detail |
| **Tickets** | `R` | Reply to selected ticket |
| **Tickets** | `E` | Escalate selected ticket |
| **Settings** | `Ctrl+S` | Save settings |

> **👤 User View**: Press `?` on any page to see all available keyboard shortcuts. The most important one is `Ctrl+K` — it opens a quick search bar that finds any ticket, task, or plan instantly.

> **🔧 Developer View**: Shortcuts are registered in each page's JavaScript file via `document.addEventListener('keydown', ...)`. The quick search (`Ctrl+K`) calls `GET /api/search?q=...` which searches across tasks, tickets, and plans tables with `LIKE` queries. Shortcut overlay is a modal in `src/webapp/components/shortcut-overlay.html`.

---

## Interaction Patterns

### Drag-and-Drop

| Context | What Can Be Dragged | Drop Target | Effect |
|---------|---------------------|-------------|--------|
| Planning Wizard (Custom mode) | Question cards | Reorder zone | Changes question order |
| Task list | Task rows | Priority columns | Changes task priority |
| Custom Agent Builder | Goal items | Reorder zone | Changes goal priority |
| Designer canvas (v2.0) | Components from palette | Canvas area | Places component on page |

**Drag behavior**: Ghost image follows cursor at 50% opacity. Drop target highlights with blue border. Invalid drop targets show red border. `Escape` cancels drag. All drag-and-drop has keyboard equivalents (select item + `Alt+↑` / `Alt+↓` to reorder).

### Right-Click Context Menus

| Context | Right-Click Target | Menu Options |
|---------|--------------------|-------------|
| Task list item | Any task row | View Details, Edit, Change Priority, Delete, Copy ID |
| Ticket list item | Any ticket row | View Thread, Reply, Escalate, Close, Copy ID |
| Agent list item | Any agent row | View Status, View Last Output, Restart |
| Designer component (v2.0) | Component on canvas | Properties, Duplicate, Delete, Move to Front/Back |

### Tooltips and Hover States

- **All icon-only buttons**: Show text tooltip on hover (200ms delay, 300ms fade-in)
- **Priority badges**: Show full priority name ("P1 — Critical", "P2 — Important", "P3 — Nice to Have")
- **Agent status**: Show last action summary and timestamp
- **Truncated text**: Show full text in tooltip when text is ellipsized

### Confirmation Dialogs

Destructive actions always show a confirmation dialog:

| Action | Dialog Title | Confirm Button | Has "Don't ask again"? |
|--------|-------------|----------------|----------------------|
| Delete task | "Delete task?" | "Delete" (red) | No |
| Fresh restart | "Reset everything?" | "Reset" (red) | No |
| Close ticket without reply | "Close without replying?" | "Close" (yellow) | Yes |
| Delete custom agent | "Delete agent?" | "Delete" (red) | No |
| Reject verification | "Reject and create follow-up?" | "Reject" (yellow) | No |

> **👤 User View**: Right-click anything for more options. Drag items to rearrange. Destructive actions always ask for confirmation — you won't accidentally delete something.

> **🔧 Developer View**: Context menus use the browser's native `contextmenu` event with a custom menu component (`src/webapp/components/context-menu.js`). Confirmation dialogs use `src/webapp/components/confirm-dialog.js` with configurable title, message, confirmText, confirmColor, and showDontAskAgain props. "Don't ask again" preferences are stored in `localStorage`.

---

## Responsive Behavior

### Sidebar Panel

| Width | Behavior |
|-------|----------|
| < 200px | Minimum width enforced by VS Code — panel won't shrink further |
| 200–300px | Compact mode: single-line items, badges only (no text labels) |
| 300–500px | Normal mode: full item text, badges with labels |
| > 500px | Wide mode: item text + secondary info (timestamps, agent names) |

### Webapp (Browser)

| Breakpoint | Layout |
|------------|--------|
| < 640px (mobile) | Single column, stacked sections, hamburger nav, bottom tab bar |
| 640–1024px (tablet) | Two columns for task/ticket lists, collapsible sidebar nav |
| 1024–1440px (desktop) | Full three-column layout (nav + content + detail panel) |
| > 1440px (wide) | Three columns with wider content area, side panels max-width 400px |

### Planning Wizard Responsive

| Breakpoint | Wizard Layout |
|------------|---------------|
| < 640px | Questions stack vertically, impact simulator below questions |
| 640–1024px | Questions left (60%), impact simulator right (40%) |
| > 1024px | Questions left (50%), impact simulator right (50%) with Mermaid graph |

### Designer Canvas Responsive (v2.0)

| Breakpoint | Canvas Layout |
|------------|---------------|
| < 768px | Canvas full-width, component palette as bottom drawer |
| 768–1200px | Canvas left (70%), properties panel right (30%) |
| > 1200px | Palette left (15%), canvas center (55%), properties right (30%) |

> **👤 User View**: COE works on any screen size. On a phone, the layout stacks vertically. On a big monitor, you get side-by-side panels. The Planning Wizard impact simulator is always visible alongside your current question.

> **🔧 Developer View**: Breakpoints are set in `src/webapp/styles/responsive.css` using CSS `@media` queries. The webapp uses CSS Grid for page layout and Flexbox for component-level layout. Test responsive behavior with Chrome DevTools device toolbar. The sidebar compact/normal/wide modes are controlled by a ResizeObserver on the sidebar container element.

---

## Sidebar Tab Refresh System

The sidebar tree views auto-refresh based on system events. No polling is used.

| Tab | Event Source | Trigger | Auto-Refresh? |
|-----|-------------|---------|---------------|
| Task Queue | MCP `reportTaskDone` | Status changed | ✅ Yes |
| Completed History | Task Queue | Task done/verified | ✅ Yes |
| Agents | Agent state service | State changed | ✅ Yes |
| Tickets | Ticket DB/MCP | CRUD/resolve | ✅ Yes |

### Manual Refresh Button

Each tab header has a refresh button (circular arrow icon):
1. **Click**: Spinner animation starts
2. **On success**: Spinner stops, toast "Synced (N updates)", changed items highlight briefly (yellow, 2 sec)
3. **On error**: Spinner stops, toast error "Failed to sync — [Retry]"
4. **Strategy**: Incremental fetch only (`WHERE updated_at > lastRefresh`), not full reload

> **👤 User View**: You'll rarely need the refresh button — tabs update automatically when things change. But if you ever feel out of sync, click the little refresh icon on any tab header.

> **🔧 Developer View**: Each tab's `TreeDataProvider` implements `onDidChangeTreeData` event. The refresh button calls `provider.refresh()` which fires the event. Incremental fetch uses the `updated_at` column with a stored `lastRefresh` timestamp. The highlight animation uses CSS `@keyframes` with a `data-updated` attribute set temporarily on changed tree items.

---

## Notification System

### Toast Notifications

| Type | Color | Icon | Auto-dismiss | Example |
|------|-------|------|-------------|---------|
| Success | Green (#34D399) | ✅ | 3 sec | "Task completed successfully" |
| Info | Blue (#3B82F6) | ℹ️ | 5 sec | "New ticket from Planning Team" |
| Warning | Yellow (#FBBF24) | ⚠️ | 8 sec | "LLM connection slow" |
| Error | Red (#F87171) | ❌ | Manual dismiss | "Database error — click to retry" |

### Badge Notifications

| Location | Badge Color | Meaning |
|----------|------------|---------|
| COE sidebar icon | Red dot | Unread tickets or errors |
| Tab headers | Number badge | Count of items needing attention |
| P1 tickets | Pulsing red | Urgent question waiting for user |
| Boss AI indicator | Orange dot | Issues detected, needs review |

### Notification Priority Rules

1. **Error notifications** always appear on top
2. **P1 ticket notifications** pulse and persist until acknowledged
3. **Success notifications** auto-dismiss (3 sec) and stack (max 3 visible)
4. **Duplicate notifications** are suppressed (same message within 10 sec)
5. **System is offline**: A persistent yellow banner replaces all toasts: "COE is offline — reconnecting..."

> **👤 User View**: Notifications appear as small banners at the top of the webapp or as VS Code notifications in the sidebar. Critical ones (P1 tickets, errors) stay visible until you deal with them. Everything else fades away after a few seconds.

> **🔧 Developer View**: Toast component is `src/webapp/components/toast.js`. Toasts are managed by a `NotificationManager` singleton that handles stacking, deduplication, and auto-dismiss timers. VS Code-side notifications use `vscode.window.showInformationMessage()` / `showWarningMessage()` / `showErrorMessage()`. Badge counts update via SSE events from the server.

---

## Cross-References

- → [02-System-Architecture-and-Design](02-System-Architecture-and-Design.md) §Layer 1 for technical UI architecture
- → [04-Workflows-and-How-It-Works](04-Workflows-and-How-It-Works.md) for workflow-triggered UI states
- → [08-Context-Management-and-Safety](08-Context-Management-and-Safety.md) §Security for auth-related UI flows
- → [09-Features-and-Capabilities](09-Features-and-Capabilities.md) for feature status that drives UI availability
- → [11-Program-Designer-PRD](11-Program-Designer-PRD.md) §6.1 for v2.0 designer canvas specification
- → [14-AI-Agent-Behavior-Spec](14-AI-Agent-Behavior-Spec.md) §Behavioral States for agent status display rules
