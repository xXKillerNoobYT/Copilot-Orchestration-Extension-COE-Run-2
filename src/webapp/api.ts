import * as http from 'http';
import { Database } from '../core/database';
import { Orchestrator } from '../agents/orchestrator';
import { ConfigManager } from '../core/config';
import { CodingAgentService } from '../core/coding-agent';
import { getEventBus } from '../core/event-bus';
import { AgentContext, DesignComponent, LeadAgentQueue, ModelCapability, PlanStatus, TaskPriority, TicketPriority, TicketStatus, TreeNodeStatus, UserProgrammingLevel, WorkflowExecutionStatus, WorkflowStatus, WorkflowStepType } from '../types';

/** Shared no-op output channel for inline service construction */
export const noopOutputChannel = { appendLine(_msg: string) {} } as any;

// ==================== AUTO-TICKET HELPERS ====================

/** Determines if a ticket should be created for this operation type at the given AI level */
function shouldCreateTicket(operationType: string, aiLevel: string): boolean {
    const majorOps = ['plan_generation', 'coding_session'];
    const mediumOps = ['design_change', 'suggestion'];
    // Manual: only major ops
    if (aiLevel === 'manual') return majorOps.includes(operationType);
    // Suggest: major + medium
    if (aiLevel === 'suggest' || aiLevel === 'suggestions') return majorOps.includes(operationType) || mediumOps.includes(operationType);
    // Smart/Hybrid: everything
    return true;
}

/** Auto-generated acceptance criteria by deliverable type */
const ACCEPTANCE_CRITERIA_TEMPLATES: Record<string, string> = {
    plan_generation: 'Tasks generated with titles, descriptions, priorities, estimates, acceptance criteria. All tasks 15-45 min. Scaffold tasks created before feature tasks.',
    design_change: 'All specified pages have header + nav + content area. Components positioned within canvas bounds. Design tokens applied.',
    code_generation: 'Code compiles. Tests pass. Matches acceptance criteria of linked task. Files created/modified listed in task completion.',
    communication: 'Reply clarity score >= 85 (Clarity Agent verified).',
    verification: 'All acceptance criteria checked. Test results recorded. No failed criteria.',
};

/** Context for richer auto-tickets */
interface AutoTicketContext {
    planConfig?: { scale?: string; focus?: string; techStack?: string; aiLevel?: string; priorities?: string };
    pageDesigns?: Array<{ id: string; name: string; route?: string; componentCount?: number }>;
    taskDependencies?: string[];
    targetAgent?: string;
    expectedDeliverables?: string[];
    acceptanceCriteria?: string;
    sourcePageIds?: string[];
    sourceComponentIds?: string[];
    stage?: number;
    deliverableType?: string;
}

/** Creates an auto-ticket if the AI level permits it */
function createAutoTicket(
    database: Database,
    operationType: string,
    title: string,
    body: string,
    priority: string,
    aiLevel: string,
    parentTicketId?: string | null,
    context?: AutoTicketContext
): { id: string; ticket_number: number } | null {
    if (!shouldCreateTicket(operationType, aiLevel)) return null;

    // Determine deliverable type from operation or explicit context
    const deliverableType = context?.deliverableType || operationType;

    // Build enriched body with plan context
    let enrichedBody = body;
    if (context?.planConfig) {
        const cfg = context.planConfig;
        const parts: string[] = [];
        if (cfg.scale) parts.push(`Scale: ${cfg.scale}`);
        if (cfg.focus) parts.push(`Focus: ${cfg.focus}`);
        if (cfg.techStack) parts.push(`Tech: ${cfg.techStack}`);
        if (cfg.aiLevel) parts.push(`AI Level: ${cfg.aiLevel}`);
        if (parts.length > 0) enrichedBody += `\n\n**Plan Context**: ${parts.join(' | ')}`;
    }
    if (context?.pageDesigns && context.pageDesigns.length > 0) {
        const pageList = context.pageDesigns.map(p => `- ${p.name}${p.route ? ` (${p.route})` : ''}${p.componentCount != null ? ` [${p.componentCount} components]` : ''}`).join('\n');
        enrichedBody += `\n\n**Related Pages**:\n${pageList}`;
    }
    if (context?.taskDependencies && context.taskDependencies.length > 0) {
        enrichedBody += `\n\n**Dependencies**: ${context.taskDependencies.join(', ')}`;
    }
    if (context?.expectedDeliverables && context.expectedDeliverables.length > 0) {
        enrichedBody += `\n\n**Expected Deliverables**: ${context.expectedDeliverables.join(', ')}`;
    }

    // Auto-generate acceptance criteria if not explicitly provided
    const acceptanceCriteria = context?.acceptanceCriteria
        || ACCEPTANCE_CRITERIA_TEMPLATES[deliverableType]
        || null;

    const ticket = database.createTicket({
        title,
        body: enrichedBody,
        priority: priority as any,
        creator: 'system',
        parent_ticket_id: parentTicketId ?? null,
        auto_created: true,
        operation_type: operationType,
        acceptance_criteria: acceptanceCriteria,
        deliverable_type: (deliverableType || null) as import('../types').TicketDeliverableType,
        source_page_ids: context?.sourcePageIds ? JSON.stringify(context.sourcePageIds) : null,
        source_component_ids: context?.sourceComponentIds ? JSON.stringify(context.sourceComponentIds) : null,
        stage: context?.stage ?? undefined,
    });
    return ticket;
}

// ==================== AGENT RESOLUTION ====================

/** Maps ticket operation_type + title patterns to agent info for display */
function resolveAgentForTicket(ticket: { operation_type?: string; title: string; processing_agent?: string | null }): {
    agentName: string; agentLabel: string; agentColor: string;
} {
    // If explicitly set, use that
    if (ticket.processing_agent) {
        // v4.1 (Bug 6B): Complete color + label mappings for all 15 agents
        const agentColors: Record<string, string> = {
            planning: '#4a9eff', verification: '#22c55e', coding: '#a855f7',
            boss: '#eab308', design_architect: '#4a9eff', gap_hunter: '#4a9eff',
            design_hardener: '#4a9eff', decision_memory: '#6366f1',
            review: '#10b981', ui_testing: '#f97316', observation: '#8b5cf6',
            clarity: '#06b6d4', answer: '#3b82f6', research: '#14b8a6',
            custom: '#ec4899',
        };
        const agentLabels: Record<string, string> = {
            planning: 'Planning Team', verification: 'Verification Team', coding: 'Coding Agent',
            boss: 'Boss AI', design_architect: 'Design Architect', gap_hunter: 'Gap Hunter',
            design_hardener: 'Design Hardener', decision_memory: 'Decision Memory',
            review: 'Review Agent', ui_testing: 'UI Testing', observation: 'Observation Agent',
            clarity: 'Clarity Agent', answer: 'Answer Agent', research: 'Research Agent',
            custom: 'Custom Agent',
        };
        return {
            agentName: ticket.processing_agent,
            agentLabel: agentLabels[ticket.processing_agent] || ticket.processing_agent,
            agentColor: agentColors[ticket.processing_agent] || '#6b7280',
        };
    }

    const op = ticket.operation_type || '';
    const title = ticket.title.toLowerCase();

    if (op === 'boss_directive') return { agentName: 'boss', agentLabel: 'Boss AI', agentColor: '#eab308' };
    if (op === 'verification' || title.startsWith('verify:')) return { agentName: 'verification', agentLabel: 'Verification Team', agentColor: '#22c55e' };
    if (title.startsWith('coding:') || title.startsWith('rework:') || op === 'code_generation') return { agentName: 'coding', agentLabel: 'Coding Agent', agentColor: '#a855f7' };
    if (op === 'design_change' || title.startsWith('phase: design') || title.startsWith('phase: data model')) return { agentName: 'planning', agentLabel: 'Planning Team', agentColor: '#4a9eff' };
    if (op === 'plan_generation' || title.startsWith('phase: task generation')) return { agentName: 'planning', agentLabel: 'Planning Team', agentColor: '#4a9eff' };
    if (op === 'user_created') return { agentName: 'user', agentLabel: 'User', agentColor: '#6b7280' };

    return { agentName: 'planning', agentLabel: 'Planning Team', agentColor: '#4a9eff' };
}

// ==================== JSON REPAIR HELPERS ====================

/**
 * Attempts to repair malformed JSON from LLM responses.
 * Progressive repair: trailing commas → single quotes → unquoted keys → truncation → trailing content.
 */
function repairJson(raw: string): { parsed: any; repaired: boolean; error: string | null; repairs: string[] } {
    const repairs: string[] = [];
    let text = raw;

    // Step 1: Strip markdown fences
    text = text.replace(/```(?:json)?\s*/g, '').replace(/```/g, '');
    if (text !== raw) repairs.push('stripped_markdown_fences');

    // Step 2: Fix trailing commas before } or ]
    const trailingCommaFixed = text.replace(/,\s*([}\]])/g, '$1');
    if (trailingCommaFixed !== text) { text = trailingCommaFixed; repairs.push('fixed_trailing_commas'); }

    // Step 3: Fix single-quoted strings to double quotes (skip embedded apostrophes in words)
    const singleQuoteFixed = text.replace(/(?<![a-zA-Z])'([^']*)'(?![a-zA-Z])/g, '"$1"');
    if (singleQuoteFixed !== text) { text = singleQuoteFixed; repairs.push('fixed_single_quotes'); }

    // Step 4: Fix unquoted property names
    const unquotedKeyFixed = text.replace(/(?<=[{,]\s*)([a-zA-Z_]\w*)\s*:/g, '"$1":');
    if (unquotedKeyFixed !== text) { text = unquotedKeyFixed; repairs.push('fixed_unquoted_keys'); }

    // Step 5: Fix control characters in strings (raw newlines/tabs inside quoted strings)
    // v4.1 (Bug 6C): Use lookbehind to avoid double-escaping already-escaped sequences
    const controlFixed = text.replace(/"([^"]*?)"/g, (_match, content) => {
        const cleaned = content
            .replace(/(?<!\\)\n/g, '\\n')
            .replace(/(?<!\\)\t/g, '\\t')
            .replace(/(?<!\\)\r/g, '\\r');
        return '"' + cleaned + '"';
    });
    if (controlFixed !== text) { text = controlFixed; repairs.push('fixed_control_chars'); }

    // Try parsing after basic repairs
    try {
        const jsonMatch = text.match(/[\[{][\s\S]*[}\]]/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return { parsed, repaired: repairs.length > 0, error: null, repairs };
        }
    } catch { /* continue to more aggressive repairs */ }

    // Step 6: Remove trailing content after the last valid } or ]
    const lastBrace = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
    if (lastBrace > 0) {
        const trimmed = text.substring(0, lastBrace + 1);
        if (trimmed !== text) { text = trimmed; repairs.push('removed_trailing_content'); }

        try {
            const jsonMatch = text.match(/[\[{][\s\S]*[}\]]/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return { parsed, repaired: true, error: null, repairs };
            }
        } catch { /* continue */ }
    }

    // Step 7: Close truncated JSON — count unmatched brackets
    const jsonStart = text.match(/[\[{]/);
    if (jsonStart) {
        let fromStart = text.substring(text.indexOf(jsonStart[0]));
        const openBraces: string[] = [];
        let inString = false;
        let escaped = false;
        for (const ch of fromStart) {
            if (escaped) { escaped = false; continue; }
            if (ch === '\\') { escaped = true; continue; }
            if (ch === '"') { inString = !inString; continue; }
            if (inString) continue;
            if (ch === '{') openBraces.push('}');
            else if (ch === '[') openBraces.push(']');
            else if (ch === '}' || ch === ']') openBraces.pop();
        }
        if (openBraces.length > 0) {
            // Remove any trailing partial value (incomplete string or number)
            fromStart = fromStart.replace(/,\s*"[^"]*$/, '');      // trailing incomplete string value
            fromStart = fromStart.replace(/,\s*[a-zA-Z0-9]*$/, ''); // trailing incomplete value
            fromStart = fromStart.replace(/,\s*$/, '');              // trailing comma
            fromStart += openBraces.reverse().join('');
            repairs.push('closed_truncated_json');

            try {
                const parsed = JSON.parse(fromStart);
                return { parsed, repaired: true, error: null, repairs };
            } catch (e) {
                return { parsed: null, repaired: false, error: `Repair failed after all steps: ${String(e)}`, repairs };
            }
        }
    }

    return { parsed: null, repaired: false, error: 'No valid JSON structure found after all repair attempts', repairs };
}

/**
 * Parses AI-generated JSON with automatic repair.
 * Tries direct parse first, then repair, logs results.
 */
function parseAIJson<T>(raw: string, context: string): { data: T | null; error: string | null; repaired: boolean } {
    // Fast path: direct parse after stripping markdown fences
    const cleaned = raw.replace(/```(?:json)?\s*/g, '').replace(/```/g, '');
    const jsonMatch = cleaned.match(/[\[{][\s\S]*[}\]]/);
    if (jsonMatch) {
        try {
            const data = JSON.parse(jsonMatch[0]) as T;
            return { data, error: null, repaired: false };
        } catch { /* fall through to repair */ }
    }

    // Repair path
    const result = repairJson(raw);
    if (result.parsed) {
        console.log(`[COE] JSON repair succeeded for ${context}. Repairs: ${result.repairs.join(', ')}`);
        return { data: result.parsed as T, error: null, repaired: true };
    }

    return { data: null, error: result.error || 'JSON parse failed', repaired: false };
}

/**
 * Determines whether an action should auto-apply based on AI level and priority.
 * - Manual: never auto-apply
 * - Suggest: never auto-apply (show suggestions only)
 * - Smart: auto-apply safe changes (P3/P4), ask for P1/P2
 * - Hybrid: auto-apply P3/P4, suggest P1/P2
 */
function shouldAutoApply(aiLevel: string, priority: string): boolean {
    if (aiLevel === 'manual' || aiLevel === 'suggest' || aiLevel === 'suggestions') return false;
    // Smart and Hybrid: auto-apply low-priority (safe) changes
    const safePriorities = ['P3', 'P4', 'p3', 'p4'];
    return safePriorities.includes(priority);
}

