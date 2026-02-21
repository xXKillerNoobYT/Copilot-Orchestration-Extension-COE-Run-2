/**
 * EventBus — Central pub/sub event system for COE
 *
 * Enables real-time communication between services, agents, and UI.
 * Supports typed events, wildcards, once-only listeners, and WebSocket broadcast.
 *
 * Architecture:
 *   Database mutations → EventBus.emit() → WebSocket clients + internal listeners
 *   Agent completions → EventBus.emit() → UI updates + audit log + next-task triggers
 */

import { EventEmitter } from 'events';

// ==================== EVENT TYPES ====================

export type COEEventType =
    // Task lifecycle
    | 'task:created' | 'task:updated' | 'task:deleted' | 'task:started'
    | 'task:completed' | 'task:verified' | 'task:failed' | 'task:blocked'
    | 'task:reordered' | 'task:decomposed'
    // Plan lifecycle
    | 'plan:created' | 'plan:activated' | 'plan:completed' | 'plan:archived'
    | 'plan:updated' | 'plan:deleted' | 'plan:drift_detected'
    // Ticket lifecycle
    | 'ticket:created' | 'ticket:updated' | 'ticket:deleted' | 'ticket:resolved' | 'ticket:escalated'
    | 'ticket:replied' | 'ticket:priority_changed' | 'ticket:status_changed' | 'ticket:message_added'
    // Agent lifecycle
    | 'agent:started' | 'agent:completed' | 'agent:error' | 'agent:idle'
    | 'agent:routed' | 'agent:registered'
    // Verification
    | 'verification:started' | 'verification:passed' | 'verification:failed'
    | 'verification:approved' | 'verification:rejected'
    // Evolution
    | 'evolution:pattern_detected' | 'evolution:proposal_created'
    | 'evolution:proposal_applied' | 'evolution:rollback'
    // Design
    | 'design:page_created' | 'design:page_updated' | 'design:page_deleted'
    | 'design:component_created' | 'design:component_updated' | 'design:component_deleted'
    | 'design:token_created' | 'design:token_deleted'
    | 'design:flow_created' | 'design:flow_deleted'
    // Coding
    | 'coding:session_created' | 'coding:message_sent' | 'coding:session_completed'
    | 'coding:agent_responded' | 'coding:design_export'
    // Coding Agent (v2.0)
    | 'coding_agent:command_received' | 'coding_agent:generating' | 'coding_agent:completed'
    | 'coding_agent:diff_pending' | 'coding_agent:diff_approved' | 'coding_agent:diff_rejected'
    | 'coding_agent:explaining'
    // Ethics (v2.0)
    | 'ethics:check_passed' | 'ethics:action_blocked' | 'ethics:user_override'
    | 'ethics:module_enabled' | 'ethics:module_disabled' | 'ethics:sensitivity_changed'
    // Sync (v2.0)
    | 'sync:started' | 'sync:completed' | 'sync:conflict_detected' | 'sync:conflict_resolved'
    | 'sync:device_connected' | 'sync:device_disconnected'
    // Transparency (v2.0)
    | 'transparency:action_logged' | 'transparency:log_exported' | 'transparency:log_queried'
    // AI (v3.0 — Planning enhancement)
    | 'ai:suggestions_generated' | 'ai:suggestion_accepted' | 'ai:suggestion_dismissed'
    | 'ai:question_answered' | 'ai:autofill_completed' | 'ai:plan_reviewed'
    | 'ai:bug_check_completed'
    // Status (v3.0)
    | 'status:issue_created' | 'status:issue_resolved' | 'status:element_updated'
    // Plan Versions (v3.0)
    | 'plan:version_created' | 'plan:version_restored'
    | 'plan:branch_switched' | 'plan:version_merged'
    // Notifications (v3.0)
    | 'notification:badge_update'
    // Element Chat (v3.0)
    | 'element:chat_message' | 'element:change_confirmed' | 'element:change_rejected'
    // AI Chat Overlay (v3.0)
    | 'ai_chat:session_created' | 'ai_chat:message_sent' | 'ai_chat:session_archived'
    // Plan lifecycle (v4.0 — Lifecycle Orchestration)
    | 'plan:tasks_generated' | 'plan:config_updated'
    // Design QA pipeline (v4.0)
    | 'design:generated' | 'design:merged' | 'design:approved'
    | 'design:architect_review_completed' | 'design:gap_analysis_completed'
    | 'design:hardening_completed' | 'design:draft_approved' | 'design:draft_rejected'
    | 'design:qa_pipeline_started' | 'design:qa_pipeline_completed'
    // Ticket processing (v4.0)
    | 'ticket:queued' | 'ticket:processing_started' | 'ticket:processing_completed'
    | 'ticket:cancelled' | 'ticket:unblocked'
    | 'ticket:verification_started' | 'ticket:verification_passed' | 'ticket:verification_failed'
    | 'ticket:retry' | 'ticket:requeued' | 'ticket:recovered' | 'ticket:review_flagged'
    | 'ticket:review_passed' | 'ticket:escalated_orphan'
    // Question queue (v4.0)
    | 'question:created' | 'question:answered' | 'question:auto_answered'
    | 'question:dismissed' | 'question:conflict_detected'
    // Boss AI (v4.0)
    | 'boss:health_check_started' | 'boss:health_check_completed'
    | 'boss:idle_watchdog_triggered'
    // Boss AI between-ticket orchestration (v4.2)
    | 'boss:inter_ticket_started' | 'boss:inter_ticket_completed'
    | 'boss:startup_assessment_started' | 'boss:startup_assessment_completed'
    | 'boss:picked_next_ticket'
    // Boss AI supervisor cycle (v5.0)
    | 'boss:cycle_started' | 'boss:cycle_completed'
    | 'boss:dispatching_ticket' | 'boss:ticket_completed'
    | 'boss:countdown_tick'
    // Phase management (v4.0)
    | 'phase:changed' | 'phase:gate_checked' | 'phase:gate_passed' | 'phase:gate_blocked'
    // Impact analysis (v4.0)
    | 'impact:analysis_started' | 'impact:analysis_completed'
    // Plan files (v5.0)
    | 'plan:file_uploaded' | 'plan:file_updated' | 'plan:file_deleted'
    | 'plan:file_synced' | 'plan:folder_linked' | 'plan:folder_scanned'
    | 'plan:file_change_detected'
    // Boss AI parallel processing (v6.0)
    | 'boss:slot_started' | 'boss:slot_completed' | 'boss:slot_error'
    | 'boss:model_swap' | 'boss:ticket_held' | 'boss:ticket_unheld'
    | 'boss:notepad_updated' | 'boss:dispatch_agent'
    // v7.0: Team queue orchestration
    | 'boss:assignment_created' | 'boss:assignment_completed' | 'boss:assignment_failed' | 'boss:assignment_partial'
    | 'boss:ticket_cancelled' | 'boss:ticket_reengaged'
    | 'boss:ticket_moved_queue' | 'boss:slot_allocation_updated'
    | 'boss:slot_borrowing'
    | 'queue:slot_allocated' | 'queue:balance_cycle'
    | 'queue:escalation_received'
    | 'support:sync_call' | 'support:async_ticket_created'
    | 'docs:document_saved' | 'docs:document_updated' | 'docs:document_verified' | 'docs:folder_created'
    | 'agent_file:detected' | 'agent_file:processed' | 'agent_file:cleaned'
    // v8.0: Backend Designer
    | 'backend:element_created' | 'backend:element_updated' | 'backend:element_deleted'
    | 'backend:architect_review_completed' | 'backend:qa_pipeline_completed'
    // v8.0: Element Link System
    | 'link:created' | 'link:updated' | 'link:deleted'
    | 'link:approved' | 'link:rejected'
    | 'link:auto_detected' | 'link:ai_suggested'
    // v8.0: Tag System
    | 'tag:created' | 'tag:deleted' | 'tag:assigned' | 'tag:removed'
    // v8.0: Unified Review Queue
    | 'review_queue:item_created' | 'review_queue:item_approved' | 'review_queue:item_rejected'
    | 'review_queue:badge_update'
    // v9.0: Agent Tree Hierarchy
    | 'tree:node_spawned' | 'tree:node_activated' | 'tree:node_completed' | 'tree:node_failed' | 'tree:node_idle'
    | 'tree:node_escalated' | 'tree:context_sliced'
    | 'tree:skeleton_built' | 'tree:branch_spawned' | 'tree:branch_pruned'
    | 'tree:default_built'
    | 'tree:question_escalated' | 'tree:question_answered'
    // v9.0: Workflow Designer & Engine
    | 'workflow:created' | 'workflow:updated' | 'workflow:deleted'
    | 'workflow:execution_started' | 'workflow:execution_completed' | 'workflow:execution_failed'
    | 'workflow:step_started' | 'workflow:step_completed' | 'workflow:step_failed'
    | 'workflow:condition_evaluated' | 'workflow:branch_taken'
    | 'workflow:user_approval_requested' | 'workflow:user_approval_received'
    | 'workflow:tool_unlocked' | 'workflow:escalation_triggered'
    | 'workflow:paused' | 'workflow:resumed' | 'workflow:cancelled'
    // v9.0: User Communication Orchestrator
    | 'user_comm:message_queued' | 'user_comm:message_delivered'
    | 'user_comm:preference_updated' | 'user_comm:profile_updated'
    | 'user_comm:bypass_triggered' | 'user_comm:auto_answered'
    | 'user_comm:research_requested' | 'user_comm:question_presented'
    | 'user_comm:profile_suggestion'
    // v9.0: MCP Confirmation
    | 'mcp:confirmation_requested' | 'mcp:confirmation_approved'
    | 'mcp:confirmation_rejected' | 'mcp:confirmation_expired'
    // v9.0: Model Router
    | 'model:assignment_changed' | 'model:swap_requested'
    | 'model:capability_detected' | 'model:detection_completed'
    // v9.0: Escalation Chain
    | 'escalation:chain_started' | 'escalation:chain_resolved'
    | 'escalation:chain_blocked' | 'escalation:level_checked'
    | 'escalation:ticket_paused' | 'escalation:ticket_blocked'
    // v9.0: Niche Agents
    | 'niche:agent_spawned' | 'niche:definitions_seeded'
    | 'niche:agent_selected' | 'niche:prompt_built'
    // v9.0: Permissions
    | 'permission:granted' | 'permission:revoked'
    | 'permission:check_failed' | 'permission:enforced'
    // v11.0: Tree-Routed Ticket Processing
    | 'ticket:tree_delegation' | 'ticket:bubble_up'
    | 'ticket:agent_step_started' | 'ticket:agent_step_completed'
    | 'ticket:boss_completion' | 'ticket:note_added'
    | 'ticket:reference_added' | 'ticket:stage_updated'
    | 'boss:pre_dispatch_validation' | 'boss:timer_zero_recovery'
    // System
    | 'system:config_updated' | 'system:health_check' | 'system:error'
    | 'system:mcp_connected' | 'system:mcp_disconnected'
    // Wildcard
    | '*';

