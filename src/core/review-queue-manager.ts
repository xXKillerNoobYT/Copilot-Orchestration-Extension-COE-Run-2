/**
 * ReviewQueueManagerService — Unified review queue for FE + BE drafts (v8.0)
 *
 * Manages a single review queue that handles:
 *   - FE draft components (is_draft=1 from Design Hardener)
 *   - BE draft elements (is_draft=1 from BE hardening)
 *   - Link suggestions (from auto-detect and AI suggestions)
 *   - Tag suggestions (future use)
 *
 * Approval dispatches by item_type:
 *   - fe_draft → update design component (is_draft=0)
 *   - be_draft → update backend element (is_draft=0)
 *   - link_suggestion → update element link (is_approved=1)
 *
 * Rejection removes the draft/suggestion element entirely.
 *
 * Nav badge shows pending count, polled from the webapp.
 */

import { Database } from './database';
import { EventBus } from './event-bus';
import { ReviewQueueItem, TicketPriority } from '../types';

export interface OutputChannelLike {
    appendLine(msg: string): void;
}

export class ReviewQueueManagerService {
    constructor(
        private database: Database,
        private eventBus: EventBus,
        private outputChannel: OutputChannelLike
    ) {}

    // ==================== CREATE ====================

    /**
     * Add an item to the review queue.
     */
    addToQueue(data: {
        plan_id: string;
        item_type: ReviewQueueItem['item_type'];
        element_id: string;
        element_type: string;
        title: string;
        description?: string;
        source_agent?: string;
        priority?: TicketPriority;
    }): ReviewQueueItem {
        const item = this.database.createReviewQueueItem({
            plan_id: data.plan_id,
            item_type: data.item_type,
            element_id: data.element_id,
            element_type: data.element_type,
            title: data.title,
            description: data.description || '',
            source_agent: data.source_agent || 'system',
            status: 'pending',
            priority: data.priority ?? TicketPriority.P2,
        });

        this.eventBus.emit('review_queue:item_created', 'review-queue-manager', {
            id: item.id,
            item_type: item.item_type,
            title: item.title,
        });

        // Emit badge update for nav count
        this.emitBadgeUpdate(data.plan_id);

        this.outputChannel.appendLine(
            `[ReviewQueue] Item added: "${item.title}" (${item.item_type})`
        );

        return item;
    }

    // ==================== READ ====================

    /**
     * Get all pending review items for a plan, sorted by priority then created_at.
     */
    getPendingItems(planId: string): ReviewQueueItem[] {
        return this.database.getReviewQueueByPlan(planId).filter(function (item) {
            return item.status === 'pending';
        });
    }

    /**
     * Get all review items for a plan (all statuses).
     */
    getAllItems(planId: string): ReviewQueueItem[] {
        return this.database.getReviewQueueByPlan(planId);
    }

    /**
     * Get pending count for the nav badge.
     */
    getPendingCount(planId?: string): number {
        return this.database.getPendingReviewCount(planId);
    }

    /**
     * Get a single review item.
     */
    getItem(itemId: string): ReviewQueueItem | null {
        return this.database.getReviewQueueItem(itemId);
    }

    // ==================== APPROVE / REJECT ====================

    /**
     * Approve a review queue item.
     * Dispatches by item_type to finalize the underlying element.
     */
    approveItem(itemId: string, notes?: string): boolean {
        const item = this.database.getReviewQueueItem(itemId);
        if (!item || item.status !== 'pending') { return false; }

        // Dispatch approval based on item type
        try {
            switch (item.item_type) {
                case 'fe_draft':
                    // Promote FE draft component to non-draft
                    this.database.updateDesignComponent(item.element_id, { is_draft: 0 });
                    break;

                case 'be_draft':
                    // Promote BE draft element to non-draft
                    this.database.updateBackendElement(item.element_id, { is_draft: false });
                    break;

                case 'link_suggestion':
                    // Approve the link
                    this.database.updateElementLink(item.element_id, { is_approved: true });
                    break;

                case 'tag_suggestion':
                    // Tag suggestions — just mark as approved (tag already assigned)
                    break;
            }

            // Update the queue item status
            this.database.approveReviewItem(itemId);
            if (notes) {
                this.database.updateReviewQueueItem(itemId, { review_notes: notes });
            }

            this.eventBus.emit('review_queue:item_approved', 'review-queue-manager', {
                id: itemId,
                item_type: item.item_type,
                element_id: item.element_id,
            });

            this.emitBadgeUpdate(item.plan_id);

            this.outputChannel.appendLine(
                `[ReviewQueue] Item approved: "${item.title}" (${item.item_type})`
            );

            return true;
        } catch (error) {
            var errMsg = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(
                `[ReviewQueue] Error approving item ${itemId}: ${errMsg}`
            );
            return false;
        }
    }

