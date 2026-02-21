/**
 * ticket-tagger.ts — Ticket Tagging Enforcement Service (v11.0)
 *
 * HARD RULE: Every ticket MUST have proper tags before it enters the queue.
 *
 * Two enforcement points:
 * A) At creation (tagTicket) — assigns category, stage, extracts references
 * B) At pre-dispatch (validateTags) — double-checks before Boss validation
 *
 * Uses deterministic keyword analysis (NOT LLM) for speed and consistency.
 */

import type { TicketCategory, TicketStage, Ticket } from '../types/index.js';

// ============================================================
// Keyword Maps for Category Detection
// ============================================================

/** Category keywords — scored by match count against ticket title + body */
const CATEGORY_KEYWORDS: Record<TicketCategory, string[]> = {
    planning: [
        'plan', 'planning', 'architecture', 'design document', 'decompose',
        'breakdown', 'scope', 'requirements', 'specification', 'roadmap',
        'strategy', 'phase', 'milestone', 'epic', 'story', 'feature list',
        'project plan', 'sprint plan', 'backlog', 'prioritize'
    ],
    coding: [
        'implement', 'code', 'build', 'fix', 'bug', 'develop', 'program',
        'function', 'class', 'module', 'refactor', 'optimize', 'feature',
        'endpoint', 'api', 'service', 'handler', 'controller', 'migration',
        'crud', 'logic', 'algorithm', 'integration', 'patch', 'hotfix',
        'typescript', 'javascript', 'python', 'component', 'implement'
    ],
    verification: [
        'test', 'verify', 'validate', 'check', 'qa', 'quality',
        'assertion', 'coverage', 'regression', 'smoke test', 'unit test',
        'integration test', 'e2e', 'end-to-end', 'acceptance test',
        'benchmark', 'performance test', 'load test', 'stress test'
    ],
    review: [
        'review', 'approve', 'feedback', 'assess', 'evaluate', 'audit',
        'code review', 'peer review', 'pull request', 'pr review',
        'quality check', 'sign off', 'final check', 'inspection'
    ],
    design: [
        'design', 'ui', 'ux', 'wireframe', 'mockup', 'prototype',
        'layout', 'visual', 'interface', 'user experience', 'user interface',
        'frontend design', 'component design', 'page design', 'screen',
        'responsive', 'accessibility', 'a11y', 'theme', 'style'
    ],
    data_model: [
        'data model', 'schema', 'database', 'table', 'entity', 'relation',
        'erd', 'migration', 'column', 'field', 'index', 'foreign key',
        'primary key', 'normalization', 'denormalization', 'data structure',
        'model', 'orm', 'query', 'sql'
    ],
    task_creation: [
        'create task', 'generate task', 'decompose', 'break down',
        'sub-task', 'subtask', 'child ticket', 'spawn', 'delegate',
        'work item', 'create ticket', 'ticket generation', 'auto-create'
    ],
    infrastructure: [
        'infrastructure', 'deploy', 'ci', 'cd', 'pipeline', 'docker',
        'kubernetes', 'server', 'hosting', 'cloud', 'aws', 'azure',
        'devops', 'monitoring', 'logging', 'config', 'environment',
        'build system', 'bundler', 'webpack', 'esbuild', 'vite'
    ],
    documentation: [
        'document', 'documentation', 'docs', 'readme', 'guide',
        'tutorial', 'api docs', 'jsdoc', 'typedoc', 'comment',
        'changelog', 'release notes', 'wiki', 'knowledge base',
        'specification', 'write-up', 'report'
    ],
    communication: [
        'communicate', 'notify', 'message', 'email', 'slack',
        'announcement', 'update stakeholder', 'status update',
        'question', 'clarification', 'feedback request', 'user question'
    ],
    boss_directive: [
        'boss directive', 'boss command', 'system directive',
        'orchestration', 'coordination', 'boss override', 'boss decision'
    ]
};

