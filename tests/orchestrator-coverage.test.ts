/**
 * Orchestrator & Custom Agent Coverage Tests
 *
 * Covers uncovered lines in:
 *   - src/agents/orchestrator.ts (lines 126, 163-210, 251-279, 289-337, 365-381)
 *   - src/agents/custom-agent.ts (runCustomAgent, loadAgentConfig, checkSimilarity, listCustomAgents, saveCustomAgent)
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
import * as yaml from 'js-yaml';
import { Database } from '../src/core/database';
import { LLMService } from '../src/core/llm-service';
import { ConfigManager } from '../src/core/config';
import { Orchestrator } from '../src/agents/orchestrator';
import { CustomAgentRunner } from '../src/agents/custom-agent';
import { AgentContext, AgentType, TaskStatus, CustomAgentConfig } from '../src/types';

// ── Temp directory & fixtures ──────────────────────────────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-orch-cov-'));

// ── Mock LLM fetch helper (SSE streaming) ──────────────────────────────
function mockLLMResponse(content: string): void {
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
                if (!readDone) { readDone = true; return { done: false, value: encoded }; }
                return { done: true, value: undefined };
            },
        }),
    };
    (global as any).fetch = jest.fn().mockResolvedValue({
        ok: true, body: mockBody,
        json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { total_tokens: 100 } }),
    });
}

// ── Shared instances ───────────────────────────────────────────────────
let db: Database;
let orchestrator: Orchestrator;
let customRunner: CustomAgentRunner;

const configManager = {
    getConfig: () => ({
        version: '1.0.0',
        llm: { endpoint: 'http://localhost:1234/v1', model: 'test', timeoutSeconds: 30, startupTimeoutSeconds: 10, streamStallTimeoutSeconds: 60, maxTokens: 4000 },
        taskQueue: { maxPending: 20 },
        verification: { delaySeconds: 0, coverageThreshold: 80 },
        watcher: { debounceMs: 500 },
        agents: {},
    }),
    getLLMConfig: () => ({ endpoint: 'http://localhost:1234/v1', model: 'test', timeoutSeconds: 30, startupTimeoutSeconds: 10, streamStallTimeoutSeconds: 60, maxTokens: 4000, maxRequestRetries: 0, maxConcurrentRequests: 4, bossReservedSlots: 1 }),
    getAgentContextLimit: () => 4000,
    getModelMaxOutputTokens: () => 4096,
    getModelContextWindow: () => 32768,
    getCOEDir: () => tmpDir,
} as unknown as ConfigManager;

const mockOutput = {
    appendLine: jest.fn(),
    show: jest.fn(),
    dispose: jest.fn(),
} as any;

const llmService = new LLMService(
    configManager.getLLMConfig(),
    mockOutput,
);

// ── Setup & Teardown ───────────────────────────────────────────────────
beforeAll(async () => {
    db = new Database(tmpDir);
    await db.initialize();
    orchestrator = new Orchestrator(db, llmService, configManager, mockOutput);
    await orchestrator.initialize();
    customRunner = (orchestrator as any).customAgentRunner as CustomAgentRunner;
});

afterAll(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ── Empty context helper ───────────────────────────────────────────────
function emptyContext(overrides?: Partial<AgentContext>): AgentContext {
    return { conversationHistory: [], ...overrides };
}

// ========================================================================
// Orchestrator tests
// ========================================================================

describe('Orchestrator', () => {
    // ------------------------------------------------------------------
    // 1. route() — successful routing to answer agent
    // ------------------------------------------------------------------
    test('route() — successful routing to answer agent', async () => {
        mockLLMResponse('This is the answer from the answer agent.');
        const ctx = emptyContext();
        const result = await orchestrator.route('how does the auth system work?', ctx);
        expect(result.content).toBeDefined();
        expect(typeof result.content).toBe('string');
        // "how" keyword matches question intent -> answer agent
    });

    // ------------------------------------------------------------------
    // 2. route() — handles agent error with ticket creation
    // ------------------------------------------------------------------
    test('route() — handles agent error with ticket creation', async () => {
        // Force the answer agent's processMessage to throw
        const answerAgent = orchestrator.getAnswerAgent();
        const origProcess = answerAgent.processMessage.bind(answerAgent);
        jest.spyOn(answerAgent, 'processMessage').mockRejectedValueOnce(new Error('LLM exploded'));

        const ctx = emptyContext();
        const result = await orchestrator.route('how does this work?', ctx);
        expect(result.content).toContain('Error from');
        expect(result.content).toContain('LLM exploded');
        expect(result.content).toContain('Investigation ticket created');

        // Verify ticket was created in DB
        const tickets = db.getAllTickets();
        const errorTicket = tickets.find(t => t.title.includes('Agent error'));
        expect(errorTicket).toBeDefined();
    });

    // ------------------------------------------------------------------
    // 3. callAgent() — direct call to known agent
    // ------------------------------------------------------------------
    test('callAgent() — direct call to known agent', async () => {
        mockLLMResponse('Planning response content.');
        const ctx = emptyContext();
        const result = await orchestrator.callAgent('planning', 'create a plan for auth', ctx);
        expect(result.content).toBeDefined();
        expect(typeof result.content).toBe('string');
    });

    // ------------------------------------------------------------------
    // 4. callAgent() — agent not found returns error
    // ------------------------------------------------------------------
    test('callAgent() — agent not found returns error', async () => {
        const ctx = emptyContext();
        const result = await orchestrator.callAgent('nonexistent_agent', 'hello', ctx);
        expect(result.content).toBe('Agent not found: nonexistent_agent');
    });

    // ------------------------------------------------------------------
    // 5. callAgent() — handles agent error
    // ------------------------------------------------------------------
    test('callAgent() — handles agent error', async () => {
        const researchAgent = orchestrator.getResearchAgent();
        jest.spyOn(researchAgent, 'processMessage').mockRejectedValueOnce(new Error('timeout'));

        const ctx = emptyContext();
        const result = await orchestrator.callAgent('research', 'investigate this', ctx);
        expect(result.content).toContain('Error from research');
        expect(result.content).toContain('timeout');
    });

    // ------------------------------------------------------------------
    // 6. classifyIntent — LLM fallback when no keywords match
    // ------------------------------------------------------------------
    test('classifyIntent — LLM fallback when no keywords match', async () => {
        // Mock the LLM classify call to return "general"
        // Use fetch mock returning a non-streaming classify response
        (global as any).fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ choices: [{ message: { content: 'general' }, finish_reason: 'stop' }], usage: { total_tokens: 5 } }),
        });

        const classify = (orchestrator as any).classifyIntent.bind(orchestrator);
        const result = await classify('lorem ipsum dolor sit amet abracadabra');
        // Should fall back to LLM and return a valid category
        expect(typeof result).toBe('string');
    });

    // ------------------------------------------------------------------
    // 7. classifyIntent — LLM offline mode defaults to general
    // ------------------------------------------------------------------
    test('classifyIntent — LLM offline mode defaults to general', async () => {
        orchestrator.setLLMOffline(true);
        const classify = (orchestrator as any).classifyIntent.bind(orchestrator);
        const result = await classify('lorem ipsum dolor sit amet abracadabra');
        expect(result).toBe('general');
        orchestrator.setLLMOffline(false);
    });

    // ------------------------------------------------------------------
    // 8. classifyIntent — LLM classify failure defaults to general
    // ------------------------------------------------------------------
    test('classifyIntent — LLM classify failure defaults to general', async () => {
        (global as any).fetch = jest.fn().mockRejectedValue(new Error('network down'));

        const classify = (orchestrator as any).classifyIntent.bind(orchestrator);
        const result = await classify('lorem ipsum dolor sit amet abracadabra');
        expect(result).toBe('general');
    });

    // ------------------------------------------------------------------
    // 9. reportTaskDone — schedules verification
    // ------------------------------------------------------------------
    test('reportTaskDone — schedules verification', async () => {
        const task = db.createTask({ title: 'Implement feature Z', acceptance_criteria: 'works' });

        // Mock LLM for the verification agent call
        mockLLMResponse('Verification passed, all criteria met.');

        await orchestrator.reportTaskDone(task.id, 'Feature Z implemented', ['src/z.ts']);

        // Task should be pending_verification
        const updated = db.getTask(task.id);
        expect(updated!.status).toBe(TaskStatus.PendingVerification);

        // Wait for the setTimeout(0) verification call to fire
        await new Promise(resolve => setTimeout(resolve, 200));
    });

    // ------------------------------------------------------------------
    // 10. freshRestart — clears state and returns stats
    // ------------------------------------------------------------------
    test('freshRestart — clears state and returns stats', async () => {
        // Create some state first
        db.createTask({ title: 'Active work', status: TaskStatus.InProgress });

        const result = await orchestrator.freshRestart();
        expect(result.tasksReady).toBeGreaterThanOrEqual(0);
        expect(result.message).toContain('Fresh restart complete');
        expect(result.message).toContain('total tasks');
    });

    // ------------------------------------------------------------------
    // 11. getNextTask — returns ready task
    // ------------------------------------------------------------------
    test('getNextTask — returns ready task', () => {
        const task = db.createTask({ title: 'Ready task for queue test' });
        const next = orchestrator.getNextTask();
        // There should be at least one ready task
        expect(next).not.toBeNull();
    });

    // ------------------------------------------------------------------
    // 12. setEvolutionService + getEvolutionService
    // ------------------------------------------------------------------
    test('setEvolutionService + getEvolutionService', () => {
        expect(orchestrator.getEvolutionService()).toBeNull();

        const mockEvolution = { incrementCallCounter: jest.fn() } as any;
        orchestrator.setEvolutionService(mockEvolution);
        expect(orchestrator.getEvolutionService()).toBe(mockEvolution);
    });

    // ------------------------------------------------------------------
    // 13. dispose() — disposes all agents
    // ------------------------------------------------------------------
    test('dispose() — disposes all agents without crashing', () => {
        // We create a fresh orchestrator to dispose without affecting the main one
        // Actually, just call dispose on the main one - we'll recreate it
        expect(() => orchestrator.dispose()).not.toThrow();
    });

    // ------------------------------------------------------------------
    // 14. getAgentByName — returns correct agents
    // ------------------------------------------------------------------
    test('getAgentByName — returns correct agents', () => {
        const getAgent = (name: string) => (orchestrator as any).getAgentByName(name);

        expect(getAgent('planning')).toBeTruthy();
        expect(getAgent('answer')).toBeTruthy();
        expect(getAgent('verification')).toBeTruthy();
        expect(getAgent('research')).toBeTruthy();
        expect(getAgent('clarity')).toBeTruthy();
        expect(getAgent('boss')).toBeTruthy();
        expect(getAgent('custom')).toBeTruthy();
        expect(getAgent('orchestrator')).toBeTruthy();
        expect(getAgent('nonexistent')).toBeNull();
    });

    // ------------------------------------------------------------------
    // 15. getAgentForIntent — returns correct agents for all intents
    // ------------------------------------------------------------------
    test('getAgentForIntent — returns correct agents for all intents', () => {
        const getForIntent = (intent: string) => (orchestrator as any).getAgentForIntent(intent);

        const planningAgent = getForIntent('planning');
        expect(planningAgent.name).toBe('Planning Team');

        const verificationAgent = getForIntent('verification');
        expect(verificationAgent.name).toBe('Verification Team');

        const questionAgent = getForIntent('question');
        expect(questionAgent.name).toBe('Answer Agent');

        const researchAgent = getForIntent('research');
        expect(researchAgent.name).toBe('Research Agent');

        const customAgent = getForIntent('custom');
        expect(customAgent.name).toBe('Custom Agent Runner');

        const generalAgent = getForIntent('general');
        expect(generalAgent.name).toBe('Answer Agent');

        // Unknown intent also defaults to answer
        const unknownAgent = getForIntent('foobar_unknown');
        expect(unknownAgent.name).toBe('Answer Agent');
    });

    // ------------------------------------------------------------------
    // Agent accessor methods
    // ------------------------------------------------------------------
    test('agent accessor methods return agent instances', () => {
        expect(orchestrator.getPlanningAgent()).toBeDefined();
        expect(orchestrator.getAnswerAgent()).toBeDefined();
        expect(orchestrator.getVerificationAgent()).toBeDefined();
        expect(orchestrator.getResearchAgent()).toBeDefined();
        expect(orchestrator.getClarityAgent()).toBeDefined();
        expect(orchestrator.getBossAgent()).toBeDefined();
        expect(orchestrator.getCustomAgentRunner()).toBeDefined();
    });

    // ------------------------------------------------------------------
    // reportTaskDone — task not found throws
    // ------------------------------------------------------------------
    test('reportTaskDone — task not found throws', async () => {
        await expect(
            orchestrator.reportTaskDone('nonexistent-task-id-999', 'done', [])
        ).rejects.toThrow('Task not found');
    });

    // ------------------------------------------------------------------
    // route() with task context
    // ------------------------------------------------------------------
    test('route() — passes task context through', async () => {
        mockLLMResponse('Response with context.');
        const task = db.createTask({ title: 'Context task', acceptance_criteria: 'test' });
        const ctx = emptyContext({ task });
        const result = await orchestrator.route('how do I fix this?', ctx);
        expect(result.content).toBeDefined();
    });
});

// ========================================================================
// Custom Agent tests
// ========================================================================

describe('CustomAgentRunner', () => {
    const customAgentsDir = path.join(tmpDir, 'agents', 'custom');

    // Ensure the custom agents directory exists
    beforeAll(() => {
        fs.mkdirSync(customAgentsDir, { recursive: true });
    });

    function writeYamlAgent(name: string, overrides: Record<string, unknown> = {}, ext = '.yaml'): void {
        const base: Record<string, unknown> = {
            name,
            description: 'A test agent',
            systemPrompt: 'You are a test agent',
            goals: [
                { description: 'Analyze code', priority: 1 },
            ],
            checklist: [
                { item: 'Check syntax' },
            ],
            routingKeywords: ['test'],
            limits: {
                maxGoals: 5,
                maxLLMCalls: 10,
                maxTimeMinutes: 5,
                timePerGoalMinutes: 2,
            },
            ...overrides,
        };
        fs.writeFileSync(path.join(customAgentsDir, `${name}${ext}`), yaml.dump(base), 'utf-8');
    }

    // ------------------------------------------------------------------
    // 16. runCustomAgent — agent not found
    // ------------------------------------------------------------------
    test('runCustomAgent — agent not found', async () => {
        const result = await customRunner.runCustomAgent('ghost-agent', 'hello', emptyContext());
        expect(result.content).toBe('Custom agent not found: ghost-agent');
    });

    // ------------------------------------------------------------------
    // 17. runCustomAgent — blocks write/execute permissions
    // ------------------------------------------------------------------
    test('runCustomAgent — blocks write/execute permissions', async () => {
        // Write a YAML config where permissions explicitly set writeFiles/executeCode to true
        const agentName = 'write-test-agent';
        const yamlContent = {
            name: agentName,
            description: 'Tries to write',
            systemPrompt: 'You write files',
            goals: [{ description: 'Write files', priority: 1 }],
            checklist: [{ item: 'Write something' }],
            routingKeywords: ['write'],
            permissions: {
                readFiles: true,
                searchCode: true,
                createTickets: true,
                callLLM: true,
                writeFiles: true,
                executeCode: true,
            },
            limits: {
                maxGoals: 5,
                maxLLMCalls: 10,
                maxTimeMinutes: 5,
                timePerGoalMinutes: 2,
            },
        };
        fs.writeFileSync(
            path.join(customAgentsDir, `${agentName}.yaml`),
            yaml.dump(yamlContent),
            'utf-8',
        );

        // The parseYaml hardlocks writeFiles/executeCode to false,
        // so this agent should load with writeFiles=false and the hardlock check
        // should NOT block it. Let's verify the parsing behavior:
        const config = (customRunner as any).loadAgentConfig(agentName);
        expect(config).not.toBeNull();
        expect(config!.permissions.writeFiles).toBe(false);
        expect(config!.permissions.executeCode).toBe(false);
    });

    // ------------------------------------------------------------------
    // 18. runCustomAgent — runs goals successfully
    // ------------------------------------------------------------------
    test('runCustomAgent — runs goals successfully', async () => {
        const agentName = 'success-agent';
        writeYamlAgent(agentName, {
            goals: [
                { description: 'First analysis', priority: 1 },
                { description: 'Second analysis', priority: 2 },
            ],
        });

        mockLLMResponse('Goal completed successfully with detailed analysis.');
        const result = await customRunner.runCustomAgent(agentName, 'analyze the codebase', emptyContext());

        expect(result.content).toContain('Goal 1');
        expect(result.tokensUsed).toBeGreaterThanOrEqual(1);
    });

    // ------------------------------------------------------------------
    // 19. runCustomAgent — LLM call budget check
    // ------------------------------------------------------------------
    test('runCustomAgent — LLM call budget check', async () => {
        const agentName = 'budget-agent';
        writeYamlAgent(agentName, {
            goals: [
                { description: 'Goal A', priority: 1 },
                { description: 'Goal B', priority: 2 },
                { description: 'Goal C', priority: 3 },
            ],
            limits: {
                maxGoals: 5,
                maxLLMCalls: 1,
                maxTimeMinutes: 5,
                timePerGoalMinutes: 2,
            },
        });

        mockLLMResponse('First goal result.');
        const result = await customRunner.runCustomAgent(agentName, 'do everything', emptyContext());

        // Only 1 LLM call allowed, so should have only 1 goal result
        expect(result.tokensUsed).toBe(1);
    });

    // ------------------------------------------------------------------
    // 20. listCustomAgents — returns agent names
    // ------------------------------------------------------------------
    test('listCustomAgents — returns agent names', () => {
        // We've already created several agents above, let's add one more
        writeYamlAgent('list-test-agent');

        const agents = customRunner.listCustomAgents();
        expect(agents.length).toBeGreaterThanOrEqual(1);
        expect(agents).toContain('list-test-agent');
    });

    // ------------------------------------------------------------------
    // 21. saveCustomAgent — force hardlocks write/execute
    // ------------------------------------------------------------------
    test('saveCustomAgent — force hardlocks write/execute', () => {
        const config: CustomAgentConfig = {
            name: 'saved-agent',
            description: 'Saved test agent',
            systemPrompt: 'You are saved',
            goals: [{ description: 'Goal', priority: 1 }],
            checklist: [{ item: 'Check', required: true }],
            routingKeywords: ['save'],
            permissions: {
                readFiles: true,
                searchCode: true,
                createTickets: true,
                callLLM: true,
                writeFiles: true as any,   // Intentionally pass true
                executeCode: true as any,  // Intentionally pass true
            },
            limits: {
                maxGoals: 10,
                maxLLMCalls: 20,
                maxTimeMinutes: 10,
                timePerGoalMinutes: 3,
            },
        };

        customRunner.saveCustomAgent(config);

        // Verify the config was hardlocked on the object itself
        expect(config.permissions.writeFiles).toBe(false);
        expect(config.permissions.executeCode).toBe(false);

        // Verify the saved file exists
        const savedPath = path.join(customAgentsDir, 'saved-agent.yaml');
        expect(fs.existsSync(savedPath)).toBe(true);

        // Load it back and verify hardlocked
        const loaded = (customRunner as any).loadAgentConfig('saved-agent');
        expect(loaded).not.toBeNull();
        expect(loaded!.permissions.writeFiles).toBe(false);
        expect(loaded!.permissions.executeCode).toBe(false);
    });

    // ------------------------------------------------------------------
    // 22. loadAgentConfig — loads .yml extension
    // ------------------------------------------------------------------
    test('loadAgentConfig — loads .yml extension', () => {
        writeYamlAgent('yml-agent', {}, '.yml');

        const config = (customRunner as any).loadAgentConfig('yml-agent');
        expect(config).not.toBeNull();
        expect(config!.name).toBe('yml-agent');
    });

    // ------------------------------------------------------------------
    // 23. checkSimilarity — detects similar texts
    // ------------------------------------------------------------------
    test('checkSimilarity — detects similar texts', () => {
        const check = (texts: string[]) => (customRunner as any).checkSimilarity(texts);

        // Identical texts should have similarity of 1.0
        const identical = check(['hello world foo bar', 'hello world foo bar']);
        expect(identical).toBe(1.0);

        // Completely different texts
        const different = check(['alpha beta gamma', 'one two three']);
        expect(different).toBeLessThan(0.5);

        // Single text returns 0
        expect(check(['only one'])).toBe(0);

        // Empty array
        expect(check([])).toBe(0);

        // Three texts, similarity checked on last two
        const threeSimilar = check([
            'the quick brown fox jumps',
            'the quick brown fox jumps over the lazy dog',
            'the quick brown fox jumps over the lazy dog',
        ]);
        expect(threeSimilar).toBe(1.0);
    });

    // ------------------------------------------------------------------
    // loadAgentConfig — returns null for missing agent
    // ------------------------------------------------------------------
    test('loadAgentConfig — returns null for missing agent', () => {
        const config = (customRunner as any).loadAgentConfig('totally-nonexistent-agent');
        expect(config).toBeNull();
    });

    // ------------------------------------------------------------------
    // loadAgentConfig — handles malformed YAML gracefully
    // ------------------------------------------------------------------
    test('loadAgentConfig — handles malformed YAML gracefully', () => {
        fs.writeFileSync(
            path.join(customAgentsDir, 'broken-agent.yaml'),
            '{{{{invalid yaml content::::',
            'utf-8',
        );
        const config = (customRunner as any).loadAgentConfig('broken-agent');
        // parseYaml catches the error and returns null
        expect(config).toBeNull();
    });

    // ------------------------------------------------------------------
    // listCustomAgents — returns empty if dir missing
    // ------------------------------------------------------------------
    test('listCustomAgents — handles directory read correctly', () => {
        const agents = customRunner.listCustomAgents();
        expect(Array.isArray(agents)).toBe(true);
    });

    // ------------------------------------------------------------------
    // runCustomAgent — handles LLM error during goal execution
    // ------------------------------------------------------------------
    test('runCustomAgent — handles LLM error during goal execution', async () => {
        const agentName = 'error-goal-agent';
        writeYamlAgent(agentName);

        // Make the LLM call fail
        (global as any).fetch = jest.fn().mockRejectedValue(new Error('LLM crashed mid-goal'));

        const result = await customRunner.runCustomAgent(agentName, 'analyze code', emptyContext());
        // Should contain ERROR in the results
        expect(result.content).toContain('ERROR');
    });

    // ------------------------------------------------------------------
    // runCustomAgent — with task context
    // ------------------------------------------------------------------
    test('runCustomAgent — with task context', async () => {
        const agentName = 'context-agent';
        writeYamlAgent(agentName);

        mockLLMResponse('Analysis complete with task context.');
        const task = db.createTask({ title: 'Context task for custom agent' });
        const ctx = emptyContext({ task });
        const result = await customRunner.runCustomAgent(agentName, 'analyze', ctx);
        expect(result.content).toContain('Goal 1');
    });
});

// ========================================================================
// Re-initialize orchestrator after dispose for subsequent runs
// ========================================================================
afterAll(async () => {
    // The orchestrator was disposed in test 13, re-init isn't needed since
    // this is the last describe block. Cleanup is handled by the outer afterAll.
});
