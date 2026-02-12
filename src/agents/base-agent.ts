import * as vscode from 'vscode';
import { Database } from '../core/database';
import { LLMService } from '../core/llm-service';
import { ConfigManager } from '../core/config';
import {
    AgentType, AgentStatus, AgentContext, AgentResponse,
    LLMMessage, ConversationRole
} from '../types';

export abstract class BaseAgent {
    protected database: Database;
    protected llm: LLMService;
    protected config: ConfigManager;
    protected outputChannel: vscode.OutputChannel;

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

    async initialize(): Promise<void> {
        this.database.registerAgent(this.name, this.type);
        this.outputChannel.appendLine(`Agent initialized: ${this.name} (${this.type})`);
    }

    async processMessage(message: string, context: AgentContext): Promise<AgentResponse> {
        this.database.updateAgentStatus(this.name, AgentStatus.Working, context.task?.id);
        this.database.addAuditLog(this.name, 'process_message', `Processing: ${message.substring(0, 100)}...`);

        try {
            const messages = this.buildMessages(message, context);
            const response = await this.llm.chat(messages, {
                maxTokens: this.config.getAgentContextLimit(this.type),
            });

            this.database.addConversation(
                this.name,
                ConversationRole.Agent,
                response.content,
                context.task?.id,
                context.ticket?.id,
                response.tokens_used
            );

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
     * Estimate token count for a string.
     * Uses the ~4 chars per token heuristic (conservative for English text).
     * This avoids needing a tokenizer dependency.
     */
    protected estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
    }

    protected buildMessages(userMessage: string, context: AgentContext): LLMMessage[] {
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
