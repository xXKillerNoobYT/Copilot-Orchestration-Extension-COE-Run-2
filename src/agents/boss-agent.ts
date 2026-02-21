import { BaseAgent } from './base-agent';
import { AgentType, AgentContext, AgentResponse, AgentAction, TicketPriority, TicketStatus, WorkflowExecutionStatus, TreeNodeStatus, BossPreDispatchValidation, BossCompletionAssessment, BubbleResult } from '../types';
import type { AgentTreeManager } from '../core/agent-tree-manager';
import type { WorkflowEngine } from '../core/workflow-engine';

/**
 * Boss AI — top-level project manager of the COE system (per True Plan 03 hierarchy).
 *
 * The Boss AI sits at the top of the agent tree:
 *   Boss AI → Orchestrator → Planning Team → Specialist Agents → Review Agent
 *
 * It is the ACTIVE decision-maker and project manager:
 *   - Directly dispatches agents for immediate work
 *   - Manages parallel ticket processing (3 concurrent slots)
 *   - Intelligently orders and reorganizes the ticket queue
 *   - Sets priorities, organizes tasks, decides what to work on first/next
 *   - Monitors system health and recovers from issues
 *   - Maintains a persistent notepad for planning and tracking
 *   - Runs on startup, between batches, and every 5 min when idle
 *
 * v6.0: True project manager with direct dispatch, parallel processing,
 *        intelligent ordering, and multi-step decision framework.
 */
export class BossAgent extends BaseAgent {
    readonly name = 'Boss AI';
    readonly type = AgentType.Boss;

    // v9.0: Tree and workflow awareness
    private treeManager: AgentTreeManager | null = null;
    private workflowEngine: WorkflowEngine | null = null;

    /**
     * v9.0: Inject agent tree manager for tree-based ticket routing.
     */
    setTreeManager(atm: AgentTreeManager): void {
        this.treeManager = atm;
    }

    /**
     * v9.0: Inject workflow engine for workflow-aware health checks.
     */
    setWorkflowEngine(we: WorkflowEngine): void {
        this.workflowEngine = we;
    }

    /**
     * v9.0: Spawn a full 10-level agent tree for a plan.
     * Creates L0-L4 skeleton upfront; L5-L9 branches spawn lazily when work arrives.
     */
    async spawnTree(planId: string, templateName?: string): Promise<{ rootId: string }> {
        if (!this.treeManager) {
            throw new Error('AgentTreeManager not injected — cannot spawn tree');
        }
        const rootNode = this.treeManager.buildSkeletonForPlan(planId, templateName);
        this.database.addAuditLog(this.name, 'spawn_tree',
            `Spawned agent tree for plan ${planId} (root: ${rootNode.id})`);
        return { rootId: rootNode.id };
    }

    /**
     * v9.0: Prune completed branches from a tree to free resources.
     */
    pruneBranches(rootId: string): number {
        if (!this.treeManager) return 0;
        const pruned = this.treeManager.pruneCompletedBranches(rootId);
        if (pruned > 0) {
            this.database.addAuditLog(this.name, 'prune_branch',
                `Pruned ${pruned} completed branches from tree root ${rootId}`);
        }
        return pruned;
    }

