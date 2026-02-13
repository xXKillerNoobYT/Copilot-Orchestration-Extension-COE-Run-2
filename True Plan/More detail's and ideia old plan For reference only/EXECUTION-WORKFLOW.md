# Execution Workflow Reference

> Complete workflow documentation for task handoff, error handling, drift detection, and code cleanup.

**Version**: 1.0.0  
**Last Updated**: 2025-01-XX  
**Related Tasks**: MT-033.31-42

---

## Table of Contents

1. [Coding Agent Handoff](#coding-agent-handoff)
2. [Task Context Package](#task-context-package)
3. [Agent Return/Handback](#agent-returnhandback)
4. [Error Detection System](#error-detection-system)
5. [Auto-Fix Workflow](#auto-fix-workflow)
6. [Error Escalation](#error-escalation)
7. [Drift Detection](#drift-detection)
8. [Drift Correction](#drift-correction)
9. [Complex Problem Decomposition](#complex-problem-decomposition)
10. [Dead Code Detection](#dead-code-detection)
11. [Code Cleanup Workflow](#code-cleanup-workflow)
12. [Complete Pipeline Flow](#complete-pipeline-flow)

---

## Coding Agent Handoff

### Purpose
Creates a complete, self-contained task package that coding agents can execute without needing additional context or clarification.

### Handoff Package Format

```typescript
interface CodingHandoffPackage {
  // Identification
  taskId: string;
  handoffId: string;
  timestamp: string;
  
  // Task Definition
  task: {
    title: string;
    description: string;
    type: 'create' | 'modify' | 'fix' | 'refactor' | 'delete';
    priority: 'P0' | 'P1' | 'P2' | 'P3';
  };
  
  // What to Change
  files: {
    path: string;
    action: 'create' | 'modify' | 'delete';
    currentContent?: string;  // For modify/delete
    targetBehavior: string;   // Natural language description
  }[];
  
  // Acceptance Criteria
  acceptanceCriteria: {
    id: string;
    description: string;
    verification: 'test' | 'lint' | 'manual' | 'compile';
  }[];
  
  // Patterns to Follow
  codePatterns: {
    patternName: string;
    exampleFile: string;
    description: string;
  }[];
  
  // Test Specifications
  tests: {
    testFile: string;
    testName: string;
    description: string;
    expectedBehavior: string;
  }[];
  
  // Constraints
  constraints: {
    mustNotModify: string[];      // Files that cannot be changed
    mustUseLibraries: string[];   // Required libraries
    mustNotUseLibraries: string[];// Forbidden libraries
    maxFileSize: number;          // Bytes
    maxNewLines: number;          // Line count
  };
  
  // Context (from contextPackager)
  context: TaskContextPackage;
}
```

### Handoff Quality Checklist

- [ ] Task description is unambiguous (one interpretation only)
- [ ] All affected files listed
- [ ] At least 1 acceptance criterion
- [ ] At least 1 code pattern referenced
- [ ] Constraints clearly stated
- [ ] Context package included
- [ ] Estimated time provided

---

## Task Context Package

### Purpose
Gathers all relevant context so coding agents have everything they need in one place.

### Context Package Format

```typescript
interface TaskContextPackage {
  // Relevant Code
  codeSnippets: {
    file: string;
    startLine: number;
    endLine: number;
    content: string;
    relevance: string;  // Why this is relevant
  }[];
  
  // Dependencies
  dependencies: {
    file: string;
    usedBy: string[];     // Files that use this
    uses: string[];       // Files this uses
    exports: string[];    // Exported symbols
  }[];
  
  // Similar Patterns
  similarPatterns: {
    file: string;
    pattern: string;
    description: string;
    howToApply: string;
  }[];
  
  // Documentation
  documentation: {
    file: string;
    section: string;
    content: string;
  }[];
  
  // Test Examples
  testExamples: {
    file: string;
    testName: string;
    pattern: string;      // How to write similar test
  }[];
  
  // Error History
  errorHistory: {
    date: string;
    error: string;
    fix: string;
    preventionNote: string;
  }[];
  
  // Package Meta
  meta: {
    generatedAt: string;
    totalFiles: number;
    totalLines: number;
    estimatedReadTime: string;
  };
}
```

### Context Filtering Rules

1. **Relevance Score**: Each snippet must have relevance >70%
2. **Size Limit**: Total context <50KB (to fit in context window)
3. **Recency**: Prefer recently modified files
4. **Depth**: Max 3 levels of dependency chain
5. **Exclude**: node_modules, build outputs, test fixtures

---

## Agent Return/Handback

### Purpose
Structured format for coding agents to report back results.

### Handback Package Format

```typescript
interface CodingHandbackPackage {
  // Identification
  handoffId: string;      // Original handoff ID
  handbackId: string;
  timestamp: string;
  
  // Status
  status: 'success' | 'partial' | 'failed' | 'blocked';
  
  // Code Changes
  changes: {
    file: string;
    action: 'created' | 'modified' | 'deleted';
    diff?: string;        // Unified diff format
    newContent?: string;  // Full content if created
  }[];
  
  // Test Results
  testResults: {
    testFile: string;
    testName: string;
    status: 'pass' | 'fail' | 'skip';
    output?: string;      // Error message if failed
    duration: number;     // Milliseconds
  }[];
  
  // Issues Found
  issues: {
    severity: 'blocker' | 'high' | 'medium' | 'low';
    type: 'question' | 'blocker' | 'discovery' | 'suggestion';
    description: string;
    affectedFile?: string;
    suggestedFix?: string;
  }[];
  
  // Metrics
  metrics: {
    timeSpentMinutes: number;
    estimatedMinutes: number;     // From handoff
    linesAdded: number;
    linesRemoved: number;
    filesChanged: number;
  };
  
  // Confidence
  confidence: {
    level: 'high' | 'medium' | 'low';
    reason: string;
  };
}
```

### Handback Validation Rules

```typescript
async function validateHandback(handback: CodingHandbackPackage): Promise<ValidationResult> {
  const checks = [];
  
  // 1. All tests pass
  checks.push({
    name: 'tests_pass',
    passed: handback.testResults.every(t => t.status === 'pass'),
    message: 'All tests must pass'
  });
  
  // 2. No lint errors in changed files
  checks.push({
    name: 'no_lint_errors',
    passed: await checkLint(handback.changes.map(c => c.file)),
    message: 'No lint errors allowed'
  });
  
  // 3. No compile errors
  checks.push({
    name: 'compiles',
    passed: await checkCompile(),
    message: 'Code must compile'
  });
  
  // 4. Changes within scope
  checks.push({
    name: 'in_scope',
    passed: handback.changes.every(c => isAllowedFile(c.file)),
    message: 'Changes must be within task scope'
  });
  
  // 5. No critical issues
  checks.push({
    name: 'no_blockers',
    passed: !handback.issues.some(i => i.severity === 'blocker'),
    message: 'No blocking issues'
  });
  
  return {
    valid: checks.every(c => c.passed),
    checks
  };
}
```

---

## Error Detection System

### Error Categories

| Category | Examples | Severity | Auto-Fixable |
|----------|----------|----------|--------------|
| Compile | Missing import, syntax error, type mismatch | Critical | Sometimes |
| Test | Assertion failed, timeout, setup error | High | No |
| Lint | ESLint violations, formatting | Medium | Yes |
| Runtime | Null reference, unhandled promise | Critical | No |
| Logic | Wrong calculation, edge case | High | No |
| Performance | Slow operation, memory leak | Medium | No |

### Error Detection Flow

```
┌─────────────────┐
│  Code Changed   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Run TypeScript  │────► Compile Errors
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Run ESLint      │────► Lint Errors
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Run Tests       │────► Test Failures
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Analyze Runtime │────► Runtime Errors (if any)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Error Report    │
└─────────────────┘
```

### Error Report Format

```typescript
interface ErrorReport {
  timestamp: string;
  totalErrors: number;
  
  errors: {
    id: string;
    category: 'compile' | 'test' | 'lint' | 'runtime' | 'logic' | 'performance';
    severity: 'critical' | 'high' | 'medium' | 'low';
    
    location: {
      file: string;
      line: number;
      column: number;
    };
    
    message: string;
    code?: string;            // Error code (e.g., TS2345)
    sourceCode: string;       // Offending line(s)
    
    suggestion?: string;      // Suggested fix
    autoFixable: boolean;
    autoFixConfidence?: number; // 0-100
    
    relatedErrors?: string[]; // IDs of related errors
  }[];
}
```

---

## Auto-Fix Workflow

### Fixable Error Types

| Error Type | Auto-Fix Strategy | Confidence |
|------------|-------------------|------------|
| Missing import | Add import statement | 95% |
| Unused import | Remove import | 99% |
| Missing semicolon | Add semicolon | 99% |
| Formatting | Run prettier | 100% |
| Unused variable | Prefix with _ | 90% |
| Simple type cast | Add type assertion | 85% |
| Deprecated API | Replace with new API | 70% |

### Auto-Fix Flow

```
┌─────────────────┐
│   Error Found   │
└────────┬────────┘
         │
         ▼
    ┌────────────┐
    │ Fixable?   │──── No ────► Create Fix Ticket
    └─────┬──────┘
          │ Yes
          ▼
    ┌────────────┐
    │ Confidence │──── <90% ──► Ask User Confirmation
    │    >90%?   │
    └─────┬──────┘
          │ Yes
          ▼
┌─────────────────┐
│   Apply Fix     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Run Tests     │──── Fail ──► Rollback + Create Ticket
└────────┬────────┘
         │ Pass
         ▼
┌─────────────────┐
│  Fix Complete   │
└─────────────────┘
```

### Auto-Fix Rules

1. **Never auto-fix** if confidence < 90%
2. **Always run tests** after applying fix
3. **Rollback immediately** if tests fail
4. **Log all fixes** for audit trail
5. **Limit 3 fixes per file per run** (prevent infinite loops)

---

## Error Escalation

### Escalation Ladder

```
Level 1: Retry (3 attempts)
    │
    ▼ Failed
Level 2: Coding Agent Fix (1 attempt)
    │
    ▼ Failed  
Level 3: Specialized Agent (1 attempt)
    │
    ▼ Failed
Level 4: Human Escalation
```

### Escalation Package

```typescript
interface EscalationPackage {
  level: 1 | 2 | 3 | 4;
  taskId: string;
  errorId: string;
  
  // What was tried
  attempts: {
    level: number;
    timestamp: string;
    action: string;
    result: string;
    duration: number;
  }[];
  
  // Current state
  currentError: ErrorReport['errors'][0];
  
  // Context
  context: TaskContextPackage;
  
  // For human escalation
  humanNote?: {
    summary: string;
    suggestedApproaches: string[];
    blockerDescription: string;
    estimatedDifficulty: 'easy' | 'medium' | 'hard';
  };
}
```

### Escalation Triggers

- **Level 1→2**: Same error after 3 retries
- **Level 2→3**: Coding agent reports "cannot fix"
- **Level 3→4**: Specialized agent fails OR error persists after 5 total attempts
- **Immediate Level 4**: Security issues, data loss risk, unknown error type

---

## Drift Detection

### Drift Types

| Drift Type | Description | Detection Method |
|------------|-------------|------------------|
| Feature Drift | Built something different | Compare code vs spec |
| Scope Creep | Added unplanned features | Find code not in plan |
| Missing Requirement | Plan item not implemented | Match plan to code |
| API Drift | Endpoints don't match spec | Compare routes |
| Schema Drift | DB doesn't match plan | Compare schemas |
| Test Drift | Tests miss acceptance criteria | Coverage analysis |
| Dependency Drift | Using unplanned libraries | Package.json diff |

### Drift Report Format

```typescript
interface DriftReport {
  timestamp: string;
  planVersion: string;
  codeCommit: string;
  
  drifts: {
    id: string;
    type: DriftType;
    severity: 'minor' | 'major';  // <10% or >10% deviation
    
    planExpectation: {
      item: string;
      location: string;
      description: string;
    };
    
    actualCode: {
      file: string;
      line?: number;
      description: string;
    };
    
    deviation: string;          // What's different
    impact: string;             // Why it matters
    suggestedAction: 'fix_code' | 'update_plan' | 'split';
    
    autoCorrectible: boolean;
    correctConfidence?: number;
  }[];
  
  summary: {
    totalDrifts: number;
    minorDrifts: number;
    majorDrifts: number;
    autoCorrectible: number;
    requiresDecision: number;
  };
}
```

### Drift Detection Algorithm

```typescript
async function detectDrift(plan: Plan, codebase: Codebase): Promise<DriftReport> {
  const drifts: Drift[] = [];
  
  // 1. Check each plan item has corresponding code
  for (const feature of plan.features) {
    const implementation = findImplementation(codebase, feature);
    if (!implementation) {
      drifts.push({
        type: 'missing_requirement',
        severity: 'major',
        planExpectation: feature,
        actualCode: null,
        deviation: 'Feature not implemented'
      });
    } else if (!matchesSpec(implementation, feature)) {
      drifts.push({
        type: 'feature_drift',
        severity: calculateDeviation(implementation, feature) > 0.1 ? 'major' : 'minor',
        planExpectation: feature,
        actualCode: implementation,
        deviation: describeDifference(implementation, feature)
      });
    }
  }
  
  // 2. Find unplanned code
  for (const file of codebase.files) {
    const plannedItems = findPlanItems(plan, file);
    if (plannedItems.length === 0 && isFeatureCode(file)) {
      drifts.push({
        type: 'scope_creep',
        severity: 'major',
        planExpectation: null,
        actualCode: file,
        deviation: 'Code not in plan'
      });
    }
  }
  
  return { drifts, summary: summarize(drifts) };
}
```

---

## Drift Correction

### Correction Strategies

| Drift Type | Minor Correction | Major Correction |
|------------|------------------|------------------|
| Feature Drift | Auto-fix code | Decision: fix code OR update plan |
| Scope Creep | Flag for removal | User decision: keep or remove |
| Missing Requirement | Create high-priority task | Immediate implementation |
| API Drift | Auto-sync spec | Regenerate API layer |
| Schema Drift | Migration script | Manual review required |
| Test Drift | Generate tests | Full test review |
| Dependency Drift | Auto-remove | Check for breaking changes |

### Correction Flow

```
┌─────────────────┐
│ Drift Detected  │
└────────┬────────┘
         │
    ┌────▼────┐
    │ Minor?  │──── Yes ────► Auto-Correct (with user confirm)
    └────┬────┘
         │ No (Major)
         ▼
    ┌────────────┐
    │  Present   │
    │  Options   │
    └─────┬──────┘
          │
    ┌─────▼─────┐
    │ Fix Code  │──── Update code to match plan
    ├───────────┤
    │Update Plan│──── Update plan to match code
    ├───────────┤
    │   Split   │──── Some code changes, some plan changes
    └───────────┘
```

### Auto-Correction Rules

1. **Never delete user code** without confirmation
2. **Always create backup** before correction
3. **Run tests** after any correction
4. **Rollback** if tests fail
5. **Notify user** of all automatic corrections

---

## Complex Problem Decomposition

### Decomposition Patterns

| Problem Type | Decomposition Strategy |
|--------------|------------------------|
| Multi-file refactor | Split by file, maintain order |
| Cross-system integration | Interface first, then implementations |
| Performance optimization | Profile → identify → fix, one at a time |
| Security hardening | OWASP top 10, one vulnerability at a time |
| Database migration | Schema → data → code, with rollback points |

### Problem Decomposition Algorithm

```typescript
interface DecomposedProblem {
  originalProblem: string;
  subTasks: {
    id: string;
    title: string;
    description: string;
    estimatedMinutes: number;
    
    dependencies: string[];       // IDs of prerequisite tasks
    canParallelize: boolean;      // Can run alongside others
    routeToAgent: string;         // Best agent for this task
    
    inputs: string[];             // What this needs
    outputs: string[];            // What this produces
    
    rollbackPossible: boolean;    // Can be undone
    rollbackSteps?: string[];     // How to undo
  }[];
  
  executionOrder: string[][];     // Groups that can run in parallel
  totalEstimate: number;
  complexity: 'simple' | 'medium' | 'complex';
}

async function decomposeProblem(problem: string): Promise<DecomposedProblem> {
  // 1. Identify problem type
  const problemType = classifyProblem(problem);
  
  // 2. Apply decomposition pattern
  const subTasks = applyPattern(problemType, problem);
  
  // 3. Analyze dependencies
  const dependencies = findDependencies(subTasks);
  
  // 4. Identify parallel opportunities
  const parallelGroups = findParallelGroups(subTasks, dependencies);
  
  // 5. Route to agents
  const routedTasks = routeToAgents(subTasks);
  
  // 6. Ensure each task is simple enough
  const simpleTasks = subTasks.map(task => 
    isSimpleEnough(task) ? task : decomposeFurther(task)
  ).flat();
  
  return {
    originalProblem: problem,
    subTasks: simpleTasks,
    executionOrder: parallelGroups,
    totalEstimate: sum(simpleTasks.map(t => t.estimatedMinutes)),
    complexity: calculateComplexity(simpleTasks)
  };
}
```

### "Simple Enough" Criteria

Each sub-task must:
- Be completable in <60 minutes
- Affect <5 files
- Have <3 dependencies
- Be describable in 1-2 sentences
- Have clear acceptance criteria
- Be rollback-able

---

## Dead Code Detection

### Detection Categories

| Category | Detection Method | Confidence |
|----------|------------------|------------|
| Unused functions | No call sites in codebase | High |
| Unused variables | Declared but never read | High |
| Unused imports | Imported but not used | High |
| Unreachable code | After return/throw | High |
| Commented code | Large comment blocks | Medium |
| Deprecated code | @deprecated tag | High |
| Duplicate code | AST similarity | Medium |
| Empty files | No meaningful content | High |

### Dead Code Report

```typescript
interface DeadCodeReport {
  timestamp: string;
  scannedFiles: number;
  scannedLines: number;
  
  deadCode: {
    id: string;
    category: DeadCodeCategory;
    confidence: number;          // 0-100
    
    location: {
      file: string;
      startLine: number;
      endLine: number;
    };
    
    code: string;               // The dead code
    reason: string;             // Why it's dead
    
    safeToRemove: boolean;
    removalRisk: 'none' | 'low' | 'medium' | 'high';
    
    // For duplicates
    duplicateOf?: {
      file: string;
      line: number;
    };
  }[];
  
  summary: {
    totalItems: number;
    byCategory: Record<DeadCodeCategory, number>;
    totalDeadLines: number;
    estimatedRemovableLines: number;
    highConfidenceItems: number;
  };
}
```

### Exclusion Rules

Do NOT flag as dead code:
- Exported APIs (might be used externally)
- Test utilities
- Type definitions
- Interface declarations (might be used for typing)
- Files matching `.d.ts`
- Files in `__mocks__`
- Config files

---

## Code Cleanup Workflow

### Cleanup Modes

| Mode | Description | When to Use |
|------|-------------|-------------|
| Interactive | Confirm each removal | First-time cleanup |
| Safe Auto | Remove only confidence >95% | Regular maintenance |
| Aggressive | Remove all detected | Major refactor |

### Cleanup Flow

```
┌─────────────────┐
│ Run Detection   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Create Backup   │ ◄──── ALWAYS
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Filter by Mode  │
└────────┬────────┘
         │
    ┌────▼────┐
    │ Remove  │
    │ Items   │
    └────┬────┘
         │
         ▼
┌─────────────────┐
│  Run Tests      │
└────────┬────────┘
         │
    Pass │  │ Fail
         │  └─────► Rollback + Report
         ▼
┌─────────────────┐
│ Cleanup Report  │
└─────────────────┘
```

### Cleanup Safety Rules

1. **Create git branch** before any removal
2. **Never delete** without passing tests
3. **Batch removals** by file (atomic per file)
4. **Log everything** for audit
5. **Keep removed code** in separate file for 30 days

### Rollback Procedure

```typescript
async function rollback(cleanupId: string): Promise<void> {
  // 1. Identify backup
  const backup = await getBackup(cleanupId);
  
  // 2. Restore all removed files
  for (const file of backup.removedFiles) {
    await restoreFile(file);
  }
  
  // 3. Revert modifications
  for (const mod of backup.modifications) {
    await revertModification(mod);
  }
  
  // 4. Verify tests pass
  const testResult = await runTests();
  if (!testResult.success) {
    throw new Error('Rollback failed - tests still failing');
  }
  
  // 5. Log rollback
  await logRollback(cleanupId, 'success');
}
```

---

## Complete Pipeline Flow

### End-to-End Flow Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                    PLANNING PHASE                                │
├──────────────────────────────────────────────────────────────────┤
│  User creates plan in Planning Wizard                            │
│  ↓                                                               │
│  Plan validated (MT-033.30)                                      │
│  ↓                                                               │
│  Tasks generated from plan (MT-033.26)                           │
│  ↓                                                               │
│  Tasks prioritized and ordered (MT-033.27)                       │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                    HANDOFF PHASE                                 │
├──────────────────────────────────────────────────────────────────┤
│  Create handoff package (MT-033.31)                              │
│  ↓                                                               │
│  Generate context package (MT-033.32)                            │
│  ↓                                                               │
│  Route to coding agent                                           │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                    EXECUTION PHASE                               │
├──────────────────────────────────────────────────────────────────┤
│  Coding agent receives handoff                                   │
│  ↓                                                               │
│  Coding agent implements changes                                 │
│  ↓                                                               │
│  Coding agent creates handback package                           │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                    VALIDATION PHASE                              │
├──────────────────────────────────────────────────────────────────┤
│  Receive handback (MT-033.33)                                    │
│  ↓                                                               │
│  Detect errors (MT-033.34)                                       │
│  ↓                                                               │
│  ┌────────┐                                                      │
│  │ Errors?│── No ──► Continue to drift check                     │
│  └───┬────┘                                                      │
│      │ Yes                                                       │
│      ▼                                                           │
│  Auto-fix attempt (MT-033.35)                                    │
│  ↓                                                               │
│  ┌─────────┐                                                     │
│  │ Fixed?  │── Yes ──► Continue                                  │
│  └────┬────┘                                                     │
│       │ No                                                       │
│       ▼                                                          │
│  Escalate (MT-033.36)                                            │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                    DRIFT CHECK PHASE                             │
├──────────────────────────────────────────────────────────────────┤
│  Detect drift (MT-033.37)                                        │
│  ↓                                                               │
│  ┌────────┐                                                      │
│  │ Drift? │── No ──► Continue to cleanup                         │
│  └───┬────┘                                                      │
│      │ Yes                                                       │
│      ▼                                                           │
│  Correct drift (MT-033.38)                                       │
│  ↓                                                               │
│  Update plan OR fix code                                         │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                    CLEANUP PHASE                                 │
├──────────────────────────────────────────────────────────────────┤
│  Detect dead code (MT-033.40)                                    │
│  ↓                                                               │
│  Safe removal (MT-033.41)                                        │
│  ↓                                                               │
│  Verify tests pass                                               │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                    COMPLETION                                    │
├──────────────────────────────────────────────────────────────────┤
│  Mark task complete                                              │
│  ↓                                                               │
│  Update metrics                                                  │
│  ↓                                                               │
│  Move to next task (or branch if parallel)                       │
└──────────────────────────────────────────────────────────────────┘
```

### Pipeline Test Scenarios (MT-033.42)

| Scenario | Description | Expected Result |
|----------|-------------|-----------------|
| Happy path | No errors, no drift | Complete in single pass |
| Auto-fixable error | Missing import | Fix applied, tests pass |
| Unfixable error | Logic error | Escalated to Level 2 |
| Minor drift | Small deviation | Auto-corrected |
| Major drift | Scope creep | User decision requested |
| Dead code found | Unused function | Safely removed |
| Network failure | Handoff timeout | Retry with same package |
| Test failure after fix | Fix broke something | Rollback, escalate |
| Circular dependency | A needs B needs A | Detected and rejected in planning |

---

## Appendix: File Locations

| Service | Location |
|---------|----------|
| Coding Handoff | `src/services/codingHandoff.ts` |
| Context Packager | `src/services/contextPackager.ts` |
| Coding Handback | `src/services/codingHandback.ts` |
| Error Detector | `src/services/errorDetector.ts` |
| Auto Fixer | `src/services/autoFixer.ts` |
| Error Escalation | `src/services/errorEscalation.ts` |
| Drift Detector | `src/services/driftDetector.ts` |
| Drift Corrector | `src/services/driftCorrector.ts` |
| Problem Decomposer | `src/services/problemDecomposer.ts` |
| Dead Code Detector | `src/services/deadCodeDetector.ts` |
| Code Cleanup | `src/services/codeCleanup.ts` |
| Pipeline Tests | `tests/integration.spec/executionPipeline.spec.ts` |
