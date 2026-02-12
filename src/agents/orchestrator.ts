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
import { EvolutionService } from '../core/evolution-service';
import {
    AgentType, AgentStatus, AgentContext, AgentResponse,
    ConversationRole, Task, TaskStatus
} from '../types';

const INTENT_CATEGORIES = ['planning', 'verification', 'question', 'research', 'custom', 'general'] as const;

/**
 * Priority order for tie-breaking: lower index = higher priority.
 * verification > planning > question > research > custom > general
 */
const INTENT_PRIORITY: Record<string, number> = {
    verification: 0,
    planning: 1,
    question: 2,
    research: 3,
    custom: 4,
    general: 5,
};

const KEYWORD_MAP: Record<string, string[]> = {
    planning: [
        'plan', 'create', 'break down', 'decompose', 'task', 'feature',
        'requirement', 'roadmap', 'schedule', 'build', 'implement',
        'design', 'architect', 'scope', 'milestone', 'phase',
        'backlog', 'sprint', 'epic', 'story',
    ],
    verification: [
        'verify', 'check', 'test', 'validate', 'review', 'pass', 'fail',
        'coverage', 'acceptance', 'confirm', 'ensure', 'assert', 'inspect',
        'audit', 'lint', 'regression', 'qa', 'quality', 'correctness',
        'matches design', 'meets criteria',
    ],
    question: [
        'how', 'what', 'why', 'should', 'which', 'where', 'when',
        'clarify', 'explain', 'confused', 'help', 'understand',
        'meaning', 'definition', 'difference', 'purpose', 'reason',
        'describe', 'tell me', 'can you',
    ],
    research: [
        'investigate', 'analyze', 'research', 'deep dive', 'explore',
        'study', 'compare', 'benchmark', 'evaluate', 'assess',
        'pros and cons', 'trade-off', 'alternative', 'best practice',
        'performance', 'scalability', 'security audit',
    ],
    custom: [
        'custom agent', 'run agent', 'specialist', 'domain expert',
        'custom tool', 'agent gallery', 'my agent', 'specialized',
        'invoke agent', 'call agent',
    ],
};

export class Orchestrator extends BaseAgent {
    readonly name = 'Orchestrator';
    readonly type = AgentType.Orchestrator;
    readonly systemPrompt = `You are the Orchestrator — the central router of the Copilot Orchestration Extension (COE).

## Your ONE Job
Classify every incoming message into EXACTLY ONE intent category, then route it to the correct specialist agent. You NEVER write code, NEVER answer questions directly, and NEVER make plans yourself.

## Intent Categories (in tie-breaking priority order)
1. **verification** — The message is about checking, testing, validating, or confirming completed work.
   Examples: "verify my auth endpoint works", "check if task 42 passes acceptance criteria", "run tests on the login module"
2. **planning** — The message is about creating plans, breaking down requirements, defining tasks, or scoping work.
   Examples: "plan a REST API with auth", "break this feature into tasks", "create a roadmap for v2"
3. **question** — The message is asking for information, clarification, or explanation.
   Examples: "how does the database schema work?", "what's the difference between P1 and P2?", "explain the verification flow"
4. **research** — The message requires investigation, comparison, benchmarking, or deep analysis.
   Examples: "compare SQLite vs PostgreSQL for our use case", "investigate why tests are slow", "what are best practices for MCP servers?"
5. **custom** — The message explicitly requests a custom or specialized agent.
   Examples: "run my custom lint agent", "invoke the security specialist", "call agent gallery"
6. **general** — The message does not fit any of the above categories. Route to the Answer Agent as a fallback.

## Tie-Breaking Rules
If a message matches multiple categories, use this priority: verification > planning > question > research > custom > general.
Example: "verify my plan is correct" matches both verification and planning — choose verification.
Example: "plan how to test the API" matches both planning and verification — choose verification.

## Output Format
When classifying, respond with ONLY the category name as a single lowercase word. No explanation, no punctuation, no extra text.

## Routing Rules
- verification → Verification Team
- planning → Planning Team
- question → Answer Agent
- research → Research Agent
- custom → Custom Agent Runner
- general → Answer Agent (fallback)

## Additional Responsibilities
- Log every routing decision to the audit log with the classified intent
- If the LLM is offline, use keyword-only classification (no LLM fallback)
- Track task queue health: if >20 pending tasks, flag for Boss AI review
- On task completion reports: schedule delayed verification (configurable delay)
- On verification failure: retry once after 30 seconds, then create investigation ticket
- Never crash — wrap all agent calls in error handling`;

    private planningAgent!: PlanningAgent;
    private answerAgent!: AnswerAgent;
    private verificationAgent!: VerificationAgent;
    private researchAgent!: ResearchAgent;
    private clarityAgent!: ClarityAgent;
    private bossAgent!: BossAgent;
    private customAgentRunner!: CustomAgentRunner;
    private llmOffline = false;
    private evolutionService: EvolutionService | null = null;

    setEvolutionService(service: EvolutionService): void {
        this.evolutionService = service;
    }

