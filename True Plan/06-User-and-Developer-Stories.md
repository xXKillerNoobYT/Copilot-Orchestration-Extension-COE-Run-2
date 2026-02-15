# 06 — User Stories & Developer Stories

**Version**: 2.0  
**Last Updated**: February 2026  
**Status**: ✅ Current  
**Depends On**: [01-Vision-and-Goals](01-Vision-and-Goals.md), [05-User-Experience-and-Interface](05-User-Experience-and-Interface.md), [12-Agile-Stories-and-Tasks](12-Agile-Stories-and-Tasks.md)  
**Changelog**: v2.0 — Added standardized header, User/Dev views, v2.0 stories (visual designer, coding agent, sync, ethics), acceptance criteria, onboarding story, failure/recovery stories, before-vs-after comparisons, cross-links to doc 12

---

## How to Read This Document

This document describes COE from the perspective of the people (and AI systems) that use it. Each story follows a consistent format: a user need statement, a detailed experience narrative, acceptance criteria, and before-vs-after comparison.

> **👤 User View**: These stories describe YOUR experience — what it feels like to use COE day-to-day. Read the stories for your persona (Solo Developer, Tech Lead, Product Owner) to understand what COE does for you.

> **🔧 Developer View**: Each story maps to specific implementation in the codebase. Cross-references to [Doc 12 (Agile Stories)](12-Agile-Stories-and-Tasks.md) show which user stories drive which developer tasks. Use the acceptance criteria to write tests.

---

## Onboarding Story: First-Time User Experience

> **As a new user**, I want a guided introduction to COE the first time I install it — so I understand the system without reading documentation.

**Experience**:
1. I install the COE extension from the VS Code Marketplace
2. VS Code shows a welcome notification: "Welcome to COE! Click here to get started."
3. I click — a guided tour opens explaining the 3-stage model (Plan & Design → Code → Verify)
4. The tour highlights 4 key areas: Sidebar (agent status), Planning (create plans), Tasks (execution queue), Tickets (communication)
5. At the end: "Ready to create your first plan?" with a big "Create Plan" button
6. I click it and the Planning Wizard starts with the first triage question
7. After completing the wizard (15 minutes for my MVP + Backend project), I have 28 tasks ready
8. The dashboard shows my progress: "0 of 28 tasks complete — let's get started!"

**Acceptance Criteria**:
- [ ] Guided tour appears only on first activation (not every launch)
- [ ] Tour has ≤ 5 steps, each taking ≤ 15 seconds to read
- [ ] "Create Plan" button at tour end opens Planning Wizard
- [ ] Tour can be skipped at any time ("Skip Tour" link visible on every step)
- [ ] Tour state persisted so it doesn't re-appear after restart

**Before COE**: I would install a new tool, spend 30 minutes reading docs, still not understand how to start.  
**With COE**: 2-minute guided tour → first plan created in 15 minutes → building within 20 minutes of install.

> **🔧 Developer View**: Tour state is stored in `globalState` via VS Code's `ExtensionContext.globalState.update('tourCompleted', true)`. Tour steps are defined in `src/views/tour.ts`. The "Create Plan" button calls `vscode.commands.executeCommand('coe.createPlan')`.

---

## As a User (Solo Developer)

### Planning a New Project

> **As a solo developer**, I want to describe my project idea in plain language and have COE break it down into a structured, prioritized task list — so I can start building immediately without spending hours planning.

**Experience**:
1. I open VS Code and click the COE icon in the sidebar
2. I click "Create New Plan"
3. The Planning Wizard asks me 3 triage questions: project scale, focus area, top priorities
4. Based on my answers (MVP + Backend), it skips irrelevant UI questions and shows me only 6 focused questions
5. As I answer, the Impact Simulator shows me a live preview: "28 tasks, ~18 hours, SQLite recommended"
6. I click "Generate Plan" and within seconds I have 28 tasks, properly ordered by priority and dependency
7. The first P1 task is ready for my coding AI to pick up

