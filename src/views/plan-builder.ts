import * as vscode from 'vscode';
import { Database } from '../core/database';
import { Task, Plan, TaskStatus, TaskPriority } from '../types';

interface PlanTreeNode {
    id: string;
    title: string;
    type: 'plan' | 'phase' | 'task';
    children: PlanTreeNode[];
    task?: Task;
}

interface ResponsiveElement {
    name: string;
    elementType: string;
    description: string;
    visibility: { mobile: boolean; tablet: boolean; desktop: boolean };
    properties: Record<string, string>;
}

export class PlanBuilderPanel {
    private panel: vscode.WebviewPanel | null = null;
    private database: Database;
    private extensionUri: vscode.Uri;

    constructor(database: Database, extensionUri: vscode.Uri) {
        this.database = database;
        this.extensionUri = extensionUri;
    }

    open(): void {
        if (this.panel) {
            this.panel.reveal();
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'coePlanBuilder',
            'COE — Plan Builder',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        this.panel.webview.html = this.getWebviewContent();

        this.panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'getPlans':
                    this.sendPlansData();
                    break;
                case 'getPlanTasks':
                    this.sendPlanTasks(message.planId);
                    break;
                case 'updateTask':
                    this.database.updateTask(message.taskId, message.updates);
                    this.sendPlanTasks(message.planId);
                    break;
                case 'createTask':
                    this.database.createTask(message.task);
                    this.sendPlanTasks(message.planId);
                    break;
                case 'deleteTask':
                    this.database.deleteTask(message.taskId);
                    this.sendPlanTasks(message.planId);
                    break;
                case 'reorderTask': {
                    // Move task to new position by updating dependencies
                    const task = this.database.getTask(message.taskId);
                    if (task && message.newParentId) {
                        this.database.updateTask(message.taskId, {
                            parent_task_id: message.newParentId,
                        });
                    }
                    this.sendPlanTasks(message.planId);
                    break;
                }
                case 'exportMarkdown':
                    this.exportPlanAsMarkdown(message.planId);
                    break;
            }
        });

        this.panel.onDidDispose(() => {
            this.panel = null;
        });
    }

    private sendPlansData(): void {
        const plans = this.database.getAllPlans();
        this.panel?.webview.postMessage({ type: 'plansData', plans });
    }

    private sendPlanTasks(planId: string): void {
        const plan = this.database.getPlan(planId);
        if (!plan) return;
        const tasks = this.database.getTasksByPlan(planId);
        const tree = this.buildTree(plan, tasks);
        this.panel?.webview.postMessage({ type: 'planTasksData', plan, tasks, tree });
    }

    private buildTree(plan: Plan, tasks: Task[]): PlanTreeNode {
        const root: PlanTreeNode = {
            id: plan.id,
            title: plan.name,
            type: 'plan',
            children: [],
        };

        // Group tasks: parent tasks are phases, child tasks are children
        const parentTasks = tasks.filter(t => !t.parent_task_id);
        const childMap = new Map<string, Task[]>();
        for (const t of tasks) {
            if (t.parent_task_id) {
                const children = childMap.get(t.parent_task_id) || [];
                children.push(t);
                childMap.set(t.parent_task_id, children);
            }
        }

        for (const parent of parentTasks) {
            const children = childMap.get(parent.id) || [];
            const node: PlanTreeNode = {
                id: parent.id,
                title: parent.title,
                type: children.length > 0 ? 'phase' : 'task',
                task: parent,
                children: children.map(child => ({
                    id: child.id,
                    title: child.title,
                    type: 'task' as const,
                    task: child,
                    children: [],
                })),
            };
            root.children.push(node);
        }

        return root;
    }

    async exportPlanAsMarkdown(planId: string): Promise<void> {
        const plan = this.database.getPlan(planId);
        if (!plan) return;
        const tasks = this.database.getTasksByPlan(planId);

        const lines: string[] = [
            `# ${plan.name}`,
            '',
            `**Status**: ${plan.status}`,
            `**Created**: ${plan.created_at}`,
            '',
            '---',
            '',
        ];

        const parentTasks = tasks.filter(t => !t.parent_task_id);
        const childMap = new Map<string, Task[]>();
        for (const t of tasks) {
            if (t.parent_task_id) {
                const children = childMap.get(t.parent_task_id) || [];
                children.push(t);
                childMap.set(t.parent_task_id, children);
            }
        }

        for (const parent of parentTasks) {
            const statusIcon = parent.status === 'verified' ? '✅' : parent.status === 'in_progress' ? '🔄' : parent.status === 'failed' ? '❌' : '⬜';
            lines.push(`## ${statusIcon} ${parent.title}`);
            lines.push('');
            if (parent.description) {
                lines.push(parent.description);
                lines.push('');
            }
            lines.push(`- **Priority**: ${parent.priority}`);
            lines.push(`- **Status**: ${parent.status}`);
            lines.push(`- **Estimated**: ${parent.estimated_minutes} min`);
            if (parent.acceptance_criteria) {
                lines.push(`- **Acceptance Criteria**: ${parent.acceptance_criteria}`);
            }
            lines.push('');

            const children = childMap.get(parent.id) || [];
            for (const child of children) {
                const childIcon = child.status === 'verified' ? '✅' : child.status === 'in_progress' ? '🔄' : child.status === 'failed' ? '❌' : '⬜';
                lines.push(`### ${childIcon} ${child.title}`);
                if (child.description) lines.push(child.description);
                lines.push(`- Priority: ${child.priority} | Status: ${child.status} | Est: ${child.estimated_minutes}min`);
                if (child.acceptance_criteria) lines.push(`- Acceptance: ${child.acceptance_criteria}`);
                lines.push('');
            }
        }

        const verified = tasks.filter(t => t.status === 'verified').length;
        lines.push('---');
        lines.push('');
        lines.push(`**Progress**: ${verified}/${tasks.length} tasks verified (${tasks.length > 0 ? Math.round(verified / tasks.length * 100) : 0}%)`);

        const content = lines.join('\n');
        const doc = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { preview: true });
    }

    private getWebviewContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>COE Plan Builder</title>
