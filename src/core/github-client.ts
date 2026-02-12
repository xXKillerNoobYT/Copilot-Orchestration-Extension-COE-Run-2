import * as vscode from 'vscode';

export interface GitHubIssueData {
    id: number;
    number: number;
    title: string;
    body: string;
    state: 'open' | 'closed';
    labels: Array<{ name: string }>;
    assignees: Array<{ login: string }>;
}

export class GitHubClient {
    private rateLimitRemaining = 5000;
    private rateLimitReset = 0;

    constructor(
        private token: string,
        private outputChannel: vscode.OutputChannel
    ) {}

    async getIssues(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'all', page = 1, perPage = 30): Promise<GitHubIssueData[]> {
        const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=${state}&page=${page}&per_page=${perPage}&sort=updated&direction=desc`;
        return this.request<GitHubIssueData[]>(url);
    }

    async getIssue(owner: string, repo: string, number: number): Promise<GitHubIssueData> {
        const url = `https://api.github.com/repos/${owner}/${repo}/issues/${number}`;
        return this.request<GitHubIssueData>(url);
    }

    async createIssue(owner: string, repo: string, title: string, body: string, labels?: string[]): Promise<GitHubIssueData> {
        const url = `https://api.github.com/repos/${owner}/${repo}/issues`;
        return this.request<GitHubIssueData>(url, {
            method: 'POST',
            body: JSON.stringify({ title, body, labels }),
        });
    }

    async updateIssue(owner: string, repo: string, number: number, updates: { title?: string; body?: string; state?: string; labels?: string[] }): Promise<GitHubIssueData> {
        const url = `https://api.github.com/repos/${owner}/${repo}/issues/${number}`;
        return this.request<GitHubIssueData>(url, {
            method: 'PATCH',
            body: JSON.stringify(updates),
        });
    }

    async testConnection(owner: string, repo: string): Promise<{ success: boolean; message: string }> {
        try {
            const url = `https://api.github.com/repos/${owner}/${repo}`;
            const data = await this.request<{ full_name: string }>(url);
            return { success: true, message: `Connected to ${data.full_name}. Rate limit: ${this.rateLimitRemaining}` };
        } catch (error) {
            return { success: false, message: `Connection failed: ${error instanceof Error ? error.message : String(error)}` };
        }
    }

    getRateLimitRemaining(): number {
        return this.rateLimitRemaining;
    }

    private async request<T>(url: string, options?: RequestInit): Promise<T> {
        // Rate limit check
        if (this.rateLimitRemaining <= 5 && Date.now() / 1000 < this.rateLimitReset) {
            const waitSeconds = Math.ceil(this.rateLimitReset - Date.now() / 1000);
            throw new Error(`GitHub rate limit exceeded. Resets in ${waitSeconds} seconds.`);
        }

        const headers: Record<string, string> = {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'COE-VS-Code-Extension',
        };
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        const response = await fetch(url, {
            ...options,
            headers: {
                ...headers,
                'Content-Type': 'application/json',
                ...(options?.headers as Record<string, string> || {}),
            },
            signal: AbortSignal.timeout(15000),
        });

        // Track rate limits
        const remaining = response.headers.get('X-RateLimit-Remaining');
        const reset = response.headers.get('X-RateLimit-Reset');
        if (remaining) this.rateLimitRemaining = parseInt(remaining, 10);
        if (reset) this.rateLimitReset = parseInt(reset, 10);

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            throw new Error(`GitHub API ${response.status}: ${response.statusText}. ${errorBody}`);
        }

        return await response.json() as T;
    }
}
