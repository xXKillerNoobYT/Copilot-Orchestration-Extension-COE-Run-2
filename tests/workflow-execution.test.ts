import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../src/core/database';
import { EventBus } from '../src/core/event-bus';
import { ConfigManager } from '../src/core/config';
import { WorkflowEngine } from '../src/core/workflow-engine';
import { WorkflowDesigner } from '../src/core/workflow-designer';
import {
    WorkflowStepType, WorkflowStatus, WorkflowExecutionStatus,
} from '../src/types';

// ============================================================
// End-to-end workflow execution tests
// Tests the integration of WorkflowEngine + WorkflowDesigner
// ============================================================

let tmpDir: string;
let db: Database;
let eventBus: EventBus;
let config: ConfigManager;
let engine: WorkflowEngine;
let designer: WorkflowDesigner;

const mockOutput = { appendLine: jest.fn() } as any;

beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-wf-e2e-'));
    db = new Database(tmpDir);
    await db.initialize();
    eventBus = new EventBus();
    config = new ConfigManager(null as any, tmpDir);
    engine = new WorkflowEngine(db, eventBus, config, mockOutput);
    designer = new WorkflowDesigner(db, eventBus, mockOutput);
    jest.clearAllMocks();
});

afterEach(() => {
    eventBus.removeAllListeners();
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================
// Helper: create a workflow through the designer, activate, return ID
// ============================================================

function createAndActivateWorkflow(name: string): string {
    const wf = designer.createWorkflow(name, 'E2E test workflow');
    return wf.id;
}

// ============================================================
// E2E — Linear workflow: create → add steps → validate → execute → verify
// ============================================================

describe('E2E — linear workflow', () => {
    test('create workflow, add steps, validate, execute, verify results', async () => {
        engine.setAgentCallExecutor(async (_type, prompt) => ({
            content: `Processed: ${prompt}`,
            tokens_used: 10,
        }));

        const wfId = createAndActivateWorkflow('Linear WF');
        const step2 = designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Step 2',
            agent_type: 'research',
            agent_prompt: 'Research task',
            sort_order: 10,
        });
        const step1 = designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Step 1',
            agent_type: 'planning',
            agent_prompt: 'Plan task',
            sort_order: 0,
        });
        designer.connectSteps(step1.id, step2.id);

        // Validate
        const validation = designer.validateWorkflow(wfId);
        expect(validation.valid).toBe(true);

        // Activate
        designer.activateWorkflow(wfId);

        // Execute
        const exec = engine.startExecution(wfId, 'trigger-1');
        const completed = await engine.runToCompletion(exec.id);
        expect(completed.status).toBe(WorkflowExecutionStatus.Completed);

        // Verify step results
        const state = engine.getExecutionState(exec.id)!;
        expect(state.results.length).toBe(2);
        expect(state.results.every(r => r.status === WorkflowExecutionStatus.Completed)).toBe(true);
    });

    test('single step workflow completes after one executeNextStep', async () => {
        engine.setAgentCallExecutor(async () => ({ content: 'done', tokens_used: 5 }));

        const wfId = createAndActivateWorkflow('Single Step');
        designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Only Step',
            agent_type: 'planning',
            sort_order: 0,
        });
        designer.activateWorkflow(wfId);

        const exec = engine.startExecution(wfId, 'trigger-1');
        await engine.executeNextStep(exec.id);
        const updated = db.getWorkflowExecution(exec.id)!;
        expect(updated.status).toBe(WorkflowExecutionStatus.Completed);
    });
});

// ============================================================
// E2E — Condition branching follows correct path
// ============================================================

