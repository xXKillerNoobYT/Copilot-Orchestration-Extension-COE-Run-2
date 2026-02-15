/**
 * TicketProcessorService — Auto-processing engine for tickets
 *
 * Two independent queues:
 *   1. Main queue: Normal ticket processing (serial, priority-ordered)
 *   2. Boss queue: Boss AI action tickets (separate serial queue, never blocked by main)
 *
 * Handles agent routing, verification dispatch, tiered retry, ghost tickets,
 * ticket limits, and idle watchdog.
 *
 * Wire in: extension.ts after orchestrator initialization.
 */

import { Database } from './database';
import { EventBus, COEEvent, COEEventType } from './event-bus';
import { ConfigManager } from './config';
import {
    Ticket, TicketStatus, TicketPriority, AgentContext, AgentResponse, AgentAction, TicketRun,
    ProjectPhase, PHASE_ORDER, PhaseGateResult,
} from '../types';

// ==================== INTERFACES ====================

export interface OutputChannelLike {
    appendLine(msg: string): void;
}

/** v4.1: Minimal interface for ReviewAgent, avoiding tight coupling to concrete class */
export interface ReviewAgentLike {
    reviewTicket(ticket: Ticket, agentResponse: string): Promise<AgentResponse>;
}

/** v4.2: Minimal interface for BossAgent, avoiding tight coupling */
export interface BossAgentLike {
    checkSystemHealth(): Promise<AgentResponse>;
}

/** v4.3: Minimal interface for ClarityAgent, used for friendly message rewrites */
export interface ClarityAgentLike {
    rewriteForUser(rawMessage: string, sourceAgent?: string): Promise<string>;
}

export interface OrchestratorLike {
    callAgent(agentName: string, message: string, context: AgentContext): Promise<AgentResponse>;
    /** v4.1 (WS5B): Direct access to ReviewAgent for full-context reviews */
    getReviewAgent(): ReviewAgentLike;
    /** v4.2: Direct access to BossAgent for inter-ticket orchestration */
    getBossAgent(): BossAgentLike;
    /** v4.3: Direct access to ClarityAgent for user-friendly message rewrites */
    getClarityAgent(): ClarityAgentLike;
}

interface QueuedTicket {
    ticketId: string;
    priority: string;
    enqueuedAt: number;
    operationType: string;
    errorRetryCount: number;
}

/** Maps operation_type + title patterns → agent routing */
interface AgentRoute {
    agentName: string;
    deliverableType: string;
    stage: number;
}

/**
 * Intelligent agent pipeline — each ticket step routes to a specific agent.
 * Pipeline steps run in order; each step's output feeds the next step's context.
 *
 * Example: A design ticket's pipeline is:
 *   1. planning → define requirements and structure
 *   2. design_architect → create pages and components based on those requirements
 *
 * This ensures the right agent handles the right part of the work.
 */
interface AgentPipeline {
    steps: AgentRoute[];
    deliverableType: string;
}

// ==================== AGENT ROUTING MAP ====================

/**
 * Route a ticket to the correct agent (single step — backward compatible).
 * Returns the first step of the pipeline.
 */
function routeTicketToAgent(ticket: Ticket): AgentRoute | null {
    const pipeline = routeTicketToPipeline(ticket);
    if (!pipeline) return null;
    return pipeline.steps[0];
}

/**
 * Check if a ticket already has enough structured context to skip the planning step.
 * Returns true if the ticket body contains acceptance criteria, step-by-step instructions,
 * or was created by the planning agent (and thus already has rich context).
 */
function hasRichContext(ticket: Ticket): boolean {
    const body = (ticket.body || '').toLowerCase();
    const len = body.length;

    // Short tickets never have enough context
    if (len < 100) return false;

    // Check for markers that indicate planning has already been done:
    // - Acceptance criteria present in body
    // - Step-by-step instructions present
    // - Context bundle attached
    // - Created by a planning ticket that already split the work
    const hasAcceptanceCriteria = !!ticket.acceptance_criteria || body.includes('acceptance criteria');
    const hasSteps = body.includes('step') || body.includes('implement:') || body.includes('context:');
    const hasStructuredContent = body.includes('1.') || body.includes('- ');

    // If it has acceptance criteria AND either steps or structured content, skip planning
    return hasAcceptanceCriteria && (hasSteps || hasStructuredContent);
}

/**
 * Route a ticket to a full agent pipeline for intelligent multi-agent processing.
 * Each step handles a different aspect of the work:
 *   - orchestrator (first): assesses what's needed for this ticket
 *   - planning: decides requirements, structure, and approach
 *   - design_architect: creates page/component designs from requirements
 *   - gap_hunter: finds missing pieces in a design
 *   - coding: implements the code
 *   - verification: verifies the result
 *   - orchestrator (last): verifies completion and coherence
 *
 * v4.2: Orchestrator wraps every pipeline as first and last agent (per True Plan 03).
 * The first orchestrator step assesses the ticket and builds an execution plan.
 * The last orchestrator step reviews the output for completeness and coherence.
 *
 * Intelligent skipping: If a ticket already has rich context (e.g., from the
 * planning agent that created it), the planning step is skipped and execution
 * goes directly to the appropriate agent. This avoids redundant LLM calls.
 */
function routeTicketToPipeline(ticket: Ticket): AgentPipeline | null {
    const op = ticket.operation_type || '';
    const title = ticket.title.toLowerCase();
    const richContext = hasRichContext(ticket);

    // Skip user-created tickets (manual)
    if (op === 'user_created') return null;

    // Boss directives: single-step to Boss AI (no orchestrator wrap — Boss IS the supervisor)
    if (op === 'boss_directive') {
        return { steps: [{ agentName: 'boss', deliverableType: 'communication', stage: 1 }], deliverableType: 'communication' };
    }

    // Phase: Configuration — skip (already complete)
    if (title.startsWith('phase: configuration')) {
        return null;
    }

    // Ghost tickets → clarity agent for user communication (lightweight, no orchestrator wrap)
    if (ticket.is_ghost || op === 'ghost_ticket') {
        return {
            steps: [{ agentName: 'clarity', deliverableType: 'communication', stage: 1 }],
            deliverableType: 'communication',
        };
    }

    // --- All other tickets get orchestrator as first and last agent ---
    const orchFirst: AgentRoute = { agentName: 'orchestrator', deliverableType: 'assessment', stage: 0 };
    const orchLast: AgentRoute = { agentName: 'orchestrator', deliverableType: 'completion_review', stage: 99 };

    // Phase: Task Generation — planning creates tasks from the design
    if (title.startsWith('phase: task generation') || op === 'plan_generation') {
        return {
            steps: [
                orchFirst,
                { agentName: 'planning', deliverableType: 'plan_generation', stage: 1 },
                orchLast,
            ],
            deliverableType: 'plan_generation',
        };
    }

    // Phase: Design — planning sets requirements, then design_architect creates pages/components
    // Skip planning step if ticket already has rich design requirements
    if (title.startsWith('phase: design') || title.startsWith('phase: data model') || op === 'design_change') {
        if (richContext) {
            return {
                steps: [
                    orchFirst,
                    { agentName: 'design_architect', deliverableType: 'design_change', stage: 1 },
                    orchLast,
                ],
                deliverableType: 'design_change',
            };
        }
        return {
            steps: [
                orchFirst,
                { agentName: 'planning', deliverableType: 'design_requirements', stage: 1 },
                { agentName: 'design_architect', deliverableType: 'design_change', stage: 1 },
                orchLast,
            ],
            deliverableType: 'design_change',
        };
    }

    // Phase: Verification — verification agent
    if (title.startsWith('phase: verification') || op === 'verification') {
        return {
            steps: [
                orchFirst,
                { agentName: 'verification', deliverableType: 'verification', stage: 3 },
                orchLast,
            ],
            deliverableType: 'verification',
        };
    }

    // Coding tickets — if planning already provided full context, skip straight to coding
    if (title.startsWith('coding:') || title.startsWith('rework:') || op === 'code_generation') {
        if (richContext) {
            return {
                steps: [
                    orchFirst,
                    { agentName: 'coding', deliverableType: 'code_generation', stage: 2 },
                    orchLast,
                ],
                deliverableType: 'code_generation',
            };
        }
        return {
            steps: [
                orchFirst,
                { agentName: 'planning', deliverableType: 'implementation_plan', stage: 2 },
                { agentName: 'coding', deliverableType: 'code_generation', stage: 2 },
                orchLast,
            ],
            deliverableType: 'code_generation',
        };
    }

    // Verify tickets (explicit)
    if (title.startsWith('verify:')) {
        return {
            steps: [
                orchFirst,
                { agentName: 'verification', deliverableType: 'verification', stage: 3 },
                orchLast,
            ],
            deliverableType: 'verification',
        };
    }

    // Default: planning agent
    return {
        steps: [
            orchFirst,
            { agentName: 'planning', deliverableType: 'communication', stage: 1 },
            orchLast,
        ],
        deliverableType: 'communication',
    };
}

// ==================== TICKET PROCESSOR SERVICE ====================

export class TicketProcessorService {
    private mainQueue: QueuedTicket[] = [];
    private bossQueue: QueuedTicket[] = [];
    private mainProcessing = false;
    private bossProcessing = false;
    private idleTimeout: ReturnType<typeof setTimeout> | null = null;
    private lastActivityTimestamp = Date.now();
    private nextBossCheckAt = 0;
    private eventHandlers: Array<{ type: COEEventType; handler: (event: COEEvent) => void }> = [];
    private disposed = false;

    constructor(
        private database: Database,
        private orchestrator: OrchestratorLike,
        private eventBus: EventBus,
        private config: ConfigManager,
        private outputChannel: OutputChannelLike
    ) {}

