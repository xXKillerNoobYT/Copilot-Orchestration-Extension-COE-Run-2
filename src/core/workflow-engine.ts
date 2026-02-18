/**
 * WorkflowEngine — Workflow Execution Engine (v9.0)
 *
 * Executes workflow definitions step by step with:
 *   - Linear step sequences
 *   - Conditional branching (safe AST-based evaluator, NO arbitrary code execution)
 *   - Parallel step execution
 *   - User approval gates
 *   - Tool unlock/revoke per step
 *   - Escalation triggers
 *   - Retry with configurable delay
 *   - Crash recovery (state persisted after every step)
 *
 * Safety:
 *   - Max 1000 steps per execution (prevents infinite loops)
 *   - Loop detection via visited-step tracking
 *   - Condition evaluator uses recursive descent parser → AST → recursive evaluator
 *   - Zero use of Function constructor or similar dynamic code execution
 */

import { Database } from './database';
import { EventBus } from './event-bus';
import { ConfigManager } from './config';
import {
    WorkflowDefinition, WorkflowStep, WorkflowExecution, WorkflowStepResult,
    WorkflowStepType, WorkflowStatus, WorkflowExecutionStatus,
    ConditionNode
} from '../types';

export interface OutputChannelLike {
    appendLine(msg: string): void;
}

/**
 * Callback for executing an agent call during workflow execution.
 * The workflow engine doesn't directly call agents — it delegates via this callback.
 */
export type AgentCallExecutor = (
    agentType: string,
    prompt: string,
    context?: Record<string, unknown>
) => Promise<{ content: string; tokens_used: number }>;

/**
 * Callback for requesting user approval during workflow execution.
 */
export type ApprovalRequester = (
    executionId: string,
    stepId: string,
    description: string
) => Promise<void>;

/** Maximum steps per execution to prevent infinite loops */
const MAX_STEPS_PER_EXECUTION = 1000;

export class WorkflowEngine {
    private agentCallExecutor: AgentCallExecutor | null = null;
    private approvalRequester: ApprovalRequester | null = null;

    constructor(
        private database: Database,
        private eventBus: EventBus,
        private config: ConfigManager,
        private outputChannel: OutputChannelLike
    ) {}

    /**
     * Set the callback for executing agent calls.
     * Must be set before executing workflows that contain agent_call steps.
     */
    setAgentCallExecutor(executor: AgentCallExecutor): void {
        this.agentCallExecutor = executor;
    }

    /**
     * Set the callback for requesting user approvals.
     * Must be set before executing workflows with user_approval steps.
     */
    setApprovalRequester(requester: ApprovalRequester): void {
        this.approvalRequester = requester;
    }

    // ==================== EXECUTION LIFECYCLE ====================

    /**
     * Start executing a workflow.
     *
     * @param workflowId The workflow definition to execute
     * @param triggerId Ticket or task ID that triggered this execution
     * @param variables Initial variables for the execution context
     * @returns The created execution record
     */
    startExecution(
        workflowId: string,
        triggerId: string,
        variables: Record<string, unknown> = {}
    ): WorkflowExecution {
        const workflow = this.database.getWorkflowDefinition(workflowId);
        if (!workflow) {
            throw new Error(`Workflow ${workflowId} not found`);
        }

        if (workflow.status !== WorkflowStatus.Active) {
            throw new Error(`Workflow ${workflowId} is not active (status: ${workflow.status})`);
        }

        // Find the first step (lowest sort_order)
        const steps = this.database.getWorkflowSteps(workflowId);
        if (steps.length === 0) {
            throw new Error(`Workflow ${workflowId} has no steps`);
        }

        const firstStep = steps.sort((a: WorkflowStep, b: WorkflowStep) => a.sort_order - b.sort_order)[0];

        const execution = this.database.createWorkflowExecution({
            workflow_id: workflowId,
            ticket_id: triggerId,
            variables: variables,
        });

        // Set the current step and status to Running (createWorkflowExecution defaults to Pending)
        this.database.updateWorkflowExecution(execution.id, {
            current_step_id: firstStep.id,
            status: WorkflowExecutionStatus.Running,
        });

        const updatedExecution = this.database.getWorkflowExecution(execution.id)!;

        this.outputChannel.appendLine(
            `[WorkflowEngine] Started execution ${updatedExecution.id} for workflow "${workflow.name}" (trigger: ${triggerId})`
        );

        this.eventBus.emit('workflow:execution_started', 'WorkflowEngine', {
            executionId: updatedExecution.id,
            workflowId,
            workflowName: workflow.name,
            triggerId,
            firstStepId: firstStep.id,
        });

        return updatedExecution;
    }

