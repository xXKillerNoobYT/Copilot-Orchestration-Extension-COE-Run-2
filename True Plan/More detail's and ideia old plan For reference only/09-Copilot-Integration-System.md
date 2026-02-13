# GitHub Copilot Integration System
**Version**: 3.9  
**Date**: January 20, 2026  
**Source**: AI Teams Documentation v3.7-3.9  
**Status**: Complete Specification for Copilot Integration

---

## Overview

Comprehensive system for integrating GitHub Copilot with COE's multi-agent orchestration. Includes instructions/skills/agents management, Workspace integration, delegation mechanisms, token brakes, and reporting tools.

---

## Building & Updating Copilot Instructions, Skills, & Agents

### System Components

#### 1. Instructions (.github/copilot-instructions.md)
**Purpose**: Repo-wide guidelines for coding norms, styles, workflows

**Management**:
- **Building**: LM-generated from PRD + plan (Boss initiates)
- **Updating**: Critic proposes changes via UV tasks
- **Validation**: Schema check + test run with sample prompts

**LM Prompt Template**:
```
"Generate GitHub Copilot instructions for {repo_name}. Include: coding standards from {prd_section}, common pitfalls from {error_patterns}, and workflows from {plan_workflows}. Target: {token_limit} tokens. Align to priorities {p1_modules}."

Props:
- repo_name: string
- prd_section: string
- error_patterns: array
- plan_workflows: array
- token_limit: integer (3000-5000)
- p1_modules: array
```

#### 2. Skills (.github/skills/{skill-name}/)
**Purpose**: Modular folders with SKILL.md for specialized tasks

**Structure**:
```
.github/skills/
  ├── linting-skill/
  │   ├── SKILL.md (instructions + frontmatter)
  │   ├── eslint-fix.sh (optional script)
  │   └── resources/ (optional)
  ├── testing-skill/
  │   ├── SKILL.md
  │   └── jest-runner.ts
  └── ...
```

**SKILL.md Format**:
```markdown
---
name: Linting Skill
description: Auto-fix linting errors with ESLint
tags: [quality, linting, p1]
---

## Instructions
Run ESLint with --fix flag on modified files. Check for:
- P1 files: Max warnings = 0
- P2/P3 files: Max warnings = 5

## Usage
/agent @lint-agent fix {file_path}

## Scripts
- eslint-fix.sh: Automated fixing
```

**Building Process**:
1. User/Plan triggers (e.g., sidebar button "Build Linting Skill")
2. Boss initiates AutoGen chat with LM
3. LM generates SKILL.md + optional scripts
4. UV task validates compatibility
5. Push to repo → Copilot auto-loads

**LM Prompt Template**:
```
"Generate GitHub Copilot Agent Skill for {skill_name}. Include SKILL.md with frontmatter (name, description, instructions), optional scripts {script_needs}, and resources. Align to PRD {prd_section} and priorities {p1_modules}. Max {token_limit} tokens."

Props:
- skill_name: string
- script_needs: array (e.g., ["eslint-fix.sh"])
- prd_section: string
- p1_modules: array
- token_limit: integer (2000)
```

#### 3. Agents (agents.md or AGENTS.md)
**Purpose**: Personas combining instructions/skills for workflows

**Format**:
```markdown
# @test-agent
Role: Automated testing specialist
Skills: testing-skill, coverage-skill
Instructions: Run all test suites, report failures, suggest fixes

# @docs-agent
Role: Documentation generator
Skills: markdown-skill, diagram-skill
Instructions: Generate/update docs from code comments and PRD
```

**Updating Process**:
1. Critic detects need (e.g., "Test agent missing linting")
2. AutoGen chat: Propose adding linting-skill
3. LM updates agents.md
4. UV task validates
5. Version bump (e.g., v1.1 → v1.2)

**LM Prompt Template**:
```
"Update agents.md for {agent_name} persona. Revise instructions based on {change_reason}, incorporating new skills {new_skills}. Keep within {context_limit} tokens. Version to {new_version}."

Props:
- agent_name: string (e.g., "@test-agent")
- change_reason: string
- new_skills: array
- context_limit: integer
- new_version: string
```

---

## Next Action Window (Quick Copy UI)

