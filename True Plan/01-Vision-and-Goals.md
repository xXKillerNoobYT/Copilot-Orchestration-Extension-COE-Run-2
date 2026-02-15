# Copilot Orchestration Extension (COE) — Vision & Goals

**Version**: 2.0  
**Last Updated**: February 14, 2026  
**Status**: ✅ Current  
**Depends On**: — (this is the foundational document)

---

## What Is COE?

The **Copilot Orchestration Extension (COE)** is a VS Code extension that acts as an intelligent **planning, orchestration, and tracking layer** for software development. It sits between the human developer and AI coding agents (like GitHub Copilot), coordinating the entire workflow from idea to verified, working software.

Think of COE as a **project manager that never sleeps** — it breaks down your ideas into small tasks, hands them to AI coding agents one at a time, checks the results, and keeps everything on track.

> **👤 User View**: You install COE in VS Code. You describe what you want to build. COE creates a structured plan, feeds tasks to your coding AI, answers the AI's questions, checks the work, and shows you progress — all in a sidebar you can monitor at a glance.

> **🔧 Developer View**: COE is a TypeScript VS Code extension using a 4-layer architecture (UI → Agent Routing → MCP Server → Core Services). It uses SQLite for persistence, a local LLM for classification and inference, and a JSON-RPC 2.0 MCP server on port 3030 for communication with external coding agents.

---

## The Problem COE Solves

Today, developers using AI coding assistants face these challenges:

| # | Problem | Impact | How Most People Cope |
|---|---------|--------|---------------------|
| 1 | **Lack of structure** — AI assistants respond to ad-hoc prompts without a holistic plan | Work gets done in random order, features are half-built, nothing ties together | Manually writing TODO lists or README files that quickly go stale |
| 2 | **Context overload** — Large projects overwhelm AI with too much information at once | AI hallucinates, forgets earlier instructions, or produces code that ignores existing architecture | Copy-pasting relevant code snippets into each prompt (tedious, error-prone) |
| 3 | **No verification** — AI writes code, but nobody systematically checks if it's correct | Bugs ship silently, acceptance criteria are never formally checked, quality degrades over time | Manual code review after every AI interaction (doesn't scale) |
| 4 | **No coordination** — Multiple aspects of a project (planning, coding, reviewing, answering questions) are all done in one unstructured conversation | Context bleeding between concerns, planning decisions lost in chat history | Starting new conversations frequently (losing valuable context each time) |
| 5 | **Progress blindness** — There's no clear picture of what's done, what's left, and what's broken | Developers lose track of project state, duplicate work or skip critical tasks | Maintaining external tracking tools (Jira, Trello) that disconnect from the AI workflow |
| 6 | **Drift** — As projects evolve, the original plan and the actual code diverge silently | AI continues building against outdated requirements, rework compounds, technical debt grows invisibly | Periodic manual audits (rarely done, always late) |

> **👤 User View**: Without COE, every AI coding session feels like starting from scratch. You have to re-explain your project, re-provide context, manually track progress, and hope the AI remembers what you told it yesterday. It's like having a brilliant employee with amnesia — they can code anything, but they can't remember the plan.

> **🔧 Developer View**: The fundamental issue is that AI coding agents are stateless and context-limited. They excel at single-turn tasks but fail at multi-step projects requiring persistent state, dependency tracking, verification loops, and adaptive planning. COE provides the stateful orchestration layer that LLMs are architecturally unable to provide themselves.

---

## The COE Solution

COE introduces a structured, multi-agent system where **specialized AI agents** each handle one aspect of development:

