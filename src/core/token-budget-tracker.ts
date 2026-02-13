import {
    ModelProfile, ContentType, TokenBudget, TokenBudgetItem,
    TokenBudgetWarning, ContextPriority, AgentType, TokenBudgetConfig
} from '../types';

/**
 * Token Budget Tracker
 *
 * Replaces the crude `Math.ceil(text.length / 4)` estimation with
 * content-type-aware token estimation and budget management.
 *
 * Affects ALL AI processes: every BaseAgent.buildMessages() call,
 * every MCP tool response, every agent routing decision.
 *
 * Design principle: No external tokenizer dependency (avoids native module
 * issues documented in Known Patterns). Uses calibrated heuristics instead.
 */

// Default model profile for ministral-3-14b-reasoning (LM Studio)
const DEFAULT_MODEL_PROFILE: ModelProfile = {
    id: 'mistralai/ministral-3-14b-reasoning',
    name: 'Ministral 3 14B Reasoning',
    contextWindowTokens: 32768,
    maxOutputTokens: 4096,
    tokensPerChar: {
        [ContentType.Code]: 3.2,
        [ContentType.NaturalText]: 4.0,
        [ContentType.JSON]: 3.5,
        [ContentType.Markdown]: 3.8,
        [ContentType.Mixed]: 3.6,
    },
    overheadTokensPerMessage: 4,
};

const DEFAULT_BUDGET_CONFIG: TokenBudgetConfig = {
    warningThresholdPercent: 70,
    criticalThresholdPercent: 90,
    inputBufferPercent: 5,
};

interface UsageRecord {
    timestamp: number;
    inputTokensEstimated: number;
    outputTokensActual: number;
    agentType: string;
}

export class TokenBudgetTracker {
    private modelProfiles: Map<string, ModelProfile> = new Map();
    private warningCallbacks: Array<(warning: TokenBudgetWarning) => void> = [];
    private callHistory: UsageRecord[] = [];
    private currentModelId: string;
    private budgetConfig: TokenBudgetConfig;
    private outputChannel: { appendLine: (msg: string) => void } | null;

    constructor(
        currentModelId?: string,
        budgetConfig?: Partial<TokenBudgetConfig>,
        outputChannel?: { appendLine: (msg: string) => void }
    ) {
        this.currentModelId = currentModelId ?? DEFAULT_MODEL_PROFILE.id;
        this.budgetConfig = { ...DEFAULT_BUDGET_CONFIG, ...budgetConfig };
        this.outputChannel = outputChannel ?? null;

        // Register default model
        this.registerModel(DEFAULT_MODEL_PROFILE);
    }

    // --- Core Estimation ---

    /**
     * Estimate tokens for text with content-type-aware ratios.
     * More accurate than the flat chars/4 heuristic.
     */
    estimateTokens(text: string, contentType?: ContentType): number {
        if (!text || text.length === 0) return 0;

        const ct = contentType ?? this.detectContentType(text);
        const profile = this.getCurrentModelProfile();
        const charsPerToken = profile.tokensPerChar[ct] ?? 3.6;

        return Math.ceil(text.length / charsPerToken);
    }

