/**
 * LinkManagerService — Cross-element relationship management (v8.0)
 *
 * Manages 4 types of links between design elements:
 *   - FE↔FE: Between front-end pages/components
 *   - BE↔BE: Between back-end elements
 *   - FE→BE: Front-end to back-end connections
 *   - BE→FE: Back-end to front-end connections
 *
 * Three creation modes:
 *   - Manual: User creates via drag-and-drop
 *   - Auto-detect: Scans DataModel relationships + component bindings
 *   - AI-suggested: BackendArchitectAgent proposes connections
 *
 * Provides matrix and tree rendering data for the Link Tree UI.
 */

import { Database } from './database';
import { EventBus } from './event-bus';
import { ElementLink, LinkMatrix, LinkTreeNode } from '../types';

export interface OutputChannelLike {
    appendLine(msg: string): void;
}

export class LinkManagerService {
    constructor(
        private database: Database,
        private eventBus: EventBus,
        private outputChannel: OutputChannelLike
    ) {}

    // ==================== CRUD ====================

    /**
     * Create a new link between elements.
     */
    createLink(data: {
        plan_id: string;
        link_type: ElementLink['link_type'];
        granularity: ElementLink['granularity'];
        source: ElementLink['source'];
        from_element_type: ElementLink['from_element_type'];
        from_element_id: string;
        to_element_type: ElementLink['to_element_type'];
        to_element_id: string;
        label?: string;
        metadata_json?: string;
        confidence?: number;
        is_approved?: boolean;
    }): ElementLink {
        const link = this.database.createElementLink({
            plan_id: data.plan_id,
            link_type: data.link_type,
            granularity: data.granularity,
            source: data.source,
            from_element_type: data.from_element_type,
            from_element_id: data.from_element_id,
            to_element_type: data.to_element_type,
            to_element_id: data.to_element_id,
            label: data.label || '',
            metadata_json: data.metadata_json || '{}',
            confidence: data.confidence ?? 1.0,
            is_approved: data.is_approved ?? (data.source === 'manual'),
        });

        this.eventBus.emit('link:created', 'link-manager', {
            id: link.id,
            link_type: link.link_type,
            source: link.source,
        });

        this.outputChannel.appendLine(
            `[LinkManager] Link created: ${link.link_type} ${link.from_element_type}→${link.to_element_type} (${link.source})`
        );

        return link;
    }

    /**
     * Get all links for a specific element (both directions).
     */
    getLinksForElement(elementType: string, elementId: string): ElementLink[] {
        return this.database.getElementLinksByElement(elementType, elementId);
    }

    /**
     * Get all links for a plan.
     */
    getLinksByPlan(planId: string): ElementLink[] {
        return this.database.getElementLinksByPlan(planId);
    }

    /**
     * Delete a link.
     */
    deleteLink(linkId: string): boolean {
        const deleted = this.database.deleteElementLink(linkId);
        if (deleted) {
            this.eventBus.emit('link:deleted', 'link-manager', { id: linkId });
            this.outputChannel.appendLine(`[LinkManager] Link deleted: ${linkId}`);
        }
        return deleted;
    }

    /**
     * Approve an AI-suggested or auto-detected link.
     */
    approveLink(linkId: string): void {
        this.database.updateElementLink(linkId, { is_approved: true });
        this.eventBus.emit('link:approved', 'link-manager', { id: linkId });
        this.outputChannel.appendLine(`[LinkManager] Link approved: ${linkId}`);
    }

    /**
     * Reject an AI-suggested or auto-detected link (deletes it).
     */
    rejectLink(linkId: string): void {
        this.database.deleteElementLink(linkId);
        this.eventBus.emit('link:rejected', 'link-manager', { id: linkId });
        this.outputChannel.appendLine(`[LinkManager] Link rejected: ${linkId}`);
    }

    // ==================== AUTO-DETECTION ====================

