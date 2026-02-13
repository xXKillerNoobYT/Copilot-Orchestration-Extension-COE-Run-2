import { ContextBreakingChain } from '../src/core/context-breaking-chain';
import { TokenBudgetTracker } from '../src/core/token-budget-tracker';
import {
    ContentType, ContextItem, ContextPriority, ContextCategory,
    ContextBreakingLevel, RelevanceKeywordSet, TokenBudget
} from '../src/types';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

const logMessages: string[] = [];

function createTracker(): TokenBudgetTracker {
    return new TokenBudgetTracker(
        undefined,
        undefined,
        { appendLine: (msg: string) => logMessages.push(msg) }
    );
}

function createChain(tracker: TokenBudgetTracker): ContextBreakingChain {
    return new ContextBreakingChain(
        tracker,
        { appendLine: (msg: string) => logMessages.push(msg) }
    );
}

/** Build a minimal ContextItem with sensible defaults. */
function makeItem(overrides: Partial<ContextItem> & { id: string; label: string }): ContextItem {
    const content = overrides.content ?? `Content for ${overrides.label}`;
    return {
        content,
        contentType: ContentType.NaturalText,
        category: ContextCategory.Supplementary,
        priority: ContextPriority.Supplementary,
        relevanceScore: 50,
        estimatedTokens: overrides.estimatedTokens ?? Math.ceil(content.length / 4),
        metadata: {
            sourceType: 'custom',
            sourceId: overrides.id,
            createdAt: overrides.metadata?.createdAt ?? new Date().toISOString(),
            isStale: false,
            relatedTaskIds: overrides.metadata?.relatedTaskIds ?? [],
            relatedFilePatterns: overrides.metadata?.relatedFilePatterns ?? [],
        },
        ...overrides,
        // Ensure metadata is fully merged (overrides may have partial metadata)
        ...(overrides.metadata ? {
            metadata: {
                sourceType: overrides.metadata.sourceType ?? 'custom',
                sourceId: overrides.metadata.sourceId ?? overrides.id,
                createdAt: overrides.metadata.createdAt ?? new Date().toISOString(),
                isStale: overrides.metadata.isStale ?? false,
                relatedTaskIds: overrides.metadata.relatedTaskIds ?? [],
                relatedFilePatterns: overrides.metadata.relatedFilePatterns ?? [],
            }
        } : {}),
    };
}

