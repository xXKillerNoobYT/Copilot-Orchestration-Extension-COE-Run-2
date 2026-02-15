# 13 - Developer Implementation Plan: Program Designer v2.0

**Version:** 3.0
**Date:** February 13, 2026
**Status:** Specification — v2.0 core services IMPLEMENTED, webapp integration COMPLETE
**Scope:** API shapes, storage formats, sync protocols, component-to-code mappings, AI agent architecture
**Depends On**: [11 - PRD](11-Program-Designer-PRD.md), [12 - Agile Stories](12-Agile-Stories-and-Tasks.md)

**Changelog**:
| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Feb 8, 2026 | Initial type definitions and database schema |
| 2.0 | Feb 12, 2026 | Full 8-section implementation spec: types, DB, API, component mapping, sync, AI agent, events, phased schedule |
| 2.1 | Feb 13, 2026 | Added implementation status section with phase-by-phase tracking |
| 3.0 | Feb 13, 2026 | Standardized header, User/Dev views, migration & rollback strategy, cross-references |

### How to Read This Document

This is a pure engineering document. It contains production-ready TypeScript interfaces, SQL schemas, API endpoint definitions, and protocol specifications. Every section is directly implementable — copy the TypeScript code into the codebase.

> **As a User**: You typically do not need this document. It is the engineering blueprint for the features described in [11 - PRD](11-Program-Designer-PRD.md). If you want to understand what the system does, read the PRD. If you want to understand how it is built, read on.
>
> **As a Developer**: This is your primary reference during implementation. Sections are ordered by dependency: types first (§1), then database (§2), then API (§3), then higher-level systems (§4–7), then schedule (§8). Each section includes the exact code to write — interfaces, SQL DDL, API shapes, and event contracts.

---

## Table of Contents

