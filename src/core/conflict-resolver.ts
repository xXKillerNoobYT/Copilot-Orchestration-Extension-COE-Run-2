/**
 * ConflictResolver — Multi-device sync conflict detection and resolution for COE v2.0
 *
 * Handles the full lifecycle of sync conflicts:
 *   1. Detection: Compare local vs remote entity versions via SHA-256 hashing
 *   2. Analysis: Field-level comparison to identify exactly which fields diverged
 *   3. Auto-merge: Non-overlapping changes merged automatically
 *   4. Resolution: Multiple strategies (last-write-wins, keep-local, keep-remote, merge, user-choice)
 *   5. Suggestions: Intelligent strategy recommendations based on entity type and conflict severity
 *
 * Design principles:
 *   - Deterministic: No LLM calls — purely hash comparison + field diffing
 *   - Safety-first: Defaults to user choice for critical entities (tasks, components)
 *   - Field-level granularity: Identifies exactly which fields conflict
 *   - Event-driven: Emits sync:conflict_detected and sync:conflict_resolved events
 *
 * Layer 3 (Execution) service in the COE 3-layer architecture.
 */

import * as crypto from 'crypto';
import { Database } from './database';
import { EventBus } from './event-bus';
import {
    SyncConflict, SyncChange, ConflictResolutionStrategy, ResolutionSuggestion
} from '../types';

// ==================== INTERFACES ====================

/** Result of a field-by-field comparison between two entity versions */
export interface FieldComparisonResult {
    /** Fields that changed on both sides to different values (true conflicts) */
    both: string[];
    /** Fields that changed only on the local side */
    localOnly: string[];
    /** Fields that changed only on the remote side */
    remoteOnly: string[];
    /** Fields that exist in both and have the same value (unchanged) */
    unchanged: string[];
}

/** Result of an auto-merge attempt */
export interface AutoMergeResult {
    /** The merged entity object (only valid if success is true) */
    merged: Record<string, unknown>;
    /** Whether the auto-merge succeeded (false if overlapping changes exist) */
    success: boolean;
    /** The fields that were merged from either side */
    mergedFields: string[];
    /** Fields that could not be auto-merged (same field changed on both sides) */
    conflictingFields: string[];
}

/** Entity type configuration for conflict resolution priority and defaults */
interface EntityTypeConfig {
    /** Resolution priority (lower = more critical, requires more caution) */
    priority: number;
    /** Default resolution strategy for this entity type */
    defaultStrategy: ConflictResolutionStrategy;
}

// ==================== CONFLICT RESOLVER ====================

export class ConflictResolver {
    /**
     * Entity type priority and default strategies.
     *
     * Priority 1: Critical entities where conflicts could cause data loss or inconsistency.
     *             Defaults vary — tasks use last-write-wins (metadata changes frequently),
     *             design components use merge (structural changes need careful handling).
     *
     * Priority 2: Important entities where merge is preferred to preserve both sides' work.
     *
     * Priority 3: Lower-priority entities where last-write-wins is safe and efficient.
     */
    private static readonly ENTITY_PRIORITY: Record<string, EntityTypeConfig> = {
        'task': { priority: 1, defaultStrategy: ConflictResolutionStrategy.LastWriteWins },
        'design_component': { priority: 1, defaultStrategy: ConflictResolutionStrategy.Merge },
        'plan': { priority: 2, defaultStrategy: ConflictResolutionStrategy.Merge },
        'design_page': { priority: 2, defaultStrategy: ConflictResolutionStrategy.Merge },
        'design_token': { priority: 3, defaultStrategy: ConflictResolutionStrategy.LastWriteWins },
        'page_flow': { priority: 3, defaultStrategy: ConflictResolutionStrategy.LastWriteWins },
    };

    /**
     * Fields that are considered metadata and should never trigger a conflict on their own.
     * These are managed by the system and will always diverge between devices.
     */
    private static readonly METADATA_FIELDS = new Set([
        'updated_at', 'created_at', 'synced_at', 'last_sync_at',
    ]);

    constructor(
        private database: Database,
        private eventBus: EventBus,
        private outputChannel: { appendLine(msg: string): void }
    ) {}

    // ==================== DETECTION ====================

