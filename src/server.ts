/**
 * COE Standalone Server
 *
 * Runs the full COE system (agents, database, LLM, MCP, webapp) as a
 * standalone Node.js process — no VS Code required.
 *
 * Usage:
 *   node dist/server.js --project <path> [--port 3030]
 *
 * The --project flag specifies the workspace root directory. The .coe/
 * folder (config, database, agents) lives inside it.
 */

import * as path from 'path';
import * as fs from 'fs';
import { OutputChannelLike, ContentType } from './types';

// --- Core ---
import { Database } from './core/database';
import { ConfigManager } from './core/config';
import { LLMService } from './core/llm-service';
import { getEventBus } from './core/event-bus';
import { TicketProcessorService } from './core/ticket-processor';

// --- Agents ---
import { Orchestrator } from './agents/orchestrator';

// --- MCP + Webapp ---
import { MCPServer } from './mcp/server';

// --- Supporting services ---
import { TestRunnerService } from './core/test-runner';
import { EvolutionService } from './core/evolution-service';
import { TokenBudgetTracker } from './core/token-budget-tracker';
import { ContextFeeder } from './core/context-feeder';
import { TaskDecompositionEngine } from './core/task-decomposition-engine';
import { ContextBreakingChain } from './core/context-breaking-chain';
import { TransparencyLogger } from './core/transparency-logger';
import { EthicsEngine } from './core/ethics-engine';
import { ComponentSchemaService } from './core/component-schema';
import { CodingAgentService } from './core/coding-agent';
import { ConflictResolver } from './core/conflict-resolver';
import { SyncService } from './core/sync-service';
import { DocumentManagerService } from './core/document-manager';

// --- v8.0 services ---
import { LinkManagerService } from './core/link-manager';
import { TagManagerService } from './core/tag-manager';
import { ReviewQueueManagerService } from './core/review-queue-manager';

// --- v9.0 services ---
import { AgentPermissionManager } from './core/agent-permission-manager';
import { ModelRouter } from './core/model-router';
import { UserProfileManager } from './core/user-profile-manager';
import { NicheAgentFactory } from './core/niche-agent-factory';
import { AgentTreeManager } from './core/agent-tree-manager';
import { WorkflowDesigner } from './core/workflow-designer';
import { WorkflowEngine } from './core/workflow-engine';

// --- v10.0 services ---
import { LLMProfileManager } from './core/llm-profile-manager';
import { ToolAssignmentManager } from './core/tool-assignment-manager';
import { StartupTicketManager } from './core/startup-tickets';

// ============================================================
// Console-based OutputChannel (timestamps + console.log)
// ============================================================
class ConsoleOutputChannel implements OutputChannelLike {
    appendLine(msg: string): void {
        const ts = new Date().toISOString().slice(11, 19); // HH:MM:SS
        console.log(`[${ts}] ${msg}`);
    }
}

// ============================================================
// CLI Argument Parsing
// ============================================================
function parseArgs(): { projectDir: string; port: number } {
    const args = process.argv.slice(2);
    let projectDir = '';
    let port = 3030;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--project' && args[i + 1]) {
            projectDir = path.resolve(args[++i]);
        } else if (args[i] === '--port' && args[i + 1]) {
            port = parseInt(args[++i], 10);
        }
    }

    if (!projectDir) {
        console.error('Usage: node dist/server.js --project <path> [--port 3030]');
        console.error('  --project  Path to the workspace root (required)');
        console.error('  --port     HTTP port for MCP/webapp (default: 3030)');
        process.exit(1);
    }

    if (!fs.existsSync(projectDir)) {
        console.error(`Error: Project directory does not exist: ${projectDir}`);
        process.exit(1);
    }

    return { projectDir, port };
}

// ============================================================
// Service references for cleanup
// ============================================================
let database: Database;
let llmService: LLMService;
let orchestrator: Orchestrator;
let mcpServer: MCPServer;
let ticketProcessor: TicketProcessorService;
let syncService: SyncService;
let configManager: ConfigManager;