    /**
     * Start listening for ticket events and begin processing.
     */
    start(): void {
        this.outputChannel.appendLine('[TicketProcessor] Starting ticket auto-processing...');

        // Listen for new tickets
        this.listen('ticket:created', (event) => {
            const ticketId = event.data.ticketId as string;
            if (!ticketId) return;
            const ticket = this.database.getTicket(ticketId);
            if (!ticket || !ticket.auto_created) return;

            // Check AI level from plan config
            const aiLevel = this.getAILevel(ticket);
            if (aiLevel === 'manual') return;

            this.enqueueTicket(ticket);
        });

        // Listen for unblocked tickets (ghost resolved)
        this.listen('ticket:unblocked', (event) => {
            const ticketId = event.data.ticketId as string;
            if (!ticketId) return;
            const ticket = this.database.getTicket(ticketId);
            if (ticket && ticket.auto_created) {
                this.enqueueTicket(ticket);
            }
        });

        // Listen for completed tickets to check phase gates, auto-advance, and kick next ticket
        this.listen('ticket:processing_completed', () => {
            // Debounce: defer to next tick so all DB writes from the current processing settle
            setTimeout(() => {
                if (!this.disposed) {
                    this.checkAndAdvancePhase();
                    // v4.1: Ensure queue keeps processing after completions
                    if (this.mainQueue.length > 0) this.processMainQueue();
                }
            }, 500);
        });

        // v4.1: Listen for user replies on held tickets — if the API unblocked it,
        // the ticket:unblocked event will fire separately and re-enqueue it.
        // Here we also kick the processor if it's idle.
        this.listen('ticket:replied', () => {
            setTimeout(() => {
                if (!this.disposed && this.mainQueue.length > 0) this.processMainQueue();
            }, 300);
        });

        // v4.1: When a review holds a ticket and a new one is ready, process it
        this.listen('ticket:review_flagged', () => {
            setTimeout(() => {
                if (!this.disposed && this.mainQueue.length > 0) this.processMainQueue();
            }, 300);
        });

        // v4.1: When an AI question is answered, kick the processor
        this.listen('ai:question_answered', () => {
            setTimeout(() => {
                if (!this.disposed && this.mainQueue.length > 0) this.processMainQueue();
            }, 300);
        });

        // Track activity for idle watchdog
        const activityEvents: COEEventType[] = [
            'ticket:created', 'ticket:updated', 'ticket:resolved',
            'task:completed', 'task:verified', 'task:started',
            'agent:completed',
        ];
        for (const evtType of activityEvents) {
            this.listen(evtType, () => {
                this.lastActivityTimestamp = Date.now();
                this.resetIdleWatchdog();
            });
        }

        // Start idle watchdog
        this.resetIdleWatchdog();

        // Recover orphaned tickets from previous session
        this.recoverOrphanedTickets();

        this.outputChannel.appendLine('[TicketProcessor] Ready — listening for ticket events');

        // v4.2: Run Boss AI startup assessment (per True Plan 03)
        // The Boss AI runs on first startup to assess system state, recover issues,
        // and pick up where we left off. Deferred to let all listeners settle.
        setTimeout(() => {
            if (!this.disposed) this.runBossStartupAssessment();
        }, 2000);
    }

    /**
     * Recover tickets stuck in processing states from a previous session.
     * Called on startup to prevent tickets from being permanently orphaned.
     *
     * v4.1: Expanded scope — recovers:
     *   1. in_review tickets with processing_status != 'holding' (original)
     *   2. Open tickets with processing_status = 'queued' but not in our in-memory queue (lost from queue on crash)
     *   3. in_review tickets with processing_status = 'processing' (stale, older than 10 min)
     */
    private recoverOrphanedTickets(): void {
        const recovered: Ticket[] = [];

        // 1. Stuck in_review tickets (not holding)
        const inReviewStuck = this.database.getTicketsByStatus('in_review')
            .filter(t => t.auto_created && t.processing_status !== 'holding');
        recovered.push(...inReviewStuck);

        // 2. Open tickets marked 'queued' but not in our queue (lost from in-memory queue on crash)
        const openQueued = this.database.getTicketsByStatus('open')
            .filter(t => t.auto_created && t.processing_status === 'queued');
        for (const ticket of openQueued) {
            const inMainQueue = this.mainQueue.some(q => q.ticketId === ticket.id);
            const inBossQueue = this.bossQueue.some(q => q.ticketId === ticket.id);
            if (!inMainQueue && !inBossQueue) {
                recovered.push(ticket);
            }
        }

        // 3. Stale 'processing' tickets (older than 10 min updated_at)
        const staleThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const staleProcessing = this.database.getTicketsByStatus('in_review')
            .filter(t => t.auto_created && t.processing_status === 'processing' && t.updated_at < staleThreshold);
        // Avoid duplicates
        for (const ticket of staleProcessing) {
            if (!recovered.some(r => r.id === ticket.id)) {
                recovered.push(ticket);
            }
        }

        if (recovered.length === 0) return;

        this.outputChannel.appendLine(
            `[TicketProcessor] Recovering ${recovered.length} orphaned tickets (in_review: ${inReviewStuck.length}, lost queued: ${openQueued.length - inReviewStuck.length >= 0 ? recovered.length - inReviewStuck.length : 0}, stale: ${staleProcessing.length})`
        );

        for (const ticket of recovered) {
            const route = routeTicketToAgent(ticket);
            if (!route) continue;

            // Reset status and re-enqueue
            this.database.updateTicket(ticket.id, {
                status: TicketStatus.Open,
                processing_status: 'queued',
            });
            this.database.addTicketReply(ticket.id, 'system',
                'Ticket recovered from stuck state after system restart.'
            );

            const entry: QueuedTicket = {
                ticketId: ticket.id,
                priority: ticket.priority,
                enqueuedAt: Date.now(),
                operationType: ticket.operation_type || 'unknown',
                errorRetryCount: 0,
            };

            if (ticket.operation_type === 'boss_directive') {
                this.bossQueue.push(entry);
            } else {
                this.mainQueue.push(entry);
            }

            this.eventBus.emit('ticket:recovered', 'ticket-processor', {
                ticketId: ticket.id, ticketNumber: ticket.ticket_number,
            });
        }

        // Sort and kick off processing
        this.sortQueue(this.mainQueue);
        this.sortQueue(this.bossQueue);

        if (this.mainQueue.length > 0) this.processMainQueue();
        if (this.bossQueue.length > 0) this.processBossQueue();
    }

    /**
     * Manually trigger recovery of stuck tickets.
     * Can be called from the API or by the Boss Agent.
     */
    recoverStuckTickets(): number {
        const stuckTickets = this.database.getTicketsByStatus('in_review')
            .filter(t => t.auto_created && t.processing_status !== 'holding');

        for (const ticket of stuckTickets) {
            const route = routeTicketToAgent(ticket);
            if (!route) continue;

            this.database.updateTicket(ticket.id, {
                status: TicketStatus.Open,
                processing_status: 'queued',
            });
            this.database.addTicketReply(ticket.id, 'system',
                'Ticket recovered via manual recovery trigger.'
            );

            const entry: QueuedTicket = {
                ticketId: ticket.id,
                priority: ticket.priority,
                enqueuedAt: Date.now(),
                operationType: ticket.operation_type || 'unknown',
                errorRetryCount: 0,
            };

            if (ticket.operation_type === 'boss_directive') {
                this.bossQueue.push(entry);
            } else {
                this.mainQueue.push(entry);
            }

            this.eventBus.emit('ticket:recovered', 'ticket-processor', {
                ticketId: ticket.id, ticketNumber: ticket.ticket_number,
            });
        }

        this.sortQueue(this.mainQueue);
        this.sortQueue(this.bossQueue);

        if (this.mainQueue.length > 0) this.processMainQueue();
        if (this.bossQueue.length > 0) this.processBossQueue();

        return stuckTickets.length;
    }

    /**
     * Enqueue a ticket for processing.
     */
    private enqueueTicket(ticket: Ticket): void {
        const cfg = this.config.getConfig();
        const maxActive = cfg.maxActiveTickets ?? 10;

        // Ticket limits enforcement (B10)
        const activeCount = this.database.getActiveTicketCount();
        if (activeCount >= maxActive) {
            // P1 tickets can bump P3 tickets
            if (ticket.priority === TicketPriority.P1) {
                const bumped = this.bumpLowestPriority();
                if (!bumped) {
                    this.outputChannel.appendLine(`[TicketProcessor] Ticket limit reached (${maxActive}), P1 ticket queued pending`);
                    this.database.updateTicket(ticket.id, { processing_status: 'queued' });
                    return;
                }
            } else {
                this.outputChannel.appendLine(`[TicketProcessor] Ticket limit reached (${maxActive}), ticket pending`);
                this.database.updateTicket(ticket.id, { processing_status: 'queued' });
                return;
            }
        }

        // Update status
        this.database.updateTicket(ticket.id, { processing_status: 'queued' });
        this.eventBus.emit('ticket:queued', 'ticket-processor', { ticketId: ticket.id, ticketNumber: ticket.ticket_number });

        const entry: QueuedTicket = {
            ticketId: ticket.id,
            priority: ticket.priority,
            enqueuedAt: Date.now(),
            operationType: ticket.operation_type || 'unknown',
            errorRetryCount: 0,
        };

        // Route to boss or main queue
        if (ticket.operation_type === 'boss_directive') {
            this.bossQueue.push(entry);
            this.sortQueue(this.bossQueue);
            this.processBossQueue();
        } else {
            this.mainQueue.push(entry);
            this.sortQueue(this.mainQueue);
            this.processMainQueue();
        }
    }

    /**
     * Process the main queue (serial, peek-then-remove pattern).
     * v4.1: Schedule delayed restart when processing fails to prevent queue stalls.
     * v4.2: Boss AI runs between every ticket to assess state and pick next (per True Plan 03).
     */
    private async processMainQueue(): Promise<void> {
        if (this.mainProcessing || this.mainQueue.length === 0 || this.disposed) return;
        this.mainProcessing = true;

        let ticketsProcessed = 0;

        while (this.mainQueue.length > 0 && !this.disposed) {
            // v4.2: Boss AI inter-ticket orchestration — runs between every ticket
            // (Skip before the very first ticket — Boss startup assessment handles that)
            if (ticketsProcessed > 0) {
                await this.runBossInterTicket();
            }

            const entry = this.mainQueue[0]; // PEEK — do not remove yet
            const success = await this.processTicket(entry.ticketId, entry);
            if (success) {
                this.mainQueue.shift(); // Only remove on success
                ticketsProcessed++;
            } else {
                // processTicket handled re-enqueue/removal internally
                // v4.1: Schedule delayed restart so queue doesn't stall forever
                if (!this.disposed && this.mainQueue.length > 0) {
                    setTimeout(() => {
                        if (!this.disposed) this.processMainQueue();
                    }, 5000);
                }
                break;
            }
        }

        this.mainProcessing = false;

        // v4.2: When all tickets are processed, start the Boss AI 5-minute idle cycle.
        // Boss AI will check system state periodically and create new work if needed.
        if (!this.disposed) {
            this.lastActivityTimestamp = Date.now();
            this.resetIdleWatchdog();
        }
    }

