# AI Teams Documentation - Quick Reference Card

**Version**: v4.4-v5.5  
**Date**: January 21, 2026  

---

## 📍 START HERE

**Master Index**: [AI-TEAMS-DOCUMENTATION-INDEX.md](AI-TEAMS-DOCUMENTATION-INDEX.md)

**Transfer Summary**: [DOCUMENTATION-TRANSFER-SUMMARY.md](DOCUMENTATION-TRANSFER-SUMMARY.md)

---

## 🎯 Quick Find by Topic

| What You Need | Go To Document | Section |
|---------------|----------------|---------|
| **Planning wizard setup** | [Planning Wizard Spec](PLANNING-WIZARD-SPECIFICATION.md) | §1 Adaptive Paths |
| **Backend/AI project setup** | [Planning Wizard Spec](PLANNING-WIZARD-SPECIFICATION.md) | §3 Backend Focus |
| **Impact simulation** | [Planning Wizard Spec](PLANNING-WIZARD-SPECIFICATION.md) | §2 Real-Time Simulator |
| **Update existing plan** | [Plan Updating Process](PLAN-UPDATING-PROCESS.md) | All sections |
| **Atomic task breakdown** | [Modular Execution](MODULAR-EXECUTION-PHILOSOPHY.md) | §2 Breakdown Rules || **Answer Team triggers** | [Answer AI Team Spec](ANSWER-AI-TEAM-SPECIFICATION.md) | Standalone Triggers |
| **Answer Team YAML** | [Answer AI Team Spec](ANSWER-AI-TEAM-SPECIFICATION.md) | YAML Configuration || **Project timeline** | [Project Roadmap](PROJECT-ROADMAP-DETAILED.md) | Timeline Summary |
| **Phase details (1-6)** | [Project Roadmap](PROJECT-ROADMAP-DETAILED.md) | Phase sections |
| **Program birth to growth** | [Program Lifecycle](PROGRAM-LIFECYCLE-MODEL.md) | §2-3 Birth & Growth |
| **Self-improvement system** | [Evolution Phase](EVOLUTION-PHASE-DEEP-DIVE.md) | All sections |
| **Pattern detection** | [Evolution Phase](EVOLUTION-PHASE-DEEP-DIVE.md) | §2 Pattern Detection |
| **AI-human communication** | [Ticket System](TICKET-SYSTEM-SPECIFICATION.md) | All sections |
| **Clarity Agent setup** | [Ticket System](TICKET-SYSTEM-SPECIFICATION.md) | §2 Clarity Agent |
| **Ticket UI mockups** | [Ticket System](TICKET-SYSTEM-SPECIFICATION.md) | §9 UI Prototypes |

---

## 🔑 Key Concepts at a Glance

### Planning (v4.4-4.8)
- **Adaptive Paths**: Questions skip based on triage (backend users skip UI)
- **Real-Time Simulator**: <500ms impact preview (tasks, timeline, risks)
- **Backend/AI Mode**: Specialized questions for technical projects
- **Human + AI Hybrid**: Guardrails + AI suggestions + P1 lock-in

### Execution (v4.9)
- **One Thing at a Time**: Atomic tasks only (15-45 min, single concern)
- **P1 Lock**: Only one P1 task active at any time
- **5 Criteria**: Single responsibility, atomic completion, time box, verification closure, token safety

### Updating (v5.0)
- **5 Stages**: Trigger → Proposal → Validation → Application → Monitoring
- **Classification**: Minor (<5%) / Incremental (5-20%) / Major (>20%) / Rebuild
- **Human Gate**: Required for P1 or major changes

### Lifecycle (v5.2)
- **Birth**: Plan → First P1 working (1-4 weeks)
- **Growth**: P2/P3 addition (weeks 2-12+)
- **Evolution**: Pattern-driven improvements (week 3+)
- **Refinement**: Quality & velocity optimization (week 6+)

### Evolution (v5.3)
- **7 Signal Sources**: MCP calls, tasks, context breaks, drifts, feedback, RL, Copilot
- **Pattern Detection**: Groups by signature, scores by count × severity × impact / interval
- **Auto-Proposals**: LM generates minimal YAML updates (<300 tokens)
- **Rollback**: Auto-rollback if post-verify reward <0.2

### Tickets (v5.4-5.5)
- **No Chat**: All AI-human interaction via structured tickets
- **Clarity Agent**: Reviews replies, scores 0-100, iterates until ≥85
- **Max 5 Iterations**: Auto-escalate if clarity not achieved
- **P1 Immediate**: Notifications + stricter checks for P1 tickets

---

## ⏱️ Timeline Snapshot

| Week | Phase | Deliverable |
|------|-------|-------------|
| 3 | 1.1 | Triage & adaptive paths |
| 3-4 | 1.2 | Real-time simulator |
| 4 | 1.3 | Guardrails & review |
| 4-5 | 2.1 | Backend/AI questions |
| 5 | 2.2 | Atomic enforcement |
| 6-7 | 3.1-3.2 | MCP tools + Copilot |
| 8-9 | 4.1-4.2 | Updates + Evolution |
| 10-11 | 5.1-5.2 | Context + RL |
| 12-13 | 6 | Testing + Beta |
| 14 | Launch | Marketplace |

