import * as vscode from 'vscode';
import { Database } from '../core/database';
import { Conversation } from '../types';

export class ConversationsViewProvider implements vscode.TreeDataProvider<ConversationTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ConversationTreeItem | undefined | null>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private database: Database) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: ConversationTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ConversationTreeItem): ConversationTreeItem[] {
        if (!element) {
            // Root: group by agent
            const agents = this.database.getAllAgents();
            return agents.map(agent => {
                const conversations = this.database.getConversationsByAgent(agent.name, 5);
                return new ConversationTreeItem(
                    `${agent.name} (${conversations.length} recent)`,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    undefined,
                    agent.name
                );
            });
        }

        if (element.agentName) {
            const conversations = this.database.getConversationsByAgent(element.agentName, 20);
            return conversations.map(conv => new ConversationTreeItem(
                `[${conv.role}] ${conv.content.substring(0, 60)}...`,
                vscode.TreeItemCollapsibleState.None,
                conv,
                undefined
            ));
        }

        return [];
    }
}

class ConversationTreeItem extends vscode.TreeItem {
    agentName?: string;

    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        conversation?: Conversation,
        agentName?: string
    ) {
        super(label, collapsibleState);
        this.agentName = agentName;

        if (conversation) {
            const roleIcon = conversation.role === 'agent' ? 'robot' : conversation.role === 'user' ? 'person' : 'info';
            this.iconPath = new vscode.ThemeIcon(roleIcon);
            this.tooltip = `${conversation.agent} (${conversation.role})\n${conversation.content}\n\nTime: ${conversation.created_at}${conversation.tokens_used ? '\nTokens: ' + conversation.tokens_used : ''}`;
            this.contextValue = 'conversation';
        } else if (agentName) {
            this.iconPath = new vscode.ThemeIcon('comment-discussion');
        }
    }
}
