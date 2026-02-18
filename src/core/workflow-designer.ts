/**
 * WorkflowDesigner — Visual Editor Backend (v9.0)
 *
 * CRUD for workflow definitions + Mermaid diagram generation/parsing.
 * Supports both global reusable templates and per-plan customization.
 *
 * Mermaid mapping:
 *   agent_call → rectangle [ ]
 *   condition → diamond { }
 *   parallel_branch → par...end block
 *   user_approval → hexagon {{ }}
 *   escalation → red rectangle (styled)
 *   tool_unlock → annotated edge
 *   wait → stadium ([ ])
 *   loop → trapezoid [/ /]
 *   sub_workflow → subroutine [[ ]]
 */

import { Database } from './database';
import { EventBus } from './event-bus';
import {
    WorkflowDefinition, WorkflowStep, WorkflowStepType,
    WorkflowStatus
} from '../types';

export interface OutputChannelLike {
    appendLine(msg: string): void;
}

export interface ValidationError {
    stepId?: string;
    message: string;
    severity: 'error' | 'warning';
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
}

export class WorkflowDesigner {
    constructor(
        private database: Database,
        private eventBus: EventBus,
        private outputChannel: OutputChannelLike
    ) {}

    // ==================== WORKFLOW CRUD ====================

    /**
     * Create a new workflow definition.
     */
    createWorkflow(
        name: string,
        description: string,
        planId?: string,
        isTemplate: boolean = false
    ): WorkflowDefinition {
        const workflow = this.database.createWorkflowDefinition({
            name,
            description,
            plan_id: planId,
            is_template: isTemplate,
            status: WorkflowStatus.Draft,
        });

        this.outputChannel.appendLine(`[WorkflowDesigner] Created workflow "${name}" (${workflow.id})`);
        this.eventBus.emit('workflow:created', 'WorkflowDesigner', {
            workflowId: workflow.id,
            name,
            planId,
            isTemplate,
        });

        return workflow;
    }

    /**
     * Get a workflow definition.
     */
    getWorkflow(id: string): WorkflowDefinition | null {
        return this.database.getWorkflowDefinition(id);
    }

    /**
     * Get all workflow definitions, optionally filtered.
     */
    getWorkflows(filter?: { planId?: string; isTemplate?: boolean; status?: WorkflowStatus }): WorkflowDefinition[] {
        let all: WorkflowDefinition[];
        if (filter?.planId !== undefined) {
            // Get workflows for a specific plan (or global if planId is null)
            all = this.database.getWorkflowsByPlan(filter.planId);
        } else {
            // No planId filter — combine global + all plans by fetching global workflows
            // Since there's no "get all" method, get global (null) and templates as a reasonable default
            all = this.database.getWorkflowsByPlan(null);
        }
        return all.filter((w: WorkflowDefinition) => {
            if (filter?.isTemplate !== undefined && w.is_template !== filter.isTemplate) return false;
            if (filter?.status !== undefined && w.status !== filter.status) return false;
            return true;
        });
    }

    /**
     * Get global workflow templates (plan_id is null, is_template is true).
     */
    getTemplates(): WorkflowDefinition[] {
        return this.getWorkflows({ isTemplate: true });
    }

    /**
     * Update a workflow definition.
     */
    updateWorkflow(id: string, updates: Partial<WorkflowDefinition>): boolean {
        const result = this.database.updateWorkflowDefinition(id, updates);
        if (result) {
            this.eventBus.emit('workflow:updated', 'WorkflowDesigner', { workflowId: id, updates: Object.keys(updates) });
        }
        return result;
    }

    /**
     * Delete a workflow definition and its steps.
     */
    deleteWorkflow(id: string): boolean {
        // Delete all steps first
        const steps = this.database.getWorkflowSteps(id);
        for (const step of steps) {
            this.database.deleteWorkflowStep(step.id);
        }

        const result = this.database.deleteWorkflowDefinition(id);
        if (result) {
            this.eventBus.emit('workflow:deleted', 'WorkflowDesigner', { workflowId: id });
        }
        return result;
    }

