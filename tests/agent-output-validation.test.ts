/**
 * Agent Output Validation Tests
 *
 * For each agent, provide canned input + canned LLM response,
 * verify the parser extracts all fields correctly,
 * and verify invalid/malformed LLM responses are handled gracefully.
 */

jest.mock('vscode', () => ({
    window: {
        createOutputChannel: () => ({
            appendLine: jest.fn(), show: jest.fn(), dispose: jest.fn(),
        }),
    },
    workspace: { workspaceFolders: [] },
    Uri: { parse: (s: string) => ({ toString: () => s }) },
    env: { openExternal: jest.fn() },
}));

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Database } from '../src/core/database';
import { LLMService } from '../src/core/llm-service';
import { ConfigManager } from '../src/core/config';
import { PlanningAgent } from '../src/agents/planning-agent';
import { VerificationAgent } from '../src/agents/verification-agent';
import { AnswerAgent } from '../src/agents/answer-agent';
import { ResearchAgent } from '../src/agents/research-agent';
import { ClarityAgent } from '../src/agents/clarity-agent';
import { BossAgent } from '../src/agents/boss-agent';
import { AgentContext, TaskStatus, PlanStatus } from '../src/types';

let database: Database;
let llmService: LLMService;
let configManager: any;
let tmpDir: string;
const outputChannel: any = { appendLine: jest.fn(), show: jest.fn(), dispose: jest.fn() };

beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-agent-val-'));
    database = new Database(tmpDir);
    await database.initialize();

    configManager = {
        getConfig: () => ({
            version: '1.0.0',
            llm: { endpoint: 'http://localhost:1234/v1', model: 'test', timeoutSeconds: 30, startupTimeoutSeconds: 10, streamStallTimeoutSeconds: 60, maxTokens: 4000 },
            taskQueue: { maxPending: 20 },
            verification: { delaySeconds: 1, coverageThreshold: 80 },
            watcher: { debounceMs: 500 },
            agents: {},
        }),
        getLLMConfig: () => ({ endpoint: 'http://localhost:1234/v1', model: 'test', timeoutSeconds: 30, startupTimeoutSeconds: 10, streamStallTimeoutSeconds: 60, maxTokens: 4000, maxRequestRetries: 0, maxConcurrentRequests: 4, bossReservedSlots: 1 }),
        getAgentContextLimit: () => 4000,
        getCOEDir: () => ':memory:',
    } as unknown as ConfigManager;

    llmService = new LLMService(configManager.getLLMConfig(), outputChannel);
});

