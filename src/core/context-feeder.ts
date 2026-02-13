import { TokenBudgetTracker } from './token-budget-tracker';
import {
    ContentType, ContextCategory, ContextPriority, ContextItem,
    ContextFeedResult, RelevanceKeywordSet, TokenBudget,
    LLMMessage, AgentContext, AgentType, Task, Plan,
    DesignComponent
} from '../types';

// ============================================================
// Intelligent Context Feeder
//
// Sits between BaseAgent.buildMessages() and raw context data.
// Decides what context to include based on relevance scoring,
// tiered loading, and deterministic compression.
//
// NO LLM calls — everything is deterministic.
// ============================================================

/**
 * Maps ContextCategory to its loading tier.
 * Tier 1 = Mandatory (always loaded)
 * Tier 2 = Important (loaded if budget allows)
 * Tier 3 = Supplementary (loaded if budget allows, can be compressed)
 * Tier 4 = Optional (only if surplus budget)
 */
const CATEGORY_TIER: Record<ContextCategory, ContextPriority> = {
    [ContextCategory.SystemPrompt]: ContextPriority.Mandatory,
    [ContextCategory.CurrentTask]: ContextPriority.Mandatory,
    [ContextCategory.UserMessage]: ContextPriority.Mandatory,
    [ContextCategory.ActivePlan]: ContextPriority.Important,
    [ContextCategory.RelatedTicket]: ContextPriority.Important,
    [ContextCategory.RecentHistory]: ContextPriority.Important,
    [ContextCategory.DesignComponents]: ContextPriority.Supplementary,
    [ContextCategory.ComponentSchemas]: ContextPriority.Supplementary,
    [ContextCategory.EthicsRules]: ContextPriority.Supplementary,
    [ContextCategory.SyncState]: ContextPriority.Supplementary,
    [ContextCategory.OlderHistory]: ContextPriority.Optional,
    [ContextCategory.Supplementary]: ContextPriority.Optional,
};

/** Stop words excluded from keyword extraction */
const STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
    'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
    'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
    'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
    'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
    'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
    'just', 'because', 'but', 'and', 'or', 'if', 'while', 'that', 'this',
    'it', 'its', 'they', 'them', 'their', 'what', 'which', 'who', 'whom',
    'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he',
    'him', 'his', 'she', 'her',
]);

/** Max age in milliseconds before staleness penalty kicks in (7 days) */
const STALENESS_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

/** Maximum children before collapsing in component tree summaries */
const MAX_VISIBLE_CHILDREN = 5;

export class ContextFeeder {
    private budgetTracker: TokenBudgetTracker;
    private outputChannel: { appendLine: (msg: string) => void } | null;

    constructor(
        budgetTracker: TokenBudgetTracker,
        outputChannel?: { appendLine: (msg: string) => void }
    ) {
        this.budgetTracker = budgetTracker;
        this.outputChannel = outputChannel ?? null;
    }

    // ================================================================
    // 1. Relevance Scoring (deterministic keyword matching)
    // ================================================================

    /**
     * Score a ContextItem's relevance to the current keywords.
     * Returns 0-100 based on keyword overlap with weighted fields.
     *
     * Formula:
     *   raw = (title_matches * 3) + (description_matches * 2) +
     *         (content_matches * 1) + (file_path_matches * 4) +
     *         recency_bonus + same_plan_bonus - staleness_penalty
     *
     * Normalized to 0-100 range.
     */
    scoreRelevance(item: ContextItem, keywords: RelevanceKeywordSet): number {
        const allKeywords = [
            ...keywords.taskKeywords,
            ...keywords.fileKeywords,
            ...keywords.domainKeywords,
        ];

        if (allKeywords.length === 0) {
            return 50; // neutral score when no keywords available
        }

        const labelLower = (item.label ?? '').toLowerCase();
        const contentLower = (item.content ?? '').toLowerCase();

        // Extract a "description" from the first 500 chars of content
        const descriptionLower = contentLower.slice(0, 500);

        // File path keywords: check against relatedFilePatterns in metadata
        const filePatterns = (item.metadata?.relatedFilePatterns ?? []).map(f => f.toLowerCase());

        let titleMatches = 0;
        let descriptionMatches = 0;
        let contentMatches = 0;
        let filePathMatches = 0;

        for (const kw of keywords.taskKeywords) {
            const kwLower = kw.toLowerCase();
            if (labelLower.includes(kwLower)) { titleMatches++; }
            if (descriptionLower.includes(kwLower)) { descriptionMatches++; }
            if (contentLower.includes(kwLower)) { contentMatches++; }
        }

        for (const kw of keywords.domainKeywords) {
            const kwLower = kw.toLowerCase();
            if (labelLower.includes(kwLower)) { titleMatches++; }
            if (descriptionLower.includes(kwLower)) { descriptionMatches++; }
            if (contentLower.includes(kwLower)) { contentMatches++; }
        }

        for (const kw of keywords.fileKeywords) {
            const kwLower = kw.toLowerCase();
            if (labelLower.includes(kwLower)) { titleMatches++; }
            for (const fp of filePatterns) {
                if (fp.includes(kwLower)) { filePathMatches++; }
            }
            if (contentLower.includes(kwLower)) { contentMatches++; }
        }

        // Weighted raw score
        let raw = (titleMatches * 3) +
                  (descriptionMatches * 2) +
                  (contentMatches * 1) +
                  (filePathMatches * 4);

        // Recency bonus: items created in the last hour get +10, last day +5
        const recencyBonus = this.calculateRecencyBonus(item.metadata?.createdAt);
        raw += recencyBonus;

        // Same-plan bonus: if item's related task IDs overlap with the keywords context, +8
        const relatedTaskIds = item.metadata?.relatedTaskIds ?? [];
        if (relatedTaskIds.length > 0) {
            const hasOverlap = keywords.taskKeywords.some(kw =>
                relatedTaskIds.some(tid => tid.toLowerCase().includes(kw.toLowerCase()))
            );
            if (hasOverlap) {
                raw += 8;
            }
        }

        // Staleness penalty: items older than STALENESS_THRESHOLD get -5 to -15
        const stalenessPenalty = this.calculateStalenessPenalty(item.metadata?.createdAt, item.metadata?.isStale);
        raw -= stalenessPenalty;

        // Normalize to 0-100
        // Max possible raw: assume ~5 keyword matches in each field + bonuses ~ 60-80
        // Use a sigmoid-like clamping
        const maxExpectedRaw = Math.max(allKeywords.length * 3, 20);
        const normalized = Math.min(100, Math.max(0, Math.round((raw / maxExpectedRaw) * 100)));

        return normalized;
    }

