import * as vscode from 'vscode';
import { Database } from './core/database';
import { ConfigManager } from './core/config';
import { LLMService } from './core/llm-service';
import { Orchestrator } from './agents/orchestrator';
import { MCPServer } from './mcp/server';
import { StatusViewProvider } from './views/status-view';
import { registerCommands } from './commands';
import { FileWatcherService } from './core/file-watcher';
import { TestRunnerService } from './core/test-runner';
import { EvolutionService } from './core/evolution-service';
import { TokenBudgetTracker } from './core/token-budget-tracker';
import { ContextFeeder } from './core/context-feeder';
import { TaskDecompositionEngine } from './core/task-decomposition-engine';
import { ContextBreakingChain } from './core/context-breaking-chain';
import { ContentType } from './types';
// v2.0 services
import { TransparencyLogger } from './core/transparency-logger';
import { EthicsEngine } from './core/ethics-engine';
import { ComponentSchemaService } from './core/component-schema';
import { CodingAgentService } from './core/coding-agent';
import { ConflictResolver } from './core/conflict-resolver';
import { SyncService } from './core/sync-service';
import { getEventBus } from './core/event-bus';

let database: Database;
let configManager: ConfigManager;
let llmService: LLMService;
let orchestrator: Orchestrator;
let mcpServer: MCPServer;
let fileWatcher: FileWatcherService;
let syncService: SyncService;

