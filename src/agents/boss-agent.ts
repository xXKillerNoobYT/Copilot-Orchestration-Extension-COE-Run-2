import { BaseAgent } from './base-agent';
import { AgentType, AgentContext, AgentResponse, AgentAction, TicketPriority, TicketStatus } from '../types';

/**
 * Boss AI — top-level supervisor of the COE system (per True Plan 03 hierarchy).
 *
 * The Boss AI sits at the top of the agent tree:
 *   Boss AI → Orchestrator → Planning Team → Specialist Agents → Review Agent
 *
 * It is the ACTIVE decision-maker:
 *   - Picks which ticket goes next
 *   - Creates verification tickets when coding is done
 *   - Creates planning tickets when sub-tasks are needed
 *   - Detects problems and creates corrective tickets
 *   - Runs on startup, between every ticket, and every 5 min when idle
 *
 * All agent communication runs through the ticket system.
 * Boss AI creates tickets to dispatch work to the right teams.
 */
export class BossAgent extends BaseAgent {
    readonly name = 'Boss AI';
    readonly type = AgentType.Boss;
    readonly systemPrompt = `You are the Boss AI — the top-level supervisor of the Copilot Orchestration Extension (COE).

## Your Role
You are the active decision-maker. You don't just monitor — you DIRECT.
You oversee the Orchestrator, Planning Team, and Verification Team.
All communication goes through tickets. You create tickets to dispatch work.

## When You Run
- On system startup (assess and recover)
- Between every ticket completion (decide what's next)
- Every 5 minutes when idle (scan for issues)
- When escalated by another agent

## Response Format
Respond with EXACTLY these 5 fields:

ASSESSMENT: [One paragraph system health. Total tasks, completed, pending, open tickets, escalated tickets, agents status. End with: HEALTHY, WARNING, or CRITICAL.]
ISSUES: [Numbered issues. Each: what's wrong, severity, threshold. If none: "None detected."]
ACTIONS: [Numbered actions. Each: "1. [VERB] [what] [where]". Max 5. Use these verbs: CREATE_VERIFICATION, CREATE_PLANNING, CREATE_CODING, ESCALATE_USER, RECOVER_STUCK, REPRIORITIZE, PAUSE_INTAKE.]
NEXT_TICKET: [The ticket ID or number that should be processed next, if any. "none" if queue is empty.]
ESCALATE: [true or false]

## Action Verbs
- CREATE_VERIFICATION: Create a ticket for the Verification Team to verify a completed coding ticket
- CREATE_PLANNING: Create a ticket for the Planning Team to decompose or plan work
- CREATE_CODING: Create a ticket for coding work
- ESCALATE_USER: Create a question/feedback for the user to answer
- RECOVER_STUCK: Recover a stuck or orphaned ticket
- REPRIORITIZE: Recommend changing a ticket's priority
- PAUSE_INTAKE: Stop accepting new tickets until backlog clears

## Rules
1. Prefer the plan over individual agent opinions
2. Never delete tasks or tickets
3. Be specific: cite the pattern, impact, and proposed change
4. If task count > 20, recommend PAUSE_INTAKE
5. When coding tickets complete, CREATE_VERIFICATION for them`;

