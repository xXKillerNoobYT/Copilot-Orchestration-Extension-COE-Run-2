import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../src/core/database';
import { EventBus } from '../src/core/event-bus';
import { WorkflowDesigner } from '../src/core/workflow-designer';
import {
    WorkflowStepType, WorkflowStatus,
} from '../src/types';

// ============================================================
// Shared test infrastructure
// ============================================================

let tmpDir: string;
let db: Database;
let eventBus: EventBus;
let designer: WorkflowDesigner;

const mockOutput = { appendLine: jest.fn() } as any;

beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-wf-designer-'));
    db = new Database(tmpDir);
    await db.initialize();
    eventBus = new EventBus();
    designer = new WorkflowDesigner(db, eventBus, mockOutput);
    jest.clearAllMocks();
});

afterEach(() => {
    eventBus.removeAllListeners();
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================
// createWorkflow
// ============================================================

describe('WorkflowDesigner — createWorkflow', () => {
    test('creates with name and description', () => {
        const wf = designer.createWorkflow('My Workflow', 'A test workflow');
        expect(wf).toBeDefined();
        expect(wf.name).toBe('My Workflow');
        expect(wf.description).toBe('A test workflow');
        expect(wf.status).toBe(WorkflowStatus.Draft);
        expect(wf.id).toBeDefined();
    });

    test('creates with planId', () => {
        const plan = db.createPlan('Test Plan');
        const wf = designer.createWorkflow('Plan WF', 'For plan', plan.id);
        expect(wf.plan_id).toBe(plan.id);
    });

    test('creates as template (isTemplate=true)', () => {
        const wf = designer.createWorkflow('Template', 'Reusable template', undefined, true);
        expect(wf.is_template).toBe(true);
    });

    test('emits workflow:created event', () => {
        const handler = jest.fn();
        eventBus.on('workflow:created', handler);
        designer.createWorkflow('WF', 'Desc');
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].data.name).toBe('WF');
    });
});

// ============================================================
// getWorkflow
// ============================================================

describe('WorkflowDesigner — getWorkflow', () => {
    test('returns created workflow', () => {
        const wf = designer.createWorkflow('WF', 'Desc');
        const retrieved = designer.getWorkflow(wf.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.name).toBe('WF');
        expect(retrieved!.id).toBe(wf.id);
    });

    test('returns null for bad ID', () => {
        expect(designer.getWorkflow('bad')).toBeNull();
    });
});

// ============================================================
// getAllWorkflows / getWorkflowTemplates / getWorkflowsByPlan
// ============================================================

describe('WorkflowDesigner — workflow queries', () => {
    test('getAllWorkflows returns all', () => {
        designer.createWorkflow('WF1', 'Desc1');
        designer.createWorkflow('WF2', 'Desc2');
        const all = designer.getWorkflows();
        expect(all.length).toBeGreaterThanOrEqual(2);
    });

    test('getWorkflowTemplates returns only templates', () => {
        designer.createWorkflow('Normal', 'Desc', undefined, false);
        designer.createWorkflow('Template 1', 'Desc', undefined, true);
        designer.createWorkflow('Template 2', 'Desc', undefined, true);
        const templates = designer.getTemplates();
        expect(templates.every(t => t.is_template)).toBe(true);
        expect(templates.length).toBeGreaterThanOrEqual(2);
    });

    test('getWorkflowsByPlan filters by plan', () => {
        const plan = db.createPlan('Plan');
        designer.createWorkflow('Plan WF', 'Desc', plan.id);
        designer.createWorkflow('Global WF', 'Desc');
        const planWfs = designer.getWorkflows({ planId: plan.id });
        expect(planWfs.length).toBeGreaterThanOrEqual(1);
        expect(planWfs.every(w => w.plan_id === plan.id)).toBe(true);
    });
});

// ============================================================
// updateWorkflow
// ============================================================

describe('WorkflowDesigner — updateWorkflow', () => {
    test('updates fields', () => {
        const wf = designer.createWorkflow('WF', 'Desc');
        const result = designer.updateWorkflow(wf.id, { name: 'Updated Name', description: 'Updated Desc' });
        expect(result).toBe(true);
        const updated = designer.getWorkflow(wf.id)!;
        expect(updated.name).toBe('Updated Name');
        expect(updated.description).toBe('Updated Desc');
    });
});

// ============================================================
// deleteWorkflow
// ============================================================

describe('WorkflowDesigner — deleteWorkflow', () => {
    test('removes workflow', () => {
        const wf = designer.createWorkflow('WF', 'Desc');
        designer.addStep(wf.id, { step_type: WorkflowStepType.AgentCall, label: 'Step' });
        const result = designer.deleteWorkflow(wf.id);
        expect(result).toBe(true);
        expect(designer.getWorkflow(wf.id)).toBeNull();
        expect(designer.getSteps(wf.id).length).toBe(0);
    });

    test('emits workflow:deleted event', () => {
        const handler = jest.fn();
        eventBus.on('workflow:deleted', handler);
        const wf = designer.createWorkflow('WF', 'Desc');
        designer.deleteWorkflow(wf.id);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].data.workflowId).toBe(wf.id);
    });
});

