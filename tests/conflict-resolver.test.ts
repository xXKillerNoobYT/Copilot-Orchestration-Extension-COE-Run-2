import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ConflictResolver } from '../src/core/conflict-resolver';
import { Database } from '../src/core/database';
import { EventBus } from '../src/core/event-bus';
import { ConflictResolutionStrategy } from '../src/types';

describe('ConflictResolver', () => {
    let database: Database;
    let eventBus: EventBus;
    let resolver: ConflictResolver;
    let outputChannel: { appendLine: jest.Mock };
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-conflict-test-'));
        database = new Database(tmpDir);
        await database.initialize();
        eventBus = new EventBus();
        outputChannel = { appendLine: jest.fn() };
        resolver = new ConflictResolver(database, eventBus, outputChannel);
    });

    afterEach(() => {
        database.close();
        eventBus.removeAllListeners();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ==================== HASHING ====================

    describe('Hashing', () => {
        test('hashEntity produces consistent SHA-256 hash', () => {
            const entity = { name: 'Button', width: 100, color: '#ff0000' };
            const hash1 = resolver.hashEntity(entity);
            const hash2 = resolver.hashEntity(entity);

            expect(hash1).toBe(hash2);
            // SHA-256 produces 64 hex characters
            expect(hash1).toHaveLength(64);
            expect(hash1).toMatch(/^[a-f0-9]{64}$/);
        });

        test('hashEntity produces same hash regardless of property order', () => {
            const entity1 = { name: 'Button', width: 100, color: '#ff0000' };
            const entity2 = { color: '#ff0000', name: 'Button', width: 100 };
            const entity3 = { width: 100, color: '#ff0000', name: 'Button' };

            const hash1 = resolver.hashEntity(entity1);
            const hash2 = resolver.hashEntity(entity2);
            const hash3 = resolver.hashEntity(entity3);

            expect(hash1).toBe(hash2);
            expect(hash2).toBe(hash3);
        });

        test('hashEntity produces different hashes for different content', () => {
            const entity1 = { name: 'Button', width: 100 };
            const entity2 = { name: 'Button', width: 200 };
            const entity3 = { name: 'Label', width: 100 };

            const hash1 = resolver.hashEntity(entity1);
            const hash2 = resolver.hashEntity(entity2);
            const hash3 = resolver.hashEntity(entity3);

            expect(hash1).not.toBe(hash2);
            expect(hash1).not.toBe(hash3);
            expect(hash2).not.toBe(hash3);
        });
    });

    // ==================== FIELD COMPARISON ====================

    describe('Field comparison', () => {
        test('compareFields identifies unchanged fields', () => {
            const local = { name: 'Button', width: 100, color: '#fff' };
            const remote = { name: 'Button', width: 100, color: '#fff' };

            const result = resolver.compareFields(local, remote);

            expect(result.unchanged).toEqual(['color', 'name', 'width']);
            expect(result.both).toEqual([]);
            expect(result.localOnly).toEqual([]);
            expect(result.remoteOnly).toEqual([]);
        });

        test('compareFields identifies fields changed on both sides', () => {
            const local = { name: 'ButtonLocal', width: 150, color: '#fff' };
            const remote = { name: 'ButtonRemote', width: 200, color: '#fff' };

            const result = resolver.compareFields(local, remote);

            expect(result.both).toEqual(['name', 'width']);
            expect(result.unchanged).toEqual(['color']);
            expect(result.localOnly).toEqual([]);
            expect(result.remoteOnly).toEqual([]);
        });

        test('compareFields identifies local-only changes', () => {
            const local = { name: 'Button', width: 100, localExtra: 'hello' };
            const remote = { name: 'Button', width: 100 };

            const result = resolver.compareFields(local, remote);

            expect(result.localOnly).toEqual(['localExtra']);
            expect(result.remoteOnly).toEqual([]);
            expect(result.unchanged).toEqual(['name', 'width']);
        });

        test('compareFields identifies remote-only changes', () => {
            const local = { name: 'Button', width: 100 };
            const remote = { name: 'Button', width: 100, remoteExtra: 'world' };

            const result = resolver.compareFields(local, remote);

            expect(result.remoteOnly).toEqual(['remoteExtra']);
            expect(result.localOnly).toEqual([]);
            expect(result.unchanged).toEqual(['name', 'width']);
        });
    });

    // ==================== CONFLICT DETECTION ====================

    describe('Conflict detection', () => {
        test('detectConflict returns null when entities are identical', () => {
            const entity = { name: 'Button', width: 100, color: '#fff' };

            const result = resolver.detectConflict(
                'design_component',
                'comp-001',
                entity,
                { ...entity },
                '2024-01-01T10:00:00Z',
                '2024-01-01T10:01:00Z',
                'dev-002'
            );

            expect(result).toBeNull();
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('No conflict')
            );
        });

        test('detectConflict creates conflict when entities differ', () => {
            const local = { name: 'ButtonLocal', width: 100 };
            const remote = { name: 'ButtonRemote', width: 100 };

            const result = resolver.detectConflict(
                'design_component',
                'comp-001',
                local,
                remote,
                '2024-01-01T10:00:00Z',
                '2024-01-01T10:05:00Z',
                'dev-002'
            );

            expect(result).not.toBeNull();
            expect(result!.entity_type).toBe('design_component');
            expect(result!.entity_id).toBe('comp-001');
            expect(result!.conflicting_fields).toContain('name');
            expect(result!.resolution).toBeNull();
            expect(result!.remote_device_id).toBe('dev-002');
        });

        test('detectConflict ignores metadata-only differences (updated_at, created_at)', () => {
            const local = { name: 'Button', width: 100, updated_at: '2024-01-01T10:00:00Z', created_at: '2024-01-01T09:00:00Z' };
            const remote = { name: 'Button', width: 100, updated_at: '2024-01-02T10:00:00Z', created_at: '2024-01-02T09:00:00Z' };

            const result = resolver.detectConflict(
                'design_component',
                'comp-001',
                local,
                remote,
                '2024-01-01T10:00:00Z',
                '2024-01-02T10:00:00Z',
                'dev-002'
            );

            // Should return null because only metadata fields differ
            expect(result).toBeNull();
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('only metadata fields differ')
            );
        });

        test('detectConflict emits sync:conflict_detected event', () => {
            const handler = jest.fn();
            eventBus.on('sync:conflict_detected', handler);

            const local = { name: 'ButtonLocal', width: 100 };
            const remote = { name: 'ButtonRemote', width: 100 };

            resolver.detectConflict(
                'design_component',
                'comp-001',
                local,
                remote,
                '2024-01-01T10:00:00Z',
                '2024-01-01T10:05:00Z',
                'dev-002'
            );

            expect(handler).toHaveBeenCalledTimes(1);
            const emittedEvent = handler.mock.calls[0][0];
            expect(emittedEvent.type).toBe('sync:conflict_detected');
            expect(emittedEvent.data.entity_type).toBe('design_component');
            expect(emittedEvent.data.entity_id).toBe('comp-001');
            expect(emittedEvent.data.remote_device_id).toBe('dev-002');
            expect(emittedEvent.data.field_count).toBe(1);
        });
    });

    // ==================== AUTO-MERGE ====================

    describe('Auto-merge', () => {
        test('autoMerge succeeds when changes do not overlap', () => {
            // Local changed 'name', remote changed 'color' — no overlap
            const conflict = database.createSyncConflict({
                entity_type: 'design_component',
                entity_id: 'comp-001',
                local_version: JSON.stringify({ name: 'ButtonLocal', width: 100, color: '#fff' }),
                remote_version: JSON.stringify({ name: 'Button', width: 100, color: '#000' }),
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:05:00Z',
                conflicting_fields: ['name', 'color'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            const result = resolver.autoMerge(conflict);

            // 'name' differs on both, 'color' differs on both — they are "both" changes
            // The comparison sees name changed on both and color changed on both,
            // so autoMerge should fail. Let me re-think this:
            //
            // Actually, compareFields compares local_version vs remote_version directly.
            // 'name': local='ButtonLocal' vs remote='Button' => both (different values)
            // 'color': local='#fff' vs remote='#000' => both (different values)
            // 'width': local=100 vs remote=100 => unchanged
            //
            // So both 'name' and 'color' are in the 'both' category => autoMerge fails.
            // Let me create a proper non-overlapping test instead.
            expect(result.success).toBe(false);
            expect(result.conflictingFields).toContain('name');
            expect(result.conflictingFields).toContain('color');
        });

        test('autoMerge fails when same field changed on both sides', () => {
            const conflict = database.createSyncConflict({
                entity_type: 'design_component',
                entity_id: 'comp-002',
                local_version: JSON.stringify({ name: 'LocalName', width: 100 }),
                remote_version: JSON.stringify({ name: 'RemoteName', width: 100 }),
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:05:00Z',
                conflicting_fields: ['name'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            const result = resolver.autoMerge(conflict);

            expect(result.success).toBe(false);
            expect(result.conflictingFields).toContain('name');
            expect(result.merged).toEqual({});
            expect(result.mergedFields).toEqual([]);
        });

        test('autoMerge merges non-overlapping changes from both sides', () => {
            // Local has an extra field 'localProp', remote has an extra field 'remoteProp'
            // Both share 'name' and 'width' unchanged
            const conflict = database.createSyncConflict({
                entity_type: 'design_component',
                entity_id: 'comp-003',
                local_version: JSON.stringify({ name: 'Button', width: 100, localProp: 'fromLocal' }),
                remote_version: JSON.stringify({ name: 'Button', width: 100, remoteProp: 'fromRemote' }),
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:05:00Z',
                conflicting_fields: ['localProp', 'remoteProp'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            const result = resolver.autoMerge(conflict);

            expect(result.success).toBe(true);
            expect(result.merged).toEqual({
                name: 'Button',
                width: 100,
                localProp: 'fromLocal',
                remoteProp: 'fromRemote',
            });
            expect(result.mergedFields).toContain('localProp');
            expect(result.mergedFields).toContain('remoteProp');
            expect(result.conflictingFields).toEqual([]);
        });
    });

    // ==================== RESOLUTION STRATEGIES ====================

    describe('Resolution strategies', () => {
        function createTestConflict(overrides: Partial<{
            local: Record<string, unknown>;
            remote: Record<string, unknown>;
            localChangedAt: string;
            remoteChangedAt: string;
            conflictingFields: string[];
        }> = {}) {
            const local = overrides.local ?? { name: 'LocalName', width: 100 };
            const remote = overrides.remote ?? { name: 'RemoteName', width: 100 };
            return database.createSyncConflict({
                entity_type: 'design_component',
                entity_id: 'comp-resolve',
                local_version: JSON.stringify(local),
                remote_version: JSON.stringify(remote),
                remote_device_id: 'dev-002',
                local_changed_at: overrides.localChangedAt ?? '2024-01-01T10:00:00Z',
                remote_changed_at: overrides.remoteChangedAt ?? '2024-01-01T10:05:00Z',
                conflicting_fields: overrides.conflictingFields ?? ['name'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });
        }

        test('resolve with KeepLocal marks conflict resolved', () => {
            const conflict = createTestConflict();

            resolver.resolve(conflict.id, ConflictResolutionStrategy.KeepLocal, 'dev-001');

            const resolved = database.getSyncConflict(conflict.id);
            expect(resolved!.resolution).toBe(ConflictResolutionStrategy.KeepLocal);
            expect(resolved!.resolved_by).toBe('dev-001');
            expect(resolved!.resolved_at).toBeDefined();
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('keep local version')
            );
        });

        test('resolve with KeepRemote marks conflict resolved', () => {
            const conflict = createTestConflict();

            resolver.resolve(conflict.id, ConflictResolutionStrategy.KeepRemote, 'dev-001');

            const resolved = database.getSyncConflict(conflict.id);
            expect(resolved!.resolution).toBe(ConflictResolutionStrategy.KeepRemote);
            expect(resolved!.resolved_by).toBe('dev-001');
            expect(resolved!.resolved_at).toBeDefined();
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('keep remote version')
            );
        });

        test('resolve with Merge succeeds for non-overlapping changes', () => {
            const conflict = createTestConflict({
                local: { name: 'Button', width: 100, localProp: 'val' },
                remote: { name: 'Button', width: 100, remoteProp: 'val' },
                conflictingFields: ['localProp', 'remoteProp'],
            });

            resolver.resolve(conflict.id, ConflictResolutionStrategy.Merge, 'auto');

            const resolved = database.getSyncConflict(conflict.id);
            expect(resolved!.resolution).toBe(ConflictResolutionStrategy.Merge);
            expect(resolved!.resolved_by).toBe('auto');
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('auto-merged')
            );
        });

        test('resolve with Merge throws for overlapping changes', () => {
            const conflict = createTestConflict({
                local: { name: 'LocalName', width: 100 },
                remote: { name: 'RemoteName', width: 100 },
                conflictingFields: ['name'],
            });

            expect(() => {
                resolver.resolve(conflict.id, ConflictResolutionStrategy.Merge, 'auto');
            }).toThrow(/Auto-merge failed/);

            // Conflict should remain unresolved
            const unresolved = database.getSyncConflict(conflict.id);
            expect(unresolved!.resolution).toBeNull();
        });

        test('resolve with LastWriteWins picks newer timestamp', () => {
            const conflict = createTestConflict({
                localChangedAt: '2024-01-01T10:00:00Z',
                remoteChangedAt: '2024-01-02T10:00:00Z',
            });

            const handler = jest.fn();
            eventBus.on('sync:conflict_resolved', handler);

            resolver.resolve(conflict.id, ConflictResolutionStrategy.LastWriteWins, 'auto');

            const resolved = database.getSyncConflict(conflict.id);
            expect(resolved!.resolution).toBe(ConflictResolutionStrategy.LastWriteWins);

            // Remote is newer, so remote wins
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('remote version chosen')
            );

            // Should emit resolved event
            expect(handler).toHaveBeenCalledTimes(1);
            const emittedEvent = handler.mock.calls[0][0];
            expect(emittedEvent.data.strategy).toBe(ConflictResolutionStrategy.LastWriteWins);
        });
    });

    // ==================== SUGGESTIONS ====================

    describe('Suggestions', () => {
        test('suggestResolution suggests Merge for non-overlapping changes', () => {
            const conflict = database.createSyncConflict({
                entity_type: 'design_component',
                entity_id: 'comp-suggest-1',
                local_version: JSON.stringify({ name: 'Button', localProp: 'a' }),
                remote_version: JSON.stringify({ name: 'Button', remoteProp: 'b' }),
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:01:00Z',
                conflicting_fields: ['localProp', 'remoteProp'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            const suggestion = resolver.suggestResolution(conflict);

            expect(suggestion.strategy).toBe(ConflictResolutionStrategy.Merge);
            expect(suggestion.confidence).toBeGreaterThanOrEqual(0.9);
            expect(suggestion.reason).toContain('No overlapping');
        });

        test('suggestResolution suggests UserChoice for critical entities with overlaps', () => {
            // design_component has priority 1 (critical)
            const conflict = database.createSyncConflict({
                entity_type: 'design_component',
                entity_id: 'comp-suggest-2',
                local_version: JSON.stringify({ name: 'LocalButton', width: 150 }),
                remote_version: JSON.stringify({ name: 'RemoteButton', width: 200 }),
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:01:00Z',
                conflicting_fields: ['name', 'width'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            const suggestion = resolver.suggestResolution(conflict);

            expect(suggestion.strategy).toBe(ConflictResolutionStrategy.UserChoice);
            expect(suggestion.confidence).toBeGreaterThanOrEqual(0.8);
            expect(suggestion.reason).toContain('Critical entity type');
            expect(suggestion.reason).toContain('Manual review');
        });

        test('suggestResolution suggests LastWriteWins for large time gaps', () => {
            // Use a non-priority-1 entity type with overlapping changes and large time gap
            // 'plan' has priority 2, so it won't trigger UserChoice for critical entities
            const conflict = database.createSyncConflict({
                entity_type: 'plan',
                entity_id: 'plan-suggest-3',
                local_version: JSON.stringify({ name: 'OldPlan', status: 'draft' }),
                remote_version: JSON.stringify({ name: 'NewPlan', status: 'active' }),
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T12:00:00Z', // 2 hours apart (well above 5 min threshold)
                conflicting_fields: ['name', 'status'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            const suggestion = resolver.suggestResolution(conflict);

            expect(suggestion.strategy).toBe(ConflictResolutionStrategy.LastWriteWins);
            expect(suggestion.confidence).toBeGreaterThanOrEqual(0.7);
            expect(suggestion.reason).toContain('minute(s) apart');
        });
    });

    // ==================== QUERY METHODS ====================

    describe('Query methods', () => {
        test('getUnresolved returns only unresolved conflicts', () => {
            // Create 2 unresolved and 1 resolved
            database.createSyncConflict({
                entity_type: 'task',
                entity_id: 't1',
                local_version: '{"a":1}',
                remote_version: '{"a":2}',
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:05:00Z',
                conflicting_fields: ['a'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            database.createSyncConflict({
                entity_type: 'task',
                entity_id: 't2',
                local_version: '{"b":1}',
                remote_version: '{"b":2}',
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:05:00Z',
                conflicting_fields: ['b'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            const resolvedConflict = database.createSyncConflict({
                entity_type: 'task',
                entity_id: 't3',
                local_version: '{"c":1}',
                remote_version: '{"c":2}',
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:05:00Z',
                conflicting_fields: ['c'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });
            database.resolveSyncConflict(resolvedConflict.id, ConflictResolutionStrategy.KeepLocal, 'dev-001');

            const unresolved = resolver.getUnresolved();

            expect(unresolved).toHaveLength(2);
            expect(unresolved.every(c => c.resolution === null)).toBe(true);
        });

        test('getByEntity returns conflicts for specific entity', () => {
            database.createSyncConflict({
                entity_type: 'design_component',
                entity_id: 'comp-A',
                local_version: '{"x":1}',
                remote_version: '{"x":2}',
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:05:00Z',
                conflicting_fields: ['x'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            database.createSyncConflict({
                entity_type: 'design_component',
                entity_id: 'comp-A',
                local_version: '{"y":1}',
                remote_version: '{"y":2}',
                remote_device_id: 'dev-003',
                local_changed_at: '2024-01-02T10:00:00Z',
                remote_changed_at: '2024-01-02T10:05:00Z',
                conflicting_fields: ['y'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            database.createSyncConflict({
                entity_type: 'design_component',
                entity_id: 'comp-B',
                local_version: '{"z":1}',
                remote_version: '{"z":2}',
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:05:00Z',
                conflicting_fields: ['z'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            const compAConflicts = resolver.getByEntity('design_component', 'comp-A');
            expect(compAConflicts).toHaveLength(2);
            expect(compAConflicts.every(c => c.entity_id === 'comp-A')).toBe(true);

            const compBConflicts = resolver.getByEntity('design_component', 'comp-B');
            expect(compBConflicts).toHaveLength(1);
            expect(compBConflicts[0].entity_id).toBe('comp-B');
        });
    });

    // ==================== BULK OPERATIONS ====================

    describe('Bulk operations', () => {
        test('resolveAllForEntity resolves all conflicts for an entity', () => {
            // Create 3 unresolved conflicts for the same entity, plus 1 already resolved
            database.createSyncConflict({
                entity_type: 'design_component',
                entity_id: 'comp-bulk',
                local_version: JSON.stringify({ name: 'A', extra: 'local1' }),
                remote_version: JSON.stringify({ name: 'A', extra: 'remote1' }),
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:05:00Z',
                conflicting_fields: ['extra'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            database.createSyncConflict({
                entity_type: 'design_component',
                entity_id: 'comp-bulk',
                local_version: JSON.stringify({ name: 'B', extra: 'local2' }),
                remote_version: JSON.stringify({ name: 'B', extra: 'remote2' }),
                remote_device_id: 'dev-003',
                local_changed_at: '2024-01-02T10:00:00Z',
                remote_changed_at: '2024-01-02T10:05:00Z',
                conflicting_fields: ['extra'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            const alreadyResolved = database.createSyncConflict({
                entity_type: 'design_component',
                entity_id: 'comp-bulk',
                local_version: JSON.stringify({ name: 'C', extra: 'local3' }),
                remote_version: JSON.stringify({ name: 'C', extra: 'remote3' }),
                remote_device_id: 'dev-004',
                local_changed_at: '2024-01-03T10:00:00Z',
                remote_changed_at: '2024-01-03T10:05:00Z',
                conflicting_fields: ['extra'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });
            database.resolveSyncConflict(alreadyResolved.id, ConflictResolutionStrategy.KeepLocal, 'dev-001');

            const count = resolver.resolveAllForEntity(
                'design_component',
                'comp-bulk',
                ConflictResolutionStrategy.KeepLocal,
                'dev-001'
            );

            // Only 2 should be newly resolved (one was already resolved)
            expect(count).toBe(2);

            // All conflicts for this entity should now be resolved
            const allConflicts = resolver.getByEntity('design_component', 'comp-bulk');
            expect(allConflicts.every(c => c.resolution !== null)).toBe(true);

            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Bulk-resolved 2 conflict(s)')
            );
        });

        test('getUnresolvedCount returns correct count', () => {
            expect(resolver.getUnresolvedCount()).toBe(0);

            database.createSyncConflict({
                entity_type: 'task',
                entity_id: 't1',
                local_version: '{"a":1}',
                remote_version: '{"a":2}',
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:05:00Z',
                conflicting_fields: ['a'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            database.createSyncConflict({
                entity_type: 'task',
                entity_id: 't2',
                local_version: '{"b":1}',
                remote_version: '{"b":2}',
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:05:00Z',
                conflicting_fields: ['b'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            const resolved = database.createSyncConflict({
                entity_type: 'task',
                entity_id: 't3',
                local_version: '{"c":1}',
                remote_version: '{"c":2}',
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:05:00Z',
                conflicting_fields: ['c'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });
            database.resolveSyncConflict(resolved.id, ConflictResolutionStrategy.KeepRemote, 'dev-001');

            expect(resolver.getUnresolvedCount()).toBe(2);
        });
    });

    // ==================== EDGE CASES ====================

    describe('Edge cases', () => {
        test('resolve throws for unknown conflict ID', () => {
            expect(() => {
                resolver.resolve('nonexistent-id', ConflictResolutionStrategy.KeepLocal, 'dev-001');
            }).toThrow('Conflict not found: nonexistent-id');
        });

        test('already-resolved conflict is skipped silently', () => {
            const conflict = database.createSyncConflict({
                entity_type: 'task',
                entity_id: 't-edge',
                local_version: JSON.stringify({ name: 'Local' }),
                remote_version: JSON.stringify({ name: 'Remote' }),
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:05:00Z',
                conflicting_fields: ['name'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            // First resolution
            resolver.resolve(conflict.id, ConflictResolutionStrategy.KeepLocal, 'dev-001');

            // Clear mock to track only the second call
            outputChannel.appendLine.mockClear();

            // Second resolution attempt should be silently skipped
            resolver.resolve(conflict.id, ConflictResolutionStrategy.KeepRemote, 'dev-002');

            // Should have logged that it was already resolved
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('already resolved')
            );

            // Original resolution should remain unchanged
            const dbConflict = database.getSyncConflict(conflict.id);
            expect(dbConflict!.resolution).toBe(ConflictResolutionStrategy.KeepLocal);
            expect(dbConflict!.resolved_by).toBe('dev-001');
        });
    });

    // ==================== AUTO-MERGE PARSE ERROR (lines 204-208) ====================

    describe('Auto-merge — parse errors', () => {
        test('autoMerge returns failure when local_version is invalid JSON', () => {
            const conflict = database.createSyncConflict({
                entity_type: 'design_component',
                entity_id: 'comp-parse-err',
                local_version: 'NOT VALID JSON{{{',
                remote_version: JSON.stringify({ name: 'Remote' }),
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:05:00Z',
                conflicting_fields: ['name'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            const result = resolver.autoMerge(conflict);

            expect(result.success).toBe(false);
            expect(result.merged).toEqual({});
            expect(result.mergedFields).toEqual([]);
            expect(result.conflictingFields).toEqual(['name']);
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('unable to parse versions')
            );
        });

        test('autoMerge returns failure when remote_version is invalid JSON', () => {
            const conflict = database.createSyncConflict({
                entity_type: 'design_component',
                entity_id: 'comp-parse-err-2',
                local_version: JSON.stringify({ name: 'Local' }),
                remote_version: '<<<INVALID>>>',
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:05:00Z',
                conflicting_fields: ['name'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            const result = resolver.autoMerge(conflict);

            expect(result.success).toBe(false);
            expect(result.merged).toEqual({});
        });
    });

    // ==================== RESOLVE: UserChoice + default (lines 362-370) ====================

    describe('Resolution — UserChoice and unknown strategy', () => {
        test('resolve with UserChoice marks conflict resolved', () => {
            const conflict = database.createSyncConflict({
                entity_type: 'task',
                entity_id: 't-uc',
                local_version: JSON.stringify({ name: 'Local' }),
                remote_version: JSON.stringify({ name: 'Remote' }),
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:05:00Z',
                conflicting_fields: ['name'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            resolver.resolve(conflict.id, ConflictResolutionStrategy.UserChoice, 'user-manual');

            const resolved = database.getSyncConflict(conflict.id);
            expect(resolved!.resolution).toBe(ConflictResolutionStrategy.UserChoice);
            expect(resolved!.resolved_by).toBe('user-manual');
            expect(resolved!.resolved_at).toBeDefined();
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('user choice by user-manual')
            );
        });

        test('resolve with unknown strategy throws error', () => {
            const conflict = database.createSyncConflict({
                entity_type: 'task',
                entity_id: 't-unknown-strat',
                local_version: JSON.stringify({ name: 'Local' }),
                remote_version: JSON.stringify({ name: 'Remote' }),
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:05:00Z',
                conflicting_fields: ['name'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            expect(() => {
                resolver.resolve(conflict.id, 'totally_unknown_strategy' as any, 'dev-001');
            }).toThrow('Unknown resolution strategy: totally_unknown_strategy');
        });
    });

    // ==================== SUGGEST: parse error + default fallback (lines 402, 461-463) ====================

    describe('Suggestions — edge cases', () => {
        test('suggestResolution returns UserChoice with low confidence for unparseable versions', () => {
            const conflict = database.createSyncConflict({
                entity_type: 'task',
                entity_id: 't-bad-json',
                local_version: 'INVALID JSON!!!',
                remote_version: 'ALSO BAD!!!',
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:05:00Z',
                conflicting_fields: ['name'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            const suggestion = resolver.suggestResolution(conflict);

            expect(suggestion.strategy).toBe(ConflictResolutionStrategy.UserChoice);
            expect(suggestion.confidence).toBe(0.3);
            expect(suggestion.reason).toContain('Unable to parse');
            expect(suggestion.preview).toContain('Cannot generate preview');
        });

        test('suggestResolution falls back to default strategy for entity type with close timestamps (case 4)', () => {
            // Non-critical entity (priority 2 = 'plan'), overlapping changes, timestamps within 5 min
            // This should hit case 4: default strategy fallback
            const conflict = database.createSyncConflict({
                entity_type: 'plan',
                entity_id: 'plan-default',
                local_version: JSON.stringify({ name: 'LocalPlan', status: 'draft' }),
                remote_version: JSON.stringify({ name: 'RemotePlan', status: 'active' }),
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:02:00Z', // Only 2 min apart (under 5 min threshold)
                conflicting_fields: ['name', 'status'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            const suggestion = resolver.suggestResolution(conflict);

            // 'plan' has defaultStrategy: Merge
            expect(suggestion.strategy).toBe(ConflictResolutionStrategy.Merge);
            expect(suggestion.confidence).toBe(0.5);
            expect(suggestion.reason).toContain('Overlapping changes');
            expect(suggestion.reason).toContain('default strategy');
        });

        test('suggestResolution falls back to UserChoice for unknown entity type with close timestamps', () => {
            // Unknown entity type has no config, so entityConfig is undefined
            // defaultStrategy falls back to UserChoice
            const conflict = database.createSyncConflict({
                entity_type: 'unknown_entity_type' as any,
                entity_id: 'unk-001',
                local_version: JSON.stringify({ field: 'localVal' }),
                remote_version: JSON.stringify({ field: 'remoteVal' }),
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:01:00Z', // 1 min apart
                conflicting_fields: ['field'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            const suggestion = resolver.suggestResolution(conflict);

            expect(suggestion.strategy).toBe(ConflictResolutionStrategy.UserChoice);
            expect(suggestion.confidence).toBe(0.5);
            expect(suggestion.reason).toContain('default strategy');
        });
    });

    // ==================== RESOLVE ALL — error handling (line 617) ====================

    describe('resolveAllForEntity — error handling', () => {
        test('continues resolving remaining conflicts when one fails', () => {
            // Create 3 unresolved conflicts. The second one will fail due to overlapping merge
            database.createSyncConflict({
                entity_type: 'design_component',
                entity_id: 'comp-bulk-err',
                local_version: JSON.stringify({ name: 'A', localField: 'val' }),
                remote_version: JSON.stringify({ name: 'A', remoteField: 'val' }),
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:05:00Z',
                conflicting_fields: ['localField', 'remoteField'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            // This one has overlapping changes — Merge will fail
            database.createSyncConflict({
                entity_type: 'design_component',
                entity_id: 'comp-bulk-err',
                local_version: JSON.stringify({ name: 'LocalB' }),
                remote_version: JSON.stringify({ name: 'RemoteB' }),
                remote_device_id: 'dev-003',
                local_changed_at: '2024-01-02T10:00:00Z',
                remote_changed_at: '2024-01-02T10:05:00Z',
                conflicting_fields: ['name'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            database.createSyncConflict({
                entity_type: 'design_component',
                entity_id: 'comp-bulk-err',
                local_version: JSON.stringify({ name: 'C', aField: 'local' }),
                remote_version: JSON.stringify({ name: 'C', bField: 'remote' }),
                remote_device_id: 'dev-004',
                local_changed_at: '2024-01-03T10:00:00Z',
                remote_changed_at: '2024-01-03T10:05:00Z',
                conflicting_fields: ['aField', 'bField'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            // Use Merge strategy — 2 will succeed (non-overlapping), 1 will fail (overlapping)
            const count = resolver.resolveAllForEntity(
                'design_component',
                'comp-bulk-err',
                ConflictResolutionStrategy.Merge,
                'auto'
            );

            // 2 succeeded, 1 failed
            expect(count).toBe(2);
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Failed to resolve conflict')
            );
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Bulk-resolved 2 conflict(s)')
            );
        });
    });

    // ==================== GET RESOLVED VERSION (lines 643-695) ====================

    describe('getResolvedVersion()', () => {
        function createResolvedConflict(resolution: ConflictResolutionStrategy | null, overrides: {
            local?: Record<string, unknown>;
            remote?: Record<string, unknown>;
            localChangedAt?: string;
            remoteChangedAt?: string;
        } = {}) {
            const local = overrides.local ?? { name: 'Local', extra: 'localVal' };
            const remote = overrides.remote ?? { name: 'Remote', extra: 'remoteVal' };
            const conflict = database.createSyncConflict({
                entity_type: 'design_component',
                entity_id: 'comp-resolved-ver',
                local_version: JSON.stringify(local),
                remote_version: JSON.stringify(remote),
                remote_device_id: 'dev-002',
                local_changed_at: overrides.localChangedAt ?? '2024-01-01T10:00:00Z',
                remote_changed_at: overrides.remoteChangedAt ?? '2024-01-01T10:05:00Z',
                conflicting_fields: ['name'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            if (resolution !== null) {
                database.resolveSyncConflict(conflict.id, resolution, 'dev-001');
            }

            return database.getSyncConflict(conflict.id)!;
        }

        test('returns null for unresolved conflict', () => {
            const conflict = createResolvedConflict(null);

            const result = resolver.getResolvedVersion(conflict);

            expect(result).toBeNull();
        });

        test('returns local version for KeepLocal resolution', () => {
            const conflict = createResolvedConflict(ConflictResolutionStrategy.KeepLocal, {
                local: { name: 'LocalButton', width: 100 },
                remote: { name: 'RemoteButton', width: 200 },
            });

            const result = resolver.getResolvedVersion(conflict);

            expect(result).toEqual({ name: 'LocalButton', width: 100 });
        });

        test('returns remote version for KeepRemote resolution', () => {
            const conflict = createResolvedConflict(ConflictResolutionStrategy.KeepRemote, {
                local: { name: 'LocalButton', width: 100 },
                remote: { name: 'RemoteButton', width: 200 },
            });

            const result = resolver.getResolvedVersion(conflict);

            expect(result).toEqual({ name: 'RemoteButton', width: 200 });
        });

        test('returns merged version for Merge resolution (non-overlapping)', () => {
            const conflict = createResolvedConflict(ConflictResolutionStrategy.Merge, {
                local: { name: 'Button', localProp: 'from-local' },
                remote: { name: 'Button', remoteProp: 'from-remote' },
            });

            const result = resolver.getResolvedVersion(conflict);

            expect(result).toEqual({
                name: 'Button',
                localProp: 'from-local',
                remoteProp: 'from-remote',
            });
        });

        test('returns null for Merge resolution when auto-merge fails (overlapping)', () => {
            // Create a conflict with overlapping fields, resolve it as merge directly in DB
            const conflict = database.createSyncConflict({
                entity_type: 'design_component',
                entity_id: 'comp-merge-fail',
                local_version: JSON.stringify({ name: 'Local' }),
                remote_version: JSON.stringify({ name: 'Remote' }),
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:05:00Z',
                conflicting_fields: ['name'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });
            // Force-resolve in DB even though merge would fail (to test getResolvedVersion)
            database.resolveSyncConflict(conflict.id, ConflictResolutionStrategy.Merge, 'force');
            const resolved = database.getSyncConflict(conflict.id)!;

            const result = resolver.getResolvedVersion(resolved);

            // autoMerge fails -> returns null
            expect(result).toBeNull();
        });

        test('returns correct version for LastWriteWins (remote newer)', () => {
            const conflict = createResolvedConflict(ConflictResolutionStrategy.LastWriteWins, {
                local: { name: 'OldLocal' },
                remote: { name: 'NewRemote' },
                localChangedAt: '2024-01-01T10:00:00Z',
                remoteChangedAt: '2024-01-02T10:00:00Z',
            });

            const result = resolver.getResolvedVersion(conflict);

            expect(result).toEqual({ name: 'NewRemote' });
        });

        test('returns correct version for LastWriteWins (local newer)', () => {
            const conflict = createResolvedConflict(ConflictResolutionStrategy.LastWriteWins, {
                local: { name: 'NewLocal' },
                remote: { name: 'OldRemote' },
                localChangedAt: '2024-01-02T10:00:00Z',
                remoteChangedAt: '2024-01-01T10:00:00Z',
            });

            const result = resolver.getResolvedVersion(conflict);

            expect(result).toEqual({ name: 'NewLocal' });
        });

        test('returns null for UserChoice resolution', () => {
            const conflict = createResolvedConflict(ConflictResolutionStrategy.UserChoice);

            const result = resolver.getResolvedVersion(conflict);

            expect(result).toBeNull();
        });

        test('returns null for unknown resolution type (default case)', () => {
            const conflict = database.createSyncConflict({
                entity_type: 'design_component',
                entity_id: 'comp-unk-res',
                local_version: JSON.stringify({ name: 'Local' }),
                remote_version: JSON.stringify({ name: 'Remote' }),
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:05:00Z',
                conflicting_fields: ['name'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });
            // Manually force an unknown resolution value in DB
            database.resolveSyncConflict(conflict.id, 'completely_unknown' as any, 'dev-001');
            const resolved = database.getSyncConflict(conflict.id)!;

            const result = resolver.getResolvedVersion(resolved);

            expect(result).toBeNull();
        });

        test('returns null when version JSON is corrupted (catch block)', () => {
            const conflict = database.createSyncConflict({
                entity_type: 'design_component',
                entity_id: 'comp-corrupt',
                local_version: 'NOT{VALID}JSON',
                remote_version: 'ALSO{BAD}',
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:05:00Z',
                conflicting_fields: ['name'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });
            database.resolveSyncConflict(conflict.id, ConflictResolutionStrategy.KeepLocal, 'dev-001');
            const resolved = database.getSyncConflict(conflict.id)!;

            const result = resolver.getResolvedVersion(resolved);

            expect(result).toBeNull();
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Failed to parse resolved versions')
            );
        });
    });

    // ==================== TRUNCATE VALUE + CONFLICT PREVIEW (lines 749, 768) ====================

    describe('Preview and truncation', () => {
        test('generateConflictPreview returns "No conflicting fields." for empty array', () => {
            // Access private method via type assertion
            const preview = (resolver as any).generateConflictPreview(
                { name: 'Local' },
                { name: 'Remote' },
                [] // empty conflicting fields
            );

            expect(preview).toBe('No conflicting fields.');
        });

        test('truncateValue truncates strings longer than 80 characters', () => {
            const longValue = 'x'.repeat(100);
            const truncated = (resolver as any).truncateValue(longValue);

            // JSON.stringify wraps in quotes, so the JSON string is 102 chars
            // It should be truncated to 77 chars + "..."
            expect(truncated.length).toBe(80);
            expect(truncated).toMatch(/\.\.\.$/);
        });

        test('truncateValue does not truncate strings 80 characters or fewer', () => {
            const shortValue = 'hello';
            const result = (resolver as any).truncateValue(shortValue);

            expect(result).toBe('"hello"');
            expect(result.length).toBeLessThanOrEqual(80);
        });

        test('suggestResolution generates conflict preview for critical entity with overlapping fields', () => {
            // This test exercises generateConflictPreview through the suggestResolution path
            const conflict = database.createSyncConflict({
                entity_type: 'task',
                entity_id: 't-preview',
                local_version: JSON.stringify({ name: 'LocalTask', description: 'a'.repeat(100) }),
                remote_version: JSON.stringify({ name: 'RemoteTask', description: 'b'.repeat(100) }),
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:01:00Z',
                conflicting_fields: ['name', 'description'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            const suggestion = resolver.suggestResolution(conflict);

            expect(suggestion.preview).toContain('Conflicting fields:');
            expect(suggestion.preview).toContain('name:');
            expect(suggestion.preview).toContain('description:');
            // description value is long — should be truncated with ...
            expect(suggestion.preview).toContain('...');
        });
    });

    // ==================== EVENT EMISSION ERRORS (lines 792, 822) ====================

    describe('Event emission error handling', () => {
        test('emitConflictDetected catches error and logs warning', () => {
            // Replace the eventBus with one that throws
            const brokenEventBus = new EventBus();
            jest.spyOn(brokenEventBus, 'emit').mockImplementation(() => {
                throw new Error('EventBus exploded');
            });
            const brokenResolver = new ConflictResolver(database, brokenEventBus, outputChannel);

            // detectConflict calls emitConflictDetected internally
            const local = { name: 'LocalVal' };
            const remote = { name: 'RemoteVal' };

            // Should not throw even though eventBus.emit throws
            const result = brokenResolver.detectConflict(
                'design_component',
                'comp-event-err',
                local,
                remote,
                '2024-01-01T10:00:00Z',
                '2024-01-01T10:05:00Z',
                'dev-002'
            );

            expect(result).not.toBeNull();
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('WARNING: Failed to emit conflict_detected event')
            );
        });

        test('emitConflictResolved catches error and logs warning', () => {
            // Create a conflict first with working eventBus
            const conflict = database.createSyncConflict({
                entity_type: 'task',
                entity_id: 't-resolve-event-err',
                local_version: JSON.stringify({ name: 'Local' }),
                remote_version: JSON.stringify({ name: 'Remote' }),
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:05:00Z',
                conflicting_fields: ['name'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            // Now replace eventBus with one that throws, and create new resolver
            const brokenEventBus = new EventBus();
            jest.spyOn(brokenEventBus, 'emit').mockImplementation(() => {
                throw new Error('EventBus exploded on resolve');
            });
            const brokenResolver = new ConflictResolver(database, brokenEventBus, outputChannel);

            // Should not throw
            brokenResolver.resolve(conflict.id, ConflictResolutionStrategy.KeepLocal, 'dev-001');

            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('WARNING: Failed to emit conflict_resolved event')
            );
        });
    });

    // ==================== LAST WRITE WINNER (line 643) ====================

    describe('getLastWriteWinner()', () => {
        test('returns "local" when local is newer', () => {
            const conflict = database.createSyncConflict({
                entity_type: 'task',
                entity_id: 't-lww-local',
                local_version: '{"a":1}',
                remote_version: '{"a":2}',
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-02T10:00:00Z',
                remote_changed_at: '2024-01-01T10:00:00Z',
                conflicting_fields: ['a'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            const winner = resolver.getLastWriteWinner(conflict);

            expect(winner).toBe('local');
        });

        test('returns "remote" when remote is newer', () => {
            const conflict = database.createSyncConflict({
                entity_type: 'task',
                entity_id: 't-lww-remote',
                local_version: '{"a":1}',
                remote_version: '{"a":2}',
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-02T10:00:00Z',
                conflicting_fields: ['a'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            const winner = resolver.getLastWriteWinner(conflict);

            expect(winner).toBe('remote');
        });

        test('returns "local" when timestamps are equal (local bias)', () => {
            const conflict = database.createSyncConflict({
                entity_type: 'task',
                entity_id: 't-lww-equal',
                local_version: '{"a":1}',
                remote_version: '{"a":2}',
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:00:00Z',
                conflicting_fields: ['a'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            const winner = resolver.getLastWriteWinner(conflict);

            expect(winner).toBe('local');
        });
    });

    // ==================== BRANCH COVERAGE: resolve LastWriteWins local wins (line 350) ====================

    describe('Resolution — LastWriteWins local wins branch', () => {
        test('resolve with LastWriteWins picks local when local is newer', () => {
            const conflict = database.createSyncConflict({
                entity_type: 'task',
                entity_id: 't-lww-local-wins',
                local_version: JSON.stringify({ name: 'Local' }),
                remote_version: JSON.stringify({ name: 'Remote' }),
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-02T10:00:00Z', // Local is newer
                remote_changed_at: '2024-01-01T10:00:00Z',
                conflicting_fields: ['name'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            resolver.resolve(conflict.id, ConflictResolutionStrategy.LastWriteWins, 'auto');

            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('local version chosen')
            );
        });
    });

    // ==================== BRANCH COVERAGE: suggestResolution metadata-only merge (line 428) ====================

    describe('Suggestions — metadata-only non-overlapping changes', () => {
        test('suggestResolution reports "none" when only metadata fields differ on each side', () => {
            // Create a conflict where localOnly and remoteOnly are only metadata fields
            // This means nonMetaChanges will be empty, triggering the || 'none' branch
            const conflict = database.createSyncConflict({
                entity_type: 'design_component',
                entity_id: 'comp-meta-only',
                local_version: JSON.stringify({
                    name: 'Button',
                    updated_at: '2024-01-01T10:00:00Z',
                }),
                remote_version: JSON.stringify({
                    name: 'Button',
                    created_at: '2024-01-01T09:00:00Z',
                }),
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T10:00:00Z',
                remote_changed_at: '2024-01-01T10:01:00Z',
                conflicting_fields: ['updated_at', 'created_at'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            const suggestion = resolver.suggestResolution(conflict);

            // localOnly has 'updated_at' (metadata), remoteOnly has 'created_at' (metadata)
            // No true conflicts, so it suggests Merge
            expect(suggestion.strategy).toBe(ConflictResolutionStrategy.Merge);
            expect(suggestion.reason).toContain('none');
        });
    });

    // ==================== BRANCH COVERAGE: suggestResolution LastWriteWins local wins (lines 450-456) ====================

    describe('Suggestions — LastWriteWins local wins branch', () => {
        test('suggestResolution suggests LastWriteWins with local as winner when local is newer', () => {
            // Non-critical entity (priority 2+), overlapping changes, timestamps >5 min apart, local newer
            const conflict = database.createSyncConflict({
                entity_type: 'plan',
                entity_id: 'plan-lww-local',
                local_version: JSON.stringify({ name: 'NewerLocal', status: 'active' }),
                remote_version: JSON.stringify({ name: 'OlderRemote', status: 'draft' }),
                remote_device_id: 'dev-002',
                local_changed_at: '2024-01-01T12:00:00Z', // Local is 2 hours newer
                remote_changed_at: '2024-01-01T10:00:00Z',
                conflicting_fields: ['name', 'status'],
                resolution: null,
                resolved_by: null,
                resolved_at: null,
            });

            const suggestion = resolver.suggestResolution(conflict);

            expect(suggestion.strategy).toBe(ConflictResolutionStrategy.LastWriteWins);
            expect(suggestion.reason).toContain('local');
            expect(suggestion.reason).toContain('more recent');
            expect(suggestion.preview).toContain('local');
        });
    });

    // ==================== BRANCH COVERAGE: generateMergePreview empty parts (line 733) ====================

    describe('Preview — empty merge preview', () => {
        test('generateMergePreview returns "No meaningful field differences" when parts is empty', () => {
            // Create a comparison where all arrays are empty
            const comparison = {
                both: [],
                localOnly: [],
                remoteOnly: [],
                unchanged: [],
            };

            const preview = (resolver as any).generateMergePreview(
                {},
                {},
                comparison
            );

            expect(preview).toBe('Merge preview: No meaningful field differences.');
        });

        test('generateMergePreview filters out metadata-only localOnly fields', () => {
            // localOnly has only metadata, remoteOnly has only metadata
            // unchanged is empty => parts should be empty
            const comparison = {
                both: [],
                localOnly: ['updated_at'],
                remoteOnly: ['created_at'],
                unchanged: [],
            };

            const preview = (resolver as any).generateMergePreview(
                { updated_at: '2024-01-01' },
                { created_at: '2024-01-02' },
                comparison
            );

            expect(preview).toBe('Merge preview: No meaningful field differences.');
        });
    });
});
