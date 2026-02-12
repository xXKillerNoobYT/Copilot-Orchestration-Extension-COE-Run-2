import { DatabaseSync } from 'node:sqlite';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import {
    Task, TaskStatus, TaskPriority,
    Ticket, TicketStatus, TicketPriority, TicketReply,
    Conversation, ConversationRole,
    Plan, PlanStatus,
    Agent, AgentType, AgentStatus,
    AuditLogEntry,
    VerificationResult, VerificationStatus,
    EvolutionLogEntry
} from '../types';

export class Database {
    private db!: DatabaseSync;
    private dbPath: string;

    constructor(coeDir: string) {
        if (!fs.existsSync(coeDir)) {
            fs.mkdirSync(coeDir, { recursive: true });
        }
        this.dbPath = path.join(coeDir, 'tickets.db');
    }

    async initialize(): Promise<void> {
        this.db = new DatabaseSync(this.dbPath);
        this.db.exec('PRAGMA journal_mode = WAL');
        this.db.exec('PRAGMA foreign_keys = ON');
        this.createTables();
    }

    private createTables(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS plans (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'draft',
                config_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'not_started',
                priority TEXT NOT NULL DEFAULT 'P2',
                dependencies TEXT NOT NULL DEFAULT '[]',
                acceptance_criteria TEXT NOT NULL DEFAULT '',
                plan_id TEXT,
                parent_task_id TEXT,
                estimated_minutes INTEGER NOT NULL DEFAULT 30,
                files_modified TEXT NOT NULL DEFAULT '[]',
                context_bundle TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (plan_id) REFERENCES plans(id),
                FOREIGN KEY (parent_task_id) REFERENCES tasks(id)
            );

            CREATE TABLE IF NOT EXISTS tickets (
                id TEXT PRIMARY KEY,
                ticket_number INTEGER UNIQUE,
                title TEXT NOT NULL,
                body TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'open',
                priority TEXT NOT NULL DEFAULT 'P2',
                creator TEXT NOT NULL DEFAULT 'system',
                assignee TEXT,
                task_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (task_id) REFERENCES tasks(id)
            );

            CREATE TABLE IF NOT EXISTS ticket_replies (
                id TEXT PRIMARY KEY,
                ticket_id TEXT NOT NULL,
                author TEXT NOT NULL,
                body TEXT NOT NULL,
                clarity_score REAL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (ticket_id) REFERENCES tickets(id)
            );

            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                agent TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                content TEXT NOT NULL,
                task_id TEXT,
                ticket_id TEXT,
                tokens_used INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (task_id) REFERENCES tasks(id),
                FOREIGN KEY (ticket_id) REFERENCES tickets(id)
            );

