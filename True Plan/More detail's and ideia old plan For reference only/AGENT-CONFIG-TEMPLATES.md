# Agent Configuration Templates

**Version**: 1.0  
**Date**: February 1, 2026  
**Status**: MVP Agent Config Reference  
**Purpose**: Standardized YAML templates for all COE agents

---

## Overview

Each agent requires a `config.yaml` file defining its behavior, LLM settings, and operational constraints. This document provides **copy-paste templates** for all MVP agents.

**Location**: All configs stored in `.coe/agents/{agent-name}/config.yaml`

---

## Directory Structure

```
${workspaceRoot}/.coe/agents/
├── clarity-agent/
│   └── config.yaml
├── planning-team/
│   └── config.yaml
├── orchestrator/
│   └── config.yaml
├── answer-team/
│   └── config.yaml
├── verification-team/
│   └── config.yaml
└── task-decomposition/
    └── config.yaml
```

---

## LLM Reliability & Offline Handling

**Purpose**: All agents must gracefully handle LLM downtime (e.g., LM Studio crashes, network issues, local model unloaded).

### Reliability Configuration Parameters

All agent configs include these standardized LLM reliability settings:

| Parameter | Type | Purpose | Example |
|---|---|---|---|
| `ping_interval_seconds` | integer | How often to health-check LLM endpoint | `60` (every minute) |
| `ping_timeout_ms` | integer | Max time for ping to complete | `5000` (5 seconds) |
| `max_retry_attempts` | integer | Retry failed LLM calls before giving up | `3` |
|retry_backoff_ms` | array | Exponential backoff delays (ms) | `[1000, 3000, 5000]` |
| `offline_fallback` | enum | Behavior when LLM unreachable | `"ticket"` / `"skip"` / `"halt"` |

### Offline Fallback Strategies

**`ticket`** (Default for non-critical agents):
- Creates user ticket: "LLM unavailable – manual intervention needed"
- Continues other operations
- **Use for**: Clarity Agent, Answer Team

**`skip`** (For optional operations):
- Logs error, skips operation, continues workflow
- **Use for**: Low-priority suggestions, optional ratings

**`halt`** (For critical agents):
- Pauses all operations until LLM recovers
- Shows user warning: "Planning Team blocked – LLM offline"
- **Use for**: Planning Team, Orchestrator (critical path)

### Health Check Implementation

**Ping Mechanism**:
```typescript
async function checkLlmHealth(endpoint: string, timeoutMs: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    const response = await fetch(`${endpoint}/api/health`, {
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    return response.ok;
  } catch (error) {
    return false;  // Offline or timeout
  }
}
```

**Retry with Backoff**:
```typescript
async function callLlmWithRetry(prompt: string, config: LlmConfig): Promise<string> {
  for (let attempt = 0; attempt < config.max_retry_attempts; attempt++) {
    try {
      return await callLlm(prompt, config);
    } catch (error) {
      if (attempt === config.max_retry_attempts - 1) {
        // Final retry failed → apply fallback strategy
        return handleOfflineFallback(config.offline_fallback);
      }
      
      // Wait before retry
      const backoffMs = config.retry_backoff_ms[attempt] || 5000;
      await delay(backoffMs);
    }
  }
}
```

### LM Studio Specific Handling

**Default Endpoint**: `http://localhost:11434` (Ollama) or `http://192.168.1.205:1234` (LM Studio networked)

**⚠️ CRITICAL: Model Loading Constraints**

1. **Load Time**: Switching models takes **5-30 minutes** (14B models ~15-30 min, 7B models ~5-10 min)
2. **Single Model Limit**: LM Studio can only load **ONE model at a time**
3. **Hot Load**: API calls trigger automatic loading if model not loaded
4. **Check Before Load**: Use `GET /v1/models` to avoid unnecessary waits

**Optimized Loading Strategy**:
```typescript
async function ensureModelLoaded(targetModel: string, endpoint: string): Promise<boolean> {
  // Step 1: Check what's currently loaded
  const response = await fetch(`${endpoint}/v1/models`);
  const models = await response.json();
  const currentModel = models.data[0]?.id;
  
  // Step 2: If already loaded, return immediately
  if (currentModel === targetModel) {
    logger.info(`Model ${targetModel} already loaded - no wait needed`);
    return true;
  }
  
  // Step 3: Model switch required - warn user
  if (currentModel) {
    logger.warn(`Model switch: ${currentModel} → ${targetModel}`);
    logger.warn(`Estimated load time: 5-30 minutes`);
    
    // Optional: Create user notification
    vscode.window.showWarningMessage(
      `Switching LLM model to ${targetModel}. This may take up to 30 minutes.`,
      'Continue', 'Cancel'
    );
  }
  
  // Step 4: Make a test call (triggers hot load)
  try {
    await fetch(`${endpoint}/v1/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: targetModel,
        prompt: 'test',
        max_tokens: 1
      }),
      signal: AbortSignal.timeout(30 * 60 * 1000)  // 30-min timeout
    });
    return true;
  } catch (error) {
    logger.error(`Model loading failed or timed out: ${error}`);
    return false;
  }
}
```

**Common Failure Modes**:
1. **Port conflict**: LM Studio not started → retry 3x, then ticket
2. **Model unloaded**: LM Studio running but model not loaded → show user instruction
3. **GPU OOM**: Model crashes mid-inference → retry with smaller context

**User Notification**:
```
⚠️ LLM Offline: Planning Team paused
LM Studio may not be running or model not loaded.
Check: http://localhost:11434/api/health
[Retry] [Use Fallback] [Ignore]
```

---

## Setup Script

**Auto-create all agent config directories**:

```bash
# Run from workspace root
npm run setup-agent-configs