    /**
     * Scan plan data to auto-detect relationships between elements.
     * Returns newly created links.
     *
     * Detection sources:
     * 1. DataModel.bound_components → creates fe_to_be links
     * 2. DataModel.relationships → creates be_to_be links
     * 3. ApiRouteConfig.middleware_ids → creates be_to_be links
     */
    autoDetectLinks(planId: string): ElementLink[] {
        const created: ElementLink[] = [];
        const existingLinks = this.database.getElementLinksByPlan(planId);

        // Helper to check if a link already exists (same from/to)
        const linkExists = (fromType: string, fromId: string, toType: string, toId: string): boolean => {
            return existingLinks.some(function (l) {
                return (l.from_element_type === fromType && l.from_element_id === fromId &&
                        l.to_element_type === toType && l.to_element_id === toId) ||
                       (l.from_element_type === toType && l.from_element_id === toId &&
                        l.to_element_type === fromType && l.to_element_id === fromId);
            });
        };

        // 1. DataModel bound_components → fe_to_be links (component → data_model)
        const dataModels = this.database.getDataModelsByPlan(planId);
        for (const model of dataModels) {
            for (const compId of (model.bound_components || [])) {
                if (!linkExists('component', compId, 'data_model', model.id)) {
                    var link = this.createLink({
                        plan_id: planId,
                        link_type: 'fe_to_be',
                        granularity: 'component',
                        source: 'auto_detected',
                        from_element_type: 'component',
                        from_element_id: compId,
                        to_element_type: 'data_model',
                        to_element_id: model.id,
                        label: 'Bound to ' + model.name,
                        confidence: 0.9,
                        is_approved: false,
                    });
                    created.push(link);
                }
            }

            // 2. DataModel relationships → be_to_be links (model → model)
            for (const rel of (model.relationships || [])) {
                if (!linkExists('data_model', model.id, 'data_model', rel.target_model_id)) {
                    var relLink = this.createLink({
                        plan_id: planId,
                        link_type: 'be_to_be',
                        granularity: 'high',
                        source: 'auto_detected',
                        from_element_type: 'data_model',
                        from_element_id: model.id,
                        to_element_type: 'data_model',
                        to_element_id: rel.target_model_id,
                        label: rel.type + ' → ' + rel.field_name,
                        confidence: 0.95,
                        is_approved: false,
                    });
                    created.push(relLink);
                }
            }
        }

        // 3. API routes referencing middleware → be_to_be links
        const backendElements = this.database.getBackendElementsByPlan(planId);
        for (const el of backendElements) {
            if (el.type === 'api_route') {
                var config: Record<string, unknown> = {};
                try { config = JSON.parse(el.config_json || '{}'); } catch { /* ignore */ }

                var middlewareIds = config.middleware_ids;
                if (Array.isArray(middlewareIds)) {
                    for (const mwId of middlewareIds) {
                        if (!linkExists('backend_element', el.id, 'backend_element', String(mwId))) {
                            var mwLink = this.createLink({
                                plan_id: planId,
                                link_type: 'be_to_be',
                                granularity: 'component',
                                source: 'auto_detected',
                                from_element_type: 'backend_element',
                                from_element_id: el.id,
                                to_element_type: 'backend_element',
                                to_element_id: String(mwId),
                                label: 'Uses middleware',
                                confidence: 0.95,
                                is_approved: false,
                            });
                            created.push(mwLink);
                        }
                    }
                }
            }
        }

        this.eventBus.emit('link:auto_detected', 'link-manager', {
            plan_id: planId,
            count: created.length,
        });

        this.outputChannel.appendLine(
            `[LinkManager] Auto-detected ${created.length} links for plan ${planId}`
        );

        return created;
    }

    // ==================== MATRIX VIEW ====================