| Role | What It Does | When It Activates |
|------|-------------|-------------------|
| **Planning** | Breaks requirements into small, atomic tasks (15–45 min each) | When user creates a plan or describes a feature |
| **Orchestration** | Routes tasks and messages to the right agent at the right time | On every user message or coding agent request |
| **Answering** | Provides context-aware answers when the coding AI is confused | When coding agent calls `askQuestion` via MCP |
| **Verification** | Checks completed work against acceptance criteria | When coding agent calls `reportTaskDone` via MCP |
| **Research** | Gathers information when deeper investigation is needed | When Answer Agent confidence is below threshold |
| **Custom Agents** | User-created specialists for domain-specific needs | When message matches user-defined keywords |
| **Design QA** | Reviews program designs for completeness and quality | During the Designing phase of the 8-phase lifecycle |
| **Coding Agent Integration** | Generates structured prompts and coordinates with external AI | During the Coding phase |

COE itself **never writes code**. It plans, tracks, verifies, and coordinates — the actual coding is done by 3rd-party AI agents like GitHub Copilot.

> **👤 User View**: You tell COE what you want. COE figures out the plan, hands work to your coding AI piece by piece, and tells you when something needs your attention. You stay in control without needing to micromanage every AI interaction.

> **🔧 Developer View**: The system implements a multi-agent architecture where each agent extends `BaseAgent`, receives messages via the `Orchestrator`'s keyword-based intent classifier, makes LLM calls via `LLMService.chat()`, and returns structured `AgentResponse` objects. No agent directly performs side effects — all execution flows through the MCP bridge or `TestRunnerService`.

---

## Eight Core Goals

Each goal has a measurable success metric so progress can be objectively tracked:

| # | Goal | Description | Success Metric |
|---|------|-------------|---------------|
| 1 | **Prepare perfect context** | Generate detailed, up-to-date requirement documents and task descriptions that AI coding agents can read and act on accurately | ≥80% first-pass verification rate (coding agent gets it right without re-prompting) |
| 2 | **Decompose intelligently** | Break complex requirements into atomic tasks (15–45 minutes each) with clear, testable acceptance criteria | ≥95% of tasks complete within 45 minutes; 0% of tasks span multiple concerns |
| 3 | **Track comprehensively** | Maintain a real-time view of every task's status, every verification result, and every blocker across the entire project | Dashboard accuracy ≥99% (status reflects reality within 30 seconds of any change) |
| 4 | **Detect problems automatically** | Flag outdated information, missing dependencies, and incomplete work before the coding agent encounters them | ≥90% of blockers detected before coding agent hits them (pre-emptive detection rate) |
| 5 | **Enable fresh restarts** | Support project-wide state resets so any developer (or AI) can pick up the project from any point | Fresh restart completes in <10 seconds with zero data loss |
| 6 | **Sync with coding agents** | Import completed files, compare them against the plan, and automatically create follow-up tasks for gaps | 100% of completed files compared against acceptance criteria; 0% of gaps go undetected |
| 7 | **Track verification states** | Mark tasks as checked, unchecked, or needs-re-check, and trigger re-validation when plans change | 100% of plan changes trigger re-verification of affected tasks |
| 8 | **Self-maintain** | Automatically create maintenance tasks when plans go stale, verification is incomplete, or new issues are discovered | ≥1 self-generated improvement task per week; <5% error recurrence rate on known issues |

> **👤 User View**: These goals translate to a practical experience — your AI coding assistant works faster (Goal 1), stays focused (Goal 2), shows you real-time progress (Goal 3), warns you before things break (Goal 4), lets you restart cleanly (Goal 5), keeps plan and code in sync (Goal 6), re-checks work when plans change (Goal 7), and gets smarter over time (Goal 8).

> **🔧 Developer View**: Each goal maps to specific services — Goal 1: `ContextFeeder` + MCP `getNextTask`; Goal 2: `TaskDecompositionEngine` + `PlanningAgent`; Goal 3: `Database` + EventBus; Goal 4: `BossAgent` health checks; Goal 5: Fresh restart command; Goal 6: `FileWatcher` + `VerificationAgent`; Goal 7: plan drift detection in `EvolutionService`; Goal 8: `EvolutionService` pattern detection → UV tasks.

