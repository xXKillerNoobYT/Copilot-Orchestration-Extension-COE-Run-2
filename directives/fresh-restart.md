# Directive: Fresh Restart Workflow

## Goal
Reset the system to a clean, known state — useful for recovery or onboarding.

## Inputs
- User confirmation (warning dialog)

## Process
1. User clicks "Fresh Restart" command
2. Show warning: "This will reset in-progress tasks and agent states. Continue?"
3. If confirmed:
   a. Clear in-memory state (task queue, verification cache)
   b. Reset in-progress tasks back to "not_started"
   c. Reset all agents to "idle"
   d. Re-read all persistent data from disk (plans, config)
   e. Verify consistency:
      - All dependencies available?
      - No orphaned tasks?
      - Verification status valid?
   f. Display dashboard: "Fresh restart complete — N tasks ready"
   g. Show highest priority P1 tasks

## Tools/Scripts
- `src/agents/orchestrator.ts` → `freshRestart()` method
- `src/core/database.ts` → `clearInMemoryState()` method

## Outputs
- Clean system state
- Dashboard with ready task count
- Audit log entry

## Edge Cases
- If database is corrupted: attempt repair, if not possible inform user
- If no plans exist: just reset agents and show "Create a plan to get started"
