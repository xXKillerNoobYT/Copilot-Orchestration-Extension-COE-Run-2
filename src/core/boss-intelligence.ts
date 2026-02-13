/**
 * BossIntelligence — Supervisory intelligence for the Boss Agent
 * 
 * Monitors team health, detects conflicts, enforces plan alignment,
 * manages workload distribution, and provides leadership insights.
 */

export interface TeamMember {
    name: string;
    role: "planning" | "coding" | "verification" | "research" | "orchestration" | "custom";
    status: "active" | "idle" | "overloaded" | "error" | "offline";
    currentTask?: string;
    taskCount: number;
    successRate: number;
    avgResponseTime: number;
    lastActive: string;
    specializations: string[];
}

export interface TeamHealth {
    overallScore: number;
    grade: "A" | "B" | "C" | "D" | "F";
    members: TeamMember[];
    activeCount: number;
    idleCount: number;
    overloadedCount: number;
    errorCount: number;
    avgSuccessRate: number;
    avgResponseTime: number;
    bottlenecks: string[];
    recommendations: string[];
}

export interface Conflict {
    id: string;
    type: "resource" | "dependency" | "priority" | "deadline" | "scope";
    severity: "low" | "medium" | "high" | "critical";
    title: string;
    description: string;
    involvedEntities: Array<{ type: string; id: string; name: string }>;
    suggestedResolution: string;
    status: "detected" | "acknowledged" | "resolving" | "resolved";
    detectedAt: string;
    resolvedAt?: string;
}

export interface PlanAlignment {
    planId: string;
    planName: string;
    alignmentScore: number;
    onTrack: boolean;
    drift: Array<{ area: string; expected: string; actual: string; severity: "minor" | "moderate" | "major" }>;
    milestones: Array<{ name: string; targetDate?: string; status: "ahead" | "on_track" | "behind" | "at_risk" | "completed" }>;
    risks: string[];
    actionItems: string[];
}

export interface WorkloadDistribution {
    members: Array<{ name: string; taskCount: number; estimatedHours: number; capacityUsed: number }>;
    balanced: boolean;
    overloadedMembers: string[];
    underutilizedMembers: string[];
    recommendations: Array<{ from: string; to: string; taskId: string; reason: string }>;
}

export interface LeadershipInsight {
    category: "productivity" | "quality" | "velocity" | "morale" | "risk";
    title: string;
    description: string;
    metric: number;
    trend: "improving" | "stable" | "declining";
    actionable: boolean;
    suggestedAction?: string;
}

export class BossIntelligence {
    private conflicts: Map<string, Conflict>;
    private insights: LeadershipInsight[];
    private alignmentHistory: PlanAlignment[];
    private idCounter: number;

    constructor() {
        this.conflicts = new Map();
        this.insights = [];
        this.alignmentHistory = [];
        this.idCounter = 0;
    }

    private nextId(prefix: string): string {
        return `${prefix}-${++this.idCounter}`;
    }

    assessTeamHealth(agents: Array<{ name: string; status: string; total_calls: number; successful_calls: number; failed_calls: number; avg_response_time: number }>): TeamHealth {
        const members: TeamMember[] = agents.map(a => {
            const successRate = a.total_calls > 0 ? a.successful_calls / a.total_calls : 1;
            let status: TeamMember["status"] = "active";
            if (a.status === "error") status = "error";
            else if (a.failed_calls > a.successful_calls) status = "overloaded";
            else if (a.total_calls === 0) status = "idle";

            const roleMap: Record<string, TeamMember["role"]> = {
                planning: "planning", answer: "research", verification: "verification",
                research: "research", clarity: "research", boss: "orchestration",
                orchestrator: "orchestration", custom: "custom"
            };

            return {
                name: a.name,
                role: roleMap[a.name] || "custom",
                status,
                taskCount: a.total_calls,
                successRate: Math.round(successRate * 100) / 100,
                avgResponseTime: a.avg_response_time,
                lastActive: new Date().toISOString(),
                specializations: [],
            };
        });

        const active = members.filter(m => m.status === "active").length;
        const idle = members.filter(m => m.status === "idle").length;
        const overloaded = members.filter(m => m.status === "overloaded").length;
        const errors = members.filter(m => m.status === "error").length;
        const avgSuccess = members.length > 0 ? members.reduce((s, m) => s + m.successRate, 0) / members.length : 0;
        const avgResponse = members.length > 0 ? members.reduce((s, m) => s + m.avgResponseTime, 0) / members.length : 0;

        let score = 100;
        score -= errors * 15;
        score -= overloaded * 10;
        score -= idle * 5;
        if (avgSuccess < 0.7) score -= 20;
        else if (avgSuccess < 0.85) score -= 10;
        if (avgResponse > 60000) score -= 15;
        else if (avgResponse > 30000) score -= 5;
        score = Math.max(0, Math.min(100, Math.round(score)));

        const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";

        const bottlenecks: string[] = [];
        const recommendations: string[] = [];

        if (overloaded > 0) {
            bottlenecks.push(`${overloaded} agent(s) overloaded`);
            recommendations.push("Consider redistributing workload from overloaded agents");
        }
        if (errors > 0) {
            bottlenecks.push(`${errors} agent(s) in error state`);
            recommendations.push("Investigate and restart agents in error state");
        }
        if (idle > active && members.length > 2) {
            recommendations.push("Most agents are idle — consider assigning more tasks");
        }
        if (avgResponse > 30000) {
            bottlenecks.push("High average response time");
            recommendations.push("Optimize LLM configuration or reduce prompt complexity");
        }

        return {
            overallScore: score,
            grade,
            members,
            activeCount: active,
            idleCount: idle,
            overloadedCount: overloaded,
            errorCount: errors,
            avgSuccessRate: Math.round(avgSuccess * 100) / 100,
            avgResponseTime: Math.round(avgResponse),
            bottlenecks,
            recommendations,
        };
    }

