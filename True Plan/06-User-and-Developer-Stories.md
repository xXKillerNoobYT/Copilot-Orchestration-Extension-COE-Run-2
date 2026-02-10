# User Stories & Developer Stories

**Version**: 1.0  
**Date**: February 9, 2026

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
