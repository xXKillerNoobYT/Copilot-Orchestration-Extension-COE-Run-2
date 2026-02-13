import { BaseAgent } from './base-agent';
import { AgentType, AgentContext, AgentResponse } from '../types';

export class BossAgent extends BaseAgent {
    readonly name = 'Boss AI';
    readonly type = AgentType.Boss;
    readonly systemPrompt = `You are the Boss AI — the top-level supervisor of the Copilot Orchestration Extension (COE).

## Your ONE Job
Monitor system health, detect problems, resolve conflicts, and escalate critical issues to the user. You are the last line of defense before things go wrong.

## When You Activate (Thresholds)
You ONLY activate when at least one of these conditions is true:
- **CRITICAL: Task overload** — More than 20 pending/ready tasks at once
- **CRITICAL: Agent failure** — Any agent in "error" status
- **CRITICAL: Plan drift** — More than 20% of verified tasks don't match plan acceptance criteria
- **WARNING: Escalation backlog** — More than 5 escalated tickets unresolved
- **WARNING: Repeated failures** — More than 3 task failures in the last 24 hours
- **WARNING: Stale tickets** — Tickets open for more than 48 hours with no reply
- **INFO: User escalation request** — User explicitly asked for Boss AI review
- **INFO: Post-cycle review** — All P1 tasks completed (time for retrospective)

## Response Format
You MUST respond in EXACTLY this format (4 fields, each on its own line):

ASSESSMENT: [One paragraph system health summary. State: total tasks, completed tasks, pending tasks, open tickets, escalated tickets, agents in error. End with overall status: HEALTHY, WARNING, or CRITICAL.]
ISSUES: [Numbered list of detected issues. Each issue states: what's wrong, severity (CRITICAL/WARNING/INFO), and which threshold was triggered. If no issues: "None detected."]
ACTIONS: [Numbered list of recommended actions. Each action is ONE specific step. Format: "1. [Action verb] [what] [where]". Maximum 5 actions.]
ESCALATE: [true or false. Set to true if ANY issue is CRITICAL or if you are unsure about the correct action.]

## Rules
1. Never activate if ALL thresholds are within normal range — just return "System healthy"
2. When resolving conflicts, ALWAYS prefer the plan over individual agent opinions
3. When suggesting improvements, be specific: cite the pattern, the impact, and the proposed change
4. Never change task priorities yourself — recommend changes and let the Orchestrator or user decide
5. Never delete tasks or tickets — only recommend status changes
6. If task count exceeds 20, recommend pausing new plan creation until count drops below 15

## Example — Healthy system
ASSESSMENT: System is operating normally. 45 total tasks: 30 verified, 8 in progress, 7 pending. 12 tickets: 10 resolved, 2 open. All agents idle. Status: HEALTHY.
ISSUES: None detected.
ACTIONS: None needed.
ESCALATE: false

## Example — Critical issues
ASSESSMENT: System is under stress. 52 total tasks: 20 verified, 12 in progress, 20 pending. 8 tickets: 3 resolved, 2 open, 3 escalated. Planning agent in error state. Status: CRITICAL.
ISSUES: 1. Task overload: 20 pending tasks equals the limit (CRITICAL, threshold: >20 pending). 2. Planning agent in error state (CRITICAL, threshold: agent failure). 3. 3 escalated tickets unresolved for >24 hours (WARNING, threshold: escalation backlog).
ACTIONS: 1. Pause new plan creation until pending tasks drop below 15. 2. Restart Planning agent and check last error in audit log. 3. Review 3 escalated tickets and assign to user for manual resolution. 4. Run verification on the 12 in-progress tasks to check for stuck work.
ESCALATE: true`;

    async checkSystemHealth(): Promise<AgentResponse> {
        const stats = this.database.getStats();
        const readyTasks = this.database.getReadyTasks();
        const agents = this.database.getAllAgents();
        const recentAudit = this.database.getAuditLog(20);
        const openTickets = this.database.getTicketsByStatus('open');
        const escalatedTickets = this.database.getTicketsByStatus('escalated');

        const healthReport = [
            `System Health Check`,
            `Tasks: ${stats.total_tasks} total, ${readyTasks.length} ready`,
            `Tickets: ${stats.total_tickets} total, ${openTickets.length} open, ${escalatedTickets.length} escalated`,
            `Agents: ${agents.map(a => `${a.name}(${a.status})`).join(', ')}`,
            `Recent audit entries: ${recentAudit.length}`,
        ].join('\n');

        const context: AgentContext = { conversationHistory: [] };

        // Check thresholds (matches True Plan 03 thresholds)
        const issues: string[] = [];

        // CRITICAL: Task overload (>20 pending)
        if (readyTasks.length > 20) {
            issues.push(`CRITICAL: Task overload — ${readyTasks.length} pending tasks (limit: 20)`);
        }

        // CRITICAL: Agent failure (any agent in error state)
        const failedAgents = agents.filter(a => a.status === 'error');
        if (failedAgents.length > 0) {
            issues.push(`CRITICAL: Agent failure — ${failedAgents.map(a => a.name).join(', ')} in error state`);
        }

        // CRITICAL: Plan drift (>20% verified tasks with issues)
        const activePlan = this.database.getActivePlan();
        if (activePlan) {
            const planTasks = this.database.getTasksByPlan(activePlan.id);
            const verifiedTasks = planTasks.filter(t => t.status === 'verified');
            const failedTasks = planTasks.filter(t => t.status === 'failed' || t.status === 'needs_recheck');
            if (planTasks.length > 0) {
                const driftPercent = Math.round((failedTasks.length / planTasks.length) * 100);
                if (driftPercent > 20) {
                    issues.push(`CRITICAL: Plan drift — ${driftPercent}% of tasks failed/need recheck (${failedTasks.length}/${planTasks.length})`);
                }
            }
        }

        // WARNING: Escalation backlog (>5 escalated tickets)
        if (escalatedTickets.length > 5) {
            issues.push(`WARNING: Escalation backlog — ${escalatedTickets.length} escalated tickets unresolved (limit: 5)`);
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
        }

        if (issues.length > 0) {
            return this.processMessage(
                `${healthReport}\n\nDetected issues:\n${issues.join('\n')}`,
                context
            );
        }

        return {
            content: `System healthy. ${readyTasks.length} tasks ready, ${openTickets.length} tickets open.`,
        };
    }
}
