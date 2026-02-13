# COE Workflow & Orchestration Document

**Version**: 1.0  
**Date**: February 1, 2026  
**Status**: Draft  
**Cross-References**: [Master Plan](PROJECT-BREAKDOWN%20&%20TODO%20List%20.md), [Architecture](01-Architecture-Document.md), [Agent Roles](02-Agent-Role-Definitions.md)

---

## Overview

This document defines the complete orchestration workflows for the Copilot Orchestration Extension, detailing how agents coordinate, how tasks flow through the system, and how the Programming Orchestrator manages the entire process.

---

## Core Orchestration Principles

1. **Plan-Driven Execution**: All tasks originate from plans, not ad-hoc requests
2. **Agent Specialization**: Each agent handles specific responsibilities, no overlap
3. **Dependency Awareness**: Tasks execute in correct order, respecting dependencies
4. **Fail-Safe Handoffs**: Clear handoff protocols with fallback strategies
5. **User Oversight**: Critical decisions require human confirmation

---

## Workflow 1: Complete Issue Resolution Lifecycle

```mermaid
flowchart TB
    Start([GitHub Issue Created]) --> Sync[Issues Sync Extension<br/>Every 5 min]
    Sync --> Local[Local .md File<br/>.vscode/github-issues/]
    Local --> Watch[File System Watcher<br/>Detects New Issue]
    Watch --> PO[Programming Orchestrator<br/>Route to Planning Team]
    
    PO --> PT[Planning Team<br/>Analyze Issue]
    PT --> Decision{Issue Type?}
    
    Decision -->|Bug Fix| BugTasks[Create Bug Fix Tasks<br/>1-3 tasks]
    Decision -->|Feature Request| FeatureTasks[Create Feature Tasks<br/>5-15 tasks]
    Decision -->|Question/Discussion| NoTasks[No Tasks<br/>Notify User]
    
    BugTasks --> Queue[Task Queue<br/>Add to Ready Queue]
    FeatureTasks --> Queue
    
    Queue --> GetNext[GitHub Copilot<br/>getNextTask MCP call]
    GetNext --> Implement[Coding Agent<br/>Implement Solution]
    
    Implement --> Questions{Need Help?}
    Questions -->|Yes| AskQ[askQuestion MCP call<br/>Answer Team responds]
    AskQ --> Implement
    Questions -->|No| Continue[Continue Implementation]
    
    Continue --> Done[reportTaskDone<br/>MCP call]
    Done --> VT[Verification Team<br/>Auto + Visual Verify]
    
    VT --> VerifyCheck{All Criteria<br/>Pass?}
    VerifyCheck -->|Yes| NextTask{More Tasks?}
    VerifyCheck -->|No| FixTask[Create Investigation Task<br/>Block Original]
    
    FixTask --> Queue
    
    NextTask -->|Yes| GetNext
    NextTask -->|No| AllDone[All Tasks Complete]
    
    AllDone --> CreatePR[Create Pull Request<br/>Link to Issue]
    CreatePR --> ReviewPR[Request Copilot Review<br/>Automated Code Review]
    ReviewPR --> Feedback{Review<br/>Passed?}
    
    Feedback -->|Yes| MergePR[Merge Pull Request]
    Feedback -->|No| Address[Address Review Comments<br/>Create Fix Tasks]
    Address --> Queue
    
    MergePR --> CloseIssue[Close GitHub Issue<br/>Auto-sync to Local]
    CloseIssue --> End([Issue Resolved ✓])
```

**Duration**: 30 minutes - 4 hours depending on complexity

---

## Workflow 2: Plan Creation to Task Generation