**Acceptance Criteria**:
- [ ] Wizard generates ≥ 10 tasks from any project description
- [ ] Tasks have correct priority ordering (P1 before P2 before P3)
- [ ] Dependencies are automatically detected and set
- [ ] Time from "Create Plan" to generated tasks < 60 seconds
- [ ] Impact Simulator updates within 400ms of each answer
- [ ] MVP + Backend path completes in ≤ 20 minutes

**Cross-ref**: → [Doc 12, Epic 1: Designer Canvas](12-Agile-Stories-and-Tasks.md)

**Before COE**: I would spend 2–3 hours manually planning, still miss edge cases, and have no dependency tracking.  
**With COE**: 15–20 minutes of answering questions → complete, structured plan with dependencies.

---

### Getting Work Done with AI

> **As a solo developer**, I want my AI coding assistant to work through tasks one at a time, in the right order, asking questions when confused — so I can trust the AI is building exactly what I planned.

**Experience**:
1. GitHub Copilot calls `getNextTask` and receives Task #1 with a detailed context bundle
2. The sidebar shows: "🤖 Copilot working on: Create user registration endpoint"
3. Copilot encounters ambiguity about which auth library to use
4. It calls `askQuestion` — the Answer Agent responds in <5 seconds: "Use Passport.js — see plan section 3.2"
5. Copilot finishes and calls `reportTaskDone`
6. The Verification Team waits 60 seconds, then runs tests — all pass
7. The sidebar updates: "✅ Task #1 complete — Task #2 unlocked"
8. I can see the progress bar: "4 of 28 tasks complete (14%)"

**Acceptance Criteria**:
- [ ] `getNextTask` returns task with complete context bundle (title, description, priority, dependencies, related files)
- [ ] Sidebar shows real-time agent status updates within 1 second
- [ ] `askQuestion` returns answer within 10 seconds for simple questions
- [ ] `reportTaskDone` triggers verification within 60 seconds
- [ ] Progress indicator updates after each task completion
- [ ] Only one task is active at any time ("One Thing at a Time" enforced)

**Cross-ref**: → [Doc 12, Epic 3: AI Coding Agent](12-Agile-Stories-and-Tasks.md)

---

### Reviewing AI Work

> **As a developer**, I want to see verification results for every completed task, with clear pass/fail indicators and design system references — so I can trust the quality of AI-generated code.

**Experience**:
1. A notification appears: "Verification complete for Task #12 — 2 items need attention"
2. I click to open the Verification Panel
3. I see: ✅ 8 tests passed, ✅ Coverage 87%, ☐ Mobile responsive (not checked)
4. The panel shows the design system reference: "Sidebar collapses at <768px"
5. I manually check the mobile view, click "Approve"
6. Task #12 is marked complete, and 3 dependent tasks are unlocked

**Acceptance Criteria**:
- [ ] Verification panel shows within 2 seconds of clicking notification
- [ ] Pass/fail indicators are clear and unambiguous (✅/☐/❌)
- [ ] Design system reference shown for visual tasks
- [ ] "Approve" moves task to complete and unlocks dependents
- [ ] "Reject + Create Task" creates a child task with failure details pre-filled
- [ ] Coverage percentage displayed and accurate (matches Jest output)

---

### Handling AI Questions

> **As a developer**, I want AI questions to come through a structured ticket system — so I can answer them clearly and have a record of every decision made.

**Experience**:
1. A sidebar notification appears: "🎫 New Ticket TK-007 [P1] — Should sessions persist across restarts?"
2. I click the ticket to see the full question with context
3. I type: "Yes, persist sessions to SQLite with 7-day expiry"
4. The Clarity Agent reviews my answer, scores it 92% — "Clear"
5. The ticket is resolved, and the coding AI resumes with my answer
6. Weeks later, when someone asks "Why did we choose SQLite for sessions?", the ticket history provides the answer

**Acceptance Criteria**:
- [ ] P1 tickets appear within 2 seconds of creation
- [ ] Clarity scoring shown per message (0–100 scale)
- [ ] Auto-resolve when clarity ≥ 75
- [ ] Escalation to human when clarity < 50 after 2 attempts
- [ ] Full ticket history searchable and permanent
- [ ] Decision Memory Agent finds related past decisions