/** Fast-path: operation_type → category (exact matches) */
const OPERATION_TYPE_MAP: Record<string, TicketCategory> = {
    'plan_generation': 'planning',
    'plan_refinement': 'planning',
    'code_generation': 'coding',
    'code_modification': 'coding',
    'bug_fix': 'coding',
    'refactor': 'coding',
    'test_generation': 'verification',
    'test_execution': 'verification',
    'verification': 'verification',
    'code_review': 'review',
    'design_review': 'review',
    'ui_design': 'design',
    'ux_design': 'design',
    'frontend_design': 'design',
    'backend_design': 'design',
    'data_modeling': 'data_model',
    'schema_design': 'data_model',
    'database_migration': 'data_model',
    'task_decomposition': 'task_creation',
    'deployment': 'infrastructure',
    'ci_cd': 'infrastructure',
    'documentation': 'documentation',
    'user_communication': 'communication',
    'boss_directive': 'boss_directive',
    'boss_review': 'boss_directive',
    'ghost_ticket': 'communication'
};

/** Fast-path: operation_type → stage */
const OPERATION_STAGE_MAP: Record<string, TicketStage> = {
    'plan_generation': 'analysis',
    'plan_refinement': 'design',
    'code_generation': 'implementation',
    'code_modification': 'implementation',
    'bug_fix': 'implementation',
    'refactor': 'implementation',
    'test_generation': 'testing',
    'test_execution': 'testing',
    'verification': 'testing',
    'code_review': 'review',
    'design_review': 'review',
    'ui_design': 'design',
    'ux_design': 'design',
    'deployment': 'deployment'
};

// ============================================================
// Stage Keyword Detection
// ============================================================

/** Stage keywords — less specific than category, used as fallback */
const STAGE_KEYWORDS: Record<TicketStage, string[]> = {
    analysis: [
        'analyze', 'analysis', 'research', 'investigate', 'discover',
        'gather requirements', 'understand', 'explore', 'assess', 'scope'
    ],
    design: [
        'design', 'architect', 'plan', 'blueprint', 'wireframe',
        'mockup', 'prototype', 'structure', 'layout', 'model'
    ],
    implementation: [
        'implement', 'build', 'code', 'develop', 'create', 'construct',
        'write', 'program', 'integrate', 'connect', 'wire up'
    ],
    testing: [
        'test', 'verify', 'validate', 'check', 'qa', 'assert',
        'coverage', 'regression', 'benchmark', 'debug'
    ],
    review: [
        'review', 'approve', 'inspect', 'audit', 'evaluate',
        'feedback', 'sign off', 'finalize'
    ],
    deployment: [
        'deploy', 'release', 'publish', 'ship', 'launch', 'rollout',
        'go live', 'production', 'stage', 'promote'
    ]
};

/** Phase title patterns → stage (fallback for phase-based tickets) */
const PHASE_TITLE_MAP: Record<string, TicketStage> = {
    'planning': 'analysis',
    'design': 'design',
    'foundation': 'implementation',
    'implementation': 'implementation',
    'core development': 'implementation',
    'testing': 'testing',
    'qa': 'testing',
    'verification': 'testing',
    'review': 'review',
    'deployment': 'deployment',
    'launch': 'deployment'
};

// ============================================================
// Reference Extraction Helpers
// ============================================================

/** Extract ticket references from text (TK-### patterns) */
function extractTicketReferences(text: string): string[] {
    if (!text) return [];
    const matches = text.match(/TK-\d+/gi);
    if (!matches) return [];
    // Dedupe and normalize to uppercase
    const unique = new Set(matches.map(m => m.toUpperCase()));
    return Array.from(unique);
}

/** Extract blocking relationships from text */
function extractBlockingReferences(text: string): string[] {
    if (!text) return [];
    const blockingPatterns = [
        /(?:blocks|blocked by|depends on|requires|prerequisite)\s*:?\s*(TK-\d+)/gi,
        /(?:must complete|needs|waiting for|after)\s+(TK-\d+)/gi
    ];
    const results: Set<string> = new Set();
    for (const pattern of blockingPatterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            results.add(match[1].toUpperCase());
        }
    }
    return Array.from(results);
}