```mermaid
sequenceDiagram
    participant User
    participant UI as Design Phase UI
    participant PO as Programming Orchestrator
    participant PT as Planning Team
    participant TD as Task Decomposition
    participant FS as File System
    participant Queue as Task Queue
    
    User->>UI: Open "Create New Plan"
    UI->>User: Show 10 core questions
    User->>UI: Answer questions (A/B/C/D/E)
    UI->>UI: Live preview updates
    User->>UI: Review design summary
    UI->>User: Ask 5-15 contextual questions
    User->>UI: Complete answers
    UI->>UI: Generate plan specification
    
    UI->>FS: Write plan.json, metadata.json, design-system.json
    FS->>PO: File created event
    PO->>PT: New plan detected, generate tasks
    
    PT->>FS: Read plan.json
    PT->>PT: Extract features from designChoices
    PT->>PT: Create epic-level tasks
    PT->>PT: Break epics into stories
    PT->>PT: Break stories into subtasks
    
    loop For each task
        PT->>PT: Check estimatedHours
        alt > 60 minutes
            PT->>TD: Request decomposition
            TD->>TD: Break into 5-20 min subtasks
            TD-->>PT: Return subtask list
        end
    end
    
    PT->>PT: Assign dependencies (DAG validation)
    PT->>PT: Validate no circular dependencies
    PT->>FS: Write tasks.json
    PT->>Queue: Add ready tasks to queue
    
    PT->>User: Notify "Plan ready: 35 tasks created"
    User->>User: Review task list (optional)
    User->>PO: Approve execution or adjust
```

**Duration**: 15-60 minutes (user input) + 5-10 seconds (task generation)

---

## Workflow 3: Question & Answer with Context

```mermaid
sequenceDiagram
    participant CA as Coding Agent
    participant MCP as MCP Server
    participant PO as Programming Orchestrator
    participant AT as Answer Team
    participant Plan as Plan Files
    participant Code as Codebase Index
    
    Note over CA: Working on TASK-003<br/>"Build Navigation Component"
    
    CA->>MCP: askQuestion({<br/>  question: "Should sidebar collapse on mobile?",<br/>  currentTaskId: "TASK-003"<br/>})
    
    MCP->>PO: Route question to Answer Team
    PO->>AT: Forward question + task context
    
    AT->>AT: Load current task details
    AT->>Plan: Search plan for "sidebar" + "mobile" + "responsive"
    Plan-->>AT: Found in designChoices.navigationStyle:<br/>"Sidebar collapses to hamburger menu<br/>on mobile (< 768px breakpoint)"
    
    AT->>Code: Search for existing responsive patterns
    Code-->>AT: Found media queries in:<br/>- src/components/Navigation.vue<br/>- src/styles/responsive.css
    
    AT->>AT: Calculate confidence score<br/>Evidence: Plan (exact quote) + Code (examples)<br/>Confidence: 98%
    
    AT->>AT: Format answer with guidance
    AT-->>PO: {<br/>  answer: "Yes, collapse at <768px",<br/>  evidence: {...},<br/>  guidance: {...},<br/>  confidence: 0.98<br/>}
    
    PO-->>MCP: Return answer
    MCP-->>CA: Answer with implementation guidance
    
    Note over CA: Uses answer to implement<br/>responsive behavior correctly
```

**Duration**: 1-5 seconds

---

## Workflow 4: Task Decomposition for Complex Work

```mermaid
sequenceDiagram
    participant PT as Planning Team
    participant TD as Task Decomposition Agent
    participant Plan as Plan Files
    participant Queue as Task Queue
    
    PT->>PT: Generate TASK-010 from plan
    PT->>PT: Calculate estimated hours: 3 hours
    
    Note over PT: Task exceeds 60 min threshold
    
    PT->>TD: Request decomposition for TASK-010
    TD->>Plan: Read plan context for task
    Plan-->>TD: Return design specs, requirements
    
    TD->>TD: Analyze logical boundaries:<br/>1. Setup (15 min)<br/>2. Core logic (20 min)<br/>3. Error handling (10 min)<br/>4. Tests (20 min)<br/>5. Documentation (15 min)
    
    TD->>TD: Create 5 subtasks (15-20 min each)
    TD->>TD: Assign dependencies:<br/>TASK-010-1 (setup) → no deps<br/>TASK-010-2 (core) → depends on -1<br/>TASK-010-3 (errors) → depends on -2<br/>TASK-010-4 (tests) → depends on -2, -3<br/>TASK-010-5 (docs) → depends on -4
    
    TD->>TD: Validate subtask sizes (5-20 min each)
    TD-->>PT: Return subtask list with dependencies
    
    PT->>Queue: Add TASK-010-1 to ready queue
    PT->>Queue: Add TASK-010-2 to blocked queue (waiting for -1)
    PT->>Queue: Add TASK-010-3 to blocked queue (waiting for -2)
    PT->>Queue: Add TASK-010-4 to blocked queue (waiting for -2, -3)
    PT->>Queue: Add TASK-010-5 to blocked queue (waiting for -4)
    
    PT->>PT: Mark TASK-010 as parent (not executable)
    
    Note over PT: As subtasks complete,<br/>blocked tasks move to ready queue
```