    /**
     * Extract keywords from task, message, and plan for relevance scoring.
     * All deterministic — splits text, removes stop words, deduplicates.
     */
    extractKeywords(task?: Task, message?: string, plan?: Plan): RelevanceKeywordSet {
        const taskKeywords: Set<string> = new Set();
        const fileKeywords: Set<string> = new Set();
        const domainKeywords: Set<string> = new Set();

        // Extract from task
        if (task) {
            this.extractWordsInto(task.title, taskKeywords);
            this.extractWordsInto(task.description, taskKeywords);
            this.extractWordsInto(task.acceptance_criteria, taskKeywords);

            // File paths become file keywords
            if (task.files_modified) {
                for (const filePath of task.files_modified) {
                    if (!filePath) { continue; }
                    fileKeywords.add(filePath.toLowerCase());
                    // Also extract filename without extension
                    const parts = filePath.replace(/\\/g, '/').split('/');
                    const filename = parts[parts.length - 1];
                    if (filename) {
                        const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
                        if (nameWithoutExt.length > 2) {
                            fileKeywords.add(nameWithoutExt.toLowerCase());
                        }
                    }
                }
            }
        }

        // Extract from user message
        if (message) {
            this.extractWordsInto(message, domainKeywords);
        }

        // Extract from plan
        if (plan) {
            this.extractWordsInto(plan.name, domainKeywords);
            // Extract from config_json (parse if valid, else treat as text)
            if (plan.config_json) {
                try {
                    const config = JSON.parse(plan.config_json);
                    if (typeof config === 'object' && config !== null) {
                        const configStr = Object.values(config)
                            .filter(v => typeof v === 'string')
                            .join(' ');
                        this.extractWordsInto(configStr, domainKeywords);
                    }
                } catch {
                    // Not valid JSON — treat as plain text
                    this.extractWordsInto(plan.config_json, domainKeywords);
                }
            }
        }

        return {
            taskKeywords: Array.from(taskKeywords),
            fileKeywords: Array.from(fileKeywords),
            domainKeywords: Array.from(domainKeywords),
        };
    }

    // ================================================================
    // 2. Tiered Loading
    // ================================================================

    /**
     * Sort context items by tier (mandatory first), then by relevance within tier.
     */
    sortByTierAndRelevance(items: ContextItem[]): ContextItem[] {
        return [...items].sort((a, b) => {
            const tierA = CATEGORY_TIER[a.category] ?? ContextPriority.Optional;
            const tierB = CATEGORY_TIER[b.category] ?? ContextPriority.Optional;

            // Lower tier number = higher priority
            if (tierA !== tierB) {
                return tierA - tierB;
            }

            // Within same tier, higher relevance first
            return b.relevanceScore - a.relevanceScore;
        });
    }

    // ================================================================
    // 3. Deterministic Compression
    // ================================================================

