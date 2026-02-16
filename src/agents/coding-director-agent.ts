/**
 * CodingDirectorAgent — Interface to external coding agent (v7.0)
 *
 * Manages the bridge between the internal COE orchestration system and
 * the external coding agent (accessed via MCP on port 3030).
 *
 * Responsibilities:
 * - Prepare coding tasks with full context for the external agent
 * - Verify prerequisites are met before sending work
 * - Process results coming back from the external agent
 * - Call support agents for missing info before coding starts
 * - Track coding queue status for the webapp Coding tab
 */

import { BaseAgent } from './base-agent';
import { AgentType, AgentContext, AgentResponse, Ticket } from '../types';

export interface PreparedCodingTask {
    taskId: string;
    title: string;
    description: string;
    acceptanceCriteria: string;
    filesContext: string[];
    planContext: string | null;
    supportDocs: string | null;
    priority: string;
    estimatedMinutes: number;
    prerequisitesMet: boolean;
    missingPrerequisites: string[];
}

export class CodingDirectorAgent extends BaseAgent {
    readonly name = 'Coding Director';
    readonly type = AgentType.CodingDirector;
    readonly systemPrompt = `You are the Coding Director for the Copilot Orchestration Extension (COE).

## Your ONE Job
You manage the interface between the COE orchestration system and the external coding agent.
You prepare coding tasks with full context, verify prerequisites are met,
and process results coming back from the external agent.

## When You Activate
- A ticket with operation_type = 'code_generation' arrives in your queue
- The MCP server calls getNextTask for the external agent
- The external agent reports task completion via reportTaskDone

## What You Do
1. **Pre-flight Check**: Before a coding task goes to the external agent:
   - Verify all dependencies are resolved
   - Verify acceptance criteria are clear and actionable
   - Verify required context documents are available
   - If anything is missing, call support agents to gather info first

2. **Context Packaging**: Build a comprehensive context bundle:
   - Task title, description, acceptance criteria
   - Relevant plan files and design documents
   - Related support documentation
   - Previous attempt history (if retry)
   - File paths that will be modified

3. **Result Processing**: When the external agent completes:
   - Parse the completion report
   - Validate claimed files_modified exist
   - Route to verification queue

## Response Format
Respond with valid JSON:
{
  "status": "ready" | "blocked" | "needs_info",
  "task_summary": "Brief description of what needs to be coded",
  "context_quality": 0-100,
  "prerequisites_met": true | false,
  "missing_items": ["list of missing prerequisites"],
  "prepared_context": "Full context string for the external agent",
  "actions": []
}

## Support Agents Available
- answer (sync): Quick lookups about project setup, existing code
- research (async): Gather documentation needed for coding tasks
- clarity (sync): Rewrite unclear specs into actionable requirements
- decision_memory (sync): Check past decisions about implementation choices

## Escalation
If you cannot prepare a coding task because:
- The acceptance criteria are too vague → call clarity agent
- Design decisions haven't been made → call decision_memory or escalate to Boss
- Required files/APIs don't exist yet → escalate to Boss with blocker info
- Multiple conflicting requirements → escalate to Boss for resolution`;

    /** Track current coding task for status queries */
    private currentTask: { id: string; title: string } | null = null;

    /**
     * Get the current coding queue status for the webapp.
     */
    getQueueStatus(): { hasPendingTask: boolean; currentTask?: string } {
        return {
            hasPendingTask: this.currentTask !== null,
            currentTask: this.currentTask?.title,
        };
    }

    /**
     * Prepare a ticket for the external coding agent.
     * Performs pre-flight checks and builds comprehensive context.
     */
    prepareForExternalAgent(ticket: Ticket): PreparedCodingTask {
        const missingPrerequisites: string[] = [];

        // Check acceptance criteria
        if (!ticket.acceptance_criteria || ticket.acceptance_criteria.trim().length < 10) {
            missingPrerequisites.push('Acceptance criteria missing or too vague');
        }

        // Check if ticket body has enough detail
        if (!ticket.body || ticket.body.trim().length < 20) {
            missingPrerequisites.push('Task description too brief for coding');
        }

        // Check blocking tickets
        if (ticket.blocking_ticket_id) {
            const blocker = this.database.getTicket(ticket.blocking_ticket_id);
            if (blocker && blocker.status !== 'resolved') {
                missingPrerequisites.push(`Blocked by unresolved ticket TK-${blocker.ticket_number}: ${blocker.title}`);
            }
        }

        // Gather plan context if available
        let planContext: string | null = null;
        if (ticket.task_id) {
            const task = this.database.getTask(ticket.task_id);
            if (task?.plan_id) {
                planContext = this.database.getPlanFileContext(task.plan_id) ?? null;
            }
        }

        // Track current task
        this.currentTask = { id: ticket.id, title: ticket.title };

        return {
            taskId: ticket.id,
            title: ticket.title,
            description: ticket.body || ticket.title,
            acceptanceCriteria: ticket.acceptance_criteria || '',
            filesContext: [],  // Will be populated from design documents
            planContext,
            supportDocs: null,  // Will be populated by DocumentManager
            priority: ticket.priority,
            estimatedMinutes: 30,
            prerequisitesMet: missingPrerequisites.length === 0,
            missingPrerequisites,
        };
    }

    /**
     * Process results from the external coding agent.
     * Validates the completion report and updates tracking.
     */
    processExternalResult(
        taskId: string,
        result: { summary: string; filesModified: string[]; success: boolean }
    ): AgentResponse {
        // Clear current task
        if (this.currentTask?.id === taskId) {
            this.currentTask = null;
        }

        if (result.success) {
            this.database.addAuditLog(
                this.name,
                'external_task_completed',
                `External agent completed task ${taskId}: ${result.summary}`
            );

            return {
                content: `External coding agent completed task ${taskId}.\n` +
                    `Summary: ${result.summary}\n` +
                    `Files modified: ${result.filesModified.join(', ')}`,
                actions: [],
            };
        } else {
            this.database.addAuditLog(
                this.name,
                'external_task_failed',
                `External agent failed task ${taskId}: ${result.summary}`
            );

            return {
                content: `External coding agent failed task ${taskId}.\n` +
                    `Reason: ${result.summary}`,
                actions: [{
                    type: 'escalate_to_boss',
                    payload: {
                        ticket_id: taskId,
                        reason: `External coding agent failed: ${result.summary}`,
                        recommended_target: null,
                    },
                }],
            };
        }
    }

    protected async parseResponse(content: string, context: AgentContext): Promise<AgentResponse> {
        // Try to parse JSON response
        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);

                return {
                    content: parsed.prepared_context || parsed.task_summary || content,
                    actions: parsed.actions || [],
                    confidence: parsed.context_quality ?? 80,
                };
            }
        } catch {
            // JSON parse failed — return raw content
        }

        return {
            content,
            actions: [],
        };
    }
}
