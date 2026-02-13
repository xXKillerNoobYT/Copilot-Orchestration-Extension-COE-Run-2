import { TokenBudgetTracker } from './token-budget-tracker';
import {
    ContentType, ContextItem, ContextPriority, ContextBreakingResult,
    ContextBreakingLevel, ContextSnapshot, RelevanceKeywordSet, TokenBudget
} from '../types';

/**
 * Context Breaking Chain
 *
 * Implements the 5-level context breaking strategy from True Plan/08.
 * Applied progressively until the token budget is satisfied.
 *
 * Levels:
 *   0 — None: items already fit
 *   1 — Summarize Old: compress oldest 60% to ~30% of original size
 *   2 — Prioritize Recent: keep recent + important, drop stale low-relevance
 *   3 — Smart Chunking: content-type-aware compression
 *   4 — Discard Low Relevance: drop bottom 30% by relevance score
 *   5 — Fresh Start: save snapshot, keep only mandatory items
 *
 * Design principle: No LLM calls — all compression is rule-based and deterministic.
 */
export class ContextBreakingChain {
    private budgetTracker: TokenBudgetTracker;
    private outputChannel: { appendLine: (msg: string) => void } | null;

    constructor(
        budgetTracker: TokenBudgetTracker,
        outputChannel?: { appendLine: (msg: string) => void }
    ) {
        this.budgetTracker = budgetTracker;
        this.outputChannel = outputChannel ?? null;
    }

    // ---------------------------------------------------------------
    // Main Entry Point
    // ---------------------------------------------------------------

    /**
     * Apply the context breaking chain progressively until the items
     * fit within the token budget. Stops at the first level that
     * achieves compliance.
     */
    applyChain(
        items: ContextItem[],
        budget: TokenBudget,
        keywords: RelevanceKeywordSet
    ): { items: ContextItem[]; result: ContextBreakingResult } {
        if (items.length === 0) {
            return {
                items: [],
                result: this.buildResult(ContextBreakingLevel.None, 0, 0, 0, false, null),
            };
        }

        const originalTokens = this.totalTokens(items);

        // Check if items already fit
        if (this.fitsInBudget(items, budget)) {
            this.log(`[ContextBreaking] Items fit in budget (${originalTokens} tokens). No compression needed.`);
            return {
                items,
                result: this.buildResult(ContextBreakingLevel.None, originalTokens, originalTokens, 0, false, null),
            };
        }

        this.log(`[ContextBreaking] Budget exceeded: ${originalTokens} tokens vs ${budget.availableForInput} available. Starting chain.`);

        // Level 1: Summarize Old Context
        let current = this.level1SummarizeOld(items);
        let currentTokens = this.totalTokens(current);
        this.log(`[ContextBreaking] L1 SummarizeOld: ${originalTokens} -> ${currentTokens} tokens (${this.reductionPercent(originalTokens, currentTokens)}% reduction)`);
        if (this.fitsInBudget(current, budget)) {
            return {
                items: current,
                result: this.buildResult(ContextBreakingLevel.SummarizeOld, originalTokens, currentTokens, 0, false, null),
            };
        }

        // Level 2: Prioritize Recent
        const beforeL2Count = current.length;
        current = this.level2PrioritizeRecent(current, keywords);
        currentTokens = this.totalTokens(current);
        const droppedL2 = beforeL2Count - current.length;
        this.log(`[ContextBreaking] L2 PrioritizeRecent: -> ${currentTokens} tokens, dropped ${droppedL2} items (${this.reductionPercent(originalTokens, currentTokens)}% total reduction)`);
        if (this.fitsInBudget(current, budget)) {
            return {
                items: current,
                result: this.buildResult(ContextBreakingLevel.PrioritizeRecent, originalTokens, currentTokens, droppedL2, false, null),
            };
        }

        // Level 3: Smart Chunking
        current = this.level3SmartChunking(current);
        currentTokens = this.totalTokens(current);
        this.log(`[ContextBreaking] L3 SmartChunking: -> ${currentTokens} tokens (${this.reductionPercent(originalTokens, currentTokens)}% total reduction)`);
        if (this.fitsInBudget(current, budget)) {
            return {
                items: current,
                result: this.buildResult(ContextBreakingLevel.SmartChunking, originalTokens, currentTokens, droppedL2, false, null),
            };
        }

        // Level 4: Discard Low Relevance
        const beforeL4Count = current.length;
        current = this.level4DiscardLowRelevance(current, keywords);
        currentTokens = this.totalTokens(current);
        const droppedL4 = beforeL4Count - current.length + (current.filter(i => i.label.startsWith('[Omitted:')).length);
        const totalDropped = droppedL2 + droppedL4;
        this.log(`[ContextBreaking] L4 DiscardLowRelevance: -> ${currentTokens} tokens, dropped ${droppedL4} items (${this.reductionPercent(originalTokens, currentTokens)}% total reduction)`);
        if (this.fitsInBudget(current, budget)) {
            return {
                items: current,
                result: this.buildResult(ContextBreakingLevel.DiscardLowRelevance, originalTokens, currentTokens, totalDropped, false, null),
            };
        }

        // Level 5: Fresh Start
        const freshResult = this.level5FreshStart(current);
        const finalItems = freshResult.essentialItems;
        const finalTokens = this.totalTokens(finalItems);
        const totalFreshDropped = items.length - finalItems.length;
        this.log(`[ContextBreaking] L5 FreshStart: -> ${finalTokens} tokens, kept ${finalItems.length} essential items (${this.reductionPercent(originalTokens, finalTokens)}% total reduction)`);

        return {
            items: finalItems,
            result: this.buildResult(ContextBreakingLevel.FreshStart, originalTokens, finalTokens, totalFreshDropped, true, freshResult.snapshot),
        };
    }

