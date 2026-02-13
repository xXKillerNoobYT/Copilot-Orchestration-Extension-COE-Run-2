import { BossIntelligence, TeamHealth, Conflict, PlanAlignment, WorkloadDistribution, LeadershipInsight } from "../src/core/boss-intelligence";

describe("BossIntelligence", () => {
    let boss: BossIntelligence;

    beforeEach(() => {
        boss = new BossIntelligence();
    });

    // =========================================
    // Team Health Assessment
    // =========================================
    describe("assessTeamHealth", () => {
        const healthyAgents = [
            { name: "planning", status: "active", total_calls: 20, successful_calls: 18, failed_calls: 2, avg_response_time: 5000 },
            { name: "verification", status: "active", total_calls: 15, successful_calls: 14, failed_calls: 1, avg_response_time: 8000 },
            { name: "research", status: "active", total_calls: 10, successful_calls: 9, failed_calls: 1, avg_response_time: 6000 },
            { name: "answer", status: "active", total_calls: 12, successful_calls: 11, failed_calls: 1, avg_response_time: 4000 },
        ];

        it("should assess a healthy team with high scores", () => {
            const health = boss.assessTeamHealth(healthyAgents);
            expect(health.overallScore).toBeGreaterThanOrEqual(80);
            expect(health.grade).toBe("A");
            expect(health.activeCount).toBe(4);
            expect(health.errorCount).toBe(0);
            expect(health.overloadedCount).toBe(0);
            expect(health.idleCount).toBe(0);
        });

        it("should detect agents in error state", () => {
            const agents = [
                { name: "planning", status: "error", total_calls: 10, successful_calls: 5, failed_calls: 5, avg_response_time: 5000 },
                { name: "verification", status: "active", total_calls: 10, successful_calls: 9, failed_calls: 1, avg_response_time: 5000 },
            ];
            const health = boss.assessTeamHealth(agents);
            expect(health.errorCount).toBe(1);
            expect(health.bottlenecks).toEqual(expect.arrayContaining([expect.stringContaining("error state")]));
            expect(health.recommendations).toEqual(expect.arrayContaining([expect.stringContaining("Investigate")]));
        });

        it("should detect overloaded agents (failed > successful)", () => {
            const agents = [
                { name: "planning", status: "active", total_calls: 20, successful_calls: 5, failed_calls: 15, avg_response_time: 5000 },
                { name: "verification", status: "active", total_calls: 10, successful_calls: 9, failed_calls: 1, avg_response_time: 5000 },
            ];
            const health = boss.assessTeamHealth(agents);
            expect(health.overloadedCount).toBe(1);
            expect(health.bottlenecks).toEqual(expect.arrayContaining([expect.stringContaining("overloaded")]));
        });

        it("should detect idle agents (zero calls)", () => {
            const agents = [
                { name: "planning", status: "active", total_calls: 0, successful_calls: 0, failed_calls: 0, avg_response_time: 0 },
                { name: "verification", status: "active", total_calls: 0, successful_calls: 0, failed_calls: 0, avg_response_time: 0 },
                { name: "research", status: "active", total_calls: 10, successful_calls: 9, failed_calls: 1, avg_response_time: 5000 },
            ];
            const health = boss.assessTeamHealth(agents);
            expect(health.idleCount).toBe(2);
            expect(health.recommendations).toEqual(expect.arrayContaining([expect.stringContaining("idle")]));
        });

        it("should calculate grade A for score >= 90", () => {
            const health = boss.assessTeamHealth(healthyAgents);
            expect(health.grade).toBe("A");
            expect(health.overallScore).toBeGreaterThanOrEqual(90);
        });

        it("should calculate grade B for score 80-89", () => {
            const agents = [
                { name: "planning", status: "active", total_calls: 10, successful_calls: 8, failed_calls: 2, avg_response_time: 35000 },
                { name: "verification", status: "active", total_calls: 10, successful_calls: 8, failed_calls: 2, avg_response_time: 35000 },
            ];
            const health = boss.assessTeamHealth(agents);
            expect(health.grade).toBe("B");
            expect(health.overallScore).toBeGreaterThanOrEqual(80);
            expect(health.overallScore).toBeLessThan(90);
        });

        it("should calculate grade C for score 70-79", () => {
            const agents = [
                { name: "planning", status: "error", total_calls: 10, successful_calls: 8, failed_calls: 2, avg_response_time: 35000 },
                { name: "verification", status: "active", total_calls: 10, successful_calls: 8, failed_calls: 2, avg_response_time: 35000 },
            ];
            const health = boss.assessTeamHealth(agents);
            expect(health.grade).toBe("C");
            expect(health.overallScore).toBeGreaterThanOrEqual(70);
            expect(health.overallScore).toBeLessThan(80);
        });

        it("should calculate grade D for score 60-69", () => {
            const agents = [
                { name: "planning", status: "error", total_calls: 10, successful_calls: 5, failed_calls: 5, avg_response_time: 65000 },
                { name: "verification", status: "active", total_calls: 10, successful_calls: 8, failed_calls: 2, avg_response_time: 35000 },
            ];
            const health = boss.assessTeamHealth(agents);
            expect(health.grade).toBe("D");
            expect(health.overallScore).toBeGreaterThanOrEqual(60);
            expect(health.overallScore).toBeLessThan(70);
        });

        it("should calculate grade F for score < 60", () => {
            const agents = [
                { name: "planning", status: "error", total_calls: 10, successful_calls: 2, failed_calls: 8, avg_response_time: 65000 },
                { name: "verification", status: "error", total_calls: 10, successful_calls: 2, failed_calls: 8, avg_response_time: 65000 },
                { name: "research", status: "error", total_calls: 10, successful_calls: 2, failed_calls: 8, avg_response_time: 65000 },
            ];
            const health = boss.assessTeamHealth(agents);
            expect(health.grade).toBe("F");
            expect(health.overallScore).toBeLessThan(60);
        });

        it("should detect bottleneck for high response time", () => {
            const agents = [
                { name: "planning", status: "active", total_calls: 10, successful_calls: 9, failed_calls: 1, avg_response_time: 45000 },
            ];
            const health = boss.assessTeamHealth(agents);
            expect(health.bottlenecks).toEqual(expect.arrayContaining([expect.stringContaining("response time")]));
            expect(health.recommendations).toEqual(expect.arrayContaining([expect.stringContaining("LLM")]));
        });

        it("should handle empty agent list", () => {
            const health = boss.assessTeamHealth([]);
            expect(health.members).toHaveLength(0);
            expect(health.activeCount).toBe(0);
            // avgSuccess is 0 when no agents, triggers <0.7 penalty (-20), score = 80
            expect(health.overallScore).toBe(80);
            expect(health.grade).toBe("B");
        });

        it("should handle single agent", () => {
            const agents = [
                { name: "orchestrator", status: "active", total_calls: 5, successful_calls: 4, failed_calls: 1, avg_response_time: 3000 },
            ];
            const health = boss.assessTeamHealth(agents);
            expect(health.members).toHaveLength(1);
            expect(health.members[0].role).toBe("orchestration");
            expect(health.activeCount).toBe(1);
        });

        it("should map agent names to correct roles", () => {
            const agents = [
                { name: "planning", status: "active", total_calls: 1, successful_calls: 1, failed_calls: 0, avg_response_time: 1000 },
                { name: "answer", status: "active", total_calls: 1, successful_calls: 1, failed_calls: 0, avg_response_time: 1000 },
                { name: "boss", status: "active", total_calls: 1, successful_calls: 1, failed_calls: 0, avg_response_time: 1000 },
                { name: "custom", status: "active", total_calls: 1, successful_calls: 1, failed_calls: 0, avg_response_time: 1000 },
                { name: "unknown-agent", status: "active", total_calls: 1, successful_calls: 1, failed_calls: 0, avg_response_time: 1000 },
            ];
            const health = boss.assessTeamHealth(agents);
            expect(health.members[0].role).toBe("planning");
            expect(health.members[1].role).toBe("research");
            expect(health.members[2].role).toBe("orchestration");
            expect(health.members[3].role).toBe("custom");
            expect(health.members[4].role).toBe("custom");
        });

        it("should recommend assigning tasks when most agents are idle", () => {
            const agents = [
                { name: "planning", status: "active", total_calls: 0, successful_calls: 0, failed_calls: 0, avg_response_time: 0 },
                { name: "verification", status: "active", total_calls: 0, successful_calls: 0, failed_calls: 0, avg_response_time: 0 },
                { name: "research", status: "active", total_calls: 1, successful_calls: 1, failed_calls: 0, avg_response_time: 1000 },
            ];
            const health = boss.assessTeamHealth(agents);
            expect(health.recommendations).toEqual(expect.arrayContaining([expect.stringContaining("idle")]));
        });
    });

    // =========================================
    // Conflict Detection
    // =========================================
    describe("detectConflicts", () => {
        it("should detect dependency on failed task", () => {
            const tasks = [
                { id: "t1", title: "Setup DB", priority: "P2", status: "failed", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t2", title: "Create API", priority: "P2", status: "not_started", dependencies: ["t1"], estimated_minutes: 45 },
            ];
            const conflicts = boss.detectConflicts(tasks);
            expect(conflicts.length).toBeGreaterThanOrEqual(1);
            const depConflict = conflicts.find(c => c.type === "dependency");
            expect(depConflict).toBeDefined();
            expect(depConflict!.title).toContain("failed");
            expect(depConflict!.suggestedResolution).toContain("Fix");
        });

        it("should detect dependency on blocked task", () => {
            const tasks = [
                { id: "t1", title: "Setup DB", priority: "P2", status: "blocked", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t2", title: "Create API", priority: "P2", status: "not_started", dependencies: ["t1"], estimated_minutes: 45 },
            ];
            const conflicts = boss.detectConflicts(tasks);
            const depConflict = conflicts.find(c => c.type === "dependency");
            expect(depConflict).toBeDefined();
            expect(depConflict!.title).toContain("blocked");
            expect(depConflict!.suggestedResolution).toContain("Unblock");
        });

        it('should mark dependency conflict as critical when P1 task is affected', () => {
            const tasks = [
                { id: "t1", title: "Setup DB", priority: "P2", status: "failed", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t2", title: "Critical Fix", priority: "P1", status: "not_started", dependencies: ["t1"], estimated_minutes: 45 },
            ];
            const conflicts = boss.detectConflicts(tasks);
            const depConflict = conflicts.find(c => c.type === "dependency");
            expect(depConflict!.severity).toBe("critical");
        });

        it("should detect P3 task blocking P1 task", () => {
            const tasks = [
                { id: "t1", title: "Nice to have", priority: "P3", status: "in_progress", dependencies: [] as string[], estimated_minutes: 60 },
                { id: "t2", title: "Critical feature", priority: "P1", status: "not_started", dependencies: ["t1"], estimated_minutes: 30 },
            ];
            const conflicts = boss.detectConflicts(tasks);
            const prioConflict = conflicts.find(c => c.type === "priority");
            expect(prioConflict).toBeDefined();
            expect(prioConflict!.severity).toBe("high");
        });

        it("should not flag P3 blocking P1 if P3 is completed", () => {
            const tasks = [
                { id: "t1", title: "Nice to have", priority: "P3", status: "completed", dependencies: [] as string[], estimated_minutes: 60 },
                { id: "t2", title: "Critical feature", priority: "P1", status: "not_started", dependencies: ["t1"], estimated_minutes: 30 },
            ];
            const conflicts = boss.detectConflicts(tasks);
            const prioConflict = conflicts.find(c => c.type === "priority");
            expect(prioConflict).toBeUndefined();
        });

        it("should detect too many concurrent P1 tasks", () => {
            const tasks = [
                { id: "t1", title: "P1-A", priority: "P1", status: "in_progress", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t2", title: "P1-B", priority: "P1", status: "in_progress", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t3", title: "P1-C", priority: "P1", status: "in_progress", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t4", title: "P1-D", priority: "P1", status: "in_progress", dependencies: [] as string[], estimated_minutes: 30 },
            ];
            const conflicts = boss.detectConflicts(tasks);
            const resConflict = conflicts.find(c => c.type === "resource");
            expect(resConflict).toBeDefined();
            expect(resConflict!.involvedEntities).toHaveLength(4);
        });

        it("should not flag resource conflict with 3 or fewer P1 tasks", () => {
            const tasks = [
                { id: "t1", title: "P1-A", priority: "P1", status: "in_progress", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t2", title: "P1-B", priority: "P1", status: "in_progress", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t3", title: "P1-C", priority: "P1", status: "in_progress", dependencies: [] as string[], estimated_minutes: 30 },
            ];
            const conflicts = boss.detectConflicts(tasks);
            const resConflict = conflicts.find(c => c.type === "resource");
            expect(resConflict).toBeUndefined();
        });

        it("should detect scope exceeding capacity over 40h", () => {
            const tasks = Array.from({ length: 50 }, (_, i) => ({
                id: "t" + i, title: "Task " + i, priority: "P2", status: "not_started",
                dependencies: [] as string[], estimated_minutes: 60,
            }));
            const conflicts = boss.detectConflicts(tasks);
            const scopeConflict = conflicts.find(c => c.type === "scope");
            expect(scopeConflict).toBeDefined();
            expect(scopeConflict!.severity).toBe("medium");
        });

        it("should mark scope conflict as critical when over 80h", () => {
            const tasks = Array.from({ length: 100 }, (_, i) => ({
                id: "t" + i, title: "Task " + i, priority: "P2", status: "not_started",
                dependencies: [] as string[], estimated_minutes: 60,
            }));
            const conflicts = boss.detectConflicts(tasks);
            const scopeConflict = conflicts.find(c => c.type === "scope");
            expect(scopeConflict).toBeDefined();
            expect(scopeConflict!.severity).toBe("critical");
        });

        it("should detect no conflicts for a healthy task set", () => {
            const tasks = [
                { id: "t1", title: "Task A", priority: "P2", status: "completed", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t2", title: "Task B", priority: "P2", status: "in_progress", dependencies: ["t1"], estimated_minutes: 30 },
            ];
            const conflicts = boss.detectConflicts(tasks);
            expect(conflicts).toHaveLength(0);
        });

        it("should detect multiple conflict types simultaneously", () => {
            const tasks = [
                { id: "t1", title: "Failed dep", priority: "P2", status: "failed", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t2", title: "Dependent", priority: "P1", status: "not_started", dependencies: ["t1"], estimated_minutes: 30 },
                { id: "t3", title: "Low prio blocker", priority: "P3", status: "in_progress", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t4", title: "P1 blocked by P3", priority: "P1", status: "not_started", dependencies: ["t3"], estimated_minutes: 30 },
            ];
            const conflicts = boss.detectConflicts(tasks);
            const types = new Set(conflicts.map(c => c.type));
            expect(types.has("dependency")).toBe(true);
            expect(types.has("priority")).toBe(true);
        });

        it("should handle tasks with no dependencies", () => {
            const tasks = [
                { id: "t1", title: "Independent A", priority: "P2", status: "in_progress", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t2", title: "Independent B", priority: "P2", status: "completed", dependencies: [] as string[], estimated_minutes: 30 },
            ];
            const conflicts = boss.detectConflicts(tasks);
            expect(conflicts).toHaveLength(0);
        });

        it("should store conflicts in internal map", () => {
            const tasks = [
                { id: "t1", title: "Setup DB", priority: "P2", status: "failed", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t2", title: "Create API", priority: "P2", status: "not_started", dependencies: ["t1"], estimated_minutes: 45 },
            ];
            boss.detectConflicts(tasks);
            expect(boss.getAllConflicts().length).toBeGreaterThanOrEqual(1);
        });
    });

    // =========================================
    // Plan Alignment
    // =========================================
    describe("checkPlanAlignment", () => {
        const basePlan = { id: "plan-1", name: "Sprint 1", status: "active" };

        it("should return high alignment score for healthy plan with completed tasks", () => {
            const tasks = [
                { status: "completed", priority: "P1", estimated_minutes: 30 },
                { status: "verified", priority: "P1", estimated_minutes: 30 },
                { status: "completed", priority: "P2", estimated_minutes: 30 },
                { status: "verified", priority: "P2", estimated_minutes: 30 },
            ];
            const alignment = boss.checkPlanAlignment(basePlan, tasks);
            expect(alignment.alignmentScore).toBeGreaterThanOrEqual(90);
            expect(alignment.onTrack).toBe(true);
            expect(alignment.drift).toHaveLength(0);
            expect(alignment.risks).toHaveLength(0);
        });

        it("should detect high failure rate drift (>20%)", () => {
            const tasks = [
                { status: "failed", priority: "P2", estimated_minutes: 30 },
                { status: "failed", priority: "P2", estimated_minutes: 30 },
                { status: "completed", priority: "P2", estimated_minutes: 30 },
                { status: "in_progress", priority: "P2", estimated_minutes: 30 },
            ];
            const alignment = boss.checkPlanAlignment(basePlan, tasks);
            const qualityDrift = alignment.drift.find(d => d.area === "Quality");
            expect(qualityDrift).toBeDefined();
            expect(qualityDrift!.severity).toBe("major");
            expect(alignment.risks).toEqual(expect.arrayContaining([expect.stringContaining("failure rate")]));
            expect(alignment.actionItems).toEqual(expect.arrayContaining([expect.stringContaining("fix failed")]));
        });

        it("should detect too many blocked tasks (>15%)", () => {
            const tasks = [
                { status: "blocked", priority: "P2", estimated_minutes: 30 },
                { status: "blocked", priority: "P2", estimated_minutes: 30 },
                { status: "in_progress", priority: "P2", estimated_minutes: 30 },
                { status: "completed", priority: "P2", estimated_minutes: 30 },
                { status: "completed", priority: "P2", estimated_minutes: 30 },
            ];
            const alignment = boss.checkPlanAlignment(basePlan, tasks);
            const progressDrift = alignment.drift.find(d => d.area === "Progress");
            expect(progressDrift).toBeDefined();
            expect(progressDrift!.severity).toBe("moderate");
            expect(alignment.actionItems).toEqual(expect.arrayContaining([expect.stringContaining("blocked")]));
        });

        it("should detect too many concurrent tasks (>10 in progress)", () => {
            const tasks = Array.from({ length: 12 }, () => ({
                status: "in_progress", priority: "P2", estimated_minutes: 30,
            }));
            const alignment = boss.checkPlanAlignment(basePlan, tasks);
            const focusDrift = alignment.drift.find(d => d.area === "Focus");
            expect(focusDrift).toBeDefined();
            expect(focusDrift!.severity).toBe("minor");
            expect(alignment.actionItems).toEqual(expect.arrayContaining([expect.stringContaining("fewer tasks")]));
        });

        it("should detect P1 tasks lagging behind overall progress", () => {
            const tasks = [
                { status: "completed", priority: "P2", estimated_minutes: 30 },
                { status: "completed", priority: "P2", estimated_minutes: 30 },
                { status: "completed", priority: "P2", estimated_minutes: 30 },
                { status: "verified", priority: "P2", estimated_minutes: 30 },
                { status: "in_progress", priority: "P1", estimated_minutes: 30 },
                { status: "not_started", priority: "P1", estimated_minutes: 30 },
                { status: "not_started", priority: "P1", estimated_minutes: 30 },
                { status: "not_started", priority: "P1", estimated_minutes: 30 },
            ];
            const alignment = boss.checkPlanAlignment(basePlan, tasks);
            const prioDrift = alignment.drift.find(d => d.area === "Priorities");
            expect(prioDrift).toBeDefined();
            expect(prioDrift!.severity).toBe("major");
            expect(alignment.risks).toEqual(expect.arrayContaining([expect.stringContaining("Critical tasks")]));
        });

        it("should calculate alignment score reducing per drift severity", () => {
            // Need >20% failure rate for quality drift (major), >15% blocked for progress drift (moderate),
            // >10 in_progress for focus drift (minor)
            // 5 failed out of 20 = 25% failure rate => major quality drift (-20)
            // 4 blocked out of 20 = 20% => moderate progress drift (-10)
            // 11 in_progress => minor focus drift (-5)
            // Score = 100 - 20 - 10 - 5 = 65
            const tasks = [
                ...Array.from({ length: 5 }, () => ({ status: "failed", priority: "P2", estimated_minutes: 30 })),
                ...Array.from({ length: 4 }, () => ({ status: "blocked", priority: "P2", estimated_minutes: 30 })),
                ...Array.from({ length: 11 }, () => ({ status: "in_progress", priority: "P2", estimated_minutes: 30 })),
            ];
            const alignment = boss.checkPlanAlignment(basePlan, tasks);
            // Should have quality drift (major) + progress drift (moderate) + focus drift (minor)
            expect(alignment.drift.length).toBeGreaterThanOrEqual(3);
            expect(alignment.alignmentScore).toBe(65);
            expect(alignment.onTrack).toBe(false);
        });

        it("should set onTrack to false when alignment score < 70", () => {
            // Need 2 major drifts to get score to 60 (100 - 20 - 20 = 60, onTrack = false)
            // Major drift 1: >20% failure rate
            // Major drift 2: P1 completion lagging behind overall
            // 4 failed P2, 6 completed P2, 5 not_started P1 = 15 total
            // failureRate = 4/15 = 26.7% => major quality drift
            // completionRate = 6/15 = 40%, p1Rate = 0/5 = 0%, 0 < 0.4*0.8=0.32 => major priority drift
            // Score = 100 - 20 - 20 = 60
            const tasks = [
                ...Array.from({ length: 4 }, () => ({ status: "failed", priority: "P2", estimated_minutes: 30 })),
                ...Array.from({ length: 6 }, () => ({ status: "completed", priority: "P2", estimated_minutes: 30 })),
                ...Array.from({ length: 5 }, () => ({ status: "not_started", priority: "P1", estimated_minutes: 30 })),
            ];
            const alignment = boss.checkPlanAlignment(basePlan, tasks);
            expect(alignment.alignmentScore).toBeLessThan(70);
            expect(alignment.onTrack).toBe(false);
        });

        it("should set plan ID and name from input", () => {
            const plan = { id: "custom-plan-42", name: "My Custom Plan", status: "active" };
            const alignment = boss.checkPlanAlignment(plan, []);
            expect(alignment.planId).toBe("custom-plan-42");
            expect(alignment.planName).toBe("My Custom Plan");
        });

        it("should produce correct milestones for < 25% completion", () => {
            const tasks = [
                { status: "completed", priority: "P2", estimated_minutes: 30 },
                { status: "in_progress", priority: "P2", estimated_minutes: 30 },
                { status: "not_started", priority: "P2", estimated_minutes: 30 },
                { status: "not_started", priority: "P2", estimated_minutes: 30 },
                { status: "not_started", priority: "P2", estimated_minutes: 30 },
            ];
            const alignment = boss.checkPlanAlignment(basePlan, tasks);
            expect(alignment.milestones.length).toBeGreaterThanOrEqual(1);
            expect(alignment.milestones[0].name).toBe("Quarter complete");
            expect(alignment.milestones[0].status).toBe("behind");
        });

        it("should produce correct milestones for 25-50% completion", () => {
            const tasks = [
                { status: "completed", priority: "P2", estimated_minutes: 30 },
                { status: "verified", priority: "P2", estimated_minutes: 30 },
                { status: "in_progress", priority: "P2", estimated_minutes: 30 },
                { status: "not_started", priority: "P2", estimated_minutes: 30 },
                { status: "not_started", priority: "P2", estimated_minutes: 30 },
            ];
            const alignment = boss.checkPlanAlignment(basePlan, tasks);
            expect(alignment.milestones[0].name).toBe("Quarter complete");
            expect(alignment.milestones[0].status).toBe("completed");
            expect(alignment.milestones[1].name).toBe("Half complete");
            expect(alignment.milestones[1].status).toBe("behind");
        });

        it("should produce correct milestones for 50-75% completion", () => {
            const tasks = [
                { status: "completed", priority: "P2", estimated_minutes: 30 },
                { status: "verified", priority: "P2", estimated_minutes: 30 },
                { status: "completed", priority: "P2", estimated_minutes: 30 },
                { status: "not_started", priority: "P2", estimated_minutes: 30 },
            ];
            const alignment = boss.checkPlanAlignment(basePlan, tasks);
            const names = alignment.milestones.map(m => m.name);
            expect(names).toContain("Quarter complete");
            expect(names).toContain("Half complete");
            expect(names).toContain("Three-quarter complete");
        });

        it("should produce correct milestones for 75%+ completion", () => {
            const tasks = [
                { status: "completed", priority: "P2", estimated_minutes: 30 },
                { status: "verified", priority: "P2", estimated_minutes: 30 },
                { status: "completed", priority: "P2", estimated_minutes: 30 },
                { status: "verified", priority: "P2", estimated_minutes: 30 },
            ];
            const alignment = boss.checkPlanAlignment(basePlan, tasks);
            const names = alignment.milestones.map(m => m.name);
            expect(names).toContain("Plan complete");
            const planComplete = alignment.milestones.find(m => m.name === "Plan complete");
            expect(planComplete!.status).toBe("completed");
        });

        it("should store alignment in history", () => {
            boss.checkPlanAlignment(basePlan, [{ status: "completed", priority: "P2", estimated_minutes: 30 }]);
            boss.checkPlanAlignment(basePlan, [{ status: "in_progress", priority: "P2", estimated_minutes: 30 }]);
            const history = boss.getAlignmentHistory();
            expect(history).toHaveLength(2);
        });

        it("should handle empty task list", () => {
            const alignment = boss.checkPlanAlignment(basePlan, []);
            expect(alignment.alignmentScore).toBe(100);
            expect(alignment.onTrack).toBe(true);
            expect(alignment.drift).toHaveLength(0);
        });

        it("should mark quarter milestone as at_risk when failure rate > 30%", () => {
            const tasks = [
                { status: "failed", priority: "P2", estimated_minutes: 30 },
                { status: "failed", priority: "P2", estimated_minutes: 30 },
                { status: "in_progress", priority: "P2", estimated_minutes: 30 },
                { status: "not_started", priority: "P2", estimated_minutes: 30 },
                { status: "not_started", priority: "P2", estimated_minutes: 30 },
            ];
            const alignment = boss.checkPlanAlignment(basePlan, tasks);
            const quarter = alignment.milestones.find(m => m.name === "Quarter complete");
            expect(quarter!.status).toBe("at_risk");
        });
    });

    // =========================================
    // Workload Distribution Analysis
    // =========================================
    describe("analyzeWorkload", () => {
        it("should identify balanced workload when all members within capacity", () => {
            const members = [
                { name: "Alice", tasks: [{ estimated_minutes: 120 }, { estimated_minutes: 120 }] },
                { name: "Bob", tasks: [{ estimated_minutes: 100 }, { estimated_minutes: 100 }] },
            ];
            const result = boss.analyzeWorkload(members);
            expect(result.balanced).toBe(true);
            expect(result.overloadedMembers).toHaveLength(0);
        });

        it("should detect overloaded members (over 100% capacity)", () => {
            const members = [
                { name: "Alice", tasks: [{ estimated_minutes: 200 }, { estimated_minutes: 200 }, { estimated_minutes: 200 }] },
                { name: "Bob", tasks: [{ estimated_minutes: 60 }] },
            ];
            const result = boss.analyzeWorkload(members); // default 6h/day = 360min
            expect(result.overloadedMembers).toContain("Alice");
            expect(result.balanced).toBe(false);
        });

        it("should detect underutilized members (under 30% capacity)", () => {
            const members = [
                { name: "Alice", tasks: [{ estimated_minutes: 200 }] },
                { name: "Bob", tasks: [{ estimated_minutes: 30 }] },
            ];
            const result = boss.analyzeWorkload(members); // 360min capacity, 30/360 = 8.3%
            expect(result.underutilizedMembers).toContain("Bob");
        });

        it("should not flag underutilized with only one member", () => {
            const members = [
                { name: "Alice", tasks: [{ estimated_minutes: 30 }] },
            ];
            const result = boss.analyzeWorkload(members);
            // underutilized filter requires distribution.length > 1
            expect(result.underutilizedMembers).toHaveLength(0);
        });

        it("should recommend redistribution when overloaded and underutilized exist", () => {
            const members = [
                { name: "Alice", tasks: [{ estimated_minutes: 250 }, { estimated_minutes: 200 }] },
                { name: "Bob", tasks: [{ estimated_minutes: 30 }] },
            ];
            const result = boss.analyzeWorkload(members);
            expect(result.recommendations.length).toBeGreaterThanOrEqual(1);
            expect(result.recommendations[0].from).toBe("Alice");
            expect(result.recommendations[0].to).toBe("Bob");
            expect(result.recommendations[0].reason).toContain("Alice");
            expect(result.recommendations[0].reason).toContain("Bob");
        });

        it("should use custom hoursPerDay parameter", () => {
            const members = [
                { name: "Alice", tasks: [{ estimated_minutes: 300 }] },
            ];
            // With 8 hours/day = 480min capacity, 300/480 = 62.5%
            const result8h = boss.analyzeWorkload(members, 8);
            expect(result8h.members[0].capacityUsed).toBeLessThanOrEqual(100);
            expect(result8h.overloadedMembers).toHaveLength(0);

            // With 4 hours/day = 240min capacity, 300/240 = 125%
            const result4h = boss.analyzeWorkload(members, 4);
            expect(result4h.members[0].capacityUsed).toBeGreaterThan(100);
            expect(result4h.overloadedMembers).toContain("Alice");
        });

        it("should calculate correct estimated hours and task counts", () => {
            const members = [
                { name: "Alice", tasks: [{ estimated_minutes: 90 }, { estimated_minutes: 60 }] },
                { name: "Bob", tasks: [{ estimated_minutes: 120 }] },
            ];
            const result = boss.analyzeWorkload(members);
            const alice = result.members.find(m => m.name === "Alice")!;
            const bob = result.members.find(m => m.name === "Bob")!;
            expect(alice.taskCount).toBe(2);
            expect(alice.estimatedHours).toBe(2.5); // 150min / 60
            expect(bob.taskCount).toBe(1);
            expect(bob.estimatedHours).toBe(2); // 120min / 60
        });

        it("should handle members with no tasks", () => {
            const members = [
                { name: "Alice", tasks: [] },
                { name: "Bob", tasks: [{ estimated_minutes: 200 }] },
            ];
            const result = boss.analyzeWorkload(members);
            const alice = result.members.find(m => m.name === "Alice")!;
            expect(alice.taskCount).toBe(0);
            expect(alice.estimatedHours).toBe(0);
            expect(alice.capacityUsed).toBe(0);
            expect(result.underutilizedMembers).toContain("Alice");
        });

        it("should handle empty members list", () => {
            const result = boss.analyzeWorkload([]);
            expect(result.members).toHaveLength(0);
            expect(result.balanced).toBe(true);
            expect(result.overloadedMembers).toHaveLength(0);
            expect(result.underutilizedMembers).toHaveLength(0);
            expect(result.recommendations).toHaveLength(0);
        });
    });

    // =========================================
    // Leadership Insights
    // =========================================
    describe("generateInsights", () => {
        function makeHealth(overrides: Partial<TeamHealth> = {}): TeamHealth {
            return {
                overallScore: 85, grade: "B",
                members: [], activeCount: 3, idleCount: 0, overloadedCount: 0, errorCount: 0,
                avgSuccessRate: 0.9, avgResponseTime: 5000,
                bottlenecks: [], recommendations: [],
                ...overrides,
            };
        }

        it("should always generate exactly 5 insight categories", () => {
            const insights = boss.generateInsights(makeHealth(), []);
            expect(insights).toHaveLength(5);
            const categories = insights.map(i => i.category);
            expect(categories).toContain("productivity");
            expect(categories).toContain("quality");
            expect(categories).toContain("velocity");
            expect(categories).toContain("morale");
            expect(categories).toContain("risk");
        });

        it("should report improving productivity when completion > 70%", () => {
            const tasks = [
                { status: "completed", priority: "P2", created_at: "2024-01-01", updated_at: "2024-01-02" },
                { status: "verified", priority: "P2", created_at: "2024-01-01", updated_at: "2024-01-02" },
                { status: "completed", priority: "P2", created_at: "2024-01-01", updated_at: "2024-01-02" },
                { status: "in_progress", priority: "P2", created_at: "2024-01-01", updated_at: "2024-01-02" },
            ];
            const insights = boss.generateInsights(makeHealth(), tasks);
            const prod = insights.find(i => i.category === "productivity")!;
            expect(prod.metric).toBe(75);
            expect(prod.trend).toBe("improving");
            expect(prod.actionable).toBe(false);
        });

        it("should report declining productivity when completion < 40%", () => {
            const tasks = [
                { status: "completed", priority: "P2", created_at: "2024-01-01", updated_at: "2024-01-02" },
                { status: "in_progress", priority: "P2", created_at: "2024-01-01", updated_at: "2024-01-02" },
                { status: "not_started", priority: "P2", created_at: "2024-01-01", updated_at: "2024-01-02" },
                { status: "not_started", priority: "P2", created_at: "2024-01-01", updated_at: "2024-01-02" },
                { status: "not_started", priority: "P2", created_at: "2024-01-01", updated_at: "2024-01-02" },
            ];
            const insights = boss.generateInsights(makeHealth(), tasks);
            const prod = insights.find(i => i.category === "productivity")!;
            expect(prod.metric).toBe(20);
            expect(prod.trend).toBe("declining");
            expect(prod.actionable).toBe(true);
            expect(prod.suggestedAction).toBeDefined();
        });

        it("should calculate quality score based on non-failed tasks", () => {
            const tasks = [
                { status: "failed", priority: "P2", created_at: "2024-01-01", updated_at: "2024-01-02" },
                { status: "failed", priority: "P2", created_at: "2024-01-01", updated_at: "2024-01-02" },
                { status: "completed", priority: "P2", created_at: "2024-01-01", updated_at: "2024-01-02" },
                { status: "in_progress", priority: "P2", created_at: "2024-01-01", updated_at: "2024-01-02" },
            ];
            const insights = boss.generateInsights(makeHealth(), tasks);
            const quality = insights.find(i => i.category === "quality")!;
            expect(quality.metric).toBe(50); // (4-2)/4 * 100
            expect(quality.trend).toBe("declining");
            expect(quality.actionable).toBe(true);
            expect(quality.suggestedAction).toContain("failed");
        });

        it("should report improving quality when > 90%", () => {
            const tasks = [
                { status: "completed", priority: "P2", created_at: "2024-01-01", updated_at: "2024-01-02" },
                { status: "verified", priority: "P2", created_at: "2024-01-01", updated_at: "2024-01-02" },
                { status: "in_progress", priority: "P2", created_at: "2024-01-01", updated_at: "2024-01-02" },
            ];
            const insights = boss.generateInsights(makeHealth(), tasks);
            const quality = insights.find(i => i.category === "quality")!;
            expect(quality.metric).toBe(100);
            expect(quality.trend).toBe("improving");
            expect(quality.actionable).toBe(false);
        });

        it("should track velocity (WIP count) and flag when too many in progress", () => {
            const tasks = Array.from({ length: 15 }, () => ({
                status: "in_progress", priority: "P2", created_at: "2024-01-01", updated_at: "2024-01-02",
            }));
            const insights = boss.generateInsights(makeHealth(), tasks);
            const velocity = insights.find(i => i.category === "velocity")!;
            expect(velocity.metric).toBe(15);
            expect(velocity.trend).toBe("declining");
            expect(velocity.actionable).toBe(true);
            expect(velocity.suggestedAction).toContain("WIP");
        });

        it("should report improving velocity when few tasks in progress", () => {
            const tasks = [
                { status: "in_progress", priority: "P2", created_at: "2024-01-01", updated_at: "2024-01-02" },
                { status: "completed", priority: "P2", created_at: "2024-01-01", updated_at: "2024-01-02" },
            ];
            const insights = boss.generateInsights(makeHealth(), tasks);
            const velocity = insights.find(i => i.category === "velocity")!;
            expect(velocity.metric).toBe(1);
            expect(velocity.trend).toBe("improving");
        });

        it("should report morale based on team health score", () => {
            const insights = boss.generateInsights(makeHealth({ overallScore: 50, grade: "F" }), []);
            const morale = insights.find(i => i.category === "morale")!;
            expect(morale.metric).toBe(50);
            expect(morale.trend).toBe("declining");
            expect(morale.actionable).toBe(true);
            expect(morale.suggestedAction).toContain("errors");
        });

        it("should report improving morale when team health > 80", () => {
            const insights = boss.generateInsights(makeHealth({ overallScore: 95 }), []);
            const morale = insights.find(i => i.category === "morale")!;
            expect(morale.metric).toBe(95);
            expect(morale.trend).toBe("improving");
            expect(morale.actionable).toBe(false);
        });

        it("should calculate risk level from blocked and failed tasks", () => {
            const tasks = [
                { status: "blocked", priority: "P2", created_at: "2024-01-01", updated_at: "2024-01-02" },
                { status: "blocked", priority: "P2", created_at: "2024-01-01", updated_at: "2024-01-02" },
                { status: "failed", priority: "P2", created_at: "2024-01-01", updated_at: "2024-01-02" },
                { status: "completed", priority: "P2", created_at: "2024-01-01", updated_at: "2024-01-02" },
            ];
            const insights = boss.generateInsights(makeHealth(), tasks);
            const risk = insights.find(i => i.category === "risk")!;
            // 2 blocked * 15 + 1 failed * 10 = 40
            expect(risk.metric).toBe(40);
            expect(risk.trend).toBe("stable");
            expect(risk.actionable).toBe(true);
        });

        it("should cap risk level at 100", () => {
            const tasks = [
                ...Array.from({ length: 5 }, () => ({
                    status: "blocked", priority: "P2", created_at: "2024-01-01", updated_at: "2024-01-02",
                })),
                ...Array.from({ length: 5 }, () => ({
                    status: "failed", priority: "P2", created_at: "2024-01-01", updated_at: "2024-01-02",
                })),
            ];
            const insights = boss.generateInsights(makeHealth(), tasks);
            const risk = insights.find(i => i.category === "risk")!;
            // 5*15 + 5*10 = 125, capped at 100
            expect(risk.metric).toBe(100);
            expect(risk.trend).toBe("declining");
        });

        it("should handle empty tasks list", () => {
            const insights = boss.generateInsights(makeHealth(), []);
            const prod = insights.find(i => i.category === "productivity")!;
            expect(prod.metric).toBe(0);
            const quality = insights.find(i => i.category === "quality")!;
            expect(quality.metric).toBe(100);
        });

        it("should overwrite previous insights on each call", () => {
            boss.generateInsights(makeHealth(), []);
            expect(boss.getInsights()).toHaveLength(5);
            boss.generateInsights(makeHealth(), []);
            expect(boss.getInsights()).toHaveLength(5);
        });
    });

    // =========================================
    // Conflict Resolution & Acknowledgment
    // =========================================
    describe("resolveConflict", () => {
        it("should resolve an existing conflict", () => {
            const tasks = [
                { id: "t1", title: "Setup DB", priority: "P2", status: "failed", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t2", title: "Create API", priority: "P2", status: "not_started", dependencies: ["t1"], estimated_minutes: 45 },
            ];
            const conflicts = boss.detectConflicts(tasks);
            const conflictId = conflicts[0].id;

            const result = boss.resolveConflict(conflictId);
            expect(result).toBe(true);

            const resolved = boss.getConflict(conflictId);
            expect(resolved!.status).toBe("resolved");
            expect(resolved!.resolvedAt).toBeDefined();
        });

        it("should return false for non-existent conflict ID", () => {
            expect(boss.resolveConflict("nonexistent-id")).toBe(false);
        });

        it("should set resolvedAt timestamp", () => {
            const tasks = [
                { id: "t1", title: "Dep", priority: "P2", status: "failed", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t2", title: "Task", priority: "P2", status: "not_started", dependencies: ["t1"], estimated_minutes: 45 },
            ];
            const conflicts = boss.detectConflicts(tasks);
            boss.resolveConflict(conflicts[0].id);
            const c = boss.getConflict(conflicts[0].id)!;
            // Should be a valid ISO date string
            expect(new Date(c.resolvedAt!).toISOString()).toBe(c.resolvedAt);
        });

        it("should remove resolved conflict from active conflicts", () => {
            const tasks = [
                { id: "t1", title: "Dep", priority: "P2", status: "failed", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t2", title: "Task", priority: "P2", status: "not_started", dependencies: ["t1"], estimated_minutes: 45 },
            ];
            const conflicts = boss.detectConflicts(tasks);
            boss.resolveConflict(conflicts[0].id);
            const active = boss.getActiveConflicts();
            expect(active.find(c => c.id === conflicts[0].id)).toBeUndefined();
        });
    });

    describe("acknowledgeConflict", () => {
        it("should acknowledge an existing conflict", () => {
            const tasks = [
                { id: "t1", title: "Setup DB", priority: "P2", status: "failed", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t2", title: "Create API", priority: "P2", status: "not_started", dependencies: ["t1"], estimated_minutes: 45 },
            ];
            const conflicts = boss.detectConflicts(tasks);
            const conflictId = conflicts[0].id;

            const result = boss.acknowledgeConflict(conflictId);
            expect(result).toBe(true);

            const acked = boss.getConflict(conflictId);
            expect(acked!.status).toBe("acknowledged");
        });

        it("should return false for non-existent conflict ID", () => {
            expect(boss.acknowledgeConflict("nonexistent-id")).toBe(false);
        });

        it("should keep acknowledged conflicts in active conflicts list", () => {
            const tasks = [
                { id: "t1", title: "Dep", priority: "P2", status: "failed", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t2", title: "Task", priority: "P2", status: "not_started", dependencies: ["t1"], estimated_minutes: 45 },
            ];
            const conflicts = boss.detectConflicts(tasks);
            boss.acknowledgeConflict(conflicts[0].id);
            const active = boss.getActiveConflicts();
            expect(active.find(c => c.id === conflicts[0].id)).toBeDefined();
        });

        it("should not set resolvedAt on acknowledgment", () => {
            const tasks = [
                { id: "t1", title: "Dep", priority: "P2", status: "failed", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t2", title: "Task", priority: "P2", status: "not_started", dependencies: ["t1"], estimated_minutes: 45 },
            ];
            const conflicts = boss.detectConflicts(tasks);
            boss.acknowledgeConflict(conflicts[0].id);
            const c = boss.getConflict(conflicts[0].id)!;
            expect(c.resolvedAt).toBeUndefined();
        });
    });

    // =========================================
    // Conflict Getters
    // =========================================
    describe("getConflict / getAllConflicts / getActiveConflicts", () => {
        it("should return undefined for unknown conflict ID", () => {
            expect(boss.getConflict("no-such-id")).toBeUndefined();
        });

        it("should return all conflicts including resolved ones", () => {
            const tasks = [
                { id: "t1", title: "Dep", priority: "P2", status: "failed", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t2", title: "Task", priority: "P2", status: "not_started", dependencies: ["t1"], estimated_minutes: 45 },
            ];
            const conflicts = boss.detectConflicts(tasks);
            boss.resolveConflict(conflicts[0].id);
            expect(boss.getAllConflicts()).toHaveLength(conflicts.length);
        });

        it("should return only non-resolved conflicts from getActiveConflicts", () => {
            const tasks = [
                { id: "t1", title: "Failed dep", priority: "P2", status: "failed", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t2", title: "Task A", priority: "P2", status: "not_started", dependencies: ["t1"], estimated_minutes: 45 },
                { id: "t3", title: "Blocked dep", priority: "P2", status: "blocked", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t4", title: "Task B", priority: "P2", status: "not_started", dependencies: ["t3"], estimated_minutes: 45 },
            ];
            const conflicts = boss.detectConflicts(tasks);
            expect(conflicts.length).toBeGreaterThanOrEqual(2);
            boss.resolveConflict(conflicts[0].id);
            const active = boss.getActiveConflicts();
            expect(active.length).toBe(conflicts.length - 1);
        });

        it("should return empty arrays when no conflicts exist", () => {
            expect(boss.getAllConflicts()).toHaveLength(0);
            expect(boss.getActiveConflicts()).toHaveLength(0);
        });

        it("should return copies of conflict arrays (not references)", () => {
            const tasks = [
                { id: "t1", title: "Dep", priority: "P2", status: "failed", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t2", title: "Task", priority: "P2", status: "not_started", dependencies: ["t1"], estimated_minutes: 45 },
            ];
            boss.detectConflicts(tasks);
            const all1 = boss.getAllConflicts();
            const all2 = boss.getAllConflicts();
            expect(all1).not.toBe(all2);
            expect(all1).toEqual(all2);
        });
    });

    // =========================================
    // Insight & Alignment History Getters
    // =========================================
    describe("getInsights / getAlignmentHistory", () => {
        it("should return empty insights before generateInsights is called", () => {
            expect(boss.getInsights()).toHaveLength(0);
        });

        it("should return insights after generation", () => {
            const health: TeamHealth = {
                overallScore: 85, grade: "B",
                members: [], activeCount: 3, idleCount: 0, overloadedCount: 0, errorCount: 0,
                avgSuccessRate: 0.9, avgResponseTime: 5000,
                bottlenecks: [], recommendations: [],
            };
            boss.generateInsights(health, []);
            expect(boss.getInsights()).toHaveLength(5);
        });

        it("should return copy of insights array", () => {
            const health: TeamHealth = {
                overallScore: 85, grade: "B",
                members: [], activeCount: 3, idleCount: 0, overloadedCount: 0, errorCount: 0,
                avgSuccessRate: 0.9, avgResponseTime: 5000,
                bottlenecks: [], recommendations: [],
            };
            boss.generateInsights(health, []);
            const a = boss.getInsights();
            const b = boss.getInsights();
            expect(a).not.toBe(b);
            expect(a).toEqual(b);
        });

        it("should return empty alignment history initially", () => {
            expect(boss.getAlignmentHistory()).toHaveLength(0);
        });

        it("should accumulate alignment history across multiple calls", () => {
            const plan = { id: "p1", name: "Plan", status: "active" };
            boss.checkPlanAlignment(plan, [{ status: "completed", priority: "P2", estimated_minutes: 30 }]);
            boss.checkPlanAlignment(plan, [{ status: "in_progress", priority: "P2", estimated_minutes: 30 }]);
            boss.checkPlanAlignment(plan, [{ status: "failed", priority: "P1", estimated_minutes: 30 }]);
            expect(boss.getAlignmentHistory()).toHaveLength(3);
        });

        it("should return copy of alignment history array", () => {
            const plan = { id: "p1", name: "Plan", status: "active" };
            boss.checkPlanAlignment(plan, []);
            const a = boss.getAlignmentHistory();
            const b = boss.getAlignmentHistory();
            expect(a).not.toBe(b);
            expect(a).toEqual(b);
        });
    });

    // =========================================
    // Reset
    // =========================================
    describe("reset", () => {
        it("should clear all conflicts", () => {
            const tasks = [
                { id: "t1", title: "Dep", priority: "P2", status: "failed", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t2", title: "Task", priority: "P2", status: "not_started", dependencies: ["t1"], estimated_minutes: 45 },
            ];
            boss.detectConflicts(tasks);
            expect(boss.getAllConflicts().length).toBeGreaterThan(0);
            boss.reset();
            expect(boss.getAllConflicts()).toHaveLength(0);
        });

        it("should clear all insights", () => {
            const health: TeamHealth = {
                overallScore: 85, grade: "B",
                members: [], activeCount: 3, idleCount: 0, overloadedCount: 0, errorCount: 0,
                avgSuccessRate: 0.9, avgResponseTime: 5000,
                bottlenecks: [], recommendations: [],
            };
            boss.generateInsights(health, []);
            expect(boss.getInsights()).toHaveLength(5);
            boss.reset();
            expect(boss.getInsights()).toHaveLength(0);
        });

        it("should clear alignment history", () => {
            boss.checkPlanAlignment({ id: "p1", name: "Plan", status: "active" }, []);
            expect(boss.getAlignmentHistory()).toHaveLength(1);
            boss.reset();
            expect(boss.getAlignmentHistory()).toHaveLength(0);
        });

        it("should reset ID counter so new conflicts get fresh IDs", () => {
            const tasks = [
                { id: "t1", title: "Dep", priority: "P2", status: "failed", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t2", title: "Task", priority: "P2", status: "not_started", dependencies: ["t1"], estimated_minutes: 45 },
            ];
            const before = boss.detectConflicts(tasks);
            boss.reset();
            const after = boss.detectConflicts(tasks);
            // After reset, IDs should restart from conf-1
            expect(after[0].id).toBe("conf-1");
        });

        it("should allow normal operation after reset", () => {
            // Fill with data
            const tasks = [
                { id: "t1", title: "Dep", priority: "P2", status: "failed", dependencies: [] as string[], estimated_minutes: 30 },
                { id: "t2", title: "Task", priority: "P2", status: "not_started", dependencies: ["t1"], estimated_minutes: 45 },
            ];
            boss.detectConflicts(tasks);
            boss.checkPlanAlignment({ id: "p1", name: "Plan", status: "active" }, []);
            const health: TeamHealth = {
                overallScore: 85, grade: "B",
                members: [], activeCount: 3, idleCount: 0, overloadedCount: 0, errorCount: 0,
                avgSuccessRate: 0.9, avgResponseTime: 5000,
                bottlenecks: [], recommendations: [],
            };
            boss.generateInsights(health, []);

            // Reset and verify clean state
            boss.reset();
            expect(boss.getAllConflicts()).toHaveLength(0);
            expect(boss.getInsights()).toHaveLength(0);
            expect(boss.getAlignmentHistory()).toHaveLength(0);

            // Verify operations work after reset
            const newConflicts = boss.detectConflicts(tasks);
            expect(newConflicts.length).toBeGreaterThan(0);
            boss.checkPlanAlignment({ id: "p2", name: "Plan 2", status: "active" }, []);
            expect(boss.getAlignmentHistory()).toHaveLength(1);
            boss.generateInsights(health, []);
            expect(boss.getInsights()).toHaveLength(5);
        });
    });
});
