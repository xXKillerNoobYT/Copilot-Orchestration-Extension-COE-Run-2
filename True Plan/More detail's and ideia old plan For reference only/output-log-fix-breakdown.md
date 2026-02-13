# COE Output Log & Warning Suppression Breakdown

**Last Updated**: February 1, 2026  
**Status**: Partial (Warning fixes, non-atomic tasks)

**Original Task**: Fix output log not working fully; suppress deprecations (punycode/SQLite experimental) + warnings.
**Estimated**: ~35-45 minutes (too large for one session)
**Split Into**: 3 atomic tasks (~15-20 minutes each)

## Atomic Tasks (~20 min each)

### Task 1: Add environment-based warning suppression in extension startup
- **Time**: ~15 min
- **File**: src/extension.ts
- **Concern**: Suppress Node.js deprecation warnings (punycode) and SQLite experimental flags via process.env
- **Changes**:
  - Add `process.env.NODE_NO_WARNINGS = '1';` at top of activate() for punycode suppression
  - Add `process.env.NODE_OPTIONS = '--no-warnings';` (alternative approach)
  - Comment explaining why (reduce log noise for users)
- **Acceptance Criteria**:
  - No punycode deprecation warnings appear in output
  - SQLite experimental warnings suppressed
  - Extension still activates normally

### Task 2: Enhance OutputChannel with log level filtering
- **Time**: ~20 min
- **File**: src/extension.ts
- **Concern**: Create enhanced output channel wrapper that filters logs by level (integrate with existing Logger utility)
- **Changes**:
  - Import `LogLevel` from `src/utils/logger.ts`
  - Create `logToOutput()` helper function that checks log level before calling `appendLine()`
  - Replace direct `orchestratorOutputChannel.appendLine()` calls with filtered version (or keep direct for critical logs)
  - Add VS Code setting `coe.logLevel` (default: 'info')
- **Acceptance Criteria**:
  - Info/debug messages filtered when logLevel = 'warn'
  - Error/warning messages always show
  - Setting persists across sessions

### Task 3: Add test for warning suppression verification
- **Time**: ~15 min
- **Files**: tests/extension.outputLog.test.ts (new)
- **Concern**: Verify warnings are suppressed and log filtering works
- **Changes**:
  - Mock process.env to simulate warning scenarios
  - Test that NODE_NO_WARNINGS is set during activation
  - Test log level filtering (mock appendLine, assert calls match level)
- **Acceptance Criteria**:
  - Test passes: NODE_NO_WARNINGS set
  - Test passes: debug messages not logged when level=warn
  - Test passes: error messages always logged

## Execution Order
1. Task 1 → Suppress warnings (immediate fix)
2. Task 2 → Add log filtering (enhancement)
3. Task 3 → Add tests (validation)

## Notes
- Use existing `Logger` utility (`src/utils/logger.ts`) for filtering logic
- Keep changes under 200 lines total
- No new dependencies
- Preserve existing log output for critical messages
