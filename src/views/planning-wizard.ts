import * as vscode from 'vscode';
import { Database } from '../core/database';
import { LLMService } from '../core/llm-service';
import { Orchestrator } from '../agents/orchestrator';
import { AgentContext, PlanStatus, TaskPriority } from '../types';

export class PlanningWizardPanel {
    private static currentPanel: PlanningWizardPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        private database: Database,
        private orchestrator: Orchestrator,
        private onPlanCreated: () => void
    ) {
        this.panel = panel;
        this.panel.webview.html = this.getHtml();

        this.panel.webview.onDidReceiveMessage(
            async (msg) => {
                switch (msg.command) {
                    case 'generatePlan':
                        await this.generatePlan(msg.data);
                        break;
                    case 'quickPlan':
                        await this.quickPlan(msg.data);
                        break;
                }
            },
            undefined,
            this.disposables
        );

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }

    static show(
        extensionUri: vscode.Uri,
        database: Database,
        orchestrator: Orchestrator,
        onPlanCreated: () => void
    ): void {
        if (PlanningWizardPanel.currentPanel) {
            PlanningWizardPanel.currentPanel.panel.reveal();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'coePlanningWizard',
            'COE: Planning Wizard',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        PlanningWizardPanel.currentPanel = new PlanningWizardPanel(panel, database, orchestrator, onPlanCreated);
    }

    private async quickPlan(data: { name: string; description: string }): Promise<void> {
        this.panel.webview.postMessage({ command: 'status', text: 'Creating plan...' });
        try {
            const ctx: AgentContext = { conversationHistory: [] };
            const response = await this.orchestrator.callAgent('planning',
                `Create a structured plan called "${data.name}" for: ${data.description}.\nBreak it into atomic tasks (15-45 min each) with clear acceptance criteria, dependencies, and priority (P1/P2/P3).`, ctx);
            this.panel.webview.postMessage({ command: 'planCreated', text: response.content });
            this.onPlanCreated();
        } catch (e) {
            this.panel.webview.postMessage({ command: 'error', text: String(e) });
        }
    }

    private async generatePlan(data: {
        name: string;
        scale: string;
        focus: string;
        priorities: string[];
        description: string;
    }): Promise<void> {
        this.panel.webview.postMessage({ command: 'status', text: 'Generating plan with AI...' });
        try {
            const prompt = [
                `Create a structured development plan called "${data.name}".`,
                `Project Scale: ${data.scale}`,
                `Primary Focus: ${data.focus}`,
                `Key Priorities: ${data.priorities.join(', ')}`,
                `Description: ${data.description}`,
                '',
                'Generate atomic tasks (15-45 min each) with:',
                '- Clear title and description',
                '- Acceptance criteria',
                '- Priority (P1 = critical, P2 = important, P3 = nice-to-have)',
                '- Dependencies (which tasks must complete first)',
                '- Estimated minutes',
                '',
                'Return as JSON: { "plan_name": "...", "tasks": [{ "title": "...", "description": "...", "priority": "P1|P2|P3", "estimated_minutes": N, "acceptance_criteria": "...", "depends_on_titles": [] }] }',
            ].join('\n');

            const ctx: AgentContext = { conversationHistory: [] };
            const response = await this.orchestrator.callAgent('planning', prompt, ctx);

            // Try to parse structured response
            try {
                const jsonMatch = response.content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    if (parsed.tasks && Array.isArray(parsed.tasks)) {
                        // Create plan and tasks in database
                        const plan = this.database.createPlan(data.name, JSON.stringify({
                            scale: data.scale,
                            focus: data.focus,
                            priorities: data.priorities,
                        }));
                        this.database.updatePlan(plan.id, { status: PlanStatus.Active });

                        // Create tasks with dependency resolution
                        const titleToId: Record<string, string> = {};
                        for (const t of parsed.tasks) {
                            const deps = (t.depends_on_titles || [])
                                .map((title: string) => titleToId[title])
                                .filter(Boolean);
                            const task = this.database.createTask({
                                title: t.title,
                                description: t.description || '',
                                priority: (['P1', 'P2', 'P3'].includes(t.priority) ? t.priority : 'P2') as TaskPriority,
                                estimated_minutes: t.estimated_minutes || 30,
                                acceptance_criteria: t.acceptance_criteria || '',
                                plan_id: plan.id,
                                dependencies: deps,
                            });
                            titleToId[t.title] = task.id;
                        }

                        this.database.addAuditLog('planning', 'plan_created',
                            `Plan "${data.name}": ${parsed.tasks.length} tasks`);

                        this.panel.webview.postMessage({
                            command: 'planCreated',
                            text: `Plan "${data.name}" created with ${parsed.tasks.length} tasks!\n\nTasks:\n${parsed.tasks.map((t: any, i: number) => `${i + 1}. [${t.priority}] ${t.title} (${t.estimated_minutes}min)`).join('\n')}`,
                        });
                        this.onPlanCreated();
                        return;
                    }
                }
            } catch { /* fall through to raw response */ }

            this.panel.webview.postMessage({ command: 'planCreated', text: response.content });
            this.onPlanCreated();
        } catch (e) {
            this.panel.webview.postMessage({ command: 'error', text: String(e) });
        }
    }

    private getHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; max-width: 700px; margin: 0 auto; }
    h1 { color: var(--vscode-textLink-foreground); font-size: 1.5em; margin-bottom: 4px; }
    h2 { font-size: 1.1em; margin-top: 20px; margin-bottom: 8px; }
    .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 20px; }
    label { display: block; margin-top: 12px; font-weight: bold; }
    input[type="text"], textarea, select {
        width: 100%; padding: 8px; margin-top: 4px;
        background: var(--vscode-input-background); color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border); border-radius: 3px;
        font-family: inherit; font-size: inherit;
    }
    textarea { min-height: 80px; resize: vertical; }
    .radio-group { display: flex; gap: 10px; margin-top: 6px; flex-wrap: wrap; }
    .radio-group label { font-weight: normal; padding: 8px 16px; border: 1px solid var(--vscode-input-border);
        border-radius: 4px; cursor: pointer; transition: all 0.15s; }
    .radio-group label:hover { border-color: var(--vscode-focusBorder); }
    .radio-group input:checked + span { color: var(--vscode-textLink-foreground); }
    .radio-group label:has(input:checked) { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); }
    .checkbox-group { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
    .checkbox-group label { font-weight: normal; padding: 6px 12px; border: 1px solid var(--vscode-input-border);
        border-radius: 4px; cursor: pointer; }
    .checkbox-group label:has(input:checked) { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); }
    button {
        padding: 10px 24px; margin-top: 20px; cursor: pointer; font-size: 1em;
        background: var(--vscode-button-background); color: var(--vscode-button-foreground);
        border: none; border-radius: 4px; font-weight: bold;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .btn-row { display: flex; gap: 10px; }
    .step { display: none; }
    .step.active { display: block; }
    .step-indicator { display: flex; gap: 8px; margin-bottom: 20px; }
    .step-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--vscode-input-border); }
    .step-dot.active { background: var(--vscode-textLink-foreground); }
    .step-dot.done { background: var(--vscode-testing-iconPassed); }
    #output { margin-top: 16px; padding: 12px; background: var(--vscode-textBlockQuote-background);
        border-left: 3px solid var(--vscode-textLink-foreground); white-space: pre-wrap; display: none; max-height: 400px; overflow-y: auto; }
    .impact-box { margin-top: 16px; padding: 12px; border: 1px solid var(--vscode-input-border); border-radius: 4px; }
    .impact-box h3 { margin: 0 0 8px; font-size: 0.95em; }
    .impact-row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid var(--vscode-input-border); }
    .hidden { display: none; }
    .spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid var(--vscode-foreground);
        border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<h1>Planning Wizard</h1>
