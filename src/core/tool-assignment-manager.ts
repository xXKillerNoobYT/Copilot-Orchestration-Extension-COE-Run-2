/**
 * ToolAssignmentManager — v10.0 Per-Agent Tool Grants
 *
 * Manages which tools each agent node has access to.
 * Tools can be granted by: self-request, parent approval, or system auto-grant.
 *
 * Tool inheritance: child agents inherit parent's basic tools.
 * Tool escalation: if an agent needs a tool it doesn't have, it escalates to parent.
 *
 * Built-in tools: file_read, file_write, terminal, git, test_run, web_search,
 *                 code_analyze, db_query, lint, format, refactor, deploy,
 *                 llm_call, ticket_manage, tree_manage, report_submit
 */

import { Database } from './database';
import { EventBus } from './event-bus';
import { ToolAssignment, BuiltInTool } from '../types';
import { randomUUID } from 'crypto';

export interface OutputChannelLike {
    appendLine(msg: string): void;
}

/** Result of a tool access check */
export interface ToolAccessResult {
    allowed: boolean;
    tool: string;
    node_id: string;
    reason: 'granted' | 'inherited' | 'denied' | 'escalation_needed';
    inherited_from?: string;
}

/** Tool escalation request */
export interface ToolEscalation {
    node_id: string;
    tool_name: string;
    reason: string;
    parent_node_id: string | null;
}

/** Default tool sets by group role */
const ROLE_DEFAULT_TOOLS: Record<string, BuiltInTool[]> = {
    head_orchestrator: [
        BuiltInTool.FileRead, BuiltInTool.CodeAnalyze,
        BuiltInTool.Git, BuiltInTool.Lint,
    ],
    planning: [
        BuiltInTool.FileRead, BuiltInTool.CodeAnalyze,
    ],
    verification: [
        BuiltInTool.FileRead, BuiltInTool.TestRun,
        BuiltInTool.CodeAnalyze, BuiltInTool.Lint,
    ],
    review: [
        BuiltInTool.FileRead, BuiltInTool.CodeAnalyze,
        BuiltInTool.Lint,
    ],
    observation: [
        BuiltInTool.FileRead, BuiltInTool.CodeAnalyze,
    ],
    structure_improvement: [
        BuiltInTool.FileRead, BuiltInTool.CodeAnalyze,
        BuiltInTool.Refactor,
    ],
    orchestrator: [
        BuiltInTool.FileRead, BuiltInTool.CodeAnalyze,
    ],
    worker: [
        BuiltInTool.FileRead, BuiltInTool.FileWrite,
        BuiltInTool.CodeAnalyze, BuiltInTool.Lint,
        BuiltInTool.Format,
    ],
    open_slot: [],
};

export class ToolAssignmentManager {
    constructor(
        private database: Database,
        private eventBus: EventBus,
        private outputChannel: OutputChannelLike
    ) {}

    // ==================== GRANT / REVOKE ====================

    /**
     * Grant a tool to a node.
     * @param nodeId The agent node receiving the tool
     * @param toolName The tool to grant (BuiltInTool value or custom string)
     * @param assignedBy Who granted: 'self', 'parent', or 'system'
     */
    grantTool(nodeId: string, toolName: string, assignedBy: 'self' | 'parent' | 'system' = 'system'): ToolAssignment | null {
        // Check if already granted
        if (this.database.hasToolAssignment(nodeId, toolName)) {
            return null; // Already has this tool
        }

        const assignment = this.database.createToolAssignment({
            id: randomUUID(),
            node_id: nodeId,
            tool_name: toolName,
            assigned_by: assignedBy,
            expires_at: null,
        });

        this.outputChannel.appendLine(
            `[ToolAssignmentManager] Granted '${toolName}' to node ${nodeId} (by: ${assignedBy})`
        );

        this.eventBus.emit('permission:granted', 'tool-assignment-manager', {
            node_id: nodeId,
            tool_name: toolName,
            assigned_by: assignedBy,
        });

        return assignment;
    }

    /**
     * Revoke a tool from a node.
     * Returns true if the tool was found and removed, false if it wasn't assigned.
     */
    revokeTool(nodeId: string, toolName: string): boolean {
        // Check if assignment exists before removing
        const hadTool = this.database.hasToolAssignment(nodeId, toolName);
        if (!hadTool) {
            return false;
        }

        this.database.removeToolAssignment(nodeId, toolName);

        this.outputChannel.appendLine(
            `[ToolAssignmentManager] Revoked '${toolName}' from node ${nodeId}`
        );

        this.eventBus.emit('permission:revoked', 'tool-assignment-manager', {
            node_id: nodeId,
            tool_name: toolName,
        });

        return true;
    }

    /**
     * Revoke all tools from a node.
     */
    revokeAllTools(nodeId: string): void {
        this.database.removeAllToolAssignments(nodeId);
        this.outputChannel.appendLine(
            `[ToolAssignmentManager] Revoked all tools from node ${nodeId}`
        );
    }

    // ==================== QUERY ====================

    /**
     * Get all tools granted to a node (direct grants only, not inherited).
     */
    getDirectTools(nodeId: string): ToolAssignment[] {
        return this.database.getToolAssignmentsForNode(nodeId);
    }

