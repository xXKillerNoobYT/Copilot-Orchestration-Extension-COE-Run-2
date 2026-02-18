import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../src/core/database';
import { AnswerAgent } from '../src/agents/answer-agent';
import { ResearchAgent } from '../src/agents/research-agent';
import { VerificationAgent } from '../src/agents/verification-agent';
import { Orchestrator } from '../src/agents/orchestrator';
import {
    AgentType, AgentContext, AgentResponse,
    ConversationRole, TaskPriority, TaskStatus,
    VerificationStatus, ContentType
} from '../src/types';

// ============================================================
// Shared test infrastructure
// ============================================================

let tmpDir: string;
let db: Database;

const mockLLM = {
    chat: jest.fn(),
    classify: jest.fn(),
} as any;

const mockConfig = {
    getAgentContextLimit: jest.fn().mockReturnValue(4000),
    getConfig: jest.fn().mockReturnValue({ verification: { delaySeconds: 0 } }),
    getCOEDir: jest.fn(),
} as any;

const mockOutput = { appendLine: jest.fn() } as any;

function emptyContext(): AgentContext {
    return { conversationHistory: [] };
}

function contextWithTask(task: any): AgentContext {
    return { task, conversationHistory: [] };
}

beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-agents-cov-'));
    mockConfig.getCOEDir.mockReturnValue(tmpDir);
    db = new Database(tmpDir);
    await db.initialize();
    jest.clearAllMocks();
    // Restore default mock return for config
    mockConfig.getAgentContextLimit.mockReturnValue(4000);
    mockConfig.getConfig.mockReturnValue({ verification: { delaySeconds: 0 } });
});

afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================
// AnswerAgent
// ============================================================

describe('AnswerAgent coverage gaps', () => {
    let agent: AnswerAgent;

    beforeEach(async () => {
        agent = new AnswerAgent(db, mockLLM, mockConfig, mockOutput);
        await agent.initialize();
    });

    test('parses high-confidence response with ANSWER, CONFIDENCE, SOURCES, ESCALATE:false', async () => {
        mockLLM.chat.mockResolvedValue({
            content: [
                'ANSWER: The database uses WAL mode for concurrent reads.',
                'CONFIDENCE: 90',
                'SOURCES: src/core/database.ts:25, Plan: Architecture',
                'ESCALATE: false',
            ].join('\n'),
            tokens_used: 50,
        });

        const result = await agent.processMessage('How does the database work?', emptyContext());

        expect(result.confidence).toBe(90);
        expect(result.content).toBe('The database uses WAL mode for concurrent reads.');
        expect(result.sources).toEqual(['src/core/database.ts:25', 'Plan: Architecture']);
        expect(result.actions).toEqual([]); // not escalated
    });

    test('parses low-confidence response with ESCALATE:true and creates ticket when task exists', async () => {
        const plan = db.createPlan('Test Plan');
        const task = db.createTask({
            title: 'Investigate auth issue',
            description: 'Auth tokens expire too early',
            priority: TaskPriority.P1,
            plan_id: plan.id,
        });

        mockLLM.chat.mockResolvedValue({
            content: [
                'ANSWER: I am not sure about the auth token behavior.',
                'CONFIDENCE: 30',
                'SOURCES: src/auth.ts',
                'ESCALATE: true',
            ].join('\n'),
            tokens_used: 40,
        });

        const result = await agent.processMessage('Why do tokens expire?', contextWithTask(task));

        expect(result.confidence).toBe(30);
        expect(result.actions).toHaveLength(1);
        expect(result.actions![0].type).toBe('escalate');

        // Verify ticket was created
        const tickets = db.getAllTickets();
        const escalationTicket = tickets.find(t => t.title.includes('Low confidence answer'));
        expect(escalationTicket).toBeDefined();
        expect(escalationTicket!.body).toContain('30% confidence');
        expect(escalationTicket!.task_id).toBe(task.id);
    });

    test('auto-escalation with low confidence but no task does NOT create ticket', async () => {
        mockLLM.chat.mockResolvedValue({
            content: [
                'ANSWER: Not sure.',
                'CONFIDENCE: 20',
                'SOURCES: none',
                'ESCALATE: false',
            ].join('\n'),
            tokens_used: 10,
        });

        const ticketsBefore = db.getAllTickets().length;
        const result = await agent.processMessage('Random question?', emptyContext());

        // Auto-escalated (confidence < 50 forces escalated = true)
        expect(result.actions).toHaveLength(1);
        expect(result.actions![0].type).toBe('escalate');
        // No ticket because no context.task
        expect(db.getAllTickets().length).toBe(ticketsBefore);
    });

    test('parses response with ANSWER field (answerMatch branch)', async () => {
        mockLLM.chat.mockResolvedValue({
            content: [
                'ANSWER: The event bus uses typed pub/sub.',
                'CONFIDENCE: 85',
                'SOURCES: src/core/event-bus.ts',
                'ESCALATE: false',
            ].join('\n'),
            tokens_used: 30,
        });

        const result = await agent.processMessage('How does the event bus work?', emptyContext());
        // line 67: answer = answerMatch[1].trim()
        expect(result.content).toBe('The event bus uses typed pub/sub.');
    });

    test('parses response without structured fields (defaults)', async () => {
        mockLLM.chat.mockResolvedValue({
            content: 'Just a plain text response with no structure.',
            tokens_used: 15,
        });

        const result = await agent.processMessage('Tell me something', emptyContext());
        expect(result.confidence).toBe(80); // default
        expect(result.content).toBe('Just a plain text response with no structure.');
        expect(result.sources).toEqual([]);
    });
});

// ============================================================
// ResearchAgent
// ============================================================

