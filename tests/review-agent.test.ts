import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../src/core/database';
import { ReviewAgent } from '../src/agents/review-agent';
import { AgentType, AgentContext, TicketStatus, TicketPriority, Ticket } from '../src/types';

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
    getModelMaxOutputTokens: jest.fn().mockReturnValue(4096),
    getModelContextWindow: jest.fn().mockReturnValue(32768),
    getConfig: jest.fn().mockReturnValue({ verification: { delaySeconds: 0 } }),
} as any;

const mockOutput = { appendLine: jest.fn() } as any;

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
    return {
        id: 'ticket-1',
        ticket_number: 1,
        title: 'Test ticket',
        body: 'Test body',
        status: TicketStatus.Open,
        priority: TicketPriority.P2,
        creator: 'developer',
        assignee: null,
        task_id: null,
        parent_ticket_id: null,
        auto_created: false,
        operation_type: 'user_created',
        acceptance_criteria: null,
        blocking_ticket_id: null,
        is_ghost: false,
        processing_agent: null,
        processing_status: null,
        deliverable_type: null,
        verification_result: null,
        source_page_ids: null,
        source_component_ids: null,
        retry_count: 0,
        max_retries: 3,
        stage: 1,
        last_error: null,
        last_error_at: null,
        assigned_queue: null,
        cancellation_reason: null,
        ticket_category: null,
        ticket_stage: null,
        related_ticket_ids: null,
        agent_notes: null,
        tree_route_path: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...overrides,
    };
}

beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-review-agent-'));
    db = new Database(tmpDir);
    await db.initialize();
    jest.clearAllMocks();
});

afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================
// ReviewAgent
// ============================================================

