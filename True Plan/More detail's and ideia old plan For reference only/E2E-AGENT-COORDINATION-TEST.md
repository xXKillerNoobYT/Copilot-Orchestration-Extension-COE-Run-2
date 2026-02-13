# E2E Agent Coordination Test Scenario

**Version**: 1.0  
**Date**: February 1, 2026  
**Status**: Test Specification for MVP  
**Related Docs**: [02-Agent-Role-Definitions.md](02-Agent-Role-Definitions.md), [TICKET-SYSTEM-SPECIFICATION.md](TICKET-SYSTEM-SPECIFICATION.md), [04-Data-Flow-State-Management.md](04-Data-Flow-State-Management.md)

---

## Overview

This document describes an end-to-end test scenario that validates **agent coordination flow** across Planning Team → Orchestrator → Coding AI → Answer Team → Verification Team → Dashboard.

**Scope**: MVP only (6 agents, minimal dependencies)

---

## Test Scenario: "Add User Login Form"

### Setup

**Initial State**:
- GitHub issue created: "Add secure login form with email + password"
- Priority: P1 (critical feature)
- Acceptance Criteria:
  - Form validates email format
  - Password field masked during input
  - POST /auth/login endpoint returns JWT token
  - All inputs sanitized against XSS

**Expected Outcome**: Issue → 3 atomic tasks → Copilot codes → Tests pass → Task complete

---

## Step-by-Step Flow with Assertions

### Step 1: GitHub Issue → Planning Team

**Input**: GitHub issue synced to local state  
**Agent**: Planning Team

**Flow**:
```
Issue detected: "Add user login form"
↓
Planning Team estimates effort: 100 minutes > 45 min 
↓ DECISION GATE
Too large for atomic task → Delegate to Decomposition Agent
```

**Assertion 1: Decomposition Triggered**
```
ASSERT: task.estimatedMinutes > 45
ASSERT: Planning Team does NOT directly enqueue task
ASSERT: Planning Team calls Decomposition Agent
```

---

### Step 2: Decomposition Agent → Task Queue

**Agent**: Task Decomposition Agent (breaks large task)

**Output**: 3 atomic tasks
```
Task 1: "Add login form UI component" (30 min)
  - Create Vue/React component with email + password inputs
  - AC: Component renders without errors
  
Task 2: "Implement POST /auth/login endpoint" (40 min)
  - Create API route, validate credentials, return JWT
  - AC: HTTP 200 with token on valid credentials
  
Task 3: "Add unit tests for login flow" (20 min)
  - Test input validation, error cases, XSS protection
  - AC: All tests pass
```

**Assertion 2: Task Decomposition**
```
ASSERT: All 3 tasks enqueued to task queue
ASSERT: Each task.estimatedMinutes <= 45
ASSERT: Tasks have dependencies (Task 1 → Task 2 → Task 3 is ideal, or parallel if no dependencies)
ASSERT: Each task has acceptance criteria from plan
```

---

### Step 3: Orchestrator → Coding AI (Task 1)

**Agent**: Programming Orchestrator → Coding AI (GitHub Copilot)

**Input**: Task 1 pulled from queue, directive sent

**Flow**:
```
Orchestrator pulls Task 1: "Add login form UI"
↓
Check: 30 min <= 45? YES ✓
Check: Context bundled? YES ✓ (plan, AC, design tokens)
↓
Directive sent to Copilot: "Create login form component..."
↓
Copilot generates JSX/Vue template
↓
Copilot has question: "Should password field use CSS masking or input type=password?"
```

**Assertion 3: Orchestrator Routing**
```
ASSERT: Orchestrator pulls Task 1 (highest ready task)
ASSERT: Copilot receives directive with full context
ASSERT: Copilot can ask clarification via askQuestion MCP
```

---

### Step 4: Coding AI → Answer Team (Ask Clarification)

**Agent**: Answer Team (Copilot invokes via MCP)

**Input**: Question about password field implementation

**Flow**:
```
Copilot calls MCP askQuestion:
{
  "question": "Should password field use type='password' or CSS::first-letter hide?",
  "context": {
    "taskId": "TASK-001",
    "relatedFiles": ["design-system.json", "security-guidelines.md"],
    "priority": "high"
  },
  "confidence": 30
}

↓
Answer Team processes:
  - Search plan: "password field masked during input"
  - Search code: Existing usage shows type="password"
  - Calculate confidence: 95%
  
↓ ANSWER
"Use type='password' (browser-native masking, better UX + security than CSS tricks)"
```

