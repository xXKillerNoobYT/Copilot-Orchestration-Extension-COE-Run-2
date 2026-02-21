/**
 * TicketProcessorService — Auto-processing engine for tickets
 *
 * v7.0: 4 team queues with Boss AI round-robin slot balancing:
 *   1. Orchestrator queue — catch-all for unclassified work
 *   2. Planning queue — planning, design, research coordination
 *   3. Verification queue — testing, review, QA
 *   4. Coding Director queue — interface to external coding agent
 *
 * Boss AI controls slot allocation per team and uses soft-preference
 * round-robin to balance processing across teams.
 *
 * Handles agent routing, verification dispatch, tiered retry, ghost tickets,
 * ticket limits, idle watchdog, cancel/re-engage, and support agent calls.
 *
 * Wire in: extension.ts after orchestrator initialization.
 */

import { Database } from './database';
import { EventBus, COEEvent, COEEventType } from './event-bus';
import { ConfigManager } from './config';
import {
    Ticket, TicketStatus, TicketPriority, AgentContext, AgentResponse, AgentAction, TicketRun,
    ProjectPhase, PHASE_ORDER, PhaseGateResult, LeadAgentQueue, TeamQueueStatus,
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
    /** v5.0: LLM-driven ticket selection — optional for backward compat with test mocks */
    selectNextTicket?(candidates: Array<{
        ticketId: string;
        ticketNumber: number;
        title: string;
        priority: string;
        operationType: string;
        body: string;
        blockingTicketId: string | null;
        deliverableType: string;
        retryCount: number;
        lastError: string | null;
        createdAt: string;
    }>): Promise<string | null>;
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

/** v7.0: Minimal interface for DocumentManagerService, avoiding tight coupling */
export interface DocumentManagerLike {
    gatherContextDocs(ticket: Ticket): import('../types').SupportDocument[];
    formatContextDocs(docs: import('../types').SupportDocument[]): string;
    searchDocuments(query: { keyword?: string }): import('../types').SupportDocument[];
    saveDocument(
        folderName: string, docName: string, content: string,
        meta?: Record<string, unknown>
    ): import('../types').SupportDocument;
}

/** v9.0: Minimal interface for AgentTreeManager, avoiding tight coupling */
export interface AgentTreeManagerLike {
    activateNode(nodeId: string): void;
    completeNode(nodeId: string, result: string): void;
    failNode(nodeId: string, error: string): void;
    waitForChildren(nodeId: string): void;
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

    // v5.0: User-created tickets go through planning → coding pipeline
    // Previously these were skipped (returned null), but the Boss AI should
    // be able to process ALL tickets. Planning agent analyzes what's needed.
    if (op === 'user_created') {
        if (richContext) {
            // User provided detailed instructions — go straight to coding
            return {
                steps: [
                    { agentName: 'orchestrator', deliverableType: 'assessment', stage: 0 },
                    { agentName: 'coding', deliverableType: 'code_generation', stage: 2 },
                    { agentName: 'orchestrator', deliverableType: 'completion_review', stage: 99 },
                ],
                deliverableType: 'code_generation',
            };
        }
        // Not enough context — planning first, then routing based on content
        return {
            steps: [
                { agentName: 'orchestrator', deliverableType: 'assessment', stage: 0 },
                { agentName: 'planning', deliverableType: 'implementation_plan', stage: 1 },
                { agentName: 'orchestrator', deliverableType: 'completion_review', stage: 99 },
            ],
            deliverableType: 'implementation_plan',
        };
    }

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
    // v7.0: 4 team queues replace single unified queue
    private teamQueues = new Map<LeadAgentQueue, QueuedTicket[]>([
        [LeadAgentQueue.Orchestrator, []],
        [LeadAgentQueue.Planning, []],
        [LeadAgentQueue.Verification, []],
        [LeadAgentQueue.CodingDirector, []],
    ]);
    /** v7.0: Per-team status tracking for round-robin balancing */
    private teamStatus = new Map<LeadAgentQueue, TeamQueueStatus>([
        [LeadAgentQueue.Orchestrator, { queue: LeadAgentQueue.Orchestrator, pending: 0, active: 0, blocked: 0, cancelled: 0, lastServedAt: 0, allocatedSlots: 1 }],
        [LeadAgentQueue.Planning, { queue: LeadAgentQueue.Planning, pending: 0, active: 0, blocked: 0, cancelled: 0, lastServedAt: 0, allocatedSlots: 1 }],
        [LeadAgentQueue.Verification, { queue: LeadAgentQueue.Verification, pending: 0, active: 0, blocked: 0, cancelled: 0, lastServedAt: 0, allocatedSlots: 1 }],
        [LeadAgentQueue.CodingDirector, { queue: LeadAgentQueue.CodingDirector, pending: 0, active: 0, blocked: 0, cancelled: 0, lastServedAt: 0, allocatedSlots: 0 }],
    ]);
    /** v7.0: Ordered team list for round-robin traversal */
    private readonly TEAM_ORDER: LeadAgentQueue[] = [
        LeadAgentQueue.Planning,
        LeadAgentQueue.Verification,
        LeadAgentQueue.CodingDirector,
        LeadAgentQueue.Orchestrator,  // Catch-all goes last
    ];
    /** v7.0: Round-robin index — tracks which team to serve next */
    private roundRobinIndex = 0;
    /** v7.0: Backward-compatible flat queue accessor (computed from team queues) */
    private get queue(): QueuedTicket[] {
        const flat: QueuedTicket[] = [];
        for (const q of this.teamQueues.values()) flat.push(...q);
        return flat;
    }
    /** v6.0: Parallel processing slots — replaces boolean `isProcessing` */
    private activeSlots = new Map<string, { ticketId: string; startedAt: number; team: LeadAgentQueue }>();
    /** v6.0: Max concurrent ticket pipelines (from config). Default: 3. */
    private maxParallelTickets = 3;
    private bossCycleTimer: ReturnType<typeof setTimeout> | null = null;
    private bossState: 'active' | 'waiting' | 'idle' = 'idle';
    private lastActivityTimestamp = Date.now();
    private nextBossCheckAt = 0;
    private eventHandlers: Array<{ type: COEEventType; handler: (event: COEEvent) => void }> = [];
    private disposed = false;
    // v5.0: Guard against kickBossCycle() during startup assessment LLM call
    private startupAssessmentRunning = false;
    private kickRequestedDuringStartup = false;
    /** v6.0: Hold queue for tickets waiting on a different model */
    private holdQueue: Array<{
        ticketId: string;
        requiredModel: string;
        heldAt: number;
        timeoutMs: number;
        queueEntry: QueuedTicket;
        team: LeadAgentQueue;
    }> = [];
    /** v6.0: Flag to prevent concurrent fillSlots() calls */
    private fillingSlots = false;
    /** v7.0: Document manager for support document context injection */
    private documentManager: DocumentManagerLike | null = null;
    /** v9.0: Agent tree manager for live status tracking during ticket processing */
    private agentTreeMgr: AgentTreeManagerLike | null = null;

    constructor(
        private database: Database,
        private orchestrator: OrchestratorLike,
        private eventBus: EventBus,
        private config: ConfigManager,
        private outputChannel: OutputChannelLike
    ) {
        this.maxParallelTickets = this.config.getConfig().bossParallelBatchSize ?? 3;
        // v7.0: Initialize slot allocation from config
        this.applySlotAllocation(this.config.getConfig().teamSlotAllocation);
    }

    /**
     * v7.0: Inject DocumentManagerService for support document context injection.
     * Called during extension activation after DocumentManager is created.
     */
    setDocumentManager(dm: DocumentManagerLike): void {
        this.documentManager = dm;
        this.outputChannel.appendLine('[TicketProcessor] DocumentManagerService injected.');
    }

    /**
     * v9.0: Inject AgentTreeManager for live tree status tracking.
     * Called during extension activation after AgentTreeManager is created.
     */
    setAgentTreeManager(atm: AgentTreeManagerLike): void {
        this.agentTreeMgr = atm;
        this.outputChannel.appendLine('[TicketProcessor] AgentTreeManager injected for live status.');
    }

    // ==================== TEAM QUEUE MANAGEMENT (v7.0) ====================

    /**
     * v7.0: Route a ticket to the appropriate team queue.
     *
     * Rules (in order of precedence):
     * 1. ticket.assigned_queue overrides all (Boss can force-route)
     * 2. operation_type = 'code_generation' → CodingDirector
     * 3. operation_type = 'verification' → Verification
     * 4. operation_type = 'plan_generation' | 'design_change' | 'gap_analysis' | 'design_score' → Planning
     * 5. operation_type = 'boss_directive' → uses payload target_queue, or Orchestrator
     * 6. Default → Orchestrator (catch-all)
     */
    routeToTeamQueue(ticket: Ticket): LeadAgentQueue {
        // 1. Explicit assignment overrides everything
        if (ticket.assigned_queue) {
            const validQueues = Object.values(LeadAgentQueue) as string[];
            if (validQueues.includes(ticket.assigned_queue)) {
                return ticket.assigned_queue as LeadAgentQueue;
            }
        }

        const op = ticket.operation_type || '';

        // 2. Code generation → Coding Director
        if (op === 'code_generation') return LeadAgentQueue.CodingDirector;

        // 3. Verification → Verification team
        if (op === 'verification') return LeadAgentQueue.Verification;

        // 4. Planning-family operations → Planning team
        if (['plan_generation', 'design_change', 'gap_analysis', 'design_score'].includes(op)) {
            return LeadAgentQueue.Planning;
        }

        // 5. Boss directives — check body for target_queue hint, else Orchestrator
        if (op === 'boss_directive') {
            const body = (ticket.body || '').toLowerCase();
            if (body.includes('target_queue:planning') || body.includes('target_queue: planning')) {
                return LeadAgentQueue.Planning;
            }
            if (body.includes('target_queue:verification') || body.includes('target_queue: verification')) {
                return LeadAgentQueue.Verification;
            }
            if (body.includes('target_queue:coding_director') || body.includes('target_queue: coding_director')) {
                return LeadAgentQueue.CodingDirector;
            }
            return LeadAgentQueue.Orchestrator;
        }

        // 6. Title-based heuristics for finer routing
        const title = ticket.title.toLowerCase();
        if (title.startsWith('phase: design') || title.startsWith('phase: data model') || title.startsWith('phase: task generation')) {
            return LeadAgentQueue.Planning;
        }
        if (title.startsWith('phase: verification') || title.startsWith('verify:')) {
            return LeadAgentQueue.Verification;
        }
        if (title.startsWith('coding:') || title.startsWith('rework:')) {
            return LeadAgentQueue.CodingDirector;
        }

        // 7. Default: Orchestrator (catch-all)
        return LeadAgentQueue.Orchestrator;
    }

    /**
     * v7.0: Apply slot allocation from config to team status.
     * Boss AI can dynamically change this via update_slot_allocation action.
     */
    private applySlotAllocation(allocation?: Record<string, number>): void {
        if (!allocation) return;
        for (const [team, slots] of Object.entries(allocation)) {
            const status = this.teamStatus.get(team as LeadAgentQueue);
            if (status) {
                status.allocatedSlots = slots;
            }
        }
    }

    /**
     * v7.0: Update slot allocation dynamically (Boss AI action).
     * Validates total doesn't exceed maxParallelTickets.
     */
    updateSlotAllocation(allocation: Record<string, number>): boolean {
        const total = Object.values(allocation).reduce((sum, n) => sum + n, 0);
        if (total > this.maxParallelTickets) {
            this.outputChannel.appendLine(
                `[TicketProcessor] Slot allocation rejected: total ${total} exceeds max ${this.maxParallelTickets}`
            );
            return false;
        }
        this.applySlotAllocation(allocation);
        this.config.updateConfig({ teamSlotAllocation: allocation });
        this.eventBus.emit('boss:slot_allocation_updated', 'ticket-processor', { allocation });
        this.outputChannel.appendLine(
            `[TicketProcessor] Slot allocation updated: ${JSON.stringify(allocation)}`
        );
        return true;
    }

    /**
     * v7.0: Get the total queue size across all teams.
     */
    private getTotalQueueSize(): number {
        let total = 0;
        for (const q of this.teamQueues.values()) total += q.length;
        return total;
    }

    /**
     * v7.0: Get team queue by name. Returns the array (mutable).
     */
    private getTeamQueue(team: LeadAgentQueue): QueuedTicket[] {
        return this.teamQueues.get(team) || [];
    }

    /**
     * v7.0: Count active slots for a specific team.
     */
    private getActiveSlotCountForTeam(team: LeadAgentQueue): number {
        let count = 0;
        for (const slot of this.activeSlots.values()) {
            if (slot.team === team) count++;
        }
        return count;
    }

    /**
     * v7.0: Remove a ticket from all team queues by ID.
     * Returns the QueuedTicket entry and which team it was in, or null if not found.
     */
    private removeFromTeamQueues(ticketId: string): { entry: QueuedTicket; team: LeadAgentQueue } | null {
        for (const [team, q] of this.teamQueues) {
            const idx = q.findIndex(e => e.ticketId === ticketId);
            if (idx >= 0) {
                const [entry] = q.splice(idx, 1);
                return { entry, team };
            }
        }
        return null;
    }

    /**
     * v7.0: Check if a ticket is in any team queue.
     */
    private isInAnyQueue(ticketId: string): boolean {
        for (const q of this.teamQueues.values()) {
            if (q.some(e => e.ticketId === ticketId)) return true;
        }
        return false;
    }

    /**
     * v7.0: Move a ticket between team queues.
     */
    moveTicketToQueue(ticketId: string, targetQueue: LeadAgentQueue): boolean {
        const removed = this.removeFromTeamQueues(ticketId);
        if (!removed) {
            this.outputChannel.appendLine(
                `[TicketProcessor] moveTicketToQueue: ticket ${ticketId} not found in any queue`
            );
            return false;
        }

        const targetQueueArr = this.getTeamQueue(targetQueue);
        targetQueueArr.push(removed.entry);
        this.sortQueue(targetQueueArr);

        // Update ticket in DB
        this.database.updateTicket(ticketId, { assigned_queue: targetQueue });

        this.outputChannel.appendLine(
            `[TicketProcessor] Moved ticket ${ticketId} from ${removed.team} → ${targetQueue}`
        );
        this.eventBus.emit('boss:ticket_moved_queue', 'ticket-processor', {
            ticketId, fromQueue: removed.team, toQueue: targetQueue,
        });
        return true;
    }

    /**
     * v7.0: Cancel a ticket — remove from queue, mark cancelled in DB.
     */
    cancelTicket(ticketId: string, reason?: string): boolean {
        // Remove from queue
        this.removeFromTeamQueues(ticketId);

        // Also remove from active slots if running
        for (const [slotId, slot] of this.activeSlots) {
            if (slot.ticketId === ticketId) {
                this.activeSlots.delete(slotId);
                break;
            }
        }

        const ticket = this.database.getTicket(ticketId);
        if (!ticket) return false;

        this.database.updateTicket(ticketId, {
            status: TicketStatus.Cancelled,
            processing_status: null,
            cancellation_reason: reason || 'Cancelled by Boss AI',
        });

        if (reason) {
            this.database.addTicketReply(ticketId, 'boss-ai', `Ticket cancelled: ${reason}`);
        }

        this.outputChannel.appendLine(
            `[TicketProcessor] Cancelled TK-${ticket.ticket_number}: ${reason || 'no reason'}`
        );
        this.eventBus.emit('boss:ticket_cancelled', 'ticket-processor', {
            ticketId, ticketNumber: ticket.ticket_number, reason,
        });
        return true;
    }

    /**
     * v7.0: Re-engage a previously cancelled ticket.
     * Loads from DB, re-routes to appropriate team queue, marks Open.
     */
    reengageTicket(ticketId: string): boolean {
        const ticket = this.database.getTicket(ticketId);
        if (!ticket) return false;
        if (ticket.status !== TicketStatus.Cancelled) {
            this.outputChannel.appendLine(
                `[TicketProcessor] reengageTicket: TK-${ticket.ticket_number} is not cancelled (status: ${ticket.status})`
            );
            return false;
        }

        // Reset status
        this.database.updateTicket(ticketId, {
            status: TicketStatus.Open,
            processing_status: 'queued',
            cancellation_reason: null,
        });
        this.database.addTicketReply(ticketId, 'boss-ai',
            'Ticket re-engaged by Boss AI — conditions may have changed.');

        // Route to appropriate team queue
        const team = this.routeToTeamQueue(ticket);
        this.database.updateTicket(ticketId, { assigned_queue: team });

        const teamQueue = this.getTeamQueue(team);
        teamQueue.push({
            ticketId: ticket.id,
            priority: ticket.priority,
            enqueuedAt: Date.now(),
            operationType: ticket.operation_type || 'unknown',
            errorRetryCount: 0,
        });
        this.sortQueue(teamQueue);

        this.outputChannel.appendLine(
            `[TicketProcessor] Re-engaged TK-${ticket.ticket_number} → ${team} queue`
        );
        this.eventBus.emit('boss:ticket_reengaged', 'ticket-processor', {
            ticketId, ticketNumber: ticket.ticket_number, team,
        });

        this.kickBossCycle();
        return true;
    }

    /**
     * v7.0: Get status of all team queues (for Boss AI and webapp).
     */
    getTeamQueueStatus(): TeamQueueStatus[] {
        const statuses: TeamQueueStatus[] = [];
        // Fetch cancelled tickets once outside the loop for efficiency
        const cancelledTickets = this.database.getCancelledTickets?.() ?? [];

        for (const team of this.TEAM_ORDER) {
            const q = this.getTeamQueue(team);
            const status = this.teamStatus.get(team)!;
            const cancelledForTeam = cancelledTickets.filter(t => t.assigned_queue === team).length;

            statuses.push({
                queue: team,
                pending: q.length,
                active: this.getActiveSlotCountForTeam(team),
                blocked: q.filter(e => {
                    const t = this.database.getTicket(e.ticketId);
                    return t?.blocking_ticket_id != null;
                }).length,
                cancelled: cancelledForTeam,
                lastServedAt: status.lastServedAt,
                allocatedSlots: status.allocatedSlots,
            });
        }
        return statuses;
    }

    /**
     * v7.0: Review cancelled tickets for potential re-engagement.
     * Called by Boss AI on its periodic cycle.
     * Returns list of ticket IDs that were re-engaged.
     */
    reviewCancelledTickets(): string[] {
        const cancelled = this.database.getCancelledTickets();
        const reengaged: string[] = [];

        for (const ticket of cancelled) {
            // Check if blocking ticket has been resolved
            if (ticket.blocking_ticket_id) {
                const blocker = this.database.getTicket(ticket.blocking_ticket_id);
                if (blocker && blocker.status === TicketStatus.Resolved) {
                    if (this.reengageTicket(ticket.id)) {
                        reengaged.push(ticket.id);
                    }
                }
            }
        }

        if (reengaged.length > 0) {
            this.outputChannel.appendLine(
                `[TicketProcessor] Cancelled ticket review: re-engaged ${reengaged.length} ticket(s)`
            );
        }

        return reengaged;
    }

    // ==================== SUPPORT AGENT CALLS (v7.0 Phase 3) ====================

    /**
     * v7.0: Execute a support agent call — either synchronously (inline) or asynchronously (sub-ticket).
     *
     * Sync mode: Directly calls the support agent and returns its response content.
     *   Used for quick lookups (Answer Agent, Decision Memory, Clarity).
     *
     * Async mode: Creates a sub-ticket in the appropriate team queue and returns the ticket ID.
     *   Used for research tasks that may take a while (Research Agent).
     */
    async executeSupportCall(call: {
        agent_name: string;
        query: string;
        ticket_id: string;
        mode: 'sync' | 'async';
        callback_action: 'resume' | 'block' | 'escalate';
    }): Promise<string | null> {
        const maxSyncTimeout = this.config.getConfig?.()?.maxSupportAgentSyncTimeoutMs ?? 60000;

        if (call.mode === 'sync') {
            // Synchronous: call the agent directly with a timeout
            try {
                this.eventBus.emit('support:sync_call', 'ticket-processor', {
                    agent: call.agent_name, ticketId: call.ticket_id,
                });

                const context: AgentContext = {
                    conversationHistory: [],
                    ticket: call.ticket_id ? this.database.getTicket(call.ticket_id) ?? undefined : undefined,
                };

                const response = await Promise.race([
                    this.orchestrator.callAgent(call.agent_name, call.query, context),
                    new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error('Support agent sync timeout')), maxSyncTimeout)
                    ),
                ]);

                return response.content || null;
            } catch (err) {
                this.outputChannel.appendLine(
                    `[TicketProcessor] Support sync call to ${call.agent_name} failed: ${err}`
                );
                return null;
            }
        } else {
            // Asynchronous: create a sub-ticket that will be processed in a team queue
            try {
                const parentTicket = call.ticket_id ? this.database.getTicket(call.ticket_id) : null;
                const subTicket = this.database.createTicket({
                    title: `[Support] ${call.agent_name}: ${call.query.substring(0, 80)}`,
                    body: `Support agent call from ticket ${parentTicket?.ticket_number || '?'}.\n\nQuery: ${call.query}`,
                    priority: (parentTicket?.priority as TicketPriority) || TicketPriority.P2,
                    operation_type: call.agent_name === 'research' ? 'research' : 'ai_question',
                    auto_created: true,
                    parent_ticket_id: call.ticket_id || null,
                    blocking_ticket_id: call.callback_action === 'block' ? call.ticket_id : null,
                });

                // If the parent should be blocked waiting for this result
                if (call.callback_action === 'block' && call.ticket_id) {
                    this.database.updateTicket(call.ticket_id, {
                        status: TicketStatus.Blocked,
                        blocking_ticket_id: subTicket.id,
                    });
                }

                this.eventBus.emit('support:async_ticket_created', 'ticket-processor', {
                    subTicketId: subTicket.id, parentTicketId: call.ticket_id, agent: call.agent_name,
                });

                this.outputChannel.appendLine(
                    `[TicketProcessor] Support async ticket ${subTicket.ticket_number} created for ${call.agent_name}`
                );

                return subTicket.id;
            } catch (err) {
                this.outputChannel.appendLine(
                    `[TicketProcessor] Support async ticket creation failed: ${err}`
                );
                return null;
            }
        }
    }

    /**
     * v7.0: Evaluate task assignment success criteria against agent response.
     * Returns an array of criteria results showing which passed/failed.
     */
    evaluateAssignmentCriteria(
        criteria: Array<{ criterion: string; verification_method: string; required: boolean }>,
        response: AgentResponse,
        sourceTicketId?: string
    ): Array<{ criterion: string; passed: boolean; detail: string; required: boolean }> {
        return criteria.map(c => {
            switch (c.verification_method) {
                case 'output_contains': {
                    // Check if the response content contains the expected substring
                    const content = (response.content || '').toLowerCase();
                    const keyword = c.criterion.toLowerCase();
                    const passed = content.includes(keyword);
                    return { criterion: c.criterion, passed, detail: passed ? 'Found in output' : 'Not found in output', required: c.required };
                }
                case 'ticket_resolved': {
                    // Check if a linked ticket is resolved
                    if (sourceTicketId) {
                        const ticket = this.database.getTicket(sourceTicketId);
                        const passed = ticket?.status === TicketStatus.Resolved;
                        return { criterion: c.criterion, passed, detail: passed ? 'Ticket resolved' : 'Ticket not yet resolved', required: c.required };
                    }
                    return { criterion: c.criterion, passed: false, detail: 'No source ticket to check', required: c.required };
                }
                case 'info_gathered': {
                    // Check if support_documents table has a matching entry
                    const docs = this.database.searchSupportDocuments?.({ keyword: c.criterion }) ?? [];
                    const passed = docs.length > 0;
                    return { criterion: c.criterion, passed, detail: passed ? `Found ${docs.length} document(s)` : 'No matching documents found', required: c.required };
                }
                case 'file_exists': {
                    // Placeholder — file checking requires workspace access not available here
                    return { criterion: c.criterion, passed: false, detail: 'File check not available in this context', required: c.required };
                }
                case 'manual_check':
                default: {
                    // Manual checks always fail — need human verification
                    return { criterion: c.criterion, passed: false, detail: 'Requires manual verification', required: c.required };
                }
            }
        });
    }

    /**
     * Start listening for ticket events and begin processing.
     * v5.0: Boss AI is the sole supervisor — all processing goes through bossCycle().
     */
    start(): void {
        this.outputChannel.appendLine('[TicketProcessor] Starting Boss AI supervisor...');

        // Listen for new tickets — enqueue and kick Boss cycle
        // v5.0: All tickets (user-created AND auto-created) go through Boss AI queue
        this.listen('ticket:created', (event) => {
            const ticketId = event.data.ticketId as string;
            if (!ticketId) return;
            const ticket = this.database.getTicket(ticketId);
            if (!ticket) return;

            // Skip resolved/closed tickets
            if (ticket.status === TicketStatus.Resolved) return;

            const aiLevel = this.getAILevel(ticket);
            if (aiLevel === 'manual') return;

            this.enqueueTicket(ticket);
        });

        // Listen for unblocked tickets (ghost resolved)
        // v5.0: All unblocked tickets re-enter Boss AI queue (respecting AI mode)
        this.listen('ticket:unblocked', (event) => {
            const ticketId = event.data.ticketId as string;
            if (!ticketId) return;
            const ticket = this.database.getTicket(ticketId);
            if (!ticket) return;
            const aiLevel = this.getAILevel(ticket);
            if (aiLevel === 'manual') return; // Manual mode: don't auto-enqueue
            this.enqueueTicket(ticket);
        });

        // Listen for completed tickets to check phase gates
        this.listen('ticket:processing_completed', () => {
            setTimeout(() => {
                if (!this.disposed) {
                    this.checkAndAdvancePhase();
                    // Boss cycle handles continuation — no explicit kick needed
                }
            }, 500);
        });

        // v5.0: All these events kick the Boss cycle (interrupt countdown if idle)
        this.listen('ticket:replied', () => {
            setTimeout(() => { if (!this.disposed) this.kickBossCycle(); }, 300);
        });
        this.listen('ticket:review_flagged', () => {
            setTimeout(() => { if (!this.disposed) this.kickBossCycle(); }, 300);
        });
        this.listen('ai:question_answered', () => {
            setTimeout(() => { if (!this.disposed) this.kickBossCycle(); }, 300);
        });

        // Track activity timestamps
        const activityEvents: COEEventType[] = [
            'ticket:created', 'ticket:updated', 'ticket:resolved',
            'task:completed', 'task:verified', 'task:started',
            'agent:completed',
        ];
        for (const evtType of activityEvents) {
            this.listen(evtType, () => {
                this.lastActivityTimestamp = Date.now();
            });
        }

        // Recover orphaned tickets — populate queue but defer processing
        this.recoverOrphanedTickets(/* deferProcessing */ true);

        this.outputChannel.appendLine('[TicketProcessor] Ready — Boss AI supervisor listening');

        // v5.0: Boss AI startup assessment runs FIRST, then bossCycle() begins
        setTimeout(() => {
            if (!this.disposed) {
                this.startupAssessmentRunning = true;
                this.kickRequestedDuringStartup = false;
                // v9.0: 30s timeout guard — if LLM is down, don't block bossCycle indefinitely
                const assessmentPromise = this.runBossStartupAssessment();
                const timeoutPromise = new Promise<void>((resolve) =>
                    setTimeout(() => {
                        this.outputChannel.appendLine('[TicketProcessor] Startup assessment timed out after 30s — proceeding to bossCycle');
                        resolve();
                    }, 30000)
                );
                Promise.race([assessmentPromise, timeoutPromise]).finally(() => {
                    this.startupAssessmentRunning = false;
                    if (!this.disposed) {
                        // If tickets arrived during the assessment, or assessment found work
                        if (this.getTotalQueueSize() > 0 || this.kickRequestedDuringStartup) {
                            this.kickRequestedDuringStartup = false;
                            this.bossCycle();
                        } else {
                            this.startBossCountdown();
                        }
                    }
                });
            }
        }, 2000);
    }

    /**
     * Recover tickets stuck in processing states from a previous session.
     * Called on startup to prevent tickets from being permanently orphaned.
     *
     * v4.1/v5.0: Expanded scope — recovers ALL tickets (user + auto-created):
     *   1. in_review tickets with processing_status != 'holding' (original)
     *   2. Open tickets with processing_status = 'queued' but not in our in-memory queue (lost from queue on crash)
     *   3. in_review tickets with processing_status = 'processing' (stale, older than 10 min)
     *   4. Open tickets with no processing_status (never started — enqueue them)
     */
    private recoverOrphanedTickets(deferProcessing = false): void {
        const recovered: Ticket[] = [];

        // 1. Stuck in_review tickets (not holding)
        const inReviewStuck = this.database.getTicketsByStatus('in_review')
            .filter(t => t.processing_status !== 'holding');
        recovered.push(...inReviewStuck);

        // 2. Open tickets marked 'queued' but not in our queue (lost from in-memory queue on crash)
        const openQueued = this.database.getTicketsByStatus('open')
            .filter(t => t.processing_status === 'queued');
        for (const ticket of openQueued) {
            const inQueue = this.isInAnyQueue(ticket.id);
            if (!inQueue) {
                recovered.push(ticket);
            }
        }

        // 3. Stale 'processing' tickets (older than 10 min updated_at)
        const staleThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const staleProcessing = this.database.getTicketsByStatus('in_review')
            .filter(t => t.processing_status === 'processing' && t.updated_at < staleThreshold);
        // Avoid duplicates
        for (const ticket of staleProcessing) {
            if (!recovered.some(r => r.id === ticket.id)) {
                recovered.push(ticket);
            }
        }

        // 4. v5.0: Open tickets with no processing_status (never started processing)
        // These are tickets that exist in the DB but were never enqueued — e.g. created before
        // the extension restarted, or created while auto-processing was disabled.
        const openUnstarted = this.database.getTicketsByStatus('open')
            .filter(t => !t.processing_status);
        for (const ticket of openUnstarted) {
            if (!recovered.some(r => r.id === ticket.id)) {
                // Check AI level — don't enqueue if plan is in manual mode
                const aiLevel = this.getAILevel(ticket);
                if (aiLevel !== 'manual') {
                    recovered.push(ticket);
                }
            }
        }

        if (recovered.length === 0) return;

        this.outputChannel.appendLine(
            `[TicketProcessor] Recovering ${recovered.length} orphaned tickets (in_review: ${inReviewStuck.length}, lost queued: ${openQueued.length}, stale: ${staleProcessing.length}, unstarted: ${openUnstarted.length})`
        );

        for (const ticket of recovered) {
            // v5.0: Skip manual-mode tickets during recovery
            const recoveryAiLevel = this.getAILevel(ticket);
            if (recoveryAiLevel === 'manual') continue;

            const route = routeTicketToAgent(ticket);
            if (!route) continue;

            // v5.0: Check if ticket is blocked — still recover it but mark clearly
            let isBlocked = false;
            if (ticket.blocking_ticket_id) {
                const blocker = this.database.getTicket(ticket.blocking_ticket_id);
                if (blocker && blocker.status !== TicketStatus.Resolved) {
                    isBlocked = true;
                    this.outputChannel.appendLine(
                        `[TicketProcessor] Recovering TK-${ticket.ticket_number} (blocked by TK-${blocker.ticket_number}) — will defer until blocker resolves`
                    );
                }
            }

            // Reset status and re-enqueue
            this.database.updateTicket(ticket.id, {
                status: TicketStatus.Open,
                processing_status: 'queued',
            });
            this.database.addTicketReply(ticket.id, 'system',
                isBlocked
                    ? 'Ticket recovered after system restart. Currently blocked by a dependency — will process when unblocked.'
                    : 'Ticket recovered from stuck state after system restart.'
            );

            const entry: QueuedTicket = {
                ticketId: ticket.id,
                priority: ticket.priority,
                enqueuedAt: Date.now(),
                operationType: ticket.operation_type || 'unknown',
                errorRetryCount: 0,
            };

            // v7.0: Route to appropriate team queue
            const team = this.routeToTeamQueue(ticket);
            this.database.updateTicket(ticket.id, { assigned_queue: team });
            this.getTeamQueue(team).push(entry);

            this.eventBus.emit('ticket:recovered', 'ticket-processor', {
                ticketId: ticket.id, ticketNumber: ticket.ticket_number, team,
            });
        }

        // Sort all team queues
        for (const q of this.teamQueues.values()) {
            this.sortQueue(q);
        }

        // v5.0: If deferProcessing is true (startup), don't kick processing yet —
        // Boss AI startup assessment will kick bossCycle() after running first.
        if (!deferProcessing) {
            this.kickBossCycle();
        }
    }

    /**
     * Manually trigger recovery of stuck tickets.
     * Can be called from the API or by the Boss Agent.
     */
    recoverStuckTickets(): number {
        // v5.0: Recover all stuck tickets (user + auto-created)
        const stuckTickets = this.database.getTicketsByStatus('in_review')
            .filter(t => t.processing_status !== 'holding');

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

            // v7.0: Route to team queue
            const team = this.routeToTeamQueue(ticket);
            this.database.updateTicket(ticket.id, { assigned_queue: team });
            this.getTeamQueue(team).push({
                ticketId: ticket.id,
                priority: ticket.priority,
                enqueuedAt: Date.now(),
                operationType: ticket.operation_type || 'unknown',
                errorRetryCount: 0,
            });

            this.eventBus.emit('ticket:recovered', 'ticket-processor', {
                ticketId: ticket.id, ticketNumber: ticket.ticket_number, team,
            });
        }

        for (const q of this.teamQueues.values()) this.sortQueue(q);
        this.kickBossCycle();

        return stuckTickets.length;
    }

    /**
     * Enqueue a ticket for processing.
     */
    private enqueueTicket(ticket: Ticket): void {
        // v5.0: Prevent duplicate entries — ticket may already be in queue (e.g. blocked ticket unblocked)
        if (this.isInAnyQueue(ticket.id)) {
            // Ticket is already queued — just re-sort the relevant team queue and kick the cycle
            const team = this.routeToTeamQueue(ticket);
            this.sortQueue(this.getTeamQueue(team));
            this.kickBossCycle();
            return;
        }

        const cfg = this.config.getConfig();
        const maxActive = cfg.maxActiveTickets ?? 10;

        // Ticket limits enforcement (B10)
        const activeCount = this.database.getActiveTicketCount();
        if (activeCount >= maxActive) {
            // P1 tickets can bump P3 tickets
            if (ticket.priority === TicketPriority.P1) {
                const bumped = this.bumpLowestPriority();
                if (!bumped) {
                    this.outputChannel.appendLine(`[TicketProcessor] Ticket limit reached (${maxActive}), P1 ticket waiting for slot`);
                    return;
                }
            } else {
                this.outputChannel.appendLine(`[TicketProcessor] Ticket limit reached (${maxActive}), ticket waiting for slot`);
                return;
            }
        }

        // v7.0: Route to appropriate team queue
        const team = this.routeToTeamQueue(ticket);

        // Update status and assigned queue
        this.database.updateTicket(ticket.id, {
            processing_status: 'queued',
            assigned_queue: team,
        });
        this.eventBus.emit('ticket:queued', 'ticket-processor', {
            ticketId: ticket.id, ticketNumber: ticket.ticket_number, team,
        });

        // Push to the team's queue
        const teamQueue = this.getTeamQueue(team);
        teamQueue.push({
            ticketId: ticket.id,
            priority: ticket.priority,
            enqueuedAt: Date.now(),
            operationType: ticket.operation_type || 'unknown',
            errorRetryCount: 0,
        });
        this.sortQueue(teamQueue);
        this.kickBossCycle();
    }

    /**
     * v5.0: Boss AI supervisor cycle — the ONE processing loop.
     *
     * This replaces both processMainQueue() and processBossQueue().
     * Boss AI is the sole decision maker: it picks tickets, updates status FIRST,
     * then dispatches agents. Only ONE ticket processes at a time (green light system).
     *
     * Flow:
     *   1. Boss health check
     *   2. Execute Boss actions (create corrective tickets, escalate)
     *   3. Re-sort queue
     *   4. PEEK next ticket
     *   5. UPDATE ticket status FIRST (emit boss:dispatching_ticket)
     *   6. Process ticket through agent pipeline
     *   7. On completion: update status, enqueue child tickets
     *   8. Loop back to step 1 if more tickets
     *   9. If empty: enter 5-minute countdown (startBossCountdown)
     */
    private async bossCycle(): Promise<void> {
        // v6.0: Allow bossCycle if we have free slots (not just when idle)
        if (this.disposed) return;
        // If all slots are full, don't start another cycle
        if (this.activeSlots.size >= this.maxParallelTickets) return;

        this.bossState = 'active';

        // Cancel any pending countdown
        if (this.bossCycleTimer) {
            clearTimeout(this.bossCycleTimer);
            this.bossCycleTimer = null;
        }

        const totalQueued = this.getTotalQueueSize();
        this.eventBus.emit('boss:cycle_started', 'ticket-processor', {
            queueSize: totalQueued,
            activeSlots: this.activeSlots.size,
            maxSlots: this.maxParallelTickets,
            teamQueues: this.getTeamQueueStatus(),
        });
        this.outputChannel.appendLine(
            `[TicketProcessor] Boss cycle started — ${totalQueued} ticket(s) in queue, ${this.activeSlots.size}/${this.maxParallelTickets} slots active`
        );

        // v6.0: Run Boss inter-ticket orchestration ONCE per cycle (not per ticket)
        if (this.activeSlots.size === 0 && totalQueued > 0) {
            await this.runBossInterTicket();
        }

        // Re-sort all team queues (Boss actions may have added/changed tickets)
        for (const q of this.teamQueues.values()) this.sortQueue(q);

        // v6.0: Fill all available parallel slots
        this.fillSlots();
    }

    /**
     * v7.0: Fill available processing slots using round-robin team balancing.
     *
     * Soft-preference round-robin:
     * 1. Walk through TEAM_ORDER starting from roundRobinIndex
     * 2. Pick first team that has: pending tickets AND allocatedSlots > currently active for that team
     * 3. Take the next processable ticket from that team's queue
     * 4. Advance roundRobinIndex
     * 5. Repeat until all slots filled or no eligible teams
     */
    private fillSlots(): void {
        if (this.disposed || this.fillingSlots) return;
        this.fillingSlots = true;

        try {
            // Refresh batch size from config
            this.maxParallelTickets = this.config.getConfig().bossParallelBatchSize ?? 3;

            // v6.0: Check hold queue for timed-out tickets — release them back
            this.checkHoldQueueTimeouts();

            let noProgressCount = 0;
            const maxAttempts = this.TEAM_ORDER.length * 2; // Safety: prevent infinite loop

            while (this.activeSlots.size < this.maxParallelTickets && !this.disposed && noProgressCount < maxAttempts) {
                // v7.0: Round-robin team selection
                let slotFilled = false;

                for (let attempt = 0; attempt < this.TEAM_ORDER.length; attempt++) {
                    const teamIdx = (this.roundRobinIndex + attempt) % this.TEAM_ORDER.length;
                    const team = this.TEAM_ORDER[teamIdx];
                    const teamQueue = this.getTeamQueue(team);
                    const teamStat = this.teamStatus.get(team)!;
                    const activeForTeam = this.getActiveSlotCountForTeam(team);

                    // Skip if no pending tickets or team is at slot limit
                    if (teamQueue.length === 0) continue;
                    if (activeForTeam >= teamStat.allocatedSlots && teamStat.allocatedSlots > 0) continue;

                    // Find next processable ticket in this team's queue
                    const result = this.peekNextProcessableFromTeam(team);
                    if (!result) continue;

                    const { entry, index } = result;
                    const ticket = this.database.getTicket(entry.ticketId);

                    // AI mode checks — may skip/defer the ticket
                    if (ticket && !this.checkAIModeForSlot(ticket, entry, index, team)) {
                        continue; // Ticket was handled — try next team
                    }

                    // Remove from team queue and add to active slot
                    teamQueue.splice(index, 1);
                    const slotId = `slot_${Date.now()}_${entry.ticketId.substring(0, 8)}`;
                    this.activeSlots.set(slotId, { ticketId: entry.ticketId, startedAt: Date.now(), team });

                    // Update team status
                    teamStat.lastServedAt = Date.now();

                    this.outputChannel.appendLine(
                        `[TicketProcessor] Slot ${this.activeSlots.size}/${this.maxParallelTickets} filled [${team}]: TK-${ticket?.ticket_number} "${ticket?.title}" (${entry.priority})`
                    );

                    this.eventBus.emit('boss:slot_started', 'ticket-processor', {
                        slotId,
                        ticketId: entry.ticketId,
                        ticketNumber: ticket?.ticket_number,
                        team,
                        activeSlots: this.activeSlots.size,
                        queueRemaining: this.getTotalQueueSize(),
                    });

                    if (ticket) {
                        this.eventBus.emit('boss:dispatching_ticket', 'ticket-processor', {
                            ticketId: entry.ticketId,
                            ticketNumber: ticket.ticket_number,
                            title: ticket.title,
                            priority: entry.priority,
                            team,
                            queueRemaining: this.getTotalQueueSize(),
                        });
                    }

                    // Fire-and-forget — run slot concurrently (don't await)
                    this.processSlot(slotId, entry).catch(() => { /* error handled in processSlot */ });

                    // Advance round-robin past this team
                    this.roundRobinIndex = (teamIdx + 1) % this.TEAM_ORDER.length;
                    slotFilled = true;
                    break; // Exit inner loop — restart from new round-robin position
                }

                if (!slotFilled) {
                    noProgressCount++;
                    break; // No team had eligible tickets — stop filling
                } else {
                    noProgressCount = 0;
                }
            }

            this.eventBus.emit('queue:balance_cycle', 'ticket-processor', {
                teamQueues: this.getTeamQueueStatus(),
                activeSlots: this.activeSlots.size,
                roundRobinIndex: this.roundRobinIndex,
            });

            // v6.0: If no processable tickets but hold queue has items,
            // check if we should trigger a model swap (Pause & Swap strategy)
            if (this.activeSlots.size === 0 && this.getTotalQueueSize() === 0 && this.holdQueue.length > 0 && !this.disposed) {
                this.checkModelSwapNeeded().then(released => {
                    if (released && !this.disposed) {
                        this.fillSlots(); // Re-fill slots with newly released tickets
                    }
                }).catch(() => { /* model swap errors are non-fatal */ });
            }

            // If no slots active and no more processable tickets → countdown
            if (this.activeSlots.size === 0 && !this.disposed) {
                this.lastActivityTimestamp = Date.now();
                this.eventBus.emit('boss:cycle_completed', 'ticket-processor', {
                    ticketsProcessed: 0,
                    queueRemaining: this.getTotalQueueSize(),
                    activeSlots: 0,
                    holdQueueSize: this.holdQueue.length,
                });
                this.startBossCountdown();
            }
        } finally {
            this.fillingSlots = false;
        }
    }

    /**
     * v7.0: Find the next processable ticket from a specific team queue.
     *
     * Skips:
     * - Tickets already in an active slot
     * - Tickets blocked by an unresolved ticket
     *
     * Returns the queue entry and its index within the team queue, or null.
     */
    private peekNextProcessableFromTeam(team: LeadAgentQueue): { entry: QueuedTicket; index: number } | null {
        const teamQueue = this.getTeamQueue(team);
        const activeTicketIds = new Set([...this.activeSlots.values()].map(s => s.ticketId));

        for (let i = 0; i < teamQueue.length; i++) {
            const entry = teamQueue[i];

            // Skip if already in a slot
            if (activeTicketIds.has(entry.ticketId)) continue;

            const ticket = this.database.getTicket(entry.ticketId);
            if (!ticket) {
                // Missing ticket — remove from queue silently
                teamQueue.splice(i, 1);
                i--;
                continue;
            }

            // Check blocking
            if (ticket.blocking_ticket_id) {
                const blocker = this.database.getTicket(ticket.blocking_ticket_id);
                if (blocker && blocker.status !== TicketStatus.Resolved) {
                    continue; // Blocked — skip
                }
            }

            return { entry, index: i };
        }

        return null;
    }

    /**
     * v6.0/v7.0: Find the next processable ticket across ALL team queues.
     * Used by model swap logic and other places that need a global check.
     */
    private peekNextProcessable(): { entry: QueuedTicket; index: number; team: LeadAgentQueue } | null {
        for (const team of this.TEAM_ORDER) {
            const result = this.peekNextProcessableFromTeam(team);
            if (result) return { ...result, team };
        }
        return null;
    }

    /**
     * v7.0: Check AI mode for a ticket before slotting it.
     *
     * Returns true if the ticket should be processed normally.
     * Returns false if the ticket was handled (skipped/deferred) — caller should try next.
     */
    private checkAIModeForSlot(ticket: Ticket, entry: QueuedTicket, queueIndex: number, team?: LeadAgentQueue): boolean {
        const globalAIMode = this.config.getConfig().aiMode ?? 'smart';
        const ticketAILevel = this.getAILevel(ticket);
        const effectiveMode = this.resolveEffectiveAIMode(globalAIMode, ticketAILevel);

        if (effectiveMode === 'manual') {
            this.outputChannel.appendLine(
                `[TicketProcessor] AI mode is "manual" — skipping TK-${ticket.ticket_number} "${ticket.title}"`
            );
            // v7.0: Remove from specific team queue
            if (team) {
                this.getTeamQueue(team).splice(queueIndex, 1);
            } else {
                this.removeFromTeamQueues(entry.ticketId);
            }
            return false;
        }

        if (effectiveMode === 'suggest') {
            this.outputChannel.appendLine(
                `[TicketProcessor] AI mode is "suggest" — requesting user approval for TK-${ticket.ticket_number}`
            );
            this.database.createAIQuestion({
                plan_id: ticket.task_id ?? 'boss-ai',
                component_id: null,
                page_id: null,
                category: 'general',
                question: `Boss AI wants to process ticket TK-${ticket.ticket_number}: "${ticket.title}" (${ticket.operation_type}, ${ticket.priority}). Approve?`,
                question_type: 'confirm',
                options: ['Yes, process it', 'No, skip it', 'Defer for later'],
                ai_reasoning: `This ticket is next in the queue. Operation: ${ticket.operation_type}. Priority: ${ticket.priority}.`,
                ai_suggested_answer: 'Yes, process it',
                user_answer: null,
                status: 'pending',
                ticket_id: ticket.id,
                source_agent: 'Boss AI',
                source_ticket_id: ticket.id,
                queue_priority: 1,
                is_ghost: false,
                ai_continued: false,
                dismiss_count: 0,
            });
            // v7.0: Remove from specific team queue
            if (team) {
                this.getTeamQueue(team).splice(queueIndex, 1);
            } else {
                this.removeFromTeamQueues(entry.ticketId);
            }
            return false;
        }

        if (effectiveMode === 'hybrid') {
            const isFrontend = this.isDesignOrFrontendTicket(ticket);
            if (isFrontend) {
                this.outputChannel.appendLine(
                    `[TicketProcessor] AI mode is "hybrid" — TK-${ticket.ticket_number} is frontend/design, requesting approval`
                );
                this.database.createAIQuestion({
                    plan_id: ticket.task_id ?? 'boss-ai',
                    component_id: null,
                    page_id: null,
                    category: 'general',
                    question: `Boss AI wants to process frontend/design ticket TK-${ticket.ticket_number}: "${ticket.title}". In hybrid mode, frontend tickets need your approval. Proceed?`,
                    question_type: 'confirm',
                    options: ['Yes, process it', 'No, skip it'],
                    ai_reasoning: `Hybrid mode: this ticket appears to be frontend/design work. Auto-approval is for backend/infrastructure only.`,
                    ai_suggested_answer: 'Yes, process it',
                    user_answer: null,
                    status: 'pending',
                    ticket_id: ticket.id,
                    source_agent: 'Boss AI',
                    source_ticket_id: ticket.id,
                    queue_priority: 1,
                    is_ghost: false,
                    ai_continued: false,
                    dismiss_count: 0,
                });
                // v7.0: Remove from specific team queue
                if (team) {
                    this.getTeamQueue(team).splice(queueIndex, 1);
                } else {
                    this.removeFromTeamQueues(entry.ticketId);
                }
                return false;
            }
            // Backend/infrastructure — fall through to auto-process
        }

        // effectiveMode === 'smart' (or hybrid for backend) — proceed to process
        return true;
    }

    /**
     * v6.0: Process a single ticket in a parallel slot.
     *
     * Wraps processTicketPipeline() with slot lifecycle management.
     * On completion (success or error), removes from activeSlots and calls fillSlots().
     */
    private async processSlot(slotId: string, entry: QueuedTicket): Promise<void> {
        try {
            const success = await this.processTicketPipeline(entry.ticketId, entry);
            const ticket = this.database.getTicket(entry.ticketId);

            if (success) {
                this.eventBus.emit('boss:slot_completed', 'ticket-processor', {
                    slotId,
                    ticketId: entry.ticketId,
                    ticketNumber: ticket?.ticket_number,
                    success: true,
                });
                this.eventBus.emit('boss:ticket_completed', 'ticket-processor', {
                    ticketId: entry.ticketId,
                    ticketNumber: ticket?.ticket_number,
                    queueRemaining: this.getTotalQueueSize(),
                    activeSlots: this.activeSlots.size - 1,
                });
            } else {
                this.eventBus.emit('boss:slot_error', 'ticket-processor', {
                    slotId,
                    ticketId: entry.ticketId,
                    ticketNumber: ticket?.ticket_number,
                });
                // processTicketPipeline handles re-enqueue/escalation internally
            }
        } catch (error) {
            this.outputChannel.appendLine(
                `[TicketProcessor] Slot ${slotId} error: ${String(error).substring(0, 200)}`
            );
            this.eventBus.emit('boss:slot_error', 'ticket-processor', {
                slotId,
                ticketId: entry.ticketId,
                error: String(error).substring(0, 200),
            });
        } finally {
            // Always clean up the slot and try to fill it
            this.activeSlots.delete(slotId);
            this.lastActivityTimestamp = Date.now();

            // If all slots empty and queue empty → cycle completed
            if (this.activeSlots.size === 0 && this.getTotalQueueSize() === 0) {
                this.eventBus.emit('boss:cycle_completed', 'ticket-processor', {
                    ticketsProcessed: 0,
                    queueRemaining: 0,
                    activeSlots: 0,
                });
                if (!this.disposed) this.startBossCountdown();
            } else if (!this.disposed) {
                // Try to fill the freed slot with the next ticket
                this.fillSlots();
            }
        }
    }

    // ==================== HOLD QUEUE MANAGEMENT (v6.0) ====================

    /**
     * v6.0: Check hold queue for timed-out tickets and release them back to main queue.
     *
     * When a ticket has been held longer than its timeout (default: 1 hour from config,
     * but recommended to lower to 5 min when multi-model is active), it gets released
     * back to the main queue regardless of model status. This prevents indefinite holds.
     */
    private checkHoldQueueTimeouts(): void {
        if (this.holdQueue.length === 0) return;

        const now = Date.now();
        const timedOut: typeof this.holdQueue = [];
        const remaining: typeof this.holdQueue = [];

        for (const held of this.holdQueue) {
            if (now - held.heldAt >= held.timeoutMs) {
                timedOut.push(held);
            } else {
                remaining.push(held);
            }
        }

        if (timedOut.length > 0) {
            this.holdQueue = remaining;
            for (const held of timedOut) {
                // v7.0: Re-enqueue to team queue
                const team = held.team;
                this.getTeamQueue(team).push(held.queueEntry);
                this.outputChannel.appendLine(
                    `[TicketProcessor] Hold timeout: ticket ${held.ticketId} released back to ${team} queue ` +
                    `(was waiting for model "${held.requiredModel}" for ${Math.round((now - held.heldAt) / 60000)} min)`
                );
                this.eventBus.emit('boss:ticket_unheld', 'ticket-processor', {
                    ticketId: held.ticketId,
                    reason: 'timeout',
                    requiredModel: held.requiredModel,
                    heldMs: now - held.heldAt,
                });
                this.database.addAuditLog('boss-ai', 'hold_timeout',
                    `Ticket ${held.ticketId} released after ${Math.round((now - held.heldAt) / 60000)} min hold (model: ${held.requiredModel})`);
            }
            for (const q of this.teamQueues.values()) this.sortQueue(q);
        }
    }

    /**
     * v6.0: Release all held tickets waiting for a specific model.
     * Called after a model swap completes to re-enqueue tickets that can now run.
     */
    private releaseHeldTicketsForModel(model: string): number {
        const released: typeof this.holdQueue = [];
        const remaining: typeof this.holdQueue = [];

        for (const held of this.holdQueue) {
            if (held.requiredModel === model) {
                released.push(held);
            } else {
                remaining.push(held);
            }
        }

        if (released.length > 0) {
            this.holdQueue = remaining;
            for (const held of released) {
                // v7.0: Re-enqueue to original team queue
                this.getTeamQueue(held.team).push(held.queueEntry);
                this.eventBus.emit('boss:ticket_unheld', 'ticket-processor', {
                    ticketId: held.ticketId,
                    reason: 'model_available',
                    requiredModel: held.requiredModel,
                });
            }
            for (const q of this.teamQueues.values()) this.sortQueue(q);
            this.outputChannel.appendLine(
                `[TicketProcessor] Released ${released.length} held ticket(s) for model "${model}"`
            );
        }

        return released.length;
    }

    /**
     * v6.0: Check if a model swap is needed when main queue is drained.
     *
     * Pause & Swap strategy:
     * 1. When main queue has no processable tickets AND hold queue has tickets → trigger swap
     * 2. Wait for all active slots to drain (current work finishes)
     * 3. Swap model via LM Studio API (POST /v1/models/unload, POST /v1/models/load)
     * 4. Release held tickets back to main queue
     * 5. Resume fillSlots()
     *
     * Constraints:
     * - Max 2 different models per boss cycle (prevent excessive swapping)
     * - Only triggers when multiModelEnabled=true (user LM Studio setting)
     * - Swaps are logged for audit trail
     *
     * NOTE: Actual model swapping requires LM Studio API endpoints. For now, this method
     * checks conditions and emits events. The actual HTTP calls to LM Studio will be
     * wired when the model management API is confirmed.
     */
    private async checkModelSwapNeeded(): Promise<boolean> {
        const cfg = this.config.getConfig();

        // Only run if multi-model is enabled (user LM Studio setting)
        if (!cfg.multiModelEnabled) return false;
        if (this.holdQueue.length === 0) return false;

        // Don't swap if there are still processable tickets in main queue
        const nextProcessable = this.peekNextProcessable();
        if (nextProcessable) return false;

        // Don't swap if active slots are still running — wait for them to drain
        if (this.activeSlots.size > 0) return false;

        // Group held tickets by required model
        const modelGroups = new Map<string, typeof this.holdQueue>();
        for (const held of this.holdQueue) {
            const group = modelGroups.get(held.requiredModel) || [];
            group.push(held);
            modelGroups.set(held.requiredModel, group);
        }

        // Pick the model with the most waiting tickets (efficient batch)
        let bestModel = '';
        let bestCount = 0;
        for (const [model, tickets] of modelGroups) {
            if (tickets.length > bestCount) {
                bestModel = model;
                bestCount = tickets.length;
            }
        }

        if (!bestModel || bestCount === 0) return false;

        // Check max models per cycle limit
        const maxModels = cfg.maxModelsPerCycle ?? 2;
        // Track swap count in audit log for this cycle
        const recentSwaps = this.database.getAuditLog(50)
            .filter(a => a.action === 'model_swap' &&
                a.created_at > new Date(Date.now() - 60 * 60 * 1000).toISOString())
            .length;

        if (recentSwaps >= maxModels) {
            this.outputChannel.appendLine(
                `[TicketProcessor] Model swap skipped — already swapped ${recentSwaps} times this cycle (limit: ${maxModels})`
            );
            return false;
        }

        // === TRIGGER MODEL SWAP ===
        this.outputChannel.appendLine(
            `[TicketProcessor] Model swap needed: ${bestCount} ticket(s) waiting for "${bestModel}"`
        );

        this.eventBus.emit('boss:model_swap', 'ticket-processor', {
            fromModel: cfg.activeModel || cfg.llm.model,
            toModel: bestModel,
            ticketCount: bestCount,
            reason: 'hold_queue_drain',
        });

        this.database.addAuditLog('boss-ai', 'model_swap',
            `Swap from "${cfg.activeModel || cfg.llm.model}" to "${bestModel}" — ${bestCount} held ticket(s) waiting`);

        // TODO: Actual LM Studio API calls when endpoints are confirmed:
        //   POST http://{endpoint}/v1/models/unload
        //   POST http://{endpoint}/v1/models/load { model: bestModel }
        //   For now, we update config.activeModel and release held tickets

        // Update active model in config
        this.config.updateConfig({ activeModel: bestModel });

        // Release held tickets for this model
        const released = this.releaseHeldTicketsForModel(bestModel);

        this.outputChannel.appendLine(
            `[TicketProcessor] Model swap complete: now using "${bestModel}", released ${released} ticket(s)`
        );

        return released > 0;
    }

    /**
     * v5.0: Interrupt mechanism — cancels countdown and starts Boss cycle immediately.
     * Called by event listeners when new work arrives (ticket:created, ticket:unblocked, etc.)
     */
    private kickBossCycle(): void {
        if (this.disposed) return;

        // v6.0: If all slots are full, no need to kick — fillSlots() runs after any slot completes
        if (this.activeSlots.size >= this.maxParallelTickets) return;

        // v5.0: If startup assessment is still running (LLM call in progress),
        // defer the kick — the assessment's .finally() will call bossCycle() afterward
        if (this.startupAssessmentRunning) {
            this.kickRequestedDuringStartup = true;
            this.outputChannel.appendLine(
                '[TicketProcessor] Boss kick deferred — startup assessment in progress'
            );
            return;
        }

        // Cancel countdown timer if running
        if (this.bossCycleTimer) {
            clearTimeout(this.bossCycleTimer);
            this.bossCycleTimer = null;
        }

        // Start the Boss cycle
        this.bossCycle();
    }

    /**
     * v5.0: 5-minute countdown timer — replaces resetIdleWatchdog().
     * When the timer fires, Boss cycle runs again to check for work.
     * Emits boss:countdown_tick for UI sync.
     */
    private startBossCountdown(): void {
        if (this.bossCycleTimer) {
            clearTimeout(this.bossCycleTimer);
            this.bossCycleTimer = null;
        }
        if (this.disposed) return;

        const cfg = this.config.getConfig();

        // v5.0: Respect bossAutoRunEnabled and manual AI mode
        if (cfg.bossAutoRunEnabled === false || cfg.aiMode === 'manual') {
            this.bossState = 'idle';
            this.outputChannel.appendLine(
                `[TicketProcessor] Boss countdown disabled (autoRun=${cfg.bossAutoRunEnabled}, aiMode=${cfg.aiMode})`
            );
            return;
        }

        this.bossState = 'waiting';
        const timeoutMs = (cfg.bossIdleTimeoutMinutes ?? 5) * 60 * 1000;
        this.nextBossCheckAt = Date.now() + timeoutMs;

        this.eventBus.emit('boss:countdown_tick', 'ticket-processor', {
            nextCheckAt: this.nextBossCheckAt,
            remainingMs: timeoutMs,
            bossState: 'waiting',
        });

        this.bossCycleTimer = setTimeout(async () => {
            if (this.disposed) return;

            this.outputChannel.appendLine('[TicketProcessor] Boss countdown fired — running idle check...');
            this.eventBus.emit('boss:idle_watchdog_triggered', 'ticket-processor', {
                lastActivityTimestamp: this.lastActivityTimestamp,
                idleMinutes: Math.round((Date.now() - this.lastActivityTimestamp) / 60000),
            });

            // Run Boss AI health check
            try {
                const boss = this.orchestrator.getBossAgent();
                const healthResponse = await boss.checkSystemHealth();
                const idleMinutes = Math.round((Date.now() - this.lastActivityTimestamp) / 60000);
                const queueLen = this.queue.length;
                const contextPrefix = `[idle=${idleMinutes}m, queue=${queueLen}] `;
                const responseText = healthResponse.content?.trim() || '(no LLM response)';
                this.outputChannel.appendLine(
                    `[TicketProcessor] Boss idle check result: ${responseText.substring(0, 200)}`
                );
                this.database.addAuditLog(
                    'boss-ai', 'idle_check',
                    contextPrefix + responseText.substring(0, 500 - contextPrefix.length)
                );

                // Execute any Boss actions (create tickets, escalate, etc.)
                await this.executeBossActions(healthResponse.actions || [], 'idle_check');
            } catch (err) {
                const errMsg = `Idle check failed: ${String(err).substring(0, 200)}`;
                this.outputChannel.appendLine(`[TicketProcessor] Boss idle check error (non-fatal): ${err}`);
                this.database.addAuditLog('boss-ai', 'idle_check_error', errMsg);
            }

            // Scan for stuck tickets and recover them (v5.0: all tickets, not just auto_created)
            const stuckTickets = this.database.getTicketsByStatus('in_review')
                .filter(t => t.processing_status === 'processing');

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
                    // v7.0: Route to team queue
                    const team = this.routeToTeamQueue(stuckTicket);
                    this.database.updateTicket(stuckTicket.id, { assigned_queue: team });
                    this.getTeamQueue(team).push({
                        ticketId: stuckTicket.id,
                        priority: stuckTicket.priority,
                        enqueuedAt: Date.now(),
                        operationType: stuckTicket.operation_type || 'unknown',
                        errorRetryCount: 0,
                    });
                    this.eventBus.emit('ticket:recovered', 'ticket-processor', {
                        ticketId: stuckTicket.id, ticketNumber: stuckTicket.ticket_number, team,
                    });
                }
                for (const q of this.teamQueues.values()) this.sortQueue(q);
            }

            // If tickets are now available, start the Boss cycle
            if (this.getTotalQueueSize() > 0 && this.activeSlots.size < this.maxParallelTickets) {
                this.bossCycle();
            } else {
                // Nothing to do — start another countdown
                this.startBossCountdown();
            }
        }, timeoutMs);
    }

    /**
     * Process a single ticket through the agent pipeline.
     * Returns true on success (resolved, held, or skipped), false on error (needs re-enqueue).
     *
     * v4.1: Each processing attempt creates a TicketRun log entry.
     * On retries, previous run logs are included in the agent prompt context.
     * v5.0: Renamed from processTicket → processTicketPipeline. Called by bossCycle().
     */
    private async processTicketPipeline(ticketId: string, queueEntry?: QueuedTicket): Promise<boolean> {
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
                // v7.0: Move to back of its team queue so other tickets can process
                if (queueEntry) {
                    const team = this.routeToTeamQueue(ticket);
                    const teamQueue = this.getTeamQueue(team);
                    const idx = teamQueue.indexOf(queueEntry);
                    if (idx >= 0) {
                        teamQueue.splice(idx, 1);
                        teamQueue.push(queueEntry);
                    }
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

        // v9.0: Track active tree node for lifecycle updates (declared before try so catch can access it)
        let activeTreeNodeId: string | null = null;

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

            // v5.0: Inject plan file context so agents can reference the source of truth
            // Resolve plan_id through the ticket's task association
            let ticketPlanId: string | null = null;
            if (ticket.task_id) {
                const task = this.database.getTask(ticket.task_id);
                if (task?.plan_id) ticketPlanId = task.plan_id;
            }
            if (ticketPlanId) {
                const planFileCtx = this.database.getPlanFileContext(ticketPlanId);
                if (planFileCtx) {
                    agentMessage += `\n\n=== PLAN REFERENCE DOCUMENTS (Source of Truth) ===\n` +
                        `The following reference documents define the project requirements and constraints.\n` +
                        `Your work MUST align with these documents. If this ticket's request conflicts with any reference document,\n` +
                        `flag the conflict in your response and suggest how to resolve it.\n\n` +
                        planFileCtx +
                        `\n=== END PLAN REFERENCE DOCUMENTS ===`;
                }
            }

            // v7.0: Inject relevant support documents into agent context
            if (this.documentManager) {
                try {
                    const relevantDocs = this.documentManager.gatherContextDocs(ticket);
                    if (relevantDocs.length > 0) {
                        const docContext = this.documentManager.formatContextDocs(relevantDocs);
                        agentMessage += `\n\n${docContext}`;
                        this.outputChannel.appendLine(
                            `[TicketProcessor] Injected ${relevantDocs.length} support doc(s) into TK-${ticket.ticket_number} context`
                        );
                    }
                } catch (error) {
                    this.outputChannel.appendLine(
                        `[TicketProcessor] Support document injection failed (non-fatal): ${error}`
                    );
                }
            }

            // v9.0: Activate matching tree node for live status tracking
            // Use the primary specialist agent (skip orchestrator wrap steps) for a better tree match.
            // Also activate ancestor nodes (WaitingChild) so the full branch lights up in the webapp.
            if (this.agentTreeMgr) {
                try {
                    // Find the primary specialist agent (not orchestrator wrap)
                    const specialistStep = pipeline.steps.find(s => s.agentName !== 'orchestrator') || pipeline.steps[0];
                    const primaryAgent = specialistStep?.agentName;
                    if (primaryAgent) {
                        const treeNode = this.database.findTreeNodeForAgent(primaryAgent, {
                            title: ticket.title,
                            operation_type: ticket.operation_type,
                            body: ticket.body,
                        });
                        if (treeNode) {
                            activeTreeNodeId = treeNode.id;
                            this.agentTreeMgr.activateNode(treeNode.id);
                            this.outputChannel.appendLine(
                                `[TicketProcessor] Tree node activated: ${treeNode.name} (L${treeNode.level}) for agent '${primaryAgent}' on TK-${ticket.ticket_number}`
                            );

                            // Light up ancestor chain — mark parents as WaitingChild
                            // so the webapp shows the full active branch from root to leaf
                            try {
                                const ancestors = this.database.getTreeAncestors(treeNode.id);
                                for (const ancestor of ancestors) {
                                    if (ancestor.status === 'idle') {
                                        this.agentTreeMgr.waitForChildren(ancestor.id);
                                    }
                                }
                                if (ancestors.length > 0) {
                                    this.outputChannel.appendLine(
                                        `[TicketProcessor] Ancestor chain activated: ${ancestors.map(a => a.name).join(' → ')}`
                                    );
                                }
                            } catch { /* non-fatal — ancestor chain is cosmetic */ }
                        } else {
                            this.outputChannel.appendLine(
                                `[TicketProcessor] No tree node found for agent '${primaryAgent}' — tree won't update for TK-${ticket.ticket_number}`
                            );
                        }
                    }
                } catch (treeErr) {
                    this.outputChannel.appendLine(`[TicketProcessor] Tree node activation failed (non-fatal): ${treeErr}`);
                }
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
                    `[TicketProcessor] TK-${ticket.ticket_number} step ${stepIdx + 1}: ${step.agentName} (${step.deliverableType})`
                );

                // v5.0: Create a run step entry BEFORE the agent call
                const stepStart = Date.now();
                const runStep = this.database.createRunStep({
                    run_id: run.id,
                    step_number: stepIdx + 1,
                    agent_name: step.agentName,
                    deliverable_type: step.deliverableType,
                });

                // Call the agent with pipeline context
                response = await this.orchestrator.callAgent(step.agentName, stepMessage, context);

                // v5.0: Complete the run step entry
                this.database.completeRunStep(runStep.id, {
                    status: 'completed',
                    response: response.content.substring(0, 2000),
                    tokens_used: response.tokensUsed ?? undefined,
                    duration_ms: Date.now() - stepStart,
                });

                // v5.0: Modular reply label — just the agent name, no hardcoded step counts
                this.database.addTicketReply(ticketId, step.agentName, response.content);
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

            // v7.0 Phase 3: Handle escalation/support actions from pipeline agents
            if (response.actions && response.actions.length > 0) {
                for (const action of response.actions) {
                    if (action.type === 'escalate_to_boss' || action.type === 'call_support_agent' ||
                        action.type === 'block_ticket' || action.type === 'save_document') {
                        // Process these actions through the boss action handler
                        await this.executeBossActions([action], 'pipeline-agent');
                    }
                }

                // If escalation was requested, mark run as escalated and skip review
                const hasEscalation = response.actions.some(a => a.type === 'escalate_to_boss');
                if (hasEscalation) {
                    this.database.completeTicketRun(run.id, {
                        status: 'failed',
                        response_received: response.content,
                        error_message: 'Escalated to Boss AI',
                        tokens_used: response.tokensUsed ?? undefined,
                        duration_ms: Date.now() - startTime,
                    });
                    this.eventBus.emit('ticket:escalated', 'ticket-processor', {
                        ticketId, reason: 'Agent requested escalation',
                    });
                    return true; // Escalation handled — exit pipeline
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
                    // v5.0: Create a run step for the review agent
                    const reviewStepStart = Date.now();
                    const reviewStep = this.database.createRunStep({
                        run_id: run.id,
                        step_number: pipeline.steps.length + 1,
                        agent_name: 'review',
                        deliverable_type: 'review',
                    });

                    const reviewResponse = await this.orchestrator.getReviewAgent().reviewTicket(
                        ticket, response.content
                    );
                    this.database.addTicketReply(ticketId, 'review', reviewResponse.content);

                    // v5.0: Complete review step
                    this.database.completeRunStep(reviewStep.id, {
                        status: reviewResponse.actions?.some((a: AgentAction) => a.type === 'escalate') ? 'review_flagged' : 'completed',
                        response: reviewResponse.content.substring(0, 2000),
                        duration_ms: Date.now() - reviewStepStart,
                    });
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

                        // v4.1 / v5.0: Create AI feedback question with DETAILED info so user sees it in the queue
                        try {
                            const planId = this.findPlanIdForTicket(ticket);
                            if (planId) {
                                // Extract detailed review data from escalation payload
                                const escalateAction = reviewResponse.actions?.find(
                                    (a: AgentAction) => a.type === 'escalate'
                                );
                                const reviewPayload = escalateAction?.payload ?? {};
                                const issues = (reviewPayload.issues as string[]) || [];
                                const suggestions = (reviewPayload.suggestions as string[]) || [];
                                const scores = reviewPayload.scores as Record<string, number> | undefined;
                                const reason = (reviewPayload.reason as string) || reviewResponse.content;

                                // Build detailed review breakdown
                                let detailedReview = `AI Review for TK-${ticket.ticket_number}: "${ticket.title}"\n`;
                                detailedReview += `\nVerdict: ${reason}\n`;
                                if (scores) {
                                    detailedReview += `\nScores:`;
                                    for (const [key, val] of Object.entries(scores)) {
                                        detailedReview += `\n  • ${key}: ${val}/100`;
                                    }
                                }
                                if (issues.length > 0) {
                                    detailedReview += `\n\nIssues Found (${issues.length}):`;
                                    issues.forEach((iss, idx) => { detailedReview += `\n  ${idx + 1}. ${iss}`; });
                                }
                                if (suggestions.length > 0) {
                                    detailedReview += `\n\nAI Suggestions:`;
                                    suggestions.forEach((s, idx) => { detailedReview += `\n  ${idx + 1}. ${s}`; });
                                }
                                detailedReview += `\n\nOriginal Deliverable Preview:\n${response.content.substring(0, 400)}${response.content.length > 400 ? '...' : ''}`;

                                // Build a human-friendly recommendation
                                const recommendation = suggestions.length > 0
                                    ? `Consider addressing: ${suggestions.slice(0, 2).join('; ')}. Then approve or request reprocessing.`
                                    : issues.length > 0
                                        ? `Review the ${issues.length} issue(s) above. Approve if acceptable, or note changes needed.`
                                        : 'Review the deliverable and approve if it meets your standards.';

                                const rawQuestion = detailedReview;
                                const createdQ = this.database.createAIQuestion({
                                    plan_id: planId,
                                    component_id: null,
                                    page_id: null,
                                    category: 'general' as any,
                                    question: rawQuestion,
                                    question_type: 'confirm' as any,
                                    options: ['Approve — looks good', 'Needs changes — reprocess', 'Skip this ticket'],
                                    ai_reasoning: detailedReview,
                                    ai_suggested_answer: recommendation,
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
                // v9.0: Complete tree node on successful resolution
                if (this.agentTreeMgr && activeTreeNodeId) {
                    try { this.agentTreeMgr.completeNode(activeTreeNodeId, `Resolved TK-${ticket.ticket_number}`); }
                    catch (treeErr) { /* non-fatal */ }
                }
                this.outputChannel.appendLine(`[TicketProcessor] TK-${ticket.ticket_number} resolved (verified)`);

                // v4.1: Unblock any tickets that were blocked by this resolved ticket
                this.unblockDependentTickets(ticketId, ticket.ticket_number);

                // v4.3: Auto-enqueue child/sub-tickets when parent resolves
                this.enqueueChildTickets(ticketId, ticket.ticket_number);
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
            // v9.0: Fail tree node on error
            if (this.agentTreeMgr && activeTreeNodeId) {
                try { this.agentTreeMgr.failNode(activeTreeNodeId, msg.substring(0, 200)); }
                catch (treeErr) { /* non-fatal */ }
            }

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

                // v7.0: Remove from team queue if still present, then re-add
                this.removeFromTeamQueues(ticketId);

                // Push new entry with incremented retry count to team queue
                const team = this.routeToTeamQueue(ticket);
                this.getTeamQueue(team).push({
                    ticketId: ticket.id,
                    priority: ticket.priority,
                    enqueuedAt: Date.now(),
                    operationType: ticket.operation_type || 'unknown',
                    errorRetryCount: currentErrorRetry + 1,
                });
                this.sortQueue(this.getTeamQueue(team));

                this.eventBus.emit('ticket:requeued', 'ticket-processor', {
                    ticketId, attempt: currentErrorRetry + 1, reason: 'agent_error', team,
                });
            } else {
                // Max error retries exceeded: escalate
                this.outputChannel.appendLine(
                    `[TicketProcessor] TK-${ticket.ticket_number} max error retries (${maxErrorRetries}) exceeded, escalating`
                );

                // v7.0: Remove from team queue
                this.removeFromTeamQueues(ticketId);

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
     * v4.3: When a parent ticket resolves, find its child/sub-tickets and enqueue
     * any that are still open. This ensures sub-tickets get processed after their
     * parent completes, instead of the system reprocessing the same parent tickets.
     */
    private enqueueChildTickets(parentTicketId: string, parentTicketNumber: number): void {
        try {
            const children = this.database.getChildTickets(parentTicketId);
            if (children.length === 0) return;

            let enqueued = 0;
            for (const child of children) {
                // v5.0: Enqueue all open children (user + auto-created) that aren't already queued
                if (child.status !== TicketStatus.Open) continue;
                if (child.processing_status === 'queued' || child.processing_status === 'processing') continue;

                // Check it isn't already in our in-memory queue
                if (this.isInAnyQueue(child.id)) continue;

                const aiLevel = this.getAILevel(child);
                if (aiLevel === 'manual') continue;

                // v7.0: Route to team queue
                const team = this.routeToTeamQueue(child);
                this.database.updateTicket(child.id, { processing_status: 'queued', assigned_queue: team });
                this.database.addTicketReply(child.id, 'system',
                    `Parent ticket TK-${parentTicketNumber} resolved — this sub-ticket is now ready for processing.`);

                const entry: QueuedTicket = {
                    ticketId: child.id,
                    priority: child.priority,
                    enqueuedAt: Date.now(),
                    operationType: child.operation_type || 'unknown',
                    errorRetryCount: 0,
                };

                this.getTeamQueue(team).push(entry);
                enqueued++;
                this.outputChannel.appendLine(
                    `[TicketProcessor] Sub-ticket TK-${child.ticket_number} enqueued → ${team} (parent TK-${parentTicketNumber} resolved)`
                );
            }

            if (enqueued > 0) {
                for (const q of this.teamQueues.values()) this.sortQueue(q);
                this.outputChannel.appendLine(
                    `[TicketProcessor] ${enqueued} sub-ticket(s) of TK-${parentTicketNumber} enqueued for processing`
                );
            }
        } catch (err) {
            this.outputChannel.appendLine(`[TicketProcessor] Error enqueuing child tickets: ${err}`);
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

            // v7.0: Re-enqueue into team queue
            const team = this.routeToTeamQueue(ticket);
            this.database.updateTicket(ticket.id, { processing_status: 'queued', assigned_queue: team });

            this.getTeamQueue(team).push({
                ticketId: ticket.id,
                priority: ticket.priority,
                enqueuedAt: Date.now(),
                operationType: ticket.operation_type || 'unknown',
                errorRetryCount: 0,
            });
            this.sortQueue(this.getTeamQueue(team));
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
        // v7.0: Find a P3 ticket in any team queue to bump
        for (const [, teamQueue] of this.teamQueues) {
            const p3Index = teamQueue.findIndex(q => q.priority === TicketPriority.P3);
            if (p3Index >= 0) {
                const bumped = teamQueue.splice(p3Index, 1)[0];
                this.database.updateTicket(bumped.ticketId, { processing_status: null as any });
                this.outputChannel.appendLine(`[TicketProcessor] Bumped P3 ticket ${bumped.ticketId} for P1 priority`);
                return true;
            }
        }
        return false;
    }

    /**
     * Sort queue by: blocked last → priority (P1 first) → enqueue time.
     * Blocked tickets always sort behind unblocked tickets regardless of priority,
     * preventing the pick-blocked-defer-resort loop.
     */
    private sortQueue(queue: QueuedTicket[]): void {
        // Build a set of blocked ticket IDs for O(1) lookup
        const blockedIds = new Set<string>();
        for (const entry of queue) {
            const ticket = this.database.getTicket(entry.ticketId);
            if (ticket?.blocking_ticket_id) {
                const blocker = this.database.getTicket(ticket.blocking_ticket_id);
                if (blocker && blocker.status !== TicketStatus.Resolved) {
                    blockedIds.add(entry.ticketId);
                }
            }
        }

        const prioOrder: Record<string, number> = { P1: 0, P2: 1, P3: 2 };
        queue.sort((a, b) => {
            // Blocked tickets always sort after unblocked ones
            const aBlocked = blockedIds.has(a.ticketId) ? 1 : 0;
            const bBlocked = blockedIds.has(b.ticketId) ? 1 : 0;
            if (aBlocked !== bBlocked) return aBlocked - bBlocked;

            // Within same blocked/unblocked group: priority then FIFO
            // v5.0 fix: Unknown priorities default to 3 (lowest), not 1 (P2)
            const pa = prioOrder[a.priority] ?? 3;
            const pb = prioOrder[b.priority] ?? 3;
            if (pa !== pb) return pa - pb;
            return a.enqueuedAt - b.enqueuedAt;
        });
    }

    // v5.0: resetIdleWatchdog() replaced by startBossCountdown() above.

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

            const startupText = healthResponse.content?.trim() || '(no LLM response)';
            this.outputChannel.appendLine(
                `[TicketProcessor] Boss startup assessment: ${startupText.substring(0, 200)}...`
            );

            // Execute Boss AI's actions (create tickets, escalate, dispatch agents, etc.)
            const actionsExecuted = await this.executeBossActions(healthResponse.actions || [], 'startup');

            // Log the assessment
            this.database.addAuditLog('boss-ai', 'startup_assessment',
                `${startupText.substring(0, 800)}\n\nActions executed: ${actionsExecuted}`
            );

            this.eventBus.emit('boss:startup_assessment_completed', 'ticket-processor', {
                summary: healthResponse.content.substring(0, 500),
                actionsExecuted,
            });

            // v5.0: After assessment, bossCycle() will be called by start() — no need to kick here
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
                queueSize: this.queue.length,
            });

            const boss = this.orchestrator.getBossAgent();
            const healthResponse = await boss.checkSystemHealth();

            // Parse Boss response to check for critical issues
            const content = (healthResponse.content || '').toLowerCase();
            const isCritical = content.includes('escalate: true') || content.includes('status: critical');

            // Execute Boss AI's actions — create tickets, escalate, dispatch agents, recover, etc.
            const actionsExecuted = await this.executeBossActions(healthResponse.actions || [], 'inter_ticket');

            if (isCritical) {
                this.outputChannel.appendLine(
                    `[TicketProcessor] Boss inter-ticket: CRITICAL issues detected`
                );
                this.database.addAuditLog('boss-ai', 'inter_ticket_critical',
                    `${(healthResponse.content || '(no response)').substring(0, 800)}\nActions executed: ${actionsExecuted}`
                );
            } else {
                // Always log inter-ticket assessment for audit trail
                const interText = (healthResponse.content || '(no response)').trim();
                this.database.addAuditLog('boss-ai', 'inter_ticket_check',
                    `[queue=${this.getTotalQueueSize()}] ${interText.substring(0, 300)}${actionsExecuted > 0 ? ` | Actions: ${actionsExecuted}` : ''}`
                );
            }

            // Re-sort all team queues in case priorities changed or new tickets were added
            for (const q of this.teamQueues.values()) this.sortQueue(q);

            // v7.0: LLM-driven intelligent ticket selection across all team queues
            const allQueued = this.queue; // flat snapshot for candidate building
            if (allQueued.length > 1 && boss.selectNextTicket) {
                try {
                    // Build candidate list from top 10 tickets across all queues
                    const candidateEntries = allQueued.slice(0, 10);
                    const candidates = candidateEntries.map(entry => {
                        const ticket = this.database.getTicket(entry.ticketId);
                        return {
                            ticketId: entry.ticketId,
                            ticketNumber: ticket?.ticket_number ?? 0,
                            title: ticket?.title ?? 'Unknown',
                            priority: entry.priority,
                            operationType: entry.operationType,
                            body: ticket?.body ?? '',
                            blockingTicketId: ticket?.blocking_ticket_id ?? null,
                            deliverableType: ticket?.deliverable_type ?? 'unknown',
                            retryCount: entry.errorRetryCount,
                            lastError: ticket?.last_error ?? null,
                            createdAt: ticket?.created_at ?? new Date().toISOString(),
                        };
                    }).filter(c => c.ticketNumber > 0);

                    if (candidates.length > 1) {
                        const selectedId = await boss.selectNextTicket(candidates);
                        if (selectedId) {
                            // v7.0: Move selected ticket to front of its team queue
                            for (const [team, teamQueue] of this.teamQueues) {
                                const idx = teamQueue.findIndex(q => q.ticketId === selectedId);
                                if (idx > 0) {
                                    const [selected] = teamQueue.splice(idx, 1);
                                    teamQueue.unshift(selected);
                                    const selectedTicket = this.database.getTicket(selectedId);
                                    this.outputChannel.appendLine(
                                        `[TicketProcessor] Boss AI selected TK-${selectedTicket?.ticket_number} "${selectedTicket?.title}" — moved to front of ${team} queue`
                                    );
                                    this.database.addAuditLog('boss-ai', 'intelligent_selection',
                                        `Selected TK-${selectedTicket?.ticket_number} from ${candidates.length} candidates. Moved to front of ${team} queue.`
                                    );
                                    break;
                                }
                            }
                        }
                    }
                } catch (selErr) {
                    // LLM selection failure is non-fatal — deterministic order stands
                    this.outputChannel.appendLine(
                        `[TicketProcessor] Boss AI ticket selection failed (using deterministic order): ${selErr}`
                    );
                }
            }

            // Also parse NEXT_TICKET from health check response as secondary signal
            const nextTicketMatch = (healthResponse.content || '').match(/NEXT_TICKET:\s*(?:TK-)?(\d+|[0-9a-f-]{36})/i);
            if (nextTicketMatch && this.getTotalQueueSize() > 1) {
                const nextVal = nextTicketMatch[1];
                // v7.0: Find in team queues and move to front
                for (const [, teamQueue] of this.teamQueues) {
                    const matchIdx = teamQueue.findIndex(q => {
                        const t = this.database.getTicket(q.ticketId);
                        return t?.ticket_number?.toString() === nextVal || q.ticketId === nextVal;
                    });
                    if (matchIdx > 0) {
                        const [picked] = teamQueue.splice(matchIdx, 1);
                        teamQueue.unshift(picked);
                        const pickedTicket = this.database.getTicket(picked.ticketId);
                        this.outputChannel.appendLine(
                            `[TicketProcessor] Boss health-check NEXT_TICKET signal: TK-${pickedTicket?.ticket_number} moved to front`
                        );
                        break;
                    }
                }
            }

            this.eventBus.emit('boss:inter_ticket_completed', 'ticket-processor', {
                queueSize: this.getTotalQueueSize(),
                critical: isCritical,
                actionsExecuted,
                summary: healthResponse.content.substring(0, 200),
                teamQueues: this.getTeamQueueStatus(),
            });

            // Emit which ticket was picked next (first processable across all teams)
            const nextProcessable = this.peekNextProcessable();
            if (nextProcessable) {
                const nextTicket = this.database.getTicket(nextProcessable.entry.ticketId);
                this.eventBus.emit('boss:picked_next_ticket', 'ticket-processor', {
                    ticketId: nextProcessable.entry.ticketId,
                    ticketNumber: nextTicket?.ticket_number,
                    title: nextTicket?.title,
                    priority: nextProcessable.entry.priority,
                    team: nextProcessable.team,
                });
                this.outputChannel.appendLine(
                    `[TicketProcessor] Boss picked next ticket: TK-${nextTicket?.ticket_number} "${nextTicket?.title}" [${nextProcessable.team}]`
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
    private async executeBossActions(actions: Array<{ type: string; payload: Record<string, unknown> }>, trigger: string): Promise<number> {
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

                    // ==================== v6.0: NEW BOSS ACTIONS ====================

                    case 'dispatch_agent': {
                        const agentName = (action.payload.agent as string) || '';
                        const message = (action.payload.message as string) || '';
                        const targetTicketId = action.payload.ticket_id as string | undefined;

                        if (!agentName || !message) {
                            this.outputChannel.appendLine('[TicketProcessor] Boss dispatch_agent: missing agent or message');
                            break;
                        }

                        // Always create a lightweight tracking ticket for audit trail
                        const trackingTicket = this.database.createTicket({
                            title: `Boss dispatch: ${agentName} — ${message.substring(0, 60)}`,
                            body: `Boss AI directly dispatched agent "${agentName}" during ${trigger}.\n\n${message}`,
                            priority: TicketPriority.P2,
                            creator: 'boss-ai',
                            auto_created: true,
                            operation_type: 'boss_directive',
                        });

                        this.outputChannel.appendLine(
                            `[TicketProcessor] Boss dispatching agent "${agentName}" (tracking TK-${trackingTicket.ticket_number})`
                        );
                        this.eventBus.emit('boss:dispatch_agent', 'ticket-processor', {
                            agentName, targetTicketId, trackingTicketId: trackingTicket.id,
                        });

                        try {
                            const agentContext = {
                                conversationHistory: [] as any[],
                                ticket: targetTicketId ? this.database.getTicket(targetTicketId) ?? undefined : undefined,
                            };
                            const response = await this.orchestrator.callAgent(agentName, message, agentContext);

                            // Update tracking ticket with result
                            this.database.updateTicket(trackingTicket.id, {
                                status: TicketStatus.Resolved,
                                processing_status: null,
                            });
                            // Store result as a ticket reply for audit trail
                            this.database.addTicketReply(trackingTicket.id, agentName,
                                response.content?.substring(0, 2000) || '(no content)');

                            // If tied to an existing ticket, update that too
                            if (targetTicketId) {
                                const targetTicket = this.database.getTicket(targetTicketId);
                                if (targetTicket) {
                                    this.database.addTicketReply(targetTicketId, 'boss-ai',
                                        `Agent "${agentName}" dispatched by Boss AI:\n${response.content?.substring(0, 1000) || '(no content)'}`);
                                }
                            }

                            this.database.addAuditLog('boss-ai', 'dispatch_agent',
                                `Dispatched ${agentName}: ${response.content?.substring(0, 200) || '(no content)'}`);
                        } catch (dispatchErr) {
                            this.outputChannel.appendLine(`[TicketProcessor] Boss dispatch error: ${dispatchErr}`);
                            this.database.updateTicket(trackingTicket.id, {
                                status: TicketStatus.Escalated,
                                processing_status: null,
                            });
                            this.database.addAuditLog('boss-ai', 'dispatch_agent_error',
                                `Failed to dispatch ${agentName}: ${String(dispatchErr).substring(0, 200)}`);
                        }

                        executed++;
                        break;
                    }

                    case 'reprioritize': {
                        const repTicketId = action.payload.ticket_id as string;
                        const newPriority = action.payload.priority as string;

                        if (!repTicketId || !newPriority) {
                            this.outputChannel.appendLine('[TicketProcessor] Boss reprioritize: missing ticket_id or priority');
                            break;
                        }

                        this.database.updateTicket(repTicketId, { priority: newPriority as TicketPriority });
                        // v7.0: Update the queue entry in its team queue
                        for (const [, teamQueue] of this.teamQueues) {
                            const qe = teamQueue.find(q => q.ticketId === repTicketId);
                            if (qe) {
                                qe.priority = newPriority;
                                this.sortQueue(teamQueue);
                                break;
                            }
                        }

                        this.outputChannel.appendLine(
                            `[TicketProcessor] Boss reprioritized ticket ${repTicketId} → ${newPriority}`
                        );
                        this.database.addAuditLog('boss-ai', 'reprioritize',
                            `Changed priority of ${repTicketId} to ${newPriority}`);
                        this.eventBus.emit('ticket:priority_changed', 'boss-ai', {
                            ticketId: repTicketId, priority: newPriority,
                        });
                        executed++;
                        break;
                    }

                    case 'reorder_queue': {
                        const reorderTicketId = action.payload.ticket_id as string;
                        const position = action.payload.position as 'front' | 'back';

                        if (!reorderTicketId || !position) {
                            this.outputChannel.appendLine('[TicketProcessor] Boss reorder_queue: missing ticket_id or position');
                            break;
                        }

                        // v7.0: Find in team queues and reorder within that team
                        for (const [team, teamQueue] of this.teamQueues) {
                            const idx = teamQueue.findIndex(q => q.ticketId === reorderTicketId);
                            if (idx >= 0) {
                                const [moved] = teamQueue.splice(idx, 1);
                                if (position === 'front') {
                                    teamQueue.unshift(moved);
                                } else {
                                    teamQueue.push(moved);
                                }
                                this.outputChannel.appendLine(
                                    `[TicketProcessor] Boss moved ticket ${reorderTicketId} to ${position} of ${team} queue`
                                );
                                this.database.addAuditLog('boss-ai', 'reorder_queue',
                                    `Moved ${reorderTicketId} to ${position} of ${team}`);
                                break;
                            }
                        }
                        executed++;
                        break;
                    }

                    case 'hold_ticket': {
                        const holdTicketId = action.payload.ticket_id as string;
                        const requiredModel = action.payload.required_model as string;
                        const holdTimeoutMs = (action.payload.timeout_ms as number) ||
                            (this.config.getConfig().modelHoldTimeoutMs ?? 3600000);

                        if (!holdTicketId) {
                            this.outputChannel.appendLine('[TicketProcessor] Boss hold_ticket: missing ticket_id');
                            break;
                        }

                        // v7.0: Remove from team queue
                        const holdRemoved = this.removeFromTeamQueues(holdTicketId);
                        if (holdRemoved) {
                            this.holdQueue.push({
                                ticketId: holdTicketId,
                                requiredModel: requiredModel || 'unknown',
                                heldAt: Date.now(),
                                timeoutMs: holdTimeoutMs,
                                queueEntry: holdRemoved.entry,
                                team: holdRemoved.team,
                            });
                            this.outputChannel.appendLine(
                                `[TicketProcessor] Boss held ticket ${holdTicketId} — waiting for model "${requiredModel}"`
                            );
                            this.eventBus.emit('boss:ticket_held', 'ticket-processor', {
                                ticketId: holdTicketId, requiredModel,
                            });
                            this.database.addAuditLog('boss-ai', 'hold_ticket',
                                `Held ${holdTicketId} for model ${requiredModel}`);
                        }
                        executed++;
                        break;
                    }

                    case 'update_notepad': {
                        const notepadContent = (action.payload.content as string) || '';
                        const notepadMode = (action.payload.mode as string) || 'replace';
                        const notepadSection = (action.payload.section as string) || 'general';

                        // v7.0: Use proper boss_notepad table
                        if (notepadMode === 'append') {
                            const existing = this.database.getBossNotepadSection(notepadSection);
                            this.database.updateBossNotepadSection(notepadSection,
                                (existing || '') + '\n' + notepadContent);
                        } else {
                            this.database.updateBossNotepadSection(notepadSection, notepadContent);
                        }

                        this.outputChannel.appendLine(
                            `[TicketProcessor] Boss notepad [${notepadSection}] updated (${notepadMode}): ${notepadContent.substring(0, 100)}`
                        );
                        this.eventBus.emit('boss:notepad_updated', 'ticket-processor', {
                            mode: notepadMode, section: notepadSection, contentLength: notepadContent.length,
                        });
                        executed++;
                        break;
                    }

                    // ==================== v7.0: TEAM QUEUE ACTIONS ====================

                    case 'cancel_ticket': {
                        const cancelTicketId = (action.payload.ticket_id as string) || '';
                        const cancelReason = (action.payload.reason as string) || 'Boss AI decision';

                        if (!cancelTicketId) {
                            this.outputChannel.appendLine('[TicketProcessor] Boss cancel_ticket: missing ticket_id');
                            break;
                        }

                        this.cancelTicket(cancelTicketId, cancelReason);
                        executed++;
                        break;
                    }

                    case 'move_to_queue': {
                        const moveTicketId = (action.payload.ticket_id as string) || '';
                        const targetQueue = (action.payload.target_queue as string) || '';

                        if (!moveTicketId || !targetQueue) {
                            this.outputChannel.appendLine('[TicketProcessor] Boss move_to_queue: missing ticket_id or target_queue');
                            break;
                        }

                        const validQueues = Object.values(LeadAgentQueue) as string[];
                        if (!validQueues.includes(targetQueue)) {
                            this.outputChannel.appendLine(`[TicketProcessor] Boss move_to_queue: invalid target_queue "${targetQueue}"`);
                            break;
                        }

                        this.moveTicketToQueue(moveTicketId, targetQueue as LeadAgentQueue);
                        executed++;
                        break;
                    }

                    case 'update_slot_allocation': {
                        const allocation = action.payload as Record<string, unknown>;
                        const parsed: Record<string, number> = {};
                        for (const [key, val] of Object.entries(allocation)) {
                            if (typeof val === 'number' && Object.values(LeadAgentQueue).includes(key as LeadAgentQueue)) {
                                parsed[key] = val;
                            }
                        }

                        if (Object.keys(parsed).length > 0) {
                            this.updateSlotAllocation(parsed);
                        } else {
                            this.outputChannel.appendLine('[TicketProcessor] Boss update_slot_allocation: no valid allocations');
                        }
                        executed++;
                        break;
                    }

                    // v7.0 Phase 3: Structured task assignment with success criteria
                    case 'assign_task': {
                        const payload = action.payload as Record<string, unknown>;
                        const targetAgent = payload.target_agent as string;
                        const taskMessage = payload.task_message as string;
                        const successCriteria = (payload.success_criteria as Array<{ criterion: string; verification_method: string; required: boolean }>) || [];
                        const priority = (payload.priority as string) || 'P2';
                        const sourceTicketId = payload.source_ticket_id as string | undefined;
                        const targetQueue = payload.target_queue as LeadAgentQueue | undefined;
                        const timeoutMs = (payload.timeout_ms as number) || 300000;

                        if (!targetAgent || !taskMessage) {
                            this.outputChannel.appendLine('[TicketProcessor] assign_task: missing target_agent or task_message');
                            break;
                        }

                        // Create assignment record
                        const assignmentRecord = this.database.createTaskAssignment?.({
                            source_ticket_id: sourceTicketId || null,
                            target_agent: targetAgent,
                            target_queue: targetQueue || null,
                            requester: trigger,
                            task_message: taskMessage,
                            success_criteria: JSON.stringify(successCriteria),
                            priority,
                            timeout_ms: timeoutMs,
                        });
                        const assignmentId = assignmentRecord?.id || `asgn-${Date.now()}`;

                        this.eventBus.emit('boss:assignment_created', 'ticket-processor', {
                            assignmentId, targetAgent, sourceTicketId, targetQueue,
                        });

                        this.outputChannel.appendLine(
                            `[TicketProcessor] Assignment ${assignmentId} created: ${targetAgent} ← ${taskMessage.substring(0, 80)}`
                        );

                        // Execute the assignment: call the agent synchronously
                        const startTime = Date.now();
                        try {
                            const agentCtx: AgentContext = {
                                conversationHistory: [],
                                ticket: sourceTicketId ? this.database.getTicket(sourceTicketId) ?? undefined : undefined,
                            };

                            // Use a timeout-guarded call
                            const agentResponse = await Promise.race([
                                this.orchestrator.callAgent(targetAgent, taskMessage, agentCtx),
                                new Promise<never>((_, reject) =>
                                    setTimeout(() => reject(new Error('Assignment timeout')), timeoutMs)
                                ),
                            ]);

                            const durationMs = Date.now() - startTime;
                            const criteriaResults = this.evaluateAssignmentCriteria(
                                successCriteria,
                                agentResponse,
                                sourceTicketId
                            );
                            const allRequiredPassed = criteriaResults
                                .filter(cr => cr.required)
                                .every(cr => cr.passed);
                            const status = allRequiredPassed ? 'completed' : 'partial';

                            this.database.updateTaskAssignment?.(assignmentId, {
                                status,
                                agent_response: agentResponse.content?.substring(0, 5000) || '',
                                criteria_results: JSON.stringify(criteriaResults),
                                duration_ms: durationMs,
                                completed_at: new Date().toISOString(),
                            });

                            this.eventBus.emit(
                                allRequiredPassed ? 'boss:assignment_completed' : 'boss:assignment_partial',
                                'ticket-processor',
                                { assignmentId, status, durationMs, criteriaResults }
                            );

                            this.outputChannel.appendLine(
                                `[TicketProcessor] Assignment ${assignmentId} ${status} in ${durationMs}ms`
                            );
                        } catch (err) {
                            const durationMs = Date.now() - startTime;
                            this.database.updateTaskAssignment?.(assignmentId, {
                                status: 'failed',
                                agent_response: err instanceof Error ? err.message : String(err),
                                duration_ms: durationMs,
                                completed_at: new Date().toISOString(),
                                escalation_reason: 'Assignment failed: ' + (err instanceof Error ? err.message : String(err)),
                            });

                            this.eventBus.emit('boss:assignment_failed', 'ticket-processor', {
                                assignmentId, error: err instanceof Error ? err.message : String(err), durationMs,
                            });

                            this.outputChannel.appendLine(
                                `[TicketProcessor] Assignment ${assignmentId} failed: ${err}`
                            );
                        }

                        executed++;
                        break;
                    }

                    // v7.0 Phase 3: Escalate ticket back to Boss from a lead agent
                    case 'escalate_to_boss': {
                        const payload = action.payload as Record<string, unknown>;
                        const ticketId = payload.ticket_id as string;
                        const reason = payload.reason as string || 'Lead agent escalation';
                        const recommendedTarget = payload.recommended_target as LeadAgentQueue | null;
                        const blockingInfoNeeded = payload.blocking_info_needed as string | undefined;

                        if (ticketId) {
                            const ticket = this.database.getTicket(ticketId);
                            if (ticket) {
                                // Mark as blocked
                                this.database.updateTicket(ticketId, {
                                    status: TicketStatus.Blocked,
                                    processing_status: null,
                                    processing_agent: null,
                                });
                                this.database.addTicketReply(ticketId, 'lead-agent', `Escalated to Boss: ${reason}`);

                                // Create boss directive ticket pointing to the blocker
                                const bossDirective = this.database.createTicket({
                                    title: `[Boss] Escalation: ${reason.substring(0, 80)}`,
                                    body: `Escalated from ticket ${ticket.ticket_number}: ${ticket.title}\n\nReason: ${reason}${blockingInfoNeeded ? `\n\nBlocking info needed: ${blockingInfoNeeded}` : ''}${recommendedTarget ? `\n\nRecommended target queue: ${recommendedTarget}` : ''}`,
                                    priority: ticket.priority as TicketPriority || TicketPriority.P2,
                                    operation_type: 'boss_directive',
                                    auto_created: true,
                                    parent_ticket_id: ticketId,
                                });

                                this.eventBus.emit('queue:escalation_received', 'ticket-processor', {
                                    ticketId, reason, recommendedTarget, bossDirectiveId: bossDirective.id,
                                });

                                this.outputChannel.appendLine(
                                    `[TicketProcessor] Escalation: ticket ${ticket.ticket_number} → Boss (${reason.substring(0, 60)})`
                                );
                            }
                        }
                        executed++;
                        break;
                    }

                    // v7.0 Phase 3: Call a support agent (sync or async)
                    case 'call_support_agent': {
                        const payload = action.payload as Record<string, unknown>;
                        const agentName = payload.agent_name as string;
                        const query = payload.query as string;
                        const ticketId = payload.ticket_id as string;
                        const mode = (payload.mode as string) || 'sync';

                        if (!agentName || !query) {
                            this.outputChannel.appendLine('[TicketProcessor] call_support_agent: missing agent_name or query');
                            break;
                        }

                        const result = await this.executeSupportCall({
                            agent_name: agentName,
                            query,
                            ticket_id: ticketId,
                            mode: mode as 'sync' | 'async',
                            callback_action: 'resume',
                        });

                        if (result) {
                            this.outputChannel.appendLine(
                                `[TicketProcessor] Support call (${mode}) to ${agentName}: ${result.substring(0, 100)}`
                            );
                        }
                        executed++;
                        break;
                    }

                    // v7.0 Phase 3: Block a ticket with reason
                    case 'block_ticket': {
                        const payload = action.payload as Record<string, unknown>;
                        const ticketId = payload.ticket_id as string;
                        const reason = payload.reason as string || 'Blocked by Boss AI';
                        const blockingTicketId = payload.blocking_ticket_id as string | undefined;

                        if (ticketId) {
                            this.database.updateTicket(ticketId, {
                                status: TicketStatus.Blocked,
                                blocking_ticket_id: blockingTicketId || null,
                                processing_status: null,
                                processing_agent: null,
                            });
                            this.database.addTicketReply(ticketId, 'boss-ai', `Blocked: ${reason}`);
                            this.outputChannel.appendLine(
                                `[TicketProcessor] Ticket ${ticketId} blocked: ${reason.substring(0, 80)}`
                            );
                        }
                        executed++;
                        break;
                    }

                    // v7.0 Phase 3: Save a document to the documentation system
                    case 'save_document': {
                        const payload = action.payload as Record<string, unknown>;
                        const folderName = payload.folder_name as string || 'General';
                        const docName = payload.document_name as string || 'Untitled';
                        const content = payload.content as string || '';
                        const summary = payload.summary as string | undefined;
                        const category = payload.category as string || 'reference';
                        const sourceTicketId = payload.source_ticket_id as string | undefined;
                        const sourceAgent = payload.source_agent as string | undefined;
                        const tags = (payload.tags as string[]) || [];

                        // Save to support_documents table directly (DocumentManager will wrap this in Phase 5)
                        const docRecord = this.database.createSupportDocument?.({
                            plan_id: null,
                            folder_name: folderName,
                            document_name: docName,
                            content,
                            summary: summary || null,
                            category,
                            source_ticket_id: sourceTicketId || null,
                            source_agent: sourceAgent || null,
                            tags,
                            relevance_score: 50,
                        });
                        const docId = docRecord?.id || `doc-${Date.now()}`;

                        this.eventBus.emit('docs:document_saved', 'ticket-processor', {
                            docId, folderName, docName, category, sourceTicketId,
                        });

                        this.outputChannel.appendLine(
                            `[TicketProcessor] Document saved: ${folderName}/${docName} (${content.length} chars)`
                        );
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

        // v7.0: Check Coding Director team queue first, then others
        const codingQueue = this.getTeamQueue(LeadAgentQueue.CodingDirector);
        if (codingQueue.length > 0) {
            return this.database.getTicket(codingQueue[0].ticketId);
        }

        // Fallback: check all queues for coding tickets
        for (const q of this.teamQueues.values()) {
            const codingEntry = q.find(e => e.operationType === 'code_generation');
            if (codingEntry) return this.database.getTicket(codingEntry.ticketId);
        }

        return null;
    }

    /**
     * Get AI level for a ticket's context (from ticket body or global config).
     */
    private getAILevel(ticket: Ticket): string {
        // Try to get from the ticket's body (per-ticket override)
        if (ticket.body) {
            const aiLevelMatch = ticket.body.match(/AI Level:\s*(\w+)/i);
            if (aiLevelMatch) {
                const raw = aiLevelMatch[1].toLowerCase();
                // Normalize legacy 'suggestions' → 'suggest'
                return raw === 'suggestions' ? 'suggest' : raw;
            }
        }
        // Fall back to global AI mode from config (typed, no normalization needed)
        return this.config.getConfig().aiMode ?? 'smart';
    }

    /**
     * v5.0: Resolve the effective AI mode — the more restrictive of global and per-ticket wins.
     *
     * Restrictiveness order: manual > suggest > hybrid > smart
     * If global is "manual", everything is manual regardless of ticket.
     * If ticket says "suggest" but global is "smart", effective is "suggest".
     */
    private resolveEffectiveAIMode(globalMode: string, ticketMode: string): string {
        const order: Record<string, number> = { manual: 0, suggest: 1, hybrid: 2, smart: 3 };
        const globalRank = order[globalMode] ?? 3;
        const ticketRank = order[ticketMode] ?? 3;
        // More restrictive (lower rank) wins
        const effectiveRank = Math.min(globalRank, ticketRank);
        const modes = ['manual', 'suggest', 'hybrid', 'smart'];
        return modes[effectiveRank] ?? 'smart';
    }

    /**
     * v5.0: Detect if a ticket is frontend/design work (for hybrid mode).
     *
     * Checks operation_type, title, and body for frontend-related keywords.
     * In hybrid mode, these tickets require user approval; backend tickets auto-process.
     */
    private isDesignOrFrontendTicket(ticket: Ticket): boolean {
        const frontendKeywords = [
            'frontend', 'front-end', 'ui', 'ux', 'css', 'style', 'layout', 'design',
            'component', 'page', 'visual', 'responsive', 'animation', 'theme',
            'html', 'template', 'view', 'render', 'display', 'form', 'button',
            'modal', 'dialog', 'sidebar', 'header', 'footer', 'nav',
        ];
        const text = `${ticket.title} ${ticket.operation_type} ${ticket.body ?? ''}`.toLowerCase();
        return frontendKeywords.some(kw => text.includes(kw));
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
     * v5.0: Returns unified queue fields + backward-compatible aliases for old API consumers.
     */
    getStatus(): {
        queueSize: number;
        isProcessing: boolean;
        mainQueueSize: number;
        bossQueueSize: number;
        mainProcessing: boolean;
        bossProcessing: boolean;
        lastActivityTimestamp: number;
        idleMinutes: number;
        bossState: 'active' | 'waiting' | 'idle';
        bossNextCheckMs: number;
        startupAssessmentRunning: boolean;
        activeSlots: number;
        maxSlots: number;
        holdQueueSize: number;
        // v7.0: Per-team queue breakdown
        teamQueues: TeamQueueStatus[];
    } {
        const now = Date.now();
        const isActive = this.activeSlots.size > 0;
        const totalQueueSize = this.getTotalQueueSize();

        return {
            // v5.0: New unified fields
            queueSize: totalQueueSize,
            isProcessing: isActive,
            // Backward-compatible aliases (mapped from unified queue)
            mainQueueSize: totalQueueSize,
            bossQueueSize: 0, // No separate boss queue in v5.0+
            mainProcessing: isActive,
            bossProcessing: false, // No separate boss processing in v5.0+
            lastActivityTimestamp: this.lastActivityTimestamp,
            idleMinutes: Math.round((now - this.lastActivityTimestamp) / 60000),
            bossState: this.bossState,
            bossNextCheckMs: this.nextBossCheckAt > now ? this.nextBossCheckAt - now : 0,
            startupAssessmentRunning: this.startupAssessmentRunning,
            // v6.0: Parallel processing info
            activeSlots: this.activeSlots.size,
            maxSlots: this.maxParallelTickets,
            holdQueueSize: this.holdQueue.length,
            // v7.0: Per-team queue breakdown
            teamQueues: this.getTeamQueueStatus(),
        };
    }

    /**
     * Remove a ticket from queues (e.g., when cancelled).
     */
    removeFromQueue(ticketId: string): void {
        this.removeFromTeamQueues(ticketId);
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

        if (this.bossCycleTimer) {
            clearTimeout(this.bossCycleTimer);
            this.bossCycleTimer = null;
        }

        // Remove all event listeners
        for (const { type, handler } of this.eventHandlers) {
            this.eventBus.off(type, handler);
        }
        this.eventHandlers = [];

        // Clear all team queues and slots
        for (const q of this.teamQueues.values()) q.length = 0;
        this.activeSlots.clear();
        this.holdQueue = [];
        this.bossState = 'idle';

        this.outputChannel.appendLine('[TicketProcessor] Disposed');
    }
}
