# Context Management & Safety Systems

**Version**: 1.0  
**Date**: February 9, 2026

---

## Overview

AI models have limited "memory" (context windows). COE includes sophisticated systems to manage context size, prevent overflows, recover from errors, and keep everything secure. This document explains those safety systems.

---

## Context Management

### The Problem

AI models can only process a certain number of "tokens" (roughly, words) at once. When a conversation or task context grows too large, the AI starts losing track, hallucinating, or failing outright.

### COE's Solution: Layered Context Breaking

When context approaches the limit, COE applies a chain of strategies to reduce size while preserving the most important information:

```
Context Approaching Limit (80% Full)
              │
              ▼
   Strategy 1: Summarize Old Context
   Compress the first 60% into a brief summary
              │
   Still too big?
              │
              ▼
   Strategy 2: Prioritize Recent
   Keep recent + high-priority items
   Discard low-relevance older items
              │
   Still too big?
              │
              ▼
   Strategy 3: Smart Chunking
   Compress by content type:
   - Code: compress to 70%
   - Text: compress to 50%
   - Plan references: keep 100% (verbatim)
   - Logs: compress to 40%
              │
   Still too big?
              │
              ▼
   Strategy 4: Discard Low Relevance
   Drop bottom 30% by relevance score
   Replace with brief placeholders
              │
   Still too big?
              │
              ▼
   Strategy 5: Fresh Start
   Save state, start new context
   with essential information only
```

### Per-Agent Context Limits

Different agents have different context needs:

| Agent | Limit | Why |
|-------|-------|-----|
| Verification | 4,000 tokens | Only needs task + criteria + test results |
| Answer Agent | 5,000 tokens | Needs question + plan context + history |
| Planning | 5,000 tokens | Needs requirements + existing structure |
| Coding (external) | 5,000 tokens | Gets one task at a time with focused context |
| Custom Agents | 4,000 tokens | Configurable, kept small for simple models |

### Per-LLM Configuration

Different AI models have different capabilities:

| Model Type | Token Limit | Notes |
|-----------|-------------|-------|
| Local 14B model | 3,500 tokens | Conservative for reliability |
| Cloud model (Grok) | 8,000 tokens | Can handle more context |
| GPT-4 class | 6,000 tokens | Balanced limit |

---

## Token Safety

### LM Studio Streaming Queue

COE manages communication with the local AI server carefully:

- **Queue Limit**: Maximum 5 queued AI calls at once
- **Execution**: One call processed at a time (serial execution)
- **Polling**: Check for new responses at configurable intervals
- **Warning System**: If the queue stays full, COE creates a warning ticket
- **Timeout**: Global maximum timeout per request (default: 120 seconds)

### Token Brakes (Copilot Integration)

When working with GitHub Copilot's Workspace:

- **Pre-prompt check**: Estimate tokens before sending
- **Pause button**: "Report & Continue" sidebar button when near the limit
- **Under-rating**: Automatically reduce estimates by 20% buffer (user-configurable)
- **Resume**: Continue with reduced context if needed

---

## Error Recovery

### Offline Handling

COE works offline-first. When services are unavailable:

```
Service Request
      │
      ▼
  Available Online? ──Yes──► Process Normally
      │
      No
      │
      ▼
  Check Offline Cache ──Hit──► Return Cached Data
      │
      Miss
      │
      ▼
  Manual Fallback ──► Hold the ticket,
                       retry when online
                       Log to audit trail
```

### Offline Cache

- Location: `.coe/offline-cache/`
- Stores full payloads plus summary index
- Retains data for 7 days, prunes oldest on size threshold
- Auto-refreshes when the connection comes back online

### Loop Detection (All Agents — Including Custom Agents)

Every 20 AI calls, COE checks for loops across **all agents** — built-in and custom:

| Red Flag | Threshold | Action |
|----------|-----------|--------|
| Same API call repeated | 3+ times | Pause and investigate |
| Identical errors | 3+ times | Create investigation ticket |
| Shrinking output length | Consistent decrease | Flag potential stuck state |
| Response similarity >85% | Between consecutive replies | Break loop, try new approach |
| Custom agent repeating same goal | 3+ cycles | Pause agent, notify user |
| Custom agent exceeding time budget | >5 min on single checklist item | Timeout + escalate to Boss AI |

---

## Custom Agent Safety

Custom agents (user-created specialists) have additional safety layers because they run user-defined logic on top of AI inference.