// ============================================================
// addStep
// ============================================================

describe('WorkflowDesigner — addStep', () => {
    test('adds agent_call step', () => {
        const wf = designer.createWorkflow('WF', 'Desc');
        const step = designer.addStep(wf.id, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Call Agent',
            agent_type: 'planning',
        });
        expect(step).toBeDefined();
        expect(step.step_type).toBe(WorkflowStepType.AgentCall);
        expect(step.label).toBe('Call Agent');
        expect(step.workflow_id).toBe(wf.id);
    });

    test('adds condition step', () => {
        const wf = designer.createWorkflow('WF', 'Desc');
        const step = designer.addStep(wf.id, {
            step_type: WorkflowStepType.Condition,
            label: 'Check Score',
            condition_expression: '$score > 80',
        });
        expect(step.step_type).toBe(WorkflowStepType.Condition);
    });

    test('adds user_approval step', () => {
        const wf = designer.createWorkflow('WF', 'Desc');
        const step = designer.addStep(wf.id, {
            step_type: WorkflowStepType.UserApproval,
            label: 'Approve Deployment',
        });
        expect(step.step_type).toBe(WorkflowStepType.UserApproval);
    });

    test('adds parallel_branch step', () => {
        const wf = designer.createWorkflow('WF', 'Desc');
        const step = designer.addStep(wf.id, {
            step_type: WorkflowStepType.ParallelBranch,
            label: 'Run in Parallel',
        });
        expect(step.step_type).toBe(WorkflowStepType.ParallelBranch);
    });
});

// ============================================================
// removeStep
// ============================================================

describe('WorkflowDesigner — removeStep', () => {
    test('removes step', () => {
        const wf = designer.createWorkflow('WF', 'Desc');
        const step = designer.addStep(wf.id, { step_type: WorkflowStepType.AgentCall, label: 'Step 1' });
        const result = designer.removeStep(wf.id, step.id);
        expect(result).toBe(true);
        expect(designer.getSteps(wf.id).length).toBe(0);
    });
});

// ============================================================
// getSteps
// ============================================================

describe('WorkflowDesigner — getSteps', () => {
    test('returns all steps for workflow', () => {
        const wf = designer.createWorkflow('WF', 'Desc');
        designer.addStep(wf.id, { step_type: WorkflowStepType.AgentCall, label: 'S1' });
        designer.addStep(wf.id, { step_type: WorkflowStepType.AgentCall, label: 'S2' });
        designer.addStep(wf.id, { step_type: WorkflowStepType.Condition, label: 'S3' });
        const steps = designer.getSteps(wf.id);
        expect(steps.length).toBe(3);
    });
});

// ============================================================
// connectSteps
// ============================================================

describe('WorkflowDesigner — connectSteps', () => {
    test('sets next_step_id', () => {
        const wf = designer.createWorkflow('WF', 'Desc');
        const step1 = designer.addStep(wf.id, { step_type: WorkflowStepType.AgentCall, label: 'Step 1' });
        const step2 = designer.addStep(wf.id, { step_type: WorkflowStepType.AgentCall, label: 'Step 2' });
        const result = designer.connectSteps(step1.id, step2.id);
        expect(result).toBe(true);
        const updated = db.getWorkflowStep(step1.id)!;
        expect(updated.next_step_id).toBe(step2.id);
    });

    test('sets true/false branch for condition', () => {
        const wf = designer.createWorkflow('WF', 'Desc');
        const cond = designer.addStep(wf.id, { step_type: WorkflowStepType.Condition, label: 'Check' });
        const trueTarget = designer.addStep(wf.id, { step_type: WorkflowStepType.AgentCall, label: 'Yes' });
        const falseTarget = designer.addStep(wf.id, { step_type: WorkflowStepType.AgentCall, label: 'No' });

        designer.connectSteps(cond.id, trueTarget.id, 'true');
        designer.connectSteps(cond.id, falseTarget.id, 'false');

        const updated = db.getWorkflowStep(cond.id)!;
        expect(updated.true_branch_step_id).toBe(trueTarget.id);
        expect(updated.false_branch_step_id).toBe(falseTarget.id);
    });
});

// ============================================================
// validateWorkflow
// ============================================================

describe('WorkflowDesigner — validateWorkflow', () => {
    test('returns valid for connected workflow', () => {
        const wf = designer.createWorkflow('WF', 'Desc');
        const s1 = designer.addStep(wf.id, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Step 1',
            agent_type: 'planning',
            sort_order: 0,
        });
        const s2 = designer.addStep(wf.id, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Step 2',
            agent_type: 'planning',
            sort_order: 10,
        });
        designer.connectSteps(s1.id, s2.id);
        const result = designer.validateWorkflow(wf.id);
        expect(result.valid).toBe(true);
    });

    test('returns error for orphan steps (no connections)', () => {
        const wf = designer.createWorkflow('WF', 'Desc');
        designer.addStep(wf.id, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Start',
            agent_type: 'planning',
            sort_order: 0,
        });
        designer.addStep(wf.id, {
            step_type: WorkflowStepType.AgentCall,
            label: 'Orphan',
            agent_type: 'planning',
            sort_order: 10,
        });
        const result = designer.validateWorkflow(wf.id);
        expect(result.errors.some(e => e.message.includes('unreachable'))).toBe(true);
    });

    test('returns error for workflow with no steps', () => {
        const wf = designer.createWorkflow('WF', 'Desc');
        const result = designer.validateWorkflow(wf.id);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.message.includes('no steps'))).toBe(true);
    });
});