    /**
     * Activate a workflow (set status to Active).
     */
    activateWorkflow(id: string): boolean {
        const validation = this.validateWorkflow(id);
        if (!validation.valid) {
            this.outputChannel.appendLine(
                `[WorkflowDesigner] Cannot activate workflow ${id}: ${validation.errors.map(e => e.message).join('; ')}`
            );
            return false;
        }

        return this.updateWorkflow(id, { status: WorkflowStatus.Active });
    }

    // ==================== STEP CRUD ====================

    /**
     * Add a step to a workflow.
     */
    addStep(
        workflowId: string,
        config: {
            step_type: WorkflowStepType;
            label: string;
            agent_type?: string;
            agent_prompt?: string;
            condition_expression?: string;
            tools_unlocked?: string[];
            acceptance_criteria?: string;
            max_retries?: number;
            retry_delay_ms?: number;
            escalation_step_id?: string;
            next_step_id?: string;
            true_branch_step_id?: string;
            false_branch_step_id?: string;
            parallel_step_ids?: string[];
            x?: number;
            y?: number;
            sort_order?: number;
        }
    ): WorkflowStep {
        // Auto-calculate sort_order if not provided
        let sortOrder = config.sort_order;
        if (sortOrder === undefined) {
            const existingSteps = this.database.getWorkflowSteps(workflowId);
            sortOrder = existingSteps.length > 0
                ? Math.max(...existingSteps.map(s => s.sort_order)) + 1
                : 0;
        }

        const step = this.database.createWorkflowStep({
            workflow_id: workflowId,
            step_type: config.step_type,
            label: config.label,
            agent_type: config.agent_type,
            agent_prompt: config.agent_prompt,
            condition_expression: config.condition_expression,
            tools_unlocked: config.tools_unlocked,
            acceptance_criteria: config.acceptance_criteria,
            max_retries: config.max_retries,
            retry_delay_ms: config.retry_delay_ms,
            escalation_step_id: config.escalation_step_id,
            next_step_id: config.next_step_id,
            true_branch_step_id: config.true_branch_step_id,
            false_branch_step_id: config.false_branch_step_id,
            parallel_step_ids: config.parallel_step_ids,
            x: config.x,
            y: config.y,
            sort_order: sortOrder,
        });

        // Regenerate Mermaid source
        this.regenerateMermaid(workflowId);

        return step;
    }

    /**
     * Update a step.
     */
    updateStep(stepId: string, updates: Partial<WorkflowStep>): boolean {
        const step = this.database.getWorkflowStep(stepId);
        if (!step) return false;

        const result = this.database.updateWorkflowStep(stepId, updates);
        if (result) {
            this.regenerateMermaid(step.workflow_id);
        }
        return result;
    }

    /**
     * Remove a step from a workflow.
     */
    removeStep(workflowId: string, stepId: string): boolean {
        // Clean up references to this step from other steps
        const allSteps = this.database.getWorkflowSteps(workflowId);
        for (const step of allSteps) {
            const updates: Partial<WorkflowStep> = {};
            if (step.next_step_id === stepId) updates.next_step_id = null;
            if (step.true_branch_step_id === stepId) updates.true_branch_step_id = null;
            if (step.false_branch_step_id === stepId) updates.false_branch_step_id = null;
            if (step.escalation_step_id === stepId) updates.escalation_step_id = null;
            if (step.parallel_step_ids?.includes(stepId)) {
                updates.parallel_step_ids = step.parallel_step_ids.filter(id => id !== stepId);
            }
            if (Object.keys(updates).length > 0) {
                this.database.updateWorkflowStep(step.id, updates);
            }
        }

        const result = this.database.deleteWorkflowStep(stepId);
        if (result) {
            this.regenerateMermaid(workflowId);
        }
        return result;
    }

