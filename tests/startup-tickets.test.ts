import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../src/core/database';
import { EventBus, getEventBus } from '../src/core/event-bus';
import { StartupTicketManager, OutputChannelLike } from '../src/core/startup-tickets';
import { TicketStatus, TicketPriority } from '../src/types';

describe('StartupTicketManager', () => {
    let db: Database;
    let tmpDir: string;
    let eventBus: EventBus;
    let outputChannel: OutputChannelLike;
    let manager: StartupTicketManager;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-test-stm-'));
        db = new Database(tmpDir);
        await db.initialize();
        eventBus = getEventBus();
        outputChannel = { appendLine: jest.fn() };
        manager = new StartupTicketManager(db, eventBus, outputChannel);
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ==================== BOOTSTRAP DETECTION ====================

    describe('isBootstrapStarted', () => {
        test('returns false when no bootstrap tickets exist', () => {
            expect(manager.isBootstrapStarted()).toBe(false);
        });

        test('returns true after bootstrap tickets are created', () => {
            manager.createBootstrapTickets();
            expect(manager.isBootstrapStarted()).toBe(true);
        });
    });

    describe('isBootstrapComplete', () => {
        test('returns false when no bootstrap tickets exist', () => {
            expect(manager.isBootstrapComplete()).toBe(false);
        });

        test('returns false when bootstrap started but not complete', () => {
            manager.createBootstrapTickets();
            expect(manager.isBootstrapComplete()).toBe(false);
        });

        test('returns true when marker ticket is completed', () => {
            manager.createBootstrapTickets();
            // Find the "Mark system as initialized" ticket and mark it completed
            const allTickets = db.getAllTickets();
            const markerTicket = allTickets.find(
                t => t.title === 'Mark system as initialized' && t.ticket_category === 'system_bootstrap'
            );
            expect(markerTicket).toBeDefined();
            db.updateTicket(markerTicket!.id, { status: TicketStatus.Completed });
            expect(manager.isBootstrapComplete()).toBe(true);
        });

        test('returns false if marker ticket exists but not completed', () => {
            manager.createBootstrapTickets();
            const allTickets = db.getAllTickets();
            const markerTicket = allTickets.find(t => t.title === 'Mark system as initialized');
            expect(markerTicket).toBeDefined();
            expect(markerTicket!.status).not.toBe(TicketStatus.Completed);
            expect(manager.isBootstrapComplete()).toBe(false);
        });
    });

    // ==================== TICKET CREATION ====================

    describe('createBootstrapTickets', () => {
        test('creates exactly 20 tickets', () => {
            const result = manager.createBootstrapTickets();
            expect(result.created).toBe(20);
            expect(result.skipped).toBe(false);
        });

        test('tickets have system_bootstrap category', () => {
            manager.createBootstrapTickets();
            const allTickets = db.getAllTickets();
            const bootstrapTickets = allTickets.filter(t => t.ticket_category === 'system_bootstrap');
            expect(bootstrapTickets.length).toBe(20);
        });

        test('idempotent — skips if already created', () => {
            manager.createBootstrapTickets();
            const result2 = manager.createBootstrapTickets();
            expect(result2.created).toBe(0);
            expect(result2.skipped).toBe(true);
        });

        test('first ticket has no dependencies (status Open)', () => {
            manager.createBootstrapTickets();
            const allTickets = db.getAllTickets();
            const bootstrapTickets = allTickets.filter(t => t.ticket_category === 'system_bootstrap');
            // Sort by created_at to find the first one
            const firstTicket = bootstrapTickets.find(t => t.title === 'Validate LLM connection and profile setup');
            expect(firstTicket).toBeDefined();
            expect(firstTicket!.status).toBe(TicketStatus.Open);
        });

        test('dependent tickets are created as Blocked', () => {
            manager.createBootstrapTickets();
            const allTickets = db.getAllTickets();
            const treeTicket = allTickets.find(t => t.title === 'Build L0-L1 tree skeleton');
            expect(treeTicket).toBeDefined();
            expect(treeTicket!.status).toBe(TicketStatus.Blocked);
        });

        test('tickets have correct priorities', () => {
            manager.createBootstrapTickets();
            const allTickets = db.getAllTickets();

            const llmValidation = allTickets.find(t => t.title === 'Validate LLM connection and profile setup');
            expect(llmValidation!.priority).toBe(TicketPriority.P1);

            const planningBranch = allTickets.find(t => t.title === 'Build L3 sub-groups for Planning branch');
            expect(planningBranch!.priority).toBe(TicketPriority.P2);

            const welcomeReport = allTickets.find(t => t.title === 'Generate welcome report for user');
            expect(welcomeReport!.priority).toBe(TicketPriority.P3);
        });

        test('tickets are auto-created by system', () => {
            manager.createBootstrapTickets();
            const allTickets = db.getAllTickets();
            const bootstrapTickets = allTickets.filter(t => t.ticket_category === 'system_bootstrap');
            for (const ticket of bootstrapTickets) {
                expect(ticket.creator).toBe('system');
                expect(ticket.auto_created).toBe(true);
            }
        });

        test('tickets have system_bootstrap operation_type', () => {
            manager.createBootstrapTickets();
            const allTickets = db.getAllTickets();
            const bootstrapTickets = allTickets.filter(t => t.ticket_category === 'system_bootstrap');
            for (const ticket of bootstrapTickets) {
                expect(ticket.operation_type).toBe('system_bootstrap');
            }
        });

        test('emits system:bootstrap_started event', () => {
            const emitSpy = jest.spyOn(eventBus, 'emit');
            manager.createBootstrapTickets();
            expect(emitSpy).toHaveBeenCalledWith(
                'system:bootstrap_started',
                'startup-tickets',
                expect.objectContaining({
                    ticket_count: 20,
                })
            );
        });

        test('event includes all ticket IDs', () => {
            const emitSpy = jest.spyOn(eventBus, 'emit');
            manager.createBootstrapTickets();

            const bootstrapCall = emitSpy.mock.calls.find(
                c => c[0] === 'system:bootstrap_started'
            );
            expect(bootstrapCall).toBeDefined();
            const eventData = bootstrapCall![2] as { ticket_ids: string[] };
            expect(eventData.ticket_ids.length).toBe(20);
        });

        test('logs creation progress', () => {
            manager.createBootstrapTickets();
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Creating 20 bootstrap tickets')
            );
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('All 20 bootstrap tickets created')
            );
        });

        test('all 20 ticket titles are unique', () => {
            manager.createBootstrapTickets();
            const allTickets = db.getAllTickets();
            const bootstrapTickets = allTickets.filter(t => t.ticket_category === 'system_bootstrap');
            const titles = bootstrapTickets.map(t => t.title);
            const uniqueTitles = new Set(titles);
            expect(uniqueTitles.size).toBe(20);
        });

        test('tickets have non-empty body/description', () => {
            manager.createBootstrapTickets();
            const allTickets = db.getAllTickets();
            const bootstrapTickets = allTickets.filter(t => t.ticket_category === 'system_bootstrap');
            for (const ticket of bootstrapTickets) {
                expect(ticket.body.length).toBeGreaterThan(10);
            }
        });

        test('dependency wiring: ticket #2 depends on ticket #1', () => {
            manager.createBootstrapTickets();
            const allTickets = db.getAllTickets();
            const ticket1 = allTickets.find(t => t.title === 'Validate LLM connection and profile setup');
            const ticket2 = allTickets.find(t => t.title === 'Build L0-L1 tree skeleton');
            expect(ticket1).toBeDefined();
            expect(ticket2).toBeDefined();
            expect(ticket2!.blocking_ticket_id).toBe(ticket1!.id);
        });

        test('final marker ticket depends on welcome report', () => {
            manager.createBootstrapTickets();
            const allTickets = db.getAllTickets();
            const markerTicket = allTickets.find(t => t.title === 'Mark system as initialized');
            const welcomeReport = allTickets.find(t => t.title === 'Generate welcome report for user');
            expect(markerTicket).toBeDefined();
            expect(welcomeReport).toBeDefined();
            expect(markerTicket!.blocking_ticket_id).toBe(welcomeReport!.id);
        });
    });

    // ==================== PROGRESS TRACKING ====================

    describe('getBootstrapProgress', () => {
        test('returns zero counts when no bootstrap tickets exist', () => {
            const progress = manager.getBootstrapProgress();
            expect(progress.total).toBe(0);
            expect(progress.completed).toBe(0);
            expect(progress.in_progress).toBe(0);
            expect(progress.blocked).toBe(0);
            expect(progress.failed).toBe(0);
        });

        test('returns correct counts after creation', () => {
            manager.createBootstrapTickets();
            const progress = manager.getBootstrapProgress();
            expect(progress.total).toBe(20);
            expect(progress.completed).toBe(0);
            // First ticket is Open, rest are Blocked
            expect(progress.in_progress).toBe(1);
            expect(progress.blocked).toBe(19);
            expect(progress.failed).toBe(0);
        });

        test('tracks completed tickets', () => {
            manager.createBootstrapTickets();
            const allTickets = db.getAllTickets();
            const firstTicket = allTickets.find(t => t.title === 'Validate LLM connection and profile setup');
            db.updateTicket(firstTicket!.id, { status: TicketStatus.Completed });

            const progress = manager.getBootstrapProgress();
            expect(progress.completed).toBe(1);
        });

        test('tracks failed tickets', () => {
            manager.createBootstrapTickets();
            const allTickets = db.getAllTickets();
            const firstTicket = allTickets.find(t => t.title === 'Validate LLM connection and profile setup');
            db.updateTicket(firstTicket!.id, { status: TicketStatus.Failed });

            const progress = manager.getBootstrapProgress();
            expect(progress.failed).toBe(1);
        });

        test('counts Resolved as completed', () => {
            manager.createBootstrapTickets();
            const allTickets = db.getAllTickets();
            const firstTicket = allTickets.find(t => t.title === 'Validate LLM connection and profile setup');
            db.updateTicket(firstTicket!.id, { status: TicketStatus.Resolved });

            const progress = manager.getBootstrapProgress();
            expect(progress.completed).toBe(1);
        });

        test('counts Validated, ReadyForWork, UnderReview as in_progress', () => {
            manager.createBootstrapTickets();
            const allTickets = db.getAllTickets();
            const bootstrapTickets = allTickets.filter(t => t.ticket_category === 'system_bootstrap');

            // Set first 3 blocked tickets to different in-progress states
            const blockedTickets = bootstrapTickets.filter(t => t.status === TicketStatus.Blocked);
            if (blockedTickets.length >= 3) {
                db.updateTicket(blockedTickets[0].id, { status: TicketStatus.Validated });
                db.updateTicket(blockedTickets[1].id, { status: TicketStatus.ReadyForWork });
                db.updateTicket(blockedTickets[2].id, { status: TicketStatus.UnderReview });
            }

            const progress = manager.getBootstrapProgress();
            // 1 Open (original first ticket) + 3 we just set = 4 in_progress
            expect(progress.in_progress).toBe(4);
        });
    });

    // ==================== TICKET CONTENT QUALITY ====================

    describe('ticket content quality', () => {
        test('all tickets have Objective section', () => {
            manager.createBootstrapTickets();
            const allTickets = db.getAllTickets();
            const bootstrapTickets = allTickets.filter(t => t.ticket_category === 'system_bootstrap');
            for (const ticket of bootstrapTickets) {
                expect(ticket.body).toContain('**Objective:**');
            }
        });

        test('most tickets have Steps section', () => {
            manager.createBootstrapTickets();
            const allTickets = db.getAllTickets();
            const bootstrapTickets = allTickets.filter(t => t.ticket_category === 'system_bootstrap');
            const withSteps = bootstrapTickets.filter(t => t.body.includes('**Steps:**'));
            // At least 15 of 20 should have steps
            expect(withSteps.length).toBeGreaterThanOrEqual(15);
        });

        test('all tickets have Success criteria', () => {
            manager.createBootstrapTickets();
            const allTickets = db.getAllTickets();
            const bootstrapTickets = allTickets.filter(t => t.ticket_category === 'system_bootstrap');
            for (const ticket of bootstrapTickets) {
                expect(ticket.body).toContain('**Success criteria:**');
            }
        });

        test('expected ticket titles are present', () => {
            manager.createBootstrapTickets();
            const allTickets = db.getAllTickets();
            const titles = allTickets.filter(t => t.ticket_category === 'system_bootstrap').map(t => t.title);

            const expectedTitles = [
                'Validate LLM connection and profile setup',
                'Build L0-L1 tree skeleton',
                'Build L2 branch heads',
                'Build L3 sub-groups for Planning branch',
                'Build L3 sub-groups for Verification branch',
                'Build L3 sub-groups for Coding/Execution branch',
                'Build L3 sub-groups for Co-Director branch',
                'Build L3 sub-groups for Data branch',
                'Build L3 sub-groups for Orchestrator branch',
                'Seed niche agent definitions — Planning domain',
                'Seed niche agent definitions — Verification domain',
                'Seed niche agent definitions — Coding domain',
                'Seed niche agent definitions — Co-Director domain',
                'Seed niche agent definitions — Data domain',
                'Seed niche agent definitions — Orchestrator domain',
                'Configure default tool assignments',
                'Run initial system health check',
                'Validate group composition for all L1-L3 groups',
                'Generate welcome report for user',
                'Mark system as initialized',
            ];

            for (const title of expectedTitles) {
                expect(titles).toContain(title);
            }
        });
    });
});
