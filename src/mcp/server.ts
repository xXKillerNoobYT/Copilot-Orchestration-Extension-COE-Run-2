import * as vscode from 'vscode';
import * as http from 'http';
import { Database } from '../core/database';
import { ConfigManager } from '../core/config';
import { Orchestrator } from '../agents/orchestrator';
import { CodingAgentService } from '../core/coding-agent';
import { AgentContext, TaskStatus } from '../types';
import { handleApiRequest } from '../webapp/api';
import { getAppHtml } from '../webapp/app';

interface MCPToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

interface MCPToolCall {
    name: string;
    arguments: Record<string, unknown>;
}

export class MCPServer {
    private server: http.Server | null = null;
    private port = 3030;
    private tools: Map<string, MCPToolDefinition> = new Map();
    private handlers: Map<string, (args: Record<string, unknown>) => Promise<unknown>> = new Map();

    constructor(
        private orchestrator: Orchestrator,
        private database: Database,
        private config: ConfigManager,
        private outputChannel: vscode.OutputChannel,
        private codingAgentService?: CodingAgentService
    ) {}

    async initialize(): Promise<void> {
        this.registerTools();
        await this.startServer();
        this.outputChannel.appendLine(`MCP Server initialized on port ${this.port}`);
    }

    private registerTools(): void {
        // Tool 1: getNextTask
        this.registerTool({
            name: 'getNextTask',
            description: 'Returns the highest-priority ready task with all context needed for implementation',
            inputSchema: {
                type: 'object',
                properties: {},
                required: [],
            },
        }, async () => {
            const task = this.orchestrator.getNextTask();
            if (!task) {
                return { success: false, error: 'No tasks ready. All tasks are either completed, blocked, or pending verification.' };
            }

            // Mark as in progress
            this.database.updateTask(task.id, { status: TaskStatus.InProgress });
            this.database.addAuditLog('mcp', 'get_next_task', `Task "${task.title}" assigned to coding agent`);

            // Build context bundle
            const plan = task.plan_id ? this.database.getPlan(task.plan_id) : null;
            const conversations = this.database.getConversationsByTask(task.id);
            const depTasks = task.dependencies.map(id => this.database.getTask(id)).filter(Boolean);

            return {
                success: true,
                data: {
                    task_id: task.id,
                    title: task.title,
                    description: task.description,
                    priority: task.priority,
                    acceptance_criteria: task.acceptance_criteria,
                    estimated_minutes: task.estimated_minutes,
                    context_bundle: {
                        plan_name: plan?.name || null,
                        plan_config: plan ? JSON.parse(plan.config_json) : null,
                        completed_dependencies: depTasks.map(t => ({
                            title: t!.title,
                            files_modified: t!.files_modified,
                        })),
                        previous_conversations: conversations.slice(-5).map(c => ({
                            role: c.role,
                            content: c.content,
                        })),
                    },
                    related_files: task.files_modified,
                },
            };
        });

        // Tool 2: reportTaskDone
        this.registerTool({
            name: 'reportTaskDone',
            description: 'Reports a task as completed and triggers the verification pipeline',
            inputSchema: {
                type: 'object',
                properties: {
                    task_id: { type: 'string', description: 'ID of the completed task' },
                    summary: { type: 'string', description: 'Summary of what was implemented' },
                    files_modified: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'List of files that were modified',
                    },
                    decisions_made: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'List of decisions made during implementation',
                    },
                },
                required: ['task_id', 'summary', 'files_modified'],
            },
        }, async (args) => {
            const taskId = args.task_id as string;
            const summary = args.summary as string;
            const filesModified = args.files_modified as string[];
            const decisions = (args.decisions_made as string[]) || [];

            try {
                await this.orchestrator.reportTaskDone(taskId, summary, filesModified);

                // Log decisions
                for (const decision of decisions) {
                    this.database.addAuditLog('coding_agent', 'decision', decision);
                }

                return {
                    success: true,
                    data: {
                        message: `Task ${taskId} marked as done. Verification will run in ${this.config.getConfig().verification.delaySeconds} seconds.`,
                    },
                };
            } catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        });

        // Tool 3: askQuestion
        this.registerTool({
            name: 'askQuestion',
            description: 'Ask a question when confused about implementation details. Returns evidence-based answer.',
            inputSchema: {
                type: 'object',
                properties: {
                    question: { type: 'string', description: 'The question to ask' },
                    task_id: { type: 'string', description: 'ID of the current task (optional)' },
                    context: { type: 'string', description: 'Additional context about the situation' },
                },
                required: ['question'],
            },
        }, async (args) => {
            const question = args.question as string;
            const taskId = args.task_id as string | undefined;
            const extraContext = args.context as string | undefined;

            const task = taskId ? this.database.getTask(taskId) || undefined : undefined;
            const plan = task?.plan_id ? this.database.getPlan(task.plan_id) || undefined : undefined;

            const context: AgentContext = {
                task,
                plan,
                conversationHistory: taskId ? this.database.getConversationsByTask(taskId) : [],
            };

            const fullQuestion = extraContext ? `${question}\n\nAdditional context: ${extraContext}` : question;
            const response = await this.orchestrator.callAgent('answer', fullQuestion, context);

            return {
                success: true,
                data: {
                    answer: response.content,
                    confidence: response.confidence || 80,
                    sources: response.sources || [],
                    escalated: response.actions?.some(a => a.type === 'escalate') || false,
                },
            };
        });

        // Tool 4: getErrors
        this.registerTool({
            name: 'getErrors',
            description: 'Report an error encountered during implementation. COE will log it and may create an investigation task.',
            inputSchema: {
                type: 'object',
                properties: {
                    task_id: { type: 'string', description: 'ID of the task that encountered the error' },
                    error_message: { type: 'string', description: 'The error message' },
                    stack_trace: { type: 'string', description: 'Stack trace (optional)' },
                },
                required: ['task_id', 'error_message'],
            },
        }, async (args) => {
            const taskId = args.task_id as string;
            const errorMessage = args.error_message as string;
            const stackTrace = args.stack_trace as string | undefined;

            this.database.addAuditLog('coding_agent', 'error',
                `Task ${taskId}: ${errorMessage}${stackTrace ? '\n' + stackTrace : ''}`);

            // Check if this is a repeated error (3+ times = investigation task)
            const recentErrors = this.database.getAuditLog(50, 'coding_agent')
                .filter(e => e.action === 'error' && e.detail.includes(taskId));

            if (recentErrors.length >= 3) {
                const task = this.database.getTask(taskId);
                this.database.createTask({
                    title: `Investigate repeated errors on: ${task?.title || taskId}`,
                    description: `Error has occurred ${recentErrors.length} times.\n\nLatest error: ${errorMessage}\n\nStack trace: ${stackTrace || 'N/A'}`,
                    priority: 'P1' as any,
                    plan_id: task?.plan_id,
                    dependencies: [taskId],
                });

                this.database.createTicket({
                    title: `Repeated errors on task: ${task?.title || taskId}`,
                    body: `This task has encountered ${recentErrors.length} errors. An investigation task has been created.`,
                    priority: 'P1' as any,
                    creator: 'system',
                    task_id: taskId,
                });
            }

            return {
                success: true,
                data: {
                    logged: true,
                    error_count: recentErrors.length,
                    investigation_created: recentErrors.length >= 3,
                },
            };
        });

        // Tool 5: callCOEAgent
        this.registerTool({
            name: 'callCOEAgent',
            description: 'Call a specific COE agent directly for specialized assistance',
            inputSchema: {
                type: 'object',
                properties: {
                    agent_name: {
                        type: 'string',
                        description: 'Name of the agent: planning, answer, verification, research, clarity, boss, or a custom agent name',
                    },
                    message: { type: 'string', description: 'The message to send to the agent' },
                    context: {
                        type: 'object',
                        description: 'Additional context (optional)',
                    },
                },
                required: ['agent_name', 'message'],
            },
        }, async (args) => {
            const agentName = args.agent_name as string;
            const message = args.message as string;

            const agentContext: AgentContext = {
                conversationHistory: [],
                additionalContext: args.context as Record<string, unknown> | undefined,
            };

            try {
                const response = await this.orchestrator.callAgent(agentName, message, agentContext);
                return {
                    success: true,
                    data: {
                        agent: agentName,
                        response: response.content,
                        confidence: response.confidence,
                        sources: response.sources,
                    },
                };
            } catch (error) {
                return {
                    success: false,
                    error: `Agent "${agentName}" error: ${error instanceof Error ? error.message : String(error)}`,
                };
            }
        });

        // Tool 6: scanCodeBase
        this.registerTool({
            name: 'scanCodeBase',
            description: 'Scan the project codebase for drift between the plan and actual implementation',
            inputSchema: {
                type: 'object',
                properties: {
                    plan_id: { type: 'string', description: 'ID of the plan to compare against (optional, uses active plan)' },
                },
                required: [],
            },
        }, async (args) => {
            const planId = args.plan_id as string | undefined;
            const plan = planId
                ? this.database.getPlan(planId)
                : this.database.getActivePlan();

            if (!plan) {
                return { success: false, error: 'No active plan found. Create a plan first.' };
            }

            const tasks = this.database.getTasksByPlan(plan.id);
            const verified = tasks.filter(t => t.status === TaskStatus.Verified);
            const failed = tasks.filter(t => t.status === TaskStatus.Failed);
            const notStarted = tasks.filter(t => t.status === TaskStatus.NotStarted);
            const inProgress = tasks.filter(t => t.status === TaskStatus.InProgress);

            const allModifiedFiles = new Set<string>();
            for (const task of verified) {
                for (const file of task.files_modified) {
                    allModifiedFiles.add(file);
                }
            }

            const driftPercentage = tasks.length > 0
                ? ((failed.length + notStarted.length) / tasks.length) * 100
                : 0;

            this.database.addAuditLog('mcp', 'scan_codebase',
                `Scan: ${verified.length}/${tasks.length} verified, drift: ${driftPercentage.toFixed(1)}%`);

            return {
                success: true,
                data: {
                    plan_name: plan.name,
                    total_tasks: tasks.length,
                    verified: verified.length,
                    failed: failed.length,
                    not_started: notStarted.length,
                    in_progress: inProgress.length,
                    aligned_files: Array.from(allModifiedFiles),
                    drift_percentage: Math.round(driftPercentage),
                    summary: `Plan "${plan.name}": ${verified.length}/${tasks.length} tasks verified (${(100 - driftPercentage).toFixed(0)}% aligned)`,
                },
            };
        });
    }

    private registerTool(
        definition: MCPToolDefinition,
        handler: (args: Record<string, unknown>) => Promise<unknown>
    ): void {
        this.tools.set(definition.name, definition);
        this.handlers.set(definition.name, handler);
    }

    private async startServer(): Promise<void> {
        this.server = http.createServer(async (req, res) => {
            // CORS headers
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }

            const url = new URL(req.url || '/', `http://localhost:${this.port}`);

            // GET /tools — list available tools
            if (req.method === 'GET' && url.pathname === '/tools') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    tools: Array.from(this.tools.values()),
                }));
                return;
            }

            // POST /call — call a tool
            if (req.method === 'POST' && url.pathname === '/call') {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', async () => {
                    try {
                        const toolCall = JSON.parse(body) as MCPToolCall;
                        const handler = this.handlers.get(toolCall.name);

                        if (!handler) {
                            res.writeHead(404, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: `Tool not found: ${toolCall.name}` }));
                            return;
                        }

                        this.outputChannel.appendLine(`MCP call: ${toolCall.name}(${JSON.stringify(toolCall.arguments).substring(0, 200)})`);
                        const result = await handler(toolCall.arguments || {});

                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(result));
                    } catch (error) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            success: false,
                            error: error instanceof Error ? error.message : String(error),
                        }));
                    }
                });
                return;
            }

            // POST /mcp — JSON-RPC 2.0 envelope (MCP protocol compliant)
            if (req.method === 'POST' && url.pathname === '/mcp') {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', async () => {
                    try {
                        const rpc = JSON.parse(body) as {
                            jsonrpc: string;
                            id: number | string;
                            method: string;
                            params?: Record<string, unknown>;
                        };

                        if (rpc.jsonrpc !== '2.0') {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({
                                jsonrpc: '2.0',
                                id: rpc.id ?? null,
                                error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' },
                            }));
                            return;
                        }

                        // Handle MCP protocol methods
                        if (rpc.method === 'initialize') {
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({
                                jsonrpc: '2.0',
                                id: rpc.id,
                                result: {
                                    protocolVersion: '2024-11-05',
                                    capabilities: {
                                        tools: { listChanged: false },
                                    },
                                    serverInfo: {
                                        name: 'coe-mcp-server',
                                        version: '1.0.0',
                                    },
                                },
                            }));
                            return;
                        }

                        if (rpc.method === 'tools/list') {
                            const tools = Array.from(this.tools.values()).map(t => ({
                                name: t.name,
                                description: t.description,
                                inputSchema: t.inputSchema,
                            }));
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({
                                jsonrpc: '2.0',
                                id: rpc.id,
                                result: { tools },
                            }));
                            return;
                        }

                        if (rpc.method === 'tools/call') {
                            const toolName = rpc.params?.name as string;
                            const toolArgs = (rpc.params?.arguments as Record<string, unknown>) || {};
                            const handler = this.handlers.get(toolName);

                            if (!handler) {
                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({
                                    jsonrpc: '2.0',
                                    id: rpc.id,
                                    error: { code: -32602, message: `Tool not found: ${toolName}` },
                                }));
                                return;
                            }

                            this.outputChannel.appendLine(`MCP JSON-RPC call: ${toolName}(${JSON.stringify(toolArgs).substring(0, 200)})`);
                            const result = await handler(toolArgs);
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({
                                jsonrpc: '2.0',
                                id: rpc.id,
                                result: {
                                    content: [{ type: 'text', text: JSON.stringify(result) }],
                                },
                            }));
                            return;
                        }

                        // Unknown method
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            jsonrpc: '2.0',
                            id: rpc.id,
                            error: { code: -32601, message: `Method not found: ${rpc.method}` },
                        }));

                    } catch (error) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            jsonrpc: '2.0',
                            id: null,
                            error: {
                                code: -32700,
                                message: `Parse error: ${error instanceof Error ? error.message : String(error)}`,
                            },
                        }));
                    }
                });
                return;
            }

            // GET /mcp/sse — Server-Sent Events for MCP discovery
            if (req.method === 'GET' && url.pathname === '/mcp/sse') {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                });

                // Send endpoint event pointing to the JSON-RPC endpoint
                const endpointUrl = `http://localhost:${this.port}/mcp`;
                res.write(`event: endpoint\ndata: ${endpointUrl}\n\n`);

                // Keep connection alive with periodic pings
                const pingInterval = setInterval(() => {
                    try { res.write(': ping\n\n'); } catch { clearInterval(pingInterval); }
                }, 30000);

                req.on('close', () => {
                    clearInterval(pingInterval);
                });
                return;
            }

            // GET /health
            if (req.method === 'GET' && url.pathname === '/health') {
                const stats = this.database.getStats();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'ok',
                    stats,
                    tools: Array.from(this.tools.keys()),
                }));
                return;
            }

            // GET /app — serve the web app
            if (req.method === 'GET' && (url.pathname === '/app' || url.pathname === '/app/')) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(getAppHtml(this.port));
                return;
            }

            // /api/* — REST API for web app
            if (url.pathname.startsWith('/api/')) {
                const handled = await handleApiRequest(req, res, url.pathname, this.database, this.orchestrator, this.config, this.codingAgentService);
                if (handled) return;
            }

            // GET / — info
            if (req.method === 'GET' && url.pathname === '/') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    name: 'COE MCP Server',
                    version: '1.0.0',
                    tools: Array.from(this.tools.keys()),
                    webapp: `http://localhost:${this.port}/app`,
                    mcp_endpoint: `http://localhost:${this.port}/mcp`,
                    mcp_sse: `http://localhost:${this.port}/mcp/sse`,
                    description: 'Copilot Orchestration Extension — MCP bridge for AI coding agents',
                }));
                return;
            }

            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
        });

        return new Promise<void>((resolve, reject) => {
            this.server!.on('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'EADDRINUSE') {
                    this.port++;
                    this.outputChannel.appendLine(`Port in use, trying ${this.port}`);
                    this.server!.listen(this.port, () => resolve());
                } else {
                    reject(err);
                }
            });
            this.server!.listen(this.port, () => {
                this.outputChannel.appendLine(`MCP Server listening on http://localhost:${this.port}`);
                resolve();
            });
        });
    }

    getPort(): number {
        return this.port;
    }

    getToolDefinitions(): MCPToolDefinition[] {
        return Array.from(this.tools.values());
    }

    dispose(): void {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }
}