### Custom Agent Execution Loop

Every custom agent follows a guarded execution loop:

```
Custom Agent Receives Task
        │
        ▼
  Load YAML Config
  (system prompt, goals, checklist, permissions)
        │
        ▼
  Hardlock Check ────────────────────────────┐
  Can this agent write files? ──► ALWAYS NO  │
  Can this agent execute code? ──► ALWAYS NO │
        │                                    │
        ▼                                    │
  For Each Goal (in priority order):         │
  ┌──────────────────────────────────┐       │
  │  1. Load relevant context        │       │
  │  2. Call LLM with system prompt   │       │
  │  3. Validate response format      │       │
  │  4. Check against checklist items │       │
  │  5. Store results in ticket       │       │
  └──────────┬───────────────────────┘       │
             │                               │
             ▼                               │
  Safety Checks After Each Goal:             │
  ┌──────────────────────────────────┐       │
  │  • Token usage within limit?     │       │
  │  • Response coherent? (not loop) │       │
  │  • Time budget OK? (<5 min/goal) │       │
  │  • No write attempts detected?   │       │
  └──────────┬───────────────────────┘       │
             │                               │
        Pass │         Fail                  │
             │           │                   │
             ▼           ▼                   │
     Next Goal    Halt + Report to User      │
             │                               │
             ▼                               │
  All Goals Complete                         │
        │                                    │
        ▼                                    │
  Return Results via Ticket                  │
  Agent Goes Idle                            │
```

### Hardlock Protections

Custom agents have **unbreakable** restrictions that cannot be overridden by the user, the agent's YAML config, or the AI itself:

| Locked Permission | Why |
|-------------------|-----|
| Cannot write or edit any file | Prevents accidental code damage |
| Cannot execute any command | Prevents system-level side effects |
| Cannot access network (default) | Prevents data leaks; user can enable per-agent |
| Cannot modify other agents | Prevents cascade failures |
| Cannot modify their own config | Prevents self-escalation of permissions |

### Custom Agent Runaway Prevention

| Guard | Default | What Happens |
|-------|---------|-------------|
| Maximum goals per run | 20 | Agent stops after 20 goals, reports partial results |
| Maximum LLM calls per run | 50 | Agent halts + creates "budget exceeded" ticket |
| Maximum time per goal | 5 minutes | Goal times out, skips to next goal |
| Maximum total runtime | 30 minutes | Agent force-stops, saves progress |
| Response loop detection | 3 similar replies | Agent pauses, asks user to intervene |
| Context overflow | 80% of limit | Triggers context breaking chain (same as built-in agents) |

### Custom Agent Audit Trail

Every custom agent action is fully logged:
- Which agent ran, when, and for how long
- Every LLM call made (prompt summary + response summary)
- Every file read (path + purpose)
- Every ticket created or updated
- Every goal attempted and whether it passed/failed
- Any safety guard that triggered (with reason)

---

## Smart Improvement Systems

Beyond basic safety, COE includes intelligent systems that actively make things better.

### Intelligent Retry Logic

When an AI call fails, COE doesn't just retry blindly:

```
AI Call Fails
      │
      ▼
  Classify Error Type
      │
      ├── Timeout ──────► Wait longer (exponential backoff: 5s → 10s → 20s)
      ├── Token Overflow ──► Reduce context using breaking chain, then retry
      ├── Model Busy ────► Queue and wait (max 5 in queue)
      ├── Bad Response ──► Rephrase prompt, add clarification, retry
      └── Persistent ────► After 3 failures: create investigation ticket,
                           try alternate model if available
```

### Proactive Drift Detection

COE doesn't wait for problems — it looks for them:

| Check | Frequency | What It Catches |
|-------|-----------|----------------|
| Plan vs. codebase comparison | On every file change | Code that doesn't match the plan |
| Stale task detection | Every 15 minutes | Tasks sitting untouched too long |
| Dependency health check | On task completion | Broken or circular dependency chains |
| Coverage regression | On verification | Test coverage dropping below threshold |
| Agent health monitoring | Continuous | Agents failing repeatedly or timing out |

### Smart Context Preloading

Instead of loading context when needed (reactive), COE predicts what will be needed next:

- When Task #5 is being worked on, COE pre-loads context for Task #6 and #7
- When a question is asked, COE preloads related plan sections
- When verification runs, COE pre-loads the design system reference for UI tasks
- Preloaded context is cached and discarded if not used within 10 minutes