    /**
     * Execute the next step in a workflow execution.
     * This is the main execution loop entry point — call repeatedly until done.
     *
     * @returns The step result, or null if execution is complete/waiting
     */
    async executeNextStep(executionId: string): Promise<WorkflowStepResult | null> {
        const execution = this.database.getWorkflowExecution(executionId);
        if (!execution) {
            throw new Error(`Execution ${executionId} not found`);
        }

        if (execution.status !== WorkflowExecutionStatus.Running) {
            return null; // Not running (paused, completed, failed, etc.)
        }

        if (!execution.current_step_id) {
            // No more steps — execution complete
            this.completeExecution(executionId);
            return null;
        }

        // Safety: check step count
        const existingResults = this.database.getWorkflowStepResults(executionId);
        if (existingResults.length >= MAX_STEPS_PER_EXECUTION) {
            this.failExecution(executionId, `Max steps exceeded (${MAX_STEPS_PER_EXECUTION})`);
            return null;
        }

        // Loop detection
        const variables = this.parseVariables(execution.variables_json);
        const visitedSteps = (variables.__visited_steps as string[]) ?? [];
        const visitCount = visitedSteps.filter(id => id === execution.current_step_id).length;
        if (visitCount > 10) {
            this.failExecution(executionId, `Loop detected: step ${execution.current_step_id} visited ${visitCount} times`);
            return null;
        }

        const step = this.database.getWorkflowStep(execution.current_step_id);
        if (!step) {
            this.failExecution(executionId, `Step ${execution.current_step_id} not found`);
            return null;
        }

        // Track visited steps
        visitedSteps.push(step.id);
        variables.__visited_steps = visitedSteps;

        this.outputChannel.appendLine(
            `[WorkflowEngine] Executing step "${step.label}" (${step.step_type}) in execution ${executionId}`
        );

        this.eventBus.emit('workflow:step_started', 'WorkflowEngine', {
            executionId,
            stepId: step.id,
            stepType: step.step_type,
            label: step.label,
        });

        const startTime = Date.now();
        let result: WorkflowStepResult;

        try {
            result = await this.executeStep(execution, step, variables);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            result = {
                step_id: step.id,
                status: WorkflowExecutionStatus.Failed,
                agent_response: null,
                acceptance_check: null,
                retries: 0,
                duration_ms: Date.now() - startTime,
                tokens_used: 0,
                error: errorMsg,
            };
        }

        result.duration_ms = Date.now() - startTime;

        // Store result
        this.database.createWorkflowStepResult({
            execution_id: executionId,
            step_id: step.id,
            status: result.status,
            agent_response: result.agent_response ?? undefined,
            acceptance_check: result.acceptance_check ?? undefined,
            retries: result.retries,
            duration_ms: result.duration_ms,
            tokens_used: result.tokens_used,
            error: result.error ?? undefined,
        });

        // Update execution variables and token count
        this.database.updateWorkflowExecution(executionId, {
            variables_json: JSON.stringify(variables),
            tokens_consumed: (execution.tokens_consumed ?? 0) + result.tokens_used,
        });

        // Determine next step
        if (result.status === WorkflowExecutionStatus.Completed) {
            const nextStepId = this.determineNextStep(step, result, variables);
            if (nextStepId) {
                this.database.updateWorkflowExecution(executionId, {
                    current_step_id: nextStepId,
                });
            } else {
                this.completeExecution(executionId);
            }

            this.eventBus.emit('workflow:step_completed', 'WorkflowEngine', {
                executionId,
                stepId: step.id,
                label: step.label,
                nextStepId,
                durationMs: result.duration_ms,
            });
        } else if (result.status === WorkflowExecutionStatus.WaitingApproval) {
            this.database.updateWorkflowExecution(executionId, {
                status: WorkflowExecutionStatus.WaitingApproval,
            });
        } else if (result.status === WorkflowExecutionStatus.Failed) {
            // Check retry
            if (result.retries < step.max_retries) {
                // Will retry on next executeNextStep() call
                this.outputChannel.appendLine(
                    `[WorkflowEngine] Step "${step.label}" failed, will retry (${result.retries}/${step.max_retries})`
                );
            } else if (step.escalation_step_id) {
                // Escalate to designated step
                this.database.updateWorkflowExecution(executionId, {
                    current_step_id: step.escalation_step_id,
                });
                this.eventBus.emit('workflow:escalation_triggered', 'WorkflowEngine', {
                    executionId,
                    failedStepId: step.id,
                    escalationStepId: step.escalation_step_id,
                });
            } else {
                this.failExecution(executionId, `Step "${step.label}" failed after ${result.retries} retries: ${result.error}`);
            }

            this.eventBus.emit('workflow:step_failed', 'WorkflowEngine', {
                executionId,
                stepId: step.id,
                label: step.label,
                error: result.error,
                retries: result.retries,
            });
        }

        return result;
    }

    /**
     * Run an execution to completion (or until it blocks on approval/failure).
     * Convenience method that calls executeNextStep() in a loop.
     */
    async runToCompletion(executionId: string): Promise<WorkflowExecution> {
        let stepCount = 0;
        while (stepCount < MAX_STEPS_PER_EXECUTION) {
            const execution = this.database.getWorkflowExecution(executionId);
            if (!execution || execution.status !== WorkflowExecutionStatus.Running) {
                break;
            }

            const result = await this.executeNextStep(executionId);
            if (!result) break;
            stepCount++;
        }

        return this.database.getWorkflowExecution(executionId)!;
    }

    // ==================== STEP EXECUTION ====================

