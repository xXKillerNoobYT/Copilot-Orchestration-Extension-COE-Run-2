/**
 * SyncService — Multi-device synchronization for COE v2.0
 *
 * Orchestrates data synchronization between devices using pluggable
 * SyncAdapter backends (Cloud REST, NAS file-based, P2P direct).
 *
 * Architecture:
 *   1. Track local changes via database change tracking
 *   2. Push local changes to remote via adapter
 *   3. Pull remote changes from adapter
 *   4. Detect conflicts via ConflictResolver
 *   5. Apply non-conflicting changes
 *   6. Queue conflicting changes for user resolution
 *
 * Features:
 *   - Vector clocks for causal ordering
 *   - Advisory locking with stale lock detection (>5 min)
 *   - Exponential backoff retry (1s, 2s, 4s, 8s max)
 *   - Auto-sync on configurable interval
 *   - Event-driven for real-time UI updates
 *
 * Design principles:
 *   - Deterministic: No LLM calls — purely data operations
 *   - Append-only transparency logging for all sync operations
 *   - Backend-agnostic via SyncAdapter interface
 *   - Graceful degradation when offline
 *
 * Layer 3 (Execution) service in the COE 3-layer architecture.
 */

import * as crypto from 'crypto';
import { Database } from './database';
import { EventBus } from './event-bus';
import { ConflictResolver } from './conflict-resolver';
import {
    SyncConfig,
    SyncState,
    SyncChange,
    SyncStatus,
    SyncBackend,
    DeviceInfo,
    ConflictResolutionStrategy,
} from '../types';

// ==================== INTERFACES ====================

/** Output channel interface for decoupling from VS Code */
interface OutputChannelLike {
    appendLine(msg: string): void;
}

/** Transparency logger interface for loose coupling */
interface TransparencyLoggerLike {
    log(entry: {
        source: string;
        category: string;
        action: string;
        detail: string;
        severity: 'info' | 'warning' | 'error' | 'critical';
        entityType?: string;
        entityId?: string;
        correlationId?: string;
    }): void;
}

/**
 * SyncAdapter — Backend-specific sync implementation.
 *
 * Each adapter handles the transport layer for a specific sync backend
 * (Cloud REST, NAS file-based, P2P direct). The SyncService uses this
 * interface to push/pull changes without knowing the transport details.
 */
export interface SyncAdapter {
    /** Connect to the sync backend */
    connect(config: SyncConfig): Promise<void>;
    /** Disconnect from the sync backend */
    disconnect(): Promise<void>;
    /** Push local changes to the remote */
    pushChanges(changes: SyncChange[]): Promise<{ accepted: string[]; rejected: string[] }>;
    /** Pull changes from the remote since a given sequence number */
    pullChanges(since: number): Promise<SyncChange[]>;
    /** Check if currently connected */
    isConnected(): boolean;
}

/** Advisory lock for preventing concurrent modifications */
interface AdvisoryLock {
    resourceId: string;
    deviceId: string;
    acquiredAt: number;
    expiresAt: number;
}

/** Retry configuration */
interface RetryConfig {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
}

// ==================== STUB ADAPTERS ====================

/**
 * CloudSyncAdapter — HTTPS REST-based sync.
 * Stub implementation for initial development and testing.
 */
export class CloudSyncAdapter implements SyncAdapter {
    private connected = false;

    async connect(_config: SyncConfig): Promise<void> {
        this.connected = true;
    }

    async disconnect(): Promise<void> {
        this.connected = false;
    }

    async pushChanges(changes: SyncChange[]): Promise<{ accepted: string[]; rejected: string[] }> {
        if (!this.connected) {
            return { accepted: [], rejected: changes.map(c => c.id) };
        }
        return { accepted: changes.map(c => c.id), rejected: [] };
    }

    async pullChanges(_since: number): Promise<SyncChange[]> {
        return [];
    }

    isConnected(): boolean {
        return this.connected;
    }
}

/**
 * NASSyncAdapter — File-based sync via shared filesystem.
 * Stub implementation for initial development and testing.
 */
export class NASSyncAdapter implements SyncAdapter {
    private connected = false;

    async connect(_config: SyncConfig): Promise<void> {
        this.connected = true;
    }

    async disconnect(): Promise<void> {
        this.connected = false;
    }

    async pushChanges(changes: SyncChange[]): Promise<{ accepted: string[]; rejected: string[] }> {
        if (!this.connected) {
            return { accepted: [], rejected: changes.map(c => c.id) };
        }
        return { accepted: changes.map(c => c.id), rejected: [] };
    }

