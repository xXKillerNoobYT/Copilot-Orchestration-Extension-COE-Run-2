# Copilot Orchestration Extension (COE) — Vision & Goals

**Version**: 1.0  
**Date**: February 9, 2026

---

## What Is COE?

The **Copilot Orchestration Extension (COE)** is a VS Code extension that acts as an intelligent **planning, orchestration, and tracking layer** for software development. It sits between the human developer and AI coding agents (like GitHub Copilot), coordinating the entire workflow from idea to verified, working software.

Think of COE as a **project manager that never sleeps** — it breaks down your ideas into small tasks, hands them to AI coding agents one at a time, checks the results, and keeps everything on track.

---

## The Problem COE Solves

Today, developers using AI coding assistants face these challenges:

1. **Lack of structure** — AI assistants respond to ad-hoc prompts without a holistic plan
2. **Context overload** — Large projects overwhelm AI with too much information at once
3. **No verification** — AI writes code, but nobody systematically checks if it's correct
4. **No coordination** — Multiple aspects of a project (planning, coding, reviewing, answering questions) are all done in one unstructured conversation
5. **Progress blindness** — There's no clear picture of what's done, what's left, and what's broken
6. **Drift** — As projects evolve, the original plan and the actual code diverge silently

---

## The COE Solution

COE introduces a structured, multi-agent system where **specialized AI agents** each handle one aspect of development:

| Role | What It Does |
|------|-------------|
| **Planning** | Breaks requirements into small, atomic tasks |
| **Orchestration** | Routes tasks to the right agent at the right time |
| **Answering** | Provides context-aware answers when the coding AI is confused |
| **Verification** | Checks completed work against acceptance criteria |
| **Research** | Gathers information when deeper investigation is needed |
| **Custom Agents** | User-created specialists for domain-specific needs |

COE itself **never writes code**. It plans, tracks, verifies, and coordinates — the actual coding is done by 3rd-party AI agents like GitHub Copilot.

---

## Eight Core Goals

1. **Prepare perfect context for coding agents** — Generate detailed, up-to-date requirement documents and task descriptions that AI coding agents can read and act on accurately

2. **Decompose intelligently** — Break complex requirements into atomic tasks (15–45 minutes each) with clear, testable acceptance criteria

3. **Track comprehensively** — Maintain a real-time view of every task's status, every verification result, and every blocker across the entire project

4. **Detect problems automatically** — Flag outdated information, missing dependencies, and incomplete work before the coding agent encounters them

5. **Enable fresh restarts** — Support project-wide state resets so any developer (or AI) can pick up the project from any point

6. **Sync with coding agents** — Import completed files, compare them against the plan, and automatically create follow-up tasks for gaps

7. **Track verification states** — Mark tasks as checked, unchecked, or needs-re-check, and trigger re-validation when plans change

8. **Self-maintain** — Automatically create maintenance tasks when plans go stale, verification is incomplete, or new issues are discovered

---

## Core Philosophy

### "One Thing at a Time"

Every piece of work — planning, coding, testing, verification — is broken down to a level where:

- It can be described in **one clear sentence**
- It affects **one logical concern** (one feature, one endpoint, one component)
- It can be completed and verified **independently**
- It fits within one focused AI context window

This ensures quality, traceability, and the ability to roll back any individual change.

### Plan-Driven, Not Ad-Hoc

All tasks originate from plans, not random requests. Every change can be traced back to a requirement, a detected problem, or a user decision.

### Human in the Loop

The user always has final say over critical decisions. The system proposes; the human approves.

---

## What COE Is

- ✅ A planning engine that creates actionable task breakdowns
- ✅ A tracking system that shows real-time project progress
- ✅ A problem detector that catches issues early
- ✅ A context preparation tool that feeds AI agents exactly what they need
- ✅ A verification tracker that ensures quality
- ✅ A self-healing system that adapts as plans evolve

## What COE Is Not

- ❌ A code editor or code generator — that's the coding agent's job
- ❌ A testing framework — COE triggers and reports on tests, it doesn't run them
- ❌ A deployment tool — COE focuses on planning and tracking, not CI/CD
- ❌ A replacement for human judgment — it augments and proposes, never overrides

---

## Target Users

| Persona | How COE Helps Them |
|---------|-------------------|
| **Solo Developer** | Transforms vague ideas into structured plans, keeps AI coding agents focused and productive |
| **Tech Lead** | High-level project overview, risk identification, resource and timeline tracking |
| **QA/Tester** | Testable acceptance criteria for every task, verification workflow integration |
| **Product Owner** | Feature prioritization, progress tracking against goals, scope management |
| **AI Coding Agents** | Receives structured, machine-readable task definitions with clear context and constraints |