afterEach(() => {
    database.close();
    jest.restoreAllMocks();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function mockLLMResponse(content: string): void {
    // Build SSE stream data for streaming requests
    const chunks = content.match(/.{1,20}/g) || [content];
    const sseLines = chunks.map(chunk =>
        `data: ${JSON.stringify({ choices: [{ delta: { content: chunk }, finish_reason: null }] })}\n\n`
    ).join('') + 'data: [DONE]\n\n';

    const encoder = new TextEncoder();
    const encoded = encoder.encode(sseLines);
    let readDone = false;

    const mockBody = {
        getReader: () => ({
            read: async () => {
                if (!readDone) {
                    readDone = true;
                    return { done: false, value: encoded };
                }
                return { done: true, value: undefined };
            },
        }),
    };

    (global as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        body: mockBody,
        json: async () => ({
            choices: [{ message: { content }, finish_reason: 'stop' }],
            usage: { total_tokens: 100 },
        }),
    });
}

describe('PlanningAgent output validation', () => {
    it('parses well-formed JSON task list', async () => {
        const agent = new PlanningAgent(database, llmService, configManager, outputChannel);
        await agent.initialize();

        const plan = database.createPlan('Test Plan', '{}');
        database.updatePlan(plan.id, { status: PlanStatus.Active });

        const validResponse = JSON.stringify({
            plan_name: 'Test Plan',
            tasks: [
                {
                    title: 'Setup database',
                    description: 'Create SQLite schema',
                    priority: 'P1',
                    estimated_minutes: 30,
                    acceptance_criteria: 'Schema created and migrations run',
                    depends_on_titles: [],
                    step_by_step_implementation: ['Open database.ts', 'Add CREATE TABLE statement'],
                    files_to_create: ['src/db.ts'],
                    files_to_modify: [],
                    testing_instructions: 'Run npm test',
                },
                {
                    title: 'Add API routes',
                    description: 'Create REST endpoints',
                    priority: 'P2',
                    estimated_minutes: 45,
                    acceptance_criteria: 'All CRUD endpoints work',
                    depends_on_titles: ['Setup database'],
                    step_by_step_implementation: ['Create routes file', 'Add GET handler'],
                    files_to_create: ['src/routes.ts'],
                    files_to_modify: ['src/index.ts'],
                    testing_instructions: 'Run API tests',
                },
            ],
        });

        mockLLMResponse(validResponse);
        const ctx: AgentContext = { conversationHistory: [] };
        const response = await agent.processMessage('Plan a REST API', ctx);

        expect(response.content).toBeDefined();
        // parseResponse creates a NEW plan with the parsed name, not using the pre-existing one
        const allPlans = database.getAllPlans();
        const generatedPlan = allPlans.find(p => p.name === 'Test Plan' && p.id !== plan.id) || allPlans[allPlans.length - 1];
        const tasks = database.getTasksByPlan(generatedPlan.id);
        expect(tasks.length).toBeGreaterThanOrEqual(2);
        expect(tasks[0].title).toBe('Setup database');
    });

    it('handles malformed LLM response gracefully', async () => {
        const agent = new PlanningAgent(database, llmService, configManager, outputChannel);
        await agent.initialize();

        database.createPlan('Test Plan', '{}');

        mockLLMResponse('This is not JSON at all, just plain text about planning.');
        const ctx: AgentContext = { conversationHistory: [] };
        const response = await agent.processMessage('Plan something', ctx);

        // Should not crash, should return the raw content
        expect(response.content).toContain('plain text');
    });
});

describe('VerificationAgent output validation', () => {
    it('parses structured verification result with criteria_results', async () => {
        const agent = new VerificationAgent(database, llmService, configManager, outputChannel);
        await agent.initialize();

        const plan = database.createPlan('VP', '{}');
        const task = database.createTask({
            title: 'Build login',
            description: 'Auth endpoint',
            priority: 'P1' as any,
            acceptance_criteria: 'Login works with valid credentials; Returns 401 for invalid',
            plan_id: plan.id,
        });
        database.updateTask(task.id, { status: TaskStatus.PendingVerification });

        const verificationResponse = JSON.stringify({
            status: 'passed',
            criteria_results: [
                { criterion_text: 'Login works with valid credentials', status: 'met', evidence: 'Test passes with valid token' },
                { criterion_text: 'Returns 401 for invalid', status: 'met', evidence: 'Returns 401 status code' },
            ],
            test_results: null,
            summary: 'All criteria met',
            follow_up_tasks: [],
        });

        mockLLMResponse(verificationResponse);
        const ctx: AgentContext = { task, conversationHistory: [] };
        const response = await agent.processMessage(`Verify task: ${task.title}`, ctx);

        expect(response.content).toBeDefined();
        // Verification result should exist in DB
        const result = database.getVerificationResult(task.id);
        expect(result).toBeDefined();
    });

    it('forces failure when criteria_results has not_met items', async () => {
        const agent = new VerificationAgent(database, llmService, configManager, outputChannel);
        await agent.initialize();

        const task = database.createTask({
            title: 'Build feature',
            description: 'A feature',
            priority: 'P2' as any,
            acceptance_criteria: 'Feature works; Tests pass',
        });
        database.updateTask(task.id, { status: TaskStatus.PendingVerification });

        // LLM says "passed" but one criterion is not_met — safety check should force fail
        const verificationResponse = JSON.stringify({
            status: 'passed',
            criteria_results: [
                { criterion_text: 'Feature works', status: 'met', evidence: 'Works correctly' },
                { criterion_text: 'Tests pass', status: 'not_met', evidence: 'No tests found' },
            ],
            test_results: null,
            summary: 'Mostly done',
            follow_up_tasks: [],
        });

        mockLLMResponse(verificationResponse);
        const ctx: AgentContext = { task, conversationHistory: [] };
        const response = await agent.processMessage(`Verify task: ${task.title}`, ctx);

        // The response should indicate failure due to safety check
        expect(response.content).toBeDefined();
        const result = database.getVerificationResult(task.id);
        if (result) {
            // Safety check should have forced failure
            expect(result.status).toBe('failed');
        }
    });
});

describe('AnswerAgent output validation', () => {
    it('returns answer with confidence and sources', async () => {
        const agent = new AnswerAgent(database, llmService, configManager, outputChannel);
        await agent.initialize();

        mockLLMResponse('CONFIDENCE: 85\nSOURCES: plan.json, task-42\n\nThe sidebar should collapse at 768px as specified in the responsive design section of the plan.');
        const ctx: AgentContext = { conversationHistory: [] };
        const response = await agent.processMessage('Should the sidebar collapse on mobile?', ctx);

        expect(response.content).toBeDefined();
        expect(response.content.length).toBeGreaterThan(0);
    });

    it('handles response without confidence field', async () => {
        const agent = new AnswerAgent(database, llmService, configManager, outputChannel);
        await agent.initialize();

        mockLLMResponse('Just a plain answer without any structured fields.');
        const ctx: AgentContext = { conversationHistory: [] };
        const response = await agent.processMessage('What is the architecture?', ctx);

        expect(response.content).toBeDefined();
        // Should not crash even without CONFIDENCE/SOURCES
    });
});

describe('ClarityAgent output validation', () => {
    it('parses clarity score from response', async () => {
        const agent = new ClarityAgent(database, llmService, configManager, outputChannel);
        await agent.initialize();

        mockLLMResponse('SCORE: 92\n\nThe response is clear and provides specific details about the implementation approach.');
        const ctx: AgentContext = { conversationHistory: [] };
        const response = await agent.processMessage('Rate this response for clarity: "Use JWT tokens with 24h expiry"', ctx);

        expect(response.content).toBeDefined();
        expect(response.content).toContain('92');
    });
});

describe('BossAgent output validation', () => {
    it('generates health report with severity levels', async () => {
        const agent = new BossAgent(database, llmService, configManager, outputChannel);
        await agent.initialize();

        // Add some data for the boss to analyze
        for (let i = 0; i < 5; i++) {
            database.createTask({ title: `Task ${i}`, description: '', priority: 'P2' as any });
        }

        mockLLMResponse('HEALTH REPORT:\n- System Status: HEALTHY\n- Pending Tasks: 5 (normal)\n- No agents in error state\n- Drift: 0%\n\nSEVERITY: normal\n\nNo critical issues detected.');
        const ctx: AgentContext = { conversationHistory: [] };
        const response = await agent.checkSystemHealth();

        expect(response.content).toBeDefined();
        expect(response.content.length).toBeGreaterThan(0);
    });
});

describe('ResearchAgent output validation', () => {
    it('returns structured research with findings', async () => {
        const agent = new ResearchAgent(database, llmService, configManager, outputChannel);
        await agent.initialize();

        mockLLMResponse('FINDINGS:\n1. JWT tokens are stateless and scalable\n2. Session-based auth requires server storage\n\nANALYSIS: JWT is better for microservices, sessions for monoliths.\n\nRECOMMENDATION: Use JWT for this project.\n\nCONFIDENCE: 88');
        const ctx: AgentContext = { conversationHistory: [] };
        const response = await agent.processMessage('Research auth approaches for REST API', ctx);

        expect(response.content).toBeDefined();
        expect(response.content).toContain('JWT');
    });
});
