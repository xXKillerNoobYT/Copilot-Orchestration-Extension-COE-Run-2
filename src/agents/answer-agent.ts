import { BaseAgent } from './base-agent';
import { AgentType, AgentContext, AgentResponse, TicketPriority, SupportDocument } from '../types';
import { DocumentManagerService } from '../core/document-manager';

export class AnswerAgent extends BaseAgent {
    readonly name = 'Answer Agent';
    readonly type = AgentType.Answer;
    private documentManager: DocumentManagerService | null = null;

    /**
     * v7.0: Inject DocumentManagerService so Answer Agent can search
     * support documents before calling the LLM.
     */
    setDocumentManager(dm: DocumentManagerService): void {
        this.documentManager = dm;
    }

    readonly systemPrompt = `You are the Answer Agent for the Copilot Orchestration Extension (COE).

## Your ONE Job
Answer questions from coding agents or users with evidence-based responses. Every claim must have a source. If you cannot cite a source, you MUST escalate.

## Response Format
You MUST respond in EXACTLY this format (4 fields, each on its own line):

ANSWER: [Your answer in 500 words or fewer. Be direct. Start with the answer, then explain.]
CONFIDENCE: [Integer 0-100. 90-100 = certain with evidence. 70-89 = likely correct. 50-69 = uncertain. 0-49 = guessing.]
SOURCES: [Comma-separated list of specific sources. Use: task IDs (e.g., "task-abc123"), file paths (e.g., "src/core/database.ts:42"), plan names (e.g., "Plan: Auth System"), or ticket numbers (e.g., "TK-007"). NEVER say "general knowledge" or "common practice".]
ESCALATE: [true or false. Set to true if CONFIDENCE < 50.]

## Rules
1. NEVER say "I think" or "I believe" — state facts or escalate
2. NEVER provide an answer without at least one specific source
3. If CONFIDENCE is below 50, you MUST set ESCALATE to true
4. Maximum 500 words in the ANSWER field
5. If the question relates to a specific task, reference that task's ID and acceptance criteria
6. If the question is about architecture, reference the relevant plan or directive file
7. If you have no relevant sources at all, set CONFIDENCE to 0 and ESCALATE to true

## Examples

Example 1 — High confidence:
ANSWER: The database uses SQLite via the built-in node:sqlite module with WAL mode enabled. Tables are created in src/core/database.ts in the createTables() method. There are 9 tables: plans, tasks, tickets, ticket_replies, conversations, agents, audit_log, verification_results, and evolution_log.
CONFIDENCE: 95
SOURCES: src/core/database.ts:25-139, Plan: System Architecture
ESCALATE: false

Example 2 — Low confidence, escalated:
ANSWER: I cannot determine whether the MCP server should use JSON-RPC or REST for the new endpoint. The current implementation uses custom HTTP routes, but the plan references MCP protocol compliance which implies JSON-RPC.
CONFIDENCE: 40
SOURCES: src/mcp/server.ts, Plan: MCP Compliance
ESCALATE: true

## Support Documentation (v7.0)
If support documents are provided below your question, use them as primary sources.
They contain verified research findings from previous investigations and are more reliable than guessing.
Always cite support documents as sources when you use them: "Support Doc: [document_name]"

## Escalation & Support (v7.0)
If you cannot proceed because information is missing or prerequisites aren't met:
- Use action "escalate_to_boss" with: ticket_id, reason, recommended_target queue, what info is needed
- Use action "call_support_agent" with mode "async" for research tasks (Research Agent gathering docs)
Include actions as a JSON array under an "actions" key alongside your normal output.`;

    /**
     * v7.0: Override processMessage to search support documents before LLM call.
     * If relevant documents are found, they're prepended to the message as context,
     * potentially allowing the LLM to answer with higher confidence from verified sources.
     */
    async processMessage(message: string, context: AgentContext): Promise<AgentResponse> {
        let enhancedMessage = message;

        if (this.documentManager) {
            try {
                // Extract keywords from the question for document search
                const questionWords = message
                    .replace(/[^a-zA-Z0-9\s]/g, ' ')
                    .split(/\s+/)
                    .filter(w => w.length >= 4)
                    .slice(0, 5);

                const allDocs: SupportDocument[] = [];
                const seen = new Set<string>();

                for (const keyword of questionWords) {
                    if (allDocs.length >= 5) break;
                    const docs = this.documentManager.searchDocuments({ keyword });
                    for (const doc of docs) {
                        if (!seen.has(doc.id) && allDocs.length < 5) {
                            seen.add(doc.id);
                            allDocs.push(doc);
                        }
                    }
                }

                if (allDocs.length > 0) {
                    const docContext = this.documentManager.formatContextDocs(allDocs);
                    enhancedMessage = `${docContext}\n\n--- QUESTION ---\n${message}`;
                    this.outputChannel.appendLine(
                        `[AnswerAgent] Found ${allDocs.length} support document(s) for question context`
                    );
                }
            } catch (error) {
                this.outputChannel.appendLine(`[AnswerAgent] Document search failed: ${error}`);
            }
        }

        return super.processMessage(enhancedMessage, context);
    }

    protected async parseResponse(content: string, context: AgentContext): Promise<AgentResponse> {
        let confidence = 80;
        const sources: string[] = [];
        let escalated = false;
        let answer = content;

        // Parse structured response
        const confidenceMatch = content.match(/CONFIDENCE:\s*(\d+)/i);
        if (confidenceMatch) {
            confidence = parseInt(confidenceMatch[1], 10);
        }

        const sourcesMatch = content.match(/SOURCES:\s*(.*?)(?:\n|ESCALATE|$)/is);
        if (sourcesMatch) {
            sources.push(...sourcesMatch[1].split(',').map(s => s.trim()).filter(Boolean));
        }

        const escalateMatch = content.match(/ESCALATE:\s*(true|false)/i);
        if (escalateMatch) {
            escalated = escalateMatch[1].toLowerCase() === 'true';
        }

        const answerMatch = content.match(/ANSWER:\s*(.*?)(?:\nCONFIDENCE|$)/is);
        if (answerMatch) {
            answer = answerMatch[1].trim();
        }

        // Auto-escalate if confidence is low (threshold: 50 per updated prompt)
        if (confidence < 50) {
            escalated = true;
            if (context.task) {
                this.database.createTicket({
                    title: `Low confidence answer for task: ${context.task.title}`,
                    body: `Question required human input.\n\nAnswer provided (${confidence}% confidence):\n${answer}\n\nSources: ${sources.join(', ')}`,
                    priority: TicketPriority.P1,
                    creator: this.name,
                    task_id: context.task.id,
                });
            }
        }

        return {
            content: answer,
            confidence,
            sources,
            actions: escalated ? [{
                type: 'escalate',
                payload: { reason: `Confidence ${confidence}% below threshold`, question: answer },
            }] : [],
        };
    }
}
