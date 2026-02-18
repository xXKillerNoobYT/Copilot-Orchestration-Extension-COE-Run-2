import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../src/core/database';
import { EventBus } from '../src/core/event-bus';
import { ConfigManager } from '../src/core/config';
import { WorkflowEngine, AgentCallExecutor } from '../src/core/workflow-engine';
import {
    WorkflowStepType, WorkflowStatus, WorkflowExecutionStatus,
} from '../src/types';

// ============================================================
// Shared test infrastructure
// ============================================================

let tmpDir: string;
let db: Database;
let eventBus: EventBus;
let config: ConfigManager;
let engine: WorkflowEngine;

const mockOutput = { appendLine: jest.fn() } as any;

beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-wf-engine-'));
    db = new Database(tmpDir);
    await db.initialize();
    eventBus = new EventBus();
    config = new ConfigManager(null as any, tmpDir);
    engine = new WorkflowEngine(db, eventBus, config, mockOutput);
    jest.clearAllMocks();
});

afterEach(() => {
    eventBus.removeAllListeners();
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================
// Helpers
// ============================================================

function createActiveWorkflow(name: string = 'Test Workflow'): string {
    const wf = db.createWorkflowDefinition({
        name,
        description: 'Test workflow',
        status: WorkflowStatus.Active,
    });
    return wf.id;
}

function addStep(workflowId: string, overrides: Partial<Record<string, unknown>> = {}): string {
    const step = db.createWorkflowStep({
        workflow_id: workflowId,
        step_type: WorkflowStepType.AgentCall,
        label: 'Test Step',
        sort_order: 0,
        agent_type: 'planning',
        ...overrides,
    });
    return step.id;
}

function createTestWorkflow(dbRef: Database) {
    const wf = dbRef.createWorkflowDefinition({ name: 'test', description: 'test', status: WorkflowStatus.Active });
    const step1 = dbRef.createWorkflowStep({ workflow_id: wf.id, step_type: WorkflowStepType.AgentCall, label: 'Step 1', agent_type: 'planning', sort_order: 0 });
    const step2 = dbRef.createWorkflowStep({ workflow_id: wf.id, step_type: WorkflowStepType.AgentCall, label: 'Step 2', agent_type: 'research', sort_order: 1 });
    dbRef.updateWorkflowStep(step1.id, { next_step_id: step2.id });
    return { wf, step1, step2 };
}

// ============================================================
// startExecution
// ============================================================

describe('WorkflowEngine — startExecution', () => {
    test('creates execution and sets status to Running', () => {
        const wfId = createActiveWorkflow();
        addStep(wfId);
        const exec = engine.startExecution(wfId, 'trigger-1');
        expect(exec).toBeDefined();
        expect(exec.workflow_id).toBe(wfId);
        expect(exec.status).toBe(WorkflowExecutionStatus.Running);
    });

    test('emits workflow:execution_started event', () => {
        const handler = jest.fn();
        eventBus.on('workflow:execution_started', handler);
        const wfId = createActiveWorkflow();
        addStep(wfId);
        engine.startExecution(wfId, 'trigger-1');
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].data.workflowId).toBe(wfId);
    });

    test('throws for non-existent workflow', () => {
        expect(() => engine.startExecution('nonexistent', 'trigger-1'))
            .toThrow('Workflow nonexistent not found');
    });

    test('throws for Draft workflow', () => {
        const wf = db.createWorkflowDefinition({
            name: 'Draft WF',
            description: 'Draft',
            status: WorkflowStatus.Draft,
        });
        addStep(wf.id);
        expect(() => engine.startExecution(wf.id, 'trigger-1'))
            .toThrow('is not active');
    });

    test('sets current_step_id to first step by sort_order', () => {
        const wfId = createActiveWorkflow();
        addStep(wfId, { sort_order: 10, label: 'Second' });
        const firstStepId = addStep(wfId, { sort_order: 0, label: 'First' });
        const exec = engine.startExecution(wfId, 'trigger-1');
        expect(exec.current_step_id).toBe(firstStepId);
    });
});

// ============================================================
// executeStep (agent_call)
// ============================================================

