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
    AIChatSession, AIChatMessage, DesignChangeLog,
    // v4.1 types
    TicketRun,
    // v4.2 types
    ElementStatus, LifecycleStage, ImplementationStatus, ReadinessLevel, PlanMode,
    // v8.0 types
    BackendElement, ElementLink, TagDefinition, ElementTag,
    ReviewQueueItem, BUILTIN_TAGS,
    // v9.0 types
    AgentTreeNode, AgentTreeTemplate, AgentLevel, AgentPermission,
    TreeNodeStatus, ModelPreference, ModelCapability,
    NicheAgentDefinition,
    WorkflowDefinition, WorkflowStep, WorkflowStepType, WorkflowStatus,
    WorkflowExecution, WorkflowStepResult, WorkflowExecutionStatus,
    AgentPermissionSet,
    UserProfile, UserProgrammingLevel, UserPreferenceAction,
    AgentConversation,
    EscalationChain, EscalationChainStatus,
    ModelAssignment,
    MCPConfirmation, MCPConfirmationStatus,
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
                auto_created INTEGER DEFAULT 0,
                operation_type TEXT DEFAULT 'user_created',
                acceptance_criteria TEXT DEFAULT NULL,
                blocking_ticket_id TEXT DEFAULT NULL,
                is_ghost INTEGER DEFAULT 0,
                processing_agent TEXT DEFAULT NULL,
                processing_status TEXT DEFAULT NULL,
                deliverable_type TEXT DEFAULT NULL,
                verification_result TEXT DEFAULT NULL,
                source_page_ids TEXT DEFAULT NULL,
                source_component_ids TEXT DEFAULT NULL,
                retry_count INTEGER DEFAULT 0,
                max_retries INTEGER DEFAULT 3,
                stage INTEGER DEFAULT 1,
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

            -- ==================== PLAN FILES (v5.0) ====================
            -- User-uploaded reference documents (.md, .txt, .doc) that form the
            -- "source of truth" for what the project should be. All agents reference
            -- these files and flag conflicts when requests contradict the plan.
            CREATE TABLE IF NOT EXISTS plan_files (
                id TEXT PRIMARY KEY,
                plan_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                file_type TEXT NOT NULL DEFAULT 'text',
                content TEXT NOT NULL DEFAULT '',
                summary TEXT,
                category TEXT NOT NULL DEFAULT 'general',
                upload_order INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1,
                version INTEGER NOT NULL DEFAULT 1,
                content_hash TEXT NOT NULL DEFAULT '',
                source_path TEXT,
                is_linked INTEGER NOT NULL DEFAULT 0,
                last_synced_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (plan_id) REFERENCES plans(id)
            );
            CREATE INDEX IF NOT EXISTS idx_plan_files_plan ON plan_files(plan_id);

            -- Track changes to plan files for version history and ticket impact
            CREATE TABLE IF NOT EXISTS plan_file_changes (
                id TEXT PRIMARY KEY,
                plan_file_id TEXT NOT NULL,
                plan_id TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                change_type TEXT NOT NULL DEFAULT 'update',
                previous_hash TEXT,
                new_hash TEXT,
                diff_summary TEXT,
                affected_ticket_ids TEXT DEFAULT '[]',
                reprocessing_triggered INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (plan_file_id) REFERENCES plan_files(id),
                FOREIGN KEY (plan_id) REFERENCES plans(id)
            );
            CREATE INDEX IF NOT EXISTS idx_plan_file_changes_file ON plan_file_changes(plan_file_id);
            CREATE INDEX IF NOT EXISTS idx_plan_file_changes_plan ON plan_file_changes(plan_id);

            -- Track linked folders for plan files (watch a local directory)
            CREATE TABLE IF NOT EXISTS plan_file_folders (
                id TEXT PRIMARY KEY,
                plan_id TEXT NOT NULL,
                folder_path TEXT NOT NULL,
                file_patterns TEXT NOT NULL DEFAULT '*.md,*.txt,*.doc,*.docx',
                is_active INTEGER NOT NULL DEFAULT 1,
                last_scanned_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (plan_id) REFERENCES plans(id)
            );
            CREATE INDEX IF NOT EXISTS idx_plan_file_folders_plan ON plan_file_folders(plan_id);

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

        // ==================== v4.0 Migrations ====================

        // Migration: add ticket processing fields
        const ticketV4Columns = [
            ['acceptance_criteria', 'TEXT DEFAULT NULL'],
            ['blocking_ticket_id', 'TEXT DEFAULT NULL'],
            ['is_ghost', 'INTEGER DEFAULT 0'],
            ['processing_agent', 'TEXT DEFAULT NULL'],
            ['processing_status', 'TEXT DEFAULT NULL'],
            ['deliverable_type', 'TEXT DEFAULT NULL'],
            ['verification_result', 'TEXT DEFAULT NULL'],
            ['source_page_ids', 'TEXT DEFAULT NULL'],
            ['source_component_ids', 'TEXT DEFAULT NULL'],
            ['retry_count', 'INTEGER DEFAULT 0'],
            ['max_retries', 'INTEGER DEFAULT 3'],
            ['stage', 'INTEGER DEFAULT 1'],
        ];
        for (const [col, type] of ticketV4Columns) {
            try { this.db.exec(`ALTER TABLE tickets ADD COLUMN ${col} ${type}`); } catch { /* already exists */ }
        }

        // Migration: add question queue fields
        const questionV4Columns = [
            ['source_agent', 'TEXT DEFAULT NULL'],
            ['source_ticket_id', 'TEXT DEFAULT NULL'],
            ['navigate_to', 'TEXT DEFAULT NULL'],
            ['is_ghost', 'INTEGER DEFAULT 0'],
            ['queue_priority', 'INTEGER DEFAULT 2'],
            ['answered_at', 'TEXT DEFAULT NULL'],
            ['ai_continued', 'INTEGER DEFAULT 0'],
            ['dismiss_count', 'INTEGER DEFAULT 0'],
            ['previous_decision_id', 'TEXT DEFAULT NULL'],
            ['conflict_decision_id', 'TEXT DEFAULT NULL'],
            ['technical_context', 'TEXT DEFAULT NULL'],
            ['friendly_message', 'TEXT DEFAULT NULL'],
        ];
        for (const [col, type] of questionV4Columns) {
            try { this.db.exec(`ALTER TABLE ai_questions ADD COLUMN ${col} ${type}`); } catch { /* already exists */ }
        }

        // Migration: add draft flag to design_components
        try {
            this.db.exec('ALTER TABLE design_components ADD COLUMN is_draft INTEGER DEFAULT 0');
        } catch { /* already exists */ }

        // Migration: add phase tracking to plans
        const planPhaseColumns = [
            ['current_phase', "TEXT DEFAULT 'planning'"],
            ['current_version', 'INTEGER DEFAULT 1'],
            ['phase_started_at', 'TEXT DEFAULT NULL'],
            ['design_approved_at', 'TEXT DEFAULT NULL'],
            ['coding_version_snapshot_id', 'TEXT DEFAULT NULL'],
        ];
        for (const [col, type] of planPhaseColumns) {
            try { this.db.exec(`ALTER TABLE plans ADD COLUMN ${col} ${type}`); } catch { /* already exists */ }
        }

        // Migration: create user_decisions table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS user_decisions (
                id TEXT PRIMARY KEY,
                plan_id TEXT NOT NULL,
                category TEXT NOT NULL,
                topic TEXT NOT NULL,
                decision TEXT NOT NULL,
                question_id TEXT,
                ticket_id TEXT,
                superseded_by TEXT,
                is_active INTEGER DEFAULT 1,
                context TEXT,
                affected_entities TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );
        `);
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_user_decisions_plan ON user_decisions(plan_id, is_active)'); } catch { /* already exists */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_user_decisions_topic ON user_decisions(plan_id, topic)'); } catch { /* already exists */ }

        // Migration v4.1: add error tracking to tickets
        const ticketErrorColumns = [
            ['last_error', 'TEXT DEFAULT NULL'],
            ['last_error_at', 'TEXT DEFAULT NULL'],
        ];
        for (const [col, type] of ticketErrorColumns) {
            try { this.db.exec(`ALTER TABLE tickets ADD COLUMN ${col} ${type}`); } catch { /* already exists */ }
        }

        // Migration v4.1: enhance ai_suggestions with new fields
        const suggestionV41Columns = [
            ['goal', "TEXT NOT NULL DEFAULT ''"],
            ['source_agent', 'TEXT DEFAULT NULL'],
            ['target_type', 'TEXT DEFAULT NULL'],
            ['target_id', 'TEXT DEFAULT NULL'],
            ['current_value', 'TEXT DEFAULT NULL'],
            ['suggested_value', 'TEXT DEFAULT NULL'],
            ['approved_at', 'TEXT DEFAULT NULL'],
            ['rejected_at', 'TEXT DEFAULT NULL'],
            ['rejection_reason', 'TEXT DEFAULT NULL'],
        ];
        for (const [col, type] of suggestionV41Columns) {
            try { this.db.exec(`ALTER TABLE ai_suggestions ADD COLUMN ${col} ${type}`); } catch { /* already exists */ }
        }

        // Migration v4.1: create ticket_runs table for per-ticket run logging
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS ticket_runs (
                id TEXT PRIMARY KEY,
                ticket_id TEXT NOT NULL,
                run_number INTEGER NOT NULL,
                agent_name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'started',
                prompt_sent TEXT NOT NULL DEFAULT '',
                response_received TEXT,
                review_result TEXT,
                verification_result TEXT,
                error_message TEXT,
                error_stack TEXT,
                tokens_used INTEGER,
                duration_ms INTEGER NOT NULL DEFAULT 0,
                started_at TEXT NOT NULL DEFAULT (datetime('now')),
                completed_at TEXT,
                FOREIGN KEY (ticket_id) REFERENCES tickets(id)
            );
        `);
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_ticket_runs_ticket ON ticket_runs(ticket_id, started_at)'); } catch { /* already exists */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_ticket_runs_status ON ticket_runs(status)'); } catch { /* already exists */ }

        // v5.0: Individual agent steps within a run — modular pipeline tracking
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS ticket_run_steps (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                step_number INTEGER NOT NULL,
                agent_name TEXT NOT NULL,
                deliverable_type TEXT,
                status TEXT NOT NULL DEFAULT 'started',
                response TEXT,
                tokens_used INTEGER,
                duration_ms INTEGER NOT NULL DEFAULT 0,
                started_at TEXT NOT NULL DEFAULT (datetime('now')),
                completed_at TEXT,
                FOREIGN KEY (run_id) REFERENCES ticket_runs(id)
            )
        `);
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_run_steps_run ON ticket_run_steps(run_id, step_number)'); } catch { /* already exists */ }

        // Migration v4.2: create element_status table for per-element/per-page status tracking
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS element_status (
                id TEXT PRIMARY KEY,
                element_id TEXT NOT NULL,
                element_type TEXT NOT NULL DEFAULT 'component',
                plan_id TEXT NOT NULL,
                implementation_status TEXT NOT NULL DEFAULT 'not_started',
                lifecycle_stage TEXT NOT NULL DEFAULT 'design',
                readiness_pct INTEGER NOT NULL DEFAULT 0,
                readiness_level TEXT NOT NULL DEFAULT 'not_ready',
                mode_status TEXT NOT NULL DEFAULT '{}',
                checklist TEXT NOT NULL DEFAULT '[]',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (plan_id) REFERENCES plans(id)
            )
        `);
        try { this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_element_status_unique ON element_status(element_id, element_type, plan_id)'); } catch { /* already exists */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_element_status_plan ON element_status(plan_id)'); } catch { /* already exists */ }

        // Migration v7.0: add assigned_queue + cancellation_reason to tickets
        const ticketV7Columns = [
            ['assigned_queue', 'TEXT DEFAULT NULL'],
            ['cancellation_reason', 'TEXT DEFAULT NULL'],
        ];
        for (const [col, type] of ticketV7Columns) {
            try { this.db.exec(`ALTER TABLE tickets ADD COLUMN ${col} ${type}`); } catch { /* already exists */ }
        }

        // Migration v7.0: task_assignments table — structured task tracking with success criteria
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS task_assignments (
                id TEXT PRIMARY KEY,
                source_ticket_id TEXT,
                target_agent TEXT NOT NULL,
                target_queue TEXT,
                requester TEXT NOT NULL,
                task_message TEXT NOT NULL,
                success_criteria TEXT NOT NULL DEFAULT '[]',
                priority TEXT NOT NULL DEFAULT 'P2',
                status TEXT NOT NULL DEFAULT 'pending',
                agent_response TEXT,
                criteria_results TEXT,
                timeout_ms INTEGER NOT NULL DEFAULT 300000,
                duration_ms INTEGER,
                escalation_reason TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                completed_at TEXT,
                FOREIGN KEY (source_ticket_id) REFERENCES tickets(id)
            )
        `);
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_task_assignments_status ON task_assignments(status)'); } catch { /* already exists */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_task_assignments_queue ON task_assignments(target_queue)'); } catch { /* already exists */ }

        // Migration v7.0: support_documents table — organized reference material by folder
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS support_documents (
                id TEXT PRIMARY KEY,
                plan_id TEXT,
                folder_name TEXT NOT NULL,
                document_name TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                summary TEXT,
                category TEXT NOT NULL DEFAULT 'reference',
                source_ticket_id TEXT,
                source_agent TEXT,
                tags TEXT NOT NULL DEFAULT '[]',
                is_verified INTEGER NOT NULL DEFAULT 0,
                verified_by TEXT,
                relevance_score INTEGER NOT NULL DEFAULT 50,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (plan_id) REFERENCES plans(id),
                FOREIGN KEY (source_ticket_id) REFERENCES tickets(id)
            )
        `);
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_support_docs_folder ON support_documents(folder_name)'); } catch { /* already exists */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_support_docs_plan ON support_documents(plan_id)'); } catch { /* already exists */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_support_docs_category ON support_documents(category)'); } catch { /* already exists */ }

        // Migration v7.0: boss_notepad table — proper persistent notepad (replaces audit log hack)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS boss_notepad (
                id TEXT PRIMARY KEY,
                section TEXT NOT NULL DEFAULT 'general',
                content TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
        try { this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_boss_notepad_section ON boss_notepad(section)'); } catch { /* already exists */ }

        // ==================== v8.0 TABLES ====================

        // v8.0: Backend architecture elements (BE designer canvas cards)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS backend_elements (
                id TEXT PRIMARY KEY,
                plan_id TEXT NOT NULL,
                type TEXT NOT NULL DEFAULT 'service',
                name TEXT NOT NULL,
                domain TEXT NOT NULL DEFAULT 'general',
                layer TEXT NOT NULL DEFAULT 'services',
                config_json TEXT NOT NULL DEFAULT '{}',
                x REAL NOT NULL DEFAULT 0,
                y REAL NOT NULL DEFAULT 0,
                width REAL NOT NULL DEFAULT 280,
                height REAL NOT NULL DEFAULT 120,
                is_collapsed INTEGER NOT NULL DEFAULT 1,
                is_draft INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (plan_id) REFERENCES plans(id)
            )
        `);
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_backend_elements_plan ON backend_elements(plan_id)'); } catch { /* already exists */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_backend_elements_type ON backend_elements(type)'); } catch { /* already exists */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_backend_elements_domain ON backend_elements(domain)'); } catch { /* already exists */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_backend_elements_layer ON backend_elements(layer)'); } catch { /* already exists */ }

        // v8.0: Element links (FE↔FE, BE↔BE, FE→BE, BE→FE connections)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS element_links (
                id TEXT PRIMARY KEY,
                plan_id TEXT NOT NULL,
                link_type TEXT NOT NULL DEFAULT 'fe_to_be',
                granularity TEXT NOT NULL DEFAULT 'high',
                source TEXT NOT NULL DEFAULT 'manual',
                from_element_type TEXT NOT NULL,
                from_element_id TEXT NOT NULL,
                to_element_type TEXT NOT NULL,
                to_element_id TEXT NOT NULL,
                label TEXT NOT NULL DEFAULT '',
                metadata_json TEXT NOT NULL DEFAULT '{}',
                confidence INTEGER,
                is_approved INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (plan_id) REFERENCES plans(id)
            )
        `);
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_element_links_plan ON element_links(plan_id)'); } catch { /* already exists */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_element_links_from ON element_links(from_element_type, from_element_id)'); } catch { /* already exists */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_element_links_to ON element_links(to_element_type, to_element_id)'); } catch { /* already exists */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_element_links_type ON element_links(link_type)'); } catch { /* already exists */ }

        // v8.0: Tag definitions (builtin + custom, color-coded)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS tag_definitions (
                id TEXT PRIMARY KEY,
                plan_id TEXT,
                name TEXT NOT NULL,
                color TEXT NOT NULL DEFAULT 'gray',
                custom_color TEXT,
                is_builtin INTEGER NOT NULL DEFAULT 0,
                description TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_tag_definitions_plan ON tag_definitions(plan_id)'); } catch { /* already exists */ }

        // v8.0: Element-tag assignments (junction table)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS element_tags (
                id TEXT PRIMARY KEY,
                tag_id TEXT NOT NULL,
                element_type TEXT NOT NULL,
                element_id TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (tag_id) REFERENCES tag_definitions(id) ON DELETE CASCADE
            )
        `);
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_element_tags_tag ON element_tags(tag_id)'); } catch { /* already exists */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_element_tags_element ON element_tags(element_type, element_id)'); } catch { /* already exists */ }

        // v8.0: Unified review queue (FE drafts + BE drafts + link suggestions)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS review_queue (
                id TEXT PRIMARY KEY,
                plan_id TEXT NOT NULL,
                item_type TEXT NOT NULL DEFAULT 'fe_draft',
                element_id TEXT NOT NULL,
                element_type TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                source_agent TEXT NOT NULL DEFAULT 'system',
                status TEXT NOT NULL DEFAULT 'pending',
                priority TEXT NOT NULL DEFAULT 'P2',
                reviewed_at TEXT,
                review_notes TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (plan_id) REFERENCES plans(id)
            )
        `);
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_review_queue_plan ON review_queue(plan_id)'); } catch { /* already exists */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_review_queue_status ON review_queue(status)'); } catch { /* already exists */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_review_queue_type ON review_queue(item_type)'); } catch { /* already exists */ }

        // v8.0 Migrations: add source_type and is_locked to support_documents
        try { this.db.exec("ALTER TABLE support_documents ADD COLUMN source_type TEXT NOT NULL DEFAULT 'system'"); } catch { /* already exists */ }
        try { this.db.exec("ALTER TABLE support_documents ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0"); } catch { /* already exists */ }

        // ==================== v9.0 Tables ====================

        // v9.0: Agent tree nodes — 10-level hierarchy instances
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS agent_tree_nodes (
                id TEXT PRIMARY KEY,
                instance_id TEXT NOT NULL,
                agent_type TEXT NOT NULL,
                name TEXT NOT NULL,
                level INTEGER NOT NULL DEFAULT 0,
                parent_id TEXT,
                task_id TEXT,
                workflow_execution_id TEXT,
                scope TEXT NOT NULL DEFAULT '',
                permissions_json TEXT NOT NULL DEFAULT '[]',
                model_preference_json TEXT,
                max_fanout INTEGER NOT NULL DEFAULT 5,
                max_depth_below INTEGER NOT NULL DEFAULT 9,
                escalation_threshold INTEGER NOT NULL DEFAULT 3,
                escalation_target_id TEXT,
                context_isolation INTEGER NOT NULL DEFAULT 1,
                history_isolation INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'idle',
                retries INTEGER NOT NULL DEFAULT 0,
                escalations INTEGER NOT NULL DEFAULT 0,
                tokens_consumed INTEGER NOT NULL DEFAULT 0,
                input_contract TEXT,
                output_contract TEXT,
                niche_definition_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_tree_nodes_parent ON agent_tree_nodes(parent_id)'); } catch { /* */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_tree_nodes_level ON agent_tree_nodes(level)'); } catch { /* */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_tree_nodes_task ON agent_tree_nodes(task_id)'); } catch { /* */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_tree_nodes_instance ON agent_tree_nodes(instance_id)'); } catch { /* */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_tree_nodes_status ON agent_tree_nodes(status)'); } catch { /* */ }

        // v9.0: Agent tree templates — predefined hierarchy structures
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS agent_tree_templates (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                description TEXT NOT NULL DEFAULT '',
                nodes_json TEXT NOT NULL DEFAULT '[]',
                is_default INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);

        // v9.0: Niche agent definitions — ~230 leaf agent templates
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS niche_agent_definitions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                level INTEGER NOT NULL,
                specialty TEXT NOT NULL,
                domain TEXT NOT NULL DEFAULT 'code',
                area TEXT NOT NULL DEFAULT '',
                system_prompt_template TEXT NOT NULL DEFAULT '',
                parent_level INTEGER NOT NULL,
                required_capability TEXT NOT NULL DEFAULT 'general',
                default_model_capability TEXT NOT NULL DEFAULT 'fast',
                input_contract TEXT,
                output_contract TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_niche_agents_level ON niche_agent_definitions(level)'); } catch { /* */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_niche_agents_domain ON niche_agent_definitions(domain)'); } catch { /* */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_niche_agents_specialty ON niche_agent_definitions(specialty)'); } catch { /* */ }

        // v9.0: Workflow definitions — templates for multi-step processes
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS workflow_definitions (
                id TEXT PRIMARY KEY,
                plan_id TEXT,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                mermaid_source TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'draft',
                created_by TEXT NOT NULL DEFAULT 'system',
                version INTEGER NOT NULL DEFAULT 1,
                acceptance_criteria TEXT NOT NULL DEFAULT '',
                tags_json TEXT NOT NULL DEFAULT '[]',
                is_template INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_workflow_defs_plan ON workflow_definitions(plan_id)'); } catch { /* */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_workflow_defs_status ON workflow_definitions(status)'); } catch { /* */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_workflow_defs_template ON workflow_definitions(is_template)'); } catch { /* */ }

        // v9.0: Workflow steps — steps within workflow definitions
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS workflow_steps (
                id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                step_type TEXT NOT NULL DEFAULT 'agent_call',
                label TEXT NOT NULL DEFAULT '',
                agent_type TEXT,
                agent_prompt TEXT,
                condition_expression TEXT,
                tools_unlocked_json TEXT NOT NULL DEFAULT '[]',
                acceptance_criteria TEXT,
                max_retries INTEGER NOT NULL DEFAULT 3,
                retry_delay_ms INTEGER NOT NULL DEFAULT 1000,
                escalation_step_id TEXT,
                next_step_id TEXT,
                true_branch_step_id TEXT,
                false_branch_step_id TEXT,
                parallel_step_ids_json TEXT NOT NULL DEFAULT '[]',
                model_preference_json TEXT,
                x REAL NOT NULL DEFAULT 0,
                y REAL NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (workflow_id) REFERENCES workflow_definitions(id)
            )
        `);
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_workflow_steps_workflow ON workflow_steps(workflow_id)'); } catch { /* */ }

        // v9.0: Workflow executions — runtime state
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS workflow_executions (
                id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                ticket_id TEXT,
                task_id TEXT,
                current_step_id TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                step_results_json TEXT NOT NULL DEFAULT '{}',
                variables_json TEXT NOT NULL DEFAULT '{}',
                tokens_consumed INTEGER NOT NULL DEFAULT 0,
                started_at TEXT NOT NULL DEFAULT (datetime('now')),
                completed_at TEXT,
                FOREIGN KEY (workflow_id) REFERENCES workflow_definitions(id)
            )
        `);
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_workflow_exec_workflow ON workflow_executions(workflow_id)'); } catch { /* */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_workflow_exec_status ON workflow_executions(status)'); } catch { /* */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_workflow_exec_ticket ON workflow_executions(ticket_id)'); } catch { /* */ }

        // v9.0: Workflow step results — per-step execution results
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS workflow_step_results (
                id TEXT PRIMARY KEY,
                execution_id TEXT NOT NULL,
                step_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                agent_response TEXT,
                acceptance_check INTEGER,
                retries INTEGER NOT NULL DEFAULT 0,
                duration_ms INTEGER NOT NULL DEFAULT 0,
                tokens_used INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (execution_id) REFERENCES workflow_executions(id),
                FOREIGN KEY (step_id) REFERENCES workflow_steps(id)
            )
        `);
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_wf_step_results_exec ON workflow_step_results(execution_id)'); } catch { /* */ }

        // v9.0: Agent permission sets
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS agent_permission_sets (
                id TEXT PRIMARY KEY,
                agent_type TEXT NOT NULL,
                agent_instance_id TEXT,
                permissions_json TEXT NOT NULL DEFAULT '[]',
                allowed_tools_json TEXT NOT NULL DEFAULT '[]',
                blocked_tools_json TEXT NOT NULL DEFAULT '[]',
                can_spawn INTEGER NOT NULL DEFAULT 1,
                max_llm_calls INTEGER NOT NULL DEFAULT 100,
                max_time_minutes INTEGER NOT NULL DEFAULT 60,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_perm_sets_agent ON agent_permission_sets(agent_type)'); } catch { /* */ }

        // v9.0: User profiles — programming level, preferences, communication style
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS user_profiles (
                id TEXT PRIMARY KEY,
                programming_level TEXT NOT NULL DEFAULT 'good',
                strengths_json TEXT NOT NULL DEFAULT '[]',
                weaknesses_json TEXT NOT NULL DEFAULT '[]',
                known_areas_json TEXT NOT NULL DEFAULT '[]',
                unknown_areas_json TEXT NOT NULL DEFAULT '[]',
                area_preferences_json TEXT NOT NULL DEFAULT '{}',
                repeat_answers_json TEXT NOT NULL DEFAULT '{}',
                communication_style TEXT NOT NULL DEFAULT 'balanced',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);

        // v9.0: Agent conversations — per-level chats in the agent tree
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS agent_conversations (
                id TEXT PRIMARY KEY,
                tree_node_id TEXT NOT NULL,
                level INTEGER NOT NULL DEFAULT 0,
                parent_conversation_id TEXT,
                role TEXT NOT NULL DEFAULT 'user',
                content TEXT NOT NULL DEFAULT '',
                tokens_used INTEGER NOT NULL DEFAULT 0,
                question_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_agent_conv_node ON agent_conversations(tree_node_id)'); } catch { /* */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_agent_conv_question ON agent_conversations(question_id)'); } catch { /* */ }

        // v9.0: Escalation chains — question tracking as they bubble up the tree
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS escalation_chains (
                id TEXT PRIMARY KEY,
                tree_root_id TEXT NOT NULL,
                originating_node_id TEXT NOT NULL,
                current_node_id TEXT NOT NULL,
                question TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'escalating',
                answer TEXT,
                levels_traversed TEXT NOT NULL DEFAULT '[]',
                resolved_at_level INTEGER,
                ticket_id TEXT,
                context TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                resolved_at TEXT
            )
        `);
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_escalation_chains_status ON escalation_chains(status)'); } catch { /* */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_escalation_chains_root ON escalation_chains(tree_root_id)'); } catch { /* */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_escalation_chains_origin ON escalation_chains(originating_node_id)'); } catch { /* */ }

        // v9.0: Model assignments — agent-to-model mapping for multi-model routing
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS model_assignments (
                id TEXT PRIMARY KEY,
                agent_type TEXT NOT NULL,
                capability TEXT NOT NULL DEFAULT 'general',
                model_id TEXT NOT NULL,
                is_default INTEGER NOT NULL DEFAULT 0,
                priority INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_model_assign_agent ON model_assignments(agent_type)'); } catch { /* */ }
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_model_assign_cap ON model_assignments(capability)'); } catch { /* */ }

        // v9.0: MCP confirmations — confirmation stage before calling agents externally
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS mcp_confirmations (
                id TEXT PRIMARY KEY,
                tool_name TEXT NOT NULL,
                agent_name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                arguments_preview TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                expires_at TEXT NOT NULL,
                user_response TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
        try { this.db.exec('CREATE INDEX IF NOT EXISTS idx_mcp_confirm_status ON mcp_confirmations(status)'); } catch { /* */ }
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
            data.estimated_minutes ?? 30,
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
            INSERT INTO tickets (
                id, ticket_number, title, body, status, priority, creator, assignee, task_id,
                parent_ticket_id, auto_created, operation_type,
                acceptance_criteria, blocking_ticket_id, is_ghost, processing_agent,
                processing_status, deliverable_type, verification_result,
                source_page_ids, source_component_ids, retry_count, max_retries, stage,
                last_error, last_error_at,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            data.acceptance_criteria ?? null,
            data.blocking_ticket_id ?? null,
            data.is_ghost ? 1 : 0,
            data.processing_agent ?? null,
            data.processing_status ?? null,
            data.deliverable_type ?? null,
            data.verification_result ?? null,
            data.source_page_ids ?? null,
            data.source_component_ids ?? null,
            data.retry_count ?? 0,
            data.max_retries ?? 3,
            data.stage ?? null,
            data.last_error ?? null,
            data.last_error_at ?? null,
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

    /**
     * Get all tickets linked to a plan (via task_id → tasks.plan_id, or auto_created tickets with matching operation context).
     */
    getTicketsByPlanId(planId: string): Ticket[] {
        const rows = this.db.prepare(`
            SELECT t.* FROM tickets t
            LEFT JOIN tasks tk ON t.task_id = tk.id
            WHERE tk.plan_id = ?
               OR t.body LIKE '%' || ? || '%'
            ORDER BY t.priority ASC, t.created_at ASC
        `).all(planId, planId) as Record<string, unknown>[];
        return rows.map(r => this.rowToTicket(r));
    }

    /**
     * Get all tickets linked to a specific task.
     */
    getTicketsByTaskId(taskId: string): Ticket[] {
        const rows = this.db.prepare('SELECT * FROM tickets WHERE task_id = ? ORDER BY created_at ASC')
            .all(taskId) as Record<string, unknown>[];
        return rows.map(r => this.rowToTicket(r));
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
        if (updates.acceptance_criteria !== undefined) { fields.push('acceptance_criteria = ?'); values.push(updates.acceptance_criteria); }
        if (updates.blocking_ticket_id !== undefined) { fields.push('blocking_ticket_id = ?'); values.push(updates.blocking_ticket_id); }
        if (updates.is_ghost !== undefined) { fields.push('is_ghost = ?'); values.push(updates.is_ghost ? 1 : 0); }
        if (updates.processing_agent !== undefined) { fields.push('processing_agent = ?'); values.push(updates.processing_agent); }
        if (updates.processing_status !== undefined) { fields.push('processing_status = ?'); values.push(updates.processing_status); }
        if (updates.deliverable_type !== undefined) { fields.push('deliverable_type = ?'); values.push(updates.deliverable_type); }
        if (updates.verification_result !== undefined) { fields.push('verification_result = ?'); values.push(updates.verification_result); }
        if (updates.source_page_ids !== undefined) { fields.push('source_page_ids = ?'); values.push(updates.source_page_ids); }
        if (updates.source_component_ids !== undefined) { fields.push('source_component_ids = ?'); values.push(updates.source_component_ids); }
        if (updates.retry_count !== undefined) { fields.push('retry_count = ?'); values.push(updates.retry_count); }
        if (updates.max_retries !== undefined) { fields.push('max_retries = ?'); values.push(updates.max_retries); }
        if (updates.stage !== undefined) { fields.push('stage = ?'); values.push(updates.stage); }
        if (updates.last_error !== undefined) { fields.push('last_error = ?'); values.push(updates.last_error); }
        if (updates.last_error_at !== undefined) { fields.push('last_error_at = ?'); values.push(updates.last_error_at); }
        // v7.0: Team queue fields
        if (updates.assigned_queue !== undefined) { fields.push('assigned_queue = ?'); values.push(updates.assigned_queue); }
        if (updates.cancellation_reason !== undefined) { fields.push('cancellation_reason = ?'); values.push(updates.cancellation_reason); }

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
            acceptance_criteria: (row.acceptance_criteria as string | null) ?? null,
            blocking_ticket_id: (row.blocking_ticket_id as string | null) ?? null,
            is_ghost: !!(row.is_ghost as number),
            processing_agent: (row.processing_agent as string | null) ?? null,
            processing_status: (row.processing_status as string | null) as Ticket['processing_status'],
            deliverable_type: (row.deliverable_type as string | null) as Ticket['deliverable_type'],
            verification_result: (row.verification_result as string | null) ?? null,
            source_page_ids: (row.source_page_ids as string | null) ?? null,
            source_component_ids: (row.source_component_ids as string | null) ?? null,
            retry_count: (row.retry_count as number) ?? 0,
            max_retries: (row.max_retries as number) ?? 3,
            stage: (row.stage as number) ?? 1,
            last_error: (row.last_error as string | null) ?? null,
            last_error_at: (row.last_error_at as string | null) ?? null,
            // v7.0: Team queue fields
            assigned_queue: (row.assigned_queue as string | null) ?? null,
            cancellation_reason: (row.cancellation_reason as string | null) ?? null,
            created_at: row.created_at as string,
            updated_at: row.updated_at as string,
        };
    }

    // ==================== TICKET RUN LOGGING ====================

    createTicketRun(data: { ticket_id: string; agent_name: string; prompt_sent: string }): TicketRun {
        const id = this.genId();
        const now = new Date().toISOString();

        // Determine run number (next sequential for this ticket)
        const countRow = this.db.prepare(
            'SELECT COUNT(*) as cnt FROM ticket_runs WHERE ticket_id = ?'
        ).get(data.ticket_id) as { cnt: number };
        const runNumber = (countRow?.cnt ?? 0) + 1;

        this.db.prepare(`
            INSERT INTO ticket_runs (id, ticket_id, run_number, agent_name, status, prompt_sent, started_at)
            VALUES (?, ?, ?, ?, 'started', ?, ?)
        `).run(id, data.ticket_id, runNumber, data.agent_name, data.prompt_sent, now);

        return this.getTicketRun(id)!;
    }

    completeTicketRun(id: string, updates: {
        status: TicketRun['status'];
        response_received?: string;
        review_result?: string;
        verification_result?: string;
        error_message?: string;
        error_stack?: string;
        tokens_used?: number;
        duration_ms: number;
    }): TicketRun | null {
        const now = new Date().toISOString();
        this.db.prepare(`
            UPDATE ticket_runs SET
                status = ?, response_received = ?, review_result = ?,
                verification_result = ?, error_message = ?, error_stack = ?,
                tokens_used = ?, duration_ms = ?, completed_at = ?
            WHERE id = ?
        `).run(
            updates.status,
            updates.response_received ?? null,
            updates.review_result ?? null,
            updates.verification_result ?? null,
            updates.error_message ?? null,
            updates.error_stack ? updates.error_stack.substring(0, 2000) : null,
            updates.tokens_used ?? null,
            updates.duration_ms,
            now,
            id
        );
        return this.getTicketRun(id);
    }

    getTicketRun(id: string): TicketRun | null {
        const row = this.db.prepare('SELECT * FROM ticket_runs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        return row ? this.rowToTicketRun(row) : null;
    }

    getTicketRuns(ticketId: string): TicketRun[] {
        const rows = this.db.prepare(
            'SELECT * FROM ticket_runs WHERE ticket_id = ? ORDER BY run_number ASC'
        ).all(ticketId) as Record<string, unknown>[];
        return rows.map(r => this.rowToTicketRun(r));
    }

    getLatestTicketRun(ticketId: string): TicketRun | null {
        const row = this.db.prepare(
            'SELECT * FROM ticket_runs WHERE ticket_id = ? ORDER BY run_number DESC LIMIT 1'
        ).get(ticketId) as Record<string, unknown> | undefined;
        return row ? this.rowToTicketRun(row) : null;
    }

    private rowToTicketRun(row: Record<string, unknown>): TicketRun {
        return {
            id: row.id as string,
            ticket_id: row.ticket_id as string,
            run_number: row.run_number as number,
            agent_name: row.agent_name as string,
            status: row.status as TicketRun['status'],
            prompt_sent: row.prompt_sent as string,
            response_received: (row.response_received as string) ?? null,
            review_result: (row.review_result as string) ?? null,
            verification_result: (row.verification_result as string) ?? null,
            error_message: (row.error_message as string) ?? null,
            error_stack: (row.error_stack as string) ?? null,
            tokens_used: (row.tokens_used as number) ?? null,
            duration_ms: (row.duration_ms as number) ?? 0,
            started_at: row.started_at as string,
            completed_at: (row.completed_at as string) ?? null,
        };
    }

    // ==================== TICKET RUN STEPS (v5.0) ====================

    /**
     * Create a step entry within a ticket run.
     * Called as each agent in the pipeline starts working.
     */
    createRunStep(data: { run_id: string; step_number: number; agent_name: string; deliverable_type?: string }): { id: string; step_number: number } {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO ticket_run_steps (id, run_id, step_number, agent_name, deliverable_type, status, started_at)
            VALUES (?, ?, ?, ?, ?, 'started', ?)
        `).run(id, data.run_id, data.step_number, data.agent_name, data.deliverable_type ?? null, now);
        return { id, step_number: data.step_number };
    }

    /**
     * Complete a run step with response and timing data.
     */
    completeRunStep(id: string, updates: { status: string; response?: string; tokens_used?: number; duration_ms: number }): void {
        const now = new Date().toISOString();
        this.db.prepare(`
            UPDATE ticket_run_steps SET status = ?, response = ?, tokens_used = ?, duration_ms = ?, completed_at = ?
            WHERE id = ?
        `).run(updates.status, updates.response ?? null, updates.tokens_used ?? null, updates.duration_ms, now, id);
    }

    /**
     * Get all steps for a run, ordered by step number.
     */
    getRunSteps(runId: string): Array<{
        id: string; run_id: string; step_number: number; agent_name: string;
        deliverable_type: string | null; status: string; response: string | null;
        tokens_used: number | null; duration_ms: number; started_at: string; completed_at: string | null;
    }> {
        const rows = this.db.prepare(
            'SELECT * FROM ticket_run_steps WHERE run_id = ? ORDER BY step_number ASC'
        ).all(runId) as Record<string, unknown>[];
        return rows.map(r => ({
            id: r.id as string,
            run_id: r.run_id as string,
            step_number: r.step_number as number,
            agent_name: r.agent_name as string,
            deliverable_type: (r.deliverable_type as string) ?? null,
            status: r.status as string,
            response: (r.response as string) ?? null,
            tokens_used: (r.tokens_used as number) ?? null,
            duration_ms: (r.duration_ms as number) ?? 0,
            started_at: r.started_at as string,
            completed_at: (r.completed_at as string) ?? null,
        }));
    }

    // ==================== TRANSACTION HELPER ====================

    /**
     * Run a function inside a database transaction.
     * If fn throws, the transaction is rolled back.
     */
    runTransaction<T>(fn: () => T): T {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = fn();
            this.db.exec('COMMIT');
            return result;
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    // ==================== TASK LOCKING ====================

    /**
     * Atomically claim the next ready task.
     * Uses BEGIN IMMEDIATE to prevent two callers from claiming the same task.
     * Returns the claimed task (now InProgress) or null if no ready tasks.
     */
    claimNextReadyTask(planId?: string): Task | null {
        return this.runTransaction(() => {
            let row: Record<string, unknown> | undefined;
            if (planId) {
                row = this.db.prepare(`
                    SELECT * FROM tasks
                    WHERE status = 'not_started' AND plan_id = ?
                    ORDER BY
                        CASE priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END,
                        sort_order ASC
                    LIMIT 1
                `).get(planId) as Record<string, unknown> | undefined;
            } else {
                row = this.db.prepare(`
                    SELECT * FROM tasks
                    WHERE status = 'not_started'
                    ORDER BY
                        CASE priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END,
                        sort_order ASC
                    LIMIT 1
                `).get() as Record<string, unknown> | undefined;
            }
            if (!row) return null;

            const taskId = row.id as string;
            this.db.prepare(
                "UPDATE tasks SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?"
            ).run(taskId);

            return this.getTask(taskId);
        });
    }

    // ==================== SUGGESTION APPROVAL HELPERS ====================

    /**
     * Approve a suggestion — marks it accepted with timestamp.
     */
    approveSuggestion(id: string): AISuggestion | null {
        const now = new Date().toISOString();
        return this.updateAISuggestion(id, {
            status: 'accepted',
            approved_at: now,
        });
    }

    /**
     * Reject a suggestion — marks it rejected with timestamp and optional reason.
     */
    rejectSuggestion(id: string, reason?: string): AISuggestion | null {
        const now = new Date().toISOString();
        return this.updateAISuggestion(id, {
            status: 'rejected',
            rejected_at: now,
            rejection_reason: reason ?? null,
        });
    }

    /**
     * Get suggestions by target entity.
     */
    getSuggestionsByTarget(targetType: string, targetId: string): AISuggestion[] {
        const rows = this.db.prepare(
            'SELECT * FROM ai_suggestions WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC'
        ).all(targetType, targetId) as Record<string, unknown>[];
        return rows.map(r => this.rowToAISuggestion(r));
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

    // ==================== GHOST TICKETS (B6) ====================

    /**
     * Creates a Ghost Ticket for user-blocking questions.
     * Links a P1 ghost ticket to the original ticket and creates an ai_questions entry.
     */
    createGhostTicket(
        originalTicketId: string,
        question: string,
        context: string,
        navigateTo: string,
        planId: string,
        technicalContext?: string
    ): { ghostTicket: Ticket; ghostQuestion: AIQuestion } {
        const originalTicket = this.getTicket(originalTicketId);

        // Create ghost ticket linked to original
        const ghostTicket = this.createTicket({
            title: `Ghost: ${originalTicket?.title || 'Blocked task'}`,
            body: `**Blocking Question**\n\n${question}\n\n**Context**: ${context}`,
            priority: TicketPriority.P1,
            creator: 'system',
            parent_ticket_id: originalTicketId,
            auto_created: true,
            operation_type: 'ghost_ticket',
            is_ghost: true,
            deliverable_type: 'communication',
            stage: originalTicket?.stage,
        });

        // Mark original as blocked
        if (originalTicket) {
            this.updateTicket(originalTicketId, {
                status: TicketStatus.Open, // stays open but marked blocked
                blocking_ticket_id: ghostTicket.id,
                processing_status: 'awaiting_user',
            });
        }

        // Create linked question in the user queue
        const ghostQuestion = this.createAIQuestion({
            plan_id: planId,
            component_id: null,
            page_id: null,
            category: 'general' as any,
            question,
            question_type: 'text',
            options: [],
            ai_reasoning: context,
            ai_suggested_answer: null,
            user_answer: null,
            status: 'pending' as any,
            ticket_id: ghostTicket.id,
            source_agent: originalTicket?.processing_agent ?? 'system',
            source_ticket_id: originalTicketId,
            navigate_to: navigateTo,
            is_ghost: true,
            queue_priority: 1,
            technical_context: technicalContext ?? null,
        });

        return { ghostTicket, ghostQuestion };
    }

    /**
     * Resolves a ghost ticket and unblocks the original ticket.
     */
    resolveGhostTicket(ghostTicketId: string): Ticket | null {
        const ghost = this.getTicket(ghostTicketId);
        if (!ghost || !ghost.is_ghost) return null;

        // Resolve the ghost
        this.updateTicket(ghostTicketId, { status: TicketStatus.Resolved });

        // Unblock the original (parent)
        if (ghost.parent_ticket_id) {
            this.updateTicket(ghost.parent_ticket_id, {
                blocking_ticket_id: undefined,
                processing_status: 'queued',
            });
            return this.getTicket(ghost.parent_ticket_id);
        }
        return ghost;
    }

    // ==================== USER DECISIONS (E5) ====================

    createUserDecision(data: {
        plan_id: string;
        category: string;
        topic: string;
        decision: string;
        question_id?: string;
        ticket_id?: string;
        context?: string;
        affected_entities?: string;
    }): Record<string, unknown> {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO user_decisions (id, plan_id, category, topic, decision, question_id, ticket_id, context, affected_entities, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, data.plan_id, data.category, data.topic, data.decision,
            data.question_id ?? null, data.ticket_id ?? null,
            data.context ?? null, data.affected_entities ?? null, now, now);
        return this.db.prepare('SELECT * FROM user_decisions WHERE id = ?').get(id) as Record<string, unknown>;
    }

    getActiveDecisions(planId: string, category?: string, topic?: string): Record<string, unknown>[] {
        let sql = 'SELECT * FROM user_decisions WHERE plan_id = ? AND is_active = 1';
        const params: unknown[] = [planId];
        if (category) { sql += ' AND category = ?'; params.push(category); }
        if (topic) { sql += ' AND topic = ?'; params.push(topic); }
        sql += ' ORDER BY created_at DESC';
        return this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    }

    supersedeDecision(decisionId: string, newDecisionId: string): void {
        const now = new Date().toISOString();
        this.db.prepare('UPDATE user_decisions SET is_active = 0, superseded_by = ?, updated_at = ? WHERE id = ?')
            .run(newDecisionId, now, decisionId);
    }

    getDecisionsByTopic(planId: string, topic: string): Record<string, unknown>[] {
        return this.db.prepare(
            'SELECT * FROM user_decisions WHERE plan_id = ? AND topic LIKE ? AND is_active = 1 ORDER BY created_at DESC'
        ).all(planId, `%${topic}%`) as Record<string, unknown>[];
    }

    // ==================== PLAN PHASE (F1) ====================

    updatePlanPhase(planId: string, phase: string): void {
        const now = new Date().toISOString();
        this.db.prepare('UPDATE plans SET current_phase = ?, phase_started_at = ?, updated_at = ? WHERE id = ?')
            .run(phase, now, now, planId);
    }

    getPlanPhase(planId: string): { phase: string; stage: number; startedAt: string | null; version: number } | null {
        const row = this.db.prepare('SELECT current_phase, phase_started_at, current_version FROM plans WHERE id = ?')
            .get(planId) as Record<string, unknown> | undefined;
        if (!row) return null;
        const phase = (row.current_phase as string) || 'planning';
        const stageMap: Record<string, number> = {
            planning: 1, designing: 1, design_review: 1, task_generation: 1,
            coding: 2, design_update: 2, verification: 3, complete: 3,
        };
        return {
            phase,
            stage: stageMap[phase] ?? 1,
            startedAt: (row.phase_started_at as string) ?? null,
            version: (row.current_version as number) ?? 1,
        };
    }

    approvePlanDesign(planId: string): void {
        const now = new Date().toISOString();
        this.db.prepare('UPDATE plans SET design_approved_at = ?, updated_at = ? WHERE id = ?')
            .run(now, now, planId);
    }

    // ==================== CONVERSATIONS ====================

    addConversation(agent: string, role: ConversationRole, content: string, taskId?: string, ticketId?: string, tokensUsed?: number): Conversation {
        const id = this.genId();
        this.db.prepare(`
            INSERT INTO conversations (id, agent, role, content, task_id, ticket_id, tokens_used, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(id, agent, role, content, taskId || null, ticketId || null, tokensUsed ?? null);
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
        // Remove tasks and plan files associated with this plan
        this.db.prepare('DELETE FROM tasks WHERE plan_id = ?').run(id);
        this.db.prepare('DELETE FROM plan_file_changes WHERE plan_id = ?').run(id);
        this.db.prepare('DELETE FROM plan_files WHERE plan_id = ?').run(id);
        this.db.prepare('DELETE FROM plan_file_folders WHERE plan_id = ?').run(id);
        this.db.prepare('DELETE FROM plans WHERE id = ?').run(id);
        return true;
    }

    // ==================== PLAN FILES (v5.0) ====================

    addPlanFile(data: {
        plan_id: string; filename: string; file_type?: string; content: string;
        summary?: string; category?: string; source_path?: string; is_linked?: boolean;
    }): Record<string, unknown> {
        const id = this.genId();
        const maxOrder = this.db.prepare(
            'SELECT COALESCE(MAX(upload_order), 0) as max_order FROM plan_files WHERE plan_id = ?'
        ).get(data.plan_id) as Record<string, unknown> | undefined;
        const order = ((maxOrder?.max_order as number) ?? 0) + 1;
        const contentHash = crypto.createHash('sha256').update(data.content || '').digest('hex').substring(0, 16);
        this.db.prepare(`
            INSERT INTO plan_files (id, plan_id, filename, file_type, content, summary, category, upload_order, version, content_hash, source_path, is_linked, last_synced_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
        `).run(
            id, data.plan_id, data.filename, data.file_type || 'text', data.content,
            data.summary || null, data.category || 'general', order, contentHash,
            data.source_path || null, data.is_linked ? 1 : 0
        );
        return this.getPlanFile(id)!;
    }

    getPlanFile(id: string): Record<string, unknown> | null {
        return this.db.prepare('SELECT * FROM plan_files WHERE id = ?').get(id) as Record<string, unknown> | undefined || null;
    }

    getPlanFiles(planId: string): Record<string, unknown>[] {
        return this.db.prepare(
            'SELECT * FROM plan_files WHERE plan_id = ? AND is_active = 1 ORDER BY upload_order ASC'
        ).all(planId) as Record<string, unknown>[];
    }

    getAllPlanFiles(planId: string): Record<string, unknown>[] {
        return this.db.prepare(
            'SELECT * FROM plan_files WHERE plan_id = ? ORDER BY upload_order ASC'
        ).all(planId) as Record<string, unknown>[];
    }

    updatePlanFile(id: string, updates: Record<string, unknown>): Record<string, unknown> | null {
        const allowed = ['filename', 'content', 'summary', 'category', 'is_active', 'source_path', 'is_linked'];
        const fields: string[] = [];
        const values: unknown[] = [];
        const existing = this.getPlanFile(id);

        for (const key of allowed) {
            if (updates[key] !== undefined) {
                fields.push(`${key} = ?`);
                values.push(updates[key]);
            }
        }

        // If content changed, bump version and update hash
        if (updates.content !== undefined && existing) {
            const newHash = crypto.createHash('sha256').update(String(updates.content)).digest('hex').substring(0, 16);
            const oldHash = String(existing.content_hash || '');
            if (newHash !== oldHash) {
                const newVersion = ((existing.version as number) ?? 1) + 1;
                fields.push('version = ?');
                values.push(newVersion);
                fields.push('content_hash = ?');
                values.push(newHash);
                // Record the change for tracking
                this.recordPlanFileChange(id, String(existing.plan_id), newVersion, 'update', oldHash, newHash);
            }
        }

        if (fields.length > 0) {
            fields.push("updated_at = datetime('now')");
            values.push(id);
            this.db.prepare(`UPDATE plan_files SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        }
        return this.getPlanFile(id);
    }

    /**
     * Record a change to a plan file for version history tracking.
     * Also finds affected tickets and marks them for potential reprocessing.
     */
    recordPlanFileChange(planFileId: string, planId: string, version: number, changeType: string, previousHash: string, newHash: string, diffSummary?: string): void {
        const changeId = this.genId();
        // Find tickets that may be affected — tickets linked to tasks in this plan that aren't completed
        const affectedTickets = this.db.prepare(
            `SELECT t.id FROM tickets t INNER JOIN tasks tk ON t.task_id = tk.id WHERE tk.plan_id = ? AND t.status NOT IN ('completed', 'cancelled', 'archived', 'failed')`
        ).all(planId) as Array<{ id: string }>;
        const affectedIds = affectedTickets.map(t => t.id);

        this.db.prepare(`
            INSERT INTO plan_file_changes (id, plan_file_id, plan_id, version, change_type, previous_hash, new_hash, diff_summary, affected_ticket_ids, reprocessing_triggered, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
        `).run(changeId, planFileId, planId, version, changeType, previousHash, newHash, diffSummary || null, JSON.stringify(affectedIds));
    }

    /**
     * Get recent plan file changes for a plan, optionally filtered by file.
     */
    getPlanFileChanges(planId: string, limit: number = 20): Record<string, unknown>[] {
        return this.db.prepare(
            'SELECT pfc.*, pf.filename FROM plan_file_changes pfc LEFT JOIN plan_files pf ON pfc.plan_file_id = pf.id WHERE pfc.plan_id = ? ORDER BY pfc.created_at DESC LIMIT ?'
        ).all(planId, limit) as Record<string, unknown>[];
    }

    /**
     * Mark a plan file change as having triggered reprocessing.
     */
    markChangeReprocessed(changeId: string): void {
        this.db.prepare('UPDATE plan_file_changes SET reprocessing_triggered = 1 WHERE id = ?').run(changeId);
    }

    // ==================== PLAN FILE FOLDERS (v5.0) ====================

    addPlanFileFolder(planId: string, folderPath: string, filePatterns?: string): Record<string, unknown> {
        const id = this.genId();
        this.db.prepare(`
            INSERT INTO plan_file_folders (id, plan_id, folder_path, file_patterns, is_active, created_at)
            VALUES (?, ?, ?, ?, 1, datetime('now'))
        `).run(id, planId, folderPath, filePatterns || '*.md,*.txt,*.doc,*.docx');
        return this.db.prepare('SELECT * FROM plan_file_folders WHERE id = ?').get(id) as Record<string, unknown>;
    }

    getPlanFileFolders(planId: string): Record<string, unknown>[] {
        return this.db.prepare(
            'SELECT * FROM plan_file_folders WHERE plan_id = ? AND is_active = 1 ORDER BY created_at ASC'
        ).all(planId) as Record<string, unknown>[];
    }

    removePlanFileFolder(folderId: string): boolean {
        const result = this.db.prepare('UPDATE plan_file_folders SET is_active = 0 WHERE id = ?').run(folderId);
        return (result as unknown as { changes: number }).changes > 0;
    }

    updateFolderScanTime(folderId: string): void {
        this.db.prepare("UPDATE plan_file_folders SET last_scanned_at = datetime('now') WHERE id = ?").run(folderId);
    }

    deletePlanFile(id: string): boolean {
        const result = this.db.prepare('DELETE FROM plan_files WHERE id = ?').run(id);
        return (result as unknown as { changes: number }).changes > 0;
    }

    /**
     * v5.0: Get combined plan file content for agent context.
     * Returns a formatted string with all active plan file contents,
     * used by agents to check for conflicts and ensure alignment.
     */
    getPlanFileContext(planId: string): string {
        const files = this.getPlanFiles(planId);
        if (files.length === 0) return '';
        return files.map((f, i) => {
            return `--- Plan File ${i + 1}: ${f.filename} (${f.category}) ---\n${f.content}`;
        }).join('\n\n');
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
            is_draft: !!(row.is_draft as number),
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

    // ==================== ELEMENT STATUS ====================

    getOrCreateElementStatus(elementId: string, elementType: 'component' | 'page', planId: string): ElementStatus {
        const existing = this.db.prepare(
            'SELECT * FROM element_status WHERE element_id = ? AND element_type = ? AND plan_id = ?'
        ).get(elementId, elementType, planId) as Record<string, unknown> | undefined;
        if (existing) return this.rowToElementStatus(existing);
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO element_status (id, element_id, element_type, plan_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, elementId, elementType, planId, now, now);
        return this.rowToElementStatus(
            this.db.prepare('SELECT * FROM element_status WHERE id = ?').get(id) as Record<string, unknown>
        );
    }

    getElementStatusByPlan(planId: string): ElementStatus[] {
        const rows = this.db.prepare(
            'SELECT * FROM element_status WHERE plan_id = ? ORDER BY element_type, created_at'
        ).all(planId) as Record<string, unknown>[];
        return rows.map(r => this.rowToElementStatus(r));
    }

    getElementStatus(elementId: string, elementType: string, planId: string): ElementStatus | null {
        const row = this.db.prepare(
            'SELECT * FROM element_status WHERE element_id = ? AND element_type = ? AND plan_id = ?'
        ).get(elementId, elementType, planId) as Record<string, unknown> | undefined;
        return row ? this.rowToElementStatus(row) : null;
    }

    updateElementStatus(elementId: string, elementType: string, planId: string, updates: Partial<ElementStatus>): ElementStatus {
        const status = this.getOrCreateElementStatus(elementId, elementType as 'component' | 'page', planId);
        const fields: string[] = [];
        const values: unknown[] = [];
        if (updates.implementation_status !== undefined) { fields.push('implementation_status = ?'); values.push(updates.implementation_status); }
        if (updates.lifecycle_stage !== undefined) { fields.push('lifecycle_stage = ?'); values.push(updates.lifecycle_stage); }
        if (updates.readiness_pct !== undefined) { fields.push('readiness_pct = ?'); values.push(updates.readiness_pct); }
        if (updates.readiness_level !== undefined) { fields.push('readiness_level = ?'); values.push(updates.readiness_level); }
        if (updates.mode_status !== undefined) { fields.push('mode_status = ?'); values.push(JSON.stringify(updates.mode_status)); }
        if (updates.checklist !== undefined) { fields.push('checklist = ?'); values.push(JSON.stringify(updates.checklist)); }
        if (updates.notes !== undefined) { fields.push('notes = ?'); values.push(updates.notes); }
        if (fields.length === 0) return status;
        fields.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(status.id);
        this.db.prepare(`UPDATE element_status SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return this.rowToElementStatus(
            this.db.prepare('SELECT * FROM element_status WHERE id = ?').get(status.id) as Record<string, unknown>
        );
    }

    deleteElementStatus(elementId: string, elementType: string, planId: string): void {
        this.db.prepare(
            'DELETE FROM element_status WHERE element_id = ? AND element_type = ? AND plan_id = ?'
        ).run(elementId, elementType, planId);
    }

    /** Calculate readiness for a page based on its elements' statuses */
    calculatePageReadiness(pageId: string, planId: string): { readiness_pct: number; readiness_level: ReadinessLevel } {
        // Get page's own status
        const pageStatus = this.getElementStatus(pageId, 'page', planId);
        // Get all components on this page
        const components = this.db.prepare(
            'SELECT id FROM design_components WHERE page_id = ? AND plan_id = ?'
        ).all(pageId, planId) as Array<{ id: string }>;

        if (components.length === 0) {
            // Page with no components — use page-level status only
            const pct = pageStatus ? this.statusToPct(pageStatus.implementation_status) : 0;
            return { readiness_pct: pct, readiness_level: this.pctToLevel(pct) };
        }

        // Average the readiness of page + all its components
        let totalPct = pageStatus ? this.statusToPct(pageStatus.implementation_status) : 0;
        let count = 1; // count page itself
        for (const comp of components) {
            const compStatus = this.getElementStatus(comp.id, 'component', planId);
            totalPct += compStatus ? this.statusToPct(compStatus.implementation_status) : 0;
            count++;
        }
        const pct = Math.round(totalPct / count);
        return { readiness_pct: pct, readiness_level: this.pctToLevel(pct) };
    }

    private statusToPct(status: ImplementationStatus): number {
        const map: Record<ImplementationStatus, number> = {
            'not_started': 0, 'planned': 20, 'in_progress': 50, 'implemented': 75, 'verified': 100, 'has_issues': 30
        };
        return map[status] ?? 0;
    }

    private pctToLevel(pct: number): ReadinessLevel {
        if (pct >= 90) return 'ready';
        if (pct >= 60) return 'almost_ready';
        if (pct >= 30) return 'needs_work';
        return 'not_ready';
    }

    private rowToElementStatus(row: Record<string, unknown>): ElementStatus {
        let modeStatus: Record<PlanMode, ImplementationStatus>;
        try { modeStatus = JSON.parse(row.mode_status as string || '{}'); }
        catch { modeStatus = {} as Record<PlanMode, ImplementationStatus>; }
        let checklist: Array<{ item: string; done: boolean; mode: PlanMode }>;
        try { checklist = JSON.parse(row.checklist as string || '[]'); }
        catch { checklist = []; }
        return {
            id: row.id as string,
            element_id: row.element_id as string,
            element_type: row.element_type as ElementStatus['element_type'],
            plan_id: row.plan_id as string,
            implementation_status: (row.implementation_status as ImplementationStatus) || 'not_started',
            lifecycle_stage: (row.lifecycle_stage as LifecycleStage) || 'design',
            readiness_pct: (row.readiness_pct as number) ?? 0,
            readiness_level: (row.readiness_level as ReadinessLevel) || 'not_ready',
            mode_status: modeStatus,
            checklist,
            notes: (row.notes as string) || '',
            created_at: row.created_at as string,
            updated_at: row.updated_at as string,
        };
    }

    // ==================== AI SUGGESTIONS ====================

    createAISuggestion(data: Omit<AISuggestion, 'id' | 'created_at' | 'updated_at'>): AISuggestion {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO ai_suggestions (
                id, plan_id, component_id, page_id, type, title, description, reasoning, goal,
                source_agent, target_type, target_id, current_value, suggested_value,
                action_type, action_payload, priority, status, ticket_id,
                approved_at, rejected_at, rejection_reason,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, data.plan_id, data.component_id ?? null, data.page_id ?? null,
            data.type || 'general', data.title, data.description, data.reasoning || '', data.goal || '',
            data.source_agent ?? null, data.target_type ?? null, data.target_id ?? null,
            data.current_value ?? null, data.suggested_value ?? null,
            data.action_type ?? null, JSON.stringify(data.action_payload || {}),
            data.priority || 'P2', data.status || 'pending', data.ticket_id ?? null,
            data.approved_at ?? null, data.rejected_at ?? null, data.rejection_reason ?? null,
            now, now
        );
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
        if (updates.goal !== undefined) { fields.push('goal = ?'); values.push(updates.goal); }
        if (updates.source_agent !== undefined) { fields.push('source_agent = ?'); values.push(updates.source_agent); }
        if (updates.target_type !== undefined) { fields.push('target_type = ?'); values.push(updates.target_type); }
        if (updates.target_id !== undefined) { fields.push('target_id = ?'); values.push(updates.target_id); }
        if (updates.current_value !== undefined) { fields.push('current_value = ?'); values.push(updates.current_value); }
        if (updates.suggested_value !== undefined) { fields.push('suggested_value = ?'); values.push(updates.suggested_value); }
        if (updates.action_type !== undefined) { fields.push('action_type = ?'); values.push(updates.action_type); }
        if (updates.action_payload !== undefined) { fields.push('action_payload = ?'); values.push(JSON.stringify(updates.action_payload)); }
        if (updates.priority !== undefined) { fields.push('priority = ?'); values.push(updates.priority); }
        if (updates.ticket_id !== undefined) { fields.push('ticket_id = ?'); values.push(updates.ticket_id); }
        if (updates.approved_at !== undefined) { fields.push('approved_at = ?'); values.push(updates.approved_at); }
        if (updates.rejected_at !== undefined) { fields.push('rejected_at = ?'); values.push(updates.rejected_at); }
        if (updates.rejection_reason !== undefined) { fields.push('rejection_reason = ?'); values.push(updates.rejection_reason); }
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
            reasoning: (row.reasoning as string) ?? '',
            goal: (row.goal as string) ?? '',
            source_agent: (row.source_agent as string) ?? null,
            target_type: (row.target_type as AISuggestion['target_type']) ?? null,
            target_id: (row.target_id as string) ?? null,
            current_value: (row.current_value as string) ?? null,
            suggested_value: (row.suggested_value as string) ?? null,
            action_type: (row.action_type as AISuggestion['action_type']) ?? null,
            action_payload: JSON.parse((row.action_payload as string) || '{}'),
            priority: row.priority as AISuggestion['priority'],
            status: row.status as AISuggestion['status'],
            ticket_id: (row.ticket_id as string) ?? null,
            approved_at: (row.approved_at as string) ?? null,
            rejected_at: (row.rejected_at as string) ?? null,
            rejection_reason: (row.rejection_reason as string) ?? null,
            created_at: row.created_at as string,
            updated_at: row.updated_at as string,
        };
    }

    // ==================== AI QUESTIONS ====================

    createAIQuestion(data: Omit<AIQuestion, 'id' | 'created_at' | 'updated_at'>): AIQuestion {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO ai_questions (
                id, plan_id, component_id, page_id, category, question, question_type, options,
                ai_reasoning, ai_suggested_answer, user_answer, status, ticket_id,
                source_agent, source_ticket_id, navigate_to, is_ghost, queue_priority,
                answered_at, ai_continued, dismiss_count, previous_decision_id,
                conflict_decision_id, technical_context, friendly_message,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, data.plan_id, data.component_id ?? null, data.page_id ?? null,
            data.category || 'general', data.question, data.question_type || 'text',
            JSON.stringify(data.options || []), data.ai_reasoning || '',
            data.ai_suggested_answer ?? null, data.user_answer ?? null,
            data.status || 'pending', data.ticket_id ?? null,
            data.source_agent ?? null, data.source_ticket_id ?? null,
            data.navigate_to ?? null, data.is_ghost ? 1 : 0, data.queue_priority ?? 2,
            data.answered_at ?? null, data.ai_continued ? 1 : 0, data.dismiss_count ?? 0,
            data.previous_decision_id ?? null, data.conflict_decision_id ?? null,
            data.technical_context ?? null, data.friendly_message ?? null,
            now, now
        );
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

    /** v5.0: Get ALL pending AI questions across all plans — for the global feedback button */
    getAllPendingAIQuestions(): AIQuestion[] {
        const rows = this.db.prepare(
            'SELECT * FROM ai_questions WHERE status = ? ORDER BY queue_priority ASC, created_at ASC'
        ).all('pending') as Record<string, unknown>[];
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
        if (updates.friendly_message !== undefined) { fields.push('friendly_message = ?'); values.push(updates.friendly_message); }
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
            // v4.0 fields
            source_agent: (row.source_agent as string) ?? null,
            source_ticket_id: (row.source_ticket_id as string) ?? null,
            navigate_to: (row.navigate_to as string) ?? null,
            is_ghost: Boolean(row.is_ghost),
            queue_priority: (row.queue_priority as number) ?? 2,
            answered_at: (row.answered_at as string) ?? null,
            ai_continued: Boolean(row.ai_continued),
            dismiss_count: (row.dismiss_count as number) ?? 0,
            previous_decision_id: (row.previous_decision_id as string) ?? null,
            conflict_decision_id: (row.conflict_decision_id as string) ?? null,
            technical_context: (row.technical_context as string) ?? null,
            friendly_message: (row.friendly_message as string) ?? null,
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

    // ==================== TASK ASSIGNMENTS (v7.0) ====================

    createTaskAssignment(data: {
        source_ticket_id?: string | null;
        target_agent: string;
        target_queue?: string | null;
        requester: string;
        task_message: string;
        success_criteria?: string;
        priority?: string;
        timeout_ms?: number;
    }): { id: string; status: string; created_at: string } {
        const id = this.genId();
        this.db.prepare(`
            INSERT INTO task_assignments (id, source_ticket_id, target_agent, target_queue, requester, task_message, success_criteria, priority, timeout_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            data.source_ticket_id ?? null,
            data.target_agent,
            data.target_queue ?? null,
            data.requester,
            data.task_message,
            data.success_criteria ?? '[]',
            data.priority ?? 'P2',
            data.timeout_ms ?? 300000
        );
        return this.db.prepare('SELECT id, status, created_at FROM task_assignments WHERE id = ?').get(id) as { id: string; status: string; created_at: string };
    }

    getTaskAssignment(id: string): Record<string, unknown> | null {
        return (this.db.prepare('SELECT * FROM task_assignments WHERE id = ?').get(id) as Record<string, unknown>) ?? null;
    }

    updateTaskAssignment(id: string, updates: Record<string, unknown>): void {
        const fields: string[] = [];
        const values: unknown[] = [];
        for (const [key, val] of Object.entries(updates)) {
            if (key === 'id') continue;
            fields.push(`${key} = ?`);
            values.push(val);
        }
        if (fields.length === 0) return;
        values.push(id);
        this.db.prepare(`UPDATE task_assignments SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    getAssignmentsByQueue(queue: string, status?: string): Record<string, unknown>[] {
        if (status) {
            return this.db.prepare('SELECT * FROM task_assignments WHERE target_queue = ? AND status = ? ORDER BY created_at DESC')
                .all(queue, status) as Record<string, unknown>[];
        }
        return this.db.prepare('SELECT * FROM task_assignments WHERE target_queue = ? ORDER BY created_at DESC')
            .all(queue) as Record<string, unknown>[];
    }

    getAssignmentsByTicket(ticketId: string): Record<string, unknown>[] {
        return this.db.prepare('SELECT * FROM task_assignments WHERE source_ticket_id = ? ORDER BY created_at DESC')
            .all(ticketId) as Record<string, unknown>[];
    }

    // ==================== SUPPORT DOCUMENTS (v7.0) ====================

    createSupportDocument(data: {
        plan_id?: string | null;
        folder_name: string;
        document_name: string;
        content: string;
        summary?: string | null;
        category?: string;
        source_ticket_id?: string | null;
        source_agent?: string | null;
        tags?: string[];
        relevance_score?: number;
        source_type?: 'user' | 'system';
        is_locked?: number;
    }): { id: string; folder_name: string; document_name: string; created_at: string } {
        const id = this.genId();
        this.db.prepare(`
            INSERT INTO support_documents (id, plan_id, folder_name, document_name, content, summary, category, source_ticket_id, source_agent, tags, relevance_score, source_type, is_locked)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            data.plan_id ?? null,
            data.folder_name,
            data.document_name,
            data.content,
            data.summary ?? null,
            data.category ?? 'reference',
            data.source_ticket_id ?? null,
            data.source_agent ?? null,
            JSON.stringify(data.tags ?? []),
            data.relevance_score ?? 50,
            data.source_type ?? 'system',
            data.is_locked ?? 0
        );
        return this.db.prepare('SELECT id, folder_name, document_name, created_at FROM support_documents WHERE id = ?').get(id) as { id: string; folder_name: string; document_name: string; created_at: string };
    }

    getSupportDocument(id: string): Record<string, unknown> | null {
        return (this.db.prepare('SELECT * FROM support_documents WHERE id = ?').get(id) as Record<string, unknown>) ?? null;
    }

    updateSupportDocument(id: string, updates: Record<string, unknown>): void {
        const fields: string[] = [];
        const values: unknown[] = [];
        for (const [key, val] of Object.entries(updates)) {
            if (key === 'id' || key === 'created_at') continue;
            fields.push(`${key} = ?`);
            values.push(key === 'tags' && Array.isArray(val) ? JSON.stringify(val) : val);
        }
        if (fields.length === 0) return;
        fields.push("updated_at = datetime('now')");
        values.push(id);
        this.db.prepare(`UPDATE support_documents SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    deleteSupportDocument(id: string): boolean {
        const result = this.db.prepare('DELETE FROM support_documents WHERE id = ?').run(id);
        return (result as { changes: number }).changes > 0;
    }

    searchSupportDocuments(query: {
        folder_name?: string;
        keyword?: string;
        category?: string;
        plan_id?: string;
        tags?: string[];
    }): Record<string, unknown>[] {
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (query.folder_name) { conditions.push('folder_name = ?'); params.push(query.folder_name); }
        if (query.category) { conditions.push('category = ?'); params.push(query.category); }
        if (query.plan_id) { conditions.push('plan_id = ?'); params.push(query.plan_id); }
        if (query.keyword) {
            conditions.push('(content LIKE ? OR summary LIKE ? OR document_name LIKE ?)');
            const kw = `%${query.keyword}%`;
            params.push(kw, kw, kw);
        }
        if (query.tags && query.tags.length > 0) {
            const tagConditions = query.tags.map(() => 'tags LIKE ?');
            conditions.push(`(${tagConditions.join(' OR ')})`);
            for (const tag of query.tags) {
                params.push(`%${tag}%`);
            }
        }
        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        return this.db.prepare(`SELECT * FROM support_documents ${where} ORDER BY relevance_score DESC, updated_at DESC`).all(...params) as Record<string, unknown>[];
    }

    getSupportDocumentsByFolder(folderName: string): Record<string, unknown>[] {
        return this.db.prepare('SELECT * FROM support_documents WHERE folder_name = ? ORDER BY updated_at DESC').all(folderName) as Record<string, unknown>[];
    }

    listDocumentFolders(): string[] {
        const rows = this.db.prepare('SELECT DISTINCT folder_name FROM support_documents ORDER BY folder_name').all() as { folder_name: string }[];
        return rows.map(r => r.folder_name);
    }

    // ==================== BOSS NOTEPAD (v7.0) ====================

    getBossNotepad(): Record<string, string> {
        const rows = this.db.prepare('SELECT section, content FROM boss_notepad ORDER BY section').all() as { section: string; content: string }[];
        const result: Record<string, string> = {};
        for (const row of rows) {
            result[row.section] = row.content;
        }
        return result;
    }

    updateBossNotepadSection(section: string, content: string): void {
        // Upsert: insert or replace for the section
        const existing = this.db.prepare('SELECT id FROM boss_notepad WHERE section = ?').get(section) as { id: string } | undefined;
        if (existing) {
            this.db.prepare("UPDATE boss_notepad SET content = ?, updated_at = datetime('now') WHERE section = ?").run(content, section);
        } else {
            this.db.prepare('INSERT INTO boss_notepad (id, section, content) VALUES (?, ?, ?)').run(this.genId(), section, content);
        }
    }

    getBossNotepadSection(section: string): string | null {
        const row = this.db.prepare('SELECT content FROM boss_notepad WHERE section = ?').get(section) as { content: string } | undefined;
        return row?.content ?? null;
    }

    // ==================== TICKET QUERY HELPERS (v7.0) ====================

    /** Get the last N processed tickets with full status info (for Boss AI status review) */
    getRecentProcessedTickets(limit: number = 15): Ticket[] {
        const rows = this.db.prepare(`
            SELECT * FROM tickets
            WHERE processing_status IS NOT NULL OR status IN ('resolved', 'blocked', 'cancelled')
            ORDER BY updated_at DESC
            LIMIT ?
        `).all(limit) as Record<string, unknown>[];
        return rows.map(r => this.rowToTicket(r));
    }

    /** Get all cancelled tickets (for Boss AI periodic re-engagement review) */
    getCancelledTickets(): Ticket[] {
        const rows = this.db.prepare("SELECT * FROM tickets WHERE status = 'cancelled' ORDER BY updated_at DESC").all() as Record<string, unknown>[];
        return rows.map(r => this.rowToTicket(r));
    }

    /** Get tickets by assigned queue */
    getTicketsByQueue(queue: string, status?: string): Ticket[] {
        if (status) {
            const rows = this.db.prepare('SELECT * FROM tickets WHERE assigned_queue = ? AND status = ? ORDER BY priority ASC, created_at ASC')
                .all(queue, status) as Record<string, unknown>[];
            return rows.map(r => this.rowToTicket(r));
        }
        const rows = this.db.prepare('SELECT * FROM tickets WHERE assigned_queue = ? ORDER BY priority ASC, created_at ASC')
            .all(queue) as Record<string, unknown>[];
        return rows.map(r => this.rowToTicket(r));
    }

    // ==================== BACKEND ELEMENTS (v8.0) ====================

    createBackendElement(data: Partial<BackendElement> & { plan_id: string; type: string; name: string }): BackendElement {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO backend_elements (id, plan_id, type, name, domain, layer, config_json, x, y, width, height, is_collapsed, is_draft, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, data.plan_id, data.type, data.name,
            data.domain ?? 'general', data.layer ?? 'services', data.config_json ?? '{}',
            data.x ?? 0, data.y ?? 0, data.width ?? 280, data.height ?? 120,
            data.is_collapsed ? 1 : 0, data.is_draft ? 1 : 0,
            data.sort_order ?? 0, now, now
        );
        return this.getBackendElement(id)!;
    }

    getBackendElement(id: string): BackendElement | null {
        const row = this.db.prepare('SELECT * FROM backend_elements WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        return row ? this.rowToBackendElement(row) : null;
    }

    getBackendElementsByPlan(planId: string): BackendElement[] {
        const rows = this.db.prepare('SELECT * FROM backend_elements WHERE plan_id = ? ORDER BY layer ASC, sort_order ASC, name ASC')
            .all(planId) as Record<string, unknown>[];
        return rows.map(r => this.rowToBackendElement(r));
    }

    getBackendElementsByPlanAndLayer(planId: string, layer: string): BackendElement[] {
        const rows = this.db.prepare('SELECT * FROM backend_elements WHERE plan_id = ? AND layer = ? ORDER BY sort_order ASC, name ASC')
            .all(planId, layer) as Record<string, unknown>[];
        return rows.map(r => this.rowToBackendElement(r));
    }

    getBackendElementsByPlanAndDomain(planId: string, domain: string): BackendElement[] {
        const rows = this.db.prepare('SELECT * FROM backend_elements WHERE plan_id = ? AND domain = ? ORDER BY layer ASC, sort_order ASC')
            .all(planId, domain) as Record<string, unknown>[];
        return rows.map(r => this.rowToBackendElement(r));
    }

    updateBackendElement(id: string, updates: Partial<BackendElement>): boolean {
        const fields: string[] = [];
        const values: unknown[] = [];
        const allowed = ['type', 'name', 'domain', 'layer', 'config_json', 'x', 'y', 'width', 'height', 'is_collapsed', 'is_draft', 'sort_order'];
        for (const key of allowed) {
            if (key in updates) {
                const val = (updates as Record<string, unknown>)[key];
                fields.push(`${key} = ?`);
                values.push(key === 'is_collapsed' || key === 'is_draft' ? (val ? 1 : 0) : val);
            }
        }
        if (fields.length === 0) return false;
        fields.push("updated_at = datetime('now')");
        values.push(id);
        const result = this.db.prepare(`UPDATE backend_elements SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return result.changes > 0;
    }

    deleteBackendElement(id: string): boolean {
        const result = this.db.prepare('DELETE FROM backend_elements WHERE id = ?').run(id);
        return result.changes > 0;
    }

    private rowToBackendElement(row: Record<string, unknown>): BackendElement {
        return {
            id: row.id as string,
            plan_id: row.plan_id as string,
            type: row.type as BackendElement['type'],
            name: row.name as string,
            domain: row.domain as string,
            layer: row.layer as BackendElement['layer'],
            config_json: row.config_json as string,
            x: row.x as number,
            y: row.y as number,
            width: row.width as number,
            height: row.height as number,
            is_collapsed: Boolean(row.is_collapsed),
            is_draft: Boolean(row.is_draft),
            sort_order: (row.sort_order as number) ?? 0,
            created_at: row.created_at as string,
            updated_at: row.updated_at as string,
        };
    }

    // ==================== ELEMENT LINKS (v8.0) ====================

    createElementLink(data: Partial<ElementLink> & { plan_id: string; from_element_type: string; from_element_id: string; to_element_type: string; to_element_id: string }): ElementLink {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO element_links (id, plan_id, link_type, granularity, source, from_element_type, from_element_id, to_element_type, to_element_id, label, metadata_json, confidence, is_approved, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, data.plan_id, data.link_type ?? 'fe_to_be', data.granularity ?? 'high',
            data.source ?? 'manual',
            data.from_element_type, data.from_element_id,
            data.to_element_type, data.to_element_id,
            data.label ?? '', data.metadata_json ?? '{}',
            data.confidence ?? null, data.is_approved !== false ? 1 : 0,
            now, now
        );
        return this.getElementLink(id)!;
    }

    getElementLink(id: string): ElementLink | null {
        const row = this.db.prepare('SELECT * FROM element_links WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        return row ? this.rowToElementLink(row) : null;
    }

    getElementLinksByPlan(planId: string): ElementLink[] {
        const rows = this.db.prepare('SELECT * FROM element_links WHERE plan_id = ? ORDER BY link_type ASC, created_at ASC')
            .all(planId) as Record<string, unknown>[];
        return rows.map(r => this.rowToElementLink(r));
    }

    getElementLinksByElement(elementType: string, elementId: string): ElementLink[] {
        const rows = this.db.prepare(`
            SELECT * FROM element_links
            WHERE (from_element_type = ? AND from_element_id = ?) OR (to_element_type = ? AND to_element_id = ?)
            ORDER BY created_at ASC
        `).all(elementType, elementId, elementType, elementId) as Record<string, unknown>[];
        return rows.map(r => this.rowToElementLink(r));
    }

    updateElementLink(id: string, updates: Partial<ElementLink>): boolean {
        const fields: string[] = [];
        const values: unknown[] = [];
        const allowed = ['link_type', 'granularity', 'source', 'label', 'metadata_json', 'confidence', 'is_approved'];
        for (const key of allowed) {
            if (key in updates) {
                const val = (updates as Record<string, unknown>)[key];
                fields.push(`${key} = ?`);
                values.push(key === 'is_approved' ? (val ? 1 : 0) : val);
            }
        }
        if (fields.length === 0) return false;
        fields.push("updated_at = datetime('now')");
        values.push(id);
        const result = this.db.prepare(`UPDATE element_links SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return result.changes > 0;
    }

    deleteElementLink(id: string): boolean {
        const result = this.db.prepare('DELETE FROM element_links WHERE id = ?').run(id);
        return result.changes > 0;
    }

    private rowToElementLink(row: Record<string, unknown>): ElementLink {
        return {
            id: row.id as string,
            plan_id: row.plan_id as string,
            link_type: row.link_type as ElementLink['link_type'],
            granularity: row.granularity as ElementLink['granularity'],
            source: row.source as ElementLink['source'],
            from_element_type: row.from_element_type as ElementLink['from_element_type'],
            from_element_id: row.from_element_id as string,
            to_element_type: row.to_element_type as ElementLink['to_element_type'],
            to_element_id: row.to_element_id as string,
            label: row.label as string,
            metadata_json: row.metadata_json as string,
            confidence: (row.confidence as number) ?? null,
            is_approved: Boolean(row.is_approved),
            created_at: row.created_at as string,
            updated_at: row.updated_at as string,
        };
    }

    // ==================== TAG DEFINITIONS (v8.0) ====================

    createTagDefinition(data: { name: string; color: string; plan_id?: string; custom_color?: string; is_builtin?: boolean; description?: string }): TagDefinition {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO tag_definitions (id, plan_id, name, color, custom_color, is_builtin, description, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, data.plan_id ?? null, data.name, data.color, data.custom_color ?? null, data.is_builtin ? 1 : 0, data.description ?? '', now);
        return this.getTagDefinition(id)!;
    }

    getTagDefinition(id: string): TagDefinition | null {
        const row = this.db.prepare('SELECT * FROM tag_definitions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        return row ? this.rowToTagDefinition(row) : null;
    }

    getTagDefinitions(planId?: string): TagDefinition[] {
        const rows = planId
            ? this.db.prepare('SELECT * FROM tag_definitions WHERE plan_id = ? OR plan_id IS NULL ORDER BY is_builtin DESC, name ASC').all(planId) as Record<string, unknown>[]
            : this.db.prepare('SELECT * FROM tag_definitions ORDER BY is_builtin DESC, name ASC').all() as Record<string, unknown>[];
        return rows.map(r => this.rowToTagDefinition(r));
    }

    deleteTagDefinition(id: string): boolean {
        // Prevent deletion of builtin tags
        const tag = this.getTagDefinition(id);
        if (tag?.is_builtin) return false;
        // Remove all assignments first
        this.db.prepare('DELETE FROM element_tags WHERE tag_id = ?').run(id);
        const result = this.db.prepare('DELETE FROM tag_definitions WHERE id = ?').run(id);
        return result.changes > 0;
    }

    seedBuiltinTags(planId?: string): void {
        for (const tag of BUILTIN_TAGS) {
            // Check if already seeded (by name + plan_id)
            const existing = planId
                ? this.db.prepare('SELECT id FROM tag_definitions WHERE name = ? AND (plan_id = ? OR plan_id IS NULL) AND is_builtin = 1').get(tag.name, planId) as Record<string, unknown> | undefined
                : this.db.prepare('SELECT id FROM tag_definitions WHERE name = ? AND plan_id IS NULL AND is_builtin = 1').get(tag.name) as Record<string, unknown> | undefined;
            if (!existing) {
                this.createTagDefinition({
                    name: tag.name,
                    color: tag.color,
                    plan_id: planId,
                    is_builtin: true,
                    description: tag.description,
                });
            }
        }
    }

    private rowToTagDefinition(row: Record<string, unknown>): TagDefinition {
        return {
            id: row.id as string,
            plan_id: (row.plan_id as string) ?? null,
            name: row.name as string,
            color: row.color as TagDefinition['color'],
            custom_color: (row.custom_color as string) ?? null,
            is_builtin: Boolean(row.is_builtin),
            description: row.description as string,
            created_at: row.created_at as string,
        };
    }

    // ==================== ELEMENT TAGS (v8.0) ====================

    assignTag(tagId: string, elementType: string, elementId: string): ElementTag {
        // Check for existing assignment
        const existing = this.db.prepare('SELECT id FROM element_tags WHERE tag_id = ? AND element_type = ? AND element_id = ?')
            .get(tagId, elementType, elementId) as Record<string, unknown> | undefined;
        if (existing) {
            return this.getElementTag(existing.id as string)!;
        }
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare('INSERT INTO element_tags (id, tag_id, element_type, element_id, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(id, tagId, elementType, elementId, now);
        return this.getElementTag(id)!;
    }

    getElementTag(id: string): ElementTag | null {
        const row = this.db.prepare('SELECT * FROM element_tags WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (!row) return null;
        return {
            id: row.id as string,
            tag_id: row.tag_id as string,
            element_type: row.element_type as ElementTag['element_type'],
            element_id: row.element_id as string,
            created_at: row.created_at as string,
        };
    }

    removeTag(tagId: string, elementType: string, elementId: string): boolean {
        const result = this.db.prepare('DELETE FROM element_tags WHERE tag_id = ? AND element_type = ? AND element_id = ?')
            .run(tagId, elementType, elementId);
        return result.changes > 0;
    }

    getTagsForElement(elementType: string, elementId: string): TagDefinition[] {
        const rows = this.db.prepare(`
            SELECT td.* FROM tag_definitions td
            INNER JOIN element_tags et ON et.tag_id = td.id
            WHERE et.element_type = ? AND et.element_id = ?
            ORDER BY td.name ASC
        `).all(elementType, elementId) as Record<string, unknown>[];
        return rows.map(r => this.rowToTagDefinition(r));
    }

    getElementsByTag(tagId: string): Array<{ element_type: string; element_id: string }> {
        return this.db.prepare('SELECT element_type, element_id FROM element_tags WHERE tag_id = ? ORDER BY created_at ASC')
            .all(tagId) as Array<{ element_type: string; element_id: string }>;
    }

    // ==================== REVIEW QUEUE (v8.0) ====================

    createReviewQueueItem(data: Partial<ReviewQueueItem> & { plan_id: string; element_id: string; element_type: string; title: string }): ReviewQueueItem {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO review_queue (id, plan_id, item_type, element_id, element_type, title, description, source_agent, status, priority, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        `).run(
            id, data.plan_id, data.item_type ?? 'fe_draft',
            data.element_id, data.element_type, data.title,
            data.description ?? '', data.source_agent ?? 'system',
            data.priority ?? 'P2', now, now
        );
        return this.getReviewQueueItem(id)!;
    }

    getReviewQueueItem(id: string): ReviewQueueItem | null {
        const row = this.db.prepare('SELECT * FROM review_queue WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        return row ? this.rowToReviewQueueItem(row) : null;
    }

    getReviewQueueByPlan(planId: string, status?: string): ReviewQueueItem[] {
        const query = status
            ? 'SELECT * FROM review_queue WHERE plan_id = ? AND status = ? ORDER BY priority ASC, created_at ASC'
            : 'SELECT * FROM review_queue WHERE plan_id = ? ORDER BY priority ASC, created_at ASC';
        const rows = status
            ? this.db.prepare(query).all(planId, status) as Record<string, unknown>[]
            : this.db.prepare(query).all(planId) as Record<string, unknown>[];
        return rows.map(r => this.rowToReviewQueueItem(r));
    }

    getPendingReviewCount(planId?: string): number {
        if (planId) {
            const row = this.db.prepare("SELECT COUNT(*) as cnt FROM review_queue WHERE plan_id = ? AND status = 'pending'").get(planId) as { cnt: number };
            return row.cnt;
        }
        const row = this.db.prepare("SELECT COUNT(*) as cnt FROM review_queue WHERE status = 'pending'").get() as { cnt: number };
        return row.cnt;
    }

    updateReviewQueueItem(id: string, updates: Partial<ReviewQueueItem>): boolean {
        const fields: string[] = [];
        const values: unknown[] = [];
        const allowed = ['status', 'priority', 'reviewed_at', 'review_notes', 'description', 'title'];
        for (const key of allowed) {
            if (key in updates) {
                fields.push(`${key} = ?`);
                values.push((updates as Record<string, unknown>)[key]);
            }
        }
        if (fields.length === 0) return false;
        fields.push("updated_at = datetime('now')");
        values.push(id);
        const result = this.db.prepare(`UPDATE review_queue SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return result.changes > 0;
    }

    deleteReviewQueueItem(id: string): boolean {
        const result = this.db.prepare('DELETE FROM review_queue WHERE id = ?').run(id);
        return result.changes > 0;
    }

    approveReviewItem(id: string, notes?: string): boolean {
        return this.updateReviewQueueItem(id, {
            status: 'approved' as ReviewQueueItem['status'],
            reviewed_at: new Date().toISOString(),
            review_notes: notes ?? null,
        });
    }

    rejectReviewItem(id: string, notes?: string): boolean {
        return this.updateReviewQueueItem(id, {
            status: 'rejected' as ReviewQueueItem['status'],
            reviewed_at: new Date().toISOString(),
            review_notes: notes ?? null,
        });
    }

    private rowToReviewQueueItem(row: Record<string, unknown>): ReviewQueueItem {
        return {
            id: row.id as string,
            plan_id: row.plan_id as string,
            item_type: row.item_type as ReviewQueueItem['item_type'],
            element_id: row.element_id as string,
            element_type: row.element_type as string,
            title: row.title as string,
            description: row.description as string,
            source_agent: row.source_agent as string,
            status: row.status as ReviewQueueItem['status'],
            priority: row.priority as TicketPriority,
            reviewed_at: (row.reviewed_at as string) ?? null,
            review_notes: (row.review_notes as string) ?? null,
            created_at: row.created_at as string,
            updated_at: row.updated_at as string,
        };
    }

    // ==================== v9.0: AGENT TREE NODES ====================

    createTreeNode(data: Partial<AgentTreeNode> & { name: string; agent_type: string; level: AgentLevel }): AgentTreeNode {
        const id = this.genId();
        const instanceId = data.instance_id || this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO agent_tree_nodes (id, instance_id, agent_type, name, level, parent_id, task_id, workflow_execution_id, scope, permissions_json, model_preference_json, max_fanout, max_depth_below, escalation_threshold, escalation_target_id, context_isolation, history_isolation, status, retries, escalations, tokens_consumed, input_contract, output_contract, niche_definition_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, instanceId, data.agent_type, data.name, data.level,
            data.parent_id ?? null, data.task_id ?? null, data.workflow_execution_id ?? null,
            data.scope ?? '', JSON.stringify(data.permissions ?? []),
            data.model_preference ? JSON.stringify(data.model_preference) : null,
            data.max_fanout ?? 5, data.max_depth_below ?? 9,
            data.escalation_threshold ?? 3, data.escalation_target_id ?? null,
            data.context_isolation !== false ? 1 : 0, data.history_isolation !== false ? 1 : 0,
            data.status ?? TreeNodeStatus.Idle, 0, 0, 0,
            data.input_contract ?? null, data.output_contract ?? null,
            data.niche_definition_id ?? null, now, now
        );
        return this.getTreeNode(id)!;
    }

    getTreeNode(id: string): AgentTreeNode | null {
        const row = this.db.prepare('SELECT * FROM agent_tree_nodes WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (!row) return null;
        return this.rowToTreeNode(row);
    }

    getTreeNodeChildren(parentId: string): AgentTreeNode[] {
        const rows = this.db.prepare('SELECT * FROM agent_tree_nodes WHERE parent_id = ? ORDER BY level ASC, name ASC').all(parentId) as Record<string, unknown>[];
        return rows.map(r => this.rowToTreeNode(r));
    }

    getTreeNodesByTask(taskId: string): AgentTreeNode[] {
        const rows = this.db.prepare('SELECT * FROM agent_tree_nodes WHERE task_id = ? ORDER BY level ASC').all(taskId) as Record<string, unknown>[];
        return rows.map(r => this.rowToTreeNode(r));
    }

    getAllTreeNodes(): AgentTreeNode[] {
        return (this.db.prepare('SELECT * FROM agent_tree_nodes ORDER BY level ASC').all() as Record<string, unknown>[]).map(r => this.rowToTreeNode(r));
    }

    getTreeNodesByLevel(level: AgentLevel, taskId?: string): AgentTreeNode[] {
        if (taskId) {
            return (this.db.prepare('SELECT * FROM agent_tree_nodes WHERE level = ? AND task_id = ?').all(level, taskId) as Record<string, unknown>[]).map(r => this.rowToTreeNode(r));
        }
        return (this.db.prepare('SELECT * FROM agent_tree_nodes WHERE level = ?').all(level) as Record<string, unknown>[]).map(r => this.rowToTreeNode(r));
    }

    /** v9.0: Find tree nodes by agent_type (e.g. 'planning', 'verification'). Returns first match at lowest level. */
    getTreeNodeByAgentType(agentType: string): AgentTreeNode | null {
        const row = this.db.prepare('SELECT * FROM agent_tree_nodes WHERE agent_type = ? ORDER BY level ASC LIMIT 1').get(agentType) as Record<string, unknown> | undefined;
        if (!row) return null;
        return this.rowToTreeNode(row);
    }

    /**
     * v9.0: Smart tree node lookup for live status tracking.
     * Maps core pipeline agent names to the best matching tree node using:
     * 1. Static mapping for well-known agents (boss → BossAgent, orchestrator → GlobalOrchestrator)
     * 2. Scope-keyword matching against the ticket context to pick the right domain subtree
     * 3. Fallback to exact agent_type match
     * 4. Final fallback to GlobalOrchestrator
     */
    findTreeNodeForAgent(agentName: string, ticketContext?: { title?: string; operation_type?: string; body?: string }): AgentTreeNode | null {
        // ===== TIER 1: Direct node name mapping for singleton agents =====
        const AGENT_TO_NODE_NAME: Record<string, string> = {
            'boss': 'BossAgent',
            'orchestrator': 'GlobalOrchestrator',
            'clarity': 'GlobalOrchestrator',
        };

        const directName = AGENT_TO_NODE_NAME[agentName];
        if (directName) {
            const row = this.db.prepare('SELECT * FROM agent_tree_nodes WHERE name = ? LIMIT 1').get(directName) as Record<string, unknown> | undefined;
            if (row) return this.rowToTreeNode(row);
        }

        // ===== TIER 2: Agent → preferred subtree branches (L2 domain, L3 area, L4 manager) =====
        // Each agent maps to one or more preferred tree branches, ordered from most to least specific.
        // First match wins. This covers ALL 18 orchestrator agent types.
        const AGENT_BRANCH_HINTS: Record<string, string[]> = {
            // Code domain agents
            'coding':            ['BackendArea', 'FrontendArea', 'CodeDomainOrchestrator'],
            'coding_director':   ['BackendArea', 'FrontendArea', 'CodeDomainOrchestrator'],
            'custom':            ['CodeDomainOrchestrator'],

            // Verification/testing agents
            'verification':      ['UnitTestManager', 'TestingArea', 'CodeDomainOrchestrator'],
            'ui_testing':        ['E2ETestManager', 'TestingArea', 'CodeDomainOrchestrator'],

            // Design agents
            'design_architect':  ['UIDesignArea', 'DesignDomainOrchestrator'],
            'design_hardener':   ['ComponentDesignManager', 'UIDesignArea', 'DesignDomainOrchestrator'],
            'gap_hunter':        ['DesignDomainOrchestrator', 'CodeDomainOrchestrator'],

            // Backend agents
            'backend_architect': ['APIManager', 'BackendArea', 'CodeDomainOrchestrator'],

            // Research/observation agents
            'research':          ['ResearchManager', 'UXDesignArea', 'DesignDomainOrchestrator'],
            'observation':       ['MonitoringManager', 'InfraArea', 'CodeDomainOrchestrator'],

            // Cross-domain agents — pick based on ticket context
            'planning':          [],  // skip to context-based matching
            'decision_memory':   [],  // skip to context-based matching
            'review':            [],  // skip to context-based matching
            'user_communication':[],  // skip to context-based matching
        };

        const branchHints = AGENT_BRANCH_HINTS[agentName];
        if (branchHints && branchHints.length > 0) {
            for (const nodeName of branchHints) {
                const row = this.db.prepare('SELECT * FROM agent_tree_nodes WHERE name = ? LIMIT 1').get(nodeName) as Record<string, unknown> | undefined;
                if (row) return this.rowToTreeNode(row);
            }
        }

        // ===== TIER 3: Context-based deep matching (L2 → L3 → L4) =====
        // For cross-domain agents (planning, review, etc.) and when branch hints didn't match,
        // score ALL skeleton nodes (L2-L4) against ticket context and pick the deepest best match.
        if (ticketContext) {
            const contextText = [
                ticketContext.title || '',
                ticketContext.operation_type || '',
                ticketContext.body?.substring(0, 300) || '',
            ].join(' ').toLowerCase();

            // Fetch L2-L4 nodes (skeleton) — these have meaningful scope keywords
            const skeletonNodes = (this.db.prepare(
                'SELECT * FROM agent_tree_nodes WHERE level >= 2 AND level <= 4 ORDER BY level DESC, name ASC'
            ).all() as Record<string, unknown>[]).map(r => this.rowToTreeNode(r));

            let bestNode: AgentTreeNode | null = null;
            let bestScore = 0;
            let bestLevel = -1;

            for (const node of skeletonNodes) {
                const scopeKeywords = (node.scope || '').split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 0);
                let score = 0;
                for (const kw of scopeKeywords) {
                    if (contextText.includes(kw)) {
                        score++;
                    }
                }
                // Prefer deeper nodes (L4 > L3 > L2) when scores are equal
                // Deeper nodes are more specific and give better tree visualization
                if (score > bestScore || (score === bestScore && score > 0 && node.level > bestLevel)) {
                    bestScore = score;
                    bestNode = node;
                    bestLevel = node.level;
                }
            }

            if (bestNode && bestScore > 0) {
                return bestNode;
            }
        }

        // ===== TIER 4: Fallback — agent_type exact match =====
        const typeMatch = this.getTreeNodeByAgentType(agentName);
        if (typeMatch) return typeMatch;

        // ===== TIER 5: Final fallback — GlobalOrchestrator =====
        const fallback = this.db.prepare("SELECT * FROM agent_tree_nodes WHERE name = 'GlobalOrchestrator' LIMIT 1").get() as Record<string, unknown> | undefined;
        if (fallback) return this.rowToTreeNode(fallback);

        return null;
    }

    getTreeAncestors(nodeId: string): AgentTreeNode[] {
        const ancestors: AgentTreeNode[] = [];
        let current = this.getTreeNode(nodeId);
        while (current?.parent_id) {
            const parent = this.getTreeNode(current.parent_id);
            if (!parent) break;
            ancestors.push(parent);
            current = parent;
        }
        return ancestors;
    }

    getTreeByRoot(rootId: string): AgentTreeNode[] {
        // BFS traversal from root
        const allNodes: AgentTreeNode[] = [];
        const root = this.getTreeNode(rootId);
        if (!root) return [];
        const queue = [root];
        while (queue.length > 0) {
            const node = queue.shift()!;
            allNodes.push(node);
            const children = this.getTreeNodeChildren(node.id);
            queue.push(...children);
        }
        return allNodes;
    }

    updateTreeNode(id: string, updates: Partial<AgentTreeNode>): boolean {
        const allowed = ['status', 'retries', 'escalations', 'tokens_consumed', 'scope', 'max_fanout', 'escalation_target_id'] as const;
        const fields: string[] = [];
        const values: unknown[] = [];
        for (const key of allowed) {
            if (key in updates) {
                fields.push(`${key} = ?`);
                values.push((updates as Record<string, unknown>)[key]);
            }
        }
        if ('permissions' in updates && updates.permissions) {
            fields.push('permissions_json = ?');
            values.push(JSON.stringify(updates.permissions));
        }
        if ('model_preference' in updates) {
            fields.push('model_preference_json = ?');
            values.push(updates.model_preference ? JSON.stringify(updates.model_preference) : null);
        }
        if (fields.length === 0) return false;
        fields.push("updated_at = datetime('now')");
        values.push(id);
        return this.db.prepare(`UPDATE agent_tree_nodes SET ${fields.join(', ')} WHERE id = ?`).run(...values).changes > 0;
    }

    deleteTreeNode(id: string): boolean {
        return this.db.prepare('DELETE FROM agent_tree_nodes WHERE id = ?').run(id).changes > 0;
    }

    deleteTreeNodesByTask(taskId: string): number {
        return Number(this.db.prepare('DELETE FROM agent_tree_nodes WHERE task_id = ?').run(taskId).changes);
    }

    private rowToTreeNode(row: Record<string, unknown>): AgentTreeNode {
        return {
            id: row.id as string,
            instance_id: row.instance_id as string,
            agent_type: row.agent_type as string,
            name: row.name as string,
            level: row.level as AgentLevel,
            parent_id: (row.parent_id as string) ?? null,
            task_id: (row.task_id as string) ?? null,
            workflow_execution_id: (row.workflow_execution_id as string) ?? null,
            scope: row.scope as string,
            permissions: JSON.parse((row.permissions_json as string) || '[]') as AgentPermission[],
            model_preference: row.model_preference_json ? JSON.parse(row.model_preference_json as string) as ModelPreference : null,
            max_fanout: row.max_fanout as number,
            max_depth_below: row.max_depth_below as number,
            escalation_threshold: row.escalation_threshold as number,
            escalation_target_id: (row.escalation_target_id as string) ?? null,
            context_isolation: !!(row.context_isolation as number),
            history_isolation: !!(row.history_isolation as number),
            status: row.status as TreeNodeStatus,
            retries: row.retries as number,
            escalations: row.escalations as number,
            tokens_consumed: row.tokens_consumed as number,
            input_contract: (row.input_contract as string) ?? null,
            output_contract: (row.output_contract as string) ?? null,
            niche_definition_id: (row.niche_definition_id as string) ?? null,
            created_at: row.created_at as string,
            updated_at: row.updated_at as string,
        };
    }

    // ==================== v9.0: AGENT TREE TEMPLATES ====================

    createTreeTemplate(data: { name: string; description?: string; nodes_json?: string; is_default?: boolean }): AgentTreeTemplate {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO agent_tree_templates (id, name, description, nodes_json, is_default, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, data.name, data.description ?? '', data.nodes_json ?? '[]', data.is_default ? 1 : 0, now, now);
        return this.getTreeTemplate(id)!;
    }

    getTreeTemplate(id: string): AgentTreeTemplate | null {
        const row = this.db.prepare('SELECT * FROM agent_tree_templates WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (!row) return null;
        return this.rowToTreeTemplate(row);
    }

    getTreeTemplateByName(name: string): AgentTreeTemplate | null {
        const row = this.db.prepare('SELECT * FROM agent_tree_templates WHERE name = ?').get(name) as Record<string, unknown> | undefined;
        if (!row) return null;
        return this.rowToTreeTemplate(row);
    }

    getDefaultTreeTemplate(): AgentTreeTemplate | null {
        const row = this.db.prepare('SELECT * FROM agent_tree_templates WHERE is_default = 1 LIMIT 1').get() as Record<string, unknown> | undefined;
        if (!row) return null;
        return this.rowToTreeTemplate(row);
    }

    getAllTreeTemplates(): AgentTreeTemplate[] {
        return (this.db.prepare('SELECT * FROM agent_tree_templates ORDER BY name ASC').all() as Record<string, unknown>[]).map(r => this.rowToTreeTemplate(r));
    }

    private rowToTreeTemplate(row: Record<string, unknown>): AgentTreeTemplate {
        return {
            id: row.id as string, name: row.name as string, description: row.description as string,
            nodes_json: row.nodes_json as string, is_default: !!(row.is_default as number),
            created_at: row.created_at as string, updated_at: row.updated_at as string,
        };
    }

    // ==================== v9.0: NICHE AGENT DEFINITIONS ====================

    createNicheAgentDefinition(data: Partial<NicheAgentDefinition> & { name: string; level: AgentLevel; specialty: string }): NicheAgentDefinition {
        const id = data.id || this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT OR IGNORE INTO niche_agent_definitions (id, name, level, specialty, domain, area, system_prompt_template, parent_level, required_capability, default_model_capability, input_contract, output_contract, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, data.name, data.level, data.specialty,
            data.domain ?? 'code', data.area ?? '',
            data.system_prompt_template ?? '', data.parent_level ?? Math.max(0, data.level - 1),
            data.required_capability ?? ModelCapability.General,
            data.default_model_capability ?? ModelCapability.Fast,
            data.input_contract ?? null, data.output_contract ?? null, now, now
        );
        return this.getNicheAgentDefinition(id)!;
    }

    getNicheAgentDefinition(id: string): NicheAgentDefinition | null {
        const row = this.db.prepare('SELECT * FROM niche_agent_definitions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (!row) return null;
        return this.rowToNicheAgent(row);
    }

    getNicheAgentsByLevel(level: AgentLevel): NicheAgentDefinition[] {
        return (this.db.prepare('SELECT * FROM niche_agent_definitions WHERE level = ? ORDER BY name ASC').all(level) as Record<string, unknown>[]).map(r => this.rowToNicheAgent(r));
    }

    getNicheAgentsByDomain(domain: string): NicheAgentDefinition[] {
        return (this.db.prepare('SELECT * FROM niche_agent_definitions WHERE domain = ? ORDER BY level ASC, name ASC').all(domain) as Record<string, unknown>[]).map(r => this.rowToNicheAgent(r));
    }

    getNicheAgentsBySpecialty(specialty: string): NicheAgentDefinition[] {
        return (this.db.prepare("SELECT * FROM niche_agent_definitions WHERE specialty LIKE ? ORDER BY level ASC, name ASC").all(`%${specialty}%`) as Record<string, unknown>[]).map(r => this.rowToNicheAgent(r));
    }

    getAllNicheAgentDefinitions(): NicheAgentDefinition[] {
        return (this.db.prepare('SELECT * FROM niche_agent_definitions ORDER BY domain ASC, level ASC, name ASC').all() as Record<string, unknown>[]).map(r => this.rowToNicheAgent(r));
    }

    updateNicheAgentDefinition(id: string, updates: Partial<NicheAgentDefinition>): boolean {
        const allowed = ['name', 'specialty', 'domain', 'area', 'system_prompt_template', 'required_capability', 'default_model_capability', 'input_contract', 'output_contract'] as const;
        const fields: string[] = [];
        const values: unknown[] = [];
        for (const key of allowed) {
            if (key in updates) {
                fields.push(`${key} = ?`);
                values.push((updates as Record<string, unknown>)[key]);
            }
        }
        if (fields.length === 0) return false;
        fields.push("updated_at = datetime('now')");
        values.push(id);
        return this.db.prepare(`UPDATE niche_agent_definitions SET ${fields.join(', ')} WHERE id = ?`).run(...values).changes > 0;
    }

    getNicheAgentCount(): number {
        const row = this.db.prepare('SELECT COUNT(*) as count FROM niche_agent_definitions').get() as { count: number };
        return row.count;
    }

    private rowToNicheAgent(row: Record<string, unknown>): NicheAgentDefinition {
        return {
            id: row.id as string, name: row.name as string,
            level: row.level as AgentLevel, specialty: row.specialty as string,
            domain: row.domain as string, area: row.area as string,
            system_prompt_template: row.system_prompt_template as string,
            parent_level: row.parent_level as AgentLevel,
            required_capability: row.required_capability as ModelCapability,
            default_model_capability: row.default_model_capability as ModelCapability,
            input_contract: (row.input_contract as string) ?? null,
            output_contract: (row.output_contract as string) ?? null,
            created_at: row.created_at as string, updated_at: row.updated_at as string,
        };
    }

    // ==================== v9.0: WORKFLOW DEFINITIONS ====================

    createWorkflowDefinition(data: Partial<WorkflowDefinition> & { name: string }): WorkflowDefinition {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO workflow_definitions (id, plan_id, name, description, mermaid_source, status, created_by, version, acceptance_criteria, tags_json, is_template, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, data.plan_id ?? null, data.name, data.description ?? '', data.mermaid_source ?? '',
            data.status ?? WorkflowStatus.Draft, data.created_by ?? 'system', data.version ?? 1,
            data.acceptance_criteria ?? '', JSON.stringify(data.tags ?? []), data.is_template ? 1 : 0, now, now
        );
        return this.getWorkflowDefinition(id)!;
    }

    getWorkflowDefinition(id: string): WorkflowDefinition | null {
        const row = this.db.prepare('SELECT * FROM workflow_definitions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (!row) return null;
        return this.rowToWorkflowDef(row);
    }

    getAllWorkflows(): WorkflowDefinition[] {
        return (this.db.prepare('SELECT * FROM workflow_definitions ORDER BY name ASC').all() as Record<string, unknown>[]).map(r => this.rowToWorkflowDef(r));
    }

    getWorkflowsByPlan(planId: string | null): WorkflowDefinition[] {
        if (planId === null) {
            return (this.db.prepare('SELECT * FROM workflow_definitions WHERE plan_id IS NULL ORDER BY name ASC').all() as Record<string, unknown>[]).map(r => this.rowToWorkflowDef(r));
        }
        return (this.db.prepare('SELECT * FROM workflow_definitions WHERE plan_id = ? ORDER BY name ASC').all(planId) as Record<string, unknown>[]).map(r => this.rowToWorkflowDef(r));
    }

    getWorkflowTemplates(): WorkflowDefinition[] {
        return (this.db.prepare('SELECT * FROM workflow_definitions WHERE is_template = 1 ORDER BY name ASC').all() as Record<string, unknown>[]).map(r => this.rowToWorkflowDef(r));
    }

    updateWorkflowDefinition(id: string, updates: Partial<WorkflowDefinition>): boolean {
        const allowed = ['name', 'description', 'mermaid_source', 'status', 'acceptance_criteria', 'is_template'] as const;
        const fields: string[] = [];
        const values: unknown[] = [];
        for (const key of allowed) {
            if (key in updates) {
                const v = key === 'is_template' ? ((updates as Record<string, unknown>)[key] ? 1 : 0) : (updates as Record<string, unknown>)[key];
                fields.push(`${key} = ?`);
                values.push(v);
            }
        }
        if ('tags' in updates && updates.tags) {
            fields.push('tags_json = ?');
            values.push(JSON.stringify(updates.tags));
        }
        if (fields.length === 0) return false;
        fields.push('version = version + 1');
        fields.push("updated_at = datetime('now')");
        values.push(id);
        return this.db.prepare(`UPDATE workflow_definitions SET ${fields.join(', ')} WHERE id = ?`).run(...values).changes > 0;
    }

    deleteWorkflowDefinition(id: string): boolean {
        this.db.prepare('DELETE FROM workflow_steps WHERE workflow_id = ?').run(id);
        return this.db.prepare('DELETE FROM workflow_definitions WHERE id = ?').run(id).changes > 0;
    }

    private rowToWorkflowDef(row: Record<string, unknown>): WorkflowDefinition {
        return {
            id: row.id as string, plan_id: (row.plan_id as string) ?? null,
            name: row.name as string, description: row.description as string,
            mermaid_source: row.mermaid_source as string, status: row.status as WorkflowStatus,
            created_by: row.created_by as string, version: row.version as number,
            acceptance_criteria: row.acceptance_criteria as string,
            tags: JSON.parse((row.tags_json as string) || '[]') as string[],
            is_template: !!(row.is_template as number),
            created_at: row.created_at as string, updated_at: row.updated_at as string,
        };
    }

    // ==================== v9.0: WORKFLOW STEPS ====================

    createWorkflowStep(data: Partial<WorkflowStep> & { workflow_id: string }): WorkflowStep {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO workflow_steps (id, workflow_id, step_type, label, agent_type, agent_prompt, condition_expression, tools_unlocked_json, acceptance_criteria, max_retries, retry_delay_ms, escalation_step_id, next_step_id, true_branch_step_id, false_branch_step_id, parallel_step_ids_json, model_preference_json, x, y, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, data.workflow_id, data.step_type ?? WorkflowStepType.AgentCall,
            data.label ?? '', data.agent_type ?? null, data.agent_prompt ?? null,
            data.condition_expression ?? null, JSON.stringify(data.tools_unlocked ?? []),
            data.acceptance_criteria ?? null, data.max_retries ?? 3, data.retry_delay_ms ?? 1000,
            data.escalation_step_id ?? null, data.next_step_id ?? null,
            data.true_branch_step_id ?? null, data.false_branch_step_id ?? null,
            JSON.stringify(data.parallel_step_ids ?? []),
            data.model_preference ? JSON.stringify(data.model_preference) : null,
            data.x ?? 0, data.y ?? 0, data.sort_order ?? 0, now, now
        );
        return this.getWorkflowStep(id)!;
    }

    getWorkflowStep(id: string): WorkflowStep | null {
        const row = this.db.prepare('SELECT * FROM workflow_steps WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (!row) return null;
        return this.rowToWorkflowStep(row);
    }

    getWorkflowSteps(workflowId: string): WorkflowStep[] {
        return (this.db.prepare('SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY sort_order ASC').all(workflowId) as Record<string, unknown>[]).map(r => this.rowToWorkflowStep(r));
    }

    updateWorkflowStep(id: string, updates: Partial<WorkflowStep>): boolean {
        const allowed = ['label', 'agent_type', 'agent_prompt', 'condition_expression', 'acceptance_criteria', 'max_retries', 'retry_delay_ms', 'escalation_step_id', 'next_step_id', 'true_branch_step_id', 'false_branch_step_id', 'x', 'y', 'sort_order', 'step_type'] as const;
        const fields: string[] = [];
        const values: unknown[] = [];
        for (const key of allowed) {
            if (key in updates) {
                fields.push(`${key} = ?`);
                values.push((updates as Record<string, unknown>)[key]);
            }
        }
        if ('tools_unlocked' in updates) {
            fields.push('tools_unlocked_json = ?');
            values.push(JSON.stringify(updates.tools_unlocked ?? []));
        }
        if ('parallel_step_ids' in updates) {
            fields.push('parallel_step_ids_json = ?');
            values.push(JSON.stringify(updates.parallel_step_ids ?? []));
        }
        if ('model_preference' in updates) {
            fields.push('model_preference_json = ?');
            values.push(updates.model_preference ? JSON.stringify(updates.model_preference) : null);
        }
        if (fields.length === 0) return false;
        fields.push("updated_at = datetime('now')");
        values.push(id);
        return this.db.prepare(`UPDATE workflow_steps SET ${fields.join(', ')} WHERE id = ?`).run(...values).changes > 0;
    }

    deleteWorkflowStep(id: string): boolean {
        return this.db.prepare('DELETE FROM workflow_steps WHERE id = ?').run(id).changes > 0;
    }

    private rowToWorkflowStep(row: Record<string, unknown>): WorkflowStep {
        return {
            id: row.id as string, workflow_id: row.workflow_id as string,
            step_type: row.step_type as WorkflowStepType, label: row.label as string,
            agent_type: (row.agent_type as string) ?? null, agent_prompt: (row.agent_prompt as string) ?? null,
            condition_expression: (row.condition_expression as string) ?? null,
            tools_unlocked: JSON.parse((row.tools_unlocked_json as string) || '[]') as string[],
            acceptance_criteria: (row.acceptance_criteria as string) ?? null,
            max_retries: row.max_retries as number, retry_delay_ms: row.retry_delay_ms as number,
            escalation_step_id: (row.escalation_step_id as string) ?? null,
            next_step_id: (row.next_step_id as string) ?? null,
            true_branch_step_id: (row.true_branch_step_id as string) ?? null,
            false_branch_step_id: (row.false_branch_step_id as string) ?? null,
            parallel_step_ids: JSON.parse((row.parallel_step_ids_json as string) || '[]') as string[],
            model_preference: row.model_preference_json ? JSON.parse(row.model_preference_json as string) as ModelPreference : null,
            x: row.x as number, y: row.y as number, sort_order: row.sort_order as number,
            created_at: row.created_at as string, updated_at: row.updated_at as string,
        };
    }

    // ==================== v9.0: WORKFLOW EXECUTIONS ====================

    createWorkflowExecution(data: { workflow_id: string; ticket_id?: string; task_id?: string; variables?: Record<string, unknown> }): WorkflowExecution {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO workflow_executions (id, workflow_id, ticket_id, task_id, current_step_id, status, step_results_json, variables_json, tokens_consumed, started_at)
            VALUES (?, ?, ?, ?, NULL, ?, '{}', ?, 0, ?)
        `).run(id, data.workflow_id, data.ticket_id ?? null, data.task_id ?? null, WorkflowExecutionStatus.Pending, JSON.stringify(data.variables ?? {}), now);
        return this.getWorkflowExecution(id)!;
    }

    getWorkflowExecution(id: string): WorkflowExecution | null {
        const row = this.db.prepare('SELECT * FROM workflow_executions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (!row) return null;
        return this.rowToWorkflowExecution(row);
    }

    getWorkflowExecutionsByWorkflow(workflowId: string): WorkflowExecution[] {
        return (this.db.prepare('SELECT * FROM workflow_executions WHERE workflow_id = ? ORDER BY started_at DESC').all(workflowId) as Record<string, unknown>[]).map(r => this.rowToWorkflowExecution(r));
    }

    getPendingWorkflowExecutions(): WorkflowExecution[] {
        return (this.db.prepare("SELECT * FROM workflow_executions WHERE status IN ('pending', 'running', 'waiting_approval') ORDER BY started_at ASC").all() as Record<string, unknown>[]).map(r => this.rowToWorkflowExecution(r));
    }

    updateWorkflowExecution(id: string, updates: Partial<WorkflowExecution>): boolean {
        const fields: string[] = [];
        const values: unknown[] = [];
        if ('current_step_id' in updates) { fields.push('current_step_id = ?'); values.push(updates.current_step_id ?? null); }
        if ('status' in updates) { fields.push('status = ?'); values.push(updates.status); }
        if ('tokens_consumed' in updates) { fields.push('tokens_consumed = ?'); values.push(updates.tokens_consumed); }
        if ('completed_at' in updates) { fields.push('completed_at = ?'); values.push(updates.completed_at ?? null); }
        if ('step_results_json' in updates) { fields.push('step_results_json = ?'); values.push(updates.step_results_json); }
        if ('variables_json' in updates) { fields.push('variables_json = ?'); values.push(updates.variables_json); }
        if (fields.length === 0) return false;
        values.push(id);
        return this.db.prepare(`UPDATE workflow_executions SET ${fields.join(', ')} WHERE id = ?`).run(...values).changes > 0;
    }

    private rowToWorkflowExecution(row: Record<string, unknown>): WorkflowExecution {
        return {
            id: row.id as string, workflow_id: row.workflow_id as string,
            ticket_id: (row.ticket_id as string) ?? null, task_id: (row.task_id as string) ?? null,
            current_step_id: (row.current_step_id as string) ?? null,
            status: row.status as WorkflowExecutionStatus,
            step_results_json: row.step_results_json as string,
            variables_json: row.variables_json as string,
            tokens_consumed: row.tokens_consumed as number,
            started_at: row.started_at as string,
            completed_at: (row.completed_at as string) ?? null,
        };
    }

    // ==================== v9.0: WORKFLOW STEP RESULTS ====================

    createWorkflowStepResult(data: { execution_id: string; step_id: string; status?: WorkflowExecutionStatus; agent_response?: string; acceptance_check?: boolean; retries?: number; duration_ms?: number; tokens_used?: number; error?: string }): WorkflowStepResult {
        const id = this.genId();
        this.db.prepare(`
            INSERT INTO workflow_step_results (id, execution_id, step_id, status, agent_response, acceptance_check, retries, duration_ms, tokens_used, error)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, data.execution_id, data.step_id, data.status ?? WorkflowExecutionStatus.Pending,
            data.agent_response ?? null, data.acceptance_check != null ? (data.acceptance_check ? 1 : 0) : null,
            data.retries ?? 0, data.duration_ms ?? 0, data.tokens_used ?? 0, data.error ?? null
        );
        return {
            step_id: data.step_id, status: data.status ?? WorkflowExecutionStatus.Pending,
            agent_response: data.agent_response ?? null, acceptance_check: data.acceptance_check ?? null,
            retries: data.retries ?? 0, duration_ms: data.duration_ms ?? 0,
            tokens_used: data.tokens_used ?? 0, error: data.error ?? null,
        };
    }

    getWorkflowStepResults(executionId: string): WorkflowStepResult[] {
        return (this.db.prepare('SELECT * FROM workflow_step_results WHERE execution_id = ? ORDER BY created_at ASC').all(executionId) as Record<string, unknown>[]).map(r => ({
            step_id: r.step_id as string, status: r.status as WorkflowExecutionStatus,
            agent_response: (r.agent_response as string) ?? null,
            acceptance_check: r.acceptance_check != null ? !!(r.acceptance_check as number) : null,
            retries: r.retries as number, duration_ms: r.duration_ms as number,
            tokens_used: r.tokens_used as number, error: (r.error as string) ?? null,
        }));
    }

    // ==================== v9.0: AGENT PERMISSION SETS ====================

    createPermissionSet(data: Partial<AgentPermissionSet> & { agent_type: string }): AgentPermissionSet {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO agent_permission_sets (id, agent_type, agent_instance_id, permissions_json, allowed_tools_json, blocked_tools_json, can_spawn, max_llm_calls, max_time_minutes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, data.agent_type, data.agent_instance_id ?? null,
            JSON.stringify(data.permissions ?? [AgentPermission.Read, AgentPermission.Write, AgentPermission.Execute, AgentPermission.Escalate]),
            JSON.stringify(data.allowed_tools ?? []), JSON.stringify(data.blocked_tools ?? []),
            data.can_spawn !== false ? 1 : 0, data.max_llm_calls ?? 100, data.max_time_minutes ?? 60, now, now
        );
        return this.getPermissionSet(id)!;
    }

    getPermissionSet(id: string): AgentPermissionSet | null {
        const row = this.db.prepare('SELECT * FROM agent_permission_sets WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (!row) return null;
        return this.rowToPermissionSet(row);
    }

    getPermissionSetByAgent(agentType: string, instanceId?: string): AgentPermissionSet | null {
        let row: Record<string, unknown> | undefined;
        if (instanceId) {
            row = this.db.prepare('SELECT * FROM agent_permission_sets WHERE agent_type = ? AND agent_instance_id = ?').get(agentType, instanceId) as Record<string, unknown> | undefined;
        }
        if (!row) {
            row = this.db.prepare('SELECT * FROM agent_permission_sets WHERE agent_type = ? AND agent_instance_id IS NULL').get(agentType) as Record<string, unknown> | undefined;
        }
        if (!row) return null;
        return this.rowToPermissionSet(row);
    }

    updatePermissionSet(id: string, updates: Partial<AgentPermissionSet>): boolean {
        const fields: string[] = [];
        const values: unknown[] = [];
        if ('permissions' in updates) { fields.push('permissions_json = ?'); values.push(JSON.stringify(updates.permissions ?? [])); }
        if ('allowed_tools' in updates) { fields.push('allowed_tools_json = ?'); values.push(JSON.stringify(updates.allowed_tools ?? [])); }
        if ('blocked_tools' in updates) { fields.push('blocked_tools_json = ?'); values.push(JSON.stringify(updates.blocked_tools ?? [])); }
        if ('can_spawn' in updates) { fields.push('can_spawn = ?'); values.push(updates.can_spawn ? 1 : 0); }
        if ('max_llm_calls' in updates) { fields.push('max_llm_calls = ?'); values.push(updates.max_llm_calls); }
        if ('max_time_minutes' in updates) { fields.push('max_time_minutes = ?'); values.push(updates.max_time_minutes); }
        if (fields.length === 0) return false;
        fields.push("updated_at = datetime('now')");
        values.push(id);
        return this.db.prepare(`UPDATE agent_permission_sets SET ${fields.join(', ')} WHERE id = ?`).run(...values).changes > 0;
    }

    deletePermissionSet(id: string): boolean {
        return this.db.prepare('DELETE FROM agent_permission_sets WHERE id = ?').run(id).changes > 0;
    }

    private rowToPermissionSet(row: Record<string, unknown>): AgentPermissionSet {
        return {
            id: row.id as string, agent_type: row.agent_type as string,
            agent_instance_id: (row.agent_instance_id as string) ?? null,
            permissions: JSON.parse((row.permissions_json as string) || '[]') as AgentPermission[],
            allowed_tools: JSON.parse((row.allowed_tools_json as string) || '[]') as string[],
            blocked_tools: JSON.parse((row.blocked_tools_json as string) || '[]') as string[],
            can_spawn: !!(row.can_spawn as number),
            max_llm_calls: row.max_llm_calls as number, max_time_minutes: row.max_time_minutes as number,
            created_at: row.created_at as string, updated_at: row.updated_at as string,
        };
    }

    // ==================== v9.0: USER PROFILES ====================

    createUserProfile(data?: Partial<UserProfile>): UserProfile {
        const id = data?.id || this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO user_profiles (id, programming_level, strengths_json, weaknesses_json, known_areas_json, unknown_areas_json, area_preferences_json, repeat_answers_json, communication_style, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, data?.programming_level ?? UserProgrammingLevel.Good,
            JSON.stringify(data?.strengths ?? []), JSON.stringify(data?.weaknesses ?? []),
            JSON.stringify(data?.known_areas ?? []), JSON.stringify(data?.unknown_areas ?? []),
            JSON.stringify(data?.area_preferences ?? {}), JSON.stringify(data?.repeat_answers ?? {}),
            data?.communication_style ?? 'balanced', data?.notes ?? '', now, now
        );
        return this.getUserProfile(id)!;
    }

    getUserProfile(id: string): UserProfile | null {
        const row = this.db.prepare('SELECT * FROM user_profiles WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (!row) return null;
        return this.rowToUserProfile(row);
    }

    getDefaultUserProfile(): UserProfile | null {
        const row = this.db.prepare('SELECT * FROM user_profiles ORDER BY created_at ASC LIMIT 1').get() as Record<string, unknown> | undefined;
        if (!row) return null;
        return this.rowToUserProfile(row);
    }

    updateUserProfile(id: string, updates: Partial<UserProfile>): boolean {
        const fields: string[] = [];
        const values: unknown[] = [];
        if ('programming_level' in updates) { fields.push('programming_level = ?'); values.push(updates.programming_level); }
        if ('communication_style' in updates) { fields.push('communication_style = ?'); values.push(updates.communication_style); }
        if ('notes' in updates) { fields.push('notes = ?'); values.push(updates.notes); }
        if ('strengths' in updates) { fields.push('strengths_json = ?'); values.push(JSON.stringify(updates.strengths ?? [])); }
        if ('weaknesses' in updates) { fields.push('weaknesses_json = ?'); values.push(JSON.stringify(updates.weaknesses ?? [])); }
        if ('known_areas' in updates) { fields.push('known_areas_json = ?'); values.push(JSON.stringify(updates.known_areas ?? [])); }
        if ('unknown_areas' in updates) { fields.push('unknown_areas_json = ?'); values.push(JSON.stringify(updates.unknown_areas ?? [])); }
        if ('area_preferences' in updates) { fields.push('area_preferences_json = ?'); values.push(JSON.stringify(updates.area_preferences ?? {})); }
        if ('repeat_answers' in updates) { fields.push('repeat_answers_json = ?'); values.push(JSON.stringify(updates.repeat_answers ?? {})); }
        if (fields.length === 0) return false;
        fields.push("updated_at = datetime('now')");
        values.push(id);
        return this.db.prepare(`UPDATE user_profiles SET ${fields.join(', ')} WHERE id = ?`).run(...values).changes > 0;
    }

    private rowToUserProfile(row: Record<string, unknown>): UserProfile {
        return {
            id: row.id as string,
            programming_level: row.programming_level as UserProgrammingLevel,
            strengths: JSON.parse((row.strengths_json as string) || '[]') as string[],
            weaknesses: JSON.parse((row.weaknesses_json as string) || '[]') as string[],
            known_areas: JSON.parse((row.known_areas_json as string) || '[]') as string[],
            unknown_areas: JSON.parse((row.unknown_areas_json as string) || '[]') as string[],
            area_preferences: JSON.parse((row.area_preferences_json as string) || '{}') as Record<string, UserPreferenceAction>,
            repeat_answers: JSON.parse((row.repeat_answers_json as string) || '{}') as Record<string, string>,
            communication_style: row.communication_style as 'technical' | 'simple' | 'balanced',
            notes: row.notes as string,
            created_at: row.created_at as string, updated_at: row.updated_at as string,
        };
    }

    // ==================== v9.0: AGENT CONVERSATIONS ====================

    createAgentConversation(data: { tree_node_id: string; level: AgentLevel; role: ConversationRole; content: string; tokens_used?: number; parent_conversation_id?: string; question_id?: string }): AgentConversation {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO agent_conversations (id, tree_node_id, level, parent_conversation_id, role, content, tokens_used, question_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, data.tree_node_id, data.level, data.parent_conversation_id ?? null, data.role, data.content, data.tokens_used ?? 0, data.question_id ?? null, now);
        return {
            id, tree_node_id: data.tree_node_id, level: data.level,
            parent_conversation_id: data.parent_conversation_id ?? null,
            role: data.role, content: data.content, tokens_used: data.tokens_used ?? 0,
            question_id: data.question_id ?? null, created_at: now,
        };
    }

    getAgentConversationsByNode(treeNodeId: string): AgentConversation[] {
        return (this.db.prepare('SELECT * FROM agent_conversations WHERE tree_node_id = ? ORDER BY created_at ASC').all(treeNodeId) as Record<string, unknown>[]).map(r => ({
            id: r.id as string, tree_node_id: r.tree_node_id as string, level: r.level as AgentLevel,
            parent_conversation_id: (r.parent_conversation_id as string) ?? null,
            role: r.role as ConversationRole, content: r.content as string,
            tokens_used: r.tokens_used as number, question_id: (r.question_id as string) ?? null,
            created_at: r.created_at as string,
        }));
    }

    getAgentConversationsByQuestion(questionId: string): AgentConversation[] {
        return (this.db.prepare('SELECT * FROM agent_conversations WHERE question_id = ? ORDER BY created_at ASC').all(questionId) as Record<string, unknown>[]).map(r => ({
            id: r.id as string, tree_node_id: r.tree_node_id as string, level: r.level as AgentLevel,
            parent_conversation_id: (r.parent_conversation_id as string) ?? null,
            role: r.role as ConversationRole, content: r.content as string,
            tokens_used: r.tokens_used as number, question_id: (r.question_id as string) ?? null,
            created_at: r.created_at as string,
        }));
    }

    // ==================== v9.0: ESCALATION CHAINS ====================

    createEscalationChain(data: { tree_root_id: string; originating_node_id: string; current_node_id: string; question: string; context?: string }): EscalationChain {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO escalation_chains (id, tree_root_id, originating_node_id, current_node_id, question, status, levels_traversed, context, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, data.tree_root_id, data.originating_node_id, data.current_node_id, data.question, EscalationChainStatus.Escalating, JSON.stringify([data.current_node_id]), data.context ?? null, now);
        return this.getEscalationChain(id)!;
    }

    getEscalationChain(id: string): EscalationChain | null {
        const row = this.db.prepare('SELECT * FROM escalation_chains WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (!row) return null;
        return this.rowToEscalationChain(row);
    }

    getActiveEscalationChains(treeRootId?: string): EscalationChain[] {
        let sql = "SELECT * FROM escalation_chains WHERE status = 'escalating'";
        const params: unknown[] = [];
        if (treeRootId) { sql += ' AND tree_root_id = ?'; params.push(treeRootId); }
        sql += ' ORDER BY created_at ASC';
        return (this.db.prepare(sql).all(...params) as Record<string, unknown>[]).map(r => this.rowToEscalationChain(r));
    }

    updateEscalationChain(id: string, updates: Partial<EscalationChain>): boolean {
        const fields: string[] = [];
        const values: unknown[] = [];
        if ('current_node_id' in updates) { fields.push('current_node_id = ?'); values.push(updates.current_node_id); }
        if ('status' in updates) { fields.push('status = ?'); values.push(updates.status); }
        if ('answer' in updates) { fields.push('answer = ?'); values.push(updates.answer ?? null); }
        if ('resolved_at_level' in updates) { fields.push('resolved_at_level = ?'); values.push(updates.resolved_at_level ?? null); }
        if ('ticket_id' in updates) { fields.push('ticket_id = ?'); values.push(updates.ticket_id ?? null); }
        if ('resolved_at' in updates) { fields.push('resolved_at = ?'); values.push(updates.resolved_at ?? null); }
        if ('levels_traversed' in updates) { fields.push('levels_traversed = ?'); values.push(updates.levels_traversed); }
        if (fields.length === 0) return false;
        values.push(id);
        return this.db.prepare(`UPDATE escalation_chains SET ${fields.join(', ')} WHERE id = ?`).run(...values).changes > 0;
    }

    private rowToEscalationChain(row: Record<string, unknown>): EscalationChain {
        return {
            id: row.id as string, tree_root_id: row.tree_root_id as string,
            originating_node_id: row.originating_node_id as string,
            current_node_id: row.current_node_id as string,
            question: row.question as string, status: row.status as EscalationChainStatus,
            answer: (row.answer as string) ?? null,
            levels_traversed: row.levels_traversed as string,
            resolved_at_level: row.resolved_at_level != null ? row.resolved_at_level as AgentLevel : null,
            ticket_id: (row.ticket_id as string) ?? null,
            context: (row.context as string) ?? null,
            created_at: row.created_at as string,
            resolved_at: (row.resolved_at as string) ?? null,
        };
    }

    // ==================== v9.0: MODEL ASSIGNMENTS ====================

    createModelAssignment(data: { agent_type: string; capability: ModelCapability; model_id: string; is_default?: boolean; priority?: number }): ModelAssignment {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO model_assignments (id, agent_type, capability, model_id, is_default, priority, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, data.agent_type, data.capability, data.model_id, data.is_default ? 1 : 0, data.priority ?? 0, now, now);
        return this.getModelAssignment(id)!;
    }

    getModelAssignment(id: string): ModelAssignment | null {
        const row = this.db.prepare('SELECT * FROM model_assignments WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (!row) return null;
        return this.rowToModelAssignment(row);
    }

    getModelAssignmentForAgent(agentType: string, capability?: ModelCapability): ModelAssignment | null {
        let row: Record<string, unknown> | undefined;
        if (capability) {
            row = this.db.prepare('SELECT * FROM model_assignments WHERE agent_type = ? AND capability = ? ORDER BY priority ASC LIMIT 1').get(agentType, capability) as Record<string, unknown> | undefined;
        }
        if (!row) {
            row = this.db.prepare('SELECT * FROM model_assignments WHERE agent_type = ? AND is_default = 1 ORDER BY priority ASC LIMIT 1').get(agentType) as Record<string, unknown> | undefined;
        }
        if (!row) return null;
        return this.rowToModelAssignment(row);
    }

    getAllModelAssignments(): ModelAssignment[] {
        return (this.db.prepare('SELECT * FROM model_assignments ORDER BY agent_type ASC, priority ASC').all() as Record<string, unknown>[]).map(r => this.rowToModelAssignment(r));
    }

    updateModelAssignment(id: string, updates: Partial<ModelAssignment>): boolean {
        const fields: string[] = [];
        const values: unknown[] = [];
        if ('model_id' in updates) { fields.push('model_id = ?'); values.push(updates.model_id); }
        if ('capability' in updates) { fields.push('capability = ?'); values.push(updates.capability); }
        if ('is_default' in updates) { fields.push('is_default = ?'); values.push(updates.is_default ? 1 : 0); }
        if ('priority' in updates) { fields.push('priority = ?'); values.push(updates.priority); }
        if (fields.length === 0) return false;
        fields.push("updated_at = datetime('now')");
        values.push(id);
        return this.db.prepare(`UPDATE model_assignments SET ${fields.join(', ')} WHERE id = ?`).run(...values).changes > 0;
    }

    deleteModelAssignment(id: string): boolean {
        return this.db.prepare('DELETE FROM model_assignments WHERE id = ?').run(id).changes > 0;
    }

    private rowToModelAssignment(row: Record<string, unknown>): ModelAssignment {
        return {
            id: row.id as string, agent_type: row.agent_type as string,
            capability: row.capability as ModelCapability, model_id: row.model_id as string,
            is_default: !!(row.is_default as number), priority: row.priority as number,
            created_at: row.created_at as string, updated_at: row.updated_at as string,
        };
    }

    // ==================== v9.0: MCP CONFIRMATIONS ====================

    createMCPConfirmation(data: { tool_name: string; agent_name: string; description: string; arguments_preview: string; expires_at: string }): MCPConfirmation {
        const id = this.genId();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO mcp_confirmations (id, tool_name, agent_name, description, arguments_preview, status, expires_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        `).run(id, data.tool_name, data.agent_name, data.description, data.arguments_preview, data.expires_at, now, now);
        return this.getMCPConfirmation(id)!;
    }

    getMCPConfirmation(id: string): MCPConfirmation | null {
        const row = this.db.prepare('SELECT * FROM mcp_confirmations WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (!row) return null;
        return this.rowToMCPConfirmation(row);
    }

    getActiveMCPConfirmations(): MCPConfirmation[] {
        return (this.db.prepare("SELECT * FROM mcp_confirmations WHERE status = 'pending' AND datetime(expires_at) > datetime('now') ORDER BY created_at DESC").all() as Record<string, unknown>[]).map(r => this.rowToMCPConfirmation(r));
    }

    updateMCPConfirmation(id: string, updates: { status?: MCPConfirmationStatus; user_response?: string }): boolean {
        const fields: string[] = [];
        const values: unknown[] = [];
        if ('status' in updates) { fields.push('status = ?'); values.push(updates.status); }
        if ('user_response' in updates) { fields.push('user_response = ?'); values.push(updates.user_response ?? null); }
        if (fields.length === 0) return false;
        fields.push("updated_at = datetime('now')");
        values.push(id);
        return this.db.prepare(`UPDATE mcp_confirmations SET ${fields.join(', ')} WHERE id = ?`).run(...values).changes > 0;
    }

    expireOldMCPConfirmations(): number {
        return Number(this.db.prepare("UPDATE mcp_confirmations SET status = 'expired', updated_at = datetime('now') WHERE status = 'pending' AND datetime(expires_at) <= datetime('now')").run().changes);
    }

    private rowToMCPConfirmation(row: Record<string, unknown>): MCPConfirmation {
        return {
            id: row.id as string, tool_name: row.tool_name as string,
            agent_name: row.agent_name as string, description: row.description as string,
            arguments_preview: row.arguments_preview as string,
            status: row.status as MCPConfirmationStatus,
            expires_at: row.expires_at as string,
            user_response: (row.user_response as string) ?? null,
            created_at: row.created_at as string, updated_at: row.updated_at as string,
        };
    }

    close(): void {
        if (this.db) {
            this.db.close();
        }
    }
}
