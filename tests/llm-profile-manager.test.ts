import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../src/core/database';
import { EventBus, getEventBus } from '../src/core/event-bus';
import { LLMProfileManager, OutputChannelLike } from '../src/core/llm-profile-manager';
import { LLMProfileType } from '../src/types';

describe('LLMProfileManager', () => {
    let db: Database;
    let tmpDir: string;
    let eventBus: EventBus;
    let outputChannel: OutputChannelLike;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-test-lpm-'));
        db = new Database(tmpDir);
        await db.initialize();
        eventBus = getEventBus();
        outputChannel = { appendLine: jest.fn() };
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ==================== SETUP ====================

    describe('isSetupComplete', () => {
        test('returns false when no profiles exist', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            expect(manager.isSetupComplete()).toBe(false);
        });

        test('returns true when profiles already exist', () => {
            // Seed a profile first
            db.createLLMProfile({
                id: 'pre-existing',
                type: LLMProfileType.Base,
                model_name: 'test-model',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['text_generation'],
                is_active: true,
            });
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            expect(manager.isSetupComplete()).toBe(true);
        });
    });

    describe('markSetupComplete', () => {
        test('marks setup as complete', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            expect(manager.isSetupComplete()).toBe(false);
            manager.markSetupComplete();
            expect(manager.isSetupComplete()).toBe(true);
        });
    });

    // ==================== CREATE ====================

    describe('createProfile', () => {
        test('creates a new profile', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            const profile = manager.createProfile({
                type: LLMProfileType.Base,
                model_name: 'ministral-3-14b',
                endpoint: 'http://192.168.1.205:1234/v1',
                capabilities: ['text_generation', 'code_generation'],
            });
            expect(profile).toBeDefined();
            expect(profile.id).toBeDefined();
            expect(profile.type).toBe(LLMProfileType.Base);
            expect(profile.model_name).toBe('ministral-3-14b');
            expect(profile.endpoint).toBe('http://192.168.1.205:1234/v1');
            expect(profile.capabilities).toContain('text_generation');
            expect(profile.capabilities).toContain('code_generation');
        });

        test('auto-marks setup complete on first profile', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            expect(manager.isSetupComplete()).toBe(false);
            manager.createProfile({
                type: LLMProfileType.Base,
                model_name: 'model-1',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['text_generation'],
            });
            expect(manager.isSetupComplete()).toBe(true);
        });

        test('emits model:profile_created event', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            const emitSpy = jest.spyOn(eventBus, 'emit');
            manager.createProfile({
                type: LLMProfileType.Tool,
                model_name: 'tool-model',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['tool_calling'],
            });
            expect(emitSpy).toHaveBeenCalledWith(
                'model:profile_created',
                'llm-profile-manager',
                expect.objectContaining({
                    type: LLMProfileType.Tool,
                    model_name: 'tool-model',
                })
            );
        });

        test('creates inactive profile by default', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            const profile = manager.createProfile({
                type: LLMProfileType.Vision,
                model_name: 'vision-model',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['vision'],
            });
            expect(profile.is_active).toBe(false);
        });

        test('creates active profile when specified', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            const profile = manager.createProfile({
                type: LLMProfileType.Base,
                model_name: 'base-model',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['text_generation'],
                is_active: true,
            });
            expect(profile.is_active).toBe(true);
        });

        test('logs creation to output channel', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            manager.createProfile({
                type: LLMProfileType.Thinking,
                model_name: 'thinking-model',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['reasoning'],
            });
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Created profile')
            );
        });
    });

    // ==================== GET ALL ====================

    describe('getAllProfiles', () => {
        test('returns empty array when no profiles exist', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            expect(manager.getAllProfiles()).toEqual([]);
        });

        test('returns all created profiles', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            manager.createProfile({
                type: LLMProfileType.Base,
                model_name: 'model-1',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['text_generation'],
            });
            manager.createProfile({
                type: LLMProfileType.Tool,
                model_name: 'model-2',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['tool_calling'],
            });
            const all = manager.getAllProfiles();
            expect(all.length).toBe(2);
        });
    });

    // ==================== GET ACTIVE ====================

    describe('getActiveProfile', () => {
        test('returns null when no active profile', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            expect(manager.getActiveProfile()).toBeNull();
        });

        test('returns the active profile', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            const created = manager.createProfile({
                type: LLMProfileType.Base,
                model_name: 'active-model',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['text_generation'],
                is_active: true,
            });
            const active = manager.getActiveProfile();
            expect(active).not.toBeNull();
            expect(active!.id).toBe(created.id);
        });
    });

    // ==================== GET PROFILE ====================

    describe('getProfile', () => {
        test('returns profile by ID', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            const created = manager.createProfile({
                type: LLMProfileType.AllRounder,
                model_name: 'all-rounder',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['text_generation', 'tool_calling', 'vision'],
            });
            const found = manager.getProfile(created.id);
            expect(found).not.toBeNull();
            expect(found!.type).toBe(LLMProfileType.AllRounder);
        });

        test('returns null for nonexistent profile', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            expect(manager.getProfile('nonexistent-id')).toBeNull();
        });
    });

    // ==================== SWITCH PROFILE ====================

    describe('switchProfile', () => {
        test('activates specified profile', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            const p1 = manager.createProfile({
                type: LLMProfileType.Base,
                model_name: 'model-1',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['text_generation'],
                is_active: true,
            });
            const p2 = manager.createProfile({
                type: LLMProfileType.Tool,
                model_name: 'model-2',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['tool_calling'],
            });

            const result = manager.switchProfile(p2.id);
            expect(result).toBe(true);

            const active = manager.getActiveProfile();
            expect(active).not.toBeNull();
            expect(active!.id).toBe(p2.id);
        });

        test('returns true if already active (no-op)', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            const profile = manager.createProfile({
                type: LLMProfileType.Base,
                model_name: 'model-1',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['text_generation'],
                is_active: true,
            });
            const result = manager.switchProfile(profile.id);
            expect(result).toBe(true);
        });

        test('returns false for nonexistent profile', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            const result = manager.switchProfile('nonexistent-id');
            expect(result).toBe(false);
        });

        test('emits model:profile_switching and model:profile_switched events', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            const p1 = manager.createProfile({
                type: LLMProfileType.Base,
                model_name: 'model-1',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['text_generation'],
                is_active: true,
            });
            const p2 = manager.createProfile({
                type: LLMProfileType.Tool,
                model_name: 'model-2',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['tool_calling'],
            });

            const emitSpy = jest.spyOn(eventBus, 'emit');
            manager.switchProfile(p2.id);

            expect(emitSpy).toHaveBeenCalledWith(
                'model:profile_switching',
                'llm-profile-manager',
                expect.objectContaining({
                    from_profile_id: p1.id,
                    to_profile_id: p2.id,
                })
            );
            expect(emitSpy).toHaveBeenCalledWith(
                'model:profile_switched',
                'llm-profile-manager',
                expect.objectContaining({
                    profile_id: p2.id,
                    type: LLMProfileType.Tool,
                    model_name: 'model-2',
                })
            );
        });
    });

    // ==================== RESOLVE PROFILE FOR CAPABILITY ====================

    describe('resolveProfileForCapability', () => {
        test('returns active profile if it has the capability', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            const profile = manager.createProfile({
                type: LLMProfileType.Base,
                model_name: 'model-1',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['text_generation', 'reasoning'],
                is_active: true,
            });

            const resolved = manager.resolveProfileForCapability('text_generation');
            expect(resolved).not.toBeNull();
            expect(resolved!.id).toBe(profile.id);
        });

        test('returns different profile if active lacks the capability', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            manager.createProfile({
                type: LLMProfileType.Base,
                model_name: 'base-model',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['text_generation'],
                is_active: true,
            });
            const toolProfile = manager.createProfile({
                type: LLMProfileType.Tool,
                model_name: 'tool-model',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['tool_calling'],
            });

            const resolved = manager.resolveProfileForCapability('tool_calling');
            expect(resolved).not.toBeNull();
            expect(resolved!.id).toBe(toolProfile.id);
        });

        test('returns null when no profile has the capability', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            manager.createProfile({
                type: LLMProfileType.Base,
                model_name: 'model-1',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['text_generation'],
                is_active: true,
            });

            const resolved = manager.resolveProfileForCapability('vision');
            expect(resolved).toBeNull();
        });

        test('prefers AllRounder profile when multiple match', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            manager.createProfile({
                type: LLMProfileType.Base,
                model_name: 'base-model',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['text_generation'],
            });
            const allRounder = manager.createProfile({
                type: LLMProfileType.AllRounder,
                model_name: 'all-rounder',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['text_generation', 'tool_calling', 'vision'],
            });
            manager.createProfile({
                type: LLMProfileType.Tool,
                model_name: 'tool-model',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['text_generation', 'tool_calling'],
            });

            const resolved = manager.resolveProfileForCapability('text_generation');
            expect(resolved).not.toBeNull();
            expect(resolved!.id).toBe(allRounder.id);
        });

        test('returns first match when no AllRounder available', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            const first = manager.createProfile({
                type: LLMProfileType.Base,
                model_name: 'base-model',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['code_generation'],
            });
            manager.createProfile({
                type: LLMProfileType.Tool,
                model_name: 'tool-model',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['code_generation'],
            });

            const resolved = manager.resolveProfileForCapability('code_generation');
            expect(resolved).not.toBeNull();
            expect(resolved!.id).toBe(first.id);
        });
    });

    // ==================== UPDATE PROFILE ====================

    describe('updateProfile', () => {
        test('updates model_name', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            const profile = manager.createProfile({
                type: LLMProfileType.Base,
                model_name: 'old-model',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['text_generation'],
            });

            const result = manager.updateProfile(profile.id, { model_name: 'new-model' });
            expect(result).toBe(true);

            const updated = manager.getProfile(profile.id);
            expect(updated!.model_name).toBe('new-model');
        });

        test('updates endpoint', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            const profile = manager.createProfile({
                type: LLMProfileType.Base,
                model_name: 'model-1',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['text_generation'],
            });

            manager.updateProfile(profile.id, { endpoint: 'http://newhost:5678/v1' });
            const updated = manager.getProfile(profile.id);
            expect(updated!.endpoint).toBe('http://newhost:5678/v1');
        });

        test('returns false for nonexistent profile', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            const result = manager.updateProfile('nonexistent', { model_name: 'test' });
            expect(result).toBe(false);
        });

        test('emits model:profile_updated event', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            const profile = manager.createProfile({
                type: LLMProfileType.Base,
                model_name: 'model-1',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['text_generation'],
            });

            const emitSpy = jest.spyOn(eventBus, 'emit');
            manager.updateProfile(profile.id, { model_name: 'updated' });
            expect(emitSpy).toHaveBeenCalledWith(
                'model:profile_updated',
                'llm-profile-manager',
                expect.objectContaining({
                    profile_id: profile.id,
                })
            );
        });
    });

    // ==================== DELETE PROFILE ====================

    describe('deleteProfile', () => {
        test('deletes an inactive profile', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            const profile = manager.createProfile({
                type: LLMProfileType.Tool,
                model_name: 'tool-model',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['tool_calling'],
            });

            const result = manager.deleteProfile(profile.id);
            expect(result).toBe(true);
            expect(manager.getProfile(profile.id)).toBeNull();
        });

        test('refuses to delete active profile', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            const profile = manager.createProfile({
                type: LLMProfileType.Base,
                model_name: 'model-1',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['text_generation'],
                is_active: true,
            });

            const result = manager.deleteProfile(profile.id);
            expect(result).toBe(false);
            expect(manager.getProfile(profile.id)).not.toBeNull();
        });

        test('returns false for nonexistent profile', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            const result = manager.deleteProfile('nonexistent');
            expect(result).toBe(false);
        });

        test('marks setup incomplete when last profile deleted', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            const profile = manager.createProfile({
                type: LLMProfileType.Base,
                model_name: 'only-model',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['text_generation'],
            });
            expect(manager.isSetupComplete()).toBe(true);
            manager.deleteProfile(profile.id);
            expect(manager.isSetupComplete()).toBe(false);
        });
    });

    // ==================== SEED DEFAULT ====================

    describe('seedDefaultProfile', () => {
        test('seeds a default Base profile when none exist', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            manager.seedDefaultProfile('http://192.168.1.205:1234/v1', 'ministral-3-14b');

            const all = manager.getAllProfiles();
            expect(all.length).toBe(1);
            expect(all[0].type).toBe(LLMProfileType.Base);
            expect(all[0].model_name).toBe('ministral-3-14b');
            expect(all[0].is_active).toBe(true);
            expect(all[0].capabilities).toContain('text_generation');
            expect(all[0].capabilities).toContain('code_generation');
            expect(all[0].capabilities).toContain('reasoning');
        });

        test('does not seed if profiles already exist', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            manager.createProfile({
                type: LLMProfileType.Tool,
                model_name: 'existing-model',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['tool_calling'],
            });

            manager.seedDefaultProfile('http://192.168.1.205:1234/v1', 'should-not-exist');
            const all = manager.getAllProfiles();
            expect(all.length).toBe(1);
            expect(all[0].model_name).toBe('existing-model');
        });
    });

    // ==================== END-TO-END SCENARIOS ====================

    describe('end-to-end scenarios', () => {
        test('create → switch → resolve → delete flow', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);

            // Create 2 profiles
            const base = manager.createProfile({
                type: LLMProfileType.Base,
                model_name: 'base-model',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['text_generation'],
                is_active: true,
            });
            const tool = manager.createProfile({
                type: LLMProfileType.Tool,
                model_name: 'tool-model',
                endpoint: 'http://localhost:1234/v1',
                capabilities: ['tool_calling'],
            });

            // Active is base
            expect(manager.getActiveProfile()!.id).toBe(base.id);

            // Resolve text_generation → active base
            expect(manager.resolveProfileForCapability('text_generation')!.id).toBe(base.id);

            // Resolve tool_calling → tool (not active)
            expect(manager.resolveProfileForCapability('tool_calling')!.id).toBe(tool.id);

            // Switch to tool
            manager.switchProfile(tool.id);
            expect(manager.getActiveProfile()!.id).toBe(tool.id);

            // Delete base (now inactive)
            const deleted = manager.deleteProfile(base.id);
            expect(deleted).toBe(true);
            expect(manager.getAllProfiles().length).toBe(1);
        });

        test('all 5 profile types can be created', () => {
            const manager = new LLMProfileManager(db, eventBus, outputChannel);
            const types = [
                LLMProfileType.Base,
                LLMProfileType.Tool,
                LLMProfileType.Vision,
                LLMProfileType.Thinking,
                LLMProfileType.AllRounder,
            ];

            for (const type of types) {
                manager.createProfile({
                    type,
                    model_name: `model-${type}`,
                    endpoint: 'http://localhost:1234/v1',
                    capabilities: [`cap-${type}`],
                });
            }

            expect(manager.getAllProfiles().length).toBe(5);
        });
    });
});
