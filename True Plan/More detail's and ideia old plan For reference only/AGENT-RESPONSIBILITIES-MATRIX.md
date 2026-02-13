# Agent Responsibilities & Coordination Matrix

**Version**: 2.0 (Consolidated)  
**Date**: February 1, 2026  
**Status**: MVP Handoff Definitions + Complete 9-Team Architecture  
**Cross-References**: [02-Agent-Role-Definitions.md](02-Agent-Role-Definitions.md), [07-Complete-Agent-Teams.md](07-Complete-Agent-Teams.md), [MODULAR-EXECUTION-PHILOSOPHY.md](MODULAR-EXECUTION-PHILOSOPHY.md)

---

## Overview

This document clarifies **who is responsible for what** across the COE agent team. It uses a **RACI matrix** (Responsible, Accountable, Consulted, Informed) for each critical handoff, removing ambiguity on agent boundaries.

**Key Principle**: Each handoff has exactly ONE decision point. When that condition is met, a specific agent takes over.

---

## Complete Agent/Team Inventory (9 Teams)

| # | Team/Agent Name | Type | Role | Primary Responsibilities | Escalation Path |
|---|---|---|---|---|---|
| **0** | Boss AI Team | Supervisor | Hierarchical overseer | System oversight, conflict resolution, drift detection, task limiting | User (modals) |
| **1** | Programming Orchestrator | Coordinator | Coding director | Route tasks to Coding AI, monitor progress, escalate to Answer Team | Boss AI → User |
| **2** | Planning Team | Planner | Task decomposition | Generate plans, estimate effort, create tasks, enforce atomicity | Boss AI → User |
| **3** | Answer Team | Answerer | Q&A Helper | Answer Coding AI questions, source research, provide context | Researcher Team |
| **4** | Verification Team | Validator | Quality checker | Run tests, verify files, visual inspection (60s delay) | Boss AI → Planning Team |
| **5** | Researcher Team | Problem-solver | Documentation scraper | Research ambiguities, web search, solution finding | Answer Team ← Triggers |
| **6** | Critic Team | Reviewer | Improvement specialist | Rate code quality, suggest optimizations, flag patterns | Updater Team |
| **7** | Scraper Team | Verifier | Communication checker | Verify documentation, comments, task alignment post-edit | Boss AI |
| **8** | Updater Agent | Cleanup | Organization specialist | Clean up tasks, reorganize queue, maintain consistency | Planning Team |
| — | Task Decomposition Agent | Sub-planner | (Role merged into Planning Team v2.0) | See Planning TeamAssume Planning Team or Orchestrator | — |
| — | Coding AI (GitHub Copilot) | Executor | Code generator | Execute tasks, ask clarifications | Orchestrator |
| — | Clarity Agent | Classifier | (Sub-role of Answer Team) | Score ticket replies for clarity | Orchestrator |

**Notes**:
- **Total count**: 9 core teams (0-8) + external contributors (Coding AI) + auxiliary roles (Clarity classified as Answer Team sub-role)
- **Task Decomposition Agent** (from 02-Agent-Role-Definitions.md): Consolidated into Planning Team responsibilities in v2.0/07-Complete-Agent-Teams.md
- **Clarity Agent** (mentioned in TICKET-SYSTEM-SPECIFICATION.md): Operates as sub-function of Answer Team for ticket clarity scoring
- **Coding AI**: External LLM (not managed by COE, but orchestrated)

---

## RACI Matrix: Agent Handoffs (MVP)

