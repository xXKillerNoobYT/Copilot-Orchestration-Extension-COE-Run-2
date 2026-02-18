jest.mock('vscode', () => ({
    workspace: {
        getConfiguration: jest.fn(() => ({
            get: jest.fn(() => null),
            update: jest.fn(),
        })),
    },
    ConfigurationTarget: { Global: 1 },
}));

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../src/core/database';
import { UserProfileManager } from '../src/core/user-profile-manager';
import { UserProgrammingLevel, UserPreferenceAction } from '../src/types';

describe('UserProfileManager', () => {
    let db: Database;
    let tmpDir: string;
    let manager: UserProfileManager;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-test-'));
        db = new Database(tmpDir);
        await db.initialize();
        manager = new UserProfileManager(db);
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ==================== getProfile ====================

    describe('getProfile', () => {
        test('returns default profile on first call', () => {
            const profile = manager.getProfile();
            expect(profile).toBeDefined();
            expect(profile.id).toBeDefined();
            expect(profile.strengths).toEqual([]);
            expect(profile.weaknesses).toEqual([]);
            expect(profile.known_areas).toEqual([]);
            expect(profile.unknown_areas).toEqual([]);
            expect(profile.area_preferences).toEqual({});
            expect(profile.repeat_answers).toEqual({});
            expect(profile.communication_style).toBe('balanced');
            expect(profile.notes).toBe('');
        });

        test('returns cached profile on subsequent calls', () => {
            const first = manager.getProfile();
            const second = manager.getProfile();
            // Should be the exact same cached object reference
            expect(first).toBe(second);
            expect(first.id).toBe(second.id);
        });
    });

    // ==================== updateProfile ====================

    describe('updateProfile', () => {
        test('updates fields', () => {
            const updated = manager.updateProfile({ notes: 'My notes', communication_style: 'technical' });
            expect(updated.notes).toBe('My notes');
            expect(updated.communication_style).toBe('technical');
        });
    });

    // ==================== setProgrammingLevel / getProgrammingLevel ====================

    describe('setProgrammingLevel', () => {
        test('sets level', () => {
            manager.setProgrammingLevel(UserProgrammingLevel.Expert);
            expect(manager.getProgrammingLevel()).toBe(UserProgrammingLevel.Expert);
        });
    });

    describe('getProgrammingLevel', () => {
        test('returns current level', () => {
            const level = manager.getProgrammingLevel();
            expect(Object.values(UserProgrammingLevel)).toContain(level);
        });
    });

    // ==================== addStrength ====================

    describe('addStrength', () => {
        test('adds area to strengths', () => {
            const profile = manager.addStrength('TypeScript');
            expect(profile.strengths).toContain('typescript');
        });

        test('removes from weaknesses when adding to strengths', () => {
            manager.addWeakness('CSS');
            const profile = manager.addStrength('CSS');
            expect(profile.strengths).toContain('css');
            expect(profile.weaknesses).not.toContain('css');
        });

        test('deduplicates', () => {
            manager.addStrength('TypeScript');
            const profile = manager.addStrength('TypeScript');
            const count = profile.strengths.filter(s => s === 'typescript').length;
            expect(count).toBe(1);
        });
    });

    // ==================== removeStrength ====================

    describe('removeStrength', () => {
        test('removes area', () => {
            manager.addStrength('TypeScript');
            const profile = manager.removeStrength('TypeScript');
            expect(profile.strengths).not.toContain('typescript');
        });
    });

    // ==================== addWeakness ====================

    describe('addWeakness', () => {
        test('adds area, removes from strengths', () => {
            manager.addStrength('React');
            const profile = manager.addWeakness('React');
            expect(profile.weaknesses).toContain('react');
            expect(profile.strengths).not.toContain('react');
        });
    });

    // ==================== addKnownArea ====================

    describe('addKnownArea', () => {
        test('adds area, removes from unknown', () => {
            manager.addUnknownArea('Docker');
            const profile = manager.addKnownArea('Docker');
            expect(profile.known_areas).toContain('docker');
            expect(profile.unknown_areas).not.toContain('docker');
        });
    });

    // ==================== addUnknownArea ====================

    describe('addUnknownArea', () => {
        test('adds area, removes from known', () => {
            manager.addKnownArea('Kubernetes');
            const profile = manager.addUnknownArea('Kubernetes');
            expect(profile.unknown_areas).toContain('kubernetes');
            expect(profile.known_areas).not.toContain('kubernetes');
        });
    });

    // ==================== setAreaPreference / getPreferenceForArea ====================

    describe('setAreaPreference', () => {
        test('sets preference for area', () => {
            manager.setAreaPreference('database', UserPreferenceAction.AlwaysDecide);
            const pref = manager.getPreferenceForArea('database');
            expect(pref).toBe(UserPreferenceAction.AlwaysDecide);
        });
    });

    describe('getPreferenceForArea', () => {
        test('returns null for unset area', () => {
            const pref = manager.getPreferenceForArea('nonexistent');
            expect(pref).toBeNull();
        });
    });

    // ==================== removeAreaPreference ====================

    describe('removeAreaPreference', () => {
        test('removes preference', () => {
            manager.setAreaPreference('database', UserPreferenceAction.AlwaysDecide);
            manager.removeAreaPreference('database');
            const pref = manager.getPreferenceForArea('database');
            expect(pref).toBeNull();
        });
    });

    // ==================== addRepeatAnswer / getRepeatAnswer ====================

    describe('addRepeatAnswer', () => {
        test('stores answer', () => {
            manager.addRepeatAnswer('preferred framework', 'React');
            const answer = manager.getRepeatAnswer('preferred framework');
            expect(answer).toBe('React');
        });
    });

    describe('getRepeatAnswer', () => {
        test('returns stored answer', () => {
            manager.addRepeatAnswer('orm', 'Prisma');
            expect(manager.getRepeatAnswer('orm')).toBe('Prisma');
        });

        test('returns null for unknown topic', () => {
            const answer = manager.getRepeatAnswer('nonexistent topic');
            expect(answer).toBeNull();
        });
    });

    // ==================== removeRepeatAnswer ====================

    describe('removeRepeatAnswer', () => {
        test('removes answer', () => {
            manager.addRepeatAnswer('preferred framework', 'React');
            manager.removeRepeatAnswer('preferred framework');
            const answer = manager.getRepeatAnswer('preferred framework');
            expect(answer).toBeNull();
        });
    });

    // ==================== isAreaKnown / isAreaUnknown ====================

    describe('isAreaKnown / isAreaUnknown', () => {
        test('isAreaKnown returns true for known areas', () => {
            manager.addKnownArea('TypeScript');
            expect(manager.isAreaKnown('TypeScript')).toBe(true);
        });

        test('isAreaKnown returns true for strengths', () => {
            manager.addStrength('React');
            expect(manager.isAreaKnown('React')).toBe(true);
        });

        test('isAreaKnown returns false for unmentioned areas', () => {
            expect(manager.isAreaKnown('quantum-computing')).toBe(false);
        });

        test('isAreaUnknown returns true for explicitly unknown areas', () => {
            manager.addUnknownArea('Rust');
            expect(manager.isAreaUnknown('Rust')).toBe(true);
        });

        test('isAreaUnknown returns true for weaknesses', () => {
            manager.addWeakness('Assembly');
            expect(manager.isAreaUnknown('Assembly')).toBe(true);
        });

        test('isAreaUnknown returns true for unmentioned areas (default to unknown)', () => {
            expect(manager.isAreaUnknown('blockchain')).toBe(true);
        });

        test('isAreaUnknown returns false for known areas', () => {
            manager.addKnownArea('TypeScript');
            expect(manager.isAreaUnknown('TypeScript')).toBe(false);
        });
    });

    // ==================== shouldAutoDecide / shouldNeverTouch ====================

    describe('shouldAutoDecide / shouldNeverTouch', () => {
        test('shouldAutoDecide returns true when preference is AlwaysDecide', () => {
            manager.setAreaPreference('database', UserPreferenceAction.AlwaysDecide);
            expect(manager.shouldAutoDecide('database')).toBe(true);
        });

        test('shouldAutoDecide returns false for other preferences', () => {
            manager.setAreaPreference('database', UserPreferenceAction.AskMe);
            expect(manager.shouldAutoDecide('database')).toBe(false);
        });

        test('shouldAutoDecide returns false for unset area', () => {
            expect(manager.shouldAutoDecide('unknown')).toBe(false);
        });

        test('shouldNeverTouch returns true when preference is NeverTouch', () => {
            manager.setAreaPreference('security', UserPreferenceAction.NeverTouch);
            expect(manager.shouldNeverTouch('security')).toBe(true);
        });

        test('shouldNeverTouch returns false for other preferences', () => {
            manager.setAreaPreference('security', UserPreferenceAction.AlwaysRecommend);
            expect(manager.shouldNeverTouch('security')).toBe(false);
        });
    });

    // ==================== buildContextSummary ====================

    describe('buildContextSummary', () => {
        test('returns formatted string', () => {
            manager.setProgrammingLevel(UserProgrammingLevel.Expert);
            manager.addStrength('TypeScript');
            manager.addWeakness('CSS');
            manager.addKnownArea('React');
            manager.addUnknownArea('Rust');
            manager.setAreaPreference('database', UserPreferenceAction.AlwaysDecide);
            manager.setAreaPreference('security', UserPreferenceAction.NeverTouch);
            manager.updateProfile({ notes: 'Prefers dark mode' });

            const summary = manager.buildContextSummary();
            expect(summary).toContain('Programming Level:');
            expect(summary).toContain('Communication Style: balanced');
            expect(summary).toContain('Strengths: typescript');
            expect(summary).toContain('Weaknesses: css');
            expect(summary).toContain('Known Areas: react');
            expect(summary).toContain('Unknown Areas: rust');
            expect(summary).toContain('Always Decide: database');
            expect(summary).toContain('Never Touch: security');
            expect(summary).toContain('Notes: Prefers dark mode');
        });
    });

    // ==================== exportProfile ====================

    describe('exportProfile', () => {
        test('returns JSON without id/timestamps', () => {
            manager.setProgrammingLevel(UserProgrammingLevel.Good);
            manager.addStrength('TypeScript');

            const json = manager.exportProfile();
            const parsed = JSON.parse(json);
            expect(parsed.id).toBeUndefined();
            expect(parsed.created_at).toBeUndefined();
            expect(parsed.updated_at).toBeUndefined();
            expect(parsed.programming_level).toBe(UserProgrammingLevel.Good);
            expect(parsed.strengths).toContain('typescript');
        });
    });

    // ==================== importProfile ====================

    describe('importProfile', () => {
        test('merges with current', () => {
            manager.addStrength('TypeScript');

            const importData = {
                weaknesses: ['css'],
                notes: 'Imported profile',
            };
            const imported = manager.importProfile(JSON.stringify(importData));
            expect(imported.weaknesses).toContain('css');
            expect(imported.notes).toBe('Imported profile');
        });

        test('sanitizes injected id and timestamps', () => {
            const json = JSON.stringify({
                id: 'injected-id',
                created_at: 'injected-date',
                updated_at: 'injected-date',
                programming_level: UserProgrammingLevel.Expert,
            });
            const imported = manager.importProfile(json);
            expect(imported.id).not.toBe('injected-id');
            expect(imported.programming_level).toBe(UserProgrammingLevel.Expert);
        });
    });

    // ==================== invalidateCache ====================

    describe('invalidateCache', () => {
        test('forces re-read from DB', () => {
            const first = manager.getProfile();
            manager.invalidateCache();
            const second = manager.getProfile();
            // After invalidation the cached object reference should differ
            expect(first).not.toBe(second);
            // But the data should be the same
            expect(first.id).toBe(second.id);
        });
    });
});
