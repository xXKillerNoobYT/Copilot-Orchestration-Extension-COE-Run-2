/**
 * AgentPermissionManager — v9.0 Permission System
 *
 * CRUD + enforcement for agent permissions. Controls what agents can do,
 * what tools they can access, and enforces limits on LLM calls and time.
 *
 * Defaults: All existing agents get full permissions. New niche agents
 * inherit parent's permissions. Tree nodes can have restricted permissions.
 */

import { Database } from './database';
import {
    AgentPermission,
    AgentPermissionSet,
    AgentTreeNode,
    WorkflowStep,
} from '../types';

/** Error thrown when an agent lacks required permission */
export class PermissionDeniedError extends Error {
    constructor(
        public readonly agentType: string,
        public readonly permission: AgentPermission,
        public readonly resource?: string
    ) {
        super(`Permission denied: agent '${agentType}' lacks '${permission}'${resource ? ` for resource '${resource}'` : ''}`);
        this.name = 'PermissionDeniedError';
    }
}

/** Default permissions granted to all existing agents */
const DEFAULT_PERMISSIONS: AgentPermission[] = [
    AgentPermission.Read,
    AgentPermission.Write,
    AgentPermission.Execute,
    AgentPermission.Escalate,
    AgentPermission.Spawn,
    AgentPermission.Configure,
    AgentPermission.Approve,
    AgentPermission.Delete,
];

/** Restricted permissions for lower-level niche agents (L5-L9) */
const NICHE_AGENT_PERMISSIONS: AgentPermission[] = [
    AgentPermission.Read,
    AgentPermission.Write,
    AgentPermission.Execute,
    AgentPermission.Escalate,
];

/** Minimum permissions every agent always has (cannot be revoked) */
const MINIMUM_PERMISSIONS: AgentPermission[] = [
    AgentPermission.Read,
    AgentPermission.Escalate,
];

export class AgentPermissionManager {
    constructor(private readonly database: Database) {}

    // ==================== CRUD ====================

    /**
     * Set permissions for an agent type (creates or updates).
     * If a permission set already exists for this agent type + instance, updates it.
     * Otherwise creates a new one.
     */
    setPermissions(
        agentType: string,
        permissions: AgentPermission[],
        instanceId?: string
    ): AgentPermissionSet {
        const existing = this.database.getPermissionSetByAgent(agentType, instanceId);
        if (existing) {
            this.database.updatePermissionSet(existing.id, { permissions });
            return this.database.getPermissionSet(existing.id)!;
        }
        return this.database.createPermissionSet({
            agent_type: agentType,
            agent_instance_id: instanceId ?? null,
            permissions,
        });
    }