### Location & Layout
- **Page**: Extension overview/welcome view
- **Section**: Collapsible panel titled "Next Actions for Copilot"

### Components

#### 1. Agent Selector Dropdown
- Lists available agents/skills (auto-populated from repo configs)
- Examples: "@docs-agent", "@test-agent", "@lint-agent"

#### 2. Prompt Template Cards
- **Title**: Action description (e.g., "Update Linting Skill")
- **Prompt**: Pre-filled with current context
- **Copy Button**: One-click copy (📋) with tooltip "Copied to clipboard"
- **Customization Fields**: Input for props (e.g., "Priority: P1")

**Example Card**:
```
┌─────────────────────────────────────┐
│ Update Linting Skill                │
│ ─────────────────────────────────── │
│ /agent @lint-agent Update           │
│ instructions with new ESLint rules  │
│ from {docs_excerpt}. Align to P1    │
│ {p1_modules}.                       │
│                                     │
│ [Edit Props] [📋 Copy] [Preview]   │
└─────────────────────────────────────┘
```

#### 3. Preview Pane
- Shows generated prompt before copy
- Highlights props filled from current state

### Dynamic Generation
- Boss AI + LM fills prompts based on:
  - Current priorities (P1 modules)
  - Recent drift fixes
  - Active tasks
  - Error patterns

### Integration
- **Priorities**: Auto-includes P1 focus
- **Updates**: Refreshes post-UV task
- **LM Role**: Refines prompts if complex

---

## Copilot Workspace Integration

### Setup & Orchestration
- **Config**: Boss generates `.github/workspace.yaml` (hypothetical) with agents/skills
- **Launch**: Via GitHub CLI or API (e.g., `gh copilot workspace open`)
- **Session**: COE orchestrates Workspace tabs for P1 tasks

### Token Brakes in Workspace

**Description**: Pause Copilot on token near-hits; user "Continue" button with under-rated tokens

**Features**:
- **Detection**: Pre-prompt token check
- **Pause**: Sidebar button "Report & Continue"
- **Under-Rating**: Auto-adjust estimate (e.g., -20% buffer, user-customizable)
- **Resume**: Trigger breaking + continue with reduced context

**Flow**:
```
Copilot Prompt Prep → [Token Check]
  ├── Safe → Proceed Continuous
  └── Near/Hit → Brake: Pause + Sidebar Button
      └── User "Report & Continue" → Under-Rate + Breaking → Resume
```

**User Settings**:
- Slider: "Token Safety Margin (%)" → 10-30% (default: 20%)
- Checkbox: "Auto-resume on brake" (uses default margin)

---

## Task Delegation to Copilot

### Delegation Criteria
- **Delegable**: Low-risk, P2/P3 tasks (e.g., simple refactors, doc updates)
- **Non-Delegable**: P1 core logic, security-critical code

### Process
1. Boss identifies delegable task
2. Generates Copilot-compatible prompt
3. Launches in Workspace tab
4. Copilot executes, reports via MCP tools
5. Verification Team checks output

### Feedback Loop
- **MCP Tool**: `reportTaskCompleted` with Copilot metadata
- **Failure Handling**: If delegation fails (>2 attempts), fallback to local agent

---

## MCP Tools for Copilot

### Copilot-Accessible Tools (via Workspace Skills)

All tools wrapped in SKILL.md scripts for easy access:

#### 1. reportObservation
**Purpose**: Log insights (non-urgent, async)

```json
{
  "tool_name": "reportObservation",
  "parameters": {
    "observation": "string (max 1000 chars)",
    "category": "optimization | potential_bug | style_note | docs_improvement | other",
    "priority": "1-3 (default: 3)",
    "task_id": "string",
    "file_path": "string | null"
  },
  "returns": { "logged": true, "observation_id": "string" }
}
```

**Copilot Usage**: `/agent call MCP reportObservation {"observation": "...", "priority": 1}`

#### 2. reportTaskCompleted
**Purpose**: Signal task finish with metrics

```json
{
  "tool_name": "reportTaskCompleted",
  "parameters": {
    "task_id": "string",
    "status": "success | partial | failed",
    "output_summary": "string (max 500 chars)",
    "files_modified": "array",
    "coverage_percent": "number | null",
    "test_results": {"passed": number, "failed": number},
    "priority_completed": "1-3"
  },
  "returns": { "acknowledged": true, "next_task_suggested": "string | null" }
}
```