| # | Handoff Pair | Condition | Responsible | Accountable | Consulted | Informed |
|---|---|---|---|---|---|---|
| **1** | **Planning Team → Decomposition Agent** | Task > 45 min OR multiple concerns | Planning Team (delegates) | Decomposition Agent | Orchestrator | Task Queue |
| **2** | **Decomposition Agent → Planning Team** | Subtasks created and validated | Decomposition Agent (submits) | Planning Team (formalizes) | Boss AI | Task Queue |
| **3** | **Planning Team → Orchestrator** | Tasks ready in queue (no blockers) | Planning Team (enqueues) | Orchestrator (pulls) | Coding AI | Dashboard |
| **4** | **Orchestrator → Coding AI** | Task pulled from queue | Orchestrator (directs) | Coding AI (executes) | Answer Team (on-call) | Dashboard |
| **5** | **Coding AI → Answer Team** | Question asked via `askQuestion` MCP | Coding AI (queries) | Answer Team (responds) | Planning Team | Orchestrator |
| **6** | **Answer Team → User (Orchestrator escalates)** | Answer Team timeout (>30s) OR confidence <40% | Orchestrator (creates ticket) | User (decides) | Clarity Agent | Dashboard |
| **7** | **Coding AI → Verification Team** | Task marked done, files updated | Orchestrator OR Coding AI (reports) | Verification Team (checks) | Planning Team | Dashboard |
| **8** | **Verification Team → Orchestrator** | Tests fail or criteria unmet | Verification Team (reports) | Orchestrator (creates follow-up) | Planning Team | Task Queue |
| **9** | **Verification Team → User** | Visual verification required (UI changes) | Verification Team (creates UI test) | User (confirms) | Clarity Agent | Dashboard |
| **10** | **Clarity Agent → Orchestrator/Planning** | Ticket reply scored (≥85 passed) | Clarity Agent (scores) | Assigned agent (acts) | None | Dashboard |

---

## Role Clarification: Clarity Agent vs Answer Team (No Overlap)

**Question**: Do "Clarity Agent" and "Answer Team" overlap? When are they used?

**Answer**: They serve **different triggers and phases** with NO overlap.

### Quick Distinction Table

| Aspect | Answer Team | Clarity Agent |
|--------|---|---|
| **Trigger** | Coding AI asks question during execution | User/human replies to a ticket |
| **Phase** | During task execution (runtime) | After ticket reply (post-user input) |
| **Input** | Coding AI question (natural language) | Ticket reply content (user response) |
| **Output** | Answer + sources OR escalation | Clarity score (0-100) + pass/fail |
| **Decision** | "Can I answer this? Confidence ≥70%?" | "Is this reply clear/complete? Score ≥85?" |
| **Escalation** | → Researcher OR → User (ticket) | → Ask follow-up (within ticket) |
| **Example Scenario** | Copilot asks "PostgreSQL or MongoDB?" | User replies "Use PostgreSQL because..." → Clarity scores reply |

### Workflow Integration

```
Normal Ticket-Free Execution:
  Coding AI asks question
       ↓
  Answer Team processes
       ├→ Confidence ≥70%? 
       │   YES: Provide answer, resume Copilot
       │   NO: Escalate to Researcher or create ticket
       └→ (If ticket created → User replies → Clarity Agent scores)

When User Replies to Ticket:
  User fills out sidebar reply form
       ↓
  Ticket marked "resolved_awaiting_clarity"
       ↓
  Clarity Agent auto-reviews (5-15s delay)
       ├→ Score ≥85? 
       │   YES: Ticket marked "resolved", resume orchestrator
       │   NO: Ask follow-up inside ticket thread
       └→ User refines, Clarity scores again (loop until 85+)
```

### RACI Split (No Ownership Conflict)

| Responsibility | Answer Team | Clarity Agent | Notes |
|---|---|---|---|
| Answer Coding AI questions | **Responsible** | — | Real-time, confidence-driven |
| Score ticket replies | — | **Responsible** | Post-user input, clarity-driven |
| Escalate to Researcher | **Accountable** | — | If confidence <70% |
| Create user ticket | **Consulted** (decides if needed) | — | Orchestrator executes |
| Ask follow-up in thread | — | **Accountable** | If clarity score <85% |
| Route resolved tickets | — | **Responsible** | Marks ticket resolved once ≥85 |

**Result**: **Zero overlap**. Each agent owns a distinct phase in the workflow.

---

## Decision Trees

### Decision 1: Planning → Decomposition Agent

