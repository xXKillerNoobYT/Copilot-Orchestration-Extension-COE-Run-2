/**
 * DocumentManagerService — Organized reference documentation system (v7.0)
 *
 * Provides structured storage, search, and retrieval of support documents.
 * Research Agent saves findings here; Answer Agent searches here before LLM calls;
 * Pipeline context injection feeds relevant docs into agent prompts.
 *
 * Folders organize documents by topic (e.g., "LM Studio", "Architecture", "Agent Output").
 * Documents are keyword-searchable, taggable, and verifiable.
 */

import { Database } from './database';
import { EventBus } from './event-bus';
import { SupportDocument, Ticket } from '../types';

export interface OutputChannelLike {
    appendLine(msg: string): void;
}

export class DocumentManagerService {
    constructor(
        private database: Database,
        private eventBus: EventBus,
        private outputChannel: OutputChannelLike
    ) {}

    // ==================== SAVE ====================

    /**
     * Save a new support document to a folder.
     * Emits 'docs:document_saved' event on success.
     */
    saveDocument(
        folderName: string,
        docName: string,
        content: string,
        meta?: {
            plan_id?: string | null;
            summary?: string | null;
            category?: string;
            source_ticket_id?: string | null;
            source_agent?: string | null;
            tags?: string[];
            relevance_score?: number;
            source_type?: 'user' | 'system';
        }
    ): SupportDocument {
        // Auto-create folder event if this is the first document in it
        const existingFolders = this.database.listDocumentFolders();
        const isNewFolder = !existingFolders.includes(folderName);

        // v8.0: source_type determines locking — user docs are locked to user-only, system docs to system-only
        const sourceType = meta?.source_type ?? 'system';
        const isLocked = true; // All docs are locked by default for full separation

        const record = this.database.createSupportDocument({
            folder_name: folderName,
            document_name: docName,
            content,
            plan_id: meta?.plan_id ?? null,
            summary: meta?.summary ?? null,
            category: meta?.category ?? 'reference',
            source_ticket_id: meta?.source_ticket_id ?? null,
            source_agent: meta?.source_agent ?? null,
            tags: meta?.tags ?? [],
            relevance_score: meta?.relevance_score ?? 50,
            source_type: sourceType,
            is_locked: isLocked ? 1 : 0,
        });

        if (isNewFolder) {
            this.eventBus.emit('docs:folder_created', 'document-manager', {
                folder_name: folderName,
            });
            this.outputChannel.appendLine(`[DocumentManager] New folder created: ${folderName}`);
        }

        this.eventBus.emit('docs:document_saved', 'document-manager', {
            id: record.id,
            folder_name: folderName,
            document_name: docName,
        });

        this.outputChannel.appendLine(
            `[DocumentManager] Document saved: "${docName}" in folder "${folderName}" (id: ${record.id})`
        );

        // Return a full SupportDocument object
        return this.getDocument(record.id)!;
    }

    // ==================== READ ====================

    /**
     * Get a single document by ID.
     */
    getDocument(id: string): SupportDocument | null {
        const row = this.database.getSupportDocument(id);
        if (!row) return null;
        return this.rowToSupportDocument(row);
    }

    /**
     * Get all documents in a folder, sorted by updated_at descending.
     */
    getFolder(folderName: string): SupportDocument[] {
        const rows = this.database.getSupportDocumentsByFolder(folderName);
        return rows.map(r => this.rowToSupportDocument(r));
    }

    /**
     * List all folder names that have documents.
     */
    listFolders(): string[] {
        return this.database.listDocumentFolders();
    }

    // ==================== SEARCH ====================

    /**
     * Search documents by keyword, folder, category, plan, and/or tags.
     * Returns results sorted by relevance_score DESC, updated_at DESC.
     */
    searchDocuments(query: {
        folderName?: string;
        tags?: string[];
        keyword?: string;
        category?: string;
        planId?: string;
    }): SupportDocument[] {
        const rows = this.database.searchSupportDocuments({
            folder_name: query.folderName,
            keyword: query.keyword,
            category: query.category,
            plan_id: query.planId,
            tags: query.tags,
        });
        return rows.map(r => this.rowToSupportDocument(r));
    }