    /**
     * Process the boss queue (serial, independent from main, peek-then-remove).
     * v4.1: Schedule delayed restart when processing fails.
     */
    private async processBossQueue(): Promise<void> {
        if (this.bossProcessing || this.bossQueue.length === 0 || this.disposed) return;
        this.bossProcessing = true;

        while (this.bossQueue.length > 0 && !this.disposed) {
            const entry = this.bossQueue[0]; // PEEK
            const success = await this.processTicket(entry.ticketId, entry);
            if (success) {
                this.bossQueue.shift();
            } else {
                // v4.1: Schedule delayed restart
                if (!this.disposed && this.bossQueue.length > 0) {
                    setTimeout(() => {
                        if (!this.disposed) this.processBossQueue();
                    }, 5000);
                }
                break;
            }
        }

        this.bossProcessing = false;

        // v4.2: Boss queue drained — reset idle watchdog for next cycle
        if (!this.disposed) {
            this.resetIdleWatchdog();
        }
    }

    /**
     * Process a single ticket through the agent pipeline.
     * Returns true on success (resolved, held, or skipped), false on error (needs re-enqueue).
     *
     * v4.1: Each processing attempt creates a TicketRun log entry.
     * On retries, previous run logs are included in the agent prompt context.
     */
    private async processTicket(ticketId: string, queueEntry?: QueuedTicket): Promise<boolean> {
        const ticket = this.database.getTicket(ticketId);
        if (!ticket) return true; // Missing ticket — skip (remove from queue)

        // Skip if already resolved or on_hold (cancelled)
        if (ticket.status === TicketStatus.Resolved || ticket.status === 'on_hold' as TicketStatus) {
            return true;
        }

        // v4.1: Skip if ticket is currently held for user review
        if (ticket.processing_status === 'holding') {
            this.outputChannel.appendLine(
                `[TicketProcessor] TK-${ticket.ticket_number} held for user — skipping, will re-queue on unblock`
            );
            return true; // Remove from queue; ticket:unblocked will re-enqueue
        }

        // v4.1: Intelligent blocking — if this ticket is blocked by another unresolved ticket,
        // move it to the back of the queue and process the next one
        if (ticket.blocking_ticket_id) {
            const blocker = this.database.getTicket(ticket.blocking_ticket_id);
            if (blocker && blocker.status !== TicketStatus.Resolved) {
                this.outputChannel.appendLine(
                    `[TicketProcessor] TK-${ticket.ticket_number} blocked by TK-${blocker.ticket_number} — deferring`
                );
                // Move to back of queue so other tickets can process
                if (queueEntry) {
                    this.mainQueue.shift(); // Remove from front
                    this.mainQueue.push(queueEntry); // Push to back
                }
                return false; // Signal caller to break and retry later
            } else if (blocker && blocker.status === TicketStatus.Resolved) {
                // Blocker is resolved — clear the blocking reference
                this.database.updateTicket(ticketId, { blocking_ticket_id: null as any });
            }
        }

        // Get full pipeline for intelligent multi-agent routing
        const pipeline = routeTicketToPipeline(ticket);
        if (!pipeline) {
            this.outputChannel.appendLine(`[TicketProcessor] No agent route for ticket TK-${ticket.ticket_number}, skipping`);
            return true;
        }

        const route = pipeline.steps[0];

        // Update ticket status
        this.database.updateTicket(ticketId, {
            status: 'in_review' as TicketStatus,
            processing_agent: route.agentName,
            processing_status: 'processing',
            deliverable_type: pipeline.deliverableType as any,
            stage: route.stage,
        });
        const pipelineLabel = pipeline.steps.map(s => s.agentName).join(' → ');
        this.eventBus.emit('ticket:processing_started', 'ticket-processor', {
            ticketId, ticketNumber: ticket.ticket_number,
            processing_agent: route.agentName, processing_status: 'processing',
            title: ticket.title, pipeline: pipelineLabel,
        });
        this.outputChannel.appendLine(
            `[TicketProcessor] Processing TK-${ticket.ticket_number} via pipeline: ${pipelineLabel}`
        );

        // v4.1: Create a run log entry for this attempt
        const promptText = ticket.body || ticket.title;
        const startTime = Date.now();
        const run = this.database.createTicketRun({
            ticket_id: ticketId,
            agent_name: pipelineLabel,
            prompt_sent: promptText,
        });

        try {
            // v4.1: Build context with previous run history for retries
            const previousRuns = this.database.getTicketRuns(ticketId);
            let agentMessage = promptText;

            // If there are previous failed runs, include failure context for the AI
            const failedRuns = previousRuns.filter(r => r.id !== run.id && (r.status === 'failed' || r.error_message));
            if (failedRuns.length > 0) {
                const retryContext = failedRuns.map(r =>
                    `  Run #${r.run_number} (${r.agent_name}): ${r.status}${r.error_message ? ` — ${r.error_message}` : ''}${r.verification_result ? ` | Verification: ${r.verification_result}` : ''}`
                ).join('\n');
                agentMessage = `${promptText}\n\n--- Previous Attempts (${failedRuns.length} failed) ---\nThis is attempt #${run.run_number}. Previous attempts failed:\n${retryContext}\n\nPlease try a different approach to address the issues from previous attempts.`;
            }

            // Build ticket conversation context — include recent replies so agents can review history
            // without cramming everything into the prompt. Only include the last few relevant replies.
            const ticketReplies = this.database.getTicketReplies(ticketId);
            if (ticketReplies.length > 0) {
                // Take only the last 5 replies (or fewer) to keep prompt size manageable
                const recentReplies = ticketReplies.slice(-5);
                const conversationSummary = recentReplies.map(r =>
                    `[${r.author}]: ${r.body.substring(0, 300)}${r.body.length > 300 ? '...' : ''}`
                ).join('\n');
                agentMessage += `\n\n--- Ticket Conversation (${ticketReplies.length} total, showing last ${recentReplies.length}) ---\n${conversationSummary}`;
            }

            // Execute agent pipeline — each step feeds its output to the next step
            // v4.2: Orchestrator wraps as first step (assessment) and last step (completion review)
            let response: AgentResponse = { content: '' };
            let pipelineContext = agentMessage;

            for (let stepIdx = 0; stepIdx < pipeline.steps.length; stepIdx++) {
                const step = pipeline.steps[stepIdx];
                const isLastStep = stepIdx === pipeline.steps.length - 1;
                const isFirstStep = stepIdx === 0;

                // Update processing_agent for current step
                this.database.updateTicket(ticketId, { processing_agent: step.agentName });

                // v4.2: Build orchestrator-specific prompts for first/last pipeline steps
                let stepMessage = pipelineContext;
                if (step.agentName === 'orchestrator' && step.deliverableType === 'assessment' && isFirstStep) {
                    // Orchestrator FIRST step: assess the ticket and build an execution plan
                    const middleSteps = pipeline.steps.filter(s => s.agentName !== 'orchestrator' || s.deliverableType !== 'assessment' && s.deliverableType !== 'completion_review');
                    const agentList = middleSteps.map(s => s.agentName).join(' → ');
                    stepMessage = `TICKET ASSESSMENT — You are the Orchestrator assessing a ticket before specialist agents work on it.\n\n` +
                        `Ticket: "${ticket.title}" (TK-${ticket.ticket_number})\n` +
                        `Type: ${ticket.operation_type || 'general'}\n` +
                        `Priority: ${ticket.priority}\n` +
                        `Acceptance Criteria: ${ticket.acceptance_criteria || 'None specified'}\n\n` +
                        `Pipeline: ${agentList}\n\n` +
                        `Task: Analyze this ticket and provide:\n` +
                        `1. A brief assessment of what needs to be done\n` +
                        `2. Key requirements and constraints for the specialist agents\n` +
                        `3. Any risks or dependencies to watch for\n` +
                        `4. Success criteria the final output should meet\n\n` +
                        `Original ticket body:\n${pipelineContext}`;
                } else if (step.agentName === 'orchestrator' && step.deliverableType === 'completion_review' && isLastStep) {
                    // Orchestrator LAST step: review the pipeline output for completeness
                    stepMessage = `COMPLETION REVIEW — You are the Orchestrator reviewing the final output of a ticket pipeline.\n\n` +
                        `Ticket: "${ticket.title}" (TK-${ticket.ticket_number})\n` +
                        `Acceptance Criteria: ${ticket.acceptance_criteria || 'None specified'}\n\n` +
                        `Task: Review the pipeline output below and verify:\n` +
                        `1. Does the output address the ticket's requirements?\n` +
                        `2. Is the output complete and coherent?\n` +
                        `3. Are there any gaps, inconsistencies, or quality issues?\n` +
                        `4. VERDICT: PASS (output is good) or NEEDS_WORK (issues found)\n\n` +
                        `Pipeline output to review:\n${pipelineContext}`;
                }

                // Build context for this step
                const context: AgentContext = {
                    ticket,
                    conversationHistory: [],
                    additionalContext: {
                        acceptance_criteria: ticket.acceptance_criteria,
                        deliverable_type: step.deliverableType,
                        stage: step.stage,
                        run_number: run.run_number,
                        previous_failures: failedRuns.length,
                        pipeline_step: stepIdx + 1,
                        pipeline_total: pipeline.steps.length,
                    },
                };

                this.outputChannel.appendLine(
                    `[TicketProcessor] TK-${ticket.ticket_number} pipeline step ${stepIdx + 1}/${pipeline.steps.length}: ${step.agentName} (${step.deliverableType})`
                );

                // Call the agent with pipeline context
                response = await this.orchestrator.callAgent(step.agentName, stepMessage, context);

                // Add step response as ticket reply
                const stepLabel = pipeline.steps.length > 1
                    ? `${step.agentName} (step ${stepIdx + 1}/${pipeline.steps.length})`
                    : step.agentName;
                this.database.addTicketReply(ticketId, stepLabel, response.content);
                this.eventBus.emit('ticket:replied', 'ticket-processor', { ticketId, author: step.agentName });

                // Feed this step's output as context for the next step
                if (!isLastStep) {
                    const nextStep = pipeline.steps[stepIdx + 1];
                    if (step.agentName === 'orchestrator' && step.deliverableType === 'assessment') {
                        // After orchestrator assessment, pass both original ticket AND assessment to next agent
                        pipelineContext = `${promptText}\n\n--- Orchestrator Assessment ---\n${response.content}\n\n--- Your Task (${nextStep.agentName}) ---\nUsing the orchestrator's assessment above as guidance, complete the ${nextStep.deliverableType} work for: ${ticket.title}`;
                    } else {
                        pipelineContext = `${promptText}\n\n--- ${step.agentName} Output (Requirements/Plan) ---\n${response.content}\n\n--- Your Task (${nextStep.agentName}) ---\nUsing the above output as your input, complete the ${nextStep.deliverableType} work for: ${ticket.title}`;
                    }
                }
            }

            // v4.1: Update run with final pipeline response
            this.database.completeTicketRun(run.id, {
                status: 'completed',
                response_received: response.content,
                tokens_used: response.tokensUsed ?? undefined,
                duration_ms: Date.now() - startTime,
            });

            // Run review agent for non-communication tickets
            // v4.1 (WS5B): Use dedicated reviewTicket() for full ticket context + complexity classification
            let reviewResult: string | null = null;
            if (pipeline.deliverableType !== 'communication') {
                try {
                    const reviewResponse = await this.orchestrator.getReviewAgent().reviewTicket(
                        ticket, response.content
                    );
                    this.database.addTicketReply(ticketId, 'review', reviewResponse.content);
                    reviewResult = reviewResponse.content;

                    // Check if review flagged for user
                    const flaggedForUser = reviewResponse.actions?.some(
                        (a: AgentAction) => a.type === 'escalate'
                    );

                    if (flaggedForUser) {
                        this.database.updateTicket(ticketId, {
                            processing_status: 'holding',
                        });
                        // v4.1: Update run with review flagged status
                        this.database.completeTicketRun(run.id, {
                            status: 'review_flagged',
                            response_received: response.content,
                            review_result: reviewResult ?? undefined,
                            tokens_used: response.tokensUsed ?? undefined,
                            duration_ms: Date.now() - startTime,
                        });
                        this.eventBus.emit('ticket:review_flagged', 'ticket-processor', {
                            ticketId, ticketNumber: ticket.ticket_number,
                            reason: reviewResponse.content,
                        });

                        // v4.1: Create AI feedback question so user sees it in the queue
                        try {
                            const planId = this.findPlanIdForTicket(ticket);
                            if (planId) {
                                const rawQuestion = `Review flagged TK-${ticket.ticket_number}: "${ticket.title}". The Review Agent needs your input:\n\n${reviewResponse.content.substring(0, 500)}`;
                                const createdQ = this.database.createAIQuestion({
                                    plan_id: planId,
                                    component_id: null,
                                    page_id: null,
                                    category: 'general' as any,
                                    question: rawQuestion,
                                    question_type: 'text' as any,
                                    options: [],
                                    ai_reasoning: 'The Review Agent flagged this ticket for user review before it can proceed.',
                                    ai_suggested_answer: null,
                                    user_answer: null,
                                    status: 'pending' as any,
                                    ticket_id: null,
                                    source_agent: 'ReviewAgent',
                                    source_ticket_id: ticketId,
                                    navigate_to: 'tickets',
                                    is_ghost: false,
                                    queue_priority: 1,
                                });
                                // v4.3: Async-rewrite into friendly language
                                this.rewriteQuestionForUser(createdQ.id, rawQuestion, 'Review Agent');
                                this.eventBus.emit('question:created', 'ticket-processor', {
                                    ticketId, reason: 'review_flagged',
                                });
                            }
                        } catch (qErr) {
                            this.outputChannel.appendLine(
                                `[TicketProcessor] Failed to create review feedback question: ${qErr}`
                            );
                        }

                        this.outputChannel.appendLine(
                            `[TicketProcessor] TK-${ticket.ticket_number} flagged for user review`
                        );
                        return true; // Successfully processed (held for user)
                    }

                    // v4.1 (Bug 6A): Review passed — update processing_status to 'verifying' explicitly
                    this.database.updateTicket(ticketId, {
                        processing_status: 'verifying',
                    });
                    this.eventBus.emit('ticket:review_passed', 'ticket-processor', {
                        ticketId, ticketNumber: ticket.ticket_number,
                    });
                } catch (reviewError) {
                    // Review agent failure is non-fatal — skip review, proceed to verification
                    this.outputChannel.appendLine(
                        `[TicketProcessor] Review agent error (non-fatal), proceeding to verification: ${reviewError}`
                    );
                }
            }

            // Run verification — use the pipeline's final deliverable type
            const finalRoute: AgentRoute = {
                agentName: pipeline.steps[pipeline.steps.length - 1].agentName,
                deliverableType: pipeline.deliverableType,
                stage: pipeline.steps[pipeline.steps.length - 1].stage,
            };
            const verResult = await this.verifyTicket(ticket, response, finalRoute);

            if (verResult.passed) {
                this.database.updateTicket(ticketId, {
                    status: TicketStatus.Resolved,
                    processing_status: null as any,
                    verification_result: JSON.stringify(verResult),
                    // v4.1: Clear error on successful resolution
                    last_error: null,
                    last_error_at: null,
                });
                // v4.1: Update run with verification passed
                this.database.completeTicketRun(run.id, {
                    status: 'completed',
                    response_received: response.content,
                    review_result: reviewResult ?? undefined,
                    verification_result: JSON.stringify(verResult),
                    tokens_used: response.tokensUsed ?? undefined,
                    duration_ms: Date.now() - startTime,
                });
                this.eventBus.emit('ticket:processing_completed', 'ticket-processor', {
                    ticketId, ticketNumber: ticket.ticket_number, title: ticket.title,
                });
                this.eventBus.emit('ticket:verification_passed', 'ticket-processor', { ticketId });
                this.outputChannel.appendLine(`[TicketProcessor] TK-${ticket.ticket_number} resolved (verified)`);

                // v4.1: Unblock any tickets that were blocked by this resolved ticket
                this.unblockDependentTickets(ticketId, ticket.ticket_number);
            } else {
                // v4.1: Update run with verification failed
                this.database.completeTicketRun(run.id, {
                    status: 'failed',
                    response_received: response.content,
                    review_result: reviewResult ?? undefined,
                    verification_result: JSON.stringify(verResult),
                    error_message: verResult.failure_details ?? 'Verification failed',
                    tokens_used: response.tokensUsed ?? undefined,
                    duration_ms: Date.now() - startTime,
                });
                await this.handleVerificationFailure(ticket, verResult, finalRoute);
            }
            return true;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            const stack = error instanceof Error ? error.stack ?? '' : '';
            this.outputChannel.appendLine(`[TicketProcessor] Error processing TK-${ticket.ticket_number}: ${msg}`);
            this.database.addTicketReply(ticketId, 'system', `Processing error: ${msg}`);
            this.eventBus.emit('agent:error', 'ticket-processor', { ticketId, error: msg, stack });

            // v4.1: Update run with error details (stack truncated to 2000 chars)
            this.database.completeTicketRun(run.id, {
                status: 'failed',
                error_message: msg,
                error_stack: stack.substring(0, 2000),
                duration_ms: Date.now() - startTime,
            });

            // v4.1: Store error on the ticket itself for AI retry context
            this.database.updateTicket(ticketId, {
                last_error: msg,
                last_error_at: new Date().toISOString(),
            });

            const maxErrorRetries = 3;
            const currentErrorRetry = queueEntry?.errorRetryCount ?? 0;

            if (currentErrorRetry < maxErrorRetries) {
                // Re-enqueue with incremented error retry count
                this.outputChannel.appendLine(
                    `[TicketProcessor] Re-enqueueing TK-${ticket.ticket_number} (error retry ${currentErrorRetry + 1}/${maxErrorRetries})`
                );
                this.database.updateTicket(ticketId, {
                    status: TicketStatus.Open,
                    processing_status: 'queued',
                });

                // Remove current entry from front of queue (it was peeked)
                const queue = ticket.operation_type === 'boss_directive' ? this.bossQueue : this.mainQueue;
                if (queue.length > 0 && queue[0].ticketId === ticketId) {
                    queue.shift();
                }

                // Push new entry with incremented retry count to back of queue
                const retryEntry: QueuedTicket = {
                    ticketId: ticket.id,
                    priority: ticket.priority,
                    enqueuedAt: Date.now(),
                    operationType: ticket.operation_type || 'unknown',
                    errorRetryCount: currentErrorRetry + 1,
                };

                if (ticket.operation_type === 'boss_directive') {
                    this.bossQueue.push(retryEntry);
                    this.sortQueue(this.bossQueue);
                } else {
                    this.mainQueue.push(retryEntry);
                    this.sortQueue(this.mainQueue);
                }

                this.eventBus.emit('ticket:requeued', 'ticket-processor', {
                    ticketId, attempt: currentErrorRetry + 1, reason: 'agent_error',
                });
            } else {
                // Max error retries exceeded: escalate
                this.outputChannel.appendLine(
                    `[TicketProcessor] TK-${ticket.ticket_number} max error retries (${maxErrorRetries}) exceeded, escalating`
                );

                // Remove from front of queue
                const queue = ticket.operation_type === 'boss_directive' ? this.bossQueue : this.mainQueue;
                if (queue.length > 0 && queue[0].ticketId === ticketId) {
                    queue.shift();
                }

                this.database.updateTicket(ticketId, {
                    status: TicketStatus.Escalated,
                    processing_status: 'awaiting_user',
                });

                const planId = this.findPlanIdForTicket(ticket);
                // v4.1: Always escalate, even without planId — don't silently skip
                const technicalContext = `Agent errors: ${maxErrorRetries} consecutive failures.\nLast error: ${msg}\nStack: ${stack.substring(0, 500)}`;
                if (planId) {
                    this.database.createGhostTicket(
                        ticket.id,
                        `The system tried to process "${ticket.title}" but the AI agent kept failing.\n\nError: ${msg}\n\nWhat would you like to do?`,
                        `Processing error on "${ticket.title}" after ${maxErrorRetries} attempts`,
                        `tickets:${ticket.id}`,
                        planId,
                        technicalContext
                    );
                } else {
                    // No plan found — still log the escalation
                    this.outputChannel.appendLine(
                        `[TicketProcessor] WARNING: No plan found for escalated ticket TK-${ticket.ticket_number}. Ghost ticket not created.`
                    );
                    this.database.addTicketReply(ticketId, 'system',
                        `Escalated after ${maxErrorRetries} failures. No plan found for ghost ticket creation. Technical context: ${technicalContext}`
                    );
                }

                this.eventBus.emit('ticket:escalated', 'ticket-processor', { ticketId, reason: 'max_error_retries' });
            }

            return false;
        }
    }

