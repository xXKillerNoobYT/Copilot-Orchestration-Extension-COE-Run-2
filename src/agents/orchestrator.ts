import * as vscode from 'vscode';
import { Database } from '../core/database';
import { LLMService } from '../core/llm-service';
import { ConfigManager } from '../core/config';
import { BaseAgent } from './base-agent';
import { PlanningAgent } from './planning-agent';
import { AnswerAgent } from './answer-agent';
import { VerificationAgent } from './verification-agent';
import { ResearchAgent } from './research-agent';
import { ClarityAgent } from './clarity-agent';
import { BossAgent } from './boss-agent';
import { CustomAgentRunner } from './custom-agent';
import {
    AgentType, AgentStatus, AgentContext, AgentResponse,
    ConversationRole, Task, TaskStatus
} from '../types';

const INTENT_CATEGORIES = ['planning', 'verification', 'question', 'research', 'custom', 'general'];

const KEYWORD_MAP: Record<string, string[]> = {
    planning: ['plan', 'create', 'break down', 'decompose', 'task', 'feature', 'requirement', 'roadmap', 'schedule'],
    verification: ['verify', 'check', 'test', 'validate', 'review', 'pass', 'fail', 'coverage', 'acceptance'],
    question: ['how', 'what', 'why', 'should', 'which', 'where', 'when', 'clarify', 'explain', 'confused'],
    research: ['investigate', 'analyze', 'research', 'deep dive', 'explore', 'study', 'compare'],
};

export class Orchestrator extends BaseAgent {
    readonly name = 'Orchestrator';
    readonly type = AgentType.Orchestrator;
    readonly systemPrompt = `You are the Orchestrator of the Copilot Orchestration Extension (COE). Your role is to:
1. Classify incoming messages by intent (planning, verification, question, research, custom)
2. Route messages to the appropriate specialist agent
3. Manage the task queue and auto-planning
4. Detect stuck tasks and timeout issues
5. Coordinate between all agents

Always respond with clear, structured information. Never write code directly.`;

    private planningAgent!: PlanningAgent;
    private answerAgent!: AnswerAgent;
    private verificationAgent!: VerificationAgent;
    private researchAgent!: ResearchAgent;
    private clarityAgent!: ClarityAgent;
    private bossAgent!: BossAgent;
    private customAgentRunner!: CustomAgentRunner;

    constructor(
        database: Database,
        llm: LLMService,
        config: ConfigManager,
        outputChannel: vscode.OutputChannel
    ) {
        super(database, llm, config, outputChannel);
    }

    async initialize(): Promise<void> {
        await super.initialize();

        this.planningAgent = new PlanningAgent(this.database, this.llm, this.config, this.outputChannel);
        this.answerAgent = new AnswerAgent(this.database, this.llm, this.config, this.outputChannel);
        this.verificationAgent = new VerificationAgent(this.database, this.llm, this.config, this.outputChannel);
        this.researchAgent = new ResearchAgent(this.database, this.llm, this.config, this.outputChannel);
        this.clarityAgent = new ClarityAgent(this.database, this.llm, this.config, this.outputChannel);
        this.bossAgent = new BossAgent(this.database, this.llm, this.config, this.outputChannel);
        this.customAgentRunner = new CustomAgentRunner(this.database, this.llm, this.config, this.outputChannel);

        await Promise.all([
            this.planningAgent.initialize(),
            this.answerAgent.initialize(),
            this.verificationAgent.initialize(),
            this.researchAgent.initialize(),
            this.clarityAgent.initialize(),
            this.bossAgent.initialize(),
            this.customAgentRunner.initialize(),
        ]);

        this.outputChannel.appendLine('All agents initialized.');
    }

    async route(message: string, context: AgentContext): Promise<AgentResponse> {
        this.database.addConversation('orchestrator', ConversationRole.User, message, context.task?.id, context.ticket?.id);

        const intent = await this.classifyIntent(message);
        this.database.addAuditLog('orchestrator', 'route', `Intent: ${intent} for message: ${message.substring(0, 80)}`);

        const agent = this.getAgentForIntent(intent);
        if (!agent) {
            return { content: `No agent available for intent: ${intent}` };
        }

        this.outputChannel.appendLine(`Routing to ${agent.name} (intent: ${intent})`);
        return agent.processMessage(message, context);
    }