    /**
     * Compress a ContextItem to fit within a target token count.
     * Applies progressively aggressive compression strategies
     * depending on the content type and how much reduction is needed.
     *
     * Returns a new ContextItem with compressed content (original untouched).
     */
    compressItem(item: ContextItem, targetTokens: number): ContextItem {
        const currentTokens = this.budgetTracker.estimateTokens(item.content, item.contentType);

        // Already fits — no compression needed
        if (currentTokens <= targetTokens) {
            return { ...item };
        }

        let compressed = item.content;

        // Strategy 1: Strip comments from code
        if (item.contentType === ContentType.Code || item.contentType === ContentType.Mixed) {
            compressed = this.stripComments(compressed);
            if (this.budgetTracker.estimateTokens(compressed, item.contentType) <= targetTokens) {
                return this.makeCompressedItem(item, compressed);
            }
        }

        // Strategy 2: Abbreviate JSON
        if (item.contentType === ContentType.JSON) {
            compressed = this.abbreviateJSON(compressed);
            if (this.budgetTracker.estimateTokens(compressed, item.contentType) <= targetTokens) {
                return this.makeCompressedItem(item, compressed);
            }
        }

        // Strategy 3: Collapse repeated patterns
        compressed = this.collapseRepeatedPatterns(compressed);
        if (this.budgetTracker.estimateTokens(compressed, item.contentType) <= targetTokens) {
            return this.makeCompressedItem(item, compressed);
        }

        // Strategy 4: Truncate to keep first N and last M lines
        const lines = compressed.split('\n');
        const targetChars = targetTokens * 4; // rough inverse of token estimation
        compressed = this.truncateHistory(compressed, Math.max(5, Math.floor(targetChars / 80)));
        if (this.budgetTracker.estimateTokens(compressed, item.contentType) <= targetTokens) {
            return this.makeCompressedItem(item, compressed);
        }

        // Strategy 5: Hard truncate to target char count
        compressed = compressed.slice(0, targetChars);
        const lastNewline = compressed.lastIndexOf('\n');
        if (lastNewline > targetChars * 0.5) {
            compressed = compressed.slice(0, lastNewline);
        }
        compressed += '\n[... truncated to fit budget]';

        return this.makeCompressedItem(item, compressed);
    }

    /**
     * Remove single-line (//) and block comments from code.
     */
    stripComments(code: string): string {
        if (!code) { return ''; }

        let result = '';
        let i = 0;
        let inString: string | null = null;
        let inTemplateString = false;

        while (i < code.length) {
            const ch = code[i];
            const next = i + 1 < code.length ? code[i + 1] : '';

            // Handle string literals — don't strip "comments" inside strings
            if (!inString && !inTemplateString) {
                if (ch === '"' || ch === "'") {
                    inString = ch;
                    result += ch;
                    i++;
                    continue;
                }
                if (ch === '`') {
                    inTemplateString = true;
                    result += ch;
                    i++;
                    continue;
                }

                // Single-line comment
                if (ch === '/' && next === '/') {
                    // Skip to end of line
                    while (i < code.length && code[i] !== '\n') { i++; }
                    continue;
                }

                // Block comment
                if (ch === '/' && next === '*') {
                    i += 2;
                    while (i < code.length - 1) {
                        if (code[i] === '*' && code[i + 1] === '/') {
                            i += 2;
                            break;
                        }
                        i++;
                    }
                    // Handle case where block comment reaches end of string
                    if (i >= code.length - 1 && !(code[code.length - 2] === '*' && code[code.length - 1] === '/')) {
                        i = code.length;
                    }
                    continue;
                }
            } else if (inString) {
                // Check for escape
                if (ch === '\\') {
                    result += ch;
                    i++;
                    if (i < code.length) {
                        result += code[i];
                        i++;
                    }
                    continue;
                }
                if (ch === inString) {
                    inString = null;
                }
            } else if (inTemplateString) {
                if (ch === '\\') {
                    result += ch;
                    i++;
                    if (i < code.length) {
                        result += code[i];
                        i++;
                    }
                    continue;
                }
                if (ch === '`') {
                    inTemplateString = false;
                }
            }

            result += ch;
            i++;
        }

        // Clean up consecutive blank lines left after comment removal
        return result.replace(/\n{3,}/g, '\n\n');
    }

    /**
     * Detect sequences of repeated/similar lines and collapse them.
     * E.g., 20 similar import lines become "import ... [and 18 similar entries]"
     */
    collapseRepeatedPatterns(text: string): string {
        if (!text) { return ''; }

        const lines = text.split('\n');
        if (lines.length <= 3) { return text; }

        const result: string[] = [];
        let i = 0;

        while (i < lines.length) {
            const currentLine = lines[i].trim();

            // Detect runs of similar lines (same prefix up to first variable part)
            const prefix = this.extractLinePrefix(currentLine);
            if (prefix.length >= 4) {
                let runLength = 1;
                let j = i + 1;
                while (j < lines.length) {
                    const nextPrefix = this.extractLinePrefix(lines[j].trim());
                    if (nextPrefix === prefix) {
                        runLength++;
                        j++;
                    } else {
                        break;
                    }
                }

                if (runLength >= 3) {
                    // Keep first and last, collapse middle
                    result.push(lines[i]);
                    if (runLength > 2) {
                        result.push(`[${runLength - 2} similar entries]`);
                    }
                    result.push(lines[j - 1]);
                    i = j;
                    continue;
                }
            }

            result.push(lines[i]);
            i++;
        }

        return result.join('\n');
    }

