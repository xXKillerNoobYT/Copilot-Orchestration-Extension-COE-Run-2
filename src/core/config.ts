import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { COEConfig, LLMConfig } from '../types';

const DEFAULT_CONFIG: COEConfig = {
    version: '0.1.0',
    llm: {
        endpoint: 'http://192.168.1.205:1234/v1',
        model: 'mistralai/ministral-3-14b-reasoning',
        timeoutSeconds: 1800,
        startupTimeoutSeconds: 300,
        streamStallTimeoutSeconds: 60,
        maxTokens: 4000,
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
        orchestrator: { contextLimit: 5000, enabled: true },
        planning: { contextLimit: 5000, enabled: true },
        answer: { contextLimit: 5000, enabled: true },
        verification: { contextLimit: 4000, enabled: true },
        research: { contextLimit: 5000, enabled: true },
        clarity: { contextLimit: 4000, enabled: true },
        boss: { contextLimit: 5000, enabled: true },
        custom: { contextLimit: 4000, enabled: true },
    },
};

export class ConfigManager {
    private config!: COEConfig;
    private coeDir: string;
    private configPath: string;
    private watcher: fs.FSWatcher | null = null;
    private onChangeCallbacks: Array<(config: COEConfig) => void> = [];

    constructor(
        private context: vscode.ExtensionContext,
        private workspaceRoot: string | undefined
    ) {
        this.coeDir = workspaceRoot
            ? path.join(workspaceRoot, '.coe')
            : path.join(context.globalStorageUri.fsPath, '.coe');
        this.configPath = path.join(this.coeDir, 'config.json');
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
        };
    }

    private applyVSCodeSettings(): void {
        const vsConfig = vscode.workspace.getConfiguration('coe');

        const endpoint = vsConfig.get<string>('llm.endpoint');
        if (endpoint) this.config.llm.endpoint = endpoint;

        const model = vsConfig.get<string>('llm.model');
        if (model) this.config.llm.model = model;

        const timeout = vsConfig.get<number>('llm.timeoutSeconds');
        if (timeout) this.config.llm.timeoutSeconds = timeout;

        const startupTimeout = vsConfig.get<number>('llm.startupTimeoutSeconds');
        if (startupTimeout) this.config.llm.startupTimeoutSeconds = startupTimeout;

        const maxTokens = vsConfig.get<number>('llm.maxTokens');
        if (maxTokens) this.config.llm.maxTokens = maxTokens;

        const streamStall = vsConfig.get<number>('llm.streamStallTimeoutSeconds');
        if (streamStall) this.config.llm.streamStallTimeoutSeconds = streamStall;

        const maxPending = vsConfig.get<number>('taskQueue.maxPending');
        if (maxPending) this.config.taskQueue.maxPending = maxPending;

        const verDelay = vsConfig.get<number>('verification.delaySeconds');
        if (verDelay) this.config.verification.delaySeconds = verDelay;

        const debounce = vsConfig.get<number>('watcher.debounceMs');
        if (debounce) this.config.watcher.debounceMs = debounce;
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
        return this.config.agents[agentType]?.contextLimit || 4000;
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