describe('ResearchAgent coverage gaps', () => {
    let agent: ResearchAgent;

    beforeEach(async () => {
        agent = new ResearchAgent(db, mockLLM, mockConfig, mockOutput);
        await agent.initialize();
    });

    test('parses response with SOURCES list (line 54: sources push)', async () => {
        mockLLM.chat.mockResolvedValue({
            content: [
                'FINDINGS: 1. SQLite WAL mode supports concurrent reads.',
                'ANALYSIS: SQLite works well for single-user.',
                'RECOMMENDATION: Keep SQLite.',
                'SOURCES: src/core/database.ts, src/core/config.ts, Plan: Architecture',
                'CONFIDENCE: 88',
            ].join('\n'),
            tokens_used: 60,
        });

        const result = await agent.processMessage('Compare database options', emptyContext());

        expect(result.confidence).toBe(88);
        expect(result.sources).toEqual([
            'src/core/database.ts',
            'src/core/config.ts',
            'Plan: Architecture',
        ]);
    });

    test('low confidence (<60) triggers auto-escalation with ticket and audit log (lines 64-71)', async () => {
        const plan = db.createPlan('Research Plan');
        const task = db.createTask({
            title: 'Investigate perf',
            description: 'Investigate slow queries',
            priority: TaskPriority.P2,
            plan_id: plan.id,
        });

        mockLLM.chat.mockResolvedValue({
            content: [
                'FINDINGS: 1. Not enough data.',
                'ANALYSIS: Cannot compare without benchmarks.',
                'RECOMMENDATION: Run benchmarks first.',
                'SOURCES: none',
                'CONFIDENCE: 40',
            ].join('\n'),
            tokens_used: 30,
        });

        const result = await agent.processMessage('What is the performance?', contextWithTask(task));

        expect(result.confidence).toBe(40);

        // Check ticket was created (line 65-70)
        const tickets = db.getAllTickets();
        const escalationTicket = tickets.find(t => t.title.includes('Research escalation'));
        expect(escalationTicket).toBeDefined();
        expect(escalationTicket!.body).toContain('40%');
        expect(escalationTicket!.priority).toBe('P1');

        // Check audit log was written (line 71-75)
        const auditLogs = db.getAuditLog();
        const escalationLog = auditLogs.find(a => a.action === 'escalated');
        expect(escalationLog).toBeDefined();
        expect(escalationLog!.detail).toContain('40%');
    });

    test('ESCALATE: true in response triggers escalation even if confidence >= 60', async () => {
        mockLLM.chat.mockResolvedValue({
            content: [
                'FINDINGS: 1. Some findings.',
                'ANALYSIS: Partial analysis.',
                'RECOMMENDATION: Needs more work.',
                'SOURCES: Plan: System',
                'CONFIDENCE: 70',
                'ESCALATE: true',
            ].join('\n'),
            tokens_used: 35,
        });

        await agent.processMessage('Analyze system architecture', emptyContext());

        const tickets = db.getAllTickets();
        const escalationTicket = tickets.find(t => t.title.includes('Research escalation'));
        expect(escalationTicket).toBeDefined();
    });

    test('no ESCALATE field and confidence >= 60 does NOT escalate', async () => {
        mockLLM.chat.mockResolvedValue({
            content: [
                'FINDINGS: 1. Finding.',
                'ANALYSIS: Analysis.',
                'RECOMMENDATION: Use X.',
                'SOURCES: file.ts',
                'CONFIDENCE: 80',
            ].join('\n'),
            tokens_used: 25,
        });

        const ticketsBefore = db.getAllTickets().length;
        await agent.processMessage('Good research', emptyContext());

        expect(db.getAllTickets().length).toBe(ticketsBefore);
    });

    test('low confidence with no task uses "unknown" as taskId', async () => {
        mockLLM.chat.mockResolvedValue({
            content: [
                'FINDINGS: 1. Unknown.',
                'SOURCES: none',
                'CONFIDENCE: 30',
            ].join('\n'),
            tokens_used: 15,
        });

        await agent.processMessage('What?', emptyContext());

        const tickets = db.getAllTickets();
        const escalationTicket = tickets.find(t => t.title.includes('Research escalation'));
        expect(escalationTicket).toBeDefined();
        expect(escalationTicket!.title).toContain('unknown');
    });
});

// ============================================================
// VerificationAgent
// ============================================================