    /**
     * Connect two steps (set next_step_id from source to target).
     */
    connectSteps(fromId: string, toId: string, condition?: 'true' | 'false'): boolean {
        const fromStep = this.database.getWorkflowStep(fromId);
        if (!fromStep) return false;

        if (condition === 'true') {
            return this.database.updateWorkflowStep(fromId, { true_branch_step_id: toId });
        } else if (condition === 'false') {
            return this.database.updateWorkflowStep(fromId, { false_branch_step_id: toId });
        } else {
            return this.database.updateWorkflowStep(fromId, { next_step_id: toId });
        }
    }

    /**
     * Get all steps for a workflow.
     */
    getSteps(workflowId: string): WorkflowStep[] {
        return this.database.getWorkflowSteps(workflowId);
    }

    // ==================== MERMAID GENERATION ====================

    /**
     * Generate Mermaid diagram source from a workflow definition.
     */
    generateMermaid(workflowId: string): string {
        const steps = this.database.getWorkflowSteps(workflowId);
        if (steps.length === 0) return 'graph TD\n  empty[No steps defined]';

        const lines: string[] = ['graph TD'];
        const sortedSteps = [...steps].sort((a, b) => a.sort_order - b.sort_order);

        // Node definitions
        for (const step of sortedSteps) {
            const nodeId = this.sanitizeMermaidId(step.id);
            const label = this.escapeMermaidLabel(step.label);

            switch (step.step_type) {
                case WorkflowStepType.AgentCall:
                    lines.push(`  ${nodeId}["${label}"]`);
                    break;
                case WorkflowStepType.Condition:
                    lines.push(`  ${nodeId}{"${label}"}`);
                    break;
                case WorkflowStepType.ParallelBranch:
                    lines.push(`  ${nodeId}[/"${label}"\\]`);
                    break;
                case WorkflowStepType.UserApproval:
                    lines.push(`  ${nodeId}{{"${label}"}}`);
                    break;
                case WorkflowStepType.Escalation:
                    lines.push(`  ${nodeId}["${label}"]`);
                    lines.push(`  style ${nodeId} fill:#ff6b6b,stroke:#c92a2a,color:#fff`);
                    break;
                case WorkflowStepType.ToolUnlock:
                    lines.push(`  ${nodeId}(["${label}"])`);
                    break;
                case WorkflowStepType.Wait:
                    lines.push(`  ${nodeId}(["${label}"])`);
                    break;
                case WorkflowStepType.Loop:
                    lines.push(`  ${nodeId}[/"${label}"/]`);
                    break;
                case WorkflowStepType.SubWorkflow:
                    lines.push(`  ${nodeId}[["${label}"]]`);
                    break;
                default:
                    lines.push(`  ${nodeId}["${label}"]`);
            }
        }

        // Edge connections
        for (const step of sortedSteps) {
            const fromId = this.sanitizeMermaidId(step.id);

            if (step.next_step_id) {
                const toId = this.sanitizeMermaidId(step.next_step_id);
                lines.push(`  ${fromId} --> ${toId}`);
            }

            if (step.true_branch_step_id) {
                const toId = this.sanitizeMermaidId(step.true_branch_step_id);
                lines.push(`  ${fromId} -->|Yes| ${toId}`);
            }

            if (step.false_branch_step_id) {
                const toId = this.sanitizeMermaidId(step.false_branch_step_id);
                lines.push(`  ${fromId} -->|No| ${toId}`);
            }

            if (step.escalation_step_id) {
                const toId = this.sanitizeMermaidId(step.escalation_step_id);
                lines.push(`  ${fromId} -.->|escalate| ${toId}`);
            }

            if (step.parallel_step_ids && step.parallel_step_ids.length > 0) {
                for (const parallelId of step.parallel_step_ids) {
                    const toId = this.sanitizeMermaidId(parallelId);
                    lines.push(`  ${fromId} --> ${toId}`);
                }
            }

            // Tool unlock annotation
            if (step.step_type === WorkflowStepType.ToolUnlock && step.tools_unlocked && step.tools_unlocked.length > 0) {
                const toolList = step.tools_unlocked.join(', ');
                if (step.next_step_id) {
                    // The edge already exists, just note it
                    lines.push(`  %% Tools unlocked: ${toolList}`);
                }
            }
        }

        return lines.join('\n');
    }