    /**
     * Abbreviate JSON content by removing null values and truncating long strings.
     */
    abbreviateJSON(json: string): string {
        if (!json) { return ''; }

        try {
            const parsed = JSON.parse(json);
            const abbreviated = this.abbreviateObject(parsed);
            return JSON.stringify(abbreviated, null, 1); // compact indent
        } catch {
            // Not valid JSON — return as-is
            return json;
        }
    }

    /**
     * Keep first N and last M lines of content.
     * N = 60% of maxLines, M = 40% of maxLines.
     */
    truncateHistory(content: string, maxLines: number): string {
        if (!content) { return ''; }

        const lines = content.split('\n');
        if (lines.length <= maxLines) { return content; }

        const headCount = Math.ceil(maxLines * 0.6);
        const tailCount = Math.max(1, maxLines - headCount);

        const head = lines.slice(0, headCount);
        const tail = lines.slice(-tailCount);
        const omitted = lines.length - headCount - tailCount;

        return [
            ...head,
            `[... ${omitted} lines omitted ...]`,
            ...tail,
        ].join('\n');
    }

    // ================================================================
    // 4. Main Entry Point
    // ================================================================

    /**
     * Build optimized LLM messages from agent context.
     *
     * Steps:
     * 1. Create a TokenBudget
     * 2. Build ContextItems from AgentContext
     * 3. Score relevance for each item
     * 4. Sort by tier, then by relevance
     * 5. Load items into budget by tier priority
     * 6. Compress items before dropping if budget exceeded
     * 7. Return ContextFeedResult with messages, budget, included/excluded
     */
    buildOptimizedMessages(
        agentType: AgentType,
        userMessage: string,
        systemPrompt: string,
        context: AgentContext,
        additionalItems?: ContextItem[]
    ): ContextFeedResult {
        // 1. Create budget
        const budget = this.budgetTracker.createBudget(agentType);

        // 2. Build context items from the AgentContext
        const contextItems = this.buildContextItems(context, additionalItems);

        // 3. Extract keywords and score relevance
        const keywords = this.extractKeywords(context.task, userMessage, context.plan);
        for (const item of contextItems) {
            item.relevanceScore = this.scoreRelevance(item, keywords);
        }

        // 4. Sort by tier, then relevance
        const sorted = this.sortByTierAndRelevance(contextItems);

        // 5. Load items into budget by tier
        const includedItems: ContextItem[] = [];
        const excludedItems: ContextItem[] = [];
        let compressionApplied = false;

        // Always include system prompt first
        const systemItem = this.buildSystemPromptItem(systemPrompt);
        this.budgetTracker.addItem(budget, systemItem.label, systemItem.content, systemItem.priority, systemItem.contentType);
        includedItems.push(systemItem);

        // Always include user message
        const userItem = this.buildUserMessageItem(userMessage);
        this.budgetTracker.addItem(budget, userItem.label, userItem.content, userItem.priority, userItem.contentType);
        includedItems.push(userItem);

        // Process remaining items
        for (const item of sorted) {
            // Skip system prompt and user message categories (already handled)
            if (item.category === ContextCategory.SystemPrompt ||
                item.category === ContextCategory.UserMessage) {
                continue;
            }

            const itemTokens = this.budgetTracker.estimateTokens(item.content, item.contentType);
            const remaining = this.budgetTracker.getRemaining(budget);

            if (this.budgetTracker.canFit(budget, item.content, item.contentType)) {
                // Fits as-is
                this.budgetTracker.addItem(budget, item.label, item.content, item.priority, item.contentType);
                item.estimatedTokens = itemTokens;
                includedItems.push(item);
            } else if (item.priority <= ContextPriority.Supplementary && remaining > 50) {
                // Try to compress and fit (only for Tier 1-3 items)
                const compressed = this.compressItem(item, Math.floor(remaining * 0.8));
                const compressedTokens = this.budgetTracker.estimateTokens(compressed.content, compressed.contentType);

                if (compressedTokens <= remaining - 10) { // leave a small margin
                    this.budgetTracker.addItem(budget, compressed.label, compressed.content, compressed.priority, compressed.contentType);
                    compressed.estimatedTokens = compressedTokens;
                    includedItems.push(compressed);
                    compressionApplied = true;
                    this.log(`[ContextFeeder] Compressed "${item.label}": ${itemTokens} -> ${compressedTokens} tokens`);
                } else {
                    excludedItems.push(item);
                    this.log(`[ContextFeeder] Excluded "${item.label}": ${itemTokens} tokens (even compressed: ${compressedTokens}, budget: ${remaining})`);
                }
            } else {
                excludedItems.push(item);
                this.log(`[ContextFeeder] Excluded "${item.label}": ${itemTokens} tokens (budget: ${remaining})`);
            }
        }

        // 6. Build final LLM messages from included items
        const messages = this.buildMessagesFromItems(includedItems);

        return {
            messages,
            budget,
            includedItems,
            excludedItems,
            compressionApplied,
            totalItemsConsidered: contextItems.length + 2, // +2 for system prompt and user message
        };
    }

