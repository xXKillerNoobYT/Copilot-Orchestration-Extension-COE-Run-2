/**
 * OrchestratorHardening -- Production-grade routing resilience
 *
 * - Circuit breaker pattern for agent calls
 * - Cascade routing (try primary agent, fallback to alternatives)
 * - Offline mode with cached responses
 * - Request/response benchmarking
 * - Priority queuing
 * - Rate limiting per agent
 */

export interface CircuitBreakerState {
    agentName: string;
    state: 'closed' | 'open' | 'half-open';
    failureCount: number;
    successCount: number;
    lastFailure?: string;
    lastSuccess?: string;
    openedAt?: string;
    halfOpenAfterMs: number;
    failureThreshold: number;
    successThreshold: number;
}

export interface CascadeRoute {
    intent: string;
    primary: string;
    fallbacks: string[];
    timeout: number;
}

export interface CachedResponse {
    key: string;
    response: string;
    timestamp: string;
    ttlMs: number;
    hitCount: number;
    agentName: string;
}

export interface BenchmarkEntry {
    id: string;
    agentName: string;
    intent: string;
    startTime: string;
    endTime?: string;
    durationMs: number;
    success: boolean;
    inputLength: number;
    outputLength: number;
    cached: boolean;
    cascadeLevel: number;
}

export interface AgentBenchmark {
    agentName: string;
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    avgDurationMs: number;
    p50DurationMs: number;
    p95DurationMs: number;
    p99DurationMs: number;
    cacheHitRate: number;
    cascadeRate: number;
    lastCallAt?: string;
}

export interface QueuedRequest {
    id: string;
    priority: 'critical' | 'high' | 'normal' | 'low';
    agentName: string;
    input: string;
    addedAt: string;
    status: 'queued' | 'processing' | 'completed' | 'failed' | 'timeout';
    result?: string;
    error?: string;
}

export class OrchestratorHardening {
    private circuitBreakers: Map<string, CircuitBreakerState>;
    private cascadeRoutes: Map<string, CascadeRoute>;
    private responseCache: Map<string, CachedResponse>;
    private benchmarks: BenchmarkEntry[];
    private requestQueue: QueuedRequest[];
    private offlineMode: boolean;
    private idCounter: number;
    private maxCacheSize: number;
    private maxBenchmarkEntries: number;

    constructor(options?: { maxCacheSize?: number; maxBenchmarks?: number }) {
        this.circuitBreakers = new Map();
        this.cascadeRoutes = new Map();
        this.responseCache = new Map();
        this.benchmarks = [];
        this.requestQueue = [];
        this.offlineMode = false;
        this.idCounter = 0;
        this.maxCacheSize = options?.maxCacheSize ?? 500;
        this.maxBenchmarkEntries = options?.maxBenchmarks ?? 10000;
    }

    private nextId(): string {
        return `req-${++this.idCounter}`;
    }

    // ==================== CIRCUIT BREAKER ====================

    initCircuitBreaker(agentName: string, failureThreshold: number = 5, halfOpenAfterMs: number = 30000, successThreshold: number = 3): void {
        this.circuitBreakers.set(agentName, {
            agentName,
            state: 'closed',
            failureCount: 0,
            successCount: 0,
            halfOpenAfterMs,
            failureThreshold,
            successThreshold,
        });
    }

    getCircuitState(agentName: string): CircuitBreakerState['state'] {
        const cb = this.circuitBreakers.get(agentName);
        if (!cb) return 'closed';

        if (cb.state === 'open') {
            if (cb.openedAt) {
                const elapsed = Date.now() - new Date(cb.openedAt).getTime();
                if (elapsed >= cb.halfOpenAfterMs) {
                    cb.state = 'half-open';
                    cb.successCount = 0;
                }
            }
        }

        return cb.state;
    }

    canCallAgent(agentName: string): boolean {
        const state = this.getCircuitState(agentName);
        return state !== 'open';
    }

    recordSuccess(agentName: string): void {
        const cb = this.circuitBreakers.get(agentName);
        if (!cb) return;

        cb.lastSuccess = new Date().toISOString();

        if (cb.state === 'half-open') {
            cb.successCount++;
            if (cb.successCount >= cb.successThreshold) {
                cb.state = 'closed';
                cb.failureCount = 0;
                cb.successCount = 0;
            }
        } else if (cb.state === 'closed') {
            cb.failureCount = Math.max(0, cb.failureCount - 1);
        }
    }

