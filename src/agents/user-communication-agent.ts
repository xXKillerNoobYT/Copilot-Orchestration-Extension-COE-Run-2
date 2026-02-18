/**
 * UserCommunicationAgent — v9.0 Agent #18
 *
 * L2 DomainOrchestrator that intercepts ALL agent-to-user messages.
 * Uses the user's profile to tailor communication style, route questions
 * through appropriate channels, and leverage Decision Memory + repeat answers
 * to minimize unnecessary user interruptions.
 *
 * Processing flow:
 * 1. Cache check (repeat answers + Decision Memory)
 * 2. Profile-based routing (programming level, known/unknown areas, preferences)
 * 3. AI mode gate (manual/suggest/smart/hybrid)
 * 4. Present to user (question box format with A/B/C options)
 * 5. Handle user response (record in Decision Memory, route back down)
 */

import { BaseAgent } from './base-agent';
import type { UserProfileManager } from '../core/user-profile-manager';
import {
    AgentType, AgentContext, AgentResponse,
    UserPreferenceAction, UserProgrammingLevel,
} from '../types';

/** AI mode for controlling question handling */
export type AIMode = 'manual' | 'suggest' | 'smart' | 'hybrid';

/** Classified question for routing */
export interface ClassifiedQuestion {
    /** Technical area this question relates to */
    area: string;
    /** Type of question */
    questionType: 'preference' | 'technical' | 'design' | 'architecture' | 'config';
    /** Confidence in classification (0-100) */
    confidence: number;
    /** Original question text */
    originalQuestion: string;
    /** Source agent that asked */
    sourceAgent: string;
    /** Escalation chain ID if applicable */
    escalationChainId: string | null;
}

/** Result of processing a user-bound question */
export interface QuestionRouteResult {
    /** How the question was handled */
    action: 'auto_answered' | 'auto_decided' | 'sent_to_user' | 'sent_to_research' | 'skipped' | 'bypassed';
    /** The answer (if auto-answered or auto-decided) */
    answer: string | null;
    /** Whether the user needs to see this */
    needsUserResponse: boolean;
    /** Rewritten question for the user (if applicable) */
    rewrittenQuestion: string | null;
    /** Options presented to the user */
    options: string[];
    /** Recommended option index (0-based) */
    recommendedOption: number;
    /** Context explanation for the user */
    contextExplanation: string | null;
}

export class UserCommunicationAgent extends BaseAgent {
    readonly name = 'User Communication Agent';
    readonly type = AgentType.UserCommunication;
    readonly systemPrompt: string;

    private userProfileManager: UserProfileManager | null = null;
    private aiMode: AIMode = 'hybrid';

    constructor(
        ...args: ConstructorParameters<typeof BaseAgent>
    ) {
        super(...args);

        // System prompt is dynamic — includes user profile context
        this.systemPrompt = this.buildSystemPrompt();
    }

    /**
     * Inject the user profile manager.
     */
    setUserProfileManager(upm: UserProfileManager): void {
        this.userProfileManager = upm;
    }

    /**
     * Set the AI mode for question handling.
     */
    setAIMode(mode: AIMode): void {
        this.aiMode = mode;
    }

    /**
     * Get current AI mode.
     */
    getAIMode(): AIMode {
        return this.aiMode;
    }

    // ==================== QUESTION ROUTING ====================

    /**
     * Route a question through the communication pipeline.
     * This is the main entry point — called when any agent needs to ask the user something.
     */
    async routeQuestion(
        question: string,
        sourceAgent: string,
        context: AgentContext,
        escalationChainId?: string
    ): Promise<QuestionRouteResult> {
        // Step 1: Cache check
        const cacheResult = this.checkCache(question);
        if (cacheResult) {
            return cacheResult;
        }

        // Step 2: Classify the question
        const classified = await this.classifyQuestion(question, sourceAgent, escalationChainId ?? null);

        // Step 3: Profile-based routing
        const profileRoute = this.applyProfileRouting(classified);
        if (profileRoute) {
            return profileRoute;
        }

        // Step 4: AI mode gate
        const modeResult = this.applyAIModeGate(classified);
        if (modeResult) {
            return modeResult;
        }

        // Step 5: Present to user (question survives all filters)
        return this.prepareForUser(classified, context);
    }

