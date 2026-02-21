/**
 * AgentTreeManager — Full 10-Level Agent Hierarchy (v9.0)
 *
 * Manages the complete agent tree with lazy spawning:
 *   L0-L4 skeleton created on plan start (~50 nodes)
 *   L5-L9 branches spawn only when work reaches that domain/area
 *
 * Core responsibilities:
 *   - Build skeleton from templates
 *   - Lazy-spawn deeper branches on demand
 *   - Slice context per-node (scope-based keyword filtering)
 *   - Escalation chain: questions bubble UP, answers flow DOWN
 *   - At each level, check own context, Decision Memory, sibling conversations
 *   - Delegate work down the tree; auto-spawn branches when needed
 *   - Track telemetry (tokens, retries, escalations) per node
 *
 * Integration:
 *   Works WITH the existing ticket system — Boss AI still picks tickets,
 *   routes them INTO the tree. The tree processes through levels, questions
 *   that reach the user create tickets in the existing system.
 */

import { Database } from './database';
import { EventBus } from './event-bus';
import { ConfigManager } from './config';
import {
    AgentTreeNode, AgentTreeTemplate, AgentLevel, AgentPermission,
    TreeNodeStatus, EscalationChain, EscalationChainStatus,
    AgentConversation, AgentContext, NicheAgentDefinition,
    ConversationRole, ModelCapability
} from '../types';
import { randomUUID } from 'crypto';

export interface OutputChannelLike {
    appendLine(msg: string): void;
}

/**
 * Result of a context slicing operation — filtered context for a specific tree node
 */
export interface SlicedContext {
    /** Filtered context items matching node's scope */
    filteredContext: string;
    /** Number of items that matched scope keywords */
    matchedItems: number;
    /** Total items before filtering */
    totalItems: number;
    /** Scope keywords used for filtering */
    scopeKeywords: string[];
}

/**
 * Result of checking whether a node can answer a question
 */
export interface CanAnswerResult {
    canAnswer: boolean;
    answer: string | null;
    source: 'own_history' | 'decision_memory' | 'scoped_context' | 'sibling_conversations' | null;
    confidence: number;
}

/**
 * Telemetry data for a tree node
 */
export interface NodeTelemetry {
    tokens_consumed: number;
    retries: number;
    escalations: number;
    duration_ms?: number;
}

/**
 * Template node definition used in tree templates (before instantiation)
 */
export interface TemplateNode {
    name: string;
    agent_type: string;
    level: AgentLevel;
    scope: string;
    parent_name: string | null;
    max_fanout: number;
    max_depth_below: number;
    escalation_threshold: number;
    context_isolation: boolean;
    history_isolation: boolean;
    permissions: AgentPermission[];
    niche_definition_id?: string;
    required_capability?: ModelCapability;
}

export class AgentTreeManager {
    constructor(
        private database: Database,
        private eventBus: EventBus,
        private config: ConfigManager,
        private outputChannel: OutputChannelLike
    ) {}

    // ==================== DEFAULT TREE AUTO-BUILD ====================

    /**
     * Ensure a default agent tree exists. If the tree is empty, builds the
     * full 10-level hierarchy using the standard template and spawns all
     * niche agent branches so the user can see the complete ~230+ agent
     * structure immediately.
     *
     * Uses sentinel task_id 'system-default' so it's distinguishable from
     * plan-specific trees.
     *
     * @returns true if a new tree was built, false if one already existed
     */
    ensureDefaultTree(): boolean {
        const existingNodes = this.database.getAllTreeNodes();
        if (existingNodes.length > 0) {
            this.outputChannel.appendLine('[AgentTree] Default tree already exists, skipping auto-build');
            return false;
        }

        this.outputChannel.appendLine('[AgentTree] No tree found — auto-building default hierarchy');

        // Build L0-L4 skeleton
        const rootNode = this.buildSkeletonForPlan('system-default', 'standard');

        // Now spawn L5-L9 branches for every L4 manager
        const l4Nodes = this.database.getTreeNodesByLevel(AgentLevel.L4_Manager, 'system-default');
        let totalNicheSpawned = 0;
        for (const manager of l4Nodes) {
            try {
                const spawned = this.spawnBranch(manager.id, AgentLevel.L9_Checker);
                totalNicheSpawned += spawned.length;
            } catch {
                // Some managers may not have matching niche agents — that's fine
            }
        }

        const totalNodes = this.database.getAllTreeNodes().length;
        this.outputChannel.appendLine(
            `[AgentTree] Default tree built: ${totalNodes} total nodes ` +
            `(skeleton ~50 + ${totalNicheSpawned} niche agents)`
        );

        this.eventBus.emit('tree:default_built', 'AgentTreeManager', {
            rootNodeId: rootNode.id,
            totalNodes,
            nicheAgentsSpawned: totalNicheSpawned,
        });

        return true;
    }

    // ==================== SKELETON BUILD ====================

    /**
     * Build the L0-L4 skeleton for a plan.
     * Uses the named template (or default). Spawns ~50 nodes upfront.
     * L5-L9 branches are NOT created — they spawn lazily via spawnBranch().
     *
     * @param taskId The plan/task ID this tree is processing
     * @param templateName Template name (default: config's defaultTreeTemplate)
     * @returns Root node of the tree (L0 Boss)
     */
    buildSkeletonForPlan(taskId: string, templateName?: string): AgentTreeNode {
        const tName = templateName ?? this.config.getConfig().defaultTreeTemplate ?? 'standard';
        this.outputChannel.appendLine(`[AgentTree] Building skeleton for task ${taskId} using template "${tName}"`);

        // Get template from DB (or use built-in standard)
        let templateNodes = this.getTemplateNodes(tName);
        if (templateNodes.length === 0) {
            this.outputChannel.appendLine(`[AgentTree] Template "${tName}" not found, using built-in standard`);
            templateNodes = this.getBuiltInStandardTemplate();
        }

        // Only spawn L0-L4 nodes
        const skeletonNodes = templateNodes.filter(n => n.level <= AgentLevel.L4_Manager);

        // Spawn nodes in level order (parents first)
        const nameToId: Record<string, string> = {};
        let rootNode: AgentTreeNode | null = null;

        for (let level = AgentLevel.L0_Boss; level <= AgentLevel.L4_Manager; level++) {
            const nodesAtLevel = skeletonNodes.filter(n => n.level === level);
            for (const templateNode of nodesAtLevel) {
                const parentId = templateNode.parent_name ? (nameToId[templateNode.parent_name] ?? null) : null;
                const node = this.spawnNode(parentId, templateNode.agent_type, templateNode.name, {
                    level: templateNode.level,
                    scope: templateNode.scope,
                    taskId,
                    maxFanout: templateNode.max_fanout,
                    maxDepthBelow: templateNode.max_depth_below,
                    escalationThreshold: templateNode.escalation_threshold,
                    contextIsolation: templateNode.context_isolation,
                    historyIsolation: templateNode.history_isolation,
                    permissions: templateNode.permissions,
                    nicheDefinitionId: templateNode.niche_definition_id,
                });
                nameToId[templateNode.name] = node.id;
                if (level === AgentLevel.L0_Boss) {
                    rootNode = node;
                }
            }
        }

        const totalSpawned = Object.keys(nameToId).length;
        this.outputChannel.appendLine(`[AgentTree] Skeleton built: ${totalSpawned} nodes (L0-L4)`);

        this.eventBus.emit('tree:skeleton_built', 'AgentTreeManager', {
            taskId,
            templateName: tName,
            nodeCount: totalSpawned,
            rootNodeId: rootNode?.id,
        });

        return rootNode!;
    }

