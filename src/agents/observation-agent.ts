import { BaseAgent } from './base-agent';
import {
    AgentType, AgentContext, AgentResponse, AgentAction,
    TaskStatus
} from '../types';

/**
 * Observation Agent — Autonomous reviewer that continuously monitors the system
 * for quality improvements, technical debt, patterns, and optimization opportunities.
 *
 * This agent:
 * - Reviews completed tasks and their verification results for patterns
 * - Identifies recurring failures and suggests structural fixes
 * - Monitors agent performance and suggests prompt improvements
 * - Scans for code quality issues, missing tests, and architectural drift
 * - Creates improvement tickets and can suggest new specialized agents
 * - Maintains a running improvement log with priority scoring
 *
 * Think of it as the "tech lead" that reviews everything and finds ways to improve.
 */
export class ObservationAgent extends BaseAgent {
    readonly name = 'Observation Team';
    readonly type = AgentType.Observation;
    readonly systemPrompt = `You are the Observation Team agent for the Copilot Orchestration Extension (COE).

## Your ONE Job
Review the system's recent history (completed tasks, failed verifications, agent interactions, audit logs, tickets) and identify opportunities for improvement. You are the system's quality conscience — always looking for ways to make things better.

## What You Analyze
1. **Task Completion Patterns**: Which tasks fail verification most often? Why?
2. **Agent Performance**: Which agents produce the best results? Which need prompt tuning?
3. **Code Quality Signals**: Are there recurring issues in specific file types or areas?
4. **Architecture Health**: Is the codebase drifting from the design plan?
5. **Process Efficiency**: Are there bottlenecks in the task pipeline?
6. **Missing Coverage**: Are there features without tests? Pages without components?
7. **Ticket Trends**: Are tickets being resolved or piling up?

## Observation Categories
- **quality**: Code quality, test coverage, type safety, error handling
- **performance**: Speed, efficiency, resource usage, LLM token usage
- **architecture**: Design drift, coupling issues, missing abstractions
- **process**: Workflow bottlenecks, blocked tasks, stale tickets
- **agent_improvement**: Agent prompt tuning, new agent suggestions, routing improvements
- **user_experience**: UI issues, accessibility, responsiveness

## Required JSON Output Format
Respond with ONLY valid JSON. No markdown, no explanation.

{
  "observation_summary": "Overall system health assessment in 2-3 sentences",
  "health_score": 85,
  "observations": [
    {
      "id": "OBS-001",
      "category": "quality",
      "severity": "warning",
      "title": "3 tasks failed verification due to missing error handling",
      "description": "Tasks T-001, T-005, T-012 all failed because error handling was not implemented. This suggests the planning agent's task requirements need stronger error handling guidance.",
      "evidence": [
        "Task T-001 failed: missing try/catch in auth endpoint",
        "Task T-005 failed: unhandled promise rejection",
        "Task T-012 failed: no input validation"
      ],
      "recommendation": "Update PlanningAgent system prompt to always include error handling in task_requirements.gotchas",
      "effort": "low",
      "impact": "high",
      "auto_fixable": true
    }
  ],
  "improvement_actions": [
    {
      "type": "create_task",
      "title": "Add error handling requirements to planning agent",
      "description": "Update the planning agent's system prompt to include error handling guidance in every task",
      "priority": "P2",
      "target_agent": "planning"
    },
    {
      "type": "create_ticket",
      "title": "Review agent routing accuracy",
      "description": "5 messages were routed to the wrong agent this week",
      "priority": "P3"
    },
    {
      "type": "suggest_agent",
      "title": "Security Review Agent",
      "description": "Recurring security-related failures suggest a dedicated security review agent would catch issues earlier",
      "agent_config": {
        "name": "Security Reviewer",
        "keywords": ["security", "auth", "permission", "vulnerability", "injection", "xss"],
        "focus": "Review code changes for security vulnerabilities before verification"
      }
    }
  ],
  "agent_ratings": [
    {
      "agent_name": "Planning Team",
      "accuracy": 85,
      "areas": {
        "task_clarity": 90,
        "dependency_accuracy": 80,
        "time_estimation": 75,
        "requirement_completeness": 85
      },
      "improvement_note": "Time estimates often too low for integration tasks"
    }
  ],
  "trend": "improving"
}

## Severity Levels
- **critical**: System is broken or producing incorrect results
- **warning**: Significant issue that should be addressed soon
- **info**: Opportunity for improvement, not urgent
- **positive**: Something working well — reinforce this pattern

## Rules
- Base ALL observations on real data from the system (audit logs, task history, verification results)
- NEVER make up statistics or fabricate evidence
- Prioritize observations by impact * ease of fix
- Always provide actionable recommendations, not just complaints
- If you notice a pattern of 3+ similar failures, suggest a structural fix (not just patching each one)
- Rate agents fairly — include both strengths and areas for improvement
- Suggest new specialized agents only when a clear pattern of need exists`;

