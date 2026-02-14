import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../src/core/database';
import { TaskStatus, TaskPriority, TicketStatus, TicketPriority, AgentType, VerificationStatus, ConversationRole } from '../src/types';

describe('Database', () => {
    let db: Database;
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-test-'));
        db = new Database(tmpDir);
        await db.initialize();
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ===================== TASKS =====================

    describe('Tasks', () => {
        test('create and retrieve a task', () => {
            const task = db.createTask({
                title: 'Implement login endpoint',
                description: 'Create POST /auth/login',
                priority: TaskPriority.P1,
                estimated_minutes: 30,
                acceptance_criteria: 'Returns JWT token on valid credentials',
            });

            expect(task.id).toBeDefined();
            expect(task.title).toBe('Implement login endpoint');
            expect(task.priority).toBe('P1');
            expect(task.status).toBe(TaskStatus.NotStarted);

            const retrieved = db.getTask(task.id);
            expect(retrieved).toBeDefined();
            expect(retrieved!.title).toBe('Implement login endpoint');
        });

        test('get tasks by status', () => {
            db.createTask({ title: 'Task 1', status: TaskStatus.NotStarted });
            db.createTask({ title: 'Task 2', status: TaskStatus.NotStarted });
            db.createTask({ title: 'Task 3', status: TaskStatus.InProgress });

            const notStarted = db.getTasksByStatus(TaskStatus.NotStarted);
            expect(notStarted.length).toBe(2);

            const inProgress = db.getTasksByStatus(TaskStatus.InProgress);
            expect(inProgress.length).toBe(1);
        });

        test('update task', () => {
            const task = db.createTask({ title: 'Original' });
            const updated = db.updateTask(task.id, {
                title: 'Updated',
                status: TaskStatus.InProgress,
                priority: TaskPriority.P1,
            });

            expect(updated!.title).toBe('Updated');
            expect(updated!.status).toBe(TaskStatus.InProgress);
            expect(updated!.priority).toBe(TaskPriority.P1);
        });

        test('delete task', () => {
            const task = db.createTask({ title: 'To delete' });
            expect(db.deleteTask(task.id)).toBe(true);
            expect(db.getTask(task.id)).toBeNull();
        });

        test('get ready tasks with dependencies', () => {
            const t1 = db.createTask({ title: 'Task 1' });
            const t2 = db.createTask({ title: 'Task 2', dependencies: [t1.id] });
            const t3 = db.createTask({ title: 'Task 3' });

            // t1 and t3 are ready (no deps), t2 is blocked by t1
            let ready = db.getReadyTasks();
            expect(ready.length).toBe(2);
            expect(ready.map(t => t.title).sort()).toEqual(['Task 1', 'Task 3']);

            // Verify t1, now t2 should be ready
            db.updateTask(t1.id, { status: TaskStatus.Verified });
            ready = db.getReadyTasks();
            expect(ready.map(t => t.title).sort()).toEqual(['Task 2', 'Task 3']);
        });

        test('get next ready task respects priority', () => {
            db.createTask({ title: 'P3 task', priority: TaskPriority.P3 });
            db.createTask({ title: 'P1 task', priority: TaskPriority.P1 });
            db.createTask({ title: 'P2 task', priority: TaskPriority.P2 });

            const next = db.getNextReadyTask();
            expect(next).toBeDefined();
            expect(next!.title).toBe('P1 task');
        });

        test('dependencies stored and retrieved as arrays', () => {
            const t1 = db.createTask({ title: 'Task 1' });
            const t2 = db.createTask({ title: 'Task 2' });
            const t3 = db.createTask({ title: 'Task 3', dependencies: [t1.id, t2.id] });

            const retrieved = db.getTask(t3.id);
            expect(retrieved!.dependencies).toEqual([t1.id, t2.id]);
        });

        test('get tasks by plan', () => {
            const plan = db.createPlan('Test Plan');
            db.createTask({ title: 'Plan task 1', plan_id: plan.id });
            db.createTask({ title: 'Plan task 2', plan_id: plan.id });
            db.createTask({ title: 'Unrelated task' });

            const planTasks = db.getTasksByPlan(plan.id);
            expect(planTasks.length).toBe(2);
        });
    });

    // ===================== TICKETS =====================

    describe('Tickets', () => {
        test('create ticket with auto-numbering', () => {
            const t1 = db.createTicket({ title: 'First ticket' });
            const t2 = db.createTicket({ title: 'Second ticket' });

            expect(t1.ticket_number).toBe(1);
            expect(t2.ticket_number).toBe(2);
        });

        test('get ticket by number', () => {
            const ticket = db.createTicket({ title: 'Test ticket', body: 'Details here' });
            const retrieved = db.getTicketByNumber(ticket.ticket_number);

            expect(retrieved).toBeDefined();
            expect(retrieved!.title).toBe('Test ticket');
            expect(retrieved!.body).toBe('Details here');
        });

        test('update ticket status', () => {
            const ticket = db.createTicket({ title: 'Open ticket' });
            db.updateTicket(ticket.id, { status: TicketStatus.Resolved });

            const updated = db.getTicket(ticket.id);
            expect(updated!.status).toBe(TicketStatus.Resolved);
        });

        test('get tickets by status', () => {
            db.createTicket({ title: 'Open 1' });
            db.createTicket({ title: 'Open 2' });
            db.createTicket({ title: 'Resolved', status: TicketStatus.Resolved });

            const open = db.getTicketsByStatus(TicketStatus.Open);
            expect(open.length).toBe(2);

            const resolved = db.getTicketsByStatus(TicketStatus.Resolved);
            expect(resolved.length).toBe(1);
        });

        test('active ticket count', () => {
            db.createTicket({ title: 'Open' });
            db.createTicket({ title: 'Escalated', status: TicketStatus.Escalated });
            db.createTicket({ title: 'Resolved', status: TicketStatus.Resolved });

            expect(db.getActiveTicketCount()).toBe(2);
        });

        test('ticket replies', () => {
            const ticket = db.createTicket({ title: 'Question' });
            db.addTicketReply(ticket.id, 'user', 'Yes, use SQLite', 92);
            db.addTicketReply(ticket.id, 'Clarity Agent', 'Clear (92/100)', 92);

            const replies = db.getTicketReplies(ticket.id);
            expect(replies.length).toBe(2);
            expect(replies[0].author).toBe('user');
            expect(replies[0].clarity_score).toBe(92);
        });
    });

    // ===================== PLANS =====================

    describe('Plans', () => {
        test('create and get plan', () => {
            const plan = db.createPlan('My Plan', '{"features": 5}');
            expect(plan.id).toBeDefined();
            expect(plan.name).toBe('My Plan');
            expect(plan.status).toBe('draft');

            const retrieved = db.getPlan(plan.id);
            expect(retrieved!.config_json).toBe('{"features": 5}');
        });

        test('get active plan', () => {
            const p1 = db.createPlan('Draft Plan');
            const p2 = db.createPlan('Active Plan');
            db.updatePlan(p2.id, { status: 'active' as any });

            const active = db.getActivePlan();
            expect(active).toBeDefined();
            expect(active!.name).toBe('Active Plan');
        });
    });

    // ===================== AGENTS =====================

    describe('Agents', () => {
        test('register and retrieve agents', () => {
            db.registerAgent('Test Agent', AgentType.Planning);
            const agent = db.getAgentByName('Test Agent');

            expect(agent).toBeDefined();
            expect(agent!.type).toBe(AgentType.Planning);
            expect(agent!.status).toBe('idle');
        });

        test('update agent status', () => {
            db.registerAgent('Worker', AgentType.Answer);
            db.updateAgentStatus('Worker', 'working' as any, 'task-123');

            const agent = db.getAgentByName('Worker');
            expect(agent!.status).toBe('working');
            expect(agent!.current_task).toBe('task-123');
        });
    });

    // ===================== AUDIT LOG =====================

    describe('Audit Log', () => {
        test('add and retrieve audit entries', () => {
            db.addAuditLog('orchestrator', 'route', 'Routed to planning');
            db.addAuditLog('planning', 'plan_created', '15 tasks');
            db.addAuditLog('orchestrator', 'route', 'Routed to verification');

            const all = db.getAuditLog(10);
            expect(all.length).toBe(3);

            const orchOnly = db.getAuditLog(10, 'orchestrator');
            expect(orchOnly.length).toBe(2);
        });
    });

    // ===================== VERIFICATION =====================

    describe('Verification', () => {
        test('create and update verification result', () => {
            const task = db.createTask({ title: 'Verify me' });
            const result = db.createVerificationResult(task.id);

            expect(result.status).toBe('not_started');

            db.updateVerificationResult(result.id, VerificationStatus.Passed,
                '{"criteria_met": ["all"]}', '8 tests passed', 87);

            const updated = db.getVerificationResult(task.id);
            expect(updated!.status).toBe(VerificationStatus.Passed);
            expect(updated!.coverage_percent).toBe(87);
        });
    });

    // ===================== EVOLUTION =====================

    describe('Evolution', () => {
        test('add and retrieve evolution entries', () => {
            const entry = db.addEvolutionEntry(
                'TOKEN_LIMIT_EXCEEDED x12',
                'Increase askQuestion context from 800 to 1200 tokens'
            );

            expect(entry.status).toBe('proposed');

            db.updateEvolutionEntry(entry.id, 'applied', 'Token errors reduced 83%');

            const log = db.getEvolutionLog(5);
            expect(log.length).toBe(1);
            expect(log[0].status).toBe('applied');
            expect(log[0].result).toBe('Token errors reduced 83%');
        });
    });

    // ===================== STATS =====================

    describe('Stats', () => {
        test('get system stats', () => {
            db.createTask({ title: 'T1' });
            db.createTask({ title: 'T2', status: TaskStatus.Verified });
            db.createTicket({ title: 'Ticket 1' });

            const stats = db.getStats();
            expect(stats.total_tasks).toBe(2);
            expect(stats.total_tickets).toBe(1);
            expect(stats.tasks_not_started).toBe(1);
            expect(stats.tasks_verified).toBe(1);
        });
    });

    // ===================== FRESH RESTART =====================

    describe('Fresh Restart', () => {
        test('clearInMemoryState resets in-progress tasks and agents', () => {
            const task = db.createTask({ title: 'In progress', status: TaskStatus.InProgress });
            db.registerAgent('TestAgent', AgentType.Planning);
            db.updateAgentStatus('TestAgent', 'working' as any, task.id);

            db.clearInMemoryState();

            const resetTask = db.getTask(task.id);
            expect(resetTask!.status).toBe(TaskStatus.NotStarted);

            const resetAgent = db.getAgentByName('TestAgent');
            expect(resetAgent!.status).toBe('idle');
            expect(resetAgent!.current_task).toBeNull();
        });
    });

    // ===================== CONVERSATIONS =====================

    describe('Conversations', () => {
        test('add and retrieve conversations', () => {
            const task = db.createTask({ title: 'Chat task' });
            db.addConversation('orchestrator', ConversationRole.User, 'What should I build?', task.id);
            db.addConversation('orchestrator', ConversationRole.Agent, 'A REST API', task.id, undefined, 150);

            const convs = db.getConversationsByTask(task.id);
            expect(convs.length).toBe(2);
            expect(convs[1].tokens_used).toBe(150);

            const byAgent = db.getConversationsByAgent('orchestrator');
            expect(byAgent.length).toBe(2);
        });

        test('getRecentConversations returns conversations with limit (line 807)', () => {
            db.addConversation('orchestrator', ConversationRole.User, 'First message');
            db.addConversation('planning', ConversationRole.Agent, 'Second message');
            db.addConversation('verification', ConversationRole.User, 'Third message');

            const recent = db.getRecentConversations(2);
            expect(recent.length).toBe(2);

            const all = db.getRecentConversations(10);
            expect(all.length).toBe(3);
        });
    });

    // ===================== CONSTRUCTOR (line 31) =====================

    describe('Constructor creates directory', () => {
        test('creates coeDir if it does not exist', async () => {
            const nonExistentDir = path.join(tmpDir, 'non', 'existent', 'dir');
            expect(fs.existsSync(nonExistentDir)).toBe(false);

            const newDb = new Database(nonExistentDir);
            await newDb.initialize();

            expect(fs.existsSync(nonExistentDir)).toBe(true);
            newDb.close();
        });
    });

    // ===================== GITHUB ISSUES =====================

    describe('GitHub Issues', () => {
        test('upsert and retrieve a GitHub issue', () => {
            const issue = db.upsertGitHubIssue({
                github_id: 12345,
                number: 42,
                title: 'Fix login bug',
                body: 'Users cannot log in after password reset',
                state: 'open',
                labels: ['bug', 'P1'],
                assignees: ['dev1'],
                repo_owner: 'testorg',
                repo_name: 'testrepo',
                task_id: null,
                local_checksum: 'abc123',
                remote_checksum: 'abc123',
            });

            expect(issue.id).toBeTruthy();
            expect(issue.title).toBe('Fix login bug');
            expect(issue.labels).toEqual(['bug', 'P1']);

            const retrieved = db.getGitHubIssue(issue.id);
            expect(retrieved).not.toBeNull();
            expect(retrieved!.number).toBe(42);
        });

        test('upsert updates existing issue by github_id', () => {
            db.upsertGitHubIssue({
                github_id: 99,
                number: 10,
                title: 'Original title',
                body: 'Original body',
                state: 'open',
                labels: [],
                assignees: [],
                repo_owner: 'org',
                repo_name: 'repo',
                task_id: null,
                local_checksum: 'a',
                remote_checksum: 'a',
            });

            const updated = db.upsertGitHubIssue({
                github_id: 99,
                number: 10,
                title: 'Updated title',
                body: 'Updated body',
                state: 'closed',
                labels: ['done'],
                assignees: ['dev2'],
                repo_owner: 'org',
                repo_name: 'repo',
                task_id: null,
                local_checksum: 'a',
                remote_checksum: 'b',
            });

            expect(updated.title).toBe('Updated title');
            expect(updated.state).toBe('closed');

            const all = db.getAllGitHubIssues();
            expect(all.length).toBe(1);
        });

        test('getGitHubIssueByNumber finds correct issue', () => {
            db.upsertGitHubIssue({
                github_id: 200,
                number: 55,
                title: 'Issue 55',
                body: '',
                state: 'open',
                labels: [],
                assignees: [],
                repo_owner: 'myorg',
                repo_name: 'myrepo',
                task_id: null,
                local_checksum: '',
                remote_checksum: '',
            });

            const found = db.getGitHubIssueByNumber(55, 'myorg', 'myrepo');
            expect(found).not.toBeNull();
            expect(found!.title).toBe('Issue 55');

            const notFound = db.getGitHubIssueByNumber(55, 'otherorg', 'myrepo');
            expect(notFound).toBeNull();
        });

        test('getAllGitHubIssues filters by repo owner and name (line 988)', () => {
            db.upsertGitHubIssue({
                github_id: 600,
                number: 1,
                title: 'Repo A Issue',
                body: '',
                state: 'open',
                labels: [],
                assignees: [],
                repo_owner: 'orgA',
                repo_name: 'repoA',
                task_id: null,
                local_checksum: '',
                remote_checksum: '',
            });
            db.upsertGitHubIssue({
                github_id: 601,
                number: 2,
                title: 'Repo B Issue',
                body: '',
                state: 'open',
                labels: [],
                assignees: [],
                repo_owner: 'orgB',
                repo_name: 'repoB',
                task_id: null,
                local_checksum: '',
                remote_checksum: '',
            });

            const repoA = db.getAllGitHubIssues('orgA', 'repoA');
            expect(repoA.length).toBe(1);
            expect(repoA[0].title).toBe('Repo A Issue');

            const all = db.getAllGitHubIssues();
            expect(all.length).toBe(2);
        });

        test('getUnsyncedGitHubIssues returns issues with mismatched checksums', () => {
            db.upsertGitHubIssue({
                github_id: 300,
                number: 1,
                title: 'Synced',
                body: '',
                state: 'open',
                labels: [],
                assignees: [],
                repo_owner: 'o',
                repo_name: 'r',
                task_id: null,
                local_checksum: 'same',
                remote_checksum: 'same',
            });
            db.upsertGitHubIssue({
                github_id: 301,
                number: 2,
                title: 'Unsynced',
                body: '',
                state: 'open',
                labels: [],
                assignees: [],
                repo_owner: 'o',
                repo_name: 'r',
                task_id: null,
                local_checksum: 'local1',
                remote_checksum: 'remote1',
            });

            const unsynced = db.getUnsyncedGitHubIssues();
            expect(unsynced.length).toBe(1);
            expect(unsynced[0].title).toBe('Unsynced');
        });

        test('linkGitHubIssueToTask links issue to task', () => {
            const task = db.createTask({ title: 'Linked task' });
            const issue = db.upsertGitHubIssue({
                github_id: 400,
                number: 99,
                title: 'To link',
                body: '',
                state: 'open',
                labels: [],
                assignees: [],
                repo_owner: 'o',
                repo_name: 'r',
                task_id: null,
                local_checksum: '',
                remote_checksum: '',
            });

            db.linkGitHubIssueToTask(issue.id, task.id);

            const updated = db.getGitHubIssue(issue.id);
            expect(updated!.task_id).toBe(task.id);
        });

        test('updateGitHubIssueChecksum updates both checksums', () => {
            const issue = db.upsertGitHubIssue({
                github_id: 500,
                number: 77,
                title: 'Checksum test',
                body: '',
                state: 'open',
                labels: [],
                assignees: [],
                repo_owner: 'o',
                repo_name: 'r',
                task_id: null,
                local_checksum: 'old_local',
                remote_checksum: 'old_remote',
            });

            db.updateGitHubIssueChecksum(issue.id, 'new_local', 'new_remote');

            const updated = db.getGitHubIssue(issue.id);
            expect(updated!.local_checksum).toBe('new_local');
            expect(updated!.remote_checksum).toBe('new_remote');
        });
    });

    // ===================== BRANCH COVERAGE: updateTask optional fields =====================

    describe('updateTask branch coverage', () => {
        test('updateTask returns null for non-existent task (line 621)', () => {
            const result = db.updateTask('nonexistent-id', { title: 'X' });
            expect(result).toBeNull();
        });

        test('updateTask with no fields returns existing task unchanged (line 638)', () => {
            const task = db.createTask({ title: 'No changes' });
            const result = db.updateTask(task.id, {});
            expect(result).not.toBeNull();
            expect(result!.title).toBe('No changes');
        });

        test('updateTask covers description branch (line 627)', () => {
            const task = db.createTask({ title: 'Test' });
            const updated = db.updateTask(task.id, { description: 'New description' });
            expect(updated!.description).toBe('New description');
        });

        test('updateTask covers acceptance_criteria branch (line 631)', () => {
            const task = db.createTask({ title: 'Test' });
            const updated = db.updateTask(task.id, { acceptance_criteria: 'Must pass all tests' });
            expect(updated!.acceptance_criteria).toBe('Must pass all tests');
        });

        test('updateTask covers estimated_minutes branch (line 632)', () => {
            const task = db.createTask({ title: 'Test' });
            const updated = db.updateTask(task.id, { estimated_minutes: 45 });
            expect(updated!.estimated_minutes).toBe(45);
        });

        test('updateTask covers context_bundle branch (line 634)', () => {
            const task = db.createTask({ title: 'Test' });
            const updated = db.updateTask(task.id, { context_bundle: '{"key":"value"}' });
            expect(updated!.context_bundle).toBe('{"key":"value"}');
        });

        test('updateTask covers sort_order branch (line 635)', () => {
            const task = db.createTask({ title: 'Test' });
            const updated = db.updateTask(task.id, { sort_order: 5 });
            expect(updated!.sort_order).toBe(5);
        });

        test('updateTask covers parent_task_id branch (line 636)', () => {
            const parent = db.createTask({ title: 'Parent' });
            const child = db.createTask({ title: 'Child' });
            const updated = db.updateTask(child.id, { parent_task_id: parent.id });
            expect(updated!.parent_task_id).toBe(parent.id);
        });

        test('updateTask covers dependencies branch (line 630)', () => {
            const task = db.createTask({ title: 'Test' });
            const dep = db.createTask({ title: 'Dependency' });
            const updated = db.updateTask(task.id, { dependencies: [dep.id] });
            expect(updated!.dependencies).toEqual([dep.id]);
        });

        test('updateTask covers files_modified branch (line 633)', () => {
            const task = db.createTask({ title: 'Test' });
            const updated = db.updateTask(task.id, { files_modified: ['src/a.ts', 'src/b.ts'] });
            expect(updated!.files_modified).toEqual(['src/a.ts', 'src/b.ts']);
        });
    });

    // ===================== BRANCH COVERAGE: getNextReadyTask priority fallback =====================

    describe('getNextReadyTask branch coverage', () => {
        test('tasks with unknown priority fall back to default via ?? (line 612)', () => {
            // Create tasks with a non-standard priority to trigger the ?? 1 fallback
            db.createTask({ title: 'Unknown priority', priority: 'P9' as any });
            db.createTask({ title: 'P1 task', priority: TaskPriority.P1 });

            const next = db.getNextReadyTask();
            // P1 has prioOrder 0, unknown has prioOrder 1 (via ?? 1), so P1 comes first
            expect(next).toBeDefined();
            expect(next!.title).toBe('P1 task');
        });

        test('both tasks with unknown priorities use ?? fallback for both a and b (line 612)', () => {
            // Both priorities are unknown, so both hit the ?? 1 fallback
            db.createTask({ title: 'Unknown A', priority: 'PX' as any });
            db.createTask({ title: 'Unknown B', priority: 'PY' as any });

            const next = db.getNextReadyTask();
            // Both have prioOrder 1 via ??, so oldest first (Unknown A was created first)
            expect(next).toBeDefined();
            expect(next!.title).toBe('Unknown A');
        });

        test('getNextReadyTask returns null when no ready tasks (line 608)', () => {
            // All tasks are in progress
            db.createTask({ title: 'In Progress', status: TaskStatus.InProgress });
            const next = db.getNextReadyTask();
            expect(next).toBeNull();
        });
    });

    // ===================== BRANCH COVERAGE: rowToTask fallback branches =====================

    describe('rowToTask fallback branches', () => {
        test('rowToTask handles empty string dependencies/files_modified columns (lines 668, 674)', () => {
            // Use empty strings to trigger the || '[]' fallback path in rowToTask
            const rawDb = (db as any).db;
            rawDb.prepare(`INSERT INTO tasks (id, title, description, status, priority, dependencies, acceptance_criteria, plan_id, parent_task_id, estimated_minutes, files_modified, context_bundle, sort_order, created_at, updated_at)
                VALUES ('empty-deps', 'Empty deps task', '', 'not_started', 'P2', '', '', NULL, NULL, 30, '', NULL, 0, datetime('now'), datetime('now'))`).run();

            const task = db.getTask('empty-deps');
            expect(task).not.toBeNull();
            expect(task!.dependencies).toEqual([]);
            expect(task!.files_modified).toEqual([]);
        });
    });

    // ===================== BRANCH COVERAGE: Ticket methods =====================

    describe('Ticket branch coverage', () => {
        test('getTicketByNumber returns null for non-existent ticket (line 714)', () => {
            const result = db.getTicketByNumber(99999);
            expect(result).toBeNull();
        });

        test('updateTicket returns null for non-existent ticket', () => {
            const result = db.updateTicket('nonexistent', { title: 'X' });
            expect(result).toBeNull();
        });

        test('updateTicket with no fields returns existing (line 746)', () => {
            const ticket = db.createTicket({ title: 'No change' });
            const result = db.updateTicket(ticket.id, {});
            expect(result!.title).toBe('No change');
        });

        test('updateTicket covers body branch (line 741)', () => {
            const ticket = db.createTicket({ title: 'Test' });
            const updated = db.updateTicket(ticket.id, { body: 'New body text' });
            expect(updated!.body).toBe('New body text');
        });

        test('updateTicket covers priority branch (line 743)', () => {
            const ticket = db.createTicket({ title: 'Test' });
            const updated = db.updateTicket(ticket.id, { priority: TicketPriority.P1 });
            expect(updated!.priority).toBe('P1');
        });

        test('updateTicket covers assignee branch (line 744)', () => {
            const ticket = db.createTicket({ title: 'Test' });
            const updated = db.updateTicket(ticket.id, { assignee: 'dev-user' });
            expect(updated!.assignee).toBe('dev-user');
        });
    });

    // ===================== BRANCH COVERAGE: Conversations default param =====================

    describe('Conversations branch coverage', () => {
        test('getRecentConversations uses default limit (line 806)', () => {
            db.addConversation('agent', ConversationRole.User, 'Hello');
            // Call with no args to trigger default param
            const recent = db.getRecentConversations();
            expect(recent.length).toBe(1);
        });
    });

    // ===================== BRANCH COVERAGE: Plans =====================

    describe('Plans branch coverage', () => {
        test('updatePlan with config_json (line 839)', () => {
            const plan = db.createPlan('Test Plan');
            const updated = db.updatePlan(plan.id, { config_json: '{"new":true}' });
            expect(updated!.config_json).toBe('{"new":true}');
        });

        test('updatePlan with no fields returns existing (line 840)', () => {
            const plan = db.createPlan('Test Plan');
            const result = db.updatePlan(plan.id, {});
            expect(result!.name).toBe('Test Plan');
        });

        test('getAgentByName returns null for unknown agent (line 860)', () => {
            expect(db.getAgentByName('nonexistent')).toBeNull();
        });

        test('getAllAgents returns agents array (line 864-865)', () => {
            db.registerAgent('Test Agent', AgentType.Planning);
            const agents = db.getAllAgents();
            expect(Array.isArray(agents)).toBe(true);
            expect(agents.length).toBeGreaterThanOrEqual(1);
        });

        test('getAllAgents returns empty array when no agents exist (line 865)', () => {
            // getAllAgents on a fresh DB with no agents
            const agents = db.getAllAgents();
            expect(Array.isArray(agents)).toBe(true);
            expect(agents.length).toBe(0);
        });
    });

    // ===================== BRANCH COVERAGE: Evolution default param =====================

    describe('Evolution branch coverage', () => {
        test('getEvolutionLog uses default limit (line 926)', () => {
            db.addEvolutionEntry('pattern1', 'proposal1');
            const log = db.getEvolutionLog();
            expect(log.length).toBe(1);
        });

        test('updateEvolutionEntry with no result (line 931-934)', () => {
            const entry = db.addEvolutionEntry('pattern', 'proposal');
            db.updateEvolutionEntry(entry.id, 'rejected');
            const log = db.getEvolutionLog(1);
            expect(log[0].status).toBe('rejected');
            expect(log[0].result).toBeNull();
        });
    });

    // ===================== BRANCH COVERAGE: GitHub Issues parseRow fallback =====================

    describe('GitHub Issues branch coverage', () => {
        test('parseGitHubIssueRow handles empty string labels/assignees (lines 1022-1023)', () => {
            const rawDb = (db as any).db;
            rawDb.prepare(`INSERT INTO github_issues (id, github_id, number, title, body, state, labels, assignees, repo_owner, repo_name, task_id, local_checksum, remote_checksum)
                VALUES ('empty-json', 9999, 999, 'Empty JSON', '', 'open', '', '', 'o', 'r', NULL, '', '')`).run();

            const issue = db.getGitHubIssue('empty-json');
            expect(issue).not.toBeNull();
            expect(issue!.labels).toEqual([]);
            expect(issue!.assignees).toEqual([]);
        });
    });

    // ===================== BRANCH COVERAGE: Design Pages =====================

    describe('Design Pages branch coverage', () => {
        test('updateDesignPage skips id and created_at fields (line 1081)', () => {
            const plan = db.createPlan('Design Plan');
            const page = db.createDesignPage({ plan_id: plan.id, name: 'Page 1' });
            const updated = db.updateDesignPage(page.id, { id: 'new-id', created_at: '2020-01-01', name: 'Updated Page' } as any);
            expect(updated!.name).toBe('Updated Page');
            expect(updated!.id).toBe(page.id); // id should not change
        });

        test('updateDesignPage with empty updates (line 1085)', () => {
            const plan = db.createPlan('Design Plan');
            const page = db.createDesignPage({ plan_id: plan.id, name: 'Page 1' });
            const result = db.updateDesignPage(page.id, {});
            expect(result!.name).toBe('Page 1');
        });
    });

    // ===================== BRANCH COVERAGE: Design Components =====================

    describe('Design Components branch coverage', () => {
        test('updateDesignComponent skips id and created_at (line 1137)', () => {
            const plan = db.createPlan('Plan');
            const comp = db.createDesignComponent({ plan_id: plan.id, type: 'button' });
            const updated = db.updateDesignComponent(comp.id, { id: 'new-id', created_at: '2020-01-01', name: 'Updated' });
            expect(updated!.name).toBe('Updated');
            expect(updated!.id).toBe(comp.id);
        });

        test('updateDesignComponent with empty updates (line 1146)', () => {
            const plan = db.createPlan('Plan');
            const comp = db.createDesignComponent({ plan_id: plan.id, type: 'button' });
            const result = db.updateDesignComponent(comp.id, {});
            expect(result!.type).toBe('button');
        });

        test('updateDesignComponent serializes styles/props/responsive (line 1138-1140)', () => {
            const plan = db.createPlan('Plan');
            const comp = db.createDesignComponent({ plan_id: plan.id, type: 'container' });
            const updated = db.updateDesignComponent(comp.id, {
                styles: { color: 'red' },
                props: { disabled: true },
                responsive: { mobile: { width: 100 } },
            });
            expect(updated!.styles).toEqual({ color: 'red' });
            expect(updated!.props).toEqual({ disabled: true });
            expect(updated!.responsive).toEqual({ mobile: { width: 100 } });
        });

        test('batchUpdateComponents with partial updates (line 1167)', () => {
            const plan = db.createPlan('Plan');
            const comp = db.createDesignComponent({ plan_id: plan.id, type: 'button', x: 0, y: 0 });
            db.batchUpdateComponents([
                { id: comp.id, x: 100, y: 200 },
            ]);
            const updated = db.getDesignComponent(comp.id);
            expect(updated!.x).toBe(100);
            expect(updated!.y).toBe(200);
        });

        test('batchUpdateComponents with parent_id explicitly set (line 1167 parent_id !== undefined)', () => {
            const plan = db.createPlan('Plan');
            const parent = db.createDesignComponent({ plan_id: plan.id, type: 'container' });
            const child = db.createDesignComponent({ plan_id: plan.id, type: 'button' });
            db.batchUpdateComponents([
                { id: child.id, parent_id: parent.id },
            ]);
            const updated = db.getDesignComponent(child.id);
            expect(updated!.parent_id).toBe(parent.id);
        });

        test('parseComponentRow handles empty string values with fallbacks (lines 1179-1187)', () => {
            // Use empty strings to trigger the || '{}' and || '' fallback paths
            const plan = db.createPlan('Plan');
            const rawDb = (db as any).db;
            rawDb.prepare(`INSERT INTO design_components (id, plan_id, page_id, type, name, parent_id, sort_order, x, y, width, height, styles, content, props, responsive, created_at, updated_at)
                VALUES ('empty-comp', ?, NULL, 'button', 'Empty Comp', NULL, 0, 0, 0, 200, 100, '', '', '', '', datetime('now'), datetime('now'))`).run(plan.id);

            const comp = db.getDesignComponent('empty-comp');
            expect(comp).not.toBeNull();
            expect(comp!.styles).toEqual({});
            expect(comp!.content).toBe('');
            expect(comp!.props).toEqual({});
            expect(comp!.responsive).toEqual({});
        });
    });

    // ===================== BRANCH COVERAGE: Design Tokens =====================

    describe('Design Tokens branch coverage', () => {
        test('updateDesignToken skips id, created_at, plan_id (line 1212)', () => {
            const plan = db.createPlan('Plan');
            const token = db.createDesignToken({ plan_id: plan.id, name: 'primary', value: '#000' });
            db.updateDesignToken(token.id, { id: 'new-id', created_at: '2020-01-01', plan_id: 'other-plan', name: 'secondary', value: '#fff' } as any);
            const tokens = db.getDesignTokensByPlan(plan.id);
            expect(tokens[0].name).toBe('secondary');
            expect(tokens[0].value).toBe('#fff');
        });

        test('updateDesignToken with empty updates (line 1216)', () => {
            const plan = db.createPlan('Plan');
            const token = db.createDesignToken({ plan_id: plan.id, name: 'primary', value: '#000' });
            db.updateDesignToken(token.id, {});
            const tokens = db.getDesignTokensByPlan(plan.id);
            expect(tokens[0].name).toBe('primary');
        });
    });

    // ===================== BRANCH COVERAGE: Coding Sessions =====================

    describe('Coding Sessions branch coverage', () => {
        test('createCodingSession uses defaults (line 1252)', () => {
            const session = db.createCodingSession({});
            expect(session.name).toBe('Coding Session');
            expect(session.plan_id).toBeNull();
        });

        test('updateCodingSession skips id and created_at (line 1268)', () => {
            const session = db.createCodingSession({ name: 'Session 1' });
            db.updateCodingSession(session.id, { id: 'new-id', created_at: '2020-01-01', name: 'Updated Session' } as any);
            const updated = db.getCodingSession(session.id);
            expect(updated!.name).toBe('Updated Session');
            expect(updated!.id).toBe(session.id);
        });

        test('updateCodingSession with no fields does nothing (line 1272)', () => {
            const session = db.createCodingSession({ name: 'Session 1' });
            db.updateCodingSession(session.id, {});
            const result = db.getCodingSession(session.id);
            expect(result!.name).toBe('Session 1');
        });
    });

    // ===================== BRANCH COVERAGE: Context Snapshots default param =====================

    describe('Context Snapshots branch coverage', () => {
        test('pruneContextSnapshots uses default keepPerAgent (line 1374)', () => {
            const deleted = db.pruneContextSnapshots();
            expect(deleted).toBe(0);
        });
    });

    // ===================== BRANCH COVERAGE: Sync Config =====================

    describe('Sync Config branch coverage', () => {
        test('updateSyncConfig covers all optional field branches (lines 1426-1434)', () => {
            const config = db.createSyncConfig({ device_id: 'dev-001' });
            const updated = db.updateSyncConfig(config.id, {
                backend: 'nas' as any,
                endpoint: 'nas://host',
                credentials_ref: 'cred-ref',
                enabled: true,
                auto_sync_interval_seconds: 120,
                default_conflict_strategy: 'merge' as any,
                max_file_size_bytes: 1000000,
                exclude_patterns: ['dist/'],
                device_name: 'New Device',
            });
            expect(updated!.backend).toBe('nas');
            expect(updated!.endpoint).toBe('nas://host');
            expect(updated!.credentials_ref).toBe('cred-ref');
            expect(updated!.enabled).toBe(true);
            expect(updated!.auto_sync_interval_seconds).toBe(120);
            expect(updated!.default_conflict_strategy).toBe('merge');
            expect(updated!.max_file_size_bytes).toBe(1000000);
            expect(updated!.exclude_patterns).toEqual(['dist/']);
            expect(updated!.device_name).toBe('New Device');
        });

        test('updateSyncConfig with no fields returns existing (line 1435)', () => {
            const config = db.createSyncConfig({ device_id: 'dev-002' });
            const result = db.updateSyncConfig(config.id, {});
            expect(result!.device_id).toBe('dev-002');
        });

        test('rowToSyncConfig handles empty string exclude_patterns (line 1453)', () => {
            const config = db.createSyncConfig({ device_id: 'dev-003' });
            // Set exclude_patterns to empty string to trigger || '[]' fallback
            const rawDb = (db as any).db;
            rawDb.prepare('UPDATE sync_config SET exclude_patterns = ? WHERE id = ?').run('', config.id);
            const retrieved = db.getSyncConfig();
            expect(retrieved!.exclude_patterns).toEqual([]);
        });
    });

    // ===================== BRANCH COVERAGE: Sync Changes =====================

    describe('Sync Changes branch coverage', () => {
        test('markChangesSynced with empty array does nothing (line 1486)', () => {
            db.markChangesSynced([]);
            // No error expected
        });
    });

    // ===================== BRANCH COVERAGE: Sync Conflicts =====================

    describe('Sync Conflicts branch coverage', () => {
        test('rowToSyncConflict handles empty string conflicting_fields (line 1553)', () => {
            const rawDb = (db as any).db;
            rawDb.prepare(`INSERT INTO sync_conflicts (id, entity_type, entity_id, local_version, remote_version, remote_device_id, local_changed_at, remote_changed_at, conflicting_fields, resolution, resolved_by, resolved_at, created_at)
                VALUES ('empty-fields', 'task', 't1', '{}', '{}', 'dev-002', '', '', '', NULL, NULL, NULL, datetime('now'))`).run();
            const conflict = db.getSyncConflict('empty-fields');
            expect(conflict!.conflicting_fields).toEqual([]);
        });
    });

    // ===================== BRANCH COVERAGE: Ethics Modules =====================

    describe('Ethics Module branch coverage', () => {
        test('updateEthicsModule covers all field branches (lines 1605-1612)', () => {
            const mod = db.createEthicsModule({ name: 'Test' });
            const updated = db.updateEthicsModule(mod.id, {
                name: 'Updated Name',
                description: 'New desc',
                enabled: true,
                sensitivity: 'low' as any,
                scope: ['scope1'],
                allowed_actions: ['action1'],
                blocked_actions: ['action2'],
                version: 2,
            });
            expect(updated!.name).toBe('Updated Name');
            expect(updated!.description).toBe('New desc');
            expect(updated!.enabled).toBe(true);
            expect(updated!.sensitivity).toBe('low');
            expect(updated!.scope).toEqual(['scope1']);
            expect(updated!.allowed_actions).toEqual(['action1']);
            expect(updated!.blocked_actions).toEqual(['action2']);
            expect(updated!.version).toBe(2);
        });

        test('updateEthicsModule with no fields returns existing (line 1613)', () => {
            const mod = db.createEthicsModule({ name: 'Test' });
            const result = db.updateEthicsModule(mod.id, {});
            expect(result!.name).toBe('Test');
        });

        test('rowToEthicsModule handles empty string scope/allowed_actions/blocked_actions (lines 1633-1635)', () => {
            const mod = db.createEthicsModule({ name: 'Empty fields' });
            const rawDb = (db as any).db;
            rawDb.prepare('UPDATE ethics_modules SET scope = ?, allowed_actions = ?, blocked_actions = ? WHERE id = ?').run('', '', '', mod.id);
            const retrieved = db.getEthicsModule(mod.id);
            expect(retrieved!.scope).toEqual([]);
            expect(retrieved!.allowed_actions).toEqual([]);
            expect(retrieved!.blocked_actions).toEqual([]);
        });
    });

    // ===================== BRANCH COVERAGE: Ethics Rules =====================

    describe('Ethics Rules branch coverage', () => {
        test('createEthicsRule with empty description and message (line 1651)', () => {
            const mod = db.createEthicsModule({ name: 'Rule Test' });
            // Pass undefined/empty strings to trigger the || '' fallback
            const rule = db.createEthicsRule({
                module_id: mod.id, name: 'Minimal Rule', description: '', condition: 'true', action: 'allow', priority: 1, enabled: true, message: ''
            });
            expect(rule.description).toBe('');
            expect(rule.message).toBe('');
        });

        test('updateEthicsRule covers all field branches (lines 1665-1671)', () => {
            const mod = db.createEthicsModule({ name: 'Rule Test' });
            const rule = db.createEthicsRule({
                module_id: mod.id, name: 'Rule', description: '', condition: 'true', action: 'allow', priority: 1, enabled: true, message: ''
            });
            db.updateEthicsRule(rule.id, {
                name: 'Updated Rule',
                description: 'New desc',
                condition: 'false',
                action: 'block',
                priority: 10,
                enabled: false,
                message: 'Blocked!',
            });
            const rules = db.getEthicsRulesByModule(mod.id);
            expect(rules[0].name).toBe('Updated Rule');
            expect(rules[0].description).toBe('New desc');
            expect(rules[0].condition).toBe('false');
            expect(rules[0].action).toBe('block');
            expect(rules[0].priority).toBe(10);
            expect(rules[0].enabled).toBe(false);
            expect(rules[0].message).toBe('Blocked!');
        });

        test('updateEthicsRule with enabled=false (line 1670 ternary right)', () => {
            const mod = db.createEthicsModule({ name: 'Enabled Test' });
            const rule = db.createEthicsRule({
                module_id: mod.id, name: 'Rule', description: '', condition: 'true', action: 'allow', priority: 1, enabled: true, message: ''
            });
            db.updateEthicsRule(rule.id, { enabled: false });
            const rules = db.getEthicsRulesByModule(mod.id);
            expect(rules[0].enabled).toBe(false);
        });

        test('updateEthicsRule with enabled=true (line 1670 ternary left)', () => {
            const mod = db.createEthicsModule({ name: 'Enabled Test 2' });
            const rule = db.createEthicsRule({
                module_id: mod.id, name: 'Rule', description: '', condition: 'true', action: 'allow', priority: 1, enabled: false, message: ''
            });
            db.updateEthicsRule(rule.id, { enabled: true });
            const rules = db.getEthicsRulesByModule(mod.id);
            expect(rules[0].enabled).toBe(true);
        });

        test('updateEthicsRule with no fields does nothing (line 1672)', () => {
            const mod = db.createEthicsModule({ name: 'Empty Rule' });
            const rule = db.createEthicsRule({
                module_id: mod.id, name: 'Rule', description: '', condition: 'true', action: 'allow', priority: 1, enabled: true, message: ''
            });
            db.updateEthicsRule(rule.id, {});
            const rules = db.getEthicsRulesByModule(mod.id);
            expect(rules[0].name).toBe('Rule');
        });
    });

    // ===================== BRANCH COVERAGE: Ethics Audit =====================

    describe('Ethics Audit branch coverage', () => {
        test('createEthicsAuditEntry with context_snapshot fallback (line 1704)', () => {
            const mod = db.createEthicsModule({ name: 'Audit Test' });
            // No context_snapshot provided (falsy) to hit || '{}' branch
            const entry = db.createEthicsAuditEntry({
                module_id: mod.id,
                rule_id: null,
                action_description: 'test action',
                decision: 'allowed',
                requestor: 'agent',
                context_snapshot: '',
                override_by: null,
                override_reason: null,
            });
            expect(entry.id).toBeDefined();
        });

        test('getEthicsAuditLog uses default limit (line 1709)', () => {
            const mod = db.createEthicsModule({ name: 'Audit Default' });
            db.createEthicsAuditEntry({
                module_id: mod.id, rule_id: null, action_description: 'test',
                decision: 'allowed', requestor: 'agent', context_snapshot: '{}',
                override_by: null, override_reason: null,
            });
            // Call without limit or moduleId
            const log = db.getEthicsAuditLog();
            expect(log.length).toBeGreaterThanOrEqual(1);
        });
    });

    // ===================== BRANCH COVERAGE: Action Log =====================

    describe('Action Log branch coverage', () => {
        test('createActionLog with default severity and null optional fields (lines 1740-1741)', () => {
            const entry = db.createActionLog({
                source: 'coding_agent',
                category: 'code_generation',
                action: 'test_action',
                detail: '',
                severity: '' as any,
                entity_type: null,
                entity_id: null,
                device_id: null,
                correlation_id: null,
                synced: false,
            } as any);
            expect(entry.id).toBeDefined();
        });

        test('getActionLog with both source and category filter (line 1750)', () => {
            db.createActionLog({
                source: 'coding_agent', category: 'code_generation', action: 'a1', detail: '',
                severity: 'info', entity_type: null, entity_id: null,
                device_id: null, correlation_id: null, synced: false,
            } as any);
            db.createActionLog({
                source: 'coding_agent', category: 'ethics_decision', action: 'a2', detail: '',
                severity: 'info', entity_type: null, entity_id: null,
                device_id: null, correlation_id: null, synced: false,
            } as any);
            const result = db.getActionLog(100, 'coding_agent', 'code_generation');
            expect(result.length).toBe(1);
            expect(result[0].action).toBe('a1');
        });

        test('getActionLog with default limit (line 1745)', () => {
            const log = db.getActionLog();
            expect(Array.isArray(log)).toBe(true);
        });

        test('markActionLogsSynced with empty array (line 1776)', () => {
            db.markActionLogsSynced([]);
            // Should not throw
        });
    });

    // ===================== BRANCH COVERAGE: Code Diffs =====================

    describe('Code Diffs branch coverage', () => {
        test('createCodeDiff with default status and null optional fields (lines 1790-1791)', () => {
            const diff = db.createCodeDiff({
                request_id: 'req-1',
                entity_type: 'comp',
                entity_id: 'c1',
                before: '',
                after: '',
                unified_diff: '',
                lines_added: 0,
                lines_removed: 0,
                reviewed_by: null,
                review_comment: null,
            } as any);
            expect(diff.status).toBe('pending');
        });

        test('updateCodeDiff with no fields returns existing (line 1818)', () => {
            const diff = db.createCodeDiff({
                request_id: 'req-1', entity_type: 'comp', entity_id: 'c1',
                before: '', after: '', unified_diff: '', lines_added: 0, lines_removed: 0,
                status: 'pending' as any, reviewed_by: null, review_comment: null,
            });
            const result = db.updateCodeDiff(diff.id, {});
            expect(result!.status).toBe('pending');
        });

        test('rowToCodeDiff handles null reviewed_by and review_comment (line 1838-1839)', () => {
            const diff = db.createCodeDiff({
                request_id: 'req-1', entity_type: 'comp', entity_id: 'c1',
                before: '', after: '', unified_diff: '', lines_added: 0, lines_removed: 0,
                status: 'pending' as any, reviewed_by: null, review_comment: null,
            });
            expect(diff.reviewed_by).toBeNull();
            expect(diff.review_comment).toBeNull();
        });
    });

    // ===================== BRANCH COVERAGE: Logic Blocks =====================

    describe('Logic Blocks branch coverage', () => {
        test('createLogicBlock with collapsed=true (line 1857)', () => {
            const plan = db.createPlan('Logic Plan');
            const block = db.createLogicBlock({
                plan_id: plan.id,
                type: 'if' as any,
                collapsed: true,
            });
            expect(block.collapsed).toBe(true);
        });

        test('getLogicBlock returns null for non-existent (line 1862-1863)', () => {
            expect(db.getLogicBlock('nonexistent')).toBeNull();
        });

        test('updateLogicBlock covers all field branches (lines 1897-1908)', () => {
            const plan = db.createPlan('Logic Plan');
            const block = db.createLogicBlock({ plan_id: plan.id, type: 'if' as any });
            const updated = db.updateLogicBlock(block.id, {
                label: 'New Label',
                condition: 'x > 0',
                body: 'return true',
                generated_code: 'if (x > 0) { return true; }',
                sort_order: 3,
                x: 50,
                y: 60,
                width: 300,
                height: 150,
                collapsed: true,
                parent_block_id: null,
            });
            expect(updated!.label).toBe('New Label');
            expect(updated!.condition).toBe('x > 0');
            expect(updated!.body).toBe('return true');
            expect(updated!.generated_code).toBe('if (x > 0) { return true; }');
            expect(updated!.sort_order).toBe(3);
            expect(updated!.x).toBe(50);
            expect(updated!.y).toBe(60);
            expect(updated!.width).toBe(300);
            expect(updated!.height).toBe(150);
            expect(updated!.collapsed).toBe(true);
            expect(updated!.parent_block_id).toBeNull();
        });

        test('updateLogicBlock with no fields returns existing (line 1908)', () => {
            const plan = db.createPlan('Logic Plan');
            const block = db.createLogicBlock({ plan_id: plan.id, type: 'if' as any, label: 'My Label' });
            const result = db.updateLogicBlock(block.id, {});
            expect(result!.label).toBe('My Label');
        });

        test('updateLogicBlock with only collapsed field (line 1906)', () => {
            const plan = db.createPlan('Logic Plan');
            const block = db.createLogicBlock({ plan_id: plan.id, type: 'if' as any });
            const updated = db.updateLogicBlock(block.id, { collapsed: true });
            expect(updated!.collapsed).toBe(true);
            const updated2 = db.updateLogicBlock(block.id, { collapsed: false });
            expect(updated2!.collapsed).toBe(false);
        });

        test('rowToLogicBlock defaults are used for normal creation (lines 1936-1941)', () => {
            // Create a logic block with minimal data - the rowToLogicBlock should
            // use ?? fallbacks for sort_order, x, y, width, height
            const plan = db.createPlan('Logic Plan');
            const block = db.createLogicBlock({
                plan_id: plan.id,
                type: 'if' as any,
            });
            // These should use the default values
            expect(block.sort_order).toBe(0);
            expect(block.x).toBe(0);
            expect(block.y).toBe(0);
            expect(block.width).toBe(280);
            expect(block.height).toBe(120);
            expect(block.page_id).toBeNull();
            expect(block.component_id).toBeNull();
            expect(block.parent_block_id).toBeNull();
        });
    });

    // ===================== BRANCH COVERAGE: Devices =====================

    describe('Devices branch coverage', () => {
        test('registerDevice with default last_seen_at (line 1957)', () => {
            const device = db.registerDevice({
                device_id: 'dev-default-time',
                name: 'Device',
                os: 'Linux',
                last_address: '',
                last_seen_at: '',
                is_current: false,
                sync_enabled: false,
                clock_value: 0,
            });
            expect(device.device_id).toBe('dev-default-time');
        });

        test('getCurrentDevice returns null when no current device (line 1973)', () => {
            expect(db.getCurrentDevice()).toBeNull();
        });

        test('updateDevice covers all field branches (lines 1980-1986)', () => {
            db.registerDevice({
                device_id: 'dev-update',
                name: 'Old Name',
                os: 'Windows',
                last_address: '1.2.3.4',
                last_seen_at: '2020-01-01',
                is_current: false,
                sync_enabled: false,
                clock_value: 0,
            });
            db.updateDevice('dev-update', {
                name: 'New Name',
                os: 'macOS',
                last_address: '5.6.7.8',
                last_seen_at: '2025-01-01',
                is_current: true,
                sync_enabled: true,
                clock_value: 42,
            });
            const updated = db.getDevice('dev-update');
            expect(updated!.name).toBe('New Name');
            expect(updated!.os).toBe('macOS');
            expect(updated!.last_address).toBe('5.6.7.8');
            expect(updated!.is_current).toBe(true);
            expect(updated!.sync_enabled).toBe(true);
            expect(updated!.clock_value).toBe(42);
        });

        test('updateDevice with is_current=true (line 1983 ternary left)', () => {
            db.registerDevice({
                device_id: 'dev-is-current',
                name: 'Device',
                os: '',
                last_address: '',
                last_seen_at: '',
                is_current: false,
                sync_enabled: false,
                clock_value: 0,
            });
            db.updateDevice('dev-is-current', { is_current: true });
            const device = db.getDevice('dev-is-current');
            expect(device!.is_current).toBe(true);
        });

        test('updateDevice with is_current=false (line 1983 ternary right)', () => {
            db.registerDevice({
                device_id: 'dev-is-current-false',
                name: 'Device',
                os: '',
                last_address: '',
                last_seen_at: '',
                is_current: true,
                sync_enabled: false,
                clock_value: 0,
            });
            db.updateDevice('dev-is-current-false', { is_current: false });
            const device = db.getDevice('dev-is-current-false');
            expect(device!.is_current).toBe(false);
        });

        test('updateDevice with no fields does nothing (line 1986)', () => {
            db.registerDevice({
                device_id: 'dev-noop',
                name: 'Name',
                os: '',
                last_address: '',
                last_seen_at: '',
                is_current: false,
                sync_enabled: false,
                clock_value: 0,
            });
            db.updateDevice('dev-noop', {});
            const device = db.getDevice('dev-noop');
            expect(device!.name).toBe('Name');
        });

        test('incrementDeviceClock returns 0 for non-existent device (line 1998)', () => {
            const result = db.incrementDeviceClock('nonexistent-device');
            expect(result).toBe(0);
        });
    });

    // ===================== BRANCH COVERAGE: Component Schemas =====================

    describe('Component Schemas branch coverage', () => {
        test('getComponentSchemaById returns null for non-existent (line 2041)', () => {
            expect(db.getComponentSchemaById('nonexistent')).toBeNull();
        });

        test('updateComponentSchema covers all field branches (lines 2059-2070)', () => {
            const schema = db.createComponentSchema({ type: 'test_comp', display_name: 'Test' });
            const updated = db.updateComponentSchema(schema.id, {
                display_name: 'Updated',
                category: 'container' as any,
                description: 'Updated desc',
                properties: [{ name: 'p1', type: 'string', default_value: '', required: false, description: '' }],
                events: [{ name: 'onClick', description: 'click', payload_type: 'void', example_handler: '' }],
                default_styles: { color: 'blue' },
                default_size: { width: 300, height: 200 },
                code_templates: { react_tsx: '<div />', html: '<div></div>', css: '.test {}' },
                icon: 'symbol-box',
                is_container: true,
                allowed_children: ['text_box', 'button'],
                instance_limits: { min: 1, max: 5 },
            });
            expect(updated!.display_name).toBe('Updated');
            expect(updated!.category).toBe('container');
            expect(updated!.description).toBe('Updated desc');
            expect(updated!.properties.length).toBe(1);
            expect(updated!.events.length).toBe(1);
            expect(updated!.default_styles).toEqual({ color: 'blue' });
            expect(updated!.default_size).toEqual({ width: 300, height: 200 });
            expect(updated!.code_templates).toEqual({ react_tsx: '<div />', html: '<div></div>', css: '.test {}' });
            expect(updated!.icon).toBe('symbol-box');
            expect(updated!.is_container).toBe(true);
            expect(updated!.allowed_children).toEqual(['text_box', 'button']);
            expect(updated!.instance_limits).toEqual({ min: 1, max: 5 });
        });

        test('updateComponentSchema with no fields returns existing (line 2071)', () => {
            const schema = db.createComponentSchema({ type: 'noop_comp', display_name: 'NoOp' });
            const result = db.updateComponentSchema(schema.id, {});
            expect(result!.display_name).toBe('NoOp');
        });

        test('updateComponentSchema with allowed_children set to null (line 2069)', () => {
            const schema = db.createComponentSchema({
                type: 'null_children', display_name: 'NullChildren',
                allowed_children: ['button'],
            });
            const updated = db.updateComponentSchema(schema.id, { allowed_children: null });
            expect(updated!.allowed_children).toBeNull();
        });

        test('rowToComponentSchema handles empty string values with fallbacks (lines 2090-2098)', () => {
            // The table has NOT NULL DEFAULT constraints, so we use empty strings
            // to trigger the || '[]' and || '{}' fallback paths
            const rawDb = (db as any).db;
            rawDb.prepare(`INSERT INTO component_schemas (id, type, display_name, category, description, properties, events, default_styles, default_size, code_templates, icon, is_container, allowed_children, instance_limits, created_at, updated_at)
                VALUES ('null-schema', 'null_type', 'Null Schema', 'display', '', '', '', '', '', '', 'symbol-misc', 0, NULL, '', datetime('now'), datetime('now'))`).run();

            const schema = db.getComponentSchemaById('null-schema');
            expect(schema!.properties).toEqual([]);
            expect(schema!.events).toEqual([]);
            expect(schema!.default_styles).toEqual({});
            expect(schema!.default_size).toEqual({ width: 200, height: 100 });
            expect(schema!.code_templates).toEqual({});
            expect(schema!.allowed_children).toBeNull();
            expect(schema!.instance_limits).toEqual({ min: 0, max: null });
        });

        test('createComponentSchema with is_container=true and allowed_children (line 2029)', () => {
            const schema = db.createComponentSchema({
                type: 'container_comp',
                display_name: 'Container',
                is_container: true,
                allowed_children: ['button', 'text'],
            });
            expect(schema.is_container).toBe(true);
            expect(schema.allowed_children).toEqual(['button', 'text']);
        });
    });

    // ===================== BRANCH COVERAGE: NULL fallback via ?? in row-parsing methods =====================
    // The DB schema has NOT NULL DEFAULT constraints, so columns can't be NULL via UPDATE.
    // We call the private row-parsing methods directly with mock row objects containing null values
    // to exercise the ?? fallback branches.

    describe('rowToTask NULL fallback for sort_order (line 672)', () => {
        test('sort_order null falls back to 0 via ??', () => {
            const rowToTask = (db as any).rowToTask.bind(db);
            const mockRow = {
                id: 'mock-task-1',
                title: 'Mock Task',
                description: 'desc',
                status: 'not_started',
                priority: 'P2',
                dependencies: '[]',
                acceptance_criteria: '',
                plan_id: null,
                parent_task_id: null,
                sort_order: null,  // NULL triggers ?? 0
                estimated_minutes: 30,
                files_modified: '[]',
                context_bundle: null,
                created_at: '2025-01-01T00:00:00.000Z',
                updated_at: '2025-01-01T00:00:00.000Z',
            };
            const task = rowToTask(mockRow);
            expect(task.sort_order).toBe(0);
        });
    });

    describe('parseComponentRow NULL fallbacks for sort_order/x/y/width/height (lines 1180-1184)', () => {
        test('NULL sort_order/x/y/width/height fall back to defaults via ??', () => {
            const parseComponentRow = (db as any).parseComponentRow.bind(db);
            const mockRow = {
                id: 'mock-comp-1',
                plan_id: 'plan-1',
                page_id: null,
                type: 'button',
                name: 'Mock Component',
                parent_id: null,
                sort_order: null,  // NULL triggers ?? 0
                x: null,           // NULL triggers ?? 0
                y: null,           // NULL triggers ?? 0
                width: null,       // NULL triggers ?? 200
                height: null,      // NULL triggers ?? 100
                styles: '{}',
                content: 'test',
                props: '{}',
                responsive: '{}',
                created_at: '2025-01-01T00:00:00.000Z',
                updated_at: '2025-01-01T00:00:00.000Z',
            };
            const comp = parseComponentRow(mockRow);
            expect(comp.sort_order).toBe(0);
            expect(comp.x).toBe(0);
            expect(comp.y).toBe(0);
            expect(comp.width).toBe(200);
            expect(comp.height).toBe(100);
        });
    });

    describe('rowToLogicBlock NULL fallbacks for sort_order/x/y/width/height (lines 1937-1942)', () => {
        test('NULL sort_order/x/y/width/height fall back to defaults via ??', () => {
            const rowToLogicBlock = (db as any).rowToLogicBlock.bind(db);
            const mockRow = {
                id: 'mock-block-1',
                page_id: null,
                component_id: null,
                plan_id: 'plan-1',
                type: 'if',
                label: 'Test',
                condition: 'x > 0',
                body: 'do something',
                parent_block_id: null,
                sort_order: null,  // NULL triggers ?? 0
                generated_code: '',
                x: null,           // NULL triggers ?? 0
                y: null,           // NULL triggers ?? 0
                width: null,       // NULL triggers ?? 280
                height: null,      // NULL triggers ?? 120
                collapsed: 0,
                created_at: '2025-01-01T00:00:00.000Z',
                updated_at: '2025-01-01T00:00:00.000Z',
            };
            const block = rowToLogicBlock(mockRow);
            expect(block.sort_order).toBe(0);
            expect(block.x).toBe(0);
            expect(block.y).toBe(0);
            expect(block.width).toBe(280);
            expect(block.height).toBe(120);
        });
    });
});
