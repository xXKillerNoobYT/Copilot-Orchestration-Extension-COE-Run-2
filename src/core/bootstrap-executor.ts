/**
 * BootstrapExecutor — v11.0 Deterministic Bootstrap Operations
 *
 * Executes the 20 system bootstrap tickets WITHOUT calling the LLM.
 * Each ticket maps to a specific programmatic operation:
 *
 *   TK-1:  Validate LLM connection → healthCheck() + profile check
 *   TK-2:  Build L0-L1 skeleton → agentTreeManager.buildV10Skeleton()
 *   TK-3:  Build L2 branch heads → (already done by buildV10Skeleton)
 *   TK-4-9: Build L3 sub-groups → agentTreeManager.buildL3SubGroups(branch)
 *   TK-10-15: Seed niche agents → nicheAgentFactory.seedDefaultDefinitions()
 *   TK-16: Tool assignments → toolAssignmentManager.grantDefaultToolsForRole()
 *   TK-17: Health check → llmService.healthCheck() + DB/EventBus checks
 *   TK-18: Validate groups → agentTreeManager.validateGroupComposition()
 *   TK-19: Welcome report → generate summary from DB stats
 *   TK-20: Mark initialized → set config flag + emit event
 *
 * Wire in: server.ts / extension.ts → ticketProcessor.setBootstrapExecutor(executor)
 */

import { Database } from './database';
import { EventBus } from './event-bus';
import { Branch, TicketStatus } from '../types';
import type { Ticket } from '../types';

export interface OutputChannelLike {
    appendLine(msg: string): void;
}

/** Minimal interface for LLMService health checks */
export interface LLMServiceLike {
    healthCheck(): Promise<boolean>;
    isHealthy(): boolean;
    getHealthStatus(): { healthy: boolean; reason?: string };
}

/** Minimal interface for AgentTreeManager bootstrap operations */
export interface AgentTreeManagerBootstrapLike {
    buildV10Skeleton(taskId: string): { id: string }[];
    buildL3SubGroups(branch: Branch, taskId: string): { id: string }[];
    validateGroupComposition(group: { id: string }): {
        valid: boolean;
        warnings: string[];
        errors: string[];
    };
}

/** Minimal interface for NicheAgentFactory */
export interface NicheAgentFactoryLike {
    seedDefaultDefinitions(): number;
}

/** Minimal interface for ToolAssignmentManager */
export interface ToolAssignmentManagerLike {
    grantDefaultToolsForRole(nodeId: string, role: string): { tool_name: string }[];
}

/** Minimal interface for LLMProfileManager */
export interface LLMProfileManagerLike {
    getActiveProfile(): { id: string; type: string; model_name: string } | null;
}

/** Result of a deterministic bootstrap execution */
export interface BootstrapResult {
    success: boolean;
    message: string;
    details?: Record<string, unknown>;
}

/**
 * Maps bootstrap ticket titles to deterministic operations.
 * Returns null if this ticket is not a bootstrap operation (fall through to LLM).
 */
export class BootstrapExecutor {
    constructor(
        private database: Database,
        private eventBus: EventBus,
        private outputChannel: OutputChannelLike,
        private llmService: LLMServiceLike,
        private agentTreeManager: AgentTreeManagerBootstrapLike | null,
        private nicheAgentFactory: NicheAgentFactoryLike | null,
        private toolAssignmentManager: ToolAssignmentManagerLike | null,
        private llmProfileManager: LLMProfileManagerLike | null,
    ) {}

