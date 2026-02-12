import * as vscode from 'vscode';
import { Database } from '../core/database';
import { Task, TaskStatus, TaskPriority } from '../types';

export class TasksViewProvider implements vscode.TreeDataProvider<TaskTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TaskTreeItem | undefined | null>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private database: Database) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: TaskTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TaskTreeItem): TaskTreeItem[] {
        if (!element) {
            // Root: show priority groups
            const priorities = [
                { priority: TaskPriority.P1, label: 'P1 — Must Have' },
                { priority: TaskPriority.P2, label: 'P2 — Should Have' },
                { priority: TaskPriority.P3, label: 'P3 — Nice to Have' },
            ];

            return priorities.map(p => {
                const tasks = this.database.getAllTasks().filter(t => t.priority === p.priority);
                const done = tasks.filter(t => t.status === TaskStatus.Verified).length;
                return new TaskTreeItem(
                    `${p.label} (${done}/${tasks.length})`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    undefined,
                    p.priority
                );
            });
        }

        // Children: tasks in that priority group
        if (element.priorityGroup) {
            const tasks = this.database.getAllTasks()
                .filter(t => t.priority === element.priorityGroup)
                .sort((a, b) => {
                    // Sort: in_progress first, then not_started, then rest
                    const order: Record<string, number> = {
                        in_progress: 0, not_started: 1, blocked: 2,
                        pending_verification: 3, needs_recheck: 4, failed: 5, verified: 6
                    };
                    return (order[a.status] ?? 9) - (order[b.status] ?? 9);
                });
            return tasks.map(task => new TaskTreeItem(
                task.title,
                vscode.TreeItemCollapsibleState.None,
                task,
                undefined
            ));
        }

        return [];
    }
}

class TaskTreeItem extends vscode.TreeItem {
    priorityGroup?: string;

    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        task?: Task,
        priorityGroup?: string
    ) {
        super(label, collapsibleState);
        this.priorityGroup = priorityGroup;

        if (task) {
            const statusIcon = this.getStatusIcon(task.status);
            this.iconPath = new vscode.ThemeIcon(statusIcon);
            this.description = `${task.status} · ${task.estimated_minutes}min`;
            this.tooltip = [
                `${task.title}`,
                `Status: ${task.status}`,
                `Priority: ${task.priority}`,
                `Estimated: ${task.estimated_minutes} min`,
                `Acceptance: ${task.acceptance_criteria}`,
                task.dependencies.length > 0 ? `Dependencies: ${task.dependencies.length}` : '',
            ].filter(Boolean).join('\n');
            this.contextValue = `task-${task.status}`;
        } else if (priorityGroup) {
            this.iconPath = new vscode.ThemeIcon(
                priorityGroup === 'P1' ? 'flame' :
                priorityGroup === 'P2' ? 'arrow-up' : 'arrow-down'
            );
        }
    }

    private getStatusIcon(status: TaskStatus): string {
        switch (status) {
            case TaskStatus.NotStarted: return 'circle-outline';
            case TaskStatus.InProgress: return 'sync~spin';
            case TaskStatus.Blocked: return 'lock';
            case TaskStatus.PendingVerification: return 'clock';
            case TaskStatus.Verified: return 'check';
            case TaskStatus.NeedsReCheck: return 'warning';
            case TaskStatus.Failed: return 'error';
            default: return 'circle-outline';
        }
    }
}