---

### Starting Fresh

> **As a developer**, I want to reset the entire project state and reload everything from disk — so I can recover from any inconsistency or onboard a new team member cleanly.

**Experience**:
1. I click "Fresh Restart" in the command palette
2. COE clears in-memory state (task queue, verification cache)
3. COE re-reads PRD.md, GitHub issues, and plan.json from disk
4. COE verifies: all dependencies available, no orphaned tasks, verification status consistent
5. Dashboard shows: "Fresh restart complete. 12 tasks ready. Highest priority: TASK-028 (Auth endpoint)"
6. I'm back to a clean, known state

**Acceptance Criteria**:
- [ ] Fresh restart completes in < 30 seconds
- [ ] No data loss (SQLite DB preserved, only in-memory caches cleared)
- [ ] All tasks re-validated against disk state
- [ ] Orphaned tasks detected and flagged
- [ ] Dashboard shows restart summary with task counts

---

## v2.0 Stories: Visual Designer, Coding Agent, Sync & Ethics

### Using the Visual Program Designer

> **As a developer**, I want to visually design my application's UI by dragging components onto a canvas — so I can see what I'm building before any code is written.

**Experience**:
1. I open a plan and navigate to the Designer page
2. I see a canvas area with a component palette on the left: Primitive Inputs, Containers, Interactive Logic, Data & Sync, Ethics & Rights
3. I drag a "Text Input" component onto the canvas — it appears with a dashed outline
4. I click it to open the Properties panel: label, placeholder, validation rules, data binding
5. I drag a "Container" and drop the text input inside — it auto-resizes
6. I add an IF-THEN logic block: "If user.role === 'admin', show admin panel"
7. The Code Preview panel on the right shows the generated React TSX in real-time
8. I click "Run Design QA" — the Architect scores the design 82/100, Gap Hunter finds 3 issues
9. I address the issues, score rises to 91/100
10. I click "Generate Code" — COE creates tasks to implement each component

**Acceptance Criteria**:
- [ ] Canvas renders at 60fps during drag operations
- [ ] Component palette shows all 5 groups with search/filter
- [ ] Properties panel updates component in real-time (< 200ms)
- [ ] Code preview generates valid React TSX for any component combination
- [ ] Design QA scoring runs in < 5 seconds
- [ ] Generated tasks reference specific components and their code templates

**Before COE**: I would sketch on paper, then manually convert to code, then find design issues during development.  
**With COE**: Visual design → automatic code generation → quality-checked before any manual coding.

> **🔧 Developer View**: Canvas is implemented as an HTML5 `<canvas>` webview in `src/webapp/designer.html`. Components are defined in `ComponentSchema` (see [Doc 13 §1](13-Implementation-Plan.md)). Drag-and-drop uses the HTML5 Drag API. Code generation uses the component-to-code mapping tables in [Doc 13 §4](13-Implementation-Plan.md). Design QA uses `DesignQAService` → `ArchitectAgent` + `GapHunterAgent` + `HardenerAgent`.

**Cross-ref**: → [Doc 12, Epic 1: Designer Canvas (US-01 through US-06)](12-Agile-Stories-and-Tasks.md), [Doc 11 §6.1](11-Program-Designer-PRD.md)

---

### Working with the Integrated Coding Agent

> **As a developer**, I want to give natural language commands to a coding agent that understands my project's plan and context — so I can describe what I want and get working code back.

**Experience**:
1. I open the coding agent panel and type: "Add a search function to the task list"
2. The agent classifies my intent (code_generation), checks ethics (approved), and loads context
3. Within 5 seconds, I see a code preview: new `searchTasks()` function with TypeScript types
4. The agent shows a diff view: 12 lines added to `src/core/database.ts`, 8 lines added to `src/mcp/server.ts`
5. I review the diff — one line needs adjustment. I type: "Change the search to be case-insensitive"
6. The agent updates the diff in 3 seconds
7. I click "Apply Changes" — the code is written to disk
8. The Verification Team runs tests — all pass
9. A new task is created: "Add search UI to task list" (auto-generated subtask)

