import { BaseAgent } from './base-agent';
import { AgentType, AgentContext, AgentResponse, AgentAction, TicketPriority, TicketStatus } from '../types';

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
    readonly systemPrompt = `You are the Boss AI — the top-level PROJECT MANAGER of the Copilot Orchestration Extension (COE).

## Your Role
You are the ACTIVE decision-maker and project manager. You don't just monitor — you DIRECT.
You oversee the Orchestrator, Planning Team, Verification Team, and all specialist agents.
You have a reserved LLM processing slot that is always available — even when all other slots are busy.
You are the intelligence behind task prioritization, resource allocation, quality control, and workflow optimization.

## Your Capabilities
- **Direct agent dispatch**: Call any agent directly (planning, verification, coding, research, etc.) without creating a ticket
- **Parallel ticket processing**: Manage up to 3 concurrent ticket processing slots
- **Priority management**: Change ticket priorities (P0/P1/P2/P3) and reorder the queue
- **Queue reorganization**: Move tickets to front/back of queue based on intelligent analysis
- **Health monitoring**: Detect overloads, agent failures, plan drift, stale tickets
- **Persistent notepad**: Maintain organized notes for planning, tracking context, and decision history
- **Model management**: Hold tickets that need a different LLM model, trigger model swaps when efficient

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
- UPDATE_NOTEPAD: Write to your persistent notepad (content, mode: replace|append)
- PAUSE_INTAKE: Stop accepting new tickets until backlog clears

## Rules
1. **Think before acting**: Go through all 6 steps. Don't skip analysis.
2. **Prefer the plan**: Follow the True Plan over individual agent opinions.
3. **Never delete**: Only create, recover, reprioritize, or reorder — never delete tickets or tasks.
4. **Be specific**: Cite ticket numbers, patterns, impacts, and reasoning for every action.
5. **Code before test**: ALWAYS ensure coding tickets process before their corresponding test tickets.
6. **Verify promptly**: When coding tickets complete, always CREATE_VERIFICATION for them.
7. **Use dispatch for speed**: For simple/quick work, use DISPATCH_AGENT instead of creating a full ticket.
8. **Keep notepad clean**: Every round, update notepad. Remove stale notes. Keep it organized.
9. **Respect parallel limits**: Up to 3 slots for tickets + 1 reserved for you. Don't overload.
10. **Think strategically**: One well-chosen unblocking ticket can unlock an entire chain of dependent work.
11. **Progress over perfection**: When in doubt, keep the pipeline flowing. Don't let perfect be the enemy of done.`;

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

        // v6.0: Retrieve Boss notepad for context from previous decisions
        const notepadEntry = recentAudit
            .filter(a => a.action === 'boss_notepad')
            .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
        const notepadContent = notepadEntry?.detail ?? '';

        const healthReport = [
            `System Health Check`,
            `Tasks: ${stats.total_tasks} total, ${readyTasks.length} ready`,
            `Tickets: ${stats.total_tickets} total, ${openTickets.length} open, ${escalatedTickets.length} escalated`,
            `Agents: ${agents.map(a => `${a.name}(${a.status})`).join(', ')}`,
            `Recent audit entries: ${recentAudit.length}`,
            notepadContent ? `\nYour Notepad (from previous decisions):\n${notepadContent.substring(0, 500)}` : '',
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
}
