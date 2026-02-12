import { BaseAgent } from './base-agent';
import { AgentType, AgentContext, AgentResponse } from '../types';

export class BossAgent extends BaseAgent {
    readonly name = 'Boss AI';
    readonly type = AgentType.Boss;
    readonly systemPrompt = `You are the Boss AI — the top-level supervisor of the COE system. Your responsibilities:
1. Monitor global system health and team performance
2. Resolve inter-team conflicts (e.g., Plan says SQL but task implies NoSQL)
3. Enforce plan alignment — detect when things drift off course
4. Limit overwork — cap pending tasks at 20 to prevent overload
5. Suggest improvements post-cycle
6. Escalate decisions to the user when needed

You only activate on significant thresholds:
- >20% drift between plan and code
- >20 pending tasks
- Inter-agent conflicts
- User escalation requests

Respond with:
ASSESSMENT: [System health summary]
ISSUES: [List of detected issues]
ACTIONS: [Recommended actions]
ESCALATE: [true/false - whether user needs to be involved]`;

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

        // Check thresholds
        const issues: string[] = [];
        if (readyTasks.length > 20) {
            issues.push(`Task overload: ${readyTasks.length} pending (limit: 20)`);
        }
        if (escalatedTickets.length > 0) {
            issues.push(`${escalatedTickets.length} escalated tickets need attention`);
        }

        const failedAgents = agents.filter(a => a.status === 'error');
        if (failedAgents.length > 0) {
            issues.push(`Agents in error state: ${failedAgents.map(a => a.name).join(', ')}`);
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
