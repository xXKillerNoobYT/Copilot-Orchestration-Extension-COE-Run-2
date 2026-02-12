# Directive: Self-Improvement / Evolution Workflow

## Goal
Detect patterns from runtime data and propose minimal improvements.

## Inputs
- Runtime signals: errors, failures, drift, feedback, token pressure
- Audit log data
- Verification results history
- Task completion metrics

## Process
1. Collect runtime signals continuously
2. Every 20 AI calls: run pattern detection
   - Group errors by signature
   - Score by impact (frequency × severity)
3. If pattern score exceeds threshold:
   a. Generate improvement proposal (minimal change)
   b. Check: does it affect P1 features?
   c. If P1: require human approval via ticket
   d. If not P1: auto-apply
4. Apply change
5. Monitor for 48 hours
6. Evaluate: did the problem improve?
   - Yes → positive reward, keep change
   - No → rollback, try different approach

## Pattern Detection Rules
| Signal | Threshold | Action |
|--------|-----------|--------|
| Same API call repeated | 3+ times in 24h | Propose fix |
| High failure rate | ≥30% fail rate | Investigation |
| Token pressure | ≥4 breaks/hour | Adjust context limits |
| Plan drift | >20% | Alert + proposal |
| User "not helpful" | ≥2/5 responses | Review agent template |

## What Can Be Improved
- Agent templates and prompts
- Context size limits
- Task decomposition rules
- Error handling patterns
- Custom agent goals and checklists
- Task time estimates
- Agent routing accuracy

## Tools/Scripts
- `src/agents/boss-agent.ts` — System health checks
- `src/core/database.ts` — Evolution log CRUD
- Pattern detection runs as part of orchestrator loop

## Outputs
- Evolution log entries (proposed, applied, rolled_back)
- Updated agent configs
- Audit trail of all changes

## Edge Cases
- If improvement makes things worse: auto-rollback after 48h
- If multiple improvements conflict: apply one at a time
- If user rejects proposal: record as "rejected" and don't re-propose same pattern