**Acceptance Criteria**:
- [ ] Natural language commands parsed into actionable code within 10 seconds
- [ ] Diff view shows exact changes before any files are modified
- [ ] User must explicitly approve ("Apply Changes") before code is written
- [ ] Auto-generated subtasks capture follow-up work
- [ ] Ethics gate blocks harmful code generation (e.g., deleting user data without confirmation)
- [ ] Full audit trail: command → classification → code → approval → write

**Before COE**: I would write code manually, test it, realize I missed edge cases, refactor, repeat.  
**With COE**: Describe what I want → review generated code → approve → done. Edge cases caught by verification.

> **🔧 Developer View**: Coding agent pipeline is: Intent Classification → Ethics Gate → Context Loading → Code Generation → Diff Generation → User Approval → File Write → Verification Trigger. See [Doc 14 §Behavioral States](14-AI-Agent-Behavior-Spec.md) and [Doc 13 §6](13-Implementation-Plan.md).

**Cross-ref**: → [Doc 12, Epic 3: AI Coding Agent (US-15 through US-22)](12-Agile-Stories-and-Tasks.md)

---

### Setting Up Multi-Device Sync

> **As a developer who works on multiple machines**, I want my plans, tasks, and settings to sync automatically — so I can start on my desktop and continue on my laptop without losing anything.

**Experience**:
1. I open Settings → Sync and choose my sync method: Cloud (GitHub Gist), NAS (SMB share), or Peer-to-Peer (local network)
2. I configure the connection (for Cloud: my GitHub token; for NAS: share path; for P2P: device name)
3. COE creates a sync profile and performs an initial full sync
4. I switch to my laptop, install COE, and configure the same sync method
5. Within 10 seconds, my laptop has all my plans, tasks, completed history, and settings
6. I make a change on my laptop — a notification on my desktop shows: "Synced: 3 tasks updated from Laptop"
7. If I edit the same task on both devices before sync, a conflict resolution dialog appears with 3 options: Keep Mine, Keep Theirs, Merge

**Acceptance Criteria**:
- [ ] Initial sync completes in < 30 seconds for < 1000 tasks
- [ ] Incremental sync detects changes within 5 seconds
- [ ] Conflict dialog shows both versions side-by-side with diff highlighting
- [ ] "Merge" option available for non-overlapping changes
- [ ] Sync works offline (queues changes, syncs when reconnected)
- [ ] Data encrypted in transit (TLS for Cloud/NAS, WireGuard for P2P)
- [ ] No data loss in any sync scenario (verified by checksum)

**Before COE**: I would manually copy files between machines, or use Git branches for plan files which constantly mergestorm.  
**With COE**: Automatic sync — I just work. Conflicts are rare and resolved with one click.

> **🔧 Developer View**: Sync is handled by `SyncService` which uses 3 transport adapters (`CloudSyncAdapter`, `NasSyncAdapter`, `P2PSyncAdapter`). Change detection uses field-level SHA-256 hashing stored in `sync_state` table. Conflict resolution uses the algorithm in [Doc 13 §5](13-Implementation-Plan.md). Distributed locking prevents simultaneous writes. See [Doc 11 §6.4](11-Program-Designer-PRD.md) for full protocol.

**Cross-ref**: → [Doc 12, Epic 4: Multi-Device Sync (US-23 through US-27)](12-Agile-Stories-and-Tasks.md)

---

### Ethics & Transparency in Action

> **As a developer**, I want COE to prevent my AI agents from generating harmful, biased, or rights-violating code — so I can trust that AI-generated code follows ethical standards.

**Experience**:
1. I set up my ethics preferences in Settings → Ethics: sensitivity level (Medium), enabled modules (all 6)
2. I ask the coding agent: "Generate a user profile page that collects age, race, and income"
3. The ethics engine flags: "⚠️ Collecting race and income data triggers FreedomGuard privacy review"
4. A dialog shows: "This data collection may violate privacy principles. Required: explicit consent mechanism, data minimization justification, right-to-delete implementation."
5. I choose: "Add consent mechanism" — the agent regenerates with a consent dialog built in
6. I check the Transparency Log: every ethics decision is recorded with timestamp, module, decision, reasoning
7. The log shows: "Privacy module blocked direct collection → redirected to consent flow → user approved"

