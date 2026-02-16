import { BaseAgent } from './base-agent';
import {
    AgentType, AgentContext, AgentResponse, AgentAction,
    TaskStatus, VerificationStatus
} from '../types';
import { TestRunnerService, TestRunResult } from '../core/test-runner';

export class VerificationAgent extends BaseAgent {
    readonly name = 'Verification Team';
    readonly type = AgentType.Verification;
    private testRunner: TestRunnerService | null = null;

    setTestRunner(runner: TestRunnerService): void {
        this.testRunner = runner;
    }
    readonly systemPrompt = `You are the Verification Team agent for the Copilot Orchestration Extension (COE).

## Your ONE Job
Compare completed work against acceptance criteria and real test results. Produce a structured pass/fail verdict with evidence. NEVER guess or hallucinate test results — use ONLY the real test output provided to you.

## Verification Process (follow these steps in order)
1. Read the task's acceptance criteria
2. Read the list of files modified
3. Read the real test output (provided in your prompt — if none provided, set test_results to null)
4. For each acceptance criterion, determine: met / not_met / unclear
5. If ANY criterion is "not_met", the overall status is "failed"
6. If ALL criteria are "met", the overall status is "passed"
7. If any criterion is "unclear" and none are "not_met", the overall status is "needs_recheck"

## Rules
- NEVER set status to "passed" if ANY criterion is "not_met"
- NEVER invent test results. If no test runner output is provided, set "test_results" to null.
- Follow-up task titles MUST use format: "Fix: [original task title] — [unmet criterion]"
- Each follow-up task MUST specify which criterion was not met and what needs to change
- For UI tasks: check colors, spacing, fonts, and responsive breakpoints against the design system

## Intelligent Task Requirements
If the task includes a "task_requirements" object, use it for enhanced verification:
1. **minimum_requirements**: Check each required item. ALL must be satisfied for "passed".
2. **passing_criteria**: Verify each criterion using its specified verification_method. Items with must_pass=true are mandatory.
3. **gotchas**: Review each gotcha and verify the implementation avoids these pitfalls.
4. **definition_of_done**: Use as the ultimate pass/fail benchmark.
5. **pre_completion_checklist**: Verify every checklist item has been addressed.

Add these to your criteria_results output — each requirement becomes a criterion to check.

## Required JSON Output Format
Respond with ONLY valid JSON. No markdown, no explanation, no text before or after.

{
  "status": "passed|failed|needs_recheck",
  "criteria_results": [
    {
      "criterion_text": "The exact acceptance criterion text",
      "status": "met|not_met|unclear",
      "evidence": "Specific evidence: file path + line number, test name, or observation"
    }
  ],
  "test_results": {
    "passed": 8,
    "failed": 0,
    "skipped": 0,
    "coverage": 87.5
  },
  "follow_up_tasks": [
    {
      "title": "Fix: [task title] — [unmet criterion]",
      "description": "What specifically needs to change and where",
      "priority": "P1"
    }
  ],
  "summary": "One sentence: what passed, what failed, what to do next"
}

## Example: Passed
{
  "status": "passed",
  "criteria_results": [
    {
      "criterion_text": "GET /health returns {status: 'ok', uptime: number} with HTTP 200",
      "status": "met",
      "evidence": "src/mcp/server.ts line 55 implements GET /health. Test 'health endpoint returns 200' passes."
    }
  ],
  "test_results": { "passed": 3, "failed": 0, "skipped": 0, "coverage": 92 },
  "follow_up_tasks": [],
  "summary": "All acceptance criteria met. 3 tests pass with 92% coverage."
}

## Example: Failed
{
  "status": "failed",
  "criteria_results": [
    {
      "criterion_text": "Login form validates email format before submission",
      "status": "not_met",
      "evidence": "src/components/LoginForm.tsx has no email validation regex. Form submits with invalid email."
    }
  ],
  "test_results": null,
  "follow_up_tasks": [
    {
      "title": "Fix: Create login form — email validation missing",
      "description": "Add email regex validation in LoginForm.tsx before form submission. Pattern: /^[^@]+@[^@]+\\.[^@]+$/",
      "priority": "P1"
    }
  ],
  "summary": "Failed: email validation not implemented. 1 follow-up task created."
}

## Escalation & Support (v7.0)
If you cannot verify because information is missing or test environments aren't set up:
- **escalate_to_boss**: Return ticket to Boss AI with reason. Use when verification is blocked.
- **call_support_agent**: Call a support agent for help:
  - answer (sync): Quick lookups about project setup
  - research (async): Gather documentation needed for verification
  - clarity (sync): Clarify ambiguous acceptance criteria
  - decision_memory (sync): Check past verification decisions

Include actions as a JSON array under an "actions" key alongside your normal JSON output.`;

