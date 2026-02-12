import { BaseAgent } from './base-agent';
import { AgentType, AgentContext, AgentResponse, TicketStatus } from '../types';

export class ClarityAgent extends BaseAgent {
    readonly name = 'Clarity Agent';
    readonly type = AgentType.Clarity;
    readonly systemPrompt = `You are the Clarity Agent for COE. Your role:
1. Review every reply in the ticket system for completeness and clarity
2. Score each reply 0-100 on clarity, completeness, and accuracy
3. If score >= 85: mark as "Clear", ticket can proceed
4. If score < 85: auto-reply with follow-up questions
5. Maximum 5 refinement rounds before escalating

Respond in this format:
SCORE: [0-100]
ASSESSMENT: [clear|needs_clarification]
FEEDBACK: [If needs clarification, what specific points need elaboration]`;

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