    // ==================== NODE OPERATIONS ====================

    /**
     * Spawn a single node in the tree.
     */
    spawnNode(
        parentId: string | null,
        agentType: string,
        name: string,
        options: {
            level: AgentLevel;
            scope?: string;
            taskId?: string;
            workflowExecutionId?: string;
            maxFanout?: number;
            maxDepthBelow?: number;
            escalationThreshold?: number;
            contextIsolation?: boolean;
            historyIsolation?: boolean;
            permissions?: AgentPermission[];
            nicheDefinitionId?: string;
            inputContract?: string;
            outputContract?: string;
        }
    ): AgentTreeNode {
        const maxFanout = options.maxFanout ?? this.config.getConfig().defaultMaxFanout ?? 5;
        const maxDepthBelow = options.maxDepthBelow ?? (9 - options.level);
        const escalationThreshold = options.escalationThreshold ?? 3;

        const node = this.database.createTreeNode({
            instance_id: randomUUID(),
            agent_type: agentType,
            name,
            level: options.level,
            parent_id: parentId,
            task_id: options.taskId ?? null,
            workflow_execution_id: options.workflowExecutionId ?? null,
            scope: options.scope ?? '',
            permissions: options.permissions ?? [AgentPermission.Read, AgentPermission.Execute, AgentPermission.Escalate],
            model_preference: null,
            max_fanout: maxFanout,
            max_depth_below: maxDepthBelow,
            escalation_threshold: escalationThreshold,
            escalation_target_id: parentId,
            context_isolation: options.contextIsolation ?? true,
            history_isolation: options.historyIsolation ?? true,
            status: TreeNodeStatus.Idle,
            retries: 0,
            escalations: 0,
            tokens_consumed: 0,
            input_contract: options.inputContract ?? null,
            output_contract: options.outputContract ?? null,
            niche_definition_id: options.nicheDefinitionId ?? null,
        });

        this.eventBus.emit('tree:node_spawned', 'AgentTreeManager', {
            nodeId: node.id,
            name: node.name,
            level: node.level,
            parentId,
            agentType,
        });

        return node;
    }

    /**
     * Lazily spawn a branch from an existing L4 (or lower) node down to targetLevel.
     * Uses niche agent definitions to populate the deeper levels.
     *
     * @param parentNodeId The parent node to extend from
     * @param targetLevel How deep to spawn (default: L9)
     * @returns Array of newly spawned nodes
     */
    spawnBranch(parentNodeId: string, targetLevel: AgentLevel = AgentLevel.L9_Checker): AgentTreeNode[] {
        const parent = this.getNode(parentNodeId);
        if (!parent) {
            throw new Error(`Parent node ${parentNodeId} not found`);
        }

        if (parent.level >= targetLevel) {
            return []; // Already at or below target level
        }

        this.outputChannel.appendLine(
            `[AgentTree] Spawning branch: ${parent.name} (L${parent.level}) → L${targetLevel}`
        );

        const spawnedNodes: AgentTreeNode[] = [];
        const scopeKeywords = parent.scope.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

        // Find niche agent definitions that match this parent's scope
        for (let level = parent.level + 1; level <= targetLevel; level++) {
            const nicheAgents = this.database.getNicheAgentsByLevel(level as AgentLevel);
            const matchingAgents = nicheAgents.filter(def => {
                // Match by specialty keywords overlap with parent scope
                const specialtyParts = def.specialty.toLowerCase().split('.');
                return scopeKeywords.some(kw => specialtyParts.some(sp => sp.includes(kw) || kw.includes(sp)));
            });

            for (const def of matchingAgents) {
                // Check we haven't exceeded fanout for the parent at this level
                const existingChildren = spawnedNodes.filter(n => n.level === level);
                const currentParent = level === parent.level + 1
                    ? parent
                    : spawnedNodes.find(n => n.level === level - 1 && n.scope.includes(def.area));

                if (!currentParent) continue;

                const parentChildren = this.getChildren(currentParent.id);
                const existingCount = parentChildren.length + existingChildren.filter(n => n.parent_id === currentParent.id).length;
                if (existingCount >= currentParent.max_fanout) continue;

                const node = this.spawnNode(
                    currentParent.id,
                    def.name,
                    def.name,
                    {
                        level: def.level,
                        scope: `${parent.scope},${def.specialty}`,
                        taskId: parent.task_id ?? undefined,
                        maxFanout: level < AgentLevel.L8_Worker ? 5 : 0,
                        maxDepthBelow: 9 - level,
                        escalationThreshold: 3,
                        contextIsolation: true,
                        historyIsolation: true,
                        nicheDefinitionId: def.id,
                        inputContract: def.input_contract ?? undefined,
                        outputContract: def.output_contract ?? undefined,
                    }
                );
                spawnedNodes.push(node);
            }
        }

        this.outputChannel.appendLine(`[AgentTree] Branch spawned: ${spawnedNodes.length} new nodes`);
        this.eventBus.emit('tree:branch_spawned', 'AgentTreeManager', {
            parentNodeId,
            newNodeCount: spawnedNodes.length,
            targetLevel,
        });

        return spawnedNodes;
    }

    /**
     * Check if deeper levels (L5+) have been spawned below a node.
     */
    isBranchSpawned(nodeId: string): boolean {
        const node = this.getNode(nodeId);
        if (!node) return false;
        const children = this.getChildren(nodeId);
        return children.some(c => c.level > AgentLevel.L4_Manager);
    }

    // ==================== NODE RETRIEVAL ====================

    getNode(id: string): AgentTreeNode | null {
        return this.database.getTreeNode(id);
    }

    getChildren(nodeId: string): AgentTreeNode[] {
        return this.database.getTreeNodeChildren(nodeId);
    }

    getAncestors(nodeId: string): AgentTreeNode[] {
        return this.database.getTreeAncestors(nodeId);
    }

    getSiblings(nodeId: string): AgentTreeNode[] {
        const node = this.getNode(nodeId);
        if (!node || !node.parent_id) return [];
        return this.database.getTreeNodeChildren(node.parent_id).filter(n => n.id !== nodeId);
    }

    /**
     * Get the full tree from a root node using BFS.
     */
    getTree(rootId?: string): AgentTreeNode[] {
        if (rootId) {
            return this.database.getTreeByRoot(rootId);
        }
        // If no rootId, find root nodes (L0) and get all trees
        const roots = this.database.getTreeNodesByLevel(AgentLevel.L0_Boss);
        const allNodes: AgentTreeNode[] = [];
        for (const root of roots) {
            allNodes.push(...this.database.getTreeByRoot(root.id));
        }
        return allNodes;
    }

    /**
     * Get all nodes for a specific task.
     */
    getTreeForTask(taskId: string): AgentTreeNode[] {
        return this.database.getTreeNodesByTask(taskId);
    }

    // ==================== CONTEXT SLICING ====================