    // ================================================================
    // 5. Design-Aware Methods (v2.0)
    // ================================================================

    /**
     * Produce a compact tree representation of component hierarchy.
     * Format: `Page > Header [container] (0,0 1440x60) > Logo [image] ...`
     * Collapses branches with many children: `[12 children collapsed]`
     */
    summarizeComponentTree(components: DesignComponent[]): string {
        if (!components || components.length === 0) {
            return '[No components]';
        }

        // Build parent-child map
        const childrenMap = new Map<string | null, DesignComponent[]>();
        for (const comp of components) {
            const parentId = comp.parent_id;
            if (!childrenMap.has(parentId)) {
                childrenMap.set(parentId, []);
            }
            childrenMap.get(parentId)!.push(comp);
        }

        // Sort children by sort_order
        for (const [, children] of childrenMap) {
            children.sort((a, b) => a.sort_order - b.sort_order);
        }

        // Recursive tree builder
        const buildTree = (parentId: string | null, depth: number): string[] => {
            const children = childrenMap.get(parentId);
            if (!children || children.length === 0) { return []; }

            const lines: string[] = [];
            const indent = '  '.repeat(depth);

            if (children.length > MAX_VISIBLE_CHILDREN) {
                // Show first few and last, collapse the rest
                const showFirst = 3;
                const showLast = 1;
                const collapsed = children.length - showFirst - showLast;

                for (let i = 0; i < showFirst; i++) {
                    lines.push(...this.formatComponentLine(children[i], indent, childrenMap, depth));
                }
                lines.push(`${indent}[${collapsed} children collapsed]`);
                for (let i = children.length - showLast; i < children.length; i++) {
                    lines.push(...this.formatComponentLine(children[i], indent, childrenMap, depth));
                }
            } else {
                for (const child of children) {
                    lines.push(...this.formatComponentLine(child, indent, childrenMap, depth));
                }
            }

            return lines;
        };

        // Start from root components (parent_id === null)
        const treeLines = buildTree(null, 0);
        return treeLines.length > 0 ? treeLines.join('\n') : '[No root components]';
    }

    /**
     * Build design-aware context items for a specific page.
     * - Full info for active/visible components
     * - Summaries for siblings
     * - Name-only for distant components
     */
    buildDesignContext(
        pageId: string,
        components: DesignComponent[],
        budget: TokenBudget
    ): ContextItem[] {
        if (!components || components.length === 0) { return []; }

        const items: ContextItem[] = [];

        // Separate components into groups
        const pageComponents = components.filter(c => c.page_id === pageId);
        const otherComponents = components.filter(c => c.page_id !== pageId);

        // Full detail for page components
        if (pageComponents.length > 0) {
            const fullContent = pageComponents.map(c =>
                `${c.name} [${c.type}] (${c.x},${c.y} ${c.width}x${c.height})` +
                (c.content ? ` content="${c.content.slice(0, 80)}"` : '') +
                (c.parent_id ? ` parent=${c.parent_id}` : ' (root)')
            ).join('\n');

            const item: ContextItem = {
                id: `design-page-${pageId}`,
                label: `Page Components (${pageId})`,
                content: fullContent,
                contentType: ContentType.NaturalText,
                category: ContextCategory.DesignComponents,
                priority: ContextPriority.Important,
                relevanceScore: 80,
                estimatedTokens: this.budgetTracker.estimateTokens(fullContent, ContentType.NaturalText),
                metadata: {
                    sourceType: 'component',
                    sourceId: pageId,
                    createdAt: new Date().toISOString(),
                    isStale: false,
                    relatedTaskIds: [],
                    relatedFilePatterns: [],
                },
            };

            items.push(item);
        }

        // Summary for other pages' components (name-only)
        if (otherComponents.length > 0) {
            const remaining = this.budgetTracker.getRemaining(budget);
            // Only include if we have reasonable budget left
            if (remaining > 200) {
                const summaryContent = this.summarizeComponentTree(otherComponents);
                const item: ContextItem = {
                    id: 'design-other-pages',
                    label: 'Other Page Components (summary)',
                    content: summaryContent,
                    contentType: ContentType.NaturalText,
                    category: ContextCategory.DesignComponents,
                    priority: ContextPriority.Supplementary,
                    relevanceScore: 30,
                    estimatedTokens: this.budgetTracker.estimateTokens(summaryContent, ContentType.NaturalText),
                    metadata: {
                        sourceType: 'component',
                        sourceId: 'other-pages',
                        createdAt: new Date().toISOString(),
                        isStale: false,
                        relatedTaskIds: [],
                        relatedFilePatterns: [],
                    },
                };

                items.push(item);
            }
        }

        return items;
    }

    // ================================================================
    // Private Helpers
    // ================================================================