<style>
:root {
    --bg: #1e1e2e; --bg2: #181825; --bg3: #313244; --surface: #45475a;
    --text: #cdd6f4; --subtext: #a6adc8; --overlay: #6c7086;
    --blue: #89b4fa; --green: #a6e3a1; --red: #f38ba8; --yellow: #f9e2af;
    --mauve: #cba6f7; --teal: #94e2d5; --peach: #fab387;
    --border: #45475a; --radius: 8px;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); display: flex; height: 100vh; overflow: hidden; }

/* LEFT SIDEBAR — Mac Finder style */
.sidebar { width: 280px; background: var(--bg2); border-right: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; }
.sidebar-header { padding: 16px; border-bottom: 1px solid var(--border); }
.sidebar-header h2 { font-size: 1em; color: var(--blue); }
.sidebar-header select { width: 100%; margin-top: 8px; padding: 6px 8px; background: var(--bg3); color: var(--text); border: 1px solid var(--border); border-radius: 4px; }
.tree { flex: 1; overflow-y: auto; padding: 8px; }
.tree-node { cursor: pointer; user-select: none; }
.tree-node-content { display: flex; align-items: center; padding: 6px 8px; border-radius: 4px; font-size: 0.9em; gap: 6px; }
.tree-node-content:hover { background: var(--bg3); }
.tree-node-content.selected { background: rgba(137,180,250,0.15); color: var(--blue); }
.tree-node-content .arrow { width: 16px; font-size: 0.7em; color: var(--overlay); transition: transform 0.15s; }
.tree-node-content .arrow.open { transform: rotate(90deg); }
.tree-node-content .icon { width: 16px; text-align: center; }
.tree-node-content .prio { font-size: 0.7em; font-weight: 700; margin-left: auto; }
.tree-node-content .prio.p1 { color: var(--red); }
.tree-node-content .prio.p2 { color: var(--yellow); }
.tree-node-content .prio.p3 { color: var(--overlay); }
.tree-children { padding-left: 20px; }
.tree-children.collapsed { display: none; }
.sidebar-actions { padding: 12px; border-top: 1px solid var(--border); display: flex; gap: 6px; }
.sidebar-actions button { flex: 1; padding: 6px; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8em; font-weight: 600; }
.btn-add { background: var(--blue); color: var(--bg); }
.btn-export { background: var(--bg3); color: var(--text); }

/* RIGHT PANEL — Task Detail */
.detail { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.detail-header { padding: 16px 20px; border-bottom: 1px solid var(--border); background: var(--bg2); }
.detail-header h1 { font-size: 1.2em; margin-bottom: 4px; }
.detail-header .meta { font-size: 0.85em; color: var(--subtext); display: flex; gap: 16px; }
.detail-body { flex: 1; overflow-y: auto; padding: 20px; }
.field { margin-bottom: 16px; }
.field label { display: block; font-size: 0.8em; font-weight: 600; color: var(--subtext); text-transform: uppercase; margin-bottom: 4px; }
.field input, .field textarea, .field select { width: 100%; padding: 8px 10px; background: var(--bg3); color: var(--text); border: 1px solid var(--border); border-radius: 4px; font-family: inherit; }
.field textarea { min-height: 80px; resize: vertical; }

/* Step list */
.step-list { list-style: none; }
.step-list li { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 4px; margin-bottom: 4px; background: var(--bg2); cursor: grab; font-size: 0.9em; }
.step-list li .grip { color: var(--overlay); cursor: grab; }
.step-list li .step-text { flex: 1; }
.step-list li .remove { color: var(--red); cursor: pointer; background: none; border: none; font-size: 1em; }

/* Responsive panel */
.responsive-section { border-top: 1px solid var(--border); margin-top: 16px; padding-top: 16px; }
.viewport-toggles { display: flex; gap: 4px; margin-bottom: 12px; }
.viewport-btn { padding: 6px 14px; border: 1px solid var(--border); border-radius: 4px; cursor: pointer; background: var(--bg2); color: var(--subtext); font-size: 0.85em; }
.viewport-btn.active { border-color: var(--blue); background: rgba(137,180,250,0.1); color: var(--blue); }
.element-table { width: 100%; border-collapse: collapse; font-size: 0.85em; }
.element-table th { text-align: left; padding: 6px 8px; font-weight: 600; color: var(--subtext); border-bottom: 1px solid var(--border); font-size: 0.8em; text-transform: uppercase; }
.element-table td { padding: 6px 8px; border-bottom: 1px solid var(--border); }
.vis-toggle { width: 16px; height: 16px; cursor: pointer; accent-color: var(--blue); }

/* Progress aggregate */
.progress-mini { height: 4px; background: var(--bg3); border-radius: 2px; width: 60px; display: inline-block; vertical-align: middle; margin-left: 8px; }
.progress-mini-fill { height: 100%; background: var(--green); border-radius: 2px; }

.empty-state { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--subtext); font-size: 1.1em; }

@media (max-width: 768px) {
    .sidebar { width: 200px; }
}
</style>
</head>
<body>

<div class="sidebar">
    <div class="sidebar-header">
        <h2>Plan Builder</h2>
        <select id="planSelect" onchange="selectPlan(this.value)">
            <option value="">Select a plan...</option>
        </select>
    </div>
    <div class="tree" id="treeContainer"></div>
    <div class="sidebar-actions">
        <button class="btn-add" onclick="addTask()">+ Task</button>
        <button class="btn-export" onclick="exportPlan()">Export</button>
    </div>
</div>

<div class="detail" id="detailPanel">
    <div class="empty-state" id="emptyState">Select a plan and task to begin editing</div>
</div>

<script>
const vscode = acquireVsCodeApi();
let plans = [];
let currentPlanId = null;
let currentTasks = [];
let currentTree = null;
let selectedTaskId = null;
let expandedNodes = new Set();
let currentViewport = 'desktop';

// Request initial data
vscode.postMessage({ command: 'getPlans' });

window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {
        case 'plansData':
            plans = msg.plans;
            renderPlanSelect();
            break;
        case 'planTasksData':
            currentTasks = msg.tasks;
            currentTree = msg.tree;
            renderTree();
            if (selectedTaskId) {
                const task = currentTasks.find(t => t.id === selectedTaskId);
                if (task) renderDetail(task);
            }
            break;
    }
});

