import * as fs from 'fs';
import * as path from 'path';
import { COEConfig, LLMConfig, ExtensionContextLike } from '../types';

const DEFAULT_CONFIG: COEConfig = {
    version: '1.0.0',
    llm: {
        endpoint: 'http://192.168.1.205:1234/v1',
        model: 'mistralai/ministral-3-14b-reasoning',
        timeoutSeconds: 7200,             // 2 hours total wall-clock — must exceed thinkingTimeout + content generation
        startupTimeoutSeconds: 900,       // 15 min — model loading (cold start, large models)
        streamStallTimeoutSeconds: 180,   // 3 min — gap between content tokens (NOT thinking tokens)
        thinkingTimeoutSeconds: 5400,     // 90 min — reasoning/thinking phase with no output. NOT included in ticket estimates.
        maxTokens: 4096,                  // Model output limit — must match models[].maxOutputTokens
        maxInputTokens: 24000,            // 32K context - 4K output - buffer = ~24K usable input
        maxConcurrentRequests: 4,   // v6.0: LM Studio can handle 4 simultaneous threads
        bossReservedSlots: 1,       // v6.0: 1 slot always reserved for Boss AI
        maxRequestRetries: 5,       // v6.0: retry failed LLM requests up to 5 times
    },
    taskQueue: {
        maxPending: 20,
    },
    verification: {
        delaySeconds: 60,
        coverageThreshold: 85,
    },
    watcher: {
        debounceMs: 500,
    },
    agents: {
        orchestrator: { contextLimit: 25000, enabled: true },
        planning: { contextLimit: 25000, enabled: true },
        answer: { contextLimit: 25000, enabled: true },
        verification: { contextLimit: 25000, enabled: true },
        research: { contextLimit: 25000, enabled: true },
        clarity: { contextLimit: 25000, enabled: true },
        boss: { contextLimit: 25000, enabled: true },
        custom: { contextLimit: 25000, enabled: true },
        review: { contextLimit: 25000, enabled: true },
    },
    // Model profiles: context windows and output limits for token budget management
    // This tells the token budget system the limits of each LLM you might use.
    // - contextWindowTokens: total context the model can handle (input + output)
    // - maxOutputTokens: max tokens the model can generate per response
    // If you add a second model (vision, larger reasoning, etc.), add another entry here.
    models: {
        'mistralai/ministral-3-14b-reasoning': {
            contextWindowTokens: 32768,
            maxOutputTokens: 4096,
        },
    },
    // Token budget thresholds for input context management
    tokenBudget: {
        warningThresholdPercent: 70,
        criticalThresholdPercent: 90,
        inputBufferPercent: 5,
    },
    // Design QA (v4.0)
    designQaScoreThreshold: 80,
    // Ticket processing (v4.0)
    maxActiveTickets: 10,
    maxTicketRetries: 3,
    maxClarificationRounds: 5,
    // Boss AI (v4.0)
    bossIdleTimeoutMinutes: 5,
    bossStuckPhaseMinutes: 30,
    bossTaskOverloadThreshold: 20,
    bossEscalationThreshold: 5,
    // Clarity Agent (v4.0)
    clarityAutoResolveScore: 85,
    clarityClarificationScore: 70,
    // v5.0: AI mode and auto-run
    aiMode: 'hybrid' as const,
    bossAutoRunEnabled: true,
    // v6.0/v10.0: Parallel processing and multi-model
    // v10.0: 3 ticket processing slots + 1 Boss/Orchestrator reserved slot = 4 total LLM channels
    // When Boss slot is idle, it can pre-stage the next queued ticket
    bossParallelBatchSize: 3,        // max 3 tickets processed concurrently (Boss uses LLM reserved slot separately)
    modelHoldTimeoutMs: 3600000,     // 1 hour hold timeout for model swap
    maxModelsPerCycle: 2,            // max 2 different models per boss cycle (prevent excessive swapping)
    multiModelEnabled: false,        // default: single model mode (one LLM loaded at a time)
    // v7.0/v10.0: Team queue orchestration — with slot borrowing
    // When a category has 0 pending tickets, its slots are automatically lent to busy categories
    teamSlotAllocation: {            // Boss-controlled slot allocation per team (total = bossParallelBatchSize)
        orchestrator: 1,
        planning: 1,
        verification: 1,
        coding_director: 0,         // Coding Director starts with 0 — Boss allocates when coding work arrives
    },
    cancelledTicketReviewIntervalMs: 1800000,   // 30 minutes — Boss reviews cancelled tickets for re-engagement
    maxSupportAgentSyncTimeoutMs: 60000,        // 60 seconds — max time for sync support agent call
    // v9.0: Agent Hierarchy, Workflow Designer, User Communication
    maxAgentTreeDepth: 10,                       // Full 10-level tree for all plans
    defaultMaxFanout: 5,                         // Max children per tree node
    mcpConfirmationRequired: true,               // Require confirmation before calling agents via MCP
    mcpConfirmationTimeoutMs: 60000,             // 60 seconds before MCP confirmation expires
    userProgrammingLevel: 'good',                // Default user programming level
    workflowDesignerEnabled: true,               // Workflow Designer enabled by default
    userCommInterceptAll: true,                  // ALL messages go through UserCommAgent
    defaultTreeTemplate: 'standard',             // Default tree template for new plans
};

