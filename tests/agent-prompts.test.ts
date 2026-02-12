/**
 * Agent Prompt Content Tests (1.3.1)
 * Validates that each agent's system prompt contains required fields and thresholds.
 */

// Import agents (we test the prompt strings, not the runtime)
import { Orchestrator } from '../src/agents/orchestrator';
import { PlanningAgent } from '../src/agents/planning-agent';
import { VerificationAgent } from '../src/agents/verification-agent';
import { AnswerAgent } from '../src/agents/answer-agent';
import { ResearchAgent } from '../src/agents/research-agent';
import { ClarityAgent } from '../src/agents/clarity-agent';
import { BossAgent } from '../src/agents/boss-agent';

// We need to instantiate to access the systemPrompt. Use mocks for deps.
const mockDb = {} as any;
const mockLlm = {} as any;
const mockConfig = {} as any;
const mockOutput = { appendLine: () => {} } as any;

function getPrompt(AgentClass: any): string {
    const instance = new AgentClass(mockDb, mockLlm, mockConfig, mockOutput);
    return instance.systemPrompt;
}

describe('Agent Prompt Content Tests', () => {
    describe('Orchestrator', () => {
        const prompt = getPrompt(Orchestrator);

        test('contains all 6 intent categories', () => {
            for (const cat of ['verification', 'planning', 'question', 'research', 'custom', 'general']) {
                expect(prompt).toContain(cat);
            }
        });

        test('contains tie-breaking rules', () => {
            expect(prompt).toContain('verification > planning > question > research > custom > general');
        });

        test('specifies output format as single word', () => {
            expect(prompt.toLowerCase()).toContain('only the category name');
        });
    });

    describe('PlanningAgent', () => {
        const prompt = getPrompt(PlanningAgent);

        test('contains step_by_step_implementation field', () => {
            expect(prompt).toContain('step_by_step_implementation');
        });

        test('contains files_to_create and files_to_modify', () => {
            expect(prompt).toContain('files_to_create');
            expect(prompt).toContain('files_to_modify');
        });

        test('contains testing_instructions field', () => {
            expect(prompt).toContain('testing_instructions');
        });

        test('contains example JSON', () => {
            expect(prompt).toContain('"plan_name"');
            expect(prompt).toContain('"tasks"');
        });

        test('specifies atomicity rules (15-45 minutes)', () => {
            expect(prompt).toContain('15');
            expect(prompt).toContain('45');
        });
    });

    describe('VerificationAgent', () => {
        const prompt = getPrompt(VerificationAgent);

        test('contains criteria_results field', () => {
            expect(prompt).toContain('criteria_results');
        });

        test('instructs to set test_results to null when no runner', () => {
            expect(prompt.toLowerCase()).toContain('set test_results to null');
        });

        test('specifies follow-up task title format', () => {
            expect(prompt).toContain('Fix: [');
        });

        test('contains NEVER pass if not_met rule', () => {
            expect(prompt).toContain('NEVER set status to "passed" if ANY criterion is "not_met"');
        });
    });

    describe('AnswerAgent', () => {
        const prompt = getPrompt(AnswerAgent);

        test('contains CONFIDENCE field', () => {
            expect(prompt).toContain('CONFIDENCE');
        });

        test('contains ESCALATE field', () => {
            expect(prompt).toContain('ESCALATE');
        });

        test('specifies escalation threshold at 50', () => {
            expect(prompt).toContain('CONFIDENCE < 50');
        });

        test('specifies max 500 words', () => {
            expect(prompt).toContain('500 words');
        });
    });

    describe('ResearchAgent', () => {
        const prompt = getPrompt(ResearchAgent);

        test('contains numbered FINDINGS requirement', () => {
            expect(prompt).toContain('FINDINGS');
            expect(prompt.toLowerCase()).toContain('numbered');
        });

        test('requires comparison of 2+ approaches', () => {
            expect(prompt).toContain('2');
            expect(prompt.toLowerCase()).toContain('compare');
        });

        test('specifies ONE sentence recommendation', () => {
            expect(prompt).toContain('RECOMMENDATION');
            expect(prompt).toContain('ONE sentence');
        });

        test('specifies escalation at confidence < 60', () => {
            expect(prompt).toContain('below 60');
        });
    });

    describe('ClarityAgent', () => {
        const prompt = getPrompt(ClarityAgent);

        test('specifies score thresholds (85, 70)', () => {
            expect(prompt).toContain('85');
            expect(prompt).toContain('70');
        });

        test('limits follow-up questions to max 3', () => {
            expect(prompt).toContain('3');
            expect(prompt.toLowerCase()).toContain('follow-up');
        });

        test('specifies max 5 clarification rounds', () => {
            expect(prompt).toContain('5 clarification rounds');
        });
    });

    describe('BossAgent', () => {
        const prompt = getPrompt(BossAgent);

        test('specifies task overload threshold > 20', () => {
            expect(prompt).toContain('20 pending');
        });

        test('specifies agent failure as CRITICAL', () => {
            expect(prompt).toContain('Agent failure');
            expect(prompt).toContain('CRITICAL');
        });

        test('specifies drift threshold > 20%', () => {
            expect(prompt).toContain('20%');
        });

        test('specifies escalated tickets threshold > 5', () => {
            expect(prompt).toContain('5 escalated');
        });

        test('specifies response format fields', () => {
            expect(prompt).toContain('ASSESSMENT');
            expect(prompt).toContain('ISSUES');
            expect(prompt).toContain('ACTIONS');
            expect(prompt).toContain('ESCALATE');
        });
    });
});