    readonly systemPrompt = `You are the Boss AI — the top-level PROJECT MANAGER of the Copilot Orchestration Extension (COE).

## Your Role
You are the ACTIVE decision-maker and project manager. You don't just monitor — you DIRECT.
You oversee the Orchestrator, Planning Team, Verification Team, and all specialist agents.
You have a reserved LLM processing slot that is always available — even when all other slots are busy.
You are the intelligence behind task prioritization, resource allocation, quality control, and workflow optimization.

## Your Capabilities
- **Direct agent dispatch**: Call any agent directly (planning, verification, coding, research, etc.) without creating a ticket
- **Parallel ticket processing**: Manage concurrent ticket processing slots across 4 team queues
- **Priority management**: Change ticket priorities (P0/P1/P2/P3) and reorder the queue
- **Queue reorganization**: Move tickets between team queues, to front/back within a queue
- **Health monitoring**: Detect overloads, agent failures, plan drift, stale tickets, queue imbalances
- **Persistent notepad**: Maintain organized notes (sections: queue_strategy, blockers, patterns, next_actions)
- **Model management**: Hold tickets that need a different LLM model, trigger model swaps when efficient
- **Slot allocation**: Dynamically allocate processing slots across 4 team queues based on workload
- **Cancel/re-engage**: Cancel tickets with reason, periodically review cancelled tickets for re-engagement

## Team Queues (v7.0)
You manage 4 TEAM QUEUES, each led by a specialized orchestrator:
1. **ORCHESTRATOR** — Catch-all for unclassified work. Routes miscellaneous tickets.
2. **PLANNING** — Plans, designs, research coordination, decomposition, gap analysis.
3. **VERIFICATION** — Testing, review, QA, acceptance checking.
4. **CODING DIRECTOR** — Interface to external coding agent. Only code_generation work.

Each team gets allocated processing slots. You control the allocation dynamically.
- Total slots are limited. Reallocate based on workload (more planning work → give planning more slots).
- Use action: { type: "update_slot_allocation", payload: { orchestrator: 1, planning: 2, verification: 1, coding_director: 0 } }
- Use action: { type: "move_to_queue", payload: { ticket_id: "...", target_queue: "planning" } }
- Use action: { type: "cancel_ticket", payload: { ticket_id: "...", reason: "..." } }

## Cancelled Ticket Review
Periodically review cancelled tickets. If conditions changed (blocker resolved, info now available), re-engage them.
- Look for cancelled tickets whose blocking_ticket_id is now resolved
- Consider if new information makes a previously-cancelled task viable

## When You Run
- **Startup**: Assess system state, recover from crashes, plan first actions, organize queue
- **Between batches**: After a batch of tickets completes, evaluate results, reorganize, plan next batch
- **Idle timer (5 min)**: Scan for issues, stale work, missed opportunities, clean up notepad
- **On escalation**: Handle problems other agents can't solve

## Multi-Step Decision Framework
Take your time. Think through EACH step carefully before acting. Better to analyze thoroughly than to rush and make mistakes.

### STEP 1: Gather Context
- Review system health data provided to you (tasks, tickets, agents, audit log)
- Read your notepad for context from previous decisions
- Identify what has changed since your last check

### STEP 2: Assess Health & Detect Issues
- Are any agents in error state? → Priority recovery
- Is the task backlog too large? → PAUSE_INTAKE, focus on clearing
- Are there escalated tickets waiting? → Address user-facing issues promptly
- Have any tickets been stuck too long? → Recover them
- Are there completed coding tickets without verification? → Create verification tickets
- Has plan drift exceeded 20%? → Create correction planning ticket

### STEP 3: Analyze Queue & Dependencies
Look at ALL tickets in the queue and understand their relationships:
- Which tickets depend on which? Map the dependency chains.
- Which tickets, if completed, would UNBLOCK the most other work?
- Are there coding tickets that need to complete BEFORE their test tickets?
- Are there infrastructure/schema changes that need to happen BEFORE feature work?
- Are tickets for the SAME feature/area grouped together, or scattered?
- Could any tickets be combined or are any duplicates?

### STEP 4: Intelligent Ordering
Reorganize the queue using these criteria IN ORDER of importance:
1. **DEPENDENCY UNBLOCKING**: If ticket A unblocks B, C, and D — ticket A has 3x multiplied value. Always pick unblocking work first.
2. **FOUNDATION FIRST**: Infrastructure → schema → database → backend → API → frontend → UI → polish. Build the house from the foundation up.
3. **CODING BEFORE TESTING**: If TK-5 builds a module and TK-8 tests that module, TK-5 MUST run first. Always code before test for the same area.
4. **VERIFICATION URGENCY**: Completed coding needs prompt verification. Don't let unverified work pile up — it blocks dependent tickets.
5. **PLANNING VALUE**: Planning tickets that decompose into many sub-tickets have high throughput value. Do them early.
6. **BOSS DIRECTIVES**: Corrective tickets (operation_type=boss_directive) fix real problems — they get priority within their tier.
7. **CONTEXT CONTINUITY**: Same-domain tickets back-to-back reduces context switching. Group related work.
8. **RETRY RECOVERY**: Tickets with retries > 0 should be cleared to reduce backlog.
9. **PRIORITY TIEBREAKER**: P0 > P1 > P2 > P3 as final tiebreaker, not the primary factor.
10. **AGE FAIRNESS**: Among truly equal tickets, prefer older ones (FIFO).

### STEP 5: Take Actions
Based on your analysis, execute the most impactful actions. You have multiple tools:

#### Quick Actions (use dispatch_agent)
- Simple verification check? → dispatch_agent: verification
- Need a quick research answer? → dispatch_agent: research
- Small coding fix? → dispatch_agent: coding (creates a tracking ticket automatically)
- Need clarity on a ticket? → dispatch_agent: clarity

#### Tracked Work (use create_ticket)
- Complex multi-step work → create_ticket (full pipeline, audit trail)
- Work that needs review gates → create_ticket
- Work visible in the user's dashboard → create_ticket

#### Queue Management
- Wrong priority? → reprioritize (changes priority + re-sorts queue)
- Critical ticket stuck behind low-priority? → reorder_queue (move to front)
- Ticket needs a different model? → hold_ticket (moves to hold queue)

### STEP 6: Update Your Notepad
After every decision round, update your notepad with:
- What you decided and why
- What patterns you're noticing
- What to check next time
- Current queue strategy
Keep the notepad CLEAN and ORGANIZED — remove outdated notes, keep it current.

## Response Format
Respond with EXACTLY these 5 fields:

ASSESSMENT: [One paragraph system health. Total tasks, completed, pending, open tickets, slots active, queue depth, hold queue. End with: HEALTHY, WARNING, or CRITICAL.]
ISSUES: [Numbered issues. Each: what's wrong, severity, threshold. If none: "None detected."]
ACTIONS: [Numbered actions. Each: "1. [VERB] [what] [where] [why]". Max 8. See action verbs below.]
NEXT_TICKET: [The ticket ID or number that should be processed next from the candidates. Must be a REAL ticket ID/number from the input. "none" if queue is empty.]
ESCALATE: [true or false]

## Action Verbs
- CREATE_VERIFICATION: Create a ticket for the Verification Team to verify completed coding
- CREATE_PLANNING: Create a ticket for the Planning Team to decompose or plan work
- CREATE_CODING: Create a ticket for coding work
- DISPATCH_AGENT: Directly call an agent for quick work (agent_name, message)
- REPRIORITIZE: Change a ticket's priority (ticket_id, new_priority)
- REORDER_QUEUE: Move a ticket to front or back (ticket_id, position)
- HOLD_TICKET: Put a ticket on hold waiting for a different model
- ESCALATE_USER: Create a question/feedback for the user to answer
- RECOVER_STUCK: Recover a stuck or orphaned ticket
- UPDATE_NOTEPAD: Write to your persistent notepad (section, content) — sections: queue_strategy, blockers, patterns, next_actions
- PAUSE_INTAKE: Stop accepting new tickets until backlog clears
- MOVE_TO_QUEUE: Move a ticket between team queues (ticket_id, target_queue)
- CANCEL_TICKET: Cancel a ticket with reason (ticket_id, reason)
- UPDATE_SLOT_ALLOCATION: Reallocate processing slots across teams (orchestrator: N, planning: N, verification: N, coding_director: N)
- ASSIGN_TASK: Structured task assignment with success criteria (target_agent, task_message, success_criteria)
- BLOCK_TICKET: Mark a ticket as blocked with reason (ticket_id, reason, blocking_ticket_id)

## Rules
1. **Think before acting**: Go through all 6 steps. Don't skip analysis.
2. **Prefer the plan**: Follow the True Plan over individual agent opinions.
3. **Never delete**: Only create, recover, reprioritize, reorder, or cancel — never permanently delete tickets or tasks.
4. **Be specific**: Cite ticket numbers, team queues, patterns, impacts, and reasoning for every action.
5. **Code before test**: ALWAYS ensure coding tickets process before their corresponding test tickets.
6. **Verify promptly**: When coding tickets complete, always CREATE_VERIFICATION for them.
7. **Use dispatch for speed**: For simple/quick work, use DISPATCH_AGENT instead of creating a full ticket.
8. **Keep notepad organized**: Use sections (queue_strategy, blockers, patterns, next_actions). Keep them current.
9. **Balance team queues**: Reallocate slots based on workload. Don't let one team starve while another is idle.
10. **Think strategically**: One well-chosen unblocking ticket can unlock an entire chain of dependent work.
11. **Progress over perfection**: When in doubt, keep the pipeline flowing. Don't let perfect be the enemy of done.
12. **Review cancelled tickets**: Periodically check if cancelled tickets can be re-engaged (blocker resolved, info available).
13. **Handle escalations promptly**: When a lead agent escalates, assess and either re-route, provide info, or create a sub-task.`;

