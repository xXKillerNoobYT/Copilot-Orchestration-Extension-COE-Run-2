import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../src/core/database';
import { TaskStatus, TaskPriority, TicketStatus, TicketPriority, AgentType, VerificationStatus, ConversationRole } from '../src/types';

describe('Database', () => {
    let db: Database;
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-test-'));
        db = new Database(tmpDir);
        await db.initialize();
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ===================== TASKS =====================

    describe('Tasks', () => {
        test('create and retrieve a task', () => {
            const task = db.createTask({
                title: 'Implement login endpoint',
                description: 'Create POST /auth/login',
                priority: TaskPriority.P1,
                estimated_minutes: 30,
                acceptance_criteria: 'Returns JWT token on valid credentials',
            });

            expect(task.id).toBeDefined();
            expect(task.title).toBe('Implement login endpoint');
            expect(task.priority).toBe('P1');
            expect(task.status).toBe(TaskStatus.NotStarted);

            const retrieved = db.getTask(task.id);
            expect(retrieved).toBeDefined();
            expect(retrieved!.title).toBe('Implement login endpoint');
        });

        test('get tasks by status', () => {
            db.createTask({ title: 'Task 1', status: TaskStatus.NotStarted });
            db.createTask({ title: 'Task 2', status: TaskStatus.NotStarted });
            db.createTask({ title: 'Task 3', status: TaskStatus.InProgress });

            const notStarted = db.getTasksByStatus(TaskStatus.NotStarted);
            expect(notStarted.length).toBe(2);

            const inProgress = db.getTasksByStatus(TaskStatus.InProgress);
            expect(inProgress.length).toBe(1);
        });

        test('update task', () => {
            const task = db.createTask({ title: 'Original' });
            const updated = db.updateTask(task.id, {
                title: 'Updated',
                status: TaskStatus.InProgress,
                priority: TaskPriority.P1,
            });

            expect(updated!.title).toBe('Updated');
            expect(updated!.status).toBe(TaskStatus.InProgress);
            expect(updated!.priority).toBe(TaskPriority.P1);
        });

        test('delete task', () => {
            const task = db.createTask({ title: 'To delete' });
            expect(db.deleteTask(task.id)).toBe(true);
            expect(db.getTask(task.id)).toBeNull();
        });

        test('get ready tasks with dependencies', () => {
            const t1 = db.createTask({ title: 'Task 1' });
            const t2 = db.createTask({ title: 'Task 2', dependencies: [t1.id] });
            const t3 = db.createTask({ title: 'Task 3' });

            // t1 and t3 are ready (no deps), t2 is blocked by t1
            let ready = db.getReadyTasks();
            expect(ready.length).toBe(2);
            expect(ready.map(t => t.title).sort()).toEqual(['Task 1', 'Task 3']);

            // Verify t1, now t2 should be ready
            db.updateTask(t1.id, { status: TaskStatus.Verified });
            ready = db.getReadyTasks();
            expect(ready.map(t => t.title).sort()).toEqual(['Task 2', 'Task 3']);
        });

        test('get next ready task respects priority', () => {
            db.createTask({ title: 'P3 task', priority: TaskPriority.P3 });
            db.createTask({ title: 'P1 task', priority: TaskPriority.P1 });
            db.createTask({ title: 'P2 task', priority: TaskPriority.P2 });

            const next = db.getNextReadyTask();
            expect(next).toBeDefined();
            expect(next!.title).toBe('P1 task');
        });

        test('dependencies stored and retrieved as arrays', () => {
            const t1 = db.createTask({ title: 'Task 1' });
            const t2 = db.createTask({ title: 'Task 2' });
            const t3 = db.createTask({ title: 'Task 3', dependencies: [t1.id, t2.id] });

            const retrieved = db.getTask(t3.id);
            expect(retrieved!.dependencies).toEqual([t1.id, t2.id]);
        });

        test('get tasks by plan', () => {
            const plan = db.createPlan('Test Plan');
            db.createTask({ title: 'Plan task 1', plan_id: plan.id });
            db.createTask({ title: 'Plan task 2', plan_id: plan.id });
            db.createTask({ title: 'Unrelated task' });

            const planTasks = db.getTasksByPlan(plan.id);
            expect(planTasks.length).toBe(2);
        });
    });

    // ===================== TICKETS =====================

    describe('Tickets', () => {
        test('create ticket with auto-numbering', () => {
            const t1 = db.createTicket({ title: 'First ticket' });
            const t2 = db.createTicket({ title: 'Second ticket' });

            expect(t1.ticket_number).toBe(1);
            expect(t2.ticket_number).toBe(2);
        });

        test('get ticket by number', () => {
            const ticket = db.createTicket({ title: 'Test ticket', body: 'Details here' });
            const retrieved = db.getTicketByNumber(ticket.ticket_number);

            expect(retrieved).toBeDefined();
            expect(retrieved!.title).toBe('Test ticket');
            expect(retrieved!.body).toBe('Details here');
        });

        test('update ticket status', () => {
            const ticket = db.createTicket({ title: 'Open ticket' });
            db.updateTicket(ticket.id, { status: TicketStatus.Resolved });

            const updated = db.getTicket(ticket.id);
            expect(updated!.status).toBe(TicketStatus.Resolved);
        });

        test('get tickets by status', () => {
            db.createTicket({ title: 'Open 1' });
            db.createTicket({ title: 'Open 2' });
            db.createTicket({ title: 'Resolved', status: TicketStatus.Resolved });

            const open = db.getTicketsByStatus(TicketStatus.Open);
            expect(open.length).toBe(2);

            const resolved = db.getTicketsByStatus(TicketStatus.Resolved);
            expect(resolved.length).toBe(1);
        });

        test('active ticket count', () => {
            db.createTicket({ title: 'Open' });
            db.createTicket({ title: 'Escalated', status: TicketStatus.Escalated });
            db.createTicket({ title: 'Resolved', status: TicketStatus.Resolved });

            expect(db.getActiveTicketCount()).toBe(2);
        });

        test('ticket replies', () => {
            const ticket = db.createTicket({ title: 'Question' });
            db.addTicketReply(ticket.id, 'user', 'Yes, use SQLite', 92);
            db.addTicketReply(ticket.id, 'Clarity Agent', 'Clear (92/100)', 92);

            const replies = db.getTicketReplies(ticket.id);
            expect(replies.length).toBe(2);
            expect(replies[0].author).toBe('user');
            expect(replies[0].clarity_score).toBe(92);
        });
    });

    // ===================== PLANS =====================

    describe('Plans', () => {
        test('create and get plan', () => {
            const plan = db.createPlan('My Plan', '{"features": 5}');
            expect(plan.id).toBeDefined();
            expect(plan.name).toBe('My Plan');
            expect(plan.status).toBe('draft');

            const retrieved = db.getPlan(plan.id);
            expect(retrieved!.config_json).toBe('{"features": 5}');
        });

        test('get active plan', () => {
            const p1 = db.createPlan('Draft Plan');
            const p2 = db.createPlan('Active Plan');
            db.updatePlan(p2.id, { status: 'active' as any });

            const active = db.getActivePlan();
            expect(active).toBeDefined();
            expect(active!.name).toBe('Active Plan');
        });
    });

    // ===================== AGENTS =====================

    describe('Agents', () => {
        test('register and retrieve agents', () => {
            db.registerAgent('Test Agent', AgentType.Planning);
            const agent = db.getAgentByName('Test Agent');

            expect(agent).toBeDefined();
            expect(agent!.type).toBe(AgentType.Planning);
            expect(agent!.status).toBe('idle');
        });

        test('update agent status', () => {
            db.registerAgent('Worker', AgentType.Answer);
            db.updateAgentStatus('Worker', 'working' as any, 'task-123');

            const agent = db.getAgentByName('Worker');
            expect(agent!.status).toBe('working');
            expect(agent!.current_task).toBe('task-123');
        });
    });

    // ===================== AUDIT LOG =====================

    describe('Audit Log', () => {
        test('add and retrieve audit entries', () => {
            db.addAuditLog('orchestrator', 'route', 'Routed to planning');
            db.addAuditLog('planning', 'plan_created', '15 tasks');
            db.addAuditLog('orchestrator', 'route', 'Routed to verification');

            const all = db.getAuditLog(10);
            expect(all.length).toBe(3);

            const orchOnly = db.getAuditLog(10, 'orchestrator');
            expect(orchOnly.length).toBe(2);
        });
    });

    // ===================== VERIFICATION =====================

    describe('Verification', () => {
        test('create and update verification result', () => {
            const task = db.createTask({ title: 'Verify me' });
            const result = db.createVerificationResult(task.id);

            expect(result.status).toBe('not_started');

            db.updateVerificationResult(result.id, VerificationStatus.Passed,
                '{"criteria_met": ["all"]}', '8 tests passed', 87);

            const updated = db.getVerificationResult(task.id);
            expect(updated!.status).toBe(VerificationStatus.Passed);
            expect(updated!.coverage_percent).toBe(87);
        });
    });

    // ===================== EVOLUTION =====================

    describe('Evolution', () => {
        test('add and retrieve evolution entries', () => {
            const entry = db.addEvolutionEntry(
                'TOKEN_LIMIT_EXCEEDED x12',
                'Increase askQuestion context from 800 to 1200 tokens'
            );

            expect(entry.status).toBe('proposed');

            db.updateEvolutionEntry(entry.id, 'applied', 'Token errors reduced 83%');

            const log = db.getEvolutionLog(5);
            expect(log.length).toBe(1);
            expect(log[0].status).toBe('applied');
            expect(log[0].result).toBe('Token errors reduced 83%');
        });
    });

    // ===================== STATS =====================

    describe('Stats', () => {
        test('get system stats', () => {
            db.createTask({ title: 'T1' });
            db.createTask({ title: 'T2', status: TaskStatus.Verified });
            db.createTicket({ title: 'Ticket 1' });

            const stats = db.getStats();
            expect(stats.total_tasks).toBe(2);
            expect(stats.total_tickets).toBe(1);
            expect(stats.tasks_not_started).toBe(1);
            expect(stats.tasks_verified).toBe(1);
        });
    });

    // ===================== FRESH RESTART =====================

    describe('Fresh Restart', () => {
        test('clearInMemoryState resets in-progress tasks and agents', () => {
            const task = db.createTask({ title: 'In progress', status: TaskStatus.InProgress });
            db.registerAgent('TestAgent', AgentType.Planning);
            db.updateAgentStatus('TestAgent', 'working' as any, task.id);

            db.clearInMemoryState();

            const resetTask = db.getTask(task.id);
            expect(resetTask!.status).toBe(TaskStatus.NotStarted);

            const resetAgent = db.getAgentByName('TestAgent');
            expect(resetAgent!.status).toBe('idle');
            expect(resetAgent!.current_task).toBeNull();
        });
    });

    // ===================== CONVERSATIONS =====================

    describe('Conversations', () => {
        test('add and retrieve conversations', () => {
            const task = db.createTask({ title: 'Chat task' });
            db.addConversation('orchestrator', ConversationRole.User, 'What should I build?', task.id);
            db.addConversation('orchestrator', ConversationRole.Agent, 'A REST API', task.id, undefined, 150);

            const convs = db.getConversationsByTask(task.id);
            expect(convs.length).toBe(2);
            expect(convs[1].tokens_used).toBe(150);

            const byAgent = db.getConversationsByAgent('orchestrator');
            expect(byAgent.length).toBe(2);
        });
    });
});
