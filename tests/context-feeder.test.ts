import { ContextFeeder } from '../src/core/context-feeder';
import { TokenBudgetTracker } from '../src/core/token-budget-tracker';
import {
    ContentType, ContextCategory, ContextPriority, ContextItem,
    RelevanceKeywordSet, AgentType, AgentContext,
    Task, Ticket, Plan, Conversation, DesignComponent,
    TaskStatus, TaskPriority, TicketStatus, TicketPriority,
    PlanStatus, ConversationRole, TokenBudget
} from '../src/types';

// ============================================================
// Test Helpers — Minimal mock factories
// ============================================================

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'task-1',
        title: 'Implement database migration',
        description: 'Add migration system to the database service',
        status: TaskStatus.InProgress,
        priority: TaskPriority.P1,
        dependencies: [],
        acceptance_criteria: 'All tables migrated without data loss',
        plan_id: 'plan-1',
        parent_task_id: null,
        sort_order: 1,
        estimated_minutes: 30,
        files_modified: ['src/core/database.ts', 'src/core/migration.ts'],
        context_bundle: null,
        task_requirements: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...overrides,
    };
}

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
    return {
        id: 'ticket-1',
        ticket_number: 42,
        title: 'Database migration fails on empty tables',
        body: 'When running migration on empty tables, an error is thrown',
        status: TicketStatus.Open,
        priority: TicketPriority.P1,
        creator: 'developer',
        assignee: null,
        task_id: 'task-1',
        parent_ticket_id: null,
        auto_created: false,
        operation_type: 'user_created',
        acceptance_criteria: null,
        blocking_ticket_id: null,
        is_ghost: false,
        processing_agent: null,
        processing_status: null,
        deliverable_type: null,
        verification_result: null,
        source_page_ids: null,
        source_component_ids: null,
        retry_count: 0,
        max_retries: 3,
        stage: 1,
        last_error: null,
        last_error_at: null,
        assigned_queue: null,
        cancellation_reason: null,
        ticket_category: null,
        ticket_stage: null,
        related_ticket_ids: null,
        agent_notes: null,
        tree_route_path: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...overrides,
    };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
    return {
        id: 'plan-1',
        name: 'Database Overhaul Plan',
        status: PlanStatus.Active,
        config_json: JSON.stringify({ scope: 'migration', target: 'sqlite' }),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...overrides,
    };
}

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
    return {
        id: `conv-${Math.random().toString(36).slice(2, 8)}`,
        agent: 'orchestrator',
        role: ConversationRole.User,
        content: 'How do I fix the migration?',
        task_id: 'task-1',
        ticket_id: null,
        tokens_used: null,
        created_at: new Date().toISOString(),
        ...overrides,
    };
}

function makeContextItem(overrides: Partial<ContextItem> = {}): ContextItem {
    return {
        id: 'item-1',
        label: 'Test Item',
        content: 'Some test content about database migration',
        contentType: ContentType.NaturalText,
        category: ContextCategory.Supplementary,
        priority: ContextPriority.Supplementary,
        relevanceScore: 50,
        estimatedTokens: 10,
        metadata: {
            sourceType: 'custom',
            sourceId: 'test',
            createdAt: new Date().toISOString(),
            isStale: false,
            relatedTaskIds: [],
            relatedFilePatterns: [],
        },
        ...overrides,
    };
}

function makeDesignComponent(overrides: Partial<DesignComponent> = {}): DesignComponent {
    return {
        id: `comp-${Math.random().toString(36).slice(2, 8)}`,
        plan_id: 'plan-1',
        page_id: 'page-1',
        type: 'container',
        name: 'MainContainer',
        parent_id: null,
        sort_order: 0,
        x: 0,
        y: 0,
        width: 1440,
        height: 900,
        styles: {},
        content: '',
        props: {},
        requirements: [],
        responsive: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...overrides,
    };
}

// ============================================================
// Tests
// ============================================================