    // ==================== STEP 1: CACHE CHECK ====================

    /**
     * Check repeat answers and Decision Memory for cached responses.
     */
    private checkCache(question: string): QuestionRouteResult | null {
        if (!this.userProfileManager) return null;

        // Check repeat answers
        const topic = this.extractTopic(question);
        const repeatAnswer = this.userProfileManager.getRepeatAnswer(topic);
        if (repeatAnswer) {
            return {
                action: 'auto_answered',
                answer: repeatAnswer,
                needsUserResponse: false,
                rewrittenQuestion: null,
                options: [],
                recommendedOption: -1,
                contextExplanation: `Auto-answered from cached repeat answer for topic: ${topic}`,
            };
        }

        // Check Decision Memory (via database) — use empty string for plan-agnostic search
        const decisions = this.database.getDecisionsByTopic('', topic);
        if (decisions.length > 0) {
            const latest = decisions[0];
            const decision = String(latest.decision ?? '');
            const category = String(latest.category ?? 'unknown');
            return {
                action: 'auto_decided',
                answer: decision,
                needsUserResponse: false,
                rewrittenQuestion: null,
                options: [],
                recommendedOption: -1,
                contextExplanation: `Auto-decided from Decision Memory: "${decision}" (category: ${category})`,
            };
        }

        return null;
    }

    // ==================== STEP 2: CLASSIFY ====================

    /**
     * Classify a question's area and type for routing decisions.
     * Uses keyword-based classification (deterministic, no LLM needed).
     */
    private async classifyQuestion(
        question: string,
        sourceAgent: string,
        escalationChainId: string | null
    ): Promise<ClassifiedQuestion> {
        const lower = question.toLowerCase();

        // Determine technical area
        const area = this.detectArea(lower);

        // Determine question type
        const questionType = this.detectQuestionType(lower);

        return {
            area,
            questionType,
            confidence: 75, // Keyword-based classification has moderate confidence
            originalQuestion: question,
            sourceAgent,
            escalationChainId,
        };
    }

    /**
     * Detect the technical area from question text.
     */
    private detectArea(text: string): string {
        const areaKeywords: Record<string, string[]> = {
            'frontend': ['frontend', 'react', 'component', 'css', 'html', 'ui', 'button', 'form', 'layout', 'style'],
            'backend': ['backend', 'api', 'endpoint', 'server', 'route', 'middleware', 'controller', 'service'],
            'database': ['database', 'sql', 'schema', 'table', 'query', 'migration', 'index', 'column'],
            'auth': ['auth', 'login', 'password', 'token', 'jwt', 'session', 'permission', 'role'],
            'infra': ['deploy', 'docker', 'ci', 'pipeline', 'nginx', 'monitoring', 'build', 'config'],
            'testing': ['test', 'jest', 'mock', 'coverage', 'e2e', 'integration', 'unit'],
            'design': ['design', 'ux', 'ui', 'wireframe', 'prototype', 'color', 'typography', 'brand'],
            'architecture': ['architecture', 'pattern', 'structure', 'refactor', 'module', 'layer'],
        };

        let bestArea = 'general';
        let bestScore = 0;

        for (const [area, keywords] of Object.entries(areaKeywords)) {
            let score = 0;
            for (const kw of keywords) {
                if (text.includes(kw)) score++;
            }
            if (score > bestScore) {
                bestScore = score;
                bestArea = area;
            }
        }

        return bestArea;
    }

    /**
     * Detect the question type from question text.
     */
    private detectQuestionType(text: string): ClassifiedQuestion['questionType'] {
        if (text.includes('prefer') || text.includes('choose') || text.includes('option') || text.includes('which')) {
            return 'preference';
        }
        if (text.includes('how') || text.includes('implement') || text.includes('fix') || text.includes('debug')) {
            return 'technical';
        }
        if (text.includes('design') || text.includes('layout') || text.includes('look') || text.includes('appearance')) {
            return 'design';
        }
        if (text.includes('architecture') || text.includes('structure') || text.includes('pattern') || text.includes('organize')) {
            return 'architecture';
        }
        if (text.includes('config') || text.includes('setting') || text.includes('parameter') || text.includes('environment')) {
            return 'config';
        }
        return 'preference'; // Default
    }

