/**
 * EvolutionIntelligence - Advanced pattern detection, auto-proposals, rollback, monitoring
 *
 * Analyzes agent behavior, task outcomes, and system metrics to:
 * 1. Detect recurring patterns (positive and negative)
 * 2. Auto-generate improvement proposals
 * 3. Monitor applied changes for 48 hours
 * 4. Rollback changes that degrade performance
 */

export interface Pattern {
    id: string;
    type: 'success' | 'failure' | 'bottleneck' | 'optimization' | 'regression';
    category: 'agent' | 'task' | 'verification' | 'planning' | 'system';
    title: string;
    description: string;
    occurrences: number;
    firstSeen: string;
    lastSeen: string;
    confidence: number;
    relatedEntities: Array<{ type: string; id: string }>;
    metrics: Record<string, number>;
}

export interface Proposal {
    id: string;
    patternId: string;
    type: 'directive_update' | 'config_change' | 'workflow_optimization' | 'agent_tuning' | 'task_template';
    title: string;
    description: string;
    impact: 'low' | 'medium' | 'high';
    risk: 'low' | 'medium' | 'high';
    status: 'pending' | 'approved' | 'applied' | 'monitoring' | 'rolled_back' | 'confirmed';
    changes: Array<{ target: string; field: string; oldValue: unknown; newValue: unknown }>;
    appliedAt?: string;
    monitoringEndAt?: string;
    rollbackReason?: string;
    metrics: { before: Record<string, number>; after: Record<string, number> };
}

export interface MonitoringWindow {
    proposalId: string;
    startTime: string;
    endTime: string;
    checkpoints: Array<{ time: string; metrics: Record<string, number>; status: 'improving' | 'stable' | 'degrading' }>;
    autoRollback: boolean;
    degradationThreshold: number;
}

export interface EvolutionReport {
    timestamp: string;
    patternsDetected: number;
    proposalsGenerated: number;
    proposalsApplied: number;
    proposalsRolledBack: number;
    systemHealth: number;
    trends: Array<{ metric: string; direction: 'improving' | 'stable' | 'degrading'; value: number }>;
}

export class EvolutionIntelligence {
    private patterns: Map<string, Pattern>;
    private proposals: Map<string, Proposal>;
    private monitoringWindows: Map<string, MonitoringWindow>;
    private metricsHistory: Array<{ timestamp: string; metrics: Record<string, number> }>;
    private idCounter: number;

    constructor() {
        this.patterns = new Map();
        this.proposals = new Map();
        this.monitoringWindows = new Map();
        this.metricsHistory = [];
        this.idCounter = 0;
    }

    private nextId(prefix: string): string {
        return `${prefix}-${++this.idCounter}`;
    }

    analyzeTaskOutcomes(tasks: Array<{ id: string; status: string; priority: string; estimated_minutes: number; title: string; created_at: string; updated_at: string; acceptance_criteria?: string }>): Pattern[] {
        const newPatterns: Pattern[] = [];
        const total = tasks.length;
        if (total === 0) return newPatterns;

        const failed = tasks.filter(t => t.status === 'failed');
        if (total > 5 && failed.length / total > 0.3) {
            const p = this.addPattern({
                type: 'failure', category: 'task',
                title: 'High task failure rate',
                description: `${Math.round(failed.length / total * 100)}% of tasks are failing (${failed.length}/${total})`,
                confidence: Math.min(1, failed.length / 10),
                relatedEntities: failed.map(t => ({ type: 'task', id: t.id })),
                metrics: { failureRate: failed.length / total, totalTasks: total, failedTasks: failed.length },
            });
            newPatterns.push(p);
        }

        const p1Tasks = tasks.filter(t => t.priority === 'P1');
        const longP1 = p1Tasks.filter(t => t.estimated_minutes > 60);
        if (longP1.length > 2) {
            const p = this.addPattern({
                type: 'bottleneck', category: 'task',
                title: 'P1 tasks exceeding time estimates',
                description: `${longP1.length} critical tasks estimated over 60 minutes`,
                confidence: Math.min(1, longP1.length / 5),
                relatedEntities: longP1.map(t => ({ type: 'task', id: t.id })),
                metrics: { longP1Count: longP1.length, avgMinutes: longP1.reduce((s, t) => s + t.estimated_minutes, 0) / longP1.length },
            });
            newPatterns.push(p);
        }

        const completed = tasks.filter(t => t.status === 'verified' || t.status === 'completed');
        if (completed.length > 10) {
            const p = this.addPattern({
                type: 'success', category: 'task',
                title: 'Healthy task completion rate',
                description: `${completed.length} tasks successfully completed`,
                confidence: Math.min(1, completed.length / 20),
                relatedEntities: completed.slice(0, 10).map(t => ({ type: 'task', id: t.id })),
                metrics: { completionRate: completed.length / total, completedTasks: completed.length },
            });
            newPatterns.push(p);
        }

        const blocked = tasks.filter(t => t.status === 'blocked');
        if (blocked.length > 3) {
            const p = this.addPattern({
                type: 'bottleneck', category: 'task',
                title: 'Multiple blocked tasks',
                description: `${blocked.length} tasks are currently blocked`,
                confidence: Math.min(1, blocked.length / 5),
                relatedEntities: blocked.map(t => ({ type: 'task', id: t.id })),
                metrics: { blockedCount: blocked.length, blockedRate: blocked.length / total },
            });
            newPatterns.push(p);
        }

        const noCriteria = tasks.filter(t => !t.acceptance_criteria || t.acceptance_criteria === '');
        if (noCriteria.length > total * 0.5 && total > 5) {
            const p = this.addPattern({
                type: 'optimization', category: 'planning',
                title: 'Low acceptance criteria coverage',
                description: `${Math.round(noCriteria.length / total * 100)}% of tasks lack acceptance criteria`,
                confidence: 0.9,
                relatedEntities: noCriteria.slice(0, 10).map(t => ({ type: 'task', id: t.id })),
                metrics: { noCriteriaRate: noCriteria.length / total, noCriteriaCount: noCriteria.length },
            });
            newPatterns.push(p);
        }

        return newPatterns;
    }

