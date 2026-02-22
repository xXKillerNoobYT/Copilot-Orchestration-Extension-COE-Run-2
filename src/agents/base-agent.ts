import * as vscode from 'vscode';
import { Database } from '../core/database';
import { LLMService } from '../core/llm-service';
import { ConfigManager } from '../core/config';
import { TokenBudgetTracker } from '../core/token-budget-tracker';
import { ContextFeeder } from '../core/context-feeder';
import type { AgentPermissionManager } from '../core/agent-permission-manager';
import type { ModelRouter } from '../core/model-router';
import type { AgentTreeManager } from '../core/agent-tree-manager';
import {
    AgentType, AgentStatus, AgentContext, AgentResponse,
    LLMMessage, ConversationRole, ContentType, ContextItem,
    AgentPermission,
} from '../types';

export abstract class BaseAgent {
    protected database: Database;
    protected llm: LLMService;
    protected config: ConfigManager;
    protected outputChannel: vscode.OutputChannel;

    // Token management services (optional — backward-compatible)
    protected budgetTracker: TokenBudgetTracker | null = null;
    protected contextFeeder: ContextFeeder | null = null;

    // v9.0: Permission, model routing, and tree injection (optional — backward-compatible)
    protected permissionManager: AgentPermissionManager | null = null;
    protected modelRouter: ModelRouter | null = null;
    protected agentTreeManager: AgentTreeManager | null = null;
    protected treeNodeId: string | null = null;

    abstract readonly name: string;
    abstract readonly type: AgentType;
    abstract readonly systemPrompt: string;

    constructor(
        database: Database,
        llm: LLMService,
        config: ConfigManager,
        outputChannel: vscode.OutputChannel
    ) {
        this.database = database;
        this.llm = llm;
        this.config = config;
        this.outputChannel = outputChannel;
    }

    /**
     * Inject token management services.
     * Called during extension activation after services are created.
     * When set, buildMessages() uses ContextFeeder for intelligent context
     * loading and estimateTokens() uses TokenBudgetTracker for accurate estimation.
     */
    setContextServices(budgetTracker: TokenBudgetTracker, contextFeeder: ContextFeeder): void {
        this.budgetTracker = budgetTracker;
        this.contextFeeder = contextFeeder;
        this.outputChannel.appendLine(`[${this.name}] Context services injected (TokenBudgetTracker + ContextFeeder)`);
    }

    /**
     * v9.0: Inject permission manager for enforcing agent permissions.
     */
    setPermissionManager(pm: AgentPermissionManager): void {
        this.permissionManager = pm;
    }

    /**
     * v9.0: Inject model router for multi-model support.
     */
    setModelRouter(mr: ModelRouter): void {
        this.modelRouter = mr;
    }

    /**
     * v9.0: Inject agent tree manager + optional node binding.
     * When treeNodeId is set, this agent operates within the tree hierarchy.
     */
    setAgentTreeManager(atm: AgentTreeManager, nodeId?: string): void {
        this.agentTreeManager = atm;
        if (nodeId) this.treeNodeId = nodeId;
    }

    /**
     * v9.0: Bind this agent to a specific tree node for tree-aware processing.
     */
    setTreeNodeId(nodeId: string | null): void {
        this.treeNodeId = nodeId;
    }

    async initialize(): Promise<void> {
        this.database.registerAgent(this.name, this.type);
        this.outputChannel.appendLine(`Agent initialized: ${this.name} (${this.type})`);
    }