function renderPlanSelect() {
    const sel = document.getElementById('planSelect');
    sel.innerHTML = '<option value="">Select a plan...</option>' +
        plans.map(p => '<option value="' + p.id + '">' + esc(p.name) + ' (' + p.status + ')</option>').join('');
}

function selectPlan(planId) {
    currentPlanId = planId;
    selectedTaskId = null;
    if (planId) {
        vscode.postMessage({ command: 'getPlanTasks', planId });
    } else {
        document.getElementById('treeContainer').innerHTML = '';
        document.getElementById('detailPanel').innerHTML = '<div class="empty-state">Select a plan to view tasks</div>';
    }
}

function renderTree() {
    if (!currentTree) return;
    const container = document.getElementById('treeContainer');
    container.innerHTML = renderTreeNode(currentTree, 0);
}

function renderTreeNode(node, depth) {
    if (node.type === 'plan') {
        return node.children.map(c => renderTreeNode(c, depth)).join('');
    }

    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedNodes.has(node.id);
    const isSelected = selectedTaskId === node.id;
    const task = node.task;

    const statusIcon = task ?
        (task.status === 'verified' ? '✅' : task.status === 'in_progress' ? '🔄' : task.status === 'failed' ? '❌' : task.status === 'decomposed' ? '📦' : '⬜') : '📁';

    let progress = '';
    if (hasChildren && task) {
        const total = node.children.length;
        const done = node.children.filter(c => c.task?.status === 'verified').length;
        const pct = total > 0 ? Math.round(done / total * 100) : 0;
        progress = '<span class="progress-mini"><span class="progress-mini-fill" style="width:' + pct + '%"></span></span> <span style="font-size:0.75em;color:var(--subtext)">' + done + '/' + total + '</span>';
    }

    const prioClass = task ? task.priority.toLowerCase() : '';

    let html = '<div class="tree-node">' +
        '<div class="tree-node-content' + (isSelected ? ' selected' : '') + '" onclick="selectTask(\\'' + node.id + '\\')" data-id="' + node.id + '">' +
        (hasChildren ? '<span class="arrow' + (isExpanded ? ' open' : '') + '" onclick="event.stopPropagation(); toggleNode(\\'' + node.id + '\\')">▶</span>' : '<span class="arrow"></span>') +
        '<span class="icon">' + statusIcon + '</span>' +
        '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(node.title) + '</span>' +
        progress +
        (task ? '<span class="prio ' + prioClass + '">' + task.priority + '</span>' : '') +
        '</div>';

    if (hasChildren) {
        html += '<div class="tree-children' + (isExpanded ? '' : ' collapsed') + '">';
        for (const child of node.children) {
            html += renderTreeNode(child, depth + 1);
        }
        html += '</div>';
    }

    html += '</div>';
    return html;
}

