# Ticket DB Test Failures Breakdown

**Last Updated**: February 1, 2026  
**Status**: Partial (Failing tests: init/persistence/locking/close)

**Original Request**: Fix TS spyOn getter errors and 7 failing TicketDatabase tests (SQLite persistence, file locking, close error expectations).
**Estimated**: ~60-90 minutes (too big for one 20-minute session)
**Split Into**: 4 atomic tasks (~15-20 minutes each)

## Atomic Tasks

### Task 1: Fix TS spyOn getter typing errors
- **Concern**: TypeScript error in `tests/ticketsDb.spec/TicketDatabase.getStats.web.spec.ts` for `jest.spyOn(..., 'useFallback', 'get')`.
- **Files**: `tests/ticketsDb.spec/TicketDatabase.getStats.web.spec.ts`
- **Outcome**: Test compiles with correct getter spying (no TS2345).
- **Verification**: `npm run test:once -- TicketDatabase.getStats.web.spec.ts` passes type-check.

### Task 2: Fix SQLite persistence test failures
- **Concern**: Failing persistence behavior in `tests/ticketDb.test.ts` (SQLite save/load).
- **Files**: `tests/ticketDb.test.ts` and relevant DB implementation under `src/`.
- **Outcome**: Persistence tests pass with expected DB write/read behavior.
- **Verification**: Run targeted tests for persistence suite.

### Task 3: Fix file locking test failures
- **Concern**: File locking tests failing in `tests/ticketDb.test.ts`.
- **Files**: `tests/ticketDb.test.ts` and relevant DB implementation under `src/`.
- **Outcome**: Locking behavior meets test expectations.
- **Verification**: Run targeted locking tests.

### Task 4: Fix close operation error expectations
- **Concern**: Close operations not throwing expected errors in `tests/ticketDb.test.ts`.
- **Files**: `tests/ticketDb.test.ts` and relevant DB implementation under `src/`.
- **Outcome**: Close error behavior aligned with tests.
- **Verification**: Run targeted close-operation tests.

## Execution Order
1. Task 1 → compile test file
2. Task 2 → persistence tests
3. Task 3 → locking tests
4. Task 4 → close operation tests
