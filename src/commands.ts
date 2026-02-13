import * as vscode from 'vscode';
import { Database } from './core/database';
import { ConfigManager } from './core/config';
import { LLMService } from './core/llm-service';
import { Orchestrator } from './agents/orchestrator';
import { MCPServer } from './mcp/server';
import { StatusViewProvider } from './views/status-view';
import { AgentContext, TicketPriority, TaskPriority, ConflictResolutionStrategy, SyncBackend } from './types';
import { GitHubClient } from './core/github-client';
import { GitHubSyncService } from './core/github-sync';
import { PlanBuilderPanel } from './views/plan-builder';
import { TransparencyLogger } from './core/transparency-logger';
import { EthicsEngine } from './core/ethics-engine';
import { ComponentSchemaService } from './core/component-schema';
import { CodingAgentService } from './core/coding-agent';
import { ConflictResolver } from './core/conflict-resolver';
import { SyncService } from './core/sync-service';

export interface CommandDeps {
    database: Database;
    configManager: ConfigManager;
    llmService: LLMService;
    orchestrator: Orchestrator;
    mcpServer: MCPServer;
    statusView: StatusViewProvider;
    outputChannel: vscode.OutputChannel;
    extensionUri: vscode.Uri;
    // v2.0 services (optional for backwards compatibility)
    transparencyLogger?: TransparencyLogger;
    ethicsEngine?: EthicsEngine;
    componentSchemaService?: ComponentSchemaService;
    codingAgentService?: CodingAgentService;
    conflictResolver?: ConflictResolver;
    syncService?: SyncService;
}

