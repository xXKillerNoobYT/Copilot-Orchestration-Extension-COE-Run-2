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
    | 'plan:updated' | 'plan:drift_detected'
    // Ticket lifecycle
    | 'ticket:created' | 'ticket:updated' | 'ticket:resolved' | 'ticket:escalated'
    | 'ticket:replied'
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