    /**
     * Build a matrix data structure for the Link Tree matrix view.
     * Rows and columns are all elements, cells contain link info.
     */
    buildMatrix(planId: string): LinkMatrix {
        const links = this.database.getElementLinksByPlan(planId);
        const pages = this.database.getDesignPagesByPlan(planId);
        const backendElements = this.database.getBackendElementsByPlan(planId);
        const dataModels = this.database.getDataModelsByPlan(planId);

        // Build element list (rows and columns)
        const elements: Array<{ id: string; name: string; type: string; element_type: string }> = [];

        for (const p of pages) {
            elements.push({ id: p.id, name: p.name, type: 'page', element_type: 'page' });
        }
        for (const be of backendElements) {
            elements.push({ id: be.id, name: be.name, type: be.type, element_type: 'backend_element' });
        }
        for (const dm of dataModels) {
            elements.push({ id: dm.id, name: dm.name, type: 'data_model', element_type: 'data_model' });
        }

        // Build element index for fast row/col lookup
        const indexMap: Record<string, number> = {};
        for (var idx = 0; idx < elements.length; idx++) {
            indexMap[elements[idx].id] = idx;
        }

        // Build cells
        const cells: LinkMatrix['cells'] = [];
        for (const link of links) {
            var row = indexMap[link.from_element_id];
            var col = indexMap[link.to_element_id];
            if (row !== undefined && col !== undefined) {
                cells.push({
                    row: row,
                    col: col,
                    link_type: link.link_type,
                    link_id: link.id,
                    label: link.label,
                });
            }
        }

        return {
            rows: elements,
            cols: elements,
            cells: cells,
        };
    }

    // ==================== TREE VIEW ====================

    /**
     * Build a tree data structure organized by link type for the tree view.
     */
    buildTree(planId: string): LinkTreeNode[] {
        const links = this.database.getElementLinksByPlan(planId);
        const pages = this.database.getDesignPagesByPlan(planId);
        const backendElements = this.database.getBackendElementsByPlan(planId);
        const dataModels = this.database.getDataModelsByPlan(planId);

        // Build name lookup
        const nameMap: Record<string, string> = {};
        const typeMap: Record<string, string> = {};
        for (const p of pages) { nameMap[p.id] = p.name; typeMap[p.id] = 'page'; }
        for (const be of backendElements) { nameMap[be.id] = be.name; typeMap[be.id] = 'backend_element'; }
        for (const dm of dataModels) { nameMap[dm.id] = dm.name; typeMap[dm.id] = 'data_model'; }

        // Group links by type
        const linksByType: Record<string, ElementLink[]> = {
            'fe_to_fe': [],
            'be_to_be': [],
            'fe_to_be': [],
            'be_to_fe': [],
        };
        for (const link of links) {
            if (linksByType[link.link_type]) {
                linksByType[link.link_type].push(link);
            }
        }

        const typeLabels: Record<string, string> = {
            'fe_to_fe': 'Frontend ↔ Frontend',
            'be_to_be': 'Backend ↔ Backend',
            'fe_to_be': 'Frontend → Backend',
            'be_to_fe': 'Backend → Frontend',
        };

        // Build tree nodes
        const tree: LinkTreeNode[] = [];

        for (const [linkType, typeLinks] of Object.entries(linksByType)) {
            if (typeLinks.length === 0) { continue; }

            // Group by source element
            const bySource: Record<string, ElementLink[]> = {};
            for (const link of typeLinks) {
                if (!bySource[link.from_element_id]) { bySource[link.from_element_id] = []; }
                bySource[link.from_element_id].push(link);
            }

            const children: LinkTreeNode[] = [];
            for (const [sourceId, sourceLinks] of Object.entries(bySource)) {
                const childNodes: LinkTreeNode[] = sourceLinks.map(function (l) {
                    return {
                        id: l.to_element_id,
                        name: nameMap[l.to_element_id] || l.to_element_id,
                        type: typeMap[l.to_element_id] || l.to_element_type,
                        element_type: l.to_element_type,
                        children: [],
                        links: [l],
                    };
                });

                children.push({
                    id: sourceId,
                    name: nameMap[sourceId] || sourceId,
                    type: typeMap[sourceId] || 'unknown',
                    element_type: typeMap[sourceId] || 'unknown',
                    children: childNodes,
                    links: sourceLinks,
                });
            }

            tree.push({
                id: linkType,
                name: typeLabels[linkType] || linkType,
                type: 'category',
                element_type: 'category',
                children: children,
                links: typeLinks,
            });
        }

        return tree;
    }
}
