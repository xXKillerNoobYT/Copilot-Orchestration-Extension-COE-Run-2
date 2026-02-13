# Test Coverage Improvement Breakdown

**Last Updated**: February 1, 2026  
**Status**: Partial (54 untested files, atomicity issues)

**Original Request**: Increase branch coverage to 80%+, test 54 untested files, optimize test performance, add integration tests, ensure tests pass.
**Estimated**: 2–6+ hours (too large for single session)
**Split Into**: Atomic tasks (~20 min each)

## Atomic Tasks (~20 min each)

### Task 1: Fix failing branch coverage tests (compilation errors)
- **Time**: ~20 min
- **Files**: `tests/services.branchCoverage.test.ts`, `tests/orchestrator.branchCoverage.test.ts`
- **Concern**: Resolve TypeScript errors (private constructor, invalid enums, wrong method name)
- **Test**: `npm run test:once -- tests/services.branchCoverage.test.ts tests/orchestrator.branchCoverage.test.ts`
- **Acceptance**: Both suites compile and run (no TS errors)

### Task 2: Add targeted branch tests for bossRouter
- **Time**: ~20 min
- **Files**: `tests/services/bossRouter.branchCoverage.test.ts` (new)
- **Concern**: Cover conditional branches in `src/services/bossRouter.ts` (lines 66-154)
- **Test**: `npm run test:once -- tests/services/bossRouter.branchCoverage.test.ts`
- **Acceptance**: Branch coverage increases for bossRouter; no failures

### Task 3: Add targeted branch tests for programmingOrchestrator (part 1)
- **Time**: ~20 min
- **Files**: `tests/orchestrator/programmingOrchestrator.branchCoverage.part1.test.ts` (new)
- **Concern**: Cover early branches in `src/orchestrator/programmingOrchestrator.ts` (top-level guards)
- **Test**: `npm run test:once -- tests/orchestrator/programmingOrchestrator.branchCoverage.part1.test.ts`
- **Acceptance**: Branch coverage increases; tests pass

### Task 4: Add targeted branch tests for programmingOrchestrator (part 2)
- **Time**: ~20 min
- **Files**: `tests/orchestrator/programmingOrchestrator.branchCoverage.part2.test.ts` (new)
- **Concern**: Cover deeper branches in `src/orchestrator/programmingOrchestrator.ts` (queue/status helpers)
- **Test**: `npm run test:once -- tests/orchestrator/programmingOrchestrator.branchCoverage.part2.test.ts`
- **Acceptance**: Branch coverage increases; tests pass

### Task 5: Add tests for CoeTaskTreeProvider
- **Time**: ~20 min
- **Files**: `tests/tree/CoeTaskTreeProvider.test.ts`
- **Concern**: Cover tree provider branches in `src/tree/CoeTaskTreeProvider.ts`
- **Test**: `npm run test:once -- tests/tree/CoeTaskTreeProvider.test.ts`
- **Acceptance**: File has >=75% statements/branches

### Task 6: Add tests for completedTasksTreeProvider
- **Time**: ~20 min
- **Files**: `tests/ui/completedTasksTreeProvider.test.ts`
- **Concern**: Cover tree UI branches in `src/ui/completedTasksTreeProvider.ts`
- **Test**: `npm run test:once -- tests/ui/completedTasksTreeProvider.test.ts`
- **Acceptance**: File has >=75% statements/branches

### Task 7: Add tests for github/api.ts branches
- **Time**: ~20 min
- **Files**: `tests/github/api.branchCoverage.test.ts`
- **Concern**: Cover branches in `src/github/api.ts` (lines 68-103)
- **Test**: `npm run test:once -- tests/github/api.branchCoverage.test.ts`
- **Acceptance**: Branch coverage improves for api.ts

### Task 8: Add tests for utils/streamingLLM branches
- **Time**: ~20 min
- **Files**: `tests/utils/streamingLLM.branchCoverage.test.ts`
- **Concern**: Cover branches around timeouts/edge cases in `src/utils/streamingLLM.ts`
- **Test**: `npm run test:once -- tests/utils/streamingLLM.branchCoverage.test.ts`
- **Acceptance**: Branch coverage improves for streamingLLM.ts

### Task 9: Add integration test for MCP workflow
- **Time**: ~20 min
- **Files**: `tests/integration/mcpWorkflow.test.ts`
- **Concern**: End-to-end flow of `getNextTask` → `reportTaskStatus`
- **Test**: `npm run test:once -- tests/integration/mcpWorkflow.test.ts`
- **Acceptance**: Integration test passes consistently

### Task 10: Performance optimization pass for tests
- **Time**: ~20 min
- **Files**: Targeted test files with expensive setup
- **Concern**: Remove redundant setup, share fixtures, reduce per-test overhead
- **Test**: `npm run test:once`
- **Acceptance**: Suite runtime reduced (baseline recorded)

### Task 11: Run full suite and confirm 80% thresholds
- **Time**: ~20 min
- **Files**: None
- **Concern**: Validate coverage thresholds for statements/branches/functions/lines
- **Test**: `npm run test:once -- --coverage`
- **Acceptance**: Jest global coverage thresholds pass

