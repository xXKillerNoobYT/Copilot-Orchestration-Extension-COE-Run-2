# Copilot Orchestration Extension (COE) — True Plan

**Version**: 3.0  
**Last Updated**: February 14, 2026  
**Status**: ✅ Current  
**Maintainer**: Project Designer  

---

## What Is This?

This folder is the **single source of truth** for the Copilot Orchestration Extension (COE). It explains what the program is, how it works, what it does, and why every design decision was made — from both a **user's** and a **developer's** perspective.

The goal of COE is to guide powerful AI coding agents — like GitHub Copilot — to be more reliable, more intelligent, more context-aware, and more aligned with what the developer actually wants built.

COE achieves this by:
- **Creating structured plans** — fully scoped breakdowns with prioritized tasks, clear instructions, inputs/outputs, success criteria, and edge cases
- **Feeding tasks to coding agents one at a time** — with complete context, so the AI never has to guess or hallucinate
- **Asking intelligent questions** — and providing intelligent answers when the AI gets stuck
- **Verifying results** — checking that the code written matches the plan that was designed
- **Continuously self-improving** — learning from patterns, errors, and user feedback to get better over time

This is not just writing code — it's writing **the right code**, the code that follows the plan, achieves the goals, meets the success criteria, and handles the edge cases. COE takes AI coding projects to the next level.

---

## How to Read This Plan

These documents are designed to be read in a specific order. **Start with the foundations**, then move to specializations, then implementation details.

### Recommended Reading Order

**Foundation (Read First):**
1. **Doc 01** — Vision & Goals → Understand *what* COE is and *why* it exists
2. **Doc 02** — Architecture → Understand *how* it's built (4 layers, data flow, MCP API)
3. **Doc 03** — Agent Teams → Understand *who* does what (14 agents across 9 teams)
4. **Doc 04** — Workflows → Understand *when* things happen (10 workflows, step-by-step)

**Specializations (Read Based on Your Role):**
5. **Doc 05** — User Experience → For users and UI developers: every screen and interaction
6. **Doc 06** — User Stories → For product owners and QA: real-world scenarios and acceptance criteria
7. **Doc 07** — Lifecycle & Evolution → For architects: how the system grows and self-improves
8. **Doc 08** — Safety & Context → For security reviewers and reliability engineers: every safety system
9. **Doc 09** — Features → For product managers: complete feature catalog with implementation status
10. **Doc 10** — AI Operating Principles → For AI engineers: how the AI agents should think and behave

**Implementation (Read When Building):**
11. **Doc 11** — Program Designer PRD → For feature teams: full product requirements for v2.0
12. **Doc 12** — Agile Stories → For sprint planning: 38 user stories, 113 tasks, time estimates
13. **Doc 13** — Implementation Plan → For developers: TypeScript interfaces, DB schemas, API shapes
14. **Doc 14** — AI Agent Behavior Spec → For AI engineers: behavioral state machine, intent classification, ethics

### Audience Guide

| If You Are... | Start With | Then Read | You Can Skip |
|----------------|-----------|-----------|-------------|
| **A user of COE** | 01, 05, 06 | 04, 09 | 13, 14 (too technical) |
| **A developer extending COE** | 01, 02, 03 | 04, 08, 13, 14 | 11 (product-level) |
| **A product owner / manager** | 01, 06, 09, 12 | 05, 07 | 02, 13, 14 (too technical) |
| **An AI coding agent** | 03, 04, 14 | 08, 10 | 05, 06 (human-focused) |
| **A security reviewer** | 08 | 02, 13 | 06, 11 (non-security) |
| **A new contributor** | README (this file!) | 01 → 02 → 03 → 04 | Nothing — read everything |

---

## Document Index

| # | Document | Version | Status | Lines | What It Covers |
|---|----------|---------|--------|-------|---------------|
| 01 | [Vision & Goals](01-Vision-and-Goals.md) | v2.0 | ✅ Current | ~400 | What COE is, the problem it solves, 8 core goals with success metrics, target users, competitive positioning, core philosophy with enforcement levels, v2.0 vision, operating principles, long-term roadmap |
| 02 | [System Architecture & Design](02-System-Architecture-and-Design.md) | v3.0 | ✅ Current | ~800 | 4-layer architecture, data flow model, full MCP API reference with schemas, error code registry, deployment architecture, performance model, network architecture, design principles |
| 03 | [Agent Teams & Roles](03-Agent-Teams-and-Roles.md) | v3.0 | ✅ Current | ~1100 | All 14 agents, RACI handoff matrix, failure modes, tuning reference table, universal response schema, agent lifecycle, removed team history |
| 04 | [Workflows & How It Works](04-Workflows-and-How-It-Works.md) | v2.0 | ✅ Current | ~900 | 14 workflows with Mermaid diagrams, error/recovery paths, timing estimates, concurrent workflow rules, v2.0 workflows (designer, coding agent, sync, ethics) |
| 05 | [User Experience & Interface](05-User-Experience-and-Interface.md) | v2.0 | ✅ Current | ~700 | Sidebar layout, planning wizard (full adaptive logic), v2.0 UI specs, accessibility, interaction patterns, empty/error/loading states |
| 06 | [User & Developer Stories](06-User-and-Developer-Stories.md) | v2.0 | ✅ Current | ~500 | 5 personas, v2.0 stories (designer, coding agent, sync, ethics), acceptance criteria, onboarding flow, failure/recovery stories |
| 07 | [Program Lifecycle & Evolution](07-Program-Lifecycle-and-Evolution.md) | v3.0 | ✅ Current | ~600 | 3-stage/8-phase execution model, evolution detection algorithm, signal collection sources, phase state tracking, health metrics, deprecation process |
| 08 | [Context Management & Safety](08-Context-Management-and-Safety.md) | v2.0 | ✅ Current | ~1000 | Full security spec (auth, encryption, OWASP), context config with compression ratios, v2.0 safety, threat model (STRIDE), rate limiting, token management |
| 09 | [Features & Capabilities](09-Features-and-Capabilities.md) | v2.0 | ✅ Current | ~700 | 47+ features with expanded descriptions, dependency graph, version/release mapping, configuration reference per feature |
| 10 | [AI Operating Principles](10-AI-Operating-Principles.md) | v2.0 | ✅ Current | ~350 | 3-layer architecture philosophy, self-annealing loop, small model constraints, enforcement levels, tool-first principle, directive management |
| **11** | **[Program Designer PRD](11-Program-Designer-PRD.md)** | v3.0 | ✅ Current | ~1970 | Visual Program Designer: drag-and-drop GUI builder, 5 component groups, AI coding agent, multi-device sync, FreedomGuard_AI ethics, code export, testing strategy |
| **12** | **[Agile Stories & Tasks](12-Agile-Stories-and-Tasks.md)** | v3.0 | ✅ Current | ~1420 | 7 epics, 38 user stories with acceptance criteria, 113 developer tasks, epic dependency graph, status tracking, sprint implementation order |
| **13** | **[Implementation Plan](13-Implementation-Plan.md)** | v3.0 | ✅ Current | ~2710 | TypeScript interfaces, DB schema (10 tables), 6 new services, component-to-code mappings, sync protocol, AI agent architecture, 4-phase schedule, migration/rollback strategy |
| **14** | **[AI Agent Behavior Spec](14-AI-Agent-Behavior-Spec.md)** | v3.0 | ✅ Current | ~830 | 5-state behavioral machine (Mermaid), intent classification pipeline, code generation pipeline, ethics enforcement, prompt engineering guide, external agent coordination |

