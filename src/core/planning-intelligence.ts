import { Task, TaskPriority } from '../types';

export interface RiskFactor { id: string; category: 'technical'|'resource'|'schedule'|'scope'|'external'; severity: 'low'|'medium'|'high'|'critical'; probability: number; impact: number; riskScore: number; title: string; description: string; mitigation: string; affectedTasks: string[]; }
export interface RiskAnalysis { overallRisk: 'low'|'medium'|'high'|'critical'; riskScore: number; factors: RiskFactor[]; recommendations: string[]; criticalPath: string[]; bottlenecks: Array<{taskId:string;dependentCount:number;blockingRisk:number}>; }
export interface DependencyNode { id:string;title:string;status:string;priority:string;depth:number;inDegree:number;outDegree:number; }
export interface DependencyEdge { from:string;to:string; }
export interface DependencyGraph { nodes:DependencyNode[];edges:DependencyEdge[];criticalPath:string[];parallelGroups:string[][];maxDepth:number;hasCycles:boolean;cycleNodes:string[]; }
export interface DecompositionSuggestion { taskId:string;reason:string;suggestedSubtasks:Array<{title:string;estimatedMinutes:number;priority:string}>; }
export interface ScheduleOptimization { originalEstimate:{hours:number;days:number};optimizedEstimate:{hours:number;days:number};savings:number;reorderingSuggestions:Array<{taskId:string;suggestedPosition:number;reason:string}>;parallelizationOpportunities:Array<{tasks:string[];savingsMinutes:number}>; }
export interface PlanHealth { score:number;grade:'A'|'B'|'C'|'D'|'F';factors:Array<{name:string;score:number;weight:number;details:string}>; }

const SW: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
let _idc = 0;
function gid(p: string): string { _idc++; return `${p}-${Date.now()}-${_idc}`; }
export function _resetIdCounter(): void { _idc = 0; }

