import { BaseAgent } from './base-agent';
import { AgentType, AgentContext, AgentResponse, AgentAction, Ticket } from '../types';

/**
 * Review Agent — Intelligent ticket review and auto-approval.
 *
 * Handles tickets that have been processed by other agents:
 * - Auto-approves simple tickets (scaffolding, page creation) when score >= 70
 * - Auto-approves moderate tickets (design changes) when score >= 85
 * - Always flags complex tickets (code generation, architecture) for user review
 * - Scores deliverables on clarity, completeness, and correctness (0-100 each)
 */
export class ReviewAgent extends BaseAgent {
    readonly name = 'Review Agent';
    readonly type = AgentType.Review;
    readonly systemPrompt = `You are the Review Agent for the Copilot Orchestration Extension (COE).

## YOUR ONE JOB
Review completed ticket deliverables and decide: auto-approve or flag for user review.

## REVIEW PROCESS
1. Read the ticket title, body, acceptance criteria, and the agent's response.
2. Note the pre-classified complexity (simple, moderate, or complex).
3. Score the deliverable on three dimensions (0-100 each):
   - clarity: Is the deliverable clear and well-structured?
   - completeness: Does it address all acceptance criteria?
   - correctness: Is the content technically accurate?
4. Apply the auto-approval decision matrix.

## AUTO-APPROVAL MATRIX
| Complexity | Min Score (avg of 3) | Auto-Approve? |
|-----------|---------------------|---------------|
| simple    | >= 70               | YES           |
| moderate  | >= 85               | YES           |
| complex   | NEVER               | NO — always flag for user |

## REQUIRED JSON OUTPUT
Respond with ONLY valid JSON:
{
  "complexity": "simple|moderate|complex",
  "scores": {
    "clarity": <0-100>,
    "completeness": <0-100>,
    "correctness": <0-100>
  },
  "average_score": <0-100>,
  "auto_approved": true|false,
  "reason": "Why this was approved or flagged",
  "issues": ["List of specific issues found, if any"],
  "suggestions": ["Improvement suggestions, if any"]
}

## RULES
- NEVER auto-approve complex tickets. Always flag them for user review.
- Score each dimension independently. Do not inflate.
- If acceptance_criteria is missing, deduct 20 points from completeness.
- Base scoring on the actual deliverable content, not assumptions.
- If the deliverable is empty or trivially short, score 0 across all dimensions.`;

    /** Title patterns that indicate complexity */
    private static readonly COMPLEX_PATTERNS = [
        'implement', 'build', 'architect', 'security', 'authentication',
        'authorization', 'migration', 'refactor architecture',
    ];
    private static readonly SIMPLE_PATTERNS = [
        'scaffold', 'create page', 'add component', 'add token',
        'update text', 'fix typo', 'rename', 'page created',
    ];

    /**
     * Classify ticket complexity deterministically (no LLM needed).
     */
    classifyComplexity(ticket: Ticket): 'simple' | 'moderate' | 'complex' {
        const title = ticket.title.toLowerCase();
        const deliverableType = ticket.deliverable_type ?? '';
        const opType = ticket.operation_type || '';

        // Code generation is always complex
        if (deliverableType === 'code_generation') return 'complex';

        // Check complex patterns
        for (const pattern of ReviewAgent.COMPLEX_PATTERNS) {
            if (title.includes(pattern)) return 'complex';
        }

        // Communication and simple ops
        if (deliverableType === 'communication') return 'simple';
        if (opType === 'page_creation' || opType === 'scaffold') return 'simple';

        // Check simple patterns
        for (const pattern of ReviewAgent.SIMPLE_PATTERNS) {
            if (title.includes(pattern)) return 'simple';
        }

        // Default: moderate
        return 'moderate';
    }

    /**
     * Determine if a ticket should be auto-approved based on complexity and score.
     */
    shouldAutoApprove(complexity: 'simple' | 'moderate' | 'complex', averageScore: number): boolean {
        if (complexity === 'complex') return false;
        if (complexity === 'simple') return averageScore >= 70;
        if (complexity === 'moderate') return averageScore >= 85;
        return false;
    }

    /**
     * Review a ticket's deliverable and produce approval/flag decision.
     * Convenience method wrapping processMessage with review-specific context.
     */
    async reviewTicket(ticket: Ticket, agentResponse: string): Promise<AgentResponse> {
        const complexity = this.classifyComplexity(ticket);

        const prompt = [
            `Review this ticket deliverable:`,
            ``,
            `Ticket: TK-${ticket.ticket_number}: ${ticket.title}`,
            `Body: ${ticket.body || '(none)'}`,
            `Acceptance Criteria: ${ticket.acceptance_criteria || '(none)'}`,
            `Deliverable Type: ${ticket.deliverable_type ?? 'unknown'}`,
            `Operation Type: ${ticket.operation_type}`,
            `Pre-classified Complexity: ${complexity}`,
            ``,
            `Agent Response:`,
            agentResponse.substring(0, 3000),
        ].join('\n');

        const context: AgentContext = { conversationHistory: [], ticket };
        return this.processMessage(prompt, context);
    }

    protected async parseResponse(content: string, _context: AgentContext): Promise<AgentResponse> {
        const actions: AgentAction[] = [];

        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                const avgScore = parsed.average_score ?? 0;
                const autoApproved = parsed.auto_approved ?? false;
                const complexity = parsed.complexity ?? 'unknown';

                const issues: string[] = parsed.issues || [];
                const suggestions: string[] = parsed.suggestions || [];
                const scores = parsed.scores || {};

                let summary: string;
                if (autoApproved) {
                    summary = `Auto-approved (${complexity}, score: ${avgScore}/100): ${parsed.reason || 'Meets quality threshold'}`;
                } else {
                    // Build detailed review summary for user consumption
                    const parts: string[] = [];
                    parts.push(`Flagged for user review (${complexity}, score: ${avgScore}/100): ${parsed.reason || 'Below threshold or complex'}`);
                    if (scores.clarity !== undefined || scores.completeness !== undefined || scores.correctness !== undefined) {
                        parts.push(`\nScores: clarity=${scores.clarity ?? '?'}, completeness=${scores.completeness ?? '?'}, correctness=${scores.correctness ?? '?'}`);
                    }
                    if (issues.length > 0) {
                        parts.push(`\nIssues: ${issues.join('; ')}`);
                    }
                    if (suggestions.length > 0) {
                        parts.push(`\nSuggestions: ${suggestions.join('; ')}`);
                    }
                    summary = parts.join('');
                }

                if (!autoApproved) {
                    actions.push({
                        type: 'escalate',
                        payload: {
                            reason: parsed.reason,
                            scores: parsed.scores,
                            issues,
                            suggestions,
                        },
                    });
                }

                return {
                    content: summary,
                    confidence: avgScore,
                    actions,
                };
            }
        } catch {
            // v4.1: JSON parse failure — conservative approach: flag for user review
            // rather than auto-passing (which would happen if actions array is empty)
            /* istanbul ignore next */
            actions.push({
                type: 'escalate',
                payload: {
                    reason: 'Review agent returned unparseable response — flagging for manual review',
                    raw_content: content.substring(0, 500),
                },
            });
        }

        return { content, actions };
    }
}