    /**
     * Get permissions for an agent, with fallback chain:
     * 1. Instance-specific permission set
     * 2. Type-level permission set
     * 3. Default full permissions
     */
    getPermissions(agentType: string, instanceId?: string): AgentPermissionSet {
        const found = this.database.getPermissionSetByAgent(agentType, instanceId);
        if (found) return found;

        // Return a virtual default set (not persisted until explicitly set)
        return {
            id: '',
            agent_type: agentType,
            agent_instance_id: instanceId ?? null,
            permissions: [...DEFAULT_PERMISSIONS],
            allowed_tools: [],
            blocked_tools: [],
            can_spawn: true,
            max_llm_calls: 100,
            max_time_minutes: 60,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
    }

    /**
     * Get a permission set by ID.
     */
    getPermissionSetById(id: string): AgentPermissionSet | null {
        return this.database.getPermissionSet(id);
    }

    /**
     * Grant a specific permission to an agent type.
     * Creates permission set if none exists.
     */
    grantPermission(agentType: string, permission: AgentPermission, instanceId?: string): AgentPermissionSet {
        const current = this.getPermissions(agentType, instanceId);
        if (!current.permissions.includes(permission)) {
            current.permissions.push(permission);
        }
        return this.setPermissions(agentType, current.permissions, instanceId);
    }

    /**
     * Revoke a specific permission from an agent type.
     * Cannot revoke minimum permissions (Read, Escalate).
     */
    revokePermission(agentType: string, permission: AgentPermission, instanceId?: string): AgentPermissionSet {
        if (MINIMUM_PERMISSIONS.includes(permission)) {
            // Cannot revoke minimum permissions — silently keep them
            return this.getPermissions(agentType, instanceId);
        }
        const current = this.getPermissions(agentType, instanceId);
        const filtered = current.permissions.filter(p => p !== permission);
        // Ensure minimum permissions are always present
        for (const minPerm of MINIMUM_PERMISSIONS) {
            if (!filtered.includes(minPerm)) {
                filtered.push(minPerm);
            }
        }
        return this.setPermissions(agentType, filtered, instanceId);
    }

    /**
     * Update non-permission fields (tools, spawn, limits).
     */
    updatePermissionConfig(
        agentType: string,
        updates: Partial<Pick<AgentPermissionSet, 'allowed_tools' | 'blocked_tools' | 'can_spawn' | 'max_llm_calls' | 'max_time_minutes'>>,
        instanceId?: string
    ): AgentPermissionSet {
        const current = this.getPermissions(agentType, instanceId);
        if (!current.id) {
            // No persisted set yet — create one with defaults + updates
            return this.database.createPermissionSet({
                agent_type: agentType,
                agent_instance_id: instanceId ?? null,
                permissions: current.permissions,
                ...updates,
            });
        }
        this.database.updatePermissionSet(current.id, updates);
        return this.database.getPermissionSet(current.id)!;
    }

    /**
     * Delete a permission set entirely, reverting to defaults.
     */
    deletePermissionSet(id: string): boolean {
        return this.database.deletePermissionSet(id);
    }

    // ==================== ENFORCEMENT ====================

    /**
     * Check if an agent has a specific permission.
     * Returns true if permitted, false if denied.
     */
    checkPermission(agentType: string, permission: AgentPermission, instanceId?: string): boolean {
        const perms = this.getPermissions(agentType, instanceId);
        return perms.permissions.includes(permission);
    }

    /**
     * Enforce a permission — throws PermissionDeniedError if denied.
     * Use this as a gate before performing an action.
     */
    enforcePermission(agentType: string, permission: AgentPermission, resource?: string, instanceId?: string): void {
        if (!this.checkPermission(agentType, permission, instanceId)) {
            throw new PermissionDeniedError(agentType, permission, resource);
        }
    }

    /**
     * Check if an agent can spawn children.
     */
    canSpawn(agentType: string, instanceId?: string): boolean {
        const perms = this.getPermissions(agentType, instanceId);
        return perms.can_spawn && perms.permissions.includes(AgentPermission.Spawn);
    }

    /**
     * Check if an agent can use a specific tool.
     * Logic: If allowed_tools is non-empty, tool must be in the list.
     *        If blocked_tools contains the tool, it's blocked regardless.
     */
    canUseTool(agentType: string, toolName: string, instanceId?: string): boolean {
        const perms = this.getPermissions(agentType, instanceId);

        // Blocked tools always take precedence
        if (perms.blocked_tools.includes(toolName)) {
            return false;
        }

        // If allowed_tools is specified (non-empty), tool must be in the list
        if (perms.allowed_tools.length > 0) {
            return perms.allowed_tools.includes(toolName);
        }

        // No restrictions — tool is allowed
        return true;
    }

    // ==================== EFFECTIVE TOOLS ====================

    /**
     * Get the effective list of tools an agent can use, optionally
     * considering workflow step tool unlocks.
     *
     * @param agentType - The agent type
     * @param allTools - Complete list of available tools in the system
     * @param workflowStep - Optional workflow step that may unlock additional tools
     * @param instanceId - Optional specific instance
     * @returns Filtered list of tools the agent can actually use
     */
    getEffectiveTools(
        agentType: string,
        allTools: string[],
        workflowStep?: WorkflowStep | null,
        instanceId?: string
    ): string[] {
        const perms = this.getPermissions(agentType, instanceId);

        // Start with base tool set
        let tools: string[];
        if (perms.allowed_tools.length > 0) {
            // Whitelist mode — only allowed tools
            tools = allTools.filter(t => perms.allowed_tools.includes(t));
        } else {
            // All tools available by default
            tools = [...allTools];
        }

        // Add workflow step unlocked tools
        if (workflowStep?.tools_unlocked && workflowStep.tools_unlocked.length > 0) {
            for (const tool of workflowStep.tools_unlocked) {
                if (!tools.includes(tool) && allTools.includes(tool)) {
                    tools.push(tool);
                }
            }
        }

        // Remove blocked tools
        tools = tools.filter(t => !perms.blocked_tools.includes(t));

        return tools;
    }

    // ==================== TREE NODE PERMISSIONS ====================

    /**
     * Get effective permissions for a tree node, merging:
     * 1. Node's own permissions (from AgentTreeNode.permissions)
     * 2. Agent type's permission set
     * Result is the intersection (most restrictive wins).
     */
    getNodePermissions(node: AgentTreeNode, agentType?: string): AgentPermission[] {
        const nodePerms = node.permissions;

        if (!agentType) {
            // No agent type context — just return node permissions
            return nodePerms.length > 0 ? nodePerms : [...DEFAULT_PERMISSIONS];
        }

        const agentPerms = this.getPermissions(agentType).permissions;

        if (nodePerms.length === 0) {
            // Node has no explicit permissions — inherit from agent type
            return agentPerms;
        }

        // Intersection: permission must exist in both node AND agent type
        const intersection = nodePerms.filter(p => agentPerms.includes(p));

        // Always ensure minimum permissions
        for (const minPerm of MINIMUM_PERMISSIONS) {
            if (!intersection.includes(minPerm)) {
                intersection.push(minPerm);
            }
        }

        return intersection;
    }

    /**
     * Check if a tree node has a specific permission.
     */
    checkNodePermission(node: AgentTreeNode, permission: AgentPermission, agentType?: string): boolean {
        const effective = this.getNodePermissions(node, agentType);
        return effective.includes(permission);
    }

    /**
     * Enforce a tree node permission — throws if denied.
     */
    enforceNodePermission(node: AgentTreeNode, permission: AgentPermission, agentType?: string, resource?: string): void {
        if (!this.checkNodePermission(node, permission, agentType)) {
            throw new PermissionDeniedError(
                agentType ?? node.agent_type,
                permission,
                resource
            );
        }
    }

    // ==================== INHERITANCE ====================

    /**
     * Create permissions for a child agent based on parent's permissions.
     * Child inherits parent's permissions but with niche restrictions applied
     * for lower-level agents (L5+).
     */
    inheritPermissions(
        childAgentType: string,
        parentAgentType: string,
        level: number,
        instanceId?: string
    ): AgentPermissionSet {
        const parentPerms = this.getPermissions(parentAgentType);

        let childPermissions: AgentPermission[];
        if (level >= 5) {
            // L5-L9 niche agents get restricted permissions intersected with parent
            childPermissions = parentPerms.permissions.filter(
                p => NICHE_AGENT_PERMISSIONS.includes(p)
            );
        } else {
            // L0-L4 agents inherit full parent permissions
            childPermissions = [...parentPerms.permissions];
        }

        // Ensure minimum permissions
        for (const minPerm of MINIMUM_PERMISSIONS) {
            if (!childPermissions.includes(minPerm)) {
                childPermissions.push(minPerm);
            }
        }

        return this.database.createPermissionSet({
            agent_type: childAgentType,
            agent_instance_id: instanceId ?? null,
            permissions: childPermissions,
            allowed_tools: [...parentPerms.allowed_tools],
            blocked_tools: [...parentPerms.blocked_tools],
            can_spawn: level < 7, // L7+ workers generally don't spawn
            max_llm_calls: level >= 7 ? 25 : level >= 5 ? 50 : parentPerms.max_llm_calls,
            max_time_minutes: level >= 7 ? 15 : level >= 5 ? 30 : parentPerms.max_time_minutes,
        });
    }

    // ==================== LIMITS ====================

    /**
     * Get the LLM call limit for an agent.
     */
    getMaxLLMCalls(agentType: string, instanceId?: string): number {
        return this.getPermissions(agentType, instanceId).max_llm_calls;
    }

    /**
     * Get the time limit (in minutes) for an agent.
     */
    getMaxTimeMinutes(agentType: string, instanceId?: string): number {
        return this.getPermissions(agentType, instanceId).max_time_minutes;
    }

    /**
     * Check if an agent has exceeded its LLM call limit.
     */
    isOverLLMLimit(agentType: string, currentCalls: number, instanceId?: string): boolean {
        return currentCalls >= this.getMaxLLMCalls(agentType, instanceId);
    }

    /**
     * Check if an agent has exceeded its time limit.
     */
    isOverTimeLimit(agentType: string, startTime: Date, instanceId?: string): boolean {
        const maxMinutes = this.getMaxTimeMinutes(agentType, instanceId);
        const elapsedMinutes = (Date.now() - startTime.getTime()) / 60000;
        return elapsedMinutes >= maxMinutes;
    }

    // ==================== BULK OPERATIONS ====================

    /**
     * Set default permissions for all known agent types.
     * Useful for initialization — existing agents get full permissions.
     */
    seedDefaultPermissions(agentTypes: string[]): void {
        for (const agentType of agentTypes) {
            const existing = this.database.getPermissionSetByAgent(agentType);
            if (!existing) {
                this.database.createPermissionSet({
                    agent_type: agentType,
                    permissions: [...DEFAULT_PERMISSIONS],
                });
            }
        }
    }

    /**
     * Reset an agent's permissions back to defaults.
     */
    resetToDefaults(agentType: string, instanceId?: string): AgentPermissionSet {
        return this.setPermissions(agentType, [...DEFAULT_PERMISSIONS], instanceId);
    }
}
