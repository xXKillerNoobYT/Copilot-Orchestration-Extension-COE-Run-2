# Program Building & Updating Evolution

**Version**: 5.2  
**Date**: January 21, 2026  
**Status**: Complete Lifecycle Model  

## Overview

This document establishes the **complete lifecycle model** for **program building and continuous updating/evolution** inside the COE / Code Master extension. It describes exactly how a brand-new program is born from a plan, how it is incrementally built using the modular "one thing at a time" rule, how updates and improvements are continuously applied, and how the entire system (plan + code + agents + Copilot configuration) evolves together over time without ever breaking.

The model is designed to be **self-healing**, **priority-respecting**, **token-safe**, and **human-controllable** at every critical point.

---

## 1. Overall Lifecycle Model – "Birth → Growth → Evolution → Refinement"

The program goes through four overlapping phases:

| Phase          | Duration in Project Life | Primary Driver              | Key Constraint                  | Exit Condition                              |
|----------------|---------------------------|-----------------------------|----------------------------------|---------------------------------------------|
| Birth          | First 1–4 weeks           | Planning → Initial Build    | Strict atomicity, P1 first      | Core P1 functionality working & verified   |
| Growth         | Weeks 2–12+               | Modular Task Execution      | One-task-at-a-time lock         | All P1 & most P2 features complete          |
| Evolution      | Ongoing from week 3       | Error patterns + Critic     | Safe YAML-only updates          | System adapts to new patterns automatically |
| Refinement     | Ongoing from week 6+      | Human feedback + RL reward  | Minimal disruption rule         | Quality & velocity continuously improve     |

---

## 2. Birth Phase – From Plan to First Working Increment

### Goal
Turn the finalized plan into the smallest possible working program that delivers P1 value.

### Flow (detailed)

#### 1. Plan Finalized (v4.8 Human + AI + Backend Plan Builder)
- Plan version 1.0 created
- All tasks atomic, prioritized, dependency-linked

#### 2. TO_DO Queue Initialization
- All P1 tasks enqueued first
- P2/P3 blocked until P1 deps complete
- Boss enforces: **only one P1 task active at any time**

#### 3. Single-Task Execution Loop (repeats until P1 complete)

**a. Orchestrator selects next ready P1 task**

**b. Generates scoped Copilot Workspace session**
- Creates temporary `.github/copilot-instructions.md` with:
  - Task description (single concern only)
  - Priority tag
  - Relevant plan excerpts (<1,500 tokens)
  - MCP tool call syntax

**c. Coding AI (Copilot) works only on that task**

**d. On ambiguity → calls MCP `askQuestion` (immediate or queued)**

**e. On completion → calls MCP `reportTaskCompleted`**

**f. Verification Team runs atomic check**
- If pass → commit, unlock dependents  
- If fail → `reportIssue` → loop back to Coding AI (same task)

**g. Sidebar updates: "Task X complete – Y% of P1 done"**

#### 4. P1 Completion Gate
- All P1 tasks verified  
- Coverage ≥85% on P1 code  
- No open P1 issues  
- User optional sign-off modal: "P1 complete – continue to P2?"

### Exit Artifact
Minimum viable program (P1 features working) + versioned plan 1.1

---

## 3. Growth Phase – Building Out P2 & P3

### Goal
Incrementally add remaining functionality while keeping the program always in a working state.

### Key Rules Enforced

- P1 must stay green (re-verified on every commit)  
- No task may touch more than one logical concern  
- No parallel work on interdependent tasks  
- Every commit must pass atomic verification

### Execution Flow (daily/continuous)

#### 1. Queue Management (Boss + TO_DO AI)
- Re-evaluate queue every 5–15 min or on completion
- Next task = earliest unblocked P1 → P2 → P3

#### 2. Task Hand-off to Copilot
- Fresh Workspace session per task
- Instruction file scoped to **exactly one task**
- Context bundle limited to <3,000 tokens (broken if needed)

#### 3. Continuous Feedback Loop
- Coding → Verification → Report → Next
- If stuck >30 min → MCP `reportIssue` → Researcher triggered
- Sidebar shows live progress:  
  ```
  Current: T-45 (POST /tasks) – 65%  
  Blocked: 7 tasks waiting on auth
  ```

#### 4. Checkpoint & Release
- Every 5–10 completed tasks → auto checkpoint commit  
- Every P-level complete → tagged release (e.g., v0.1-P1)

---

## 4. Evolution Phase – Continuous Self-Improvement

### Goal
Let the system learn from its own execution and get better at building/updating the program over time.

### Sources of Evolution Signals

| Signal Type               | Source                              | Frequency | Triggers Evolution On                     |
|---------------------------|-------------------------------------|-----------|--------------------------------------------|
| Error Pattern             | MCP error logs + Critic             | Daily     | ≥3 same code in 24h                        |
| Task Failure Rate         | Verification failures               | Per task  | ≥30% fail rate on same concern             |
| Token Pressure            | Context breaking frequency          | Continuous| ≥4 breaks per hour                         |
| Plan Drift                | File Tree vs Plan comparison        | On change | Drift score >0.2                           |
| User Feedback             | Post-update / post-task polls       | Per major update | "Not helpful" ≥2/5                         |
| RL Reward Signal          | Breaking, updating, task outcomes   | Per cycle | Low/negative reward streak                 |

