/**
 * TransparencyLogger — Append-only action logging service for COE v2.0
 *
 * Wraps the action_log database table to provide a unified logging interface
 * for all v2.0 services (EthicsEngine, SyncService, CodingAgentService).
 *
 * Design principles:
 *   - Append-only: No delete or update methods (immutable audit trail)
 *   - Auto-correlation: Every log entry receives a correlation_id
 *   - Device-aware: Stamps device_id on all entries when set
 *   - Event emission: Every log triggers a transparency:action_logged event
 *   - Deterministic: No LLM calls — purely database + event operations
 *
 * Layer 3 (Execution) service in the COE 3-layer architecture.
 */

import * as crypto from 'crypto';
import { Database } from './database';
import { EventBus } from './event-bus';
import { ActionLog, EthicsAuditEntry, SyncChange } from '../types';

// ==================== INTERFACES ====================

/** Options for logAction — all fields are optional overrides */
export interface LogActionOptions {
    /** Severity level (defaults to 'info') */
    severity?: ActionLog['severity'];
    /** Related entity type */
    entity_type?: string;
    /** Related entity ID */
    entity_id?: string;
    /** Override device_id (otherwise uses stored deviceId) */
    device_id?: string;
    /** Correlation ID for grouping related actions (auto-generated if omitted) */
    correlation_id?: string;
    /** Whether this entry has been synced to remote (defaults to false) */
    synced?: boolean;
}

/** Options for getLog — filtering and pagination */
export interface GetLogOptions {
    /** Maximum number of entries to return (default 100) */
    limit?: number;
    /** Filter by source subsystem */
    source?: ActionLog['source'];
    /** Filter by action category */
    category?: ActionLog['category'];
    /** Filter by severity level */
    severity?: ActionLog['severity'];
    /** Only entries after this ISO timestamp */
    since?: string;
    /** Filter by related entity type */
    entityType?: string;
    /** Filter by related entity ID (requires entityType) */
    entityId?: string;
}

/** Options for export methods */
export interface ExportOptions {
    /** Only entries after this ISO timestamp */
    since?: string;
    /** Only entries before this ISO timestamp */
    until?: string;
    /** Filter by source subsystem */
    source?: ActionLog['source'];
    /** Filter by action category */
    category?: ActionLog['category'];
}

/** Aggregated statistics for action log entries */
export interface TransparencyStats {
    /** Total number of entries matching the filter */
    total: number;
    /** Count of entries grouped by category */
    byCategory: Record<string, number>;
    /** Count of entries grouped by severity */
    bySeverity: Record<string, number>;
    /** Count of entries grouped by source */
    bySource: Record<string, number>;
    /** ISO timestamp of the earliest entry in the result set */
    earliest: string | null;
    /** ISO timestamp of the latest entry in the result set */
    latest: string | null;
}

/** Result of an import operation */
export interface ImportResult {
    /** Number of entries successfully imported */
    imported: number;
    /** Number of entries skipped (duplicate IDs) */
    skipped: number;
}

// ==================== CSV HELPERS ====================

/** CSV column order — matches ActionLog fields */
const CSV_COLUMNS: (keyof ActionLog)[] = [
    'id', 'source', 'category', 'action', 'detail', 'severity',
    'entity_type', 'entity_id', 'device_id', 'correlation_id',
    'synced', 'created_at',
];

/**
 * Escape a value for CSV output.
 * Wraps in double quotes if the value contains commas, quotes, or newlines.
 */