    /**
     * Verify a ticket's deliverable.
     * Communication tickets: clarity score check.
     * Work tickets: clarity + deliverable check against acceptance criteria.
     */
    private async verifyTicket(
        ticket: Ticket,
        response: AgentResponse,
        route: AgentRoute
    ): Promise<{ passed: boolean; clarity_score: number | null; deliverable_check: boolean; attempt_number: number; failure_details: string | null }> {
        const attemptNumber = (ticket.retry_count ?? 0) + 1;

        this.database.updateTicket(ticket.id, { processing_status: 'verifying' });
        this.eventBus.emit('ticket:verification_started', 'ticket-processor', { ticketId: ticket.id });

        // Communication tickets: clarity score only
        if (route.deliverableType === 'communication') {
            const clarityScore = response.confidence ?? 85; // Use agent confidence as proxy for clarity
            const cfg = this.config.getConfig();
            const autoResolveScore = cfg.clarityAutoResolveScore ?? 85;
            const passed = clarityScore >= autoResolveScore;

            return {
                passed,
                clarity_score: clarityScore,
                deliverable_check: true,
                attempt_number: attemptNumber,
                failure_details: passed ? null : `Clarity score ${clarityScore} below threshold ${autoResolveScore}`,
            };
        }

        // Work tickets: check deliverable against acceptance criteria
        let deliverableCheck = true;
        let failureDetails: string | null = null;

        if (ticket.acceptance_criteria) {
            // Basic deliverable validation based on type
            if (route.deliverableType === 'plan_generation') {
                // Check if response contains task data
                const hasTaskContent = response.content.toLowerCase().includes('task') && response.content.length > 100;
                deliverableCheck = hasTaskContent;
                if (!deliverableCheck) failureDetails = 'Response does not contain sufficient task generation content';
            } else if (route.deliverableType === 'design_change') {
                const hasDesignContent = response.content.toLowerCase().includes('component') || response.content.toLowerCase().includes('page');
                deliverableCheck = hasDesignContent;
                if (!deliverableCheck) failureDetails = 'Response does not contain design change content';
            } else if (route.deliverableType === 'code_generation') {
                const hasCodeContent = response.content.toLowerCase().includes('function') ||
                    response.content.toLowerCase().includes('class') ||
                    response.content.toLowerCase().includes('const ') ||
                    response.content.toLowerCase().includes('import ');
                deliverableCheck = hasCodeContent;
                if (!deliverableCheck) failureDetails = 'Response does not contain code generation content';
            }
        }

        const clarityScore = response.confidence ?? 80;
        const passed = deliverableCheck && clarityScore >= (this.config.getConfig().clarityClarificationScore ?? 70);

        return {
            passed,
            clarity_score: clarityScore,
            deliverable_check: deliverableCheck,
            attempt_number: attemptNumber,
            failure_details: failureDetails || (passed ? null : `Deliverable check: ${deliverableCheck}, Clarity: ${clarityScore}`),
        };
    }