    getEvolutionService(): EvolutionService | null {
        return this.evolutionService;
    }

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

        try {
            const response = await agent.processMessage(message, context);
            this.evolutionService?.incrementCallCounter();
            return response;
        } catch (error) {
            // Error boundary: never crash, create investigation ticket
            const msg = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`Agent ${agent.name} error: ${msg}`);
            this.database.addAuditLog('orchestrator', 'agent_error', `${agent.name}: ${msg}`);
            this.database.createTicket({
                title: `Agent error: ${agent.name}`,
                body: `Agent "${agent.name}" threw an error while processing message.\n\nError: ${msg}\n\nOriginal message: ${message.substring(0, 200)}`,
                priority: 'P1' as any,
                creator: 'Orchestrator',
                task_id: context.task?.id,
            });
            return { content: `Error from ${agent.name}: ${msg}. Investigation ticket created.` };
        }
    }

    async callAgent(agentName: string, message: string, context: AgentContext): Promise<AgentResponse> {
        const agent = this.getAgentByName(agentName);
        if (!agent) {
            return { content: `Agent not found: ${agentName}` };
        }
        this.database.addAuditLog('orchestrator', 'direct_call', `Direct call to ${agentName}`);

        try {
            const response = await agent.processMessage(message, context);
            this.evolutionService?.incrementCallCounter();
            return response;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`Direct call to ${agentName} error: ${msg}`);
            this.database.addAuditLog('orchestrator', 'agent_error', `${agentName}: ${msg}`);
            return { content: `Error from ${agentName}: ${msg}` };
        }
    }

    private async classifyIntent(message: string): Promise<string> {
        // Stage 1: Multi-keyword scoring — count matches per category
        const lowerMessage = message.toLowerCase();
        const scores: Record<string, number> = {};

        for (const [intent, keywords] of Object.entries(KEYWORD_MAP)) {
            let score = 0;
            for (const kw of keywords) {
                if (lowerMessage.includes(kw)) {
                    score++;
                }
            }
            if (score > 0) {
                scores[intent] = score;
            }
        }

        // If we have keyword matches, pick the highest score.
        // On ties, use priority order (verification > planning > question > research > custom > general).
        const scoredIntents = Object.entries(scores);
        if (scoredIntents.length > 0) {
            scoredIntents.sort((a, b) => {
                if (b[1] !== a[1]) return b[1] - a[1]; // higher score first
                return (INTENT_PRIORITY[a[0]] ?? 5) - (INTENT_PRIORITY[b[0]] ?? 5); // lower priority index wins ties
            });
            return scoredIntents[0][0];
        }

        // Stage 2: Zero keyword matches — fall back to LLM classification
        if (this.llmOffline) {
            this.outputChannel.appendLine('LLM offline, no keyword matches — defaulting to general');
            return 'general';
        }

        try {
            return await this.llm.classify(message, [...INTENT_CATEGORIES]);
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

        // Schedule verification after delay with retry logic
        const delay = this.config.getConfig().verification.delaySeconds * 1000;
        setTimeout(() => this.runVerificationWithRetry(taskId, task.title, filesModified, summary, 0), delay);
    }

    private async runVerificationWithRetry(
        taskId: string, title: string, filesModified: string[], summary: string, attempt: number
    ): Promise<void> {
        try {
            // Guard: task may have changed status between scheduling and execution
            const currentTask = this.database.getTask(taskId);
            if (!currentTask || currentTask.status !== TaskStatus.PendingVerification) {
                this.outputChannel.appendLine(`Skipping verification for ${taskId} — status changed to ${currentTask?.status}`);
                return;
            }

            const context: AgentContext = {
                task: currentTask,
                conversationHistory: this.database.getConversationsByTask(taskId),
            };
            await this.verificationAgent.processMessage(
                `Verify task ${taskId}: ${title}. Files modified: ${filesModified.join(', ')}. Summary: ${summary}`,
                context
            );
        } catch (error) {
            this.outputChannel.appendLine(`Verification attempt ${attempt + 1} failed for task ${taskId}: ${error}`);

            if (attempt === 0) {
                // Retry once after 30 seconds
                setTimeout(() => this.runVerificationWithRetry(taskId, title, filesModified, summary, 1), 30_000);
            } else {
                // After 2 failures, create investigation ticket
                this.database.createTicket({
                    title: `Verification failed: ${title}`,
                    body: `Automated verification failed twice for task ${taskId}.\n\nError: ${error}\n\nFiles: ${filesModified.join(', ')}\nSummary: ${summary}`,
                    priority: 'P1' as any,
                    creator: 'Orchestrator',
                    task_id: taskId,
                });
                this.database.addAuditLog('orchestrator', 'verification_failed',
                    `Task ${taskId} verification failed after 2 attempts — investigation ticket created`);
            }
        }
    }

    setLLMOffline(offline: boolean): void {
        this.llmOffline = offline;
        if (offline) {
            this.outputChannel.appendLine('LLM marked as offline — using keyword-only classification');
        }
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
