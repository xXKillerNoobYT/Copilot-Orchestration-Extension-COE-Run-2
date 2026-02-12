import * as http from 'http';
import { LLMService } from '../src/core/llm-service';
import { LLMConfig } from '../src/types';

// Mock vscode
jest.mock('vscode', () => require('./__mocks__/vscode'));

describe('LLMService', () => {
    let llmService: LLMService;
    let mockServer: http.Server;
    let serverPort: number = 0;
    const outputChannel = {
        appendLine: jest.fn(),
        show: jest.fn(),
        dispose: jest.fn(),
    } as any;

    function createConfig(overrides?: Partial<LLMConfig>): LLMConfig {
        return {
            endpoint: `http://127.0.0.1:${serverPort}/v1`,
            model: 'test-model',
            timeoutSeconds: 10,
            startupTimeoutSeconds: 5,
            streamStallTimeoutSeconds: 3,
            maxTokens: 100,
            ...overrides,
        };
    }

    function startMockLLM(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<void> {
        return new Promise((resolve) => {
            mockServer = http.createServer(handler);
            mockServer.listen(0, '127.0.0.1', () => {
                const addr = mockServer.address() as { port: number };
                serverPort = addr.port;
                resolve();
            });
        });
    }

    afterEach(async () => {
        if (mockServer) {
            // Force-close all open connections so server.close() completes promptly
            mockServer.closeAllConnections?.();
            await new Promise<void>((resolve) => {
                mockServer.close(() => resolve());
            });
            mockServer = undefined as any;
        }
    });

    test('non-streaming chat returns response', async () => {
        await startMockLLM((req, res) => {
            if (req.url?.includes('/chat/completions')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    choices: [{
                        message: { content: 'Hello from LLM' },
                        finish_reason: 'stop',
                    }],
                    usage: { total_tokens: 25 },
                }));
            }
        });

        llmService = new LLMService(createConfig(), outputChannel);
        const response = await llmService.chat(
            [{ role: 'user', content: 'Hi' }],
            { stream: false }
        );

        expect(response.content).toBe('Hello from LLM');
        expect(response.tokens_used).toBe(25);
        expect(response.finish_reason).toBe('stop');
    });

    test('streaming chat returns accumulated response', async () => {
        await startMockLLM((req, res) => {
            if (req.url?.includes('/chat/completions')) {
                res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                res.write('data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n');
                setTimeout(() => {
                    res.write('data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}\n\n');
                    res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
                    res.write('data: [DONE]\n\n');
                    res.end();
                }, 50);
            }
        });

        llmService = new LLMService(createConfig(), outputChannel);
        const response = await llmService.chat(
            [{ role: 'user', content: 'Hi' }],
            { stream: true }
        );

        expect(response.content).toBe('Hello world');
        expect(response.finish_reason).toBe('stop');
    });

    test('startup timeout when no response', async () => {
        await startMockLLM((_req, _res) => {
            // Never respond — simulates startup timeout
        });

        llmService = new LLMService(createConfig({
            startupTimeoutSeconds: 1,
            timeoutSeconds: 2,
        }), outputChannel);

        await expect(
            llmService.chat([{ role: 'user', content: 'Hi' }], { stream: true })
        ).rejects.toThrow(/timeout/i);
    }, 10000);

    test('API error returns meaningful message', async () => {
        await startMockLLM((req, res) => {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Model overloaded' }));
        });

        llmService = new LLMService(createConfig(), outputChannel);
        await expect(
            llmService.chat([{ role: 'user', content: 'Hi' }], { stream: false })
        ).rejects.toThrow(/500/);
    });

    test('queue rejects when full', async () => {
        // The queue checks happen synchronously before processing starts.
        // First call starts processing (queue empty, goes straight to execute).
        // We need the first call to be slow so it blocks the queue.
        await startMockLLM((_req, res) => {
            // Delay response to keep the first request in-flight
            setTimeout(() => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
                    usage: { total_tokens: 1 },
                }));
            }, 2000);
        });

        llmService = new LLMService(createConfig(), outputChannel);
        // @ts-ignore — access private member for test
        llmService['maxQueueSize'] = 1;

        // First call will start processing immediately (not queued)
        const p1 = llmService.chat([{ role: 'user', content: '1' }], { stream: false });

        // Give a tick for processing to start
        await new Promise(r => setTimeout(r, 50));

        // Second call should queue successfully
        const p2 = llmService.chat([{ role: 'user', content: '2' }], { stream: false });

        // Third call should fail — queue is full (1 max)
        await expect(
            llmService.chat([{ role: 'user', content: '3' }], { stream: false })
        ).rejects.toThrow(/queue full/i);

        // Clean up — wait for pending requests to complete
        await Promise.allSettled([p1, p2]);
    }, 15000);

    test('testConnection returns success', async () => {
        await startMockLLM((req, res) => {
            if (req.url?.includes('/models')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    data: [{ id: 'test-model' }, { id: 'other-model' }],
                }));
            }
        });

        llmService = new LLMService(createConfig(), outputChannel);
        const result = await llmService.testConnection();

        expect(result.success).toBe(true);
        expect(result.message).toContain('2 models');
        expect(result.latencyMs).toBeDefined();
    });

    test('testConnection returns failure on unreachable server', async () => {
        serverPort = 19999; // Nothing listening here
        llmService = new LLMService(createConfig(), outputChannel);

        const result = await llmService.testConnection();
        expect(result.success).toBe(false);
    });

    test('classify returns a valid category', async () => {
        await startMockLLM((req, res) => {
            if (req.url?.includes('/chat/completions')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    choices: [{ message: { content: 'planning' }, finish_reason: 'stop' }],
                    usage: { total_tokens: 5 },
                }));
            }
        });

        llmService = new LLMService(createConfig(), outputChannel);
        const result = await llmService.classify('Create a task plan', ['planning', 'verification', 'question']);
        expect(result).toBe('planning');
    });

    test('score returns a number 0-100', async () => {
        await startMockLLM((req, res) => {
            if (req.url?.includes('/chat/completions')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    choices: [{ message: { content: '85' }, finish_reason: 'stop' }],
                    usage: { total_tokens: 5 },
                }));
            }
        });

        llmService = new LLMService(createConfig(), outputChannel);
        const score = await llmService.score('This is a clear answer', 'clarity and completeness');
        expect(score).toBe(85);
    });
});