```
Task estimation from plan:
  ↓
  IF effort ≤ 45 minutes
    AND only 1 logical concern
      → Planning generates task directly
      → Add to queue
  
  ELSE IF effort > 45 minutes
    OR multiple concerns (frontend + backend + DB, etc.)
      → Planning delegates to Decomposition Agent
      → Wait for Decomposition Agent output
      → Ask Decomposition Agent for subtasks
      → Add all subtasks to queue
```

**Example: "Implement login form"**:
- Effort: 35 min (estimated)
- Concerns: 1 (UI component only, backend API already exists)
- Decision: ✅ Planning generates 1 task directly
- Output: TASK-001 added to queue

**Example: "Rebuild authentication system"**:
- Effort: 120 min (estimated)
- Concerns: 4 (DB schema, API endpoints, UI forms, tests)
- Decision: ⏭️ Planning delegates to Decomposition Agent
- Output: 4 subtasks created (each 20-35 min), all added to queue

---

### Decision 2: Orchestrator → Coding AI

```
Before directing Coding AI:
  ↓
  1. Pull task from queue (MUST be from Planning Team)
  2. Check task.estimatedMinutes ≤ 45?
       → YES: Continue
       → NO: Reject, send back to Planning Team ("Too large")
  3. Check task has context bundle (plan, acceptance criteria)?
       → YES: Continue
       → NO: Ask Planning Team for context
  4. Check Coding AI is available?
       → YES: Send directive
       → NO: Wait or escalate to human
  ↓
  Direct Coding AI with:
    - taskId
    - title + description
    - acceptance criteria
    - related files
    - design system / style guide (if UI)
```

**Example Flow**:
```
T=0:   Orchestrator pulls TASK-047: "Create POST /auth/register endpoint"
T=0:   Check: 40 min ≤ 45? YES
T=0:   Check: Context bundled? YES (has schema, error handling guide)
T=0:   Check: Copilot ready? YES
T=0:   Send directive to Coding AI
T=5:   Coding AI asks: "Should password validation use Zod or Joi?"
T=5:   Orchestrator routes question to Answer Team
T=15:  Answer Team responds: "Use Zod (already in package.json)"
T=15:  Coding AI resumes
...
T=25:  Coding AI marks task done
T=25:  Orchestrator reports to Verification Team
```

---

### Decision 3: Coding AI → Answer Team

```
During coding, Coding AI encounters ambiguity:
  ↓
  IF any doubt about:
    - Feature implementation strategy
    - Technology choice
    - Design system interpretation
    - Error handling approach
    - Security decision
    - Test strategy
      ↓
      Confidence < 95%?
        → YES: Call Answer Team immediately via askQuestion
        → NO: Proceed
  ↓
  Answer Team responds within 60 seconds
    ↓
    Answered + confidence ≥ 40%?
      → YES: Coding AI resumes with answer
      → NO: Escalate to user (Orchestrator creates ticket)
```

**Example Questions**:
```
✅ Good (specific): "POST /auth/register should accept email + password. Should password min length be 8 or 12? Plan says 'secure' but doesn't specify."
✅ Good (clear): "Should validation errors return HTTP 400 or 422? Check plan or convention."
✅ Good (context): "Importing UserService - is it safe to use async constructor?"

❌ Bad (vague): "How should I handle errors?"
❌ Bad (scope creep): "Should I refactor the entire auth module?"
```

---

### Decision 4: Verification → Follow-Up Task Creation

```
After Verification Team runs tests:
  ↓
  All tests pass + acceptance criteria met?
    ↓ YES → Mark task VERIFIED/COMPLETE ✓
    ↓ NO → Verification failure flow:
  ↓
  1. Create investigation ticket (type: 'investigation')
  2. Create new task in queue: "Fix: {failed_test}"
  3. Link: new task → original task (parent_task_id)
  4. Mark original task: status = 'in_verification' (blocked)
  5. Orchestrator pulls new "Fix" task next
  6. Coding AI fixes issue
  7. Verification re-checks original task
  8. If passes → original marked COMPLETE
     If fails → repeat (max 3 cycles, then escalate human)
```

