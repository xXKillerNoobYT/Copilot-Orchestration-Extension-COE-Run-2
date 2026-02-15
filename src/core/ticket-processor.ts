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
import { Ticket, TicketStatus, TicketPriority, AgentContext, AgentResponse } from '../types';

// ==================== INTERFACES ====================

export interface OutputChannelLike {
    appendLine(msg: string): void;
}

export interface OrchestratorLike {
    callAgent(agentName: string, message: string, context: AgentContext): Promise<AgentResponse>;
}

interface QueuedTicket {
    ticketId: string;
    priority: string;
    enqueuedAt: number;
    operationType: string;
}

/** Maps operation_type + title patterns → agent routing */
interface AgentRoute {
    agentName: string;
    deliverableType: string;
    stage: number;
}

// ==================== AGENT ROUTING MAP ====================

function routeTicketToAgent(ticket: Ticket): AgentRoute | null {
    const op = ticket.operation_type || '';
    const title = ticket.title.toLowerCase();

    // Skip user-created tickets (manual)
    if (op === 'user_created') return null;

    // Boss directives go to boss queue, routing determined by Boss AI
    if (op === 'boss_directive') return { agentName: 'boss', deliverableType: 'communication', stage: 1 };

    // Phase-specific routing
    if (title.startsWith('phase: task generation') || op === 'plan_generation') {
        return { agentName: 'planning', deliverableType: 'plan_generation', stage: 1 };
    }
    if (title.startsWith('phase: design') || title.startsWith('phase: data model') || op === 'design_change') {
        return { agentName: 'planning', deliverableType: 'design_change', stage: 1 };
    }
    if (title.startsWith('phase: configuration')) {
        return null; // Skip — already complete
    }

    // Coding tickets
    if (title.startsWith('coding:') || title.startsWith('rework:') || op === 'code_generation') {
        return { agentName: 'coding', deliverableType: 'code_generation', stage: 2 };
    }

    // Verification tickets
    if (title.startsWith('verify:') || op === 'verification') {
        return { agentName: 'verification', deliverableType: 'verification', stage: 3 };
    }

    // Ghost tickets route to communication
    if (ticket.is_ghost || op === 'ghost_ticket') {
        return { agentName: 'clarity', deliverableType: 'communication', stage: 1 };
    }

    // Default: planning agent for unmatched tickets
    return { agentName: 'planning', deliverableType: 'communication', stage: 1 };
}

// ==================== TICKET PROCESSOR SERVICE ====================

export class TicketProcessorService {
    private mainQueue: QueuedTicket[] = [];
    private bossQueue: QueuedTicket[] = [];
    private mainProcessing = false;
    private bossProcessing = false;
    private idleTimeout: ReturnType<typeof setTimeout> | null = null;
    private lastActivityTimestamp = Date.now();
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

        this.outputChannel.appendLine('[TicketProcessor] Ready — listening for ticket events');
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
     * Process the main queue (serial).
     */
    private async processMainQueue(): Promise<void> {
        if (this.mainProcessing || this.mainQueue.length === 0 || this.disposed) return;
        this.mainProcessing = true;

        while (this.mainQueue.length > 0 && !this.disposed) {
            const entry = this.mainQueue.shift()!;
            await this.processTicket(entry.ticketId);
        }

        this.mainProcessing = false;
    }

    /**
     * Process the boss queue (serial, independent from main).
     */
    private async processBossQueue(): Promise<void> {
        if (this.bossProcessing || this.bossQueue.length === 0 || this.disposed) return;
        this.bossProcessing = true;

        while (this.bossQueue.length > 0 && !this.disposed) {
            const entry = this.bossQueue.shift()!;
            await this.processTicket(entry.ticketId);
        }

        this.bossProcessing = false;
    }