    /**
     * Check system health and return an assessment with ACTIONABLE decisions.
     *
     * Returns both a text assessment (for logging/display) and a structured
     * actions array that the TicketProcessor can execute immediately.
     *
     * This is the Boss AI's primary decision function. It:
     * 1. Gathers system state (deterministic)
     * 2. Checks thresholds and detects issues (deterministic)
     * 3. Generates concrete actions based on detected issues (deterministic)
     * 4. Optionally asks the LLM for nuanced assessment (when issues exist)
     */
    async checkSystemHealth(): Promise<AgentResponse> {
        const cfg = this.config.getConfig();
        const taskOverloadThreshold = cfg.bossTaskOverloadThreshold ?? 20;
        const escalationThreshold = cfg.bossEscalationThreshold ?? 5;
        const stuckPhaseMs = (cfg.bossStuckPhaseMinutes ?? 30) * 60 * 1000;

        const stats = this.database.getStats();
        const readyTasks = this.database.getReadyTasks();
        const agents = this.database.getAllAgents();
        const recentAudit = this.database.getAuditLog(200);
        const openTickets = this.database.getTicketsByStatus('open');
        const escalatedTickets = this.database.getTicketsByStatus('escalated');
        const resolvedTickets = this.database.getTicketsByStatus('resolved');

        // ==================== GATHER STATE ====================

        // v7.0: Retrieve Boss notepad from proper boss_notepad table
        const notepadSections = this.database.getBossNotepad?.() ?? {};
        const notepadEntries = Object.entries(notepadSections);
        const notepadContent = notepadEntries.length > 0
            ? notepadEntries.map(([section, content]) => `[${section}] ${content}`).join('\n')
            : '';
        // Fallback: check audit log for legacy notepad entries
        const legacyNotepad = !notepadContent
            ? (recentAudit
                .filter(a => a.action === 'boss_notepad')
                .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.detail ?? '')
            : '';
        const finalNotepad = notepadContent || legacyNotepad;

        // v7.0: Gather cancelled tickets for potential re-engagement
        const cancelledTickets = this.database.getCancelledTickets?.() ?? [];

        // v7.0: Gather recent completed/failed tickets for context
        const recentProcessed = this.database.getRecentProcessedTickets?.(15) ?? [];
        const recentProcessedSummary = recentProcessed.length > 0
            ? recentProcessed.map((t: any) => `  TK-${t.ticket_number} [${t.status}] ${t.title.substring(0, 50)}${t.last_error ? ' ERR: ' + t.last_error.substring(0, 40) : ''}`).join('\n')
            : '  (none)';

        // v7.0: Per-team queue status (will be filled by TicketProcessor in context)
        const cancelledSummary = cancelledTickets.length > 0
            ? cancelledTickets.slice(0, 5).map((t: any) => `  TK-${t.ticket_number} [${t.assigned_queue || '?'}] ${t.title.substring(0, 50)} — ${t.cancellation_reason || 'no reason'}`).join('\n')
            : '  (none)';

        const healthReport = [
            `System Health Check`,
            `Tasks: ${stats.total_tasks} total, ${readyTasks.length} ready`,
            `Tickets: ${stats.total_tickets} total, ${openTickets.length} open, ${escalatedTickets.length} escalated, ${cancelledTickets.length} cancelled`,
            `Agents: ${agents.map(a => `${a.name}(${a.status})`).join(', ')}`,
            `Recent audit entries: ${recentAudit.length}`,
            `\nRecent Processed Tickets (last 15):\n${recentProcessedSummary}`,
            cancelledTickets.length > 0 ? `\nCancelled Tickets (review for re-engagement):\n${cancelledSummary}` : '',
            finalNotepad ? `\nYour Notepad (from previous decisions):\n${finalNotepad.substring(0, 800)}` : '',
        ].filter(Boolean).join('\n');

        // ==================== DETECT ISSUES (deterministic) ====================

        const issues: string[] = [];
        const actions: AgentAction[] = [];

        // CRITICAL: Task overload (exceeds configured threshold)
        if (readyTasks.length > taskOverloadThreshold) {
            issues.push(`CRITICAL: Task overload — ${readyTasks.length} pending tasks (limit: ${taskOverloadThreshold})`);
            actions.push({
                type: 'log',
                payload: { action: 'pause_intake', reason: `${readyTasks.length} pending tasks exceeds limit of ${taskOverloadThreshold}` },
            });
        }

        // CRITICAL: Agent failure (any agent in error state)
        const failedAgents = agents.filter(a => a.status === 'error');
        if (failedAgents.length > 0) {
            issues.push(`CRITICAL: Agent failure — ${failedAgents.map(a => a.name).join(', ')} in error state`);
            actions.push({
                type: 'escalate',
                payload: { reason: `Agent(s) in error state: ${failedAgents.map(a => a.name).join(', ')}` },
            });
        }

        // CRITICAL: Plan drift (>20% verified tasks with issues)
        const activePlan = this.database.getActivePlan();
        if (activePlan) {
            const planTasks = this.database.getTasksByPlan(activePlan.id);
            const failedTasks = planTasks.filter(t => t.status === 'failed' || t.status === 'needs_recheck');
            if (planTasks.length > 0) {
                const driftPercent = Math.round((failedTasks.length / planTasks.length) * 100);
                if (driftPercent > 20) {
                    issues.push(`CRITICAL: Plan drift — ${driftPercent}% of tasks failed/need recheck (${failedTasks.length}/${planTasks.length})`);
                    // Create planning ticket to investigate and fix drift
                    actions.push({
                        type: 'create_ticket',
                        payload: {
                            title: `Plan drift correction: ${failedTasks.length} of ${planTasks.length} tasks need attention`,
                            operation_type: 'boss_directive',
                            priority: TicketPriority.P1,
                            body: `Boss AI detected plan drift at ${driftPercent}%. Failed tasks:\n${failedTasks.map(t => `- ${t.title} (${t.status})`).join('\n')}`,
                        },
                    });
                }
            }
        }

        // WARNING: Escalation backlog (exceeds configured threshold)
        if (escalatedTickets.length > escalationThreshold) {
            issues.push(`WARNING: Escalation backlog — ${escalatedTickets.length} escalated tickets unresolved (limit: ${escalationThreshold})`);
            actions.push({
                type: 'escalate',
                payload: { reason: `${escalatedTickets.length} escalated tickets need user attention` },
            });
        }

        // WARNING: Repeated failures (>3 in last 24h)
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const recentFailures = recentAudit.filter(
            a => (a.action === 'verification_failed' || a.action === 'task_failed')
                && a.created_at > oneDayAgo
        );
        if (recentFailures.length > 3) {
            issues.push(`WARNING: Repeated failures — ${recentFailures.length} task failures in last 24 hours (limit: 3)`);
        }

        // WARNING: Stale tickets (open longer than configured stuck-phase timeout)
        const staleThresholdMs = stuckPhaseMs > 0 ? stuckPhaseMs : 30 * 60 * 1000;
        const staleCutoff = new Date(Date.now() - staleThresholdMs).toISOString();
        const staleTickets = openTickets.filter(t => t.created_at < staleCutoff);
        if (staleTickets.length > 0) {
            const staleMinutes = Math.round(staleThresholdMs / 60000);
            issues.push(`WARNING: Stale tickets — ${staleTickets.length} ticket(s) open for >${staleMinutes} minutes with no progress`);
            // Recover stale tickets
            for (const stale of staleTickets.slice(0, 3)) {
                actions.push({
                    type: 'create_ticket',
                    payload: {
                        title: `Recover stale ticket: TK-${stale.ticket_number} "${stale.title}"`,
                        operation_type: 'boss_directive',
                        priority: TicketPriority.P2,
                        body: `Boss AI detected ticket TK-${stale.ticket_number} open >${Math.round(staleThresholdMs / 60000)} minutes. Original: ${stale.title}`,
                        blocking_ticket_id: stale.id,
                    },
                });
            }
        }

        // v7.0: WARNING: Cancelled tickets with resolved blockers (auto-re-engage candidates)
        const reengageable = cancelledTickets.filter((t: any) => {
            if (!t.blocking_ticket_id) return false;
            const blocker = this.database.getTicket(t.blocking_ticket_id);
            return blocker && blocker.status === TicketStatus.Resolved;
        });
        if (reengageable.length > 0) {
            issues.push(`INFO: ${reengageable.length} cancelled ticket(s) have resolved blockers — consider re-engaging`);
        }

        // v9.0: Tree health checks
        if (this.treeManager && activePlan) {
            const planTreeNodes = this.database.getTreeNodesByTask(activePlan.id);
            const failedTreeNodes = planTreeNodes.filter(n => n.status === TreeNodeStatus.Failed);
            if (failedTreeNodes.length > 0) {
                issues.push(`WARNING: ${failedTreeNodes.length} tree node(s) in failed state — may need recovery`);
            }

            // Prune completed branches from active plan trees
            const rootNodes = planTreeNodes.filter(n => !n.parent_id);
            for (const rootNode of rootNodes) {
                this.pruneBranches(rootNode.id);
            }
        }

        // v9.0: Workflow health checks
        if (this.workflowEngine) {
            const runningExecutions = this.database.getPendingWorkflowExecutions();
            const stuckExecutions = runningExecutions.filter(e => {
                if (e.status !== WorkflowExecutionStatus.Running && e.status !== WorkflowExecutionStatus.WaitingApproval) return false;
                // Stuck if running for more than 30 minutes
                const startedAt = new Date(e.started_at).getTime();
                return Date.now() - startedAt > 30 * 60 * 1000;
            });
            const pendingApprovals = runningExecutions.filter(
                e => e.status === WorkflowExecutionStatus.WaitingApproval
            );

            if (stuckExecutions.length > 0) {
                issues.push(`WARNING: ${stuckExecutions.length} workflow execution(s) stuck for >30 minutes`);
            }
            if (pendingApprovals.length > 0) {
                issues.push(`INFO: ${pendingApprovals.length} workflow execution(s) waiting for user approval`);
            }
        }

        // ==================== PROACTIVE WORK GENERATION ====================

        // Look for completed coding tickets that haven't been verified yet
        const recentlyResolved = resolvedTickets.filter(t => {
            const isRecent = t.updated_at > new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            const isCoding = t.operation_type === 'code_generation' || t.deliverable_type === 'code_generation';
            const notVerified = t.verification_result !== 'passed' && t.verification_result !== 'verified';
            return isRecent && isCoding && notVerified;
        });

        for (const codingTicket of recentlyResolved.slice(0, 3)) {
            // Check if a verification ticket already exists for this one
            const existingVerify = openTickets.find(t =>
                t.title.includes(`verify:`) && t.title.includes(codingTicket.ticket_number?.toString() || codingTicket.id)
            );
            if (!existingVerify) {
                actions.push({
                    type: 'create_ticket',
                    payload: {
                        title: `verify: TK-${codingTicket.ticket_number} "${codingTicket.title}"`,
                        operation_type: 'verification',
                        priority: TicketPriority.P2,
                        body: `Boss AI: Verify the output of completed coding ticket TK-${codingTicket.ticket_number}.\n\nOriginal ticket: ${codingTicket.title}\nAcceptance criteria: ${codingTicket.acceptance_criteria || 'Match original requirements'}`,
                        blocking_ticket_id: codingTicket.id,
                        deliverable_type: 'verification',
                    },
                });
            }
        }

        // INFO: Post-cycle review (all P1 tasks completed)
        if (activePlan) {
            const planTasks = this.database.getTasksByPlan(activePlan.id);
            const p1Tasks = planTasks.filter(t => t.priority === 'P1');
            if (p1Tasks.length > 0) {
                const completedP1 = p1Tasks.filter(t => t.status === 'verified');
                if (completedP1.length === p1Tasks.length) {
                    const remainingTasks = planTasks.filter(t => t.status !== 'verified');
                    issues.push(`INFO: Post-cycle review — All ${p1Tasks.length} P1 tasks completed. ${remainingTasks.length} lower-priority tasks remaining. Consider retrospective.`);
                }
            }
        }

        // ==================== BUILD RESPONSE ====================

        const context: AgentContext = { conversationHistory: [] };

        if (issues.length > 0) {
            // Ask LLM for nuanced assessment when issues exist
            const llmResponse = await this.processMessage(
                `${healthReport}\n\nDetected issues:\n${issues.join('\n')}`,
                context
            );
            // Merge deterministic actions with any LLM might suggest
            return {
                content: llmResponse.content,
                actions: [...actions, ...(llmResponse.actions || [])],
                confidence: llmResponse.confidence,
                tokensUsed: llmResponse.tokensUsed,
            };
        }

        // Healthy system — return deterministic actions only (no LLM call needed)
        return {
            content: `ASSESSMENT: System healthy. ${readyTasks.length} tasks ready, ${openTickets.length} tickets open. Status: HEALTHY.\nISSUES: None detected.\nACTIONS: ${actions.length > 0 ? actions.length + ' proactive actions generated.' : 'None needed.'}\nNEXT_TICKET: ${readyTasks.length > 0 ? 'Queue has items.' : 'none'}\nESCALATE: false`,
            actions,
        };
    }

