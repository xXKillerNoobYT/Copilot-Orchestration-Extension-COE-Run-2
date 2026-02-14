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
    CodingSession, CodingMessage,
    // v2.0 types
    SyncConfig, SyncChange, SyncConflict, ConflictResolutionStrategy,
    EthicsModule, EthicsRule, EthicsAuditEntry, EthicsSensitivity,
    ActionLog, CodeDiff, CodeDiffStatus,
    LogicBlock, LogicBlockType,
    DeviceInfo, ComponentSchema,
    // v3.0 types
    ElementIssue, AISuggestion, AIQuestion, PlanVersion, DataModel,
    AIChatSession, AIChatMessage, DesignChangeLog
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
                parent_ticket_id TEXT DEFAULT NULL,
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

        // Migration: add parent_page_id, depth, requirements to design_pages
        try {
            this.db.exec('ALTER TABLE design_pages ADD COLUMN parent_page_id TEXT');
        } catch { /* already exists */ }
        try {
            this.db.exec('ALTER TABLE design_pages ADD COLUMN depth INTEGER NOT NULL DEFAULT 0');
        } catch { /* already exists */ }
        try {
            this.db.exec("ALTER TABLE design_pages ADD COLUMN requirements TEXT NOT NULL DEFAULT '[]'");
        } catch { /* already exists */ }

        // Migration: add requirements to design_components props
        try {
            this.db.exec("ALTER TABLE design_components ADD COLUMN requirements TEXT NOT NULL DEFAULT '[]'");
        } catch { /* already exists */ }

        // ===== New tables for Visual Designer, Coding Conversations, Design Tokens =====
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS design_pages (
                id TEXT PRIMARY KEY,
                plan_id TEXT NOT NULL,
                parent_page_id TEXT,
                depth INTEGER NOT NULL DEFAULT 0,
                name TEXT NOT NULL DEFAULT 'Untitled Page',
                route TEXT NOT NULL DEFAULT '/',
                sort_order INTEGER NOT NULL DEFAULT 0,
                width INTEGER NOT NULL DEFAULT 1440,
                height INTEGER NOT NULL DEFAULT 900,
                background TEXT NOT NULL DEFAULT '#1e1e2e',
                requirements TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (plan_id) REFERENCES plans(id),
                FOREIGN KEY (parent_page_id) REFERENCES design_pages(id)
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
                requirements TEXT NOT NULL DEFAULT '[]',
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

        // ===== v2.0 Tables: Sync, Ethics, Coding Agent, Transparency =====
        this.db.exec(`
            -- ==================== SYNC CONFIG ====================
            CREATE TABLE IF NOT EXISTS sync_config (
                id TEXT PRIMARY KEY,
                backend TEXT NOT NULL DEFAULT 'cloud',
                endpoint TEXT NOT NULL DEFAULT '',
                credentials_ref TEXT NOT NULL DEFAULT '',
                enabled INTEGER NOT NULL DEFAULT 0,
                auto_sync_interval_seconds INTEGER NOT NULL DEFAULT 0,
                default_conflict_strategy TEXT NOT NULL DEFAULT 'last_write_wins',
                max_file_size_bytes INTEGER NOT NULL DEFAULT 52428800,
                exclude_patterns TEXT NOT NULL DEFAULT '[]',
                device_id TEXT NOT NULL,
                device_name TEXT NOT NULL DEFAULT 'Unknown Device',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            -- ==================== SYNC CHANGES ====================
            CREATE TABLE IF NOT EXISTS sync_changes (
                id TEXT PRIMARY KEY,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                change_type TEXT NOT NULL DEFAULT 'update',
                device_id TEXT NOT NULL,
                before_hash TEXT NOT NULL DEFAULT '',
                after_hash TEXT NOT NULL DEFAULT '',
                patch TEXT NOT NULL DEFAULT '[]',
                sequence_number INTEGER NOT NULL DEFAULT 0,
                synced INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_sync_changes_entity ON sync_changes(entity_type, entity_id);
            CREATE INDEX IF NOT EXISTS idx_sync_changes_device ON sync_changes(device_id);
            CREATE INDEX IF NOT EXISTS idx_sync_changes_synced ON sync_changes(synced);
            CREATE INDEX IF NOT EXISTS idx_sync_changes_seq ON sync_changes(device_id, sequence_number);

            -- ==================== SYNC CONFLICTS ====================
            CREATE TABLE IF NOT EXISTS sync_conflicts (
                id TEXT PRIMARY KEY,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                local_version TEXT NOT NULL DEFAULT '{}',
                remote_version TEXT NOT NULL DEFAULT '{}',
                remote_device_id TEXT NOT NULL,
                local_changed_at TEXT NOT NULL,
                remote_changed_at TEXT NOT NULL,
                conflicting_fields TEXT NOT NULL DEFAULT '[]',
                resolution TEXT,
                resolved_by TEXT,
                resolved_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_sync_conflicts_entity ON sync_conflicts(entity_type, entity_id);
            CREATE INDEX IF NOT EXISTS idx_sync_conflicts_unresolved ON sync_conflicts(resolution) WHERE resolution IS NULL;

            -- ==================== ETHICS MODULES ====================
            CREATE TABLE IF NOT EXISTS ethics_modules (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                enabled INTEGER NOT NULL DEFAULT 1,
                sensitivity TEXT NOT NULL DEFAULT 'medium',
                scope TEXT NOT NULL DEFAULT '[]',
                allowed_actions TEXT NOT NULL DEFAULT '[]',
                blocked_actions TEXT NOT NULL DEFAULT '[]',
                version INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_ethics_modules_enabled ON ethics_modules(enabled);

            -- ==================== ETHICS RULES ====================
            CREATE TABLE IF NOT EXISTS ethics_rules (
                id TEXT PRIMARY KEY,
                module_id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                condition TEXT NOT NULL DEFAULT 'true',
                action TEXT NOT NULL DEFAULT 'allow',
                priority INTEGER NOT NULL DEFAULT 100,
                enabled INTEGER NOT NULL DEFAULT 1,
                message TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (module_id) REFERENCES ethics_modules(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_ethics_rules_module ON ethics_rules(module_id);
            CREATE INDEX IF NOT EXISTS idx_ethics_rules_priority ON ethics_rules(priority);

            -- ==================== ETHICS AUDIT ====================
            CREATE TABLE IF NOT EXISTS ethics_audit (
                id TEXT PRIMARY KEY,
                module_id TEXT NOT NULL,
                rule_id TEXT,
                action_description TEXT NOT NULL,
                decision TEXT NOT NULL DEFAULT 'allowed',
                requestor TEXT NOT NULL,
                context_snapshot TEXT NOT NULL DEFAULT '{}',
                override_by TEXT,
                override_reason TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_ethics_audit_module ON ethics_audit(module_id);
            CREATE INDEX IF NOT EXISTS idx_ethics_audit_decision ON ethics_audit(decision);
            CREATE INDEX IF NOT EXISTS idx_ethics_audit_created ON ethics_audit(created_at);

            -- ==================== ACTION LOG (Transparency) ====================
            CREATE TABLE IF NOT EXISTS action_log (
                id TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                category TEXT NOT NULL,
                action TEXT NOT NULL,
                detail TEXT NOT NULL DEFAULT '',
                severity TEXT NOT NULL DEFAULT 'info',
                entity_type TEXT,
                entity_id TEXT,
                device_id TEXT,
                correlation_id TEXT,
                synced INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_action_log_source ON action_log(source);
            CREATE INDEX IF NOT EXISTS idx_action_log_category ON action_log(category);
            CREATE INDEX IF NOT EXISTS idx_action_log_severity ON action_log(severity);
            CREATE INDEX IF NOT EXISTS idx_action_log_created ON action_log(created_at);
            CREATE INDEX IF NOT EXISTS idx_action_log_entity ON action_log(entity_type, entity_id);
            CREATE INDEX IF NOT EXISTS idx_action_log_correlation ON action_log(correlation_id);

            -- ==================== CODE DIFFS ====================
            CREATE TABLE IF NOT EXISTS code_diffs (
                id TEXT PRIMARY KEY,
                request_id TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                before_code TEXT NOT NULL DEFAULT '',
                after_code TEXT NOT NULL DEFAULT '',
                unified_diff TEXT NOT NULL DEFAULT '',
                lines_added INTEGER NOT NULL DEFAULT 0,
                lines_removed INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'pending',
                reviewed_by TEXT,
                review_comment TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_code_diffs_status ON code_diffs(status);
            CREATE INDEX IF NOT EXISTS idx_code_diffs_request ON code_diffs(request_id);

            -- ==================== LOGIC BLOCKS ====================
            CREATE TABLE IF NOT EXISTS logic_blocks (
                id TEXT PRIMARY KEY,
                page_id TEXT,
                component_id TEXT,
                plan_id TEXT NOT NULL,
                type TEXT NOT NULL DEFAULT 'if',
                label TEXT NOT NULL DEFAULT '',
                condition TEXT NOT NULL DEFAULT '',
                body TEXT NOT NULL DEFAULT '',
                parent_block_id TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                generated_code TEXT NOT NULL DEFAULT '',
                x REAL NOT NULL DEFAULT 0,
                y REAL NOT NULL DEFAULT 0,
                width REAL NOT NULL DEFAULT 280,
                height REAL NOT NULL DEFAULT 120,
                collapsed INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (page_id) REFERENCES design_pages(id),
                FOREIGN KEY (component_id) REFERENCES design_components(id),
                FOREIGN KEY (plan_id) REFERENCES plans(id),
                FOREIGN KEY (parent_block_id) REFERENCES logic_blocks(id)
            );
            CREATE INDEX IF NOT EXISTS idx_logic_blocks_plan ON logic_blocks(plan_id);
            CREATE INDEX IF NOT EXISTS idx_logic_blocks_page ON logic_blocks(page_id);
            CREATE INDEX IF NOT EXISTS idx_logic_blocks_parent ON logic_blocks(parent_block_id);

            -- ==================== DEVICES ====================
            CREATE TABLE IF NOT EXISTS devices (
                id TEXT PRIMARY KEY,
                device_id TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL DEFAULT 'Unknown Device',
                os TEXT NOT NULL DEFAULT '',
                last_address TEXT NOT NULL DEFAULT '',
                last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
                is_current INTEGER NOT NULL DEFAULT 0,
                sync_enabled INTEGER NOT NULL DEFAULT 1,
                clock_value INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_device_id ON devices(device_id);

            -- ==================== COMPONENT SCHEMAS ====================
            CREATE TABLE IF NOT EXISTS component_schemas (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'display',
                description TEXT NOT NULL DEFAULT '',
                properties TEXT NOT NULL DEFAULT '[]',
                events TEXT NOT NULL DEFAULT '[]',
                default_styles TEXT NOT NULL DEFAULT '{}',
                default_size TEXT NOT NULL DEFAULT '{"width":200,"height":100}',
                code_templates TEXT NOT NULL DEFAULT '{}',
                icon TEXT NOT NULL DEFAULT 'symbol-misc',
                is_container INTEGER NOT NULL DEFAULT 0,
                allowed_children TEXT,
                instance_limits TEXT NOT NULL DEFAULT '{"min":0,"max":null}',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_component_schemas_type ON component_schemas(type);
            CREATE INDEX IF NOT EXISTS idx_component_schemas_category ON component_schemas(category);
        `);

        // ===== v3.0 Tables: Element Issues, AI Suggestions, AI Questions, Plan Versions, Data Models =====
        this.db.exec(`
            -- ==================== ELEMENT ISSUES ====================
            CREATE TABLE IF NOT EXISTS element_issues (
                id TEXT PRIMARY KEY,
                element_id TEXT NOT NULL,
                element_type TEXT NOT NULL DEFAULT 'component',
                plan_id TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'open',
                severity TEXT NOT NULL DEFAULT 'bug',
                mode TEXT NOT NULL DEFAULT 'fullstack',
                reported_by TEXT NOT NULL DEFAULT 'user',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                resolved_at TEXT,
                FOREIGN KEY (plan_id) REFERENCES plans(id)
            );
            CREATE INDEX IF NOT EXISTS idx_element_issues_plan ON element_issues(plan_id);
            CREATE INDEX IF NOT EXISTS idx_element_issues_element ON element_issues(element_id, element_type);
            CREATE INDEX IF NOT EXISTS idx_element_issues_status ON element_issues(status);

            -- ==================== AI SUGGESTIONS ====================
            CREATE TABLE IF NOT EXISTS ai_suggestions (
                id TEXT PRIMARY KEY,
                plan_id TEXT NOT NULL,
                component_id TEXT,
                page_id TEXT,
                type TEXT NOT NULL DEFAULT 'general',
                title TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                reasoning TEXT NOT NULL DEFAULT '',
                action_type TEXT,
                action_payload TEXT NOT NULL DEFAULT '{}',
                priority TEXT NOT NULL DEFAULT 'P2',
                status TEXT NOT NULL DEFAULT 'pending',
                ticket_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (plan_id) REFERENCES plans(id)
            );
            CREATE INDEX IF NOT EXISTS idx_ai_suggestions_plan ON ai_suggestions(plan_id);
            CREATE INDEX IF NOT EXISTS idx_ai_suggestions_status ON ai_suggestions(status);

            -- ==================== AI QUESTIONS ====================
            CREATE TABLE IF NOT EXISTS ai_questions (
                id TEXT PRIMARY KEY,
                plan_id TEXT NOT NULL,
                component_id TEXT,
                page_id TEXT,
                category TEXT NOT NULL DEFAULT 'general',
                question TEXT NOT NULL DEFAULT '',
                question_type TEXT NOT NULL DEFAULT 'text',
                options TEXT NOT NULL DEFAULT '[]',
                ai_reasoning TEXT NOT NULL DEFAULT '',
                ai_suggested_answer TEXT,
                user_answer TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                ticket_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (plan_id) REFERENCES plans(id)
            );
            CREATE INDEX IF NOT EXISTS idx_ai_questions_plan ON ai_questions(plan_id);
            CREATE INDEX IF NOT EXISTS idx_ai_questions_status ON ai_questions(status);

            -- ==================== PLAN VERSIONS ====================
            CREATE TABLE IF NOT EXISTS plan_versions (
                id TEXT PRIMARY KEY,
                plan_id TEXT NOT NULL,
                version_number INTEGER NOT NULL,
                label TEXT NOT NULL DEFAULT '',
                snapshot TEXT NOT NULL DEFAULT '{}',
                change_summary TEXT NOT NULL DEFAULT '',
                created_by TEXT NOT NULL DEFAULT 'user',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (plan_id) REFERENCES plans(id)
            );
            CREATE INDEX IF NOT EXISTS idx_plan_versions_plan ON plan_versions(plan_id);

            -- ==================== DESIGN CHANGE LOG ====================
            CREATE TABLE IF NOT EXISTS design_change_log (
                id TEXT PRIMARY KEY,
                plan_id TEXT NOT NULL,
                branch_type TEXT NOT NULL DEFAULT 'live',
                change_type TEXT NOT NULL DEFAULT 'update',
                entity_type TEXT NOT NULL DEFAULT 'component',
                entity_id TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                session_change_number INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (plan_id) REFERENCES plans(id)
            );
            CREATE INDEX IF NOT EXISTS idx_design_change_log_plan ON design_change_log(plan_id);

            -- ==================== DATA MODELS ====================
            CREATE TABLE IF NOT EXISTS data_models (
                id TEXT PRIMARY KEY,
                plan_id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                fields TEXT NOT NULL DEFAULT '[]',
                relationships TEXT NOT NULL DEFAULT '[]',
                bound_components TEXT NOT NULL DEFAULT '[]',
                ai_backend_suggestion TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (plan_id) REFERENCES plans(id)
            );
            CREATE INDEX IF NOT EXISTS idx_data_models_plan ON data_models(plan_id);

            -- ==================== AI CHAT SESSIONS ====================
            CREATE TABLE IF NOT EXISTS ai_chat_sessions (
                id TEXT PRIMARY KEY,
                plan_id TEXT,
                ticket_id TEXT,
                session_name TEXT NOT NULL DEFAULT 'Chat Session',
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (plan_id) REFERENCES plans(id)
            );
            CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_plan ON ai_chat_sessions(plan_id);
            CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_status ON ai_chat_sessions(status);

            -- ==================== AI CHAT MESSAGES ====================
            CREATE TABLE IF NOT EXISTS ai_chat_messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                ticket_reply_id TEXT,
                role TEXT NOT NULL DEFAULT 'user',
                content TEXT NOT NULL,
                context_page TEXT NOT NULL DEFAULT '',
                context_element_id TEXT,
                context_element_type TEXT,
                ai_level TEXT NOT NULL DEFAULT 'suggestions',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (session_id) REFERENCES ai_chat_sessions(id)
            );
            CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_session ON ai_chat_messages(session_id);
        `);

        // Migration: add meta column to design_pages
        try {
            this.db.exec("ALTER TABLE design_pages ADD COLUMN meta TEXT NOT NULL DEFAULT '{}'");
        } catch { /* already exists */ }

        // Migration: add parent_ticket_id to tickets for hierarchical tickets
        try {
            this.db.exec('ALTER TABLE tickets ADD COLUMN parent_ticket_id TEXT DEFAULT NULL');
        } catch { /* already exists */ }

        // Migration: add auto_created and operation_type to tickets for auto-ticket system
        try {
            this.db.exec('ALTER TABLE tickets ADD COLUMN auto_created INTEGER NOT NULL DEFAULT 0');
        } catch { /* already exists */ }
        try {
            this.db.exec("ALTER TABLE tickets ADD COLUMN operation_type TEXT NOT NULL DEFAULT 'user_created'");
        } catch { /* already exists */ }

        // Migration: add version_snapshot_id and branch_type to coding_sessions
        try {
            this.db.exec('ALTER TABLE coding_sessions ADD COLUMN version_snapshot_id TEXT');
        } catch { /* already exists */ }
        try {
            this.db.exec('ALTER TABLE coding_sessions ADD COLUMN branch_type TEXT');
        } catch { /* already exists */ }

        // Migration: add branch_type, is_active, change_count, merge_diff to plan_versions
        try {
            this.db.exec("ALTER TABLE plan_versions ADD COLUMN branch_type TEXT NOT NULL DEFAULT 'live'");
        } catch { /* already exists */ }
        try {
            this.db.exec('ALTER TABLE plan_versions ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0');
        } catch { /* already exists */ }
        try {
            this.db.exec('ALTER TABLE plan_versions ADD COLUMN change_count INTEGER NOT NULL DEFAULT 0');
        } catch { /* already exists */ }
        try {
            this.db.exec('ALTER TABLE plan_versions ADD COLUMN merge_diff TEXT');
        } catch { /* already exists */ }

        // Migration: add task_requirements column to tasks
        try {
            this.db.exec('ALTER TABLE tasks ADD COLUMN task_requirements TEXT');
        } catch { /* already exists */ }
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
            INSERT INTO tasks (id, title, description, status, priority, dependencies, acceptance_criteria, plan_id, parent_task_id, estimated_minutes, files_modified, context_bundle, task_requirements, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            data.task_requirements || null,
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
        if (updates.task_requirements !== undefined) { fields.push('task_requirements = ?'); values.push(updates.task_requirements); }
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
            task_requirements: row.task_requirements as string | null,
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
            INSERT INTO tickets (id, ticket_number, title, body, status, priority, creator, assignee, task_id, parent_ticket_id, auto_created, operation_type, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            data.parent_ticket_id || null,
            data.auto_created ? 1 : 0,
            data.operation_type || 'user_created',
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
        if (updates.parent_ticket_id !== undefined) { fields.push('parent_ticket_id = ?'); values.push(updates.parent_ticket_id); }

        if (fields.length === 0) return existing;

        fields.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(id);

        this.db.prepare(`UPDATE tickets SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return this.getTicket(id);
    }

    deleteTicket(id: string): boolean {
        const existing = this.getTicket(id);
        if (!existing) return false;
        // Promote child tickets to root level (set parent_ticket_id to NULL)
        this.db.prepare('UPDATE tickets SET parent_ticket_id = NULL WHERE parent_ticket_id = ?').run(id);
        this.db.prepare('DELETE FROM ticket_replies WHERE ticket_id = ?').run(id);
        this.db.prepare('DELETE FROM tickets WHERE id = ?').run(id);
        return true;
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
            parent_ticket_id: (row.parent_ticket_id as string | null) ?? null,
            auto_created: !!(row.auto_created as number),
            operation_type: (row.operation_type as string) || 'user_created',
            created_at: row.created_at as string,
            updated_at: row.updated_at as string,
        };
    }

    // ==================== HIERARCHICAL TICKETS ====================

    getChildTickets(parentTicketId: string): Ticket[] {
        const rows = this.db.prepare(
            'SELECT * FROM tickets WHERE parent_ticket_id = ? ORDER BY created_at ASC'
        ).all(parentTicketId) as Record<string, unknown>[];
        return rows.map(r => this.rowToTicket(r));
    }

    getChildTicketCount(parentTicketId: string): number {
        const row = this.db.prepare(
            'SELECT COUNT(*) as cnt FROM tickets WHERE parent_ticket_id = ?'
        ).get(parentTicketId) as { cnt: number };
        return row.cnt;
    }

    getRootTickets(): Ticket[] {
        const rows = this.db.prepare(
            'SELECT * FROM tickets WHERE parent_ticket_id IS NULL ORDER BY created_at DESC'
        ).all() as Record<string, unknown>[];
        return rows.map(r => this.rowToTicket(r));
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
        if (updates.status !== undefined) {
            fields.push('status = ?'); values.push(updates.status);
            // Single-plan architecture: deactivate all other plans when activating one
            if (updates.status === 'active') {
                this.db.prepare("UPDATE plans SET status = 'completed', updated_at = ? WHERE status = 'active' AND id != ?")
                    .run(new Date().toISOString(), id);
            }
        }
        if (updates.config_json !== undefined) { fields.push('config_json = ?'); values.push(updates.config_json); }
        if (fields.length === 0) return this.getPlan(id);
        fields.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(id);
        this.db.prepare(`UPDATE plans SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return this.getPlan(id);
    }

    deletePlan(id: string): boolean {
        const existing = this.getPlan(id);
        if (!existing) return false;
        // Remove tasks associated with this plan
        this.db.prepare('DELETE FROM tasks WHERE plan_id = ?').run(id);
        this.db.prepare('DELETE FROM plans WHERE id = ?').run(id);
        return true;
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
        const result = this.db.prepare('SELECT * FROM agents ORDER BY type ASC, name ASC').all();
        /* istanbul ignore next -- SQLite .all() always returns an array */
        return Array.isArray(result) ? result as Agent[] : [];
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
        const depth = data.depth ?? 0;
        if (depth > 10) throw new Error('Maximum sub-page depth of 10 exceeded');
        this.db.prepare(`
            INSERT INTO design_pages (id, plan_id, parent_page_id, depth, name, route, sort_order, width, height, background, requirements, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, data.plan_id, data.parent_page_id || null, depth, data.name || 'Untitled Page', data.route || '/', data.sort_order ?? 0, data.width ?? 1440, data.height ?? 900, data.background || '#1e1e2e', JSON.stringify(data.requirements || []), now, now);
        return this.parsePageRow(this.db.prepare('SELECT * FROM design_pages WHERE id = ?').get(id) as Record<string, unknown>);
    }

    getDesignPage(id: string): DesignPage | null {
        const row = this.db.prepare('SELECT * FROM design_pages WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        return row ? this.parsePageRow(row) : null;
    }

    getDesignPagesByPlan(planId: string): DesignPage[] {
        const rows = this.db.prepare('SELECT * FROM design_pages WHERE plan_id = ? ORDER BY depth ASC, sort_order ASC').all(planId) as Record<string, unknown>[];
        return rows.map(r => this.parsePageRow(r));
    }

    getChildPages(parentPageId: string): DesignPage[] {
        const rows = this.db.prepare('SELECT * FROM design_pages WHERE parent_page_id = ? ORDER BY sort_order ASC').all(parentPageId) as Record<string, unknown>[];
        return rows.map(r => this.parsePageRow(r));
    }

    private parsePageRow(row: Record<string, unknown>): DesignPage {
        return {
            id: row.id as string,
            plan_id: row.plan_id as string,
            parent_page_id: (row.parent_page_id as string) || null,
            depth: (row.depth as number) ?? 0,
            name: row.name as string,
            route: (row.route as string) || '/',
            sort_order: (row.sort_order as number) ?? 0,
            width: (row.width as number) ?? 1440,
            height: (row.height as number) ?? 900,
            background: (row.background as string) || '#1e1e2e',
            requirements: JSON.parse((row.requirements as string) || '[]'),
            created_at: row.created_at as string,
            updated_at: row.updated_at as string,
        };
    }

    updateDesignPage(id: string, updates: Partial<DesignPage>): DesignPage | null {
        const fields: string[] = [];
        const values: unknown[] = [];
        for (const [key, val] of Object.entries(updates)) {
            if (key === 'id' || key === 'created_at') continue;
            if (key === 'requirements') {
                fields.push(`${key} = ?`);
                values.push(JSON.stringify(val));
            } else {
                fields.push(`${key} = ?`);
                values.push(val);
            }
        }
        if (fields.length === 0) return this.getDesignPage(id);
        fields.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(id);
        this.db.prepare(`UPDATE design_pages SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return this.getDesignPage(id);
    }

    deleteDesignPage(id: string): void {
        const page = this.getDesignPage(id);
        // Re-parent child pages to the deleted page's parent
        if (page) {
            const newDepth = page.depth > 0 ? page.depth - 1 : 0;
            this.db.prepare('UPDATE design_pages SET parent_page_id = ?, depth = ? WHERE parent_page_id = ?').run(page.parent_page_id, newDepth, id);
        }
        this.db.prepare('DELETE FROM design_components WHERE page_id = ?').run(id);
        this.db.prepare('DELETE FROM page_flows WHERE from_page_id = ? OR to_page_id = ?').run(id, id);
        this.db.prepare('DELETE FROM design_pages WHERE id = ?').run(id);
    }

    // ==================== DESIGN COMPONENTS ====================

    createDesignComponent(data: Partial<DesignComponent> & { plan_id: string; type: string }): DesignComponent {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO design_components (id, plan_id, page_id, type, name, parent_id, sort_order, x, y, width, height, styles, content, props, requirements, responsive, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, data.plan_id, data.page_id || null, data.type, data.name || 'Component',
            data.parent_id || null, data.sort_order ?? 0,
            data.x ?? 0, data.y ?? 0, data.width ?? 200, data.height ?? 100,
            JSON.stringify(data.styles || {}), data.content || '',
            JSON.stringify(data.props || {}), JSON.stringify(data.requirements || []),
            JSON.stringify(data.responsive || {}),
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
            if (key === 'styles' || key === 'props' || key === 'responsive' || key === 'requirements') {
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
            requirements: JSON.parse((row.requirements as string) || '[]'),
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

    // ==================== SYNC CONFIG ====================

    getSyncConfig(): SyncConfig | null {
        const row = this.db.prepare('SELECT * FROM sync_config LIMIT 1').get() as Record<string, unknown> | undefined;
        return row ? this.rowToSyncConfig(row) : null;
    }

    createSyncConfig(data: Partial<SyncConfig> & { device_id: string }): SyncConfig {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO sync_config (id, backend, endpoint, credentials_ref, enabled, auto_sync_interval_seconds, default_conflict_strategy, max_file_size_bytes, exclude_patterns, device_id, device_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, data.backend || 'cloud', data.endpoint || '', data.credentials_ref || '',
            data.enabled ? 1 : 0, data.auto_sync_interval_seconds ?? 0,
            data.default_conflict_strategy || 'last_write_wins',
            data.max_file_size_bytes ?? 52428800,
            JSON.stringify(data.exclude_patterns || []),
            data.device_id, data.device_name || 'Unknown Device', now, now
        );
        return this.getSyncConfig()!;
    }

    updateSyncConfig(id: string, updates: Partial<SyncConfig>): SyncConfig | null {
        const fields: string[] = [];
        const values: unknown[] = [];
        if (updates.backend !== undefined) { fields.push('backend = ?'); values.push(updates.backend); }
        if (updates.endpoint !== undefined) { fields.push('endpoint = ?'); values.push(updates.endpoint); }
        if (updates.credentials_ref !== undefined) { fields.push('credentials_ref = ?'); values.push(updates.credentials_ref); }
        if (updates.enabled !== undefined) { fields.push('enabled = ?'); values.push(updates.enabled ? 1 : 0); }
        if (updates.auto_sync_interval_seconds !== undefined) { fields.push('auto_sync_interval_seconds = ?'); values.push(updates.auto_sync_interval_seconds); }
        if (updates.default_conflict_strategy !== undefined) { fields.push('default_conflict_strategy = ?'); values.push(updates.default_conflict_strategy); }
        if (updates.max_file_size_bytes !== undefined) { fields.push('max_file_size_bytes = ?'); values.push(updates.max_file_size_bytes); }
        if (updates.exclude_patterns !== undefined) { fields.push('exclude_patterns = ?'); values.push(JSON.stringify(updates.exclude_patterns)); }
        if (updates.device_name !== undefined) { fields.push('device_name = ?'); values.push(updates.device_name); }
        if (fields.length === 0) return this.getSyncConfig();
        fields.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(id);
        this.db.prepare(`UPDATE sync_config SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return this.getSyncConfig();
    }

    private rowToSyncConfig(row: Record<string, unknown>): SyncConfig {
        return {
            id: row.id as string,
            backend: row.backend as SyncConfig['backend'],
            endpoint: row.endpoint as string,
            credentials_ref: row.credentials_ref as string,
            enabled: !!(row.enabled as number),
            auto_sync_interval_seconds: row.auto_sync_interval_seconds as number,
            default_conflict_strategy: row.default_conflict_strategy as ConflictResolutionStrategy,
            max_file_size_bytes: row.max_file_size_bytes as number,
            exclude_patterns: JSON.parse((row.exclude_patterns as string) || '[]'),
            device_id: row.device_id as string,
            device_name: row.device_name as string,
            created_at: row.created_at as string,
            updated_at: row.updated_at as string,
        };
    }

    // ==================== SYNC CHANGES ====================

    createSyncChange(data: Omit<SyncChange, 'id' | 'created_at'>): SyncChange {
        const id = this.genId();
        this.db.prepare(`
            INSERT INTO sync_changes (id, entity_type, entity_id, change_type, device_id, before_hash, after_hash, patch, sequence_number, synced, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(id, data.entity_type, data.entity_id, data.change_type, data.device_id,
            data.before_hash, data.after_hash, data.patch, data.sequence_number, data.synced ? 1 : 0);
        return this.db.prepare('SELECT * FROM sync_changes WHERE id = ?').get(id) as SyncChange;
    }

    getSyncChangesByEntity(entityType: string, entityId: string): SyncChange[] {
        return this.db.prepare(
            'SELECT * FROM sync_changes WHERE entity_type = ? AND entity_id = ? ORDER BY sequence_number ASC'
        ).all(entityType, entityId) as SyncChange[];
    }

    getUnsyncedChanges(deviceId: string): SyncChange[] {
        return this.db.prepare(
            'SELECT * FROM sync_changes WHERE device_id = ? AND synced = 0 ORDER BY sequence_number ASC'
        ).all(deviceId) as SyncChange[];
    }

    markChangesSynced(ids: string[]): void {
        if (ids.length === 0) return;
        const placeholders = ids.map(() => '?').join(',');
        this.db.prepare(`UPDATE sync_changes SET synced = 1 WHERE id IN (${placeholders})`).run(...ids);
    }

    getLatestSequenceNumber(deviceId: string): number {
        const row = this.db.prepare(
            'SELECT MAX(sequence_number) as max_seq FROM sync_changes WHERE device_id = ?'
        ).get(deviceId) as { max_seq: number | null };
        return row.max_seq ?? 0;
    }

    getSyncChangesSince(deviceId: string, sequenceNumber: number): SyncChange[] {
        return this.db.prepare(
            'SELECT * FROM sync_changes WHERE device_id = ? AND sequence_number > ? ORDER BY sequence_number ASC'
        ).all(deviceId, sequenceNumber) as SyncChange[];
    }

    // ==================== SYNC CONFLICTS ====================

    createSyncConflict(data: Omit<SyncConflict, 'id' | 'created_at'>): SyncConflict {
        const id = this.genId();
        this.db.prepare(`
            INSERT INTO sync_conflicts (id, entity_type, entity_id, local_version, remote_version, remote_device_id, local_changed_at, remote_changed_at, conflicting_fields, resolution, resolved_by, resolved_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(id, data.entity_type, data.entity_id, data.local_version, data.remote_version,
            data.remote_device_id, data.local_changed_at, data.remote_changed_at,
            JSON.stringify(data.conflicting_fields), data.resolution ?? null,
            data.resolved_by ?? null, data.resolved_at ?? null);
        return this.getSyncConflict(id)!;
    }

    getSyncConflict(id: string): SyncConflict | null {
        const row = this.db.prepare('SELECT * FROM sync_conflicts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        return row ? this.rowToSyncConflict(row) : null;
    }

    getUnresolvedConflicts(): SyncConflict[] {
        const rows = this.db.prepare(
            'SELECT * FROM sync_conflicts WHERE resolution IS NULL ORDER BY created_at DESC'
        ).all() as Record<string, unknown>[];
        return rows.map(r => this.rowToSyncConflict(r));
    }

    getConflictsByEntity(entityType: string, entityId: string): SyncConflict[] {
        const rows = this.db.prepare(
            'SELECT * FROM sync_conflicts WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC'
        ).all(entityType, entityId) as Record<string, unknown>[];
        return rows.map(r => this.rowToSyncConflict(r));
    }

    resolveSyncConflict(id: string, resolution: ConflictResolutionStrategy, resolvedBy: string): void {
        this.db.prepare(
            'UPDATE sync_conflicts SET resolution = ?, resolved_by = ?, resolved_at = datetime(\'now\') WHERE id = ?'
        ).run(resolution, resolvedBy, id);
    }

    private rowToSyncConflict(row: Record<string, unknown>): SyncConflict {
        return {
            id: row.id as string,
            entity_type: row.entity_type as SyncConflict['entity_type'],
            entity_id: row.entity_id as string,
            local_version: row.local_version as string,
            remote_version: row.remote_version as string,
            remote_device_id: row.remote_device_id as string,
            local_changed_at: row.local_changed_at as string,
            remote_changed_at: row.remote_changed_at as string,
            conflicting_fields: JSON.parse((row.conflicting_fields as string) || '[]'),
            resolution: (row.resolution as ConflictResolutionStrategy) ?? null,
            resolved_by: (row.resolved_by as string) ?? null,
            resolved_at: (row.resolved_at as string) ?? null,
            created_at: row.created_at as string,
        };
    }

    // ==================== ETHICS MODULES ====================

    createEthicsModule(data: Partial<EthicsModule> & { name: string }): EthicsModule {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO ethics_modules (id, name, description, enabled, sensitivity, scope, allowed_actions, blocked_actions, version, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, data.name, data.description || '', data.enabled !== false ? 1 : 0,
            data.sensitivity || 'medium', JSON.stringify(data.scope || []),
            JSON.stringify(data.allowed_actions || []), JSON.stringify(data.blocked_actions || []),
            data.version ?? 1, now, now);
        return this.getEthicsModule(id)!;
    }

    getEthicsModule(id: string): EthicsModule | null {
        const row = this.db.prepare('SELECT * FROM ethics_modules WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (!row) return null;
        const module = this.rowToEthicsModule(row);
        module.rules = this.getEthicsRulesByModule(id);
        return module;
    }

    getAllEthicsModules(): EthicsModule[] {
        const rows = this.db.prepare('SELECT * FROM ethics_modules ORDER BY name ASC').all() as Record<string, unknown>[];
        return rows.map(r => {
            const m = this.rowToEthicsModule(r);
            m.rules = this.getEthicsRulesByModule(m.id);
            return m;
        });
    }

    getEnabledEthicsModules(): EthicsModule[] {
        const rows = this.db.prepare('SELECT * FROM ethics_modules WHERE enabled = 1 ORDER BY name ASC').all() as Record<string, unknown>[];
        return rows.map(r => {
            const m = this.rowToEthicsModule(r);
            m.rules = this.getEthicsRulesByModule(m.id);
            return m;
        });
    }

    updateEthicsModule(id: string, updates: Partial<EthicsModule>): EthicsModule | null {
        const fields: string[] = [];
        const values: unknown[] = [];
        if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
        if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
        if (updates.enabled !== undefined) { fields.push('enabled = ?'); values.push(updates.enabled ? 1 : 0); }
        if (updates.sensitivity !== undefined) { fields.push('sensitivity = ?'); values.push(updates.sensitivity); }
        if (updates.scope !== undefined) { fields.push('scope = ?'); values.push(JSON.stringify(updates.scope)); }
        if (updates.allowed_actions !== undefined) { fields.push('allowed_actions = ?'); values.push(JSON.stringify(updates.allowed_actions)); }
        if (updates.blocked_actions !== undefined) { fields.push('blocked_actions = ?'); values.push(JSON.stringify(updates.blocked_actions)); }
        if (updates.version !== undefined) { fields.push('version = ?'); values.push(updates.version); }
        if (fields.length === 0) return this.getEthicsModule(id);
        fields.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(id);
        this.db.prepare(`UPDATE ethics_modules SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return this.getEthicsModule(id);
    }

    deleteEthicsModule(id: string): void {
        this.db.prepare('DELETE FROM ethics_rules WHERE module_id = ?').run(id);
        this.db.prepare('DELETE FROM ethics_modules WHERE id = ?').run(id);
    }

    private rowToEthicsModule(row: Record<string, unknown>): EthicsModule {
        return {
            id: row.id as string,
            name: row.name as string,
            description: row.description as string,
            enabled: !!(row.enabled as number),
            sensitivity: row.sensitivity as EthicsSensitivity,
            scope: JSON.parse((row.scope as string) || '[]'),
            allowed_actions: JSON.parse((row.allowed_actions as string) || '[]'),
            blocked_actions: JSON.parse((row.blocked_actions as string) || '[]'),
            rules: [],
            version: row.version as number,
            created_at: row.created_at as string,
            updated_at: row.updated_at as string,
        };
    }

    // ==================== ETHICS RULES ====================

    createEthicsRule(data: Omit<EthicsRule, 'id' | 'created_at'>): EthicsRule {
        const id = this.genId();
        this.db.prepare(`
            INSERT INTO ethics_rules (id, module_id, name, description, condition, action, priority, enabled, message, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(id, data.module_id, data.name, data.description || '', data.condition,
            data.action, data.priority, data.enabled ? 1 : 0, data.message || '');
        return this.db.prepare('SELECT * FROM ethics_rules WHERE id = ?').get(id) as EthicsRule;
    }

    getEthicsRulesByModule(moduleId: string): EthicsRule[] {
        const rows = this.db.prepare(
            'SELECT * FROM ethics_rules WHERE module_id = ? ORDER BY priority ASC'
        ).all(moduleId) as Record<string, unknown>[];
        return rows.map(r => this.rowToEthicsRule(r));
    }

    updateEthicsRule(id: string, updates: Partial<EthicsRule>): void {
        const fields: string[] = [];
        const values: unknown[] = [];
        if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
        if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
        if (updates.condition !== undefined) { fields.push('condition = ?'); values.push(updates.condition); }
        if (updates.action !== undefined) { fields.push('action = ?'); values.push(updates.action); }
        if (updates.priority !== undefined) { fields.push('priority = ?'); values.push(updates.priority); }
        if (updates.enabled !== undefined) { fields.push('enabled = ?'); values.push(updates.enabled ? 1 : 0); }
        if (updates.message !== undefined) { fields.push('message = ?'); values.push(updates.message); }
        if (fields.length === 0) return;
        values.push(id);
        this.db.prepare(`UPDATE ethics_rules SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    deleteEthicsRule(id: string): void {
        this.db.prepare('DELETE FROM ethics_rules WHERE id = ?').run(id);
    }

    private rowToEthicsRule(row: Record<string, unknown>): EthicsRule {
        return {
            id: row.id as string,
            module_id: row.module_id as string,
            name: row.name as string,
            description: row.description as string,
            condition: row.condition as string,
            action: row.action as EthicsRule['action'],
            priority: row.priority as number,
            enabled: !!(row.enabled as number),
            message: row.message as string,
            created_at: row.created_at as string,
        };
    }

    // ==================== ETHICS AUDIT ====================

    createEthicsAuditEntry(data: Omit<EthicsAuditEntry, 'id' | 'created_at'>): EthicsAuditEntry {
        const id = this.genId();
        this.db.prepare(`
            INSERT INTO ethics_audit (id, module_id, rule_id, action_description, decision, requestor, context_snapshot, override_by, override_reason, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(id, data.module_id, data.rule_id ?? null, data.action_description,
            data.decision, data.requestor, data.context_snapshot || '{}',
            data.override_by ?? null, data.override_reason ?? null);
        return this.db.prepare('SELECT * FROM ethics_audit WHERE id = ?').get(id) as EthicsAuditEntry;
    }

    getEthicsAuditLog(limit: number = 100, moduleId?: string): EthicsAuditEntry[] {
        if (moduleId) {
            return this.db.prepare(
                'SELECT * FROM ethics_audit WHERE module_id = ? ORDER BY created_at DESC LIMIT ?'
            ).all(moduleId, limit) as EthicsAuditEntry[];
        }
        return this.db.prepare(
            'SELECT * FROM ethics_audit ORDER BY created_at DESC LIMIT ?'
        ).all(limit) as EthicsAuditEntry[];
    }

    getEthicsAuditByDecision(decision: string, limit: number = 100): EthicsAuditEntry[] {
        return this.db.prepare(
            'SELECT * FROM ethics_audit WHERE decision = ? ORDER BY created_at DESC LIMIT ?'
        ).all(decision, limit) as EthicsAuditEntry[];
    }

    updateEthicsAuditEntry(id: string, overrideBy: string, overrideReason: string): void {
        this.db.prepare(
            'UPDATE ethics_audit SET decision = ?, override_by = ?, override_reason = ? WHERE id = ?'
        ).run('overridden', overrideBy, overrideReason, id);
    }

    // ==================== ACTION LOG (Transparency) ====================

    createActionLog(data: Omit<ActionLog, 'id' | 'created_at'>): ActionLog {
        const id = this.genId();
        this.db.prepare(`
            INSERT INTO action_log (id, source, category, action, detail, severity, entity_type, entity_id, device_id, correlation_id, synced, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(id, data.source, data.category, data.action, data.detail || '',
            data.severity || 'info', data.entity_type ?? null, data.entity_id ?? null,
            data.device_id ?? null, data.correlation_id ?? null, data.synced ? 1 : 0);
        return this.db.prepare('SELECT * FROM action_log WHERE id = ?').get(id) as ActionLog;
    }

    getActionLog(limit: number = 100, source?: string, category?: string): ActionLog[] {
        let query = 'SELECT * FROM action_log';
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (source) { conditions.push('source = ?'); params.push(source); }
        if (category) { conditions.push('category = ?'); params.push(category); }
        if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);
        return this.db.prepare(query).all(...params) as ActionLog[];
    }

    getActionLogByEntity(entityType: string, entityId: string): ActionLog[] {
        return this.db.prepare(
            'SELECT * FROM action_log WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC'
        ).all(entityType, entityId) as ActionLog[];
    }

    getActionLogByCorrelation(correlationId: string): ActionLog[] {
        return this.db.prepare(
            'SELECT * FROM action_log WHERE correlation_id = ? ORDER BY created_at ASC'
        ).all(correlationId) as ActionLog[];
    }

    getUnsyncedActionLogs(): ActionLog[] {
        return this.db.prepare(
            'SELECT * FROM action_log WHERE synced = 0 ORDER BY created_at ASC'
        ).all() as ActionLog[];
    }

    markActionLogsSynced(ids: string[]): void {
        if (ids.length === 0) return;
        const placeholders = ids.map(() => '?').join(',');
        this.db.prepare(`UPDATE action_log SET synced = 1 WHERE id IN (${placeholders})`).run(...ids);
    }

    // ==================== CODE DIFFS ====================

    createCodeDiff(data: Omit<CodeDiff, 'id' | 'created_at' | 'updated_at'>): CodeDiff {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO code_diffs (id, request_id, entity_type, entity_id, before_code, after_code, unified_diff, lines_added, lines_removed, status, reviewed_by, review_comment, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, data.request_id, data.entity_type, data.entity_id,
            data.before, data.after, data.unified_diff,
            data.lines_added, data.lines_removed, data.status || 'pending',
            data.reviewed_by ?? null, data.review_comment ?? null, now, now);
        return this.getCodeDiff(id)!;
    }

    getCodeDiff(id: string): CodeDiff | null {
        const row = this.db.prepare('SELECT * FROM code_diffs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        return row ? this.rowToCodeDiff(row) : null;
    }

    getCodeDiffsByStatus(status: CodeDiffStatus): CodeDiff[] {
        const rows = this.db.prepare(
            'SELECT * FROM code_diffs WHERE status = ? ORDER BY created_at DESC'
        ).all(status) as Record<string, unknown>[];
        return rows.map(r => this.rowToCodeDiff(r));
    }

    getPendingCodeDiffs(): CodeDiff[] {
        return this.getCodeDiffsByStatus(CodeDiffStatus.Pending);
    }

    updateCodeDiff(id: string, updates: Partial<CodeDiff>): CodeDiff | null {
        const fields: string[] = [];
        const values: unknown[] = [];
        if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
        if (updates.reviewed_by !== undefined) { fields.push('reviewed_by = ?'); values.push(updates.reviewed_by); }
        if (updates.review_comment !== undefined) { fields.push('review_comment = ?'); values.push(updates.review_comment); }
        if (fields.length === 0) return this.getCodeDiff(id);
        fields.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(id);
        this.db.prepare(`UPDATE code_diffs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return this.getCodeDiff(id);
    }

    private rowToCodeDiff(row: Record<string, unknown>): CodeDiff {
        return {
            id: row.id as string,
            request_id: row.request_id as string,
            entity_type: row.entity_type as string,
            entity_id: row.entity_id as string,
            before: row.before_code as string,
            after: row.after_code as string,
            unified_diff: row.unified_diff as string,
            lines_added: row.lines_added as number,
            lines_removed: row.lines_removed as number,
            status: row.status as CodeDiffStatus,
            reviewed_by: (row.reviewed_by as string) ?? null,
            review_comment: (row.review_comment as string) ?? null,
            created_at: row.created_at as string,
            updated_at: row.updated_at as string,
        };
    }

    // ==================== LOGIC BLOCKS ====================

    createLogicBlock(data: Partial<LogicBlock> & { plan_id: string; type: LogicBlockType }): LogicBlock {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO logic_blocks (id, page_id, component_id, plan_id, type, label, condition, body, parent_block_id, sort_order, generated_code, x, y, width, height, collapsed, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, data.page_id ?? null, data.component_id ?? null, data.plan_id,
            data.type, data.label || '', data.condition || '', data.body || '',
            data.parent_block_id ?? null, data.sort_order ?? 0, data.generated_code || '',
            data.x ?? 0, data.y ?? 0, data.width ?? 280, data.height ?? 120,
            data.collapsed ? 1 : 0, now, now);
        return this.getLogicBlock(id)!;
    }

    getLogicBlock(id: string): LogicBlock | null {
        const row = this.db.prepare('SELECT * FROM logic_blocks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        return row ? this.rowToLogicBlock(row) : null;
    }

    getLogicBlocksByPage(pageId: string): LogicBlock[] {
        const rows = this.db.prepare(
            'SELECT * FROM logic_blocks WHERE page_id = ? ORDER BY sort_order ASC'
        ).all(pageId) as Record<string, unknown>[];
        return rows.map(r => this.rowToLogicBlock(r));
    }

    getLogicBlocksByComponent(componentId: string): LogicBlock[] {
        const rows = this.db.prepare(
            'SELECT * FROM logic_blocks WHERE component_id = ? ORDER BY sort_order ASC'
        ).all(componentId) as Record<string, unknown>[];
        return rows.map(r => this.rowToLogicBlock(r));
    }

    getLogicBlocksByPlan(planId: string): LogicBlock[] {
        const rows = this.db.prepare(
            'SELECT * FROM logic_blocks WHERE plan_id = ? ORDER BY sort_order ASC'
        ).all(planId) as Record<string, unknown>[];
        return rows.map(r => this.rowToLogicBlock(r));
    }

    getChildLogicBlocks(parentBlockId: string): LogicBlock[] {
        const rows = this.db.prepare(
            'SELECT * FROM logic_blocks WHERE parent_block_id = ? ORDER BY sort_order ASC'
        ).all(parentBlockId) as Record<string, unknown>[];
        return rows.map(r => this.rowToLogicBlock(r));
    }

    updateLogicBlock(id: string, updates: Partial<LogicBlock>): LogicBlock | null {
        const fields: string[] = [];
        const values: unknown[] = [];
        if (updates.label !== undefined) { fields.push('label = ?'); values.push(updates.label); }
        if (updates.condition !== undefined) { fields.push('condition = ?'); values.push(updates.condition); }
        if (updates.body !== undefined) { fields.push('body = ?'); values.push(updates.body); }
        if (updates.generated_code !== undefined) { fields.push('generated_code = ?'); values.push(updates.generated_code); }
        if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); values.push(updates.sort_order); }
        if (updates.x !== undefined) { fields.push('x = ?'); values.push(updates.x); }
        if (updates.y !== undefined) { fields.push('y = ?'); values.push(updates.y); }
        if (updates.width !== undefined) { fields.push('width = ?'); values.push(updates.width); }
        if (updates.height !== undefined) { fields.push('height = ?'); values.push(updates.height); }
        if (updates.collapsed !== undefined) { fields.push('collapsed = ?'); values.push(updates.collapsed ? 1 : 0); }
        if (updates.parent_block_id !== undefined) { fields.push('parent_block_id = ?'); values.push(updates.parent_block_id); }
        if (fields.length === 0) return this.getLogicBlock(id);
        fields.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(id);
        this.db.prepare(`UPDATE logic_blocks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return this.getLogicBlock(id);
    }

    deleteLogicBlock(id: string): void {
        // Re-parent children to parent of deleted block
        const block = this.getLogicBlock(id);
        if (block) {
            this.db.prepare('UPDATE logic_blocks SET parent_block_id = ? WHERE parent_block_id = ?').run(block.parent_block_id, id);
        }
        this.db.prepare('DELETE FROM logic_blocks WHERE id = ?').run(id);
    }

    private rowToLogicBlock(row: Record<string, unknown>): LogicBlock {
        return {
            id: row.id as string,
            page_id: (row.page_id as string) ?? null,
            component_id: (row.component_id as string) ?? null,
            plan_id: row.plan_id as string,
            type: row.type as LogicBlockType,
            label: row.label as string,
            condition: row.condition as string,
            body: row.body as string,
            parent_block_id: (row.parent_block_id as string) ?? null,
            sort_order: (row.sort_order as number) ?? 0,
            generated_code: row.generated_code as string,
            x: (row.x as number) ?? 0,
            y: (row.y as number) ?? 0,
            width: (row.width as number) ?? 280,
            height: (row.height as number) ?? 120,
            collapsed: !!(row.collapsed as number),
            created_at: row.created_at as string,
            updated_at: row.updated_at as string,
        };
    }

    // ==================== DEVICES ====================

    registerDevice(data: Omit<DeviceInfo, 'id' | 'created_at'>): DeviceInfo {
        const id = this.genId();
        this.db.prepare(`
            INSERT INTO devices (id, device_id, name, os, last_address, last_seen_at, is_current, sync_enabled, clock_value, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(id, data.device_id, data.name, data.os, data.last_address,
            data.last_seen_at || new Date().toISOString(),
            data.is_current ? 1 : 0, data.sync_enabled ? 1 : 0, data.clock_value ?? 0);
        return this.getDevice(data.device_id)!;
    }

    getDevice(deviceId: string): DeviceInfo | null {
        const row = this.db.prepare('SELECT * FROM devices WHERE device_id = ?').get(deviceId) as Record<string, unknown> | undefined;
        return row ? this.rowToDevice(row) : null;
    }

    getAllDevices(): DeviceInfo[] {
        const rows = this.db.prepare('SELECT * FROM devices ORDER BY last_seen_at DESC').all() as Record<string, unknown>[];
        return rows.map(r => this.rowToDevice(r));
    }

    getCurrentDevice(): DeviceInfo | null {
        const row = this.db.prepare('SELECT * FROM devices WHERE is_current = 1 LIMIT 1').get() as Record<string, unknown> | undefined;
        return row ? this.rowToDevice(row) : null;
    }

    updateDevice(deviceId: string, updates: Partial<DeviceInfo>): void {
        const fields: string[] = [];
        const values: unknown[] = [];
        if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
        if (updates.os !== undefined) { fields.push('os = ?'); values.push(updates.os); }
        if (updates.last_address !== undefined) { fields.push('last_address = ?'); values.push(updates.last_address); }
        if (updates.last_seen_at !== undefined) { fields.push('last_seen_at = ?'); values.push(updates.last_seen_at); }
        if (updates.is_current !== undefined) { fields.push('is_current = ?'); values.push(updates.is_current ? 1 : 0); }
        if (updates.sync_enabled !== undefined) { fields.push('sync_enabled = ?'); values.push(updates.sync_enabled ? 1 : 0); }
        if (updates.clock_value !== undefined) { fields.push('clock_value = ?'); values.push(updates.clock_value); }
        if (fields.length === 0) return;
        values.push(deviceId);
        this.db.prepare(`UPDATE devices SET ${fields.join(', ')} WHERE device_id = ?`).run(...values);
    }

    removeDevice(deviceId: string): void {
        this.db.prepare('DELETE FROM devices WHERE device_id = ?').run(deviceId);
    }

    incrementDeviceClock(deviceId: string): number {
        this.db.prepare('UPDATE devices SET clock_value = clock_value + 1, last_seen_at = datetime(\'now\') WHERE device_id = ?').run(deviceId);
        const row = this.db.prepare('SELECT clock_value FROM devices WHERE device_id = ?').get(deviceId) as { clock_value: number } | undefined;
        return row?.clock_value ?? 0;
    }

    private rowToDevice(row: Record<string, unknown>): DeviceInfo {
        return {
            id: row.id as string,
            device_id: row.device_id as string,
            name: row.name as string,
            os: row.os as string,
            last_address: row.last_address as string,
            last_seen_at: row.last_seen_at as string,
            is_current: !!(row.is_current as number),
            sync_enabled: !!(row.sync_enabled as number),
            clock_value: row.clock_value as number,
            created_at: row.created_at as string,
        };
    }

    // ==================== COMPONENT SCHEMAS ====================

    createComponentSchema(data: Partial<ComponentSchema> & { type: string; display_name: string }): ComponentSchema {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO component_schemas (id, type, display_name, category, description, properties, events, default_styles, default_size, code_templates, icon, is_container, allowed_children, instance_limits, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, data.type, data.display_name, data.category || 'display',
            data.description || '', JSON.stringify(data.properties || []),
            JSON.stringify(data.events || []), JSON.stringify(data.default_styles || {}),
            JSON.stringify(data.default_size || { width: 200, height: 100 }),
            JSON.stringify(data.code_templates || {}), data.icon || 'symbol-misc',
            data.is_container ? 1 : 0, data.allowed_children ? JSON.stringify(data.allowed_children) : null,
            JSON.stringify(data.instance_limits || { min: 0, max: null }), now, now);
        return this.getComponentSchemaById(id)!;
    }

    getComponentSchema(type: string): ComponentSchema | null {
        const row = this.db.prepare('SELECT * FROM component_schemas WHERE type = ?').get(type) as Record<string, unknown> | undefined;
        return row ? this.rowToComponentSchema(row) : null;
    }

    getComponentSchemaById(id: string): ComponentSchema | null {
        const row = this.db.prepare('SELECT * FROM component_schemas WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        return row ? this.rowToComponentSchema(row) : null;
    }

    getAllComponentSchemas(): ComponentSchema[] {
        const rows = this.db.prepare('SELECT * FROM component_schemas ORDER BY category, display_name').all() as Record<string, unknown>[];
        return rows.map(r => this.rowToComponentSchema(r));
    }

    getComponentSchemasByCategory(category: string): ComponentSchema[] {
        const rows = this.db.prepare(
            'SELECT * FROM component_schemas WHERE category = ? ORDER BY display_name'
        ).all(category) as Record<string, unknown>[];
        return rows.map(r => this.rowToComponentSchema(r));
    }

    updateComponentSchema(id: string, updates: Partial<ComponentSchema>): ComponentSchema | null {
        const fields: string[] = [];
        const values: unknown[] = [];
        if (updates.display_name !== undefined) { fields.push('display_name = ?'); values.push(updates.display_name); }
        if (updates.category !== undefined) { fields.push('category = ?'); values.push(updates.category); }
        if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
        if (updates.properties !== undefined) { fields.push('properties = ?'); values.push(JSON.stringify(updates.properties)); }
        if (updates.events !== undefined) { fields.push('events = ?'); values.push(JSON.stringify(updates.events)); }
        if (updates.default_styles !== undefined) { fields.push('default_styles = ?'); values.push(JSON.stringify(updates.default_styles)); }
        if (updates.default_size !== undefined) { fields.push('default_size = ?'); values.push(JSON.stringify(updates.default_size)); }
        if (updates.code_templates !== undefined) { fields.push('code_templates = ?'); values.push(JSON.stringify(updates.code_templates)); }
        if (updates.icon !== undefined) { fields.push('icon = ?'); values.push(updates.icon); }
        if (updates.is_container !== undefined) { fields.push('is_container = ?'); values.push(updates.is_container ? 1 : 0); }
        if (updates.allowed_children !== undefined) { fields.push('allowed_children = ?'); values.push(updates.allowed_children ? JSON.stringify(updates.allowed_children) : null); }
        if (updates.instance_limits !== undefined) { fields.push('instance_limits = ?'); values.push(JSON.stringify(updates.instance_limits)); }
        if (fields.length === 0) return this.getComponentSchemaById(id);
        fields.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(id);
        this.db.prepare(`UPDATE component_schemas SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return this.getComponentSchemaById(id);
    }

    deleteComponentSchema(id: string): void {
        this.db.prepare('DELETE FROM component_schemas WHERE id = ?').run(id);
    }

    private rowToComponentSchema(row: Record<string, unknown>): ComponentSchema {
        return {
            id: row.id as string,
            type: row.type as string,
            display_name: row.display_name as string,
            category: row.category as ComponentSchema['category'],
            description: row.description as string,
            properties: JSON.parse((row.properties as string) || '[]'),
            events: JSON.parse((row.events as string) || '[]'),
            default_styles: JSON.parse((row.default_styles as string) || '{}'),
            default_size: JSON.parse((row.default_size as string) || '{"width":200,"height":100}'),
            code_templates: JSON.parse((row.code_templates as string) || '{}'),
            icon: row.icon as string,
            is_container: !!(row.is_container as number),
            allowed_children: row.allowed_children ? JSON.parse(row.allowed_children as string) : null,
            instance_limits: JSON.parse((row.instance_limits as string) || '{"min":0,"max":null}'),
            created_at: row.created_at as string,
            updated_at: row.updated_at as string,
        };
    }

    // ==================== ELEMENT ISSUES ====================

    createElementIssue(data: Omit<ElementIssue, 'id' | 'created_at' | 'resolved_at'>): ElementIssue {
        const id = this.genId();
        this.db.prepare(`
            INSERT INTO element_issues (id, element_id, element_type, plan_id, description, status, severity, mode, reported_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(id, data.element_id, data.element_type, data.plan_id,
            data.description, data.status || 'open', data.severity || 'bug',
            data.mode || 'fullstack', data.reported_by || 'user');
        return this.getElementIssue(id)!;
    }

    getElementIssue(id: string): ElementIssue | null {
        const row = this.db.prepare('SELECT * FROM element_issues WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        return row ? this.rowToElementIssue(row) : null;
    }

    getElementIssuesByPlan(planId: string, status?: string): ElementIssue[] {
        if (status) {
            const rows = this.db.prepare(
                'SELECT * FROM element_issues WHERE plan_id = ? AND status = ? ORDER BY created_at DESC'
            ).all(planId, status) as Record<string, unknown>[];
            return rows.map(r => this.rowToElementIssue(r));
        }
        const rows = this.db.prepare(
            'SELECT * FROM element_issues WHERE plan_id = ? ORDER BY created_at DESC'
        ).all(planId) as Record<string, unknown>[];
        return rows.map(r => this.rowToElementIssue(r));
    }

    getElementIssuesByElement(elementId: string, elementType: string): ElementIssue[] {
        const rows = this.db.prepare(
            'SELECT * FROM element_issues WHERE element_id = ? AND element_type = ? ORDER BY created_at DESC'
        ).all(elementId, elementType) as Record<string, unknown>[];
        return rows.map(r => this.rowToElementIssue(r));
    }

    updateElementIssue(id: string, updates: Partial<ElementIssue>): ElementIssue | null {
        const fields: string[] = [];
        const values: unknown[] = [];
        if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
        if (updates.status !== undefined) {
            fields.push('status = ?'); values.push(updates.status);
            if (updates.status === 'resolved') {
                fields.push('resolved_at = ?'); values.push(new Date().toISOString());
            }
        }
        if (updates.severity !== undefined) { fields.push('severity = ?'); values.push(updates.severity); }
        if (updates.mode !== undefined) { fields.push('mode = ?'); values.push(updates.mode); }
        if (fields.length === 0) return this.getElementIssue(id);
        values.push(id);
        this.db.prepare(`UPDATE element_issues SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return this.getElementIssue(id);
    }

    deleteElementIssue(id: string): void {
        this.db.prepare('DELETE FROM element_issues WHERE id = ?').run(id);
    }

    countElementIssuesByPlan(planId: string): { open: number; resolved: number; total: number } {
        const rows = this.db.prepare(
            'SELECT status, COUNT(*) as cnt FROM element_issues WHERE plan_id = ? GROUP BY status'
        ).all(planId) as Array<{ status: string; cnt: number }>;
        let open = 0, resolved = 0;
        for (const r of rows) {
            if (r.status === 'open') open = r.cnt;
            else if (r.status === 'resolved') resolved = r.cnt;
        }
        return { open, resolved, total: open + resolved };
    }

    private rowToElementIssue(row: Record<string, unknown>): ElementIssue {
        return {
            id: row.id as string,
            element_id: row.element_id as string,
            element_type: row.element_type as ElementIssue['element_type'],
            plan_id: row.plan_id as string,
            description: row.description as string,
            status: row.status as ElementIssue['status'],
            severity: row.severity as ElementIssue['severity'],
            mode: row.mode as ElementIssue['mode'],
            reported_by: row.reported_by as string,
            created_at: row.created_at as string,
            resolved_at: (row.resolved_at as string) ?? null,
        };
    }

    // ==================== AI SUGGESTIONS ====================

    createAISuggestion(data: Omit<AISuggestion, 'id' | 'created_at' | 'updated_at'>): AISuggestion {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO ai_suggestions (id, plan_id, component_id, page_id, type, title, description, reasoning, action_type, action_payload, priority, status, ticket_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, data.plan_id, data.component_id ?? null, data.page_id ?? null,
            data.type || 'general', data.title, data.description, data.reasoning || '',
            data.action_type ?? null, JSON.stringify(data.action_payload || {}),
            data.priority || 'P2', data.status || 'pending', data.ticket_id ?? null,
            now, now);
        return this.getAISuggestion(id)!;
    }

    getAISuggestion(id: string): AISuggestion | null {
        const row = this.db.prepare('SELECT * FROM ai_suggestions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        return row ? this.rowToAISuggestion(row) : null;
    }

    getAISuggestionsByPlan(planId: string, status?: string): AISuggestion[] {
        if (status) {
            const rows = this.db.prepare(
                'SELECT * FROM ai_suggestions WHERE plan_id = ? AND status = ? ORDER BY created_at DESC'
            ).all(planId, status) as Record<string, unknown>[];
            return rows.map(r => this.rowToAISuggestion(r));
        }
        const rows = this.db.prepare(
            'SELECT * FROM ai_suggestions WHERE plan_id = ? ORDER BY created_at DESC'
        ).all(planId) as Record<string, unknown>[];
        return rows.map(r => this.rowToAISuggestion(r));
    }

    getAISuggestionsByComponent(componentId: string): AISuggestion[] {
        const rows = this.db.prepare(
            'SELECT * FROM ai_suggestions WHERE component_id = ? ORDER BY created_at DESC'
        ).all(componentId) as Record<string, unknown>[];
        return rows.map(r => this.rowToAISuggestion(r));
    }

    getAISuggestionsByPage(pageId: string): AISuggestion[] {
        const rows = this.db.prepare(
            'SELECT * FROM ai_suggestions WHERE page_id = ? ORDER BY created_at DESC'
        ).all(pageId) as Record<string, unknown>[];
        return rows.map(r => this.rowToAISuggestion(r));
    }

    updateAISuggestion(id: string, updates: Partial<AISuggestion>): AISuggestion | null {
        const fields: string[] = [];
        const values: unknown[] = [];
        if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
        if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
        if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
        if (updates.reasoning !== undefined) { fields.push('reasoning = ?'); values.push(updates.reasoning); }
        if (updates.action_type !== undefined) { fields.push('action_type = ?'); values.push(updates.action_type); }
        if (updates.action_payload !== undefined) { fields.push('action_payload = ?'); values.push(JSON.stringify(updates.action_payload)); }
        if (updates.priority !== undefined) { fields.push('priority = ?'); values.push(updates.priority); }
        if (updates.ticket_id !== undefined) { fields.push('ticket_id = ?'); values.push(updates.ticket_id); }
        if (fields.length === 0) return this.getAISuggestion(id);
        fields.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(id);
        this.db.prepare(`UPDATE ai_suggestions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return this.getAISuggestion(id);
    }

    deleteAISuggestion(id: string): void {
        this.db.prepare('DELETE FROM ai_suggestions WHERE id = ?').run(id);
    }

    countAISuggestionsByPlan(planId: string): { pending: number; accepted: number; dismissed: number; total: number } {
        const rows = this.db.prepare(
            'SELECT status, COUNT(*) as cnt FROM ai_suggestions WHERE plan_id = ? GROUP BY status'
        ).all(planId) as Array<{ status: string; cnt: number }>;
        let pending = 0, accepted = 0, dismissed = 0, applied = 0;
        for (const r of rows) {
            if (r.status === 'pending') pending = r.cnt;
            else if (r.status === 'accepted') accepted = r.cnt;
            else if (r.status === 'dismissed') dismissed = r.cnt;
            else if (r.status === 'applied') applied = r.cnt;
        }
        return { pending, accepted: accepted + applied, dismissed, total: pending + accepted + dismissed + applied };
    }

    private rowToAISuggestion(row: Record<string, unknown>): AISuggestion {
        return {
            id: row.id as string,
            plan_id: row.plan_id as string,
            component_id: (row.component_id as string) ?? null,
            page_id: (row.page_id as string) ?? null,
            type: row.type as AISuggestion['type'],
            title: row.title as string,
            description: row.description as string,
            reasoning: row.reasoning as string,
            action_type: (row.action_type as AISuggestion['action_type']) ?? null,
            action_payload: JSON.parse((row.action_payload as string) || '{}'),
            priority: row.priority as AISuggestion['priority'],
            status: row.status as AISuggestion['status'],
            ticket_id: (row.ticket_id as string) ?? null,
            created_at: row.created_at as string,
            updated_at: row.updated_at as string,
        };
    }

    // ==================== AI QUESTIONS ====================

    createAIQuestion(data: Omit<AIQuestion, 'id' | 'created_at' | 'updated_at'>): AIQuestion {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO ai_questions (id, plan_id, component_id, page_id, category, question, question_type, options, ai_reasoning, ai_suggested_answer, user_answer, status, ticket_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, data.plan_id, data.component_id ?? null, data.page_id ?? null,
            data.category || 'general', data.question, data.question_type || 'text',
            JSON.stringify(data.options || []), data.ai_reasoning || '',
            data.ai_suggested_answer ?? null, data.user_answer ?? null,
            data.status || 'pending', data.ticket_id ?? null, now, now);
        return this.getAIQuestion(id)!;
    }

    getAIQuestion(id: string): AIQuestion | null {
        const row = this.db.prepare('SELECT * FROM ai_questions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        return row ? this.rowToAIQuestion(row) : null;
    }

    getAIQuestionsByPlan(planId: string, status?: string): AIQuestion[] {
        if (status) {
            const rows = this.db.prepare(
                'SELECT * FROM ai_questions WHERE plan_id = ? AND status = ? ORDER BY created_at DESC'
            ).all(planId, status) as Record<string, unknown>[];
            return rows.map(r => this.rowToAIQuestion(r));
        }
        const rows = this.db.prepare(
            'SELECT * FROM ai_questions WHERE plan_id = ? ORDER BY created_at DESC'
        ).all(planId) as Record<string, unknown>[];
        return rows.map(r => this.rowToAIQuestion(r));
    }

    getAIQuestionsByComponent(componentId: string): AIQuestion[] {
        const rows = this.db.prepare(
            'SELECT * FROM ai_questions WHERE component_id = ? ORDER BY created_at DESC'
        ).all(componentId) as Record<string, unknown>[];
        return rows.map(r => this.rowToAIQuestion(r));
    }

    getAIQuestionsByPage(pageId: string): AIQuestion[] {
        const rows = this.db.prepare(
            'SELECT * FROM ai_questions WHERE page_id = ? ORDER BY created_at DESC'
        ).all(pageId) as Record<string, unknown>[];
        return rows.map(r => this.rowToAIQuestion(r));
    }

    answerAIQuestion(id: string, answer: string): AIQuestion | null {
        this.db.prepare(
            'UPDATE ai_questions SET user_answer = ?, status = ?, updated_at = ? WHERE id = ?'
        ).run(answer, 'answered', new Date().toISOString(), id);
        return this.getAIQuestion(id);
    }

    autofillAIQuestion(id: string, answer: string): AIQuestion | null {
        this.db.prepare(
            'UPDATE ai_questions SET ai_suggested_answer = ?, user_answer = ?, status = ?, updated_at = ? WHERE id = ?'
        ).run(answer, answer, 'autofilled', new Date().toISOString(), id);
        return this.getAIQuestion(id);
    }

    dismissAIQuestion(id: string): AIQuestion | null {
        this.db.prepare(
            'UPDATE ai_questions SET status = ?, updated_at = ? WHERE id = ?'
        ).run('dismissed', new Date().toISOString(), id);
        return this.getAIQuestion(id);
    }

    updateAIQuestion(id: string, updates: Partial<AIQuestion>): AIQuestion | null {
        const fields: string[] = [];
        const values: unknown[] = [];
        if (updates.question !== undefined) { fields.push('question = ?'); values.push(updates.question); }
        if (updates.category !== undefined) { fields.push('category = ?'); values.push(updates.category); }
        if (updates.question_type !== undefined) { fields.push('question_type = ?'); values.push(updates.question_type); }
        if (updates.options !== undefined) { fields.push('options = ?'); values.push(JSON.stringify(updates.options)); }
        if (updates.ai_reasoning !== undefined) { fields.push('ai_reasoning = ?'); values.push(updates.ai_reasoning); }
        if (updates.ai_suggested_answer !== undefined) { fields.push('ai_suggested_answer = ?'); values.push(updates.ai_suggested_answer); }
        if (updates.user_answer !== undefined) { fields.push('user_answer = ?'); values.push(updates.user_answer); }
        if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
        if (updates.ticket_id !== undefined) { fields.push('ticket_id = ?'); values.push(updates.ticket_id); }
        if (fields.length === 0) return this.getAIQuestion(id);
        fields.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(id);
        this.db.prepare(`UPDATE ai_questions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return this.getAIQuestion(id);
    }

    deleteAIQuestion(id: string): void {
        this.db.prepare('DELETE FROM ai_questions WHERE id = ?').run(id);
    }

    countAIQuestionsByPlan(planId: string): { pending: number; answered: number; autofilled: number; total: number } {
        const rows = this.db.prepare(
            'SELECT status, COUNT(*) as cnt FROM ai_questions WHERE plan_id = ? GROUP BY status'
        ).all(planId) as Array<{ status: string; cnt: number }>;
        let pending = 0, answered = 0, autofilled = 0, dismissed = 0;
        for (const r of rows) {
            if (r.status === 'pending') pending = r.cnt;
            else if (r.status === 'answered') answered = r.cnt;
            else if (r.status === 'autofilled') autofilled = r.cnt;
            else if (r.status === 'dismissed') dismissed = r.cnt;
        }
        return { pending, answered, autofilled, total: pending + answered + autofilled + dismissed };
    }

    private rowToAIQuestion(row: Record<string, unknown>): AIQuestion {
        return {
            id: row.id as string,
            plan_id: row.plan_id as string,
            component_id: (row.component_id as string) ?? null,
            page_id: (row.page_id as string) ?? null,
            category: row.category as AIQuestion['category'],
            question: row.question as string,
            question_type: row.question_type as AIQuestion['question_type'],
            options: JSON.parse((row.options as string) || '[]'),
            ai_reasoning: row.ai_reasoning as string,
            ai_suggested_answer: (row.ai_suggested_answer as string) ?? null,
            user_answer: (row.user_answer as string) ?? null,
            status: row.status as AIQuestion['status'],
            ticket_id: (row.ticket_id as string) ?? null,
            created_at: row.created_at as string,
            updated_at: row.updated_at as string,
        };
    }

    // ==================== PLAN VERSIONS ====================

    createPlanVersion(data: Omit<PlanVersion, 'id' | 'created_at'>): PlanVersion {
        const id = this.genId();
        this.db.prepare(`
            INSERT INTO plan_versions (id, plan_id, version_number, label, snapshot, change_summary, created_by, branch_type, is_active, change_count, merge_diff, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(id, data.plan_id, data.version_number, data.label || '',
            data.snapshot || '{}', data.change_summary || '', data.created_by || 'user',
            data.branch_type || 'live', data.is_active ? 1 : 0, data.change_count ?? 0,
            data.merge_diff ?? null);
        return this.getPlanVersion(id)!;
    }

    getPlanVersion(id: string): PlanVersion | null {
        const row = this.db.prepare('SELECT * FROM plan_versions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        return row ? this.rowToPlanVersion(row) : null;
    }

    getPlanVersionsByPlan(planId: string): PlanVersion[] {
        const rows = this.db.prepare(
            'SELECT * FROM plan_versions WHERE plan_id = ? ORDER BY version_number DESC'
        ).all(planId) as Record<string, unknown>[];
        return rows.map(r => this.rowToPlanVersion(r));
    }

    getLatestPlanVersion(planId: string): PlanVersion | null {
        const row = this.db.prepare(
            'SELECT * FROM plan_versions WHERE plan_id = ? ORDER BY version_number DESC LIMIT 1'
        ).get(planId) as Record<string, unknown> | undefined;
        return row ? this.rowToPlanVersion(row) : null;
    }

    getNextPlanVersionNumber(planId: string): number {
        const row = this.db.prepare(
            'SELECT MAX(version_number) as max_ver FROM plan_versions WHERE plan_id = ?'
        ).get(planId) as { max_ver: number | null };
        return (row.max_ver ?? 0) + 1;
    }

    deletePlanVersion(id: string): void {
        this.db.prepare('DELETE FROM plan_versions WHERE id = ?').run(id);
    }

    private rowToPlanVersion(row: Record<string, unknown>): PlanVersion {
        return {
            id: row.id as string,
            plan_id: row.plan_id as string,
            version_number: row.version_number as number,
            label: row.label as string,
            snapshot: row.snapshot as string,
            change_summary: row.change_summary as string,
            created_by: row.created_by as string,
            branch_type: (row.branch_type as string || 'live') as 'live' | 'features',
            is_active: !!(row.is_active as number),
            change_count: (row.change_count as number) ?? 0,
            merge_diff: (row.merge_diff as string) ?? null,
            created_at: row.created_at as string,
        };
    }

    getActiveBranchVersion(planId: string, branchType: 'live' | 'features'): PlanVersion | null {
        const row = this.db.prepare(
            'SELECT * FROM plan_versions WHERE plan_id = ? AND branch_type = ? AND is_active = 1 ORDER BY version_number DESC LIMIT 1'
        ).get(planId, branchType) as Record<string, unknown> | undefined;
        return row ? this.rowToPlanVersion(row) : null;
    }

    getPlanVersionsByBranch(planId: string, branchType: 'live' | 'features'): PlanVersion[] {
        const rows = this.db.prepare(
            'SELECT * FROM plan_versions WHERE plan_id = ? AND branch_type = ? ORDER BY version_number DESC'
        ).all(planId, branchType) as Record<string, unknown>[];
        return rows.map(r => this.rowToPlanVersion(r));
    }

    setActiveBranchVersion(planId: string, branchType: 'live' | 'features', versionId: string): void {
        this.db.exec('BEGIN');
        try {
            this.db.prepare(
                'UPDATE plan_versions SET is_active = 0 WHERE plan_id = ? AND branch_type = ?'
            ).run(planId, branchType);
            this.db.prepare(
                'UPDATE plan_versions SET is_active = 1 WHERE id = ?'
            ).run(versionId);
            this.db.exec('COMMIT');
        } catch (err) {
            this.db.exec('ROLLBACK');
            throw err;
        }
    }

    updatePlanVersionChangeCount(versionId: string, changeCount: number): void {
        this.db.prepare(
            'UPDATE plan_versions SET change_count = ? WHERE id = ?'
        ).run(changeCount, versionId);
    }

    // ==================== DESIGN CHANGE LOG ====================

    addDesignChangeLog(data: Omit<DesignChangeLog, 'id' | 'created_at'>): DesignChangeLog {
        const id = this.genId();
        this.db.prepare(`
            INSERT INTO design_change_log (id, plan_id, branch_type, change_type, entity_type, entity_id, description, session_change_number, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(id, data.plan_id, data.branch_type, data.change_type, data.entity_type,
            data.entity_id, data.description || '', data.session_change_number ?? 0);
        return this.db.prepare('SELECT * FROM design_change_log WHERE id = ?').get(id) as DesignChangeLog;
    }

    getDesignChangeLog(planId: string, branchType?: 'live' | 'features'): DesignChangeLog[] {
        if (branchType) {
            return this.db.prepare(
                'SELECT * FROM design_change_log WHERE plan_id = ? AND branch_type = ? ORDER BY created_at DESC'
            ).all(planId, branchType) as DesignChangeLog[];
        }
        return this.db.prepare(
            'SELECT * FROM design_change_log WHERE plan_id = ? ORDER BY created_at DESC'
        ).all(planId) as DesignChangeLog[];
    }

    getDesignChangeCount(planId: string, branchType: 'live' | 'features'): number {
        const row = this.db.prepare(
            'SELECT COUNT(*) as cnt FROM design_change_log WHERE plan_id = ? AND branch_type = ?'
        ).get(planId, branchType) as { cnt: number };
        return row.cnt;
    }

    clearDesignChangeLog(planId: string, branchType: 'live' | 'features'): void {
        this.db.prepare(
            'DELETE FROM design_change_log WHERE plan_id = ? AND branch_type = ?'
        ).run(planId, branchType);
    }

    // ==================== DATA MODELS ====================

    createDataModel(data: Omit<DataModel, 'id' | 'created_at' | 'updated_at'>): DataModel {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO data_models (id, plan_id, name, description, fields, relationships, bound_components, ai_backend_suggestion, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, data.plan_id, data.name, data.description || '',
            JSON.stringify(data.fields || []), JSON.stringify(data.relationships || []),
            JSON.stringify(data.bound_components || []),
            data.ai_backend_suggestion ?? null, now, now);
        return this.getDataModel(id)!;
    }

    getDataModel(id: string): DataModel | null {
        const row = this.db.prepare('SELECT * FROM data_models WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        return row ? this.rowToDataModel(row) : null;
    }

    getDataModelsByPlan(planId: string): DataModel[] {
        const rows = this.db.prepare(
            'SELECT * FROM data_models WHERE plan_id = ? ORDER BY name ASC'
        ).all(planId) as Record<string, unknown>[];
        return rows.map(r => this.rowToDataModel(r));
    }

    getDataModelByName(planId: string, name: string): DataModel | null {
        const row = this.db.prepare(
            'SELECT * FROM data_models WHERE plan_id = ? AND name = ?'
        ).get(planId, name) as Record<string, unknown> | undefined;
        return row ? this.rowToDataModel(row) : null;
    }

    updateDataModel(id: string, updates: Partial<DataModel>): DataModel | null {
        const fields: string[] = [];
        const values: unknown[] = [];
        if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
        if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
        if (updates.fields !== undefined) { fields.push('fields = ?'); values.push(JSON.stringify(updates.fields)); }
        if (updates.relationships !== undefined) { fields.push('relationships = ?'); values.push(JSON.stringify(updates.relationships)); }
        if (updates.bound_components !== undefined) { fields.push('bound_components = ?'); values.push(JSON.stringify(updates.bound_components)); }
        if (updates.ai_backend_suggestion !== undefined) { fields.push('ai_backend_suggestion = ?'); values.push(updates.ai_backend_suggestion); }
        if (fields.length === 0) return this.getDataModel(id);
        fields.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(id);
        this.db.prepare(`UPDATE data_models SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return this.getDataModel(id);
    }

    deleteDataModel(id: string): void {
        this.db.prepare('DELETE FROM data_models WHERE id = ?').run(id);
    }

    deleteDataModelsByPlan(planId: string): void {
        this.db.prepare('DELETE FROM data_models WHERE plan_id = ?').run(planId);
    }

    private rowToDataModel(row: Record<string, unknown>): DataModel {
        return {
            id: row.id as string,
            plan_id: row.plan_id as string,
            name: row.name as string,
            description: row.description as string,
            fields: JSON.parse((row.fields as string) || '[]'),
            relationships: JSON.parse((row.relationships as string) || '[]'),
            bound_components: JSON.parse((row.bound_components as string) || '[]'),
            ai_backend_suggestion: (row.ai_backend_suggestion as string) ?? null,
            created_at: row.created_at as string,
            updated_at: row.updated_at as string,
        };
    }

    // ==================== AI CHAT SESSIONS ====================

    createAiChatSession(data: { plan_id?: string | null; ticket_id?: string | null; session_name?: string }): AIChatSession {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO ai_chat_sessions (id, plan_id, ticket_id, session_name, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'active', ?, ?)
        `).run(id, data.plan_id ?? null, data.ticket_id ?? null, data.session_name || 'Chat Session', now, now);
        return this.getAiChatSession(id)!;
    }

    getAiChatSession(id: string): AIChatSession | null {
        const row = this.db.prepare('SELECT * FROM ai_chat_sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        return row ? this.rowToAiChatSession(row) : null;
    }

    getAiChatSessions(planId?: string | null, status?: string): AIChatSession[] {
        let query = 'SELECT * FROM ai_chat_sessions';
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (planId) { conditions.push('plan_id = ?'); params.push(planId); }
        if (status) { conditions.push('status = ?'); params.push(status); }
        if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ORDER BY updated_at DESC';
        const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];
        return rows.map(r => this.rowToAiChatSession(r));
    }

    getLatestActiveAiChatSession(planId?: string | null): AIChatSession | null {
        let query = "SELECT * FROM ai_chat_sessions WHERE status = 'active'";
        const params: unknown[] = [];
        if (planId) { query += ' AND plan_id = ?'; params.push(planId); }
        query += ' ORDER BY updated_at DESC LIMIT 1';
        const row = this.db.prepare(query).get(...params) as Record<string, unknown> | undefined;
        return row ? this.rowToAiChatSession(row) : null;
    }

    updateAiChatSession(id: string, updates: Partial<AIChatSession>): void {
        const fields: string[] = [];
        const values: unknown[] = [];
        if (updates.session_name !== undefined) { fields.push('session_name = ?'); values.push(updates.session_name); }
        if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
        if (updates.ticket_id !== undefined) { fields.push('ticket_id = ?'); values.push(updates.ticket_id); }
        if (fields.length === 0) return;
        fields.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(id);
        this.db.prepare(`UPDATE ai_chat_sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    private rowToAiChatSession(row: Record<string, unknown>): AIChatSession {
        return {
            id: row.id as string,
            plan_id: (row.plan_id as string) ?? null,
            ticket_id: (row.ticket_id as string) ?? null,
            session_name: row.session_name as string,
            status: row.status as 'active' | 'archived',
            created_at: row.created_at as string,
            updated_at: row.updated_at as string,
        };
    }

    // ==================== AI CHAT MESSAGES ====================

    addAiChatMessage(data: {
        session_id: string;
        role: string;
        content: string;
        context_page?: string;
        context_element_id?: string | null;
        context_element_type?: string | null;
        ai_level?: string;
        ticket_reply_id?: string | null;
    }): AIChatMessage {
        const id = this.genId();
        this.db.prepare(`
            INSERT INTO ai_chat_messages (id, session_id, ticket_reply_id, role, content, context_page, context_element_id, context_element_type, ai_level, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
            id, data.session_id, data.ticket_reply_id ?? null,
            data.role, data.content,
            data.context_page || '', data.context_element_id ?? null,
            data.context_element_type ?? null, data.ai_level || 'suggestions'
        );
        // Update session timestamp
        this.db.prepare("UPDATE ai_chat_sessions SET updated_at = datetime('now') WHERE id = ?").run(data.session_id);
        return this.db.prepare('SELECT * FROM ai_chat_messages WHERE id = ?').get(id) as AIChatMessage;
    }

    getAiChatMessages(sessionId: string, limit: number = 100): AIChatMessage[] {
        return this.db.prepare(
            'SELECT * FROM ai_chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?'
        ).all(sessionId, limit) as AIChatMessage[];
    }

    close(): void {
        if (this.db) {
            this.db.close();
        }
    }
}