    analyzeAgentPerformance(agents: Array<{ name: string; total_calls: number; successful_calls: number; failed_calls: number; avg_response_time: number }>): Pattern[] {
        const newPatterns: Pattern[] = [];
        for (const agent of agents) {
            if (agent.total_calls < 5) continue;
            const successRate = agent.successful_calls / agent.total_calls;
            if (successRate < 0.7) {
                newPatterns.push(this.addPattern({
                    type: 'failure', category: 'agent',
                    title: `Agent "${agent.name}" has low success rate`,
                    description: `${Math.round(successRate * 100)}% success rate over ${agent.total_calls} calls`,
                    confidence: Math.min(1, agent.total_calls / 20),
                    relatedEntities: [{ type: 'agent', id: agent.name }],
                    metrics: { successRate, totalCalls: agent.total_calls, failedCalls: agent.failed_calls },
                }));
            }
            if (agent.avg_response_time > 30000) {
                newPatterns.push(this.addPattern({
                    type: 'bottleneck', category: 'agent',
                    title: `Agent "${agent.name}" has slow response time`,
                    description: `Average ${Math.round(agent.avg_response_time / 1000)}s response time`,
                    confidence: Math.min(1, agent.total_calls / 10),
                    relatedEntities: [{ type: 'agent', id: agent.name }],
                    metrics: { avgResponseTime: agent.avg_response_time, totalCalls: agent.total_calls },
                }));
            }
        }
        return newPatterns;
    }

