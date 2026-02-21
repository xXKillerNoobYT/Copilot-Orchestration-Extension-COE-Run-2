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
import { UITestingAgent } from './ui-testing-agent';
import { ObservationAgent } from './observation-agent';
import { FrontendArchitectAgent } from './design-architect-agent';
import { GapHunterAgent } from './gap-hunter-agent';
import { DesignHardenerAgent } from './design-hardener-agent';
import { DecisionMemoryAgent } from './decision-memory-agent';
import { ReviewAgent } from './review-agent';
import { CodingDirectorAgent } from './coding-director-agent';
import { BackendArchitectAgent } from './backend-architect-agent';
import { UserCommunicationAgent } from './user-communication-agent';
import { EvolutionService } from '../core/evolution-service';
import { TokenBudgetTracker } from '../core/token-budget-tracker';
import { ContextFeeder } from '../core/context-feeder';
import { TaskDecompositionEngine } from '../core/task-decomposition-engine';
import { EventBus } from '../core/event-bus';
import type { AgentPermissionManager } from '../core/agent-permission-manager';
import type { ModelRouter } from '../core/model-router';
import type { AgentTreeManager } from '../core/agent-tree-manager';
import type { UserProfileManager } from '../core/user-profile-manager';
import {
    AgentType, AgentStatus, AgentContext, AgentResponse,
    ConversationRole, Task, TaskStatus, TicketPriority
} from '../types';

const INTENT_CATEGORIES = [
    'planning', 'verification', 'ui_testing', 'observation',
    'design_architect', 'backend_architect', 'gap_hunter', 'design_hardener', 'decision_memory',
    'review', 'coding_director', 'user_communication',
    'question', 'research', 'custom', 'general',
] as const;

/**
 * Priority order for tie-breaking: lower index = higher priority.
 * verification > ui_testing > observation > design agents > planning > question > research > custom > general
 */
