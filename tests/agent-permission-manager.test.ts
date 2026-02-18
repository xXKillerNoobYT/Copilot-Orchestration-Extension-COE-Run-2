import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../src/core/database';
import { AgentPermissionManager, PermissionDeniedError } from '../src/core/agent-permission-manager';
import { AgentPermission, AgentLevel, TreeNodeStatus, ModelCapability } from '../src/types';

describe('AgentPermissionManager', () => {
    let db: Database;
    let tmpDir: string;
    let permManager: AgentPermissionManager;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-test-'));
        db = new Database(tmpDir);
        await db.initialize();
        permManager = new AgentPermissionManager(db);
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ==================== setPermissions ====================

    describe('setPermissions', () => {
        test('creates new permission set', () => {
            const result = permManager.setPermissions('planning', [AgentPermission.Read, AgentPermission.Write]);
            expect(result).toBeDefined();
            expect(result.id).toBeDefined();
            expect(result.id).not.toBe('');
            expect(result.agent_type).toBe('planning');
            expect(result.permissions).toContain(AgentPermission.Read);
            expect(result.permissions).toContain(AgentPermission.Write);
        });

        test('updates existing permission set', () => {
            permManager.setPermissions('planning', [AgentPermission.Read]);
            const updated = permManager.setPermissions('planning', [AgentPermission.Read, AgentPermission.Execute]);
            expect(updated.permissions).toContain(AgentPermission.Execute);
            expect(updated.permissions.length).toBe(2);
        });
    });

    // ==================== getPermissions ====================

    describe('getPermissions', () => {
        test('returns persisted set', () => {
            permManager.setPermissions('boss', [AgentPermission.Read, AgentPermission.Approve]);
            const result = permManager.getPermissions('boss');
            expect(result.agent_type).toBe('boss');
            expect(result.permissions).toContain(AgentPermission.Read);
            expect(result.permissions).toContain(AgentPermission.Approve);
        });

        test('returns default set when none exists (all permissions, can_spawn=true, max_llm_calls=100, max_time_minutes=60)', () => {
            const result = permManager.getPermissions('unknown-agent');
            expect(result.id).toBe('');
            expect(result.permissions).toContain(AgentPermission.Read);
            expect(result.permissions).toContain(AgentPermission.Write);
            expect(result.permissions).toContain(AgentPermission.Execute);
            expect(result.permissions).toContain(AgentPermission.Escalate);
            expect(result.permissions).toContain(AgentPermission.Spawn);
            expect(result.permissions).toContain(AgentPermission.Configure);
            expect(result.permissions).toContain(AgentPermission.Approve);
            expect(result.permissions).toContain(AgentPermission.Delete);
            expect(result.can_spawn).toBe(true);
            expect(result.max_llm_calls).toBe(100);
            expect(result.max_time_minutes).toBe(60);
        });

        test('instance-specific lookup', () => {
            permManager.setPermissions('planning', [AgentPermission.Read], 'instance-1');
            permManager.setPermissions('planning', [AgentPermission.Read, AgentPermission.Write], 'instance-2');

            const perms1 = permManager.getPermissions('planning', 'instance-1');
            const perms2 = permManager.getPermissions('planning', 'instance-2');
            expect(perms1.permissions.length).toBe(1);
            expect(perms2.permissions.length).toBe(2);
        });
    });

    // ==================== grantPermission ====================

    describe('grantPermission', () => {
        test('adds a permission', () => {
            permManager.setPermissions('worker', [AgentPermission.Read]);
            const result = permManager.grantPermission('worker', AgentPermission.Write);
            expect(result.permissions).toContain(AgentPermission.Read);
            expect(result.permissions).toContain(AgentPermission.Write);
        });

        test('does not duplicate existing permission', () => {
            permManager.setPermissions('worker', [AgentPermission.Read]);
            const result = permManager.grantPermission('worker', AgentPermission.Read);
            const readCount = result.permissions.filter(p => p === AgentPermission.Read).length;
            expect(readCount).toBe(1);
        });
    });

    // ==================== revokePermission ====================

    describe('revokePermission', () => {
        test('removes a permission', () => {
            permManager.setPermissions('worker', [
                AgentPermission.Read, AgentPermission.Write, AgentPermission.Execute, AgentPermission.Escalate,
            ]);
            const result = permManager.revokePermission('worker', AgentPermission.Write);
            expect(result.permissions).not.toContain(AgentPermission.Write);
        });

        test('cannot revoke Read (minimum permission)', () => {
            permManager.setPermissions('worker', [AgentPermission.Read, AgentPermission.Escalate]);
            const result = permManager.revokePermission('worker', AgentPermission.Read);
            expect(result.permissions).toContain(AgentPermission.Read);
        });

        test('cannot revoke Escalate (minimum permission)', () => {
            permManager.setPermissions('worker', [AgentPermission.Read, AgentPermission.Escalate]);
            const result = permManager.revokePermission('worker', AgentPermission.Escalate);
            expect(result.permissions).toContain(AgentPermission.Escalate);
        });
    });

    // ==================== checkPermission ====================

    describe('checkPermission', () => {
        test('returns true for existing permission', () => {
            permManager.setPermissions('boss', [AgentPermission.Read, AgentPermission.Approve]);
            expect(permManager.checkPermission('boss', AgentPermission.Read)).toBe(true);
            expect(permManager.checkPermission('boss', AgentPermission.Approve)).toBe(true);
        });

        test('returns false for missing permission', () => {
            permManager.setPermissions('worker', [AgentPermission.Read]);
            expect(permManager.checkPermission('worker', AgentPermission.Delete)).toBe(false);
        });
    });

    // ==================== enforcePermission ====================

    describe('enforcePermission', () => {
        test('throws PermissionDeniedError when denied', () => {
            permManager.setPermissions('worker', [AgentPermission.Read]);
            expect(() => {
                permManager.enforcePermission('worker', AgentPermission.Delete, 'file.ts');
            }).toThrow(PermissionDeniedError);
        });

        test('does not throw when permitted', () => {
            permManager.setPermissions('boss', [AgentPermission.Read, AgentPermission.Approve]);
            expect(() => {
                permManager.enforcePermission('boss', AgentPermission.Approve);
            }).not.toThrow();
        });

        test('error includes resource info', () => {
            permManager.setPermissions('worker', [AgentPermission.Read]);
            try {
                permManager.enforcePermission('worker', AgentPermission.Delete, 'config.json');
                fail('Should have thrown');
            } catch (e) {
                expect(e).toBeInstanceOf(PermissionDeniedError);
                const err = e as PermissionDeniedError;
                expect(err.agentType).toBe('worker');
                expect(err.permission).toBe(AgentPermission.Delete);
                expect(err.resource).toBe('config.json');
                expect(err.message).toContain('config.json');
            }
        });
    });

    // ==================== canSpawn ====================

    describe('canSpawn', () => {
        test('returns true when has Spawn permission and can_spawn=true', () => {
            // Default permissions include Spawn and can_spawn=true
            expect(permManager.canSpawn('boss')).toBe(true);
        });

        test('returns false when can_spawn is false', () => {
            permManager.setPermissions('worker', [
                AgentPermission.Read, AgentPermission.Escalate, AgentPermission.Spawn,
            ]);
            permManager.updatePermissionConfig('worker', { can_spawn: false });
            expect(permManager.canSpawn('worker')).toBe(false);
        });

        test('returns false when Spawn permission is missing', () => {
            permManager.setPermissions('worker', [AgentPermission.Read, AgentPermission.Escalate]);
            expect(permManager.canSpawn('worker')).toBe(false);
        });
    });

    // ==================== canUseTool ====================

    describe('canUseTool', () => {
        test('returns true when no restrictions', () => {
            expect(permManager.canUseTool('boss', 'getNextTask')).toBe(true);
        });

        test('returns false when tool is blocked', () => {
            permManager.updatePermissionConfig('worker', { blocked_tools: ['deleteThing'] });
            expect(permManager.canUseTool('worker', 'deleteThing')).toBe(false);
        });

        test('respects allowed_tools whitelist', () => {
            permManager.updatePermissionConfig('worker', { allowed_tools: ['getNextTask'] });
            expect(permManager.canUseTool('worker', 'getNextTask')).toBe(true);
            expect(permManager.canUseTool('worker', 'deleteThing')).toBe(false);
        });
    });

    // ==================== getEffectiveTools ====================

    describe('getEffectiveTools', () => {
        test('filters by allowed/blocked + workflow step unlocks', () => {
            permManager.updatePermissionConfig('worker', {
                allowed_tools: ['getNextTask'],
                blocked_tools: ['dangerousTool'],
            });
            const workflowStep = {
                id: 'step-1',
                workflow_id: 'wf-1',
                step_type: 'tool_unlock' as any,
                label: 'Unlock',
                agent_type: null,
                agent_prompt: null,
                condition_expression: null,
                tools_unlocked: ['reportTaskDone'],
                acceptance_criteria: null,
                max_retries: 0,
                retry_delay_ms: 0,
                escalation_step_id: null,
                next_step_id: null,
                true_branch_step_id: null,
                false_branch_step_id: null,
                parallel_step_ids: [],
                model_preference: null,
                x: 0,
                y: 0,
                sort_order: 0,
                created_at: '',
                updated_at: '',
            };
            const tools = permManager.getEffectiveTools(
                'worker',
                ['getNextTask', 'reportTaskDone', 'dangerousTool', 'askQuestion'],
                workflowStep
            );
            expect(tools).toContain('getNextTask');
            expect(tools).toContain('reportTaskDone'); // unlocked by workflow step
            expect(tools).not.toContain('dangerousTool'); // blocked
            expect(tools).not.toContain('askQuestion'); // not in allowed_tools
        });

        test('returns all tools when no restrictions set', () => {
            const tools = permManager.getEffectiveTools('boss', ['getNextTask', 'reportTaskDone', 'askQuestion']);
            expect(tools).toEqual(['getNextTask', 'reportTaskDone', 'askQuestion']);
        });
    });

    // ==================== getNodePermissions ====================

    describe('getNodePermissions', () => {
        test('intersection of node and agent permissions', () => {
            permManager.setPermissions('worker', [AgentPermission.Read, AgentPermission.Write, AgentPermission.Escalate]);
            const node = db.createTreeNode({
                name: 'TestNode',
                agent_type: 'worker',
                level: AgentLevel.L8_Worker,
                permissions: [AgentPermission.Read, AgentPermission.Execute, AgentPermission.Escalate],
                status: TreeNodeStatus.Idle,
                scope: '',
            });
            const perms = permManager.getNodePermissions(node, 'worker');
            // Intersection: Read, Escalate (both have them) + minimum guaranteed
            expect(perms).toContain(AgentPermission.Read);
            expect(perms).toContain(AgentPermission.Escalate);
            // Write is only on agent, Execute is only on node
            expect(perms).not.toContain(AgentPermission.Write);
            expect(perms).not.toContain(AgentPermission.Execute);
        });

        test('returns default permissions when node has no explicit permissions', () => {
            const node = db.createTreeNode({
                name: 'TestNode',
                agent_type: 'worker',
                level: AgentLevel.L8_Worker,
                permissions: [],
                status: TreeNodeStatus.Idle,
                scope: '',
            });
            const perms = permManager.getNodePermissions(node);
            expect(perms.length).toBeGreaterThan(0);
            expect(perms).toContain(AgentPermission.Read);
        });
    });

    // ==================== checkNodePermission ====================

    describe('checkNodePermission', () => {
        test('checks using effective permissions', () => {
            permManager.setPermissions('worker', [AgentPermission.Read, AgentPermission.Escalate]);
            const node = db.createTreeNode({
                name: 'TestNode',
                agent_type: 'worker',
                level: AgentLevel.L8_Worker,
                permissions: [AgentPermission.Read, AgentPermission.Execute, AgentPermission.Escalate],
                status: TreeNodeStatus.Idle,
                scope: '',
            });
            // Read is in both sets
            expect(permManager.checkNodePermission(node, AgentPermission.Read, 'worker')).toBe(true);
            // Execute is only on node, not on agent type
            expect(permManager.checkNodePermission(node, AgentPermission.Execute, 'worker')).toBe(false);
        });
    });

    // ==================== inheritPermissions ====================

    describe('inheritPermissions', () => {
        test('L0-L4 inherit full parent permissions', () => {
            permManager.setPermissions('parent', [
                AgentPermission.Read, AgentPermission.Write,
                AgentPermission.Execute, AgentPermission.Escalate,
                AgentPermission.Spawn, AgentPermission.Configure,
            ]);
            const child = permManager.inheritPermissions('child-agent', 'parent', 3);
            expect(child.permissions).toContain(AgentPermission.Read);
            expect(child.permissions).toContain(AgentPermission.Spawn);
            expect(child.permissions).toContain(AgentPermission.Configure);
        });

        test('L5+ get restricted NICHE permissions', () => {
            permManager.setPermissions('parent', [
                AgentPermission.Read, AgentPermission.Write,
                AgentPermission.Execute, AgentPermission.Escalate,
                AgentPermission.Spawn, AgentPermission.Configure,
            ]);
            const child = permManager.inheritPermissions('child-agent', 'parent', 6);
            // L6 niche agents only get Read, Write, Execute, Escalate
            expect(child.permissions).toContain(AgentPermission.Read);
            expect(child.permissions).toContain(AgentPermission.Write);
            expect(child.permissions).toContain(AgentPermission.Execute);
            expect(child.permissions).toContain(AgentPermission.Escalate);
            expect(child.permissions).not.toContain(AgentPermission.Spawn);
            expect(child.permissions).not.toContain(AgentPermission.Configure);
        });

        test('L7+ agents cannot spawn', () => {
            const child = permManager.inheritPermissions('child-agent', 'boss', 7);
            expect(child.can_spawn).toBe(false);
        });

        test('L7+ agents have reduced LLM call and time limits', () => {
            const child = permManager.inheritPermissions('child-agent', 'boss', 8);
            expect(child.max_llm_calls).toBe(25);
            expect(child.max_time_minutes).toBe(15);
        });

        test('L5-L6 agents have intermediate limits', () => {
            const child = permManager.inheritPermissions('child-agent', 'boss', 5);
            expect(child.max_llm_calls).toBe(50);
            expect(child.max_time_minutes).toBe(30);
        });
    });

    // ==================== seedDefaultPermissions ====================

    describe('seedDefaultPermissions', () => {
        test('creates defaults for given agent types', () => {
            permManager.seedDefaultPermissions(['boss', 'planning', 'verification']);
            const bossPerms = permManager.getPermissions('boss');
            expect(bossPerms.id).not.toBe('');
        });

        test('skips existing permission sets', () => {
            permManager.setPermissions('boss', [AgentPermission.Read]);
            permManager.seedDefaultPermissions(['boss']);
            const perms = permManager.getPermissions('boss');
            expect(perms.permissions.length).toBe(1);
            expect(perms.permissions).toContain(AgentPermission.Read);
        });
    });

    // ==================== resetToDefaults ====================

    describe('resetToDefaults', () => {
        test('resets permissions to full defaults', () => {
            permManager.setPermissions('worker', [AgentPermission.Read]);
            const reset = permManager.resetToDefaults('worker');
            expect(reset.permissions).toContain(AgentPermission.Delete);
            expect(reset.permissions).toContain(AgentPermission.Approve);
            expect(reset.permissions).toContain(AgentPermission.Spawn);
        });
    });

    // ==================== limits ====================

    describe('limits', () => {
        test('getMaxLLMCalls returns default for unset agent', () => {
            expect(permManager.getMaxLLMCalls('unknown')).toBe(100);
        });

        test('getMaxTimeMinutes returns default for unset agent', () => {
            expect(permManager.getMaxTimeMinutes('unknown')).toBe(60);
        });

        test('isOverLLMLimit returns true when at or over limit', () => {
            expect(permManager.isOverLLMLimit('unknown', 100)).toBe(true);
            expect(permManager.isOverLLMLimit('unknown', 101)).toBe(true);
        });

        test('isOverLLMLimit returns false when under limit', () => {
            expect(permManager.isOverLLMLimit('unknown', 50)).toBe(false);
        });

        test('isOverTimeLimit returns true when over time', () => {
            const startTime = new Date(Date.now() - 61 * 60 * 1000); // 61 minutes ago
            expect(permManager.isOverTimeLimit('unknown', startTime)).toBe(true);
        });

        test('isOverTimeLimit returns false when under time', () => {
            const startTime = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago
            expect(permManager.isOverTimeLimit('unknown', startTime)).toBe(false);
        });
    });
});