    /**
     * Detect whether a conflict exists between a local and remote entity version.
     *
     * Compares SHA-256 hashes of both versions. If hashes match, no conflict exists.
     * If they differ, performs field-level comparison to identify exactly which fields
     * diverged, creates a SyncConflict record in the database, and emits an event.
     *
     * @param entityType       The type of entity being synced
     * @param entityId         The entity's unique identifier
     * @param localEntity      The local version of the entity (any JSON-serializable object)
     * @param remoteEntity     The remote version of the entity
     * @param localChangedAt   ISO timestamp of when the local version was last modified
     * @param remoteChangedAt  ISO timestamp of when the remote version was last modified
     * @param remoteDeviceId   The device ID that originated the remote version
     * @returns                The created SyncConflict record, or null if no conflict
     */
    detectConflict(
        entityType: SyncConflict['entity_type'],
        entityId: string,
        localEntity: Record<string, unknown>,
        remoteEntity: Record<string, unknown>,
        localChangedAt: string,
        remoteChangedAt: string,
        remoteDeviceId: string
    ): SyncConflict | null {
        // Compare hashes — identical entities have no conflict
        const localHash = this.hashEntity(localEntity);
        const remoteHash = this.hashEntity(remoteEntity);

        if (localHash === remoteHash) {
            this.outputChannel.appendLine(
                `[ConflictResolver] No conflict: ${entityType}/${entityId} — hashes match`
            );
            return null;
        }

        // Hashes differ — identify conflicting fields
        const comparison = this.compareFields(localEntity, remoteEntity);
        const conflictingFields = [
            ...comparison.both,
            ...comparison.localOnly,
            ...comparison.remoteOnly,
        ].filter(field => !ConflictResolver.METADATA_FIELDS.has(field));

        // If only metadata fields differ, no meaningful conflict
        if (conflictingFields.length === 0) {
            this.outputChannel.appendLine(
                `[ConflictResolver] No meaningful conflict: ${entityType}/${entityId} — only metadata fields differ`
            );
            return null;
        }

        // Create conflict record in database
        const conflict = this.database.createSyncConflict({
            entity_type: entityType,
            entity_id: entityId,
            local_version: JSON.stringify(localEntity),
            remote_version: JSON.stringify(remoteEntity),
            remote_device_id: remoteDeviceId,
            local_changed_at: localChangedAt,
            remote_changed_at: remoteChangedAt,
            conflicting_fields: conflictingFields,
            resolution: null,
            resolved_by: null,
            resolved_at: null,
        });

        this.outputChannel.appendLine(
            `[ConflictResolver] Conflict detected: ${entityType}/${entityId} — ` +
            `${conflictingFields.length} field(s): ${conflictingFields.join(', ')}`
        );

        // Emit event for real-time subscribers
        this.emitConflictDetected(conflict);

        return conflict;
    }

    // ==================== AUTO-MERGE ====================