    /**
     * v5.0: LLM-driven intelligent ticket selection.
     *
     * Given a list of candidate tickets (unblocked, ready to process), the Boss AI
     * uses the LLM to evaluate which ticket should be processed NEXT based on:
     *
     *   1. Dependency chains — if ticket A unblocks tickets B and C, prioritize A
     *   2. Foundation-first — infrastructure/schema before UI, backend before frontend
     *   3. Verification urgency — completed coding tickets need verification promptly
     *   4. Planning tickets that unblock multiple downstream = high value
     *   5. Boss directives (corrective actions) get priority within same tier
     *   6. Context continuity — similar domain tickets back-to-back saves context switching
     *   7. Raw priority (P0 > P1 > P2 > P3) as a tiebreaker, not the sole factor
     *
     * Returns the ticket ID of the best pick, or null (fallback to deterministic sort).
     */
    async selectNextTicket(
        candidates: Array<{
            ticketId: string;
            ticketNumber: number;
            title: string;
            priority: string;
            operationType: string;
            body: string;
            blockingTicketId: string | null;
            deliverableType: string;
            retryCount: number;
            lastError: string | null;
            createdAt: string;
        }>
    ): Promise<string | null> {
        if (candidates.length <= 1) {
            // Only one candidate — no choice needed
            return candidates.length === 1 ? candidates[0].ticketId : null;
        }

        try {
            // Build a concise summary of each candidate for the LLM
            const candidateList = candidates.map((c, i) => {
                const parts = [
                    `${i + 1}. TK-${c.ticketNumber} [${c.priority}] "${c.title}"`,
                    `   Type: ${c.operationType} | Deliverable: ${c.deliverableType}`,
                    `   Created: ${c.createdAt.split('T')[0]}`,
                ];
                if (c.blockingTicketId) {
                    parts.push(`   Blocks: another ticket (dependency chain)`);
                }
                if (c.retryCount > 0) {
                    parts.push(`   Retries: ${c.retryCount} (last error: ${c.lastError?.substring(0, 80) || 'unknown'})`);
                }
                if (c.body) {
                    parts.push(`   Summary: ${c.body.substring(0, 150).replace(/\n/g, ' ')}`);
                }
                return parts.join('\n');
            }).join('\n\n');

            const selectionPrompt = `You are the Boss AI selecting the NEXT ticket to process from the queue.
Think through this step by step. Take your time — a well-chosen ticket can unblock an entire chain of work.

## Candidates (${candidates.length} tickets ready)

${candidateList}

## Step 1: Identify Dependencies
Look at each ticket's "Blocks" field. If processing ticket A would unblock other tickets, A has multiplied value. Map the chains.

## Step 2: Identify Ordering Constraints
- Does a coding ticket need to finish BEFORE a test ticket for the same area? Code first, then test.
- Does infrastructure/schema work need to happen BEFORE feature work? Foundation first.
- Are there tickets for the same feature that should be grouped back-to-back?

## Step 3: Apply Selection Criteria (in priority order)
1. DEPENDENCY UNBLOCKING: Ticket that unblocks the most other work = highest value
2. FOUNDATION FIRST: Infrastructure → schema → database → backend → API → frontend → UI
3. CODING BEFORE TESTING: Code the module first, THEN test it. Never test before coding.
4. VERIFICATION URGENCY: Completed coding needs verification promptly to unblock dependent work
5. PLANNING VALUE: Planning tickets that decompose into many sub-tickets = high throughput
6. BOSS DIRECTIVES: Corrective tickets (operation_type=boss_directive) fix real problems
7. CONTEXT CONTINUITY: Same-domain tickets back-to-back saves context switching
8. RETRY RECOVERY: Clear tickets with retries > 0 to reduce backlog
9. PRIORITY TIEBREAKER: P0 > P1 > P2 > P3 (only as tiebreaker)
10. AGE FAIRNESS: Among truly equal tickets, prefer older (FIFO)

## Response Format

REASONING: [1-2 sentences explaining your choice]
SELECTED: TK-<number>`;

            const context = { conversationHistory: [] };
            const llmResponse = await this.processMessage(selectionPrompt, context);

            // Parse the response — look for "SELECTED: TK-<number>"
            const selectedMatch = llmResponse.content.match(/SELECTED:\s*TK-(\d+)/i);
            if (selectedMatch) {
                const selectedNumber = parseInt(selectedMatch[1], 10);
                const found = candidates.find(c => c.ticketNumber === selectedNumber);
                if (found) {
                    return found.ticketId;
                }
            }

            // Fallback: try to find any TK-number in response
            const tkMatch = llmResponse.content.match(/TK-(\d+)/);
            if (tkMatch) {
                const tkNumber = parseInt(tkMatch[1], 10);
                const found = candidates.find(c => c.ticketNumber === tkNumber);
                if (found) {
                    return found.ticketId;
                }
            }

            // LLM response couldn't be parsed — fall back to deterministic
            return null;
        } catch (err) {
            // LLM failure is non-fatal — fall back to deterministic sort
            return null;
        }
    }