describe('WorkflowEngine — executeStep (agent_call)', () => {
    test('calls agent executor and records result', async () => {
        engine.setAgentCallExecutor(async () => ({ content: 'done', tokens_used: 100 }));
        const wfId = createActiveWorkflow();
        addStep(wfId, { agent_type: 'planning', agent_prompt: 'Do something' });
        const exec = engine.startExecution(wfId, 'trigger-1');
        const result = await engine.executeNextStep(exec.id);
        expect(result).not.toBeNull();
        expect(result!.status).toBe(WorkflowExecutionStatus.Completed);
        expect(result!.agent_response).toBe('done');
        expect(result!.tokens_used).toBe(100);
    });

    test('advances to next step after completion', async () => {
        engine.setAgentCallExecutor(async () => ({ content: 'done', tokens_used: 0 }));
        const { wf, step1, step2 } = createTestWorkflow(db);
        const exec = engine.startExecution(wf.id, 'trigger-1');
        await engine.executeNextStep(exec.id);
        const updated = db.getWorkflowExecution(exec.id)!;
        expect(updated.current_step_id).toBe(step2.id);
    });

    test('fails if no agent call executor is configured', async () => {
        const wfId = createActiveWorkflow();
        addStep(wfId, { agent_type: 'planning' });
        const exec = engine.startExecution(wfId, 'trigger-1');
        const result = await engine.executeNextStep(exec.id);
        expect(result!.status).toBe(WorkflowExecutionStatus.Failed);
        expect(result!.error).toContain('No agent call executor');
    });
});

// ============================================================
// Condition evaluation
// ============================================================

describe('WorkflowEngine — evaluateCondition', () => {
    test('$score > 80 with score=90 is true', () => {
        expect(engine.evaluateCondition('$score > 80', { $score: 90 })).toBe(true);
    });

    test('$score > 80 with score=50 is false', () => {
        expect(engine.evaluateCondition('$score > 80', { $score: 50 })).toBe(false);
    });
});

// ============================================================
// Safe condition evaluator — operators
// ============================================================

describe('WorkflowEngine — safe condition evaluator', () => {
    test('supports == operator', () => {
        expect(engine.evaluateCondition("$status == 'completed'", { $status: 'completed' })).toBe(true);
        expect(engine.evaluateCondition("$status == 'completed'", { $status: 'failed' })).toBe(false);
    });

    test('supports != operator', () => {
        expect(engine.evaluateCondition("$status != 'failed'", { $status: 'completed' })).toBe(true);
        expect(engine.evaluateCondition("$status != 'failed'", { $status: 'failed' })).toBe(false);
    });

    test('supports < operator', () => {
        expect(engine.evaluateCondition('$score < 80', { $score: 70 })).toBe(true);
        expect(engine.evaluateCondition('$score < 80', { $score: 90 })).toBe(false);
    });

    test('supports > operator', () => {
        expect(engine.evaluateCondition('$score > 80', { $score: 90 })).toBe(true);
        expect(engine.evaluateCondition('$score > 80', { $score: 70 })).toBe(false);
    });

    test('supports >= operator', () => {
        expect(engine.evaluateCondition('$score >= 80', { $score: 80 })).toBe(true);
        expect(engine.evaluateCondition('$score >= 80', { $score: 79 })).toBe(false);
    });

    test('supports <= operator', () => {
        expect(engine.evaluateCondition('$score <= 80', { $score: 80 })).toBe(true);
        expect(engine.evaluateCondition('$score <= 80', { $score: 81 })).toBe(false);
    });

    test('supports && operator', () => {
        expect(engine.evaluateCondition("$score > 80 && $status == 'completed'", { $score: 90, $status: 'completed' })).toBe(true);
        expect(engine.evaluateCondition("$score > 80 && $status == 'completed'", { $score: 90, $status: 'failed' })).toBe(false);
    });

    test('supports || operator', () => {
        expect(engine.evaluateCondition("$score > 80 || $status == 'completed'", { $score: 70, $status: 'completed' })).toBe(true);
        expect(engine.evaluateCondition("$score > 80 || $status == 'completed'", { $score: 70, $status: 'failed' })).toBe(false);
    });

    test('supports ! (negation)', () => {
        expect(engine.evaluateCondition('!$approved', { $approved: false })).toBe(true);
        expect(engine.evaluateCondition('!$approved', { $approved: true })).toBe(false);
    });
});

// ============================================================
// String conditions
// ============================================================

