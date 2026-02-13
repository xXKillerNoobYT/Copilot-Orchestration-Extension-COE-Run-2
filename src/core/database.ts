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
    EvolutionLogEntry,
    GitHubIssue,
    DesignComponent, DesignPage, DesignToken, PageFlow,
    CodingSession, CodingMessage
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

            CREATE TABLE IF NOT EXISTS github_issues (
                id TEXT PRIMARY KEY,
                github_id INTEGER NOT NULL,
                number INTEGER NOT NULL,
                title TEXT NOT NULL,
                body TEXT NOT NULL DEFAULT '',
                state TEXT NOT NULL DEFAULT 'open',
                labels TEXT NOT NULL DEFAULT '[]',
                assignees TEXT NOT NULL DEFAULT '[]',
                repo_owner TEXT NOT NULL,
                repo_name TEXT NOT NULL,
                task_id TEXT,
                local_checksum TEXT NOT NULL DEFAULT '',
                remote_checksum TEXT NOT NULL DEFAULT '',
                synced_at TEXT NOT NULL DEFAULT (datetime('now')),
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (task_id) REFERENCES tasks(id)
            );

            CREATE INDEX IF NOT EXISTS idx_github_issues_number ON github_issues(number);
            CREATE INDEX IF NOT EXISTS idx_github_issues_state ON github_issues(state);
            CREATE INDEX IF NOT EXISTS idx_github_issues_repo ON github_issues(repo_owner, repo_name);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_github_issues_github_id ON github_issues(github_id);

            -- Sequence table for ticket numbering
            CREATE TABLE IF NOT EXISTS sequences (
                name TEXT PRIMARY KEY,
                value INTEGER NOT NULL DEFAULT 0
            );
            INSERT OR IGNORE INTO sequences (name, value) VALUES ('ticket_number', 0);
        `);

        // Migration: add sort_order column to tasks (may already exist)
        try {
            this.db.exec('ALTER TABLE tasks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
        } catch {
            // Column already exists — ignore
        }

        // ===== New tables for Visual Designer, Coding Conversations, Design Tokens =====
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS design_pages (
                id TEXT PRIMARY KEY,
                plan_id TEXT NOT NULL,
                name TEXT NOT NULL DEFAULT 'Untitled Page',
                route TEXT NOT NULL DEFAULT '/',
                sort_order INTEGER NOT NULL DEFAULT 0,
                width INTEGER NOT NULL DEFAULT 1440,
                height INTEGER NOT NULL DEFAULT 900,
                background TEXT NOT NULL DEFAULT '#1e1e2e',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (plan_id) REFERENCES plans(id)
            );

            CREATE TABLE IF NOT EXISTS design_components (
                id TEXT PRIMARY KEY,
                plan_id TEXT NOT NULL,
                page_id TEXT,
                type TEXT NOT NULL DEFAULT 'container',
                name TEXT NOT NULL DEFAULT 'Component',
                parent_id TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                x REAL NOT NULL DEFAULT 0,
                y REAL NOT NULL DEFAULT 0,
                width REAL NOT NULL DEFAULT 200,
                height REAL NOT NULL DEFAULT 100,
                styles TEXT NOT NULL DEFAULT '{}',
                content TEXT NOT NULL DEFAULT '',
                props TEXT NOT NULL DEFAULT '{}',
                responsive TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (plan_id) REFERENCES plans(id),
                FOREIGN KEY (page_id) REFERENCES design_pages(id),
                FOREIGN KEY (parent_id) REFERENCES design_components(id)
            );

            CREATE TABLE IF NOT EXISTS design_tokens (
                id TEXT PRIMARY KEY,
                plan_id TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'color',
                name TEXT NOT NULL,
                value TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (plan_id) REFERENCES plans(id)
            );

            CREATE TABLE IF NOT EXISTS page_flows (
                id TEXT PRIMARY KEY,
                plan_id TEXT NOT NULL,
                from_page_id TEXT NOT NULL,
                to_page_id TEXT NOT NULL,
                trigger TEXT NOT NULL DEFAULT 'click',
                label TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (plan_id) REFERENCES plans(id),
                FOREIGN KEY (from_page_id) REFERENCES design_pages(id),
                FOREIGN KEY (to_page_id) REFERENCES design_pages(id)
            );

            CREATE TABLE IF NOT EXISTS coding_sessions (
                id TEXT PRIMARY KEY,
                plan_id TEXT,
                name TEXT NOT NULL DEFAULT 'Session',
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (plan_id) REFERENCES plans(id)
            );

            CREATE TABLE IF NOT EXISTS coding_messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                content TEXT NOT NULL DEFAULT '',
                tool_calls TEXT NOT NULL DEFAULT '[]',
                task_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (session_id) REFERENCES coding_sessions(id),
                FOREIGN KEY (task_id) REFERENCES tasks(id)
            );

            CREATE INDEX IF NOT EXISTS idx_design_pages_plan ON design_pages(plan_id);
            CREATE INDEX IF NOT EXISTS idx_design_components_plan ON design_components(plan_id);
            CREATE INDEX IF NOT EXISTS idx_design_components_page ON design_components(page_id);
            CREATE INDEX IF NOT EXISTS idx_design_tokens_plan ON design_tokens(plan_id);
            CREATE INDEX IF NOT EXISTS idx_page_flows_plan ON page_flows(plan_id);
            CREATE INDEX IF NOT EXISTS idx_coding_sessions_plan ON coding_sessions(plan_id);
            CREATE INDEX IF NOT EXISTS idx_coding_messages_session ON coding_messages(session_id);

            -- Context Snapshots: stores full context state for Level 5 "Fresh Start"
            -- in the Context Breaking Chain. When context exceeds all compression levels,
            -- the system saves everything here and restarts with a clean slate.
            CREATE TABLE IF NOT EXISTS context_snapshots (
                id TEXT PRIMARY KEY,
                agent_type TEXT NOT NULL,
                task_id TEXT,
                plan_id TEXT,
                context_json TEXT NOT NULL DEFAULT '{}',
                summary TEXT NOT NULL DEFAULT '',
                token_count INTEGER NOT NULL DEFAULT 0,
                breaking_level INTEGER NOT NULL DEFAULT 5,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (task_id) REFERENCES tasks(id),
                FOREIGN KEY (plan_id) REFERENCES plans(id)
            );

            CREATE INDEX IF NOT EXISTS idx_context_snapshots_agent ON context_snapshots(agent_type);
            CREATE INDEX IF NOT EXISTS idx_context_snapshots_task ON context_snapshots(task_id);
            CREATE INDEX IF NOT EXISTS idx_context_snapshots_created ON context_snapshots(created_at);
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
            INSERT INTO tasks (id, title, description, status, priority, dependencies, acceptance_criteria, plan_id, parent_task_id, estimated_minutes, files_modified, context_bundle, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            data.sort_order ?? 0,
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
        const rows = this.db.prepare('SELECT * FROM tasks WHERE plan_id = ? ORDER BY sort_order ASC, priority ASC, created_at ASC').all(planId) as Record<string, unknown>[];
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
        if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); values.push(updates.sort_order); }
        if (updates.parent_task_id !== undefined) { fields.push('parent_task_id = ?'); values.push(updates.parent_task_id); }

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

    reorderTasks(taskOrders: Array<{ id: string; sort_order: number; parent_task_id?: string | null }>): void {
        const stmt = this.db.prepare('UPDATE tasks SET sort_order = ?, parent_task_id = ?, updated_at = ? WHERE id = ?');
        const now = new Date().toISOString();
        for (const item of taskOrders) {
            stmt.run(item.sort_order, item.parent_task_id ?? null, now, item.id);
        }
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
            sort_order: (row.sort_order as number) ?? 0,
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

    // ==================== GITHUB ISSUES ====================

    upsertGitHubIssue(issue: Omit<GitHubIssue, 'id' | 'created_at' | 'updated_at' | 'synced_at'>): GitHubIssue {
        const existing = this.getGitHubIssueByGitHubId(issue.github_id);
        if (existing) {
            this.db.prepare(`
                UPDATE github_issues SET
                    title = ?, body = ?, state = ?, labels = ?, assignees = ?,
                    remote_checksum = ?, synced_at = datetime('now'), updated_at = datetime('now')
                WHERE id = ?
            `).run(
                issue.title, issue.body, issue.state,
                JSON.stringify(issue.labels), JSON.stringify(issue.assignees),
                issue.remote_checksum, existing.id
            );
            return this.getGitHubIssue(existing.id)!;
        }

        const id = crypto.randomUUID();
        this.db.prepare(`
            INSERT INTO github_issues (id, github_id, number, title, body, state, labels, assignees, repo_owner, repo_name, task_id, local_checksum, remote_checksum)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, issue.github_id, issue.number, issue.title, issue.body, issue.state,
            JSON.stringify(issue.labels), JSON.stringify(issue.assignees),
            issue.repo_owner, issue.repo_name, issue.task_id,
            issue.local_checksum, issue.remote_checksum
        );
        return this.getGitHubIssue(id)!;
    }

    getGitHubIssue(id: string): GitHubIssue | null {
        const row = this.db.prepare('SELECT * FROM github_issues WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        return row ? this.parseGitHubIssueRow(row) : null;
    }

    getGitHubIssueByNumber(number: number, repoOwner: string, repoName: string): GitHubIssue | null {
        const row = this.db.prepare(
            'SELECT * FROM github_issues WHERE number = ? AND repo_owner = ? AND repo_name = ?'
        ).get(number, repoOwner, repoName) as Record<string, unknown> | undefined;
        return row ? this.parseGitHubIssueRow(row) : null;
    }

    getGitHubIssueByGitHubId(githubId: number): GitHubIssue | null {
        const row = this.db.prepare('SELECT * FROM github_issues WHERE github_id = ?').get(githubId) as Record<string, unknown> | undefined;
        return row ? this.parseGitHubIssueRow(row) : null;
    }

    getAllGitHubIssues(repoOwner?: string, repoName?: string): GitHubIssue[] {
        let rows: Record<string, unknown>[];
        if (repoOwner && repoName) {
            rows = this.db.prepare(
                'SELECT * FROM github_issues WHERE repo_owner = ? AND repo_name = ? ORDER BY number DESC'
            ).all(repoOwner, repoName) as Record<string, unknown>[];
        } else {
            rows = this.db.prepare('SELECT * FROM github_issues ORDER BY number DESC').all() as Record<string, unknown>[];
        }
        return rows.map(r => this.parseGitHubIssueRow(r));
    }

    getUnsyncedGitHubIssues(): GitHubIssue[] {
        const rows = this.db.prepare(
            'SELECT * FROM github_issues WHERE local_checksum != remote_checksum ORDER BY number ASC'
        ).all() as Record<string, unknown>[];
        return rows.map(r => this.parseGitHubIssueRow(r));
    }

    updateGitHubIssueChecksum(id: string, localChecksum: string, remoteChecksum: string): void {
        this.db.prepare(
            'UPDATE github_issues SET local_checksum = ?, remote_checksum = ?, synced_at = datetime(\'now\') WHERE id = ?'
        ).run(localChecksum, remoteChecksum, id);
    }

    linkGitHubIssueToTask(issueId: string, taskId: string): void {
        this.db.prepare('UPDATE github_issues SET task_id = ? WHERE id = ?').run(taskId, issueId);
    }

    private parseGitHubIssueRow(row: Record<string, unknown>): GitHubIssue {
        return {
            id: row.id as string,
            github_id: row.github_id as number,
            number: row.number as number,
            title: row.title as string,
            body: row.body as string,
            state: row.state as 'open' | 'closed',
            labels: JSON.parse((row.labels as string) || '[]'),
            assignees: JSON.parse((row.assignees as string) || '[]'),
            repo_owner: row.repo_owner as string,
            repo_name: row.repo_name as string,
            task_id: (row.task_id as string) || null,
            local_checksum: row.local_checksum as string,
            remote_checksum: row.remote_checksum as string,
            synced_at: row.synced_at as string,
            created_at: row.created_at as string,
            updated_at: row.updated_at as string,
        };
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

    // ==================== DESIGN PAGES ====================

    createDesignPage(data: Partial<DesignPage> & { plan_id: string }): DesignPage {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO design_pages (id, plan_id, name, route, sort_order, width, height, background, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, data.plan_id, data.name || 'Untitled Page', data.route || '/', data.sort_order ?? 0, data.width ?? 1440, data.height ?? 900, data.background || '#1e1e2e', now, now);
        return this.db.prepare('SELECT * FROM design_pages WHERE id = ?').get(id) as DesignPage;
    }

    getDesignPage(id: string): DesignPage | null {
        return this.db.prepare('SELECT * FROM design_pages WHERE id = ?').get(id) as DesignPage | undefined || null;
    }

    getDesignPagesByPlan(planId: string): DesignPage[] {
        return this.db.prepare('SELECT * FROM design_pages WHERE plan_id = ? ORDER BY sort_order ASC').all(planId) as DesignPage[];
    }

    updateDesignPage(id: string, updates: Partial<DesignPage>): DesignPage | null {
        const fields: string[] = [];
        const values: unknown[] = [];
        for (const [key, val] of Object.entries(updates)) {
            if (key === 'id' || key === 'created_at') continue;
            fields.push(`${key} = ?`);
            values.push(val);
        }
        if (fields.length === 0) return this.getDesignPage(id);
        fields.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(id);
        this.db.prepare(`UPDATE design_pages SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return this.getDesignPage(id);
    }

    deleteDesignPage(id: string): void {
        this.db.prepare('DELETE FROM design_components WHERE page_id = ?').run(id);
        this.db.prepare('DELETE FROM page_flows WHERE from_page_id = ? OR to_page_id = ?').run(id, id);
        this.db.prepare('DELETE FROM design_pages WHERE id = ?').run(id);
    }

    // ==================== DESIGN COMPONENTS ====================

    createDesignComponent(data: Partial<DesignComponent> & { plan_id: string; type: string }): DesignComponent {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO design_components (id, plan_id, page_id, type, name, parent_id, sort_order, x, y, width, height, styles, content, props, responsive, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, data.plan_id, data.page_id || null, data.type, data.name || 'Component',
            data.parent_id || null, data.sort_order ?? 0,
            data.x ?? 0, data.y ?? 0, data.width ?? 200, data.height ?? 100,
            JSON.stringify(data.styles || {}), data.content || '',
            JSON.stringify(data.props || {}), JSON.stringify(data.responsive || {}),
            now, now
        );
        return this.getDesignComponent(id)!;
    }

    getDesignComponent(id: string): DesignComponent | null {
        const row = this.db.prepare('SELECT * FROM design_components WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        return row ? this.parseComponentRow(row) : null;
    }

    getDesignComponentsByPage(pageId: string): DesignComponent[] {
        const rows = this.db.prepare('SELECT * FROM design_components WHERE page_id = ? ORDER BY sort_order ASC').all(pageId) as Record<string, unknown>[];
        return rows.map(r => this.parseComponentRow(r));
    }

    getDesignComponentsByPlan(planId: string): DesignComponent[] {
        const rows = this.db.prepare('SELECT * FROM design_components WHERE plan_id = ? ORDER BY sort_order ASC').all(planId) as Record<string, unknown>[];
        return rows.map(r => this.parseComponentRow(r));
    }

    updateDesignComponent(id: string, updates: Record<string, unknown>): DesignComponent | null {
        const fields: string[] = [];
        const values: unknown[] = [];
        for (const [key, val] of Object.entries(updates)) {
            if (key === 'id' || key === 'created_at') continue;
            if (key === 'styles' || key === 'props' || key === 'responsive') {
                fields.push(`${key} = ?`);
                values.push(JSON.stringify(val));
            } else {
                fields.push(`${key} = ?`);
                values.push(val);
            }
        }
        if (fields.length === 0) return this.getDesignComponent(id);
        fields.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(id);
        this.db.prepare(`UPDATE design_components SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return this.getDesignComponent(id);
    }

    deleteDesignComponent(id: string): void {
        // Re-parent children to parent of deleted component
        const comp = this.getDesignComponent(id);
        if (comp) {
            this.db.prepare('UPDATE design_components SET parent_id = ? WHERE parent_id = ?').run(comp.parent_id, id);
        }
        this.db.prepare('DELETE FROM design_components WHERE id = ?').run(id);
    }

    batchUpdateComponents(updates: Array<{ id: string; x?: number; y?: number; width?: number; height?: number; sort_order?: number; parent_id?: string | null }>): void {
        const stmt = this.db.prepare('UPDATE design_components SET x = COALESCE(?, x), y = COALESCE(?, y), width = COALESCE(?, width), height = COALESCE(?, height), sort_order = COALESCE(?, sort_order), parent_id = COALESCE(?, parent_id), updated_at = ? WHERE id = ?');
        const now = new Date().toISOString();
        for (const u of updates) {
            stmt.run(u.x ?? null, u.y ?? null, u.width ?? null, u.height ?? null, u.sort_order ?? null, u.parent_id !== undefined ? u.parent_id : null, now, u.id);
        }
    }

    private parseComponentRow(row: Record<string, unknown>): DesignComponent {
        return {
            id: row.id as string,
            plan_id: row.plan_id as string,
            page_id: (row.page_id as string) || null,
            type: row.type as DesignComponent['type'],
            name: row.name as string,
            parent_id: (row.parent_id as string) || null,
            sort_order: (row.sort_order as number) ?? 0,
            x: (row.x as number) ?? 0,
            y: (row.y as number) ?? 0,
            width: (row.width as number) ?? 200,
            height: (row.height as number) ?? 100,
            styles: JSON.parse((row.styles as string) || '{}'),
            content: (row.content as string) || '',
            props: JSON.parse((row.props as string) || '{}'),
            responsive: JSON.parse((row.responsive as string) || '{}'),
            created_at: row.created_at as string,
            updated_at: row.updated_at as string,
        };
    }

    // ==================== DESIGN TOKENS ====================

    createDesignToken(data: Partial<DesignToken> & { plan_id: string; name: string; value: string }): DesignToken {
        const id = this.genId();
        this.db.prepare(`
            INSERT INTO design_tokens (id, plan_id, category, name, value, description, created_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(id, data.plan_id, data.category || 'color', data.name, data.value, data.description || '');
        return this.db.prepare('SELECT * FROM design_tokens WHERE id = ?').get(id) as DesignToken;
    }

    getDesignTokensByPlan(planId: string): DesignToken[] {
        return this.db.prepare('SELECT * FROM design_tokens WHERE plan_id = ? ORDER BY category, name').all(planId) as DesignToken[];
    }

    updateDesignToken(id: string, updates: Partial<DesignToken>): void {
        const fields: string[] = [];
        const values: unknown[] = [];
        for (const [key, val] of Object.entries(updates)) {
            if (key === 'id' || key === 'created_at' || key === 'plan_id') continue;
            fields.push(`${key} = ?`);
            values.push(val);
        }
        if (fields.length === 0) return;
        values.push(id);
        this.db.prepare(`UPDATE design_tokens SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    deleteDesignToken(id: string): void {
        this.db.prepare('DELETE FROM design_tokens WHERE id = ?').run(id);
    }

    // ==================== PAGE FLOWS ====================

    createPageFlow(data: { plan_id: string; from_page_id: string; to_page_id: string; trigger?: string; label?: string }): PageFlow {
        const id = this.genId();
        this.db.prepare(`
            INSERT INTO page_flows (id, plan_id, from_page_id, to_page_id, trigger, label, created_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(id, data.plan_id, data.from_page_id, data.to_page_id, data.trigger || 'click', data.label || '');
        return this.db.prepare('SELECT * FROM page_flows WHERE id = ?').get(id) as PageFlow;
    }

    getPageFlowsByPlan(planId: string): PageFlow[] {
        return this.db.prepare('SELECT * FROM page_flows WHERE plan_id = ? ORDER BY created_at').all(planId) as PageFlow[];
    }

    deletePageFlow(id: string): void {
        this.db.prepare('DELETE FROM page_flows WHERE id = ?').run(id);
    }

    // ==================== CODING SESSIONS ====================

    createCodingSession(data: { plan_id?: string; name?: string }): CodingSession {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO coding_sessions (id, plan_id, name, status, created_at, updated_at)
            VALUES (?, ?, ?, 'active', ?, ?)
        `).run(id, data.plan_id || null, data.name || 'Coding Session', now, now);
        return this.db.prepare('SELECT * FROM coding_sessions WHERE id = ?').get(id) as CodingSession;
    }

    getCodingSession(id: string): CodingSession | null {
        return this.db.prepare('SELECT * FROM coding_sessions WHERE id = ?').get(id) as CodingSession | undefined || null;
    }

    getAllCodingSessions(): CodingSession[] {
        return this.db.prepare('SELECT * FROM coding_sessions ORDER BY updated_at DESC').all() as CodingSession[];
    }

    updateCodingSession(id: string, updates: Partial<CodingSession>): void {
        const fields: string[] = [];
        const values: unknown[] = [];
        for (const [key, val] of Object.entries(updates)) {
            if (key === 'id' || key === 'created_at') continue;
            fields.push(`${key} = ?`);
            values.push(val);
        }
        if (fields.length === 0) return;
        fields.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(id);
        this.db.prepare(`UPDATE coding_sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    // ==================== CODING MESSAGES ====================

    addCodingMessage(data: { session_id: string; role: string; content: string; tool_calls?: string; task_id?: string }): CodingMessage {
        const id = this.genId();
        this.db.prepare(`
            INSERT INTO coding_messages (id, session_id, role, content, tool_calls, task_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(id, data.session_id, data.role, data.content, data.tool_calls || '[]', data.task_id || null);
        // Update session timestamp
        this.db.prepare('UPDATE coding_sessions SET updated_at = datetime(\'now\') WHERE id = ?').run(data.session_id);
        return this.db.prepare('SELECT * FROM coding_messages WHERE id = ?').get(id) as CodingMessage;
    }

    getCodingMessages(sessionId: string, limit: number = 100): CodingMessage[] {
        return this.db.prepare('SELECT * FROM coding_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?').all(sessionId, limit) as CodingMessage[];
    }

    clearInMemoryState(): void {
        // Used by Fresh Restart — clear transient data but keep persistent records
        // This resets task queue state while preserving history
        this.db.prepare("UPDATE tasks SET status = 'not_started' WHERE status = 'in_progress'").run();
        this.db.prepare("UPDATE agents SET status = 'idle', current_task = NULL").run();
    }

    // ==================== CONTEXT SNAPSHOTS ====================

    /**
     * Save a context snapshot for Level 5 "Fresh Start" recovery.
     * Called by ContextBreakingChain when all compression levels are exhausted.
     */
    saveContextSnapshot(data: {
        agentType: string;
        taskId?: string;
        planId?: string;
        contextJson: string;
        summary: string;
        tokenCount: number;
        breakingLevel?: number;
    }): { id: string } {
        const id = this.genId();
        this.db.prepare(`
            INSERT INTO context_snapshots (id, agent_type, task_id, plan_id, context_json, summary, token_count, breaking_level, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
            id,
            data.agentType,
            data.taskId ?? null,
            data.planId ?? null,
            data.contextJson,
            data.summary,
            data.tokenCount,
            data.breakingLevel ?? 5
        );
        return { id };
    }

    /**
     * Retrieve the most recent context snapshot for an agent/task combination.
     */
    getLatestContextSnapshot(agentType: string, taskId?: string): {
        id: string;
        agent_type: string;
        task_id: string | null;
        plan_id: string | null;
        context_json: string;
        summary: string;
        token_count: number;
        breaking_level: number;
        created_at: string;
    } | null {
        let query = 'SELECT * FROM context_snapshots WHERE agent_type = ?';
        const params: unknown[] = [agentType];

        if (taskId) {
            query += ' AND task_id = ?';
            params.push(taskId);
        }

        query += ' ORDER BY created_at DESC LIMIT 1';
        return this.db.prepare(query).get(...params) as {
            id: string;
            agent_type: string;
            task_id: string | null;
            plan_id: string | null;
            context_json: string;
            summary: string;
            token_count: number;
            breaking_level: number;
            created_at: string;
        } | null;
    }

    /**
     * Clean up old context snapshots, keeping only the most recent N per agent type.
     */
    pruneContextSnapshots(keepPerAgent: number = 10): number {
        // Get distinct agent types
        const agents = this.db.prepare(
            'SELECT DISTINCT agent_type FROM context_snapshots'
        ).all() as Array<{ agent_type: string }>;

        let totalDeleted = 0;

        for (const { agent_type } of agents) {
            const oldSnapshots = this.db.prepare(`
                SELECT id FROM context_snapshots
                WHERE agent_type = ?
                ORDER BY created_at DESC
                LIMIT -1 OFFSET ?
            `).all(agent_type, keepPerAgent) as Array<{ id: string }>;

            for (const snap of oldSnapshots) {
                this.db.prepare('DELETE FROM context_snapshots WHERE id = ?').run(snap.id);
                totalDeleted++;
            }
        }

        return totalDeleted;
    }

    close(): void {
        if (this.db) {
            this.db.close();
        }
    }
}
