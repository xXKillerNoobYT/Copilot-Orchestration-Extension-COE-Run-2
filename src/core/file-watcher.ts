import * as vscode from 'vscode';
import * as path from 'path';
import { Database } from './database';
import { Orchestrator } from '../agents/orchestrator';
import { ConfigManager } from './config';

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
    }

    private onIssueChanged(uri: vscode.Uri): void {
        this.outputChannel.appendLine(`GitHub issue file changed: ${uri.fsPath}`);
        this.database.addAuditLog('file_watcher', 'issue_changed', uri.fsPath);
    }

    private onCodeChanged(uri: vscode.Uri): void {
        // Only log, don't trigger expensive operations on every save
        this.database.addAuditLog('file_watcher', 'code_changed', path.relative(this.workspaceRoot, uri.fsPath));
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