**Example**:
```
Original: TASK-050 "Add password hashing"
↓ Verification runs tests
↓ TEST FAILS: "bcryptCompare not exported from module"
↓ Creates:
  - Ticket TK-0501: "Investigation: bcryptCompare not exported"
  - Task: "Fix: bcryptCompare export" (parent: TASK-050)
↓ Orchestrator assigns fix to Copilot
↓ Copilot adds: `export { bcryptCompare }`
↓ Verification re-checks TASK-050
↓ TEST PASSES ✓
↓ TASK-050 marked COMPLETE
```

---

### Decision 6: Optional Feature Triage (NEW - Interaction Model)

```
Situation: Feature marked "mandatory: unknown" or confidence low in plan.json

Is it clear why the feature is optional or mandatory?
  ↓
  Confidence ≥ 70% (HIGH)
  └─ AI decides: Mark as optional/mandatory in schema
     → Reviewer updates feature.mandatory + optional_note
     → Task created with marker for Builder to respect
  
  Confidence 40-70% (MEDIUM)
  └─ Reviewer asks clarifying Q in GUI chat:
     1. "Is {Feature X} required for MVP or post-launch?"
     2. "If post-MVP: Track as Phase 2 follow-up task?"
     3. "Dependencies blocking optionality?"
  → User answers → Feature re-classified
  
  Confidence < 40% (LOW)
  └─ Escalate to User via @ask ticket:
     "Feature '{Feature}' unclear—is it MVP or optional? Missing info: {details}"
  → User provides clarity → Feature finalized
```

**Example Journey**:
- Plan has feature: "Analytics Dashboard" (mandatory: unknown)
- Reviewer sees goal: "Simple puppy adoption app"
- Confidence: 30% (unclear if analytics is core or nice-to-have)
- Action: Ask user via DT6 → User answers "Post-launch, nice-to-have"
- Result: Feature marked mandatory=false, optional_note="Analytics deferred to Phase 2"

---

### Decision 7: Backend Fallback Logic (NEW - Interaction Model)

```
Situation: Builder agent needs backend code; primary framework in plan.json:designChoices.backend_framework

Is primary framework available in codebase or environment?
  ↓
  Check: scanCodeBase(primary_framework)
  
  YES (framework found in dependencies/imports)
  └─ Use primary → proceed with code generation
     Example: backend_framework="Express" found in package.json
  
  NO (framework not available)
  └─ Check: backend_fallback in designChoices
     ├─ Is fallback specified?
     │  ├─ YES: Suggest secondary (e.g., "Express unavailable; use Fastify?")
     │  │       Create clarification ticket if user approval needed
     │  └─ NO: Offer options to user:
     │         - "Install primary framework?"
     │         - "Choose secondary from [FastAPI, Django, etc.]?"
     │         - "Skip backend for this cycle (plan-only)?"
     └─ Continue based on user choice
  
  UNKNOWN (scanCodeBase timed out or inconclusive)
  └─ Ask Builder (via Orchestrator): "Should we inject {primary}?"
     → Builder suggests best approach
```

**Example Fallback Flow**:
- Plan: backend_framework="Express", backend_fallback="Fastify"
- Codebase: Express not found, Fastify is available
- Reviewer/Builder routes: "Primary unavailable; use Fastify scaffold? (Fallback available)"
- Output: Code stubs for Fastify with comment: "# Fallback: Primary Express not found; using Fastify"

---

### Decision 5: Clarity Agent → Task Unblocking

```
After user replies to ticket:
  ↓
  Clarity Agent scores reply (0-100):
    ↓
    If score ≥ 85 (clear + complete + accurate)?
      → Ticket marked RESOLVED
      → Original task status updates (if linked): 'blocked' → 'ready'
      → Orchestrator can pull task again
      → Coding AI resumes
    
    If score < 85?
      → Auto-reply in thread: "Not fully clear. Please clarify {points}"
      → Wait for next user reply
      → If > 5 iterations: Escalate to Boss AI ("User not responding")
```