describe('E2E — condition branching', () => {
    test('follows true branch when condition evaluates to true', async () => {
        engine.setAgentCallExecutor(async (_type, prompt) => ({
            content: `Result for: ${prompt}`,
            tokens_used: 5,
        }));

        const wfId = createAndActivateWorkflow('Condition WF');

        const trueBranch = designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'True Path',
            agent_type: 'planning',
            agent_prompt: 'True path work',
            sort_order: 10,
        });
        const falseBranch = designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'False Path',
            agent_type: 'research',
            agent_prompt: 'False path work',
            sort_order: 20,
        });
        const condStep = designer.addStep(wfId, {
            step_type: WorkflowStepType.Condition,
            label: 'Score Check',
            condition_expression: '$score > 50',
            sort_order: 0,
        });
        designer.connectSteps(condStep.id, trueBranch.id, 'true');
        designer.connectSteps(condStep.id, falseBranch.id, 'false');
        designer.activateWorkflow(wfId);

        const exec = engine.startExecution(wfId, 'trigger-1', { $score: 75 });
        const completed = await engine.runToCompletion(exec.id);
        expect(completed.status).toBe(WorkflowExecutionStatus.Completed);

        // Verify the true branch was executed
        const state = engine.getExecutionState(exec.id)!;
        const agentResults = state.results.filter(r => r.agent_response?.includes('True path'));
        expect(agentResults.length).toBe(1);
    });

    test('follows false branch when condition evaluates to false', async () => {
        engine.setAgentCallExecutor(async (_type, prompt) => ({
            content: `Result for: ${prompt}`,
            tokens_used: 5,
        }));

        const wfId = createAndActivateWorkflow('Condition WF');

        const trueBranch = designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'True Path',
            agent_type: 'planning',
            sort_order: 10,
        });
        const falseBranch = designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'False Path',
            agent_type: 'research',
            agent_prompt: 'False path work',
            sort_order: 20,
        });
        const condStep = designer.addStep(wfId, {
            step_type: WorkflowStepType.Condition,
            label: 'Score Check',
            condition_expression: '$score > 50',
            sort_order: 0,
        });
        designer.connectSteps(condStep.id, trueBranch.id, 'true');
        designer.connectSteps(condStep.id, falseBranch.id, 'false');
        designer.activateWorkflow(wfId);

        const exec = engine.startExecution(wfId, 'trigger-1', { $score: 25 });
        const completed = await engine.runToCompletion(exec.id);
        expect(completed.status).toBe(WorkflowExecutionStatus.Completed);

        const state = engine.getExecutionState(exec.id)!;
        const falseResults = state.results.filter(r => r.agent_response?.includes('False path'));
        expect(falseResults.length).toBe(1);
    });
});

// ============================================================
// E2E — Parallel execution completes all branches
// ============================================================

describe('E2E — parallel execution', () => {
    test('completes all parallel branches', async () => {
        const callLog: string[] = [];
        engine.setAgentCallExecutor(async (type, prompt) => {
            callLog.push(type);
            return { content: `Done by ${type}`, tokens_used: 10 };
        });

        const wfId = createAndActivateWorkflow('Parallel WF');

        const branch1 = designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Branch A',
            agent_type: 'planning',
            sort_order: 10,
        });
        const branch2 = designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Branch B',
            agent_type: 'research',
            sort_order: 20,
        });
        designer.addStep(wfId, {
            step_type: WorkflowStepType.ParallelBranch,
            label: 'Run Parallel',
            parallel_step_ids: [branch1.id, branch2.id],
            sort_order: 0,
        });
        designer.activateWorkflow(wfId);

        const exec = engine.startExecution(wfId, 'trigger-1');
        const completed = await engine.runToCompletion(exec.id);
        expect(completed.status).toBe(WorkflowExecutionStatus.Completed);
        expect(callLog).toContain('planning');
        expect(callLog).toContain('research');
    });
});

// ============================================================
// E2E — User approval gate pauses and resumes
// ============================================================

describe('E2E — user approval gate', () => {
    test('pauses at approval step and resumes after approval', async () => {
        engine.setAgentCallExecutor(async () => ({ content: 'done', tokens_used: 5 }));

        const wfId = createAndActivateWorkflow('Approval WF');

        const afterApproval = designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Post-Approval',
            agent_type: 'planning',
            sort_order: 10,
        });
        const approval = designer.addStep(wfId, {
            step_type: WorkflowStepType.UserApproval,
            label: 'Approve Changes',
            sort_order: 0,
            next_step_id: afterApproval.id,
        });
        designer.activateWorkflow(wfId);

        const exec = engine.startExecution(wfId, 'trigger-1');

        // Run — should pause at approval
        await engine.executeNextStep(exec.id);
        let state = db.getWorkflowExecution(exec.id)!;
        expect(state.status).toBe(WorkflowExecutionStatus.WaitingApproval);

        // Approve
        engine.handleApproval(exec.id, true, 'LGTM');
        state = db.getWorkflowExecution(exec.id)!;
        expect(state.status).toBe(WorkflowExecutionStatus.Running);

        // Continue execution
        const completed = await engine.runToCompletion(exec.id);
        expect(completed.status).toBe(WorkflowExecutionStatus.Completed);
    });

    test('approval rejection stops execution', async () => {
        const wfId = createAndActivateWorkflow('Rejection WF');

        designer.addStep(wfId, {
            step_type: WorkflowStepType.UserApproval,
            label: 'Approve',
            sort_order: 0,
        });
        designer.activateWorkflow(wfId);

        const exec = engine.startExecution(wfId, 'trigger-1');
        await engine.executeNextStep(exec.id);
        engine.handleApproval(exec.id, false, 'Not ready');

        const state = db.getWorkflowExecution(exec.id)!;
        expect(state.status).toBe(WorkflowExecutionStatus.Failed);
    });
});