    detectConflicts(tasks: Array<{ id: string; title: string; priority: string; status: string; dependencies: string[]; estimated_minutes: number; plan_id?: string }>): Conflict[] {
        const newConflicts: Conflict[] = [];

        for (const task of tasks) {
            if (task.dependencies && task.dependencies.length > 0) {
                for (const depId of task.dependencies) {
                    const dep = tasks.find(t => t.id === depId);
                    if (dep && (dep.status === "failed" || dep.status === "blocked")) {
                        const conflict: Conflict = {
                            id: this.nextId("conf"),
                            type: "dependency",
                            severity: task.priority === "P1" ? "critical" : "high",
                            title: `Blocked by ${dep.status} dependency`,
                            description: `Task "${task.title}" depends on "${dep.title}" which is ${dep.status}`,
                            involvedEntities: [
                                { type: "task", id: task.id, name: task.title },
                                { type: "task", id: dep.id, name: dep.title },
                            ],
                            suggestedResolution: dep.status === "failed" ? "Fix or reassign the failed dependency task" : "Unblock the dependency or remove it",
                            status: "detected",
                            detectedAt: new Date().toISOString(),
                        };
                        this.conflicts.set(conflict.id, conflict);
                        newConflicts.push(conflict);
                    }
                }
            }
        }

        for (const task of tasks) {
            if (task.priority === "P1" && task.dependencies) {
                for (const depId of task.dependencies) {
                    const dep = tasks.find(t => t.id === depId);
                    if (dep && dep.priority === "P3" && dep.status !== "verified" && dep.status !== "completed") {
                        const conflict: Conflict = {
                            id: this.nextId("conf"),
                            type: "priority",
                            severity: "high",
                            title: "Low-priority task blocking critical task",
                            description: `P3 task "${dep.title}" is blocking P1 task "${task.title}"`,
                            involvedEntities: [
                                { type: "task", id: task.id, name: task.title },
                                { type: "task", id: dep.id, name: dep.title },
                            ],
                            suggestedResolution: "Escalate the blocking task priority to P1 or remove the dependency",
                            status: "detected",
                            detectedAt: new Date().toISOString(),
                        };
                        this.conflicts.set(conflict.id, conflict);
                        newConflicts.push(conflict);
                    }
                }
            }
        }

        const activeP1 = tasks.filter(t => t.priority === "P1" && t.status === "in_progress");
        if (activeP1.length > 3) {
            const conflict: Conflict = {
                id: this.nextId("conf"),
                type: "resource",
                severity: "medium",
                title: "Too many critical tasks in progress",
                description: `${activeP1.length} P1 tasks are running simultaneously — focus may be too spread`,
                involvedEntities: activeP1.map(t => ({ type: "task", id: t.id, name: t.title })),
                suggestedResolution: "Prioritize the most impactful P1 tasks and queue the rest",
                status: "detected",
                detectedAt: new Date().toISOString(),
            };
            this.conflicts.set(conflict.id, conflict);
            newConflicts.push(conflict);
        }

        const totalMinutes = tasks.reduce((s, t) => s + t.estimated_minutes, 0);
        if (totalMinutes > 40 * 60) {
            const conflict: Conflict = {
                id: this.nextId("conf"),
                type: "scope",
                severity: totalMinutes > 80 * 60 ? "critical" : "medium",
                title: "Scope exceeds capacity",
                description: `Total estimated time: ${Math.round(totalMinutes / 60)} hours — may need scope reduction`,
                involvedEntities: [],
                suggestedResolution: "Review and descope P3 tasks, or break the plan into phases",
                status: "detected",
                detectedAt: new Date().toISOString(),
            };
            this.conflicts.set(conflict.id, conflict);
            newConflicts.push(conflict);
        }

        return newConflicts;
    }