    /**
     * Auto-detect content type from text characteristics.
     * Uses simple heuristics — no LLM calls.
     */
    detectContentType(text: string): ContentType {
        if (!text || text.length === 0) return ContentType.Mixed;

        // Sample first 1000 chars for detection
        const sample = text.slice(0, 1000);

        // JSON detection: starts with { or [ and has key-value patterns
        if (/^\s*[\[{]/.test(sample) && /"[^"]*"\s*:/.test(sample)) {
            return ContentType.JSON;
        }

        // Code detection: has common code patterns
        const codeSignals = [
            /\bfunction\b/, /\bconst\b/, /\blet\b/, /\bvar\b/,
            /\bclass\b/, /\bimport\b/, /\bexport\b/, /\breturn\b/,
            /\bif\s*\(/, /\bfor\s*\(/, /\bwhile\s*\(/,
            /=>\s*{/, /\{\s*\n/, /;\s*\n/,
            /\/\/\s/, /\/\*/, /\*\//,
        ];
        const codeScore = codeSignals.filter(r => r.test(sample)).length;

        // Markdown detection: has headings, lists, links
        const mdSignals = [
            /^#{1,6}\s/m, /^\s*[-*+]\s/m, /\[.*\]\(.*\)/,
            /^\s*>\s/m, /```/, /\*\*.*\*\*/,
        ];
        const mdScore = mdSignals.filter(r => r.test(sample)).length;

        if (codeScore >= 3) return ContentType.Code;
        if (mdScore >= 2) return ContentType.Markdown;

        // Natural text: primarily words separated by spaces
        const wordRatio = (sample.match(/\b[a-zA-Z]+\b/g) || []).length / Math.max(sample.split(/\s+/).length, 1);
        if (wordRatio > 0.7) return ContentType.NaturalText;

        return ContentType.Mixed;
    }

    // --- Budget Management ---

    /**
     * Create a new budget for an upcoming LLM call.
     * This is the starting point — call addItem() to consume budget.
     */
    createBudget(agentType?: AgentType | string, maxOutputTokens?: number): TokenBudget {
        const profile = this.getCurrentModelProfile();
        const reservedOutput = maxOutputTokens ?? profile.maxOutputTokens;

        // Apply safety buffer
        const bufferFraction = this.budgetConfig.inputBufferPercent / 100;
        const totalAvailable = profile.contextWindowTokens - reservedOutput;
        const buffered = Math.floor(totalAvailable * (1 - bufferFraction));

        const budget: TokenBudget = {
            modelProfile: profile,
            totalContextWindow: profile.contextWindowTokens,
            reservedForOutput: reservedOutput,
            availableForInput: buffered,
            consumed: 0,
            remaining: buffered,
            warningLevel: 'ok',
            items: [],
        };

        this.log(`[TokenBudget] Created for ${agentType ?? 'unknown'}: ${buffered} input tokens available (${profile.contextWindowTokens} window - ${reservedOutput} output - ${Math.floor(totalAvailable * bufferFraction)} buffer)`);

        return budget;
    }

    /**
     * Add an item to the budget and update consumption.
     * Returns the item with its token estimate.
     */
    addItem(
        budget: TokenBudget,
        label: string,
        content: string,
        priority: ContextPriority,
        contentType?: ContentType
    ): TokenBudgetItem {
        const ct = contentType ?? this.detectContentType(content);
        const tokens = this.estimateTokens(content, ct) + budget.modelProfile.overheadTokensPerMessage;
        const fits = tokens <= budget.remaining;

        const item: TokenBudgetItem = {
            label,
            contentType: ct,
            charCount: content.length,
            estimatedTokens: tokens,
            priority,
            included: fits,
        };

        budget.items.push(item);

        if (fits) {
            budget.consumed += tokens;
            budget.remaining -= tokens;
            this.updateWarningLevel(budget);
        } else {
            this.log(`[TokenBudget] Item "${label}" skipped: needs ${tokens} tokens, only ${budget.remaining} remaining`);
        }

        // Check for warnings
        const warning = this.checkWarnings(budget);
        if (warning) {
            this.warningCallbacks.forEach(cb => cb(warning));
        }

        return item;
    }

    /**
     * Check if budget can accommodate additional content.
     */
    canFit(budget: TokenBudget, content: string, contentType?: ContentType): boolean {
        const ct = contentType ?? this.detectContentType(content);
        const tokens = this.estimateTokens(content, ct) + budget.modelProfile.overheadTokensPerMessage;
        return tokens <= budget.remaining;
    }

    /**
     * Get remaining capacity in tokens.
     */
    getRemaining(budget: TokenBudget): number {
        return budget.remaining;
    }

    /**
     * Check warning levels and return a warning if thresholds are crossed.
     */
    checkWarnings(budget: TokenBudget): TokenBudgetWarning | null {
        const usedPercent = (budget.consumed / budget.availableForInput) * 100;

        if (usedPercent >= this.budgetConfig.criticalThresholdPercent) {
            return {
                level: 'critical',
                message: `Input token budget at ${Math.round(usedPercent)}% — context breaking chain may be needed`,
                budgetUsedPercent: usedPercent,
                remainingTokens: budget.remaining,
                suggestion: 'Apply context compression or reduce context items',
            };
        }

        if (usedPercent >= this.budgetConfig.warningThresholdPercent) {
            return {
                level: 'warning',
                message: `Input token budget at ${Math.round(usedPercent)}% — approaching limit`,
                budgetUsedPercent: usedPercent,
                remainingTokens: budget.remaining,
                suggestion: 'Consider reducing supplementary context',
            };
        }

        return null;
    }

    // --- Model Profiles ---

    /**
     * Register a model profile with its context window and token ratios.
     */
    registerModel(profile: ModelProfile): void {
        this.modelProfiles.set(profile.id, profile);
        this.log(`[TokenBudget] Model registered: ${profile.name} (${profile.contextWindowTokens} context window)`);
    }

    /**
     * Get profile for current model.
     */
    getCurrentModelProfile(): ModelProfile {
        return this.modelProfiles.get(this.currentModelId) ?? DEFAULT_MODEL_PROFILE;
    }

    /**
     * Switch to a different model.
     */
    setCurrentModel(modelId: string): void {
        if (!this.modelProfiles.has(modelId)) {
            this.log(`[TokenBudget] Warning: model ${modelId} not registered, using default`);
        }
        this.currentModelId = modelId;
    }

    // --- Tracking ---

    /**
     * Record actual token usage after an LLM call completes.
     * Useful for calibrating estimation accuracy over time.
     */
    recordUsage(inputTokensEstimated: number, outputTokensActual: number, agentType: string): void {
        this.callHistory.push({
            timestamp: Date.now(),
            inputTokensEstimated,
            outputTokensActual,
            agentType,
        });

        // Keep last 500 records
        if (this.callHistory.length > 500) {
            this.callHistory = this.callHistory.slice(-500);
        }
    }

    /**
     * Get cumulative usage stats.
     */
    getUsageStats(): {
        totalInputEstimated: number;
        totalOutputActual: number;
        callCount: number;
        avgInputPerCall: number;
        avgOutputPerCall: number;
    } {
        const total = this.callHistory.reduce(
            (acc, r) => ({
                input: acc.input + r.inputTokensEstimated,
                output: acc.output + r.outputTokensActual,
            }),
            { input: 0, output: 0 }
        );
        const count = this.callHistory.length;
        return {
            totalInputEstimated: total.input,
            totalOutputActual: total.output,
            callCount: count,
            avgInputPerCall: count > 0 ? Math.round(total.input / count) : 0,
            avgOutputPerCall: count > 0 ? Math.round(total.output / count) : 0,
        };
    }

    /**
     * Get usage breakdown by agent type.
     */
    getUsageByAgent(): Record<string, { calls: number; inputTokens: number; outputTokens: number }> {
        const byAgent: Record<string, { calls: number; inputTokens: number; outputTokens: number }> = {};
        for (const record of this.callHistory) {
            if (!byAgent[record.agentType]) {
                byAgent[record.agentType] = { calls: 0, inputTokens: 0, outputTokens: 0 };
            }
            byAgent[record.agentType].calls++;
            byAgent[record.agentType].inputTokens += record.inputTokensEstimated;
            byAgent[record.agentType].outputTokens += record.outputTokensActual;
        }
        return byAgent;
    }

    // --- Warning System ---

    /**
     * Register a callback for budget warnings.
     */
    onWarning(callback: (warning: TokenBudgetWarning) => void): void {
        this.warningCallbacks.push(callback);
    }

    // --- Internal Helpers ---

    private updateWarningLevel(budget: TokenBudget): void {
        const usedPercent = (budget.consumed / budget.availableForInput) * 100;

        if (usedPercent >= 100) {
            budget.warningLevel = 'exceeded';
        } else if (usedPercent >= this.budgetConfig.criticalThresholdPercent) {
            budget.warningLevel = 'critical';
        } else if (usedPercent >= this.budgetConfig.warningThresholdPercent) {
            budget.warningLevel = 'warning';
        } else {
            budget.warningLevel = 'ok';
        }
    }

    private log(message: string): void {
        this.outputChannel?.appendLine(message);
    }
}