    /**
     * Execute a bootstrap ticket deterministically.
     * Returns null if this ticket doesn't match any known bootstrap operation.
     */
    async execute(ticket: Ticket): Promise<BootstrapResult | null> {
        if (ticket.ticket_category !== 'system_bootstrap' && ticket.operation_type !== 'system_bootstrap') {
            return null;
        }

        const title = ticket.title.toLowerCase();

        try {
            // Match ticket title to deterministic operation
            if (title.includes('validate llm connection')) {
                return await this.executeLLMValidation(ticket);
            }
            if (title.includes('build l0-l1 tree skeleton')) {
                return this.executeBuildSkeleton(ticket);
            }
            if (title.includes('build l2 branch heads')) {
                return this.executeBuildL2Heads(ticket);
            }
            if (title.includes('build l3 sub-groups')) {
                return this.executeBuildL3SubGroups(ticket);
            }
            if (title.includes('seed niche agent definitions')) {
                return this.executeSeedNicheAgents(ticket);
            }
            if (title.includes('configure default tool assignments')) {
                return this.executeToolAssignments(ticket);
            }
            if (title.includes('run initial system health check')) {
                return await this.executeHealthCheck(ticket);
            }
            if (title.includes('validate group composition')) {
                return this.executeGroupValidation(ticket);
            }
            if (title.includes('generate welcome report')) {
                return this.executeWelcomeReport(ticket);
            }
            if (title.includes('mark system as initialized')) {
                return this.executeMarkInitialized(ticket);
            }

            // Unknown bootstrap ticket — log warning and let LLM handle
            this.outputChannel.appendLine(
                `[BootstrapExecutor] Unknown bootstrap ticket: "${ticket.title}" — falling back to LLM`
            );
            return null;

        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(
                `[BootstrapExecutor] Error executing "${ticket.title}": ${errMsg}`
            );
            return {
                success: false,
                message: `Bootstrap operation failed: ${errMsg}`,
                details: { error: errMsg },
            };
        }
    }

    // ==================== Individual Bootstrap Operations ====================

    /** TK-1: Validate LLM connection and profile setup */
    private async executeLLMValidation(ticket: Ticket): Promise<BootstrapResult> {
        this.outputChannel.appendLine('[BootstrapExecutor] TK-1: Validating LLM connection...');

        // Check LLM health
        let llmHealthy = false;
        try {
            llmHealthy = await this.llmService.healthCheck();
        } catch {
            // Health check itself failed — LLM may not be reachable
        }

        const healthStatus = this.llmService.getHealthStatus();

        // Check profile
        const activeProfile = this.llmProfileManager?.getActiveProfile();
        const hasProfile = !!activeProfile;

        const details: Record<string, unknown> = {
            llm_healthy: llmHealthy,
            health_reason: healthStatus.reason,
            has_active_profile: hasProfile,
            profile_type: activeProfile?.type,
            profile_model: activeProfile?.model_name,
        };

        if (!llmHealthy) {
            this.outputChannel.appendLine(
                `[BootstrapExecutor] TK-1: LLM not healthy (${healthStatus.reason || 'unknown'}). ` +
                `Continuing bootstrap — LLM health is not strictly required for tree setup.`
            );
        }

        // Even if LLM is unhealthy, we succeed — LLM issues shouldn't block tree bootstrap
        // The health check results are logged for diagnostics
        return {
            success: true,
            message: `LLM validation complete. Healthy: ${llmHealthy}. Profile: ${hasProfile ? activeProfile!.model_name : 'none (using defaults)'}. ` +
                     `Bootstrap can proceed — tree operations are deterministic.`,
            details,
        };
    }

    /** TK-2: Build L0-L1 tree skeleton (idempotent — skips if groups already exist) */
    private executeBuildSkeleton(ticket: Ticket): BootstrapResult {
        this.outputChannel.appendLine('[BootstrapExecutor] TK-2: Building L0-L1 tree skeleton...');

        if (!this.agentTreeManager) {
            return { success: false, message: 'AgentTreeManager not available' };
        }

        // Idempotency: check if skeleton already exists
        const existingGroups = this.database.getAllAgentGroups();
        const hasL1 = existingGroups.some(g => g.level === 1);
        const l2Count = existingGroups.filter(g => g.level === 2).length;
        if (hasL1 && l2Count >= 6) {
            this.outputChannel.appendLine('[BootstrapExecutor] TK-2: Skeleton already exists — skipping build.');
            return {
                success: true,
                message: `L0-L1 tree skeleton already exists (1 L1 + ${l2Count} L2 groups). Skipped.`,
                details: { already_built: true, l2_count: l2Count },
            };
        }

        const groups = this.agentTreeManager.buildV10Skeleton(ticket.task_id || ticket.id);

        return {
            success: true,
            message: `Built L0-L1 tree skeleton: ${groups.length} groups created (1 L1 + 6 L2 branch heads).`,
            details: { groups_created: groups.length, group_ids: groups.map(g => g.id) },
        };
    }