**Acceptance Criteria**:
- [ ] Ethics evaluation runs in < 2 seconds per code generation request
- [ ] 6 ethics modules active: Autonomy, Privacy, Expression, Access, Transparency, Security
- [ ] Sensitivity levels configurable: Low (permissive), Medium (balanced), High (strict)
- [ ] Every ethics decision logged in transparency log with full reasoning
- [ ] User can override ethics blocks with justification (logged permanently)
- [ ] Permission manifest defines what each agent can/cannot do

**Before COE**: I would unknowingly generate code that collects sensitive data without consent mechanisms, creating legal and ethical risk.  
**With COE**: Ethics engine catches issues before code is written, suggests compliant alternatives, and maintains an audit trail.

> **🔧 Developer View**: Ethics pipeline: `EthicsEngine.evaluate(code, context)` → runs all 6 modules → returns `EthicsResult` with approve/flag/block decision. Transparency Logger writes to `transparency_log` table. See [Doc 11 §6.5](11-Program-Designer-PRD.md) and [Doc 14 §Ethical Constraints](14-AI-Agent-Behavior-Spec.md).

**Cross-ref**: → [Doc 12, Epic 5: Ethics & Rights (US-28 through US-32)](12-Agile-Stories-and-Tasks.md)

---

## As a Developer (Building/Extending COE)

### Understanding the System

> **As a developer contributing to COE**, I want a clear separation between agents so I know exactly where to add new functionality — without accidentally breaking other agents' responsibilities.

**Key Boundaries**:
- **Planning** never touches code execution or verification
- **Answer Agent** only responds when asked — never proactive
- **Verification** is completely independent from coding
- **Custom Agents** can never write files (hardlock)
- **Orchestrator** routes but never processes work directly

---

### Creating a Custom Agent

> **As a developer**, I want to create a specialized agent for my domain (e.g., security analysis) without writing code — so I can extend COE's capabilities for my specific needs.

**Experience**:
1. I open the Custom Agent Builder in the sidebar
2. I fill in: Name, description, system prompt
3. I add 3 goals: "Scan for vulnerabilities", "Check dependencies", "Report findings"
4. I add a checklist: "Check OWASP Top 10", "Review auth flow", "Check for hardcoded secrets"
5. I set routing keywords: "security", "vulnerability", "scan"
6. I review permissions: read files ✅, create tickets ✅, write files 🔒 (locked)
7. I click "Save Agent" — my new Security Analyst agent is ready to use
8. Next time someone mentions "security" in a task, the Orchestrator routes to my agent

**Acceptance Criteria**:
- [ ] Agent creation completes without writing any code
- [ ] Routing keywords trigger the agent on matching messages
- [ ] Custom agents cannot write files or execute code (hardlock enforced)
- [ ] Custom agents appear in sidebar Agent list with status
- [ ] YAML config stored in `custom_agents` table
- [ ] Agent can be edited, paused, or deleted after creation

**Cross-ref**: → [Doc 03 §Custom Agent Teams](03-Agent-Teams-and-Roles.md), [Doc 05 §Custom Agent Builder](05-User-Experience-and-Interface.md)

---

### Understanding the MCP Tools

> **As a developer integrating with COE**, I want to understand the 6 MCP tools that coding agents can call — so I can build reliable integrations.

**The 6 Tools**:

| Tool | When to Call | What You Get Back |
|------|-------------|-------------------|
| `getNextTask` | "Give me work to do" | Task with context bundle, priority, dependencies |
| `reportTaskDone` | "I finished this task" | Acknowledgment + verification trigger |
| `askQuestion` | "I'm confused about something" | Evidence-based answer with confidence score |
| `getErrors` | "I hit an error" | Error logged + investigation task if needed |
| `callCOEAgent` | "I need a specific agent" | Direct response from named agent |
| `scanCodeBase` | "Scan the project for issues" | Aligned files, mismatches, summary |

