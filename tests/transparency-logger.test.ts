import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../src/core/database';
import { EventBus } from '../src/core/event-bus';
import { TransparencyLogger } from '../src/core/transparency-logger';
import { EthicsAuditEntry, SyncChange } from '../src/types';

describe('TransparencyLogger', () => {
    let database: Database;
    let eventBus: EventBus;
    let logger: TransparencyLogger;
    let outputChannel: { appendLine: jest.Mock };
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-transparency-test-'));
        database = new Database(tmpDir);
        await database.initialize();
        eventBus = new EventBus();
        outputChannel = { appendLine: jest.fn() };
        logger = new TransparencyLogger(database, eventBus, outputChannel);
    });

    afterEach(() => {
        database.close();
        eventBus.removeAllListeners();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ===================== CORE LOGGING =====================

    describe('Core logging', () => {
        test('logAction creates an entry with correct fields', () => {
            const entry = logger.logAction(
                'ethics_engine',
                'ethics_decision',
                'evaluate_action',
                '{"result":"blocked"}',
                { severity: 'warning' }
            );

            expect(entry.id).toBeDefined();
            expect(entry.source).toBe('ethics_engine');
            expect(entry.category).toBe('ethics_decision');
            expect(entry.action).toBe('evaluate_action');
            expect(entry.detail).toBe('{"result":"blocked"}');
            expect(entry.severity).toBe('warning');
            expect(entry.synced).toBeFalsy();
            expect(entry.created_at).toBeDefined();
        });

        test('logAction auto-generates correlation_id when not provided', () => {
            const entry = logger.logAction(
                'system',
                'configuration',
                'update_config',
                'changed timeout'
            );

            expect(entry.correlation_id).toBeDefined();
            expect(entry.correlation_id).not.toBeNull();
            // UUID format: 8-4-4-4-12 hex digits
            expect(entry.correlation_id).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
            );
        });

        test('logAction uses custom correlation_id when provided', () => {
            const customCorrelation = 'my-custom-correlation-id';
            const entry = logger.logAction(
                'system',
                'configuration',
                'update_config',
                'changed timeout',
                { correlation_id: customCorrelation }
            );

            expect(entry.correlation_id).toBe(customCorrelation);
        });

        test('logAction uses device ID when set via setDeviceId', () => {
            logger.setDeviceId('device-abc-123');

            const entry = logger.logAction(
                'sync_service',
                'sync_operation',
                'push_changes',
                'pushed 5 entries'
            );

            expect(entry.device_id).toBe('device-abc-123');
        });

        test('logAction emits transparency:action_logged event', () => {
            const handler = jest.fn();
            eventBus.on('transparency:action_logged', handler);

            const entry = logger.logAction(
                'ethics_engine',
                'ethics_decision',
                'evaluate_action',
                '{"decision":"allowed"}'
            );

            expect(handler).toHaveBeenCalledTimes(1);
            const emittedEvent = handler.mock.calls[0][0];
            expect(emittedEvent.type).toBe('transparency:action_logged');
            expect(emittedEvent.source).toBe('transparency_logger');
            expect(emittedEvent.data.action_log_id).toBe(entry.id);
            expect(emittedEvent.data.category).toBe('ethics_decision');
            expect(emittedEvent.data.source).toBe('ethics_engine');
            expect(emittedEvent.data.severity).toBe('info');
            expect(emittedEvent.data.action).toBe('evaluate_action');
        });
    });

    // ===================== SPECIALIZED LOGGING =====================

    describe('Specialized logging', () => {
        test('logEthicsDecision creates entry with ethics details', () => {
            const auditEntry: EthicsAuditEntry = {
                id: 'audit-001',
                module_id: 'mod-privacy',
                rule_id: 'rule-block-data',
                action_description: 'Attempted to collect user data',
                decision: 'blocked',
                requestor: 'coding_agent',
                context_snapshot: '{"target":"user_data"}',
                override_by: null,
                override_reason: null,
                created_at: new Date().toISOString(),
            };

            const entry = logger.logEthicsDecision(auditEntry);

            expect(entry.source).toBe('ethics_engine');
            expect(entry.category).toBe('ethics_decision');
            expect(entry.action).toBe('Ethics blocked: Attempted to collect user data');
            expect(entry.entity_type).toBe('ethics_audit');
            expect(entry.entity_id).toBe('audit-001');

            const detail = JSON.parse(entry.detail);
            expect(detail.audit_entry_id).toBe('audit-001');
            expect(detail.module_id).toBe('mod-privacy');
            expect(detail.rule_id).toBe('rule-block-data');
            expect(detail.decision).toBe('blocked');
            expect(detail.requestor).toBe('coding_agent');
        });

        test('logSyncChange creates entry with sync details', () => {
            const syncChange: SyncChange = {
                id: 'sync-001',
                entity_type: 'task',
                entity_id: 'task-abc',
                change_type: 'update',
                device_id: 'dev-laptop',
                before_hash: 'hash-before',
                after_hash: 'hash-after',
                patch: '[{"op":"replace","path":"/status","value":"done"}]',
                sequence_number: 42,
                synced: false,
                created_at: new Date().toISOString(),
            };

            const entry = logger.logSyncChange(syncChange);

            expect(entry.source).toBe('sync_service');
            expect(entry.category).toBe('sync_operation');
            expect(entry.action).toBe('Sync update: task task-abc');
            expect(entry.severity).toBe('info');
            expect(entry.entity_type).toBe('task');
            expect(entry.entity_id).toBe('task-abc');
            expect(entry.device_id).toBe('dev-laptop');

            const detail = JSON.parse(entry.detail);
            expect(detail.sync_change_id).toBe('sync-001');
            expect(detail.change_type).toBe('update');
            expect(detail.before_hash).toBe('hash-before');
            expect(detail.after_hash).toBe('hash-after');
            expect(detail.sequence_number).toBe(42);
        });

        test('logEthicsDecision maps decision to correct severity', () => {
            const makeAuditEntry = (decision: EthicsAuditEntry['decision']): EthicsAuditEntry => ({
                id: `audit-${decision}`,
                module_id: 'mod-001',
                rule_id: null,
                action_description: `Action ${decision}`,
                decision,
                requestor: 'agent',
                context_snapshot: '{}',
                override_by: decision === 'overridden' ? 'admin' : null,
                override_reason: decision === 'overridden' ? 'justified' : null,
                created_at: new Date().toISOString(),
            });

            const allowed = logger.logEthicsDecision(makeAuditEntry('allowed'));
            expect(allowed.severity).toBe('info');

            const warned = logger.logEthicsDecision(makeAuditEntry('warned'));
            expect(warned.severity).toBe('warning');

            const blocked = logger.logEthicsDecision(makeAuditEntry('blocked'));
            expect(blocked.severity).toBe('error');

            const overridden = logger.logEthicsDecision(makeAuditEntry('overridden'));
            expect(overridden.severity).toBe('warning');
        });
    });

    // ===================== QUERYING =====================

    describe('Querying', () => {
        test('getLog returns entries with default limit', () => {
            // Create 3 entries
            for (let i = 0; i < 3; i++) {
                database.createActionLog({
                    source: 'system',
                    category: 'configuration',
                    action: `action-${i}`,
                    detail: '',
                    severity: 'info',
                    entity_type: null,
                    entity_id: null,
                    device_id: null,
                    correlation_id: null,
                    synced: false,
                });
            }

            const entries = logger.getLog();
            expect(entries.length).toBe(3);
        });

        test('getLog filters by source', () => {
            database.createActionLog({
                source: 'ethics_engine',
                category: 'ethics_decision',
                action: 'ethics action',
                detail: '',
                severity: 'info',
                entity_type: null,
                entity_id: null,
                device_id: null,
                correlation_id: null,
                synced: false,
            });
            database.createActionLog({
                source: 'sync_service',
                category: 'sync_operation',
                action: 'sync action',
                detail: '',
                severity: 'info',
                entity_type: null,
                entity_id: null,
                device_id: null,
                correlation_id: null,
                synced: false,
            });
            database.createActionLog({
                source: 'ethics_engine',
                category: 'ethics_decision',
                action: 'another ethics action',
                detail: '',
                severity: 'warning',
                entity_type: null,
                entity_id: null,
                device_id: null,
                correlation_id: null,
                synced: false,
            });

            const ethicsOnly = logger.getLog({ source: 'ethics_engine' });
            expect(ethicsOnly.length).toBe(2);
            expect(ethicsOnly.every(e => e.source === 'ethics_engine')).toBe(true);
        });

        test('getLog filters by severity (in-memory filter)', () => {
            database.createActionLog({
                source: 'system',
                category: 'configuration',
                action: 'info action',
                detail: '',
                severity: 'info',
                entity_type: null,
                entity_id: null,
                device_id: null,
                correlation_id: null,
                synced: false,
            });
            database.createActionLog({
                source: 'system',
                category: 'error',
                action: 'warning action',
                detail: '',
                severity: 'warning',
                entity_type: null,
                entity_id: null,
                device_id: null,
                correlation_id: null,
                synced: false,
            });
            database.createActionLog({
                source: 'system',
                category: 'error',
                action: 'error action',
                detail: '',
                severity: 'error',
                entity_type: null,
                entity_id: null,
                device_id: null,
                correlation_id: null,
                synced: false,
            });

            const warnings = logger.getLog({ severity: 'warning' });
            expect(warnings.length).toBe(1);
            expect(warnings[0].action).toBe('warning action');
        });

        test('getByCorrelation returns related entries', () => {
            const correlationId = 'corr-group-abc';

            database.createActionLog({
                source: 'ethics_engine',
                category: 'ethics_decision',
                action: 'first action',
                detail: '',
                severity: 'info',
                entity_type: null,
                entity_id: null,
                device_id: null,
                correlation_id: correlationId,
                synced: false,
            });
            database.createActionLog({
                source: 'sync_service',
                category: 'sync_operation',
                action: 'second action',
                detail: '',
                severity: 'info',
                entity_type: null,
                entity_id: null,
                device_id: null,
                correlation_id: correlationId,
                synced: false,
            });
            database.createActionLog({
                source: 'system',
                category: 'configuration',
                action: 'unrelated',
                detail: '',
                severity: 'info',
                entity_type: null,
                entity_id: null,
                device_id: null,
                correlation_id: 'corr-other',
                synced: false,
            });

            const correlated = logger.getByCorrelation(correlationId);
            expect(correlated.length).toBe(2);
            expect(correlated.every(e => e.correlation_id === correlationId)).toBe(true);
        });
    });

    // ===================== EXPORT =====================

    describe('Export', () => {
        test('exportJSON returns valid JSON string', () => {
            logger.logAction('system', 'configuration', 'test action 1', 'detail 1');
            logger.logAction('ethics_engine', 'ethics_decision', 'test action 2', 'detail 2');

            const jsonStr = logger.exportJSON();
            const parsed = JSON.parse(jsonStr);

            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed.length).toBe(2);
            expect(parsed[0]).toHaveProperty('id');
            expect(parsed[0]).toHaveProperty('source');
            expect(parsed[0]).toHaveProperty('category');
            expect(parsed[0]).toHaveProperty('action');
            expect(parsed[0]).toHaveProperty('detail');
            expect(parsed[0]).toHaveProperty('severity');
            expect(parsed[0]).toHaveProperty('created_at');
        });

        test('exportCSV returns header + data rows', () => {
            logger.logAction('system', 'configuration', 'config change', 'detail here');
            logger.logAction('ethics_engine', 'ethics_decision', 'ethics check', 'ethics detail');

            const csv = logger.exportCSV();
            const lines = csv.split('\n');

            // First line is the header
            expect(lines[0]).toBe(
                'id,source,category,action,detail,severity,entity_type,entity_id,device_id,correlation_id,synced,created_at'
            );
            // Two data rows
            expect(lines.length).toBe(3);
            // Verify a data row contains the source value
            const allRowContent = lines.slice(1).join('\n');
            expect(allRowContent).toContain('system');
            expect(allRowContent).toContain('ethics_engine');
        });

        test('exportCSV properly escapes values with commas', () => {
            logger.logAction(
                'system',
                'configuration',
                'action with, comma',
                'detail with "quotes" and, commas'
            );

            const csv = logger.exportCSV();
            const lines = csv.split('\n');
            const dataRow = lines[1];

            // Values with commas should be wrapped in double quotes
            expect(dataRow).toContain('"action with, comma"');
            // Values with quotes should have double-escaped quotes
            expect(dataRow).toContain('"detail with ""quotes"" and, commas"');
        });
    });

    // ===================== STATISTICS =====================

    describe('Statistics', () => {
        test('getStats returns correct aggregate counts', () => {
            logger.logAction('ethics_engine', 'ethics_decision', 'a1', 'd1', { severity: 'info' });
            logger.logAction('ethics_engine', 'ethics_decision', 'a2', 'd2', { severity: 'warning' });
            logger.logAction('sync_service', 'sync_operation', 'a3', 'd3', { severity: 'info' });
            logger.logAction('system', 'error', 'a4', 'd4', { severity: 'error' });

            const stats = logger.getStats();

            expect(stats.total).toBe(4);

            // By category
            expect(stats.byCategory['ethics_decision']).toBe(2);
            expect(stats.byCategory['sync_operation']).toBe(1);
            expect(stats.byCategory['error']).toBe(1);

            // By severity
            expect(stats.bySeverity['info']).toBe(2);
            expect(stats.bySeverity['warning']).toBe(1);
            expect(stats.bySeverity['error']).toBe(1);

            // By source
            expect(stats.bySource['ethics_engine']).toBe(2);
            expect(stats.bySource['sync_service']).toBe(1);
            expect(stats.bySource['system']).toBe(1);

            // Time range
            expect(stats.earliest).toBeDefined();
            expect(stats.latest).toBeDefined();
            expect(stats.earliest).not.toBeNull();
            expect(stats.latest).not.toBeNull();
        });

        test('getStats filters by since timestamp', () => {
            // Create entries with known timestamps via database directly
            // First, create two early entries
            logger.logAction('system', 'configuration', 'old action 1', 'detail');
            logger.logAction('system', 'configuration', 'old action 2', 'detail');

            // Get all entries to find timestamps
            const allEntries = database.getActionLog(100);
            // All entries have the same timestamp (datetime('now')), so use a future filter
            const futureTimestamp = '2099-01-01T00:00:00Z';

            const statsFiltered = logger.getStats(futureTimestamp);
            expect(statsFiltered.total).toBe(0);
            expect(statsFiltered.earliest).toBeNull();
            expect(statsFiltered.latest).toBeNull();

            // Use a past timestamp to include all entries
            const pastTimestamp = '2000-01-01T00:00:00Z';
            const statsAll = logger.getStats(pastTimestamp);
            expect(statsAll.total).toBe(2);
        });
    });

    // ===================== DEVICE MANAGEMENT =====================

    describe('Device management', () => {
        test('setDeviceId stores and getDeviceId returns it', () => {
            expect(logger.getDeviceId()).toBeNull();

            logger.setDeviceId('my-device-001');
            expect(logger.getDeviceId()).toBe('my-device-001');

            // Verify the output channel was notified
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                '[TransparencyLog] Device ID set: my-device-001'
            );
        });

        test('log entries get device_id stamped after setDeviceId', () => {
            // Before setting device ID
            const entryBefore = logger.logAction(
                'system',
                'configuration',
                'action before',
                'detail'
            );
            expect(entryBefore.device_id).toBeNull();

            // After setting device ID
            logger.setDeviceId('device-xyz');

            const entryAfter = logger.logAction(
                'system',
                'configuration',
                'action after',
                'detail'
            );
            expect(entryAfter.device_id).toBe('device-xyz');
        });
    });

    // ===================== IMPORT =====================

    describe('Import', () => {
        test('importLog imports valid entries', () => {
            const importData = JSON.stringify([
                {
                    id: 'imported-001',
                    source: 'ethics_engine',
                    category: 'ethics_decision',
                    action: 'imported action 1',
                    detail: 'imported detail',
                    severity: 'info',
                    entity_type: null,
                    entity_id: null,
                    device_id: 'remote-device',
                    correlation_id: 'import-corr-1',
                    synced: true,
                    created_at: '2026-01-01T00:00:00Z',
                },
                {
                    id: 'imported-002',
                    source: 'sync_service',
                    category: 'sync_operation',
                    action: 'imported action 2',
                    detail: 'sync detail',
                    severity: 'warning',
                    entity_type: 'task',
                    entity_id: 'task-remote',
                    device_id: 'remote-device',
                    correlation_id: 'import-corr-2',
                    synced: true,
                    created_at: '2026-01-02T00:00:00Z',
                },
            ]);

            const result = logger.importLog(importData);

            expect(result.imported).toBe(2);
            expect(result.skipped).toBe(0);

            // Verify entries are actually in the database
            const allEntries = database.getActionLog(100);
            expect(allEntries.length).toBe(2);
        });

        test('importLog skips duplicate entries', () => {
            // First import
            const importData = JSON.stringify([
                {
                    id: 'dup-001',
                    source: 'system',
                    category: 'configuration',
                    action: 'original action',
                    detail: 'original detail',
                    severity: 'info',
                    entity_type: null,
                    entity_id: null,
                    device_id: null,
                    correlation_id: 'dup-corr',
                    synced: true,
                    created_at: '2026-01-01T00:00:00Z',
                },
            ]);

            const firstResult = logger.importLog(importData);
            expect(firstResult.imported).toBe(1);
            expect(firstResult.skipped).toBe(0);

            // Second import with same data — should be skipped as duplicate
            // The imported entry will have a new DB-generated ID, but same correlation_id
            // We need to export the actual DB entry and re-import it
            const existingEntries = database.getActionLogByCorrelation('dup-corr');
            expect(existingEntries.length).toBe(1);

            const reimportData = JSON.stringify([
                {
                    id: existingEntries[0].id, // Use the actual DB-assigned ID
                    source: 'system',
                    category: 'configuration',
                    action: 'original action',
                    detail: 'original detail',
                    severity: 'info',
                    entity_type: null,
                    entity_id: null,
                    device_id: null,
                    correlation_id: 'dup-corr',
                    synced: true,
                    created_at: '2026-01-01T00:00:00Z',
                },
            ]);

            const secondResult = logger.importLog(reimportData);
            expect(secondResult.imported).toBe(0);
            expect(secondResult.skipped).toBe(1);

            // Total entries should still be 1
            const totalEntries = database.getActionLog(100);
            expect(totalEntries.length).toBe(1);
        });

        test('importLog rejects invalid JSON', () => {
            expect(() => {
                logger.importLog('this is not valid json');
            }).toThrow('Invalid import data');

            // Also reject non-array JSON
            expect(() => {
                logger.importLog('{"not":"an array"}');
            }).toThrow('Invalid import data');

            // Verify error was logged to output channel
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('[TransparencyLog] ERROR: Failed to parse import data')
            );
        });
    });

    // ===================== SYNC HELPERS =====================

    describe('Sync helpers', () => {
        test('getUnsyncedEntries returns only unsynced', () => {
            // Create synced entry
            database.createActionLog({
                source: 'system',
                category: 'configuration',
                action: 'synced action',
                detail: '',
                severity: 'info',
                entity_type: null,
                entity_id: null,
                device_id: null,
                correlation_id: null,
                synced: true,
            });

            // Create unsynced entries
            database.createActionLog({
                source: 'ethics_engine',
                category: 'ethics_decision',
                action: 'unsynced action 1',
                detail: '',
                severity: 'info',
                entity_type: null,
                entity_id: null,
                device_id: null,
                correlation_id: null,
                synced: false,
            });
            database.createActionLog({
                source: 'sync_service',
                category: 'sync_operation',
                action: 'unsynced action 2',
                detail: '',
                severity: 'warning',
                entity_type: null,
                entity_id: null,
                device_id: null,
                correlation_id: null,
                synced: false,
            });

            const unsynced = logger.getUnsyncedEntries();
            expect(unsynced.length).toBe(2);
            expect(unsynced.every(e => !e.synced)).toBe(true);
        });

        test('markSynced marks entries as synced', () => {
            const e1 = database.createActionLog({
                source: 'system',
                category: 'configuration',
                action: 'action 1',
                detail: '',
                severity: 'info',
                entity_type: null,
                entity_id: null,
                device_id: null,
                correlation_id: null,
                synced: false,
            });
            const e2 = database.createActionLog({
                source: 'system',
                category: 'configuration',
                action: 'action 2',
                detail: '',
                severity: 'info',
                entity_type: null,
                entity_id: null,
                device_id: null,
                correlation_id: null,
                synced: false,
            });
            const e3 = database.createActionLog({
                source: 'system',
                category: 'configuration',
                action: 'action 3',
                detail: '',
                severity: 'info',
                entity_type: null,
                entity_id: null,
                device_id: null,
                correlation_id: null,
                synced: false,
            });

            // Mark first two as synced
            logger.markSynced([e1.id, e2.id]);

            const unsynced = logger.getUnsyncedEntries();
            expect(unsynced.length).toBe(1);
            expect(unsynced[0].id).toBe(e3.id);

            // Verify output channel was notified
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                '[TransparencyLog] Marked 2 entries as synced'
            );
        });
    });

    // ===================== LOG() ADAPTER =====================

    describe('log() adapter', () => {
        test('log() convenience method delegates to logAction correctly', () => {
            const entry = logger.log({
                source: 'coding_agent',
                category: 'code_generation',
                action: 'generate component',
                detail: '{"component":"Button"}',
                severity: 'info',
                entityType: 'design_component',
                entityId: 'comp-btn-001',
                correlationId: 'custom-corr-id',
            });

            expect(entry.id).toBeDefined();
            expect(entry.source).toBe('coding_agent');
            expect(entry.category).toBe('code_generation');
            expect(entry.action).toBe('generate component');
            expect(entry.detail).toBe('{"component":"Button"}');
            expect(entry.severity).toBe('info');
            expect(entry.entity_type).toBe('design_component');
            expect(entry.entity_id).toBe('comp-btn-001');
            expect(entry.correlation_id).toBe('custom-corr-id');

            // Verify it actually went into the database
            const fromDb = database.getActionLogByCorrelation('custom-corr-id');
            expect(fromDb.length).toBe(1);
            expect(fromDb[0].id).toBe(entry.id);
        });
    });

    // ===================== COVERAGE GAP TESTS =====================

    describe('logAction error handling (lines 184-189)', () => {
        test('logAction re-throws when database.createActionLog throws', () => {
            // Spy on the database method and make it throw
            jest.spyOn(database, 'createActionLog').mockImplementation(() => {
                throw new Error('DB write failed');
            });

            expect(() => {
                logger.logAction('system', 'configuration', 'test_action', 'detail');
            }).toThrow('DB write failed');

            // Verify the error was logged to the output channel
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('ERROR: Failed to log action "test_action"')
            );

            // Restore
            (database.createActionLog as jest.Mock).mockRestore();
        });
    });

    describe('getLog with entity filter (lines 281-282)', () => {
        test('getLog filters by entityType and entityId', () => {
            logger.logAction('system', 'design_change', 'updated', 'update 1', {
                entity_type: 'task',
                entity_id: 'task-001',
            });
            logger.logAction('system', 'design_change', 'deleted', 'delete 1', {
                entity_type: 'task',
                entity_id: 'task-002',
            });
            logger.logAction('system', 'design_change', 'created', 'create 1', {
                entity_type: 'component',
                entity_id: 'comp-001',
            });

            const result = logger.getLog({
                entityType: 'task',
                entityId: 'task-001',
            });

            expect(result.length).toBe(1);
            expect(result[0].action).toBe('updated');
            expect(result[0].entity_type).toBe('task');
            expect(result[0].entity_id).toBe('task-001');
        });
    });

    describe('getByEntity (line 319)', () => {
        test('getByEntity returns entries for a specific entity', () => {
            logger.logAction('system', 'design_change', 'action1', 'detail', {
                entity_type: 'design_component',
                entity_id: 'dc-001',
            });
            logger.logAction('system', 'design_change', 'action2', 'detail', {
                entity_type: 'design_component',
                entity_id: 'dc-001',
            });
            logger.logAction('system', 'design_change', 'action3', 'detail', {
                entity_type: 'design_component',
                entity_id: 'dc-002',
            });

            const result = logger.getByEntity('design_component', 'dc-001');
            expect(result.length).toBe(2);
            result.forEach(entry => {
                expect(entry.entity_type).toBe('design_component');
                expect(entry.entity_id).toBe('dc-001');
            });
        });
    });

    describe('importLog edge cases (lines 498-548)', () => {
        test('importLog skips entries with missing required fields', () => {
            // Create a valid entry first for reference
            logger.logAction('system', 'configuration', 'existing_action', 'detail');

            const importData = JSON.stringify([
                { id: 'imp-1', source: 'system', category: 'configuration', action: '' }, // empty action
                { id: '', source: 'system', category: 'configuration', action: 'valid' }, // empty id
                { id: 'imp-3', source: '', category: 'configuration', action: 'valid' },  // empty source
                { id: 'imp-4', source: 'system', category: '', action: 'valid' }, // empty category
            ]);

            const result = logger.importLog(importData);
            expect(result.skipped).toBe(4);
            expect(result.imported).toBe(0);
        });

        test('importLog detects duplicates by entity', () => {
            // Create an entry with entity info
            const existing = logger.logAction('system', 'design_change', 'original', 'detail', {
                entity_type: 'task',
                entity_id: 'task-dup',
            });

            // Import data that has the same ID as the existing entry
            const importData = JSON.stringify([
                {
                    id: existing.id,
                    source: 'system',
                    category: 'design_change',
                    action: 'duplicate',
                    entity_type: 'task',
                    entity_id: 'task-dup',
                },
            ]);

            const result = logger.importLog(importData);
            expect(result.skipped).toBe(1);
            expect(result.imported).toBe(0);
        });

        test('importLog catches errors for individual entries', () => {
            // Spy on createActionLog to throw on specific calls
            const origCreate = database.createActionLog.bind(database);
            let callCount = 0;
            jest.spyOn(database, 'createActionLog').mockImplementation((data) => {
                callCount++;
                if (callCount === 2) {
                    throw new Error('Individual entry failed');
                }
                return origCreate(data);
            });

            const importData = JSON.stringify([
                { id: 'imp-ok-1', source: 'system', category: 'configuration', action: 'first' },
                { id: 'imp-fail', source: 'system', category: 'configuration', action: 'second' },
                { id: 'imp-ok-2', source: 'system', category: 'configuration', action: 'third' },
            ]);

            const result = logger.importLog(importData);
            expect(result.imported).toBe(2);
            expect(result.skipped).toBe(1);

            // Verify error was logged
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('ERROR: Failed to import entry imp-fail')
            );

            (database.createActionLog as jest.Mock).mockRestore();
        });
    });

    describe('markSynced with empty array (line 583)', () => {
        test('markSynced returns early for empty array', () => {
            // Should not throw and should not log anything
            outputChannel.appendLine.mockClear();
            logger.markSynced([]);
            // Should NOT have logged the "Marked N entries" message
            const markCalls = outputChannel.appendLine.mock.calls.filter(
                (call: string[]) => call[0].includes('Marked')
            );
            expect(markCalls.length).toBe(0);
        });
    });

    describe('emitActionLogged error handling (line 615)', () => {
        test('event emission failure is caught and logged', () => {
            // Make eventBus.emit throw
            jest.spyOn(eventBus, 'emit').mockImplementation(() => {
                throw new Error('EventBus crashed');
            });

            // logAction should still succeed despite event emission failure
            const entry = logger.logAction('system', 'configuration', 'resilient_action', 'detail');
            expect(entry.id).toBeDefined();

            // Verify the warning was logged
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('WARNING: Failed to emit event')
            );

            (eventBus.emit as jest.Mock).mockRestore();
        });
    });

    describe('ethicsDecisionToSeverity default case (line 637)', () => {
        test('unknown decision maps to info severity', () => {
            // Use logEthicsDecision with an unknown decision string
            // This internally calls ethicsDecisionToSeverity
            const mockAuditEntry: EthicsAuditEntry = {
                id: 'audit-unknown',
                module_id: 'mod-test',
                rule_id: null,
                action_description: 'test action',
                decision: 'some_unknown_decision' as any,
                requestor: 'test',
                context_snapshot: '{}',
                override_by: null,
                override_reason: null,
                created_at: new Date().toISOString(),
            };

            // logEthicsDecision should not throw
            logger.logEthicsDecision(mockAuditEntry);

            // Verify the entry was created with 'info' severity (default)
            const logs = logger.getLog({ source: 'ethics_engine', limit: 10 });
            expect(logs.length).toBe(1);
            expect(logs[0].severity).toBe('info');
        });
    });

    describe('applyInMemoryFilters since filter (line 657)', () => {
        test('getLog filters by since timestamp', () => {
            logger.logAction('system', 'configuration', 'old_action', 'old detail');
            logger.logAction('system', 'configuration', 'new_action', 'new detail');

            const allLogs = logger.getLog({ source: 'system' });
            expect(allLogs.length).toBe(2);

            // Get the created_at from the actual entries to base our since filter
            // SQLite uses "YYYY-MM-DD HH:MM:SS" format via datetime('now')
            const timestamps = allLogs.map(e => e.created_at).sort();
            const earliest = timestamps[0];

            // Filter with a since timestamp after all entries — should return nothing
            // Use a date string that sorts after any possible SQLite datetime
            const filtered = logger.getLog({ source: 'system', since: '9999-12-31 23:59:59' });
            expect(filtered.length).toBe(0);

            // Filter with a since timestamp before all entries — should return all
            const allFiltered = logger.getLog({ source: 'system', since: '2000-01-01 00:00:00' });
            expect(allFiltered.length).toBe(2);
        });
    });

    describe('getFilteredForExport since/until filters (lines 677, 681)', () => {
        test('exportJSON respects since and until filters', () => {
            logger.logAction('system', 'configuration', 'action1', 'detail1');
            logger.logAction('system', 'configuration', 'action2', 'detail2');

            // Export with since far in the future — should get empty array
            const emptyExport = logger.exportJSON({ since: '9999-12-31 23:59:59' });
            const emptyParsed = JSON.parse(emptyExport);
            expect(emptyParsed.length).toBe(0);

            // Export with until far in the past — should get empty array
            const pastExport = logger.exportJSON({ until: '1970-01-01 00:00:00' });
            const pastParsed = JSON.parse(pastExport);
            expect(pastParsed.length).toBe(0);

            // Export with broad range — should get all entries
            const fullExport = logger.exportJSON({ since: '2000-01-01 00:00:00', until: '9999-12-31 23:59:59' });
            const fullParsed = JSON.parse(fullExport);
            expect(fullParsed.length).toBe(2);
        });
    });
});