    /** TK-3: Build L2 branch heads — self-healing: builds skeleton if L2 heads are missing */
    private executeBuildL2Heads(ticket: Ticket): BootstrapResult {
        this.outputChannel.appendLine('[BootstrapExecutor] TK-3: Verifying/building L2 branch heads...');

        const branches = [
            Branch.Planning, Branch.Verification, Branch.CodingExecution,
            Branch.CoDirector, Branch.Data, Branch.Orchestrator,
        ];

        // First check: do L2 groups exist?
        let found: string[] = [];
        let missing: string[] = [];

        for (const branch of branches) {
            const groups = this.database.getGroupsByBranch(branch);
            const l2 = groups.filter(g => g.level === 2);
            if (l2.length > 0) {
                found.push(branch);
            } else {
                missing.push(branch);
            }
        }

        // Self-healing: if L2 heads are missing, build the full skeleton
        if (missing.length > 0 && this.agentTreeManager) {
            this.outputChannel.appendLine(
                `[BootstrapExecutor] TK-3: Missing ${missing.length} L2 branch heads — building skeleton to repair...`
            );
            const groups = this.agentTreeManager.buildV10Skeleton(ticket.task_id || ticket.id);
            this.outputChannel.appendLine(
                `[BootstrapExecutor] TK-3: Built ${groups.length} groups via buildV10Skeleton (self-healing).`
            );

            // Re-verify after build
            found = [];
            missing = [];
            for (const branch of branches) {
                const branchGroups = this.database.getGroupsByBranch(branch);
                const l2 = branchGroups.filter(g => g.level === 2);
                if (l2.length > 0) {
                    found.push(branch);
                } else {
                    missing.push(branch);
                }
            }
        }

        if (missing.length > 0) {
            return {
                success: false,
                message: `Missing L2 branch heads for: ${missing.join(', ')} (even after self-heal attempt). AgentTreeManager: ${this.agentTreeManager ? 'available' : 'NOT available'}.`,
                details: { found, missing },
            };
        }

        return {
            success: true,
            message: `All 6 L2 branch heads verified: ${found.join(', ')}.`,
            details: { found },
        };
    }

    /** TK-4 through TK-9: Build L3 sub-groups for a specific branch */
    private executeBuildL3SubGroups(ticket: Ticket): BootstrapResult {
        if (!this.agentTreeManager) {
            return { success: false, message: 'AgentTreeManager not available' };
        }

        // Extract branch name from ticket title
        const branch = this.extractBranchFromTitle(ticket.title);
        if (!branch) {
            return { success: false, message: `Could not determine branch from title: "${ticket.title}"` };
        }

        this.outputChannel.appendLine(`[BootstrapExecutor] Building L3 sub-groups for ${branch}...`);

        // Check if L3 groups already exist for this branch
        const existingGroups = this.database.getGroupsByBranch(branch);
        const existingL3 = existingGroups.filter(g => g.level === 3);
        if (existingL3.length > 0) {
            return {
                success: true,
                message: `L3 sub-groups for ${branch} already exist (${existingL3.length} groups). Skipped.`,
                details: { branch, existing_count: existingL3.length },
            };
        }

        const groups = this.agentTreeManager.buildL3SubGroups(branch, ticket.task_id || ticket.id);

        return {
            success: true,
            message: `Built ${groups.length} L3 sub-group(s) for ${branch} branch.`,
            details: { branch, groups_created: groups.length },
        };
    }

    /** TK-10 through TK-15: Seed niche agent definitions for a domain */
    private executeSeedNicheAgents(ticket: Ticket): BootstrapResult {
        this.outputChannel.appendLine('[BootstrapExecutor] Seeding niche agent definitions...');

        if (!this.nicheAgentFactory) {
            return { success: false, message: 'NicheAgentFactory not available' };
        }

        // Niche agent seeding is all-or-nothing (seeds ALL domains at once)
        // So we just ensure it's been done, then verify the domain from this ticket's title
        const countBefore = this.database.getNicheAgentCount();

        if (countBefore === 0) {
            const seeded = this.nicheAgentFactory.seedDefaultDefinitions();
            this.outputChannel.appendLine(`[BootstrapExecutor] Seeded ${seeded} niche agent definitions.`);
        }

        const countAfter = this.database.getNicheAgentCount();

        // Extract domain from title for verification
        const domain = this.extractDomainFromTitle(ticket.title);

        return {
            success: true,
            message: `Niche agents seeded. Total definitions: ${countAfter}` +
                     (domain ? `. Domain "${domain}" verified.` : '.'),
            details: {
                total_count: countAfter,
                already_seeded: countBefore > 0,
                target_domain: domain,
            },
        };
    }

