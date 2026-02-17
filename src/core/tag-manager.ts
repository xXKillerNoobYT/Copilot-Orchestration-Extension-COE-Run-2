/**
 * TagManagerService — Element tagging system (v8.0)
 *
 * Provides pre-defined + custom tags for classifying design elements.
 *
 * Built-in tags (cannot be deleted):
 *   - setting (blue): Configuration values
 *   - automatic (purple): Auto-managed values
 *   - hardcoded (red): Hardcoded magic values
 *   - env-variable (yellow): Environment-dependent values
 *   - feature-flag (orange): Feature-toggle controlled values
 *
 * Tags can be assigned to any element type: pages, components, backend elements, data models.
 * Color-coded display in the UI.
 */

import { Database } from './database';
import { EventBus } from './event-bus';
import { TagDefinition, ElementTag } from '../types';

export interface OutputChannelLike {
    appendLine(msg: string): void;
}

export class TagManagerService {
    constructor(
        private database: Database,
        private eventBus: EventBus,
        private outputChannel: OutputChannelLike
    ) {}

    // ==================== SEEDING ====================

    /**
     * Seed the 5 built-in tags if they don't already exist.
     * Called during extension activation.
     */
    seedBuiltinTags(planId?: string): void {
        this.database.seedBuiltinTags(planId);
        this.outputChannel.appendLine('[TagManager] Built-in tags seeded');
    }

    // ==================== CRUD ====================

    /**
     * Create a custom tag.
     */
    createTag(data: {
        plan_id?: string | null;
        name: string;
        color: TagDefinition['color'];
        custom_color?: string;
        description?: string;
    }): TagDefinition {
        const tag = this.database.createTagDefinition({
            plan_id: data.plan_id ?? undefined,
            name: data.name,
            color: data.color,
            custom_color: data.custom_color || undefined,
            is_builtin: false,
            description: data.description || '',
        });

        this.eventBus.emit('tag:created', 'tag-manager', {
            id: tag.id,
            name: tag.name,
            color: tag.color,
        });

        this.outputChannel.appendLine(`[TagManager] Tag created: "${tag.name}" (${tag.color})`);
        return tag;
    }

    /**
     * Get all tag definitions, optionally filtered by plan.
     */
    getTagDefinitions(planId?: string): TagDefinition[] {
        return this.database.getTagDefinitions(planId);
    }

    /**
     * Get a single tag definition by ID.
     */
    getTag(tagId: string): TagDefinition | null {
        return this.database.getTagDefinition(tagId);
    }

    /**
     * Delete a tag. Blocks deletion of built-in tags.
     */
    deleteTag(tagId: string): boolean {
        const tag = this.database.getTagDefinition(tagId);
        if (!tag) { return false; }

        if (tag.is_builtin) {
            this.outputChannel.appendLine(`[TagManager] Cannot delete built-in tag: "${tag.name}"`);
            return false;
        }

        const deleted = this.database.deleteTagDefinition(tagId);
        if (deleted) {
            this.eventBus.emit('tag:deleted', 'tag-manager', {
                id: tagId,
                name: tag.name,
            });
            this.outputChannel.appendLine(`[TagManager] Tag deleted: "${tag.name}"`);
        }
        return deleted;
    }

    // ==================== ASSIGNMENT ====================

    /**
     * Assign a tag to an element.
     */
    assignTag(tagId: string, elementType: string, elementId: string): ElementTag | null {
        // Check tag exists
        const tag = this.database.getTagDefinition(tagId);
        if (!tag) {
            this.outputChannel.appendLine(`[TagManager] Tag not found: ${tagId}`);
            return null;
        }

        // database.assignTag already handles deduplication internally
        const assignment = this.database.assignTag(tagId, elementType, elementId);

        this.eventBus.emit('tag:assigned', 'tag-manager', {
            tag_id: tagId,
            tag_name: tag.name,
            element_type: elementType,
            element_id: elementId,
        });

        this.outputChannel.appendLine(
            `[TagManager] Tag "${tag.name}" assigned to ${elementType}:${elementId}`
        );

        return assignment;
    }

    /**
     * Remove a tag from an element.
     */
    removeTag(tagId: string, elementType: string, elementId: string): boolean {
        const removed = this.database.removeTag(tagId, elementType, elementId);
        if (removed) {
            this.eventBus.emit('tag:removed', 'tag-manager', {
                tag_id: tagId,
                element_type: elementType,
                element_id: elementId,
            });
            this.outputChannel.appendLine(
                `[TagManager] Tag removed from ${elementType}:${elementId}`
            );
        }
        return removed;
    }

    /**
     * Get all tags assigned to an element.
     */
    getTagsForElement(elementType: string, elementId: string): TagDefinition[] {
        return this.database.getTagsForElement(elementType, elementId);
    }

    /**
     * Get all elements that have a specific tag.
     */
    getElementsByTag(tagId: string): Array<{ element_type: string; element_id: string }> {
        return this.database.getElementsByTag(tagId);
    }
}