    /**
     * Process a single ticket through the agent pipeline.
     */
    private async processTicket(ticketId: string): Promise<void> {
        const ticket = this.database.getTicket(ticketId);
        if (!ticket) return;

        // Skip if already resolved or on_hold (cancelled)
        if (ticket.status === TicketStatus.Resolved || ticket.status === 'on_hold' as TicketStatus) {
            return;
        }

        const route = routeTicketToAgent(ticket);
        if (!route) {
            this.outputChannel.appendLine(`[TicketProcessor] No agent route for ticket TK-${ticket.ticket_number}, skipping`);
            return;
        }

        // Update ticket status
        this.database.updateTicket(ticketId, {
            status: 'in_review' as TicketStatus,
            processing_agent: route.agentName,
            processing_status: 'processing',
            deliverable_type: route.deliverableType as any,
            stage: route.stage,
        });
        this.eventBus.emit('ticket:processing_started', 'ticket-processor', {
            ticketId, ticketNumber: ticket.ticket_number,
            processing_agent: route.agentName, processing_status: 'processing',
        });
        this.outputChannel.appendLine(`[TicketProcessor] Processing TK-${ticket.ticket_number} via ${route.agentName}`);

        try {
            // Build context for agent
            const context: AgentContext = {
                ticket,
                conversationHistory: [],
                additionalContext: {
                    acceptance_criteria: ticket.acceptance_criteria,
                    deliverable_type: route.deliverableType,
                    stage: route.stage,
                },
            };

            // Call the agent
            const response = await this.orchestrator.callAgent(route.agentName, ticket.body || ticket.title, context);

            // Add agent response as ticket reply
            this.database.addTicketReply(ticketId, route.agentName, response.content);
            this.eventBus.emit('ticket:replied', 'ticket-processor', { ticketId, author: route.agentName });

            // Run verification
            const verResult = await this.verifyTicket(ticket, response, route);

            if (verResult.passed) {
                this.database.updateTicket(ticketId, {
                    status: TicketStatus.Resolved,
                    processing_status: null as any,
                    verification_result: JSON.stringify(verResult),
                });
                this.eventBus.emit('ticket:processing_completed', 'ticket-processor', { ticketId, ticketNumber: ticket.ticket_number });
                this.eventBus.emit('ticket:verification_passed', 'ticket-processor', { ticketId });
                this.outputChannel.appendLine(`[TicketProcessor] TK-${ticket.ticket_number} resolved (verified)`);
            } else {
                await this.handleVerificationFailure(ticket, verResult, route);
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`[TicketProcessor] Error processing TK-${ticket.ticket_number}: ${msg}`);
            this.database.addTicketReply(ticketId, 'system', `Processing error: ${msg}`);
            this.database.updateTicket(ticketId, { processing_status: null as any });
            this.eventBus.emit('agent:error', 'ticket-processor', { ticketId, error: msg });
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
     */
    private resetIdleWatchdog(): void {
        if (this.idleTimeout) {
            clearTimeout(this.idleTimeout);
            this.idleTimeout = null;
        }
        if (this.disposed) return;

        const cfg = this.config.getConfig();
        const timeoutMs = (cfg.bossIdleTimeoutMinutes ?? 5) * 60 * 1000;

        this.idleTimeout = setTimeout(() => {
            if (this.disposed) return;

            // Check if anything is actively processing
            const anyProcessing = this.mainProcessing || this.bossProcessing;
            if (anyProcessing) {
                this.resetIdleWatchdog(); // Reset and check later
                return;
            }

            this.outputChannel.appendLine('[TicketProcessor] Idle watchdog triggered — no activity detected');
            this.eventBus.emit('boss:idle_watchdog_triggered', 'ticket-processor', {
                lastActivityTimestamp: this.lastActivityTimestamp,
                idleMinutes: Math.round((Date.now() - this.lastActivityTimestamp) / 60000),
            });

            // Reset watchdog for next check
            this.resetIdleWatchdog();
        }, timeoutMs);
    }

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
    private findPlanIdForTicket(ticket: Ticket): string | null {
        // Check task association
        if (ticket.task_id) {
            const task = this.database.getTask(ticket.task_id);
            if (task) return task.plan_id;
        }
        // Check parent ticket
        if (ticket.parent_ticket_id) {
            const parent = this.database.getTicket(ticket.parent_ticket_id);
            if (parent) return this.findPlanIdForTicket(parent);
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
    } {
        return {
            mainQueueSize: this.mainQueue.length,
            bossQueueSize: this.bossQueue.length,
            mainProcessing: this.mainProcessing,
            bossProcessing: this.bossProcessing,
            lastActivityTimestamp: this.lastActivityTimestamp,
            idleMinutes: Math.round((Date.now() - this.lastActivityTimestamp) / 60000),
        };
    }

    /**
     * Remove a ticket from queues (e.g., when cancelled).
     */
    removeFromQueue(ticketId: string): void {
        this.mainQueue = this.mainQueue.filter(q => q.ticketId !== ticketId);
        this.bossQueue = this.bossQueue.filter(q => q.ticketId !== ticketId);
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