/**
 * Determines if AI should respond to user messages at a given level.
 * - Manual: no AI response (store message only)
 * - Suggest/Smart/Hybrid: respond
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
        case 'suggest': case 'suggestions': return 'Provide suggestions and recommendations. Do NOT auto-apply changes. Ask for user confirmation before any actions.';
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
            const raw = (config.design?.aiLevel as string) || (config.aiLevel as string) || 'smart';
            return raw === 'suggestions' ? 'suggest' : raw;
        }
    } catch { /* ignore */ }
    return 'smart';
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
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer | string) => {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        });
        req.on('end', () => {
            try {
                const raw = Buffer.concat(chunks).toString('utf-8');
                resolve(raw ? JSON.parse(raw) : {});
            }
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

    if (response.files?.length > 0) {
        for (const file of response.files) {
            parts.push(`\n📄 ${file.name}:`);
            parts.push('```' + file.language + '\n' + file.content + '\n```');
        }
    } else if (response.code) {
        parts.push('```' + response.language + '\n' + response.code + '\n```');
    }

    if (response.warnings?.length > 0) {
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
    codingAgentService?: CodingAgentService,
    ticketProcessor?: import('../core/ticket-processor').TicketProcessorService
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
                sort_order: (body.sort_order as number) ?? 0,
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
                operation_type: (body.operation_type as string) || 'user_created',
                acceptance_criteria: (body.acceptance_criteria as string) || null,
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

            // v4.1: If ticket is held for user review, user reply unblocks it
            const replyAuthor = (body.author as string) || 'user';
            if (replyAuthor === 'user') {
                const ticket = database.getTicket(replyTicketId);
                if (ticket && ticket.processing_status === 'holding') {
                    database.updateTicket(replyTicketId, {
                        processing_status: 'queued',
                    });
                    database.addTicketReply(replyTicketId, 'system',
                        'User provided feedback — ticket unblocked and re-queued for processing.');
                    eventBus.emit('ticket:unblocked', 'webapp', { ticketId: replyTicketId });
                }
            }

            json(res, reply, 201);
            return true;
        }

        // v4.1: Ticket run history (WS1A + WS2+6)
        const runTicketId = extractParam(route, 'tickets/:id/runs');
        if (runTicketId && method === 'GET') {
            const runs = database.getTicketRuns(runTicketId);
            json(res, runs);
            return true;
        }

        const latestRunTicketId = extractParam(route, 'tickets/:id/runs/latest');
        if (latestRunTicketId && method === 'GET') {
            const run = database.getLatestTicketRun(latestRunTicketId);
            if (!run) { json(res, { error: 'No runs found for this ticket' }, 404); return true; }
            json(res, run);
            return true;
        }

        // v5.0: Run steps — modular agent step history per run
        const runStepsMatch = route.match(/^tickets\/([^/]+)\/runs\/([^/]+)\/steps$/);
        if (runStepsMatch && method === 'GET') {
            const steps = database.getRunSteps(runStepsMatch[2]);
            json(res, steps);
            return true;
        }

        // v4.1: AI Suggestion endpoints (WS2C)
        if (route === 'suggestions' && method === 'GET') {
            const url = new URL(req.url || '', 'http://localhost');
            const planId = url.searchParams.get('plan_id');
            const status = url.searchParams.get('status') as string | null;
            if (!planId) { json(res, { error: 'plan_id is required' }, 400); return true; }
            const suggestions = database.getAISuggestionsByPlan(planId, status ?? undefined);
            json(res, suggestions);
            return true;
        }

        const suggestApproveId = extractParam(route, 'suggestions/:id/approve');
        if (suggestApproveId && method === 'POST') {
            const result = database.approveSuggestion(suggestApproveId);
            if (!result) { json(res, { error: 'Suggestion not found' }, 404); return true; }
            eventBus.emit('ai:suggestion_accepted', 'webapp', { suggestionId: suggestApproveId });
            json(res, result);
            return true;
        }

        const suggestRejectId = extractParam(route, 'suggestions/:id/reject');
        if (suggestRejectId && method === 'POST') {
            const body = await parseBody(req);
            const reason = (body.reason as string) || undefined;
            const result = database.rejectSuggestion(suggestRejectId, reason);
            if (!result) { json(res, { error: 'Suggestion not found' }, 404); return true; }
            eventBus.emit('ai:suggestion_dismissed', 'webapp', { suggestionId: suggestRejectId, reason });
            json(res, result);
            return true;
        }

        const suggestTargetType = extractParam(route, 'suggestions/target/:id');
        if (suggestTargetType && method === 'GET') {
            const url = new URL(req.url || '', 'http://localhost');
            const targetType = url.searchParams.get('type') || 'component';
            const suggestions = database.getSuggestionsByTarget(targetType, suggestTargetType);
            json(res, suggestions);
            return true;
        }

        // Single ticket operations
        const ticketId = extractParam(route, 'tickets/:id');
        if (ticketId && !route.includes('/replies') && !route.includes('/children') && !route.includes('/runs') && method === 'GET') {
            const ticket = database.getTicket(ticketId);
            if (!ticket) { json(res, { error: 'Ticket not found' }, 404); return true; }
            const replies = database.getTicketReplies(ticketId);
            const childCount = database.getChildTicketCount(ticketId);
            const agentInfo = resolveAgentForTicket(ticket);
            const stageLabels: Record<number, string> = { 1: 'Stage 1: Plan & Design', 2: 'Stage 2: Coding', 3: 'Stage 3: Verification' };
            json(res, {
                ...ticket,
                replies,
                child_count: childCount,
                assigned_agent: agentInfo.agentName,
                agent_label: agentInfo.agentLabel,
                agent_color: agentInfo.agentColor,
                stage_label: ticket.stage ? stageLabels[ticket.stage] || null : null,
            });
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

        // ==================== PLAN FILES (v5.0) ====================
        // Upload/manage reference documents that form the project's source of truth
        if (route.startsWith('plan-files') || route.startsWith('plans/') && route.includes('/files')) {
            // GET /api/plan-files?plan_id=xxx — get all files for a plan
            if (route === 'plan-files' && method === 'GET') {
                const planId = new URL(req.url || '', 'http://localhost').searchParams.get('plan_id');
                if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
                const files = database.getPlanFiles(planId);
                json(res, files);
                return true;
            }

            // POST /api/plan-files — upload a new plan file
            if (route === 'plan-files' && method === 'POST') {
                const body = await parseBody(req);
                const planId = body.plan_id as string;
                const filename = body.filename as string;
                const content = body.content as string;
                if (!planId || !filename || !content) {
                    json(res, { error: 'plan_id, filename, and content are required' }, 400);
                    return true;
                }
                // Detect file type from extension
                const ext = (filename.split('.').pop() || '').toLowerCase();
                const fileType = ext === 'md' ? 'markdown' : ext === 'txt' ? 'text' : ext === 'doc' || ext === 'docx' ? 'document' : 'text';
                const file = database.addPlanFile({
                    plan_id: planId,
                    filename: filename,
                    file_type: fileType,
                    content: content,
                    category: (body.category as string) || 'general',
                    source_path: body.source_path as string | undefined,
                    is_linked: !!body.is_linked,
                });
                eventBus.emit('plan:file_uploaded', 'webapp', { planId, fileId: (file as any).id, filename });
                database.addAuditLog('webapp', 'plan_file_uploaded', `Plan file "${filename}" uploaded for plan ${planId}`);
                json(res, file, 201);
                return true;
            }

            // GET /api/plan-files/:id — get a specific plan file
            const fileId = extractParam(route, 'plan-files/:id');
            if (fileId && method === 'GET') {
                const file = database.getPlanFile(fileId);
                if (!file) { json(res, { error: 'Plan file not found' }, 404); return true; }
                json(res, file);
                return true;
            }

            // PUT /api/plan-files/:id — update a plan file
            if (fileId && method === 'PUT') {
                const body = await parseBody(req);
                const updated = database.updatePlanFile(fileId, body as Record<string, unknown>);
                if (!updated) { json(res, { error: 'Plan file not found' }, 404); return true; }
                json(res, updated);
                return true;
            }

            // DELETE /api/plan-files/:id — delete a plan file
            if (fileId && method === 'DELETE') {
                const deleted = database.deletePlanFile(fileId);
                json(res, { success: deleted }, deleted ? 200 : 404);
                return true;
            }

            // GET /api/plan-files/context?plan_id=xxx — get combined plan file content for agents
            if (route === 'plan-files/context' && method === 'GET') {
                const planId = new URL(req.url || '', 'http://localhost').searchParams.get('plan_id');
                if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
                const context = database.getPlanFileContext(planId);
                json(res, { plan_id: planId, context: context, file_count: database.getPlanFiles(planId).length });
                return true;
            }

            // GET /api/plan-files/changes?plan_id=xxx — get change history for a plan
            if (route === 'plan-files/changes' && method === 'GET') {
                const planId = new URL(req.url || '', 'http://localhost').searchParams.get('plan_id');
                if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
                const changes = database.getPlanFileChanges(planId);
                json(res, changes);
                return true;
            }

            // POST /api/plan-files/sync/:id — sync a linked file from disk (re-read content)
            const syncFileId = extractParam(route, 'plan-files/sync/:id');
            if (syncFileId && method === 'POST') {
                const file = database.getPlanFile(syncFileId);
                if (!file) { json(res, { error: 'Plan file not found' }, 404); return true; }
                const sourcePath = file.source_path as string;
                if (!sourcePath) { json(res, { error: 'File is not linked to a local path' }, 400); return true; }
                try {
                    const fs = await import('fs');
                    if (!fs.existsSync(sourcePath)) {
                        json(res, { error: 'Source file not found at: ' + sourcePath }, 404);
                        return true;
                    }
                    const newContent = fs.readFileSync(sourcePath, 'utf-8');
                    const updated = database.updatePlanFile(syncFileId, { content: newContent });
                    database.addAuditLog('webapp', 'plan_file_synced', `Synced plan file "${file.filename}" from ${sourcePath}`);
                    json(res, { synced: true, file: updated, version: (updated as any)?.version });
                } catch (e) {
                    json(res, { error: 'Failed to sync: ' + String(e) }, 500);
                }
                return true;
            }

            // POST /api/plan-files/folders — link a local folder to a plan
            if (route === 'plan-files/folders' && method === 'POST') {
                const body = await parseBody(req);
                const planId = body.plan_id as string;
                const folderPath = body.folder_path as string;
                if (!planId || !folderPath) {
                    json(res, { error: 'plan_id and folder_path are required' }, 400);
                    return true;
                }
                const folder = database.addPlanFileFolder(planId, folderPath, body.file_patterns as string);
                database.addAuditLog('webapp', 'plan_folder_linked', `Linked folder "${folderPath}" to plan ${planId}`);
                json(res, folder, 201);
                return true;
            }

            // GET /api/plan-files/folders?plan_id=xxx — get linked folders for a plan
            if (route === 'plan-files/folders' && method === 'GET') {
                const planId = new URL(req.url || '', 'http://localhost').searchParams.get('plan_id');
                if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
                try {
                    const folders = database.getPlanFileFolders(planId);
                    json(res, folders);
                } catch {
                    // v9.0: Return empty array if table/query fails (e.g. fresh DB without plan_file_folders table)
                    json(res, { success: true, data: [] });
                }
                return true;
            }

            // DELETE /api/plan-files/folders/:id — unlink a folder
            const folderId = extractParam(route, 'plan-files/folders/:id');
            if (folderId && method === 'DELETE') {
                const removed = database.removePlanFileFolder(folderId);
                json(res, { success: removed }, removed ? 200 : 404);
                return true;
            }

            // POST /api/plan-files/folders/scan — scan all linked folders for changes
            if (route === 'plan-files/folders/scan' && method === 'POST') {
                const body = await parseBody(req);
                const planId = body.plan_id as string;
                if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }

                const folders = database.getPlanFileFolders(planId);
                const fs = await import('fs');
                const path = await import('path');
                let filesAdded = 0;
                let filesUpdated = 0;
                const changedFileIds: string[] = [];

                for (const folder of folders) {
                    const folderPath = folder.folder_path as string;
                    if (!fs.existsSync(folderPath)) continue;

                    const patterns = ((folder.file_patterns as string) || '*.md,*.txt,*.doc,*.docx').split(',').map(p => p.trim().replace('*.', '.'));
                    const entries = fs.readdirSync(folderPath, { withFileTypes: true });

                    for (const entry of entries) {
                        if (!entry.isFile()) continue;
                        const ext = path.extname(entry.name).toLowerCase();
                        if (!patterns.includes(ext)) continue;

                        const fullPath = path.join(folderPath, entry.name);
                        const content = fs.readFileSync(fullPath, 'utf-8');
                        const contentHash = (await import('crypto')).createHash('sha256').update(content).digest('hex').substring(0, 16);

                        // Check if this file already exists in plan_files
                        const existingFiles = database.getPlanFiles(planId);
                        const existing = existingFiles.find(f => (f.source_path as string) === fullPath);

                        if (existing) {
                            // File exists — check if content changed
                            if ((existing.content_hash as string) !== contentHash) {
                                database.updatePlanFile(existing.id as string, { content });
                                filesUpdated++;
                                changedFileIds.push(existing.id as string);
                            }
                        } else {
                            // New file — add it
                            const newFile = database.addPlanFile({
                                plan_id: planId,
                                filename: entry.name,
                                content,
                                source_path: fullPath,
                                is_linked: true,
                            });
                            filesAdded++;
                            changedFileIds.push((newFile as any).id);
                        }
                    }

                    database.updateFolderScanTime(folder.id as string);
                }

                database.addAuditLog('webapp', 'plan_folders_scanned', `Scanned folders for plan ${planId}: ${filesAdded} added, ${filesUpdated} updated`);
                json(res, { plan_id: planId, files_added: filesAdded, files_updated: filesUpdated, changed_file_ids: changedFileIds });
                return true;
            }
        }

        if (route === 'plans/generate' && method === 'POST') {
            const body = await parseBody(req);
            const name = body.name as string;
            const description = body.description as string;
            const scale = (body.scale as string) || 'MVP';
            const focus = (body.focus as string) || 'Full Stack';
            const priorities = (body.priorities as string[]) || ['Core business logic'];
            const design = (body.design as Record<string, string>) || {};

            const rawAiLevel = (design.aiLevel as string) || (body.ai_level as string) || 'smart';
            const aiLevel = rawAiLevel === 'suggestions' ? 'suggest' : rawAiLevel;

            // Adjust prompt detail based on AI level
            const levelGuidance = aiLevel === 'manual'
                ? 'Generate minimal scaffolding tasks only — the user will define details manually.'
                : aiLevel === 'suggest'
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

            // TICKET-FIRST: Create tracking ticket BEFORE the LLM call
            const earlyParentTicket = createAutoTicket(database, 'plan_generation',
                'Plan: ' + name + ' \u2014 Generating...',
                'AI plan generation started.\nScale: ' + scale + ', Focus: ' + focus + '\nAI Level: ' + aiLevel + '\n\nStatus: Waiting for LLM response...',
                'P1', aiLevel);

            // Get plan file context — either from request body (wizard) or existing files
            const planFileContext = (body.plan_file_context as string) || '';
            const planFileSection = planFileContext
                ? [
                    '',
                    '=== REFERENCE DOCUMENTS (Source of Truth) ===',
                    'The user has provided the following reference documents that describe the project requirements,',
                    'design specifications, and constraints. Tasks MUST align with these documents.',
                    'If something in the project description seems to conflict with these documents,',
                    'prioritize the reference documents as the source of truth.',
                    '',
                    planFileContext,
                    '',
                    '=== END REFERENCE DOCUMENTS ===',
                    '',
                ].join('\n')
                : '';

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
                planFileSection,
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
                planFileContext ? 'IMPORTANT: Tasks MUST reference and align with the provided Reference Documents. Include specific references to document requirements in task descriptions.' : '',
                'IMPORTANT: You MUST respond with ONLY valid JSON. No explanation, no markdown, no text before or after.',
                'Response format:',
                '{"plan_name": "...", "tasks": [{"title": "...", "description": "...", "priority": "P1", "estimated_minutes": 30, "acceptance_criteria": "...", "depends_on_titles": []}]}',
            ].filter(Boolean).join('\n');

            const ctx: AgentContext = { conversationHistory: [] };
            const response = await orchestrator.callAgent('planning', prompt, ctx);

            // Try to parse structured response (with automatic JSON repair)
            type TaskGenResult = { plan_name?: string; tasks?: Array<{ title: string; description?: string; priority?: string; estimated_minutes?: number; acceptance_criteria?: string; depends_on_titles?: string[]; task_requirements?: Record<string, unknown> }> };
            const parseResult = parseAIJson<TaskGenResult>(response.content, 'task_generation');
            let parsed = parseResult.data;
            let parseError = parseResult.error;
            if (parseResult.repaired) {
                database.addAuditLog('planning', 'json_repaired', `Task generation JSON was repaired for plan "${name}"`);
            }
            if (parseError) {
                console.error(`[COE] Task generation JSON parse failed: ${parseError}. Response snippet: ${response.content.substring(0, 200)}`);
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

                // Update the early ticket with results (ticket-first pattern)
                if (earlyParentTicket) {
                    database.updateTicket(earlyParentTicket.id, {
                        title: 'Plan: ' + name + ' \u2014 Design & Implementation',
                        body: 'Master ticket for plan "' + name + '". Scale: ' + scale + ', Focus: ' + focus + '. ' + parsed.tasks.length + ' tasks generated.\n\nAI Assistance Level: ' + aiLevel,
                        status: TicketStatus.InReview,
                    });
                }
                const parentAutoTicket = earlyParentTicket;
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

            // Update early ticket to reflect partial success (plan created, tasks need manual addition or retry)
            if (earlyParentTicket) {
                database.updateTicket(earlyParentTicket.id, {
                    title: 'Plan: ' + name + ' \u2014 Needs Task Generation',
                    body: 'Plan "' + name + '" was created successfully but AI could not auto-generate structured tasks.\nReason: ' + genError + '\n' + detail +
                        '\n\nYou can retry AI generation or add tasks manually.' +
                        '\n\nScale: ' + scale + ', Focus: ' + focus + '\nAI Level: ' + aiLevel,
                    status: TicketStatus.InReview,
                });
            } else {
                createAutoTicket(database, 'plan_generation',
                    'Plan: ' + name + ' \u2014 Needs Task Generation',
                    'Plan created but AI task generation needs retry.\nReason: ' + genError + '\n' + detail,
                    'P2', aiLevel);
            }

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
            const rawRegenAiLevel = (planConfig.design as Record<string, unknown>)?.aiLevel as string || (rBody.ai_level as string) || 'smart';
            const regenAiLevel = rawRegenAiLevel === 'suggestions' ? 'suggest' : rawRegenAiLevel;

            // TICKET-FIRST: Create tracking ticket before LLM call
            const earlyRegenTicket = createAutoTicket(database, 'plan_generation',
                'Tasks Regenerating: ' + plan.name,
                'AI is regenerating tasks for plan "' + plan.name + '".\nScale: ' + rScale + ', Focus: ' + rFocus,
                'P2', regenAiLevel);

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

            const regenParseResult = parseAIJson<{ tasks?: Array<{ title: string; description?: string; priority?: string; estimated_minutes?: number; acceptance_criteria?: string; depends_on_titles?: string[]; task_requirements?: Record<string, unknown> }> }>(response.content, 'task_regeneration');
            const parsed = regenParseResult.data;
            if (regenParseResult.repaired) {
                database.addAuditLog('planning', 'json_repaired', `Task regeneration JSON was repaired for plan "${plan.name}"`);
            }
            if (regenParseResult.error) {
                console.error(`[COE] Task regeneration JSON parse failed: ${regenParseResult.error}. Snippet: ${response.content.substring(0, 200)}`);
            }

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

                // Update early ticket with results (ticket-first pattern)
                if (earlyRegenTicket) {
                    database.updateTicket(earlyRegenTicket.id, {
                        title: 'Tasks Regenerated: ' + plan.name,
                        body: 'AI regenerated ' + parsed.tasks.length + ' tasks.\nScale: ' + rScale + ', Focus: ' + rFocus,
                        status: TicketStatus.InReview,
                    });
                    for (const t of parsed.tasks) {
                        createAutoTicket(database, 'plan_generation',
                            'Task: ' + t.title,
                            (t.description || '') + '\nPriority: ' + (t.priority || 'P2'),
                            (t.priority || 'P2'), regenAiLevel, earlyRegenTicket.id);
                    }
                }

                json(res, { plan: database.getPlan(regenPlanId), taskCount: parsed.tasks.length, tasks: database.getTasksByPlan(regenPlanId) });
                return true;
            }

            // Update early ticket to reflect failure (or create fallback)
            if (earlyRegenTicket) {
                database.updateTicket(earlyRegenTicket.id, {
                    title: 'Task Regeneration Failed: ' + plan.name,
                    body: 'AI did not return valid tasks. User may retry.',
                });
            } else {
                createAutoTicket(database, 'plan_generation',
                    'Task Regeneration Failed: ' + plan.name,
                    'AI did not return valid tasks. User may retry.',
                    'P2', regenAiLevel);
            }

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
            const url = new URL(req.url || '', 'http://localhost');
            const agentFilter = url.searchParams.get('agent') || undefined;
            // Fetch a large set from DB — pagination is done client-side by paginateAndFilter
            const allAudit = database.getAuditLog(1000, agentFilter) as unknown as Record<string, unknown>[];
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

            // v5.0: Include plan file context for design generation
            const designPlanFileCtx = database.getPlanFileContext(planId);
            const designPlanFileSection = designPlanFileCtx
                ? `\n\n=== REFERENCE DOCUMENTS ===\nThe user has provided these reference documents. The design MUST align with them:\n${designPlanFileCtx}\n=== END REFERENCE DOCUMENTS ===\n`
                : '';

            const prompt = [
                `You are an expert UI layout designer. Generate a detailed visual page layout for a project called "${planName}".`,
                '',
                `Project: Scale=${scale}, Focus=${focus}, Tech Stack=${wizTechStack}`,
                planDesc ? `Description: ${planDesc}` : '',
                designPlanFileSection,
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

            // TICKET-FIRST: Create tracking ticket before LLM call
            const earlyDesignTicket = createAutoTicket(database, 'design_change',
                'Design Generating: ' + planName,
                'AI generating visual layout.\nLayout: ' + layout + ', Theme: ' + theme + ', Tech: ' + wizTechStack,
                'P2', designAiLevel);

            try {
                const ctx: AgentContext = { conversationHistory: [] };
                const response = await orchestrator.callAgent('planning', prompt, ctx);

                type DesignGenResult = { pages?: Array<{ name?: string; route?: string; background?: string; components?: Array<{ type?: string; name?: string; x?: number; y?: number; width?: number; height?: number; content?: string; styles?: Record<string, unknown> }> }> };
                const designParseResult = parseAIJson<DesignGenResult>(response.content, 'design_generation');
                const parsed = designParseResult.data;
                if (designParseResult.repaired) {
                    database.addAuditLog('planning', 'json_repaired', `Design generation JSON was repaired for plan "${planName}"`);
                }

                if (!parsed?.pages || !Array.isArray(parsed.pages) || parsed.pages.length === 0) {
                    if (earlyDesignTicket) {
                        database.updateTicket(earlyDesignTicket.id, {
                            title: 'Design Generation: No Layout Returned',
                            body: 'AI did not return a valid design layout for "' + planName + '".',
                        });
                    } else {
                        createAutoTicket(database, 'design_change',
                            'Design Generation: No Layout Returned',
                            'AI did not return a valid design layout for "' + planName + '".',
                            'P2', designAiLevel);
                    }
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

                // Update early ticket with results (ticket-first pattern)
                if (earlyDesignTicket) {
                    database.updateTicket(earlyDesignTicket.id, {
                        title: 'Design Generated: ' + planName,
                        body: 'AI design complete: ' + totalComponents + ' components across ' + createdPages.length + ' pages.\n' +
                            'Layout: ' + layout + ', Theme: ' + theme + ', Tech: ' + wizTechStack + '\n' +
                            'Pages: ' + parsed.pages.map(p => p.name || 'Unnamed').join(', '),
                        status: TicketStatus.InReview,
                    });
                }
                const designParentTicket = earlyDesignTicket;
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
                // Update early ticket to reflect failure (or create fallback)
                if (earlyDesignTicket) {
                    database.updateTicket(earlyDesignTicket.id, {
                        title: 'Design Generation Failed: ' + planName,
                        body: 'AI design generation failed.\nError: ' + String(err),
                    });
                } else {
                    createAutoTicket(database, 'design_change',
                        'Design Generation Failed: ' + planName,
                        'AI design generation failed.\nError: ' + String(err),
                        'P1', designAiLevel);
                }
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
                sort_order: (body.sort_order as number) ?? 0,
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
                sort_order: (body.sort_order as number) ?? 0,
                x: (body.x as number) ?? 0,
                y: (body.y as number) ?? 0,
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

        // ==================== CODING AUTO-PICK (v5.0) ====================
        // Auto-selects the next ticket that needs coding work,
        // creates or reuses a coding session, and generates a prompt
        if (route === 'coding/auto-pick' && method === 'POST') {
            // Find the next ticket that needs coding work
            // Priority: 1) tickets in 'queued' with coding agent 2) open coding tickets 3) any open ticket
            const allTickets = database.getTicketsByStatus('open');
            const inReviewTickets = database.getTicketsByStatus('in_review' as any);
            const allCandidates = [...allTickets, ...inReviewTickets];

            // Find coding-ready tickets
            let codingTicket = allCandidates.find(t =>
                t.processing_status === 'queued' &&
                (t.processing_agent === 'coding' || t.operation_type === 'code_generation')
            ) || allCandidates.find(t =>
                t.operation_type === 'code_generation' ||
                (t.title || '').toLowerCase().startsWith('coding:') ||
                (t.title || '').toLowerCase().startsWith('rework:')
            ) || allCandidates.find(t =>
                t.status === 'open' && t.operation_type !== 'boss_directive'
            );

            if (!codingTicket) {
                json(res, { error: 'No tickets need coding work right now', ticket: null, session: null }, 200);
                return true;
            }

            // Create or reuse a coding session for this ticket
            let session;
            const existingSessions = database.getAllCodingSessions() as unknown as Record<string, unknown>[];
            const existingSession = existingSessions.find((s: any) =>
                s.status === 'active' && s.name && s.name.includes(`TK-${String(codingTicket!.ticket_number).padStart(3, '0')}`)
            );

            if (existingSession) {
                session = existingSession;
            } else {
                session = database.createCodingSession({
                    name: `TK-${String(codingTicket.ticket_number).padStart(3, '0')}: ${codingTicket.title.substring(0, 50)}`,
                });
            }

            // Build a comprehensive prompt from the ticket
            const ticketReplies = database.getTicketReplies(codingTicket.id);
            const recentReplies = ticketReplies.slice(-3);

            let autoPrompt = `## Coding Task: TK-${String(codingTicket.ticket_number).padStart(3, '0')}\n\n`;
            autoPrompt += `**Title:** ${codingTicket.title}\n`;
            autoPrompt += `**Priority:** ${codingTicket.priority}\n`;
            autoPrompt += `**Operation:** ${(codingTicket.operation_type || 'general').replace(/_/g, ' ')}\n`;
            if (codingTicket.acceptance_criteria) {
                autoPrompt += `\n**Acceptance Criteria:**\n${codingTicket.acceptance_criteria}\n`;
            }
            autoPrompt += `\n**Description:**\n${codingTicket.body || codingTicket.title}\n`;

            if (recentReplies.length > 0) {
                autoPrompt += `\n**Recent Conversation:**\n`;
                for (const r of recentReplies) {
                    autoPrompt += `[${r.author}]: ${r.body.substring(0, 200)}\n`;
                }
            }

            // Store as system message
            const msg = database.addCodingMessage({
                session_id: (session as any).id,
                role: 'system',
                content: autoPrompt,
            });

            // Update ticket processing status
            database.updateTicket(codingTicket.id, {
                processing_status: 'processing',
                processing_agent: 'coding',
            } as any);

            eventBus.emit('coding:session_created', 'webapp', {
                sessionId: (session as any).id,
                ticketId: codingTicket.id,
                autoGenerated: true,
            });

            json(res, {
                ticket: codingTicket,
                session: session,
                prompt_message: msg,
                auto_generated: true,
            }, 201);
            return true;
        }

        // ==================== CODING STATUS (v5.0) ====================
        // Returns the current coding workstation state
        if (route === 'coding/status' && method === 'GET') {
            const allTickets = database.getTicketsByStatus('open');
            const inReviewTickets = database.getTicketsByStatus('in_review' as any);
            const allCandidates = [...allTickets, ...inReviewTickets];

            const codingQueue = allCandidates.filter(t =>
                t.processing_agent === 'coding' || t.operation_type === 'code_generation' ||
                (t.title || '').toLowerCase().startsWith('coding:')
            );
            const pendingCoding = codingQueue.filter(t => t.processing_status === 'queued' || !t.processing_status);
            const activeCoding = codingQueue.filter(t => t.processing_status === 'processing');

            // Get active session
            const sessions = database.getAllCodingSessions() as unknown as Record<string, unknown>[];
            const activeSession = sessions.find((s: any) => s.status === 'active');

            // Get pending AI questions
            const pendingQuestions = database.getAllPendingAIQuestions ? database.getAllPendingAIQuestions() : [];

            json(res, {
                coding_queue_count: codingQueue.length,
                pending_count: pendingCoding.length,
                active_count: activeCoding.length,
                active_session: activeSession || null,
                pending_questions: pendingQuestions.length,
                next_ticket: pendingCoding[0] || activeCoding[0] || null,
            });
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
            const elementId = url.searchParams.get('element_id');
            const elementType = url.searchParams.get('element_type') || 'component';
            if (elementId) {
                json(res, database.getElementIssuesByElement(elementId, elementType));
            } else {
                const status = url.searchParams.get('status') || undefined;
                json(res, database.getElementIssuesByPlan(planId, status));
            }
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

        // ==================== ELEMENT STATUS (v4.2) ====================
        if (route === 'element-status' && method === 'GET') {
            const url = new URL(req.url || '', 'http://localhost');
            const planId = url.searchParams.get('plan_id');
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const elementId = url.searchParams.get('element_id');
            const elementType = url.searchParams.get('element_type') || 'component';
            if (elementId) {
                const status = database.getOrCreateElementStatus(elementId, elementType as 'component' | 'page', planId);
                json(res, status);
            } else {
                json(res, database.getElementStatusByPlan(planId));
            }
            return true;
        }

        if (route === 'element-status' && method === 'PUT') {
            const body = await parseBody(req);
            if (!body.element_id || !body.plan_id) { json(res, { error: 'element_id and plan_id required' }, 400); return true; }
            const updated = database.updateElementStatus(
                body.element_id as string,
                (body.element_type as string) || 'component',
                body.plan_id as string,
                body as any
            );
            eventBus.emit('status:element_updated', 'webapp', { elementId: body.element_id, planId: body.plan_id });
            json(res, updated);
            return true;
        }

        if (route === 'page-readiness' && method === 'GET') {
            const url = new URL(req.url || '', 'http://localhost');
            const planId = url.searchParams.get('plan_id');
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const pages = database.getDesignPagesByPlan(planId);
            const summaries = pages.map(page => {
                const { readiness_pct, readiness_level } = database.calculatePageReadiness(page.id, planId);
                const components = database.getDesignComponentsByPage(page.id);
                const openIssues = database.getElementIssuesByElement(page.id, 'page').filter(i => i.status === 'open').length;
                // count component issues too
                let compIssues = 0;
                const statusByImpl: Record<string, number> = {};
                for (const comp of components) {
                    const cIssues = database.getElementIssuesByElement(comp.id, 'component').filter(i => i.status === 'open');
                    compIssues += cIssues.length;
                    const cStatus = database.getElementStatus(comp.id, 'component', planId);
                    const implStatus = cStatus ? cStatus.implementation_status : 'not_started';
                    statusByImpl[implStatus] = (statusByImpl[implStatus] || 0) + 1;
                }
                // Get page lifecycle stage from phase
                const plan = database.getPlan(planId);
                const phase = plan ? (plan as any).current_phase || 'planning' : 'planning';
                const stageMap: Record<string, string> = {
                    'planning': 'design', 'designing': 'design', 'design_review': 'design', 'task_generation': 'design',
                    'coding': 'coding', 'design_update': 'coding',
                    'verification': 'verification', 'complete': 'verification'
                };
                const lifecycleStage = stageMap[phase] || 'design';
                return {
                    page_id: page.id,
                    page_name: page.name,
                    total_elements: components.length,
                    elements_by_status: statusByImpl,
                    readiness_pct,
                    readiness_level,
                    open_issues: openIssues + compIssues,
                    pending_questions: 0,
                    lifecycle_stage: lifecycleStage,
                };
            });
            json(res, summaries);
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
                        goal: s.goal || '',
                        source_agent: 'planning',
                        target_type: s.target_type ?? null,
                        target_id: s.target_id ?? null,
                        current_value: s.current_value ?? null,
                        suggested_value: s.suggested_value ? JSON.stringify(s.suggested_value) : null,
                        action_type: s.action_type ?? null,
                        action_payload: s.action_payload || {},
                        priority: s.priority || 'P2',
                        status: 'pending',
                        ticket_id: null,
                        approved_at: null,
                        rejected_at: null,
                        rejection_reason: null,
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
            // v4.3: Accept answer from multiple field names for robustness
            const answerValue = (body.answer || body.answer_text || body.text || body.response) as string;
            if (!answerValue) { json(res, { error: 'answer required' }, 400); return true; }
            const updated = database.answerAIQuestion(answerQuestionId, answerValue);
            if (!updated) { json(res, { error: 'Question not found' }, 404); return true; }
            eventBus.emit('ai:question_answered', 'webapp', { questionId: answerQuestionId });

            // v4.1: If this question is linked to a ticket, unblock it
            const question = database.getAIQuestion(answerQuestionId);
            if (question && (question as any).source_ticket_id) {
                const linkedTicket = database.getTicket((question as any).source_ticket_id);
                if (linkedTicket && linkedTicket.processing_status === 'holding') {
                    database.updateTicket(linkedTicket.id, {
                        processing_status: 'queued',
                    });
                    database.addTicketReply(linkedTicket.id, 'system',
                        `User answered AI feedback question — ticket unblocked. Answer: ${answerValue.substring(0, 200)}`);
                    eventBus.emit('ticket:unblocked', 'webapp', { ticketId: linkedTicket.id });
                }
            }

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
            const rawReqAiLevel = (body.ai_level as string) || 'smart';
            const reqAiLevel = rawReqAiLevel === 'suggestions' ? 'suggest' : rawReqAiLevel;
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
                const autofillParseResult = parseAIJson<string[]>(response.content, 'ai_questions_autofill');
                const answers: string[] = Array.isArray(autofillParseResult.data) ? autofillParseResult.data : [];
                if (autofillParseResult.repaired) {
                    database.addAuditLog('planning', 'json_repaired', 'AI question autofill JSON was repaired');
                }

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

            // TICKET-FIRST: Create tracking ticket before LLM call
            const rawReviewAiLevel = (config.design as Record<string, unknown>)?.aiLevel as string || 'smart';
            const reviewAiLevel = rawReviewAiLevel === 'suggestions' ? 'suggest' : rawReviewAiLevel;
            const earlyReviewTicket = createAutoTicket(database, 'suggestion',
                'Plan Review: ' + plan.name + ' \u2014 Reviewing...',
                'AI reviewing plan readiness.',
                'P3', reviewAiLevel);

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
                                goal: 'Resolve implementation blocker before proceeding',
                                source_agent: 'planning',
                                target_type: null, target_id: null,
                                current_value: null, suggested_value: null,
                                action_type: null, action_payload: {}, priority: TicketPriority.P1,
                                status: 'pending', ticket_id: null,
                                approved_at: null, rejected_at: null, rejection_reason: null,
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
                // Update early ticket with review results
                if (earlyReviewTicket) {
                    database.updateTicket(earlyReviewTicket.id, {
                        title: 'Plan Review: ' + plan.name + ' \u2014 Score: ' + (review.readiness_score || 0),
                        body: 'Readiness: ' + (review.readiness_level || 'unknown') + ' (' + (review.readiness_score || 0) + '/100)\n' + (review.summary || ''),
                        status: TicketStatus.Resolved,
                    });
                }
                eventBus.emit('ai:plan_reviewed', 'webapp', { planId, score: review.readiness_score });
                json(res, review);
            } catch (error) {
                if (earlyReviewTicket) {
                    database.updateTicket(earlyReviewTicket.id, {
                        title: 'Plan Review Failed: ' + plan.name,
                        body: 'Error: ' + String(error),
                    });
                }
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

            const aiLevel = ((body.ai_level as string) || 'smart') === 'suggestions' ? 'suggest' : ((body.ai_level as string) || 'smart');
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
                const rawChatAiLevel = (body.ai_level as string) || 'smart';
                const aiLevel = rawChatAiLevel === 'suggestions' ? 'suggest' : rawChatAiLevel;

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

        // ==================== DESIGN QA PIPELINE (C6) ====================

        // POST /api/design/architect-review — runs Design Architect review
        if (route === 'design/architect-review' && method === 'POST') {
            const body = await parseBody(req);
            const planId = body.plan_id as string;
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const agent = orchestrator.getDesignArchitectAgent();
            const response = await agent.reviewDesign(planId);
            eventBus.emit('design:architect_review_completed', 'webapp', { planId, response: response.content.substring(0, 200) });
            json(res, { success: true, review: response.content, actions: response.actions });
            return true;
        }

        // POST /api/design/gap-analysis — runs Gap Hunter analysis
        if (route === 'design/gap-analysis' && method === 'POST') {
            const body = await parseBody(req);
            const planId = body.plan_id as string;
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const agent = orchestrator.getGapHunterAgent();
            const analysis = await agent.analyzeGaps(planId);
            eventBus.emit('design:gap_analysis_completed', 'webapp', { planId, gap_count: analysis.gaps.length });
            json(res, analysis);
            return true;
        }

        // POST /api/design/harden — generates draft proposals from gap analysis
        if (route === 'design/harden' && method === 'POST') {
            const body = await parseBody(req);
            const planId = body.plan_id as string;
            const gapAnalysis = body.gap_analysis as import('../types').DesignGapAnalysis;
            if (!planId || !gapAnalysis) { json(res, { error: 'plan_id and gap_analysis required' }, 400); return true; }
            const agent = orchestrator.getDesignHardenerAgent();
            const result = await agent.hardenDesign(planId, gapAnalysis);
            eventBus.emit('design:hardening_completed', 'webapp', { planId, drafts_created: result.drafts_created });
            json(res, result);
            return true;
        }

        // POST /api/design/full-qa — runs all 3 phases sequentially
        if (route === 'design/full-qa' && method === 'POST') {
            const body = await parseBody(req);
            const planId = body.plan_id as string;
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }

            eventBus.emit('design:qa_pipeline_started', 'webapp', { planId });

            // Step 1: Architect Review
            const architectAgent = orchestrator.getDesignArchitectAgent();
            const reviewResponse = await architectAgent.reviewDesign(planId);
            const scoreMatch = reviewResponse.content.match(/Score:\s*(\d+)/);
            const architectScore = scoreMatch ? parseInt(scoreMatch[1], 10) : 0;
            eventBus.emit('design:architect_review_completed', 'webapp', { planId, score: architectScore });

            // Step 2: Gap Analysis
            const gapAgent = orchestrator.getGapHunterAgent();
            const gapAnalysis = await gapAgent.analyzeGaps(planId);
            eventBus.emit('design:gap_analysis_completed', 'webapp', { planId, gap_count: gapAnalysis.gaps.length });

            // Step 3: Hardening (draft proposals)
            const hardenerAgent = orchestrator.getDesignHardenerAgent();
            const hardenResult = await hardenerAgent.hardenDesign(planId, gapAnalysis);
            eventBus.emit('design:hardening_completed', 'webapp', { planId, drafts_created: hardenResult.drafts_created });

            eventBus.emit('design:qa_pipeline_completed', 'webapp', {
                planId, score: architectScore, gaps: gapAnalysis.gaps.length, drafts: hardenResult.drafts_created,
            });

            json(res, {
                architect_score: architectScore,
                architect_review: reviewResponse.content,
                gap_analysis: gapAnalysis,
                hardening_result: hardenResult,
            });
            return true;
        }

        // ==================== DRAFT COMPONENTS (C4) ====================

        // GET /api/design/drafts?plan_id=X — list pending drafts
        if (route === 'design/drafts' && method === 'GET') {
            const planId = new URL(req.url || '', 'http://localhost').searchParams.get('plan_id');
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const allComponents = database.getDesignComponentsByPlan(planId);
            const drafts = allComponents.filter((c: any) => c.is_draft === true || c.is_draft === 1);
            json(res, drafts);
            return true;
        }

        // POST /api/design/drafts/:id/approve — approve a draft
        {
            const draftId = extractParam(route, 'design/drafts/:id/approve');
            if (draftId && method === 'POST') {
                database.updateDesignComponent(draftId, { is_draft: 0 } as any);
                eventBus.emit('design:draft_approved', 'webapp', { componentId: draftId });
                database.addAuditLog('webapp', 'draft_approved', `Draft component ${draftId} approved`);
                json(res, { success: true });
                return true;
            }
        }

        // POST /api/design/drafts/:id/reject — reject (delete) a draft
        {
            const draftId = extractParam(route, 'design/drafts/:id/reject');
            if (draftId && method === 'POST') {
                database.deleteDesignComponent(draftId);
                eventBus.emit('design:draft_rejected', 'webapp', { componentId: draftId });
                database.addAuditLog('webapp', 'draft_rejected', `Draft component ${draftId} rejected`);
                json(res, { success: true });
                return true;
            }
        }

        // POST /api/design/drafts/approve-all?plan_id=X — batch approve
        if (route === 'design/drafts/approve-all' && method === 'POST') {
            const planId = new URL(req.url || '', 'http://localhost').searchParams.get('plan_id') || ((await parseBody(req)) as any).plan_id as string;
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const all = database.getDesignComponentsByPlan(planId);
            let count = 0;
            for (const c of all) {
                if ((c as any).is_draft === true || (c as any).is_draft === 1) {
                    database.updateDesignComponent(c.id, { is_draft: 0 } as any);
                    count++;
                }
            }
            eventBus.emit('design:draft_approved', 'webapp', { planId, count });
            json(res, { success: true, approved: count });
            return true;
        }

        // POST /api/design/drafts/reject-all?plan_id=X — batch reject (delete)
        if (route === 'design/drafts/reject-all' && method === 'POST') {
            const planId = new URL(req.url || '', 'http://localhost').searchParams.get('plan_id') || ((await parseBody(req)) as any).plan_id as string;
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const all = database.getDesignComponentsByPlan(planId);
            let count = 0;
            for (const c of all) {
                if ((c as any).is_draft === true || (c as any).is_draft === 1) {
                    database.deleteDesignComponent(c.id);
                    count++;
                }
            }
            eventBus.emit('design:draft_rejected', 'webapp', { planId, count });
            json(res, { success: true, rejected: count });
            return true;
        }

        // ==================== QUESTION QUEUE (E2) ====================

        // GET /api/questions/queue — pending questions sorted by priority
        // v5.0: plan_id is now optional — if missing, returns ALL pending questions
        if (route === 'questions/queue' && method === 'GET') {
            const planId = new URL(req.url || '', 'http://localhost').searchParams.get('plan_id');
            const questions = planId
                ? database.getAIQuestionsByPlan(planId, 'pending')
                : database.getAllPendingAIQuestions();
            // Sort by queue_priority (P1 first) then created_at
            questions.sort((a: any, b: any) => {
                const pa = a.queue_priority ?? 2;
                const pb = b.queue_priority ?? 2;
                if (pa !== pb) return pa - pb;
                return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            });
            json(res, questions);
            return true;
        }

        // GET /api/questions/queue/count — badge counts
        // v5.0: plan_id is now optional — if missing, counts ALL pending questions
        if (route === 'questions/queue/count' && method === 'GET') {
            const planId = new URL(req.url || '', 'http://localhost').searchParams.get('plan_id');
            if (!planId) {
                const questions = database.getAllPendingAIQuestions();
                const counts = { total: questions.length, p1: 0, p2: 0, p3: 0 };
                for (const q of questions) {
                    const p = (q as any).queue_priority ?? 2;
                    if (p === 1) counts.p1++;
                    else if (p === 2) counts.p2++;
                    else counts.p3++;
                }
                json(res, counts);
                return true;
            }
            const questions = database.getAIQuestionsByPlan(planId, 'pending');
            const counts = { total: questions.length, p1: 0, p2: 0, p3: 0 };
            for (const q of questions) {
                const p = (q as any).queue_priority ?? 2;
                if (p === 1) counts.p1++;
                else if (p === 2) counts.p2++;
                else counts.p3++;
            }
            json(res, counts);
            return true;
        }

        // POST /api/questions/:id/dismiss — dismiss with Ghost Ticket 3-strike logic
        {
            const qId = extractParam(route, 'questions/:id/dismiss');
            if (qId && method === 'POST') {
                const question = database.getAIQuestion(qId);
                if (!question) { json(res, { error: 'Question not found' }, 404); return true; }
                const currentDismissCount = (question as any).dismiss_count ?? 0;
                const newDismissCount = currentDismissCount + 1;

                if (newDismissCount >= 3 && question.is_ghost) {
                    // 3rd dismiss: auto-unblock with note
                    database.updateAIQuestion(qId, { status: 'dismissed', dismiss_count: newDismissCount } as any);
                    if ((question as any).source_ticket_id) {
                        const originalTicket = database.getTicket((question as any).source_ticket_id);
                        if (originalTicket) {
                            database.addTicketReply(originalTicket.id, 'system',
                                'User dismissed question 3 times — proceeding with AI\'s best assumption.');
                            database.updateTicket(originalTicket.id, {
                                blocking_ticket_id: undefined,
                                processing_status: 'queued',
                            });
                            eventBus.emit('ticket:unblocked', 'webapp', { ticketId: originalTicket.id });
                        }
                    }
                    // Resolve the ghost ticket
                    if (question.ticket_id) {
                        database.resolveGhostTicket(question.ticket_id);
                    }
                    json(res, { success: true, action: 'auto_unblocked', dismiss_count: newDismissCount });
                } else {
                    database.updateAIQuestion(qId, { dismiss_count: newDismissCount } as any);
                    database.dismissAIQuestion(qId);
                    eventBus.emit('question:dismissed', 'webapp', { questionId: qId, dismiss_count: newDismissCount });
                    json(res, { success: true, action: 'dismissed', dismiss_count: newDismissCount });
                }
                return true;
            }
        }

        // v4.1: Fallback answer endpoint (popup may call without ai/ prefix)
        {
            const fallbackAnswerId = extractParam(route, 'questions/:id/answer');
            if (fallbackAnswerId && method === 'POST') {
                const body = await parseBody(req);
                const fallbackAnswer = (body.answer || body.answer_text || body.text || body.response) as string;
                if (!fallbackAnswer) { json(res, { error: 'answer required' }, 400); return true; }
                const updated = database.answerAIQuestion(fallbackAnswerId, fallbackAnswer);
                if (!updated) { json(res, { error: 'Question not found' }, 404); return true; }
                eventBus.emit('ai:question_answered', 'webapp', { questionId: fallbackAnswerId });

                // Unblock linked ticket if held
                const question = database.getAIQuestion(fallbackAnswerId);
                if (question && (question as any).source_ticket_id) {
                    const linkedTicket = database.getTicket((question as any).source_ticket_id);
                    if (linkedTicket && linkedTicket.processing_status === 'holding') {
                        database.updateTicket(linkedTicket.id, { processing_status: 'queued' });
                        database.addTicketReply(linkedTicket.id, 'system',
                            `User answered AI feedback — ticket unblocked.`);
                        eventBus.emit('ticket:unblocked', 'webapp', { ticketId: linkedTicket.id });
                    }
                }

                json(res, updated);
                return true;
            }
        }

        // ==================== PHASE STATUS (F1) ====================

        // GET /api/plans/:id/phase — get current phase info
        {
            const phaseId = extractParam(route, 'plans/:id/phase');
            if (phaseId && !route.includes('/approve') && method === 'GET') {
                const phaseInfo = database.getPlanPhase(phaseId);
                if (!phaseInfo) { json(res, { error: 'Plan not found' }, 404); return true; }
                json(res, phaseInfo);
                return true;
            }
        }

        // POST /api/plans/:id/approve-design — approve design and advance phase
        {
            const approveId = extractParam(route, 'plans/:id/approve-design');
            if (approveId && method === 'POST') {
                database.approvePlanDesign(approveId);
                eventBus.emit('design:approved', 'webapp', { planId: approveId });
                database.addAuditLog('webapp', 'design_approved', `Design approved for plan ${approveId}`);
                json(res, { success: true });
                return true;
            }
        }

        // ==================== BOSS HEALTH CHECK (B9) ====================

        if (route === 'boss/health-check' && method === 'POST') {
            eventBus.emit('boss:health_check_started', 'webapp', {});
            const ctx: AgentContext = { conversationHistory: [] };
            const response = await orchestrator.callAgent('boss', 'Run a health check on the system. Check for stale tickets, blocked tasks, pending questions, and agent status.', ctx);
            eventBus.emit('boss:health_check_completed', 'webapp', { assessment: response.content.substring(0, 200) });
            json(res, { success: true, assessment: response.content, actions: response.actions });
            return true;
        }

        // ==================== LLM MODELS ====================

        // GET /api/llm/models — fetch available models from the configured LLM endpoint
        if (route === 'llm/models' && method === 'GET') {
            const cfg = config.getConfig();
            const endpoint = cfg.llm?.endpoint;
            if (!endpoint) {
                json(res, { models: [], error: 'No LLM endpoint configured' });
                return true;
            }
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000);
                const modelsRes = await fetch(`${endpoint}/models`, {
                    signal: controller.signal,
                });
                clearTimeout(timeout);
                if (!modelsRes.ok) {
                    json(res, { models: [], error: `LLM server returned HTTP ${modelsRes.status}` });
                    return true;
                }
                const data = await modelsRes.json() as { data?: Array<{ id: string; object?: string }> };
                const models = (data.data || []).map(m => m.id).sort();
                json(res, { models, current: cfg.llm?.model || '' });
            } catch (err) {
                json(res, { models: [], error: `Failed to fetch models: ${err instanceof Error ? err.message : String(err)}` });
            }
            return true;
        }

        // ==================== SETTINGS (H) ====================

        if (route === 'settings' && method === 'GET') {
            const cfg = config.getConfig();
            json(res, {
                designQaScoreThreshold: cfg.designQaScoreThreshold ?? 80,
                maxActiveTickets: cfg.maxActiveTickets ?? 10,
                maxTicketRetries: cfg.maxTicketRetries ?? 3,
                maxClarificationRounds: cfg.maxClarificationRounds ?? 5,
                bossIdleTimeoutMinutes: cfg.bossIdleTimeoutMinutes ?? 5,
                bossStuckPhaseMinutes: cfg.bossStuckPhaseMinutes ?? 30,
                bossTaskOverloadThreshold: cfg.bossTaskOverloadThreshold ?? 20,
                bossEscalationThreshold: cfg.bossEscalationThreshold ?? 5,
                clarityAutoResolveScore: cfg.clarityAutoResolveScore ?? 85,
                clarityClarificationScore: cfg.clarityClarificationScore ?? 70,
                llmEndpoint: cfg.llm.endpoint,
                llmModel: cfg.llm.model,
                llmMaxTokens: cfg.llm.maxTokens,
                llmMaxInputTokens: cfg.llm.maxInputTokens ?? 4000,
            });
            return true;
        }

        if (route === 'settings' && method === 'PUT') {
            const body = await parseBody(req);
            const updates: Record<string, unknown> = {};
            const safeNum = (val: unknown, fallback?: number): number | undefined => {
                const n = Number(val);
                return isNaN(n) ? fallback : n;
            };
            if (body.designQaScoreThreshold !== undefined) { const v = safeNum(body.designQaScoreThreshold); if (v !== undefined) updates.designQaScoreThreshold = Math.max(50, v); }
            if (body.maxActiveTickets !== undefined) { const v = safeNum(body.maxActiveTickets); if (v !== undefined) updates.maxActiveTickets = v; }
            if (body.maxTicketRetries !== undefined) { const v = safeNum(body.maxTicketRetries); if (v !== undefined) updates.maxTicketRetries = v; }
            if (body.maxClarificationRounds !== undefined) { const v = safeNum(body.maxClarificationRounds); if (v !== undefined) updates.maxClarificationRounds = v; }
            if (body.bossIdleTimeoutMinutes !== undefined) { const v = safeNum(body.bossIdleTimeoutMinutes); if (v !== undefined) updates.bossIdleTimeoutMinutes = v; }
            if (body.bossStuckPhaseMinutes !== undefined) { const v = safeNum(body.bossStuckPhaseMinutes); if (v !== undefined) updates.bossStuckPhaseMinutes = v; }
            if (body.bossTaskOverloadThreshold !== undefined) { const v = safeNum(body.bossTaskOverloadThreshold); if (v !== undefined) updates.bossTaskOverloadThreshold = v; }
            if (body.bossEscalationThreshold !== undefined) { const v = safeNum(body.bossEscalationThreshold); if (v !== undefined) updates.bossEscalationThreshold = v; }
            if (body.clarityAutoResolveScore !== undefined) { const v = safeNum(body.clarityAutoResolveScore); if (v !== undefined) updates.clarityAutoResolveScore = v; }
            if (body.clarityClarificationScore !== undefined) { const v = safeNum(body.clarityClarificationScore); if (v !== undefined) updates.clarityClarificationScore = v; }
            config.updateConfig(updates as any);
            eventBus.emit('system:config_updated', 'webapp', { fields: Object.keys(updates) });
            json(res, { success: true });
            return true;
        }

        // ==================== PROCESSING STATUS ====================
        if (route === 'processing/status' && method === 'GET') {
            const params = new URL(req.url || '', 'http://localhost').searchParams;
            const planId = params.get('plan_id');
            const queueStatus = ticketProcessor ? ticketProcessor.getStatus() : {
                mainQueueSize: 0, bossQueueSize: 0,
                mainProcessing: false, bossProcessing: false,
                lastActivityTimestamp: 0, idleMinutes: 0,
                bossState: 'idle' as const, bossNextCheckMs: 0,
            };
            const allTickets = database.getAllTickets();
            const totalTickets = allTickets.length;
            const resolvedTickets = allTickets.filter((t: { status: string }) => t.status === 'resolved').length;
            const processingTicket = allTickets.find((t: { processing_status: string | null }) => t.processing_status === 'processing');
            json(res, {
                isProcessing: queueStatus.mainProcessing || queueStatus.bossProcessing,
                mainQueueSize: queueStatus.mainQueueSize,
                bossQueueSize: queueStatus.bossQueueSize,
                totalTickets,
                resolvedTickets,
                percentComplete: totalTickets > 0 ? Math.round((resolvedTickets / totalTickets) * 100) : 0,
                currentTicket: processingTicket ? {
                    id: processingTicket.id,
                    ticket_number: processingTicket.ticket_number,
                    title: processingTicket.title,
                    status: processingTicket.status,
                    processing_status: processingTicket.processing_status,
                    processing_agent: processingTicket.processing_agent,
                    stage: processingTicket.stage,
                } : null,
                phase: planId ? (database as any).getPlanPhase?.(planId) ?? null : null,
                lastActivityTimestamp: queueStatus.lastActivityTimestamp,
                idleMinutes: queueStatus.idleMinutes,
                bossState: queueStatus.bossState,
                bossNextCheckMs: queueStatus.bossNextCheckMs,
                // v7.0: Per-team queue breakdown
                teamQueues: (queueStatus as any).teamQueues ?? [],
            });
            return true;
        }

        // ==================== TICKET RECOVERY ====================
        if (route === 'tickets/recover-stuck' && method === 'POST') {
            const recovered = ticketProcessor ? ticketProcessor.recoverStuckTickets() : 0;
            json(res, { recovered, message: `Recovered ${recovered} stuck tickets` });
            return true;
        }

        // ==================== TEAM QUEUES (v7.0) ====================

        // GET /api/queues — returns all 4 team queue statuses
        if (route === 'queues' && method === 'GET') {
            if (!ticketProcessor) {
                json(res, { queues: [], totalPending: 0, totalActive: 0, totalSlots: 0 });
                return true;
            }
            const teamQueues = ticketProcessor.getTeamQueueStatus();
            const status = ticketProcessor.getStatus();
            json(res, {
                queues: teamQueues,
                totalPending: teamQueues.reduce((s, q) => s + q.pending, 0),
                totalActive: teamQueues.reduce((s, q) => s + q.active, 0),
                totalBlocked: teamQueues.reduce((s, q) => s + q.blocked, 0),
                totalCancelled: teamQueues.reduce((s, q) => s + q.cancelled, 0),
                totalSlots: status.maxSlots,
                activeSlots: status.activeSlots,
                holdQueueSize: status.holdQueueSize,
            });
            return true;
        }

        // POST /api/queues/move — move a ticket to a different team queue
        if (route === 'queues/move' && method === 'POST') {
            const body = await parseBody(req);
            const ticketId = body.ticketId as string | undefined;
            const targetQueue = body.targetQueue as string | undefined;
            if (!ticketId || !targetQueue) {
                json(res, { error: 'ticketId and targetQueue are required' }, 400);
                return true;
            }
            // Validate targetQueue is a valid LeadAgentQueue
            const validQueues = Object.values(LeadAgentQueue) as string[];
            if (!validQueues.includes(targetQueue)) {
                json(res, { error: `Invalid targetQueue. Must be one of: ${validQueues.join(', ')}` }, 400);
                return true;
            }
            if (!ticketProcessor) {
                json(res, { error: 'Ticket processor not available' }, 503);
                return true;
            }
            const moved = ticketProcessor.moveTicketToQueue(ticketId, targetQueue as LeadAgentQueue);
            if (moved) {
                json(res, { success: true, ticketId, targetQueue, message: `Ticket moved to ${targetQueue} queue` });
            } else {
                json(res, { error: 'Ticket not found in any queue' }, 404);
            }
            return true;
        }

        // POST /api/queues/cancel — cancel a ticket (remove from queue)
        if (route === 'queues/cancel' && method === 'POST') {
            const body = await parseBody(req);
            const ticketId = body.ticketId as string | undefined;
            const reason = body.reason as string | undefined;
            if (!ticketId) {
                json(res, { error: 'ticketId is required' }, 400);
                return true;
            }
            if (!ticketProcessor) {
                json(res, { error: 'Ticket processor not available' }, 503);
                return true;
            }
            const cancelled = ticketProcessor.cancelTicket(ticketId, reason || 'Manual cancellation');
            if (cancelled) {
                json(res, { success: true, ticketId, message: 'Ticket cancelled' });
            } else {
                json(res, { error: 'Ticket not found in any queue or already cancelled' }, 404);
            }
            return true;
        }

        // POST /api/queues/reengage — re-engage a cancelled ticket
        if (route === 'queues/reengage' && method === 'POST') {
            const body = await parseBody(req);
            const ticketId = body.ticketId as string | undefined;
            if (!ticketId) {
                json(res, { error: 'ticketId is required' }, 400);
                return true;
            }
            if (!ticketProcessor) {
                json(res, { error: 'Ticket processor not available' }, 503);
                return true;
            }
            const reengaged = ticketProcessor.reengageTicket(ticketId);
            if (reengaged) {
                json(res, { success: true, ticketId, message: 'Ticket re-engaged' });
            } else {
                json(res, { error: 'Ticket not found or not in cancelled state' }, 404);
            }
            return true;
        }

        // ==================== CODING DIRECTOR ENDPOINTS (v7.0) ====================

        // GET /api/coding/status — coding director queue status
        if (route === 'coding/status' && method === 'GET') {
            const codingDirector = orchestrator.getCodingDirectorAgent();
            const queueStatus = codingDirector.getQueueStatus();
            const codingQueueDepth = ticketProcessor
                ? ticketProcessor.getTeamQueueStatus().find(
                    (q: { queue: string }) => q.queue === 'coding_director'
                )?.pending ?? 0
                : 0;
            json(res, {
                hasPendingTask: queueStatus.hasPendingTask,
                currentTask: queueStatus.currentTask || null,
                queueDepth: codingQueueDepth,
            });
            return true;
        }

        // ==================== DOCUMENT ENDPOINTS (v7.0) ====================

        // GET /api/documents — list all documents (filterable by folder, category, keyword)
        if (route === 'documents' && method === 'GET') {
            const docsUrl = new URL(req.url || '', 'http://localhost');
            const folder = docsUrl.searchParams.get('folder') || undefined;
            const category = docsUrl.searchParams.get('category') || undefined;
            const keyword = docsUrl.searchParams.get('keyword') || undefined;
            const planId = docsUrl.searchParams.get('plan_id') || undefined;

            const docs = database.searchSupportDocuments({
                folder_name: folder,
                category,
                keyword,
                plan_id: planId,
            });
            json(res, docs);
            return true;
        }

        // GET /api/documents/folders — list all folder names
        if (route === 'documents/folders' && method === 'GET') {
            const folders = database.listDocumentFolders();
            json(res, folders);
            return true;
        }

        // GET /api/documents/:id — get single document
        if (route.startsWith('documents/') && !route.includes('folders') && method === 'GET') {
            const docId = route.replace('documents/', '');
            const doc = database.getSupportDocument(docId);
            if (doc) {
                json(res, doc);
            } else {
                json(res, { error: 'Document not found' }, 404);
            }
            return true;
        }

        // POST /api/documents — create a new document
        if (route === 'documents' && method === 'POST') {
            const body = await parseBody(req);
            const folderName = body.folder_name as string | undefined;
            const documentName = body.document_name as string | undefined;
            const content = body.content as string | undefined;

            if (!folderName || !documentName || content === undefined) {
                json(res, { error: 'folder_name, document_name, and content are required' }, 400);
                return true;
            }

            const sourceType = (body.source_type as 'user' | 'system') || 'user'; // API calls default to 'user'
            const record = database.createSupportDocument({
                folder_name: folderName,
                document_name: documentName,
                content: content || '',
                summary: (body.summary as string) || null,
                category: (body.category as string) || 'reference',
                source_ticket_id: (body.source_ticket_id as string) || null,
                source_agent: (body.source_agent as string) || null,
                tags: Array.isArray(body.tags) ? body.tags as string[] : [],
                relevance_score: typeof body.relevance_score === 'number' ? body.relevance_score : 50,
                plan_id: (body.plan_id as string) || null,
                source_type: sourceType,
                is_locked: 1, // All docs locked by default for full separation
            });
            json(res, record, 201);
            return true;
        }

        // DELETE /api/documents/:id — delete a document (with locking enforcement)
        if (route.startsWith('documents/') && !route.includes('folders') && method === 'DELETE') {
            const docId = route.replace('documents/', '');
            const { DocumentManagerService } = await import('../core/document-manager');
            const docMgr = new DocumentManagerService(database, eventBus, noopOutputChannel);
            // Default actor is 'user' from API
            const deleted = docMgr.deleteDocument(docId, 'user');
            if (deleted) {
                json(res, { success: true, message: 'Document deleted' });
            } else {
                json(res, { error: 'Document not found or locked to system-only edits' }, 404);
            }
            return true;
        }

        // ==================== BACKEND ELEMENTS (v8.0) ====================

        // GET /api/backend/elements?plan_id&layer&domain — list/filter
        if (route === 'backend/elements' && method === 'GET') {
            const params = new URL(req.url || '', 'http://localhost').searchParams;
            const planId = params.get('plan_id');
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const layer = params.get('layer') || undefined;
            const domain = params.get('domain') || undefined;
            let elements;
            if (layer) {
                elements = database.getBackendElementsByPlanAndLayer(planId, layer);
            } else if (domain) {
                elements = database.getBackendElementsByPlanAndDomain(planId, domain);
            } else {
                elements = database.getBackendElementsByPlan(planId);
            }
            json(res, elements);
            return true;
        }

        // GET /api/backend/elements/:id — get one
        {
            const beId = extractParam(route, 'backend/elements/:id');
            if (beId && method === 'GET' && !route.includes('/approve') && !route.includes('/reject')) {
                const el = database.getBackendElement(beId);
                if (el) {
                    json(res, el);
                } else {
                    json(res, { error: 'Backend element not found' }, 404);
                }
                return true;
            }
        }

        // POST /api/backend/elements — create
        if (route === 'backend/elements' && method === 'POST') {
            const body = await parseBody(req);
            const planId = body.plan_id as string;
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const el = database.createBackendElement({
                plan_id: planId,
                type: ((body.type as string) || 'service') as import('../types').BackendElementType,
                name: (body.name as string) || 'Untitled',
                domain: (body.domain as string) || 'default',
                layer: ((body.layer as string) || 'services') as import('../types').BackendElementLayer,
                config_json: (body.config_json as string) || '{}',
                x: typeof body.x === 'number' ? body.x : 100,
                y: typeof body.y === 'number' ? body.y : 100,
                width: typeof body.width === 'number' ? body.width : 200,
                height: typeof body.height === 'number' ? body.height : 120,
                is_collapsed: body.is_collapsed === true,
                is_draft: body.is_draft === true,
                sort_order: typeof body.sort_order === 'number' ? body.sort_order : 0,
            });
            eventBus.emit('backend:element_created', 'webapp', { id: el.id, type: el.type, name: el.name });
            json(res, el, 201);
            return true;
        }

        // PUT /api/backend/elements/:id — update
        {
            const beId = extractParam(route, 'backend/elements/:id');
            if (beId && method === 'PUT') {
                const body = await parseBody(req);
                const updates: Record<string, unknown> = {};
                for (const key of ['name', 'type', 'domain', 'layer', 'config_json', 'x', 'y', 'width', 'height', 'is_collapsed', 'is_draft', 'sort_order']) {
                    if (body[key] !== undefined) updates[key] = body[key];
                }
                database.updateBackendElement(beId, updates);
                eventBus.emit('backend:element_updated', 'webapp', { id: beId });
                json(res, { success: true });
                return true;
            }
        }

        // DELETE /api/backend/elements/:id — delete
        {
            const beId = extractParam(route, 'backend/elements/:id');
            if (beId && method === 'DELETE') {
                const deleted = database.deleteBackendElement(beId);
                if (deleted) {
                    eventBus.emit('backend:element_deleted', 'webapp', { id: beId });
                    json(res, { success: true });
                } else {
                    json(res, { error: 'Backend element not found' }, 404);
                }
                return true;
            }
        }

        // POST /api/backend/architect-review — run BE QA scoring
        if (route === 'backend/architect-review' && method === 'POST') {
            const body = await parseBody(req);
            const planId = body.plan_id as string;
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const agent = orchestrator.getBackendArchitectAgent();
            const response = await agent.reviewBackend(planId);
            eventBus.emit('backend:architect_review_completed', 'webapp', { planId, response: response.content.substring(0, 200) });
            json(res, { success: true, review: response.content, actions: response.actions });
            return true;
        }

        // POST /api/backend/generate — generate architecture (mode in body)
        if (route === 'backend/generate' && method === 'POST') {
            const body = await parseBody(req);
            const planId = body.plan_id as string;
            const mode = (body.mode as string) || 'auto_generate';
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const agent = orchestrator.getBackendArchitectAgent();
            const response = await agent.generateArchitecture(planId, mode as import('../types').BackendArchitectMode);
            json(res, { success: true, result: response.content, actions: response.actions });
            return true;
        }

        // POST /api/backend/suggest-connections — AI link suggestions
        if (route === 'backend/suggest-connections' && method === 'POST') {
            const body = await parseBody(req);
            const planId = body.plan_id as string;
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const agent = orchestrator.getBackendArchitectAgent();
            const response = await agent.suggestConnections(planId);
            json(res, { success: true, suggestions: response.content, actions: response.actions });
            return true;
        }

        // POST /api/backend/gap-analysis — run BE gap analysis
        if (route === 'backend/gap-analysis' && method === 'POST') {
            const body = await parseBody(req);
            const planId = body.plan_id as string;
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const gapAgent = orchestrator.getGapHunterAgent();
            const gaps = gapAgent.analyzeBackendGaps(planId);
            json(res, { gaps, count: gaps.length });
            return true;
        }

        // POST /api/backend/harden — create BE draft fixes
        if (route === 'backend/harden' && method === 'POST') {
            const body = await parseBody(req);
            const planId = body.plan_id as string;
            const gapAnalysis = body.gap_analysis as import('../types').DesignGapAnalysis;
            if (!planId || !gapAnalysis) { json(res, { error: 'plan_id and gap_analysis required' }, 400); return true; }
            const agent = orchestrator.getDesignHardenerAgent();
            const result = await agent.hardenBackendDesign(planId, gapAnalysis);
            json(res, result);
            return true;
        }

        // POST /api/backend/full-qa — run all 3 BE QA phases
        if (route === 'backend/full-qa' && method === 'POST') {
            const body = await parseBody(req);
            const planId = body.plan_id as string;
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }

            // Step 1: Architect Review
            const architectAgent = orchestrator.getBackendArchitectAgent();
            const reviewResponse = await architectAgent.reviewBackend(planId);
            const scoreMatch = reviewResponse.content.match(/Score:\s*(\d+)/);
            const beArchitectScore = scoreMatch ? parseInt(scoreMatch[1], 10) : 0;

            // Step 2: Gap Analysis
            const gapAgent = orchestrator.getGapHunterAgent();
            const beGaps = gapAgent.analyzeBackendGaps(planId);
            const beGapAnalysis: import('../types').DesignGapAnalysis = {
                plan_id: planId,
                analysis_timestamp: new Date().toISOString(),
                overall_score: 0,
                gaps: beGaps,
                summary: `Found ${beGaps.length} backend gaps`,
                pages_analyzed: 0,
                components_analyzed: 0,
            };

            // Step 3: Hardening (draft proposals)
            const hardenerAgent = orchestrator.getDesignHardenerAgent();
            const beHardenResult = await hardenerAgent.hardenBackendDesign(planId, beGapAnalysis);

            json(res, {
                architect_score: beArchitectScore,
                architect_review: reviewResponse.content,
                gap_analysis: beGapAnalysis,
                hardening_result: beHardenResult,
            });
            return true;
        }

        // GET /api/backend/drafts?plan_id — list pending BE drafts
        if (route === 'backend/drafts' && method === 'GET') {
            const planId = new URL(req.url || '', 'http://localhost').searchParams.get('plan_id');
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const allBe = database.getBackendElementsByPlan(planId);
            const drafts = allBe.filter((el: any) => el.is_draft === true || el.is_draft === 1);
            json(res, drafts);
            return true;
        }

        // POST /api/backend/drafts/:id/approve — approve BE draft
        {
            const draftId = extractParam(route, 'backend/drafts/:id/approve');
            if (draftId && method === 'POST') {
                database.updateBackendElement(draftId, { is_draft: false });
                eventBus.emit('backend:element_updated', 'webapp', { id: draftId, action: 'draft_approved' });
                json(res, { success: true });
                return true;
            }
        }

        // POST /api/backend/drafts/:id/reject — reject (delete) BE draft
        {
            const draftId = extractParam(route, 'backend/drafts/:id/reject');
            if (draftId && method === 'POST') {
                database.deleteBackendElement(draftId);
                eventBus.emit('backend:element_deleted', 'webapp', { id: draftId, action: 'draft_rejected' });
                json(res, { success: true });
                return true;
            }
        }

        // ==================== LINKS (v8.0) ====================

        // GET /api/links?plan_id — all links
        if (route === 'links' && method === 'GET') {
            const planId = new URL(req.url || '', 'http://localhost').searchParams.get('plan_id');
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const links = database.getElementLinksByPlan(planId);
            json(res, links);
            return true;
        }

        // GET /api/links/matrix?plan_id — matrix data
        if (route === 'links/matrix' && method === 'GET') {
            const planId = new URL(req.url || '', 'http://localhost').searchParams.get('plan_id');
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const { LinkManagerService } = await import('../core/link-manager');
            const linkMgr = new LinkManagerService(database, eventBus, noopOutputChannel);
            const matrix = linkMgr.buildMatrix(planId);
            json(res, matrix);
            return true;
        }

        // GET /api/links/tree?plan_id — tree data
        if (route === 'links/tree' && method === 'GET') {
            const planId = new URL(req.url || '', 'http://localhost').searchParams.get('plan_id');
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const { LinkManagerService } = await import('../core/link-manager');
            const linkMgr = new LinkManagerService(database, eventBus, noopOutputChannel);
            const tree = linkMgr.buildTree(planId);
            json(res, tree);
            return true;
        }

        // POST /api/links — create manual link
        if (route === 'links' && method === 'POST') {
            const body = await parseBody(req);
            const planId = body.plan_id as string;
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const link = database.createElementLink({
                plan_id: planId,
                link_type: ((body.link_type as string) || 'fe_to_be') as import('../types').LinkType,
                granularity: ((body.granularity as string) || 'high') as import('../types').LinkGranularity,
                source: 'manual' as import('../types').LinkSource,
                from_element_type: ((body.from_element_type as string) || 'page') as import('../types').ElementLink['from_element_type'],
                from_element_id: (body.from_element_id as string) || '',
                to_element_type: ((body.to_element_type as string) || 'backend_element') as import('../types').ElementLink['to_element_type'],
                to_element_id: (body.to_element_id as string) || '',
                label: (body.label as string) || '',
                metadata_json: (body.metadata_json as string) || '{}',
                confidence: typeof body.confidence === 'number' ? body.confidence : 1.0,
                is_approved: true,
            });
            eventBus.emit('link:created', 'webapp', { id: link.id, link_type: link.link_type });
            json(res, link, 201);
            return true;
        }

        // DELETE /api/links/:id — delete
        {
            const linkId = extractParam(route, 'links/:id');
            if (linkId && method === 'DELETE' && !route.includes('/approve') && !route.includes('/reject')) {
                const deleted = database.deleteElementLink(linkId);
                if (deleted) {
                    eventBus.emit('link:deleted', 'webapp', { id: linkId });
                    json(res, { success: true });
                } else {
                    json(res, { error: 'Link not found' }, 404);
                }
                return true;
            }
        }

        // POST /api/links/auto-detect?plan_id — auto-detect
        if (route === 'links/auto-detect' && method === 'POST') {
            const params = new URL(req.url || '', 'http://localhost').searchParams;
            const planId = params.get('plan_id') || ((await parseBody(req)).plan_id as string);
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const { LinkManagerService } = await import('../core/link-manager');
            const linkMgr = new LinkManagerService(database, eventBus, noopOutputChannel);
            const created = linkMgr.autoDetectLinks(planId);
            json(res, { success: true, created: created.length, links: created });
            return true;
        }

        // POST /api/links/:id/approve — approve AI suggestion
        {
            const linkId = extractParam(route, 'links/:id/approve');
            if (linkId && method === 'POST') {
                database.updateElementLink(linkId, { is_approved: true });
                eventBus.emit('link:approved', 'webapp', { id: linkId });
                json(res, { success: true });
                return true;
            }
        }

        // POST /api/links/:id/reject — reject AI suggestion
        {
            const linkId = extractParam(route, 'links/:id/reject');
            if (linkId && method === 'POST') {
                database.deleteElementLink(linkId);
                eventBus.emit('link:rejected', 'webapp', { id: linkId });
                json(res, { success: true });
                return true;
            }
        }

        // ==================== TAGS (v8.0) ====================

        // GET /api/tags?plan_id — list definitions
        if (route === 'tags' && method === 'GET') {
            const planId = new URL(req.url || '', 'http://localhost').searchParams.get('plan_id') || undefined;
            const tags = database.getTagDefinitions(planId);
            json(res, tags);
            return true;
        }

        // POST /api/tags — create custom tag
        if (route === 'tags' && method === 'POST') {
            const body = await parseBody(req);
            if (!body.name || !body.color) { json(res, { error: 'name and color required' }, 400); return true; }
            const tag = database.createTagDefinition({
                name: body.name as string,
                color: body.color as string,
                plan_id: (body.plan_id as string) || undefined,
                custom_color: (body.custom_color as string) || undefined,
                description: (body.description as string) || '',
            });
            eventBus.emit('tag:created', 'webapp', { id: tag.id, name: tag.name });
            json(res, tag, 201);
            return true;
        }

        // DELETE /api/tags/:id — delete (not builtin)
        {
            const tagId = extractParam(route, 'tags/:id');
            if (tagId && method === 'DELETE' && !route.includes('assign') && !route.includes('element') && !route.includes('seed')) {
                const deleted = database.deleteTagDefinition(tagId);
                if (deleted) {
                    eventBus.emit('tag:deleted', 'webapp', { id: tagId });
                    json(res, { success: true });
                } else {
                    json(res, { error: 'Tag not found or is built-in' }, 404);
                }
                return true;
            }
        }

        // POST /api/tags/assign — assign tag to element
        if (route === 'tags/assign' && method === 'POST') {
            const body = await parseBody(req);
            const tagId = body.tag_id as string;
            const elementType = body.element_type as string;
            const elementId = body.element_id as string;
            if (!tagId || !elementType || !elementId) { json(res, { error: 'tag_id, element_type, element_id required' }, 400); return true; }
            const assignment = database.assignTag(tagId, elementType, elementId);
            eventBus.emit('tag:assigned', 'webapp', { tag_id: tagId, element_type: elementType, element_id: elementId });
            json(res, assignment, 201);
            return true;
        }

        // DELETE /api/tags/assign — remove tag from element
        if (route === 'tags/assign' && method === 'DELETE') {
            const body = await parseBody(req);
            const tagId = body.tag_id as string;
            const elementType = body.element_type as string;
            const elementId = body.element_id as string;
            if (!tagId || !elementType || !elementId) { json(res, { error: 'tag_id, element_type, element_id required' }, 400); return true; }
            const removed = database.removeTag(tagId, elementType, elementId);
            if (removed) {
                eventBus.emit('tag:removed', 'webapp', { tag_id: tagId, element_type: elementType, element_id: elementId });
                json(res, { success: true });
            } else {
                json(res, { error: 'Tag assignment not found' }, 404);
            }
            return true;
        }

        // GET /api/tags/element/:type/:id — tags for element
        {
            if (route.startsWith('tags/element/') && method === 'GET') {
                const parts = route.replace('tags/element/', '').split('/');
                if (parts.length >= 2) {
                    const elementType = parts[0];
                    const elementId = parts.slice(1).join('/');
                    const tags = database.getTagsForElement(elementType, elementId);
                    json(res, tags);
                } else {
                    json(res, { error: 'element type and id required' }, 400);
                }
                return true;
            }
        }

        // POST /api/tags/seed — seed builtins
        if (route === 'tags/seed' && method === 'POST') {
            const body = await parseBody(req);
            const planId = (body.plan_id as string) || undefined;
            database.seedBuiltinTags(planId);
            json(res, { success: true, message: 'Built-in tags seeded' });
            return true;
        }

        // ==================== REVIEW QUEUE (v8.0) ====================

        // GET /api/review-queue?plan_id — pending items
        if (route === 'review-queue' && method === 'GET') {
            const planId = new URL(req.url || '', 'http://localhost').searchParams.get('plan_id');
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const items = database.getReviewQueueByPlan(planId).filter((i: any) => i.status === 'pending');
            json(res, items);
            return true;
        }

        // GET /api/review-queue/count?plan_id — count for badge
        if (route === 'review-queue/count' && method === 'GET') {
            const planId = new URL(req.url || '', 'http://localhost').searchParams.get('plan_id') || undefined;
            const count = database.getPendingReviewCount(planId);
            json(res, { count });
            return true;
        }

        // POST /api/review-queue/:id/approve — approve
        {
            const itemId = extractParam(route, 'review-queue/:id/approve');
            if (itemId && method === 'POST') {
                const body = await parseBody(req);
                const { ReviewQueueManagerService } = await import('../core/review-queue-manager');
                const rqm = new ReviewQueueManagerService(database, eventBus, noopOutputChannel);
                const success = rqm.approveItem(itemId, body.notes as string | undefined);
                if (success) {
                    json(res, { success: true });
                } else {
                    json(res, { error: 'Item not found or already reviewed' }, 404);
                }
                return true;
            }
        }

        // POST /api/review-queue/:id/reject — reject
        {
            const itemId = extractParam(route, 'review-queue/:id/reject');
            if (itemId && method === 'POST') {
                const body = await parseBody(req);
                const { ReviewQueueManagerService } = await import('../core/review-queue-manager');
                const rqm = new ReviewQueueManagerService(database, eventBus, noopOutputChannel);
                const success = rqm.rejectItem(itemId, body.notes as string | undefined);
                if (success) {
                    json(res, { success: true });
                } else {
                    json(res, { error: 'Item not found or already reviewed' }, 404);
                }
                return true;
            }
        }

        // POST /api/review-queue/approve-all?plan_id — batch approve
        if (route === 'review-queue/approve-all' && method === 'POST') {
            const params = new URL(req.url || '', 'http://localhost').searchParams;
            const planId = params.get('plan_id') || ((await parseBody(req)).plan_id as string);
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const { ReviewQueueManagerService } = await import('../core/review-queue-manager');
            const rqm = new ReviewQueueManagerService(database, eventBus, noopOutputChannel);
            const count = rqm.approveAll(planId);
            json(res, { success: true, approved: count });
            return true;
        }

        // POST /api/review-queue/reject-all?plan_id — batch reject
        if (route === 'review-queue/reject-all' && method === 'POST') {
            const params = new URL(req.url || '', 'http://localhost').searchParams;
            const planId = params.get('plan_id') || ((await parseBody(req)).plan_id as string);
            if (!planId) { json(res, { error: 'plan_id required' }, 400); return true; }
            const { ReviewQueueManagerService } = await import('../core/review-queue-manager');
            const rqm = new ReviewQueueManagerService(database, eventBus, noopOutputChannel);
            const count = rqm.rejectAll(planId);
            json(res, { success: true, rejected: count });
            return true;
        }

        // ==================== ENHANCED DOCUMENT ENDPOINTS (v8.0) ====================

        // PUT /api/documents/:id — update document (with locking enforcement)
        {
            const docId = extractParam(route, 'documents/:id');
            if (docId && method === 'PUT' && !route.includes('folders')) {
                const body = await parseBody(req);
                const actor = (body.actor as 'user' | 'system') || 'user';
                const { DocumentManagerService } = await import('../core/document-manager');
                const docMgr = new DocumentManagerService(database, eventBus, noopOutputChannel);
                try {
                    docMgr.updateDocument(docId, {
                        content: body.content as string | undefined,
                        summary: body.summary as string | undefined,
                        category: body.category as string | undefined,
                        tags: Array.isArray(body.tags) ? body.tags as string[] : undefined,
                        relevance_score: typeof body.relevance_score === 'number' ? body.relevance_score : undefined,
                        folder_name: body.folder_name as string | undefined,
                        document_name: body.document_name as string | undefined,
                    }, actor);
                    json(res, { success: true });
                } catch (lockErr) {
                    json(res, { error: lockErr instanceof Error ? lockErr.message : 'Document is locked' }, 403);
                }
                return true;
            }
        }

        // ==================== v9.0: WORKFLOW DESIGNER ENDPOINTS ====================

        // GET /api/v9/workflows — list all workflows
        if (route === 'v9/workflows' && method === 'GET') {
            const workflows = database.getAllWorkflows();
            json(res, { success: true, data: workflows });
            return true;
        }

        // POST /api/v9/workflows — create a workflow
        if (route === 'v9/workflows' && method === 'POST') {
            const body = await parseBody(req);
            const workflow = database.createWorkflowDefinition({
                plan_id: (body.plan_id as string) || null,
                name: body.name as string,
                description: (body.description as string) || '',
                mermaid_source: (body.mermaid_source as string) || '',
                status: WorkflowStatus.Draft,
                version: 1,
                is_template: !!body.is_template,
            });
            json(res, { success: true, data: workflow }, 201);
            return true;
        }

        // GET /api/v9/workflow-templates — list workflow templates
        if (route === 'v9/workflow-templates' && method === 'GET') {
            const templates = database.getWorkflowTemplates();
            json(res, { success: true, data: templates });
            return true;
        }

        // Parameterized workflow endpoints
        {
            // GET/PUT/DELETE /api/v9/workflows/:id
            const wfId = extractParam(route, 'v9/workflows/:id');
            if (wfId && !route.includes('/steps') && !route.includes('/connect') && !route.includes('/validate') && !route.includes('/execute') && !route.includes('/executions') && !route.includes('/mermaid') && !route.includes('/clone')) {
                if (method === 'GET') {
                    const wf = database.getWorkflowDefinition(wfId);
                    if (!wf) { json(res, { error: 'Workflow not found' }, 404); return true; }
                    const steps = database.getWorkflowSteps(wfId);
                    json(res, { success: true, data: { ...wf, steps } });
                    return true;
                }
                if (method === 'PUT') {
                    const body = await parseBody(req);
                    database.updateWorkflowDefinition(wfId, body as any);
                    json(res, { success: true });
                    return true;
                }
                if (method === 'DELETE') {
                    database.deleteWorkflowDefinition(wfId);
                    json(res, { success: true });
                    return true;
                }
            }

            // POST /api/v9/workflows/:id/steps
            const stepsWfId = extractParam(route, 'v9/workflows/:id/steps');
            if (stepsWfId && method === 'POST') {
                const body = await parseBody(req);
                const step = database.createWorkflowStep({
                    workflow_id: stepsWfId,
                    step_type: body.step_type as WorkflowStepType,
                    label: (body.label as string) || '',
                    agent_type: (body.agent_type as string) || null,
                    agent_prompt: (body.agent_prompt as string) || null,
                    condition_expression: (body.condition_expression as string) || null,
                    tools_unlocked: (body.tools_unlocked as string[]) || [],
                    acceptance_criteria: (body.acceptance_criteria as string) || null,
                    max_retries: (body.max_retries as number) ?? 0,
                    retry_delay_ms: (body.retry_delay_ms as number) ?? 0,
                    escalation_step_id: (body.escalation_step_id as string) || null,
                    next_step_id: (body.next_step_id as string) || null,
                    true_branch_step_id: (body.true_branch_step_id as string) || null,
                    false_branch_step_id: (body.false_branch_step_id as string) || null,
                    parallel_step_ids: (body.parallel_step_ids as string[]) || [],
                    model_preference: (body.model_preference as any) || null,
                    x: (body.x as number) ?? 0,
                    y: (body.y as number) ?? 0,
                    sort_order: (body.sort_order as number) ?? 0,
                });
                json(res, { success: true, data: step }, 201);
                return true;
            }

            // GET /api/v9/workflows/:id/mermaid
            const mermaidWfId = extractParam(route, 'v9/workflows/:id/mermaid');
            if (mermaidWfId && method === 'GET') {
                const steps = database.getWorkflowSteps(mermaidWfId);
                // Simple mermaid generation from steps
                let mermaid = 'graph TD\n';
                for (const step of steps) {
                    mermaid += `  ${step.id}["${step.label || step.step_type}"]\n`;
                    if (step.next_step_id) {
                        mermaid += `  ${step.id} --> ${step.next_step_id}\n`;
                    }
                    if (step.true_branch_step_id) {
                        mermaid += `  ${step.id} -->|true| ${step.true_branch_step_id}\n`;
                    }
                    if (step.false_branch_step_id) {
                        mermaid += `  ${step.id} -->|false| ${step.false_branch_step_id}\n`;
                    }
                }
                json(res, { success: true, data: { mermaid } });
                return true;
            }

            // POST /api/v9/workflows/:id/validate
            const validateWfId = extractParam(route, 'v9/workflows/:id/validate');
            if (validateWfId && method === 'POST') {
                const steps = database.getWorkflowSteps(validateWfId);
                const errors: string[] = [];
                if (steps.length === 0) errors.push('Workflow has no steps');
                // Check for unreachable steps
                const reachableIds = new Set<string>();
                if (steps.length > 0) {
                    reachableIds.add(steps[0].id);
                    for (const s of steps) {
                        if (s.next_step_id) reachableIds.add(s.next_step_id);
                        if (s.true_branch_step_id) reachableIds.add(s.true_branch_step_id);
                        if (s.false_branch_step_id) reachableIds.add(s.false_branch_step_id);
                    }
                    for (const s of steps) {
                        if (!reachableIds.has(s.id) && s !== steps[0]) {
                            errors.push(`Step "${s.label || s.id}" is unreachable`);
                        }
                    }
                }
                json(res, { success: true, data: { valid: errors.length === 0, errors } });
                return true;
            }

            // POST /api/v9/workflows/:id/execute
            const execWfId = extractParam(route, 'v9/workflows/:id/execute');
            if (execWfId && method === 'POST') {
                const body = await parseBody(req);
                const execution = database.createWorkflowExecution({
                    workflow_id: execWfId,
                    ticket_id: (body.ticket_id as string) || undefined,
                    task_id: (body.task_id as string) || undefined,
                    variables: body.variables as Record<string, unknown> || {},
                });
                json(res, { success: true, data: execution }, 201);
                return true;
            }

            // GET /api/v9/workflows/:id/executions
            const execsWfId = extractParam(route, 'v9/workflows/:id/executions');
            if (execsWfId && method === 'GET') {
                const executions = database.getWorkflowExecutionsByWorkflow(execsWfId);
                json(res, { success: true, data: executions });
                return true;
            }

            // POST /api/v9/workflows/:id/clone
            const cloneWfId = extractParam(route, 'v9/workflows/:id/clone');
            if (cloneWfId && method === 'POST') {
                const body = await parseBody(req);
                const original = database.getWorkflowDefinition(cloneWfId);
                if (!original) { json(res, { error: 'Workflow not found' }, 404); return true; }
                const cloned = database.createWorkflowDefinition({
                    plan_id: (body.plan_id as string) || original.plan_id,
                    name: (body.name as string) || `${original.name} (copy)`,
                    description: original.description,
                    mermaid_source: original.mermaid_source,
                    status: WorkflowStatus.Draft,
                    version: 1,
                    is_template: !!body.is_template,
                });
                // Clone steps
                const steps = database.getWorkflowSteps(cloneWfId);
                const idMap: Record<string, string> = {};
                for (const step of steps) {
                    const newStep = database.createWorkflowStep({
                        ...step,
                        id: undefined as any, // will be auto-generated
                        workflow_id: cloned.id,
                    });
                    idMap[step.id] = newStep.id;
                }
                // Re-link cloned steps
                for (const step of steps) {
                    const newId = idMap[step.id];
                    database.updateWorkflowStep(newId, {
                        next_step_id: step.next_step_id ? idMap[step.next_step_id] || null : null,
                        true_branch_step_id: step.true_branch_step_id ? idMap[step.true_branch_step_id] || null : null,
                        false_branch_step_id: step.false_branch_step_id ? idMap[step.false_branch_step_id] || null : null,
                        escalation_step_id: step.escalation_step_id ? idMap[step.escalation_step_id] || null : null,
                    });
                }
                json(res, { success: true, data: cloned }, 201);
                return true;
            }
        }

        // PUT/DELETE /api/v9/workflows/:wfId/steps/:stepId
        {
            const stepMatch = route.match(/^v9\/workflows\/([^/]+)\/steps\/([^/]+)$/);
            if (stepMatch) {
                const [, , stepId] = stepMatch;
                if (method === 'PUT') {
                    const body = await parseBody(req);
                    database.updateWorkflowStep(stepId, body as any);
                    json(res, { success: true });
                    return true;
                }
                if (method === 'DELETE') {
                    database.deleteWorkflowStep(stepId);
                    json(res, { success: true });
                    return true;
                }
            }
        }

        // ==================== v9.0: WORKFLOW EXECUTION ENDPOINTS ====================

        {
            // GET /api/v9/executions/:id
            const execId = extractParam(route, 'v9/executions/:id');
            if (execId && !route.includes('/approve') && !route.includes('/reject') && !route.includes('/pause') && !route.includes('/resume') && !route.includes('/cancel')) {
                if (method === 'GET') {
                    const exec = database.getWorkflowExecution(execId);
                    if (!exec) { json(res, { error: 'Execution not found' }, 404); return true; }
                    json(res, { success: true, data: exec });
                    return true;
                }
            }

            // POST /api/v9/executions/:id/approve|reject|pause|resume|cancel
            for (const action of ['approve', 'reject', 'pause', 'resume', 'cancel'] as const) {
                const actionId = extractParam(route, `v9/executions/:id/${action}`);
                if (actionId && method === 'POST') {
                    const body = await parseBody(req);
                    const statusMap: Record<string, WorkflowExecutionStatus> = {
                        approve: WorkflowExecutionStatus.Completed,
                        reject: WorkflowExecutionStatus.Failed,
                        pause: WorkflowExecutionStatus.Pending,
                        resume: WorkflowExecutionStatus.Running,
                        cancel: WorkflowExecutionStatus.Cancelled,
                    };
                    database.updateWorkflowExecution(actionId, {
                        status: statusMap[action],
                    });
                    json(res, { success: true, data: { action, execution_id: actionId } });
                    return true;
                }
            }
        }

        // ==================== v9.0: AGENT TREE ENDPOINTS ====================

        // GET /api/v9/tree — get full tree
        if (route === 'v9/tree' && method === 'GET') {
            const plan = database.getActivePlan();
            const nodes = database.getAllTreeNodes();
            json(res, { success: true, data: { plan_id: plan?.id || null, nodes } });
            return true;
        }

        // GET /api/v9/tree-templates — list tree templates
        if (route === 'v9/tree-templates' && method === 'GET') {
            const templates = database.getAllTreeTemplates();
            json(res, { success: true, data: templates });
            return true;
        }

        // POST /api/v9/tree/build-default — build default system tree with all niche agents
        if (route === 'v9/tree/build-default' && method === 'POST') {
            const atm = orchestrator.getAgentTreeManager();
            if (!atm) {
                json(res, { error: 'AgentTreeManager not available' }, 500);
                return true;
            }
            // Clear existing tree first if requested
            const body = await parseBody(req);
            if (body.rebuild) {
                const existing = database.getAllTreeNodes();
                for (const node of existing) {
                    database.deleteTreeNode(node.id);
                }
            }
            const built = atm.ensureDefaultTree();
            const nodes = database.getAllTreeNodes();
            json(res, { success: true, data: { built, nodeCount: nodes.length } }, built ? 201 : 200);
            return true;
        }

        // POST /api/v9/tree/build/:planId — build tree for plan
        {
            const buildPlanId = extractParam(route, 'v9/tree/build/:id');
            if (buildPlanId && method === 'POST') {
                const boss = orchestrator.getBossAgent();
                try {
                    const result = await boss.spawnTree(buildPlanId);
                    json(res, { success: true, data: result }, 201);
                } catch (err) {
                    json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
                }
                return true;
            }
        }

        {
            // GET /api/v9/tree/:nodeId
            const nodeId = extractParam(route, 'v9/tree/:id');
            if (nodeId && !route.includes('/conversations') && !route.includes('/children') && !route.includes('/escalate')) {
                if (method === 'GET') {
                    const node = database.getTreeNode(nodeId);
                    if (!node) { json(res, { error: 'Node not found' }, 404); return true; }
                    json(res, { success: true, data: node });
                    return true;
                }
                if (method === 'DELETE') {
                    database.deleteTreeNode(nodeId);
                    json(res, { success: true });
                    return true;
                }
            }

            // GET /api/v9/tree/:nodeId/conversations
            const convNodeId = extractParam(route, 'v9/tree/:id/conversations');
            if (convNodeId && method === 'GET') {
                const conversations = database.getAgentConversationsByNode(convNodeId);
                json(res, { success: true, data: conversations });
                return true;
            }

            // GET /api/v9/tree/:nodeId/children
            const childNodeId = extractParam(route, 'v9/tree/:id/children');
            if (childNodeId && method === 'GET') {
                const children = database.getTreeNodeChildren(childNodeId);
                json(res, { success: true, data: children });
                return true;
            }

            // POST /api/v9/tree/:nodeId/escalate
            const escalateNodeId = extractParam(route, 'v9/tree/:id/escalate');
            if (escalateNodeId && method === 'POST') {
                const body = await parseBody(req);
                const node = database.getTreeNode(escalateNodeId);
                if (!node) { json(res, { error: 'Node not found' }, 404); return true; }
                database.updateTreeNode(escalateNodeId, {
                    status: TreeNodeStatus.Escalated,
                    escalations: (node.escalations ?? 0) + 1,
                });
                json(res, { success: true, data: { node_id: escalateNodeId, reason: body.reason } });
                return true;
            }
        }

        // ==================== v9.0: NICHE AGENT ENDPOINTS ====================

        // GET /api/v9/niche-agents — list niche agents
        if (route === 'v9/niche-agents' && method === 'GET') {
            const allNiche = database.getAllNicheAgentDefinitions();
            json(res, { success: true, data: allNiche, count: allNiche.length });
            return true;
        }

        {
            // GET/PUT /api/v9/niche-agents/:id
            const nicheId = extractParam(route, 'v9/niche-agents/:id');
            if (nicheId) {
                if (method === 'GET') {
                    const def = database.getNicheAgentDefinition(nicheId);
                    if (!def) { json(res, { error: 'Niche agent not found' }, 404); return true; }
                    json(res, { success: true, data: def });
                    return true;
                }
                if (method === 'PUT') {
                    const body = await parseBody(req);
                    database.updateNicheAgentDefinition(nicheId, body as any);
                    json(res, { success: true });
                    return true;
                }
            }
        }

        // ==================== v9.0: PERMISSIONS ENDPOINTS ====================

        {
            // GET/PUT /api/v9/permissions/:agentType
            const permAgent = extractParam(route, 'v9/permissions/:id');
            if (permAgent) {
                if (method === 'GET') {
                    const perm = database.getPermissionSetByAgent(permAgent);
                    json(res, { success: true, data: perm });
                    return true;
                }
                if (method === 'PUT') {
                    const body = await parseBody(req);
                    const existing = database.getPermissionSetByAgent(permAgent);
                    if (existing) {
                        database.updatePermissionSet(existing.id, body as any);
                    } else {
                        database.createPermissionSet({
                            agent_type: permAgent,
                            agent_instance_id: null,
                            permissions: (body.permissions as any[]) || [],
                            allowed_tools: (body.allowed_tools as string[]) || [],
                            blocked_tools: (body.blocked_tools as string[]) || [],
                            can_spawn: body.can_spawn !== false,
                            max_llm_calls: (body.max_llm_calls as number) ?? 100,
                            max_time_minutes: (body.max_time_minutes as number) ?? 60,
                        });
                    }
                    json(res, { success: true });
                    return true;
                }
            }
        }

        // ==================== v9.0: MODEL ASSIGNMENT ENDPOINTS ====================

        // GET /api/v9/models — list available models
        if (route === 'v9/models' && method === 'GET') {
            const assignments = database.getAllModelAssignments();
            json(res, { success: true, data: assignments });
            return true;
        }

        // POST /api/v9/models/detect — detect LM Studio models
        if (route === 'v9/models/detect' && method === 'POST') {
            // This would normally call ModelRouter.detectModelCapabilities()
            // For now return the current assignments
            const assignments = database.getAllModelAssignments();
            json(res, { success: true, data: { models: assignments, message: 'Use extension wiring to trigger full model detection' } });
            return true;
        }

        {
            // GET/PUT/DELETE /api/v9/model-assignments/:agentType
            const modelAgent = extractParam(route, 'v9/model-assignments/:id');
            if (modelAgent) {
                if (method === 'GET') {
                    const assignment = database.getModelAssignmentForAgent(modelAgent);
                    json(res, { success: true, data: assignment });
                    return true;
                }
                if (method === 'PUT') {
                    const body = await parseBody(req);
                    const existing = database.getModelAssignmentForAgent(modelAgent);
                    if (existing) {
                        database.updateModelAssignment(existing.id, body as any);
                    } else {
                        database.createModelAssignment({
                            agent_type: modelAgent,
                            capability: (body.capability as ModelCapability) || ModelCapability.General,
                            model_id: body.model_id as string,
                            is_default: !!body.is_default,
                            priority: (body.priority as number) ?? 0,
                        });
                    }
                    json(res, { success: true });
                    return true;
                }
                if (method === 'DELETE') {
                    const existing = database.getModelAssignmentForAgent(modelAgent);
                    if (existing) database.deleteModelAssignment(existing.id);
                    json(res, { success: true });
                    return true;
                }
            }
        }

        // ==================== v9.0: USER PROFILE ENDPOINTS ====================

        // GET/PUT /api/v9/user-profile
        if (route === 'v9/user-profile' && method === 'GET') {
            const profile = database.getDefaultUserProfile();
            json(res, { success: true, data: profile });
            return true;
        }
        if (route === 'v9/user-profile' && method === 'PUT') {
            const body = await parseBody(req);
            const profile = database.getDefaultUserProfile();
            if (profile) {
                database.updateUserProfile(profile.id, body as any);
            } else {
                database.createUserProfile(body as any);
            }
            json(res, { success: true });
            return true;
        }

        // PUT /api/v9/user-profile/level
        if (route === 'v9/user-profile/level' && method === 'PUT') {
            const body = await parseBody(req);
            const profile = database.getDefaultUserProfile();
            if (profile) {
                database.updateUserProfile(profile.id, { programming_level: body.level as UserProgrammingLevel });
            }
            json(res, { success: true });
            return true;
        }

        // PUT /api/v9/user-profile/preferences
        if (route === 'v9/user-profile/preferences' && method === 'PUT') {
            const body = await parseBody(req);
            const profile = database.getDefaultUserProfile();
            if (profile) {
                database.updateUserProfile(profile.id, {
                    area_preferences: (body.preferences as any) || {},
                });
            }
            json(res, { success: true });
            return true;
        }

        // ==================== v9.0: MCP CONFIRMATION ENDPOINTS ====================

        // GET /api/v9/mcp-confirmations — list pending confirmations
        if (route === 'v9/mcp-confirmations' && method === 'GET') {
            const confirmations = database.getActiveMCPConfirmations();
            json(res, { success: true, data: confirmations });
            return true;
        }

        // POST /api/v9/mcp-confirmations — approve/reject a confirmation
        if (route === 'v9/mcp-confirmations' && method === 'POST') {
            const body = await parseBody(req);
            const id = body.confirmation_id as string;
            const approved = body.approved as boolean;
            if (!id) { json(res, { error: 'confirmation_id required' }, 400); return true; }
            database.updateMCPConfirmation(id, {
                status: approved ? 'approved' as any : 'rejected' as any,
                user_response: (body.notes as string) || undefined,
            });
            json(res, { success: true });
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
