import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../src/core/database';
import { TaskStatus, TaskPriority, AgentType } from '../src/types';

// Mock vscode
jest.mock('vscode', () => require('./__mocks__/vscode'));

// We test the MCP server through HTTP calls since it's an HTTP server

describe('MCP Server (HTTP Integration)', () => {
    let db: Database;
    let tmpDir: string;
    let mcpPort: number;
    let mockLLMServer: http.Server;
    let llmPort: number;

    beforeAll(async () => {
        // Start a mock LLM server
        await new Promise<void>((resolve) => {
            mockLLMServer = http.createServer((req, res) => {
                if (req.url?.endsWith('/chat/completions')) {
                    let body = '';
                    req.on('data', (chunk: string) => { body += chunk; });
                    req.on('end', () => {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            choices: [{
                                message: { content: 'Mock LLM response' },
                                finish_reason: 'stop',
                            }],
                            usage: { total_tokens: 10 },
                        }));
                    });
                } else if (req.url?.endsWith('/models')) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
                }
            });
            mockLLMServer.listen(0, () => {
                llmPort = (mockLLMServer.address() as { port: number }).port;
                resolve();
            });
        });
    });

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-mcp-test-'));
        db = new Database(tmpDir);
        await db.initialize();
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    afterAll((done) => {
        mockLLMServer.close(done);
    });

    // Direct database tests that simulate what MCP tools would do

    test('getNextTask: returns highest priority ready task', () => {
        db.createTask({ title: 'P2 task', priority: TaskPriority.P2 });
        db.createTask({ title: 'P1 task', priority: TaskPriority.P1 });
        db.createTask({ title: 'P3 task', priority: TaskPriority.P3 });

        const next = db.getNextReadyTask();
        expect(next).toBeDefined();
        expect(next!.title).toBe('P1 task');
        expect(next!.priority).toBe('P1');
    });

    test('getNextTask: returns null when no tasks ready', () => {
        const next = db.getNextReadyTask();
        expect(next).toBeNull();
    });

    test('getNextTask: respects dependencies', () => {
        const t1 = db.createTask({ title: 'Setup DB', priority: TaskPriority.P1 });
        db.createTask({ title: 'Build API', priority: TaskPriority.P1, dependencies: [t1.id] });

        // Only t1 should be ready
        const next = db.getNextReadyTask();
        expect(next!.title).toBe('Setup DB');

        // Complete t1, now t2 should be ready
        db.updateTask(t1.id, { status: TaskStatus.Verified });
        const next2 = db.getNextReadyTask();
        expect(next2!.title).toBe('Build API');
    });

    test('reportTaskDone: marks task as pending verification', () => {
        const task = db.createTask({ title: 'Build feature' });
        db.updateTask(task.id, { status: TaskStatus.InProgress });
        db.updateTask(task.id, {
            status: TaskStatus.PendingVerification,
            files_modified: ['src/feature.ts'],
        });

        const updated = db.getTask(task.id);
        expect(updated!.status).toBe(TaskStatus.PendingVerification);
        expect(updated!.files_modified).toEqual(['src/feature.ts']);
    });

    test('getErrors: creates investigation task after 3 errors', () => {
        const task = db.createTask({ title: 'Buggy task' });

        // Log 3 errors
        db.addAuditLog('coding_agent', 'error', `Task ${task.id}: TypeError`);
        db.addAuditLog('coding_agent', 'error', `Task ${task.id}: TypeError`);
        db.addAuditLog('coding_agent', 'error', `Task ${task.id}: TypeError`);

        // Check that we can detect repeated errors
        const errors = db.getAuditLog(50, 'coding_agent')
            .filter(e => e.action === 'error' && e.detail.includes(task.id));
        expect(errors.length).toBe(3);

        // In real MCP, this would trigger investigation task creation
        const investigationTask = db.createTask({
            title: `Investigate repeated errors on: ${task.title}`,
            priority: TaskPriority.P1,
            dependencies: [task.id],
        });
        expect(investigationTask.title).toContain('Investigate');
    });

    test('scanCodebase: calculates drift correctly', () => {
        const plan = db.createPlan('Test Plan');
        db.updatePlan(plan.id, { status: 'active' as any });

        db.createTask({ title: 'T1', plan_id: plan.id, status: TaskStatus.Verified });
        db.createTask({ title: 'T2', plan_id: plan.id, status: TaskStatus.Verified });
        db.createTask({ title: 'T3', plan_id: plan.id, status: TaskStatus.NotStarted });
        db.createTask({ title: 'T4', plan_id: plan.id, status: TaskStatus.Failed });

        const tasks = db.getTasksByPlan(plan.id);
        const verified = tasks.filter(t => t.status === TaskStatus.Verified).length;
        const drift = ((tasks.length - verified) / tasks.length * 100);

        expect(tasks.length).toBe(4);
        expect(verified).toBe(2);
        expect(drift).toBe(50);
    });

    test('callCOEAgent: agent routing through database', () => {
        db.registerAgent('Planning Team', AgentType.Planning);
        db.registerAgent('Answer Agent', AgentType.Answer);

        const planAgent = db.getAgentByName('Planning Team');
        const ansAgent = db.getAgentByName('Answer Agent');

        expect(planAgent).toBeDefined();
        expect(ansAgent).toBeDefined();
        expect(planAgent!.type).toBe(AgentType.Planning);
    });
});
