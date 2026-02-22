import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../src/core/database';
import { LLMService } from '../src/core/llm-service';
import { ConfigManager } from '../src/core/config';
import { Orchestrator } from '../src/agents/orchestrator';
import { MCPServer } from '../src/mcp/server';

// Mock vscode
jest.mock('vscode', () => require('./__mocks__/vscode'));

/**
 * MCP JSON-RPC 2.0 Protocol Compliance Tests
 *
 * Verifies the POST /mcp endpoint conforms to the JSON-RPC 2.0 spec
 * as required by the Model Context Protocol.
 */
describe('MCP JSON-RPC Protocol Compliance', () => {
    let db: Database;
    let tmpDir: string;
    let mcpServer: MCPServer;
    let port: number;
    let mockLLMServer: http.Server;
    let llmPort: number;

    // Helper: send a JSON-RPC request to POST /mcp
    function rpcRequest(body: string): Promise<{ status: number; body: any }> {
        return new Promise((resolve, reject) => {
            const req = http.request(
                {
                    hostname: 'localhost',
                    port,
                    path: '/mcp',
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                },
                (res) => {
                    let data = '';
                    res.on('data', (chunk) => { data += chunk; });
                    res.on('end', () => {
                        try {
                            resolve({ status: res.statusCode!, body: JSON.parse(data) });
                        } catch {
                            resolve({ status: res.statusCode!, body: data });
                        }
                    });
                }
            );
            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    beforeAll(async () => {
        // Start a mock LLM server so the Orchestrator can initialize its agents
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

        // Set up database in a temp directory
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-mcp-proto-'));
        db = new Database(tmpDir);
        await db.initialize();

        // Create output channel mock
        const outputChannel = {
            appendLine: jest.fn(),
            show: jest.fn(),
            dispose: jest.fn(),
        } as any;

        // Create LLM service pointing at our mock server
        const llmConfig = {
            endpoint: `http://localhost:${llmPort}/v1`,
            model: 'test-model',
            timeoutSeconds: 30,
            startupTimeoutSeconds: 10,
            streamStallTimeoutSeconds: 10,
            thinkingTimeoutSeconds: 60,
            maxTokens: 500,
            maxInputTokens: 4000,
            maxRequestRetries: 0,
            maxConcurrentRequests: 4,
            bossReservedSlots: 1,
        };
        const llm = new LLMService(llmConfig, outputChannel);

        // Create a minimal ConfigManager mock
        const config = {
            getConfig: () => ({
                version: '1.0.0',
                llm: llmConfig,
                taskQueue: { maxPending: 20 },
                verification: { delaySeconds: 60, coverageThreshold: 85 },
                watcher: { debounceMs: 500 },
                agents: {},
            }),
            getLLMConfig: () => llmConfig,
            getCOEDir: () => tmpDir,
            getAgentContextLimit: () => 4000,
            getModelMaxOutputTokens: () => 4096,
            getModelContextWindow: () => 32768,
            isAgentEnabled: () => true,
            initialize: jest.fn(),
            dispose: jest.fn(),
        } as unknown as ConfigManager;

        // Create Orchestrator and initialize (registers all sub-agents)
        const orchestrator = new Orchestrator(db, llm, config, outputChannel);
        await orchestrator.initialize();

        // Create and start MCP Server
        mcpServer = new MCPServer(orchestrator, db, config, outputChannel);
        await mcpServer.initialize();
        port = mcpServer.getPort();
    });

    afterAll(async () => {
        // Dispose MCP server and forcefully close all connections
        mcpServer.dispose();
        (mcpServer as any)['server']?.closeAllConnections?.();

        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });

        await new Promise<void>((resolve) => {
            mockLLMServer.closeAllConnections?.();
            mockLLMServer.close(() => resolve());
        });
    });

    // ---------------------------------------------------------------
    // Test 1: initialize method
    // ---------------------------------------------------------------
    test('initialize method returns protocolVersion, capabilities, and serverInfo', async () => {
        const { status, body } = await rpcRequest(JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {},
        }));

        expect(status).toBe(200);
        expect(body.jsonrpc).toBe('2.0');
        expect(body.id).toBe(1);
        expect(body.error).toBeUndefined();

        const result = body.result;
        expect(result).toBeDefined();

        // protocolVersion must be a non-empty string
        expect(typeof result.protocolVersion).toBe('string');
        expect(result.protocolVersion).toBe('2024-11-05');

        // capabilities must declare tools support
        expect(result.capabilities).toBeDefined();
        expect(result.capabilities.tools).toBeDefined();

        // serverInfo must include name and version
        expect(result.serverInfo).toBeDefined();
        expect(result.serverInfo.name).toBe('coe-mcp-server');
        expect(typeof result.serverInfo.version).toBe('string');
        expect(result.serverInfo.version).toBe('1.0.0');
    });

    // ---------------------------------------------------------------
    // Test 2: tools/list returns all 6 tools
    // ---------------------------------------------------------------
    test('tools/list returns all 7 tools with name, description, and inputSchema', async () => {
        const { status, body } = await rpcRequest(JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {},
        }));

        expect(status).toBe(200);
        expect(body.jsonrpc).toBe('2.0');
        expect(body.id).toBe(2);
        expect(body.error).toBeUndefined();

        const tools = body.result.tools;
        expect(Array.isArray(tools)).toBe(true);
        expect(tools.length).toBe(11);

        // Verify each tool has the required MCP fields
        const expectedToolNames = [
            'getNextTask',
            'reportTaskDone',
            'askQuestion',
            'getErrors',
            'callCOEAgent',
            'scanCodeBase',
            'getTicketHistory',
            'getAgentDescriptions',
            'confirmAgentCall',
            'addTicketNote',
            'addTicketReference',
        ];

        const toolNames = tools.map((t: any) => t.name);
        for (const name of expectedToolNames) {
            expect(toolNames).toContain(name);
        }

        // Each tool must have name (string), description (string), and inputSchema (object)
        for (const tool of tools) {
            expect(typeof tool.name).toBe('string');
            expect(tool.name.length).toBeGreaterThan(0);
            expect(typeof tool.description).toBe('string');
            expect(tool.description.length).toBeGreaterThan(0);
            expect(typeof tool.inputSchema).toBe('object');
            expect(tool.inputSchema).not.toBeNull();
            // inputSchema should have a "type" field per JSON Schema
            expect(tool.inputSchema.type).toBe('object');
        }
    });

    // ---------------------------------------------------------------
    // Test 3: tools/call with valid tool returns MCP content format
    // ---------------------------------------------------------------
    test('tools/call with valid tool returns result in MCP content format', async () => {
        // Call getNextTask (no tasks exist, so it will return a "no tasks ready" result)
        const { status, body } = await rpcRequest(JSON.stringify({
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: {
                name: 'getNextTask',
                arguments: {},
            },
        }));

        expect(status).toBe(200);
        expect(body.jsonrpc).toBe('2.0');
        expect(body.id).toBe(3);
        expect(body.error).toBeUndefined();

        // MCP tools/call result must wrap output in content array
        const result = body.result;
        expect(result).toBeDefined();
        expect(Array.isArray(result.content)).toBe(true);
        expect(result.content.length).toBeGreaterThanOrEqual(1);

        // Each content item must have type and text
        const item = result.content[0];
        expect(item.type).toBe('text');
        expect(typeof item.text).toBe('string');

        // The text should be valid JSON containing the tool's response
        const parsed = JSON.parse(item.text);
        expect(typeof parsed).toBe('object');
        // getNextTask with no tasks returns success: false
        expect(parsed.success).toBe(false);
        expect(typeof parsed.error).toBe('string');
    });

    // ---------------------------------------------------------------
    // Test 4: Unknown method returns error code -32601
    // ---------------------------------------------------------------
    test('unknown method returns JSON-RPC error code -32601 (Method not found)', async () => {
        const { status, body } = await rpcRequest(JSON.stringify({
            jsonrpc: '2.0',
            id: 4,
            method: 'nonexistent/method',
            params: {},
        }));

        expect(status).toBe(200);
        expect(body.jsonrpc).toBe('2.0');
        expect(body.id).toBe(4);

        // Must have error, not result
        expect(body.result).toBeUndefined();
        expect(body.error).toBeDefined();
        expect(body.error.code).toBe(-32601);
        expect(typeof body.error.message).toBe('string');
        expect(body.error.message).toContain('Method not found');
    });

    // ---------------------------------------------------------------
    // Test 5: Malformed request (invalid JSON) returns parse error -32700
    // ---------------------------------------------------------------
    test('malformed request with invalid JSON returns parse error code -32700', async () => {
        const { status, body } = await rpcRequest('{ this is not valid JSON !!!');

        expect(status).toBe(200);
        expect(body.jsonrpc).toBe('2.0');
        expect(body.id).toBeNull();

        // Must have error, not result
        expect(body.result).toBeUndefined();
        expect(body.error).toBeDefined();
        expect(body.error.code).toBe(-32700);
        expect(typeof body.error.message).toBe('string');
        expect(body.error.message).toContain('Parse error');
    });
});
