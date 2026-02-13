import { TaskDecompositionEngine } from '../src/core/task-decomposition-engine';
import {
    Task, TaskStatus, TaskPriority,
    DecompositionStrategy, DecompositionRule,
    TaskMetadata, SubtaskCategory, SubtaskDefinition
} from '../src/types';

// ============================================================
// Helper: Build a mock Task with sensible defaults
// ============================================================

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: overrides.id ?? 'task-001',
        title: overrides.title ?? 'Default test task',
        description: overrides.description ?? 'A task used for testing.',
        status: overrides.status ?? TaskStatus.NotStarted,
        priority: overrides.priority ?? TaskPriority.P2,
        dependencies: overrides.dependencies ?? [],
        acceptance_criteria: overrides.acceptance_criteria ?? 'Tests pass',
        plan_id: overrides.plan_id ?? null,
        parent_task_id: overrides.parent_task_id ?? null,
        estimated_minutes: overrides.estimated_minutes ?? 30,
        files_modified: overrides.files_modified ?? [],
        context_bundle: overrides.context_bundle ?? null,
        sort_order: overrides.sort_order ?? 0,
        created_at: overrides.created_at ?? new Date().toISOString(),
        updated_at: overrides.updated_at ?? new Date().toISOString(),
    };
}

// ============================================================
// Tests
// ============================================================