    /**
     * Build ContextItems from AgentContext fields.
     */
    private buildContextItems(context: AgentContext, additionalItems?: ContextItem[]): ContextItem[] {
        const items: ContextItem[] = [];
        const now = new Date().toISOString();

        // Current task
        if (context.task) {
            const taskContent = [
                `Task: ${context.task.title}`,
                `Description: ${context.task.description}`,
                `Priority: ${context.task.priority}`,
                `Status: ${context.task.status}`,
                `Acceptance Criteria: ${context.task.acceptance_criteria}`,
                context.task.files_modified.length > 0
                    ? `Files: ${context.task.files_modified.join(', ')}`
                    : '',
            ].filter(Boolean).join('\n');

            items.push({
                id: `task-${context.task.id}`,
                label: `Current Task: ${context.task.title}`,
                content: taskContent,
                contentType: ContentType.NaturalText,
                category: ContextCategory.CurrentTask,
                priority: ContextPriority.Mandatory,
                relevanceScore: 100, // will be recalculated
                estimatedTokens: 0, // will be calculated
                metadata: {
                    sourceType: 'task',
                    sourceId: context.task.id,
                    createdAt: context.task.created_at ?? now,
                    isStale: false,
                    relatedTaskIds: [context.task.id],
                    relatedFilePatterns: context.task.files_modified ?? [],
                },
            });
        }

        // Related ticket
        if (context.ticket) {
            const ticketContent = [
                `Ticket TK-${context.ticket.ticket_number}: ${context.ticket.title}`,
                `Status: ${context.ticket.status} | Priority: ${context.ticket.priority}`,
                `Body: ${context.ticket.body}`,
            ].join('\n');

            items.push({
                id: `ticket-${context.ticket.id}`,
                label: `Related Ticket: TK-${context.ticket.ticket_number}`,
                content: ticketContent,
                contentType: ContentType.NaturalText,
                category: ContextCategory.RelatedTicket,
                priority: ContextPriority.Important,
                relevanceScore: 0,
                estimatedTokens: 0,
                metadata: {
                    sourceType: 'ticket',
                    sourceId: context.ticket.id,
                    createdAt: context.ticket.created_at ?? now,
                    isStale: false,
                    relatedTaskIds: context.ticket.task_id ? [context.ticket.task_id] : [],
                    relatedFilePatterns: [],
                },
            });
        }

        // Active plan
        if (context.plan) {
            const planContent = [
                `Plan: ${context.plan.name}`,
                `Status: ${context.plan.status}`,
                `Config: ${context.plan.config_json}`,
            ].join('\n');

            items.push({
                id: `plan-${context.plan.id}`,
                label: `Active Plan: ${context.plan.name}`,
                content: planContent,
                contentType: ContentType.Mixed,
                category: ContextCategory.ActivePlan,
                priority: ContextPriority.Important,
                relevanceScore: 0,
                estimatedTokens: 0,
                metadata: {
                    sourceType: 'plan',
                    sourceId: context.plan.id,
                    createdAt: context.plan.created_at ?? now,
                    isStale: false,
                    relatedTaskIds: [],
                    relatedFilePatterns: [],
                },
            });
        }

        // Conversation history — split into recent (Tier 2) and older (Tier 4)
        if (context.conversationHistory && context.conversationHistory.length > 0) {
            const history = context.conversationHistory;
            const recentCutoff = Math.max(0, history.length - 10);
            const recentHistory = history.slice(recentCutoff);
            const olderHistory = history.slice(0, recentCutoff);

            if (recentHistory.length > 0) {
                const recentContent = recentHistory.map(c =>
                    `[${c.role}] ${c.content}`
                ).join('\n---\n');

                items.push({
                    id: 'history-recent',
                    label: `Recent History (${recentHistory.length} messages)`,
                    content: recentContent,
                    contentType: ContentType.NaturalText,
                    category: ContextCategory.RecentHistory,
                    priority: ContextPriority.Important,
                    relevanceScore: 0,
                    estimatedTokens: 0,
                    metadata: {
                        sourceType: 'history',
                        sourceId: 'recent',
                        createdAt: recentHistory[recentHistory.length - 1]?.created_at ?? now,
                        isStale: false,
                        relatedTaskIds: recentHistory
                            .map(c => c.task_id)
                            .filter((id): id is string => id !== null && id !== undefined),
                        relatedFilePatterns: [],
                    },
                });
            }

            if (olderHistory.length > 0) {
                const olderContent = olderHistory.map(c =>
                    `[${c.role}] ${c.content}`
                ).join('\n---\n');

                items.push({
                    id: 'history-older',
                    label: `Older History (${olderHistory.length} messages)`,
                    content: olderContent,
                    contentType: ContentType.NaturalText,
                    category: ContextCategory.OlderHistory,
                    priority: ContextPriority.Optional,
                    relevanceScore: 0,
                    estimatedTokens: 0,
                    metadata: {
                        sourceType: 'history',
                        sourceId: 'older',
                        createdAt: olderHistory[olderHistory.length - 1]?.created_at ?? now,
                        isStale: olderHistory.length > 20,
                        relatedTaskIds: olderHistory
                            .map(c => c.task_id)
                            .filter((id): id is string => id !== null && id !== undefined),
                        relatedFilePatterns: [],
                    },
                });
            }
        }

        // Additional context from AgentContext.additionalContext
        if (context.additionalContext) {
            for (const [key, value] of Object.entries(context.additionalContext)) {
                if (value === null || value === undefined) { continue; }
                const strValue = typeof value === 'string' ? value : JSON.stringify(value, null, 1);

                items.push({
                    id: `additional-${key}`,
                    label: `Additional: ${key}`,
                    content: strValue,
                    contentType: this.budgetTracker.detectContentType(strValue),
                    category: ContextCategory.Supplementary,
                    priority: ContextPriority.Supplementary,
                    relevanceScore: 0,
                    estimatedTokens: 0,
                    metadata: {
                        sourceType: 'custom',
                        sourceId: key,
                        createdAt: now,
                        isStale: false,
                        relatedTaskIds: [],
                        relatedFilePatterns: [],
                    },
                });
            }
        }

        // Merge in any additional items passed directly
        if (additionalItems && additionalItems.length > 0) {
            items.push(...additionalItems);
        }

        return items;
    }

