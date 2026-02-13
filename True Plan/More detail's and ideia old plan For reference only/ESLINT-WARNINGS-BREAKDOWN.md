# ESLint Warnings Fix Breakdown Plan

**Last Updated**: February 1, 2026  
**Status**: Partial (203 warnings, non-atomic tasks)

## Overview
- **Total Warnings**: 203 (0 errors)
- **Files Affected**: 30+ TypeScript files
- **Warning Types**:
  - `@typescript-eslint/no-unused-vars` (~80 warnings)
  - `@typescript-eslint/no-explicit-any` (~120 warnings)

## Strategy
Fix warnings in priority order:
1. **P1**: Unused variables (easier, lower impact)
2. **P2**: `any` types in core services/utilities
3. **P3**: `any` types in tests (can use more aggressive fixes)

## Atomic Tasks

### Task 1: Fix unused variables in agent files (~20 min)
**Files**:
- `src/agents/answerTeam.ts` (5 warnings)
- `src/agents/orchestrator.ts` (1 warning)
- `src/agents/planningTeam.ts` (3 warnings)
- `src/agents/verificationTeam.ts` (3 warnings)

**Action**: Use `_` prefix or remove unused parameters

### Task 2: Fix unused variables in database/diagnostic files (~20 min)
**Files**:
- `src/db/migrations.ts` (2 warnings)
- `src/db/ticketsDb.ts` (2 warnings)
- `src/diagnostics/coverageProvider.ts` (2 warnings)
- `src/diagnostics/skippedTestsProvider.ts` (2 warnings)

**Action**: Use `_` prefix or remove unused variables

### Task 3: Fix unused variables in extension.ts and core files (~20 min)
**Files**:
- `src/extension.ts` (5 warnings)
- `src/github/api.ts` (8 warnings)
- `src/github/issuesSync.ts` (1 warning)
- `src/github/webhooks.ts` (8 warnings)

**Action**: Use `_` prefix or remove unused parameters

### Task 4: Fix unused variables in remaining service files (~20 min)
**Files**:
- `src/orchestrator/logger.ts` (6 warnings)
- `src/orchestrator/programmingOrchestrator.ts` (8 warnings)
- `src/scripts/update-prd.ts` (1 warning)
- Various service utility files

**Action**: Use `_` prefix or remove unused variables

### Task 5: Add proper types for `any` in database layer (~25 min)
**Files**:
- `src/db/migrations.ts` (2 `any` warnings)
- `src/db/ticketsDb.ts` (9 `any` warnings)

**Action**: Replace with proper types or document with comments

### Task 6: Add proper types for `any` in core services (~25 min)
**Files**:
- `src/github/api.ts` (8 `any` warnings)
- `src/mcpServer/tools.ts` (6 `any` warnings)
- `src/utils/config.ts` (2 `any` warnings)
- `src/utils/logger.ts` (5 `any` warnings)

**Action**: Replace with proper types

### Task 7: Handle `any` types in orchestrator.ts (~20 min)
**Files**:
- `src/orchestrator/logger.ts` (6 `any` warnings)
- `src/orchestrator/programmingOrchestrator.ts` (7 `any` warnings)

**Action**: Replace with proper types

### Task 8: Fix `any` and unused vars in test files (~25 min)
**Files**:
- `src/github/__tests__/issuesSync.test.ts` (11 `any` warnings)
- `src/mcpServer/tools/__tests__/getNextTask.test.ts` (8 `any` warnings)
- `src/mcpServer/tools/__tests__/reportTaskStatus.test.ts` (3 `any` + 2 unused)
- `src/utils/__tests__/config.test.ts` (15 `any` + 1 unused)

**Action**: Aggressive fixes using proper mocking types

### Task 9: Final cleanup and verification (~15 min)
**Action**:
1. Run `npm run lint` to verify all warnings fixed
2. Run `npm run test:once` to ensure no test regressions
3. Verify no warnings remain

## Risk Assessment
- **Low Risk**: Unused variable fixes (just rename with `_`)
- **Medium Risk**: `any` type replacements (need proper type definitions)
- **High Risk**: None identified (linting-only fixes)

## Success Criteria
✅ All 203 warnings resolved
✅ `npm run lint` returns 0 warnings
✅ All tests pass (`npm run test:once`)
✅ No functional changes to code