### Evolution Execution Flow

#### 1. Signal Collection
- All signals logged with metadata (task_id, priority, agent, timestamp)

#### 2. Pattern Aggregation (Critic daily job)
- Group by signature (code + tool + context)
- Score = (count × severity_weight × priority_impact_weight) / time_decay

#### 3. Proposal Generation (if score > threshold)
- LM prompt:  
  ```
  Pattern: {signature} occurred {count} times.
  Impact: {priority_impact_count} P1/P2 tasks affected.
  Average severity: {avg_severity}.
  Suggest minimal YAML-only update to {agent/template/tool}.
  Keep change <200 tokens impact.
  ```
- Output: UV task JSON

#### 4. UV Task Execution (Boss)
- Verify need → simulate → human gate (if P1) → apply via Updating Tool
- Post-apply: re-run affected test cycle → measure delta

#### 5. Reward & Learning
- Positive: Pattern count drops >50% after update
- Negative: Pattern persists or new patterns appear
- Dataset → periodic 14B RLHF fine-tuning

### Example Evolution in Practice

**Pattern**: 12× `TOKEN_LIMIT_EXCEEDED` on `askQuestion` in P1 tasks  
→ Critic proposes: "Increase askQuestion context allowance from 800→1200 tokens"  
→ UV task created → user approves → Updating Tool edits template  
→ Next 48h: only 2 occurrences → strong positive reward

---

## 5. Refinement Phase – Continuous Quality Improvement

### Goal
Use human feedback and RL signals to continuously improve system behavior, task quality, and user experience.

### Key Activities

#### 1. User Feedback Collection
- Post-task polls: "Was this helpful?" (Yes/No/Details)
- Post-update surveys: Quality, speed, clarity ratings
- Sidebar quick feedback buttons

#### 2. RL Reward Tuning
- Adjust reward weights based on outcomes
- Feed successful patterns to fine-tuning pipeline
- Penalize behaviors that cause rollbacks

#### 3. Template Evolution
- Successful agent behaviors → promote to templates
- Failed patterns → add to checklist items
- Context breaking strategies → optimize based on coherence scores

#### 4. Performance Optimization
- Token usage optimization (reduce unnecessary context)
- LM call batching for efficiency
- Cache hit rate improvement

### Refinement Metrics

- Error recurrence rate: Target <5%
- Average task completion time: Target reduction of 15% quarterly
- User satisfaction: Target ≥4.5/5
- RL reward trend: Target positive slope

---

## User Visibility & Control Points

### Sidebar – Evolution Dashboard (new collapsible section)

**Active Patterns** (top 3 highest score)
- Example: "TOKEN_LIMIT_EXCEEDED on askQuestion – 12× in 24h"
- Impact badge: P1 Blocked ×3
- "View Proposal" button → shows draft UV task
- "Approve / Ignore / Details" actions

**Recent Evolutions** (last 5 updates)
- "Verification template v1.5 – added eslint check (from pattern)"
- "Outcome: Linting misses dropped 78%"

**Manual Evolution** button
- User can force UV task creation with custom change

---

## Roadmap Integration – Where Evolution Fits

| Phase | When Evolution Becomes Active | Key Deliverables Related to Evolution |
|-------|--------------------------------|----------------------------------------|
| Phase 2 | First P1 tasks running         | Basic error logging + pattern detection stub |
| Phase 3 | MCP tools live                 | Full error code handling + Critic pattern scanner |
| Phase 4 | Plan updating live             | UV task generation from patterns       |
| Phase 5 | RL pipeline                    | Reward signal collection + first fine-tune batch |
| Phase 6 | Beta                           | Real user-triggered evolutions + feedback |

**Total Effort Estimate for Evolution System**: 35–50 developer-days spread across Phases 2–5.

---

## Success Criteria

### Birth Phase
- P1 features working and verified
- All P1 tasks atomic and traceable
- Time to first working version: <4 weeks

### Growth Phase
- All P1/P2 features complete
- Zero P1 regressions
- Task completion velocity steady or improving

### Evolution Phase
- Error recurrence <5%
- Critic generates ≥1 valid UV task per week
- System self-improves without manual intervention

### Refinement Phase
- User satisfaction ≥4.5/5
- Task time reduction ≥15% quarterly
- RL reward trend positive

---

## Integration Points

- **Planning Wizard** (v4.4-4.8): Generates initial atomic plan
- **Priority System** (v2.9): Drives execution order
- **Modular Execution** (v4.9): One-task-at-a-time enforcement
- **Plan Updating** (v5.0): Handles plan evolution
- **UV Tasks** (v3.0): Validates all changes
- **RL System** (v3.6): Learns from outcomes
- **Critic Patterns** (v4.2): Detects improvement opportunities

---

## References

- v5.2: Program Building & Updating Evolution
- v4.9: Modular Execution Philosophy
- v5.0: Plan Updating Process
- v4.2: Critic Pattern Detection
- v3.0: UV Task System
- v3.6: RL Reward System
