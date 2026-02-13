jest.mock('vscode', () => ({
    window: {
        createOutputChannel: () => ({
            appendLine: jest.fn(), show: jest.fn(), dispose: jest.fn(),
        }),
    },
    workspace: { workspaceFolders: [] },
    Uri: { parse: (s: string) => ({ toString: () => s }) },
    env: { openExternal: jest.fn() },
}));

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { EventEmitter } from 'events';
import { Database } from '../src/core/database';
import { handleApiRequest } from '../src/webapp/api';
import { TaskPriority, TaskStatus, TicketPriority, AgentType, PlanStatus } from '../src/types';

// ==================== Helpers ====================

function mockReq(method: string, body?: any): http.IncomingMessage {
    const req = new EventEmitter() as any;
    req.method = method;
    if (body) {
        process.nextTick(() => {
            req.emit('data', JSON.stringify(body));
            req.emit('end');
        });
    } else {
        process.nextTick(() => req.emit('end'));
    }
    return req;
}

function mockRes(): http.ServerResponse {
    const res = {
        writeHead: jest.fn(),
        end: jest.fn(),
        setHeader: jest.fn(),
    } as any;
    return res;
}

function getJsonResponse(res: any): any {
    const lastCall = res.end.mock.calls[res.end.mock.calls.length - 1];
    return JSON.parse(lastCall[0]);
}

// ==================== Mocks ====================

const orchestrator = {
    callAgent: jest.fn().mockResolvedValue({
        content: '{"plan_name":"Test","tasks":[{"title":"T1","description":"D1","priority":"P2","estimated_minutes":30,"acceptance_criteria":"AC1","depends_on_titles":[]}]}',
    }),
} as any;

const config = {
    getConfig: () => ({
        version: '1.0.0',
        llm: {
            endpoint: 'http://localhost:1234/v1',
            model: 'test',
            timeoutSeconds: 30,
            startupTimeoutSeconds: 10,
            streamStallTimeoutSeconds: 60,
            maxTokens: 4000,
        },
        taskQueue: { maxPending: 20 },
        verification: { delaySeconds: 1, coverageThreshold: 80 },
        watcher: { debounceMs: 500 },
        agents: {},
        github: {
            token: 'fake-token',
            owner: 'test',
            repo: 'repo',
            syncIntervalMinutes: 30,
            autoImport: false,
        },
    }),
} as any;

// ==================== Test Suite ====================

