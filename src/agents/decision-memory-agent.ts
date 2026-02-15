import { BaseAgent } from './base-agent';
import { AgentType, AgentContext, AgentResponse, DecisionMatchResult } from '../types';

/**
 * Decision Memory Agent — Tracks user decisions, detects duplicates,
 * finds conflicts, and auto-answers questions when possible.
 *
 * This agent:
 * - Stores and indexes every user decision by category and topic
 * - Detects when a new question has already been answered (exact match)
 * - Finds similar past decisions that may inform the current question
 * - Catches conflicting decisions (same topic, contradictory answer)
 * - Classifies questions into categories for efficient lookup
 * - Uses fast keyword matching first, falling back to LLM only when needed
 */
export class DecisionMemoryAgent extends BaseAgent {
    readonly name = 'Decision Memory';
    readonly type = AgentType.DecisionMemory;
    readonly systemPrompt = `YOUR ONE JOB: Compare a new question against existing user decisions to find matches and conflicts.

WHEN COMPARING DECISIONS:
- Exact match: Same topic, same question intent (even if worded differently)
- Similar match: Related topic, overlapping concern
- Conflict: Same topic, contradictory answer
- None: Unrelated

REQUIRED JSON OUTPUT:
{
    "match_type": "exact|similar|conflict|none",
    "confidence": 0.0-1.0,
    "matched_decision_id": "<id or null>",
    "category": "<detected category>",
    "topic": "<detected topic keyword>",
    "reasoning": "<why this is a match/conflict/none>"
}`;

    /** Common words to filter out during keyword extraction */
    private static readonly STOP_WORDS = new Set([
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
        'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
        'into', 'through', 'during', 'before', 'after', 'above', 'below',
        'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
        'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
        'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
        'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
        'just', 'because', 'but', 'and', 'or', 'if', 'while', 'about', 'up',
        'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
        'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'you', 'your',
        'he', 'him', 'his', 'she', 'her', 'it', 'its', 'they', 'them', 'their',
        'use', 'using', 'used', 'want', 'like', 'also', 'well',
    ]);

    /** Keyword-to-category mapping for fast classification */
    private static readonly CATEGORY_KEYWORDS: Record<string, string[]> = {
        authentication: ['auth', 'login', 'password', 'oauth', 'jwt', 'session', 'token', 'signup', 'signin', 'logout', 'credentials', 'sso'],
        database: ['database', 'sql', 'table', 'schema', 'model', 'migration', 'query', 'orm', 'postgres', 'mysql', 'sqlite', 'mongo', 'redis'],
        styling: ['css', 'style', 'color', 'theme', 'font', 'layout', 'spacing', 'margin', 'padding', 'tailwind', 'sass', 'scss'],
        ui_ux: ['ui', 'ux', 'button', 'form', 'input', 'page', 'component', 'modal', 'dialog', 'tooltip', 'dropdown', 'menu', 'navigation', 'sidebar', 'header', 'footer', 'widget'],
        api_design: ['api', 'endpoint', 'rest', 'graphql', 'route', 'request', 'response', 'webhook', 'cors', 'middleware', 'http'],
        testing: ['test', 'jest', 'unit', 'integration', 'e2e', 'coverage', 'mock', 'fixture', 'assertion', 'playwright', 'cypress'],
        deployment: ['deploy', 'docker', 'ci', 'cd', 'hosting', 'container', 'kubernetes', 'aws', 'azure', 'vercel', 'netlify', 'pipeline', 'build'],
        architecture: ['react', 'vue', 'angular', 'framework', 'library', 'pattern', 'module', 'service', 'layer', 'microservice', 'monolith', 'serverless', 'mvc', 'mvvm'],
        data_model: ['entity', 'field', 'relationship', 'foreign', 'key', 'index', 'constraint', 'validation', 'type', 'enum'],
        behavior: ['behavior', 'behaviour', 'logic', 'rule', 'workflow', 'state', 'machine', 'transition', 'event', 'trigger', 'handler'],
        accessibility: ['accessibility', 'a11y', 'aria', 'screen', 'reader', 'contrast', 'keyboard', 'focus', 'alt', 'wcag'],
        performance: ['performance', 'speed', 'cache', 'lazy', 'load', 'optimize', 'bundle', 'minify', 'compress', 'latency', 'throughput'],
        security: ['security', 'encrypt', 'hash', 'xss', 'csrf', 'injection', 'sanitize', 'cors', 'permission', 'role', 'rbac', 'vulnerability'],
    };