    /**
     * Attempt to automatically merge a conflict by combining non-overlapping changes.
     *
     * Algorithm:
     *   1. Parse both local and remote versions from the conflict record
     *   2. Establish a "base" by taking the intersection of unchanged fields
     *   3. For fields changed only on one side — take that side's value (non-conflicting merge)
     *   4. For fields changed on both sides — cannot auto-merge (overlapping changes)
     *
     * The merge succeeds only if there are NO overlapping field changes (i.e., no field
     * was changed on both sides to different values). Fields in the METADATA_FIELDS set
     * are excluded from conflict consideration — the local version's metadata is kept.
     *
     * @param conflict  The SyncConflict record to attempt auto-merge on
     * @returns         The merge result containing the merged object and success status
     */
    autoMerge(conflict: SyncConflict): AutoMergeResult {
        let localObj: Record<string, unknown>;
        let remoteObj: Record<string, unknown>;

        try {
            localObj = JSON.parse(conflict.local_version);
            remoteObj = JSON.parse(conflict.remote_version);
        } catch (err) {
            this.outputChannel.appendLine(
                `[ConflictResolver] Auto-merge failed for conflict ${conflict.id}: ` +
                `unable to parse versions — ${err}`
            );
            return {
                merged: {},
                success: false,
                mergedFields: [],
                conflictingFields: conflict.conflicting_fields,
            };
        }

        const comparison = this.compareFields(localObj, remoteObj);

        // Filter out metadata fields from the "both" (truly conflicting) category
        const trueConflicts = comparison.both.filter(
            field => !ConflictResolver.METADATA_FIELDS.has(field)
        );

        // If there are true conflicts (same field changed on both sides), auto-merge fails
        if (trueConflicts.length > 0) {
            this.outputChannel.appendLine(
                `[ConflictResolver] Auto-merge failed for conflict ${conflict.id}: ` +
                `overlapping changes on ${trueConflicts.length} field(s): ${trueConflicts.join(', ')}`
            );
            return {
                merged: {},
                success: false,
                mergedFields: [],
                conflictingFields: trueConflicts,
            };
        }

        // Build merged object: start with local as base
        const merged: Record<string, unknown> = { ...localObj };
        const mergedFields: string[] = [];

        // Apply remote-only changes (fields that only the remote side changed)
        for (const field of comparison.remoteOnly) {
            if (!ConflictResolver.METADATA_FIELDS.has(field)) {
                merged[field] = remoteObj[field];
                mergedFields.push(field);
            }
        }

        // Local-only changes are already in the merged object (from spread)
        for (const field of comparison.localOnly) {
            if (!ConflictResolver.METADATA_FIELDS.has(field)) {
                mergedFields.push(field);
            }
        }

        // For metadata "both" fields, keep local values (already in merged from spread)
        // For non-metadata "both" fields, we already returned failure above

        this.outputChannel.appendLine(
            `[ConflictResolver] Auto-merge succeeded for conflict ${conflict.id}: ` +
            `${mergedFields.length} field(s) merged: ${mergedFields.join(', ')}`
        );

        return {
            merged,
            success: true,
            mergedFields,
            conflictingFields: [],
        };
    }

    // ==================== RESOLUTION ====================

    /**
     * Resolve a conflict using the specified strategy.
     *
     * Strategy behaviors:
     *   - KeepLocal:     Mark resolved, local version is kept (no action needed on local)
     *   - KeepRemote:    Mark resolved, remote version should be applied by the caller
     *   - Merge:         Attempt auto-merge; if successful mark resolved, else throw
     *   - LastWriteWins: Compare timestamps, keep whichever was changed more recently
     *   - UserChoice:    Mark resolved immediately (user has already made their choice externally)
     *
     * After resolution, emits a sync:conflict_resolved event and logs the outcome.
     *
     * @param conflictId  The conflict's unique ID
     * @param strategy    The resolution strategy to apply
     * @param resolvedBy  Identifier of who/what resolved it (device_id, 'auto', or username)
     * @throws            Error if the conflict doesn't exist or merge fails
     */
    resolve(
        conflictId: string,
        strategy: ConflictResolutionStrategy,
        resolvedBy: string
    ): void {
        const conflict = this.database.getSyncConflict(conflictId);
        if (!conflict) {
            throw new Error(`Conflict not found: ${conflictId}`);
        }

        if (conflict.resolution !== null) {
            this.outputChannel.appendLine(
                `[ConflictResolver] Conflict ${conflictId} already resolved ` +
                `with strategy: ${conflict.resolution}`
            );
            return;
        }

        switch (strategy) {
            case ConflictResolutionStrategy.KeepLocal: {
                // Mark resolved — local version is retained, no further action needed
                this.database.resolveSyncConflict(conflictId, strategy, resolvedBy);
                this.outputChannel.appendLine(
                    `[ConflictResolver] Resolved ${conflictId}: keep local version`
                );
                break;
            }

            case ConflictResolutionStrategy.KeepRemote: {
                // Mark resolved — caller is responsible for applying the remote version
                this.database.resolveSyncConflict(conflictId, strategy, resolvedBy);
                this.outputChannel.appendLine(
                    `[ConflictResolver] Resolved ${conflictId}: keep remote version`
                );
                break;
            }

            case ConflictResolutionStrategy.Merge: {
                // Attempt auto-merge — fails if there are overlapping field changes
                const mergeResult = this.autoMerge(conflict);
                if (!mergeResult.success) {
                    throw new Error(
                        `Auto-merge failed for conflict ${conflictId}: ` +
                        `overlapping changes on fields: ${mergeResult.conflictingFields.join(', ')}. ` +
                        `Use KeepLocal, KeepRemote, or UserChoice instead.`
                    );
                }
                this.database.resolveSyncConflict(conflictId, strategy, resolvedBy);
                this.outputChannel.appendLine(
                    `[ConflictResolver] Resolved ${conflictId}: auto-merged ` +
                    `${mergeResult.mergedFields.length} field(s)`
                );
                break;
            }

            case ConflictResolutionStrategy.LastWriteWins: {
                // Compare timestamps — more recent change wins
                const localTime = new Date(conflict.local_changed_at).getTime();
                const remoteTime = new Date(conflict.remote_changed_at).getTime();
                const winner = remoteTime > localTime ? 'remote' : 'local';
                this.database.resolveSyncConflict(conflictId, strategy, resolvedBy);
                this.outputChannel.appendLine(
                    `[ConflictResolver] Resolved ${conflictId}: last-write-wins — ` +
                    `${winner} version chosen (local: ${conflict.local_changed_at}, ` +
                    `remote: ${conflict.remote_changed_at})`
                );
                break;
            }

            case ConflictResolutionStrategy.UserChoice: {
                // User has already made their decision — just mark resolved
                this.database.resolveSyncConflict(conflictId, strategy, resolvedBy);
                this.outputChannel.appendLine(
                    `[ConflictResolver] Resolved ${conflictId}: user choice by ${resolvedBy}`
                );
                break;
            }

            default: {
                throw new Error(`Unknown resolution strategy: ${strategy}`);
            }
        }

        // Emit resolution event
        this.emitConflictResolved(conflict, strategy, resolvedBy);
    }

