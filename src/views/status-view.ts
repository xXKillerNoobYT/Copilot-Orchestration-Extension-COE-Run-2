import * as vscode from 'vscode';
import { Database } from '../core/database';
import { MCPServer } from '../mcp/server';

export class StatusViewProvider implements vscode.TreeDataProvider<StatusItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<StatusItem | undefined | null>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private refreshTimer: NodeJS.Timeout | undefined;

    constructor(
        private database: Database,
        private mcpServer: MCPServer
    ) {
        this.refreshTimer = setInterval(() => this.refresh(), 10000);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    dispose(): void {
        if (this.refreshTimer) clearInterval(this.refreshTimer);
    }

    getTreeItem(element: StatusItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: StatusItem): StatusItem[] {
        if (element) return element.children || [];

        const items: StatusItem[] = [];
        const stats = this.database.getStats();
        const plan = this.database.getActivePlan();
        const agents = this.database.getAllAgents();

        // MCP Server status
        const port = this.mcpServer.getPort();
        items.push(new StatusItem(
            `MCP Server: port ${port}`,
            vscode.TreeItemCollapsibleState.None,
            'broadcast', 'statusItem',
            `MCP server running on http://localhost:${port}`
        ));

        // Active plan
        if (plan) {
            const tasks = this.database.getTasksByPlan(plan.id);
            const verified = tasks.filter(t => t.status === 'verified').length;
            const pct = tasks.length > 0 ? Math.round((verified / tasks.length) * 100) : 0;
            items.push(new StatusItem(
                `Plan: ${plan.name}`,
                vscode.TreeItemCollapsibleState.None,
                'project', 'statusItem',
                `${verified}/${tasks.length} verified (${pct}%)`,
                `${pct}%`
            ));
        } else {
            items.push(new StatusItem(
                'No active plan',
                vscode.TreeItemCollapsibleState.None,
                'project', 'statusItem',
                'Create a plan to get started'
            ));
        }

        // Task summary
        const taskChildren: StatusItem[] = [];
        const statusCounts: Record<string, number> = {};
        for (const key of Object.keys(stats)) {
            if (key.startsWith('tasks_')) {
                const status = key.replace('tasks_', '');
                statusCounts[status] = stats[key];
            }
        }
        for (const [status, count] of Object.entries(statusCounts)) {
            if (count > 0) {
                taskChildren.push(new StatusItem(
                    `${status.replace(/_/g, ' ')}: ${count}`,
                    vscode.TreeItemCollapsibleState.None,
                    this.getStatusIcon(status), 'statusItem'
                ));
            }
        }
        items.push(new StatusItem(
            `Tasks: ${stats.total_tasks || 0}`,
            taskChildren.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
            'checklist', 'statusItem',
            undefined, undefined, taskChildren
        ));

        // Ticket summary
        const activeTickets = this.database.getActiveTicketCount();
        items.push(new StatusItem(
            `Tickets: ${activeTickets} active / ${stats.total_tickets || 0} total`,
            vscode.TreeItemCollapsibleState.None,
            'comment-discussion', 'statusItem'
        ));

        // Agents
        const working = agents.filter(a => a.status === 'working').length;
        const agentChildren = agents.map(a => new StatusItem(
            `${a.name} — ${a.status}`,
            vscode.TreeItemCollapsibleState.None,
            a.status === 'working' ? 'sync~spin' : a.status === 'error' ? 'error' : 'circle-outline',
            'statusItem',
            a.current_task ? `Working on: ${a.current_task}` : undefined
        ));
        items.push(new StatusItem(
            `Agents: ${working} working / ${agents.length} total`,
            agentChildren.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
            'organization', 'statusItem',
            undefined, undefined, agentChildren
        ));

        return items;
    }

    private getStatusIcon(status: string): string {
        switch (status) {
            case 'not_started': return 'circle-outline';
            case 'in_progress': return 'sync~spin';
            case 'blocked': return 'lock';
            case 'pending_verification': return 'clock';
            case 'verified': return 'check';
            case 'needs_recheck': return 'warning';
            case 'failed': return 'error';
            default: return 'circle-outline';
        }
    }
}

class StatusItem extends vscode.TreeItem {
    children?: StatusItem[];

    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        icon: string,
        contextValue: string,
        tooltip?: string,
        description?: string,
        children?: StatusItem[]
    ) {
        super(label, collapsibleState);
        this.iconPath = new vscode.ThemeIcon(icon);
        this.contextValue = contextValue;
        if (tooltip) this.tooltip = tooltip;
        if (description) this.description = description;
        this.children = children;
    }
}