describe('TaskDecompositionEngine', () => {
    let engine: TaskDecompositionEngine;

    beforeEach(() => {
        engine = new TaskDecompositionEngine();
    });

    // ----------------------------------------------------------
    // 1. needsDecomposition
    // ----------------------------------------------------------

    describe('needsDecomposition', () => {
        test('returns true for task with >45 estimated minutes', () => {
            const task = makeTask({ estimated_minutes: 60 });
            expect(engine.needsDecomposition(task)).toBe(true);
        });

        test('returns true for task with >3 files', () => {
            const task = makeTask({
                estimated_minutes: 20,
                files_modified: [
                    'src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'
                ],
            });
            expect(engine.needsDecomposition(task)).toBe(true);
        });

        test('returns true for task with >10 component references', () => {
            // Build a description that mentions many distinct component-type keywords
            const task = makeTask({
                estimated_minutes: 20,
                description:
                    'Create button, input, modal, dialog, card, sidebar, header, footer, nav, panel, form, table, list widgets for the dashboard.',
            });
            expect(engine.needsDecomposition(task)).toBe(true);
        });

        test('returns false for small atomic task', () => {
            const task = makeTask({
                estimated_minutes: 15,
                files_modified: ['src/one.ts'],
                description: 'Fix a small bug in one file.',
            });
            expect(engine.needsDecomposition(task)).toBe(false);
        });
    });

    // ----------------------------------------------------------
    // 2. ByFile Rule
    // ----------------------------------------------------------

    describe('ByFile rule', () => {
        test('splits a 5-file task into 5 per-file subtasks + 1 integration', () => {
            const files = [
                'src/core/database.ts',
                'src/core/llm-service.ts',
                'src/agents/orchestrator.ts',
                'src/mcp/server.ts',
                'src/commands.ts',
            ];
            const task = makeTask({
                estimated_minutes: 60,
                files_modified: files,
                title: 'Refactor core modules',
            });

            const result = engine.decompose(task);

            expect(result).not.toBeNull();
            expect(result!.strategy).toBe(DecompositionStrategy.ByFile);
            // 5 file subtasks + 1 integration subtask
            expect(result!.subtasks.length).toBe(6);
        });

        test('each per-file subtask references the correct file', () => {
            const files = [
                'src/core/database.ts',
                'src/core/config.ts',
                'src/agents/planning.ts',
                'src/mcp/server.ts',
            ];
            const task = makeTask({
                estimated_minutes: 50,
                files_modified: files,
                title: 'Update config handling',
            });

            const result = engine.decompose(task);
            expect(result).not.toBeNull();

            // First N subtasks (one per file) should reference the matching file
            for (let i = 0; i < files.length; i++) {
                const st = result!.subtasks[i];
                expect(st.filesToModify).toContain(files[i]);
                expect(st.title).toContain(files[i].split('/').pop());
            }
        });

        test('detects files mentioned only in description text', () => {
            const task = makeTask({
                estimated_minutes: 40,
                files_modified: [],
                description:
                    'Modify src/core/database.ts and src/core/llm-service.ts and src/agents/orchestrator.ts and src/mcp/server.ts to support new protocol.',
            });

            const result = engine.decompose(task);

            // The engine should extract file paths from description
            // and since there are 4 files, the ByFile rule should match
            expect(result).not.toBeNull();
            expect(result!.strategy).toBe(DecompositionStrategy.ByFile);
            expect(result!.subtasks.length).toBeGreaterThanOrEqual(4);
        });
    });

    // ----------------------------------------------------------
    // 3. ByComponent Rule
    // ----------------------------------------------------------

    describe('ByComponent rule', () => {
        test('splits a design task with >10 components into batches', () => {
            // "isDesignTask" requires >= 2 design keywords
            // "componentCount > 10" requires > 10 distinct component-type keywords
            const task = makeTask({
                estimated_minutes: 30,
                files_modified: ['src/views/plan-builder.ts'],
                title: 'Build visual layout canvas page',
                description:
                    'Design a responsive drag-and-drop component canvas with: ' +
                    'button, input, modal, dialog, card, sidebar, header, footer, nav, panel, form, table, list components.',
            });

            const result = engine.decompose(task);

            expect(result).not.toBeNull();
            expect(result!.strategy).toBe(DecompositionStrategy.ByComponent);
            // Should have multiple component-batch subtasks + a testing subtask
            expect(result!.subtasks.length).toBeGreaterThanOrEqual(2);
            // Last subtask should be a testing phase
            const lastSubtask = result!.subtasks[result!.subtasks.length - 1];
            expect(lastSubtask.category).toBe(SubtaskCategory.Testing);
        });

        test('detects design keywords requiring at least 2 matches', () => {
            // Only one design keyword = not a design task
            // NOTE: hasKeywords uses .includes() so avoid words containing "ui" (e.g., "build", "require")
            // since "ui" is a design keyword
            const taskSingleKeyword = makeTask({
                estimated_minutes: 30,
                description:
                    'Create a database migration for the new schema changes.',
            });

            const metadata = engine.extractMetadata(taskSingleKeyword);
            // No design keywords present => isDesignTask should be false
            expect(metadata.isDesignTask).toBe(false);

            // Now add two design keywords
            const taskTwoKeywords = makeTask({
                estimated_minutes: 30,
                description:
                    'Create a responsive component system with layout grid.',
            });
            const metadata2 = engine.extractMetadata(taskTwoKeywords);
            // "responsive" + "component" + "layout" = 3 design keywords => true
            expect(metadata2.isDesignTask).toBe(true);
        });
    });

    // ----------------------------------------------------------
    // 4. ByPhase Rule
    // ----------------------------------------------------------

    describe('ByPhase rule', () => {
        test('splits a >45min task into Setup/Implement/Test/Integrate', () => {
            const task = makeTask({
                estimated_minutes: 60,
                title: 'Implement feature X',
                description: 'Build the whole feature.',
                files_modified: ['src/feature.ts'],
            });

            const result = engine.decompose(task);

            expect(result).not.toBeNull();
            // With only 1 file the ByFile rule won't fire (needs >3).
            // Complexity won't be very_high for 1 file and 60 min... actually 60 > 45 => very_high
            // But ByPhase has priority 4, ByComplexity has priority 6.
            // Both could match. Let's check:
            // estimated_minutes 60 > 45, fileCount 1, componentCount low
            // extractMetadata: estimatedMinutes > 45 => very_high
            // ByFile: fileCount 1 <= 3, no
            // ByComponent: no (not design task with >10 components)
            // ByPropertyGroup: propertyCount <= 8, no
            // ByPhase: estimated_minutes 60 > 45, YES — this fires first (priority 4)
            expect(result!.strategy).toBe(DecompositionStrategy.ByPhase);
            expect(result!.subtasks.length).toBe(4);

            const titles = result!.subtasks.map(st => st.title);
            expect(titles[0]).toContain('Setup');
            expect(titles[1]).toContain('Core implementation');
            expect(titles[2]).toContain('Testing');
            expect(titles[3]).toContain('Integration');
        });

        test('each phase subtask is between 10 and 45 minutes', () => {
            const task = makeTask({
                estimated_minutes: 90,
                title: 'Build large feature',
                files_modified: ['src/big.ts'],
            });

            const result = engine.decompose(task);
            expect(result).not.toBeNull();

            for (const st of result!.subtasks) {
                // The integration subtask starts at 10 min which gets clamped to 15 by clampSubtaskMinutes
                expect(st.estimatedMinutes).toBeGreaterThanOrEqual(10);
                expect(st.estimatedMinutes).toBeLessThanOrEqual(45);
            }
        });

        test('handles a 90-minute task without exceeding bounds', () => {
            const task = makeTask({
                estimated_minutes: 90,
                title: 'Massive refactor',
                files_modified: ['src/one.ts'],
            });

            const result = engine.decompose(task);
            expect(result).not.toBeNull();
            expect(result!.estimatedTotalMinutes).toBeGreaterThan(0);
            // The total should cover at least 80% of original to be "fully covered"
            // Check the implementation phase gets clamped to max 45
            const implSubtask = result!.subtasks.find(st => st.title.includes('Core implementation'));
            expect(implSubtask).toBeDefined();
            expect(implSubtask!.estimatedMinutes).toBeLessThanOrEqual(45);
        });
    });

    // ----------------------------------------------------------
    // 5. ByComplexity Rule
    // ----------------------------------------------------------

    describe('ByComplexity rule', () => {
        test('splits a very_high complexity task into core + edge cases + testing', () => {
            // To trigger ByComplexity but NOT ByFile or ByPhase:
            // - Need very_high complexity (componentCount > 10 drives this)
            // - fileCount <= 3 (so ByFile doesn't fire)
            // - estimated_minutes <= 45 (so ByPhase doesn't fire)
            // - isDesignTask must be false (so ByComponent doesn't fire)
            // - propertyCount <= 8 (so ByPropertyGroup doesn't fire)
            // - dependencyCount <= 5 (so ByDependency doesn't fire)
            //
            // NOTE: hasKeywords uses .includes() so "button" contains no design keywords,
            // but words like "build" contain "ui". Avoid such words to keep isDesignTask false.
            const task = makeTask({
                estimated_minutes: 40,
                files_modified: ['src/a.ts', 'src/b.ts'],
                title: 'Complex multi-element task',
                description:
                    'Implement button, input, modal, dialog, card, sidebar, header, footer, nav, panel, form elements. ' +
                    'No design or layout work needed.',
            });

            // Verify metadata
            const metadata = engine.extractMetadata(task);
            expect(metadata.estimatedComplexity).toBe('very_high');
            expect(metadata.isDesignTask).toBe(false); // No ByComponent
            expect(metadata.fileCount).toBeLessThanOrEqual(3); // No ByFile

            const result = engine.decompose(task);
            expect(result).not.toBeNull();
            expect(result!.strategy).toBe(DecompositionStrategy.ByComplexity);
            expect(result!.subtasks.length).toBe(3);

            expect(result!.subtasks[0].title).toContain('Core logic');
            expect(result!.subtasks[1].title).toContain('Edge cases');
            expect(result!.subtasks[2].title).toContain('Final testing');
        });

        test('does not trigger for medium complexity', () => {
            const task = makeTask({
                estimated_minutes: 25,
                files_modified: ['src/one.ts'],
                description: 'Fix a small bug in the authentication module.',
            });

            const metadata = engine.extractMetadata(task);
            expect(metadata.estimatedComplexity).not.toBe('very_high');

            const result = engine.decompose(task);
            // No rules should match for this simple task
            expect(result).toBeNull();
        });
    });

    // ----------------------------------------------------------
    // 6. extractMetadata
    // ----------------------------------------------------------

    describe('extractMetadata', () => {
        test('extracts file paths from description text', () => {
            const task = makeTask({
                description: 'Update src/core/database.ts and src/agents/orchestrator.ts',
                files_modified: ['src/mcp/server.ts'],
            });

            const metadata = engine.extractMetadata(task);
            // Should find the 2 from description + 1 from files_modified
            expect(metadata.filesModified).toContain('src/core/database.ts');
            expect(metadata.filesModified).toContain('src/agents/orchestrator.ts');
            expect(metadata.filesModified).toContain('src/mcp/server.ts');
            expect(metadata.fileCount).toBe(3);
        });

        test('detects design keywords (requires >= 2 matches)', () => {
            const taskDesign = makeTask({
                description: 'Build a responsive visual component layout for the dashboard page.',
            });
            const metaDesign = engine.extractMetadata(taskDesign);
            expect(metaDesign.isDesignTask).toBe(true);
            expect(metaDesign.keywordSignals.some(s => s.startsWith('design:'))).toBe(true);

            const taskNotDesign = makeTask({
                description: 'Refactor the database query engine for better performance.',
            });
            const metaNotDesign = engine.extractMetadata(taskNotDesign);
            expect(metaNotDesign.isDesignTask).toBe(false);
        });

        test('detects sync and ethics keywords', () => {
            const syncTask = makeTask({
                description: 'Implement multi-device sync with conflict resolution using P2P and NAS.',
            });
            const syncMeta = engine.extractMetadata(syncTask);
            expect(syncMeta.isSyncTask).toBe(true);
            expect(syncMeta.keywordSignals.some(s => s.startsWith('sync:'))).toBe(true);

            const ethicsTask = makeTask({
                description: 'Add FreedomGuard ethics engine with sensitivity audit and block rules.',
            });
            const ethicsMeta = engine.extractMetadata(ethicsTask);
            expect(ethicsMeta.isEthicsTask).toBe(true);
            expect(ethicsMeta.keywordSignals.some(s => s.startsWith('ethics:'))).toBe(true);
        });

        test('estimates complexity based on files, minutes, and components', () => {
            const lowTask = makeTask({
                estimated_minutes: 15,
                files_modified: ['src/a.ts'],
                description: 'Quick fix.',
            });
            expect(engine.extractMetadata(lowTask).estimatedComplexity).toBe('low');

            const mediumTask = makeTask({
                estimated_minutes: 25,
                files_modified: ['src/a.ts', 'src/b.ts'],
                description: 'Moderate work.',
            });
            expect(engine.extractMetadata(mediumTask).estimatedComplexity).toBe('medium');

            const veryHighTask = makeTask({
                estimated_minutes: 60,
                files_modified: [
                    'src/a.ts', 'src/b.ts', 'src/c.ts',
                    'src/d.ts', 'src/e.ts', 'src/f.ts',
                ],
                description: 'Major rewrite.',
            });
            expect(engine.extractMetadata(veryHighTask).estimatedComplexity).toBe('very_high');
        });
    });

    // ----------------------------------------------------------
    // 7. Rule Priority
    // ----------------------------------------------------------

    describe('Rule priority', () => {
        test('ByFile (priority 1) triggers before ByPhase (priority 4) when both match', () => {
            // Task with >3 files AND >45 minutes => both ByFile and ByPhase match
            const task = makeTask({
                estimated_minutes: 60,
                files_modified: [
                    'src/a.ts', 'src/b.ts', 'src/c.ts',
                    'src/d.ts', 'src/e.ts',
                ],
                title: 'Large multi-file refactor',
            });

            const result = engine.decompose(task);

            expect(result).not.toBeNull();
            expect(result!.strategy).toBe(DecompositionStrategy.ByFile);
        });

        test('first matching rule wins — later rules are skipped', () => {
            // Build a task where ByFile, ByPhase, and ByComplexity all could match
            // ByFile has the lowest priority number (1) so it should win
            const task = makeTask({
                estimated_minutes: 90,
                files_modified: [
                    'src/one.ts', 'src/two.ts', 'src/three.ts',
                    'src/four.ts', 'src/five.ts', 'src/six.ts',
                ],
                title: 'Huge task touching many files',
            });

            const result = engine.decompose(task);

            expect(result).not.toBeNull();
            // ByFile should win since priority 1 < priority 4 (ByPhase) < priority 6 (ByComplexity)
            expect(result!.strategy).toBe(DecompositionStrategy.ByFile);
            // Verify it did NOT choose ByPhase or ByComplexity
            expect(result!.strategy).not.toBe(DecompositionStrategy.ByPhase);
            expect(result!.strategy).not.toBe(DecompositionStrategy.ByComplexity);
        });
    });

    // ----------------------------------------------------------
    // 8. Max Depth
    // ----------------------------------------------------------

    describe('Max depth', () => {
        test('returns null when depth >= 3', () => {
            const task = makeTask({
                estimated_minutes: 90,
                files_modified: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
            });

            expect(engine.decompose(task, 3)).toBeNull();
            expect(engine.decompose(task, 4)).toBeNull();
            expect(engine.decompose(task, 100)).toBeNull();
        });

        test('works normally at depth 0, 1, and 2', () => {
            const task = makeTask({
                estimated_minutes: 90,
                files_modified: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
            });

            const resultDepth0 = engine.decompose(task, 0);
            expect(resultDepth0).not.toBeNull();

            const resultDepth1 = engine.decompose(task, 1);
            expect(resultDepth1).not.toBeNull();

            const resultDepth2 = engine.decompose(task, 2);
            expect(resultDepth2).not.toBeNull();
        });
    });

    // ----------------------------------------------------------
    // 9. Edge Cases
    // ----------------------------------------------------------

    describe('Edge cases', () => {
        test('handles null task gracefully', () => {
            expect(engine.needsDecomposition(null as unknown as Task)).toBe(false);
            expect(engine.decompose(null as unknown as Task)).toBeNull();
        });

        test('returns null for already atomic task (no rules match)', () => {
            const task = makeTask({
                estimated_minutes: 15,
                files_modified: ['src/one.ts'],
                description: 'Tiny fix in one file.',
            });

            const result = engine.decompose(task);
            expect(result).toBeNull();
        });

        test('supports custom rule registration', () => {
            const customRule: DecompositionRule = {
                name: 'always-split',
                priority: 0, // Highest priority — will fire before all built-ins
                strategy: DecompositionStrategy.ByPhase,
                condition: () => true,
                decompose: (task: Task, _metadata: TaskMetadata): SubtaskDefinition[] => [
                    {
                        title: `Custom subtask for "${task.title}"`,
                        description: 'Custom decomposition.',
                        priority: TaskPriority.P2,
                        estimatedMinutes: 20,
                        acceptanceCriteria: 'Custom criteria met',
                        dependencies: [],
                        filesToModify: [],
                        filesToCreate: [],
                        contextBundle: '{}',
                        category: SubtaskCategory.Implementation,
                    },
                ],
            };

            engine.registerRule(customRule);

            // Verify the rule is in the list
            const rules = engine.getRules();
            expect(rules.some(r => r.name === 'always-split')).toBe(true);

            // The custom rule should fire for any task since condition is always true
            const task = makeTask({ estimated_minutes: 10, description: 'Tiny task.' });
            const result = engine.decompose(task);

            expect(result).not.toBeNull();
            expect(result!.subtasks.length).toBe(1);
            expect(result!.subtasks[0].title).toContain('Custom subtask');
        });
    });

    // ----------------------------------------------------------
    // 10. Subtask minute clamping
    // ----------------------------------------------------------

    describe('Subtask minute clamping', () => {
        test('clamps subtask minutes to 15-45 range', () => {
            const task = makeTask({
                estimated_minutes: 200,
                files_modified: [
                    'src/a.ts', 'src/b.ts', 'src/c.ts',
                    'src/d.ts', 'src/e.ts', 'src/f.ts',
                    'src/g.ts', 'src/h.ts', 'src/i.ts',
                    'src/j.ts',
                ],
                title: 'Massive 10-file task',
            });

            const result = engine.decompose(task);
            expect(result).not.toBeNull();

            for (const st of result!.subtasks) {
                expect(st.estimatedMinutes).toBeGreaterThanOrEqual(15);
                expect(st.estimatedMinutes).toBeLessThanOrEqual(45);
            }
        });
    });

    // ----------------------------------------------------------
    // 11. ByPropertyGroup Rule
    // ----------------------------------------------------------

    describe('ByPropertyGroup rule', () => {
        test('splits when >8 property keywords are present', () => {
            // Need > 8 property keywords from PROPERTY_GROUPS, but fileCount <= 3 and estimated_minutes <= 45
            // so ByFile and ByPhase don't fire. Also need componentCount <= 10 or not a design task.
            const task = makeTask({
                estimated_minutes: 40,
                files_modified: ['src/styles.ts'],
                title: 'Implement component property system',
                description:
                    'Handle x, y, width, height, color, backgroundColor, fontSize, fontWeight, padding, margin, display, flex properties for the rendering engine.',
            });

            const metadata = engine.extractMetadata(task);
            expect(metadata.propertyCount).toBeGreaterThan(8);

            const result = engine.decompose(task);

            // ByFile: fileCount = 1 <= 3, no
            // ByComponent: need isDesignTask + componentCount > 10, unlikely here
            // ByPropertyGroup: propertyCount > 8, YES
            expect(result).not.toBeNull();
            expect(result!.strategy).toBe(DecompositionStrategy.ByPropertyGroup);
            // Should have multiple property-group subtasks + integration
            expect(result!.subtasks.length).toBeGreaterThanOrEqual(2);

            // Last subtask should be integration
            const lastSubtask = result!.subtasks[result!.subtasks.length - 1];
            expect(lastSubtask.category).toBe(SubtaskCategory.Integration);
        });
    });

    // ----------------------------------------------------------
    // 12. ByDependency Rule
    // ----------------------------------------------------------

    describe('ByDependency rule', () => {
        test('splits when task has >5 dependencies', () => {
            const deps = ['dep-1', 'dep-2', 'dep-3', 'dep-4', 'dep-5', 'dep-6'];
            const task = makeTask({
                estimated_minutes: 30,
                files_modified: ['src/a.ts'],
                dependencies: deps,
                title: 'Wire up multi-dependency module',
                description: 'Integrate six different upstream modules.',
            });

            const metadata = engine.extractMetadata(task);
            expect(metadata.dependencyCount).toBe(6);

            const result = engine.decompose(task);

            // ByFile: 1 file, no. ByComponent: no. ByPropertyGroup: no. ByPhase: 30 <= 45, no.
            // ByDependency: 6 > 5, YES
            expect(result).not.toBeNull();
            expect(result!.strategy).toBe(DecompositionStrategy.ByDependency);
            // 6 deps clustered in groups of 2 = 3 clusters + 1 verification = 4 subtasks
            expect(result!.subtasks.length).toBe(4);

            // Last subtask should be verification
            const lastSubtask = result!.subtasks[result!.subtasks.length - 1];
            expect(lastSubtask.title).toContain('Verify all dependency integrations');
            expect(lastSubtask.category).toBe(SubtaskCategory.Testing);
        });
    });

    // ----------------------------------------------------------
    // 13. Coverage check (isFullyCovered)
    // ----------------------------------------------------------

    describe('Coverage check', () => {
        test('isFullyCovered is true when subtask total >= 80% of original', () => {
            const task = makeTask({
                estimated_minutes: 60,
                files_modified: ['src/a.ts'],
                title: 'Build feature',
            });

            const result = engine.decompose(task);
            expect(result).not.toBeNull();
            // ByPhase: Setup(15) + Implement(max 45) + Testing(15) + Integration(10 -> clamped to 15) >= 48 (80% of 60)
            expect(result!.isFullyCovered).toBe(true);
        });

        test('isFullyCovered is true when estimated_minutes is 0', () => {
            // If original has no estimate, coverage check returns true
            const task = makeTask({
                estimated_minutes: 0,
                files_modified: [
                    'src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts',
                ],
                title: 'Multi-file task with no time estimate',
            });

            const result = engine.decompose(task);
            expect(result).not.toBeNull();
            expect(result!.isFullyCovered).toBe(true);
        });
    });

    // ----------------------------------------------------------
    // 14. Built-in rules count
    // ----------------------------------------------------------

    describe('Built-in rules', () => {
        test('engine registers exactly 6 built-in rules', () => {
            const rules = engine.getRules();
            expect(rules.length).toBe(6);
        });

        test('getRules returns a copy (not a reference to internal array)', () => {
            const rules = engine.getRules();
            const originalLength = rules.length;
            rules.push({
                name: 'injected',
                priority: 99,
                strategy: DecompositionStrategy.Hybrid,
                condition: () => true,
                decompose: () => [],
            });
            // Internal rules should be unchanged
            expect(engine.getRules().length).toBe(originalLength);
        });
    });

    // ----------------------------------------------------------
    // 15. registerRule validation
    // ----------------------------------------------------------

    describe('registerRule validation', () => {
        test('ignores invalid rule with missing name', () => {
            const ruleCount = engine.getRules().length;
            engine.registerRule({ name: '', priority: 1, strategy: DecompositionStrategy.ByPhase, condition: () => true, decompose: () => [] } as DecompositionRule);
            // The rule has an empty name which is falsy, so it should be rejected
            expect(engine.getRules().length).toBe(ruleCount);
        });

        test('ignores null rule', () => {
            const ruleCount = engine.getRules().length;
            engine.registerRule(null as unknown as DecompositionRule);
            expect(engine.getRules().length).toBe(ruleCount);
        });
    });

    // ----------------------------------------------------------
    // 16. Output channel logging
    // ----------------------------------------------------------

    describe('Output channel', () => {
        test('logs messages via the provided output channel', () => {
            const logs: string[] = [];
            const channel = { appendLine: (msg: string) => logs.push(msg) };
            const loggingEngine = new TaskDecompositionEngine(channel);

            const task = makeTask({ estimated_minutes: 60, files_modified: ['src/a.ts'] });
            loggingEngine.decompose(task);

            expect(logs.length).toBeGreaterThan(0);
            expect(logs.some(l => l.includes('[TaskDecomposition]'))).toBe(true);
        });

        test('works without an output channel (uses silent default)', () => {
            // Constructing without a channel should not throw
            const silentEngine = new TaskDecompositionEngine();
            const task = makeTask({ estimated_minutes: 60, files_modified: ['src/a.ts'] });
            expect(() => silentEngine.decompose(task)).not.toThrow();
        });
    });

    // ----------------------------------------------------------
    // 17. DecompositionResult structure
    // ----------------------------------------------------------

    describe('DecompositionResult structure', () => {
        test('result contains all required fields', () => {
            const task = makeTask({
                id: 'task-xyz',
                estimated_minutes: 60,
                files_modified: ['src/a.ts'],
                title: 'Build something',
            });

            const result = engine.decompose(task);
            expect(result).not.toBeNull();

            expect(result!.originalTaskId).toBe('task-xyz');
            expect(typeof result!.strategy).toBe('string');
            expect(typeof result!.reason).toBe('string');
            expect(typeof result!.estimatedTotalMinutes).toBe('number');
            expect(typeof result!.isFullyCovered).toBe('boolean');
            expect(Array.isArray(result!.subtasks)).toBe(true);
            expect(result!.subtasks.length).toBeGreaterThan(0);
        });

        test('each subtask has all required SubtaskDefinition fields', () => {
            const task = makeTask({
                estimated_minutes: 60,
                files_modified: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
            });

            const result = engine.decompose(task);
            expect(result).not.toBeNull();

            for (const st of result!.subtasks) {
                expect(typeof st.title).toBe('string');
                expect(typeof st.description).toBe('string');
                expect(typeof st.priority).toBe('string');
                expect(typeof st.estimatedMinutes).toBe('number');
                expect(typeof st.acceptanceCriteria).toBe('string');
                expect(Array.isArray(st.dependencies)).toBe(true);
                expect(Array.isArray(st.filesToModify)).toBe(true);
                expect(Array.isArray(st.filesToCreate)).toBe(true);
                expect(typeof st.contextBundle).toBe('string');
                expect(typeof st.category).toBe('string');
            }
        });
    });

    // ----------------------------------------------------------
    // 18. Context bundle parsing
    // ----------------------------------------------------------

    describe('Context bundle handling', () => {
        test('extractMetadata parses JSON context_bundle', () => {
            const task = makeTask({
                context_bundle: JSON.stringify({
                    notes: 'Important context about src/core/config.ts changes',
                }),
                files_modified: [],
            });

            const metadata = engine.extractMetadata(task);
            // The JSON context_bundle should be included in gathered text
            // and the file path inside it should be extracted
            expect(metadata.filesModified).toContain('src/core/config.ts');
        });

        test('extractMetadata handles non-JSON context_bundle gracefully', () => {
            const task = makeTask({
                context_bundle: 'This is just plain text mentioning src/mcp/server.ts somewhere.',
                files_modified: [],
            });

            const metadata = engine.extractMetadata(task);
            expect(metadata.filesModified).toContain('src/mcp/server.ts');
        });
    });

    // ----------------------------------------------------------
    // 19. Error handling in rules
    // ----------------------------------------------------------

    describe('Error handling in rules', () => {
        test('continues to next rule when a rule throws an error', () => {
            const brokenRule: DecompositionRule = {
                name: 'broken-rule',
                priority: 0, // Highest priority
                strategy: DecompositionStrategy.ByPhase,
                condition: () => { throw new Error('Rule evaluation exploded'); },
                decompose: () => [],
            };

            engine.registerRule(brokenRule);

            // Despite the broken rule, decompose should still work with the remaining rules
            const task = makeTask({
                estimated_minutes: 60,
                files_modified: ['src/a.ts'],
            });

            const result = engine.decompose(task);
            // The broken rule throws, so the engine moves to next rules.
            // ByPhase should still match (estimated_minutes > 45)
            expect(result).not.toBeNull();
            expect(result!.strategy).toBe(DecompositionStrategy.ByPhase);
        });
    });
});
