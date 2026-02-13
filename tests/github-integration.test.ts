import {
    GitHubIntegration,
    WebhookEvent,
    PullRequest,
    ConflictResolution,
    Milestone,
    BranchStrategy,
    GitHubReport,
} from "../src/core/github-integration";

jest.mock("vscode", () => require("./__mocks__/vscode"));

describe("GitHubIntegration", () => {
    let integration: GitHubIntegration;

    beforeEach(() => {
        integration = new GitHubIntegration();
    });

    // ==================== WEBHOOK PROCESSING ====================

    describe("Webhook Processing", () => {
        it("should process a push webhook", () => {
            const event = integration.processWebhook("push", "created", "user1", "owner/repo", { ref: "refs/heads/feature" });
            expect(event.type).toBe("push");
            expect(event.action).toBe("created");
            expect(event.sender).toBe("user1");
            expect(event.repository).toBe("owner/repo");
            expect(event.processed).toBe(true);
        });

        it("should process a pull_request opened webhook", () => {
            const event = integration.processWebhook("pull_request", "opened", "user1", "owner/repo", {
                number: 42,
                title: "Fix bug",
                body: "Fixes issue #1",
                base: "main",
                head: "feature/fix-bug",
            });
            expect(event.type).toBe("pull_request");
            expect(event.processed).toBe(true);
            const pr = integration.getPR("pr-42");
            expect(pr).toBeDefined();
            expect(pr!.title).toBe("Fix bug");
            expect(pr!.status).toBe("open");
        });

        it("should process a pull_request closed (merged) webhook", () => {
            // First open the PR
            integration.processWebhook("pull_request", "opened", "user1", "owner/repo", { number: 10, title: "Feature" });
            // Then close with merge
            const event = integration.processWebhook("pull_request", "closed", "user1", "owner/repo", { number: 10, merged: true });
            expect(event.processed).toBe(true);
            const pr = integration.getPR("pr-10");
            expect(pr!.status).toBe("merged");
            expect(pr!.mergedAt).toBeDefined();
        });

        it("should process a pull_request closed (not merged) webhook", () => {
            integration.processWebhook("pull_request", "opened", "user1", "owner/repo", { number: 11, title: "WIP" });
            integration.processWebhook("pull_request", "closed", "user1", "owner/repo", { number: 11, merged: false });
            const pr = integration.getPR("pr-11");
            expect(pr!.status).toBe("closed");
            expect(pr!.mergedAt).toBeUndefined();
        });

        it("should process an issue webhook with milestone", () => {
            integration.createMilestone("v1.0", "First release", "2027-12-31", 10);
            const event = integration.processWebhook("issue", "closed", "user1", "owner/repo", {
                number: 5,
                milestone: "v1.0",
            });
            expect(event.processed).toBe(true);
            const milestones = integration.getAllMilestones();
            expect(milestones[0].completedTasks).toBe(1);
            expect(milestones[0].linkedIssues).toContain("5");
        });

        it("should auto-process and mark event as processed", () => {
            const event = integration.processWebhook("comment", "created", "user1", "owner/repo", {});
            expect(event.processed).toBe(true);
            expect(event.processedAt).toBeDefined();
        });

        it("should limit webhook history to 1000 events", () => {
            for (let i = 0; i < 1005; i++) {
                integration.processWebhook("push", "created", "user1", "owner/repo", { ref: "refs/heads/test" });
            }
            const events = integration.getWebhookEvents(2000);
            expect(events.length).toBe(1000);
        });

        it("should return unprocessed events (all auto-processed)", () => {
            integration.processWebhook("push", "created", "user1", "owner/repo", {});
            const unprocessed = integration.getUnprocessedEvents();
            expect(unprocessed.length).toBe(0);
        });

        it("should get recent events with limit", () => {
            for (let i = 0; i < 10; i++) {
                integration.processWebhook("push", "created", "user1", "owner/repo", {});
            }
            const events = integration.getWebhookEvents(3);
            expect(events.length).toBe(3);
        });

        it("should process reopened PR webhook", () => {
            integration.processWebhook("pull_request", "opened", "user1", "owner/repo", { number: 20, title: "PR" });
            integration.processWebhook("pull_request", "closed", "user1", "owner/repo", { number: 20, merged: false });
            integration.processWebhook("pull_request", "reopened", "user1", "owner/repo", { number: 20, title: "PR v2" });
            const pr = integration.getPR("pr-20");
            expect(pr!.status).toBe("open");
            expect(pr!.title).toBe("PR v2");
        });
    });

    // ==================== PULL REQUEST MANAGEMENT ====================

    describe("Pull Request Management", () => {
        it("should create a PR with task links", () => {
            const pr = integration.createPR("Add feature", "desc", "feature/add", "main", "user1", ["task-1", "task-2"]);
            expect(pr.title).toBe("Add feature");
            expect(pr.status).toBe("open");
            expect(pr.linkedTaskIds).toEqual(["task-1", "task-2"]);
            expect(pr.reviewStatus).toBe("pending");
        });

        it("should get PR by ID", () => {
            const pr = integration.createPR("Test PR", "desc", "feature/test", "main", "user1");
            const found = integration.getPR(pr.id);
            expect(found).toBeDefined();
            expect(found!.title).toBe("Test PR");
        });

        it("should return undefined for non-existent PR", () => {
            expect(integration.getPR("nonexistent")).toBeUndefined();
        });

        it("should get all PRs", () => {
            integration.createPR("PR 1", "desc", "feat/1", "main", "user1");
            integration.createPR("PR 2", "desc", "feat/2", "main", "user2");
            expect(integration.getAllPRs().length).toBe(2);
        });

        it("should get open PRs only", () => {
            const pr1 = integration.createPR("Open", "desc", "feat/1", "main", "user1");
            const pr2 = integration.createPR("Closed", "desc", "feat/2", "main", "user2");
            integration.updatePRStatus(pr2.id, "closed");
            const openPRs = integration.getOpenPRs();
            expect(openPRs.length).toBe(1);
            expect(openPRs[0].title).toBe("Open");
        });

        it("should update PR status to merged", () => {
            const pr = integration.createPR("Merge me", "desc", "feat/1", "main", "user1");
            const result = integration.updatePRStatus(pr.id, "merged");
            expect(result).toBe(true);
            const updated = integration.getPR(pr.id);
            expect(updated!.status).toBe("merged");
            expect(updated!.mergedAt).toBeDefined();
        });

        it("should update PR status to closed", () => {
            const pr = integration.createPR("Close me", "desc", "feat/1", "main", "user1");
            const result = integration.updatePRStatus(pr.id, "closed");
            expect(result).toBe(true);
            expect(integration.getPR(pr.id)!.status).toBe("closed");
        });

        it("should return false when updating non-existent PR", () => {
            expect(integration.updatePRStatus("fake", "merged")).toBe(false);
        });

        it("should add PR review (approved)", () => {
            const pr = integration.createPR("Review me", "desc", "feat/1", "main", "user1");
            const result = integration.addPRReview(pr.id, "approved");
            expect(result).toBe(true);
            expect(integration.getPR(pr.id)!.reviewStatus).toBe("approved");
        });

        it("should add PR review (changes_requested)", () => {
            const pr = integration.createPR("Review me", "desc", "feat/1", "main", "user1");
            integration.addPRReview(pr.id, "changes_requested");
            expect(integration.getPR(pr.id)!.reviewStatus).toBe("changes_requested");
        });

        it("should return false when reviewing non-existent PR", () => {
            expect(integration.addPRReview("fake", "approved")).toBe(false);
        });

        it("should add PR check (passed)", () => {
            const pr = integration.createPR("Check me", "desc", "feat/1", "main", "user1");
            const result = integration.addPRCheck(pr.id, "ci/build", "passed");
            expect(result).toBe(true);
            expect(integration.getPR(pr.id)!.checks).toEqual([{ name: "ci/build", status: "passed" }]);
        });

        it("should add PR check (failed)", () => {
            const pr = integration.createPR("Check me", "desc", "feat/1", "main", "user1");
            integration.addPRCheck(pr.id, "ci/test", "failed");
            expect(integration.getPR(pr.id)!.checks[0].status).toBe("failed");
        });

        it("should update existing check status", () => {
            const pr = integration.createPR("Check me", "desc", "feat/1", "main", "user1");
            integration.addPRCheck(pr.id, "ci/build", "pending");
            integration.addPRCheck(pr.id, "ci/build", "passed");
            expect(integration.getPR(pr.id)!.checks.length).toBe(1);
            expect(integration.getPR(pr.id)!.checks[0].status).toBe("passed");
        });

        it("should return false when adding check to non-existent PR", () => {
            expect(integration.addPRCheck("fake", "ci", "passed")).toBe(false);
        });

        it("should link task to PR", () => {
            const pr = integration.createPR("Link me", "desc", "feat/1", "main", "user1");
            const result = integration.linkTaskToPR(pr.id, "task-99");
            expect(result).toBe(true);
            expect(integration.getPR(pr.id)!.linkedTaskIds).toContain("task-99");
        });

        it("should not duplicate linked tasks", () => {
            const pr = integration.createPR("Link me", "desc", "feat/1", "main", "user1");
            integration.linkTaskToPR(pr.id, "task-99");
            integration.linkTaskToPR(pr.id, "task-99");
            expect(integration.getPR(pr.id)!.linkedTaskIds.filter(t => t === "task-99").length).toBe(1);
        });

        it("should return false when linking task to non-existent PR", () => {
            expect(integration.linkTaskToPR("fake", "task-1")).toBe(false);
        });

        it("should generate branch name from task", () => {
            const name = integration.generateBranchName("T-123", "Add User Authentication");
            expect(name).toBe("feature/T-123-add-user-authentication");
        });

        it("should sanitize branch names", () => {
            const name = integration.generateBranchName("t-1", "Fix bug! @#$ special chars");
            expect(name).not.toMatch(/[^a-z0-9/-]/);
        });

        it("should truncate long branch names to 40 chars for title", () => {
            const name = integration.generateBranchName("T-1", "This is a very long task title that should be truncated to forty characters maximum");
            const titlePart = name.replace("feature/T-1-", "");
            expect(titlePart.length).toBeLessThanOrEqual(40);
        });
    });

    // ==================== CONFLICT RESOLUTION ====================

    describe("Conflict Resolution", () => {
        it("should detect a merge conflict", () => {
            const pr = integration.createPR("My PR", "desc", "feat/1", "main", "user1");
            const conflict = integration.detectConflict(pr.id, ["file1.ts", "file2.ts"]);
            expect(conflict.type).toBe("merge_conflict");
            expect(conflict.status).toBe("detected");
            expect(conflict.files).toEqual(["file1.ts", "file2.ts"]);
        });

        it("should set severity low for 1-2 files", () => {
            const pr = integration.createPR("PR", "d", "f/1", "main", "u");
            const conflict = integration.detectConflict(pr.id, ["a.ts"]);
            expect(conflict.severity).toBe("low");
        });

        it("should set severity medium for 3-5 files", () => {
            const pr = integration.createPR("PR", "d", "f/1", "main", "u");
            const conflict = integration.detectConflict(pr.id, ["a.ts", "b.ts", "c.ts"]);
            expect(conflict.severity).toBe("medium");
        });

        it("should set severity high for >5 files", () => {
            const pr = integration.createPR("PR", "d", "f/1", "main", "u");
            const conflict = integration.detectConflict(pr.id, ["a", "b", "c", "d", "e", "f"]);
            expect(conflict.severity).toBe("high");
        });

        it("should suggest manual resolution for >5 files", () => {
            const pr = integration.createPR("PR", "d", "f/1", "main", "u");
            const conflict = integration.detectConflict(pr.id, ["a", "b", "c", "d", "e", "f"]);
            expect(conflict.suggestedResolution).toBe("manual");
        });

        it("should suggest merge resolution for <=5 files", () => {
            const pr = integration.createPR("PR", "d", "f/1", "main", "u");
            const conflict = integration.detectConflict(pr.id, ["a.ts"]);
            expect(conflict.suggestedResolution).toBe("merge");
        });

        it("should resolve a conflict", () => {
            const pr = integration.createPR("PR", "d", "f/1", "main", "u");
            const conflict = integration.detectConflict(pr.id, ["a.ts"]);
            const result = integration.resolveConflict(conflict.id, "keep_local", "admin");
            expect(result).toBe(true);
            const resolved = integration.getConflict(conflict.id);
            expect(resolved!.status).toBe("resolved");
            expect(resolved!.resolvedBy).toBe("admin");
            expect(resolved!.resolvedAt).toBeDefined();
        });

        it("should return false when resolving non-existent conflict", () => {
            expect(integration.resolveConflict("fake", "merge", "admin")).toBe(false);
        });

        it("should escalate a conflict", () => {
            const pr = integration.createPR("PR", "d", "f/1", "main", "u");
            const conflict = integration.detectConflict(pr.id, ["a.ts"]);
            const result = integration.escalateConflict(conflict.id);
            expect(result).toBe(true);
            const escalated = integration.getConflict(conflict.id);
            expect(escalated!.status).toBe("escalated");
            expect(escalated!.severity).toBe("critical");
        });

        it("should return false when escalating non-existent conflict", () => {
            expect(integration.escalateConflict("fake")).toBe(false);
        });

        it("should get active conflicts excluding resolved", () => {
            const pr = integration.createPR("PR", "d", "f/1", "main", "u");
            const c1 = integration.detectConflict(pr.id, ["a.ts"]);
            const c2 = integration.detectConflict(pr.id, ["b.ts"]);
            integration.resolveConflict(c1.id, "merge", "admin");
            const active = integration.getActiveConflicts();
            expect(active.length).toBe(1);
            expect(active[0].id).toBe(c2.id);
        });

        it("should update PR conflictFiles when conflict detected", () => {
            const pr = integration.createPR("PR", "d", "f/1", "main", "u");
            integration.detectConflict(pr.id, ["x.ts", "y.ts"]);
            expect(integration.getPR(pr.id)!.conflictFiles).toEqual(["x.ts", "y.ts"]);
        });

        it("should get conflict by ID", () => {
            const pr = integration.createPR("PR", "d", "f/1", "main", "u");
            const conflict = integration.detectConflict(pr.id, ["a.ts"]);
            expect(integration.getConflict(conflict.id)).toBeDefined();
            expect(integration.getConflict("fake")).toBeUndefined();
        });

        it("should detect conflict without linked PR", () => {
            const conflict = integration.detectConflict("no-pr", ["a.ts"]);
            expect(conflict.title).toBe("Merge conflict detected");
        });
    });

    // ==================== MILESTONE TRACKING ====================

    describe("Milestone Tracking", () => {
        it("should create a milestone", () => {
            const ms = integration.createMilestone("v1.0", "First release", "2027-06-01", 20);
            expect(ms.title).toBe("v1.0");
            expect(ms.status).toBe("open");
            expect(ms.progress).toBe(0);
            expect(ms.totalTasks).toBe(20);
            expect(ms.completedTasks).toBe(0);
        });

        it("should update milestone progress", () => {
            const ms = integration.createMilestone("v1.0", "desc", "2027-06-01", 10);
            const result = integration.updateMilestoneProgress(ms.id, 5);
            expect(result).toBe(true);
            const updated = integration.getMilestone(ms.id);
            expect(updated!.progress).toBe(50);
            expect(updated!.completedTasks).toBe(5);
        });

        it("should return false when updating non-existent milestone", () => {
            expect(integration.updateMilestoneProgress("fake", 5)).toBe(false);
        });

        it("should auto-set status to closed when 100%", () => {
            const ms = integration.createMilestone("v1.0", "desc", "2027-06-01", 10);
            integration.updateMilestoneProgress(ms.id, 10);
            expect(integration.getMilestone(ms.id)!.status).toBe("closed");
            expect(integration.getMilestone(ms.id)!.progress).toBe(100);
        });

        it("should auto-set status to overdue when past target date", () => {
            const ms = integration.createMilestone("v1.0", "desc", "2020-01-01", 10);
            integration.updateMilestoneProgress(ms.id, 3);
            expect(integration.getMilestone(ms.id)!.status).toBe("overdue");
        });

        it("should auto-set status to at_risk when <50% and near deadline", () => {
            // Target date is 3 days from now (< 7 days) and progress < 50%
            const target = new Date();
            target.setDate(target.getDate() + 3);
            const ms = integration.createMilestone("v1.0", "desc", target.toISOString(), 10);
            integration.updateMilestoneProgress(ms.id, 2);
            expect(integration.getMilestone(ms.id)!.status).toBe("at_risk");
        });

        it("should keep status open when well ahead of schedule", () => {
            const target = new Date();
            target.setDate(target.getDate() + 60);
            const ms = integration.createMilestone("v2.0", "desc", target.toISOString(), 10);
            integration.updateMilestoneProgress(ms.id, 3);
            expect(integration.getMilestone(ms.id)!.status).toBe("open");
        });

        it("should link PR to milestone", () => {
            const ms = integration.createMilestone("v1.0", "desc", "2027-06-01", 10);
            const pr = integration.createPR("PR", "d", "f/1", "main", "u");
            const result = integration.linkPRToMilestone(ms.id, pr.id);
            expect(result).toBe(true);
            expect(integration.getMilestone(ms.id)!.linkedPRs).toContain(pr.id);
        });

        it("should not duplicate linked PRs", () => {
            const ms = integration.createMilestone("v1.0", "desc", "2027-06-01", 10);
            const pr = integration.createPR("PR", "d", "f/1", "main", "u");
            integration.linkPRToMilestone(ms.id, pr.id);
            integration.linkPRToMilestone(ms.id, pr.id);
            expect(integration.getMilestone(ms.id)!.linkedPRs.length).toBe(1);
        });

        it("should return false when linking PR to non-existent milestone", () => {
            expect(integration.linkPRToMilestone("fake", "pr-1")).toBe(false);
        });

        it("should process issue webhook and update milestone", () => {
            integration.createMilestone("Sprint 1", "desc", "2027-12-31", 5);
            integration.processWebhook("issue", "opened", "user1", "repo", { number: 10, milestone: "Sprint 1" });
            integration.processWebhook("issue", "closed", "user1", "repo", { number: 10, milestone: "Sprint 1" });
            const ms = integration.getAllMilestones()[0];
            expect(ms.linkedIssues).toContain("10");
            expect(ms.completedTasks).toBe(1);
        });

        it("should get all milestones", () => {
            integration.createMilestone("v1", "d", "2027-01-01", 5);
            integration.createMilestone("v2", "d", "2027-06-01", 10);
            expect(integration.getAllMilestones().length).toBe(2);
        });

        it("should get milestone by ID", () => {
            const ms = integration.createMilestone("v1", "d", "2027-01-01", 5);
            expect(integration.getMilestone(ms.id)).toBeDefined();
            expect(integration.getMilestone("fake")).toBeUndefined();
        });
    });

    // ==================== REPORTING ====================

    describe("Reporting", () => {
        it("should generate a report with all sections", () => {
            const report = integration.generateReport("owner/repo");
            expect(report.repository).toBe("owner/repo");
            expect(report.timestamp).toBeDefined();
            expect(typeof report.openPRs).toBe("number");
            expect(typeof report.mergedPRs).toBe("number");
            expect(typeof report.activeConflicts).toBe("number");
            expect(Array.isArray(report.milestoneProgress)).toBe(true);
            expect(Array.isArray(report.recentActivity)).toBe(true);
            expect(typeof report.healthScore).toBe("number");
        });

        it("should start with health score of 100", () => {
            const report = integration.generateReport("owner/repo");
            expect(report.healthScore).toBe(100);
        });

        it("should degrade health with active conflicts", () => {
            const pr = integration.createPR("PR", "d", "f/1", "main", "u");
            integration.detectConflict(pr.id, ["a.ts"]);
            const report = integration.generateReport("owner/repo");
            expect(report.healthScore).toBe(90);
            expect(report.activeConflicts).toBe(1);
        });

        it("should degrade health with overdue milestones", () => {
            const ms = integration.createMilestone("v1", "d", "2020-01-01", 10);
            integration.updateMilestoneProgress(ms.id, 3);
            const report = integration.generateReport("owner/repo");
            expect(report.healthScore).toBe(85);
        });

        it("should degrade health with at_risk milestones", () => {
            const target = new Date();
            target.setDate(target.getDate() + 3);
            const ms = integration.createMilestone("v1", "d", target.toISOString(), 10);
            integration.updateMilestoneProgress(ms.id, 2);
            const report = integration.generateReport("owner/repo");
            expect(report.healthScore).toBe(95);
        });

        it("should degrade health with changes_requested reviews", () => {
            const pr = integration.createPR("PR", "d", "f/1", "main", "u");
            integration.addPRReview(pr.id, "changes_requested");
            const report = integration.generateReport("owner/repo");
            expect(report.healthScore).toBe(95);
        });

        it("should include recent activity in report", () => {
            integration.processWebhook("push", "created", "user1", "repo", {});
            const report = integration.generateReport("owner/repo");
            expect(report.recentActivity.length).toBe(1);
        });

        it("should count open and merged PRs", () => {
            const pr1 = integration.createPR("Open", "d", "f/1", "main", "u");
            const pr2 = integration.createPR("Merged", "d", "f/2", "main", "u");
            integration.updatePRStatus(pr2.id, "merged");
            const report = integration.generateReport("owner/repo");
            expect(report.openPRs).toBe(1);
            expect(report.mergedPRs).toBe(1);
        });

        it("should include milestone progress", () => {
            const ms = integration.createMilestone("v1", "d", "2027-06-01", 10);
            integration.updateMilestoneProgress(ms.id, 5);
            const report = integration.generateReport("owner/repo");
            expect(report.milestoneProgress.length).toBe(1);
            expect(report.milestoneProgress[0].name).toBe("v1");
            expect(report.milestoneProgress[0].progress).toBe(50);
        });

        it("should clamp health score to 0-100", () => {
            // Create many conflicts to push health below 0
            for (let i = 0; i < 15; i++) {
                const pr = integration.createPR("PR" + i, "d", "f/" + i, "main", "u");
                integration.detectConflict(pr.id, ["a.ts"]);
            }
            const report = integration.generateReport("owner/repo");
            expect(report.healthScore).toBeGreaterThanOrEqual(0);
            expect(report.healthScore).toBeLessThanOrEqual(100);
        });
    });

    // ==================== BRANCH STRATEGY ====================

    describe("Branch Strategy", () => {
        it("should have default branch strategy", () => {
            const strategy = integration.getBranchStrategy();
            expect(strategy.mainBranch).toBe("main");
            expect(strategy.developBranch).toBe("develop");
            expect(strategy.featurePrefix).toBe("feature/");
            expect(strategy.hotfixPrefix).toBe("hotfix/");
            expect(strategy.releasePrefix).toBe("release/");
            expect(strategy.taskBranchPattern).toBe("feature/{task-id}-{title}");
        });

        it("should accept custom branch strategy in constructor", () => {
            const custom = new GitHubIntegration({ mainBranch: "master", featurePrefix: "feat/" });
            const strategy = custom.getBranchStrategy();
            expect(strategy.mainBranch).toBe("master");
            expect(strategy.featurePrefix).toBe("feat/");
            expect(strategy.developBranch).toBe("develop"); // default preserved
        });

        it("should update branch strategy", () => {
            integration.setBranchStrategy({ mainBranch: "production" });
            expect(integration.getBranchStrategy().mainBranch).toBe("production");
            expect(integration.getBranchStrategy().developBranch).toBe("develop"); // unchanged
        });

        it("should return a copy of branch strategy", () => {
            const s1 = integration.getBranchStrategy();
            s1.mainBranch = "modified";
            expect(integration.getBranchStrategy().mainBranch).toBe("main");
        });
    });

    // ==================== RESET & EDGE CASES ====================

    describe("Reset and Edge Cases", () => {
        it("should reset all state", () => {
            integration.createPR("PR", "d", "f/1", "main", "u");
            integration.createMilestone("v1", "d", "2027-01-01", 5);
            integration.processWebhook("push", "created", "user1", "repo", {});
            integration.reset();
            expect(integration.getAllPRs().length).toBe(0);
            expect(integration.getAllMilestones().length).toBe(0);
            expect(integration.getWebhookEvents().length).toBe(0);
            expect(integration.getActiveConflicts().length).toBe(0);
        });

        it("should handle push to main detecting conflicts with open PRs", () => {
            const pr = integration.createPR("Open PR", "d", "feat/1", "main", "u");
            integration.processWebhook("push", "created", "user1", "repo", {
                ref: "refs/heads/main",
                files: ["conflict.ts"],
            });
            // The push to main should trigger conflict detection for the open PR
            const conflicts = integration.getActiveConflicts();
            expect(conflicts.length).toBeGreaterThan(0);
        });

        it("should not detect conflicts for push to non-main branch", () => {
            integration.createPR("Open PR", "d", "feat/1", "main", "u");
            integration.processWebhook("push", "created", "user1", "repo", {
                ref: "refs/heads/feature/other",
                files: ["something.ts"],
            });
            expect(integration.getActiveConflicts().length).toBe(0);
        });

        it("should handle issue webhook with no milestone", () => {
            const event = integration.processWebhook("issue", "opened", "user1", "repo", { number: 1 });
            expect(event.processed).toBe(true);
            // No crash, milestone list unchanged
            expect(integration.getAllMilestones().length).toBe(0);
        });

        it("should handle issue webhook with non-matching milestone", () => {
            integration.createMilestone("v1", "d", "2027-01-01", 5);
            integration.processWebhook("issue", "opened", "user1", "repo", { number: 1, milestone: "v2" });
            const ms = integration.getAllMilestones()[0];
            expect(ms.linkedIssues.length).toBe(0);
        });

        it("should not add duplicate issue to milestone", () => {
            integration.createMilestone("Sprint 1", "d", "2027-12-31", 5);
            integration.processWebhook("issue", "opened", "user1", "repo", { number: 1, milestone: "Sprint 1" });
            integration.processWebhook("issue", "opened", "user1", "repo", { number: 1, milestone: "Sprint 1" });
            const ms = integration.getAllMilestones()[0];
            expect(ms.linkedIssues.filter(i => i === "1").length).toBe(1);
        });
    });
});
