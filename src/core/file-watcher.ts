import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Database } from './database';
import { Orchestrator } from '../agents/orchestrator';
import { ConfigManager } from './config';
import { TaskStatus } from '../types';

export class FileWatcherService {
    private watchers: vscode.FileSystemWatcher[] = [];
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

    constructor(
        private workspaceRoot: string,
        private database: Database,
        private orchestrator: Orchestrator,
        private config: ConfigManager,
        private outputChannel: vscode.OutputChannel
    ) {}

    start(): void {
        const debounceMs = this.config.getConfig().watcher.debounceMs;

        // Watch plan files
        const planWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.workspaceRoot, 'Docs/Plans/**/*.json')
        );
        planWatcher.onDidChange(uri => this.debounce('plan', () => this.onPlanChanged(uri), debounceMs));
        planWatcher.onDidCreate(uri => this.debounce('plan', () => this.onPlanChanged(uri), debounceMs));
        this.watchers.push(planWatcher);

        // Watch GitHub issues
        const issueWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.workspaceRoot, '.vscode/github-issues/**/*.md')
        );
        issueWatcher.onDidChange(uri => this.debounce('issue', () => this.onIssueChanged(uri), debounceMs));
        issueWatcher.onDidCreate(uri => this.debounce('issue', () => this.onIssueChanged(uri), debounceMs));
        this.watchers.push(issueWatcher);

        // Watch source code for drift detection
        const codeWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.workspaceRoot, 'src/**/*.{ts,js,tsx,jsx}')
        );
        codeWatcher.onDidChange(uri => this.debounce('code', () => this.onCodeChanged(uri), debounceMs * 2));
        this.watchers.push(codeWatcher);

        // Watch COE config
        const configWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.workspaceRoot, '.coe/config.json')
        );
        configWatcher.onDidChange(() => {
            this.outputChannel.appendLine('COE config changed, reloading...');
        });
        this.watchers.push(configWatcher);

        this.outputChannel.appendLine(`File watchers started (debounce: ${debounceMs}ms)`);
    }

    private debounce(key: string, fn: () => void, ms: number): void {
        const existing = this.debounceTimers.get(key);
        if (existing) clearTimeout(existing);
        this.debounceTimers.set(key, setTimeout(() => {
            this.debounceTimers.delete(key);
            try {
                fn();
            } catch (error) {
                this.outputChannel.appendLine(`File watcher error (${key}): ${error}`);
            }
        }, ms));
    }

    private onPlanChanged(uri: vscode.Uri): void {
        this.outputChannel.appendLine(`Plan file changed: ${uri.fsPath}`);
        this.database.addAuditLog('file_watcher', 'plan_changed', uri.fsPath);

        // Plan change detection: flag verified tasks for recheck if their plan changed
        try {
            const content = fs.readFileSync(uri.fsPath, 'utf-8');
            const parsed = JSON.parse(content);

            if (parsed.tasks && Array.isArray(parsed.tasks)) {
                // Scope recheck to the specific plan that changed (not all plans)
                const changedPlanId: string | undefined = parsed.id || parsed.plan_id;
                const allTasks = this.database.getTasksByStatus(TaskStatus.Verified);
                let rechecked = 0;
                for (const task of allTasks) {
                    // Only recheck tasks belonging to the changed plan
                    if (task.plan_id && (!changedPlanId || task.plan_id === changedPlanId)) {
                        this.database.updateTask(task.id, { status: TaskStatus.NeedsReCheck });
                        rechecked++;
                    }
                }
                if (rechecked > 0) {
                    this.outputChannel.appendLine(`Plan changed: ${rechecked} verified tasks flagged for recheck`);
                    this.database.addAuditLog('file_watcher', 'plan_recheck_triggered',
                        `${rechecked} tasks flagged for recheck after plan file change: ${uri.fsPath}`);
                }
            }
        } catch {
            // Not JSON or couldn't parse — just log
            this.outputChannel.appendLine(`Could not parse plan file for change detection: ${uri.fsPath}`);
        }
    }

    private onIssueChanged(uri: vscode.Uri): void {
        this.outputChannel.appendLine(`GitHub issue file changed: ${uri.fsPath}`);
        this.database.addAuditLog('file_watcher', 'issue_changed', uri.fsPath);
    }

    private onCodeChanged(uri: vscode.Uri): void {
        const relativePath = path.relative(this.workspaceRoot, uri.fsPath);
        this.database.addAuditLog('file_watcher', 'code_changed', relativePath);

        // Verification trigger: if a changed file is referenced by a pending_verification task, mark for recheck
        const pendingTasks = this.database.getTasksByStatus(TaskStatus.PendingVerification);
        for (const task of pendingTasks) {
            if (task.files_modified && task.files_modified.length > 0) {
                const normalizedChanged = relativePath.replace(/\\/g, '/');
                const matches = task.files_modified.some(f =>
                    f.replace(/\\/g, '/') === normalizedChanged ||
                    normalizedChanged.endsWith(f.replace(/\\/g, '/'))
                );
                if (matches) {
                    this.database.updateTask(task.id, { status: TaskStatus.NeedsReCheck });
                    this.outputChannel.appendLine(
                        `Code change in ${relativePath} triggered recheck for task "${task.title}"`
                    );
                    this.database.addAuditLog('file_watcher', 'code_recheck_triggered',
                        `Task "${task.title}" flagged for recheck after code change: ${relativePath}`);
                }
            }
        }
    }

    stop(): void {
        for (const watcher of this.watchers) {
            watcher.dispose();
        }
        this.watchers = [];
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
        this.outputChannel.appendLine('File watchers stopped.');
    }
}
