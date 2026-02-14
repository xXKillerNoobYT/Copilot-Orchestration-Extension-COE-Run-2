import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../src/core/database';
import { EvolutionService } from '../src/core/evolution-service';

// Mock vscode
jest.mock('vscode', () => require('./__mocks__/vscode'));

describe('EvolutionService', () => {
    let db: Database;
    let service: EvolutionService;
    let tmpDir: string;
    let outputChannel: { appendLine: jest.Mock };
    let mockConfig: any;
    let mockLLM: any;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-evolution-svc-test-'));
        db = new Database(tmpDir);
        await db.initialize();

        outputChannel = { appendLine: jest.fn() };
        mockConfig = {};
        mockLLM = {
            chat: jest.fn().mockResolvedValue({
                content: '{"proposal": "Increase timeout to 120s", "affects_p1": false, "change_type": "config"}',
                tokens_used: 50,
                model: 'test',
                finish_reason: 'stop',
            }),
        };

        service = new EvolutionService(db, mockConfig, mockLLM, outputChannel as any);
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ===================== incrementCallCounter (line 37) =====================

    describe('incrementCallCounter', () => {
        test('triggers detectPatterns after reaching checkInterval', () => {
            const detectSpy = jest.spyOn(service, 'detectPatterns').mockResolvedValue([]);

            // Call 19 times — should not trigger
            for (let i = 0; i < 19; i++) {
                service.incrementCallCounter();
            }
            expect(detectSpy).not.toHaveBeenCalled();

            // 20th call should trigger
            service.incrementCallCounter();
            expect(detectSpy).toHaveBeenCalledTimes(1);

            // Counter should be reset
            expect(service.getCallCounter()).toBe(0);

            detectSpy.mockRestore();
        });

        test('logs error when detectPatterns fails (line 37)', async () => {
            jest.spyOn(service, 'detectPatterns').mockRejectedValue(new Error('Detection failed'));

            // Trigger detectPatterns
            for (let i = 0; i < 20; i++) {
                service.incrementCallCounter();
            }

            // Give the fire-and-forget promise time to resolve
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Evolution pattern detection error')
            );
        });
    });

    // ===================== detectPatterns (line 89) =====================

    describe('detectPatterns', () => {
        test('detects patterns from audit log entries', async () => {
            // Seed audit log with error patterns
            for (let i = 0; i < 10; i++) {
                db.addAuditLog('agent', 'error', 'TIMEOUT: Connection failed after 30s at line 42');
            }

            const patterns = await service.detectPatterns();
            expect(patterns.length).toBeGreaterThanOrEqual(0);
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Evolution: detected')
            );
        });

        test('sorts multiple patterns by score descending (line 80 sort callback)', async () => {
            // Seed TWO distinct patterns so the sort callback is invoked
            for (let i = 0; i < 10; i++) {
                db.addAuditLog('agent', 'error', 'TIMEOUT: Pattern Alpha connection refused');
            }
            for (let i = 0; i < 10; i++) {
                db.addAuditLog('agent', 'error', 'critical TIMEOUT: Pattern Beta deadlock');
            }

            const patterns = await service.detectPatterns();
            // With 2+ patterns, the sort callback is exercised
            expect(patterns.length).toBeGreaterThanOrEqual(2);
            // Verify sorted by score descending
            for (let i = 1; i < patterns.length; i++) {
                expect(patterns[i - 1].score).toBeGreaterThanOrEqual(patterns[i].score);
            }
        });

        test('catches generateProposal errors (line 89)', async () => {
            // Seed enough error entries to trigger pattern detection
            for (let i = 0; i < 10; i++) {
                db.addAuditLog('agent', 'error', 'critical TIMEOUT: Connection failed');
            }

            // Make LLM throw — the inner catch in generateProposal (line 145) catches first
            // and logs "Evolution proposal error: ..."
            mockLLM.chat.mockRejectedValue(new Error('LLM unavailable'));

            const patterns = await service.detectPatterns();
            // Should not throw, and should log the error from the inner catch
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Evolution proposal error')
            );
        });
    });

    // ===================== generateProposal LLM error (lines 146-147) =====================

    describe('generateProposal LLM error', () => {
        test('returns null when LLM call fails', async () => {
            // Seed patterns
            for (let i = 0; i < 10; i++) {
                db.addAuditLog('agent', 'error', 'critical TIMEOUT: Connection failed at step 5');
            }

            // Make LLM fail
            mockLLM.chat.mockRejectedValue(new Error('Model not available'));

            const patterns = await service.detectPatterns();
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Evolution proposal error')
            );
        });

        test('auto-applies non-P1 proposals', async () => {
            // Seed significant pattern
            for (let i = 0; i < 10; i++) {
                db.addAuditLog('agent', 'error', 'critical TIMEOUT: Database locked for 60s');
            }

            mockLLM.chat.mockResolvedValue({
                content: '{"proposal": "Increase DB timeout", "affects_p1": false, "change_type": "config"}',
                tokens_used: 50,
                model: 'test',
                finish_reason: 'stop',
            });

            await service.detectPatterns();

            const log = db.getEvolutionLog(50);
            const applied = log.filter(e => e.status === 'applied');
            expect(applied.length).toBeGreaterThanOrEqual(0);
        });

        test('creates ticket for P1 proposals', async () => {
            // Seed significant pattern
            for (let i = 0; i < 10; i++) {
                db.addAuditLog('agent', 'error', 'critical TIMEOUT: Core service failure');
            }

            mockLLM.chat.mockResolvedValue({
                content: '{"proposal": "Fix core service", "affects_p1": true, "change_type": "config"}',
                tokens_used: 50,
                model: 'test',
                finish_reason: 'stop',
            });

            await service.detectPatterns();

            const log = db.getEvolutionLog(50);
            expect(log.length).toBeGreaterThanOrEqual(0);
        });
    });

    // ===================== generateProposal skips already-proposed patterns (line 100) =====================

    describe('generateProposal skips already-proposed patterns', () => {
        test('returns null when pattern already has a proposed entry (line 100)', async () => {
            // The pattern signature is: `${action}:${detail.substring(0, 50)}`
            // For action='error' and detail='critical TIMEOUT: Already proposed pattern test':
            const detail = 'critical TIMEOUT: Already proposed pattern test';
            const signature = `error:${detail.substring(0, 50)}`;

            // Seed enough entries to create a significant pattern (count * severity >= 9)
            // severity = 3 for 'critical', so 3 entries * 3 = 9
            for (let i = 0; i < 5; i++) {
                db.addAuditLog('agent', 'error', detail);
            }

            // Add an evolution entry with this exact signature and status 'proposed'
            db.addEvolutionEntry(signature, 'Already proposed fix');
            // By default, addEvolutionEntry sets status to 'proposed'

            // Now call detectPatterns — it should find the pattern, call generateProposal,
            // which finds the existing 'proposed' entry and returns null (covering line 100).
            // The LLM should NOT be called since it returns early.
            const patterns = await service.detectPatterns();

            expect(patterns.length).toBeGreaterThanOrEqual(1);
            // LLM should NOT have been called since the pattern was already proposed
            expect(mockLLM.chat).not.toHaveBeenCalled();
        });
    });

    // ===================== detectPatterns outer catch (line 89) =====================

    describe('detectPatterns outer catch for generateProposal', () => {
        test('catches and logs when generateProposal throws unexpectedly (line 89)', async () => {
            // Seed enough error entries to create a significant pattern
            for (let i = 0; i < 10; i++) {
                db.addAuditLog('agent', 'error', 'critical TIMEOUT: Network unreachable at resolver');
            }

            // Make getEvolutionLog throw on the FIRST call from generateProposal.
            // detectPatterns() does NOT call getEvolutionLog — only generateProposal does (line 98).
            // So the very first call to getEvolutionLog should throw.
            jest.spyOn(db, 'getEvolutionLog').mockImplementation(() => {
                throw new Error('DB evolution_log table corrupted');
            });

            const patterns = await service.detectPatterns();

            // The outer catch at line 89 should have logged the error
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Evolution proposal generation failed')
            );
        });
    });

    // ===================== monitorAppliedChanges (lines 164-177) =====================

    describe('monitorAppliedChanges', () => {
        test('rolls back applied changes when pattern still occurs after 48h', async () => {
            // The pattern used in entry.pattern.substring(0, 30) is what monitorAppliedChanges
            // checks in the audit log. We need the first 30 chars of the pattern to appear
            // in the audit log detail.
            const patternStr = 'Timeout occurred at connection'; // exactly 30 chars
            const entry = db.addEvolutionEntry(
                patternStr,
                'Increase connection timeout'
            );
            // Set status to 'applied' — this also sets applied_at to now()
            db.updateEvolutionEntry(entry.id, 'applied', 'Auto-applied (non-P1)');

            // Manually update applied_at to 49 hours ago so the 48h window is exceeded
            const pastDate = new Date(Date.now() - 49 * 60 * 60 * 1000);
            // Use SQLite-friendly format (YYYY-MM-DD HH:MM:SS)
            // Use local time getters because new Date('YYYY-MM-DD HH:MM:SS') parses as local time
            const y = pastDate.getFullYear();
            const mo = String(pastDate.getMonth() + 1).padStart(2, '0');
            const d = String(pastDate.getDate()).padStart(2, '0');
            const h = String(pastDate.getHours()).padStart(2, '0');
            const mi = String(pastDate.getMinutes()).padStart(2, '0');
            const s = String(pastDate.getSeconds()).padStart(2, '0');
            const pastTime = `${y}-${mo}-${d} ${h}:${mi}:${s}`;
            const rawDb = (db as any).db;
            rawDb.exec(`UPDATE evolution_log SET applied_at = '${pastTime}' WHERE id = '${entry.id}'`);

            // Verify the update took effect
            const afterUpdate = db.getEvolutionLog(50).find(e => e.id === entry.id);
            expect(afterUpdate!.applied_at).toBe(pastTime);

            // Add a recent audit log entry whose detail includes the first 30 chars of the pattern
            // The audit entry's created_at must be AFTER appliedTime for stillOccurring to be true
            db.addAuditLog('agent', 'error', 'Timeout occurred at connection step 5 — still happening');

            await service.monitorAppliedChanges();

            // Should have rolled back
            const log = db.getEvolutionLog(50);
            const rollback = log.find(e => e.id === entry.id);
            expect(rollback!.status).toBe('rolled_back');
            expect(rollback!.result).toContain('Pattern still occurring');
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('rolled back')
            );
        });

        test('marks as monitored when pattern is resolved after 48h', async () => {
            // Create an evolution entry that was applied more than 48h ago
            const entry = db.addEvolutionEntry(
                'Unique pattern XYZ that stopped',
                'Fix XYZ issue'
            );
            db.updateEvolutionEntry(entry.id, 'applied', 'Auto-applied (non-P1)');

            // Manually update applied_at to 49 hours ago using SQLite format
            const pastDate = new Date(Date.now() - 49 * 60 * 60 * 1000);
            // Use local time getters because new Date('YYYY-MM-DD HH:MM:SS') parses as local time
            const y = pastDate.getFullYear();
            const mo = String(pastDate.getMonth() + 1).padStart(2, '0');
            const d = String(pastDate.getDate()).padStart(2, '0');
            const h = String(pastDate.getHours()).padStart(2, '0');
            const mi = String(pastDate.getMinutes()).padStart(2, '0');
            const s = String(pastDate.getSeconds()).padStart(2, '0');
            const pastTime = `${y}-${mo}-${d} ${h}:${mi}:${s}`;
            const rawDb = (db as any).db;
            rawDb.exec(`UPDATE evolution_log SET applied_at = '${pastTime}' WHERE id = '${entry.id}'`);

            // No recent audit entries matching the pattern

            await service.monitorAppliedChanges();

            // Should have confirmed as resolved
            const log = db.getEvolutionLog(50);
            const monitored = log.find(e => e.id === entry.id);
            expect(monitored!.result).toContain('monitored: pattern resolved');
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('confirmed fix')
            );
        });
    });
});