function csvEscape(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

// ==================== TRANSPARENCY LOGGER ====================

export class TransparencyLogger {
    /** Device identifier stamped on all future log entries (set via setDeviceId) */
    private deviceId: string | null = null;

    constructor(
        private database: Database,
        private eventBus: EventBus,
        private outputChannel: { appendLine(msg: string): void }
    ) {}

    // ==================== CORE LOGGING ====================

    /**
     * Log a single action to the transparency log.
     *
     * This is the primary logging method. All specialized log methods
     * (logEthicsDecision, logSyncChange) delegate to this.
     *
     * @param source    Which subsystem performed the action
     * @param category  Action category for filtering
     * @param action    Human-readable action description
     * @param detail    Detailed payload/context (typically JSON string)
     * @param options   Optional overrides for severity, entity, device, correlation
     * @returns         The created ActionLog entry
     */
    logAction(
        source: ActionLog['source'],
        category: ActionLog['category'],
        action: string,
        detail: string,
        options?: LogActionOptions
    ): ActionLog {
        const correlationId = options?.correlation_id ?? crypto.randomUUID();
        const deviceId = options?.device_id ?? this.deviceId;
        const severity = options?.severity ?? 'info';
        const synced = options?.synced ?? false;

        try {
            const entry = this.database.createActionLog({
                source,
                category,
                action,
                detail,
                severity,
                entity_type: options?.entity_type ?? null,
                entity_id: options?.entity_id ?? null,
                device_id: deviceId,
                correlation_id: correlationId,
                synced,
            });

            // Emit event for real-time subscribers
            this.emitActionLogged(entry);

            // Log to output channel for developer visibility
            const severityTag = severity === 'info' ? '' : ` [${severity.toUpperCase()}]`;
            this.outputChannel.appendLine(
                `[TransparencyLog]${severityTag} ${source}/${category}: ${action}`
            );

            return entry;
        } catch (err) {
            // Log the error but don't throw — transparency logging should never
            // break the calling service's flow
            this.outputChannel.appendLine(
                `[TransparencyLog] ERROR: Failed to log action "${action}": ${err}`
            );
            // Re-throw so the caller knows the log failed — they can decide
            // whether to handle it or let it propagate
            throw err;
        }
    }

    /**
     * Log an ethics decision from the EthicsEngine.
     *
     * Cross-references the EthicsAuditEntry into the action_log table
     * so all actions are visible in a single unified log.
     *
     * @param entry  The ethics audit entry to log
     * @returns      The created ActionLog entry
     */
    logEthicsDecision(entry: EthicsAuditEntry): ActionLog {
        const actionDescription = `Ethics ${entry.decision}: ${entry.action_description}`;
        const detail = JSON.stringify({
            audit_entry_id: entry.id,
            module_id: entry.module_id,
            rule_id: entry.rule_id,
            decision: entry.decision,
            requestor: entry.requestor,
            override_by: entry.override_by,
            override_reason: entry.override_reason,
        });

        const severity = this.ethicsDecisionToSeverity(entry.decision);

        return this.logAction(
            'ethics_engine',
            'ethics_decision',
            actionDescription,
            detail,
            {
                severity,
                entity_type: 'ethics_audit',
                entity_id: entry.id,
            }
        );
    }

    /**
     * Log a sync change from the SyncService.
     *
     * Records sync operations (create, update, delete) into the
     * unified action log for cross-service visibility.
     *
     * @param change  The sync change to log
     * @returns       The created ActionLog entry
     */
    logSyncChange(change: SyncChange): ActionLog {
        const actionDescription = `Sync ${change.change_type}: ${change.entity_type} ${change.entity_id}`;
        const detail = JSON.stringify({
            sync_change_id: change.id,
            change_type: change.change_type,
            entity_type: change.entity_type,
            entity_id: change.entity_id,
            device_id: change.device_id,
            before_hash: change.before_hash,
            after_hash: change.after_hash,
            sequence_number: change.sequence_number,
        });

        return this.logAction(
            'sync_service',
            'sync_operation',
            actionDescription,
            detail,
            {
                severity: 'info',
                entity_type: change.entity_type,
                entity_id: change.entity_id,
                device_id: change.device_id,
            }
        );
    }

    // ==================== QUERYING ====================

    /**
     * Retrieve action log entries with optional filters.
     *
     * Supports filtering by source, category, severity, time range,
     * and entity. Falls back to database methods for entity-based queries.
     *
     * @param options  Filter and pagination options
     * @returns        Array of matching ActionLog entries (newest first)
     */
    getLog(options?: GetLogOptions): ActionLog[] {
        const limit = options?.limit ?? 100;

        // If filtering by entity, use the dedicated database method
        if (options?.entityType && options?.entityId) {
            const entries = this.database.getActionLogByEntity(options.entityType, options.entityId);
            return this.applyInMemoryFilters(entries, options).slice(0, limit);
        }

        // Use the primary database query for source/category filtering
        let entries = this.database.getActionLog(
            limit,
            options?.source,
            options?.category
        );

        // Apply additional in-memory filters that the database method doesn't support
        entries = this.applyInMemoryFilters(entries, options);

        return entries.slice(0, limit);
    }

    /**
     * Retrieve all action log entries sharing a correlation ID.
     *
     * Useful for tracing a chain of related actions across services
     * (e.g., a sync operation that triggers an ethics check).
     *
     * @param correlationId  The correlation ID to search for
     * @returns              Array of matching ActionLog entries (chronological order)
     */
    getByCorrelation(correlationId: string): ActionLog[] {
        return this.database.getActionLogByCorrelation(correlationId);
    }

    /**
     * Retrieve all action log entries related to a specific entity.
     *
     * @param entityType  The entity type (e.g., 'design_component', 'task')
     * @param entityId    The entity ID
     * @returns           Array of matching ActionLog entries (newest first)
     */
    getByEntity(entityType: string, entityId: string): ActionLog[] {
        return this.database.getActionLogByEntity(entityType, entityId);
    }

    // ==================== EXPORT ====================

    /**
     * Export action log entries as a JSON string.
     *
     * @param options  Filter options for the export
     * @returns        JSON string of the filtered ActionLog array
     */
    exportJSON(options?: ExportOptions): string {
        const entries = this.getFilteredForExport(options);
        return JSON.stringify(entries, null, 2);
    }

    /**
     * Export action log entries as a CSV string.
     *
     * Includes a header row followed by one row per entry.
     * Values containing commas, quotes, or newlines are properly escaped.
     *
     * @param options  Filter options for the export
     * @returns        CSV string with header row
     */
    exportCSV(options?: ExportOptions): string {
        const entries = this.getFilteredForExport(options);
        const lines: string[] = [];

        // Header row
        lines.push(CSV_COLUMNS.join(','));

        // Data rows
        for (const entry of entries) {
            const row = CSV_COLUMNS.map(col => csvEscape(entry[col]));
            lines.push(row.join(','));
        }

        return lines.join('\n');
    }

    // ==================== STATISTICS ====================

    /**
     * Compute aggregated statistics for action log entries.
     *
     * @param since  Optional ISO timestamp — only count entries after this time
     * @returns      Aggregated counts by category, severity, and source
     */
    getStats(since?: string): TransparencyStats {
        // Fetch a large batch to compute stats over
        const entries = this.database.getActionLog(10000);

        const filtered = since
            ? entries.filter(e => e.created_at >= since)
            : entries;

        const byCategory: Record<string, number> = {};
        const bySeverity: Record<string, number> = {};
        const bySource: Record<string, number> = {};
        let earliest: string | null = null;
        let latest: string | null = null;

        for (const entry of filtered) {
            // Count by category
            byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
            // Count by severity
            bySeverity[entry.severity] = (bySeverity[entry.severity] ?? 0) + 1;
            // Count by source
            bySource[entry.source] = (bySource[entry.source] ?? 0) + 1;

            // Track time range
            if (earliest === null || entry.created_at < earliest) {
                earliest = entry.created_at;
            }
            if (latest === null || entry.created_at > latest) {
                latest = entry.created_at;
            }
        }

        return {
            total: filtered.length,
            byCategory,
            bySeverity,
            bySource,
            earliest,
            latest,
        };
    }

    // ==================== ADAPTER: TransparencyLoggerLike ====================

    /**
     * Convenience method matching the TransparencyLoggerLike interface
     * used by EthicsEngine for loose coupling.
     *
     * Delegates to logAction() with the appropriate parameter mapping.
     */
    log(entry: {
        source: string;
        category: string;
        action: string;
        detail: string;
        severity: 'info' | 'warning' | 'error' | 'critical';
        entityType?: string;
        entityId?: string;
        correlationId?: string;
    }): ActionLog {
        return this.logAction(
            entry.source as ActionLog['source'],
            entry.category as ActionLog['category'],
            entry.action,
            entry.detail,
            {
                severity: entry.severity,
                entity_type: entry.entityType,
                entity_id: entry.entityId,
                correlation_id: entry.correlationId,
            }
        );
    }

    // ==================== DEVICE MANAGEMENT ====================

    /**
     * Set the device ID that will be stamped on all future log entries.
     *
     * Call this once during extension activation after the device ID
     * is resolved from SyncConfig or generated for the first time.
     *
     * @param deviceId  The unique device identifier
     */
    setDeviceId(deviceId: string): void {
        this.deviceId = deviceId;
        this.outputChannel.appendLine(`[TransparencyLog] Device ID set: ${deviceId}`);
    }

    /**
     * Get the currently configured device ID (or null if not set).
     */
    getDeviceId(): string | null {
        return this.deviceId;
    }

    // ==================== IMPORT ====================

    /**
     * Import action log entries from a JSON string.
     *
     * Used for syncing transparency logs between devices. Entries are
     * deduplicated by ID — if an entry with the same ID already exists
     * in the database, it is skipped.
     *
     * @param jsonData  JSON string containing an array of ActionLog entries
     * @returns         Count of imported and skipped entries
     */
    importLog(jsonData: string): ImportResult {
        let entries: ActionLog[];

        try {
            const parsed = JSON.parse(jsonData);
            if (!Array.isArray(parsed)) {
                throw new Error('Expected a JSON array of ActionLog entries');
            }
            entries = parsed;
        } catch (err) {
            this.outputChannel.appendLine(
                `[TransparencyLog] ERROR: Failed to parse import data: ${err}`
            );
            throw new Error(`Invalid import data: ${err}`);
        }

        let imported = 0;
        let skipped = 0;

        for (const entry of entries) {
            try {
                // Validate required fields
                if (!entry.id || !entry.source || !entry.category || !entry.action) {
                    this.outputChannel.appendLine(
                        `[TransparencyLog] Skipping invalid entry: missing required fields`
                    );
                    skipped++;
                    continue;
                }

                // Check for duplicate by ID — query correlation as a proxy
                // (the database doesn't expose a getActionLogById, so we check
                // by correlation_id if available, or just attempt the insert)
                const existingByCorrelation = entry.correlation_id
                    ? this.database.getActionLogByCorrelation(entry.correlation_id)
                    : [];
                const isDuplicate = existingByCorrelation.some(e => e.id === entry.id);

                if (isDuplicate) {
                    skipped++;
                    continue;
                }

                // Also check by entity if available
                if (entry.entity_type && entry.entity_id) {
                    const existingByEntity = this.database.getActionLogByEntity(
                        entry.entity_type, entry.entity_id
                    );
                    if (existingByEntity.some(e => e.id === entry.id)) {
                        skipped++;
                        continue;
                    }
                }

                // Insert the entry
                this.database.createActionLog({
                    source: entry.source,
                    category: entry.category,
                    action: entry.action,
                    detail: entry.detail || '',
                    severity: entry.severity || 'info',
                    entity_type: entry.entity_type ?? null,
                    entity_id: entry.entity_id ?? null,
                    device_id: entry.device_id ?? null,
                    correlation_id: entry.correlation_id ?? null,
                    synced: true, // Imported entries are already synced by definition
                });

                imported++;
            } catch (err) {
                this.outputChannel.appendLine(
                    `[TransparencyLog] ERROR: Failed to import entry ${entry.id}: ${err}`
                );
                skipped++;
            }
        }

        this.outputChannel.appendLine(
            `[TransparencyLog] Import complete: ${imported} imported, ${skipped} skipped`
        );

        return { imported, skipped };
    }

    // ==================== SYNC HELPERS ====================

    /**
     * Get all action log entries that haven't been synced to the remote log.
     *
     * Used by the SyncService to determine which local entries need
     * to be pushed to other devices.
     *
     * @returns  Array of unsynced ActionLog entries (chronological order)
     */
    getUnsyncedEntries(): ActionLog[] {
        return this.database.getUnsyncedActionLogs();
    }

    /**
     * Mark a batch of action log entries as synced.
     *
     * Called by the SyncService after successfully pushing entries
     * to the remote log.
     *
     * @param ids  Array of action log entry IDs to mark as synced
     */
    markSynced(ids: string[]): void {
        if (ids.length === 0) {
            return;
        }
        this.database.markActionLogsSynced(ids);
        this.outputChannel.appendLine(
            `[TransparencyLog] Marked ${ids.length} entries as synced`
        );
    }

    // ==================== PRIVATE HELPERS ====================

    /**
     * Emit a transparency:action_logged event on the EventBus.
     *
     * Note: The event type 'transparency:action_logged' is not yet
     * in the COEEventType union. It is cast as `any` until Phase 8
     * adds it to the type system.
     */
    private emitActionLogged(entry: ActionLog): void {
        try {
            this.eventBus.emit(
                'transparency:action_logged',
                'transparency_logger',
                {
                    action_log_id: entry.id,
                    category: entry.category,
                    source: entry.source,
                    severity: entry.severity,
                    action: entry.action,
                }
            );
        } catch (err) {
            // Event emission failure should never break the logging flow
            this.outputChannel.appendLine(
                `[TransparencyLog] WARNING: Failed to emit event for entry ${entry.id}: ${err}`
            );
        }
    }

    /**
     * Map an ethics decision to a log severity level.
     */
    private ethicsDecisionToSeverity(
        decision: EthicsAuditEntry['decision']
    ): ActionLog['severity'] {
        switch (decision) {
            case 'allowed':
                return 'info';
            case 'warned':
                return 'warning';
            case 'blocked':
                return 'error';
            case 'overridden':
                return 'warning';
            default:
                return 'info';
        }
    }

    /**
     * Apply in-memory filters that the database query doesn't support.
     *
     * Handles severity filtering and time-range (since) filtering.
     */
    private applyInMemoryFilters(
        entries: ActionLog[],
        options?: GetLogOptions
    ): ActionLog[] {
        let filtered = entries;

        if (options?.severity) {
            filtered = filtered.filter(e => e.severity === options.severity);
        }

        if (options?.since) {
            filtered = filtered.filter(e => e.created_at >= options.since!);
        }

        return filtered;
    }

    /**
     * Fetch and filter entries for export operations (JSON/CSV).
     *
     * Applies since, until, source, and category filters.
     */
    private getFilteredForExport(options?: ExportOptions): ActionLog[] {
        // Fetch a large batch — exports should include everything matching the filter
        let entries = this.database.getActionLog(
            100000,
            options?.source,
            options?.category
        );

        if (options?.since) {
            entries = entries.filter(e => e.created_at >= options.since!);
        }

        if (options?.until) {
            entries = entries.filter(e => e.created_at <= options.until!);
        }

        return entries;
    }
}
