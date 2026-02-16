import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { BossAgent } from '../src/agents/boss-agent';
import { Database } from '../src/core/database';
import { AgentType, AgentStatus, TaskPriority, TaskStatus, PlanStatus, TicketPriority, TicketStatus } from '../src/types';

describe('BossAgent', () => {
    let db: Database;
    let tmpDir: string;
    let agent: BossAgent;

    const mockLLM = {
        chat: jest.fn().mockResolvedValue({
            content: 'ASSESSMENT: System under stress. Status: CRITICAL.\nISSUES: 1. Detected issue.\nACTIONS: 1. Take action.\nESCALATE: true',
            tokens_used: 10,
        }),
        classify: jest.fn(),
    } as any;

    const mockConfig = {
        getAgentContextLimit: jest.fn().mockReturnValue(4000),
        getConfig: jest.fn().mockReturnValue({
            bossTaskOverloadThreshold: 20,
            bossEscalationThreshold: 5,
            bossStuckPhaseMinutes: 30,
            bossIdleTimeoutMinutes: 5,
            aiMode: 'smart',
            bossAutoRunEnabled: true,
        }),
    } as any;

    const mockOutput = {
        appendLine: jest.fn(),
    } as any;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-boss-agent-test-'));
        db = new Database(tmpDir);
        await db.initialize();

        // Reset mock call history between tests
        mockLLM.chat.mockClear();
        mockOutput.appendLine.mockClear();

        agent = new BossAgent(db, mockLLM, mockConfig, mockOutput);
        await agent.initialize();
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ===================== AGENT BASICS =====================

    describe('Agent basics', () => {
        test('has correct name, type, and systemPrompt', () => {
            expect(agent.name).toBe('Boss AI');
            expect(agent.type).toBe(AgentType.Boss);
            expect(agent.systemPrompt).toContain('Boss AI');
            expect(agent.systemPrompt).toContain('top-level supervisor');
        });

        test('initialize registers agent in the database', () => {
            const registered = db.getAgentByName('Boss AI');
            expect(registered).not.toBeNull();
            expect(registered!.type).toBe(AgentType.Boss);
            expect(registered!.status).toBe(AgentStatus.Idle);
        });
    });

    // ===================== HEALTHY SYSTEM =====================

    describe('checkSystemHealth - healthy system', () => {
        test('returns healthy message without calling LLM when no thresholds exceeded', async () => {
            const result = await agent.checkSystemHealth();

            expect(result.content).toContain('System healthy');
            expect(result.content).toContain('tasks ready');
            expect(result.content).toContain('tickets open');
            // LLM should NOT be called when system is healthy
            expect(mockLLM.chat).not.toHaveBeenCalled();
        });

        test('returns healthy with a few tasks and tickets below thresholds', async () => {
            // Create a few tasks (well under 20)
            for (let i = 0; i < 5; i++) {
                db.createTask({ title: `Task ${i}` });
            }
            // Create a couple open tickets
            db.createTicket({ title: 'Ticket 1' });
            db.createTicket({ title: 'Ticket 2' });

            const result = await agent.checkSystemHealth();

            expect(result.content).toContain('System healthy');
            expect(result.content).toContain('5 tasks ready');
            expect(result.content).toContain('2 tickets open');
            expect(mockLLM.chat).not.toHaveBeenCalled();
        });
    });

    // ===================== CRITICAL: TASK OVERLOAD (>20) =====================

    describe('checkSystemHealth - CRITICAL: Task overload', () => {
        test('triggers when >20 ready tasks exist', async () => {
            // Create 21 tasks with status not_started (default) and no dependencies
            for (let i = 0; i < 21; i++) {
                db.createTask({ title: `Overload Task ${i}` });
            }

            const result = await agent.checkSystemHealth();

            // LLM should be called with the health report containing the issue
            expect(mockLLM.chat).toHaveBeenCalledTimes(1);
            const callArgs = mockLLM.chat.mock.calls[0][0];
            const userMessage = callArgs.find((m: any) => m.role === 'user');
            expect(userMessage.content).toContain('CRITICAL: Task overload');
            expect(userMessage.content).toContain('21 pending tasks');
            expect(userMessage.content).toContain('limit: 20');
        });

        test('does not trigger at exactly 20 ready tasks', async () => {
            for (let i = 0; i < 20; i++) {
                db.createTask({ title: `Task ${i}` });
            }

            const result = await agent.checkSystemHealth();

            expect(result.content).toContain('System healthy');
            expect(mockLLM.chat).not.toHaveBeenCalled();
        });
    });

    // ===================== CRITICAL: AGENT FAILURE =====================

    describe('checkSystemHealth - CRITICAL: Agent failure', () => {
        test('triggers when an agent is in error state', async () => {
            // Register another agent and set it to error
            db.registerAgent('Test Agent', AgentType.Planning);
            db.updateAgentStatus('Test Agent', AgentStatus.Error);

            const result = await agent.checkSystemHealth();

            expect(mockLLM.chat).toHaveBeenCalledTimes(1);
            const callArgs = mockLLM.chat.mock.calls[0][0];
            const userMessage = callArgs.find((m: any) => m.role === 'user');
            expect(userMessage.content).toContain('CRITICAL: Agent failure');
            expect(userMessage.content).toContain('Test Agent');
            expect(userMessage.content).toContain('error state');
        });

        test('does not trigger when agents are idle or working', async () => {
            db.registerAgent('Working Agent', AgentType.Planning);
            db.updateAgentStatus('Working Agent', AgentStatus.Working);
            db.registerAgent('Idle Agent', AgentType.Research);
            // Idle by default

            const result = await agent.checkSystemHealth();

            expect(result.content).toContain('System healthy');
            expect(mockLLM.chat).not.toHaveBeenCalled();
        });
    });

    // ===================== CRITICAL: PLAN DRIFT (>20%) =====================

    describe('checkSystemHealth - CRITICAL: Plan drift', () => {
        test('triggers when >20% of tasks in active plan are failed/needs_recheck', async () => {
            // Create a plan and set it to active
            const plan = db.createPlan('Test Plan');
            db.updatePlan(plan.id, { status: PlanStatus.Active });

            // Create 10 tasks in the plan: 2 failed + 1 needs_recheck = 30% drift
            for (let i = 0; i < 7; i++) {
                db.createTask({
                    title: `Good Task ${i}`,
                    plan_id: plan.id,
                    status: TaskStatus.Verified,
                });
            }
            db.createTask({
                title: 'Failed Task 1',
                plan_id: plan.id,
                status: TaskStatus.Failed,
            });
            db.createTask({
                title: 'Failed Task 2',
                plan_id: plan.id,
                status: TaskStatus.Failed,
            });
            db.createTask({
                title: 'Needs Recheck Task',
                plan_id: plan.id,
                status: TaskStatus.NeedsReCheck,
            });

            const result = await agent.checkSystemHealth();

            expect(mockLLM.chat).toHaveBeenCalledTimes(1);
            const callArgs = mockLLM.chat.mock.calls[0][0];
            const userMessage = callArgs.find((m: any) => m.role === 'user');
            expect(userMessage.content).toContain('CRITICAL: Plan drift');
            expect(userMessage.content).toContain('30%');
            expect(userMessage.content).toContain('3/10');
        });

        test('does not trigger at exactly 20% drift', async () => {
            const plan = db.createPlan('Test Plan');
            db.updatePlan(plan.id, { status: PlanStatus.Active });

            // 5 tasks, 1 failed = exactly 20% (not >20%)
            for (let i = 0; i < 4; i++) {
                db.createTask({
                    title: `Good Task ${i}`,
                    plan_id: plan.id,
                    status: TaskStatus.Verified,
                });
            }
            db.createTask({
                title: 'Failed Task',
                plan_id: plan.id,
                status: TaskStatus.Failed,
            });

            const result = await agent.checkSystemHealth();

            expect(result.content).toContain('System healthy');
            expect(mockLLM.chat).not.toHaveBeenCalled();
        });

        test('does not trigger when no active plan exists', async () => {
            // Plan in draft status (not active)
            const plan = db.createPlan('Draft Plan');
            db.createTask({
                title: 'Failed Task',
                plan_id: plan.id,
                status: TaskStatus.Failed,
            });

            const result = await agent.checkSystemHealth();

            expect(result.content).toContain('System healthy');
            expect(mockLLM.chat).not.toHaveBeenCalled();
        });

        test('does not trigger when active plan has no tasks', async () => {
            const plan = db.createPlan('Empty Plan');
            db.updatePlan(plan.id, { status: PlanStatus.Active });

            const result = await agent.checkSystemHealth();

            expect(result.content).toContain('System healthy');
            expect(mockLLM.chat).not.toHaveBeenCalled();
        });
    });

    // ===================== WARNING: ESCALATION BACKLOG (>5) =====================

    describe('checkSystemHealth - WARNING: Escalation backlog', () => {
        test('triggers when >5 escalated tickets exist', async () => {
            // Create 6 escalated tickets
            for (let i = 0; i < 6; i++) {
                db.createTicket({
                    title: `Escalated Ticket ${i}`,
                    status: TicketStatus.Escalated,
                });
            }

            const result = await agent.checkSystemHealth();

            expect(mockLLM.chat).toHaveBeenCalledTimes(1);
            const callArgs = mockLLM.chat.mock.calls[0][0];
            const userMessage = callArgs.find((m: any) => m.role === 'user');
            expect(userMessage.content).toContain('WARNING: Escalation backlog');
            expect(userMessage.content).toContain('6 escalated tickets');
            expect(userMessage.content).toContain('limit: 5');
        });

        test('does not trigger at exactly 5 escalated tickets', async () => {
            for (let i = 0; i < 5; i++) {
                db.createTicket({
                    title: `Escalated Ticket ${i}`,
                    status: TicketStatus.Escalated,
                });
            }

            const result = await agent.checkSystemHealth();

            expect(result.content).toContain('System healthy');
            expect(mockLLM.chat).not.toHaveBeenCalled();
        });
    });

    // ===================== WARNING: REPEATED FAILURES (>3 in 24h) =====================

    describe('checkSystemHealth - WARNING: Repeated failures', () => {
        test('triggers when >3 verification_failed or task_failed audit entries exist in last 24h', async () => {
            // Add 4 recent failure audit entries — these get datetime('now') which is recent
            db.addAuditLog('Verification Agent', 'verification_failed', 'Task X failed verification');
            db.addAuditLog('Verification Agent', 'verification_failed', 'Task Y failed verification');
            db.addAuditLog('Orchestrator', 'task_failed', 'Task Z failed execution');
            db.addAuditLog('Orchestrator', 'task_failed', 'Task W failed execution');

            const result = await agent.checkSystemHealth();

            expect(mockLLM.chat).toHaveBeenCalledTimes(1);
            const callArgs = mockLLM.chat.mock.calls[0][0];
            const userMessage = callArgs.find((m: any) => m.role === 'user');
            expect(userMessage.content).toContain('WARNING: Repeated failures');
            expect(userMessage.content).toContain('4 task failures');
            expect(userMessage.content).toContain('limit: 3');
        });

        test('does not trigger at exactly 3 failures in 24h', async () => {
            db.addAuditLog('Verification Agent', 'verification_failed', 'Failure 1');
            db.addAuditLog('Verification Agent', 'verification_failed', 'Failure 2');
            db.addAuditLog('Orchestrator', 'task_failed', 'Failure 3');

            const result = await agent.checkSystemHealth();

            expect(result.content).toContain('System healthy');
            expect(mockLLM.chat).not.toHaveBeenCalled();
        });

        test('does not count non-failure audit entries', async () => {
            // These should not count toward the failure threshold
            db.addAuditLog('Boss AI', 'process_message', 'Processing something');
            db.addAuditLog('Boss AI', 'health_check', 'Checked health');
            db.addAuditLog('Orchestrator', 'route_message', 'Routed to agent');
            db.addAuditLog('Orchestrator', 'route_message', 'Routed another');
            db.addAuditLog('Orchestrator', 'route_message', 'And another');

            const result = await agent.checkSystemHealth();

            expect(result.content).toContain('System healthy');
            expect(mockLLM.chat).not.toHaveBeenCalled();
        });

        test('does not count old failures (>24h ago)', async () => {
            // Add 4 audit entries, then backdate them to >24h ago
            const entry1 = db.addAuditLog('Agent', 'verification_failed', 'Old failure 1');
            const entry2 = db.addAuditLog('Agent', 'verification_failed', 'Old failure 2');
            const entry3 = db.addAuditLog('Agent', 'task_failed', 'Old failure 3');
            const entry4 = db.addAuditLog('Agent', 'task_failed', 'Old failure 4');

            // Backdate all entries to 3 days ago using raw SQL
            const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
            const rawDb = (db as any).db;
            rawDb.prepare('UPDATE audit_log SET created_at = ? WHERE id IN (?, ?, ?, ?)').run(
                threeDaysAgo, entry1.id, entry2.id, entry3.id, entry4.id
            );

            const result = await agent.checkSystemHealth();

            expect(result.content).toContain('System healthy');
            expect(mockLLM.chat).not.toHaveBeenCalled();
        });
    });

    // ===================== WARNING: STALE TICKETS (>48h) =====================

    describe('checkSystemHealth - WARNING: Stale tickets', () => {
        test('triggers when open tickets are older than configured stuck-phase timeout', async () => {
            // Create open tickets and backdate them
            const ticket1 = db.createTicket({ title: 'Old Ticket 1' });
            const ticket2 = db.createTicket({ title: 'Old Ticket 2' });

            // Backdate to 3 days ago (well over the configured 30 min)
            const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
            const rawDb = (db as any).db;
            rawDb.prepare('UPDATE tickets SET created_at = ? WHERE id IN (?, ?)').run(
                threeDaysAgo, ticket1.id, ticket2.id
            );

            const result = await agent.checkSystemHealth();

            expect(mockLLM.chat).toHaveBeenCalledTimes(1);
            const callArgs = mockLLM.chat.mock.calls[0][0];
            const userMessage = callArgs.find((m: any) => m.role === 'user');
            expect(userMessage.content).toContain('WARNING: Stale tickets');
            expect(userMessage.content).toContain('2 ticket(s) open for >');
            expect(userMessage.content).toContain('minutes with no progress');
        });

        test('does not trigger for recent tickets within stuck-phase timeout', async () => {
            // Tickets created now are well within the 30 min threshold
            db.createTicket({ title: 'Recent Ticket 1' });
            db.createTicket({ title: 'Recent Ticket 2' });

            const result = await agent.checkSystemHealth();

            expect(result.content).toContain('System healthy');
            expect(mockLLM.chat).not.toHaveBeenCalled();
        });

        test('does not count escalated or resolved tickets as stale', async () => {
            // Create tickets with non-open statuses and backdate them
            const t1 = db.createTicket({ title: 'Resolved Old', status: TicketStatus.Resolved });
            const t2 = db.createTicket({ title: 'Escalated Old', status: TicketStatus.Escalated });

            const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
            const rawDb = (db as any).db;
            rawDb.prepare('UPDATE tickets SET created_at = ? WHERE id IN (?, ?)').run(
                threeDaysAgo, t1.id, t2.id
            );

            const result = await agent.checkSystemHealth();

            // These tickets are not "open" so they should not trigger stale check
            expect(result.content).toContain('System healthy');
            expect(mockLLM.chat).not.toHaveBeenCalled();
        });
    });

    // ===================== MULTIPLE ISSUES =====================

    describe('checkSystemHealth - multiple issues', () => {
        test('reports all detected issues in a single health report', async () => {
            // Issue 1: Task overload (>20 ready tasks)
            for (let i = 0; i < 22; i++) {
                db.createTask({ title: `Overload Task ${i}` });
            }

            // Issue 2: Agent failure
            db.registerAgent('Failing Agent', AgentType.Verification);
            db.updateAgentStatus('Failing Agent', AgentStatus.Error);

            // Issue 3: Escalation backlog (>5 escalated tickets)
            for (let i = 0; i < 7; i++) {
                db.createTicket({
                    title: `Escalated ${i}`,
                    status: TicketStatus.Escalated,
                });
            }

            // Issue 4: Repeated failures (>3)
            db.addAuditLog('Agent', 'verification_failed', 'Fail 1');
            db.addAuditLog('Agent', 'verification_failed', 'Fail 2');
            db.addAuditLog('Agent', 'task_failed', 'Fail 3');
            db.addAuditLog('Agent', 'task_failed', 'Fail 4');

            const result = await agent.checkSystemHealth();

            expect(mockLLM.chat).toHaveBeenCalledTimes(1);
            const callArgs = mockLLM.chat.mock.calls[0][0];
            const userMessage = callArgs.find((m: any) => m.role === 'user');

            // All four issues should be present in the message
            expect(userMessage.content).toContain('CRITICAL: Task overload');
            expect(userMessage.content).toContain('CRITICAL: Agent failure');
            expect(userMessage.content).toContain('WARNING: Escalation backlog');
            expect(userMessage.content).toContain('WARNING: Repeated failures');
        });

        test('includes plan drift with other issues', async () => {
            // Issue 1: Plan drift
            const plan = db.createPlan('Drifting Plan');
            db.updatePlan(plan.id, { status: PlanStatus.Active });

            // 4 tasks: 2 failed = 50% drift
            db.createTask({ title: 'OK 1', plan_id: plan.id, status: TaskStatus.Verified });
            db.createTask({ title: 'OK 2', plan_id: plan.id, status: TaskStatus.Verified });
            db.createTask({ title: 'Fail 1', plan_id: plan.id, status: TaskStatus.Failed });
            db.createTask({ title: 'Fail 2', plan_id: plan.id, status: TaskStatus.Failed });

            // Issue 2: Stale tickets
            const staleTicket = db.createTicket({ title: 'Old Ticket' });
            const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
            const rawDb = (db as any).db;
            rawDb.prepare('UPDATE tickets SET created_at = ? WHERE id = ?').run(threeDaysAgo, staleTicket.id);

            const result = await agent.checkSystemHealth();

            expect(mockLLM.chat).toHaveBeenCalledTimes(1);
            const callArgs = mockLLM.chat.mock.calls[0][0];
            const userMessage = callArgs.find((m: any) => m.role === 'user');

            expect(userMessage.content).toContain('CRITICAL: Plan drift');
            expect(userMessage.content).toContain('50%');
            expect(userMessage.content).toContain('WARNING: Stale tickets');
        });
    });

    // ===================== HEALTH REPORT FORMAT =====================

    describe('checkSystemHealth - health report format', () => {
        test('health report includes task counts, ticket counts, agent list, and audit count', async () => {
            // Create some data
            for (let i = 0; i < 22; i++) {
                db.createTask({ title: `Task ${i}` });
            }
            db.createTicket({ title: 'Open Ticket' });
            db.createTicket({ title: 'Escalated Ticket', status: TicketStatus.Escalated });
            db.addAuditLog('System', 'init', 'System started');

            const result = await agent.checkSystemHealth();

            expect(mockLLM.chat).toHaveBeenCalledTimes(1);
            const callArgs = mockLLM.chat.mock.calls[0][0];
            const userMessage = callArgs.find((m: any) => m.role === 'user');

            // Health report header
            expect(userMessage.content).toContain('System Health Check');
            expect(userMessage.content).toContain('Tasks:');
            expect(userMessage.content).toContain('22 ready');
            expect(userMessage.content).toContain('Tickets:');
            expect(userMessage.content).toContain('1 open');
            expect(userMessage.content).toContain('1 escalated');
            expect(userMessage.content).toContain('Agents:');
            expect(userMessage.content).toContain('Boss AI');
            expect(userMessage.content).toContain('Recent audit entries:');
        });

        test('LLM response is returned as agent response content when issues exist', async () => {
            // Trigger an issue so LLM is called
            for (let i = 0; i < 21; i++) {
                db.createTask({ title: `Task ${i}` });
            }

            mockLLM.chat.mockResolvedValueOnce({
                content: 'ASSESSMENT: Overloaded. ISSUES: 1. Too many tasks. ACTIONS: 1. Pause. ESCALATE: true',
                tokens_used: 15,
            });

            const result = await agent.checkSystemHealth();

            expect(result.content).toContain('ASSESSMENT: Overloaded');
            expect(result.content).toContain('ESCALATE: true');
        });
    });

    // ===================== PROCESSM MESSAGE INTEGRATION =====================

    describe('checkSystemHealth - processMessage integration', () => {
        test('processMessage updates agent status to working then back to idle', async () => {
            // Trigger an issue
            db.registerAgent('Error Agent', AgentType.Custom);
            db.updateAgentStatus('Error Agent', AgentStatus.Error);

            await agent.checkSystemHealth();

            // After processMessage completes, agent should be back to idle
            const agentRecord = db.getAgentByName('Boss AI');
            expect(agentRecord!.status).toBe(AgentStatus.Idle);
        });

        test('processMessage adds audit log entry for the health check', async () => {
            // Trigger an issue
            db.registerAgent('Error Agent', AgentType.Custom);
            db.updateAgentStatus('Error Agent', AgentStatus.Error);

            await agent.checkSystemHealth();

            // processMessage adds an audit log for 'process_message'
            const auditLog = db.getAuditLog(50, 'Boss AI');
            const processEntries = auditLog.filter(e => e.action === 'process_message');
            expect(processEntries.length).toBeGreaterThanOrEqual(1);
            expect(processEntries[0].detail).toContain('Processing: System Health Check');
        });

        test('processMessage stores conversation in database', async () => {
            // Trigger an issue
            for (let i = 0; i < 21; i++) {
                db.createTask({ title: `Task ${i}` });
            }

            mockLLM.chat.mockResolvedValueOnce({
                content: 'ASSESSMENT: Task overload detected.',
                tokens_used: 20,
            });

            await agent.checkSystemHealth();

            // Check that the conversation was recorded
            const conversations = db.getConversationsByAgent('Boss AI');
            expect(conversations.length).toBeGreaterThanOrEqual(1);
            expect(conversations[0].content).toContain('ASSESSMENT: Task overload detected.');
        });
    });

    // ===================== DISPOSE =====================

    describe('dispose', () => {
        test('sets agent status to idle on dispose', () => {
            // First set status to something else via processMessage side effect
            db.updateAgentStatus('Boss AI', AgentStatus.Working);
            agent.dispose();

            const agentRecord = db.getAgentByName('Boss AI');
            expect(agentRecord!.status).toBe(AgentStatus.Idle);
        });
    });
});