export class PlanningIntelligence {
    analyzeRisks(tasks: Task[]): RiskAnalysis {
        if (tasks.length === 0) return { overallRisk: 'low', riskScore: 0, factors: [], recommendations: ['No tasks to analyze. Create tasks first.'], criticalPath: [], bottlenecks: [] };
        const factors: RiskFactor[] = [];
        const graph = this.buildDependencyGraph(tasks);
        if (tasks.length > 50) factors.push({ id: gid('risk'), category: 'scope', severity: 'high', probability: 0.7, impact: 0.6, riskScore: 0.7*0.6*SW['high'], title: 'Large plan scope', description: `Plan has ${tasks.length} tasks, which increases coordination overhead.`, mitigation: 'Consider breaking the plan into phases of 20-30 tasks each.', affectedTasks: tasks.map(t => t.id) });
        else if (tasks.length > 30) factors.push({ id: gid('risk'), category: 'scope', severity: 'medium', probability: 0.4, impact: 0.4, riskScore: 0.4*0.4*SW['medium'], title: 'Moderate plan scope', description: `Plan has ${tasks.length} tasks. Monitor for scope growth.`, mitigation: 'Review and prune low-priority tasks regularly.', affectedTasks: tasks.map(t => t.id) });
        const p1Tasks = tasks.filter(t => t.priority === TaskPriority.P1);
        const p1Ratio = p1Tasks.length / tasks.length;
        if (p1Ratio > 0.7) factors.push({ id: gid('risk'), category: 'resource', severity: 'high', probability: 0.8, impact: 0.7, riskScore: 0.8*0.7*SW['high'], title: 'Excessive P1 concentration', description: `${Math.round(p1Ratio*100)}% of tasks are P1. When everything is critical, nothing is.`, mitigation: 'Re-prioritize: only truly blocking tasks should be P1.', affectedTasks: p1Tasks.map(t => t.id) });
        else if (p1Ratio > 0.5) factors.push({ id: gid('risk'), category: 'resource', severity: 'medium', probability: 0.5, impact: 0.5, riskScore: 0.5*0.5*SW['medium'], title: 'High P1 concentration', description: `${Math.round(p1Ratio*100)}% of tasks are P1.`, mitigation: 'Review P1 tasks and downgrade those that are not truly blocking.', affectedTasks: p1Tasks.map(t => t.id) });
        const missingCriteria = tasks.filter(t => !t.acceptance_criteria || t.acceptance_criteria.trim().length === 0);
        if (missingCriteria.length > 0) { const ratio = missingCriteria.length / tasks.length; const severity: RiskFactor['severity'] = ratio > 0.5 ? 'high' : ratio > 0.2 ? 'medium' : 'low'; factors.push({ id: gid('risk'), category: 'scope', severity, probability: 0.6+ratio*0.3, impact: 0.5+ratio*0.3, riskScore: (0.6+ratio*0.3)*(0.5+ratio*0.3)*SW[severity], title: 'Missing acceptance criteria', description: `${missingCriteria.length} of ${tasks.length} tasks have no acceptance criteria.`, mitigation: 'Add clear, binary acceptance criteria to every task.', affectedTasks: missingCriteria.map(t => t.id) }); }
        const vagueDescriptions = tasks.filter(t => !t.description || t.description.trim().length < 20);
        if (vagueDescriptions.length > 0) { const ratio = vagueDescriptions.length / tasks.length; const severity: RiskFactor['severity'] = ratio > 0.5 ? 'high' : ratio > 0.2 ? 'medium' : 'low'; factors.push({ id: gid('risk'), category: 'scope', severity, probability: 0.5+ratio*0.3, impact: 0.4+ratio*0.3, riskScore: (0.5+ratio*0.3)*(0.4+ratio*0.3)*SW[severity], title: 'Vague task descriptions', description: `${vagueDescriptions.length} of ${tasks.length} tasks have descriptions shorter than 20 characters.`, mitigation: 'Expand descriptions to include what, why, and context.', affectedTasks: vagueDescriptions.map(t => t.id) }); }
        const oversized = tasks.filter(t => t.estimated_minutes > 45);
        if (oversized.length > 0) { const sev = oversized.some(t => t.estimated_minutes > 120) ? 'high' : 'medium'; factors.push({ id: gid('risk'), category: 'schedule', severity: sev, probability: 0.7, impact: 0.6, riskScore: 0.7*0.6*SW[sev], title: 'Oversized tasks detected', description: `${oversized.length} tasks exceed 45 minutes.`, mitigation: 'Decompose tasks >45 min into 15-45 min subtasks.', affectedTasks: oversized.map(t => t.id) }); }
        if (graph.maxDepth > 3) { const deepNodes = graph.nodes.filter(n => n.depth > 3); const sev = graph.maxDepth > 5 ? 'critical' : 'high'; factors.push({ id: gid('risk'), category: 'schedule', severity: sev, probability: 0.6, impact: 0.8, riskScore: 0.6*0.8*SW[sev], title: 'Deep dependency chains', description: `Maximum dependency depth is ${graph.maxDepth}.`, mitigation: 'Flatten the dependency graph.', affectedTasks: deepNodes.map(n => n.id) }); }
        if (graph.hasCycles) factors.push({ id: gid('risk'), category: 'technical', severity: 'critical', probability: 1.0, impact: 1.0, riskScore: 1.0*1.0*SW['critical'], title: 'Circular dependencies detected', description: `${graph.cycleNodes.length} tasks are involved in dependency cycles.`, mitigation: 'Break the cycles by removing or reversing at least one dependency.', affectedTasks: graph.cycleNodes });
        const bottleneckNodes = graph.nodes.filter(n => n.outDegree > 3);
        for (const node of bottleneckNodes) { const sev = node.outDegree > 5 ? 'high' : 'medium'; factors.push({ id: gid('risk'), category: 'schedule', severity: sev, probability: 0.5, impact: 0.3+(node.outDegree/tasks.length), riskScore: 0.5*(0.3+(node.outDegree/tasks.length))*SW[sev], title: `Bottleneck: "${node.title}"`, description: `Task "${node.title}" has ${node.outDegree} tasks depending on it.`, mitigation: `Prioritize "${node.title}" for early completion.`, affectedTasks: [node.id] }); }
        const totalMinutes = tasks.reduce((sum, t) => sum + (t.estimated_minutes ?? 0), 0);
        const totalHours = totalMinutes / 60;
        if (totalHours > 80) { const sev = totalHours > 160 ? 'critical' : 'high'; factors.push({ id: gid('risk'), category: 'schedule', severity: sev, probability: 0.6, impact: 0.7, riskScore: 0.6*0.7*SW[sev], title: 'High total effort estimate', description: `Plan totals ${totalHours.toFixed(1)} hours of work.`, mitigation: 'Break the plan into incremental milestones.', affectedTasks: tasks.map(t => t.id) }); }
        const rawScore = factors.reduce((sum, f) => sum + f.riskScore, 0);
        const maxPossible = Math.max(factors.length * 4, 1);
        const overallScore = Math.min(100, Math.round((rawScore / maxPossible) * 100));
        const overallRisk: RiskAnalysis['overallRisk'] = overallScore >= 75 ? 'critical' : overallScore >= 50 ? 'high' : overallScore >= 25 ? 'medium' : 'low';
        const bottlenecks = graph.nodes.filter(n => n.outDegree > 0).sort((a, b) => b.outDegree - a.outDegree).slice(0, 5).map(n => ({ taskId: n.id, dependentCount: n.outDegree, blockingRisk: n.outDegree / tasks.length }));
        const recommendations: string[] = [];
        if (graph.hasCycles) recommendations.push('CRITICAL: Resolve dependency cycles before starting any work.');
        if (missingCriteria.length > 0) recommendations.push(`Add acceptance criteria to ${missingCriteria.length} tasks.`);
        if (oversized.length > 0) recommendations.push(`Decompose ${oversized.length} oversized tasks (>45 min).`);
        if (p1Ratio > 0.5) recommendations.push('Re-prioritize tasks: too many P1 tasks dilute focus.');
        if (graph.maxDepth > 3) recommendations.push('Flatten dependency chains to reduce cascading delay risk.');
        if (bottleneckNodes.length > 0) recommendations.push('Prioritize bottleneck tasks for early completion.');
        if (recommendations.length === 0) recommendations.push('Plan looks healthy. Proceed with execution.');
        return { overallRisk, riskScore: overallScore, factors, recommendations, criticalPath: graph.criticalPath, bottlenecks };
    }



