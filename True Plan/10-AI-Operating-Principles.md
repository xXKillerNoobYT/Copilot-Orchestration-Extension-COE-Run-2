# AI Operating Principles

**Version**: 2.0  
**Last Updated**: February 14, 2026  
**Status**: ✅ Current  
**Depends On**: [01 — Vision & Goals](01-Vision-and-Goals.md)

---

## Overview

This document defines the core operating principles for how AI agents within COE should think, act, and improve. These principles apply to every agent in the system — from the Orchestrator routing messages to custom agents executing domain-specific tasks.

The principles are not abstract guidelines — they are enforced by the architecture itself. The 3-layer separation, the self-annealing loop, the tool-first bias, and the small-model constraints all exist in code and configuration.

> **👤 User View**: These principles explain *why* the AI behaves the way it does. When you notice that COE always gives focused instructions, always checks its own work, and always asks before doing something risky — these principles are the reason.

> **🔧 Developer View**: These principles shape every design decision in the codebase — from prompt construction (`BaseAgent.buildMessages()`) to error handling (`ContextBreakingChain`) to the configuration system (`LLMService` timeout cascades). When adding new features, verify that they align with these principles.

---

## The 3-Layer Architecture Principle

COE separates concerns into three layers that maximize reliability:

```
┌─────────────────────────────────────────────────┐
│  Layer 1: DIRECTIVE (What to do)                │
│  Markdown SOPs in directives/                   │
│  Goals, inputs, tools, outputs, edge cases      │
│  Natural language instructions                  │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│  Layer 2: ORCHESTRATION (Decision making)       │
│  Agent routing layer (src/agents/)              │
│  Read directives, call services, handle errors  │
│  The intelligent glue between intent & action   │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│  Layer 3: EXECUTION (Doing the work)            │
│  Deterministic TypeScript in src/core/          │
│  Database, LLM client, file watcher, tests      │
│  Reliable, testable, fast                       │
└─────────────────────────────────────────────────┘
```

### Why This Separation Matters

LLMs are probabilistic — they might get it right 90% of the time. But at 90% accuracy per step, a 5-step workflow drops to **59% overall success**. The solution is to push as much complexity as possible into deterministic code (Layer 3), so the LLM layer (Layer 2) only makes high-level routing decisions where its probabilistic nature is acceptable.

| Layer | Deterministic? | Error Rate | Example |
|-------|---------------|------------|---------|
| **Directive** | Yes — static markdown | ~0% (human-written) | `directives/verification.md` describing how to verify tasks |
| **Orchestration** | Partially — LLM-assisted routing | ~5-10% (keyword filter + LLM) | Orchestrator classifying "help me plan this feature" → PlanningAgent |
| **Execution** | Yes — TypeScript code | ~0% (tested, deterministic) | `database.createTicket()` inserting a row into SQLite |

> **👤 User View**: This separation is why COE rarely makes mistakes. The AI only makes decisions about *what to do next* — the actual work (saving to database, running tests, managing files) is done by reliable, tested code that doesn't hallucinate.

> **🔧 Developer View**: When adding new functionality, always ask: "Can this be deterministic?" If yes, put it in `src/core/` as a service. Only route through agents when you genuinely need LLM reasoning (classification, natural language understanding, creative decomposition). The `TaskDecompositionEngine` is a perfect example — 6 deterministic rules with LLM fallback only when rules are insufficient.

---

## Operating Principles

### 1. Tool-First Bias: Check Before Creating

Before writing new code or creating a new script, always check what already exists:

- Check `src/core/` for existing services
- Check `src/agents/` for existing agents
- Check `directives/` for existing SOPs
- Check the MCP tool registry for existing tools

Only create new components if no existing one covers the need. This prevents duplication, reduces surface area for bugs, and keeps the codebase manageable for small models with limited context windows.

> **👤 User View**: When you ask COE to do something, it first checks if it already has a tool for that job — rather than trying to build something new every time. This is more reliable and faster.

> **🔧 Developer View**: In practice this means: don't create a new agent if an existing agent can handle the intent with a keyword addition. Don't create a new service if `Database` already has a method for it. Don't create a new MCP tool if an existing tool can be parameterized. The `KEYWORD_MAP` in `orchestrator.ts` is the first place to look when adding new capabilities.

### 2. Self-Annealing: Learn from Every Error

Errors are learning opportunities, not just failures. When something breaks, the system follows a structured recovery loop:

```
Error Occurs
    ↓
1. Diagnose — Read error message, identify root cause
    ↓
2. Fix — Correct the immediate issue
    ↓
3. Test — Verify the fix works
    ↓
4. Record — Log what was learned (pattern detection)
    ↓
5. Improve — Update the system to prevent recurrence
    ↓
System is now stronger than before
```

This applies at every level:
- **Agent level**: Failed classification → keyword map update → better routing next time
- **Service level**: Timeout → backoff adjustment → more resilient connections
- **System level**: Recurring errors → Evolution Service detects pattern → UV task auto-generated → fix applied → monitored for 48 hours

> **👤 User View**: When COE encounters a problem, it doesn't just crash or give up. It fixes itself, remembers what went wrong, and adjusts to avoid the same problem in the future. Over time, the system literally gets better at its job.

> **🔧 Developer View**: Self-annealing is implemented through the `EvolutionService` in `src/core/evolution-service.ts`. It monitors 7 signal sources (MCP tool calls, task executions, context breaking events, plan drifts, user feedback, RL rewards, coding agent delegations) and uses pattern detection to identify recurring issues. When a pattern exceeds the threshold (≥3 occurrences in 24 hours with P1+ impact), it generates a UV task proposal. → See [Doc 07 §Evolution Mechanics](07-Program-Lifecycle-and-Evolution.md) for the full detection algorithm.

### 3. Directive Management: Living Documents

Directives (`directives/*.md`) are SOPs — Standard Operating Procedures — written in markdown for agents to follow. They are **living documents** that improve over time:

- **When you discover an edge case** → update the directive that covers it
- **When you find a better approach** → update the directive to reflect it
- **When an API constraint is discovered** → add it to the relevant directive
- **Never delete directive content** without asking — directives are the institutional memory of the system

> **👤 User View**: Think of directives as the playbook that COE follows. As COE encounters new situations and learns from them, the playbook gets updated automatically, making future interactions smoother.

> **🔧 Developer View**: Directives live in the `directives/` folder. Current directives: `custom-agents.md`, `evolution.md`, `fresh-restart.md`, `github-sync.md`, `marketplace-publishing.md`, `mcp-protocol.md`, `plan-builder.md`, `planning.md`, `verification.md`. Agents reference these via `ContextFeeder` which loads relevant directive content into the LLM prompt based on the current task type.

### 4. Single-Turn Optimization: Do One Thing Well

Each LLM call should accomplish exactly one thing. Don't ask the model to classify, plan, and generate code in a single prompt. Instead:

- **Call 1**: Classify the intent (keyword scoring, then LLM if ambiguous)
- **Call 2**: Route to the appropriate agent
- **Call 3**: Agent processes with focused context
- **Call 4**: Return structured result

This keeps prompts short, reduces hallucination risk, and makes each step independently verifiable and cacheable.

> **👤 User View**: This is why COE responds quickly — each question gets a focused answer from the right specialist, rather than one AI trying to do everything at once.

> **🔧 Developer View**: The `Orchestrator.classifyIntent()` method implements this: first a keyword map lookup (zero LLM cost for clear intents), then an LLM classification call only for ambiguous messages. Each agent's `process()` method receives a single, focused prompt with relevant context already filtered by `ContextFeeder`. The `LLMService` 5-minute response cache prevents redundant calls.

---

## Small Language Model Constraints

COE is specifically designed to work with **small, local language models** — typically 10–25 GB models running on consumer hardware via LM Studio. This is a deliberate architectural decision for several reasons:

### Why Small Models?

| Reason | Explanation |
|--------|-------------|
| **Privacy** | No data leaves the developer's machine — all inference is local |
| **Cost** | Zero API costs — no per-token charges, no subscription needed |
| **Speed** | Local inference avoids network latency (important for real-time classification) |
| **Availability** | Works offline, no dependency on external services |
| **Control** | Developer chooses the model, controls the hardware, owns the data |

### Architectural Implications

Small models (8B–14B parameters) have real limitations that directly shaped COE's architecture:

| Constraint | Architectural Response |
|-----------|----------------------|
| **Limited context window** (4K–32K tokens) | 5-level Context Breaking Chain; per-agent token budgets; task decomposition to fit within one context window |
| **Weaker reasoning** (compared to GPT-4/Claude) | Keyword-first classification (avoids LLM for clear intents); structured output schemas; single-turn optimization (one task per call) |
| **Slower inference** (~10–50 tokens/sec) | Serial execution queue (max 5 queued); 5-minute response cache; keyword routing for instant decisions |
| **Higher hallucination rate** | Confidence thresholds (≥70% for answers, ≥85% for clarity); human escalation at <40%; verification step for all AI output |
| **Less reliable instruction following** | Explicit, narrow prompts; `stream: false` for classification calls; structured JSON response schemas via LM Studio settings |