<p class="subtitle">Create a structured development plan with AI-generated atomic tasks</p>

<div class="step-indicator">
    <div class="step-dot active" id="dot0"></div>
    <div class="step-dot" id="dot1"></div>
    <div class="step-dot" id="dot2"></div>
    <div class="step-dot" id="dot3"></div>
</div>

<!-- Step 0: Name -->
<div class="step active" id="step0">
    <h2>Step 1: Project Name</h2>
    <label>Plan Name
        <input type="text" id="planName" placeholder="e.g., My Web App MVP" autofocus>
    </label>
    <label>Description
        <textarea id="planDesc" placeholder="Describe what you want to build in a few sentences..."></textarea>
    </label>
    <div class="btn-row">
        <button onclick="nextStep(1)">Next</button>
        <button class="secondary" onclick="quickGenerate()">Quick Generate (skip wizard)</button>
    </div>
</div>

<!-- Step 1: Scale -->
<div class="step" id="step1">
    <h2>Step 2: Project Scale</h2>
    <div class="radio-group">
        <label><input type="radio" name="scale" value="MVP" checked><span> MVP (quick prototype)</span></label>
        <label><input type="radio" name="scale" value="Small"><span> Small (single feature)</span></label>
        <label><input type="radio" name="scale" value="Medium"><span> Medium (multi-page app)</span></label>
        <label><input type="radio" name="scale" value="Large"><span> Large (multiple modules)</span></label>
        <label><input type="radio" name="scale" value="Enterprise"><span> Enterprise</span></label>
    </div>
    <div class="btn-row">
        <button class="secondary" onclick="prevStep(0)">Back</button>
        <button onclick="nextStep(2)">Next</button>
    </div>
</div>

<!-- Step 2: Focus -->
<div class="step" id="step2">
    <h2>Step 3: Primary Focus</h2>
    <div class="radio-group">
        <label><input type="radio" name="focus" value="Frontend" checked><span> Frontend / Visual Design</span></label>
        <label><input type="radio" name="focus" value="Backend"><span> Backend / Data / APIs</span></label>
        <label><input type="radio" name="focus" value="Full Stack"><span> Full Stack</span></label>
        <label><input type="radio" name="focus" value="Custom"><span> Custom</span></label>
    </div>
    <div class="btn-row">
        <button class="secondary" onclick="prevStep(1)">Back</button>
        <button onclick="nextStep(3)">Next</button>
    </div>