export class ConfigManager {
    private config!: COEConfig;
    private coeDir: string;
    private configPath: string;
    private watcher: fs.FSWatcher | null = null;
    private onChangeCallbacks: Array<(config: COEConfig) => void> = [];

    constructor(
        private context: ExtensionContextLike | null,
        private workspaceRoot: string | undefined
    ) {
        this.coeDir = workspaceRoot
            ? path.join(workspaceRoot, '.coe')
            : this.context
                ? path.join(this.context.globalStorageUri.fsPath, '.coe')
                : path.join(process.cwd(), '.coe');
        this.configPath = path.join(this.coeDir, 'config.json');
    }

    /**
     * Create a ConfigManager for standalone (non-VS Code) operation.
     * Uses the given project directory as the workspace root.
     * No VS Code settings overrides are applied.
     */
    static createStandalone(projectDir: string): ConfigManager {
        return new ConfigManager(null, projectDir);
    }

    async initialize(): Promise<void> {
        // Ensure .coe directory exists
        if (!fs.existsSync(this.coeDir)) {
            fs.mkdirSync(this.coeDir, { recursive: true });
        }

        // Ensure subdirectories exist
        const subdirs = ['offline-cache', 'processed', 'agents', 'agents/custom'];
        for (const sub of subdirs) {
            const dir = path.join(this.coeDir, sub);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }

        // Load or create config
        if (fs.existsSync(this.configPath)) {
            try {
                const raw = fs.readFileSync(this.configPath, 'utf-8');
                const loaded = JSON.parse(raw);
                this.config = this.mergeWithDefaults(loaded);
            } catch {
                this.config = { ...DEFAULT_CONFIG };
                this.saveConfig();
            }
        } else {
            this.config = { ...DEFAULT_CONFIG };
            this.saveConfig();
        }

        // Merge VS Code settings overrides
        this.applyVSCodeSettings();

        // Watch for config file changes
        this.startWatching();
    }