    /**
     * Reject a review queue item.
     * Removes the underlying draft/suggestion element.
     */
    rejectItem(itemId: string, notes?: string): boolean {
        const item = this.database.getReviewQueueItem(itemId);
        if (!item || item.status !== 'pending') { return false; }

        try {
            // Remove the underlying element
            switch (item.item_type) {
                case 'fe_draft':
                    this.database.deleteDesignComponent(item.element_id);
                    break;

                case 'be_draft':
                    this.database.deleteBackendElement(item.element_id);
                    break;

                case 'link_suggestion':
                    this.database.deleteElementLink(item.element_id);
                    break;

                case 'tag_suggestion':
                    // Remove the tag assignment
                    break;
            }

            // Update the queue item status
            this.database.rejectReviewItem(itemId);
            if (notes) {
                this.database.updateReviewQueueItem(itemId, { review_notes: notes });
            }

            this.eventBus.emit('review_queue:item_rejected', 'review-queue-manager', {
                id: itemId,
                item_type: item.item_type,
                element_id: item.element_id,
            });

            this.emitBadgeUpdate(item.plan_id);

            this.outputChannel.appendLine(
                `[ReviewQueue] Item rejected: "${item.title}" (${item.item_type})`
            );

            return true;
        } catch (error) {
            var errMsg = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(
                `[ReviewQueue] Error rejecting item ${itemId}: ${errMsg}`
            );
            return false;
        }
    }

    // ==================== BATCH OPERATIONS ====================

    /**
     * Approve all pending items for a plan.
     */
    approveAll(planId: string): number {
        const pending = this.getPendingItems(planId);
        var approved = 0;
        for (const item of pending) {
            if (this.approveItem(item.id)) {
                approved++;
            }
        }
        this.outputChannel.appendLine(`[ReviewQueue] Batch approved ${approved} items for plan ${planId}`);
        return approved;
    }

    /**
     * Reject all pending items for a plan.
     */
    rejectAll(planId: string): number {
        const pending = this.getPendingItems(planId);
        var rejected = 0;
        for (const item of pending) {
            if (this.rejectItem(item.id)) {
                rejected++;
            }
        }
        this.outputChannel.appendLine(`[ReviewQueue] Batch rejected ${rejected} items for plan ${planId}`);
        return rejected;
    }

    // ==================== DRAFT HOOKS ====================

    /**
     * Called when a FE draft component is created (by Design Hardener).
     * Auto-creates a review queue entry.
     */
    onFeDraftCreated(planId: string, componentId: string, componentName: string, sourceAgent?: string): ReviewQueueItem {
        return this.addToQueue({
            plan_id: planId,
            item_type: 'fe_draft',
            element_id: componentId,
            element_type: 'component',
            title: 'FE Draft: ' + componentName,
            description: 'Draft component proposed by ' + (sourceAgent || 'Design Hardener'),
            source_agent: sourceAgent || 'Design Hardener',
            priority: TicketPriority.P2,
        });
    }

    /**
     * Called when a BE draft element is created (by BE Hardener).
     * Auto-creates a review queue entry.
     */
    onBeDraftCreated(planId: string, elementId: string, elementName: string, elementType: string, sourceAgent?: string): ReviewQueueItem {
        return this.addToQueue({
            plan_id: planId,
            item_type: 'be_draft',
            element_id: elementId,
            element_type: elementType,
            title: 'BE Draft: ' + elementName,
            description: 'Draft ' + elementType + ' proposed by ' + (sourceAgent || 'Design Hardener'),
            source_agent: sourceAgent || 'Design Hardener',
            priority: TicketPriority.P2,
        });
    }

    /**
     * Called when a link suggestion is created (by auto-detect or AI).
     * Auto-creates a review queue entry.
     */
    onLinkSuggested(planId: string, linkId: string, label: string, source: string): ReviewQueueItem {
        return this.addToQueue({
            plan_id: planId,
            item_type: 'link_suggestion',
            element_id: linkId,
            element_type: 'link',
            title: 'Link: ' + label,
            description: 'Connection suggested by ' + source,
            source_agent: source,
            priority: TicketPriority.P3,
        });
    }

    // ==================== INTERNAL ====================

    /**
     * Emit a badge update event with the current pending count.
     */
    private emitBadgeUpdate(planId: string): void {
        const count = this.getPendingCount(planId);
        this.eventBus.emit('review_queue:badge_update', 'review-queue-manager', {
            plan_id: planId,
            pending_count: count,
        });
    }
}
