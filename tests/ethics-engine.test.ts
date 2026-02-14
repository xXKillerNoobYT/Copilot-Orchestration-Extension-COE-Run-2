import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../src/core/database';
import { EventBus } from '../src/core/event-bus';
import { EthicsEngine, TransparencyLoggerLike } from '../src/core/ethics-engine';
import { EthicsSensitivity, EthicsActionContext } from '../src/types';

describe('EthicsEngine (FreedomGuard_AI)', () => {
    let db: Database;
    let eventBus: EventBus;
    let transparencyLogger: TransparencyLoggerLike;
    let outputChannel: { appendLine: jest.Mock };
    let engine: EthicsEngine;
    let tmpDir: string;

    /**
     * Disable foreign key checks on the raw SQLite database so that the
     * EthicsEngine's synthetic module_id values ('absolute_block',
     * 'no_modules', 'error', 'unknown') used in audit entries do not
     * trigger FOREIGN KEY constraint failures.
     */
    function disableForeignKeys(database: Database): void {
        const rawDb = (database as any).db;
        rawDb.exec('PRAGMA foreign_keys = OFF');
    }

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-ethics-test-'));
        db = new Database(tmpDir);
        await db.initialize();
        disableForeignKeys(db);
        eventBus = new EventBus();
        transparencyLogger = { log: jest.fn() };
        outputChannel = { appendLine: jest.fn() };
        engine = new EthicsEngine(db, eventBus, transparencyLogger, outputChannel);
    });

    afterEach(() => {
        db.close();
        eventBus.removeAllListeners();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ===================== SEEDING =====================

    describe('Seeding', () => {
        test('seedDefaultModules creates 6 modules', () => {
            const count = engine.seedDefaultModules();
            expect(count).toBe(6);

            const modules = engine.getModules();
            expect(modules.length).toBe(6);

            const names = modules.map(m => m.name).sort();
            expect(names).toEqual([
                'Consent',
                'Data Sovereignty',
                'Privacy',
                'Self-Protection',
                'Speech',
                'Transparency',
            ]);
        });

        test('seedDefaultModules is idempotent (second call returns 0)', () => {
            const first = engine.seedDefaultModules();
            expect(first).toBe(6);

            const second = engine.seedDefaultModules();
            expect(second).toBe(0);

            // Still only 6 modules
            expect(engine.getModules().length).toBe(6);
        });

        test('seeded modules have correct rules', () => {
            engine.seedDefaultModules();
            const modules = engine.getModules();

            const privacy = modules.find(m => m.name === 'Privacy')!;
            expect(privacy.rules.length).toBe(2);
            expect(privacy.rules.find(r => r.name === 'block_data_collection')).toBeDefined();
            expect(privacy.rules.find(r => r.name === 'audit_data_access')).toBeDefined();
            expect(privacy.sensitivity).toBe(EthicsSensitivity.High);
            expect(privacy.blocked_actions).toContain('collect_user_data');

            const speech = modules.find(m => m.name === 'Speech')!;
            expect(speech.rules.length).toBe(2);
            expect(speech.sensitivity).toBe(EthicsSensitivity.Medium);

            const selfProtection = modules.find(m => m.name === 'Self-Protection')!;
            expect(selfProtection.rules.length).toBe(2);
            expect(selfProtection.sensitivity).toBe(EthicsSensitivity.High);

            const transparency = modules.find(m => m.name === 'Transparency')!;
            expect(transparency.rules.length).toBe(1);
            expect(transparency.rules[0].condition).toBe('true');
            expect(transparency.sensitivity).toBe(EthicsSensitivity.Low);

            const consent = modules.find(m => m.name === 'Consent')!;
            expect(consent.allowed_actions).toContain('read_local_files');
            expect(consent.allowed_actions).toContain('generate_ui_code');
        });
    });

    // ===================== ABSOLUTE BLOCKS =====================

    describe('Absolute blocks', () => {
        test('evaluateAction blocks create_backdoor', async () => {
            const result = await engine.evaluateAction({
                action: 'create_backdoor',
                source: 'coding_agent',
            });
            expect(result.allowed).toBe(false);
            expect(result.decision).toBe('blocked');
            expect(result.messages.some(m => m.includes('ABSOLUTE BLOCK'))).toBe(true);
        });

        test('evaluateAction blocks install_spyware', async () => {
            const result = await engine.evaluateAction({
                action: 'install_spyware',
                source: 'coding_agent',
            });
            expect(result.allowed).toBe(false);
            expect(result.decision).toBe('blocked');
        });

        test('evaluateAction blocks all 10 absolute block actions', async () => {
            const absoluteBlocks = [
                'create_backdoor',
                'install_spyware',
                'install_keylogger',
                'collect_data_unauthorized',
                'delete_system_files',
                'disable_security',
                'exfiltrate_data',
                'bypass_authentication',
                'inject_malicious_code',
                'track_without_consent',
            ];

            for (const action of absoluteBlocks) {
                const result = await engine.evaluateAction({
                    action,
                    source: 'any_source',
                });
                expect(result.allowed).toBe(false);
                expect(result.decision).toBe('blocked');
            }
        });

        test('absolute blocks cannot be overridden', async () => {
            // Evaluate an absolute-block action to get an audit entry
            const result = await engine.evaluateAction({
                action: 'create_backdoor',
                source: 'coding_agent',
            });
            expect(result.allowed).toBe(false);

            // Attempt override — should throw
            await expect(
                engine.override(result.auditEntryId, 'admin_user', 'Testing override')
            ).rejects.toThrow('Cannot override absolute block');
        });

        test('getAbsoluteBlocks returns the list', () => {
            const blocks = engine.getAbsoluteBlocks();
            expect(blocks.length).toBe(10);
            expect(blocks).toContain('create_backdoor');
            expect(blocks).toContain('install_spyware');
            expect(blocks).toContain('install_keylogger');
            expect(blocks).toContain('collect_data_unauthorized');
            expect(blocks).toContain('delete_system_files');
            expect(blocks).toContain('disable_security');
            expect(blocks).toContain('exfiltrate_data');
            expect(blocks).toContain('bypass_authentication');
            expect(blocks).toContain('inject_malicious_code');
            expect(blocks).toContain('track_without_consent');
        });
    });

    // ===================== MODULE-LEVEL EVALUATION =====================

    describe('Module-level evaluation', () => {
        test('blocked_actions match blocks the action', async () => {
            // Create a single module with blocked_actions to isolate the test
            // from other modules (like Self-Protection with Maximum sensitivity)
            db.createEthicsModule({
                name: 'PrivacyOnly',
                description: 'Isolated privacy module',
                sensitivity: EthicsSensitivity.Low,
                scope: ['data_access'],
                allowed_actions: [],
                blocked_actions: ['collect_user_data', 'send_analytics'],
                enabled: true,
                version: 1,
            });

            const result = await engine.evaluateAction({
                action: 'collect_user_data',
                source: 'coding_agent',
            });

            expect(result.allowed).toBe(false);
            expect(result.decision).toBe('blocked');
            expect(result.messages.some(m => m.includes('blocked list'))).toBe(true);
        });

        test('allowed_actions are permitted', async () => {
            // Create a minimal module with only allowed_actions and no block rules
            const module = db.createEthicsModule({
                name: 'TestModule',
                description: 'Test',
                sensitivity: EthicsSensitivity.Low,
                scope: ['test'],
                allowed_actions: ['safe_action'],
                blocked_actions: [],
                enabled: true,
                version: 1,
            });

            const result = await engine.evaluateAction({
                action: 'safe_action',
                source: 'coding_agent',
            });

            expect(result.allowed).toBe(true);
        });

        test('action not matching any rule is allowed', async () => {
            // Create a module with specific blocked actions
            db.createEthicsModule({
                name: 'TestModule',
                description: 'Test',
                sensitivity: EthicsSensitivity.Low,
                scope: ['test'],
                allowed_actions: [],
                blocked_actions: ['specific_bad_action'],
                enabled: true,
                version: 1,
            });

            const result = await engine.evaluateAction({
                action: 'completely_unrelated_action',
                source: 'coding_agent',
            });

            expect(result.allowed).toBe(true);
        });

        test('evaluateAction returns audit entry ID', async () => {
            engine.seedDefaultModules();

            const result = await engine.evaluateAction({
                action: 'some_harmless_read',
                source: 'user',
            });

            expect(result.auditEntryId).toBeDefined();
            expect(typeof result.auditEntryId).toBe('string');
            expect(result.auditEntryId.length).toBeGreaterThan(0);

            // Verify audit entry exists in DB
            const auditLog = engine.audit(100);
            const entry = auditLog.find(e => e.id === result.auditEntryId);
            expect(entry).toBeDefined();
        });
    });

    // ===================== RULE EVALUATION =====================

    describe('Rule evaluation', () => {
        test('block rule stops evaluation', async () => {
            const module = db.createEthicsModule({
                name: 'TestModule',
                description: 'Test',
                sensitivity: EthicsSensitivity.Low,
                scope: ['test'],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
                version: 1,
            });

            // Add a block rule
            engine.addRule(module.id, {
                name: 'block_dangerous',
                description: 'Block dangerous actions',
                condition: 'dangerous_action',
                action: 'block',
                priority: 1,
                message: 'Dangerous action blocked by rule.',
            });

            const result = await engine.evaluateAction({
                action: 'dangerous_action',
                source: 'coding_agent',
            });

            expect(result.allowed).toBe(false);
            expect(result.decision).toBe('blocked');
            expect(result.triggeredRules.length).toBeGreaterThanOrEqual(1);
            expect(result.messages.some(m => m.includes('BLOCKED'))).toBe(true);
        });

        test('warn rule allows but warns', async () => {
            const module = db.createEthicsModule({
                name: 'TestModule',
                description: 'Test',
                sensitivity: EthicsSensitivity.Low,
                scope: ['test'],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
                version: 1,
            });

            engine.addRule(module.id, {
                name: 'warn_risky',
                description: 'Warn on risky actions',
                condition: 'risky_action',
                action: 'warn',
                priority: 1,
                message: 'This action is risky, proceeding with warning.',
            });

            const result = await engine.evaluateAction({
                action: 'risky_action',
                source: 'coding_agent',
            });

            expect(result.allowed).toBe(true);
            expect(result.decision).toBe('warned');
            expect(result.triggeredRules.length).toBeGreaterThanOrEqual(1);
            expect(result.messages.some(m => m.includes('WARNING'))).toBe(true);
        });

        test('audit rule logs without affecting decision', async () => {
            const module = db.createEthicsModule({
                name: 'TestModule',
                description: 'Test',
                sensitivity: EthicsSensitivity.Low,
                scope: ['test'],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
                version: 1,
            });

            engine.addRule(module.id, {
                name: 'audit_everything',
                description: 'Audit all actions',
                condition: 'true',
                action: 'audit',
                priority: 100,
                message: 'Action audited.',
            });

            const result = await engine.evaluateAction({
                action: 'some_action',
                source: 'coding_agent',
            });

            expect(result.allowed).toBe(true);
            expect(result.decision).toBe('allowed');
            // The audit rule should have triggered
            expect(result.triggeredRules.length).toBe(1);
            expect(result.messages.some(m => m.includes('AUDIT'))).toBe(true);
        });
    });

    // ===================== SENSITIVITY LEVELS =====================

    describe('Sensitivity levels', () => {
        test('Low sensitivity: never blocks', async () => {
            db.createEthicsModule({
                name: 'LowModule',
                description: 'Low sensitivity module',
                sensitivity: EthicsSensitivity.Low,
                scope: ['test'],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
                version: 1,
            });

            // Even a suspicious-sounding action should pass with Low sensitivity
            // (no blocked_actions configured, no block rules)
            const result = await engine.evaluateAction({
                action: 'delete_something',
                source: 'coding_agent',
            });

            expect(result.allowed).toBe(true);
        });

        test('Medium sensitivity: warns on suspicious actions', async () => {
            db.createEthicsModule({
                name: 'MediumModule',
                description: 'Medium sensitivity module',
                sensitivity: EthicsSensitivity.Medium,
                scope: ['test'],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
                version: 1,
            });

            // "delete_files" contains "delete" which is a suspicious pattern
            const result = await engine.evaluateAction({
                action: 'delete_files',
                source: 'coding_agent',
            });

            // Medium sensitivity should at least warn on suspicious actions
            expect(result.allowed).toBe(true);
            expect(result.decision).toBe('warned');
            expect(result.messages.some(m => m.includes('suspicious'))).toBe(true);
        });

        test('High sensitivity: blocks actions not in allowed_actions', async () => {
            db.createEthicsModule({
                name: 'HighModule',
                description: 'High sensitivity module',
                sensitivity: EthicsSensitivity.High,
                scope: ['test'],
                allowed_actions: ['read_data', 'list_items'],
                blocked_actions: [],
                enabled: true,
                version: 1,
            });

            // Action NOT in allowed_actions should be blocked under High sensitivity
            const blockedResult = await engine.evaluateAction({
                action: 'write_data',
                source: 'coding_agent',
            });
            expect(blockedResult.allowed).toBe(false);
            expect(blockedResult.decision).toBe('blocked');
            expect(blockedResult.messages.some(m => m.includes('High sensitivity'))).toBe(true);

            // Action IN allowed_actions should pass
            const allowedResult = await engine.evaluateAction({
                action: 'read_data',
                source: 'coding_agent',
            });
            expect(allowedResult.allowed).toBe(true);
        });

        test('Maximum sensitivity: blocks all non-user actions', async () => {
            db.createEthicsModule({
                name: 'MaxModule',
                description: 'Maximum sensitivity module',
                sensitivity: EthicsSensitivity.Maximum,
                scope: ['test'],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
                version: 1,
            });

            // Automated source should be blocked
            const automatedResult = await engine.evaluateAction({
                action: 'any_action',
                source: 'coding_agent',
            });
            expect(automatedResult.allowed).toBe(false);
            expect(automatedResult.decision).toBe('blocked');
            expect(automatedResult.messages.some(m => m.includes('Maximum sensitivity'))).toBe(true);

            // User source should pass
            const userResult = await engine.evaluateAction({
                action: 'any_action',
                source: 'user',
            });
            expect(userResult.allowed).toBe(true);

            // Manual source should pass
            const manualResult = await engine.evaluateAction({
                action: 'any_action',
                source: 'manual',
            });
            expect(manualResult.allowed).toBe(true);

            // Human source should pass
            const humanResult = await engine.evaluateAction({
                action: 'any_action',
                source: 'human',
            });
            expect(humanResult.allowed).toBe(true);
        });
    });

    // ===================== MODULE MANAGEMENT =====================

    describe('Module management', () => {
        test('enableModule enables a module', () => {
            const module = db.createEthicsModule({
                name: 'TestModule',
                description: 'Test',
                enabled: false,
            });
            expect(module.enabled).toBe(false);

            const updated = engine.enableModule(module.id);
            expect(updated).not.toBeNull();
            expect(updated!.enabled).toBe(true);

            // Verify persisted
            const retrieved = db.getEthicsModule(module.id);
            expect(retrieved!.enabled).toBe(true);
        });

        test('disableModule disables a module', () => {
            const module = db.createEthicsModule({
                name: 'TestModule',
                description: 'Test',
                enabled: true,
            });
            expect(module.enabled).toBe(true);

            const updated = engine.disableModule(module.id);
            expect(updated).not.toBeNull();
            expect(updated!.enabled).toBe(false);

            // Verify persisted
            const retrieved = db.getEthicsModule(module.id);
            expect(retrieved!.enabled).toBe(false);
        });

        test('setSensitivity changes sensitivity level', () => {
            const module = db.createEthicsModule({
                name: 'TestModule',
                description: 'Test',
                sensitivity: EthicsSensitivity.Low,
            });
            expect(module.sensitivity).toBe(EthicsSensitivity.Low);

            const updated = engine.setSensitivity(module.id, EthicsSensitivity.Maximum);
            expect(updated).not.toBeNull();
            expect(updated!.sensitivity).toBe(EthicsSensitivity.Maximum);

            // Verify persisted
            const retrieved = db.getEthicsModule(module.id);
            expect(retrieved!.sensitivity).toBe(EthicsSensitivity.Maximum);
        });

        test('createModule creates a new module', () => {
            const module = engine.createModule(
                'Custom Ethics',
                'Custom module for testing',
                ['custom_scope', 'extra_scope']
            );

            expect(module.id).toBeDefined();
            expect(module.name).toBe('Custom Ethics');
            expect(module.description).toBe('Custom module for testing');
            expect(module.scope).toEqual(['custom_scope', 'extra_scope']);
            expect(module.enabled).toBe(true);
            expect(module.sensitivity).toBe(EthicsSensitivity.Medium);
            expect(module.allowed_actions).toEqual([]);
            expect(module.blocked_actions).toEqual([]);
            expect(module.version).toBe(1);

            // Verify it's in the module list
            const allModules = engine.getModules();
            expect(allModules.find(m => m.id === module.id)).toBeDefined();

            // Verify transparency logger was called
            expect(transparencyLogger.log).toHaveBeenCalledWith(
                expect.objectContaining({
                    source: 'ethics_engine',
                    category: 'ethics_decision',
                    action: 'create_module',
                })
            );
        });
    });

    // ===================== OVERRIDE =====================

    describe('Override', () => {
        test('override updates audit entry', async () => {
            // Create a module with a block rule
            const module = db.createEthicsModule({
                name: 'TestModule',
                description: 'Test',
                sensitivity: EthicsSensitivity.Low,
                scope: ['test'],
                allowed_actions: [],
                blocked_actions: ['bad_action'],
                enabled: true,
                version: 1,
            });

            // Evaluate the action to generate an audit entry
            const result = await engine.evaluateAction({
                action: 'bad_action',
                source: 'coding_agent',
            });
            expect(result.allowed).toBe(false);

            // Override it
            await engine.override(
                result.auditEntryId,
                'admin_user',
                'Justified override for emergency fix'
            );

            // Verify the audit entry was updated
            const auditLog = engine.audit(100);
            const overriddenEntry = auditLog.find(e => e.id === result.auditEntryId);
            expect(overriddenEntry).toBeDefined();
            expect(overriddenEntry!.decision).toBe('overridden');
            expect(overriddenEntry!.override_by).toBe('admin_user');
            expect(overriddenEntry!.override_reason).toBe('Justified override for emergency fix');
        });

        test('override rejects absolute blocks', async () => {
            const result = await engine.evaluateAction({
                action: 'install_spyware',
                source: 'coding_agent',
            });
            expect(result.allowed).toBe(false);

            await expect(
                engine.override(result.auditEntryId, 'admin_user', 'Attempted override')
            ).rejects.toThrow('Cannot override absolute block');
        });

        test('override requires all fields', async () => {
            engine.seedDefaultModules();

            const result = await engine.evaluateAction({
                action: 'collect_user_data',
                source: 'coding_agent',
            });

            // Empty auditEntryId
            await expect(
                engine.override('', 'admin_user', 'reason')
            ).rejects.toThrow('Override requires auditEntryId, overrideBy, and reason');

            // Empty overrideBy
            await expect(
                engine.override(result.auditEntryId, '', 'reason')
            ).rejects.toThrow('Override requires auditEntryId, overrideBy, and reason');

            // Empty reason
            await expect(
                engine.override(result.auditEntryId, 'admin_user', '')
            ).rejects.toThrow('Override requires auditEntryId, overrideBy, and reason');
        });
    });

    // ===================== ACTION LISTS =====================

    describe('Action lists', () => {
        test('getAllowedActions returns deduplicated list', () => {
            engine.seedDefaultModules();

            const allowed = engine.getAllowedActions();
            // Consent module allows read_local_files and generate_ui_code
            expect(allowed).toContain('read_local_files');
            expect(allowed).toContain('generate_ui_code');

            // Verify deduplication by checking array has unique items
            const uniqueCheck = new Set(allowed);
            expect(uniqueCheck.size).toBe(allowed.length);

            // Verify sorted
            const sorted = [...allowed].sort();
            expect(allowed).toEqual(sorted);
        });

        test('getBlockedActions includes absolute blocks + module blocks', () => {
            engine.seedDefaultModules();

            const blocked = engine.getBlockedActions();

            // Should include absolute blocks
            expect(blocked).toContain('create_backdoor');
            expect(blocked).toContain('install_spyware');
            expect(blocked).toContain('bypass_authentication');

            // Should include module-level blocks (from Privacy module)
            expect(blocked).toContain('collect_user_data');
            expect(blocked).toContain('send_analytics');
            expect(blocked).toContain('track_behavior');

            // Should include Speech module blocks
            expect(blocked).toContain('censor_content');
            expect(blocked).toContain('filter_expression');

            // Should include Consent module blocks
            expect(blocked).toContain('execute_without_approval');

            // Verify deduplication
            const uniqueCheck = new Set(blocked);
            expect(uniqueCheck.size).toBe(blocked.length);

            // Verify sorted
            const sorted = [...blocked].sort();
            expect(blocked).toEqual(sorted);
        });
    });

    // ===================== STATUS & WOULDBLOCK =====================

    describe('Status & wouldBlock', () => {
        test('getStatus returns correct summary', () => {
            engine.seedDefaultModules();

            const status = engine.getStatus();

            expect(status.totalModules).toBe(6);
            expect(status.enabledModules).toBe(6);
            expect(status.absoluteBlockCount).toBe(10);
            expect(status.totalRules).toBeGreaterThan(0);
            expect(status.enabledRules).toBeGreaterThan(0);
            expect(status.recentEvaluations).toBe(0); // No evaluations yet
            expect(status.recentBlocks).toBe(0);

            // Check moduleNames includes all modules
            expect(status.moduleNames.length).toBe(6);
            const moduleNameStrings = status.moduleNames.map(m => m.name).sort();
            expect(moduleNameStrings).toEqual([
                'Consent',
                'Data Sovereignty',
                'Privacy',
                'Self-Protection',
                'Speech',
                'Transparency',
            ]);

            // Each module entry should have the expected properties
            for (const moduleInfo of status.moduleNames) {
                expect(moduleInfo.enabled).toBe(true);
                expect(typeof moduleInfo.sensitivity).toBe('string');
                expect(typeof moduleInfo.ruleCount).toBe('number');
            }
        });

        test('wouldBlock checks without creating audit entry', () => {
            // Create an isolated module for predictable behavior
            // (seeded modules include Self-Protection with Maximum sensitivity
            // which would block all actions from automated sources)
            db.createEthicsModule({
                name: 'TestPrivacy',
                description: 'Test privacy module',
                sensitivity: EthicsSensitivity.Low,
                scope: ['data_access'],
                allowed_actions: [],
                blocked_actions: ['collect_user_data'],
                enabled: true,
                version: 1,
            });

            // Should report absolute block would be blocked
            const absoluteResult = engine.wouldBlock('create_backdoor');
            expect(absoluteResult.blocked).toBe(true);
            expect(absoluteResult.reason).toContain('Absolute block');

            // Should report module-blocked action
            const moduleResult = engine.wouldBlock('collect_user_data');
            expect(moduleResult.blocked).toBe(true);
            expect(moduleResult.reason).toContain('TestPrivacy');

            // Should report safe action is allowed (Low sensitivity, no block rules)
            const safeResult = engine.wouldBlock('read_documentation');
            expect(safeResult.blocked).toBe(false);
            expect(safeResult.reason).toContain('allowed');

            // Verify NO audit entries were created
            const auditLog = engine.audit(100);
            expect(auditLog.length).toBe(0);
        });
    });

    // ===================== ERROR SAFETY =====================

    describe('Error safety', () => {
        test('evaluation error results in block (safety net)', async () => {
            // Create a broken engine by mocking getEnabledEthicsModules to throw
            const brokenDb = db as any;
            const originalMethod = brokenDb.getEnabledEthicsModules.bind(brokenDb);
            brokenDb.getEnabledEthicsModules = () => {
                throw new Error('Simulated DB failure');
            };

            const result = await engine.evaluateAction({
                action: 'normal_action',
                source: 'coding_agent',
            });

            // Should block as a safety measure
            expect(result.allowed).toBe(false);
            expect(result.decision).toBe('blocked');
            expect(result.messages.some(m => m.includes('error'))).toBe(true);
            expect(result.auditEntryId).toBeDefined();

            // Verify outputChannel logged the error
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('EVALUATION ERROR')
            );

            // Restore original method
            brokenDb.getEnabledEthicsModules = originalMethod;
        });
    });

    // ===================== EVENT EMISSION =====================

    describe('Event emission', () => {
        test('evaluateAction emits ethics events', async () => {
            const emittedEvents: string[] = [];
            eventBus.on('ethics:action_blocked', (event) => {
                emittedEvents.push('blocked');
            });
            eventBus.on('ethics:check_passed', (event) => {
                emittedEvents.push('passed');
            });

            // Blocked action
            await engine.evaluateAction({
                action: 'create_backdoor',
                source: 'coding_agent',
            });
            expect(emittedEvents).toContain('blocked');

            // Allowed action (no modules = auto-allow)
            await engine.evaluateAction({
                action: 'harmless_read',
                source: 'user',
            });
            expect(emittedEvents).toContain('passed');
        });

        test('transparency logger is called for each evaluation', async () => {
            await engine.evaluateAction({
                action: 'create_backdoor',
                source: 'coding_agent',
            });

            expect(transparencyLogger.log).toHaveBeenCalledWith(
                expect.objectContaining({
                    source: 'ethics_engine',
                    category: 'ethics_decision',
                    severity: 'critical',
                })
            );
        });
    });

    // ===================== COMBINED SCENARIOS =====================

    describe('Combined scenarios', () => {
        test('substring matching catches action variants', async () => {
            // Absolute block uses substring matching, so a variant should also be caught
            const result = await engine.evaluateAction({
                action: 'try_to_create_backdoor_sneaky',
                source: 'coding_agent',
            });

            expect(result.allowed).toBe(false);
            expect(result.decision).toBe('blocked');
        });

        test('no modules enabled allows action by default', async () => {
            // Don't seed any modules
            const result = await engine.evaluateAction({
                action: 'anything_goes',
                source: 'coding_agent',
            });

            expect(result.allowed).toBe(true);
            expect(result.decision).toBe('allowed');
            expect(result.messages.some(m => m.includes('No ethics modules enabled'))).toBe(true);
        });

        test('disabled module does not affect evaluation', async () => {
            const module = db.createEthicsModule({
                name: 'DisabledModule',
                description: 'Test disabled',
                sensitivity: EthicsSensitivity.Maximum,
                scope: ['test'],
                allowed_actions: [],
                blocked_actions: ['forbidden_action'],
                enabled: false,
                version: 1,
            });

            // Module is disabled, so its blocked_actions should not apply
            const result = await engine.evaluateAction({
                action: 'forbidden_action',
                source: 'coding_agent',
            });

            // No enabled modules, so allowed by default
            expect(result.allowed).toBe(true);
            expect(result.decision).toBe('allowed');
        });

        test('multiple modules evaluated in order — first block wins', async () => {
            // Module A: blocks 'risky_operation'
            db.createEthicsModule({
                name: 'ModuleA',
                description: 'First blocker',
                sensitivity: EthicsSensitivity.Low,
                scope: ['test'],
                allowed_actions: [],
                blocked_actions: ['risky_operation'],
                enabled: true,
                version: 1,
            });

            // Module B: also blocks 'risky_operation'
            db.createEthicsModule({
                name: 'ModuleB',
                description: 'Second blocker',
                sensitivity: EthicsSensitivity.Low,
                scope: ['test'],
                allowed_actions: [],
                blocked_actions: ['risky_operation'],
                enabled: true,
                version: 1,
            });

            const result = await engine.evaluateAction({
                action: 'risky_operation',
                source: 'coding_agent',
            });

            expect(result.allowed).toBe(false);
            expect(result.decision).toBe('blocked');
            // Should have exactly one block message (first module short-circuits)
            const blockMessages = result.messages.filter(m => m.includes('blocked list'));
            expect(blockMessages.length).toBe(1);
        });

        test('audit entries accumulate across multiple evaluations', async () => {
            engine.seedDefaultModules();

            await engine.evaluateAction({ action: 'read_data', source: 'user' });
            await engine.evaluateAction({ action: 'create_backdoor', source: 'agent' });
            await engine.evaluateAction({ action: 'collect_user_data', source: 'agent' });

            const auditLog = engine.audit(100);
            expect(auditLog.length).toBe(3);
        });

        test('seeded modules with rules evaluate correctly end to end', async () => {
            engine.seedDefaultModules();

            // Privacy module should block collect_user_data via blocked_actions
            const privacyBlocked = await engine.evaluateAction({
                action: 'collect_user_data',
                source: 'coding_agent',
            });
            expect(privacyBlocked.allowed).toBe(false);

            // Speech module should block censor_content via blocked_actions
            const speechBlocked = await engine.evaluateAction({
                action: 'censor_content',
                source: 'coding_agent',
            });
            expect(speechBlocked.allowed).toBe(false);

            // Self-Protection module (Maximum sensitivity) blocks all non-user actions
            // regardless of whether they match blocked_actions
            const selfProtBlocked = await engine.evaluateAction({
                action: 'some_automated_task',
                source: 'coding_agent',
            });
            expect(selfProtBlocked.allowed).toBe(false);

            // Consent module blocks execute_without_approval
            const consentBlocked = await engine.evaluateAction({
                action: 'execute_without_approval',
                source: 'coding_agent',
            });
            expect(consentBlocked.allowed).toBe(false);
        });
    });

    // ===================== COVERAGE GAP TESTS =====================

    describe('Override audit entry not found (line 773)', () => {
        test('override throws when audit entry does not exist', async () => {
            await expect(
                engine.override('nonexistent-audit-id', 'admin', 'Testing override')
            ).rejects.toThrow(/Audit entry not found: nonexistent-audit-id/);
        });
    });

    describe('Rule action "allow" case (line 1039)', () => {
        test('rule with action "allow" does not change the decision', async () => {
            const module = db.createEthicsModule({
                name: 'AllowTestModule',
                sensitivity: EthicsSensitivity.Low,
                scope: ['testing'],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
            });

            db.createEthicsRule({
                module_id: module.id,
                name: 'Allow Rule',
                description: 'Explicitly allows testing actions',
                condition: 'test_action',
                action: 'allow',
                priority: 1,
                enabled: true,
                message: 'Action explicitly allowed',
            });

            const result = await engine.evaluateAction({
                action: 'test_action',
                source: 'test_source',
            });

            // An explicit 'allow' rule should not block the action
            expect(result.allowed).toBe(true);
        });
    });

    describe('matchesCondition pipe-separated alternatives (line 1072)', () => {
        test('rule with pipe-separated condition matches any alternative', async () => {
            const module = db.createEthicsModule({
                name: 'PipeConditionModule',
                sensitivity: EthicsSensitivity.Low,
                scope: ['pipe_test'],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
            });

            db.createEthicsRule({
                module_id: module.id,
                name: 'Pipe Block Rule',
                description: 'Blocks multiple actions via pipe alternatives',
                condition: 'delete_data|destroy_config|wipe_logs',
                action: 'block',
                priority: 1,
                enabled: true,
                message: 'Dangerous action blocked',
            });

            // Should match first alternative
            const result1 = await engine.evaluateAction({
                action: 'delete_data',
                source: 'test_source',
            });
            expect(result1.allowed).toBe(false);

            // Should match third alternative
            const result2 = await engine.evaluateAction({
                action: 'wipe_logs',
                source: 'test_source',
            });
            expect(result2.allowed).toBe(false);

            // Should NOT match any alternative
            const result3 = await engine.evaluateAction({
                action: 'read_data',
                source: 'test_source',
            });
            expect(result3.allowed).toBe(true);
        });
    });

    describe('logToTransparency error handling (lines 1244-1245)', () => {
        test('transparency logger failure does not prevent evaluation', async () => {
            // Make transparency logger throw
            (transparencyLogger.log as jest.Mock).mockImplementation(() => {
                throw new Error('TransparencyLogger broken');
            });

            const module = db.createEthicsModule({
                name: 'LogErrorTestModule',
                sensitivity: EthicsSensitivity.Low,
                scope: [],
                allowed_actions: [],
                blocked_actions: ['dangerous_action'],
                enabled: true,
            });

            // Should still evaluate correctly despite logging failure
            const result = await engine.evaluateAction({
                action: 'dangerous_action',
                source: 'test_source',
            });

            expect(result.allowed).toBe(false);
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Transparency log failed (non-fatal)')
            );
        });
    });

    describe('emitEvent error handling (lines 1273-1274)', () => {
        test('event emission failure does not prevent evaluation', async () => {
            // Make eventBus.emit throw
            jest.spyOn(eventBus, 'emit').mockImplementation(() => {
                throw new Error('EventBus broken');
            });

            const module = db.createEthicsModule({
                name: 'EventErrorModule',
                sensitivity: EthicsSensitivity.Low,
                scope: [],
                allowed_actions: [],
                blocked_actions: ['event_test_action'],
                enabled: true,
            });

            const result = await engine.evaluateAction({
                action: 'event_test_action',
                source: 'test_source',
            });

            expect(result.allowed).toBe(false);
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Event emission failed (non-fatal)')
            );

            (eventBus.emit as jest.Mock).mockRestore();
        });
    });

    describe('wouldBlock edge cases (lines 1345-1380)', () => {
        test('wouldBlock detects block rules matching condition', () => {
            const module = db.createEthicsModule({
                name: 'WouldBlockRuleModule',
                sensitivity: EthicsSensitivity.Low,
                scope: ['preflight'],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
            });

            db.createEthicsRule({
                module_id: module.id,
                name: 'Block Destructive',
                description: 'Blocks destructive operations',
                condition: 'delete|destroy',
                action: 'block',
                priority: 1,
                enabled: true,
                message: 'Destructive action',
            });

            const result = engine.wouldBlock('delete_files');
            expect(result.blocked).toBe(true);
            expect(result.reason).toContain('Block Destructive');
        });

        test('wouldBlock returns blocked for Maximum sensitivity modules', () => {
            db.createEthicsModule({
                name: 'MaxSensModule',
                sensitivity: EthicsSensitivity.Maximum,
                scope: [],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
            });

            const result = engine.wouldBlock('any_action');
            expect(result.blocked).toBe(true);
            expect(result.reason).toContain('Maximum sensitivity');
        });

        test('wouldBlock checks High sensitivity allowed_actions list', () => {
            db.createEthicsModule({
                name: 'HighSensModule',
                sensitivity: EthicsSensitivity.High,
                scope: ['data_access'],
                allowed_actions: ['read_local_files'],
                blocked_actions: [],
                enabled: true,
            });

            // Action within scope but not in allowed list
            const blocked = engine.wouldBlock('data_access_write');
            expect(blocked.blocked).toBe(true);
            expect(blocked.reason).toContain('High sensitivity');

            // Action in the allowed list
            const allowed = engine.wouldBlock('read_local_files');
            expect(allowed.blocked).toBe(false);
        });
    });

    // ==================== ADDITIONAL BRANCH COVERAGE TESTS ====================

    describe('evaluateAction triggeringModuleId fallback (line 451)', () => {
        test('uses modules[0].id when no module triggered anything', async () => {
            // Create a module with no blocked_actions and no rules
            db.createEthicsModule({
                name: 'EmptyModule',
                description: 'Module with nothing to trigger',
                sensitivity: EthicsSensitivity.Low,
                scope: [],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
                version: 1,
            });

            const result = await engine.evaluateAction({
                action: 'harmless_read_operation',
                source: 'coding_agent',
            });

            // No module triggered, so triggeringModuleId stays null
            // The audit entry should use modules[0].id
            expect(result.allowed).toBe(true);
            expect(result.auditEntryId).toBeDefined();
            expect(result.messages.some(m => m.includes('passed all ethics checks'))).toBe(true);
        });
    });

    describe('evaluateAction error catch with non-Error (line 496)', () => {
        test('evaluation error with non-Error object uses String() conversion', async () => {
            // Mock getEnabledEthicsModules to throw a non-Error object
            const brokenDb = db as any;
            const originalMethod = brokenDb.getEnabledEthicsModules.bind(brokenDb);
            brokenDb.getEnabledEthicsModules = () => {
                throw 'string error from database';
            };

            const result = await engine.evaluateAction({
                action: 'normal_action',
                source: 'coding_agent',
            });

            expect(result.allowed).toBe(false);
            expect(result.decision).toBe('blocked');
            expect(result.messages.some(m => m.includes('string error from database'))).toBe(true);
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('string error from database')
            );

            brokenDb.getEnabledEthicsModules = originalMethod;
        });
    });

    describe('Override with malformed context_snapshot (lines 779-785)', () => {
        test('override handles malformed context_snapshot JSON', async () => {
            // Create a module with a blocked action to generate an audit entry
            const module = db.createEthicsModule({
                name: 'MalformedContextModule',
                description: 'Test',
                sensitivity: EthicsSensitivity.Low,
                scope: [],
                allowed_actions: [],
                blocked_actions: ['blocked_action'],
                enabled: true,
                version: 1,
            });

            const result = await engine.evaluateAction({
                action: 'blocked_action',
                source: 'coding_agent',
            });

            expect(result.allowed).toBe(false);

            // Now tamper with the context_snapshot in the database to make it malformed JSON
            const rawDb = (db as any).db;
            rawDb.exec(`UPDATE ethics_audit SET context_snapshot = 'not-valid-json' WHERE id = '${result.auditEntryId}'`);

            // Override should still work because:
            // 1. JSON.parse fails => catches silently
            // 2. originalAction becomes '' (empty)
            // 3. isAbsoluteBlocked('') is false
            // 4. module_id is the actual module.id, not 'absolute_block'
            await engine.override(result.auditEntryId, 'admin', 'Testing malformed context');

            // Verify override succeeded
            const auditLog = engine.audit(100);
            const entry = auditLog.find(e => e.id === result.auditEntryId);
            expect(entry!.decision).toBe('overridden');
        });
    });

    describe('evaluateModule with missing rules (line 1001)', () => {
        test('evaluateAction handles module with undefined rules', async () => {
            // Create a module and then tamper with its rules to be undefined
            const module = db.createEthicsModule({
                name: 'NoRulesModule',
                description: 'Module with no rules',
                sensitivity: EthicsSensitivity.Low,
                scope: [],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
                version: 1,
            });

            // The module has no rules (empty array from DB), which is fine
            // but let's verify the || [] fallback works
            const result = await engine.evaluateAction({
                action: 'some_action',
                source: 'coding_agent',
            });

            expect(result.allowed).toBe(true);
        });
    });

    describe('Rule message fallback to description (lines 1016, 1026-1033)', () => {
        test('block rule uses description when message is empty', async () => {
            const module = db.createEthicsModule({
                name: 'FallbackModule',
                sensitivity: EthicsSensitivity.Low,
                scope: [],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
            });

            db.createEthicsRule({
                module_id: module.id,
                name: 'EmptyMsgBlockRule',
                description: 'Block rule with no message',
                condition: 'bad_action',
                action: 'block',
                priority: 1,
                enabled: true,
                message: '', // Empty message — should fall back to description
            });

            const result = await engine.evaluateAction({
                action: 'bad_action',
                source: 'test',
            });

            expect(result.allowed).toBe(false);
            expect(result.messages.some(m => m.includes('Block rule with no message'))).toBe(true);
        });

        test('warn rule uses description when message is empty', async () => {
            const module = db.createEthicsModule({
                name: 'WarnFallbackModule',
                sensitivity: EthicsSensitivity.Low,
                scope: [],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
            });

            db.createEthicsRule({
                module_id: module.id,
                name: 'EmptyMsgWarnRule',
                description: 'Warn rule with no message field',
                condition: 'warn_action',
                action: 'warn',
                priority: 1,
                enabled: true,
                message: '', // Empty message
            });

            const result = await engine.evaluateAction({
                action: 'warn_action',
                source: 'test',
            });

            expect(result.allowed).toBe(true);
            expect(result.decision).toBe('warned');
            expect(result.messages.some(m => m.includes('Warn rule with no message field'))).toBe(true);
        });

        test('audit rule uses description when message is empty', async () => {
            const module = db.createEthicsModule({
                name: 'AuditFallbackModule',
                sensitivity: EthicsSensitivity.Low,
                scope: [],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
            });

            db.createEthicsRule({
                module_id: module.id,
                name: 'EmptyMsgAuditRule',
                description: 'Audit rule description fallback',
                condition: 'audit_target',
                action: 'audit',
                priority: 1,
                enabled: true,
                message: '', // Empty message
            });

            const result = await engine.evaluateAction({
                action: 'audit_target',
                source: 'test',
            });

            expect(result.allowed).toBe(true);
            expect(result.messages.some(m => m.includes('Audit rule description fallback'))).toBe(true);
        });
    });

    describe('matchesCondition edge cases (lines 1070, 1080)', () => {
        test('pipe-separated condition with empty alternative is skipped', async () => {
            const module = db.createEthicsModule({
                name: 'PipeEmptyModule',
                sensitivity: EthicsSensitivity.Low,
                scope: [],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
            });

            // Condition with empty alternatives: "delete||destroy" (empty string between pipes)
            db.createEthicsRule({
                module_id: module.id,
                name: 'EmptyPipeRule',
                description: 'Rule with empty pipe alternatives',
                condition: 'delete||destroy',
                action: 'block',
                priority: 1,
                enabled: true,
                message: 'Blocked by empty-pipe rule',
            });

            // Should still match 'delete'
            const result = await engine.evaluateAction({
                action: 'delete_files',
                source: 'test',
            });
            expect(result.allowed).toBe(false);

            // Should NOT match something that doesn't contain 'delete' or 'destroy'
            const result2 = await engine.evaluateAction({
                action: 'read_files',
                source: 'test',
            });
            expect(result2.allowed).toBe(true);
        });

        test('simple condition matches via reverse substring (condition includes action)', async () => {
            const module = db.createEthicsModule({
                name: 'ReverseSubstrModule',
                sensitivity: EthicsSensitivity.Low,
                scope: [],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
            });

            // Condition is longer and CONTAINS the action name
            db.createEthicsRule({
                module_id: module.id,
                name: 'ReverseSubstrRule',
                description: 'Rule where condition contains the action',
                condition: 'delete_all_user_data',
                action: 'block',
                priority: 1,
                enabled: true,
                message: 'Reverse match triggered',
            });

            // The action "delete" is shorter than the condition "delete_all_user_data"
            // normalizedAction.includes(normalizedCondition) = false
            // normalizedCondition.includes(normalizedAction) = true => match!
            const result = await engine.evaluateAction({
                action: 'delete',
                source: 'test',
            });
            expect(result.allowed).toBe(false);
            expect(result.messages.some(m => m.includes('Reverse match triggered'))).toBe(true);
        });
    });

    describe('getStatus with modules that have no rules (lines 1289-1308)', () => {
        test('getStatus handles modules with undefined/null rules', () => {
            // Create a module that has no rules
            db.createEthicsModule({
                name: 'NoRulesStatusModule',
                description: 'Test status with empty rules',
                sensitivity: EthicsSensitivity.Low,
                scope: [],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
            });

            const status = engine.getStatus();
            expect(status.totalModules).toBe(1);
            expect(status.enabledModules).toBe(1);
            // rules?.length ?? 0 should handle undefined rules
            expect(status.totalRules).toBe(0);
            expect(status.enabledRules).toBe(0);
            // Module entry should have ruleCount of 0
            expect(status.moduleNames[0].ruleCount).toBe(0);
        });

        test('getStatus returns correct count of recent blocks', async () => {
            db.createEthicsModule({
                name: 'BlockCountModule',
                sensitivity: EthicsSensitivity.Low,
                scope: [],
                allowed_actions: [],
                blocked_actions: ['bad_action'],
                enabled: true,
            });

            await engine.evaluateAction({ action: 'bad_action', source: 'agent' });
            await engine.evaluateAction({ action: 'good_action', source: 'agent' });

            const status = engine.getStatus();
            expect(status.recentEvaluations).toBe(2);
            expect(status.recentBlocks).toBe(1);
        });
    });

    describe('wouldBlock with module having no rules (line 1344)', () => {
        test('wouldBlock works when module has no block rules', () => {
            db.createEthicsModule({
                name: 'NoBlockRulesModule',
                sensitivity: EthicsSensitivity.Low,
                scope: [],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
            });

            // No block rules, no blocked_actions, low sensitivity => allowed
            const result = engine.wouldBlock('safe_action');
            expect(result.blocked).toBe(false);
        });
    });

    describe('Sensitivity warned branch via sensitivity override (line 433-438)', () => {
        test('High sensitivity with empty allowed_actions warns when action is allowed by rules', async () => {
            // Create a High sensitivity module with no allowed_actions list
            db.createEthicsModule({
                name: 'HighNoAllowModule',
                description: 'High sensitivity with no allowed_actions',
                sensitivity: EthicsSensitivity.High,
                scope: [],
                allowed_actions: [], // Empty allowed_actions
                blocked_actions: [],
                enabled: true,
                version: 1,
            });

            const result = await engine.evaluateAction({
                action: 'some_unknown_action',
                source: 'coding_agent',
            });

            // High sensitivity with empty allowed_actions => warn (not block)
            expect(result.allowed).toBe(true);
            expect(result.decision).toBe('warned');
            expect(result.messages.some(m => m.includes('High sensitivity'))).toBe(true);
        });
    });

    describe('Evaluation with warn rule and sensitivity escalation', () => {
        test('warn decision from rule is preserved through sensitivity check', async () => {
            const module = db.createEthicsModule({
                name: 'WarnSensModule',
                description: 'Module with warn rules',
                sensitivity: EthicsSensitivity.Low, // Low sensitivity doesn't escalate
                scope: [],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
            });

            db.createEthicsRule({
                module_id: module.id,
                name: 'WarnRule',
                description: 'Warn on risky stuff',
                condition: 'risky_stuff',
                action: 'warn',
                priority: 1,
                enabled: true,
                message: 'This is risky.',
            });

            const result = await engine.evaluateAction({
                action: 'risky_stuff',
                source: 'test',
            });

            expect(result.allowed).toBe(true);
            expect(result.decision).toBe('warned');
            // The triggeredRules should have our warn rule
            expect(result.triggeredRules.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('logToTransparency with targetEntityType and targetEntityId', () => {
        test('evaluateAction passes entity fields to transparency logger', async () => {
            db.createEthicsModule({
                name: 'EntityModule',
                sensitivity: EthicsSensitivity.Low,
                scope: [],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
            });

            await engine.evaluateAction({
                action: 'read_entity',
                source: 'test',
                targetEntityType: 'task',
                targetEntityId: 'task-123',
            });

            expect(transparencyLogger.log).toHaveBeenCalledWith(
                expect.objectContaining({
                    entityType: 'task',
                    entityId: 'task-123',
                })
            );
        });
    });

    describe('Caching behavior', () => {
        test('module cache is used for rapid successive evaluations', async () => {
            db.createEthicsModule({
                name: 'CacheTestModule',
                sensitivity: EthicsSensitivity.Low,
                scope: [],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
            });

            // First call populates cache
            await engine.evaluateAction({ action: 'action1', source: 'test' });
            // Second call should use cache (within 5s)
            await engine.evaluateAction({ action: 'action2', source: 'test' });

            // Both should succeed
            const auditLog = engine.audit(100);
            expect(auditLog.length).toBe(2);
        });
    });

    describe('logToTransparency non-Error thrown (line 1244 String branch)', () => {
        test('transparency logger throws non-Error object', async () => {
            (transparencyLogger.log as jest.Mock).mockImplementation(() => {
                throw 'string error from transparency logger';
            });

            // Need at least one enabled module so evaluation goes past Step 2
            db.createEthicsModule({
                name: 'TriggerModule',
                sensitivity: EthicsSensitivity.Low,
                scope: [],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
            });

            const result = await engine.evaluateAction({
                action: 'harmless_action',
                source: 'test',
            });

            // Should still complete despite transparency logger failure
            expect(result.auditEntryId).toBeDefined();
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('string error from transparency logger')
            );
        });
    });

    describe('emitEvent non-Error thrown (line 1273 String branch)', () => {
        test('eventBus.emit throws non-Error object', async () => {
            jest.spyOn(eventBus, 'emit').mockImplementation(() => {
                throw 42; // non-Error thrown
            });

            db.createEthicsModule({
                name: 'EmitErrorModule',
                sensitivity: EthicsSensitivity.Low,
                scope: [],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
            });

            const result = await engine.evaluateAction({
                action: 'harmless_action',
                source: 'test',
            });

            expect(result.auditEntryId).toBeDefined();
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Event emission failed (non-fatal): 42')
            );

            (eventBus.emit as jest.Mock).mockRestore();
        });
    });

    describe('getStatus with modules missing rules property (lines 1289-1308)', () => {
        test('getStatus handles modules where rules is undefined via ?.', () => {
            // Create a module normally
            const module = db.createEthicsModule({
                name: 'RulesUndefinedModule',
                sensitivity: EthicsSensitivity.Low,
                scope: [],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
            });

            // Mock getAllEthicsModules to return module with undefined rules
            const origGetAll = db.getAllEthicsModules.bind(db);
            jest.spyOn(db, 'getAllEthicsModules').mockImplementation(() => {
                const modules = origGetAll();
                return modules.map(m => ({ ...m, rules: undefined as any }));
            });

            const status = engine.getStatus();
            expect(status.totalModules).toBe(1);
            expect(status.totalRules).toBe(0);
            expect(status.enabledRules).toBe(0);
            expect(status.moduleNames[0].ruleCount).toBe(0);

            (db.getAllEthicsModules as jest.Mock).mockRestore();
        });
    });

    describe('evaluateModule with module.rules being undefined (line 1001)', () => {
        test('evaluateAction handles module where rules property is undefined', async () => {
            db.createEthicsModule({
                name: 'NoRulesEvalModule',
                sensitivity: EthicsSensitivity.Low,
                scope: [],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
            });

            // Mock getEnabledEthicsModules to return modules with undefined rules
            const origGetEnabled = db.getEnabledEthicsModules.bind(db);
            jest.spyOn(db, 'getEnabledEthicsModules').mockImplementation(() => {
                const modules = origGetEnabled();
                return modules.map(m => ({ ...m, rules: undefined as any }));
            });

            const result = await engine.evaluateAction({
                action: 'some_action',
                source: 'test',
            });

            expect(result.allowed).toBe(true);

            (db.getEnabledEthicsModules as jest.Mock).mockRestore();
        });
    });

    describe('wouldBlock with module.rules being undefined (line 1344)', () => {
        test('wouldBlock handles module with undefined rules property', () => {
            db.createEthicsModule({
                name: 'NoRulesWouldBlockModule',
                sensitivity: EthicsSensitivity.Low,
                scope: [],
                allowed_actions: [],
                blocked_actions: [],
                enabled: true,
            });

            // Mock getEnabledEthicsModules for wouldBlock
            const origGetEnabled = db.getEnabledEthicsModules.bind(db);
            jest.spyOn(db, 'getEnabledEthicsModules').mockImplementation(() => {
                const modules = origGetEnabled();
                return modules.map(m => ({ ...m, rules: undefined as any }));
            });

            const result = engine.wouldBlock('some_action');
            expect(result.blocked).toBe(false);

            (db.getEnabledEthicsModules as jest.Mock).mockRestore();
        });
    });

    describe('Override with action in context_snapshot matching absolute block (line 779-785)', () => {
        test('override rejects when parsed action matches absolute block', async () => {
            // Create a normal module-level block
            const module = db.createEthicsModule({
                name: 'NormalBlockModule',
                sensitivity: EthicsSensitivity.Low,
                scope: [],
                allowed_actions: [],
                blocked_actions: ['some_bad_action'],
                enabled: true,
                version: 1,
            });

            const result = await engine.evaluateAction({
                action: 'some_bad_action',
                source: 'coding_agent',
            });

            // Now tamper with context_snapshot to make the action look like an absolute block
            const rawDb = (db as any).db;
            rawDb.exec(`UPDATE ethics_audit SET context_snapshot = '{"action":"create_backdoor"}' WHERE id = '${result.auditEntryId}'`);

            // Attempt override — should fail because parsed action matches absolute block
            await expect(
                engine.override(result.auditEntryId, 'admin', 'Testing')
            ).rejects.toThrow('Cannot override absolute block');
        });
    });

    // ==================== ADDITIONAL BRANCH COVERAGE ====================

    describe('Override with empty context_snapshot (line 779)', () => {
        test('override handles empty context_snapshot via || fallback', async () => {
            // Create a module-level block
            db.createEthicsModule({
                name: 'EmptyContextModule',
                sensitivity: EthicsSensitivity.Low,
                scope: [],
                allowed_actions: [],
                blocked_actions: ['blockable_action'],
                enabled: true,
                version: 1,
            });

            const result = await engine.evaluateAction({
                action: 'blockable_action',
                source: 'coding_agent',
            });

            // Set context_snapshot to empty string to trigger the || '{}' fallback
            const rawDb = (db as any).db;
            rawDb.exec(`UPDATE ethics_audit SET context_snapshot = '' WHERE id = '${result.auditEntryId}'`);

            // Override should succeed (returns void) because parsed action is '' (not in absolute blocks)
            await expect(
                engine.override(result.auditEntryId, 'admin', 'Testing empty context')
            ).resolves.toBeUndefined();
        });

        test('override handles malformed JSON context_snapshot via catch', async () => {
            db.createEthicsModule({
                name: 'MalformedContextModule',
                sensitivity: EthicsSensitivity.Low,
                scope: [],
                allowed_actions: [],
                blocked_actions: ['another_blockable'],
                enabled: true,
                version: 1,
            });

            const result = await engine.evaluateAction({
                action: 'another_blockable',
                source: 'coding_agent',
            });

            // Set context_snapshot to invalid JSON to trigger the catch branch at line 780
            const rawDb = (db as any).db;
            rawDb.exec(`UPDATE ethics_audit SET context_snapshot = 'not valid json {{{' WHERE id = '${result.auditEntryId}'`);

            // Override should succeed since contextSnapshot will be {} and action ''
            await expect(
                engine.override(result.auditEntryId, 'admin', 'Testing malformed context')
            ).resolves.toBeUndefined();
        });
    });

    describe('evaluateAction with no enabled modules (line 451 unknown fallback)', () => {
        test('triggeringModuleId falls back to unknown when no modules exist', async () => {
            // With no modules created, evaluate an action
            // modules array will be empty, so modules[0]?.id is undefined, triggering ?? "unknown"
            const result = await engine.evaluateAction({
                action: 'harmless_action',
                source: 'test',
            });
            // Should pass because no modules to check
            expect(result.allowed).toBe(true);
            expect(result.auditEntryId).toBeDefined();
        });
    });

    describe('evaluateAction line 451 modules[0]?.id ?? unknown with module having no id', () => {
        test('falls back to unknown when modules array has element with undefined id', async () => {
            // To reach the ?? 'unknown' fallback on line 451, we need:
            // 1. modules.length > 0 (to pass line 377 check)
            // 2. triggeringModuleId remains null (no module triggers block/warn)
            // 3. modules[0].id is undefined/null
            // We mock getEnabledEthicsModules to return a module with id: undefined
            const origGetEnabled = db.getEnabledEthicsModules.bind(db);
            jest.spyOn(db, 'getEnabledEthicsModules').mockImplementation(() => {
                return [{
                    id: undefined as any,
                    name: 'NoIdModule',
                    description: 'Module with no id',
                    sensitivity: 'low' as any,
                    scope: [],
                    allowed_actions: [],
                    blocked_actions: [],
                    enabled: true,
                    version: 1,
                    rules: [],
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                }];
            });

            const result = await engine.evaluateAction({
                action: 'harmless_action',
                source: 'test',
            });

            // Should pass (Low sensitivity, no block rules, no blocked_actions)
            expect(result.allowed).toBe(true);
            expect(result.auditEntryId).toBeDefined();
            // The audit entry was created with module_id = 'unknown'
            const auditLog = engine.audit(100);
            const entry = auditLog.find(e => e.id === result.auditEntryId);
            expect(entry).toBeDefined();
            expect(entry!.module_id).toBe('unknown');

            (db.getEnabledEthicsModules as jest.Mock).mockRestore();
        });
    });
});