**Target Launch**: April 8-15, 2026

---

## 📊 Success Metrics Cheat Sheet

| Component | Key Metric | Target |
|-----------|------------|--------|
| Planning Wizard | Completion time | <25 min (backend) |
| Impact Simulator | Update speed | <500 ms |
| Atomic Tasks | Compliance | >95% |
| P1 Enforcement | Single-active | 100% |
| Plan Updates | Success rate | >95% |
| Evolution | Error recurrence | <5% |
| Tickets | Clarity iterations | <2.5 avg |
| Test Coverage | Overall | ≥90% |

---

## 🔗 Document Map (Visual)

```
AI Teams Documentation v4.4-v5.5
│
├─ 📘 Planning (v4.4-4.8)
│   └─ PLANNING-WIZARD-SPECIFICATION.md
│       ├─ Adaptive Paths
│       ├─ Real-Time Simulator
│       ├─ Backend/AI Focus
│       └─ Human + AI Builder
│
├─ ⚙️ Execution (v4.9)
│   └─ MODULAR-EXECUTION-PHILOSOPHY.md
│       ├─ One Thing at a Time
│       ├─ 5 Criteria
│       └─ Enforcement Levels
│
├─ 🔄 Updating (v5.0)
│   └─ PLAN-UPDATING-PROCESS.md
│       ├─ Trigger Classification
│       ├─ LM Proposals
│       └─ UV Validation
│
├─ 🗺️ Roadmap (v5.1)
│   └─ PROJECT-ROADMAP-DETAILED.md
│       ├─ 6 Phases
│       ├─ Sprint Breakdown
│       └─ Success Metrics
│
├─ 🌱 Lifecycle (v5.2)
│   └─ PROGRAM-LIFECYCLE-MODEL.md
│       ├─ Birth Phase
│       ├─ Growth Phase
│       ├─ Evolution Phase
│       └─ Refinement Phase
│
├─ 🧬 Evolution (v5.3)
│   └─ EVOLUTION-PHASE-DEEP-DIVE.md
│       ├─ Signal Collection
│       ├─ Pattern Detection
│       └─ Self-Improvement
│
└─ 💬 Tickets (v5.4-5.5)
    └─ TICKET-SYSTEM-SPECIFICATION.md
        ├─ Clarity Agent
        ├─ Ticket Lifecycle
        └─ UI Prototypes
```

---

## 🚀 Quick Start Paths

### I want to understand the planning flow
1. [Planning Wizard Specification](PLANNING-WIZARD-SPECIFICATION.md) §5 User Journey
2. [Planning Wizard Specification](PLANNING-WIZARD-SPECIFICATION.md) §1 Adaptive Paths

### I'm building backend/AI projects
1. [Planning Wizard Specification](PLANNING-WIZARD-SPECIFICATION.md) §3 Backend/AI Focus
2. [Planning Wizard Specification](PLANNING-WIZARD-SPECIFICATION.md) §4 Human + AI Builder

### I need to enforce atomic tasks
1. [Modular Execution Philosophy](MODULAR-EXECUTION-PHILOSOPHY.md) §2 Breakdown Rules
2. [Modular Execution Philosophy](MODULAR-EXECUTION-PHILOSOPHY.md) §3 Execution Flow

### I want to see the implementation timeline
1. [Project Roadmap](PROJECT-ROADMAP-DETAILED.md) Timeline Summary
2. [Project Roadmap](PROJECT-ROADMAP-DETAILED.md) Phase 1 (your current phase)

### I need the self-improvement system
1. [Evolution Phase Deep Dive](EVOLUTION-PHASE-DEEP-DIVE.md) §2 Pattern Detection
2. [Evolution Phase Deep Dive](EVOLUTION-PHASE-DEEP-DIVE.md) §5 Post-Execution Learning

### I'm designing the ticket UI
1. [Ticket System Specification](TICKET-SYSTEM-SPECIFICATION.md) §9 UI Prototypes
2. [Ticket System Specification](TICKET-SYSTEM-SPECIFICATION.md) §2 Clarity Agent

---

## 💡 Pro Tips

1. **Always start with the Index**: [AI-TEAMS-DOCUMENTATION-INDEX.md](AI-TEAMS-DOCUMENTATION-INDEX.md) has the full map
2. **Use Mermaid diagrams**: All flow charts are in both Mermaid and ASCII
3. **Check Integration Points**: Each doc lists what it depends on/connects to
4. **Follow Success Metrics**: Every component has measurable targets
5. **Respect Atomicity**: "One thing at a time" applies to reading too—focus on one doc per session

---

## 📞 Need Help?

| Question About | Check This |
|----------------|------------|
| "How do I...?" | Quick Find table above |
| "What's the timeline?" | [Project Roadmap](PROJECT-ROADMAP-DETAILED.md) |
| "Where do I start?" | Quick Start Paths above |
| "What's the big picture?" | [AI Teams Documentation Index](AI-TEAMS-DOCUMENTATION-INDEX.md) |
| "How do components fit together?" | Document Map above |

---

**Last Updated**: January 21, 2026  
**Document Count**: 8 core specs + 1 index + 1 summary = 10 total  
**Status**: ✅ Complete & Ready for Implementation
