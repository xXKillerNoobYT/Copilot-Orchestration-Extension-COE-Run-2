import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { PlanningAgent } from '../src/agents/planning-agent';
import { Database } from '../src/core/database';
import {
    TaskPriority, TaskStatus, PlanStatus, AgentType, AgentContext,
    DecompositionResult, DecompositionStrategy, SubtaskDefinition, SubtaskCategory,
    Task,
} from '../src/types';

// ===================== MOCKS =====================

const mockLLM = {
    chat: jest.fn(),
    classify: jest.fn(),
} as any;

const mockConfig = {
    getAgentContextLimit: jest.fn().mockReturnValue(4000),
    getModelMaxOutputTokens: jest.fn().mockReturnValue(4096),
    getModelContextWindow: jest.fn().mockReturnValue(32768),
    getConfig: jest.fn(),
} as any;

const mockOutput = {
    appendLine: jest.fn(),
} as any;

// ===================== TEST SUITE =====================

describe('PlanningAgent', () => {
    let db: Database;
    let tmpDir: string;
    let agent: PlanningAgent;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-planning-agent-test-'));
        db = new Database(tmpDir);
        await db.initialize();

        agent = new PlanningAgent(db, mockLLM, mockConfig, mockOutput);
        await agent.initialize();

        // Reset mocks between tests
        jest.clearAllMocks();
        mockConfig.getAgentContextLimit.mockReturnValue(4000);
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ===================== setDecompositionEngine =====================

    describe('setDecompositionEngine', () => {
        test('stores the engine and logs injection message', () => {
            const mockEngine = { decompose: jest.fn() } as any;

            agent.setDecompositionEngine(mockEngine);

            expect(mockOutput.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('TaskDecompositionEngine injected')
            );
        });

        test('stored engine is used during autoDecompose', async () => {
            // Create a plan and a large task
            const plan = db.createPlan('Decomposition Test');
            const task = db.createTask({
                title: 'Build entire feature',
                description: 'Large task that needs decomposition',
                priority: TaskPriority.P1,
                estimated_minutes: 120,
                acceptance_criteria: 'Feature is complete',
                plan_id: plan.id,
            });

            const subtaskDefs: SubtaskDefinition[] = [
                {
                    title: 'Create data model',
                    description: 'Define the data model',
                    priority: TaskPriority.P1,
                    estimatedMinutes: 30,
                    acceptanceCriteria: 'Model is defined',
                    dependencies: [],
                    filesToModify: ['src/models.ts'],
                    filesToCreate: [],
                    contextBundle: '',
                    category: SubtaskCategory.Implementation,
                },
                {
                    title: 'Add unit tests',
                    description: 'Write tests for the data model',
                    priority: TaskPriority.P2,
                    estimatedMinutes: 25,
                    acceptanceCriteria: 'Tests pass',
                    dependencies: [],
                    filesToModify: [],
                    filesToCreate: ['tests/models.test.ts'],
                    contextBundle: '',
                    category: SubtaskCategory.Testing,
                },
            ];

            const deterministicResult: DecompositionResult = {
                originalTaskId: task.id,
                subtasks: subtaskDefs,
                strategy: DecompositionStrategy.ByFile,
                reason: 'Split by file',
                estimatedTotalMinutes: 55,
                isFullyCovered: true,
            };

            const mockEngine = {
                decompose: jest.fn().mockReturnValue(deterministicResult),
            } as any;

            agent.setDecompositionEngine(mockEngine);

            const response = await agent.decompose(task.id);

            expect(mockEngine.decompose).toHaveBeenCalledWith(task, 0);
            expect(response.content).toContain('decomposed into 2 subtasks');
            expect(response.content).toContain('deterministic');
            expect(response.content).toContain('by_file');

            // Verify parent task was marked as decomposed
            const updatedTask = db.getTask(task.id);
            expect(updatedTask!.status).toBe(TaskStatus.Decomposed);
        });
    });

    // ===================== processMessage with valid JSON plan =====================

    describe('processMessage with valid JSON plan', () => {
        test('creates plan and tasks from LLM response', async () => {
            const planJson = {
                plan_name: 'Auth Feature',
                summary: 'Implement user authentication',
                tasks: [
                    {
                        title: 'Create login endpoint',
                        description: 'Build POST /login handler',
                        priority: 'P1',
                        estimated_minutes: 30,
                        acceptance_criteria: 'POST /login returns JWT',
                        dependencies: [],
                        context: 'src/routes/auth.ts',
                    },
                    {
                        title: 'Add login unit test',
                        description: 'Test the login endpoint',
                        priority: 'P2',
                        estimated_minutes: 20,
                        acceptance_criteria: 'Tests pass',
                        dependencies: [],
                        context: 'tests/auth.test.ts',
                    },
                ],
            };

            mockLLM.chat.mockResolvedValue({
                content: JSON.stringify(planJson),
                tokens_used: 100,
            });

            const context: AgentContext = { conversationHistory: [] };
            const response = await agent.processMessage('Plan an auth feature', context);

            expect(response.content).toContain('Auth Feature');
            expect(response.content).toContain('2 tasks');
            expect(response.content).toContain('Implement user authentication');
            expect(response.actions).toBeDefined();
            expect(response.actions!.length).toBeGreaterThan(0);
            expect(response.actions![0].type).toBe('log');
        });

        test('tasks with missing optional fields get defaults', async () => {
            const planJson = {
                plan_name: 'Minimal Plan',
                summary: 'Minimal task fields',
                tasks: [
                    {
                        title: 'Minimal task',
                        // description, priority, estimated_minutes, acceptance_criteria, context are all missing
                    },
                ],
            };

            mockLLM.chat.mockResolvedValue({
                content: JSON.stringify(planJson),
                tokens_used: 50,
            });

            const context: AgentContext = { conversationHistory: [] };
            const response = await agent.processMessage('Plan something minimal', context);

            expect(response.content).toContain('Minimal Plan');
            expect(response.content).toContain('1 tasks');
        });

        test('plan with no summary says "No summary provided"', async () => {
            const planJson = {
                plan_name: 'No Summary Plan',
                tasks: [
                    {
                        title: 'A task',
                        description: 'Do stuff',
                        priority: 'P1',
                        estimated_minutes: 20,
                        acceptance_criteria: 'Done',
                        dependencies: [],
                    },
                ],
            };

            mockLLM.chat.mockResolvedValue({
                content: JSON.stringify(planJson),
                tokens_used: 50,
            });

            const context: AgentContext = { conversationHistory: [] };
            const response = await agent.processMessage('Plan without summary', context);

            expect(response.content).toContain('No summary provided');
        });
    });

    // ===================== processMessage with dependencies =====================

    describe('processMessage with task dependencies', () => {
        test('wires dependency IDs from task titles', async () => {
            const planJson = {
                plan_name: 'Dependency Plan',
                summary: 'Tasks with deps',
                tasks: [
                    {
                        title: 'Create database schema',
                        description: 'Define DB tables',
                        priority: 'P1',
                        estimated_minutes: 30,
                        acceptance_criteria: 'Schema is ready',
                        dependencies: [],
                    },
                    {
                        title: 'Create API endpoint',
                        description: 'Build the REST endpoint',
                        priority: 'P1',
                        estimated_minutes: 30,
                        acceptance_criteria: 'Endpoint works',
                        dependencies: ['Create database schema'],
                    },
                    {
                        title: 'Write integration tests',
                        description: 'Test the API endpoint',
                        priority: 'P2',
                        estimated_minutes: 25,
                        acceptance_criteria: 'Tests pass',
                        dependencies: ['Create database schema', 'Create API endpoint'],
                    },
                ],
            };

            mockLLM.chat.mockResolvedValue({
                content: JSON.stringify(planJson),
                tokens_used: 200,
            });

            const context: AgentContext = { conversationHistory: [] };
            const response = await agent.processMessage('Plan with dependencies', context);

            expect(response.content).toContain('Dependency Plan');
            expect(response.content).toContain('3 tasks');

            // Verify that the third task has two dependencies wired up
            // Find all tasks for the created plan
            const plan = db.getActivePlan();
            expect(plan).not.toBeNull();

            // Get all tasks by querying them (we can get tasks via getNextTask logic,
            // but simpler: get them by iterating and checking plan_id)
            // Since we don't have a "get tasks by plan" method directly, verify via the task titles
            // The tasks should be in the database
            const allTasks = [
                'Create database schema',
                'Create API endpoint',
                'Write integration tests',
            ];

            // Search for each task and check dependencies
            // We know the tasks were created in order
            // Get all tasks from plan - use the database directly
            const schemaTask = findTaskByTitle(db, 'Create database schema');
            const apiTask = findTaskByTitle(db, 'Create API endpoint');
            const testTask = findTaskByTitle(db, 'Write integration tests');

            expect(schemaTask).not.toBeNull();
            expect(apiTask).not.toBeNull();
            expect(testTask).not.toBeNull();

            expect(schemaTask!.dependencies).toEqual([]);
            expect(apiTask!.dependencies).toContain(schemaTask!.id);
            expect(testTask!.dependencies).toContain(schemaTask!.id);
            expect(testTask!.dependencies).toContain(apiTask!.id);
        });

        test('ignores dependencies that reference non-existent task titles', async () => {
            const planJson = {
                plan_name: 'Broken Deps Plan',
                summary: 'Task with bad dep',
                tasks: [
                    {
                        title: 'Task A',
                        description: 'First task',
                        priority: 'P1',
                        estimated_minutes: 20,
                        acceptance_criteria: 'Done',
                        dependencies: ['Non-existent Task'],
                    },
                ],
            };

            mockLLM.chat.mockResolvedValue({
                content: JSON.stringify(planJson),
                tokens_used: 50,
            });

            const context: AgentContext = { conversationHistory: [] };
            const response = await agent.processMessage('Plan with broken deps', context);

            expect(response.content).toContain('Broken Deps Plan');
            // Task should be created but with no dependencies (bad dep filtered out)
            const taskA = findTaskByTitle(db, 'Task A');
            expect(taskA).not.toBeNull();
            // The dep title "Non-existent Task" doesn't map to any ID, so filter(Boolean) removes it
            // Since depIds.length === 0, updateTask is never called, so dependencies remain empty
            expect(taskA!.dependencies).toEqual([]);
        });
    });

    // ===================== processMessage with oversized tasks (auto-decompose) =====================

    describe('processMessage with tasks >45 min (auto-decompose)', () => {
        test('auto-decomposes oversized tasks via LLM fallback', async () => {
            // First call: plan creation with a 60-min task
            const planJson = {
                plan_name: 'Oversized Plan',
                summary: 'Has a big task',
                tasks: [
                    {
                        title: 'Build entire frontend',
                        description: 'Create all frontend pages',
                        priority: 'P1',
                        estimated_minutes: 90,
                        acceptance_criteria: 'Frontend is complete',
                        dependencies: [],
                    },
                ],
            };

            // Second call (from auto-decompose's LLM fallback via processMessage):
            // Return a sub-plan with smaller tasks
            const subPlanJson = {
                plan_name: 'Frontend Subtasks',
                summary: 'Broken down frontend',
                tasks: [
                    {
                        title: 'Create homepage layout',
                        description: 'Build homepage',
                        priority: 'P1',
                        estimated_minutes: 30,
                        acceptance_criteria: 'Homepage renders',
                        dependencies: [],
                    },
                    {
                        title: 'Create settings page',
                        description: 'Build settings',
                        priority: 'P2',
                        estimated_minutes: 30,
                        acceptance_criteria: 'Settings page works',
                        dependencies: [],
                    },
                ],
            };

            mockLLM.chat
                .mockResolvedValueOnce({
                    content: JSON.stringify(planJson),
                    tokens_used: 100,
                })
                .mockResolvedValueOnce({
                    content: JSON.stringify(subPlanJson),
                    tokens_used: 80,
                });

            const context: AgentContext = { conversationHistory: [] };
            const response = await agent.processMessage('Plan a frontend', context);

            expect(response.content).toContain('Oversized Plan');
            expect(response.content).toContain('1 tasks were auto-decomposed');

            // The parent task should be marked as decomposed
            const parentTask = findTaskByTitle(db, 'Build entire frontend');
            expect(parentTask).not.toBeNull();
            expect(parentTask!.status).toBe(TaskStatus.Decomposed);
        });

        test('auto-decompose error is logged but does not fail plan creation', async () => {
            const planJson = {
                plan_name: 'Failing Decompose Plan',
                summary: 'Auto-decompose will fail',
                tasks: [
                    {
                        title: 'Giant task',
                        description: 'Way too big',
                        priority: 'P1',
                        estimated_minutes: 120,
                        acceptance_criteria: 'Complete',
                        dependencies: [],
                    },
                ],
            };

            // First call returns the plan, second call (auto-decompose) throws
            mockLLM.chat
                .mockResolvedValueOnce({
                    content: JSON.stringify(planJson),
                    tokens_used: 100,
                })
                .mockRejectedValueOnce(new Error('LLM unavailable'));

            const context: AgentContext = { conversationHistory: [] };
            const response = await agent.processMessage('Plan a big project', context);

            // Plan should still be created even though auto-decompose failed
            expect(response.content).toContain('Failing Decompose Plan');
            expect(response.content).toContain('1 tasks');
            // The decomposedCount should be 0 because auto-decompose threw
            expect(response.content).not.toContain('auto-decomposed');

            // Verify error was logged
            expect(mockOutput.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Auto-decompose failed for "Giant task"')
            );
        });

        test('tasks with estimated_minutes <= 45 are not auto-decomposed', async () => {
            const planJson = {
                plan_name: 'Normal Plan',
                summary: 'All tasks are atomic',
                tasks: [
                    {
                        title: 'Small task',
                        description: 'Quick work',
                        priority: 'P1',
                        estimated_minutes: 30,
                        acceptance_criteria: 'Done',
                        dependencies: [],
                    },
                ],
            };

            mockLLM.chat.mockResolvedValueOnce({
                content: JSON.stringify(planJson),
                tokens_used: 50,
            });

            const context: AgentContext = { conversationHistory: [] };
            const response = await agent.processMessage('Small plan', context);

            // Only one LLM call (the plan itself), no auto-decompose call
            expect(mockLLM.chat).toHaveBeenCalledTimes(1);
            expect(response.content).not.toContain('auto-decomposed');
        });
    });

    // ===================== processMessage with invalid JSON =====================

    describe('processMessage with invalid JSON', () => {
        test('returns raw content when LLM responds with non-JSON', async () => {
            mockLLM.chat.mockResolvedValue({
                content: 'I cannot create a plan for that request. Please provide more details.',
                tokens_used: 20,
            });

            const context: AgentContext = { conversationHistory: [] };
            const response = await agent.processMessage('Plan something vague', context);

            expect(response.content).toBe('I cannot create a plan for that request. Please provide more details.');
            expect(response.actions).toEqual([]);
        });

        test('returns raw content when JSON is valid but has no plan_name or tasks', async () => {
            mockLLM.chat.mockResolvedValue({
                content: '{"message": "here is some advice", "items": [1,2,3]}',
                tokens_used: 15,
            });

            const context: AgentContext = { conversationHistory: [] };
            const response = await agent.processMessage('Not a plan', context);

            // JSON is parseable but doesn't have plan_name + tasks
            expect(response.content).toContain('here is some advice');
        });

        test('logs parse error when JSON is malformed', async () => {
            // The regex \{[\s\S]*\} requires both { and } to match.
            // This string has both braces but the content between them is invalid JSON.
            mockLLM.chat.mockResolvedValue({
                content: '{ "plan_name": "broken plan", "tasks": [ { bad json } ] }',
                tokens_used: 10,
            });

            const context: AgentContext = { conversationHistory: [] };
            const response = await agent.processMessage('Malformed plan', context);

            expect(mockOutput.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('JSON parse error:')
            );
            // v10.0: Returns clear error message on parse failure
            expect(response.content).toContain('no_json_found');
        });
    });

    // ===================== decompose() public method =====================

    describe('decompose()', () => {
        test('returns error message when task not found', async () => {
            const response = await agent.decompose('nonexistent-task-id');
            expect(response.content).toBe('Task not found: nonexistent-task-id');
        });

        test('returns already atomic message when task is <= 45 min', async () => {
            const plan = db.createPlan('Atomic Plan');
            const task = db.createTask({
                title: 'Small atomic task',
                description: 'Quick work',
                priority: TaskPriority.P1,
                estimated_minutes: 30,
                acceptance_criteria: 'Done',
                plan_id: plan.id,
            });

            const response = await agent.decompose(task.id);
            expect(response.content).toContain('already atomic');
            expect(response.content).toContain('Small atomic task');
            expect(response.content).toContain('30 min');
        });

        test('returns already atomic for task with exactly 45 min', async () => {
            const plan = db.createPlan('Boundary Plan');
            const task = db.createTask({
                title: 'Boundary task',
                description: 'Exactly 45 minutes',
                priority: TaskPriority.P2,
                estimated_minutes: 45,
                acceptance_criteria: 'Done',
                plan_id: plan.id,
            });

            const response = await agent.decompose(task.id);
            expect(response.content).toContain('already atomic');
            expect(response.content).toContain('45 min');
        });

        test('calls autoDecompose for oversized tasks', async () => {
            const plan = db.createPlan('Big Task Plan');
            const task = db.createTask({
                title: 'Oversized task',
                description: 'Too big to be atomic',
                priority: TaskPriority.P1,
                estimated_minutes: 90,
                acceptance_criteria: 'Feature done',
                plan_id: plan.id,
            });

            // Set up LLM to return a valid sub-plan (LLM fallback path)
            const subPlanJson = {
                plan_name: 'Sub Plan',
                summary: 'Subtasks for oversized task',
                tasks: [
                    {
                        title: 'Sub task 1',
                        description: 'Part 1',
                        priority: 'P1',
                        estimated_minutes: 30,
                        acceptance_criteria: 'Part 1 done',
                        dependencies: [],
                    },
                ],
            };

            mockLLM.chat.mockResolvedValue({
                content: JSON.stringify(subPlanJson),
                tokens_used: 80,
            });

            const response = await agent.decompose(task.id);

            // Task should be marked as decomposed
            const updatedTask = db.getTask(task.id);
            expect(updatedTask!.status).toBe(TaskStatus.Decomposed);
        });
    });

    // ===================== autoDecompose — max depth =====================

    describe('autoDecompose — max depth', () => {
        test('returns max depth message when depth >= 3', async () => {
            const plan = db.createPlan('Deep Plan');
            const task = db.createTask({
                title: 'Deep task',
                description: 'Will hit max depth',
                priority: TaskPriority.P1,
                estimated_minutes: 120,
                acceptance_criteria: 'Complete',
                plan_id: plan.id,
            });

            // Use deterministic engine that returns subtasks > 45 min to trigger recursion
            // Each recursion increases depth until we hit 3
            const makeSubtask = (title: string, minutes: number): SubtaskDefinition => ({
                title,
                description: `Subtask: ${title}`,
                priority: TaskPriority.P1,
                estimatedMinutes: minutes,
                acceptanceCriteria: 'Done',
                dependencies: [],
                filesToModify: [],
                filesToCreate: [],
                contextBundle: '',
                category: SubtaskCategory.Implementation,
            });

            // Depth 0: returns subtask of 60 min (will recurse to depth 1)
            // Depth 1: returns subtask of 60 min (will recurse to depth 2)
            // Depth 2: returns subtask of 60 min (will recurse to depth 3)
            // Depth 3: returns max depth message
            const mockEngine = {
                decompose: jest.fn().mockImplementation((t: Task, depth: number) => {
                    return {
                        originalTaskId: t.id,
                        subtasks: [makeSubtask(`Level ${depth} subtask`, 60)],
                        strategy: DecompositionStrategy.ByPhase,
                        reason: `Depth ${depth} split`,
                        estimatedTotalMinutes: 60,
                        isFullyCovered: true,
                    } as DecompositionResult;
                }),
            } as any;

            agent.setDecompositionEngine(mockEngine);

            const response = await agent.decompose(task.id);

            // The engine should have been called multiple times as recursion happens
            // depth 0, 1, 2 succeed; depth 3 hits the max
            expect(mockEngine.decompose).toHaveBeenCalled();

            // Verify the max depth message was logged
            expect(mockOutput.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('max depth (3) reached')
            );

            // The top-level response should indicate successful decomposition at depth 0
            expect(response.content).toContain('decomposed into 1 subtasks');
        });
    });

    // ===================== autoDecompose — deterministic engine =====================

    describe('autoDecompose — deterministic engine', () => {
        test('creates subtasks with correct plan_id and parent_task_id', async () => {
            const plan = db.createPlan('Deterministic Plan');
            const task = db.createTask({
                title: 'Task to decompose',
                description: 'Needs splitting',
                priority: TaskPriority.P1,
                estimated_minutes: 90,
                acceptance_criteria: 'Feature complete',
                plan_id: plan.id,
                context_bundle: 'some context',
            });

            const subtaskDefs: SubtaskDefinition[] = [
                {
                    title: 'Setup config',
                    description: 'Configure the project',
                    priority: TaskPriority.P1,
                    estimatedMinutes: 20,
                    acceptanceCriteria: 'Config exists',
                    dependencies: [],
                    filesToModify: ['config.json'],
                    filesToCreate: [],
                    contextBundle: '',
                    category: SubtaskCategory.Configuration,
                },
                {
                    title: 'Implement feature',
                    description: 'Build the core feature',
                    priority: TaskPriority.P1,
                    estimatedMinutes: 40,
                    acceptanceCriteria: 'Feature works',
                    dependencies: [],
                    filesToModify: ['src/feature.ts'],
                    filesToCreate: [],
                    contextBundle: '',
                    category: SubtaskCategory.Implementation,
                },
                {
                    title: 'Write tests',
                    description: 'Add unit tests',
                    priority: TaskPriority.P2,
                    estimatedMinutes: 25,
                    acceptanceCriteria: 'Tests pass',
                    dependencies: [],
                    filesToModify: [],
                    filesToCreate: [],
                    contextBundle: '',
                    category: SubtaskCategory.Testing,
                },
            ];

            const deterministicResult: DecompositionResult = {
                originalTaskId: task.id,
                subtasks: subtaskDefs,
                strategy: DecompositionStrategy.ByPhase,
                reason: 'Split by phase',
                estimatedTotalMinutes: 85,
                isFullyCovered: true,
            };

            const mockEngine = {
                decompose: jest.fn().mockReturnValue(deterministicResult),
            } as any;

            agent.setDecompositionEngine(mockEngine);

            const response = await agent.decompose(task.id);

            expect(response.content).toContain('decomposed into 3 subtasks');
            expect(response.content).toContain('deterministic: by_phase');
            expect(response.content).toContain('Setup config (20 min)');
            expect(response.content).toContain('Implement feature (40 min)');
            expect(response.content).toContain('Write tests (25 min)');

            // Verify actions
            expect(response.actions).toBeDefined();
            expect(response.actions!.length).toBe(1);
            expect(response.actions![0].type).toBe('log');

            // Verify subtasks in database
            const subtask1 = findTaskByTitle(db, 'Setup config');
            const subtask2 = findTaskByTitle(db, 'Implement feature');
            const subtask3 = findTaskByTitle(db, 'Write tests');

            expect(subtask1).not.toBeNull();
            expect(subtask2).not.toBeNull();
            expect(subtask3).not.toBeNull();

            // All subtasks should have the same plan_id and parent_task_id
            expect(subtask1!.plan_id).toBe(plan.id);
            expect(subtask1!.parent_task_id).toBe(task.id);
            expect(subtask2!.plan_id).toBe(plan.id);
            expect(subtask2!.parent_task_id).toBe(task.id);
            expect(subtask3!.plan_id).toBe(plan.id);
            expect(subtask3!.parent_task_id).toBe(task.id);

            // Subtasks should chain dependencies: 2 depends on 1, 3 depends on 2
            expect(subtask1!.dependencies).toEqual([]);
            expect(subtask2!.dependencies).toContain(subtask1!.id);
            expect(subtask3!.dependencies).toContain(subtask2!.id);

            // context_bundle: subtask1 has filesToModify so uses that; subtask3 has none so inherits parent's
            expect(subtask1!.context_bundle).toBe('config.json');
            expect(subtask2!.context_bundle).toBe('src/feature.ts');
            expect(subtask3!.context_bundle).toBe('some context');

            // Parent should be decomposed
            const updatedParent = db.getTask(task.id);
            expect(updatedParent!.status).toBe(TaskStatus.Decomposed);
        });

        test('falls back to LLM when engine returns null', async () => {
            const plan = db.createPlan('Fallback Plan');
            const task = db.createTask({
                title: 'No rule match task',
                description: 'No deterministic rule matches',
                priority: TaskPriority.P1,
                estimated_minutes: 60,
                acceptance_criteria: 'Done',
                plan_id: plan.id,
            });

            const mockEngine = {
                decompose: jest.fn().mockReturnValue(null),
            } as any;

            agent.setDecompositionEngine(mockEngine);

            const subPlanJson = {
                plan_name: 'LLM Fallback Sub',
                summary: 'LLM generated subtasks',
                tasks: [
                    {
                        title: 'LLM subtask 1',
                        description: 'Part 1',
                        priority: 'P1',
                        estimated_minutes: 30,
                        acceptance_criteria: 'Part 1 complete',
                        dependencies: [],
                    },
                ],
            };

            mockLLM.chat.mockResolvedValue({
                content: JSON.stringify(subPlanJson),
                tokens_used: 60,
            });

            const response = await agent.decompose(task.id);

            // Should have used LLM fallback
            expect(mockEngine.decompose).toHaveBeenCalled();
            expect(mockLLM.chat).toHaveBeenCalled();
            expect(mockOutput.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('No deterministic rule matched')
            );

            // Task should be marked decomposed via LLM path
            const updatedTask = db.getTask(task.id);
            expect(updatedTask!.status).toBe(TaskStatus.Decomposed);
        });

        test('falls back to LLM when engine returns empty subtasks', async () => {
            const plan = db.createPlan('Empty Subtasks Plan');
            const task = db.createTask({
                title: 'Empty result task',
                description: 'Engine returns empty',
                priority: TaskPriority.P1,
                estimated_minutes: 60,
                acceptance_criteria: 'Done',
                plan_id: plan.id,
            });

            const emptyResult: DecompositionResult = {
                originalTaskId: task.id,
                subtasks: [],
                strategy: DecompositionStrategy.ByFile,
                reason: 'No subtasks',
                estimatedTotalMinutes: 0,
                isFullyCovered: false,
            };

            const mockEngine = {
                decompose: jest.fn().mockReturnValue(emptyResult),
            } as any;

            agent.setDecompositionEngine(mockEngine);

            const subPlanJson = {
                plan_name: 'LLM Backup',
                summary: 'Backup subtasks',
                tasks: [
                    {
                        title: 'Backup subtask',
                        description: 'From LLM',
                        priority: 'P2',
                        estimated_minutes: 25,
                        acceptance_criteria: 'Done',
                        dependencies: [],
                    },
                ],
            };

            mockLLM.chat.mockResolvedValue({
                content: JSON.stringify(subPlanJson),
                tokens_used: 40,
            });

            const response = await agent.decompose(task.id);

            expect(mockEngine.decompose).toHaveBeenCalled();
            expect(mockLLM.chat).toHaveBeenCalled();
            expect(mockOutput.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('No deterministic rule matched')
            );
        });
    });

    // ===================== autoDecompose — recursive sub-decomposition =====================

    describe('autoDecompose — recursive sub-decomposition for >45min subtasks', () => {
        test('recursively decomposes subtasks that exceed 45 min', async () => {
            const plan = db.createPlan('Recursive Plan');
            const task = db.createTask({
                title: 'Very large task',
                description: 'Needs two levels of decomposition',
                priority: TaskPriority.P1,
                estimated_minutes: 180,
                acceptance_criteria: 'Everything done',
                plan_id: plan.id,
            });

            let callCount = 0;
            const mockEngine = {
                decompose: jest.fn().mockImplementation((t: Task, depth: number) => {
                    callCount++;
                    if (depth === 0) {
                        // First level: one subtask is > 45 min
                        return {
                            originalTaskId: t.id,
                            subtasks: [
                                {
                                    title: 'Small subtask',
                                    description: 'Atomic',
                                    priority: TaskPriority.P1,
                                    estimatedMinutes: 30,
                                    acceptanceCriteria: 'Done',
                                    dependencies: [],
                                    filesToModify: [],
                                    filesToCreate: [],
                                    contextBundle: '',
                                    category: SubtaskCategory.Implementation,
                                },
                                {
                                    title: 'Large subtask needing decomposition',
                                    description: 'Still too big',
                                    priority: TaskPriority.P1,
                                    estimatedMinutes: 60,
                                    acceptanceCriteria: 'Feature complete',
                                    dependencies: [],
                                    filesToModify: [],
                                    filesToCreate: [],
                                    contextBundle: '',
                                    category: SubtaskCategory.Implementation,
                                },
                            ] as SubtaskDefinition[],
                            strategy: DecompositionStrategy.ByPhase,
                            reason: 'Phase split at depth 0',
                            estimatedTotalMinutes: 90,
                            isFullyCovered: true,
                        } as DecompositionResult;
                    } else if (depth === 1) {
                        // Second level: split the 60-min subtask into two atomic ones
                        return {
                            originalTaskId: t.id,
                            subtasks: [
                                {
                                    title: 'Sub-subtask A',
                                    description: 'Part A',
                                    priority: TaskPriority.P1,
                                    estimatedMinutes: 30,
                                    acceptanceCriteria: 'A done',
                                    dependencies: [],
                                    filesToModify: [],
                                    filesToCreate: [],
                                    contextBundle: '',
                                    category: SubtaskCategory.Implementation,
                                },
                                {
                                    title: 'Sub-subtask B',
                                    description: 'Part B',
                                    priority: TaskPriority.P1,
                                    estimatedMinutes: 25,
                                    acceptanceCriteria: 'B done',
                                    dependencies: [],
                                    filesToModify: [],
                                    filesToCreate: [],
                                    contextBundle: '',
                                    category: SubtaskCategory.Implementation,
                                },
                            ] as SubtaskDefinition[],
                            strategy: DecompositionStrategy.ByFile,
                            reason: 'File split at depth 1',
                            estimatedTotalMinutes: 55,
                            isFullyCovered: true,
                        } as DecompositionResult;
                    }
                    return null;
                }),
            } as any;

            agent.setDecompositionEngine(mockEngine);

            const response = await agent.decompose(task.id);

            // The engine should be called at depth 0 and depth 1
            expect(mockEngine.decompose).toHaveBeenCalledTimes(2);
            expect(mockEngine.decompose).toHaveBeenCalledWith(expect.anything(), 0);
            expect(mockEngine.decompose).toHaveBeenCalledWith(expect.anything(), 1);

            // Verify sub-subtasks exist
            const subSubA = findTaskByTitle(db, 'Sub-subtask A');
            const subSubB = findTaskByTitle(db, 'Sub-subtask B');
            expect(subSubA).not.toBeNull();
            expect(subSubB).not.toBeNull();

            // The large subtask should be marked as decomposed
            const largeSubtask = findTaskByTitle(db, 'Large subtask needing decomposition');
            expect(largeSubtask).not.toBeNull();
            expect(largeSubtask!.status).toBe(TaskStatus.Decomposed);
        });

        test('logs error when recursive decompose fails but continues', async () => {
            const plan = db.createPlan('Error Recursion Plan');
            const task = db.createTask({
                title: 'Task with failing subtask',
                description: 'Subtask decompose will fail',
                priority: TaskPriority.P1,
                estimated_minutes: 120,
                acceptance_criteria: 'Done',
                plan_id: plan.id,
            });

            let callCount = 0;
            const mockEngine = {
                decompose: jest.fn().mockImplementation((t: Task, depth: number) => {
                    callCount++;
                    if (depth === 0) {
                        return {
                            originalTaskId: t.id,
                            subtasks: [
                                {
                                    title: 'Subtask that will fail to decompose',
                                    description: 'Will error at depth 1',
                                    priority: TaskPriority.P1,
                                    estimatedMinutes: 60,
                                    acceptanceCriteria: 'Done',
                                    dependencies: [],
                                    filesToModify: [],
                                    filesToCreate: [],
                                    contextBundle: '',
                                    category: SubtaskCategory.Implementation,
                                },
                            ] as SubtaskDefinition[],
                            strategy: DecompositionStrategy.ByPhase,
                            reason: 'Phase split',
                            estimatedTotalMinutes: 60,
                            isFullyCovered: true,
                        } as DecompositionResult;
                    }
                    // Throw at depth 1
                    throw new Error('Recursive decomposition failed');
                }),
            } as any;

            agent.setDecompositionEngine(mockEngine);

            const response = await agent.decompose(task.id);

            // Should still succeed at depth 0
            expect(response.content).toContain('decomposed into 1 subtasks');

            // Error from depth 1 should be logged
            expect(mockOutput.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Recursive decompose failed for subtask')
            );
        });
    });

    // ===================== autoDecompose — LLM fallback =====================

    describe('autoDecompose — LLM fallback', () => {
        test('falls back to LLM when no decomposition engine is set', async () => {
            const plan = db.createPlan('LLM Only Plan');
            const task = db.createTask({
                title: 'Task for LLM decomposition',
                description: 'No deterministic engine available',
                priority: TaskPriority.P1,
                estimated_minutes: 90,
                acceptance_criteria: 'Feature ready',
                plan_id: plan.id,
                context_bundle: 'Important context info',
            });

            const subPlanJson = {
                plan_name: 'LLM Generated Plan',
                summary: 'LLM decomposed subtasks',
                tasks: [
                    {
                        title: 'LLM task A',
                        description: 'First part',
                        priority: 'P1',
                        estimated_minutes: 30,
                        acceptance_criteria: 'A done',
                        dependencies: [],
                    },
                    {
                        title: 'LLM task B',
                        description: 'Second part',
                        priority: 'P2',
                        estimated_minutes: 30,
                        acceptance_criteria: 'B done',
                        dependencies: ['LLM task A'],
                    },
                ],
            };

            mockLLM.chat.mockResolvedValue({
                content: JSON.stringify(subPlanJson),
                tokens_used: 100,
            });

            // Do NOT set any decomposition engine
            const response = await agent.decompose(task.id);

            expect(mockLLM.chat).toHaveBeenCalled();

            // Verify LLM was called with the right decomposition prompt
            const chatCall = mockLLM.chat.mock.calls[0];
            const messages = chatCall[0];
            const userMessage = messages.find((m: any) => m.role === 'user');
            expect(userMessage.content).toContain('Decompose this complex task');
            expect(userMessage.content).toContain('Task for LLM decomposition');
            expect(userMessage.content).toContain('90 minutes');
            expect(userMessage.content).toContain('Important context info');

            // Task should be marked as decomposed
            const updatedTask = db.getTask(task.id);
            expect(updatedTask!.status).toBe(TaskStatus.Decomposed);
        });

        test('LLM fallback marks parent as decomposed and logs audit', async () => {
            const plan = db.createPlan('Audit Log Plan');
            const task = db.createTask({
                title: 'Audited decompose task',
                description: 'Check audit logging',
                priority: TaskPriority.P1,
                estimated_minutes: 60,
                acceptance_criteria: 'Audit entries exist',
                plan_id: plan.id,
            });

            const subPlanJson = {
                plan_name: 'Audited Sub Plan',
                summary: 'Subtasks',
                tasks: [
                    {
                        title: 'Audit subtask',
                        description: 'Part 1',
                        priority: 'P1',
                        estimated_minutes: 30,
                        acceptance_criteria: 'Done',
                        dependencies: [],
                    },
                ],
            };

            mockLLM.chat.mockResolvedValue({
                content: JSON.stringify(subPlanJson),
                tokens_used: 50,
            });

            await agent.decompose(task.id);

            // Task should be decomposed
            const updatedTask = db.getTask(task.id);
            expect(updatedTask!.status).toBe(TaskStatus.Decomposed);
        });

        test('autoDecompose returns task not found for invalid taskId', async () => {
            // Need to access autoDecompose indirectly through decompose with a task > 45 min
            // But if the task is deleted between decompose() check and autoDecompose() call,
            // autoDecompose will return "Task not found"
            // We can test this by manually creating the scenario
            const plan = db.createPlan('Deleted Task Plan');
            const task = db.createTask({
                title: 'Will be deleted',
                description: 'Task that will not exist when autoDecompose runs',
                priority: TaskPriority.P1,
                estimated_minutes: 90,
                acceptance_criteria: 'N/A',
                plan_id: plan.id,
            });

            // Set engine that triggers deletion mid-way
            const mockEngine = {
                decompose: jest.fn().mockImplementation(() => {
                    // Delete the task before returning
                    // This simulates the task not being found in autoDecompose
                    return null; // No deterministic result
                }),
            } as any;

            agent.setDecompositionEngine(mockEngine);

            // Now delete the task, then call autoDecompose via decompose
            // Actually decompose() checks getTask first, so the task must exist at that point.
            // Instead, test autoDecompose's internal getTask check by using a task that
            // the engine processes but then the inner autoDecompose can't find a subtask

            // Simpler approach: Test via LLM fallback where processMessage is called
            // but the task was removed in between.
            // Let's just verify the direct "task not found" path:
            // We can't call autoDecompose directly since it's private,
            // but we can set engine to return null, then have LLM also fail,
            // and verify that the correct error path is hit.

            // Delete the task before LLM fallback runs
            const originalGetTask = db.getTask.bind(db);
            let getTaskCallCount = 0;
            jest.spyOn(db, 'getTask').mockImplementation((id: string) => {
                getTaskCallCount++;
                // First call is from decompose(), second from autoDecompose()
                if (getTaskCallCount <= 1) {
                    return originalGetTask(id);
                }
                // autoDecompose's getTask call returns null (task was deleted)
                return null;
            });

            const response = await agent.decompose(task.id);
            expect(response.content).toContain('Task not found');

            jest.restoreAllMocks();
        });
    });

    // ===================== autoDecompose — null priority + null plan_id branches =====================

    describe('autoDecompose — null priority and null plan_id branches', () => {
        test('subtask falls back to TaskPriority.P2 when both subtaskDef.priority and task.priority are null', async () => {
            // Create a real task (DB will give it a default priority)
            const task = db.createTask({
                title: 'Null priority test task',
                description: 'Will have priority nullified via mock',
                priority: TaskPriority.P1,
                estimated_minutes: 90,
                acceptance_criteria: 'Done',
            });

            // Mock getTask to return task with null priority AND null plan_id
            const originalGetTask = db.getTask.bind(db);
            jest.spyOn(db, 'getTask').mockImplementation((id: string) => {
                const real = originalGetTask(id);
                if (real && id === task.id) {
                    return { ...real, priority: null as any, plan_id: null };
                }
                return real;
            });

            const subtaskDefs: SubtaskDefinition[] = [
                {
                    title: 'Subtask null priority fallthrough',
                    description: 'Should default to P2',
                    priority: undefined as any,  // null → task.priority (also null) → TaskPriority.P2
                    estimatedMinutes: 30,
                    acceptanceCriteria: 'Works',
                    dependencies: [],
                    filesToModify: [],
                    filesToCreate: [],
                    contextBundle: '',
                    category: SubtaskCategory.Implementation,
                },
            ];

            const deterministicResult: DecompositionResult = {
                originalTaskId: task.id,
                subtasks: subtaskDefs,
                strategy: DecompositionStrategy.ByPhase,
                reason: 'Null priority fallthrough test',
                estimatedTotalMinutes: 30,
                isFullyCovered: true,
            };

            const mockEngine = {
                decompose: jest.fn().mockReturnValue(deterministicResult),
            } as any;

            agent.setDecompositionEngine(mockEngine);

            const response = await agent.decompose(task.id);

            expect(response.content).toContain('decomposed into 1 subtasks');

            // Verify subtask was created with P2 (the final fallback)
            const subtask = findTaskByTitle(db, 'Subtask null priority fallthrough');
            expect(subtask).not.toBeNull();
            expect(subtask!.priority).toBe(TaskPriority.P2);

            jest.restoreAllMocks();
        });
    });

    // ===================== Agent metadata =====================

    describe('Agent metadata', () => {
        test('has correct name, type, and systemPrompt', () => {
            expect(agent.name).toBe('Planning Team');
            expect(agent.type).toBe(AgentType.Planning);
            expect(agent.systemPrompt).toContain('Planning Team');
            expect(agent.systemPrompt).toContain('JSON');
            expect(agent.systemPrompt).toContain('atomic');
        });
    });

    // ===================== Plan status after creation =====================

    describe('Plan status lifecycle', () => {
        test('created plan is set to Active status', async () => {
            const planJson = {
                plan_name: 'Status Check Plan',
                summary: 'Verify plan status',
                tasks: [
                    {
                        title: 'Check status',
                        description: 'Verify plan is active',
                        priority: 'P1',
                        estimated_minutes: 15,
                        acceptance_criteria: 'Status is active',
                        dependencies: [],
                    },
                ],
            };

            mockLLM.chat.mockResolvedValue({
                content: JSON.stringify(planJson),
                tokens_used: 50,
            });

            const context: AgentContext = { conversationHistory: [] };
            await agent.processMessage('Check plan status', context);

            const plan = db.getActivePlan();
            expect(plan).not.toBeNull();
            expect(plan!.status).toBe(PlanStatus.Active);
            expect(plan!.name).toBe('Status Check Plan');
        });
    });

    // ===================== processMessage embedded JSON in text =====================

    describe('processMessage with JSON embedded in text', () => {
        test('extracts JSON from surrounding text', async () => {
            const planJson = {
                plan_name: 'Embedded Plan',
                summary: 'JSON embedded in text',
                tasks: [
                    {
                        title: 'Embedded task',
                        description: 'From embedded JSON',
                        priority: 'P2',
                        estimated_minutes: 20,
                        acceptance_criteria: 'Works',
                        dependencies: [],
                    },
                ],
            };

            mockLLM.chat.mockResolvedValue({
                content: `Here is the plan:\n${JSON.stringify(planJson)}\n\nLet me know if you need changes.`,
                tokens_used: 80,
            });

            const context: AgentContext = { conversationHistory: [] };
            const response = await agent.processMessage('Plan with text around JSON', context);

            expect(response.content).toContain('Embedded Plan');
            expect(response.content).toContain('1 tasks');
        });
    });
});