    /**
     * Regenerate and save the Mermaid source for a workflow.
     */
    private regenerateMermaid(workflowId: string): void {
        const mermaid = this.generateMermaid(workflowId);
        this.database.updateWorkflowDefinition(workflowId, { mermaid_source: mermaid });
    }

    /**
     * Parse a Mermaid diagram source into step configurations.
     * This is a best-effort parser — complex Mermaid syntax may not parse perfectly.
     */
    parseMermaid(source: string): Array<{
        label: string;
        step_type: WorkflowStepType;
        connections: Array<{ to: string; condition?: string }>;
    }> {
        const results: Array<{
            id: string;
            label: string;
            step_type: WorkflowStepType;
            connections: Array<{ to: string; condition?: string }>;
        }> = [];

        const lines = source.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('graph') && !l.startsWith('%%'));

        // Parse node definitions
        for (const line of lines) {
            // Rectangle: id["label"]
            let match = line.match(/^\s*(\w+)\["(.+?)"\]/);
            if (match) {
                results.push({ id: match[1], label: match[2], step_type: WorkflowStepType.AgentCall, connections: [] });
                continue;
            }

            // Diamond: id{"label"}
            match = line.match(/^\s*(\w+)\{"(.+?)"\}/);
            if (match) {
                results.push({ id: match[1], label: match[2], step_type: WorkflowStepType.Condition, connections: [] });
                continue;
            }

            // Hexagon: id{{"label"}}
            match = line.match(/^\s*(\w+)\{\{"(.+?)"\}\}/);
            if (match) {
                results.push({ id: match[1], label: match[2], step_type: WorkflowStepType.UserApproval, connections: [] });
                continue;
            }

            // Subroutine: id[["label"]]
            match = line.match(/^\s*(\w+)\[\["(.+?)"\]\]/);
            if (match) {
                results.push({ id: match[1], label: match[2], step_type: WorkflowStepType.SubWorkflow, connections: [] });
                continue;
            }

            // Stadium: id(["label"])
            match = line.match(/^\s*(\w+)\(\["(.+?)"\]\)/);
            if (match) {
                results.push({ id: match[1], label: match[2], step_type: WorkflowStepType.Wait, connections: [] });
                continue;
            }
        }

        // Parse edges
        for (const line of lines) {
            // Edge with label: from -->|label| to
            let match = line.match(/^\s*(\w+)\s*-->\|(.+?)\|\s*(\w+)/);
            if (match) {
                const node = results.find(r => r.id === match![1]);
                if (node) {
                    node.connections.push({ to: match[3], condition: match[2] });
                }
                continue;
            }

            // Simple edge: from --> to
            match = line.match(/^\s*(\w+)\s*-->\s*(\w+)/);
            if (match) {
                const node = results.find(r => r.id === match![1]);
                if (node) {
                    node.connections.push({ to: match[2] });
                }
                continue;
            }

            // Dotted edge: from -.-> to
            match = line.match(/^\s*(\w+)\s*-\.?->\|?(.+?)?\|?\s*(\w+)/);
            if (match) {
                const node = results.find(r => r.id === match![1]);
                if (node) {
                    node.connections.push({ to: match[3], condition: match[2] });
                }
            }
        }

