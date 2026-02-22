import * as http from 'http';
import { Database } from '../core/database';
import { ConfigManager } from '../core/config';
import { Orchestrator } from '../agents/orchestrator';
import { CodingAgentService } from '../core/coding-agent';
import { AgentContext, TaskStatus, TicketPriority, TaskPriority, MCPConfirmationStatus, OutputChannelLike } from '../types';
import { handleApiRequest } from '../webapp/api';
import { getAppHtml } from '../webapp/app';
import { TicketProcessorService } from '../core/ticket-processor';
import { getEventBus, COEEvent } from '../core/event-bus';

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
    private ticketProcessor: TicketProcessorService | null = null;
    private confirmationEnabled = false;

    constructor(
        private orchestrator: Orchestrator,
        private database: Database,
        private config: ConfigManager,
        private outputChannel: OutputChannelLike,
        private codingAgentService?: CodingAgentService
    ) {}

    /**
     * v9.0: Enable or disable MCP confirmation stage for callCOEAgent.
     * When enabled, first call returns agent description + confirmation ID,
     * second call with confirmation_id executes.
     */
    setConfirmationEnabled(enabled: boolean): void {
        this.confirmationEnabled = enabled;
        this.outputChannel.appendLine(`MCP Server: Confirmation stage ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Wire the TicketProcessorService for task queue integration.
     * Called after both MCPServer and TicketProcessor are initialized.
     */
    setTicketProcessor(processor: TicketProcessorService): void {
        this.ticketProcessor = processor;
        this.outputChannel.appendLine('MCP Server: TicketProcessorService wired for task queue integration');
    }

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
            // Use ticket processor if available (I1: ticket processor drives MCP task queue)
            if (this.ticketProcessor) {
                const codingTicket = this.ticketProcessor.getNextCodingTask();
                if (codingTicket && codingTicket.task_id) {
                    const task = this.database.getTask(codingTicket.task_id);
                    if (task) {
                        this.database.updateTask(task.id, { status: TaskStatus.InProgress });
                        this.database.addAuditLog('mcp', 'get_next_task', `Task "${task.title}" assigned via ticket processor`);
                        const plan = task.plan_id ? this.database.getPlan(task.plan_id) : null;
                        const planConfig = plan ? JSON.parse(plan.config_json || '{}') : {};
                        return {
                            success: true,
                            data: {
                                task_id: task.id,
                                title: task.title,
                                description: task.description,
                                priority: task.priority,
                                acceptance_criteria: task.acceptance_criteria,
                                estimated_minutes: task.estimated_minutes,
                                context_bundle: { plan_name: plan?.name || null, plan_config: planConfig },
                                related_files: task.files_modified,
                                ticket_id: codingTicket.id,
                            },
                        };
                    }
                }
            }

            // v4.1 (WS1D): Use atomic claimNextReadyTask to prevent two MCP clients getting the same task
            const task = this.database.claimNextReadyTask();
            if (!task) {
                return {
                    success: false,
                    error: 'No tasks ready. All tasks are either completed, blocked, or pending verification.',
                    status: 'waiting',
                    next_recommended_tool: 'getNextTask',
                    reason: 'No tasks available. Call getNextTask again when ready.',
                };
            }

            // Task already claimed (status set to InProgress by claimNextReadyTask)
            this.database.addAuditLog('mcp', 'get_next_task', `Task "${task.title}" atomically claimed by coding agent`);

            // Build context bundle
            const plan = task.plan_id ? this.database.getPlan(task.plan_id) : null;
            const conversations = this.database.getConversationsByTask(task.id);
            const depTasks = task.dependencies.map(id => this.database.getTask(id)).filter(Boolean);

            // v3.0: Build enhanced context with design + data model references
            // v4.1: Only include design context when task is design-related (optimization)
            const planConfig = plan ? JSON.parse(plan.config_json || '{}') : {};
            let designContext: Record<string, unknown> | null = null;
            const designKeywords = ['design', 'page', 'component', 'layout', 'ui', 'ux', 'style', 'css', 'visual', 'template'];
            const taskText = `${task.title} ${task.description}`.toLowerCase();
            const isDesignRelated = designKeywords.some(kw => taskText.includes(kw))
                || (task as any).source_page_ids;
            if (task.plan_id && isDesignRelated) {
                const pages = this.database.getDesignPagesByPlan(task.plan_id);
                const dataModels = this.database.getDataModelsByPlan(task.plan_id);
                const answeredQuestions = this.database.getAIQuestionsByPlan(task.plan_id, 'answered');
                const autofilledQuestions = this.database.getAIQuestionsByPlan(task.plan_id, 'autofilled');
                designContext = {
                    pages: pages.map(p => ({ name: p.name, route: p.route })),
                    data_models: dataModels.map(m => ({ name: m.name, fields: m.fields.length, relationships: m.relationships.length })),
                    answered_questions: [...answeredQuestions, ...autofilledQuestions].map(q => ({ question: q.question, answer: q.user_answer })),
                    tech_stack: planConfig.techStack || null,
                    features: planConfig.features || [],
                };
            }

            // Parse intelligent task requirements if available
            let taskReqs: Record<string, unknown> | null = null;
            if (task.task_requirements) {
                try { taskReqs = JSON.parse(task.task_requirements); } catch { /* ignore */ }
            }

            return {
                success: true,
                data: {
                    task_id: task.id,
                    title: task.title,
                    description: task.description,
                    priority: task.priority,
                    acceptance_criteria: task.acceptance_criteria,
                    estimated_minutes: task.estimated_minutes,
                    // Intelligent task requirements — structured guidance for coding agents
                    task_requirements: taskReqs,
                    context_bundle: {
                        plan_name: plan?.name || null,
                        plan_config: planConfig,
                        completed_dependencies: depTasks.map(t => ({
                            title: t!.title,
                            files_modified: t!.files_modified,
                        })),
                        previous_conversations: conversations.slice(-5).map(c => ({
                            role: c.role,
                            content: c.content,
                        })),
                        design_context: designContext,
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
                    next_recommended_tool: 'getNextTask',
                    reason: 'Task verified. Next task is ready for implementation.',
                    available_tools: ['getNextTask', 'askQuestion', 'getErrors', 'scanCodeBase'],
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
                    confidence: response.confidence ?? 80,
                    sources: response.sources || [],
                    escalated: response.actions?.some(a => a.type === 'escalate') || false,
                },
                next_recommended_tool: 'getNextTask',
                reason: 'Your question has been answered. Use getNextTask to continue with the next available task.',
                available_tools: ['getNextTask', 'askQuestion', 'getErrors', 'scanCodeBase'],
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
                    priority: TaskPriority.P1,
                    plan_id: task?.plan_id,
                    dependencies: [taskId],
                });

                this.database.createTicket({
                    title: `Repeated errors on task: ${task?.title || taskId}`,
                    body: `This task has encountered ${recentErrors.length} errors. An investigation task has been created.`,
                    priority: TicketPriority.P1,
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

        // Tool 5: callCOEAgent (v9.0: with optional confirmation stage)
        this.registerTool({
            name: 'callCOEAgent',
            description: 'Call a specific COE agent directly for specialized assistance. When confirmation is enabled, first call returns agent description + confirmation_id; pass confirmation_id to execute.',
            inputSchema: {
                type: 'object',
                properties: {
                    agent_name: {
                        type: 'string',
                        description: 'Name of the agent: planning, answer, verification, research, clarity, boss, review, design_architect, backend_architect, gap_hunter, design_hardener, decision_memory, coding_director, user_communication, or a custom agent name',
                    },
                    message: { type: 'string', description: 'The message to send to the agent' },
                    context: {
                        type: 'object',
                        description: 'Additional context (optional)',
                    },
                    confirmation_id: {
                        type: 'string',
                        description: 'v9.0: Confirmation ID from a previous call (when confirmation stage is enabled)',
                    },
                },
                required: ['agent_name', 'message'],
            },
        }, async (args) => {
            const agentName = args.agent_name as string;
            const message = args.message as string;
            const confirmationId = args.confirmation_id as string | undefined;

            // Validate required parameters
            if (!agentName || typeof agentName !== 'string') {
                return { success: false, error: 'Missing or invalid required parameter: agent_name. Expected a string identifying the agent (e.g., "planning", "verification", "answer").' };
            }
            if (!message || typeof message !== 'string') {
                return { success: false, error: 'Missing or invalid required parameter: message. Expected a string with the task or question for the agent.' };
            }

            // v9.0: Confirmation stage
            if (this.confirmationEnabled && !confirmationId) {
                // Step 1: Create confirmation — return agent description, don't execute yet
                const description = this.getAgentDescription(agentName);
                const confirmation = this.database.createMCPConfirmation({
                    tool_name: 'callCOEAgent',
                    agent_name: agentName,
                    description: description.description,
                    arguments_preview: JSON.stringify({ agent_name: agentName, message: message.substring(0, 200) }),
                    expires_at: new Date(Date.now() + (this.config.getConfig().mcpConfirmationTimeoutMs ?? 60000)).toISOString(),
                });

                return {
                    success: true,
                    confirmation_required: true,
                    data: {
                        confirmation_id: confirmation.id,
                        agent: agentName,
                        agent_description: description,
                        message_preview: message.substring(0, 200),
                        expires_at: confirmation.expires_at,
                        instructions: 'Call callCOEAgent again with the confirmation_id to execute.',
                    },
                };
            }

            // v9.0: Validate confirmation if provided
            if (this.confirmationEnabled && confirmationId) {
                const confirmation = this.database.getMCPConfirmation(confirmationId);
                if (!confirmation) {
                    return { success: false, error: `Confirmation not found: ${confirmationId}` };
                }
                if (confirmation.status !== MCPConfirmationStatus.Pending) {
                    return { success: false, error: `Confirmation already ${confirmation.status}` };
                }
                if (new Date(confirmation.expires_at) < new Date()) {
                    this.database.updateMCPConfirmation(confirmationId, {
                        status: MCPConfirmationStatus.Expired,
                    });
                    return { success: false, error: 'Confirmation has expired. Please try again.' };
                }
                // Mark as approved
                this.database.updateMCPConfirmation(confirmationId, {
                    status: MCPConfirmationStatus.Approved,
                    user_response: 'auto-confirmed via confirmation_id',
                });
            }

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

        // Tool 7: getAgentDescriptions (v9.0)
        this.registerTool({
            name: 'getAgentDescriptions',
            description: 'Get descriptions of all available COE agents. Use this to understand which agent to call.',
            inputSchema: {
                type: 'object',
                properties: {},
                required: [],
            },
        }, async () => {
            return {
                success: true,
                data: {
                    agents: this.getAllAgentDescriptions(),
                },
            };
        });

        // Tool 8: confirmAgentCall (v9.0)
        this.registerTool({
            name: 'confirmAgentCall',
            description: 'Approve or reject a pending MCP agent call confirmation.',
            inputSchema: {
                type: 'object',
                properties: {
                    confirmation_id: { type: 'string', description: 'The confirmation ID to approve or reject' },
                    approved: { type: 'boolean', description: 'Whether to approve (true) or reject (false)' },
                    notes: { type: 'string', description: 'Optional notes about the decision' },
                },
                required: ['confirmation_id', 'approved'],
            },
        }, async (args) => {
            const confirmationId = args.confirmation_id as string;
            const approved = args.approved as boolean;
            const notes = args.notes as string | undefined;

            const confirmation = this.database.getMCPConfirmation(confirmationId);
            if (!confirmation) {
                return { success: false, error: `Confirmation not found: ${confirmationId}` };
            }
            if (confirmation.status !== MCPConfirmationStatus.Pending) {
                return { success: false, error: `Confirmation already ${confirmation.status}` };
            }
            if (new Date(confirmation.expires_at) < new Date()) {
                this.database.updateMCPConfirmation(confirmationId, {
                    status: MCPConfirmationStatus.Expired,
                });
                return { success: false, error: 'Confirmation has expired.' };
            }

            this.database.updateMCPConfirmation(confirmationId, {
                status: approved ? MCPConfirmationStatus.Approved : MCPConfirmationStatus.Rejected,
                user_response: notes ?? (approved ? 'approved' : 'rejected'),
            });

            return {
                success: true,
                data: {
                    confirmation_id: confirmationId,
                    status: approved ? 'approved' : 'rejected',
                },
            };
        });

        // Tool 9: getTicketHistory (v4.1 — WS1A)
        this.registerTool({
            name: 'getTicketHistory',
            description: 'Get the processing run history for a ticket. Returns all run logs so the AI can learn from previous failures.',
            inputSchema: {
                type: 'object',
                properties: {
                    ticket_id: { type: 'string', description: 'ID of the ticket to get history for' },
                },
                required: ['ticket_id'],
            },
        }, async (args) => {
            const ticketId = args.ticket_id as string;
            const ticket = this.database.getTicket(ticketId);
            if (!ticket) {
                return {
                    success: false,
                    error: `Ticket not found: ${ticketId}`,
                    error_code: 'NOT_FOUND',
                };
            }

            const runs = this.database.getTicketRuns(ticketId);
            const replies = this.database.getTicketReplies(ticketId);

            return {
                success: true,
                data: {
                    ticket_id: ticketId,
                    ticket_number: ticket.ticket_number,
                    title: ticket.title,
                    status: ticket.status,
                    processing_status: ticket.processing_status,
                    last_error: ticket.last_error,
                    last_error_at: ticket.last_error_at,
                    retry_count: ticket.retry_count,
                    runs: runs.map(r => ({
                        run_number: r.run_number,
                        agent_name: r.agent_name,
                        status: r.status,
                        prompt_sent: r.prompt_sent.substring(0, 500),
                        response_received: r.response_received?.substring(0, 500) ?? null,
                        review_result: r.review_result,
                        verification_result: r.verification_result,
                        error_message: r.error_message,
                        error_stack: r.error_stack?.substring(0, 500) ?? null,
                        tokens_used: r.tokens_used,
                        duration_ms: r.duration_ms,
                        started_at: r.started_at,
                        completed_at: r.completed_at,
                    })),
                    recent_replies: replies.slice(-10).map(r => ({
                        author: r.author,
                        body: r.body.substring(0, 300),
                        created_at: r.created_at,
                    })),
                },
            };
        });

        // Tool 10: addTicketNote (v11.0 — agent note-taking)
        this.registerTool({
            name: 'addTicketNote',
            description: 'Add a timestamped note to a ticket. Use this to record observations, progress updates, warnings, or context that future agents should know about. Notes are permanently stored on the ticket and visible to all subsequent agents.',
            inputSchema: {
                type: 'object',
                properties: {
                    ticket_id: { type: 'string', description: 'ID of the ticket to annotate' },
                    note: { type: 'string', description: 'The note content — what happened, what was observed, what should be done next' },
                    author: { type: 'string', description: 'Name of the agent or entity adding the note (defaults to "mcp-agent")' },
                    error_context: { type: 'string', description: 'Optional: If this note is about an error, describe the error context' },
                    suggested_actions: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Optional: If there was an issue, list suggested corrective actions',
                    },
                },
                required: ['ticket_id', 'note'],
            },
        }, async (args) => {
            const ticketId = args.ticket_id as string;
            const noteText = args.note as string;
            const author = (args.author as string) || 'mcp-agent';
            const errorContext = args.error_context as string | undefined;
            const suggestedActions = args.suggested_actions as string[] | undefined;

            const ticket = this.database.getTicket(ticketId);
            if (!ticket) {
                return { success: false, error: `Ticket not found: ${ticketId}`, error_code: 'NOT_FOUND' };
            }

            this.database.addAgentNote(ticketId, {
                author,
                note: noteText,
                errorContext,
                suggestedActions,
            });

            const eventBus = getEventBus();
            eventBus.emit('ticket:note_added' as any, 'mcp-server', {
                ticketId,
                author,
                note: noteText.substring(0, 200),
            });

            this.database.addAuditLog('mcp', 'add_ticket_note', `Note added to ticket ${ticketId} by ${author}: ${noteText.substring(0, 100)}`);

            return {
                success: true,
                data: {
                    ticket_id: ticketId,
                    ticket_number: ticket.ticket_number,
                    author,
                    note_preview: noteText.substring(0, 200),
                    timestamp: new Date().toISOString(),
                },
            };
        });

        // Tool 11: addTicketReference (v11.0 — cross-ticket linking)
        this.registerTool({
            name: 'addTicketReference',
            description: 'Link two tickets together with a relationship type. Use this to track dependencies, blockers, sub-tasks, and related work across tickets. Both tickets are updated with the reference.',
            inputSchema: {
                type: 'object',
                properties: {
                    ticket_id: { type: 'string', description: 'ID of the ticket to add a reference FROM' },
                    referenced_ticket_id: { type: 'string', description: 'ID of the ticket being referenced (the target)' },
                    relationship: {
                        type: 'string',
                        description: 'Type of relationship: related_to, depends_on, blocks, subtask_of, parent_of, duplicate_of',
                        enum: ['related_to', 'depends_on', 'blocks', 'subtask_of', 'parent_of', 'duplicate_of'],
                    },
                },
                required: ['ticket_id', 'referenced_ticket_id'],
            },
        }, async (args) => {
            const ticketId = args.ticket_id as string;
            const referencedTicketId = args.referenced_ticket_id as string;
            const relationship = (args.relationship as string) || 'related_to';

            const ticket = this.database.getTicket(ticketId);
            if (!ticket) {
                return { success: false, error: `Ticket not found: ${ticketId}`, error_code: 'NOT_FOUND' };
            }

            const referencedTicket = this.database.getTicket(referencedTicketId);
            if (!referencedTicket) {
                return { success: false, error: `Referenced ticket not found: ${referencedTicketId}`, error_code: 'NOT_FOUND' };
            }

            // Add the reference (forward direction)
            this.database.addTicketReference(ticketId, referencedTicketId);

            // Add reverse reference too (if A references B, B should reference A)
            this.database.addTicketReference(referencedTicketId, ticketId);

            // If it's a blocking relationship, update the blocking_ticket_id field
            if (relationship === 'depends_on' || relationship === 'blocks') {
                const blockingId = relationship === 'depends_on' ? referencedTicketId : ticketId;
                const blockedId = relationship === 'depends_on' ? ticketId : referencedTicketId;
                this.database.updateTicket(blockedId, { blocking_ticket_id: blockingId });
            }

            // Add agent notes for audit trail
            this.database.addAgentNote(ticketId, {
                author: 'mcp-server',
                note: `Reference added: ${relationship} → TK-${referencedTicket.ticket_number} (${referencedTicketId})`,
            });
            this.database.addAgentNote(referencedTicketId, {
                author: 'mcp-server',
                note: `Referenced by: TK-${ticket.ticket_number} (${ticketId}) — relationship: ${relationship}`,
            });

            const eventBus = getEventBus();
            eventBus.emit('ticket:reference_added' as any, 'mcp-server', {
                ticketId,
                referencedTicketId,
                relationship,
            });

            this.database.addAuditLog('mcp', 'add_ticket_reference',
                `Reference: ${ticketId} ${relationship} ${referencedTicketId}`);

            return {
                success: true,
                data: {
                    ticket_id: ticketId,
                    referenced_ticket_id: referencedTicketId,
                    relationship,
                    ticket_number: ticket.ticket_number,
                    referenced_ticket_number: referencedTicket.ticket_number,
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
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }

            const url = new URL(req.url!, `http://localhost:${this.port}`);

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
                            const clientVersion = rpc.params?.protocolVersion || '2024-11-05';
                            // Support both legacy and streamable HTTP protocol versions
                            const serverVersion = clientVersion === '2025-03-26' ? '2025-03-26' : '2024-11-05';
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({
                                jsonrpc: '2.0',
                                id: rpc.id,
                                result: {
                                    protocolVersion: serverVersion,
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

                        // Handle notifications (no response needed — 204 No Content)
                        if (rpc.method === 'notifications/initialized') {
                            res.writeHead(204);
                            res.end();
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
                    try { res.write(': ping\n\n'); } catch {
                        /* istanbul ignore next -- race: SSE connection drops mid-ping */
                        clearInterval(pingInterval);
                    }
                }, 30000);

                req.on('close', () => {
                    clearInterval(pingInterval);
                });
                return;
            }

            // GET /events — SSE for webapp live updates (named events)
            if (req.method === 'GET' && url.pathname === '/events') {
                const eventBus = getEventBus();
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'Access-Control-Allow-Origin': '*',
                });
                res.write('event: connected\ndata: {}\n\n');

                const sseHandler = (event: COEEvent) => {
                    try {
                        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
                    } catch {
                        /* istanbul ignore next -- connection closed mid-write */
                    }
                };
                eventBus.on('*', sseHandler);

                const pingInterval = setInterval(() => {
                    try { res.write(': ping\n\n'); } catch {
                        /* istanbul ignore next -- race: SSE connection drops mid-ping */
                        clearInterval(pingInterval);
                    }
                }, 30000);

                req.on('close', () => {
                    eventBus.off('*', sseHandler);
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
                const handled = await handleApiRequest(req, res, url.pathname, this.database, this.orchestrator, this.config, this.codingAgentService, this.ticketProcessor ?? undefined);
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

    // ==================== v9.0: AGENT DESCRIPTIONS ====================

    private getAgentDescription(agentName: string): { name: string; description: string; capabilities: string[] } {
        const descriptions: Record<string, { description: string; capabilities: string[] }> = {
            planning: {
                description: 'Creates structured plans, breaks requirements into 15-45 min atomic tasks',
                capabilities: ['plan_creation', 'task_decomposition', 'requirement_analysis', 'roadmap'],
            },
            verification: {
                description: 'Validates completed work against acceptance criteria using real test results',
                capabilities: ['test_validation', 'acceptance_checking', 'quality_verification'],
            },
            answer: {
                description: 'Evidence-based answers to coding/design questions with source citations',
                capabilities: ['question_answering', 'code_explanation', 'documentation_lookup'],
            },
            research: {
                description: 'Deep investigation, comparison, benchmarking, trade-off evaluation',
                capabilities: ['investigation', 'comparison', 'benchmarking', 'best_practices'],
            },
            clarity: {
                description: 'Reviews messages for clarity, scores 0-100, requests clarifications',
                capabilities: ['clarity_scoring', 'message_review', 'requirement_clarification'],
            },
            boss: {
                description: 'Top-level manager. Monitors health, manages queues, allocates resources',
                capabilities: ['system_health', 'queue_management', 'resource_allocation', 'priority_setting'],
            },
            review: {
                description: 'Auto-reviews deliverables. Simple >=70%, moderate >=85%, complex -> user',
                capabilities: ['deliverable_review', 'quality_scoring', 'auto_approval'],
            },
            design_architect: {
                description: 'Frontend design review. 6-category scoring (0-100)',
                capabilities: ['design_review', 'page_hierarchy', 'design_scoring'],
            },
            frontend_architect: {
                description: 'Frontend design review. 6-category scoring (0-100)',
                capabilities: ['design_review', 'page_hierarchy', 'design_scoring'],
            },
            backend_architect: {
                description: 'Backend architecture review. 8-category scoring. 3 modes (auto_generate, scaffold, suggest)',
                capabilities: ['backend_review', 'api_design', 'schema_review', 'code_generation'],
            },
            gap_hunter: {
                description: 'Finds missing components and coverage gaps. 15 FE + 5 BE checks',
                capabilities: ['gap_analysis', 'completeness_check', 'coverage_analysis'],
            },
            design_hardener: {
                description: 'Creates draft proposals for missing elements',
                capabilities: ['draft_creation', 'gap_filling', 'component_proposals'],
            },
            decision_memory: {
                description: 'Tracks decisions in 13 categories. Deduplicates, auto-answers',
                capabilities: ['decision_tracking', 'conflict_detection', 'auto_answer'],
            },
            coding_director: {
                description: 'Interfaces with external coding agents. Manages task handoff',
                capabilities: ['code_generation', 'task_handoff', 'coding_queue'],
            },
            ui_testing: {
                description: 'Visual/layout/component/e2e tests',
                capabilities: ['ui_testing', 'visual_testing', 'layout_testing', 'e2e_testing'],
            },
            observation: {
                description: 'System health, improvement detection, tech debt patterns',
                capabilities: ['system_review', 'improvement_detection', 'pattern_detection'],
            },
            custom: {
                description: 'User-created specialized agents (read-only)',
                capabilities: ['custom_processing'],
            },
            user_communication: {
                description: 'Mediates ALL system-to-user messages. Rewrites for user level, routes through profile preferences',
                capabilities: ['message_routing', 'question_rewriting', 'profile_based_filtering'],
            },
        };

        const info = descriptions[agentName.toLowerCase()];
        return {
            name: agentName,
            description: info?.description ?? `Custom agent: ${agentName}`,
            capabilities: info?.capabilities ?? ['custom_processing'],
        };
    }

    private getAllAgentDescriptions(): Array<{ name: string; description: string; capabilities: string[] }> {
        const agentNames = [
            'planning', 'answer', 'verification', 'research', 'clarity',
            'boss', 'review', 'design_architect', 'backend_architect',
            'gap_hunter', 'design_hardener', 'decision_memory',
            'coding_director', 'ui_testing', 'observation', 'custom',
            'user_communication',
        ];
        return agentNames.map(name => this.getAgentDescription(name));
    }

    dispose(): void {
        if (this.server) {
            // v4.1: Fix — must close all connections before closing the server
            // Without this, lingering connections keep the server alive and tests hang.
            this.server.closeAllConnections();
            this.server.close();
            this.server = null;
        }
    }
}
