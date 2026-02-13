// ============================================================
// Task Decomposition Engine — Deterministic, No LLM Calls
// Breaks tasks into 15-45 minute atomic subtasks using pure
// rule-based decomposition. Part of COE Layer 3 (Execution).
// ============================================================

import {
    Task, TaskPriority, TaskStatus, DecompositionResult, SubtaskDefinition,
    DecompositionStrategy, DecompositionRule, TaskMetadata, SubtaskCategory
} from '../types';

// --- Keyword dictionaries for task type detection ---

const DESIGN_KEYWORDS = [
    'component', 'layout', 'canvas', 'style', 'responsive',
    'drag', 'drop', 'visual', 'ui', 'page'
];

const SYNC_KEYWORDS = [
    'sync', 'conflict', 'device', 'merge', 'lock',
    'p2p', 'nas', 'cloud'
];

const ETHICS_KEYWORDS = [
    'ethics', 'freedom', 'guard', 'sensitivity', 'audit',
    'block', 'allow', 'rule'
];

const TESTING_KEYWORDS = [
    'test', 'jest', 'coverage', 'assert', 'mock', 'spec'
];

// --- File path extraction regex ---

const FILE_PATH_REGEX = /(?:[a-zA-Z]:\\|\.\/|\.\.\/|\/)?(?:[\w\-.]+[/\\])*[\w\-.]+\.\w{1,10}/g;

// --- Property grouping definitions ---