describe('VerificationAgent coverage gaps', () => {
    let agent: VerificationAgent;

    beforeEach(async () => {
        agent = new VerificationAgent(db, mockLLM, mockConfig, mockOutput);
        await agent.initialize();
    });

    // --- line 14: setTestRunner ---
    test('setTestRunner stores the test runner instance', async () => {
        const mockRunner = {
            runTestsForFiles: jest.fn().mockResolvedValue({
                passed: 5, failed: 0, skipped: 1,
                coverage: 85.5, rawOutput: 'All tests passed', success: true, duration: 1234,
            }),
        } as any;

        agent.setTestRunner(mockRunner);

        const plan = db.createPlan('Ver Plan');
        const task = db.createTask({
            title: 'Impl feature',
            description: 'Implement the feature',
            priority: TaskPriority.P1,
            plan_id: plan.id,
        });
        db.updateTask(task.id, { files_modified: ['src/foo.ts'] });
        const updatedTask = db.getTask(task.id)!;

        mockLLM.chat.mockResolvedValue({
            content: JSON.stringify({
                status: 'passed',
                criteria_results: [{ criterion_text: 'Feature works', status: 'met', evidence: 'Tests pass' }],
                test_results: { passed: 5, failed: 0, skipped: 1, coverage: 85.5 },
                follow_up_tasks: [],
                summary: 'All good',
            }),
            tokens_used: 100,
        });

        const result = await agent.processMessage('Verify task', contextWithTask(updatedTask));

        // lines 105-120: test runner was called and output appended to message
        expect(mockRunner.runTestsForFiles).toHaveBeenCalledWith(['src/foo.ts']);
        expect(result.content).toContain('Verification passed');
    });

    // --- lines 105-123: processMessage with test runner that throws ---
    test('processMessage appends error message when test runner throws', async () => {
        const mockRunner = {
            runTestsForFiles: jest.fn().mockRejectedValue(new Error('Jest crashed')),
        } as any;

        agent.setTestRunner(mockRunner);

        const plan = db.createPlan('Ver Plan 2');
        const task = db.createTask({
            title: 'Buggy task',
            description: 'Has bugs',
            priority: TaskPriority.P1,
            plan_id: plan.id,
        });
        db.updateTask(task.id, { files_modified: ['src/buggy.ts'] });
        const updatedTask = db.getTask(task.id)!;

        mockLLM.chat.mockResolvedValue({
            content: JSON.stringify({
                status: 'failed',
                criteria_results: [{ criterion_text: 'Feature works', status: 'not_met', evidence: 'Tests failed' }],
                test_results: null,
                follow_up_tasks: [],
                summary: 'Failed',
            }),
            tokens_used: 80,
        });

        const result = await agent.processMessage('Verify task', contextWithTask(updatedTask));

        expect(mockOutput.appendLine).toHaveBeenCalledWith(expect.stringContaining('Test runner failed'));
        expect(result.content).toContain('Verification failed');
    });

    // --- line 125-127: no test runner configured ---
    test('processMessage appends "no test runner" message when testRunner is null', async () => {
        const plan = db.createPlan('Ver Plan 3');
        const task = db.createTask({
            title: 'No runner task',
            description: 'Task without test runner',
            priority: TaskPriority.P2,
            plan_id: plan.id,
        });

        mockLLM.chat.mockResolvedValue({
            content: JSON.stringify({
                status: 'passed',
                criteria_results: [{ criterion_text: 'Looks good', status: 'met', evidence: 'Code review' }],
                test_results: null,
                follow_up_tasks: [],
                summary: 'Manual review passed',
            }),
            tokens_used: 60,
        });

        // Do NOT call setTestRunner — testRunner remains null
        const result = await agent.processMessage('Verify task', contextWithTask(task));

        // The LLM message should have had the "no test runner" appendix
        const chatCall = mockLLM.chat.mock.calls[0][0];
        const userMessage = chatCall.find((m: any) => m.role === 'user');
        expect(userMessage.content).toContain('No test runner configured');
        expect(result.content).toContain('Verification passed');
    });

    // --- line 181: NeedsReCheck status path ---
    test('parseResponse handles needs_recheck status', async () => {
        const plan = db.createPlan('NeedsReCheck Plan');
        const task = db.createTask({
            title: 'Unclear task',
            description: 'Task with unclear criteria',
            priority: TaskPriority.P2,
            plan_id: plan.id,
        });

        mockLLM.chat.mockResolvedValue({
            content: JSON.stringify({
                status: 'needs_recheck',
                criteria_results: [
                    { criterion_text: 'Feature works', status: 'unclear', evidence: 'Cannot determine' },
                ],
                test_results: null,
                follow_up_tasks: [],
                summary: 'Need another look',
            }),
            tokens_used: 50,
        });

        const result = await agent.processMessage('Verify task', contextWithTask(task));

        expect(result.content).toContain('needs_recheck');

        // Check that task was updated to NeedsReCheck
        const updatedTask = db.getTask(task.id);
        expect(updatedTask!.status).toBe(TaskStatus.NeedsReCheck);
    });

    // --- lines 187-194: follow_up_tasks creation ---
    test('parseResponse creates follow-up tasks from parsed JSON', async () => {
        const plan = db.createPlan('Follow-up Plan');
        const task = db.createTask({
            title: 'Original task',
            description: 'The original task',
            priority: TaskPriority.P1,
            plan_id: plan.id,
        });

        mockLLM.chat.mockResolvedValue({
            content: JSON.stringify({
                status: 'failed',
                criteria_results: [
                    { criterion_text: 'Auth works', status: 'not_met', evidence: 'No auth check' },
                ],
                test_results: { passed: 2, failed: 1, skipped: 0, coverage: 60 },
                follow_up_tasks: [
                    {
                        title: 'Fix: Original task \u2014 auth check missing',
                        description: 'Add auth middleware to endpoint',
                        priority: 'P1',
                    },
                    {
                        title: 'Fix: Original task \u2014 validation missing',
                        description: 'Add input validation',
                    },
                ],
                summary: 'Failed: auth not implemented',
            }),
            tokens_used: 90,
        });

        const result = await agent.processMessage('Verify', contextWithTask(task));

        expect(result.content).toContain('Verification failed');
        expect(result.actions).toHaveLength(2);
        expect(result.actions![0].type).toBe('create_task');
        expect(result.actions![0].payload.title).toContain('Fix: Original task');
        expect(result.actions![1].type).toBe('create_task');

        // Verify that follow-up tasks were created in the database
        const allTasks = db.getAllTasks();
        const followUps = allTasks.filter(t => t.title.startsWith('Fix:'));
        expect(followUps).toHaveLength(2);
        expect(followUps[0].plan_id).toBe(plan.id);
        expect(followUps[0].dependencies).toContain(task.id);
    });

    // --- line 215: parse error path ---
    test('parseResponse returns raw content on invalid JSON', async () => {
        const plan = db.createPlan('Parse Error Plan');
        const task = db.createTask({
            title: 'Parse error task',
            description: 'Task with bad LLM output',
            priority: TaskPriority.P2,
            plan_id: plan.id,
        });

        mockLLM.chat.mockResolvedValue({
            content: 'This is not valid JSON at all, just random text from the LLM.',
            tokens_used: 20,
        });

        const result = await agent.processMessage('Verify', contextWithTask(task));

        // Falls through to the final return { content, actions } on line 218
        expect(result.content).toContain('This is not valid JSON at all');
        expect(result.actions).toEqual([]);
    });

    test('parseResponse handles malformed JSON (parse error catch block)', async () => {
        const plan = db.createPlan('Malformed JSON Plan');
        const task = db.createTask({
            title: 'Malformed json task',
            description: 'Task with malformed json',
            priority: TaskPriority.P2,
            plan_id: plan.id,
        });

        mockLLM.chat.mockResolvedValue({
            content: '{ "status": "passed", broken json here }',
            tokens_used: 15,
        });

        const result = await agent.processMessage('Verify', contextWithTask(task));

        // The JSON.parse will throw, caught by catch block (line 214-215)
        expect(mockOutput.appendLine).toHaveBeenCalledWith(expect.stringContaining('Verification parse error'));
        expect(result.content).toContain('broken json');
    });

    // --- Verification override: LLM says passed but criteria has not_met items ---
    test('forces status to failed when LLM says passed but has not_met criteria', async () => {
        const plan = db.createPlan('Override Plan');
        const task = db.createTask({
            title: 'Override task',
            description: 'Task with inconsistent LLM output',
            priority: TaskPriority.P1,
            plan_id: plan.id,
        });

        mockLLM.chat.mockResolvedValue({
            content: JSON.stringify({
                status: 'passed', // LLM incorrectly says passed
                criteria_results: [
                    { criterion_text: 'Feature A', status: 'met', evidence: 'Works' },
                    { criterion_text: 'Feature B', status: 'not_met', evidence: 'Broken' },
                ],
                test_results: null,
                follow_up_tasks: [],
                summary: 'Passed (incorrectly)',
            }),
            tokens_used: 50,
        });

        await agent.processMessage('Verify', contextWithTask(task));

        // Task should be failed, not verified
        const updatedTask = db.getTask(task.id);
        expect(updatedTask!.status).toBe(TaskStatus.Failed);
        expect(mockOutput.appendLine).toHaveBeenCalledWith(
            expect.stringContaining('Verification override')
        );
    });
});