**Duration**: 5-10 seconds

---

## Workflow 5: Verification (Auto + Visual)

```mermaid
sequenceDiagram
    participant CA as Coding Agent
    participant MCP as MCP Server
    participant VT as Verification Team
    participant Tests as Test Suite
    participant Server as Dev Server
    participant UI as Verification UI
    participant User as User
    
    CA->>MCP: reportTaskDone({<br/>  taskId: "TASK-001",<br/>  status: "done",<br/>  filesModified: ["src/styles/colors.css"],<br/>  testsAdded: true<br/>})
    
    MCP->>VT: Trigger verification for TASK-001
    VT->>VT: Read acceptance criteria from task
    
    Note over VT: Auto-Verification Phase
    
    VT->>Tests: Run npm test (filter by modified files)
    Tests-->>VT: Results: 92 passed, 0 failed
    
    VT->>VT: Check each acceptance criterion
    loop For each criterion
        VT->>VT: Can auto-verify?<br/>(code-based criterion)
        alt Yes
            VT->>VT: Verify criterion automatically
        else No (visual criterion)
            VT->>VT: Mark for manual verification
        end
    end
    
    Note over VT: Visual Verification Phase
    
    VT->>VT: Detect UI changes in modified files
    alt UI changes detected
        VT->>Server: Start dev server (npm run dev)
        Server-->>VT: Server running on :3000
        
        VT->>UI: Open Visual Verification Panel
        UI->>User: Show checklist + "Ready" button
        
        User->>UI: Click "Ready to verify"
        UI->>User: Display verification checklist:<br/>✓ Color palette displays correctly<br/>✓ Theme toggle works<br/>✓ Accessibility (WCAG AA)
        
        User->>User: Test each item manually
        
        alt Everything looks good
            User->>UI: Click "Everything Looks Good"
            UI->>VT: Verification passed
            VT->>Server: Stop dev server
            VT->>MCP: Mark TASK-001 as verified ✓
            MCP->>CA: Return next task (TASK-002)
        else Found issues
            User->>UI: Click "Found Issues"
            UI->>User: Show issue form
            User->>UI: Describe issues found
            UI->>VT: Create investigation task
            VT->>MCP: Block TASK-001, create TASK-INV-001
            MCP->>CA: Return investigation task
        end
    else No UI changes
        VT->>MCP: Mark TASK-001 as verified ✓
        MCP->>CA: Return next task (TASK-002)
    end
```

**Duration**: 20-30 seconds (auto) + 2-10 minutes (visual with user)

---

## Workflow 6: Plan Change → Code Synchronization