**Priority Awareness**: P1 completions trigger queue re-prioritization

#### 3. reportIssue
**Purpose**: Flag blocking issues (immediate or batched)

```json
{
  "tool_name": "reportIssue",
  "parameters": {
    "issue_description": "string (max 800 chars)",
    "severity": "1-3 (1=critical)",
    "task_id": "string",
    "file_path": "string | null",
    "repro_steps": "string",
    "immediate": "boolean (default: false)"
  },
  "returns": { "logged": true, "escalated": boolean }
}
```

**Escalation**: Severity 1 (P1) forces immediate Boss/Answer escalation

#### 4. getImmediateAnswer
**Purpose**: Synchronous clarification (blocks caller)

```json
{
  "tool_name": "getImmediateAnswer",
  "parameters": {
    "query": "string (max 400 chars)",
    "context_bundle": "object (optional snippets/task_id)",
    "max_wait_seconds": "integer (default: 30)"
  },
  "returns": { "answer": "string", "source": "string | null", "timeout": boolean }
}
```

**Priority**: P1 queries get shortest wait; P3 may timeout faster

---

## Non-Immediate Reporting Tools (Batched)

### batchReportTasks
**Purpose**: Report multiple tasks at once (end of session)

```json
{
  "parameters": {
    "tasks": "array of {task_id, status, summary}"
  },
  "returns": { "queued": true, "count": number }
}
```

### logObservations
**Purpose**: Batch insights (no immediate response)

```json
{
  "parameters": {
    "observations": "array of {observation, priority, task_id}"
  },
  "returns": { "logged": true }
}
```

### flagQuestions
**Purpose**: Queue questions for later Boss review

```json
{
  "parameters": {
    "questions": "array of {query, task_id, priority}"
  },
  "returns": { "queued": true }
}
```

---

## Immediate Call Actions

### getImmediateAnswer (Detailed Above)
Blocks until Answer Team responds or timeout

### callMCPAction
**Purpose**: Synchronous execution for critical operations

```json
{
  "tool_name": "callMCPAction",
  "parameters": {
    "action_name": "string (e.g., 'enforcePlan')",
    "props": "object",
    "timeout_seconds": "integer (default: 30)"
  },
  "returns": { "result": "object", "success": boolean }
}
```

**Usage**: P1 critical actions only (e.g., plan enforcement)

---

## Copilot Workspace Prompts (Tools Mixed)

### Example: Mixed Prompt-Tool Workflow

```typescript
// In SKILL.md script
const prompt = `
Implement {task_description}.

If unclear on naming conventions:
  - Call MCP askQuestion with payload: {
      "question": "Naming convention for {component}?",
      "task_id": "{task_id}",
      "confidence_level": 50
    }

On completion:
  - Call MCP reportTaskCompleted with metrics

Report observations via MCP reportObservation.
`;
```

**Execution**: Copilot interprets text prompts, executes embedded MCP tool calls

---

## Backup System for Difficult Spots

### Process
1. **Detection**: Loop/ambiguity threshold hit (>3 attempts)
2. **LM Summary**: Generate explanation + proposed fix
3. **User Modal**: VS Code prompt with Yes/No/Details buttons
4. **Backup**: If denied, fallback to manual mode or pause

**Modal UI**:
```
┌────────────────────────────────────┐
│ Difficult Spot Detected            │
│ ──────────────────────────────────│
│ Issue: Jest config unclear after   │
│ research. Propose: Use default     │
│ config and flag for review.        │
│                                    │
│ Permission to proceed?             │
│                                    │
│ [Yes] [No] [Show Details]          │
└────────────────────────────────────┘
```

**LangGraph Integration**: Human gate (conditional edge)

---

## Continuous Workflow (No Wait States)

### Design Principles
- **Async MCP Calls**: Non-immediate reports don't block
- **Task Queuing**: During brakes/recoveries, queue new tasks
- **Parallel Execution**: Boss reassigns work (e.g., P2 continues while P1 recovers)

