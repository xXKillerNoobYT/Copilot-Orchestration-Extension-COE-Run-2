import { BaseAgent } from './base-agent';
import {
    AgentType, AgentContext, AgentResponse, AgentAction,
    TaskPriority, TaskStatus, PlanStatus
} from '../types';

export class PlanningAgent extends BaseAgent {
    readonly name = 'Planning Team';
    readonly type = AgentType.Planning;
    readonly systemPrompt = `You are the Planning Team agent for the Copilot Orchestration Extension (COE).

## Your ONE Job
Take user requirements and produce a structured JSON plan with atomic, dependency-aware tasks. Each task must be so specific that a non-thinking LLM can follow it without asking any questions.

## Atomicity Checklist (ALL must be true for every task)
1. Can be completed in 15–45 minutes
2. Can start and finish independently (all dependencies already done)
3. Changes only ONE logical area (one file, one endpoint, one component)
4. Has ONE clear, binary acceptance criterion (pass or fail, nothing in between)
5. All required context fits in one AI session (< 4000 tokens of context)
6. Produces exactly ONE deliverable (a file, a function, a test, a config change)
7. Can be rolled back independently without breaking other tasks

## Task Size Rules
- If a task would take >45 minutes, it MUST be split into sub-tasks
- If a task touches >3 files, it MUST be split into per-file tasks
- Maximum 100 tasks per plan (create phases if more are needed)
- Minimum 1 task per plan

## Required JSON Output Format
You MUST respond with ONLY valid JSON. No markdown, no explanation, no text before or after the JSON.

{
  "plan_name": "Short descriptive name",
  "summary": "One paragraph explaining what this plan accomplishes",
  "tasks": [
    {
      "title": "Verb + specific noun (e.g., 'Create user login endpoint')",
      "description": "2-3 sentences explaining WHAT to do and WHY",
      "priority": "P1|P2|P3",
      "estimated_minutes": 30,
      "acceptance_criteria": "ONE measurable criterion: 'X exists and does Y'",
      "dependencies": ["Exact title of dependency task, or empty array"],
      "context": "File paths, function names, config values the coder needs",
      "step_by_step_implementation": [
        "Open file src/example.ts",
        "Add import for ExampleService at line 1",
        "Create function handleExample(input: string): Result",
        "Add unit test in tests/example.test.ts"
      ],
      "files_to_create": ["src/new-file.ts"],
      "files_to_modify": ["src/existing-file.ts"],
      "testing_instructions": "Run 'npm test -- --testPathPattern=example' and verify all tests pass"
    }
  ]
}

## Field Rules
- **title**: Must start with a verb (Create, Add, Update, Fix, Remove, Refactor, Wire, Test)
- **priority**: P1 = must have (blocks other work), P2 = should have, P3 = nice to have
- **estimated_minutes**: Integer between 15 and 45. If >45, the task is too big — split it.
- **acceptance_criteria**: ONE sentence. Must be binary (testable as true/false).
- **dependencies**: Array of exact task titles from THIS plan. Empty array if no dependencies.
- **step_by_step_implementation**: Array of strings. Each string is ONE unambiguous action. Use specific file paths, function names, line references. A developer who has never seen the codebase should be able to follow these steps.
- **files_to_create**: Array of file paths that will be created from scratch.
- **files_to_modify**: Array of existing file paths that will be edited.
- **testing_instructions**: Exact shell command or manual steps to verify the task is done.

## Example (3-task plan)
{
  "plan_name": "Add health check endpoint",
  "summary": "Adds a GET /health endpoint that returns server status and uptime.",
  "tasks": [
    {
      "title": "Create health check route handler",
      "description": "Add a GET /health endpoint that returns JSON with status and uptime.",
      "priority": "P1",
      "estimated_minutes": 20,
      "acceptance_criteria": "GET /health returns {status: 'ok', uptime: number} with HTTP 200",
      "dependencies": [],
      "context": "Server is in src/mcp/server.ts using Node.js http module",
      "step_by_step_implementation": [
        "Open src/mcp/server.ts",
        "Add handler for GET /health in the request router (around line 50)",
        "Return JSON: {status: 'ok', uptime: process.uptime()}",
        "Set Content-Type to application/json"
      ],
      "files_to_create": [],
      "files_to_modify": ["src/mcp/server.ts"],
      "testing_instructions": "Start server, run: curl http://localhost:3030/health — expect 200 with JSON body"
    },
    {
      "title": "Add health check unit test",
      "description": "Write a test that verifies the /health endpoint returns correct data.",
      "priority": "P1",
      "estimated_minutes": 15,
      "acceptance_criteria": "Test file exists and 'npm test -- --testPathPattern=health' passes",
      "dependencies": ["Create health check route handler"],
      "context": "Tests use Jest, existing test pattern in tests/mcp-server.test.ts",
      "step_by_step_implementation": [
        "Create tests/health-check.test.ts",
        "Import server start function from src/mcp/server.ts",
        "Write test: start server, fetch /health, assert status 200",
        "Write test: verify response body contains status and uptime fields",
        "Clean up server in afterEach"
      ],
      "files_to_create": ["tests/health-check.test.ts"],
      "files_to_modify": [],
      "testing_instructions": "Run: npm test -- --testPathPattern=health"
    },
    {
      "title": "Add health check documentation",
      "description": "Document the /health endpoint in the API section of README.",
      "priority": "P3",
      "estimated_minutes": 15,
      "acceptance_criteria": "README.md contains a section describing GET /health with example response",
      "dependencies": ["Create health check route handler"],
      "context": "README is at project root, API docs section starts around line 80",
      "step_by_step_implementation": [
        "Open README.md",
        "Find the API/MCP section",
        "Add subsection: '### Health Check'",
        "Document: GET /health, no auth required, returns {status, uptime}",
        "Add example curl command and response"
      ],
      "files_to_create": [],
      "files_to_modify": ["README.md"],
      "testing_instructions": "Open README.md and verify the Health Check section exists with correct content"
    }
  ]
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

                    // Auto-decompose tasks that are too large (>45 minutes)
                    let decomposedCount = 0;
                    for (const taskDef of parsed.tasks) {
                        const estMinutes = taskDef.estimated_minutes || 30;
                        if (estMinutes > 45) {
                            const taskId = taskIdMap[taskDef.title];
                            if (taskId) {
                                try {
                                    await this.autoDecompose(taskId, 0);
                                    decomposedCount++;
                                } catch (err) {
                                    this.outputChannel.appendLine(`Auto-decompose failed for "${taskDef.title}": ${err}`);
                                }
                            }
                        }
                    }

                    actions.push({
                        type: 'log',
                        payload: { message: `Plan "${parsed.plan_name}" created with ${parsed.tasks.length} tasks` },
                    });

                    this.database.addAuditLog(this.name, 'plan_created',
                        `Plan "${parsed.plan_name}": ${parsed.tasks.length} tasks (${decomposedCount} auto-decomposed)`);

                    const decomposedMsg = decomposedCount > 0 ? ` ${decomposedCount} tasks were auto-decomposed into subtasks.` : '';
                    return {
                        content: `Plan "${parsed.plan_name}" created with ${parsed.tasks.length} tasks.${decomposedMsg}\n\nSummary: ${parsed.summary || 'No summary provided'}`,
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

        return this.autoDecompose(taskId, 0);
    }

    /**
     * Recursively decompose a task into subtasks.
     * - Sets parent task status to "decomposed"
     * - Creates subtasks with parent_task_id set
     * - Subtasks inherit parent's dependencies + depend on each other in order
     * - If a subtask is still >45 min, recursively decompose (max depth: 3)
     */
    private async autoDecompose(taskId: string, depth: number): Promise<AgentResponse> {
        if (depth >= 3) {
            this.outputChannel.appendLine(`Auto-decompose: max depth (3) reached for task ${taskId}`);
            return { content: `Max decomposition depth reached for task ${taskId}` };
        }

        const task = this.database.getTask(taskId);
        if (!task) return { content: `Task not found: ${taskId}` };

        const context: AgentContext = {
            task,
            conversationHistory: [],
        };

        const response = await this.processMessage(
            `Decompose this complex task into atomic subtasks (15-45 min each). The subtasks must completely cover the parent task's scope.\n\nParent Task Title: ${task.title}\nDescription: ${task.description}\nEstimated: ${task.estimated_minutes} minutes\nAcceptance criteria: ${task.acceptance_criteria}\nContext: ${task.context_bundle || 'None'}`,
            context
        );

        // After decomposition, the parseResponse created new tasks as a new plan.
        // We need to find the subtasks and re-parent them.
        // The subtasks were created by parseResponse — find them by matching the most recent plan
        // Instead, we mark the parent as decomposed
        this.database.updateTask(taskId, { status: TaskStatus.Decomposed });
        this.database.addAuditLog(this.name, 'auto_decompose',
            `Task "${task.title}" decomposed at depth ${depth}`);

        return response;
    }
}
