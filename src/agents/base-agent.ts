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

    protected buildMessages(userMessage: string, context: AgentContext): LLMMessage[] {
        const messages: LLMMessage[] = [
            { role: 'system', content: this.systemPrompt },
        ];

        // Add context
        if (context.task) {
            messages.push({
                role: 'system',
                content: `Current task: ${context.task.title}\nDescription: ${context.task.description}\nPriority: ${context.task.priority}\nAcceptance criteria: ${context.task.acceptance_criteria}`
            });
        }

        if (context.ticket) {
            messages.push({
                role: 'system',
                content: `Related ticket TK-${context.ticket.ticket_number}: ${context.ticket.title}\n${context.ticket.body}`
            });
        }

        if (context.plan) {
            messages.push({
                role: 'system',
                content: `Active plan: ${context.plan.name}\nConfig: ${context.plan.config_json}`
            });
        }

        // Add conversation history (last 10 messages)
        const history = context.conversationHistory.slice(-10);
        for (const conv of history) {
            messages.push({
                role: conv.role === ConversationRole.Agent ? 'assistant' : 'user',
                content: conv.content,
            });
        }

        messages.push({ role: 'user', content: userMessage });
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