---

## Core Philosophy

### "One Thing at a Time" — The Bedrock Principle

Every piece of work — planning, coding, testing, verification — is broken down to a level where:

- It can be described in **one clear sentence**
- It affects **one logical concern** (one feature, one endpoint, one component)
- It can be completed and verified **independently**
- It fits within one focused AI context window (under ~2,500–3,000 tokens after breaking)

This ensures quality, traceability, and the ability to roll back any individual change.

#### Enforcement Levels

This isn't just a guideline — it's enforced at increasing levels of strictness:

| Level | Description | When Applied | Enforcement Mechanism |
|-------|-------------|--------------|----------------------|
| **Soft** | Recommendation | Early planning | Planning Team suggests small tasks |
| **Medium** | Guideline | Task decomposition | TaskDecompositionEngine rejects tasks >45 min or >1 concern |
| **Hard** | Rule | Execution phase | Orchestrator refuses to hand off multi-concern tasks to Coding AI |
| **Strict** | System Lock | P1 / critical modules | Boss AI blocks any non-atomic task attempt |

#### Good vs. Bad Task Granularity

| ❌ Bad (Too Big / Multi-Concern) | ✅ Good (Atomic / One Thing) |
|----------------------------------|-------------------------------|
| Implement full user authentication system | Create POST /auth/register endpoint with email + password |
| Build the entire To-Do List frontend | Create ToDoListItem component with checkbox + text display |
| Add AI-powered task suggestions | Implement getNextTaskSuggestion MCP tool call in task editor |
| Refactor the whole backend | Extract user service logic into new UserService class |

#### Atomicity Validation Checklist

Every task must pass ALL of these criteria before it's considered "ready":

- [ ] **Duration**: Can be completed in 15–25 minutes (max 45 for complex tasks)?
- [ ] **Independence**: Can be started and finished without waiting for unrelated tasks?
- [ ] **Single Concern**: Changes only ONE logical area (endpoint, component, function, config)?
- [ ] **Measurable AC**: Has ONE clear acceptance criterion that can be verified?
- [ ] **No External Blocks**: All dependencies already complete or explicitly noted?
- [ ] **Context Fit**: All required context (files, specs, APIs) fits in one session?
- [ ] **Clear Output**: Produces exactly ONE deliverable (file, test, config change)?
- [ ] **Rollback-Safe**: Can be reverted independently without breaking other work?

> **👤 User View**: You'll never see a task like "Build the authentication system" — instead, you'll see 6–8 small, focused tasks like "Create login endpoint", "Add password hashing", "Create JWT token generation", etc. Each one is clear enough that you can understand what it does at a glance and verify it in under 5 minutes.

> **🔧 Developer View**: The `TaskDecompositionEngine` in `src/core/task-decomposition-engine.ts` enforces this via 6 deterministic rules (ByFile, ByComponent, ByPropertyGroup, ByPhase, ByDependency, ByComplexity) with LLM fallback for ambiguous cases. Max 3 nesting levels. The Orchestrator prompt always includes: "You are only allowed to work on one atomic change at a time."

### Plan-Driven, Not Ad-Hoc

All tasks originate from plans, not random requests. Every change can be traced back to a requirement, a detected problem, or a user decision. This creates a complete audit trail from requirement → task → code → verification.

> **👤 User View**: Every task you see in the queue has a paper trail — you can always ask "Why is the AI working on this?" and get a clear answer linking back to the original requirement.

> **🔧 Developer View**: The `plan_reference` field on every task links back to the plan it originated from. `metadata.json` tracks version history with `changeType` and `requiresCodeSync` flags. The `TransparencyLogger` records every decision with full context.

### Human in the Loop

The user always has final say over critical decisions. The system proposes; the human approves.

- **P1 evolution proposals** → require explicit human approval before applying
- **Design changes** → require user sign-off before task generation
- **Ethics blocks** → surface to user with explanation and override option
- **Ambiguous questions** → escalate to user when AI confidence is below 40%

