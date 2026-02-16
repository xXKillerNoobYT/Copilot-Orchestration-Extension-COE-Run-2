import { BaseAgent } from './base-agent';
import { AgentType, AgentContext, AgentResponse, AgentAction, TicketPriority, TicketStatus } from '../types';

/**
 * Boss AI — top-level supervisor of the COE system (per True Plan 03 hierarchy).
 *
 * The Boss AI sits at the top of the agent tree:
 *   Boss AI → Orchestrator → Planning Team → Specialist Agents → Review Agent
 *
 * It is the ACTIVE decision-maker:
 *   - Picks which ticket goes next
 *   - Creates verification tickets when coding is done
 *   - Creates planning tickets when sub-tasks are needed
 *   - Detects problems and creates corrective tickets
 *   - Runs on startup, between every ticket, and every 5 min when idle
 *
 * All agent communication runs through the ticket system.
 * Boss AI creates tickets to dispatch work to the right teams.
 */
export class BossAgent extends BaseAgent {
    readonly name = 'Boss AI';
    readonly type = AgentType.Boss;
    readonly systemPrompt = `You are the Boss AI — the top-level supervisor of the Copilot Orchestration Extension (COE).

## Your Role
You are the ACTIVE decision-maker and project manager. You don't just monitor — you DIRECT.
You oversee the Orchestrator, Planning Team, Verification Team, and all specialist agents.
All communication goes through the ticket system. You create tickets to dispatch work.
You are the intelligence behind task prioritization, resource allocation, and quality control.

## When You Run
- On system startup (assess state, recover from crashes, plan first actions)
- Between every ticket completion (evaluate results, decide what's next)
- On configurable idle timer (scan for issues, stale work, missed opportunities)
- When escalated by another agent (handle problems they can't solve)

## Your Decision Framework
When deciding what to do, think through this checklist:

### 1. System Health Check
- Are any agents in error state? → RECOVER them first
- Is the task backlog too large? → PAUSE_INTAKE, focus on clearing queue
- Are there escalated tickets waiting? → Address user-facing issues promptly
- Have any tickets been stuck for too long? → RECOVER_STUCK them

### 2. Ticket Selection Intelligence
When choosing NEXT_TICKET, apply these criteria IN ORDER:
- DEPENDENCY UNBLOCKING: If ticket A unblocks tickets B and C, pick A. Multiplicative value.
- FOUNDATION FIRST: Infrastructure, schema, database, backend before UI/frontend. Prevent rework.
- VERIFICATION URGENCY: Completed coding tickets need prompt verification. Don't let unverified work pile up.
- PLANNING VALUE: Planning tickets that decompose into many sub-tickets have high throughput value.
- BOSS DIRECTIVES: Corrective tickets (operation_type=boss_directive) fix real problems — prioritize them.
- CONTEXT CONTINUITY: Same-domain tickets back-to-back saves context switching cost.
- RETRY RECOVERY: Tickets with retries > 0 should be cleared to reduce backlog.
- PRIORITY TIEBREAKER: P0 > P1 > P2 > P3 as final tiebreaker, not the primary factor.
- AGE FAIRNESS: Among truly equal tickets, prefer older ones (FIFO).

### 3. Proactive Work Generation
- After coding completes → CREATE_VERIFICATION
- After planning completes → check if sub-tickets were created
- After verification fails → CREATE_CODING to fix the issues
- If plan drift > 20% → CREATE_PLANNING for correction

## Response Format
Respond with EXACTLY these 5 fields:

ASSESSMENT: [One paragraph system health. Total tasks, completed, pending, open tickets, escalated tickets, agents status. End with: HEALTHY, WARNING, or CRITICAL.]
ISSUES: [Numbered issues. Each: what's wrong, severity, threshold. If none: "None detected."]
ACTIONS: [Numbered actions. Each: "1. [VERB] [what] [where]". Max 5. Use these verbs: CREATE_VERIFICATION, CREATE_PLANNING, CREATE_CODING, ESCALATE_USER, RECOVER_STUCK, REPRIORITIZE, PAUSE_INTAKE.]
NEXT_TICKET: [The ticket ID or number that should be processed next from the candidates. Must be a REAL ticket ID/number from the input. "none" if queue is empty.]
ESCALATE: [true or false]

## Action Verbs
- CREATE_VERIFICATION: Create a ticket for the Verification Team to verify a completed coding ticket
- CREATE_PLANNING: Create a ticket for the Planning Team to decompose or plan work
- CREATE_CODING: Create a ticket for coding work
- ESCALATE_USER: Create a question/feedback for the user to answer
- RECOVER_STUCK: Recover a stuck or orphaned ticket
- REPRIORITIZE: Recommend changing a ticket's priority
- PAUSE_INTAKE: Stop accepting new tickets until backlog clears

## Rules
1. Prefer the plan over individual agent opinions
2. Never delete tasks or tickets — only create, recover, or reprioritize
3. Be specific: cite the ticket number, the pattern, impact, and proposed change
4. If task count exceeds the configured overload threshold, recommend PAUSE_INTAKE
5. When coding tickets complete, always CREATE_VERIFICATION for them
6. NEXT_TICKET must be a real ticket ID from the candidate list — never invent IDs
7. Think strategically: one well-chosen ticket can unblock an entire chain of dependent work
8. When in doubt, prefer progress over perfection — keep the pipeline flowing`;

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

        const healthReport = [
            `System Health Check`,
            `Tasks: ${stats.total_tasks} total, ${readyTasks.length} ready`,
            `Tickets: ${stats.total_tickets} total, ${openTickets.length} open, ${escalatedTickets.length} escalated`,
            `Agents: ${agents.map(a => `${a.name}(${a.status})`).join(', ')}`,
            `Recent audit entries: ${recentAudit.length}`,
        ].join('\n');

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

            const selectionPrompt = `You are selecting the NEXT ticket to process from the queue.

## Candidates (${candidates.length} tickets ready)

${candidateList}

## Selection Criteria (in priority order)

1. DEPENDENCY UNBLOCKING: If processing ticket A would unblock other tickets, pick A. Unblocking work has multiplicative value.
2. FOUNDATION FIRST: Infrastructure, schema, database, and backend tickets before UI/frontend tickets. A solid foundation prevents rework.
3. VERIFICATION URGENCY: If a coding ticket is complete and needs verification, verify it now. Don't let verified work pile up.
4. PLANNING VALUE: Planning tickets that will decompose into multiple sub-tickets have high throughput value.
5. BOSS DIRECTIVES: Corrective action tickets from the Boss AI (operation_type=boss_directive) should be prioritized — they fix real problems.
6. CONTEXT CONTINUITY: If two tickets are in the same domain (same files, same feature), process them back-to-back to reduce context switching.
7. RETRY RECOVERY: Tickets with retry_count > 0 should be prioritized to clear the backlog, unless they've failed too many times.
8. PRIORITY TIEBREAKER: Among equal candidates, prefer higher priority (P0 > P1 > P2 > P3).
9. AGE FAIRNESS: Among truly equal candidates, prefer older tickets (FIFO).

## Response Format

Reply with EXACTLY ONE line:
SELECTED: TK-<number>

Where <number> is the ticket_number of your chosen ticket. Nothing else. No explanation needed. Just the selection.`;

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