            CREATE TABLE IF NOT EXISTS agents (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'idle',
                config_yaml TEXT,
                last_activity TEXT,
                current_task TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS audit_log (
                id TEXT PRIMARY KEY,
                agent TEXT NOT NULL,
                action TEXT NOT NULL,
                detail TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS verification_results (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'not_started',
                results_json TEXT NOT NULL DEFAULT '{}',
                test_output TEXT,
                coverage_percent REAL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (task_id) REFERENCES tasks(id)
            );

            CREATE TABLE IF NOT EXISTS evolution_log (
                id TEXT PRIMARY KEY,
                pattern TEXT NOT NULL,
                proposal TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'proposed',
                applied_at TEXT,
                result TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            -- Indexes for common queries
            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
            CREATE INDEX IF NOT EXISTS idx_tasks_plan ON tasks(plan_id);
            CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
            CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority);
            CREATE INDEX IF NOT EXISTS idx_conversations_agent ON conversations(agent);
            CREATE INDEX IF NOT EXISTS idx_conversations_task ON conversations(task_id);
            CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log(agent);
            CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
            CREATE INDEX IF NOT EXISTS idx_verification_task ON verification_results(task_id);

            -- Sequence table for ticket numbering
            CREATE TABLE IF NOT EXISTS sequences (
                name TEXT PRIMARY KEY,
                value INTEGER NOT NULL DEFAULT 0
            );
            INSERT OR IGNORE INTO sequences (name, value) VALUES ('ticket_number', 0);
        `);
    }

    private genId(): string {
        return crypto.randomUUID();
    }

    private nextTicketNumber(): number {
        const stmt = this.db.prepare('UPDATE sequences SET value = value + 1 WHERE name = ? RETURNING value');
        const row = stmt.get('ticket_number') as { value: number };
        return row.value;
    }

    // ==================== TASKS ====================

    createTask(data: Partial<Task> & { title: string }): Task {
        const id = data.id || this.genId();
        const now = new Date().toISOString();
        const stmt = this.db.prepare(`
            INSERT INTO tasks (id, title, description, status, priority, dependencies, acceptance_criteria, plan_id, parent_task_id, estimated_minutes, files_modified, context_bundle, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            id,
            data.title,
            data.description || '',
            data.status || TaskStatus.NotStarted,
            data.priority || TaskPriority.P2,
            JSON.stringify(data.dependencies || []),
            data.acceptance_criteria || '',
            data.plan_id || null,
            data.parent_task_id || null,
            data.estimated_minutes || 30,
            JSON.stringify(data.files_modified || []),
            data.context_bundle || null,
            now,
            now
        );
        return this.getTask(id)!;
    }

    getTask(id: string): Task | null {
        const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (!row) return null;
        return this.rowToTask(row);
    }

    getAllTasks(): Task[] {
        const rows = this.db.prepare('SELECT * FROM tasks ORDER BY priority ASC, created_at ASC').all() as Record<string, unknown>[];
        return rows.map(r => this.rowToTask(r));
    }

    getTasksByStatus(status: string): Task[] {
        const rows = this.db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY priority ASC, created_at ASC').all(status) as Record<string, unknown>[];
        return rows.map(r => this.rowToTask(r));
    }

    getTasksByPlan(planId: string): Task[] {
        const rows = this.db.prepare('SELECT * FROM tasks WHERE plan_id = ? ORDER BY priority ASC, created_at ASC').all(planId) as Record<string, unknown>[];
        return rows.map(r => this.rowToTask(r));
    }

    getReadyTasks(): Task[] {
        const allTasks = this.getTasksByStatus(TaskStatus.NotStarted);
        return allTasks.filter(task => {
            if (task.dependencies.length === 0) return true;
            return task.dependencies.every(depId => {
                const dep = this.getTask(depId);
                return dep && dep.status === TaskStatus.Verified;
            });
        });
    }

    getNextReadyTask(): Task | null {
        const ready = this.getReadyTasks();
        if (ready.length === 0) return null;
        // P1 first, then P2, then P3 — and oldest first within same priority
        ready.sort((a, b) => {
            const prioOrder: Record<string, number> = { P1: 0, P2: 1, P3: 2 };
            const prioDiff = (prioOrder[a.priority] ?? 1) - (prioOrder[b.priority] ?? 1);
            if (prioDiff !== 0) return prioDiff;
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        });
        return ready[0];
    }

    updateTask(id: string, updates: Partial<Task>): Task | null {
        const existing = this.getTask(id);
        if (!existing) return null;

        const fields: string[] = [];
        const values: unknown[] = [];

        if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
        if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
        if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
        if (updates.priority !== undefined) { fields.push('priority = ?'); values.push(updates.priority); }
        if (updates.dependencies !== undefined) { fields.push('dependencies = ?'); values.push(JSON.stringify(updates.dependencies)); }
        if (updates.acceptance_criteria !== undefined) { fields.push('acceptance_criteria = ?'); values.push(updates.acceptance_criteria); }
        if (updates.estimated_minutes !== undefined) { fields.push('estimated_minutes = ?'); values.push(updates.estimated_minutes); }
        if (updates.files_modified !== undefined) { fields.push('files_modified = ?'); values.push(JSON.stringify(updates.files_modified)); }
        if (updates.context_bundle !== undefined) { fields.push('context_bundle = ?'); values.push(updates.context_bundle); }

        if (fields.length === 0) return existing;

        fields.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(id);

        this.db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return this.getTask(id);
    }

    deleteTask(id: string): boolean {
        const result = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
        return Number(result.changes) > 0;
    }

    private rowToTask(row: Record<string, unknown>): Task {
        return {
            id: row.id as string,
            title: row.title as string,
            description: row.description as string,
            status: row.status as TaskStatus,
            priority: row.priority as TaskPriority,
            dependencies: JSON.parse((row.dependencies as string) || '[]'),
            acceptance_criteria: row.acceptance_criteria as string,
            plan_id: row.plan_id as string | null,
            parent_task_id: row.parent_task_id as string | null,
            estimated_minutes: row.estimated_minutes as number,
            files_modified: JSON.parse((row.files_modified as string) || '[]'),
            context_bundle: row.context_bundle as string | null,
            created_at: row.created_at as string,
            updated_at: row.updated_at as string,
        };
    }

    // ==================== TICKETS ====================

    createTicket(data: Partial<Ticket> & { title: string }): Ticket {
        const id = data.id || this.genId();
        const ticketNumber = this.nextTicketNumber();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO tickets (id, ticket_number, title, body, status, priority, creator, assignee, task_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            ticketNumber,
            data.title,
            data.body || '',
            data.status || TicketStatus.Open,
            data.priority || TicketPriority.P2,
            data.creator || 'system',
            data.assignee || null,
            data.task_id || null,
            now,
            now
        );
        return this.getTicket(id)!;
    }

    getTicket(id: string): Ticket | null {
        const row = this.db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (!row) return null;
        return this.rowToTicket(row);
    }

    getTicketByNumber(num: number): Ticket | null {
        const row = this.db.prepare('SELECT * FROM tickets WHERE ticket_number = ?').get(num) as Record<string, unknown> | undefined;
        if (!row) return null;
        return this.rowToTicket(row);
    }

    getAllTickets(): Ticket[] {
        const rows = this.db.prepare('SELECT * FROM tickets ORDER BY priority ASC, created_at DESC').all() as Record<string, unknown>[];
        return rows.map(r => this.rowToTicket(r));
    }

    getTicketsByStatus(status: string): Ticket[] {
        const rows = this.db.prepare('SELECT * FROM tickets WHERE status = ? ORDER BY priority ASC, created_at DESC').all(status) as Record<string, unknown>[];
        return rows.map(r => this.rowToTicket(r));
    }

    getActiveTicketCount(): number {
        const row = this.db.prepare("SELECT COUNT(*) as count FROM tickets WHERE status IN ('open', 'in_review', 'escalated')").get() as { count: number };
        return row.count;
    }

    updateTicket(id: string, updates: Partial<Ticket>): Ticket | null {
        const existing = this.getTicket(id);
        if (!existing) return null;

        const fields: string[] = [];
        const values: unknown[] = [];

        if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
        if (updates.body !== undefined) { fields.push('body = ?'); values.push(updates.body); }
        if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
        if (updates.priority !== undefined) { fields.push('priority = ?'); values.push(updates.priority); }
        if (updates.assignee !== undefined) { fields.push('assignee = ?'); values.push(updates.assignee); }

        if (fields.length === 0) return existing;

        fields.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(id);

        this.db.prepare(`UPDATE tickets SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return this.getTicket(id);
    }

    private rowToTicket(row: Record<string, unknown>): Ticket {
        return {
            id: row.id as string,
            ticket_number: row.ticket_number as number,
            title: row.title as string,
            body: row.body as string,
            status: row.status as TicketStatus,
            priority: row.priority as TicketPriority,
            creator: row.creator as string,
            assignee: row.assignee as string | null,
            task_id: row.task_id as string | null,
            created_at: row.created_at as string,
            updated_at: row.updated_at as string,
        };
    }

    // ==================== TICKET REPLIES ====================

    addTicketReply(ticketId: string, author: string, body: string, clarityScore?: number): TicketReply {
        const id = this.genId();
        this.db.prepare(`
            INSERT INTO ticket_replies (id, ticket_id, author, body, clarity_score, created_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
        `).run(id, ticketId, author, body, clarityScore ?? null);
        return this.db.prepare('SELECT * FROM ticket_replies WHERE id = ?').get(id) as TicketReply;
    }

    getTicketReplies(ticketId: string): TicketReply[] {
        return this.db.prepare('SELECT * FROM ticket_replies WHERE ticket_id = ? ORDER BY created_at ASC').all(ticketId) as TicketReply[];
    }

    // ==================== CONVERSATIONS ====================

    addConversation(agent: string, role: ConversationRole, content: string, taskId?: string, ticketId?: string, tokensUsed?: number): Conversation {
        const id = this.genId();
        this.db.prepare(`
            INSERT INTO conversations (id, agent, role, content, task_id, ticket_id, tokens_used, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(id, agent, role, content, taskId || null, ticketId || null, tokensUsed || null);
        return this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Conversation;
    }

    getConversationsByAgent(agent: string, limit: number = 50): Conversation[] {
        return this.db.prepare('SELECT * FROM conversations WHERE agent = ? ORDER BY created_at DESC LIMIT ?').all(agent, limit) as Conversation[];
    }

    getConversationsByTask(taskId: string): Conversation[] {
        return this.db.prepare('SELECT * FROM conversations WHERE task_id = ? ORDER BY created_at ASC').all(taskId) as Conversation[];
    }

    getRecentConversations(limit: number = 20): Conversation[] {
        return this.db.prepare('SELECT * FROM conversations ORDER BY created_at DESC LIMIT ?').all(limit) as Conversation[];
    }

    // ==================== PLANS ====================

    createPlan(name: string, configJson: string = '{}'): Plan {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO plans (id, name, status, config_json, created_at, updated_at)
            VALUES (?, ?, 'draft', ?, ?, ?)
        `).run(id, name, configJson, now, now);
        return this.getPlan(id)!;
    }

    getPlan(id: string): Plan | null {
        return this.db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as Plan | undefined || null;
    }

    getActivePlan(): Plan | null {
        return this.db.prepare("SELECT * FROM plans WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1").get() as Plan | undefined || null;
    }

    getAllPlans(): Plan[] {
        return this.db.prepare('SELECT * FROM plans ORDER BY updated_at DESC').all() as Plan[];
    }

    updatePlan(id: string, updates: Partial<Plan>): Plan | null {
        const fields: string[] = [];
        const values: unknown[] = [];
        if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
        if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
        if (updates.config_json !== undefined) { fields.push('config_json = ?'); values.push(updates.config_json); }
        if (fields.length === 0) return this.getPlan(id);
        fields.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(id);
        this.db.prepare(`UPDATE plans SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return this.getPlan(id);
    }

    // ==================== AGENTS ====================

    registerAgent(name: string, type: AgentType, configYaml?: string): Agent {
        const id = this.genId();
        this.db.prepare(`
            INSERT OR REPLACE INTO agents (id, name, type, status, config_yaml, created_at)
            VALUES (?, ?, ?, 'idle', ?, datetime('now'))
        `).run(id, name, type, configYaml || null);
        return this.getAgentByName(name)!;
    }

    getAgentByName(name: string): Agent | null {
        return this.db.prepare('SELECT * FROM agents WHERE name = ?').get(name) as Agent | undefined || null;
    }

    getAllAgents(): Agent[] {
        return this.db.prepare('SELECT * FROM agents ORDER BY type ASC, name ASC').all() as Agent[];
    }

    updateAgentStatus(name: string, status: AgentStatus, currentTask?: string): void {
        this.db.prepare(`
            UPDATE agents SET status = ?, current_task = ?, last_activity = datetime('now')
            WHERE name = ?
        `).run(status, currentTask || null, name);
    }

    // ==================== AUDIT LOG ====================

    addAuditLog(agent: string, action: string, detail: string): AuditLogEntry {
        const id = this.genId();
        this.db.prepare(`
            INSERT INTO audit_log (id, agent, action, detail, created_at)
            VALUES (?, ?, ?, ?, datetime('now'))
        `).run(id, agent, action, detail);
        return this.db.prepare('SELECT * FROM audit_log WHERE id = ?').get(id) as AuditLogEntry;
    }

    getAuditLog(limit: number = 100, agent?: string): AuditLogEntry[] {
        if (agent) {
            return this.db.prepare('SELECT * FROM audit_log WHERE agent = ? ORDER BY created_at DESC LIMIT ?').all(agent, limit) as AuditLogEntry[];
        }
        return this.db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?').all(limit) as AuditLogEntry[];
    }

    // ==================== VERIFICATION ====================

    createVerificationResult(taskId: string): VerificationResult {
        const id = this.genId();
        this.db.prepare(`
            INSERT INTO verification_results (id, task_id, status, results_json, created_at)
            VALUES (?, ?, 'not_started', '{}', datetime('now'))
        `).run(id, taskId);
        return this.db.prepare('SELECT * FROM verification_results WHERE id = ?').get(id) as VerificationResult;
    }

    getVerificationResult(taskId: string): VerificationResult | null {
        return this.db.prepare('SELECT * FROM verification_results WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(taskId) as VerificationResult | undefined || null;
    }

    updateVerificationResult(id: string, status: VerificationStatus, resultsJson: string, testOutput?: string, coverage?: number): void {
        this.db.prepare(`
            UPDATE verification_results SET status = ?, results_json = ?, test_output = ?, coverage_percent = ?
            WHERE id = ?
        `).run(status, resultsJson, testOutput || null, coverage ?? null, id);
    }

    // ==================== EVOLUTION ====================

    addEvolutionEntry(pattern: string, proposal: string): EvolutionLogEntry {
        const id = this.genId();
        this.db.prepare(`
            INSERT INTO evolution_log (id, pattern, proposal, status, created_at)
            VALUES (?, ?, ?, 'proposed', datetime('now'))
        `).run(id, pattern, proposal);
        return this.db.prepare('SELECT * FROM evolution_log WHERE id = ?').get(id) as EvolutionLogEntry;
    }

    getEvolutionLog(limit: number = 20): EvolutionLogEntry[] {
        return this.db.prepare('SELECT * FROM evolution_log ORDER BY created_at DESC LIMIT ?').all(limit) as EvolutionLogEntry[];
    }

    updateEvolutionEntry(id: string, status: string, result?: string): void {
        this.db.prepare(`
            UPDATE evolution_log SET status = ?, result = ?, applied_at = CASE WHEN ? = 'applied' THEN datetime('now') ELSE applied_at END
            WHERE id = ?
        `).run(status, result || null, status, id);
    }

    // ==================== UTILITY ====================

    getStats(): Record<string, number> {
        const tasksByStatus = this.db.prepare("SELECT status, COUNT(*) as count FROM tasks GROUP BY status").all() as Array<{ status: string; count: number }>;
        const ticketsByStatus = this.db.prepare("SELECT status, COUNT(*) as count FROM tickets GROUP BY status").all() as Array<{ status: string; count: number }>;
        const stats: Record<string, number> = {
            total_tasks: 0,
            total_tickets: 0,
            total_conversations: (this.db.prepare("SELECT COUNT(*) as count FROM conversations").get() as { count: number }).count,
            total_audit_entries: (this.db.prepare("SELECT COUNT(*) as count FROM audit_log").get() as { count: number }).count,
        };
        for (const row of tasksByStatus) {
            stats[`tasks_${row.status}`] = row.count;
            stats.total_tasks += row.count;
        }
        for (const row of ticketsByStatus) {
            stats[`tickets_${row.status}`] = row.count;
            stats.total_tickets += row.count;
        }
        return stats;
    }

    clearInMemoryState(): void {
        // Used by Fresh Restart — clear transient data but keep persistent records
        // This resets task queue state while preserving history
        this.db.prepare("UPDATE tasks SET status = 'not_started' WHERE status = 'in_progress'").run();
        this.db.prepare("UPDATE agents SET status = 'idle', current_task = NULL").run();
    }

    close(): void {
        if (this.db) {
            this.db.close();
        }
    }
}
