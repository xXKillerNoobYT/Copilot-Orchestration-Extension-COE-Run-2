/**
 * GitHubIntegration - Advanced GitHub features
 *
 * - Webhook event processing (push, PR, issue, review)
 * - PR management (create, review, merge tracking)
 * - Conflict resolution between local and remote changes
 * - Milestone tracking and progress reporting
 * - Branch management strategy
 */

export interface WebhookEvent {
    id: string;
    type: "push" | "pull_request" | "issue" | "review" | "comment" | "release" | "workflow_run";
    action: string;
    timestamp: string;
    sender: string;
    repository: string;
    payload: Record<string, unknown>;
    processed: boolean;
    processedAt?: string;
}

export interface PullRequest {
    id: string;
    number: number;
    title: string;
    description: string;
    author: string;
    status: "open" | "closed" | "merged" | "draft";
    baseBranch: string;
    headBranch: string;
    linkedTaskIds: string[];
    reviewStatus: "pending" | "approved" | "changes_requested" | "dismissed";
    checks: Array<{ name: string; status: "passed" | "failed" | "pending" }>;
    conflictFiles: string[];
    createdAt: string;
    updatedAt: string;
    mergedAt?: string;
}

export interface ConflictResolution {
    id: string;
    type: "merge_conflict" | "task_overlap" | "plan_divergence" | "priority_conflict";
    severity: "low" | "medium" | "high" | "critical";
    title: string;
    description: string;
    files: string[];
    localVersion: string;
    remoteVersion: string;
    suggestedResolution: "keep_local" | "keep_remote" | "merge" | "manual";
    status: "detected" | "resolving" | "resolved" | "escalated";
    resolvedBy?: string;
    resolvedAt?: string;
    detectedAt: string;
}

export interface Milestone {
    id: string;
    title: string;
    description: string;
    targetDate: string;
    status: "open" | "closed" | "at_risk" | "overdue";
    progress: number;
    totalTasks: number;
    completedTasks: number;
    linkedPRs: string[];
    linkedIssues: string[];
    createdAt: string;
    updatedAt: string;
}

export interface BranchStrategy {
    mainBranch: string;
    developBranch: string;
    featurePrefix: string;
    hotfixPrefix: string;
    releasePrefix: string;
    taskBranchPattern: string;
}

export interface GitHubReport {
    timestamp: string;
    repository: string;
    openPRs: number;
    mergedPRs: number;
    openIssues: number;
    closedIssues: number;
    activeConflicts: number;
    milestoneProgress: Array<{ name: string; progress: number; status: string }>;
    recentActivity: WebhookEvent[];
    healthScore: number;
}

export class GitHubIntegration {
    private webhookEvents: WebhookEvent[];
    private pullRequests: Map<string, PullRequest>;
    private conflicts: Map<string, ConflictResolution>;
    private milestones: Map<string, Milestone>;
    private branchStrategy: BranchStrategy;
    private idCounter: number;

    constructor(branchStrategy?: Partial<BranchStrategy>) {
        this.webhookEvents = [];
        this.pullRequests = new Map();
        this.conflicts = new Map();
        this.milestones = new Map();
        this.idCounter = 0;
        this.branchStrategy = {
            mainBranch: "main",
            developBranch: "develop",
            featurePrefix: "feature/",
            hotfixPrefix: "hotfix/",
            releasePrefix: "release/",
            taskBranchPattern: "feature/{task-id}-{title}",
            ...branchStrategy,
        };
    }

    private nextId(prefix: string): string {
        return `${prefix}-${++this.idCounter}`;
    }

    // ==================== WEBHOOK PROCESSING ====================

    processWebhook(
        type: WebhookEvent["type"],
        action: string,
        sender: string,
        repository: string,
        payload: Record<string, unknown>,
    ): WebhookEvent {
        const event: WebhookEvent = {
            id: this.nextId("wh"),
            type,
            action,
            timestamp: new Date().toISOString(),
            sender,
            repository,
            payload,
            processed: false,
        };

        this.webhookEvents.push(event);
        if (this.webhookEvents.length > 1000) this.webhookEvents.shift();

        this.autoProcess(event);

        return event;
    }

    private autoProcess(event: WebhookEvent): void {
        switch (event.type) {
            case "pull_request":
                this.processPRWebhook(event);
                break;
            case "push":
                this.processPushWebhook(event);
                break;
            case "issue":
                this.processIssueWebhook(event);
                break;
        }
        event.processed = true;
        event.processedAt = new Date().toISOString();
    }

