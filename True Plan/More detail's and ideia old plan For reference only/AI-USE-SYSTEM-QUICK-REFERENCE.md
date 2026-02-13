# AI Use System – Quick Reference Card

**Purpose**: One-page cheat sheet for implementing the multi-agent orchestration system.

---

## 🎯 What We're Building (60-second summary)

| Piece | Function | Reuses |
|-------|----------|--------|
| **Ticket DB** | Agent ↔ User communication (SQLite at `.coe/tickets.db`) | — |
| **Orchestrator Routing** | Copilot gets tasks from queue; auto-escalates if blocked >30s | Task queue ✅ |
| **Agents Sidebar Tab** | See live status of 5 agent teams | tasksTreeView pattern ✅ |
| **Tickets Sidebar Tab** | See open tickets grouped by status; click to detail view | tasksTreeView pattern ✅ |
| **Streaming Mode** | LLM responses timeout if no token for N seconds (from config) | LLM config ✅ |
| **Verification Panel** | Show test results post-execution; allow re-run/approve | MCP tools ✅ |

**Philosophy**: Add features to the **existing queue/sidebar/LLM loop**—no rewrites, no breakage.

---

## 🚀 P1 Tasks Only (Do These First)

### Task 1: Ticket DB (`ticketService.ts` + `ticketDb.ts`)

**What**: SQLite CRUD for tickets + thread replies

**Schema** (copy-paste ready):
```sql
CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  type TEXT CHECK(type IN ('ai_to_human', 'human_to_ai')),
  status TEXT CHECK(status IN ('open', 'in_review', 'resolved', 'rejected', 'escalated')),
  priority INTEGER,
  creator TEXT, assignee TEXT DEFAULT 'Clarity Agent',
  task_id TEXT, title TEXT NOT NULL, description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE ticket_replies (
  id TEXT PRIMARY KEY, ticket_id TEXT,
  author TEXT, content TEXT, clarity_score INTEGER,
  needs_followup BOOLEAN, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(ticket_id) REFERENCES tickets(id)
);
```

**CRUD Functions**:
- `createTicket(type, title, desc, priority, creator)` → ticket ID
- `getTicket(id)` → ticket + all replies
- `getTickets(filter)` → list
- `updateTicketStatus(id, status)` → updates `updated_at`
- `addReply(ticketId, author, content)` → reply ID (call Clarity Agent after)
- **Fallback**: If SQLite fails, use `Map<string, Ticket>` in memory (log warning)

**Test**: CRUD + in-memory fallback (≥80% coverage)

**Blockers**: None | **Time**: 4–6 hours

---

### Task 2: Orchestrator Routing (`programmingOrchestrator.ts`)

**What**: Copilot task assignment + blocker detection

**Logic**:
1. `getNextTask()` → pull highest P1 from queue
2. Send to Copilot via MCP (with super-detailed prompt)
3. Track `currentTask` in Orchestrator state
4. On `reportTaskStatus('completed')` → mark queue item done
5. **If blocked >30s** (no token from LLM):
   - Auto-create ticket: `{ type: 'ai_to_human', title: 'Copilot blocked', priority: 1 }`
   - Call MCP `askQuestion()` → logs question + task context
   - Log warning to console

**Config Integration**:
```typescript
const config = FileConfigManager.getLLMConfig();
const blockDetectTimeout = config.llm.timeoutSeconds || 60; // in seconds
// Set timer when task starts; if no token received in blockDetectTimeout, escalate
```

**Test**: Task assignment + blocker detection (≥75% coverage)

**Blockers**: Task 1 (Ticket DB) | **Time**: 3–4 hours

---

## 📋 Integration Checklist (After P1)

- [ ] No new queue created (agent tasks use existing PriorityQueue)
- [ ] Config read-only (no `config.write()` added)
- [ ] Fallback to in-memory if DB missing
- [ ] MCP tools work (getNextTask, reportTaskStatus, askQuestion)
- [ ] Logs show routing decisions (audit trail)

---

## 🎨 UI Framework (Copy Existing Patterns)

### New Sidebar Tabs

**Pattern**: Extend `extension.ts` with two new TreeDataProviders:

```typescript
// extensions.ts
context.subscriptions.push(
  vscode.window.registerTreeDataProvider('agents-view', new AgentsTreeProvider())
);
context.subscriptions.push(
  vscode.window.registerTreeDataProvider('tickets-view', new TicketsTreeProvider())
);
```

### Tree Provider Template

```typescript
export class AgentsTreeProvider implements TreeDataProvider<AgentItem> {
  private _onDidChangeTreeData: EventEmitter<void> = new EventEmitter();
  readonly onDidChangeTreeData: Event<void> = this._onDidChangeTreeData.event;

  getTreeItem(element: AgentItem): TreeItem {
    return element;
  }

  getChildren(): Thenable<AgentItem[]> {
    return Promise.resolve([
      new AgentItem('Planning Team', 'Idle'),
      new AgentItem('Programming Orchestrator', 'Working'),
      new AgentItem('Answer Team', 'Idle'),
      new AgentItem('Verification Team', 'Idle'),
      new AgentItem('Clarity Agent', 'Processing TK-001'),
    ]);
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }
}
```

**Key**: Use emoji (🤖, 🎫, ✅) for quick scanning. No complex React—just TreeItem + TreeDataProvider.

---

## ⚙️ Config: Read-Only, Never Write