    /**
     * Execute a single step based on its type.
     */
    private async executeStep(
        execution: WorkflowExecution,
        step: WorkflowStep,
        variables: Record<string, unknown>
    ): Promise<WorkflowStepResult> {
        switch (step.step_type) {
            case WorkflowStepType.AgentCall:
                return this.executeAgentCall(step, variables);

            case WorkflowStepType.Condition:
                return this.executeCondition(step, variables);

            case WorkflowStepType.ParallelBranch:
                return this.executeParallelBranch(execution, step, variables);

            case WorkflowStepType.UserApproval:
                return this.executeUserApproval(execution, step);

            case WorkflowStepType.Escalation:
                return this.executeEscalation(step, variables);

            case WorkflowStepType.ToolUnlock:
                return this.executeToolUnlock(step, variables);

            case WorkflowStepType.Wait:
                return this.executeWait(step);

            case WorkflowStepType.Loop:
                return this.executeLoop(step, variables);

            case WorkflowStepType.SubWorkflow:
                return this.executeSubWorkflow(step, variables);

            default:
                return {
                    step_id: step.id,
                    status: WorkflowExecutionStatus.Failed,
                    agent_response: null,
                    acceptance_check: null,
                    retries: 0,
                    duration_ms: 0,
                    tokens_used: 0,
                    error: `Unknown step type: ${step.step_type}`,
                };
        }
    }

    /**
     * Execute an agent_call step.
     */
    private async executeAgentCall(
        step: WorkflowStep,
        variables: Record<string, unknown>
    ): Promise<WorkflowStepResult> {
        if (!this.agentCallExecutor) {
            return {
                step_id: step.id,
                status: WorkflowExecutionStatus.Failed,
                agent_response: null,
                acceptance_check: null,
                retries: 0,
                duration_ms: 0,
                tokens_used: 0,
                error: 'No agent call executor configured',
            };
        }

        if (!step.agent_type) {
            return {
                step_id: step.id,
                status: WorkflowExecutionStatus.Failed,
                agent_response: null,
                acceptance_check: null,
                retries: 0,
                duration_ms: 0,
                tokens_used: 0,
                error: 'Step has no agent_type configured',
            };
        }

        // Interpolate variables in the prompt
        const prompt = this.interpolateVariables(step.agent_prompt ?? '', variables);

        const response = await this.agentCallExecutor(step.agent_type, prompt, variables);

        // Store result in variables for subsequent steps
        variables.$result = response.content;
        variables.$tokens = response.tokens_used;

        // Check acceptance criteria
        let acceptanceCheck: boolean | null = null;
        if (step.acceptance_criteria) {
            const criteria = step.acceptance_criteria.toLowerCase();
            const responseLower = response.content.toLowerCase();
            // Simple keyword-based acceptance check
            acceptanceCheck = criteria.split(',').some(c => responseLower.includes(c.trim()));
        }

        return {
            step_id: step.id,
            status: acceptanceCheck === false ? WorkflowExecutionStatus.Failed : WorkflowExecutionStatus.Completed,
            agent_response: response.content,
            acceptance_check: acceptanceCheck,
            retries: 0,
            duration_ms: 0,
            tokens_used: response.tokens_used,
            error: acceptanceCheck === false ? 'Acceptance criteria not met' : null,
        };
    }

    /**
     * Execute a condition step using the safe AST-based evaluator.
     */
    private executeCondition(
        step: WorkflowStep,
        variables: Record<string, unknown>
    ): WorkflowStepResult {
        if (!step.condition_expression) {
            return {
                step_id: step.id,
                status: WorkflowExecutionStatus.Failed,
                agent_response: null,
                acceptance_check: null,
                retries: 0,
                duration_ms: 0,
                tokens_used: 0,
                error: 'Condition step has no expression',
            };
        }

        const conditionResult = this.evaluateCondition(step.condition_expression, variables);

        // Store condition result for use in determining next step
        variables.$conditionResult = conditionResult;

        this.eventBus.emit('workflow:condition_evaluated', 'WorkflowEngine', {
            stepId: step.id,
            expression: step.condition_expression,
            result: conditionResult,
        });

        return {
            step_id: step.id,
            status: WorkflowExecutionStatus.Completed,
            agent_response: `Condition evaluated: ${conditionResult}`,
            acceptance_check: null,
            retries: 0,
            duration_ms: 0,
            tokens_used: 0,
            error: null,
        };
    }

    /**
     * Execute parallel branch steps.
     */
    private async executeParallelBranch(
        execution: WorkflowExecution,
        step: WorkflowStep,
        variables: Record<string, unknown>
    ): Promise<WorkflowStepResult> {
        const parallelStepIds = step.parallel_step_ids ?? [];
        if (parallelStepIds.length === 0) {
            return {
                step_id: step.id,
                status: WorkflowExecutionStatus.Completed,
                agent_response: 'No parallel steps to execute',
                acceptance_check: null,
                retries: 0,
                duration_ms: 0,
                tokens_used: 0,
                error: null,
            };
        }

        // Execute all parallel steps concurrently
        const parallelResults = await Promise.allSettled(
            parallelStepIds.map(async (stepId) => {
                const parallelStep = this.database.getWorkflowStep(stepId);
                if (!parallelStep) {
                    throw new Error(`Parallel step ${stepId} not found`);
                }
                // Each parallel branch gets its own copy of variables
                const branchVariables = { ...variables };
                return this.executeStep(execution, parallelStep, branchVariables);
            })
        );

        // Aggregate results
        let totalTokens = 0;
        const errors: string[] = [];
        const responses: string[] = [];

        for (const result of parallelResults) {
            if (result.status === 'fulfilled') {
                totalTokens += result.value.tokens_used;
                if (result.value.agent_response) {
                    responses.push(result.value.agent_response);
                }
                if (result.value.error) {
                    errors.push(result.value.error);
                }
            } else {
                errors.push(result.reason?.message ?? 'Unknown error');
            }
        }

        variables.$parallelResults = responses;

        return {
            step_id: step.id,
            status: errors.length === 0 ? WorkflowExecutionStatus.Completed : WorkflowExecutionStatus.Failed,
            agent_response: responses.join('\n---\n'),
            acceptance_check: null,
            retries: 0,
            duration_ms: 0,
            tokens_used: totalTokens,
            error: errors.length > 0 ? errors.join('; ') : null,
        };
    }