```mermaid
sequenceDiagram
    participant User
    participant FS as File System Watcher
    participant Diff as Diff Calculator
    participant Impact as Impact Analyzer
    participant PT as Planning Team
    participant Queue as Task Queue
    participant UI as User Interface
    
    User->>FS: Edit plan.json (change color theme)
    FS->>FS: Debounce 500ms
    FS->>Diff: Plan file modified, calculate diff
    
    Diff->>Diff: Load previous version from metadata
    Diff->>Diff: Compare current vs previous
    Diff-->>Impact: Changed fields:<br/>- designChoices.colorTheme: "light" → "dark"
    
    Impact->>Impact: Analyze impact:<br/>- Affects: All pages, all components<br/>- Version bump: MINOR (1.0.0 → 1.1.0)<br/>- Code sync required: YES
    
    Impact->>Impact: Identify affected files:<br/>- src/styles/colors.css<br/>- src/styles/_variables.scss<br/>- 25 component files
    
    Impact->>UI: Show impact analysis to user
    UI->>User: Confirm plan change?<br/>"This will create 5 tasks<br/>Estimated: 3.5 hours"
    
    alt User confirms
        User->>UI: Approve change
        UI->>PT: Generate update tasks
        
        PT->>PT: Create TASK-036: Update color palette
        PT->>PT: Create TASK-037: Update component themes
        PT->>PT: Create TASK-038: Test dark theme
        PT->>PT: Create TASK-039: Update documentation
        PT->>PT: Create verification tasks
        
        PT->>Queue: Add tasks to queue (high priority)
        PT->>FS: Update metadata.json:<br/>- version: "1.1.0"<br/>- lastUpdated: now()
        
        PT->>UI: Notify "5 tasks created for plan v1.1.0"
        UI->>User: Show task list
    else User cancels
        User->>UI: Cancel change
        UI->>FS: Revert plan.json to previous version
        FS->>User: Plan reverted
    end
```

**Duration**: 5-10 seconds (impact analysis) + user decision time

---

## Workflow 7: Agent Failure Recovery

```mermaid
flowchart TB
    Start[Agent Receives Task] --> Execute[Agent Executes Task]
    Execute --> Check{Success?}
    
    Check -->|Success| Complete[Report Task Done]
    Check -->|Failure| Detect[Programming Orchestrator<br/>Detects Failure]
    
    Detect --> Type{Failure Type?}
    
    Type -->|Timeout| Retry[Retry with Exponential Backoff<br/>Attempt 1: 5s delay<br/>Attempt 2: 10s delay<br/>Attempt 3: 20s delay]
    
    Retry --> RetryCheck{Retry<br/>Success?}
    RetryCheck -->|Yes| Complete
    RetryCheck -->|No after 3 attempts| Fallback
    
    Type -->|Error| LogError[Log Error Details<br/>Stack Trace, Context]
    LogError --> Fallback[Activate Fallback Strategy]
    
    Type -->|Unresponsive| HealthCheck[Health Check Failed<br/>Agent Not Responding]
    HealthCheck --> Fallback
    
    Fallback --> FallbackType{Fallback<br/>Available?}
    
    FallbackType -->|Alternative Agent| Switch[Switch to Backup Agent<br/>Same Task, Different Agent]
    FallbackType -->|Degrade Gracefully| Manual[Create Manual Task<br/>Notify User for Manual Fix]
    FallbackType -->|Critical Failure| Escalate[Escalate to User<br/>Block Task Queue]
    
    Switch --> Execute
    Manual --> UserNotif[User Notification<br/>"Agent failed, manual action required"]
    Escalate --> UserNotif
    
    UserNotif --> End[Task Blocked<br/>Awaiting User Action]
    Complete --> Success[Task Complete ✓]
```

**Recovery Time**: 5-60 seconds depending on failure type

---

## Workflow 8: Autonomous Issue Fix (Full Cycle)

This is the complete autonomous workflow from the copilot-instructions.md:

```mermaid
flowchart TB
    Issue[GitHub Issue Exists<br/>Clear description, steps, evidence] --> Assign[User: Assign Copilot to Issue<br/>mcp_github_assign_copilot_to_issue]
    
    Assign --> Branch[Copilot Creates<br/>Implementation Branch<br/>feature/issue-123-fix]
    
    Branch --> PT[Planning Team<br/>Analyze Issue<br/>Create Task Breakdown]
    
    PT --> Queue[Add Tasks to Queue]
    Queue --> Next[Copilot: getNextTask]
    
    Next --> Implement[Copilot Implements Fix]
    Implement --> Questions{Need Context?}
    Questions -->|Yes| Ask[askQuestion → Answer Team]
    Ask --> Implement
    Questions -->|No| Continue[Continue Implementation]
    
    Continue --> Tests[Write Tests<br/>Verify Fix]
    Tests --> Done[reportTaskDone]
    Done --> VT[Verification Team<br/>Auto Tests + Visual Verify]
    
    VT --> AllDone{All Tasks<br/>Complete?}
    AllDone -->|No| Next
    AllDone -->|Yes| CreatePR[Copilot Creates PR<br/>Fixes #123<br/>Summary of Changes]
    
    CreatePR --> Review[User: Request Copilot Review<br/>mcp_github_request_copilot_review]
    
    Review --> CodeReview[Copilot Reviews Code<br/>Automated Analysis]
    CodeReview --> Feedback{Review<br/>Passes?}
    
    Feedback -->|No| Address[Address Feedback<br/>Create Fix Tasks]
    Address --> Queue
    
    Feedback -->|Yes| Merge[User: Merge PR<br/>mcp_github2_merge_pull_request]
    
    Merge --> Sync[Sync Changes<br/>Pull Latest to Main]
    Sync --> Close[GitHub Auto-Closes Issue<br/>or Manual Close]
    
    Close --> Done_Complete[Issue Resolved ✓<br/>Code Matches Plan]
```

**Duration**: 30 minutes - 4 hours for typical issues

### Escalation & Recovery Rules

**30-Second Timeout Enforcement** (prevents infinite loops):

1. **Answer Team Timeout**: If `askQuestion` receives no response within 30s:
   - Orchestrator creates ticket (type: `ai_to_human`)
   - Blocks current task, notifies user via sidebar
   - Resumes only after ticket resolved with clarity ≥85%

2. **Coding AI Stall Detection**: If no progress for 30s (no file changes, no API calls):
   - Orchestrator sends health check ping
   - If no response after 3 pings (10s each) → escalate to user ticket
   - Fallback: Switch to manual task assignment

3. **Verification Team Delay**: 60s stability wait after task completion:
   - Prevents file lock conflicts
   - Allows file system watchers to settle
   - Reduces false positives on incomplete writes

4. **MCP Tool Failures**: If MCP call fails (network, timeout, error):
   - Retry with exponential backoff: 2s, 5s, 10s
   - After 3 failures → create error ticket, pause task
   - Log to `10-MCP-Error-Codes-Registry.md`

**Recovery Flow**:
```
Timeout Detected (30s)
    ↓
Create Escalation Ticket
    ↓
User Resolves (provides answer/direction)
    ↓
Clarity Agent Scores Reply (must be ≥85%)
    ↓
Resume Orchestrator → Continue Task
```

**Cross-Reference**: See [08-Context-Management-System.md](08-Context-Management-System.md) for token overflow handling.

---

## Coordination Patterns

### Pattern 1: Sequential Handoff
One agent completes, next agent starts.

**Example**: Planning Team → Task Decomposition → Coding Agent → Verification Team

**Use When**: Tasks have clear dependencies, no parallelization possible

---

### Pattern 2: Parallel Execution
Multiple agents work simultaneously on different tasks.

**Example**: 
- Coding Agent A works on TASK-001
- Coding Agent B works on TASK-005 (no dependency on TASK-001)
- Answer Team responds to questions from both

**Use When**: Tasks are independent, no shared resources

---

### Pattern 3: Broadcast Notify
One event triggers multiple agents.

**Example**: Plan updated → Notify Planning Team, Answer Team, Verification Team

**Use When**: Multiple agents need to react to same event

---

### Pattern 4: Request-Response
Synchronous communication with immediate response.

**Example**: askQuestion → Answer Team responds within 5 seconds

**Use When**: Blocking operation, cannot proceed without answer

---

### Pattern 5: Async Queue
Agent adds work to queue, another agent processes later.

**Example**: Verification Team creates investigation task → Added to queue → Coding Agent picks up later

