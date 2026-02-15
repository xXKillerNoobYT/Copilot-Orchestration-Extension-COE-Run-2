# 08 — Context Management & Safety Systems

**Version**: 3.0  
**Last Updated**: February 2026  
**Status**: ✅ Current  
**Depends On**: [02-System-Architecture-and-Design](02-System-Architecture-and-Design.md), [07-Program-Lifecycle-and-Evolution](07-Program-Lifecycle-and-Evolution.md)  
**Changelog**: v3.0 — Standardized header, added User/Dev views throughout, expanded Security section from old SECURITY-AUTHENTICATION-SPEC.md (authentication, data protection, OWASP rules, threat model, retention policy, access control, network security), added context config reference, added cross-references

---

## How to Read This Document

This document covers two critical concerns: (1) **context management** — how COE keeps AI models working effectively within their limited "memory," and (2) **safety systems** — how COE protects data, prevents errors, and keeps the system secure. Both are essential for a system that operates autonomously with minimal user intervention.

> **👤 User View**: You'll rarely interact with context management directly — COE handles it automatically behind the scenes. But understanding safety is important: COE protects your data, warns you about sensitive content, and ensures AI agents can't accidentally damage your project. If a safety system triggers (like a loop detection or sensitive data warning), you'll see a clear notification explaining what happened and what to do.

> **🔧 Developer View**: Context management is implemented across 4 services (`TokenBudgetTracker`, `ContextFeeder`, `ContextBreakingChain`, `TaskDecompositionEngine`). Safety is enforced at multiple layers: database (parameterized queries), UI (HTML sanitization), MCP (schema validation), and AI prompts (tagged isolation). The `EthicsEngine` provides the top-level ethics framework. All safety events are logged to the audit trail.

---

## Context Management

### The Problem

AI models can only process a certain number of "tokens" (roughly, words) at once. When a conversation or task context grows too large, the AI starts losing track, hallucinating, or failing outright. For COE's default model (ministral-3-14b), the context window is 32,768 tokens — roughly 25,000 words. That sounds like a lot, but a typical codebase can easily exceed that with just a few files plus task history.

> **👤 User View**: You don't need to worry about context limits. COE automatically manages how much information it sends to the AI, keeping only the most relevant context for each task. If the context gets too large, COE compresses it intelligently — it's like an AI that knows what to bring to a meeting and what to leave behind. You might occasionally see a notification like "Context optimized — previous task history summarized" but this is just informational.

> **🔧 Developer View**: The context management pipeline is: `BaseAgent.buildMessages()` → `ContextFeeder.buildOptimizedMessages()` → `TokenBudgetTracker.checkBudget()` → `ContextBreakingChain.applyLevel{1-5}()` (if needed). Each LLM call goes through this pipeline. The budget tracker enforces per-agent limits and logs usage via `recordUsage()` after each call. Context breaking is progressive — Level 1 (summarize) through Level 5 (fresh start).

### COE's Solution: Layered Context Breaking — ✅ IMPLEMENTED

> **Status**: Fully implemented as of v1.1 (February 12, 2026)
> **Services**: `TokenBudgetTracker`, `ContextFeeder`, `ContextBreakingChain`, `TaskDecompositionEngine`
> **Files**: `src/core/token-budget-tracker.ts`, `src/core/context-feeder.ts`, `src/core/context-breaking-chain.ts`, `src/core/task-decomposition-engine.ts`

When context approaches the limit, COE applies a chain of strategies to reduce size while preserving the most important information:

