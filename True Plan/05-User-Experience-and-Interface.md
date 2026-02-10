# User Experience & Interface Design

**Version**: 1.0  
**Date**: February 9, 2026

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
║  └── (Chat history with agents)      ║
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

Based on the first two answers, the wizard adapts:

| Selection | What Happens | Time to Complete |
|-----------|-------------|-----------------|
| MVP + Backend | Skip UI questions, condense to ~6 questions | 15–20 min |
| Medium + Frontend | Skip deep backend questions, emphasize layout & colors | 18–22 min |
| Large + Full Stack | Full 10-question flow with extra validation | 40–55 min |
| Any + Custom | Show all questions with drag-drop reordering | User-controlled |

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