    // ---------------------------------------------------------------
    // Level 1: Summarize Old Context
    // ---------------------------------------------------------------

    /**
     * Sort items by createdAt, take the oldest 60%, and apply
     * deterministic summarization targeting ~30% of original size.
     * Plans are NEVER compressed.
     */
    level1SummarizeOld(items: ContextItem[]): ContextItem[] {
        if (items.length === 0) { return []; }

        // Sort by createdAt ascending (oldest first)
        const sorted = [...items].sort((a, b) =>
            new Date(a.metadata.createdAt).getTime() - new Date(b.metadata.createdAt).getTime()
        );

        const oldCutoff = Math.ceil(sorted.length * 0.6);
        const oldItems = sorted.slice(0, oldCutoff);
        const recentItems = sorted.slice(oldCutoff);

        const summarized = oldItems.map(item => {
            // Never compress plan references
            if (this.isPlanItem(item)) {
                return item;
            }

            const compressed = this.deterministicSummarize(item.content, 0.3);
            const newTokens = this.budgetTracker.estimateTokens(compressed, item.contentType);

            return {
                ...item,
                content: compressed,
                estimatedTokens: newTokens,
            };
        });

        return [...summarized, ...recentItems];
    }

    // ---------------------------------------------------------------
    // Level 2: Prioritize Recent
    // ---------------------------------------------------------------

    /**
     * Keep items from the last hour at full fidelity, keep Important+
     * items regardless of age, drop items older than 24h with low
     * relevance, and apply recency bonuses.
     */
    level2PrioritizeRecent(items: ContextItem[], _keywords: RelevanceKeywordSet): ContextItem[] {
        if (items.length === 0) { return []; }

        const now = Date.now();
        const ONE_HOUR = 60 * 60 * 1000;
        const TEN_MINUTES = 10 * 60 * 1000;
        const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

        const result: ContextItem[] = [];

        for (const item of items) {
            const createdAt = new Date(item.metadata.createdAt).getTime();
            const ageMs = now - createdAt;

            // Keep all items from the last hour at full fidelity
            if (ageMs <= ONE_HOUR) {
                // Apply recency bonus: items in last 10 min get +20
                const bonus = ageMs <= TEN_MINUTES ? 20 : 0;
                result.push({
                    ...item,
                    relevanceScore: item.relevanceScore + bonus,
                });
                continue;
            }

            // Keep all items with priority <= Important (Mandatory=1, Important=2)
            if (item.priority <= ContextPriority.Important) {
                result.push(item);
                continue;
            }

            // Drop items older than 24 hours with relevanceScore < 30
            if (ageMs > TWENTY_FOUR_HOURS && item.relevanceScore < 30) {
                continue; // dropped
            }

            // Keep everything else
            result.push(item);
        }

        return result;
    }

