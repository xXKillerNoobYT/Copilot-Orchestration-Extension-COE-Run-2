import * as vscode from 'vscode';
import { Orchestrator } from '../agents/orchestrator';
import { Database } from '../core/database';
import { Agent, AgentStatus } from '../types';

export class AgentsViewProvider implements vscode.TreeDataProvider<AgentTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<AgentTreeItem | undefined | null>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(
        private orchestrator: Orchestrator,
        private database: Database
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: AgentTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(): AgentTreeItem[] {
        const agents = this.database.getAllAgents();
        return agents.map(agent => new AgentTreeItem(agent));
    }
}

class AgentTreeItem extends vscode.TreeItem {
    constructor(private agent: Agent) {
        super(agent.name, vscode.TreeItemCollapsibleState.None);

        const statusIcon = this.getStatusIcon(agent.status as AgentStatus);
        const statusText = agent.status === AgentStatus.Working && agent.current_task
            ? `Working: ${agent.current_task.substring(0, 20)}...`
            : agent.status === AgentStatus.Idle && agent.last_activity
            ? `Last: ${this.timeAgo(agent.last_activity)}`
            : agent.status;

        this.description = statusText;
        this.iconPath = new vscode.ThemeIcon(statusIcon);
        this.tooltip = `${agent.name} (${agent.type})\nStatus: ${agent.status}${agent.last_activity ? '\nLast activity: ' + agent.last_activity : ''}`;
        this.contextValue = `agent-${agent.status}`;
    }

    private getStatusIcon(status: AgentStatus): string {
        switch (status) {
            case AgentStatus.Idle: return 'circle-outline';
            case AgentStatus.Working: return 'sync~spin';
            case AgentStatus.Error: return 'error';
            case AgentStatus.Disabled: return 'circle-slash';
            default: return 'circle-outline';
        }
    }

    private timeAgo(dateStr: string): string {
        const now = Date.now();
        const then = new Date(dateStr).getTime();
        const diffMin = Math.floor((now - then) / 60000);
        if (diffMin < 1) return 'just now';
        if (diffMin < 60) return `${diffMin}m ago`;
        const diffHr = Math.floor(diffMin / 60);
        if (diffHr < 24) return `${diffHr}h ago`;
        return `${Math.floor(diffHr / 24)}d ago`;
    }
}