**Use When**: Non-blocking operation, eventual consistency acceptable

---

## Queue Management

### Task Queue States

```mermaid
stateDiagram-v2
    [*] --> Pending: Task Created
    Pending --> Ready: Dependencies Met
    Pending --> Blocked: Dependencies Pending
    Ready --> InProgress: Agent Claims Task
    InProgress --> Done: Task Completed
    InProgress --> Failed: Error/Failure
    InProgress --> Blocked: New Dependency Found
    Blocked --> Ready: Dependency Resolved
    Failed --> Investigation: Create Fix Task
    Investigation --> Ready: Fix Task Created
    Done --> Verification: Auto-Verify
    Verification --> Verified: All Criteria Pass
    Verification --> Failed: Criteria Failed
    Verified --> [*]: Task Complete
```

### Queue Priority Rules

1. **Critical** - Blockers, security issues, broken builds
2. **High** - Investigation tasks, plan sync tasks, user-reported bugs
3. **Medium** - Feature tasks from plan, refactoring
4. **Low** - Documentation, cleanup, nice-to-have features

---

## Error Scenarios & Recovery

| Scenario | Detection | Recovery | Fallback |
|----------|-----------|----------|----------|
| Agent timeout | Health check (10s interval) | Retry with backoff (3 attempts) | Switch to backup agent or manual task |
| Test failure | Verification Team | Create investigation task, block original | User fixes manually |
| Circular dependency | Planning Team (DAG validation) | Show dependency graph, suggest removal | User resolves manually |
| Plan-code drift | Impact Analyzer | Show diff, create sync tasks | User approves or rejects |
| GitHub API rate limit | API client (track quota) | Queue requests, resume when quota resets | Notify user, pause sync |
| MCP server crash | Extension (process monitor) | Restart server, reload state | Deactivate extension, notify user |

---

## Performance Optimization

### Caching Strategy
- **Plan Files**: Cache in memory, invalidate on file change
- **Task Queue**: In-memory with periodic persistence (every 60s)
- **Code Index**: Build once on activation, incremental updates
- **Answer Team Knowledge**: Cache common questions (LRU cache, max 100 entries)

### Parallelization
- **Multiple Coding Agents**: Up to 4 parallel tasks (independent work)
- **Answer Team**: Can handle multiple questions simultaneously
- **Verification Team**: Auto-verify and visual verify can run in parallel

### Debouncing
- **File System Watcher**: 500ms debounce on plan changes
- **GitHub Sync**: 5 minute interval (configurable)
- **UI Updates**: 200ms debounce on preview updates

---

## Metrics & Monitoring

### Real-Time Metrics
- Tasks in queue (ready, blocked, in-progress, done)
- Agent response times (p50, p95, p99)
- Task completion velocity (tasks/hour)
- Verification pass rate (auto vs manual)
- Plan-code drift score (percentage out of sync)

### Daily Metrics
- Tasks completed (by priority, by type)
- Agent utilization (% time active)
- Average task duration (actual vs estimated)
- Issue resolution time (issue created → closed)
- User intervention rate (manual actions required)

---

## GitHub API Rate Limit Resilience & Network Failure Recovery

### Challenge
GitHub API has rate limits (5,000 requests/hour for authenticated users, 60/hour for unauthenticated). Planning Team syncing issues could exhaust quota. Network failures can interrupt synchronization.

### Rate Limit Detection & Handling

**Strategy**: Proactive monitoring + graceful degradation