    buildDependencyGraph(tasks:Task[]):DependencyGraph{
        if(!tasks.length)return{nodes:[],edges:[],criticalPath:[],parallelGroups:[],maxDepth:0,hasCycles:false,cycleNodes:[]};
        const tids=new Set(tasks.map(t=>t.id));
        const adj=new Map<string,string[]>();const rev=new Map<string,string[]>();
        for(const id of tids){adj.set(id,[]);rev.set(id,[]);}
        const edges:DependencyEdge[]=[];
        for(const t of tasks){for(const d of t.dependencies||[]){if(tids.has(d)){edges.push({from:d,to:t.id});adj.get(d)!.push(t.id);rev.get(t.id)!.push(d);}}}
        const W=0,G=1,BK=2;const color=new Map<string,number>();const cyc=new Set<string>();let hasCyc=false;
        for(const id of tids)color.set(id,W);
        const dfsc=(nid:string,anc:Set<string>):void=>{color.set(nid,G);anc.add(nid);for(const nb of adj.get(nid)!){if(color.get(nb)===G){hasCyc=true;cyc.add(nb);cyc.add(nid);for(const x of anc)cyc.add(x);}else if(color.get(nb)===W)dfsc(nb,new Set(anc));}color.set(nid,BK);};
        for(const id of tids){if(color.get(id)===W)dfsc(id,new Set());}
        const inD=new Map<string,number>();for(const id of tids)inD.set(id,rev.get(id)!.length);
        const dm=new Map<string,number>();const q:string[]=[];
        for(const id of tids){if(inD.get(id)===0){q.push(id);dm.set(id,0);}}
        let mxD=0;while(q.length>0){const cur=q.shift()!;for(const nb of adj.get(cur)!){const nd=dm.get(cur)!+1;const cd=dm.get(nb);if(cd===undefined||nd>cd){dm.set(nb,nd);if(nd>mxD)mxD=nd;}const ni=inD.get(nb)!-1;inD.set(nb,ni);if(ni===0)q.push(nb);}}
        for(const id of tids){if(!dm.has(id))dm.set(id,-1);}
        const cp=this._cp(tasks,rev,dm);const pg=this._pg(tasks,dm,rev);
        const nodes:DependencyNode[]=tasks.map(t=>({id:t.id,title:t.title,status:t.status,priority:t.priority,depth:dm.get(t.id)!,inDegree:rev.get(t.id)!.length,outDegree:adj.get(t.id)!.length}));
        return{nodes,edges,criticalPath:cp,parallelGroups:pg,maxDepth:mxD,hasCycles:hasCyc,cycleNodes:Array.from(cyc)};
    }