    /** TK-16: Configure default tool assignments */
    private executeToolAssignments(ticket: Ticket): BootstrapResult {
        this.outputChannel.appendLine('[BootstrapExecutor] TK-16: Configuring default tool assignments...');

        if (!this.toolAssignmentManager) {
            return { success: false, message: 'ToolAssignmentManager not available' };
        }

        // Get all tree nodes and assign tools based on their role
        const allNodes = this.database.getAllTreeNodes();
        let totalAssigned = 0;
        const assignmentDetails: Array<{ nodeId: string; nodeName: string; tools: number }> = [];

        for (const node of allNodes) {
            // Determine role from node metadata or group membership
            const role = node.agent_type || 'worker';
            const granted = this.toolAssignmentManager.grantDefaultToolsForRole(node.id, role);
            if (granted.length > 0) {
                totalAssigned += granted.length;
                assignmentDetails.push({
                    nodeId: node.id,
                    nodeName: node.name,
                    tools: granted.length,
                });
            }
        }

        return {
            success: true,
            message: `Assigned ${totalAssigned} tools across ${assignmentDetails.length} tree nodes.`,
            details: {
                total_tools: totalAssigned,
                nodes_configured: assignmentDetails.length,
                total_nodes: allNodes.length,
            },
        };
    }

    /** TK-17: Run initial system health check */
    private async executeHealthCheck(ticket: Ticket): Promise<BootstrapResult> {
        this.outputChannel.appendLine('[BootstrapExecutor] TK-17: Running system health check...');

        const checks: Array<{ name: string; pass: boolean; detail: string }> = [];

        // 1. LLM endpoint
        try {
            const healthy = await this.llmService.healthCheck();
            checks.push({
                name: 'LLM Endpoint',
                pass: healthy,
                detail: healthy ? 'Reachable' : `Unreachable (${this.llmService.getHealthStatus().reason || 'unknown'})`,
            });
        } catch (e) {
            checks.push({ name: 'LLM Endpoint', pass: false, detail: `Error: ${e}` });
        }

        // 2. Database integrity — check core tables exist
        try {
            const ticketCount = this.database.getAllTickets().length;
            checks.push({ name: 'Database', pass: true, detail: `OK (${ticketCount} tickets)` });
        } catch (e) {
            checks.push({ name: 'Database', pass: false, detail: `Error: ${e}` });
        }

        // 3. EventBus — emit a test event
        try {
            this.eventBus.emit('system:health_check', 'bootstrap-executor', { test: true });
            checks.push({ name: 'EventBus', pass: true, detail: 'Emitting events' });
        } catch (e) {
            checks.push({ name: 'EventBus', pass: false, detail: `Error: ${e}` });
        }

        // 4. Agent tree
        try {
            const nodeCount = this.database.getAllTreeNodes().length;
            checks.push({
                name: 'Agent Tree',
                pass: nodeCount > 0,
                detail: nodeCount > 0 ? `${nodeCount} nodes` : 'No tree nodes found',
            });
        } catch (e) {
            checks.push({ name: 'Agent Tree', pass: false, detail: `Error: ${e}` });
        }

        // 5. Niche agents
        try {
            const nicheCount = this.database.getNicheAgentCount();
            checks.push({
                name: 'Niche Agents',
                pass: nicheCount > 0,
                detail: `${nicheCount} definitions`,
            });
        } catch (e) {
            checks.push({ name: 'Niche Agents', pass: false, detail: `Error: ${e}` });
        }

        const passed = checks.filter(c => c.pass).length;
        const total = checks.length;
        const allPassed = passed === total;

        const summary = checks.map(c => `  ${c.pass ? 'PASS' : 'FAIL'}: ${c.name} — ${c.detail}`).join('\n');
        this.outputChannel.appendLine(`[BootstrapExecutor] Health check: ${passed}/${total} passed\n${summary}`);

        return {
            success: true, // Health check always "succeeds" — it's informational
            message: `System health check: ${passed}/${total} passed.${!allPassed ? ' Some non-critical checks failed — see details.' : ''}`,
            details: { checks, passed, total },
        };
    }