    recordFailure(agentName: string): void {
        const cb = this.circuitBreakers.get(agentName);
        if (!cb) return;

        cb.failureCount++;
        cb.lastFailure = new Date().toISOString();

        if (cb.state === 'half-open') {
            cb.state = 'open';
            cb.openedAt = new Date().toISOString();
            cb.successCount = 0;
        } else if (cb.state === 'closed' && cb.failureCount >= cb.failureThreshold) {
            cb.state = 'open';
            cb.openedAt = new Date().toISOString();
        }
    }

    getCircuitBreaker(agentName: string): CircuitBreakerState | undefined {
        return this.circuitBreakers.get(agentName);
    }

    getAllCircuitBreakers(): CircuitBreakerState[] {
        for (const [name] of this.circuitBreakers) {
            this.getCircuitState(name);
        }
        return [...this.circuitBreakers.values()];
    }

    // ==================== CASCADE ROUTING ====================

    registerCascadeRoute(intent: string, primary: string, fallbacks: string[], timeout: number = 30000): void {
        this.cascadeRoutes.set(intent, { intent, primary, fallbacks, timeout });
    }

    getCascadeRoute(intent: string): CascadeRoute | undefined {
        return this.cascadeRoutes.get(intent);
    }

    getAgentsForIntent(intent: string): string[] {
        const route = this.cascadeRoutes.get(intent);
        if (!route) return [];

        const agents: string[] = [];

        if (this.canCallAgent(route.primary)) {
            agents.push(route.primary);
        }

        for (const fallback of route.fallbacks) {
            if (this.canCallAgent(fallback)) {
                agents.push(fallback);
            }
        }

        return agents;
    }

    // ==================== RESPONSE CACHE ====================

    cacheResponse(agentName: string, input: string, response: string, ttlMs: number = 300000): void {
        const key = this.cacheKey(agentName, input);

        if (this.responseCache.size >= this.maxCacheSize) {
            const oldest = [...this.responseCache.entries()]
                .sort((a, b) => new Date(a[1].timestamp).getTime() - new Date(b[1].timestamp).getTime())[0];
            if (oldest) this.responseCache.delete(oldest[0]);
        }

        this.responseCache.set(key, {
            key,
            response,
            timestamp: new Date().toISOString(),
            ttlMs,
            hitCount: 0,
            agentName,
        });
    }

    getCachedResponse(agentName: string, input: string): string | null {
        const key = this.cacheKey(agentName, input);
        const cached = this.responseCache.get(key);
        if (!cached) return null;

        const age = Date.now() - new Date(cached.timestamp).getTime();
        if (age > cached.ttlMs) {
            this.responseCache.delete(key);
            return null;
        }

        cached.hitCount++;
        return cached.response;
    }

    getCacheStats(): { size: number; maxSize: number; totalHits: number; avgHits: number } {
        const entries = [...this.responseCache.values()];
        const totalHits = entries.reduce((s, e) => s + e.hitCount, 0);
        return {
            size: entries.length,
            maxSize: this.maxCacheSize,
            totalHits,
            avgHits: entries.length > 0 ? Math.round(totalHits / entries.length * 100) / 100 : 0,
        };
    }

    clearCache(): void {
        this.responseCache.clear();
    }

    private cacheKey(agentName: string, input: string): string {
        return `${agentName}:${input.slice(0, 200)}`;
    }

    // ==================== BENCHMARKING ====================

    startBenchmark(agentName: string, intent: string, inputLength: number): string {
        const id = this.nextId();
        const entry: BenchmarkEntry = {
            id,
            agentName,
            intent,
            startTime: new Date().toISOString(),
            durationMs: 0,
            success: false,
            inputLength,
            outputLength: 0,
            cached: false,
            cascadeLevel: 0,
        };
        this.benchmarks.push(entry);

        if (this.benchmarks.length > this.maxBenchmarkEntries) {
            this.benchmarks = this.benchmarks.slice(-this.maxBenchmarkEntries);
        }

        return id;
    }