    // ==================== v11.0: Boss Pre-Dispatch Validation ====================

    /**
     * v11.0: Validate that a ticket should be processed NEXT.
     *
     * Called in fillSlots() AFTER selecting a ticket but BEFORE dispatching.
     * Boss confirms: "Yes, process this ticket now" or "No, process ticket X instead"
     * or "Wait — ticket Y is blocking this, set the relationship first."
     *
     * Uses a focused LLM prompt (faster than full inter-ticket review).
     * Times out at 10s — if LLM is slow, returns approval to avoid blocking.
     *
     * @param ticket The ticket about to be dispatched
     * @param queueSnapshot Top N tickets in the queue (for comparison)
     * @param activeTicketSummaries Summary of currently processing tickets
     * @returns BossPreDispatchValidation — approve, redirect, or block
     */
    async validateNextTicket(
        ticket: {
            id: string;
            ticketNumber: number;
            title: string;
            priority: string;
            operationType: string;
            body: string;
            blockingTicketId: string | null;
            ticketCategory: string | null;
            ticketStage: string | null;
        },
        queueSnapshot: Array<{
            ticketNumber: number;
            title: string;
            priority: string;
            operationType: string;
            ticketCategory: string | null;
            blockingTicketId: string | null;
        }>,
        activeTicketSummaries: string[]
    ): Promise<BossPreDispatchValidation> {
        // Default: approve (safe fallback if LLM fails or times out)
        const defaultApproval: BossPreDispatchValidation = {
            shouldProcess: true,
            reason: 'Approved by default (deterministic fallback)',
        };

        if (queueSnapshot.length === 0) {
            return { ...defaultApproval, reason: 'Only ticket in queue — approved' };
        }

        try {
            const queueSummary = queueSnapshot.slice(0, 8).map((q, i) =>
                `  ${i + 1}. TK-${q.ticketNumber} [${q.priority}] ${q.title.substring(0, 60)} (${q.operationType}${q.ticketCategory ? ', ' + q.ticketCategory : ''}${q.blockingTicketId ? ', BLOCKED' : ''})`
            ).join('\n');

            const activeSummary = activeTicketSummaries.length > 0
                ? activeTicketSummaries.join('\n')
                : '  (none currently processing)';

            const prompt = `QUICK VALIDATION: Should this ticket be processed NEXT?

TICKET TO PROCESS:
  TK-${ticket.ticketNumber} [${ticket.priority}] "${ticket.title}"
  Type: ${ticket.operationType} | Category: ${ticket.ticketCategory ?? 'untagged'} | Stage: ${ticket.ticketStage ?? 'unknown'}
  ${ticket.blockingTicketId ? 'BLOCKED BY another ticket' : 'No blockers'}
  Body: ${(ticket.body ?? '').substring(0, 200)}

QUEUE (next ${queueSnapshot.length} tickets):
${queueSummary}

CURRENTLY PROCESSING:
${activeSummary}

RULES:
1. If this ticket is BLOCKED, it should NOT be processed. Answer NO.
2. If a higher-priority ticket in the queue would be better to process first, answer NO and specify which.
3. If this ticket has dependencies that should complete first, answer NO and explain.
4. Otherwise, answer YES.

RESPOND IN EXACTLY THIS FORMAT:
SHOULD_PROCESS: YES or NO
REASON: [1 sentence]
ALTERNATE_TICKET: TK-<number> (only if NO)
NOTES_FOR_AGENT: [optional guidance for the processing agent]`;

            // Race against 10s timeout
            const context = { conversationHistory: [] };
            const timeoutMs = 10000;

            const llmPromise = this.processMessage(prompt, context);
            const timeoutPromise = new Promise<null>((resolve) =>
                setTimeout(() => resolve(null), timeoutMs)
            );

            const result = await Promise.race([llmPromise, timeoutPromise]);
            if (!result) {
                // Timeout — approve by default
                return { ...defaultApproval, reason: 'Approved (Boss validation timed out after 10s)' };
            }

            // Parse the response
            const content = result.content;
            const shouldProcess = /SHOULD_PROCESS:\s*YES/i.test(content);
            const reasonMatch = content.match(/REASON:\s*(.+?)(?:\n|$)/i);
            const alternateMatch = content.match(/ALTERNATE_TICKET:\s*TK-(\d+)/i);
            const notesMatch = content.match(/NOTES_FOR_AGENT:\s*(.+?)(?:\n|$)/i);

            const validation: BossPreDispatchValidation = {
                shouldProcess,
                reason: reasonMatch?.[1]?.trim() ?? (shouldProcess ? 'Approved' : 'Rejected by Boss'),
            };

            if (!shouldProcess && alternateMatch) {
                const altNumber = parseInt(alternateMatch[1], 10);
                const altTicket = queueSnapshot.find(q => q.ticketNumber === altNumber);
                if (altTicket) {
                    // We'd need the ticket ID — for now store the number so caller can look it up
                    validation.alternateTicketId = `TK-${altNumber}`;
                }
            }

            if (notesMatch?.[1]?.trim()) {
                validation.notesForAgent = notesMatch[1].trim();
            }

            return validation;
        } catch (err) {
            // LLM failure is non-fatal — approve by default
            return { ...defaultApproval, reason: 'Approved (Boss validation failed — fallback)' };
        }
    }

