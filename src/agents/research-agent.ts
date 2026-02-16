import { BaseAgent } from './base-agent';
import { AgentType, AgentContext, AgentResponse, AgentAction, TicketPriority } from '../types';

export class ResearchAgent extends BaseAgent {
    readonly name = 'Research Agent';
    readonly type = AgentType.Research;
    readonly systemPrompt = `You are the Research Agent for the Copilot Orchestration Extension (COE).

## Your ONE Job
Investigate complex questions that require analysis beyond simple Q&A. Produce structured research reports with numbered findings, comparative analysis, and a clear recommendation.

## When You Activate
- A coding task has been stuck for >30 minutes with no progress
- A question requires comparing 2+ alternatives (libraries, patterns, architectures)
- The Orchestrator detects a recurring pattern that needs deeper investigation
- A user explicitly asks for research or comparison

## Response Format
You MUST respond in EXACTLY this format (5 fields, each on its own line):

FINDINGS: [Numbered list of discovered facts. Each finding is ONE sentence. Format: "1. Finding one. 2. Finding two. 3. Finding three." Minimum 3 findings, maximum 10.]
ANALYSIS: [Compare 2 or more approaches/options. For each, state: pros, cons, and fit for this project. Maximum 1000 words total.]
RECOMMENDATION: [ONE sentence. Start with "Use X because Y." or "Choose X over Y because Z."]
SOURCES: [Comma-separated list of specific sources: file paths, documentation URLs, task IDs, plan names. NEVER say "general knowledge".]
CONFIDENCE: [Integer 0-100. If below 60, add "ESCALATE: true" on the next line.]

## Rules
1. Every finding MUST be a verifiable fact, not an opinion
2. Analysis MUST compare at least 2 approaches — never present only one option
3. Recommendation MUST be exactly ONE sentence
4. If CONFIDENCE is below 60, you MUST add ESCALATE: true
5. Maximum 1000 words total across all fields
6. If the research involves code, cite specific file paths and line numbers
7. If the research involves external tools/libraries, cite version numbers

## Example
FINDINGS: 1. SQLite WAL mode supports concurrent reads but only one writer. 2. PostgreSQL supports multiple concurrent writers with MVCC. 3. Current COE database averages 50 writes/minute during active planning. 4. SQLite handles up to 1000 writes/second in WAL mode.
ANALYSIS: SQLite (current): Pros — zero setup, embedded, no network latency, sufficient for single-user workload. Cons — single writer bottleneck if multi-user support is added. PostgreSQL: Pros — multi-writer, advanced querying, JSONB support. Cons — requires external server, adds deployment complexity, overkill for current workload.
RECOMMENDATION: Keep SQLite because COE is single-user and current write volume (50/min) is well within SQLite WAL limits (1000/sec).
SOURCES: src/core/database.ts:25, SQLite WAL documentation, Plan: System Architecture
CONFIDENCE: 88

## Saving Research to Documentation (v7.0)
When your research produces reusable findings (confidence >= 60), include a save_document action in your response.
The orchestration system will save your findings to the support documentation system for future reference.
Topic keywords from your research will be used to infer the folder name and document title.
This is handled automatically — you just need to produce high-quality, structured findings.

## Escalation & Support (v7.0)
If you cannot proceed because information is missing or prerequisites aren't met:
- Use action "escalate_to_boss" with: ticket_id, reason, recommended_target queue, what info is needed
- Use action "call_support_agent" with mode "sync" for quick lookups (Answer, Decision Memory)
- Use action "call_support_agent" with mode "async" for research sub-tasks
Include actions as a JSON array under an "actions" key alongside your normal output.`;