    generateProposals(): Proposal[] {
        const newProposals: Proposal[] = [];
        for (const [, pattern] of this.patterns) {
            if (pattern.confidence < 0.5) continue;
            const existing = [...this.proposals.values()].find(p => p.patternId === pattern.id && p.status !== 'rolled_back');
            if (existing) continue;
            let proposal: Partial<Proposal> | null = null;
            if (pattern.type === 'failure' && pattern.category === 'task') {
                proposal = { type: 'workflow_optimization', title: 'Improve task success rate',
                    description: `Pattern: ${pattern.description}. Suggested: Add pre-flight checks.`,
                    impact: 'high', risk: 'low',
                    changes: [{ target: 'config', field: 'tasks.maxEstimatedMinutes', oldValue: 120, newValue: 45 },
                        { target: 'config', field: 'verification.autoVerify', oldValue: false, newValue: true }] };
            } else if (pattern.type === 'bottleneck' && pattern.category === 'task') {
                proposal = { type: 'task_template', title: 'Auto-decompose bottleneck tasks',
                    description: `Pattern: ${pattern.description}. Suggested: Auto-decompose tasks > 45 min.`,
                    impact: 'medium', risk: 'low',
                    changes: [{ target: 'config', field: 'tasks.autoDecompose', oldValue: false, newValue: true }] };
            } else if (pattern.type === 'bottleneck' && pattern.category === 'agent') {
                proposal = { type: 'agent_tuning', title: 'Optimize slow agent',
                    description: `Pattern: ${pattern.description}. Suggested: Reduce max tokens, add caching.`,
                    impact: 'medium', risk: 'medium',
                    changes: [{ target: 'agent', field: 'maxTokens', oldValue: 4096, newValue: 2048 }] };
            } else if (pattern.type === 'optimization' && pattern.category === 'planning') {
                proposal = { type: 'directive_update', title: 'Enforce acceptance criteria',
                    description: `Pattern: ${pattern.description}. Suggested: Require acceptance criteria.`,
                    impact: 'high', risk: 'low',
                    changes: [{ target: 'directive', field: 'requireAcceptanceCriteria', oldValue: false, newValue: true }] };
            } else if (pattern.type === 'failure' && pattern.category === 'agent') {
                proposal = { type: 'agent_tuning', title: 'Fix failing agent',
                    description: `Pattern: ${pattern.description}. Suggested: Add error handling, increase retries.`,
                    impact: 'high', risk: 'medium',
                    changes: [{ target: 'agent', field: 'maxRetries', oldValue: 1, newValue: 3 }] };
            }
            if (proposal) {
                const id = this.nextId('prop');
                const full: Proposal = { id, patternId: pattern.id, status: 'pending',
                    metrics: { before: {}, after: {} },
                    ...(proposal as Omit<Proposal, 'id' | 'patternId' | 'status' | 'metrics'>) };
                this.proposals.set(id, full);
                newProposals.push(full);
            }
        }
        return newProposals;
    }

    applyProposal(proposalId: string): MonitoringWindow | null {
        const proposal = this.proposals.get(proposalId);
        if (!proposal || (proposal.status !== 'pending' && proposal.status !== 'approved')) return null;
        proposal.status = 'applied';
        proposal.appliedAt = new Date().toISOString();
        const now = new Date();
        const endTime = new Date(now.getTime() + 48 * 60 * 60 * 1000);
        proposal.monitoringEndAt = endTime.toISOString();
        const window: MonitoringWindow = { proposalId, startTime: now.toISOString(),
            endTime: endTime.toISOString(), checkpoints: [], autoRollback: true, degradationThreshold: 20 };
        this.monitoringWindows.set(proposalId, window);
        proposal.status = 'monitoring';
        return window;
    }

    recordCheckpoint(proposalId: string, metrics: Record<string, number>): MonitoringWindow | null {
        const window = this.monitoringWindows.get(proposalId);
        if (!window) return null;
        const proposal = this.proposals.get(proposalId);
        if (!proposal) return null;
        let status: 'improving' | 'stable' | 'degrading' = 'stable';
        if (window.checkpoints.length > 0) {
            const prev = window.checkpoints[window.checkpoints.length - 1].metrics;
            let improvements = 0; let degradations = 0; let total = 0;
            for (const key of Object.keys(metrics)) {
                if (prev[key] !== undefined) {
                    total++;
                    const change = ((metrics[key] - prev[key]) / Math.max(prev[key], 1)) * 100;
                    if (change > 5) improvements++;
                    else if (change < -5) degradations++;
                }
            }
            if (total > 0) {
                if (degradations > improvements) status = 'degrading';
                else if (improvements > degradations) status = 'improving';
            }
        }
        window.checkpoints.push({ time: new Date().toISOString(), metrics, status });
        if (window.checkpoints.length === 1) { proposal.metrics.before = { ...metrics }; }
        proposal.metrics.after = { ...metrics };
        if (window.autoRollback && status === 'degrading') {
            const degradingCount = window.checkpoints.filter(c => c.status === 'degrading').length;
            if (degradingCount >= 3) {
                this.rollbackProposal(proposalId, 'Auto-rollback: 3 consecutive degrading checkpoints');
            }
        }
        return window;
    }

    rollbackProposal(proposalId: string, reason: string): boolean {
        const proposal = this.proposals.get(proposalId);
        if (!proposal) return false;
        if (proposal.status !== 'monitoring' && proposal.status !== 'applied') return false;
        proposal.status = 'rolled_back';
        proposal.rollbackReason = reason;
        this.monitoringWindows.delete(proposalId);
        return true;
    }