**Scoring Rubric**:
```
| Dimension | Score | Meaning |
|-----------|-------|---------|
| Clarity | 0-100 | Is it unambiguous? No jargon? |
| Completeness | 0-100 | Does it answer all parts of original Q? |
| Accuracy | 0-100 | Does it align with plan / codebase? |
| **Total** | (C+Co+A)/3 | **Result used for gate** |

Example:
- Clarity: 95 (very clear)
- Completeness: 90 (answers main Q, misses edge case)
- Accuracy: 80 (aligns with plan, but one assumption made)
- Total: (95+90+80)/3 = 88.3 → ✅ PASS (≥85)
```

---

## Cross-Agent Communication Patterns

### Pattern: Question Escalation

```
Agent A                                 Agent B (receiver)
  ↓ (calls MCP askQuestion)
  ├─question: "Should use X or Y?"
  ├─context: {taskId, files, plan}
  ├─confidence: 30%                      ← Very uncertain
  └─priority: high
                                        ↓ (Agent B receives)
                                        ├─Search plan
                                        ├─Search codebase
                                        ├─Calculate confidence: 70%
                                        └─Is 70% ≥ 40% minimum? YES
                                        ↓ (can respond)
                                        └─Return answer + evidence
                                        
                                        [OR if confidence < 40%]
                                        ├─Search found nothing definitive
                                        ├─Calculate confidence: 25%
                                        └─Is 25% ≥ 40% minimum? NO
                                        ↓ (escalate to user)
              (Orchestrator intercepts)
              ├─Creates ticket TK-xxx
              ├─Type: ai_to_human
              ├─Assigns to user
              └─Awaits response
```

### Pattern: Task Chain (Decomposition → Queue → Coding → Verify)

```
Planning Team                           Decomposition Agent
  │ (estimated > 45 min)
  └─→ Request decomposition
        │
        ├─Analyze requirements
        ├─Identify boundaries
        ├─Create 3 subtasks (each 20-30 min)
        └─Validate DAG (no circular deps)
             │
             └─→ Return subtasks to Planning
                  │
                  └─Formalize in queue
                      │
Orchestrator            ├─Pulls TASK-001
  │                     ├─→ Sends to Coding AI
  B                     │
  │  (reports done)
  └─→ Verification Team
       │ (60s delay for stability)
       ├─Run tests
       ├─Check acceptance criteria
       ├─Mark verified or create follow-up
       └─→ Dashboard (show progress)
```

---

## Enforcement Mechanisms

### Mechanism 1: Task Size Gate
- **Orchestrator**: Rejects any task > 45 min before sending to Coding AI
- **Trigger**: Check `task.estimatedMinutes > 45`
- **Action**: Return error "Task too large. Needs decomposition first."
- **Impact**: Prevents Coding AI from receiving oversized tasks

### Mechanism 2: Confidence Threshold (Answer Team)
- **Orchestrator**: If Answer Team response has confidence < 40%, treats as "no answer"
- **Trigger**: Check `answerResponse.confidence < 0.4`
- **Action**: Create user ticket instead of returning uncertain answer
- **Impact**: Prevents hallucinations from reaching Coding AI

### Mechanism 3: Clarity Gate (Ticket Resolution)
- **Clarity Agent**: Only marks ticket RESOLVED if score ≥ 85
- **Trigger**: Check `clarityScore ≥ 85`
- **Action**: Allow task to progress OR auto-reply for clarification
- **Impact**: Ensures user input is truly clear before Coding AI resumes

### Mechanism 4: Stability Delay (Verification)
- **Verification Team**: Waits 60 seconds after file changes before testing
- **Trigger**: File watcher detects changes
- **Action**: Set timer for 60s, then run verification
- **Impact**: Prevents false test failures from in-flight file updates

### Mechanism 5: Project-Type Routing Rules (NEW - Interaction Model)
**Orchestrator**: Routes planning/decomposition based on `plan.json:projectType` enum

This table defines default decomposition scope, verification focus, and tech stacks per project type:

