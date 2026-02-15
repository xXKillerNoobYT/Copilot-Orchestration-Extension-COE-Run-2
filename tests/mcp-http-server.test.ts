/**
 * MCP HTTP Server Integration Tests
 *
 * Tests the actual HTTP server endpoints including:
 * - GET / (server info)
 * - GET /tools (tool list)
 * - POST /call (tool calls)
 * - POST /mcp (JSON-RPC 2.0)
 * - GET /mcp/sse (Server-Sent Events)
 * - GET /health
 * - GET /app (web app)
 * - OPTIONS (CORS)
 * - 404 for unknown routes
 */

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

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Database } from '../src/core/database';
import { LLMService } from '../src/core/llm-service';
import { ConfigManager } from '../src/core/config';
import { Orchestrator } from '../src/agents/orchestrator';
import { MCPServer } from '../src/mcp/server';
import { ConversationRole } from '../src/types';

let database: Database;
let llmService: LLMService;
let orchestrator: Orchestrator;
let mcpServer: MCPServer;
let tmpDir: string;
let port: number;

const outputChannel: any = { appendLine: jest.fn(), show: jest.fn(), dispose: jest.fn() };

function mockLLMResponse(content: string): void {
    const chunks = content.match(/.{1,20}/g) || [content];
    const sseLines = chunks.map(chunk =>
        `data: ${JSON.stringify({ choices: [{ delta: { content: chunk }, finish_reason: null }] })}\n\n`
    ).join('') + 'data: [DONE]\n\n';
    const encoder = new TextEncoder();
    const encoded = encoder.encode(sseLines);
    let readDone = false;
    const mockBody = {
        getReader: () => ({
            read: async () => {
                if (!readDone) { readDone = true; return { done: false, value: encoded }; }
                return { done: true, value: undefined };
            },
        }),
    };
    (global as any).fetch = jest.fn().mockResolvedValue({
        ok: true, body: mockBody,
        json: async () => ({
            choices: [{ message: { content }, finish_reason: 'stop' }],
            usage: { total_tokens: 100 },
        }),
    });
}

const configManager = {
    getConfig: () => ({
        version: '1.0.0',
        llm: { endpoint: 'http://localhost:9999/v1', model: 'test', timeoutSeconds: 30, startupTimeoutSeconds: 10, streamStallTimeoutSeconds: 60, maxTokens: 4000 },
        taskQueue: { maxPending: 20 },
        verification: { delaySeconds: 300, coverageThreshold: 80 },
        watcher: { debounceMs: 500 },
        agents: {},
    }),
    getLLMConfig: () => ({ endpoint: 'http://localhost:9999/v1', model: 'test', timeoutSeconds: 30, startupTimeoutSeconds: 10, streamStallTimeoutSeconds: 60, maxTokens: 4000 }),
    getAgentContextLimit: () => 4000,
    getCOEDir: () => tmpDir,
} as unknown as ConfigManager;

function httpRequest(method: string, urlPath: string, body?: any): Promise<{ status: number; data: any; raw: string }> {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port,
            path: urlPath,
            method,
            headers: { 'Content-Type': 'application/json' },
        };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode || 0, data: JSON.parse(data), raw: data });
                } catch {
                    resolve({ status: res.statusCode || 0, data: null, raw: data });
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-mcp-http-'));
    database = new Database(tmpDir);
    await database.initialize();
    llmService = new LLMService(configManager.getLLMConfig(), outputChannel);

    mockLLMResponse('test response');

    orchestrator = new Orchestrator(database, llmService, configManager, outputChannel);
    await orchestrator.initialize();

    mcpServer = new MCPServer(orchestrator, database, configManager, outputChannel);
    await mcpServer.initialize();
    port = mcpServer.getPort();
});