// ============================================================
// Main Boot Sequence
// ============================================================
async function main() {
    const { projectDir, port } = parseArgs();
    const outputChannel = new ConsoleOutputChannel();

    outputChannel.appendLine('========================================');
    outputChannel.appendLine('  COE Standalone Server');
    outputChannel.appendLine('========================================');
    outputChannel.appendLine(`Project: ${projectDir}`);
    outputChannel.appendLine(`Port:    ${port}`);
    outputChannel.appendLine('');

    // Phase 1: Core services
    configManager = ConfigManager.createStandalone(projectDir);
    await configManager.initialize();
    outputChannel.appendLine('ConfigManager initialized (standalone mode).');

    database = new Database(configManager.getCOEDir());
    await database.initialize();
    outputChannel.appendLine('Database initialized.');

    llmService = new LLMService(configManager.getLLMConfig(), outputChannel);
    outputChannel.appendLine('LLMService initialized.');

    // Phase 2: Agent framework
    orchestrator = new Orchestrator(database, llmService, configManager, outputChannel);
    await orchestrator.initialize();
    outputChannel.appendLine('Orchestrator initialized (18 agents).');

    // Wire test runner
    const testRunner = new TestRunnerService(projectDir, outputChannel);
    orchestrator.getVerificationAgent().setTestRunner(testRunner);
    outputChannel.appendLine('TestRunnerService wired.');

    // Wire evolution service
    const evolutionService = new EvolutionService(database, configManager, llmService, outputChannel);
    orchestrator.setEvolutionService(evolutionService);

    // Token management
    const coeConfig = configManager.getConfig();
    const budgetTracker = new TokenBudgetTracker(
        coeConfig.llm.model,
        coeConfig.tokenBudget,
        outputChannel
    );

    // Auto-detect model capabilities
    try {
        const modelInfo = await llmService.fetchModelInfo();
        if (modelInfo && modelInfo.maxContextLength > 0) {
            const detectedContext = modelInfo.maxContextLength;
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
                `[LLMService] Auto-detected model: ${modelInfo.id} ` +
                `(context: ${detectedContext}, maxOutput: ${detectedMaxOutput})`
            );
        } else {
            outputChannel.appendLine('[LLMService] Model auto-detection unavailable — using config defaults');
        }
    } catch (err) {
        outputChannel.appendLine(`[LLMService] Model auto-detection failed (non-fatal): ${err}`);
    }

    // Register config model profiles
    if (coeConfig.models) {
        for (const [modelId, modelConfig] of Object.entries(coeConfig.models)) {
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
                // Already registered
            }
        }
    }

    const contextFeeder = new ContextFeeder(budgetTracker, outputChannel);
    const decompositionEngine = new TaskDecompositionEngine(outputChannel);
    // ContextBreakingChain created but only used if explicitly called
    const _contextBreakingChain = new ContextBreakingChain(budgetTracker, outputChannel);

    orchestrator.injectContextServices(budgetTracker, contextFeeder);
    orchestrator.injectDecompositionEngine(decompositionEngine);

    budgetTracker.onWarning((warning) => {
        outputChannel.appendLine(`[TokenBudget] ${warning.level.toUpperCase()}: ${warning.message}`);
    });

    // Phase 2e: v2.0+ services
    const eventBus = getEventBus();
    orchestrator.setEventBus(eventBus);
    llmService.setEventBus(eventBus);

    const transparencyLogger = new TransparencyLogger(database, eventBus, outputChannel);
    const ethicsEngine = new EthicsEngine(database, eventBus, transparencyLogger, outputChannel);
    ethicsEngine.seedDefaultModules();

    const componentSchemaService = new ComponentSchemaService(database, outputChannel);
    componentSchemaService.seedDefaultSchemas();

    const codingAgentService = new CodingAgentService(
        llmService, database, ethicsEngine, componentSchemaService,
        eventBus, transparencyLogger, outputChannel
    );

    const conflictResolver = new ConflictResolver(database, eventBus, outputChannel);
    syncService = new SyncService(database, eventBus, conflictResolver, transparencyLogger, outputChannel);

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

    // Phase 3: MCP server + webapp
    mcpServer = new MCPServer(orchestrator, database, configManager, outputChannel, codingAgentService);

    // Override port if specified on CLI
    if (port !== 3030) {
        (mcpServer as any).port = port;
    }

    await mcpServer.initialize();
    outputChannel.appendLine(`MCP Server listening on port ${port}.`);

    // Ticket processor
    ticketProcessor = new TicketProcessorService(database, orchestrator, eventBus, configManager, outputChannel);
    ticketProcessor.start();
    mcpServer.setTicketProcessor(ticketProcessor);

    // Document manager
    const documentManager = new DocumentManagerService(database, eventBus, outputChannel);
    ticketProcessor.setDocumentManager(documentManager);
    orchestrator.getAnswerAgent().setDocumentManager(documentManager);

    // v8.0 services
    const _linkManager = new LinkManagerService(database, eventBus, outputChannel);
    const tagManager = new TagManagerService(database, eventBus, outputChannel);
    tagManager.seedBuiltinTags();
    const _reviewQueueManager = new ReviewQueueManagerService(database, eventBus, outputChannel);

    // v9.0 services
    const agentPermissionManager = new AgentPermissionManager(database);
    const modelRouter = new ModelRouter(database, configManager.getLLMConfig());
    try {
        await modelRouter.detectModelCapabilities();
        outputChannel.appendLine('ModelRouter initialized with capability detection.');
    } catch {
        outputChannel.appendLine('ModelRouter initialized (capability detection unavailable).');
    }

    const userProfileManager = new UserProfileManager(database);
    userProfileManager.getProfile();

    // v10.0 services
    const llmProfileManager = new LLMProfileManager(database, eventBus, outputChannel);
    llmProfileManager.seedDefaultProfile(
        configManager.getLLMConfig().endpoint,
        configManager.getLLMConfig().model
    );

    const _toolAssignmentManager = new ToolAssignmentManager(database, eventBus, outputChannel);

    const nicheAgentFactory = new NicheAgentFactory(database);
    nicheAgentFactory.seedDefaultDefinitions();

    const agentTreeManager = new AgentTreeManager(database, eventBus, configManager, outputChannel);
    agentTreeManager.ensureDefaultTree();
    ticketProcessor.setAgentTreeManager(agentTreeManager);

    const _workflowDesigner = new WorkflowDesigner(database, eventBus, outputChannel);
    const workflowEngine = new WorkflowEngine(database, eventBus, configManager, outputChannel);

    // Inject v9.0 services into orchestrator
    orchestrator.injectPermissionManager(agentPermissionManager);
    orchestrator.injectModelRouter(modelRouter);
    orchestrator.injectAgentTreeManager(agentTreeManager);
    orchestrator.injectNicheAgentFactory(nicheAgentFactory);
    orchestrator.injectUserProfileManager(userProfileManager);

    // Wire tree + workflow into BossAgent
    const bossAgent = orchestrator.getBossAgent();
    bossAgent.setTreeManager(agentTreeManager);
    bossAgent.setWorkflowEngine(workflowEngine);
    bossAgent.setEventBus(eventBus);

    // Wire config changes to LLMService + ModelRouter
    configManager.onChange((newConfig) => {
        llmService.updateConfig(newConfig.llm);
        modelRouter.updateLLMConfig(newConfig.llm);
        outputChannel.appendLine(`[Config] LLM config updated: model=${newConfig.llm.model}`);
    });

    // MCP confirmation
    const mcpConfirmEnabled = configManager.getConfig().mcpConfirmationRequired !== false;
    mcpServer.setConfirmationEnabled(mcpConfirmEnabled);

    // v10.0: Startup tickets
    const startupTicketManager = new StartupTicketManager(database, eventBus, outputChannel);
    if (!startupTicketManager.isBootstrapStarted()) {
        const result = startupTicketManager.createBootstrapTickets();
        outputChannel.appendLine(`[StartupTickets] Created ${result.created} bootstrap tickets.`);
    } else if (startupTicketManager.isBootstrapComplete()) {
        outputChannel.appendLine('[StartupTickets] Bootstrap already complete.');
    } else {
        const progress = startupTicketManager.getBootstrapProgress();
        outputChannel.appendLine(
            `[StartupTickets] Bootstrap in progress: ${progress.completed}/${progress.total} completed.`
        );
    }

    database.addAuditLog('system', 'server_started', 'COE standalone server started successfully');

    // Print summary
    outputChannel.appendLine('');
    outputChannel.appendLine('========================================');
    outputChannel.appendLine('  COE Server Ready');
    outputChannel.appendLine('========================================');
    outputChannel.appendLine(`  Webapp:     http://localhost:${port}/app`);
    outputChannel.appendLine(`  API:        http://localhost:${port}/api/*`);
    outputChannel.appendLine(`  MCP:        http://localhost:${port}/mcp`);
    outputChannel.appendLine(`  SSE:        http://localhost:${port}/events`);
    outputChannel.appendLine(`  Health:     http://localhost:${port}/health`);
    outputChannel.appendLine('========================================');
    outputChannel.appendLine('Press Ctrl+C to stop.');
}

// ============================================================
// Graceful Shutdown
// ============================================================
async function shutdown(signal: string) {
    console.log(`\n[COE] Received ${signal} — shutting down...`);
    try {
        if (ticketProcessor) ticketProcessor.dispose();
        if (syncService) await syncService.dispose();
        if (mcpServer) mcpServer.dispose();
        if (llmService) llmService.dispose();
        if (orchestrator) orchestrator.dispose();
        if (configManager) configManager.dispose();
        if (database) database.close();
    } catch (err) {
        console.error('[COE] Error during shutdown:', err);
    }
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ============================================================
// Launch
// ============================================================
main().catch((err) => {
    console.error('[COE] Fatal startup error:', err);
    process.exit(1);
});
