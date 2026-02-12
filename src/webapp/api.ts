import * as http from 'http';
import { Database } from '../core/database';
import { Orchestrator } from '../agents/orchestrator';
import { ConfigManager } from '../core/config';
import { AgentContext, PlanStatus, TaskPriority, TicketPriority } from '../types';

function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk: string) => { body += chunk; });
        req.on('end', () => {
            try { resolve(body ? JSON.parse(body) : {}); }
            catch { reject(new Error('Invalid JSON')); }
        });
        req.on('error', reject);
    });
}

function json(res: http.ServerResponse, data: unknown, status = 200): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function extractParam(route: string, pattern: string): string | null {
    // Simple pattern matching: "tasks/:id" matches "tasks/abc-123"
    const routeParts = route.split('/');
    const patternParts = pattern.split('/');
    if (routeParts.length !== patternParts.length) return null;
    for (let i = 0; i < patternParts.length; i++) {
        if (patternParts[i].startsWith(':')) continue;
        if (routeParts[i] !== patternParts[i]) return null;
    }
    const paramIdx = patternParts.findIndex(p => p.startsWith(':'));
    return paramIdx >= 0 ? routeParts[paramIdx] : null;
}

export async function handleApiRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    database: Database,
    orchestrator: Orchestrator,
    config: ConfigManager
): Promise<boolean> {
    if (!pathname.startsWith('/api/')) return false;

    const method = req.method || 'GET';
    const route = pathname.slice(5); // strip "/api/"

    try {
        // ==================== DASHBOARD ====================
        if (route === 'dashboard' && method === 'GET') {
            const stats = database.getStats();
            const plan = database.getActivePlan();
            const agents = database.getAllAgents();
            const recentAudit = database.getAuditLog(15);
            let planProgress = null;
            if (plan) {
                const tasks = database.getTasksByPlan(plan.id);
                planProgress = {
                    total: tasks.length,
                    verified: tasks.filter(t => t.status === 'verified').length,
                    in_progress: tasks.filter(t => t.status === 'in_progress').length,
                    failed: tasks.filter(t => t.status === 'failed').length,
                    not_started: tasks.filter(t => t.status === 'not_started').length,
                    blocked: tasks.filter(t => t.status === 'blocked').length,
                    pending_verification: tasks.filter(t => t.status === 'pending_verification').length,
                };
            }
            json(res, { stats, plan, planProgress, agents, recentAudit });
            return true;
        }

        // ==================== TASKS ====================
        if (route === 'tasks' && method === 'GET') {
            json(res, database.getAllTasks());
            return true;
        }

        if (route === 'tasks' && method === 'POST') {
            const body = await parseBody(req);
            const task = database.createTask({
                title: body.title as string,
                description: (body.description as string) || '',
                priority: (body.priority as TaskPriority) || TaskPriority.P2,
                estimated_minutes: (body.estimated_minutes as number) || 30,
                acceptance_criteria: (body.acceptance_criteria as string) || '',
                plan_id: (body.plan_id as string) || undefined,
                dependencies: (body.dependencies as string[]) || [],
            });
            database.addAuditLog('webapp', 'task_created', `Task "${task.title}" created via web app`);
            json(res, task, 201);
            return true;
        }

        if (route === 'tasks/ready' && method === 'GET') {
            json(res, database.getReadyTasks());
            return true;
        }

        // Single task operations
        const taskId = extractParam(route, 'tasks/:id');
        if (taskId && method === 'GET') {
            const task = database.getTask(taskId);
            if (!task) { json(res, { error: 'Task not found' }, 404); return true; }
            const verification = database.getVerificationResult(taskId);
            const conversations = database.getConversationsByTask(taskId);
            json(res, { ...task, verification, conversations });
            return true;
        }
        if (taskId && method === 'PUT') {
            const body = await parseBody(req);
            const updated = database.updateTask(taskId, body as any);
            if (!updated) { json(res, { error: 'Task not found' }, 404); return true; }
            database.addAuditLog('webapp', 'task_updated', `Task "${updated.title}" updated via web app`);
            json(res, updated);
            return true;
        }
        if (taskId && method === 'DELETE') {
            const deleted = database.deleteTask(taskId);
            if (!deleted) { json(res, { error: 'Task not found' }, 404); return true; }
            json(res, { success: true });
            return true;
        }

        // ==================== TICKETS ====================
        if (route === 'tickets' && method === 'GET') {
            json(res, database.getAllTickets());
            return true;
        }

        if (route === 'tickets' && method === 'POST') {
            const body = await parseBody(req);
            const ticket = database.createTicket({
                title: body.title as string,
                body: (body.body as string) || '',
                priority: (body.priority as TicketPriority) || TicketPriority.P2,
                creator: (body.creator as string) || 'user',
            });
            database.addAuditLog('webapp', 'ticket_created', `Ticket TK-${ticket.ticket_number} created via web app`);
            json(res, ticket, 201);
            return true;
        }

        // Ticket replies
        const replyTicketId = extractParam(route, 'tickets/:id/replies');
        if (replyTicketId && method === 'GET') {
            json(res, database.getTicketReplies(replyTicketId));
            return true;
        }
        if (replyTicketId && method === 'POST') {
            const body = await parseBody(req);
            const reply = database.addTicketReply(
                replyTicketId,
                (body.author as string) || 'user',
                body.body as string,
                body.clarity_score as number | undefined
            );
            json(res, reply, 201);
            return true;
        }

        // Single ticket operations
        const ticketId = extractParam(route, 'tickets/:id');
        if (ticketId && !route.includes('/replies') && method === 'GET') {
            const ticket = database.getTicket(ticketId);
            if (!ticket) { json(res, { error: 'Ticket not found' }, 404); return true; }
            const replies = database.getTicketReplies(ticketId);
            json(res, { ...ticket, replies });
            return true;
        }
        if (ticketId && !route.includes('/replies') && method === 'PUT') {
            const body = await parseBody(req);
            const updated = database.updateTicket(ticketId, body as any);
            if (!updated) { json(res, { error: 'Ticket not found' }, 404); return true; }
            database.addAuditLog('webapp', 'ticket_updated', `Ticket TK-${updated.ticket_number} updated via web app`);
            json(res, updated);
            return true;
        }

        // ==================== PLANS ====================
        if (route === 'plans' && method === 'GET') {
            json(res, database.getAllPlans());
            return true;
        }

        if (route === 'plans/generate' && method === 'POST') {
            const body = await parseBody(req);
            const name = body.name as string;
            const description = body.description as string;
            const scale = (body.scale as string) || 'MVP';
            const focus = (body.focus as string) || 'Full Stack';
            const priorities = (body.priorities as string[]) || ['Core business logic'];

            const prompt = [
                `Create a structured development plan called "${name}".`,
                `Project Scale: ${scale}`,
                `Primary Focus: ${focus}`,
                `Key Priorities: ${priorities.join(', ')}`,
                `Description: ${description}`,
                '',
                'Generate atomic tasks (15-45 min each) with:',
                '- Clear title and description',
                '- Acceptance criteria',
                '- Priority (P1 = critical, P2 = important, P3 = nice-to-have)',
                '- Dependencies (which tasks must complete first)',
                '- Estimated minutes',
                '',
                'Return as JSON: { "plan_name": "...", "tasks": [{ "title": "...", "description": "...", "priority": "P1|P2|P3", "estimated_minutes": N, "acceptance_criteria": "...", "depends_on_titles": [] }] }',
            ].join('\n');

            const ctx: AgentContext = { conversationHistory: [] };
            const response = await orchestrator.callAgent('planning', prompt, ctx);

            // Try to parse structured response
            try {
                const jsonMatch = response.content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    if (parsed.tasks && Array.isArray(parsed.tasks)) {
                        const plan = database.createPlan(name, JSON.stringify({ scale, focus, priorities }));
                        database.updatePlan(plan.id, { status: PlanStatus.Active });

                        const titleToId: Record<string, string> = {};
                        for (const t of parsed.tasks) {
                            const deps = (t.depends_on_titles || [])
                                .map((title: string) => titleToId[title])
                                .filter(Boolean);
                            const task = database.createTask({
                                title: t.title,
                                description: t.description || '',
                                priority: (['P1', 'P2', 'P3'].includes(t.priority) ? t.priority : 'P2') as TaskPriority,
                                estimated_minutes: t.estimated_minutes || 30,
                                acceptance_criteria: t.acceptance_criteria || '',
                                plan_id: plan.id,
                                dependencies: deps,
                            });
                            titleToId[t.title] = task.id;
                        }

                        database.addAuditLog('planning', 'plan_created', `Plan "${name}": ${parsed.tasks.length} tasks`);
                        json(res, { plan, taskCount: parsed.tasks.length, tasks: database.getTasksByPlan(plan.id) }, 201);
                        return true;
                    }
                }
            } catch { /* fall through */ }

            // Raw response if structured parsing failed
            json(res, { raw_response: response.content });
            return true;
        }

        // Single plan operations
        const planId = extractParam(route, 'plans/:id');
        if (planId && method === 'GET') {
            const plan = database.getPlan(planId);
            if (!plan) { json(res, { error: 'Plan not found' }, 404); return true; }
            const tasks = database.getTasksByPlan(planId);
            json(res, { ...plan, tasks });
            return true;
        }
        if (planId && method === 'PUT') {
            const body = await parseBody(req);
            const updated = database.updatePlan(planId, body as any);
            if (!updated) { json(res, { error: 'Plan not found' }, 404); return true; }
            json(res, updated);
            return true;
        }

        // ==================== AGENTS ====================
        if (route === 'agents' && method === 'GET') {
            json(res, database.getAllAgents());
            return true;
        }

        // ==================== AUDIT LOG ====================
        if (route === 'audit' && method === 'GET') {
            json(res, database.getAuditLog(100));
            return true;
        }

        // ==================== EVOLUTION ====================
        if (route === 'evolution' && method === 'GET') {
            json(res, database.getEvolutionLog(50));
            return true;
        }

        // ==================== VERIFICATION ====================
        const verTaskId = extractParam(route, 'verification/:id');
        if (verTaskId && method === 'GET') {
            const result = database.getVerificationResult(verTaskId);
            json(res, result || { status: 'none' });
            return true;
        }

        const approveTaskId = extractParam(route, 'verification/:id/approve');
        if (approveTaskId && method === 'POST') {
            database.updateTask(approveTaskId, { status: 'verified' as any });
            database.addAuditLog('webapp', 'verification_approved', `Task ${approveTaskId} approved via web app`);
            json(res, { success: true });
            return true;
        }

        const rejectTaskId = extractParam(route, 'verification/:id/reject');
        if (rejectTaskId && method === 'POST') {
            const body = await parseBody(req);
            database.updateTask(rejectTaskId, { status: 'failed' as any });
            const reason = (body.reason as string) || 'Rejected via web app';
            database.addAuditLog('webapp', 'verification_rejected', `Task ${rejectTaskId}: ${reason}`);
            // Create follow-up task
            const task = database.getTask(rejectTaskId);
            if (task) {
                database.createTask({
                    title: `Fix: ${task.title}`,
                    description: `Verification rejected: ${reason}`,
                    priority: task.priority,
                    plan_id: task.plan_id || undefined,
                    dependencies: [rejectTaskId],
                });
            }
            json(res, { success: true });
            return true;
        }

        // ==================== CONFIG ====================
        if (route === 'config' && method === 'GET') {
            json(res, config.getConfig());
            return true;
        }

        // Not found
        json(res, { error: 'API route not found: ' + route }, 404);
        return true;

    } catch (err) {
        json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
        return true;
    }
}
