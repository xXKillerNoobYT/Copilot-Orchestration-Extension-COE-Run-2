/**
 * Orchestrator Hardening Tests
 * 50+ comprehensive tests for circuit breaker, cascade routing,
 * response cache, benchmarking, priority queue, and offline mode.
 */

import { OrchestratorHardening } from '../src/core/orchestrator-hardening';

describe('OrchestratorHardening', () => {
    let hardening: OrchestratorHardening;

    beforeEach(() => {
        hardening = new OrchestratorHardening({ maxCacheSize: 5, maxBenchmarks: 50 });
    });

    // ==================== CIRCUIT BREAKER TESTS ====================

    describe('Circuit Breaker', () => {
        it('should start in closed state after init', () => {
            hardening.initCircuitBreaker('agent-a');
            expect(hardening.getCircuitState('agent-a')).toBe('closed');
        });

        it('should remain closed on success', () => {
            hardening.initCircuitBreaker('agent-a');
            hardening.recordSuccess('agent-a');
            hardening.recordSuccess('agent-a');
            expect(hardening.getCircuitState('agent-a')).toBe('closed');
        });

        it('should open after reaching failure threshold', () => {
            hardening.initCircuitBreaker('agent-a', 3);
            hardening.recordFailure('agent-a');
            hardening.recordFailure('agent-a');
            expect(hardening.getCircuitState('agent-a')).toBe('closed');
            hardening.recordFailure('agent-a');
            expect(hardening.getCircuitState('agent-a')).toBe('open');
        });

        it('should block calls when circuit is open', () => {
            hardening.initCircuitBreaker('agent-a', 2);
            hardening.recordFailure('agent-a');
            hardening.recordFailure('agent-a');
            expect(hardening.canCallAgent('agent-a')).toBe(false);
        });

        it('should transition to half-open after timeout', () => {
            hardening.initCircuitBreaker('agent-a', 2, 10);
            hardening.recordFailure('agent-a');
            hardening.recordFailure('agent-a');
            expect(hardening.getCircuitState('agent-a')).toBe('open');
            const cb = hardening.getCircuitBreaker('agent-a')!;
            cb.openedAt = new Date(Date.now() - 20).toISOString();
            expect(hardening.getCircuitState('agent-a')).toBe('half-open');
        });

        it('should allow calls in half-open state', () => {
            hardening.initCircuitBreaker('agent-a', 2, 10);
            hardening.recordFailure('agent-a');
            hardening.recordFailure('agent-a');
            const cb = hardening.getCircuitBreaker('agent-a')!;
            cb.openedAt = new Date(Date.now() - 20).toISOString();
            expect(hardening.canCallAgent('agent-a')).toBe(true);
        });

        it('should close after enough successes in half-open', () => {
            hardening.initCircuitBreaker('agent-a', 2, 10, 2);
            hardening.recordFailure('agent-a');
            hardening.recordFailure('agent-a');
            const cb = hardening.getCircuitBreaker('agent-a')!;
            cb.openedAt = new Date(Date.now() - 20).toISOString();
            hardening.getCircuitState('agent-a');
            hardening.recordSuccess('agent-a');
            expect(hardening.getCircuitState('agent-a')).toBe('half-open');
            hardening.recordSuccess('agent-a');
            expect(hardening.getCircuitState('agent-a')).toBe('closed');
        });
        it('should reopen on failure in half-open', () => {
            hardening.initCircuitBreaker('agent-a', 2, 10, 3);
            hardening.recordFailure('agent-a');
            hardening.recordFailure('agent-a');
            const cb = hardening.getCircuitBreaker('agent-a')!;
            cb.openedAt = new Date(Date.now() - 20).toISOString();
            hardening.getCircuitState('agent-a');
            hardening.recordSuccess('agent-a');
            hardening.recordFailure('agent-a');
            expect(hardening.getCircuitState('agent-a')).toBe('open');
        });

        it('should support multiple independent breakers', () => {
            hardening.initCircuitBreaker('agent-a', 2);
            hardening.initCircuitBreaker('agent-b', 2);
            hardening.recordFailure('agent-a');
            hardening.recordFailure('agent-a');
            expect(hardening.canCallAgent('agent-a')).toBe(false);
            expect(hardening.canCallAgent('agent-b')).toBe(true);
        });

        it('should return all circuit breakers', () => {
            hardening.initCircuitBreaker('agent-a');
            hardening.initCircuitBreaker('agent-b');
            hardening.initCircuitBreaker('agent-c');
            const all = hardening.getAllCircuitBreakers();
            expect(all.length).toBe(3);
        });

        it('should always allow agent without circuit breaker', () => {
            expect(hardening.canCallAgent('unknown')).toBe(true);
            expect(hardening.getCircuitState('unknown')).toBe('closed');
        });

        it('should set lastFailure on failure', () => {
            hardening.initCircuitBreaker('agent-a');
            hardening.recordFailure('agent-a');
            expect(hardening.getCircuitBreaker('agent-a')!.lastFailure).toBeDefined();
        });

        it('should set lastSuccess on success', () => {
            hardening.initCircuitBreaker('agent-a');
            hardening.recordSuccess('agent-a');
            expect(hardening.getCircuitBreaker('agent-a')!.lastSuccess).toBeDefined();
        });

        it('should slowly recover failure count on success', () => {
            hardening.initCircuitBreaker('agent-a', 5);
            hardening.recordFailure('agent-a');
            hardening.recordFailure('agent-a');
            hardening.recordFailure('agent-a');
            expect(hardening.getCircuitBreaker('agent-a')!.failureCount).toBe(3);
            hardening.recordSuccess('agent-a');
            expect(hardening.getCircuitBreaker('agent-a')!.failureCount).toBe(2);
        });

        it('should not go below 0 failure count', () => {
            hardening.initCircuitBreaker('agent-a');
            hardening.recordSuccess('agent-a');
            expect(hardening.getCircuitBreaker('agent-a')!.failureCount).toBe(0);
        });

        it('should ignore recordSuccess for unknown agent', () => {
            expect(() => hardening.recordSuccess('nope')).not.toThrow();
        });

        it('should ignore recordFailure for unknown agent', () => {
            expect(() => hardening.recordFailure('nope')).not.toThrow();
        });
    });

    describe('Cascade Routing', () => {
        it('should register cascade route', () => {
            hardening.registerCascadeRoute('planning', 'planner', ['answer', 'research']);
            const route = hardening.getCascadeRoute('planning');
            expect(route).toBeDefined();
            expect(route!.primary).toBe('planner');
            expect(route!.fallbacks).toEqual(['answer', 'research']);
        });

        it('should return agents with primary first', () => {
            hardening.registerCascadeRoute('planning', 'planner', ['answer']);
            const agents = hardening.getAgentsForIntent('planning');
            expect(agents).toEqual(['planner', 'answer']);
        });

        it('should skip primary if circuit is open', () => {
            hardening.initCircuitBreaker('planner', 2);
            hardening.recordFailure('planner');
            hardening.recordFailure('planner');
            hardening.registerCascadeRoute('planning', 'planner', ['answer']);
            const agents = hardening.getAgentsForIntent('planning');
            expect(agents).toEqual(['answer']);
        });

        it('should include fallbacks if primary down', () => {
            hardening.initCircuitBreaker('planner', 1);
            hardening.recordFailure('planner');
            hardening.registerCascadeRoute('planning', 'planner', ['answer', 'research']);
            const agents = hardening.getAgentsForIntent('planning');
            expect(agents).toEqual(['answer', 'research']);
        });

        it('should skip fallbacks with open circuits', () => {
            hardening.initCircuitBreaker('planner', 1);
            hardening.initCircuitBreaker('answer', 1);
            hardening.recordFailure('planner');
            hardening.recordFailure('answer');
            hardening.registerCascadeRoute('planning', 'planner', ['answer', 'research']);
            const agents = hardening.getAgentsForIntent('planning');
            expect(agents).toEqual(['research']);
        });

        it('should return empty for unknown intent', () => {
            expect(hardening.getAgentsForIntent('unknown')).toEqual([]);
        });

        it('should support multiple fallback levels', () => {
            hardening.registerCascadeRoute('question', 'answer', ['research', 'clarity', 'boss']);
            const agents = hardening.getAgentsForIntent('question');
            expect(agents).toEqual(['answer', 'research', 'clarity', 'boss']);
        });

        it('should use default timeout of 30000', () => {
            hardening.registerCascadeRoute('test', 'a', []);
            expect(hardening.getCascadeRoute('test')!.timeout).toBe(30000);
        });
    });

    describe('Response Cache', () => {
        it('should cache and retrieve response', () => {
            hardening.cacheResponse('agent-a', 'hello', 'world');
            expect(hardening.getCachedResponse('agent-a', 'hello')).toBe('world');
        });

        it('should return null for cache miss', () => {
            expect(hardening.getCachedResponse('agent-a', 'nope')).toBeNull();
        });

        it('should return null for expired cache', () => {
            hardening.cacheResponse('agent-a', 'hello', 'world', 1);
            // Wait for TTL to expire
            const start = Date.now();
            while (Date.now() - start < 5) { /* busy wait */ }
            expect(hardening.getCachedResponse('agent-a', 'hello')).toBeNull();
        });

        it('should increment hit count on cache hit', () => {
            hardening.cacheResponse('agent-a', 'hello', 'world');
            hardening.getCachedResponse('agent-a', 'hello');
            hardening.getCachedResponse('agent-a', 'hello');
            hardening.getCachedResponse('agent-a', 'hello');
            const stats = hardening.getCacheStats();
            expect(stats.totalHits).toBe(3);
        });

        it('should evict oldest when at capacity', () => {
            // maxCacheSize is 5
            for (let i = 0; i < 5; i++) {
                hardening.cacheResponse('agent-a', 'input-' + i, 'resp-' + i);
            }
            expect(hardening.getCacheStats().size).toBe(5);
            hardening.cacheResponse('agent-a', 'input-5', 'resp-5');
            expect(hardening.getCacheStats().size).toBe(5);
            // First entry should be evicted
            expect(hardening.getCachedResponse('agent-a', 'input-0')).toBeNull();
            expect(hardening.getCachedResponse('agent-a', 'input-5')).toBe('resp-5');
        });

        it('should report accurate cache stats', () => {
            hardening.cacheResponse('agent-a', 'a', 'b');
            hardening.cacheResponse('agent-b', 'c', 'd');
            const stats = hardening.getCacheStats();
            expect(stats.size).toBe(2);
            expect(stats.maxSize).toBe(5);
            expect(stats.totalHits).toBe(0);
            expect(stats.avgHits).toBe(0);
        });

        it('should clear cache', () => {
            hardening.cacheResponse('agent-a', 'a', 'b');
            hardening.clearCache();
            expect(hardening.getCacheStats().size).toBe(0);
            expect(hardening.getCachedResponse('agent-a', 'a')).toBeNull();
        });

        it('should use different cache keys for different agents', () => {
            hardening.cacheResponse('agent-a', 'hello', 'from-a');
            hardening.cacheResponse('agent-b', 'hello', 'from-b');
            expect(hardening.getCachedResponse('agent-a', 'hello')).toBe('from-a');
            expect(hardening.getCachedResponse('agent-b', 'hello')).toBe('from-b');
        });

        it('should report avgHits correctly', () => {
            hardening.cacheResponse('agent-a', 'a', 'b');
            hardening.getCachedResponse('agent-a', 'a');
            hardening.getCachedResponse('agent-a', 'a');
            const stats = hardening.getCacheStats();
            expect(stats.avgHits).toBe(2);
        });
    });

    describe('Benchmarking', () => {
        it('should start and complete a benchmark', () => {
            const id = hardening.startBenchmark('agent-a', 'planning', 100);
            expect(id).toMatch(/^req-/);
            hardening.completeBenchmark(id, true, 200);
            const entries = hardening.getBenchmarkEntries();
            expect(entries.length).toBe(1);
            expect(entries[0].success).toBe(true);
            expect(entries[0].outputLength).toBe(200);
            expect(entries[0].endTime).toBeDefined();
        });

        it('should calculate average duration', () => {
            const id1 = hardening.startBenchmark('agent-a', 'planning', 10);
            hardening.completeBenchmark(id1, true, 10);
            const id2 = hardening.startBenchmark('agent-a', 'planning', 10);
            hardening.completeBenchmark(id2, true, 10);
            const bm = hardening.getAgentBenchmark('agent-a');
            expect(bm.totalCalls).toBe(2);
            expect(bm.avgDurationMs).toBeGreaterThanOrEqual(0);
        });

        it('should calculate percentiles', () => {
            for (let i = 0; i < 20; i++) {
                const id = hardening.startBenchmark('agent-a', 't', 10);
                hardening.completeBenchmark(id, true, 10);
            }
            const bm = hardening.getAgentBenchmark('agent-a');
            expect(bm.p50DurationMs).toBeGreaterThanOrEqual(0);
            expect(bm.p95DurationMs).toBeGreaterThanOrEqual(0);
            expect(bm.p99DurationMs).toBeGreaterThanOrEqual(0);
        });

        it('should track success and failure counts', () => {
            const id1 = hardening.startBenchmark('agent-a', 't', 10);
            hardening.completeBenchmark(id1, true, 10);
            const id2 = hardening.startBenchmark('agent-a', 't', 10);
            hardening.completeBenchmark(id2, false, 0);
            const id3 = hardening.startBenchmark('agent-a', 't', 10);
            hardening.completeBenchmark(id3, true, 10);
            const bm = hardening.getAgentBenchmark('agent-a');
            expect(bm.successfulCalls).toBe(2);
            expect(bm.failedCalls).toBe(1);
        });

        it('should track cache hit rate', () => {
            const id1 = hardening.startBenchmark('agent-a', 't', 10);
            hardening.completeBenchmark(id1, true, 10, true);
            const id2 = hardening.startBenchmark('agent-a', 't', 10);
            hardening.completeBenchmark(id2, true, 10, false);
            const bm = hardening.getAgentBenchmark('agent-a');
            expect(bm.cacheHitRate).toBe(0.5);
        });
        it('should track cascade rate', () => {
            const id1 = hardening.startBenchmark('agent-a', 't', 10);
            hardening.completeBenchmark(id1, true, 10, false, 0);
            const id2 = hardening.startBenchmark('agent-a', 't', 10);
            hardening.completeBenchmark(id2, true, 10, false, 1);
            const id3 = hardening.startBenchmark('agent-a', 't', 10);
            hardening.completeBenchmark(id3, true, 10, false, 2);
            const bm = hardening.getAgentBenchmark('agent-a');
            expect(bm.cascadeRate).toBeCloseTo(0.67, 1);
        });

        it('should get all agent benchmarks', () => {
            const id1 = hardening.startBenchmark('agent-a', 't', 10);
            hardening.completeBenchmark(id1, true, 10);
            const id2 = hardening.startBenchmark('agent-b', 't', 10);
            hardening.completeBenchmark(id2, true, 10);
            const all = hardening.getAllBenchmarks();
            expect(all.length).toBe(2);
        });

        it('should respect limit on getBenchmarkEntries', () => {
            for (let i = 0; i < 10; i++) {
                const id = hardening.startBenchmark('agent-a', 't', 10);
                hardening.completeBenchmark(id, true, 10);
            }
            expect(hardening.getBenchmarkEntries(3).length).toBe(3);
            expect(hardening.getBenchmarkEntries().length).toBe(10);
        });

        it('should return zero stats for no completed calls', () => {
            hardening.startBenchmark('agent-a', 't', 10);
            const bm = hardening.getAgentBenchmark('agent-a');
            expect(bm.totalCalls).toBe(0);
            expect(bm.avgDurationMs).toBe(0);
            expect(bm.p50DurationMs).toBe(0);
        });

        it('should ignore completeBenchmark for unknown id', () => {
            expect(() => hardening.completeBenchmark('nonexistent', true, 10)).not.toThrow();
        });

        it('should set lastCallAt to latest entry', () => {
            const id1 = hardening.startBenchmark('agent-a', 't', 10);
            hardening.completeBenchmark(id1, true, 10);
            const bm = hardening.getAgentBenchmark('agent-a');
            expect(bm.lastCallAt).toBeDefined();
        });
    });

    describe('Priority Queue', () => {
        it('should enqueue and dequeue in priority order', () => {
            hardening.enqueue('agent-a', 'low-msg', 'low');
            hardening.enqueue('agent-b', 'crit-msg', 'critical');
            hardening.enqueue('agent-c', 'norm-msg', 'normal');
            const first = hardening.dequeue();
            expect(first).not.toBeNull();
            expect(first!.priority).toBe('critical');
        });

        it('should dequeue critical before high before normal before low', () => {
            hardening.enqueue('a', 'm', 'low');
            hardening.enqueue('a', 'm', 'normal');
            hardening.enqueue('a', 'm', 'critical');
            hardening.enqueue('a', 'm', 'high');
            expect(hardening.dequeue()!.priority).toBe('critical');
            expect(hardening.dequeue()!.priority).toBe('high');
            expect(hardening.dequeue()!.priority).toBe('normal');
            expect(hardening.dequeue()!.priority).toBe('low');
        });

        it('should return null when queue is empty', () => {
            expect(hardening.dequeue()).toBeNull();
        });

        it('should complete request', () => {
            const id = hardening.enqueue('a', 'm');
            hardening.dequeue();
            hardening.completeRequest(id, 'done');
            const stats = hardening.getQueueStats();
            expect(stats.completed).toBe(1);
        });

        it('should fail request', () => {
            const id = hardening.enqueue('a', 'm');
            hardening.dequeue();
            hardening.failRequest(id, 'oops');
            const stats = hardening.getQueueStats();
            expect(stats.failed).toBe(1);
        });

        it('should report accurate queue stats', () => {
            hardening.enqueue('a', 'm1');
            hardening.enqueue('a', 'm2');
            hardening.enqueue('a', 'm3');
            const id = hardening.dequeue()!.id;
            hardening.completeRequest(id, 'ok');
            const stats = hardening.getQueueStats();
            expect(stats.queued).toBe(2);
            expect(stats.processing).toBe(0);
            expect(stats.completed).toBe(1);
            expect(stats.failed).toBe(0);
        });

        it('should clear queue', () => {
            hardening.enqueue('a', 'm');
            hardening.enqueue('a', 'm');
            hardening.clearQueue();
            expect(hardening.getQueueLength()).toBe(0);
        });

        it('should report queue length for queued items only', () => {
            hardening.enqueue('a', 'm');
            hardening.enqueue('a', 'm');
            hardening.dequeue();
            expect(hardening.getQueueLength()).toBe(1);
        });

        it('should maintain FIFO within same priority', () => {
            const id1 = hardening.enqueue('a', 'first', 'normal');
            const id2 = hardening.enqueue('a', 'second', 'normal');
            const first = hardening.dequeue();
            expect(first!.input).toBe('first');
            const second = hardening.dequeue();
            expect(second!.input).toBe('second');
        });

        it('should default to normal priority', () => {
            const id = hardening.enqueue('a', 'm');
            const req = hardening.dequeue();
            expect(req!.priority).toBe('normal');
        });
    });

    describe('Offline Mode', () => {
        it('should return cached response in offline mode', () => {
            hardening.cacheResponse('agent-a', 'hello', 'cached-reply');
            hardening.setOfflineMode(true);
            expect(hardening.getOfflineResponse('agent-a', 'hello')).toBe('cached-reply');
        });

        it('should return null for uncached in offline mode', () => {
            hardening.setOfflineMode(true);
            expect(hardening.getOfflineResponse('agent-a', 'nope')).toBeNull();
        });

        it('should toggle offline mode', () => {
            expect(hardening.isOffline()).toBe(false);
            hardening.setOfflineMode(true);
            expect(hardening.isOffline()).toBe(true);
            hardening.setOfflineMode(false);
            expect(hardening.isOffline()).toBe(false);
        });

        it('should return null from getOfflineResponse when online', () => {
            hardening.cacheResponse('agent-a', 'hello', 'cached');
            expect(hardening.getOfflineResponse('agent-a', 'hello')).toBeNull();
        });
    });

    describe('Reset', () => {
        it('should reset all state', () => {
            hardening.initCircuitBreaker('agent-a');
            hardening.registerCascadeRoute('planning', 'planner', []);
            hardening.cacheResponse('agent-a', 'x', 'y');
            hardening.startBenchmark('agent-a', 't', 10);
            hardening.enqueue('a', 'm');
            hardening.setOfflineMode(true);

            hardening.reset();

            expect(hardening.getAllCircuitBreakers().length).toBe(0);
            expect(hardening.getCascadeRoute('planning')).toBeUndefined();
            expect(hardening.getCacheStats().size).toBe(0);
            expect(hardening.getBenchmarkEntries().length).toBe(0);
            expect(hardening.getQueueLength()).toBe(0);
            expect(hardening.isOffline()).toBe(false);
        });
    });

    describe('Constructor Options', () => {
        it('should use default options when none provided', () => {
            const h = new OrchestratorHardening();
            expect(h.getCacheStats().maxSize).toBe(500);
        });

        it('should respect custom maxCacheSize', () => {
            const h = new OrchestratorHardening({ maxCacheSize: 10 });
            expect(h.getCacheStats().maxSize).toBe(10);
        });

        it('should trim benchmarks when exceeding max', () => {
            const h = new OrchestratorHardening({ maxBenchmarks: 3 });
            for (let i = 0; i < 5; i++) {
                h.startBenchmark('a', 't', 10);
            }
            expect(h.getBenchmarkEntries().length).toBeLessThanOrEqual(3);
        });
    });
});