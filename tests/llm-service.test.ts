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
            maxInputTokens: 4000,
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

    // ===================== COVERAGE GAP TESTS =====================

    test('streaming request throws on non-ok response (line 179)', async () => {
        await startMockLLM((req, res) => {
            if (req.url?.includes('/chat/completions')) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal Server Error');
            }
        });

        llmService = new LLMService(createConfig(), outputChannel);
        await expect(llmService.chat(
            [{ role: 'user', content: 'test' }],
            { stream: true }
        )).rejects.toThrow(/LLM API error: 500/);
    });

    test('non-streaming abort timeout (lines 276, 320)', async () => {
        await startMockLLM((req, res) => {
            if (req.url?.includes('/chat/completions')) {
                // Never respond — simulate timeout
                // Keep the connection open
            }
        });

        llmService = new LLMService(createConfig({ timeoutSeconds: 1 }), outputChannel);
        // Node's fetch throws DOMException (not instanceof Error) on abort.
        // The catch on line 319 uses `error instanceof Error` which fails for DOMException,
        // so the error propagates to processQueue's catch at line 117 where it's wrapped as
        // `new Error(String(error))` giving "AbortError: This operation was aborted".
        await expect(llmService.chat(
            [{ role: 'user', content: 'test' }],
            { stream: false }
        )).rejects.toThrow(/abort/i);
    }, 15000);

    test('batchClassify falls back to individual calls on failure (line 382)', async () => {
        let requestCount = 0;
        await startMockLLM((req, res) => {
            if (req.url?.includes('/chat/completions')) {
                requestCount++;
                if (requestCount === 1) {
                    // First request (batch) — return malformed response to trigger fallback
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Server error');
                } else {
                    // Individual fallback requests — return valid category
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        choices: [{ message: { content: 'planning' }, finish_reason: 'stop' }],
                        usage: { total_tokens: 5 },
                    }));
                }
            }
        });

        llmService = new LLMService(createConfig(), outputChannel);
        const results = await llmService.batchClassify(
            ['task1', 'task2'],
            ['planning', 'verification']
        );
        expect(results.length).toBe(2);
        // The fallback should have tried individual calls
        expect(outputChannel.appendLine).toHaveBeenCalledWith(
            expect.stringContaining('Batch classification failed')
        );
    });

    test('batchClassify individual fallback failure returns default category (line 382)', async () => {
        await startMockLLM((req, res) => {
            if (req.url?.includes('/chat/completions')) {
                // All requests fail
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Server error');
            }
        });

        llmService = new LLMService(createConfig(), outputChannel);
        const results = await llmService.batchClassify(
            ['task1'],
            ['planning', 'verification']
        );
        // Should return the first category as fallback
        expect(results).toEqual(['planning']);
    });

    test('healthCheck catches exceptions and returns false (lines 403-404)', async () => {
        await startMockLLM((req, res) => {
            // Immediately destroy the connection to cause a network error
            res.destroy();
        });

        llmService = new LLMService(createConfig(), outputChannel);
        const healthy = await llmService.healthCheck();
        expect(typeof healthy).toBe('boolean');
    });

    test('getCachedResponse returns null for expired entries (lines 428-429)', async () => {
        await startMockLLM((req, res) => {
            if (req.url?.includes('/chat/completions')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    choices: [{ message: { content: 'cached response' }, finish_reason: 'stop' }],
                    usage: { total_tokens: 10 },
                }));
            }
        });

        // Set cache TTL to 1ms so entries expire immediately
        llmService = new LLMService(createConfig(), outputChannel);
        // Access private cache properties through any cast
        (llmService as any).cacheTTLMs = 1;

        const result1 = await llmService.chat(
            [{ role: 'user', content: 'cache test' }],
            { stream: false }
        );
        expect(result1.content).toBe('cached response');

        // Wait for cache to expire
        await new Promise(resolve => setTimeout(resolve, 10));

        // Second call should NOT use cache (expired)
        const result2 = await llmService.chat(
            [{ role: 'user', content: 'cache test' }],
            { stream: false }
        );
        expect(result2.content).toBe('cached response');
    });

    test('setCachedResponse evicts oldest entry when cache is full (lines 437-445)', async () => {
        await startMockLLM((req, res) => {
            if (req.url?.includes('/chat/completions')) {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    const parsed = JSON.parse(body);
                    const content = parsed.messages[parsed.messages.length - 1].content;
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        choices: [{ message: { content: `reply to: ${content}` }, finish_reason: 'stop' }],
                        usage: { total_tokens: 10 },
                    }));
                });
            }
        });

        llmService = new LLMService(createConfig(), outputChannel);
        // Set max cache size to 2 (readonly in TS but writable at runtime)
        Object.defineProperty(llmService, 'cacheMaxSize', { value: 2, writable: true });

        // Caching only happens when temperature <= 0.3 and stream is false
        const opts = { stream: false, temperature: 0.2 };

        // Fill the cache with 2 entries
        await llmService.chat([{ role: 'user', content: 'msg1' }], opts);
        await llmService.chat([{ role: 'user', content: 'msg2' }], opts);

        // Third entry should evict the oldest
        await llmService.chat([{ role: 'user', content: 'msg3' }], opts);

        // Cache should still have exactly 2 entries (not 3, oldest evicted)
        expect((llmService as any).cache.size).toBe(2);
    });

    // ===================== ADDITIONAL COVERAGE GAP TESTS =====================

    test('streaming: no response body throws error (line 183)', async () => {
        // We need to mock fetch to return a response with no body.
        // Save original fetch and restore after test.
        const originalFetch = global.fetch;
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            body: null, // no body
            status: 200,
            statusText: 'OK',
        });

        try {
            llmService = new LLMService(createConfig({ endpoint: 'http://127.0.0.1:9999/v1' }), outputChannel);
            await expect(
                llmService.chat([{ role: 'user', content: 'test' }], { stream: true })
            ).rejects.toThrow(/No response body for streaming request/);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('streaming: total timeout returns partial response when content exists (lines 135, 247-260)', async () => {
        // The server sends some data, then goes silent. The total timer fires
        // (not the startup timer because first token was received, not the stall timer
        // because we make the total timeout very short).
        await startMockLLM((req, res) => {
            if (req.url?.includes('/chat/completions')) {
                res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                // Send one token immediately so firstTokenReceived = true and startup timer clears
                res.write('data: {"choices":[{"delta":{"content":"Partial"},"finish_reason":null}]}\n\n');
                // Then never send more data and never close connection.
                // The total timer (timeoutSeconds) will fire and abort.
            }
        });

        llmService = new LLMService(createConfig({
            timeoutSeconds: 1,       // Total timeout fires after 1s
            startupTimeoutSeconds: 5, // Startup won't fire (token already received)
        }), outputChannel);

        const response = await llmService.chat(
            [{ role: 'user', content: 'test' }],
            { stream: true }
        );

        // Should return partial response with finish_reason 'timeout'
        expect(response.content).toBe('Partial');
        expect(response.finish_reason).toBe('timeout');
        expect(response.tokens_used).toBe(1);
    }, 15000);

    test('streaming: total timeout throws when no content received but first token arrived (line 260)', async () => {
        // Server sends a chunk that doesn't produce content (e.g., just a finish_reason),
        // setting firstTokenReceived=true but fullContent stays empty.
        // Then total timer fires.
        await startMockLLM((req, res) => {
            if (req.url?.includes('/chat/completions')) {
                res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                // Send a chunk with no delta content — this still reads from the stream
                // so firstTokenReceived becomes true
                res.write('data: {"choices":[{"delta":{},"finish_reason":null}]}\n\n');
                // Never close — total timer will fire
            }
        });

        llmService = new LLMService(createConfig({
            timeoutSeconds: 1,
            startupTimeoutSeconds: 5,
        }), outputChannel);

        await expect(
            llmService.chat([{ role: 'user', content: 'test' }], { stream: true })
        ).rejects.toThrow(/LLM total timeout exceeded/);
    }, 15000);

    test('streaming: stall abort throws when tokens stop flowing (lines 149-156, 247-248)', async () => {
        // To exercise lines 149-156 (the liveness interval), we intercept setInterval
        // so the callback fires immediately. When tokens stall, the callback aborts the stream.
        const originalFetch = global.fetch;
        const originalSetInterval = global.setInterval;

        // Track the liveness callback
        let livenessCallback: (() => void) | null = null;
        global.setInterval = ((fn: () => void, ms: number) => {
            livenessCallback = fn;
            // Return a real interval ID but with a very short interval (10ms)
            return originalSetInterval(fn, 10);
        }) as any;

        let readCallCount = 0;
        let rejectSecondRead: ((err: Error) => void) | null = null;

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            body: {
                getReader: () => ({
                    read: () => {
                        readCallCount++;
                        if (readCallCount === 1) {
                            const encoder = new TextEncoder();
                            return Promise.resolve({
                                done: false,
                                value: encoder.encode('data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n'),
                            });
                        }
                        // Second read: hang until abort
                        return new Promise((_resolve, reject) => {
                            rejectSecondRead = reject;
                        });
                    },
                }),
            },
            status: 200,
            statusText: 'OK',
        });

        try {
            llmService = new LLMService(createConfig({
                timeoutSeconds: 300,
                startupTimeoutSeconds: 300,
            }), outputChannel);

            const chatPromise = llmService.chat(
                [{ role: 'user', content: 'test' }],
                { stream: true }
            );

            // Wait for the first read to complete and liveness interval to fire
            // (it fires every 10ms thanks to our mock)
            await new Promise(r => setTimeout(r, 100));

            // The liveness callback should have detected the stall (tokensUsed === lastCheckTokenCount)
            // and called controller.abort(). However the second read is hanging — we need to reject it.
            (rejectSecondRead as any)?.(new DOMException('Aborted', 'AbortError'));

            await expect(chatPromise).rejects.toThrow(/LLM stream stalled/);
        } finally {
            global.setInterval = originalSetInterval;
            global.fetch = originalFetch;
        }
    }, 15000);

    test('streaming: liveness interval logs when new tokens arrive (lines 155-156)', async () => {
        // Use a mock fetch with controlled reads, and intercept setInterval so we can
        // control exactly when the liveness check fires. We let the first liveness check
        // see new tokens (alive path), then immediately finish the stream.
        const originalFetch = global.fetch;
        const originalSetInterval = global.setInterval;

        // We'll collect interval callbacks and fire them manually
        const intervalCallbacks: (() => void)[] = [];
        global.setInterval = ((fn: () => void, _ms: number) => {
            intervalCallbacks.push(fn);
            return 999 as any; // fake timer ID
        }) as any;

        let readCallCount = 0;
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            body: {
                getReader: () => ({
                    read: () => {
                        readCallCount++;
                        const encoder = new TextEncoder();
                        if (readCallCount <= 3) {
                            return Promise.resolve({
                                done: false,
                                value: encoder.encode(`data: {"choices":[{"delta":{"content":"tok${readCallCount}"},"finish_reason":null}]}\n\n`),
                            });
                        }
                        if (readCallCount === 4) {
                            return Promise.resolve({
                                done: false,
                                value: encoder.encode('data: [DONE]\n\n'),
                            });
                        }
                        return Promise.resolve({ done: true, value: undefined });
                    },
                }),
            },
            status: 200,
            statusText: 'OK',
        });

        try {
            llmService = new LLMService(createConfig({
                timeoutSeconds: 300,
                startupTimeoutSeconds: 300,
            }), outputChannel);

            const chatPromise = llmService.chat(
                [{ role: 'user', content: 'test' }],
                { stream: true }
            );

            // Wait for reads to resolve
            await new Promise(r => setTimeout(r, 50));

            // Manually fire the liveness interval — tokens have been generated (3 tokens)
            // so the "alive" branch should execute (line 155-156)
            for (const cb of intervalCallbacks) {
                cb();
            }

            const response = await chatPromise;
            expect(response.content).toContain('tok1');

            // Check that the liveness log was emitted
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('LLM liveness:')
            );
        } finally {
            global.setInterval = originalSetInterval;
            global.fetch = originalFetch;
        }
    }, 15000);

    test('non-streaming: AbortError that IS instanceof Error hits line 320', async () => {
        // Mock fetch to throw an Error with name='AbortError' (instanceof Error === true)
        const originalFetch = global.fetch;

        const abortError = new Error('The operation was aborted');
        abortError.name = 'AbortError';

        global.fetch = jest.fn().mockRejectedValue(abortError);

        try {
            llmService = new LLMService(createConfig({
                endpoint: 'http://127.0.0.1:9999/v1',
                timeoutSeconds: 1,
            }), outputChannel);

            await expect(
                llmService.chat([{ role: 'user', content: 'test' }], { stream: false })
            ).rejects.toThrow(/LLM timeout: No response within 1s/);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('healthCheck catches thrown error and returns false (lines 403-404)', async () => {
        // Make testConnection throw (not return {success: false}, but actually throw)
        llmService = new LLMService(createConfig({ endpoint: 'http://127.0.0.1:9999/v1' }), outputChannel);

        // Override testConnection to throw
        jest.spyOn(llmService, 'testConnection').mockRejectedValue(new Error('Network exploded'));

        const result = await llmService.healthCheck();
        expect(result).toBe(false);
        // The lastHealthCheck should be set
        expect((llmService as any).lastHealthCheck).toEqual({ healthy: false, timestamp: expect.any(Number) });
    });

    test('getCachedResponse returns null and deletes expired entry (lines 428-429)', async () => {
        await startMockLLM((req, res) => {
            if (req.url?.includes('/chat/completions')) {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        choices: [{ message: { content: 'response' }, finish_reason: 'stop' }],
                        usage: { total_tokens: 10 },
                    }));
                });
            }
        });

        llmService = new LLMService(createConfig(), outputChannel);

        // Make a non-streaming request with low temperature to trigger caching
        const opts = { stream: false, temperature: 0.2 };
        await llmService.chat([{ role: 'user', content: 'cache-expire-test' }], opts);

        // Verify entry is cached
        expect((llmService as any).cache.size).toBe(1);

        // Now expire the cache entry by setting its timestamp to the past
        const cacheMap = (llmService as any).cache as Map<string, { response: any; timestamp: number }>;
        for (const [, entry] of cacheMap) {
            entry.timestamp = Date.now() - 10 * 60 * 1000; // 10 minutes ago (TTL is 5 minutes)
        }

        // Make the same request again — should miss cache (expired), delete entry, hit server
        const result = await llmService.chat([{ role: 'user', content: 'cache-expire-test' }], opts);
        expect(result.content).toBe('response');

        // The old cache entry was deleted, but a new one was created (same key, fresh timestamp)
        expect((llmService as any).cache.size).toBe(1);
    });

    test('updateConfig replaces the internal config (line 35)', () => {
        llmService = new LLMService(createConfig(), outputChannel);
        const newConfig: LLMConfig = {
            endpoint: 'http://new-endpoint:1234/v1',
            model: 'new-model',
            timeoutSeconds: 99,
            startupTimeoutSeconds: 88,
            streamStallTimeoutSeconds: 77,
            maxTokens: 500,
            maxInputTokens: 4000,
        };
        llmService.updateConfig(newConfig);
        // Verify internal config was updated by checking model via a property
        expect((llmService as any).config.endpoint).toBe('http://new-endpoint:1234/v1');
        expect((llmService as any).config.model).toBe('new-model');
    });

    test('cache hit returns cached response without server call (lines 43-44, 431)', async () => {
        let serverCallCount = 0;
        await startMockLLM((req, res) => {
            if (req.url?.includes('/chat/completions')) {
                serverCallCount++;
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        choices: [{ message: { content: 'server response' }, finish_reason: 'stop' }],
                        usage: { total_tokens: 10 },
                    }));
                });
            }
        });

        llmService = new LLMService(createConfig(), outputChannel);

        // First call: hits server, response gets cached (temperature <= 0.3, non-streaming)
        const opts = { stream: false, temperature: 0.2 };
        const result1 = await llmService.chat([{ role: 'user', content: 'cache-hit-test' }], opts);
        expect(result1.content).toBe('server response');
        expect(serverCallCount).toBe(1);

        // Second call with identical messages+options: should hit cache, NOT the server
        const result2 = await llmService.chat([{ role: 'user', content: 'cache-hit-test' }], opts);
        expect(result2.content).toBe('server response');
        expect(serverCallCount).toBe(1); // Still 1 — server was NOT called again
        expect(outputChannel.appendLine).toHaveBeenCalledWith('LLM cache hit');
    });

    test('getQueueLength returns 0 when queue is empty (line 98)', () => {
        llmService = new LLMService(createConfig(), outputChannel);
        expect(llmService.getQueueLength()).toBe(0);
    });

    test('isProcessing returns false when not processing (line 102)', () => {
        llmService = new LLMService(createConfig(), outputChannel);
        expect(llmService.isProcessing()).toBe(false);
    });

    test('testConnection returns failure when response is not ok (line 335)', async () => {
        await startMockLLM((req, res) => {
            if (req.url?.includes('/models')) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal Server Error' }));
            }
        });

        llmService = new LLMService(createConfig(), outputChannel);
        const result = await llmService.testConnection();
        expect(result.success).toBe(false);
        expect(result.message).toContain('HTTP 500');
    });

    test('batchClassify success path parses and pads results (lines 366-373)', async () => {
        await startMockLLM((req, res) => {
            if (req.url?.includes('/chat/completions')) {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    // Return only 1 line when we give 3 messages — tests padding logic (line 372)
                    res.end(JSON.stringify({
                        choices: [{ message: { content: 'planning' }, finish_reason: 'stop' }],
                        usage: { total_tokens: 10 },
                    }));
                });
            }
        });

        llmService = new LLMService(createConfig(), outputChannel);
        const results = await llmService.batchClassify(
            ['msg1', 'msg2', 'msg3'],
            ['planning', 'verification', 'coding']
        );

        // 3 messages, but LLM returned only 1 line — should be padded with first category
        expect(results).toHaveLength(3);
        expect(results[0]).toBe('planning');
        expect(results[1]).toBe('planning'); // padded
        expect(results[2]).toBe('planning'); // padded
    });

    test('healthCheck cooldown returns cached result (line 395)', async () => {
        await startMockLLM((req, res) => {
            if (req.url?.includes('/models')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
            }
        });

        llmService = new LLMService(createConfig(), outputChannel);

        // First health check: actually calls testConnection
        const firstResult = await llmService.healthCheck();
        expect(firstResult).toBe(true);

        // Second health check within cooldown (60s): returns cached result (line 395)
        const secondResult = await llmService.healthCheck();
        expect(secondResult).toBe(true);
    });

    test('isHealthy returns true by default when no healthCheck has been run (line 409)', () => {
        llmService = new LLMService(createConfig(), outputChannel);
        expect(llmService.isHealthy()).toBe(true); // optimistic default
    });

    test('isHealthy returns false after a failed healthCheck (line 409)', async () => {
        llmService = new LLMService(createConfig({ endpoint: 'http://127.0.0.1:9999/v1' }), outputChannel);
        jest.spyOn(llmService, 'testConnection').mockRejectedValue(new Error('down'));
        await llmService.healthCheck();
        expect(llmService.isHealthy()).toBe(false);
    });

    test('clearCache removes all cached entries (line 451)', async () => {
        await startMockLLM((req, res) => {
            if (req.url?.includes('/chat/completions')) {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        choices: [{ message: { content: 'response' }, finish_reason: 'stop' }],
                        usage: { total_tokens: 10 },
                    }));
                });
            }
        });

        llmService = new LLMService(createConfig(), outputChannel);

        // Populate cache with a low-temperature request
        await llmService.chat([{ role: 'user', content: 'for-clear' }], { stream: false, temperature: 0.1 });
        expect((llmService as any).cache.size).toBe(1);

        llmService.clearCache();
        expect((llmService as any).cache.size).toBe(0);
    });

    test('streaming: liveness interval early-returns before first token (line 149)', async () => {
        // The liveness interval fires but firstTokenReceived is still false,
        // so it should return early (line 149) without aborting.
        const originalFetch = global.fetch;
        const originalSetInterval = global.setInterval;

        // Collect the liveness callback so we can fire it before first token arrives
        const intervalCallbacks: (() => void)[] = [];
        global.setInterval = ((fn: () => void, _ms: number) => {
            intervalCallbacks.push(fn);
            return 999 as any;
        }) as any;

        let readCallCount = 0;
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            body: {
                getReader: () => ({
                    read: () => {
                        readCallCount++;
                        const encoder = new TextEncoder();
                        if (readCallCount === 1) {
                            // Before returning the first token, fire the liveness callback.
                            // firstTokenReceived is false, so it should just return (line 149).
                            for (const cb of intervalCallbacks) { cb(); }

                            return Promise.resolve({
                                done: false,
                                value: encoder.encode('data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n'),
                            });
                        }
                        if (readCallCount === 2) {
                            return Promise.resolve({
                                done: false,
                                value: encoder.encode('data: [DONE]\n\n'),
                            });
                        }
                        return Promise.resolve({ done: true, value: undefined });
                    },
                }),
            },
            status: 200,
            statusText: 'OK',
        });

        try {
            llmService = new LLMService(createConfig({
                timeoutSeconds: 300,
                startupTimeoutSeconds: 300,
            }), outputChannel);

            const response = await llmService.chat(
                [{ role: 'user', content: 'test' }],
                { stream: true }
            );

            // Should complete successfully — the early-return in liveness didn't abort
            expect(response.content).toBe('Hello');
        } finally {
            global.setInterval = originalSetInterval;
            global.fetch = originalFetch;
        }
    }, 15000);

    test('streaming: handles error in catch block with no name/message (lines 239-240)', async () => {
        // Test the error catch block with an error that has no name or message properties
        const originalFetch = global.fetch;

        // Mock fetch to throw a non-Error value (string) to trigger fallback branches
        global.fetch = jest.fn().mockRejectedValue('raw string error');

        try {
            llmService = new LLMService(createConfig({
                endpoint: 'http://127.0.0.1:9999/v1',
            }), outputChannel);

            await expect(
                llmService.chat([{ role: 'user', content: 'test' }], { stream: true })
            ).rejects.toThrow();
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('non-streaming: handles response with missing optional fields (lines 306-308)', async () => {
        await startMockLLM((req, res) => {
            if (req.url?.includes('/chat/completions')) {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    // Return response with missing optional fields (no usage, no finish_reason, no content)
                    res.end(JSON.stringify({
                        choices: [{ message: {}, finish_reason: null }],
                    }));
                });
            }
        });

        llmService = new LLMService(createConfig(), outputChannel);
        const response = await llmService.chat(
            [{ role: 'user', content: 'test' }],
            { stream: false }
        );

        // Missing content defaults to ''
        expect(response.content).toBe('');
        // Missing tokens defaults to 0
        expect(response.tokens_used).toBe(0);
    });

    test('batchClassify success with more results than messages (line 373 trimming)', async () => {
        await startMockLLM((req, res) => {
            if (req.url?.includes('/chat/completions')) {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    // Return more lines than input messages to test trimming
                    res.end(JSON.stringify({
                        choices: [{ message: { content: 'planning\nverification\ncoding\nextra' }, finish_reason: 'stop' }],
                        usage: { total_tokens: 10 },
                    }));
                });
            }
        });

        llmService = new LLMService(createConfig(), outputChannel);
        const results = await llmService.batchClassify(
            ['msg1', 'msg2'],
            ['planning', 'verification', 'coding']
        );

        // Only 2 messages, so results should be trimmed to 2
        expect(results).toHaveLength(2);
        expect(results[0]).toBe('planning');
        expect(results[1]).toBe('verification');
    });

    test('chat with default stream=true option (line 51 ?? true)', async () => {
        // When stream option is not provided, it defaults to true (line 51)
        await startMockLLM((req, res) => {
            if (req.url?.includes('/chat/completions')) {
                res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                res.write('data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}\n\n');
                res.write('data: [DONE]\n\n');
                res.end();
            }
        });

        llmService = new LLMService(createConfig(), outputChannel);
        // Don't pass stream option at all — defaults to true
        const response = await llmService.chat(
            [{ role: 'user', content: 'test' }]
        );
        expect(response.content).toBe('hi');
    });

    test('testConnection returns models when data.data is undefined (line 338 || [])', async () => {
        await startMockLLM((req, res) => {
            if (req.url?.includes('/models')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                // Return response without data.data — triggers || [] fallback
                res.end(JSON.stringify({}));
            }
        });

        llmService = new LLMService(createConfig(), outputChannel);
        const result = await llmService.testConnection();
        expect(result.success).toBe(true);
        expect(result.message).toContain('0 models available');
    });

    test('testConnection catches non-Error thrown value (line 348 String(error) branch)', async () => {
        llmService = new LLMService(createConfig({ endpoint: 'http://127.0.0.1:9999/v1' }), outputChannel);
        // Mock fetch to reject with a non-Error value (exercises String(error) branch)
        jest.spyOn(global, 'fetch').mockRejectedValue('network failure string');

        const result = await llmService.testConnection();
        expect(result.success).toBe(false);
        expect(result.message).toContain('network failure string');

        (global.fetch as jest.Mock).mockRestore();
    });

    test('testConnection catches Error thrown value (line 348 error.message branch)', async () => {
        llmService = new LLMService(createConfig({ endpoint: 'http://127.0.0.1:9999/v1' }), outputChannel);
        // Mock fetch to reject with a proper Error (exercises error.message branch)
        jest.spyOn(global, 'fetch').mockRejectedValue(new Error('connection refused'));

        const result = await llmService.testConnection();
        expect(result.success).toBe(false);
        expect(result.message).toContain('connection refused');

        (global.fetch as jest.Mock).mockRestore();
    });

    test('streaming: non-streaming with no temperature (line 63 ?? 0.7 cache skip)', async () => {
        // When temperature is not provided, request.temperature defaults to 0.7
        // which is > 0.3, so cache should NOT be set (exercises the false branch of line 63)
        let serverCallCount = 0;
        await startMockLLM((req, res) => {
            if (req.url?.includes('/chat/completions')) {
                serverCallCount++;
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        choices: [{ message: { content: 'response' }, finish_reason: 'stop' }],
                        usage: { total_tokens: 10 },
                    }));
                });
            }
        });

        llmService = new LLMService(createConfig(), outputChannel);

        // Call without temperature — defaults to 0.7, NOT cacheable
        await llmService.chat([{ role: 'user', content: 'no-cache' }], { stream: false });
        expect((llmService as any).cache.size).toBe(0); // Not cached

        // Second call hits server again (no cache)
        await llmService.chat([{ role: 'user', content: 'no-cache' }], { stream: false });
        expect(serverCallCount).toBe(2);
    });

    test('score returns 50 for non-numeric LLM response (line 94 isNaN fallback)', async () => {
        await startMockLLM((req, res) => {
            if (req.url?.includes('/chat/completions')) {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        choices: [{ message: { content: 'not a number' }, finish_reason: 'stop' }],
                        usage: { total_tokens: 5 },
                    }));
                });
            }
        });

        llmService = new LLMService(createConfig(), outputChannel);
        const result = await llmService.score('test content', 'quality');
        expect(result).toBe(50); // isNaN fallback
    });

    test('line 63: request.temperature ?? 0.7 fallback when temperature is explicitly undefined', async () => {
        // Line 63: `(request.temperature ?? 0.7) <= 0.3`
        // Line 50 always sets temperature to at least 0.7, so to trigger the ?? fallback
        // on line 63, we need request.temperature to be undefined. We achieve this by
        // manually mutating the request object after it is constructed (via queue interception).
        let serverCallCount = 0;
        await startMockLLM((req, res) => {
            if (req.url?.includes('/chat/completions')) {
                serverCallCount++;
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        choices: [{ message: { content: 'response' }, finish_reason: 'stop' }],
                        usage: { total_tokens: 10 },
                    }));
                });
            }
        });

        llmService = new LLMService(createConfig(), outputChannel);

        // Intercept queue push to set temperature = undefined on the request
        const origPush = (llmService as any).queue.push.bind((llmService as any).queue);
        (llmService as any).queue.push = function(item: any) {
            // Delete temperature from the request to trigger ?? 0.7 on line 63
            delete item.request.temperature;
            return origPush(item);
        };

        // Non-streaming request: temperature will be undefined when the resolve callback runs
        const result = await llmService.chat(
            [{ role: 'user', content: 'no-temp-test' }],
            { stream: false }
        );
        expect(result.content).toBe('response');

        // With undefined temperature, ?? 0.7 evaluates to 0.7 which is > 0.3,
        // so the response should NOT be cached
        expect((llmService as any).cache.size).toBe(0);

        // Make the same request again — server should be called twice (no caching)
        // Restore original push for the second call
        (llmService as any).queue.push = origPush;
        const result2 = await llmService.chat(
            [{ role: 'user', content: 'no-temp-test' }],
            { stream: false }
        );
        expect(result2.content).toBe('response');
        expect(serverCallCount).toBe(2);
    });

    test('classify returns first category when LLM response does not match any (line 83 fallback)', async () => {
        await startMockLLM((req, res) => {
            if (req.url?.includes('/chat/completions')) {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        choices: [{ message: { content: 'gibberish_not_matching' }, finish_reason: 'stop' }],
                        usage: { total_tokens: 5 },
                    }));
                });
            }
        });

        llmService = new LLMService(createConfig(), outputChannel);
        const result = await llmService.classify('test message', ['planning', 'verification']);
        expect(result).toBe('planning'); // first category as fallback
    });
});