    /**
     * Execute a user approval gate step.
     */
    private async executeUserApproval(
        execution: WorkflowExecution,
        step: WorkflowStep
    ): Promise<WorkflowStepResult> {
        if (this.approvalRequester) {
            await this.approvalRequester(execution.id, step.id, step.label);
        }

        this.eventBus.emit('workflow:user_approval_requested', 'WorkflowEngine', {
            executionId: execution.id,
            stepId: step.id,
            description: step.label,
        });

        return {
            step_id: step.id,
            status: WorkflowExecutionStatus.WaitingApproval,
            agent_response: `Waiting for user approval: ${step.label}`,
            acceptance_check: null,
            retries: 0,
            duration_ms: 0,
            tokens_used: 0,
            error: null,
        };
    }

    /**
     * Execute an escalation step.
     */
    private executeEscalation(
        step: WorkflowStep,
        variables: Record<string, unknown>
    ): WorkflowStepResult {
        this.eventBus.emit('workflow:escalation_triggered', 'WorkflowEngine', {
            stepId: step.id,
            label: step.label,
            variables: { $result: variables.$result, $status: variables.$status },
        });

        return {
            step_id: step.id,
            status: WorkflowExecutionStatus.Completed,
            agent_response: `Escalation triggered: ${step.label}`,
            acceptance_check: null,
            retries: 0,
            duration_ms: 0,
            tokens_used: 0,
            error: null,
        };
    }

    /**
     * Execute a tool unlock step.
     */
    private executeToolUnlock(
        step: WorkflowStep,
        variables: Record<string, unknown>
    ): WorkflowStepResult {
        const tools = step.tools_unlocked ?? [];
        variables.$unlockedTools = [
            ...((variables.$unlockedTools as string[]) ?? []),
            ...tools,
        ];

        this.eventBus.emit('workflow:tool_unlocked', 'WorkflowEngine', {
            stepId: step.id,
            tools,
        });

        return {
            step_id: step.id,
            status: WorkflowExecutionStatus.Completed,
            agent_response: `Tools unlocked: ${tools.join(', ')}`,
            acceptance_check: null,
            retries: 0,
            duration_ms: 0,
            tokens_used: 0,
            error: null,
        };
    }

    /**
     * Execute a wait step (timer-based delay).
     */
    private async executeWait(step: WorkflowStep): Promise<WorkflowStepResult> {
        const delayMs = step.retry_delay_ms ?? 1000;
        // Cap wait at 5 minutes to prevent hanging
        const cappedDelay = Math.min(delayMs, 300000);
        await new Promise(resolve => setTimeout(resolve, cappedDelay));

        return {
            step_id: step.id,
            status: WorkflowExecutionStatus.Completed,
            agent_response: `Waited ${cappedDelay}ms`,
            acceptance_check: null,
            retries: 0,
            duration_ms: cappedDelay,
            tokens_used: 0,
            error: null,
        };
    }

    /**
     * Execute a loop step (re-executes a target step).
     */
    private executeLoop(
        step: WorkflowStep,
        variables: Record<string, unknown>
    ): WorkflowStepResult {
        // Check loop condition
        if (step.condition_expression) {
            const shouldContinue = this.evaluateCondition(step.condition_expression, variables);
            if (!shouldContinue) {
                return {
                    step_id: step.id,
                    status: WorkflowExecutionStatus.Completed,
                    agent_response: 'Loop condition false — exiting loop',
                    acceptance_check: null,
                    retries: 0,
                    duration_ms: 0,
                    tokens_used: 0,
                    error: null,
                };
            }
        }

        // Increment loop counter
        const loopKey = `__loop_${step.id}`;
        const loopCount = ((variables[loopKey] as number) ?? 0) + 1;
        variables[loopKey] = loopCount;

        // Safety: max 100 iterations per loop
        if (loopCount > 100) {
            return {
                step_id: step.id,
                status: WorkflowExecutionStatus.Failed,
                agent_response: null,
                acceptance_check: null,
                retries: 0,
                duration_ms: 0,
                tokens_used: 0,
                error: `Loop exceeded 100 iterations`,
            };
        }

        return {
            step_id: step.id,
            status: WorkflowExecutionStatus.Completed,
            agent_response: `Loop iteration ${loopCount}`,
            acceptance_check: null,
            retries: 0,
            duration_ms: 0,
            tokens_used: 0,
            error: null,
        };
    }

