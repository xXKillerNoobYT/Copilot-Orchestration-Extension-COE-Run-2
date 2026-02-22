/**
 * UserProfileManager — v9.0 User Profile System
 *
 * Manages user profile, programming level, per-area preferences,
 * repeat answers, and communication style. Dual storage: SQLite + VS Code settings.
 *
 * The UserCommAgent uses the profile to tailor all messages sent to the user.
 * Empty/unfilled sections are treated as "unknown" (lean toward research).
 */

import { Database } from './database';
import {
    UserProfile,
    UserProgrammingLevel,
    UserPreferenceAction,
} from '../types';

/** Default profile for new users */
const DEFAULT_PROFILE: Omit<UserProfile, 'id' | 'created_at' | 'updated_at'> = {
    programming_level: UserProgrammingLevel.GettingAround,
    strengths: [],
    weaknesses: [],
    known_areas: [],
    unknown_areas: [],
    area_preferences: {},
    repeat_answers: {},
    communication_style: 'balanced',
    notes: '',
};

export class UserProfileManager {
    private cachedProfile: UserProfile | null = null;

    constructor(private readonly database: Database) {}

    // ==================== CORE PROFILE ====================

    /**
     * Get the current user profile.
     * Creates a default profile if none exists.
     */
    getProfile(): UserProfile {
        if (this.cachedProfile) return this.cachedProfile;

        let profile = this.database.getDefaultUserProfile();
        if (!profile) {
            profile = this.initializeProfile();
        }
        this.cachedProfile = profile;
        return profile;
    }

    /**
     * Initialize a new default profile (first run).
     * Tries to pull from VS Code settings first.
     */
    initializeProfile(): UserProfile {
        let savedProfile: Partial<UserProfile> | undefined;
        try {
            const vscode = require('vscode');
            const config = vscode.workspace.getConfiguration('coe');
            savedProfile = config.get('userProfile') as Partial<UserProfile> | undefined;
        } catch {
            // Not running in VS Code — skip settings lookup
        }

        const profile = this.database.createUserProfile({
            programming_level: savedProfile?.programming_level ?? DEFAULT_PROFILE.programming_level,
            strengths: savedProfile?.strengths ?? DEFAULT_PROFILE.strengths,
            weaknesses: savedProfile?.weaknesses ?? DEFAULT_PROFILE.weaknesses,
            known_areas: savedProfile?.known_areas ?? DEFAULT_PROFILE.known_areas,
            unknown_areas: savedProfile?.unknown_areas ?? DEFAULT_PROFILE.unknown_areas,
            area_preferences: savedProfile?.area_preferences ?? DEFAULT_PROFILE.area_preferences,
            repeat_answers: savedProfile?.repeat_answers ?? DEFAULT_PROFILE.repeat_answers,
            communication_style: savedProfile?.communication_style ?? DEFAULT_PROFILE.communication_style,
            notes: savedProfile?.notes ?? DEFAULT_PROFILE.notes,
        });

        this.cachedProfile = profile;
        return profile;
    }

    /**
     * Update the user profile with partial changes.
     * Syncs to both SQLite and VS Code settings.
     */
    updateProfile(updates: Partial<UserProfile>): UserProfile {
        const current = this.getProfile();
        this.database.updateUserProfile(current.id, updates);
        const updated = this.database.getUserProfile(current.id)!;
        this.cachedProfile = updated;
        this.syncToVSCodeSettings(updated);
        return updated;
    }

    // ==================== PROGRAMMING LEVEL ====================

    /**
     * Get the user's programming proficiency level.
     */
    getProgrammingLevel(): UserProgrammingLevel {
        return this.getProfile().programming_level;
    }

    /**
     * Set the user's programming proficiency level.
     */
    setProgrammingLevel(level: UserProgrammingLevel): UserProfile {
        return this.updateProfile({ programming_level: level });
    }

    // ==================== STRENGTHS & WEAKNESSES ====================

    /**
     * Add a strength area.
     */
    addStrength(area: string): UserProfile {
        const profile = this.getProfile();
        const normalized = area.toLowerCase().trim();
        if (profile.strengths.includes(normalized)) return profile;
        const strengths = [...profile.strengths, normalized];
        // If adding as strength, remove from weaknesses
        const weaknesses = profile.weaknesses.filter(w => w !== normalized);
        return this.updateProfile({ strengths, weaknesses });
    }

    /**
     * Remove a strength area.
     */
    removeStrength(area: string): UserProfile {
        const profile = this.getProfile();
        const normalized = area.toLowerCase().trim();
        const strengths = profile.strengths.filter(s => s !== normalized);
        return this.updateProfile({ strengths });
    }

    /**
     * Add a weakness area.
     */
    addWeakness(area: string): UserProfile {
        const profile = this.getProfile();
        const normalized = area.toLowerCase().trim();
        if (profile.weaknesses.includes(normalized)) return profile;
        const weaknesses = [...profile.weaknesses, normalized];
        // If adding as weakness, remove from strengths
        const strengths = profile.strengths.filter(s => s !== normalized);
        return this.updateProfile({ weaknesses, strengths });
    }