    // ==================== SUGGESTION ====================

    /**
     * Suggest the best resolution strategy for a given conflict.
     *
     * Decision logic:
     *   1. Parse both versions and compare fields
     *   2. If no overlapping field changes exist → suggest Merge (high confidence)
     *   3. If the entity is critical (priority 1) with overlapping changes → suggest UserChoice (safety)
     *   4. If timestamps are far apart → suggest LastWriteWins (the clear winner is obvious)
     *   5. Otherwise → suggest the entity type's default strategy
     *
     * @param conflict  The SyncConflict to analyze
     * @returns         A suggestion with strategy, confidence (0-1), reason, and preview
     */
    suggestResolution(conflict: SyncConflict): ResolutionSuggestion {
        let localObj: Record<string, unknown>;
        let remoteObj: Record<string, unknown>;

        try {
            localObj = JSON.parse(conflict.local_version);
            remoteObj = JSON.parse(conflict.remote_version);
        } catch {
            // Can't parse versions — safest to let user decide
            return {
                strategy: ConflictResolutionStrategy.UserChoice,
                confidence: 0.3,
                reason: 'Unable to parse entity versions for analysis. Manual review recommended.',
                preview: 'Cannot generate preview — version data is malformed.',
            };
        }

        const comparison = this.compareFields(localObj, remoteObj);
        const trueConflicts = comparison.both.filter(
            field => !ConflictResolver.METADATA_FIELDS.has(field)
        );

        const entityConfig = ConflictResolver.ENTITY_PRIORITY[conflict.entity_type];
        const priority = entityConfig?.priority ?? 2;

        // Case 1: No overlapping changes — auto-merge is safe
        if (trueConflicts.length === 0) {
            const nonMetaChanges = [
                ...comparison.localOnly.filter(f => !ConflictResolver.METADATA_FIELDS.has(f)),
                ...comparison.remoteOnly.filter(f => !ConflictResolver.METADATA_FIELDS.has(f)),
            ];

            return {
                strategy: ConflictResolutionStrategy.Merge,
                confidence: 0.95,
                reason: `No overlapping field changes detected. ${nonMetaChanges.length} field(s) can be safely merged: ${nonMetaChanges.join(', ') || 'none'}.`,
                preview: this.generateMergePreview(localObj, remoteObj, comparison),
            };
        }

        // Case 2: Critical entity with overlapping changes — user must decide
        if (priority === 1 && trueConflicts.length > 0) {
            return {
                strategy: ConflictResolutionStrategy.UserChoice,
                confidence: 0.85,
                reason: `Critical entity type '${conflict.entity_type}' has ${trueConflicts.length} overlapping field change(s): ${trueConflicts.join(', ')}. Manual review recommended for safety.`,
                preview: this.generateConflictPreview(localObj, remoteObj, trueConflicts),
            };
        }

        // Case 3: Timestamps are significantly different (>5 minutes apart) — last-write-wins
        const localTime = new Date(conflict.local_changed_at).getTime();
        const remoteTime = new Date(conflict.remote_changed_at).getTime();
        const timeDiffMs = Math.abs(localTime - remoteTime);
        const FIVE_MINUTES_MS = 5 * 60 * 1000;

        if (timeDiffMs > FIVE_MINUTES_MS) {
            const winner = remoteTime > localTime ? 'remote' : 'local';
            const timeDiffMinutes = Math.round(timeDiffMs / 60000);
            return {
                strategy: ConflictResolutionStrategy.LastWriteWins,
                confidence: 0.75,
                reason: `Timestamps are ${timeDiffMinutes} minute(s) apart. The ${winner} version is more recent and likely reflects the intended state.`,
                preview: `Winner: ${winner} version (changed at ${winner === 'local' ? conflict.local_changed_at : conflict.remote_changed_at}). Conflicting fields: ${trueConflicts.join(', ')}.`,
            };
        }

        // Case 4: Fall back to entity type's default strategy
        const defaultStrategy = entityConfig?.defaultStrategy ?? ConflictResolutionStrategy.UserChoice;

        return {
            strategy: defaultStrategy,
            confidence: 0.5,
            reason: `Overlapping changes on ${trueConflicts.length} field(s) with similar timestamps. Using default strategy '${defaultStrategy}' for entity type '${conflict.entity_type}'.`,
            preview: this.generateConflictPreview(localObj, remoteObj, trueConflicts),
        };
    }