// ============================================================
// E2E — Escalation step triggers on failure
// ============================================================

describe('E2E — escalation on failure', () => {
    test('escalation step is reached when agent call fails with retries exhausted', async () => {
        let callCount = 0;
        engine.setAgentCallExecutor(async () => {
            callCount++;
            throw new Error('Agent failed');
        });

        const escalationHandler = jest.fn();
        eventBus.on('workflow:escalation_triggered', escalationHandler);

        const wfId = createAndActivateWorkflow('Escalation WF');

        const escStep = designer.addStep(wfId, {
            step_type: WorkflowStepType.Escalation,
            label: 'Escalate',
            sort_order: 10,
        });
        designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Failing Step',
            agent_type: 'planning',
            max_retries: 0,
            escalation_step_id: escStep.id,
            sort_order: 0,
        });
        designer.activateWorkflow(wfId);

        const exec = engine.startExecution(wfId, 'trigger-1');
        // The failing step will fail, trigger escalation
        await engine.executeNextStep(exec.id);
        // Now the current step should be the escalation step
        const state = db.getWorkflowExecution(exec.id)!;
        expect(state.current_step_id).toBe(escStep.id);

        // Execute the escalation step
        await engine.executeNextStep(exec.id);
        expect(escalationHandler).toHaveBeenCalled();
    });
});

// ============================================================
// E2E — Variables pass between steps
// ============================================================

describe('E2E — variables pass between steps', () => {
    test('$result from step 1 is available in step 2 prompt interpolation', async () => {
        const prompts: string[] = [];
        engine.setAgentCallExecutor(async (_type, prompt) => {
            prompts.push(prompt);
            return { content: 'analysis-result-42', tokens_used: 5 };
        });

        const wfId = createAndActivateWorkflow('Variable WF');

        const step2 = designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Step 2',
            agent_type: 'research',
            agent_prompt: 'Based on $result, do more',
            sort_order: 10,
        });
        const step1 = designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Step 1',
            agent_type: 'planning',
            agent_prompt: 'Analyze the code',
            sort_order: 0,
        });
        designer.connectSteps(step1.id, step2.id);
        designer.activateWorkflow(wfId);

        const exec = engine.startExecution(wfId, 'trigger-1');
        await engine.runToCompletion(exec.id);

        // Step 2 prompt should have $result interpolated
        expect(prompts[1]).toContain('analysis-result-42');
    });

    test('initial variables are accessible during execution', async () => {
        const prompts: string[] = [];
        engine.setAgentCallExecutor(async (_type, prompt) => {
            prompts.push(prompt);
            return { content: 'done', tokens_used: 1 };
        });

        const wfId = createAndActivateWorkflow('Init Vars WF');
        designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Step',
            agent_type: 'planning',
            agent_prompt: 'Project: $projectName',
            sort_order: 0,
        });
        designer.activateWorkflow(wfId);

        const exec = engine.startExecution(wfId, 'trigger-1', { projectName: 'MyApp' });
        await engine.runToCompletion(exec.id);

        expect(prompts[0]).toContain('MyApp');
    });
});

// ============================================================
// E2E — Crash recovery resumes from persisted state
// ============================================================