const PROPERTY_GROUPS: Record<string, string[]> = {
    position: ['x', 'y', 'z', 'top', 'left', 'right', 'bottom', 'position', 'zIndex', 'offset'],
    sizing: ['width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'size'],
    style: ['color', 'backgroundColor', 'background', 'opacity', 'shadow', 'boxShadow', 'border', 'borderRadius'],
    typography: ['font', 'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'letterSpacing', 'textAlign', 'text'],
    layout: ['display', 'flex', 'flexDirection', 'justifyContent', 'alignItems', 'gap', 'grid', 'padding', 'margin'],
    behavior: ['onClick', 'onHover', 'onDrag', 'onDrop', 'onScroll', 'event', 'handler', 'callback', 'listener'],
    data: ['value', 'data', 'state', 'props', 'content', 'label', 'placeholder', 'name', 'id'],
    responsive: ['responsive', 'breakpoint', 'tablet', 'mobile', 'desktop', 'media'],
};

/**
 * TaskDecompositionEngine — Pure rule-based decomposition of tasks.
 *
 * No LLM calls. Every decision is deterministic and based on
 * keyword matching, file counting, and configurable rules.
 */
export class TaskDecompositionEngine {
    private rules: DecompositionRule[] = [];
    private outputChannel: { appendLine: (msg: string) => void };

    private static readonly MAX_DEPTH = 3;
    private static readonly MIN_SUBTASK_MINUTES = 15;
    private static readonly MAX_SUBTASK_MINUTES = 45;

    constructor(outputChannel?: { appendLine: (msg: string) => void }) {
        this.outputChannel = outputChannel ?? { appendLine: () => {} };
        this.registerBuiltInRules();
    }

    // ==========================================================
    // Public API
    // ==========================================================

    /**
     * Quick check whether a task likely needs decomposition.
     * Does NOT perform the decomposition — just a fast predicate.
     */
    needsDecomposition(task: Task): boolean {
        if (!task) {
            return false;
        }
        const metadata = this.extractMetadata(task);
        return (
            (task.estimated_minutes ?? 0) > 45 ||
            metadata.fileCount > 3 ||
            metadata.componentCount > 10
        );
    }

    /**
     * Decompose a task into subtasks using the first matching rule.
     * Returns null if the task is already atomic (no rules match).
     *
     * @param task   The task to decompose
     * @param depth  Current recursion depth (default 0, max 3)
     */
    decompose(task: Task, depth: number = 0): DecompositionResult | null {
        if (!task) {
            this.log('decompose called with null/undefined task — returning null');
            return null;
        }

        if (depth >= TaskDecompositionEngine.MAX_DEPTH) {
            this.log(`Max decomposition depth (${TaskDecompositionEngine.MAX_DEPTH}) reached for task "${task.title}" — stopping`);
            return null;
        }

        const metadata = this.extractMetadata(task);

        // Rules are already sorted by priority ascending (lower number = higher priority)
        const sortedRules = [...this.rules].sort((a, b) => a.priority - b.priority);

        for (const rule of sortedRules) {
            try {
                if (rule.condition(task, metadata)) {
                    this.log(`Rule "${rule.name}" matched for task "${task.title}" (strategy: ${rule.strategy})`);

                    const subtasks = rule.decompose(task, metadata);

                    if (!subtasks || subtasks.length === 0) {
                        this.log(`Rule "${rule.name}" produced no subtasks — trying next rule`);
                        continue;
                    }

                    // Enforce 15-45 minute bounds on every subtask
                    const clampedSubtasks = subtasks.map(st => this.clampSubtaskMinutes(st));

                    const estimatedTotal = clampedSubtasks.reduce((sum, st) => sum + st.estimatedMinutes, 0);

                    const result: DecompositionResult = {
                        originalTaskId: task.id ?? '',
                        subtasks: clampedSubtasks,
                        strategy: rule.strategy,
                        reason: `Matched rule "${rule.name}": ${this.describeCondition(rule, metadata)}`,
                        estimatedTotalMinutes: estimatedTotal,
                        isFullyCovered: this.checkCoverage(task, clampedSubtasks),
                    };

                    this.log(`Decomposed "${task.title}" into ${clampedSubtasks.length} subtasks (${estimatedTotal} min total)`);
                    return result;
                }
            } catch (err) {
                this.log(`Error evaluating rule "${rule.name}": ${err}`);
            }
        }

        this.log(`No rules matched for task "${task.title}" — task is atomic`);
        return null;
    }

    /**
     * Extract task metadata by parsing description, context, files, and criteria.
     */
    extractMetadata(task: Task): TaskMetadata {
        const allText = this.gatherText(task);
        const allTextLower = allText.toLowerCase();

        // Parse file paths
        const filesFromText = this.extractFilePaths(allText);
        const filesFromField = Array.isArray(task.files_modified) ? task.files_modified : [];
        const allFiles = [...new Set([...filesFromField, ...filesFromText])];

        // Count components
        const componentCount = this.countComponents(allTextLower);

        // Count properties mentioned
        const propertyCount = this.countProperties(allTextLower);

        // Count dependencies
        const dependencyCount = Array.isArray(task.dependencies) ? task.dependencies.length : 0;

        // Detect task types via keyword signals
        const keywordSignals: string[] = [];
        const isDesignTask = this.hasKeywords(allTextLower, DESIGN_KEYWORDS, keywordSignals, 'design');
        const isSyncTask = this.hasKeywords(allTextLower, SYNC_KEYWORDS, keywordSignals, 'sync');
        const isEthicsTask = this.hasKeywords(allTextLower, ETHICS_KEYWORDS, keywordSignals, 'ethics');
        const hasTests = this.hasKeywords(allTextLower, TESTING_KEYWORDS, keywordSignals, 'testing');
        const hasDocs = /\b(doc|readme|changelog|documentation|jsdoc|comment)\b/i.test(allText);
        const hasUI = isDesignTask || /\b(button|input|modal|dialog|panel|sidebar|header|footer|menu|tooltip)\b/i.test(allText);

        // Estimate complexity
        const estimatedMinutes = task.estimated_minutes ?? 0;
        let estimatedComplexity: 'low' | 'medium' | 'high' | 'very_high';

        if (estimatedMinutes > 45 || allFiles.length > 5 || componentCount > 10) {
            estimatedComplexity = 'very_high';
        } else if (estimatedMinutes <= 45 || allFiles.length > 3) {
            // Note: the spec says high if estimated_minutes <= 45 OR fileCount > 3
            // This catches the boundary where it's not very_high but still complex
            estimatedComplexity = allFiles.length > 3 ? 'high' :
                (estimatedMinutes > 35 ? 'high' :
                    (estimatedMinutes > 20 || allFiles.length > 1 ? 'medium' : 'low'));
        } else {
            estimatedComplexity = 'low';
        }

        // Refine: if very few files and low minutes, override to low
        if (estimatedMinutes <= 20 && allFiles.length <= 1) {
            estimatedComplexity = 'low';
        } else if (estimatedMinutes <= 35 && allFiles.length <= 3 && estimatedComplexity !== 'very_high') {
            estimatedComplexity = 'medium';
        }

        return {
            fileCount: allFiles.length,
            filesModified: allFiles,
            filesToCreate: [], // Derived from context if available
            componentCount,
            propertyCount,
            dependencyCount,
            hasTests,
            hasDocs,
            hasUI,
            isDesignTask,
            isSyncTask,
            isEthicsTask,
            estimatedComplexity,
            keywordSignals,
        };
    }

    /**
     * Register a custom decomposition rule.
     */
    registerRule(rule: DecompositionRule): void {
        if (!rule || !rule.name || typeof rule.condition !== 'function' || typeof rule.decompose !== 'function') {
            this.log('registerRule: invalid rule — skipping');
            return;
        }
        this.rules.push(rule);
        this.log(`Registered custom rule "${rule.name}" (priority ${rule.priority})`);
    }

    /**
     * Return all currently registered rules (built-in + custom).
     */
    getRules(): DecompositionRule[] {
        return [...this.rules];
    }

    // ==========================================================
    // Built-in Rules
    // ==========================================================

    private registerBuiltInRules(): void {
        // Rule 1: File-count split (priority 1)
        this.rules.push({
            name: 'file-count-split',
            priority: 1,
            strategy: DecompositionStrategy.ByFile,
            condition: (_task: Task, metadata: TaskMetadata) => metadata.fileCount > 3,
            decompose: (task: Task, metadata: TaskMetadata) =>
                this.decomposeByFile(task, metadata),
        });

        // Rule 2: Component-count split (priority 2)
        this.rules.push({
            name: 'component-count-split',
            priority: 2,
            strategy: DecompositionStrategy.ByComponent,
            condition: (_task: Task, metadata: TaskMetadata) =>
                metadata.componentCount > 10 && metadata.isDesignTask,
            decompose: (task: Task, metadata: TaskMetadata) =>
                this.decomposeByComponent(task, metadata),
        });

        // Rule 3: Property-group split (priority 3)
        this.rules.push({
            name: 'property-group-split',
            priority: 3,
            strategy: DecompositionStrategy.ByPropertyGroup,
            condition: (_task: Task, metadata: TaskMetadata) => metadata.propertyCount > 8,
            decompose: (task: Task, metadata: TaskMetadata) =>
                this.decomposeByPropertyGroup(task, metadata),
        });

        // Rule 4: Time-based split (priority 4)
        this.rules.push({
            name: 'time-based-split',
            priority: 4,
            strategy: DecompositionStrategy.ByPhase,
            condition: (task: Task, _metadata: TaskMetadata) =>
                (task.estimated_minutes ?? 0) > 45,
            decompose: (task: Task, _metadata: TaskMetadata) =>
                this.decomposeByPhase(task),
        });

        // Rule 5: Dependency split (priority 5)
        this.rules.push({
            name: 'dependency-split',
            priority: 5,
            strategy: DecompositionStrategy.ByDependency,
            condition: (_task: Task, metadata: TaskMetadata) => metadata.dependencyCount > 5,
            decompose: (task: Task, metadata: TaskMetadata) =>
                this.decomposeByDependency(task, metadata),
        });

        // Rule 6: Complexity split (priority 6)
        this.rules.push({
            name: 'complexity-split',
            priority: 6,
            strategy: DecompositionStrategy.ByComplexity,
            condition: (_task: Task, metadata: TaskMetadata) =>
                metadata.estimatedComplexity === 'very_high',
            decompose: (task: Task, metadata: TaskMetadata) =>
                this.decomposeByComplexity(task, metadata),
        });
    }

    // ==========================================================
    // Decomposition Strategies
    // ==========================================================

    /**
     * Rule 1: One subtask per file + final integration subtask.
     */
    private decomposeByFile(task: Task, metadata: TaskMetadata): SubtaskDefinition[] {
        const subtasks: SubtaskDefinition[] = [];
        const files = metadata.filesModified;
        const minutesPerFile = Math.max(
            TaskDecompositionEngine.MIN_SUBTASK_MINUTES,
            Math.min(
                TaskDecompositionEngine.MAX_SUBTASK_MINUTES,
                Math.floor((task.estimated_minutes ?? 30) / (files.length + 1))
            )
        );

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const filename = this.basename(file);
            const prevTitle = i > 0 ? `Implement changes in ${this.basename(files[i - 1])}` : undefined;

            subtasks.push({
                title: `Implement changes in ${filename}`,
                description: `Apply the required changes to ${file} as part of task "${task.title}". Focus only on this file's modifications.`,
                priority: task.priority ?? TaskPriority.P2,
                estimatedMinutes: minutesPerFile,
                acceptanceCriteria: `All changes in ${filename} compile and pass lint checks`,
                dependencies: prevTitle ? [prevTitle] : [],
                filesToModify: [file],
                filesToCreate: [],
                contextBundle: JSON.stringify({ parentTask: task.title, targetFile: file }),
                category: SubtaskCategory.Implementation,
            });
        }

        // Final integration subtask
        subtasks.push({
            title: `Integration and verification for "${task.title}"`,
            description: `Verify that all file-level changes integrate correctly. Run tests, check imports, and confirm acceptance criteria for the parent task.`,
            priority: task.priority ?? TaskPriority.P2,
            estimatedMinutes: TaskDecompositionEngine.MIN_SUBTASK_MINUTES,
            acceptanceCriteria: `All modified files work together; tests pass; no broken imports`,
            dependencies: subtasks.map(st => st.title),
            filesToModify: [],
            filesToCreate: [],
            contextBundle: JSON.stringify({ parentTask: task.title, phase: 'integration' }),
            category: SubtaskCategory.Integration,
        });

        return subtasks;
    }

    /**
     * Rule 2: Group components into batches of 5-8.
     */
    private decomposeByComponent(task: Task, metadata: TaskMetadata): SubtaskDefinition[] {
        const subtasks: SubtaskDefinition[] = [];
        const componentNames = this.extractComponentNames(this.gatherText(task));

        // If we couldn't extract specific names, generate numbered batches
        const names = componentNames.length > 0
            ? componentNames
            : Array.from({ length: metadata.componentCount }, (_, i) => `Component_${i + 1}`);

        const batchSize = names.length <= 16 ? 5 : 8; // Prefer smaller batches unless there are many
        const batches = this.chunk(names, batchSize);

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            const category = this.inferComponentCategory(batch);
            const prevTitle = i > 0
                ? `Implement ${this.inferComponentCategory(batches[i - 1])} components: ${this.summarizeList(batches[i - 1])}`
                : undefined;

            subtasks.push({
                title: `Implement ${category} components: ${this.summarizeList(batch)}`,
                description: `Build and wire up the following components: ${batch.join(', ')}. Ensure each component matches design specs and has proper props/events.`,
                priority: task.priority ?? TaskPriority.P2,
                estimatedMinutes: Math.min(
                    TaskDecompositionEngine.MAX_SUBTASK_MINUTES,
                    Math.max(TaskDecompositionEngine.MIN_SUBTASK_MINUTES, batch.length * 5)
                ),
                acceptanceCriteria: `All ${batch.length} components render correctly and accept required props`,
                dependencies: prevTitle ? [prevTitle] : [],
                filesToModify: metadata.filesModified.length > 0 ? metadata.filesModified : [],
                filesToCreate: [],
                contextBundle: JSON.stringify({ parentTask: task.title, components: batch }),
                category: SubtaskCategory.Implementation,
            });
        }

        // Testing subtask
        subtasks.push({
            title: `Test all components for "${task.title}"`,
            description: `Write or update unit tests for all ${names.length} components. Verify rendering, prop handling, and event behavior.`,
            priority: TaskPriority.P2,
            estimatedMinutes: Math.min(
                TaskDecompositionEngine.MAX_SUBTASK_MINUTES,
                Math.max(TaskDecompositionEngine.MIN_SUBTASK_MINUTES, batches.length * 8)
            ),
            acceptanceCriteria: `All component tests pass with adequate coverage`,
            dependencies: subtasks.map(st => st.title),
            filesToModify: [],
            filesToCreate: [],
            contextBundle: JSON.stringify({ parentTask: task.title, phase: 'testing' }),
            category: SubtaskCategory.Testing,
        });

        return subtasks;
    }

    /**
     * Rule 3: Group related properties together.
     */
    private decomposeByPropertyGroup(task: Task, metadata: TaskMetadata): SubtaskDefinition[] {
        const subtasks: SubtaskDefinition[] = [];
        const allText = this.gatherText(task).toLowerCase();

        // Determine which property groups are relevant
        const relevantGroups: { groupName: string; properties: string[] }[] = [];
        for (const [groupName, keywords] of Object.entries(PROPERTY_GROUPS)) {
            const matchedProps = keywords.filter(kw => allText.includes(kw));
            if (matchedProps.length > 0) {
                relevantGroups.push({ groupName, properties: matchedProps });
            }
        }

        // If no specific groups found, create a generic split
        if (relevantGroups.length === 0) {
            return this.decomposeByPhase(task);
        }

        const minutesPerGroup = Math.max(
            TaskDecompositionEngine.MIN_SUBTASK_MINUTES,
            Math.min(
                TaskDecompositionEngine.MAX_SUBTASK_MINUTES,
                Math.floor((task.estimated_minutes ?? 40) / (relevantGroups.length + 1))
            )
        );

        for (let i = 0; i < relevantGroups.length; i++) {
            const group = relevantGroups[i];
            const prevTitle = i > 0
                ? `Implement ${relevantGroups[i - 1].groupName} properties`
                : undefined;

            subtasks.push({
                title: `Implement ${group.groupName} properties`,
                description: `Handle all ${group.groupName}-related properties (${group.properties.join(', ')}) for task "${task.title}".`,
                priority: task.priority ?? TaskPriority.P2,
                estimatedMinutes: minutesPerGroup,
                acceptanceCriteria: `All ${group.groupName} properties are correctly implemented and validated`,
                dependencies: prevTitle ? [prevTitle] : [],
                filesToModify: metadata.filesModified,
                filesToCreate: [],
                contextBundle: JSON.stringify({ parentTask: task.title, propertyGroup: group.groupName, properties: group.properties }),
                category: SubtaskCategory.Implementation,
            });
        }

        // Integration subtask
        subtasks.push({
            title: `Integrate and test property groups for "${task.title}"`,
            description: `Verify that all property groups work together correctly. Test interactions between property groups and edge cases.`,
            priority: task.priority ?? TaskPriority.P2,
            estimatedMinutes: TaskDecompositionEngine.MIN_SUBTASK_MINUTES,
            acceptanceCriteria: `All property groups integrate correctly; no conflicts between groups`,
            dependencies: subtasks.map(st => st.title),
            filesToModify: [],
            filesToCreate: [],
            contextBundle: JSON.stringify({ parentTask: task.title, phase: 'integration' }),
            category: SubtaskCategory.Integration,
        });

        return subtasks;
    }

    /**
     * Rule 4: Split by development phase — Setup, Implementation, Testing, Integration.
     */
    private decomposeByPhase(task: Task): SubtaskDefinition[] {
        const totalMinutes = task.estimated_minutes ?? 60;
        const setupMinutes = 15;
        const testingMinutes = 15;
        const integrationMinutes = 10;
        const implMinutes = Math.max(
            TaskDecompositionEngine.MIN_SUBTASK_MINUTES,
            Math.min(
                TaskDecompositionEngine.MAX_SUBTASK_MINUTES,
                totalMinutes - setupMinutes - testingMinutes - integrationMinutes
            )
        );

        const subtasks: SubtaskDefinition[] = [
            {
                title: `Setup for "${task.title}"`,
                description: `Prepare the development environment, create necessary file stubs, set up imports, and review existing code that will be modified.`,
                priority: task.priority ?? TaskPriority.P2,
                estimatedMinutes: setupMinutes,
                acceptanceCriteria: `All required files exist; imports are in place; environment is ready for implementation`,
                dependencies: [],
                filesToModify: Array.isArray(task.files_modified) ? task.files_modified : [],
                filesToCreate: [],
                contextBundle: JSON.stringify({ parentTask: task.title, phase: 'setup' }),
                category: SubtaskCategory.Setup,
            },
            {
                title: `Core implementation for "${task.title}"`,
                description: `Implement the main logic and functionality described in the parent task. This is the primary coding work.`,
                priority: task.priority ?? TaskPriority.P1,
                estimatedMinutes: implMinutes,
                acceptanceCriteria: `Core functionality works as specified in the parent task acceptance criteria`,
                dependencies: [`Setup for "${task.title}"`],
                filesToModify: Array.isArray(task.files_modified) ? task.files_modified : [],
                filesToCreate: [],
                contextBundle: JSON.stringify({ parentTask: task.title, phase: 'implementation' }),
                category: SubtaskCategory.Implementation,
            },
            {
                title: `Testing for "${task.title}"`,
                description: `Write unit tests, run existing tests, and verify that the implementation meets acceptance criteria without regressions.`,
                priority: TaskPriority.P2,
                estimatedMinutes: testingMinutes,
                acceptanceCriteria: `All tests pass; no regressions introduced`,
                dependencies: [`Core implementation for "${task.title}"`],
                filesToModify: [],
                filesToCreate: [],
                contextBundle: JSON.stringify({ parentTask: task.title, phase: 'testing' }),
                category: SubtaskCategory.Testing,
            },
            {
                title: `Integration for "${task.title}"`,
                description: `Wire up the implementation with the rest of the system. Verify imports, update exports, and confirm end-to-end functionality.`,
                priority: task.priority ?? TaskPriority.P2,
                estimatedMinutes: integrationMinutes,
                acceptanceCriteria: `Implementation is fully integrated; no broken imports or type errors; build succeeds`,
                dependencies: [`Testing for "${task.title}"`],
                filesToModify: [],
                filesToCreate: [],
                contextBundle: JSON.stringify({ parentTask: task.title, phase: 'integration' }),
                category: SubtaskCategory.Integration,
            },
        ];

        return subtasks;
    }

    /**
     * Rule 5: Group dependencies into clusters and create subtask per cluster.
     */
    private decomposeByDependency(task: Task, metadata: TaskMetadata): SubtaskDefinition[] {
        const subtasks: SubtaskDefinition[] = [];
        const deps = Array.isArray(task.dependencies) ? task.dependencies : [];

        // Group dependencies into clusters of 2-3
        const clusterSize = deps.length <= 9 ? 2 : 3;
        const clusters = this.chunk(deps, clusterSize);

        const minutesPerCluster = Math.max(
            TaskDecompositionEngine.MIN_SUBTASK_MINUTES,
            Math.min(
                TaskDecompositionEngine.MAX_SUBTASK_MINUTES,
                Math.floor((task.estimated_minutes ?? 45) / (clusters.length + 1))
            )
        );

        for (let i = 0; i < clusters.length; i++) {
            const cluster = clusters[i];
            const prevTitle = i > 0
                ? `Handle dependency cluster ${i}: ${this.summarizeList(clusters[i - 1])}`
                : undefined;

            subtasks.push({
                title: `Handle dependency cluster ${i + 1}: ${this.summarizeList(cluster)}`,
                description: `Address the integration points for dependencies: ${cluster.join(', ')}. Ensure interfaces match and data flows correctly.`,
                priority: task.priority ?? TaskPriority.P2,
                estimatedMinutes: minutesPerCluster,
                acceptanceCriteria: `All dependencies in cluster (${cluster.join(', ')}) are properly integrated`,
                dependencies: prevTitle ? [prevTitle] : [],
                filesToModify: metadata.filesModified,
                filesToCreate: [],
                contextBundle: JSON.stringify({ parentTask: task.title, dependencyCluster: cluster }),
                category: SubtaskCategory.Implementation,
            });
        }

        // Final verification subtask
        subtasks.push({
            title: `Verify all dependency integrations for "${task.title}"`,
            description: `Run full test suite and verify that all ${deps.length} dependencies are correctly wired.`,
            priority: task.priority ?? TaskPriority.P2,
            estimatedMinutes: TaskDecompositionEngine.MIN_SUBTASK_MINUTES,
            acceptanceCriteria: `All dependency integrations verified; tests pass`,
            dependencies: subtasks.map(st => st.title),
            filesToModify: [],
            filesToCreate: [],
            contextBundle: JSON.stringify({ parentTask: task.title, phase: 'dependency-verification' }),
            category: SubtaskCategory.Testing,
        });

        return subtasks;
    }

    /**
     * Rule 6: Split very complex tasks in half — core logic first, then edge cases/polish.
     */
    private decomposeByComplexity(task: Task, metadata: TaskMetadata): SubtaskDefinition[] {
        const totalMinutes = task.estimated_minutes ?? 60;
        const halfMinutes = Math.max(
            TaskDecompositionEngine.MIN_SUBTASK_MINUTES,
            Math.min(
                TaskDecompositionEngine.MAX_SUBTASK_MINUTES,
                Math.floor(totalMinutes / 2)
            )
        );

        // Split files roughly in half for each part
        const files = metadata.filesModified;
        const midpoint = Math.ceil(files.length / 2);
        const firstHalfFiles = files.slice(0, midpoint);
        const secondHalfFiles = files.slice(midpoint);

        return [
            {
                title: `Core logic and structure for "${task.title}"`,
                description: `Implement the fundamental logic, data structures, and primary code paths. Focus on the happy path and core architecture.`,
                priority: task.priority ?? TaskPriority.P1,
                estimatedMinutes: halfMinutes,
                acceptanceCriteria: `Core logic compiles and handles the primary use case correctly`,
                dependencies: [],
                filesToModify: firstHalfFiles.length > 0 ? firstHalfFiles : (Array.isArray(task.files_modified) ? task.files_modified : []),
                filesToCreate: [],
                contextBundle: JSON.stringify({ parentTask: task.title, phase: 'core-logic' }),
                category: SubtaskCategory.Implementation,
            },
            {
                title: `Edge cases and polish for "${task.title}"`,
                description: `Handle error conditions, edge cases, null checks, boundary conditions, logging, and code quality improvements.`,
                priority: task.priority ?? TaskPriority.P2,
                estimatedMinutes: halfMinutes,
                acceptanceCriteria: `All edge cases handled; error paths tested; code is production-ready`,
                dependencies: [`Core logic and structure for "${task.title}"`],
                filesToModify: secondHalfFiles.length > 0 ? secondHalfFiles : (Array.isArray(task.files_modified) ? task.files_modified : []),
                filesToCreate: [],
                contextBundle: JSON.stringify({ parentTask: task.title, phase: 'edge-cases-polish' }),
                category: SubtaskCategory.Implementation,
            },
            {
                title: `Final testing for "${task.title}"`,
                description: `Run comprehensive tests covering both core logic and edge cases. Verify full acceptance criteria.`,
                priority: TaskPriority.P2,
                estimatedMinutes: TaskDecompositionEngine.MIN_SUBTASK_MINUTES,
                acceptanceCriteria: `All tests pass; acceptance criteria verified`,
                dependencies: [`Edge cases and polish for "${task.title}"`],
                filesToModify: [],
                filesToCreate: [],
                contextBundle: JSON.stringify({ parentTask: task.title, phase: 'final-testing' }),
                category: SubtaskCategory.Testing,
            },
        ];
    }

    // ==========================================================
    // Helper Methods
    // ==========================================================

    /**
     * Concatenate all text sources from a task for analysis.
     */
    private gatherText(task: Task): string {
        const parts: string[] = [];
        if (task.title) { parts.push(task.title); }
        if (task.description) { parts.push(task.description); }
        if (task.acceptance_criteria) { parts.push(task.acceptance_criteria); }
        if (task.context_bundle) {
            try {
                const parsed = JSON.parse(task.context_bundle);
                parts.push(typeof parsed === 'string' ? parsed : JSON.stringify(parsed));
            } catch {
                parts.push(task.context_bundle);
            }
        }
        if (Array.isArray(task.files_modified)) {
            parts.push(task.files_modified.join(' '));
        }
        return parts.join(' ');
    }

    /**
     * Extract file paths from text using regex.
     */
    private extractFilePaths(text: string): string[] {
        if (!text) { return []; }
        const matches = text.match(FILE_PATH_REGEX);
        if (!matches) { return []; }

        // Filter out false positives (e.g., version numbers like "1.0.0")
        return [...new Set(
            matches.filter(m => {
                // Must contain a path separator or look like a real file
                return (m.includes('/') || m.includes('\\') || /\.\w{1,5}$/.test(m)) &&
                    !/^\d+\.\d+\.\d+$/.test(m) && // Not a version number
                    m.length > 3; // Not too short
            })
        )];
    }

    /**
     * Count component references in text.
     */
    private countComponents(textLower: string): number {
        const componentPatterns = [
            /\bcomponent\b/g,
            /\b\w+component\b/g,
            /\b(?:button|input|modal|dialog|card|sidebar|header|footer|nav|panel|form|table|list|menu|tab|tooltip|dropdown|checkbox|radio|select|toggle|slider|accordion|carousel|badge|avatar|breadcrumb|pagination|stepper|chip|alert|toast|snackbar)\b/g,
        ];

        const allMatches = new Set<string>();
        for (const pattern of componentPatterns) {
            const matches = textLower.match(pattern);
            if (matches) {
                matches.forEach(m => allMatches.add(m));
            }
        }
        return allMatches.size;
    }

    /**
     * Count property-related keywords in text.
     */
    private countProperties(textLower: string): number {
        let count = 0;
        for (const keywords of Object.values(PROPERTY_GROUPS)) {
            for (const kw of keywords) {
                if (textLower.includes(kw.toLowerCase())) {
                    count++;
                }
            }
        }
        return count;
    }

    /**
     * Check if text contains keywords from a given set.
     * Records matched signals in the signals array.
     */
    private hasKeywords(textLower: string, keywords: string[], signals: string[], signalPrefix: string): boolean {
        let matchCount = 0;
        for (const kw of keywords) {
            if (textLower.includes(kw.toLowerCase())) {
                matchCount++;
                signals.push(`${signalPrefix}:${kw}`);
            }
        }
        // Require at least 2 keyword matches for a positive type detection
        return matchCount >= 2;
    }

    /**
     * Extract component names from text (PascalCase words or known component types).
     */
    private extractComponentNames(text: string): string[] {
        const pascalCaseRegex = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g;
        const names = new Set<string>();
        const matches = text.match(pascalCaseRegex);
        if (matches) {
            matches.forEach(m => names.add(m));
        }
        return [...names];
    }

    /**
     * Infer a category label for a batch of component names.
     */
    private inferComponentCategory(batch: string[]): string {
        const batchText = batch.join(' ').toLowerCase();
        if (/nav|menu|header|footer|sidebar|breadcrumb/.test(batchText)) { return 'navigation'; }
        if (/form|input|select|checkbox|radio|toggle|slider/.test(batchText)) { return 'form'; }
        if (/modal|dialog|toast|alert|snackbar|tooltip/.test(batchText)) { return 'feedback'; }
        if (/card|list|table|grid|accordion|carousel/.test(batchText)) { return 'data-display'; }
        if (/button|badge|chip|avatar|icon/.test(batchText)) { return 'basic'; }
        return 'general';
    }

    /**
     * Split an array into chunks of the specified size.
     */
    private chunk<T>(arr: T[], size: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < arr.length; i += size) {
            chunks.push(arr.slice(i, i + size));
        }
        return chunks;
    }

    /**
     * Summarize a list for use in a title (truncate if too long).
     */
    private summarizeList(items: string[]): string {
        if (items.length <= 3) {
            return items.join(', ');
        }
        return `${items.slice(0, 3).join(', ')} (+${items.length - 3} more)`;
    }

    /**
     * Extract the filename from a path.
     */
    private basename(filePath: string): string {
        if (!filePath) { return 'unknown'; }
        const parts = filePath.replace(/\\/g, '/').split('/');
        return parts[parts.length - 1] || filePath;
    }

    /**
     * Clamp subtask minutes to the 15-45 range.
     */
    private clampSubtaskMinutes(subtask: SubtaskDefinition): SubtaskDefinition {
        return {
            ...subtask,
            estimatedMinutes: Math.max(
                TaskDecompositionEngine.MIN_SUBTASK_MINUTES,
                Math.min(TaskDecompositionEngine.MAX_SUBTASK_MINUTES, subtask.estimatedMinutes)
            ),
        };
    }

    /**
     * Check whether the subtasks collectively cover the original task.
     * A simple heuristic: coverage is "full" if total subtask time
     * is >= 80% of the original estimated time.
     */
    private checkCoverage(task: Task, subtasks: SubtaskDefinition[]): boolean {
        const originalMinutes = task.estimated_minutes ?? 0;
        if (originalMinutes <= 0) { return true; } // Can't measure if no estimate
        const subtaskTotal = subtasks.reduce((sum, st) => sum + st.estimatedMinutes, 0);
        return subtaskTotal >= originalMinutes * 0.8;
    }

    /**
     * Generate a human-readable description of why a rule matched.
     */
    private describeCondition(rule: DecompositionRule, metadata: TaskMetadata): string {
        switch (rule.name) {
            case 'file-count-split':
                return `${metadata.fileCount} files detected (threshold: >3)`;
            case 'component-count-split':
                return `${metadata.componentCount} components in a design task (threshold: >10)`;
            case 'property-group-split':
                return `${metadata.propertyCount} properties detected (threshold: >8)`;
            case 'time-based-split':
                return `estimated time exceeds 45 minutes`;
            case 'dependency-split':
                return `${metadata.dependencyCount} dependencies detected (threshold: >5)`;
            case 'complexity-split':
                return `estimated complexity is very_high`;
            default:
                return `custom rule "${rule.name}" matched`;
        }
    }

    /**
     * Log a message to the output channel.
     */
    private log(message: string): void {
        this.outputChannel.appendLine(`[TaskDecomposition] ${message}`);
    }
}