    async processMessage(message: string, context: AgentContext): Promise<AgentResponse> {
        // Before LLM call: run actual tests on files_modified if test runner is available
        let testResultAppendix = '';
        if (this.testRunner && context.task?.files_modified?.length) {
            try {
                this.outputChannel.appendLine(`Running tests for files: ${context.task.files_modified.join(', ')}`);
                const result: TestRunResult = await this.testRunner.runTestsForFiles(context.task.files_modified);
                testResultAppendix = [
                    '\n\n--- REAL TEST RUNNER OUTPUT ---',
                    `Passed: ${result.passed}`,
                    `Failed: ${result.failed}`,
                    `Skipped: ${result.skipped}`,
                    `Coverage: ${result.coverage !== null ? result.coverage + '%' : 'N/A'}`,
                    `Duration: ${result.duration}ms`,
                    `Success: ${result.success}`,
                    '',
                    'Raw output (first 2000 chars):',
                    result.rawOutput.substring(0, 2000),
                    '--- END TEST OUTPUT ---',
                ].join('\n');
            } catch (error) {
                this.outputChannel.appendLine(`Test runner failed: ${error}`);
                testResultAppendix = '\n\n--- TEST RUNNER OUTPUT ---\nTest runner failed to execute. Set test_results to null in your response.\n--- END TEST OUTPUT ---';
            }
        } else if (!this.testRunner) {
            testResultAppendix = '\n\n--- TEST RUNNER OUTPUT ---\nNo test runner configured. Set test_results to null in your response.\n--- END TEST OUTPUT ---';
        }

        // Inject intelligent task requirements into the verification prompt
        let requirementsAppendix = '';
        if (context.task?.task_requirements) {
            try {
                const reqs = JSON.parse(context.task.task_requirements);
                requirementsAppendix = '\n\n--- INTELLIGENT TASK REQUIREMENTS ---\n';
                if (reqs.minimum_requirements?.length) {
                    requirementsAppendix += 'MINIMUM REQUIREMENTS (ALL must be met):\n';
                    for (const req of reqs.minimum_requirements) {
                        requirementsAppendix += `  - [${req.required ? 'REQUIRED' : 'OPTIONAL'}] ${req.item}${req.verification ? ' (verify: ' + req.verification + ')' : ''}\n`;
                    }
                }
                if (reqs.passing_criteria?.length) {
                    requirementsAppendix += '\nPASSING CRITERIA:\n';
                    for (const pc of reqs.passing_criteria) {
                        requirementsAppendix += `  - [${pc.must_pass ? 'MUST PASS' : 'OPTIONAL'}] ${pc.criterion} (method: ${pc.verification_method})\n`;
                    }
                }
                if (reqs.gotchas?.length) {
                    requirementsAppendix += '\nGOTCHAS TO CHECK:\n';
                    for (const g of reqs.gotchas) {
                        requirementsAppendix += `  - ${g}\n`;
                    }
                }
                if (reqs.definition_of_done) {
                    requirementsAppendix += `\nDEFINITION OF DONE: ${reqs.definition_of_done}\n`;
                }
                if (reqs.pre_completion_checklist?.length) {
                    requirementsAppendix += '\nPRE-COMPLETION CHECKLIST:\n';
                    for (const item of reqs.pre_completion_checklist) {
                        requirementsAppendix += `  - ${item}\n`;
                    }
                }
                requirementsAppendix += '--- END REQUIREMENTS ---';
            } catch { /* ignore parse errors */ }
        }

        const enhancedMessage = message + testResultAppendix + requirementsAppendix;
        return super.processMessage(enhancedMessage, context);
    }

    protected async parseResponse(content: string, context: AgentContext): Promise<AgentResponse> {
        const actions: AgentAction[] = [];

        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch && context.task) {
                const parsed = JSON.parse(jsonMatch[0]);

                // Determine status from parsed response
                const status = parsed.status === 'passed' ? VerificationStatus.Passed
                    : parsed.status === 'needs_recheck' ? VerificationStatus.NeedsReCheck
                    : VerificationStatus.Failed;

                // Safety check: if any criteria_result is "not_met", force status to Failed
                // (prevents LLM from incorrectly marking as passed)
                let finalStatus = status;
                if (parsed.criteria_results && Array.isArray(parsed.criteria_results)) {
                    const hasNotMet = parsed.criteria_results.some(
                        (cr: { status: string }) => cr.status === 'not_met'
                    );
                    if (hasNotMet && finalStatus === VerificationStatus.Passed) {
                        finalStatus = VerificationStatus.Failed;
                        this.outputChannel.appendLine(
                            `Verification override: LLM said passed but criteria has not_met items — forcing to failed`
                        );
                    }
                }

                // Update verification result in DB
                const verResult = this.database.createVerificationResult(context.task.id);
                this.database.updateVerificationResult(
                    verResult.id,
                    finalStatus,
                    JSON.stringify(parsed),
                    parsed.test_results ? JSON.stringify(parsed.test_results) : undefined,
                    parsed.test_results?.coverage ?? null
                );

                // Update task status
                if (finalStatus === VerificationStatus.Passed) {
                    this.database.updateTask(context.task.id, { status: TaskStatus.Verified });
                    this.database.addAuditLog(this.name, 'verification_passed',
                        `Task "${context.task.title}" verified`);
                } else if (finalStatus === VerificationStatus.Failed) {
                    this.database.updateTask(context.task.id, { status: TaskStatus.Failed });
                    this.database.addAuditLog(this.name, 'verification_failed',
                        `Task "${context.task.title}" failed verification`);
                } else {
                    this.database.updateTask(context.task.id, { status: TaskStatus.NeedsReCheck });
                }

                // Create follow-up tasks for each unmet criterion
                if (parsed.follow_up_tasks && Array.isArray(parsed.follow_up_tasks)) {
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

                // Build summary from criteria_results if available
                let summary = parsed.summary || 'See details';
                if (parsed.criteria_results && Array.isArray(parsed.criteria_results)) {
                    const met = parsed.criteria_results.filter((cr: { status: string }) => cr.status === 'met').length;
                    const total = parsed.criteria_results.length;
                    summary = `${met}/${total} criteria met. ${summary}`;
                }

                return {
                    content: `Verification ${parsed.status}: ${summary}`,
                    actions,
                };
            }
        } catch (error) {
            this.outputChannel.appendLine(`Verification parse error: ${error}`);
        }

        return { content, actions };
    }
}