    // ---------------------------------------------------------------
    // Level 3: Smart Chunking
    // ---------------------------------------------------------------

    /**
     * Compress items by content type. Plans are NEVER compressed.
     *
     * Targets:
     *   Code      -> 70% of original
     *   NaturalText -> 50%
     *   JSON      -> 60%
     *   Markdown  -> 50%
     *   Plans     -> 100% (never touch)
     */
    level3SmartChunking(items: ContextItem[]): ContextItem[] {
        if (items.length === 0) { return []; }

        return items.map(item => {
            // Plans are source of truth — NEVER compress
            if (this.isPlanItem(item)) {
                return item;
            }

            let compressed: string;

            switch (item.contentType) {
                case ContentType.Code:
                    compressed = this.compressCode(item.content);
                    break;
                case ContentType.NaturalText:
                    compressed = this.compressNaturalText(item.content);
                    break;
                case ContentType.JSON:
                    compressed = this.compressJSON(item.content);
                    break;
                case ContentType.Markdown:
                    compressed = this.compressMarkdown(item.content);
                    break;
                default:
                    // Mixed or unknown: apply natural text strategy
                    compressed = this.compressNaturalText(item.content);
                    break;
            }

            const newTokens = this.budgetTracker.estimateTokens(compressed, item.contentType);

            return {
                ...item,
                content: compressed,
                estimatedTokens: newTokens,
            };
        });
    }

    // ---------------------------------------------------------------
    // Level 4: Discard Low Relevance
    // ---------------------------------------------------------------

    /**
     * Score all items by relevance, sort ascending, drop the bottom 30%,
     * and replace each dropped item with a one-line placeholder.
     */
    level4DiscardLowRelevance(items: ContextItem[], keywords: RelevanceKeywordSet): ContextItem[] {
        if (items.length === 0) { return []; }

        // Score items by keyword matching (augment existing relevanceScore)
        const scored = items.map(item => ({
            item,
            score: this.scoreRelevance(item, keywords),
        }));

        // Sort ascending by score (lowest first)
        scored.sort((a, b) => a.score - b.score);

        const dropCount = Math.floor(scored.length * 0.3);
        const toDrop = scored.slice(0, dropCount);
        const toKeep = scored.slice(dropCount);

        // Build placeholders for dropped items
        const placeholders: ContextItem[] = toDrop.map(({ item }) => ({
            id: item.id,
            label: `[Omitted: ${item.label} (${item.estimatedTokens} tokens) -- low relevance]`,
            content: `[Omitted: ${item.label} (${item.estimatedTokens} tokens) -- low relevance]`,
            contentType: ContentType.NaturalText,
            category: item.category,
            priority: ContextPriority.Optional,
            relevanceScore: 0,
            estimatedTokens: this.budgetTracker.estimateTokens(
                `[Omitted: ${item.label} (${item.estimatedTokens} tokens) -- low relevance]`,
                ContentType.NaturalText
            ),
            metadata: item.metadata,
        }));

        // Restore kept items (unsorted — preserve their original ordering by re-sorting by score desc isn't needed,
        // we just need to keep them; but let's preserve their original position sense)
        const keptItems = toKeep.map(s => s.item);

        return [...keptItems, ...placeholders];
    }

    // ---------------------------------------------------------------
    // Level 5: Fresh Start
    // ---------------------------------------------------------------