    /**
     * Execute a sub-workflow step.
     */
    private async executeSubWorkflow(
        step: WorkflowStep,
        variables: Record<string, unknown>
    ): Promise<WorkflowStepResult> {
        // The agent_type field stores the sub-workflow ID for sub_workflow steps
        const subWorkflowId = step.agent_type;
        if (!subWorkflowId) {
            return {
                step_id: step.id,
                status: WorkflowExecutionStatus.Failed,
                agent_response: null,
                acceptance_check: null,
                retries: 0,
                duration_ms: 0,
                tokens_used: 0,
                error: 'Sub-workflow step has no workflow ID',
            };
        }

        try {
            const subExecution = this.startExecution(subWorkflowId, `sub:${step.id}`, { ...variables });
            const completedExecution = await this.runToCompletion(subExecution.id);

            variables.$subWorkflowResult = completedExecution.status;

            return {
                step_id: step.id,
                status: completedExecution.status === WorkflowExecutionStatus.Completed
                    ? WorkflowExecutionStatus.Completed
                    : WorkflowExecutionStatus.Failed,
                agent_response: `Sub-workflow completed with status: ${completedExecution.status}`,
                acceptance_check: null,
                retries: 0,
                duration_ms: 0,
                tokens_used: completedExecution.tokens_consumed ?? 0,
                error: completedExecution.status !== WorkflowExecutionStatus.Completed
                    ? `Sub-workflow failed: ${completedExecution.status}` : null,
            };
        } catch (err) {
            return {
                step_id: step.id,
                status: WorkflowExecutionStatus.Failed,
                agent_response: null,
                acceptance_check: null,
                retries: 0,
                duration_ms: 0,
                tokens_used: 0,
                error: `Sub-workflow error: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }

    // ==================== EXECUTION CONTROL ====================

    /**
     * Handle user approval for a waiting execution.
     */
    handleApproval(executionId: string, approved: boolean, notes?: string): void {
        const execution = this.database.getWorkflowExecution(executionId);
        if (!execution) {
            throw new Error(`Execution ${executionId} not found`);
        }

        if (execution.status !== WorkflowExecutionStatus.WaitingApproval) {
            throw new Error(`Execution ${executionId} is not waiting for approval`);
        }

        const variables = this.parseVariables(execution.variables_json);
        variables.$userApproved = approved;
        variables.$approvalNotes = notes ?? '';

        if (approved) {
            // Resume to next step
            const currentStep = execution.current_step_id ? this.database.getWorkflowStep(execution.current_step_id) : null;
            const nextStepId = currentStep?.next_step_id ?? null;

            this.database.updateWorkflowExecution(executionId, {
                status: WorkflowExecutionStatus.Running,
                current_step_id: nextStepId,
                variables_json: JSON.stringify(variables),
            });
        } else {
            // Rejected — fail the execution
            this.failExecution(executionId, `User rejected approval: ${notes ?? 'no reason given'}`);
        }

        this.eventBus.emit('workflow:user_approval_received', 'WorkflowEngine', {
            executionId,
            approved,
            notes,
        });
    }

    /**
     * Pause a running execution.
     */
    pauseExecution(executionId: string): void {
        this.database.updateWorkflowExecution(executionId, {
            status: WorkflowExecutionStatus.Pending, // Use Pending as "paused" state
        });

        this.eventBus.emit('workflow:paused', 'WorkflowEngine', { executionId });
    }

    /**
     * Resume a paused execution.
     */
    resumeExecution(executionId: string): void {
        this.database.updateWorkflowExecution(executionId, {
            status: WorkflowExecutionStatus.Running,
        });

        this.eventBus.emit('workflow:resumed', 'WorkflowEngine', { executionId });
    }

    /**
     * Cancel an execution.
     */
    cancelExecution(executionId: string, reason: string): void {
        this.database.updateWorkflowExecution(executionId, {
            status: WorkflowExecutionStatus.Cancelled,
            completed_at: new Date().toISOString(),
        });

        this.eventBus.emit('workflow:cancelled', 'WorkflowEngine', { executionId, reason });
    }

    /**
     * Get the current state of an execution.
     */
    getExecutionState(executionId: string): {
        execution: WorkflowExecution;
        steps: WorkflowStep[];
        results: WorkflowStepResult[];
    } | null {
        const execution = this.database.getWorkflowExecution(executionId);
        if (!execution) return null;

        const steps = this.database.getWorkflowSteps(execution.workflow_id);
        const results = this.database.getWorkflowStepResults(executionId);

        return { execution, steps, results };
    }

    // ==================== CRASH RECOVERY ====================

    /**
     * Find and resume executions that were running when the system crashed.
     * Called on startup to recover interrupted workflows.
     */
    async recoverPendingExecutions(): Promise<number> {
        const pending = this.database.getPendingWorkflowExecutions();
        let recovered = 0;

        for (const execution of pending) {
            if (execution.status === WorkflowExecutionStatus.Running) {
                this.outputChannel.appendLine(
                    `[WorkflowEngine] Recovering interrupted execution ${execution.id}`
                );

                try {
                    await this.runToCompletion(execution.id);
                    recovered++;
                } catch (err) {
                    this.outputChannel.appendLine(
                        `[WorkflowEngine] Recovery failed for ${execution.id}: ${err instanceof Error ? err.message : String(err)}`
                    );
                    this.failExecution(execution.id, `Recovery failed: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
        }

        if (recovered > 0) {
            this.outputChannel.appendLine(`[WorkflowEngine] Recovered ${recovered} interrupted executions`);
        }

        return recovered;
    }

    // ==================== SAFE CONDITION EVALUATOR ====================

    /**
     * Evaluate a condition expression safely using AST-based parsing.
     * NO use of Function constructor or similar dynamic code execution.
     *
     * Supported syntax:
     *   Comparisons: $score > 80, $status == 'completed', $retries < 3
     *   Logical: $score > 80 && $status == 'completed'
     *   String ops: $result.contains('success'), $name.startsWith('test')
     *   Negation: !$approved
     *   Variables: $result, $score, $status, $tokens, $retries, $userApproved
     *              $variables.* (custom workflow variables)
     *
     * @param expression The condition expression string
     * @param variables The execution variables context
     * @returns The boolean result of the evaluation
     */
    evaluateCondition(expression: string, variables: Record<string, unknown>): boolean {
        try {
            const ast = this.parseExpression(expression.trim());
            return this.evaluateAST(ast, variables);
        } catch (err) {
            this.outputChannel.appendLine(
                `[WorkflowEngine] Condition evaluation failed for "${expression}": ${err instanceof Error ? err.message : String(err)}`
            );
            return false;
        }
    }

    /**
     * Parse a condition expression into an AST (recursive descent parser).
     */
    private parseExpression(expr: string): ConditionNode {
        const tokens = this.tokenize(expr);
        const result = this.parseOr(tokens, 0);
        return result.node;
    }

    /**
     * Tokenize a condition expression string.
     */
    private tokenize(expr: string): string[] {
        const tokens: string[] = [];
        let i = 0;

        while (i < expr.length) {
            // Skip whitespace
            if (/\s/.test(expr[i])) { i++; continue; }

            // String literals
            if (expr[i] === "'" || expr[i] === '"') {
                const quote = expr[i];
                let str = '';
                i++; // skip opening quote
                while (i < expr.length && expr[i] !== quote) {
                    str += expr[i];
                    i++;
                }
                i++; // skip closing quote
                tokens.push(`'${str}'`);
                continue;
            }

            // Numbers
            if (/\d/.test(expr[i]) || (expr[i] === '-' && i + 1 < expr.length && /\d/.test(expr[i + 1]))) {
                let num = '';
                if (expr[i] === '-') { num += '-'; i++; }
                while (i < expr.length && (/\d/.test(expr[i]) || expr[i] === '.')) {
                    num += expr[i];
                    i++;
                }
                tokens.push(num);
                continue;
            }

            // Multi-char operators
            if (i + 1 < expr.length) {
                const two = expr[i] + expr[i + 1];
                if (['&&', '||', '==', '!=', '>=', '<='].includes(two)) {
                    tokens.push(two);
                    i += 2;
                    continue;
                }
            }

            // Single-char operators and punctuation
            if ('><!=().'.includes(expr[i])) {
                tokens.push(expr[i]);
                i++;
                continue;
            }

            // Variables ($name) and identifiers
            if (expr[i] === '$' || /[a-zA-Z_]/.test(expr[i])) {
                let id = '';
                while (i < expr.length && /[\w.$]/.test(expr[i])) {
                    id += expr[i];
                    i++;
                }
                tokens.push(id);
                continue;
            }

            // Unknown character — skip
            i++;
        }

        return tokens;
    }

    /**
     * Parse OR expression: expr || expr
     */
    private parseOr(tokens: string[], pos: number): { node: ConditionNode; pos: number } {
        let left = this.parseAnd(tokens, pos);

        while (left.pos < tokens.length && tokens[left.pos] === '||') {
            left.pos++; // skip ||
            const right = this.parseAnd(tokens, left.pos);
            left = {
                node: {
                    type: 'logical',
                    logical_op: '||',
                    left: left.node,
                    right: right.node,
                },
                pos: right.pos,
            };
        }

        return left;
    }

    /**
     * Parse AND expression: expr && expr
     */
    private parseAnd(tokens: string[], pos: number): { node: ConditionNode; pos: number } {
        let left = this.parseNot(tokens, pos);

        while (left.pos < tokens.length && tokens[left.pos] === '&&') {
            left.pos++; // skip &&
            const right = this.parseNot(tokens, left.pos);
            left = {
                node: {
                    type: 'logical',
                    logical_op: '&&',
                    left: left.node,
                    right: right.node,
                },
                pos: right.pos,
            };
        }

        return left;
    }

    /**
     * Parse NOT expression: !expr
     */
    private parseNot(tokens: string[], pos: number): { node: ConditionNode; pos: number } {
        if (pos < tokens.length && tokens[pos] === '!') {
            pos++; // skip !
            const inner = this.parseComparison(tokens, pos);
            return {
                node: { type: 'not', operand: inner.node },
                pos: inner.pos,
            };
        }
        return this.parseComparison(tokens, pos);
    }

    /**
     * Parse comparison: expr op expr (>, <, >=, <=, ==, !=)
     * Also handles string operations: $var.contains('x')
     */
    private parseComparison(tokens: string[], pos: number): { node: ConditionNode; pos: number } {
        const left = this.parsePrimary(tokens, pos);

        // Check for comparison operators
        if (left.pos < tokens.length) {
            const op = tokens[left.pos];
            if (['>', '<', '>=', '<=', '==', '!='].includes(op)) {
                left.pos++; // skip operator
                const right = this.parsePrimary(tokens, left.pos);
                return {
                    node: {
                        type: 'comparison',
                        operator: op,
                        left: left.node,
                        right: right.node,
                    },
                    pos: right.pos,
                };
            }
        }

        return left;
    }

    /**
     * Parse primary: literal, variable, parenthesized expression, or string op
     */
    private parsePrimary(tokens: string[], pos: number): { node: ConditionNode; pos: number } {
        if (pos >= tokens.length) {
            return { node: { type: 'literal', value: false }, pos };
        }

        const token = tokens[pos];

        // Parenthesized expression
        if (token === '(') {
            pos++; // skip (
            const inner = this.parseOr(tokens, pos);
            if (inner.pos < tokens.length && tokens[inner.pos] === ')') {
                inner.pos++; // skip )
            }
            return inner;
        }

        // Boolean literals
        if (token === 'true') {
            return { node: { type: 'literal', value: true }, pos: pos + 1 };
        }
        if (token === 'false') {
            return { node: { type: 'literal', value: false }, pos: pos + 1 };
        }

        // String literal
        if (token.startsWith("'") && token.endsWith("'")) {
            return { node: { type: 'literal', value: token.slice(1, -1) }, pos: pos + 1 };
        }

        // Number literal
        if (/^-?\d+(\.\d+)?$/.test(token)) {
            return { node: { type: 'literal', value: parseFloat(token) }, pos: pos + 1 };
        }

        // Variable (starts with $)
        if (token.startsWith('$')) {
            // Check for string operations: $var.contains('x'), $var.startsWith('x'), $var.endsWith('x')
            // The tokenizer may absorb the dot into the token (e.g. "$result.contains" as one token)
            // so we check both styles: split tokens AND single-token with embedded method.
            for (const method of ['contains', 'startsWith', 'endsWith']) {
                const dotMethod = `.${method}`;
                if (token.endsWith(dotMethod)) {
                    // Single-token style: $var.method — extract the variable part
                    const varName = token.slice(0, token.length - dotMethod.length);
                    let argPos = pos + 1; // past the combined token
                    if (argPos < tokens.length && tokens[argPos] === '(') {
                        argPos++; // skip (
                        const argResult = this.parsePrimary(tokens, argPos);
                        if (argResult.pos < tokens.length && tokens[argResult.pos] === ')') {
                            argResult.pos++;
                        }
                        return {
                            node: {
                                type: 'string_op',
                                string_op: method,
                                left: { type: 'variable', variable: varName },
                                right: argResult.node,
                            },
                            pos: argResult.pos,
                        };
                    }
                }
            }

            // Check split-token style: $var . method (three separate tokens)
            if (pos + 1 < tokens.length && tokens[pos + 1] === '.') {
                const methodToken = pos + 2 < tokens.length ? tokens[pos + 2] : '';
                for (const method of ['contains', 'startsWith', 'endsWith']) {
                    if (methodToken.startsWith(method)) {
                        let argPos = pos + 3; // past $var . method
                        if (argPos < tokens.length && tokens[argPos] === '(') {
                            argPos++; // skip (
                            const argResult = this.parsePrimary(tokens, argPos);
                            if (argResult.pos < tokens.length && tokens[argResult.pos] === ')') {
                                argResult.pos++;
                            }
                            return {
                                node: {
                                    type: 'string_op',
                                    string_op: method,
                                    left: { type: 'variable', variable: token },
                                    right: argResult.node,
                                },
                                pos: argResult.pos,
                            };
                        }
                    }
                }
            }

            return { node: { type: 'variable', variable: token }, pos: pos + 1 };
        }

        // Identifier (treat as variable without $)
        return { node: { type: 'variable', variable: `$${token}` }, pos: pos + 1 };
    }

    /**
     * Evaluate an AST node against variables.
     */
    private evaluateAST(node: ConditionNode, variables: Record<string, unknown>): boolean {
        switch (node.type) {
            case 'literal':
                return Boolean(node.value);

            case 'variable': {
                const val = this.resolveVariable(node.variable ?? '', variables);
                return Boolean(val);
            }

            case 'not':
                return !this.evaluateAST(node.operand!, variables);

            case 'logical': {
                const leftBool = this.evaluateAST(node.left!, variables);
                if (node.logical_op === '||') {
                    return leftBool || this.evaluateAST(node.right!, variables);
                }
                return leftBool && this.evaluateAST(node.right!, variables);
            }

            case 'comparison': {
                const leftVal = this.resolveNodeValue(node.left!, variables);
                const rightVal = this.resolveNodeValue(node.right!, variables);
                return this.compareValues(leftVal, rightVal, node.operator ?? '==');
            }

            case 'string_op': {
                const strVal = String(this.resolveNodeValue(node.left!, variables) ?? '');
                const argVal = String(this.resolveNodeValue(node.right!, variables) ?? '');
                switch (node.string_op) {
                    case 'contains': return strVal.includes(argVal);
                    case 'startsWith': return strVal.startsWith(argVal);
                    case 'endsWith': return strVal.endsWith(argVal);
                    default: return false;
                }
            }

            default:
                return false;
        }
    }

    /**
     * Resolve a ConditionNode to its actual value.
     */
    private resolveNodeValue(node: ConditionNode, variables: Record<string, unknown>): unknown {
        switch (node.type) {
            case 'literal': return node.value;
            case 'variable': return this.resolveVariable(node.variable ?? '', variables);
            default: return this.evaluateAST(node, variables);
        }
    }

    /**
     * Resolve a variable name to its value from the execution context.
     */
    private resolveVariable(name: string, variables: Record<string, unknown>): unknown {
        // Direct variable lookup
        if (variables[name] !== undefined) return variables[name];

        // Strip $ prefix for lookup
        const stripped = name.startsWith('$') ? name.substring(1) : name;
        if (variables[stripped] !== undefined) return variables[stripped];

        // With $ prefix
        if (variables[`$${stripped}`] !== undefined) return variables[`$${stripped}`];

        // Nested: $variables.foo.bar
        if (stripped.startsWith('variables.')) {
            const path = stripped.substring('variables.'.length).split('.');
            let current: unknown = variables;
            for (const part of path) {
                if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
                    current = (current as Record<string, unknown>)[part];
                } else {
                    return undefined;
                }
            }
            return current;
        }

        return undefined;
    }