    /**
     * Remove a weakness area.
     */
    removeWeakness(area: string): UserProfile {
        const profile = this.getProfile();
        const normalized = area.toLowerCase().trim();
        const weaknesses = profile.weaknesses.filter(w => w !== normalized);
        return this.updateProfile({ weaknesses });
    }

    // ==================== KNOWN/UNKNOWN AREAS ====================

    /**
     * Add a known area.
     */
    addKnownArea(area: string): UserProfile {
        const profile = this.getProfile();
        const normalized = area.toLowerCase().trim();
        if (profile.known_areas.includes(normalized)) return profile;
        const known_areas = [...profile.known_areas, normalized];
        const unknown_areas = profile.unknown_areas.filter(u => u !== normalized);
        return this.updateProfile({ known_areas, unknown_areas });
    }

    /**
     * Remove a known area.
     */
    removeKnownArea(area: string): UserProfile {
        const profile = this.getProfile();
        const normalized = area.toLowerCase().trim();
        const known_areas = profile.known_areas.filter(k => k !== normalized);
        return this.updateProfile({ known_areas });
    }

    /**
     * Add an unknown area.
     */
    addUnknownArea(area: string): UserProfile {
        const profile = this.getProfile();
        const normalized = area.toLowerCase().trim();
        if (profile.unknown_areas.includes(normalized)) return profile;
        const unknown_areas = [...profile.unknown_areas, normalized];
        const known_areas = profile.known_areas.filter(k => k !== normalized);
        return this.updateProfile({ unknown_areas, known_areas });
    }

    /**
     * Remove an unknown area.
     */
    removeUnknownArea(area: string): UserProfile {
        const profile = this.getProfile();
        const normalized = area.toLowerCase().trim();
        const unknown_areas = profile.unknown_areas.filter(u => u !== normalized);
        return this.updateProfile({ unknown_areas });
    }

    // ==================== AREA PREFERENCES ====================

    /**
     * Set the preference action for a specific area.
     */
    setAreaPreference(area: string, action: UserPreferenceAction): UserProfile {
        const profile = this.getProfile();
        const normalized = area.toLowerCase().trim();
        const area_preferences = { ...profile.area_preferences, [normalized]: action };
        return this.updateProfile({ area_preferences });
    }

    /**
     * Get the preference action for a specific area.
     * Returns null if no preference is set (system should lean toward 'ask_me').
     */
    getPreferenceForArea(area: string): UserPreferenceAction | null {
        const profile = this.getProfile();
        const normalized = area.toLowerCase().trim();
        return profile.area_preferences[normalized] ?? null;
    }

    /**
     * Remove the preference for a specific area.
     */
    removeAreaPreference(area: string): UserProfile {
        const profile = this.getProfile();
        const normalized = area.toLowerCase().trim();
        const area_preferences = { ...profile.area_preferences };
        delete area_preferences[normalized];
        return this.updateProfile({ area_preferences });
    }

    /**
     * Get all area preferences.
     */
    getAllAreaPreferences(): Record<string, UserPreferenceAction> {
        return { ...this.getProfile().area_preferences };
    }

    // ==================== REPEAT ANSWERS ====================

    /**
     * Add/update a cached repeat answer for a topic.
     * When a user answers the same type of question repeatedly,
     * the system caches the answer to avoid asking again.
     */
    addRepeatAnswer(topic: string, answer: string): UserProfile {
        const profile = this.getProfile();
        const normalized = topic.toLowerCase().trim();
        const repeat_answers = { ...profile.repeat_answers, [normalized]: answer };
        return this.updateProfile({ repeat_answers });
    }

    /**
     * Get a cached repeat answer for a topic.
     * Returns null if no cached answer exists.
     */
    getRepeatAnswer(topic: string): string | null {
        const profile = this.getProfile();
        const normalized = topic.toLowerCase().trim();
        return profile.repeat_answers[normalized] ?? null;
    }

    /**
     * Remove a cached repeat answer.
     */
    removeRepeatAnswer(topic: string): UserProfile {
        const profile = this.getProfile();
        const normalized = topic.toLowerCase().trim();
        const repeat_answers = { ...profile.repeat_answers };
        delete repeat_answers[normalized];
        return this.updateProfile({ repeat_answers });
    }

    /**
     * Get all repeat answers.
     */
    getAllRepeatAnswers(): Record<string, string> {
        return { ...this.getProfile().repeat_answers };
    }

    // ==================== COMMUNICATION STYLE ====================

    /**
     * Set the communication style.
     */
    setCommunicationStyle(style: 'technical' | 'simple' | 'balanced'): UserProfile {
        return this.updateProfile({ communication_style: style });
    }

    /**
     * Get the communication style.
     */
    getCommunicationStyle(): 'technical' | 'simple' | 'balanced' {
        return this.getProfile().communication_style;
    }

    // ==================== NOTES ====================