```
Context Approaching Limit (70% = Warning, 90% = Critical)
              │
              ▼
   Strategy 1: Summarize Old Context
   Compress the oldest 60% of items to ~30%
   (keep first sentences, headings, file paths)
   [ContextBreakingChain.applyLevel1()]
              │
   Still too big?
              │
              ▼
   Strategy 2: Prioritize Recent
   Keep last-hour items at full fidelity
   Drop items >24h old with low relevance score
   [ContextBreakingChain.applyLevel2()]
              │
   Still too big?
              │
              ▼
   Strategy 3: Smart Chunking
   Compress by content type:
   - Code: compress to 70%
   - Text: compress to 50%
   - Plan references: keep 100% (NEVER compressed)
   - Logs: compress to 40%
   [ContextBreakingChain.applyLevel3()]
              │
   Still too big?
              │
              ▼
   Strategy 4: Discard Low Relevance
   Drop bottom 30% by relevance score
   Replace with one-line placeholders
   [ContextBreakingChain.applyLevel4()]
              │
   Still too big?
              │
              ▼
   Strategy 5: Fresh Start
   Save full state to context_snapshots DB table
   Restart with only system prompt + current task + summary
   [ContextBreakingChain.applyLevel5()]
```

### Supporting Services

| Service | File | Purpose |
|---------|------|---------|
| **TokenBudgetTracker** | `src/core/token-budget-tracker.ts` | Content-type-aware token estimation (Code ~3.2 chars/token, Text ~4.0, JSON ~3.5, Markdown ~3.8). Per-call budget management with warning/critical thresholds. |
| **ContextFeeder** | `src/core/context-feeder.ts` | Relevance scoring (deterministic keyword matching), tiered loading (Mandatory→Important→Supplementary→Optional), deterministic compression (strip comments, collapse patterns, abbreviate JSON). |
| **ContextBreakingChain** | `src/core/context-breaking-chain.ts` | 5-level progressive context reduction. Applied automatically when budget is exceeded. Level 5 saves state to `context_snapshots` table. |
| **TaskDecompositionEngine** | `src/core/task-decomposition-engine.ts` | Rule-based task decomposition (no LLM calls). 6 built-in rules: ByFile, ByComponent, ByPropertyGroup, ByPhase, ByDependency, ByComplexity. |

### Integration Points

- **BaseAgent.buildMessages()** → delegates to `ContextFeeder.buildOptimizedMessages()` when available
- **BaseAgent.estimateTokens()** → delegates to `TokenBudgetTracker.estimateTokens()` when available
- **BaseAgent.processMessage()** → records usage via `TokenBudgetTracker.recordUsage()` after each LLM call
- **PlanningAgent.autoDecompose()** → tries `TaskDecompositionEngine.decompose()` first, LLM fallback only if no rule matches
- **extension.ts** → creates all services and injects into all agents during activation

### Per-Agent Context Limits

Different agents have different context needs. These are configured in `.coe/config.json`:

| Agent | Legacy Limit | Actual Budget | Why |
|-------|-------------|---------------|-----|
| Verification | 4,000 tokens | ~27,200 input tokens* | Only needs task + criteria + test results |
| Answer Agent | 5,000 tokens | ~27,200 input tokens* | Needs question + plan context + history |
| Planning | 5,000 tokens | ~27,200 input tokens* | Needs requirements + existing structure |
| Coding (external) | 5,000 tokens | ~27,200 input tokens* | Gets one task at a time with focused context |
| Custom Agents | 4,000 tokens | ~27,200 input tokens* | Configurable, kept small for simple models |

\* With TokenBudgetTracker: 32,768 context window - 4,096 reserved output - 5% buffer ≈ 27,238 input tokens available per call. Legacy limits used as max output tokens in `llm.chat()`.

### Per-LLM Configuration

Different AI models have different capabilities. Model profiles are registered in `TokenBudgetTracker` with content-type-aware token ratios:

| Model Type | Context Window | Max Output | Token Ratios |
|-----------|---------------|------------|-------------|
| Local 14B (ministral-3-14b) | 32,768 tokens | 4,096 tokens | Code: 3.2, Text: 4.0, JSON: 3.5 chars/token |
| Additional models | Configurable via `config.models` | Configurable | Uses same default ratios |

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

> **👤 User View**: COE is designed to keep working even when things go wrong. If your internet drops, COE uses cached data and queues work until you're back online. If the AI gives a bad response, COE retries with a different approach. If the AI gets stuck in a loop (repeating itself), COE detects it and breaks out automatically. You'll see notifications when recovery actions happen, but you rarely need to intervene.