    /**
     * Check system health and return an assessment with ACTIONABLE decisions.
     *
     * Returns both a text assessment (for logging/display) and a structured
     * actions array that the TicketProcessor can execute immediately.
     *
     * This is the Boss AI's primary decision function. It:
     * 1. Gathers system state (deterministic)
     * 2. Checks thresholds and detects issues (deterministic)
     * 3. Generates concrete actions based on detected issues (deterministic)
     * 4. Optionally asks the LLM for nuanced assessment (when issues exist)
     */
    async checkSystemHealth(): Promise<AgentResponse> {
        const stats = this.database.getStats();
        const readyTasks = this.database.getReadyTasks();
        const agents = this.database.getAllAgents();
        const recentAudit = this.database.getAuditLog(200);
        const openTickets = this.database.getTicketsByStatus('open');
        const escalatedTickets = this.database.getTicketsByStatus('escalated');
        const resolvedTickets = this.database.getTicketsByStatus('resolved');

        // ==================== GATHER STATE ====================

        const healthReport = [
            `System Health Check`,
            `Tasks: ${stats.total_tasks} total, ${readyTasks.length} ready`,
            `Tickets: ${stats.total_tickets} total, ${openTickets.length} open, ${escalatedTickets.length} escalated`,
            `Agents: ${agents.map(a => `${a.name}(${a.status})`).join(', ')}`,
            `Recent audit entries: ${recentAudit.length}`,
        ].join('\n');

        // ==================== DETECT ISSUES (deterministic) ====================

        const issues: string[] = [];
        const actions: AgentAction[] = [];

        // CRITICAL: Task overload (>20 pending)
        if (readyTasks.length > 20) {
            issues.push(`CRITICAL: Task overload — ${readyTasks.length} pending tasks (limit: 20)`);
            actions.push({
                type: 'log',
                payload: { action: 'pause_intake', reason: `${readyTasks.length} pending tasks exceeds limit of 20` },
            });
        }

        // CRITICAL: Agent failure (any agent in error state)
        const failedAgents = agents.filter(a => a.status === 'error');
        if (failedAgents.length > 0) {
            issues.push(`CRITICAL: Agent failure — ${failedAgents.map(a => a.name).join(', ')} in error state`);
            actions.push({
                type: 'escalate',
                payload: { reason: `Agent(s) in error state: ${failedAgents.map(a => a.name).join(', ')}` },
            });
        }

        // CRITICAL: Plan drift (>20% verified tasks with issues)
        const activePlan = this.database.getActivePlan();
        if (activePlan) {
            const planTasks = this.database.getTasksByPlan(activePlan.id);
            const failedTasks = planTasks.filter(t => t.status === 'failed' || t.status === 'needs_recheck');
            if (planTasks.length > 0) {
                const driftPercent = Math.round((failedTasks.length / planTasks.length) * 100);
                if (driftPercent > 20) {
                    issues.push(`CRITICAL: Plan drift — ${driftPercent}% of tasks failed/need recheck (${failedTasks.length}/${planTasks.length})`);
                    // Create planning ticket to investigate and fix drift
                    actions.push({
                        type: 'create_ticket',
                        payload: {
                            title: `Plan drift correction: ${failedTasks.length} of ${planTasks.length} tasks need attention`,
                            operation_type: 'boss_directive',
                            priority: TicketPriority.P1,
                            body: `Boss AI detected plan drift at ${driftPercent}%. Failed tasks:\n${failedTasks.map(t => `- ${t.title} (${t.status})`).join('\n')}`,
                        },
                    });
                }
            }
        }

        // WARNING: Escalation backlog (>5 escalated tickets)
        if (escalatedTickets.length > 5) {
            issues.push(`WARNING: Escalation backlog — ${escalatedTickets.length} escalated tickets unresolved (limit: 5)`);
            actions.push({
                type: 'escalate',
                payload: { reason: `${escalatedTickets.length} escalated tickets need user attention` },
            });
        }

        // WARNING: Repeated failures (>3 in last 24h)
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const recentFailures = recentAudit.filter(
            a => (a.action === 'verification_failed' || a.action === 'task_failed')
                && a.created_at > oneDayAgo
        );
        if (recentFailures.length > 3) {
            issues.push(`WARNING: Repeated failures — ${recentFailures.length} task failures in last 24 hours (limit: 3)`);
        }

        // WARNING: Stale tickets (open >48h with no reply)
        const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const staleTickets = openTickets.filter(t => t.created_at < twoDaysAgo);
        if (staleTickets.length > 0) {
            issues.push(`WARNING: Stale tickets — ${staleTickets.length} ticket(s) open for >48 hours with no reply`);
            // Recover stale tickets
            for (const stale of staleTickets.slice(0, 3)) {
                actions.push({
                    type: 'create_ticket',
                    payload: {
                        title: `Recover stale ticket: TK-${stale.ticket_number} "${stale.title}"`,
                        operation_type: 'boss_directive',
                        priority: TicketPriority.P2,
                        body: `Boss AI detected ticket TK-${stale.ticket_number} open >48 hours. Original: ${stale.title}`,
                        blocking_ticket_id: stale.id,
                    },
                });
            }
        }

        // ==================== PROACTIVE WORK GENERATION ====================

        // Look for completed coding tickets that haven't been verified yet
        const recentlyResolved = resolvedTickets.filter(t => {
            const isRecent = t.updated_at > new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            const isCoding = t.operation_type === 'code_generation' || t.deliverable_type === 'code_generation';
            const notVerified = t.verification_result !== 'passed' && t.verification_result !== 'verified';
            return isRecent && isCoding && notVerified;
        });

        for (const codingTicket of recentlyResolved.slice(0, 3)) {
            // Check if a verification ticket already exists for this one
            const existingVerify = openTickets.find(t =>
                t.title.includes(`verify:`) && t.title.includes(codingTicket.ticket_number?.toString() || codingTicket.id)
            );
            if (!existingVerify) {
                actions.push({
                    type: 'create_ticket',
                    payload: {
                        title: `verify: TK-${codingTicket.ticket_number} "${codingTicket.title}"`,
                        operation_type: 'verification',
                        priority: TicketPriority.P2,
                        body: `Boss AI: Verify the output of completed coding ticket TK-${codingTicket.ticket_number}.\n\nOriginal ticket: ${codingTicket.title}\nAcceptance criteria: ${codingTicket.acceptance_criteria || 'Match original requirements'}`,
                        blocking_ticket_id: codingTicket.id,
                        deliverable_type: 'verification',
                    },
                });
            }
        }

        // INFO: Post-cycle review (all P1 tasks completed)
        if (activePlan) {
            const planTasks = this.database.getTasksByPlan(activePlan.id);
            const p1Tasks = planTasks.filter(t => t.priority === 'P1');
            if (p1Tasks.length > 0) {
                const completedP1 = p1Tasks.filter(t => t.status === 'verified');
                if (completedP1.length === p1Tasks.length) {
                    const remainingTasks = planTasks.filter(t => t.status !== 'verified');
                    issues.push(`INFO: Post-cycle review — All ${p1Tasks.length} P1 tasks completed. ${remainingTasks.length} lower-priority tasks remaining. Consider retrospective.`);
                }
            }
        }

        // ==================== BUILD RESPONSE ====================

        const context: AgentContext = { conversationHistory: [] };

        if (issues.length > 0) {
            // Ask LLM for nuanced assessment when issues exist
            const llmResponse = await this.processMessage(
                `${healthReport}\n\nDetected issues:\n${issues.join('\n')}`,
                context
            );
            // Merge deterministic actions with any LLM might suggest
            return {
                content: llmResponse.content,
                actions: [...actions, ...(llmResponse.actions || [])],
                confidence: llmResponse.confidence,
                tokensUsed: llmResponse.tokensUsed,
            };
        }

        // Healthy system — return deterministic actions only (no LLM call needed)
        return {
            content: `ASSESSMENT: System healthy. ${readyTasks.length} tasks ready, ${openTickets.length} tickets open. Status: HEALTHY.\nISSUES: None detected.\nACTIONS: ${actions.length > 0 ? actions.length + ' proactive actions generated.' : 'None needed.'}\nNEXT_TICKET: ${readyTasks.length > 0 ? 'Queue has items.' : 'none'}\nESCALATE: false`,
            actions,
        };
    }
}