    private _cp(tasks:Task[],rev:Map<string,string[]>,dm:Map<string,number>):string[]{
        /* istanbul ignore next -- _cp is only called from buildDependencyGraph which checks for empty tasks */
        if(!tasks.length)return[];
        const dist=new Map<string,number>();const pred=new Map<string,string|null>();
        const sorted=[...tasks].filter(t=>dm.get(t.id)!>=0).sort((a,b)=>dm.get(a.id)!-dm.get(b.id)!);
        for(const t of sorted){const deps=rev.get(t.id)!;if(!deps.length){dist.set(t.id,t.estimated_minutes??0);pred.set(t.id,null);}else{let mx=0;let bp:string|null=null;for(const d of deps){const v=dist.get(d)!;if(v>mx){mx=v;bp=d;}}dist.set(t.id,mx+(t.estimated_minutes??0));pred.set(t.id,bp);}}
        let en:string|null=null;let mx=0;for(const[id,d]of dist){if(d>mx){mx=d;en=id;}}
        const path:string[]=[];let cur=en;while(cur!==null){path.unshift(cur);cur=pred.get(cur)??null;}
        return path;
    }

    private _pg(tasks:Task[],dm:Map<string,number>,rev:Map<string,string[]>):string[][]{
        const dg=new Map<number,string[]>();
        for(const t of tasks){const d=dm.get(t.id)!;if(d<0)continue;if(!dg.has(d))dg.set(d,[]);dg.get(d)!.push(t.id);}
        const groups:string[][]=[];
        /* istanbul ignore next -- in a DAG, same-depth nodes cannot have inter-edges; par always equals nodes */
        for(const[,nodes]of dg){if(nodes.length>1){const sd=new Set<string>();for(const id of nodes){for(const dep of rev.get(id)!){if(nodes.includes(dep)){sd.add(id);sd.add(dep);}}}const par=nodes.filter(id=>!sd.has(id));if(par.length>1)groups.push(par);}}
        return groups;
    }

    suggestDecompositions(tasks:Task[]):DecompositionSuggestion[]{
        const sug:DecompositionSuggestion[]=[];
        for(const task of tasks){
            const r:string[]=[];
            if(task.estimated_minutes>45)r.push(`Estimated ${task.estimated_minutes} minutes exceeds 45-minute limit`);
            if(!task.description||task.description.trim().length<20)r.push("Description is too vague (less than 20 characters)");
            if(!task.acceptance_criteria||task.acceptance_criteria.trim().length===0)r.push("Missing acceptance criteria");
            if(r.length>0)sug.push({taskId:task.id,reason:r.join("; "),suggestedSubtasks:this._gsub(task)});
        }
        return sug;
    }