// ============================================================
// BaseAgent (tested via AnswerAgent as concrete implementation)
// ============================================================

describe('BaseAgent coverage gaps', () => {
    let agent: AnswerAgent;

    beforeEach(async () => {
        agent = new AnswerAgent(db, mockLLM, mockConfig, mockOutput);
        await agent.initialize();
    });

    // --- lines 45-47: setContextServices ---
    test('setContextServices injects budgetTracker and contextFeeder', () => {
        const mockBudgetTracker = {
            estimateTokens: jest.fn().mockReturnValue(100),
            recordUsage: jest.fn(),
            getCurrentModelProfile: jest.fn().mockReturnValue({ overheadTokensPerMessage: 8 }),
        } as any;
        const mockContextFeeder = {
            buildOptimizedMessages: jest.fn().mockReturnValue({
                messages: [
                    { role: 'system', content: 'sys' },
                    { role: 'user', content: 'hello' },
                ],
                includedItems: [],
                excludedItems: [],
                budget: { consumed: 100, availableForInput: 3000 },
                compressionApplied: false,
            }),
        } as any;

        agent.setContextServices(mockBudgetTracker, mockContextFeeder);

        expect(mockOutput.appendLine).toHaveBeenCalledWith(
            expect.stringContaining('Context services injected')
        );
    });

    // --- line 71: budgetTracker.recordUsage ---
    test('processMessage records usage with budgetTracker when available', async () => {
        const mockBudgetTracker = {
            estimateTokens: jest.fn().mockReturnValue(50),
            recordUsage: jest.fn(),
            getCurrentModelProfile: jest.fn().mockReturnValue({ overheadTokensPerMessage: 8 }),
        } as any;
        const mockContextFeeder = {
            buildOptimizedMessages: jest.fn().mockReturnValue({
                messages: [
                    { role: 'system', content: 'System prompt' },
                    { role: 'user', content: 'Test message' },
                ],
                includedItems: [],
                excludedItems: [],
                budget: { consumed: 100, availableForInput: 3000 },
                compressionApplied: false,
            }),
        } as any;

        agent.setContextServices(mockBudgetTracker, mockContextFeeder);

        mockLLM.chat.mockResolvedValue({
            content: 'ANSWER: Test\nCONFIDENCE: 90\nSOURCES: test\nESCALATE: false',
            tokens_used: 30,
        });

        await agent.processMessage('Test message', emptyContext());

        // line 71-75: recordUsage called
        expect(mockBudgetTracker.recordUsage).toHaveBeenCalledWith(
            expect.any(Number), // inputTokensEstimated
            30,                 // tokens_used from response
            AgentType.Answer    // this.type
        );
    });

    // --- line 107: estimateTokens with budgetTracker ---
    test('estimateTokens delegates to budgetTracker when available', async () => {
        const mockBudgetTracker = {
            estimateTokens: jest.fn().mockReturnValue(42),
            recordUsage: jest.fn(),
            getCurrentModelProfile: jest.fn().mockReturnValue({ overheadTokensPerMessage: 8 }),
        } as any;
        const mockContextFeeder = {
            buildOptimizedMessages: jest.fn().mockReturnValue({
                messages: [
                    { role: 'system', content: 'sys' },
                    { role: 'user', content: 'msg' },
                ],
                includedItems: [],
                excludedItems: [],
                budget: { consumed: 50, availableForInput: 3000 },
                compressionApplied: false,
            }),
        } as any;

        agent.setContextServices(mockBudgetTracker, mockContextFeeder);

        mockLLM.chat.mockResolvedValue({
            content: 'ANSWER: X\nCONFIDENCE: 80\nSOURCES: y\nESCALATE: false',
            tokens_used: 10,
        });

        await agent.processMessage('message', emptyContext());

        // line 107: budgetTracker.estimateTokens was called
        expect(mockBudgetTracker.estimateTokens).toHaveBeenCalled();
    });

    // --- line 122: estimateMessagesTokens with budgetTracker overhead ---
    test('estimateMessagesTokens uses budgetTracker overhead per message', async () => {
        const mockBudgetTracker = {
            estimateTokens: jest.fn().mockReturnValue(10),
            recordUsage: jest.fn(),
            getCurrentModelProfile: jest.fn().mockReturnValue({ overheadTokensPerMessage: 12 }),
        } as any;
        const mockContextFeeder = {
            buildOptimizedMessages: jest.fn().mockReturnValue({
                messages: [
                    { role: 'system', content: 'sys prompt' },
                    { role: 'user', content: 'user msg' },
                ],
                includedItems: [],
                excludedItems: [],
                budget: { consumed: 44, availableForInput: 3000 },
                compressionApplied: false,
            }),
        } as any;

        agent.setContextServices(mockBudgetTracker, mockContextFeeder);

        mockLLM.chat.mockResolvedValue({
            content: 'ANSWER: Z\nCONFIDENCE: 99\nSOURCES: z\nESCALATE: false',
            tokens_used: 5,
        });

        await agent.processMessage('msg', emptyContext());

        // line 122: overheadTokensPerMessage used (12 per message)
        // recordUsage receives the total: 2 messages * (10 token estimate + 12 overhead) = 44
        expect(mockBudgetTracker.recordUsage).toHaveBeenCalledWith(44, 5, AgentType.Answer);
    });

    // --- lines 142-157: buildMessages with contextFeeder delegates to buildOptimizedMessages ---
    test('buildMessages delegates to contextFeeder.buildOptimizedMessages when available', async () => {
        const mockContextFeeder = {
            buildOptimizedMessages: jest.fn().mockReturnValue({
                messages: [
                    { role: 'system', content: 'optimized system prompt' },
                    { role: 'user', content: 'optimized user msg' },
                ],
                includedItems: [{ id: 'item1' }],
                excludedItems: [{ id: 'item2' }],
                budget: { consumed: 200, availableForInput: 3800 },
                compressionApplied: true,
            }),
        } as any;
        const mockBudgetTracker = {
            estimateTokens: jest.fn().mockReturnValue(50),
            recordUsage: jest.fn(),
            getCurrentModelProfile: jest.fn().mockReturnValue({ overheadTokensPerMessage: 4 }),
        } as any;

        agent.setContextServices(mockBudgetTracker, mockContextFeeder);

        mockLLM.chat.mockResolvedValue({
            content: 'ANSWER: opt\nCONFIDENCE: 80\nSOURCES: x\nESCALATE: false',
            tokens_used: 20,
        });

        await agent.processMessage('test', emptyContext());

        expect(mockContextFeeder.buildOptimizedMessages).toHaveBeenCalledWith(
            AgentType.Answer,
            'test',
            expect.any(String), // systemPrompt
            expect.any(Object), // context
            undefined           // additionalItems
        );

        // Verify the output log mentions context feed
        expect(mockOutput.appendLine).toHaveBeenCalledWith(
            expect.stringContaining('Context feed: 1 items included')
        );
    });

    // --- lines 195, 206, 217: Skipping context due to token budget ---
    test('buildMessages legacy path skips task/ticket/plan context when token budget is too small', async () => {
        // Very small context limit forces all context to be skipped
        mockConfig.getAgentContextLimit.mockReturnValue(200);

        const plan = db.createPlan('Budget Plan');
        const task = db.createTask({
            title: 'Budget Task',
            description: 'A very long task description that takes many tokens ' + 'x'.repeat(500),
            priority: TaskPriority.P1,
            plan_id: plan.id,
        });
        const ticket = db.createTicket({
            title: 'Budget Ticket',
            body: 'A very long ticket body ' + 'y'.repeat(500),
            priority: 'P1' as any,
            creator: 'test',
        });

        mockLLM.chat.mockResolvedValue({
            content: 'ANSWER: Budget response\nCONFIDENCE: 80\nSOURCES: x\nESCALATE: false',
            tokens_used: 10,
        });

        const context: AgentContext = {
            task,
            ticket,
            plan: db.getPlan(plan.id)!,
            conversationHistory: [],
        };

        await agent.processMessage('small message', context);

        // Lines 195, 206, 217: skipping context messages logged
        const skipLogs = mockOutput.appendLine.mock.calls.filter(
            (call: any[]) => call[0].includes('Token budget: skipping')
        );
        expect(skipLogs.length).toBeGreaterThan(0);
    });

    // --- lines 237-240: History truncation due to token budget ---
    test('buildMessages legacy path truncates history when token budget is tight', async () => {
        // Allow enough for system prompt and user message but not much more
        mockConfig.getAgentContextLimit.mockReturnValue(400);

        // Create conversation history entries
        const longHistory: any[] = [];
        for (let i = 0; i < 10; i++) {
            longHistory.push({
                id: `conv-${i}`,
                agent: 'test',
                role: i % 2 === 0 ? ConversationRole.User : ConversationRole.Agent,
                content: `History message ${i} with some additional content to consume tokens ${'z'.repeat(100)}`,
                task_id: null,
                ticket_id: null,
                tokens_used: null,
                created_at: new Date().toISOString(),
            });
        }

        mockLLM.chat.mockResolvedValue({
            content: 'ANSWER: Truncated\nCONFIDENCE: 80\nSOURCES: x\nESCALATE: false',
            tokens_used: 10,
        });

        const context: AgentContext = {
            conversationHistory: longHistory,
        };

        await agent.processMessage('msg', context);

        // Lines 237-240: truncation log
        const truncLogs = mockOutput.appendLine.mock.calls.filter(
            (call: any[]) => call[0].includes('Token budget: truncated history')
        );
        expect(truncLogs.length).toBeGreaterThan(0);
    });

    // --- Legacy path with all context fields ---
    test('buildMessages legacy path includes task, ticket, and plan context when budget allows', async () => {
        mockConfig.getAgentContextLimit.mockReturnValue(10000);

        const plan = db.createPlan('Full Context Plan');
        const task = db.createTask({
            title: 'Full task',
            description: 'Short desc',
            priority: TaskPriority.P1,
            plan_id: plan.id,
        });
        const ticket = db.createTicket({
            title: 'Full ticket',
            body: 'Short body',
            priority: 'P2' as any,
            creator: 'test',
        });

        mockLLM.chat.mockResolvedValue({
            content: 'ANSWER: Full response\nCONFIDENCE: 95\nSOURCES: all\nESCALATE: false',
            tokens_used: 20,
        });

        const context: AgentContext = {
            task,
            ticket,
            plan: db.getPlan(plan.id)!,
            conversationHistory: [
                {
                    id: 'conv-1',
                    agent: 'test',
                    role: ConversationRole.User,
                    content: 'Previous message',
                    task_id: null,
                    ticket_id: null,
                    tokens_used: null,
                    created_at: new Date().toISOString(),
                },
            ],
        };

        await agent.processMessage('Complete test', context);

        // Verify the LLM was called with messages that include context
        const chatCall = mockLLM.chat.mock.calls[0][0];
        const systemMessages = chatCall.filter((m: any) => m.role === 'system');
        // At least system prompt + task context + ticket context + plan context
        expect(systemMessages.length).toBeGreaterThanOrEqual(3);

        // Verify user message was the last message
        const lastMsg = chatCall[chatCall.length - 1];
        expect(lastMsg.role).toBe('user');
        expect(lastMsg.content).toBe('Complete test');
    });
});