### Example Flow
```
Copilot Working P1 → Token Brake → Pause P1 + Queue P2 → User Continues P1 with Breaking → P2 Starts Parallel → Both Report → Boss Aggregates
```

**No Wait States**: Always something executing or queued

---

## Token Brakes - Detailed Specification

### Detection Mechanism
```typescript
function checkTokenLimit(promptText: string, limit: number, margin: number = 0.2): "safe" | "warning" | "brake" {
  const estimated = estimateTokens(promptText);
  const threshold = limit * (1 - margin);
  
  if (estimated < threshold) return "safe";
  if (estimated < limit) return "warning";
  return "brake";
}
```

### User Interface

**Sidebar Panel** (appears on warning/brake):
```
┌────────────────────────────────────┐
│ ⚠️ Token Limit Approaching          │
│                                    │
│ Current: ~4,800 / 5,000 tokens     │
│ Safety Margin: 20%                 │
│                                    │
│ Options:                           │
│ [Report & Continue] ← recommended  │
│ [Pause] [Adjust Margin]            │
└────────────────────────────────────┘
```

**"Report & Continue" Action**:
1. Logs issue to errors.db
2. Applies breaking strategies
3. Under-rates future estimates (e.g., -20%)
4. Resumes Copilot prompt with reduced context

### Settings
- **Slider**: "Token Safety Margin (%)" → 10-30% (default: 20%)
- **Checkbox**: "Auto-brake enabled" (default: true)
- **Dropdown**: "On brake action" → Report & Continue | Pause | Reduce Context

---

## Expanded MCP Tool Schemas

### Complete Schema Reference

#### askQuestion (v1.2)
```json
{
  "tool_name": "askQuestion",
  "version": "1.2",
  "description": "Request clarification or research from Answer/Researcher teams",
  "parameters": {
    "question": {
      "type": "string",
      "maxLength": 300,
      "required": true
    },
    "context_summary": {
      "type": "string",
      "maxLength": 200,
      "required": true
    },
    "current_file": {
      "type": ["string", "null"]
    },
    "relevant_snippets": {
      "type": "array",
      "maxItems": 4,
      "items": {
        "type": "object",
        "properties": {
          "file": { "type": "string" },
          "line_start": { "type": "integer" },
          "line_end": { "type": "integer" },
          "content": { "type": "string", "maxLength": 1500 }
        },
        "required": ["file", "content"]
      }
    },
    "plan_references": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "section": { "type": "string" },
          "quote": { "type": ["string", "null"] }
        }
      }
    },
    "task_id": { "type": "string", "required": true },
    "confidence_level": {
      "type": "integer",
      "minimum": 0,
      "maximum": 100
    },
    "possible_options": {
      "type": ["array", "null"],
      "items": { "type": "string" },
      "maxItems": 4
    },
    "priority_level": {
      "type": "integer",
      "enum": [1, 2, 3],
      "default": 2
    }
  },
  "returns": {
    "answer": "string",
    "source": "string | null",
    "confidence": "integer (0-100)",
    "follow_up_needed": "boolean",
    "escalated_to_user": "boolean"
  },
  "errors": [
    "INVALID_PARAM", "TOKEN_LIMIT_EXCEEDED", "TIMEOUT", "INVALID_STATE"
  ],
  "token_impact": "400-800 tokens (question + snippets)",
  "priority_awareness": "P1 → immediate routing; P3 → queued",
  "copilot_compat": "/agent ask MCP askQuestion {json}"
}
```

#### reportObservation (v1.1)
```json
{
  "tool_name": "reportObservation",
  "version": "1.1",
  "description": "Log non-urgent insights for later review",
  "parameters": {
    "observation": { "type": "string", "maxLength": 1000, "required": true },
    "category": {
      "type": "string",
      "enum": ["optimization", "potential_bug", "style_note", "docs_improvement", "other"]
    },
    "priority": { "type": "integer", "enum": [1, 2, 3], "default": 3 },
    "task_id": { "type": "string" },
    "file_path": { "type": ["string", "null"] }
  },
  "returns": { "logged": true, "observation_id": "string" },
  "errors": ["RATE_LIMIT", "INVALID_PARAM"],
  "token_impact": "150-300 tokens",
  "priority_awareness": "P1 → immediate Boss review; P3 → batched"
}
```

