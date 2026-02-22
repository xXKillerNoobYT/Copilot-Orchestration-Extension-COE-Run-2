/**
 * LLMProfileManager — v10.0 Multi-Model Profile System
 *
 * Manages 5 LLM profile types: Base, Tool, Vision, Thinking, All-rounder.
 * Only one model is loaded at a time (single-model constraint from LM Studio).
 *
 * Profile resolution chain:
 *   1. Agent requests a capability (e.g., 'tool_calling')
 *   2. ProfileManager finds profiles matching that capability
 *   3. If active profile already matches → use it (no switch needed)
 *   4. If different profile needed → queue switch → drain current queue → load new model
 *   5. Return the resolved profile for the request
 *
 * Wire in: extension.ts after database initialization.
 */

import { Database } from './database';
import { EventBus } from './event-bus';
import { LLMProfile, LLMProfileType } from '../types';
import { randomUUID } from 'crypto';

export interface OutputChannelLike {
    appendLine(msg: string): void;
}

export class LLMProfileManager {
    private setupComplete = false;

    constructor(
        private database: Database,
        private eventBus: EventBus,
        private outputChannel: OutputChannelLike
    ) {
        // Check if any profiles exist (setup complete if at least one profile)
        const profiles = this.database.getAllLLMProfiles();
        this.setupComplete = profiles.length > 0;
    }

    /**
     * Whether the user has completed initial profile setup.
     */
    isSetupComplete(): boolean {
        return this.setupComplete;
    }

    /**
     * Mark setup as complete (called after first profile is created).
     */
    markSetupComplete(): void {
        this.setupComplete = true;
    }

    /**
     * Create a new LLM profile.
     */
    createProfile(data: {
        type: LLMProfileType;
        model_name: string;
        endpoint: string;
        capabilities: string[];
        is_active?: boolean;
    }): LLMProfile {
        const id = randomUUID();
        const profile = this.database.createLLMProfile({
            id,
            type: data.type,
            model_name: data.model_name,
            endpoint: data.endpoint,
            capabilities: data.capabilities,
            is_active: data.is_active ?? false,
        });

        if (!this.setupComplete) {
            this.setupComplete = true;
        }

        this.outputChannel.appendLine(
            `[LLMProfileManager] Created profile: ${data.type} (${data.model_name})`
        );

        this.eventBus.emit('model:profile_created', 'llm-profile-manager', {
            profile_id: id,
            type: data.type,
            model_name: data.model_name,
        });

        return profile;
    }

    /**
     * Get all profiles.
     */
    getAllProfiles(): LLMProfile[] {
        return this.database.getAllLLMProfiles();
    }

    /**
     * Get the currently active profile.
     */
    getActiveProfile(): LLMProfile | null {
        return this.database.getActiveLLMProfile();
    }

    /**
     * Get a specific profile by ID.
     */
    getProfile(id: string): LLMProfile | null {
        return this.database.getLLMProfile(id);
    }

    /**
     * Switch the active model profile.
     * Deactivates all profiles, then activates the specified one.
     * Emits model switching events.
     */
    switchProfile(profileId: string): boolean {
        const profile = this.database.getLLMProfile(profileId);
        if (!profile) {
            this.outputChannel.appendLine(
                `[LLMProfileManager] Cannot switch — profile ${profileId} not found`
            );
            return false;
        }

        const currentActive = this.database.getActiveLLMProfile();
        if (currentActive?.id === profileId) {
            // Already active — no switch needed
            return true;
        }

        this.eventBus.emit('model:profile_switching', 'llm-profile-manager', {
            from_profile_id: currentActive?.id ?? null,
            to_profile_id: profileId,
            model_name: profile.model_name,
        });

        this.database.setActiveLLMProfile(profileId);

        this.outputChannel.appendLine(
            `[LLMProfileManager] Switched active profile: ${profile.type} (${profile.model_name})`
        );

        this.eventBus.emit('model:profile_switched', 'llm-profile-manager', {
            profile_id: profileId,
            type: profile.type,
            model_name: profile.model_name,
            endpoint: profile.endpoint,
        });

        return true;
    }

    /**
     * Find the best profile for a given capability requirement.
     * Returns the active profile if it has the capability, otherwise finds the best match.
     */
    resolveProfileForCapability(capability: string): LLMProfile | null {
        // First check if active profile has the capability
        const active = this.database.getActiveLLMProfile();
        if (active && active.capabilities.includes(capability)) {
            return active;
        }

        // Find all profiles with this capability
        const allProfiles = this.database.getAllLLMProfiles();
        const matching = allProfiles.filter(p => p.capabilities.includes(capability));

        if (matching.length === 0) {
            this.outputChannel.appendLine(
                `[LLMProfileManager] No profile found with capability: ${capability}`
            );
            return null;
        }

        // Prefer 'all_rounder' type if available, otherwise take the first match
        const allRounder = matching.find(p => p.type === LLMProfileType.AllRounder);
        return allRounder ?? matching[0];
    }

    /**
     * Update an existing profile's properties.
     */
    updateProfile(id: string, updates: Partial<Pick<LLMProfile, 'model_name' | 'endpoint' | 'capabilities' | 'type'>>): boolean {
        const existing = this.database.getLLMProfile(id);
        if (!existing) return false;

        this.database.updateLLMProfile(id, updates);

        this.outputChannel.appendLine(
            `[LLMProfileManager] Updated profile ${id}`
        );

        this.eventBus.emit('model:profile_updated', 'llm-profile-manager', {
            profile_id: id,
            updates: Object.keys(updates),
        });

        return true;
    }

    /**
     * Delete a profile.
     */
    deleteProfile(id: string): boolean {
        const existing = this.database.getLLMProfile(id);
        if (!existing) return false;

        if (existing.is_active) {
            this.outputChannel.appendLine(
                `[LLMProfileManager] Cannot delete active profile ${id} — switch to another first`
            );
            return false;
        }

        this.database.deleteLLMProfile(id);

        this.outputChannel.appendLine(
            `[LLMProfileManager] Deleted profile ${id} (${existing.type})`
        );

        // Check if any profiles remain
        const remaining = this.database.getAllLLMProfiles();
        if (remaining.length === 0) {
            this.setupComplete = false;
        }

        return true;
    }

    /**
     * Seed default profiles from config.
     * Creates a Base profile using the current LLM config if no profiles exist.
     */
    seedDefaultProfile(endpoint: string, modelName: string): void {
        if (this.database.getAllLLMProfiles().length > 0) return;

        this.createProfile({
            type: LLMProfileType.Base,
            model_name: modelName,
            endpoint,
            capabilities: ['text_generation', 'code_generation', 'reasoning'],
            is_active: true,
        });

        this.outputChannel.appendLine(
            `[LLMProfileManager] Seeded default Base profile: ${modelName}`
        );
    }
}