    /**
     * Find a matching decision for a given question within a plan.
     *
     * Flow:
     * 1. Fetch all active decisions for the plan
     * 2. Fast-path: keyword matching to find candidates
     * 3. If keyword candidates found: use LLM for semantic comparison
     * 4. Return DecisionMatchResult
     */
    async findMatchingDecision(planId: string, question: string): Promise<DecisionMatchResult> {
        const noMatch: DecisionMatchResult = {
            exactMatch: false,
            similarMatch: false,
            potentialConflict: false,
        };

        const rows = this.database.getActiveDecisions(planId);
        if (!rows || rows.length === 0) {
            return noMatch;
        }

        // Extract keywords from the question
        const questionKeywords = this.extractKeywords(question);

        // Fast-path keyword matching: find candidate decisions with topic overlap
        const candidates: Array<{ row: Record<string, unknown>; overlapCount: number }> = [];
        for (const row of rows) {
            const topic = String(row.topic ?? '').toLowerCase();
            const decision = String(row.decision ?? '').toLowerCase();
            const category = String(row.category ?? '').toLowerCase();

            const topicWords = topic.split(/\s+/).filter(w => w.length > 1);
            const decisionWords = this.extractKeywords(decision);
            const allWords = new Set([...topicWords, ...decisionWords, category]);

            let overlapCount = 0;
            for (const kw of questionKeywords) {
                if (allWords.has(kw)) {
                    overlapCount++;
                }
            }

            if (overlapCount >= 2) {
                candidates.push({ row, overlapCount });
            }
        }

        // Sort candidates by overlap (descending)
        candidates.sort((a, b) => b.overlapCount - a.overlapCount);

        // If we have strong keyword candidates (3+ matching words), use LLM for semantic comparison
        const strongCandidates = candidates.filter(c => c.overlapCount >= 3);
        if (strongCandidates.length > 0) {
            const candidateDescriptions = strongCandidates.slice(0, 5).map(c => {
                return `ID: ${c.row.id}\nCategory: ${c.row.category}\nTopic: ${c.row.topic}\nDecision: ${c.row.decision}`;
            }).join('\n---\n');

            const prompt = `Compare this NEW QUESTION against the EXISTING DECISIONS below.\n\nNEW QUESTION: ${question}\n\nEXISTING DECISIONS:\n${candidateDescriptions}\n\nDoes the new question match, relate to, or conflict with any existing decision? Respond with the required JSON.`;

            try {
                const context: AgentContext = { conversationHistory: [] };
                const response = await this.processMessage(prompt, context);
                const parsed = this.extractJson(response.content);

                if (parsed) {
                    const matchType = parsed.match_type as string;
                    const confidence = Number(parsed.confidence ?? 0);
                    const matchedId = parsed.matched_decision_id as string | null;

                    // Find the matched decision row
                    const matchedRow = matchedId
                        ? strongCandidates.find(c => c.row.id === matchedId)?.row
                        : strongCandidates[0]?.row;

                    const matchedDecision = matchedRow ? this.rowToDecision(matchedRow) : undefined;

                    if (matchType === 'exact' && confidence > 0.8) {
                        return {
                            exactMatch: true,
                            similarMatch: false,
                            potentialConflict: false,
                            decision: matchedDecision,
                        };
                    }

                    if (matchType === 'similar') {
                        return {
                            exactMatch: false,
                            similarMatch: true,
                            potentialConflict: false,
                            decision: matchedDecision,
                        };
                    }

                    if (matchType === 'conflict') {
                        return {
                            exactMatch: false,
                            similarMatch: false,
                            potentialConflict: true,
                            conflictingDecision: matchedDecision,
                        };
                    }
                }
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                this.outputChannel.appendLine(`[Decision Memory] LLM match error: ${msg}`);
            }
        }

        // Weaker keyword candidates (2 word overlap) — mark as similar without LLM
        if (candidates.length > 0) {
            const bestCandidate = candidates[0];
            if (bestCandidate.overlapCount >= 2) {
                return {
                    exactMatch: false,
                    similarMatch: true,
                    potentialConflict: false,
                    decision: this.rowToDecision(bestCandidate.row),
                };
            }
        }

        return noMatch;
    }