describe('E2E — crash recovery', () => {
    test('recoverPendingExecutions resumes interrupted workflows', async () => {
        engine.setAgentCallExecutor(async () => ({ content: 'recovered', tokens_used: 1 }));

        const wfId = createAndActivateWorkflow('Recovery WF');
        designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Step',
            agent_type: 'planning',
            sort_order: 0,
        });
        designer.activateWorkflow(wfId);

        // Simulate a crashed execution (status = Running, persisted in DB)
        const exec = engine.startExecution(wfId, 'trigger-1');
        // Don't execute — leave it running as if system crashed

        // Now recover
        const recovered = await engine.recoverPendingExecutions();
        expect(recovered).toBeGreaterThanOrEqual(1);
    });

    test('recovery handles failure gracefully', async () => {
        engine.setAgentCallExecutor(async () => { throw new Error('Cannot recover'); });

        const wfId = createAndActivateWorkflow('Fail Recovery WF');
        designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Step',
            agent_type: 'planning',
            sort_order: 0,
        });
        designer.activateWorkflow(wfId);

        const exec = engine.startExecution(wfId, 'trigger-1');
        // This should not throw even though recovery fails
        await engine.recoverPendingExecutions();
        const state = db.getWorkflowExecution(exec.id)!;
        expect(state.status).toBe(WorkflowExecutionStatus.Failed);
    });
});

// ============================================================
// E2E — Tool unlock and revoke
// ============================================================

describe('E2E — tool unlock', () => {
    test('tools are accumulated in $unlockedTools across steps', async () => {
        engine.setAgentCallExecutor(async () => ({ content: 'done', tokens_used: 0 }));

        const wfId = createAndActivateWorkflow('Tool WF');

        const agentStep = designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Use Tools',
            agent_type: 'planning',
            sort_order: 10,
        });
        const unlockStep = designer.addStep(wfId, {
            step_type: WorkflowStepType.ToolUnlock,
            label: 'Unlock Write',
            tools_unlocked: ['file_write', 'git_commit'],
            sort_order: 0,
        });
        designer.connectSteps(unlockStep.id, agentStep.id);
        designer.activateWorkflow(wfId);

        const exec = engine.startExecution(wfId, 'trigger-1');
        await engine.runToCompletion(exec.id);

        const state = db.getWorkflowExecution(exec.id)!;
        const vars = JSON.parse(state.variables_json);
        expect(vars.$unlockedTools).toEqual(expect.arrayContaining(['file_write', 'git_commit']));
    });
});

// ============================================================
// E2E — Wait step delays execution
// ============================================================

describe('E2E — wait step', () => {
    test('wait step introduces delay before continuing', async () => {
        engine.setAgentCallExecutor(async () => ({ content: 'done', tokens_used: 0 }));

        const wfId = createAndActivateWorkflow('Wait WF');

        const agentStep = designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'After Wait',
            agent_type: 'planning',
            sort_order: 10,
        });
        const waitStep = designer.addStep(wfId, {
            step_type: WorkflowStepType.Wait,
            label: 'Wait 10ms',
            retry_delay_ms: 10,
            sort_order: 0,
        });
        designer.connectSteps(waitStep.id, agentStep.id);
        designer.activateWorkflow(wfId);

        const exec = engine.startExecution(wfId, 'trigger-1');
        const startTime = Date.now();
        await engine.runToCompletion(exec.id);
        const elapsed = Date.now() - startTime;
        expect(elapsed).toBeGreaterThanOrEqual(5); // At least some delay
    });
});

// ============================================================
// E2E — Sub-workflow execution
// ============================================================

describe('E2E — sub-workflow execution', () => {
    test('parent workflow executes child workflow to completion', async () => {
        engine.setAgentCallExecutor(async (_type, prompt) => ({
            content: `Sub result: ${prompt}`,
            tokens_used: 3,
        }));

        // Create child workflow
        const childWfId = createAndActivateWorkflow('Child WF');
        designer.addStep(childWfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Child Step',
            agent_type: 'research',
            agent_prompt: 'Do child work',
            sort_order: 0,
        });
        designer.activateWorkflow(childWfId);

        // Create parent workflow
        const parentWfId = createAndActivateWorkflow('Parent WF');
        designer.addStep(parentWfId, {
            step_type: WorkflowStepType.SubWorkflow,
            label: 'Run Child',
            agent_type: childWfId, // agent_type stores sub-workflow ID
            sort_order: 0,
        });
        designer.activateWorkflow(parentWfId);

        const exec = engine.startExecution(parentWfId, 'trigger-1');
        const completed = await engine.runToCompletion(exec.id);
        expect(completed.status).toBe(WorkflowExecutionStatus.Completed);
    });

    test('sub-workflow failure propagates to parent', async () => {
        engine.setAgentCallExecutor(async () => { throw new Error('Child failed'); });

        const childWfId = createAndActivateWorkflow('Failing Child');
        designer.addStep(childWfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Failing Child Step',
            agent_type: 'planning',
            max_retries: 0,
            sort_order: 0,
        });
        designer.activateWorkflow(childWfId);

        const parentWfId = createAndActivateWorkflow('Parent WF');
        designer.addStep(parentWfId, {
            step_type: WorkflowStepType.SubWorkflow,
            label: 'Run Failing Child',
            agent_type: childWfId,
            sort_order: 0,
        });
        designer.activateWorkflow(parentWfId);

        const exec = engine.startExecution(parentWfId, 'trigger-1');
        const completed = await engine.runToCompletion(exec.id);
        expect(completed.status).toBe(WorkflowExecutionStatus.Failed);
    });
});

