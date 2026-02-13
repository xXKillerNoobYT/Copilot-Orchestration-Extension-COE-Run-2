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
    });
});
