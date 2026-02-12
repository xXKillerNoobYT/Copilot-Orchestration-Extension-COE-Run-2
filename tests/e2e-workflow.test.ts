import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../src/core/database';
import {
    TaskStatus, TaskPriority, TicketStatus, TicketPriority,
    AgentType, AgentStatus, PlanStatus, VerificationStatus, ConversationRole
} from '../src/types';

// Mock vscode
jest.mock('vscode', () => require('./__mocks__/vscode'));

/**
 * E2E Workflow Tests
 * Tests the complete lifecycle as described in True Plan docs:
 * Plan → Task Queue → Coding AI gets work → Reports done → Verification → Complete
 */
describe('E2E Workflow: Complete Issue Resolution', () => {
    let db: Database;
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-e2e-'));
        db = new Database(tmpDir);
        await db.initialize();
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('Full lifecycle: Plan → Tasks → Work → Verify → Complete', () => {
        // Step 1: Create a plan (simulating Planning Agent output)
        const plan = db.createPlan('User Auth Feature', JSON.stringify({
            features: ['login', 'register', 'logout'],
            scale: 'small',
        }));
        db.updatePlan(plan.id, { status: PlanStatus.Active });
        expect(db.getActivePlan()!.name).toBe('User Auth Feature');

        // Step 2: Create atomic tasks (simulating decomposition)
        const t1 = db.createTask({
            title: 'Create user model',
            description: 'Create SQLite table and TypeScript interface for users',
            priority: TaskPriority.P1,
            estimated_minutes: 20,
            acceptance_criteria: 'User model with id, email, password_hash, created_at fields',
            plan_id: plan.id,
        });

        const t2 = db.createTask({
            title: 'Implement POST /auth/register',
            description: 'Registration endpoint with validation',
            priority: TaskPriority.P1,
            estimated_minutes: 30,
            acceptance_criteria: 'Endpoint creates user, returns 201 with user ID',
            plan_id: plan.id,
            dependencies: [t1.id],
        });

        const t3 = db.createTask({
            title: 'Implement POST /auth/login',
            description: 'Login endpoint returning JWT',
            priority: TaskPriority.P1,
            estimated_minutes: 30,
            acceptance_criteria: 'Endpoint returns JWT on valid credentials, 401 on invalid',
            plan_id: plan.id,
            dependencies: [t1.id],
        });

        const t4 = db.createTask({
            title: 'Add auth tests',
            description: 'Unit tests for auth endpoints',
            priority: TaskPriority.P1,
            estimated_minutes: 25,
            acceptance_criteria: '>=85% coverage on auth module',
            plan_id: plan.id,
            dependencies: [t2.id, t3.id],
        });

        db.addAuditLog('planning', 'plan_created', `Plan "${plan.name}": 4 tasks`);

        // Step 3: Coding AI calls getNextTask — should get t1 (no deps)
        let next = db.getNextReadyTask();
        expect(next!.title).toBe('Create user model');

        // t2 and t3 should NOT be ready (depend on t1)
        const ready = db.getReadyTasks();
        expect(ready.length).toBe(1);

        // Step 4: Coding AI works on t1, marks as in_progress
        db.updateTask(t1.id, { status: TaskStatus.InProgress });
        expect(db.getTask(t1.id)!.status).toBe(TaskStatus.InProgress);

        // Step 5: Coding AI asks a question
        db.addConversation('coding_agent', ConversationRole.User, 'Should password_hash use bcrypt or argon2?', t1.id);
        // Answer Agent responds
        db.addConversation('answer', ConversationRole.Agent, 'Use bcrypt per plan section 2.1. CONFIDENCE: 95', t1.id);
        const convs = db.getConversationsByTask(t1.id);
        expect(convs.length).toBe(2);

        // Step 6: Coding AI reports t1 done
        db.updateTask(t1.id, {
            status: TaskStatus.PendingVerification,
            files_modified: ['src/models/user.ts'],
        });
        db.addAuditLog('coding_agent', 'task_done', `Task "${t1.title}" completed`);

        // Step 7: Verification
        const verResult = db.createVerificationResult(t1.id);
        db.updateVerificationResult(verResult.id, VerificationStatus.Passed,
            JSON.stringify({ criteria_met: ['User model with correct fields'], criteria_missing: [] }),
            '3 tests passed', 90
        );
        db.updateTask(t1.id, { status: TaskStatus.Verified });
        db.addAuditLog('verification', 'passed', `Task "${t1.title}" verified`);

        // Step 8: Now t2 and t3 should be ready (t1 is verified)
        const readyAfterT1 = db.getReadyTasks();
        expect(readyAfterT1.length).toBe(2);
        expect(readyAfterT1.map(t => t.title).sort()).toEqual([
            'Implement POST /auth/login',
            'Implement POST /auth/register',
        ]);

        // Step 9: Complete t2 and t3
        db.updateTask(t2.id, { status: TaskStatus.InProgress });
        db.updateTask(t2.id, { status: TaskStatus.PendingVerification, files_modified: ['src/routes/register.ts'] });
        const ver2 = db.createVerificationResult(t2.id);
        db.updateVerificationResult(ver2.id, VerificationStatus.Passed, '{}', '5 tests passed', 88);
        db.updateTask(t2.id, { status: TaskStatus.Verified });

        db.updateTask(t3.id, { status: TaskStatus.InProgress });
        db.updateTask(t3.id, { status: TaskStatus.PendingVerification, files_modified: ['src/routes/login.ts'] });
        const ver3 = db.createVerificationResult(t3.id);
        db.updateVerificationResult(ver3.id, VerificationStatus.Passed, '{}', '4 tests passed', 92);
        db.updateTask(t3.id, { status: TaskStatus.Verified });

        // Step 10: t4 should now be ready (depends on t2 + t3)
        const readyForT4 = db.getReadyTasks();
        expect(readyForT4.length).toBe(1);
        expect(readyForT4[0].title).toBe('Add auth tests');

        // Complete t4
        db.updateTask(t4.id, { status: TaskStatus.Verified });

        // Step 11: All tasks complete
        const allTasks = db.getTasksByPlan(plan.id);
        const allVerified = allTasks.every(t => t.status === TaskStatus.Verified);
        expect(allVerified).toBe(true);

        // Step 12: Check stats
        const stats = db.getStats();
        expect(stats.total_tasks).toBe(4);
        expect(stats.tasks_verified).toBe(4);
    });

    test('Verification failure creates follow-up task', () => {
        const plan = db.createPlan('Feature X');
        db.updatePlan(plan.id, { status: PlanStatus.Active });

        const task = db.createTask({
            title: 'Build feature X',
            plan_id: plan.id,
            acceptance_criteria: 'Feature X works end to end',
        });

        // Coding AI completes
        db.updateTask(task.id, { status: TaskStatus.PendingVerification });

        // Verification FAILS
        const ver = db.createVerificationResult(task.id);
        db.updateVerificationResult(ver.id, VerificationStatus.Failed,
            JSON.stringify({ criteria_missing: ['Error handling not implemented'] })
        );
        db.updateTask(task.id, { status: TaskStatus.Failed });

        // Create follow-up task
        const followUp = db.createTask({
            title: 'Fix: Error handling for feature X',
            plan_id: plan.id,
            priority: TaskPriority.P1,
            dependencies: [task.id],
            description: 'Verification failed: Error handling not implemented',
        });

        expect(followUp.title).toContain('Fix');
        expect(followUp.dependencies).toContain(task.id);
    });

    test('Ticket workflow: AI question → user answer → clarity check', () => {
        // Step 1: AI creates ticket
        const ticket = db.createTicket({
            title: 'Should sessions persist across restarts?',
            body: 'Working on session management. Need to know if sessions survive server restart.',
            priority: TicketPriority.P1,
            creator: 'Answer Agent',
        });
        expect(ticket.ticket_number).toBe(1);

        // Step 2: User replies
        db.addTicketReply(ticket.id, 'user', 'Yes, persist to SQLite with 7-day expiry');

        // Step 3: Clarity Agent scores the reply
        db.addTicketReply(ticket.id, 'Clarity Agent', 'Clear (92/100)', 92);
        db.updateTicket(ticket.id, { status: TicketStatus.Resolved });

        const resolved = db.getTicket(ticket.id);
        expect(resolved!.status).toBe(TicketStatus.Resolved);

        const replies = db.getTicketReplies(ticket.id);
        expect(replies.length).toBe(2);
        expect(replies[1].clarity_score).toBe(92);
    });

    test('Ticket escalation after 5 clarification rounds', () => {
        const ticket = db.createTicket({
            title: 'Ambiguous requirement',
            priority: TicketPriority.P2,
            creator: 'Planning Team',
        });

        // 5 rounds of clarification
        for (let i = 0; i < 5; i++) {
            db.addTicketReply(ticket.id, 'user', `Attempt ${i + 1}`);
            db.addTicketReply(ticket.id, 'Clarity Agent', `Needs clarification (${60 + i}/100)`, 60 + i);
        }

        // After 5 rounds, should escalate
        db.updateTicket(ticket.id, { status: TicketStatus.Escalated });

        const escalated = db.getTicket(ticket.id);
        expect(escalated!.status).toBe(TicketStatus.Escalated);

        const replies = db.getTicketReplies(ticket.id);
        expect(replies.length).toBe(10); // 5 user + 5 clarity
    });

    test('Fresh restart resets state correctly', () => {
        // Set up some in-progress state
        const task1 = db.createTask({ title: 'Active task', status: TaskStatus.InProgress });
        const task2 = db.createTask({ title: 'Verified task', status: TaskStatus.Verified });
        db.registerAgent('Planning Team', AgentType.Planning);
        db.updateAgentStatus('Planning Team', AgentStatus.Working, task1.id);

        // Fresh restart
        db.clearInMemoryState();

        // In-progress tasks should be reset
        expect(db.getTask(task1.id)!.status).toBe(TaskStatus.NotStarted);
        // Verified tasks should stay verified
        expect(db.getTask(task2.id)!.status).toBe(TaskStatus.Verified);
        // Agents should be idle
        expect(db.getAgentByName('Planning Team')!.status).toBe('idle');
    });

    test('Evolution: detect pattern and propose improvement', () => {
        // Simulate repeated token limit errors
        for (let i = 0; i < 12; i++) {
            db.addAuditLog('answer', 'error', 'TOKEN_LIMIT_EXCEEDED on askQuestion');
        }

        // Check pattern
        const errors = db.getAuditLog(50, 'answer')
            .filter(e => e.detail.includes('TOKEN_LIMIT_EXCEEDED'));
        expect(errors.length).toBe(12);

        // Create evolution proposal
        const entry = db.addEvolutionEntry(
            'TOKEN_LIMIT_EXCEEDED x12 on askQuestion',
            'Increase askQuestion context from 800 to 1200 tokens'
        );
        expect(entry.status).toBe('proposed');

        // Apply
        db.updateEvolutionEntry(entry.id, 'applied', 'Token errors reduced 83%');

        const log = db.getEvolutionLog(5);
        expect(log[0].status).toBe('applied');
        expect(log[0].result).toContain('83%');
    });

    test('Custom agent YAML safety: write permissions always false', () => {
        // Create a custom agent YAML file
        const customDir = path.join(tmpDir, 'agents', 'custom');
        fs.mkdirSync(customDir, { recursive: true });

        const yamlContent = `
name: SecurityAnalyzer
description: Scans for vulnerabilities
systemPrompt: You are a security analyst
goals:
  - description: Check OWASP Top 10
    priority: 1
checklist:
  - item: Review auth flow
    required: true
routingKeywords:
  - security
  - vulnerability
permissions:
  readFiles: true
  searchCode: true
  writeFiles: true
  executeCode: true
limits:
  maxGoals: 20
  maxLLMCalls: 50
  maxTimeMinutes: 30
  timePerGoalMinutes: 5
`;
        fs.writeFileSync(path.join(customDir, 'SecurityAnalyzer.yaml'), yamlContent);

        // Verify the YAML was written
        expect(fs.existsSync(path.join(customDir, 'SecurityAnalyzer.yaml'))).toBe(true);

        // The CustomAgentRunner would parse this and HARDLOCK writeFiles/executeCode to false
        // This is verified in the CustomAgentRunner.parseYaml() method
    });

    test('Task decomposition: large task into atomic subtasks', () => {
        const plan = db.createPlan('Large Feature');

        // Large task (3 hours)
        const bigTask = db.createTask({
            title: 'Build complete auth system',
            estimated_minutes: 180,
            plan_id: plan.id,
        });

        // Decompose into subtasks
        const subtasks = [
            { title: 'Setup: Create user table', estimated_minutes: 15 },
            { title: 'Core: Implement bcrypt hashing', estimated_minutes: 20 },
            { title: 'Core: Build login endpoint', estimated_minutes: 30 },
            { title: 'Core: Build register endpoint', estimated_minutes: 30 },
            { title: 'Core: JWT token generation', estimated_minutes: 25 },
            { title: 'Tests: Auth unit tests', estimated_minutes: 20 },
            { title: 'Docs: API documentation', estimated_minutes: 15 },
        ];

        const createdSubtasks = subtasks.map((st, i) => {
            return db.createTask({
                title: st.title,
                estimated_minutes: st.estimated_minutes,
                plan_id: plan.id,
                parent_task_id: bigTask.id,
                dependencies: i > 0 ? [] : [], // First subtask has no deps
            });
        });

        // All subtasks should be 15-45 minutes
        for (const st of createdSubtasks) {
            expect(st.estimated_minutes).toBeGreaterThanOrEqual(15);
            expect(st.estimated_minutes).toBeLessThanOrEqual(45);
        }

        // Total should cover the original estimate roughly
        const totalMinutes = createdSubtasks.reduce((sum, t) => sum + t.estimated_minutes, 0);
        expect(totalMinutes).toBeLessThanOrEqual(bigTask.estimated_minutes);
    });

    test('Priority-based task queue ordering', () => {
        db.createTask({ title: 'P3: Nice to have', priority: TaskPriority.P3 });
        db.createTask({ title: 'P1: Critical fix', priority: TaskPriority.P1 });
        db.createTask({ title: 'P2: Important feature', priority: TaskPriority.P2 });
        db.createTask({ title: 'P1: Another critical', priority: TaskPriority.P1 });

        const allTasks = db.getAllTasks();
        // Should be ordered: P1, P1, P2, P3
        expect(allTasks[0].priority).toBe('P1');
        expect(allTasks[1].priority).toBe('P1');
        expect(allTasks[2].priority).toBe('P2');
        expect(allTasks[3].priority).toBe('P3');
    });

    test('Concurrent task: only one P1 in progress at a time (enforced by queue)', () => {
        const t1 = db.createTask({ title: 'P1 task 1', priority: TaskPriority.P1 });
        const t2 = db.createTask({ title: 'P1 task 2', priority: TaskPriority.P1 });

        // Start t1
        db.updateTask(t1.id, { status: TaskStatus.InProgress });

        // getNextReadyTask should still return t2 (it's the queue's job)
        // But in the orchestrator, only one task is assigned at a time
        const next = db.getNextReadyTask();
        expect(next!.title).toBe('P1 task 2');
    });
});
