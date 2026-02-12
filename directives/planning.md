# Directive: Plan Creation Workflow

## Goal
Transform a user's project idea into a structured, dependency-aware, atomic task list.

## Inputs
- User's project description (text)
- Project scale selection (MVP / Small / Medium / Large / Enterprise)
- Focus area (Frontend / Backend / Full Stack / Custom)

## Process
1. User opens "Create New Plan" command
2. Planning Wizard asks triage questions (scale, focus, priorities)
3. Based on answers, generate follow-up questions
4. User completes all questions
5. Planning Agent receives full spec and generates:
   - `plan.json` — Tasks with priorities and dependencies
   - `tasks.json` — Detailed task breakdown
   - `plan.md` — Human-readable summary
6. Tasks are validated against atomicity checklist
7. Tasks added to priority queue
8. User is notified: "Plan ready: N tasks created"

## Tools/Scripts
- `src/agents/planning-agent.ts` — Main planning logic
- `src/core/database.ts` — Task and plan storage
- No external scripts needed (pure LLM + database)

## Outputs
- Plan record in SQLite
- Atomic tasks in task queue
- Audit log entry

## Edge Cases
- If LLM is offline: show error, ask user to write tasks manually
- If >100 tasks generated: flag for user review (may indicate scope creep)
- If circular dependencies detected: reject and re-plan
- If task >45 min after decomposition: flag for further breakdown

## Learned
- (Updated as issues are discovered)
