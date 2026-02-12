import { BaseAgent } from './base-agent';
import {
    AgentType, AgentContext, AgentResponse, AgentAction,
    TaskStatus, VerificationStatus
} from '../types';

export class VerificationAgent extends BaseAgent {
    readonly name = 'Verification Team';
    readonly type = AgentType.Verification;
    readonly systemPrompt = `You are the Verification Team agent for COE. Your role:
1. Compare completed work against plan acceptance criteria
2. Analyze test results and coverage
3. For UI changes: check against design system references
4. Report what's DONE (matches) and what's REMAINING (gaps)
5. Create follow-up tasks for any gaps found

Respond in JSON format:
{
  "status": "passed|failed|needs_recheck",
  "criteria_met": ["list of met criteria"],
  "criteria_missing": ["list of unmet criteria"],
  "test_results": {
    "passed": number,
    "failed": number,
    "coverage": number
  },
  "follow_up_tasks": [
    { "title": "string", "description": "string", "priority": "P1|P2|P3" }
  ],
  "summary": "string"
}`;

    protected async parseResponse(content: string, context: AgentContext): Promise<AgentResponse> {
        const actions: AgentAction[] = [];

        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch && context.task) {
                const parsed = JSON.parse(jsonMatch[0]);

                // Update verification result in DB
                const verResult = this.database.createVerificationResult(context.task.id);
                const status = parsed.status === 'passed' ? VerificationStatus.Passed
                    : parsed.status === 'needs_recheck' ? VerificationStatus.NeedsReCheck
                    : VerificationStatus.Failed;

                this.database.updateVerificationResult(
                    verResult.id,
                    status,
                    JSON.stringify(parsed),
                    parsed.test_results ? JSON.stringify(parsed.test_results) : undefined,
                    parsed.test_results?.coverage
                );

                // Update task status
                if (status === VerificationStatus.Passed) {
                    this.database.updateTask(context.task.id, { status: TaskStatus.Verified });
                    this.database.addAuditLog(this.name, 'verification_passed',
                        `Task "${context.task.title}" verified`);
                } else if (status === VerificationStatus.Failed) {
                    this.database.updateTask(context.task.id, { status: TaskStatus.Failed });
                    this.database.addAuditLog(this.name, 'verification_failed',
                        `Task "${context.task.title}" failed verification`);
                } else {
                    this.database.updateTask(context.task.id, { status: TaskStatus.NeedsReCheck });
                }

                // Create follow-up tasks
                if (parsed.follow_up_tasks) {
                    for (const ft of parsed.follow_up_tasks) {
                        this.database.createTask({
                            title: ft.title,
                            description: ft.description || '',
                            priority: ft.priority || 'P1',
                            plan_id: context.task.plan_id,
                            dependencies: [context.task.id],
                        });
                        actions.push({
                            type: 'create_task',
                            payload: { title: ft.title },
                        });
                    }
                }

                return {
                    content: `Verification ${parsed.status}: ${parsed.summary || 'See details'}`,
                    actions,
                };
            }
        } catch (error) {
            this.outputChannel.appendLine(`Verification parse error: ${error}`);
        }

        return { content, actions };
    }
}