    confirmProposal(proposalId: string): boolean {
        const proposal = this.proposals.get(proposalId);
        if (!proposal || proposal.status !== 'monitoring') return false;
        proposal.status = 'confirmed';
        this.monitoringWindows.delete(proposalId);
        return true;
    }

    recordMetrics(metrics: Record<string, number>): void {
        this.metricsHistory.push({ timestamp: new Date().toISOString(), metrics: { ...metrics } });
        if (this.metricsHistory.length > 1000) { this.metricsHistory.shift(); }
    }

    detectTrends(): Array<{ metric: string; direction: 'improving' | 'stable' | 'degrading'; value: number; change: number }> {
        if (this.metricsHistory.length < 5) return [];
        const recent = this.metricsHistory.slice(-10);
        const older = this.metricsHistory.slice(-20, -10);
        if (older.length === 0) return [];
        const trends: Array<{ metric: string; direction: 'improving' | 'stable' | 'degrading'; value: number; change: number }> = [];
        const allKeys = new Set<string>();
        for (const entry of [...recent, ...older]) { for (const key of Object.keys(entry.metrics)) allKeys.add(key); }
        for (const key of allKeys) {
            const recentAvg = recent.reduce((s, e) => s + (e.metrics[key] || 0), 0) / recent.length;
            const olderAvg = older.reduce((s, e) => s + (e.metrics[key] || 0), 0) / older.length;
            const change = olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;
            let direction: 'improving' | 'stable' | 'degrading' = 'stable';
            if (change > 10) direction = 'improving';
            else if (change < -10) direction = 'degrading';
            trends.push({ metric: key, direction, value: recentAvg, change: Math.round(change * 100) / 100 });
        }
        return trends;
    }

    generateReport(): EvolutionReport {
        const patterns = [...this.patterns.values()];
        const proposals = [...this.proposals.values()];
        const trends = this.detectTrends();
        const successPatterns = patterns.filter(p => p.type === 'success').length;
        const failurePatterns = patterns.filter(p => p.type === 'failure' || p.type === 'regression').length;
        const totalPatterns = patterns.length || 1;
        const healthFromPatterns = ((successPatterns - failurePatterns * 2) / totalPatterns + 1) * 50;
        const rolledBack = proposals.filter(p => p.status === 'rolled_back').length;
        const confirmed = proposals.filter(p => p.status === 'confirmed').length;
        const healthFromProposals = proposals.length > 0 ? (confirmed / (confirmed + rolledBack + 1)) * 100 : 50;
        const systemHealth = Math.max(0, Math.min(100, Math.round((healthFromPatterns + healthFromProposals) / 2)));
        return {
            timestamp: new Date().toISOString(),
            patternsDetected: patterns.length,
            proposalsGenerated: proposals.length,
            proposalsApplied: proposals.filter(p => ['applied', 'monitoring', 'confirmed'].includes(p.status)).length,
            proposalsRolledBack: rolledBack,
            systemHealth,
            trends: trends.map(t => ({ metric: t.metric, direction: t.direction, value: t.value })),
        };
    }

    getPattern(id: string): Pattern | undefined { return this.patterns.get(id); }
    getAllPatterns(): Pattern[] { return [...this.patterns.values()]; }
    getProposal(id: string): Proposal | undefined { return this.proposals.get(id); }
    getAllProposals(): Proposal[] { return [...this.proposals.values()]; }
    getMonitoringWindow(proposalId: string): MonitoringWindow | undefined { return this.monitoringWindows.get(proposalId); }
    getActiveMonitoring(): MonitoringWindow[] { return [...this.monitoringWindows.values()]; }
    getMetricsHistory(): Array<{ timestamp: string; metrics: Record<string, number> }> { return [...this.metricsHistory]; }

    private addPattern(data: Omit<Pattern, 'id' | 'occurrences' | 'firstSeen' | 'lastSeen'>): Pattern {
        const existing = [...this.patterns.values()].find(p => p.title === data.title);
        if (existing) {
            existing.occurrences++;
            existing.lastSeen = new Date().toISOString();
            existing.confidence = Math.min(1, existing.confidence + 0.1);
            existing.metrics = { ...existing.metrics, ...data.metrics };
            return existing;
        }
        const id = this.nextId('pat');
        const pattern: Pattern = {
            id, occurrences: 1,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            ...data,
        };
        this.patterns.set(id, pattern);
        return pattern;
    }

    reset(): void {
        this.patterns.clear();
        this.proposals.clear();
        this.monitoringWindows.clear();
        this.metricsHistory = [];
        this.idCounter = 0;
    }
}