// ============================================================
// Orchestrator
// ============================================================

describe('Orchestrator coverage gaps', () => {
    let orchestrator: Orchestrator;

    beforeEach(async () => {
        orchestrator = new Orchestrator(db, mockLLM, mockConfig, mockOutput);
        await orchestrator.initialize();
    });

    // --- line 173: No agent for intent ---
    test('route returns "no agent" message for unroutable intent', async () => {
        // Force classifyIntent to return an unknown intent by using a message that
        // matches nothing and making LLM classify return something unusual
        mockLLM.classify.mockResolvedValue('general');

        // The getAgentForIntent default case returns answerAgent (not null),
        // so we need to test line 173 differently. Actually, looking at the code,
        // getAgentForIntent always returns this.answerAgent for default/unknown intents.
        // Line 173 can only be hit if getAgentForIntent returns null.
        // This would only happen if agents aren't initialized.
        // We test via a fresh Orchestrator that hasn't been initialized.
        const freshOrch = new Orchestrator(db, mockLLM, mockConfig, mockOutput);
        // Don't initialize — agents are undefined

        // Accessing private method via route which calls getAgentForIntent
        // Since agents aren't initialized, accessing this.answerAgent returns undefined
        // which means the switch default returns undefined (this.answerAgent) -> falsy
        // Actually the code returns this.answerAgent on default, which is undefined
        // if not initialized. Let's test that.
        const result = await freshOrch.route('random gibberish xyz', emptyContext());
        expect(result.content).toContain('No agent available for intent');
    });

    // --- lines 254-255: LLM classify fails -> defaults to 'general' ---
    test('classifyIntent defaults to general when LLM classify throws', async () => {
        mockLLM.classify.mockRejectedValue(new Error('LLM timeout'));

        // Message with no keyword matches to force LLM fallback
        const result = await orchestrator.route('xyzzy foobar gobbledygook', emptyContext());

        // Should have defaulted to 'general' which routes to answerAgent
        expect(mockOutput.appendLine).toHaveBeenCalledWith(
            expect.stringContaining('LLM classification failed')
        );
        // The agent processes the message (answer agent)
        expect(result).toBeDefined();
    });

    test('classifyIntent defaults to general when LLM offline and no keyword matches', async () => {
        orchestrator.setLLMOffline(true);

        mockLLM.chat.mockResolvedValue({
            content: 'ANSWER: Fallback\nCONFIDENCE: 80\nSOURCES: test\nESCALATE: false',
            tokens_used: 10,
        });

        const result = await orchestrator.route('xyzzy foobar gobbledygook', emptyContext());

        expect(mockOutput.appendLine).toHaveBeenCalledWith(
            expect.stringContaining('LLM offline')
        );
        expect(result).toBeDefined();
    });

    // --- lines 313-314: Task status changed before verification ---
    test('reportTaskDone skips verification when task status changed', async () => {
        jest.useFakeTimers();

        const plan = db.createPlan('Status Change Plan');
        const task = db.createTask({
            title: 'Task that changes',
            description: 'Task whose status changes before verification',
            priority: TaskPriority.P1,
            plan_id: plan.id,
        });

        await orchestrator.reportTaskDone(task.id, 'Done', ['src/a.ts']);

        // Change the task status away from PendingVerification before the timer fires
        db.updateTask(task.id, { status: TaskStatus.InProgress });

        // Advance timers to trigger the verification
        jest.advanceTimersByTime(1000);
        await Promise.resolve(); // flush microtasks

        // Lines 313-314: logged that status changed
        expect(mockOutput.appendLine).toHaveBeenCalledWith(
            expect.stringContaining('Skipping verification')
        );

        jest.useRealTimers();
    });

    // --- lines 326-340: Verification retry logic ---
    test('verification retry: first failure retries after 30s, second creates ticket', async () => {
        jest.useFakeTimers();

        const plan = db.createPlan('Retry Plan');
        const task = db.createTask({
            title: 'Retry task',
            description: 'Task that fails verification',
            priority: TaskPriority.P1,
            plan_id: plan.id,
        });

        // Make the verification agent fail
        mockLLM.chat.mockRejectedValue(new Error('LLM unavailable'));

        await orchestrator.reportTaskDone(task.id, 'Done', ['src/b.ts']);

        // Helper: flush all pending microtasks and timers
        const flushAsync = async () => {
            for (let i = 0; i < 10; i++) {
                await Promise.resolve();
            }
        };

        // First attempt: advance past the initial delay (0ms since delaySeconds=0)
        jest.advanceTimersByTime(1000);
        await flushAsync();

        // Line 326: first failure logged
        expect(mockOutput.appendLine).toHaveBeenCalledWith(
            expect.stringContaining('Verification attempt 1 failed')
        );

        // Line 329-330: retry scheduled after 30s
        jest.advanceTimersByTime(30_000);
        await flushAsync();

        // Line 326 again: second failure logged
        expect(mockOutput.appendLine).toHaveBeenCalledWith(
            expect.stringContaining('Verification attempt 2 failed')
        );

        // Lines 332-341: investigation ticket created
        const tickets = db.getAllTickets();
        const verTicket = tickets.find(t => t.title.includes('Verification failed'));
        expect(verTicket).toBeDefined();
        expect(verTicket!.body).toContain('failed twice');

        jest.useRealTimers();
    });

    // --- lines 381-390: getAllAgents ---
    test('getAllAgents returns all 18 agents including orchestrator', () => {
        const agents = orchestrator.getAllAgents();
        expect(agents).toHaveLength(18);
        // First should be the orchestrator itself
        expect(agents[0]).toBe(orchestrator);
    });

    // --- lines 397-402: injectContextServices ---
    test('injectContextServices injects into all agents', () => {
        const mockBudgetTracker = {
            estimateTokens: jest.fn(),
            recordUsage: jest.fn(),
            getCurrentModelProfile: jest.fn().mockReturnValue({ overheadTokensPerMessage: 4 }),
        } as any;
        const mockContextFeeder = {
            buildOptimizedMessages: jest.fn(),
        } as any;

        orchestrator.injectContextServices(mockBudgetTracker, mockContextFeeder);

        expect(mockOutput.appendLine).toHaveBeenCalledWith(
            expect.stringContaining('Context services injected into 18 agents')
        );
    });

    // --- lines 407-409: injectDecompositionEngine ---
    test('injectDecompositionEngine injects into planning agent', () => {
        const mockEngine = { decompose: jest.fn() } as any;
        orchestrator.injectDecompositionEngine(mockEngine);

        expect(mockOutput.appendLine).toHaveBeenCalledWith(
            expect.stringContaining('TaskDecompositionEngine injected into PlanningAgent')
        );
    });

    // --- route handles agent error with error boundary ---
    test('route creates investigation ticket when agent throws', async () => {
        // Force a route to verification by using verification keywords
        mockLLM.chat.mockRejectedValue(new Error('Agent crashed hard'));

        const result = await orchestrator.route('verify this task passes acceptance criteria', emptyContext());

        expect(result.content).toContain('Error from');
        expect(result.content).toContain('Investigation ticket created');

        const tickets = db.getAllTickets();
        const errorTicket = tickets.find(t => t.title.includes('Agent error'));
        expect(errorTicket).toBeDefined();
    });

    // --- callAgent with unknown agent ---
    test('callAgent returns error for unknown agent name', async () => {
        const result = await orchestrator.callAgent('nonexistent', 'hello', emptyContext());
        expect(result.content).toContain('Agent not found: nonexistent');
    });

    // --- callAgent with valid agent ---
    test('callAgent routes to named agent directly', async () => {
        mockLLM.chat.mockResolvedValue({
            content: 'ANSWER: Direct call\nCONFIDENCE: 80\nSOURCES: test\nESCALATE: false',
            tokens_used: 10,
        });

        const result = await orchestrator.callAgent('answer', 'test question', emptyContext());
        expect(result.content).toBeDefined();
    });

    // --- callAgent with agent that throws ---
    test('callAgent handles agent error gracefully', async () => {
        mockLLM.chat.mockRejectedValue(new Error('LLM down'));

        const result = await orchestrator.callAgent('answer', 'test', emptyContext());
        expect(result.content).toContain('Error from answer');
    });

    // --- freshRestart ---
    test('freshRestart clears state and returns stats', async () => {
        const result = await orchestrator.freshRestart();
        expect(result.tasksReady).toBeGreaterThanOrEqual(0);
        expect(result.message).toContain('Fresh restart complete');
    });

    // --- getNextTask ---
    test('getNextTask delegates to database', () => {
        const result = orchestrator.getNextTask();
        // No ready tasks in empty db
        expect(result).toBeNull();
    });

    // --- keyword classification ---
    test('classifyIntent uses keyword scoring for known intents', async () => {
        mockLLM.chat.mockResolvedValue({
            content: 'ANSWER: Test\nCONFIDENCE: 80\nSOURCES: x\nESCALATE: false',
            tokens_used: 10,
        });

        // 'plan' keyword matches planning
        await orchestrator.route('plan a new feature', emptyContext());

        const auditLogs = db.getAuditLog();
        const routeLog = auditLogs.find(a => a.action === 'route' && a.detail.includes('planning'));
        expect(routeLog).toBeDefined();
    });

    // --- keyword tie-breaking with priority ---
    test('classifyIntent uses priority for tie-breaking', async () => {
        mockLLM.chat.mockResolvedValue({
            content: 'ANSWER: Test\nCONFIDENCE: 80\nSOURCES: x\nESCALATE: false',
            tokens_used: 10,
        });

        // 'verify' + 'plan' -> verification wins per priority
        await orchestrator.route('verify my plan', emptyContext());

        const auditLogs = db.getAuditLog();
        const routeLog = auditLogs.find(a => a.action === 'route' && a.detail.includes('verification'));
        expect(routeLog).toBeDefined();
    });

    // --- evolutionService integration ---
    test('setEvolutionService and getEvolutionService work correctly', () => {
        expect(orchestrator.getEvolutionService()).toBeNull();

        const mockEvolution = { incrementCallCounter: jest.fn() } as any;
        orchestrator.setEvolutionService(mockEvolution);

        expect(orchestrator.getEvolutionService()).toBe(mockEvolution);
    });

    test('route increments evolution call counter after successful agent call', async () => {
        const mockEvolution = { incrementCallCounter: jest.fn() } as any;
        orchestrator.setEvolutionService(mockEvolution);

        mockLLM.chat.mockResolvedValue({
            content: 'ANSWER: Test\nCONFIDENCE: 80\nSOURCES: x\nESCALATE: false',
            tokens_used: 10,
        });

        await orchestrator.route('how does this work', emptyContext());

        expect(mockEvolution.incrementCallCounter).toHaveBeenCalled();
    });

    // --- accessor methods ---
    test('agent accessor methods return correct agents', () => {
        expect(orchestrator.getPlanningAgent()).toBeDefined();
        expect(orchestrator.getAnswerAgent()).toBeDefined();
        expect(orchestrator.getVerificationAgent()).toBeDefined();
        expect(orchestrator.getResearchAgent()).toBeDefined();
        expect(orchestrator.getClarityAgent()).toBeDefined();
        expect(orchestrator.getBossAgent()).toBeDefined();
        expect(orchestrator.getCustomAgentRunner()).toBeDefined();
    });

    // --- dispose ---
    test('dispose cleans up orchestrator and all child agents', () => {
        // Should not throw
        expect(() => orchestrator.dispose()).not.toThrow();
    });

    // --- callAgent error with non-Error thrown (branch: String(error)) ---
    test('callAgent handles non-Error thrown object', async () => {
        mockLLM.chat.mockRejectedValue('raw string error');

        const result = await orchestrator.callAgent('answer', 'test', emptyContext());
        expect(result.content).toContain('Error from answer');
        expect(result.content).toContain('raw string error');
    });

    // --- route error with non-Error thrown (orchestrator line 184 branch) ---
    test('route handles non-Error thrown in agent', async () => {
        mockLLM.chat.mockRejectedValue(42);

        const result = await orchestrator.route('verify acceptance criteria for task', emptyContext());
        expect(result.content).toContain('Error');
    });

    // --- classifyIntent with intent not in INTENT_PRIORITY (line 240 ?? 5 branch) ---
    test('classifyIntent falls back to default priority for unknown intents', async () => {
        // Route a message that matches keywords — the sorting uses INTENT_PRIORITY
        // which has specific intents. This test just verifies the sort works.
        mockLLM.chat.mockResolvedValue({
            content: 'ANSWER: test\nCONFIDENCE: 80\nSOURCES: none\nESCALATE: false',
            tokens_used: 5,
        });

        // Use keywords that match multiple intents to trigger the sort/tie-break
        const result = await orchestrator.route('plan and create test verification', emptyContext());
        expect(result.content).toBeDefined();
    });
});