describe('ReviewAgent', () => {
    let agent: ReviewAgent;

    beforeEach(async () => {
        agent = new ReviewAgent(db, mockLLM, mockConfig, mockOutput);
        await agent.initialize();
    });

    test('has correct name and type', () => {
        expect(agent.name).toBe('Review Agent');
        expect(agent.type).toBe(AgentType.Review);
    });

    // --- Complexity classification ---

    describe('classifyComplexity', () => {
        test('returns complex for code_generation deliverable type', () => {
            const ticket = makeTicket({ title: 'Simple page', deliverable_type: 'code_generation' as any });
            expect(agent.classifyComplexity(ticket)).toBe('complex');
        });

        test('returns complex for title containing "implement"', () => {
            const ticket = makeTicket({ title: 'Implement user authentication' });
            expect(agent.classifyComplexity(ticket)).toBe('complex');
        });

        test('returns complex for title containing "build"', () => {
            const ticket = makeTicket({ title: 'Build the dashboard module' });
            expect(agent.classifyComplexity(ticket)).toBe('complex');
        });

        test('returns complex for title containing "architect"', () => {
            const ticket = makeTicket({ title: 'Architect the data layer' });
            expect(agent.classifyComplexity(ticket)).toBe('complex');
        });

        test('returns complex for title containing "security"', () => {
            const ticket = makeTicket({ title: 'Security audit for API' });
            expect(agent.classifyComplexity(ticket)).toBe('complex');
        });

        test('returns complex for title containing "migration"', () => {
            const ticket = makeTicket({ title: 'Database migration for v2' });
            expect(agent.classifyComplexity(ticket)).toBe('complex');
        });

        test('returns simple for communication deliverable type', () => {
            const ticket = makeTicket({ title: 'Notify team', deliverable_type: 'communication' as any });
            expect(agent.classifyComplexity(ticket)).toBe('simple');
        });

        test('returns simple for page_creation operation type', () => {
            const ticket = makeTicket({ title: 'New page', operation_type: 'page_creation' });
            expect(agent.classifyComplexity(ticket)).toBe('simple');
        });

        test('returns simple for scaffold operation type', () => {
            const ticket = makeTicket({ title: 'Setup scaffold', operation_type: 'scaffold' });
            expect(agent.classifyComplexity(ticket)).toBe('simple');
        });

        test('returns simple for title containing "create page"', () => {
            const ticket = makeTicket({ title: 'Create page for settings' });
            expect(agent.classifyComplexity(ticket)).toBe('simple');
        });

        test('returns simple for title containing "fix typo"', () => {
            const ticket = makeTicket({ title: 'Fix typo in header' });
            expect(agent.classifyComplexity(ticket)).toBe('simple');
        });

        test('returns simple for title containing "rename"', () => {
            const ticket = makeTicket({ title: 'Rename variable foo to bar' });
            expect(agent.classifyComplexity(ticket)).toBe('simple');
        });

        test('returns moderate for unmatched tickets', () => {
            const ticket = makeTicket({ title: 'Update the color scheme' });
            expect(agent.classifyComplexity(ticket)).toBe('moderate');
        });

        test('complex patterns take priority over simple patterns', () => {
            // "implement" is complex, even if "scaffold" is in operation_type
            const ticket = makeTicket({ title: 'Implement scaffolding engine', operation_type: 'scaffold' });
            expect(agent.classifyComplexity(ticket)).toBe('complex');
        });

        test('code_generation takes priority over simple title patterns', () => {
            const ticket = makeTicket({ title: 'Fix typo', deliverable_type: 'code_generation' as any });
            expect(agent.classifyComplexity(ticket)).toBe('complex');
        });
    });

    // --- Auto-approval logic ---

    describe('shouldAutoApprove', () => {
        test('never approves complex tickets', () => {
            expect(agent.shouldAutoApprove('complex', 100)).toBe(false);
            expect(agent.shouldAutoApprove('complex', 50)).toBe(false);
            expect(agent.shouldAutoApprove('complex', 0)).toBe(false);
        });

        test('approves simple tickets with score >= 70', () => {
            expect(agent.shouldAutoApprove('simple', 70)).toBe(true);
            expect(agent.shouldAutoApprove('simple', 85)).toBe(true);
            expect(agent.shouldAutoApprove('simple', 100)).toBe(true);
        });

        test('rejects simple tickets with score < 70', () => {
            expect(agent.shouldAutoApprove('simple', 69)).toBe(false);
            expect(agent.shouldAutoApprove('simple', 0)).toBe(false);
        });

        test('approves moderate tickets with score >= 85', () => {
            expect(agent.shouldAutoApprove('moderate', 85)).toBe(true);
            expect(agent.shouldAutoApprove('moderate', 100)).toBe(true);
        });

        test('rejects moderate tickets with score < 85', () => {
            expect(agent.shouldAutoApprove('moderate', 84)).toBe(false);
            expect(agent.shouldAutoApprove('moderate', 70)).toBe(false);
        });
    });

    // --- parseResponse ---

    describe('parseResponse', () => {
        const context: AgentContext = { conversationHistory: [] };

        test('parses valid auto-approved JSON response', async () => {
            const json = JSON.stringify({
                complexity: 'simple',
                scores: { clarity: 80, completeness: 75, correctness: 90 },
                average_score: 82,
                auto_approved: true,
                reason: 'Good quality deliverable',
                issues: [],
                suggestions: ['Minor formatting improvements'],
            });

            const result = await (agent as any).parseResponse(json, context);
            expect(result.content).toContain('Auto-approved');
            expect(result.content).toContain('simple');
            expect(result.content).toContain('82/100');
            expect(result.confidence).toBe(82);
            expect(result.actions).toHaveLength(0);
        });

        test('parses valid flagged-for-review JSON response', async () => {
            const json = JSON.stringify({
                complexity: 'complex',
                scores: { clarity: 60, completeness: 50, correctness: 70 },
                average_score: 60,
                auto_approved: false,
                reason: 'Complex ticket requires user review',
                issues: ['Missing acceptance criteria coverage'],
                suggestions: ['Add more detail'],
            });

            const result = await (agent as any).parseResponse(json, context);
            expect(result.content).toContain('Flagged for user review');
            expect(result.content).toContain('complex');
            expect(result.content).toContain('60/100');
            expect(result.confidence).toBe(60);
            expect(result.actions).toHaveLength(1);
            expect(result.actions[0].type).toBe('escalate');
            expect(result.actions[0].payload.reason).toBe('Complex ticket requires user review');
            expect(result.actions[0].payload.issues).toEqual(['Missing acceptance criteria coverage']);
        });

        test('handles JSON embedded in surrounding text', async () => {
            const content = 'Here is my review:\n' + JSON.stringify({
                complexity: 'moderate',
                scores: { clarity: 90, completeness: 88, correctness: 92 },
                average_score: 90,
                auto_approved: true,
                reason: 'Meets all criteria',
                issues: [],
                suggestions: [],
            }) + '\nEnd of review.';

            const result = await (agent as any).parseResponse(content, context);
            expect(result.content).toContain('Auto-approved');
            expect(result.confidence).toBe(90);
        });

        test('returns raw content on invalid JSON', async () => {
            const content = 'This is not JSON at all';
            const result = await (agent as any).parseResponse(content, context);
            expect(result.content).toBe(content);
            expect(result.actions).toHaveLength(0);
        });

        test('handles missing optional fields with defaults', async () => {
            const json = JSON.stringify({
                complexity: 'simple',
                scores: { clarity: 80, completeness: 75, correctness: 85 },
                average_score: 80,
                auto_approved: true,
            });

            const result = await (agent as any).parseResponse(json, context);
            expect(result.content).toContain('Auto-approved');
            expect(result.content).toContain('Meets quality threshold');
        });

        test('handles null/undefined average_score and auto_approved', async () => {
            const json = '{ "complexity": "unknown" }';
            const result = await (agent as any).parseResponse(json, context);
            expect(result.content).toContain('Flagged for user review');
            expect(result.confidence).toBe(0);
            expect(result.actions).toHaveLength(1);
            expect(result.actions[0].type).toBe('escalate');
        });
    });
});