    /**
     * Nuclear option. Save ALL items into a ContextSnapshot,
     * keep only Mandatory items + a one-paragraph summary.
     */
    level5FreshStart(items: ContextItem[]): { essentialItems: ContextItem[]; snapshot: ContextSnapshot } {
        // Build snapshot from all items
        const snapshot: ContextSnapshot = {
            id: `snapshot-${Date.now()}`,
            agent_type: 'context_breaking_chain',
            task_id: this.extractTaskId(items),
            ticket_id: this.extractTicketId(items),
            summary: this.buildSummaryParagraph(items),
            essential_context: JSON.stringify(
                items
                    .filter(i => i.priority === ContextPriority.Mandatory)
                    .map(i => ({ id: i.id, label: i.label, category: i.category }))
            ),
            resume_instructions: `Context was compressed via Fresh Start (Level 5). ${items.length} items were saved to this snapshot. Mandatory items were retained. Restore from snapshot ID ${`snapshot-${Date.now()}`} if full context is needed.`,
            created_at: new Date().toISOString(),
        };

        // Keep only mandatory items
        const mandatoryItems = items.filter(i => i.priority === ContextPriority.Mandatory);

        // Create a summary item for everything discarded
        const discardedItems = items.filter(i => i.priority !== ContextPriority.Mandatory);
        const summaryContent = this.buildSummaryParagraph(discardedItems);
        const summaryItem: ContextItem = {
            id: `fresh-start-summary-${Date.now()}`,
            label: 'Fresh Start Summary',
            content: summaryContent,
            contentType: ContentType.NaturalText,
            category: discardedItems.length > 0 ? discardedItems[0].category : mandatoryItems.length > 0 ? mandatoryItems[0].category : ('supplementary' as any),
            priority: ContextPriority.Important,
            relevanceScore: 50,
            estimatedTokens: this.budgetTracker.estimateTokens(summaryContent, ContentType.NaturalText),
            metadata: {
                sourceType: 'custom',
                sourceId: 'fresh-start',
                createdAt: new Date().toISOString(),
                isStale: false,
                relatedTaskIds: [],
                relatedFilePatterns: [],
            },
        };

        const essentialItems = [...mandatoryItems, summaryItem];

        return { essentialItems, snapshot };
    }

    // ---------------------------------------------------------------
    // Deterministic Summarize
    // ---------------------------------------------------------------

