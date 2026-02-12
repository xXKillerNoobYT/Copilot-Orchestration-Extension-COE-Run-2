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
});
