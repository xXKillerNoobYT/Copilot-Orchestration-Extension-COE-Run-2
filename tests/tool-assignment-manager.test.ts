import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../src/core/database';
import { EventBus, getEventBus } from '../src/core/event-bus';
import { ToolAssignmentManager, OutputChannelLike, ToolEscalation } from '../src/core/tool-assignment-manager';
import { BuiltInTool, AgentLevel, TreeNodeStatus } from '../src/types';

describe('ToolAssignmentManager', () => {
    let db: Database;
    let tmpDir: string;
    let eventBus: EventBus;
    let outputChannel: OutputChannelLike;
    let manager: ToolAssignmentManager;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-test-tam-'));
        db = new Database(tmpDir);
        await db.initialize();
        eventBus = getEventBus();
        outputChannel = { appendLine: jest.fn() };
        manager = new ToolAssignmentManager(db, eventBus, outputChannel);
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    /** Create a tree node for testing — returns the generated ID */
    function createNode(parentId: string | null = null, name: string = 'TestNode'): string {
        const node = db.createTreeNode({
            task_id: 'test-task',
            parent_id: parentId,
            level: parentId ? AgentLevel.L2_DomainOrchestrator : AgentLevel.L0_Boss,
            name,
            agent_type: 'orchestrator',
            status: TreeNodeStatus.Active,
        });
        return node.id;
    }

    // ==================== GRANT ====================

    describe('grantTool', () => {
        test('grants a tool to a node and returns assignment', () => {
            const nodeId = createNode();
            const result = manager.grantTool(nodeId, BuiltInTool.FileRead);
            expect(result).not.toBeNull();
            expect(result!.node_id).toBe(nodeId);
            expect(result!.tool_name).toBe(BuiltInTool.FileRead);
            expect(result!.assigned_by).toBe('system');
        });

        test('returns null if tool already granted (idempotent)', () => {
            const nodeId = createNode();
            manager.grantTool(nodeId, BuiltInTool.FileRead);
            const duplicate = manager.grantTool(nodeId, BuiltInTool.FileRead);
            expect(duplicate).toBeNull();
        });

        test('grants tool with self assignment', () => {
            const nodeId = createNode();
            const result = manager.grantTool(nodeId, BuiltInTool.Terminal, 'self');
            expect(result).not.toBeNull();
            expect(result!.assigned_by).toBe('self');
        });

        test('grants tool with parent assignment', () => {
            const nodeId = createNode();
            const result = manager.grantTool(nodeId, BuiltInTool.Git, 'parent');
            expect(result).not.toBeNull();
            expect(result!.assigned_by).toBe('parent');
        });

        test('emits permission:granted event', () => {
            const nodeId = createNode();
            const emitSpy = jest.spyOn(eventBus, 'emit');
            manager.grantTool(nodeId, BuiltInTool.FileWrite);
            expect(emitSpy).toHaveBeenCalledWith(
                'permission:granted',
                'tool-assignment-manager',
                expect.objectContaining({
                    node_id: nodeId,
                    tool_name: BuiltInTool.FileWrite,
                    assigned_by: 'system',
                })
            );
        });

        test('logs grant to output channel', () => {
            const nodeId = createNode();
            manager.grantTool(nodeId, BuiltInTool.FileRead);
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Granted')
            );
        });

        test('grants multiple different tools to same node', () => {
            const nodeId = createNode();
            manager.grantTool(nodeId, BuiltInTool.FileRead);
            manager.grantTool(nodeId, BuiltInTool.FileWrite);
            manager.grantTool(nodeId, BuiltInTool.Terminal);
            const tools = manager.getDirectTools(nodeId);
            expect(tools.length).toBe(3);
        });

        test('grants custom (non-built-in) tool name', () => {
            const nodeId = createNode();
            const result = manager.grantTool(nodeId, 'custom_tool_x');
            expect(result).not.toBeNull();
            expect(result!.tool_name).toBe('custom_tool_x');
        });
    });

    // ==================== REVOKE ====================

    describe('revokeTool', () => {
        test('revokes an existing tool assignment', () => {
            const nodeId = createNode();
            manager.grantTool(nodeId, BuiltInTool.FileRead);
            const result = manager.revokeTool(nodeId, BuiltInTool.FileRead);
            expect(result).toBe(true);
        });

        test('returns false when revoking a tool that was never granted', () => {
            const nodeId = createNode();
            const result = manager.revokeTool(nodeId, BuiltInTool.Terminal);
            expect(result).toBe(false);
        });

        test('emits permission:revoked event', () => {
            const nodeId = createNode();
            manager.grantTool(nodeId, BuiltInTool.Git);
            const emitSpy = jest.spyOn(eventBus, 'emit');
            manager.revokeTool(nodeId, BuiltInTool.Git);
            expect(emitSpy).toHaveBeenCalledWith(
                'permission:revoked',
                'tool-assignment-manager',
                expect.objectContaining({
                    node_id: nodeId,
                    tool_name: BuiltInTool.Git,
                })
            );
        });

        test('revoked tool no longer accessible', () => {
            const nodeId = createNode();
            manager.grantTool(nodeId, BuiltInTool.FileRead);
            manager.revokeTool(nodeId, BuiltInTool.FileRead);
            const access = manager.checkToolAccess(nodeId, BuiltInTool.FileRead);
            expect(access.allowed).toBe(false);
        });

        test('logs revocation to output channel', () => {
            const nodeId = createNode();
            manager.grantTool(nodeId, BuiltInTool.FileRead);
            manager.revokeTool(nodeId, BuiltInTool.FileRead);
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Revoked')
            );
        });
    });

    // ==================== REVOKE ALL ====================

    describe('revokeAllTools', () => {
        test('removes all tools from a node', () => {
            const nodeId = createNode();
            manager.grantTool(nodeId, BuiltInTool.FileRead);
            manager.grantTool(nodeId, BuiltInTool.FileWrite);
            manager.grantTool(nodeId, BuiltInTool.Terminal);
            manager.revokeAllTools(nodeId);
            const tools = manager.getDirectTools(nodeId);
            expect(tools.length).toBe(0);
        });

        test('does not affect other nodes', () => {
            const node1 = createNode(null, 'Node1');
            const node2 = createNode(null, 'Node2');
            manager.grantTool(node1, BuiltInTool.FileRead);
            manager.grantTool(node2, BuiltInTool.FileRead);
            manager.revokeAllTools(node1);
            const tools2 = manager.getDirectTools(node2);
            expect(tools2.length).toBe(1);
        });
    });

    // ==================== DIRECT TOOLS ====================

    describe('getDirectTools', () => {
        test('returns empty array for node with no tools', () => {
            const nodeId = createNode();
            const tools = manager.getDirectTools(nodeId);
            expect(tools).toEqual([]);
        });

        test('returns all directly granted tools', () => {
            const nodeId = createNode();
            manager.grantTool(nodeId, BuiltInTool.FileRead);
            manager.grantTool(nodeId, BuiltInTool.Git);
            const tools = manager.getDirectTools(nodeId);
            expect(tools.length).toBe(2);
            const toolNames = tools.map(t => t.tool_name);
            expect(toolNames).toContain(BuiltInTool.FileRead);
            expect(toolNames).toContain(BuiltInTool.Git);
        });
    });

    // ==================== TOOL ACCESS CHECK ====================

    describe('checkToolAccess', () => {
        test('returns granted for directly assigned tool', () => {
            const nodeId = createNode();
            manager.grantTool(nodeId, BuiltInTool.FileRead);
            const result = manager.checkToolAccess(nodeId, BuiltInTool.FileRead);
            expect(result.allowed).toBe(true);
            expect(result.reason).toBe('granted');
            expect(result.node_id).toBe(nodeId);
            expect(result.tool).toBe(BuiltInTool.FileRead);
        });

        test('returns escalation_needed for tool not granted and not inherited', () => {
            const nodeId = createNode();
            const result = manager.checkToolAccess(nodeId, BuiltInTool.Terminal);
            expect(result.allowed).toBe(false);
            expect(result.reason).toBe('escalation_needed');
        });

        test('returns inherited for inheritable tool from parent', () => {
            const parentId = createNode(null, 'Parent');
            const childId = createNode(parentId, 'Child');
            manager.grantTool(parentId, BuiltInTool.FileRead);
            const result = manager.checkToolAccess(childId, BuiltInTool.FileRead);
            expect(result.allowed).toBe(true);
            expect(result.reason).toBe('inherited');
            expect(result.inherited_from).toBe(parentId);
        });

        test('does NOT inherit non-inheritable tools (e.g., FileWrite)', () => {
            const parentId = createNode(null, 'Parent');
            const childId = createNode(parentId, 'Child');
            manager.grantTool(parentId, BuiltInTool.FileWrite);
            const result = manager.checkToolAccess(childId, BuiltInTool.FileWrite);
            expect(result.allowed).toBe(false);
            expect(result.reason).toBe('escalation_needed');
        });

        test('does NOT inherit Terminal from parent', () => {
            const parentId = createNode(null, 'Parent');
            const childId = createNode(parentId, 'Child');
            manager.grantTool(parentId, BuiltInTool.Terminal);
            const result = manager.checkToolAccess(childId, BuiltInTool.Terminal);
            expect(result.allowed).toBe(false);
        });

        test('inherits CodeAnalyze from parent', () => {
            const parentId = createNode(null, 'Parent');
            const childId = createNode(parentId, 'Child');
            manager.grantTool(parentId, BuiltInTool.CodeAnalyze);
            const result = manager.checkToolAccess(childId, BuiltInTool.CodeAnalyze);
            expect(result.allowed).toBe(true);
            expect(result.reason).toBe('inherited');
        });

        test('inherits Lint from parent', () => {
            const parentId = createNode(null, 'Parent');
            const childId = createNode(parentId, 'Child');
            manager.grantTool(parentId, BuiltInTool.Lint);
            const result = manager.checkToolAccess(childId, BuiltInTool.Lint);
            expect(result.allowed).toBe(true);
            expect(result.reason).toBe('inherited');
        });

        test('inherits through multi-level parent chain', () => {
            const grandparent = createNode(null, 'Grandparent');
            const parent = createNode(grandparent, 'Parent');
            const child = createNode(parent, 'Child');
            manager.grantTool(grandparent, BuiltInTool.FileRead);
            const result = manager.checkToolAccess(child, BuiltInTool.FileRead);
            expect(result.allowed).toBe(true);
            expect(result.reason).toBe('inherited');
            expect(result.inherited_from).toBe(grandparent);
        });

        test('prefers direct grant over inheritance', () => {
            const parentId = createNode(null, 'Parent');
            const childId = createNode(parentId, 'Child');
            manager.grantTool(parentId, BuiltInTool.FileRead);
            manager.grantTool(childId, BuiltInTool.FileRead);
            const result = manager.checkToolAccess(childId, BuiltInTool.FileRead);
            expect(result.allowed).toBe(true);
            expect(result.reason).toBe('granted'); // direct, not inherited
        });
    });

    // ==================== DEFAULT TOOLS FOR ROLE ====================

    describe('grantDefaultToolsForRole', () => {
        test('grants head_orchestrator defaults', () => {
            const nodeId = createNode();
            const granted = manager.grantDefaultToolsForRole(nodeId, 'head_orchestrator');
            expect(granted.length).toBe(4);
            const names = granted.map(g => g.tool_name);
            expect(names).toContain(BuiltInTool.FileRead);
            expect(names).toContain(BuiltInTool.CodeAnalyze);
            expect(names).toContain(BuiltInTool.Git);
            expect(names).toContain(BuiltInTool.Lint);
        });

        test('grants planning defaults', () => {
            const nodeId = createNode();
            const granted = manager.grantDefaultToolsForRole(nodeId, 'planning');
            expect(granted.length).toBe(2);
            const names = granted.map(g => g.tool_name);
            expect(names).toContain(BuiltInTool.FileRead);
            expect(names).toContain(BuiltInTool.CodeAnalyze);
        });

        test('grants verification defaults', () => {
            const nodeId = createNode();
            const granted = manager.grantDefaultToolsForRole(nodeId, 'verification');
            expect(granted.length).toBe(4);
            const names = granted.map(g => g.tool_name);
            expect(names).toContain(BuiltInTool.FileRead);
            expect(names).toContain(BuiltInTool.TestRun);
            expect(names).toContain(BuiltInTool.CodeAnalyze);
            expect(names).toContain(BuiltInTool.Lint);
        });

        test('grants review defaults', () => {
            const nodeId = createNode();
            const granted = manager.grantDefaultToolsForRole(nodeId, 'review');
            expect(granted.length).toBe(3);
            const names = granted.map(g => g.tool_name);
            expect(names).toContain(BuiltInTool.FileRead);
            expect(names).toContain(BuiltInTool.CodeAnalyze);
            expect(names).toContain(BuiltInTool.Lint);
        });

        test('grants observation defaults', () => {
            const nodeId = createNode();
            const granted = manager.grantDefaultToolsForRole(nodeId, 'observation');
            expect(granted.length).toBe(2);
        });

        test('grants structure_improvement defaults (includes Refactor)', () => {
            const nodeId = createNode();
            const granted = manager.grantDefaultToolsForRole(nodeId, 'structure_improvement');
            expect(granted.length).toBe(3);
            const names = granted.map(g => g.tool_name);
            expect(names).toContain(BuiltInTool.Refactor);
        });

        test('grants worker defaults (includes FileWrite, Format)', () => {
            const nodeId = createNode();
            const granted = manager.grantDefaultToolsForRole(nodeId, 'worker');
            expect(granted.length).toBe(5);
            const names = granted.map(g => g.tool_name);
            expect(names).toContain(BuiltInTool.FileRead);
            expect(names).toContain(BuiltInTool.FileWrite);
            expect(names).toContain(BuiltInTool.CodeAnalyze);
            expect(names).toContain(BuiltInTool.Lint);
            expect(names).toContain(BuiltInTool.Format);
        });

        test('grants empty set for open_slot', () => {
            const nodeId = createNode();
            const granted = manager.grantDefaultToolsForRole(nodeId, 'open_slot');
            expect(granted.length).toBe(0);
        });

        test('grants empty set for unknown role', () => {
            const nodeId = createNode();
            const granted = manager.grantDefaultToolsForRole(nodeId, 'nonexistent_role');
            expect(granted.length).toBe(0);
        });

        test('does not duplicate tools if already granted', () => {
            const nodeId = createNode();
            manager.grantTool(nodeId, BuiltInTool.FileRead);
            const granted = manager.grantDefaultToolsForRole(nodeId, 'planning');
            // FileRead already existed, only CodeAnalyze should be new
            expect(granted.length).toBe(1);
            expect(granted[0].tool_name).toBe(BuiltInTool.CodeAnalyze);
        });
    });

    // ==================== BULK GRANT ====================

    describe('grantBulkTools', () => {
        test('grants multiple tools at once', () => {
            const nodeId = createNode();
            const granted = manager.grantBulkTools(nodeId, [
                BuiltInTool.FileRead,
                BuiltInTool.FileWrite,
                BuiltInTool.Terminal,
            ]);
            expect(granted.length).toBe(3);
        });

        test('skips already granted tools in bulk', () => {
            const nodeId = createNode();
            manager.grantTool(nodeId, BuiltInTool.FileRead);
            const granted = manager.grantBulkTools(nodeId, [
                BuiltInTool.FileRead,
                BuiltInTool.FileWrite,
            ]);
            expect(granted.length).toBe(1);
            expect(granted[0].tool_name).toBe(BuiltInTool.FileWrite);
        });

        test('uses specified assignedBy', () => {
            const nodeId = createNode();
            const granted = manager.grantBulkTools(nodeId, [BuiltInTool.Git], 'parent');
            expect(granted[0].assigned_by).toBe('parent');
        });
    });

    // ==================== ESCALATION ====================

    describe('requestToolEscalation', () => {
        test('creates escalation request with parent node', () => {
            const parentId = createNode(null, 'Parent');
            const childId = createNode(parentId, 'Child');
            const escalation = manager.requestToolEscalation(
                childId, BuiltInTool.Terminal, 'Need terminal access for deployment'
            );
            expect(escalation.node_id).toBe(childId);
            expect(escalation.tool_name).toBe(BuiltInTool.Terminal);
            expect(escalation.reason).toBe('Need terminal access for deployment');
            expect(escalation.parent_node_id).toBe(parentId);
        });

        test('sets parent_node_id to null for root node', () => {
            const rootId = createNode();
            const escalation = manager.requestToolEscalation(
                rootId, BuiltInTool.Deploy, 'Need deploy access'
            );
            expect(escalation.parent_node_id).toBeNull();
        });

        test('emits permission:check_failed event', () => {
            const nodeId = createNode();
            const emitSpy = jest.spyOn(eventBus, 'emit');
            manager.requestToolEscalation(nodeId, BuiltInTool.Terminal, 'test reason');
            expect(emitSpy).toHaveBeenCalledWith(
                'permission:check_failed',
                'tool-assignment-manager',
                expect.objectContaining({
                    node_id: nodeId,
                    tool_name: BuiltInTool.Terminal,
                    escalation_type: 'tool_request',
                })
            );
        });

        test('handles missing node gracefully', () => {
            const escalation = manager.requestToolEscalation(
                'nonexistent-node', BuiltInTool.Terminal, 'test'
            );
            expect(escalation.parent_node_id).toBeNull();
        });
    });

    // ==================== APPROVE ESCALATION ====================

    describe('approveEscalation', () => {
        test('grants the requested tool', () => {
            const nodeId = createNode();
            const escalation: ToolEscalation = {
                node_id: nodeId,
                tool_name: BuiltInTool.Terminal,
                reason: 'Need terminal',
                parent_node_id: null,
            };
            const result = manager.approveEscalation(escalation);
            expect(result).not.toBeNull();
            expect(result!.tool_name).toBe(BuiltInTool.Terminal);
            expect(result!.assigned_by).toBe('parent');
        });

        test('returns null if already granted', () => {
            const nodeId = createNode();
            manager.grantTool(nodeId, BuiltInTool.Terminal);
            const escalation: ToolEscalation = {
                node_id: nodeId,
                tool_name: BuiltInTool.Terminal,
                reason: 'Duplicate',
                parent_node_id: null,
            };
            const result = manager.approveEscalation(escalation);
            expect(result).toBeNull();
        });
    });

    // ==================== UTILITY ====================

    describe('getBuiltInToolNames', () => {
        test('returns all 16 built-in tools', () => {
            const names = manager.getBuiltInToolNames();
            expect(names.length).toBe(16);
            expect(names).toContain(BuiltInTool.FileRead);
            expect(names).toContain(BuiltInTool.FileWrite);
            expect(names).toContain(BuiltInTool.Terminal);
            expect(names).toContain(BuiltInTool.Git);
            expect(names).toContain(BuiltInTool.TestRun);
            expect(names).toContain(BuiltInTool.WebSearch);
            expect(names).toContain(BuiltInTool.CodeAnalyze);
            expect(names).toContain(BuiltInTool.DbQuery);
            expect(names).toContain(BuiltInTool.LLMCall);
            expect(names).toContain(BuiltInTool.TicketManage);
            expect(names).toContain(BuiltInTool.TreeManage);
            expect(names).toContain(BuiltInTool.ReportSubmit);
            expect(names).toContain(BuiltInTool.Lint);
            expect(names).toContain(BuiltInTool.Format);
            expect(names).toContain(BuiltInTool.Refactor);
            expect(names).toContain(BuiltInTool.Deploy);
        });
    });

    // ==================== EFFECTIVE TOOLS ====================

    describe('getEffectiveTools', () => {
        test('returns only direct tools when no parent', () => {
            const nodeId = createNode();
            manager.grantTool(nodeId, BuiltInTool.FileRead);
            manager.grantTool(nodeId, BuiltInTool.Terminal);
            const effective = manager.getEffectiveTools(nodeId);
            expect(effective).toContain(BuiltInTool.FileRead);
            expect(effective).toContain(BuiltInTool.Terminal);
            expect(effective.length).toBe(2);
        });

        test('includes inherited FileRead, CodeAnalyze, Lint from parent', () => {
            const parentId = createNode(null, 'Parent');
            const childId = createNode(parentId, 'Child');
            manager.grantTool(parentId, BuiltInTool.FileRead);
            manager.grantTool(parentId, BuiltInTool.CodeAnalyze);
            manager.grantTool(parentId, BuiltInTool.Lint);
            manager.grantTool(childId, BuiltInTool.Terminal);
            const effective = manager.getEffectiveTools(childId);
            expect(effective).toContain(BuiltInTool.Terminal);
            expect(effective).toContain(BuiltInTool.FileRead);
            expect(effective).toContain(BuiltInTool.CodeAnalyze);
            expect(effective).toContain(BuiltInTool.Lint);
            expect(effective.length).toBe(4);
        });

        test('does not duplicate tools that are both direct and inherited', () => {
            const parentId = createNode(null, 'Parent');
            const childId = createNode(parentId, 'Child');
            manager.grantTool(parentId, BuiltInTool.FileRead);
            manager.grantTool(childId, BuiltInTool.FileRead);
            const effective = manager.getEffectiveTools(childId);
            const fileReadCount = effective.filter(t => t === BuiltInTool.FileRead).length;
            expect(fileReadCount).toBe(1);
        });

        test('does NOT include non-inheritable tools from parent', () => {
            const parentId = createNode(null, 'Parent');
            const childId = createNode(parentId, 'Child');
            manager.grantTool(parentId, BuiltInTool.FileWrite);
            manager.grantTool(parentId, BuiltInTool.Terminal);
            manager.grantTool(parentId, BuiltInTool.Deploy);
            const effective = manager.getEffectiveTools(childId);
            expect(effective).not.toContain(BuiltInTool.FileWrite);
            expect(effective).not.toContain(BuiltInTool.Terminal);
            expect(effective).not.toContain(BuiltInTool.Deploy);
        });

        test('returns empty for node with no tools and no parent tools', () => {
            const nodeId = createNode();
            const effective = manager.getEffectiveTools(nodeId);
            expect(effective.length).toBe(0);
        });
    });

    // ==================== END-TO-END SCENARIOS ====================

    describe('end-to-end scenarios', () => {
        test('grant → check → revoke → check flow', () => {
            const nodeId = createNode();

            // Grant
            const assignment = manager.grantTool(nodeId, BuiltInTool.Terminal);
            expect(assignment).not.toBeNull();

            // Check — should be allowed
            let access = manager.checkToolAccess(nodeId, BuiltInTool.Terminal);
            expect(access.allowed).toBe(true);

            // Revoke
            const revoked = manager.revokeTool(nodeId, BuiltInTool.Terminal);
            expect(revoked).toBe(true);

            // Check — should be denied
            access = manager.checkToolAccess(nodeId, BuiltInTool.Terminal);
            expect(access.allowed).toBe(false);
        });

        test('escalation → approval → access flow', () => {
            const parentId = createNode(null, 'Parent');
            const childId = createNode(parentId, 'Child');

            // Child requests tool escalation
            const escalation = manager.requestToolEscalation(
                childId, BuiltInTool.FileWrite, 'Need to write code files'
            );
            expect(escalation.parent_node_id).toBe(parentId);

            // Check — not yet allowed
            let access = manager.checkToolAccess(childId, BuiltInTool.FileWrite);
            expect(access.allowed).toBe(false);

            // Parent approves
            const approved = manager.approveEscalation(escalation);
            expect(approved).not.toBeNull();

            // Check — now allowed
            access = manager.checkToolAccess(childId, BuiltInTool.FileWrite);
            expect(access.allowed).toBe(true);
            expect(access.reason).toBe('granted');
        });

        test('role-based defaults → inherited access', () => {
            const parentId = createNode(null, 'Parent');
            const childId = createNode(parentId, 'Child');

            // Grant parent head_orchestrator defaults
            manager.grantDefaultToolsForRole(parentId, 'head_orchestrator');

            // Child should inherit FileRead, CodeAnalyze, Lint (but not Git)
            const childAccess_read = manager.checkToolAccess(childId, BuiltInTool.FileRead);
            const childAccess_analyze = manager.checkToolAccess(childId, BuiltInTool.CodeAnalyze);
            const childAccess_lint = manager.checkToolAccess(childId, BuiltInTool.Lint);
            const childAccess_git = manager.checkToolAccess(childId, BuiltInTool.Git);

            expect(childAccess_read.allowed).toBe(true);
            expect(childAccess_read.reason).toBe('inherited');
            expect(childAccess_analyze.allowed).toBe(true);
            expect(childAccess_lint.allowed).toBe(true);
            expect(childAccess_git.allowed).toBe(false);
        });
    });
});