> **👤 User View**: COE will never silently make a decision that could break your project. When something important needs your input, you'll see a clear notification with the context you need to decide.

> **🔧 Developer View**: The approval system uses modals (`vscode.window.showInformationMessage` with action buttons) for immediate decisions and tickets for async decisions. The `DesignHardenerAgent` creates draft proposals that block phase advancement until user responds.

---

## What COE Is

- ✅ A **planning engine** that creates actionable task breakdowns from vague ideas
- ✅ A **tracking system** that shows real-time project progress at every level
- ✅ A **problem detector** that catches issues before the coding AI encounters them
- ✅ A **context preparation tool** that feeds AI agents exactly the right information at the right time
- ✅ A **verification tracker** that ensures every piece of work meets its acceptance criteria
- ✅ A **self-healing system** that detects error patterns and adapts its own behavior
- ✅ A **coordination layer** that manages the handoff between multiple specialized AI agents

## What COE Is Not

- ❌ **Not a code editor or code generator** — that's the coding agent's job. COE never writes a single line of application code
- ❌ **Not a testing framework** — COE triggers and reports on tests via `TestRunnerService`, but it doesn't define or run test suites
- ❌ **Not a deployment tool** — COE focuses on planning, tracking, and verification. CI/CD is out of scope
- ❌ **Not a replacement for human judgment** — it augments and proposes, never overrides. The human always has veto power
- ❌ **Not a general-purpose AI assistant** — COE is specifically designed for software development project management

---

## Competitive Positioning

### How COE Differs from Other AI Coding Tools

| Tool | What It Does | How COE Is Different |
|------|-------------|---------------------|
| **GitHub Copilot** | Inline code completion and chat | Copilot is the *executor* — COE is the *manager*. COE feeds Copilot structured tasks and verifies Copilot's output. They work together, not in competition |
| **Cursor** | AI-powered code editor with context | Cursor replaces the editor; COE sits alongside it. COE adds planning, decomposition, verification, and multi-agent coordination that Cursor doesn't have |
| **Windsurf (Codeium)** | AI coding assistant with flow mode | Similar to Cursor — editor-level AI. COE adds the project management layer (plans, tasks, verification, self-improvement) that flow mode lacks |
| **Devin (Cognition)** | Fully autonomous AI software engineer | Devin tries to do everything autonomously; COE deliberately separates planning from coding. COE's philosophy is that orchestration and execution should be independent for reliability |
| **Continue** | Open-source AI coding assistant | Continue focuses on IDE integration; COE focuses on the orchestration layer above the IDE. They're complementary, not competing |

> **👤 User View**: Think of COE not as a replacement for Copilot, but as Copilot's **boss**. It tells Copilot what to work on, in what order, with what context, and then checks Copilot's homework. You can use COE with any AI coding agent.

> **🔧 Developer View**: COE's architectural advantage is the separation of concerns: the orchestration layer (COE) is deterministic and stateful, while the execution layer (Copilot/Cursor/etc.) is probabilistic and stateless. This separation means reliability improvements in COE don't depend on improvements in the underlying LLM.

---

## v2.0 Vision Expansion

In v2.0, COE evolves from a task orchestrator into a full program designer:

| Capability | Description | Status |
|-----------|-------------|--------|
| **Visual Program Designer** | Drag-and-drop GUI builder with 5 component groups, canvas editor, properties panel, and code preview | 📋 Planned (Phase 2) |
| **Integrated Coding Agent** | Natural language → code generation with diff preview and approval workflow | ✅ Implemented |
| **Multi-Device Sync** | Sync plans, tasks, and settings across devices via Cloud, NAS, or P2P backends | 📋 Planned (Phase 4) |
| **FreedomGuard_AI Ethics** | Configurable ethics framework with 7 freedom modules, sensitivity levels, and transparency logging | ✅ Implemented |
| **Layout Templates** | Pre-built templates (Form, Tab View, Dashboard, Modal Window) for rapid UI prototyping | 📋 Planned (Phase 2) |
| **Code Export** | Export visual designs to React TSX, HTML, CSS, and JSON | 📋 Planned (Phase 2) |