> **🔧 Developer View**: Error recovery is implemented across `LLMService` (retry logic, queue management), `ContextBreakingChain` (progressive context reduction), and `BossAgent` (loop detection, health checks). The `offline-cache` directory stores payloads for 7 days. Loop detection runs every 20 LLM calls. All recovery events are logged to the audit trail via `EventBus`.

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

Custom agents (user-created specialists) have additional safety layers because they run user-defined logic on top of AI inference. These are the most security-sensitive components in COE because their behavior is partially user-controlled.

> **👤 User View**: Custom agents you create are sandboxed — they can never write files, execute commands, or access the network (unless you explicitly enable network access). They have strict time and resource limits to prevent runaway behavior. Every action a custom agent takes is logged, so you can always see exactly what it did and why. If a custom agent misbehaves (gets stuck, uses too many resources, or produces incoherent output), COE automatically stops it and notifies you.

> **🔧 Developer View**: Custom agent execution is handled by `CustomAgentService` with `BaseAgent` providing the LLM interface. The hardlock protections are enforced at the service level — they cannot be overridden by YAML config, agent prompts, or any runtime configuration. Runaway prevention is implemented via `setTimeout` wrappers and call counters in the execution loop. The audit trail is written to the `custom_agent_audit` table after each goal completion.

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

### Ghost Tickets — IMPLEMENTED (v2.0)

When a task is blocked by an unanswered question:
1. Original ticket marked "Blocked", `blocking_ticket_id` set
2. A "Ghost Ticket" is auto-created: `is_ghost = true`, `priority = P1`, linked to original
3. Ghost Ticket enters user communication popup queue
4. User answers → Clarity Agent scores → score >= 85 → Ghost resolved → Original unblocks
5. **3-Strike Dismiss Rule**: Dismiss 1-2 → re-queued after 30 minutes. Dismiss 3 → AI proceeds with best assumption, decision logged.

### Ticket Auto-Processing Safety — IMPLEMENTED (v2.0)

The `TicketProcessorService` enforces multiple safety layers:

| Guard | Rule |
|-------|------|
| **Dual queues** | Boss queue never blocked by main queue processing |
| **AI level gating** | `manual` mode never auto-processes; `suggestions` leaves in review |
| **Max 10 active tickets** | P1 can bump P3 to pending when at limit |
| **Tiered retry** | Auto-retry 3x → Boss classifies severity → minor: keep retrying → major: escalate |
| **Phase gates** | No manual override — system checks explicit criteria before advancing |
| **Idle watchdog** | 5-min idle timeout triggers Boss AI health check |
| **Acceptance criteria** | Auto-generated per deliverable type, verified on resolution |

### Decision Memory Deduplication — IMPLEMENTED (v2.0)

The `DecisionMemoryAgent` prevents duplicate questions and detects conflicts:

- **Before any question reaches the user**: keyword fast path + LLM semantic comparison against `user_decisions` table
- **Exact match** (confidence > 0.8): auto-answer, skip queue entirely
- **Similar match**: show past answer context in popup
- **Conflict detection**: when new answer contradicts active decision → conflict panel (Keep New / Keep Previous / Update Both)
- **Stale question filtering**: when design/plan regenerated, auto-dismiss questions referencing deleted pages/components

### Phase Gate Safety — IMPLEMENTED (v2.0)

Each of the 8 execution phases has explicit gate criteria checked by `checkPhaseGate()`. **No manual override** — the system drives progression. Key safety properties:

- Design cannot advance to coding until QA score >= threshold AND no critical gaps AND all drafts handled
- Coding cannot complete until all tasks verified — no skipping
- Design updates (features branch merge) trigger automatic impact analysis with rework tickets
- Boss AI validates gate criteria on every phase transition

---

## Security

