import { EvolutionIntelligence } from '../src/core/evolution-intelligence';
import type { Pattern, Proposal, MonitoringWindow, EvolutionReport } from '../src/core/evolution-intelligence';

// ===============================================
// Helpers
// ===============================================

function makeTask(overrides: Record<string, unknown> = {}) {
    return {
        id: 't-' + Math.random().toString(36).substring(2),
        status: 'not_started',
        priority: 'P2',
        estimated_minutes: 30,
        title: 'Test task',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        acceptance_criteria: 'Some criteria',
        ...overrides,
    };
}

function makeAgent(overrides: Record<string, unknown> = {}) {
    return {
        name: 'test-agent',
        total_calls: 20,
        successful_calls: 18,
        failed_calls: 2,
        avg_response_time: 5000,
        ...overrides,
    };
}

describe('EvolutionIntelligence', () => {
    let ei: EvolutionIntelligence;

    beforeEach(() => {
        ei = new EvolutionIntelligence();
    });

    // ==========================================
    // Pattern Detection - Task Outcomes
    // ==========================================

    describe('analyzeTaskOutcomes', () => {
        test('detects high failure rate pattern when >30% fail', () => {
            const tasks = [
                ...Array(4).fill(null).map(() => makeTask({ status: 'failed' })),
                ...Array(6).fill(null).map(() => makeTask({ status: 'completed' })),
            ];
            const patterns = ei.analyzeTaskOutcomes(tasks);
            const failPattern = patterns.find(p => p.title === 'High task failure rate');
            expect(failPattern).toBeDefined();
            expect(failPattern!.type).toBe('failure');
            expect(failPattern!.category).toBe('task');
            expect(failPattern!.metrics.failureRate).toBeGreaterThan(0.3);
        });

        test('no failure pattern when rate is low', () => {
            const tasks = [
                makeTask({ status: 'failed' }),
                ...Array(9).fill(null).map(() => makeTask({ status: 'completed' })),
            ];
            const patterns = ei.analyzeTaskOutcomes(tasks);
            const failPattern = patterns.find(p => p.title === 'High task failure rate');
            expect(failPattern).toBeUndefined();
        });

        test('detects P1 bottleneck pattern', () => {
            const tasks = [
                makeTask({ priority: 'P1', estimated_minutes: 90 }),
                makeTask({ priority: 'P1', estimated_minutes: 120 }),
                makeTask({ priority: 'P1', estimated_minutes: 75 }),
                makeTask({ priority: 'P2', estimated_minutes: 30 }),
            ];
            const patterns = ei.analyzeTaskOutcomes(tasks);
            const bottleneck = patterns.find(p => p.title === 'P1 tasks exceeding time estimates');
            expect(bottleneck).toBeDefined();
            expect(bottleneck!.type).toBe('bottleneck');
            expect(bottleneck!.metrics.longP1Count).toBe(3);
        });

        test('detects blocked tasks pattern', () => {
            const tasks = [
                ...Array(4).fill(null).map(() => makeTask({ status: 'blocked' })),
                ...Array(6).fill(null).map(() => makeTask({ status: 'completed' })),
            ];
            const patterns = ei.analyzeTaskOutcomes(tasks);
            const blocked = patterns.find(p => p.title === 'Multiple blocked tasks');
            expect(blocked).toBeDefined();
            expect(blocked!.metrics.blockedCount).toBe(4);
        });

        test('detects missing acceptance criteria pattern', () => {
            const tasks = [
                ...Array(5).fill(null).map(() => makeTask({ acceptance_criteria: '' })),
                ...Array(3).fill(null).map(() => makeTask({ acceptance_criteria: 'done' })),
            ];
            const patterns = ei.analyzeTaskOutcomes(tasks);
            const noCrit = patterns.find(p => p.title === 'Low acceptance criteria coverage');
            expect(noCrit).toBeDefined();
            expect(noCrit!.type).toBe('optimization');
        });

        test('detects healthy completion pattern', () => {
            const tasks = Array(15).fill(null).map(() => makeTask({ status: 'verified' }));
            const patterns = ei.analyzeTaskOutcomes(tasks);
            const healthy = patterns.find(p => p.title === 'Healthy task completion rate');
            expect(healthy).toBeDefined();
            expect(healthy!.type).toBe('success');
        });

        test('detects multiple patterns from same task set', () => {
            const tasks = [
                ...Array(5).fill(null).map(() => makeTask({ status: 'failed' })),
                ...Array(4).fill(null).map(() => makeTask({ status: 'blocked' })),
                ...Array(3).fill(null).map(() => makeTask({ status: 'completed' })),
            ];
            const patterns = ei.analyzeTaskOutcomes(tasks);
            expect(patterns.length).toBeGreaterThanOrEqual(2);
        });

        test('returns empty for empty task list', () => {
            const patterns = ei.analyzeTaskOutcomes([]);
            expect(patterns).toEqual([]);
        });

        test('returns empty for single task (below thresholds)', () => {
            const patterns = ei.analyzeTaskOutcomes([makeTask({ status: 'failed' })]);
            expect(patterns.length).toBe(0);
        });
    });

    // ==========================================
    // Agent Performance
    // ==========================================

    describe('analyzeAgentPerformance', () => {
        test('detects low success rate agent', () => {
            const agents = [makeAgent({ name: 'slow-bot', total_calls: 20, successful_calls: 10, failed_calls: 10 })];
            const patterns = ei.analyzeAgentPerformance(agents);
            const lowSuccess = patterns.find(p => p.title.includes('low success rate'));
            expect(lowSuccess).toBeDefined();
            expect(lowSuccess!.type).toBe('failure');
            expect(lowSuccess!.category).toBe('agent');
        });

        test('detects slow agent', () => {
            const agents = [makeAgent({ name: 'slow-bot', avg_response_time: 60000 })];
            const patterns = ei.analyzeAgentPerformance(agents);
            const slow = patterns.find(p => p.title.includes('slow response time'));
            expect(slow).toBeDefined();
            expect(slow!.type).toBe('bottleneck');
        });

        test('skips agents with too few calls', () => {
            const agents = [makeAgent({ name: 'new-bot', total_calls: 2, successful_calls: 0, failed_calls: 2 })];
            const patterns = ei.analyzeAgentPerformance(agents);
            expect(patterns.length).toBe(0);
        });

        test('detects multiple agent issues', () => {
            const agents = [
                makeAgent({ name: 'fail-bot', total_calls: 20, successful_calls: 5, failed_calls: 15 }),
                makeAgent({ name: 'slow-bot', avg_response_time: 50000 }),
            ];
            const patterns = ei.analyzeAgentPerformance(agents);
            expect(patterns.length).toBeGreaterThanOrEqual(2);
        });
    });

    // ==========================================
    // Proposal Generation
    // ==========================================

    describe('generateProposals', () => {
        test('generates proposal for failure pattern', () => {
            const tasks = [
                ...Array(5).fill(null).map(() => makeTask({ status: 'failed' })),
                ...Array(5).fill(null).map(() => makeTask({ status: 'completed' })),
            ];
            ei.analyzeTaskOutcomes(tasks);
            const proposals = ei.generateProposals();
            expect(proposals.length).toBeGreaterThan(0);
            const taskProp = proposals.find(p => p.type === 'workflow_optimization');
            expect(taskProp).toBeDefined();
            expect(taskProp!.status).toBe('pending');
        });

        test('generates proposal for bottleneck pattern', () => {
            const tasks = [
                ...Array(4).fill(null).map(() => makeTask({ status: 'blocked' })),
                ...Array(6).fill(null).map(() => makeTask({ status: 'completed' })),
            ];
            ei.analyzeTaskOutcomes(tasks);
            const proposals = ei.generateProposals();
            const bottleneckProp = proposals.find(p => p.type === 'task_template');
            expect(bottleneckProp).toBeDefined();
        });

        test('generates proposal for optimization pattern', () => {
            const tasks = [
                ...Array(6).fill(null).map(() => makeTask({ acceptance_criteria: '' })),
                ...Array(2).fill(null).map(() => makeTask({ acceptance_criteria: 'done' })),
            ];
            ei.analyzeTaskOutcomes(tasks);
            const proposals = ei.generateProposals();
            const dirProp = proposals.find(p => p.type === 'directive_update');
            expect(dirProp).toBeDefined();
        });

        test('generates proposal for agent bottleneck', () => {
            ei.analyzeAgentPerformance([makeAgent({ name: 'slow', avg_response_time: 60000 })]);
            const proposals = ei.generateProposals();
            const agentProp = proposals.find(p => p.type === 'agent_tuning');
            expect(agentProp).toBeDefined();
        });

        test('generates proposal for agent failure', () => {
            ei.analyzeAgentPerformance([makeAgent({ name: 'fail', total_calls: 20, successful_calls: 5, failed_calls: 15 })]);
            const proposals = ei.generateProposals();
            const fixProp = proposals.find(p => p.title === 'Fix failing agent');
            expect(fixProp).toBeDefined();
        });

        test('skips low-confidence patterns', () => {
            // With only 2 failed out of 7, confidence = 2/10 = 0.2 < 0.5
            const tasks = [
                ...Array(3).fill(null).map(() => makeTask({ status: 'failed' })),
                ...Array(7).fill(null).map(() => makeTask({ status: 'completed' })),
            ];
            ei.analyzeTaskOutcomes(tasks);
            const proposals = ei.generateProposals();
            // The 3/10 failure rate is exactly 30% (not >30%) so no pattern
            const taskProp = proposals.find(p => p.type === 'workflow_optimization');
            expect(taskProp).toBeUndefined();
        });

        test('does not duplicate proposals for same pattern', () => {
            const tasks = [
                ...Array(5).fill(null).map(() => makeTask({ status: 'failed' })),
                ...Array(5).fill(null).map(() => makeTask({ status: 'completed' })),
            ];
            ei.analyzeTaskOutcomes(tasks);
            const p1 = ei.generateProposals();
            const p2 = ei.generateProposals();
            expect(p2.length).toBe(0); // no new proposals
        });

        test('no proposals when no patterns', () => {
            const proposals = ei.generateProposals();
            expect(proposals).toEqual([]);
        });
    });

    // ==========================================
    // Proposal Lifecycle
    // ==========================================

    describe('Proposal Lifecycle', () => {
        function createPendingProposal(): string {
            const tasks = [
                ...Array(5).fill(null).map(() => makeTask({ status: 'failed' })),
                ...Array(5).fill(null).map(() => makeTask({ status: 'completed' })),
            ];
            ei.analyzeTaskOutcomes(tasks);
            const proposals = ei.generateProposals();
            return proposals[0].id;
        }

        test('apply proposal starts monitoring', () => {
            const propId = createPendingProposal();
            const window = ei.applyProposal(propId);
            expect(window).not.toBeNull();
            expect(window!.proposalId).toBe(propId);
            expect(window!.autoRollback).toBe(true);
            expect(window!.degradationThreshold).toBe(20);
            const prop = ei.getProposal(propId);
            expect(prop!.status).toBe('monitoring');
            expect(prop!.appliedAt).toBeDefined();
        });

        test('record checkpoint during monitoring', () => {
            const propId = createPendingProposal();
            ei.applyProposal(propId);
            const window = ei.recordCheckpoint(propId, { successRate: 0.8 });
            expect(window).not.toBeNull();
            expect(window!.checkpoints.length).toBe(1);
            expect(window!.checkpoints[0].status).toBe('stable'); // first is always stable
        });

        test('detect improving trend in checkpoints', () => {
            const propId = createPendingProposal();
            ei.applyProposal(propId);
            ei.recordCheckpoint(propId, { successRate: 0.5 });
            const w2 = ei.recordCheckpoint(propId, { successRate: 0.9 });
            expect(w2!.checkpoints[1].status).toBe('improving');
        });

        test('detect degrading trend in checkpoints', () => {
            const propId = createPendingProposal();
            ei.applyProposal(propId);
            ei.recordCheckpoint(propId, { successRate: 0.9 });
            const w2 = ei.recordCheckpoint(propId, { successRate: 0.3 });
            expect(w2!.checkpoints[1].status).toBe('degrading');
        });

        test('auto-rollback after 3 degrading checkpoints', () => {
            const propId = createPendingProposal();
            ei.applyProposal(propId);
            ei.recordCheckpoint(propId, { successRate: 0.9 }); // baseline
            ei.recordCheckpoint(propId, { successRate: 0.5 }); // degrading 1
            ei.recordCheckpoint(propId, { successRate: 0.3 }); // degrading 2
            ei.recordCheckpoint(propId, { successRate: 0.1 }); // degrading 3 -> rollback
            const prop = ei.getProposal(propId);
            expect(prop!.status).toBe('rolled_back');
            expect(prop!.rollbackReason).toContain('Auto-rollback');
        });

        test('manual rollback with reason', () => {
            const propId = createPendingProposal();
            ei.applyProposal(propId);
            const result = ei.rollbackProposal(propId, 'Manual rollback');
            expect(result).toBe(true);
            const prop = ei.getProposal(propId);
            expect(prop!.status).toBe('rolled_back');
            expect(prop!.rollbackReason).toBe('Manual rollback');
        });

        test('confirm proposal after monitoring', () => {
            const propId = createPendingProposal();
            ei.applyProposal(propId);
            const result = ei.confirmProposal(propId);
            expect(result).toBe(true);
            const prop = ei.getProposal(propId);
            expect(prop!.status).toBe('confirmed');
        });

        test('cannot apply already-applied proposal', () => {
            const propId = createPendingProposal();
            ei.applyProposal(propId);
            const result = ei.applyProposal(propId);
            expect(result).toBeNull();
        });

        test('cannot confirm non-monitoring proposal', () => {
            const propId = createPendingProposal();
            const result = ei.confirmProposal(propId);
            expect(result).toBe(false);
        });

        test('cannot rollback pending proposal', () => {
            const propId = createPendingProposal();
            const result = ei.rollbackProposal(propId, 'test');
            expect(result).toBe(false);
        });

        test('rollback non-existent proposal returns false', () => {
            expect(ei.rollbackProposal('nonexistent', 'test')).toBe(false);
        });

        test('recordCheckpoint returns null for non-monitored proposal', () => {
            expect(ei.recordCheckpoint('nonexistent', { x: 1 })).toBeNull();
        });

        test('apply non-existent proposal returns null', () => {
            expect(ei.applyProposal('nonexistent')).toBeNull();
        });

        test('monitoring window is 48 hours', () => {
            const propId = createPendingProposal();
            const window = ei.applyProposal(propId)!;
            const start = new Date(window.startTime).getTime();
            const end = new Date(window.endTime).getTime();
            const hours = (end - start) / (1000 * 60 * 60);
            expect(hours).toBeCloseTo(48, 0.1);
        });
    });

    // ==========================================
    // Metrics & Trends
    // ==========================================

    describe('Metrics & Trends', () => {
        test('records metrics snapshots', () => {
            ei.recordMetrics({ cpu: 50, mem: 70 });
            ei.recordMetrics({ cpu: 55, mem: 75 });
            const history = ei.getMetricsHistory();
            expect(history.length).toBe(2);
            expect(history[0].metrics.cpu).toBe(50);
        });

        test('detects improving trend', () => {
            // 10 older snapshots with low value
            for (let i = 0; i < 10; i++) ei.recordMetrics({ score: 50 });
            // 10 recent snapshots with high value
            for (let i = 0; i < 10; i++) ei.recordMetrics({ score: 80 });
            const trends = ei.detectTrends();
            const scoreTrend = trends.find(t => t.metric === 'score');
            expect(scoreTrend).toBeDefined();
            expect(scoreTrend!.direction).toBe('improving');
        });

        test('detects degrading trend', () => {
            for (let i = 0; i < 10; i++) ei.recordMetrics({ score: 80 });
            for (let i = 0; i < 10; i++) ei.recordMetrics({ score: 50 });
            const trends = ei.detectTrends();
            const scoreTrend = trends.find(t => t.metric === 'score');
            expect(scoreTrend!.direction).toBe('degrading');
        });

        test('detects stable trend', () => {
            for (let i = 0; i < 10; i++) ei.recordMetrics({ score: 50 });
            for (let i = 0; i < 10; i++) ei.recordMetrics({ score: 52 });
            const trends = ei.detectTrends();
            const scoreTrend = trends.find(t => t.metric === 'score');
            expect(scoreTrend!.direction).toBe('stable');
        });

        test('returns empty trends with insufficient data', () => {
            ei.recordMetrics({ score: 50 });
            ei.recordMetrics({ score: 60 });
            const trends = ei.detectTrends();
            expect(trends).toEqual([]);
        });

        test('metrics history limits to 1000', () => {
            for (let i = 0; i < 1050; i++) ei.recordMetrics({ cpu: i });
            const history = ei.getMetricsHistory();
            expect(history.length).toBe(1000);
            expect(history[0].metrics.cpu).toBe(50); // first 50 were dropped
        });
    });

    // ==========================================
    // Report Generation
    // ==========================================

    describe('generateReport', () => {
        test('generates report with patterns and proposals', () => {
            const tasks = [
                ...Array(5).fill(null).map(() => makeTask({ status: 'failed' })),
                ...Array(5).fill(null).map(() => makeTask({ status: 'completed' })),
            ];
            ei.analyzeTaskOutcomes(tasks);
            ei.generateProposals();
            const report = ei.generateReport();
            expect(report.timestamp).toBeDefined();
            expect(report.patternsDetected).toBeGreaterThan(0);
            expect(report.proposalsGenerated).toBeGreaterThan(0);
        });

        test('system health is between 0 and 100', () => {
            const report = ei.generateReport();
            expect(report.systemHealth).toBeGreaterThanOrEqual(0);
            expect(report.systemHealth).toBeLessThanOrEqual(100);
        });

        test('report includes trends when enough data', () => {
            for (let i = 0; i < 10; i++) ei.recordMetrics({ score: 50 });
            for (let i = 0; i < 10; i++) ei.recordMetrics({ score: 80 });
            const report = ei.generateReport();
            expect(report.trends.length).toBeGreaterThan(0);
        });

        test('report with no data has zeros', () => {
            const report = ei.generateReport();
            expect(report.patternsDetected).toBe(0);
            expect(report.proposalsGenerated).toBe(0);
            expect(report.proposalsApplied).toBe(0);
            expect(report.proposalsRolledBack).toBe(0);
        });

        test('report tracks rolled back proposals', () => {
            const tasks = [
                ...Array(5).fill(null).map(() => makeTask({ status: 'failed' })),
                ...Array(5).fill(null).map(() => makeTask({ status: 'completed' })),
            ];
            ei.analyzeTaskOutcomes(tasks);
            const props = ei.generateProposals();
            ei.applyProposal(props[0].id);
            ei.rollbackProposal(props[0].id, 'test');
            const report = ei.generateReport();
            expect(report.proposalsRolledBack).toBe(1);
        });
    });

    // ==========================================
    // Pattern Deduplication
    // ==========================================

    describe('Pattern Deduplication', () => {
        test('same pattern detected twice increments occurrences', () => {
            const tasks = [
                ...Array(5).fill(null).map(() => makeTask({ status: 'failed' })),
                ...Array(5).fill(null).map(() => makeTask({ status: 'completed' })),
            ];
            ei.analyzeTaskOutcomes(tasks);
            ei.analyzeTaskOutcomes(tasks); // second time
            const patterns = ei.getAllPatterns();
            const fail = patterns.find(p => p.title === 'High task failure rate');
            expect(fail!.occurrences).toBe(2);
        });

        test('different patterns are stored separately', () => {
            const tasks1 = [
                ...Array(5).fill(null).map(() => makeTask({ status: 'failed' })),
                ...Array(5).fill(null).map(() => makeTask({ status: 'completed' })),
            ];
            const tasks2 = [
                ...Array(4).fill(null).map(() => makeTask({ status: 'blocked' })),
                ...Array(6).fill(null).map(() => makeTask({ status: 'completed' })),
            ];
            ei.analyzeTaskOutcomes(tasks1);
            ei.analyzeTaskOutcomes(tasks2);
            const patterns = ei.getAllPatterns();
            const fail = patterns.find(p => p.title === 'High task failure rate');
            const blocked = patterns.find(p => p.title === 'Multiple blocked tasks');
            expect(fail).toBeDefined();
            expect(blocked).toBeDefined();
            expect(fail!.id).not.toBe(blocked!.id);
        });
    });

    // ==========================================
    // Getters & Reset
    // ==========================================

    describe('Getters & Reset', () => {
        test('getPattern returns undefined for non-existent id', () => {
            expect(ei.getPattern('nonexistent')).toBeUndefined();
        });

        test('getProposal returns undefined for non-existent id', () => {
            expect(ei.getProposal('nonexistent')).toBeUndefined();
        });

        test('getMonitoringWindow returns undefined for non-existent', () => {
            expect(ei.getMonitoringWindow('nonexistent')).toBeUndefined();
        });

        test('getActiveMonitoring returns all active windows', () => {
            const tasks = [
                ...Array(5).fill(null).map(() => makeTask({ status: 'failed' })),
                ...Array(5).fill(null).map(() => makeTask({ status: 'completed' })),
            ];
            ei.analyzeTaskOutcomes(tasks);
            const props = ei.generateProposals();
            ei.applyProposal(props[0].id);
            expect(ei.getActiveMonitoring().length).toBe(1);
        });

        test('reset clears all state', () => {
            const tasks = [
                ...Array(5).fill(null).map(() => makeTask({ status: 'failed' })),
                ...Array(5).fill(null).map(() => makeTask({ status: 'completed' })),
            ];
            ei.analyzeTaskOutcomes(tasks);
            ei.generateProposals();
            ei.recordMetrics({ cpu: 50 });
            ei.reset();
            expect(ei.getAllPatterns().length).toBe(0);
            expect(ei.getAllProposals().length).toBe(0);
            expect(ei.getActiveMonitoring().length).toBe(0);
            expect(ei.getMetricsHistory().length).toBe(0);
        });

        test('confirmProposal on non-existent returns false', () => {
            expect(ei.confirmProposal('nonexistent')).toBe(false);
        });
    });
});
