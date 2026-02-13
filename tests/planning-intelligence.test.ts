import { PlanningIntelligence, _resetIdCounter } from "../src/core/planning-intelligence";
import { Task, TaskStatus, TaskPriority } from "../src/types";

function mkTask(overrides:Partial<Task>={}):Task{
    return{id:"t-"+Math.random().toString(36).slice(2,8),title:"Test task",description:"A test task with enough description to be valid here",status:TaskStatus.NotStarted,priority:TaskPriority.P2,dependencies:[],acceptance_criteria:"Task is complete",plan_id:null,parent_task_id:null,sort_order:0,estimated_minutes:30,files_modified:[],context_bundle:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),...overrides};
}

describe("PlanningIntelligence",()=>{
    let pi:PlanningIntelligence;
    beforeEach(()=>{pi=new PlanningIntelligence();_resetIdCounter();});

    describe("analyzeRisks",()=>{
        test("returns low risk for empty task list",()=>{
            const r=pi.analyzeRisks([]);expect(r.overallRisk).toBe("low");expect(r.riskScore).toBe(0);expect(r.factors).toHaveLength(0);expect(r.recommendations).toContain("No tasks to analyze. Create tasks first.");
        });

        test("returns low risk for well-formed small plan",()=>{
            const tasks=[mkTask({id:"t1",priority:TaskPriority.P1}),mkTask({id:"t2",priority:TaskPriority.P2}),mkTask({id:"t3",priority:TaskPriority.P3})];
            const r=pi.analyzeRisks(tasks);expect(r.riskScore).toBeLessThan(50);
        });

        test("detects excessive P1 concentration",()=>{
            const tasks=Array.from({length:10},(_,i)=>mkTask({id:"t"+i,priority:TaskPriority.P1}));
            const r=pi.analyzeRisks(tasks);const f=r.factors.find(f=>f.title.includes("P1"));expect(f).toBeDefined();expect(f!.severity).toBe("high");
        });

        test("detects moderate P1 concentration (50-70%)",()=>{
            const tasks=[...Array.from({length:6},(_,i)=>mkTask({id:"p"+i,priority:TaskPriority.P1})),...Array.from({length:4},(_,i)=>mkTask({id:"q"+i,priority:TaskPriority.P2}))];
            const r=pi.analyzeRisks(tasks);const f=r.factors.find(f=>f.title.includes("P1"));expect(f).toBeDefined();expect(f!.severity).toBe("medium");
        });

        test("detects missing acceptance criteria",()=>{
            const tasks=[mkTask({id:"t1",acceptance_criteria:""}),mkTask({id:"t2",acceptance_criteria:"  "}),mkTask({id:"t3"})];
            const r=pi.analyzeRisks(tasks);const f=r.factors.find(f=>f.title.includes("acceptance criteria"));expect(f).toBeDefined();expect(f!.affectedTasks).toHaveLength(2);
        });

        test("detects vague descriptions",()=>{
            const tasks=[mkTask({id:"t1",description:"short"}),mkTask({id:"t2",description:""})];
            const r=pi.analyzeRisks(tasks);const f=r.factors.find(f=>f.title.includes("Vague"));expect(f).toBeDefined();
        });

        test("detects oversized tasks",()=>{
            const tasks=[mkTask({id:"t1",estimated_minutes:90}),mkTask({id:"t2",estimated_minutes:30})];
            const r=pi.analyzeRisks(tasks);const f=r.factors.find(f=>f.title.includes("Oversized"));expect(f).toBeDefined();
        });

        test("detects oversized tasks with severity high when over 120 min",()=>{
            const tasks=[mkTask({id:"t1",estimated_minutes:150})];
            const r=pi.analyzeRisks(tasks);const f=r.factors.find(f=>f.title.includes("Oversized"));expect(f).toBeDefined();expect(f!.severity).toBe("high");
        });

        test("detects large plan scope (>50 tasks)",()=>{
            const tasks=Array.from({length:55},(_,i)=>mkTask({id:"t"+i}));
            const r=pi.analyzeRisks(tasks);const f=r.factors.find(f=>f.title.includes("Large plan"));expect(f).toBeDefined();expect(f!.severity).toBe("high");
        });

        test("detects moderate plan scope (30-50 tasks)",()=>{
            const tasks=Array.from({length:35},(_,i)=>mkTask({id:"t"+i}));
            const r=pi.analyzeRisks(tasks);const f=r.factors.find(f=>f.title.includes("Moderate plan"));expect(f).toBeDefined();
        });

        test("generates healthy recommendation when no issues",()=>{
            const tasks=[mkTask({id:"t1",priority:TaskPriority.P1}),mkTask({id:"t2",priority:TaskPriority.P2}),mkTask({id:"t3",priority:TaskPriority.P3})];
            const r=pi.analyzeRisks(tasks);expect(r.recommendations).toContain("Plan looks healthy. Proceed with execution.");
        });

        test("risk score is 0-100",()=>{
            const tasks=Array.from({length:60},(_,i)=>mkTask({id:"t"+i,priority:TaskPriority.P1,acceptance_criteria:"",estimated_minutes:120}));
            const r=pi.analyzeRisks(tasks);expect(r.riskScore).toBeGreaterThanOrEqual(0);expect(r.riskScore).toBeLessThanOrEqual(100);
        });

        test("identifies bottlenecks",()=>{
            const t1=mkTask({id:"t1"});const t2=mkTask({id:"t2",dependencies:["t1"]});const t3=mkTask({id:"t3",dependencies:["t1"]});
            const r=pi.analyzeRisks([t1,t2,t3]);expect(r.bottlenecks.length).toBeGreaterThan(0);expect(r.bottlenecks[0].taskId).toBe("t1");
        });
    });

    describe("buildDependencyGraph",()=>{
        test("returns empty graph for empty tasks",()=>{
            const g=pi.buildDependencyGraph([]);expect(g.nodes).toHaveLength(0);expect(g.edges).toHaveLength(0);expect(g.maxDepth).toBe(0);expect(g.hasCycles).toBe(false);
        });

        test("handles single task with no dependencies",()=>{
            const t=mkTask({id:"t1"});const g=pi.buildDependencyGraph([t]);expect(g.nodes).toHaveLength(1);expect(g.nodes[0].depth).toBe(0);expect(g.nodes[0].inDegree).toBe(0);expect(g.nodes[0].outDegree).toBe(0);
        });

        test("builds linear dependency chain",()=>{
            const t1=mkTask({id:"a"});const t2=mkTask({id:"b",dependencies:["a"]});const t3=mkTask({id:"c",dependencies:["b"]});
            const g=pi.buildDependencyGraph([t1,t2,t3]);expect(g.maxDepth).toBe(2);expect(g.edges).toHaveLength(2);expect(g.hasCycles).toBe(false);
        });

        test("calculates correct in-degree and out-degree",()=>{
            const t1=mkTask({id:"a"});const t2=mkTask({id:"b",dependencies:["a"]});const t3=mkTask({id:"c",dependencies:["a"]});
            const g=pi.buildDependencyGraph([t1,t2,t3]);const n1=g.nodes.find(n=>n.id==="a")!;expect(n1.outDegree).toBe(2);expect(n1.inDegree).toBe(0);
            const n2=g.nodes.find(n=>n.id==="b")!;expect(n2.inDegree).toBe(1);
        });

        test("detects simple cycle",()=>{
            const t1=mkTask({id:"a",dependencies:["b"]});const t2=mkTask({id:"b",dependencies:["a"]});
            const g=pi.buildDependencyGraph([t1,t2]);expect(g.hasCycles).toBe(true);expect(g.cycleNodes.length).toBeGreaterThanOrEqual(2);
        });

        test("detects 3-node cycle",()=>{
            const t1=mkTask({id:"a",dependencies:["c"]});const t2=mkTask({id:"b",dependencies:["a"]});const t3=mkTask({id:"c",dependencies:["b"]});
            const g=pi.buildDependencyGraph([t1,t2,t3]);expect(g.hasCycles).toBe(true);
        });

        test("finds critical path",()=>{
            const t1=mkTask({id:"a",estimated_minutes:10});const t2=mkTask({id:"b",dependencies:["a"],estimated_minutes:20});const t3=mkTask({id:"c",dependencies:["a"],estimated_minutes:5});
            const g=pi.buildDependencyGraph([t1,t2,t3]);expect(g.criticalPath).toContain("a");expect(g.criticalPath).toContain("b");
        });

        test("finds parallel groups",()=>{
            const t1=mkTask({id:"a"});const t2=mkTask({id:"b",dependencies:["a"]});const t3=mkTask({id:"c",dependencies:["a"]});
            const g=pi.buildDependencyGraph([t1,t2,t3]);expect(g.parallelGroups.length).toBeGreaterThanOrEqual(1);
            const par=g.parallelGroups.find(g=>g.includes("b")&&g.includes("c"));expect(par).toBeDefined();
        });

        test("ignores dependencies to tasks not in the list",()=>{
            const t1=mkTask({id:"a",dependencies:["nonexistent"]});
            const g=pi.buildDependencyGraph([t1]);expect(g.edges).toHaveLength(0);expect(g.nodes[0].inDegree).toBe(0);
        });

        test("assigns depth -1 to cycle nodes",()=>{
            const t1=mkTask({id:"a",dependencies:["b"]});const t2=mkTask({id:"b",dependencies:["a"]});
            const g=pi.buildDependencyGraph([t1,t2]);const depths=g.nodes.map(n=>n.depth);expect(depths).toContain(-1);
        });

        test("handles diamond dependency pattern",()=>{
            const t1=mkTask({id:"a"});const t2=mkTask({id:"b",dependencies:["a"]});const t3=mkTask({id:"c",dependencies:["a"]});const t4=mkTask({id:"d",dependencies:["b","c"]});
            const g=pi.buildDependencyGraph([t1,t2,t3,t4]);expect(g.maxDepth).toBe(2);expect(g.hasCycles).toBe(false);
        });
    });

    describe("suggestDecompositions",()=>{
        test("returns empty for well-formed tasks",()=>{
            const tasks=[mkTask({id:"t1",estimated_minutes:30,description:"A good description with enough detail",acceptance_criteria:"It works"})];
            expect(pi.suggestDecompositions(tasks)).toHaveLength(0);
        });

        test("suggests decomposition for oversized task",()=>{
            const tasks=[mkTask({id:"t1",estimated_minutes:90,title:"Create something big"})];
            const s=pi.suggestDecompositions(tasks);expect(s).toHaveLength(1);expect(s[0].reason).toContain("45-minute");expect(s[0].suggestedSubtasks.length).toBeGreaterThan(0);
        });

        test("suggests decomposition for vague description",()=>{
            const tasks=[mkTask({id:"t1",description:"short"})];
            const s=pi.suggestDecompositions(tasks);expect(s).toHaveLength(1);expect(s[0].reason).toContain("vague");
        });

        test("suggests decomposition for missing acceptance criteria",()=>{
            const tasks=[mkTask({id:"t1",acceptance_criteria:""})];
            const s=pi.suggestDecompositions(tasks);expect(s).toHaveLength(1);expect(s[0].reason).toContain("Missing acceptance criteria");
        });

        test("generates create-type subtasks",()=>{
            const tasks=[mkTask({id:"t1",title:"Create user service",estimated_minutes:90})];
            const s=pi.suggestDecompositions(tasks);const titles=s[0].suggestedSubtasks.map(st=>st.title);
            expect(titles.some(t=>t.includes("Design"))).toBe(true);expect(titles.some(t=>t.includes("Implement"))).toBe(true);expect(titles.some(t=>t.includes("test"))).toBe(true);
        });

        test("generates fix-type subtasks",()=>{
            const tasks=[mkTask({id:"t1",title:"Fix login bug",estimated_minutes:90})];
            const s=pi.suggestDecompositions(tasks);const titles=s[0].suggestedSubtasks.map(st=>st.title);
            expect(titles.some(t=>t.includes("Investigate"))).toBe(true);expect(titles.some(t=>t.includes("fix"))).toBe(true);
        });

        test("generates refactor-type subtasks",()=>{
            const tasks=[mkTask({id:"t1",title:"Refactor database layer",estimated_minutes:90})];
            const s=pi.suggestDecompositions(tasks);const titles=s[0].suggestedSubtasks.map(st=>st.title);
            expect(titles.some(t=>t.includes("Analyze"))).toBe(true);
        });

        test("generates test-type subtasks",()=>{
            const tasks=[mkTask({id:"t1",title:"Test payment flow",estimated_minutes:90})];
            const s=pi.suggestDecompositions(tasks);const titles=s[0].suggestedSubtasks.map(st=>st.title);
            expect(titles.some(t=>t.includes("happy-path"))).toBe(true);
        });

        test("generates generic subtasks for unrecognized titles",()=>{
            const tasks=[mkTask({id:"t1",title:"Some random work",estimated_minutes:90})];
            const s=pi.suggestDecompositions(tasks);expect(s[0].suggestedSubtasks[0].title).toContain("Step 1");
        });

        test("all subtasks are capped at 45 minutes",()=>{
            const tasks=[mkTask({id:"t1",title:"Create big thing",estimated_minutes:300})];
            const s=pi.suggestDecompositions(tasks);for(const st of s[0].suggestedSubtasks)expect(st.estimatedMinutes).toBeLessThanOrEqual(45);
        });
    });

    describe("optimizeSchedule",()=>{
        test("returns zeros for empty tasks",()=>{
            const r=pi.optimizeSchedule([]);expect(r.originalEstimate.hours).toBe(0);expect(r.savings).toBe(0);
        });

        test("calculates correct original estimate",()=>{
            const tasks=[mkTask({id:"t1",estimated_minutes:60}),mkTask({id:"t2",estimated_minutes:120})];
            const r=pi.optimizeSchedule(tasks);expect(r.originalEstimate.hours).toBe(3);
        });

        test("optimized estimate is less than or equal to original for parallel tasks",()=>{
            const t1=mkTask({id:"a",estimated_minutes:30});const t2=mkTask({id:"b",estimated_minutes:30});const t3=mkTask({id:"c",estimated_minutes:30});
            const r=pi.optimizeSchedule([t1,t2,t3]);expect(r.optimizedEstimate.hours).toBeLessThanOrEqual(r.originalEstimate.hours);
        });

        test("savings is 0-100",()=>{
            const tasks=[mkTask({id:"t1",estimated_minutes:30}),mkTask({id:"t2",estimated_minutes:30})];
            const r=pi.optimizeSchedule(tasks);expect(r.savings).toBeGreaterThanOrEqual(0);expect(r.savings).toBeLessThanOrEqual(100);
        });

        test("identifies parallelization opportunities",()=>{
            const t1=mkTask({id:"a",estimated_minutes:30});const t2=mkTask({id:"b",dependencies:["a"],estimated_minutes:20});const t3=mkTask({id:"c",dependencies:["a"],estimated_minutes:20});
            const r=pi.optimizeSchedule([t1,t2,t3]);expect(r.parallelizationOpportunities.length).toBeGreaterThanOrEqual(1);
        });

        test("suggests reordering for bottleneck tasks",()=>{
            const t1=mkTask({id:"a"});const deps=["b","c","d"].map(id=>mkTask({id,dependencies:["a"]}));
            const r=pi.optimizeSchedule([t1,...deps]);expect(r.reorderingSuggestions.length).toBeGreaterThanOrEqual(1);
        });

        test("calculates days based on 8-hour workday",()=>{
            const tasks=[mkTask({id:"t1",estimated_minutes:480})];
            const r=pi.optimizeSchedule(tasks);expect(r.originalEstimate.days).toBe(1);
        });
    });

    describe("calculatePlanHealth",()=>{
        test("returns F grade for empty plan",()=>{
            const h=pi.calculatePlanHealth([]);expect(h.score).toBe(0);expect(h.grade).toBe("F");
        });

        test("returns high score for well-formed plan",()=>{
            const tasks=[mkTask({id:"t1",priority:TaskPriority.P1,estimated_minutes:30,description:"A well-described task with enough detail for good quality score",acceptance_criteria:"It passes"}),mkTask({id:"t2",priority:TaskPriority.P2,estimated_minutes:25,description:"Another well-described task with detail",acceptance_criteria:"It works"}),mkTask({id:"t3",priority:TaskPriority.P2,estimated_minutes:35,description:"Yet another task with good description length that is detailed enough",acceptance_criteria:"Done"}),mkTask({id:"t4",priority:TaskPriority.P3,estimated_minutes:20,description:"Final well-described task for balanced priority mix right here",acceptance_criteria:"Complete"})];
            const h=pi.calculatePlanHealth(tasks);expect(h.score).toBeGreaterThan(50);
        });

        test("penalizes tasks with no acceptance criteria",()=>{
            const tasks=[mkTask({id:"t1",acceptance_criteria:""}),mkTask({id:"t2",acceptance_criteria:""})];
            const h=pi.calculatePlanHealth(tasks);const f=h.factors.find(f=>f.name==="Acceptance Criteria Coverage");expect(f).toBeDefined();expect(f!.score).toBe(0);
        });

        test("penalizes all-P1 tasks",()=>{
            const tasks=Array.from({length:5},(_,i)=>mkTask({id:"t"+i,priority:TaskPriority.P1}));
            const h=pi.calculatePlanHealth(tasks);const f=h.factors.find(f=>f.name==="Priority Balance");expect(f).toBeDefined();expect(f!.score).toBeLessThan(50);
        });

        test("penalizes oversized tasks in granularity",()=>{
            const tasks=[mkTask({id:"t1",estimated_minutes:90}),mkTask({id:"t2",estimated_minutes:150})];
            const h=pi.calculatePlanHealth(tasks);const f=h.factors.find(f=>f.name==="Task Granularity");expect(f!.score).toBeLessThan(50);
        });

        test("penalizes cycles in dependency health",()=>{
            const t1=mkTask({id:"a",dependencies:["b"]});const t2=mkTask({id:"b",dependencies:["a"]});
            const h=pi.calculatePlanHealth([t1,t2]);const f=h.factors.find(f=>f.name==="Dependency Health");expect(f!.score).toBeLessThanOrEqual(50);
        });

        test("score is 0-100",()=>{
            const tasks=Array.from({length:10},(_,i)=>mkTask({id:"t"+i}));
            const h=pi.calculatePlanHealth(tasks);expect(h.score).toBeGreaterThanOrEqual(0);expect(h.score).toBeLessThanOrEqual(100);
        });

        test("grade A for score >= 90",()=>{
            const tasks=[mkTask({id:"t1",priority:TaskPriority.P1,estimated_minutes:30,description:"Very detailed task description that exceeds fifty characters easily here",acceptance_criteria:"Done"}),mkTask({id:"t2",priority:TaskPriority.P2,estimated_minutes:25,description:"Another very detailed task description that exceeds fifty characters here",acceptance_criteria:"Done"}),mkTask({id:"t3",priority:TaskPriority.P2,estimated_minutes:35,description:"Yet another detailed description for this particular task in the plan",acceptance_criteria:"Done"}),mkTask({id:"t4",priority:TaskPriority.P3,estimated_minutes:20,description:"Final detailed description for a task in a well structured plan here",acceptance_criteria:"Done"})];
            const h=pi.calculatePlanHealth(tasks);expect(["A","B"]).toContain(h.grade);
        });

    });
});
