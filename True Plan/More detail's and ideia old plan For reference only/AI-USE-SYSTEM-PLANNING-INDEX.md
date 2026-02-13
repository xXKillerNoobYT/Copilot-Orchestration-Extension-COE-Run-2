# AI Use System Planning – Complete Documentation Suite

**Created**: January 26, 2026  
**Phase**: Planning (No code implementation yet)  
**Status**: Ready for Development Team Handoff  
**Scope**: Multi-agent orchestration + ticket system + simple UI for GitHub Copilot  

---

## 📚 Documentation Structure

This suite provides **4 leveled documents** for different audiences:

### 1. 🎯 **Quick Reference Card** (Read First!)
**File**: `AI-USE-SYSTEM-QUICK-REFERENCE.md`  
**Length**: ~2 pages  
**Audience**: Developers starting implementation (beginners first)  
**Contains**:
- 60-second "what we're building" summary
- P1 tasks only (Ticket DB + Orchestrator routing)
- CRUD SQL schema ready to copy-paste
- Common mistakes to avoid
- File list to create/modify
- Test examples

**When to Use**: First thing developers read before diving into code.

---

### 2. 📊 **Architecture & Workflow Diagrams** (Visualize the System)
**File**: `AI-USE-SYSTEM-DIAGRAMS.md`  
**Length**: ~3 pages  
**Audience**: Architects, experienced devs, visual learners  
**Contains**:
- System architecture overview (ASCII diagram)
- 4 core workflows with visual flowcharts
- Database schema visualization
- Component integration map
- State machine diagram
- Consistency checklist

**When to Use**: When you need to understand how pieces fit together before coding.

---

### 3. 📋 **Incremental Implementation Plan** (Reference During Development)
**File**: `AI-USE-SYSTEM-INCREMENTAL-PLAN.md`  
**Length**: ~15 pages (comprehensive)  
**Audience**: Full development team, project managers  
**Contains**:
- Complete overview + philosophy
- Reuse of existing code (7 components)
- Agent roles & hierarchy (4 teams + Clarity Agent)
- Ticket system schema + CRUD operations
- 3 detailed workflows
- UI design (sidebar tabs + webview details)
- Integration points (8 integration types)
- **8 atomic implementation tasks** (P1 → P3, with AC + blockers + time estimates)
- Testing plan + manual test cases
- Reference links (VS Code API, LLM, SQLite, etc.)
- Timeline & rollout (3 phases, MVP Feb 15)

**When to Use**: Primary reference during development; answers "how do we implement X?"

---