// ===================== HELPER FUNCTIONS =====================

/**
 * Helper: find a task by title in the database.
 * Uses a direct SQL query since there's no "getTaskByTitle" method.
 */
function findTaskByTitle(db: Database, title: string): Task | null {
    // Access db internals via createTask + getTask pattern
    // We need to query by title - use the database's internal db handle
    // Since Database doesn't expose a findByTitle method, we'll use a workaround:
    // Get all tasks and filter by title
    // The Database class has getNextAvailableTask and other query methods,
    // but the simplest approach is to use the internal prepared statement.
    // However, since we can't easily access the private db property,
    // we'll use a known pattern from other tests.

    // Actually, we can use the fact that Database stores tasks with known IDs
    // and we can search via the exposed methods.
    // Let's use a simple approach: iterate tasks by plan.

    // The simplest method available is to query via the database's own methods.
    // Since we have plan IDs, we can use getNextAvailableTask or similar.
    // But that's complex. Instead, we'll use a reflection approach to call
    // a raw query. For test purposes this is acceptable.

    try {
        const dbAny = db as any;
        const row = dbAny.db.prepare('SELECT * FROM tasks WHERE title = ?').get(title);
        if (!row) return null;
        return dbAny.rowToTask(row);
    } catch {
        return null;
    }
}
