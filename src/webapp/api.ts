import * as http from 'http';
import { Database } from '../core/database';
import { Orchestrator } from '../agents/orchestrator';
import { ConfigManager } from '../core/config';
import { getEventBus } from '../core/event-bus';
import { AgentContext, PlanStatus, TaskPriority, TicketPriority } from '../types';

// ==================== PAGINATION HELPERS ====================

interface PaginationParams {
    page: number;
    limit: number;
    search?: string;
    sort?: string;
    order: 'asc' | 'desc';
    status?: string;
    priority?: string;
}

function parsePagination(req: http.IncomingMessage): PaginationParams {
    const url = new URL(req.url || '', 'http://localhost');
    return {
        page: Math.max(1, parseInt(url.searchParams.get('page') || '1')),
        limit: Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50'))),
        search: url.searchParams.get('search') || undefined,
        sort: url.searchParams.get('sort') || undefined,
        order: (url.searchParams.get('order') === 'asc' ? 'asc' : 'desc'),
        status: url.searchParams.get('status') || undefined,
        priority: url.searchParams.get('priority') || undefined,
    };
}

function paginateAndFilter<T extends Record<string, unknown>>(items: T[], params: PaginationParams): { data: T[]; total: number; page: number; limit: number; totalPages: number } {
    let filtered = [...items];
    if (params.search) {
        const q = params.search.toLowerCase();
        filtered = filtered.filter(item => {
            return Object.values(item).some(v =>
                typeof v === 'string' && v.toLowerCase().includes(q)
            );
        });
    }
    if (params.status) {
        filtered = filtered.filter(item => (item as any).status === params.status);
    }
    if (params.priority) {
        filtered = filtered.filter(item => (item as any).priority === params.priority);
    }
    if (params.sort) {
        const field = params.sort;
        filtered.sort((a, b) => {
            const va = a[field] ?? '';
            const vb = b[field] ?? '';
            if (typeof va === 'number' && typeof vb === 'number') return params.order === 'asc' ? va - vb : vb - va;
            return params.order === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
        });
    }
    const total = filtered.length;
    const totalPages = Math.ceil(total / params.limit);
    const start = (params.page - 1) * params.limit;
    const data = filtered.slice(start, start + params.limit);
    return { data, total, page: params.page, limit: params.limit, totalPages };
}

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
    const route = pathname.slice(5); // strip \"/api/\"
    const eventBus = getEventBus();

    try {
        // ==================== SSE EVENT STREAM ====================
        if (route === 'events/stream' && method === 'GET') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            });
            const handler = (event: any) => {
                res.write('data: ' + JSON.stringify(event) + '\n\n');
            };
            eventBus.on('*', handler);
            req.on('close', () => {
                eventBus.off('*', handler);
            });
            return true;
        }

        // ==================== EVENT HISTORY ====================
        if (route === 'events/history' && method === 'GET') {
            json(res, eventBus.getHistory(100));
            return true;
        }

        // ==================== EVENT METRICS ====================
        if (route === 'events/metrics' && method === 'GET') {
            json(res, eventBus.getMetrics());
            return true;
        }
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
            const params = parsePagination(req);
            const allTasks = database.getAllTasks() as unknown as Record<string, unknown>[];
            json(res, paginateAndFilter(allTasks, params));
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
                parent_task_id: (body.parent_task_id as string) || undefined,
                sort_order: (body.sort_order as number) || 0,
                dependencies: (body.dependencies as string[]) || [],
            });
            eventBus.emit('task:created', 'webapp', { taskId: task.id, title: task.title });
            database.addAuditLog('webapp', 'task_created', `Task "${task.title}" created via web app`);
            json(res, task, 201);
            return true;
        }

        if (route === 'tasks/reorder' && method === 'POST') {
            const body = await parseBody(req);
            const orders = body.orders as Array<{ id: string; sort_order: number; parent_task_id?: string | null }>;
            if (!Array.isArray(orders)) {
                json(res, { error: 'orders must be an array' }, 400);
                return true;
            }
            database.reorderTasks(orders);
            eventBus.emit('task:reordered', 'webapp', { count: orders.length });
            database.addAuditLog('webapp', 'tasks_reordered', `${orders.length} tasks reordered via drag & drop`);
            json(res, { success: true });
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
            eventBus.emit('task:updated', 'webapp', { taskId: taskId, title: updated.title });
            database.addAuditLog('webapp', 'task_updated', `Task "${updated.title}" updated via web app`);
            json(res, updated);
            return true;
        }
        if (taskId && method === 'DELETE') {
            const deleted = database.deleteTask(taskId);
            if (!deleted) { json(res, { error: 'Task not found' }, 404); return true; }
            eventBus.emit('task:deleted', 'webapp', { taskId: taskId });
            json(res, { success: true });
            return true;
        }

        // ==================== TICKETS ====================
        if (route === 'tickets' && method === 'GET') {
            const params = parsePagination(req);
            const allTickets = database.getAllTickets() as unknown as Record<string, unknown>[];
            json(res, paginateAndFilter(allTickets, params));
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
            eventBus.emit('ticket:created', 'webapp', { ticketId: ticket.id, ticketNumber: ticket.ticket_number });
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
            eventBus.emit('ticket:replied', 'webapp', { ticketId: replyTicketId, replyId: reply.id });
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
            eventBus.emit('ticket:updated', 'webapp', { ticketId: ticketId, ticketNumber: updated.ticket_number });
            database.addAuditLog('webapp', 'ticket_updated', `Ticket TK-${updated.ticket_number} updated via web app`);
            json(res, updated);
            return true;
        }

        // ==================== PLANS ====================
        if (route === 'plans' && method === 'GET') {
            const params = parsePagination(req);
            const allPlans = database.getAllPlans() as unknown as Record<string, unknown>[];
            json(res, paginateAndFilter(allPlans, params));
            return true;
        }

        if (route === 'plans/generate' && method === 'POST') {
            const body = await parseBody(req);
            const name = body.name as string;
            const description = body.description as string;
            const scale = (body.scale as string) || 'MVP';
            const focus = (body.focus as string) || 'Full Stack';
            const priorities = (body.priorities as string[]) || ['Core business logic'];
            const design = (body.design as Record<string, string>) || {};

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
                        const plan = database.createPlan(name, JSON.stringify({ scale, focus, priorities, design }));
                        database.updatePlan(plan.id, { status: PlanStatus.Active });

                        const titleToId: Record<string, string> = {};
                        let sortIdx = 0;
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
                                sort_order: sortIdx * 10,
                            });
                            titleToId[t.title] = task.id;
                            sortIdx++;
                        }

                        eventBus.emit('plan:created', 'webapp', { planId: plan.id, name: plan.name });
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
            eventBus.emit('plan:updated', 'webapp', { planId: planId, name: updated.name });
            json(res, updated);
            return true;
        }

        // ==================== AGENTS ====================
        if (route === 'agents' && method === 'GET') {
            const params = parsePagination(req);
            const allAgents = database.getAllAgents() as unknown as Record<string, unknown>[];
            json(res, paginateAndFilter(allAgents, params));
            return true;
        }

        // ==================== AUDIT LOG ====================
        if (route === 'audit' && method === 'GET') {
            const params = parsePagination(req);
            const allAudit = database.getAuditLog(100) as unknown as Record<string, unknown>[];
            json(res, paginateAndFilter(allAudit, params));
            return true;
        }

        // ==================== EVOLUTION ====================
        if (route === 'evolution' && method === 'GET') {
            const params = parsePagination(req);
            const allEvolution = database.getEvolutionLog(50) as unknown as Record<string, unknown>[];
            json(res, paginateAndFilter(allEvolution, params));
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
            eventBus.emit('verification:approved', 'webapp', { taskId: approveTaskId });
            database.addAuditLog('webapp', 'verification_approved', `Task ${approveTaskId} approved via web app`);
            json(res, { success: true });
            return true;
        }

        const rejectTaskId = extractParam(route, 'verification/:id/reject');
        if (rejectTaskId && method === 'POST') {
            const body = await parseBody(req);
            database.updateTask(rejectTaskId, { status: 'failed' as any });
            const reason = (body.reason as string) || 'Rejected via web app';
            eventBus.emit('verification:rejected', 'webapp', { taskId: rejectTaskId, reason });
            database.addAuditLog('webapp', 'verification_rejected', `Task ${rejectTaskId}: ${reason}`);
            // Create follow-up task
            const task = database.getTask(rejectTaskId);
            if (task) {
                const fixTask = database.createTask({
                    title: `Fix: ${task.title}`,
                    description: `Verification rejected: ${reason}`,
                    priority: task.priority,
                    plan_id: task.plan_id || undefined,
                    dependencies: [rejectTaskId],
                });
                eventBus.emit('task:created', 'webapp', { taskId: fixTask.id, title: fixTask.title });
            }
            json(res, { success: true });
            return true;
        }

        // ==================== GITHUB ISSUES ====================
        if (route === 'github/issues' && method === 'GET') {
            json(res, database.getAllGitHubIssues());
            return true;
        }

        const ghIssueId = extractParam(route, 'github/issues/:id');
        if (ghIssueId && method === 'GET') {
            const issue = database.getGitHubIssue(ghIssueId);
            if (!issue) { json(res, { error: 'GitHub issue not found' }, 404); return true; }
            json(res, issue);
            return true;
        }

        if (ghIssueId && method === 'POST' && route.endsWith('/convert')) {
            // Convert GitHub issue to local task
            const convertId = extractParam(route, 'github/issues/:id/convert');
            if (convertId) {
                // Need to import the sync service inline
                const { GitHubClient } = await import('../core/github-client');
                const { GitHubSyncService } = await import('../core/github-sync');
                const ghConfig = config.getConfig().github;
                if (!ghConfig?.token) {
                    json(res, { error: 'GitHub not configured' }, 400);
                    return true;
                }
                const client = new GitHubClient(ghConfig.token, { appendLine: () => {} } as any);
                const syncService = new GitHubSyncService(client, database, config, { appendLine: () => {} } as any);
                const taskId = syncService.convertIssueToTask(convertId);
                if (taskId) {
                    eventBus.emit('task:created', 'webapp', { taskId, source: 'github_issue', issueId: convertId });
                    json(res, { success: true, task_id: taskId });
                } else {
                    json(res, { error: 'Failed to convert issue' }, 400);
                }
                return true;
            }
        }

        // ==================== CONFIG ====================
        if (route === 'config' && method === 'GET') {
            json(res, config.getConfig());
            return true;
        }

        if (route === 'config' && method === 'PUT') {
            const body = await parseBody(req);
            // Update specific config sections
            const currentConfig = config.getConfig();
            const merged = { ...currentConfig, ...body };
            config.updateConfig(merged as any);
            eventBus.emit('system:config_updated', 'webapp', { updatedKeys: Object.keys(body) });
            database.addAuditLog('webapp', 'config_updated', 'Configuration updated via Settings tab');
            json(res, config.getConfig());
            return true;
        }

        // ==================== DESIGN PAGES ====================
        if (route === 'design/pages' && method === 'GET') {
            const planId = new URL(req.url || '', 'http://localhost').searchParams.get('plan_id');
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            json(res, database.getDesignPagesByPlan(planId));
            return true;
        }

        if (route === 'design/pages' && method === 'POST') {
            const body = await parseBody(req);
            const page = database.createDesignPage({
                plan_id: body.plan_id as string,
                name: (body.name as string) || 'Untitled Page',
                route: (body.route as string) || '/',
                sort_order: (body.sort_order as number) || 0,
                width: (body.width as number) || 1440,
                height: (body.height as number) || 900,
                background: (body.background as string) || '#1e1e2e',
            });
            eventBus.emit('design:page_created', 'webapp', { pageId: page.id, name: page.name });
            database.addAuditLog('webapp', 'design_page_created', `Page "${page.name}" created`);
            json(res, page, 201);
            return true;
        }

        const designPageId = extractParam(route, 'design/pages/:id');
        if (designPageId && method === 'PUT') {
            const body = await parseBody(req);
            const updated = database.updateDesignPage(designPageId, body as any);
            eventBus.emit('design:page_updated', 'webapp', { pageId: designPageId });
            json(res, updated);
            return true;
        }
        if (designPageId && method === 'DELETE') {
            database.deleteDesignPage(designPageId);
            eventBus.emit('design:page_deleted', 'webapp', { pageId: designPageId });
            json(res, { success: true });
            return true;
        }

        // ==================== DESIGN COMPONENTS ====================
        if (route === 'design/components' && method === 'GET') {
            const url = new URL(req.url || '', 'http://localhost');
            const pageId = url.searchParams.get('page_id');
            const planId = url.searchParams.get('plan_id');
            if (pageId) {
                json(res, database.getDesignComponentsByPage(pageId));
            } else if (planId) {
                json(res, database.getDesignComponentsByPlan(planId));
            } else {
                json(res, { error: 'page_id or plan_id required' }, 400);
            }
            return true;
        }

        if (route === 'design/components' && method === 'POST') {
            const body = await parseBody(req);
            const comp = database.createDesignComponent({
                plan_id: body.plan_id as string,
                page_id: (body.page_id as string) || undefined,
                type: (body.type as string) || 'container',
                name: (body.name as string) || 'Component',
                parent_id: (body.parent_id as string) || undefined,
                sort_order: (body.sort_order as number) || 0,
                x: (body.x as number) || 0,
                y: (body.y as number) || 0,
                width: (body.width as number) || 200,
                height: (body.height as number) || 100,
                styles: (body.styles as Record<string, unknown>) || {},
                content: (body.content as string) || '',
                props: (body.props as Record<string, unknown>) || {},
            } as any);
            eventBus.emit('design:component_created', 'webapp', { componentId: comp.id, name: comp.name });
            json(res, comp, 201);
            return true;
        }

        if (route === 'design/components/batch' && method === 'PUT') {
            const body = await parseBody(req);
            const updates = body.updates as Array<{ id: string; x?: number; y?: number; width?: number; height?: number; sort_order?: number; parent_id?: string | null }>;
            if (!Array.isArray(updates)) { json(res, { error: 'updates must be an array' }, 400); return true; }
            database.batchUpdateComponents(updates);
            eventBus.emit('design:component_updated', 'webapp', { batchCount: updates.length });
            json(res, { success: true });
            return true;
        }

        const compId = extractParam(route, 'design/components/:id');
        if (compId && method === 'GET') {
            const comp = database.getDesignComponent(compId);
            if (!comp) { json(res, { error: 'Component not found' }, 404); return true; }
            json(res, comp);
            return true;
        }
        if (compId && method === 'PUT') {
            const body = await parseBody(req);
            const updated = database.updateDesignComponent(compId, body as Record<string, unknown>);
            eventBus.emit('design:component_updated', 'webapp', { componentId: compId });
            json(res, updated);
            return true;
        }
        if (compId && method === 'DELETE') {
            database.deleteDesignComponent(compId);
            eventBus.emit('design:component_deleted', 'webapp', { componentId: compId });
            json(res, { success: true });
            return true;
        }

        // ==================== DESIGN TOKENS ====================
        if (route === 'design/tokens' && method === 'GET') {
            const planId = new URL(req.url || '', 'http://localhost').searchParams.get('plan_id');
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            json(res, database.getDesignTokensByPlan(planId));
            return true;
        }

        if (route === 'design/tokens' && method === 'POST') {
            const body = await parseBody(req);
            const token = database.createDesignToken({
                plan_id: body.plan_id as string,
                category: (body.category as string) as any || 'color',
                name: body.name as string,
                value: body.value as string,
                description: (body.description as string) || '',
            });
            eventBus.emit('design:token_created', 'webapp', { tokenId: token.id, name: token.name });
            json(res, token, 201);
            return true;
        }

        const tokenId = extractParam(route, 'design/tokens/:id');
        if (tokenId && method === 'PUT') {
            const body = await parseBody(req);
            database.updateDesignToken(tokenId, body as any);
            json(res, { success: true });
            return true;
        }
        if (tokenId && method === 'DELETE') {
            database.deleteDesignToken(tokenId);
            eventBus.emit('design:token_deleted', 'webapp', { tokenId: tokenId });
            json(res, { success: true });
            return true;
        }

        // ==================== PAGE FLOWS ====================
        if (route === 'design/flows' && method === 'GET') {
            const planId = new URL(req.url || '', 'http://localhost').searchParams.get('plan_id');
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            json(res, database.getPageFlowsByPlan(planId));
            return true;
        }

        if (route === 'design/flows' && method === 'POST') {
            const body = await parseBody(req);
            const flow = database.createPageFlow({
                plan_id: body.plan_id as string,
                from_page_id: body.from_page_id as string,
                to_page_id: body.to_page_id as string,
                trigger: (body.trigger as string) || 'click',
                label: (body.label as string) || '',
            });
            eventBus.emit('design:flow_created', 'webapp', { flowId: flow.id });
            json(res, flow, 201);
            return true;
        }

        const flowId = extractParam(route, 'design/flows/:id');
        if (flowId && method === 'DELETE') {
            database.deletePageFlow(flowId);
            eventBus.emit('design:flow_deleted', 'webapp', { flowId: flowId });
            json(res, { success: true });
            return true;
        }

        // ==================== CODING SESSIONS ====================
        if (route === 'coding/sessions' && method === 'GET') {
            const params = parsePagination(req);
            const allSessions = database.getAllCodingSessions() as unknown as Record<string, unknown>[];
            json(res, paginateAndFilter(allSessions, params));
            return true;
        }

        if (route === 'coding/sessions' && method === 'POST') {
            const body = await parseBody(req);
            const session = database.createCodingSession({
                plan_id: (body.plan_id as string) || undefined,
                name: (body.name as string) || 'Coding Session',
            });
            eventBus.emit('coding:session_created', 'webapp', { sessionId: session.id, name: session.name });
            database.addAuditLog('webapp', 'coding_session_created', `Session "${session.name}" created`);
            json(res, session, 201);
            return true;
        }

        const sessionId = extractParam(route, 'coding/sessions/:id');
        if (sessionId && method === 'GET') {
            const session = database.getCodingSession(sessionId);
            if (!session) { json(res, { error: 'Session not found' }, 404); return true; }
            const messages = database.getCodingMessages(sessionId);
            json(res, { ...session, messages });
            return true;
        }
        if (sessionId && method === 'PUT') {
            const body = await parseBody(req);
            database.updateCodingSession(sessionId, body as any);
            eventBus.emit('coding:session_completed', 'webapp', { sessionId: sessionId });
            json(res, { success: true });
            return true;
        }

        // ==================== CODING MESSAGES ====================
        const msgSessionId = extractParam(route, 'coding/messages/:id');
        if (route === 'coding/messages' && method === 'POST') {
            const body = await parseBody(req);
            const msg = database.addCodingMessage({
                session_id: body.session_id as string,
                role: (body.role as string) || 'user',
                content: body.content as string,
                tool_calls: (body.tool_calls as string) || undefined,
                task_id: (body.task_id as string) || undefined,
            });
            eventBus.emit('coding:message_sent', 'webapp', { messageId: msg.id, sessionId: body.session_id as string });
            json(res, msg, 201);
            return true;
        }

        if (msgSessionId && method === 'GET') {
            const messages = database.getCodingMessages(msgSessionId);
            json(res, messages);
            return true;
        }

        // ==================== DESIGN SPEC EXPORT ====================
        if (route === 'design/export' && method === 'POST') {
            const body = await parseBody(req);
            const planId = body.plan_id as string;
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const plan = database.getPlan(planId);
            const pages = database.getDesignPagesByPlan(planId);
            const tokens = database.getDesignTokensByPlan(planId);
            const flows = database.getPageFlowsByPlan(planId);
            const allComponents: Record<string, unknown[]> = {};
            for (const page of pages) {
                allComponents[page.id] = database.getDesignComponentsByPage(page.id);
            }
            const spec = {
                plan: plan,
                pages: pages.map(p => ({
                    ...p,
                    components: allComponents[p.id] || [],
                })),
                tokens,
                flows,
                generated_at: new Date().toISOString(),
            };
            json(res, spec);
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
