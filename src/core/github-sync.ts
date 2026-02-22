import * as crypto from 'crypto';
import { GitHubClient, GitHubIssueData } from './github-client';
import { Database } from './database';
import { ConfigManager } from './config';
import { TaskPriority, GitHubIssue, OutputChannelLike } from '../types';

export class GitHubSyncService {
    constructor(
        private client: GitHubClient,
        private database: Database,
        private config: ConfigManager,
        private outputChannel: OutputChannelLike
    ) {}

    async importIssues(): Promise<{ imported: number; updated: number; errors: number }> {
        const github = this.config.getConfig().github;
        if (!github) {
            throw new Error('GitHub configuration not set. Add github.token, github.owner, and github.repo to .coe/config.json');
        }

        let imported = 0;
        let updated = 0;
        let errors = 0;
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            try {
                const issues = await this.client.getIssues(github.owner, github.repo, 'all', page, 50);
                if (issues.length === 0) {
                    hasMore = false;
                    break;
                }

                for (const issue of issues) {
                    try {
                        const checksum = this.computeChecksum(issue);
                        const existing = this.database.getGitHubIssueByGitHubId(issue.id);

                        this.database.upsertGitHubIssue({
                            github_id: issue.id,
                            number: issue.number,
                            title: issue.title,
                            body: issue.body || '',
                            state: issue.state as 'open' | 'closed',
                            labels: issue.labels.map(l => l.name),
                            assignees: issue.assignees.map(a => a.login),
                            repo_owner: github.owner,
                            repo_name: github.repo,
                            task_id: existing?.task_id || null,
                            local_checksum: existing?.local_checksum || checksum,
                            remote_checksum: checksum,
                        });

                        if (existing) {
                            updated++;
                        } else {
                            imported++;
                        }
                    } catch (err) {
                        errors++;
                        this.outputChannel.appendLine(`Failed to import issue #${issue.number}: ${err}`);
                    }
                }

                page++;
                if (issues.length < 50) hasMore = false;
            } catch (err) {
                this.outputChannel.appendLine(`Failed to fetch issues page ${page}: ${err}`);
                hasMore = false;
                errors++;
            }
        }

        this.database.addAuditLog('github_sync', 'import_complete',
            `Imported: ${imported}, Updated: ${updated}, Errors: ${errors}`);
        this.outputChannel.appendLine(`GitHub sync: ${imported} imported, ${updated} updated, ${errors} errors`);

        return { imported, updated, errors };
    }

    async syncBidirectional(): Promise<{ pushed: number; pulled: number; errors: number }> {
        // First, pull latest from GitHub
        const importResult = await this.importIssues();

        // Then, find locally-modified issues and push changes
        const unsynced = this.database.getUnsyncedGitHubIssues();
        const github = this.config.getConfig().github!;

        let pushed = 0;
        let errors = 0;

        for (const issue of unsynced) {
            try {
                await this.client.updateIssue(
                    github.owner,
                    github.repo,
                    issue.number,
                    {
                        title: issue.title,
                        body: issue.body,
                        state: issue.state,
                        labels: issue.labels,
                    }
                );

                const newChecksum = this.computeChecksum({
                    id: issue.github_id,
                    number: issue.number,
                    title: issue.title,
                    body: issue.body,
                    state: issue.state,
                    labels: issue.labels.map(l => ({ name: l })),
                    assignees: issue.assignees.map(a => ({ login: a })),
                });

                this.database.updateGitHubIssueChecksum(issue.id, newChecksum, newChecksum);
                pushed++;
            } catch (err) {
                errors++;
                this.outputChannel.appendLine(`Failed to push issue #${issue.number}: ${err}`);
            }
        }

        this.database.addAuditLog('github_sync', 'bidirectional_sync',
            `Pulled: ${importResult.imported + importResult.updated}, Pushed: ${pushed}, Errors: ${errors + importResult.errors}`);

        return { pushed, pulled: importResult.imported + importResult.updated, errors: errors + importResult.errors };
    }

    convertIssueToTask(issueId: string): string | null {
        const issue = this.database.getGitHubIssue(issueId);
        if (!issue) return null;

        // Determine priority from labels
        let priority = TaskPriority.P2;
        if (issue.labels.some(l => l.toLowerCase().includes('p1') || l.toLowerCase().includes('critical') || l.toLowerCase().includes('urgent'))) {
            priority = TaskPriority.P1;
        } else if (issue.labels.some(l => l.toLowerCase().includes('p3') || l.toLowerCase().includes('low'))) {
            priority = TaskPriority.P3;
        }

        const task = this.database.createTask({
            title: `[GH-${issue.number}] ${issue.title}`,
            description: issue.body || '',
            priority,
            acceptance_criteria: `GitHub issue #${issue.number} is resolved and closed`,
        });

        this.database.linkGitHubIssueToTask(issueId, task.id);
        this.database.addAuditLog('github_sync', 'issue_to_task',
            `Issue #${issue.number} → Task ${task.id}`);

        return task.id;
    }

    computeChecksum(issue: GitHubIssueData): string {
        const content = `${issue.title}|${issue.body || ''}|${issue.state}|${issue.labels.map(l => l.name).sort().join(',')}`;
        return crypto.createHash('md5').update(content).digest('hex');
    }
}