> **👤 User View**: COE takes security seriously even though it runs locally on your machine. Your GitHub tokens are stored in your operating system's encrypted keychain (the same place your browser stores passwords), not in plain text files. All data stays on your machine — nothing is sent to external servers. If COE detects you're about to store something sensitive (like an API key) in a ticket, it will warn you first.

> **🔧 Developer View**: Security is enforced at 6 layers: authentication (VS Code Secrets API), data at rest (MVP: plaintext SQLite, post-MVP: SQLCipher), input validation (OWASP-compliant), network (HTTPS for GitHub, stdio for MCP), AI safety (prompt injection prevention), and ethics (FreedomGuard_AI). All security events are logged to the audit trail. See `SecurityManager` in `src/core/security-manager.ts`.

### Authentication & Token Management

#### GitHub OAuth Tokens

**Storage**: VS Code Secrets API (`context.secrets`) — encrypted at rest using the OS-level keychain (macOS Keychain, Windows Credential Manager, Linux libsecret).

```typescript
// How COE stores and retrieves GitHub tokens — no plaintext files
await context.secrets.store('coe.github.token', userToken);  // Store
const token = await context.secrets.get('coe.github.token');  // Retrieve
await context.secrets.delete('coe.github.token');              // Revoke
```

**Token Scopes Required**:

| Scope | Purpose |
|-------|---------|
| `repo` | Read/write issues and PRs for ticket sync |
| `read:user` | User info for commit attributions |

**Rotation Policy**:
- MVP: No automatic rotation — user must manually re-authenticate
- Post-MVP: Prompt user to rotate tokens every 90 days with a non-blocking notification
- Revocation: User can revoke at any time via GitHub Settings → Developer Settings → Personal Access Tokens

#### Copilot API Credentials

COE does **not** store or manage Copilot tokens directly. It relies on the GitHub Copilot extension's existing authentication flow. All MCP calls to Copilot assume an already-authenticated context.

### Data at Rest Protection

#### SQLite Database Security

**MVP State**: **Plaintext storage** (known limitation)

**Justification**:
- MVP is local-only (no network exposure of database)
- All data originates from user's own repositories (user owns data)
- Complexity vs. value trade-off justified for initial release
- Database file permissions set to user-only (chmod 600)

**Post-MVP Roadmap**: Integrate SQLCipher for transparent database encryption. Encryption key stored in OS keychain via `context.secrets`. Migration script handles upgrade from plaintext to encrypted DB.

> ⚠️ **MVP Warning**: Ticket and task data stored in plaintext SQLite. Do not store sensitive credentials, API keys, or PII in ticket content. Post-MVP will add full encryption.

#### Sensitive Data Detection

COE scans all ticket content for potential sensitive data using heuristic pattern matching before storage:

| Pattern Type | Detection Method | Example Match |
|-------------|-----------------|---------------|
| API Keys | Regex: key/token/secret followed by 16+ char value | `api_key = "sk-abc123..."` |
| Email Addresses | RFC-compliant email regex | `user@example.com` |
| Phone Numbers | US phone number pattern | `+1-555-123-4567` |
| Credit Cards | 16-digit grouped pattern | `4242-4242-4242-4242` |
| SSH Keys | `-----BEGIN RSA PRIVATE KEY-----` header | SSH private key preamble |
| AWS Keys | `AKIA` prefix + 16 uppercase alphanumeric | `AKIA1234ABCD5678` |

**User Flow**: If sensitive data detected → modal warning: "This content may contain sensitive data (API key detected). Are you sure you want to store it?" → \[Continue\] \[Edit Content\] \[Cancel\]. If user proceeds, `has_sensitive_data` flag is set on the ticket for audit trail.

### Input Validation & Sanitization (OWASP-Compliant)

All user inputs and external data (GitHub issues, MCP responses, AI-generated content) are validated and sanitized before processing. COE follows OWASP Top 10 2021 guidelines.

#### Rule 1: SQL Injection Prevention

**Method**: Parameterized queries ONLY — never string concatenation.

