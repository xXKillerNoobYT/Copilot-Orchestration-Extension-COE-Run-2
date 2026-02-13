# COE View Container Migration Breakdown

**Last Updated**: February 1, 2026  
**Status**: Partial (UI refresh triggers incomplete)

**Original Task**: Move "COE Task Queue" and "Completed task history" from Explorer to a custom Activity Bar container with sub-tabs.
**Estimated**: ~45-60 minutes (too large for one session)
**Split Into**: 3 atomic tasks (~15-20 minutes each)

## Atomic Tasks (~20 min each)

### Task 1: Add COE ViewContainer in package.json
- **Time**: ~15 min
- **File**: package.json
- **Concern**: Register new Activity Bar container and move views under it.
- **Changes**:
  - Add `contributes.viewsContainers.activitybar` with `id: "coe-views"`, title, and icon.
  - Move `coe-task-queue` and `coe-completed-history` views under `contributes.views["coe-views"]`.
  - Remove those views from Explorer container.
- **Acceptance Criteria**:
  - New "COE" Activity Bar container appears.
  - Task Queue + Completed History are listed as sub-tabs under COE container.
  - Explorer no longer lists those two views.

### Task 2: Register TreeDataProviders in extension.ts
- **Time**: ~20 min
- **File**: src/extension.ts
- **Concern**: Ensure view IDs match new container and refresh hooks remain intact.
- **Changes**:
  - Confirm `registerTreeDataProvider` uses new view IDs (`coe-task-queue`, `coe-completed-history`).
  - Ensure refresh events still trigger (`onDidChangeTreeData`).
- **Acceptance Criteria**:
  - Providers load without error in COE container.
  - View updates on task changes still refresh correctly.

### Task 3: Add icon asset + basic view placement test
- **Time**: ~20 min
- **Files**: media/coe-icon.svg, tests/**
- **Concern**: Provide Activity Bar icon and a minimal placement test.
- **Changes**:
  - Add `media/coe-icon.svg` (simple SVG).
  - Add Jest test to verify views are declared in `coe-views` container.
- **Acceptance Criteria**:
  - Extension loads with icon (no manifest errors).
  - Test passes confirming view container placement.

## Execution Order
1. Task 1 → Test manifest load
2. Task 2 → Verify view refresh works
3. Task 3 → Add icon + test

## Notes
- Keep total changes under 200 lines.

---

## Refresh Button Design Spec (UI/UX)

**Location**: Tabs header for "Agents" + "Tickets" tabs

**Button Appearance**:
- Icon: Clock/refresh circular arrow icon (Material Design suggested)
- Tooltip: "Refresh tickets and agent status"
- State when active: Spinning animation
- State when idle: Static

**Behavior on Click**:
1. Show spinner animation on button (indicate loading)
2. Call sidebar TreeDataProvider refresh (query DB for changes)
3. **On success**: 
   - Stop spinner
   - Toast notification: "Tickets synced (N updates)" (fade out after 3 sec)
   - Highlight newly added/updated tickets briefly (light yellow background, 2 sec)
4. **On error**: 
   - Stop spinner
   - Toast error: "Failed to sync tickets – check DB connection" with orange/red color
   - Retry button in toast

**Sync Strategy**:
- Direct DB query: Only fetch changed tickets (WHERE updated_at > lastRefresh)
- In-memory cache merge (update only changed tickets, don't re-render entire tree)
- Event-driven (no polling)

**Reference**: 
- Technical: [TICKET-SYSTEM-SPECIFICATION.md › Ticket Cache & Sidebar Refresh Policy](TICKET-SYSTEM-SPECIFICATION.md)
- Events: [08-Context-Management-System.md › UI State Events & Sidebar Refresh Triggers](08-Context-Management-System.md)

### Sidebar Tab Refresh Triggers

| Tab | Event Source | Trigger | Auto-Refresh? |
|-----|---|---|---|
| Task Queue | MCP `reportTaskStatus` | Status changed | ✅ Yes |
| Completed History | Task Queue | Done/verified | ✅ Yes |
| Agents | Agent state service | State changed | ✅ Yes |
| Tickets | Ticket DB/MCP | CRUD/resolve | ✅ Yes |

---

#### Implementation: VS Code TreeDataProvider Refresh Pattern

**Core Interface**:
```typescript
export class CoeTicketsProvider implements vscode.TreeDataProvider<TicketTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TicketTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {this._onDidChangeTreeData.fire(undefined); }  // Full tree refresh
  refreshItem(item: TicketTreeItem): void { this._onDidChangeTreeData.fire(item); }  // Single item
}
```

**Example 1: Ticket Created → Auto-Refresh**:
```typescript
ticketEvents.on('ticket:created', () => ticketsProvider.refresh());
```

**Example 2: MCP Task Status → Queue Refresh**:
```typescript
mcpServer.tool('reportTaskStatus', async ({ task_id, status }) => {
  await taskDb.updateStatus(task_id, status);
  taskEvents.emit('task:status_changed', { task_id, status });
});
taskEvents.on('task:status_changed', () => activeTasksProvider.refresh());
```

**Example 3: Agent State → Agents Tab**:
```typescript
agentStateService.on('agent:state_changed', ({ agentName, state }) => {
  const item = agentsProvider.findByName(agentName);
  if (item) agentsProvider.refreshItem(item);  // Refresh only changed node
});
```

Manual refresh button fallback on each tab if events fail.