    // ==================== LOCKING (v8.0) ====================

    /**
     * Check if a document is editable by the given actor.
     * Full separation: user docs = user-only edits, system docs = system-only edits.
     */
    isEditableBy(docId: string, actor: 'user' | 'system'): boolean {
        const doc = this.getDocument(docId);
        if (!doc) { return false; }
        if (!doc.is_locked) { return true; } // Unlocked docs are editable by anyone
        return doc.source_type === actor;
    }

    // ==================== UPDATE ====================

    /**
     * Update a document's content or metadata.
     * Enforces locking rules — user docs can only be edited by users,
     * system docs can only be edited by the system.
     *
     * @param actor - 'user' or 'system' — who is performing the update
     */
    updateDocument(id: string, updates: {
        content?: string;
        summary?: string;
        category?: string;
        tags?: string[];
        relevance_score?: number;
        folder_name?: string;
        document_name?: string;
    }, actor?: 'user' | 'system'): void {
        // v8.0: Enforce locking
        if (actor) {
            if (!this.isEditableBy(id, actor)) {
                const doc = this.getDocument(id);
                this.outputChannel.appendLine(
                    `[DocumentManager] Edit blocked: ${actor} cannot edit ${doc?.source_type ?? 'unknown'}-created document ${id}`
                );
                throw new Error(`Document ${id} is locked to ${doc?.source_type ?? 'unknown'} edits only`);
            }
        }

        this.database.updateSupportDocument(id, updates);
        this.outputChannel.appendLine(`[DocumentManager] Document updated: ${id}`);
    }

    /**
     * Mark a document as verified by a specific agent or user.
     */
    verifyDocument(docId: string, verifiedBy: string): void {
        this.database.updateSupportDocument(docId, {
            is_verified: 1,  // SQLite integer for boolean
            verified_by: verifiedBy,
        } as Record<string, unknown>);

        this.eventBus.emit('docs:document_verified', 'document-manager', {
            id: docId,
            verified_by: verifiedBy,
        });

        this.outputChannel.appendLine(
            `[DocumentManager] Document ${docId} verified by ${verifiedBy}`
        );
    }

    // ==================== DELETE ====================

    /**
     * Delete a document by ID.
     * Enforces locking — user docs can only be deleted by users, system docs by system.
     *
     * @param actor - 'user' or 'system' — who is performing the delete
     */
    deleteDocument(docId: string, actor?: 'user' | 'system'): boolean {
        // v8.0: Enforce locking
        if (actor) {
            if (!this.isEditableBy(docId, actor)) {
                const doc = this.getDocument(docId);
                this.outputChannel.appendLine(
                    `[DocumentManager] Delete blocked: ${actor} cannot delete ${doc?.source_type ?? 'unknown'}-created document ${docId}`
                );
                return false;
            }
        }

        const deleted = this.database.deleteSupportDocument(docId);
        if (deleted) {
            this.outputChannel.appendLine(`[DocumentManager] Document deleted: ${docId}`);
        }
        return deleted;
    }

    // ==================== CONTEXT GATHERING ====================

    /**
     * Gather relevant support documents for a ticket based on keyword matching.
     *
     * Extracts keywords from the ticket's title, body, operation_type, and acceptance_criteria,
     * then searches for matching documents. Returns up to 5 most relevant documents.
     *
     * Used by the pipeline context builder to inject documentation into agent prompts.
     */
    gatherContextDocs(ticket: Ticket): SupportDocument[] {
        // Extract keywords from ticket
        const keywords = this.extractKeywords(ticket);
        if (keywords.length === 0) return [];

        // Search for each keyword and deduplicate results
        const seen = new Set<string>();
        const results: SupportDocument[] = [];

        for (const keyword of keywords) {
            if (results.length >= 10) break; // Don't over-search

            const docs = this.searchDocuments({ keyword });
            for (const doc of docs) {
                if (!seen.has(doc.id)) {
                    seen.add(doc.id);
                    results.push(doc);
                }
            }
        }

        // Sort by relevance_score descending, take top 5
        results.sort((a, b) => b.relevance_score - a.relevance_score);
        return results.slice(0, 5);
    }

