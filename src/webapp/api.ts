import * as http from 'http';
import { Database } from '../core/database';
import { Orchestrator } from '../agents/orchestrator';
import { ConfigManager } from '../core/config';
import { CodingAgentService } from '../core/coding-agent';
import { getEventBus } from '../core/event-bus';
import { AgentContext, DesignComponent, PlanStatus, TaskPriority, TicketPriority } from '../types';

/** Shared no-op output channel for inline service construction */
export const noopOutputChannel = { appendLine(_msg: string) {} } as any;

// ==================== AUTO-TICKET HELPERS ====================

/** Determines if a ticket should be created for this operation type at the given AI level */
function shouldCreateTicket(operationType: string, aiLevel: string): boolean {
    const majorOps = ['plan_generation', 'coding_session'];
    const mediumOps = ['design_change', 'suggestion'];
    // Manual: only major ops
    if (aiLevel === 'manual') return majorOps.includes(operationType);
    // Suggestions: major + medium
    if (aiLevel === 'suggestions') return majorOps.includes(operationType) || mediumOps.includes(operationType);
    // Smart/Hybrid: everything
    return true;
}

/** Creates an auto-ticket if the AI level permits it */
function createAutoTicket(
    database: Database,
    operationType: string,
    title: string,
    body: string,
    priority: string,
    aiLevel: string,
    parentTicketId?: string | null
): { id: string; ticket_number: number } | null {
    if (!shouldCreateTicket(operationType, aiLevel)) return null;
    const ticket = database.createTicket({
        title,
        body,
        priority: priority as any,
        creator: 'system',
        parent_ticket_id: parentTicketId ?? null,
        auto_created: true,
        operation_type: operationType,
    });
    return ticket;
}

/**
 * Determines whether an action should auto-apply based on AI level and priority.
 * - Manual: never auto-apply
 * - Suggestions: never auto-apply (show suggestions only)
 * - Smart: auto-apply safe changes (P3/P4), ask for P1/P2
 * - Hybrid: auto-apply P3/P4, suggest P1/P2
 */
function shouldAutoApply(aiLevel: string, priority: string): boolean {
    if (aiLevel === 'manual' || aiLevel === 'suggestions') return false;
    // Smart and Hybrid: auto-apply low-priority (safe) changes
    const safePriorities = ['P3', 'P4', 'p3', 'p4'];
    return safePriorities.includes(priority);
}

/**
 * Determines if AI should respond to user messages at a given level.
 * - Manual: no AI response (store message only)
 * - Suggestions/Smart/Hybrid: respond
 */
function shouldAiRespond(aiLevel: string): boolean {
    return aiLevel !== 'manual';
}

/**
 * Determines the response style for a given AI level.
 * Returns instruction modifiers for the AI prompt.
 */
function getAiResponseStyle(aiLevel: string): string {
    switch (aiLevel) {
        case 'manual': return '';
        case 'suggestions': return 'Provide suggestions and recommendations. Do NOT auto-apply changes. Ask for user confirmation before any actions.';
        case 'smart': return 'For low-priority (P3/P4) changes, apply automatically. For high-priority (P1/P2) changes, explain and ask for confirmation. Proactively suggest improvements.';
        case 'hybrid': return 'Automatically handle routine P3/P4 tasks. For P1/P2 decisions, present options and ask. Be proactive about suggesting improvements and optimizations.';
        default: return 'Provide suggestions and recommendations.';
    }
}

/** Read the AI level from a plan's config_json */
function getPlanAiLevel(database: Database, planId: string): string {
    try {
        const plan = database.getPlan(planId);
        if (plan) {
            const config = JSON.parse(plan.config_json || '{}');
            return (config.design?.aiLevel as string) || (config.aiLevel as string) || 'suggestions';
        }
    } catch { /* ignore */ }
    return 'suggestions';
}

// ==================== DESIGN DIFF HELPERS ====================

interface DesignDiffEntry {
    type: 'added' | 'modified' | 'deleted';
    entity_type: 'page' | 'component' | 'token';
    entity_id: string;
    description: string;
}

function calculateDesignDiff(oldSnapshot: any, newSnapshot: any): DesignDiffEntry[] {
    const diff: DesignDiffEntry[] = [];

    const oldPages: any[] = oldSnapshot.pages || [];
    const newPages: any[] = newSnapshot.pages || [];
    const oldComponents: any[] = oldSnapshot.components || [];
    const newComponents: any[] = newSnapshot.components || [];
    const oldTokens: any[] = oldSnapshot.tokens || [];
    const newTokens: any[] = newSnapshot.tokens || [];

    // Pages diff
    const oldPageIds = new Set(oldPages.map((p: any) => p.id));
    const newPageIds = new Set(newPages.map((p: any) => p.id));
    for (const page of newPages) {
        if (!oldPageIds.has(page.id)) {
            diff.push({ type: 'added', entity_type: 'page', entity_id: page.id, description: `Page added: ${page.name || page.id}` });
        } else {
            const oldPage = oldPages.find((p: any) => p.id === page.id);
            if (oldPage && JSON.stringify(oldPage) !== JSON.stringify(page)) {
                diff.push({ type: 'modified', entity_type: 'page', entity_id: page.id, description: `Page modified: ${page.name || page.id}` });
            }
        }
    }
    for (const page of oldPages) {
        if (!newPageIds.has(page.id)) {
            diff.push({ type: 'deleted', entity_type: 'page', entity_id: page.id, description: `Page deleted: ${page.name || page.id}` });
        }
    }

    // Components diff
    const oldCompIds = new Set(oldComponents.map((c: any) => c.id));
    const newCompIds = new Set(newComponents.map((c: any) => c.id));
    for (const comp of newComponents) {
        if (!oldCompIds.has(comp.id)) {
            diff.push({ type: 'added', entity_type: 'component', entity_id: comp.id, description: `Component added: ${comp.type || comp.id}` });
        } else {
            const oldComp = oldComponents.find((c: any) => c.id === comp.id);
            if (oldComp && JSON.stringify(oldComp) !== JSON.stringify(comp)) {
                diff.push({ type: 'modified', entity_type: 'component', entity_id: comp.id, description: `Component modified: ${comp.type || comp.id}` });
            }
        }
    }
    for (const comp of oldComponents) {
        if (!newCompIds.has(comp.id)) {
            diff.push({ type: 'deleted', entity_type: 'component', entity_id: comp.id, description: `Component deleted: ${comp.type || comp.id}` });
        }
    }

    // Tokens diff
    const oldTokenIds = new Set(oldTokens.map((t: any) => t.id));
    const newTokenIds = new Set(newTokens.map((t: any) => t.id));
    for (const token of newTokens) {
        if (!oldTokenIds.has(token.id)) {
            diff.push({ type: 'added', entity_type: 'token', entity_id: token.id, description: `Token added: ${token.name || token.id}` });
        } else {
            const oldToken = oldTokens.find((t: any) => t.id === token.id);
            if (oldToken && JSON.stringify(oldToken) !== JSON.stringify(token)) {
                diff.push({ type: 'modified', entity_type: 'token', entity_id: token.id, description: `Token modified: ${token.name || token.id}` });
            }
        }
    }
    for (const token of oldTokens) {
        if (!newTokenIds.has(token.id)) {
            diff.push({ type: 'deleted', entity_type: 'token', entity_id: token.id, description: `Token deleted: ${token.name || token.id}` });
        }
    }

    return diff;
}

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
        page: Math.max(1, parseInt(url.searchParams.get('page') || '1') || 1),
        limit: Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50') || 50)),
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

