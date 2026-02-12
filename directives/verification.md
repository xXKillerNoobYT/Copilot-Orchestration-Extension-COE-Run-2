# Directive: Verification Workflow

## Goal
Verify that completed coding work matches the plan's acceptance criteria.

## Inputs
- Task ID of completed task
- Files modified by the coding agent
- Completion summary

## Process
1. Coding AI calls `reportTaskDone` via MCP
2. Orchestrator marks task as "pending_verification"
3. Wait 60 seconds for file stability (prevents checking mid-write)
4. Verification Agent reads completed files
5. Compare against task's acceptance criteria
6. Run automated tests (if configured)
7. For UI changes: check against design system
8. Report results: PASS, FAIL, or NEEDS_RECHECK
9. If PASS: mark task verified, unlock dependent tasks
10. If FAIL: create investigation follow-up task
11. If NEEDS_RECHECK: flag for manual review

## Tools/Scripts
- `src/agents/verification-agent.ts` — Verification logic
- `src/core/database.ts` — Result storage
- No external test runner integration yet (future: hook into npm test)

## Outputs
- Verification result in SQLite
- Task status update
- Follow-up tasks (if gaps found)
- Audit log entry

## Edge Cases
- If files are still being written: wait additional 30 seconds
- If acceptance criteria is vague: create clarification ticket
- If test runner is not configured: skip automated tests, note in results

## Triggers for Re-Check
- Plan or acceptance criteria updated after verification
- A dependency task fails
- Test suite updated
- Design system reference changed
- User manually flags for re-check
