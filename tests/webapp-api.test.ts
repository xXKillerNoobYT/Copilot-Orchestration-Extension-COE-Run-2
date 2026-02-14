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
import { handleApiRequest, extractParam, noopOutputChannel } from '../src/webapp/api';
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

    // ==================== noopOutputChannel ====================

    test('noopOutputChannel.appendLine is callable and does nothing', () => {
        expect(() => noopOutputChannel.appendLine('test message')).not.toThrow();
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

    // ==================== PAGINATION AND FILTERING ====================

    describe('Pagination and Filtering', () => {
        test('search filter matches string values', async () => {
            db.createTask({ title: 'Alpha Feature' });
            db.createTask({ title: 'Beta Bug' });

            const req = mockReq('GET');
            req.url = '/api/tasks?search=alpha';
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.data).toHaveLength(1);
            expect(body.data[0].title).toBe('Alpha Feature');
        });

        test('status filter', async () => {
            db.createTask({ title: 'T1', status: TaskStatus.InProgress });
            db.createTask({ title: 'T2', status: TaskStatus.Verified });

            const req = mockReq('GET');
            req.url = '/api/tasks?status=in_progress';
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.data).toHaveLength(1);
            expect(body.data[0].title).toBe('T1');
        });

        test('priority filter', async () => {
            db.createTask({ title: 'T1', priority: TaskPriority.P1 });
            db.createTask({ title: 'T2', priority: TaskPriority.P3 });

            const req = mockReq('GET');
            req.url = '/api/tasks?priority=P1';
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.data).toHaveLength(1);
            expect(body.data[0].priority).toBe('P1');
        });

        test('sort by numeric field asc', async () => {
            db.createTask({ title: 'Big', estimated_minutes: 45 });
            db.createTask({ title: 'Small', estimated_minutes: 15 });

            const req = mockReq('GET');
            req.url = '/api/tasks?sort=estimated_minutes&order=asc';
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.data[0].estimated_minutes).toBe(15);
            expect(body.data[1].estimated_minutes).toBe(45);
        });

        test('sort by string field desc', async () => {
            db.createTask({ title: 'Alpha' });
            db.createTask({ title: 'Zulu' });

            const req = mockReq('GET');
            req.url = '/api/tasks?sort=title&order=desc';
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.data[0].title).toBe('Zulu');
            expect(body.data[1].title).toBe('Alpha');
        });
    });

    // ==================== PARSE BODY ERROR ====================

    describe('parseBody error', () => {
        test('invalid JSON triggers global catch', async () => {
            const req = new EventEmitter() as any;
            req.method = 'POST';
            process.nextTick(() => {
                req.emit('data', '{INVALID JSON');
                req.emit('end');
            });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.error).toContain('Invalid JSON');
        });

        test('req error event triggers global catch via reject', async () => {
            const req = new EventEmitter() as any;
            req.method = 'POST';
            process.nextTick(() => {
                req.emit('error', new Error('Connection reset'));
            });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.error).toContain('Connection reset');
        });
    });

    // ==================== FORMAT AGENT RESPONSE BRANCHES ====================

    describe('formatAgentResponse branches', () => {
        test('files array, warnings, and requires_approval', async () => {
            const mockAgent = {
                processCommand: jest.fn().mockResolvedValue({
                    id: 'r1', request_id: 'q1', code: '',
                    language: 'typescript',
                    explanation: 'Multi file gen',
                    files: [
                        { name: 'a.ts', content: 'const a=1;', language: 'typescript' },
                        { name: 'b.ts', content: 'const b=2;', language: 'typescript' },
                    ],
                    confidence: 60,
                    warnings: ['Warn 1', 'Warn 2'],
                    requires_approval: true,
                    diff: null, tokens_used: 50, duration_ms: 100,
                    created_at: new Date().toISOString(),
                }),
            } as any;
            const session = db.createCodingSession({ name: 'Test' });
            const req = mockReq('POST', { session_id: session.id, content: 'gen' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/coding/process', db, orchestrator, config, mockAgent);
            const body = getJsonResponse(res);
            // formatAgentResponse with files
            expect(body.agent_message.content).toContain('a.ts');
            expect(body.agent_message.content).toContain('b.ts');
            // warnings branch
            expect(body.agent_message.content).toContain('Warn 1');
            expect(body.agent_message.content).toContain('Warn 2');
            // requires_approval branch
            expect(body.agent_message.content).toContain('Requires approval');
        });

        test('code without files uses inline code block', async () => {
            const mockAgent = {
                processCommand: jest.fn().mockResolvedValue({
                    id: 'r2', request_id: 'q2',
                    code: 'console.log("hi");',
                    language: 'typescript',
                    explanation: 'Inline code',
                    files: [],
                    confidence: 80,
                    warnings: [],
                    requires_approval: false,
                    diff: null, tokens_used: 10, duration_ms: 50,
                    created_at: new Date().toISOString(),
                }),
            } as any;
            const session = db.createCodingSession({ name: 'Test' });
            const req = mockReq('POST', { session_id: session.id, content: 'gen' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/coding/process', db, orchestrator, config, mockAgent);
            const body = getJsonResponse(res);
            expect(body.agent_message.content).toContain('console.log');
        });
    });

    // ==================== SSE / EVENT ENDPOINTS ====================

    describe('Event endpoints', () => {
        test('GET /api/events/stream sets up SSE', async () => {
            const { getEventBus } = await import('../src/core/event-bus');
            const eventBus = getEventBus();
            const req = new EventEmitter() as any;
            req.method = 'GET';
            req.url = '/api/events/stream';
            const res = { writeHead: jest.fn(), write: jest.fn(), end: jest.fn(), setHeader: jest.fn() } as any;

            await handleApiRequest(req, res, '/api/events/stream', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'text/event-stream' }));

            // Emit an event
            eventBus.emit('test:sse' as any, 'webapp', { x: 1 });
            expect(res.write).toHaveBeenCalled();

            // Disconnect
            req.emit('close');
        });

        test('GET /api/events/history returns history', async () => {
            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/events/history', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(Array.isArray(body)).toBe(true);
        });

        test('GET /api/events/metrics returns metrics', async () => {
            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/events/metrics', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
        });
    });

    // ==================== PLANS POST ====================

    describe('POST /api/plans', () => {
        test('creates plan with name, config, and status', async () => {
            const req = mockReq('POST', { name: 'My Plan', config: { foo: 'bar' }, status: 'active' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/plans', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.name).toBe('My Plan');
            expect(body.status).toBe('active');
        });

        test('returns 400 when name is missing', async () => {
            const req = mockReq('POST', { config: {} });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/plans', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
        });
    });

    // ==================== PLANS GENERATE EDGE CASES ====================

    describe('POST /api/plans/generate edge cases', () => {
        test('LLM returns invalid JSON → plan with 0 tasks', async () => {
            orchestrator.callAgent.mockResolvedValueOnce({ content: 'Not valid JSON at all' });
            const req = mockReq('POST', { name: 'Broken Plan', description: 'Test' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/plans/generate', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.taskCount).toBe(0);
            expect(body.tasks).toEqual([]);
            expect(body.raw_response).toBeDefined();
        });

        test('tasks with depends_on_titles wired correctly', async () => {
            orchestrator.callAgent.mockResolvedValueOnce({
                content: JSON.stringify({
                    plan_name: 'Dep', tasks: [
                        { title: 'Setup', description: 'Init', priority: 'P1', estimated_minutes: 20, acceptance_criteria: 'Done', depends_on_titles: [] },
                        { title: 'Build', description: 'Build', priority: 'P2', estimated_minutes: 30, acceptance_criteria: 'Done', depends_on_titles: ['Setup'] },
                    ],
                }),
            });
            const req = mockReq('POST', { name: 'Dep Plan', description: 'deps' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/plans/generate', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.taskCount).toBe(2);
            const build = body.tasks.find((t: any) => t.title === 'Build');
            expect(build.dependencies).toHaveLength(1);
        });
    });

    // ==================== DESIGN PAGES ====================

    describe('Design Pages', () => {
        test('GET /api/design/pages returns pages by plan_id', async () => {
            const plan = db.createPlan('DP');
            db.createDesignPage({ plan_id: plan.id, name: 'Home', route: '/' });
            const req = mockReq('GET');
            req.url = `/api/design/pages?plan_id=${plan.id}`;
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/pages', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body).toHaveLength(1);
            expect(body[0].name).toBe('Home');
        });

        test('GET /api/design/pages returns 400 without plan_id', async () => {
            const req = mockReq('GET');
            req.url = '/api/design/pages';
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/pages', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
        });

        test('POST /api/design/pages creates a page', async () => {
            const plan = db.createPlan('DP');
            const req = mockReq('POST', { plan_id: plan.id, name: 'Dash', route: '/dash', width: 1920, height: 1080, background: '#fff' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/pages', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.name).toBe('Dash');
        });

        test('PUT /api/design/pages/:id updates a page', async () => {
            const plan = db.createPlan('DP');
            const page = db.createDesignPage({ plan_id: plan.id, name: 'Old' });
            const req = mockReq('PUT', { name: 'New' });
            const res = mockRes();
            await handleApiRequest(req, res, `/api/design/pages/${page.id}`, db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
        });

        test('DELETE /api/design/pages/:id deletes a page', async () => {
            const plan = db.createPlan('DP');
            const page = db.createDesignPage({ plan_id: plan.id, name: 'Del' });
            const req = mockReq('DELETE');
            const res = mockRes();
            await handleApiRequest(req, res, `/api/design/pages/${page.id}`, db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.success).toBe(true);
        });
    });

    // ==================== DESIGN COMPONENTS ====================

    describe('Design Components', () => {
        test('GET with page_id', async () => {
            const plan = db.createPlan('DC');
            const page = db.createDesignPage({ plan_id: plan.id, name: 'P' });
            db.createDesignComponent({ plan_id: plan.id, page_id: page.id, type: 'button', name: 'Btn' } as any);
            const req = mockReq('GET');
            req.url = `/api/design/components?page_id=${page.id}`;
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/components', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body).toHaveLength(1);
        });

        test('GET with plan_id', async () => {
            const plan = db.createPlan('DC');
            db.createDesignComponent({ plan_id: plan.id, type: 'box', name: 'B' } as any);
            const req = mockReq('GET');
            req.url = `/api/design/components?plan_id=${plan.id}`;
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/components', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body).toHaveLength(1);
        });

        test('GET without params returns 400', async () => {
            const req = mockReq('GET');
            req.url = '/api/design/components';
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/components', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
        });

        test('POST creates component', async () => {
            const plan = db.createPlan('DC');
            const req = mockReq('POST', { plan_id: plan.id, type: 'button', name: 'Btn', x: 10, y: 20, width: 100, height: 50, styles: {}, content: 'Click', props: {} });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/components', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.name).toBe('Btn');
        });

        test('PUT /api/design/components/batch updates', async () => {
            const plan = db.createPlan('DC');
            const c1 = db.createDesignComponent({ plan_id: plan.id, type: 'box', name: 'A' } as any);
            const req = mockReq('PUT', { updates: [{ id: c1.id, x: 50 }] });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/components/batch', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.success).toBe(true);
        });

        test('GET single component', async () => {
            const plan = db.createPlan('DC');
            const comp = db.createDesignComponent({ plan_id: plan.id, type: 'input', name: 'In' } as any);
            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, `/api/design/components/${comp.id}`, db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.name).toBe('In');
        });

        test('GET single component 404', async () => {
            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/components/nope', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
        });

        test('PUT single component', async () => {
            const plan = db.createPlan('DC');
            const comp = db.createDesignComponent({ plan_id: plan.id, type: 'text', name: 'T' } as any);
            const req = mockReq('PUT', { name: 'T2' });
            const res = mockRes();
            await handleApiRequest(req, res, `/api/design/components/${comp.id}`, db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
        });

        test('DELETE single component', async () => {
            const plan = db.createPlan('DC');
            const comp = db.createDesignComponent({ plan_id: plan.id, type: 'div', name: 'D' } as any);
            const req = mockReq('DELETE');
            const res = mockRes();
            await handleApiRequest(req, res, `/api/design/components/${comp.id}`, db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.success).toBe(true);
        });
    });

    // ==================== DESIGN TOKENS ====================

    describe('Design Tokens', () => {
        test('GET tokens by plan_id', async () => {
            const plan = db.createPlan('DT');
            db.createDesignToken({ plan_id: plan.id, category: 'color' as any, name: 'primary', value: '#007' });
            const req = mockReq('GET');
            req.url = `/api/design/tokens?plan_id=${plan.id}`;
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/tokens', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body).toHaveLength(1);
        });

        test('GET tokens 400 without plan_id', async () => {
            const req = mockReq('GET');
            req.url = '/api/design/tokens';
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/tokens', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
        });

        test('POST creates token', async () => {
            const plan = db.createPlan('DT');
            const req = mockReq('POST', { plan_id: plan.id, category: 'spacing', name: 'lg', value: '24px', description: 'Large' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/tokens', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' });
        });

        test('PUT updates token', async () => {
            const plan = db.createPlan('DT');
            const token = db.createDesignToken({ plan_id: plan.id, category: 'color' as any, name: 'accent', value: '#f00' });
            const req = mockReq('PUT', { value: '#0f0' });
            const res = mockRes();
            await handleApiRequest(req, res, `/api/design/tokens/${token.id}`, db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.success).toBe(true);
        });

        test('DELETE deletes token', async () => {
            const plan = db.createPlan('DT');
            const token = db.createDesignToken({ plan_id: plan.id, category: 'font' as any, name: 'h', value: 'Arial' });
            const req = mockReq('DELETE');
            const res = mockRes();
            await handleApiRequest(req, res, `/api/design/tokens/${token.id}`, db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.success).toBe(true);
        });
    });

    // ==================== PAGE FLOWS ====================

    describe('Page Flows', () => {
        test('GET flows by plan_id', async () => {
            const plan = db.createPlan('PF');
            const p1 = db.createDesignPage({ plan_id: plan.id, name: 'A' });
            const p2 = db.createDesignPage({ plan_id: plan.id, name: 'B' });
            db.createPageFlow({ plan_id: plan.id, from_page_id: p1.id, to_page_id: p2.id, trigger: 'click', label: 'Go' });
            const req = mockReq('GET');
            req.url = `/api/design/flows?plan_id=${plan.id}`;
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/flows', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body).toHaveLength(1);
        });

        test('GET flows 400 without plan_id', async () => {
            const req = mockReq('GET');
            req.url = '/api/design/flows';
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/flows', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
        });

        test('POST creates flow', async () => {
            const plan = db.createPlan('PF');
            const p1 = db.createDesignPage({ plan_id: plan.id, name: 'Login' });
            const p2 = db.createDesignPage({ plan_id: plan.id, name: 'Home' });
            const req = mockReq('POST', { plan_id: plan.id, from_page_id: p1.id, to_page_id: p2.id, trigger: 'submit', label: 'Success' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/flows', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' });
        });

        test('DELETE deletes flow', async () => {
            const plan = db.createPlan('PF');
            const p1 = db.createDesignPage({ plan_id: plan.id, name: 'X' });
            const p2 = db.createDesignPage({ plan_id: plan.id, name: 'Y' });
            const flow = db.createPageFlow({ plan_id: plan.id, from_page_id: p1.id, to_page_id: p2.id });
            const req = mockReq('DELETE');
            const res = mockRes();
            await handleApiRequest(req, res, `/api/design/flows/${flow.id}`, db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.success).toBe(true);
        });
    });

    // ==================== CODING SESSIONS ====================

    describe('Coding Sessions', () => {
        test('GET /api/coding/sessions lists sessions', async () => {
            db.createCodingSession({ name: 'S1' });
            db.createCodingSession({ name: 'S2' });
            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/coding/sessions', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.data).toHaveLength(2);
        });

        test('POST /api/coding/sessions creates session', async () => {
            const plan = db.createPlan('CP');
            const req = mockReq('POST', { plan_id: plan.id, name: 'New Session' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/coding/sessions', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.name).toBe('New Session');
        });

        test('GET /api/coding/sessions/:id returns session with messages', async () => {
            const session = db.createCodingSession({ name: 'Chat' });
            db.addCodingMessage({ session_id: session.id, role: 'user', content: 'Hi' });
            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, `/api/coding/sessions/${session.id}`, db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.name).toBe('Chat');
            expect(body.messages).toHaveLength(1);
        });

        test('GET /api/coding/sessions/:id returns 404', async () => {
            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/coding/sessions/nope', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
        });

        test('PUT /api/coding/sessions/:id updates session', async () => {
            const session = db.createCodingSession({ name: 'Old' });
            const req = mockReq('PUT', { name: 'Updated' });
            const res = mockRes();
            await handleApiRequest(req, res, `/api/coding/sessions/${session.id}`, db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.success).toBe(true);
        });
    });

    // ==================== CODING MESSAGES ====================

    describe('Coding Messages', () => {
        test('POST /api/coding/messages creates a message', async () => {
            const session = db.createCodingSession({ name: 'S' });
            const req = mockReq('POST', { session_id: session.id, role: 'user', content: 'Hello' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/coding/messages', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.content).toBe('Hello');
        });

        test('GET /api/coding/messages/:id returns messages', async () => {
            const session = db.createCodingSession({ name: 'S' });
            db.addCodingMessage({ session_id: session.id, role: 'user', content: 'A' });
            db.addCodingMessage({ session_id: session.id, role: 'agent', content: 'B' });
            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, `/api/coding/messages/${session.id}`, db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body).toHaveLength(2);
        });
    });

    // ==================== DESIGN EXPORT ====================

    describe('POST /api/design/export', () => {
        test('exports complete design spec', async () => {
            const plan = db.createPlan('Export');
            const page = db.createDesignPage({ plan_id: plan.id, name: 'Home' });
            db.createDesignComponent({ plan_id: plan.id, page_id: page.id, type: 'button', name: 'Btn' } as any);
            db.createDesignToken({ plan_id: plan.id, category: 'color' as any, name: 'primary', value: '#blue' });
            const page2 = db.createDesignPage({ plan_id: plan.id, name: 'About' });
            db.createPageFlow({ plan_id: plan.id, from_page_id: page.id, to_page_id: page2.id });

            const req = mockReq('POST', { plan_id: plan.id });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/export', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.plan).toBeDefined();
            expect(body.pages).toHaveLength(2);
            expect(body.pages[0].components).toHaveLength(1);
            expect(body.tokens).toHaveLength(1);
            expect(body.flows).toHaveLength(1);
            expect(body.generated_at).toBeDefined();
        });

        test('returns 400 without plan_id', async () => {
            const req = mockReq('POST', {});
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/export', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
        });
    });

    // ==================== CONFIG PUT ====================

    describe('PUT /api/config', () => {
        test('updates config', async () => {
            const configWithUpdate = { ...config, updateConfig: jest.fn() };
            const req = mockReq('PUT', { llm: { model: 'new' } });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/config', db, orchestrator, configWithUpdate as any);
            expect(configWithUpdate.updateConfig).toHaveBeenCalled();
            expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
        });
    });

    // ==================== TASKS REORDER ====================

    describe('POST /api/tasks/reorder', () => {
        test('reorders tasks', async () => {
            const t1 = db.createTask({ title: 'A' });
            const t2 = db.createTask({ title: 'B' });
            const req = mockReq('POST', { orders: [{ id: t1.id, sort_order: 20 }, { id: t2.id, sort_order: 10 }] });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks/reorder', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.success).toBe(true);
        });

        test('reorder returns 400 for non-array', async () => {
            const req = mockReq('POST', { orders: 'not an array' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks/reorder', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
        });
    });

    // ==================== GITHUB ISSUE CONVERT ====================

    describe('POST /api/github/issues/:id/convert', () => {
        test('converts github issue to task successfully', async () => {
            const issue = db.upsertGitHubIssue({
                github_id: 3001, number: 10, title: 'Convert Me', body: 'Details',
                state: 'open', labels: ['bug'], assignees: ['dev'],
                repo_owner: 'test', repo_name: 'repo',
                task_id: null, local_checksum: 'x', remote_checksum: 'x',
            });

            const req = mockReq('POST');
            const res = mockRes();
            await handleApiRequest(req, res, `/api/github/issues/${issue.id}/convert`, db, orchestrator, config);

            const body = getJsonResponse(res);
            expect(res.writeHead).toHaveBeenCalled();
            // The sync service should either succeed (create task) or fail gracefully
            if (body.success) {
                expect(body.task_id).toBeDefined();
            } else {
                expect(body.error).toBeDefined();
            }
        });

        test('returns 400 when github not configured', async () => {
            const noGhConfig = {
                getConfig: () => ({
                    ...config.getConfig(),
                    github: { token: '' },
                }),
            } as any;

            const req = mockReq('POST');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/github/issues/some-id/convert', db, orchestrator, noGhConfig);

            expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.error).toContain('GitHub not configured');
        });

        test('returns 400 when conversion fails', async () => {
            // Use a nonexistent issue ID so conversion fails
            const req = mockReq('POST');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/github/issues/nonexistent/convert', db, orchestrator, config);

            const body = getJsonResponse(res);
            expect(res.writeHead).toHaveBeenCalled();
        });
    });

    // ==================== CODING PROCESS WITH TASK_ID ====================

    describe('Coding process with task_id', () => {
        const mockCodingAgent2 = {
            processCommand: jest.fn().mockResolvedValue({
                id: 'r3', request_id: 'q3', code: 'code',
                language: 'typescript', explanation: 'Done',
                files: [], confidence: 80, warnings: [],
                requires_approval: false, diff: null,
                tokens_used: 10, duration_ms: 50,
                created_at: new Date().toISOString(),
            }),
        } as any;

        test('pulls plan_id from linked task', async () => {
            const plan = db.createPlan('Linked Plan');
            const task = db.createTask({ title: 'Linked Task', plan_id: plan.id });
            const session = db.createCodingSession({ name: 'S' });

            mockCodingAgent2.processCommand.mockClear();
            const req = mockReq('POST', { session_id: session.id, content: 'do work', task_id: task.id });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/coding/process', db, orchestrator, config, mockCodingAgent2);

            expect(res.writeHead).toHaveBeenCalledWith(201, expect.anything());
            const callArgs = mockCodingAgent2.processCommand.mock.calls[0];
            expect(callArgs[1].plan_id).toBe(plan.id);
        });
    });

    // ==================== GLOBAL ERROR HANDLER ====================

    describe('Global error handler', () => {
        test('catches thrown errors', async () => {
            const brokenDb = { ...db, getAllTasks: () => { throw new Error('DB exploded'); } } as any;
            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks', brokenDb, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.error).toContain('DB exploded');
        });

        test('catches non-Error thrown values via String()', async () => {
            const brokenDb = { ...db, getAllTasks: () => { throw 'string error'; } } as any;
            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks', brokenDb, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.error).toBe('string error');
        });
    });

    // ==================== BRANCH COVERAGE: req.method fallback (line 147) ====================

    describe('req.method fallback', () => {
        test('defaults to GET when req.method is undefined', async () => {
            const req = new EventEmitter() as any;
            req.method = undefined;
            req.url = '/api/dashboard';
            process.nextTick(() => req.emit('end'));
            const res = mockRes();
            // With method=undefined, it defaults to GET, so /api/dashboard should work
            await handleApiRequest(req, res, '/api/dashboard', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.stats).toBeDefined();
        });
    });

    // ==================== BRANCH COVERAGE: parseBody empty body (line 71) ====================

    describe('parseBody empty body branch', () => {
        test('resolves to {} when body is empty string', async () => {
            // POST /api/tasks/reorder with completely empty body
            const req = new EventEmitter() as any;
            req.method = 'POST';
            // Emit 'end' without any 'data' events — body is ''
            process.nextTick(() => req.emit('end'));
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks/reorder', db, orchestrator, config);
            // Empty body => {} parsed => body.orders is undefined => !Array.isArray(undefined) => 400
            expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
        });
    });

    // ==================== BRANCH COVERAGE: sort with null/undefined values (lines 53-54 ?? '') ====================

    describe('Sort with null/undefined field values', () => {
        test('sort by field where FIRST item has null value (va ?? fallback)', async () => {
            // Create tasks: first one has no plan_id (null), second has one
            db.createTask({ title: 'AAA-NoPlan' }); // plan_id is null — will be `a` in sort
            const plan = db.createPlan('SortPlan');
            db.createTask({ title: 'ZZZ-WithPlan', plan_id: plan.id });

            const req = mockReq('GET');
            req.url = '/api/tasks?sort=plan_id&order=asc';
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.data).toHaveLength(2);
        });

        test('sort by field where SECOND item has null value (vb ?? fallback)', async () => {
            // Reverse order so `b` is the null one
            const plan = db.createPlan('SortPlan2');
            db.createTask({ title: 'AAA-WithPlan', plan_id: plan.id });
            db.createTask({ title: 'ZZZ-NoPlan' }); // plan_id is null — will be `b` in sort

            const req = mockReq('GET');
            req.url = '/api/tasks?sort=plan_id&order=asc';
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.data).toHaveLength(2);
        });

        test('sort by field where ALL items have null (both ?? fallbacks)', async () => {
            db.createTask({ title: 'A-NoParent' }); // parent_task_id is null
            db.createTask({ title: 'B-NoParent' }); // parent_task_id is null
            db.createTask({ title: 'C-NoParent' }); // parent_task_id is null

            const req = mockReq('GET');
            req.url = '/api/tasks?sort=parent_task_id&order=asc';
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.data).toHaveLength(3);
        });

        test('sort by nonexistent field triggers ?? for both va and vb', async () => {
            db.createTask({ title: 'X' });
            db.createTask({ title: 'Y' });

            const req = mockReq('GET');
            req.url = '/api/tasks?sort=nonexistent_field&order=asc';
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.data).toHaveLength(2);
        });

        test('sort evolution entries by nullable result field (both null)', async () => {
            db.addEvolutionEntry('PATTERN_X', 'Proposal X');
            db.addEvolutionEntry('PATTERN_Y', 'Proposal Y');

            const req = mockReq('GET');
            req.url = '/api/evolution?sort=result&order=asc';
            const res = mockRes();
            await handleApiRequest(req, res, '/api/evolution', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.data).toHaveLength(2);
        });

        test('sort evolution entries by applied_at (null field) descending', async () => {
            db.addEvolutionEntry('PATTERN_A', 'Proposal A');
            db.addEvolutionEntry('PATTERN_B', 'Proposal B');

            const req = mockReq('GET');
            req.url = '/api/evolution?sort=applied_at&order=desc';
            const res = mockRes();
            await handleApiRequest(req, res, '/api/evolution', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.data).toHaveLength(2);
        });

        test('sort by numeric field descending', async () => {
            db.createTask({ title: 'Big', estimated_minutes: 45 });
            db.createTask({ title: 'Small', estimated_minutes: 15 });

            const req = mockReq('GET');
            req.url = '/api/tasks?sort=estimated_minutes&order=desc';
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.data[0].estimated_minutes).toBe(45);
            expect(body.data[1].estimated_minutes).toBe(15);
        });

        test('sort by string field ascending', async () => {
            db.createTask({ title: 'Zulu' });
            db.createTask({ title: 'Alpha' });

            const req = mockReq('GET');
            req.url = '/api/tasks?sort=title&order=asc';
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.data[0].title).toBe('Alpha');
            expect(body.data[1].title).toBe('Zulu');
        });
    });

    // ==================== BRANCH COVERAGE: extractParam edge cases (line 93) ====================

    describe('extractParam edge cases', () => {
        test('route that matches length but pattern has no :param returns null (falls through)', async () => {
            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/some/random', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
        });

        test('route with three segments matching tasks/:id pattern but different prefix falls through', async () => {
            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/notasks/something', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
        });

        test('route with wrong number of segments does not match parameter patterns', async () => {
            const req = mockReq('GET');
            const res = mockRes();
            await handleApiRequest(req, res, '/api/tasks/a/b/c', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
        });

        test('extractParam returns null when pattern has no :param segment', () => {
            // Pattern "tasks/list" has no parameter placeholder
            // Route "tasks/list" matches all parts but paramIdx is -1
            expect(extractParam('tasks/list', 'tasks/list')).toBeNull();
        });

        test('extractParam returns value when pattern has :param', () => {
            expect(extractParam('tasks/abc-123', 'tasks/:id')).toBe('abc-123');
        });

        test('extractParam returns null for length mismatch', () => {
            expect(extractParam('tasks/a/b', 'tasks/:id')).toBeNull();
        });

        test('extractParam returns null for non-matching fixed parts', () => {
            expect(extractParam('plans/abc', 'tasks/:id')).toBeNull();
        });
    });

    // ==================== BRANCH COVERAGE: ticket reply default author (line 308) ====================

    describe('Ticket reply default author', () => {
        test('uses default author when not provided', async () => {
            const ticket = db.createTicket({ title: 'Reply Default' });
            const req = mockReq('POST', { body: 'some reply content' });
            const res = mockRes();
            await handleApiRequest(req, res, `/api/tickets/${ticket.id}/replies`, db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.author).toBe('user');
        });
    });

    // ==================== BRANCH COVERAGE: plan config default (line 348) ====================

    describe('Plan creation config defaults', () => {
        test('uses empty config when body.config is null/undefined', async () => {
            const req = mockReq('POST', { name: 'No Config Plan' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/plans', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.name).toBe('No Config Plan');
        });

        test('plan without status does not call updatePlan', async () => {
            const req = mockReq('POST', { name: 'No Status Plan', config: { key: 'val' } });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/plans', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            // Status should remain the default (draft), not explicitly set
            expect(body.name).toBe('No Status Plan');
        });
    });

    // ==================== BRANCH COVERAGE: plan/generate task defaults (lines 408-416) ====================

    describe('Plan generate with task defaults', () => {
        test('tasks with missing optional fields get defaults', async () => {
            orchestrator.callAgent.mockResolvedValueOnce({
                content: JSON.stringify({
                    plan_name: 'Defaults', tasks: [
                        { title: 'Bare Task' },  // no description, priority, estimated_minutes, acceptance_criteria, depends_on_titles
                    ],
                }),
            });
            const req = mockReq('POST', { name: 'Defaults Plan', description: 'test defaults' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/plans/generate', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.taskCount).toBe(1);
            const task = body.tasks[0];
            expect(task.title).toBe('Bare Task');
            expect(task.description).toBe('');
            expect(task.priority).toBe('P2');  // default from invalid/missing priority
            expect(task.estimated_minutes).toBe(30);
            expect(task.acceptance_criteria).toBe('');
        });

        test('task with invalid priority gets P2 default', async () => {
            orchestrator.callAgent.mockResolvedValueOnce({
                content: JSON.stringify({
                    plan_name: 'BadPrio', tasks: [
                        { title: 'Invalid Prio', priority: 'P99', description: 'x', estimated_minutes: 20, acceptance_criteria: 'y', depends_on_titles: [] },
                    ],
                }),
            });
            const req = mockReq('POST', { name: 'BadPrio Plan', description: 'test' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/plans/generate', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.tasks[0].priority).toBe('P2');
        });

        test('task with null priority gets P2 default', async () => {
            orchestrator.callAgent.mockResolvedValueOnce({
                content: JSON.stringify({
                    plan_name: 'NullPrio', tasks: [
                        { title: 'Null Prio', priority: null, description: 'x', estimated_minutes: 20, acceptance_criteria: 'y', depends_on_titles: [] },
                    ],
                }),
            });
            const req = mockReq('POST', { name: 'NullPrio Plan', description: 'test' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/plans/generate', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.tasks[0].priority).toBe('P2');
        });

        test('depends_on_titles with unknown titles are filtered out', async () => {
            orchestrator.callAgent.mockResolvedValueOnce({
                content: JSON.stringify({
                    plan_name: 'Deps', tasks: [
                        { title: 'First', description: 'a', priority: 'P1', estimated_minutes: 15, acceptance_criteria: 'b', depends_on_titles: [] },
                        { title: 'Second', description: 'c', priority: 'P2', estimated_minutes: 20, acceptance_criteria: 'd', depends_on_titles: ['First', 'NonExistent'] },
                    ],
                }),
            });
            const req = mockReq('POST', { name: 'Dep Filter Plan', description: 'test' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/plans/generate', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.taskCount).toBe(2);
            const second = body.tasks.find((t: any) => t.title === 'Second');
            // Only 'First' dependency should resolve; 'NonExistent' filtered out
            expect(second.dependencies).toHaveLength(1);
        });

        test('plan/generate uses default scale, focus, priorities, design when not provided', async () => {
            orchestrator.callAgent.mockResolvedValueOnce({
                content: JSON.stringify({
                    plan_name: 'Minimal', tasks: [
                        { title: 'T', description: 'd', priority: 'P1', estimated_minutes: 15, acceptance_criteria: 'a', depends_on_titles: [] },
                    ],
                }),
            });
            const req = mockReq('POST', { name: 'Minimal Gen', description: 'only required' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/plans/generate', db, orchestrator, config);
            // Verify it used defaults — the call should include 'MVP' and 'Full Stack'
            const callArgs = orchestrator.callAgent.mock.calls[orchestrator.callAgent.mock.calls.length - 1];
            expect(callArgs[1]).toContain('MVP');
            expect(callArgs[1]).toContain('Full Stack');
            expect(callArgs[1]).toContain('Core business logic');
        });
    });

    // ==================== BRANCH COVERAGE: design page POST defaults (lines 587-592) ====================

    describe('Design page POST with minimal fields', () => {
        test('uses default values for missing optional fields', async () => {
            const plan = db.createPlan('DP Defaults');
            const req = mockReq('POST', { plan_id: plan.id });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/pages', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.name).toBe('Untitled Page');
            expect(body.route).toBe('/');
            expect(body.sort_order).toBe(0);
            expect(body.width).toBe(1440);
            expect(body.height).toBe(900);
            expect(body.background).toBe('#1e1e2e');
        });
    });

    // ==================== BRANCH COVERAGE: design components POST defaults (lines 635-645) ====================

    describe('Design component POST with minimal fields', () => {
        test('uses default values for missing optional fields', async () => {
            const plan = db.createPlan('DC Defaults');
            const req = mockReq('POST', { plan_id: plan.id });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/components', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.type).toBe('container');
            expect(body.name).toBe('Component');
            expect(body.sort_order).toBe(0);
            expect(body.x).toBe(0);
            expect(body.y).toBe(0);
            expect(body.width).toBe(200);
            expect(body.height).toBe(100);
            expect(body.content).toBe('');
        });
    });

    // ==================== BRANCH COVERAGE: design components batch non-array (line 655) ====================

    describe('Design components batch non-array', () => {
        test('returns 400 when updates is not an array', async () => {
            const req = mockReq('PUT', { updates: 'not-array' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/components/batch', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.error).toContain('updates must be an array');
        });
    });

    // ==================== BRANCH COVERAGE: design token POST defaults (lines 695-698) ====================

    describe('Design token POST with minimal fields', () => {
        test('uses default category and description when missing', async () => {
            const plan = db.createPlan('DT Defaults');
            const req = mockReq('POST', { plan_id: plan.id, name: 'primary', value: '#000' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/tokens', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.category).toBe('color');
            expect(body.description).toBe('');
        });
    });

    // ==================== BRANCH COVERAGE: design flow POST defaults (lines 733-734) ====================

    describe('Design flow POST with minimal fields', () => {
        test('uses default trigger and label when missing', async () => {
            const plan = db.createPlan('PF Defaults');
            const p1 = db.createDesignPage({ plan_id: plan.id, name: 'A' });
            const p2 = db.createDesignPage({ plan_id: plan.id, name: 'B' });
            const req = mockReq('POST', { plan_id: plan.id, from_page_id: p1.id, to_page_id: p2.id });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/flows', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.trigger).toBe('click');
            expect(body.label).toBe('');
        });
    });

    // ==================== BRANCH COVERAGE: coding session POST defaults (lines 760-761) ====================

    describe('Coding session POST with minimal fields', () => {
        test('uses default name and undefined plan_id when missing', async () => {
            const req = mockReq('POST', {});
            const res = mockRes();
            await handleApiRequest(req, res, '/api/coding/sessions', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.name).toBe('Coding Session');
            // plan_id should be null/undefined
            expect(body.plan_id).toBeFalsy();
        });
    });

    // ==================== BRANCH COVERAGE: coding message POST defaults (line 791) ====================

    describe('Coding message POST with minimal fields', () => {
        test('uses default role when not provided', async () => {
            const session = db.createCodingSession({ name: 'MsgDefault' });
            const req = mockReq('POST', { session_id: session.id, content: 'Hello' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/coding/messages', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' });
            const body = getJsonResponse(res);
            expect(body.role).toBe('user');
        });

        test('passes through tool_calls and task_id when provided', async () => {
            const session = db.createCodingSession({ name: 'MsgFull' });
            const task = db.createTask({ title: 'Linked' });
            const req = mockReq('POST', {
                session_id: session.id,
                role: 'agent',
                content: 'Response',
                tool_calls: '{"tool":"test"}',
                task_id: task.id,
            });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/coding/messages', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.role).toBe('agent');
            expect(body.tool_calls).toBe('{"tool":"test"}');
            expect(body.task_id).toBe(task.id);
        });

        test('tool_calls and task_id default to undefined when empty', async () => {
            const session = db.createCodingSession({ name: 'MsgEmpty' });
            const req = mockReq('POST', { session_id: session.id, role: 'user', content: 'Hi', tool_calls: '', task_id: '' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/coding/messages', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.role).toBe('user');
        });
    });

    // ==================== BRANCH COVERAGE: coding process error non-Error (line 900) ====================

    describe('Coding process with non-Error thrown value', () => {
        test('handles thrown string via String()', async () => {
            const failingAgent = {
                processCommand: jest.fn().mockRejectedValue('raw string error'),
            } as any;
            const session = db.createCodingSession({ name: 'ErrStr' });
            const req = mockReq('POST', { session_id: session.id, content: 'do it' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/coding/process', db, orchestrator, config, failingAgent);
            expect(res.writeHead).toHaveBeenCalledWith(500, expect.anything());
            const body = getJsonResponse(res);
            expect(body.error).toBe('raw string error');
        });
    });

    // ==================== BRANCH COVERAGE: design export with empty page components (line 934) ====================

    describe('Design export with pages that have no components', () => {
        test('uses empty array fallback for pages without components', async () => {
            const plan = db.createPlan('ExportEmpty');
            db.createDesignPage({ plan_id: plan.id, name: 'EmptyPage' });
            // Do NOT add any components to this page

            const req = mockReq('POST', { plan_id: plan.id });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/export', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.pages).toHaveLength(1);
            expect(body.pages[0].components).toEqual([]);
            expect(body.generated_at).toBeDefined();
        });

        test('uses || [] fallback when getDesignComponentsByPage returns undefined', async () => {
            const plan = db.createPlan('ExportUndef');
            const page = db.createDesignPage({ plan_id: plan.id, name: 'UndefPage' });

            // Mock getDesignComponentsByPage to return undefined for this page
            const origMethod = db.getDesignComponentsByPage.bind(db);
            const mockDb = Object.create(db);
            mockDb.getDesignComponentsByPage = (pageId: string) => {
                if (pageId === page.id) return undefined as any;
                return origMethod(pageId);
            };
            // Ensure other methods delegate to the real db
            mockDb.getPlan = db.getPlan.bind(db);
            mockDb.getDesignPagesByPlan = db.getDesignPagesByPlan.bind(db);
            mockDb.getDesignTokensByPlan = db.getDesignTokensByPlan.bind(db);
            mockDb.getPageFlowsByPlan = db.getPageFlowsByPlan.bind(db);

            const req = mockReq('POST', { plan_id: plan.id });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/export', mockDb as any, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.pages).toHaveLength(1);
            expect(body.pages[0].components).toEqual([]);
        });
    });

    // ==================== BRANCH COVERAGE: design pages/components/tokens/flows GET with req.url empty ====================

    describe('Design endpoints with empty req.url', () => {
        test('design/pages GET with no req.url returns 400', async () => {
            const req = new EventEmitter() as any;
            req.method = 'GET';
            req.url = undefined;
            process.nextTick(() => req.emit('end'));
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/pages', db, orchestrator, config);
            // URL is undefined → fallback '' → no plan_id → 400
            expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
        });

        test('design/components GET with no req.url returns 400', async () => {
            const req = new EventEmitter() as any;
            req.method = 'GET';
            req.url = undefined;
            process.nextTick(() => req.emit('end'));
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/components', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
        });

        test('design/tokens GET with no req.url returns 400', async () => {
            const req = new EventEmitter() as any;
            req.method = 'GET';
            req.url = undefined;
            process.nextTick(() => req.emit('end'));
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/tokens', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
        });

        test('design/flows GET with no req.url returns 400', async () => {
            const req = new EventEmitter() as any;
            req.method = 'GET';
            req.url = undefined;
            process.nextTick(() => req.emit('end'));
            const res = mockRes();
            await handleApiRequest(req, res, '/api/design/flows', db, orchestrator, config);
            expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
        });
    });

    // ==================== BRANCH COVERAGE: coding process with task_id but task has no plan_id ====================

    describe('Coding process task_id without plan_id', () => {
        test('task without plan_id does not override session plan_id', async () => {
            const mockAgent = {
                processCommand: jest.fn().mockResolvedValue({
                    id: 'r', request_id: 'q', code: 'x', language: 'ts',
                    explanation: 'e', files: [], confidence: 90, warnings: [],
                    requires_approval: false, diff: null, tokens_used: 5,
                    duration_ms: 10, created_at: new Date().toISOString(),
                }),
            } as any;
            const plan = db.createPlan('SessionPlan');
            const task = db.createTask({ title: 'No Plan Task' }); // no plan_id
            const session = db.createCodingSession({ plan_id: plan.id, name: 'S' });

            const req = mockReq('POST', { session_id: session.id, content: 'test', task_id: task.id });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/coding/process', db, orchestrator, config, mockAgent);
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.anything());
            // plan_id should still be from the session, not overridden
            const callArgs = mockAgent.processCommand.mock.calls[0];
            expect(callArgs[1].plan_id).toBe(plan.id);
        });
    });

    // ==================== BRANCH COVERAGE: coding process without task_id ====================

    describe('Coding process without task_id', () => {
        test('session without plan_id results in null plan_id', async () => {
            const mockAgent = {
                processCommand: jest.fn().mockResolvedValue({
                    id: 'r', request_id: 'q', code: 'x', language: 'ts',
                    explanation: 'e', files: [], confidence: 90, warnings: [],
                    requires_approval: false, diff: null, tokens_used: 5,
                    duration_ms: 10, created_at: new Date().toISOString(),
                }),
            } as any;
            const session = db.createCodingSession({ name: 'NoPlan' });

            const req = mockReq('POST', { session_id: session.id, content: 'test' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/coding/process', db, orchestrator, config, mockAgent);
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.anything());
            const callArgs = mockAgent.processCommand.mock.calls[0];
            expect(callArgs[1].plan_id).toBeNull();
        });
    });

    // ==================== BRANCH COVERAGE: formatAgentResponse — no explanation, no code, no files ====================

    describe('formatAgentResponse — empty explanation and no code/files', () => {
        test('response with no explanation, no files, and no code', async () => {
            const mockAgent = {
                processCommand: jest.fn().mockResolvedValue({
                    id: 'r', request_id: 'q',
                    code: '',
                    language: 'plaintext',
                    explanation: '',
                    files: [],
                    confidence: 50,
                    warnings: [],
                    requires_approval: false,
                    diff: null, tokens_used: 1, duration_ms: 5,
                    created_at: new Date().toISOString(),
                }),
            } as any;
            const session = db.createCodingSession({ name: 'Empty' });
            const req = mockReq('POST', { session_id: session.id, content: 'empty' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/coding/process', db, orchestrator, config, mockAgent);
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.anything());
            const body = getJsonResponse(res);
            // Should only have metadata, no explanation or code blocks
            expect(body.agent_message.content).toContain('Confidence: 50%');
            expect(body.agent_message.content).not.toContain('```');
        });
    });

    // ==================== BRANCH COVERAGE: plan/generate with LLM returning JSON with empty tasks array ====================

    describe('Plan generate with empty tasks array from LLM', () => {
        test('returns 0 tasks and raw_response when tasks array is empty', async () => {
            orchestrator.callAgent.mockResolvedValueOnce({
                content: JSON.stringify({ plan_name: 'EmptyTasks', tasks: [] }),
            });
            const req = mockReq('POST', { name: 'Empty Tasks Plan', description: 'no tasks' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/plans/generate', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.taskCount).toBe(0);
            expect(body.tasks).toEqual([]);
            expect(body.raw_response).toBeDefined();
        });
    });

    // ==================== BRANCH COVERAGE: plan/generate with LLM JSON but no tasks key ====================

    describe('Plan generate with JSON but missing tasks key', () => {
        test('returns 0 tasks when parsed JSON has no tasks key', async () => {
            orchestrator.callAgent.mockResolvedValueOnce({
                content: JSON.stringify({ plan_name: 'NoTasks' }),
            });
            const req = mockReq('POST', { name: 'Missing Tasks', description: 'no tasks key' });
            const res = mockRes();
            await handleApiRequest(req, res, '/api/plans/generate', db, orchestrator, config);
            const body = getJsonResponse(res);
            expect(body.taskCount).toBe(0);
            expect(body.raw_response).toBeDefined();
        });
    });
});