export function extractParam(route: string, pattern: string): string | null {
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

function formatAgentResponse(response: {
    explanation: string;
    code: string;
    language: string;
    files: Array<{ name: string; content: string; language: string }>;
    confidence: number;
    warnings: string[];
    requires_approval: boolean;
    duration_ms: number;
}): string {
    const parts: string[] = [];

    if (response.explanation) {
        parts.push(response.explanation);
    }

    if (response.files.length > 0) {
        for (const file of response.files) {
            parts.push(`\n📄 ${file.name}:`);
            parts.push('```' + file.language + '\n' + file.content + '\n```');
        }
    } else if (response.code) {
        parts.push('```' + response.language + '\n' + response.code + '\n```');
    }

    if (response.warnings.length > 0) {
        parts.push('\n⚠️ ' + response.warnings.join('\n⚠️ '));
    }

    const meta: string[] = [];
    meta.push(`Confidence: ${response.confidence}%`);
    meta.push(`Time: ${response.duration_ms}ms`);
    if (response.requires_approval) {
        meta.push('🔒 Requires approval');
    }
    parts.push('\n' + meta.join(' | '));

    return parts.join('\n');
}

export async function handleApiRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    database: Database,
    orchestrator: Orchestrator,
    config: ConfigManager,
    codingAgentService?: CodingAgentService
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
            const url = new URL(req.url || '', 'http://localhost');
            const operationType = url.searchParams.get('operation_type') || undefined;
            let allTickets = database.getAllTickets() as unknown as Record<string, unknown>[];
            if (operationType) {
                allTickets = allTickets.filter(t => (t as any).operation_type === operationType);
            }
            json(res, paginateAndFilter(allTickets, params));
            return true;
        }

        if (route === 'tickets' && method === 'POST') {
            const body = await parseBody(req);
            const parentId = (body.parent_ticket_id as string) || null;
            if (parentId) {
                const parentTicket = database.getTicket(parentId);
                if (!parentTicket) {
                    json(res, { error: 'Parent ticket not found' }, 404);
                    return true;
                }
            }
            const ticket = database.createTicket({
                title: body.title as string,
                body: (body.body as string) || '',
                priority: (body.priority as TicketPriority) || TicketPriority.P2,
                creator: (body.creator as string) || 'user',
                parent_ticket_id: parentId,
            });
            eventBus.emit('ticket:created', 'webapp', { ticketId: ticket.id, ticketNumber: ticket.ticket_number });
            database.addAuditLog('webapp', 'ticket_created', `Ticket TK-${ticket.ticket_number} created via web app`);
            json(res, ticket, 201);
            return true;
        }

        // Child tickets
        const childParentId = extractParam(route, 'tickets/:id/children');
        if (childParentId && method === 'GET') {
            const children = database.getChildTickets(childParentId);
            json(res, children);
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
        if (ticketId && !route.includes('/replies') && !route.includes('/children') && method === 'GET') {
            const ticket = database.getTicket(ticketId);
            if (!ticket) { json(res, { error: 'Ticket not found' }, 404); return true; }
            const replies = database.getTicketReplies(ticketId);
            const childCount = database.getChildTicketCount(ticketId);
            json(res, { ...ticket, replies, child_count: childCount });
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
        if (ticketId && !route.includes('/replies') && method === 'DELETE') {
            const deleted = database.deleteTicket(ticketId);
            if (!deleted) { json(res, { error: 'Ticket not found' }, 404); return true; }
            eventBus.emit('ticket:deleted', 'webapp', { ticketId: ticketId });
            database.addAuditLog('webapp', 'ticket_deleted', `Ticket deleted via web app`);
            json(res, { success: true });
            return true;
        }

        // ==================== PLANS ====================
        if (route === 'plans' && method === 'GET') {
            const params = parsePagination(req);
            const allPlans = database.getAllPlans() as unknown as Record<string, unknown>[];
            for (const p of allPlans) {
                const pid = p.id as string;
                const pTasks = database.getTasksByPlan(pid);
                const pComps = database.getDesignComponentsByPlan(pid);
                p.task_count = pTasks.length;
                p.design_component_count = pComps.length;
                p.has_tasks = pTasks.length > 0;
                p.has_design = pComps.length > 0;
            }
            json(res, paginateAndFilter(allPlans, params));
            return true;
        }

        if (route === 'plans' && method === 'POST') {
            const body = await parseBody(req);
            const planName = ((body.name as string) || '').trim();
            if (!planName) { json(res, { error: 'name is required' }, 400); return true; }
            const plan = database.createPlan(planName, JSON.stringify(body.config || {}));
            if (body.status) {
                database.updatePlan(plan.id, { status: body.status as PlanStatus });
            }
            eventBus.emit('plan:created', 'webapp', { planId: plan.id, name: plan.name });
            database.addAuditLog('webapp', 'plan_created', `Plan "${planName}" created via web app`);
            json(res, database.getPlan(plan.id), 201);
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

            const aiLevel = (design.aiLevel as string) || (body.ai_level as string) || 'suggestions';

            // Adjust prompt detail based on AI level
            const levelGuidance = aiLevel === 'manual'
                ? 'Generate minimal scaffolding tasks only — the user will define details manually.'
                : aiLevel === 'suggestions'
                ? 'Generate well-structured tasks with clear descriptions. Include improvement suggestions as P3 tasks.'
                : 'Generate comprehensive tasks including optimizations, testing, and CI/CD. Auto-fill all details. Include improvement suggestions.';

            // Scale-aware task limits to prevent LLM from choking on too many tasks
            const taskLimits: Record<string, { min: number; max: number; guidance: string }> = {
                'MVP': { min: 5, max: 12, guidance: 'Generate 5-12 focused tasks for a minimal viable product.' },
                'Small': { min: 10, max: 20, guidance: 'Generate 10-20 tasks covering core features.' },
                'Medium': { min: 15, max: 30, guidance: 'Generate 15-30 tasks organized by feature area.' },
                'Large': { min: 25, max: 40, guidance: 'Generate 25-40 tasks grouped into phases. Focus on the most critical tasks first.' },
                'Enterprise': { min: 30, max: 50, guidance: 'Generate 30-50 high-level tasks grouped into phases (Setup, Core Features, Integration, Testing, Deployment). Each phase should have 6-10 tasks. Do NOT exceed 50 tasks — sub-tasks will be generated separately.' },
            };
            const limits = taskLimits[scale] || taskLimits['Medium'];
            const wizPages = ((design as Record<string, unknown>).pages as string[]) || [];
            const wizRoles = ((design as Record<string, unknown>).userRoles as string[]) || [];
            const wizFeatures = ((design as Record<string, unknown>).features as string[]) || [];
            const wizTechStack = ((design as Record<string, unknown>).techStack as string) || 'React + Node';

            const prompt = [
                `You are a project planning assistant. Create a structured development plan called "${name}".`,
                `Project Scale: ${scale}`,
                `Primary Focus: ${focus}`,
                `Key Priorities: ${priorities.join(', ')}`,
                `Description: ${description}`,
                wizPages.length > 0 ? `Pages/Screens: ${wizPages.join(', ')}` : '',
                wizRoles.length > 0 ? `User Roles: ${wizRoles.join(', ')}` : '',
                wizFeatures.length > 0 ? `Core Features: ${wizFeatures.join(', ')}` : '',
                `Tech Stack: ${wizTechStack}`,
                `AI Assistance Level: ${aiLevel} — ${levelGuidance}`,
                '',
                limits.guidance,
                'Generate atomic tasks (15-45 min each). Each task needs:',
                '- title: clear action-oriented name',
                '- description: what to implement',
                '- priority: "P1" (critical), "P2" (important), or "P3" (nice-to-have)',
                '- estimated_minutes: number between 15 and 45',
                '- acceptance_criteria: how to verify it is done',
                '- depends_on_titles: array of task titles this depends on (empty array if none)',
                '',
                `IMPORTANT: Generate between ${limits.min} and ${limits.max} tasks. Do NOT exceed ${limits.max} tasks.`,
                'IMPORTANT: You MUST respond with ONLY valid JSON. No explanation, no markdown, no text before or after.',
                'Response format:',
                '{"plan_name": "...", "tasks": [{"title": "...", "description": "...", "priority": "P1", "estimated_minutes": 30, "acceptance_criteria": "...", "depends_on_titles": []}]}',
            ].filter(Boolean).join('\n');

            const ctx: AgentContext = { conversationHistory: [] };
            const response = await orchestrator.callAgent('planning', prompt, ctx);

            // Try to parse structured response
            let parsed: { tasks?: Array<{ title: string; description?: string; priority?: string; estimated_minutes?: number; acceptance_criteria?: string; depends_on_titles?: string[]; task_requirements?: Record<string, unknown> }> } | null = null;
            let parseError: string | null = null;
            try {
                // Strip markdown fences before matching
                const cleaned = response.content.replace(/```(?:json)?\s*/g, '').replace(/```/g, '');
                const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    parsed = JSON.parse(jsonMatch[0]);
                }
            } catch (e) {
                parseError = String(e);
                const snippet = response.content.substring(0, 200);
                console.error(`[COE] Task generation JSON parse failed: ${parseError}. Response snippet: ${snippet}`);
            }

            // Create the plan regardless of whether LLM returned valid JSON
            const plan = database.createPlan(name, JSON.stringify({ scale, focus, priorities, description, design, aiLevel }));
            database.updatePlan(plan.id, { status: PlanStatus.Active });

            if (parsed?.tasks && Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
                // LLM returned valid structured tasks
                const titleToId: Record<string, string> = {};
                let sortIdx = 0;
                for (const t of parsed.tasks) {
                    const deps = (t.depends_on_titles || [])
                        .map((title: string) => titleToId[title])
                        .filter(Boolean);
                    const task = database.createTask({
                        title: t.title,
                        description: t.description || '',
                        priority: (['P1', 'P2', 'P3'].includes(t.priority ?? '') ? t.priority : 'P2') as TaskPriority,
                        estimated_minutes: t.estimated_minutes || 30,
                        acceptance_criteria: t.acceptance_criteria || '',
                        plan_id: plan.id,
                        dependencies: deps,
                        sort_order: sortIdx * 10,
                        task_requirements: t.task_requirements ? JSON.stringify(t.task_requirements) : null,
                    });
                    titleToId[t.title] = task.id;
                    sortIdx++;
                }

                eventBus.emit('plan:created', 'webapp', { planId: plan.id, name: plan.name });
                database.addAuditLog('planning', 'plan_created', `Plan "${name}": ${parsed.tasks.length} tasks`);

                // Auto-create tickets for plan generation — full hierarchical structure
                const parentAutoTicket = createAutoTicket(database, 'plan_generation',
                    'Plan: ' + name + ' \u2014 Design & Implementation',
                    'Master ticket for plan "' + name + '". Scale: ' + scale + ', Focus: ' + focus + '. ' + parsed.tasks.length + ' tasks generated.\n\nAI Assistance Level: ' + aiLevel,
                    'P1', aiLevel);
                if (parentAutoTicket) {
                    // Phase sub-tickets
                    const configTicket = createAutoTicket(database, 'plan_generation',
                        'Phase: Configuration', 'Wizard completed. Scale: ' + scale + ', Focus: ' + focus + ', Layout: ' + (design.layout || 'sidebar') + ', Theme: ' + (design.theme || 'dark'),
                        'P2', aiLevel, parentAutoTicket.id);

                    const taskGenTicket = createAutoTicket(database, 'plan_generation',
                        'Phase: Task Generation', 'AI generated ' + parsed.tasks.length + ' implementation tasks from project description.',
                        'P2', aiLevel, parentAutoTicket.id);

                    // Create a sub-ticket for each generated task
                    if (taskGenTicket) {
                        for (const t of parsed.tasks) {
                            createAutoTicket(database, 'plan_generation',
                                'Task: ' + t.title,
                                (t.description || '') + '\n\nPriority: ' + (t.priority || 'P2') + '\nEstimate: ' + (t.estimated_minutes || 30) + ' min' +
                                (t.acceptance_criteria ? '\nAcceptance: ' + t.acceptance_criteria : ''),
                                (t.priority || 'P2'), aiLevel, taskGenTicket.id);
                        }
                    }

                    createAutoTicket(database, 'plan_generation',
                        'Phase: Design Layout', 'AI will generate visual layout with components for each page.',
                        'P2', aiLevel, parentAutoTicket.id);

                    createAutoTicket(database, 'plan_generation',
                        'Phase: Data Models', 'Data models need to be created and bound to components.',
                        'P3', aiLevel, parentAutoTicket.id);

                    createAutoTicket(database, 'plan_generation',
                        'Phase: Code Generation', 'Send finalized design to coding agent for implementation.',
                        'P2', aiLevel, parentAutoTicket.id);
                }

                json(res, { plan: database.getPlan(plan.id), taskCount: parsed.tasks.length, tasks: database.getTasksByPlan(plan.id) }, 201);
                return true;
            }

            // LLM didn't return valid JSON — plan created but with no tasks
            const hasJson = /\{[\s\S]*\}/.test(response.content);
            const genError = !response.content ? 'empty_response' : hasJson ? 'invalid_json' : 'no_json_found';
            const errorDetails: Record<string, string> = {
                empty_response: 'The AI returned an empty response. Check if the LLM server is running.',
                invalid_json: 'The AI returned malformed JSON. This can happen with complex prompts — try again.',
                no_json_found: 'The AI response did not contain JSON. The LLM may need to be restarted.',
            };
            const detail = (errorDetails[genError] || 'Unexpected response format.') + (parseError ? ` Parse error: ${parseError}` : '');
            eventBus.emit('plan:created', 'webapp', { planId: plan.id, name: plan.name });
            database.addAuditLog('planning', 'plan_created', `Plan "${name}": created without AI tasks (${genError})`);

            // Create ticket even on failure path — AI attempted generation
            createAutoTicket(database, 'plan_generation',
                'Plan: ' + name + ' \u2014 Generation Failed',
                'Plan "' + name + '" was created but AI task generation failed.\nError: ' + genError + '\n' + detail +
                '\n\nScale: ' + scale + ', Focus: ' + focus + '\nAI Level: ' + aiLevel,
                'P1', aiLevel);

            json(res, { plan: database.getPlan(plan.id), taskCount: 0, tasks: [], raw_response: response.content, generation_error: genError, error_detail: detail }, 201);
            return true;
        }

        // Regenerate tasks for an existing plan
        const regenPlanId = extractParam(route, 'plans/:id/regenerate-tasks');
        if (regenPlanId && method === 'POST') {
            const plan = database.getPlan(regenPlanId);
            if (!plan) { json(res, { error: 'Plan not found' }, 404); return true; }

            let planConfig: Record<string, unknown> = {};
            try { planConfig = JSON.parse(plan.config_json || '{}'); } catch { /* ignore */ }

            const rScale = (planConfig.scale as string) || 'MVP';
            const rFocus = (planConfig.focus as string) || 'Full Stack';
            const rPrios = (planConfig.priorities as string[]) || ['Core business logic'];
            const rBody = await parseBody(req);
            const rDesc = (rBody.description as string) || (planConfig.description as string) || '';

            const prompt = [
                `You are a project planning assistant. Create a structured development plan called "${plan.name}".`,
                `Project Scale: ${rScale}`,
                `Primary Focus: ${rFocus}`,
                `Key Priorities: ${rPrios.join(', ')}`,
                rDesc ? `Description: ${rDesc}` : '',
                '',
                'Generate atomic tasks (15-45 min each). Each task needs:',
                '- title: clear action-oriented name',
                '- description: what to implement',
                '- priority: "P1" (critical), "P2" (important), or "P3" (nice-to-have)',
                '- estimated_minutes: number between 15 and 45',
                '- acceptance_criteria: how to verify it is done',
                '- depends_on_titles: array of task titles this depends on (empty array if none)',
                '',
                'IMPORTANT: You MUST respond with ONLY valid JSON. No explanation, no markdown, no text before or after.',
                '{"plan_name": "...", "tasks": [{"title": "...", "description": "...", "priority": "P1", "estimated_minutes": 30, "acceptance_criteria": "...", "depends_on_titles": []}]}',
            ].filter(Boolean).join('\n');

            const ctx: AgentContext = { conversationHistory: [] };
            const response = await orchestrator.callAgent('planning', prompt, ctx);

            let parsed: { tasks?: Array<{ title: string; description?: string; priority?: string; estimated_minutes?: number; acceptance_criteria?: string; depends_on_titles?: string[]; task_requirements?: Record<string, unknown> }> } | null = null;
            try {
                const cleaned = response.content.replace(/```(?:json)?\s*/g, '').replace(/```/g, '');
                const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
                if (jsonMatch) { parsed = JSON.parse(jsonMatch[0]); }
            } catch (e) {
                console.error(`[COE] Task regeneration JSON parse failed: ${String(e)}. Snippet: ${response.content.substring(0, 200)}`);
            }

            const regenAiLevel = (planConfig.design as Record<string, unknown>)?.aiLevel as string || (rBody.ai_level as string) || 'suggestions';

            if (parsed?.tasks && Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
                const titleToId: Record<string, string> = {};
                let sortIdx = 0;
                for (const t of parsed.tasks) {
                    const deps = (t.depends_on_titles || []).map((title: string) => titleToId[title]).filter(Boolean);
                    const task = database.createTask({
                        title: t.title,
                        description: t.description || '',
                        priority: (['P1', 'P2', 'P3'].includes(t.priority ?? '') ? t.priority : 'P2') as TaskPriority,
                        estimated_minutes: t.estimated_minutes || 30,
                        acceptance_criteria: t.acceptance_criteria || '',
                        plan_id: regenPlanId,
                        dependencies: deps,
                        sort_order: sortIdx * 10,
                        task_requirements: t.task_requirements ? JSON.stringify(t.task_requirements) : null,
                    });
                    titleToId[t.title] = task.id;
                    sortIdx++;
                }
                database.addAuditLog('planning', 'tasks_regenerated', `Plan "${plan.name}": regenerated ${parsed.tasks.length} tasks`);

                // Create ticket for task regeneration
                const regenParentTicket = createAutoTicket(database, 'plan_generation',
                    'Tasks Regenerated: ' + plan.name,
                    'AI regenerated ' + parsed.tasks.length + ' tasks for plan "' + plan.name + '".\nScale: ' + rScale + ', Focus: ' + rFocus,
                    'P2', regenAiLevel);
                if (regenParentTicket) {
                    for (const t of parsed.tasks) {
                        createAutoTicket(database, 'plan_generation',
                            'Task: ' + t.title,
                            (t.description || '') + '\nPriority: ' + (t.priority || 'P2'),
                            (t.priority || 'P2'), regenAiLevel, regenParentTicket.id);
                    }
                }

                json(res, { plan: database.getPlan(regenPlanId), taskCount: parsed.tasks.length, tasks: database.getTasksByPlan(regenPlanId) });
                return true;
            }

            // Failed regen — still create a ticket
            createAutoTicket(database, 'plan_generation',
                'Task Regeneration Failed: ' + plan.name,
                'AI did not return valid tasks for plan "' + plan.name + '". User may retry.',
                'P2', regenAiLevel);

            json(res, { plan: database.getPlan(regenPlanId), taskCount: 0, tasks: database.getTasksByPlan(regenPlanId), error_detail: 'AI did not return valid tasks. Try again.' });
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
        if (planId && method === 'DELETE') {
            const deleted = database.deletePlan(planId);
            if (!deleted) { json(res, { error: 'Plan not found' }, 404); return true; }
            eventBus.emit('plan:deleted', 'webapp', { planId: planId });
            database.addAuditLog('webapp', 'plan_deleted', `Plan deleted via web app`);
            json(res, { success: true });
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

        // Convert must be checked before the 3-segment /:id match
        const convertId = extractParam(route, 'github/issues/:id/convert');
        if (convertId && method === 'POST') {
                // Need to import the sync service inline
                const { GitHubClient } = await import('../core/github-client');
                const { GitHubSyncService } = await import('../core/github-sync');
                const ghConfig = config.getConfig().github;
                if (!ghConfig?.token) {
                    json(res, { error: 'GitHub not configured' }, 400);
                    return true;
                }
                const client = new GitHubClient(ghConfig.token, noopOutputChannel);
                const syncService = new GitHubSyncService(client, database, config, noopOutputChannel);
                const taskId = syncService.convertIssueToTask(convertId);
                if (taskId) {
                    eventBus.emit('task:created', 'webapp', { taskId, source: 'github_issue', issueId: convertId });
                    json(res, { success: true, task_id: taskId });
                } else {
                    json(res, { error: 'Failed to convert issue' }, 400);
                }
                return true;
        }

        const ghIssueId = extractParam(route, 'github/issues/:id');
        if (ghIssueId && method === 'GET') {
            const issue = database.getGitHubIssue(ghIssueId);
            if (!issue) { json(res, { error: 'GitHub issue not found' }, 404); return true; }
            json(res, issue);
            return true;
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

        // ==================== AI DESIGN GENERATION ====================
        if (route === 'design/generate' && method === 'POST') {
            const body = await parseBody(req);
            const planId = body.plan_id as string;
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }

            const dsg = (body.design || {}) as Record<string, unknown>;
            const planName = (body.plan_name as string) || 'Untitled';
            const planDesc = (body.plan_description as string) || '';
            const scale = (body.scale as string) || 'MVP';
            const focus = (body.focus as string) || 'Full Stack';
            const tasks = (body.tasks || []) as Array<{ title: string }>;
            const customColors = dsg.customColors as Record<string, string> | null;
            const layout = (dsg.layout as string) || 'sidebar';
            const theme = (dsg.theme as string) || 'dark';
            const wizPages = (dsg.pages as string[]) || ['Dashboard'];
            const wizRoles = (dsg.userRoles as string[]) || [];
            const wizFeatures = (dsg.features as string[]) || [];
            const wizTechStack = (dsg.techStack as string) || 'React + Node';

            // Resolve theme colors
            const themePresets: Record<string, { bg: string; surface: string; text: string; accent: string; secondary: string }> = {
                dark: { bg: '#1e1e2e', surface: '#313244', text: '#cdd6f4', accent: '#89b4fa', secondary: '#a6e3a1' },
                light: { bg: '#ffffff', surface: '#f0f0f0', text: '#333333', accent: '#0078d4', secondary: '#2ea043' },
                'high-contrast': { bg: '#000000', surface: '#1a1a1a', text: '#ffffff', accent: '#ffcc00', secondary: '#00ff41' },
            };
            const colors = (theme === 'custom' && customColors)
                ? { bg: customColors.background || '#1e1e2e', surface: customColors.surface || '#313244', text: customColors.text || '#cdd6f4', accent: customColors.accent || '#89b4fa', secondary: customColors.secondary || '#a6e3a1' }
                : themePresets[theme] || themePresets.dark;

            const taskList = tasks.length > 0 ? '\nKey tasks: ' + tasks.slice(0, 10).map(t => t.title).join(', ') : '';
            const pagesList = wizPages.length > 0 ? `\nPages to create: ${wizPages.join(', ')}` : '';
            const rolesList = wizRoles.length > 0 ? `\nUser roles: ${wizRoles.join(', ')}` : '';
            const featuresList = wizFeatures.length > 0 ? `\nCore features: ${wizFeatures.join(', ')}` : '';

            // Build intelligent per-page guidance based on page names
            const pageGuidance: string[] = [];
            for (const pageName of wizPages) {
                const lower = pageName.toLowerCase();
                if (lower.includes('dashboard')) {
                    pageGuidance.push(`"${pageName}": Include header, stat cards (3-4 cards in a row), a data table or list for recent activity, and chart placeholders if analytics are enabled.`);
                } else if (lower.includes('login') || lower.includes('signup')) {
                    pageGuidance.push(`"${pageName}": Include a centered form with email/username input, password input, submit button, and "forgot password" text link.`);
                } else if (lower.includes('profile') || lower.includes('account')) {
                    pageGuidance.push(`"${pageName}": Include header, image placeholder for avatar, form fields for user details, and a save button.`);
                } else if (lower.includes('settings')) {
                    pageGuidance.push(`"${pageName}": Include header, grouped form sections with inputs and toggles, and a save button at the bottom.`);
                } else if (lower.includes('admin')) {
                    pageGuidance.push(`"${pageName}": Include header, sidebar with admin nav links, data table for management, and action buttons.`);
                } else if (lower.includes('search') || lower.includes('browse')) {
                    pageGuidance.push(`"${pageName}": Include header, search input with filter button, and a list or grid of result cards.`);
                } else if (lower.includes('detail')) {
                    pageGuidance.push(`"${pageName}": Include header with back button, image placeholder, detail text sections, and action buttons.`);
                } else if (lower.includes('checkout') || lower.includes('cart')) {
                    pageGuidance.push(`"${pageName}": Include header, list of cart items, order summary card, and checkout form with button.`);
                } else if (lower.includes('landing')) {
                    pageGuidance.push(`"${pageName}": Include hero header with large text, feature cards (3 across), CTA button, and footer.`);
                } else if (lower.includes('notification')) {
                    pageGuidance.push(`"${pageName}": Include header, notification filter buttons, and a list of notification cards.`);
                } else {
                    pageGuidance.push(`"${pageName}": Include header, appropriate content components based on the page purpose, and relevant action buttons.`);
                }
            }

            const prompt = [
                `You are an expert UI layout designer. Generate a detailed visual page layout for a project called "${planName}".`,
                '',
                `Project: Scale=${scale}, Focus=${focus}, Tech Stack=${wizTechStack}`,
                planDesc ? `Description: ${planDesc}` : '',
                taskList,
                pagesList,
                rolesList,
                featuresList,
                `Layout Style: ${layout}`,
                `Theme colors: background=${colors.bg}, surface=${colors.surface}, text=${colors.text}, accent=${colors.accent}, secondary=${colors.secondary}`,
                '',
                wizPages.length > 0 ? `Create exactly these pages: ${wizPages.join(', ')}. Each page MUST have appropriate components based on its purpose.` : '',
                pageGuidance.length > 0 ? '\nPer-page component guidance:\n' + pageGuidance.join('\n') : '',
                '',
                wizRoles.length > 1 ? `This app has multiple user roles (${wizRoles.join(', ')}). Include role-specific UI elements where appropriate (e.g., admin controls, role-based nav items).` : '',
                wizFeatures.includes('Search & Filtering') ? 'Include a search/filter bar component on relevant pages.' : '',
                wizFeatures.includes('Charts / Analytics') ? 'Include chart placeholder components on the Dashboard page.' : '',
                wizFeatures.includes('User Authentication') ? 'Include login form components if a Login page is specified.' : '',
                wizFeatures.includes('Notifications / Alerts') ? 'Include a notification area component in the header.' : '',
                wizFeatures.includes('Real-time Updates') ? 'Include a status indicator or live badge component in relevant areas.' : '',
                wizFeatures.includes('File Upload') ? 'Include file upload/drop zone components where relevant.' : '',
                wizFeatures.includes('Chat / Messaging') ? 'Include a chat container component on relevant pages.' : '',
                wizFeatures.includes('Payment Integration') ? 'Include payment form components on checkout pages.' : '',
                '',
                'Available component types (type: defaultSize):',
                '- header: 1440x80 (page header bar)',
                '- nav: 1440x60 (navigation bar)',
                '- sidebar: 240x600 (side navigation panel)',
                '- container: 300x200 (grouping container)',
                '- card: 280x180 (content card)',
                '- text: 200x30 (text label/paragraph)',
                '- button: 120x40 (clickable button)',
                '- input: 240x36 (text input field)',
                '- form: 300x250 (form container)',
                '- table: 400x200 (data table)',
                '- list: 240x200 (item list)',
                '- image: 200x150 (image placeholder)',
                '- footer: 1440x60 (page footer)',
                '- divider: 400x2 (horizontal divider)',
                '- icon: 32x32 (icon element)',
                '',
                'Canvas: 1440x900 pixels.',
                '',
                'Layout rules:',
                layout === 'sidebar' ? '- Place a sidebar (240px wide) on the left edge, main content to the right' : '',
                layout === 'tabs' ? '- Place a nav bar at top, content area below with tab-like cards' : '',
                layout === 'wizard' ? '- Place a header with step indicators at top, single content area, nav buttons at bottom' : '',
                wizPages.length > 1 ? `Create ${wizPages.length} pages as specified. Each page should have 4-10 components appropriate for its purpose.` : 'Scale rules: MVP=1 page with 5-8 components, Small=1-2 pages 8-15 components, Medium=2-3 pages, Large=3-5 pages, Enterprise=5+ pages.',
                '',
                'IMPORTANT: Respond with ONLY valid JSON. No explanation, no markdown fences.',
                '{"pages":[{"name":"Home","route":"/","background":"' + colors.bg + '","components":[{"type":"header","name":"App Header","x":0,"y":0,"width":1440,"height":80,"content":"' + planName + '","styles":{"backgroundColor":"' + colors.surface + '","color":"' + colors.text + '"}}]}]}',
            ].filter(Boolean).join('\n');

            const validTypes = ['container', 'text', 'button', 'input', 'image', 'card', 'nav', 'modal', 'sidebar', 'header', 'footer', 'list', 'table', 'form', 'divider', 'icon', 'custom'];
            const designAiLevel = (dsg.aiLevel as string) || getPlanAiLevel(database, planId);

            try {
                const ctx: AgentContext = { conversationHistory: [] };
                const response = await orchestrator.callAgent('planning', prompt, ctx);

                let parsed: { pages?: Array<{ name?: string; route?: string; background?: string; components?: Array<{ type?: string; name?: string; x?: number; y?: number; width?: number; height?: number; content?: string; styles?: Record<string, unknown> }> }> } | null = null;
                try {
                    let jsonStr = response.content.trim();
                    if (jsonStr.startsWith('```')) {
                        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
                    }
                    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        parsed = JSON.parse(jsonMatch[0]);
                    }
                } catch { /* JSON parse failed */ }

                if (!parsed?.pages || !Array.isArray(parsed.pages) || parsed.pages.length === 0) {
                    createAutoTicket(database, 'design_change',
                        'Design Generation: No Layout Returned',
                        'AI did not return a valid design layout for plan "' + planName + '".\nThe response did not contain page definitions.',
                        'P2', designAiLevel);
                    json(res, { pages: [], componentCount: 0, error: 'AI did not return a valid design layout', raw_response: response.content });
                    return true;
                }

                // Clear existing empty pages (wizard pre-created pages with no components)
                // so AI-generated pages with components can replace them cleanly
                const existingPages = database.getDesignPagesByPlan(planId);
                for (const ep of existingPages) {
                    const pageComps = database.getDesignComponentsByPage(ep.id);
                    if (pageComps.length === 0) {
                        database.deleteDesignPage(ep.id);
                    }
                }

                const createdPages: unknown[] = [];
                let totalComponents = 0;

                for (let pi = 0; pi < parsed.pages.length; pi++) {
                    const pageDef = parsed.pages[pi];
                    const page = database.createDesignPage({
                        plan_id: planId,
                        parent_page_id: null,
                        depth: 0,
                        name: pageDef.name || `Page ${pi + 1}`,
                        route: pageDef.route || '/',
                        sort_order: pi * 10,
                        width: 1440,
                        height: 900,
                        background: pageDef.background || colors.bg,
                        requirements: [],
                    });

                    for (let ci = 0; ci < (pageDef.components || []).length; ci++) {
                        const comp = pageDef.components![ci];
                        const compType = (validTypes.includes(comp.type || '') ? comp.type! : 'container') as DesignComponent['type'];
                        database.createDesignComponent({
                            plan_id: planId,
                            page_id: page.id,
                            type: compType,
                            name: comp.name || compType,
                            parent_id: null,
                            sort_order: ci * 10,
                            x: Math.max(0, Math.min(1400, comp.x ?? 0)),
                            y: Math.max(0, Math.min(860, comp.y ?? 0)),
                            width: Math.max(20, Math.min(1440, comp.width ?? 200)),
                            height: Math.max(10, Math.min(900, comp.height ?? 100)),
                            styles: comp.styles || {},
                            content: comp.content || '',
                            props: {},
                            requirements: [],
                        });
                        totalComponents++;
                    }

                    createdPages.push(page);
                }

                database.addAuditLog('webapp', 'design_generated', `AI generated ${totalComponents} components across ${createdPages.length} pages for plan "${planName}"`);

                // Auto-create comprehensive tickets for design generation process
                const designParentTicket = createAutoTicket(database, 'design_change',
                    'Design Generated: ' + planName,
                    'Master ticket for AI design generation of "' + planName + '".\n' +
                    'Result: ' + totalComponents + ' components across ' + createdPages.length + ' page(s).\n' +
                    'Layout: ' + layout + ', Theme: ' + theme + ', Tech: ' + wizTechStack + '\n' +
                    'Pages: ' + parsed.pages.map(p => p.name || 'Unnamed').join(', '),
                    'P2', designAiLevel);
                if (designParentTicket) {
                    // Phase 1: Requirements Research
                    createAutoTicket(database, 'design_change',
                        'Phase: Requirements Analysis',
                        'Analyzed project requirements for "' + planName + '".\n' +
                        'Scale: ' + scale + ', Focus: ' + focus + ', Tech Stack: ' + wizTechStack + '\n' +
                        'User Roles: ' + wizRoles.join(', ') + '\n' +
                        'Core Features: ' + wizFeatures.join(', ') + '\n' +
                        (tasks.length > 0 ? 'Referenced ' + tasks.length + ' existing tasks for context.' : 'No existing tasks — generated from description.'),
                        'P3', designAiLevel, designParentTicket.id);

                    // Phase 2: Page Structure & Naming
                    createAutoTicket(database, 'design_change',
                        'Phase: Page Structure & Naming',
                        'Determined page structure for "' + planName + '".\n' +
                        'Requested pages: ' + wizPages.join(', ') + '\n' +
                        'Generated pages: ' + parsed.pages.map(p => (p.name || 'Unnamed') + ' (' + (p.route || '/') + ')').join(', ') + '\n' +
                        'Total: ' + parsed.pages.length + ' pages created.',
                        'P3', designAiLevel, designParentTicket.id);

                    // Phase 3: Navigation & Inter-page Linking
                    const routeList = parsed.pages.map(p => (p.name || 'Unnamed') + ' → ' + (p.route || '/')).join('\n');
                    createAutoTicket(database, 'design_change',
                        'Phase: Navigation & Linking',
                        'Established navigation structure and page routing.\n' +
                        'Layout type: ' + layout + ' (determines primary navigation pattern)\n' +
                        'Route map:\n' + routeList + '\n' +
                        (layout === 'sidebar' ? 'Sidebar navigation links all pages.' : layout === 'tabs' ? 'Tab-based navigation at top.' : layout === 'wizard' ? 'Step-by-step sequential navigation.' : 'Custom navigation layout.'),
                        'P3', designAiLevel, designParentTicket.id);

                    // Phase 4: Layout & Theme Resolution
                    createAutoTicket(database, 'design_change',
                        'Phase: Layout & Theme Applied',
                        'Applied visual design settings.\n' +
                        'Layout: ' + layout + '\n' +
                        'Theme: ' + theme + '\n' +
                        'Colors — Background: ' + colors.bg + ', Surface: ' + colors.surface + ', Text: ' + colors.text + ', Accent: ' + colors.accent + ', Secondary: ' + colors.secondary + '\n' +
                        'Canvas: 1440x900 pixels.',
                        'P3', designAiLevel, designParentTicket.id);

                    // Phase 5: Per-page component design tickets
                    for (const pageDef of parsed.pages) {
                        const pageCompCount = (pageDef.components || []).length;
                        const pageTicket = createAutoTicket(database, 'design_change',
                            'Page Design: ' + (pageDef.name || 'Unnamed'),
                            'Designed page "' + (pageDef.name || 'Unnamed') + '" with ' + pageCompCount + ' components.\n' +
                            'Route: ' + (pageDef.route || '/') + '\n' +
                            'Background: ' + (pageDef.background || colors.bg) + '\n' +
                            'Components:\n' + (pageDef.components || []).map(c =>
                                '  - ' + (c.type || 'unknown') + ': "' + (c.name || '') + '" at (' + (c.x ?? 0) + ',' + (c.y ?? 0) + ') ' + (c.width ?? 200) + 'x' + (c.height ?? 100)
                            ).join('\n'),
                            'P3', designAiLevel, designParentTicket.id);

                        // Sub-tickets per component for Smart/Hybrid levels
                        if (pageTicket && (designAiLevel === 'smart' || designAiLevel === 'hybrid')) {
                            for (const comp of (pageDef.components || [])) {
                                createAutoTicket(database, 'design_change',
                                    'Component: ' + (comp.name || comp.type || 'Unknown'),
                                    'Added ' + (comp.type || 'container') + ' component "' + (comp.name || '') + '" to page "' + (pageDef.name || 'Unnamed') + '".\n' +
                                    'Position: (' + (comp.x ?? 0) + ', ' + (comp.y ?? 0) + ')\n' +
                                    'Size: ' + (comp.width ?? 200) + ' x ' + (comp.height ?? 100) + '\n' +
                                    (comp.content ? 'Content: ' + String(comp.content) : '') +
                                    (comp.styles ? '\nStyles: ' + JSON.stringify(comp.styles) : ''),
                                    'P4' as any, designAiLevel, pageTicket.id);
                            }
                        }
                    }

                    // Phase 6: Design Validation
                    createAutoTicket(database, 'design_change',
                        'Phase: Design Validation',
                        'Design generation completed and validated.\n' +
                        'Total pages: ' + createdPages.length + '\n' +
                        'Total components: ' + totalComponents + '\n' +
                        'All components placed within canvas bounds (1440x900).\n' +
                        'All component types validated against allowed types list.\n' +
                        'Status: Ready for review in Visual Designer.',
                        'P3', designAiLevel, designParentTicket.id);
                }

                json(res, { pages: createdPages, componentCount: totalComponents }, 201);
                return true;
            } catch (err) {
                // Create ticket for design generation failure
                createAutoTicket(database, 'design_change',
                    'Design Generation Failed: ' + planName,
                    'AI design generation failed for plan "' + planName + '".\nError: ' + String(err),
                    'P1', designAiLevel);
                json(res, { pages: [], componentCount: 0, error: 'Design generation failed: ' + String(err) });
                return true;
            }
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
            let depth = 0;
            if (body.parent_page_id) {
                const parent = database.getDesignPage(body.parent_page_id as string);
                depth = parent ? parent.depth + 1 : 0;
                if (depth > 10) { json(res, { error: 'Maximum sub-page depth of 10 exceeded' }, 400); return true; }
            }
            const pagePlanId = body.plan_id as string;
            const page = database.createDesignPage({
                plan_id: pagePlanId,
                parent_page_id: (body.parent_page_id as string) || null,
                depth,
                name: (body.name as string) || 'Untitled Page',
                route: (body.route as string) || '/',
                sort_order: (body.sort_order as number) || 0,
                width: (body.width as number) || 1440,
                height: (body.height as number) || 900,
                background: (body.background as string) || '#1e1e2e',
                requirements: (body.requirements as any[]) || [],
            });
            eventBus.emit('design:page_created', 'webapp', { pageId: page.id, name: page.name });
            database.addAuditLog('webapp', 'design_page_created', `Page "${page.name}" created`);
            // Auto-ticket for page creation
            const pageAiLevel = getPlanAiLevel(database, pagePlanId);
            createAutoTicket(database, 'design_change',
                'Page Created: ' + page.name,
                'New page "' + page.name + '" (route: ' + (page.route || '/') + ') added to the design.',
                'P3', pageAiLevel);
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
            const deletingPage = database.getDesignPage(designPageId);
            database.deleteDesignPage(designPageId);
            eventBus.emit('design:page_deleted', 'webapp', { pageId: designPageId });
            // Auto-ticket for page deletion
            if (deletingPage) {
                const delPageAiLevel = getPlanAiLevel(database, deletingPage.plan_id);
                createAutoTicket(database, 'design_change',
                    'Page Deleted: ' + deletingPage.name,
                    'Page "' + deletingPage.name + '" was removed from the design.',
                    'P3', delPageAiLevel);
            }
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
            const compPlanId = body.plan_id as string;
            const comp = database.createDesignComponent({
                plan_id: compPlanId,
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
            // Auto-ticket for component creation
            const compAiLevel = getPlanAiLevel(database, compPlanId);
            createAutoTicket(database, 'design_change',
                'Component Added: ' + comp.name + ' (' + comp.type + ')',
                'New ' + comp.type + ' component "' + comp.name + '" added to the design.',
                'P3', compAiLevel);
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
            const deletingComp = database.getDesignComponent(compId);
            database.deleteDesignComponent(compId);
            eventBus.emit('design:component_deleted', 'webapp', { componentId: compId });
            // Auto-ticket for component deletion
            if (deletingComp) {
                const delCompAiLevel = getPlanAiLevel(database, deletingComp.plan_id);
                createAutoTicket(database, 'design_change',
                    'Component Removed: ' + deletingComp.name,
                    deletingComp.type + ' component "' + deletingComp.name + '" was removed from the design.',
                    'P3', delCompAiLevel);
            }
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

        // ==================== CODING AGENT PROCESSING ====================
        if (route === 'coding/process' && method === 'POST') {
            if (!codingAgentService) {
                json(res, { error: 'Coding agent service not available' }, 503);
                return true;
            }

            const body = await parseBody(req);
            const sessionId = body.session_id as string;
            const content = body.content as string;
            const taskId = (body.task_id as string) || undefined;

            if (!sessionId || !content) {
                json(res, { error: 'session_id and content are required' }, 400);
                return true;
            }

            // 1. Store the user message
            const userMsg = database.addCodingMessage({
                session_id: sessionId,
                role: 'user',
                content: content,
                task_id: taskId,
            });

            // 2. Build context from session
            const session = database.getCodingSession(sessionId);
            const previousMessages = database.getCodingMessages(sessionId, 20);

            const agentContext: {
                plan_id?: string | null;
                session_id?: string | null;
                constraints?: Record<string, unknown>;
            } = {
                session_id: sessionId,
                plan_id: session?.plan_id ?? null,
            };

            // If a task is linked, pull plan context from it
            if (taskId) {
                const task = database.getTask(taskId);
                if (task?.plan_id) {
                    agentContext.plan_id = task.plan_id;
                }
            }

            // Pass conversation history so the agent has context
            const conversationHistory = previousMessages
                .slice(-10)
                .map(m => `[${m.role}]: ${m.content}`)
                .join('\n');
            agentContext.constraints = { conversation_history: conversationHistory };

            // 3. Process through coding agent
            try {
                const agentResponse = await codingAgentService.processCommand(content, agentContext);

                // 4. Format agent message content
                const agentContent = formatAgentResponse(agentResponse);

                // 5. Build metadata from response
                const toolCallsData = {
                    confidence: agentResponse.confidence,
                    files: agentResponse.files.map(f => f.name),
                    warnings: agentResponse.warnings,
                    requires_approval: agentResponse.requires_approval,
                    tokens_used: agentResponse.tokens_used,
                    duration_ms: agentResponse.duration_ms,
                };

                // 6. Store the agent response message
                const agentMsg = database.addCodingMessage({
                    session_id: sessionId,
                    role: 'agent',
                    content: agentContent,
                    tool_calls: JSON.stringify(toolCallsData),
                    task_id: taskId,
                });

                eventBus.emit('coding:agent_responded', 'webapp', {
                    sessionId,
                    userMessageId: userMsg.id,
                    agentMessageId: agentMsg.id,
                    confidence: agentResponse.confidence,
                    duration_ms: agentResponse.duration_ms,
                });

                json(res, {
                    user_message: userMsg,
                    agent_message: agentMsg,
                    agent_response: agentResponse,
                }, 201);
            } catch (error) {
                const errorStr = error instanceof Error ? error.message : String(error);
                const errorMessage = database.addCodingMessage({
                    session_id: sessionId,
                    role: 'system',
                    content: `Error processing message: ${errorStr}`,
                });

                json(res, {
                    user_message: userMsg,
                    error_message: errorMessage,
                    error: errorStr,
                }, 500);
            }

            return true;
        }

        // ==================== GENERATE PROMPT (LLM-powered) ====================
        if (route === 'coding/generate-prompt' && method === 'POST') {
            if (!codingAgentService) {
                json(res, { error: 'Coding agent service not available' }, 503);
                return true;
            }

            const body = await parseBody(req);
            const sessionId = body.session_id as string;
            const taskId = body.task_id as string;

            if (!sessionId || !taskId) {
                json(res, { error: 'session_id and task_id are required' }, 400);
                return true;
            }

            try {
                const result = await codingAgentService.generateTaskPrompt(taskId);

                // Store the generated prompt as a system message in the session
                const msg = database.addCodingMessage({
                    session_id: sessionId,
                    role: 'system',
                    content: result.prompt,
                    task_id: taskId,
                });

                json(res, { message: msg, tokens_used: result.tokens_used }, 201);
            } catch (error) {
                json(res, { error: String(error) }, 500);
            }

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

        // ==================== ELEMENT ISSUES (Status) ====================
        if (route === 'status/issues' && method === 'GET') {
            const url = new URL(req.url || '', 'http://localhost');
            const planId = url.searchParams.get('plan_id');
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const status = url.searchParams.get('status') || undefined;
            json(res, database.getElementIssuesByPlan(planId, status));
            return true;
        }

        if (route === 'status/issues' && method === 'POST') {
            const body = await parseBody(req);
            if (!body.element_id || !body.plan_id) { json(res, { error: 'element_id and plan_id required' }, 400); return true; }
            const issue = database.createElementIssue({
                element_id: body.element_id as string,
                element_type: (body.element_type as 'component' | 'page') || 'component',
                plan_id: body.plan_id as string,
                description: (body.description as string) || '',
                status: (body.status as string) || 'open',
                severity: (body.severity as string) || 'bug',
                mode: (body.mode as string) || 'fullstack',
                reported_by: (body.reported_by as string) || 'user',
            } as any);
            eventBus.emit('status:issue_created', 'webapp', { issueId: issue.id, planId: body.plan_id });
            json(res, issue, 201);
            return true;
        }

        if (route === 'status/summary' && method === 'GET') {
            const url = new URL(req.url || '', 'http://localhost');
            const planId = url.searchParams.get('plan_id');
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const issueCounts = database.countElementIssuesByPlan(planId);
            const questionCounts = database.countAIQuestionsByPlan(planId);
            const suggestionCounts = database.countAISuggestionsByPlan(planId);
            json(res, { issues: issueCounts, questions: questionCounts, suggestions: suggestionCounts });
            return true;
        }

        const issueId = extractParam(route, 'status/issues/:id');
        if (issueId && method === 'PUT') {
            const body = await parseBody(req);
            const updated = database.updateElementIssue(issueId, body as any);
            if (!updated) { json(res, { error: 'Issue not found' }, 404); return true; }
            if (body.status === 'resolved') {
                eventBus.emit('status:issue_resolved', 'webapp', { issueId });
            }
            json(res, updated);
            return true;
        }
        if (issueId && method === 'DELETE') {
            database.deleteElementIssue(issueId);
            json(res, { success: true });
            return true;
        }

        // ==================== AI SUGGESTIONS ====================
        if (route === 'ai/suggestions' && method === 'GET') {
            const url = new URL(req.url || '', 'http://localhost');
            const planId = url.searchParams.get('plan_id');
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const status = url.searchParams.get('status') || undefined;
            json(res, database.getAISuggestionsByPlan(planId, status));
            return true;
        }

        if (route === 'ai/suggestions' && method === 'POST') {
            const body = await parseBody(req);
            const planId = body.plan_id as string;
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const plan = database.getPlan(planId);
            if (!plan) { json(res, { error: 'Plan not found' }, 404); return true; }
            const pages = database.getDesignPagesByPlan(planId);
            const allComponents: DesignComponent[] = [];
            for (const page of pages) {
                allComponents.push(...database.getDesignComponentsByPage(page.id));
            }
            const tasks = database.getTasksByPlan(planId);
            const existingSuggestions = database.getAISuggestionsByPlan(planId);
            const prompt = `You are an AI design advisor. Analyze this project plan and provide actionable suggestions.

Plan: ${plan.name} (${JSON.parse(plan.config_json || '{}').scale || 'MVP'})
Pages: ${pages.map(p => p.name).join(', ') || 'None'}
Components: ${allComponents.length} total
Tasks: ${tasks.length} total (${tasks.filter(t => (t as any).status === 'not_started').length} not started)
Existing suggestions: ${existingSuggestions.length}

Provide 2-5 suggestions as JSON array: [{"type":"layout|missing_component|ux_issue|implementation_blocker|plan_update|architecture|general","title":"...","description":"...","reasoning":"...","priority":"P1|P2|P3|P4"}]
Only return the JSON array, nothing else.`;

            try {
                const ctx: AgentContext = { conversationHistory: [] };
                const response = await orchestrator.callAgent('planning', prompt, ctx);
                let suggestions: any[] = [];
                try {
                    const cleaned = response.content.replace(/```(?:json)?\s*/g, '').replace(/```/g, '');
                    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
                    if (jsonMatch) suggestions = JSON.parse(jsonMatch[0]);
                } catch { /* parse failed — return empty */ }

                const created = [];
                for (const s of suggestions) {
                    const suggestion = database.createAISuggestion({
                        plan_id: planId,
                        component_id: null,
                        page_id: null,
                        type: s.type || 'general',
                        title: s.title || 'Untitled',
                        description: s.description || '',
                        reasoning: s.reasoning || '',
                        action_type: s.action_type ?? null,
                        action_payload: s.action_payload || {},
                        priority: s.priority || 'P2',
                        status: 'pending',
                        ticket_id: null,
                    });
                    created.push(suggestion);
                }
                eventBus.emit('ai:suggestions_generated', 'webapp', { planId, count: created.length });

                // Create auto-ticket for AI suggestion generation
                const suggestAiLevel = getPlanAiLevel(database, planId);
                if (created.length > 0) {
                    createAutoTicket(database, 'suggestion',
                        'AI Suggestions: ' + created.length + ' generated',
                        'AI analyzed design for plan and generated ' + created.length + ' suggestions.\n' +
                        created.map(function(s: any) { return '- [' + s.priority + '] ' + s.title; }).join('\n'),
                        'P3', suggestAiLevel);
                }

                json(res, { suggestions: created, count: created.length });
            } catch (error) {
                json(res, { error: String(error), suggestions: [], count: 0 }, 500);
            }
            return true;
        }

        const acceptSuggestionId = extractParam(route, 'ai/suggestions/:id/accept');
        if (acceptSuggestionId && method === 'POST') {
            const updated = database.updateAISuggestion(acceptSuggestionId, { status: 'accepted' });
            if (!updated) { json(res, { error: 'Suggestion not found' }, 404); return true; }
            eventBus.emit('ai:suggestion_accepted', 'webapp', { suggestionId: acceptSuggestionId });
            json(res, updated);
            return true;
        }

        const dismissSuggestionId = extractParam(route, 'ai/suggestions/:id/dismiss');
        if (dismissSuggestionId && method === 'POST') {
            const updated = database.updateAISuggestion(dismissSuggestionId, { status: 'dismissed' });
            if (!updated) { json(res, { error: 'Suggestion not found' }, 404); return true; }
            eventBus.emit('ai:suggestion_dismissed', 'webapp', { suggestionId: dismissSuggestionId });
            json(res, updated);
            return true;
        }

        // ==================== AI QUESTIONS ====================
        if (route === 'ai/questions' && method === 'GET') {
            const url = new URL(req.url || '', 'http://localhost');
            const planId = url.searchParams.get('plan_id');
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const status = url.searchParams.get('status') || undefined;
            json(res, database.getAIQuestionsByPlan(planId, status));
            return true;
        }

        const answerQuestionId = extractParam(route, 'ai/questions/:id/answer');
        if (answerQuestionId && method === 'POST') {
            const body = await parseBody(req);
            if (!body.answer) { json(res, { error: 'answer required' }, 400); return true; }
            const updated = database.answerAIQuestion(answerQuestionId, body.answer as string);
            if (!updated) { json(res, { error: 'Question not found' }, 404); return true; }
            eventBus.emit('ai:question_answered', 'webapp', { questionId: answerQuestionId });
            json(res, updated);
            return true;
        }

        const dismissQuestionId = extractParam(route, 'ai/questions/:id/dismiss');
        if (dismissQuestionId && method === 'POST') {
            const updated = database.dismissAIQuestion(dismissQuestionId);
            if (!updated) { json(res, { error: 'Question not found' }, 404); return true; }
            json(res, updated);
            return true;
        }

        if (route === 'ai/autofill' && method === 'POST') {
            const body = await parseBody(req);
            const planId = body.plan_id as string;
            const reqAiLevel = (body.ai_level as string) || 'suggestions';
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            // Manual mode: no autofill
            if (reqAiLevel === 'manual') {
                json(res, { autofilled: 0, questions: [], message: 'Autofill disabled in Manual mode' });
                return true;
            }
            const pending = database.getAIQuestionsByPlan(planId, 'pending');
            if (pending.length === 0) { json(res, { autofilled: 0, questions: [] }); return true; }

            const plan = database.getPlan(planId);
            const questionsText = pending.map((q, i) => `${i + 1}. [${q.category}] ${q.question} (type: ${q.question_type}${q.options.length ? ', options: ' + q.options.join('/') : ''})`).join('\n');
            const prompt = `You are an AI assistant helping design an application.
Plan: ${plan?.name || 'Unknown'}
Config: ${plan?.config_json || '{}'}

Answer these design questions based on best practices and the plan context.
${questionsText}

Reply as JSON array of answers in order: ["answer1", "answer2", ...]
Only return the JSON array, nothing else.`;

            try {
                const ctx: AgentContext = { conversationHistory: [] };
                const response = await orchestrator.callAgent('planning', prompt, ctx);
                let answers: string[] = [];
                try {
                    const cleaned = response.content.replace(/```(?:json)?\s*/g, '').replace(/```/g, '');
                    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
                    if (jsonMatch) answers = JSON.parse(jsonMatch[0]);
                } catch { /* parse failed */ }

                const autofilled = [];
                for (let i = 0; i < pending.length && i < answers.length; i++) {
                    const q = database.autofillAIQuestion(pending[i].id, String(answers[i]));
                    if (q) autofilled.push(q);
                }
                eventBus.emit('ai:autofill_completed', 'webapp', { planId, count: autofilled.length });
                json(res, { autofilled: autofilled.length, questions: autofilled });
            } catch (error) {
                json(res, { error: String(error), autofilled: 0, questions: [] }, 500);
            }
            return true;
        }

        if (route === 'ai/review-plan' && method === 'POST') {
            const body = await parseBody(req);
            const planId = body.plan_id as string;
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const plan = database.getPlan(planId);
            if (!plan) { json(res, { error: 'Plan not found' }, 404); return true; }
            const pages = database.getDesignPagesByPlan(planId);
            const allComponents: DesignComponent[] = [];
            for (const page of pages) {
                allComponents.push(...database.getDesignComponentsByPage(page.id));
            }
            const tasks = database.getTasksByPlan(planId);
            const questions = database.getAIQuestionsByPlan(planId);
            const dataModels = database.getDataModelsByPlan(planId);
            const config = JSON.parse(plan.config_json || '{}');
            const prompt = `You are a code readiness reviewer. Evaluate this project plan for implementation readiness.

Plan: ${plan.name}
Scale: ${config.scale || 'MVP'}, Focus: ${config.focus || 'Full Stack'}
Tech Stack: ${config.techStack || 'Not specified'}
Pages: ${pages.length} (${pages.map(p => p.name).join(', ')})
Components: ${allComponents.length} total
Tasks: ${tasks.length} total
Data Models: ${dataModels.length} (${dataModels.map(m => m.name).join(', ')})
Unanswered Questions: ${questions.filter(q => q.status === 'pending').length}
Features: ${config.features?.join(', ') || 'None specified'}

Score the readiness 0-100 and identify missing details.
Reply as JSON: {"readiness_score":N,"readiness_level":"not_ready|needs_work|almost_ready|ready","summary":"...","missing_details":[{"area":"...","description":"...","priority":"P1|P2|P3"}]}
Only return the JSON object, nothing else.`;

            try {
                const ctx: AgentContext = { conversationHistory: [] };
                const response = await orchestrator.callAgent('planning', prompt, ctx);
                let review: any = { readiness_score: 0, readiness_level: 'not_ready', summary: 'Review failed', missing_details: [] };
                try {
                    const cleaned = response.content.replace(/```(?:json)?\s*/g, '').replace(/```/g, '');
                    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
                    if (jsonMatch) review = JSON.parse(jsonMatch[0]);
                } catch { /* parse failed */ }

                // Generate questions and suggestions from missing_details
                let questionsGenerated = 0;
                let suggestionsGenerated = 0;
                if (Array.isArray(review.missing_details)) {
                    for (const detail of review.missing_details) {
                        if (detail.priority === 'P1') {
                            database.createAISuggestion({
                                plan_id: planId, component_id: null, page_id: null,
                                type: 'implementation_blocker', title: detail.area,
                                description: detail.description, reasoning: 'Identified during plan review',
                                action_type: null, action_payload: {}, priority: TicketPriority.P1,
                                status: 'pending', ticket_id: null,
                            });
                            suggestionsGenerated++;
                        } else {
                            database.createAIQuestion({
                                plan_id: planId, component_id: null, page_id: null,
                                category: 'architecture', question: detail.description,
                                question_type: 'text', options: [],
                                ai_reasoning: `From plan review: ${detail.area}`,
                                ai_suggested_answer: null, user_answer: null,
                                status: 'pending', ticket_id: null,
                            });
                            questionsGenerated++;
                        }
                    }
                }
                review.questions_generated = questionsGenerated;
                review.suggestions_generated = suggestionsGenerated;
                review.tickets_created = 0;
                eventBus.emit('ai:plan_reviewed', 'webapp', { planId, score: review.readiness_score });
                json(res, review);
            } catch (error) {
                json(res, { error: String(error) }, 500);
            }
            return true;
        }

        // ==================== PLAN VERSIONS ====================
        const planVersionsList = extractParam(route, 'plans/:id/versions');
        if (planVersionsList && !route.includes('/versions/') && method === 'GET') {
            json(res, database.getPlanVersionsByPlan(planVersionsList));
            return true;
        }

        if (planVersionsList && !route.includes('/versions/') && method === 'POST') {
            const body = await parseBody(req);
            const planId = planVersionsList;
            const plan = database.getPlan(planId);
            if (!plan) { json(res, { error: 'Plan not found' }, 404); return true; }
            // Build snapshot
            const pages = database.getDesignPagesByPlan(planId);
            const allComponents: DesignComponent[] = [];
            for (const page of pages) {
                allComponents.push(...database.getDesignComponentsByPage(page.id));
            }
            const tasks = database.getTasksByPlan(planId);
            const tokens = database.getDesignTokensByPlan(planId);
            const questions = database.getAIQuestionsByPlan(planId);
            const snapshot = JSON.stringify({
                config_json: plan.config_json,
                pages, components: allComponents, tasks, tokens,
                questions: questions.filter(q => q.status === 'answered' || q.status === 'autofilled'),
            });
            const branchType = (body.branch_type as string) === 'features' ? 'features' : 'live';
            const versionNumber = database.getNextPlanVersionNumber(planId);
            const version = database.createPlanVersion({
                plan_id: planId,
                version_number: versionNumber,
                label: (body.label as string) || `Version ${versionNumber}`,
                snapshot,
                change_summary: (body.change_summary as string) || '',
                created_by: (body.created_by as string) || 'user',
                branch_type: branchType,
                is_active: !!(body.is_active),
                change_count: 0,
                merge_diff: null,
            });
            eventBus.emit('plan:version_created', 'webapp', { planId, versionId: version.id, versionNumber, branchType });
            json(res, version, 201);
            return true;
        }

        // Restore plan version
        const restoreMatch = route.match(/^plans\/([^/]+)\/versions\/([^/]+)\/restore$/);
        if (restoreMatch && method === 'POST') {
            const planId = restoreMatch[1];
            const versionId = restoreMatch[2];
            const version = database.getPlanVersion(versionId);
            if (!version || version.plan_id !== planId) { json(res, { error: 'Version not found' }, 404); return true; }
            try {
                const snapshot = JSON.parse(version.snapshot);
                // Restore config
                if (snapshot.config_json) {
                    database.updatePlan(planId, { config_json: snapshot.config_json } as any);
                }
                eventBus.emit('plan:version_restored', 'webapp', { planId, versionId, versionNumber: version.version_number });
                json(res, { success: true, restored_version: version.version_number });
            } catch (error) {
                json(res, { error: 'Failed to restore: ' + String(error) }, 500);
            }
            return true;
        }

        // Delete plan version
        const versionDeleteMatch = route.match(/^plans\/([^/]+)\/versions\/([^/]+)$/);
        if (versionDeleteMatch && method === 'DELETE') {
            const versionId = versionDeleteMatch[2];
            database.deletePlanVersion(versionId);
            json(res, { success: true });
            return true;
        }

        // ==================== BRANCH MANAGEMENT ====================

        // GET /plans/:id/branches — get branch info (active versions for each branch)
        const branchPlanId = extractParam(route, 'plans/:id/branches');
        if (branchPlanId && method === 'GET') {
            const plan = database.getPlan(branchPlanId);
            if (!plan) { json(res, { error: 'Plan not found' }, 404); return true; }
            const liveVersion = database.getActiveBranchVersion(branchPlanId, 'live');
            const featuresVersion = database.getActiveBranchVersion(branchPlanId, 'features');
            const liveChangeCount = database.getDesignChangeCount(branchPlanId, 'live');
            const featuresChangeCount = database.getDesignChangeCount(branchPlanId, 'features');
            json(res, {
                plan_id: branchPlanId,
                live: liveVersion ? { ...liveVersion, pending_changes: liveChangeCount } : null,
                features: featuresVersion ? { ...featuresVersion, pending_changes: featuresChangeCount } : null,
            });
            return true;
        }

        // POST /plans/:id/switch-branch — save current branch snapshot, switch to target
        const switchBranchPlanId = extractParam(route, 'plans/:id/switch-branch');
        if (switchBranchPlanId && method === 'POST') {
            const body = await parseBody(req);
            const planId = switchBranchPlanId;
            const targetBranch = (body.target_branch as string) === 'features' ? 'features' : 'live';
            const plan = database.getPlan(planId);
            if (!plan) { json(res, { error: 'Plan not found' }, 404); return true; }

            // Auto-save current branch state as snapshot
            const currentBranch = targetBranch === 'features' ? 'live' : 'features';
            const pages = database.getDesignPagesByPlan(planId);
            const allComponents: DesignComponent[] = [];
            for (const page of pages) {
                allComponents.push(...database.getDesignComponentsByPage(page.id));
            }
            const tokens = database.getDesignTokensByPlan(planId);
            const currentSnapshot = JSON.stringify({
                config_json: plan.config_json,
                pages, components: allComponents, tokens,
            });

            // Update or create active version for current branch
            const currentActiveVersion = database.getActiveBranchVersion(planId, currentBranch);
            if (currentActiveVersion) {
                // Update snapshot of existing active version
                database.deletePlanVersion(currentActiveVersion.id);
            }
            const saveVersion = database.createPlanVersion({
                plan_id: planId,
                version_number: database.getNextPlanVersionNumber(planId),
                label: `Auto-save (${currentBranch})`,
                snapshot: currentSnapshot,
                change_summary: 'Auto-saved on branch switch',
                created_by: 'system',
                branch_type: currentBranch,
                is_active: true,
                change_count: currentActiveVersion ? currentActiveVersion.change_count : 0,
                merge_diff: null,
            });
            database.setActiveBranchVersion(planId, currentBranch, saveVersion.id);

            // Load target branch snapshot if it exists
            const targetVersion = database.getActiveBranchVersion(planId, targetBranch);
            let restoredSnapshot = null;
            if (targetVersion) {
                try {
                    restoredSnapshot = JSON.parse(targetVersion.snapshot);
                    // Restore config_json
                    if (restoredSnapshot.config_json) {
                        database.updatePlan(planId, { config_json: restoredSnapshot.config_json } as any);
                    }
                } catch { /* invalid snapshot — start fresh */ }
            }

            eventBus.emit('plan:branch_switched', 'webapp', { planId, from: currentBranch, to: targetBranch });
            json(res, {
                success: true,
                switched_to: targetBranch,
                snapshot: restoredSnapshot,
                has_existing_version: !!targetVersion,
            });
            return true;
        }

        // GET /plans/:id/merge-preview — calculate diff between features and live
        const mergePreviewPlanId = extractParam(route, 'plans/:id/merge-preview');
        if (mergePreviewPlanId && method === 'GET') {
            const planId = mergePreviewPlanId;
            const liveVersion = database.getActiveBranchVersion(planId, 'live');
            const featuresVersion = database.getActiveBranchVersion(planId, 'features');
            if (!featuresVersion) { json(res, { error: 'No features branch to merge' }, 400); return true; }

            const liveSnapshot = liveVersion ? JSON.parse(liveVersion.snapshot) : { pages: [], components: [], tokens: [] };
            const featuresSnapshot = JSON.parse(featuresVersion.snapshot);
            const diff = calculateDesignDiff(liveSnapshot, featuresSnapshot);
            json(res, { diff, live_version: liveVersion, features_version: featuresVersion });
            return true;
        }

        // POST /plans/:id/merge — merge features into live
        const mergePlanId = extractParam(route, 'plans/:id/merge');
        if (mergePlanId && method === 'POST') {
            const planId = mergePlanId;
            const plan = database.getPlan(planId);
            if (!plan) { json(res, { error: 'Plan not found' }, 404); return true; }

            const featuresVersion = database.getActiveBranchVersion(planId, 'features');
            if (!featuresVersion) { json(res, { error: 'No features branch to merge' }, 400); return true; }

            // Auto-snapshot current live before merge
            const liveVersion = database.getActiveBranchVersion(planId, 'live');
            const liveSnapshot = liveVersion ? liveVersion.snapshot : '{}';
            const featuresSnapshot = JSON.parse(featuresVersion.snapshot);
            const diff = calculateDesignDiff(
                liveVersion ? JSON.parse(liveSnapshot) : { pages: [], components: [], tokens: [] },
                featuresSnapshot
            );

            // Create pre-merge backup of live
            database.createPlanVersion({
                plan_id: planId,
                version_number: database.getNextPlanVersionNumber(planId),
                label: 'Pre-merge backup (live)',
                snapshot: liveSnapshot,
                change_summary: 'Auto-backup before merge from features',
                created_by: 'system',
                branch_type: 'live',
                is_active: false,
                change_count: liveVersion ? liveVersion.change_count : 0,
                merge_diff: null,
            });

            // Apply features snapshot to plan (features wins)
            if (featuresSnapshot.config_json) {
                database.updatePlan(planId, { config_json: featuresSnapshot.config_json } as any);
            }

            // Create new live version from features
            const mergedVersion = database.createPlanVersion({
                plan_id: planId,
                version_number: database.getNextPlanVersionNumber(planId),
                label: 'Merged from Features Design',
                snapshot: featuresVersion.snapshot,
                change_summary: `Merged: ${diff.length} changes from Features Design`,
                created_by: 'system',
                branch_type: 'live',
                is_active: true,
                change_count: 0,
                merge_diff: JSON.stringify(diff),
            });
            database.setActiveBranchVersion(planId, 'live', mergedVersion.id);

            // Clear features branch change log
            database.clearDesignChangeLog(planId, 'features');

            eventBus.emit('plan:version_merged', 'webapp', {
                planId, mergedVersionId: mergedVersion.id,
                diffCount: diff.length,
            });
            json(res, { success: true, merged_version: mergedVersion, diff });
            return true;
        }

        // POST /plans/:id/micro-version — increment change count on live branch
        const microVersionPlanId = extractParam(route, 'plans/:id/micro-version');
        if (microVersionPlanId && method === 'POST') {
            const body = await parseBody(req);
            const planId = microVersionPlanId;
            const branchType = (body.branch_type as string) === 'features' ? 'features' : 'live';

            // Log the change
            database.addDesignChangeLog({
                plan_id: planId,
                branch_type: branchType,
                change_type: (body.change_type as 'add' | 'update' | 'delete') || 'update',
                entity_type: (body.entity_type as 'page' | 'component' | 'token' | 'data_model') || 'component',
                entity_id: (body.entity_id as string) || '',
                description: (body.description as string) || '',
                session_change_number: database.getDesignChangeCount(planId, branchType) + 1,
            });

            // Update active version change count
            const activeVersion = database.getActiveBranchVersion(planId, branchType);
            if (activeVersion) {
                const newCount = activeVersion.change_count + 1;
                database.updatePlanVersionChangeCount(activeVersion.id, newCount);

                // Check live threshold — if change count exceeds threshold, include warning
                const totalElements = (() => {
                    const pages = database.getDesignPagesByPlan(planId);
                    let total = pages.length;
                    for (const page of pages) {
                        total += database.getDesignComponentsByPage(page.id).length;
                    }
                    return total;
                })();
                const threshold = Math.max(3, Math.ceil(totalElements * 0.1));
                const shouldWarn = branchType === 'live' && newCount >= threshold;

                json(res, {
                    success: true,
                    change_count: newCount,
                    threshold_warning: shouldWarn,
                    threshold,
                    total_elements: totalElements,
                });
            } else {
                json(res, { success: true, change_count: 1, threshold_warning: false });
            }
            return true;
        }

        // GET /plans/:id/change-log — get design change log
        const changeLogPlanId = extractParam(route, 'plans/:id/change-log');
        if (changeLogPlanId && method === 'GET') {
            const url = new URL(req.url || '', 'http://localhost');
            const branchType = url.searchParams.get('branch_type') as 'live' | 'features' | null;
            const log = database.getDesignChangeLog(changeLogPlanId, branchType || undefined);
            json(res, log);
            return true;
        }

        // ==================== NOTIFICATION BADGES ====================
        if (route === 'notifications/counts' && method === 'GET') {
            const url = new URL(req.url || '', 'http://localhost');
            const planId = url.searchParams.get('plan_id') || undefined;
            const counts: Record<string, number> = {
                tasks: 0, tickets: 0, planning: 0, coding: 0,
                dashboard: 0, agents: 0, github: 0, settings: 0, system: 0,
            };
            if (planId) {
                const questionCounts = database.countAIQuestionsByPlan(planId);
                const suggestionCounts = database.countAISuggestionsByPlan(planId);
                const issueCounts = database.countElementIssuesByPlan(planId);
                counts.planning = questionCounts.pending + suggestionCounts.pending;
                counts.tasks = issueCounts.open;
            }
            const allTickets = database.getAllTickets();
            counts.tickets = allTickets.filter((t: any) => t.status === 'open').length;
            const pendingDiffs = database.getPendingCodeDiffs();
            counts.coding = pendingDiffs.length;
            counts.dashboard = counts.tasks + counts.tickets + counts.planning + counts.coding;
            eventBus.emit('notification:badge_update', 'webapp', { counts });
            json(res, counts);
            return true;
        }

        if (route === 'notifications/mark-read' && method === 'POST') {
            // Mark items as read — for now just acknowledge
            json(res, { success: true });
            return true;
        }

        // ==================== ELEMENT CHAT (Ticket Threads) ====================
        const elementChatConfirmMatch = route.match(/^elements\/([^/]+)\/chat\/([^/]+)\/confirm$/);
        if (elementChatConfirmMatch && method === 'POST') {
            const body = await parseBody(req);
            const accept = body.accept !== false;
            eventBus.emit(accept ? 'element:change_confirmed' : 'element:change_rejected', 'webapp', {
                elementId: elementChatConfirmMatch[1],
                messageId: elementChatConfirmMatch[2],
            });
            json(res, { success: true, accepted: accept });
            return true;
        }

        const elementChatId = extractParam(route, 'elements/:id/chat');
        if (elementChatId && !route.includes('/confirm') && method === 'GET') {
            const url = new URL(req.url || '', 'http://localhost');
            const elementType = url.searchParams.get('type') || 'component';
            // Get ticket replies associated with this element's tickets
            const allTickets = database.getAllTickets();
            const elementTickets = allTickets.filter((t: any) =>
                t.body && t.body.includes(`element:${elementChatId}`) && t.body.includes(`type:${elementType}`)
            );
            const messages: any[] = [];
            for (const ticket of elementTickets) {
                const replies = database.getTicketReplies((ticket as any).id);
                messages.push(...replies);
            }
            json(res, { element_id: elementChatId, element_type: elementType, messages });
            return true;
        }

        if (elementChatId && !route.includes('/confirm') && method === 'POST') {
            const body = await parseBody(req);
            const message = body.message as string;
            const elementType = (body.element_type as string) || 'component';
            if (!message) { json(res, { error: 'message required' }, 400); return true; }

            // Create or find a ticket for this element
            const ticket = database.createTicket({
                title: `Chat: ${elementType} ${elementChatId}`,
                body: `element:${elementChatId} type:${elementType}`,
                priority: TicketPriority.P3,
                creator: 'user',
            });
            const reply = database.addTicketReply(ticket.id, 'user', message);
            eventBus.emit('element:chat_message', 'webapp', {
                elementId: elementChatId, elementType, ticketId: ticket.id,
            });
            json(res, { ticket_id: ticket.id, reply }, 201);
            return true;
        }

        // ==================== TICKET MANAGEMENT (Enhanced) ====================
        const ticketPriorityId = extractParam(route, 'tickets/:id/priority');
        if (ticketPriorityId && method === 'PUT') {
            const body = await parseBody(req);
            const priority = body.priority as string;
            if (!priority) { json(res, { error: 'priority required' }, 400); return true; }
            const ticket = database.updateTicket(ticketPriorityId, { priority } as any);
            if (!ticket) { json(res, { error: 'Ticket not found' }, 404); return true; }
            eventBus.emit('ticket:priority_changed', 'webapp', { ticketId: ticketPriorityId, priority });
            json(res, ticket);
            return true;
        }

        const ticketStatusId = extractParam(route, 'tickets/:id/status');
        if (ticketStatusId && method === 'PUT') {
            const body = await parseBody(req);
            const status = body.status as string;
            if (!status) { json(res, { error: 'status required' }, 400); return true; }
            const ticket = database.updateTicket(ticketStatusId, { status } as any);
            if (!ticket) { json(res, { error: 'Ticket not found' }, 404); return true; }
            eventBus.emit('ticket:status_changed', 'webapp', { ticketId: ticketStatusId, status });
            json(res, ticket);
            return true;
        }

        // ==================== DATA MODELS ====================
        if (route === 'data-models' && method === 'GET') {
            const url = new URL(req.url || '', 'http://localhost');
            const planId = url.searchParams.get('plan_id');
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            json(res, database.getDataModelsByPlan(planId));
            return true;
        }

        if (route === 'data-models' && method === 'POST') {
            const body = await parseBody(req);
            if (!body.plan_id || !body.name) { json(res, { error: 'plan_id and name required' }, 400); return true; }
            const model = database.createDataModel({
                plan_id: body.plan_id as string,
                name: body.name as string,
                description: (body.description as string) || '',
                fields: (body.fields as any[]) || [],
                relationships: (body.relationships as any[]) || [],
                bound_components: (body.bound_components as string[]) || [],
                ai_backend_suggestion: (body.ai_backend_suggestion as string) ?? null,
            });
            json(res, model, 201);
            return true;
        }

        const dataModelId = extractParam(route, 'data-models/:id');
        if (dataModelId && method === 'GET') {
            const model = database.getDataModel(dataModelId);
            if (!model) { json(res, { error: 'Data model not found' }, 404); return true; }
            json(res, model);
            return true;
        }
        if (dataModelId && method === 'PUT') {
            const body = await parseBody(req);
            const updated = database.updateDataModel(dataModelId, body as any);
            if (!updated) { json(res, { error: 'Data model not found' }, 404); return true; }
            json(res, updated);
            return true;
        }
        if (dataModelId && method === 'DELETE') {
            database.deleteDataModel(dataModelId);
            json(res, { success: true });
            return true;
        }

        // ==================== START CODING FROM LIVE ====================
        if (route === 'coding/start-from-live' && method === 'POST') {
            const body = await parseBody(req);
            const planId = body.plan_id as string;
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const plan = database.getPlan(planId);
            if (!plan) { json(res, { error: 'Plan not found' }, 404); return true; }

            // Validate we're on live branch (check if features has uncommitted changes)
            const branchType = (body.branch_type as string) || 'live';
            if (branchType !== 'live') {
                json(res, { error: 'Start Coding is only available on the Live branch. Merge your Features Design first.' }, 400);
                return true;
            }

            // Create full snapshot
            const pages = database.getDesignPagesByPlan(planId);
            const allComponents: DesignComponent[] = [];
            for (const page of pages) {
                allComponents.push(...database.getDesignComponentsByPage(page.id));
            }
            const tokens = database.getDesignTokensByPlan(planId);
            const dataModels = database.getDataModelsByPlan(planId);
            const questions = database.getAIQuestionsByPlan(planId).filter(q => q.status === 'answered' || q.status === 'autofilled');
            const config = JSON.parse(plan.config_json || '{}');

            const snapshot = JSON.stringify({
                config_json: plan.config_json,
                pages, components: allComponents, tokens, dataModels, questions,
            });

            // Create version snapshot
            const versionNumber = database.getNextPlanVersionNumber(planId);
            const version = database.createPlanVersion({
                plan_id: planId,
                version_number: versionNumber,
                label: `Coding snapshot v${versionNumber}`,
                snapshot,
                change_summary: 'Auto-snapshot before coding session',
                created_by: 'system',
                branch_type: 'live',
                is_active: false,
                change_count: 0,
                merge_diff: null,
            });

            // Build design spec for coding agent
            const designSpec = {
                plan: { name: plan.name, scale: config.scale, focus: config.focus, techStack: config.techStack },
                pages: pages.map(p => ({
                    name: p.name, route: p.route,
                    components: allComponents.filter(c => c.page_id === p.id),
                })),
                data_models: dataModels.map(m => ({ name: m.name, fields: m.fields, relationships: m.relationships })),
                tokens: tokens.map(t => ({ name: t.name, value: t.value })),
                answered_questions: questions.map(q => ({ question: q.question, answer: q.user_answer })),
                features: config.features || [],
                userRoles: config.userRoles || [],
            };

            // Create coding session linked to snapshot
            const session = database.createCodingSession({
                plan_id: planId,
                name: `Build: ${plan.name} (v${versionNumber})`,
            });

            // Update session with snapshot info
            database.updateCodingSession(session.id, {
                version_snapshot_id: version.id,
                branch_type: 'live',
            } as any);

            // Add design spec as system message
            database.addCodingMessage({
                session_id: session.id,
                role: 'system',
                content: `Design spec loaded for "${plan.name}" (snapshot v${versionNumber}):\n\`\`\`json\n${JSON.stringify(designSpec, null, 2)}\n\`\`\``,
            });

            // Generate intelligent implementation tasks from design
            const generatedTasks: any[] = [];
            const scale = (config.scale as string) || 'MVP';
            const features = (config.design?.features as string[]) || (config.features as string[]) || [];
            const roles = (config.design?.userRoles as string[]) || (config.userRoles as string[]) || [];
            const techStack = (config.design?.techStack as string) || (config.techStack as string) || 'React + Node';
            let sortIdx = 0;

            // Phase 1: Project setup task (always)
            generatedTasks.push(database.createTask({
                title: 'Project scaffolding and setup',
                description: `Initialize ${techStack} project structure.\n- Create folder structure\n- Install dependencies\n- Configure build tooling\n- Set up linting and formatting`,
                plan_id: planId, priority: 'P1' as any, sort_order: sortIdx++ * 10,
                acceptance_criteria: 'Project builds without errors, dev server starts',
            }));

            // Phase 2: Per-page tasks with component-aware subtasks
            for (const page of pages) {
                const pageComps = allComponents.filter(c => c.page_id === page.id);
                const hasForms = pageComps.some(c => c.type === 'form' || c.type === 'input');
                const hasTables = pageComps.some(c => c.type === 'table' || c.type === 'list');
                const hasNav = pageComps.some(c => c.type === 'nav' || c.type === 'sidebar');
                const hasCards = pageComps.some(c => c.type === 'card');
                const hasImages = pageComps.some(c => c.type === 'image');

                // Main page task
                const compList = pageComps.map(c => `- ${c.type}: "${c.name}" at (${c.x},${c.y}) ${c.width}x${c.height}${c.content ? ' — "' + c.content + '"' : ''}`).join('\n');
                generatedTasks.push(database.createTask({
                    title: `Build page: ${page.name}`,
                    description: `Implement the "${page.name}" page (route: ${page.route || '/'}).\n\nComponents (${pageComps.length}):\n${compList}\n\nLayout: Match the visual designer positions and sizes.`,
                    plan_id: planId, priority: 'P1' as any, sort_order: sortIdx++ * 10,
                    acceptance_criteria: `Page renders at ${page.route || '/'} with all ${pageComps.length} components visible and correctly positioned`,
                }));

                // Form handling subtask
                if (hasForms) {
                    const formComps = pageComps.filter(c => c.type === 'form' || c.type === 'input');
                    generatedTasks.push(database.createTask({
                        title: `${page.name}: Form validation and submission`,
                        description: `Add input validation and submit handling for ${formComps.length} form element(s) on "${page.name}".\n- Client-side validation\n- Error messages\n- Submit handler with loading state\n- Success/error feedback`,
                        plan_id: planId, priority: 'P1' as any, sort_order: sortIdx++ * 10,
                        acceptance_criteria: 'Forms validate input, show errors, submit data, and show success feedback',
                    }));
                }

                // Table/list data binding subtask
                if (hasTables) {
                    generatedTasks.push(database.createTask({
                        title: `${page.name}: Data table/list binding`,
                        description: `Connect table/list components on "${page.name}" to data source.\n- Fetch data from API\n- Render rows/items\n- Add loading and empty states` +
                            (scale !== 'MVP' ? '\n- Add sorting and pagination' : ''),
                        plan_id: planId, priority: 'P2' as any, sort_order: sortIdx++ * 10,
                        acceptance_criteria: 'Tables display data, handle loading/empty states' + (scale !== 'MVP' ? ', support sorting and pagination' : ''),
                    }));
                }
            }

            // Phase 3: Data model tasks (one per model)
            for (const model of dataModels) {
                generatedTasks.push(database.createTask({
                    title: `Data model: ${model.name} CRUD`,
                    description: `Implement CRUD operations for ${model.name}.\n- Create API routes (GET, POST, PUT, DELETE)\n- ${model.fields.length} fields: ${model.fields.map((f: any) => f.name).join(', ')}\n- Input validation\n- Error handling`,
                    plan_id: planId, priority: 'P1' as any, sort_order: sortIdx++ * 10,
                    acceptance_criteria: `All CRUD endpoints work for ${model.name}, validation prevents invalid data`,
                }));
            }

            // Phase 4: Feature-specific tasks
            if (features.includes('User Authentication')) {
                generatedTasks.push(database.createTask({
                    title: 'User authentication system',
                    description: 'Implement login, signup, and session management.\n- Login/signup forms\n- JWT or session-based auth\n- Protected routes\n- Logout flow',
                    plan_id: planId, priority: 'P1' as any, sort_order: sortIdx++ * 10,
                    acceptance_criteria: 'Users can register, login, access protected routes, and logout',
                }));
            }
            if (features.includes('Search & Filtering')) {
                generatedTasks.push(database.createTask({
                    title: 'Search and filtering system',
                    description: 'Add search functionality across relevant pages.\n- Search input component\n- Filter controls\n- Debounced API queries\n- Result display',
                    plan_id: planId, priority: 'P2' as any, sort_order: sortIdx++ * 10,
                    acceptance_criteria: 'Search returns relevant results, filters narrow results correctly',
                }));
            }
            if (features.includes('File Upload')) {
                generatedTasks.push(database.createTask({
                    title: 'File upload system',
                    description: 'Implement file upload with drag-and-drop.\n- Upload UI component\n- Backend file handling\n- File type validation\n- Progress indicator',
                    plan_id: planId, priority: 'P2' as any, sort_order: sortIdx++ * 10,
                    acceptance_criteria: 'Files can be uploaded via click or drag, with progress shown and validation enforced',
                }));
            }
            if (features.includes('Notifications / Alerts')) {
                generatedTasks.push(database.createTask({
                    title: 'Notification system',
                    description: 'Add notification display and management.\n- Notification list component\n- Mark as read\n- Toast alerts for new notifications\n- Badge count in header',
                    plan_id: planId, priority: 'P2' as any, sort_order: sortIdx++ * 10,
                    acceptance_criteria: 'Notifications display, can be marked read, badge count updates',
                }));
            }
            if (features.includes('Charts / Analytics')) {
                generatedTasks.push(database.createTask({
                    title: 'Charts and analytics dashboard',
                    description: 'Implement chart components for data visualization.\n- Choose charting library\n- Integrate with data sources\n- Responsive chart containers\n- Multiple chart types (bar, line, pie)',
                    plan_id: planId, priority: 'P2' as any, sort_order: sortIdx++ * 10,
                    acceptance_criteria: 'Charts render with real data, resize correctly, and display tooltips',
                }));
            }
            if (features.includes('Real-time Updates')) {
                generatedTasks.push(database.createTask({
                    title: 'Real-time update system',
                    description: 'Add WebSocket or SSE for live updates.\n- Connection management\n- Auto-reconnect\n- Update UI components in real-time\n- Status indicator',
                    plan_id: planId, priority: 'P2' as any, sort_order: sortIdx++ * 10,
                    acceptance_criteria: 'Changes from one client appear on another without refresh',
                }));
            }
            if (features.includes('Payment Integration')) {
                generatedTasks.push(database.createTask({
                    title: 'Payment integration',
                    description: 'Integrate payment processing (e.g., Stripe).\n- Payment form component\n- Backend payment API\n- Order confirmation flow\n- Error handling for declined payments',
                    plan_id: planId, priority: 'P1' as any, sort_order: sortIdx++ * 10,
                    acceptance_criteria: 'Payments process successfully, errors handled gracefully, confirmations shown',
                }));
            }
            if (features.includes('Chat / Messaging')) {
                generatedTasks.push(database.createTask({
                    title: 'Chat/messaging system',
                    description: 'Implement real-time messaging.\n- Chat UI component\n- Message history\n- Send/receive messages\n- Typing indicators',
                    plan_id: planId, priority: 'P2' as any, sort_order: sortIdx++ * 10,
                    acceptance_criteria: 'Users can send and receive messages in real-time with history',
                }));
            }
            if (features.includes('Data Export')) {
                generatedTasks.push(database.createTask({
                    title: 'Data export functionality',
                    description: 'Add export capabilities for data tables.\n- CSV export\n- JSON export\n- Filtered export (export current view)\n- Download handling',
                    plan_id: planId, priority: 'P3' as any, sort_order: sortIdx++ * 10,
                    acceptance_criteria: 'Data can be exported to CSV and JSON, respecting current filters',
                }));
            }

            // Phase 5: Role-based access (if multiple roles)
            if (roles.length > 1) {
                generatedTasks.push(database.createTask({
                    title: 'Role-based access control',
                    description: `Implement access control for ${roles.length} user roles: ${roles.join(', ')}.\n- Role assignment\n- Route protection per role\n- UI element visibility per role\n- Admin-only sections`,
                    plan_id: planId, priority: 'P1' as any, sort_order: sortIdx++ * 10,
                    acceptance_criteria: 'Each role sees only their authorized pages and features',
                }));
            }

            // Phase 6: Navigation and routing (always if multiple pages)
            if (pages.length > 1) {
                generatedTasks.push(database.createTask({
                    title: 'Navigation and routing',
                    description: `Wire up navigation between ${pages.length} pages.\n- Router setup\n- ` +
                        pages.map(p => `${p.name} → ${p.route || '/'}`).join('\n- ') +
                        '\n- Active state highlighting\n- 404 handling',
                    plan_id: planId, priority: 'P1' as any, sort_order: sortIdx++ * 10,
                    acceptance_criteria: 'All pages reachable via navigation, active page highlighted, 404 handled',
                }));
            }

            // Phase 7: Scale-specific tasks
            if (scale === 'Large' || scale === 'Enterprise') {
                generatedTasks.push(database.createTask({
                    title: 'Error handling and logging',
                    description: 'Add global error handling.\n- Error boundary components\n- API error interceptor\n- User-friendly error messages\n- Error logging service',
                    plan_id: planId, priority: 'P2' as any, sort_order: sortIdx++ * 10,
                    acceptance_criteria: 'Errors are caught gracefully, logged, and shown to users appropriately',
                }));
                generatedTasks.push(database.createTask({
                    title: 'Loading states and skeleton screens',
                    description: 'Add loading indicators throughout.\n- Page-level loading\n- Component skeleton screens\n- Button loading states\n- Optimistic updates where appropriate',
                    plan_id: planId, priority: 'P2' as any, sort_order: sortIdx++ * 10,
                    acceptance_criteria: 'No blank screens during loading, all async operations show progress',
                }));
            }
            if (scale === 'Enterprise') {
                generatedTasks.push(database.createTask({
                    title: 'Accessibility compliance (WCAG 2.1)',
                    description: 'Ensure accessibility across all pages.\n- ARIA labels\n- Keyboard navigation\n- Screen reader support\n- Color contrast compliance\n- Focus management',
                    plan_id: planId, priority: 'P2' as any, sort_order: sortIdx++ * 10,
                    acceptance_criteria: 'All pages pass WCAG 2.1 AA checks, keyboard-navigable, screen-reader compatible',
                }));
                generatedTasks.push(database.createTask({
                    title: 'Performance optimization',
                    description: 'Optimize for production performance.\n- Code splitting and lazy loading\n- Image optimization\n- Bundle size analysis\n- Caching strategy\n- Lighthouse score > 90',
                    plan_id: planId, priority: 'P2' as any, sort_order: sortIdx++ * 10,
                    acceptance_criteria: 'Lighthouse performance score > 90, initial load under 3 seconds',
                }));
                generatedTasks.push(database.createTask({
                    title: 'CI/CD pipeline setup',
                    description: 'Set up continuous integration and deployment.\n- Build pipeline\n- Automated tests\n- Staging environment\n- Production deployment\n- Rollback procedure',
                    plan_id: planId, priority: 'P2' as any, sort_order: sortIdx++ * 10,
                    acceptance_criteria: 'Code pushes trigger automated builds and tests, deployments are automated',
                }));
                generatedTasks.push(database.createTask({
                    title: 'Security hardening',
                    description: 'Implement security best practices.\n- Input sanitization\n- CSRF protection\n- Rate limiting\n- Content Security Policy\n- Dependency audit',
                    plan_id: planId, priority: 'P1' as any, sort_order: sortIdx++ * 10,
                    acceptance_criteria: 'No critical vulnerabilities, all OWASP top 10 addressed',
                }));
                generatedTasks.push(database.createTask({
                    title: 'Monitoring and alerting',
                    description: 'Set up production monitoring.\n- Application metrics\n- Error tracking (Sentry or similar)\n- Uptime monitoring\n- Alert thresholds\n- Dashboard',
                    plan_id: planId, priority: 'P3' as any, sort_order: sortIdx++ * 10,
                    acceptance_criteria: 'Errors and performance issues trigger alerts, metrics visible on dashboard',
                }));
            }

            // Phase 8: Testing (always, but scope scales)
            generatedTasks.push(database.createTask({
                title: 'Testing suite',
                description: scale === 'Enterprise'
                    ? 'Comprehensive test coverage.\n- Unit tests for all components\n- Integration tests for API\n- E2E tests for critical flows\n- Visual regression tests\n- Performance tests'
                    : scale === 'MVP'
                    ? 'Basic test coverage.\n- Unit tests for core logic\n- Smoke tests for each page'
                    : 'Test coverage for key features.\n- Unit tests for components\n- Integration tests for API\n- E2E tests for critical user flows',
                plan_id: planId, priority: (scale === 'MVP' ? 'P3' : 'P2') as any, sort_order: sortIdx++ * 10,
                acceptance_criteria: scale === 'Enterprise' ? 'Coverage > 80%, all critical paths have E2E tests' :
                    scale === 'MVP' ? 'Core logic has unit tests, each page loads without errors' :
                    'Key features have tests, critical flows covered by E2E',
            }));

            // Create auto-ticket for the coding session
            const aiLevel = (body.ai_level as string) || getPlanAiLevel(database, planId);
            createAutoTicket(database, 'coding_session', `Coding session: ${plan.name} v${versionNumber}`,
                `Started coding from Live branch snapshot. ${pages.length} pages, ${allComponents.length} components, ${generatedTasks.length} tasks generated.`,
                'P2', aiLevel);

            eventBus.emit('coding:session_created', 'webapp', {
                planId, sessionId: session.id, snapshotId: version.id,
                taskCount: generatedTasks.length,
            });

            json(res, {
                session_id: session.id,
                snapshot_id: version.id,
                version_number: versionNumber,
                design_spec: designSpec,
                generated_tasks: generatedTasks.length,
            }, 201);
            return true;
        }

        // POST /coding/request-design-change — coding agent requests design changes
        if (route === 'coding/request-design-change' && method === 'POST') {
            const body = await parseBody(req);
            const planId = body.plan_id as string;
            const sessionId = body.session_id as string;
            const description = body.description as string;
            const severity = (body.severity as string) || 'minor';

            if (!planId || !description) {
                json(res, { error: 'plan_id and description required' }, 400);
                return true;
            }

            const aiLevel = (body.ai_level as string) || 'suggestions';
            const ticket = createAutoTicket(database, 'design_change',
                `Design change request: ${description.substring(0, 60)}`,
                `Severity: ${severity}\n\n${description}\n\nRequested during coding session ${sessionId || 'unknown'}.`,
                severity === 'major' ? 'P1' : 'P3', aiLevel);

            json(res, {
                success: true,
                ticket_id: ticket ? ticket.id : null,
                severity,
                should_pause: severity === 'major',
                message: severity === 'major'
                    ? 'Major design change detected. Consider pausing coding and switching to Features Design.'
                    : 'Minor design change noted. Continuing coding.',
            });
            return true;
        }

        // ==================== CODING FROM DESIGN ====================
        if (route === 'coding/from-design' && method === 'POST') {
            const body = await parseBody(req);
            const planId = body.plan_id as string;
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const plan = database.getPlan(planId);
            if (!plan) { json(res, { error: 'Plan not found' }, 404); return true; }

            const pages = database.getDesignPagesByPlan(planId);
            const allComponents: DesignComponent[] = [];
            for (const page of pages) {
                allComponents.push(...database.getDesignComponentsByPage(page.id));
            }
            const tokens = database.getDesignTokensByPlan(planId);
            const dataModels = database.getDataModelsByPlan(planId);
            const questions = database.getAIQuestionsByPlan(planId).filter(q => q.status === 'answered' || q.status === 'autofilled');
            const config = JSON.parse(plan.config_json || '{}');

            const designSpec = {
                plan: { name: plan.name, scale: config.scale, focus: config.focus, techStack: config.techStack },
                pages: pages.map(p => ({
                    name: p.name, route: p.route,
                    components: allComponents.filter(c => c.page_id === p.id),
                })),
                data_models: dataModels.map(m => ({ name: m.name, fields: m.fields, relationships: m.relationships })),
                tokens: tokens.map(t => ({ name: t.name, value: t.value })),
                answered_questions: questions.map(q => ({ question: q.question, answer: q.user_answer })),
                features: config.features || [],
                userRoles: config.userRoles || [],
            };

            // Create or reuse coding session
            let session = (database.getAllCodingSessions() as any[]).find((s: any) => s.plan_id === planId && s.status === 'active');
            if (!session) {
                session = database.createCodingSession({ plan_id: planId, name: `Build: ${plan.name}` });
            }
            // Add design spec as system message
            database.addCodingMessage({
                session_id: session.id,
                role: 'system',
                content: `Design spec loaded for "${plan.name}":\n\`\`\`json\n${JSON.stringify(designSpec, null, 2)}\n\`\`\``,
            });

            // Create auto-ticket for the coding session
            const codingAiLevel = getPlanAiLevel(database, planId);
            createAutoTicket(database, 'coding_session',
                'Coding Session: ' + plan.name,
                'Design spec exported to coding agent.\nPages: ' + pages.length +
                ', Components: ' + allComponents.length +
                ', Data Models: ' + dataModels.length +
                '\nSession: ' + session.id,
                'P2', codingAiLevel);

            eventBus.emit('coding:design_export', 'webapp', { planId, sessionId: session.id });
            json(res, { session_id: session.id, design_spec: designSpec });
            return true;
        }

        if (route === 'coding/micro-fix' && method === 'POST') {
            const body = await parseBody(req);
            const elementId = body.element_id as string;
            const planId = body.plan_id as string;
            const issueDescription = body.issue_description as string;
            if (!elementId || !planId || !issueDescription) {
                json(res, { error: 'element_id, plan_id, and issue_description required' }, 400);
                return true;
            }
            // Create issue tracker
            const issue = database.createElementIssue({
                element_id: elementId,
                element_type: (body.element_type as 'component' | 'page') || 'component',
                plan_id: planId,
                description: issueDescription,
                status: 'open',
                severity: 'bug',
                mode: 'fullstack',
                reported_by: 'user',
            } as any);
            // Create a ticket for tracking
            const ticket = database.createTicket({
                title: `Micro-fix: ${issueDescription.substring(0, 50)}`,
                body: `Element: ${elementId}\nDescription: ${issueDescription}`,
                priority: TicketPriority.P2,
                creator: 'user',
            });
            eventBus.emit('status:issue_created', 'webapp', { issueId: issue.id, planId, ticketId: ticket.id });
            json(res, { issue, ticket }, 201);
            return true;
        }

        // ==================== AI BUG CHECK ====================
        // ==================== UI TEST GENERATION ====================
        if (route === 'ai/ui-test-plan' && method === 'POST') {
            const body = await parseBody(req);
            const planId = body.plan_id as string;
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }

            const ctx: AgentContext = { conversationHistory: [] };
            const prompt = `Generate a comprehensive UI test plan for plan ${planId}. Include tests for every page, every component, all navigation flows, and accessibility checks.`;
            const response = await orchestrator.callAgent('ui_testing', prompt, ctx);

            // Try to parse the structured test plan
            let testPlan = null;
            try {
                const cleaned = response.content.replace(/```(?:json)?\s*/g, '').replace(/```/g, '');
                const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
                if (jsonMatch) { testPlan = JSON.parse(jsonMatch[0]); }
            } catch { /* parse failed */ }

            const uiAiLevel = getPlanAiLevel(database, planId);
            createAutoTicket(database, 'verification',
                'UI Test Plan Generated',
                'AI generated a UI test plan for plan ' + planId + '.\n' +
                (testPlan ? 'Total tests: ' + (testPlan.total_tests || 0) + '\nPages tested: ' + (testPlan.pages_tested || 0) : 'Could not parse structured test plan.'),
                'P2', uiAiLevel);

            json(res, { test_plan: testPlan, raw_response: response.content });
            return true;
        }

        if (route === 'ai/observation-review' && method === 'POST') {
            const ctx: AgentContext = { conversationHistory: [] };
            const prompt = 'Run a comprehensive system review. Analyze task completion patterns, agent performance, code quality signals, architecture health, process efficiency, and ticket trends. Provide actionable improvement recommendations.';
            const response = await orchestrator.callAgent('observation', prompt, ctx);

            let report = null;
            try {
                const cleaned = response.content.replace(/```(?:json)?\s*/g, '').replace(/```/g, '');
                const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
                if (jsonMatch) { report = JSON.parse(jsonMatch[0]); }
            } catch { /* parse failed */ }

            json(res, { report, raw_response: response.content, actions: response.actions || [] });
            return true;
        }

        if (route === 'ai/bug-check' && method === 'POST') {
            const body = await parseBody(req);
            const planId = body.plan_id as string;
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const plan = database.getPlan(planId);
            if (!plan) { json(res, { error: 'Plan not found' }, 404); return true; }

            const pages = database.getDesignPagesByPlan(planId);
            const allComponents: DesignComponent[] = [];
            for (const page of pages) {
                allComponents.push(...database.getDesignComponentsByPage(page.id));
            }
            const dataModels = database.getDataModelsByPlan(planId);

            // Deterministic checks
            const issues: Array<{ severity: string; location: string; description: string; suggested_fix: string }> = [];
            // Check for pages without components
            for (const page of pages) {
                const pageComps = allComponents.filter(c => c.page_id === page.id);
                if (pageComps.length === 0) {
                    issues.push({ severity: 'warning', location: `Page: ${page.name}`, description: 'Page has no components', suggested_fix: 'Add components or remove the empty page' });
                }
            }
            // Check for data models without bound components
            for (const model of dataModels) {
                if (model.bound_components.length === 0) {
                    issues.push({ severity: 'info', location: `Model: ${model.name}`, description: 'Data model not bound to any component', suggested_fix: 'Bind to a Table, List, or Form component' });
                }
            }

            // LLM-based checks
            try {
                const prompt = `You are a design QA bot. Check this project for issues.
Plan: ${plan.name}
Pages: ${pages.map(p => p.name).join(', ')}
Components: ${allComponents.length}
Data Models: ${dataModels.map(m => m.name + '(' + m.fields.length + ' fields)').join(', ')}

Find 0-5 issues as JSON array: [{"severity":"error|warning|info","location":"...","description":"...","suggested_fix":"..."}]
Only return the JSON array.`;
                const ctx: AgentContext = { conversationHistory: [] };
                const response = await orchestrator.callAgent('planning', prompt, ctx);
                try {
                    const cleaned = response.content.replace(/```(?:json)?\s*/g, '').replace(/```/g, '');
                    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
                    if (jsonMatch) {
                        const aiIssues = JSON.parse(jsonMatch[0]);
                        issues.push(...aiIssues);
                    }
                } catch { /* parse failed */ }
            } catch { /* LLM call failed — continue with deterministic results */ }

            // Auto-create element issues for errors
            for (const issue of issues) {
                if (issue.severity === 'error') {
                    database.createElementIssue({
                        element_id: 'plan-' + planId,
                        element_type: 'page',
                        plan_id: planId,
                        description: `${issue.location}: ${issue.description}`,
                        status: 'open',
                        severity: 'bug',
                        mode: 'fullstack',
                        reported_by: 'ai-bug-check',
                    } as any);
                }
            }
            eventBus.emit('ai:bug_check_completed', 'webapp', { planId, issueCount: issues.length });
            json(res, { issues, count: issues.length });
            return true;
        }

        // ==================== AI CHAT OVERLAY ====================

        // GET /api/ai-chat/sessions — list chat sessions
        if (route === 'ai-chat/sessions' && method === 'GET') {
            const url = new URL(req.url || '', 'http://localhost');
            const planId = url.searchParams.get('plan_id') || undefined;
            const status = url.searchParams.get('status') || undefined;
            const sessions = database.getAiChatSessions(planId, status);
            json(res, { sessions, total: sessions.length });
            return true;
        }

        // POST /api/ai-chat/sessions — create a new chat session (+ parent ticket)
        if (route === 'ai-chat/sessions' && method === 'POST') {
            const body = await parseBody(req);
            const planId = (body.plan_id as string) || null;
            const sessionName = (body.session_name as string) || 'Chat Session';

            // Create parent ticket for this chat session
            const ticket = database.createTicket({
                title: 'AI Chat: ' + sessionName,
                body: 'Ticket-backed AI chat session' + (planId ? ' for plan ' + planId : ''),
                priority: TicketPriority.P3,
                creator: 'system',
            });

            const session = database.createAiChatSession({
                plan_id: planId,
                ticket_id: ticket.id,
                session_name: sessionName,
            });

            eventBus.emit('ai_chat:session_created', 'webapp', { sessionId: session.id, ticketId: ticket.id, planId });
            json(res, session, 201);
            return true;
        }

        // GET /api/ai-chat/sessions/:id/messages — get messages for a session
        {
            const sessionId = extractParam(route, 'ai-chat/sessions/:id/messages');
            if (sessionId && method === 'GET') {
                const session = database.getAiChatSession(sessionId);
                if (!session) { json(res, { error: 'Session not found' }, 404); return true; }
                const messages = database.getAiChatMessages(sessionId);
                json(res, { session_id: sessionId, messages, total: messages.length });
                return true;
            }
        }

        // POST /api/ai-chat/sessions/:id/messages — send a message (+ AI response)
        {
            const sessionId = extractParam(route, 'ai-chat/sessions/:id/messages');
            if (sessionId && method === 'POST') {
                const session = database.getAiChatSession(sessionId);
                if (!session) { json(res, { error: 'Session not found' }, 404); return true; }

                const body = await parseBody(req);
                const content = body.content as string;
                const context = (body.context || {}) as Record<string, unknown>;
                const aiLevel = (body.ai_level as string) || 'suggestions';

                if (!content) { json(res, { error: 'content is required' }, 400); return true; }

                const contextPage = (context.page as string) || '';
                const contextElementId = (context.element_id as string) || null;
                const contextElementType = (context.element_type as string) || null;

                // Store user message
                const userReply = session.ticket_id
                    ? database.addTicketReply(session.ticket_id, 'user', content)
                    : null;

                const userMsg = database.addAiChatMessage({
                    session_id: sessionId,
                    role: 'user',
                    content,
                    context_page: contextPage,
                    context_element_id: contextElementId,
                    context_element_type: contextElementType,
                    ai_level: aiLevel,
                    ticket_reply_id: userReply?.id ?? null,
                });

                eventBus.emit('ai_chat:message_sent', 'webapp', {
                    sessionId, messageId: userMsg.id, role: 'user',
                });

                // Generate AI response unless Manual mode
                let aiResponse: string | null = null;
                if (aiLevel !== 'manual') {
                    try {
                        // Build context-aware system prompt
                        const previousMessages = database.getAiChatMessages(sessionId, 20);
                        const history = previousMessages
                            .slice(-10)
                            .map(m => '[' + m.role + ']: ' + m.content)
                            .join('\n');

                        let systemPrompt = 'You are an AI assistant for the COE (Copilot Orchestration Extension) project designer. ';
                        systemPrompt += 'You help users design software projects through a visual planning tool. ';
                        if (contextPage) systemPrompt += 'The user is currently on the "' + contextPage.replace('page-', '') + '" page. ';
                        if (contextElementType && contextElementId) {
                            systemPrompt += 'They have selected a ' + contextElementType + ' element. ';
                        }
                        systemPrompt += 'Be concise and helpful. Respond in 1-3 sentences unless more detail is needed. ';
                        // Add AI level behavior instructions
                        const levelStyle = getAiResponseStyle(aiLevel);
                        if (levelStyle) systemPrompt += '\n\nBehavior mode: ' + levelStyle;

                        const userPrompt = history ? history + '\n[user]: ' + content : content;

                        const agentCtx: AgentContext = { conversationHistory: [] };
                        const response = await orchestrator.callAgent('answer', userPrompt, agentCtx);
                        aiResponse = response.content || 'I could not generate a response.';
                    } catch {
                        aiResponse = 'Sorry, the AI service is currently unavailable. Please try again later.';
                    }

                    // Store AI response
                    const aiReply = session.ticket_id
                        ? database.addTicketReply(session.ticket_id, 'ai', aiResponse)
                        : null;

                    const aiMsg = database.addAiChatMessage({
                        session_id: sessionId,
                        role: 'ai',
                        content: aiResponse,
                        context_page: contextPage,
                        context_element_id: contextElementId,
                        context_element_type: contextElementType,
                        ai_level: aiLevel,
                        ticket_reply_id: aiReply?.id ?? null,
                    });

                    eventBus.emit('ai_chat:message_sent', 'webapp', {
                        sessionId, messageId: aiMsg.id, role: 'ai',
                    });
                }

                json(res, {
                    user_message: userMsg,
                    ai_response: aiResponse,
                }, 201);
                return true;
            }
        }

        // POST /api/ai-chat/sessions/:id/archive — archive a session
        {
            const sessionId = extractParam(route, 'ai-chat/sessions/:id/archive');
            if (sessionId && method === 'POST') {
                const session = database.getAiChatSession(sessionId);
                if (!session) { json(res, { error: 'Session not found' }, 404); return true; }
                database.updateAiChatSession(sessionId, { status: 'archived' });
                eventBus.emit('ai_chat:session_archived', 'webapp', { sessionId });
                json(res, { success: true });
                return true;
            }
        }

        // Not found
        json(res, { error: 'API route not found: ' + route }, 404);
        return true;

    } catch (err) {
        json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
        return true;
    }
}
