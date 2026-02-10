# Copilot Orchestration Extension (COE) — True Plan

**Version**: 1.0  
**Date**: February 9, 2026

---

## What Is This?

This is the **clean, definitive plan** for the Copilot Orchestration Extension (COE). It explains what the program is, how it works, and what it does — without any code, implementation details, or technical debt tracking.

Use this folder as the single source of truth for understanding the project's goals, design, and behavior.

---

## Document Index

| # | Document | What It Covers |
|---|----------|---------------|
| 01 | [Vision & Goals](01-Vision-and-Goals.md) | What COE is, the problem it solves, the 8 core goals, target users, and core philosophy |
| 02 | [System Architecture & Design](02-System-Architecture-and-Design.md) | The four layers (UI, Agents, MCP, Services), data architecture, visual design system, and design principles |
| 03 | [Agent Teams & Roles](03-Agent-Teams-and-Roles.md) | Every AI agent in the system — Boss, Orchestrator, Planning, Answer, Verification, Research, Clarity, Custom Agents, and the external Coding AI |
| 04 | [Workflows & How It Works](04-Workflows-and-How-It-Works.md) | Step-by-step flowcharts for issue resolution, planning, Q&A, task decomposition, tickets, verification, fresh restart, and self-improvement |
| 05 | [User Experience & Interface](05-User-Experience-and-Interface.md) | Every screen and panel — sidebar layout, planning wizard, ticket view, verification panel, custom agent builder, next actions, and evolution dashboard |
| 06 | [User & Developer Stories](06-User-and-Developer-Stories.md) | Real-world scenarios told from the perspective of solo developers, tech leads, product owners, and even the AI coding agent itself |
| 07 | [Program Lifecycle & Evolution](07-Program-Lifecycle-and-Evolution.md) | The four overlapping lifecycle phases (Birth → Growth → Evolution → Refinement) and how the system learns and improves over time |
| 08 | [Context Management & Safety](08-Context-Management-and-Safety.md) | Token management, error recovery, offline support, loop detection, security, input validation, and performance guardrails |
| 09 | [Features & Capabilities](09-Features-and-Capabilities.md) | Complete list of 35 features across 7 categories, success metrics, and risk management |

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