→ See [Doc 11 — Program Designer PRD](11-Program-Designer-PRD.md) for full feature requirements.

---

## Target Users

| Persona | How COE Helps Them | Key Interactions |
|---------|-------------------|-----------------|
| **Solo Developer** | Transforms vague ideas into structured plans, keeps AI coding agents focused and productive | Planning Wizard, Task Queue, Verification Panel |
| **Tech Lead** | High-level project overview, risk identification, resource and timeline tracking | Dashboard, Agent Health, Priority Management |
| **QA / Tester** | Testable acceptance criteria for every task, verification workflow integration | Verification Panel, Test Results, Re-check Tracking |
| **Product Owner** | Feature prioritization, progress tracking against goals, scope management | Features list, Progress Dashboard, Scope controls |
| **AI Coding Agent** | Receives structured, machine-readable task definitions with clear context and constraints | MCP tools: `getNextTask`, `askQuestion`, `reportTaskDone` |
| **Developer Extending COE** | Clear architecture, documented APIs, custom agent builder, contribution guidelines | Architecture docs, MCP API reference, Custom Agent Builder |

> **👤 User View**: Whether you're a solo developer building a side project or a tech lead managing an AI-assisted team, COE adapts to your role. Solo developers interact primarily with the Planning Wizard and Task Queue. Tech leads use the Dashboard and Priority Management. Product owners focus on Features and Progress.

> **🔧 Developer View**: Each persona maps to specific VS Code views — `TreeDataProvider` instances for sidebar tabs, webview panels for detailed views, and command handlers for actions. The persona distinction primarily affects which UI surfaces a user gravitates toward, not the underlying data model.

---

## Long-Term Roadmap

| Horizon | Timeline | Focus | Key Milestones |
|---------|----------|-------|---------------|
| **Near-term** | Q1 2026 | Core platform stability | All P1 features implemented, ≥85% test coverage, MCP server stable, Evolution system operational |
| **Mid-term** | Q2–Q3 2026 | Visual designer + Sync | Canvas webview, component library, multi-device sync (Cloud backend), coding agent refinement |
| **Long-term** | Q4 2026 – Q2 2027 | Marketplace + Community | VS Code Marketplace publishing, community custom agents, plugin ecosystem, advanced NL-to-code |
| **Vision** | 2027+ | Autonomous development | Minimal-supervision project execution, cross-project learning, multi-LLM orchestration, team collaboration |

---

## Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|-----------|
| 1 | **LLM unreliability** — Local LLM produces inconsistent classifications or hallucinated answers | Medium | High | Two-stage classification (keyword + LLM), confidence thresholds, human escalation at <40% confidence |
| 2 | **Context overflow** — Tasks exceed model context window despite decomposition | Medium | High | 5-level Context Breaking Chain, TokenBudgetTracker with per-agent budgets, auto fresh start |
| 3 | **Token cost scaling** — Large projects generate too many LLM calls | Low | Medium | 5-minute response cache, keyword-first classification (avoids LLM for clear intents), batched evolution proposals |
| 4 | **Adoption friction** — Users find the system too complex to start with | Medium | High | Zero-config startup, adaptive Planning Wizard (15–55 min depending on complexity), guided onboarding |
| 5 | **Model size constraints** — System designed for 10–25GB local models; larger models may not fit user hardware | Medium | Medium | Architecture optimized for small models: short prompts, structured output, minimal multi-turn, fallback to keyword-only classification |

→ See [Doc 10 — AI Operating Principles](10-AI-Operating-Principles.md) for detailed small-model constraints.