// ============================================================
// E2E — Token accounting
// ============================================================

describe('E2E — token accounting', () => {
    test('tokens are accumulated across steps', async () => {
        engine.setAgentCallExecutor(async () => ({ content: 'done', tokens_used: 50 }));

        const wfId = createAndActivateWorkflow('Token WF');
        const step2 = designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Step 2',
            agent_type: 'research',
            sort_order: 10,
        });
        const step1 = designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Step 1',
            agent_type: 'planning',
            sort_order: 0,
        });
        designer.connectSteps(step1.id, step2.id);
        designer.activateWorkflow(wfId);

        const exec = engine.startExecution(wfId, 'trigger-1');
        const completed = await engine.runToCompletion(exec.id);
        expect(completed.tokens_consumed).toBe(100); // 50 + 50
    });
});

// ============================================================
// E2E — Full roundtrip: design → export → import → execute
// ============================================================

describe('E2E — design → export → import → execute', () => {
    test('workflow survives export/import cycle and runs correctly', async () => {
        engine.setAgentCallExecutor(async () => ({ content: 'imported result', tokens_used: 7 }));

        // Design workflow
        const origWfId = createAndActivateWorkflow('Export Me');
        const s1 = designer.addStep(origWfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Analyze',
            agent_type: 'research',
            sort_order: 0,
        });
        const s2 = designer.addStep(origWfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Report',
            agent_type: 'planning',
            sort_order: 10,
        });
        designer.connectSteps(s1.id, s2.id);

        // Export
        const json = designer.exportWorkflow(origWfId);

        // Import into new workflow
        const imported = designer.importWorkflow(json);
        designer.activateWorkflow(imported.id);

        // Execute imported workflow
        const exec = engine.startExecution(imported.id, 'trigger-1');
        const completed = await engine.runToCompletion(exec.id);
        expect(completed.status).toBe(WorkflowExecutionStatus.Completed);
    });
});

// ============================================================
// E2E — Acceptance criteria integration
// ============================================================

describe('E2E — acceptance criteria integration', () => {
    test('acceptance_criteria pass proceeds to next step', async () => {
        engine.setAgentCallExecutor(async () => ({ content: 'Task completed with success', tokens_used: 15 }));

        const wfId = createAndActivateWorkflow('Accept Pass WF');
        const step2 = designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Post Check',
            agent_type: 'verification',
            sort_order: 10,
        });
        const step1 = designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Checked Step',
            agent_type: 'planning',
            acceptance_criteria: 'success,completed',
            sort_order: 0,
        });
        designer.connectSteps(step1.id, step2.id);
        designer.activateWorkflow(wfId);

        const exec = engine.startExecution(wfId, 'trigger-acc-pass');
        const completed = await engine.runToCompletion(exec.id);
        expect(completed.status).toBe(WorkflowExecutionStatus.Completed);
        const state = engine.getExecutionState(exec.id)!;
        expect(state.results.length).toBe(2);
    });

    test('acceptance_criteria fail stops the workflow', async () => {
        engine.setAgentCallExecutor(async () => ({ content: 'Nothing relevant', tokens_used: 15 }));

        const wfId = createAndActivateWorkflow('Accept Fail WF');
        designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Fail Check',
            agent_type: 'planning',
            acceptance_criteria: 'approved,validated',
            max_retries: 0,
            sort_order: 0,
        });
        designer.activateWorkflow(wfId);

        const exec = engine.startExecution(wfId, 'trigger-acc-fail');
        const completed = await engine.runToCompletion(exec.id);
        expect(completed.status).toBe(WorkflowExecutionStatus.Failed);
    });
});

// ============================================================
// E2E — Event chain verification
// ============================================================

