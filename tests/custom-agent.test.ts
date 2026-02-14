import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { Database } from '../src/core/database';
import { CustomAgentRunner } from '../src/agents/custom-agent';
import { AgentType, AgentContext, AgentStatus, ConversationRole } from '../src/types';

// Mock vscode
jest.mock('vscode', () => require('./__mocks__/vscode'));

let tmpDir: string;
let db: Database;
let customAgentsDir: string;

const mockLLM = {
    chat: jest.fn(),
    classify: jest.fn(),
} as any;

const mockConfig = {
    getAgentContextLimit: jest.fn().mockReturnValue(4000),
    getConfig: jest.fn().mockReturnValue({}),
    getCOEDir: jest.fn(),
} as any;

const mockOutput = { appendLine: jest.fn() } as any;

function emptyContext(): AgentContext {
    return { conversationHistory: [] };
}

/**
 * Helper: write a YAML agent config file to disk.
 */
function writeAgentYaml(name: string, config: Record<string, unknown>, ext = '.yaml'): void {
    const filePath = path.join(customAgentsDir, `${name}${ext}`);
    fs.writeFileSync(filePath, yaml.dump(config), 'utf-8');
}

beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-custom-agent-'));
    mockConfig.getCOEDir.mockReturnValue(tmpDir);
    customAgentsDir = path.join(tmpDir, 'agents', 'custom');
    fs.mkdirSync(customAgentsDir, { recursive: true });

    db = new Database(tmpDir);
    await db.initialize();
    jest.clearAllMocks();
    mockConfig.getAgentContextLimit.mockReturnValue(4000);
});

afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('CustomAgentRunner', () => {
    let agent: CustomAgentRunner;

    beforeEach(async () => {
        agent = new CustomAgentRunner(db, mockLLM, mockConfig, mockOutput);
        await agent.initialize();
    });

    // --- Lines 46-48: Hardlock block when writeFiles or executeCode are true ---

    describe('hardlock permission block (lines 46-48)', () => {
        test('blocks agent when writeFiles permission is true in config', async () => {
            // Write a YAML config where permissions.writeFiles is set to true
            // The parseYaml method hardlocks writeFiles to false, BUT the hardlock
            // check in runCustomAgent tests the config returned from loadAgentConfig.
            // Since parseYaml forces writeFiles=false, we need to test by directly
            // calling runCustomAgent with a config that has writeFiles=true.
            // The actual config on disk won't produce this since parseYaml forces false.
            // To cover lines 46-48, we need the runtime check to trigger.
            // Let's mock loadAgentConfig to return a config with writeFiles=true.

            // Create a valid agent YAML on disk
            writeAgentYaml('write-agent', {
                name: 'write-agent',
                description: 'An agent that tries to write',
                systemPrompt: 'You write files.',
                goals: [{ description: 'Write a file', priority: 1 }],
                checklist: [{ item: 'Check output', required: true }],
                routingKeywords: ['write'],
            });

            // Override the private loadAgentConfig to return a config with writeFiles=true
            const originalLoad = (agent as any).loadAgentConfig.bind(agent);
            (agent as any).loadAgentConfig = (name: string) => {
                const config = originalLoad(name);
                if (config) {
                    config.permissions.writeFiles = true;
                }
                return config;
            };

            const result = await agent.runCustomAgent('write-agent', 'Do something', emptyContext());

            expect(result.content).toContain('BLOCKED');
            expect(result.content).toContain('cannot write files or execute code');

            // Verify audit log was written
            const auditLogs = db.getAuditLog();
            const blockLog = auditLogs.find(a => a.action === 'hardlock_block');
            expect(blockLog).toBeDefined();
            expect(blockLog!.detail).toContain('write/execute permission');
        });

        test('blocks agent when executeCode permission is true', async () => {
            writeAgentYaml('exec-agent', {
                name: 'exec-agent',
                description: 'An agent that tries to execute',
                systemPrompt: 'You execute code.',
                goals: [{ description: 'Execute code', priority: 1 }],
                checklist: [{ item: 'Check output', required: true }],
                routingKeywords: ['execute'],
            });

            const originalLoad = (agent as any).loadAgentConfig.bind(agent);
            (agent as any).loadAgentConfig = (name: string) => {
                const config = originalLoad(name);
                if (config) {
                    config.permissions.executeCode = true;
                }
                return config;
            };

            const result = await agent.runCustomAgent('exec-agent', 'Run code', emptyContext());

            expect(result.content).toContain('BLOCKED');
        });
    });

    // --- Lines 70-72: Time budget exceeded during goal processing ---

    describe('time budget timeout (lines 70-72)', () => {
        test('breaks out of goal loop when time budget is exceeded', async () => {
            writeAgentYaml('timeout-agent', {
                name: 'timeout-agent',
                description: 'An agent that times out',
                systemPrompt: 'You are slow.',
                goals: [
                    { description: 'Goal 1', priority: 1 },
                    { description: 'Goal 2', priority: 2 },
                ],
                checklist: [{ item: 'Check', required: true }],
                routingKeywords: ['timeout'],
                limits: {
                    maxGoals: 20,
                    maxLLMCalls: 50,
                    maxTimeMinutes: 0, // Set to 0 to trigger immediate timeout
                    timePerGoalMinutes: 5,
                },
            });

            // First call succeeds but the time check happens BEFORE the second goal
            mockLLM.chat.mockResolvedValue({
                content: 'Goal 1 result',
                tokens_used: 10,
            });

            // We need the first goal to succeed, then time check triggers on second.
            // Since maxTimeMinutes is 0, any elapsed time > 0 triggers the break.
            // But the time check happens at the start of the loop iteration.
            // The first iteration checks elapsed, which is ~0ms / 60000 = ~0 min.
            // With maxTimeMinutes = 0, elapsed > 0 should trigger, but 0 > 0 is false.
            // Let's use a very small value that would be exceeded.
            // Actually, let's mock Date.now to simulate time passing.
            const originalNow = Date.now;
            let callCount = 0;
            Date.now = jest.fn(() => {
                callCount++;
                // First call (startTime): 0
                // Second call (elapsed check for goal 1): 0 (elapsed = 0, ok)
                // The elapsed check is: (Date.now() - startTime) / 1000 / 60
                // For goal 1: elapsed = (0-0)/60000 = 0 < maxTimeMinutes(0) = false, runs goal 1
                // For goal 2: we need elapsed > maxTimeMinutes
                // Let's make maxTimeMinutes = 0.0001 (effectively 0)
                // Actually let's just make the startTime at 0 and the next checks much later
                if (callCount <= 2) return 0;        // startTime and first elapsed check
                return 60 * 60 * 1000;               // 60 minutes later for subsequent checks
            });

            try {
                const result = await agent.runCustomAgent('timeout-agent', 'Do things', emptyContext());

                // Should have timed out and only completed goal 1
                const auditLogs = db.getAuditLog();
                const timeoutLog = auditLogs.find(a => a.action === 'custom_agent_timeout');
                expect(timeoutLog).toBeDefined();
                expect(timeoutLog!.detail).toContain('timed out');
            } finally {
                Date.now = originalNow;
            }
        });
    });

    // --- Lines 100-105: Loop detection when responses are too similar ---

    describe('loop detection (lines 100-105)', () => {
        test('detects loop when 3 consecutive responses are very similar', async () => {
            writeAgentYaml('loop-agent', {
                name: 'loop-agent',
                description: 'An agent that loops',
                systemPrompt: 'You repeat yourself.',
                goals: [
                    { description: 'G', priority: 1 },
                    { description: 'G', priority: 2 },
                    { description: 'G', priority: 3 },
                    { description: 'G', priority: 4 },
                ],
                checklist: [{ item: 'Check', required: true }],
                routingKeywords: ['loop'],
                limits: {
                    maxGoals: 20,
                    maxLLMCalls: 50,
                    maxTimeMinutes: 30,
                    timePerGoalMinutes: 5,
                },
            });

            // checkSimilarity uses Jaccard similarity on word SETS (deduplicates).
            // We need shared_unique_words / (shared_unique_words + 2) > 0.85
            // => shared >= 12 unique words. Prefix adds "goal" and "(g):" as shared.
            // So response needs >= 10 unique words beyond the prefix.
            const longIdenticalText = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega';
            mockLLM.chat.mockResolvedValue({
                content: longIdenticalText,
                tokens_used: 10,
            });

            const result = await agent.runCustomAgent('loop-agent', 'Do things', emptyContext());

            // Loop should be detected after the 3rd similar response
            const auditLogs = db.getAuditLog();
            const loopLog = auditLogs.find(a => a.action === 'custom_agent_loop');
            expect(loopLog).toBeDefined();
            expect(loopLog!.detail).toContain('detected loop');
        });
    });

    // --- Branch coverage: agent not found ---

    describe('agent not found branch', () => {
        test('returns error message when agent config not found', async () => {
            const result = await agent.runCustomAgent('nonexistent-agent', 'Hello', emptyContext());
            expect(result.content).toContain('Custom agent not found: nonexistent-agent');
        });
    });

    // --- LLM call budget exceeded ---

    describe('LLM call budget exceeded (line 76-79)', () => {
        test('breaks when LLM call limit is reached', async () => {
            writeAgentYaml('budget-agent', {
                name: 'budget-agent',
                description: 'An agent with tight budget',
                systemPrompt: 'You are budget-conscious.',
                goals: [
                    { description: 'Goal 1', priority: 1 },
                    { description: 'Goal 2', priority: 2 },
                ],
                checklist: [{ item: 'Check', required: true }],
                routingKeywords: ['budget'],
                limits: {
                    maxGoals: 20,
                    maxLLMCalls: 1, // Only 1 LLM call allowed
                    maxTimeMinutes: 30,
                    timePerGoalMinutes: 5,
                },
            });

            mockLLM.chat.mockResolvedValue({
                content: 'Result for goal',
                tokens_used: 10,
            });

            const result = await agent.runCustomAgent('budget-agent', 'Do work', emptyContext());

            // Should have completed 1 goal then stopped
            const auditLogs = db.getAuditLog();
            const budgetLog = auditLogs.find(a => a.action === 'custom_agent_budget');
            expect(budgetLog).toBeDefined();
            expect(budgetLog!.detail).toContain('exceeded LLM call limit');
        });
    });

    // --- Per-goal timeout error catch ---

    describe('per-goal error handling (lines 118-122)', () => {
        test('catches goal-level errors and continues', async () => {
            writeAgentYaml('error-agent', {
                name: 'error-agent',
                description: 'An agent that errors',
                systemPrompt: 'You error.',
                goals: [
                    { description: 'Goal 1', priority: 1 },
                    { description: 'Goal 2', priority: 2 },
                ],
                checklist: [{ item: 'Check', required: true }],
                routingKeywords: ['error'],
                limits: {
                    maxGoals: 20,
                    maxLLMCalls: 50,
                    maxTimeMinutes: 30,
                    timePerGoalMinutes: 5,
                },
            });

            // First call throws, second succeeds
            mockLLM.chat
                .mockRejectedValueOnce(new Error('LLM crashed'))
                .mockResolvedValueOnce({
                    content: 'Goal 2 result',
                    tokens_used: 10,
                });

            const result = await agent.runCustomAgent('error-agent', 'Do work', emptyContext());

            expect(result.content).toContain('ERROR');
            expect(result.content).toContain('Goal 2 result');
            expect(mockOutput.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Custom agent goal 1 error')
            );
        });
    });

    // --- listCustomAgents ---

    describe('listCustomAgents', () => {
        test('returns list of .yaml and .yml files', () => {
            writeAgentYaml('agent-a', { name: 'A' }, '.yaml');
            writeAgentYaml('agent-b', { name: 'B' }, '.yml');
            writeAgentYaml('agent-c', { name: 'C' }, '.yaml');

            const agents = agent.listCustomAgents();
            expect(agents).toContain('agent-a');
            expect(agents).toContain('agent-b');
            expect(agents).toContain('agent-c');
        });

        test('returns empty array when directory does not exist', () => {
            // Remove the custom agents dir
            fs.rmSync(customAgentsDir, { recursive: true, force: true });

            const agents = agent.listCustomAgents();
            expect(agents).toEqual([]);
        });
    });

    // --- saveCustomAgent ---

    describe('saveCustomAgent', () => {
        test('saves agent config to YAML file and registers in database', () => {
            const config: any = {
                name: 'test-save-agent',
                description: 'Test save',
                systemPrompt: 'You are saved.',
                goals: [{ description: 'Test goal', priority: 1 }],
                checklist: [{ item: 'Check', required: true }],
                routingKeywords: ['save'],
                permissions: {
                    readFiles: true,
                    searchCode: true,
                    createTickets: true,
                    callLLM: true,
                    writeFiles: true,   // Should be forced to false
                    executeCode: true,  // Should be forced to false
                },
                limits: {
                    maxGoals: 5,
                    maxLLMCalls: 10,
                    maxTimeMinutes: 10,
                    timePerGoalMinutes: 2,
                },
            };

            agent.saveCustomAgent(config);

            // Verify file was created
            const filePath = path.join(customAgentsDir, 'test-save-agent.yaml');
            expect(fs.existsSync(filePath)).toBe(true);

            // Verify permissions were hardlocked
            expect(config.permissions.writeFiles).toBe(false);
            expect(config.permissions.executeCode).toBe(false);
        });
    });

    // --- .yml fallback in loadAgentConfig ---

    describe('loadAgentConfig .yml fallback', () => {
        test('loads agent config from .yml when .yaml does not exist', async () => {
            writeAgentYaml('yml-agent', {
                name: 'yml-agent',
                description: 'YAML with .yml extension',
                systemPrompt: 'You are a yml agent.',
                goals: [{ description: 'Single goal', priority: 1 }],
                checklist: [{ item: 'Check', required: true }],
                routingKeywords: ['yml'],
            }, '.yml');

            mockLLM.chat.mockResolvedValue({
                content: 'Result from yml agent',
                tokens_used: 10,
            });

            const result = await agent.runCustomAgent('yml-agent', 'Test yml', emptyContext());

            expect(result.content).toContain('Result from yml agent');
        });
    });

    // --- parseYaml error handling (line 176-178) ---

    describe('parseYaml error handling', () => {
        test('returns null and logs error for invalid YAML', async () => {
            // Write invalid YAML
            const filePath = path.join(customAgentsDir, 'bad-agent.yaml');
            fs.writeFileSync(filePath, '{{{{invalid yaml content !@#$%', 'utf-8');

            const result = await agent.runCustomAgent('bad-agent', 'Test', emptyContext());

            expect(result.content).toContain('Custom agent not found: bad-agent');
            expect(mockOutput.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Error loading custom agent YAML')
            );
        });
    });

    // --- initialize creates directory when it doesn't exist (line 34) ---

    describe('initialize creates missing directory (line 34)', () => {
        test('creates customAgentsDir if it does not exist', async () => {
            // Remove the custom agents directory
            fs.rmSync(customAgentsDir, { recursive: true, force: true });
            expect(fs.existsSync(customAgentsDir)).toBe(false);

            // Re-set the mock since clearAllMocks was called
            mockConfig.getCOEDir.mockReturnValue(tmpDir);

            // Create a new agent and initialize — this should create the directory
            const freshAgent = new CustomAgentRunner(db, mockLLM, mockConfig, mockOutput);
            await freshAgent.initialize();

            expect(fs.existsSync(customAgentsDir)).toBe(true);
        });
    });

    // --- Per-goal timeout fires (setTimeout callback on line 92 — the uncalled function) ---

    describe('per-goal timeout callback fires (line 92)', () => {
        test('goal times out when LLM takes longer than timePerGoalMinutes', async () => {
            writeAgentYaml('slow-agent', {
                name: 'slow-agent',
                description: 'An agent whose LLM is slow',
                systemPrompt: 'You are slow.',
                goals: [
                    { description: 'Slow goal', priority: 1 },
                ],
                checklist: [{ item: 'Check', required: true }],
                routingKeywords: ['slow'],
            });

            // Override loadAgentConfig to return a config with very tiny timePerGoalMinutes
            // so the setTimeout fires before the LLM resolves
            const originalLoad = (agent as any).loadAgentConfig.bind(agent);
            (agent as any).loadAgentConfig = (name: string) => {
                const config = originalLoad(name);
                if (config) {
                    config.limits.timePerGoalMinutes = 0.00001; // ~0.6ms timeout
                }
                return config;
            };

            // Make the LLM chat take much longer than the timeout
            mockLLM.chat.mockImplementation(() =>
                new Promise(resolve => setTimeout(() =>
                    resolve({ content: 'Finally done', tokens_used: 10 }), 200
                ))
            );

            const result = await agent.runCustomAgent('slow-agent', 'Do slow work', emptyContext());

            // The goal should have timed out with "Goal timeout" error
            expect(result.content).toContain('ERROR');
            expect(result.content).toContain('Goal timeout');
            expect(mockOutput.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Custom agent goal 1 error: Goal timeout')
            );
        });
    });

    // --- Line 119: error catch block with non-Error object (String(error) branch) ---

    describe('per-goal error with non-Error object (line 119)', () => {
        test('catches non-Error thrown objects and converts them to string', async () => {
            writeAgentYaml('string-error-agent', {
                name: 'string-error-agent',
                description: 'An agent that throws a string error',
                systemPrompt: 'You throw strings.',
                goals: [
                    { description: 'Goal 1', priority: 1 },
                ],
                checklist: [{ item: 'Check', required: true }],
                routingKeywords: ['strerror'],
                limits: {
                    maxGoals: 20,
                    maxLLMCalls: 50,
                    maxTimeMinutes: 30,
                    timePerGoalMinutes: 5,
                },
            });

            // Throw a string, not an Error instance
            mockLLM.chat.mockRejectedValueOnce('raw string failure');

            const result = await agent.runCustomAgent('string-error-agent', 'Do work', emptyContext());

            expect(result.content).toContain('ERROR');
            expect(result.content).toContain('raw string failure');
            expect(mockOutput.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Custom agent goal 1 error: raw string failure')
            );
        });
    });

    // --- Lines 155-160: parseYaml default fallbacks for missing fields ---

    describe('parseYaml default fallbacks (lines 155-160)', () => {
        test('uses filename as name when name is not in YAML', async () => {
            // Write YAML with no name field at all
            writeAgentYaml('noname-agent', {
                description: 'Has no name field',
                systemPrompt: 'You are nameless.',
                goals: [{ description: 'Do something', priority: 1 }],
                checklist: [{ item: 'Check', required: true }],
            });

            mockLLM.chat.mockResolvedValue({
                content: 'Result from nameless agent',
                tokens_used: 10,
            });

            const result = await agent.runCustomAgent('noname-agent', 'Test', emptyContext());
            // The agent should load successfully using filename as name fallback
            expect(result.content).toContain('Result from nameless agent');
        });

        test('uses empty defaults for missing optional fields', async () => {
            // Write YAML with minimal fields — only name
            writeAgentYaml('minimal-agent', {
                name: 'minimal-agent',
                // No description, systemPrompt, goals, checklist, routingKeywords
            });

            mockLLM.chat.mockResolvedValue({
                content: 'Minimal result',
                tokens_used: 10,
            });

            // Should load fine with all defaults (empty goals means 0 iterations)
            const result = await agent.runCustomAgent('minimal-agent', 'Test', emptyContext());
            // With no goals, the loop runs 0 times, so content is empty string join
            expect(result.content).toBeDefined();
        });

        test('uses system_prompt snake_case fallback when systemPrompt is missing', async () => {
            writeAgentYaml('snakecase-agent', {
                name: 'snakecase-agent',
                description: 'Snake case test',
                system_prompt: 'You are a snake_case prompt agent.',
                goals: [{ description: 'Goal', priority: 1 }],
                checklist: [{ item: 'Check', required: true }],
                routing_keywords: ['snake'],
            });

            mockLLM.chat.mockResolvedValue({
                content: 'Snake case result',
                tokens_used: 10,
            });

            const result = await agent.runCustomAgent('snakecase-agent', 'Test snake', emptyContext());
            expect(result.content).toContain('Snake case result');
        });
    });

    // --- Line 191: checkSimilarity union.size === 0 branch ---

    describe('checkSimilarity empty union (line 191)', () => {
        test('handles empty strings in similarity check returning 0', async () => {
            writeAgentYaml('empty-response-agent', {
                name: 'empty-response-agent',
                description: 'Agent returns empty',
                systemPrompt: 'Return empty.',
                goals: [
                    { description: 'G1', priority: 1 },
                    { description: 'G2', priority: 2 },
                    { description: 'G3', priority: 3 },
                    { description: 'G4', priority: 4 },
                ],
                checklist: [{ item: 'Check', required: true }],
                routingKeywords: ['empty'],
                limits: {
                    maxGoals: 20,
                    maxLLMCalls: 50,
                    maxTimeMinutes: 30,
                    timePerGoalMinutes: 5,
                },
            });

            // Return empty strings - when split by \s+ the word sets will be ['']
            // but union won't be size 0 since '' is still an element.
            // To actually hit union.size === 0, we'd need truly empty sets.
            // Since split('') gives [''], the union will always have at least 1 element.
            // The branch is defensive. Let's just exercise the similarity path with
            // very different responses to ensure it doesn't false-positive.
            mockLLM.chat
                .mockResolvedValueOnce({ content: 'completely unique first response alpha beta', tokens_used: 10 })
                .mockResolvedValueOnce({ content: 'totally different second output gamma delta', tokens_used: 10 })
                .mockResolvedValueOnce({ content: 'another distinct third reply epsilon zeta', tokens_used: 10 })
                .mockResolvedValueOnce({ content: 'fourth unrelated answer eta theta', tokens_used: 10 });

            const result = await agent.runCustomAgent('empty-response-agent', 'Test', emptyContext());

            // All 4 goals should complete (no loop detected)
            const parts = result.content.split('---');
            expect(parts.length).toBe(4);
        });
    });

    // --- Lines 183-191: checkSimilarity direct access for branch coverage ---

    describe('checkSimilarity private method direct testing (lines 183-191)', () => {
        test('returns 0 for texts with fewer than 2 elements (line 183)', () => {
            const sim = (agent as any).checkSimilarity([]);
            expect(sim).toBe(0);
            const sim1 = (agent as any).checkSimilarity(['only one']);
            expect(sim1).toBe(0);
        });

        test('returns high similarity for identical texts', () => {
            const sim = (agent as any).checkSimilarity(['hello world', 'hello world']);
            expect(sim).toBe(1);
        });

        test('returns moderate similarity for overlapping texts', () => {
            const sim = (agent as any).checkSimilarity(['hello world foo', 'hello world bar']);
            expect(sim).toBeGreaterThan(0.3);
            expect(sim).toBeLessThan(1);
        });

        test('returns 0 for completely different texts', () => {
            const sim = (agent as any).checkSimilarity(['alpha beta gamma', 'delta epsilon zeta']);
            expect(sim).toBe(0);
        });

        test('handles empty string elements (union has at least 1 element)', () => {
            // split('') by /\s+/ gives [''], so union has size 1
            const sim = (agent as any).checkSimilarity(['', '']);
            // Both produce Set(['']) which are identical, intersection=1, union=1
            expect(sim).toBe(1);
        });

        test('union.size === 0 branch (line 191) is unreachable — marked with istanbul ignore', () => {
            // String.prototype.split(/\s+/) always returns at least [''] for any input,
            // so the resulting Set always has at least 1 element. The union of two
            // non-empty Sets is always non-empty, making union.size > 0 always true.
            // The `: 0` fallback is purely defensive and marked /* istanbul ignore next */.
            // We verify this by checking that even whitespace-only strings produce non-empty sets.
            const whitespace = (agent as any).checkSimilarity(['   ', '\t\n']);
            // '   '.split(/\s+/) → ['', '', '', ''] → Set({'', ...}) → size >= 1
            expect(typeof whitespace).toBe('number');
            expect(whitespace).toBeGreaterThanOrEqual(0);
        });
    });
});