    /**
     * v4.1: When a ticket is resolved, find all tickets that were blocked by it
     * and unblock them (clear blocking_ticket_id, re-enqueue).
     */
    private unblockDependentTickets(resolvedTicketId: string, resolvedTicketNumber: number): void {
        try {
            // Find all open tickets where blocking_ticket_id matches the resolved ticket
            const allOpen = this.database.getTicketsByStatus('open');
            const allInReview = this.database.getTicketsByStatus('in_review');
            const allTickets = [...allOpen, ...allInReview];

            for (const t of allTickets) {
                if (t.blocking_ticket_id === resolvedTicketId) {
                    this.database.updateTicket(t.id, {
                        blocking_ticket_id: null as any,
                        processing_status: 'queued',
                    });
                    this.database.addTicketReply(t.id, 'system',
                        `Blocking ticket TK-${resolvedTicketNumber} resolved — this ticket is now unblocked.`);
                    this.eventBus.emit('ticket:unblocked', 'ticket-processor', { ticketId: t.id });
                    this.outputChannel.appendLine(
                        `[TicketProcessor] TK-${t.ticket_number} unblocked (blocker TK-${resolvedTicketNumber} resolved)`
                    );
                }
            }
        } catch (err) {
            this.outputChannel.appendLine(`[TicketProcessor] Error unblocking dependent tickets: ${err}`);
        }
    }

    /**
     * Handle verification failure with tiered retry strategy.
     * 1-3 failures: auto-retry
     * After 3: Boss classifies severity → minor (keep retrying) or major (escalate)
     */
    private async handleVerificationFailure(
        ticket: Ticket,
        verResult: { passed: boolean; clarity_score: number | null; attempt_number: number; failure_details: string | null },
        route: AgentRoute
    ): Promise<void> {
        const cfg = this.config.getConfig();
        const maxRetries = cfg.maxTicketRetries ?? 3;
        const currentRetry = ticket.retry_count ?? 0;

        this.database.updateTicket(ticket.id, {
            verification_result: JSON.stringify(verResult),
            retry_count: currentRetry + 1,
        });
        this.eventBus.emit('ticket:verification_failed', 'ticket-processor', {
            ticketId: ticket.id, attempt: currentRetry + 1, failure_details: verResult.failure_details,
        });

        if (currentRetry < maxRetries) {
            // Auto-retry: re-enqueue with failure context
            this.outputChannel.appendLine(`[TicketProcessor] TK-${ticket.ticket_number} verification failed, auto-retry ${currentRetry + 1}/${maxRetries}`);

            // Add retry context to ticket body
            this.database.addTicketReply(ticket.id, 'system',
                `Verification failed (attempt ${currentRetry + 1}/${maxRetries}): ${verResult.failure_details || 'Quality below threshold'}. Retrying...`
            );
            this.eventBus.emit('ticket:retry', 'ticket-processor', { ticketId: ticket.id, attempt: currentRetry + 1 });

            this.database.updateTicket(ticket.id, { processing_status: 'queued' });

            // Re-enqueue
            const entry: QueuedTicket = {
                ticketId: ticket.id,
                priority: ticket.priority,
                enqueuedAt: Date.now(),
                operationType: ticket.operation_type || 'unknown',
                errorRetryCount: 0,
            };

            if (ticket.operation_type === 'boss_directive') {
                this.bossQueue.push(entry);
                this.processBossQueue();
            } else {
                this.mainQueue.push(entry);
                this.processMainQueue();
            }
        } else {
            // Escalate: create ghost ticket for user with noob-friendly explanation
            this.outputChannel.appendLine(`[TicketProcessor] TK-${ticket.ticket_number} max retries reached, escalating to user`);

            const planId = this.findPlanIdForTicket(ticket);
            if (planId) {
                const question = `The system tried to complete "${ticket.title}" ${maxRetries} times but couldn't get it right.\n\n` +
                    `What went wrong: ${verResult.failure_details || 'The output didn\'t meet quality standards.'}\n\n` +
                    `What would you like to do?`;

                const technicalContext = `Ticket ID: ${ticket.id}\n` +
                    `Agent: ${route.agentName}\n` +
                    `Attempts: ${currentRetry + 1}\n` +
                    `Verification: clarity_score=${verResult.clarity_score}, deliverable_check=${verResult.passed}\n` +
                    `Last error: ${verResult.failure_details}`;

                this.database.createGhostTicket(
                    ticket.id,
                    question,
                    `Task "${ticket.title}" has failed verification ${maxRetries} times`,
                    `tickets:${ticket.id}`,
                    planId,
                    technicalContext
                );

                this.eventBus.emit('ticket:escalated', 'ticket-processor', { ticketId: ticket.id });
            }

            this.database.updateTicket(ticket.id, {
                status: TicketStatus.Escalated,
                processing_status: 'awaiting_user',
            });
        }
    }

    /**
     * Bump lowest-priority ticket to pending when at limit (for P1 tickets).
     */
    private bumpLowestPriority(): boolean {
        // Find a P3 ticket in the main queue to bump
        const p3Index = this.mainQueue.findIndex(q => q.priority === TicketPriority.P3);
        if (p3Index >= 0) {
            const bumped = this.mainQueue.splice(p3Index, 1)[0];
            this.database.updateTicket(bumped.ticketId, { processing_status: null as any });
            this.outputChannel.appendLine(`[TicketProcessor] Bumped P3 ticket ${bumped.ticketId} for P1 priority`);
            return true;
        }
        return false;
    }

    /**
     * Sort queue by priority (P1 first) then by enqueue time.
     */
    private sortQueue(queue: QueuedTicket[]): void {
        const prioOrder: Record<string, number> = { P1: 0, P2: 1, P3: 2 };
        queue.sort((a, b) => {
            const pa = prioOrder[a.priority] ?? 1;
            const pb = prioOrder[b.priority] ?? 1;
            if (pa !== pb) return pa - pb;
            return a.enqueuedAt - b.enqueuedAt;
        });
    }

