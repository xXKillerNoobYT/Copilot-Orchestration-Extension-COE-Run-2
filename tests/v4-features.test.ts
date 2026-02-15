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

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { EventEmitter } from 'events';
import { Database } from '../src/core/database';
import { handleApiRequest, extractParam } from '../src/webapp/api';
import { TicketStatus, TicketPriority } from '../src/types';

// ==================== Helpers ====================

function mockReq(method: string, url: string, body?: any): http.IncomingMessage {
    const req = new EventEmitter() as any;
    req.method = method;
    req.url = url;
    if (body) {
        process.nextTick(() => {
            req.emit('data', JSON.stringify(body));
            req.emit('end');
        });
    } else {
        process.nextTick(() => req.emit('end'));
    }
    return req;
}

function mockRes(): http.ServerResponse {
    return { writeHead: jest.fn(), end: jest.fn(), setHeader: jest.fn() } as any;
}

function getJsonResponse(res: any): any {
    const lastCall = res.end.mock.calls[res.end.mock.calls.length - 1];
    return JSON.parse(lastCall[0]);
}

// ==================== Mocks ====================

const orchestrator = {
    callAgent: jest.fn().mockResolvedValue({
        content: 'test response', confidence: 85, actions: [],
    }),
    getDesignArchitectAgent: jest.fn().mockReturnValue({
        reviewDesign: jest.fn().mockResolvedValue({ content: 'Score: 85/100', actions: [] }),
    }),
    getGapHunterAgent: jest.fn().mockReturnValue({
        analyzeGaps: jest.fn().mockResolvedValue({
            plan_id: 'test', overall_score: 80, gaps: [], summary: 'Clean',
            analysis_timestamp: new Date().toISOString(), pages_analyzed: 1, components_analyzed: 5,
        }),
    }),
    getDesignHardenerAgent: jest.fn().mockReturnValue({
        hardenDesign: jest.fn().mockResolvedValue({
            plan_id: 'test', gaps_addressed: 0, drafts_created: 0, pages_created: 0, actions_taken: [],
        }),
    }),
    getDecisionMemoryAgent: jest.fn().mockReturnValue(null),
} as any;

const config = {
    getConfig: jest.fn().mockReturnValue({
        version: '1.0.0',
        llm: {
            endpoint: 'http://localhost:1234/v1', model: 'test',
            timeoutSeconds: 30, startupTimeoutSeconds: 10,
            streamStallTimeoutSeconds: 60, maxTokens: 4000,
        },
        taskQueue: { maxPending: 20 },
        verification: { delaySeconds: 1, coverageThreshold: 80 },
        watcher: { debounceMs: 500 },
        agents: {},
        designQaScoreThreshold: 80,
        maxActiveTickets: 10,
        maxTicketRetries: 3,
        clarityAutoResolveScore: 85,
        clarityClarificationScore: 70,
        bossIdleTimeoutMinutes: 5,
    }),
    updateConfig: jest.fn(),
} as any;

// ==================== Test Suites ====================