| Project Type | Decomposition Focus | Default Stack | Verification Focus | Orchestrator Route |
|---|---|---|---|---|
| **web_app** | API endpoints, UI pages, state flow, database schema | Node.js/Express + React/Vue, PostgreSQL | E2E tests, API contracts, auth security | → Full backend path (triggers Builder if backend_mode=true) |
| **browser_extension** | Manifest v3, content scripts, background workers, permissions | Chrome/Firefox APIs + vanilla JS, manifest.json | Permission safety, cross-origin rules, popup UX | → Minimal backend (optional manifest-based API only) |
| **local_program** | CLI entry points, file I/O, system integration, display layer | Node.js/Python + CLI framework (Inquirer/Click), OS-dependent | Exit codes, file output, stdout/stderr correctness | → Binary/script path, packaging + distribution |
| **library** | Module exports, public API surface, doctests | Framework-agnostic (language-specific), npm/PyPI | API surface tests, backwards compatibility | → No execution target; pure code artifact |
| **custom** | User-defined (infer from goal + notes) | Infer from goal | Infer from description | → Flexible; ask user for clarification |

**Implementation**: When Orchestrator receives `plan.json`, it reads `projectType` → loads corresponding row → applies defaults to task decomposition and Reviewer/Builder context.

---

## Beginner Quick Reference

**"I have a task. What happens?"**:
1. Planning Team estimates effort
2. **If ≤45 min?** → Planning creates task directly
   **If >45 min?** → Decomposition Agent breaks it into smaller tasks
3. All tasks added to queue
4. Orchestrator pulls next task (P1 first)
5. Orchestrator sends to Coding AI
6. **Coding AI has question?** → Answer Team responds
   **Answer Team times out?** → User ticket created
7. Coding AI completes task, reports done
8. Verification waits 60s for file stability, runs tests
9. **All tests pass?** → Task marked COMPLETE ✓
   **Tests fail?** → Investigation task created, cycle repeats
10. Dashboard updates with progress

---

## Decision Matrix for Dev Team

| Scenario | Who Decides? | How? | Result |
|----------|---|---|---|
| "Is this task > 45 min?" | Planning Team | Estimate from plan context | Decompose or enqueue directly |
| "Is this answer confident enough?" | Answer Team | Search plan + code, calculate score | Return answer or escalate |
| "Was the user's reply clear?" | Clarity Agent | Run clarity LM scoring | Resolve ticket or ask follow-up |
| "Did the code meet acceptance criteria?" | Verification Team | Run tests + check plan | Mark complete or create fix task |
| "Should Copilot work on this next?" | Orchestrator | Check task size + dependencies | Assign or wait/reject |

---

## Links to Full Definitions

- **Planning Team**: [02-Agent-Role-Definitions.md › Agent 2](02-Agent-Role-Definitions.md#agent-2-planning-team-independent-upstream-planner)
- **Orchestrator**: [02-Agent-Role-Definitions.md › Agent 1](02-Agent-Role-Definitions.md#agent-1-programming-orchestrator-dedicated-coding-director)
- **Coding AI**: [02-Agent-Role-Definitions.md › Agent 1a](02-Agent-Role-Definitions.md#agent-1a-coding-ai-github-copilot--llm-coding-assistant)
- **Answer Team**: [02-Agent-Role-Definitions.md › Agent 3](02-Agent-Role-Definitions.md#agent-3-answer-team-context-aware-qa-helper)
- **Decomposition Agent**: [02-Agent-Role-Definitions.md › Agent 4](02-Agent-Role-Definitions.md#agent-4-task-decomposition-agent)
- **Verification Team**: [02-Agent-Role-Definitions.md › Agent 5](02-Agent-Role-Definitions.md#agent-5-verification-team-independent-post-execution-checker)
- **Clarity Agent**: [TICKET-SYSTEM-SPECIFICATION.md › Clarity Agent](TICKET-SYSTEM-SPECIFICATION.md#clarity-agent-high-priority-sub-agent)
- **Task Size Standard**: [MODULAR-EXECUTION-PHILOSOPHY.md › MVP Task Size Standard](MODULAR-EXECUTION-PHILOSOPHY.md#3-time-box)

