import * as vscode from 'vscode';
import { Database } from '../core/database';
import { TaskStatus, VerificationStatus } from '../types';

export class VerificationPanel {
    private static currentPanel: VerificationPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        private taskId: string,
        private database: Database,
        private onRefresh: () => void
    ) {
        this.panel = panel;
        this.updateContent();

        this.panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.command) {
                case 'approve':
                    this.database.updateTask(this.taskId, { status: TaskStatus.Verified });
                    const verResult = this.database.getVerificationResult(this.taskId);
                    if (verResult) {
                        this.database.updateVerificationResult(verResult.id, VerificationStatus.Passed,
                            verResult.results_json, verResult.test_output ?? undefined, verResult.coverage_percent ?? undefined);
                    }
                    this.database.addAuditLog('user', 'verification_approved', `Task ${this.taskId} approved`);
                    this.updateContent();
                    this.onRefresh();
                    vscode.window.showInformationMessage('Verification approved. Dependent tasks unlocked.');
                    break;
                case 'reject':
                    this.database.updateTask(this.taskId, { status: TaskStatus.Failed });
                    const reason = msg.reason || 'Rejected by user';
                    this.database.addAuditLog('user', 'verification_rejected', `Task ${this.taskId}: ${reason}`);
                    // Create follow-up task
                    const task = this.database.getTask(this.taskId);
                    if (task) {
                        this.database.createTask({
                            title: `Fix: ${task.title}`,
                            description: `Verification rejected: ${reason}`,
                            priority: task.priority,
                            plan_id: task.plan_id || undefined,
                            dependencies: [this.taskId],
                        });
                    }
                    this.updateContent();
                    this.onRefresh();
                    vscode.window.showInformationMessage('Verification rejected. Follow-up task created.');
                    break;
            }
        }, undefined, this.disposables);

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }

    static show(taskId: string, database: Database, onRefresh: () => void): void {
        if (VerificationPanel.currentPanel) {
            VerificationPanel.currentPanel.panel.reveal();
            VerificationPanel.currentPanel.taskId = taskId;
            VerificationPanel.currentPanel.updateContent();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'coeVerification', 'COE: Verification',
            vscode.ViewColumn.One, { enableScripts: true }
        );
        VerificationPanel.currentPanel = new VerificationPanel(panel, taskId, database, onRefresh);
    }

    private updateContent(): void {
        const task = this.database.getTask(this.taskId);
        if (!task) return;
        const verResult = this.database.getVerificationResult(this.taskId);
        let criteria: { criteria_met?: string[]; criteria_missing?: string[]; test_results?: string[] } = {};
        if (verResult) {
            try { criteria = JSON.parse(verResult.results_json); } catch { /* ignore */ }
        }

        const isPending = task.status === 'pending_verification';

        this.panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; max-width: 700px; margin: 0 auto; }
    h1 { font-size: 1.3em; margin-bottom: 4px; }
    h2 { font-size: 1.05em; margin-top: 20px; margin-bottom: 8px; }
    .meta { color: var(--vscode-descriptionForeground); margin-bottom: 16px; }
    .section { padding: 12px; border: 1px solid var(--vscode-input-border); border-radius: 6px; margin-bottom: 12px; }
    .check-item { padding: 4px 0; display: flex; align-items: center; gap: 8px; }
    .check-pass { color: var(--vscode-testing-iconPassed); }
    .check-fail { color: var(--vscode-errorForeground); }
    .check-pending { color: var(--vscode-charts-yellow); }
    .criteria-text { padding: 8px 12px; background: var(--vscode-textBlockQuote-background); border-radius: 4px; margin: 8px 0; white-space: pre-wrap; }
    .coverage-bar { height: 16px; background: var(--vscode-input-border); border-radius: 8px; overflow: hidden; margin: 4px 0 8px; }
    .coverage-fill { height: 100%; border-radius: 8px; }
    .btn-row { display: flex; gap: 8px; margin-top: 20px; }
    button { padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;
        background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.danger { background: var(--vscode-errorForeground); color: #fff; }
    button.success { background: var(--vscode-testing-iconPassed); color: #fff; }
    textarea { width: 100%; min-height: 60px; padding: 8px; background: var(--vscode-input-background);
        color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px;
        font-family: inherit; margin-top: 8px; }
    .files-list { font-size: 0.9em; }
    .files-list code { background: var(--vscode-textBlockQuote-background); padding: 1px 4px; border-radius: 2px; }
</style>
</head>
<body>
<h1>Verification: ${this.escapeHtml(task.title)}</h1>
<div class="meta">Status: <strong>${task.status}</strong> | Priority: ${task.priority} | Est: ${task.estimated_minutes}min</div>

${task.acceptance_criteria ? `
<h2>Acceptance Criteria</h2>
<div class="criteria-text">${this.escapeHtml(task.acceptance_criteria)}</div>
` : ''}

${task.files_modified.length > 0 ? `
<h2>Files Modified</h2>
<div class="files-list">${task.files_modified.map(f => `<div><code>${this.escapeHtml(f)}</code></div>`).join('')}</div>
` : ''}

${verResult ? `
<div class="section">
    <h2>Test Results</h2>
    ${verResult.test_output ? `<div class="criteria-text">${this.escapeHtml(verResult.test_output)}</div>` : '<p style="color:var(--vscode-descriptionForeground)">No test output</p>'}

    ${verResult.coverage_percent != null ? `
    <h2>Coverage: ${verResult.coverage_percent}%</h2>
    <div class="coverage-bar"><div class="coverage-fill" style="width:${verResult.coverage_percent}%;background:${verResult.coverage_percent >= 80 ? 'var(--vscode-testing-iconPassed)' : verResult.coverage_percent >= 60 ? 'var(--vscode-charts-yellow)' : 'var(--vscode-errorForeground)'}"></div></div>
    ` : ''}
</div>

<div class="section">
    <h2>Criteria Checklist</h2>
    ${(criteria.criteria_met || []).map(c => `<div class="check-item"><span class="check-pass">✅</span> ${this.escapeHtml(c)}</div>`).join('')}
    ${(criteria.criteria_missing || []).map(c => `<div class="check-item"><span class="check-fail">❌</span> ${this.escapeHtml(c)}</div>`).join('')}
    ${!(criteria.criteria_met?.length || criteria.criteria_missing?.length) ? '<p style="color:var(--vscode-descriptionForeground)">No criteria data</p>' : ''}
</div>
` : `
<div class="section">
    <h2>Verification</h2>
    <p style="color:var(--vscode-descriptionForeground)">No verification results yet. ${isPending ? 'Verification is pending.' : ''}</p>
</div>
`}

${isPending || task.status === 'failed' ? `
<h2>Decision</h2>
<textarea id="rejectReason" placeholder="Reason for rejection (optional)..."></textarea>
<div class="btn-row">
    <button class="success" onclick="approve()">Approve</button>
    <button class="danger" onclick="reject()">Reject + Create Follow-up Task</button>
</div>
` : ''}

<script>
    const vscode = acquireVsCodeApi();
    function approve() { vscode.postMessage({ command: 'approve' }); }
    function reject() {
        const reason = document.getElementById('rejectReason')?.value || '';
        vscode.postMessage({ command: 'reject', reason });
    }
</script>
</body></html>`;
    }

    private escapeHtml(text: string): string {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    private dispose(): void {
        VerificationPanel.currentPanel = undefined;
        this.panel.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