    private _gsub(task:Task):Array<{title:string;estimatedMinutes:number;priority:string}>{
        const s:Array<{title:string;estimatedMinutes:number;priority:string}>=[];const t=task.title.toLowerCase();const pr=task.priority;
        const tgt=Math.max(2,Math.ceil((task.estimated_minutes??30)/30));
        if(t.includes("create")||t.includes("implement")||t.includes("add")||t.includes("build")){
            s.push({title:`Design interface/API for: ${task.title}`,estimatedMinutes:20,priority:pr},{title:`Implement core logic for: ${task.title}`,estimatedMinutes:30,priority:pr},{title:`Write unit tests for: ${task.title}`,estimatedMinutes:25,priority:pr});
            if(tgt>3)s.push({title:`Add error handling for: ${task.title}`,estimatedMinutes:20,priority:pr});
            if(tgt>4)s.push({title:`Document: ${task.title}`,estimatedMinutes:15,priority:TaskPriority.P3});
        }else if(t.includes("fix")||t.includes("debug")||t.includes("resolve")){
            s.push({title:`Investigate root cause for: ${task.title}`,estimatedMinutes:20,priority:pr},{title:`Implement fix for: ${task.title}`,estimatedMinutes:25,priority:pr},{title:`Write regression test for: ${task.title}`,estimatedMinutes:20,priority:pr});
        }else if(t.includes("refactor")||t.includes("update")||t.includes("migrate")){
            s.push({title:`Analyze current code for: ${task.title}`,estimatedMinutes:20,priority:pr},{title:`Apply changes for: ${task.title}`,estimatedMinutes:30,priority:pr},{title:`Update tests for: ${task.title}`,estimatedMinutes:20,priority:pr});
            if(tgt>3)s.push({title:`Verify backwards compatibility for: ${task.title}`,estimatedMinutes:15,priority:pr});
        }else if(t.includes("test")||t.includes("verify")){
            s.push({title:`Write happy-path tests for: ${task.title}`,estimatedMinutes:25,priority:pr},{title:`Write edge-case tests for: ${task.title}`,estimatedMinutes:25,priority:pr},{title:`Write error-handling tests for: ${task.title}`,estimatedMinutes:20,priority:pr});
        }else{
            const mps=Math.ceil((task.estimated_minutes??30)/tgt);
            for(let i=0;i<tgt;i++)s.push({title:`Step ${i+1} of: ${task.title}`,estimatedMinutes:Math.min(mps,45),priority:pr});
        }
        return s.map(x=>({...x,estimatedMinutes:Math.min(x.estimatedMinutes,45)}));
    }

    optimizeSchedule(tasks:Task[]):ScheduleOptimization{
        if(!tasks.length)return{originalEstimate:{hours:0,days:0},optimizedEstimate:{hours:0,days:0},savings:0,reorderingSuggestions:[],parallelizationOpportunities:[]};
        const graph=this.buildDependencyGraph(tasks);const tm=new Map(tasks.map(t=>[t.id,t]));
        const totalMin=tasks.reduce((s,t)=>s+(t.estimated_minutes??0),0);
        const totalH=totalMin/60;const totalD=totalH/8;
        const dtm=new Map<number,number>();
        for(const n of graph.nodes){if(n.depth<0)continue;const m=tm.get(n.id)?.estimated_minutes??0;dtm.set(n.depth,Math.max(dtm.get(n.depth)??0,m));}
        let optMin=0;for(const m of dtm.values())optMin+=m;
        optMin+=tasks.filter(t=>graph.cycleNodes.includes(t.id)).reduce((s,t)=>s+(t.estimated_minutes??0),0);
        const optH=optMin/60;const optD=optH/8;
        const savings=totalMin>0?Math.round(((totalMin-optMin)/totalMin)*100):0;
        const parOps:ScheduleOptimization["parallelizationOpportunities"]=[];
        for(const g of graph.parallelGroups){if(g.length>1){const gm=g.map(id=>tm.get(id)?.estimated_minutes??0);const mx=Math.max(...gm);const tot=gm.reduce((a,b)=>a+b,0);if(tot-mx>0)parOps.push({tasks:g,savingsMinutes:tot-mx});}}
        const reorder:ScheduleOptimization["reorderingSuggestions"]=[];
        const bn=graph.nodes.filter(n=>n.outDegree>2).sort((a,b)=>b.outDegree-a.outDegree);
        for(let i=0;i<Math.min(bn.length,5);i++){if(tm.has(bn[i].id))reorder.push({taskId:bn[i].id,suggestedPosition:i,reason:`Bottleneck: ${bn[i].outDegree} tasks depend on this. Complete early.`});}
        for(const lf of graph.nodes.filter(n=>n.outDegree===0&&n.inDegree>0).slice(0,3)){const t=tm.get(lf.id);if(t&&t.priority===TaskPriority.P3)reorder.push({taskId:lf.id,suggestedPosition:tasks.length-1,reason:"Low-priority leaf task can be deferred."});}
        return{originalEstimate:{hours:Math.round(totalH*10)/10,days:Math.round(totalD*10)/10},optimizedEstimate:{hours:Math.round(optH*10)/10,days:Math.round(optD*10)/10},savings:Math.max(0,savings),reorderingSuggestions:reorder,parallelizationOpportunities:parOps};
    }