// ============================================================
// TicketTagger Class
// ============================================================

export interface TagResult {
    ticket_category: TicketCategory;
    ticket_stage: TicketStage;
    related_ticket_ids: string[];
    blocking_ticket_ids: string[];
    team_assignment: string;
}

export interface TagValidation {
    isValid: boolean;
    corrections: string[];
    correctedTags?: Partial<TagResult>;
}

export class TicketTagger {
    /**
     * Tag a ticket at creation time.
     * Assigns category, stage, extracts references.
     * MUST be called for every ticket created in the system.
     */
    tagTicket(ticket: {
        title: string;
        body?: string;
        operation_type?: string;
        phase_title?: string;
        parent_ticket_id?: string | null;
    }): TagResult {
        const title = (ticket.title ?? '').toLowerCase();
        const body = (ticket.body ?? '').toLowerCase();
        const combined = `${title} ${body}`;
        const operationType = ticket.operation_type ?? '';

        // --- Category Detection ---

        // Fast path: exact operation_type mapping
        let category: TicketCategory | null = OPERATION_TYPE_MAP[operationType] ?? null;

        // Keyword scoring fallback
        if (!category) {
            category = this.scoreCategoryKeywords(combined);
        }

        // Ultimate fallback — default to 'coding' (most common)
        if (!category) {
            category = 'coding';
        }

        // --- Stage Detection ---

        // Fast path: operation_type mapping
        let stage: TicketStage | null = OPERATION_STAGE_MAP[operationType] ?? null;

        // Phase title fallback
        if (!stage && ticket.phase_title) {
            const phaseLower = ticket.phase_title.toLowerCase();
            for (const [pattern, mappedStage] of Object.entries(PHASE_TITLE_MAP)) {
                if (phaseLower.includes(pattern)) {
                    stage = mappedStage;
                    break;
                }
            }
        }

        // Keyword scoring fallback
        if (!stage) {
            stage = this.scoreStageKeywords(combined);
        }

        // Ultimate fallback — derive from category
        if (!stage) {
            stage = this.deriveStageFromCategory(category);
        }

        // --- Reference Extraction ---
        const fullText = `${ticket.title ?? ''} ${ticket.body ?? ''}`;
        const relatedIds = extractTicketReferences(fullText);
        const blockingIds = extractBlockingReferences(fullText);

        // Include parent as a reference
        if (ticket.parent_ticket_id && !relatedIds.includes(ticket.parent_ticket_id)) {
            relatedIds.push(ticket.parent_ticket_id);
        }

        // --- Team Assignment ---
        const team = this.getCategoryQueue(category);

        return {
            ticket_category: category,
            ticket_stage: stage,
            related_ticket_ids: relatedIds,
            blocking_ticket_ids: blockingIds,
            team_assignment: team
        };
    }