export function registerCommands(context: vscode.ExtensionContext, deps: CommandDeps): void {
    const { database, configManager, llmService, orchestrator, mcpServer,
            statusView, outputChannel } = deps;

    function refreshAll(): void {
        statusView.refresh();
    }

    // --- Open App (main action — opens web app in browser) ---
    context.subscriptions.push(
        vscode.commands.registerCommand('coe.openApp', () => {
            const port = mcpServer.getPort();
            const url = vscode.Uri.parse(`http://localhost:${port}/app`);
            vscode.env.openExternal(url);
        }),

        vscode.commands.registerCommand('coe.refreshStatus', () => {
            statusView.refresh();
        }),
    );

    // --- Plan Commands ---
    context.subscriptions.push(
        vscode.commands.registerCommand('coe.createPlan', async () => {
            const name = await vscode.window.showInputBox({
                prompt: 'Plan name',
                placeHolder: 'e.g., My Web App MVP',
            });
            if (!name) return;

            const description = await vscode.window.showInputBox({
                prompt: 'Brief description of what to build',
                placeHolder: 'e.g., A REST API with user auth and CRUD endpoints',
            });
            if (!description) return;

            const ctx: AgentContext = { conversationHistory: [] };
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Creating plan...',
                cancellable: false,
            }, async () => {
                const response = await orchestrator.callAgent('planning',
                    `Create a structured plan called "${name}" for: ${description}`, ctx);
                vscode.window.showInformationMessage(response.content.substring(0, 200));
                refreshAll();
            });
        }),

        vscode.commands.registerCommand('coe.freshRestart', async () => {
            const confirm = await vscode.window.showWarningMessage(
                'Fresh Restart will reset in-progress tasks and agent states. Continue?',
                'Yes', 'Cancel'
            );
            if (confirm !== 'Yes') return;

            const result = await orchestrator.freshRestart();
            vscode.window.showInformationMessage(result.message);
            refreshAll();
        }),

        vscode.commands.registerCommand('coe.refreshPRD', () => {
            vscode.window.showInformationMessage('PRD refresh triggered.');
            refreshAll();
        }),
    );

    // --- Ticket Commands ---
    context.subscriptions.push(
        vscode.commands.registerCommand('coe.createTicket', async () => {
            const title = await vscode.window.showInputBox({
                prompt: 'Ticket title',
                placeHolder: 'e.g., Clarify database schema for users table',
            });
            if (!title) return;

            const body = await vscode.window.showInputBox({
                prompt: 'Ticket description',
                placeHolder: 'Details about the question or issue',
            });

            const priority = await vscode.window.showQuickPick(['P1', 'P2', 'P3'], {
                placeHolder: 'Priority',
            }) as TicketPriority | undefined;

            const ticket = database.createTicket({
                title,
                body: body || '',
                priority: priority || TicketPriority.P2,
                creator: 'user',
            });

            vscode.window.showInformationMessage(`Ticket TK-${ticket.ticket_number} created.`);
            refreshAll();
        }),

        vscode.commands.registerCommand('coe.resolveTicket', async () => {
            const tickets = database.getTicketsByStatus('open');
            if (tickets.length === 0) {
                vscode.window.showInformationMessage('No open tickets.');
                return;
            }

            const selected = await vscode.window.showQuickPick(
                tickets.map(t => ({
                    label: `TK-${t.ticket_number} [${t.priority}] ${t.title}`,
                    ticketId: t.id,
                })),
                { placeHolder: 'Select ticket to resolve' }
            );
            if (!selected) return;

            database.updateTicket(selected.ticketId, { status: 'resolved' as any });
            vscode.window.showInformationMessage('Ticket resolved.');
            refreshAll();
        }),

        vscode.commands.registerCommand('coe.openTicketPanel', () => {
            // Redirect to web app
            const port = mcpServer.getPort();
            vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${port}/app`));
        }),

        vscode.commands.registerCommand('coe.escalateTicket', async () => {
            const tickets = database.getTicketsByStatus('open');
            if (tickets.length === 0) {
                vscode.window.showInformationMessage('No open tickets to escalate.');
                return;
            }
            const selected = await vscode.window.showQuickPick(
                tickets.map(t => ({
                    label: `TK-${t.ticket_number} [${t.priority}] ${t.title}`,
                    ticketId: t.id,
                })),
                { placeHolder: 'Select ticket to escalate' }
            );
            if (!selected) return;
            database.updateTicket(selected.ticketId, { status: 'escalated' as any });
            vscode.window.showInformationMessage('Ticket escalated.');
            refreshAll();
        }),
    );

    // --- Task Commands ---
    context.subscriptions.push(
        vscode.commands.registerCommand('coe.getNextTask', () => {
            const task = orchestrator.getNextTask();
            if (!task) {
                vscode.window.showInformationMessage('No tasks ready.');
                return;
            }
            vscode.window.showInformationMessage(`Next task: [${task.priority}] ${task.title} (${task.estimated_minutes}min)`);
        }),

        vscode.commands.registerCommand('coe.markTaskDone', async () => {
            const inProgress = database.getTasksByStatus('in_progress');
            if (inProgress.length === 0) {
                vscode.window.showInformationMessage('No tasks in progress.');
                return;
            }
            const selected = await vscode.window.showQuickPick(
                inProgress.map(t => ({ label: t.title, taskId: t.id })),
                { placeHolder: 'Select task to mark as done' }
            );
            if (!selected) return;

            const summary = await vscode.window.showInputBox({ prompt: 'Summary of what was done' });
            await orchestrator.reportTaskDone(selected.taskId, summary || 'Task completed', []);
            vscode.window.showInformationMessage('Task marked done. Verification scheduled.');
            refreshAll();
        }),

        vscode.commands.registerCommand('coe.decomposeTask', async () => {
            const tasks = database.getAllTasks().filter(t => t.estimated_minutes > 45);
            if (tasks.length === 0) {
                vscode.window.showInformationMessage('No tasks large enough to decompose (>45 min).');
                return;
            }
            const selected = await vscode.window.showQuickPick(
                tasks.map(t => ({ label: `${t.title} (${t.estimated_minutes}min)`, taskId: t.id })),
                { placeHolder: 'Select task to decompose' }
            );
            if (!selected) return;

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Decomposing task...',
            }, async () => {
                const result = await orchestrator.getPlanningAgent().decompose(selected.taskId);
                vscode.window.showInformationMessage(result.content.substring(0, 200));
                refreshAll();
            });
        }),

        vscode.commands.registerCommand('coe.setTaskPriority', async () => {
            const tasks = database.getAllTasks().filter(t => t.status !== 'verified');
            if (tasks.length === 0) return;
            const selected = await vscode.window.showQuickPick(
                tasks.map(t => ({ label: `[${t.priority}] ${t.title}`, taskId: t.id })),
                { placeHolder: 'Select task' }
            );
            if (!selected) return;
            const priority = await vscode.window.showQuickPick(['P1', 'P2', 'P3'], { placeHolder: 'New priority' });
            if (!priority) return;
            database.updateTask(selected.taskId, { priority: priority as TaskPriority });
            refreshAll();
        }),

        vscode.commands.registerCommand('coe.retryTask', async () => {
            const failed = database.getTasksByStatus('failed');
            if (failed.length === 0) {
                vscode.window.showInformationMessage('No failed tasks.');
                return;
            }
            const selected = await vscode.window.showQuickPick(
                failed.map(t => ({ label: t.title, taskId: t.id })),
                { placeHolder: 'Select task to retry' }
            );
            if (!selected) return;
            database.updateTask(selected.taskId, { status: 'not_started' as any });
            vscode.window.showInformationMessage('Task reset to not started.');
            refreshAll();
        }),

        vscode.commands.registerCommand('coe.blockTask', async () => {
            const tasks = database.getTasksByStatus('not_started')
                .concat(database.getTasksByStatus('in_progress'));
            if (tasks.length === 0) return;
            const selected = await vscode.window.showQuickPick(
                tasks.map(t => ({ label: t.title, taskId: t.id })),
                { placeHolder: 'Select task to block' }
            );
            if (!selected) return;
            database.updateTask(selected.taskId, { status: 'blocked' as any });
            refreshAll();
        }),

        vscode.commands.registerCommand('coe.unblockTask', async () => {
            const blocked = database.getTasksByStatus('blocked');
            if (blocked.length === 0) {
                vscode.window.showInformationMessage('No blocked tasks.');
                return;
            }
            const selected = await vscode.window.showQuickPick(
                blocked.map(t => ({ label: t.title, taskId: t.id })),
                { placeHolder: 'Select task to unblock' }
            );
            if (!selected) return;
            database.updateTask(selected.taskId, { status: 'not_started' as any });
            refreshAll();
        }),

        vscode.commands.registerCommand('coe.reorderTasks', async () => {
            const tasks = database.getAllTasks().filter(t =>
                t.status === 'not_started' || t.status === 'blocked'
            );
            if (tasks.length === 0) {
                vscode.window.showInformationMessage('No pending tasks to reorder.');
                return;
            }

            const selected = await vscode.window.showQuickPick(
                tasks.map(t => ({
                    label: `[${t.priority}] ${t.title}`,
                    taskId: t.id,
                    picked: false,
                })),
                { canPickMany: true, placeHolder: 'Select tasks to change priority' }
            );
            if (!selected || selected.length === 0) return;

            const newPriority = await vscode.window.showQuickPick(
                ['P1', 'P2', 'P3'],
                { placeHolder: 'New priority for selected tasks' }
            );
            if (!newPriority) return;

            for (const item of selected) {
                database.updateTask(item.taskId, { priority: newPriority as TaskPriority });
            }
            vscode.window.showInformationMessage(
                `${selected.length} task(s) updated to ${newPriority}.`
            );
            refreshAll();
        }),
    );

    // --- Agent Commands ---
    context.subscriptions.push(
        vscode.commands.registerCommand('coe.startAgent', async () => {
            const agents = database.getAllAgents().filter(a => a.status === 'idle' || a.status === 'error');
            if (agents.length === 0) {
                vscode.window.showInformationMessage('All agents already running or no agents available.');
                return;
            }
            const selected = await vscode.window.showQuickPick(
                agents.map(a => ({ label: a.name, agentName: a.name })),
                { placeHolder: 'Select agent to start' }
            );
            if (!selected) return;
            database.updateAgentStatus(selected.agentName, 'working' as any);
            refreshAll();
        }),

        vscode.commands.registerCommand('coe.stopAgent', async () => {
            const agents = database.getAllAgents().filter(a => a.status === 'working');
            if (agents.length === 0) return;
            const selected = await vscode.window.showQuickPick(
                agents.map(a => ({ label: a.name, agentName: a.name })),
                { placeHolder: 'Select agent to stop' }
            );
            if (!selected) return;
            database.updateAgentStatus(selected.agentName, 'idle' as any);
            refreshAll();
        }),

        vscode.commands.registerCommand('coe.createCustomAgent', async () => {
            const name = await vscode.window.showInputBox({ prompt: 'Agent name' });
            if (!name) return;
            const description = await vscode.window.showInputBox({ prompt: 'What does this agent do?' });
            if (!description) return;
            const prompt = await vscode.window.showInputBox({ prompt: 'System prompt', value: `You are a specialized agent for ${description}` });
            if (!prompt) return;
            const keywords = await vscode.window.showInputBox({ prompt: 'Routing keywords (comma-separated)' });

            orchestrator.getCustomAgentRunner().saveCustomAgent({
                name,
                description: description || '',
                systemPrompt: prompt || '',
                goals: [{ description: description || '', priority: 1 }],
                checklist: [],
                routingKeywords: keywords ? keywords.split(',').map(k => k.trim()) : [],
                permissions: { readFiles: true, searchCode: true, createTickets: true, callLLM: true, writeFiles: false, executeCode: false },
                limits: { maxGoals: 20, maxLLMCalls: 50, maxTimeMinutes: 30, timePerGoalMinutes: 5 },
            });
            vscode.window.showInformationMessage(`Custom agent "${name}" created.`);
            refreshAll();
        }),

        vscode.commands.registerCommand('coe.openAgentGallery', () => {
            const port = mcpServer.getPort();
            vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${port}/app`));
        }),

        vscode.commands.registerCommand('coe.askAgent', async () => {
            const question = await vscode.window.showInputBox({ prompt: 'Ask a question' });
            if (!question) return;
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Asking agent...',
            }, async () => {
                const ctx: AgentContext = { conversationHistory: [] };
                const response = await orchestrator.route(question, ctx);
                vscode.window.showInformationMessage(response.content.substring(0, 500));
                refreshAll();
            });
        }),

        vscode.commands.registerCommand('coe.refreshAgents', () => refreshAll()),
        vscode.commands.registerCommand('coe.refreshTickets', () => refreshAll()),
        vscode.commands.registerCommand('coe.refreshTasks', () => refreshAll()),
    );

    // --- Verification Commands ---
    context.subscriptions.push(
        vscode.commands.registerCommand('coe.runVerification', async () => {
            const pendingTasks = database.getTasksByStatus('pending_verification');
            if (pendingTasks.length === 0) {
                vscode.window.showInformationMessage('No tasks pending verification.');
                return;
            }
            vscode.window.showInformationMessage(`${pendingTasks.length} tasks pending verification. Running...`);
        }),

        vscode.commands.registerCommand('coe.openVerificationPanel', () => {
            const port = mcpServer.getPort();
            vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${port}/app`));
        }),

        vscode.commands.registerCommand('coe.approveVerification', async () => {
            const pending = database.getTasksByStatus('pending_verification');
            if (pending.length === 0) return;
            const selected = await vscode.window.showQuickPick(
                pending.map(t => ({ label: t.title, taskId: t.id })),
                { placeHolder: 'Approve verification for' }
            );
            if (!selected) return;
            database.updateTask(selected.taskId, { status: 'verified' as any });
            refreshAll();
        }),

        vscode.commands.registerCommand('coe.rejectVerification', async () => {
            const pending = database.getTasksByStatus('pending_verification');
            if (pending.length === 0) return;
            const selected = await vscode.window.showQuickPick(
                pending.map(t => ({ label: t.title, taskId: t.id })),
                { placeHolder: 'Reject verification for' }
            );
            if (!selected) return;
            database.updateTask(selected.taskId, { status: 'failed' as any });
            refreshAll();
        }),
    );

    // --- System Commands ---
    context.subscriptions.push(
        vscode.commands.registerCommand('coe.scanCodebase', async () => {
            const plan = database.getActivePlan();
            if (!plan) {
                vscode.window.showInformationMessage('No active plan. Create a plan first.');
                return;
            }
            const tasks = database.getTasksByPlan(plan.id);
            const verified = tasks.filter(t => t.status === 'verified').length;
            const drift = tasks.length > 0 ? ((tasks.length - verified) / tasks.length * 100).toFixed(0) : '0';
            vscode.window.showInformationMessage(
                `Plan "${plan.name}": ${verified}/${tasks.length} verified (${100 - parseInt(drift)}% aligned, ${drift}% drift)`
            );
        }),

        vscode.commands.registerCommand('coe.showDashboard', () => {
            const port = mcpServer.getPort();
            vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${port}/app`));
        }),

        vscode.commands.registerCommand('coe.showEvolution', () => {
            const log = database.getEvolutionLog(10);
            if (log.length === 0) {
                vscode.window.showInformationMessage('No evolution entries yet.');
                return;
            }
            const content = log.map(e =>
                `## ${e.pattern}\nProposal: ${e.proposal}\nStatus: ${e.status}\nResult: ${e.result || 'Pending'}`
            ).join('\n\n---\n\n');
            vscode.workspace.openTextDocument({ content, language: 'markdown' })
                .then(d => vscode.window.showTextDocument(d, { preview: true }));
        }),

        vscode.commands.registerCommand('coe.showConfig', () => {
            const config = configManager.getConfig();
            const content = JSON.stringify(config, null, 2);
            vscode.workspace.openTextDocument({ content, language: 'json' })
                .then(d => vscode.window.showTextDocument(d, { preview: true }));
        }),

        vscode.commands.registerCommand('coe.viewAuditLog', async () => {
            const log = database.getAuditLog(50);
            const content = log.map(e =>
                `[${e.created_at}] ${e.agent}: ${e.action} — ${e.detail}`
            ).join('\n');
            const doc = await vscode.workspace.openTextDocument({ content, language: 'log' });
            await vscode.window.showTextDocument(doc, { preview: true });
        }),

        vscode.commands.registerCommand('coe.openPlanningWizard', () => {
            const port = mcpServer.getPort();
            vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${port}/app`));
        }),

        vscode.commands.registerCommand('coe.exportPlan', async () => {
            const plan = database.getActivePlan();
            if (!plan) {
                vscode.window.showInformationMessage('No active plan.');
                return;
            }
            const tasks = database.getTasksByPlan(plan.id);
            const content = JSON.stringify({ plan, tasks }, null, 2);
            const doc = await vscode.workspace.openTextDocument({ content, language: 'json' });
            await vscode.window.showTextDocument(doc);
        }),

        vscode.commands.registerCommand('coe.startMCPServer', () => {
            vscode.window.showInformationMessage(`MCP Server running on port ${mcpServer.getPort()}`);
        }),

        vscode.commands.registerCommand('coe.stopMCPServer', () => {
            mcpServer.dispose();
            vscode.window.showInformationMessage('MCP Server stopped.');
        }),

        vscode.commands.registerCommand('coe.clearOfflineCache', () => {
            vscode.window.showInformationMessage('Offline cache cleared.');
        }),

        vscode.commands.registerCommand('coe.openConversation', () => {
            refreshAll();
        }),

        vscode.commands.registerCommand('coe.checkpointCommit', async () => {
            const verifiedTasks = database.getTasksByStatus('verified');
            const lastCheckpoint = database.getAuditLog(100, 'system')
                .find(e => e.action === 'checkpoint_commit');
            const newlyVerified = lastCheckpoint
                ? verifiedTasks.filter(t => t.updated_at > lastCheckpoint.created_at)
                : verifiedTasks;

            if (newlyVerified.length === 0) {
                vscode.window.showInformationMessage('No newly verified tasks since last checkpoint.');
                return;
            }

            const confirm = await vscode.window.showInformationMessage(
                `${newlyVerified.length} task(s) verified since last checkpoint. Create a checkpoint commit?`,
                'Open Git', 'Cancel'
            );
            if (confirm !== 'Open Git') return;

            database.addAuditLog('system', 'checkpoint_commit',
                `Checkpoint: ${newlyVerified.length} tasks verified — ${newlyVerified.map(t => t.title).join(', ')}`
            );
            // Open the VS Code source control view so user can commit
            vscode.commands.executeCommand('workbench.view.scm');
        }),

        vscode.commands.registerCommand('coe.tagRelease', () => {
            vscode.window.showInformationMessage('Tag release — use your git client to tag.');
        }),

        vscode.commands.registerCommand('coe.importGitHubIssues', async () => {
            const github = configManager.getConfig().github;
            if (!github?.token || !github.owner || !github.repo) {
                vscode.window.showWarningMessage(
                    'GitHub not configured. Add github.token, github.owner, and github.repo to .coe/config.json'
                );
                return;
            }

            const client = new GitHubClient(github.token, outputChannel);
            const syncService = new GitHubSyncService(client, database, configManager, outputChannel);

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Importing GitHub issues...',
                cancellable: false,
            }, async () => {
                const result = await syncService.importIssues();
                vscode.window.showInformationMessage(
                    `GitHub import: ${result.imported} new, ${result.updated} updated, ${result.errors} errors.`
                );
                refreshAll();
            });
        }),

        vscode.commands.registerCommand('coe.syncGitHubIssues', async () => {
            const github = configManager.getConfig().github;
            if (!github?.token || !github.owner || !github.repo) {
                vscode.window.showWarningMessage(
                    'GitHub not configured. Add github.token, github.owner, and github.repo to .coe/config.json'
                );
                return;
            }

            const client = new GitHubClient(github.token, outputChannel);
            const syncService = new GitHubSyncService(client, database, configManager, outputChannel);

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Syncing GitHub issues (bidirectional)...',
                cancellable: false,
            }, async () => {
                const result = await syncService.syncBidirectional();
                vscode.window.showInformationMessage(
                    `GitHub sync: ${result.pulled} pulled, ${result.pushed} pushed, ${result.errors} errors.`
                );
                refreshAll();
            });
        }),

        // --- Plan Builder ---
        vscode.commands.registerCommand('coe.openPlanBuilder', () => {
            const builder = new PlanBuilderPanel(database, deps.extensionUri);
            builder.open();
        }),

        vscode.commands.registerCommand('coe.exportPlanAsMarkdown', async () => {
            const plan = database.getActivePlan();
            if (!plan) {
                vscode.window.showInformationMessage('No active plan to export.');
                return;
            }
            const builder = new PlanBuilderPanel(database, deps.extensionUri);
            await builder.exportPlanAsMarkdown(plan.id);
        }),

        vscode.commands.registerCommand('coe.triggerEvolution', async () => {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Running evolution analysis...',
                cancellable: false,
            }, async () => {
                // Run boss health check
                const healthResult = await orchestrator.getBossAgent().checkSystemHealth();

                // Run explicit pattern detection if evolution service is wired
                const evolutionService = orchestrator.getEvolutionService?.();
                let patternsFound = 0;
                if (evolutionService) {
                    const patterns = await evolutionService.detectPatterns();
                    patternsFound = patterns.length;
                }

                vscode.window.showInformationMessage(
                    `Evolution: ${patternsFound} pattern(s) detected. Health: ${healthResult.content.substring(0, 300)}`
                );
                refreshAll();
            });
        }),
    );

    // --- v2.0: Ethics Commands ---
    if (deps.ethicsEngine) {
        const ethicsEngine = deps.ethicsEngine;
        context.subscriptions.push(
            vscode.commands.registerCommand('coe.viewEthicsModules', async () => {
                const modules = ethicsEngine.getModules();
                const content = modules.map(m =>
                    `## ${m.name} ${m.enabled ? '✅' : '❌'}\n` +
                    `Sensitivity: ${m.sensitivity}\n` +
                    `Scope: ${m.scope}\n` +
                    `Description: ${m.description}\n` +
                    `Blocked actions: ${m.blocked_actions.join(', ') || 'none'}`
                ).join('\n\n---\n\n');
                const doc = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
                await vscode.window.showTextDocument(doc, { preview: true });
            }),

            vscode.commands.registerCommand('coe.toggleEthicsModule', async () => {
                const modules = ethicsEngine.getModules();
                const selected = await vscode.window.showQuickPick(
                    modules.map(m => ({
                        label: `${m.enabled ? '✅' : '❌'} ${m.name}`,
                        moduleId: m.id,
                        enabled: m.enabled,
                    })),
                    { placeHolder: 'Select module to toggle' }
                );
                if (!selected) return;
                if (selected.enabled) {
                    ethicsEngine.disableModule(selected.moduleId);
                    vscode.window.showInformationMessage(`Ethics module "${selected.label}" disabled.`);
                } else {
                    ethicsEngine.enableModule(selected.moduleId);
                    vscode.window.showInformationMessage(`Ethics module "${selected.label}" enabled.`);
                }
            }),

            vscode.commands.registerCommand('coe.viewEthicsAudit', async () => {
                const entries = ethicsEngine.audit(50);
                const content = entries.map(e =>
                    `[${e.created_at}] ${e.decision} — ${e.action_description} (module: ${e.module_id}, by: ${e.requestor})`
                ).join('\n');
                const doc = await vscode.workspace.openTextDocument({ content: content || 'No ethics audit entries yet.', language: 'log' });
                await vscode.window.showTextDocument(doc, { preview: true });
            }),
        );
    }

    // --- v2.0: Coding Agent Commands ---
    if (deps.codingAgentService) {
        const codingAgent = deps.codingAgentService;
        context.subscriptions.push(
            vscode.commands.registerCommand('coe.codingAgentCommand', async () => {
                const command = await vscode.window.showInputBox({
                    prompt: 'Coding agent command',
                    placeHolder: 'e.g., "create a login form", "fix the bug in auth", "explain the sync service"',
                });
                if (!command) return;

                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Coding agent working...',
                    cancellable: false,
                }, async () => {
                    const response = await codingAgent.processCommand(command, {});
                    vscode.window.showInformationMessage(
                        `${response.explanation.substring(0, 300)}`
                    );
                    refreshAll();
                });
            }),

            vscode.commands.registerCommand('coe.viewCodeDiffs', async () => {
                const diffs = deps.database.getPendingCodeDiffs();
                if (diffs.length === 0) {
                    vscode.window.showInformationMessage('No pending code diffs.');
                    return;
                }
                const content = diffs.map((d: import('./types').CodeDiff) =>
                    `## Diff: ${d.id}\n` +
                    `Entity: ${d.entity_type}/${d.entity_id}\n` +
                    `Status: ${d.status}\n` +
                    `Lines: +${d.lines_added} / -${d.lines_removed}\n` +
                    `\`\`\`diff\n${d.unified_diff}\n\`\`\``
                ).join('\n\n---\n\n');
                const doc = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
                await vscode.window.showTextDocument(doc, { preview: true });
            }),

            vscode.commands.registerCommand('coe.approveCodeDiff', async () => {
                const diffs = deps.database.getPendingCodeDiffs();
                if (diffs.length === 0) {
                    vscode.window.showInformationMessage('No pending diffs to approve.');
                    return;
                }
                const selected = await vscode.window.showQuickPick(
                    diffs.map((d: import('./types').CodeDiff) => ({
                        label: `${d.id.substring(0, 8)} (+${d.lines_added}/-${d.lines_removed})`,
                        diffId: d.id,
                    })),
                    { placeHolder: 'Select diff to approve' }
                );
                if (!selected) return;
                codingAgent.approveDiff(selected.diffId, 'user');
                vscode.window.showInformationMessage('Diff approved.');
                refreshAll();
            }),

            vscode.commands.registerCommand('coe.rejectCodeDiff', async () => {
                const diffs = deps.database.getPendingCodeDiffs();
                if (diffs.length === 0) {
                    vscode.window.showInformationMessage('No pending diffs to reject.');
                    return;
                }
                const selected = await vscode.window.showQuickPick(
                    diffs.map((d: import('./types').CodeDiff) => ({
                        label: `${d.id.substring(0, 8)} (+${d.lines_added}/-${d.lines_removed})`,
                        diffId: d.id,
                    })),
                    { placeHolder: 'Select diff to reject' }
                );
                if (!selected) return;
                const reason = await vscode.window.showInputBox({ prompt: 'Rejection reason' });
                codingAgent.rejectDiff(selected.diffId, 'user', reason || 'Rejected by user');
                vscode.window.showInformationMessage('Diff rejected.');
                refreshAll();
            }),
        );
    }

    // --- v2.0: Sync Commands ---
    if (deps.syncService) {
        const syncSvc = deps.syncService;
        context.subscriptions.push(
            vscode.commands.registerCommand('coe.configureSync', async () => {
                const backend = await vscode.window.showQuickPick(
                    ['cloud', 'nas', 'p2p'],
                    { placeHolder: 'Select sync backend' }
                );
                if (!backend) return;

                const endpoint = await vscode.window.showInputBox({
                    prompt: 'Sync endpoint URL',
                    placeHolder: backend === 'cloud' ? 'https://sync.example.com' : backend === 'nas' ? '//nas/share' : 'peer-address:port',
                });
                if (!endpoint) return;

                await syncSvc.configure({
                    device_id: require('os').hostname(),
                    backend: backend as any,
                    endpoint,
                    enabled: true,
                });
                vscode.window.showInformationMessage(`Sync configured: ${backend} → ${endpoint}`);
                refreshAll();
            }),

            vscode.commands.registerCommand('coe.triggerSync', async () => {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Syncing...',
                    cancellable: false,
                }, async () => {
                    const state = await syncSvc.sync();
                    vscode.window.showInformationMessage(
                        `Sync ${state.status}: ${state.pending_changes} pending, ${state.unresolved_conflicts} conflicts`
                    );
                    refreshAll();
                });
            }),

            vscode.commands.registerCommand('coe.viewSyncStatus', async () => {
                const state = syncSvc.getStatus();
                const content = JSON.stringify(state, null, 2);
                const doc = await vscode.workspace.openTextDocument({ content, language: 'json' });
                await vscode.window.showTextDocument(doc, { preview: true });
            }),

            vscode.commands.registerCommand('coe.resolveConflict', async () => {
                if (!deps.conflictResolver) return;
                const conflicts = deps.conflictResolver.getUnresolved();
                if (conflicts.length === 0) {
                    vscode.window.showInformationMessage('No unresolved conflicts.');
                    return;
                }
                const selected = await vscode.window.showQuickPick(
                    conflicts.map(c => ({
                        label: `${c.entity_type}/${c.entity_id} — ${c.conflicting_fields.join(', ')}`,
                        conflictId: c.id,
                    })),
                    { placeHolder: 'Select conflict to resolve' }
                );
                if (!selected) return;

                const strategy = await vscode.window.showQuickPick(
                    ['KeepLocal', 'KeepRemote', 'Merge', 'LastWriteWins'],
                    { placeHolder: 'Resolution strategy' }
                ) as string | undefined;
                if (!strategy) return;

                syncSvc.resolveConflict(
                    selected.conflictId,
                    strategy as ConflictResolutionStrategy,
                    'user'
                );
                vscode.window.showInformationMessage('Conflict resolved.');
                refreshAll();
            }),
        );
    }

    // --- v2.0: Transparency Log Commands ---
    if (deps.transparencyLogger) {
        const logger = deps.transparencyLogger;
        context.subscriptions.push(
            vscode.commands.registerCommand('coe.viewTransparencyLog', async () => {
                const entries = logger.getLog({ limit: 100 });
                const content = entries.map((e: import('./types').ActionLog) =>
                    `[${e.created_at}] [${e.severity}] ${e.source}/${e.category}: ${e.action} — ${e.detail}`
                ).join('\n');
                const doc = await vscode.workspace.openTextDocument({
                    content: content || 'No transparency log entries yet.',
                    language: 'log',
                });
                await vscode.window.showTextDocument(doc, { preview: true });
            }),
        );
    }
}
