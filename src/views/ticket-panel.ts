import * as vscode from 'vscode';
import { Database } from '../core/database';
import { TicketStatus } from '../types';

export class TicketPanel {
    private static panels: Map<string, TicketPanel> = new Map();
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        private ticketId: string,
        private database: Database,
        private onRefresh: () => void
    ) {
        this.panel = panel;
        this.updateContent();

        this.panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.command) {
                case 'reply':
                    this.database.addTicketReply(this.ticketId, 'user', msg.text);
                    this.updateContent();
                    this.onRefresh();
                    break;
                case 'resolve':
                    this.database.updateTicket(this.ticketId, { status: TicketStatus.Resolved });
                    this.updateContent();
                    this.onRefresh();
                    vscode.window.showInformationMessage('Ticket resolved.');
                    break;
                case 'escalate':
                    this.database.updateTicket(this.ticketId, { status: TicketStatus.Escalated });
                    this.updateContent();
                    this.onRefresh();
                    vscode.window.showInformationMessage('Ticket escalated.');
                    break;
            }
        }, undefined, this.disposables);

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }

    static show(ticketId: string, database: Database, onRefresh: () => void): void {
        const existing = TicketPanel.panels.get(ticketId);
        if (existing) {
            existing.panel.reveal();
            existing.updateContent();
            return;
        }

        const ticket = database.getTicket(ticketId);
        if (!ticket) {
            vscode.window.showErrorMessage('Ticket not found.');
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'coeTicket', `TK-${ticket.ticket_number}: ${ticket.title}`,
            vscode.ViewColumn.One, { enableScripts: true }
        );
        const tp = new TicketPanel(panel, ticketId, database, onRefresh);
        TicketPanel.panels.set(ticketId, tp);
    }

    private updateContent(): void {
        const ticket = this.database.getTicket(this.ticketId);
        if (!ticket) return;
        const replies = this.database.getTicketReplies(this.ticketId);

        const statusColor: Record<string, string> = {
            open: 'var(--vscode-charts-blue)',
            resolved: 'var(--vscode-testing-iconPassed)',
            escalated: 'var(--vscode-errorForeground)',
            in_review: 'var(--vscode-charts-yellow)',
        };

        this.panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; max-width: 700px; margin: 0 auto; }
    h1 { font-size: 1.3em; margin-bottom: 4px; }
    .meta { color: var(--vscode-descriptionForeground); margin-bottom: 16px; display: flex; gap: 12px; align-items: center; }
    .badge { padding: 2px 10px; border-radius: 10px; font-size: 0.8em; font-weight: bold; color: #fff; }
    .body-text { padding: 12px; background: var(--vscode-textBlockQuote-background); border-radius: 4px; margin-bottom: 20px; white-space: pre-wrap; }
    .thread { border-top: 1px solid var(--vscode-input-border); padding-top: 16px; }
    .reply { padding: 10px 12px; margin-bottom: 10px; border-radius: 6px; border: 1px solid var(--vscode-input-border); }
    .reply.user { border-left: 3px solid var(--vscode-charts-blue); }
    .reply.agent { border-left: 3px solid var(--vscode-charts-purple); }
    .reply .author { font-weight: bold; font-size: 0.9em; }
    .reply .score { float: right; font-size: 0.8em; color: var(--vscode-descriptionForeground); }
    .reply .text { margin-top: 4px; white-space: pre-wrap; }
    .reply-box { margin-top: 16px; }
    textarea { width: 100%; min-height: 80px; padding: 8px; background: var(--vscode-input-background);
        color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px;
        font-family: inherit; resize: vertical; }
    .btn-row { display: flex; gap: 8px; margin-top: 8px; }
    button { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;
        background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    button.danger { background: var(--vscode-errorForeground); color: #fff; }
</style>
</head>
<body>
<h1>TK-${ticket.ticket_number}: ${this.escapeHtml(ticket.title)}</h1>
<div class="meta">
    <span class="badge" style="background:${statusColor[ticket.status] || 'gray'}">${ticket.status.toUpperCase()}</span>
    <span>${ticket.priority}</span>
    <span>Creator: ${ticket.creator}</span>
</div>

${ticket.body ? `<div class="body-text">${this.escapeHtml(ticket.body)}</div>` : ''}

<div class="thread">
    <h3>Thread (${replies.length} ${replies.length === 1 ? 'reply' : 'replies'})</h3>
    ${replies.map(r => `
        <div class="reply ${r.author === 'user' ? 'user' : 'agent'}">
            <span class="author">${this.escapeHtml(r.author)}</span>
            ${r.clarity_score != null ? `<span class="score">Clarity: ${r.clarity_score}/100</span>` : ''}
            <div class="text">${this.escapeHtml(r.body)}</div>
        </div>
    `).join('')}
    ${replies.length === 0 ? '<p style="color:var(--vscode-descriptionForeground)">No replies yet</p>' : ''}
</div>

${ticket.status !== 'resolved' ? `
<div class="reply-box">
    <textarea id="replyText" placeholder="Type your reply..."></textarea>
    <div class="btn-row">
        <button onclick="sendReply()">Send Reply</button>
        <button class="secondary" onclick="resolve()">Close & Resolve</button>
        ${ticket.status !== 'escalated' ? '<button class="danger" onclick="escalate()">Escalate</button>' : ''}
    </div>
</div>
` : '<p style="color:var(--vscode-testing-iconPassed);font-weight:bold;margin-top:16px">This ticket has been resolved.</p>'}

<script>
    const vscode = acquireVsCodeApi();
    function sendReply() {
        const text = document.getElementById('replyText').value.trim();
        if (!text) return;
        vscode.postMessage({ command: 'reply', text });
        document.getElementById('replyText').value = '';
    }
    function resolve() { vscode.postMessage({ command: 'resolve' }); }
    function escalate() { vscode.postMessage({ command: 'escalate' }); }
    document.getElementById('replyText')?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.ctrlKey) sendReply();
    });
</script>
</body></html>`;
    }

    private escapeHtml(text: string): string {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    private dispose(): void {
        TicketPanel.panels.delete(this.ticketId);
        this.panel.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