afterAll(async () => {
    mcpServer.dispose();
    database.close();
    // Wait for connections to close
    await new Promise(r => setTimeout(r, 100));
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('MCP HTTP Server endpoints', () => {
    test('GET / returns server info', async () => {
        const res = await httpRequest('GET', '/');
        expect(res.status).toBe(200);
        expect(res.data.name).toBe('COE MCP Server');
        expect(res.data.version).toBe('1.0.0');
        expect(res.data.tools).toContain('getNextTask');
        expect(res.data.mcp_endpoint).toContain('/mcp');
    });

    test('GET /tools returns tool definitions', async () => {
        const res = await httpRequest('GET', '/tools');
        expect(res.status).toBe(200);
        expect(res.data.tools).toBeDefined();
        expect(res.data.tools.length).toBeGreaterThanOrEqual(6);
        const toolNames = res.data.tools.map((t: any) => t.name);
        expect(toolNames).toContain('getNextTask');
        expect(toolNames).toContain('reportTaskDone');
        expect(toolNames).toContain('askQuestion');
        expect(toolNames).toContain('getErrors');
        expect(toolNames).toContain('callCOEAgent');
        expect(toolNames).toContain('scanCodeBase');
    });

    test('POST /call — getNextTask returns no tasks ready', async () => {
        const res = await httpRequest('POST', '/call', {
            name: 'getNextTask',
            arguments: {},
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(false);
        expect(res.data.error).toContain('No tasks ready');
    });

    test('POST /call — getNextTask returns task with context', async () => {
        const plan = database.createPlan('Test Plan', '{"focus":"test"}');
        const task = database.createTask({
            title: 'Build feature', description: 'Build it',
            priority: 'P1' as any, plan_id: plan.id,
            acceptance_criteria: 'It works',
        });

        const res = await httpRequest('POST', '/call', {
            name: 'getNextTask',
            arguments: {},
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(true);
        expect(res.data.data.title).toBe('Build feature');
        expect(res.data.data.context_bundle.plan_name).toBe('Test Plan');
    });

    test('POST /call — reportTaskDone triggers verification', async () => {
        const task = database.createTask({ title: 'Done task', priority: 'P1' as any });
        database.updateTask(task.id, { status: 'in_progress' as any });

        mockLLMResponse('{"status":"passed","criteria_results":[],"test_results":null,"summary":"OK","follow_up_tasks":[]}');

        const res = await httpRequest('POST', '/call', {
            name: 'reportTaskDone',
            arguments: {
                task_id: task.id,
                summary: 'Built it',
                files_modified: ['src/feature.ts'],
                decisions_made: ['Used SQLite'],
            },
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(true);
    });

    test('POST /call — reportTaskDone with invalid task', async () => {
        const res = await httpRequest('POST', '/call', {
            name: 'reportTaskDone',
            arguments: {
                task_id: 'nonexistent',
                summary: 'test',
                files_modified: [],
            },
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(false);
    });

    test('POST /call — askQuestion routes to answer agent', async () => {
        mockLLMResponse('The answer is 42.');

        const res = await httpRequest('POST', '/call', {
            name: 'askQuestion',
            arguments: { question: 'What is the meaning of life?' },
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(true);
        expect(res.data.data.answer).toBeDefined();
    });

    test('POST /call — getErrors logs error and detects repetition', async () => {
        const task = database.createTask({ title: 'Error task' });

        const res = await httpRequest('POST', '/call', {
            name: 'getErrors',
            arguments: {
                task_id: task.id,
                error_message: 'TypeError: undefined is not a function',
                stack_trace: 'at line 42',
            },
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(true);
        expect(res.data.data.logged).toBe(true);
    });

    test('POST /call — callCOEAgent routes to named agent', async () => {
        mockLLMResponse('Research results here.');

        const res = await httpRequest('POST', '/call', {
            name: 'callCOEAgent',
            arguments: {
                agent_name: 'research',
                message: 'Compare SQLite vs Postgres',
            },
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(true);
        expect(res.data.data.agent).toBe('research');
    });

    test('POST /call — scanCodeBase returns drift stats', async () => {
        const plan = database.createPlan('Scan Plan', '{}');
        database.updatePlan(plan.id, { status: 'active' as any });
        database.createTask({ title: 'ST1', plan_id: plan.id });
        database.createTask({ title: 'ST2', plan_id: plan.id });

        const res = await httpRequest('POST', '/call', {
            name: 'scanCodeBase',
            arguments: {},
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(true);
        expect(res.data.data.total_tasks).toBeGreaterThanOrEqual(2);
        expect(res.data.data.drift_percentage).toBeDefined();
    });

    test('POST /call — unknown tool returns 404', async () => {
        const res = await httpRequest('POST', '/call', {
            name: 'nonexistentTool',
            arguments: {},
        });
        expect(res.status).toBe(404);
    });

    test('POST /call — invalid JSON returns 500', async () => {
        return new Promise<void>((resolve, reject) => {
            const req = http.request({
                hostname: 'localhost', port, path: '/call', method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    expect(res.statusCode).toBe(500);
                    resolve();
                });
            });
            req.on('error', reject);
            req.write('not valid json{{{');
            req.end();
        });
    });

    // JSON-RPC 2.0 tests

    test('POST /mcp — initialize returns protocol info', async () => {
        const res = await httpRequest('POST', '/mcp', {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
        });
        expect(res.status).toBe(200);
        expect(res.data.jsonrpc).toBe('2.0');
        expect(res.data.id).toBe(1);
        expect(res.data.result.protocolVersion).toBe('2024-11-05');
        expect(res.data.result.serverInfo.name).toBe('coe-mcp-server');
    });

    test('POST /mcp — tools/list returns tool definitions', async () => {
        const res = await httpRequest('POST', '/mcp', {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
        });
        expect(res.status).toBe(200);
        expect(res.data.result.tools.length).toBeGreaterThanOrEqual(6);
    });

    test('POST /mcp — tools/call invokes handler', async () => {
        const res = await httpRequest('POST', '/mcp', {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: {
                name: 'getNextTask',
                arguments: {},
            },
        });
        expect(res.status).toBe(200);
        expect(res.data.result.content).toBeDefined();
        expect(res.data.result.content[0].type).toBe('text');
    });

    test('POST /mcp — tools/call with unknown tool returns error', async () => {
        const res = await httpRequest('POST', '/mcp', {
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/call',
            params: {
                name: 'nonexistentTool',
                arguments: {},
            },
        });
        expect(res.status).toBe(200);
        expect(res.data.error.code).toBe(-32602);
    });

    test('POST /mcp — unknown method returns error', async () => {
        const res = await httpRequest('POST', '/mcp', {
            jsonrpc: '2.0',
            id: 5,
            method: 'unknown/method',
        });
        expect(res.status).toBe(200);
        expect(res.data.error.code).toBe(-32601);
    });

    test('POST /mcp — invalid jsonrpc version returns error', async () => {
        const res = await httpRequest('POST', '/mcp', {
            jsonrpc: '1.0',
            id: 6,
            method: 'initialize',
        });
        expect(res.status).toBe(400);
        expect(res.data.error.code).toBe(-32600);
    });

    test('POST /mcp — malformed JSON returns parse error', async () => {
        return new Promise<void>((resolve, reject) => {
            const req = http.request({
                hostname: 'localhost', port, path: '/mcp', method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    const parsed = JSON.parse(data);
                    expect(parsed.error.code).toBe(-32700);
                    resolve();
                });
            });
            req.on('error', reject);
            req.write('{not json');
            req.end();
        });
    });

    test('GET /health returns status', async () => {
        const res = await httpRequest('GET', '/health');
        expect(res.status).toBe(200);
        expect(res.data.status).toBe('ok');
        expect(res.data.stats).toBeDefined();
        expect(res.data.tools).toBeDefined();
    });

    test('GET /app returns HTML', async () => {
        const res = await httpRequest('GET', '/app');
        expect(res.status).toBe(200);
        expect(res.raw).toContain('<!DOCTYPE html>');
    });

    test('OPTIONS returns CORS headers', async () => {
        return new Promise<void>((resolve, reject) => {
            const req = http.request({
                hostname: 'localhost', port, path: '/tools', method: 'OPTIONS',
            }, (res) => {
                expect(res.statusCode).toBe(204);
                resolve();
            });
            req.on('error', reject);
            req.end();
        });
    });

    test('GET /unknown returns 404', async () => {
        const res = await httpRequest('GET', '/unknown/path');
        expect(res.status).toBe(404);
    });

    test('GET /mcp/sse returns SSE stream with endpoint', async () => {
        return new Promise<void>((resolve, reject) => {
            const req = http.request({
                hostname: 'localhost', port, path: '/mcp/sse', method: 'GET',
            }, (res) => {
                expect(res.statusCode).toBe(200);
                expect(res.headers['content-type']).toBe('text/event-stream');

                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                    if (data.includes('endpoint')) {
                        expect(data).toContain('event: endpoint');
                        expect(data).toContain('/mcp');
                        req.destroy(); // close connection
                        resolve();
                    }
                });
                // Safety timeout
                setTimeout(() => {
                    req.destroy();
                    resolve();
                }, 2000);
            });
            req.on('error', () => { /* expected after destroy */ });
            req.end();
        });
    });

    test('getToolDefinitions returns all tools', () => {
        const tools = mcpServer.getToolDefinitions();
        expect(tools.length).toBeGreaterThanOrEqual(6);
    });

    test('getPort returns actual port', () => {
        expect(mcpServer.getPort()).toBe(port);
        expect(port).toBeGreaterThan(0);
    });

    test('webapp API routes are accessible', async () => {
        const res = await httpRequest('GET', '/api/dashboard');
        expect(res.status).toBe(200);
        expect(res.data.stats).toBeDefined();
    });

    // ---------------------------------------------------------------
    // Coverage gap tests: lines 79-83, 179, 210-219, 278, 303, 314-315, 529, 589
    // ---------------------------------------------------------------

    test('POST /call — getNextTask includes completed_dependencies and previous_conversations (lines 79-83)', async () => {
        // Create a plan for context
        const plan = database.createPlan('Dep Test Plan', '{"scope":"deps"}');

        // Create a dependency task that is already verified with files_modified
        const depTask = database.createTask({
            title: 'Setup database schema',
            description: 'Create tables',
            priority: 'P1' as any,
            plan_id: plan.id,
            status: 'verified' as any,
            files_modified: ['src/db/schema.ts', 'src/db/migrations.ts'],
        });

        // Create the main task that depends on the completed dep task
        const mainTask = database.createTask({
            title: 'Build API layer',
            description: 'Build REST endpoints',
            priority: 'P1' as any,
            plan_id: plan.id,
            dependencies: [depTask.id],
        });

        // Add conversations for the main task so previous_conversations mapping executes (line 83)
        database.addConversation('coding_agent', ConversationRole.User, 'How should we structure the API?', mainTask.id);
        database.addConversation('coding_agent', ConversationRole.Agent, 'I recommend a RESTful structure.', mainTask.id);

        // The dependency is verified so the main task should be ready
        const res = await httpRequest('POST', '/call', {
            name: 'getNextTask',
            arguments: {},
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(true);
        expect(res.data.data.title).toBe('Build API layer');
        expect(res.data.data.context_bundle).toBeDefined();

        // Verify completed_dependencies (lines 79-82)
        expect(res.data.data.context_bundle.completed_dependencies).toBeDefined();
        expect(Array.isArray(res.data.data.context_bundle.completed_dependencies)).toBe(true);
        expect(res.data.data.context_bundle.completed_dependencies.length).toBe(1);
        expect(res.data.data.context_bundle.completed_dependencies[0].title).toBe('Setup database schema');
        expect(res.data.data.context_bundle.completed_dependencies[0].files_modified).toEqual(['src/db/schema.ts', 'src/db/migrations.ts']);

        // Verify previous_conversations (line 83)
        expect(res.data.data.context_bundle.previous_conversations).toBeDefined();
        expect(Array.isArray(res.data.data.context_bundle.previous_conversations)).toBe(true);
        expect(res.data.data.context_bundle.previous_conversations.length).toBe(2);
        expect(res.data.data.context_bundle.previous_conversations[0].role).toBe('user');
        expect(res.data.data.context_bundle.previous_conversations[0].content).toBe('How should we structure the API?');
        expect(res.data.data.context_bundle.previous_conversations[1].role).toBe('agent');
        expect(res.data.data.context_bundle.previous_conversations[1].content).toBe('I recommend a RESTful structure.');
    });

    test('POST /call — askQuestion returns escalated=false when no escalation actions (line 179)', async () => {
        // Mock an LLM response with actions that are NOT escalation type
        mockLLMResponse('ANSWER: Use JWT tokens for auth.\nCONFIDENCE: 90\nSOURCES: src/auth.ts\nESCALATE: false');

        const res = await httpRequest('POST', '/call', {
            name: 'askQuestion',
            arguments: {
                question: 'How should we handle authentication?',
                context: 'Working on security module',
            },
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(true);
        expect(res.data.data).toBeDefined();
        expect(typeof res.data.data.escalated).toBe('boolean');
        expect(res.data.data.escalated).toBe(false);
    });

    test('POST /call — askQuestion returns escalated=true when confidence is low (line 179)', async () => {
        // Mock an LLM response with low confidence to trigger escalation
        // When confidence < 50, AnswerAgent sets escalated=true and adds an escalate action
        mockLLMResponse('ANSWER: I am not sure about this.\nCONFIDENCE: 30\nSOURCES: none\nESCALATE: true');

        const res = await httpRequest('POST', '/call', {
            name: 'askQuestion',
            arguments: {
                question: 'What quantum cryptography library should we use?',
            },
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(true);
        expect(res.data.data).toBeDefined();
        // The response.actions should contain an 'escalate' action, so escalated should be true
        expect(res.data.data.escalated).toBe(true);
        expect(res.data.data.confidence).toBe(30);
    });

    test('POST /call — getErrors creates investigation task and ticket after 3+ errors (lines 210-219)', async () => {
        const errorTask = database.createTask({ title: 'Flaky integration test' });

        // Pre-seed 2 error audit log entries for this task so the handler sees them
        database.addAuditLog('coding_agent', 'error', `Task ${errorTask.id}: Connection timeout`);
        database.addAuditLog('coding_agent', 'error', `Task ${errorTask.id}: Connection timeout`);

        // The 3rd error call should trigger investigation task + ticket creation
        const res = await httpRequest('POST', '/call', {
            name: 'getErrors',
            arguments: {
                task_id: errorTask.id,
                error_message: 'Connection timeout',
                stack_trace: 'at Socket.connect (net.js:100)',
            },
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(true);
        expect(res.data.data.error_count).toBeGreaterThanOrEqual(3);
        expect(res.data.data.investigation_created).toBe(true);

        // Verify the investigation task was actually created in the database
        const allTasks = database.getAllTasks();
        const investigationTask = allTasks.find(t => t.title.includes('Investigate repeated errors on'));
        expect(investigationTask).toBeDefined();
        expect(investigationTask!.title).toContain('Flaky integration test');
        expect(investigationTask!.dependencies).toContain(errorTask.id);

        // Verify the ticket was created
        const tickets = database.getAllTickets();
        const investigationTicket = tickets.find(t => t.title.includes('Repeated errors on task'));
        expect(investigationTicket).toBeDefined();
        expect(investigationTicket!.title).toContain('Flaky integration test');
    });

    test('POST /call — callCOEAgent returns error when agent throws (line 278)', async () => {
        // Monkey-patch the orchestrator's callAgent to throw an error
        const originalCallAgent = orchestrator.callAgent.bind(orchestrator);
        orchestrator.callAgent = jest.fn().mockRejectedValue(new Error('Agent crashed unexpectedly'));

        const res = await httpRequest('POST', '/call', {
            name: 'callCOEAgent',
            arguments: {
                agent_name: 'research',
                message: 'This will fail',
            },
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(false);
        expect(res.data.error).toContain('Agent "research" error');
        expect(res.data.error).toContain('Agent crashed unexpectedly');

        // Restore original
        orchestrator.callAgent = originalCallAgent;
    });

    test('POST /call — scanCodeBase with no active plan returns error (line 303)', async () => {
        // Deactivate all plans so no active plan is found
        const allTasks = database.getAllTasks();
        const plans = new Set(allTasks.filter(t => t.plan_id).map(t => t.plan_id!));

        // Archive all existing plans
        for (const planId of plans) {
            try { database.updatePlan(planId, { status: 'archived' as any }); } catch { /* ignore */ }
        }
        // Also archive any other active plans
        const activePlan = database.getActivePlan();
        if (activePlan) {
            database.updatePlan(activePlan.id, { status: 'archived' as any });
        }

        const res = await httpRequest('POST', '/call', {
            name: 'scanCodeBase',
            arguments: {},
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(false);
        expect(res.data.error).toContain('No active plan found');
    });

    test('POST /call — scanCodeBase collects files_modified from verified tasks (lines 314-315)', async () => {
        const plan = database.createPlan('File Tracking Plan', '{}');
        database.updatePlan(plan.id, { status: 'active' as any });

        // Create verified tasks with files_modified
        database.createTask({
            title: 'FT1', plan_id: plan.id,
            status: 'verified' as any,
            files_modified: ['src/api/routes.ts', 'src/api/handlers.ts'],
        });
        database.createTask({
            title: 'FT2', plan_id: plan.id,
            status: 'verified' as any,
            files_modified: ['src/api/middleware.ts', 'src/api/routes.ts'], // overlapping file
        });
        database.createTask({
            title: 'FT3', plan_id: plan.id,
            status: 'not_started' as any,
        });

        const res = await httpRequest('POST', '/call', {
            name: 'scanCodeBase',
            arguments: { plan_id: plan.id },
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(true);
        expect(res.data.data.verified).toBe(2);
        expect(res.data.data.not_started).toBe(1);
        expect(res.data.data.total_tasks).toBe(3);
        // aligned_files should be a deduplicated set of files from verified tasks
        const alignedFiles = res.data.data.aligned_files;
        expect(alignedFiles).toContain('src/api/routes.ts');
        expect(alignedFiles).toContain('src/api/handlers.ts');
        expect(alignedFiles).toContain('src/api/middleware.ts');
        // Deduplicated: routes.ts appears in both tasks but should appear once
        expect(alignedFiles.length).toBe(3);
    });
});

// ---------------------------------------------------------------
// Separate describe block for MCPServer constructor/startup edge cases
// These tests create their own MCPServer instances to test initialization paths
// ---------------------------------------------------------------
describe('MCP Server startup edge cases', () => {
    test('server rejects with non-EADDRINUSE errors (line 589)', async () => {
        const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-mcp-edge-'));
        const db2 = new Database(tmpDir2);
        await db2.initialize();

        const outputChannel2: any = { appendLine: jest.fn(), show: jest.fn(), dispose: jest.fn() };
        const llm2 = new LLMService(configManager.getLLMConfig(), outputChannel2);
        mockLLMResponse('test');
        const orch2 = new Orchestrator(db2, llm2, configManager, outputChannel2);
        await orch2.initialize();

        const server2 = new MCPServer(orch2, db2, configManager as any, outputChannel2);

        // Spy on http.Server.prototype.listen to intercept the server and emit a non-EADDRINUSE error
        const origListen = http.Server.prototype.listen;
        let intercepted = false;
        const listenSpy = jest.spyOn(http.Server.prototype, 'listen').mockImplementation(function (this: http.Server, ...args: any[]) {
            if (!intercepted) {
                intercepted = true;
                // Emit a non-EADDRINUSE error after the error handler is registered
                process.nextTick(() => {
                    const err = new Error('Permission denied') as NodeJS.ErrnoException;
                    err.code = 'EACCES';
                    this.emit('error', err);
                });
                return this;
            }
            return origListen.apply(this, args as any);
        });

        await expect(server2.initialize()).rejects.toThrow('Permission denied');

        listenSpy.mockRestore();
        server2.dispose();
        db2.close();
        fs.rmSync(tmpDir2, { recursive: true, force: true });
    });

    test('POST /call — reportTaskDone returns non-Error as string (line 138)', async () => {
        // Monkey-patch reportTaskDone to throw a non-Error object
        const originalReportTaskDone = orchestrator.reportTaskDone.bind(orchestrator);
        orchestrator.reportTaskDone = jest.fn().mockRejectedValue('string error thrown');

        const task = database.createTask({ title: 'Non-error task' });
        const res = await httpRequest('POST', '/call', {
            name: 'reportTaskDone',
            arguments: {
                task_id: task.id,
                summary: 'test',
                files_modified: [],
            },
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(false);
        expect(res.data.error).toBe('string error thrown');

        orchestrator.reportTaskDone = originalReportTaskDone;
    });

    test('POST /call — askQuestion with task_id but no plan (lines 161-162)', async () => {
        // Create a task with no plan_id to test `task?.plan_id ? ... : undefined`
        const taskNoPlan = database.createTask({ title: 'No plan task' });
        mockLLMResponse('The answer is here. ANSWER: test\nCONFIDENCE: 50\nSOURCES: none\nESCALATE: false');

        const res = await httpRequest('POST', '/call', {
            name: 'askQuestion',
            arguments: {
                question: 'What should I do?',
                task_id: taskNoPlan.id,
            },
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(true);
        expect(res.data.data.answer).toBeDefined();
    });

    test('POST /call — askQuestion with non-existent task_id (line 161 null path)', async () => {
        mockLLMResponse('ANSWER: Generic answer\nCONFIDENCE: 60\nSOURCES: none\nESCALATE: false');

        const res = await httpRequest('POST', '/call', {
            name: 'askQuestion',
            arguments: {
                question: 'General question',
                task_id: 'nonexistent-task-id',
            },
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(true);
    });

    test('POST /call — askQuestion without context param (line 170 else branch)', async () => {
        mockLLMResponse('ANSWER: Direct answer\nCONFIDENCE: 70\nSOURCES: none\nESCALATE: false');

        const res = await httpRequest('POST', '/call', {
            name: 'askQuestion',
            arguments: {
                question: 'Simple question with no extra context',
            },
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(true);
    });

    test('POST /call — getErrors without stack_trace (line 203 else branch)', async () => {
        const task = database.createTask({ title: 'No stack task' });
        const res = await httpRequest('POST', '/call', {
            name: 'getErrors',
            arguments: {
                task_id: task.id,
                error_message: 'Simple error without stack',
            },
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(true);
        expect(res.data.data.logged).toBe(true);
    });

    test('POST /call — askQuestion with null confidence/sources (lines 177-178)', async () => {
        // Mock callAgent to return a response with no confidence and no sources
        const originalCallAgent = orchestrator.callAgent.bind(orchestrator);
        orchestrator.callAgent = jest.fn().mockResolvedValue({
            content: 'Test answer',
            confidence: undefined,
            sources: undefined,
            actions: undefined,
        });

        const res = await httpRequest('POST', '/call', {
            name: 'askQuestion',
            arguments: { question: 'Test question' },
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(true);
        expect(res.data.data.confidence).toBe(80); // fallback
        expect(res.data.data.sources).toEqual([]); // fallback
        expect(res.data.data.escalated).toBe(false); // actions undefined => || false

        orchestrator.callAgent = originalCallAgent;
    });

    test('POST /call — askQuestion with zero confidence preserves zero (not coerced to 80)', async () => {
        // v4.1 fix: Zero confidence is a valid value and should be preserved (using ?? instead of ||)
        const originalCallAgent = orchestrator.callAgent.bind(orchestrator);
        orchestrator.callAgent = jest.fn().mockResolvedValue({
            content: 'Uncertain answer',
            confidence: 0,
            sources: [],
            actions: [],
        });

        const res = await httpRequest('POST', '/call', {
            name: 'askQuestion',
            arguments: { question: 'Uncertain question' },
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(true);
        expect(res.data.data.confidence).toBe(0); // 0 ?? 80 = 0 (zero is valid)

        orchestrator.callAgent = originalCallAgent;
    });

    test('POST /call — askQuestion with task that has plan_id (line 162)', async () => {
        const plan = database.createPlan('Question Plan', '{"test":true}');
        const task = database.createTask({ title: 'Plan task', plan_id: plan.id });
        mockLLMResponse('ANSWER: Context answer\nCONFIDENCE: 85\nSOURCES: plan\nESCALATE: false');

        const res = await httpRequest('POST', '/call', {
            name: 'askQuestion',
            arguments: {
                question: 'What about this plan?',
                task_id: task.id,
            },
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(true);
    });

    test('POST /call — askQuestion with task whose plan does not exist (line 162 || undefined)', async () => {
        // Create a task with a plan_id that references a non-existent plan
        const rawDb = (database as any).db;
        // Disable FK constraints temporarily to insert an orphaned task
        rawDb.exec('PRAGMA foreign_keys = OFF');
        rawDb.prepare(`INSERT INTO tasks (id, title, description, status, priority, dependencies, acceptance_criteria, plan_id, parent_task_id, estimated_minutes, files_modified, sort_order, created_at, updated_at)
            VALUES ('orphan-task', 'Orphan task', '', 'not_started', 'P2', '[]', '', 'nonexistent-plan', NULL, 30, '[]', 0, datetime('now'), datetime('now'))`).run();
        rawDb.exec('PRAGMA foreign_keys = ON');

        mockLLMResponse('ANSWER: Orphan answer\nCONFIDENCE: 70\nSOURCES: none\nESCALATE: false');

        const res = await httpRequest('POST', '/call', {
            name: 'askQuestion',
            arguments: {
                question: 'What about this orphan task?',
                task_id: 'orphan-task',
            },
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(true);
    });

    test('POST /call — getErrors with 3+ errors and no stack trace (lines 212-220)', async () => {
        // Create a real task but test the no-stack-trace path (stackTrace || 'N/A')
        const errorTask2 = database.createTask({ title: 'Repeated error task 2' });
        // Pre-seed 2 error audit log entries
        database.addAuditLog('coding_agent', 'error', `Task ${errorTask2.id}: Connection refused`);
        database.addAuditLog('coding_agent', 'error', `Task ${errorTask2.id}: Connection refused`);

        const res = await httpRequest('POST', '/call', {
            name: 'getErrors',
            arguments: {
                task_id: errorTask2.id,
                error_message: 'Connection refused',
                // No stack_trace — triggers stackTrace || 'N/A' (line 213)
            },
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(true);
        expect(res.data.data.error_count).toBeGreaterThanOrEqual(3);
        expect(res.data.data.investigation_created).toBe(true);
    });

    test('POST /call — callCOEAgent error with non-Error object (line 280)', async () => {
        const originalCallAgent = orchestrator.callAgent.bind(orchestrator);
        orchestrator.callAgent = jest.fn().mockRejectedValue(42); // non-Error value

        const res = await httpRequest('POST', '/call', {
            name: 'callCOEAgent',
            arguments: {
                agent_name: 'research',
                message: 'This will fail with non-Error',
            },
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(false);
        expect(res.data.error).toContain('42');

        orchestrator.callAgent = originalCallAgent;
    });

    test('POST /call — scanCodeBase with explicit plan_id (line 298)', async () => {
        const plan = database.createPlan('Explicit Plan', '{}');
        const res = await httpRequest('POST', '/call', {
            name: 'scanCodeBase',
            arguments: { plan_id: plan.id },
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(true);
        expect(res.data.data.plan_name).toBe('Explicit Plan');
        expect(res.data.data.total_tasks).toBe(0);
    });

    test('POST /call — scanCodeBase with zero tasks gives 0 drift (line 319)', async () => {
        const plan = database.createPlan('Empty Plan', '{}');
        const res = await httpRequest('POST', '/call', {
            name: 'scanCodeBase',
            arguments: { plan_id: plan.id },
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(true);
        expect(res.data.data.total_tasks).toBe(0);
        expect(res.data.data.drift_percentage).toBe(0);
    });

    test('POST /mcp — tools/call without arguments param uses default empty object (line 466)', async () => {
        const res = await httpRequest('POST', '/mcp', {
            jsonrpc: '2.0',
            id: 100,
            method: 'tools/call',
            params: {
                name: 'getNextTask',
                // no arguments field — should default to {}
            },
        });
        expect(res.status).toBe(200);
        expect(res.data.result).toBeDefined();
    });

    test('POST /mcp — invalid jsonrpc with missing id uses null (line 423)', async () => {
        const res = await httpRequest('POST', '/mcp', {
            jsonrpc: '1.0',
            method: 'initialize',
            // no id field — should use rpc.id ?? null
        });
        expect(res.status).toBe(400);
        expect(res.data.error.code).toBe(-32600);
        expect(res.data.id).toBeNull();
    });

    test('POST /call — /call endpoint catch block with non-Error thrown (lines 395-399)', async () => {
        // We need to trigger a non-Error in the /call catch block
        // Temporarily replace a handler to throw a non-Error value
        const originalHandlers = (mcpServer as any).handlers;
        const fakeTool = 'getNextTask';
        const originalHandler = originalHandlers.get(fakeTool);

        originalHandlers.set(fakeTool, async () => {
            throw 'raw string error'; // eslint-disable-line no-throw-literal
        });

        const res = await httpRequest('POST', '/call', {
            name: 'getNextTask',
            arguments: {},
        });
        expect(res.status).toBe(500);
        expect(res.data.success).toBe(false);
        expect(res.data.error).toBe('raw string error');

        // Restore
        originalHandlers.set(fakeTool, originalHandler);
    });

    test('POST /mcp — /mcp endpoint catch block with non-Error thrown (line 507)', async () => {
        // We need a parse error from a non-Error type in the /mcp catch
        // This is hard to trigger since JSON.parse throws Error subclass
        // Instead, we can monkey-patch JSON.parse temporarily
        const originalParse = JSON.parse;
        const parseSpy = jest.spyOn(JSON, 'parse').mockImplementationOnce(() => {
            throw 'non-error parse failure'; // eslint-disable-line no-throw-literal
        });

        return new Promise<void>((resolve, reject) => {
            const req = http.request({
                hostname: 'localhost', port, path: '/mcp', method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    const parsed = originalParse(data);
                    expect(parsed.error.code).toBe(-32700);
                    expect(parsed.error.message).toContain('non-error parse failure');
                    parseSpy.mockRestore();
                    resolve();
                });
            });
            req.on('error', reject);
            req.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}');
            req.end();
        });
    });

    test('GET /app/ with trailing slash (line 551)', async () => {
        const res = await httpRequest('GET', '/app/');
        expect(res.status).toBe(200);
        expect(res.raw).toContain('<!DOCTYPE html>');
    });

    test('SSE ping catch block fires when connection drops mid-ping (line 529)', async () => {
        // Captures the 30s ping callback and invokes it after the client disconnects.
        // When res.write throws (dead connection), the catch block clears the interval.

        let capturedPingCb: (() => void) | null = null;
        let capturedId: ReturnType<typeof setInterval> | null = null;
        const realSetInterval = global.setInterval;
        const origSetInterval = global.setInterval;

        global.setInterval = ((fn: any, ms: any) => {
            if (ms === 30000) {
                capturedPingCb = fn;
                capturedId = realSetInterval(() => {}, 999999);
                return capturedId;
            }
            return origSetInterval(fn, ms);
        }) as any;

        let clearCount = 0;
        const origClearInterval = global.clearInterval;
        global.clearInterval = ((id: any) => {
            if (id === capturedId) { clearCount++; }
            return origClearInterval(id);
        }) as any;

        await new Promise<void>((resolve) => {
            const req = http.request(
                { hostname: 'localhost', port, path: '/mcp/sse', method: 'GET' },
                (res) => {
                    let data = '';
                    res.on('data', (chunk) => {
                        data += chunk;
                        if (data.includes('endpoint')) {
                            req.destroy();
                            setTimeout(() => {
                                if (capturedPingCb) { capturedPingCb(); }
                                setTimeout(() => resolve(), 50);
                            }, 100);
                        }
                    });
                    setTimeout(() => { req.destroy(); resolve(); }, 3000);
                },
            );
            req.on('error', () => { /* expected after destroy */ });
            req.end();
        });

        // clearInterval called at least once (from close handler and/or catch block)
        expect(clearCount).toBeGreaterThanOrEqual(1);

        global.setInterval = origSetInterval;
        global.clearInterval = origClearInterval;
        if (capturedId) clearInterval(capturedId);
    });

    test('POST /call — getErrors with 3+ errors on task with empty title uses taskId fallback (lines 212, 220)', async () => {
        // Create a real task with an empty title so that task?.title is "" (falsy)
        // which triggers the || taskId fallback on lines 212 and 220
        const emptyTitleTask = database.createTask({ title: '' });
        const taskId = emptyTitleTask.id;

        // Pre-seed 2 error audit log entries
        database.addAuditLog('coding_agent', 'error', `Task ${taskId}: Some error`);
        database.addAuditLog('coding_agent', 'error', `Task ${taskId}: Some error`);

        // 3rd error triggers investigation
        const res = await httpRequest('POST', '/call', {
            name: 'getErrors',
            arguments: {
                task_id: taskId,
                error_message: 'Some error',
                stack_trace: 'at line 1',
            },
        });
        expect(res.status).toBe(200);
        expect(res.data.success).toBe(true);
        expect(res.data.data.error_count).toBeGreaterThanOrEqual(3);
        expect(res.data.data.investigation_created).toBe(true);

        // Verify the investigation task title uses taskId (not task.title) because title is ""
        // Use taskId in the search to avoid matching investigation tasks from other tests
        const allTasks = database.getAllTasks();
        const investigation = allTasks.find(t =>
            t.title.includes('Investigate repeated errors on') && t.title.includes(taskId)
        );
        expect(investigation).toBeDefined();
    });

    test('POST /call — tool call with null arguments uses || {} fallback (line 391)', async () => {
        // Send a tool call with arguments: null — JSON.stringify(null) → "null" (doesn't crash line 390)
        // null is falsy, so line 391 triggers: toolCall.arguments || {} → {}
        const res = await httpRequest('POST', '/call', {
            name: 'getNextTask',
            arguments: null,
        });
        expect(res.status).toBe(200);
    });

    test('raw HTTP request with empty URL triggers req.url || "/" fallback (line 364)', async () => {
        // Line 364: `const url = new URL(req.url || '/', ...)`
        // When req.url is empty string, || '/' provides the fallback.
        // We use a raw TCP socket to send an HTTP request with an empty request path.
        const net = require('net');
        const result = await new Promise<{ status: number; data: string }>((resolve, reject) => {
            const socket = new net.Socket();
            socket.connect(port, 'localhost', () => {
                // Send a raw HTTP/1.1 request with an empty path (just a space before HTTP/1.1)
                // This makes Node's HTTP parser set req.url to '' (empty string)
                socket.write('GET  HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
            });
            let responseData = '';
            socket.on('data', (chunk: Buffer) => {
                responseData += chunk.toString();
            });
            socket.on('end', () => {
                const statusMatch = responseData.match(/HTTP\/1\.1 (\d+)/);
                const status = statusMatch ? parseInt(statusMatch[1]) : 0;
                resolve({ status, data: responseData });
            });
            socket.on('error', reject);
            // Safety timeout
            setTimeout(() => {
                socket.destroy();
                resolve({ status: 0, data: responseData });
            }, 3000);
        });
        // The server should respond (either 200 for root '/' or 404)
        // The key is that it doesn't crash — the || '/' fallback prevents URL parse error
        expect(result.status).toBeGreaterThan(0);
    });
});
