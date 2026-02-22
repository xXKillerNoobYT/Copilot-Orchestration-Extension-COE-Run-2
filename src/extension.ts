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
import { TicketProcessorService } from './core/ticket-processor';
import { DocumentManagerService } from './core/document-manager';
import { AgentFileCleanupService } from './core/agent-file-cleanup';
// v8.0 services
import { LinkManagerService } from './core/link-manager';
import { TagManagerService } from './core/tag-manager';
import { ReviewQueueManagerService } from './core/review-queue-manager';
// v9.0 services
import { AgentPermissionManager } from './core/agent-permission-manager';
import { ModelRouter } from './core/model-router';
import { UserProfileManager } from './core/user-profile-manager';
import { NicheAgentFactory } from './core/niche-agent-factory';
import { AgentTreeManager } from './core/agent-tree-manager';
import { WorkflowDesigner } from './core/workflow-designer';
import { WorkflowEngine } from './core/workflow-engine';
// v10.0 services
import { LLMProfileManager } from './core/llm-profile-manager';
import { ToolAssignmentManager } from './core/tool-assignment-manager';
import { StartupTicketManager } from './core/startup-tickets';

let database: Database;
let configManager: ConfigManager;
let llmService: LLMService;
let orchestrator: Orchestrator;
let mcpServer: MCPServer;
let fileWatcher: FileWatcherService;
let syncService: SyncService;
let ticketProcessor: TicketProcessorService;

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

        // v9.0: Config onChange is wired after all services are created (see below)

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

        // v6.0: Auto-detect model capabilities from LM Studio API
        // This replaces the need to manually configure contextWindowTokens/maxOutputTokens.
        // Config `models` section is now an optional override (fallback if API is unavailable).
        try {
            const modelInfo = await llmService.fetchModelInfo();
            if (modelInfo && modelInfo.maxContextLength > 0) {
                // Auto-detected from LM Studio — use real values
                const detectedContext = modelInfo.maxContextLength;
                // maxOutputTokens is not returned by LM Studio API, so use a sensible default:
                // 1/8 of context window, capped between 2048 and 8192
                const configOverride = coeConfig.models?.[modelInfo.id];
                const detectedMaxOutput = configOverride?.maxOutputTokens
                    ?? Math.min(8192, Math.max(2048, Math.floor(detectedContext / 8)));

                budgetTracker.registerModel({
                    id: modelInfo.id,
                    name: modelInfo.id,
                    contextWindowTokens: configOverride?.contextWindowTokens ?? detectedContext,
                    maxOutputTokens: detectedMaxOutput,
                    tokensPerChar: {
                        [ContentType.Code]: 3.2,
                        [ContentType.NaturalText]: 4.0,
                        [ContentType.JSON]: 3.5,
                        [ContentType.Markdown]: 3.8,
                        [ContentType.Mixed]: 3.6,
                    },
                    overheadTokensPerMessage: 4,
                });

                outputChannel.appendLine(
                    `[LLMService] Auto-detected model profile: ${modelInfo.id} ` +
                    `(context: ${detectedContext}, maxOutput: ${detectedMaxOutput}, ` +
                    `type: ${modelInfo.type}, arch: ${modelInfo.arch}, quant: ${modelInfo.quantization})`
                );
            } else {
                outputChannel.appendLine(
                    '[LLMService] Model auto-detection unavailable — using config defaults'
                );
            }
        } catch (err) {
            outputChannel.appendLine(
                `[LLMService] Model auto-detection failed (non-fatal): ${err}`
            );
        }

        // Register any additional model profiles from config (for models not yet loaded/detected)
        if (coeConfig.models) {
            for (const [modelId, modelConfig] of Object.entries(coeConfig.models)) {
                // Skip models already registered (including the auto-detected one)
                try {
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
                } catch {
                    // Model already registered (e.g. by auto-detection) — skip
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
        orchestrator.setEventBus(eventBus);
        outputChannel.appendLine('EventBus wired into Orchestrator.');

        // v10.0: Wire EventBus into LLMService for model reload detection events
        llmService.setEventBus(eventBus);
        outputChannel.appendLine('EventBus wired into LLMService (auto-recovery timer started at construction).');

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

        // Phase 3b: Initialize ticket auto-processing
        ticketProcessor = new TicketProcessorService(database, orchestrator, eventBus, configManager, outputChannel);
        ticketProcessor.start();
        mcpServer.setTicketProcessor(ticketProcessor);
        context.subscriptions.push({ dispose: () => ticketProcessor.dispose() });
        outputChannel.appendLine('TicketProcessorService initialized with dual queues.');

        // Phase 3c: Initialize DocumentManagerService (v7.0)
        const documentManager = new DocumentManagerService(database, eventBus, outputChannel);
        ticketProcessor.setDocumentManager(documentManager);
        orchestrator.getAnswerAgent().setDocumentManager(documentManager);
        outputChannel.appendLine('DocumentManagerService initialized and wired into TicketProcessor + AnswerAgent.');

        // Phase 3d: Initialize v8.0 services (LinkManager, TagManager, ReviewQueueManager)
        const linkManager = new LinkManagerService(database, eventBus, outputChannel);
        outputChannel.appendLine('LinkManagerService initialized.');

        const tagManager = new TagManagerService(database, eventBus, outputChannel);
        tagManager.seedBuiltinTags();
        outputChannel.appendLine('TagManagerService initialized with 5 built-in tags seeded.');

        const reviewQueueManager = new ReviewQueueManagerService(database, eventBus, outputChannel);
        outputChannel.appendLine('ReviewQueueManagerService initialized.');

        // Phase 3e: Initialize v9.0 services
        const agentPermissionManager = new AgentPermissionManager(database);
        outputChannel.appendLine('AgentPermissionManager initialized.');

        const modelRouter = new ModelRouter(database, configManager.getLLMConfig());
        try {
            await modelRouter.detectModelCapabilities();
            outputChannel.appendLine('ModelRouter initialized with capability detection.');
        } catch {
            outputChannel.appendLine('ModelRouter initialized (capability detection unavailable).');
        }

        const userProfileManager = new UserProfileManager(database);
        userProfileManager.getProfile(); // Auto-creates default profile on first run
        outputChannel.appendLine('UserProfileManager initialized.');

        // v10.0: LLM Profile Manager — manages 5 profile types with single-model queue
        const llmProfileManager = new LLMProfileManager(database, eventBus, outputChannel);
        llmProfileManager.seedDefaultProfile(
            configManager.getLLMConfig().endpoint,
            configManager.getLLMConfig().model
        );
        outputChannel.appendLine('LLMProfileManager initialized' +
            (llmProfileManager.isSetupComplete() ? ' (profiles configured).' : ' (awaiting first-run setup).'));

        // v10.0: Tool Assignment Manager — per-agent tool grants with inheritance and escalation
        const toolAssignmentManager = new ToolAssignmentManager(database, eventBus, outputChannel);
        outputChannel.appendLine('ToolAssignmentManager initialized.');

        const nicheAgentFactory = new NicheAgentFactory(database);
        nicheAgentFactory.seedDefaultDefinitions();
        outputChannel.appendLine('NicheAgentFactory initialized with default niche agent definitions seeded.');

        const agentTreeManager = new AgentTreeManager(database, eventBus, configManager, outputChannel);
        agentTreeManager.ensureDefaultTree();
        ticketProcessor.setAgentTreeManager(agentTreeManager);
        outputChannel.appendLine('AgentTreeManager initialized.');

        const workflowDesigner = new WorkflowDesigner(database, eventBus, outputChannel);
        outputChannel.appendLine('WorkflowDesigner initialized.');

        const workflowEngine = new WorkflowEngine(database, eventBus, configManager, outputChannel);
        outputChannel.appendLine('WorkflowEngine initialized.');

        // v9.0: Inject services into orchestrator and agents
        orchestrator.injectPermissionManager(agentPermissionManager);
        orchestrator.injectModelRouter(modelRouter);
        orchestrator.injectAgentTreeManager(agentTreeManager);
        orchestrator.injectNicheAgentFactory(nicheAgentFactory);
        orchestrator.injectUserProfileManager(userProfileManager);
        outputChannel.appendLine('v9.0 services injected into Orchestrator (including NicheAgentFactory).');

        // v9.0: Wire tree + workflow into BossAgent
        const bossAgent = orchestrator.getBossAgent();
        bossAgent.setTreeManager(agentTreeManager);
        bossAgent.setWorkflowEngine(workflowEngine);
        // v10.0: Wire EventBus into BossAgent for resilience events (degraded/recovered)
        bossAgent.setEventBus(eventBus);
        outputChannel.appendLine('AgentTreeManager, WorkflowEngine, and EventBus wired into BossAgent.');

        // v9.0: Wire config changes to LLMService + ModelRouter so model updates propagate at runtime.
        // This must be after all services are created so they're in scope.
        configManager.onChange((newConfig) => {
            llmService.updateConfig(newConfig.llm);
            modelRouter.updateLLMConfig(newConfig.llm);
            outputChannel.appendLine(`[Config] LLM config updated: model=${newConfig.llm.model}`);
        });

        // v9.0: Wire MCP confirmation
        const mcpConfirmEnabled = configManager.getConfig().mcpConfirmationRequired !== false;
        mcpServer.setConfirmationEnabled(mcpConfirmEnabled);
        outputChannel.appendLine(`MCP confirmation stage: ${mcpConfirmEnabled ? 'enabled' : 'disabled'}.`);

        // v10.0: Startup tickets — bootstrap the system on first activation
        const startupTicketManager = new StartupTicketManager(database, eventBus, outputChannel);
        if (!startupTicketManager.isBootstrapStarted()) {
            const result = startupTicketManager.createBootstrapTickets();
            outputChannel.appendLine(`[StartupTickets] Created ${result.created} bootstrap tickets.`);
        } else if (startupTicketManager.isBootstrapComplete()) {
            outputChannel.appendLine('[StartupTickets] Bootstrap already complete.');
        } else {
            const progress = startupTicketManager.getBootstrapProgress();
            outputChannel.appendLine(
                `[StartupTickets] Bootstrap in progress: ${progress.completed}/${progress.total} completed, ` +
                `${progress.in_progress} active, ${progress.blocked} blocked.`
            );
        }

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

            // Phase 6b: Agent file cleanup watcher (v7.0)
            const fileCleanup = new AgentFileCleanupService(
                workspaceRoot, database, documentManager, eventBus, outputChannel
            );
            const cleanupDisposable = fileCleanup.startWatching();
            context.subscriptions.push(cleanupDisposable);
            outputChannel.appendLine('AgentFileCleanupService initialized and watching workspace root.');
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
    if (ticketProcessor) { ticketProcessor.dispose(); }
    if (syncService) { await syncService.dispose(); }
    if (fileWatcher) { fileWatcher.stop(); }
    if (mcpServer) { mcpServer.dispose(); }
    // v10.0: Clean up LLMService auto-recovery timer
    if (llmService) { llmService.dispose(); }
    if (orchestrator) { orchestrator.dispose(); }
    if (database) { database.close(); }
}
