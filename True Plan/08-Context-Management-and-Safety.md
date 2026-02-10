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

### Loop Detection

Every 20 AI calls, COE checks for loops:

| Red Flag | Threshold | Action |
|----------|-----------|--------|
| Same API call repeated | 3+ times | Pause and investigate |
| Identical errors | 3+ times | Create investigation ticket |
| Shrinking output length | Consistent decrease | Flag potential stuck state |
| Response similarity >85% | Between consecutive replies | Break loop, try new approach |

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
| Watcher debounce | 500ms | Prevent CPU spikes on many file changes |
| LLM request timeout | 120 seconds | Prevent hanging on slow models NOTE: Token respones time out. |
| Polling interval | 30 seconds | Balance responsiveness vs. resource use |
| Task queue limit | 20 pending tasks | Prevent overload |
| Verification delay | 60 seconds | Ensure file stability before checking |
