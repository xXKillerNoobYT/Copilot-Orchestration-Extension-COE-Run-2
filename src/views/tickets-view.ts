import * as vscode from 'vscode';
import { Database } from '../core/database';
import { Ticket, TicketStatus, TicketPriority } from '../types';

export class TicketsViewProvider implements vscode.TreeDataProvider<TicketTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TicketTreeItem | undefined | null>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private database: Database) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: TicketTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TicketTreeItem): TicketTreeItem[] {
        if (!element) {
            // Root: show status groups
            const statuses: Array<{ status: TicketStatus; label: string; icon: string }> = [
                { status: TicketStatus.Open, label: 'Open', icon: 'inbox' },
                { status: TicketStatus.InReview, label: 'In Review', icon: 'eye' },
                { status: TicketStatus.Escalated, label: 'Escalated', icon: 'warning' },
                { status: TicketStatus.Resolved, label: 'Resolved', icon: 'check' },
            ];

            return statuses.map(s => {
                const tickets = this.database.getTicketsByStatus(s.status);
                return new TicketTreeItem(
                    `${s.label} (${tickets.length})`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    undefined,
                    s.icon,
                    s.status
                );
            });
        }

        // Children: tickets in that status group
        if (element.statusGroup) {
            const tickets = this.database.getTicketsByStatus(element.statusGroup);
            return tickets.map(ticket => new TicketTreeItem(
                `TK-${String(ticket.ticket_number).padStart(3, '0')} [${ticket.priority}] ${ticket.title}`,
                vscode.TreeItemCollapsibleState.None,
                ticket,
                this.getPriorityIcon(ticket.priority),
                undefined
            ));
        }

        return [];
    }

    private getPriorityIcon(priority: string): string {
        switch (priority) {
            case TicketPriority.P1: return 'flame';
            case TicketPriority.P2: return 'arrow-up';
            case TicketPriority.P3: return 'arrow-down';
            default: return 'circle-outline';
        }
    }
}

class TicketTreeItem extends vscode.TreeItem {
    statusGroup?: string;

    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        ticket?: Ticket,
        icon?: string,
        statusGroup?: string
    ) {
        super(label, collapsibleState);
        this.statusGroup = statusGroup;

        if (icon) {
            this.iconPath = new vscode.ThemeIcon(icon);
        }

        if (ticket) {
            this.tooltip = `TK-${ticket.ticket_number}: ${ticket.title}\nPriority: ${ticket.priority}\nCreator: ${ticket.creator}\nCreated: ${ticket.created_at}`;
            this.contextValue = 'ticket';
            this.command = {
                command: 'coe.openTicketPanel',
                title: 'Open Ticket',
                arguments: [ticket.id],
            };
        }
    }
}