    /**
     * Detect if a new answer conflicts with existing decisions on the same topic.
     */
    async detectConflict(planId: string, topic: string, newAnswer: string): Promise<DecisionMatchResult> {
        const noConflict: DecisionMatchResult = {
            exactMatch: false,
            similarMatch: false,
            potentialConflict: false,
        };

        const rows = this.database.getDecisionsByTopic(planId, topic);
        if (!rows || rows.length === 0) {
            return noConflict;
        }

        const existingDecisions = rows.slice(0, 5).map(r => {
            return `ID: ${r.id}\nTopic: ${r.topic}\nDecision: ${r.decision}`;
        }).join('\n---\n');

        const prompt = `Does this NEW ANSWER conflict with any of the EXISTING DECISIONS on the same topic?\n\nTOPIC: ${topic}\nNEW ANSWER: ${newAnswer}\n\nEXISTING DECISIONS:\n${existingDecisions}\n\nRespond with the required JSON. Focus on detecting contradictions.`;

        try {
            const context: AgentContext = { conversationHistory: [] };
            const response = await this.processMessage(prompt, context);
            const parsed = this.extractJson(response.content);

            if (parsed) {
                const matchType = parsed.match_type as string;
                const matchedId = parsed.matched_decision_id as string | null;

                const conflictRow = matchedId
                    ? rows.find(r => r.id === matchedId)
                    : rows[0];

                if (matchType === 'conflict') {
                    return {
                        exactMatch: false,
                        similarMatch: false,
                        potentialConflict: true,
                        conflictingDecision: conflictRow ? this.rowToDecision(conflictRow) : undefined,
                    };
                }

                if (matchType === 'exact') {
                    return {
                        exactMatch: true,
                        similarMatch: false,
                        potentialConflict: false,
                        decision: conflictRow ? this.rowToDecision(conflictRow) : undefined,
                    };
                }

                if (matchType === 'similar') {
                    return {
                        exactMatch: false,
                        similarMatch: true,
                        potentialConflict: false,
                        decision: conflictRow ? this.rowToDecision(conflictRow) : undefined,
                    };
                }
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`[Decision Memory] Conflict detection error: ${msg}`);
        }

        return noConflict;
    }

    /**
     * Classify a question into a category and extract its topic.
     * Uses keyword matching first, falls back to LLM.
     */
    async classifyQuestion(question: string): Promise<{ category: string; topic: string }> {
        const lowerQuestion = question.toLowerCase();
        const words = this.extractKeywords(question);

        // Keyword-based classification
        let bestCategory = '';
        let bestScore = 0;

        for (const [category, keywords] of Object.entries(DecisionMemoryAgent.CATEGORY_KEYWORDS)) {
            let score = 0;
            for (const kw of keywords) {
                // Check both individual words and substring presence
                if (words.has(kw) || lowerQuestion.includes(kw)) {
                    score++;
                }
            }
            if (score > bestScore) {
                bestScore = score;
                bestCategory = category;
            }
        }

        // Extract topic: the most relevant noun/phrase from the question
        const topic = this.extractTopic(question, words);

        // If keyword matching found a strong match, return it
        if (bestScore >= 1 && bestCategory) {
            return { category: bestCategory, topic };
        }

        // Fall back to LLM classification
        try {
            const categories = Object.keys(DecisionMemoryAgent.CATEGORY_KEYWORDS).join(', ');
            const prompt = `Classify this question into one category and extract the main topic keyword.\n\nQUESTION: ${question}\n\nCATEGORIES: ${categories}\n\nRespond with the required JSON.`;

            const context: AgentContext = { conversationHistory: [] };
            const response = await this.processMessage(prompt, context);
            const parsed = this.extractJson(response.content);

            if (parsed) {
                return {
                    category: String(parsed.category ?? 'general'),
                    topic: String(parsed.topic ?? topic),
                };
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`[Decision Memory] Classification error: ${msg}`);
        }

        return { category: bestCategory || 'general', topic };
    }