    /**
     * Slice a full context down to what's relevant for a specific node.
     * Uses the node's scope keywords to filter context items.
     *
     * @param nodeId The node to slice context for
     * @param fullContext The full context string (plan, task, code, etc.)
     * @returns Sliced context matching the node's scope
     */
    sliceContext(nodeId: string, fullContext: string): SlicedContext {
        const node = this.getNode(nodeId);
        if (!node) {
            return { filteredContext: fullContext, matchedItems: 0, totalItems: 0, scopeKeywords: [] };
        }

        // If context isolation is disabled, return everything
        if (!node.context_isolation) {
            return { filteredContext: fullContext, matchedItems: 0, totalItems: 0, scopeKeywords: [] };
        }

        const scopeKeywords = node.scope
            .split(',')
            .map(s => s.trim().toLowerCase())
            .filter(Boolean);

        if (scopeKeywords.length === 0) {
            return { filteredContext: fullContext, matchedItems: 0, totalItems: 0, scopeKeywords };
        }

        // Split context into sections (by double newline or headers)
        const sections = fullContext.split(/\n{2,}|\n(?=#+\s)/);
        const matchedSections: string[] = [];

        for (const section of sections) {
            const sectionLower = section.toLowerCase();
            const matches = scopeKeywords.some(kw => sectionLower.includes(kw));
            if (matches) {
                matchedSections.push(section);
            }
        }

        // Always include at least a summary if nothing matched
        const filteredContext = matchedSections.length > 0
            ? matchedSections.join('\n\n')
            : `[Context filtered for scope: ${scopeKeywords.join(', ')}. No exact matches — using parent context.]`;

        this.eventBus.emit('tree:context_sliced', 'AgentTreeManager', {
            nodeId,
            scopeKeywords,
            matched: matchedSections.length,
            total: sections.length,
        });

        return {
            filteredContext,
            matchedItems: matchedSections.length,
            totalItems: sections.length,
            scopeKeywords,
        };
    }

    // ==================== ESCALATION CHAIN ====================

    /**
     * Start a new escalation chain when a node has a question it can't answer.
     * The question will bubble UP through ancestors until answered or reaching the user.
     *
     * @param originNodeId The node asking the question
     * @param question The question text
     * @param context Additional context for the question
     * @returns The created escalation chain
     */
    startEscalationChain(originNodeId: string, question: string, context?: string): EscalationChain {
        const node = this.getNode(originNodeId);
        if (!node) {
            throw new Error(`Origin node ${originNodeId} not found`);
        }

        // Find the root of this tree
        const ancestors = this.getAncestors(originNodeId);
        const rootId = ancestors.length > 0 ? ancestors[ancestors.length - 1].id : originNodeId;

        const chain = this.database.createEscalationChain({
            tree_root_id: rootId,
            originating_node_id: originNodeId,
            current_node_id: originNodeId,
            question,
            context,
        });

        // Record the question in the originating node's conversation
        this.database.createAgentConversation({
            tree_node_id: originNodeId,
            level: node.level,
            role: ConversationRole.User,
            content: `[QUESTION] ${question}`,
            question_id: chain.id,
        });

        this.outputChannel.appendLine(
            `[AgentTree] Escalation chain started: "${question.substring(0, 80)}..." from ${node.name} (L${node.level})`
        );

        this.eventBus.emit('escalation:chain_started', 'AgentTreeManager', {
            chainId: chain.id,
            originNodeId,
            originNodeName: node.name,
            originLevel: node.level,
            question: question.substring(0, 200),
        });

        return chain;
    }

    /**
     * Escalate a question one level up.
     * Before escalating, checks if the current node (or its peers) can answer.
     *
     * At each level, the agent checks (in order):
     * 1. Own conversation history (has this been discussed at this level?)
     * 2. Decision Memory (has the user decided this before?)
     * 3. Scoped context (does the plan/design specify this?)
     * 4. Sibling conversations (did a peer agent at this level resolve something similar?)
     * 5. If none → pass up to parent
     *
     * @param chainId The escalation chain ID
     * @returns Updated chain (with answer if resolved, or new current_node if escalated)
     */
    async escalateQuestion(chainId: string): Promise<EscalationChain> {
        const chain = this.database.getEscalationChain(chainId);
        if (!chain) {
            throw new Error(`Escalation chain ${chainId} not found`);
        }

        if (chain.status !== EscalationChainStatus.Escalating) {
            return chain; // Already resolved/blocked
        }

        const currentNode = this.getNode(chain.current_node_id);
        if (!currentNode) {
            throw new Error(`Current node ${chain.current_node_id} not found in chain ${chainId}`);
        }

        // Try to answer at current level
        const canAnswer = await this.checkNodeCanAnswer(currentNode.id, chain.question, chain.context ?? undefined);

        if (canAnswer.canAnswer && canAnswer.answer) {
            // Resolved! Send answer back down
            return this.resolveEscalationChain(chainId, canAnswer.answer, currentNode.level, canAnswer.source ?? 'own_history');
        }

        // Not answered — escalate to parent
        const parentId = currentNode.escalation_target_id ?? currentNode.parent_id;
        if (!parentId) {
            // Reached the top (L0 Boss) — chain needs user intervention
            this.outputChannel.appendLine(
                `[AgentTree] Escalation chain ${chainId} reached L0 — needs user intervention`
            );

            // Update chain status — it's now at the top, waiting for user
            const levelsTraversed = this.parseLevelsTraversed(chain.levels_traversed);
            levelsTraversed.push(currentNode.id);
            this.database.updateEscalationChain(chainId, {
                status: EscalationChainStatus.Escalating,
                levels_traversed: JSON.stringify(levelsTraversed),
            });

            this.eventBus.emit('tree:question_escalated', 'AgentTreeManager', {
                chainId,
                question: chain.question,
                reachedTop: true,
                levelsTraversed: levelsTraversed.length,
            });

            return this.database.getEscalationChain(chainId)!;
        }

        // Record escalation in current node's conversation
        this.database.createAgentConversation({
            tree_node_id: currentNode.id,
            level: currentNode.level,
            role: ConversationRole.Agent,
            content: `[ESCALATING] Cannot answer: "${chain.question.substring(0, 100)}..." — passing to parent`,
            question_id: chainId,
        });

        // Update chain to point to parent
        const levelsTraversed = this.parseLevelsTraversed(chain.levels_traversed);
        levelsTraversed.push(currentNode.id);

        this.database.updateEscalationChain(chainId, {
            current_node_id: parentId,
            levels_traversed: JSON.stringify(levelsTraversed),
        });

        // Increment escalation count on current node
        this.database.updateTreeNode(currentNode.id, {
            escalations: currentNode.escalations + 1,
        });

        this.outputChannel.appendLine(
            `[AgentTree] Question escalated from ${currentNode.name} (L${currentNode.level}) to parent ${parentId}`
        );

        this.eventBus.emit('tree:question_escalated', 'AgentTreeManager', {
            chainId,
            fromNodeId: currentNode.id,
            fromNodeName: currentNode.name,
            fromLevel: currentNode.level,
            toNodeId: parentId,
        });

        return this.database.getEscalationChain(chainId)!;
    }

    /**
     * Check if a node can answer a question by examining:
     * 1. Own conversation history
     * 2. Decision Memory (existing decisions in database)
     * 3. Scoped context (plan/design context)
     * 4. Sibling conversations (peer agents' discussions — another agent may have the answer)
     *
     * This is a synchronous check — it does NOT call the LLM.
     * It looks for keyword matches and prior explicit answers.
     */
    async checkNodeCanAnswer(nodeId: string, question: string, context?: string): Promise<CanAnswerResult> {
        const node = this.getNode(nodeId);
        if (!node) {
            return { canAnswer: false, answer: null, source: null, confidence: 0 };
        }

        const questionLower = question.toLowerCase();
        const questionKeywords = this.extractKeywords(questionLower);

        // 1. Check own conversation history
        const ownConversations = this.database.getAgentConversationsByNode(nodeId);
        for (const conv of ownConversations) {
            if (conv.role === ConversationRole.Agent) {
                const contentLower = conv.content.toLowerCase();
                const keywordMatches = questionKeywords.filter(kw => contentLower.includes(kw));
                if (keywordMatches.length >= Math.ceil(questionKeywords.length * 0.6)) {
                    // Strong keyword overlap — this conversation likely has the answer
                    return {
                        canAnswer: true,
                        answer: conv.content,
                        source: 'own_history',
                        confidence: keywordMatches.length / questionKeywords.length,
                    };
                }
            }
        }

        // 2. Check Decision Memory (decisions table)
        // Search by each significant keyword as a topic
        try {
            const planId = node.task_id ?? '';
            const topKeywords = questionKeywords.slice(0, 5); // Limit topic searches
            for (const keyword of topKeywords) {
                const decisions = this.database.getDecisionsByTopic(planId, keyword);
                for (const decision of decisions) {
                    const decisionLower = `${decision.question ?? ''} ${decision.decision ?? ''}`.toLowerCase();
                    const keywordMatches = questionKeywords.filter(kw => decisionLower.includes(kw));
                    if (keywordMatches.length >= Math.ceil(questionKeywords.length * 0.5)) {
                        return {
                            canAnswer: true,
                            answer: `[Decision Memory] ${decision.decision}`,
                            source: 'decision_memory',
                            confidence: keywordMatches.length / questionKeywords.length,
                        };
                    }
                }
            }
        } catch {
            // Decision Memory table may not exist or query may fail — safe to skip
        }

        // 3. Scoped context check (plan/task description keywords)
        // This is a lightweight check — the agent itself will do deeper context analysis
        // We just check if scope keywords overlap with question keywords
        const scopeKeywords = node.scope.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        const scopeOverlap = questionKeywords.filter(kw => scopeKeywords.some(sk => sk.includes(kw) || kw.includes(sk)));
        if (scopeOverlap.length >= Math.ceil(questionKeywords.length * 0.7)) {
            // High scope overlap — this node is in the right domain, but we need LLM to confirm
            // Don't auto-answer from scope alone; mark as potential but not definitive
        }

        // 4. Check sibling conversations (peer agents at the same level)
        // KEY INSIGHT: Another agent working on a related ticket may have the information needed
        const siblings = this.getSiblings(node.id);
        for (const sibling of siblings) {
            const siblingConversations = this.database.getAgentConversationsByNode(sibling.id);
            for (const conv of siblingConversations) {
                if (conv.role === ConversationRole.Agent) {
                    const contentLower = conv.content.toLowerCase();
                    const keywordMatches = questionKeywords.filter(kw => contentLower.includes(kw));
                    if (keywordMatches.length >= Math.ceil(questionKeywords.length * 0.6)) {
                        return {
                            canAnswer: true,
                            answer: `[From sibling ${sibling.name}] ${conv.content}`,
                            source: 'sibling_conversations',
                            confidence: keywordMatches.length / questionKeywords.length,
                        };
                    }
                }
            }
        }

        return { canAnswer: false, answer: null, source: null, confidence: 0 };
    }

    /**
     * Resolve an escalation chain with an answer.
     * The answer flows back DOWN through all the levels it traversed.
     */
    resolveEscalationChain(
        chainId: string,
        answer: string,
        resolvedAtLevel: AgentLevel,
        source: string = 'unknown'
    ): EscalationChain {
        const chain = this.database.getEscalationChain(chainId);
        if (!chain) {
            throw new Error(`Escalation chain ${chainId} not found`);
        }

        // Update chain as answered
        this.database.updateEscalationChain(chainId, {
            status: EscalationChainStatus.Answered,
            answer,
            resolved_at_level: resolvedAtLevel,
            resolved_at: new Date().toISOString(),
        });

        // Record answer in the originating node's conversation
        const originNode = this.getNode(chain.originating_node_id);
        if (originNode) {
            this.database.createAgentConversation({
                tree_node_id: chain.originating_node_id,
                level: originNode.level,
                role: ConversationRole.Agent,
                content: `[ANSWER from L${resolvedAtLevel} via ${source}] ${answer}`,
                question_id: chainId,
            });
        }

        // Record in each level the chain traversed
        const levelsTraversed = this.parseLevelsTraversed(chain.levels_traversed);
        for (const traversedNodeId of levelsTraversed) {
            const traversedNode = this.getNode(traversedNodeId);
            if (traversedNode) {
                this.database.createAgentConversation({
                    tree_node_id: traversedNodeId,
                    level: traversedNode.level,
                    role: ConversationRole.Agent,
                    content: `[ANSWER RECEIVED] "${chain.question.substring(0, 80)}..." → ${answer.substring(0, 200)}`,
                    question_id: chainId,
                });
            }
        }

        this.outputChannel.appendLine(
            `[AgentTree] Escalation chain ${chainId} resolved at L${resolvedAtLevel} (${source}): "${answer.substring(0, 100)}..."`
        );

        this.eventBus.emit('tree:question_answered', 'AgentTreeManager', {
            chainId,
            resolvedAtLevel,
            source,
            originNodeId: chain.originating_node_id,
            levelsTraversed: levelsTraversed.length,
        });

        return this.database.getEscalationChain(chainId)!;
    }

    /**
     * Pass an answer back down from a specific node to the requesting agent.
     * Used when a parent resolves a question from its own knowledge.
     */
    passAnswerDown(nodeId: string, answer: string, chainId: string): void {
        const chain = this.database.getEscalationChain(chainId);
        if (!chain) {
            throw new Error(`Escalation chain ${chainId} not found`);
        }

        const node = this.getNode(nodeId);
        if (!node) return;

        this.resolveEscalationChain(chainId, answer, node.level, `direct_from_${node.name}`);
    }

    /**
     * Perform a quick local search before escalating a question to the user.
     *
     * Boss AI should ALWAYS call this before sending a question to the user.
     * Searches through: design elements, plan files, existing decisions, recent
     * agent conversations across the whole tree, and support documents.
     *
     * The idea: the answer is often already in the designs, plans, or another
     * agent's conversation. A quick search of local data is much cheaper than
     * interrupting the user.
     *
     * @param chainId The escalation chain to search for
     * @param taskId The task/plan context to search within
     * @returns Answer if found locally, null if user intervention needed
     */
    quickLocalSearch(chainId: string, taskId: string): { found: boolean; answer: string | null; source: string | null } {
        const chain = this.database.getEscalationChain(chainId);
        if (!chain) {
            return { found: false, answer: null, source: null };
        }

        const question = chain.question;
        const keywords = this.extractKeywords(question.toLowerCase());

        this.outputChannel.appendLine(
            `[AgentTree] Quick local search for: "${question.substring(0, 80)}..." (${keywords.length} keywords)`
        );

        // 1. Search Decision Memory (all topics matching question keywords)
        try {
            for (const kw of keywords.slice(0, 5)) {
                const decisions = this.database.getDecisionsByTopic(taskId, kw);
                for (const dec of decisions) {
                    const decText = `${dec.question ?? ''} ${dec.decision ?? ''}`.toLowerCase();
                    const matchCount = keywords.filter(k => decText.includes(k)).length;
                    if (matchCount >= Math.ceil(keywords.length * 0.4)) {
                        this.outputChannel.appendLine(`[AgentTree] Quick local search HIT: Decision Memory match`);
                        return {
                            found: true,
                            answer: `[Decision Memory] ${dec.decision}`,
                            source: 'decision_memory',
                        };
                    }
                }
            }
        } catch { /* ignore */ }

        // 2. Search design elements (FE pages, components, BE elements)
        try {
            const designPages = this.database.getDesignPagesByPlan(taskId);
            for (const page of designPages) {
                const reqText = (page.requirements ?? []).map(r => `${r.role} ${r.action} ${r.benefit}`).join(' ');
                const pageText = `${page.name} ${page.route} ${reqText}`.toLowerCase();
                const matchCount = keywords.filter(k => pageText.includes(k)).length;
                if (matchCount >= Math.ceil(keywords.length * 0.4)) {
                    this.outputChannel.appendLine(`[AgentTree] Quick local search HIT: Design page "${page.name}"`);
                    return {
                        found: true,
                        answer: `[Design page: ${page.name}] Route: ${page.route}. See design page for details.`,
                        source: 'design_elements',
                    };
                }
            }
        } catch { /* ignore */ }

        // 3. Search support documents (search by each keyword)
        try {
            for (const kw of keywords.slice(0, 3)) {
                const docs = this.database.searchSupportDocuments({ plan_id: taskId, keyword: kw });
                for (const doc of docs) {
                    const docText = `${doc.document_name ?? ''} ${doc.summary ?? ''} ${doc.content ?? ''}`.toLowerCase();
                    const matchCount = keywords.filter(k => docText.includes(k)).length;
                    if (matchCount >= Math.ceil(keywords.length * 0.3)) {
                        this.outputChannel.appendLine(`[AgentTree] Quick local search HIT: Document "${doc.document_name}"`);
                        return {
                            found: true,
                            answer: `[Document: ${doc.document_name}] ${(doc.summary ?? doc.content ?? 'See document for details').toString().substring(0, 300)}`,
                            source: 'support_documents',
                        };
                    }
                }
            }
        } catch { /* ignore */ }

        // 4. Search ALL agent conversations in this tree (not just siblings)
        // Another agent working on a related part of the ticket may have the answer
        try {
            const treeNodes = this.database.getTreeNodesByTask(taskId);
            for (const treeNode of treeNodes) {
                if (treeNode.id === chain.originating_node_id) continue; // Skip the asker
                const conversations = this.database.getAgentConversationsByNode(treeNode.id);
                for (const conv of conversations) {
                    if (conv.role !== ConversationRole.Agent) continue;
                    const contentLower = conv.content.toLowerCase();
                    const matchCount = keywords.filter(k => contentLower.includes(k)).length;
                    if (matchCount >= Math.ceil(keywords.length * 0.5)) {
                        this.outputChannel.appendLine(
                            `[AgentTree] Quick local search HIT: Conversation from ${treeNode.name} (L${treeNode.level})`
                        );
                        return {
                            found: true,
                            answer: `[From ${treeNode.name}] ${conv.content.substring(0, 500)}`,
                            source: `agent_conversation:${treeNode.name}`,
                        };
                    }
                }
            }
        } catch { /* ignore */ }

        // 5. Search plan configuration (plan name, config)
        try {
            const plans = this.database.getAllPlans();
            for (const plan of plans) {
                const planText = `${plan.name} ${plan.config_json ?? ''}`.toLowerCase();
                const matchCount = keywords.filter(k => planText.includes(k)).length;
                if (matchCount >= Math.ceil(keywords.length * 0.4)) {
                    this.outputChannel.appendLine(`[AgentTree] Quick local search HIT: Plan "${plan.name}"`);
                    return {
                        found: true,
                        answer: `[Plan: ${plan.name}] See plan configuration for details`,
                        source: 'plan_config',
                    };
                }
            }
        } catch { /* ignore */ }

        this.outputChannel.appendLine(`[AgentTree] Quick local search: no matches found`);
        return { found: false, answer: null, source: null };
    }

    /**
     * Block a ticket because the escalation chain requires user input.
     * Creates a dependency between the original ticket and a new investigation ticket.
     *
     * @param chainId The escalation chain that caused the block
     * @param newTicketId The new ticket created for investigation
     * @param severity 'pause' (simple follow-up) or 'block' (major investigation)
     */
    blockTicketForChain(chainId: string, newTicketId: string, severity: 'pause' | 'block'): void {
        this.database.updateEscalationChain(chainId, {
            status: severity === 'block' ? EscalationChainStatus.Blocked : EscalationChainStatus.Paused,
            ticket_id: newTicketId,
        });

        this.eventBus.emit('escalation:ticket_' + severity + 'd' as 'escalation:ticket_paused', 'AgentTreeManager', {
            chainId,
            newTicketId,
            severity,
        });
    }

    /**
     * Get the full state of an escalation chain for visualization.
     */
    getEscalationChain(chainId: string): EscalationChain | null {
        return this.database.getEscalationChain(chainId);
    }

    /**
     * Get all active (unresolved) escalation chains for a tree.
     */
    getActiveEscalationChains(treeRootId?: string): EscalationChain[] {
        return this.database.getActiveEscalationChains(treeRootId);
    }

    // ==================== DELEGATION ====================

    /**
     * Delegate a task down the tree from a parent node.
     * If the target branch hasn't been spawned yet, auto-spawns it.
     *
     * @param nodeId The parent node delegating work
     * @param taskDescription What needs to be done
     * @param targetLevel Optional: specific level to route to
     * @returns The child node(s) receiving the work
     */
    delegateDown(nodeId: string, taskDescription: string, targetLevel?: AgentLevel): AgentTreeNode[] {
        const node = this.getNode(nodeId);
        if (!node) {
            throw new Error(`Node ${nodeId} not found`);
        }

        // Get existing children
        let children = this.getChildren(nodeId);

        // If no children and we're above L9, try to spawn branch
        if (children.length === 0 && node.level < AgentLevel.L9_Checker) {
            const newNodes = this.spawnBranch(nodeId, targetLevel ?? AgentLevel.L9_Checker);
            // Get direct children only
            children = this.getChildren(nodeId);
        }

        if (children.length === 0) {
            this.outputChannel.appendLine(`[AgentTree] No children to delegate to from ${node.name}`);
            return [];
        }

        // Route to relevant children based on task description keywords
        const taskKeywords = this.extractKeywords(taskDescription.toLowerCase());
        const scoredChildren = children.map(child => {
            const childKeywords = child.scope.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
            const matchCount = taskKeywords.filter(tk => childKeywords.some(ck => ck.includes(tk) || tk.includes(ck))).length;
            return { child, score: matchCount };
        });

        // Sort by relevance score, take top matches
        scoredChildren.sort((a, b) => b.score - a.score);
        const relevantChildren = scoredChildren.filter(sc => sc.score > 0).map(sc => sc.child);

        // If no keyword matches, delegate to all children (broadcast)
        const targets = relevantChildren.length > 0 ? relevantChildren : children;

        // Activate target nodes
        for (const target of targets) {
            this.database.updateTreeNode(target.id, { status: TreeNodeStatus.Active });

            // Record delegation in parent's conversation
            this.database.createAgentConversation({
                tree_node_id: nodeId,
                level: node.level,
                role: ConversationRole.Agent,
                content: `[DELEGATING to ${target.name}] ${taskDescription.substring(0, 200)}`,
            });
        }

        return targets;
    }

    // ==================== NODE LIFECYCLE ====================

    /**
     * Mark a node as actively working.
     */
    activateNode(nodeId: string): void {
        const node = this.getNode(nodeId);
        this.database.updateTreeNode(nodeId, { status: TreeNodeStatus.Working });

        if (node) {
            this.eventBus.emit('tree:node_activated', 'AgentTreeManager', {
                nodeId,
                nodeName: node.name,
                level: node.level,
                parentId: node.parent_id,
            });
        }
    }

    /**
     * Mark a node as waiting for its children to complete.
     */
    waitForChildren(nodeId: string): void {
        this.database.updateTreeNode(nodeId, { status: TreeNodeStatus.WaitingChild });
    }

    /**
     * Complete a node with a result.
     * Resets back to idle after 10s so the node can be reused for subsequent tickets.
     */
    completeNode(nodeId: string, result: string): void {
        const node = this.getNode(nodeId);
        if (!node) return;

        this.database.updateTreeNode(nodeId, {
            status: TreeNodeStatus.Completed,
        });

        // Record result in conversation
        this.database.createAgentConversation({
            tree_node_id: nodeId,
            level: node.level,
            role: ConversationRole.Agent,
            content: `[COMPLETED] ${result.substring(0, 500)}`,
        });

        this.eventBus.emit('tree:node_completed', 'AgentTreeManager', {
            nodeId,
            nodeName: node.name,
            level: node.level,
            parentId: node.parent_id,
        });

        // Reset to idle after 10s so the tree refreshes for subsequent tickets
        setTimeout(() => {
            try {
                this.database.updateTreeNode(nodeId, { status: TreeNodeStatus.Idle });
                this.eventBus.emit('tree:node_idle', 'AgentTreeManager', { nodeId, nodeName: node.name, level: node.level });
            } catch { /* non-fatal — node may have been deleted */ }
        }, 10000);
    }

    /**
     * Fail a node with an error.
     * Resets back to idle after 15s so the node can be reused for subsequent tickets.
     */
    failNode(nodeId: string, error: string): void {
        const node = this.getNode(nodeId);
        if (!node) return;

        this.database.updateTreeNode(nodeId, {
            status: TreeNodeStatus.Failed,
            retries: node.retries + 1,
        });

        this.database.createAgentConversation({
            tree_node_id: nodeId,
            level: node.level,
            role: ConversationRole.Agent,
            content: `[FAILED] ${error.substring(0, 500)}`,
        });

        this.eventBus.emit('tree:node_failed', 'AgentTreeManager', {
            nodeId,
            nodeName: node.name,
            level: node.level,
            error,
            retries: node.retries + 1,
        });

        // Reset to idle after 15s (slightly longer than success so user can see the failure)
        setTimeout(() => {
            try {
                this.database.updateTreeNode(nodeId, { status: TreeNodeStatus.Idle });
                this.eventBus.emit('tree:node_idle', 'AgentTreeManager', { nodeId, nodeName: node.name, level: node.level });
            } catch { /* non-fatal — node may have been deleted */ }
        }, 15000);
    }

    /**
     * Escalate work from a node to its parent (different from question escalation).
     * Used when a node can't complete its assigned work.
     */
    escalateWork(nodeId: string, reason: string): void {
        const node = this.getNode(nodeId);
        if (!node) return;

        this.database.updateTreeNode(nodeId, {
            status: TreeNodeStatus.Escalated,
            escalations: node.escalations + 1,
        });

        this.database.createAgentConversation({
            tree_node_id: nodeId,
            level: node.level,
            role: ConversationRole.Agent,
            content: `[ESCALATED] ${reason}`,
        });

        this.eventBus.emit('tree:node_escalated', 'AgentTreeManager', {
            nodeId,
            nodeName: node.name,
            level: node.level,
            parentId: node.parent_id,
            reason,
            escalationCount: node.escalations + 1,
        });
    }

    // ==================== TELEMETRY ====================

    /**
     * Record telemetry data for a node.
     */
    recordTelemetry(nodeId: string, metrics: Partial<NodeTelemetry>): void {
        const node = this.getNode(nodeId);
        if (!node) return;

        const updates: Partial<AgentTreeNode> = {};
        if (metrics.tokens_consumed !== undefined) {
            updates.tokens_consumed = node.tokens_consumed + metrics.tokens_consumed;
        }
        if (metrics.retries !== undefined) {
            updates.retries = node.retries + metrics.retries;
        }
        if (metrics.escalations !== undefined) {
            updates.escalations = node.escalations + metrics.escalations;
        }

        if (Object.keys(updates).length > 0) {
            this.database.updateTreeNode(nodeId, updates);
        }
    }

    // ==================== CLEANUP ====================

    /**
     * Prune completed branches from the tree.
     * Only prunes if ALL children of a node are completed.
     */
    pruneCompletedBranches(rootId: string): number {
        const tree = this.getTree(rootId);
        let pruned = 0;

        // Work bottom-up (highest level first)
        const sortedByLevel = [...tree].sort((a, b) => b.level - a.level);

        for (const node of sortedByLevel) {
            if (node.status !== TreeNodeStatus.Completed) continue;

            const children = this.getChildren(node.id);
            const allChildrenComplete = children.length === 0 || children.every(c => c.status === TreeNodeStatus.Completed || c.status === TreeNodeStatus.Pruned);

            if (allChildrenComplete && node.level >= AgentLevel.L5_SubManager) {
                // Only prune L5+ nodes (keep the skeleton)
                this.database.updateTreeNode(node.id, { status: TreeNodeStatus.Pruned });
                pruned++;
            }
        }

        if (pruned > 0) {
            this.outputChannel.appendLine(`[AgentTree] Pruned ${pruned} completed branches from tree ${rootId}`);
            this.eventBus.emit('tree:branch_pruned', 'AgentTreeManager', { rootId, prunedCount: pruned });
        }

        return pruned;
    }

    /**
     * Delete all tree nodes for a task (full cleanup).
     */
    deleteTreeForTask(taskId: string): number {
        return this.database.deleteTreeNodesByTask(taskId);
    }

    // ==================== NICHE AGENT SELECTION ====================

    /**
     * Select relevant niche agents for a task based on keywords.
     * Used to determine which L8/L9 agents should be spawned.
     */
    getNicheAgentsForTask(taskDescription: string, domain?: string): NicheAgentDefinition[] {
        const keywords = this.extractKeywords(taskDescription.toLowerCase());
        const allNiche = domain
            ? this.database.getNicheAgentsByDomain(domain)
            : [
                ...this.database.getNicheAgentsByLevel(AgentLevel.L8_Worker),
                ...this.database.getNicheAgentsByLevel(AgentLevel.L9_Checker),
            ];

        return allNiche.filter(def => {
            const defKeywords = [
                def.name.toLowerCase(),
                def.specialty.toLowerCase(),
                def.area.toLowerCase(),
                def.domain.toLowerCase(),
            ].join(' ');
            return keywords.some(kw => defKeywords.includes(kw));
        });
    }

    // ==================== TEMPLATE MANAGEMENT ====================

    /**
     * Get template nodes from database or return empty array.
     */
    private getTemplateNodes(templateName: string): TemplateNode[] {
        const template = this.database.getTreeTemplateByName(templateName);
        if (!template) return [];

        try {
            return JSON.parse(template.nodes_json) as TemplateNode[];
        } catch {
            this.outputChannel.appendLine(`[AgentTree] Failed to parse template "${templateName}" nodes_json`);
            return [];
        }
    }

    /**
     * Get the built-in standard template (L0-L4).
     * This is the default ~50 node skeleton.
     */
    private getBuiltInStandardTemplate(): TemplateNode[] {
        const defaultPerms = [AgentPermission.Read, AgentPermission.Execute, AgentPermission.Escalate, AgentPermission.Spawn];

        return [
            // L0: Boss
            { name: 'BossAgent', agent_type: 'boss', level: AgentLevel.L0_Boss, scope: 'all', parent_name: null, max_fanout: 1, max_depth_below: 9, escalation_threshold: 5, context_isolation: false, history_isolation: false, permissions: [...defaultPerms, AgentPermission.Configure, AgentPermission.Approve, AgentPermission.Delete] },

            // L1: Global Orchestrator
            { name: 'GlobalOrchestrator', agent_type: 'orchestrator', level: AgentLevel.L1_GlobalOrchestrator, scope: 'all', parent_name: 'BossAgent', max_fanout: 4, max_depth_below: 8, escalation_threshold: 5, context_isolation: false, history_isolation: false, permissions: [...defaultPerms, AgentPermission.Configure, AgentPermission.Approve] },

            // L2: Domain Orchestrators (4)
            { name: 'CodeDomainOrchestrator', agent_type: 'orchestrator', level: AgentLevel.L2_DomainOrchestrator, scope: 'code,programming,implementation,engineering', parent_name: 'GlobalOrchestrator', max_fanout: 4, max_depth_below: 7, escalation_threshold: 4, context_isolation: true, history_isolation: true, permissions: [...defaultPerms, AgentPermission.Approve] },
            { name: 'DesignDomainOrchestrator', agent_type: 'orchestrator', level: AgentLevel.L2_DomainOrchestrator, scope: 'design,ui,ux,visual,layout,brand', parent_name: 'GlobalOrchestrator', max_fanout: 3, max_depth_below: 7, escalation_threshold: 4, context_isolation: true, history_isolation: true, permissions: [...defaultPerms, AgentPermission.Approve] },
            { name: 'DataDomainOrchestrator', agent_type: 'orchestrator', level: AgentLevel.L2_DomainOrchestrator, scope: 'data,database,schema,migration,seed,query', parent_name: 'GlobalOrchestrator', max_fanout: 4, max_depth_below: 7, escalation_threshold: 4, context_isolation: true, history_isolation: true, permissions: [...defaultPerms, AgentPermission.Approve] },
            { name: 'DocsDomainOrchestrator', agent_type: 'orchestrator', level: AgentLevel.L2_DomainOrchestrator, scope: 'docs,documentation,readme,api-docs,tutorial', parent_name: 'GlobalOrchestrator', max_fanout: 3, max_depth_below: 7, escalation_threshold: 4, context_isolation: true, history_isolation: true, permissions: [...defaultPerms, AgentPermission.Approve] },

            // L3: Area Orchestrators (~12)
            // Code domain areas
            { name: 'FrontendArea', agent_type: 'orchestrator', level: AgentLevel.L3_AreaOrchestrator, scope: 'frontend,react,vue,angular,css,html,component,page,style', parent_name: 'CodeDomainOrchestrator', max_fanout: 5, max_depth_below: 6, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'BackendArea', agent_type: 'orchestrator', level: AgentLevel.L3_AreaOrchestrator, scope: 'backend,api,server,route,endpoint,middleware,auth,service', parent_name: 'CodeDomainOrchestrator', max_fanout: 5, max_depth_below: 6, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'TestingArea', agent_type: 'orchestrator', level: AgentLevel.L3_AreaOrchestrator, scope: 'testing,test,unit,integration,e2e,coverage,mock,fixture', parent_name: 'CodeDomainOrchestrator', max_fanout: 4, max_depth_below: 6, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'InfraArea', agent_type: 'orchestrator', level: AgentLevel.L3_AreaOrchestrator, scope: 'infra,infrastructure,deploy,ci,cd,docker,monitoring,pipeline', parent_name: 'CodeDomainOrchestrator', max_fanout: 4, max_depth_below: 6, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },

            // Design domain areas
            { name: 'UIDesignArea', agent_type: 'orchestrator', level: AgentLevel.L3_AreaOrchestrator, scope: 'ui,layout,grid,spacing,color,typography,component-design,theme', parent_name: 'DesignDomainOrchestrator', max_fanout: 4, max_depth_below: 6, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'UXDesignArea', agent_type: 'orchestrator', level: AgentLevel.L3_AreaOrchestrator, scope: 'ux,flow,journey,persona,usability,onboarding,navigation-flow,feedback', parent_name: 'DesignDomainOrchestrator', max_fanout: 4, max_depth_below: 6, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'BrandArea', agent_type: 'orchestrator', level: AgentLevel.L3_AreaOrchestrator, scope: 'brand,identity,logo,voice,guideline,style-guide', parent_name: 'DesignDomainOrchestrator', max_fanout: 3, max_depth_below: 6, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },

            // Data domain areas
            { name: 'SchemaArea', agent_type: 'orchestrator', level: AgentLevel.L3_AreaOrchestrator, scope: 'schema,table,column,index,constraint,relationship,normalization', parent_name: 'DataDomainOrchestrator', max_fanout: 3, max_depth_below: 6, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'MigrationArea', agent_type: 'orchestrator', level: AgentLevel.L3_AreaOrchestrator, scope: 'migration,rollback,data-transform,schema-diff,version', parent_name: 'DataDomainOrchestrator', max_fanout: 3, max_depth_below: 6, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'SeedArea', agent_type: 'orchestrator', level: AgentLevel.L3_AreaOrchestrator, scope: 'seed,fixture,sample-data,test-data,import', parent_name: 'DataDomainOrchestrator', max_fanout: 3, max_depth_below: 6, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'QueryArea', agent_type: 'orchestrator', level: AgentLevel.L3_AreaOrchestrator, scope: 'query,aggregation,report,optimization,performance', parent_name: 'DataDomainOrchestrator', max_fanout: 3, max_depth_below: 6, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },

            // Docs domain areas
            { name: 'APIDocsArea', agent_type: 'orchestrator', level: AgentLevel.L3_AreaOrchestrator, scope: 'api-docs,openapi,swagger,endpoint-doc,schema-doc', parent_name: 'DocsDomainOrchestrator', max_fanout: 3, max_depth_below: 6, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'UserDocsArea', agent_type: 'orchestrator', level: AgentLevel.L3_AreaOrchestrator, scope: 'user-docs,tutorial,guide,readme,faq', parent_name: 'DocsDomainOrchestrator', max_fanout: 3, max_depth_below: 6, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'InternalDocsArea', agent_type: 'orchestrator', level: AgentLevel.L3_AreaOrchestrator, scope: 'internal-docs,architecture,changelog,decision-record,process-doc', parent_name: 'DocsDomainOrchestrator', max_fanout: 3, max_depth_below: 6, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },

            // L4: Managers (~25)
            // Frontend managers
            { name: 'ComponentManager', agent_type: 'planning', level: AgentLevel.L4_Manager, scope: 'component,button,form,input,modal,table,list,card,navigation', parent_name: 'FrontendArea', max_fanout: 5, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'PageManager', agent_type: 'planning', level: AgentLevel.L4_Manager, scope: 'page,route,layout,view,template,landing', parent_name: 'FrontendArea', max_fanout: 4, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'StyleManager', agent_type: 'planning', level: AgentLevel.L4_Manager, scope: 'style,css,theme,responsive,animation,transition,design-token', parent_name: 'FrontendArea', max_fanout: 4, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },

            // Backend managers
            { name: 'APIManager', agent_type: 'planning', level: AgentLevel.L4_Manager, scope: 'api,rest,graphql,websocket,endpoint,route', parent_name: 'BackendArea', max_fanout: 5, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'DatabaseManager', agent_type: 'planning', level: AgentLevel.L4_Manager, scope: 'database,orm,query,model,repository', parent_name: 'BackendArea', max_fanout: 4, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'ServiceManager', agent_type: 'planning', level: AgentLevel.L4_Manager, scope: 'service,business-logic,workflow,process,handler', parent_name: 'BackendArea', max_fanout: 4, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'AuthManager', agent_type: 'planning', level: AgentLevel.L4_Manager, scope: 'auth,authentication,authorization,session,token,jwt,oauth', parent_name: 'BackendArea', max_fanout: 3, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },

            // Testing managers
            { name: 'UnitTestManager', agent_type: 'verification', level: AgentLevel.L4_Manager, scope: 'unit-test,jest,mocha,assertion,mock', parent_name: 'TestingArea', max_fanout: 3, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'IntegrationTestManager', agent_type: 'verification', level: AgentLevel.L4_Manager, scope: 'integration-test,api-test,database-test,service-test', parent_name: 'TestingArea', max_fanout: 3, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'E2ETestManager', agent_type: 'verification', level: AgentLevel.L4_Manager, scope: 'e2e-test,playwright,cypress,selenium,browser-test', parent_name: 'TestingArea', max_fanout: 3, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },

            // Infra managers
            { name: 'DeploymentManager', agent_type: 'planning', level: AgentLevel.L4_Manager, scope: 'deploy,release,staging,production,rollback', parent_name: 'InfraArea', max_fanout: 3, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'CIManager', agent_type: 'planning', level: AgentLevel.L4_Manager, scope: 'ci,cd,pipeline,github-actions,jenkins,build', parent_name: 'InfraArea', max_fanout: 3, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'MonitoringManager', agent_type: 'planning', level: AgentLevel.L4_Manager, scope: 'monitoring,logging,alerts,metrics,health-check,observability', parent_name: 'InfraArea', max_fanout: 3, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },

            // Design managers
            { name: 'LayoutDesignManager', agent_type: 'planning', level: AgentLevel.L4_Manager, scope: 'layout,grid,spacing,responsive,breakpoint', parent_name: 'UIDesignArea', max_fanout: 4, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'ComponentDesignManager', agent_type: 'planning', level: AgentLevel.L4_Manager, scope: 'component-design,button-design,form-design,card-design,icon', parent_name: 'UIDesignArea', max_fanout: 4, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'ThemeManager', agent_type: 'planning', level: AgentLevel.L4_Manager, scope: 'theme,color-palette,typography,design-token,dark-mode', parent_name: 'UIDesignArea', max_fanout: 3, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'FlowManager', agent_type: 'planning', level: AgentLevel.L4_Manager, scope: 'flow,user-journey,persona,usability,wireframe', parent_name: 'UXDesignArea', max_fanout: 4, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'ResearchManager', agent_type: 'research', level: AgentLevel.L4_Manager, scope: 'ux-research,user-testing,heuristic,competitor-analysis', parent_name: 'UXDesignArea', max_fanout: 3, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'IdentityManager', agent_type: 'planning', level: AgentLevel.L4_Manager, scope: 'identity,logo,brand-mark,visual-identity', parent_name: 'BrandArea', max_fanout: 3, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'GuidelineManager', agent_type: 'planning', level: AgentLevel.L4_Manager, scope: 'guideline,style-guide,brand-voice,brand-tone', parent_name: 'BrandArea', max_fanout: 3, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },

            // Data managers
            { name: 'SchemaDesignManager', agent_type: 'planning', level: AgentLevel.L4_Manager, scope: 'schema-design,table-design,erd,normalization', parent_name: 'SchemaArea', max_fanout: 3, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'RelationshipManager', agent_type: 'planning', level: AgentLevel.L4_Manager, scope: 'relationship,foreign-key,join,one-to-many,many-to-many', parent_name: 'SchemaArea', max_fanout: 3, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'MigrationScriptManager', agent_type: 'planning', level: AgentLevel.L4_Manager, scope: 'migration-script,up,down,rollback,alter-table', parent_name: 'MigrationArea', max_fanout: 3, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'SeedDataManager', agent_type: 'planning', level: AgentLevel.L4_Manager, scope: 'seed-data,fixture,sample,test-data,generator', parent_name: 'SeedArea', max_fanout: 3, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'QueryOptManager', agent_type: 'planning', level: AgentLevel.L4_Manager, scope: 'query-optimization,index-tuning,explain,performance', parent_name: 'QueryArea', max_fanout: 3, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },

            // Docs managers
            { name: 'APIDocManager', agent_type: 'planning', level: AgentLevel.L4_Manager, scope: 'api-doc,openapi-spec,endpoint-doc,request-doc,response-doc', parent_name: 'APIDocsArea', max_fanout: 3, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'UserDocManager', agent_type: 'planning', level: AgentLevel.L4_Manager, scope: 'user-doc,tutorial,readme,getting-started,faq', parent_name: 'UserDocsArea', max_fanout: 3, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
            { name: 'InternalDocManager', agent_type: 'planning', level: AgentLevel.L4_Manager, scope: 'internal-doc,architecture-doc,changelog,decision-record,adr', parent_name: 'InternalDocsArea', max_fanout: 3, max_depth_below: 5, escalation_threshold: 3, context_isolation: true, history_isolation: true, permissions: defaultPerms },
        ];
    }

    // ==================== UTILITIES ====================

    /**
     * Extract meaningful keywords from a text string.
     * Filters out common stop words.
     */
    private extractKeywords(text: string): string[] {
        const stopWords = new Set([
            'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
            'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
            'on', 'with', 'at', 'by', 'from', 'up', 'about', 'into', 'through',
            'during', 'before', 'after', 'above', 'below', 'between', 'out',
            'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here',
            'there', 'when', 'where', 'why', 'how', 'all', 'each', 'every',
            'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
            'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
            'because', 'as', 'until', 'while', 'what', 'which', 'who', 'whom',
            'this', 'that', 'these', 'those', 'i', 'me', 'my', 'myself', 'we',
            'our', 'ours', 'you', 'your', 'yours', 'he', 'him', 'his', 'she',
            'her', 'hers', 'it', 'its', 'they', 'them', 'their', 'theirs',
            'and', 'but', 'or', 'if', 'else',
        ]);

        return text
            .replace(/[^a-z0-9\-_]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2 && !stopWords.has(w));
    }

    /**
     * Parse the levels_traversed JSON string into an array of node IDs.
     */
    private parseLevelsTraversed(levelsTraversed: string): string[] {
        try {
            const parsed = JSON.parse(levelsTraversed);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    /**
     * Dispose / cleanup resources.
     */
    dispose(): void {
        // Nothing to clean up — all state is in the database
    }
}