export async function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('COE');
    outputChannel.appendLine('Copilot Orchestration Extension activating...');

    try {
        // Phase 1: Initialize core services
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            vscode.window.showWarningMessage('COE: No workspace folder open. Some features will be limited.');
        }

        configManager = new ConfigManager(context, workspaceRoot);
        await configManager.initialize();

        database = new Database(configManager.getCOEDir());
        await database.initialize();

        llmService = new LLMService(configManager.getLLMConfig(), outputChannel);

        // Phase 2: Initialize agent framework
        orchestrator = new Orchestrator(database, llmService, configManager, outputChannel);
        await orchestrator.initialize();

        // Phase 2b: Wire test runner into verification agent
        if (workspaceRoot) {
            const testRunner = new TestRunnerService(workspaceRoot, outputChannel);
            orchestrator.getVerificationAgent().setTestRunner(testRunner);
            outputChannel.appendLine('TestRunnerService wired into Verification Agent.');
        }

        // Phase 2c: Wire evolution service into orchestrator
        const evolutionService = new EvolutionService(database, configManager, llmService, outputChannel);
        orchestrator.setEvolutionService(evolutionService);
        outputChannel.appendLine('EvolutionService wired into Orchestrator.');

        // Phase 2d: Wire token management services into all agents
        const coeConfig = configManager.getConfig();
        const budgetTracker = new TokenBudgetTracker(
            coeConfig.llm.model,
            coeConfig.tokenBudget,
            outputChannel
        );

        // Register any additional model profiles from config
        if (coeConfig.models) {
            for (const [modelId, modelConfig] of Object.entries(coeConfig.models)) {
                if (modelId !== coeConfig.llm.model) {
                    // The default model was already registered by the constructor
                    budgetTracker.registerModel({
                        id: modelId,
                        name: modelId,
                        contextWindowTokens: modelConfig.contextWindowTokens,
                        maxOutputTokens: modelConfig.maxOutputTokens,
                        tokensPerChar: {
                            [ContentType.Code]: 3.2,
                            [ContentType.NaturalText]: 4.0,
                            [ContentType.JSON]: 3.5,
                            [ContentType.Markdown]: 3.8,
                            [ContentType.Mixed]: 3.6,
                        },
                        overheadTokensPerMessage: 4,
                    });
                }
            }
        }

        const contextFeeder = new ContextFeeder(budgetTracker, outputChannel);
        const decompositionEngine = new TaskDecompositionEngine(outputChannel);
        const contextBreakingChain = new ContextBreakingChain(budgetTracker, outputChannel);

        // Inject into all agents
        orchestrator.injectContextServices(budgetTracker, contextFeeder);
        orchestrator.injectDecompositionEngine(decompositionEngine);

        // Wire budget warning callbacks
        budgetTracker.onWarning((warning) => {
            outputChannel.appendLine(`[TokenBudget] ${warning.level.toUpperCase()}: ${warning.message}`);
            if (warning.level === 'critical') {
                outputChannel.appendLine(`[TokenBudget] Suggestion: ${warning.suggestion}`);
            }
        });

        outputChannel.appendLine(
            `Token management services initialized: ` +
            `model=${coeConfig.llm.model}, ` +
            `context=${budgetTracker.getCurrentModelProfile().contextWindowTokens} tokens, ` +
            `thresholds=${coeConfig.tokenBudget?.warningThresholdPercent ?? 70}%/${coeConfig.tokenBudget?.criticalThresholdPercent ?? 90}%`
        );

        // Phase 2e: Initialize v2.0 services
        const eventBus = getEventBus();

        const transparencyLogger = new TransparencyLogger(database, eventBus, outputChannel);
        outputChannel.appendLine('TransparencyLogger initialized.');

        const ethicsEngine = new EthicsEngine(database, eventBus, transparencyLogger, outputChannel);
        ethicsEngine.seedDefaultModules();
        outputChannel.appendLine('EthicsEngine (FreedomGuard_AI) initialized with default modules.');

        const componentSchemaService = new ComponentSchemaService(database, outputChannel);
        componentSchemaService.seedDefaultSchemas();
        outputChannel.appendLine('ComponentSchemaService initialized with 37 default schemas.');

        const codingAgentService = new CodingAgentService(
            llmService, database, ethicsEngine, componentSchemaService,
            eventBus, transparencyLogger, outputChannel
        );
        outputChannel.appendLine('CodingAgentService initialized.');

        const conflictResolver = new ConflictResolver(database, eventBus, outputChannel);
        outputChannel.appendLine('ConflictResolver initialized.');

        syncService = new SyncService(database, eventBus, conflictResolver, transparencyLogger, outputChannel);
        outputChannel.appendLine('SyncService initialized.');

        // Auto-configure sync if settings present
        const syncConfig = coeConfig.sync;
        if (syncConfig?.enabled) {
            try {
                await syncService.configure({
                    device_id: require('os').hostname(),
                    backend: syncConfig.backend as any,
                    endpoint: syncConfig.endpoint,
                    enabled: true,
                    auto_sync_interval_seconds: syncConfig.autoSyncIntervalSeconds,
                });
                if (syncConfig.autoSyncIntervalSeconds > 0) {
                    syncService.startAutoSync(syncConfig.autoSyncIntervalSeconds);
                }
                outputChannel.appendLine(`SyncService auto-configured: ${syncConfig.backend} backend.`);
            } catch (err) {
                outputChannel.appendLine(`SyncService auto-config failed: ${err}`);
            }
        }

        // Phase 3: Initialize MCP server
        mcpServer = new MCPServer(orchestrator, database, configManager, outputChannel, codingAgentService);
        await mcpServer.initialize();

        // Phase 4: Initialize UI — single status view (full app opens in browser)
        const statusView = new StatusViewProvider(database, mcpServer);

        context.subscriptions.push(
            vscode.window.registerTreeDataProvider('coe-status', statusView),
            { dispose: () => statusView.dispose() }
        );

        // Phase 5: Register commands
        registerCommands(context, {
            database,
            configManager,
            llmService,
            orchestrator,
            mcpServer,
            statusView,
            outputChannel,
            extensionUri: context.extensionUri,
            // v2.0 services
            transparencyLogger,
            ethicsEngine,
            componentSchemaService,
            codingAgentService,
            conflictResolver,
            syncService,
        });

        // Phase 6: Start file watchers
        if (workspaceRoot) {
            fileWatcher = new FileWatcherService(
                workspaceRoot,
                database,
                orchestrator,
                configManager,
                outputChannel
            );
            fileWatcher.start();
            context.subscriptions.push({ dispose: () => fileWatcher.stop() });
        }

        // Phase 7: Show activation message
        outputChannel.appendLine('COE activated successfully.');
        const taskCount = database.getTasksByStatus('not_started').length;
        if (taskCount > 0) {
            vscode.window.showInformationMessage(
                `COE ready. ${taskCount} tasks pending.`
            );
        } else {
            vscode.window.showInformationMessage(
                'COE ready. Create a plan to get started.'
            );
        }

        database.addAuditLog('system', 'extension_activated', 'COE extension activated successfully');

    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`Activation error: ${msg}`);
        vscode.window.showErrorMessage(`COE failed to activate: ${msg}`);
    }
}

export async function deactivate() {
    if (syncService) { await syncService.dispose(); }
    if (fileWatcher) { fileWatcher.stop(); }
    if (mcpServer) { mcpServer.dispose(); }
    if (orchestrator) { orchestrator.dispose(); }
    if (database) { database.close(); }
}
