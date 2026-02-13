# TicketDb Test Fixes Breakdown

**Last Updated**: February 1, 2026  
**Status**: Partial (CRUD fixes, fallback tests missing)

**Original Task**: Fix failing `src/services/__tests__/ticketDb.test.ts` tests (init/close/persistence/locking).
**Estimated**: ~60–90 minutes (too big for one session)
**Split Into**: 4 atomic tasks (~15–20 min each)

## Atomic Tasks (~20 min each)

### Task 1: Investigate init + persistence failures
- **Time**: ~20 min
- **Files**: 
  - `src/services/__tests__/ticketDb.test.ts`
  - `src/services/ticketDb.ts` (or actual TicketDb implementation file)
- **Concern**: Align `init()` + persistence reload expectations (non-null db, persisted ticket)
- **Acceptance**:
  - `init()` test passes for SQLite initialization
  - `persists ticket after mock reload` test passes
- **Notes**:
  - Add warning behavior on fallback if requested (no hard failure)

### Task 2: Fix deleteTicket for non-existent
- **Time**: ~15 min
- **Files**:
  - `src/services/ticketDb.ts`
  - `src/services/__tests__/ticketDb.test.ts`
- **Concern**: Ensure `deleteTicket()` returns expected result for missing ticket
- **Acceptance**:
  - `should return false for non-existent ticket` test passes

### Task 3: Persistence across close/reopen
- **Time**: ~20 min
- **Files**:
  - `src/services/ticketDb.ts`
  - `src/services/__tests__/ticketDb.test.ts`
- **Concern**: Ensure tickets + replies persist across close/reopen
- **Acceptance**:
  - `should persist tickets across close/reopen` passes
  - `should persist replies across close/reopen` passes
- **Notes**:
  - Add warning when file lock prevents full close

### Task 4: Close behavior + post-close operations
- **Time**: ~20 min
- **Files**:
  - `src/services/ticketDb.ts`
  - `src/services/__tests__/ticketDb.test.ts`
- **Concern**: Graceful close with warnings; prevent operations after close
- **Acceptance**:
  - `releases file lock after close` passes (warn if lock remains)
  - `prevents operations after close` passes

## Execution Order
1. Task 1 → Test focused init/persistence
2. Task 2 → Test delete behavior
3. Task 3 → Test persistence across close/reopen
4. Task 4 → Test close warnings + post-close behavior

### Task 5: Test Ticket CRUD + TreeDataProvider Refresh Integration ⏱ 20 min
- **Time**: ~20 min
- **Files**: 
  - `src/services/__tests__/ticketDb.test.ts`
  - `src/ui/ticketsTreeProvider.test.ts` (new)
- **Concern**: When DB ticket changes, does sidebar refresh immediately?
- **Changes**:
  - Mock TreeDataProvider `onDidChangeTreeData` event emitter
  - Test CRUD operations (createTicket, updateTicket, deleteTicket)
  - Verify `onDidChangeTreeData.fire()` called on each operation
  - Test cache invalidation on update
- **Acceptance Criteria**:
  - ✓ `createTicket()` → DB entry created AND TreeView notified
  - ✓ `updateTicket()` → DB updated AND TreeView refreshed
  - ✓ `deleteTicket()` → DB entry removed AND TreeView updated
  - ✓ Cache properly invalidated (no stale reads on refresh)
- **Example Test**:
  ```typescript
  test('createTicket in DB triggers sidebar refresh', async () => {
    const ticketDb = new TicketDb();
    const treeProvider = new TicketsTreeProvider(ticketDb);
    
    const firespy = jest.spyOn(treeProvider.onDidChangeTreeData, 'fire');
    
    // Create ticket
    const ticket = await ticketDb.createTicket({
      title: 'Test ticket',
      type: 'ai_to_human'
    });
    
    // Assert DB entry created
    expect(await ticketDb.getTicket(ticket.id)).toBeDefined();
    
    // Assert TreeView notified
    expect(firespy).toHaveBeenCalled();
    
    // Assert cache updated (next getChildren call sees new ticket)
    const children = await treeProvider.getChildren();
    expect(children.some(c => c.id === ticket.id)).toBe(true);
  });
  ```

## Execution Order (Updated)
1. Task 1 → Test focused init/persistence
2. Task 2 → Test delete behavior
3. Task 3 → Test persistence across close/reopen
4. Task 4 → Test close warnings + post-close behavior
5. **Task 5 → Test CRUD + UI integration** ← NEW