    private processPRWebhook(event: WebhookEvent): void {
        const prNumber = (event.payload.number as number) ?? 0;
        const prId = `pr-${prNumber}`;

        if (event.action === "opened" || event.action === "reopened") {
            this.pullRequests.set(prId, {
                id: prId,
                number: prNumber,
                title: (event.payload.title as string) || "",
                description: (event.payload.body as string) || "",
                author: event.sender,
                status: "open",
                baseBranch: (event.payload.base as string) || "main",
                headBranch: (event.payload.head as string) || "",
                linkedTaskIds: [],
                reviewStatus: "pending",
                checks: [],
                conflictFiles: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });
        } else if (event.action === "closed") {
            const pr = this.pullRequests.get(prId);
            if (pr) {
                pr.status = (event.payload.merged as boolean) ? "merged" : "closed";
                pr.updatedAt = new Date().toISOString();
                if (pr.status === "merged") {
                    pr.mergedAt = new Date().toISOString();
                }
            }
        }
    }

    private processPushWebhook(event: WebhookEvent): void {
        const ref = (event.payload.ref as string) || "";
        if (ref.includes(this.branchStrategy.mainBranch)) {
            for (const [, pr] of this.pullRequests) {
                if (pr.status === "open") {
                    const files = (event.payload.files as string[]) || [];
                    if (files.length > 0) {
                        this.detectConflict(pr.id, files);
                    }
                }
            }
        }
    }

    private processIssueWebhook(event: WebhookEvent): void {
        const milestoneTitle = (event.payload.milestone as string) || "";
        if (milestoneTitle) {
            const milestone = [...this.milestones.values()].find(m => m.title === milestoneTitle);
            if (milestone) {
                const issueId = String(event.payload.number || "");
                if (!milestone.linkedIssues.includes(issueId)) {
                    milestone.linkedIssues.push(issueId);
                }
                if (event.action === "closed") {
                    milestone.completedTasks++;
                    milestone.progress = Math.round(
                        (milestone.completedTasks / Math.max(milestone.totalTasks, 1)) * 100,
                    );
                }
                milestone.updatedAt = new Date().toISOString();
            }
        }
    }

    getWebhookEvents(limit: number = 50): WebhookEvent[] {
        return this.webhookEvents.slice(-limit);
    }

    getUnprocessedEvents(): WebhookEvent[] {
        return this.webhookEvents.filter(e => !e.processed);
    }

    // ==================== PULL REQUESTS ====================

    createPR(
        title: string,
        description: string,
        headBranch: string,
        baseBranch: string,
        author: string,
        taskIds: string[] = [],
    ): PullRequest {
        const id = this.nextId("pr");
        const pr: PullRequest = {
            id,
            number: this.idCounter,
            title,
            description,
            author,
            status: "open",
            baseBranch,
            headBranch,
            linkedTaskIds: taskIds,
            reviewStatus: "pending",
            checks: [],
            conflictFiles: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        this.pullRequests.set(id, pr);
        return pr;
    }

    getPR(id: string): PullRequest | undefined {
        return this.pullRequests.get(id);
    }

    getAllPRs(): PullRequest[] {
        return [...this.pullRequests.values()];
    }

    getOpenPRs(): PullRequest[] {
        return [...this.pullRequests.values()].filter(pr => pr.status === "open");
    }

    updatePRStatus(id: string, status: PullRequest["status"]): boolean {
        const pr = this.pullRequests.get(id);
        if (!pr) return false;
        pr.status = status;
        pr.updatedAt = new Date().toISOString();
        if (status === "merged") {
            pr.mergedAt = new Date().toISOString();
        }
        return true;
    }

    addPRReview(id: string, status: PullRequest["reviewStatus"]): boolean {
        const pr = this.pullRequests.get(id);
        if (!pr) return false;
        pr.reviewStatus = status;
        pr.updatedAt = new Date().toISOString();
        return true;
    }

    addPRCheck(id: string, name: string, status: "passed" | "failed" | "pending"): boolean {
        const pr = this.pullRequests.get(id);
        if (!pr) return false;
        const existing = pr.checks.findIndex(c => c.name === name);
        if (existing >= 0) {
            pr.checks[existing].status = status;
        } else {
            pr.checks.push({ name, status });
        }
        pr.updatedAt = new Date().toISOString();
        return true;
    }

    linkTaskToPR(prId: string, taskId: string): boolean {
        const pr = this.pullRequests.get(prId);
        if (!pr) return false;
        if (!pr.linkedTaskIds.includes(taskId)) {
            pr.linkedTaskIds.push(taskId);
        }
        return true;
    }

    generateBranchName(taskId: string, taskTitle: string): string {
        const cleanTitle = taskTitle
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, "")
            .replace(/\s+/g, "-")
            .slice(0, 40);
        return this.branchStrategy.taskBranchPattern
            .replace("{task-id}", taskId)
            .replace("{title}", cleanTitle);
    }

    // ==================== CONFLICT RESOLUTION ====================

