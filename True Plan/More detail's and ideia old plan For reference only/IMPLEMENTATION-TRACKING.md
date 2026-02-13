# Implementation Tracking System

> Keeps plan folder, PRD, and codebase in perfect sync. Answers "what's been coded?" and "what's left to do?"

**Version**: 1.0.0  
**Last Updated**: 2025-01-XX  
**Related Tasks**: MT-033.43-50

---

## Table of Contents

1. [Overview](#overview)
2. [Implementation Status Tracker](#implementation-status-tracker)
3. [Plan Folder Auto-Updater](#plan-folder-auto-updater)
4. [PRD Sync System](#prd-sync-system)
5. [Coding Agent Task Specifications](#coding-agent-task-specifications)
6. [Implementation Dashboard](#implementation-dashboard)
7. [Plan-to-Code Bidirectional Links](#plan-to-code-bidirectional-links)
8. [Plan Change Propagation](#plan-change-propagation)
9. [Testing the Sync System](#testing-the-sync-system)

---

## Overview

### The Problem

Without tracking:
- Plan says "implement X" but X was done 2 weeks ago
- Code exists that's not in any plan (undocumented)
- PRD status badges are stale
- Coding agent gets incomplete task specs
- No clear view of "what's been coded" vs "what's planned"

### The Solution

```
┌─────────────────────────────────────────────────────────────┐
│              IMPLEMENTATION TRACKING SYSTEM                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │  CODEBASE   │ ←→ │   TRACKER   │ ←→ │    PLAN     │     │
│  │  (src/)     │    │  (linker)   │    │   (Docs/)   │     │
│  └─────────────┘    └──────┬──────┘    └─────────────┘     │
│                            │                               │
│                     ┌──────▼──────┐                        │
│                     │   PRD.md    │                        │
│                     │  (status)   │                        │
│                     └─────────────┘                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Status Tracker

### Purpose
Scans codebase and plan files to determine what's been implemented.

### Status Categories

| Status | Icon | Description |
|--------|------|-------------|
| Implemented | ✅ | Code exists and matches plan |
| Not Started | ⬜ | In plan, no code yet |
| In Progress | 🔄 | Partially implemented |
| Undocumented | ❓ | Code exists, not in plan |
| Stale | ⚠️ | Code exists, plan says not done |

### Status Report Format

```json
{
  "generatedAt": "2025-01-20T10:30:00Z",
  "summary": {
    "totalPlannedItems": 442,
    "implemented": 66,
    "notStarted": 376,
    "inProgress": 0,
    "undocumented": 3,
    "stale": 0
  },
  "percentComplete": 14.9,
  "items": [
    {
      "planRef": "MT-001.1",
      "title": "Create logger.ts with logging functions",
      "status": "implemented",
      "codeFiles": ["src/logger.ts"],
      "tests": ["tests/logger.test.ts"],
      "completedDate": "2025-01-15",
      "prdRef": "Section 3.5"
    },
    {
      "planRef": "MT-012.5",
      "title": "Add plan context to orchestrator",
      "status": "not_started",
      "codeFiles": [],
      "tests": [],
      "estimatedMinutes": 35,
      "dependencies": ["MT-012.1"]
    },
    {
      "codeFile": "src/utils/helpers.ts",
      "status": "undocumented",
      "planRef": null,
      "suggestion": "Could be MT-003.X or new task needed"
    }
  ],
  "byStage": {
    "Stage 1": { "total": 27, "complete": 9, "percent": 33.3 },
    "Stage 2": { "total": 32, "complete": 25, "percent": 78.1 },
    "Stage 3": { "total": 49, "complete": 20, "percent": 40.8 }
  }
}
```

### Detection Algorithm

```typescript
interface ImplementationMatch {
  planItem: PlanItem;
  codeEvidence: CodeEvidence[];
  confidence: number; // 0-100
  status: ImplementationStatus;
}

async function detectImplementation(plan: Plan, codebase: Codebase): Promise<ImplementationMatch[]> {
  const matches: ImplementationMatch[] = [];
  
  for (const planItem of plan.items) {
    // 1. Look for exact file matches
    const expectedFiles = extractExpectedFiles(planItem);
    const foundFiles = expectedFiles.filter(f => codebase.hasFile(f));
    
    // 2. Look for @task JSDoc tags
    const taggedCode = codebase.findByTaskTag(planItem.id);
    
    // 3. Look for semantic matches (function names, class names)
    const semanticMatches = findSemanticMatches(planItem, codebase);
    
    // 4. Calculate confidence
    const confidence = calculateConfidence(foundFiles, taggedCode, semanticMatches);
    
    // 5. Determine status
    const status = determineStatus(planItem, confidence, foundFiles);
    
    matches.push({
      planItem,
      codeEvidence: [...foundFiles, ...taggedCode, ...semanticMatches],
      confidence,
      status
    });
  }
  
  // 6. Find undocumented code
  const plannedFiles = new Set(matches.flatMap(m => m.codeEvidence.map(e => e.file)));
  for (const file of codebase.files) {
    if (!plannedFiles.has(file) && isFeatureCode(file)) {
      matches.push({
        planItem: null,
        codeEvidence: [{ file, type: 'undocumented' }],
        confidence: 100,
        status: 'undocumented'
      });
    }
  }
  
  return matches;
}
```

---

## Plan Folder Auto-Updater

### Update Triggers

| Trigger | Action |
|---------|--------|
| Task marked complete | Check task checkbox in PROJECT-BREAKDOWN |
| File created | Prompt to link to plan item |
| Feature complete | Update PRD status badge |
| Test coverage change | Update coverage stats |
| Git commit | Scan for implementation changes |

### Update Rules

```yaml
# Plan update rules
rules:
  - trigger: task_complete
    action: 
      - check_checkbox: "PROJECT-BREAKDOWN & TODO List .md"
      - update_actual_time: "Replace [actual: __ min] with actual time"
      - update_stage_progress: "Recalculate stage completion %"
      
  - trigger: file_created
    condition: file_is_feature_code
    action:
      - detect_plan_item: "Match to existing plan item"
      - if_no_match: "Prompt user to link or create task"
      
  - trigger: feature_complete
    condition: all_feature_tasks_done
    action:
      - update_prd: "Change 🔄 to ✅"
      - check_stage_gate: "See if stage is complete"
      
  - trigger: coverage_change
    action:
      - update_coverage_stats: "In PROJECT-BREAKDOWN header"
```

### Safety Mechanisms

```typescript
interface PlanUpdate {
  file: string;
  changes: Change[];
  backup: string;       // Backup file path
  preview: string;      // Diff preview
  canRollback: boolean;
}

async function applyPlanUpdate(update: PlanUpdate): Promise<void> {
  // 1. Create backup
  await createBackup(update.file, update.backup);
  
  // 2. Show preview (if interactive mode)
  if (isInteractive()) {
    const approved = await showDiffPreview(update.preview);
    if (!approved) return;
  }
  
  // 3. Apply changes atomically
  try {
    await applyChangesAtomic(update.file, update.changes);
  } catch (error) {
    // 4. Rollback on failure
    await restoreFromBackup(update.backup);
    throw error;
  }
  
  // 5. Validate plan still parses
  const valid = await validatePlanFile(update.file);
  if (!valid) {
    await restoreFromBackup(update.backup);
    throw new Error('Plan update corrupted file structure');
  }
  
  // 6. Keep backup for 24 hours
  scheduleBackupCleanup(update.backup, '24h');
}
```

---

## PRD Sync System

### Sections to Sync

| PRD Section | Sync Source | Update Frequency |
|-------------|-------------|------------------|
| Section 3: Core Features | Task completion | Real-time |
| Section 4: Technical Requirements | package.json, tsconfig | On file change |
| Section 5: Milestones | Stage completion | On stage gate |
| Section 6: Dependencies | package.json | On npm install |

### Status Badge Rules

```typescript
type PRDStatus = '✅ Complete' | '🔄 In Progress' | '⏳ Queued' | '❌ Blocked';

function calculateFeatureStatus(featureTasks: Task[]): PRDStatus {
  const total = featureTasks.length;
  const complete = featureTasks.filter(t => t.status === 'complete').length;
  const blocked = featureTasks.some(t => t.status === 'blocked');
  
  if (blocked) return '❌ Blocked';
  if (complete === 0) return '⏳ Queued';
  if (complete === total) return '✅ Complete';
  return '🔄 In Progress';
}
```

### Conflict Detection

```typescript
interface PRDConflict {
  type: 'status_mismatch' | 'missing_feature' | 'description_drift';
  prdState: string;
  codeState: string;
  suggestedFix: string;
}

async function detectPRDConflicts(prd: PRD, codebase: Codebase): Promise<PRDConflict[]> {
  const conflicts: PRDConflict[] = [];
  
  for (const feature of prd.features) {
    // Status says complete but tests fail
    if (feature.status === '✅ Complete') {
      const tests = await runFeatureTests(feature);
      if (!tests.allPass) {
        conflicts.push({
          type: 'status_mismatch',
          prdState: '✅ Complete',
          codeState: 'Tests failing',
          suggestedFix: 'Revert to 🔄 In Progress or fix tests'
        });
      }
    }
    
    // PRD describes feature differently than implementation
    const implementation = findImplementation(codebase, feature);
    if (implementation && !matchesDescription(implementation, feature.description)) {
      conflicts.push({
        type: 'description_drift',
        prdState: feature.description,
        codeState: describeImplementation(implementation),
        suggestedFix: 'Update PRD description or fix code'
      });
    }
  }
  
  // Code exists that's not in PRD
  const undocumentedFeatures = findUndocumentedFeatures(codebase, prd);
  for (const feature of undocumentedFeatures) {
    conflicts.push({
      type: 'missing_feature',
      prdState: 'Not documented',
      codeState: feature.description,
      suggestedFix: `Add feature to PRD Section 3`
    });
  }
  
  return conflicts;
}
```

---

## Coding Agent Task Specifications

### Specification Template

Every task sent to a coding agent includes this specification:

```markdown
## Task: {task_id} - {task_title}

**Type**: {create | modify | fix | refactor | delete | test}  
**Priority**: {P0 | P1 | P2 | P3}  
**Estimated Time**: {minutes} min  
**Depends On**: {dependency_ids}

### Context
{brief_context_about_why_this_task_exists}

### Files to {Create | Modify | Delete}

| File | Action | Purpose |
|------|--------|---------|
| {file_path} | {create/modify/delete} | {description} |

### Code Patterns to Follow

1. **Pattern Name**: {link_to_example}
   - Description: {what_the_pattern_does}
   - Apply: {how_to_apply_to_this_task}

### Tests to Write

| Test | Description | Expected Result |
|------|-------------|-----------------|
| Test 1 | {what_to_test} | {expected_outcome} |

### Acceptance Criteria

- [ ] {measurable_criterion_1}
- [ ] {measurable_criterion_2}
- [ ] {measurable_criterion_3}
- [ ] All tests pass
- [ ] No TypeScript errors
- [ ] ≥{coverage}% coverage on new code

### Constraints

**MUST**:
- {required_pattern_or_library}

**MUST NOT**:
- {files_not_to_modify}
- {libraries_not_to_use}

### Related Items

- **Plan Reference**: PROJECT-BREAKDOWN #{section}
- **PRD Reference**: PRD.md Section {number}
- **Similar Code**: {link_to_similar_implementation}
```

### Spec Generation Rules

```typescript
async function generateTaskSpec(task: Task): Promise<TaskSpec> {
  // 1. Determine task type
  const type = inferTaskType(task);
  
  // 2. Find files involved
  const files = extractFilesFromDescription(task.description);
  
  // 3. Find code patterns
  const patterns = findSimilarPatterns(task, codebase);
  
  // 4. Generate test specs
  const tests = generateTestSpecs(task, type);
  
  // 5. Extract acceptance criteria
  const criteria = extractCriteria(task.description);
  
  // 6. Identify constraints
  const constraints = inferConstraints(task, codebase);
  
  // 7. Find related items
  const related = {
    planRef: findPlanReference(task),
    prdRef: findPRDReference(task),
    similarCode: findSimilarImplementation(task)
  };
  
  return {
    taskId: task.id,
    title: task.title,
    type,
    priority: task.priority,
    estimatedMinutes: task.estimatedMinutes,
    dependencies: task.dependencies,
    context: task.description,
    files,
    patterns,
    tests,
    criteria,
    constraints,
    related
  };
}
```

### Example Generated Spec

```markdown
## Task: MT-012.5 - Add plan context to orchestrator

**Type**: modify  
**Priority**: P0  
**Estimated Time**: 35 min  
**Depends On**: MT-012.1

### Context
The orchestrator needs access to the project plan to make intelligent routing decisions. Currently it routes tasks without knowing the overall project structure.

### Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/services/orchestrator.ts` | modify | Add loadPlanContext() method |
| `src/config/schema.ts` | modify | Add planPath config option |
| `tests/orchestrator.test.ts` | modify | Add tests for plan loading |

### Code Patterns to Follow

1. **Singleton Pattern**: See `src/services/ticketDb.ts`
   - Description: Module-level instance with init/get/reset functions
   - Apply: Use same pattern for plan context loading

2. **Config Loading**: See `src/config/loader.ts#loadConfig`
   - Description: Read JSON file, validate with Zod, return typed object
   - Apply: Same approach for plan.json

### Tests to Write

| Test | Description | Expected Result |
|------|-------------|-----------------|
| Test 1 | loadPlanContext() with valid file | Returns parsed Plan object |
| Test 2 | loadPlanContext() with missing file | Throws ConfigError |
| Test 3 | loadPlanContext() with invalid JSON | Throws ConfigError |
| Test 4 | Orchestrator uses plan in routing | Routes based on plan priorities |

### Acceptance Criteria

- [ ] loadPlanContext() returns valid Plan object
- [ ] Config schema includes planPath with Zod validation
- [ ] Error handling for missing/invalid plan file
- [ ] All 4 tests pass
- [ ] No TypeScript errors
- [ ] ≥80% coverage on new code

### Constraints

**MUST**:
- Use existing singleton pattern from ticketDb.ts
- Use Zod for plan schema validation
- Add JSDoc with @task MT-012.5

**MUST NOT**:
- Modify ticketDb.ts
- Add new npm dependencies
- Change orchestrator's public API

### Related Items

- **Plan Reference**: PROJECT-BREAKDOWN #stage-4-planning-agent
- **PRD Reference**: PRD.md Section 3.1
- **Similar Code**: src/config/loader.ts (config loading pattern)
```

---

## Implementation Dashboard

### Dashboard Views

```
┌──────────────────────────────────────────────────────────────┐
│          IMPLEMENTATION DASHBOARD                            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Overall: ██████████░░░░░░░░░░ 49.5% (219/442)              │
│                                                              │
│  BY STAGE:                                                   │
│  ├─ Stage 1 ████████████████████ 100% (27/27) ✅            │
│  ├─ Stage 2 ████████████████████ 100% (32/32) ✅            │
│  ├─ Stage 3 ████████████████░░░░  80% (39/49) 🔄            │
│  ├─ Stage 4 ██████░░░░░░░░░░░░░░  30% (18/61) 🔄            │
│  ├─ Stage 5 ░░░░░░░░░░░░░░░░░░░░   0% (0/52) ⬜             │
│  ├─ Stage 6 ░░░░░░░░░░░░░░░░░░░░   0% (0/45) ⬜             │
│  └─ Stage 7 ░░░░░░░░░░░░░░░░░░░░   0% (0/176) ⬜            │
│                                                              │
│  BY AREA:                                                    │
│  ├─ Services    ████████████░░░░░░  60% (24/40)             │
│  ├─ UI          ██████░░░░░░░░░░░░  30% (15/50)             │
│  ├─ Agents      ████████░░░░░░░░░░  40% (20/50)             │
│  ├─ MCP         ████████████████░░  80% (32/40)             │
│  └─ Config      ████████████████████ 100% (18/18)           │
│                                                              │
│  RECENT COMPLETIONS:                                         │
│  • MT-001.10: Config system with Zod (2 hours ago)          │
│  • MT-002.3: LLM streaming timeout (yesterday)              │
│  • MT-003.5: Tree view refresh (2 days ago)                 │
│                                                              │
│  NEXT UP (highest priority):                                 │
│  • MT-012.5: Add plan context to orchestrator [P0]          │
│  • MT-014.2: Answer agent conversation history [P0]         │
│  • MT-006.8: Ticket migration system [P0]                   │
│                                                              │
│  ⚠️ UNDOCUMENTED CODE (3 files):                            │
│  • src/utils/helpers.ts                                     │
│  • src/utils/formatting.ts                                  │
│  • src/debug/inspector.ts                                   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Dashboard Interactions

- **Click stage** → Drill down to master ticket list
- **Click master ticket** → Drill down to task list
- **Click task** → Opens task detail with code links
- **Click undocumented file** → Prompts to link to task
- **Export** → Generates markdown or JSON report

---

## Plan-to-Code Bidirectional Links

### In Code (JSDoc Tags)

```typescript
/**
 * Loads plan context from the filesystem.
 * 
 * **Simple explanation**: Reads the project plan so orchestrator knows what to do.
 * 
 * @task MT-012.5
 * @plan PROJECT-BREAKDOWN#stage-4-planning-agent
 * @prd PRD.md#section-3.1
 */
export async function loadPlanContext(): Promise<Plan> {
  // ...
}
```

### In Plan (Code Links)

```markdown
- [x] **MT-012.5**: Add plan context to orchestrator (35 min)
  - **Files**: [src/services/orchestrator.ts#loadPlanContext](../../src/services/orchestrator.ts#L42)
  - **Tests**: [tests/orchestrator.test.ts#plan-loading](../../tests/orchestrator.test.ts#L156)
```

### Link Validation

```typescript
interface LinkValidation {
  valid: boolean;
  brokenLinks: BrokenLink[];
  suggestions: LinkSuggestion[];
}

async function validateLinks(): Promise<LinkValidation> {
  const brokenLinks: BrokenLink[] = [];
  const suggestions: LinkSuggestion[] = [];
  
  // Check plan → code links
  for (const planItem of plan.items) {
    for (const codeLink of planItem.codeLinks) {
      if (!await codebase.hasFile(codeLink.file)) {
        brokenLinks.push({
          source: planItem.id,
          target: codeLink,
          reason: 'File not found'
        });
      }
    }
  }
  
  // Check code → plan links
  for (const file of codebase.files) {
    const taskTags = extractTaskTags(file);
    for (const tag of taskTags) {
      if (!plan.hasItem(tag.taskId)) {
        brokenLinks.push({
          source: file,
          target: tag.taskId,
          reason: 'Task ID not found in plan'
        });
      }
    }
  }
  
  // Suggest links for unlinked items
  for (const planItem of plan.items.filter(i => i.codeLinks.length === 0)) {
    const possibleMatches = findPossibleMatches(planItem, codebase);
    if (possibleMatches.length > 0) {
      suggestions.push({
        planItem: planItem.id,
        possibleFiles: possibleMatches,
        confidence: calculateConfidence(possibleMatches)
      });
    }
  }
  
  return {
    valid: brokenLinks.length === 0,
    brokenLinks,
    suggestions
  };
}
```

---

## Plan Change Propagation

### Cascade Rules

```yaml
# When plan changes, cascade updates
propagation:
  task_added:
    - update: stage_task_count
    - update: total_task_count
    - update: completion_percentage
    - create: coding_agent_spec
    
  task_removed:
    - flag: orphaned_code_files
    - update: stage_task_count
    - update: total_task_count
    - update: completion_percentage
    
  task_completed:
    - check: task_checkbox
    - update: stage_completion
    - update: total_completion
    - check: stage_gate_criteria
    - update: prd_feature_status
    
  feature_added:
    - create: plan_tasks
    - update: prd_features
    - update: stage_gate
    
  feature_removed:
    - flag: orphaned_tasks
    - flag: orphaned_code
    - update: prd_features
    
  stage_complete:
    - unlock: next_stage
    - update: prd_milestones
    - notify: user
```

### Impact Analysis

Before applying any change, show impact:

```
┌────────────────────────────────────────────────────────────┐
│              CHANGE IMPACT ANALYSIS                        │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Proposed Change: Add 5 tasks to MT-012                    │
│                                                            │
│  IMPACT:                                                   │
│  ├─ Stage 4 tasks: 61 → 66 (+5)                           │
│  ├─ Total tasks: 442 → 447 (+5)                           │
│  ├─ Overall progress: 14.9% → 14.8% (-0.1%)               │
│  ├─ Stage 4 ETA: +2.5 hours                               │
│  └─ Dependent tasks affected: 3                           │
│                                                            │
│  FILES TO UPDATE:                                          │
│  ├─ PROJECT-BREAKDOWN & TODO List .md (5 locations)       │
│  ├─ PRD.md (1 location)                                   │
│  └─ CONSOLIDATED-MASTER-PLAN.md (2 locations)             │
│                                                            │
│  [Apply Changes]  [Preview Diff]  [Cancel]                │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## Testing the Sync System

### Test Scenarios

| Scenario | Steps | Expected Result |
|----------|-------|-----------------|
| Task completion | Mark task complete → verify checkbox | ✅ checked in plan |
| PRD auto-update | Complete feature → check PRD | Badge shows ✅ |
| Broken link detection | Delete file → run validation | Error flagged |
| Undocumented code | Create file without plan link | Shows in dashboard |
| Spec generation | Generate spec for task | All sections populated |
| Change cascade | Add 5 tasks → check metrics | All counts updated |

### Integration Test Example

```typescript
describe('Documentation Sync', () => {
  it('Test 1: should auto-check task when marked complete', async () => {
    // Arrange
    const taskId = 'MT-012.5';
    const beforeState = await readPlanFile();
    expect(beforeState).toContain('- [ ] **MT-012.5**');
    
    // Act
    await markTaskComplete(taskId);
    
    // Assert
    const afterState = await readPlanFile();
    expect(afterState).toContain('- [x] **MT-012.5**');
  });
  
  it('Test 2: should update PRD when feature completes', async () => {
    // Arrange - complete all tasks for a feature
    await completeAllTasksFor('Multi-Agent Orchestration');
    
    // Act - trigger sync
    await syncPRD();
    
    // Assert
    const prd = await readPRD();
    expect(prd).toContain('**Status**: ✅ Complete');
  });
  
  it('Test 3: should detect undocumented code', async () => {
    // Arrange - create file without plan link
    await createFile('src/utils/undocumented.ts', 'export const x = 1;');
    
    // Act
    const status = await runImplementationTracker();
    
    // Assert
    expect(status.undocumented).toContain('src/utils/undocumented.ts');
  });
  
  it('Test 4: should cascade task count changes', async () => {
    // Arrange
    const beforeMetrics = await getMetrics();
    
    // Act - add task
    await addTaskToPlan('MT-012.99', 'New task');
    
    // Assert - all metrics updated
    const afterMetrics = await getMetrics();
    expect(afterMetrics.totalTasks).toBe(beforeMetrics.totalTasks + 1);
    expect(afterMetrics.stage4Tasks).toBe(beforeMetrics.stage4Tasks + 1);
  });
});
```

---

## File Locations

| Service | Location |
|---------|----------|
| Implementation Tracker | `src/services/implementationTracker.ts` |
| Plan Updater | `src/services/planUpdater.ts` |
| PRD Sync | `src/services/prdSync.ts` |
| Task Spec Generator | `src/services/taskSpecGenerator.ts` |
| Implementation Dashboard | `src/ui/implementationDashboard.ts` |
| Plan-Code Linker | `src/services/planCodeLinker.ts` |
| Plan Propagator | `src/services/planPropagator.ts` |
| Sync Tests | `tests/integration.spec/documentationSync.spec.ts` |