// ============================================================
// generateMermaid
// ============================================================

describe('WorkflowDesigner — generateMermaid', () => {
    test('generates Mermaid diagram string', () => {
        const wf = designer.createWorkflow('WF', 'Desc');
        designer.addStep(wf.id, { step_type: WorkflowStepType.AgentCall, label: 'My Step' });
        const mermaid = designer.generateMermaid(wf.id);
        expect(mermaid).toContain('graph TD');
        expect(mermaid).toContain('My Step');
    });

    test('includes conditions as diamonds', () => {
        const wf = designer.createWorkflow('WF', 'Desc');
        designer.addStep(wf.id, { step_type: WorkflowStepType.Condition, label: 'Check Score' });
        const mermaid = designer.generateMermaid(wf.id);
        expect(mermaid).toMatch(/\{"Check Score"\}/);
    });

    test('returns empty diagram for non-existent workflow (no steps)', () => {
        const wf = designer.createWorkflow('Empty', 'Desc');
        const mermaid = designer.generateMermaid(wf.id);
        expect(mermaid).toContain('No steps defined');
    });
});

// ============================================================
// cloneWorkflow
// ============================================================

describe('WorkflowDesigner — cloneWorkflow', () => {
    test('creates copy with new ID', () => {
        const wf = designer.createWorkflow('Original', 'Desc');
        designer.addStep(wf.id, { step_type: WorkflowStepType.AgentCall, label: 'Step 1', agent_type: 'planning' });
        const clone = designer.cloneWorkflow(wf.id);
        expect(clone.id).not.toBe(wf.id);
        expect(clone.name).toContain('copy');
    });

    test('copies all steps', () => {
        const wf = designer.createWorkflow('Original', 'Desc');
        const s1 = designer.addStep(wf.id, { step_type: WorkflowStepType.AgentCall, label: 'S1', agent_type: 'planning', sort_order: 0 });
        const s2 = designer.addStep(wf.id, { step_type: WorkflowStepType.AgentCall, label: 'S2', agent_type: 'planning', sort_order: 10 });
        designer.connectSteps(s1.id, s2.id);

        const clone = designer.cloneWorkflow(wf.id);
        const cloneSteps = designer.getSteps(clone.id);
        expect(cloneSteps.length).toBe(2);
        // IDs should differ from originals
        expect(cloneSteps.every(s => s.id !== s1.id && s.id !== s2.id)).toBe(true);
        // Connection should be remapped to new IDs
        const clonedS1 = cloneSteps.find(s => s.label === 'S1')!;
        const clonedS2 = cloneSteps.find(s => s.label === 'S2')!;
        expect(clonedS1.next_step_id).toBe(clonedS2.id);
    });
});

// ============================================================
// exportWorkflow / importWorkflow
// ============================================================

describe('WorkflowDesigner — export / import', () => {
    test('exportWorkflow returns JSON', () => {
        const wf = designer.createWorkflow('Export WF', 'Desc');
        designer.addStep(wf.id, { step_type: WorkflowStepType.AgentCall, label: 'Step', agent_type: 'planning' });
        const json = designer.exportWorkflow(wf.id);
        const parsed = JSON.parse(json);
        expect(parsed.version).toBe('9.0');
        expect(parsed.workflow.name).toBe('Export WF');
        expect(parsed.steps.length).toBe(1);
    });

    test('importWorkflow creates workflow from JSON', () => {
        const wf = designer.createWorkflow('Original', 'Desc');
        const s1 = designer.addStep(wf.id, { step_type: WorkflowStepType.AgentCall, label: 'S1', agent_type: 'research', sort_order: 0 });
        const s2 = designer.addStep(wf.id, { step_type: WorkflowStepType.AgentCall, label: 'S2', agent_type: 'planning', sort_order: 10 });
        designer.connectSteps(s1.id, s2.id);
        const json = designer.exportWorkflow(wf.id);

        const imported = designer.importWorkflow(json);
        expect(imported.name).toBe('Original');
        const steps = designer.getSteps(imported.id);
        expect(steps.length).toBe(2);
        expect(steps.some(s => s.label === 'S1')).toBe(true);
        expect(steps.some(s => s.label === 'S2')).toBe(true);
        // Connections should be wired up via index
        const importedS1 = steps.find(s => s.label === 'S1')!;
        const importedS2 = steps.find(s => s.label === 'S2')!;
        expect(importedS1.next_step_id).toBe(importedS2.id);
    });
});

// ============================================================
// dispose
// ============================================================

describe('WorkflowDesigner — dispose', () => {
    test('dispose does not throw', () => {
        expect(() => designer.dispose()).not.toThrow();
    });
});