    checkPlanAlignment(plan: { id: string; name: string; status: string; config_json?: string }, tasks: Array<{ status: string; priority: string; estimated_minutes: number }>): PlanAlignment {
        const total = tasks.length;
        const completed = tasks.filter(t => t.status === "verified" || t.status === "completed").length;
        const failed = tasks.filter(t => t.status === "failed").length;
        const blocked = tasks.filter(t => t.status === "blocked").length;
        const inProgress = tasks.filter(t => t.status === "in_progress").length;

        const completionRate = total > 0 ? completed / total : 0;
        const failureRate = total > 0 ? failed / total : 0;

        const drift: PlanAlignment["drift"] = [];
        const risks: string[] = [];
        const actionItems: string[] = [];

        if (failureRate > 0.2) {
            drift.push({ area: "Quality", expected: "<20% failure rate", actual: `${Math.round(failureRate * 100)}% failure rate`, severity: "major" });
            risks.push("High failure rate may derail plan timeline");
            actionItems.push("Review and fix failed tasks before proceeding");
        }

        if (blocked > total * 0.15) {
            drift.push({ area: "Progress", expected: "<15% blocked tasks", actual: `${Math.round(blocked / total * 100)}% blocked`, severity: "moderate" });
            actionItems.push("Resolve blocked task dependencies");
        }

        if (inProgress > 10) {
            drift.push({ area: "Focus", expected: "≤10 concurrent tasks", actual: `${inProgress} in progress`, severity: "minor" });
            actionItems.push("Consider focusing on fewer tasks at once");
        }

        const p1Tasks = tasks.filter(t => t.priority === "P1");
        const p1Completed = p1Tasks.filter(t => t.status === "verified" || t.status === "completed").length;
        const p1Rate = p1Tasks.length > 0 ? p1Completed / p1Tasks.length : 1;

        if (p1Rate < completionRate * 0.8) {
            drift.push({ area: "Priorities", expected: "P1 tasks completed first", actual: `P1 completion ${Math.round(p1Rate * 100)}% vs overall ${Math.round(completionRate * 100)}%`, severity: "major" });
            risks.push("Critical tasks lagging behind overall progress");
            actionItems.push("Prioritize P1 task completion");
        }

        let alignmentScore = 100;
        alignmentScore -= drift.filter(d => d.severity === "major").length * 20;
        alignmentScore -= drift.filter(d => d.severity === "moderate").length * 10;
        alignmentScore -= drift.filter(d => d.severity === "minor").length * 5;
        alignmentScore = Math.max(0, Math.min(100, alignmentScore));

        const milestones: PlanAlignment["milestones"] = [];
        if (completionRate < 0.25) milestones.push({ name: "Quarter complete", status: failureRate > 0.3 ? "at_risk" : "behind" });
        else if (completionRate < 0.5) milestones.push({ name: "Quarter complete", status: "completed" }, { name: "Half complete", status: "behind" });
        else if (completionRate < 0.75) milestones.push({ name: "Quarter complete", status: "completed" }, { name: "Half complete", status: "completed" }, { name: "Three-quarter complete", status: "behind" });
        else milestones.push({ name: "Quarter complete", status: "completed" }, { name: "Half complete", status: "completed" }, { name: "Three-quarter complete", status: "completed" }, { name: "Plan complete", status: completionRate >= 1 ? "completed" : "on_track" });

        const alignment: PlanAlignment = {
            planId: plan.id,
            planName: plan.name,
            alignmentScore,
            onTrack: alignmentScore >= 70,
            drift,
            milestones,
            risks,
            actionItems,
        };

        this.alignmentHistory.push(alignment);
        return alignment;
    }

    analyzeWorkload(members: Array<{ name: string; tasks: Array<{ estimated_minutes: number }> }>, hoursPerDay: number = 6): WorkloadDistribution {
        const maxMinutesPerDay = hoursPerDay * 60;

        const distribution = members.map(m => {
            const totalMinutes = m.tasks.reduce((s, t) => s + t.estimated_minutes, 0);
            const hours = Math.round(totalMinutes / 60 * 10) / 10;
            const capacityUsed = Math.round((totalMinutes / maxMinutesPerDay) * 100);
            return { name: m.name, taskCount: m.tasks.length, estimatedHours: hours, capacityUsed };
        });

        const overloaded = distribution.filter(d => d.capacityUsed > 100).map(d => d.name);
        const underutilized = distribution.filter(d => d.capacityUsed < 30 && distribution.length > 1).map(d => d.name);

        const balanced = overloaded.length === 0 && underutilized.length <= 1;

        const recommendations: WorkloadDistribution["recommendations"] = [];
        if (overloaded.length > 0 && underutilized.length > 0) {
            recommendations.push({
                from: overloaded[0],
                to: underutilized[0],
                taskId: "next-available",
                reason: `${overloaded[0]} is at ${distribution.find(d => d.name === overloaded[0])?.capacityUsed}% capacity while ${underutilized[0]} is at ${distribution.find(d => d.name === underutilized[0])?.capacityUsed}%`,
            });
        }

        return { members: distribution, balanced, overloadedMembers: overloaded, underutilizedMembers: underutilized, recommendations };
    }