**Rule**: Config is source of truth. Never modify it in code.

```typescript
// ✅ GOOD: Read timeout for inactivity check
const config = FileConfigManager.getLLMConfig();
const maxInactivity = config.llm.timeoutSeconds || 60;
// Use maxInactivity for timers, NOT for total request timeout

// ❌ BAD: Overwriting config
config.llm.timeoutSeconds = newValue; // DON'T!
FileConfigManager.save(config); // DON'T!
```

**Use for**:
- Max time between tokens in streaming (inactivity timeout)
- Default LLM model selection
- Input token limit (for bundling files)
- **Never for**: Auto-adjusting timeouts, storing execution state, persisting agent status

---

## 🧪 Test Examples

### Ticket DB

```typescript
test('createTicket returns valid ID', async () => {
  const id = await ticketService.createTicket('ai_to_human', 'Title', 'Desc', 1, 'PlanningTeam');
  expect(id).toMatch(/^TK-\d+$/);
});

test('in-memory fallback when DB unavailable', async () => {
  // Mock ticketDb.init() to fail
  const service = new TicketService({ fallbackToMemory: true });
  const id = await service.createTicket(...);
  expect(id).toBeDefined(); // Still works
});
```

### Orchestrator Routing

```typescript
test('getNextTask returns P1 task', async () => {
  const task = await orchestrator.getNextTask();
  expect(task.priority).toBe('P1');
});

test('blocker detected after 30s inactivity', async () => {
  // Mock LLM to not send tokens for 35s
  const ticket = await orchestrator.detectBlocker();
  expect(ticket.type).toBe('ai_to_human');
  expect(ticket.title).toContain('blocked');
});
```

---

## 🔄 Manual Test (After P1)

```
1. npm test (existing suite must pass 100%)
2. Start extension in dev mode
3. Create ticket: await mcp.callTool('createTicket', {...})
4. Refresh sidebar → Tickets tab shows new ticket
5. Click ticket → webview opens (may be empty, that's OK for P1)
6. Check .coe/tickets.db → row exists
7. Restart extension → ticket still there
8. Stop DB service (simulate missing .coe/tickets.db):
   - Extension still works (in-memory mode)
   - Warning logged: "Tickets DB unavailable; using fallback"
9. Simulate 35s LLM inactivity:
   - Orchestrator creates blocking ticket automatically
   - MCP askQuestion called
   - Log shows decision
```

---

## 📚 Files to Create/Modify

| File | Purpose | Lines | Status |
|------|---------|-------|--------|
| `src/services/ticketService.ts` | Ticket CRUD | ~300 | 🆕 New |
| `src/utils/ticketDb.ts` | SQLite wrapper | ~200 | 🆕 New |
| `src/orchestrator/programmingOrchestrator.ts` | Routing logic | +100 | ✏️ Update |
| `src/extension.ts` | Register sidebar tabs | +30 | ✏️ Update |
| `src/ui/agentsTreeView.ts` | Agents tab | ~150 | 🆕 New |
| `src/ui/ticketsTreeView.ts` | Tickets tab | ~150 | 🆕 New |
| `.coe/config.json` | Config (read-only) | — | — |
| `src/tests/ticketService.test.ts` | Ticket tests | ~200 | 🆕 New |
| `src/tests/orchestrator.test.ts` | Routing tests | +100 | ✏️ Update |

---

## 🚫 Common Mistakes (Avoid!)

| Mistake | Why Bad | Fix |
|---------|---------|-----|
| Create new task queue for agents | Duplicates logic; confuses priority | Reuse existing `PriorityQueue<Task>` with `agent_name` field |
| Write to config during execution | Breaks user settings | Only read config; never call `config.write()` |
| Implement full LLM context management | Too heavy for P1 | Use streaming + simple inactivity timeout (config.timeoutSeconds) |
| Complex React UI for sidebar | VS Code tree views don't need React | Use TreeDataProvider + simple TreeItem |
| Crash if DB missing | Bad UX, breaks demo | Fallback to `Map<string, Ticket>` in memory |
| Title >1200 words for this doc | Hard to onboard | Keep focused on P1 tasks; cross-reference full plan |

---

## ✅ Phase 1 Done When

1. ✓ Ticket DB working + fallback tested
2. ✓ Orchestrator routes Copilot tasks + logs decisions
3. ✓ No existing tests broken
4. ✓ Config never written to (only read)
5. ✓ Manual test passes (create ticket → see in sidebar → data persists)
6. ✓ All code TypeScript (no `any`, strong types)
7. ✓ JSDoc comments on all functions

---

## 🔗 Helpful Links

- **This Plan**: `Plans/AI-USE-SYSTEM-INCREMENTAL-PLAN.md` (full details)
- **Existing Patterns**: `src/ui/tasksTreeView.ts` (copy this pattern)
- **Tree View API**: https://code.visualstudio.com/api/extension-guides/tree-view
- **SQLite3 Node**: https://github.com/TryGhost/node-sqlite3#readme
- **Streaming Pattern**: https://stackoverflow.com/questions/61632649/how-to-detect-no-data-in-stream-nodejs
- **TypeScript Config**: `tsconfig.json` (must use strict mode)
- **Existing MCP Tools**: `src/mcpServer/tools.ts` (reference)

---

**Keep It Simple**: P1 = Ticket DB + Orchestrator Routing. That's it. Phase 2 adds UI. No rushing, no bloat.