    // ==================== STEP 3: PROFILE ROUTING ====================

    /**
     * Apply profile-based routing rules.
     */
    private applyProfileRouting(classified: ClassifiedQuestion): QuestionRouteResult | null {
        if (!this.userProfileManager) return null;

        const area = classified.area;

        // Check "always_decide" preference
        if (this.userProfileManager.shouldAutoDecide(area)) {
            return {
                action: 'auto_decided',
                answer: null, // Will be decided by AI
                needsUserResponse: false,
                rewrittenQuestion: null,
                options: [],
                recommendedOption: 0,
                contextExplanation: `Auto-decided: area "${area}" is in your "always decide" list.`,
            };
        }

        // Check "never_touch" preference
        if (this.userProfileManager.shouldNeverTouch(area)) {
            return {
                action: 'skipped',
                answer: null,
                needsUserResponse: false,
                rewrittenQuestion: null,
                options: [],
                recommendedOption: -1,
                contextExplanation: `Skipped: area "${area}" is in your "never touch" list.`,
            };
        }

        // Design question with direct element reference → bypass to user
        if (classified.questionType === 'design' && classified.originalQuestion.includes('element')) {
            return {
                action: 'bypassed',
                answer: null,
                needsUserResponse: true,
                rewrittenQuestion: classified.originalQuestion,
                options: [],
                recommendedOption: -1,
                contextExplanation: 'Design question with element reference — bypassed directly to you.',
            };
        }

        return null; // Continue to AI mode gate
    }

    // ==================== STEP 4: AI MODE GATE ====================

    /**
     * Apply AI mode-based routing.
     */
    private applyAIModeGate(classified: ClassifiedQuestion): QuestionRouteResult | null {
        if (this.aiMode === 'manual') {
            // Always show to user — never auto-decide
            return null;
        }

        if (this.aiMode === 'smart') {
            // Auto-pick recommended option unless uncertainty is high
            if (classified.confidence >= 70) {
                return {
                    action: 'auto_decided',
                    answer: null,
                    needsUserResponse: false,
                    rewrittenQuestion: null,
                    options: [],
                    recommendedOption: 0,
                    contextExplanation: `Smart mode: auto-decided (confidence: ${classified.confidence}%)`,
                };
            }
            return null; // Show to user if uncertain
        }

        if (this.aiMode === 'hybrid' && this.userProfileManager) {
            const level = this.userProfileManager.getProgrammingLevel();

            // Noob/New: always show (they need to learn)
            if (level === UserProgrammingLevel.Noob || level === UserProgrammingLevel.New) {
                return null;
            }

            // Really Good/Expert: auto-decide most, only show ambiguous
            if (level === UserProgrammingLevel.ReallyGood || level === UserProgrammingLevel.Expert) {
                if (classified.confidence >= 60) {
                    return {
                        action: 'auto_decided',
                        answer: null,
                        needsUserResponse: false,
                        rewrittenQuestion: null,
                        options: [],
                        recommendedOption: 0,
                        contextExplanation: `Hybrid mode (${level}): auto-decided for non-ambiguous question.`,
                    };
                }
                return null;
            }

            // Getting Around/Good: auto-decide for simple, show complex
            if (classified.questionType === 'config' || classified.questionType === 'preference') {
                if (classified.confidence >= 75) {
                    return {
                        action: 'auto_decided',
                        answer: null,
                        needsUserResponse: false,
                        rewrittenQuestion: null,
                        options: [],
                        recommendedOption: 0,
                        contextExplanation: `Hybrid mode (${level}): auto-decided for simple ${classified.questionType} question.`,
                    };
                }
            }
        }

        // 'suggest' mode: always show to user with recommendation
        return null;
    }

    // ==================== STEP 5: PREPARE FOR USER ====================

    /**
     * Prepare a question for presentation to the user.
     * Rewrites based on programming level and communication style.
     */
    private prepareForUser(
        classified: ClassifiedQuestion,
        _context: AgentContext
    ): QuestionRouteResult {
        const rewritten = this.rewriteForUser(classified.originalQuestion, classified.area);

        return {
            action: 'sent_to_user',
            answer: null,
            needsUserResponse: true,
            rewrittenQuestion: rewritten,
            options: [],
            recommendedOption: 0,
            contextExplanation: `Question from ${classified.sourceAgent} about ${classified.area} (${classified.questionType})`,
        };
    }