    async processMessage(message: string, context: AgentContext): Promise<AgentResponse> {
        // v9.0: Permission check — enforce that this agent can execute
        if (this.permissionManager) {
            this.permissionManager.enforcePermission(this.type, AgentPermission.Execute, undefined, this.treeNodeId ?? undefined);
        }

        this.database.updateAgentStatus(this.name, AgentStatus.Working, context.task?.id);
        this.database.addAuditLog(this.name, 'process_message', `Processing: ${message.substring(0, 100)}...`);

        try {
            // v9.0: Tree-aware context slicing — enriches message with scoped context
            let effectiveMessage = message;
            if (this.treeNodeId && this.agentTreeManager) {
                const sliced = this.agentTreeManager.sliceContext(this.treeNodeId, message);
                if (sliced.matchedItems > 0) {
                    effectiveMessage = `${message}\n\n[Scoped Context (${sliced.matchedItems} relevant items, scope: ${sliced.scopeKeywords.join(', ')})]\n${sliced.filteredContext}`;
                }
            }

            const messages = this.buildMessages(effectiveMessage, context);

            // Estimate total input tokens for tracking
            const inputTokensEstimated = this.estimateMessagesTokens(messages);

            // v9.0: Model selection via ModelRouter
            const modelId = this.getModelForRequest();

            // Use model's actual max output tokens (not the agent's context limit)
            // to prevent requesting more tokens than the model can produce
            const maxOutputTokens = this.config.getModelMaxOutputTokens();

            const response = await this.llm.chat(messages, {
                maxTokens: maxOutputTokens,
                ...(modelId ? { model: modelId } : {}),
            });

            // Record usage for calibration when budgetTracker is available
            if (this.budgetTracker) {
                this.budgetTracker.recordUsage(
                    inputTokensEstimated,
                    response.tokens_used,
                    this.type
                );
            }

            // Standard conversation recording
            this.database.addConversation(
                this.name,
                ConversationRole.Agent,
                response.content,
                context.task?.id,
                context.ticket?.id,
                response.tokens_used
            );

            // v9.0: Tree-aware conversation recording (isolated per node)
            if (this.treeNodeId) {
                const node = this.database.getTreeNode(this.treeNodeId);
                if (node) {
                    // Record the user message first, then the agent response
                    this.database.createAgentConversation({
                        tree_node_id: this.treeNodeId,
                        level: node.level,
                        role: ConversationRole.User,
                        content: message,
                        tokens_used: inputTokensEstimated,
                    });
                    this.database.createAgentConversation({
                        tree_node_id: this.treeNodeId,
                        level: node.level,
                        role: ConversationRole.Agent,
                        content: response.content,
                        tokens_used: response.tokens_used,
                    });
                }
            }

            const agentResponse = await this.parseResponse(response.content, context);
            this.database.updateAgentStatus(this.name, AgentStatus.Idle);

            return agentResponse;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`Agent ${this.name} error: ${msg}`);
            this.database.updateAgentStatus(this.name, AgentStatus.Error);
            this.database.addAuditLog(this.name, 'error', msg);
            throw error;
        }
    }

    /**
     * v9.0: Get the model ID for the current request via ModelRouter.
     * Returns null to use the default model.
     */
    protected getModelForRequest(): string | null {
        if (!this.modelRouter) return null;
        return this.modelRouter.getModelForAgent(this.type);
    }

    /**
     * Estimate token count for a string.
     * Delegates to TokenBudgetTracker when available (content-type-aware).
     * Falls back to the ~4 chars per token heuristic.
     */
    protected estimateTokens(text: string, contentType?: ContentType): number {
        if (this.budgetTracker) {
            return this.budgetTracker.estimateTokens(text, contentType);
        }
        return Math.ceil(text.length / 4);
    }

    /**
     * Estimate total tokens across an array of LLM messages.
     * Uses content-type-aware estimation when budgetTracker is available.
     */
    protected estimateMessagesTokens(messages: LLMMessage[]): number {
        let total = 0;
        for (const msg of messages) {
            total += this.estimateTokens(msg.content);
            // Add per-message overhead (role headers, formatting)
            if (this.budgetTracker) {
                total += this.budgetTracker.getCurrentModelProfile().overheadTokensPerMessage;
            } else {
                total += 4; // legacy overhead estimate
            }
        }
        return total;
    }

    /**
     * Build LLM messages from context.
     *
     * When ContextFeeder is available: delegates to buildOptimizedMessages()
     * which uses relevance scoring, tiered loading, and deterministic compression.
     *
     * When ContextFeeder is NOT available: uses the legacy manual budget approach
     * for backward compatibility.
     */
    protected buildMessages(userMessage: string, context: AgentContext, additionalItems?: ContextItem[]): LLMMessage[] {
        // --- New path: ContextFeeder handles everything ---
        if (this.contextFeeder) {
            const result = this.contextFeeder.buildOptimizedMessages(
                this.type,
                userMessage,
                this.systemPrompt,
                context,
                additionalItems
            );

            this.outputChannel.appendLine(
                `[${this.name}] Context feed: ${result.includedItems.length} items included, ` +
                `${result.excludedItems.length} excluded, ` +
                `${result.budget.consumed}/${result.budget.availableForInput} tokens consumed` +
                `${result.compressionApplied ? ' (compression applied)' : ''}`
            );

            return result.messages;
        }

        // --- Legacy path: manual budget arithmetic ---
        return this.buildMessagesLegacy(userMessage, context);
    }

    /**
     * Legacy message building — preserved for backward compatibility.
     * Used when ContextFeeder has not been injected.
     */
    private buildMessagesLegacy(userMessage: string, context: AgentContext): LLMMessage[] {
        // Token budget: agent's configured context limit, minus 20% reserved for LLM response
        const agentContextLimit = this.config.getAgentContextLimit(this.type);
        const responseBudget = Math.ceil(agentContextLimit * 0.2);
        let tokenBudget = agentContextLimit - responseBudget;

        const messages: LLMMessage[] = [];

        // 1. System prompt (always included — non-negotiable)
        const systemMsg: LLMMessage = { role: 'system', content: this.systemPrompt };
        tokenBudget -= this.estimateTokens(this.systemPrompt);
        messages.push(systemMsg);

        // 2. User message (always included — this is the current request)
        const userMsg: LLMMessage = { role: 'user', content: userMessage };
        tokenBudget -= this.estimateTokens(userMessage);

        // 3. Context messages (task, ticket, plan) — added in priority order
        const contextMessages: LLMMessage[] = [];

        if (context.task) {
            const taskContent = `Current task: ${context.task.title}\nDescription: ${context.task.description}\nPriority: ${context.task.priority}\nAcceptance criteria: ${context.task.acceptance_criteria}`;
            const taskTokens = this.estimateTokens(taskContent);
            if (taskTokens <= tokenBudget) {
                contextMessages.push({ role: 'system', content: taskContent });
                tokenBudget -= taskTokens;
            } else {
                this.outputChannel.appendLine(`[${this.name}] Token budget: skipping task context (${taskTokens} tokens)`);
            }
        }

        if (context.ticket) {
            const ticketContent = `Related ticket TK-${context.ticket.ticket_number}: ${context.ticket.title}\n${context.ticket.body}`;
            const ticketTokens = this.estimateTokens(ticketContent);
            if (ticketTokens <= tokenBudget) {
                contextMessages.push({ role: 'system', content: ticketContent });
                tokenBudget -= ticketTokens;
            } else {
                this.outputChannel.appendLine(`[${this.name}] Token budget: skipping ticket context (${ticketTokens} tokens)`);
            }
        }

        if (context.plan) {
            const planContent = `Active plan: ${context.plan.name}\nConfig: ${context.plan.config_json}`;
            const planTokens = this.estimateTokens(planContent);
            if (planTokens <= tokenBudget) {
                contextMessages.push({ role: 'system', content: planContent });
                tokenBudget -= planTokens;
            } else {
                this.outputChannel.appendLine(`[${this.name}] Token budget: skipping plan context (${planTokens} tokens)`);
            }
        }

        // 4. Conversation history — add newest first, then reverse for chronological order
        // This ensures the most recent context is preserved when budget is tight.
        const history = context.conversationHistory.slice(-20); // consider up to 20
        const historyMessages: LLMMessage[] = [];

        for (let i = history.length - 1; i >= 0; i--) {
            const conv = history[i];
            const convTokens = this.estimateTokens(conv.content);
            if (convTokens <= tokenBudget) {
                historyMessages.unshift({
                    role: conv.role === ConversationRole.Agent ? 'assistant' : 'user',
                    content: conv.content,
                });
                tokenBudget -= convTokens;
            } else {
                // Once we can't fit a message, stop adding older ones
                this.outputChannel.appendLine(
                    `[${this.name}] Token budget: truncated history at ${historyMessages.length}/${history.length} messages (${tokenBudget} tokens remaining)`
                );
                break;
            }
        }

        // Assemble final message array in correct order
        messages.push(...contextMessages);
        messages.push(...historyMessages);
        messages.push(userMsg);

        return messages;
    }

    protected async parseResponse(content: string, _context: AgentContext): Promise<AgentResponse> {
        return {
            content,
            actions: [],
        };
    }

    dispose(): void {
        this.database.updateAgentStatus(this.name, AgentStatus.Idle);
    }
}