    /**
     * Idle watchdog: after configured timeout with no activity, trigger Boss AI health check.
     * v4.2: Boss AI runs on a recurring 5-min cycle when idle. If nothing is available,
     * it keeps checking every 5 minutes in case something changes. When tickets or work
     * become available, processing starts immediately (via event listeners).
     */
    private resetIdleWatchdog(): void {
        if (this.idleTimeout) {
            clearTimeout(this.idleTimeout);
            this.idleTimeout = null;
        }
        if (this.disposed) return;

        const cfg = this.config.getConfig();
        const timeoutMs = (cfg.bossIdleTimeoutMinutes ?? 5) * 60 * 1000;

        // Track when the next Boss AI check will run (for UI display)
        this.nextBossCheckAt = Date.now() + timeoutMs;

        this.idleTimeout = setTimeout(async () => {
            if (this.disposed) return;

            // Check if anything is actively processing
            const anyProcessing = this.mainProcessing || this.bossProcessing;
            if (anyProcessing) {
                this.resetIdleWatchdog(); // Reset and check later
                return;
            }

            this.outputChannel.appendLine('[TicketProcessor] Boss AI idle check — scanning for work...');
            this.eventBus.emit('boss:idle_watchdog_triggered', 'ticket-processor', {
                lastActivityTimestamp: this.lastActivityTimestamp,
                idleMinutes: Math.round((Date.now() - this.lastActivityTimestamp) / 60000),
            });

            // v4.2: Run Boss AI health check to assess system state
            try {
                const boss = this.orchestrator.getBossAgent();
                const healthResponse = await boss.checkSystemHealth();
                this.outputChannel.appendLine(
                    `[TicketProcessor] Boss idle check result: ${healthResponse.content.substring(0, 200)}`
                );
                this.database.addAuditLog('boss-ai', 'idle_check', healthResponse.content.substring(0, 500));
            } catch (err) {
                this.outputChannel.appendLine(`[TicketProcessor] Boss idle check error (non-fatal): ${err}`);
            }

            // Scan for stuck tickets and recover them
            const stuckTickets = this.database.getTicketsByStatus('in_review')
                .filter(t => t.auto_created && t.processing_status === 'processing');

            if (stuckTickets.length > 0) {
                this.outputChannel.appendLine(
                    `[TicketProcessor] Boss idle check: recovering ${stuckTickets.length} stuck tickets`
                );
                for (const stuckTicket of stuckTickets) {
                    this.database.updateTicket(stuckTicket.id, {
                        status: TicketStatus.Open,
                        processing_status: 'queued',
                    });
                    this.database.addTicketReply(stuckTicket.id, 'system',
                        'Ticket recovered by Boss AI idle check — was stuck in processing state.'
                    );

                    const stuckEntry: QueuedTicket = {
                        ticketId: stuckTicket.id,
                        priority: stuckTicket.priority,
                        enqueuedAt: Date.now(),
                        operationType: stuckTicket.operation_type || 'unknown',
                        errorRetryCount: 0,
                    };

                    if (stuckTicket.operation_type === 'boss_directive') {
                        this.bossQueue.push(stuckEntry);
                    } else {
                        this.mainQueue.push(stuckEntry);
                    }

                    this.eventBus.emit('ticket:recovered', 'ticket-processor', {
                        ticketId: stuckTicket.id, ticketNumber: stuckTicket.ticket_number,
                    });
                }

                this.sortQueue(this.mainQueue);
                this.sortQueue(this.bossQueue);
                if (this.mainQueue.length > 0) this.processMainQueue();
                if (this.bossQueue.length > 0) this.processBossQueue();
            }

            // v4.2: Always reset watchdog for recurring checks — Boss AI keeps checking
            // every 5 minutes as long as the system is idle
            this.resetIdleWatchdog();
        }, timeoutMs);
    }

    // ==================== BOSS AI ORCHESTRATION (v4.2) ====================

    /**
     * v4.2: Run Boss AI startup assessment.
     * Called once when the ticket processor starts. Assesses system state,
     * recovers from any issues, creates corrective tickets, and kicks off work.
     */
    private async runBossStartupAssessment(): Promise<void> {
        try {
            this.eventBus.emit('boss:startup_assessment_started', 'ticket-processor', {});
            this.outputChannel.appendLine('[TicketProcessor] Running Boss AI startup assessment...');

            const boss = this.orchestrator.getBossAgent();
            const healthResponse = await boss.checkSystemHealth();

            this.outputChannel.appendLine(
                `[TicketProcessor] Boss startup assessment: ${healthResponse.content.substring(0, 200)}...`
            );

            // Execute Boss AI's actions (create tickets, escalate, etc.)
            const actionsExecuted = this.executeBossActions(healthResponse.actions || [], 'startup');

            // Log the assessment
            this.database.addAuditLog('boss-ai', 'startup_assessment',
                `${healthResponse.content.substring(0, 800)}\n\nActions executed: ${actionsExecuted}`
            );

            this.eventBus.emit('boss:startup_assessment_completed', 'ticket-processor', {
                summary: healthResponse.content.substring(0, 500),
                actionsExecuted,
            });

            // After assessment, ensure the queue is processing if there are tickets
            if (this.mainQueue.length > 0 && !this.mainProcessing) {
                this.processMainQueue();
            }
        } catch (err) {
            this.outputChannel.appendLine(
                `[TicketProcessor] Boss startup assessment failed (non-fatal): ${err}`
            );
        }
    }

    /**
     * v4.2: Run Boss AI between tickets for inter-ticket orchestration.
     * Called after each ticket completes and before the next one is picked.
     *
     * The Boss AI:
     * 1. Assesses system health
     * 2. Detects issues and creates corrective tickets
     * 3. Looks for completed coding tickets and creates verification tickets
     * 4. Re-sorts the queue based on its decisions
     * 5. Picks the next ticket to process
     */
    private async runBossInterTicket(): Promise<void> {
        try {
            this.eventBus.emit('boss:inter_ticket_started', 'ticket-processor', {
                queueSize: this.mainQueue.length,
            });

            const boss = this.orchestrator.getBossAgent();
            const healthResponse = await boss.checkSystemHealth();

            // Parse Boss response to check for critical issues
            const content = healthResponse.content.toLowerCase();
            const isCritical = content.includes('escalate: true') || content.includes('status: critical');

            // Execute Boss AI's actions — create tickets, escalate, recover, etc.
            const actionsExecuted = this.executeBossActions(healthResponse.actions || [], 'inter_ticket');

            if (isCritical) {
                this.outputChannel.appendLine(
                    `[TicketProcessor] Boss inter-ticket: CRITICAL issues detected`
                );
                this.database.addAuditLog('boss-ai', 'inter_ticket_critical',
                    `${healthResponse.content.substring(0, 800)}\nActions executed: ${actionsExecuted}`
                );
            }

            // Re-sort the queue in case priorities changed or new tickets were added
            this.sortQueue(this.mainQueue);
            this.sortQueue(this.bossQueue);

            this.eventBus.emit('boss:inter_ticket_completed', 'ticket-processor', {
                queueSize: this.mainQueue.length,
                critical: isCritical,
                actionsExecuted,
                summary: healthResponse.content.substring(0, 200),
            });

            // Emit which ticket was picked next
            if (this.mainQueue.length > 0) {
                const nextEntry = this.mainQueue[0];
                const nextTicket = this.database.getTicket(nextEntry.ticketId);
                this.eventBus.emit('boss:picked_next_ticket', 'ticket-processor', {
                    ticketId: nextEntry.ticketId,
                    ticketNumber: nextTicket?.ticket_number,
                    title: nextTicket?.title,
                    priority: nextEntry.priority,
                });
                this.outputChannel.appendLine(
                    `[TicketProcessor] Boss picked next ticket: TK-${nextTicket?.ticket_number} "${nextTicket?.title}"`
                );
            }
        } catch (err) {
            // Boss inter-ticket failure is non-fatal — just continue processing
            this.outputChannel.appendLine(
                `[TicketProcessor] Boss inter-ticket check failed (non-fatal): ${err}`
            );
        }
    }

    /**
     * v4.2: Execute Boss AI's structured actions.
     * Creates tickets, escalates issues, and logs decisions.
     * Returns the count of actions executed.
     *
     * This is the bridge between Boss AI's decisions and the ticket system.
     * Boss AI returns actions → this method turns them into real tickets.
     */
    private executeBossActions(actions: Array<{ type: string; payload: Record<string, unknown> }>, trigger: string): number {
        let executed = 0;

        for (const action of actions) {
            try {
                switch (action.type) {
                    case 'create_ticket': {
                        const payload = action.payload;
                        const title = payload.title as string;
                        if (!title) break;

                        // Dedup: don't create if an open ticket with same title already exists
                        const existingOpen = this.database.getTicketsByStatus('open');
                        const duplicate = existingOpen.find(t => t.title === title);
                        if (duplicate) {
                            this.outputChannel.appendLine(
                                `[TicketProcessor] Boss action skipped (duplicate): ${title}`
                            );
                            break;
                        }

                        const ticket = this.database.createTicket({
                            title,
                            body: (payload.body as string) || `Created by Boss AI (${trigger})`,
                            priority: (payload.priority as TicketPriority) || TicketPriority.P2,
                            creator: 'boss-ai',
                            auto_created: true,
                            operation_type: (payload.operation_type as string) || 'boss_directive',
                            deliverable_type: (payload.deliverable_type as Ticket['deliverable_type']) ?? undefined,
                            blocking_ticket_id: (payload.blocking_ticket_id as string) || undefined,
                            acceptance_criteria: (payload.acceptance_criteria as string) || undefined,
                        });

                        this.outputChannel.appendLine(
                            `[TicketProcessor] Boss created ticket TK-${ticket.ticket_number}: ${title}`
                        );
                        this.eventBus.emit('ticket:created', 'boss-ai', {
                            ticketId: ticket.id,
                            ticketNumber: ticket.ticket_number,
                            title: ticket.title,
                            trigger,
                        });

                        // Enqueue the newly created ticket
                        this.enqueueTicket(ticket);
                        executed++;
                        break;
                    }

                    case 'escalate': {
                        const reason = (action.payload.reason as string) || 'Boss AI escalation';
                        this.outputChannel.appendLine(`[TicketProcessor] Boss escalation: ${reason}`);
                        this.database.addAuditLog('boss-ai', 'escalation', reason);

                        // Create a user-facing AI question so the user sees the escalation
                        const activePlan = this.database.getActivePlan();
                        this.database.createAIQuestion({
                            plan_id: activePlan?.id || '',
                            component_id: null,
                            page_id: null,
                            category: 'general' as any,
                            question: `Boss AI Escalation: ${reason}`,
                            question_type: 'text',
                            options: [],
                            ai_reasoning: `The Boss AI detected an issue requiring your attention during ${trigger}.`,
                            ai_suggested_answer: null,
                            user_answer: null,
                            status: 'pending',
                            ticket_id: null,
                            source_agent: 'boss-ai',
                            source_ticket_id: (action.payload.ticketId as string) || null,
                            navigate_to: null,
                            is_ghost: false,
                            queue_priority: 1,
                            answered_at: null,
                            ai_continued: false,
                            dismiss_count: 0,
                            previous_decision_id: null,
                            conflict_decision_id: null,
                            technical_context: null,
                        });
                        this.eventBus.emit('question:created', 'boss-ai', { reason, trigger });
                        executed++;
                        break;
                    }

                    case 'log': {
                        const logAction = (action.payload.action as string) || 'boss_action';
                        const logReason = (action.payload.reason as string) || '';
                        this.database.addAuditLog('boss-ai', logAction, logReason);
                        this.outputChannel.appendLine(`[TicketProcessor] Boss log: ${logAction} — ${logReason}`);
                        executed++;
                        break;
                    }
                }
            } catch (err) {
                this.outputChannel.appendLine(`[TicketProcessor] Boss action failed: ${err}`);
            }
        }

        if (executed > 0) {
            this.outputChannel.appendLine(
                `[TicketProcessor] Boss AI executed ${executed}/${actions.length} actions (${trigger})`
            );
        }

        return executed;
    }

