# Task Cleanup Config Breakdown

**Last Updated**: February 1, 2026  
**Status**: Partial (Config cleanup tasks)

**Original Task**: Add taskCleanup options to .coe/config.json with defaults, validation, migration, and usage in cleanup flows.
**Estimated**: ~70-90 minutes (too big for a single 20-min session)
**Split Into**: 5 atomic tasks

## Atomic Tasks (~20 min each)

### Task 1: Add taskCleanup schema + defaults + migration
- **File**: `src/utils/fileConfig.ts`
- **Concern**: Add taskCleanup defaults, Zod schema, and migration from legacy `database.taskRetentionDays` when taskCleanup missing (keep legacy field).
- **Acceptance**:
  - Missing config created with `taskCleanup: { maxAgeHours: 168, maxCount: 100, enabled: true }`.
  - Invalid values fall back to defaults with warning.
  - If `database.taskRetentionDays` exists and taskCleanup missing, set taskCleanup.maxAgeHours = days*24 (keep legacy field).
- **Test**: Config load with missing/legacy field produces expected taskCleanup values.

### Task 2: Wire cleanup config into DB cleanup
- **File**: `src/db/ticketsDb.ts`
- **Concern**: Use FileConfigManager taskCleanup values, skip if disabled, log resolved config on startup.
- **Acceptance**:
  - `cleanupOldCompletedTasks` uses taskCleanup values.
  - When disabled, cleanup is skipped.
  - Startup log: `Using cleanup config: maxAgeHours=X, maxCount=Y, enabled=Z`.

### Task 3: Update cleanup command path
- **File**: `src/extension.ts`
- **Concern**: `coe.cleanupHistory` uses file config taskCleanup values, respects enabled flag, logs resolved values.
- **Acceptance**:
  - Command uses taskCleanup config (overrides VS Code settings).
  - Disabled config skips cleanup.
  - Logs resolved cleanup values.

### Task 4: Add config creation/validation tests
- **File**: `tests/utils/config.test.ts`
- **Concern**: Ensure missing config creates defaults and invalid values fall back; migration from legacy retention.
- **Acceptance**:
  - Missing config test asserts taskCleanup defaults.
  - Invalid values test asserts fallback to defaults + warning.
  - Legacy retention migration test asserts taskCleanup.maxAgeHours from days.

### Task 5: Add cleanup behavior tests
- **File**: `tests/ticketsDb.comprehensive.test.ts`
- **Concern**: Verify cleanup respects enabled flag and uses configured values.
- **Acceptance**:
  - Cleanup skipped when enabled=false.
  - Cleanup uses configured maxAgeHours/maxCount.

## Execution Order
1. Task 1 → Test → Commit
2. Task 2 → Test → Commit
3. Task 3 → Test → Commit
4. Task 4 → Test → Commit
5. Task 5 → Test → Commit