    // ==================== QUERY METHODS ====================

    /**
     * Get all unresolved conflicts, ordered by creation time (newest first).
     *
     * @returns  Array of SyncConflict records where resolution is null
     */
    getUnresolved(): SyncConflict[] {
        return this.database.getUnresolvedConflicts();
    }

    /**
     * Get all conflicts (resolved and unresolved) for a specific entity.
     *
     * @param entityType  The entity type to filter by
     * @param entityId    The entity ID to filter by
     * @returns           Array of SyncConflict records, newest first
     */
    getByEntity(entityType: string, entityId: string): SyncConflict[] {
        return this.database.getConflictsByEntity(entityType, entityId);
    }

    // ==================== HASHING ====================

    /**
     * Compute a SHA-256 hash of a JSON-serializable entity.
     *
     * The entity is serialized with sorted keys to ensure deterministic hashing
     * regardless of property insertion order. This means { a: 1, b: 2 } and
     * { b: 2, a: 1 } produce the same hash.
     *
     * @param entity  Any JSON-serializable object
     * @returns       Hexadecimal SHA-256 hash string
     */
    hashEntity(entity: Record<string, unknown>): string {
        const serialized = JSON.stringify(entity, Object.keys(entity).sort());
        return crypto.createHash('sha256').update(serialized, 'utf-8').digest('hex');
    }

    // ==================== FIELD COMPARISON ====================

    /**
     * Compare two entity objects field by field.
     *
     * For each field in the union of both objects' keys:
     *   - If the field exists in both and has the same value → unchanged
     *   - If the field exists in both but values differ → both (conflicting)
     *   - If the field exists only in local → localOnly
     *   - If the field exists only in remote → remoteOnly
     *
     * Values are compared via JSON.stringify for deep equality. This handles
     * nested objects and arrays correctly, though it is sensitive to key ordering
     * in nested objects (which is consistent with how entities are typically stored).
     *
     * @param local   The local entity version
     * @param remote  The remote entity version
     * @returns       Categorized field comparison result
     */
    compareFields(
        local: Record<string, unknown>,
        remote: Record<string, unknown>
    ): FieldComparisonResult {
        const localKeys = new Set(Object.keys(local));
        const remoteKeys = new Set(Object.keys(remote));
        const allKeys = new Set([...localKeys, ...remoteKeys]);

        const result: FieldComparisonResult = {
            both: [],
            localOnly: [],
            remoteOnly: [],
            unchanged: [],
        };

        for (const key of allKeys) {
            const inLocal = localKeys.has(key);
            const inRemote = remoteKeys.has(key);

            if (inLocal && !inRemote) {
                result.localOnly.push(key);
            } else if (!inLocal && inRemote) {
                result.remoteOnly.push(key);
            } else {
                // Both sides have this field — compare values
                const localValue = JSON.stringify(local[key]);
                const remoteValue = JSON.stringify(remote[key]);

                if (localValue === remoteValue) {
                    result.unchanged.push(key);
                } else {
                    result.both.push(key);
                }
            }
        }

        // Sort for deterministic output
        result.both.sort();
        result.localOnly.sort();
        result.remoteOnly.sort();
        result.unchanged.sort();

        return result;
    }

