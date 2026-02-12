import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../src/core/database';
import { GitHubSyncService } from '../src/core/github-sync';
import { GitHubClient, GitHubIssueData } from '../src/core/github-client';
import { ConfigManager } from '../src/core/config';
import { TaskPriority, COEConfig } from '../src/types';

// Mock vscode
jest.mock('vscode', () => require('./__mocks__/vscode'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a minimal GitHubIssueData payload for mocking API responses. */
function makeGitHubIssue(overrides: Partial<GitHubIssueData> = {}): GitHubIssueData {
    return {
        id: 1000,
        number: 1,
        title: 'Default issue title',
        body: 'Default issue body',
        state: 'open',
        labels: [],
        assignees: [],
        ...overrides,
    };
}

/** Returns a Response-like object that fetch mock can resolve to. */
function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        headers: new Headers({
            'X-RateLimit-Remaining': '4999',
            'X-RateLimit-Reset': '9999999999',
        }),
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('GitHubSyncService', () => {
    let db: Database;
    let tmpDir: string;
    let syncService: GitHubSyncService;
    let client: GitHubClient;
    let mockOutputChannel: { appendLine: jest.Mock; show: jest.Mock; dispose: jest.Mock };
    let mockConfig: { getConfig: jest.Mock };
    let originalFetch: typeof globalThis.fetch;

    const githubConfig: COEConfig['github'] = {
        token: 'test-token',
        owner: 'test-owner',
        repo: 'test-repo',
        syncIntervalMinutes: 5,
        autoImport: false,
    };

    beforeEach(async () => {
        // Save original fetch so we can restore it
        originalFetch = globalThis.fetch;

        // Create real database in temp directory
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-ghsync-'));
        db = new Database(tmpDir);
        await db.initialize();

        // Mock output channel
        mockOutputChannel = {
            appendLine: jest.fn(),
            show: jest.fn(),
            dispose: jest.fn(),
        };

        // Mock config manager — only getConfig() is used by GitHubSyncService
        mockConfig = {
            getConfig: jest.fn(() => ({
                github: { ...githubConfig },
            })),
        };

        // Create real GitHubClient (its fetch calls will be intercepted by the global mock)
        client = new GitHubClient('test-token', mockOutputChannel as any);

        // Create the service under test
        syncService = new GitHubSyncService(
            client,
            db,
            mockConfig as unknown as ConfigManager,
            mockOutputChannel as any,
        );
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
        // Restore original fetch
        globalThis.fetch = originalFetch;
    });

    // =====================================================================
    // Test 1: Import issues from GitHub → stored in database
    // =====================================================================

    describe('importIssues', () => {
        test('imports a list of GitHub issues into the database', async () => {
            const apiIssues: GitHubIssueData[] = [
                makeGitHubIssue({ id: 1001, number: 10, title: 'Fix auth bug', body: 'Login fails for SSO users', state: 'open', labels: [{ name: 'bug' }], assignees: [{ login: 'alice' }] }),
                makeGitHubIssue({ id: 1002, number: 11, title: 'Add dark mode', body: 'Support dark theme', state: 'open', labels: [{ name: 'enhancement' }], assignees: [] }),
                makeGitHubIssue({ id: 1003, number: 12, title: 'Closed issue', body: '', state: 'closed', labels: [{ name: 'wontfix' }], assignees: [{ login: 'bob' }] }),
            ];

            // First page returns the issues; second page returns empty (signals end)
            globalThis.fetch = jest.fn()
                .mockResolvedValueOnce(jsonResponse(apiIssues))
                .mockResolvedValueOnce(jsonResponse([]));

            const result = await syncService.importIssues();

            // Verify counts
            expect(result.imported).toBe(3);
            expect(result.updated).toBe(0);
            expect(result.errors).toBe(0);

            // Verify all issues are in the database
            const stored = db.getAllGitHubIssues();
            expect(stored.length).toBe(3);

            // Check fields on first issue
            const issue10 = db.getGitHubIssueByGitHubId(1001);
            expect(issue10).not.toBeNull();
            expect(issue10!.title).toBe('Fix auth bug');
            expect(issue10!.body).toBe('Login fails for SSO users');
            expect(issue10!.state).toBe('open');
            expect(issue10!.labels).toEqual(['bug']);
            expect(issue10!.assignees).toEqual(['alice']);
            expect(issue10!.repo_owner).toBe('test-owner');
            expect(issue10!.repo_name).toBe('test-repo');

            // Verify checksums are populated and match (fresh import = synced)
            expect(issue10!.local_checksum).toBeTruthy();
            expect(issue10!.local_checksum).toBe(issue10!.remote_checksum);
        });

        test('re-import counts existing issues as updated, not imported', async () => {
            const issue = makeGitHubIssue({ id: 2001, number: 20, title: 'First import', labels: [{ name: 'bug' }] });

            // First import
            globalThis.fetch = jest.fn()
                .mockResolvedValueOnce(jsonResponse([issue]))
                .mockResolvedValueOnce(jsonResponse([]));
            await syncService.importIssues();

            // Second import with same issue but updated title
            const updatedIssue = { ...issue, title: 'Updated title' };
            globalThis.fetch = jest.fn()
                .mockResolvedValueOnce(jsonResponse([updatedIssue]))
                .mockResolvedValueOnce(jsonResponse([]));
            const result = await syncService.importIssues();

            expect(result.imported).toBe(0);
            expect(result.updated).toBe(1);

            // Only one row in DB
            const all = db.getAllGitHubIssues();
            expect(all.length).toBe(1);
            expect(all[0].title).toBe('Updated title');
        });

        test('handles API errors gracefully and reports them', async () => {
            // Simulate a network error on the first page fetch
            globalThis.fetch = jest.fn().mockRejectedValueOnce(new Error('Network timeout'));

            const result = await syncService.importIssues();

            expect(result.errors).toBeGreaterThanOrEqual(1);
            expect(result.imported).toBe(0);
            expect(mockOutputChannel.appendLine).toHaveBeenCalled();
        });

        test('paginates through multiple pages of issues', async () => {
            // Create 50 issues for page 1 (full page signals more pages)
            const page1Issues = Array.from({ length: 50 }, (_, i) =>
                makeGitHubIssue({ id: 3000 + i, number: 100 + i, title: `Issue ${100 + i}` })
            );
            // Page 2 has 2 issues (< 50, so pagination stops)
            const page2Issues = [
                makeGitHubIssue({ id: 4000, number: 200, title: 'Issue 200' }),
                makeGitHubIssue({ id: 4001, number: 201, title: 'Issue 201' }),
            ];

            globalThis.fetch = jest.fn()
                .mockResolvedValueOnce(jsonResponse(page1Issues))
                .mockResolvedValueOnce(jsonResponse(page2Issues));

            const result = await syncService.importIssues();

            expect(result.imported).toBe(52);
            expect(result.errors).toBe(0);
            expect(db.getAllGitHubIssues().length).toBe(52);
        });
    });

    // =====================================================================
    // Test 2: Convert issue to task with priority mapping
    // =====================================================================

    describe('convertIssueToTask', () => {
        /** Helper: import a single issue and return its database ID. */
        async function importSingleIssue(data: GitHubIssueData): Promise<string> {
            globalThis.fetch = jest.fn()
                .mockResolvedValueOnce(jsonResponse([data]))
                .mockResolvedValueOnce(jsonResponse([]));
            await syncService.importIssues();
            const stored = db.getGitHubIssueByGitHubId(data.id);
            return stored!.id;
        }

        test('converts issue to task with correct title format [GH-N]', async () => {
            const issueDbId = await importSingleIssue(
                makeGitHubIssue({ id: 5001, number: 42, title: 'Fix login bug', body: 'Detailed description here' })
            );

            const taskId = syncService.convertIssueToTask(issueDbId);
            expect(taskId).not.toBeNull();

            const task = db.getTask(taskId!);
            expect(task).not.toBeNull();
            expect(task!.title).toBe('[GH-42] Fix login bug');
            expect(task!.description).toBe('Detailed description here');
            expect(task!.acceptance_criteria).toBe('GitHub issue #42 is resolved and closed');
        });

        test('maps "critical" label to P1 priority', async () => {
            const issueDbId = await importSingleIssue(
                makeGitHubIssue({ id: 5002, number: 43, title: 'Critical crash', labels: [{ name: 'critical' }, { name: 'bug' }] })
            );

            const taskId = syncService.convertIssueToTask(issueDbId);
            const task = db.getTask(taskId!);
            expect(task!.priority).toBe(TaskPriority.P1);
        });

        test('maps "urgent" label to P1 priority', async () => {
            const issueDbId = await importSingleIssue(
                makeGitHubIssue({ id: 5003, number: 44, title: 'Urgent fix', labels: [{ name: 'urgent' }] })
            );

            const taskId = syncService.convertIssueToTask(issueDbId);
            const task = db.getTask(taskId!);
            expect(task!.priority).toBe(TaskPriority.P1);
        });

        test('maps "P1" label to P1 priority', async () => {
            const issueDbId = await importSingleIssue(
                makeGitHubIssue({ id: 5004, number: 45, title: 'P1 item', labels: [{ name: 'P1' }] })
            );

            const taskId = syncService.convertIssueToTask(issueDbId);
            const task = db.getTask(taskId!);
            expect(task!.priority).toBe(TaskPriority.P1);
        });

        test('maps "low" label to P3 priority', async () => {
            const issueDbId = await importSingleIssue(
                makeGitHubIssue({ id: 5005, number: 46, title: 'Low priority cleanup', labels: [{ name: 'low' }, { name: 'chore' }] })
            );

            const taskId = syncService.convertIssueToTask(issueDbId);
            const task = db.getTask(taskId!);
            expect(task!.priority).toBe(TaskPriority.P3);
        });

        test('maps "P3" label to P3 priority', async () => {
            const issueDbId = await importSingleIssue(
                makeGitHubIssue({ id: 5006, number: 47, title: 'P3 nice-to-have', labels: [{ name: 'P3' }] })
            );

            const taskId = syncService.convertIssueToTask(issueDbId);
            const task = db.getTask(taskId!);
            expect(task!.priority).toBe(TaskPriority.P3);
        });

        test('defaults to P2 priority when no priority label exists', async () => {
            const issueDbId = await importSingleIssue(
                makeGitHubIssue({ id: 5007, number: 48, title: 'Normal issue', labels: [{ name: 'enhancement' }] })
            );

            const taskId = syncService.convertIssueToTask(issueDbId);
            const task = db.getTask(taskId!);
            expect(task!.priority).toBe(TaskPriority.P2);
        });

        test('links the GitHub issue to the newly created task', async () => {
            const issueDbId = await importSingleIssue(
                makeGitHubIssue({ id: 5008, number: 49, title: 'Linked issue' })
            );

            const taskId = syncService.convertIssueToTask(issueDbId);
            expect(taskId).not.toBeNull();

            const ghIssue = db.getGitHubIssue(issueDbId);
            expect(ghIssue!.task_id).toBe(taskId);
        });

        test('returns null for a non-existent issue ID', () => {
            const result = syncService.convertIssueToTask('non-existent-uuid');
            expect(result).toBeNull();
        });
    });

    // =====================================================================
    // Test 3: Bidirectional sync — locally modified issues get pushed
    // =====================================================================

    describe('syncBidirectional', () => {
        test('pushes locally-modified issues back to GitHub', async () => {
            // Step 1: Import an issue from GitHub
            const originalIssue = makeGitHubIssue({
                id: 6001,
                number: 60,
                title: 'Original title',
                body: 'Original body',
                state: 'open',
                labels: [{ name: 'bug' }],
                assignees: [{ login: 'dev1' }],
            });

            globalThis.fetch = jest.fn()
                .mockResolvedValueOnce(jsonResponse([originalIssue]))
                .mockResolvedValueOnce(jsonResponse([]));
            await syncService.importIssues();

            // Step 2: Simulate a local modification by changing the local_checksum
            // to differ from remote_checksum (this is how the system detects local edits)
            const stored = db.getGitHubIssueByGitHubId(6001);
            expect(stored).not.toBeNull();
            db.updateGitHubIssueChecksum(stored!.id, 'locally-modified-checksum', stored!.remote_checksum);

            // Verify the issue now shows up as unsynced
            const unsynced = db.getUnsyncedGitHubIssues();
            expect(unsynced.length).toBe(1);
            expect(unsynced[0].number).toBe(60);

            // Step 3: Run bidirectional sync
            // The sync will:
            //   a) Call importIssues again (pages 1 then empty page 2)
            //   b) Find the unsynced issue and call updateIssue on the API
            const updateResponse = makeGitHubIssue({
                id: 6001,
                number: 60,
                title: 'Original title',
                body: 'Original body',
                state: 'open',
                labels: [{ name: 'bug' }],
                assignees: [{ login: 'dev1' }],
            });

            globalThis.fetch = jest.fn()
                // importIssues: page 1 returns 1 issue (< 50, so no page 2 fetch)
                .mockResolvedValueOnce(jsonResponse([originalIssue]))
                // updateIssue PATCH call for the unsynced issue
                .mockResolvedValueOnce(jsonResponse(updateResponse));

            const result = await syncService.syncBidirectional();

            expect(result.pushed).toBe(1);
            expect(result.pulled).toBeGreaterThanOrEqual(0);
            expect(result.errors).toBe(0);

            // Verify the PATCH call was made with correct parameters
            const fetchMock = globalThis.fetch as jest.Mock;
            const patchCall = fetchMock.mock.calls.find(
                (call: [string, RequestInit?]) => {
                    const opts = call[1];
                    return opts && opts.method === 'PATCH';
                }
            );
            expect(patchCall).toBeDefined();
            expect(patchCall![0]).toContain('/repos/test-owner/test-repo/issues/60');

            // After push, checksums should be re-aligned (synced)
            const afterSync = db.getGitHubIssueByGitHubId(6001);
            expect(afterSync!.local_checksum).toBe(afterSync!.remote_checksum);
        });

        test('does not push issues that are already in sync', async () => {
            // Import an issue (fresh import = checksums match = synced)
            const issue = makeGitHubIssue({ id: 7001, number: 70, title: 'Already synced' });

            globalThis.fetch = jest.fn()
                .mockResolvedValueOnce(jsonResponse([issue]))
                .mockResolvedValueOnce(jsonResponse([]));
            await syncService.importIssues();

            // Do NOT modify the issue locally — it stays synced

            // Run bidirectional sync (single issue < 50, so only 1 page fetch)
            globalThis.fetch = jest.fn()
                .mockResolvedValueOnce(jsonResponse([issue]));

            const result = await syncService.syncBidirectional();

            // Nothing should be pushed
            expect(result.pushed).toBe(0);
            expect(result.errors).toBe(0);

            // Verify no PATCH calls were made (only 1 GET call for import)
            const fetchMock = globalThis.fetch as jest.Mock;
            expect(fetchMock).toHaveBeenCalledTimes(1);
            const patchCalls = fetchMock.mock.calls.filter(
                (call: [string, RequestInit?]) => call[1]?.method === 'PATCH'
            );
            expect(patchCalls.length).toBe(0);
        });

        test('handles push errors gracefully and counts them', async () => {
            // Import an issue
            const issue = makeGitHubIssue({ id: 8001, number: 80, title: 'Will fail push' });

            globalThis.fetch = jest.fn()
                .mockResolvedValueOnce(jsonResponse([issue]))
                .mockResolvedValueOnce(jsonResponse([]));
            await syncService.importIssues();

            // Mark as locally modified
            const stored = db.getGitHubIssueByGitHubId(8001);
            db.updateGitHubIssueChecksum(stored!.id, 'local-changed', stored!.remote_checksum);

            // Sync — import succeeds (single page < 50 items, no second page fetch),
            // but the PATCH call for the unsynced issue fails
            globalThis.fetch = jest.fn()
                .mockResolvedValueOnce(jsonResponse([issue]))
                .mockRejectedValueOnce(new Error('403 Forbidden'));

            const result = await syncService.syncBidirectional();

            expect(result.pushed).toBe(0);
            expect(result.errors).toBeGreaterThanOrEqual(1);
            expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Failed to push issue #80')
            );
        });
    });

    // =====================================================================
    // Test 4: Checksum computation
    // =====================================================================

    describe('computeChecksum', () => {
        test('produces consistent checksums for the same data', () => {
            const issue = makeGitHubIssue({ id: 9001, number: 90, title: 'Test', body: 'body', state: 'open', labels: [{ name: 'a' }, { name: 'b' }] });
            const c1 = syncService.computeChecksum(issue);
            const c2 = syncService.computeChecksum(issue);
            expect(c1).toBe(c2);
        });

        test('produces different checksums when data changes', () => {
            const issue1 = makeGitHubIssue({ id: 9002, number: 91, title: 'Title A', body: 'body' });
            const issue2 = makeGitHubIssue({ id: 9002, number: 91, title: 'Title B', body: 'body' });
            expect(syncService.computeChecksum(issue1)).not.toBe(syncService.computeChecksum(issue2));
        });

        test('checksum is label-order-independent (labels are sorted)', () => {
            const issueAB = makeGitHubIssue({ id: 9003, number: 92, title: 'X', labels: [{ name: 'a' }, { name: 'b' }] });
            const issueBA = makeGitHubIssue({ id: 9003, number: 92, title: 'X', labels: [{ name: 'b' }, { name: 'a' }] });
            expect(syncService.computeChecksum(issueAB)).toBe(syncService.computeChecksum(issueBA));
        });
    });

    // =====================================================================
    // Test 5: Edge cases and configuration
    // =====================================================================

    describe('edge cases', () => {
        test('importIssues throws when GitHub config is missing', async () => {
            mockConfig.getConfig.mockReturnValue({ github: undefined });
            await expect(syncService.importIssues()).rejects.toThrow('GitHub configuration not set');
        });

        test('audit log entries are created on import', async () => {
            const issue = makeGitHubIssue({ id: 10001, number: 100, title: 'Audit test' });
            globalThis.fetch = jest.fn()
                .mockResolvedValueOnce(jsonResponse([issue]))
                .mockResolvedValueOnce(jsonResponse([]));

            await syncService.importIssues();

            const auditEntries = db.getAuditLog(10, 'github_sync');
            expect(auditEntries.length).toBeGreaterThanOrEqual(1);
            const importEntry = auditEntries.find(e => e.action === 'import_complete');
            expect(importEntry).toBeDefined();
            expect(importEntry!.detail).toContain('Imported: 1');
        });

        test('audit log entry is created when converting issue to task', async () => {
            const apiIssue = makeGitHubIssue({ id: 10002, number: 101, title: 'Audit convert test' });
            globalThis.fetch = jest.fn()
                .mockResolvedValueOnce(jsonResponse([apiIssue]))
                .mockResolvedValueOnce(jsonResponse([]));
            await syncService.importIssues();

            const stored = db.getGitHubIssueByGitHubId(10002);
            syncService.convertIssueToTask(stored!.id);

            const auditEntries = db.getAuditLog(10, 'github_sync');
            const convertEntry = auditEntries.find(e => e.action === 'issue_to_task');
            expect(convertEntry).toBeDefined();
            expect(convertEntry!.detail).toContain('Issue #101');
        });
    });
});