    /**
     * Look up the most recent active decision for a given topic within a plan.
     * Returns the decision details if found, null otherwise.
     */
    async lookupDecision(planId: string, topic: string): Promise<{
        found: boolean;
        decision: string;
        confidence: number;
        questionId: string;
        category: string;
        decidedAt: string;
    } | null> {
        const rows = this.database.getDecisionsByTopic(planId, topic);
        if (!rows || rows.length === 0) {
            return null;
        }

        // Return the most recent active decision (rows are ordered DESC by created_at)
        const row = rows[0];
        return {
            found: true,
            decision: String(row.decision ?? ''),
            confidence: 1.0,
            questionId: String(row.question_id ?? ''),
            category: String(row.category ?? ''),
            decidedAt: String(row.created_at ?? ''),
        };
    }

    /**
     * Parse the LLM response to extract structured data.
     * Overrides BaseAgent.parseResponse to handle JSON extraction.
     */
    protected async parseResponse(content: string, _context: AgentContext): Promise<AgentResponse> {
        const parsed = this.extractJson(content);

        if (parsed) {
            const matchType = parsed.match_type ?? 'none';
            const confidence = parsed.confidence ?? 0;
            const reasoning = parsed.reasoning ?? '';
            const category = parsed.category ?? '';
            const topic = parsed.topic ?? '';

            const summary = `Match: ${matchType} (confidence: ${confidence})\nCategory: ${category}\nTopic: ${topic}\nReasoning: ${reasoning}`;

            return {
                content: summary,
                confidence: Number(confidence),
                actions: [],
            };
        }

        return { content, actions: [] };
    }

    /**
     * Extract keywords from text by splitting, lowering, and filtering stop words.
     */
    private extractKeywords(text: string): Set<string> {
        const words = text.toLowerCase()
            .replace(/[^a-z0-9\s_-]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 1 && !DecisionMemoryAgent.STOP_WORDS.has(w));
        return new Set(words);
    }

    /**
     * Extract the most relevant topic from a question.
     * Picks the longest non-stop-word as the primary topic,
     * preferring words that appear in category keywords.
     */
    private extractTopic(question: string, keywords: Set<string>): string {
        const allCategoryWords = new Set<string>();
        for (const words of Object.values(DecisionMemoryAgent.CATEGORY_KEYWORDS)) {
            for (const w of words) {
                allCategoryWords.add(w);
            }
        }

        // Prefer category-relevant keywords as topic
        const relevant: string[] = [];
        const general: string[] = [];

        for (const kw of keywords) {
            if (allCategoryWords.has(kw)) {
                relevant.push(kw);
            } else {
                general.push(kw);
            }
        }

        // Take the longest relevant keyword, or the longest general keyword
        if (relevant.length > 0) {
            relevant.sort((a, b) => b.length - a.length);
            return relevant[0];
        }

        if (general.length > 0) {
            general.sort((a, b) => b.length - a.length);
            return general[0];
        }

        // Fallback: first few meaningful words
        return question.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).slice(0, 3).join(' ');
    }

    /**
     * Extract JSON from LLM response content.
     * Handles responses that may contain markdown or extra text around the JSON.
     */
    private extractJson(content: string): Record<string, unknown> | null {
        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch {
            // JSON parse failed
        }
        return null;
    }

    /**
     * Convert a raw database row to a UserDecision object.
     */
    private rowToDecision(row: Record<string, unknown>): {
        id: string;
        plan_id: string;
        category: string;
        topic: string;
        decision: string;
        question_id: string | null;
        ticket_id: string | null;
        superseded_by: string | null;
        is_active: boolean;
        context: string | null;
        affected_entities: string | null;
        created_at: string;
        updated_at: string;
    } {
        return {
            id: String(row.id ?? ''),
            plan_id: String(row.plan_id ?? ''),
            category: String(row.category ?? ''),
            topic: String(row.topic ?? ''),
            decision: String(row.decision ?? ''),
            question_id: row.question_id != null ? String(row.question_id) : null,
            ticket_id: row.ticket_id != null ? String(row.ticket_id) : null,
            superseded_by: row.superseded_by != null ? String(row.superseded_by) : null,
            is_active: Boolean(row.is_active),
            context: row.context != null ? String(row.context) : null,
            affected_entities: row.affected_entities != null ? String(row.affected_entities) : null,
            created_at: String(row.created_at ?? ''),
            updated_at: String(row.updated_at ?? ''),
        };
    }
}