    /**
     * Build a ContextItem for the system prompt.
     */
    private buildSystemPromptItem(systemPrompt: string): ContextItem {
        return {
            id: 'system-prompt',
            label: 'System Prompt',
            content: systemPrompt,
            contentType: ContentType.NaturalText,
            category: ContextCategory.SystemPrompt,
            priority: ContextPriority.Mandatory,
            relevanceScore: 100,
            estimatedTokens: this.budgetTracker.estimateTokens(systemPrompt, ContentType.NaturalText),
            metadata: {
                sourceType: 'custom',
                sourceId: 'system',
                createdAt: new Date().toISOString(),
                isStale: false,
                relatedTaskIds: [],
                relatedFilePatterns: [],
            },
        };
    }

    /**
     * Build a ContextItem for the user message.
     */
    private buildUserMessageItem(userMessage: string): ContextItem {
        return {
            id: 'user-message',
            label: 'User Message',
            content: userMessage,
            contentType: ContentType.NaturalText,
            category: ContextCategory.UserMessage,
            priority: ContextPriority.Mandatory,
            relevanceScore: 100,
            estimatedTokens: this.budgetTracker.estimateTokens(userMessage, ContentType.NaturalText),
            metadata: {
                sourceType: 'custom',
                sourceId: 'user',
                createdAt: new Date().toISOString(),
                isStale: false,
                relatedTaskIds: [],
                relatedFilePatterns: [],
            },
        };
    }

    /**
     * Convert included ContextItems into LLM message array.
     * System prompt first, then context as system messages, then user message last.
     */
    private buildMessagesFromItems(items: ContextItem[]): LLMMessage[] {
        const messages: LLMMessage[] = [];

        // System prompt
        const systemPromptItem = items.find(i => i.category === ContextCategory.SystemPrompt);
        if (systemPromptItem) {
            messages.push({ role: 'system', content: systemPromptItem.content });
        }

        // Context items (everything except system prompt and user message)
        const contextItems = items.filter(i =>
            i.category !== ContextCategory.SystemPrompt &&
            i.category !== ContextCategory.UserMessage
        );

        for (const item of contextItems) {
            // History items alternate between user/assistant roles
            if (item.category === ContextCategory.RecentHistory ||
                item.category === ContextCategory.OlderHistory) {
                // Pack history as a single system message for context
                messages.push({ role: 'system', content: `[Conversation History]\n${item.content}` });
            } else {
                messages.push({ role: 'system', content: `[${item.label}]\n${item.content}` });
            }
        }

        // User message last
        const userMessageItem = items.find(i => i.category === ContextCategory.UserMessage);
        if (userMessageItem) {
            messages.push({ role: 'user', content: userMessageItem.content });
        }

        return messages;
    }

    /**
     * Create a compressed copy of a ContextItem with new content.
     */
    private makeCompressedItem(original: ContextItem, compressedContent: string): ContextItem {
        return {
            ...original,
            content: compressedContent,
            estimatedTokens: this.budgetTracker.estimateTokens(compressedContent, original.contentType),
        };
    }

    /**
     * Extract meaningful words from text, removing stop words and short tokens.
     */
    private extractWordsInto(text: string | null | undefined, target: Set<string>): void {
        if (!text) { return; }

        const words = text
            .toLowerCase()
            .replace(/[^a-z0-9_\-./\\]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2 && !STOP_WORDS.has(w));

        for (const word of words) {
            target.add(word);
        }

        // Also extract camelCase/PascalCase parts
        const camelParts = text.match(/[A-Z]?[a-z]+/g);
        if (camelParts) {
            for (const part of camelParts) {
                const lower = part.toLowerCase();
                if (lower.length > 2 && !STOP_WORDS.has(lower)) {
                    target.add(lower);
                }
            }
        }
    }