    calculatePlanHealth(tasks:Task[]):PlanHealth{
        if(!tasks.length)return{score:0,grade:"F",factors:[{name:"No tasks",score:0,weight:1,details:"Plan has no tasks."}]};
        const factors:PlanHealth["factors"]=[];
        const inR=tasks.filter(t=>t.estimated_minutes>=15&&t.estimated_minutes<=45).length;
        const o45=tasks.filter(t=>t.estimated_minutes>45).length;const o120=tasks.filter(t=>t.estimated_minutes>120).length;
        let gs=(inR/tasks.length)*100-o120*10;gs=Math.max(0,Math.min(100,gs));
        factors.push({name:"Task Granularity",score:Math.round(gs),weight:25,details:`${inR}/${tasks.length} in 15-45 min. ${o45} oversized. ${o120} exceed 2h.`});
        const wAC=tasks.filter(t=>t.acceptance_criteria&&t.acceptance_criteria.trim().length>0).length;
        factors.push({name:"Acceptance Criteria Coverage",score:Math.round((wAC/tasks.length)*100),weight:20,details:`${wAC}/${tasks.length} have criteria.`});
        const pc1=tasks.filter(t=>t.priority===TaskPriority.P1).length;const pc2=tasks.filter(t=>t.priority===TaskPriority.P2).length;const pc3=tasks.filter(t=>t.priority===TaskPriority.P3).length;
        const avgDv=(Math.abs(pc1/tasks.length-0.3)+Math.abs(pc2/tasks.length-0.4)+Math.abs(pc3/tasks.length-0.3))/3;
        let ps=Math.max(0,(1-avgDv*3)*100);if(new Set(tasks.map(t=>t.priority)).size===1)ps=Math.max(0,ps-30);
        factors.push({name:"Priority Balance",score:Math.round(ps),weight:15,details:`P1:${pc1} P2:${pc2} P3:${pc3}. ${new Set(tasks.map(t=>t.priority)).size} distinct.`});
        const gr=this.buildDependencyGraph(tasks);let ds=100;
        if(gr.hasCycles)ds-=50;if(gr.maxDepth>5)ds-=30;else if(gr.maxDepth>3)ds-=15;
        const avgIn=gr.nodes.reduce((s,n)=>s+n.inDegree,0)/Math.max(gr.nodes.length,1);
        if(avgIn>2)ds-=Math.min(20,(avgIn-2)*10);ds=Math.max(0,ds);
        factors.push({name:"Dependency Health",score:Math.round(ds),weight:20,details:`Depth:${gr.maxDepth}. Cycles:${gr.hasCycles?"YES":"No"}. AvgIn:${avgIn.toFixed(1)}.`});
        const dLens=tasks.map(t=>(t.description??"").trim().length);const avgDL=dLens.reduce((a,b)=>a+b,0)/tasks.length;
        const goodD=dLens.filter(l=>l>=50).length;let dqs=Math.min(100,(avgDL/50)*100*0.5+(goodD/tasks.length)*100*0.5);dqs=Math.max(0,Math.min(100,dqs));
        factors.push({name:"Description Quality",score:Math.round(dqs),weight:10,details:`Avg:${Math.round(avgDL)} chars. ${goodD}/${tasks.length}>=50.`});
        const o2h=tasks.filter(t=>t.estimated_minutes>120).length;const o1h=tasks.filter(t=>t.estimated_minutes>60).length;
        let drs=Math.max(0,100-o2h*25-o1h*10);
        factors.push({name:"Decomposition Readiness",score:Math.round(drs),weight:10,details:`${o2h} exceed 2h. ${o1h} exceed 1h.`});
        const tw=factors.reduce((s,f)=>s+f.weight,0);const ws=factors.reduce((s,f)=>s+f.score*f.weight,0)/tw;
        const final=Math.round(Math.max(0,Math.min(100,ws)));
        const grade:PlanHealth["grade"]=final>=90?"A":final>=80?"B":final>=70?"C":final>=60?"D":"F";
        return{score:final,grade,factors};
    }
}