#### reportTaskCompleted (v1.2)
```json
{
  "tool_name": "reportTaskCompleted",
  "version": "1.2",
  "parameters": {
    "task_id": { "type": "string", "required": true },
    "status": { "type": "string", "enum": ["success", "partial", "failed"] },
    "output_summary": { "type": "string", "maxLength": 500 },
    "files_modified": { "type": "array", "items": { "type": "string" } },
    "coverage_percent": { "type": ["number", "null"] },
    "test_results": {
      "type": "object",
      "properties": {
        "passed": { "type": "integer" },
        "failed": { "type": "integer" }
      }
    },
    "priority_completed": { "type": "integer", "enum": [1, 2, 3] }
  },
  "returns": { "acknowledged": true, "next_task_suggested": "string | null" },
  "errors": ["INTERNAL_ERROR", "INVALID_PARAM"],
  "token_impact": "200-500 tokens",
  "priority_awareness": "P1 completions trigger queue re-prioritization"
}
```

#### reportIssue (v1.1)
```json
{
  "tool_name": "reportIssue",
  "version": "1.1",
  "parameters": {
    "issue_description": { "type": "string", "maxLength": 800, "required": true },
    "severity": { "type": "integer", "enum": [1, 2, 3], "description": "1=critical" },
    "task_id": { "type": "string" },
    "file_path": { "type": ["string", "null"] },
    "repro_steps": { "type": "string" },
    "immediate": { "type": "boolean", "default": false }
  },
  "returns": { "logged": true, "escalated": boolean },
  "errors": ["TOKEN_LIMIT_EXCEEDED", "INVALID_PARAM"],
  "token_impact": "250-600 tokens",
  "priority_awareness": "Severity 1 → immediate escalation"
}
```

#### getImmediateAnswer (v1.0)
```json
{
  "tool_name": "getImmediateAnswer",
  "version": "1.0",
  "parameters": {
    "query": { "type": "string", "maxLength": 400, "required": true },
    "context_bundle": { "type": "object" },
    "max_wait_seconds": { "type": "integer", "default": 30 }
  },
  "returns": { "answer": "string", "source": "string | null", "timeout": boolean },
  "errors": ["TIMEOUT", "TOKEN_LIMIT_EXCEEDED", "RECOVERY_TRIGGERED"],
  "token_impact": "500-1200 tokens (includes answer)",
  "priority_awareness": "P1 → shortest wait; P3 → may timeout faster"
}
```

---

## Error Handling in Copilot Context

### Error Prompt Templates (Copy-Paste Ready)

#### 1. Basic Error Report
```
/agent @support-agent Report MCP error in COE extension:
Code: {error.code}
Message: {error.message}
Task: {task_id}
Priority Impact: {error.priority_impact}
Full details: {json_error}
```

#### 2. Token Overflow Report
```
/agent @context-agent Token limit hit in COE MCP call.
Tool: {tool_name}
Current tokens: {current} / Limit: {limit}
Error: {error.message}
Please suggest recovery or context reduction strategy.
```

#### 3. Critical Escalation
```
/agent @boss-agent CRITICAL MCP error in COE:
{error.code} - {error.message}
Severity: CRITICAL
Priority: P1 BLOCKED
Task ID: {task_id}
Please investigate and propose fix.
```

#### 4. Retry Suggestion Request
```
/agent @retry-agent MCP tool {tool_name} failed with {error.code}.
Retryable: {error.retryable}
Retry after: {error.retry_after_seconds}s
Should we retry automatically or escalate?
```

---

## Implementation Roadmap

### Stage 1 (Weeks 1-3)
- [ ] Basic instructions management
- [ ] Simple skill building (linting, testing)
- [ ] Next Action Window UI
- [ ] Token brakes implementation

### Stage 2 (Weeks 4-6)
- [ ] Workspace integration
- [ ] Task delegation system
- [ ] All MCP tools for Copilot
- [ ] Batched reporting tools

### Stage 3 (Weeks 7-8)
- [ ] Advanced skill generation
- [ ] Agent persona management
- [ ] Error prompt templates
- [ ] Continuous workflow optimization

---

**End of GitHub Copilot Integration System**