    /**
     * Compare two values with a given operator.
     */
    private compareValues(left: unknown, right: unknown, operator: string): boolean {
        // Coerce to numbers if both are numeric
        const leftNum = Number(left);
        const rightNum = Number(right);
        const bothNumeric = !isNaN(leftNum) && !isNaN(rightNum) && left !== '' && right !== '';

        switch (operator) {
            case '>': return bothNumeric ? leftNum > rightNum : String(left) > String(right);
            case '<': return bothNumeric ? leftNum < rightNum : String(left) < String(right);
            case '>=': return bothNumeric ? leftNum >= rightNum : String(left) >= String(right);
            case '<=': return bothNumeric ? leftNum <= rightNum : String(left) <= String(right);
            case '==': return String(left) === String(right);
            case '!=': return String(left) !== String(right);
            default: return false;
        }
    }

    // ==================== HELPERS ====================

    /**
     * Determine the next step after completing a step.
     */
    private determineNextStep(
        step: WorkflowStep,
        result: WorkflowStepResult,
        variables: Record<string, unknown>
    ): string | null {
        // For condition steps, branch based on result
        if (step.step_type === WorkflowStepType.Condition) {
            const conditionResult = variables.$conditionResult as boolean;

            this.eventBus.emit('workflow:branch_taken', 'WorkflowEngine', {
                stepId: step.id,
                branch: conditionResult ? 'true' : 'false',
            });

            return conditionResult
                ? (step.true_branch_step_id ?? step.next_step_id ?? null)
                : (step.false_branch_step_id ?? step.next_step_id ?? null);
        }

        // For loop steps, loop back to target or proceed
        if (step.step_type === WorkflowStepType.Loop) {
            const loopKey = `__loop_${step.id}`;
            const loopCount = (variables[loopKey] as number) ?? 0;
            // If the loop is still continuing, go to true_branch (loop body)
            // Otherwise go to next_step (exit loop)
            if (step.condition_expression) {
                const shouldContinue = this.evaluateCondition(step.condition_expression, variables);
                if (shouldContinue && loopCount <= 100) {
                    return step.true_branch_step_id ?? step.next_step_id ?? null;
                }
            }
        }

        return step.next_step_id ?? null;
    }