    private mergeWithDefaults(loaded: Partial<COEConfig>): COEConfig {
        return {
            version: loaded.version || DEFAULT_CONFIG.version,
            llm: { ...DEFAULT_CONFIG.llm, ...loaded.llm },
            taskQueue: { ...DEFAULT_CONFIG.taskQueue, ...loaded.taskQueue },
            verification: { ...DEFAULT_CONFIG.verification, ...loaded.verification },
            watcher: { ...DEFAULT_CONFIG.watcher, ...loaded.watcher },
            agents: { ...DEFAULT_CONFIG.agents, ...loaded.agents },
            github: loaded.github,
            models: { ...(DEFAULT_CONFIG.models ?? {}), ...(loaded.models ?? {}) },
            tokenBudget: {
                warningThresholdPercent: loaded.tokenBudget?.warningThresholdPercent ?? DEFAULT_CONFIG.tokenBudget!.warningThresholdPercent,
                criticalThresholdPercent: loaded.tokenBudget?.criticalThresholdPercent ?? DEFAULT_CONFIG.tokenBudget!.criticalThresholdPercent,
                inputBufferPercent: loaded.tokenBudget?.inputBufferPercent ?? DEFAULT_CONFIG.tokenBudget!.inputBufferPercent,
            },
            // v4.0 thresholds
            designQaScoreThreshold: loaded.designQaScoreThreshold ?? DEFAULT_CONFIG.designQaScoreThreshold,
            maxActiveTickets: loaded.maxActiveTickets ?? DEFAULT_CONFIG.maxActiveTickets,
            maxTicketRetries: loaded.maxTicketRetries ?? DEFAULT_CONFIG.maxTicketRetries,
            maxClarificationRounds: loaded.maxClarificationRounds ?? DEFAULT_CONFIG.maxClarificationRounds,
            bossIdleTimeoutMinutes: loaded.bossIdleTimeoutMinutes ?? DEFAULT_CONFIG.bossIdleTimeoutMinutes,
            bossStuckPhaseMinutes: loaded.bossStuckPhaseMinutes ?? DEFAULT_CONFIG.bossStuckPhaseMinutes,
            bossTaskOverloadThreshold: loaded.bossTaskOverloadThreshold ?? DEFAULT_CONFIG.bossTaskOverloadThreshold,
            bossEscalationThreshold: loaded.bossEscalationThreshold ?? DEFAULT_CONFIG.bossEscalationThreshold,
            clarityAutoResolveScore: loaded.clarityAutoResolveScore ?? DEFAULT_CONFIG.clarityAutoResolveScore,
            clarityClarificationScore: loaded.clarityClarificationScore ?? DEFAULT_CONFIG.clarityClarificationScore,
            // v5.0: AI mode and auto-run
            aiMode: loaded.aiMode ?? DEFAULT_CONFIG.aiMode,
            bossAutoRunEnabled: loaded.bossAutoRunEnabled ?? DEFAULT_CONFIG.bossAutoRunEnabled,
            // v6.0: Parallel processing and multi-model
            bossParallelBatchSize: loaded.bossParallelBatchSize ?? DEFAULT_CONFIG.bossParallelBatchSize,
            agentModels: loaded.agentModels,
            modelHoldTimeoutMs: loaded.modelHoldTimeoutMs ?? DEFAULT_CONFIG.modelHoldTimeoutMs,
            activeModel: loaded.activeModel,
            maxModelsPerCycle: loaded.maxModelsPerCycle ?? DEFAULT_CONFIG.maxModelsPerCycle,
            multiModelEnabled: loaded.multiModelEnabled ?? DEFAULT_CONFIG.multiModelEnabled,
            // v7.0: Team queue orchestration
            teamSlotAllocation: loaded.teamSlotAllocation ?? DEFAULT_CONFIG.teamSlotAllocation,
            cancelledTicketReviewIntervalMs: loaded.cancelledTicketReviewIntervalMs ?? DEFAULT_CONFIG.cancelledTicketReviewIntervalMs,
            maxSupportAgentSyncTimeoutMs: loaded.maxSupportAgentSyncTimeoutMs ?? DEFAULT_CONFIG.maxSupportAgentSyncTimeoutMs,
            // v9.0: Agent Hierarchy, Workflow Designer, User Communication
            maxAgentTreeDepth: loaded.maxAgentTreeDepth ?? DEFAULT_CONFIG.maxAgentTreeDepth,
            defaultMaxFanout: loaded.defaultMaxFanout ?? DEFAULT_CONFIG.defaultMaxFanout,
            mcpConfirmationRequired: loaded.mcpConfirmationRequired ?? DEFAULT_CONFIG.mcpConfirmationRequired,
            mcpConfirmationTimeoutMs: loaded.mcpConfirmationTimeoutMs ?? DEFAULT_CONFIG.mcpConfirmationTimeoutMs,
            userProgrammingLevel: loaded.userProgrammingLevel ?? DEFAULT_CONFIG.userProgrammingLevel,
            workflowDesignerEnabled: loaded.workflowDesignerEnabled ?? DEFAULT_CONFIG.workflowDesignerEnabled,
            userCommInterceptAll: loaded.userCommInterceptAll ?? DEFAULT_CONFIG.userCommInterceptAll,
            agentModelAssignments: loaded.agentModelAssignments,
            defaultTreeTemplate: loaded.defaultTreeTemplate ?? DEFAULT_CONFIG.defaultTreeTemplate,
        };
    }