### Model Configuration

COE's current default configuration:

```
Endpoint: http://192.168.1.205:1234/v1 (LM Studio on local network)
Model: mistralai/ministral-3-14b-reasoning
Context: 32,768 tokens (4,096 reserved for output)
Timeouts: startup 300s, stall 120s, total 900s
Queue: max 5 simultaneous requests, serial execution
Cache: 5-minute response TTL
```

> **👤 User View**: COE runs on your own machine using a local AI model. This means your code and plans never leave your computer, you don't pay per-token fees, and it works even when your internet is down. The tradeoff is that the local AI isn't as powerful as cloud models like GPT-4, which is why COE is designed to keep tasks small and focused.

> **🔧 Developer View**: The model configuration is in `src/core/llm-service.ts`. Never assume GPT-4-level capabilities. Always design prompts for the lowest common denominator model (8B parameter). Use keyword scoring before LLM calls (`KEYWORD_MAP` in `orchestrator.ts`). Always pass `stream: false` for classification and scoring calls. Use `AbortController` with timeout for all fetch calls. Detect `AbortError` by name (`error.name === 'AbortError'`), never by `instanceof`.

---

## The Self-Annealing Loop in Practice

Here's a concrete example of the self-annealing loop at work:

### Example: Token Limit Exceeded

```
1. Coding Agent calls getNextTask
2. MCP server collects context bundle (plan + files + dependencies)
3. Context exceeds agent's token budget (27,200 tokens)
   → ERROR: TOKEN_LIMIT_EXCEEDED

4. DIAGNOSE: ContextBreakingChain activated
   - Strategy 1: Summarize oldest 60% → still over limit
   - Strategy 2: Prioritize recent items → still over limit
   - Strategy 3: Content-type chunking (code→70%, text→50%) → fits!

5. FIX: Task delivered with compressed context bundle

6. TEST: Coding agent successfully receives and processes task

7. RECORD: EvolutionService logs pattern:
   - Pattern: "TOKEN_LIMIT_EXCEEDED on getNextTask, context_type=large_plan"
   - Count: This is the 4th occurrence this week
   - Impact: P1_BLOCKED (task delivery delayed)

8. IMPROVE: Pattern threshold exceeded (≥3 in 24h with P1 impact)
   - EvolutionService generates UV task proposal
   - Proposal: "Increase pre-compression for plan_ref content type from 1.0 to 0.8"
   - Boss AI verifies: projected reward > 0.3 → auto-apply (non-P1 change)
   - Applied → monitored for 48h → recurrence drops from 4/week to 0/week
   - Positive RL reward recorded

System is now stronger: this specific pattern won't recur.
```

> **👤 User View**: You might notice that early in a project, COE occasionally takes a moment to "think" before delivering a task. After a few days, this pause disappears entirely — the system learned the optimal context compression strategy for your project's size and adjusted itself automatically.

> **🔧 Developer View**: The full signal-to-improvement pipeline is: `EvolutionService.collectSignals()` → `PatternDetector.analyze()` → `ProposalGenerator.generate()` → `BossAgent.verify()` → apply via UV task → `PostVerifier.monitor(48h)` → RL reward. All signals are stored in SQLite with 30-day rolling retention. → See [Doc 07 §Evolution Mechanics](07-Program-Lifecycle-and-Evolution.md) for the complete algorithm.

---

## Summary

| Principle | One-Line Summary | Enforcement |
|-----------|-----------------|-------------|
| **3-Layer Architecture** | Separate what-to-do, decision-making, and execution | Architecture enforced: directives → agents → services |
| **Tool-First Bias** | Check existing tools before creating new ones | Code review convention; `KEYWORD_MAP` lookup |
| **Self-Annealing** | Every error makes the system stronger | `EvolutionService` pattern detection → UV tasks |
| **Living Directives** | SOPs improve continuously from real experience | `ContextFeeder` loads directives; evolution updates them |
| **Single-Turn Optimization** | One LLM call = one focused task | `Orchestrator` routing → focused agent `process()` |
| **Small Model Design** | Architecture assumes 10–25GB local models | Token budgets, keyword routing, structured output, short prompts |

**Be pragmatic. Be reliable. Self-anneal.**