    // ==================== BULK OPERATIONS ====================

    /**
     * Get a count of currently unresolved conflicts.
     *
     * Useful for status indicators and sync state reporting.
     *
     * @returns  Number of unresolved conflicts
     */
    getUnresolvedCount(): number {
        return this.database.getUnresolvedConflicts().length;
    }

    /**
     * Resolve all unresolved conflicts for a specific entity using the given strategy.
     *
     * This is useful when a user makes a blanket decision about an entity
     * (e.g., "always keep my local version of this component").
     *
     * @param entityType  The entity type to resolve conflicts for
     * @param entityId    The entity ID to resolve conflicts for
     * @param strategy    The resolution strategy to apply to all conflicts
     * @param resolvedBy  Identifier of who/what resolved them
     * @returns           Number of conflicts resolved
     */
    resolveAllForEntity(
        entityType: string,
        entityId: string,
        strategy: ConflictResolutionStrategy,
        resolvedBy: string
    ): number {
        const conflicts = this.database.getConflictsByEntity(entityType, entityId);
        let resolved = 0;

        for (const conflict of conflicts) {
            if (conflict.resolution !== null) {
                continue; // Already resolved
            }

            try {
                this.resolve(conflict.id, strategy, resolvedBy);
                resolved++;
            } catch (err) {
                this.outputChannel.appendLine(
                    `[ConflictResolver] Failed to resolve conflict ${conflict.id} ` +
                    `for ${entityType}/${entityId}: ${err}`
                );
                // Continue with remaining conflicts
            }
        }

        this.outputChannel.appendLine(
            `[ConflictResolver] Bulk-resolved ${resolved} conflict(s) for ` +
            `${entityType}/${entityId} using strategy: ${strategy}`
        );

        return resolved;
    }

    /**
     * Determine the winner of a last-write-wins resolution.
     *
     * Returns which side has the more recent timestamp, or 'local' if timestamps
     * are equal (local bias prevents unnecessary data transfer).
     *
     * @param conflict  The SyncConflict to analyze
     * @returns         'local' or 'remote' indicating which version wins
     */
    getLastWriteWinner(conflict: SyncConflict): 'local' | 'remote' {
        const localTime = new Date(conflict.local_changed_at).getTime();
        const remoteTime = new Date(conflict.remote_changed_at).getTime();
        return remoteTime > localTime ? 'remote' : 'local';
    }

    /**
     * Get the winning version content for a resolved conflict.
     *
     * Returns the appropriate entity version based on how the conflict was resolved.
     * For Merge strategy, returns the auto-merged result.
     *
     * @param conflict  A resolved SyncConflict
     * @returns         The winning entity data, or null if unresolved/parse error
     */
    getResolvedVersion(conflict: SyncConflict): Record<string, unknown> | null {
        if (conflict.resolution === null) {
            return null;
        }

        try {
            const localObj = JSON.parse(conflict.local_version);
            const remoteObj = JSON.parse(conflict.remote_version);

            switch (conflict.resolution) {
                case ConflictResolutionStrategy.KeepLocal:
                    return localObj;

                case ConflictResolutionStrategy.KeepRemote:
                    return remoteObj;

                case ConflictResolutionStrategy.Merge: {
                    const mergeResult = this.autoMerge(conflict);
                    return mergeResult.success ? mergeResult.merged : null;
                }

                case ConflictResolutionStrategy.LastWriteWins: {
                    const winner = this.getLastWriteWinner(conflict);
                    return winner === 'local' ? localObj : remoteObj;
                }

                case ConflictResolutionStrategy.UserChoice:
                    // User choice doesn't have a deterministic winner from our perspective
                    // The caller must have already stored the chosen version
                    return null;

                default:
                    return null;
            }
        } catch {
            this.outputChannel.appendLine(
                `[ConflictResolver] Failed to parse resolved versions for conflict ${conflict.id}`
            );
            return null;
        }
    }

