import { BaseAgent } from './base-agent';
import {
    AgentType, AgentContext, AgentResponse, AgentAction,
    TaskPriority, TaskStatus, PlanStatus
} from '../types';

export class PlanningAgent extends BaseAgent {
    readonly name = 'Planning Team';
    readonly type = AgentType.Planning;
    readonly systemPrompt = `You are the Planning Team agent for COE. Your responsibilities:
1. Analyze user requirements and generate structured plans
2. Break complex requirements into atomic tasks (15-45 minutes each)
3. Create dependency-aware task lists
4. Estimate effort and timelines
5. Prepare detailed context bundles for the coding agent

Every task you create must pass the atomicity checklist:
- Can be completed in 15-45 minutes
- Can start and finish independently
- Changes only ONE logical area
- Has ONE clear, measurable acceptance criterion
- All dependencies are already completed or noted
- All required context fits in one AI session
- Produces exactly ONE deliverable
- Can be rolled back independently

Respond in JSON format:
{
  "plan_name": "string",
  "tasks": [
    {
      "title": "string",
      "description": "string",
      "priority": "P1|P2|P3",
      "estimated_minutes": number,
      "acceptance_criteria": "string",
      "dependencies": ["task_title_1"],
      "context": "string"
    }
  ],
  "summary": "string"
}`;

    protected async parseResponse(content: string, context: AgentContext): Promise<AgentResponse> {
        const actions: AgentAction[] = [];

        try {
            // Try to extract JSON from the response
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);

                if (parsed.plan_name && parsed.tasks) {
                    // Create the plan
                    const plan = this.database.createPlan(parsed.plan_name, JSON.stringify(parsed));
                    this.database.updatePlan(plan.id, { status: PlanStatus.Active });

                    // Create tasks
                    const taskIdMap: Record<string, string> = {};

                    for (const taskDef of parsed.tasks) {
                        const task = this.database.createTask({
                            title: taskDef.title,
                            description: taskDef.description || '',
                            priority: (taskDef.priority as TaskPriority) || TaskPriority.P2,
                            estimated_minutes: taskDef.estimated_minutes || 30,
                            acceptance_criteria: taskDef.acceptance_criteria || '',
                            plan_id: plan.id,
                            dependencies: [],
                            context_bundle: taskDef.context || null,
                        });
                        taskIdMap[taskDef.title] = task.id;
                    }

                    // Wire up dependencies by title
                    for (const taskDef of parsed.tasks) {
                        if (taskDef.dependencies && taskDef.dependencies.length > 0) {
                            const taskId = taskIdMap[taskDef.title];
                            const depIds = taskDef.dependencies
                                .map((depTitle: string) => taskIdMap[depTitle])
                                .filter(Boolean);
                            if (depIds.length > 0) {
                                this.database.updateTask(taskId, { dependencies: depIds });
                            }
                        }
                    }

                    actions.push({
                        type: 'log',
                        payload: { message: `Plan "${parsed.plan_name}" created with ${parsed.tasks.length} tasks` },
                    });

                    this.database.addAuditLog(this.name, 'plan_created',
                        `Plan "${parsed.plan_name}": ${parsed.tasks.length} tasks`);

                    return {
                        content: `Plan "${parsed.plan_name}" created with ${parsed.tasks.length} tasks.\n\nSummary: ${parsed.summary || 'No summary provided'}`,
                        actions,
                    };
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`Planning parse error: ${error}`);
        }

        return { content, actions };
    }

    async decompose(taskId: string): Promise<AgentResponse> {
        const task = this.database.getTask(taskId);
        if (!task) return { content: `Task not found: ${taskId}` };

        if (task.estimated_minutes <= 45) {
            return { content: `Task "${task.title}" is already atomic (${task.estimated_minutes} min)` };
        }

        const context: AgentContext = {
            task,
            conversationHistory: this.database.getConversationsByTask(taskId),
        };

        return this.processMessage(
            `Decompose this complex task into atomic subtasks (15-45 min each):\n\nTitle: ${task.title}\nDescription: ${task.description}\nEstimated: ${task.estimated_minutes} minutes\nAcceptance criteria: ${task.acceptance_criteria}`,
            context
        );
    }
}