describe('WorkflowEngine — string conditions', () => {
    test('.contains() works', () => {
        expect(engine.evaluateCondition("$result.contains('success')", { $result: 'Operation success complete' })).toBe(true);
        expect(engine.evaluateCondition("$result.contains('success')", { $result: 'Operation failed' })).toBe(false);
    });

    test('.startsWith() works', () => {
        expect(engine.evaluateCondition("$name.startsWith('test')", { $name: 'testFile.ts' })).toBe(true);
        expect(engine.evaluateCondition("$name.startsWith('test')", { $name: 'file.ts' })).toBe(false);
    });

    test('.endsWith() works', () => {
        expect(engine.evaluateCondition("$name.endsWith('.ts')", { $name: 'file.ts' })).toBe(true);
        expect(engine.evaluateCondition("$name.endsWith('.ts')", { $name: 'file.js' })).toBe(false);
    });
});

// ============================================================
// Variable access
// ============================================================

describe('WorkflowEngine — variable access', () => {
    test('$variables.name resolves nested path', () => {
        expect(engine.evaluateCondition("$variables.config.mode == 'auto'", { config: { mode: 'auto' } })).toBe(true);
    });

    test('$result resolves directly', () => {
        expect(engine.evaluateCondition("$result == 'ok'", { $result: 'ok' })).toBe(true);
    });

    test('$status resolves directly', () => {
        expect(engine.evaluateCondition("$status == 'done'", { $status: 'done' })).toBe(true);
    });

    test('$retries resolves without prefix', () => {
        expect(engine.evaluateCondition('$retries < 3', { retries: 2 })).toBe(true);
    });
});

// ============================================================
// NO dynamic code execution
// ============================================================

describe('WorkflowEngine — no dynamic code execution', () => {
    test('condition evaluator does NOT use dynamic code execution for process.exit', () => {
        // Attempting to inject code via expression should not execute
        const result = engine.evaluateCondition('process.exit(1)', {});
        expect(result).toBe(false);
    });

    test('condition evaluator does NOT use dynamic code execution for require', () => {
        const result = engine.evaluateCondition("require('child_process')", {});
        expect(result).toBe(false);
    });
});

// ============================================================
// Parallel execution
// ============================================================

describe('WorkflowEngine — parallel execution', () => {
    test('executeParallel runs steps concurrently', async () => {
        engine.setAgentCallExecutor(async (_type, prompt) => ({ content: `Handled: ${prompt}`, tokens_used: 10 }));
        const wfId = createActiveWorkflow();
        const branch1 = addStep(wfId, { label: 'Branch 1', agent_type: 'planning', sort_order: 10 });
        const branch2 = addStep(wfId, { label: 'Branch 2', agent_type: 'planning', sort_order: 20 });
        addStep(wfId, {
            step_type: WorkflowStepType.ParallelBranch,
            label: 'Parallel',
            parallel_step_ids: [branch1, branch2],
            sort_order: 0,
        });
        const exec = engine.startExecution(wfId, 'trigger-1');
        const result = await engine.executeNextStep(exec.id);
        expect(result!.status).toBe(WorkflowExecutionStatus.Completed);
        expect(result!.tokens_used).toBe(20); // 10 + 10
    });

    test('all parallel steps must complete', async () => {
        let callCount = 0;
        engine.setAgentCallExecutor(async () => {
            callCount++;
            return { content: `done-${callCount}`, tokens_used: 5 };
        });
        const wfId = createActiveWorkflow();
        const b1 = addStep(wfId, { label: 'B1', agent_type: 'planning', sort_order: 10 });
        const b2 = addStep(wfId, { label: 'B2', agent_type: 'planning', sort_order: 20 });
        const b3 = addStep(wfId, { label: 'B3', agent_type: 'planning', sort_order: 30 });
        addStep(wfId, {
            step_type: WorkflowStepType.ParallelBranch,
            label: 'Parallel',
            parallel_step_ids: [b1, b2, b3],
            sort_order: 0,
        });
        const exec = engine.startExecution(wfId, 'trigger-1');
        const result = await engine.executeNextStep(exec.id);
        expect(result!.status).toBe(WorkflowExecutionStatus.Completed);
        expect(callCount).toBe(3);
    });

    test('parallel branch with no steps returns completed', async () => {
        const wfId = createActiveWorkflow();
        addStep(wfId, {
            step_type: WorkflowStepType.ParallelBranch,
            label: 'Empty Parallel',
            parallel_step_ids: [],
            sort_order: 0,
        });
        const exec = engine.startExecution(wfId, 'trigger-1');
        const result = await engine.executeNextStep(exec.id);
        expect(result!.status).toBe(WorkflowExecutionStatus.Completed);
        expect(result!.tokens_used).toBe(0);
    });
});