    /**
     * Apply VS Code settings overrides — ONLY if the user has explicitly set them.
     *
     * Uses inspect() instead of get() to distinguish between:
     * - User-set values (globalValue, workspaceValue, workspaceFolderValue) → override config
     * - Package.json defaults (defaultValue) → DO NOT override config
     *
     * This ensures that changes made via the webapp Settings page persist across
     * reloads, while still allowing VS Code settings to take priority when
     * the user explicitly configures them in settings.json.
     */
    private applyVSCodeSettings(): void {
        // In standalone mode (no VS Code), skip settings overrides
        let vsConfig: any;
        try {
            // Dynamic require — only available when running inside VS Code
            const vscode = require('vscode');
            vsConfig = vscode.workspace.getConfiguration('coe');
        } catch {
            return; // Not running in VS Code — config.json is the sole source of truth
        }

        // Helper: returns the user-set value (if any), or undefined if only the default is present
        const getUserSet = <T>(key: string): T | undefined => {
            const inspection: any = vsConfig.inspect(key);
            if (!inspection) return undefined;
            // Priority: workspaceFolder > workspace > global. Skip defaultValue.
            return (inspection.workspaceFolderValue ?? inspection.workspaceValue ?? inspection.globalValue) as T | undefined;
        };

        const endpoint = getUserSet<string>('llm.endpoint');
        if (endpoint) this.config.llm.endpoint = endpoint;

        const model = getUserSet<string>('llm.model');
        if (model) this.config.llm.model = model;

        const timeout = getUserSet<number>('llm.timeoutSeconds');
        if (timeout != null) this.config.llm.timeoutSeconds = timeout;

        const startupTimeout = getUserSet<number>('llm.startupTimeoutSeconds');
        if (startupTimeout != null) this.config.llm.startupTimeoutSeconds = startupTimeout;

        const maxTokens = getUserSet<number>('llm.maxTokens');
        if (maxTokens != null) this.config.llm.maxTokens = maxTokens;

        const maxInputTokens = getUserSet<number>('llm.maxInputTokens');
        if (maxInputTokens != null) this.config.llm.maxInputTokens = maxInputTokens;

        const streamStall = getUserSet<number>('llm.streamStallTimeoutSeconds');
        if (streamStall != null) this.config.llm.streamStallTimeoutSeconds = streamStall;

        const thinkingTimeout = getUserSet<number>('llm.thinkingTimeoutSeconds');
        if (thinkingTimeout != null) this.config.llm.thinkingTimeoutSeconds = thinkingTimeout;

        const maxPending = getUserSet<number>('taskQueue.maxPending');
        if (maxPending != null) this.config.taskQueue.maxPending = maxPending;

        const verDelay = getUserSet<number>('verification.delaySeconds');
        if (verDelay != null) this.config.verification.delaySeconds = verDelay;

        const debounce = getUserSet<number>('watcher.debounceMs');
        if (debounce != null) this.config.watcher.debounceMs = debounce;
    }

    private startWatching(): void {
        if (this.watcher) return;
        try {
            this.watcher = fs.watch(this.configPath, () => {
                try {
                    const raw = fs.readFileSync(this.configPath, 'utf-8');
                    const loaded = JSON.parse(raw);
                    this.config = this.mergeWithDefaults(loaded);
                    this.applyVSCodeSettings();
                    this.onChangeCallbacks.forEach(cb => cb(this.config));
                } catch {
                    // Ignore parse errors on intermediate saves
                }
            });
        } catch {
            // File may not exist yet
        }
    }

    private saveConfig(): void {
        fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    }

    getConfig(): COEConfig {
        return this.config;
    }

    getLLMConfig(): LLMConfig {
        return this.config.llm;
    }

    getCOEDir(): string {
        return this.coeDir;
    }

    getAgentContextLimit(agentType: string): number {
        return this.config.agents[agentType]?.contextLimit ?? 4000;
    }

    /**
     * Get the max output tokens for the currently configured model.
     * Falls back to LLM config maxTokens if model profile isn't defined.
     * This should be used as `max_tokens` in API calls to match the model's real output limit.
     */
    getModelMaxOutputTokens(): number {
        const model = this.config.llm.model;
        const profile = this.config.models?.[model];
        return profile?.maxOutputTokens ?? this.config.llm.maxTokens;
    }

    /**
     * Get the total context window size for the currently configured model.
     * Falls back to 32768 if model profile isn't defined.
     */
    getModelContextWindow(): number {
        const model = this.config.llm.model;
        const profile = this.config.models?.[model];
        return profile?.contextWindowTokens ?? 32768;
    }

    isAgentEnabled(agentType: string): boolean {
        return this.config.agents[agentType]?.enabled !== false;
    }

    updateConfig(updates: Partial<COEConfig>): void {
        this.config = this.mergeWithDefaults({ ...this.config, ...updates });
        this.saveConfig();
        this.onChangeCallbacks.forEach(cb => cb(this.config));
    }

    onChange(callback: (config: COEConfig) => void): void {
        this.onChangeCallbacks.push(callback);
    }

    dispose(): void {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        this.onChangeCallbacks = [];
    }
}