    completeBenchmark(id: string, success: boolean, outputLength: number, cached: boolean = false, cascadeLevel: number = 0): void {
        const entry = this.benchmarks.find(b => b.id === id);
        if (!entry) return;

        entry.endTime = new Date().toISOString();
        entry.durationMs = new Date(entry.endTime).getTime() - new Date(entry.startTime).getTime();
        entry.success = success;
        entry.outputLength = outputLength;
        entry.cached = cached;
        entry.cascadeLevel = cascadeLevel;
    }

    getAgentBenchmark(agentName: string): AgentBenchmark {
        const entries = this.benchmarks.filter(b => b.agentName === agentName && b.endTime);
        const successful = entries.filter(b => b.success);
        const cached = entries.filter(b => b.cached);
        const cascaded = entries.filter(b => b.cascadeLevel > 0);

        const durations = entries.map(b => b.durationMs).sort((a, b) => a - b);

        return {
            agentName,
            totalCalls: entries.length,
            successfulCalls: successful.length,
            failedCalls: entries.length - successful.length,
            avgDurationMs: entries.length > 0 ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : 0,
            p50DurationMs: durations.length > 0 ? durations[Math.floor(durations.length * 0.5)] : 0,
            p95DurationMs: durations.length > 0 ? durations[Math.floor(durations.length * 0.95)] : 0,
            p99DurationMs: durations.length > 0 ? durations[Math.floor(durations.length * 0.99)] : 0,
            cacheHitRate: entries.length > 0 ? Math.round(cached.length / entries.length * 100) / 100 : 0,
            cascadeRate: entries.length > 0 ? Math.round(cascaded.length / entries.length * 100) / 100 : 0,
            lastCallAt: entries.length > 0 ? entries[entries.length - 1].endTime : undefined,
        };
    }

    getAllBenchmarks(): AgentBenchmark[] {
        const agents = new Set(this.benchmarks.map(b => b.agentName));
        return [...agents].map(name => this.getAgentBenchmark(name));
    }

    getBenchmarkEntries(limit: number = 100): BenchmarkEntry[] {
        return this.benchmarks.slice(-limit);
    }

    // ==================== PRIORITY QUEUE ====================

    enqueue(agentName: string, input: string, priority: QueuedRequest['priority'] = 'normal'): string {
        const id = this.nextId();
        this.requestQueue.push({
            id,
            priority,
            agentName,
            input,
            addedAt: new Date().toISOString(),
            status: 'queued',
        });

        const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
        this.requestQueue.sort((a, b) => {
            if (a.status !== 'queued' || b.status !== 'queued') return 0;
            return (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
        });

        return id;
    }

    dequeue(): QueuedRequest | null {
        const next = this.requestQueue.find(r => r.status === 'queued');
        if (next) {
            next.status = 'processing';
        }
        return next || null;
    }

    completeRequest(id: string, result: string): void {
        const req = this.requestQueue.find(r => r.id === id);
        if (req) {
            req.status = 'completed';
            req.result = result;
        }
    }

    failRequest(id: string, error: string): void {
        const req = this.requestQueue.find(r => r.id === id);
        if (req) {
            req.status = 'failed';
            req.error = error;
        }
    }

    getQueueLength(): number {
        return this.requestQueue.filter(r => r.status === 'queued').length;
    }

    getQueueStats(): { queued: number; processing: number; completed: number; failed: number } {
        return {
            queued: this.requestQueue.filter(r => r.status === 'queued').length,
            processing: this.requestQueue.filter(r => r.status === 'processing').length,
            completed: this.requestQueue.filter(r => r.status === 'completed').length,
            failed: this.requestQueue.filter(r => r.status === 'failed').length,
        };
    }

    clearQueue(): void {
        this.requestQueue = [];
    }

    // ==================== OFFLINE MODE ====================

    setOfflineMode(enabled: boolean): void {
        this.offlineMode = enabled;
    }

    isOffline(): boolean {
        return this.offlineMode;
    }

    getOfflineResponse(agentName: string, input: string): string | null {
        if (!this.offlineMode) return null;
        return this.getCachedResponse(agentName, input);
    }

    // ==================== RESET ====================

    reset(): void {
        this.circuitBreakers.clear();
        this.cascadeRoutes.clear();
        this.responseCache.clear();
        this.benchmarks = [];
        this.requestQueue = [];
        this.offlineMode = false;
        this.idCounter = 0;
    }
}