    /**
     * Check if a node has access to a specific tool.
     * Checks direct grants first, then inheritance from parent chain.
     */
    checkToolAccess(nodeId: string, toolName: string): ToolAccessResult {
        // 1. Check direct grant
        if (this.database.hasToolAssignment(nodeId, toolName)) {
            return {
                allowed: true,
                tool: toolName,
                node_id: nodeId,
                reason: 'granted',
            };
        }

        // 2. Check inheritance from parent chain
        const inheritedFrom = this.checkInheritedAccess(nodeId, toolName);
        if (inheritedFrom) {
            return {
                allowed: true,
                tool: toolName,
                node_id: nodeId,
                reason: 'inherited',
                inherited_from: inheritedFrom,
            };
        }

        // 3. Not available — escalation needed
        return {
            allowed: false,
            tool: toolName,
            node_id: nodeId,
            reason: 'escalation_needed',
        };
    }

    /**
     * Walk up the parent chain to find inherited tool access.
     * Returns the node_id that provides the inherited tool, or null.
     */
    private checkInheritedAccess(nodeId: string, toolName: string): string | null {
        // Only inherit basic read-only tools (not write, terminal, deploy, etc.)
        const inheritableTools = new Set<string>([
            BuiltInTool.FileRead,
            BuiltInTool.CodeAnalyze,
            BuiltInTool.Lint,
        ]);

        if (!inheritableTools.has(toolName)) {
            return null; // Non-inheritable tools must be explicitly granted
        }

        const node = this.database.getTreeNode(nodeId);
        if (!node || !node.parent_id) return null;

        // Walk up (max 10 levels to prevent infinite loops)
        let currentId: string | null = node.parent_id;
        let depth = 0;
        while (currentId && depth < 10) {
            if (this.database.hasToolAssignment(currentId, toolName)) {
                return currentId;
            }
            const parent = this.database.getTreeNode(currentId);
            currentId = parent?.parent_id ?? null;
            depth++;
        }

        return null;
    }

    // ==================== DEFAULT GRANTS ====================

    /**
     * Grant default tools for a group role.
     * Called when a node is assigned to a group with a specific role.
     */
    grantDefaultToolsForRole(nodeId: string, role: string): ToolAssignment[] {
        const defaults = ROLE_DEFAULT_TOOLS[role] ?? [];
        const granted: ToolAssignment[] = [];

        for (const tool of defaults) {
            const assignment = this.grantTool(nodeId, tool, 'system');
            if (assignment) {
                granted.push(assignment);
            }
        }

        return granted;
    }

    /**
     * Grant a set of tools to a node in bulk.
     */
    grantBulkTools(nodeId: string, tools: string[], assignedBy: 'self' | 'parent' | 'system' = 'system'): ToolAssignment[] {
        const granted: ToolAssignment[] = [];
        for (const tool of tools) {
            const assignment = this.grantTool(nodeId, tool, assignedBy);
            if (assignment) {
                granted.push(assignment);
            }
        }
        return granted;
    }

    // ==================== ESCALATION ====================

    /**
     * Create a tool escalation request.
     * The agent doesn't have the tool and needs parent approval.
     */
    requestToolEscalation(nodeId: string, toolName: string, reason: string): ToolEscalation {
        const node = this.database.getTreeNode(nodeId);

        const escalation: ToolEscalation = {
            node_id: nodeId,
            tool_name: toolName,
            reason,
            parent_node_id: node?.parent_id ?? null,
        };

        this.outputChannel.appendLine(
            `[ToolAssignmentManager] Tool escalation: node ${nodeId} requests '${toolName}' — ${reason}`
        );

        this.eventBus.emit('permission:check_failed', 'tool-assignment-manager', {
            node_id: nodeId,
            tool_name: toolName,
            reason,
            parent_node_id: escalation.parent_node_id,
            escalation_type: 'tool_request',
        });

        return escalation;
    }

    /**
     * Approve a tool escalation — grants the tool to the requesting node.
     */
    approveEscalation(escalation: ToolEscalation): ToolAssignment | null {
        return this.grantTool(escalation.node_id, escalation.tool_name, 'parent');
    }

    // ==================== UTILITY ====================

    /**
     * Get all built-in tool names.
     */
    getBuiltInToolNames(): string[] {
        return Object.values(BuiltInTool);
    }

    /**
     * Get the full tool set for a node (direct + inherited).
     */
    getEffectiveTools(nodeId: string): string[] {
        const direct = this.database.getToolAssignmentsForNode(nodeId);
        const directNames = new Set(direct.map(a => a.tool_name));

        // Add inheritable tools from parents
        const inheritableTools = [
            BuiltInTool.FileRead,
            BuiltInTool.CodeAnalyze,
            BuiltInTool.Lint,
        ];

        for (const tool of inheritableTools) {
            if (!directNames.has(tool)) {
                const inherited = this.checkInheritedAccess(nodeId, tool);
                if (inherited) {
                    directNames.add(tool);
                }
            }
        }

        return [...directNames];
    }
}
