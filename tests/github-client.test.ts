import * as http from 'http';
import { GitHubClient } from '../src/core/github-client';

// Mock vscode
jest.mock('vscode', () => require('./__mocks__/vscode'));

describe('GitHubClient', () => {
    let client: GitHubClient;
    let mockServer: http.Server;
    let serverPort: number = 0;
    const outputChannel = {
        appendLine: jest.fn(),
        show: jest.fn(),
        dispose: jest.fn(),
    } as any;

    // Override the base URL to point to our mock server
    function createClient(): GitHubClient {
        return new GitHubClient('test-token', outputChannel);
    }

    function startMockGitHub(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<void> {
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
            mockServer.closeAllConnections?.();
            await new Promise<void>((resolve) => {
                mockServer.close(() => resolve());
            });
            mockServer = undefined as any;
        }
    });

    // ===================== getIssue (lines 28-29) =====================

    describe('getIssue', () => {
        test('getIssue fetches a single issue by number', async () => {
            await startMockGitHub((req, res) => {
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'X-RateLimit-Remaining': '4999',
                    'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
                });
                res.end(JSON.stringify({
                    id: 12345,
                    number: 42,
                    title: 'Test Issue',
                    body: 'Issue body',
                    state: 'open',
                    labels: [{ name: 'bug' }],
                    assignees: [{ login: 'dev1' }],
                }));
            });

            // We need to override the private request method's URL
            // Since GitHubClient uses hardcoded github.com URLs, we test via
            // the testConnection method which also exercises the request method
            client = createClient();

            // To test getIssue directly, we'll need to monkey-patch fetch
            const originalFetch = global.fetch;
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Map([
                    ['X-RateLimit-Remaining', '4999'],
                    ['X-RateLimit-Reset', String(Math.floor(Date.now() / 1000) + 3600)],
                ]) as any,
                json: async () => ({
                    id: 12345,
                    number: 42,
                    title: 'Test Issue',
                    body: 'Issue body',
                    state: 'open',
                    labels: [{ name: 'bug' }],
                    assignees: [{ login: 'dev1' }],
                }),
            } as any);

            // Mock headers.get
            const mockHeaders = {
                get: (name: string) => {
                    if (name === 'X-RateLimit-Remaining') return '4999';
                    if (name === 'X-RateLimit-Reset') return String(Math.floor(Date.now() / 1000) + 3600);
                    return null;
                },
            };
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: mockHeaders,
                json: async () => ({
                    id: 12345,
                    number: 42,
                    title: 'Test Issue',
                    body: 'Issue body',
                    state: 'open',
                    labels: [{ name: 'bug' }],
                    assignees: [{ login: 'dev1' }],
                }),
            });

            const issue = await client.getIssue('testorg', 'testrepo', 42);
            expect(issue.number).toBe(42);
            expect(issue.title).toBe('Test Issue');
            expect(issue.body).toBe('Issue body');
            expect(issue.state).toBe('open');

            // Verify fetch was called with the correct URL pattern
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/repos/testorg/testrepo/issues/42'),
                expect.any(Object)
            );

            global.fetch = originalFetch;
        });
    });

    // ===================== Rate limit (lines 65-66) =====================

    describe('Rate limit exceeded', () => {
        test('request throws when rate limit is exhausted', async () => {
            const originalFetch = global.fetch;

            client = createClient();

            // Directly set the internal rate limit state to simulate exhaustion
            (client as any).rateLimitRemaining = 3;  // <= 5 triggers rate limit check
            (client as any).rateLimitReset = Math.floor(Date.now() / 1000) + 3600; // reset is in the future

            // The next request should throw due to rate limit
            await expect(client.getIssue('org', 'repo', 1)).rejects.toThrow(
                /rate limit exceeded/i
            );

            global.fetch = originalFetch;
        });
    });

    describe('request error body when response.text() fails', () => {
        test('catches response.text() failure and uses empty string (line 94)', async () => {
            const originalFetch = global.fetch;
            global.fetch = jest.fn();

            client = createClient();

            const mockHeaders = { get: () => null };
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                headers: mockHeaders,
                text: jest.fn().mockRejectedValue(new Error('Stream destroyed')),
            });

            await expect(client.getIssue('org', 'repo', 1)).rejects.toThrow(
                /GitHub API 500/
            );

            global.fetch = originalFetch;
        });
    });

    describe('getRateLimitRemaining', () => {
        test('returns the current rate limit value', () => {
            client = createClient();
            const remaining = client.getRateLimitRemaining();
            expect(typeof remaining).toBe('number');
            expect(remaining).toBe(5000); // default initial value
        });
    });
});
