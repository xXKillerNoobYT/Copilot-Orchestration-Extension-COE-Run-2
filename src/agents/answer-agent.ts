import { BaseAgent } from './base-agent';
import { AgentType, AgentContext, AgentResponse } from '../types';

export class AnswerAgent extends BaseAgent {
    readonly name = 'Answer Agent';
    readonly type = AgentType.Answer;
    readonly systemPrompt = `You are the Answer Agent for COE. Your role:
1. Provide context-aware answers to questions from coding agents or users
2. Search the plan, codebase context, and previous Q&A history
3. Return evidence-based answers with confidence scores
4. Escalate to the user when confidence is below 70%

Always respond in this format:
ANSWER: [Your answer here]
CONFIDENCE: [0-100]
SOURCES: [List of sources - plan sections, files, previous answers]
ESCALATE: [true/false - true if confidence < 70]

Be fast, precise, and always cite your sources. Never guess — if you're unsure, say so and escalate.`;

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

        // Auto-escalate if confidence is low
        if (confidence < 70) {
            escalated = true;
            if (context.task) {
                this.database.createTicket({
                    title: `Low confidence answer for task: ${context.task.title}`,
                    body: `Question required human input.\n\nAnswer provided (${confidence}% confidence):\n${answer}\n\nSources: ${sources.join(', ')}`,
                    priority: 'P1' as any,
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
