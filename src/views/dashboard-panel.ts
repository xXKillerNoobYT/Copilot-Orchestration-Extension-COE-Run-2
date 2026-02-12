import * as vscode from 'vscode';
import { Database } from '../core/database';
import { MCPServer } from '../mcp/server';

export class DashboardPanel {
    private static currentPanel: DashboardPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private refreshTimer: NodeJS.Timeout | undefined;
    private disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        private database: Database,
        private mcpServer: MCPServer
    ) {
        this.panel = panel;
        this.updateContent();
        this.refreshTimer = setInterval(() => this.updateContent(), 5000);
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }

    static show(database: Database, mcpServer: MCPServer): void {
        if (DashboardPanel.currentPanel) {
            DashboardPanel.currentPanel.panel.reveal();
            DashboardPanel.currentPanel.updateContent();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'coeDashboard', 'COE: Dashboard',
            vscode.ViewColumn.One, { enableScripts: true }
        );
        DashboardPanel.currentPanel = new DashboardPanel(panel, database, mcpServer);
    }

    private updateContent(): void {
        const stats = this.database.getStats();
        const plan = this.database.getActivePlan();
        const agents = this.database.getAllAgents();
        const recentAudit = this.database.getAuditLog(10);

        let planTasks: { total: number; verified: number; inProgress: number; failed: number; notStarted: number } =
            { total: 0, verified: 0, inProgress: 0, failed: 0, notStarted: 0 };
        if (plan) {
            const tasks = this.database.getTasksByPlan(plan.id);
            planTasks.total = tasks.length;
            planTasks.verified = tasks.filter(t => t.status === 'verified').length;
            planTasks.inProgress = tasks.filter(t => t.status === 'in_progress').length;
            planTasks.failed = tasks.filter(t => t.status === 'failed').length;
            planTasks.notStarted = tasks.filter(t => t.status === 'not_started').length;
        }

        const pct = planTasks.total > 0 ? Math.round((planTasks.verified / planTasks.total) * 100) : 0;

        this.panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; }
    h1 { font-size: 1.4em; color: var(--vscode-textLink-foreground); margin-bottom: 4px; }
    .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 20px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .card { padding: 16px; border: 1px solid var(--vscode-input-border); border-radius: 6px; background: var(--vscode-textBlockQuote-background); }
    .card .value { font-size: 2em; font-weight: bold; color: var(--vscode-textLink-foreground); }
    .card .label { font-size: 0.85em; color: var(--vscode-descriptionForeground); margin-top: 4px; }
    .progress-bar { height: 20px; background: var(--vscode-input-border); border-radius: 10px; overflow: hidden; margin: 8px 0; }
    .progress-fill { height: 100%; background: var(--vscode-testing-iconPassed); border-radius: 10px; transition: width 0.5s; }
    .progress-text { text-align: center; font-weight: bold; }
    h2 { font-size: 1.1em; margin-top: 24px; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid var(--vscode-input-border); }
    th { font-weight: bold; color: var(--vscode-descriptionForeground); font-size: 0.85em; text-transform: uppercase; }
    .status-working { color: var(--vscode-charts-yellow); }
    .status-idle { color: var(--vscode-descriptionForeground); }
    .status-error { color: var(--vscode-errorForeground); }
    .mcp-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.8em; }
    .mcp-online { background: var(--vscode-testing-iconPassed); color: #fff; }
    .mcp-offline { background: var(--vscode-errorForeground); color: #fff; }
    .audit-entry { padding: 4px 0; border-bottom: 1px solid var(--vscode-input-border); font-size: 0.9em; }
    .audit-time { color: var(--vscode-descriptionForeground); font-size: 0.8em; }
</style>
</head>
<body>
<h1>COE Dashboard</h1>
<p class="subtitle">${plan ? `Active Plan: ${plan.name}` : 'No active plan — create one to get started'} &nbsp;
<span class="mcp-badge ${this.mcpServer.getPort() ? 'mcp-online' : 'mcp-offline'}">MCP: port ${this.mcpServer.getPort()}</span></p>

<div class="grid">
    <div class="card"><div class="value">${stats.total_tasks || 0}</div><div class="label">Total Tasks</div></div>
    <div class="card"><div class="value">${stats.tasks_verified || 0}</div><div class="label">Verified</div></div>
    <div class="card"><div class="value">${stats.tasks_in_progress || 0}</div><div class="label">In Progress</div></div>
    <div class="card"><div class="value">${stats.total_tickets || 0}</div><div class="label">Tickets</div></div>
    <div class="card"><div class="value">${stats.total_conversations || 0}</div><div class="label">Conversations</div></div>
    <div class="card"><div class="value">${agents.length}</div><div class="label">Agents</div></div>
</div>

${plan ? `
<h2>Plan Progress</h2>
<div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
<div class="progress-text">${pct}% complete (${planTasks.verified}/${planTasks.total} tasks verified)</div>
<div class="grid" style="margin-top:12px">
    <div class="card"><div class="value">${planTasks.notStarted}</div><div class="label">Not Started</div></div>
    <div class="card"><div class="value">${planTasks.inProgress}</div><div class="label">In Progress</div></div>
    <div class="card"><div class="value">${planTasks.failed}</div><div class="label">Failed</div></div>
    <div class="card"><div class="value">${planTasks.verified}</div><div class="label">Verified</div></div>
</div>
` : ''}

<h2>Agents</h2>
<table>
    <tr><th>Agent</th><th>Type</th><th>Status</th><th>Current Task</th></tr>
    ${agents.map(a => `<tr>
        <td>${a.name}</td>
        <td>${a.type}</td>
        <td class="status-${a.status}">${a.status}</td>
        <td>${a.current_task || '—'}</td>
    </tr>`).join('')}
    ${agents.length === 0 ? '<tr><td colspan="4" style="color:var(--vscode-descriptionForeground)">No agents registered yet</td></tr>' : ''}
</table>

<h2>Recent Activity</h2>
${recentAudit.map(e => `<div class="audit-entry">
    <strong>${e.agent}</strong>: ${e.action} — ${e.detail}
    <div class="audit-time">${e.created_at}</div>
</div>`).join('')}
${recentAudit.length === 0 ? '<p style="color:var(--vscode-descriptionForeground)">No activity yet</p>' : ''}

</body></html>`;
    }

    private dispose(): void {
        DashboardPanel.currentPanel = undefined;
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        this.panel.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