## Execution Order
1. Task 1 → fix failing tests
2. Task 2 → bossRouter branches
3. Task 3 → orchestrator branches (part 1)
4. Task 4 → orchestrator branches (part 2)
5. Task 5 → CoeTaskTreeProvider tests
6. Task 6 → completedTasksTreeProvider tests
7. Task 7 → github/api.ts branches
8. Task 8 → streamingLLM branches
9. Task 9 → integration test
10. Task 10 → performance optimization
11. Task 11 → full suite + coverage validation

---

## Additional Tests: Fallback & Concurrency (High Priority)

### Task 12: Ticket DB fallback tests (SQLite → in-memory)
- **Time**: ~20 min
- **Files**: `tests/services/ticketDb.fallback.test.ts` (new)
- **Concern**: SQLite failure scenarios (SQLITE_BUSY, SQLITE_FULL, EACCES) trigger auto-switch to in-memory mode
- **Test Implementation**:
  ```typescript
  describe('Ticket DB Fallback', () => {
    it('should switch to in-memory on SQLITE_FULL error', async () => {
      // Simulate disk full
      jest.spyOn(ticketDb, 'create').mockRejectedValueOnce({code: 'SQLITE_FULL'});
      const ticket = await createTicketWithFallback({...mockTicket});
      expect(ticketStore).toBe(inMemoryStore);  // Verify fallback
    });
    
    it('should retry 3x on SQLITE_BUSY before fallback', async () => {
      // Simulate busy lock
      jest.spyOn(ticketDb, 'create')
        .mockRejectedValueOnce({code: 'SQLITE_BUSY'})
        .mockRejectedValueOnce({code: 'SQLITE_BUSY'})
        .mockResolvedValueOnce('TK-001');
      const ticket = await createTicketWithFallback({...mockTicket});
      expect(ticket).toBe('TK-001');  // Succeeds on 3rd retry
    });
  });
  ```
- **Acceptance**: All fallback scenarios covered, branch coverage ≥85%

### Task 13: Ticket DB concurrency tests (version conflicts)
- **Time**: ~15 min
- **Files**: `tests/services/ticketDb.concurrency.test.ts` (new)
- **Concern**: Multiple agents updating same ticket simultaneously (version control prevents data loss)
- **Test Implementation**:
  ```typescript
  describe('Ticket DB Concurrency', () => {
    it('should handle version conflict with retry', async () => {
      const ticket = await ticketDb.create({...mockTicket});
      
      // Simulate two agents updating simultaneously
      const update1 = updateTicket(ticket.id, {status: 'resolved'});
      const update2 = updateTicket(ticket.id, {priority: 1});
      
      // One should succeed, one should retry
      const results = await Promise.all([update1, update2]);
      expect(results.filter(r => r.ok).length).toBe(2);  // Both eventually succeed
    });
  });
  ```
- **Acceptance**: Concurrency tests pass, no "last write wins" data loss

---

## Coverage Gates & Enforcement

### Jest Configuration (package.json)
```json
{
  "jest": {
    "coverageThreshold": {
      "global": {
        "branches": 80,
        "functions": 80,
        "lines": 80,
        "statements": 80
      },
      "./src/services/ticketDb.ts": {
        "branches": 85,
        "functions": 90,
        "lines": 85,
        "statements": 85
      },
      "./src/services/orchestrator.ts": {
        "branches": 80,
        "functions": 85,
        "lines": 80,
        "statements": 80
      }
    }
  }
}
```

### Pre-Commit Hook (Husky)
```bash
#!/bin/sh
# .husky/pre-commit

npm run test:once -- --coverage --passWithNoTests
if [ $? -ne 0 ]; then
  echo "❌ Tests failed or coverage below 80%. Fix before committing."
  exit 1
fi
```

### CI/CD Gate (GitHub Actions)
```yaml
- name: Run Tests with Coverage
  run: npm run test:once -- --coverage
  
- name: Enforce 80% Coverage
  run: |
    if [ $(jq '.total.statements.pct' coverage/coverage-summary.json | awk '{print ($1 < 80)}') -eq 1 ]; then
      echo "Coverage below 80%"
      exit 1
    fi
```

---

## Success Criteria (Final Checklist)

- [ ] All 54 untested files have tests (≥1 test per file)
- [ ] Global coverage ≥80% (branches, functions, lines, statements)
- [ ] Ticket DB coverage ≥85% (critical path)
- [ ] Fallback tests cover all error scenarios (BUSY, FULL, EACCES)
- [ ] Concurrency tests prevent version conflicts
- [ ] All tasks ≤25 minutes (atomic)
- [ ] Jest coverage gates configured in package.json
- [ ] Pre-commit hook enforces coverage
- [ ] CI/CD pipeline blocks merges below 80%
- [ ] Test suite completes in <5 minutes

**Reference**: See `ticketdb-test-fixes-breakdown.md` for specific Ticket DB test implementations.
10. Task 10 → performance optimization
11. Task 11 → full suite + coverage gates