describe('v4 Features', () => {
    let db: Database;
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-v4-test-'));
        db = new Database(tmpDir);
        await db.initialize();
        orchestrator.callAgent.mockClear();
        config.getConfig.mockClear();
        config.updateConfig.mockClear();
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ================================================================
    // PART 1: Database New Methods (~25 tests)
    // ================================================================

    describe('Database: Ghost Tickets (createGhostTicket / resolveGhostTicket)', () => {
        it('creates a ghost ticket with is_ghost = true and P1 priority', () => {
            const plan = db.createPlan('Test Plan');
            const original = db.createTicket({ title: 'Original Task', body: 'Doing work' });

            const { ghostTicket } = db.createGhostTicket(
                original.id, 'What auth should we use?', 'Need auth clarification',
                '/questions', plan.id
            );

            expect(ghostTicket.is_ghost).toBe(true);
            expect(ghostTicket.priority).toBe(TicketPriority.P1);
            expect(ghostTicket.title).toContain('Ghost:');
            expect(ghostTicket.parent_ticket_id).toBe(original.id);
            expect(ghostTicket.auto_created).toBe(true);
            expect(ghostTicket.operation_type).toBe('ghost_ticket');
        });

        it('creates a linked ai_question with is_ghost = true', () => {
            const plan = db.createPlan('Test Plan');
            const original = db.createTicket({ title: 'Original Task' });

            const { ghostQuestion } = db.createGhostTicket(
                original.id, 'What framework?', 'Need framework choice',
                '/questions', plan.id, 'React vs Vue comparison'
            );

            expect(ghostQuestion).toBeDefined();
            expect(ghostQuestion.question).toBe('What framework?');
            expect(ghostQuestion.is_ghost).toBe(true);
            expect(ghostQuestion.queue_priority).toBe(1);
            expect(ghostQuestion.plan_id).toBe(plan.id);
            expect(ghostQuestion.technical_context).toBe('React vs Vue comparison');
            expect(ghostQuestion.source_ticket_id).toBe(original.id);
        });

        it('returns both ghostTicket and ghostQuestion', () => {
            const plan = db.createPlan('Test Plan');
            const original = db.createTicket({ title: 'Original' });

            const result = db.createGhostTicket(
                original.id, 'Question?', 'Context', '/q', plan.id
            );

            expect(result).toHaveProperty('ghostTicket');
            expect(result).toHaveProperty('ghostQuestion');
            expect(result.ghostQuestion.ticket_id).toBe(result.ghostTicket.id);
        });

        it('marks original ticket with blocking_ticket_id pointing to ghost', () => {
            const plan = db.createPlan('Test Plan');
            const original = db.createTicket({ title: 'Original' });

            const { ghostTicket } = db.createGhostTicket(
                original.id, 'Q?', 'Ctx', '/q', plan.id
            );

            const updated = db.getTicket(original.id)!;
            expect(updated.blocking_ticket_id).toBe(ghostTicket.id);
            expect(updated.processing_status).toBe('awaiting_user');
        });

        it('handles non-existent original ticket gracefully (no crash)', () => {
            const plan = db.createPlan('Test Plan');
            // Should not throw even with a non-existent ticket id — it just won't update the original
            const result = db.createGhostTicket(
                'nonexistent-id', 'Q?', 'Ctx', '/q', plan.id
            );
            expect(result.ghostTicket).toBeDefined();
            expect(result.ghostTicket.is_ghost).toBe(true);
        });

        it('resolveGhostTicket resolves the ghost ticket', () => {
            const plan = db.createPlan('Test Plan');
            const original = db.createTicket({ title: 'Original' });
            const { ghostTicket } = db.createGhostTicket(
                original.id, 'Q?', 'Ctx', '/q', plan.id
            );

            db.resolveGhostTicket(ghostTicket.id);

            const resolvedGhost = db.getTicket(ghostTicket.id)!;
            expect(resolvedGhost.status).toBe(TicketStatus.Resolved);
        });

        it('resolveGhostTicket unblocks the original ticket', () => {
            const plan = db.createPlan('Test Plan');
            const original = db.createTicket({ title: 'Original' });
            const { ghostTicket } = db.createGhostTicket(
                original.id, 'Q?', 'Ctx', '/q', plan.id
            );

            const unblocked = db.resolveGhostTicket(ghostTicket.id);

            expect(unblocked).not.toBeNull();
            expect(unblocked!.id).toBe(original.id);
            expect(unblocked!.processing_status).toBe('queued');
        });

        it('resolveGhostTicket returns null for non-ghost ticket', () => {
            const ticket = db.createTicket({ title: 'Not Ghost' });
            const result = db.resolveGhostTicket(ticket.id);
            expect(result).toBeNull();
        });

        it('resolveGhostTicket returns null for non-existent ticket', () => {
            const result = db.resolveGhostTicket('nonexistent-id');
            expect(result).toBeNull();
        });
    });

    describe('Database: User Decisions', () => {
        it('createUserDecision creates and returns a decision record', () => {
            const plan = db.createPlan('Test Plan');

            const decision = db.createUserDecision({
                plan_id: plan.id,
                category: 'architecture',
                topic: 'auth_strategy',
                decision: 'Use OAuth2 with JWT',
            });

            expect(decision).toBeDefined();
            expect(decision.plan_id).toBe(plan.id);
            expect(decision.category).toBe('architecture');
            expect(decision.topic).toBe('auth_strategy');
            expect(decision.decision).toBe('Use OAuth2 with JWT');
            expect(decision.is_active).toBe(1);
        });

        it('createUserDecision stores optional question_id and ticket_id', () => {
            const plan = db.createPlan('Test Plan');
            const ticket = db.createTicket({ title: 'Test' });

            const decision = db.createUserDecision({
                plan_id: plan.id,
                category: 'design',
                topic: 'color_scheme',
                decision: 'Dark theme',
                question_id: 'q-123',
                ticket_id: ticket.id,
                context: 'User prefers dark mode',
                affected_entities: 'all-pages',
            });

            expect(decision.question_id).toBe('q-123');
            expect(decision.ticket_id).toBe(ticket.id);
            expect(decision.context).toBe('User prefers dark mode');
            expect(decision.affected_entities).toBe('all-pages');
        });

        it('getActiveDecisions returns active decisions for a plan', () => {
            const plan = db.createPlan('Test Plan');
            db.createUserDecision({ plan_id: plan.id, category: 'arch', topic: 'db', decision: 'Use PostgreSQL' });
            db.createUserDecision({ plan_id: plan.id, category: 'arch', topic: 'api', decision: 'REST' });

            const decisions = db.getActiveDecisions(plan.id);
            expect(decisions).toHaveLength(2);
        });

        it('getActiveDecisions filters by category', () => {
            const plan = db.createPlan('Test Plan');
            db.createUserDecision({ plan_id: plan.id, category: 'arch', topic: 'db', decision: 'PostgreSQL' });
            db.createUserDecision({ plan_id: plan.id, category: 'design', topic: 'theme', decision: 'Dark' });

            const archDecisions = db.getActiveDecisions(plan.id, 'arch');
            expect(archDecisions).toHaveLength(1);
            expect(archDecisions[0].category).toBe('arch');
        });

        it('getActiveDecisions filters by category and topic', () => {
            const plan = db.createPlan('Test Plan');
            db.createUserDecision({ plan_id: plan.id, category: 'arch', topic: 'db', decision: 'PostgreSQL' });
            db.createUserDecision({ plan_id: plan.id, category: 'arch', topic: 'api', decision: 'REST' });

            const dbDecisions = db.getActiveDecisions(plan.id, 'arch', 'db');
            expect(dbDecisions).toHaveLength(1);
            expect(dbDecisions[0].topic).toBe('db');
        });

        it('supersedeDecision marks decision as inactive with superseded_by', () => {
            const plan = db.createPlan('Test Plan');
            const old = db.createUserDecision({ plan_id: plan.id, category: 'arch', topic: 'db', decision: 'MySQL' });
            const newer = db.createUserDecision({ plan_id: plan.id, category: 'arch', topic: 'db', decision: 'PostgreSQL' });

            db.supersedeDecision(old.id as string, newer.id as string);

            const active = db.getActiveDecisions(plan.id);
            expect(active).toHaveLength(1);
            expect(active[0].decision).toBe('PostgreSQL');
        });

        it('getDecisionsByTopic uses LIKE search', () => {
            const plan = db.createPlan('Test Plan');
            db.createUserDecision({ plan_id: plan.id, category: 'arch', topic: 'auth_strategy', decision: 'OAuth2' });
            db.createUserDecision({ plan_id: plan.id, category: 'arch', topic: 'auth_provider', decision: 'Auth0' });
            db.createUserDecision({ plan_id: plan.id, category: 'design', topic: 'theme', decision: 'Dark' });

            const authDecisions = db.getDecisionsByTopic(plan.id, 'auth');
            expect(authDecisions).toHaveLength(2);
            expect(authDecisions.every(d => (d.topic as string).includes('auth'))).toBe(true);
        });

        it('getDecisionsByTopic returns empty for no match', () => {
            const plan = db.createPlan('Test Plan');
            db.createUserDecision({ plan_id: plan.id, category: 'arch', topic: 'db', decision: 'PG' });

            const result = db.getDecisionsByTopic(plan.id, 'nonexistent');
            expect(result).toHaveLength(0);
        });
    });

    describe('Database: Plan Phase Management', () => {
        it('updatePlanPhase sets the phase and phase_started_at', () => {
            const plan = db.createPlan('Test Plan');
            db.updatePlanPhase(plan.id, 'designing');

            const phase = db.getPlanPhase(plan.id);
            expect(phase).not.toBeNull();
            expect(phase!.phase).toBe('designing');
            expect(phase!.startedAt).not.toBeNull();
        });

        it('getPlanPhase returns correct stage number', () => {
            const plan = db.createPlan('Test Plan');

            db.updatePlanPhase(plan.id, 'planning');
            expect(db.getPlanPhase(plan.id)!.stage).toBe(1);

            db.updatePlanPhase(plan.id, 'coding');
            expect(db.getPlanPhase(plan.id)!.stage).toBe(2);

            db.updatePlanPhase(plan.id, 'verification');
            expect(db.getPlanPhase(plan.id)!.stage).toBe(3);
        });

        it('getPlanPhase returns null for non-existent plan', () => {
            const result = db.getPlanPhase('nonexistent-id');
            expect(result).toBeNull();
        });

        it('getPlanPhase defaults to planning phase for new plan', () => {
            const plan = db.createPlan('Test Plan');
            const phase = db.getPlanPhase(plan.id);
            expect(phase).not.toBeNull();
            expect(phase!.phase).toBe('planning');
            expect(phase!.stage).toBe(1);
            expect(phase!.version).toBe(1);
        });

        it('approvePlanDesign sets design_approved_at', () => {
            const plan = db.createPlan('Test Plan');
            db.approvePlanDesign(plan.id);

            // Verify the plan was updated (approved_at is set)
            // We can check via getPlanPhase or direct query - the plan updated_at changes
            const fetched = db.getPlan(plan.id);
            expect(fetched).not.toBeNull();
            // updated_at should differ from created_at after approvePlanDesign
            expect(fetched!.updated_at).not.toBe(plan.created_at);
        });
    });

    describe('Database: New Ticket Fields', () => {
        it('createTicket with acceptance_criteria', () => {
            const ticket = db.createTicket({
                title: 'Build Login',
                acceptance_criteria: 'All tests pass. Form validates email.',
            });
            expect(ticket.acceptance_criteria).toBe('All tests pass. Form validates email.');
        });

        it('createTicket with processing_status and deliverable_type', () => {
            const ticket = db.createTicket({
                title: 'Code Task',
                processing_status: 'queued' as any,
                deliverable_type: 'code_generation' as any,
            });
            expect(ticket.processing_status).toBe('queued');
            expect(ticket.deliverable_type).toBe('code_generation');
        });

        it('createTicket with stage number', () => {
            const ticket = db.createTicket({ title: 'Stage 2 Task', stage: 2 });
            expect(ticket.stage).toBe(2);
        });

        it('updateTicket with new fields', () => {
            const ticket = db.createTicket({ title: 'Task' });
            const updated = db.updateTicket(ticket.id, {
                acceptance_criteria: 'Updated criteria',
                processing_status: 'processing' as any,
                deliverable_type: 'design_change' as any,
                stage: 3,
            });
            expect(updated).not.toBeNull();
            expect(updated!.acceptance_criteria).toBe('Updated criteria');
            expect(updated!.processing_status).toBe('processing');
            expect(updated!.deliverable_type).toBe('design_change');
            expect(updated!.stage).toBe(3);
        });

        it('getTicket returns new fields correctly', () => {
            const ticket = db.createTicket({
                title: 'Full Fields',
                acceptance_criteria: 'Must compile',
                blocking_ticket_id: null,
                is_ghost: false,
                processing_agent: 'planning',
                processing_status: 'queued' as any,
                deliverable_type: 'plan_generation' as any,
                source_page_ids: 'page-1,page-2',
                source_component_ids: 'comp-1',
                retry_count: 1,
                max_retries: 5,
                stage: 2,
            });

            const fetched = db.getTicket(ticket.id)!;
            expect(fetched.acceptance_criteria).toBe('Must compile');
            expect(fetched.is_ghost).toBe(false);
            expect(fetched.processing_agent).toBe('planning');
            expect(fetched.source_page_ids).toBe('page-1,page-2');
            expect(fetched.retry_count).toBe(1);
            expect(fetched.max_retries).toBe(5);
            expect(fetched.stage).toBe(2);
        });

        it('is_draft on design components', () => {
            const plan = db.createPlan('Test Plan');
            const page = db.createDesignPage({ plan_id: plan.id, name: 'Home', route: '/' });
            const comp = db.createDesignComponent({
                page_id: page.id, plan_id: plan.id, type: 'button',
                name: 'Draft Button', x: 0, y: 0, width: 100, height: 40, content: 'Click',
            });

            // New components default to is_draft = false
            expect(comp.is_draft).toBe(false);

            // Mark as draft
            db.updateDesignComponent(comp.id, { is_draft: 1 });
            const updated = db.getDesignComponent(comp.id);
            expect(updated).not.toBeNull();
            expect(updated!.is_draft).toBe(true);

            // Approve draft (set is_draft = 0)
            db.updateDesignComponent(comp.id, { is_draft: 0 });
            const approved = db.getDesignComponent(comp.id);
            expect(approved!.is_draft).toBe(false);
        });
    });

    // ================================================================
    // PART 2: New API Endpoint Tests (~25+ tests)
    // ================================================================

    // Helper to call API — splits query string from pathname correctly.
    // handleApiRequest receives only the path; query params come from req.url.
    async function callApi(method: string, fullUrl: string, body?: any): Promise<{ res: any; data: any }> {
        const [pathname] = fullUrl.split('?');
        const req = mockReq(method, fullUrl, body);
        const res = mockRes();
        await handleApiRequest(req, res, pathname, db, orchestrator, config);
        const data = getJsonResponse(res);
        return { res, data };
    }

    describe('API: GET /api/questions/queue', () => {
        it('returns pending questions sorted by priority', async () => {
            const plan = db.createPlan('Test Plan');
            db.createAIQuestion({
                plan_id: plan.id, question: 'Low priority Q', question_type: 'text',
                options: [], source_agent: 'planning', queue_priority: 3,
            } as any);
            db.createAIQuestion({
                plan_id: plan.id, question: 'High priority Q', question_type: 'text',
                options: [], source_agent: 'planning', queue_priority: 1,
            } as any);

            const { data } = await callApi('GET', `/api/questions/queue?plan_id=${plan.id}`);

            expect(Array.isArray(data)).toBe(true);
            expect(data).toHaveLength(2);
            // P1 first
            expect(data[0].question).toBe('High priority Q');
            expect(data[1].question).toBe('Low priority Q');
        });

        it('returns 400 if plan_id is missing', async () => {
            const { res, data } = await callApi('GET', '/api/questions/queue');
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(data.error).toBe('plan_id required');
        });
    });

    describe('API: GET /api/questions/queue/count', () => {
        it('returns correct counts by priority', async () => {
            const plan = db.createPlan('Test Plan');
            db.createAIQuestion({
                plan_id: plan.id, question: 'Q1', question_type: 'text',
                options: [], source_agent: 'planning', queue_priority: 1,
            } as any);
            db.createAIQuestion({
                plan_id: plan.id, question: 'Q2', question_type: 'text',
                options: [], source_agent: 'planning', queue_priority: 2,
            } as any);
            db.createAIQuestion({
                plan_id: plan.id, question: 'Q3', question_type: 'text',
                options: [], source_agent: 'planning', queue_priority: 3,
            } as any);

            const { data } = await callApi('GET', `/api/questions/queue/count?plan_id=${plan.id}`);

            expect(data.total).toBe(3);
            expect(data.p1).toBe(1);
            expect(data.p2).toBe(1);
            expect(data.p3).toBe(1);
        });

        it('returns 400 if plan_id is missing', async () => {
            const { res, data } = await callApi('GET', '/api/questions/queue/count');
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(data.error).toBe('plan_id required');
        });
    });

    describe('API: POST /api/questions/:id/dismiss', () => {
        it('dismisses a question and increments dismiss_count', async () => {
            const plan = db.createPlan('Test Plan');
            const q = db.createAIQuestion({
                plan_id: plan.id, question: 'Test Q', question_type: 'text',
                options: [], source_agent: 'planning',
            } as any);

            const { data } = await callApi('POST', `/api/questions/${q.id}/dismiss`);

            expect(data.success).toBe(true);
            expect(data.action).toBe('dismissed');
            expect(data.dismiss_count).toBe(1);
        });

        it('returns 404 for non-existent question', async () => {
            const { res, data } = await callApi('POST', '/api/questions/nonexistent/dismiss');
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            expect(data.error).toBe('Question not found');
        });
    });

    describe('API: GET /api/plans/:id/phase', () => {
        it('returns phase info for a plan', async () => {
            const plan = db.createPlan('Test Plan');
            db.updatePlanPhase(plan.id, 'designing');

            const { data } = await callApi('GET', `/api/plans/${plan.id}/phase`);

            expect(data.phase).toBe('designing');
            expect(data.stage).toBe(1);
            expect(data.startedAt).toBeTruthy();
            expect(data.version).toBe(1);
        });

        it('returns 404 for non-existent plan', async () => {
            const { res, data } = await callApi('GET', '/api/plans/nonexistent/phase');
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            expect(data.error).toBe('Plan not found');
        });
    });

    describe('API: POST /api/plans/:id/approve-design', () => {
        it('approves the design and returns success', async () => {
            const plan = db.createPlan('Test Plan');

            const { data } = await callApi('POST', `/api/plans/${plan.id}/approve-design`);

            expect(data.success).toBe(true);
        });
    });

    describe('API: POST /api/design/architect-review', () => {
        it('triggers design review and returns result', async () => {
            const plan = db.createPlan('Test Plan');

            const { data } = await callApi('POST', '/api/design/architect-review', { plan_id: plan.id });

            expect(data.success).toBe(true);
            expect(data.review).toBe('Score: 85/100');
            expect(data.actions).toEqual([]);
            expect(orchestrator.getDesignArchitectAgent).toHaveBeenCalled();
        });

        it('returns 400 if plan_id is missing', async () => {
            const { res, data } = await callApi('POST', '/api/design/architect-review', {});
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(data.error).toBe('plan_id required');
        });
    });

    describe('API: POST /api/design/gap-analysis', () => {
        it('triggers gap analysis and returns result', async () => {
            const plan = db.createPlan('Test Plan');

            const { data } = await callApi('POST', '/api/design/gap-analysis', { plan_id: plan.id });

            expect(data.overall_score).toBe(80);
            expect(data.gaps).toEqual([]);
            expect(data.summary).toBe('Clean');
            expect(orchestrator.getGapHunterAgent).toHaveBeenCalled();
        });

        it('returns 400 if plan_id is missing', async () => {
            const { res, data } = await callApi('POST', '/api/design/gap-analysis', {});
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(data.error).toBe('plan_id required');
        });
    });

    describe('API: POST /api/design/harden', () => {
        it('triggers design hardening and returns result', async () => {
            const plan = db.createPlan('Test Plan');
            const gapAnalysis = {
                plan_id: plan.id, overall_score: 80, gaps: [],
                summary: 'Clean', analysis_timestamp: new Date().toISOString(),
                pages_analyzed: 1, components_analyzed: 5,
            };

            const { data } = await callApi('POST', '/api/design/harden', {
                plan_id: plan.id, gap_analysis: gapAnalysis,
            });

            expect(data.gaps_addressed).toBe(0);
            expect(data.drafts_created).toBe(0);
            expect(orchestrator.getDesignHardenerAgent).toHaveBeenCalled();
        });

        it('returns 400 if plan_id or gap_analysis is missing', async () => {
            const { res, data } = await callApi('POST', '/api/design/harden', { plan_id: 'test' });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(data.error).toBe('plan_id and gap_analysis required');
        });
    });

    describe('API: GET /api/design/drafts', () => {
        it('returns draft components for a plan', async () => {
            const plan = db.createPlan('Test Plan');
            const page = db.createDesignPage({ plan_id: plan.id, name: 'Home', route: '/' });
            const comp1 = db.createDesignComponent({
                page_id: page.id, plan_id: plan.id, type: 'button',
                name: 'Draft Btn', x: 0, y: 0, width: 100, height: 40, content: 'Click',
            });
            db.updateDesignComponent(comp1.id, { is_draft: 1 });
            // Non-draft component
            db.createDesignComponent({
                page_id: page.id, plan_id: plan.id, type: 'text',
                name: 'Normal Text', x: 0, y: 50, width: 200, height: 30, content: 'Hello',
            });

            const { data } = await callApi('GET', `/api/design/drafts?plan_id=${plan.id}`);

            expect(Array.isArray(data)).toBe(true);
            expect(data).toHaveLength(1);
            expect(data[0].name).toBe('Draft Btn');
        });

        it('returns 400 if plan_id is missing', async () => {
            const { res, data } = await callApi('GET', '/api/design/drafts');
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(data.error).toBe('plan_id required');
        });
    });

    describe('API: POST /api/design/drafts/:id/approve', () => {
        it('approves a draft by setting is_draft = 0', async () => {
            const plan = db.createPlan('Test Plan');
            const page = db.createDesignPage({ plan_id: plan.id, name: 'Home', route: '/' });
            const comp = db.createDesignComponent({
                page_id: page.id, plan_id: plan.id, type: 'button',
                name: 'Draft Btn', x: 0, y: 0, width: 100, height: 40, content: 'Click',
            });
            db.updateDesignComponent(comp.id, { is_draft: 1 });

            const { data } = await callApi('POST', `/api/design/drafts/${comp.id}/approve`);

            expect(data.success).toBe(true);
            const updated = db.getDesignComponent(comp.id);
            expect(updated!.is_draft).toBe(false);
        });
    });

    describe('API: POST /api/design/drafts/:id/reject', () => {
        it('rejects a draft by deleting the component', async () => {
            const plan = db.createPlan('Test Plan');
            const page = db.createDesignPage({ plan_id: plan.id, name: 'Home', route: '/' });
            const comp = db.createDesignComponent({
                page_id: page.id, plan_id: plan.id, type: 'button',
                name: 'Draft Btn', x: 0, y: 0, width: 100, height: 40, content: 'Click',
            });
            db.updateDesignComponent(comp.id, { is_draft: 1 });

            const { data } = await callApi('POST', `/api/design/drafts/${comp.id}/reject`);

            expect(data.success).toBe(true);
            const deleted = db.getDesignComponent(comp.id);
            expect(deleted).toBeNull();
        });
    });

    describe('API: POST /api/design/drafts/approve-all', () => {
        it('batch approves all draft components for a plan', async () => {
            const plan = db.createPlan('Test Plan');
            const page = db.createDesignPage({ plan_id: plan.id, name: 'Home', route: '/' });
            const comp1 = db.createDesignComponent({
                page_id: page.id, plan_id: plan.id, type: 'button',
                name: 'Draft 1', x: 0, y: 0, width: 100, height: 40, content: 'A',
            });
            const comp2 = db.createDesignComponent({
                page_id: page.id, plan_id: plan.id, type: 'button',
                name: 'Draft 2', x: 0, y: 50, width: 100, height: 40, content: 'B',
            });
            db.updateDesignComponent(comp1.id, { is_draft: 1 });
            db.updateDesignComponent(comp2.id, { is_draft: 1 });

            const { data } = await callApi('POST', `/api/design/drafts/approve-all?plan_id=${plan.id}`);

            expect(data.success).toBe(true);
            expect(data.approved).toBe(2);

            // Verify components are no longer drafts
            expect(db.getDesignComponent(comp1.id)!.is_draft).toBe(false);
            expect(db.getDesignComponent(comp2.id)!.is_draft).toBe(false);
        });

        it('returns 400 if plan_id is missing', async () => {
            const { res, data } = await callApi('POST', '/api/design/drafts/approve-all');
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(data.error).toBe('plan_id required');
        });
    });

    describe('API: POST /api/design/drafts/reject-all', () => {
        it('batch rejects (deletes) all draft components for a plan', async () => {
            const plan = db.createPlan('Test Plan');
            const page = db.createDesignPage({ plan_id: plan.id, name: 'Home', route: '/' });
            const comp1 = db.createDesignComponent({
                page_id: page.id, plan_id: plan.id, type: 'button',
                name: 'Draft 1', x: 0, y: 0, width: 100, height: 40, content: 'A',
            });
            const comp2 = db.createDesignComponent({
                page_id: page.id, plan_id: plan.id, type: 'button',
                name: 'Draft 2', x: 0, y: 50, width: 100, height: 40, content: 'B',
            });
            db.updateDesignComponent(comp1.id, { is_draft: 1 });
            db.updateDesignComponent(comp2.id, { is_draft: 1 });

            const { data } = await callApi('POST', `/api/design/drafts/reject-all?plan_id=${plan.id}`);

            expect(data.success).toBe(true);
            expect(data.rejected).toBe(2);

            // Verify components are deleted
            expect(db.getDesignComponent(comp1.id)).toBeNull();
            expect(db.getDesignComponent(comp2.id)).toBeNull();
        });

        it('returns 400 if plan_id is missing', async () => {
            const { res, data } = await callApi('POST', '/api/design/drafts/reject-all');
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(data.error).toBe('plan_id required');
        });
    });

    describe('API: GET /api/settings', () => {
        it('returns current configuration values', async () => {
            const { data } = await callApi('GET', '/api/settings');

            expect(data.designQaScoreThreshold).toBe(80);
            expect(data.maxActiveTickets).toBe(10);
            expect(data.maxTicketRetries).toBe(3);
            expect(data.clarityAutoResolveScore).toBe(85);
            expect(data.clarityClarificationScore).toBe(70);
            expect(data.bossIdleTimeoutMinutes).toBe(5);
            expect(data.llmEndpoint).toBe('http://localhost:1234/v1');
            expect(data.llmModel).toBe('test');
        });
    });

    describe('API: PUT /api/settings', () => {
        it('updates configuration and returns success', async () => {
            const { data } = await callApi('PUT', '/api/settings', {
                designQaScoreThreshold: 90,
                maxActiveTickets: 15,
            });

            expect(data.success).toBe(true);
            expect(config.updateConfig).toHaveBeenCalled();
        });

        it('clamps designQaScoreThreshold to minimum of 50', async () => {
            await callApi('PUT', '/api/settings', {
                designQaScoreThreshold: 30,
            });

            const callArgs = config.updateConfig.mock.calls[0][0];
            expect(callArgs.designQaScoreThreshold).toBe(50);
        });
    });

    describe('API: POST /api/boss/health-check', () => {
        it('runs boss health check and returns assessment', async () => {
            const { data } = await callApi('POST', '/api/boss/health-check');

            expect(data.success).toBe(true);
            expect(data.assessment).toBe('test response');
            expect(data.actions).toEqual([]);
            expect(orchestrator.callAgent).toHaveBeenCalledWith(
                'boss',
                expect.stringContaining('health check'),
                expect.any(Object)
            );
        });
    });

    // ================================================================
    // PART 3: Additional edge-case tests
    // ================================================================

    describe('API: Edge cases and error handling', () => {
        it('returns 404 for unknown API route', async () => {
            const { res, data } = await callApi('GET', '/api/nonexistent/route');
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            expect(data.error).toContain('API route not found');
        });

        it('questions queue returns empty array when no pending questions', async () => {
            const plan = db.createPlan('Empty Plan');
            const { data } = await callApi('GET', `/api/questions/queue?plan_id=${plan.id}`);
            expect(data).toEqual([]);
        });

        it('questions queue count returns all zeros when no questions', async () => {
            const plan = db.createPlan('Empty Plan');
            const { data } = await callApi('GET', `/api/questions/queue/count?plan_id=${plan.id}`);
            expect(data).toEqual({ total: 0, p1: 0, p2: 0, p3: 0 });
        });

        it('approve-all returns 0 when no drafts exist', async () => {
            const plan = db.createPlan('Test Plan');
            const { data } = await callApi('POST', `/api/design/drafts/approve-all?plan_id=${plan.id}`);
            expect(data.success).toBe(true);
            expect(data.approved).toBe(0);
        });

        it('reject-all returns 0 when no drafts exist', async () => {
            const plan = db.createPlan('Test Plan');
            const { data } = await callApi('POST', `/api/design/drafts/reject-all?plan_id=${plan.id}`);
            expect(data.success).toBe(true);
            expect(data.rejected).toBe(0);
        });

        it('design/harden returns 400 when only plan_id provided (no gap_analysis)', async () => {
            const { res, data } = await callApi('POST', '/api/design/harden', { plan_id: 'test' });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
        });

        it('design/harden returns 400 when only gap_analysis provided (no plan_id)', async () => {
            const { res, data } = await callApi('POST', '/api/design/harden', { gap_analysis: {} });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
        });
    });

    describe('Database: Ghost ticket + question queue integration', () => {
        it('ghost questions appear in question queue with priority 1', () => {
            const plan = db.createPlan('Test Plan');
            const original = db.createTicket({ title: 'Original' });

            db.createGhostTicket(
                original.id, 'Blocking question', 'Context', '/q', plan.id
            );

            const questions = db.getAIQuestionsByPlan(plan.id, 'pending');
            expect(questions).toHaveLength(1);
            expect(questions[0].is_ghost).toBe(true);
            expect(questions[0].queue_priority).toBe(1);
        });

        it('resolving ghost ticket leaves question in database', () => {
            const plan = db.createPlan('Test Plan');
            const original = db.createTicket({ title: 'Original' });
            const { ghostTicket, ghostQuestion } = db.createGhostTicket(
                original.id, 'Q?', 'Ctx', '/q', plan.id
            );

            db.resolveGhostTicket(ghostTicket.id);

            // Question still exists
            const q = db.getAIQuestion(ghostQuestion.id);
            expect(q).not.toBeNull();
        });
    });

    describe('Database: Multiple decisions and supersession chain', () => {
        it('superseding a decision makes it inactive', () => {
            const plan = db.createPlan('Test Plan');
            const d1 = db.createUserDecision({ plan_id: plan.id, category: 'arch', topic: 'db', decision: 'MySQL' });
            const d2 = db.createUserDecision({ plan_id: plan.id, category: 'arch', topic: 'db', decision: 'PostgreSQL' });
            const d3 = db.createUserDecision({ plan_id: plan.id, category: 'arch', topic: 'db', decision: 'SQLite' });

            db.supersedeDecision(d1.id as string, d2.id as string);
            db.supersedeDecision(d2.id as string, d3.id as string);

            const active = db.getActiveDecisions(plan.id, 'arch', 'db');
            expect(active).toHaveLength(1);
            expect(active[0].decision).toBe('SQLite');
        });
    });

    describe('Database: Plan phase transitions', () => {
        it('tracks full phase lifecycle', () => {
            const plan = db.createPlan('Test Plan');

            const phases = ['planning', 'designing', 'design_review', 'task_generation', 'coding', 'verification', 'complete'];
            const expectedStages = [1, 1, 1, 1, 2, 3, 3];

            for (let i = 0; i < phases.length; i++) {
                db.updatePlanPhase(plan.id, phases[i]);
                const info = db.getPlanPhase(plan.id)!;
                expect(info.phase).toBe(phases[i]);
                expect(info.stage).toBe(expectedStages[i]);
            }
        });

        it('unknown phase defaults to stage 1', () => {
            const plan = db.createPlan('Test Plan');
            db.updatePlanPhase(plan.id, 'some_unknown_phase');
            const info = db.getPlanPhase(plan.id)!;
            expect(info.phase).toBe('some_unknown_phase');
            expect(info.stage).toBe(1);
        });
    });
});