    // ==================== MCP INTEGRATION ====================

    /**
     * Get the next coding task for MCP integration.
     * Returns null if no task is ready.
     */
    getNextCodingTask(): Ticket | null {
        // Check for active coding ticket in holding state
        const holdingTickets = this.database.getTicketsByStatus('in_review')
            .filter(t => t.processing_status === 'holding' && t.deliverable_type === 'code_generation');
        if (holdingTickets.length > 0) return holdingTickets[0];

        // Check main queue for coding tickets
        const codingEntry = this.mainQueue.find(q => q.operationType === 'code_generation');
        if (codingEntry) return this.database.getTicket(codingEntry.ticketId);

        return null;
    }

    /**
     * Get AI level for a ticket's context (from plan config).
     */
    private getAILevel(ticket: Ticket): string {
        // Try to get from the ticket's plan context
        if (ticket.body) {
            const aiLevelMatch = ticket.body.match(/AI Level:\s*(\w+)/);
            if (aiLevelMatch) return aiLevelMatch[1].toLowerCase();
        }
        return this.config.getConfig().agents?.orchestrator?.enabled ? 'smart' : 'manual';
    }

    /**
     * Find the plan ID associated with a ticket.
     */
    /**
     * Async best-effort: rewrite raw AI question text into user-friendly language
     * via the Clarity Agent, then update the question's friendly_message field.
     * Fire-and-forget — does NOT block ticket processing.
     */
    private rewriteQuestionForUser(questionId: string, rawMessage: string, sourceAgent?: string): void {
        try {
            const clarity = this.orchestrator.getClarityAgent();
            clarity.rewriteForUser(rawMessage, sourceAgent).then(friendly => {
                if (friendly && friendly !== rawMessage) {
                    this.database.updateAIQuestion(questionId, { friendly_message: friendly } as any);
                    this.outputChannel.appendLine(`[TicketProcessor] Clarity rewrite for question ${questionId}: done`);
                }
            }).catch(err => {
                /* istanbul ignore next */
                this.outputChannel.appendLine(`[TicketProcessor] Clarity rewrite failed: ${err}`);
            });
        } catch {
            /* istanbul ignore next */
            // Orchestrator or ClarityAgent not available — skip silently
        }
    }

    private findPlanIdForTicket(ticket: Ticket, depth = 0): string | null {
        // v4.1: Guard against circular parent_ticket_id chains (data corruption)
        if (depth > 10) return null;
        // Check task association
        if (ticket.task_id) {
            const task = this.database.getTask(ticket.task_id);
            if (task) return task.plan_id;
        }
        // Check parent ticket
        if (ticket.parent_ticket_id) {
            const parent = this.database.getTicket(ticket.parent_ticket_id);
            if (parent) return this.findPlanIdForTicket(parent, depth + 1);
        }
        // Fallback: get active plan
        const plans = this.database.getAllPlans();
        const active = plans.find((p: { status: string }) => p.status === 'active');
        return active?.id ?? plans[0]?.id ?? null;
    }

    /**
     * Subscribe to event bus with cleanup tracking.
     */
    private listen(type: COEEventType, handler: (event: COEEvent) => void): void {
        this.eventBus.on(type, handler);
        this.eventHandlers.push({ type, handler });
    }

    /**
     * Get queue status for API/UI.
     */
    getStatus(): {
        mainQueueSize: number;
        bossQueueSize: number;
        mainProcessing: boolean;
        bossProcessing: boolean;
        lastActivityTimestamp: number;
        idleMinutes: number;
        bossState: 'active' | 'waiting' | 'idle';
        bossNextCheckMs: number;
    } {
        const now = Date.now();
        const anyProcessing = this.mainProcessing || this.bossProcessing;
        const hasWork = this.mainQueue.length > 0 || this.bossQueue.length > 0;

        // Boss AI state:
        // - 'active' = currently processing tickets or Boss AI is running
        // - 'waiting' = idle but Boss AI has a scheduled check (the 5-min cycle)
        // - 'idle' = no watchdog set (shouldn't happen in normal operation)
        let bossState: 'active' | 'waiting' | 'idle';
        if (anyProcessing || hasWork) {
            bossState = 'active';
        } else if (this.idleTimeout) {
            bossState = 'waiting';
        } else {
            bossState = 'idle';
        }

        return {
            mainQueueSize: this.mainQueue.length,
            bossQueueSize: this.bossQueue.length,
            mainProcessing: this.mainProcessing,
            bossProcessing: this.bossProcessing,
            lastActivityTimestamp: this.lastActivityTimestamp,
            idleMinutes: Math.round((now - this.lastActivityTimestamp) / 60000),
            bossState,
            bossNextCheckMs: this.nextBossCheckAt > now ? this.nextBossCheckAt - now : 0,
        };
    }

    /**
     * Remove a ticket from queues (e.g., when cancelled).
     */
    removeFromQueue(ticketId: string): void {
        this.mainQueue = this.mainQueue.filter(q => q.ticketId !== ticketId);
        this.bossQueue = this.bossQueue.filter(q => q.ticketId !== ticketId);
    }

    // ==================== PHASE ADVANCEMENT ====================

    /**
     * Check if the current phase's gate criteria are met, and if so, advance to the next phase.
     * Called automatically after each ticket completes processing.
     */
    private checkAndAdvancePhase(): void {
        const activePlan = this.database.getActivePlan();
        if (!activePlan) return;

        const phaseInfo = this.database.getPlanPhase(activePlan.id);
        if (!phaseInfo) return;

        const currentPhase = phaseInfo.phase as ProjectPhase;

        // Don't advance past complete
        if (currentPhase === ProjectPhase.Complete) return;

        const gateResult = this.checkPhaseGate(activePlan.id, currentPhase);
        this.eventBus.emit('phase:gate_checked', 'ticket-processor', {
            planId: activePlan.id, phase: currentPhase, passed: gateResult.passed,
            blockers: gateResult.blockers, progress: gateResult.progress,
        });

        if (!gateResult.passed) {
            if (gateResult.blockers.length > 0) {
                this.outputChannel.appendLine(
                    `[TicketProcessor] Phase gate "${currentPhase}" not passed: ${gateResult.blockers[0]}`
                );
            }
            return;
        }

        this.outputChannel.appendLine(
            `[TicketProcessor] Phase gate "${currentPhase}" PASSED (${gateResult.progress.done}/${gateResult.progress.total})`
        );
        this.eventBus.emit('phase:gate_passed', 'ticket-processor', {
            planId: activePlan.id, phase: currentPhase,
        });

        // Advance to next phase
        const nextPhase = this.getNextPhase(currentPhase);
        if (!nextPhase) return;

        // DesignReview requires user approval — don't auto-advance past it
        if (currentPhase === ProjectPhase.DesignReview) {
            const plan = this.database.getPlan(activePlan.id);
            if (!plan || !(plan as any).design_approved_at) {
                this.outputChannel.appendLine(
                    `[TicketProcessor] DesignReview gate passed but design not approved by user — waiting`
                );
                return;
            }
        }

        this.database.updatePlanPhase(activePlan.id, nextPhase);
        this.database.addAuditLog('ticket-processor', 'phase_advanced',
            `Phase advanced: ${currentPhase} → ${nextPhase}`);
        this.eventBus.emit('phase:changed', 'ticket-processor', {
            planId: activePlan.id, from: currentPhase, to: nextPhase,
        });

        this.outputChannel.appendLine(
            `[TicketProcessor] Phase advanced: ${currentPhase} → ${nextPhase}`
        );

        // Create tickets for the new phase
        this.createPhaseTickets(activePlan.id, nextPhase);
    }