    /**
     * v11.0: Assess whether a ticket is truly complete based on the bubble-up chain.
     *
     * Called after results have bubbled from the leaf all the way up to L0.
     * Boss reviews the full execution chain and decides: DONE, NEEDS_REWORK, or ESCALATE.
     *
     * Only the Boss can set TicketStatus.Resolved — this is the gatekeeper.
     *
     * @param ticketSummary Basic ticket info
     * @param bubbleChain Results from each level as they reviewed the work
     * @param leafResult The actual work output from the leaf agent
     * @returns BossCompletionAssessment
     */
    async assessTicketCompletion(
        ticketSummary: {
            ticketNumber: number;
            title: string;
            operationType: string;
            acceptanceCriteria: string | null;
            body: string;
        },
        bubbleChain: BubbleResult[],
        leafResult: string
    ): Promise<BossCompletionAssessment> {
        // Default: approve (safe fallback)
        const defaultAssessment: BossCompletionAssessment = {
            verdict: 'done',
            reason: 'Approved by default (deterministic fallback)',
            qualityScore: 70,
        };

        try {
            const chainSummary = bubbleChain.map((b, i) =>
                `  L${b.level} ${b.agentName}: [${b.status}] ${b.summary.substring(0, 150)}${b.reviewNotes ? ' | Review: ' + b.reviewNotes.substring(0, 100) : ''}${b.errorExplanation ? ' | ERROR: ' + b.errorExplanation.substring(0, 100) : ''}`
            ).join('\n');

            const hasErrors = bubbleChain.some(b => b.status === 'failed' || b.status === 'escalate');
            const hasReworkRequests = bubbleChain.some(b => b.status === 'needs_rework');

            const prompt = `COMPLETION ASSESSMENT: Is this ticket's work done and correct?

TICKET: TK-${ticketSummary.ticketNumber} "${ticketSummary.title}"
Type: ${ticketSummary.operationType}
Acceptance Criteria: ${ticketSummary.acceptanceCriteria ?? 'None specified'}
Body: ${(ticketSummary.body ?? '').substring(0, 300)}

LEAF AGENT OUTPUT (the actual work):
${leafResult.substring(0, 600)}

REVIEW CHAIN (leaf → Boss):
${chainSummary || '  (no intermediate reviews)'}

${hasErrors ? '⚠️ ERRORS were reported in the chain — review carefully.' : ''}
${hasReworkRequests ? '⚠️ REWORK was requested by an intermediate reviewer.' : ''}

ASSESS THE WORK:
1. Does the output address the ticket's requirements?
2. Did intermediate reviewers approve or flag issues?
3. Are there any error explanations that suggest incomplete work?
4. Quality score 0-100?

RESPOND IN EXACTLY THIS FORMAT:
VERDICT: DONE or NEEDS_REWORK or ESCALATE
REASON: [1-2 sentences]
QUALITY_SCORE: <number 0-100>
REWORK_INSTRUCTIONS: [only if NEEDS_REWORK — what should be fixed]
ESCALATION_MESSAGE: [only if ESCALATE — what to tell the user]`;

            const context = { conversationHistory: [] };
            const timeoutMs = 15000;

            const llmPromise = this.processMessage(prompt, context);
            const timeoutPromise = new Promise<null>((resolve) =>
                setTimeout(() => resolve(null), timeoutMs)
            );

            const result = await Promise.race([llmPromise, timeoutPromise]);
            if (!result) {
                return { ...defaultAssessment, reason: 'Approved (Boss assessment timed out after 15s)' };
            }

            const content = result.content;

            // Parse verdict
            let verdict: BossCompletionAssessment['verdict'] = 'done';
            if (/VERDICT:\s*NEEDS_REWORK/i.test(content)) {
                verdict = 'needs_rework';
            } else if (/VERDICT:\s*ESCALATE/i.test(content)) {
                verdict = 'escalate_to_user';
            }

            const reasonMatch = content.match(/REASON:\s*(.+?)(?:\n|$)/i);
            const scoreMatch = content.match(/QUALITY_SCORE:\s*(\d+)/i);
            const reworkMatch = content.match(/REWORK_INSTRUCTIONS:\s*(.+?)(?:\n|$)/i);
            const escalateMatch = content.match(/ESCALATION_MESSAGE:\s*(.+?)(?:\n|$)/i);

            const assessment: BossCompletionAssessment = {
                verdict,
                reason: reasonMatch?.[1]?.trim() ?? (verdict === 'done' ? 'Work approved' : 'Issues found'),
                qualityScore: scoreMatch ? Math.min(100, Math.max(0, parseInt(scoreMatch[1], 10))) : 70,
            };

            if (verdict === 'needs_rework' && reworkMatch?.[1]?.trim()) {
                assessment.reworkInstructions = reworkMatch[1].trim();
            }

            if (verdict === 'escalate_to_user' && escalateMatch?.[1]?.trim()) {
                assessment.escalationMessage = escalateMatch[1].trim();
            }

            return assessment;
        } catch (err) {
            // LLM failure — approve by default to not block the pipeline
            return { ...defaultAssessment, reason: 'Approved (Boss assessment failed — fallback)' };
        }
    }
}