### 4. 📖 **This Index** (You are here)
**File**: `AI-USE-SYSTEM-PLANNING-INDEX.md` (you're reading it!)  
**Purpose**: Navigation guide for all planning documents

---

## 🚀 Quick Start: Where to Begin

### For Beginners
1. **Start here**: Quick Reference Card (5 min read)
2. **Understand context**: Architecture Diagrams (10 min)
3. **Plan your work**: Read P1 tasks from Incremental Plan
4. **Code**: Pick Task 1 or Task 2 (start with 1)

### For Experienced Developers
1. **Context**: Skim Incremental Plan (Overview + Agents & Roles sections)
2. **Details**: Refer to Full Plan document for specific task acceptance criteria
3. **Visual reference**: Use Diagrams when designing integrations
4. **Checklist**: Follow "Integration Points" section before coding

### For Architects / PMs
1. **Vision**: Read Overview section in Incremental Plan
2. **Scope**: Review "Reuse of Existing Code" section (shows what exists)
3. **Timeline**: Check Phase breakdown (Plan section 📝 AI Use System Planning)
4. **Risk**: Review "🚫 Common Mistakes" in Quick Reference

---

## 👥 Audience Map

| Role | Document | Sections | Time | Freq |
|------|----------|----------|------|------|
| **Junior Dev (first-time)** | Quick Ref → Diagrams → Plan | P1 tasks, examples, avoid mistakes | 30 min | Once |
| **Senior Dev** | Plan sections 1-3, 6-7 | Overview, agents, workflows, integration | 45 min | Once |
| **QA Engineer** | Plan section 8 (tasks) + Testing | AC, test cases, manual procedures | 20 min | Per task |
| **Tech Lead** | Plan sections 1-2, 7-8 + timeline | Vision, reuse, tasks, schedule | 60 min | Once |
| **Product Manager** | Plan overview + section 8 | What we're building, timeline, risks | 30 min | Once |

---

## 🎯 Success Criteria (How We Know We're Done)

### Documentation Quality
- ✅ Beginners can onboard in <1 hour using these docs
- ✅ No ambiguity on P1 task acceptance criteria
- ✅ Configuration safety verified (read-only, fallback in place)
- ✅ All external links functional (VS Code API, LLM docs, etc.)

### Implementation Quality (After Code)
- ✅ Ticket DB + Orchestrator routing working (P1 done)
- ✅ No existing tests broken
- ✅ Config file never written to
- ✅ Fallback to in-memory Map if SQLite missing
- ✅ Manual test passes (create ticket → sidebar → data persists)

### Business Metrics
- ✅ MVP launch Feb 15, 2026 (all phases done)
- ✅ <20 bugs reported post-launch (good planning catches issues early)
- ✅ Copilot can request clarification via tickets (core value delivery)
- ✅ Verification Panel shows test results (feedback loop closes)

---

## 📌 Key Planning Decisions (Why We Chose This Path)

| Decision | Why | Alternative Rejected |
|----------|-----|----------------------|
| **Reuse existing task queue** | Avoids duplication; agents = just another job type | Create separate "agent queue" (confusion, code duplication) |
| **Ticket DB = SQLite** | Lightweight, embedded, deterministic; .coe/tickets.db is natural home | PostgreSQL (too heavy), in-memory only (data loss), Firebase (external dependency) |
| **Inactivity timeout from config** | Prevents local LLM hangs; read-only preserves user settings | Hard-code 60s (inflexible), auto-adjust (risky, changes user config), no timeout (hangs forever) |
| **Simple sidebar tabs (no React)** | VS Code tree views don't need React; follows existing pattern; fast to ship | Full React webview (overkill), custom HTML (accessibility issues), commands only (no visibility) |
| **Clarity Agent auto-scores replies** | Ensures consistent communication quality; LLM does scoring (not humans) | Manual review (slow), no scoring (ambiguity), external clarity service (slow + cost) |
| **60s file stability delay for tests** | Prevents race conditions; async file writes finish | No delay (flaky tests), 10s (still racy), 120s (slow feedback) |
| **Planning-only docs, no code** | Reduces risk of premature commits; allows full review + approval before coding | Start coding immediately (drift builds up, harder to change) |

---

## 🔄 How to Use These Docs During Development

### Phase 1: Planning → Code Prep (Jan 26 – Feb 1)
1. **Team reads** all docs (30 min–1 hour each)
2. **Discuss** architecture in team meeting
3. **Clarify** any ambiguities (ask, don't guess)
4. **Create GitHub Issues** from P1 tasks (use AC verbatim)
5. **Assign** tasks to developers

### Phase 2: P1 Implementation (Feb 1–5)
1. Pull up **Quick Reference** while coding
2. Refer to **Incremental Plan section 8** for AC
3. Use **Diagrams** to understand integration points
4. Run **manual tests** from Plan section
5. Update `Status/status-log.md` as you complete tasks

### Phase 3: P2/P3 Implementation (Feb 5–10)
1. Same process, but with P2/P3 tasks
2. Build on P1 foundation
3. Each new feature **extends** existing sidebar pattern

### Phase 4: Stabilization (Feb 10–15)
1. Bug fixes, performance tuning
2. Pre-launch review—check success criteria above
3. Finalize docs (add implementation notes to Plan)
4. Launch! 🚀

---

## ⚠️ Common Pitfalls & How This Plan Prevents Them

| Pitfall | Symptoms | How Plan Prevents |
|---------|----------|------------------|
| **Scope creep** | "Let's add this too!" + tasks balloon | P1/P2/P3 priority explicit; "don't do P3 before P1" rule in docs |
| **Config overwrites** | User settings mysteriously change | Plan explicitly warns: "Read-only timeout" + test checklist includes "config never written" |
| **DB crashes silently** | Extension dies if .coe/tickets.db missing | Plan requires fallback to `Map<string, Ticket>` + log warning |
| **LLM hangs forever** | Copilot waits indefinitely for response | Plan specifies streaming + inactivity timeout from config (never hard-code) |
| **Duplicated queue logic** | Two task queues, one for agents, one for users | Plan shows "reuse existing PriorityQueue with agent_type field" |
| **UI confusion** | Sidebar cluttered with new tabs | Plan limits to 2 new tabs (Agents + Tickets); extends existing pattern |
| **Test failures post-launch** | Old tests fail due to agent job type changes | Plan includes "integration checklist" + "no existing tests broken" AC |
| **Unclear AC** | Dev finishes "task" but PM says it's incomplete | Tasks in Plan have detailed AC with examples + test cases |
| **Knowledge loss** | Senior dev leaves, team can't understand decisions | Plan includes "Key Planning Decisions" section + architecture diagrams |

---

## 🔗 Connection to Existing COE Documentation

### How This Fits into COE Roadmap

```
Existing Completed (✅)          → New AI Use System (🆕)
├─ Task Queue System             → Reuse for agent jobs
├─ MCP Server (6 tools)          → Extend with 3 new tools
├─ LLM Config + Call             → Add streaming + timeout
├─ Sidebar (tasksTreeView)       → Add 2 new tabs
├─ PRD Generation                → Update with agent state
└─ Verification Team             → Integrate results into UI

         ↓
    All components connected via this plan
    
         ↓
    MVP Launch Feb 15, 2026
```

### Cross-References

| Reference Doc | Section | Why |
|---------------|---------|-----|
| **CONSOLIDATED-MASTER-PLAN.md** | Agent hierarchy | Defines Programming Orchestrator, Planning Team, etc. |
| **02-Agent-Role-Definitions.md** | Role specs | Detailed agent responsibilities (we summarize) |
| **05-MCP-API-Reference.md** | Tool contracts | MCP tools we extend (getNextTask, etc.) |
| **AI-Use-System-Complete.md** | Workflows | Diagrams we reference for context |
| **TICKET-SYSTEM-SPECIFICATION.md** | Schema | Complete ticket structure (we use subset) |
| **current-plan.md** | Foundation | Explains LLM loop, task queue, existing infrastructure |

---

## 📝 How to Update These Docs

### If Requirements Change
1. Update **Incremental Plan** section 8 (atomic tasks) first
2. Update **Quick Reference** P1 tasks accordingly
3. Update **Diagrams** if workflows affected
4. Note change in **Status/status-log.md** (audit trail)
5. Notify team before work starts

### If Blockers Discovered During Dev
1. Log in **Status/status-log.md** (and why)
2. Re-evaluate task dependencies in Incremental Plan
3. If scope must change, discuss with PM
4. Update "Blockers" field in task AC (Plan section 8)

### If Bugs Found Post-Implementation
1. Add to PRD.json testing notes
2. Reference in **Status/status-log.md**
3. Do **not** rewrite planning docs (keep as historical record)
4. Create new "Phase 2 Fixes" section if needed

---

## 🎓 Learning Resources (Embedded in Plan)

### For TypeScript Developers
- **Type safety**: All interfaces defined in plan's diagram section
- **Error handling**: Fallback patterns (in-memory Map) explained
- **Async/await**: Streaming pattern documented in Diagrams

### For VS Code Extension Developers
- **Tree views**: Pattern shown in Quick Reference (copy from tasksTreeView)
- **Webviews**: Reference to existing LLM config panel pattern
- **Commands**: How to register new commands (extension.ts example)

### For LLM Integration
- **Streaming**: Explained in Workflow 2 (blocker detection)
- **Timeout**: Detailed in Workflows section (config-driven)
- **Token management**: Inactivity timeout prevents hangs

### For Database Design
- **Schema**: Copy-paste ready SQL in Quick Reference
- **CRUD**: Function signatures defined in Plan section 4
- **Fallback**: In-memory `Map<string, Ticket>` pattern

---

## 🚦 Status Dashboard

### Plan Completeness
| Aspect | Status | Notes |
|--------|--------|-------|
| **Scope Definition** | ✅ Complete | Overview + user stories documented |
| **Reuse Analysis** | ✅ Complete | 7 existing components identified |
| **Architecture** | ✅ Complete | System diagram + workflows ready |
| **UI Design** | ✅ Complete | Sidebar layout + webview sketched |
| **Atomic Tasks** | ✅ Complete | 8 tasks with P1/P2/P3 + AC + blockers |
| **Integration Points** | ✅ Complete | 8 integration patterns identified |
| **Test Strategy** | ✅ Complete | Coverage targets + manual procedures |
| **Timeline** | ✅ Complete | 3 phases, MVP Feb 15 |

### Team Readiness
| Aspect | Status | Action |
|--------|--------|--------|
| **Documentation** | ✅ Ready | All 4 docs complete; peer review optional |
| **Team Alignment** | ⏳ Pending | Schedule kickoff after PM approval |
| **Tooling** | ✅ Ready | npm, TypeScript, Jest, SQLite all in place |
| **Risk Assessment** | ✅ Done | 9 pitfalls identified + prevention |
| **Environment** | ✅ Ready | Dev machine fully configured |

---

## ✅ Pre-Implementation Checklist

Before **any** code is written:

- [ ] All 4 planning docs reviewed by team
- [ ] P1 tasks converted to GitHub Issues (use AC verbatim)
- [ ] Developers understand: reuse queue, read-only config, fallback strategy
- [ ] QA knows manual test procedure (create ticket → sidebar → persist)
- [ ] PM approves timeline (3 phases, MVP Feb 15)
- [ ] Tech lead assigns first developer to Task 1 (Ticket DB)
- [ ] Slack/Discord channel created for team coordination

---

## 📞 Questions?

If unclear on **any** aspect, check these in order:

1. **"What should this component do?"** → Incremental Plan, section 8 (atomic tasks)
2. **"How do components interact?"** → Diagrams, section "Component Integration Map"
3. **"What's the database schema?"** → Quick Reference, SQL block (or Diagrams)
4. **"What about error handling?"** → Quick Reference, "Common Mistakes" section
5. **"When do I write/read config?"** → Search "config" in Incremental Plan (read-only)
6. **"How do I test this?"** → Incremental Plan, section 8 (each task has test cases)
7. **"What if X fails?"** → Look for "Fallback" in Diagrams or Quick Reference

**If still unclear**: Ask the team before guessing. Better to clarify now than rework later!

---

## 🎯 Final Thoughts

**These plans are:**
- ✅ Detailed enough to code from
- ✅ Simple enough for beginners
- ✅ Flexible enough to adapt as we learn
- ✅ Complete enough to prevent scope creep
- ✅ Clear enough to reduce rework

**Our job now:** Follow the P1 tasks, stay atomic, trust the process, ship on time.

**Let's build it.** 🚀

---

**Planning Complete**: January 26, 2026  
**Ready for Implementation**: January 27, 2026  
**Target MVP**: February 15, 2026  

---

## 📚 Document Checklist

- [x] **AI-USE-SYSTEM-QUICK-REFERENCE.md** - 2 pages, beginner-friendly, P1 tasks
- [x] **AI-USE-SYSTEM-DIAGRAMS.md** - 3 pages, architecture + workflows
- [x] **AI-USE-SYSTEM-INCREMENTAL-PLAN.md** - 15 pages, full reference
- [x] **AI-USE-SYSTEM-PLANNING-INDEX.md** (this file) - Navigation + summary

**Total planning suite**: ~23 pages, all formats, ready to ship to dev team.