    /**
     * Format gathered documents into a context string suitable for agent prompts.
     */
    formatContextDocs(docs: SupportDocument[]): string {
        if (docs.length === 0) return '';

        const lines: string[] = [
            '=== SUPPORT DOCUMENTATION ===',
            `Found ${docs.length} relevant document(s) for this task.\n`,
        ];

        for (const doc of docs) {
            const verifiedTag = doc.is_verified ? ' [VERIFIED]' : '';
            lines.push(`--- ${doc.document_name} (${doc.folder_name})${verifiedTag} ---`);
            if (doc.summary) {
                lines.push(`Summary: ${doc.summary}`);
            }
            // Include content but cap at 1500 chars per doc to avoid prompt bloat
            const content = doc.content.length > 1500
                ? doc.content.substring(0, 1500) + '... [truncated]'
                : doc.content;
            lines.push(content);
            lines.push('');
        }

        lines.push('=== END SUPPORT DOCUMENTATION ===');
        return lines.join('\n');
    }

    // ==================== INTERNAL HELPERS ====================

    /**
     * Extract meaningful keywords from a ticket for document search.
     */
    private extractKeywords(ticket: Ticket): string[] {
        const keywords: string[] = [];
        const stopWords = new Set([
            'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'shall', 'should',
            'may', 'might', 'must', 'can', 'could', 'would', 'to', 'of', 'in',
            'for', 'on', 'with', 'at', 'by', 'from', 'up', 'about', 'into',
            'through', 'during', 'before', 'after', 'above', 'below', 'between',
            'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once',
            'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
            'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such',
            'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
            'very', 'just', 'because', 'as', 'until', 'while', 'that', 'this',
            'these', 'those', 'it', 'its', 'and', 'but', 'or', 'if',
            'ticket', 'task', 'create', 'update', 'fix', 'implement', 'add',
        ]);

        // Extract from title
        const titleWords = ticket.title
            .replace(/[^a-zA-Z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length >= 3 && !stopWords.has(w.toLowerCase()))
            .map(w => w.toLowerCase());
        keywords.push(...titleWords);

        // Extract from operation_type
        if (ticket.operation_type) {
            const opWords = ticket.operation_type
                .replace(/_/g, ' ')
                .split(/\s+/)
                .filter(w => w.length >= 3 && !stopWords.has(w.toLowerCase()));
            keywords.push(...opWords);
        }

        // Extract notable terms from body (first 500 chars)
        if (ticket.body) {
            const bodySnippet = ticket.body.substring(0, 500);
            const bodyWords = bodySnippet
                .replace(/[^a-zA-Z0-9\s]/g, ' ')
                .split(/\s+/)
                .filter(w => w.length >= 4 && !stopWords.has(w.toLowerCase()))
                .map(w => w.toLowerCase());
            // Take only first 5 unique body words to avoid noise
            const uniqueBody = [...new Set(bodyWords)].slice(0, 5);
            keywords.push(...uniqueBody);
        }

        // Deduplicate
        return [...new Set(keywords)].slice(0, 8); // Cap at 8 keywords
    }

    /**
     * Convert a raw database row (Record<string, unknown>) to a typed SupportDocument.
     */
    private rowToSupportDocument(row: Record<string, unknown>): SupportDocument {
        return {
            id: row.id as string,
            plan_id: (row.plan_id as string) ?? null,
            folder_name: row.folder_name as string,
            document_name: row.document_name as string,
            content: row.content as string,
            summary: (row.summary as string) ?? null,
            category: row.category as string,
            source_ticket_id: (row.source_ticket_id as string) ?? null,
            source_agent: (row.source_agent as string) ?? null,
            tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags as string[]) ?? [],
            is_verified: Boolean(row.is_verified),
            verified_by: (row.verified_by as string) ?? null,
            relevance_score: (row.relevance_score as number) ?? 50,
            source_type: (row.source_type as 'user' | 'system') ?? 'system',
            is_locked: Boolean(row.is_locked),
            created_at: row.created_at as string,
            updated_at: row.updated_at as string,
        };
    }
}