    /**
     * Validate tags at pre-dispatch time.
     * Double-checks that tags are present and consistent.
     * If missing, applies them. If inconsistent, corrects them.
     */
    validateTags(ticket: Ticket): TagValidation {
        const corrections: string[] = [];
        let correctedTags: Partial<TagResult> | undefined;

        // Check if category is missing
        if (!ticket.ticket_category) {
            const result = this.tagTicket({
                title: ticket.title,
                body: ticket.body,
                operation_type: ticket.operation_type
            });
            correctedTags = result;
            corrections.push(`Missing category → assigned '${result.ticket_category}'`);
        }

        // Check if stage is missing
        if (!ticket.ticket_stage) {
            if (!correctedTags) {
                const result = this.tagTicket({
                    title: ticket.title,
                    body: ticket.body,
                    operation_type: ticket.operation_type
                });
                correctedTags = { ticket_stage: result.ticket_stage };
            }
            corrections.push(`Missing stage → assigned '${correctedTags?.ticket_stage ?? 'implementation'}'`);
        }

        // Check consistency: category vs operation_type
        if (ticket.ticket_category && ticket.operation_type) {
            const expectedCategory = OPERATION_TYPE_MAP[ticket.operation_type];
            if (expectedCategory && expectedCategory !== ticket.ticket_category) {
                // Operation type is more reliable — correct the category
                corrections.push(
                    `Category '${ticket.ticket_category}' inconsistent with operation_type '${ticket.operation_type}' → corrected to '${expectedCategory}'`
                );
                if (!correctedTags) correctedTags = {};
                correctedTags.ticket_category = expectedCategory;
            }
        }

        // Check that related_ticket_ids in body are captured
        const fullText = `${ticket.title ?? ''} ${ticket.body ?? ''}`;
        const detectedRefs = extractTicketReferences(fullText);
        if (detectedRefs.length > 0) {
            let existingRefs: string[] = [];
            try {
                existingRefs = ticket.related_ticket_ids ? JSON.parse(ticket.related_ticket_ids) : [];
            } catch {
                existingRefs = [];
            }
            const missingRefs = detectedRefs.filter(r => !existingRefs.includes(r));
            if (missingRefs.length > 0) {
                corrections.push(`Found ${missingRefs.length} untracked ticket references: ${missingRefs.join(', ')}`);
                if (!correctedTags) correctedTags = {};
                correctedTags.related_ticket_ids = [...existingRefs, ...missingRefs];
            }
        }

        return {
            isValid: corrections.length === 0,
            corrections,
            correctedTags: corrections.length > 0 ? correctedTags : undefined
        };
    }

    /**
     * Map a category to its team queue.
     * Teams: Planning, CodingDirector, Verification, Orchestrator
     */
    getCategoryQueue(category: TicketCategory): string {
        switch (category) {
            case 'planning':
            case 'design':
            case 'data_model':
                return 'Planning';

            case 'coding':
            case 'infrastructure':
                return 'CodingDirector';

            case 'verification':
            case 'review':
                return 'Verification';

            case 'task_creation':
            case 'documentation':
            case 'communication':
            case 'boss_directive':
                return 'Orchestrator';

            default:
                return 'CodingDirector';
        }
    }

    // ============================================================
    // Private Scoring Methods
    // ============================================================

    /**
     * Score ticket text against all category keyword lists.
     * Returns the category with the highest match count.
     */
    private scoreCategoryKeywords(text: string): TicketCategory | null {
        let bestCategory: TicketCategory | null = null;
        let bestScore = 0;

        for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
            let score = 0;
            for (const kw of keywords) {
                if (text.includes(kw)) {
                    // Multi-word keywords get a bonus
                    score += kw.includes(' ') ? 2 : 1;
                }
            }
            if (score > bestScore) {
                bestScore = score;
                bestCategory = cat as TicketCategory;
            }
        }

        return bestScore >= 1 ? bestCategory : null;
    }

    /**
     * Score ticket text against all stage keyword lists.
     * Returns the stage with the highest match count.
     */
    private scoreStageKeywords(text: string): TicketStage | null {
        let bestStage: TicketStage | null = null;
        let bestScore = 0;

        for (const [stg, keywords] of Object.entries(STAGE_KEYWORDS)) {
            let score = 0;
            for (const kw of keywords) {
                if (text.includes(kw)) {
                    score += kw.includes(' ') ? 2 : 1;
                }
            }
            if (score > bestScore) {
                bestScore = score;
                bestStage = stg as TicketStage;
            }
        }

        return bestScore >= 1 ? bestStage : null;
    }

    /**
     * Derive a sensible stage from the category when no other signal exists.
     */
    private deriveStageFromCategory(category: TicketCategory): TicketStage {
        switch (category) {
            case 'planning':
            case 'communication':
                return 'analysis';
            case 'design':
            case 'data_model':
                return 'design';
            case 'coding':
            case 'infrastructure':
            case 'task_creation':
                return 'implementation';
            case 'verification':
                return 'testing';
            case 'review':
                return 'review';
            case 'documentation':
                return 'review';
            case 'boss_directive':
                return 'analysis';
            default:
                return 'implementation';
        }
    }
}