</div>

<!-- Step 3: Priorities + Generate -->
<div class="step" id="step3">
    <h2>Step 4: Key Priorities</h2>
    <div class="checkbox-group">
        <label><input type="checkbox" value="Core business logic" checked> Core business logic</label>
        <label><input type="checkbox" value="User authentication"> User authentication</label>
        <label><input type="checkbox" value="Visual design & UX"> Visual design & UX</label>
        <label><input type="checkbox" value="Scalability & performance"> Scalability & performance</label>
        <label><input type="checkbox" value="Third-party integrations"> Third-party integrations</label>
        <label><input type="checkbox" value="Testing & QA"> Testing & QA</label>
        <label><input type="checkbox" value="Documentation"> Documentation</label>
    </div>

    <div class="impact-box" id="impactBox">
        <h3>Estimated Impact</h3>
        <div class="impact-row"><span>Scale</span><span id="impScale">MVP</span></div>
        <div class="impact-row"><span>Focus</span><span id="impFocus">Frontend</span></div>
        <div class="impact-row"><span>Est. Tasks</span><span id="impTasks">6-10</span></div>
        <div class="impact-row"><span>Est. Timeline</span><span id="impTime">2-4 hours</span></div>
    </div>

    <div class="btn-row">
        <button class="secondary" onclick="prevStep(2)">Back</button>
        <button onclick="generate()">Generate Plan</button>
    </div>
</div>

<div id="output"></div>

<script>
    const vscode = acquireVsCodeApi();
    let currentStep = 0;

    function nextStep(n) {
        if (n === 1 && !document.getElementById('planName').value.trim()) {
            document.getElementById('planName').focus();
            return;
        }
        document.getElementById('step' + currentStep).classList.remove('active');
        document.getElementById('step' + n).classList.add('active');
        document.getElementById('dot' + currentStep).classList.remove('active');
        document.getElementById('dot' + currentStep).classList.add('done');
        document.getElementById('dot' + n).classList.add('active');
        currentStep = n;
        updateImpact();
    }

    function prevStep(n) {
        document.getElementById('step' + currentStep).classList.remove('active');
        document.getElementById('step' + n).classList.add('active');
        document.getElementById('dot' + currentStep).classList.remove('active');
        document.getElementById('dot' + n).classList.add('active');
        document.getElementById('dot' + n).classList.remove('done');
        currentStep = n;
    }

    function updateImpact() {
        const scale = document.querySelector('input[name="scale"]:checked')?.value || 'MVP';
        const focus = document.querySelector('input[name="focus"]:checked')?.value || 'Frontend';
        const taskMap = { MVP: '6-10', Small: '10-15', Medium: '20-30', Large: '30-50', Enterprise: '50+' };
        const timeMap = { MVP: '2-4 hours', Small: '4-8 hours', Medium: '1-2 days', Large: '3-5 days', Enterprise: '1-2 weeks' };
        document.getElementById('impScale').textContent = scale;
        document.getElementById('impFocus').textContent = focus;
        document.getElementById('impTasks').textContent = taskMap[scale] || '10-20';
        document.getElementById('impTime').textContent = timeMap[scale] || '4-8 hours';
    }

    function generate() {
        const name = document.getElementById('planName').value.trim();
        const description = document.getElementById('planDesc').value.trim();
        const scale = document.querySelector('input[name="scale"]:checked')?.value || 'MVP';
        const focus = document.querySelector('input[name="focus"]:checked')?.value || 'Frontend';
        const priorities = [...document.querySelectorAll('.checkbox-group input:checked')].map(c => c.value);

        showOutput('<div class="spinner"></div> Generating plan with AI...');
        vscode.postMessage({ command: 'generatePlan', data: { name, scale, focus, priorities, description } });
    }

    function quickGenerate() {
        const name = document.getElementById('planName').value.trim();
        const description = document.getElementById('planDesc').value.trim();
        if (!name || !description) {
            document.getElementById('planName').focus();
            return;
        }
        showOutput('<div class="spinner"></div> Generating plan...');
        vscode.postMessage({ command: 'quickPlan', data: { name, description } });
    }

    function showOutput(html) {
        const el = document.getElementById('output');
        el.innerHTML = html;
        el.style.display = 'block';
    }

    window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.command === 'planCreated') {
            showOutput(msg.text.replace(/\\n/g, '<br>'));
        } else if (msg.command === 'error') {
            showOutput('<span style="color:var(--vscode-errorForeground)">Error: ' + msg.text + '</span>');
        } else if (msg.command === 'status') {
            showOutput('<div class="spinner"></div> ' + msg.text);
        }
    });

    // Live-update impact when radio buttons change
    document.querySelectorAll('input[name="scale"], input[name="focus"]').forEach(el => {
        el.addEventListener('change', updateImpact);
    });
</script>
</body>
</html>`;
    }

    private dispose(): void {
        PlanningWizardPanel.currentPanel = undefined;
        this.panel.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