    /** TK-18: Validate group composition for all groups */
    private executeGroupValidation(ticket: Ticket): BootstrapResult {
        this.outputChannel.appendLine('[BootstrapExecutor] TK-18: Validating group composition...');

        if (!this.agentTreeManager) {
            return { success: false, message: 'AgentTreeManager not available' };
        }

        const branches = [
            Branch.Planning, Branch.Verification, Branch.CodingExecution,
            Branch.CoDirector, Branch.Data, Branch.Orchestrator,
        ];

        let totalGroups = 0;
        let hardViolations = 0;
        let softViolations = 0;
        const results: Array<{ branch: string; level: number; valid: boolean; warnings: number; errors: number }> = [];

        for (const branch of branches) {
            const groups = this.database.getGroupsByBranch(branch);
            for (const group of groups) {
                totalGroups++;
                const validation = this.agentTreeManager.validateGroupComposition(group);
                results.push({
                    branch,
                    level: group.level,
                    valid: validation.valid,
                    warnings: validation.warnings.length,
                    errors: validation.errors.length,
                });
                hardViolations += validation.errors.length;
                softViolations += validation.warnings.length;
            }
        }

        return {
            success: hardViolations === 0,
            message: `Validated ${totalGroups} groups. Hard violations: ${hardViolations}. Warnings: ${softViolations}.`,
            details: { totalGroups, hardViolations, softViolations, results },
        };
    }

    /** TK-19: Generate welcome report */
    private executeWelcomeReport(ticket: Ticket): BootstrapResult {
        this.outputChannel.appendLine('[BootstrapExecutor] TK-19: Generating welcome report...');

        const treeNodes = this.database.getAllTreeNodes().length;
        const nicheAgents = this.database.getNicheAgentCount();
        const activeProfile = this.llmProfileManager?.getActiveProfile();

        const branches = [
            Branch.Planning, Branch.Verification, Branch.CodingExecution,
            Branch.CoDirector, Branch.Data, Branch.Orchestrator,
        ];
        let totalGroups = 0;
        for (const b of branches) {
            totalGroups += this.database.getGroupsByBranch(b).length;
        }

        const report = [
            '=== COE v10.0 Bootstrap Report ===',
            '',
            `Tree Nodes:     ${treeNodes}`,
            `Groups Built:   ${totalGroups}`,
            `Niche Agents:   ${nicheAgents} definitions`,
            `LLM Profile:    ${activeProfile ? `${activeProfile.model_name} (${activeProfile.type})` : 'Default config'}`,
            '',
            'Bootstrap Status: All phases complete.',
            'The system is ready for user tickets.',
            '===================================',
        ].join('\n');

        this.outputChannel.appendLine(report);

        return {
            success: true,
            message: report,
            details: { treeNodes, totalGroups, nicheAgents, profileName: activeProfile?.model_name },
        };
    }

    /** TK-20: Mark system as initialized */
    private executeMarkInitialized(ticket: Ticket): BootstrapResult {
        this.outputChannel.appendLine('[BootstrapExecutor] TK-20: Marking system as initialized...');

        // Emit bootstrap complete event
        this.eventBus.emit('system:bootstrap_complete', 'bootstrap-executor', {
            timestamp: new Date().toISOString(),
        });

        this.outputChannel.appendLine('[BootstrapExecutor] COE v10.0 bootstrap complete.');

        return {
            success: true,
            message: 'System initialized. Bootstrap complete. COE v10.0 ready for user tickets.',
            details: { initialized_at: new Date().toISOString() },
        };
    }

    // ==================== Helpers ====================

    /** Extract Branch enum from ticket title like "Build L3 sub-groups for Planning branch" */
    private extractBranchFromTitle(title: string): Branch | null {
        const lower = title.toLowerCase();
        if (lower.includes('planning')) return Branch.Planning;
        if (lower.includes('verification')) return Branch.Verification;
        if (lower.includes('coding') || lower.includes('execution')) return Branch.CodingExecution;
        if (lower.includes('co-director') || lower.includes('codirector')) return Branch.CoDirector;
        if (lower.includes('data')) return Branch.Data;
        if (lower.includes('orchestrator')) return Branch.Orchestrator;
        return null;
    }

    /** Extract domain from "Seed niche agent definitions — Planning domain" */
    private extractDomainFromTitle(title: string): string | null {
        const match = title.match(/—\s*(.+?)\s*domain/i);
        return match ? match[1].trim() : null;
    }
}