**Assertion 4: Answer Team**
```
ASSERT: Answer Team confidence >= 40% (can answer confidently)
ASSERT: Answer Team returns answer with evidence from plan/codebase
ASSERT: Confidence >= 40 → return to Copilot (not escalate to user)
```

---

### Step 5: Coding AI Resumes → Completes Task 1

**Agent**: Copilot resumes

**Flow**:
```
Copilot receives Answer Team response: "Use type='password'"
↓
Copilot implements login form with type="password"
↓
Copilot marks task complete
↓
Orchestrator reports to task queue: Task 1 = DONE
↓ Event emitted
Verification Team alerted
Dashboard updated
```

**Assertion 5: Task Completion**
```
ASSERT: Copilot reports task complete via MCP reportTaskStatus
ASSERT: Task 1 status: in_progress → done
ASSERT: Verification Team triggered automatically (file watcher or MCP event)
```

---

### Step 6: Verification Team (60s Delay → Test)

**Agent**: Verification Team

**Flow**:
```
File change detected: src/components/LoginForm.vue modified
↓
Start 60-second stability timer (wait for in-flight edits to settle)
↓ 60 seconds pass
File stable ✓
↓
Run tests: "LoginForm component renders, inputs functional"
↓
All tests PASS ✓
↓
Check acceptance criteria:
  ✓ Component renders without errors
  ✓ Email + password inputs present
  
↓
Task 1 marked VERIFIED/COMPLETE
```

**Assertion 6: Verification**
```
ASSERT: Verification waits 60 seconds before testing (stability delay)
ASSERT: Tests run for Task 1 acceptance criteria
ASSERT: All tests pass
ASSERT: Task 1 moves to completed queue
```

---

### Step 7: Orchestrator → Task 2

**Agent**: Orchestrator

**Flow**:
```
Orchestrator pulls next ready task: Task 2 (API endpoint)
↓
Copilot directs: "Create POST /auth/login endpoint..."
↓
Copilot asks: "Should we use JWT or session-based auth?"
```

**Assertion 7: Task 2 Ready**
```
ASSERT: Task 1 complete unblocks Task 2 (if dependency)
ASSERT: Orchestrator pulls Task 2 next
ASSERT: Flow repeats (Copilot → Answer → Verify)
```

---

### Step 8: Full E2E Completion

**Final State**:
```
All 3 tasks completed:
  ✓ Task 1: Login form UI (VERIFIED)
  ✓ Task 2: API endpoint (VERIFIED)
  ✓ Task 3: Tests (VERIFIED)

Dashboard shows:
  - Issue: "Add login form" → DONE
  - 3 completed tasks
  - 0 remaining

Plan updated:
  - Feature status: IMPLEMENTED
  - Verification status: PASSED
```

**Final Assertions**:
```
ASSERT: All 3 tasks completed and verified
ASSERT: GitHub issue can be closed (all AC met)
ASSERT: Dashboard shows 100% feature complete
ASSERT: No blockers or escalations (clean run)
```

---

## Error Cases (Alternate Paths)

### Case A: Answer Team Timeout

**Scenario**: Copilot asks question, Answer Team times out (>30s, or confidence <40%)

**Flow**:
```
Copilot: "Should we use bcrypt or argon2 for password hashing?"
↓
Answer Team searches 30s, confidence only 30%
↓
TIMEOUT! Cannot answer confidently
↓
Orchestrator creates ticket TK-xxxx:
  Type: ai_to_human
  Title: "Should we use bcrypt or argon2?"
  Assignee: user
↓
User notified: "Task blocked, needs your input"
↓
User replies: "Use bcrypt (it's in package.json already)"
↓
Clarity Agent scores reply: 95/100 ✓
↓
Ticket resolved
↓
Task unblocked, Copilot resumes
```

**Assertion A**:
```
ASSERT: Answer Team timeout triggers ticket creation
ASSERT: User ticket created with correct data
ASSERT: Clarity Agent scores user reply
ASSERT: If score >= 85, task unblocks
ASSERT: Copilot resumes with resolved answer
```

### Case B: Verification Test Fails

**Scenario**: Verification detects failing test

