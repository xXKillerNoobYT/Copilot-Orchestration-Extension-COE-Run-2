import * as vscode from 'vscode';
import { Database } from './core/database';
import { ConfigManager } from './core/config';
import { LLMService } from './core/llm-service';
import { Orchestrator } from './agents/orchestrator';
import { MCPServer } from './mcp/server';
import { StatusViewProvider } from './views/status-view';
import { registerCommands } from './commands';
import { FileWatcherService } from './core/file-watcher';

let database: Database;
let configManager: ConfigManager;
let llmService: LLMService;
let orchestrator: Orchestrator;
let mcpServer: MCPServer;
let fileWatcher: FileWatcherService;

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

        // Phase 3: Initialize MCP server
        mcpServer = new MCPServer(orchestrator, database, configManager, outputChannel);
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
            extensionUri: context.extensionUri
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

export function deactivate() {
    if (fileWatcher) { fileWatcher.stop(); }
    if (mcpServer) { mcpServer.dispose(); }
    if (orchestrator) { orchestrator.dispose(); }
    if (database) { database.close(); }
}