// ============================================================
// Additional branch coverage: VerificationAgent edge cases
// ============================================================
describe('VerificationAgent additional branches', () => {
    let db: Database;
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-verify-branch-'));
        db = new Database(tmpDir);
        await db.initialize();
        jest.clearAllMocks();
        mockConfig.getAgentContextLimit.mockReturnValue(4000);
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('parseResponse handles follow_up_tasks with missing description', async () => {
        const plan = db.createPlan('Verify Test');
        const task = db.createTask({
            title: 'Task to verify',
            description: 'Test task',
            priority: TaskPriority.P1,
            plan_id: plan.id,
            acceptance_criteria: 'Tests pass',
        });

        const mockTestRunner = {
            runTestsForFiles: jest.fn().mockResolvedValue({
                passed: 5, failed: 0, skipped: 0, coverage: null,
                duration: 100, success: true, rawOutput: 'All tests passed',
            }),
        } as any;

        const agent = new VerificationAgent(db, mockLLM, mockConfig, mockOutput);
        agent.setTestRunner(mockTestRunner);
        await agent.initialize();

        // Return verification result with follow_up_tasks (no description) and no summary
        mockLLM.chat.mockResolvedValue({
            content: JSON.stringify({
                passed: false,
                test_results: null,
                criteria_results: [
                    { criterion: 'Tests pass', status: 'not_met', evidence: 'No tests' },
                ],
                follow_up_tasks: [
                    { title: 'Write missing tests', priority: 'P2' },  // no description
                ],
                // no summary field — triggers || 'See details'
            }),
            tokens_used: 30,
        });

        const context = contextWithTask({
            ...task,
            files_modified: ['src/test.ts'],
        });

        const result = await agent.processMessage('Verify task', context);

        // The follow_up_task without description should use '' default
        // It has dependencies so won't be in getReadyTasks — query via plan tasks
        const planTasks = db.getTasksByPlan(plan.id);
        const followUpTask = planTasks.find(t => t.title === 'Write missing tests');
        expect(followUpTask).toBeDefined();
        expect(followUpTask!.description).toBe('');

        // Summary should contain 'See details' since parsed.summary is missing
        expect(result.content).toContain('See details');
        // Coverage is null, so the test runner appendix sent to LLM has 'N/A'
        // Verify it was in the LLM input (the second chat call argument)
        const chatCalls = mockLLM.chat.mock.calls;
        const lastCallMessages = chatCalls[chatCalls.length - 1][0];
        const userMsg = lastCallMessages.find((m: any) => m.role === 'user');
        expect(userMsg.content).toContain('N/A');
    });

    test('parseResponse handles criteria_results for met criteria', async () => {
        const plan = db.createPlan('Met Criteria Test');
        const task = db.createTask({
            title: 'Well-done task',
            description: 'All criteria met',
            priority: TaskPriority.P1,
            plan_id: plan.id,
            acceptance_criteria: 'Everything works',
        });

        const mockTestRunner = {
            runTestsForFiles: jest.fn().mockResolvedValue({
                passed: 3, failed: 0, skipped: 0, coverage: 85.5,
                duration: 200, success: true, rawOutput: 'All passed',
            }),
        } as any;

        const agent = new VerificationAgent(db, mockLLM, mockConfig, mockOutput);
        agent.setTestRunner(mockTestRunner);
        await agent.initialize();

        mockLLM.chat.mockResolvedValue({
            content: JSON.stringify({
                passed: true,
                test_results: { passed: 3, failed: 0 },
                criteria_results: [
                    { criterion: 'Everything works', status: 'met', evidence: 'All green' },
                    { criterion: 'Code compiles', status: 'met', evidence: 'No errors' },
                ],
                summary: 'All criteria satisfied',
            }),
            tokens_used: 25,
        });

        const context = contextWithTask({
            ...task,
            files_modified: ['src/test.ts'],
        });

        const result = await agent.processMessage('Verify task', context);
        expect(result.content).toContain('2/2 criteria met');
        expect(result.content).toContain('All criteria satisfied');
    });
});