const INTENT_PRIORITY: Record<string, number> = {
    verification: 0,
    ui_testing: 1,
    observation: 2,
    review: 3,
    design_architect: 4,
    backend_architect: 5,
    gap_hunter: 6,
    design_hardener: 7,
    decision_memory: 8,
    coding_director: 9,
    user_communication: 10,
    planning: 11,
    question: 12,
    research: 13,
    custom: 14,
    general: 15,
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
    ui_testing: [
        'ui test', 'visual test', 'layout test', 'component test',
        'click test', 'navigation test', 'test ui', 'test layout',
        'test design', 'manual test', 'test page', 'e2e test',
        'test components', 'test visual', 'functional test',
        'check layout', 'check ui', 'check design',
    ],
    observation: [
        'observe', 'observation', 'review system', 'system health',
        'improvement', 'improve', 'optimize', 'technical debt',
        'code quality', 'agent performance', 'health check',
        'system review', 'find improvements', 'suggest fix',
        'recurring issue', 'pattern detection', 'architecture review',
    ],
    design_architect: [
        'design review', 'architecture review', 'page hierarchy', 'design assessment',
        'design score', 'structure review', 'score design', 'review design quality',
    ],
    backend_architect: [
        'backend review', 'backend architecture', 'api review', 'backend score',
        'backend design', 'review backend', 'score backend', 'backend quality',
        'generate backend', 'scaffold backend', 'backend generate', 'api architecture',
        'database design review', 'service architecture', 'backend qa',
    ],
    gap_hunter: [
        'gap analysis', 'find gaps', 'missing components', 'missing pages',
        'coverage analysis', 'design gaps', 'completeness check', 'find missing',
    ],
    design_hardener: [
        'harden design', 'fix gaps', 'complete design', 'fill gaps',
        'add missing', 'draft components', 'propose additions', 'draft proposals',
    ],
    decision_memory: [
        'previous decision', 'past answer', 'user preference', 'decision history',
        'conflict check', 'what did user say', 'decision lookup', 'past choices',
    ],
    review: [
        'review ticket', 'auto-approve', 'approve ticket', 'review deliverable',
        'ticket review', 'quality check', 'review output', 'check deliverable',
        'approval status', 'review queue', 'pending review', 'review result',
    ],
    coding_director: [
        'code generation', 'generate code', 'write code', 'coding task',
        'external agent', 'coding agent', 'mcp task', 'next task',
        'code implementation', 'coding queue', 'coding status',
    ],
    user_communication: [
        'user profile', 'communication style', 'programming level',
        'user preference', 'ai mode', 'question routing', 'user message',
        'notification', 'user notification', 'ask user', 'user response',
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
1. **verification** — Checking, testing, validating, or confirming completed work.
   Examples: "verify my auth endpoint works", "check if task 42 passes acceptance criteria", "run tests on the login module"
2. **ui_testing** — UI-specific testing: visual tests, layout checks, component tests, e2e tests.
   Examples: "test the login page layout", "run e2e tests on navigation", "check if the button renders correctly"
3. **observation** — System health reviews, improvement suggestions, technical debt, pattern detection.
   Examples: "review system health", "find improvements in the codebase", "detect recurring issues"
4. **review** — Reviewing ticket deliverables, auto-approval, quality checks on completed work.
   Examples: "review this ticket output", "check deliverable quality", "what's in the review queue?"
5. **design_architect** — Frontend design structure review, page hierarchy assessment, design scoring.
   Examples: "review the design architecture", "score the page hierarchy", "assess design quality"
6. **backend_architect** — Backend architecture review, API design, database schema, service architecture scoring.
   Examples: "review backend architecture", "score backend design", "generate backend scaffolding"
7. **gap_hunter** — Finding missing components, coverage gaps, completeness checks in designs.
   Examples: "find gaps in the design", "what components are missing?", "run completeness check"
8. **design_hardener** — Filling gaps, proposing draft components, hardening incomplete designs.
   Examples: "harden the design", "propose missing components", "fill the gaps found by gap hunter"
9. **decision_memory** — Looking up past decisions, user preferences, conflict checks.
   Examples: "what did the user decide about auth?", "check for conflicting decisions", "recall past preferences"
10. **coding_director** — Code generation tasks, external coding agent interface, MCP task management.
   Examples: "generate code for the auth module", "what's the coding agent status?", "prepare next coding task"
11. **user_communication** — User profile, communication preferences, AI mode settings, question routing.
   Examples: "update user profile", "set AI mode to smart", "change communication style"
13. **planning** — Creating plans, breaking down requirements, defining tasks, scoping work.
   Examples: "plan a REST API with auth", "break this feature into tasks", "create a roadmap for v2"
14. **question** — Asking for information, clarification, or explanation.
    Examples: "how does the database schema work?", "what's the difference between P1 and P2?", "explain the verification flow"
15. **research** — Investigation, comparison, benchmarking, or deep analysis.
    Examples: "compare SQLite vs PostgreSQL for our use case", "investigate why tests are slow", "best practices for MCP servers?"
16. **custom** — Explicitly requesting a custom or specialized agent.
    Examples: "run my custom lint agent", "invoke the security specialist", "call agent gallery"
17. **general** — Does not fit any of the above. Fallback to Answer Agent.

## Tie-Breaking Rules
If a message matches multiple categories, use this priority (highest first):
verification > ui_testing > observation > review > design_architect > backend_architect > gap_hunter > design_hardener > decision_memory > coding_director > user_communication > planning > question > research > custom > general.
Example: "verify my plan is correct" matches both verification and planning — choose verification.
Example: "review the design quality" matches both review and design_architect — choose review.

## Output Format
When classifying, respond with ONLY the category name as a single lowercase word (use underscores for multi-word categories). No explanation, no punctuation, no extra text.

## Routing Rules
- verification → Verification Team
- ui_testing → UI Testing Agent
- observation → Observation Agent
- review → Review Agent
- design_architect → Frontend Architect Agent
- backend_architect → Backend Architect Agent
- gap_hunter → Gap Hunter Agent
- design_hardener → Design Hardener Agent
- decision_memory → Decision Memory Agent
- coding_director → Coding Director Agent
- user_communication → User Communication Agent
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
- Never crash — wrap all agent calls in error handling

## Escalation & Support (v7.0)
If you cannot proceed or information is missing:
- **escalate_to_boss**: Return ticket to Boss AI with reason and recommended target queue
- **call_support_agent**: Call support agents (answer, research, clarity, decision_memory)
  - sync mode: Quick lookups (answer, clarity, decision_memory)
  - async mode: Research tasks (research agent)
- **save_document**: Save findings to documentation system for future reference`;

    private planningAgent!: PlanningAgent;
    private answerAgent!: AnswerAgent;
    private verificationAgent!: VerificationAgent;
    private researchAgent!: ResearchAgent;
    private clarityAgent!: ClarityAgent;
    private bossAgent!: BossAgent;
    private customAgentRunner!: CustomAgentRunner;
    private uiTestingAgent!: UITestingAgent;
    private observationAgent!: ObservationAgent;
    private frontendArchitectAgent!: FrontendArchitectAgent;
    private backendArchitectAgent!: BackendArchitectAgent;
    private gapHunterAgent!: GapHunterAgent;
    private designHardenerAgent!: DesignHardenerAgent;
    private decisionMemoryAgent!: DecisionMemoryAgent;
    private reviewAgent!: ReviewAgent;
    private codingDirectorAgent!: CodingDirectorAgent;
    private userCommunicationAgent!: UserCommunicationAgent;
    private llmOffline = false;
    private evolutionService: EvolutionService | null = null;
    private eventBus: EventBus | null = null;
    private injectedTreeManager: AgentTreeManager | undefined;
    // v4.1: Track scheduled timers for cleanup on dispose
    private pendingTimers = new Set<ReturnType<typeof setTimeout>>();

    setEvolutionService(service: EvolutionService): void {
        this.evolutionService = service;
    }

    getEvolutionService(): EvolutionService | null {
        return this.evolutionService;
    }

    setEventBus(eventBus: EventBus): void {
        this.eventBus = eventBus;
    }

    getEventBus(): EventBus | null {
        return this.eventBus;
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
        this.uiTestingAgent = new UITestingAgent(this.database, this.llm, this.config, this.outputChannel);
        this.observationAgent = new ObservationAgent(this.database, this.llm, this.config, this.outputChannel);
        this.frontendArchitectAgent = new FrontendArchitectAgent(this.database, this.llm, this.config, this.outputChannel);
        this.backendArchitectAgent = new BackendArchitectAgent(this.database, this.llm, this.config, this.outputChannel);
        this.gapHunterAgent = new GapHunterAgent(this.database, this.llm, this.config, this.outputChannel);
        this.designHardenerAgent = new DesignHardenerAgent(this.database, this.llm, this.config, this.outputChannel);
        this.decisionMemoryAgent = new DecisionMemoryAgent(this.database, this.llm, this.config, this.outputChannel);
        this.reviewAgent = new ReviewAgent(this.database, this.llm, this.config, this.outputChannel);
        this.codingDirectorAgent = new CodingDirectorAgent(this.database, this.llm, this.config, this.outputChannel);
        this.userCommunicationAgent = new UserCommunicationAgent(this.database, this.llm, this.config, this.outputChannel);

        await Promise.all([
            this.planningAgent.initialize(),
            this.answerAgent.initialize(),
            this.verificationAgent.initialize(),
            this.researchAgent.initialize(),
            this.clarityAgent.initialize(),
            this.bossAgent.initialize(),
            this.customAgentRunner.initialize(),
            this.uiTestingAgent.initialize(),
            this.observationAgent.initialize(),
            this.frontendArchitectAgent.initialize(),
            this.backendArchitectAgent.initialize(),
            this.gapHunterAgent.initialize(),
            this.designHardenerAgent.initialize(),
            this.decisionMemoryAgent.initialize(),
            this.reviewAgent.initialize(),
            this.codingDirectorAgent.initialize(),
            this.userCommunicationAgent.initialize(),
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
        this.database.updateAgentStatus(agent.name, AgentStatus.Working, message.substring(0, 100));

        try {
            const response = await agent.processMessage(message, context);
            this.evolutionService?.incrementCallCounter();
            return response;
        } catch (error) {
            return this.handleAgentError(agent.name, error, message, context, true);
        } finally {
            this.database.updateAgentStatus(agent.name, AgentStatus.Idle);
        }
    }

    async callAgent(agentName: string, message: string, context: AgentContext): Promise<AgentResponse> {
        const agent = this.getAgentByName(agentName);
        if (!agent) {
            return { content: `Agent not found: ${agentName}` };
        }
        this.database.addAuditLog('orchestrator', 'direct_call', `Direct call to ${agentName}`);
        this.database.updateAgentStatus(agentName, AgentStatus.Working, message.substring(0, 100));

        try {
            const response = await agent.processMessage(message, context);
            this.evolutionService?.incrementCallCounter();
            return response;
        } catch (error) {
            return this.handleAgentError(agentName, error, message, context, false);
        } finally {
            this.database.updateAgentStatus(agentName, AgentStatus.Idle);
        }
    }

    /**
     * v4.1 — Shared error boundary for all agent call paths.
     * Captures stack trace, logs to audit, emits structured event, creates investigation ticket.
     * @param createTicket Whether to create an investigation ticket (route path) or just log (direct call path)
     */
    private handleAgentError(
        agentName: string,
        error: unknown,
        message: string,
        context: AgentContext,
        createInvestigationTicket: boolean,
    ): AgentResponse {
        const msg = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? (error.stack ?? '').substring(0, 2000) : '';

        this.outputChannel.appendLine(`Agent ${agentName} error: ${msg}`);
        this.database.addAuditLog('orchestrator', 'agent_error',
            `${agentName}: ${msg}${stack ? `\nStack: ${stack.substring(0, 500)}` : ''}`);

        // v4.1: Emit structured agent:error event for observability
        this.eventBus?.emit('agent:error', 'orchestrator', {
            agentName,
            error: msg,
            stack,
            ticketId: context.ticket?.id,
            taskId: context.task?.id,
            messagePreview: message.substring(0, 200),
        });

        if (createInvestigationTicket) {
            this.database.createTicket({
                title: `Agent error: ${agentName}`,
                body: `Agent "${agentName}" threw an error while processing message.\n\nError: ${msg}\n${stack ? `\nStack trace:\n${stack}\n` : ''}\nOriginal message: ${message.substring(0, 200)}`,
                priority: TicketPriority.P1,
                creator: 'Orchestrator',
                task_id: context.task?.id,
            });
            return { content: `Error from ${agentName}: ${msg}. Investigation ticket created.` };
        }

        return { content: `Error from ${agentName}: ${msg}` };
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
                // KEYWORD_MAP and INTENT_PRIORITY always use the same known keys,
                // so the ?? 5 fallback is a defensive guard that can't be reached.
                /* istanbul ignore next */
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
            case 'ui_testing': return this.uiTestingAgent;
            case 'observation': return this.observationAgent;
            case 'design_architect': return this.frontendArchitectAgent;
            case 'backend_architect': return this.backendArchitectAgent;
            case 'gap_hunter': return this.gapHunterAgent;
            case 'design_hardener': return this.designHardenerAgent;
            case 'decision_memory': return this.decisionMemoryAgent;
            case 'review': return this.reviewAgent;
            case 'coding_director': return this.codingDirectorAgent;
            case 'user_communication': return this.userCommunicationAgent;
            case 'question': return this.answerAgent;
            case 'research': return this.researchAgent;
            case 'custom': return this.customAgentRunner;
            case 'general': return this.answerAgent;
            default: return this.answerAgent;
        }
    }

    private getAgentByName(name: string): BaseAgent | null {
        const agents: Record<string, BaseAgent> = {
            orchestrator: this,
            planning: this.planningAgent,
            answer: this.answerAgent,
            verification: this.verificationAgent,
            ui_testing: this.uiTestingAgent,
            observation: this.observationAgent,
            research: this.researchAgent,
            clarity: this.clarityAgent,
            boss: this.bossAgent,
            custom: this.customAgentRunner,
            design_architect: this.frontendArchitectAgent,
            frontend_architect: this.frontendArchitectAgent,
            backend_architect: this.backendArchitectAgent,
            gap_hunter: this.gapHunterAgent,
            design_hardener: this.designHardenerAgent,
            decision_memory: this.decisionMemoryAgent,
            review: this.reviewAgent,
            coding_director: this.codingDirectorAgent,
            user_communication: this.userCommunicationAgent,
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
        const timer = setTimeout(() => {
            this.pendingTimers.delete(timer);
            this.runVerificationWithRetry(taskId, task.title, filesModified, summary, 0)
                .catch(e => this.outputChannel.appendLine(`Unhandled verification error: ${e}`));
        }, delay);
        this.pendingTimers.add(timer);
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
                const retryTimer = setTimeout(() => {
                    this.pendingTimers.delete(retryTimer);
                    this.runVerificationWithRetry(taskId, title, filesModified, summary, 1)
                        .catch(e => this.outputChannel.appendLine(`Unhandled verification retry error: ${e}`));
                }, 30_000);
                this.pendingTimers.add(retryTimer);
            } else {
                // After 2 failures, create investigation ticket
                this.database.createTicket({
                    title: `Verification failed: ${title}`,
                    body: `Automated verification failed twice for task ${taskId}.\n\nError: ${error}\n\nFiles: ${filesModified.join(', ')}\nSummary: ${summary}`,
                    priority: TicketPriority.P1,
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
    getUITestingAgent(): UITestingAgent { return this.uiTestingAgent; }
    getObservationAgent(): ObservationAgent { return this.observationAgent; }
    getFrontendArchitectAgent(): FrontendArchitectAgent { return this.frontendArchitectAgent; }
    /** @deprecated Use getFrontendArchitectAgent() — kept for backward compatibility */
    getDesignArchitectAgent(): FrontendArchitectAgent { return this.frontendArchitectAgent; }
    getBackendArchitectAgent(): BackendArchitectAgent { return this.backendArchitectAgent; }
    getGapHunterAgent(): GapHunterAgent { return this.gapHunterAgent; }
    getDesignHardenerAgent(): DesignHardenerAgent { return this.designHardenerAgent; }
    getDecisionMemoryAgent(): DecisionMemoryAgent { return this.decisionMemoryAgent; }
    getReviewAgent(): ReviewAgent { return this.reviewAgent; }
    getCodingDirectorAgent(): CodingDirectorAgent { return this.codingDirectorAgent; }
    getUserCommunicationAgent(): UserCommunicationAgent { return this.userCommunicationAgent; }

    /**
     * Get all agents (including the orchestrator itself) as an array.
     * Useful for injecting shared services into all agents at once.
     */
    getAllAgents(): BaseAgent[] {
        return [
            this,
            this.planningAgent,
            this.answerAgent,
            this.verificationAgent,
            this.researchAgent,
            this.clarityAgent,
            this.bossAgent,
            this.customAgentRunner,
            this.uiTestingAgent,
            this.observationAgent,
            this.frontendArchitectAgent,
            this.backendArchitectAgent,
            this.gapHunterAgent,
            this.designHardenerAgent,
            this.decisionMemoryAgent,
            this.reviewAgent,
            this.codingDirectorAgent,
            this.userCommunicationAgent,
        ];
    }

    /**
     * Inject token management services into all agents.
     * Called during extension activation after services are created.
     */
    injectContextServices(budgetTracker: TokenBudgetTracker, contextFeeder: ContextFeeder): void {
        for (const agent of this.getAllAgents()) {
            agent.setContextServices(budgetTracker, contextFeeder);
        }
        this.outputChannel.appendLine(`Context services injected into ${this.getAllAgents().length} agents.`);
    }

    /**
     * Inject the deterministic decomposition engine into the PlanningAgent.
     */
    injectDecompositionEngine(engine: TaskDecompositionEngine): void {
        this.planningAgent.setDecompositionEngine(engine);
        this.outputChannel.appendLine('TaskDecompositionEngine injected into PlanningAgent.');
    }

    // ==================== v9.0: SERVICE INJECTION ====================

    /**
     * v9.0: Inject permission manager into all agents for permission enforcement.
     */
    injectPermissionManager(pm: AgentPermissionManager): void {
        for (const agent of this.getAllAgents()) {
            agent.setPermissionManager(pm);
        }
        this.outputChannel.appendLine(`AgentPermissionManager injected into ${this.getAllAgents().length} agents.`);
    }

    /**
     * v9.0: Inject model router into all agents for multi-model support.
     */
    injectModelRouter(mr: ModelRouter): void {
        for (const agent of this.getAllAgents()) {
            agent.setModelRouter(mr);
        }
        this.outputChannel.appendLine(`ModelRouter injected into ${this.getAllAgents().length} agents.`);
    }

    /**
     * v9.0: Inject agent tree manager into all agents for tree-aware processing.
     */
    injectAgentTreeManager(atm: AgentTreeManager): void {
        this.injectedTreeManager = atm;
        for (const agent of this.getAllAgents()) {
            agent.setAgentTreeManager(atm);
        }
        this.outputChannel.appendLine(`AgentTreeManager injected into ${this.getAllAgents().length} agents.`);
    }

    /**
     * v9.0: Get the injected agent tree manager.
     */
    getAgentTreeManager(): AgentTreeManager | undefined {
        return this.injectedTreeManager;
    }

    /**
     * v9.0: Inject user profile manager into the UserCommunicationAgent.
     */
    injectUserProfileManager(upm: UserProfileManager): void {
        this.userCommunicationAgent.setUserProfileManager(upm);
        this.outputChannel.appendLine('UserProfileManager injected into UserCommunicationAgent.');
    }

    /**
     * v9.0: Route a message through the UserCommunicationAgent pipeline.
     * Called when any agent needs to ask the user a question — this ensures
     * it goes through the full communication pipeline (cache check, profile routing,
     * AI mode gate, question rewriting).
     */
    async routeToUser(
        question: string,
        sourceAgent: string,
        context: AgentContext,
        escalationChainId?: string,
    ): Promise<import('./user-communication-agent').QuestionRouteResult> {
        return this.userCommunicationAgent.routeQuestion(question, sourceAgent, context, escalationChainId);
    }

    dispose(): void {
        // v4.1: Clear all pending verification timers
        for (const timer of this.pendingTimers) clearTimeout(timer);
        this.pendingTimers.clear();
        super.dispose();
        this.planningAgent?.dispose();
        this.answerAgent?.dispose();
        this.verificationAgent?.dispose();
        this.researchAgent?.dispose();
        this.clarityAgent?.dispose();
        this.bossAgent?.dispose();
        this.customAgentRunner?.dispose();
        this.uiTestingAgent?.dispose();
        this.observationAgent?.dispose();
        this.frontendArchitectAgent?.dispose();
        this.backendArchitectAgent?.dispose();
        this.gapHunterAgent?.dispose();
        this.designHardenerAgent?.dispose();
        this.decisionMemoryAgent?.dispose();
        this.reviewAgent?.dispose();
        this.codingDirectorAgent?.dispose();
        this.userCommunicationAgent?.dispose();
    }
}
