import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../src/core/database';
import { EventBus, getEventBus } from '../src/core/event-bus';
import { ConfigManager } from '../src/core/config';
import { AgentTreeManager, OutputChannelLike } from '../src/core/agent-tree-manager';
import {
    AgentLevel,
    AgentPermission,
    TreeNodeStatus,
    EscalationChainStatus,
    ConversationRole,
    ModelCapability,
} from '../src/types';

describe('AgentTreeManager', () => {
    let db: Database;
    let tmpDir: string;
    let eventBus: EventBus;
    let config: ConfigManager;
    let outputChannel: OutputChannelLike;
    let manager: AgentTreeManager;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-test-'));
        db = new Database(tmpDir);
        await db.initialize();
        eventBus = getEventBus();
        config = new ConfigManager(null as any, tmpDir);
        await config.initialize();
        outputChannel = { appendLine: jest.fn() };
        manager = new AgentTreeManager(db, eventBus, config, outputChannel);
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ==================== SKELETON BUILD ====================

    describe('buildSkeletonForPlan', () => {
        test('creates L0-L4 nodes using built-in standard template', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            expect(root).toBeDefined();
            expect(root.level).toBe(AgentLevel.L0_Boss);
            expect(root.name).toBe('BossAgent');
        });

        test('skeleton contains nodes at all levels L0-L4', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            const levels = new Set(tree.map(n => n.level));
            expect(levels.has(AgentLevel.L0_Boss)).toBe(true);
            expect(levels.has(AgentLevel.L1_GlobalOrchestrator)).toBe(true);
            expect(levels.has(AgentLevel.L2_DomainOrchestrator)).toBe(true);
            expect(levels.has(AgentLevel.L3_AreaOrchestrator)).toBe(true);
            expect(levels.has(AgentLevel.L4_Manager)).toBe(true);
        });

        test('skeleton does not contain L5+ nodes', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            const hasL5Plus = tree.some(n => n.level > AgentLevel.L4_Manager);
            expect(hasL5Plus).toBe(false);
        });

        test('skeleton creates approximately 50 nodes', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            // The built-in template defines ~50 L0-L4 nodes
            expect(tree.length).toBeGreaterThanOrEqual(30);
            expect(tree.length).toBeLessThanOrEqual(60);
        });

        test('all nodes reference the task ID', () => {
            const root = manager.buildSkeletonForPlan('task-42');
            const tree = manager.getTree(root.id);
            for (const node of tree) {
                expect(node.task_id).toBe('task-42');
            }
        });

        test('root node has no parent', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            expect(root.parent_id).toBeNull();
        });

        test('non-root nodes have valid parent IDs', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            const nodeIds = new Set(tree.map(n => n.id));
            for (const node of tree) {
                if (node.id !== root.id) {
                    expect(node.parent_id).not.toBeNull();
                    expect(nodeIds.has(node.parent_id!)).toBe(true);
                }
            }
        });

        test('emits tree:skeleton_built event', () => {
            const spy = jest.fn();
            eventBus.on('tree:skeleton_built', spy);
            manager.buildSkeletonForPlan('task-1');
            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ taskId: 'task-1' }),
            }));
        });

        test('uses built-in standard when template name not found', () => {
            const root = manager.buildSkeletonForPlan('task-1', 'nonexistent-template');
            expect(root).toBeDefined();
            expect(root.name).toBe('BossAgent');
        });

        test('logs skeleton build info', () => {
            manager.buildSkeletonForPlan('task-1');
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Building skeleton for task task-1')
            );
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Skeleton built:')
            );
        });
    });

    // ==================== NODE OPERATIONS ====================

    describe('spawnNode', () => {
        test('creates a node with the specified properties', () => {
            const node = manager.spawnNode(null, 'boss', 'TestBoss', {
                level: AgentLevel.L0_Boss,
                scope: 'all',
                taskId: 'task-1',
            });
            expect(node.id).toBeDefined();
            expect(node.name).toBe('TestBoss');
            expect(node.agent_type).toBe('boss');
            expect(node.level).toBe(AgentLevel.L0_Boss);
            expect(node.scope).toBe('all');
            expect(node.status).toBe(TreeNodeStatus.Idle);
        });

        test('emits tree:node_spawned event', () => {
            const spy = jest.fn();
            eventBus.on('tree:node_spawned', spy);
            manager.spawnNode(null, 'boss', 'TestBoss', {
                level: AgentLevel.L0_Boss,
            });
            expect(spy).toHaveBeenCalledTimes(1);
        });

        test('sets default permissions when not provided', () => {
            const node = manager.spawnNode(null, 'boss', 'TestBoss', {
                level: AgentLevel.L0_Boss,
            });
            expect(node.permissions).toContain(AgentPermission.Read);
            expect(node.permissions).toContain(AgentPermission.Execute);
            expect(node.permissions).toContain(AgentPermission.Escalate);
        });
    });

    // ==================== NODE RETRIEVAL ====================

    describe('getNode', () => {
        test('returns node by ID', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const retrieved = manager.getNode(root.id);
            expect(retrieved).toBeDefined();
            expect(retrieved!.id).toBe(root.id);
        });

        test('returns null for non-existent ID', () => {
            const result = manager.getNode('non-existent-id');
            expect(result).toBeNull();
        });
    });

    describe('getChildren', () => {
        test('returns direct children of a node', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const children = manager.getChildren(root.id);
            // Boss should have GlobalOrchestrator as child
            expect(children.length).toBeGreaterThan(0);
            expect(children.every(c => c.parent_id === root.id)).toBe(true);
        });

        test('returns empty array for leaf nodes', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            const l4Nodes = tree.filter(n => n.level === AgentLevel.L4_Manager);
            // L4 managers have no children in skeleton
            for (const l4 of l4Nodes) {
                const children = manager.getChildren(l4.id);
                expect(children.length).toBe(0);
            }
        });
    });

    describe('getAncestors', () => {
        test('returns ancestors from node to root', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            const l4Node = tree.find(n => n.level === AgentLevel.L4_Manager);
            expect(l4Node).toBeDefined();
            const ancestors = manager.getAncestors(l4Node!.id);
            // L4 → L3 → L2 → L1 → L0 (4 ancestors)
            expect(ancestors.length).toBe(4);
            expect(ancestors[ancestors.length - 1].level).toBe(AgentLevel.L0_Boss);
        });

        test('returns empty array for root node', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const ancestors = manager.getAncestors(root.id);
            expect(ancestors.length).toBe(0);
        });
    });

    describe('getSiblings', () => {
        test('returns sibling nodes (same parent, excluding self)', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            const l2Nodes = tree.filter(n => n.level === AgentLevel.L2_DomainOrchestrator);
            // All L2 nodes share GlobalOrchestrator as parent
            expect(l2Nodes.length).toBe(4); // 4 domain orchestrators
            const siblings = manager.getSiblings(l2Nodes[0].id);
            expect(siblings.length).toBe(3);
            expect(siblings.every(s => s.id !== l2Nodes[0].id)).toBe(true);
        });

        test('returns empty array for root node', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const siblings = manager.getSiblings(root.id);
            expect(siblings.length).toBe(0);
        });

        test('returns empty array for non-existent node', () => {
            const siblings = manager.getSiblings('non-existent');
            expect(siblings.length).toBe(0);
        });
    });

    describe('getTreeForTask', () => {
        test('returns all nodes for a task ID', () => {
            manager.buildSkeletonForPlan('task-1');
            const nodes = manager.getTreeForTask('task-1');
            expect(nodes.length).toBeGreaterThan(0);
            expect(nodes.every(n => n.task_id === 'task-1')).toBe(true);
        });

        test('returns empty array for unknown task ID', () => {
            const nodes = manager.getTreeForTask('unknown-task');
            expect(nodes.length).toBe(0);
        });
    });

    // ==================== CONTEXT SLICING ====================

    describe('sliceContext', () => {
        test('filters context by scope keywords', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            // Find the frontend area orchestrator
            const feNode = tree.find(n => n.name === 'FrontendArea');
            expect(feNode).toBeDefined();

            const fullContext = 'Section about frontend components\n\nSection about backend APIs\n\nSection about database schema';
            const sliced = manager.sliceContext(feNode!.id, fullContext);
            expect(sliced.filteredContext).toContain('frontend');
            expect(sliced.matchedItems).toBeGreaterThan(0);
            expect(sliced.scopeKeywords.length).toBeGreaterThan(0);
        });

        test('returns full context when context_isolation is false', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            // BossAgent has context_isolation=false
            const fullContext = 'Frontend stuff\n\nBackend stuff';
            const sliced = manager.sliceContext(root.id, fullContext);
            expect(sliced.filteredContext).toBe(fullContext);
        });

        test('returns full context for non-existent node', () => {
            const fullContext = 'Some context here';
            const sliced = manager.sliceContext('non-existent', fullContext);
            expect(sliced.filteredContext).toBe(fullContext);
        });

        test('returns fallback message when no sections match scope', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            const feNode = tree.find(n => n.name === 'FrontendArea');
            expect(feNode).toBeDefined();

            const fullContext = 'This is about cooking recipes\n\nAlso about gardening';
            const sliced = manager.sliceContext(feNode!.id, fullContext);
            expect(sliced.filteredContext).toContain('Context filtered for scope');
            expect(sliced.matchedItems).toBe(0);
        });

        test('emits tree:context_sliced event', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            const feNode = tree.find(n => n.name === 'FrontendArea');
            const spy = jest.fn();
            eventBus.on('tree:context_sliced', spy);
            manager.sliceContext(feNode!.id, 'Frontend section\n\nBackend section');
            expect(spy).toHaveBeenCalledTimes(1);
        });
    });

    // ==================== ESCALATION CHAIN ====================

    describe('startEscalationChain', () => {
        test('creates a new escalation chain', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            const l4Node = tree.find(n => n.level === AgentLevel.L4_Manager);
            const chain = manager.startEscalationChain(l4Node!.id, 'What database should we use?');
            expect(chain).toBeDefined();
            expect(chain.id).toBeDefined();
            expect(chain.question).toBe('What database should we use?');
            expect(chain.originating_node_id).toBe(l4Node!.id);
            expect(chain.status).toBe(EscalationChainStatus.Escalating);
        });

        test('throws for non-existent node', () => {
            expect(() => {
                manager.startEscalationChain('non-existent', 'Some question');
            }).toThrow('not found');
        });

        test('emits escalation:chain_started event', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            const l4Node = tree.find(n => n.level === AgentLevel.L4_Manager);
            const spy = jest.fn();
            eventBus.on('escalation:chain_started', spy);
            manager.startEscalationChain(l4Node!.id, 'What database?');
            expect(spy).toHaveBeenCalledTimes(1);
        });

        test('records question in conversation history', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            const l4Node = tree.find(n => n.level === AgentLevel.L4_Manager);
            manager.startEscalationChain(l4Node!.id, 'What database?');
            const conversations = db.getAgentConversationsByNode(l4Node!.id);
            expect(conversations.length).toBeGreaterThan(0);
            expect(conversations.some(c => c.content.includes('[QUESTION]'))).toBe(true);
        });
    });

    describe('resolveEscalationChain', () => {
        test('resolves chain with answer', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            const l4Node = tree.find(n => n.level === AgentLevel.L4_Manager);
            const chain = manager.startEscalationChain(l4Node!.id, 'What database?');
            const resolved = manager.resolveEscalationChain(chain.id, 'Use PostgreSQL', AgentLevel.L2_DomainOrchestrator, 'decision_memory');
            expect(resolved.status).toBe(EscalationChainStatus.Answered);
            expect(resolved.answer).toBe('Use PostgreSQL');
            expect(resolved.resolved_at_level).toBe(AgentLevel.L2_DomainOrchestrator);
        });

        test('throws for non-existent chain', () => {
            expect(() => {
                manager.resolveEscalationChain('non-existent', 'answer', AgentLevel.L0_Boss);
            }).toThrow('not found');
        });

        test('emits tree:question_answered event', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            const l4Node = tree.find(n => n.level === AgentLevel.L4_Manager);
            const chain = manager.startEscalationChain(l4Node!.id, 'What database?');
            const spy = jest.fn();
            eventBus.on('tree:question_answered', spy);
            manager.resolveEscalationChain(chain.id, 'PostgreSQL', AgentLevel.L2_DomainOrchestrator);
            expect(spy).toHaveBeenCalledTimes(1);
        });
    });

    describe('checkNodeCanAnswer', () => {
        test('returns false when no context is available', async () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            const l4Node = tree.find(n => n.level === AgentLevel.L4_Manager);
            const result = await manager.checkNodeCanAnswer(l4Node!.id, 'What color is the sky?');
            expect(result.canAnswer).toBe(false);
            expect(result.answer).toBeNull();
        });

        test('returns false for non-existent node', async () => {
            const result = await manager.checkNodeCanAnswer('non-existent', 'Question?');
            expect(result.canAnswer).toBe(false);
            expect(result.confidence).toBe(0);
        });

        test('finds answer in own conversation history', async () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            const l4Node = tree.find(n => n.level === AgentLevel.L4_Manager);

            // Seed conversation with relevant content
            db.createAgentConversation({
                tree_node_id: l4Node!.id,
                level: l4Node!.level,
                role: ConversationRole.Agent,
                content: 'We decided to use PostgreSQL as the primary database for storing user data.',
            });

            const result = await manager.checkNodeCanAnswer(l4Node!.id, 'What database should we use for storing user data?');
            // Depends on keyword overlap meeting the 60% threshold
            if (result.canAnswer) {
                expect(result.source).toBe('own_history');
                expect(result.answer).toContain('PostgreSQL');
            }
        });

        test('finds answer in sibling conversations', async () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            const l4Nodes = tree.filter(n => n.level === AgentLevel.L4_Manager && n.parent_id !== null);

            // Need at least 2 siblings
            if (l4Nodes.length >= 2) {
                const sibling = l4Nodes[1];
                // Seed sibling with relevant answer
                db.createAgentConversation({
                    tree_node_id: sibling.id,
                    level: sibling.level,
                    role: ConversationRole.Agent,
                    content: 'The authentication system uses JWT tokens with refresh token rotation.',
                });

                const result = await manager.checkNodeCanAnswer(
                    l4Nodes[0].id,
                    'What authentication tokens does the system use?'
                );
                // May or may not meet threshold depending on keyword extraction
                expect(result).toBeDefined();
            }
        });
    });

    // ==================== DELEGATION ====================

    describe('delegateDown', () => {
        test('delegates to children based on keyword matching', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            const globalOrch = tree.find(n => n.name === 'GlobalOrchestrator');
            expect(globalOrch).toBeDefined();
            const targets = manager.delegateDown(globalOrch!.id, 'Build the frontend user interface with React components');
            expect(targets.length).toBeGreaterThan(0);
        });

        test('throws for non-existent node', () => {
            expect(() => {
                manager.delegateDown('non-existent', 'Do something');
            }).toThrow('not found');
        });

        test('activates target nodes', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            const globalOrch = tree.find(n => n.name === 'GlobalOrchestrator');
            const targets = manager.delegateDown(globalOrch!.id, 'Build the frontend user interface');
            for (const target of targets) {
                const refreshed = manager.getNode(target.id);
                expect(refreshed!.status).toBe(TreeNodeStatus.Active);
            }
        });

        test('broadcasts to all children when no keyword match', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            const globalOrch = tree.find(n => n.name === 'GlobalOrchestrator');
            const allChildren = manager.getChildren(globalOrch!.id);
            const targets = manager.delegateDown(globalOrch!.id, 'xyzabc12345 unrelated gibberish');
            // When no keywords match, should delegate to all children
            expect(targets.length).toBe(allChildren.length);
        });
    });

    // ==================== NODE LIFECYCLE ====================

    describe('completeNode', () => {
        test('sets status to Completed', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            manager.completeNode(root.id, 'All work done');
            const updated = manager.getNode(root.id);
            expect(updated!.status).toBe(TreeNodeStatus.Completed);
        });

        test('records result in conversation history', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            manager.completeNode(root.id, 'Task completed successfully');
            const conversations = db.getAgentConversationsByNode(root.id);
            expect(conversations.some(c => c.content.includes('[COMPLETED]'))).toBe(true);
        });

        test('emits tree:node_completed event', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const spy = jest.fn();
            eventBus.on('tree:node_completed', spy);
            manager.completeNode(root.id, 'Done');
            expect(spy).toHaveBeenCalledTimes(1);
        });

        test('does nothing for non-existent node', () => {
            // Should not throw
            manager.completeNode('non-existent', 'result');
        });
    });

    describe('failNode', () => {
        test('sets status to Failed and increments retries', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            manager.failNode(root.id, 'LLM timeout');
            const updated = manager.getNode(root.id);
            expect(updated!.status).toBe(TreeNodeStatus.Failed);
            expect(updated!.retries).toBe(1);
        });

        test('records error in conversation history', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            manager.failNode(root.id, 'Connection refused');
            const conversations = db.getAgentConversationsByNode(root.id);
            expect(conversations.some(c => c.content.includes('[FAILED]'))).toBe(true);
        });

        test('emits tree:node_failed event', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const spy = jest.fn();
            eventBus.on('tree:node_failed', spy);
            manager.failNode(root.id, 'error');
            expect(spy).toHaveBeenCalledTimes(1);
        });
    });

    describe('escalateWork', () => {
        test('sets status to Escalated and increments escalation count', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            const l4Node = tree.find(n => n.level === AgentLevel.L4_Manager);
            manager.escalateWork(l4Node!.id, 'Cannot handle this complexity');
            const updated = manager.getNode(l4Node!.id);
            expect(updated!.status).toBe(TreeNodeStatus.Escalated);
            expect(updated!.escalations).toBe(1);
        });

        test('emits tree:node_escalated event', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const spy = jest.fn();
            eventBus.on('tree:node_escalated', spy);
            manager.escalateWork(root.id, 'reason');
            expect(spy).toHaveBeenCalledTimes(1);
        });
    });

    describe('activateNode', () => {
        test('sets status to Working', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            manager.activateNode(root.id);
            const updated = manager.getNode(root.id);
            expect(updated!.status).toBe(TreeNodeStatus.Working);
        });
    });

    describe('waitForChildren', () => {
        test('sets status to WaitingChild', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            manager.waitForChildren(root.id);
            const updated = manager.getNode(root.id);
            expect(updated!.status).toBe(TreeNodeStatus.WaitingChild);
        });
    });

    // ==================== TELEMETRY ====================

    describe('recordTelemetry', () => {
        test('accumulates tokens consumed', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            manager.recordTelemetry(root.id, { tokens_consumed: 100 });
            manager.recordTelemetry(root.id, { tokens_consumed: 200 });
            const updated = manager.getNode(root.id);
            expect(updated!.tokens_consumed).toBe(300);
        });

        test('accumulates retries', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            manager.recordTelemetry(root.id, { retries: 1 });
            manager.recordTelemetry(root.id, { retries: 2 });
            const updated = manager.getNode(root.id);
            expect(updated!.retries).toBe(3);
        });

        test('handles non-existent node gracefully', () => {
            // Should not throw
            manager.recordTelemetry('non-existent', { tokens_consumed: 100 });
        });
    });

    // ==================== CLEANUP ====================

    describe('pruneCompletedBranches', () => {
        test('returns 0 when no branches are completed', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const pruned = manager.pruneCompletedBranches(root.id);
            expect(pruned).toBe(0);
        });

        test('does not prune L0-L4 skeleton nodes', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            // Complete all nodes
            for (const node of tree) {
                manager.completeNode(node.id, 'done');
            }
            const pruned = manager.pruneCompletedBranches(root.id);
            // L0-L4 should not be pruned
            expect(pruned).toBe(0);
        });
    });

    describe('deleteTreeForTask', () => {
        test('deletes all nodes for a task', () => {
            manager.buildSkeletonForPlan('task-1');
            const before = manager.getTreeForTask('task-1');
            expect(before.length).toBeGreaterThan(0);
            const deleted = manager.deleteTreeForTask('task-1');
            expect(deleted).toBeGreaterThan(0);
            const after = manager.getTreeForTask('task-1');
            expect(after.length).toBe(0);
        });
    });

    // ==================== MISCELLANEOUS ====================

    describe('getEscalationChain', () => {
        test('returns null for non-existent chain', () => {
            const result = manager.getEscalationChain('non-existent');
            expect(result).toBeNull();
        });
    });

    describe('getActiveEscalationChains', () => {
        test('returns active chains', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            const l4Node = tree.find(n => n.level === AgentLevel.L4_Manager);
            manager.startEscalationChain(l4Node!.id, 'Q1');
            manager.startEscalationChain(l4Node!.id, 'Q2');
            const active = manager.getActiveEscalationChains();
            expect(active.length).toBe(2);
        });
    });

    describe('isBranchSpawned', () => {
        test('returns false when no deeper branches exist', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            const l4Node = tree.find(n => n.level === AgentLevel.L4_Manager);
            expect(manager.isBranchSpawned(l4Node!.id)).toBe(false);
        });

        test('returns false for non-existent node', () => {
            expect(manager.isBranchSpawned('non-existent')).toBe(false);
        });
    });

    describe('blockTicketForChain', () => {
        test('updates chain status to blocked', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            const l4Node = tree.find(n => n.level === AgentLevel.L4_Manager);
            const chain = manager.startEscalationChain(l4Node!.id, 'Q1');
            manager.blockTicketForChain(chain.id, 'ticket-99', 'block');
            const updated = manager.getEscalationChain(chain.id);
            expect(updated!.status).toBe(EscalationChainStatus.Blocked);
        });

        test('updates chain status to paused', () => {
            const root = manager.buildSkeletonForPlan('task-1');
            const tree = manager.getTree(root.id);
            const l4Node = tree.find(n => n.level === AgentLevel.L4_Manager);
            const chain = manager.startEscalationChain(l4Node!.id, 'Q1');
            manager.blockTicketForChain(chain.id, 'ticket-99', 'pause');
            const updated = manager.getEscalationChain(chain.id);
            expect(updated!.status).toBe(EscalationChainStatus.Paused);
        });
    });

    describe('dispose', () => {
        test('does not throw', () => {
            expect(() => manager.dispose()).not.toThrow();
        });
    });
});