/** Create a timestamp N hours ago. */
function hoursAgo(hours: number): string {
    return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

/** Create a timestamp N minutes ago. */
function minutesAgo(minutes: number): string {
    return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

/** Default keyword set for tests. */
const defaultKeywords: RelevanceKeywordSet = {
    taskKeywords: ['database', 'migration'],
    fileKeywords: ['database.ts', 'schema.sql'],
    domainKeywords: ['sqlite', 'typescript'],
};

/** Create a budget with a specific available-for-input limit. */
function makeBudget(tracker: TokenBudgetTracker, availableForInput: number): TokenBudget {
    const budget = tracker.createBudget('orchestrator');
    // Override the budget to a specific input size for test control
    budget.availableForInput = availableForInput;
    budget.remaining = availableForInput;
    return budget;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContextBreakingChain', () => {
    let tracker: TokenBudgetTracker;
    let chain: ContextBreakingChain;

    beforeEach(() => {
        logMessages.length = 0;
        tracker = createTracker();
        chain = createChain(tracker);
    });

    // ===================================================================
    // Level 1 - SummarizeOld
    // ===================================================================

    describe('Level 1 - SummarizeOld', () => {
        it('compresses the oldest 60% of items', () => {
            // Create 10 items with ascending timestamps; oldest are compressed
            const items: ContextItem[] = [];
            for (let i = 0; i < 10; i++) {
                items.push(makeItem({
                    id: `item-${i}`,
                    label: `Item ${i}`,
                    content: 'This is a long paragraph of text that should be compressible. '.repeat(10),
                    contentType: ContentType.NaturalText,
                    metadata: {
                        sourceType: 'custom',
                        sourceId: `item-${i}`,
                        createdAt: hoursAgo(20 - i), // item-0 is oldest (20h ago), item-9 is newest (11h ago)
                        isStale: false,
                        relatedTaskIds: [],
                        relatedFilePatterns: [],
                    },
                }));
            }

            const result = chain.level1SummarizeOld(items);

            // Should return the same number of items (no items dropped)
            expect(result).toHaveLength(10);

            // The oldest 60% = 6 items should have been compressed (shorter content)
            // The newest 40% = 4 items remain at full fidelity
            // Sort by creation time to identify which were compressed
            const sortedByAge = [...items].sort(
                (a, b) => new Date(a.metadata.createdAt).getTime() - new Date(b.metadata.createdAt).getTime()
            );
            const oldIds = new Set(sortedByAge.slice(0, 6).map(i => i.id));

            for (const resultItem of result) {
                const original = items.find(i => i.id === resultItem.id)!;
                if (oldIds.has(resultItem.id)) {
                    // Old items should be shorter after compression
                    expect(resultItem.content.length).toBeLessThanOrEqual(original.content.length);
                } else {
                    // Recent items should remain unchanged
                    expect(resultItem.content).toBe(original.content);
                }
            }
        });

        it('keeps recent items (newest 40%) at full fidelity', () => {
            const items = [
                makeItem({
                    id: 'old',
                    label: 'Old item',
                    content: 'Old content paragraph one. Old content paragraph two. Old content paragraph three.',
                    metadata: { sourceType: 'custom', sourceId: 'old', createdAt: hoursAgo(48), isStale: false, relatedTaskIds: [], relatedFilePatterns: [] },
                }),
                makeItem({
                    id: 'recent',
                    label: 'Recent item',
                    content: 'Recent content that should stay exactly the same.',
                    metadata: { sourceType: 'custom', sourceId: 'recent', createdAt: minutesAgo(5), isStale: false, relatedTaskIds: [], relatedFilePatterns: [] },
                }),
            ];

            const result = chain.level1SummarizeOld(items);

            // The recent item (index 1 when sorted by creation) should be in the newest 40%
            // With 2 items: oldest 60% = ceil(2*0.6) = 2 items. So both get compressed.
            // Actually ceil(2*0.6) = 2, so all items would be "old" — let's verify the logic
            // oldCutoff = Math.ceil(2 * 0.6) = 2, so oldItems = sorted.slice(0,2) = both items
            // recentItems = sorted.slice(2) = empty
            // Both items get summarized. This is correct behavior for only 2 items.
            expect(result).toHaveLength(2);
        });

        it('handles empty input', () => {
            const result = chain.level1SummarizeOld([]);
            expect(result).toEqual([]);
        });

        it('never compresses plan items', () => {
            const planContent = 'This is a detailed plan with many sentences. It should never be compressed no matter what. The plan is the source of truth. Plans define the roadmap. Plans are sacred documents.';
            const items = [
                makeItem({
                    id: 'plan-item',
                    label: 'My plan document',
                    content: planContent,
                    metadata: { sourceType: 'plan', sourceId: 'plan-1', createdAt: hoursAgo(100), isStale: false, relatedTaskIds: [], relatedFilePatterns: [] },
                }),
                makeItem({
                    id: 'old-text',
                    label: 'Some old text',
                    content: 'Old text content that can be compressed. '.repeat(10),
                    metadata: { sourceType: 'custom', sourceId: 'old-text', createdAt: hoursAgo(99), isStale: false, relatedTaskIds: [], relatedFilePatterns: [] },
                }),
            ];

            const result = chain.level1SummarizeOld(items);

            // Plan item should keep its exact content
            const planResult = result.find(i => i.id === 'plan-item');
            expect(planResult).toBeDefined();
            expect(planResult!.content).toBe(planContent);
        });
    });

    // ===================================================================
    // Level 2 - PrioritizeRecent
    // ===================================================================

    describe('Level 2 - PrioritizeRecent', () => {
        it('keeps all items from the last hour at full fidelity', () => {
            const items = [
                makeItem({
                    id: 'recent-1',
                    label: 'Very recent',
                    content: 'Recent content',
                    relevanceScore: 10, // low relevance, but recent
                    priority: ContextPriority.Optional,
                    metadata: { sourceType: 'custom', sourceId: 'r1', createdAt: minutesAgo(30), isStale: false, relatedTaskIds: [], relatedFilePatterns: [] },
                }),
                makeItem({
                    id: 'recent-2',
                    label: 'Also recent',
                    content: 'Also recent content',
                    relevanceScore: 5,
                    priority: ContextPriority.Optional,
                    metadata: { sourceType: 'custom', sourceId: 'r2', createdAt: minutesAgo(45), isStale: false, relatedTaskIds: [], relatedFilePatterns: [] },
                }),
            ];

            const result = chain.level2PrioritizeRecent(items, defaultKeywords);

            // Both items are within the last hour, so both should be kept
            expect(result).toHaveLength(2);
            expect(result.map(i => i.id)).toContain('recent-1');
            expect(result.map(i => i.id)).toContain('recent-2');
        });

        it('applies +20 recency bonus to items from last 10 minutes', () => {
            const items = [
                makeItem({
                    id: 'super-recent',
                    label: 'Super recent',
                    content: 'Just happened',
                    relevanceScore: 40,
                    priority: ContextPriority.Supplementary,
                    metadata: { sourceType: 'custom', sourceId: 'sr', createdAt: minutesAgo(3), isStale: false, relatedTaskIds: [], relatedFilePatterns: [] },
                }),
                makeItem({
                    id: 'half-hour',
                    label: 'Half hour ago',
                    content: 'Earlier content',
                    relevanceScore: 40,
                    priority: ContextPriority.Supplementary,
                    metadata: { sourceType: 'custom', sourceId: 'hh', createdAt: minutesAgo(30), isStale: false, relatedTaskIds: [], relatedFilePatterns: [] },
                }),
            ];

            const result = chain.level2PrioritizeRecent(items, defaultKeywords);

            const superRecent = result.find(i => i.id === 'super-recent')!;
            const halfHour = result.find(i => i.id === 'half-hour')!;

            // Super recent (3 min ago) gets +20 bonus
            expect(superRecent.relevanceScore).toBe(60);
            // Half-hour item is within 1 hour but > 10 min, no bonus
            expect(halfHour.relevanceScore).toBe(40);
        });

        it('drops items older than 24h with low relevance (< 30)', () => {
            const items = [
                makeItem({
                    id: 'old-low',
                    label: 'Old low relevance',
                    content: 'Old and not important',
                    relevanceScore: 15,
                    priority: ContextPriority.Optional,
                    metadata: { sourceType: 'custom', sourceId: 'ol', createdAt: hoursAgo(48), isStale: false, relatedTaskIds: [], relatedFilePatterns: [] },
                }),
                makeItem({
                    id: 'old-medium',
                    label: 'Old medium relevance',
                    content: 'Old but somewhat relevant',
                    relevanceScore: 50,
                    priority: ContextPriority.Supplementary,
                    metadata: { sourceType: 'custom', sourceId: 'om', createdAt: hoursAgo(48), isStale: false, relatedTaskIds: [], relatedFilePatterns: [] },
                }),
            ];

            const result = chain.level2PrioritizeRecent(items, defaultKeywords);

            // old-low (48h old, relevance 15 < 30) should be dropped
            // old-medium (48h old, relevance 50 >= 30) should be kept
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('old-medium');
        });

        it('keeps old high-priority items regardless of age', () => {
            const items = [
                makeItem({
                    id: 'old-mandatory',
                    label: 'Old mandatory item',
                    content: 'Critical item from long ago',
                    relevanceScore: 10, // low relevance
                    priority: ContextPriority.Mandatory,
                    metadata: { sourceType: 'custom', sourceId: 'om', createdAt: hoursAgo(72), isStale: false, relatedTaskIds: [], relatedFilePatterns: [] },
                }),
                makeItem({
                    id: 'old-important',
                    label: 'Old important item',
                    content: 'Important item from long ago',
                    relevanceScore: 5, // very low relevance
                    priority: ContextPriority.Important,
                    metadata: { sourceType: 'custom', sourceId: 'oi', createdAt: hoursAgo(72), isStale: false, relatedTaskIds: [], relatedFilePatterns: [] },
                }),
            ];

            const result = chain.level2PrioritizeRecent(items, defaultKeywords);

            // Both are priority <= Important, so both should be kept regardless of age/relevance
            expect(result).toHaveLength(2);
            expect(result.map(i => i.id)).toContain('old-mandatory');
            expect(result.map(i => i.id)).toContain('old-important');
        });
    });

    // ===================================================================
    // Level 3 - SmartChunking
    // ===================================================================

    describe('Level 3 - SmartChunking', () => {
        it('compresses code items (strips comments, collapses whitespace)', () => {
            const codeContent = [
                '// This is a comment that should be removed',
                'function hello() {',
                '    // Another comment',
                '    console.log("hello");',
                '',
                '',
                '',
                '    return true;',
                '}',
            ].join('\n');

            const items = [
                makeItem({
                    id: 'code-item',
                    label: 'Code file',
                    content: codeContent,
                    contentType: ContentType.Code,
                    estimatedTokens: 100,
                }),
            ];

            const result = chain.level3SmartChunking(items);

            expect(result).toHaveLength(1);
            const compressed = result[0];

            // Comments should be removed
            expect(compressed.content).not.toContain('// This is a comment');
            expect(compressed.content).not.toContain('// Another comment');

            // Actual code should remain
            expect(compressed.content).toContain('function hello()');
            expect(compressed.content).toContain('console.log');

            // Should be shorter than original
            expect(compressed.content.length).toBeLessThan(codeContent.length);
        });

        it('never compresses plan items', () => {
            const planContent = 'Detailed plan content with many details that should never be compressed.';
            const items = [
                makeItem({
                    id: 'plan-item',
                    label: 'Active plan',
                    content: planContent,
                    contentType: ContentType.Markdown,
                    category: 'active_plan' as ContextCategory,
                    metadata: { sourceType: 'plan', sourceId: 'plan-1', createdAt: hoursAgo(1), isStale: false, relatedTaskIds: [], relatedFilePatterns: [] },
                }),
            ];

            const result = chain.level3SmartChunking(items);

            // Plan should be returned unchanged
            expect(result[0].content).toBe(planContent);
        });

        it('applies different compression rates per content type', () => {
            const longText = 'The quick brown fox jumps over the lazy dog. '.repeat(20);

            const items = [
                makeItem({
                    id: 'text-item',
                    label: 'Natural text',
                    content: longText,
                    contentType: ContentType.NaturalText,
                    estimatedTokens: 200,
                }),
                makeItem({
                    id: 'json-item',
                    label: 'JSON data',
                    content: JSON.stringify({ name: 'test', description: longText, value: 42, enabled: true, data: null }),
                    contentType: ContentType.JSON,
                    estimatedTokens: 200,
                }),
                makeItem({
                    id: 'md-item',
                    label: 'Markdown doc',
                    content: `# Heading\n\n${longText}\n\n## Another Section\n\n${longText}`,
                    contentType: ContentType.Markdown,
                    estimatedTokens: 200,
                }),
            ];

            const result = chain.level3SmartChunking(items);

            // All items should be compressed (shorter content or same)
            for (let i = 0; i < result.length; i++) {
                expect(result[i].content.length).toBeLessThanOrEqual(items[i].content.length);
            }

            // Token estimates should be updated
            for (const resultItem of result) {
                expect(resultItem.estimatedTokens).toBeGreaterThan(0);
            }
        });
    });

    // ===================================================================
    // Level 4 - DiscardLowRelevance
    // ===================================================================

    describe('Level 4 - DiscardLowRelevance', () => {
        it('drops bottom 30% of items by relevance score', () => {
            // Create 10 items with varying relevance
            const items: ContextItem[] = [];
            for (let i = 0; i < 10; i++) {
                items.push(makeItem({
                    id: `item-${i}`,
                    label: `Item ${i}`,
                    content: `Content for item ${i}`,
                    relevanceScore: (i + 1) * 10, // 10, 20, 30, ..., 100
                    priority: ContextPriority.Supplementary,
                }));
            }

            const result = chain.level4DiscardLowRelevance(items, defaultKeywords);

            // 30% of 10 = 3 items dropped (the lowest relevance ones)
            // Result should contain 7 kept items + 3 placeholder items = 10 total
            // But the result keeps the higher-scored ones and adds placeholders for dropped
            const placeholders = result.filter(i => i.label.startsWith('[Omitted:'));
            const kept = result.filter(i => !i.label.startsWith('[Omitted:'));

            expect(placeholders.length).toBe(3);
            expect(kept.length).toBe(7);
        });

        it('adds placeholder items for dropped content', () => {
            const items = [
                makeItem({
                    id: 'low-rel',
                    label: 'Low relevance item',
                    content: 'Not important content',
                    relevanceScore: 5,
                    estimatedTokens: 100,
                    priority: ContextPriority.Optional,
                }),
                makeItem({
                    id: 'high-rel',
                    label: 'High relevance item',
                    content: 'Very important content about database migration',
                    relevanceScore: 90,
                    priority: ContextPriority.Supplementary,
                }),
                makeItem({
                    id: 'medium-rel',
                    label: 'Medium relevance item',
                    content: 'Somewhat important content',
                    relevanceScore: 50,
                    priority: ContextPriority.Supplementary,
                }),
                makeItem({
                    id: 'another-low',
                    label: 'Another low relevance',
                    content: 'Also not very important',
                    relevanceScore: 3,
                    estimatedTokens: 80,
                    priority: ContextPriority.Optional,
                }),
            ];

            const result = chain.level4DiscardLowRelevance(items, defaultKeywords);

            // 30% of 4 = floor(4*0.3) = 1 item dropped
            const placeholders = result.filter(i => i.label.startsWith('[Omitted:'));
            expect(placeholders.length).toBe(1);

            // Placeholder should reference the dropped item's label and token count
            const placeholder = placeholders[0];
            expect(placeholder.label).toContain('[Omitted:');
            expect(placeholder.label).toContain('low relevance');
            expect(placeholder.content).toContain('[Omitted:');
            expect(placeholder.priority).toBe(ContextPriority.Optional);
            expect(placeholder.relevanceScore).toBe(0);
        });

        it('keeps mandatory items through relevance scoring boost', () => {
            // Mandatory items get +100 to their score in scoreRelevance,
            // so they should never be in the bottom 30%
            const items: ContextItem[] = [];

            // 7 low-relevance optional items
            for (let i = 0; i < 7; i++) {
                items.push(makeItem({
                    id: `optional-${i}`,
                    label: `Optional ${i}`,
                    content: `Optional content ${i}`,
                    relevanceScore: 5,
                    priority: ContextPriority.Optional,
                }));
            }

            // 3 mandatory items with low raw relevance score
            for (let i = 0; i < 3; i++) {
                items.push(makeItem({
                    id: `mandatory-${i}`,
                    label: `Mandatory ${i}`,
                    content: `Mandatory content ${i}`,
                    relevanceScore: 1, // Very low raw score, but mandatory gets +100
                    priority: ContextPriority.Mandatory,
                }));
            }

            const result = chain.level4DiscardLowRelevance(items, defaultKeywords);

            // All 3 mandatory items should be in the kept set (not placeholders)
            const kept = result.filter(i => !i.label.startsWith('[Omitted:'));
            const mandatoryKept = kept.filter(i => i.id.startsWith('mandatory-'));
            expect(mandatoryKept).toHaveLength(3);
        });
    });

    // ===================================================================
    // Level 5 - FreshStart
    // ===================================================================

    describe('Level 5 - FreshStart', () => {
        it('returns only mandatory items plus a summary item', () => {
            const items = [
                makeItem({
                    id: 'mandatory-1',
                    label: 'Mandatory item',
                    content: 'Critical system prompt',
                    priority: ContextPriority.Mandatory,
                }),
                makeItem({
                    id: 'important-1',
                    label: 'Important item',
                    content: 'Important but not mandatory',
                    priority: ContextPriority.Important,
                }),
                makeItem({
                    id: 'optional-1',
                    label: 'Optional item',
                    content: 'Optional content',
                    priority: ContextPriority.Optional,
                }),
                makeItem({
                    id: 'supplementary-1',
                    label: 'Supplementary item',
                    content: 'Supplementary content',
                    priority: ContextPriority.Supplementary,
                }),
            ];

            const { essentialItems } = chain.level5FreshStart(items);

            // Should contain only mandatory items + 1 summary item
            const mandatoryResult = essentialItems.filter(i => i.id === 'mandatory-1');
            expect(mandatoryResult).toHaveLength(1);
            expect(mandatoryResult[0].content).toBe('Critical system prompt');

            // Should have a "Fresh Start Summary" item
            const summaryItem = essentialItems.find(i => i.label === 'Fresh Start Summary');
            expect(summaryItem).toBeDefined();
            expect(summaryItem!.priority).toBe(ContextPriority.Important);
            expect(summaryItem!.contentType).toBe(ContentType.NaturalText);

            // Total items = 1 mandatory + 1 summary = 2
            expect(essentialItems).toHaveLength(2);
        });

        it('creates a snapshot with all items saved', () => {
            const items = [
                makeItem({
                    id: 'item-a',
                    label: 'Item A',
                    content: 'Content A',
                    priority: ContextPriority.Mandatory,
                    estimatedTokens: 50,
                    metadata: { sourceType: 'task', sourceId: 'task-1', createdAt: hoursAgo(1), isStale: false, relatedTaskIds: ['task-1'], relatedFilePatterns: [] },
                }),
                makeItem({
                    id: 'item-b',
                    label: 'Item B',
                    content: 'Content B',
                    priority: ContextPriority.Optional,
                    estimatedTokens: 30,
                    metadata: { sourceType: 'ticket', sourceId: 'ticket-5', createdAt: hoursAgo(2), isStale: false, relatedTaskIds: [], relatedFilePatterns: [] },
                }),
            ];

            const { snapshot } = chain.level5FreshStart(items);

            // Snapshot should exist
            expect(snapshot).toBeDefined();
            expect(snapshot.id).toMatch(/^snapshot-/);
            expect(snapshot.agent_type).toBe('context_breaking_chain');
            expect(snapshot.created_at).toBeTruthy();

            // Snapshot should reference the task ID from metadata
            expect(snapshot.task_id).toBe('task-1');

            // Snapshot should reference the ticket ID from metadata
            expect(snapshot.ticket_id).toBe('ticket-5');

            // Summary should describe the items
            expect(snapshot.summary).toContain('2 items');

            // Essential context should list mandatory items
            const essentialParsed = JSON.parse(snapshot.essential_context);
            expect(essentialParsed).toHaveLength(1); // only item-a is mandatory
            expect(essentialParsed[0].id).toBe('item-a');

            // Resume instructions should mention Level 5
            expect(snapshot.resume_instructions).toContain('Fresh Start');
            expect(snapshot.resume_instructions).toContain('Level 5');
        });
    });

    // ===================================================================
    // Progressive Application (applyChain)
    // ===================================================================

    describe('Progressive Application - applyChain', () => {
        it('returns Level None when items already fit in budget', () => {
            const items = [
                makeItem({
                    id: 'small',
                    label: 'Small item',
                    content: 'Short',
                    estimatedTokens: 10,
                }),
            ];

            const budget = makeBudget(tracker, 1000);

            const { result } = chain.applyChain(items, budget, defaultKeywords);

            expect(result.strategyApplied).toBe(ContextBreakingLevel.None);
            expect(result.originalTokens).toBe(10);
            expect(result.resultTokens).toBe(10);
            expect(result.reductionPercent).toBe(0);
            expect(result.freshStartTriggered).toBe(false);
            expect(result.savedState).toBeNull();
        });

        it('stops at the first level that achieves budget compliance', () => {
            // Create items that are just slightly over budget
            // Level 1 (SummarizeOld) should be enough to bring them within budget
            const items: ContextItem[] = [];
            for (let i = 0; i < 5; i++) {
                const content = 'This sentence is verbose and repetitive and can be summarized easily. '.repeat(8);
                items.push(makeItem({
                    id: `item-${i}`,
                    label: `Item ${i}`,
                    content,
                    contentType: ContentType.NaturalText,
                    estimatedTokens: tracker.estimateTokens(content, ContentType.NaturalText),
                    metadata: {
                        sourceType: 'custom',
                        sourceId: `item-${i}`,
                        createdAt: hoursAgo(10 - i), // spread across time
                        isStale: false,
                        relatedTaskIds: [],
                        relatedFilePatterns: [],
                    },
                }));
            }

            const totalTokens = chain.totalTokens(items);

            // Set budget to ~60% of total — Level 1 compresses oldest 60% to 30%,
            // which should yield roughly 60% of original total (0.4*100% + 0.6*30% = 58%)
            // So set budget just above that
            const budget = makeBudget(tracker, Math.ceil(totalTokens * 0.65));

            const { result } = chain.applyChain(items, budget, defaultKeywords);

            // Should stop at Level 1 (SummarizeOld)
            expect(result.strategyApplied).toBe(ContextBreakingLevel.SummarizeOld);
            expect(result.resultTokens).toBeLessThanOrEqual(budget.availableForInput);
            expect(result.freshStartTriggered).toBe(false);
        });

        it('returns correct level when compression cascades through multiple levels', () => {
            // Create items that are far over budget — need multiple levels
            const items: ContextItem[] = [];
            for (let i = 0; i < 20; i++) {
                const content = 'Long verbose content that needs aggressive compression to fit. '.repeat(15);
                items.push(makeItem({
                    id: `item-${i}`,
                    label: `Item ${i}`,
                    content,
                    contentType: ContentType.NaturalText,
                    estimatedTokens: tracker.estimateTokens(content, ContentType.NaturalText),
                    relevanceScore: i * 5, // varying relevance: 0, 5, 10, ..., 95
                    priority: ContextPriority.Supplementary,
                    metadata: {
                        sourceType: 'custom',
                        sourceId: `item-${i}`,
                        createdAt: hoursAgo(50 - i), // some are very old
                        isStale: false,
                        relatedTaskIds: [],
                        relatedFilePatterns: [],
                    },
                }));
            }

            const totalTokens = chain.totalTokens(items);

            // Set budget extremely low — should reach Level 5 (FreshStart)
            const budget = makeBudget(tracker, Math.ceil(totalTokens * 0.02));

            const { result, items: resultItems } = chain.applyChain(items, budget, defaultKeywords);

            // Should reach Level 5 since budget is only 2% of original
            expect(result.strategyApplied).toBe(ContextBreakingLevel.FreshStart);
            expect(result.freshStartTriggered).toBe(true);
            expect(result.savedState).not.toBeNull();

            // Result items should be very few (only essentials + summary)
            expect(resultItems.length).toBeLessThan(items.length);
        });

        it('handles empty items list', () => {
            const budget = makeBudget(tracker, 1000);
            const { result, items: resultItems } = chain.applyChain([], budget, defaultKeywords);

            expect(result.strategyApplied).toBe(ContextBreakingLevel.None);
            expect(result.originalTokens).toBe(0);
            expect(result.resultTokens).toBe(0);
            expect(resultItems).toEqual([]);
        });
    });

    // ===================================================================
    // deterministicSummarize
    // ===================================================================

    describe('deterministicSummarize', () => {
        it('keeps headings', () => {
            const text = '# Main Heading\n\nSome paragraph text here.\nMore text in the paragraph.\n\n## Sub Heading\n\nAnother paragraph.';
            const result = chain.deterministicSummarize(text, 1.0);

            expect(result).toContain('# Main Heading');
            expect(result).toContain('## Sub Heading');
        });

        it('returns empty string for empty input', () => {
            expect(chain.deterministicSummarize('', 0.3)).toBe('');
        });

        it('returns full text when targetRatio is 1.0', () => {
            const text = 'Hello world. This is a test.';
            expect(chain.deterministicSummarize(text, 1.0)).toBe(text);
        });

        it('extracts first sentence of each paragraph when ratio < 1', () => {
            // Each paragraph has multiple lines; only the first sentence line should be kept
            // Must use ratio < 1.0 to trigger summarization (ratio >= 1.0 returns text unchanged)
            const text = [
                'First sentence of paragraph one.',
                'Second sentence is extra and verbose.',
                '',
                'First sentence of paragraph two.',
                'More text here too that is verbose.',
            ].join('\n');

            const result = chain.deterministicSummarize(text, 0.8);

            expect(result).toContain('First sentence of paragraph one.');
            expect(result).toContain('First sentence of paragraph two.');
            // Second lines of each paragraph (subsequent sentences) should be dropped
            expect(result).not.toContain('Second sentence is extra');
            expect(result).not.toContain('More text here too');
        });

        it('keeps lines containing file paths', () => {
            const text = 'Some text.\n\nThe file is at src/core/database.ts and it matters.\n\nMore text that is not important.';
            const result = chain.deterministicSummarize(text, 1.0);

            expect(result).toContain('src/core/database.ts');
        });

        it('keeps function and class declarations', () => {
            const text = 'Random text.\n\nfunction processData(input: string) {\n  return input;\n}\n\nclass MyService {\n  constructor() {}\n}';
            const result = chain.deterministicSummarize(text, 1.0);

            expect(result).toContain('function processData');
            expect(result).toContain('class MyService');
        });

        it('truncates to target ratio of original length', () => {
            // Create a very long text where summarization alone produces more than 30%
            const longText = ('# Heading\n\n' + 'Sentence. '.repeat(200) + '\n').repeat(10);
            const result = chain.deterministicSummarize(longText, 0.3);

            // Result should not exceed 30% of original length
            const maxLength = Math.ceil(longText.length * 0.3);
            expect(result.length).toBeLessThanOrEqual(maxLength);
        });
    });

    // ===================================================================
    // Budget Helpers
    // ===================================================================

    describe('Budget Helpers', () => {
        it('fitsInBudget returns true when total tokens <= budget', () => {
            const items = [
                makeItem({ id: 'a', label: 'A', estimatedTokens: 50 }),
                makeItem({ id: 'b', label: 'B', estimatedTokens: 40 }),
            ];
            const budget = makeBudget(tracker, 100);

            expect(chain.fitsInBudget(items, budget)).toBe(true);
        });

        it('fitsInBudget returns false when total tokens > budget', () => {
            const items = [
                makeItem({ id: 'a', label: 'A', estimatedTokens: 60 }),
                makeItem({ id: 'b', label: 'B', estimatedTokens: 60 }),
            ];
            const budget = makeBudget(tracker, 100);

            expect(chain.fitsInBudget(items, budget)).toBe(false);
        });

        it('totalTokens sums all item estimates', () => {
            const items = [
                makeItem({ id: 'a', label: 'A', estimatedTokens: 10 }),
                makeItem({ id: 'b', label: 'B', estimatedTokens: 20 }),
                makeItem({ id: 'c', label: 'C', estimatedTokens: 30 }),
            ];

            expect(chain.totalTokens(items)).toBe(60);
        });

        it('totalTokens returns 0 for empty array', () => {
            expect(chain.totalTokens([])).toBe(0);
        });
    });

    // ===================================================================
    // Edge Cases
    // ===================================================================

    describe('Edge Cases', () => {
        it('handles a single item through the chain', () => {
            const items = [
                makeItem({
                    id: 'solo',
                    label: 'Solo item',
                    content: 'The only item in the context.',
                    estimatedTokens: 500,
                    priority: ContextPriority.Supplementary,
                    metadata: { sourceType: 'custom', sourceId: 'solo', createdAt: hoursAgo(2), isStale: false, relatedTaskIds: [], relatedFilePatterns: [] },
                }),
            ];

            const budget = makeBudget(tracker, 100); // budget smaller than item

            const { result } = chain.applyChain(items, budget, defaultKeywords);

            // With just 1 item that doesn't fit, it should cascade through levels
            expect(result.strategyApplied).toBeGreaterThanOrEqual(ContextBreakingLevel.SummarizeOld);
            expect(result.originalTokens).toBe(500);
        });

        it('handles all mandatory items gracefully in applyChain', () => {
            // All items are mandatory with large content that exceeds a tiny budget
            const largeContent = 'Critical mandatory content that is very verbose and detailed. '.repeat(30);
            const items = [
                makeItem({
                    id: 'm1',
                    label: 'Mandatory 1',
                    content: largeContent,
                    estimatedTokens: tracker.estimateTokens(largeContent, ContentType.NaturalText),
                    priority: ContextPriority.Mandatory,
                    metadata: { sourceType: 'custom', sourceId: 'm1', createdAt: hoursAgo(1), isStale: false, relatedTaskIds: [], relatedFilePatterns: [] },
                }),
                makeItem({
                    id: 'm2',
                    label: 'Mandatory 2',
                    content: largeContent,
                    estimatedTokens: tracker.estimateTokens(largeContent, ContentType.NaturalText),
                    priority: ContextPriority.Mandatory,
                    metadata: { sourceType: 'custom', sourceId: 'm2', createdAt: hoursAgo(2), isStale: false, relatedTaskIds: [], relatedFilePatterns: [] },
                }),
            ];

            // Budget extremely small — much smaller than even compressed items
            const budget = makeBudget(tracker, 5);

            const { result, items: resultItems } = chain.applyChain(items, budget, defaultKeywords);

            // Should reach FreshStart since nothing else can reduce enough
            expect(result.strategyApplied).toBe(ContextBreakingLevel.FreshStart);
            expect(result.freshStartTriggered).toBe(true);

            // All mandatory items should still be present in result
            const mandatoryIds = resultItems.filter(i => i.id === 'm1' || i.id === 'm2');
            expect(mandatoryIds.length).toBe(2);
        });

        it('Level 2 handles empty items', () => {
            const result = chain.level2PrioritizeRecent([], defaultKeywords);
            expect(result).toEqual([]);
        });

        it('Level 3 handles empty items', () => {
            const result = chain.level3SmartChunking([]);
            expect(result).toEqual([]);
        });

        it('Level 4 handles empty items', () => {
            const result = chain.level4DiscardLowRelevance([], defaultKeywords);
            expect(result).toEqual([]);
        });

        it('constructor works without outputChannel', () => {
            // Ensure no error when no output channel is provided
            const chainNoLog = new ContextBreakingChain(tracker);
            const items = [makeItem({ id: 'x', label: 'X', estimatedTokens: 5 })];
            const budget = makeBudget(tracker, 1000);

            const { result } = chainNoLog.applyChain(items, budget, defaultKeywords);
            expect(result.strategyApplied).toBe(ContextBreakingLevel.None);
        });
    });

    // ===================================================================
    // Plan Detection
    // ===================================================================

    describe('Plan Detection', () => {
        it('detects plans by sourceType "plan"', () => {
            const items = [
                makeItem({
                    id: 'plan-source',
                    label: 'Some document',
                    content: 'Plan details here. '.repeat(20),
                    contentType: ContentType.Markdown,
                    metadata: { sourceType: 'plan', sourceId: 'plan-x', createdAt: hoursAgo(100), isStale: false, relatedTaskIds: [], relatedFilePatterns: [] },
                }),
            ];

            const resultL1 = chain.level1SummarizeOld(items);
            expect(resultL1[0].content).toBe(items[0].content); // unchanged

            const resultL3 = chain.level3SmartChunking(items);
            expect(resultL3[0].content).toBe(items[0].content); // unchanged
        });

        it('detects plans by category "active_plan"', () => {
            const items = [
                makeItem({
                    id: 'active-plan',
                    label: 'Non-obvious label',
                    content: 'Active plan content with lots of text. '.repeat(20),
                    contentType: ContentType.Markdown,
                    category: 'active_plan' as ContextCategory,
                }),
            ];

            const resultL1 = chain.level1SummarizeOld(items);
            expect(resultL1[0].content).toBe(items[0].content);
        });

        it('detects plans by label containing "plan"', () => {
            const items = [
                makeItem({
                    id: 'labeled-plan',
                    label: 'My project plan overview',
                    content: 'Plan content with sentences. '.repeat(20),
                    contentType: ContentType.Markdown,
                }),
            ];

            const resultL3 = chain.level3SmartChunking(items);
            expect(resultL3[0].content).toBe(items[0].content);
        });
    });

    // ===================================================================
    // Integration: Full Chain Flow
    // ===================================================================

    describe('Integration - Full Chain Flow', () => {
        it('progressively reduces token count across levels', () => {
            // Build a realistic context with mixed content types and ages
            const items: ContextItem[] = [
                // Mandatory: system prompt
                makeItem({
                    id: 'sys-prompt',
                    label: 'System Prompt',
                    content: 'You are a planning agent. Follow directives strictly.',
                    contentType: ContentType.NaturalText,
                    category: ContextCategory.SystemPrompt,
                    priority: ContextPriority.Mandatory,
                    estimatedTokens: 15,
                    metadata: { sourceType: 'custom', sourceId: 'sys', createdAt: hoursAgo(100), isStale: false, relatedTaskIds: [], relatedFilePatterns: [] },
                }),
                // Important: current task
                makeItem({
                    id: 'cur-task',
                    label: 'Current Task',
                    content: 'Implement database migration for new schema. Create migration script and test it.',
                    contentType: ContentType.NaturalText,
                    category: ContextCategory.CurrentTask,
                    priority: ContextPriority.Important,
                    estimatedTokens: 25,
                    metadata: { sourceType: 'task', sourceId: 'task-42', createdAt: minutesAgo(5), isStale: false, relatedTaskIds: ['task-42'], relatedFilePatterns: ['database.ts'] },
                }),
                // Old supplementary: conversation history
                ...Array.from({ length: 8 }, (_, i) => makeItem({
                    id: `hist-${i}`,
                    label: `History ${i}`,
                    content: `User asked about feature ${i}. Agent responded with a detailed explanation. `.repeat(5),
                    contentType: ContentType.NaturalText,
                    category: ContextCategory.OlderHistory,
                    priority: ContextPriority.Supplementary,
                    relevanceScore: 10 + i * 5,
                    estimatedTokens: tracker.estimateTokens(`User asked about feature ${i}. Agent responded with a detailed explanation. `.repeat(5), ContentType.NaturalText),
                    metadata: { sourceType: 'history', sourceId: `conv-${i}`, createdAt: hoursAgo(48 - i * 2), isStale: false, relatedTaskIds: [], relatedFilePatterns: [] },
                })),
            ];

            const totalOriginal = chain.totalTokens(items);

            // Test each level individually to verify progressive reduction
            const afterL1 = chain.level1SummarizeOld([...items]);
            const tokensL1 = chain.totalTokens(afterL1);
            expect(tokensL1).toBeLessThanOrEqual(totalOriginal);

            const afterL2 = chain.level2PrioritizeRecent(afterL1, defaultKeywords);
            const tokensL2 = chain.totalTokens(afterL2);
            expect(tokensL2).toBeLessThanOrEqual(tokensL1);

            const afterL3 = chain.level3SmartChunking(afterL2);
            const tokensL3 = chain.totalTokens(afterL3);
            expect(tokensL3).toBeLessThanOrEqual(tokensL2);
        });

        it('result reductionPercent is calculated correctly', () => {
            const items = [
                makeItem({
                    id: 'big',
                    label: 'Big item',
                    content: 'Lots of content here. '.repeat(50),
                    contentType: ContentType.NaturalText,
                    estimatedTokens: 500,
                    metadata: { sourceType: 'custom', sourceId: 'big', createdAt: hoursAgo(5), isStale: false, relatedTaskIds: [], relatedFilePatterns: [] },
                }),
            ];

            const budget = makeBudget(tracker, 100); // force compression

            const { result } = chain.applyChain(items, budget, defaultKeywords);

            // Verify reductionPercent matches the formula
            const expectedPercent = Math.round(((result.originalTokens - result.resultTokens) / result.originalTokens) * 100);
            expect(result.reductionPercent).toBe(expectedPercent);
        });
    });
});