---

## As a Tech Lead

### Project Oversight

> **As a tech lead**, I want a real-time dashboard of project progress with risk indicators — so I can identify problems early and communicate status to stakeholders.

**What I See**:
- Overall progress: "67% complete — 24 of 36 tasks done"
- P1 status: "All P1 tasks complete ✅"
- Blockers: "3 tasks blocked by auth dependency"
- Risk flags: "Plan drift detected in navigation module"
- Agent health: All agents operational, average response time 3.2s
- Verification results: "89% first-pass success rate"

---

### Managing Priorities

> **As a tech lead**, I want to set priority levels on features and have COE automatically order all work accordingly — so the most important things get done first.

**How It Works**:
- I mark features as P1 (must have), P2 (should have), P3 (nice to have)
- COE enforces: Only one P1 task active at any time
- P2 tasks are blocked until P1 dependencies are complete
- The Boss AI limits task generation to 10 ahead to prevent overload
- Every 5–10 completed tasks → automatic checkpoint commit
- Every priority level complete → tagged release (e.g., v0.1-P1)

---

## As a Product Owner

### Tracking Feature Delivery

> **As a product owner**, I want to see which features have been completed, verified, and shipped — so I can track delivery against our roadmap.

**What I See**:
- Feature list with completion percentage per feature
- Which features are MVP (mandatory) vs. post-launch (optional)
- Acceptance criteria checklist per feature (checked/unchecked)
- Timeline estimate for remaining work
- Design choices made during planning (for review)

---

### Managing Scope

> **As a product owner**, I want to mark features as mandatory or optional during planning, and adjust priorities as requirements evolve — so the team always works on the most valuable things.

**How It Works**:
1. During the Planning Wizard, each feature gets a mandatory/optional flag
2. Optional features include a reason note (e.g., "Nice to have, defer to Phase 2")
3. I can change priorities at any time — COE re-orders the task queue
4. If I remove a feature, COE archives related tasks and cleans up dependencies
5. If I add a feature, COE's Planning Team decomposes it and slots tasks into the queue

---

## As the AI System (Copilot)

### Receiving Structured Work

> **As an AI coding agent**, I need structured, unambiguous task descriptions with all necessary context — so I can produce correct results without guessing.

**What I Receive via `getNextTask`**:
- Task title and description (one clear sentence)
- Priority level and status
- Acceptance criteria (exactly ONE, testable)
- Related files to read
- Architecture documents to reference
- Dependencies (what was completed before this task)
- Plan excerpt (relevant design decisions)

---

### Asking for Help

> **As an AI coding agent**, I need a reliable way to ask questions when I'm uncertain — so I never implement based on assumptions.

**My Protocol**:
- If I'm less than 95% confident about ANY decision → call `askQuestion`
- I receive: answer text, confidence score, source citations
- If the answer's confidence is also low → the question is escalated to the human
- I'm limited to 8 questions per task (rate limit to encourage focused questions)
- Every question and answer is logged for future reference

---

### Reporting Results

> **As an AI coding agent**, I need to report completion with details — so the Verification Team has enough information to check my work.

**What I Report via `reportTaskDone`**:
- Task ID
- Completion summary (what was implemented)
- Files modified
- Any decisions made during implementation
- The system then automatically triggers verification

**Acceptance Criteria**:
- [ ] `getNextTask` returns complete context bundle (not just task ID)
- [ ] `askQuestion` rate-limited to 8 per task
- [ ] `reportTaskDone` triggers verification within 60 seconds
- [ ] `getErrors` logs errors and optionally creates investigation tasks
- [ ] `callCOEAgent` routes to correct agent by name
- [ ] `scanCodeBase` returns file alignment report with actionable items

**Cross-ref**: → [Doc 02 §MCP API Reference](02-System-Architecture-and-Design.md)

---

## Failure & Recovery Stories

### LLM Goes Offline Mid-Task