1. [New Type Definitions](#section-1-new-type-definitions)
2. [Database Schema Changes](#section-2-database-schema-changes)
3. [API Shapes](#section-3-api-shapes)
4. [Component-to-Code Mapping Spec](#section-4-component-to-code-mapping-spec)
5. [Sync Protocol Design](#section-5-sync-protocol-design)
6. [AI Agent Architecture](#section-6-ai-agent-architecture)
7. [Event Bus Extensions](#section-7-event-bus-extensions)
8. [Phased Implementation Schedule](#section-8-phased-implementation-schedule)

---

## Section 1: New Type Definitions

All new interfaces are appended to `src/types/index.ts`. They build on the existing type system (DesignComponent, ComponentStyles, DesignPage, DesignToken, PageFlow, etc.) and add sync, ethics, coding agent, transparency, and component schema capabilities.

```typescript
// ============================================================
// Program Designer v2.0 — New Type Definitions
// Appended to src/types/index.ts
// ============================================================

// --- Enums for new subsystems ---

export enum SyncBackend {
    Cloud = 'cloud',
    NAS = 'nas',
    P2P = 'p2p'
}

export enum SyncStatus {
    Idle = 'idle',
    Syncing = 'syncing',
    Conflict = 'conflict',
    Error = 'error',
    Offline = 'offline'
}

export enum ConflictResolutionStrategy {
    LastWriteWins = 'last_write_wins',
    UserChoice = 'user_choice',
    Merge = 'merge',
    KeepLocal = 'keep_local',
    KeepRemote = 'keep_remote'
}

export enum EthicsSensitivity {
    Low = 'low',
    Medium = 'medium',
    High = 'high',
    Maximum = 'maximum'
}

export enum CodeDiffStatus {
    Pending = 'pending',
    Approved = 'approved',
    Rejected = 'rejected',
    Applied = 'applied'
}

export enum LogicBlockType {
    If = 'if',
    ElseIf = 'else_if',
    Else = 'else',
    Loop = 'loop',
    Switch = 'switch',
    TryCatch = 'try_catch'
}

// --- 1. ComponentSchema ---

export interface ComponentSchema {
    id: string;
    /** Component type identifier: matches DesignComponent.type or extended types */
    type: string;
    /** Human-readable display name */
    display_name: string;
    /** Category for grouping in the component library palette */
    category: 'primitive_input' | 'container' | 'interactive_logic' | 'data_sync' | 'ethics_rights' | 'display' | 'navigation' | 'custom';
    /** Description shown in the component library tooltip */
    description: string;
    /** Configurable properties with types, defaults, and validation */
    properties: ComponentSchemaProperty[];
    /** Events this component can emit */
    events: ComponentSchemaEvent[];
    /** Default styles applied when dragged onto canvas */
    default_styles: Partial<ComponentStyles>;
    /** Default dimensions (width x height) */
    default_size: { width: number; height: number };
    /** Code templates keyed by output format */
    code_templates: {
        react_tsx: string;
        html: string;
        css: string;
    };
    /** Icon identifier for the component palette (VS Code codicon name) */
    icon: string;
    /** Whether this is a container that can hold children */
    is_container: boolean;
    /** Allowed child component types (empty array = any, null = no children) */
    allowed_children: string[] | null;
    /** Minimum and maximum instance counts per page (null = unlimited) */
    instance_limits: { min: number; max: number | null };
    created_at: string;
    updated_at: string;
}

export interface ComponentSchemaProperty {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'color' | 'enum' | 'json' | 'expression';
    default_value: unknown;
    required: boolean;
    description: string;
    /** For enum types, the allowed values */
    enum_values?: string[];
    /** Validation constraints */
    validation?: {
        min?: number;
        max?: number;
        pattern?: string;
        max_length?: number;
    };
}

export interface ComponentSchemaEvent {
    name: string;
    description: string;
    /** TypeScript type signature for the event payload */
    payload_type: string;
    /** Example handler code */
    example_handler: string;
}

// --- 2. SyncConfig ---

export interface SyncConfig {
    id: string;
    /** Which sync backend to use */
    backend: SyncBackend;
    /** Backend-specific endpoint URL */
    endpoint: string;
    /** Reference to a stored credential (never store raw secrets) */
    credentials_ref: string;
    /** Whether sync is currently enabled */
    enabled: boolean;
    /** Auto-sync interval in seconds (0 = manual only) */
    auto_sync_interval_seconds: number;
    /** Conflict resolution default strategy */
    default_conflict_strategy: ConflictResolutionStrategy;
    /** Maximum file size to sync in bytes (default 50MB) */
    max_file_size_bytes: number;
    /** Directories/patterns to exclude from sync */
    exclude_patterns: string[];
    /** This device's unique identifier */
    device_id: string;
    /** Display name for this device */
    device_name: string;
    created_at: string;
    updated_at: string;
}

// --- 3. SyncState ---

export interface SyncState {
    device_id: string;
    device_name: string;
    status: SyncStatus;
    /** ISO timestamp of last successful sync */
    last_sync_at: string | null;
    /** Number of pending local changes */
    pending_changes: number;
    /** Number of unresolved conflicts */
    unresolved_conflicts: number;
    /** Current sync progress (0-100, null if not syncing) */
    progress_percent: number | null;
    /** Error message if status is 'error' */
    error_message: string | null;
    /** Vector clock for causal ordering */
    vector_clock: Record<string, number>;
}

// --- 4. SyncConflict ---

export interface SyncConflict {
    id: string;
    /** The entity type that conflicted */
    entity_type: 'design_component' | 'design_page' | 'design_token' | 'page_flow' | 'task' | 'plan';
    /** The entity ID */
    entity_id: string;
    /** JSON snapshot of the local version */
    local_version: string;
    /** JSON snapshot of the remote version */
    remote_version: string;
    /** Device ID that created the remote version */
    remote_device_id: string;
    /** ISO timestamp of local change */
    local_changed_at: string;
    /** ISO timestamp of remote change */
    remote_changed_at: string;
    /** The specific fields that conflict */
    conflicting_fields: string[];
    /** Current resolution status */
    resolution: ConflictResolutionStrategy | null;
    /** Who resolved it (device_id or 'auto') */
    resolved_by: string | null;
    /** ISO timestamp of resolution */
    resolved_at: string | null;
    created_at: string;
}

// --- 5. SyncChange ---

export interface SyncChange {
    id: string;
    /** The entity type that changed */
    entity_type: string;
    /** The entity ID */
    entity_id: string;
    /** Type of change */
    change_type: 'create' | 'update' | 'delete';
    /** Device that originated the change */
    device_id: string;
    /** SHA-256 hash of the entity state before the change */
    before_hash: string;
    /** SHA-256 hash of the entity state after the change */
    after_hash: string;
    /** JSON diff (RFC 6902 JSON Patch format) */
    patch: string;
    /** Monotonic sequence number per device */
    sequence_number: number;
    /** Whether this change has been synced to remote */
    synced: boolean;
    created_at: string;
}

// --- 6. EthicsModule ---

export interface EthicsModule {
    id: string;
    /** Human-readable module name (e.g. "Data Privacy", "Content Safety") */
    name: string;
    /** Detailed description of what this module governs */
    description: string;
    /** Whether this module is currently active */
    enabled: boolean;
    /** Sensitivity level controlling how strict the rules are */
    sensitivity: EthicsSensitivity;
    /** Broad action categories this module governs */
    scope: string[];
    /** Actions explicitly allowed under this module */
    allowed_actions: string[];
    /** Actions explicitly blocked under this module */
    blocked_actions: string[];
    /** Ordered list of rules within this module */
    rules: EthicsRule[];
    /** Version for tracking module updates */
    version: number;
    created_at: string;
    updated_at: string;
}

// --- 7. EthicsRule ---

export interface EthicsRule {
    id: string;
    /** Parent module ID */
    module_id: string;
    /** Human-readable rule name */
    name: string;
    /** Natural language description of the rule */
    description: string;
    /** The condition expression (evaluated against action context) */
    condition: string;
    /** What happens when the condition matches: 'allow', 'block', 'warn', 'audit' */
    action: 'allow' | 'block' | 'warn' | 'audit';
    /** Priority for rule evaluation order (lower = higher priority) */
    priority: number;
    /** Whether this rule is currently active */
    enabled: boolean;
    /** Optional message shown when rule triggers */
    message: string;
    created_at: string;
}

// --- 8. EthicsAuditEntry ---

export interface EthicsAuditEntry {
    id: string;
    /** The module that evaluated this action */
    module_id: string;
    /** The specific rule that triggered (null if no rule matched) */
    rule_id: string | null;
    /** The action that was evaluated */
    action_description: string;
    /** The evaluation result */
    decision: 'allowed' | 'blocked' | 'warned' | 'overridden';
    /** The agent or service that requested the action */
    requestor: string;
    /** Context JSON at the time of evaluation */
    context_snapshot: string;
    /** If overridden, who approved the override */
    override_by: string | null;
    /** Reason for override (if applicable) */
    override_reason: string | null;
    created_at: string;
}

// --- 9. CodingAgentRequest ---

export interface CodingAgentRequest {
    id: string;
    /** The natural language command from the user */
    command: string;
    /** Intent classification result */
    intent: 'generate_code' | 'explain_code' | 'modify_code' | 'build_logic' | 'refactor' | 'debug' | 'test';
    /** Target component IDs this command applies to */
    target_component_ids: string[];
    /** Target page ID context */
    page_id: string | null;
    /** Target plan ID context */
    plan_id: string | null;
    /** The output format requested */
    output_format: 'react_tsx' | 'html' | 'css' | 'typescript' | 'json';
    /** Additional constraints or preferences */
    constraints: Record<string, unknown>;
    /** Conversation session ID for multi-turn interactions */
    session_id: string | null;
    created_at: string;
}

// --- 10. CodingAgentResponse ---

export interface CodingAgentResponse {
    id: string;
    /** The request this responds to */
    request_id: string;
    /** Generated code (main output) */
    code: string;
    /** Language of the generated code */
    language: string;
    /** Natural language explanation of what was generated */
    explanation: string;
    /** Multiple output files if the generation spans several files */
    files: Array<{ name: string; content: string; language: string }>;
    /** Confidence score (0-100) */
    confidence: number;
    /** Warnings or suggestions */
    warnings: string[];
    /** Whether this response requires user approval before applying */
    requires_approval: boolean;
    /** The diff if this modifies existing code */
    diff: CodeDiff | null;
    /** Tokens consumed by the LLM */
    tokens_used: number;
    /** Processing time in milliseconds */
    duration_ms: number;
    created_at: string;
}

// --- 11. CodeDiff ---

export interface CodeDiff {
    id: string;
    /** Source request ID */
    request_id: string;
    /** The entity being modified (component, page, file) */
    entity_type: string;
    /** Entity ID */
    entity_id: string;
    /** Code before the change */
    before: string;
    /** Code after the change */
    after: string;
    /** Unified diff format string */
    unified_diff: string;
    /** Number of lines added */
    lines_added: number;
    /** Number of lines removed */
    lines_removed: number;
    /** Current approval status */
    status: CodeDiffStatus;
    /** Who approved/rejected */
    reviewed_by: string | null;
    /** Review comment */
    review_comment: string | null;
    created_at: string;
    updated_at: string;
}

// --- 12. LogicBlock ---

export interface LogicBlock {
    id: string;
    /** Parent page or component this logic belongs to */
    page_id: string | null;
    component_id: string | null;
    plan_id: string;
    /** Block type: if, else_if, else, loop, switch, try_catch */
    type: LogicBlockType;
    /** Display label in the visual editor */
    label: string;
    /** The condition expression (for if/else_if/loop/switch) */
    condition: string;
    /** The body code or nested block references */
    body: string;
    /** Parent block ID for nesting (null = top level) */
    parent_block_id: string | null;
    /** Ordering within the parent */
    sort_order: number;
    /** Generated TypeScript code from this block */
    generated_code: string;
    /** Visual position on canvas */
    x: number;
    y: number;
    width: number;
    height: number;
    /** Whether this block is collapsed in the visual editor */
    collapsed: boolean;
    created_at: string;
    updated_at: string;
}

// --- 13. DeviceInfo ---

export interface DeviceInfo {
    id: string;
    /** Unique device identifier (machine-generated UUID) */
    device_id: string;
    /** User-facing device name */
    name: string;
    /** Operating system identifier */
    os: string;
    /** Last known IP address or network identifier */
    last_address: string;
    /** Last time this device was seen online */
    last_seen_at: string;
    /** Whether this is the current device */
    is_current: boolean;
    /** Whether sync is enabled for this device */
    sync_enabled: boolean;
    /** Device-specific vector clock value */
    clock_value: number;
    created_at: string;
}

// --- 14. ActionLog ---

export interface ActionLog {
    id: string;
    /** Which subsystem performed the action */
    source: 'coding_agent' | 'ethics_engine' | 'sync_service' | 'designer_engine' | 'user' | 'system';
    /** Action category for filtering */
    category: 'code_generation' | 'ethics_decision' | 'sync_operation' | 'design_change' | 'configuration' | 'error';
    /** Human-readable action description */
    action: string;
    /** Detailed payload/context as JSON */
    detail: string;
    /** Severity level */
    severity: 'info' | 'warning' | 'error' | 'critical';
    /** Related entity type (optional) */
    entity_type: string | null;
    /** Related entity ID (optional) */
    entity_id: string | null;
    /** Device that originated the action */
    device_id: string | null;
    /** Session or request ID for correlation */
    correlation_id: string | null;
    /** Whether this entry has been synced to remote log */
    synced: boolean;
    created_at: string;
}
```

---

## Section 2: Database Schema Changes

### 2.1 New Table Definitions

All new tables are added to `src/core/database.ts` inside the `createTables()` method, following the existing pattern of `CREATE TABLE IF NOT EXISTS` with `datetime('now')` defaults.

```sql
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (module_id) REFERENCES ethics_modules(id),
    FOREIGN KEY (rule_id) REFERENCES ethics_rules(id)
);

CREATE INDEX IF NOT EXISTS idx_ethics_audit_module ON ethics_audit(module_id);
CREATE INDEX IF NOT EXISTS idx_ethics_audit_decision ON ethics_audit(decision);
CREATE INDEX IF NOT EXISTS idx_ethics_audit_created ON ethics_audit(created_at);

-- ==================== ACTION LOG ====================
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
```

### 2.2 CRUD Method Signatures

Add the following method signatures to the `Database` class in `src/core/database.ts`:

```typescript
// ==================== SYNC CONFIG ====================
getSyncConfig(): SyncConfig | null;
createSyncConfig(data: Partial<SyncConfig> & { device_id: string }): SyncConfig;
updateSyncConfig(id: string, updates: Partial<SyncConfig>): SyncConfig | null;

// ==================== SYNC CHANGES ====================
createSyncChange(data: Omit<SyncChange, 'id' | 'created_at'>): SyncChange;
getSyncChangesByEntity(entityType: string, entityId: string): SyncChange[];
getUnsyncedChanges(deviceId: string): SyncChange[];
markChangesSynced(ids: string[]): void;
getLatestSequenceNumber(deviceId: string): number;
getSyncChangesSince(deviceId: string, sequenceNumber: number): SyncChange[];

// ==================== SYNC CONFLICTS ====================
createSyncConflict(data: Omit<SyncConflict, 'id' | 'created_at'>): SyncConflict;
getSyncConflict(id: string): SyncConflict | null;
getUnresolvedConflicts(): SyncConflict[];
getConflictsByEntity(entityType: string, entityId: string): SyncConflict[];
resolveSyncConflict(id: string, resolution: ConflictResolutionStrategy, resolvedBy: string): void;

// ==================== ETHICS MODULES ====================
createEthicsModule(data: Partial<EthicsModule> & { name: string }): EthicsModule;
getEthicsModule(id: string): EthicsModule | null;
getAllEthicsModules(): EthicsModule[];
getEnabledEthicsModules(): EthicsModule[];
updateEthicsModule(id: string, updates: Partial<EthicsModule>): EthicsModule | null;
deleteEthicsModule(id: string): void;

// ==================== ETHICS RULES ====================
createEthicsRule(data: Omit<EthicsRule, 'id' | 'created_at'>): EthicsRule;
getEthicsRulesByModule(moduleId: string): EthicsRule[];
updateEthicsRule(id: string, updates: Partial<EthicsRule>): void;
deleteEthicsRule(id: string): void;

// ==================== ETHICS AUDIT ====================
createEthicsAuditEntry(data: Omit<EthicsAuditEntry, 'id' | 'created_at'>): EthicsAuditEntry;
getEthicsAuditLog(limit?: number, moduleId?: string): EthicsAuditEntry[];
getEthicsAuditByDecision(decision: string, limit?: number): EthicsAuditEntry[];

// ==================== ACTION LOG ====================
createActionLog(data: Omit<ActionLog, 'id' | 'created_at'>): ActionLog;
getActionLog(limit?: number, source?: string, category?: string): ActionLog[];
getActionLogByEntity(entityType: string, entityId: string): ActionLog[];
getActionLogByCorrelation(correlationId: string): ActionLog[];
getUnsyncedActionLogs(): ActionLog[];
markActionLogsSynced(ids: string[]): void;

// ==================== CODE DIFFS ====================
createCodeDiff(data: Omit<CodeDiff, 'id' | 'created_at' | 'updated_at'>): CodeDiff;
getCodeDiff(id: string): CodeDiff | null;
getCodeDiffsByStatus(status: CodeDiffStatus): CodeDiff[];
getPendingCodeDiffs(): CodeDiff[];
updateCodeDiff(id: string, updates: Partial<CodeDiff>): CodeDiff | null;

// ==================== LOGIC BLOCKS ====================
createLogicBlock(data: Partial<LogicBlock> & { plan_id: string; type: LogicBlockType }): LogicBlock;
getLogicBlock(id: string): LogicBlock | null;
getLogicBlocksByPage(pageId: string): LogicBlock[];
getLogicBlocksByComponent(componentId: string): LogicBlock[];
getLogicBlocksByPlan(planId: string): LogicBlock[];
getChildLogicBlocks(parentBlockId: string): LogicBlock[];
updateLogicBlock(id: string, updates: Partial<LogicBlock>): LogicBlock | null;
deleteLogicBlock(id: string): void;

// ==================== DEVICES ====================
registerDevice(data: Omit<DeviceInfo, 'id' | 'created_at'>): DeviceInfo;
getDevice(deviceId: string): DeviceInfo | null;
getAllDevices(): DeviceInfo[];
getCurrentDevice(): DeviceInfo | null;
updateDevice(deviceId: string, updates: Partial<DeviceInfo>): void;
removeDevice(deviceId: string): void;
incrementDeviceClock(deviceId: string): number;

// ==================== COMPONENT SCHEMAS ====================
createComponentSchema(data: Partial<ComponentSchema> & { type: string; display_name: string }): ComponentSchema;
getComponentSchema(type: string): ComponentSchema | null;
getComponentSchemaById(id: string): ComponentSchema | null;
getAllComponentSchemas(): ComponentSchema[];
getComponentSchemasByCategory(category: string): ComponentSchema[];
updateComponentSchema(id: string, updates: Partial<ComponentSchema>): ComponentSchema | null;
deleteComponentSchema(id: string): void;
```

---

## Section 3: API Shapes

### 3.1 SyncService (`src/core/sync-service.ts`)

```typescript
import { Database } from './database';
import { EventBus } from './event-bus';
import {
    SyncConfig, SyncState, SyncChange, SyncConflict,
    SyncBackend, ConflictResolutionStrategy, DeviceInfo
} from '../types';

export interface SyncAdapter {
    connect(config: SyncConfig): Promise<void>;
    disconnect(): Promise<void>;
    pushChanges(changes: SyncChange[]): Promise<{ accepted: string[]; rejected: string[] }>;
    pullChanges(since: number): Promise<SyncChange[]>;
    isConnected(): boolean;
}

export class SyncService {
    private adapter: SyncAdapter | null = null;
    private syncTimer: NodeJS.Timeout | null = null;

    constructor(
        private database: Database,
        private eventBus: EventBus,
        private outputChannel: { appendLine(msg: string): void }
    );

    /**
     * Configure the sync service with a backend and credentials.
     * Creates or updates the SyncConfig in the database.
     */
    async configure(config: Partial<SyncConfig>): Promise<SyncConfig>;

    /**
     * Perform a full sync cycle: push local changes, pull remote changes,
     * detect and surface conflicts. Returns the resulting sync state.
     */
    async sync(): Promise<SyncState>;

    /**
     * Resolve a specific conflict with the chosen strategy.
     * Applies the resolution and removes the conflict from the unresolved list.
     */
    async resolveConflict(
        conflictId: string,
        strategy: ConflictResolutionStrategy,
        resolvedBy: string
    ): Promise<void>;

    /**
     * Get the full change history for an entity, ordered by sequence number.
     */
    getHistory(entityType: string, entityId: string): SyncChange[];

    /**
     * Get the current sync status for this device.
     */
    getStatus(): SyncState;

    /**
     * Register a new device for multi-device sync.
     */
    async registerDevice(info: Omit<DeviceInfo, 'id' | 'created_at'>): Promise<DeviceInfo>;

    /**
     * Unregister a device and clean up its sync state.
     */
    async unregisterDevice(deviceId: string): Promise<void>;

    /**
     * Start auto-sync timer based on configured interval.
     */
    startAutoSync(): void;

    /**
     * Stop auto-sync timer.
     */
    stopAutoSync(): void;

    /**
     * Dispose: disconnect adapter, stop timers.
     */
    dispose(): void;
}
```

### 3.2 EthicsEngine (`src/core/ethics-engine.ts`)

```typescript
import { Database } from './database';
import { EventBus } from './event-bus';
import {
    EthicsModule, EthicsRule, EthicsAuditEntry,
    EthicsSensitivity
} from '../types';

export interface EthicsEvaluationResult {
    allowed: boolean;
    decision: 'allowed' | 'blocked' | 'warned';
    triggeredRules: EthicsRule[];
    messages: string[];
    auditEntryId: string;
}

export interface EthicsActionContext {
    action: string;
    source: string;
    targetEntityType?: string;
    targetEntityId?: string;
    metadata?: Record<string, unknown>;
}

export class EthicsEngine {
    constructor(
        private database: Database,
        private eventBus: EventBus,
        private outputChannel: { appendLine(msg: string): void }
    );

    /**
     * Evaluate whether an action is allowed by all active ethics modules.
     * Returns a detailed result with triggered rules and audit trail.
     */
    async evaluateAction(context: EthicsActionContext): Promise<EthicsEvaluationResult>;

    /**
     * Get all registered ethics modules.
     */
    getModules(): EthicsModule[];

    /**
     * Enable a specific ethics module.
     */
    enableModule(moduleId: string): void;

    /**
     * Disable a specific ethics module.
     */
    disableModule(moduleId: string): void;

    /**
     * Set the sensitivity level for a module.
     * Higher sensitivity = stricter rule evaluation.
     */
    setSensitivity(moduleId: string, sensitivity: EthicsSensitivity): void;

    /**
     * Get all actions currently allowed across all active modules.
     */
    getAllowedActions(): string[];

    /**
     * Get all actions currently blocked across all active modules.
     */
    getBlockedActions(): string[];

    /**
     * Get the ethics audit log, optionally filtered by module.
     */
    audit(limit?: number, moduleId?: string): EthicsAuditEntry[];

    /**
     * Create a new ethics module with default rules.
     */
    createModule(name: string, description: string, scope: string[]): EthicsModule;

    /**
     * Add a rule to an existing module.
     */
    addRule(moduleId: string, rule: Omit<EthicsRule, 'id' | 'module_id' | 'created_at'>): EthicsRule;

    /**
     * Override a blocked action (requires explicit justification).
     * Creates an audit entry with the override reason.
     */
    async override(
        auditEntryId: string,
        overrideBy: string,
        reason: string
    ): Promise<void>;
}
```

### 3.3 CodingAgentService (`src/core/coding-agent.ts`)

```typescript
import { LLMService } from './llm-service';
import { Database } from './database';
import { EthicsEngine } from './ethics-engine';
import { EventBus } from './event-bus';
import {
    CodingAgentRequest, CodingAgentResponse,
    CodeDiff, LogicBlock, DesignComponent
} from '../types';

export class CodingAgentService {
    constructor(
        private llmService: LLMService,
        private database: Database,
        private ethicsEngine: EthicsEngine,
        private eventBus: EventBus,
        private outputChannel: { appendLine(msg: string): void }
    );

    /**
     * Process a natural language command and return generated code,
     * explanations, or modifications. The command is classified by intent,
     * validated through the ethics engine, and then processed.
     */
    async processCommand(
        command: string,
        context: {
            page_id?: string;
            plan_id?: string;
            component_ids?: string[];
            session_id?: string;
            output_format?: string;
        }
    ): Promise<CodingAgentResponse>;

    /**
     * Generate code from a set of design components.
     * Uses the component schemas to produce framework-specific output.
     */
    async generateCode(
        componentIds: string[],
        format: 'react_tsx' | 'html' | 'css' | 'typescript' | 'json'
    ): Promise<CodingAgentResponse>;

    /**
     * Explain what a set of components or generated code does
     * in natural language.
     */
    async explainCode(
        code: string,
        context?: { component_ids?: string[]; page_id?: string }
    ): Promise<CodingAgentResponse>;

    /**
     * Build a visual logic tree from a natural language description.
     * Converts "when X happens, do Y, unless Z" into LogicBlock structures.
     */
    async buildLogicTree(
        description: string,
        context: { page_id?: string; plan_id: string; component_id?: string }
    ): Promise<LogicBlock[]>;

    /**
     * Get a specific code diff by ID.
     */
    getCodeDiff(diffId: string): CodeDiff | null;

    /**
     * Approve a pending code diff. Applies the change and updates the
     * target entity.
     */
    async approveCodeDiff(diffId: string, reviewedBy: string): Promise<void>;

    /**
     * Reject a pending code diff with an optional comment.
     */
    async rejectCodeDiff(
        diffId: string,
        reviewedBy: string,
        comment?: string
    ): Promise<void>;

    /**
     * Get all pending diffs awaiting review.
     */
    getPendingDiffs(): CodeDiff[];
}
```

### 3.4 ComponentSchemaService (`src/core/component-schema.ts`)

```typescript
import { Database } from './database';
import { ComponentSchema, ComponentSchemaProperty, ComponentSchemaEvent } from '../types';

export class ComponentSchemaService {
    constructor(private database: Database);

    /**
     * Get the schema definition for a specific component type.
     */
    getSchema(type: string): ComponentSchema | null;

    /**
     * Get all registered component schemas.
     */
    getAllSchemas(): ComponentSchema[];

    /**
     * Get schemas filtered by category (e.g. 'primitive_input', 'container').
     */
    getSchemasByCategory(category: string): ComponentSchema[];

    /**
     * Register a new custom component schema.
     * Validates the schema structure before saving.
     */
    registerCustomSchema(schema: Omit<ComponentSchema, 'id' | 'created_at' | 'updated_at'>): ComponentSchema;

    /**
     * Get the code template for a component type in a specific format.
     * Interpolates template variables with the provided props.
     */
    getCodeTemplate(
        type: string,
        format: 'react_tsx' | 'html' | 'css',
        props?: Record<string, unknown>
    ): string | null;

    /**
     * Get the default property values for a component type.
     */
    getDefaultProps(type: string): Record<string, unknown>;

    /**
     * Get the events a component type can emit.
     */
    getEvents(type: string): ComponentSchemaEvent[];

    /**
     * Seed the database with built-in component schemas.
     * Called during initialization if component_schemas table is empty.
     */
    seedBuiltInSchemas(): void;

    /**
     * Validate that a component instance conforms to its schema.
     */
    validateComponent(type: string, props: Record<string, unknown>): {
        valid: boolean;
        errors: string[];
    };
}
```

### 3.5 TransparencyLogger (`src/core/transparency-logger.ts`)

```typescript
import { Database } from './database';
import { EventBus } from './event-bus';
import { ActionLog, EthicsAuditEntry, SyncChange } from '../types';

export class TransparencyLogger {
    constructor(
        private database: Database,
        private eventBus: EventBus,
        private outputChannel: { appendLine(msg: string): void }
    );

    /**
     * Log a general action to the global action log.
     */
    logAction(
        source: ActionLog['source'],
        category: ActionLog['category'],
        action: string,
        detail: string,
        options?: {
            severity?: ActionLog['severity'];
            entityType?: string;
            entityId?: string;
            deviceId?: string;
            correlationId?: string;
        }
    ): ActionLog;

    /**
     * Log an ethics decision. Wraps the ethics audit entry
     * and also writes to the global action log for cross-referencing.
     */
    logEthicsDecision(entry: EthicsAuditEntry): ActionLog;

    /**
     * Log a sync change event to the global action log.
     */
    logSyncChange(change: SyncChange): ActionLog;

    /**
     * Get the global action log with optional filters.
     */
    getLog(options?: {
        limit?: number;
        source?: ActionLog['source'];
        category?: ActionLog['category'];
        severity?: ActionLog['severity'];
        since?: string;
        entityType?: string;
        entityId?: string;
    }): ActionLog[];

    /**
     * Export the entire action log (or a filtered subset) as JSON.
     * Returns a stringified JSON array suitable for file export.
     */
    exportLog(options?: {
        since?: string;
        until?: string;
        source?: ActionLog['source'];
    }): string;

    /**
     * Import action log entries from a JSON export.
     * Deduplicates by ID to prevent duplicates from re-import.
     */
    importLog(jsonData: string): { imported: number; skipped: number };
}
```

### 3.6 ConflictResolver (`src/core/conflict-resolver.ts`)

```typescript
import { Database } from './database';
import { EventBus } from './event-bus';
import {
    SyncConflict, SyncChange, ConflictResolutionStrategy
} from '../types';

export interface ResolutionSuggestion {
    strategy: ConflictResolutionStrategy;
    confidence: number;
    reason: string;
    preview: string;
}

export class ConflictResolver {
    constructor(
        private database: Database,
        private eventBus: EventBus,
        private outputChannel: { appendLine(msg: string): void }
    );

    /**
     * Detect conflicts between local and remote changes.
     * Compares field-level hashes and creates SyncConflict records
     * for any entities modified on both sides since last sync.
     */
    detectConflicts(
        localChanges: SyncChange[],
        remoteChanges: SyncChange[]
    ): SyncConflict[];

    /**
     * Suggest a resolution strategy for a conflict based on:
     * - Change recency (which is newer)
     * - Change magnitude (how many fields differ)
     * - Entity type priority (design components vs tokens)
     * Returns ranked suggestions with confidence scores.
     */
    suggestResolution(conflictId: string): ResolutionSuggestion[];

    /**
     * Apply a resolution strategy to a conflict.
     * Merges or overwrites the entity state and marks the conflict resolved.
     */
    async applyResolution(
        conflictId: string,
        strategy: ConflictResolutionStrategy,
        resolvedBy: string
    ): Promise<void>;

    /**
     * Get the history of resolved conflicts, optionally filtered by entity.
     */
    getConflictHistory(options?: {
        entityType?: string;
        entityId?: string;
        limit?: number;
    }): SyncConflict[];

    /**
     * Auto-resolve conflicts using the default strategy from SyncConfig.
     * Only resolves conflicts where the strategy is deterministic
     * (last_write_wins, keep_local, keep_remote). Leaves 'user_choice'
     * and 'merge' conflicts for manual resolution.
     */
    autoResolve(): { resolved: number; remaining: number };
}
```

---

## Section 4: Component-to-Code Mapping Spec

This section defines how each visual component type maps to generated code across all output formats. The `ComponentSchemaService` uses these mappings when seeding built-in schemas and when the `CodingAgentService` generates code.

### Group 1: Primitive Inputs

#### TextBox

| Format | Output |
|--------|--------|
| React TSX | `<input type="text" className="{name}" value={value} onChange={handleChange} placeholder="{placeholder}" />` |
| HTML | `<input type="text" class="{name}" value="{value}" placeholder="{placeholder}" />` |
| CSS | `.{name} { width: {width}px; height: {height}px; padding: 8px 12px; border: 1px solid #555; border-radius: 6px; background: #2a2a3e; color: #e0e0e0; font-size: 14px; }` |

**Props Interface:**
```typescript
interface TextBoxProps {
    value: string;
    placeholder: string;
    maxLength: number | null;
    disabled: boolean;
    readOnly: boolean;
    autocomplete: string;
}
```

#### SecureField

| Format | Output |
|--------|--------|
| React TSX | `<input type="password" className="{name}" value={value} onChange={handleChange} autoComplete="current-password" />` |
| HTML | `<input type="password" class="{name}" value="{value}" autocomplete="current-password" />` |
| CSS | `.{name} { width: {width}px; height: {height}px; padding: 8px 12px; border: 1px solid #555; border-radius: 6px; background: #2a2a3e; color: #e0e0e0; font-family: monospace; letter-spacing: 4px; }` |

**Props Interface:**
```typescript
interface SecureFieldProps {
    value: string;
    showToggle: boolean;
    minLength: number;
    autocomplete: string;
}
```

#### NumberField

| Format | Output |
|--------|--------|
| React TSX | `<input type="number" className="{name}" value={value} onChange={handleChange} min={min} max={max} step={step} />` |
| HTML | `<input type="number" class="{name}" value="{value}" min="{min}" max="{max}" step="{step}" />` |
| CSS | `.{name} { width: {width}px; height: {height}px; padding: 8px 12px; border: 1px solid #555; border-radius: 6px; background: #2a2a3e; color: #e0e0e0; }` |

**Props Interface:**
```typescript
interface NumberFieldProps {
    value: number;
    min: number | null;
    max: number | null;
    step: number;
    precision: number;
}
```

#### ToggleSwitch

| Format | Output |
|--------|--------|
| React TSX | `<label className="{name}"><input type="checkbox" checked={checked} onChange={handleToggle} /><span className="{name}-slider" /></label>` |
| HTML | `<label class="{name}"><input type="checkbox" /><span class="{name}-slider"></span></label>` |
| CSS | `.{name} { position: relative; display: inline-block; width: 48px; height: 24px; } .{name} input { opacity: 0; width: 0; height: 0; } .{name}-slider { position: absolute; inset: 0; background: #555; border-radius: 24px; transition: 0.3s; } .{name} input:checked + .{name}-slider { background: #6c63ff; }` |

**Props Interface:**
```typescript
interface ToggleSwitchProps {
    checked: boolean;
    label: string;
    disabled: boolean;
}
```

#### Checkbox

| Format | Output |
|--------|--------|
| React TSX | `<label className="{name}"><input type="checkbox" checked={checked} onChange={handleChange} /><span>{label}</span></label>` |
| HTML | `<label class="{name}"><input type="checkbox" /><span>{label}</span></label>` |
| CSS | `.{name} { display: flex; align-items: center; gap: 8px; cursor: pointer; color: #e0e0e0; }` |

**Props Interface:**
```typescript
interface CheckboxProps {
    checked: boolean;
    label: string;
    disabled: boolean;
    indeterminate: boolean;
}
```

#### RadioGroup

| Format | Output |
|--------|--------|
| React TSX | `<div className="{name}" role="radiogroup">{options.map(opt => (<label key={opt.value}><input type="radio" name="{name}" value={opt.value} checked={value === opt.value} onChange={handleChange} /><span>{opt.label}</span></label>))}</div>` |
| HTML | `<div class="{name}" role="radiogroup"><label><input type="radio" name="{name}" value="{value}" /><span>{label}</span></label></div>` |
| CSS | `.{name} { display: flex; flex-direction: column; gap: 8px; } .{name} label { display: flex; align-items: center; gap: 8px; cursor: pointer; color: #e0e0e0; }` |

**Props Interface:**
```typescript
interface RadioGroupProps {
    value: string;
    options: Array<{ value: string; label: string }>;
    orientation: 'horizontal' | 'vertical';
    disabled: boolean;
}
```

#### Slider

| Format | Output |
|--------|--------|
| React TSX | `<div className="{name}"><input type="range" min={min} max={max} step={step} value={value} onChange={handleChange} /><span className="{name}-value">{value}</span></div>` |
| HTML | `<div class="{name}"><input type="range" min="{min}" max="{max}" step="{step}" value="{value}" /><span class="{name}-value">{value}</span></div>` |
| CSS | `.{name} { display: flex; align-items: center; gap: 12px; } .{name} input[type="range"] { flex: 1; accent-color: #6c63ff; }` |

**Props Interface:**
```typescript
interface SliderProps {
    value: number;
    min: number;
    max: number;
    step: number;
    showValue: boolean;
}
```

#### Dropdown

| Format | Output |
|--------|--------|
| React TSX | `<select className="{name}" value={value} onChange={handleChange}>{options.map(opt => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}</select>` |
| HTML | `<select class="{name}"><option value="{value}">{label}</option></select>` |
| CSS | `.{name} { width: {width}px; height: {height}px; padding: 8px 12px; border: 1px solid #555; border-radius: 6px; background: #2a2a3e; color: #e0e0e0; appearance: none; }` |

**Props Interface:**
```typescript
interface DropdownProps {
    value: string;
    options: Array<{ value: string; label: string }>;
    placeholder: string;
    multiple: boolean;
    searchable: boolean;
}
```

#### DatePicker

| Format | Output |
|--------|--------|
| React TSX | `<input type="date" className="{name}" value={value} onChange={handleChange} min="{minDate}" max="{maxDate}" />` |
| HTML | `<input type="date" class="{name}" value="{value}" min="{minDate}" max="{maxDate}" />` |
| CSS | `.{name} { width: {width}px; height: {height}px; padding: 8px 12px; border: 1px solid #555; border-radius: 6px; background: #2a2a3e; color: #e0e0e0; color-scheme: dark; }` |

**Props Interface:**
```typescript
interface DatePickerProps {
    value: string;
    minDate: string | null;
    maxDate: string | null;
    format: string;
    showTime: boolean;
}
```

### Group 2: Containers / Layouts

#### Panel

| Format | Output |
|--------|--------|
| React TSX | `<div className="{name}">{children}</div>` |
| HTML | `<div class="{name}">{children}</div>` |
| CSS | `.{name} { position: {position}; left: {x}px; top: {y}px; width: {width}px; height: {height}px; padding: {padding}; background: {backgroundColor}; border-radius: {borderRadius}; border: {border}; overflow: {overflow}; display: {display}; flex-direction: {flexDirection}; gap: {gap}; }` |

#### TabView

| Format | Output |
|--------|--------|
| React TSX | `<div className="{name}"><div className="{name}-tabs" role="tablist">{tabs.map((tab, i) => (<button key={i} role="tab" aria-selected={activeTab === i} onClick={() => setActiveTab(i)}>{tab.label}</button>))}</div><div className="{name}-panel" role="tabpanel">{tabs[activeTab].content}</div></div>` |
| HTML | `<div class="{name}"><div class="{name}-tabs" role="tablist"><button role="tab">{label}</button></div><div class="{name}-panel" role="tabpanel">{content}</div></div>` |
| CSS | `.{name}-tabs { display: flex; border-bottom: 1px solid #555; } .{name}-tabs button { padding: 8px 16px; background: none; border: none; color: #999; cursor: pointer; } .{name}-tabs button[aria-selected="true"] { color: #6c63ff; border-bottom: 2px solid #6c63ff; } .{name}-panel { padding: 16px; }` |

#### SplitView

| Format | Output |
|--------|--------|
| React TSX | `<div className="{name}"><div className="{name}-left" style={{flex: splitRatio}}>{leftContent}</div><div className="{name}-divider" onMouseDown={handleDragStart} /><div className="{name}-right" style={{flex: 1 - splitRatio}}>{rightContent}</div></div>` |
| HTML | `<div class="{name}"><div class="{name}-left">{left}</div><div class="{name}-divider"></div><div class="{name}-right">{right}</div></div>` |
| CSS | `.{name} { display: flex; width: {width}px; height: {height}px; } .{name}-divider { width: 4px; background: #555; cursor: col-resize; } .{name}-left, .{name}-right { overflow: auto; }` |

#### Modal

| Format | Output |
|--------|--------|
| React TSX | `{isOpen && (<div className="{name}-overlay" onClick={onClose}><dialog className="{name}" open onClick={e => e.stopPropagation()}><header className="{name}-header"><h2>{title}</h2><button onClick={onClose}>&times;</button></header><div className="{name}-body">{children}</div><footer className="{name}-footer">{footer}</footer></dialog></div>)}` |
| HTML | `<div class="{name}-overlay"><dialog class="{name}" open><header class="{name}-header"><h2>{title}</h2><button>&times;</button></header><div class="{name}-body">{content}</div><footer class="{name}-footer">{footer}</footer></dialog></div>` |
| CSS | `.{name}-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 1000; } .{name} { background: #2a2a3e; border-radius: 12px; border: 1px solid #555; min-width: 400px; max-width: 90vw; color: #e0e0e0; }` |

#### Collapsible

| Format | Output |
|--------|--------|
| React TSX | `<div className="{name}"><button className="{name}-trigger" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}><span className="{name}-icon">{expanded ? '\\u25BC' : '\\u25B6'}</span>{title}</button>{expanded && <div className="{name}-content">{children}</div>}</div>` |
| HTML | `<details class="{name}"><summary class="{name}-trigger">{title}</summary><div class="{name}-content">{content}</div></details>` |
| CSS | `.{name}-trigger { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #333; border: none; color: #e0e0e0; cursor: pointer; width: 100%; } .{name}-content { padding: 12px; border-top: 1px solid #555; }` |

#### DataGrid

| Format | Output |
|--------|--------|
| React TSX | `<div className="{name}"><table><thead><tr>{columns.map(col => (<th key={col.key} onClick={() => handleSort(col.key)}>{col.label}</th>))}</tr></thead><tbody>{rows.map((row, i) => (<tr key={i}>{columns.map(col => (<td key={col.key}>{row[col.key]}</td>))}</tr>))}</tbody></table></div>` |
| HTML | `<div class="{name}"><table><thead><tr><th>{label}</th></tr></thead><tbody><tr><td>{value}</td></tr></tbody></table></div>` |
| CSS | `.{name} { width: {width}px; overflow: auto; } .{name} table { width: 100%; border-collapse: collapse; } .{name} th, .{name} td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #444; } .{name} th { background: #333; color: #ccc; font-weight: 600; position: sticky; top: 0; }` |

### Group 3: Interactive Logic

#### IF/THEN Block

Maps to a visual block on canvas with condition input and body slots. Generated TypeScript:

```typescript
// Visual representation: condition block with arrow to body
// Generated code pattern:
if ({condition}) {
    {body}
}
// With else:
if ({condition}) {
    {thenBody}
} else {
    {elseBody}
}
```

**Mapping rules:**
- Each `LogicBlock` with `type: 'if'` generates an `if` statement
- Nested `LogicBlock` with `type: 'else_if'` generates `else if` clauses
- Nested `LogicBlock` with `type: 'else'` generates the `else` clause
- The `condition` field is inserted verbatim as the conditional expression
- The `body` field contains either raw TypeScript or references to child blocks

#### Validation Block

Maps to a function that returns a validation result:

```typescript
// Generated pattern for a validation block:
function validate_{name}(value: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    {rules.map(rule => `if (${rule.condition}) { errors.push("${rule.message}"); }`).join('\n    ')}
    return { valid: errors.length === 0, errors };
}
```

#### Event Trigger

Maps to an event handler binding:

```typescript
// Generated pattern:
{targetElement}.addEventListener('{eventName}', ({eventParam}: {EventType}) => {
    {handlerBody}
});
// React equivalent:
<{Component} on{EventName}={({eventParam}: {EventType}) => {
    {handlerBody}
}} />
```

#### Script Block

Maps to an isolated function with sandboxing considerations:

```typescript
// Generated pattern with sandbox wrapper:
const {name}Result = (() => {
    'use strict';
    {userCode}
})();
```

### Group 4: Data & Sync

#### Storage Binding

Generates service integration code that connects a component to the database:

```typescript
// Generated pattern:
import { database } from '../core/database';

const {bindingName} = {
    get: () => database.get{EntityType}({entityId}),
    set: (value: {Type}) => database.update{EntityType}({entityId}, value),
    subscribe: (callback: (value: {Type}) => void) => {
        eventBus.on('{entityType}:updated', (event) => {
            if (event.data.id === '{entityId}') callback(event.data);
        });
    }
};
```

#### Sync Module

Generates sync service configuration and usage code:

```typescript
// Generated pattern:
import { SyncService } from '../core/sync-service';

await syncService.configure({
    backend: '{backend}',
    endpoint: '{endpoint}',
    auto_sync_interval_seconds: {interval},
});
await syncService.sync();
```

#### State Viewer

Generates a debug component that displays current state:

```typescript
// React TSX pattern:
export function StateViewer({ entityType, entityId }: { entityType: string; entityId: string }) {
    const [state, setState] = useState<unknown>(null);
    useEffect(() => {
        const data = database.get(entityType, entityId);
        setState(data);
    }, [entityType, entityId]);
    return <pre className="state-viewer">{JSON.stringify(state, null, 2)}</pre>;
}
```

#### Change History Viewer

Generates a component that displays the sync change log:

```typescript
// React TSX pattern:
export function ChangeHistoryViewer({ entityType, entityId }: Props) {
    const changes = database.getSyncChangesByEntity(entityType, entityId);
    return (
        <div className="change-history">
            {changes.map(change => (
                <div key={change.id} className="change-entry">
                    <span className="change-type">{change.change_type}</span>
                    <span className="change-device">{change.device_id}</span>
                    <span className="change-time">{change.created_at}</span>
                </div>
            ))}
        </div>
    );
}
```

### Group 5: Ethics & Rights

#### Freedom Module Card

Generates a UI card that controls an ethics module:

```typescript
// React TSX pattern:
export function FreedomModuleCard({ module }: { module: EthicsModule }) {
    return (
        <div className="freedom-module-card">
            <header>
                <h3>{module.name}</h3>
                <ToggleSwitch checked={module.enabled}
                    onChange={(enabled) => ethicsEngine.enableModule(module.id)} />
            </header>
            <p>{module.description}</p>
            <SensitivitySlider value={module.sensitivity}
                onChange={(s) => ethicsEngine.setSensitivity(module.id, s)} />
            <span className="rule-count">{module.rules.length} rules active</span>
        </div>
    );
}
```

#### Sensitivity Slider

Generates a specialized slider for ethics sensitivity:

```typescript
// React TSX pattern:
export function SensitivitySlider({ value, onChange }: Props) {
    const levels: EthicsSensitivity[] = ['low', 'medium', 'high', 'maximum'];
    const index = levels.indexOf(value);
    return (
        <div className="sensitivity-slider">
            <input type="range" min={0} max={3} value={index}
                onChange={(e) => onChange(levels[Number(e.target.value)])} />
            <div className="sensitivity-labels">
                {levels.map(l => <span key={l} className={l === value ? 'active' : ''}>{l}</span>)}
            </div>
        </div>
    );
}
```

#### Rule Table

Generates a data grid displaying ethics rules:

```typescript
// React TSX pattern:
export function EthicsRuleTable({ moduleId }: { moduleId: string }) {
    const rules = database.getEthicsRulesByModule(moduleId);
    return (
        <DataGrid
            columns={[
                { key: 'name', label: 'Rule' },
                { key: 'action', label: 'Action' },
                { key: 'priority', label: 'Priority' },
                { key: 'enabled', label: 'Active' },
            ]}
            rows={rules}
            onRowClick={(rule) => openRuleEditor(rule.id)}
        />
    );
}
```

#### Monitoring Controls

Generates a dashboard widget for real-time ethics monitoring:

```typescript
// React TSX pattern:
export function EthicsMonitor() {
    const [stats, setStats] = useState({ allowed: 0, blocked: 0, warned: 0 });
    useEffect(() => {
        const handler = (event: COEEvent) => {
            if (event.type === 'ethics:check') {
                setStats(prev => ({
                    ...prev,
                    [event.data.decision]: prev[event.data.decision] + 1
                }));
            }
        };
        eventBus.on('ethics:check', handler);
        return () => eventBus.off('ethics:check', handler);
    }, []);
    return (
        <div className="ethics-monitor">
            <div className="stat allowed">{stats.allowed} allowed</div>
            <div className="stat blocked">{stats.blocked} blocked</div>
            <div className="stat warned">{stats.warned} warned</div>
        </div>
    );
}
```

#### Transparency Log Viewer

Generates a component for viewing the global action log:

```typescript
// React TSX pattern:
export function TransparencyLogViewer({ limit = 50 }: { limit?: number }) {
    const logs = transparencyLogger.getLog({ limit });
    return (
        <div className="transparency-log">
            <div className="log-filters">
                <Dropdown options={['all','coding_agent','ethics_engine','sync_service']}
                    onChange={setSourceFilter} />
                <Dropdown options={['all','info','warning','error','critical']}
                    onChange={setSeverityFilter} />
            </div>
            <div className="log-entries">
                {logs.map(entry => (
                    <div key={entry.id} className={`log-entry severity-${entry.severity}`}>
                        <time>{entry.created_at}</time>
                        <span className="log-source">{entry.source}</span>
                        <span className="log-action">{entry.action}</span>
                        <span className="log-detail">{entry.detail}</span>
                    </div>
                ))}
            </div>
            <button onClick={() => exportLog()}>Export Log</button>
        </div>
    );
}
```

---

## Section 5: Sync Protocol Design

### 5.1 Overview

The sync protocol enables multi-device operation of COE, allowing designers to work on the same project from different machines. The protocol is eventually consistent with causal ordering via vector clocks, and uses a pluggable transport layer.

### 5.2 Distributed Locking Mechanism

COE uses **advisory locks** rather than mandatory locks to avoid deadlocks in a P2P topology.

**Lock acquisition:**
```
1. Device A writes a lock record to sync_changes:
   { entity_type: '_lock', entity_id: '{target_entity_id}', change_type: 'create',
     device_id: 'A', patch: '{"holder":"A","expires":"<ISO+5min>"}' }
2. On next sync, other devices see the lock and enter advisory-only mode.
3. Advisory mode: other devices CAN still modify the entity locally,
   but the sync will flag it as a conflict when pushed.
4. Lock expires automatically after 5 minutes or is explicitly released.
```

**Lock release:**
```
1. Device A writes a release record:
   { entity_type: '_lock', entity_id: '{target_entity_id}', change_type: 'delete',
     device_id: 'A', patch: '{"released":true}' }
```

**Why advisory:** Mandatory locks in a distributed system cause deadlocks and starvation. Advisory locks surface intent while allowing progress. Conflicts are handled by the resolution algorithm.

### 5.3 Change Detection

**Field-level hashing:**
```
For each entity tracked by sync:
1. Serialize the entity to a canonical JSON form (sorted keys, no whitespace).
2. Compute SHA-256 hash of the canonical JSON = entity_hash.
3. For each mutable field, compute SHA-256 of that field's serialized value = field_hash.
4. Store entity_hash as after_hash in SyncChange.
5. Compare field hashes to detect which specific fields changed.
```

**Change recording flow:**
```
1. Any database write (create/update/delete) triggers a change record.
2. The change record contains:
   - entity_type + entity_id (what changed)
   - before_hash + after_hash (state fingerprints)
   - patch: RFC 6902 JSON Patch format diff
   - sequence_number: monotonically increasing per device
3. Change records are stored locally in sync_changes table.
4. On sync, unsynced changes (synced=0) are pushed to the remote.
```

### 5.4 Conflict Resolution Algorithm

```
DETECT_CONFLICTS(local_changes[], remote_changes[]):
    conflicts = []
    for each remote_change in remote_changes:
        // Find if the same entity was also changed locally since last sync
        local_match = local_changes.find(lc =>
            lc.entity_type == remote_change.entity_type &&
            lc.entity_id == remote_change.entity_id &&
            lc.sequence_number > last_sync_sequence)

        if local_match exists:
            // Both sides modified the same entity
            conflicting_fields = compute_field_diff(local_match.patch, remote_change.patch)
            if conflicting_fields.length > 0:
                conflicts.push(new SyncConflict(
                    entity_type, entity_id,
                    local_version, remote_version,
                    conflicting_fields
                ))
            else:
                // Different fields changed — auto-merge is safe
                merged = merge_patches(local_match.patch, remote_change.patch)
                apply_patch(entity, merged)

    return conflicts

RESOLVE_CONFLICT(conflict, strategy):
    switch strategy:
        case 'last_write_wins':
            if conflict.remote_changed_at > conflict.local_changed_at:
                apply(conflict.remote_version)
            else:
                keep(conflict.local_version)

        case 'keep_local':
            keep(conflict.local_version)
            push_as_resolution(conflict.local_version)

        case 'keep_remote':
            apply(conflict.remote_version)

        case 'merge':
            // Three-way merge using common ancestor
            ancestor = get_entity_at_sequence(conflict.entity_id, last_sync_sequence)
            merged = three_way_merge(ancestor, conflict.local_version, conflict.remote_version)
            apply(merged)

        case 'user_choice':
            // Present both versions to user in UI
            // Wait for explicit selection
            defer_to_ui(conflict)

    mark_conflict_resolved(conflict.id, strategy, resolver)
```

### 5.5 Transport Adapters

Each adapter implements the `SyncAdapter` interface:

#### CloudSyncAdapter

```typescript
/**
 * Syncs via HTTPS to a cloud REST endpoint.
 * - Push: POST /sync/changes { device_id, changes[] }
 * - Pull: GET  /sync/changes?since={sequence}&device_id={id}
 * - Auth: Bearer token from credentials_ref
 * - Retry: exponential backoff, max 3 attempts
 */
export class CloudSyncAdapter implements SyncAdapter {
    async connect(config: SyncConfig): Promise<void>;
    async disconnect(): Promise<void>;
    async pushChanges(changes: SyncChange[]): Promise<{ accepted: string[]; rejected: string[] }>;
    async pullChanges(since: number): Promise<SyncChange[]>;
    isConnected(): boolean;
}
```

#### NASSyncAdapter

```typescript
/**
 * Syncs via file system to a NAS/shared folder path.
 * - Push: Write changes as JSON files to {endpoint}/sync/{device_id}/{sequence}.json
 * - Pull: Read JSON files from {endpoint}/sync/*/since_{sequence}.json
 * - Lock: Uses file-based locks ({endpoint}/sync/.lock_{entity_id})
 * - No auth (relies on file system permissions)
 */
export class NASSyncAdapter implements SyncAdapter {
    async connect(config: SyncConfig): Promise<void>;
    async disconnect(): Promise<void>;
    async pushChanges(changes: SyncChange[]): Promise<{ accepted: string[]; rejected: string[] }>;
    async pullChanges(since: number): Promise<SyncChange[]>;
    isConnected(): boolean;
}
```

#### P2PSyncAdapter

```typescript
/**
 * Syncs peer-to-peer using WebSocket connections.
 * - Discovery: mDNS/Bonjour on local network, or manual endpoint entry
 * - Push: WebSocket message { type: 'sync_push', changes[] }
 * - Pull: WebSocket message { type: 'sync_pull', since }
 * - Response: WebSocket message { type: 'sync_data', changes[] }
 * - Auth: Shared secret from credentials_ref (HMAC-signed messages)
 */
export class P2PSyncAdapter implements SyncAdapter {
    async connect(config: SyncConfig): Promise<void>;
    async disconnect(): Promise<void>;
    async pushChanges(changes: SyncChange[]): Promise<{ accepted: string[]; rejected: string[] }>;
    async pullChanges(since: number): Promise<SyncChange[]>;
    isConnected(): boolean;
}
```

### 5.6 Sync Message Format

All sync messages use a common JSON envelope:

```json
{
    "version": "1.0",
    "type": "sync_push | sync_pull | sync_data | sync_ack | sync_conflict | sync_resolve",
    "device_id": "uuid-of-sender",
    "timestamp": "2026-02-12T00:00:00.000Z",
    "vector_clock": { "device_a": 42, "device_b": 37 },
    "payload": {
        "changes": [
            {
                "id": "change-uuid",
                "entity_type": "design_component",
                "entity_id": "component-uuid",
                "change_type": "update",
                "device_id": "device-a-uuid",
                "before_hash": "sha256...",
                "after_hash": "sha256...",
                "patch": "[{\"op\":\"replace\",\"path\":\"/x\",\"value\":100}]",
                "sequence_number": 42,
                "created_at": "2026-02-12T00:00:00.000Z"
            }
        ]
    },
    "checksum": "sha256-of-payload"
}
```

### 5.7 Retry and Error Handling

```
SYNC_WITH_RETRY(adapter, changes, maxRetries=3):
    for attempt in 1..maxRetries:
        try:
            result = adapter.pushChanges(changes)
            if result.rejected.length > 0:
                // Some changes rejected (likely conflicts)
                handle_rejections(result.rejected)
            mark_synced(result.accepted)
            return SUCCESS

        catch NetworkError:
            wait = min(2^attempt * 1000, 30000)  // 2s, 4s, 8s... max 30s
            log("Sync attempt {attempt} failed, retrying in {wait}ms")
            sleep(wait)

        catch AuthError:
            emit('sync:error', { reason: 'authentication_failed' })
            return FAIL  // Don't retry auth errors

        catch TimeoutError:
            if attempt < maxRetries:
                continue  // Retry timeouts
            emit('sync:error', { reason: 'timeout', attempts: maxRetries })
            return FAIL

    emit('sync:error', { reason: 'max_retries_exceeded' })
    set_status(SyncStatus.Error)
    return FAIL
```

---

## Section 6: AI Agent Architecture

### 6.1 Intent Classification Pipeline

The coding agent reuses the existing `LLMService.classify()` method with a specialized set of categories:

```
CLASSIFY_INTENT(command: string):
    categories = [
        'generate_code',   // "Create a login form", "Build me a dashboard"
        'explain_code',    // "What does this component do?", "Explain the layout"
        'modify_code',     // "Change the button color", "Move the header"
        'build_logic',     // "When user clicks, show modal", "If logged in, redirect"
        'refactor',        // "Simplify this layout", "Extract to component"
        'debug',           // "Why isn't the click working?", "Fix the alignment"
        'test'             // "Test this component", "Verify the form validation"
    ]

    // Step 1: Keyword pre-filter for fast classification
    keyword_scores = compute_keyword_scores(command, {
        'generate_code': ['create', 'build', 'make', 'generate', 'add', 'new'],
        'explain_code':  ['explain', 'what', 'how', 'describe', 'tell me'],
        'modify_code':   ['change', 'update', 'modify', 'move', 'resize', 'edit'],
        'build_logic':   ['when', 'if', 'then', 'trigger', 'on click', 'validate'],
        'refactor':      ['simplify', 'refactor', 'extract', 'clean up', 'optimize'],
        'debug':         ['fix', 'bug', 'error', 'wrong', 'broken', 'why'],
        'test':          ['test', 'verify', 'check', 'assert', 'validate']
    })

    // Step 2: If keyword match is confident (score > 0.8), skip LLM
    if max(keyword_scores) > 0.8:
        return category_with_max_score

    // Step 3: LLM classification for ambiguous commands
    return llmService.classify(command, categories)
```

### 6.2 Code Generation Pipeline

```
GENERATE_CODE(components[], format, context):
    // Stage 1: Design Analysis
    component_schemas = components.map(c => schemaService.getSchema(c.type))
    page_context = database.getDesignPage(context.page_id)
    tokens = database.getDesignTokensByPlan(context.plan_id)

    // Stage 2: AST Construction (abstract syntax tree representation)
    ast = {
        type: 'Document',
        imports: [],
        components: [],
        styles: [],
        logic: []
    }

    for each component in components:
        schema = component_schemas[component.type]
        template = schema.code_templates[format]

        // Interpolate template with component props and styles
        code_node = interpolate_template(template, {
            name: component.name,
            props: component.props,
            styles: apply_design_tokens(component.styles, tokens),
            children: get_children(component.id, components),
            position: { x: component.x, y: component.y, w: component.width, h: component.height }
        })

        ast.components.push(code_node)

        // Resolve design tokens in styles
        style_node = generate_styles(component, tokens, format)
        ast.styles.push(style_node)

    // Stage 3: Logic Block Integration
    logic_blocks = database.getLogicBlocksByPage(context.page_id)
    for each block in logic_blocks:
        ast.logic.push(transpile_logic_block(block))

    // Stage 4: Code Emission
    output = emit_code(ast, format)

    // Stage 5: Format and Clean
    output = format_code(output, { indent: 2, lineWidth: 100 })

    return output
```

### 6.3 Diff Generation and Approval Flow

```
GENERATE_DIFF(request, old_code, new_code):
    // Step 1: Compute unified diff
    diff = unified_diff(old_code, new_code, {
        context_lines: 3,
        header: `--- a/${entity_name}\n+++ b/${entity_name}`
    })

    lines_added = count_lines_starting_with('+', diff)
    lines_removed = count_lines_starting_with('-', diff)

    // Step 2: Create CodeDiff record
    code_diff = database.createCodeDiff({
        request_id: request.id,
        entity_type: request.target_entity_type,
        entity_id: request.target_entity_id,
        before: old_code,
        after: new_code,
        unified_diff: diff,
        lines_added,
        lines_removed,
        status: 'pending'
    })

    // Step 3: Emit event for UI to show approval dialog
    eventBus.emit('agent:diff_pending', 'coding_agent', {
        diff_id: code_diff.id,
        lines_added,
        lines_removed,
        preview: diff.substring(0, 500)
    })

    // Step 4: Wait for approval (async — the response returns immediately
    //          with requires_approval: true)
    return code_diff

APPROVE_DIFF(diff_id, reviewer):
    diff = database.getCodeDiff(diff_id)
    if diff.status !== 'pending': throw Error('Diff already resolved')

    // Apply the change to the target entity
    apply_code_to_entity(diff.entity_type, diff.entity_id, diff.after)

    // Update diff status
    database.updateCodeDiff(diff_id, {
        status: 'approved',
        reviewed_by: reviewer
    })

    eventBus.emit('agent:diff_approved', 'coding_agent', { diff_id })
    transparencyLogger.logAction('coding_agent', 'code_generation',
        'Code diff approved', `Diff ${diff_id} approved by ${reviewer}`)

REJECT_DIFF(diff_id, reviewer, comment):
    database.updateCodeDiff(diff_id, {
        status: 'rejected',
        reviewed_by: reviewer,
        review_comment: comment
    })

    eventBus.emit('agent:diff_rejected', 'coding_agent', { diff_id, comment })
```

### 6.4 Ethical Validation Gate

Every code generation request passes through the ethics engine before producing output:

```
ETHICS_GATE(request, generated_code):
    // Step 1: Evaluate the request intent
    intent_check = ethicsEngine.evaluateAction({
        action: `code_generation:${request.intent}`,
        source: 'coding_agent',
        targetEntityType: request.target_entity_type,
        targetEntityId: request.target_entity_id,
        metadata: {
            command: request.command,
            output_format: request.output_format
        }
    })

    if !intent_check.allowed:
        return BLOCKED(intent_check.messages)

    // Step 2: Scan generated code for blocked patterns
    code_check = ethicsEngine.evaluateAction({
        action: 'code_output_scan',
        source: 'coding_agent',
        metadata: {
            code: generated_code,
            language: request.output_format,
            patterns_to_check: [
                'external_network_calls',
                'file_system_access',
                'process_execution',
                'credential_exposure',
                'infinite_loops',
                'resource_exhaustion'
            ]
        }
    })

    if !code_check.allowed:
        return BLOCKED(code_check.messages)

    // Step 3: Log the approval
    transparencyLogger.logAction('ethics_engine', 'ethics_decision',
        'Code generation approved',
        JSON.stringify({ request_id: request.id, checks_passed: 2 }))

    return APPROVED
```

### 6.5 Sandboxing Strategy for Script Blocks

Script blocks (user-authored code embedded in designs) run in a restricted environment:

```
SANDBOX_EXECUTION(script_code):
    // Strategy: Use vm module with restricted context (Node.js)
    // or iframe sandbox (browser webview)

    // Node.js approach (for server-side/extension code):
    allowed_globals = {
        console: { log: safe_log, warn: safe_warn, error: safe_error },
        Math, Date, JSON, String, Number, Boolean, Array, Object,
        Map, Set, Promise, Symbol,
        setTimeout: restricted_timeout(max=5000),
        setInterval: BLOCKED,
        fetch: BLOCKED,
        require: BLOCKED,
        process: BLOCKED,
        __dirname: BLOCKED,
        __filename: BLOCKED
    }

    execution_limits = {
        timeout_ms: 5000,
        memory_limit_mb: 50,
        max_iterations: 100000
    }

    // Browser approach (for webview rendering):
    // Use iframe with sandbox="allow-scripts" (no allow-same-origin)
    // CSP: script-src 'unsafe-inline'; connect-src 'none';

    result = execute_in_sandbox(script_code, allowed_globals, execution_limits)
    return result
```

### 6.6 Natural Language to Logic Block Conversion

```
NL_TO_LOGIC_BLOCKS(description, context):
    // Step 1: Prompt the LLM to decompose the description into structured logic
    system_prompt = """
    Convert the following natural language description into a structured
    logic tree. Output JSON with this schema:
    {
        "blocks": [
            {
                "type": "if | else_if | else | loop | switch | try_catch",
                "label": "human-readable label",
                "condition": "TypeScript expression (for if/else_if/loop/switch)",
                "body": "TypeScript code for the block body",
                "children": [ ...nested blocks... ]
            }
        ]
    }
    Keep conditions as valid TypeScript expressions.
    Keep body code minimal and clear.
    Use children for nested logic.
    """

    response = llmService.chat([
        { role: 'system', content: system_prompt },
        { role: 'user', content: description }
    ], { temperature: 0.2, stream: false })

    // Step 2: Parse the LLM output
    parsed = JSON.parse(extract_json(response.content))

    // Step 3: Create LogicBlock records in database
    blocks = []
    for each block_spec in parsed.blocks:
        block = create_logic_block_recursive(block_spec, context, null)
        blocks.push(block)

    // Step 4: Generate TypeScript code for each block
    for each block in blocks:
        block.generated_code = transpile_block_to_typescript(block)
        database.updateLogicBlock(block.id, { generated_code: block.generated_code })

    return blocks

CREATE_LOGIC_BLOCK_RECURSIVE(spec, context, parent_id):
    block = database.createLogicBlock({
        plan_id: context.plan_id,
        page_id: context.page_id,
        component_id: context.component_id,
        type: spec.type,
        label: spec.label,
        condition: spec.condition || '',
        body: spec.body || '',
        parent_block_id: parent_id,
        sort_order: auto_increment
    })

    if spec.children:
        for each child_spec in spec.children:
            create_logic_block_recursive(child_spec, context, block.id)

    return block
```

---

## Section 7: Event Bus Extensions

Add the following event types to the `COEEventType` union in `src/core/event-bus.ts`:

```typescript
export type COEEventType =
    // ... (existing 47 event types remain unchanged) ...

    // ==================== NEW: Sync Events ====================
    | 'sync:started'            // Sync cycle began
    | 'sync:completed'          // Sync cycle completed successfully
    | 'sync:failed'             // Sync cycle failed with error
    | 'sync:conflict'           // Conflict detected during sync
    | 'sync:resolved'           // Conflict was resolved
    | 'sync:device_registered'  // New device joined sync
    | 'sync:device_removed'     // Device left sync
    | 'sync:progress'           // Sync progress update (percentage)

    // ==================== NEW: Ethics Events ====================
    | 'ethics:check'            // Ethics evaluation performed
    | 'ethics:blocked'          // Action blocked by ethics engine
    | 'ethics:warned'           // Action allowed with warning
    | 'ethics:override'         // Blocked action overridden by user
    | 'ethics:module_enabled'   // Ethics module enabled
    | 'ethics:module_disabled'  // Ethics module disabled
    | 'ethics:rule_triggered'   // Specific rule was triggered

    // ==================== NEW: Coding Agent Events ====================
    | 'agent:command'           // Natural language command received
    | 'agent:classifying'       // Intent classification in progress
    | 'agent:generating'        // Code generation in progress
    | 'agent:completed'         // Code generation completed
    | 'agent:diff_pending'      // Code diff awaiting approval
    | 'agent:diff_approved'     // Code diff approved
    | 'agent:diff_rejected'     // Code diff rejected
    | 'agent:logic_built'       // Logic tree constructed
    | 'agent:ethics_blocked'    // Agent action blocked by ethics

    // ==================== NEW: Transparency Events ====================
    | 'transparency:action_logged'  // New entry in action log
    | 'transparency:log_exported'   // Action log exported
    | 'transparency:log_imported'   // Action log imported

    // ==================== NEW: Component Schema Events ====================
    | 'schema:registered'       // New component schema registered
    | 'schema:updated'          // Component schema updated
    | 'schema:deleted'          // Component schema deleted

    // Wildcard (already exists)
    | '*';
```

**Event payload contracts (data field):**

| Event | Required data fields |
|-------|---------------------|
| `sync:started` | `{ device_id: string }` |
| `sync:completed` | `{ device_id: string, pushed: number, pulled: number, conflicts: number }` |
| `sync:failed` | `{ device_id: string, error: string }` |
| `sync:conflict` | `{ conflict_id: string, entity_type: string, entity_id: string }` |
| `sync:resolved` | `{ conflict_id: string, strategy: string, resolved_by: string }` |
| `ethics:check` | `{ module_id: string, action: string, decision: string }` |
| `ethics:blocked` | `{ module_id: string, rule_id: string, action: string, message: string }` |
| `ethics:override` | `{ audit_entry_id: string, override_by: string, reason: string }` |
| `agent:command` | `{ request_id: string, command: string, intent: string }` |
| `agent:generating` | `{ request_id: string, format: string }` |
| `agent:completed` | `{ request_id: string, confidence: number, tokens_used: number }` |
| `agent:diff_pending` | `{ diff_id: string, lines_added: number, lines_removed: number }` |
| `agent:diff_approved` | `{ diff_id: string }` |
| `agent:diff_rejected` | `{ diff_id: string, comment: string }` |
| `transparency:action_logged` | `{ log_id: string, source: string, category: string }` |

---

## Section 8: Phased Implementation Schedule

### Phase 1: Foundation (Weeks 1-2)

**Goal:** Establish all new types, database tables, and the component schema service. This phase has zero runtime dependencies and can be developed and tested in isolation.

**Files to create:**
| File | Description | Effort |
|------|-------------|--------|
| `src/types/index.ts` | Add all 14 new interfaces and enums from Section 1 | 4h |
| `src/core/database.ts` | Add 11 new tables, indexes, and ~45 CRUD methods | 8h |
| `src/core/component-schema.ts` | ComponentSchemaService with built-in schema seeding | 6h |
| `src/core/transparency-logger.ts` | TransparencyLogger service | 4h |
| `tests/component-schema.test.ts` | Tests for schema CRUD, validation, code templates | 3h |
| `tests/transparency-logger.test.ts` | Tests for logging, export, import | 2h |
| `tests/database-v2.test.ts` | Tests for all new database tables and CRUD | 6h |

**Files to modify:**
| File | Change | Effort |
|------|--------|--------|
| `src/core/event-bus.ts` | Add ~30 new event types to the union | 1h |
| `src/webapp/api.ts` | Add REST endpoints for new tables (ethics, sync, schemas, diffs, logic blocks) | 6h |

**Phase 1 Total:** ~40 hours (1 developer, 2 weeks at 20h/week)

**Exit criteria:**
- All new types compile with `npx tsc --noEmit`
- All new database tables create successfully
- All CRUD methods have passing tests
- Component schema seeding populates 15+ built-in schemas
- Event bus extensions compile and emit correctly

---

### Phase 2: Designer Enhancement (Weeks 3-5)

**Goal:** Build the enhanced canvas webview with the full component library, properties panel, layout templates, and code export improvements.

**Files to create:**
| File | Description | Effort |
|------|-------------|--------|
| `src/views/designer-canvas.ts` | VS Code webview panel: canvas rendering, drag-and-drop, selection, properties panel | 16h |
| `src/views/component-palette.ts` | Webview sidebar: searchable component library organized by category | 6h |
| `src/views/properties-panel.ts` | Webview sidebar: property editor dynamically built from ComponentSchema | 6h |
| `src/views/code-preview.ts` | Webview panel: live code preview in React/HTML/CSS | 4h |
| `src/views/logic-editor.ts` | Webview panel: visual IF/THEN/ELSE block editor | 8h |
| `tests/designer-canvas.test.ts` | Tests for canvas operations, selection, drag-and-drop | 4h |
| `tests/logic-editor.test.ts` | Tests for logic block CRUD and code generation | 3h |

**Files to modify:**
| File | Change | Effort |
|------|--------|--------|
| `src/core/designer-engine.ts` | Add logic block layout, component schema integration, enhanced code export | 8h |
| `src/commands.ts` | Add commands: open designer, toggle palette, export code, import design | 3h |
| `src/extension.ts` | Register new webview providers and commands | 2h |
| `package.json` | Add new commands, views, and activation events | 1h |

**Phase 2 Total:** ~61 hours (1 developer, 3 weeks at ~20h/week)

**Exit criteria:**
- Designer canvas opens in VS Code and renders components
- Components can be dragged from palette to canvas
- Properties panel updates component props in real-time
- Code preview shows live React TSX / HTML / CSS output
- Logic blocks can be created, nested, and generate TypeScript
- All 15+ component types render correctly on canvas

---

### Phase 3: AI Agent Layer (Weeks 6-8)

**Goal:** Implement the coding agent service, ethics engine, and the full code generation pipeline with diff approval flow.

**Files to create:**
| File | Description | Effort |
|------|-------------|--------|
| `src/core/coding-agent.ts` | CodingAgentService: intent classification, code gen, diff flow | 12h |
| `src/core/ethics-engine.ts` | EthicsEngine: module management, rule evaluation, audit | 10h |
| `src/core/conflict-resolver.ts` | ConflictResolver: detection, suggestions, resolution | 6h |
| `tests/coding-agent.test.ts` | Tests for intent classification, code gen, diff approval/rejection | 6h |
| `tests/ethics-engine.test.ts` | Tests for rule evaluation, module management, audit trail | 4h |
| `tests/conflict-resolver.test.ts` | Tests for conflict detection, resolution strategies | 3h |

**Files to modify:**
| File | Change | Effort |
|------|--------|--------|
| `src/core/llm-service.ts` | No changes needed (reuse existing classify/chat) | 0h |
| `src/agents/orchestrator.ts` | Add routing for coding agent commands | 3h |
| `src/mcp/server.ts` | Add MCP tools: generateCode, approveCodeDiff, evaluateEthics | 4h |
| `src/webapp/api.ts` | Add REST endpoints: POST /api/agent/command, GET /api/diffs, POST /api/ethics/evaluate | 4h |
| `src/views/designer-canvas.ts` | Integrate coding agent commands (natural language input bar) | 3h |
| `src/views/code-preview.ts` | Add diff view with approve/reject buttons | 3h |

**Phase 3 Total:** ~58 hours (1 developer, 3 weeks at ~20h/week)

**Exit criteria:**
- Natural language commands produce code output
- Intent classification routes to correct pipeline
- Ethics engine blocks dangerous code patterns
- Diff approval flow works end-to-end (generate, review, approve/reject)
- Logic block conversion from natural language works
- All ethics decisions appear in audit trail

---

### Phase 4: Sync Layer (Weeks 9-11)

**Goal:** Implement multi-device sync with all three transport adapters, conflict resolution, and the transparency log.

**Files to create:**
| File | Description | Effort |
|------|-------------|--------|
| `src/core/sync-service.ts` | SyncService: orchestration, adapter management, auto-sync | 10h |
| `src/core/sync-adapters/cloud.ts` | CloudSyncAdapter: HTTPS REST transport | 6h |
| `src/core/sync-adapters/nas.ts` | NASSyncAdapter: File system transport | 6h |
| `src/core/sync-adapters/p2p.ts` | P2PSyncAdapter: WebSocket transport | 8h |
| `src/views/sync-dashboard.ts` | Webview panel: sync status, device list, conflict resolution UI | 6h |
| `src/views/ethics-dashboard.ts` | Webview panel: module management, audit log viewer | 5h |
| `src/views/transparency-viewer.ts` | Webview panel: global action log with filters and export | 4h |
| `tests/sync-service.test.ts` | Tests for full sync cycles, conflict detection, resolution | 6h |
| `tests/sync-adapters.test.ts` | Tests for each adapter (mocked endpoints) | 4h |

**Files to modify:**
| File | Change | Effort |
|------|--------|--------|
| `src/core/database.ts` | Add change tracking triggers (intercept writes to emit sync changes) | 4h |
| `src/mcp/server.ts` | Add MCP tools: syncNow, getSyncStatus, resolveConflict | 3h |
| `src/webapp/api.ts` | Add REST endpoints: /api/sync/*, /api/devices/*, /api/transparency/* | 4h |
| `src/commands.ts` | Add commands: sync now, configure sync, manage devices | 2h |
| `src/extension.ts` | Register sync service, start auto-sync on activation | 2h |
| `package.json` | Add sync commands and settings contributions | 1h |

**Phase 4 Total:** ~71 hours (1 developer, ~3.5 weeks at 20h/week)

**Exit criteria:**
- Two COE instances can sync via cloud adapter
- NAS adapter reads/writes sync files to shared folder
- P2P adapter connects via WebSocket on local network
- Conflicts detected and surfaced in UI
- Auto-resolve handles deterministic strategies
- Manual resolution works for user_choice conflicts
- Transparency log captures all actions across all subsystems
- Full action log can be exported and imported

---

### Summary Timeline

| Phase | Weeks | Hours | Key Deliverables |
|-------|-------|-------|-----------------|
| Phase 1: Foundation | 1-2 | 40h | Types, database, schemas, transparency logger |
| Phase 2: Designer | 3-5 | 61h | Canvas, palette, properties, logic editor |
| Phase 3: Agent | 6-8 | 58h | Coding agent, ethics engine, diff flow |
| Phase 4: Sync | 9-11 | 71h | Multi-device sync, conflict resolution, dashboards |
| **Total** | **11 weeks** | **230h** | **Full v2.0 designer update** |

---

*This document is part of the True Plan series. Keep it in sync with implementation. Update section estimates as actual effort is measured. Update type definitions if the interfaces evolve during development.*

---

## Implementation Status (February 13, 2026)

### Phase 1: Foundation — COMPLETE

| Deliverable | File | Status |
|-------------|------|--------|
| Type definitions | `src/types/index.ts` | All v2.0 types added |
| Database schema | `src/core/database.ts` | 27 tables, all v2.0 tables created |
| Component schemas | `src/core/component-schema.ts` | 37 schemas, 5 categories |
| Transparency logger | `src/core/transparency-logger.ts` | Append-only, 7 categories, JSON/CSV export |

### Phase 2: Designer — IN PROGRESS

| Deliverable | File | Status |
|-------------|------|--------|
| Design pages CRUD | `src/webapp/api.ts` | API complete |
| Component CRUD | `src/webapp/api.ts` | API complete |
| Design tokens | `src/webapp/api.ts` | API complete |
| Page flows | `src/webapp/api.ts` | API complete |
| Design export | `src/webapp/api.ts` | JSON export complete |
| VS Code canvas webview | — | Not yet implemented (webapp designer page serves as interim) |

### Phase 3: Agent — COMPLETE

| Deliverable | File | Status |
|-------------|------|--------|
| CodingAgentService | `src/core/coding-agent.ts` | 6 intents, 2-stage classify, code gen, diffs |
| EthicsEngine | `src/core/ethics-engine.ts` | 6 modules, 4 levels, absolute blocks |
| Ethics gate integration | `src/core/coding-agent.ts:240` | Gate on every action |
| Webapp coding chat | `src/webapp/api.ts` | `POST /api/coding/process` wired end-to-end |
| Code preview | `src/webapp/app.ts` | Markdown + code block rendering |

### Phase 4: Sync — COMPLETE

| Deliverable | File | Status |
|-------------|------|--------|
| SyncService | `src/core/sync-service.ts` | 3 backends, vector clocks, advisory locks |
| ConflictResolver | `src/core/conflict-resolver.ts` | SHA-256, field-level merge, 5 strategies |
| Device management | `src/core/sync-service.ts` | Register/unregister, presence tracking |

### Key Integration Points (Wired)

| From | To | How | Status |
|------|----|-----|--------|
| extension.ts | MCPServer | Constructor injection | `codingAgentService` passed as 5th arg |
| MCPServer | handleApiRequest | Parameter forwarding | `codingAgentService` forwarded to API handler |
| Webapp chat | CodingAgentService | `POST /api/coding/process` | Stores user msg, calls processCommand, stores agent msg |
| CodingAgent | EthicsEngine | `evaluateAction()` | Gate before every handler execution |
| CodingAgent | ComponentSchemaService | `getCodeTemplate()` | Code generation from templates |
| Orchestrator | All agents | `getAgentForIntent()` | Two-stage classification routing |
| Boss Agent | Database | Health check queries | 7 thresholds monitored |
| Research Agent | Tickets | Auto-escalation | Creates P1 ticket when confidence <60% |

### Test Coverage

- **40 test suites**, **1,520+ tests**, all passing
- Coverage threshold: **100%** (enforced in `jest.config.js`)

---

## Migration & Rollback Strategy

### Database Migration

v2.0 adds 8 new tables and modifies 2 existing tables. All changes are **additive** — no existing columns are removed or renamed.

| Migration Step | SQL | Rollback SQL | Risk |
|---------------|-----|-------------|------|
| Create `sync_state` | `CREATE TABLE IF NOT EXISTS sync_state (...)` | `DROP TABLE IF EXISTS sync_state` | Low — new table |
| Create `sync_versions` | `CREATE TABLE IF NOT EXISTS sync_versions (...)` | `DROP TABLE IF EXISTS sync_versions` | Low — new table |
| Create `sync_locks` | `CREATE TABLE IF NOT EXISTS sync_locks (...)` | `DROP TABLE IF EXISTS sync_locks` | Low — new table |
| Create `sync_conflicts` | `CREATE TABLE IF NOT EXISTS sync_conflicts (...)` | `DROP TABLE IF EXISTS sync_conflicts` | Low — new table |
| Create `ethics_log` | `CREATE TABLE IF NOT EXISTS ethics_log (...)` | `DROP TABLE IF EXISTS ethics_log` | Low — P1 ethics audit data |
| Create `ethics_modules` | `CREATE TABLE IF NOT EXISTS ethics_modules (...)` | `DROP TABLE IF EXISTS ethics_modules` | Low — new table |
| Create `component_templates` | `CREATE TABLE IF NOT EXISTS component_templates (...)` | `DROP TABLE IF EXISTS component_templates` | Low — new table |
| Create `ai_commands` | `CREATE TABLE IF NOT EXISTS ai_commands (...)` | `DROP TABLE IF EXISTS ai_commands` | Low — new table |
| Add `design_components.sync_version` | `ALTER TABLE design_components ADD COLUMN sync_version INTEGER DEFAULT 0` | Cannot DROP COLUMN in SQLite — requires table rebuild | Medium |
| Add `design_pages.sync_version` | `ALTER TABLE design_pages ADD COLUMN sync_version INTEGER DEFAULT 0` | Cannot DROP COLUMN in SQLite — requires table rebuild | Medium |

> **Developer View**: All migrations run in `database.ts:initialize()` using `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN`. SQLite does not support `IF NOT EXISTS` for `ADD COLUMN` — wrap in a try/catch that ignores "duplicate column name" errors. For true rollback, you would need to rebuild the table (copy data → drop → recreate → re-insert). In practice, rollback means restoring a backup of `tickets.db`.

**Backup Strategy:**
1. Before any migration, copy `tickets.db` to `tickets.db.backup-{timestamp}`
2. Run migrations inside a single transaction
3. If any migration fails, roll back the transaction and restore from backup
4. Keep the 3 most recent backups; delete older ones

### Service Rollback

If a v2.0 service causes issues in production:

| Service | Rollback Action | Data Impact |
|---------|----------------|-------------|
| CodingAgentService | Remove from `extension.ts` constructor chain | `ai_commands` table stops receiving new entries; existing data preserved |
| EthicsEngine | Remove from CodingAgent's `evaluateAction()` call | AI agent operates without ethics gates — NOT recommended in production |
| SyncService | Remove from `extension.ts` | Sync stops; all data remains local-only; no data loss |
| ConflictResolver | Remove from SyncService | Sync conflicts fail-safe to "ask user" mode |
| ComponentSchemaService | Remove from `extension.ts` | Component library shows empty; designer still works with existing components |
| TransparencyLogger | Remove from service chain | Audit trail stops; no functional impact |

> **User View**: If something goes wrong after an update, the extension can be rolled back by installing the previous version from the VS Code marketplace. Your data (tasks, designs, tickets) is preserved in the SQLite database. The worst case is a brief period where new v2.0 features are unavailable while a fix is prepared.

---

## Cross-References

| Document | Relationship |
|----------|-------------|
| [11 - PRD](11-Program-Designer-PRD.md) | Source requirements — this plan implements every feature specified in the PRD |
| [12 - Agile Stories](12-Agile-Stories-and-Tasks.md) | User stories and developer tasks that map to this implementation |
| [14 - AI Agent Behavior Spec](14-AI-Agent-Behavior-Spec.md) | Behavioral specification implemented in §6 (AI Agent Architecture) |
| [02 - Architecture](02-System-Architecture-and-Design.md) | 4-layer architecture this plan extends |
| [07 - Lifecycle](07-Program-Lifecycle-and-Evolution.md) | Evolution pipeline that optimizes the services built here |
| [08 - Safety](08-Context-Management-and-Safety.md) | Security and context management rules these services follow |
| [09 - Features](09-Features-and-Capabilities.md) | Feature catalog where these implementations are registered |