describe('E2E — event chain verification', () => {
    test('emits events in correct lifecycle order', async () => {
        const events: string[] = [];
        eventBus.on('workflow:execution_started', () => { events.push('execution_started'); });
        eventBus.on('workflow:step_started', () => { events.push('step_started'); });
        eventBus.on('workflow:step_completed', () => { events.push('step_completed'); });
        eventBus.on('workflow:execution_completed', () => { events.push('execution_completed'); });

        engine.setAgentCallExecutor(async () => ({ content: 'ok', tokens_used: 1 }));

        const wfId = createAndActivateWorkflow('Event Order WF');
        designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Event Step',
            agent_type: 'planning',
            sort_order: 0,
        });
        designer.activateWorkflow(wfId);

        const exec = engine.startExecution(wfId, 'trigger-events');
        await engine.runToCompletion(exec.id);

        expect(events[0]).toBe('execution_started');
        expect(events).toContain('step_started');
        expect(events).toContain('step_completed');
        expect(events).toContain('execution_completed');
        // execution_started must come before step_started
        expect(events.indexOf('execution_started')).toBeLessThan(events.indexOf('step_started'));
    });

    test('condition_evaluated event fires for condition steps', async () => {
        const handler = jest.fn();
        eventBus.on('workflow:condition_evaluated', handler);

        engine.setAgentCallExecutor(async () => ({ content: 'ok', tokens_used: 0 }));

        const wfId = createAndActivateWorkflow('Cond Event WF');
        const trueStep = designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'After Cond',
            agent_type: 'planning',
            sort_order: 10,
        });
        const condStep = designer.addStep(wfId, {
            step_type: WorkflowStepType.Condition,
            label: 'Cond Evt',
            condition_expression: '$x > 0',
            sort_order: 0,
        });
        designer.connectSteps(condStep.id, trueStep.id, 'true');
        designer.activateWorkflow(wfId);

        const exec = engine.startExecution(wfId, 'trigger-cond-evt', { $x: 5 });
        await engine.runToCompletion(exec.id);

        expect(handler).toHaveBeenCalled();
        expect(handler.mock.calls[0][0].data.result).toBe(true);
    });

    test('step_failed event fires for failing steps', async () => {
        const handler = jest.fn();
        eventBus.on('workflow:step_failed', handler);

        const wfId = createAndActivateWorkflow('Fail Event WF');
        designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Fail Step',
            agent_type: 'planning',
            sort_order: 0,
        });
        designer.activateWorkflow(wfId);
        // No executor set — fails

        const exec = engine.startExecution(wfId, 'trigger-fail-evt');
        await engine.executeNextStep(exec.id);

        expect(handler).toHaveBeenCalled();
    });
});

// ============================================================
// E2E — Cancel mid-execution
// ============================================================

describe('E2E — cancel mid-execution', () => {
    test('cancelling sets Cancelled status with completed_at', async () => {
        engine.setAgentCallExecutor(async () => ({ content: 'ok', tokens_used: 1 }));

        const wfId = createAndActivateWorkflow('Cancel Detail WF');
        const s2 = designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'S2',
            agent_type: 'planning',
            sort_order: 10,
        });
        const s1 = designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'S1',
            agent_type: 'planning',
            sort_order: 0,
        });
        designer.connectSteps(s1.id, s2.id);
        designer.activateWorkflow(wfId);

        const exec = engine.startExecution(wfId, 'trigger-cancel-detail');
        await engine.executeNextStep(exec.id);
        engine.cancelExecution(exec.id, 'User changed their mind');

        const updated = db.getWorkflowExecution(exec.id)!;
        expect(updated.status).toBe(WorkflowExecutionStatus.Cancelled);
        expect(updated.completed_at).not.toBeNull();
    });
});

// ============================================================
// E2E — Cloned workflow runs independently
// ============================================================

describe('E2E — cloned workflow execution', () => {
    test('cloned workflow executes independently from original', async () => {
        engine.setAgentCallExecutor(async () => ({ content: 'cloned result', tokens_used: 8 }));

        const wfId = createAndActivateWorkflow('Original WF');
        const s1 = designer.addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Step 1',
            agent_type: 'planning',
            sort_order: 0,
        });

        // Clone
        const clone = designer.cloneWorkflow(wfId);
        designer.activateWorkflow(clone.id);

        // Execute clone
        const exec = engine.startExecution(clone.id, 'trigger-clone');
        const completed = await engine.runToCompletion(exec.id);
        expect(completed.status).toBe(WorkflowExecutionStatus.Completed);
        expect(completed.workflow_id).toBe(clone.id);
    });
});