    /**
     * Set free-form notes.
     */
    setNotes(notes: string): UserProfile {
        return this.updateProfile({ notes });
    }

    /**
     * Get free-form notes.
     */
    getNotes(): string {
        return this.getProfile().notes;
    }

    // ==================== INTELLIGENCE HELPERS ====================

    /**
     * Check if an area is known by the user.
     * An area is "known" if it's in known_areas or strengths.
     */
    isAreaKnown(area: string): boolean {
        const profile = this.getProfile();
        const normalized = area.toLowerCase().trim();
        return profile.known_areas.includes(normalized) ||
               profile.strengths.includes(normalized);
    }

    /**
     * Check if an area is unknown to the user.
     * An area is "unknown" if it's in unknown_areas, weaknesses,
     * or if it's not mentioned anywhere (default to unknown → lean toward research).
     */
    isAreaUnknown(area: string): boolean {
        const profile = this.getProfile();
        const normalized = area.toLowerCase().trim();

        // Explicitly unknown or weak
        if (profile.unknown_areas.includes(normalized) ||
            profile.weaknesses.includes(normalized)) {
            return true;
        }

        // Not mentioned anywhere → treat as unknown
        if (!profile.known_areas.includes(normalized) &&
            !profile.strengths.includes(normalized)) {
            return true;
        }

        return false;
    }

    /**
     * Check if the system should auto-decide for this area.
     */
    shouldAutoDecide(area: string): boolean {
        const pref = this.getPreferenceForArea(area);
        return pref === UserPreferenceAction.AlwaysDecide;
    }

    /**
     * Check if the system should never touch this area.
     */
    shouldNeverTouch(area: string): boolean {
        const pref = this.getPreferenceForArea(area);
        return pref === UserPreferenceAction.NeverTouch;
    }

    /**
     * Build a context summary for the UserCommAgent system prompt.
     * Includes all profile info relevant for message rewriting.
     */
    buildContextSummary(): string {
        const profile = this.getProfile();
        const lines: string[] = [];

        lines.push(`Programming Level: ${profile.programming_level}`);
        lines.push(`Communication Style: ${profile.communication_style}`);

        if (profile.strengths.length > 0) {
            lines.push(`Strengths: ${profile.strengths.join(', ')}`);
        }
        if (profile.weaknesses.length > 0) {
            lines.push(`Weaknesses: ${profile.weaknesses.join(', ')}`);
        }
        if (profile.known_areas.length > 0) {
            lines.push(`Known Areas: ${profile.known_areas.join(', ')}`);
        }
        if (profile.unknown_areas.length > 0) {
            lines.push(`Unknown Areas: ${profile.unknown_areas.join(', ')}`);
        }

        const prefs = Object.entries(profile.area_preferences);
        if (prefs.length > 0) {
            const alwaysDecide = prefs.filter(([, v]) => v === UserPreferenceAction.AlwaysDecide).map(([k]) => k);
            const neverTouch = prefs.filter(([, v]) => v === UserPreferenceAction.NeverTouch).map(([k]) => k);
            const alwaysRecommend = prefs.filter(([, v]) => v === UserPreferenceAction.AlwaysRecommend).map(([k]) => k);
            if (alwaysDecide.length > 0) lines.push(`Always Decide: ${alwaysDecide.join(', ')}`);
            if (neverTouch.length > 0) lines.push(`Never Touch: ${neverTouch.join(', ')}`);
            if (alwaysRecommend.length > 0) lines.push(`Always Recommend: ${alwaysRecommend.join(', ')}`);
        }

        if (profile.notes) {
            lines.push(`Notes: ${profile.notes}`);
        }

        return lines.join('\n');
    }

    // ==================== EXPORT/IMPORT ====================

    /**
     * Export profile as JSON.
     */
    exportProfile(): string {
        const profile = this.getProfile();
        const { id: _id, created_at: _ca, updated_at: _ua, ...rest } = profile;
        return JSON.stringify(rest, null, 2);
    }

    /**
     * Import profile from JSON, merging with current profile.
     */
    importProfile(json: string): UserProfile {
        const data = JSON.parse(json) as Partial<UserProfile>;
        // Sanitize: remove id and timestamps
        delete data.id;
        delete data.created_at;
        delete data.updated_at;
        return this.updateProfile(data);
    }

    // ==================== VS CODE SETTINGS SYNC ====================

    /**
     * Sync the profile to VS Code workspace settings for persistence
     * outside the SQLite database.
     */
    private syncToVSCodeSettings(profile: UserProfile): void {
        try {
            const vscode = require('vscode');
            const config = vscode.workspace.getConfiguration('coe');
            const { id: _id, created_at: _ca, updated_at: _ua, ...rest } = profile;
            config.update('userProfile', rest, vscode.ConfigurationTarget.Global);
        } catch {
            // Non-critical — VS Code settings sync is best-effort / not in VS Code
        }
    }

    /**
     * Invalidate the cached profile (e.g., after external DB change).
     */
    invalidateCache(): void {
        this.cachedProfile = null;
    }
}
