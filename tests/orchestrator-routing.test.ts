/**
 * Orchestrator Routing & Intent Classification Tests (1.3.4)
 * Tests the multi-keyword scoring and tie-breaking logic.
 */

// We need to test the private classifyIntent method.
// We'll instantiate the Orchestrator with mocks and use a helper.
import { Orchestrator } from '../src/agents/orchestrator';
import { DatabaseSync } from 'node:sqlite';
import { Database } from '../src/core/database';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// Create a real test database (needed for agent registration)
let db: Database;
let orchestrator: Orchestrator;
const tmpDir = path.join(os.tmpdir(), `coe-routing-test-${Date.now()}`);

const mockLlm = {
    classify: jest.fn().mockResolvedValue('general'),
    chat: jest.fn().mockResolvedValue({ content: 'ok', tokens_used: 1, model: 'test', finish_reason: 'stop' }),
} as any;

const mockConfig = {
    getConfig: () => ({
        verification: { delaySeconds: 60, coverageThreshold: 80 },
        watcher: { debounceMs: 500 },
        taskQueue: { maxPending: 20 },
        agents: {},
    }),
    getAgentContextLimit: () => 4096,
    getModelMaxOutputTokens: () => 4096,
    getModelContextWindow: () => 32768,
    getLLMConfig: () => ({}),
    getCOEDir: () => tmpDir,
} as any;

const mockOutput = { appendLine: jest.fn() } as any;

beforeAll(async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    db = new Database(tmpDir);
    await db.initialize();
    orchestrator = new Orchestrator(db, mockLlm, mockConfig, mockOutput);
    await orchestrator.initialize();
});

afterAll(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Intent Classification', () => {
    // Access private method via type assertion
    const classify = (msg: string) => (orchestrator as any).classifyIntent(msg);

    test('"verify my plan is correct" → verification (not planning)', async () => {
        const result = await classify('verify my plan is correct');
        expect(result).toBe('verification');
    });

    test('"create a new roadmap" → planning', async () => {
        const result = await classify('create a new roadmap for the project');
        expect(result).toBe('planning');
    });

    test('"how does the auth system work?" → question', async () => {
        const result = await classify('how does the auth system work?');
        expect(result).toBe('question');
    });

    test('"investigate performance bottlenecks" → research', async () => {
        const result = await classify('investigate performance bottlenecks and compare solutions');
        expect(result).toBe('research');
    });

    test('"run my custom lint agent" → custom', async () => {
        const result = await classify('run my custom agent for security analysis');
        expect(result).toBe('custom');
    });

    test('tie-break: "check my plan tasks" → verification over planning', async () => {
        // "check" → verification, "plan" → planning, "task" → planning
        // verification scores 1, planning scores 2
        // BUT wait - planning has higher score, so it should win
        // Let's use a message that actually ties
        const result = await classify('verify and check this plan task');
        // "verify" + "check" → verification=2, "plan" + "task" → planning=2
        // Tie → verification wins (higher priority)
        expect(result).toBe('verification');
    });

    test('no keyword matches → LLM fallback', async () => {
        mockLlm.classify.mockResolvedValueOnce('research');
        const result = await classify('lorem ipsum dolor sit amet');
        expect(result).toBe('research');
        expect(mockLlm.classify).toHaveBeenCalled();
    });

    test('LLM offline → general fallback', async () => {
        orchestrator.setLLMOffline(true);
        const result = await classify('lorem ipsum dolor sit amet');
        expect(result).toBe('general');
        orchestrator.setLLMOffline(false);
    });
});
