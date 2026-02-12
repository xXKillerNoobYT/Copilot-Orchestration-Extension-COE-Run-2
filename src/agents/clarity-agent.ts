import { BaseAgent } from './base-agent';
import { AgentType, AgentContext, AgentResponse, TicketStatus } from '../types';

export class ClarityAgent extends BaseAgent {
    readonly name = 'Clarity Agent';
    readonly type = AgentType.Clarity;
    readonly systemPrompt = `You are the Clarity Agent for the Copilot Orchestration Extension (COE).

## Your ONE Job
Review every reply in the ticket system and score it for clarity, completeness, and actionability. Your goal is to ensure that when a reply reaches a coding agent, it contains zero ambiguity.

## Scoring Scale
- **85–100 (Clear)**: The reply fully answers the question. A coding agent can act on it immediately without asking anything else. Mark as "clear".
- **70–84 (Needs one clarification)**: The reply mostly answers the question but has 1 vague or missing detail. Ask ONE specific follow-up question.
- **0–69 (Significantly unclear)**: The reply is incomplete, contradictory, or too vague to act on. Ask up to 3 specific follow-up questions.

## Response Format
You MUST respond in EXACTLY this format (3 fields, each on its own line):

SCORE: [Integer 0-100]
ASSESSMENT: [clear OR needs_clarification]
FEEDBACK: [If needs_clarification: list specific questions, numbered 1-3. If clear: write "No issues — reply is actionable."]

## Rules
1. Score >= 85 → ASSESSMENT must be "clear"
2. Score < 85 → ASSESSMENT must be "needs_clarification"
3. Maximum 3 follow-up questions per round (fewer is better)
4. Follow-up questions must be SPECIFIC — never ask "can you elaborate?" Instead: "What data type should the metadata column use: JSON string, JSONB, or TEXT?"
5. Maximum 5 clarification rounds per ticket. After 5 rounds, the ticket auto-escalates to the user.
6. Never change the ticket's priority — only its clarity status
7. Each follow-up question must reference what specifically was unclear in the reply

## Example — Clear
SCORE: 92
ASSESSMENT: clear
FEEDBACK: No issues — reply is actionable.

## Example — Needs one clarification
SCORE: 74
ASSESSMENT: needs_clarification
FEEDBACK: 1. You said "add a metadata column" but didn't specify the data type. Should it be JSON, TEXT, or BLOB?

## Example — Significantly unclear
SCORE: 45
ASSESSMENT: needs_clarification
FEEDBACK: 1. Which table should the new column be added to? You mentioned "the main table" but there are 9 tables. 2. Should the column be nullable or required? 3. What is the maximum size of data this column needs to store?`;

    async reviewReply(ticketId: string, replyBody: string): Promise<{ score: number; clear: boolean; feedback: string }> {
        const ticket = this.database.getTicket(ticketId);
        if (!ticket) {
            return { score: 0, clear: false, feedback: 'Ticket not found' };
        }

        const replies = this.database.getTicketReplies(ticketId);
        const clarificationRounds = replies.filter(r => r.author === this.name).length;

        // Check if max rounds exceeded
        if (clarificationRounds >= 5) {
            this.database.updateTicket(ticketId, { status: TicketStatus.Escalated });
            this.database.addAuditLog(this.name, 'escalated',
                `Ticket TK-${ticket.ticket_number} escalated after 5 clarification rounds`);
            return { score: 0, clear: false, feedback: 'Maximum clarification rounds reached. Escalating.' };
        }

        const context: AgentContext = {
            ticket,
            conversationHistory: [],
        };

        try {
            const response = await this.processMessage(
                `Review this ticket reply for clarity and completeness:\n\nTicket: ${ticket.title}\nOriginal question: ${ticket.body}\nReply: ${replyBody}`,
                context
            );

            const scoreMatch = response.content.match(/SCORE:\s*(\d+)/i);
            const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 50;
            const clear = score >= 85;

            const feedbackMatch = response.content.match(/FEEDBACK:\s*(.*?)$/is);
            const feedback = feedbackMatch ? feedbackMatch[1].trim() : '';

            // Record clarity score on the reply
            this.database.addTicketReply(ticketId, this.name,
                clear ? `Clear (${score}/100)` : `Needs clarification (${score}/100): ${feedback}`,
                score
            );

            if (clear) {
                this.database.updateTicket(ticketId, { status: TicketStatus.Resolved });
            } else {
                this.database.updateTicket(ticketId, { status: TicketStatus.InReview });
            }

            return { score, clear, feedback };
        } catch (error) {
            this.outputChannel.appendLine(`Clarity review error: ${error}`);
            return { score: 50, clear: false, feedback: 'Error during clarity review' };
        }
    }
}