describe('Webapp API Handlers', () => {
    let db: Database;
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-api-test-'));
        db = new Database(tmpDir);
        await db.initialize();
        orchestrator.callAgent.mockClear();
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ==================== Non-API routes ====================

    test('returns false for non-api routes', async () => {
        const req = mockReq('GET');
        const res = mockRes();
        const result = await handleApiRequest(req, res, '/some/page', db, orchestrator, config);
        expect(result).toBe(false);
        expect(res.writeHead).not.toHaveBeenCalled();
    });

    // ==================== 404 for unknown API routes ====================

    test('returns 404 for unknown API routes', async () => {
        const req = mockReq('GET');
        const res = mockRes();
        const result = await handleApiRequest(req, res, '/api/nonexistent', db, orchestrator, config);
        expect(result).toBe(true);
        expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
        const body = getJsonResponse(res);
        expect(body.error).toContain('API route not found');
    });

    // ==================== Dashboard ====================

    describe('GET /api/dashboard', () => {
        test('returns stats, plan, agents, and audit log', async () => {
            db.createTask({ title: 'Task A', priority: TaskPriority.P1 });
            db.createTask({ title: 'Task B', status: TaskStatus.Verified });
            db.createTicket({ title: 'Ticket 1' });
            db.registerAgent('planner', AgentType.Planning);
            db.addAuditLog('test', 'init', 'Initialized');

            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/dashboard', db, orchestrator, config);

            expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.stats).toBeDefined();
            expect(body.stats.total_tasks).toBe(2);
            expect(body.stats.total_tickets).toBe(1);
            expect(body.agents).toHaveLength(1);
            expect(body.agents[0].name).toBe('planner');
            expect(body.recentAudit).toHaveLength(1);
        });

        test('includes plan progress when active plan exists', async () => {
            const plan = db.createPlan('Active Plan');
            db.updatePlan(plan.id, { status: PlanStatus.Active });
            db.createTask({ title: 'Plan Task 1', plan_id: plan.id, status: TaskStatus.Verified });
            db.createTask({ title: 'Plan Task 2', plan_id: plan.id, status: TaskStatus.InProgress });
            db.createTask({ title: 'Plan Task 3', plan_id: plan.id });

            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/dashboard', db, orchestrator, config);

            const body = getJsonResponse(res);
            expect(body.plan).toBeDefined();
            expect(body.plan.name).toBe('Active Plan');
            expect(body.planProgress).toBeDefined();
            expect(body.planProgress.total).toBe(3);
            expect(body.planProgress.verified).toBe(1);
            expect(body.planProgress.in_progress).toBe(1);
            expect(body.planProgress.not_started).toBe(1);
        });
    });

    // ==================== Tasks CRUD ====================

    describe('Tasks CRUD', () => {
        test('GET /api/tasks returns all tasks', async () => {
            db.createTask({ title: 'Alpha' });
            db.createTask({ title: 'Beta' });

            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks', db, orchestrator, config);

            expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.data).toHaveLength(2);
            expect(body.total).toBe(2);
            expect(body.page).toBe(1);
        });

        test('POST /api/tasks creates a task', async () => {
            const req = mockReq('POST', {
                title: 'New Task',
                description: 'A description',
                priority: 'P1',
                estimated_minutes: 45,
                acceptance_criteria: 'Tests pass',
            });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks', db, orchestrator, config);

            expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.title).toBe('New Task');
            expect(body.priority).toBe('P1');
            expect(body.estimated_minutes).toBe(45);
            expect(body.acceptance_criteria).toBe('Tests pass');

            // Verify audit log was created
            const audit = db.getAuditLog(10);
            expect(audit.some(a => a.action === 'task_created')).toBe(true);
        });

        test('GET /api/tasks/:id returns a single task with verification and conversations', async () => {
            const task = db.createTask({ title: 'Single Task' });
            db.createVerificationResult(task.id);
            db.addConversation('orch', 'user' as any, 'Hello', task.id);

            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, `/api/tasks/${task.id}`, db, orchestrator, config);

            expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.title).toBe('Single Task');
            expect(body.verification).toBeDefined();
            expect(body.conversations).toHaveLength(1);
        });

        test('GET /api/tasks/:id returns 404 for missing task', async () => {
            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks/nonexistent-id', db, orchestrator, config);

            expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.error).toBe('Task not found');
        });

        test('PUT /api/tasks/:id updates a task', async () => {
            const task = db.createTask({ title: 'Old Title' });

            const req = mockReq('PUT', { title: 'New Title', status: 'in_progress' });
            const res = mockRes();
            await handleApiRequest(req, res, `/api/tasks/${task.id}`, db, orchestrator, config);

            expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.title).toBe('New Title');
            expect(body.status).toBe('in_progress');
        });

        test('PUT /api/tasks/:id returns 404 for missing task', async () => {
            const req = mockReq('PUT', { title: 'Updated' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks/missing-id', db, orchestrator, config);

            expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
        });

        test('DELETE /api/tasks/:id deletes a task', async () => {
            const task = db.createTask({ title: 'To Delete' });

            const req = mockReq('DELETE');
            const res = mockRes();
            await handleApiRequest(req, res, `/api/tasks/${task.id}`, db, orchestrator, config);

            expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.success).toBe(true);
            expect(db.getTask(task.id)).toBeNull();
        });

        test('DELETE /api/tasks/:id returns 404 for missing task', async () => {
            const req = mockReq('DELETE');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks/missing-id', db, orchestrator, config);

            expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
        });
    });

    // ==================== Ready Tasks ====================

    describe('GET /api/tasks/ready', () => {
        test('returns only ready tasks (no unmet dependencies)', async () => {
            const t1 = db.createTask({ title: 'Independent' });
            const t2 = db.createTask({ title: 'Blocked', dependencies: [t1.id] });
            db.createTask({ title: 'Also Independent' });

            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks/ready', db, orchestrator, config);

            const body = getJsonResponse(res);
            const titles = body.map((t: any) => t.title).sort();
            expect(titles).toEqual(['Also Independent', 'Independent']);
        });
    });

    // ==================== Tickets CRUD ====================

    describe('Tickets CRUD', () => {
        test('GET /api/tickets returns all tickets', async () => {
            db.createTicket({ title: 'Ticket A' });
            db.createTicket({ title: 'Ticket B' });

            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tickets', db, orchestrator, config);

            const body = getJsonResponse(res);
            expect(body.data).toHaveLength(2);
            expect(body.total).toBe(2);
        });

        test('POST /api/tickets creates a ticket', async () => {
            const req = mockReq('POST', {
                title: 'Bug Report',
                body: 'Something is broken',
                priority: 'P1',
                creator: 'tester',
            });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tickets', db, orchestrator, config);

            expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.title).toBe('Bug Report');
            expect(body.priority).toBe('P1');
            expect(body.creator).toBe('tester');
            expect(body.ticket_number).toBe(1);
        });

        test('GET /api/tickets/:id returns single ticket with replies', async () => {
            const ticket = db.createTicket({ title: 'Question' });
            db.addTicketReply(ticket.id, 'user', 'Reply body', 85);

            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, `/api/tickets/${ticket.id}`, db, orchestrator, config);

            const body = getJsonResponse(res);
            expect(body.title).toBe('Question');
            expect(body.replies).toHaveLength(1);
            expect(body.replies[0].author).toBe('user');
        });

        test('GET /api/tickets/:id returns 404 for missing ticket', async () => {
            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tickets/nonexistent', db, orchestrator, config);

            expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
        });

        test('PUT /api/tickets/:id updates a ticket', async () => {
            const ticket = db.createTicket({ title: 'Old Ticket' });

            const req = mockReq('PUT', { title: 'Updated Ticket', status: 'resolved' });
            const res = mockRes();
            await handleApiRequest(req, res, `/api/tickets/${ticket.id}`, db, orchestrator, config);

            const body = getJsonResponse(res);
            expect(body.title).toBe('Updated Ticket');
            expect(body.status).toBe('resolved');
        });

        test('PUT /api/tickets/:id returns 404 for missing ticket', async () => {
            const req = mockReq('PUT', { title: 'Updated' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tickets/missing', db, orchestrator, config);

            expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
        });
    });

    // ==================== Ticket Replies ====================

    describe('Ticket Replies', () => {
        test('GET /api/tickets/:id/replies returns replies', async () => {
            const ticket = db.createTicket({ title: 'Thread' });
            db.addTicketReply(ticket.id, 'alice', 'First reply');
            db.addTicketReply(ticket.id, 'bob', 'Second reply', 90);

            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, `/api/tickets/${ticket.id}/replies`, db, orchestrator, config);

            const body = getJsonResponse(res);
            expect(body).toHaveLength(2);
            expect(body[0].author).toBe('alice');
            expect(body[1].clarity_score).toBe(90);
        });

        test('POST /api/tickets/:id/replies adds a reply', async () => {
            const ticket = db.createTicket({ title: 'Needs Reply' });

            const req = mockReq('POST', {
                author: 'dev',
                body: 'Working on it',
                clarity_score: 75,
            });
            const res = mockRes();
            await handleApiRequest(req, res, `/api/tickets/${ticket.id}/replies`, db, orchestrator, config);

            expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.author).toBe('dev');
            expect(body.body).toBe('Working on it');
            expect(body.clarity_score).toBe(75);
        });
    });

    // ==================== Plans ====================

    describe('Plans', () => {
        test('GET /api/plans returns all plans', async () => {
            db.createPlan('Plan A');
            db.createPlan('Plan B');

            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/plans', db, orchestrator, config);

            const body = getJsonResponse(res);
            expect(body.data).toHaveLength(2);
            expect(body.total).toBe(2);
        });

        test('GET /api/plans/:id returns plan with tasks', async () => {
            const plan = db.createPlan('Detailed Plan');
            db.createTask({ title: 'Plan Task 1', plan_id: plan.id });
            db.createTask({ title: 'Plan Task 2', plan_id: plan.id });

            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, `/api/plans/${plan.id}`, db, orchestrator, config);

            const body = getJsonResponse(res);
            expect(body.name).toBe('Detailed Plan');
            expect(body.tasks).toHaveLength(2);
        });

        test('GET /api/plans/:id returns 404 for missing plan', async () => {
            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/plans/nonexistent', db, orchestrator, config);

            expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
        });

        test('PUT /api/plans/:id updates a plan', async () => {
            const plan = db.createPlan('Old Name');

            const req = mockReq('PUT', { name: 'New Name', status: 'active' });
            const res = mockRes();
            await handleApiRequest(req, res, `/api/plans/${plan.id}`, db, orchestrator, config);

            const body = getJsonResponse(res);
            expect(body.name).toBe('New Name');
            expect(body.status).toBe('active');
        });

        test('PUT /api/plans/:id returns 404 for missing plan', async () => {
            const req = mockReq('PUT', { name: 'Updated' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/plans/missing', db, orchestrator, config);

            expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
        });

        test('POST /api/plans/generate creates a plan via LLM', async () => {
            const req = mockReq('POST', {
                name: 'Generated Plan',
                description: 'Build an API',
                scale: 'MVP',
                focus: 'Backend',
                priorities: ['Auth', 'Database'],
            });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/plans/generate', db, orchestrator, config);

            expect(orchestrator.callAgent).toHaveBeenCalledTimes(1);
            expect(orchestrator.callAgent).toHaveBeenCalledWith(
                'planning',
                expect.stringContaining('Generated Plan'),
                expect.any(Object),
            );

            expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.plan).toBeDefined();
            expect(body.plan.name).toBe('Generated Plan');
            expect(body.taskCount).toBe(1);
            expect(body.tasks).toHaveLength(1);
            expect(body.tasks[0].title).toBe('T1');
        });
    });

    // ==================== Agents ====================

    describe('GET /api/agents', () => {
        test('returns all agents', async () => {
            db.registerAgent('planner', AgentType.Planning);
            db.registerAgent('verifier', AgentType.Verification);

            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/agents', db, orchestrator, config);

            const body = getJsonResponse(res);
            expect(body.data).toHaveLength(2);
            expect(body.total).toBe(2);
        });
    });

    // ==================== Audit Log ====================

    describe('GET /api/audit', () => {
        test('returns audit log entries', async () => {
            db.addAuditLog('webapp', 'action1', 'detail1');
            db.addAuditLog('webapp', 'action2', 'detail2');

            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/audit', db, orchestrator, config);

            const body = getJsonResponse(res);
            expect(body.data).toHaveLength(2);
            expect(body.total).toBe(2);
        });
    });

    // ==================== Evolution ====================

    describe('GET /api/evolution', () => {
        test('returns evolution log entries', async () => {
            db.addEvolutionEntry('PATTERN_A', 'Proposal A');
            db.addEvolutionEntry('PATTERN_B', 'Proposal B');

            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/evolution', db, orchestrator, config);

            const body = getJsonResponse(res);
            expect(body.data).toHaveLength(2);
            expect(body.total).toBe(2);
        });
    });

    // ==================== Verification ====================

    describe('Verification', () => {
        test('GET /api/verification/:id returns verification result', async () => {
            const task = db.createTask({ title: 'Verified Task' });
            db.createVerificationResult(task.id);

            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, `/api/verification/${task.id}`, db, orchestrator, config);

            const body = getJsonResponse(res);
            expect(body.task_id).toBe(task.id);
            expect(body.status).toBe('not_started');
        });

        test('GET /api/verification/:id returns { status: "none" } when no result exists', async () => {
            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/verification/no-result', db, orchestrator, config);

            const body = getJsonResponse(res);
            expect(body.status).toBe('none');
        });

        test('POST /api/verification/:id/approve marks task as verified', async () => {
            const task = db.createTask({ title: 'To Approve' });

            const req = mockReq('POST');
            const res = mockRes();
            await handleApiRequest(req, res, `/api/verification/${task.id}/approve`, db, orchestrator, config);

            const body = getJsonResponse(res);
            expect(body.success).toBe(true);

            const updated = db.getTask(task.id);
            expect(updated!.status).toBe('verified');

            // Audit log entry
            const audit = db.getAuditLog(10);
            expect(audit.some(a => a.action === 'verification_approved')).toBe(true);
        });

        test('POST /api/verification/:id/reject marks task as failed and creates follow-up task', async () => {
            const task = db.createTask({ title: 'To Reject', priority: TaskPriority.P1 });

            const req = mockReq('POST', { reason: 'Tests fail' });
            const res = mockRes();
            await handleApiRequest(req, res, `/api/verification/${task.id}/reject`, db, orchestrator, config);

            const body = getJsonResponse(res);
            expect(body.success).toBe(true);

            // Original task should be failed
            const updatedTask = db.getTask(task.id);
            expect(updatedTask!.status).toBe('failed');

            // A follow-up task should exist
            const allTasks = db.getAllTasks();
            const followUp = allTasks.find(t => t.title === `Fix: ${task.title}`);
            expect(followUp).toBeDefined();
            expect(followUp!.description).toContain('Tests fail');
            expect(followUp!.priority).toBe(TaskPriority.P1);
            expect(followUp!.dependencies).toContain(task.id);

            // Audit log entry
            const audit = db.getAuditLog(10);
            expect(audit.some(a => a.action === 'verification_rejected')).toBe(true);
        });
    });

    // ==================== GitHub Issues ====================

    describe('GitHub Issues', () => {
        test('GET /api/github/issues returns all issues', async () => {
            db.upsertGitHubIssue({
                github_id: 1001, number: 1, title: 'Issue 1', body: '', state: 'open',
                labels: [], assignees: [], repo_owner: 'o', repo_name: 'r',
                task_id: null, local_checksum: '', remote_checksum: '',
            });

            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/github/issues', db, orchestrator, config);

            const body = getJsonResponse(res);
            expect(body).toHaveLength(1);
            expect(body[0].title).toBe('Issue 1');
        });

        test('GET /api/github/issues/:id returns single issue', async () => {
            const issue = db.upsertGitHubIssue({
                github_id: 2001, number: 5, title: 'Specific Issue', body: 'Details',
                state: 'open', labels: ['bug'], assignees: ['dev1'],
                repo_owner: 'org', repo_name: 'repo',
                task_id: null, local_checksum: 'a', remote_checksum: 'a',
            });

            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, `/api/github/issues/${issue.id}`, db, orchestrator, config);

            const body = getJsonResponse(res);
            expect(body.title).toBe('Specific Issue');
            expect(body.labels).toEqual(['bug']);
        });

        test('GET /api/github/issues/:id returns 404 for missing issue', async () => {
            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/github/issues/nonexistent', db, orchestrator, config);

            expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
        });
    });

    // ==================== Config ====================

    describe('GET /api/config', () => {
        test('returns config', async () => {
            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/config', db, orchestrator, config);

            const body = getJsonResponse(res);
            expect(body.version).toBe('1.0.0');
            expect(body.llm.model).toBe('test');
            expect(body.github.owner).toBe('test');
        });
    });

    // ==================== POST create task with defaults ====================

    describe('POST /api/tasks with defaults', () => {
        test('uses default values when optional fields are missing', async () => {
            const req = mockReq('POST', { title: 'Minimal Task' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks', db, orchestrator, config);

            expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.title).toBe('Minimal Task');
            expect(body.priority).toBe('P2');
            expect(body.estimated_minutes).toBe(30);
            expect(body.description).toBe('');
            expect(body.acceptance_criteria).toBe('');
        });
    });

    // ==================== POST create ticket with defaults ====================

    describe('POST /api/tickets with defaults', () => {
        test('uses default values when optional fields are missing', async () => {
            const req = mockReq('POST', { title: 'Minimal Ticket' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tickets', db, orchestrator, config);

            expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.title).toBe('Minimal Ticket');
            expect(body.priority).toBe('P2');
            expect(body.creator).toBe('user');
            expect(body.body).toBe('');
        });
    });

    // ==================== Dashboard with no active plan ====================

    describe('GET /api/dashboard (no active plan)', () => {
        test('planProgress is null when no active plan', async () => {
            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/dashboard', db, orchestrator, config);

            const body = getJsonResponse(res);
            expect(body.plan).toBeNull();
            expect(body.planProgress).toBeNull();
        });
    });

    // ==================== Verification reject with default reason ====================

    describe('POST /api/verification/:id/reject with default reason', () => {
        test('uses default reason when none provided', async () => {
            const task = db.createTask({ title: 'Reject Default' });

            const req = mockReq('POST', {});
            const res = mockRes();
            await handleApiRequest(req, res, `/api/verification/${task.id}/reject`, db, orchestrator, config);

            const body = getJsonResponse(res);
            expect(body.success).toBe(true);

            const allTasks = db.getAllTasks();
            const followUp = allTasks.find(t => t.title === 'Fix: Reject Default');
            expect(followUp).toBeDefined();
            expect(followUp!.description).toContain('Rejected via web app');
        });
    });

    // ==================== CODING AGENT PROCESSING ====================
    describe('Coding Agent Processing (POST /api/coding/process)', () => {
        const mockCodingAgent = {
            processCommand: jest.fn().mockResolvedValue({
                id: 'resp-1',
                request_id: 'req-1',
                code: 'console.log("hello");',
                language: 'typescript',
                explanation: 'Generated hello world',
                files: [{ name: 'hello.ts', content: 'console.log("hello");', language: 'typescript' }],
                confidence: 85,
                warnings: [],
                requires_approval: false,
                diff: null,
                tokens_used: 42,
                duration_ms: 1500,
                created_at: new Date().toISOString(),
            }),
        } as any;

        beforeEach(() => {
            mockCodingAgent.processCommand.mockClear();
        });

        test('returns 503 when no coding agent service', async () => {
            const session = db.createCodingSession({ name: 'Test' });
            const req = mockReq('POST', { session_id: session.id, content: 'build a button' });
            const res = mockRes();
            // Call without codingAgentService (7th arg omitted)
            await handleApiRequest(req, res, '/api/coding/process', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(503, expect.anything());
        });

        test('validates required fields', async () => {
            const req = mockReq('POST', { session_id: '', content: '' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/coding/process', db, orchestrator, config, mockCodingAgent);
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.anything());
            const body = getJsonResponse(res);
            expect(body.error).toContain('required');
        });

        test('stores user and agent messages', async () => {
            const session = db.createCodingSession({ name: 'Test' });
            const req = mockReq('POST', { session_id: session.id, content: 'build a button' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/coding/process', db, orchestrator, config, mockCodingAgent);
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.anything());
            const body = getJsonResponse(res);
            expect(body.user_message.role).toBe('user');
            expect(body.user_message.content).toBe('build a button');
            expect(body.agent_message.role).toBe('agent');
            expect(body.agent_message.content).toContain('Generated hello world');
            expect(body.agent_response.confidence).toBe(85);

            // Verify both messages are in the database
            const messages = db.getCodingMessages(session.id);
            expect(messages).toHaveLength(2);
            expect(messages[0].role).toBe('user');
            expect(messages[1].role).toBe('agent');
        });

        test('passes session plan_id as context', async () => {
            const plan = db.createPlan('TestPlan', '{}');
            const session = db.createCodingSession({ plan_id: plan.id, name: 'Test' });
            const req = mockReq('POST', { session_id: session.id, content: 'explain this' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/coding/process', db, orchestrator, config, mockCodingAgent);
            expect(mockCodingAgent.processCommand).toHaveBeenCalledWith(
                'explain this',
                expect.objectContaining({ plan_id: plan.id, session_id: session.id })
            );
        });

        test('handles agent errors gracefully', async () => {
            const failingAgent = {
                processCommand: jest.fn().mockRejectedValue(new Error('LLM timeout')),
            } as any;
            const session = db.createCodingSession({ name: 'Test' });
            const req = mockReq('POST', { session_id: session.id, content: 'build a button' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/coding/process', db, orchestrator, config, failingAgent);
            expect(res.writeHead).toHaveBeenCalledWith(500, expect.anything());
            const body = getJsonResponse(res);
            expect(body.error).toContain('LLM timeout');
            expect(body.error_message.role).toBe('system');
            expect(body.user_message.role).toBe('user');

            // User message should still be saved
            const messages = db.getCodingMessages(session.id);
            expect(messages.length).toBeGreaterThanOrEqual(2);
            expect(messages[0].role).toBe('user');
        });

        test('stores metadata in tool_calls JSON', async () => {
            const session = db.createCodingSession({ name: 'Test' });
            const req = mockReq('POST', { session_id: session.id, content: 'create a form' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/coding/process', db, orchestrator, config, mockCodingAgent);
            const body = getJsonResponse(res);
            const toolCalls = JSON.parse(body.agent_message.tool_calls);
            expect(toolCalls.confidence).toBe(85);
            expect(toolCalls.duration_ms).toBe(1500);
            expect(toolCalls.tokens_used).toBe(42);
            expect(toolCalls.files).toEqual(['hello.ts']);
            expect(toolCalls.requires_approval).toBe(false);
        });

        test('includes conversation history in context', async () => {
            const session = db.createCodingSession({ name: 'Test' });
            // Add some prior messages
            db.addCodingMessage({ session_id: session.id, role: 'user', content: 'hello' });
            db.addCodingMessage({ session_id: session.id, role: 'agent', content: 'hi there' });

            const req = mockReq('POST', { session_id: session.id, content: 'now build a button' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/coding/process', db, orchestrator, config, mockCodingAgent);

            const callArgs = mockCodingAgent.processCommand.mock.calls[0];
            expect(callArgs[1].constraints.conversation_history).toContain('[user]: hello');
            expect(callArgs[1].constraints.conversation_history).toContain('[agent]: hi there');
        });
    });
});