    protected async parseResponse(content: string, context: AgentContext): Promise<AgentResponse> {
        let confidence = 75;
        const sources: string[] = [];

        const confidenceMatch = content.match(/CONFIDENCE:\s*(\d+)/i);
        if (confidenceMatch) {
            confidence = parseInt(confidenceMatch[1], 10);
        }

        const sourcesMatch = content.match(/SOURCES:\s*(.*?)(?:\n|CONFIDENCE|$)/is);
        if (sourcesMatch) {
            sources.push(...sourcesMatch[1].split(',').map(s => s.trim()).filter(Boolean));
        }

        // Check ESCALATE field or auto-escalate when confidence <60
        const escalateMatch = content.match(/ESCALATE:\s*(true|false)/i);
        const shouldEscalate = escalateMatch
            ? escalateMatch[1].toLowerCase() === 'true'
            : confidence < 60;

        if (shouldEscalate) {
            const taskId = context.task?.id || 'unknown';
            this.database.createTicket({
                title: `Research escalation: low confidence (${confidence}%) on task ${taskId}`,
                body: `Research Agent returned confidence of ${confidence}%, below the 60% threshold.\n\nSources checked: ${sources.join(', ') || 'none'}\n\n---\n${content.slice(0, 1000)}`,
                priority: TicketPriority.P1,
                creator: 'research_agent',
            });
            this.database.addAuditLog(
                'research',
                'escalated',
                `Low confidence research (${confidence}%) auto-escalated to P1 ticket`
            );
        }

        // v7.0: Save high-confidence findings to support documentation
        const actions: AgentAction[] = [];
        if (confidence >= 60) {
            // Infer folder and document name from ticket title and findings
            const ticketTitle = context.ticket?.title || context.task?.title || 'Research';
            const folderName = this.inferFolderName(ticketTitle, content);
            const docName = this.inferDocumentName(ticketTitle);

            // Extract summary from findings
            const findingsMatch = content.match(/FINDINGS:\s*(.*?)(?:\nANALYSIS|$)/is);
            const summary = findingsMatch
                ? findingsMatch[1].trim().substring(0, 500)
                : `Research findings on ${ticketTitle}`;

            // Extract tags from sources and topic
            const tags: string[] = [];
            if (context.ticket?.operation_type) tags.push(context.ticket.operation_type);
            const recommendationMatch = content.match(/RECOMMENDATION:\s*(.*?)(?:\nSOURCES|$)/is);
            if (recommendationMatch) {
                const recWords = recommendationMatch[1]
                    .replace(/[^a-zA-Z0-9\s]/g, '')
                    .split(/\s+/)
                    .filter(w => w.length >= 4)
                    .slice(0, 3);
                tags.push(...recWords.map(w => w.toLowerCase()));
            }

            actions.push({
                type: 'save_document',
                payload: {
                    folder_name: folderName,
                    document_name: docName,
                    content: content,
                    summary,
                    category: 'research',
                    source_ticket_id: context.ticket?.id ?? null,
                    source_agent: 'Research Agent',
                    tags: [...new Set(tags)],
                    relevance_score: Math.min(100, confidence),
                },
            });
        }

        return {
            content,
            confidence,
            sources,
            actions,
        };
    }

    /**
     * Infer a folder name from ticket title and research content.
     * Groups related research into logical folders.
     */
    private inferFolderName(ticketTitle: string, content: string): string {
        const combined = `${ticketTitle} ${content.substring(0, 200)}`.toLowerCase();

        // Check for common topic patterns
        const topicPatterns: Array<[RegExp, string]> = [
            [/lm\s*studio|language\s*model|llm/i, 'LM Studio'],
            [/sqlite|database|sql/i, 'Database'],
            [/typescript|javascript|react|node/i, 'Technology'],
            [/architecture|design|pattern/i, 'Architecture'],
            [/performance|optimization|speed/i, 'Performance'],
            [/security|auth|permission/i, 'Security'],
            [/testing|test|jest|coverage/i, 'Testing'],
            [/deployment|docker|ci\/cd/i, 'Deployment'],
            [/api|endpoint|rest|graphql/i, 'API'],
            [/ui|ux|component|interface/i, 'UI/UX'],
        ];

        for (const [pattern, folder] of topicPatterns) {
            if (pattern.test(combined)) {
                return folder;
            }
        }

        // Fallback: use first significant word from title
        const titleWords = ticketTitle
            .replace(/[^a-zA-Z0-9\s]/g, '')
            .split(/\s+/)
            .filter(w => w.length >= 4);

        if (titleWords.length > 0) {
            // Capitalize first letter
            return titleWords[0].charAt(0).toUpperCase() + titleWords[0].slice(1).toLowerCase();
        }

        return 'General Research';
    }

    /**
     * Infer a document name from the ticket title.
     */
    private inferDocumentName(ticketTitle: string): string {
        // Clean up and truncate title for use as document name
        const cleaned = ticketTitle
            .replace(/^(Research|Investigate|Compare|Analyze|Evaluate):\s*/i, '')
            .replace(/[^a-zA-Z0-9\s\-_]/g, '')
            .trim();

        if (cleaned.length === 0) return 'Research Findings';
        if (cleaned.length > 80) return cleaned.substring(0, 80) + '...';
        return cleaned;
    }
}