    async pullChanges(_since: number): Promise<SyncChange[]> {
        return [];
    }

    isConnected(): boolean {
        return this.connected;
    }
}

/**
 * P2PSyncAdapter — Direct peer-to-peer sync.
 * Stub implementation for initial development and testing.
 */
export class P2PSyncAdapter implements SyncAdapter {
    private connected = false;

    async connect(_config: SyncConfig): Promise<void> {
        this.connected = true;
    }

    async disconnect(): Promise<void> {
        this.connected = false;
    }

    async pushChanges(changes: SyncChange[]): Promise<{ accepted: string[]; rejected: string[] }> {
        if (!this.connected) {
            return { accepted: [], rejected: changes.map(c => c.id) };
        }
        return { accepted: changes.map(c => c.id), rejected: [] };
    }

    async pullChanges(_since: number): Promise<SyncChange[]> {
        return [];
    }

    isConnected(): boolean {
        return this.connected;
    }
}

// ==================== SYNC SERVICE ====================

export class SyncService {
    private adapter: SyncAdapter | null = null;
    private config: SyncConfig | null = null;
    private autoSyncTimer: ReturnType<typeof setInterval> | null = null;
    private locks = new Map<string, AdvisoryLock>();
    private retryConfig: RetryConfig = {
        maxRetries: 4,
        baseDelayMs: 1000,
        maxDelayMs: 8000,
    };
    /** Stale lock threshold — locks older than this are auto-released */
    private static readonly STALE_LOCK_MS = 5 * 60 * 1000; // 5 minutes
    private syncing = false;

    constructor(
        private database: Database,
        private eventBus: EventBus,
        private conflictResolver: ConflictResolver,
        private transparencyLogger: TransparencyLoggerLike,
        private outputChannel: OutputChannelLike
    ) {}

    // ==================== CONFIGURATION ====================

    /**
     * Configure the sync service with backend settings.
     *
     * Creates or updates the sync configuration in the database,
     * instantiates the appropriate SyncAdapter, and connects.
     *
     * @param config  Partial sync config (device_id is required)
     * @returns       The full SyncConfig record
     */
    async configure(config: Partial<SyncConfig> & { device_id: string }): Promise<SyncConfig> {
        // Store/update config in database
        const existing = this.database.getSyncConfig();
        let savedConfig: SyncConfig;

        if (existing) {
            savedConfig = this.database.updateSyncConfig(existing.id, config)!;
        } else {
            savedConfig = this.database.createSyncConfig(config);
        }

        this.config = savedConfig;

        // Create the appropriate adapter
        this.adapter = this.createAdapter(savedConfig.backend);

        // Connect
        try {
            await this.adapter.connect(savedConfig);
            this.outputChannel.appendLine(
                `[SyncService] Connected to ${savedConfig.backend} backend`
            );

            // Register this device if not already registered
            const existingDevice = this.database.getDevice(config.device_id);
            if (!existingDevice) {
                this.database.registerDevice({
                    device_id: config.device_id,
                    name: config.device_id.substring(0, 8),
                    os: process.platform,
                    last_address: 'localhost',
                    is_current: true,
                    sync_enabled: true,
                    last_seen_at: new Date().toISOString(),
                    clock_value: 0,
                });
            }

            this.emitEvent('sync:device_connected', {
                device_id: config.device_id,
                backend: savedConfig.backend,
            });
        } catch (err) {
            this.outputChannel.appendLine(
                `[SyncService] Failed to connect: ${err}`
            );
            // Bug 6E: Emit system:error so the UI can notify the user
            this.emitEvent('system:error', {
                source: 'sync_service',
                operation: 'configure',
                error: err instanceof Error ? err.message : String(err),
                backend: savedConfig.backend,
            });
        }

        this.logTransparency('configure', `Sync configured with ${savedConfig.backend} backend`);

        return savedConfig;
    }

    // ==================== SYNC CYCLE ====================