> **As a developer**, when the LLM server goes down while my coding agent is working, I want COE to handle the outage gracefully — so no work is lost and I know what happened.

**Experience**:
1. The coding agent is working on Task #12 when the LLM connection drops
2. A yellow persistent banner appears: "⚠️ LLM server offline — COE is pausing agent work"
3. The task stays "in_progress" (not failed) — progress so far is preserved
4. Every 30 seconds, COE silently retries the connection
5. After 3 minutes, the LLM comes back. Banner changes: "✅ LLM reconnected — resuming"
6. The coding agent continues Task #12 from where it left off
7. I check the event log and see: "Connection lost at 14:32, reconnected at 14:35, 0 tasks lost"

**What Goes Right**:
- No work is lost (task stays in_progress, not failed)
- Automatic reconnection without user intervention
- Clear visual feedback throughout the outage
- Full audit trail of the outage

**What Could Go Wrong** (edge cases COE handles):
- LLM offline for > 15 minutes → Task moved to "stalled", all agents pause, Boss AI creates an alert
- Multiple tasks queued when offline → Queue preserved in order, all resume on reconnect
- Partial LLM response received → Discarded (never used incomplete responses)

> **🔧 Developer View**: Health check is in `LLMService.checkHealth()` which pings `GET /v1/models`. Reconnection uses exponential backoff (5s → 10s → 20s → 30s cap). The `AbortController` in the active LLM call catches the disconnect via `error.name === 'AbortError'` (string-based, never `instanceof`). Event bus emits `llm:offline` and `llm:online` events.

---

### Sync Conflict Between Devices

> **As a developer**, when I accidentally edit the same task on two devices before they sync, I want a clear conflict resolution dialog — so I can choose the right version without data loss.

**Experience**:
1. I edit Task #5's description on my desktop: "Add pagination to user list"
2. Before sync happens, I edit the same task on my laptop: "Add pagination with infinite scroll"
3. When sync runs, a conflict dialog appears on both devices:

```
┌────────────────────────────────────────────────────┐
│  Sync Conflict: Task #5                             │
├────────────────────────────────────────────────────┤
│                                                     │
│  Desktop version (2 min ago):                       │
│  "Add pagination to user list"                      │
│                                                     │
│  Laptop version (30 sec ago):                       │
│  "Add pagination with infinite scroll"              │
│                                                     │
│  [Keep Desktop] [Keep Laptop] [Merge (if possible)] │
└────────────────────────────────────────────────────┘
```

4. I choose "Keep Laptop" — both devices sync to the laptop version
5. The overwritten version is kept in conflict history (recoverable for 30 days)

**What Goes Right**:
- Both versions shown side-by-side with timestamps
- No silent data overwrite — always ask the user
- Overwritten version preserved in conflict history
- One-click resolution

> **🔧 Developer View**: Conflict detection uses field-level SHA-256 hashing. When two devices have different hashes for the same field, `ConflictResolver.resolve()` is called. Conflict history stored in `sync_conflicts` table. Merge is available when changes are in different fields (non-overlapping).

---

### Ethics Engine Blocks a Code Generation

> **As a developer**, when the ethics engine blocks my code generation request, I want to understand why and have options — so I'm not just told "no" without explanation.

**Experience**:
1. I ask: "Generate a function that deletes all user data without confirmation"
2. Ethics engine flags: "🛑 BLOCKED — This violates Autonomy principle: destructive operations require user confirmation"
3. The dialog shows:
   - **Why it was blocked**: "Mass data deletion without user consent violates FreedomGuard Autonomy module"
   - **Suggested alternative**: "Generate a function that deletes user data WITH a confirmation dialog and undo option"
   - **Override option**: "I understand the risk — proceed anyway" (requires typing justification)
4. I choose the suggested alternative — the agent generates a version with a confirmation dialog
5. The transparency log records: "Autonomy module blocked direct deletion → user accepted alternative → code generated with safeguards"

**What Goes Right**:
- Clear explanation of WHY it was blocked (not just "denied")
- Actionable alternative suggested (not just a wall)
- Override possible with logged justification (not a hard stop)
- Full transparency trail