# Or manually:
mkdir -p .coe/agents/{clarity-agent,planning-team,orchestrator,answer-team,verification-team,task-decomposition}
cp templates/agents/*.yaml .coe/agents/
```

---

## Template 1: Clarity Agent

**File**: `.coe/agents/clarity-agent/config.yaml`

```yaml
# Clarity Agent Configuration
agent_name: "Clarity Agent"
role: "High-priority clarity enforcer for ticket replies"
enabled: true

# LLM Configuration
llm:
  model: "qwen2-7b"               # Local 7B model (fast scoring)
  endpoint: "http://localhost:11434"  # Ollama endpoint
  timeout_seconds: 30             # Max scoring time
  max_tokens: 500                 # Prompt + response limit
  temperature: 0.3                # Low temp = consistent scoring
  
  # Reliability & Offline Handling (NEW)
  ping_interval_seconds: 60        # Health check every 60s
  ping_timeout_ms: 5000            # Ping must complete within 5s
  max_retry_attempts: 3            # Retry failed calls 3 times
  retry_backoff_ms: [1000, 3000, 5000]  # Exponential backoff delays
  offline_fallback: "ticket"       # Options: "ticket" | "skip" | "halt"
  # "ticket" = Create user ticket on LLM failure
  # "skip" = Skip operation, log error
  # "halt" = Block agent until LLM recovers
  
  # Model Loading Behavior (CRITICAL for LM Studio)
  model_load_timeout_minutes: 30   # Max wait for model loading (can take 30 min)
  check_loaded_model_first: true   # Check /v1/models before calling (skip if already loaded)
  allow_hot_load: true             # Allow API call to trigger model loading
  # NOTE: Only ONE model can be loaded at a time in LM Studio
  # Switching models triggers unload + reload (up to 30 min)

# Scoring Thresholds
clarity:
  min_score: 85                   # Below this → auto-reply with follow-ups
  max_iterations: 5               # Max reply loops before escalate to Boss
  confidence_weight: 0.4          # Confidence score weight
  completeness_weight: 0.3        # Completeness score weight
  accuracy_weight: 0.3            # Accuracy score weight

# Feature Flags
features:
  auto_reply: true                # Auto-reply if score < min_score
  escalate_to_boss: true          # Escalate after max_iterations
  log_scores: true                # Log all clarity scores for analysis

# Priority Handling
priority:
  p1_response_time_seconds: 5     # Urgency for P1 tickets
  p2_response_time_seconds: 15
  p3_response_time_seconds: 30

# Prompts (override defaults if needed)
prompts:
  scoring_template: |
    Reply: {reply_content}
    Original Question: {ticket_description}
    
    Score clarity (0-100): Is it unambiguous, specific, actionable?
    Score completeness (0-100): Does it fully address the query?
    Score accuracy (0-100): Aligns to plan {plan_snippet}?
    
    If total score < 85, generate 1-3 targeted follow-up questions.
    Keep response under 400 tokens.
```

---

## Template 2: Planning Team

**File**: `.coe/agents/planning-team/config.yaml`

```yaml
# Planning Team Configuration
agent_name: "Planning Team"
role: "Task decomposition and planning"
enabled: true

# LLM Configuration
llm:
  model: "qwen2-14b"              # Larger model for complex planning
  endpoint: "http://localhost:11434"
  timeout_seconds: 60             # Allow more time for planning
  max_tokens: 2000                # Larger context for plan analysis
  temperature: 0.5                # Medium temp for creative decomposition
  
  # Reliability & Offline Handling
  ping_interval_seconds: 120      # Health check every 2 min (less frequent for planning)
  ping_timeout_ms: 10000          # 10s timeout for 14B model
  max_retry_attempts: 3
  retry_backoff_ms: [2000, 5000, 10000]
  offline_fallback: "halt"        # Planning is critical → halt if LLM down
  
  # Model Loading Behavior
  model_load_timeout_minutes: 30  # 14B models can take 3-30 min to load
  check_loaded_model_first: true  # Avoid unnecessary model switches
  allow_hot_load: true            # Trigger loading on first call if needed

# Task Generation Settings
task_generation:
  min_effort_minutes: 15          # Minimum atomic task size
  max_effort_minutes: 45          # Maximum (MVP standard)
  auto_prioritize: true           # Auto-assign P1/P2/P3 based on plan
  max_parallel_tasks: 5           # How many tasks to generate in parallel

# Decomposition Strategy
decomposition:
  threshold_minutes: 45           # If task > this, delegate to Decomposition Agent
  prefer_parallel: false          # Prefer sequential dependencies (safer for MVP)
  max_depth: 3                    # Epic → Story → Subtask (3 levels max)

# Plan Context
plan:
  prd_cache_ttl_seconds: 300      # Re-read PRD.md every 5 min
  require_plan_before_action: true
  validate_dag: true              # Ensure no circular dependencies

# Feature Flags
features:
  auto_create_tasks: true         # Create tasks immediately on plan change
  notify_user: true               # Show notifications on task generation
  log_decisions: true             # Log planning decisions for audit

# Prompts
prompts:
  decompose_template: |
    Plan: {plan_content}
    Feature: {feature_description}
    
    Decompose into atomic tasks (15-45 min each).
    For each task:
    - Title (concise, action-oriented)
    - Description (what + why)
    - Acceptance criteria (testable)
    - Estimated minutes
    - Dependencies (task IDs)
    
    Output JSON array of tasks.
```

---

## Template 3: Programming Orchestrator

**File**: `.coe/agents/orchestrator/config.yaml`

```yaml
# Programming Orchestrator Configuration
agent_name: "Programming Orchestrator"
role: "Coding director (routes to Copilot)"
enabled: true

# LLM Configuration (lightweight, for routing logic only)
llm:
  model: "qwen2-7b"               # Small model (routing decisions simple)
  endpoint: "http://localhost:11434"
  timeout_seconds: 20
  max_tokens: 800
  temperature: 0.2                # Low temp = deterministic routing

# Execution Constraints
execution:
  max_concurrent_coding_sessions: 3   # Limit parallel Copilot tasks
  require_plan_task_id: true          # Must have Planning Team task
  coding_focus: "strict"              # No deviation from task bundle
  health_check_interval_seconds: 10   # Monitor Copilot responsiveness
  escalation_timeout_seconds: 30      # Escalate if Answer Team doesn't respond

# Task Routing
routing:
  reject_tasks_over_minutes: 45       # Reject oversized tasks
  auto_assign_to_copilot: true
  fallback_to_local_agent: false      # MVP: no local fallback

# Answer Team Integration
answer_team:
  enabled: true
  confidence_threshold: 0.4           # If Answer confidence < 40%, escalate to user
  timeout_seconds: 30

# Error Handling
errors:
  retry_attempts: 3
  backoff_base_seconds: 5
  escalate_on_repeated_timeouts: true  # After 3 timeouts, create user ticket

# Feature Flags
features:
  auto_create_tickets: true           # Create tickets on escalation
  monitor_copilot_health: true
  log_routing_decisions: true
```

---

## Template 4: Answer Team

**File**: `.coe/agents/answer-team/config.yaml`

```yaml
# Answer Team Configuration
agent_name: "Answer Team"
role: "Context-aware Q&A helper"
enabled: true

# LLM Configuration
llm:
  model: "qwen2-14b"              # Larger model for complex Q&A
  endpoint: "http://localhost:11434"
  timeout_seconds: 30
  max_tokens: 1500
  temperature: 0.4                # Balanced creativity + accuracy

# Answer Strategy
answering:
  min_confidence: 0.4             # If < 40%, escalate (can't answer confidently)
  max_search_depth: 3             # How deep to search codebase/plan
  prioritize_plan: true           # Search plan first, then codebase
  cache_answers: true             # Cache common Q&A (TTL: 1 hour)

# Evidence Collection
evidence:
  include_plan_snippets: true     # Show exact plan quotes in answer
  include_code_examples: true     # Link to relevant code files
  max_evidence_tokens: 500        # Limit evidence size

# Timeout Handling
timeout:
  enabled: true
  threshold_seconds: 30
  fallback_action: "escalate_to_user"  # Create ticket if timeout

# Feature Flags
features:
  semantic_search: true           # Use vector embeddings for search
  log_questions: true             # Log all Q&A for pattern analysis
  auto_escalate_low_confidence: true

# Prompts
prompts:
  answer_template: |
    Question: {question}
    Context: Task {task_id} - {task_title}
    
    Search plan for relevant design decisions.
    Search codebase for existing patterns.
    
    Provide:
    - Direct answer (yes/no or explanation)
    - Evidence from plan (exact quote + section)
    - Code examples (if applicable)
    - Implementation guidance
    
    Calculate confidence score (0-100) based on evidence strength.
```

---

## Template 5: Verification Team

**File**: `.coe/agents/verification-team/config.yaml`

```yaml
# Verification Team Configuration
agent_name: "Verification Team"
role: "Independent post-execution checker"
enabled: true

# LLM Configuration (minimal, mostly automated tests)
llm:
  model: "qwen2-7b"               # Small model (minimal LLM use)
  endpoint: "http://localhost:11434"
  timeout_seconds: 20
  max_tokens: 600
  temperature: 0.2

# Verification Settings
verification:
  stability_delay_seconds: 60     # Wait 60s after file changes (stability)
  require_tests_for_changes: true
  require_all_criteria_pass: true # All acceptance criteria must pass
  visual_verify_timeout_seconds: 600  # Max 10 min for user visual verify

# Test Execution
testing:
  auto_run_tests: true            # Run tests automatically after stability delay
  test_command: "npm test"        # Command to run tests
  coverage_threshold: 0.8         # Fail if coverage < 80%
  fail_fast: false                # Run all tests even if one fails

# Investigation Task Creation
investigation:
  auto_create_on_failure: true    # Create investigation task on test failure
  assign_to: "Planning Team"      # Who gets investigation ticket
  include_test_output: true       # Include failing test details

# Feature Flags
features:
  file_watcher: true              # Monitor file changes
  report_matches_and_remaining: true  # Report completed vs pending
  auto_create_followups: true
  log_verification_results: true

# Acceptance Criteria Matching
matching:
  fuzzy_match: true               # Allow slight variations in AC text
  match_threshold: 0.85           # Fuzzy match threshold
```

---

## Template 6: Task Decomposition Agent

**File**: `.coe/agents/task-decomposition/config.yaml`

```yaml
# Task Decomposition Agent Configuration
agent_name: "Task Decomposition Agent"
role: "Complexity watchdog (breaks oversized tasks)"
enabled: true

# LLM Configuration
llm:
  model: "qwen2-14b"              # Larger model for complex decomposition
  endpoint: "http://localhost:11434"
  timeout_seconds: 45
  max_tokens: 2000
  temperature: 0.5

# Decomposition Settings
decomposition:
  min_subtask_minutes: 15         # Minimum 15 minutes per subtask
  max_subtask_minutes: 45         # Maximum 45 minutes (MVP standard)
  min_subtasks: 2                 # At least 2 subtasks from decomposition
  max_subtasks: 8                 # At most 8 subtasks (avoid over-fragmentation)

# Decomposition Strategy
strategy:
  prefer_sequential: false        # Allow parallel subtasks if no dependencies
  enforce_single_concern: true    # Each subtask = one logical change
  validate_acceptance_criteria: true  # Each subtask has testable AC

# Feature Flags
features:
  auto_decompose: true            # Decompose immediately when triggered
  notify_planning_team: true      # Alert Planning Team after decomposition
  log_decomposition_decisions: true

# Prompts
prompts:
  decompose_template: |
    Original Task: {task_title}
    Estimated Effort: {estimated_minutes} minutes
    
    This task is too large (> 45 min threshold).
    
    Break into 2-8 subtasks, each:
    - 15-45 minutes
    - Single logical concern
    - Has clear acceptance criteria
    - Can be tested independently
    
    Output JSON array of subtasks with dependencies.
```

---

## Global Configuration (Optional)

**File**: `.coe/config.yaml` (workspace-level settings)

```yaml
# COE Global Configuration
workspace:
  root: "${workspaceRoot}"
  coe_directory: ".coe"

# Agent Defaults (can be overridden per-agent)
defaults:
  llm:
    endpoint: "http://localhost:11434"  # Ollama default
    timeout_seconds: 30
    temperature: 0.4
  
  logging:
    level: "INFO"                       # DEBUG | INFO | WARN | ERROR
    file: ".coe/logs/coe.log"
    max_size_mb: 10
  
  retry:
    max_attempts: 3
    backoff_base_seconds: 5

# MCP Server Settings
mcp:
  transport: "stdio"
  encoding: "utf-8"
  max_message_size_kb: 100

# GitHub Integration
github:
  sync_interval_minutes: 5
  rate_limit_check: true
  min_remaining_requests: 10
  cache_stale_after_hours: 24

# Ticket System
tickets:
  db_path: ".coe/tickets.db"
  archive_after_days: 90
  pii_detection_enabled: true

# Security
security:
  use_secrets_api: true              # Store tokens in VS Code secrets
  file_permissions_strict: true      # chmod 600 for all .coe files
  sanitize_webview_content: true     # XSS prevention
```

---

## Customization Guide

### Changing LLM Model

**Example**: Switch from local Ollama to OpenAI GPT-4

```yaml
llm:
  model: "gpt-4"
  endpoint: "https://api.openai.com/v1/chat/completions"
  api_key_env: "OPENAI_API_KEY"      # Read from env var
  timeout_seconds: 60                # Cloud API can be slower
  temperature: 0.4
```

### Adjusting Task Size Threshold

**Example**: Increase from 45 min to 60 min for experienced team

```yaml
# In planning-team/config.yaml
task_generation:
  max_effort_minutes: 60             # Changed from 45

# Also update in task-decomposition/config.yaml
decomposition:
  max_subtask_minutes: 60
```

**Note**: Must update MODULAR-EXECUTION-PHILOSOPHY.md to match!

---

## Validation

**Check config validity**:
```bash
npm run validate-configs

# Or manually:
node scripts/validate-agent-configs.js
```

**Common Errors**:
- Missing required field (e.g., `agent_name`)
- Invalid enum value (e.g., `temperature: 2.0` > max allowed)
- LLM endpoint unreachable
- File permissions too permissive (should be 600)

---

## ENV Variables for LLM

**Required** (add to `.env`):

```bash
# OpenAI (if using cloud LLM)
OPENAI_API_KEY=sk-...

# Anthropic Claude (if using)
ANTHROPIC_API_KEY=...

# Local Ollama (default, no key needed)
OLLAMA_ENDPOINT=http://localhost:11434
```

**Security**: Never commit `.env` to git! Add to `.gitignore`.

---

## References

- **Agent Roles**: [02-Agent-Role-Definitions.md](02-Agent-Role-Definitions.md)
- **Agent Matrix**: [AGENT-RESPONSIBILITIES-MATRIX.md](AGENT-RESPONSIBILITIES-MATRIX.md)
- **LLM Integration**: [PLANNING-WIZARD-SPECIFICATION.md](PLANNING-WIZARD-SPECIFICATION.md)
- **Context Management**: [08-Context-Management-System.md](08-Context-Management-System.md)