    protected async parseResponse(content: string, context: AgentContext): Promise<AgentResponse> {
        const actions: AgentAction[] = [];

        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);

                if (parsed.observations) {
                    // Create tickets for high-severity observations
                    for (const obs of parsed.observations) {
                        if (obs.severity === 'critical' || obs.severity === 'warning') {
                            actions.push({
                                type: 'create_ticket',
                                payload: {
                                    title: `[${obs.category}] ${obs.title}`,
                                    body: `${obs.description}\n\nEvidence:\n${(obs.evidence || []).map((e: string) => `- ${e}`).join('\n')}\n\nRecommendation: ${obs.recommendation}\nEffort: ${obs.effort} | Impact: ${obs.impact}`,
                                    priority: obs.severity === 'critical' ? 'P1' : 'P2',
                                    creator: 'Observation Agent',
                                },
                            });
                        }
                    }

                    // Create improvement tasks
                    for (const action of (parsed.improvement_actions || [])) {
                        if (action.type === 'create_task') {
                            actions.push({
                                type: 'create_task',
                                payload: {
                                    title: action.title,
                                    description: action.description,
                                    priority: action.priority || 'P3',
                                },
                            });
                        } else if (action.type === 'create_ticket') {
                            actions.push({
                                type: 'create_ticket',
                                payload: {
                                    title: action.title,
                                    body: action.description,
                                    priority: action.priority || 'P3',
                                    creator: 'Observation Agent',
                                },
                            });
                        }
                    }

                    const obsCount = parsed.observations.length;
                    const criticalCount = parsed.observations.filter((o: { severity: string }) => o.severity === 'critical').length;
                    const healthScore = parsed.health_score || 'N/A';

                    this.database.addAuditLog(this.name, 'observation_report',
                        `Health: ${healthScore}/100. ${obsCount} observations (${criticalCount} critical). Trend: ${parsed.trend || 'stable'}`);

                    return {
                        content: `System Health: ${healthScore}/100 (${parsed.trend || 'stable'})\n\n${parsed.observation_summary || ''}\n\n${obsCount} observations found (${criticalCount} critical).`,
                        actions,
                        confidence: parsed.health_score,
                    };
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`Observation parse error: ${error}`);
        }

        return { content, actions };
    }

    /**
     * Run a comprehensive system review using real data from the database.
     */
    async runReview(): Promise<AgentResponse> {
        // Gather real system data for the review
        const allTasks = this.database.getAllTasks();
        const recentAudit = this.database.getAuditLog(50);
        const allTickets = this.database.getAllTickets();

        const failedTasks = allTasks.filter(t => t.status === TaskStatus.Failed);
        const verifiedTasks = allTasks.filter(t => t.status === TaskStatus.Verified);
        const pendingTasks = allTasks.filter(t => t.status === TaskStatus.NotStarted);
        const inProgressTasks = allTasks.filter(t => t.status === TaskStatus.InProgress);

        const openTickets = allTickets.filter(t => t.status === 'open');
        const resolvedTickets = allTickets.filter(t => t.status === 'resolved');

        const taskHealthPct = allTasks.length > 0
            ? Math.round((verifiedTasks.length / allTasks.length) * 100) : 100;

        const systemData = [
            `System Status Report:`,
            `Tasks: ${allTasks.length} total, ${verifiedTasks.length} verified, ${failedTasks.length} failed, ${pendingTasks.length} pending, ${inProgressTasks.length} in progress`,
            `Task health: ${taskHealthPct}% verified`,
            `Tickets: ${allTickets.length} total, ${openTickets.length} open, ${resolvedTickets.length} resolved`,
            '',
            failedTasks.length > 0 ? `Failed tasks:\n${failedTasks.slice(0, 10).map(t => `  - "${t.title}" (${t.priority}): ${t.acceptance_criteria}`).join('\n')}` : 'No failed tasks.',
            '',
            `Recent audit activity (last 50 entries):`,
            recentAudit.slice(0, 20).map(a => `  - [${a.agent}] ${a.action}: ${a.detail}`).join('\n'),
        ].join('\n');

        const context: AgentContext = { conversationHistory: [] };
        return this.processMessage(
            `Review the current system state and provide improvement observations:\n\n${systemData}`,
            context
        );
    }
}