**Approach**:
```typescript
async function callGitHubAPI<T>(endpoint: string): Promise<T> {
  // Check rate limit before calling
  const rateLimitRemaining = await getRateLimitRemaining();
  
  if (rateLimitRemaining < 10) {
    // Pause sync, wait until rate limit resets
    const resetTime = await getRateLimitReset();
    const waitSeconds = Math.max(0, (resetTime - Date.now()) / 1000);
    
    console.warn(`GitHub rate limit low (${rateLimitRemaining} remaining). Waiting ${waitSeconds}s until reset.`);
    notifyUser(`GitHub sync paused – rate limit reached. Resuming at ${new Date(resetTime).toLocaleTimeString()}`);
    
    await delay(waitSeconds * 1000);
  }
  
  try {
    const response = await fetch(`https://api.github.com${endpoint}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json'
      }
    });
    
    // Handle 429 (rate limit exceeded)
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
      console.error(`GitHub API rate limited. Retry after ${retryAfter}s`);
      
      await delay(retryAfter * 1000);
      return callGitHubAPI<T>(endpoint);  // Retry
    }
    
    // Update rate limit tracking
    updateRateLimitHeaders(response.headers);
    
    return await response.json();
  } catch (error) {
    // Network error fallback
    return handleNetworkError(error);
  }
}
```

**Rate Limit Tracking**:
```typescript
interface RateLimitState {
  limit: number;          // e.g., 5000
  remaining: number;      // e.g., 4823
  reset: number;          // Unix timestamp
  lastChecked: number;    // Unix timestamp
}

function updateRateLimitHeaders(headers: Headers) {
  rateLimitState.limit = parseInt(headers.get('X-RateLimit-Limit') || '5000', 10);
  rateLimitState.remaining = parseInt(headers.get('X-RateLimit-Remaining') || '0', 10);
  rateLimitState.reset = parseInt(headers.get('X-RateLimit-Reset') || '0', 10) * 1000;
  rateLimitState.lastChecked = Date.now();
}
```

---

### Network Failure Recovery

**Scenario**: GitHub API unreachable (network down, DNS failure, GitHub outage)

**Fallback Strategy**: Use cached issue snapshot + background retry

**Approach**:
1. **Attempt API call** with 3 retries (exponential backoff: 5s, 15s, 45s)
2. **If all retries fail**: Use local cached snapshot
3. **Mark issues as potentially stale** (show timestamp in UI)
4. **Background retry**: Poll every 5 min until connection restored
5. **On restore**: Full sync, merge changes, notify user

**Code**:
```typescript
async function syncGitHubIssues(): Promise<Issue[]> {
  const retryConfig = {
    attempts: 3,
    backoffBase: 5000,  // 5 seconds
    maxDelay: 60000     // 60 seconds max
  };
  
  for (let attempt = 1; attempt <= retryConfig.attempts; attempt++) {
    try {
      const issues = await callGitHubAPI<Issue[]>('/repos/:owner/:repo/issues');
      
      // Success: cache for future fallback
      await cacheIssues(issues);
      
      return issues;
    } catch (error) {
      if (attempt < retryConfig.attempts) {
        const backoff = Math.min(
          retryConfig.backoffBase * Math.pow(2, attempt - 1),
          retryConfig.maxDelay
        );
        
        console.warn(`GitHub API failed (attempt ${attempt}/${retryConfig.attempts}). Retrying in ${backoff}ms...`);
        await delay(backoff);
        continue;
      }
      
      // All retries exhausted: use cache
      console.error('GitHub API unavailable. Using cached issues.');
      return await useCachedIssues();
    }
  }
  
  return [];  // Fallback: empty (shouldn't reach here)
}

async function useCachedIssues(): Promise<Issue[]> {
  const cache = await loadIssueCache();
  
  if (!cache || cache.age > 24 * 60 * 60 * 1000) {  // Stale if > 24h
    notifyUser('⚠️ GitHub sync failed. Issues may be outdated (cached from ${new Date(cache.timestamp).toLocaleString()})');
  } else {
    notifyUser('ℹ️ Using cached issues (GitHub API temporarily unavailable)');
  }
  
  // Start background retry
  scheduleBackgroundRetry();
  
  return cache.issues;
}