    detectConflict(prId: string, conflictFiles: string[]): ConflictResolution {
        const pr = this.pullRequests.get(prId);
        const id = this.nextId("conflict");
        const conflict: ConflictResolution = {
            id,
            type: "merge_conflict",
            severity: conflictFiles.length > 5 ? "high" : conflictFiles.length > 2 ? "medium" : "low",
            title: pr ? `Conflict in PR: ${pr.title}` : "Merge conflict detected",
            description: `${conflictFiles.length} file(s) have conflicts`,
            files: conflictFiles,
            localVersion: "local",
            remoteVersion: "remote",
            suggestedResolution: conflictFiles.length > 5 ? "manual" : "merge",
            status: "detected",
            detectedAt: new Date().toISOString(),
        };

        if (pr) {
            pr.conflictFiles = conflictFiles;
        }

        this.conflicts.set(id, conflict);
        return conflict;
    }

    resolveConflict(
        id: string,
        resolution: ConflictResolution["suggestedResolution"],
        resolvedBy: string,
    ): boolean {
        const conflict = this.conflicts.get(id);
        if (!conflict) return false;
        conflict.status = "resolved";
        conflict.suggestedResolution = resolution;
        conflict.resolvedBy = resolvedBy;
        conflict.resolvedAt = new Date().toISOString();
        return true;
    }

    escalateConflict(id: string): boolean {
        const conflict = this.conflicts.get(id);
        if (!conflict) return false;
        conflict.status = "escalated";
        conflict.severity = "critical";
        return true;
    }

    getConflict(id: string): ConflictResolution | undefined {
        return this.conflicts.get(id);
    }

    getActiveConflicts(): ConflictResolution[] {
        return [...this.conflicts.values()].filter(c => c.status !== "resolved");
    }

    // ==================== MILESTONES ====================

    createMilestone(
        title: string,
        description: string,
        targetDate: string,
        totalTasks: number,
    ): Milestone {
        const id = this.nextId("ms");
        const milestone: Milestone = {
            id,
            title,
            description,
            targetDate,
            status: "open",
            progress: 0,
            totalTasks,
            completedTasks: 0,
            linkedPRs: [],
            linkedIssues: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        this.milestones.set(id, milestone);
        return milestone;
    }

    getMilestone(id: string): Milestone | undefined {
        return this.milestones.get(id);
    }

    getAllMilestones(): Milestone[] {
        return [...this.milestones.values()];
    }

    updateMilestoneProgress(id: string, completedTasks: number): boolean {
        const milestone = this.milestones.get(id);
        if (!milestone) return false;
        milestone.completedTasks = completedTasks;
        milestone.progress = Math.round(
            (completedTasks / Math.max(milestone.totalTasks, 1)) * 100,
        );

        // Auto-update status
        const now = new Date();
        const target = new Date(milestone.targetDate);
        if (milestone.progress >= 100) {
            milestone.status = "closed";
        } else if (now > target) {
            milestone.status = "overdue";
        } else if (
            milestone.progress < 50 &&
            target.getTime() - now.getTime() < 7 * 24 * 60 * 60 * 1000
        ) {
            milestone.status = "at_risk";
        } else {
            milestone.status = "open";
        }

        milestone.updatedAt = new Date().toISOString();
        return true;
    }

    linkPRToMilestone(milestoneId: string, prId: string): boolean {
        const milestone = this.milestones.get(milestoneId);
        if (!milestone) return false;
        if (!milestone.linkedPRs.includes(prId)) {
            milestone.linkedPRs.push(prId);
        }
        return true;
    }

    // ==================== REPORTING ====================

    generateReport(repository: string): GitHubReport {
        const prs = [...this.pullRequests.values()];
        const conflicts = [...this.conflicts.values()];
        const milestones = [...this.milestones.values()];
        const recentEvents = this.webhookEvents.slice(-20);

        const openPRs = prs.filter(p => p.status === "open").length;
        const mergedPRs = prs.filter(p => p.status === "merged").length;
        const activeConflicts = conflicts.filter(c => c.status !== "resolved").length;

        // Health score
        let health = 100;
        health -= activeConflicts * 10;
        health -= prs.filter(p => p.reviewStatus === "changes_requested").length * 5;
        health -= milestones.filter(m => m.status === "overdue").length * 15;
        health -= milestones.filter(m => m.status === "at_risk").length * 5;
        health = Math.max(0, Math.min(100, health));

        return {
            timestamp: new Date().toISOString(),
            repository,
            openPRs,
            mergedPRs,
            openIssues: 0,
            closedIssues: 0,
            activeConflicts,
            milestoneProgress: milestones.map(m => ({
                name: m.title,
                progress: m.progress,
                status: m.status,
            })),
            recentActivity: recentEvents,
            healthScore: health,
        };
    }

    // ==================== BRANCH STRATEGY ====================

    getBranchStrategy(): BranchStrategy {
        return { ...this.branchStrategy };
    }

    setBranchStrategy(strategy: Partial<BranchStrategy>): void {
        Object.assign(this.branchStrategy, strategy);
    }

    reset(): void {
        this.webhookEvents = [];
        this.pullRequests.clear();
        this.conflicts.clear();
        this.milestones.clear();
        this.idCounter = 0;
    }
}