    /**
     * Rewrite a question based on user's programming level and communication style.
     */
    rewriteForUser(question: string, area: string): string {
        if (!this.userProfileManager) return question;

        const level = this.userProfileManager.getProgrammingLevel();
        const style = this.userProfileManager.getCommunicationStyle();
        const isKnown = this.userProfileManager.isAreaKnown(area);

        // For technical style + known area: keep as-is
        if (style === 'technical' && isKnown) {
            return question;
        }

        // For simple style or unknown area: prepend context
        let prefix = '';
        if (!isKnown) {
            prefix = `[About ${area}] `;
        }

        // For beginners, add level-appropriate context
        if (level === UserProgrammingLevel.Noob || level === UserProgrammingLevel.New) {
            if (style === 'simple') {
                prefix += '(Simplified) ';
            }
        }

        return prefix + question;
    }

    // ==================== RESPONSE HANDLING ====================

    /**
     * Handle a user's response to a question.
     */
    async handleUserResponse(
        response: string,
        questionArea: string,
        originalQuestion: string
    ): Promise<{ answer: string; shouldRecordDecision: boolean; shouldCreateTicket: boolean }> {
        const lowerResponse = response.toLowerCase().trim();

        // "I Don't Know" → create research ticket
        if (lowerResponse === "i don't know" || lowerResponse === 'idk') {
            return {
                answer: response,
                shouldRecordDecision: false,
                shouldCreateTicket: true,
            };
        }

        // "Don't Care" / "You Decide" → AI picks
        if (lowerResponse === "don't care" || lowerResponse === 'you decide') {
            return {
                answer: '[AI Auto-Decided]',
                shouldRecordDecision: true,
                shouldCreateTicket: false,
            };
        }

        // Direct answer → record in Decision Memory
        return {
            answer: response,
            shouldRecordDecision: true,
            shouldCreateTicket: false,
        };
    }

    // ==================== HELPERS ====================

    /**
     * Extract a topic from a question for cache lookup.
     */
    private extractTopic(question: string): string {
        // Simple extraction: first 5 significant words
        const words = question
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .split(/\s+/)
            .filter(w => w.length > 3);
        return words.slice(0, 5).join(' ');
    }

    /**
     * Build the dynamic system prompt including user profile context.
     */
    private buildSystemPrompt(): string {
        const profileSection = this.userProfileManager
            ? this.userProfileManager.buildContextSummary()
            : 'User profile not yet loaded.';

        return `You are the User Communication Orchestrator for the Copilot Orchestration Extension (COE).

## Your ONE Job
Intercept ALL agent-to-user messages and ensure they are appropriate for the user's programming level, communication style, and preferences. You are the final gatekeeper between the AI system and the human user.

## User Profile
${profileSection}

## AI Mode: ${this.aiMode}
- manual: Always show questions to user (never auto-decide)
- suggest: Show questions with recommendation highlighted, user decides
- smart: Auto-pick recommended option unless uncertainty is high
- hybrid: Use programming level to set auto-decide threshold

## Question Box Format
When presenting questions to the user, format them as:
- Title (rewritten for user level)
- Context (brief explanation)
- Options A/B/C with one recommended
- "Other" free text input
- "I Don't Know" and "Don't Care / You Decide" buttons

## Rules
1. NEVER reveal internal agent names or technical pipeline details to the user
2. ALWAYS rewrite questions for the user's programming level
3. ALWAYS check Decision Memory before bothering the user
4. RESPECT "always decide" and "never touch" area preferences
5. Log every auto-decision in Decision Memory
6. If uncertain, err on the side of asking the user`;
    }

    /**
     * Override processMessage to update system prompt dynamically.
     */
    async processMessage(message: string, context: AgentContext): Promise<AgentResponse> {
        // Refresh system prompt with latest profile data
        (this as { systemPrompt: string }).systemPrompt = this.buildSystemPrompt();
        return super.processMessage(message, context);
    }

    /**
     * Override parseResponse to extract structured routing info.
     */
    protected async parseResponse(content: string, context: AgentContext): Promise<AgentResponse> {
        return {
            content,
            actions: [],
        };
    }
}