    // ==================== PRIVATE HELPERS ====================

    /**
     * Generate a human-readable preview of what an auto-merge would produce.
     *
     * Shows which fields come from each side in the merged result.
     */
    private generateMergePreview(
        local: Record<string, unknown>,
        remote: Record<string, unknown>,
        comparison: FieldComparisonResult
    ): string {
        const parts: string[] = [];

        if (comparison.localOnly.length > 0) {
            const localFields = comparison.localOnly
                .filter(f => !ConflictResolver.METADATA_FIELDS.has(f));
            if (localFields.length > 0) {
                parts.push(`From local: ${localFields.map(f => `${f}=${this.truncateValue(local[f])}`).join(', ')}`);
            }
        }

        if (comparison.remoteOnly.length > 0) {
            const remoteFields = comparison.remoteOnly
                .filter(f => !ConflictResolver.METADATA_FIELDS.has(f));
            if (remoteFields.length > 0) {
                parts.push(`From remote: ${remoteFields.map(f => `${f}=${this.truncateValue(remote[f])}`).join(', ')}`);
            }
        }

        if (comparison.unchanged.length > 0) {
            parts.push(`Unchanged: ${comparison.unchanged.length} field(s)`);
        }

        return parts.length > 0
            ? `Merge preview: ${parts.join('. ')}.`
            : 'Merge preview: No meaningful field differences.';
    }

    /**
     * Generate a human-readable preview of conflicting fields.
     *
     * Shows the local and remote values side by side for each conflicting field.
     */
    private generateConflictPreview(
        local: Record<string, unknown>,
        remote: Record<string, unknown>,
        conflictingFields: string[]
    ): string {
        if (conflictingFields.length === 0) {
            return 'No conflicting fields.';
        }

        const fieldPreviews = conflictingFields.map(field => {
            const localVal = this.truncateValue(local[field]);
            const remoteVal = this.truncateValue(remote[field]);
            return `  ${field}: local=${localVal} vs remote=${remoteVal}`;
        });

        return `Conflicting fields:\n${fieldPreviews.join('\n')}`;
    }

    /**
     * Truncate a value for display in previews.
     * Limits string output to 80 characters.
     */
    private truncateValue(value: unknown): string {
        const str = JSON.stringify(value);
        if (str.length > 80) {
            return str.substring(0, 77) + '...';
        }
        return str;
    }

    /**
     * Emit a sync:conflict_detected event on the EventBus.
     */
    private emitConflictDetected(conflict: SyncConflict): void {
        try {
            this.eventBus.emit(
                'sync:conflict_detected',
                'conflict_resolver',
                {
                    conflict_id: conflict.id,
                    entity_type: conflict.entity_type,
                    entity_id: conflict.entity_id,
                    remote_device_id: conflict.remote_device_id,
                    conflicting_fields: conflict.conflicting_fields,
                    field_count: conflict.conflicting_fields.length,
                }
            );
        } catch (err) {
            // Event emission failure should never break conflict detection flow
            this.outputChannel.appendLine(
                `[ConflictResolver] WARNING: Failed to emit conflict_detected event ` +
                `for conflict ${conflict.id}: ${err}`
            );
        }
    }

    /**
     * Emit a sync:conflict_resolved event on the EventBus.
     */
    private emitConflictResolved(
        conflict: SyncConflict,
        strategy: ConflictResolutionStrategy,
        resolvedBy: string
    ): void {
        try {
            this.eventBus.emit(
                'sync:conflict_resolved',
                'conflict_resolver',
                {
                    conflict_id: conflict.id,
                    entity_type: conflict.entity_type,
                    entity_id: conflict.entity_id,
                    strategy,
                    resolved_by: resolvedBy,
                    conflicting_fields: conflict.conflicting_fields,
                }
            );
        } catch (err) {
            // Event emission failure should never break resolution flow
            this.outputChannel.appendLine(
                `[ConflictResolver] WARNING: Failed to emit conflict_resolved event ` +
                `for conflict ${conflict.id}: ${err}`
            );
        }
    }
}