    async callAgent(agentName: string, message: string, context: AgentContext): Promise<AgentResponse> {
        const agent = this.getAgentByName(agentName);
        if (!agent) {
            return { content: `Agent not found: ${agentName}` };
        }
        this.database.addAuditLog('orchestrator', 'direct_call', `Direct call to ${agentName}`);
        return agent.processMessage(message, context);
    }

    private async classifyIntent(message: string): Promise<string> {
        // Fast keyword-based classification first
        const lowerMessage = message.toLowerCase();
        for (const [intent, keywords] of Object.entries(KEYWORD_MAP)) {
            if (keywords.some(kw => lowerMessage.includes(kw))) {
                return intent;
            }
        }

        // Fall back to LLM classification
        try {
            return await this.llm.classify(message, INTENT_CATEGORIES);
        } catch {
            this.outputChannel.appendLine('LLM classification failed, defaulting to general');
            return 'general';
        }
    }

    private getAgentForIntent(intent: string): BaseAgent | null {
        switch (intent) {
            case 'planning': return this.planningAgent;
            case 'verification': return this.verificationAgent;
            case 'question': return this.answerAgent;
            case 'research': return this.researchAgent;
            case 'custom': return this.customAgentRunner;
            case 'general': return this.answerAgent; // default to answer agent
            default: return this.answerAgent;
        }
    }

    private getAgentByName(name: string): BaseAgent | null {
        const agents: Record<string, BaseAgent> = {
            orchestrator: this,
            planning: this.planningAgent,
            answer: this.answerAgent,
            verification: this.verificationAgent,
            research: this.researchAgent,
            clarity: this.clarityAgent,
            boss: this.bossAgent,
            custom: this.customAgentRunner,
        };
        return agents[name.toLowerCase()] || null;
    }

    // --- Task Queue Management ---

    getNextTask(): Task | null {
        return this.database.getNextReadyTask();
    }

    async reportTaskDone(taskId: string, summary: string, filesModified: string[]): Promise<void> {
        const task = this.database.getTask(taskId);
        if (!task) throw new Error(`Task not found: ${taskId}`);

        this.database.updateTask(taskId, {
            status: TaskStatus.PendingVerification,
            files_modified: filesModified,
        });
        this.database.addAuditLog('orchestrator', 'task_done', `Task ${taskId} reported done: ${summary}`);

        // Schedule verification after delay
        const delay = this.config.getConfig().verification.delaySeconds * 1000;
        setTimeout(async () => {
            try {
                const context: AgentContext = {
                    task: this.database.getTask(taskId) || undefined,
                    conversationHistory: this.database.getConversationsByTask(taskId),
                };
                await this.verificationAgent.processMessage(
                    `Verify task ${taskId}: ${task.title}. Files modified: ${filesModified.join(', ')}. Summary: ${summary}`,
                    context
                );
            } catch (error) {
                this.outputChannel.appendLine(`Verification failed for task ${taskId}: ${error}`);
            }
        }, delay);
    }

    async freshRestart(): Promise<{ tasksReady: number; message: string }> {
        this.database.clearInMemoryState();
        this.database.addAuditLog('orchestrator', 'fresh_restart', 'System state cleared and reloaded');

        const readyTasks = this.database.getReadyTasks();
        const stats = this.database.getStats();

        return {
            tasksReady: readyTasks.length,
            message: `Fresh restart complete. ${readyTasks.length} tasks ready. ${stats.total_tasks} total tasks. ${stats.total_tickets} tickets.`,
        };
    }

    // --- Agent Accessors ---

    getPlanningAgent(): PlanningAgent { return this.planningAgent; }
    getAnswerAgent(): AnswerAgent { return this.answerAgent; }
    getVerificationAgent(): VerificationAgent { return this.verificationAgent; }
    getResearchAgent(): ResearchAgent { return this.researchAgent; }
    getClarityAgent(): ClarityAgent { return this.clarityAgent; }
    getBossAgent(): BossAgent { return this.bossAgent; }
    getCustomAgentRunner(): CustomAgentRunner { return this.customAgentRunner; }

    dispose(): void {
        super.dispose();
        this.planningAgent?.dispose();
        this.answerAgent?.dispose();
        this.verificationAgent?.dispose();
        this.researchAgent?.dispose();
        this.clarityAgent?.dispose();
        this.bossAgent?.dispose();
        this.customAgentRunner?.dispose();
    }
}