### Intelligent Task Reordering

The task queue isn't static — COE continuously optimizes it:

| Signal | Reordering Action |
|--------|-------------------|
| A dependency just completed | Unblocked tasks move to front of their priority level |
| A task keeps failing | Move to "needs investigation" lane, don't block the queue |
| User changes a priority | Entire queue re-sorts immediately |
| Drift detected in a module | Related tasks get a priority boost |
| Agent is idle and queue is low | Auto-generate bridge tasks to maintain momentum |

### Quality Learning Loop

COE tracks success patterns and failure patterns to continuously improve:

```
  Every Completed Task
        │
        ▼
  Record Outcome Data:
  - Time taken vs. estimate
  - Questions asked (type + count)
  - Verification result (pass/fail/partial)
  - Context strategy used
  - Agent that handled it
        │
        ▼
  Pattern Analysis (weekly):
  - Which task types take longest?
  - Which agents answer most accurately?
  - Which context strategies preserve coherence best?
  - Which checklist items catch real issues?
        │
        ▼
  Auto-Tune:
  - Adjust time estimates for future similar tasks
  - Prefer agents with higher success rates for their domain
  - Promote context strategies that work best
  - Add commonly-needed checklist items to templates
```

---

## Ticket System Safety

### Priority Handling

| Priority | Notification | Response |
|----------|-------------|----------|
| P1 (Critical) | Immediate sidebar alert | Must be addressed before other work continues |
| P2 (Important) | Batched notification | Addressed in order |
| P3 (Nice to have) | Passive indicator | Addressed when convenient |

### Ticket Limits

- **Maximum 10 active tickets** at any time
- **FIFO within same priority** — first in, first out
- **5 clarification rounds maximum** before escalating to Boss AI or user
- **Token safety**: Ticket threads auto-break if >80% of context limit; summaries handed over

### Ghost Tickets

When a task is blocked by an unanswered question:
1. Original ticket marked "Blocked"
2. A "Ghost Ticket" is auto-created with higher priority
3. Once the ghost ticket resolves, the original ticket unblocks
4. This prevents important work from silently stalling

---

## Security

### Authentication

- **GitHub tokens**: Stored in VS Code's encrypted Secrets API (OS-level keychain)
- **Copilot credentials**: Handled by GitHub Copilot extension (COE doesn't manage them)
- **Token rotation**: Users prompted to rotate tokens every 90 days (post-MVP)

### Data Protection

- **Database**: SQLite, locally stored (MVP: plaintext; post-MVP: encryption via SQLCipher)
- **Sensitive data detection**: COE scans ticket content for potential secrets (API keys, passwords, SSH keys)
- **Warning modal**: If sensitive data detected, user sees: "This may contain sensitive data. Continue?"

### Input Validation

All inputs are validated before:
- **Storing in database** — parameterized queries only (no string concatenation)
- **Displaying in UI** — sanitized to prevent XSS
- **Passing to MCP tools** — validated against schemas
- **Including in AI prompts** — checked for prompt injection patterns

### Approval System

For optional tools and actions:
- **Approve once** modal for first-time tool use
- **Batch approval by category** with per-tool overrides
- **Auto-expire after 30 days** with re-prompt and context reminder

---

## File Watchers & Performance

### Watcher Safety

COE watches several directories for changes (source code, GitHub issues, plans):

- **Debounce**: 500ms delay before reacting to changes (prevents rapid-fire events)
- **Error handling**: If a watcher fails (permission error, file not found), it logs the error and falls back to manual refresh
- **Cleanup**: All watchers are properly disposed when the extension deactivates
- **Large folders**: Configurable debounce time for large projects

### Performance Guardrails

| Guard | Default | Purpose |
|-------|---------|---------|
| Custom agent max runtime | 30 minutes | Prevent runaway custom agents |
| Watcher debounce | 500ms | Prevent CPU spikes on many file changes |
| LLM request timeout | 120 seconds | Prevent hanging on slow models NOTE: Token respones time out. |
| Polling interval | 30 seconds | Balance responsiveness vs. resource use |
| Task queue limit | 20 pending tasks | Prevent overload |
| Verification delay | 60 seconds | Ensure file stability before checking |
| Smart retry backoff | 5s → 10s → 20s | Prevent hammering a failing service |
| Context preload window | 10 minutes | Discard unused preloaded context |
