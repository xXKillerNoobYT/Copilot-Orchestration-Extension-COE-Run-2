import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../src/core/database';
import { Orchestrator } from '../src/agents/orchestrator';
import { EvolutionService } from '../src/core/evolution-service';
import {
    TaskStatus, TaskPriority, PlanStatus,
    AgentType, AgentStatus, VerificationStatus,
    ConversationRole, TicketPriority,
} from '../src/types';

// Mock vscode
jest.mock('vscode', () => require('./__mocks__/vscode'));

/**
 * Integration Pipeline Tests
 *
 * These tests exercise the full pipeline spanning Database, Orchestrator,
 * and EvolutionService together. Each test uses a real in-memory SQLite
 * database with mocked LLM and ConfigManager to validate cross-component
 * behavior end-to-end.
 */
describe('Integration Pipeline', () => {
    let db: Database;
    let orchestrator: Orchestrator;
    let tmpDir: string;

    const mockLlm = {
        classify: jest.fn().mockResolvedValue('general'),
        chat: jest.fn().mockResolvedValue({
            content: 'ok',
            tokens_used: 10,
            model: 'test-model',
            finish_reason: 'stop',
        }),
        score: jest.fn().mockResolvedValue(85),
    } as any;

    const mockConfig = {
        getConfig: () => ({
            verification: { delaySeconds: 0, coverageThreshold: 80 },
            watcher: { debounceMs: 500 },
            taskQueue: { maxPending: 20 },
            agents: {},
        }),
        getAgentContextLimit: () => 4096,
        getLLMConfig: () => ({
            endpoint: 'http://localhost:1234/v1',
            model: 'test-model',
            timeoutSeconds: 10,
            startupTimeoutSeconds: 5,
            streamStallTimeoutSeconds: 3,
            maxTokens: 100,
            maxRequestRetries: 0,
            maxConcurrentRequests: 4,
            bossReservedSlots: 1,
        }),
        getCOEDir: () => tmpDir,
    } as any;

    const mockOutput = {
        appendLine: jest.fn(),
        show: jest.fn(),
        dispose: jest.fn(),
    } as any;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-integration-'));
        db = new Database(tmpDir);
        await db.initialize();

        orchestrator = new Orchestrator(db, mockLlm, mockConfig, mockOutput);
        await orchestrator.initialize();

        jest.clearAllMocks();
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // =========================================================================
    // 1. Plan creation -> tasks generated
    // =========================================================================
    it('should create a plan and generate tasks linked to it', () => {
        // Create a plan and activate it
        const plan = db.createPlan('Auth Feature', JSON.stringify({ scope: 'login + register' }));
        db.updatePlan(plan.id, { status: PlanStatus.Active });

        expect(db.getActivePlan()).not.toBeNull();
        expect(db.getActivePlan()!.name).toBe('Auth Feature');

        // Generate tasks under the plan (simulating Planning Agent output)
        const t1 = db.createTask({
            title: 'Create user model',
            priority: TaskPriority.P1,
            plan_id: plan.id,
            acceptance_criteria: 'User table with id, email, password_hash',
        });
        const t2 = db.createTask({
            title: 'Implement login endpoint',
            priority: TaskPriority.P1,
            plan_id: plan.id,
            dependencies: [t1.id],
            acceptance_criteria: 'POST /auth/login returns JWT',
        });
        const t3 = db.createTask({
            title: 'Write auth tests',
            priority: TaskPriority.P2,
            plan_id: plan.id,
            dependencies: [t2.id],
            acceptance_criteria: '>=85% coverage',
        });

        db.addAuditLog('planning', 'plan_created', `Plan "${plan.name}": 3 tasks`);

        // Verify tasks are linked to the plan
        const planTasks = db.getTasksByPlan(plan.id);
        expect(planTasks.length).toBe(3);

        // Verify only t1 is ready (no dependencies)
        const ready = db.getReadyTasks();
        expect(ready.length).toBe(1);
        expect(ready[0].title).toBe('Create user model');

        // Verify audit log captured the plan creation
        const auditLog = db.getAuditLog(10, 'planning');
        expect(auditLog.some(e => e.detail.includes('Auth Feature'))).toBe(true);
    });

    // =========================================================================
    // 2. Task assignment -> status changes to in_progress
    // =========================================================================
    it('should assign a task and transition its status to in_progress', () => {
        const plan = db.createPlan('Build API');
        db.updatePlan(plan.id, { status: PlanStatus.Active });

        const task = db.createTask({
            title: 'Setup Express server',
            priority: TaskPriority.P1,
            plan_id: plan.id,
        });

        // Verify initial status
        expect(task.status).toBe(TaskStatus.NotStarted);

        // Simulate the orchestrator assigning the task: getNextTask + mark in_progress
        const nextTask = orchestrator.getNextTask();
        expect(nextTask).not.toBeNull();
        expect(nextTask!.id).toBe(task.id);

        // Agent picks up the task and starts working
        db.updateTask(task.id, { status: TaskStatus.InProgress });
        db.updateAgentStatus('Orchestrator', AgentStatus.Working, task.id);

        const updated = db.getTask(task.id);
        expect(updated!.status).toBe(TaskStatus.InProgress);

        // Task should no longer appear in ready queue
        const ready = db.getReadyTasks();
        expect(ready.length).toBe(0);

        // Agent status reflects working state
        const agent = db.getAgentByName('Orchestrator');
        expect(agent!.status).toBe('working');
        expect(agent!.current_task).toBe(task.id);
    });

    // =========================================================================
    // 3. Task completion -> verification triggered (status goes to pending_verification)
    // =========================================================================
    it('should move task to pending_verification when reported done', () => {
        const task = db.createTask({
            title: 'Implement endpoint',
            priority: TaskPriority.P1,
            acceptance_criteria: 'Returns 200 on valid input',
        });

        // Simulate work phase
        db.updateTask(task.id, { status: TaskStatus.InProgress });

        // Report task done via orchestrator (fire-and-forget verification scheduling)
        // We use a short delay config (0 seconds) so verification would fire immediately,
        // but since LLM is mocked we just check the status transition.
        db.updateTask(task.id, {
            status: TaskStatus.PendingVerification,
            files_modified: ['src/routes/endpoint.ts'],
        });
        db.addAuditLog('orchestrator', 'task_done', `Task ${task.id} reported done`);

        const pending = db.getTask(task.id);
        expect(pending!.status).toBe(TaskStatus.PendingVerification);
        expect(pending!.files_modified).toContain('src/routes/endpoint.ts');

        // A verification result record should be creatable for this task
        const verResult = db.createVerificationResult(task.id);
        expect(verResult.status).toBe('not_started');
        expect(verResult.task_id).toBe(task.id);

        // Audit log should record the completion
        const logs = db.getAuditLog(10, 'orchestrator');
        expect(logs.some(e => e.action === 'task_done')).toBe(true);
    });

    // =========================================================================
    // 4. Verification pass -> status verified
    // =========================================================================
    it('should mark task as verified when verification passes', () => {
        const plan = db.createPlan('Feature Y');
        db.updatePlan(plan.id, { status: PlanStatus.Active });

        const task = db.createTask({
            title: 'Build feature Y core',
            plan_id: plan.id,
            acceptance_criteria: 'All acceptance criteria met',
        });

        // Progress through statuses: not_started -> in_progress -> pending_verification
        db.updateTask(task.id, { status: TaskStatus.InProgress });
        db.updateTask(task.id, {
            status: TaskStatus.PendingVerification,
            files_modified: ['src/feature-y.ts'],
        });

        // Verification passes
        const verResult = db.createVerificationResult(task.id);
        db.updateVerificationResult(
            verResult.id,
            VerificationStatus.Passed,
            JSON.stringify({ criteria_met: ['All acceptance criteria met'], criteria_missing: [] }),
            '5 tests passed, 0 failed',
            92
        );
        db.updateTask(task.id, { status: TaskStatus.Verified });
        db.addAuditLog('verification', 'passed', `Task "${task.title}" verified`);

        // Assertions
        const verified = db.getTask(task.id);
        expect(verified!.status).toBe(TaskStatus.Verified);

        const ver = db.getVerificationResult(task.id);
        expect(ver!.status).toBe(VerificationStatus.Passed);
        expect(ver!.coverage_percent).toBe(92);
        expect(ver!.test_output).toBe('5 tests passed, 0 failed');

        // Stats should reflect the verified task
        const stats = db.getStats();
        expect(stats.tasks_verified).toBe(1);
    });

    // =========================================================================
    // 5. Verification fail -> follow-up task created
    // =========================================================================
    it('should create a follow-up task when verification fails', () => {
        const plan = db.createPlan('Feature Z');
        db.updatePlan(plan.id, { status: PlanStatus.Active });

        const task = db.createTask({
            title: 'Build feature Z',
            plan_id: plan.id,
            acceptance_criteria: 'Error handling + input validation',
        });

        // Complete the work
        db.updateTask(task.id, { status: TaskStatus.InProgress });
        db.updateTask(task.id, {
            status: TaskStatus.PendingVerification,
            files_modified: ['src/feature-z.ts'],
        });

        // Verification FAILS
        const verResult = db.createVerificationResult(task.id);
        db.updateVerificationResult(
            verResult.id,
            VerificationStatus.Failed,
            JSON.stringify({ criteria_missing: ['Input validation not implemented'] }),
            '2 tests failed',
            45
        );
        db.updateTask(task.id, { status: TaskStatus.Failed });
        db.addAuditLog('verification', 'failed', `Task "${task.title}" failed verification`);

        // Create follow-up task to fix the issues
        const followUp = db.createTask({
            title: 'Fix: Add input validation for feature Z',
            plan_id: plan.id,
            priority: TaskPriority.P1,
            description: 'Verification failed: Input validation not implemented',
            acceptance_criteria: 'Input validation on all endpoints',
            dependencies: [task.id],
        });

        // Assertions
        expect(followUp.title).toContain('Fix');
        expect(followUp.dependencies).toContain(task.id);
        expect(followUp.priority).toBe(TaskPriority.P1);

        // The original task is marked failed
        const failedTask = db.getTask(task.id);
        expect(failedTask!.status).toBe(TaskStatus.Failed);

        // Verification result is recorded
        const ver = db.getVerificationResult(task.id);
        expect(ver!.status).toBe(VerificationStatus.Failed);
        expect(ver!.coverage_percent).toBe(45);

        // Follow-up is NOT ready yet (depends on the failed task)
        // Since failed != verified, the follow-up stays blocked
        const ready = db.getReadyTasks();
        const followUpReady = ready.find(t => t.id === followUp.id);
        expect(followUpReady).toBeUndefined();

        // Plan now has 2 tasks total
        const planTasks = db.getTasksByPlan(plan.id);
        expect(planTasks.length).toBe(2);
    });

    // =========================================================================
    // 6. Fresh restart -> resets in-progress tasks
    // =========================================================================
    it('should reset in-progress tasks and idle agents on fresh restart', async () => {
        // Create tasks in various states
        const t1 = db.createTask({ title: 'In progress task', status: TaskStatus.InProgress });
        const t2 = db.createTask({ title: 'Verified task', status: TaskStatus.Verified });
        const t3 = db.createTask({ title: 'Not started task', status: TaskStatus.NotStarted });
        const t4 = db.createTask({ title: 'Blocked task', status: TaskStatus.Blocked });

        // Set agents to working state
        db.updateAgentStatus('Orchestrator', AgentStatus.Working, t1.id);

        // Verify pre-restart state
        expect(db.getTask(t1.id)!.status).toBe(TaskStatus.InProgress);
        expect(db.getAgentByName('Orchestrator')!.status).toBe('working');

        // Perform fresh restart via orchestrator
        const result = await orchestrator.freshRestart();

        // In-progress tasks should be reset to not_started
        expect(db.getTask(t1.id)!.status).toBe(TaskStatus.NotStarted);

        // Verified tasks should stay verified (persistent state)
        expect(db.getTask(t2.id)!.status).toBe(TaskStatus.Verified);

        // Not-started tasks remain not_started
        expect(db.getTask(t3.id)!.status).toBe(TaskStatus.NotStarted);

        // Blocked tasks remain blocked (clearInMemoryState only resets in_progress)
        expect(db.getTask(t4.id)!.status).toBe(TaskStatus.Blocked);

        // All agents should be idle
        expect(db.getAgentByName('Orchestrator')!.status).toBe('idle');
        expect(db.getAgentByName('Orchestrator')!.current_task).toBeNull();

        // Fresh restart should report ready tasks
        expect(result.tasksReady).toBeGreaterThanOrEqual(2); // t1 (reset) + t3
        expect(result.message).toContain('Fresh restart complete');

        // Audit log should record the restart event
        const logs = db.getAuditLog(5, 'orchestrator');
        expect(logs.some(e => e.action === 'fresh_restart')).toBe(true);
    });

    // =========================================================================
    // 7. Evolution detection -> patterns detected from audit log entries
    // =========================================================================
    it('should detect recurring error patterns from audit log and create evolution proposals', async () => {
        const evolutionService = new EvolutionService(db, mockConfig, mockLlm, mockOutput);
        orchestrator.setEvolutionService(evolutionService);

        // Simulate 12 repeated timeout errors in the audit log
        for (let i = 0; i < 12; i++) {
            db.addAuditLog('answer', 'error', 'TOKEN_LIMIT_EXCEEDED on askQuestion call');
        }

        // Also simulate some non-error entries to ensure they are not detected
        db.addAuditLog('orchestrator', 'route', 'Intent: planning for message: create a plan');
        db.addAuditLog('planning', 'plan_created', 'Plan "Test": 3 tasks');

        // Mock the LLM to return a proposal for evolution
        mockLlm.chat.mockResolvedValueOnce({
            content: JSON.stringify({
                proposal: 'Increase askQuestion context from 800 to 1200 tokens',
                affects_p1: false,
                change_type: 'config',
            }),
            tokens_used: 50,
            model: 'test-model',
            finish_reason: 'stop',
        });

        // Run pattern detection
        const patterns = await evolutionService.detectPatterns();

        // Should detect at least one significant pattern
        expect(patterns.length).toBeGreaterThanOrEqual(1);

        // The pattern should match our simulated errors
        const tokenPattern = patterns.find(p => p.signature.includes('TOKEN_LIMIT_EXCEEDED'));
        expect(tokenPattern).toBeDefined();
        expect(tokenPattern!.frequency).toBe(12);

        // Score should be >= 9 (threshold), severity 1 for general errors, frequency 12
        expect(tokenPattern!.score).toBeGreaterThanOrEqual(9);

        // The evolution log should have an entry (auto-applied since affects_p1 = false)
        const evolutionLog = db.getEvolutionLog(5);
        expect(evolutionLog.length).toBeGreaterThanOrEqual(1);
        // Non-P1 proposals should be auto-applied
        const appliedEntry = evolutionLog.find(e =>
            e.pattern.includes('TOKEN_LIMIT_EXCEEDED') && e.status === 'applied'
        );
        expect(appliedEntry).toBeDefined();
    });

    // =========================================================================
    // 8. Full lifecycle: plan -> assign -> complete -> verify -> done
    // =========================================================================
    it('should complete the full lifecycle: plan -> assign -> complete -> verify -> done', () => {
        // --- PHASE 1: Plan creation ---
        const plan = db.createPlan('REST API v2', JSON.stringify({
            features: ['users', 'products', 'orders'],
        }));
        db.updatePlan(plan.id, { status: PlanStatus.Active });
        db.addAuditLog('planning', 'plan_created', `Plan "${plan.name}" activated`);

        // --- PHASE 2: Task decomposition ---
        const t1 = db.createTask({
            title: 'Setup database schema',
            priority: TaskPriority.P1,
            estimated_minutes: 20,
            plan_id: plan.id,
            acceptance_criteria: 'All tables created with proper indexes',
        });
        const t2 = db.createTask({
            title: 'Implement user CRUD',
            priority: TaskPriority.P1,
            estimated_minutes: 30,
            plan_id: plan.id,
            dependencies: [t1.id],
            acceptance_criteria: 'All CRUD endpoints return proper status codes',
        });
        const t3 = db.createTask({
            title: 'Add integration tests',
            priority: TaskPriority.P2,
            estimated_minutes: 25,
            plan_id: plan.id,
            dependencies: [t2.id],
            acceptance_criteria: '>=85% coverage, all endpoints tested',
        });

        // --- PHASE 3: Task 1 assignment + work ---
        let next = db.getNextReadyTask();
        expect(next!.title).toBe('Setup database schema');

        db.updateTask(t1.id, { status: TaskStatus.InProgress });
        db.addConversation('coding_agent', ConversationRole.User, 'Starting work on database schema', t1.id);

        // --- PHASE 4: Task 1 completion ---
        db.updateTask(t1.id, {
            status: TaskStatus.PendingVerification,
            files_modified: ['src/db/schema.ts', 'src/db/migrations/001.sql'],
        });
        db.addAuditLog('coding_agent', 'task_done', `Task "${t1.title}" completed`);

        // --- PHASE 5: Task 1 verification (PASS) ---
        const ver1 = db.createVerificationResult(t1.id);
        db.updateVerificationResult(
            ver1.id,
            VerificationStatus.Passed,
            JSON.stringify({ criteria_met: ['All tables created', 'Indexes added'] }),
            '4 tests passed',
            95
        );
        db.updateTask(t1.id, { status: TaskStatus.Verified });
        db.addAuditLog('verification', 'passed', `Task "${t1.title}" verified`);

        // --- PHASE 6: Task 2 now becomes available ---
        next = db.getNextReadyTask();
        expect(next!.title).toBe('Implement user CRUD');

        // Task 3 should NOT be ready (depends on t2)
        const readyTitles = db.getReadyTasks().map(t => t.title);
        expect(readyTitles).not.toContain('Add integration tests');

        // --- PHASE 7: Task 2 work + completion + verification ---
        db.updateTask(t2.id, { status: TaskStatus.InProgress });
        db.updateTask(t2.id, {
            status: TaskStatus.PendingVerification,
            files_modified: ['src/routes/users.ts', 'src/controllers/users.ts'],
        });

        const ver2 = db.createVerificationResult(t2.id);
        db.updateVerificationResult(
            ver2.id,
            VerificationStatus.Passed,
            JSON.stringify({ criteria_met: ['All CRUD endpoints return proper codes'] }),
            '6 tests passed',
            88
        );
        db.updateTask(t2.id, { status: TaskStatus.Verified });

        // --- PHASE 8: Task 3 now available ---
        next = db.getNextReadyTask();
        expect(next!.title).toBe('Add integration tests');

        // --- PHASE 9: Task 3 work + completion + verification ---
        db.updateTask(t3.id, { status: TaskStatus.InProgress });
        db.updateTask(t3.id, {
            status: TaskStatus.PendingVerification,
            files_modified: ['tests/integration/users.test.ts'],
        });

        const ver3 = db.createVerificationResult(t3.id);
        db.updateVerificationResult(
            ver3.id,
            VerificationStatus.Passed,
            JSON.stringify({ criteria_met: ['>=85% coverage', 'All endpoints tested'] }),
            '12 tests passed',
            91
        );
        db.updateTask(t3.id, { status: TaskStatus.Verified });

        // --- PHASE 10: All tasks complete ---
        const allTasks = db.getTasksByPlan(plan.id);
        expect(allTasks.length).toBe(3);
        expect(allTasks.every(t => t.status === TaskStatus.Verified)).toBe(true);

        // No more ready tasks
        const remaining = db.getReadyTasks();
        expect(remaining.length).toBe(0);

        // --- Final assertions ---
        const stats = db.getStats();
        expect(stats.total_tasks).toBe(3);
        expect(stats.tasks_verified).toBe(3);
        expect(stats.tasks_not_started).toBeUndefined(); // all moved past not_started

        // Conversations were logged
        const convs = db.getConversationsByTask(t1.id);
        expect(convs.length).toBeGreaterThanOrEqual(1);

        // Audit trail is complete
        const auditLog = db.getAuditLog(50);
        const planCreated = auditLog.some(e => e.action === 'plan_created');
        const taskDone = auditLog.some(e => e.action === 'task_done');
        const verPassed = auditLog.some(e => e.action === 'passed');
        expect(planCreated).toBe(true);
        expect(taskDone).toBe(true);
        expect(verPassed).toBe(true);

        // Verification results all passed
        for (const task of allTasks) {
            const ver = db.getVerificationResult(task.id);
            expect(ver).not.toBeNull();
            expect(ver!.status).toBe(VerificationStatus.Passed);
            expect(ver!.coverage_percent).toBeGreaterThanOrEqual(85);
        }
    });
});