---

### Database Corruption Recovery

> **As a developer**, if COE's SQLite database gets corrupted, I want automatic recovery — so I don't lose my project state.

**Experience**:
1. I open VS Code and COE fails to start: "⚠️ Database integrity check failed"
2. COE automatically attempts recovery:
   - Step 1: Try WAL checkpoint (fixes 90% of corruption cases)
   - Step 2: If WAL fails, try PRAGMA integrity_check and repair
   - Step 3: If repair fails, restore from last automatic backup (created every 50 task completions)
3. A dialog shows: "Database recovered from backup (2 hours old). 3 tasks may need re-verification."
4. COE runs a consistency check: compares DB state against files on disk
5. Dashboard shows: "Recovery complete. 2 tasks marked for re-verification."

**What Goes Right**:
- Automatic recovery without user intervention
- Automatic backups prevent catastrophic loss
- Consistency check after recovery ensures no orphaned data
- Clear communication about what was recovered and what might be stale

> **🔧 Developer View**: Database health is checked on startup by `Database.initialize()`. WAL mode provides built-in crash recovery. Automatic backups are triggered by the event bus on every 50th `task:completed` event. Backup files stored in `.coe/backups/` with timestamp naming. Maximum 5 backups retained (oldest auto-deleted).

---

## Story-to-Implementation Map

| Story Section | Primary Persona | Key Implementation Files | Doc 12 Stories |
|--------------|----------------|------------------------|----------------|
| Onboarding | New User | `src/views/tour.ts`, `src/extension.ts` | — |
| Planning a New Project | Solo Dev | `src/webapp/planning.html`, `src/agents/planning-agent.ts` | Epic 1 |
| Getting Work Done | Solo Dev | `src/mcp/server.ts` (getNextTask), `src/agents/orchestrator.ts` | Epic 3 |
| Reviewing AI Work | Solo Dev | `src/webapp/verification.html`, `src/agents/verification-agent.ts` | — |
| Handling Questions | Solo Dev | `src/webapp/tickets.html`, `src/agents/clarity-agent.ts` | — |
| Visual Designer | Solo Dev (v2.0) | `src/webapp/designer.html`, `src/core/component-schema.ts` | Epic 1, Epic 2 |
| Coding Agent | Solo Dev (v2.0) | `src/core/coding-agent-service.ts`, `src/agents/coding-agent.ts` | Epic 3 |
| Multi-Device Sync | Multi-device Dev (v2.0) | `src/core/sync-service.ts`, `src/core/conflict-resolver.ts` | Epic 4 |
| Ethics & Transparency | Any User (v2.0) | `src/core/ethics-engine.ts`, `src/core/transparency-logger.ts` | Epic 5 |
| Custom Agent | Developer (extending) | `src/webapp/custom-agents.html`, `src/core/custom-agent-builder.ts` | — |
| MCP Integration | AI System | `src/mcp/server.ts` | — |
| Project Oversight | Tech Lead | `src/webapp/dashboard.html` | — |
| Failure: LLM Offline | Any User | `src/core/llm-service.ts`, `src/core/event-bus.ts` | — |
| Failure: Sync Conflict | Multi-device Dev | `src/core/conflict-resolver.ts` | Epic 4 |
| Failure: Ethics Block | Any User | `src/core/ethics-engine.ts` | Epic 5 |
| Failure: DB Recovery | Any User | `src/core/database.ts` | — |

---

## Cross-References

- → [01-Vision-and-Goals](01-Vision-and-Goals.md) for the "why" behind these stories
- → [05-User-Experience-and-Interface](05-User-Experience-and-Interface.md) for the exact UI layouts these stories describe
- → [09-Features-and-Capabilities](09-Features-and-Capabilities.md) for feature status (which stories are implementable today)
- → [12-Agile-Stories-and-Tasks](12-Agile-Stories-and-Tasks.md) for the developer tasks that implement these stories
- → [14-AI-Agent-Behavior-Spec](14-AI-Agent-Behavior-Spec.md) for the AI system persona's behavioral rules