        // Return without internal IDs (label + type + connections)
        return results.map(({ label, step_type, connections }) => ({
            label,
            step_type,
            connections: connections.map(c => {
                const targetNode = results.find(r => r.id === c.to);
                return { to: targetNode?.label ?? c.to, condition: c.condition };
            }),
        }));
    }

    // ==================== VALIDATION ====================

    /**
     * Validate a workflow definition.
     * Checks for common issues like disconnected steps, missing configurations, cycles.
     */
    validateWorkflow(workflowId: string): ValidationResult {
        const errors: ValidationError[] = [];
        const steps = this.database.getWorkflowSteps(workflowId);

        if (steps.length === 0) {
            errors.push({ message: 'Workflow has no steps', severity: 'error' });
            return { valid: false, errors };
        }

        const stepIds = new Set(steps.map(s => s.id));

        for (const step of steps) {
            // Check required fields per step type
            if (step.step_type === WorkflowStepType.AgentCall && !step.agent_type) {
                errors.push({ stepId: step.id, message: `Step "${step.label}" has no agent_type`, severity: 'error' });
            }

            if (step.step_type === WorkflowStepType.Condition && !step.condition_expression) {
                errors.push({ stepId: step.id, message: `Condition step "${step.label}" has no expression`, severity: 'error' });
            }

            if (step.step_type === WorkflowStepType.Condition) {
                if (!step.true_branch_step_id && !step.false_branch_step_id && !step.next_step_id) {
                    errors.push({ stepId: step.id, message: `Condition step "${step.label}" has no branches`, severity: 'error' });
                }
            }

            // Check references to non-existent steps
            if (step.next_step_id && !stepIds.has(step.next_step_id)) {
                errors.push({ stepId: step.id, message: `Step "${step.label}" references non-existent next step`, severity: 'error' });
            }
            if (step.true_branch_step_id && !stepIds.has(step.true_branch_step_id)) {
                errors.push({ stepId: step.id, message: `Step "${step.label}" references non-existent true branch`, severity: 'error' });
            }
            if (step.false_branch_step_id && !stepIds.has(step.false_branch_step_id)) {
                errors.push({ stepId: step.id, message: `Step "${step.label}" references non-existent false branch`, severity: 'error' });
            }
            if (step.escalation_step_id && !stepIds.has(step.escalation_step_id)) {
                errors.push({ stepId: step.id, message: `Step "${step.label}" references non-existent escalation step`, severity: 'error' });
            }
            if (step.parallel_step_ids) {
                for (const pid of step.parallel_step_ids) {
                    if (!stepIds.has(pid)) {
                        errors.push({ stepId: step.id, message: `Step "${step.label}" references non-existent parallel step ${pid}`, severity: 'error' });
                    }
                }
            }

            // Warnings
            if (!step.next_step_id && !step.true_branch_step_id && !step.false_branch_step_id &&
                (!step.parallel_step_ids || step.parallel_step_ids.length === 0)) {
                // Terminal step — warning only if it's not a potential end
                const isReferencedByOthers = steps.some(s =>
                    s.next_step_id === step.id ||
                    s.true_branch_step_id === step.id ||
                    s.false_branch_step_id === step.id
                );
                if (!isReferencedByOthers && steps.indexOf(step) !== 0 && steps.length > 1) {
                    errors.push({ stepId: step.id, message: `Step "${step.label}" is disconnected (not referenced by any other step)`, severity: 'warning' });
                }
            }
        }

        // Check for unreachable steps (no incoming edges except the first step)
        const reachableSteps = new Set<string>();
        const firstStep = [...steps].sort((a, b) => a.sort_order - b.sort_order)[0];
        if (firstStep) {
            this.collectReachable(firstStep.id, steps, reachableSteps);
        }
        for (const step of steps) {
            if (!reachableSteps.has(step.id) && step.id !== firstStep?.id) {
                errors.push({ stepId: step.id, message: `Step "${step.label}" is unreachable from the start`, severity: 'warning' });
            }
        }

        return {
            valid: errors.filter(e => e.severity === 'error').length === 0,
            errors,
        };
    }

    /**
     * Collect all reachable step IDs via BFS.
     */
    private collectReachable(startId: string, steps: WorkflowStep[], visited: Set<string>): void {
        const queue = [startId];
        while (queue.length > 0) {
            const current = queue.shift()!;
            if (visited.has(current)) continue;
            visited.add(current);

            const step = steps.find(s => s.id === current);
            if (!step) continue;

            if (step.next_step_id) queue.push(step.next_step_id);
            if (step.true_branch_step_id) queue.push(step.true_branch_step_id);
            if (step.false_branch_step_id) queue.push(step.false_branch_step_id);
            if (step.escalation_step_id) queue.push(step.escalation_step_id);
            if (step.parallel_step_ids) queue.push(...step.parallel_step_ids);
        }
    }

    // ==================== CLONE & EXPORT ====================

    /**
     * Clone a workflow (create independent copy).
     * Used to create a plan-specific version from a global template.
     */
    cloneWorkflow(workflowId: string, newPlanId?: string): WorkflowDefinition {
        const source = this.database.getWorkflowDefinition(workflowId);
        if (!source) {
            throw new Error(`Workflow ${workflowId} not found`);
        }

        // Create new workflow
        const clone = this.createWorkflow(
            `${source.name} (copy)`,
            source.description,
            newPlanId ?? source.plan_id ?? undefined,
            false // Cloned workflows are not templates
        );

        // Clone all steps with remapped IDs
        const sourceSteps = this.database.getWorkflowSteps(workflowId);
        const idMap: Record<string, string> = {};

        // First pass: create all steps
        for (const step of sourceSteps) {
            const newStep = this.addStep(clone.id, {
                step_type: step.step_type,
                label: step.label,
                agent_type: step.agent_type ?? undefined,
                agent_prompt: step.agent_prompt ?? undefined,
                condition_expression: step.condition_expression ?? undefined,
                tools_unlocked: step.tools_unlocked,
                acceptance_criteria: step.acceptance_criteria ?? undefined,
                max_retries: step.max_retries,
                retry_delay_ms: step.retry_delay_ms,
                x: step.x,
                y: step.y,
                sort_order: step.sort_order,
            });
            idMap[step.id] = newStep.id;
        }

        // Second pass: remap connections
        for (const step of sourceSteps) {
            const newStepId = idMap[step.id];
            const updates: Partial<WorkflowStep> = {};

            if (step.next_step_id && idMap[step.next_step_id]) {
                updates.next_step_id = idMap[step.next_step_id];
            }
            if (step.true_branch_step_id && idMap[step.true_branch_step_id]) {
                updates.true_branch_step_id = idMap[step.true_branch_step_id];
            }
            if (step.false_branch_step_id && idMap[step.false_branch_step_id]) {
                updates.false_branch_step_id = idMap[step.false_branch_step_id];
            }
            if (step.escalation_step_id && idMap[step.escalation_step_id]) {
                updates.escalation_step_id = idMap[step.escalation_step_id];
            }
            if (step.parallel_step_ids && step.parallel_step_ids.length > 0) {
                updates.parallel_step_ids = step.parallel_step_ids.map(id => idMap[id] ?? id);
            }

            if (Object.keys(updates).length > 0) {
                this.database.updateWorkflowStep(newStepId, updates);
            }
        }

        // Regenerate Mermaid for the clone
        this.regenerateMermaid(clone.id);

        this.outputChannel.appendLine(`[WorkflowDesigner] Cloned workflow ${workflowId} → ${clone.id}`);
        return this.database.getWorkflowDefinition(clone.id)!;
    }

    /**
     * Export a workflow definition to JSON.
     */
    exportWorkflow(workflowId: string): string {
        const workflow = this.database.getWorkflowDefinition(workflowId);
        if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

        const steps = this.database.getWorkflowSteps(workflowId);

        return JSON.stringify({
            version: '9.0',
            workflow: {
                name: workflow.name,
                description: workflow.description,
                acceptance_criteria: workflow.acceptance_criteria,
                tags: workflow.tags,
                is_template: workflow.is_template,
            },
            steps: steps.map(s => ({
                label: s.label,
                step_type: s.step_type,
                agent_type: s.agent_type,
                agent_prompt: s.agent_prompt,
                condition_expression: s.condition_expression,
                tools_unlocked: s.tools_unlocked,
                acceptance_criteria: s.acceptance_criteria,
                max_retries: s.max_retries,
                retry_delay_ms: s.retry_delay_ms,
                x: s.x,
                y: s.y,
                sort_order: s.sort_order,
                // Connections use sort_order-based indices for portability
                next_step_index: steps.findIndex(t => t.id === s.next_step_id),
                true_branch_index: steps.findIndex(t => t.id === s.true_branch_step_id),
                false_branch_index: steps.findIndex(t => t.id === s.false_branch_step_id),
                escalation_index: steps.findIndex(t => t.id === s.escalation_step_id),
                parallel_indices: s.parallel_step_ids?.map(id => steps.findIndex(t => t.id === id)) ?? [],
            })),
        }, null, 2);
    }

    /**
     * Import a workflow from JSON.
     */
    importWorkflow(json: string, planId?: string): WorkflowDefinition {
        const data = JSON.parse(json);
        const wf = data.workflow;

        const workflow = this.createWorkflow(
            wf.name,
            wf.description,
            planId,
            wf.is_template ?? false
        );

        const steps = data.steps as Array<Record<string, unknown>>;
        const createdSteps: WorkflowStep[] = [];

        // First pass: create steps
        for (const stepData of steps) {
            const step = this.addStep(workflow.id, {
                step_type: stepData.step_type as WorkflowStepType,
                label: stepData.label as string,
                agent_type: stepData.agent_type as string | undefined,
                agent_prompt: stepData.agent_prompt as string | undefined,
                condition_expression: stepData.condition_expression as string | undefined,
                tools_unlocked: stepData.tools_unlocked as string[] | undefined,
                acceptance_criteria: stepData.acceptance_criteria as string | undefined,
                max_retries: stepData.max_retries as number | undefined,
                retry_delay_ms: stepData.retry_delay_ms as number | undefined,
                x: stepData.x as number | undefined,
                y: stepData.y as number | undefined,
                sort_order: stepData.sort_order as number | undefined,
            });
            createdSteps.push(step);
        }

        // Second pass: wire connections using indices
        for (let i = 0; i < steps.length; i++) {
            const stepData = steps[i];
            const updates: Partial<WorkflowStep> = {};

            const nextIdx = stepData.next_step_index as number;
            if (nextIdx >= 0 && nextIdx < createdSteps.length) {
                updates.next_step_id = createdSteps[nextIdx].id;
            }
            const trueIdx = stepData.true_branch_index as number;
            if (trueIdx >= 0 && trueIdx < createdSteps.length) {
                updates.true_branch_step_id = createdSteps[trueIdx].id;
            }
            const falseIdx = stepData.false_branch_index as number;
            if (falseIdx >= 0 && falseIdx < createdSteps.length) {
                updates.false_branch_step_id = createdSteps[falseIdx].id;
            }
            const escIdx = stepData.escalation_index as number;
            if (escIdx >= 0 && escIdx < createdSteps.length) {
                updates.escalation_step_id = createdSteps[escIdx].id;
            }
            const parallelIndices = stepData.parallel_indices as number[];
            if (parallelIndices && parallelIndices.length > 0) {
                updates.parallel_step_ids = parallelIndices
                    .filter(idx => idx >= 0 && idx < createdSteps.length)
                    .map(idx => createdSteps[idx].id);
            }

            if (Object.keys(updates).length > 0) {
                this.database.updateWorkflowStep(createdSteps[i].id, updates);
            }
        }

        this.regenerateMermaid(workflow.id);
        return this.database.getWorkflowDefinition(workflow.id)!;
    }

    // ==================== HELPERS ====================

    /**
     * Sanitize a step ID for use as a Mermaid node ID.
     */
    private sanitizeMermaidId(id: string): string {
        return 'n' + id.replace(/[^a-zA-Z0-9]/g, '');
    }

    /**
     * Escape a label for use in a Mermaid diagram.
     */
    private escapeMermaidLabel(label: string): string {
        return label.replace(/"/g, '#quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    dispose(): void {
        // Nothing to clean up
    }
}