    /**
     * Rule-based summarization:
     *   - Extract first sentence of each paragraph
     *   - Keep headings (lines starting with #)
     *   - Keep file paths (anything matching / or \ patterns)
     *   - Keep function/class names (words before ( or after class )
     *   - Strip verbose explanations, examples, repeated content
     *   - Truncate to target ratio of original length
     */
    deterministicSummarize(text: string, targetRatio: number): string {
        if (!text || text.length === 0) { return ''; }
        if (targetRatio >= 1.0) { return text; }

        const lines = text.split('\n');
        const kept: string[] = [];
        const seen = new Set<string>();

        let inParagraph = false;
        let paragraphFirstSentenceCaptured = false;

        for (const line of lines) {
            const trimmed = line.trim();

            // Always keep headings
            if (/^#{1,6}\s/.test(trimmed)) {
                kept.push(line);
                inParagraph = false;
                paragraphFirstSentenceCaptured = false;
                continue;
            }

            // Always keep lines containing file paths
            if (/[\/\\][\w.-]+[\/\\]?[\w.-]*/.test(trimmed) || /\.\w{1,5}$/.test(trimmed)) {
                if (!seen.has(trimmed)) {
                    kept.push(line);
                    seen.add(trimmed);
                }
                continue;
            }

            // Always keep lines with function/class declarations
            if (/\b(function|class|interface|type|enum|const|let|var|def|fn)\s+\w+/.test(trimmed) ||
                /\w+\s*\(/.test(trimmed) && /\b(export|public|private|protected|async|static)\b/.test(trimmed)) {
                if (!seen.has(trimmed)) {
                    kept.push(line);
                    seen.add(trimmed);
                }
                continue;
            }

            // Empty line = paragraph boundary
            if (trimmed === '') {
                inParagraph = false;
                paragraphFirstSentenceCaptured = false;
                continue;
            }

            // Start of a new paragraph — capture first sentence
            if (!inParagraph) {
                inParagraph = true;
                paragraphFirstSentenceCaptured = false;
            }

            if (!paragraphFirstSentenceCaptured) {
                // Extract first sentence (up to period, exclamation, or question mark)
                const sentenceMatch = trimmed.match(/^[^.!?]*[.!?]/);
                const sentence = sentenceMatch ? sentenceMatch[0] : trimmed;
                if (!seen.has(sentence)) {
                    kept.push(sentence);
                    seen.add(sentence);
                }
                paragraphFirstSentenceCaptured = true;
            }
            // Else: skip subsequent sentences in the paragraph
        }

        const result = kept.join('\n');

        // Truncate to target ratio of original length
        const targetLength = Math.ceil(text.length * targetRatio);
        if (result.length <= targetLength) {
            return result;
        }

        return result.slice(0, targetLength);
    }

    // ---------------------------------------------------------------
    // Budget Helpers
    // ---------------------------------------------------------------

    /**
     * Check if all items fit within the budget's available input tokens.
     */
    fitsInBudget(items: ContextItem[], budget: TokenBudget): boolean {
        const total = this.totalTokens(items);
        return total <= budget.availableForInput;
    }

    /**
     * Sum the estimated tokens across all items.
     */
    totalTokens(items: ContextItem[]): number {
        return items.reduce((sum, item) => sum + item.estimatedTokens, 0);
    }

    // ---------------------------------------------------------------
    // Content-Type Compression Helpers
    // ---------------------------------------------------------------

    /**
     * Code compression: strip comments, collapse whitespace, remove blank lines.
     * Target: ~70% of original.
     */
    private compressCode(content: string): string {
        if (!content) { return ''; }

        let result = content;

        // Remove single-line comments (// ...)
        result = result.replace(/\/\/[^\n]*$/gm, '');

        // Remove multi-line comments (/* ... */)
        result = result.replace(/\/\*[\s\S]*?\*\//g, '');

        // Remove Python/shell-style comments (# ...)
        // Only if they appear to be comments (line starts with # or has # preceded by space)
        // But skip markdown headings (lines starting with # followed by space and text that looks like a heading)
        result = result.replace(/(?<=\s)#[^\n]*$/gm, '');

        // Collapse multiple blank lines into one
        result = result.replace(/\n{3,}/g, '\n\n');

        // Remove trailing whitespace on each line
        result = result.replace(/[ \t]+$/gm, '');

        // Remove leading blank lines
        result = result.replace(/^\n+/, '');

        // Remove trailing blank lines
        result = result.replace(/\n+$/, '');

        // If still too large, further collapse all blank lines
        if (result.length > content.length * 0.7) {
            result = result.replace(/\n\n+/g, '\n');
        }

        return result;
    }

    /**
     * Natural text compression: extract key sentences (first sentence of
     * each paragraph + sentences containing keywords).
     * Target: ~50% of original.
     */
    private compressNaturalText(content: string): string {
        if (!content) { return ''; }

        return this.deterministicSummarize(content, 0.5);
    }

    /**
     * JSON compression: remove null/empty values, truncate long strings.
     * Target: ~60% of original.
     */
    private compressJSON(content: string): string {
        if (!content) { return ''; }

        try {
            const parsed = JSON.parse(content);
            const cleaned = this.cleanJSONValue(parsed);
            const result = JSON.stringify(cleaned);

            // If result is within target, return it
            if (result.length <= content.length * 0.6) {
                return result;
            }

            // Otherwise return compact JSON (no extra whitespace)
            return result.slice(0, Math.ceil(content.length * 0.6));
        } catch {
            // Not valid JSON — fall back to text compression
            return this.deterministicSummarize(content, 0.6);
        }
    }

    /**
     * Markdown compression: remove verbose paragraphs, keep headings +
     * first sentence per section.
     * Target: ~50% of original.
     */
    private compressMarkdown(content: string): string {
        if (!content) { return ''; }

        return this.deterministicSummarize(content, 0.5);
    }

    // ---------------------------------------------------------------
    // JSON Cleaning Helper
    // ---------------------------------------------------------------

    /**
     * Recursively clean JSON: remove null/empty values, truncate long strings.
     */
    private cleanJSONValue(value: unknown): unknown {
        if (value === null || value === undefined) {
            return undefined; // will be stripped by JSON.stringify
        }

        if (typeof value === 'string') {
            // Truncate strings longer than 50 characters
            if (value.length > 50) {
                return value.slice(0, 50) + '...';
            }
            // Remove empty strings
            if (value.length === 0) {
                return undefined;
            }
            return value;
        }

        if (Array.isArray(value)) {
            const cleaned = value
                .map(v => this.cleanJSONValue(v))
                .filter(v => v !== undefined);
            return cleaned.length > 0 ? cleaned : undefined;
        }

        if (typeof value === 'object') {
            const cleaned: Record<string, unknown> = {};
            let hasKeys = false;
            for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
                const cv = this.cleanJSONValue(v);
                if (cv !== undefined) {
                    cleaned[k] = cv;
                    hasKeys = true;
                }
            }
            return hasKeys ? cleaned : undefined;
        }

        // numbers, booleans — keep as-is
        return value;
    }

    // ---------------------------------------------------------------
    // Relevance Scoring
    // ---------------------------------------------------------------

    /**
     * Score an item's relevance using keyword matching against the
     * RelevanceKeywordSet. Returns a composite score (higher = more relevant).
     */
    private scoreRelevance(item: ContextItem, keywords: RelevanceKeywordSet): number {
        let score = item.relevanceScore;
        const contentLower = item.content.toLowerCase();
        const labelLower = item.label.toLowerCase();

        // Task keywords — high weight
        for (const kw of keywords.taskKeywords) {
            const kwLower = kw.toLowerCase();
            if (contentLower.includes(kwLower) || labelLower.includes(kwLower)) {
                score += 15;
            }
        }

        // File keywords — medium weight
        for (const kw of keywords.fileKeywords) {
            const kwLower = kw.toLowerCase();
            if (contentLower.includes(kwLower) || labelLower.includes(kwLower)) {
                score += 10;
            }
        }

        // Domain keywords — lower weight
        for (const kw of keywords.domainKeywords) {
            const kwLower = kw.toLowerCase();
            if (contentLower.includes(kwLower) || labelLower.includes(kwLower)) {
                score += 5;
            }
        }

        // Priority bonus: Mandatory/Important items get a relevance floor
        if (item.priority === ContextPriority.Mandatory) {
            score += 100;
        } else if (item.priority === ContextPriority.Important) {
            score += 50;
        }

        return score;
    }

    // ---------------------------------------------------------------
    // Plan Detection
    // ---------------------------------------------------------------

    /**
     * Plans are NEVER compressed — they are the source of truth.
     */
    private isPlanItem(item: ContextItem): boolean {
        return (
            item.metadata.sourceType === 'plan' ||
            item.category === ('active_plan' as any) ||
            item.label.toLowerCase().includes('plan')
        );
    }

    // ---------------------------------------------------------------
    // Snapshot Helpers
    // ---------------------------------------------------------------

    /**
     * Build a one-paragraph summary of the given items for the fresh start snapshot.
     */
    private buildSummaryParagraph(items: ContextItem[]): string {
        if (items.length === 0) {
            return 'No items to summarize.';
        }

        const categories = new Map<string, number>();
        let totalTokens = 0;

        for (const item of items) {
            const count = categories.get(item.category) ?? 0;
            categories.set(item.category, count + 1);
            totalTokens += item.estimatedTokens;
        }

        const categoryBreakdown = Array.from(categories.entries())
            .map(([cat, count]) => `${count} ${cat}`)
            .join(', ');

        const labels = items
            .slice(0, 10) // cap at 10 for brevity
            .map(i => i.label)
            .join(', ');

        const trailNote = items.length > 10 ? `, and ${items.length - 10} more` : '';

        return `Context snapshot contains ${items.length} items (${totalTokens} tokens): ${categoryBreakdown}. Key items: ${labels}${trailNote}.`;
    }

    /**
     * Extract task ID from items metadata if available.
     */
    private extractTaskId(items: ContextItem[]): string | null {
        for (const item of items) {
            if (item.metadata.relatedTaskIds.length > 0) {
                return item.metadata.relatedTaskIds[0];
            }
        }
        return null;
    }

    /**
     * Extract ticket ID from items metadata if available.
     */
    private extractTicketId(items: ContextItem[]): string | null {
        for (const item of items) {
            if (item.metadata.sourceType === 'ticket') {
                return item.metadata.sourceId;
            }
        }
        return null;
    }

    // ---------------------------------------------------------------
    // Result Builder
    // ---------------------------------------------------------------

    private buildResult(
        level: ContextBreakingLevel,
        originalTokens: number,
        resultTokens: number,
        itemsDropped: number,
        freshStartTriggered: boolean,
        savedState: ContextSnapshot | null
    ): ContextBreakingResult {
        return {
            strategyApplied: level,
            originalTokens,
            resultTokens,
            reductionPercent: this.reductionPercent(originalTokens, resultTokens),
            itemsDropped,
            freshStartTriggered,
            savedState,
        };
    }

    private reductionPercent(original: number, result: number): number {
        if (original === 0) { return 0; }
        return Math.round(((original - result) / original) * 100);
    }

    // ---------------------------------------------------------------
    // Logging
    // ---------------------------------------------------------------

    private log(message: string): void {
        this.outputChannel?.appendLine(message);
    }
}
