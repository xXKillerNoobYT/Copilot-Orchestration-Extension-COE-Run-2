import { BaseAgent } from './base-agent';
import { AgentType, AgentContext, AgentResponse } from '../types';

export class ResearchAgent extends BaseAgent {
    readonly name = 'Research Agent';
    readonly type = AgentType.Research;
    readonly systemPrompt = `You are the Research Agent for COE. Your role:
1. Gather information when deeper investigation is needed
2. Produce structured analysis reports
3. Compare alternatives and make recommendations
4. Provide source citations for all findings

You activate when:
- A coding task has been stuck for >30 minutes
- A question requires investigation beyond the plan and codebase
- The Orchestrator detects a pattern that needs deeper analysis

Respond with a structured research report:
FINDINGS: [Main findings]
ANALYSIS: [Detailed analysis]
RECOMMENDATION: [Your recommendation]
SOURCES: [Citations and references]
CONFIDENCE: [0-100]`;

    protected async parseResponse(content: string, _context: AgentContext): Promise<AgentResponse> {
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

        return {
            content,
            confidence,
            sources,
        };
    }
}