    /**
     * Extract a "structural prefix" from a line for detecting repeated patterns.
     * E.g., "import { Foo } from './foo';" -> "import"
     * E.g., "  backgroundColor: '#fff'," -> "backgroundColor:"
     */
    private extractLinePrefix(line: string): string {
        if (!line) { return ''; }
        // Take everything up to the first variable-looking part
        const match = line.match(/^(\s*\w+[\s:({]*)/);
        return match ? match[1].trim() : '';
    }

    /**
     * Recursively abbreviate a JSON object:
     * - Remove null/undefined values
     * - Truncate strings longer than 50 characters
     * - Keep arrays but limit to first 5 elements
     */
    private abbreviateObject(obj: unknown): unknown {
        if (obj === null || obj === undefined) {
            return undefined;
        }

        if (typeof obj === 'string') {
            return obj.length > 50 ? obj.slice(0, 47) + '...' : obj;
        }

        if (typeof obj === 'number' || typeof obj === 'boolean') {
            return obj;
        }

        if (Array.isArray(obj)) {
            const abbreviated = obj.slice(0, 5).map(item => this.abbreviateObject(item));
            if (obj.length > 5) {
                abbreviated.push(`[+${obj.length - 5} more]` as unknown);
            }
            return abbreviated;
        }

        if (typeof obj === 'object') {
            const result: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(obj)) {
                if (value === null || value === undefined) { continue; }
                const abbreviated = this.abbreviateObject(value);
                if (abbreviated !== undefined) {
                    result[key] = abbreviated;
                }
            }
            return result;
        }

        return obj;
    }

    /**
     * Calculate recency bonus (0-10) based on creation timestamp.
     * Last hour: +10, last day: +5, last week: +2, older: 0
     */
    private calculateRecencyBonus(createdAt: string | null | undefined): number {
        if (!createdAt) { return 0; }

        try {
            const created = new Date(createdAt).getTime();
            if (isNaN(created)) { return 0; }

            const ageMs = Date.now() - created;
            if (ageMs < 0) { return 10; } // future date, treat as very recent

            const oneHour = 60 * 60 * 1000;
            const oneDay = 24 * oneHour;
            const oneWeek = 7 * oneDay;

            if (ageMs < oneHour) { return 10; }
            if (ageMs < oneDay) { return 5; }
            if (ageMs < oneWeek) { return 2; }
            return 0;
        } catch {
            return 0;
        }
    }

    /**
     * Calculate staleness penalty (0-15) based on age and explicit stale flag.
     */
    private calculateStalenessPenalty(
        createdAt: string | null | undefined,
        isStale: boolean | undefined
    ): number {
        let penalty = 0;

        // Explicit stale flag adds a flat penalty
        if (isStale) {
            penalty += 5;
        }

        if (!createdAt) { return penalty; }

        try {
            const created = new Date(createdAt).getTime();
            if (isNaN(created)) { return penalty; }

            const ageMs = Date.now() - created;
            if (ageMs > STALENESS_THRESHOLD_MS) {
                // 5-15 penalty based on how far past threshold
                const weeksOverThreshold = (ageMs - STALENESS_THRESHOLD_MS) / (7 * 24 * 60 * 60 * 1000);
                penalty += Math.min(10, Math.round(5 + weeksOverThreshold * 2));
            }
        } catch {
            // Invalid date — no additional penalty
        }

        return Math.min(15, penalty);
    }

    /**
     * Format a single component line for the tree summary.
     */
    private formatComponentLine(
        comp: DesignComponent,
        indent: string,
        childrenMap: Map<string | null, DesignComponent[]>,
        depth: number
    ): string[] {
        const lines: string[] = [];
        const posInfo = `(${comp.x},${comp.y} ${comp.width}x${comp.height})`;
        lines.push(`${indent}${comp.name} [${comp.type}] ${posInfo}`);

        // Recurse into children
        const childLines = this.buildSubTree(comp.id, childrenMap, depth + 1);
        lines.push(...childLines);

        return lines;
    }

    /**
     * Recursively build sub-tree lines for component summaries.
     */
    private buildSubTree(
        parentId: string,
        childrenMap: Map<string | null, DesignComponent[]>,
        depth: number
    ): string[] {
        const children = childrenMap.get(parentId);
        if (!children || children.length === 0) { return []; }

        const lines: string[] = [];
        const indent = '  '.repeat(depth);

        if (children.length > MAX_VISIBLE_CHILDREN) {
            const showFirst = 3;
            const showLast = 1;
            const collapsed = children.length - showFirst - showLast;

            for (let i = 0; i < showFirst; i++) {
                lines.push(...this.formatComponentLine(children[i], indent, childrenMap, depth));
            }
            lines.push(`${indent}[${collapsed} children collapsed]`);
            for (let i = children.length - showLast; i < children.length; i++) {
                lines.push(...this.formatComponentLine(children[i], indent, childrenMap, depth));
            }
        } else {
            for (const child of children) {
                lines.push(...this.formatComponentLine(child, indent, childrenMap, depth));
            }
        }

        return lines;
    }

    private log(message: string): void {
        this.outputChannel?.appendLine(message);
    }
}