function scheduleBackgroundRetry() {
  const retryInterval = 5 * 60 * 1000;  // 5 minutes
  
  const intervalId = setInterval(async () => {
    try {
      await callGitHubAPI('/rate_limit');  // Lightweight ping
      
      // Success: connection restored
      clearInterval(intervalId);
      await syncGitHubIssues();  // Full sync
      notifyUser('✅ GitHub connection restored. Issues synced.');
    } catch {
      // Still down, wait for next interval
      console.log('GitHub still unavailable, retrying in 5min...');
    }
  }, retryInterval);
}
```

---

### Issue Cache Schema

**File**: `.coe/github-cache.json`

```json
{
  "issues": [...],
  "timestamp": "2026-02-01T12:00:00Z",
  "age": 3600000,
  "stale": true
}
```

**Update on successful sync**:
```typescript
async function cacheIssues(issues: Issue[]) {
  const cache = {
    issues,
    timestamp: new Date().toISOString(),
    age: 0,
    stale: false
  };
  
  await fs.writeFile('.coe/github-cache.json', JSON.stringify(cache, null, 2));
}
```

---

### Config Options

```yaml
github:
  rate_limit_check: true                  # Check before each API call
  min_remaining_requests: 10              # Pause if below this
  retry_attempts: 3                       # Failed call retries
  backoff_base_seconds: 5                 # Exponential backoff base
  cache_stale_after_hours: 24             # Mark cached issues stale
  background_retry_interval_seconds: 300  # 5 min background retry
```

---

### User Notifications

| Scenario | Notification | Action |
|----------|--------------|--------|
| Rate limit low (<10) | "GitHub sync paused – rate limit low. Resuming at HH:MM" | Show toast, auto-resume later |
| Rate limit hit (429) | "GitHub rate limit exceeded. Waiting 60s before retry." | Show toast with countdown timer |
| Network failure (3 retries) | "⚠️ GitHub unavailable. Using cached issues (last sync: timestamp)" | Show persistent banner, auto-retry in background |
| Connection restored | "✅ GitHub connection restored. Issues synced." | Toast notification, refresh sidebar |

---

## Configuration

### Orchestration Settings (`.vscode/settings.json`)
```json
{
  "coe.orchestration.maxParallelAgents": 4,
  "coe.orchestration.healthCheckInterval": 10000,
  "coe.orchestration.retryAttempts": 3,
  "coe.orchestration.retryBackoff": "exponential",
  "coe.orchestration.taskQueuePersistInterval": 60000,
  "coe.orchestration.autoDecomposeThreshold": 60,
  "coe.orchestration.requireVisualVerifyForUI": true,
  "coe.orchestration.pauseOnPlanConflict": true
}
```

---

## Testing Workflows

### Unit Test Example
```typescript
describe('ProgrammingOrchestrator', () => {
  it('should route task to correct agent', () => {
    const task = { estimatedHours: 2, status: 'pending' };
    const agent = orchestrator.routeTask(task);
    expect(agent).toBe(AgentType.TaskDecomposition);
  });
});
```

### Integration Test Example
```typescript
describe('Complete Issue Resolution', () => {
  it('should resolve issue end-to-end', async () => {
    // Create issue
    const issue = await createTestIssue('Bug: Color contrast');
    
    // Sync to local
    await syncExtension.sync();
    
    // Planning Team generates tasks
    const tasks = await planningTeam.generateTasks(issue);
    expect(tasks).toHaveLength(3);
    
    // Execute tasks
    for (const task of tasks) {
      await codingAgent.execute(task);
      await verificationTeam.verify(task);
    }
    
    // Create PR
    const pr = await github.createPR(issue, tasks);
    expect(pr.state).toBe('open');
    
    // Merge PR
    await github.mergePR(pr);
    
    // Verify issue closed
    const closedIssue = await github.getIssue(issue.number);
    expect(closedIssue.state).toBe('closed');
  });
});
```

---

## References

- [Master Plan](PROJECT-BREAKDOWN%20&%20TODO%20List%20.md)
- [Architecture Document](01-Architecture-Document.md)
- [Agent Role Definitions](02-Agent-Role-Definitions.md)
- [copilot-instructions.md](../../.github/copilot-instructions.md)

**Document Status**: Complete  
**Next Review**: After workflow implementation  
**Owner**: Plan Master Agent + Development Team