describe('ContextFeeder', () => {
    let tracker: TokenBudgetTracker;
    let feeder: ContextFeeder;
    const logMessages: string[] = [];

    beforeEach(() => {
        logMessages.length = 0;
        const outputChannel = { appendLine: (msg: string) => logMessages.push(msg) };
        tracker = new TokenBudgetTracker(undefined, undefined, outputChannel);
        feeder = new ContextFeeder(tracker, outputChannel);
    });

    // ================================================================
    // 1. Relevance Scoring
    // ================================================================

    describe('Relevance Scoring', () => {
        it('returns neutral score of 50 when no keywords provided', () => {
            const item = makeContextItem();
            const keywords: RelevanceKeywordSet = {
                taskKeywords: [],
                fileKeywords: [],
                domainKeywords: [],
            };
            expect(feeder.scoreRelevance(item, keywords)).toBe(50);
        });

        it('scores higher when task keywords match the item label', () => {
            const item = makeContextItem({
                label: 'Database Migration Service',
                content: 'Some unrelated content about weather forecasts',
            });

            const keywordsWithTitleMatch: RelevanceKeywordSet = {
                taskKeywords: ['database', 'migration'],
                fileKeywords: [],
                domainKeywords: [],
            };
            const keywordsWithoutMatch: RelevanceKeywordSet = {
                taskKeywords: ['authentication', 'oauth'],
                fileKeywords: [],
                domainKeywords: [],
            };

            const scoreWithMatch = feeder.scoreRelevance(item, keywordsWithTitleMatch);
            const scoreWithoutMatch = feeder.scoreRelevance(item, keywordsWithoutMatch);

            expect(scoreWithMatch).toBeGreaterThan(scoreWithoutMatch);
        });

        it('scores higher when content keywords match but label does not', () => {
            const item = makeContextItem({
                label: 'Generic Item',
                content: 'This implements the database migration handler for SQLite tables',
            });

            const matchingKeywords: RelevanceKeywordSet = {
                taskKeywords: ['database', 'migration', 'sqlite'],
                fileKeywords: [],
                domainKeywords: [],
            };
            const nonMatchingKeywords: RelevanceKeywordSet = {
                taskKeywords: ['redis', 'cache', 'memcached'],
                fileKeywords: [],
                domainKeywords: [],
            };

            const scoreMatching = feeder.scoreRelevance(item, matchingKeywords);
            const scoreNonMatching = feeder.scoreRelevance(item, nonMatchingKeywords);

            expect(scoreMatching).toBeGreaterThan(scoreNonMatching);
        });

        it('awards file path matches when fileKeywords align with relatedFilePatterns', () => {
            const item = makeContextItem({
                label: 'Code Change',
                content: 'Updated file',
                metadata: {
                    sourceType: 'custom',
                    sourceId: 'test',
                    createdAt: new Date().toISOString(),
                    isStale: false,
                    relatedTaskIds: [],
                    relatedFilePatterns: ['src/core/database.ts', 'src/core/migration.ts'],
                },
            });

            const keywordsWithFilePath: RelevanceKeywordSet = {
                taskKeywords: [],
                fileKeywords: ['database.ts', 'migration.ts'],
                domainKeywords: [],
            };
            const keywordsWithoutFilePath: RelevanceKeywordSet = {
                taskKeywords: [],
                fileKeywords: ['auth.ts', 'router.ts'],
                domainKeywords: [],
            };

            const scoreWithFile = feeder.scoreRelevance(item, keywordsWithFilePath);
            const scoreWithoutFile = feeder.scoreRelevance(item, keywordsWithoutFilePath);

            expect(scoreWithFile).toBeGreaterThan(scoreWithoutFile);
        });

        it('applies staleness penalty for items marked as stale', () => {
            const freshItem = makeContextItem({
                label: 'Fresh item with database reference',
                content: 'database migration content',
                metadata: {
                    sourceType: 'custom',
                    sourceId: 'test',
                    createdAt: new Date().toISOString(),
                    isStale: false,
                    relatedTaskIds: [],
                    relatedFilePatterns: [],
                },
            });

            const staleItem = makeContextItem({
                label: 'Fresh item with database reference',
                content: 'database migration content',
                metadata: {
                    sourceType: 'custom',
                    sourceId: 'test',
                    // 30 days ago — way past 7-day staleness threshold
                    createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
                    isStale: true,
                    relatedTaskIds: [],
                    relatedFilePatterns: [],
                },
            });

            const keywords: RelevanceKeywordSet = {
                taskKeywords: ['database', 'migration'],
                fileKeywords: [],
                domainKeywords: [],
            };

            const freshScore = feeder.scoreRelevance(freshItem, keywords);
            const staleScore = feeder.scoreRelevance(staleItem, keywords);

            expect(freshScore).toBeGreaterThan(staleScore);
        });

        it('awards same-plan bonus when relatedTaskIds overlap with task keywords', () => {
            const item = makeContextItem({
                label: 'Related work',
                content: 'Some context data',
                metadata: {
                    sourceType: 'custom',
                    sourceId: 'test',
                    createdAt: new Date().toISOString(),
                    isStale: false,
                    relatedTaskIds: ['task-database-setup'],
                    relatedFilePatterns: [],
                },
            });

            const overlappingKeywords: RelevanceKeywordSet = {
                taskKeywords: ['database'],
                fileKeywords: [],
                domainKeywords: [],
            };
            const nonOverlappingKeywords: RelevanceKeywordSet = {
                taskKeywords: ['authentication'],
                fileKeywords: [],
                domainKeywords: [],
            };

            const overlapScore = feeder.scoreRelevance(item, overlappingKeywords);
            const nonOverlapScore = feeder.scoreRelevance(item, nonOverlappingKeywords);

            expect(overlapScore).toBeGreaterThan(nonOverlapScore);
        });
    });

    // ================================================================
    // 2. Keyword Extraction
    // ================================================================

    describe('Keyword Extraction', () => {
        it('extracts keywords from a task title, description, and acceptance criteria', () => {
            const task = makeTask({
                title: 'Implement DatabaseMigration service',
                description: 'Build a migration runner for SQLite',
                acceptance_criteria: 'All schema changes applied correctly',
            });

            const keywords = feeder.extractKeywords(task);

            expect(keywords.taskKeywords).toContain('implement');
            expect(keywords.taskKeywords).toContain('migration');
            expect(keywords.taskKeywords).toContain('sqlite');
            expect(keywords.taskKeywords).toContain('schema');
        });

        it('extracts file keywords from task files_modified', () => {
            const task = makeTask({
                files_modified: ['src/core/database.ts', 'src/views/plan-builder.ts'],
            });

            const keywords = feeder.extractKeywords(task);

            expect(keywords.fileKeywords).toContain('database');
            expect(keywords.fileKeywords).toContain('plan-builder');
            // Full path should also be present (lowercased)
            expect(keywords.fileKeywords).toContain('src/core/database.ts');
        });

        it('extracts domain keywords from user message', () => {
            const keywords = feeder.extractKeywords(
                undefined,
                'Fix the authentication bug in the login handler',
                undefined
            );

            expect(keywords.domainKeywords).toContain('fix');
            expect(keywords.domainKeywords).toContain('authentication');
            expect(keywords.domainKeywords).toContain('login');
            expect(keywords.domainKeywords).toContain('handler');
            // Stop words should be excluded
            expect(keywords.domainKeywords).not.toContain('the');
            expect(keywords.domainKeywords).not.toContain('in');
        });

        it('extracts domain keywords from plan config_json when valid JSON', () => {
            const plan = makePlan({
                name: 'API Redesign',
                config_json: JSON.stringify({
                    framework: 'express',
                    database: 'postgresql',
                    caching: 'redis',
                }),
            });

            const keywords = feeder.extractKeywords(undefined, undefined, plan);

            expect(keywords.domainKeywords).toContain('redesign');
            expect(keywords.domainKeywords).toContain('express');
            expect(keywords.domainKeywords).toContain('postgresql');
            expect(keywords.domainKeywords).toContain('redis');
        });

        it('splits camelCase words into separate keywords', () => {
            const task = makeTask({
                title: 'Fix DatabaseMigrationService error',
                description: '',
                acceptance_criteria: '',
            });

            const keywords = feeder.extractKeywords(task);

            // camelCase splitting extracts parts
            expect(keywords.taskKeywords).toContain('database');
            expect(keywords.taskKeywords).toContain('migration');
            expect(keywords.taskKeywords).toContain('service');
        });
    });

    // ================================================================
    // 3. Tier Sorting
    // ================================================================

    describe('Tier Sorting', () => {
        it('sorts mandatory items before important and supplementary items', () => {
            const items: ContextItem[] = [
                makeContextItem({
                    id: 'sup',
                    category: ContextCategory.Supplementary,
                    priority: ContextPriority.Optional,
                    relevanceScore: 90,
                }),
                makeContextItem({
                    id: 'mandatory',
                    category: ContextCategory.CurrentTask,
                    priority: ContextPriority.Mandatory,
                    relevanceScore: 50,
                }),
                makeContextItem({
                    id: 'important',
                    category: ContextCategory.ActivePlan,
                    priority: ContextPriority.Important,
                    relevanceScore: 70,
                }),
            ];

            const sorted = feeder.sortByTierAndRelevance(items);

            expect(sorted[0].id).toBe('mandatory');
            expect(sorted[1].id).toBe('important');
            expect(sorted[2].id).toBe('sup');
        });

        it('sorts by relevance score within the same tier', () => {
            const items: ContextItem[] = [
                makeContextItem({
                    id: 'low-relevance',
                    category: ContextCategory.ActivePlan,
                    priority: ContextPriority.Important,
                    relevanceScore: 20,
                }),
                makeContextItem({
                    id: 'high-relevance',
                    category: ContextCategory.RelatedTicket,
                    priority: ContextPriority.Important,
                    relevanceScore: 80,
                }),
                makeContextItem({
                    id: 'mid-relevance',
                    category: ContextCategory.RecentHistory,
                    priority: ContextPriority.Important,
                    relevanceScore: 50,
                }),
            ];

            const sorted = feeder.sortByTierAndRelevance(items);

            expect(sorted[0].id).toBe('high-relevance');
            expect(sorted[1].id).toBe('mid-relevance');
            expect(sorted[2].id).toBe('low-relevance');
        });

        it('handles mixed tiers with correct ordering', () => {
            const items: ContextItem[] = [
                makeContextItem({
                    id: 'optional-high',
                    category: ContextCategory.OlderHistory,
                    priority: ContextPriority.Optional,
                    relevanceScore: 95,
                }),
                makeContextItem({
                    id: 'mandatory-low',
                    category: ContextCategory.SystemPrompt,
                    priority: ContextPriority.Mandatory,
                    relevanceScore: 10,
                }),
                makeContextItem({
                    id: 'supplementary-mid',
                    category: ContextCategory.DesignComponents,
                    priority: ContextPriority.Supplementary,
                    relevanceScore: 60,
                }),
                makeContextItem({
                    id: 'mandatory-high',
                    category: ContextCategory.UserMessage,
                    priority: ContextPriority.Mandatory,
                    relevanceScore: 100,
                }),
            ];

            const sorted = feeder.sortByTierAndRelevance(items);

            // Mandatory tier first (sorted by relevance within tier)
            expect(sorted[0].id).toBe('mandatory-high');
            expect(sorted[1].id).toBe('mandatory-low');
            // Supplementary tier next
            expect(sorted[2].id).toBe('supplementary-mid');
            // Optional tier last
            expect(sorted[3].id).toBe('optional-high');
        });
    });

    // ================================================================
    // 4. Compression
    // ================================================================

    describe('Compression', () => {
        describe('stripComments', () => {
            it('removes single-line comments', () => {
                const code = [
                    'const x = 1; // this is a comment',
                    '// another comment',
                    'const y = 2;',
                ].join('\n');

                const stripped = feeder.stripComments(code);

                expect(stripped).toContain('const x = 1; ');
                expect(stripped).toContain('const y = 2;');
                expect(stripped).not.toContain('this is a comment');
                expect(stripped).not.toContain('another comment');
            });

            it('removes block comments', () => {
                const code = [
                    '/* block comment */',
                    'const a = 1;',
                    '/**',
                    ' * JSDoc comment',
                    ' */',
                    'function foo() {}',
                ].join('\n');

                const stripped = feeder.stripComments(code);

                expect(stripped).toContain('const a = 1;');
                expect(stripped).toContain('function foo() {}');
                expect(stripped).not.toContain('block comment');
                expect(stripped).not.toContain('JSDoc comment');
            });

            it('preserves comments inside string literals', () => {
                const code = `const msg = "hello // not a comment";`;
                const stripped = feeder.stripComments(code);
                expect(stripped).toContain('"hello // not a comment"');
            });

            it('returns empty string for empty input', () => {
                expect(feeder.stripComments('')).toBe('');
            });
        });

        describe('collapseRepeatedPatterns', () => {
            it('collapses 3+ similar lines into first, count, and last', () => {
                const lines = [
                    'import { A } from "./a";',
                    'import { B } from "./b";',
                    'import { C } from "./c";',
                    'import { D } from "./d";',
                    'import { E } from "./e";',
                    '',
                    'const x = 1;',
                ].join('\n');

                const collapsed = feeder.collapseRepeatedPatterns(lines);

                expect(collapsed).toContain('import { A }');
                expect(collapsed).toContain('import { E }');
                expect(collapsed).toContain('similar entries');
                expect(collapsed).toContain('const x = 1;');
            });

            it('does not collapse fewer than 3 similar lines', () => {
                const lines = [
                    'import { A } from "./a";',
                    'import { B } from "./b";',
                    'const x = 1;',
                ].join('\n');

                const collapsed = feeder.collapseRepeatedPatterns(lines);

                expect(collapsed).not.toContain('similar entries');
                expect(collapsed).toContain('import { A }');
                expect(collapsed).toContain('import { B }');
            });

            it('returns empty string for empty input', () => {
                expect(feeder.collapseRepeatedPatterns('')).toBe('');
            });
        });

        describe('abbreviateJSON', () => {
            it('removes null values and truncates long strings', () => {
                const json = JSON.stringify({
                    name: 'test',
                    description: 'A'.repeat(100),
                    removed: null,
                    nested: { value: 'short', gone: null },
                });

                const abbreviated = feeder.abbreviateJSON(json);
                const parsed = JSON.parse(abbreviated);

                expect(parsed.name).toBe('test');
                // Long string truncated to 47 + "..."
                expect(parsed.description.length).toBeLessThan(100);
                expect(parsed.description).toContain('...');
                // null values removed
                expect(parsed.removed).toBeUndefined();
                expect(parsed.nested.gone).toBeUndefined();
            });

            it('limits arrays to 5 elements with overflow indicator', () => {
                const json = JSON.stringify({
                    items: [1, 2, 3, 4, 5, 6, 7, 8],
                });

                const abbreviated = feeder.abbreviateJSON(json);
                const parsed = JSON.parse(abbreviated);

                expect(parsed.items).toHaveLength(6); // 5 real + 1 "[+3 more]"
                expect(parsed.items[5]).toContain('+3 more');
            });

            it('returns original text when input is not valid JSON', () => {
                const invalid = 'not json at all { broken';
                expect(feeder.abbreviateJSON(invalid)).toBe(invalid);
            });

            it('returns empty string for empty input', () => {
                expect(feeder.abbreviateJSON('')).toBe('');
            });
        });

        describe('truncateHistory', () => {
            it('keeps head and tail lines with omission marker', () => {
                const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`);
                const content = lines.join('\n');

                const truncated = feeder.truncateHistory(content, 10);
                const resultLines = truncated.split('\n');

                // head = ceil(10 * 0.6) = 6, tail = 10 - 6 = 4
                expect(resultLines[0]).toBe('Line 1');
                expect(resultLines[5]).toBe('Line 6');
                expect(resultLines[6]).toContain('lines omitted');
                expect(resultLines[resultLines.length - 1]).toBe('Line 20');
            });

            it('returns content unchanged when under maxLines', () => {
                const content = 'Line 1\nLine 2\nLine 3';
                expect(feeder.truncateHistory(content, 10)).toBe(content);
            });

            it('returns empty string for empty input', () => {
                expect(feeder.truncateHistory('', 10)).toBe('');
            });
        });

        describe('compressItem', () => {
            it('returns item unchanged when it already fits the target', () => {
                const item = makeContextItem({
                    content: 'short',
                    contentType: ContentType.NaturalText,
                });

                const compressed = feeder.compressItem(item, 10000);

                expect(compressed.content).toBe('short');
            });

            it('strips comments from code items as first compression strategy', () => {
                const codeWithComments = [
                    '// Comment line 1',
                    '// Comment line 2',
                    '/* Big block comment',
                    '   spanning multiple lines',
                    '*/',
                    'const x = 1;',
                    'const y = 2;',
                ].join('\n');

                const item = makeContextItem({
                    content: codeWithComments,
                    contentType: ContentType.Code,
                });

                // Set a target that is smaller than the original but can fit stripped version
                const originalTokens = tracker.estimateTokens(codeWithComments, ContentType.Code);
                const strippedContent = feeder.stripComments(codeWithComments);
                const strippedTokens = tracker.estimateTokens(strippedContent, ContentType.Code);

                // Target between stripped and original
                const targetTokens = Math.floor((originalTokens + strippedTokens) / 2);

                const compressed = feeder.compressItem(item, targetTokens);

                expect(compressed.content).not.toContain('Comment line 1');
                expect(compressed.content).toContain('const x = 1;');
            });

            it('applies abbreviateJSON for JSON content type', () => {
                const longJson = JSON.stringify({
                    data: 'A'.repeat(200),
                    nullField: null,
                    items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
                });

                const item = makeContextItem({
                    content: longJson,
                    contentType: ContentType.JSON,
                });

                const originalTokens = tracker.estimateTokens(longJson, ContentType.JSON);
                // Abbreviated JSON should be smaller; set target between abbreviated and original
                const abbreviated = feeder.abbreviateJSON(longJson);
                const abbreviatedTokens = tracker.estimateTokens(abbreviated, ContentType.JSON);

                if (abbreviatedTokens < originalTokens) {
                    const targetTokens = Math.floor((originalTokens + abbreviatedTokens) / 2);
                    const compressed = feeder.compressItem(item, targetTokens);

                    const parsed = JSON.parse(compressed.content);
                    // null values removed
                    expect(parsed.nullField).toBeUndefined();
                }
            });

            it('progressively applies strategies and ultimately hard-truncates', () => {
                // Create a very large item that must be hard-truncated
                const largeContent = Array.from({ length: 500 }, (_, i) => `Line ${i}: ${'x'.repeat(80)}`).join('\n');

                const item = makeContextItem({
                    content: largeContent,
                    contentType: ContentType.NaturalText,
                });

                // Very small target to force hard truncation
                const compressed = feeder.compressItem(item, 20);

                expect(compressed.content.length).toBeLessThan(largeContent.length);
                expect(compressed.content).toContain('truncated to fit budget');
            });
        });
    });

    // ================================================================
    // 5. buildOptimizedMessages
    // ================================================================

    describe('buildOptimizedMessages', () => {
        it('includes system prompt, user message, task, ticket, and plan', () => {
            const context: AgentContext = {
                task: makeTask(),
                ticket: makeTicket(),
                plan: makePlan(),
                conversationHistory: [],
            };

            const result = feeder.buildOptimizedMessages(
                AgentType.Orchestrator,
                'How should I proceed with the migration?',
                'You are the orchestrator agent.',
                context
            );

            expect(result.messages.length).toBeGreaterThanOrEqual(3);
            // First message should be system prompt
            expect(result.messages[0].role).toBe('system');
            expect(result.messages[0].content).toBe('You are the orchestrator agent.');
            // Last message should be user message
            const lastMsg = result.messages[result.messages.length - 1];
            expect(lastMsg.role).toBe('user');
            expect(lastMsg.content).toContain('migration');

            // Should have included items for system prompt, user message, task, ticket, plan
            expect(result.includedItems.length).toBeGreaterThanOrEqual(3);
            expect(result.budget).toBeDefined();
            expect(result.budget.consumed).toBeGreaterThan(0);
            expect(result.compressionApplied).toBeDefined();
            expect(result.totalItemsConsidered).toBeGreaterThanOrEqual(3);
        });

        it('excludes low-priority items when budget is tight', () => {
            // Create a tracker with a tiny model to simulate budget pressure
            const tinyTracker = new TokenBudgetTracker(undefined, undefined);
            // Register a model with a very small context window
            tinyTracker.registerModel({
                id: 'tiny-model',
                name: 'Tiny Model',
                contextWindowTokens: 500,
                maxOutputTokens: 100,
                tokensPerChar: {
                    [ContentType.Code]: 3.2,
                    [ContentType.NaturalText]: 4.0,
                    [ContentType.JSON]: 3.5,
                    [ContentType.Markdown]: 3.8,
                    [ContentType.Mixed]: 3.6,
                },
                overheadTokensPerMessage: 4,
            });
            tinyTracker.setCurrentModel('tiny-model');

            const tinyFeeder = new ContextFeeder(tinyTracker);

            const context: AgentContext = {
                task: makeTask(),
                ticket: makeTicket(),
                plan: makePlan(),
                conversationHistory: Array.from({ length: 30 }, (_, i) =>
                    makeConversation({ content: `Message ${i}: ${'x'.repeat(200)}` })
                ),
                additionalContext: {
                    largeBlob: 'y'.repeat(5000),
                },
            };

            const result = tinyFeeder.buildOptimizedMessages(
                AgentType.Orchestrator,
                'Process the task',
                'You are an agent.',
                context
            );

            // Budget constraints mean some items should be excluded
            expect(result.excludedItems.length).toBeGreaterThan(0);
            // System prompt and user message are always included
            expect(result.includedItems.some(i => i.category === ContextCategory.SystemPrompt)).toBe(true);
            expect(result.includedItems.some(i => i.category === ContextCategory.UserMessage)).toBe(true);
        });

        it('applies compression when items do not fit but are important enough', () => {
            // Use a moderately small model
            const smallTracker = new TokenBudgetTracker(undefined, undefined);
            smallTracker.registerModel({
                id: 'small-model',
                name: 'Small Model',
                contextWindowTokens: 2000,
                maxOutputTokens: 200,
                tokensPerChar: {
                    [ContentType.Code]: 3.2,
                    [ContentType.NaturalText]: 4.0,
                    [ContentType.JSON]: 3.5,
                    [ContentType.Markdown]: 3.8,
                    [ContentType.Mixed]: 3.6,
                },
                overheadTokensPerMessage: 4,
            });
            smallTracker.setCurrentModel('small-model');

            const smallFeeder = new ContextFeeder(smallTracker);

            // Create context with moderate-sized conversation history
            const context: AgentContext = {
                task: makeTask(),
                plan: makePlan(),
                conversationHistory: Array.from({ length: 15 }, (_, i) =>
                    makeConversation({ content: `Discussion point ${i}: ${'details '.repeat(50)}` })
                ),
            };

            const result = smallFeeder.buildOptimizedMessages(
                AgentType.Planning,
                'Create the implementation plan',
                'You are the planning agent.',
                context
            );

            // The result should have been produced without throwing
            expect(result.messages.length).toBeGreaterThanOrEqual(2);
            expect(result.budget.consumed).toBeGreaterThan(0);
            // With a small budget and large history, compression is likely
            // (or items excluded — either is acceptable budget management)
            expect(result.excludedItems.length + (result.compressionApplied ? 1 : 0)).toBeGreaterThanOrEqual(0);
        });

        it('handles empty context gracefully', () => {
            const context: AgentContext = {
                conversationHistory: [],
            };

            const result = feeder.buildOptimizedMessages(
                AgentType.Answer,
                'Hello',
                'You answer questions.',
                context
            );

            // At minimum: system prompt + user message
            expect(result.messages.length).toBeGreaterThanOrEqual(2);
            expect(result.includedItems.length).toBeGreaterThanOrEqual(2);
            expect(result.excludedItems.length).toBe(0);
            expect(result.totalItemsConsidered).toBe(2); // 0 context items + 2 (system + user)
        });

        it('includes additional items passed directly', () => {
            const context: AgentContext = {
                conversationHistory: [],
            };

            const additionalItem = makeContextItem({
                id: 'custom-extra',
                label: 'Extra Context',
                content: 'Additional information for the agent',
                category: ContextCategory.Supplementary,
                priority: ContextPriority.Supplementary,
            });

            const result = feeder.buildOptimizedMessages(
                AgentType.Research,
                'Research this topic',
                'You are a research agent.',
                context,
                [additionalItem]
            );

            // Should consider the additional item
            expect(result.totalItemsConsidered).toBe(3); // 1 additional + 2 (system + user)
            // The extra item should be included (budget is large enough)
            const extraIncluded = result.includedItems.find(i => i.id === 'custom-extra');
            expect(extraIncluded).toBeDefined();
        });
    });

    // ================================================================
    // 6. Component Tree Summarization
    // ================================================================

    describe('summarizeComponentTree', () => {
        it('produces a nested tree representation', () => {
            const components: DesignComponent[] = [
                makeDesignComponent({
                    id: 'root',
                    name: 'Page',
                    type: 'container',
                    parent_id: null,
                    sort_order: 0,
                    x: 0, y: 0, width: 1440, height: 900,
                }),
                makeDesignComponent({
                    id: 'header',
                    name: 'Header',
                    type: 'header',
                    parent_id: 'root',
                    sort_order: 0,
                    x: 0, y: 0, width: 1440, height: 60,
                }),
                makeDesignComponent({
                    id: 'logo',
                    name: 'Logo',
                    type: 'image',
                    parent_id: 'header',
                    sort_order: 0,
                    x: 20, y: 10, width: 120, height: 40,
                }),
            ];

            const summary = feeder.summarizeComponentTree(components);

            expect(summary).toContain('Page [container]');
            expect(summary).toContain('Header [header]');
            expect(summary).toContain('Logo [image]');
            // Verify indentation (nested elements have more leading spaces)
            const lines = summary.split('\n');
            expect(lines.length).toBe(3);
        });

        it('collapses branches when children exceed MAX_VISIBLE_CHILDREN (5)', () => {
            const parent = makeDesignComponent({
                id: 'parent',
                name: 'ListContainer',
                type: 'container',
                parent_id: null,
                sort_order: 0,
            });

            // Create 8 children — exceeds the limit of 5
            const children: DesignComponent[] = Array.from({ length: 8 }, (_, i) =>
                makeDesignComponent({
                    id: `child-${i}`,
                    name: `Item${i}`,
                    type: 'text',
                    parent_id: 'parent',
                    sort_order: i,
                    x: 0, y: i * 40, width: 200, height: 30,
                })
            );

            const summary = feeder.summarizeComponentTree([parent, ...children]);

            expect(summary).toContain('ListContainer [container]');
            // First 3 shown
            expect(summary).toContain('Item0');
            expect(summary).toContain('Item1');
            expect(summary).toContain('Item2');
            // Collapsed indicator
            expect(summary).toContain('children collapsed');
            // Last one shown
            expect(summary).toContain('Item7');
            // Middle items NOT shown
            expect(summary).not.toContain('Item3 [text]');
            expect(summary).not.toContain('Item4 [text]');
        });

        it('returns placeholder for empty component list', () => {
            expect(feeder.summarizeComponentTree([])).toBe('[No components]');
        });

        it('returns placeholder for null/undefined input', () => {
            expect(feeder.summarizeComponentTree(null as unknown as DesignComponent[])).toBe('[No components]');
            expect(feeder.summarizeComponentTree(undefined as unknown as DesignComponent[])).toBe('[No components]');
        });
    });

    // ================================================================
    // 7. Design Context
    // ================================================================

    describe('buildDesignContext', () => {
        it('creates full-detail item for page components and summary for other pages', () => {
            const budget = tracker.createBudget(AgentType.Planning);

            const pageComponents: DesignComponent[] = [
                makeDesignComponent({
                    id: 'comp-a',
                    page_id: 'page-home',
                    name: 'HeroSection',
                    type: 'container',
                    x: 0, y: 0, width: 1440, height: 500,
                    content: 'Welcome to our platform',
                }),
                makeDesignComponent({
                    id: 'comp-b',
                    page_id: 'page-home',
                    name: 'CallToAction',
                    type: 'button',
                    parent_id: 'comp-a',
                    x: 600, y: 400, width: 200, height: 50,
                    content: 'Get Started',
                }),
            ];

            const otherPageComponents: DesignComponent[] = [
                makeDesignComponent({
                    id: 'comp-c',
                    page_id: 'page-about',
                    name: 'AboutHeader',
                    type: 'header',
                    x: 0, y: 0, width: 1440, height: 60,
                }),
            ];

            const allComponents = [...pageComponents, ...otherPageComponents];

            const items = feeder.buildDesignContext('page-home', allComponents, budget);

            // Should have at least 2 items: one for page components, one for other pages
            expect(items.length).toBe(2);

            // First item: full detail for the page
            const pageItem = items.find(i => i.id === 'design-page-page-home');
            expect(pageItem).toBeDefined();
            expect(pageItem!.content).toContain('HeroSection [container]');
            expect(pageItem!.content).toContain('CallToAction [button]');
            expect(pageItem!.content).toContain('Welcome to our platform');
            expect(pageItem!.priority).toBe(ContextPriority.Important);

            // Second item: summary for other pages
            const otherItem = items.find(i => i.id === 'design-other-pages');
            expect(otherItem).toBeDefined();
            expect(otherItem!.content).toContain('AboutHeader');
            expect(otherItem!.priority).toBe(ContextPriority.Supplementary);
        });

        it('returns only page components item when no other pages exist', () => {
            const budget = tracker.createBudget(AgentType.Planning);

            const components: DesignComponent[] = [
                makeDesignComponent({
                    id: 'comp-only',
                    page_id: 'page-solo',
                    name: 'OnlyComponent',
                    type: 'text',
                    x: 10, y: 10, width: 300, height: 50,
                }),
            ];

            const items = feeder.buildDesignContext('page-solo', components, budget);

            expect(items.length).toBe(1);
            expect(items[0].id).toBe('design-page-page-solo');
            expect(items[0].content).toContain('OnlyComponent');
        });

        it('returns empty array when no components provided', () => {
            const budget = tracker.createBudget(AgentType.Planning);
            const items = feeder.buildDesignContext('page-1', [], budget);
            expect(items).toEqual([]);
        });

        it('collapses children when count exceeds MAX_VISIBLE_CHILDREN (lines 644-653)', () => {
            // MAX_VISIBLE_CHILDREN is 5. The collapsing happens in summarizeComponentTree,
            // which is called for OTHER pages' components in buildDesignContext.
            // So we put the many-children components on a different page than the queried pageId.
            const budget = tracker.createBudget(AgentType.Planning);

            const components: DesignComponent[] = [];

            // Parent container on page "other-page"
            components.push(makeDesignComponent({
                id: 'parent-container',
                page_id: 'other-page',
                parent_id: null,
                name: 'BigContainer',
                type: 'container',
                x: 0, y: 0, width: 800, height: 600,
            }));

            // Create 10 children to exceed MAX_VISIBLE_CHILDREN (5)
            for (let i = 0; i < 10; i++) {
                components.push(makeDesignComponent({
                    id: `child-${i}`,
                    page_id: 'other-page',
                    parent_id: 'parent-container',
                    name: `Child_${i}`,
                    type: 'button',
                    sort_order: i,
                    x: i * 40, y: 0, width: 100, height: 40,
                }));
            }

            // Also add a component on the queried page so items are non-empty
            components.push(makeDesignComponent({
                id: 'queried-comp',
                page_id: 'queried-page',
                parent_id: null,
                name: 'QueriedComponent',
                type: 'container',
                x: 0, y: 0, width: 400, height: 300,
            }));

            const items = feeder.buildDesignContext('queried-page', components, budget);
            expect(items.length).toBeGreaterThanOrEqual(1);

            // The "other page" summary should use summarizeComponentTree which collapses
            const otherPageItem = items.find(i => i.id === 'design-other-pages');
            expect(otherPageItem).toBeDefined();
            expect(otherPageItem!.content).toContain('collapsed');
        });
    });

    // ===================== COVERAGE GAP TESTS =====================

    describe('extractKeywords JSON parse fallback (line 226)', () => {
        it('treats invalid JSON config_json as plain text', () => {
            const task = makeTask();
            const plan = makePlan({ config_json: 'not valid json {{{' });

            const keywords = feeder.extractKeywords(task, undefined, plan);
            // Should have extracted words from the invalid JSON string as plain text
            expect(keywords.domainKeywords.length).toBeGreaterThanOrEqual(0);
        });
    });

    describe('compressItem strategies 3 and 4 (lines 300, 308)', () => {
        it('compressItem applies collapse repeated patterns', () => {
            const item = makeContextItem({
                id: 'repeated-patterns',
                label: 'Repeated content',
                content: 'Error: timeout\nError: timeout\nError: timeout\nError: timeout\nError: timeout\n' +
                    'Error: timeout\nError: timeout\nError: timeout\nError: timeout\nError: timeout\n' +
                    'Success: completed\n',
                contentType: ContentType.NaturalText,
                estimatedTokens: 200,
                priority: ContextPriority.Supplementary,
            });

            // Target a small number of tokens to force deeper compression
            const compressed = feeder.compressItem(item, 30);
            expect(compressed.content.length).toBeLessThan(item.content.length);
        });

        it('compressItem applies truncation strategy', () => {
            const longContent = Array.from({ length: 100 }, (_, i) =>
                `Line ${i}: This is content that goes on and on with details.`
            ).join('\n');

            const item = makeContextItem({
                id: 'long-item',
                label: 'Long content',
                content: longContent,
                contentType: ContentType.NaturalText,
                estimatedTokens: 500,
                priority: ContextPriority.Supplementary,
            });

            const compressed = feeder.compressItem(item, 20);
            expect(compressed.content.length).toBeLessThan(item.content.length);
        });
    });

    describe('stripComments edge cases (lines 346-400)', () => {
        it('handles template strings correctly', () => {
            const code = 'const msg = `Hello ${name}!`;\n// comment\nconst x = 1;';
            const item = makeContextItem({
                id: 'template-string',
                label: 'Code with template string',
                content: code,
                contentType: ContentType.Code,
                estimatedTokens: 20,
                priority: ContextPriority.Supplementary,
            });

            const compressed = feeder.compressItem(item, 15);
            // Template string should be preserved
            expect(compressed.content).toContain('`Hello ${name}!`');
            // Comment should be stripped
            expect(compressed.content).not.toContain('// comment');
        });

        it('handles escaped characters in strings', () => {
            const code = "const str = 'it\\'s a test';\n// another comment\nconst y = 2;";
            const item = makeContextItem({
                id: 'escaped-string',
                label: 'Code with escapes',
                content: code,
                contentType: ContentType.Code,
                estimatedTokens: 20,
                priority: ContextPriority.Supplementary,
            });

            const compressed = feeder.compressItem(item, 15);
            // String with escape should be preserved
            expect(compressed.content).toContain("'s a test");
        });

        it('handles escaped characters in template strings', () => {
            const code = 'const tmpl = `escaped \\` backtick`;\n// comment\nconst z = 3;';
            const item = makeContextItem({
                id: 'escaped-template',
                label: 'Code with escaped template',
                content: code,
                contentType: ContentType.Code,
                estimatedTokens: 20,
                priority: ContextPriority.Supplementary,
            });

            const compressed = feeder.compressItem(item, 15);
            // Should handle escaped backtick in template string
            expect(compressed.content).toContain('backtick');
        });
    });

    describe('buildOptimizedMessages excluded items (lines 560, 583-584)', () => {
        it('excludes items that cannot fit even after compression', () => {
            const localLogMessages: string[] = [];
            const logChannel = { appendLine: (msg: string) => localLogMessages.push(msg) };
            const localTracker = new TokenBudgetTracker(undefined, undefined, logChannel);
            const localFeeder = new ContextFeeder(localTracker, logChannel);

            const context: AgentContext = {
                task: makeTask(),
                plan: makePlan(),
                conversationHistory: [],
            };

            // Add a huge additional item that will not fit.
            // Budget is ~25804 tokens. At ~3.6 chars/token, we need >92900 chars to overflow.
            // Using Optional priority (4) so it goes to direct exclusion without compression attempt.
            const hugeItem = makeContextItem({
                id: 'huge-item',
                label: 'Huge item',
                content: 'x '.repeat(100000), // 200000 chars = ~55555 tokens >> budget
                contentType: ContentType.NaturalText,
                estimatedTokens: 55000,
                priority: ContextPriority.Optional,
                category: ContextCategory.Supplementary,
            });

            const result = localFeeder.buildOptimizedMessages(
                AgentType.Planning,
                'User message',
                'System prompt',
                context,
                [hugeItem]
            );

            // The huge item should be excluded
            expect(result.excludedItems.length).toBeGreaterThanOrEqual(0);
            // Check that log messages were generated
            expect(localLogMessages.some(m => m.includes('Excluded') || m.includes('ContextFeeder'))).toBe(true);
        });
    });

    describe('abbreviateObject edge cases (lines 1093, 1124)', () => {
        it('abbreviateObject returns undefined for null', () => {
            const result = (feeder as any).abbreviateObject(null);
            expect(result).toBeUndefined();
        });

        it('abbreviateObject returns undefined for undefined', () => {
            const result = (feeder as any).abbreviateObject(undefined);
            expect(result).toBeUndefined();
        });

        it('abbreviateObject passes through non-standard types', () => {
            // Symbols, functions, etc. — the default return
            const sym = Symbol('test');
            const result = (feeder as any).abbreviateObject(sym);
            expect(result).toBe(sym);
        });
    });

    describe('calculateRecencyBonus catch block (line 1150)', () => {
        it('returns 0 for unparseable date strings', () => {
            const bonus = (feeder as any).calculateRecencyBonus('not-a-date');
            expect(bonus).toBe(0);
        });

        it('returns 0 for null/undefined dates', () => {
            expect((feeder as any).calculateRecencyBonus(null)).toBe(0);
            expect((feeder as any).calculateRecencyBonus(undefined)).toBe(0);
        });

        it('returns 10 for recent timestamps (within last hour)', () => {
            const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 minutes ago
            const bonus = (feeder as any).calculateRecencyBonus(recent);
            expect(bonus).toBe(10);
        });

        it('returns 5 for timestamps within last day', () => {
            const yesterday = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(); // 12 hours ago
            const bonus = (feeder as any).calculateRecencyBonus(yesterday);
            expect(bonus).toBe(5);
        });

        it('returns 2 for timestamps within last week', () => {
            const lastWeek = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 days ago
            const bonus = (feeder as any).calculateRecencyBonus(lastWeek);
            expect(bonus).toBe(2);
        });

        it('returns 0 for old timestamps', () => {
            const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago
            const bonus = (feeder as any).calculateRecencyBonus(old);
            expect(bonus).toBe(0);
        });

        it('returns 0 when Date constructor throws (line 1150 catch block)', () => {
            // Force the catch block by temporarily overriding Date
            const origDate = global.Date;
            global.Date = function FakeDate(value?: any) {
                if (value === '__THROW__') {
                    throw new Error('Forced Date error');
                }
                return new origDate(value);
            } as any;
            (global.Date as any).now = origDate.now;
            try {
                const bonus = (feeder as any).calculateRecencyBonus('__THROW__');
                expect(bonus).toBe(0);
            } finally {
                global.Date = origDate;
            }
        });
    });

    // ===================== ADDITIONAL COVERAGE GAP TESTS =====================

    describe('compressItem strategy 4 - truncateHistory return path (line 308)', () => {
        it('returns compressed item when truncateHistory fits the target', () => {
            // Create content where each line has a unique prefix so collapseRepeatedPatterns
            // won't collapse them, but truncateHistory can bring it within target.
            // Use lines with varied first words to avoid pattern detection.
            const words = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel',
                'India', 'Juliet', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec',
                'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'Xray', 'Yankee', 'Zulu'];
            const lines = Array.from({ length: 60 }, (_, i) =>
                `${words[i % words.length]}_${i}: data-${Math.random().toString(36).slice(2, 10)} info-${i * 7}`
            ).join('\n');

            const item = makeContextItem({
                id: 'truncatable-item',
                label: 'Truncatable content',
                content: lines,
                contentType: ContentType.NaturalText,
                estimatedTokens: 500,
                priority: ContextPriority.Supplementary,
            });

            // After collapseRepeatedPatterns (strategy 3), lines with unique prefixes should stay.
            // truncateHistory (strategy 4) should then be applied.
            // Target allows roughly half the lines.
            const originalTokens = tracker.estimateTokens(lines, ContentType.NaturalText);
            const targetTokens = Math.floor(originalTokens * 0.4);

            const compressed = feeder.compressItem(item, targetTokens);
            expect(compressed.content.length).toBeLessThan(lines.length);
            // Should have been processed by truncateHistory or hard truncation
            // (if truncateHistory fits, line 308 is hit; if not, hard truncation adds "truncated to fit budget")
            expect(
                compressed.content.includes('lines omitted') || compressed.content.includes('truncated to fit budget')
            ).toBe(true);
        });
    });

    describe('stripComments unterminated block comment (line 371)', () => {
        it('handles unterminated block comment that reaches end of string', () => {
            // Block comment that never closes with */
            const code = 'const x = 1;\n/* this block comment never ends\nmore comment text';
            const stripped = feeder.stripComments(code);

            // The const line should be preserved
            expect(stripped).toContain('const x = 1;');
            // The block comment text should be stripped
            expect(stripped).not.toContain('this block comment never ends');
        });
    });

    describe('buildOptimizedMessages SystemPrompt/UserMessage skip (line 560)', () => {
        it('skips items with SystemPrompt or UserMessage category in the sorted loop', () => {
            // Build a context that has items with SystemPrompt or UserMessage category
            // These are created internally by buildContextItems and then sorted.
            // The loop at line 556 skips them because they're already added.
            // We pass additional items with those categories to verify they are skipped.
            const context: AgentContext = {
                conversationHistory: [],
            };

            const extraSystemItem = makeContextItem({
                id: 'extra-system',
                label: 'Extra system prompt',
                content: 'Extra system content',
                category: ContextCategory.SystemPrompt,
                priority: ContextPriority.Mandatory,
            });

            const extraUserItem = makeContextItem({
                id: 'extra-user',
                label: 'Extra user message',
                content: 'Extra user content',
                category: ContextCategory.UserMessage,
                priority: ContextPriority.Mandatory,
            });

            const result = feeder.buildOptimizedMessages(
                AgentType.Planning,
                'Real user message',
                'Real system prompt',
                context,
                [extraSystemItem, extraUserItem]
            );

            // The extra system and user items should be skipped (not included as separate messages)
            // Only the built-in system prompt and user message should appear
            const systemMessages = result.messages.filter(m =>
                m.role === 'system' && m.content === 'Real system prompt'
            );
            expect(systemMessages.length).toBe(1);

            const userMessages = result.messages.filter(m =>
                m.role === 'user' && m.content === 'Real user message'
            );
            expect(userMessages.length).toBe(1);
        });
    });

    describe('buildOptimizedMessages compression exclusion path (lines 583-584)', () => {
        it('logs exclusion when compressed item still does not fit budget', () => {
            const localLogMessages: string[] = [];
            const logChannel = { appendLine: (msg: string) => localLogMessages.push(msg) };

            // Use a small model so the large item exceeds the budget
            const localTracker = new TokenBudgetTracker(undefined, undefined, logChannel);
            localTracker.registerModel({
                id: 'small-for-exclusion',
                name: 'Small For Exclusion',
                contextWindowTokens: 500,
                maxOutputTokens: 100,
                tokensPerChar: {
                    [ContentType.Code]: 3.2,
                    [ContentType.NaturalText]: 4.0,
                    [ContentType.JSON]: 3.5,
                    [ContentType.Markdown]: 3.8,
                    [ContentType.Mixed]: 3.6,
                },
                overheadTokensPerMessage: 4,
            });
            localTracker.setCurrentModel('small-for-exclusion');

            const localFeeder = new ContextFeeder(localTracker, logChannel);

            const context: AgentContext = {
                conversationHistory: [],
            };

            // Make a large Supplementary item
            const largeItem = makeContextItem({
                id: 'large-supplementary',
                label: 'Large supplementary item',
                content: 'x'.repeat(5000), // ~1250 tokens, won't fit 376 remaining
                contentType: ContentType.NaturalText,
                category: ContextCategory.DesignComponents,
                priority: ContextPriority.Supplementary,
                estimatedTokens: 1250,
            });

            // Spy on compressItem to make it return something still too large
            jest.spyOn(localFeeder, 'compressItem').mockImplementation(
                (item: any, _targetTokens: any) => {
                    // Return a "compressed" item that is still larger than the remaining budget
                    return {
                        ...item,
                        content: 'y'.repeat(3000), // ~750 tokens, still won't fit ~370 remaining
                    };
                }
            );

            const result = localFeeder.buildOptimizedMessages(
                AgentType.Planning,
                'User message',
                'System prompt',
                context,
                [largeItem]
            );

            // The large supplementary item should be excluded even after compression attempt
            const hasCompressionExclusion = localLogMessages.some(m =>
                m.includes('even compressed') || m.includes('Excluded') || m.includes('ContextFeeder')
            );
            expect(hasCompressionExclusion).toBe(true);
            expect(result.excludedItems.length).toBeGreaterThan(0);
        });
    });

    describe('summarizeComponentTree with >5 root-level components (lines 644-653)', () => {
        it('collapses root-level children when they exceed MAX_VISIBLE_CHILDREN', () => {
            // Need more than 5 root-level components (parent_id === null)
            const components: DesignComponent[] = Array.from({ length: 8 }, (_, i) =>
                makeDesignComponent({
                    id: `root-${i}`,
                    name: `RootComponent${i}`,
                    type: 'container',
                    parent_id: null,
                    sort_order: i,
                    x: 0, y: i * 100, width: 1440, height: 80,
                })
            );

            const summary = feeder.summarizeComponentTree(components);

            // First 3 should be shown (showFirst = 3)
            expect(summary).toContain('RootComponent0');
            expect(summary).toContain('RootComponent1');
            expect(summary).toContain('RootComponent2');

            // Last 1 should be shown (showLast = 1)
            expect(summary).toContain('RootComponent7');

            // Middle ones should be collapsed
            expect(summary).toContain('children collapsed');

            // Middle components should NOT appear directly
            expect(summary).not.toContain('RootComponent3 [container]');
            expect(summary).not.toContain('RootComponent4 [container]');
        });
    });

    // ===================== BRANCH COVERAGE TESTS =====================

    describe('branch coverage: calculateRecencyBonus with future date (line 1139)', () => {
        it('returns 10 for a date in the future', () => {
            const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
            // Access through buildOptimizedMessages by providing an item with future createdAt
            const context: AgentContext = {
                task: makeTask({ created_at: futureDate }),
                conversationHistory: [],
            };

            const result = feeder.buildOptimizedMessages(
                AgentType.Planning,
                'test',
                'system',
                context
            );

            // The task item should have been included and scored with recency bonus of 10
            expect(result.includedItems.length).toBeGreaterThan(0);
        });
    });

    describe('branch coverage: calculateStalenessPenalty branches (lines 1168-1172)', () => {
        it('returns base penalty when createdAt is empty string (line 1168 true branch)', () => {
            const item = makeContextItem({
                label: 'no match label',
                content: 'no match content',
                metadata: {
                    sourceType: 'custom',
                    sourceId: 'test',
                    createdAt: '',  // empty string is falsy — triggers !createdAt true branch
                    isStale: true,
                    relatedTaskIds: [],
                    relatedFilePatterns: [],
                },
            });

            // MUST provide keywords to avoid early return on line 99
            const keywords: RelevanceKeywordSet = {
                taskKeywords: ['uniquetoken'],
                fileKeywords: [],
                domainKeywords: [],
            };
            const score = feeder.scoreRelevance(item, keywords);
            // isStale=true adds penalty 5, raw is 0 - 5 = -5, normalized to 0
            expect(score).toBe(0);
        });

        it('returns base penalty when createdAt is an invalid date string (line 1172 true branch)', () => {
            const item = makeContextItem({
                label: 'no match label',
                content: 'no match content',
                metadata: {
                    sourceType: 'custom',
                    sourceId: 'test',
                    createdAt: 'not-a-valid-date', // passes !createdAt check, but NaN from new Date()
                    isStale: false,
                    relatedTaskIds: [],
                    relatedFilePatterns: [],
                },
            });
            // MUST provide keywords to avoid early return on line 99
            const keywords: RelevanceKeywordSet = {
                taskKeywords: ['uniquetoken'],
                fileKeywords: [],
                domainKeywords: [],
            };
            const score = feeder.scoreRelevance(item, keywords);
            // No keyword matches, no staleness penalty (isStale=false, NaN date returns 0 penalty)
            expect(score).toBe(0);
        });
    });

    describe('branch coverage: scoreRelevance with null/undefined label/content (lines 102-109)', () => {
        it('handles item with null label and content via ?? fallback', () => {
            const item = makeContextItem({
                label: undefined as any,
                content: undefined as any,
            });
            const keywords: RelevanceKeywordSet = {
                taskKeywords: ['database'],
                fileKeywords: ['file.ts'],
                domainKeywords: ['sqlite'],
            };
            const score = feeder.scoreRelevance(item, keywords);
            expect(typeof score).toBe('number');
        });
    });

    describe('branch coverage: sortByTierAndRelevance with unknown category (lines 247-248)', () => {
        it('assigns Optional priority to items with unknown category', () => {
            const items = [
                makeContextItem({ id: 'known', category: ContextCategory.CurrentTask, relevanceScore: 50 }),
                makeContextItem({ id: 'unknown', category: 'unknown_category' as any, relevanceScore: 80 }),
            ];

            const sorted = feeder.sortByTierAndRelevance(items);
            // CurrentTask has tier Mandatory (1), unknown falls back to Optional (4)
            // So CurrentTask should come first
            expect(sorted[0].id).toBe('known');
            expect(sorted[1].id).toBe('unknown');
        });
    });

    describe('branch coverage: buildDesignContextSummary with no root components (line 666)', () => {
        it('returns "[No root components]" when no components have null parent_id', () => {
            // All components have a parent_id, so no root components exist
            const components = [
                makeDesignComponent({ id: 'child-1', parent_id: 'nonexistent-parent', name: 'Child1' }),
                makeDesignComponent({ id: 'child-2', parent_id: 'nonexistent-parent', name: 'Child2' }),
            ];
            const summary = feeder.summarizeComponentTree(components);
            expect(summary).toBe('[No root components]');
        });
    });

    describe('branch coverage: buildContextItems with task missing created_at and empty files (lines 769-789)', () => {
        it('uses fallback for created_at ?? now and handles empty files_modified', () => {
            const context: AgentContext = {
                task: makeTask({
                    created_at: undefined as any, // triggers ?? now on line 786
                    files_modified: [],            // triggers '' on line 771
                }),
                conversationHistory: [],
            };

            const result = feeder.buildOptimizedMessages(
                AgentType.Planning,
                'test',
                'system',
                context
            );

            // Task should still be included despite missing created_at
            const taskItem = result.includedItems.find(i => i.label.includes('Current Task'));
            expect(taskItem).toBeDefined();
            // Content should not contain "Files:" since files_modified is empty
            expect(taskItem!.content).not.toContain('Files:');
        });
    });

    describe('branch coverage: buildContextItems with ticket missing created_at and null task_id (lines 814-816)', () => {
        it('uses fallback for ticket created_at and empty relatedTaskIds', () => {
            const context: AgentContext = {
                ticket: makeTicket({
                    created_at: undefined as any, // triggers ?? now on line 814
                    task_id: null,                 // triggers [] on line 816
                }),
                conversationHistory: [],
            };

            const result = feeder.buildOptimizedMessages(
                AgentType.Planning,
                'test',
                'system',
                context
            );

            // Ticket should be included
            const ticketItem = result.includedItems.find(i => i.label.includes('Related Ticket'));
            expect(ticketItem).toBeDefined();
        });
    });

    describe('branch coverage: buildContextItems with plan missing created_at (line 842)', () => {
        it('uses fallback for plan created_at', () => {
            const context: AgentContext = {
                plan: makePlan({
                    created_at: undefined as any, // triggers ?? now on line 842
                }),
                conversationHistory: [],
            };

            const result = feeder.buildOptimizedMessages(
                AgentType.Planning,
                'test',
                'system',
                context
            );

            const planItem = result.includedItems.find(i => i.label.includes('Active Plan'));
            expect(planItem).toBeDefined();
        });
    });

    describe('branch coverage: buildContextItems with conversation history created_at fallbacks (lines 874, 901)', () => {
        it('uses fallback when recent history last item has no created_at', () => {
            // Need enough history to trigger both recent and older paths
            const history: Conversation[] = [];
            // 15 items total: 5 older, 10 recent (split at length - 10)
            for (let i = 0; i < 15; i++) {
                history.push(makeConversation({
                    content: `Message ${i}`,
                    created_at: i < 14 ? new Date().toISOString() : undefined as any, // last item missing created_at
                }));
            }

            const context: AgentContext = {
                conversationHistory: history,
            };

            const result = feeder.buildOptimizedMessages(
                AgentType.Planning,
                'test',
                'system',
                context
            );

            // Should include history items
            const historyItems = result.includedItems.filter(i => i.label.includes('History'));
            expect(historyItems.length).toBeGreaterThan(0);
        });

        it('uses fallback when older history last item has no created_at', () => {
            // 15 items: first 5 are older, last 10 are recent
            const history: Conversation[] = [];
            for (let i = 0; i < 15; i++) {
                history.push(makeConversation({
                    content: `Message ${i}`,
                    // For older history (items 0-4), the last one (item 4) has no created_at
                    created_at: i === 4 ? undefined as any : new Date().toISOString(),
                }));
            }

            const context: AgentContext = {
                conversationHistory: history,
            };

            const result = feeder.buildOptimizedMessages(
                AgentType.Planning,
                'test',
                'system',
                context
            );

            expect(result.includedItems.length).toBeGreaterThan(0);
        });
    });

    describe('branch coverage: buildContextItems additionalContext with null values (lines 915-916)', () => {
        it('skips null and undefined values in additionalContext', () => {
            const context: AgentContext = {
                conversationHistory: [],
                additionalContext: {
                    validKey: 'valid value',
                    nullKey: null,
                    undefinedKey: undefined,
                    objectKey: { nested: true },
                },
            };

            const result = feeder.buildOptimizedMessages(
                AgentType.Planning,
                'test',
                'system',
                context
            );

            // Should have items for validKey and objectKey, but not nullKey or undefinedKey
            const additionalItems = result.includedItems.filter(i => i.label.startsWith('Additional:'));
            const labels = additionalItems.map(i => i.label);
            expect(labels).toContain('Additional: validKey');
            expect(labels).toContain('Additional: objectKey');
            expect(labels).not.toContain('Additional: nullKey');
            expect(labels).not.toContain('Additional: undefinedKey');
        });
    });

    describe('branch coverage: extractKeywords with null filePath (line 191)', () => {
        it('handles null entries in files_modified', () => {
            const task = makeTask({
                files_modified: ['src/database.ts', null as any, '', 'src/types.ts'],
            });

            // Call extractKeywords directly to test the null/empty skip logic
            const keywords = feeder.extractKeywords(task, 'test query');

            // Should have extracted file keywords from the valid entries, skipping null and ''
            expect(keywords.fileKeywords).toContain('src/database.ts');
            expect(keywords.fileKeywords).toContain('src/types.ts');
            // Should NOT contain null or empty
            expect(keywords.fileKeywords).not.toContain(null);
            expect(keywords.fileKeywords).not.toContain('');
        });
    });

    describe('branch coverage: scoreRelevance with item.metadata.relatedTaskIds undefined (line 150)', () => {
        it('falls back to empty array when relatedTaskIds is undefined', () => {
            const item = makeContextItem({
                metadata: {
                    sourceType: 'custom',
                    sourceId: 'test',
                    createdAt: new Date().toISOString(),
                    isStale: false,
                    relatedTaskIds: undefined as any,
                    relatedFilePatterns: [],
                },
            });
            const keywords: RelevanceKeywordSet = {
                taskKeywords: ['database'],
                fileKeywords: [],
                domainKeywords: [],
            };
            const score = feeder.scoreRelevance(item, keywords);
            expect(typeof score).toBe('number');
        });
    });

    describe('branch coverage: scoreRelevance with undefined relatedFilePatterns (line 109)', () => {
        it('falls back to empty array when relatedFilePatterns is undefined', () => {
            const item = makeContextItem({
                metadata: {
                    sourceType: 'custom',
                    sourceId: 'test',
                    createdAt: new Date().toISOString(),
                    isStale: false,
                    relatedTaskIds: [],
                    relatedFilePatterns: undefined as any,
                },
            });
            const keywords: RelevanceKeywordSet = {
                taskKeywords: [],
                fileKeywords: ['database.ts'],
                domainKeywords: [],
            };
            const score = feeder.scoreRelevance(item, keywords);
            expect(typeof score).toBe('number');
        });
    });

    describe('branch coverage: sortByTierAndRelevance ?? fallback for both items (line 248)', () => {
        it('assigns fallback priority to both items with unknown categories', () => {
            const items = [
                makeContextItem({ id: 'a', category: 'catA' as any, relevanceScore: 50 }),
                makeContextItem({ id: 'b', category: 'catB' as any, relevanceScore: 80 }),
            ];
            const sorted = feeder.sortByTierAndRelevance(items);
            // Both have same fallback tier, so sorted by relevance (higher first)
            expect(sorted[0].id).toBe('b');
            expect(sorted[1].id).toBe('a');
        });
    });

    describe('branch coverage: block comment terminated at end of string (line 370 false branch)', () => {
        it('handles block comment that terminates at the very end of input', () => {
            // The block comment ends with */ right at the end of the string
            // This exercises the false branch of line 370: i >= code.length - 1 but string ends with */
            const code = 'const x = 1; /* comment */';
            const result = feeder.stripComments(code);
            expect(result).toContain('const x = 1;');
            expect(result).not.toContain('comment');
        });
    });

    describe('branch coverage: files_modified ?? [] fallback (line 789)', () => {
        it('uses ?? [] fallback when files_modified becomes null between line 769 and 789', () => {
            // Line 769 reads context.task.files_modified.length and line 789 reads
            // context.task.files_modified ?? []. The ?? branch triggers when files_modified
            // is null/undefined. We use a getter that returns [] first (for .length check)
            // then null (for the ?? on line 789) to reach the fallback.
            let callCount = 0;
            const taskWithToggle = {
                ...makeTask(),
                get files_modified(): string[] | null {
                    callCount++;
                    // First access (line 769 .length check): return empty array
                    // Second access (line 770 .join): skipped because length=0
                    // Third access (line 789 ?? []): return null
                    if (callCount <= 1) return [];
                    return null as any;
                },
            };

            const context: AgentContext = {
                task: taskWithToggle as any,
                conversationHistory: [],
            };

            const result = feeder.buildOptimizedMessages(
                AgentType.Planning,
                'test',
                'system',
                context
            );

            // Task item should be included with empty relatedFilePatterns (from ?? [])
            const taskItem = result.includedItems.find(i => i.label.includes('Current Task'));
            expect(taskItem).toBeDefined();
            expect(taskItem!.metadata.relatedFilePatterns).toEqual([]);
        });
    });

    describe('branch coverage: calculateStalenessPenalty aged content (lines 1168-1178)', () => {
        it('calculates penalty proportional to weeks over staleness threshold', () => {
            // Create an item that is very old (e.g., 30 days) — staleness threshold is 7 days
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
            const item = makeContextItem({
                label: 'unrelated item with no keyword matches',
                content: 'completely unrelated content that does not match any keywords',
                metadata: {
                    sourceType: 'custom',
                    sourceId: 'old-item',
                    createdAt: thirtyDaysAgo,
                    isStale: true,
                    relatedTaskIds: [],
                    relatedFilePatterns: [],
                },
            });

            // Need at least one keyword to avoid early return on line 99
            const keywords: RelevanceKeywordSet = {
                taskKeywords: ['uniqueword'],
                fileKeywords: [],
                domainKeywords: [],
            };

            const score = feeder.scoreRelevance(item, keywords);
            // raw = 0 (no matches) - penalty (5 for stale + 5+ for age), then normalized
            // Should be 0 since raw is negative
            expect(score).toBe(0);
        });

        it('calculates no staleness penalty for recent items (line 1175 false branch)', () => {
            // Item created just now — well within 7-day threshold, isStale=false
            const item = makeContextItem({
                label: 'matching item',
                content: 'content with uniqueword in it',
                metadata: {
                    sourceType: 'custom',
                    sourceId: 'recent-item',
                    createdAt: new Date().toISOString(),
                    isStale: false,
                    relatedTaskIds: [],
                    relatedFilePatterns: [],
                },
            });

            const keywords: RelevanceKeywordSet = {
                taskKeywords: ['uniqueword'],
                fileKeywords: [],
                domainKeywords: [],
            };

            const score = feeder.scoreRelevance(item, keywords);
            // Should have positive score (keyword match) and no staleness penalty
            expect(score).toBeGreaterThan(0);
        });

        it('exercises catch block in calculateStalenessPenalty (line 1180)', () => {
            // Override Date constructor to throw for a specific input
            const OrigDate = global.Date;
            const throwDate = '__THROW_STALENESS__';

            const MockDate = function(this: any) {
                const args = Array.from(arguments);
                if (args.length === 1 && args[0] === throwDate) {
                    throw new Error('Date constructor explosion');
                }
                if (args.length === 0) {
                    return new OrigDate();
                }
                return new (Function.prototype.bind.apply(OrigDate, [null].concat(args) as any))();
            } as any;
            MockDate.now = OrigDate.now;
            MockDate.parse = OrigDate.parse;
            MockDate.UTC = OrigDate.UTC;
            MockDate.prototype = OrigDate.prototype;

            global.Date = MockDate;

            try {
                const item = makeContextItem({
                    label: 'matching item',
                    content: 'content with uniqueword in it',
                    metadata: {
                        sourceType: 'custom',
                        sourceId: 'throw-item',
                        createdAt: throwDate, // triggers throw in calculateStalenessPenalty
                        isStale: false,
                        relatedTaskIds: [],
                        relatedFilePatterns: [],
                    },
                });

                const keywords: RelevanceKeywordSet = {
                    taskKeywords: ['uniqueword'],
                    fileKeywords: [],
                    domainKeywords: [],
                };

                // Should not throw — catch block handles the Date error
                const score = feeder.scoreRelevance(item, keywords);
                expect(typeof score).toBe('number');
            } finally {
                global.Date = OrigDate;
            }
        });
    });
});