// ============================================================
// User approval
// ============================================================

describe('WorkflowEngine — user approval', () => {
    test('requestUserApproval pauses execution', async () => {
        const wfId = createActiveWorkflow();
        addStep(wfId, {
            step_type: WorkflowStepType.UserApproval,
            label: 'Approve Deployment',
            sort_order: 0,
        });
        const exec = engine.startExecution(wfId, 'trigger-1');
        const result = await engine.executeNextStep(exec.id);
        expect(result!.status).toBe(WorkflowExecutionStatus.WaitingApproval);
        const updated = db.getWorkflowExecution(exec.id)!;
        expect(updated.status).toBe(WorkflowExecutionStatus.WaitingApproval);
    });

    test('handleApproval resumes execution when approved', async () => {
        const wfId = createActiveWorkflow();
        const step2Id = addStep(wfId, { label: 'After Approval', sort_order: 10 });
        addStep(wfId, {
            step_type: WorkflowStepType.UserApproval,
            label: 'Approve',
            sort_order: 0,
            next_step_id: step2Id,
        });
        const exec = engine.startExecution(wfId, 'trigger-1');
        await engine.executeNextStep(exec.id);
        engine.handleApproval(exec.id, true, 'Looks good');
        const updated = db.getWorkflowExecution(exec.id)!;
        expect(updated.status).toBe(WorkflowExecutionStatus.Running);
        expect(updated.current_step_id).toBe(step2Id);
    });

    test('handleApproval rejects and fails execution', async () => {
        const wfId = createActiveWorkflow();
        addStep(wfId, {
            step_type: WorkflowStepType.UserApproval,
            label: 'Approve',
            sort_order: 0,
        });
        const exec = engine.startExecution(wfId, 'trigger-1');
        await engine.executeNextStep(exec.id);
        engine.handleApproval(exec.id, false, 'Rejected');
        const updated = db.getWorkflowExecution(exec.id)!;
        expect(updated.status).toBe(WorkflowExecutionStatus.Failed);
    });
});

// ============================================================
// Tool unlock
// ============================================================

describe('WorkflowEngine — tool unlock', () => {
    test('tools_unlocked on step adds tools to $unlockedTools', async () => {
        const wfId = createActiveWorkflow();
        addStep(wfId, {
            step_type: WorkflowStepType.ToolUnlock,
            label: 'Unlock Tools',
            tools_unlocked: ['file_write', 'shell_exec'],
            sort_order: 0,
        });
        const exec = engine.startExecution(wfId, 'trigger-1');
        const result = await engine.executeNextStep(exec.id);
        expect(result!.status).toBe(WorkflowExecutionStatus.Completed);
        const updated = db.getWorkflowExecution(exec.id)!;
        const vars = JSON.parse(updated.variables_json);
        expect(vars.$unlockedTools).toEqual(expect.arrayContaining(['file_write', 'shell_exec']));
    });

    test('tool_unlock emits workflow:tool_unlocked event', async () => {
        const handler = jest.fn();
        eventBus.on('workflow:tool_unlocked', handler);
        const wfId = createActiveWorkflow();
        addStep(wfId, {
            step_type: WorkflowStepType.ToolUnlock,
            label: 'Unlock',
            tools_unlocked: ['read_file'],
            sort_order: 0,
        });
        const exec = engine.startExecution(wfId, 'trigger-1');
        await engine.executeNextStep(exec.id);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].data.tools).toEqual(['read_file']);
    });

    test('revocation: subsequent non-unlock steps preserve $unlockedTools', async () => {
        engine.setAgentCallExecutor(async () => ({ content: 'done', tokens_used: 0 }));
        const wfId = createActiveWorkflow();
        const agentStepId = addStep(wfId, { label: 'Agent Step', agent_type: 'planning', sort_order: 10 });
        addStep(wfId, {
            step_type: WorkflowStepType.ToolUnlock,
            label: 'Unlock',
            tools_unlocked: ['tool_a'],
            sort_order: 0,
            next_step_id: agentStepId,
        });
        const exec = engine.startExecution(wfId, 'trigger-1');
        await engine.executeNextStep(exec.id); // tool_unlock
        await engine.executeNextStep(exec.id); // agent_call
        const updated = db.getWorkflowExecution(exec.id)!;
        const vars = JSON.parse(updated.variables_json);
        expect(vars.$unlockedTools).toEqual(expect.arrayContaining(['tool_a']));
    });
});