```typescript
// ✅ SAFE — parameterized
const ticket = await db.get('SELECT * FROM tickets WHERE id = ?', [ticketId]);

// ❌ UNSAFE — vulnerable to injection (never do this)
const ticket = await db.get(`SELECT * FROM tickets WHERE id = ${ticketId}`);
```

**Enforcement**: All `DatabaseService` methods use parameterized queries. Code review checklist includes SQL injection check.

#### Rule 2: XSS Prevention

**Method**: Escape all HTML entities before rendering in webviews or TreeViews.

```typescript
function sanitizeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;').replace(/\//g, '&#x2F;');
}
```

Additionally, VS Code's Content Security Policy (CSP) blocks inline scripts in webviews by default.

#### Rule 3: MCP Payload Validation

**Method**: All MCP tool payloads are validated against JSON schemas before processing. Invalid payloads return error code `-32602` (Invalid params).

**Validated fields**: `question` (max 500 chars), `context` (max 2000 chars), `priority` (enum: P1/P2/P3), `taskId` (must exist in database).

#### Rule 4: Command Injection Prevention

**Method**: Use `execFile` (no shell) instead of `exec`. Maintain allowlist of permitted commands.

```typescript
const ALLOWED_COMMANDS = ['git', 'npm', 'node'];

async function runSafeCommand(command: string, args: string[]) {
  if (!ALLOWED_COMMANDS.includes(command)) {
    throw new Error(`Command not allowed: ${command}`);
  }
  const { stdout } = await execFileAsync(command, args); // No shell = no injection
  return stdout;
}
```

#### Rule 5: Prompt Injection Prevention

**Method**: Use XML-like tag isolation to clearly demarcate user input from system instructions:

```typescript
function buildSafePrompt(userQuestion: string, codeContext: string): string {
  return `
<system>You are an Answer Team agent. Respond using only the provided context.</system>
<code_context>${sanitizeForPrompt(codeContext)}</code_context>
<user_question>${sanitizeForPrompt(userQuestion)}</user_question>
Provide a concise answer with sources.`;
}
```

The `sanitizeForPrompt()` function escapes closing tags to prevent injection.

#### Rule 6: Path Traversal Prevention

**Method**: Resolve all file paths and verify they remain within the workspace root. Reject any path containing `..` that escapes the boundary.

```typescript
function sanitizePath(userPath: string, baseDir: string): string {
  const resolved = path.resolve(baseDir, userPath);
  if (!resolved.startsWith(path.resolve(baseDir))) {
    throw new Error(`Path traversal attempt blocked: ${userPath}`);
  }
  return resolved;
}
```

#### Validation Enforcement Checklist

| Rule | Enforcement Point | Status |
|------|-------------------|--------|
| SQL parameterized queries | `DatabaseService` | ✅ Implemented |
| HTML sanitization | `sanitizeHtml()` before render | ✅ Implemented |
| MCP schema validation | `McpServer.handleToolCall()` | ✅ Implemented |
| No shell command injection | `execFile` only, allowlist | ✅ Implemented |
| Prompt tag isolation | `buildSafePrompt()` | ✅ Implemented |
| Path traversal check | `sanitizePath()` | ✅ Implemented |

### Data Retention & Archival

COE follows a structured data retention policy (all configurable):

| Data Type | Active Period | Archive After | Purge After |
|-----------|--------------|---------------|-------------|
| Active tickets | No limit | — | — |
| Resolved tickets | 90 days | Move to `tickets_archive` | 365 days |
| System logs | 30 days | — | 30 days |
| Evolution signals | 30 days rolling | — | 30 days |
| Context snapshots | 7 days | — | 7 days |
| RL dataset | No limit | — | Never (needed for training) |

**Archival Process**: Runs daily via `BossAgent.runHousekeeping()`. Resolved tickets older than 90 days are moved to `tickets_archive`. Archived tickets older than 365 days are permanently deleted. All archival actions logged.

### Access Control

#### File System Permissions