export interface COEEvent {
    type: COEEventType;
    timestamp: string;
    source: string;
    data: Record<string, unknown>;
}

export type COEEventHandler = (event: COEEvent) => void | Promise<void>;

// ==================== EVENT BUS ====================

export class EventBus {
    private emitter: EventEmitter;
    private wsClients: Set<WebSocketClient>;
    private eventHistory: COEEvent[];
    private maxHistory: number;
    private metrics: EventMetrics;

    constructor(maxHistory: number = 1000) {
        this.emitter = new EventEmitter();
        this.emitter.setMaxListeners(100);
        this.wsClients = new Set();
        this.eventHistory = [];
        this.maxHistory = maxHistory;
        this.metrics = {
            totalEmitted: 0,
            totalDelivered: 0,
            totalErrors: 0,
            byType: {},
            lastEvent: null,
        };
    }

    /**
     * Emit an event to all listeners and WebSocket clients
     */
    emit(type: COEEventType, source: string, data: Record<string, unknown> = {}): void {
        const event: COEEvent = {
            type,
            timestamp: new Date().toISOString(),
            source,
            data: JSON.parse(JSON.stringify(data)), // Deep clone to prevent mutation
        };

        // Track metrics
        this.metrics.totalEmitted++;
        this.metrics.byType[type] = (this.metrics.byType[type] || 0) + 1;
        this.metrics.lastEvent = event;

        // Store in history (circular buffer)
        this.eventHistory.push(event);
        if (this.eventHistory.length > this.maxHistory) {
            this.eventHistory.shift();
        }

        // Emit to typed listeners
        try {
            this.emitter.emit(type, event);
            this.metrics.totalDelivered++;
        } catch (err) {
            this.metrics.totalErrors++;
        }

        // Emit to wildcard listeners
        try {
            this.emitter.emit('*', event);
        } catch {
            // Wildcard errors don't increment error count
        }

        // Broadcast to WebSocket clients
        this.broadcastToWs(event);
    }