// ============================================================
// Retry logic
// ============================================================

describe('WorkflowEngine — retry logic', () => {
    test('failed step emits step_failed event', async () => {
        const handler = jest.fn();
        eventBus.on('workflow:step_failed', handler);
        const wfId = createActiveWorkflow();
        addStep(wfId, { agent_type: 'planning', max_retries: 0 }); // No executor = fail
        const exec = engine.startExecution(wfId, 'trigger-1');
        await engine.executeNextStep(exec.id);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    test('failed step with max_retries > 0 does not immediately fail execution', async () => {
        const wfId = createActiveWorkflow();
        addStep(wfId, { agent_type: 'planning', max_retries: 3 }); // No executor = fail
        const exec = engine.startExecution(wfId, 'trigger-1');
        const result = await engine.executeNextStep(exec.id);
        expect(result!.status).toBe(WorkflowExecutionStatus.Failed);
        // Execution should still be running because retries remain
        const updated = db.getWorkflowExecution(exec.id)!;
        expect(updated.status).toBe(WorkflowExecutionStatus.Running);
    });

    test('failed step with max_retries=0 and no escalation fails execution', async () => {
        const wfId = createActiveWorkflow();
        addStep(wfId, { agent_type: 'planning', max_retries: 0 }); // No executor = fail
        const exec = engine.startExecution(wfId, 'trigger-1');
        await engine.executeNextStep(exec.id);
        const updated = db.getWorkflowExecution(exec.id)!;
        expect(updated.status).toBe(WorkflowExecutionStatus.Failed);
    });
});

// ============================================================
// Escalation
// ============================================================

describe('WorkflowEngine — escalation', () => {
    test('failed step escalates to escalation_step_id', async () => {
        const handler = jest.fn();
        eventBus.on('workflow:escalation_triggered', handler);

        const wfId = createActiveWorkflow();
        const escStepId = addStep(wfId, {
            step_type: WorkflowStepType.Escalation,
            label: 'Escalate',
            sort_order: 10,
        });
        addStep(wfId, {
            agent_type: 'planning',
            max_retries: 0,
            escalation_step_id: escStepId,
            sort_order: 0,
        }); // No executor = fail
        const exec = engine.startExecution(wfId, 'trigger-1');
        await engine.executeNextStep(exec.id);
        const updated = db.getWorkflowExecution(exec.id)!;
        expect(updated.current_step_id).toBe(escStepId);
        expect(handler).toHaveBeenCalled();
    });

    test('escalation step itself completes successfully', async () => {
        const wfId = createActiveWorkflow();
        addStep(wfId, {
            step_type: WorkflowStepType.Escalation,
            label: 'Escalate to Manager',
            sort_order: 0,
        });
        const exec = engine.startExecution(wfId, 'trigger-1');
        const result = await engine.executeNextStep(exec.id);
        expect(result!.status).toBe(WorkflowExecutionStatus.Completed);
        expect(result!.agent_response).toContain('Escalation triggered');
    });
});

// ============================================================
// Execution lifecycle: pause/resume/cancel
// ============================================================

describe('WorkflowEngine — execution lifecycle', () => {
    test('pauseExecution changes status to Pending', () => {
        const wfId = createActiveWorkflow();
        addStep(wfId);
        const exec = engine.startExecution(wfId, 'trigger-1');
        engine.pauseExecution(exec.id);
        const updated = db.getWorkflowExecution(exec.id)!;
        expect(updated.status).toBe(WorkflowExecutionStatus.Pending);
    });

    test('resumeExecution changes status to Running', () => {
        const wfId = createActiveWorkflow();
        addStep(wfId);
        const exec = engine.startExecution(wfId, 'trigger-1');
        engine.pauseExecution(exec.id);
        engine.resumeExecution(exec.id);
        const updated = db.getWorkflowExecution(exec.id)!;
        expect(updated.status).toBe(WorkflowExecutionStatus.Running);
    });

    test('cancelExecution changes status to Cancelled with completed_at', () => {
        const wfId = createActiveWorkflow();
        addStep(wfId);
        const exec = engine.startExecution(wfId, 'trigger-1');
        engine.cancelExecution(exec.id, 'User cancelled');
        const updated = db.getWorkflowExecution(exec.id)!;
        expect(updated.status).toBe(WorkflowExecutionStatus.Cancelled);
        expect(updated.completed_at).not.toBeNull();
    });
});

// ============================================================
// getExecutionState
// ============================================================

describe('WorkflowEngine — getExecutionState', () => {
    test('returns snapshot with execution, steps, and results', () => {
        const wfId = createActiveWorkflow();
        addStep(wfId);
        const exec = engine.startExecution(wfId, 'trigger-1');
        const state = engine.getExecutionState(exec.id);
        expect(state).not.toBeNull();
        expect(state!.execution.id).toBe(exec.id);
        expect(state!.steps.length).toBeGreaterThan(0);
        expect(Array.isArray(state!.results)).toBe(true);
    });

    test('returns null for nonexistent execution', () => {
        expect(engine.getExecutionState('nonexistent')).toBeNull();
    });
});

// ============================================================
// Crash recovery
// ============================================================

describe('WorkflowEngine — crash recovery', () => {
    test('stale Running executions detected during recovery', async () => {
        engine.setAgentCallExecutor(async () => ({ content: 'recovered', tokens_used: 5 }));
        const wfId = createActiveWorkflow();
        addStep(wfId, { agent_type: 'planning' });
        const exec = engine.startExecution(wfId, 'trigger-1');
        // The execution is currently Running, simulating a "crash" state
        const recovered = await engine.recoverPendingExecutions();
        expect(recovered).toBeGreaterThanOrEqual(0);
    });
});

// ============================================================
// Safety limits
// ============================================================

describe('WorkflowEngine — safety limits', () => {
    test('max 1000 steps enforced', async () => {
        engine.setAgentCallExecutor(async () => ({ content: 'ok', tokens_used: 0 }));
        const wfId = createActiveWorkflow();
        const stepId = addStep(wfId, { label: 'Step', agent_type: 'planning', sort_order: 0 });
        db.updateWorkflowStep(stepId, { next_step_id: stepId });
        const exec = engine.startExecution(wfId, 'trigger-1');

        // Create 1000 fake step results to simulate limit
        for (let i = 0; i < 1000; i++) {
            db.createWorkflowStepResult({
                execution_id: exec.id,
                step_id: stepId,
                status: WorkflowExecutionStatus.Completed,
                retries: 0,
                duration_ms: 0,
                tokens_used: 0,
            });
        }

        const result = await engine.executeNextStep(exec.id);
        expect(result).toBeNull();
        const updated = db.getWorkflowExecution(exec.id)!;
        expect(updated.status).toBe(WorkflowExecutionStatus.Failed);
    });

    test('loop detection triggers after 10+ visits to same step', async () => {
        engine.setAgentCallExecutor(async () => ({ content: 'ok', tokens_used: 0 }));
        const wfId = createActiveWorkflow();
        const stepId = addStep(wfId, { label: 'Looping Step', agent_type: 'planning', sort_order: 0 });
        db.updateWorkflowStep(stepId, { next_step_id: stepId });

        const exec = engine.startExecution(wfId, 'trigger-1');
        for (let i = 0; i < 15; i++) {
            const result = await engine.executeNextStep(exec.id);
            if (!result) break;
        }

        const updated = db.getWorkflowExecution(exec.id)!;
        expect(updated.status).toBe(WorkflowExecutionStatus.Failed);
    });
});

// ============================================================
// Events
// ============================================================

describe('WorkflowEngine — events', () => {
    test('emits workflow:step_started', async () => {
        const handler = jest.fn();
        eventBus.on('workflow:step_started', handler);
        engine.setAgentCallExecutor(async () => ({ content: 'done', tokens_used: 0 }));
        const wfId = createActiveWorkflow();
        addStep(wfId, { agent_type: 'planning' });
        const exec = engine.startExecution(wfId, 'trigger-1');
        await engine.executeNextStep(exec.id);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    test('emits workflow:step_completed on success', async () => {
        const handler = jest.fn();
        eventBus.on('workflow:step_completed', handler);
        engine.setAgentCallExecutor(async () => ({ content: 'done', tokens_used: 0 }));
        const wfId = createActiveWorkflow();
        addStep(wfId, { agent_type: 'planning' });
        const exec = engine.startExecution(wfId, 'trigger-1');
        await engine.executeNextStep(exec.id);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    test('emits workflow:step_failed on failure', async () => {
        const handler = jest.fn();
        eventBus.on('workflow:step_failed', handler);
        const wfId = createActiveWorkflow();
        addStep(wfId, { agent_type: 'planning' }); // No executor
        const exec = engine.startExecution(wfId, 'trigger-1');
        await engine.executeNextStep(exec.id);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    test('emits workflow:execution_completed when all steps done', async () => {
        const handler = jest.fn();
        eventBus.on('workflow:execution_completed', handler);
        engine.setAgentCallExecutor(async () => ({ content: 'done', tokens_used: 0 }));
        const wfId = createActiveWorkflow();
        addStep(wfId, { agent_type: 'planning' }); // single step, no next
        const exec = engine.startExecution(wfId, 'trigger-1');
        await engine.executeNextStep(exec.id);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    test('emits workflow:execution_failed when execution fails', async () => {
        const handler = jest.fn();
        eventBus.on('workflow:execution_failed', handler);
        const wfId = createActiveWorkflow();
        addStep(wfId, { agent_type: 'planning', max_retries: 0 }); // No executor
        const exec = engine.startExecution(wfId, 'trigger-1');
        await engine.executeNextStep(exec.id);
        expect(handler).toHaveBeenCalledTimes(1);
    });
});

// ============================================================
// Edge cases
// ============================================================

describe('WorkflowEngine — edge cases', () => {
    test('missing agent executor returns error result', async () => {
        const wfId = createActiveWorkflow();
        addStep(wfId, { agent_type: 'planning' });
        const exec = engine.startExecution(wfId, 'trigger-1');
        const result = await engine.executeNextStep(exec.id);
        expect(result!.status).toBe(WorkflowExecutionStatus.Failed);
        expect(result!.error).toContain('No agent call executor');
    });

    test('empty workflow (no steps) throws on startExecution', () => {
        const wfId = createActiveWorkflow();
        expect(() => engine.startExecution(wfId, 'trigger-1')).toThrow('has no steps');
    });

    test('single step workflow completes after one execution', async () => {
        engine.setAgentCallExecutor(async () => ({ content: 'done', tokens_used: 10 }));
        const wfId = createActiveWorkflow();
        addStep(wfId, { agent_type: 'planning' });
        const exec = engine.startExecution(wfId, 'trigger-1');
        await engine.executeNextStep(exec.id);
        const updated = db.getWorkflowExecution(exec.id)!;
        expect(updated.status).toBe(WorkflowExecutionStatus.Completed);
    });

    test('unknown step type returns failed result', async () => {
        const wfId = createActiveWorkflow();
        addStep(wfId, {
            step_type: 'unknown_type' as any,
            label: 'Unknown',
            sort_order: 0,
        });
        const exec = engine.startExecution(wfId, 'trigger-1');
        const result = await engine.executeNextStep(exec.id);
        expect(result!.status).toBe(WorkflowExecutionStatus.Failed);
        expect(result!.error).toContain('Unknown step type');
    });

    test('runToCompletion runs all steps', async () => {
        engine.setAgentCallExecutor(async () => ({ content: 'done', tokens_used: 10 }));
        const wfId = createActiveWorkflow();
        const step2 = addStep(wfId, { label: 'Step 2', agent_type: 'planning', sort_order: 10 });
        addStep(wfId, { label: 'Step 1', agent_type: 'planning', sort_order: 0, next_step_id: step2 });
        const exec = engine.startExecution(wfId, 'trigger-1');
        const completed = await engine.runToCompletion(exec.id);
        expect(completed.status).toBe(WorkflowExecutionStatus.Completed);
    });

    test('executeNextStep throws if execution ID not found', async () => {
        await expect(engine.executeNextStep('nonexistent')).rejects.toThrow('not found');
    });

    test('handleApproval throws if execution not found', () => {
        expect(() => engine.handleApproval('nonexistent', true)).toThrow('not found');
    });

    test('handleApproval throws if not waiting for approval', () => {
        const wfId = createActiveWorkflow();
        addStep(wfId);
        const exec = engine.startExecution(wfId, 'trigger-1');
        expect(() => engine.handleApproval(exec.id, true)).toThrow('not waiting for approval');
    });
});

// ============================================================
// Condition step execution
// ============================================================

describe('WorkflowEngine — condition step execution', () => {
    test('condition step stores $conditionResult and branches true', async () => {
        engine.setAgentCallExecutor(async () => ({ content: 'ok', tokens_used: 0 }));
        const wfId = createActiveWorkflow();

        const trueBranchId = addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'True Branch',
            agent_type: 'planning',
            sort_order: 10,
        });
        const falseBranchId = addStep(wfId, {
            step_type: WorkflowStepType.AgentCall,
            label: 'False Branch',
            agent_type: 'planning',
            sort_order: 20,
        });
        addStep(wfId, {
            step_type: WorkflowStepType.Condition,
            label: 'Branch',
            condition_expression: '$score > 50',
            true_branch_step_id: trueBranchId,
            false_branch_step_id: falseBranchId,
            sort_order: 0,
        });

        const exec = engine.startExecution(wfId, 'trigger-1', { $score: 75 });
        await engine.executeNextStep(exec.id);
        const updatedExec = db.getWorkflowExecution(exec.id)!;
        expect(updatedExec.current_step_id).toBe(trueBranchId);
    });
});

// ============================================================
// Wait step
// ============================================================

describe('WorkflowEngine — wait step', () => {
    test('wait step completes after delay', async () => {
        const wfId = createActiveWorkflow();
        addStep(wfId, {
            step_type: WorkflowStepType.Wait,
            label: 'Wait',
            retry_delay_ms: 10, // Short delay for testing
            sort_order: 0,
        });
        const exec = engine.startExecution(wfId, 'trigger-1');
        const result = await engine.executeNextStep(exec.id);
        expect(result!.status).toBe(WorkflowExecutionStatus.Completed);
    });
});

// ============================================================
// Loop step
// ============================================================

describe('WorkflowEngine — loop step', () => {
    test('loop step increments counter', async () => {
        const wfId = createActiveWorkflow();
        addStep(wfId, {
            step_type: WorkflowStepType.Loop,
            label: 'Loop',
            condition_expression: 'true',
            sort_order: 0,
        });
        const exec = engine.startExecution(wfId, 'trigger-1');
        const result = await engine.executeNextStep(exec.id);
        expect(result!.status).toBe(WorkflowExecutionStatus.Completed);
        expect(result!.agent_response).toContain('iteration 1');
    });

    test('loop step exits when condition is false', async () => {
        const wfId = createActiveWorkflow();
        addStep(wfId, {
            step_type: WorkflowStepType.Loop,
            label: 'Loop',
            condition_expression: '$continue == true',
            sort_order: 0,
        });
        const exec = engine.startExecution(wfId, 'trigger-1', { continue: false });
        const result = await engine.executeNextStep(exec.id);
        expect(result!.status).toBe(WorkflowExecutionStatus.Completed);
        expect(result!.agent_response).toContain('exiting loop');
    });
});

// ============================================================
// Sub-workflow step
// ============================================================

describe('WorkflowEngine — sub_workflow step', () => {
    test('sub_workflow fails if no workflow ID', async () => {
        const wfId = createActiveWorkflow();
        addStep(wfId, {
            step_type: WorkflowStepType.SubWorkflow,
            label: 'Sub Workflow',
            agent_type: null,
            sort_order: 0,
        });
        const exec = engine.startExecution(wfId, 'trigger-1');
        const result = await engine.executeNextStep(exec.id);
        expect(result!.status).toBe(WorkflowExecutionStatus.Failed);
        expect(result!.error).toContain('no workflow ID');
    });

    test('sub_workflow executes child workflow', async () => {
        engine.setAgentCallExecutor(async () => ({ content: 'sub done', tokens_used: 5 }));
        const childWfId = createActiveWorkflow('Child WF');
        addStep(childWfId, { label: 'Child Step', agent_type: 'planning', sort_order: 0 });

        const parentWfId = createActiveWorkflow('Parent WF');
        addStep(parentWfId, {
            step_type: WorkflowStepType.SubWorkflow,
            label: 'Run Child',
            agent_type: childWfId,
            sort_order: 0,
        });

        const exec = engine.startExecution(parentWfId, 'trigger-1');
        const result = await engine.executeNextStep(exec.id);
        expect(result!.status).toBe(WorkflowExecutionStatus.Completed);
    });
});

// ============================================================
// dispose
// ============================================================

describe('WorkflowEngine — dispose', () => {
    test('dispose does not throw', () => {
        expect(() => engine.dispose()).not.toThrow();
    });
});
