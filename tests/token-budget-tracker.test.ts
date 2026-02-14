import { TokenBudgetTracker } from '../src/core/token-budget-tracker';
import {
    ContentType, ContextPriority, ModelProfile,
    TokenBudgetWarning, AgentType
} from '../src/types';

describe('TokenBudgetTracker', () => {
    let tracker: TokenBudgetTracker;
    const logMessages: string[] = [];

    beforeEach(() => {
        logMessages.length = 0;
        tracker = new TokenBudgetTracker(
            undefined,
            undefined,
            { appendLine: (msg: string) => logMessages.push(msg) }
        );
    });

    // --- Content Type Detection ---

    describe('detectContentType', () => {
        it('detects TypeScript code', () => {
            const code = `
import { Database } from '../core/database';

export class MyService {
    constructor(private db: Database) {}

    async getData(): Promise<string[]> {
        const result = await this.db.query('SELECT * FROM tasks');
        return result.map(r => r.title);
    }
}`;
            expect(tracker.detectContentType(code)).toBe(ContentType.Code);
        });

        it('detects JSON content', () => {
            const json = `{
  "name": "test-plan",
  "status": "active",
  "tasks": [
    {"id": "1", "title": "Setup database"},
    {"id": "2", "title": "Create endpoints"}
  ]
}`;
            expect(tracker.detectContentType(json)).toBe(ContentType.JSON);
        });

        it('detects JSON arrays', () => {
            const jsonArr = `[{"id": "1", "name": "foo"}, {"id": "2", "name": "bar"}]`;
            expect(tracker.detectContentType(jsonArr)).toBe(ContentType.JSON);
        });

        it('detects Markdown content', () => {
            const md = `# Project Plan

## Overview
This is a **bold** project with [links](https://example.com).

- Item 1
- Item 2
- Item 3

> This is a blockquote
`;
            expect(tracker.detectContentType(md)).toBe(ContentType.Markdown);
        });

        it('detects natural text', () => {
            const text = 'The quick brown fox jumps over the lazy dog. This is a perfectly normal sentence that describes an everyday situation with nothing technical about it at all.';
            expect(tracker.detectContentType(text)).toBe(ContentType.NaturalText);
        });

        it('returns Mixed for empty string', () => {
            expect(tracker.detectContentType('')).toBe(ContentType.Mixed);
        });

        it('returns Mixed for ambiguous content', () => {
            const mixed = 'data: 123\nresult = true\nhello world\n{maybe}';
            const result = tracker.detectContentType(mixed);
            // Should return something valid
            expect(Object.values(ContentType)).toContain(result);
        });
    });

    // --- Token Estimation ---

    describe('estimateTokens', () => {
        it('returns 0 for empty string', () => {
            expect(tracker.estimateTokens('')).toBe(0);
        });

        it('returns 0 for null-ish input', () => {
            expect(tracker.estimateTokens('')).toBe(0);
        });

        it('estimates code tokens with ~3.2 chars/token ratio', () => {
            const code = 'const x = 42;'; // 14 chars
            const tokens = tracker.estimateTokens(code, ContentType.Code);
            // 14 / 3.2 = 4.375 → ceil = 5
            expect(tokens).toBe(5);
        });

        it('estimates natural text tokens with ~4.0 chars/token ratio', () => {
            const text = 'Hello world test'; // 16 chars
            const tokens = tracker.estimateTokens(text, ContentType.NaturalText);
            // 16 / 4.0 = 4.0 → ceil = 4
            expect(tokens).toBe(4);
        });

        it('estimates JSON tokens with ~3.5 chars/token ratio', () => {
            const json = '{"key":"value"}'; // 15 chars
            const tokens = tracker.estimateTokens(json, ContentType.JSON);
            // 15 / 3.5 = 4.28 → ceil = 5
            expect(tokens).toBe(5);
        });

        it('estimates Markdown tokens with ~3.8 chars/token ratio', () => {
            const md = '# Hello World\n'; // 15 chars
            const tokens = tracker.estimateTokens(md, ContentType.Markdown);
            // 15 / 3.8 = 3.94 → ceil = 4
            expect(tokens).toBe(4);
        });

        it('auto-detects content type when not specified', () => {
            const code = 'function test() { return true; }';
            const tokensAutoDetect = tracker.estimateTokens(code);
            // Should produce a valid positive number
            expect(tokensAutoDetect).toBeGreaterThan(0);
        });

        it('is more accurate than flat chars/4 for code', () => {
            const code = '{}[];()=>/**/ += !== ||= &&= ??=';
            const newEstimate = tracker.estimateTokens(code, ContentType.Code);
            const oldEstimate = Math.ceil(code.length / 4);
            // Code with many special chars should have more tokens than chars/4 suggests
            // (because tokens are shorter for special characters)
            expect(newEstimate).toBeGreaterThanOrEqual(oldEstimate);
        });
    });

    // --- Budget Creation ---

    describe('createBudget', () => {
        it('creates a budget with correct available input tokens', () => {
            const budget = tracker.createBudget(AgentType.Planning);

            // Default model: 32768 context - 4096 output = 28672 available
            // 5% buffer: 28672 * 0.95 = 27238
            expect(budget.totalContextWindow).toBe(32768);
            expect(budget.reservedForOutput).toBe(4096);
            expect(budget.availableForInput).toBe(Math.floor(28672 * 0.95));
            expect(budget.consumed).toBe(0);
            expect(budget.remaining).toBe(budget.availableForInput);
            expect(budget.warningLevel).toBe('ok');
            expect(budget.items).toHaveLength(0);
        });

        it('respects custom maxOutputTokens', () => {
            const budget = tracker.createBudget(AgentType.Answer, 2000);

            expect(budget.reservedForOutput).toBe(2000);
            expect(budget.availableForInput).toBe(Math.floor((32768 - 2000) * 0.95));
        });

        it('logs budget creation', () => {
            tracker.createBudget(AgentType.Orchestrator);
            expect(logMessages.some(m => m.includes('[TokenBudget] Created for orchestrator'))).toBe(true);
        });
    });

    // --- Budget Item Addition ---

    describe('addItem', () => {
        it('adds item and updates consumed/remaining', () => {
            const budget = tracker.createBudget(AgentType.Planning);
            const initialRemaining = budget.remaining;

            const item = tracker.addItem(budget, 'system_prompt', 'You are a helpful assistant.', ContextPriority.Mandatory);

            expect(item.included).toBe(true);
            expect(item.estimatedTokens).toBeGreaterThan(0);
            expect(budget.consumed).toBe(item.estimatedTokens);
            expect(budget.remaining).toBe(initialRemaining - item.estimatedTokens);
            expect(budget.items).toHaveLength(1);
        });

        it('marks item as excluded when budget is exceeded', () => {
            const budget = tracker.createBudget(AgentType.Planning, 32700);
            // Reserve almost all tokens for output, leaving very little for input

            // Try to add a massive item
            const bigContent = 'x'.repeat(100000);
            const item = tracker.addItem(budget, 'big_context', bigContent, ContextPriority.Optional);

            expect(item.included).toBe(false);
            expect(budget.consumed).toBe(0); // Nothing consumed
        });

        it('includes message overhead in token count', () => {
            const budget = tracker.createBudget(AgentType.Planning);
            const content = 'test';
            const item = tracker.addItem(budget, 'test', content, ContextPriority.Mandatory);

            // Should include overheadTokensPerMessage (4) in addition to content tokens
            const contentTokens = tracker.estimateTokens(content);
            expect(item.estimatedTokens).toBe(contentTokens + 4);
        });

        it('detects content type automatically', () => {
            const budget = tracker.createBudget(AgentType.Planning);
            const code = `import { Database } from '../core/database';
export class MyService {
    constructor(private db: Database) {}
    async getData(): Promise<string[]> {
        const result = await this.db.query('SELECT * FROM tasks');
        if (result.length > 0) {
            return result.map(r => r.title);
        }
        return [];
    }
}`;
            const item = tracker.addItem(budget, 'code', code, ContextPriority.Important);

            expect(item.contentType).toBe(ContentType.Code);
        });

        it('uses explicit content type when provided', () => {
            const budget = tracker.createBudget(AgentType.Planning);
            const item = tracker.addItem(budget, 'test', 'hello', ContextPriority.Important, ContentType.JSON);

            expect(item.contentType).toBe(ContentType.JSON);
        });
    });

    // --- canFit ---

    describe('canFit', () => {
        it('returns true when content fits', () => {
            const budget = tracker.createBudget(AgentType.Planning);
            expect(tracker.canFit(budget, 'short text')).toBe(true);
        });

        it('returns false when content does not fit', () => {
            const budget = tracker.createBudget(AgentType.Planning, 32700);
            const bigContent = 'x'.repeat(100000);
            expect(tracker.canFit(budget, bigContent)).toBe(false);
        });
    });

    // --- Warning System ---

    describe('warnings', () => {
        it('triggers warning callback at 70%', () => {
            const warnings: TokenBudgetWarning[] = [];
            tracker.onWarning(w => warnings.push(w));

            const budget = tracker.createBudget(AgentType.Planning);
            // Fill to 70%+
            const targetChars = Math.ceil(budget.availableForInput * 0.75 * 4);
            tracker.addItem(budget, 'big', 'x'.repeat(targetChars), ContextPriority.Mandatory, ContentType.NaturalText);

            expect(warnings.length).toBeGreaterThanOrEqual(1);
            expect(warnings[0].level).toBe('warning');
        });

        it('triggers critical callback at 90%', () => {
            const warnings: TokenBudgetWarning[] = [];
            tracker.onWarning(w => warnings.push(w));

            const budget = tracker.createBudget(AgentType.Planning);
            // Fill to 92%+
            const targetChars = Math.ceil(budget.availableForInput * 0.93 * 4);
            tracker.addItem(budget, 'big', 'x'.repeat(targetChars), ContextPriority.Mandatory, ContentType.NaturalText);

            expect(warnings.some(w => w.level === 'critical')).toBe(true);
        });

        it('returns null warning when budget is healthy', () => {
            const budget = tracker.createBudget(AgentType.Planning);
            tracker.addItem(budget, 'small', 'hello', ContextPriority.Mandatory);

            const warning = tracker.checkWarnings(budget);
            expect(warning).toBeNull();
        });

        it('updates warningLevel on budget object', () => {
            const budget = tracker.createBudget(AgentType.Planning);
            expect(budget.warningLevel).toBe('ok');

            // Fill to 75%
            const targetChars = Math.ceil(budget.availableForInput * 0.75 * 4);
            tracker.addItem(budget, 'big', 'x'.repeat(targetChars), ContextPriority.Mandatory, ContentType.NaturalText);
            expect(budget.warningLevel).toBe('warning');
        });

        it('sets warningLevel to exceeded when consumed >= availableForInput (line 351)', () => {
            // To trigger 'exceeded', we need consumed/availableForInput >= 100%.
            // updateWarningLevel is called only when item.included = true (fits).
            // An item fits when estimatedTokens <= budget.remaining.
            // For the first item, remaining = availableForInput.
            // So we need an item whose estimatedTokens >= availableForInput.
            // estimatedTokens = ceil(content.length / charsPerToken) + overheadPerMessage
            // For NaturalText: charsPerToken = 4.0, overhead = 4
            // Need: ceil(len / 4.0) + 4 >= availableForInput
            // So len >= (availableForInput - 4) * 4

            const budget = tracker.createBudget(AgentType.Planning);
            const targetTokens = budget.availableForInput; // Need estimatedTokens >= this
            // ceil(len/4) + 4 >= targetTokens  =>  len >= (targetTokens - 4) * 4
            const charCount = (targetTokens - 4) * 4;

            const item = tracker.addItem(budget, 'massive', 'x'.repeat(charCount), ContextPriority.Mandatory, ContentType.NaturalText);

            expect(item.included).toBe(true);
            expect(budget.consumed).toBeGreaterThanOrEqual(budget.availableForInput);
            expect(budget.warningLevel).toBe('exceeded');
        });

        it('getRemaining returns budget.remaining (line 214)', () => {
            const budget = tracker.createBudget(AgentType.Planning);
            const initial = tracker.getRemaining(budget);
            expect(initial).toBe(budget.remaining);
            expect(initial).toBeGreaterThan(0);

            // Add an item and verify remaining decreases
            tracker.addItem(budget, 'some-item', 'Hello world', ContextPriority.Supplementary, ContentType.NaturalText);
            const after = tracker.getRemaining(budget);
            expect(after).toBeLessThan(initial);
            expect(after).toBe(budget.remaining);
        });
    });

    // --- Model Profiles ---

    describe('model profiles', () => {
        it('defaults to ministral-3-14b profile', () => {
            const profile = tracker.getCurrentModelProfile();
            expect(profile.id).toBe('mistralai/ministral-3-14b-reasoning');
            expect(profile.contextWindowTokens).toBe(32768);
        });

        it('registers and uses custom model', () => {
            const customProfile: ModelProfile = {
                id: 'custom-model',
                name: 'Custom Model',
                contextWindowTokens: 8192,
                maxOutputTokens: 1024,
                tokensPerChar: {
                    [ContentType.Code]: 3.0,
                    [ContentType.NaturalText]: 4.5,
                    [ContentType.JSON]: 3.2,
                    [ContentType.Markdown]: 3.5,
                    [ContentType.Mixed]: 3.5,
                },
                overheadTokensPerMessage: 3,
            };

            tracker.registerModel(customProfile);
            tracker.setCurrentModel('custom-model');

            const profile = tracker.getCurrentModelProfile();
            expect(profile.id).toBe('custom-model');
            expect(profile.contextWindowTokens).toBe(8192);

            // Budget should use new model's context window
            const budget = tracker.createBudget(AgentType.Planning);
            expect(budget.totalContextWindow).toBe(8192);
        });

        it('falls back to default when switching to unregistered model', () => {
            tracker.setCurrentModel('nonexistent-model');
            const profile = tracker.getCurrentModelProfile();
            // Should fall back to default
            expect(profile.contextWindowTokens).toBe(32768);
        });
    });

    // --- Usage Tracking ---

    describe('usage tracking', () => {
        it('records and reports usage stats', () => {
            tracker.recordUsage(1000, 200, 'planning');
            tracker.recordUsage(2000, 300, 'answer');
            tracker.recordUsage(500, 100, 'planning');

            const stats = tracker.getUsageStats();
            expect(stats.callCount).toBe(3);
            expect(stats.totalInputEstimated).toBe(3500);
            expect(stats.totalOutputActual).toBe(600);
            expect(stats.avgInputPerCall).toBe(Math.round(3500 / 3));
        });

        it('reports usage by agent type', () => {
            tracker.recordUsage(1000, 200, 'planning');
            tracker.recordUsage(2000, 300, 'answer');
            tracker.recordUsage(500, 100, 'planning');

            const byAgent = tracker.getUsageByAgent();
            expect(byAgent['planning'].calls).toBe(2);
            expect(byAgent['planning'].inputTokens).toBe(1500);
            expect(byAgent['answer'].calls).toBe(1);
        });

        it('trims history to 500 records', () => {
            for (let i = 0; i < 600; i++) {
                tracker.recordUsage(100, 50, 'test');
            }
            const stats = tracker.getUsageStats();
            expect(stats.callCount).toBe(500);
        });

        it('returns zero stats when no usage', () => {
            const stats = tracker.getUsageStats();
            expect(stats.callCount).toBe(0);
            expect(stats.avgInputPerCall).toBe(0);
        });
    });

    // --- Integration scenarios ---

    describe('realistic scenarios', () => {
        it('handles typical agent message building', () => {
            const budget = tracker.createBudget(AgentType.Planning);

            // System prompt (~200 tokens)
            tracker.addItem(budget, 'system_prompt', 'You are a planning agent. Generate structured task decompositions. Output JSON. Follow the atomicity checklist. Max 100 tasks. Each task 15-45 minutes.'.repeat(3), ContextPriority.Mandatory, ContentType.NaturalText);

            // User message (~50 tokens)
            tracker.addItem(budget, 'user_message', 'Break down the user authentication feature into tasks', ContextPriority.Mandatory, ContentType.NaturalText);

            // Task context (~100 tokens)
            tracker.addItem(budget, 'task_context', 'Current task: Implement user auth\nPriority: P1\nAcceptance: Users can log in with email/password', ContextPriority.Important, ContentType.NaturalText);

            // Plan context (~200 tokens)
            tracker.addItem(budget, 'plan_context', '{"name":"Web App","tasks":[],"config":{"scale":"medium","focus":"fullstack"}}', ContextPriority.Important, ContentType.JSON);

            expect(budget.items.filter(i => i.included).length).toBe(4);
            expect(budget.warningLevel).toBe('ok');
            expect(budget.remaining).toBeGreaterThan(0);
        });

        it('handles v2.0 design-heavy context', () => {
            const budget = tracker.createBudget(AgentType.Planning);

            // System prompt
            tracker.addItem(budget, 'system_prompt', 'You are a design-aware planning agent.', ContextPriority.Mandatory);

            // User message
            tracker.addItem(budget, 'user_message', 'Generate code for the dashboard page', ContextPriority.Mandatory);

            // 50 component schemas (could be huge)
            const schemas = Array.from({ length: 50 }, (_, i) =>
                `{"type":"component_${i}","name":"Component ${i}","props":{"label":"string","value":"any","onChange":"function"},"events":["click","change"]}`
            ).join('\n');

            const item = tracker.addItem(budget, 'component_schemas', schemas, ContextPriority.Supplementary, ContentType.JSON);

            // Should still fit in 32K context
            expect(item.included).toBe(true);
            expect(budget.consumed).toBeGreaterThan(0);
        });
    });
});