    generateInsights(teamHealth: TeamHealth, tasks: Array<{ status: string; priority: string; created_at: string; updated_at: string }>): LeadershipInsight[] {
        this.insights = [];

        const completed = tasks.filter(t => t.status === "verified" || t.status === "completed").length;
        const total = tasks.length;
        const productivity = total > 0 ? Math.round((completed / total) * 100) : 0;
        this.insights.push({
            category: "productivity",
            title: "Task Completion Rate",
            description: `${completed} of ${total} tasks completed (${productivity}%)`,
            metric: productivity,
            trend: productivity > 70 ? "improving" : productivity > 40 ? "stable" : "declining",
            actionable: productivity < 50,
            suggestedAction: productivity < 50 ? "Focus on completing in-progress tasks before starting new ones" : undefined,
        });

        const failed = tasks.filter(t => t.status === "failed").length;
        const qualityScore = total > 0 ? Math.round(((total - failed) / total) * 100) : 100;
        this.insights.push({
            category: "quality",
            title: "Task Quality Score",
            description: `${qualityScore}% of tasks passing verification`,
            metric: qualityScore,
            trend: qualityScore > 90 ? "improving" : qualityScore > 70 ? "stable" : "declining",
            actionable: qualityScore < 80,
            suggestedAction: qualityScore < 80 ? "Review failed tasks and improve acceptance criteria" : undefined,
        });

        const inProgress = tasks.filter(t => t.status === "in_progress").length;
        this.insights.push({
            category: "velocity",
            title: "Work in Progress",
            description: `${inProgress} tasks currently in progress`,
            metric: inProgress,
            trend: inProgress > 10 ? "declining" : inProgress > 3 ? "stable" : "improving",
            actionable: inProgress > 10,
            suggestedAction: inProgress > 10 ? "Too many tasks in flight — consider WIP limits" : undefined,
        });

        this.insights.push({
            category: "morale",
            title: "Team Health",
            description: `Team health score: ${teamHealth.overallScore}/100 (Grade: ${teamHealth.grade})`,
            metric: teamHealth.overallScore,
            trend: teamHealth.overallScore > 80 ? "improving" : teamHealth.overallScore > 60 ? "stable" : "declining",
            actionable: teamHealth.overallScore < 70,
            suggestedAction: teamHealth.overallScore < 70 ? "Address agent errors and overloaded team members" : undefined,
        });

        const blocked = tasks.filter(t => t.status === "blocked").length;
        const riskLevel = Math.min(100, blocked * 15 + failed * 10);
        this.insights.push({
            category: "risk",
            title: "Overall Risk Level",
            description: `Risk score: ${riskLevel}/100 (${blocked} blocked, ${failed} failed)`,
            metric: riskLevel,
            trend: riskLevel < 20 ? "improving" : riskLevel < 50 ? "stable" : "declining",
            actionable: riskLevel > 30,
            suggestedAction: riskLevel > 30 ? "Address blocked tasks and investigate failures" : undefined,
        });

        return [...this.insights];
    }

    resolveConflict(id: string): boolean {
        const conflict = this.conflicts.get(id);
        if (!conflict) return false;
        conflict.status = "resolved";
        conflict.resolvedAt = new Date().toISOString();
        return true;
    }

    acknowledgeConflict(id: string): boolean {
        const conflict = this.conflicts.get(id);
        if (!conflict) return false;
        conflict.status = "acknowledged";
        return true;
    }

    getConflict(id: string): Conflict | undefined { return this.conflicts.get(id); }
    getAllConflicts(): Conflict[] { return [...this.conflicts.values()]; }
    getActiveConflicts(): Conflict[] { return [...this.conflicts.values()].filter(c => c.status !== "resolved"); }
    getInsights(): LeadershipInsight[] { return [...this.insights]; }
    getAlignmentHistory(): PlanAlignment[] { return [...this.alignmentHistory]; }

    reset(): void {
        this.conflicts.clear();
        this.insights = [];
        this.alignmentHistory = [];
        this.idCounter = 0;
    }
}
