import { BaseAgent } from './base-agent';
import { TaskDecompositionEngine } from '../core/task-decomposition-engine';
import {
    AgentType, AgentContext, AgentResponse, AgentAction,
    TaskPriority, TaskStatus, PlanStatus
} from '../types';

export class PlanningAgent extends BaseAgent {
    // Optional deterministic decomposition engine — avoids LLM calls for most splits
    private decompositionEngine: TaskDecompositionEngine | null = null;

    /**
     * Inject the deterministic decomposition engine.
     * When set, autoDecompose() tries rule-based splitting first
     * and only falls back to LLM if no deterministic rule matches.
     */
    setDecompositionEngine(engine: TaskDecompositionEngine): void {
        this.decompositionEngine = engine;
        this.outputChannel.appendLine(`[${this.name}] TaskDecompositionEngine injected`);
    }

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
      "testing_instructions": "Run 'npm test -- --testPathPattern=example' and verify all tests pass",
      "task_requirements": {
        "minimum_requirements": [
          {"item": "Function handleExample exists in src/example.ts", "required": true, "verification": "grep for 'function handleExample' in file"},
          {"item": "Function accepts string input and returns Result type", "required": true, "verification": "Check function signature"}
        ],
        "passing_criteria": [
          {"criterion": "Unit tests pass without errors", "verification_method": "unit_test", "must_pass": true},
          {"criterion": "No TypeScript compilation errors", "verification_method": "build_check", "must_pass": true},
          {"criterion": "Function handles edge cases (empty string, null)", "verification_method": "unit_test", "must_pass": false}
        ],
        "gotchas": [
          "Don't forget to export the function",
          "Handle the case where input is undefined"
        ],
        "definition_of_done": "handleExample function exists, is exported, has types, passes all tests",
        "implementation_steps": [
          "Open src/example.ts",
          "Add import for Result type",
          "Create and export handleExample function",
          "Write unit test in tests/example.test.ts",
          "Run npx tsc --noEmit to verify types",
          "Run npm test to verify tests pass"
        ],
        "pre_completion_checklist": [
          "Function is exported (not just defined)",
          "TypeScript types are correct (no 'any')",
          "All unit tests pass",
          "No lint warnings in modified files"
        ]
      }
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
- **task_requirements**: Structured intelligence for the coding agent:
  - **minimum_requirements**: Array of {item, required, verification}. Non-negotiable items that MUST be done.
  - **passing_criteria**: Array of {criterion, verification_method, must_pass}. Methods: unit_test, integration_test, manual_check, code_review, build_check.
  - **gotchas**: Array of strings. Common pitfalls specific to this task type.
  - **definition_of_done**: One sentence — what "done" looks like.
  - **implementation_steps**: Same as step_by_step_implementation but more detailed with verification after each step.
  - **pre_completion_checklist**: Array of things to verify BEFORE marking the task complete.

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
                    // Enforce max 100 tasks per plan (True Plan 03 limit)
                    if (parsed.tasks.length > 100) {
                        this.outputChannel.appendLine(`[${this.name}] Plan "${parsed.plan_name}" has ${parsed.tasks.length} tasks — truncating to 100. Consider creating phases for remaining work.`);
                        this.database.addAuditLog(this.name, 'plan_truncated',
                            `Plan "${parsed.plan_name}" had ${parsed.tasks.length} tasks, truncated to 100`);
                        parsed.tasks = parsed.tasks.slice(0, 100);
                    }

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
                            estimated_minutes: taskDef.estimated_minutes ?? 30,
                            acceptance_criteria: taskDef.acceptance_criteria || '',
                            plan_id: plan.id,
                            dependencies: [],
                            context_bundle: taskDef.context || null,
                            task_requirements: taskDef.task_requirements ? JSON.stringify(taskDef.task_requirements) : null,
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
                        const estMinutes = taskDef.estimated_minutes ?? 30;
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
     *
     * Strategy (deterministic-first):
     * 1. Try TaskDecompositionEngine (rule-based, no LLM) — handles ~80% of cases
     * 2. Fall back to LLM decomposition only if no deterministic rule matches
     *
     * - Sets parent task status to "decomposed"
     * - Creates subtasks with parent_task_id set
     * - Subtasks inherit parent's plan_id + depend on each other in order
     * - If a subtask is still >45 min, recursively decompose (max depth: 3)
     */
    private async autoDecompose(taskId: string, depth: number): Promise<AgentResponse> {
        if (depth >= 3) {
            this.outputChannel.appendLine(`Auto-decompose: max depth (3) reached for task ${taskId}`);
            return { content: `Max decomposition depth reached for task ${taskId}` };
        }

        const task = this.database.getTask(taskId);
        if (!task) return { content: `Task not found: ${taskId}` };

        // --- Attempt 1: Deterministic decomposition (no LLM call) ---
        if (this.decompositionEngine) {
            const deterministicResult = this.decompositionEngine.decompose(task, depth);

            if (deterministicResult && deterministicResult.subtasks.length > 0) {
                this.outputChannel.appendLine(
                    `[${this.name}] Deterministic decomposition: "${task.title}" → ${deterministicResult.subtasks.length} subtasks ` +
                    `(strategy: ${deterministicResult.strategy}, reason: ${deterministicResult.reason})`
                );

                // Create subtasks in the database
                let previousSubtaskId: string | null = null;
                const createdSubtaskIds: string[] = [];

                for (const subtaskDef of deterministicResult.subtasks) {
                    const subtask = this.database.createTask({
                        title: subtaskDef.title,
                        description: subtaskDef.description,
                        priority: subtaskDef.priority ?? (task.priority as TaskPriority) ?? TaskPriority.P2,
                        estimated_minutes: subtaskDef.estimatedMinutes,
                        acceptance_criteria: subtaskDef.acceptanceCriteria,
                        plan_id: task.plan_id ?? undefined,
                        parent_task_id: taskId,
                        dependencies: previousSubtaskId ? [previousSubtaskId] : [],
                        context_bundle: subtaskDef.filesToModify?.length > 0
                            ? subtaskDef.filesToModify.join(', ')
                            : task.context_bundle || null,
                    });

                    createdSubtaskIds.push(subtask.id);
                    previousSubtaskId = subtask.id;

                    // Recursively decompose if subtask is still too large
                    if (subtaskDef.estimatedMinutes > 45) {
                        try {
                            await this.autoDecompose(subtask.id, depth + 1);
                        } catch (err) {
                            this.outputChannel.appendLine(
                                `Recursive decompose failed for subtask "${subtaskDef.title}": ${err}`
                            );
                        }
                    }
                }

                // Mark parent as decomposed
                this.database.updateTask(taskId, { status: TaskStatus.Decomposed });
                this.database.addAuditLog(this.name, 'auto_decompose_deterministic',
                    `Task "${task.title}" decomposed deterministically at depth ${depth}: ${deterministicResult.subtasks.length} subtasks (${deterministicResult.strategy})`);

                return {
                    content: `Task "${task.title}" decomposed into ${deterministicResult.subtasks.length} subtasks (deterministic: ${deterministicResult.strategy}).\n\nSubtasks:\n${deterministicResult.subtasks.map((st, i) => `${i + 1}. ${st.title} (${st.estimatedMinutes} min)`).join('\n')}`,
                    actions: [{
                        type: 'log',
                        payload: { message: `Deterministic decomposition: ${deterministicResult.subtasks.length} subtasks` },
                    }],
                };
            }

            this.outputChannel.appendLine(
                `[${this.name}] No deterministic rule matched for "${task.title}" — falling back to LLM decomposition`
            );
        }

        // --- Attempt 2: LLM-based decomposition (fallback) ---
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
        this.database.addAuditLog(this.name, 'auto_decompose_llm',
            `Task "${task.title}" decomposed via LLM at depth ${depth}`);

        return response;
    }
}