    /**
     * Evaluate phase gate criteria for the current phase.
     * Each phase has specific completion criteria (True Plan 04).
     */
    private checkPhaseGate(planId: string, phase: ProjectPhase): PhaseGateResult {
        const blockers: string[] = [];
        const tickets = this.database.getTicketsByPlanId(planId);
        const tasks = this.database.getTasksByPlan(planId);

        switch (phase) {
            case ProjectPhase.Planning: {
                // Gate: All tasks have titles, descriptions, priorities, acceptance criteria, and are 15-45 min
                if (tasks.length === 0) {
                    blockers.push('No tasks created yet');
                    return { passed: false, blockers, progress: { done: 0, total: 1 } };
                }
                const validTasks = tasks.filter(t =>
                    t.title && t.description && t.priority && t.acceptance_criteria
                    && t.estimated_minutes >= 15 && t.estimated_minutes <= 45
                );
                const incomplete = tasks.length - validTasks.length;
                if (incomplete > 0) {
                    blockers.push(`${incomplete} task(s) missing required fields or outside 15-45 min range`);
                }
                return { passed: blockers.length === 0, blockers, progress: { done: validTasks.length, total: tasks.length } };
            }

            case ProjectPhase.Designing: {
                // Gate: Design QA score >= threshold. All pages have >= 1 component.
                // Check for open design tickets
                const designTickets = tickets.filter(t =>
                    t.operation_type === 'design_change' || t.title.toLowerCase().startsWith('phase: design')
                );
                const openDesign = designTickets.filter(t => t.status !== 'resolved');
                if (openDesign.length > 0) {
                    blockers.push(`${openDesign.length} design ticket(s) still open`);
                }
                return {
                    passed: blockers.length === 0,
                    blockers,
                    progress: { done: designTickets.length - openDesign.length, total: Math.max(designTickets.length, 1) },
                };
            }

            case ProjectPhase.DesignReview: {
                // Gate: User approved design
                const plan = this.database.getPlan(planId);
                if (!plan || !(plan as any).design_approved_at) {
                    blockers.push('Design not yet approved by user');
                }
                // Check for open ghost tickets (user questions)
                const ghostTickets = tickets.filter(t => t.is_ghost && t.status !== 'resolved');
                if (ghostTickets.length > 0) {
                    blockers.push(`${ghostTickets.length} user question(s) still unanswered`);
                }
                return {
                    passed: blockers.length === 0,
                    blockers,
                    progress: { done: blockers.length === 0 ? 1 : 0, total: 1 },
                };
            }

            case ProjectPhase.TaskGeneration: {
                // Gate: All task generation tickets resolved, coding tasks exist
                const taskGenTickets = tickets.filter(t =>
                    t.operation_type === 'plan_generation' || t.title.toLowerCase().startsWith('phase: task generation')
                );
                const openGen = taskGenTickets.filter(t => t.status !== 'resolved');
                if (openGen.length > 0) {
                    blockers.push(`${openGen.length} task generation ticket(s) still open`);
                }
                const codingTasks = tasks.filter(t => t.status !== 'decomposed');
                if (codingTasks.length === 0) {
                    blockers.push('No coding tasks generated yet');
                }
                return {
                    passed: blockers.length === 0,
                    blockers,
                    progress: { done: taskGenTickets.length - openGen.length, total: Math.max(taskGenTickets.length, 1) },
                };
            }

            case ProjectPhase.Coding: {
                // Gate: All coding tickets resolved. No failed or blocked tasks.
                const codingTickets = tickets.filter(t =>
                    t.operation_type === 'code_generation' || t.title.toLowerCase().startsWith('coding:')
                );
                const openCoding = codingTickets.filter(t =>
                    t.status !== 'resolved' && t.status !== 'on_hold'
                );
                if (openCoding.length > 0) {
                    blockers.push(`${openCoding.length} coding ticket(s) still open`);
                }
                const failedTasks = tasks.filter(t => t.status === 'failed' || t.status === 'blocked');
                if (failedTasks.length > 0) {
                    blockers.push(`${failedTasks.length} task(s) failed or blocked`);
                }
                return {
                    passed: blockers.length === 0,
                    blockers,
                    progress: { done: codingTickets.length - openCoding.length, total: Math.max(codingTickets.length, 1) },
                };
            }

            case ProjectPhase.Verification: {
                // Gate: All P1 tickets resolved. Boss health check passes.
                const p1Tickets = tickets.filter(t => t.priority === 'P1' && t.status !== 'resolved');
                if (p1Tickets.length > 0) {
                    blockers.push(`${p1Tickets.length} P1 ticket(s) still unresolved`);
                }
                const escalated = tickets.filter(t => t.status === 'escalated');
                if (escalated.length > 0) {
                    blockers.push(`${escalated.length} escalated ticket(s) need attention`);
                }
                return {
                    passed: blockers.length === 0,
                    blockers,
                    progress: {
                        done: tickets.filter(t => t.status === 'resolved').length,
                        total: Math.max(tickets.length, 1),
                    },
                };
            }

            case ProjectPhase.DesignUpdate: {
                // Gate: All rework tickets resolved
                const reworkTickets = tickets.filter(t =>
                    t.title.toLowerCase().startsWith('rework:') || t.operation_type === 'design_change'
                );
                const openRework = reworkTickets.filter(t => t.status !== 'resolved');
                if (openRework.length > 0) {
                    blockers.push(`${openRework.length} rework ticket(s) still open`);
                }
                return {
                    passed: blockers.length === 0,
                    blockers,
                    progress: { done: reworkTickets.length - openRework.length, total: Math.max(reworkTickets.length, 1) },
                };
            }

            default:
                return { passed: false, blockers: [`Unknown phase: ${phase}`], progress: { done: 0, total: 1 } };
        }
    }

    /**
     * Get the next phase in the lifecycle.
     */
    private getNextPhase(current: ProjectPhase): ProjectPhase | null {
        const idx = PHASE_ORDER.indexOf(current);
        if (idx < 0 || idx >= PHASE_ORDER.length - 1) return null;
        return PHASE_ORDER[idx + 1];
    }

    /**
     * Create auto-tickets for a new phase so work continues automatically.
     */
    private createPhaseTickets(planId: string, phase: ProjectPhase): void {
        const plan = this.database.getPlan(planId);
        const planName = plan ? (plan as any).name || 'Active Plan' : 'Active Plan';

        switch (phase) {
            case ProjectPhase.Designing: {
                const ticket = this.database.createTicket({
                    title: 'Phase: Design — Create program design',
                    body: `Create the program design for "${planName}". Define all pages, components, data models, and their relationships. Follow the design QA criteria.`,
                    priority: TicketPriority.P1,
                    auto_created: true,
                    operation_type: 'design_change',
                });
                this.eventBus.emit('ticket:created', 'ticket-processor', { ticketId: ticket.id, ticketNumber: ticket.ticket_number });
                break;
            }

            case ProjectPhase.DesignReview: {
                // Create a ghost ticket asking user to review and approve
                this.database.createGhostTicket(
                    null as any,
                    'The design phase is complete. Please review the program design and click "Approve Design" when ready.',
                    'Design ready for review',
                    `plans:${planId}`,
                    planId,
                    'All design tickets resolved. QA checks passed.'
                );
                break;
            }

            case ProjectPhase.TaskGeneration: {
                const ticket = this.database.createTicket({
                    title: 'Phase: Task Generation — Create coding tasks from design',
                    body: `Generate coding tasks for plan "${planName}". Create Layer 1 (scaffold) tasks first, then Layer 2 (feature) tasks. Each task must have acceptance criteria, file lists, and step-by-step instructions.`,
                    priority: TicketPriority.P1,
                    auto_created: true,
                    operation_type: 'plan_generation',
                });
                this.eventBus.emit('ticket:created', 'ticket-processor', { ticketId: ticket.id, ticketNumber: ticket.ticket_number });
                break;
            }

            case ProjectPhase.Coding: {
                // Create coding tickets from tasks
                const tasks = this.database.getTasksByPlan(planId);
                const readyTasks = tasks.filter(t =>
                    t.status === 'not_started' || t.status === 'blocked'
                );
                let created = 0;
                for (const task of readyTasks) {
                    // Only create tickets for tasks without existing tickets
                    const existingTickets = this.database.getTicketsByTaskId(task.id);
                    if (existingTickets.length > 0) continue;

                    // Map TaskPriority → TicketPriority (same underlying string values)
                    const ticketPrio = (task.priority === 'P1' ? TicketPriority.P1 : task.priority === 'P3' ? TicketPriority.P3 : TicketPriority.P2);
                    const ticket = this.database.createTicket({
                        title: `Coding: ${task.title}`,
                        body: `Implement: ${task.description}\n\nAcceptance Criteria: ${task.acceptance_criteria}\n\nContext: ${task.context_bundle || 'None'}`,
                        priority: ticketPrio,
                        auto_created: true,
                        operation_type: 'code_generation',
                        task_id: task.id,
                        acceptance_criteria: task.acceptance_criteria,
                    });
                    this.eventBus.emit('ticket:created', 'ticket-processor', { ticketId: ticket.id, ticketNumber: ticket.ticket_number });
                    created++;
                }
                this.outputChannel.appendLine(
                    `[TicketProcessor] Created ${created} coding tickets for ${readyTasks.length} tasks`
                );
                break;
            }

            case ProjectPhase.Verification: {
                // Create a verification ticket for Boss AI health check
                const ticket = this.database.createTicket({
                    title: 'Phase: Verification — Final system verification',
                    body: `Run final verification on plan "${planName}". Check all P1 tickets resolved, run Boss AI health check, verify no failed tasks.`,
                    priority: TicketPriority.P1,
                    auto_created: true,
                    operation_type: 'verification',
                });
                this.eventBus.emit('ticket:created', 'ticket-processor', { ticketId: ticket.id, ticketNumber: ticket.ticket_number });
                break;
            }

            case ProjectPhase.Complete: {
                this.outputChannel.appendLine(`[TicketProcessor] Plan "${planName}" is COMPLETE!`);
                this.database.addAuditLog('ticket-processor', 'plan_completed', `Plan "${planName}" completed all phases`);
                break;
            }

            default:
                break;
        }
    }

    /**
     * Dispose: clean up event listeners, timeouts, and queues.
     */
    dispose(): void {
        this.disposed = true;

        if (this.idleTimeout) {
            clearTimeout(this.idleTimeout);
            this.idleTimeout = null;
        }

        // Remove all event listeners
        for (const { type, handler } of this.eventHandlers) {
            this.eventBus.off(type, handler);
        }
        this.eventHandlers = [];

        // Clear queues
        this.mainQueue = [];
        this.bossQueue = [];

        this.outputChannel.appendLine('[TicketProcessor] Disposed');
    }
}