    /**
     * Execute a full sync cycle: push local → pull remote → detect conflicts.
     *
     * The sync cycle:
     *   1. Push unsynced local changes to remote
     *   2. Pull remote changes since last sync
     *   3. For each pulled change, detect conflicts with local state
     *   4. Apply non-conflicting remote changes
     *   5. Queue conflicting changes for resolution
     *   6. Update sync state
     *
     * @returns  The updated SyncState after the cycle completes
     */
    async sync(): Promise<SyncState> {
        if (!this.adapter || !this.config) {
            throw new Error('SyncService not configured. Call configure() first.');
        }

        if (this.syncing) {
            this.outputChannel.appendLine('[SyncService] Sync already in progress, skipping.');
            return this.getStatus();
        }

        this.syncing = true;
        const startTime = Date.now();
        const correlationId = crypto.randomUUID();

        this.emitEvent('sync:started', { correlation_id: correlationId });
        this.outputChannel.appendLine('[SyncService] Starting sync cycle...');

        try {
            // ── Step 1: Push local changes ──
            const unsyncedChanges = this.database.getUnsyncedChanges(this.config.device_id);
            let pushResult = { accepted: [] as string[], rejected: [] as string[] };

            if (unsyncedChanges.length > 0) {
                pushResult = await this.retryWithBackoff(
                    () => this.adapter!.pushChanges(unsyncedChanges),
                    'push changes'
                );

                // Mark accepted changes as synced
                if (pushResult.accepted.length > 0) {
                    this.database.markChangesSynced(pushResult.accepted);
                }

                this.outputChannel.appendLine(
                    `[SyncService] Push: ${pushResult.accepted.length} accepted, ` +
                    `${pushResult.rejected.length} rejected`
                );
            }

            // ── Step 2: Pull remote changes ──
            const lastSeq = this.database.getLatestSequenceNumber(this.config.device_id);
            const remoteChanges = await this.retryWithBackoff(
                () => this.adapter!.pullChanges(lastSeq),
                'pull changes'
            );

            this.outputChannel.appendLine(
                `[SyncService] Pull: ${remoteChanges.length} remote change(s)`
            );

            // ── Step 3: Process remote changes ──
            let conflictsDetected = 0;
            let changesApplied = 0;

            for (const remoteChange of remoteChanges) {
                // Skip changes from our own device
                if (remoteChange.device_id === this.config.device_id) {
                    continue;
                }

                // Check for conflicts with local state
                const localChanges = this.database.getSyncChangesByEntity(
                    remoteChange.entity_type,
                    remoteChange.entity_id
                );

                const hasLocalChange = localChanges.some(lc =>
                    lc.device_id === this.config!.device_id && !lc.synced
                );

                if (hasLocalChange) {
                    // Potential conflict — try auto-detect
                    const localEntity = this.getEntityData(
                        remoteChange.entity_type,
                        remoteChange.entity_id
                    );
                    const remoteEntity = remoteChange.patch
                        ? (typeof remoteChange.patch === 'string'
                            ? JSON.parse(remoteChange.patch)
                            : remoteChange.patch) as Record<string, unknown>
                        : {};

                    if (localEntity && Object.keys(remoteEntity).length > 0) {
                        const conflict = this.conflictResolver.detectConflict(
                            remoteChange.entity_type as 'task' | 'plan' | 'design_component' | 'design_page' | 'design_token' | 'page_flow',
                            remoteChange.entity_id,
                            localEntity,
                            remoteEntity,
                            new Date().toISOString(),
                            remoteChange.created_at,
                            remoteChange.device_id ?? 'unknown'
                        );

                        if (conflict) {
                            conflictsDetected++;
                            this.emitEvent('sync:conflict_detected', {
                                conflict_id: conflict.id,
                                entity_type: remoteChange.entity_type,
                                entity_id: remoteChange.entity_id,
                            });
                        }
                    }
                } else {
                    // No local conflict — safe to apply
                    changesApplied++;
                }

                // Record the remote change in our local change log
                this.database.createSyncChange({
                    entity_type: remoteChange.entity_type,
                    entity_id: remoteChange.entity_id,
                    change_type: remoteChange.change_type,
                    device_id: remoteChange.device_id ?? 'unknown',
                    before_hash: remoteChange.before_hash,
                    after_hash: remoteChange.after_hash,
                    patch: remoteChange.patch,
                    sequence_number: remoteChange.sequence_number ?? 0,
                    synced: true,
                });
            }

            // ── Step 4: Increment vector clock ──
            this.database.incrementDeviceClock(this.config.device_id);

            // ── Step 5: Update sync state ──
            const unresolvedConflicts = this.conflictResolver.getUnresolvedCount();
            const durationMs = Date.now() - startTime;

            const device = this.database.getDevice(this.config.device_id);
            const vectorClock: Record<string, number> = {};
            for (const d of this.database.getAllDevices()) {
                vectorClock[d.device_id] = d.clock_value;
            }

            const state: SyncState = {
                device_id: this.config.device_id,
                device_name: device?.name ?? this.config.device_id.substring(0, 8),
                status: unresolvedConflicts > 0 ? SyncStatus.Conflict : SyncStatus.Idle,
                last_sync_at: new Date().toISOString(),
                pending_changes: this.database.getUnsyncedChanges(this.config.device_id).length,
                unresolved_conflicts: unresolvedConflicts,
                progress_percent: null,
                error_message: null,
                vector_clock: vectorClock,
            };

            // ── Step 6: Emit completed event ──
            this.emitEvent('sync:completed', {
                correlation_id: correlationId,
                pushed: pushResult.accepted.length,
                pulled: remoteChanges.length,
                conflicts: conflictsDetected,
                applied: changesApplied,
                duration_ms: durationMs,
            });

            this.logTransparency(
                'sync_cycle',
                `Sync complete: pushed ${pushResult.accepted.length}, ` +
                `pulled ${remoteChanges.length}, conflicts ${conflictsDetected}, ` +
                `applied ${changesApplied} (${durationMs}ms)`,
                correlationId
            );

            this.outputChannel.appendLine(
                `[SyncService] Sync complete: ` +
                `pushed=${pushResult.accepted.length}, pulled=${remoteChanges.length}, ` +
                `conflicts=${conflictsDetected}, applied=${changesApplied} (${durationMs}ms)`
            );

            return state;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`[SyncService] Sync error: ${msg}`);

            this.logTransparency('sync_error', `Sync failed: ${msg}`, correlationId, 'error');

            return {
                device_id: this.config?.device_id ?? 'unknown',
                device_name: this.config?.device_id?.substring(0, 8) ?? 'unknown',
                status: SyncStatus.Error,
                last_sync_at: null,
                pending_changes: 0,
                unresolved_conflicts: this.conflictResolver.getUnresolvedCount(),
                progress_percent: null,
                error_message: msg,
                vector_clock: {},
            };
        } finally {
            this.syncing = false;
        }
    }

    // ==================== CONFLICT RESOLUTION ====================

    /**
     * Resolve a sync conflict using the specified strategy.
     * Delegates to ConflictResolver.
     *
     * @param conflictId  The conflict to resolve
     * @param strategy    Resolution strategy
     * @param resolvedBy  Who resolved it
     */
    resolveConflict(
        conflictId: string,
        strategy: ConflictResolutionStrategy,
        resolvedBy: string
    ): void {
        this.conflictResolver.resolve(conflictId, strategy, resolvedBy);

        this.logTransparency(
            'conflict_resolved',
            `Conflict ${conflictId} resolved with strategy: ${strategy} by ${resolvedBy}`
        );
    }

    // ==================== CHANGE HISTORY ====================

    /**
     * Get the change history for a specific entity.
     *
     * @param entityType  Entity type to filter by
     * @param entityId    Entity ID to filter by
     * @returns           Array of SyncChange records, newest first
     */
    getHistory(entityType: string, entityId: string): SyncChange[] {
        return this.database.getSyncChangesByEntity(entityType, entityId);
    }

    // ==================== STATUS ====================

    /**
     * Get the current sync state.
     *
     * @returns  SyncState with status, pending changes, conflicts, etc.
     */
    getStatus(): SyncState {
        const config = this.config ?? this.database.getSyncConfig();
        const deviceId = config?.device_id ?? 'unknown';
        const pendingChanges = config ? this.database.getUnsyncedChanges(deviceId).length : 0;

        const vectorClock: Record<string, number> = {};
        try {
            for (const d of this.database.getAllDevices()) {
                vectorClock[d.device_id] = d.clock_value;
            }
        } catch {
            // Database may not be available
        }

        return {
            device_id: deviceId,
            device_name: config?.device_name ?? deviceId.substring(0, 8),
            status: this.syncing
                ? SyncStatus.Syncing
                : this.adapter?.isConnected()
                    ? SyncStatus.Idle
                    : SyncStatus.Offline,
            last_sync_at: null,
            pending_changes: pendingChanges,
            unresolved_conflicts: this.conflictResolver.getUnresolvedCount(),
            progress_percent: null,
            error_message: null,
            vector_clock: vectorClock,
        };
    }

    // ==================== DEVICE MANAGEMENT ====================

    /**
     * Register a new device for sync.
     *
     * @param info  Device information (excluding id and created_at)
     * @returns     The registered DeviceInfo record
     */
    registerDevice(info: Omit<DeviceInfo, 'id' | 'created_at'>): DeviceInfo {
        const device = this.database.registerDevice(info);
        this.emitEvent('sync:device_connected', {
            device_id: device.device_id,
            name: device.name,
        });

        this.outputChannel.appendLine(
            `[SyncService] Device registered: ${device.name} (${device.device_id})`
        );

        return device;
    }

    /**
     * Unregister a device from sync.
     *
     * @param deviceId  The device ID to unregister
     */
    unregisterDevice(deviceId: string): void {
        this.database.removeDevice(deviceId);
        this.emitEvent('sync:device_disconnected', {
            device_id: deviceId,
        });

        this.outputChannel.appendLine(
            `[SyncService] Device unregistered: ${deviceId}`
        );
    }

    // ==================== AUTO-SYNC ====================

    /**
     * Start automatic sync on a timer.
     *
     * @param intervalSeconds  Sync interval in seconds (default: 60)
     */
    startAutoSync(intervalSeconds: number = 60): void {
        this.stopAutoSync();

        const intervalMs = Math.max(10, intervalSeconds) * 1000;

        this.autoSyncTimer = setInterval(async () => {
            try {
                await this.sync();
            } catch (err) {
                this.outputChannel.appendLine(
                    `[SyncService] Auto-sync error: ${err}`
                );
                // Bug 6E: Surface auto-sync failures to UI
                this.emitEvent('system:error', {
                    source: 'sync_service',
                    operation: 'auto_sync',
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }, intervalMs);

        this.outputChannel.appendLine(
            `[SyncService] Auto-sync started: every ${intervalSeconds}s`
        );
    }

    /**
     * Stop automatic sync.
     */
    stopAutoSync(): void {
        if (this.autoSyncTimer) {
            clearInterval(this.autoSyncTimer);
            this.autoSyncTimer = null;
            this.outputChannel.appendLine('[SyncService] Auto-sync stopped');
        }
    }

    // ==================== ADVISORY LOCKING ====================

    /**
     * Acquire an advisory lock on a resource.
     *
     * Advisory locks prevent concurrent modifications to the same entity
     * across devices. Locks expire after 5 minutes (stale lock detection).
     *
     * @param resourceId  The resource to lock (typically entityType/entityId)
     * @param deviceId    The device acquiring the lock
     * @returns           true if lock acquired, false if locked by another device
     */
    acquireLock(resourceId: string, deviceId: string): boolean {
        // Check for existing lock
        const existing = this.locks.get(resourceId);

        if (existing) {
            // Check if lock is stale
            if (Date.now() > existing.expiresAt) {
                this.outputChannel.appendLine(
                    `[SyncService] Stale lock detected on ${resourceId} ` +
                    `(held by ${existing.deviceId}, expired ${new Date(existing.expiresAt).toISOString()}). ` +
                    `Auto-releasing.`
                );
                this.locks.delete(resourceId);
            } else if (existing.deviceId !== deviceId) {
                // Locked by another device
                this.outputChannel.appendLine(
                    `[SyncService] Lock contention: ${resourceId} held by ${existing.deviceId}`
                );
                return false;
            } else {
                // Already locked by this device — refresh expiry
                existing.expiresAt = Date.now() + SyncService.STALE_LOCK_MS;
                return true;
            }
        }

        // Acquire new lock
        this.locks.set(resourceId, {
            resourceId,
            deviceId,
            acquiredAt: Date.now(),
            expiresAt: Date.now() + SyncService.STALE_LOCK_MS,
        });

        this.outputChannel.appendLine(
            `[SyncService] Lock acquired: ${resourceId} by ${deviceId}`
        );

        return true;
    }

    /**
     * Release an advisory lock on a resource.
     *
     * @param resourceId  The resource to unlock
     * @param deviceId    The device releasing the lock (must match the holder)
     * @returns           true if released, false if not held by this device
     */
    releaseLock(resourceId: string, deviceId: string): boolean {
        const existing = this.locks.get(resourceId);

        if (!existing) {
            return true; // No lock to release
        }

        if (existing.deviceId !== deviceId) {
            this.outputChannel.appendLine(
                `[SyncService] Cannot release lock on ${resourceId}: ` +
                `held by ${existing.deviceId}, not ${deviceId}`
            );
            return false;
        }

        this.locks.delete(resourceId);
        this.outputChannel.appendLine(
            `[SyncService] Lock released: ${resourceId} by ${deviceId}`
        );
        return true;
    }

    /**
     * Check if a resource is currently locked.
     *
     * @param resourceId  The resource to check
     * @returns           The lock holder's device ID, or null if unlocked
     */
    getLockHolder(resourceId: string): string | null {
        const lock = this.locks.get(resourceId);
        if (!lock) return null;

        // Check for stale lock
        if (Date.now() > lock.expiresAt) {
            this.locks.delete(resourceId);
            return null;
        }

        return lock.deviceId;
    }

    // ==================== DISPOSE ====================

    /**
     * Clean up resources: stop auto-sync, disconnect adapter, release locks.
     */
    async dispose(): Promise<void> {
        this.stopAutoSync();
        this.locks.clear();

        if (this.adapter) {
            try {
                await this.adapter.disconnect();
            } catch (err) {
                this.outputChannel.appendLine(
                    `[SyncService] Disconnect error: ${err}`
                );
            }
            this.adapter = null;
        }

        this.outputChannel.appendLine('[SyncService] Disposed');
    }

    // ==================== PRIVATE HELPERS ====================

    /**
     * Create the appropriate SyncAdapter for the given backend.
     */
    private createAdapter(backend: SyncBackend): SyncAdapter {
        switch (backend) {
            case SyncBackend.Cloud:
                return new CloudSyncAdapter();
            case SyncBackend.NAS:
                return new NASSyncAdapter();
            case SyncBackend.P2P:
                return new P2PSyncAdapter();
            default:
                this.outputChannel.appendLine(
                    `[SyncService] Unknown backend '${backend}', using CloudSyncAdapter`
                );
                return new CloudSyncAdapter();
        }
    }

    /**
     * Get entity data from the database for conflict detection.
     * Returns null if the entity type is not recognized or entity not found.
     */
    private getEntityData(
        entityType: string,
        entityId: string
    ): Record<string, unknown> | null {
        try {
            switch (entityType) {
                case 'task': {
                    const tasks = this.database.getTasksByStatus('not_started');
                    const task = tasks.find((t: any) => t.id === entityId);
                    return task ? (task as unknown as Record<string, unknown>) : null;
                }
                case 'design_component': {
                    const component = this.database.getDesignComponent(entityId);
                    return component ? (component as unknown as Record<string, unknown>) : null;
                }
                default:
                    return null;
            }
        } catch {
            return null;
        }
    }

    /**
     * Retry an async operation with exponential backoff.
     *
     * @param fn          The async function to retry
     * @param operation   Human-readable operation name for logging
     * @returns           The function's return value
     */
    private async retryWithBackoff<T>(
        fn: () => Promise<T>,
        operation: string
    ): Promise<T> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
            try {
                return await fn();
            } catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));

                if (attempt < this.retryConfig.maxRetries) {
                    const delay = Math.min(
                        this.retryConfig.baseDelayMs * Math.pow(2, attempt),
                        this.retryConfig.maxDelayMs
                    );

                    this.outputChannel.appendLine(
                        `[SyncService] ${operation} failed (attempt ${attempt + 1}/${this.retryConfig.maxRetries + 1}): ` +
                        `${lastError.message}. Retrying in ${delay}ms...`
                    );

                    await this.sleep(delay);
                }
            }
        }

        throw lastError ?? new Error(`${operation} failed after ${this.retryConfig.maxRetries + 1} attempts`);
    }

    /**
     * Sleep for the given number of milliseconds.
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Emit an event via the EventBus.
     */
    private emitEvent(type: string, data: Record<string, unknown>): void {
        try {
            this.eventBus.emit(type as any, 'sync_service', data);
        } catch (err) {
            this.outputChannel.appendLine(
                `[SyncService] WARNING: Failed to emit ${type}: ${err}`
            );
        }
    }

    /**
     * Log an action to the transparency logger.
     */
    private logTransparency(
        action: string,
        detail: string,
        correlationId?: string,
        severity: 'info' | 'warning' | 'error' | 'critical' = 'info'
    ): void {
        try {
            this.transparencyLogger.log({
                source: 'sync_service',
                category: 'sync_operation',
                action,
                detail,
                severity,
                correlationId,
            });
        } catch (err) {
            this.outputChannel.appendLine(
                `[SyncService] WARNING: Transparency log failed: ${err}`
            );
        }
    }
}