    private completeExecution(executionId: string): void {
        this.database.updateWorkflowExecution(executionId, {
            status: WorkflowExecutionStatus.Completed,
            completed_at: new Date().toISOString(),
        });

        this.eventBus.emit('workflow:execution_completed', 'WorkflowEngine', {
            executionId,
        });

        this.outputChannel.appendLine(`[WorkflowEngine] Execution ${executionId} completed`);
    }

    private failExecution(executionId: string, error: string): void {
        this.database.updateWorkflowExecution(executionId, {
            status: WorkflowExecutionStatus.Failed,
            completed_at: new Date().toISOString(),
        });

        this.eventBus.emit('workflow:execution_failed', 'WorkflowEngine', {
            executionId,
            error,
        });

        this.outputChannel.appendLine(`[WorkflowEngine] Execution ${executionId} failed: ${error}`);
    }

    /**
     * Interpolate $variable references in a string.
     */
    private interpolateVariables(template: string, variables: Record<string, unknown>): string {
        return template.replace(/\$(\w[\w.]*)/g, (match, name) => {
            const val = this.resolveVariable(name, variables);
            return val !== undefined ? String(val) : match;
        });
    }

    private parseVariables(json: string): Record<string, unknown> {
        try {
            return JSON.parse(json) as Record<string, unknown>;
        } catch {
            return {};
        }
    }

    dispose(): void {
        // Nothing to clean up
    }
}