    /**
     * Subscribe to an event type
     */
    on(type: COEEventType, handler: COEEventHandler): void {
        this.emitter.on(type, handler);
    }

    /**
     * Subscribe to an event type (one-time only)
     */
    once(type: COEEventType, handler: COEEventHandler): void {
        this.emitter.once(type, handler);
    }

    /**
     * Unsubscribe from an event type
     */
    off(type: COEEventType, handler: COEEventHandler): void {
        this.emitter.off(type, handler);
    }

    /**
     * Wait for a specific event (Promise-based)
     */
    waitFor(type: COEEventType, timeoutMs: number = 30000): Promise<COEEvent> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.off(type, handler);
                reject(new Error(`Timeout waiting for event: ${type}`));
            }, timeoutMs);

            const handler: COEEventHandler = (event) => {
                clearTimeout(timer);
                resolve(event);
            };

            this.once(type, handler);
        });
    }

    /**
     * Register a WebSocket client for real-time push
     */
    addWsClient(client: WebSocketClient): void {
        this.wsClients.add(client);
    }

    /**
     * Remove a WebSocket client
     */
    removeWsClient(client: WebSocketClient): void {
        this.wsClients.delete(client);
    }

    /**
     * Get recent event history
     */
    getHistory(limit: number = 50, filterType?: COEEventType): COEEvent[] {
        let events = this.eventHistory;
        if (filterType && filterType !== '*') {
            events = events.filter(e => e.type === filterType);
        }
        return events.slice(-limit);
    }

    /**
     * Get event metrics
     */
    getMetrics(): EventMetrics {
        return { ...this.metrics };
    }

    /**
     * Reset metrics (for testing)
     */
    resetMetrics(): void {
        this.metrics = {
            totalEmitted: 0,
            totalDelivered: 0,
            totalErrors: 0,
            byType: {},
            lastEvent: null,
        };
    }

    /**
     * Get listener count for a type
     */
    listenerCount(type: COEEventType): number {
        return this.emitter.listenerCount(type);
    }

    /**
     * Remove all listeners (cleanup)
     */
    removeAllListeners(): void {
        this.emitter.removeAllListeners();
        this.wsClients.clear();
    }

    private broadcastToWs(event: COEEvent): void {
        const payload = JSON.stringify(event);
        for (const client of this.wsClients) {
            try {
                if (client.readyState === 'open') {
                    client.send(payload);
                    this.metrics.totalDelivered++;
                } else {
                    // Remove stale clients
                    this.wsClients.delete(client);
                }
            } catch {
                this.wsClients.delete(client);
                this.metrics.totalErrors++;
            }
        }
    }
}

// ==================== INTERFACES ====================

export interface WebSocketClient {
    readyState: 'open' | 'closed' | 'connecting';
    send(data: string): void;
}

export interface EventMetrics {
    totalEmitted: number;
    totalDelivered: number;
    totalErrors: number;
    byType: Record<string, number>;
    lastEvent: COEEvent | null;
}

// ==================== SINGLETON ====================

let globalBus: EventBus | null = null;

export function getEventBus(): EventBus {
    if (!globalBus) {
        globalBus = new EventBus();
    }
    return globalBus;
}

export function resetEventBus(): void {
    if (globalBus) {
        globalBus.removeAllListeners();
    }
    globalBus = null;
}