| Path | Permission | Purpose |
|------|-----------|---------|
| `.coe/` directory | `700` (user only) | All COE data isolated |
| `tickets.db` | `600` (user only) | Database not readable by others |
| Plan files | `644` (user read/write) | User can share plans |

**Enforcement**: Permissions are set on extension activation via `secureCoeDirectory()`.

#### Role-Based Access (Post-MVP)

MVP is single-user local. Post-MVP roles (if team features added):

| Role | Permissions |
|------|-------------|
| **Owner** | Full access — create/modify plans, tickets, settings |
| **Contributor** | Create tickets, view tasks, cannot modify plan |
| **Viewer** | Read-only access to dashboard |

### Network Security

#### GitHub API Calls

- **Protocol**: HTTPS/TLS enforced (GitHub API requirement)
- **Certificate Validation**: Enabled by default (Node.js validates TLS certificates)
- **No Bypass**: Extension does NOT support `rejectUnauthorized: false` — prevents MITM attacks
- **Rate Limiting**: Respects GitHub API rate limits (5000 requests/hour/token). Automatic backoff on 429 responses.

#### MCP Server

- **Transport**: HTTP + JSON-RPC on `localhost:3030` (local only)
- **Security**: Bound to `127.0.0.1` — cannot be accessed from other machines on the network
- **No Auth Required**: Local process communication only — same security boundary as the VS Code process
- **CORS**: Restricted to localhost origins

#### Threat Model

| Threat | Likelihood | Impact | Mitigation |
|--------|-----------|--------|------------|
| SQL injection via ticket content | Low | High | Parameterized queries only |
| XSS via AI-generated content | Medium | Medium | HTML sanitization + CSP |
| Prompt injection via user input | Medium | Medium | Tag isolation + sanitization |
| Path traversal via file operations | Low | High | Workspace boundary checking |
| Token theft via extension compromise | Low | High | OS keychain storage, no plaintext |
| MCP remote access | Very Low | High | localhost binding, no external listeners |
| Data leak via AI model | Low | Medium | Local model, no cloud transmission |
| Denial of service (runaway agent) | Medium | Low | Runtime limits, loop detection, timeouts |

### Secrets Management Best Practices

**Never store in extension code**: API keys, passwords, tokens, encryption keys

**Always use**:
- `context.secrets` for sensitive tokens (encrypted OS keychain)
- Environment variables for dev/test credentials (not committed to git)
- `.gitignore` entries for `.coe/` directory

### Security Checklist (MVP Gate)

| Check | Status |
|-------|--------|
| GitHub tokens in `context.secrets` | ✅ |
| SQLite file permissions 600 | ✅ |
| Parameterized SQL queries | ✅ |
| Webview content sanitized | ✅ |
| Sensitive data detection | ✅ |
| No credentials in git | ✅ |
| HTTPS for GitHub API | ✅ |
| MCP bound to localhost | ✅ |
| Data retention policy documented | ✅ |
| Plaintext DB warning in docs | ✅ |

### Known Security Limitations (MVP)

| Limitation | Risk Level | Mitigation | Roadmap |
|-----------|-----------|------------|---------|
| Plaintext SQLite | Low (local only) | File permissions + user warning | SQLCipher integration (Q2 2026) |
| No token rotation | Low | User can manually rotate | Auto-prompt every 90 days (Q2 2026) |
| Regex-based PII detection | Low | False positive/negative possible | ML-based detection (Q2 2026) |
| Single-user only | Very Low | No multi-user risk | RBAC if team features added (Q3 2026) |
| No immutable audit log | Low | SQLite-based audit trail exists | Append-only audit log (Q3 2026) |

### Post-MVP Security Roadmap

| Phase | Timeline | Deliverables |
|-------|----------|-------------|
| **Phase 1** | Q2 2026 | SQLCipher DB encryption, auto token rotation prompts, ML-based PII detection |
| **Phase 2** | Q3 2026 | Immutable audit logging, RBAC (if team features), security scan integration (Snyk/Dependabot) |
| **Phase 3** | Q4 2026 | SOC2 Type II (if enterprise), penetration testing, security incident response plan |

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