**Flow**:
```
Verification runs tests for Task 2: "POST /auth/login"
↓
Test FAILS: "password field should be masked"
↓
Verification creates:
  - Ticket TK-yyyy: "Investigation: Password masking failed"
  - New Task: "Fix: Password masking"
↓
Task 2 marked "in_investigation" (blocked)
↓
Orchestrator assigns new "Fix" task to Copilot
↓
Copilot fixes: Adds CSS { visibility: hidden; } to password input
↓
Verification re-checks Task 2
↓
Test passes ✓
↓
Task 2 marked VERIFIED (original task now complete)
```

**Assertion B**:
```
ASSERT: Failed test triggers investigation task creation
ASSERT: New task linked to original (parent_task_id)
ASSERT: Original task blocked until fix task completes
ASSERT: Orchestrator assigns fix task next
ASSERT: Upon fix verification, original task unblocks
```

---

## Test Pseudocode

```typescript
async function testE2EAgentCoordination() {
  console.log("🚀 Starting E2E test: Add Login Form\n");
  
  // ===== SETUP =====
  const issue = createGitHubIssue("Add secure login form...");
  const plan = loadPlan("Docs/Plans/app.json");
  
  // ===== STEP 1-2: Planning Decomposition =====
  console.log("📋 Planning Team processing...");
  let tasks = await planningTeam.decomposeIssue(issue);
  expect(tasks.length).toBe(3);
  expect(tasks.every(t => t.estimatedMinutes <= 45)).toBe(true);
  console.log("✓ Decomposed into 3 atomic tasks\n");
  
  // ===== STEP 3-5: Orchestrator → Copilot → Task 1 =====
  console.log("🔄 Orchestrator directing Copilot...");
  const task1 = tasks[0];
  const copilotResult1 = await orchestrator.directCodingAI(task1);
  
  // Simulate Copilot asking question
  const question = "Should password field use type='password'?";
  const answerResponse = await answerTeam.askQuestion(question, task1);
  expect(answerResponse.confidence).toBeGreaterThanOrEqual(40);
  expect(answerResponse.answer).toContain("type='password'");
  
  // Copilot resumes and completes
  await orchestrator.reportTaskStatus(task1.id, "done");
  console.log("✓ Task 1 completed\n");
  
  // ===== STEP 6: Verification Team =====
  console.log("✅ Verification Team checking...");
  await delay(61 * 1000);  // Wait 61 seconds for stability
  const verifyResult1 = await verificationTeam.verify(task1);
  expect(verifyResult1.passed).toBe(true);
  expect(verifyResult1.criteriaMatched).toBe(true);
  console.log("✓ Task 1 verified\n");
  
  // ===== STEP 7-8: Repeat for Tasks 2 & 3 =====
  for (let i = 1; i < 3; i++) {
    console.log(`📋 Processing Task ${i + 1}...`);
    const task = tasks[i];
    
    // Similar flow (Copilot → Answer → Verify)
    await orchestrator.directCodingAI(task);
    await delay(61 * 1000);
    const verifyResult = await verificationTeam.verify(task);
    expect(verifyResult.passed).toBe(true);
    console.log(`✓ Task ${i + 1} verified\n`);
  }
  
  // ===== FINAL STATE =====
  console.log("🎉 E2E test PASSED!");
  console.log("Summary:");
  console.log("  ✓ Issue decomposed to 3 tasks");
  console.log("  ✓ All tasks completed by Copilot");
  console.log("  ✓ Answer Team provided clarification");
  console.log("  ✓ Verification passed all criteria");
  console.log("  ✓ Dashboard shows 100% complete");
}
```

---

## Acceptance Criteria (MVP Gate)

- [ ] All 7 assertions pass (Steps 1-7)
- [ ] No manual intervention required (full automation)
- [ ] Tickets created only when necessary (Answer timeout)
- [ ] Tasks complete in atomic fashion (15-45 min each)
- [ ] Verification waits 60 seconds before testing
- [ ] Error cases (A-B) handled gracefully
- [ ] Dashboard updates in real-time with progress
- [ ] Full test runtime: <5 minutes for all 3 tasks

---

## Test Execution

**Run**: `npm run test:e2e:agent-coordination`  
**Timeout**: 10 minutes (provides buffer)  
**Env**: Use mock Copilot (simulator) + real Verification components  
**Logging**: Full trace of all MCP calls + agent state changes