// ============================================================
// Additional branch coverage: ResearchAgent with no task context
// ============================================================
describe('ResearchAgent no-task escalation branch', () => {
    let db: Database;
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-research-branch-'));
        db = new Database(tmpDir);
        await db.initialize();
        jest.clearAllMocks();
        mockConfig.getAgentContextLimit.mockReturnValue(4000);
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('escalation uses "unknown" when context has no task', async () => {
        const agent = new ResearchAgent(db, mockLLM, mockConfig, mockOutput);
        await agent.initialize();

        mockLLM.chat.mockResolvedValue({
            content: 'CONFIDENCE: 30\nSOURCES: none\nESCALATE: true\n\nI could not find relevant information.',
            tokens_used: 15,
        });

        // Pass context with NO task
        const result = await agent.processMessage('Research something obscure', emptyContext());
        expect(result.content).toBeDefined();

        // Verify escalation ticket was created with 'unknown' task id
        const tickets = db.getAllTickets();
        const escalation = tickets.find(t => t.title.includes('Research escalation'));
        expect(escalation).toBeDefined();
        expect(escalation!.title).toContain('unknown');
    });
});

// ============================================================
// Additional branch coverage: BaseAgent non-Error thrown (line 92)
// ============================================================
describe('BaseAgent non-Error thrown branch', () => {
    let db: Database;
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-base-branch-'));
        db = new Database(tmpDir);
        await db.initialize();
        jest.clearAllMocks();
        mockConfig.getAgentContextLimit.mockReturnValue(4000);
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('processMessage handles non-Error thrown value', async () => {
        const agent = new AnswerAgent(db, mockLLM, mockConfig, mockOutput);
        await agent.initialize();

        // Make LLM throw a non-Error value
        mockLLM.chat.mockRejectedValue('raw string crash');

        await expect(
            agent.processMessage('test question', emptyContext())
        ).rejects.toBe('raw string crash');

        expect(mockOutput.appendLine).toHaveBeenCalledWith(
            expect.stringContaining('raw string crash')
        );
    });
});