---

## FreedomGuard_AI Ethics Framework — IMPLEMENTED (v2.0)

The `EthicsEngine` provides a 6-module ethics evaluation pipeline with 4 sensitivity levels:

> **👤 User View**: FreedomGuard_AI is COE's built-in ethics engine. It automatically checks everything the AI generates for safety issues — harmful content, privacy violations, biased outputs, license problems, security vulnerabilities, and transparency. You can adjust the sensitivity level (Minimal, Standard, Strict, Maximum) in settings. Some content categories are always blocked regardless of sensitivity level. Every ethics check is logged so you can review what was flagged and why.

> **🔧 Developer View**: The ethics pipeline is implemented in `src/core/ethics-engine.ts`. Each module runs independently on AI outputs before they're returned to the user. The `TransparencyLogger` records every evaluation (pass/fail/block) with reasoning. Sensitivity levels map to threshold scores: Minimal (0.8), Standard (0.6), Strict (0.4), Maximum (0.2). Absolute blocks are hardcoded and cannot be overridden by configuration.

| Module | Purpose | Sensitivity Applies? |
|--------|---------|---------------------|
| **Content Safety** | Blocks harmful, illegal, or dangerous content generation | Absolute block (always on) |
| **Privacy Protection** | Detects and prevents PII exposure in generated code | Yes (threshold varies) |
| **Bias Detection** | Flags discriminatory patterns in AI outputs | Yes (threshold varies) |
| **Intellectual Property** | Checks for license compliance and attribution | Yes (threshold varies) |
| **Security Compliance** | Enforces secure coding practices (OWASP top 10) | Yes (threshold varies) |
| **Transparency** | Ensures all AI decisions are logged and auditable | Always on (no threshold) |

**Absolute Blocks**: Certain content categories are blocked regardless of sensitivity level — no override possible. All evaluations logged via `TransparencyLogger` for full audit trail.

---

## Context Configuration Reference

For reference, the context management system is configured via `.coe/config.json`. Key configurable values:

| Setting | Default | Range | What It Controls |
|---------|---------|-------|-----------------|
| `context.minLimit` | 3,500 tokens | 2,000-10,000 | Global floor — no agent gets less than this |
| `context.defaultLimit` | 5,000 tokens | 3,500-50,000 | Default per-agent context budget |
| `context.warningThreshold` | 0.7 (70%) | 0.5-0.9 | When to start context breaking chain |
| `context.criticalThreshold` | 0.9 (90%) | 0.8-0.99 | When to escalate to aggressive breaking |
| `context.recoveryMode` | `fresh_start` | `fresh_start` / `truncate` / `error` | What to do when all breaking strategies fail |
| `context.preloadWindow` | 10 min | 5-30 min | How long to keep preloaded context cached |
| `retry.maxAttempts` | 3 | 1-10 | Max retry attempts per LLM call |
| `retry.backoffBase` | 5 seconds | 1-30 | Exponential backoff base |
| `retry.maxDelay` | 60 seconds | 10-300 | Maximum retry delay |

---

## Cross-References

| Topic | Document |
|-------|----------|
| Architecture where these services live | [02-System-Architecture-and-Design](02-System-Architecture-and-Design.md) |
| Agents that use context management | [03-Agent-Teams-and-Roles](03-Agent-Teams-and-Roles.md) |
| Workflows that trigger safety systems | [04-Workflows-and-How-It-Works](04-Workflows-and-How-It-Works.md) |
| Evolution system that improves safety | [07-Program-Lifecycle-and-Evolution](07-Program-Lifecycle-and-Evolution.md) |
| Ethics user stories | [06-User-and-Developer-Stories](06-User-and-Developer-Stories.md) |
| Implementation tasks for safety features | [12-Agile-Stories-and-Tasks](12-Agile-Stories-and-Tasks.md) |
| Agent behavior rules (safety constraints) | [14-AI-Agent-Behavior-Spec](14-AI-Agent-Behavior-Spec.md) |