---

## Cross-Reference Matrix

This matrix shows which documents reference or depend on each other. Use it to understand how changes in one doc ripple to others.

| Doc | Depends On | Referenced By |
|-----|-----------|---------------|
| 01 Vision | — | All docs (foundational) |
| 02 Architecture | 01 | 03, 04, 05, 07, 08, 13, 14 |
| 03 Agents | 01, 02 | 04, 06, 07, 08, 09, 12, 14 |
| 04 Workflows | 02, 03 | 05, 06, 07 |
| 05 UX | 02, 04 | 06, 11 |
| 06 Stories | 03, 04, 05 | 12 |
| 07 Lifecycle | 02, 03 | 08, 09 |
| 08 Safety | 02, 03 | 07, 13, 14 |
| 09 Features | 03, 07, 08 | 12 |
| 10 Principles | 01 | 03, 08, 14 |
| 11 PRD | 02, 05 | 12, 13, 14 |
| 12 Agile | 06, 09, 11 | 13 |
| 13 Implementation | 02, 08, 11, 12 | 14 |
| 14 Agent Spec | 03, 08, 10, 13 | — |

---

## Quick Summary

**COE is a VS Code extension** that acts as an intelligent project manager between you and AI coding agents.

**You tell it what to build** → it creates a structured plan with prioritized tasks.

**AI coding agents (like Copilot) request tasks from COE** → COE feeds them one task at a time with full context.

**When the AI is confused, it asks COE** → specialized Answer agents provide evidence-based responses.

**When the AI finishes, COE verifies the work** → tests are run, results are compared against the plan.

**When things go wrong, COE adapts** → creates follow-up tasks, adjusts priorities, and learns from patterns.

**You stay in control** → approve critical decisions, review AI work, and steer priorities at any time.

---

## One-Sentence Summary

> COE is a plan-driven orchestration layer that breaks your project into atomic tasks, feeds them to AI coding agents one at a time, verifies the results, and continuously learns to do it better.

---

## Version History

| Version | Date | Major Changes |
|---------|------|--------------|
| v1.0 | February 9, 2026 | Initial True Plan: 9 documents covering vision, architecture, agents, workflows, UX, stories, lifecycle, safety, features |
| v1.1 | February 12, 2026 | Context Management system (4 services: TokenBudgetTracker, ContextFeeder, ContextBreakingChain, TaskDecompositionEngine) |
| v2.0 | February 12, 2026 | Visual Program Designer expansion: 5 new documents (10–14) covering PRD, agile stories, implementation plan, agent behavior spec, AI principles |
| v3.0 | February 14, 2026 | Full-detail expansion: standardized headers, User/Developer views throughout, adapted old plan reference detail, RACI matrix, security spec, MCP API reference, evolution mechanics, cross-reference matrix |

---

## v2.0 Update: Visual Program Designer (February 12, 2026)

Documents 11–14 define the major expansion from task orchestrator to full program designer:

- **Drag-and-Drop GUI Builder** with 5 component groups (Primitive Inputs, Containers, Logic Blocks, Data/Sync, Ethics/Rights)
- **Integrated AI Coding Agent** that generates code from visual designs, interprets natural language, and enforces ethical boundaries
- **Multi-Device Sync** via Cloud, NAS, or P2P with conflict resolution
- **FreedomGuard_AI Ethics Framework** with configurable freedom modules and transparency logging
- **Pre-built Layout Templates** (Form, Tab View, Dashboard, Modal Window)
- **Code Export** to React TSX, HTML, CSS, and JSON

---

## Old Plan Reference

The `More detail's and ideia old plan For reference only/` subfolder contains 65+ documents from earlier planning phases. These are **archived reference material** — the True Plan supersedes all of them. However, detailed technical content from those documents has been adapted and incorporated into this v3.0 expansion where applicable. Do not follow the old plan docs directly; they may contain outdated architecture decisions.