function toggleNode(id) {
    if (expandedNodes.has(id)) expandedNodes.delete(id);
    else expandedNodes.add(id);
    renderTree();
}

function selectTask(id) {
    selectedTaskId = id;
    renderTree();
    const task = currentTasks.find(t => t.id === id);
    if (task) renderDetail(task);
}

function renderDetail(task) {
    const panel = document.getElementById('detailPanel');
    const steps = task.context_bundle ? (() => {
        try { const ctx = JSON.parse(task.context_bundle); return ctx.step_by_step_implementation || []; } catch { return []; }
    })() : [];

    const files = task.files_modified || [];

    panel.innerHTML = '<div class="detail-header">' +
        '<h1>' + esc(task.title) + '</h1>' +
        '<div class="meta">' +
        '<span>Status: ' + task.status + '</span>' +
        '<span>Priority: ' + task.priority + '</span>' +
        '<span>Est: ' + task.estimated_minutes + ' min</span>' +
        '</div></div>' +
        '<div class="detail-body">' +
        '<div class="field"><label>Title</label><input type="text" value="' + escAttr(task.title) + '" onchange="updateField(\\'' + task.id + '\\', \\'title\\', this.value)"></div>' +
        '<div class="field"><label>Description</label><textarea onchange="updateField(\\'' + task.id + '\\', \\'description\\', this.value)">' + esc(task.description) + '</textarea></div>' +
        '<div class="field"><label>Acceptance Criteria</label><textarea onchange="updateField(\\'' + task.id + '\\', \\'acceptance_criteria\\', this.value)">' + esc(task.acceptance_criteria) + '</textarea></div>' +
        '<div class="field"><label>Priority</label><select onchange="updateField(\\'' + task.id + '\\', \\'priority\\', this.value)">' +
        '<option value="P1"' + (task.priority === 'P1' ? ' selected' : '') + '>P1 — Critical</option>' +
        '<option value="P2"' + (task.priority === 'P2' ? ' selected' : '') + '>P2 — Important</option>' +
        '<option value="P3"' + (task.priority === 'P3' ? ' selected' : '') + '>P3 — Nice to Have</option>' +
        '</select></div>' +
        '<div class="field"><label>Status</label><select onchange="updateField(\\'' + task.id + '\\', \\'status\\', this.value)">' +
        ['not_started','in_progress','blocked','pending_verification','verified','failed','decomposed','needs_recheck'].map(s =>
            '<option value="' + s + '"' + (task.status === s ? ' selected' : '') + '>' + s + '</option>'
        ).join('') +
        '</select></div>' +
        '<div class="field"><label>Estimated Minutes</label><input type="number" value="' + task.estimated_minutes + '" onchange="updateField(\\'' + task.id + '\\', \\'estimated_minutes\\', parseInt(this.value))"></div>' +
        '<div class="field"><label>Files Modified</label>' +
        '<div>' + files.map((f, i) => '<div style="display:flex;gap:4px;margin-bottom:4px"><code style="flex:1;padding:4px 8px;background:var(--bg3);border-radius:4px;font-size:0.85em">' + esc(f) + '</code></div>').join('') + '</div>' +
        '</div>' +

        // Responsive UI Design Spec section
        '<div class="responsive-section">' +
        '<h3 style="margin-bottom:8px">Responsive UI Spec</h3>' +
        '<div class="viewport-toggles">' +
        '<button class="viewport-btn' + (currentViewport === 'mobile' ? ' active' : '') + '" onclick="setViewport(\\'mobile\\')">Mobile (375px)</button>' +
        '<button class="viewport-btn' + (currentViewport === 'tablet' ? ' active' : '') + '" onclick="setViewport(\\'tablet\\')">Tablet (768px)</button>' +
        '<button class="viewport-btn' + (currentViewport === 'desktop' ? ' active' : '') + '" onclick="setViewport(\\'desktop\\')">Desktop (1280px)</button>' +
        '</div>' +
        '<table class="element-table">' +
        '<thead><tr><th>Element</th><th>Type</th><th>Visible</th></tr></thead>' +
        '<tbody id="elementsTable"></tbody>' +
        '</table>' +
        '</div>' +

        '<div style="margin-top:20px;display:flex;gap:8px">' +
        '<button style="padding:6px 14px;background:var(--red);color:var(--bg);border:none;border-radius:4px;cursor:pointer;font-weight:600" onclick="deleteTask(\\'' + task.id + '\\')">Delete Task</button>' +
        '</div></div>';
}

function updateField(taskId, field, value) {
    const updates = {};
    updates[field] = value;
    vscode.postMessage({ command: 'updateTask', taskId, planId: currentPlanId, updates });
}

function deleteTask(taskId) {
    vscode.postMessage({ command: 'deleteTask', taskId, planId: currentPlanId });
    selectedTaskId = null;
}

function addTask() {
    if (!currentPlanId) return;
    vscode.postMessage({
        command: 'createTask',
        planId: currentPlanId,
        task: {
            title: 'New Task',
            description: '',
            priority: 'P2',
            estimated_minutes: 30,
            acceptance_criteria: '',
            plan_id: currentPlanId,
        }
    });
}

function exportPlan() {
    if (!currentPlanId) return;
    vscode.postMessage({ command: 'exportMarkdown', planId: currentPlanId });
}

function setViewport(vp) {
    currentViewport = vp;
    document.querySelectorAll('.viewport-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.viewport-btn').forEach(b => {
        if (b.textContent.toLowerCase().includes(vp)) b.classList.add('active');
    });
}

function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function escAttr(s) { return (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
</script>
</body>
</html>`;
    }

    dispose(): void {
        this.panel?.dispose();
    }
}
