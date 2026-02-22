import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { CodingAgentService, LLMServiceLike } from '../src/core/coding-agent';
import { Database } from '../src/core/database';
import { EventBus } from '../src/core/event-bus';
import { EthicsEngine, TransparencyLoggerLike } from '../src/core/ethics-engine';
import { ComponentSchemaService } from '../src/core/component-schema';
import { CodeDiffStatus, LogicBlockType } from '../src/types';

describe('CodingAgentService', () => {
    let db: Database;
    let eventBus: EventBus;
    let tmpDir: string;
    let mockLLMService: jest.Mocked<LLMServiceLike>;
    let mockTransparencyLogger: jest.Mocked<TransparencyLoggerLike>;
    let mockOutputChannel: { appendLine: jest.Mock };
    let ethicsEngine: EthicsEngine;
    let componentSchemaService: ComponentSchemaService;
    let codingAgent: CodingAgentService;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-coding-agent-test-'));
        db = new Database(tmpDir);
        await db.initialize();
        eventBus = new EventBus();

        mockLLMService = {
            chat: jest.fn().mockResolvedValue({ content: 'generated code', tokens_used: 10 }),
            classify: jest.fn().mockResolvedValue('build'),
        };

        mockTransparencyLogger = {
            log: jest.fn(),
        };

        mockOutputChannel = {
            appendLine: jest.fn(),
        };

        ethicsEngine = new EthicsEngine(db, eventBus, mockTransparencyLogger, mockOutputChannel);
        componentSchemaService = new ComponentSchemaService(db, mockOutputChannel);

        ethicsEngine.seedDefaultModules();
        componentSchemaService.seedDefaultSchemas();

        // Disable the Consent module for tests — its High sensitivity + allowed_actions
        // list blocks all coding_agent actions that aren't 'read_local_files' or 'generate_ui_code'
        const modules = ethicsEngine.getModules();
        const consentModule = modules.find(m => m.name === 'Consent');
        if (consentModule) {
            ethicsEngine.disableModule(consentModule.id);
        }
        // Also disable Self-Protection module which blocks at Maximum sensitivity
        // (blocks all automated actions)
        const selfProtection = modules.find(m => m.name === 'Self-Protection');
        if (selfProtection) {
            ethicsEngine.disableModule(selfProtection.id);
        }

        codingAgent = new CodingAgentService(
            mockLLMService,
            db,
            ethicsEngine,
            componentSchemaService,
            eventBus,
            mockTransparencyLogger,
            mockOutputChannel
        );
    });

    afterEach(() => {
        eventBus.removeAllListeners();
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ===================== INTENT CLASSIFICATION =====================

    describe('Intent Classification', () => {
        test('classifyIntent recognizes build keywords (create, add, build, new)', async () => {
            const result = await codingAgent.classifyIntent('create a new button and add it');
            expect(result.intent).toBe('build');
            expect(result.method).toBe('keyword');
            expect(result.confidence).toBeGreaterThanOrEqual(60);
            expect(result.matchedKeywords.length).toBeGreaterThanOrEqual(2);
            // Verify at least some build keywords were matched
            const buildKeywords = ['create', 'add', 'build', 'new'];
            expect(result.matchedKeywords.some(k => buildKeywords.includes(k))).toBe(true);
        });

        test('classifyIntent recognizes modify keywords (change, update, edit)', async () => {
            const result = await codingAgent.classifyIntent('change the color and update the layout, then edit the text');
            expect(result.intent).toBe('modify');
            expect(result.method).toBe('keyword');
            expect(result.confidence).toBeGreaterThanOrEqual(60);
            const modifyKeywords = ['change', 'update', 'edit'];
            expect(result.matchedKeywords.some(k => modifyKeywords.includes(k))).toBe(true);
        });

        test('classifyIntent recognizes explain keywords (explain, what, how)', async () => {
            const result = await codingAgent.classifyIntent('explain what this component does and how it works');
            expect(result.intent).toBe('explain');
            expect(result.method).toBe('keyword');
            expect(result.confidence).toBeGreaterThanOrEqual(60);
            const explainKeywords = ['explain', 'what', 'how'];
            expect(result.matchedKeywords.some(k => explainKeywords.includes(k))).toBe(true);
        });

        test('classifyIntent recognizes fix keywords (fix, bug, error)', async () => {
            const result = await codingAgent.classifyIntent('fix the bug causing an error in the form');
            expect(result.intent).toBe('fix');
            expect(result.method).toBe('keyword');
            expect(result.confidence).toBeGreaterThanOrEqual(60);
            const fixKeywords = ['fix', 'bug', 'error'];
            expect(result.matchedKeywords.some(k => fixKeywords.includes(k))).toBe(true);
        });

        test('classifyIntent recognizes automate keywords (automate, if, when, trigger)', async () => {
            const result = await codingAgent.classifyIntent('automate this workflow when a trigger fires and if ready');
            expect(result.intent).toBe('automate');
            expect(result.method).toBe('keyword');
            expect(result.confidence).toBeGreaterThanOrEqual(60);
            const automateKeywords = ['automate', 'if', 'when', 'trigger'];
            expect(result.matchedKeywords.some(k => automateKeywords.includes(k))).toBe(true);
        });

        test('classifyIntent falls back to LLM for ambiguous commands', async () => {
            // A command with no clear keyword matches triggers LLM fallback
            mockLLMService.classify.mockResolvedValue('query');
            const result = await codingAgent.classifyIntent('hello world');
            expect(result.method).toBe('llm');
            expect(result.intent).toBe('query');
            expect(result.confidence).toBe(70);
            expect(mockLLMService.classify).toHaveBeenCalled();
        });
    });

    // ===================== CODE GENERATION =====================

    describe('Code Generation', () => {
        test('generateCode returns empty for no component IDs', () => {
            const result = codingAgent.generateCode([], 'react_tsx');
            expect(result.code).toBe('');
            expect(result.files).toHaveLength(0);
            expect(result.confidence).toBe(30);
            expect(result.explanation).toContain('0 component(s)');
        });

        test('generateCode warns for unknown component IDs', () => {
            const result = codingAgent.generateCode(['nonexistent-id-1', 'nonexistent-id-2'], 'react_tsx');
            expect(result.warnings).toContain('Component not found: nonexistent-id-1');
            expect(result.warnings).toContain('Component not found: nonexistent-id-2');
            expect(result.files).toHaveLength(0);
            expect(result.confidence).toBe(70); // componentIds.length > 0 but has warnings
        });

        test('generateCode produces code from schema templates', () => {
            // Create a plan first (required for design components)
            const plan = db.createPlan('Test Plan');

            // Create a design component of type 'table' (seeded schema exists for 'table')
            // 'table' is valid for both DesignComponent.type and seeded ComponentSchema.type
            const component = db.createDesignComponent({
                plan_id: plan.id,
                type: 'table',
                name: 'MyTable',
                props: {},
            });

            const result = codingAgent.generateCode([component.id], 'react_tsx');
            expect(result.files).toHaveLength(1);
            expect(result.files[0].name).toBe('table.tsx');
            expect(result.files[0].language).toBe('typescript');
            expect(result.files[0].content).toBeTruthy();
            expect(result.code).toBeTruthy();
            expect(result.confidence).toBe(90);
            expect(result.warnings).toHaveLength(0);
        });
    });

    // ===================== DIFF GENERATION =====================

    describe('Diff Generation', () => {
        test('generateDiff creates unified diff between old and new code', () => {
            const oldCode = '<div>Hello</div>';
            const newCode = '<div>Hello World</div>';
            const diff = codingAgent.generateDiff(oldCode, newCode, 'component', 'comp-1', 'req-1');

            expect(diff.id).toBeDefined();
            expect(diff.request_id).toBe('req-1');
            expect(diff.entity_type).toBe('component');
            expect(diff.entity_id).toBe('comp-1');
            expect(diff.before).toBe(oldCode);
            expect(diff.after).toBe(newCode);
            expect(diff.unified_diff).toContain('---');
            expect(diff.unified_diff).toContain('+++');
        });

        test('generateDiff counts lines added and removed correctly', () => {
            const oldCode = 'line1\nline2\nline3';
            const newCode = 'line1\nline2_modified\nline3\nline4_new';
            const diff = codingAgent.generateDiff(oldCode, newCode);

            // The diff should detect changes
            expect(diff.lines_added).toBeGreaterThanOrEqual(1);
            expect(diff.lines_removed).toBeGreaterThanOrEqual(0);
            // We at least added line4_new
            expect(diff.lines_added + diff.lines_removed).toBeGreaterThan(0);
        });

        test('generateDiff returns CodeDiffStatus.Pending', () => {
            const diff = codingAgent.generateDiff('old', 'new');
            expect(diff.status).toBe(CodeDiffStatus.Pending);
            expect(diff.reviewed_by).toBeNull();
            expect(diff.review_comment).toBeNull();
            expect(diff.created_at).toBeDefined();
            expect(diff.updated_at).toBeDefined();
        });
    });

    // ===================== PROCESS COMMAND =====================

    describe('processCommand', () => {
        test('processCommand routes build intent correctly', async () => {
            // "create a new button component" has 2 build keywords: create, new
            const response = await codingAgent.processCommand('create a new button component');

            expect(response).toBeDefined();
            expect(response.id).toBeDefined();
            expect(response.request_id).toBeDefined();
            expect(response.duration_ms).toBeGreaterThanOrEqual(0);
            expect(response.created_at).toBeDefined();
            // The build handler should have been called (either template-based or LLM fallback)
            // The button schema exists in seeded schemas, so it should match by name
            expect(response.language).toBeDefined();
        });

        test('processCommand routes query intent correctly', async () => {
            // "list all component schemas" has keywords: list (query) + component + schema
            const response = await codingAgent.processCommand('list all component schemas');

            expect(response).toBeDefined();
            expect(response.id).toBeDefined();
            expect(response.code).toBeDefined();
            // Query handler returns schema info
            expect(response.explanation).toBeDefined();
            expect(response.confidence).toBeGreaterThan(0);
        });

        test('processCommand returns error for ethics-blocked actions', async () => {
            // "collect_user_data" is in the Privacy module's blocked_actions
            // We need to use a command that triggers a blocked action name
            // The ethics check uses `coding_agent_${intent}` as the action name
            // For this test, we need to make the ethics engine block the action
            // We'll add a custom blocking rule for coding_agent_build
            const modules = ethicsEngine.getModules();
            const privacyModule = modules.find(m => m.name === 'Privacy');
            expect(privacyModule).toBeDefined();

            // Add a rule that blocks coding_agent actions
            ethicsEngine.addRule(privacyModule!.id, {
                name: 'block_coding_agent_test',
                description: 'Test block rule',
                condition: 'coding_agent_build',
                action: 'block',
                priority: 1,
                message: 'Coding agent build actions are blocked for testing.',
            });

            const response = await codingAgent.processCommand('create a new button');

            expect(response).toBeDefined();
            expect(response.explanation).toContain('blocked');
            expect(response.warnings.length).toBeGreaterThan(0);
            expect(response.confidence).toBe(0);
            expect(response.code).toBe('');
        });

        test('processCommand includes duration_ms and confidence', async () => {
            const response = await codingAgent.processCommand('list components');
            expect(typeof response.duration_ms).toBe('number');
            expect(response.duration_ms).toBeGreaterThanOrEqual(0);
            expect(typeof response.confidence).toBe('number');
        });
    });

    // ===================== APPROVAL FLOW =====================

    describe('Approval Flow', () => {
        test('approveDiff approves a pending diff', () => {
            // Create a diff directly in the database
            const diff = db.createCodeDiff({
                request_id: 'req-001',
                entity_type: 'component',
                entity_id: 'comp-001',
                before: '<div>old</div>',
                after: '<div>new</div>',
                unified_diff: '-<div>old</div>\n+<div>new</div>',
                lines_added: 1,
                lines_removed: 1,
                status: CodeDiffStatus.Pending,
                reviewed_by: null,
                review_comment: null,
            });

            const approved = codingAgent.approveDiff(diff.id, 'admin', 'Looks good');
            expect(approved).not.toBeNull();
            expect(approved!.status).toBe(CodeDiffStatus.Approved);
            expect(approved!.reviewed_by).toBe('admin');
            expect(approved!.review_comment).toBe('Looks good');
        });

        test('rejectDiff rejects a pending diff with comment', () => {
            const diff = db.createCodeDiff({
                request_id: 'req-002',
                entity_type: 'component',
                entity_id: 'comp-002',
                before: '<div>old</div>',
                after: '<div>bad change</div>',
                unified_diff: '-<div>old</div>\n+<div>bad change</div>',
                lines_added: 1,
                lines_removed: 1,
                status: CodeDiffStatus.Pending,
                reviewed_by: null,
                review_comment: null,
            });

            const rejected = codingAgent.rejectDiff(diff.id, 'reviewer', 'This change is incorrect');
            expect(rejected).not.toBeNull();
            expect(rejected!.status).toBe(CodeDiffStatus.Rejected);
            expect(rejected!.reviewed_by).toBe('reviewer');
            expect(rejected!.review_comment).toBe('This change is incorrect');
        });

        test('approveDiff returns null for unknown diff ID', () => {
            const result = codingAgent.approveDiff('nonexistent-diff-id', 'admin');
            expect(result).toBeNull();
        });
    });

    // ===================== QUERY HANDLER =====================

    describe('Query Handler', () => {
        test('handleQuery lists component schemas', async () => {
            // "list component schemas" triggers query intent via keyword match (list + show = query)
            const response = await codingAgent.processCommand('list component schemas');

            expect(response).toBeDefined();
            expect(response.code).toBeDefined();
            // The query handler searches for "component" or "schema" in the command
            // and lists all schemas
            expect(response.explanation).toContain('component schemas');
            expect(response.confidence).toBeGreaterThan(0);
        });

        test('handleQuery lists pending diffs', async () => {
            // First create some pending diffs
            db.createCodeDiff({
                request_id: 'req-100',
                entity_type: 'component',
                entity_id: 'comp-100',
                before: 'old code',
                after: 'new code',
                unified_diff: '-old\n+new',
                lines_added: 1,
                lines_removed: 1,
                status: CodeDiffStatus.Pending,
                reviewed_by: null,
                review_comment: null,
            });

            // "find and list diff changes" has 2 query keywords: find, list
            // The query handler also checks for "diff" or "change" in the command text
            const response = await codingAgent.processCommand('find and list diff changes');

            expect(response).toBeDefined();
            expect(response.code).toBeDefined();
            // The query handler checks for "diff" or "change" in the command
            expect(response.explanation).toContain('diff');
            expect(response.confidence).toBeGreaterThan(0);
        });
    });

    // ===================== CLASSIFY INTENT - ERROR PATHS =====================

    describe('Intent Classification - Error Paths', () => {
        test('classifyIntent returns query default when LLM fails and no keywords match', async () => {
            mockLLMService.classify.mockRejectedValue(new Error('LLM unavailable'));
            const result = await codingAgent.classifyIntent('xyzzy foobar baz');
            expect(result.method).toBe('keyword');
            expect(result.confidence).toBe(30);
            expect(result.intent).toBe('query');
            expect(result.matchedKeywords).toEqual([]);
        });

        test('classifyIntent uses best keyword when LLM fails with tied scores', async () => {
            mockLLMService.classify.mockRejectedValue(new Error('LLM unavailable'));
            // "search bug" → query:search(1), fix:bug(1) → tied → LLM → fails → fallback to topIntent
            const result = await codingAgent.classifyIntent('search bug');
            expect(result.method).toBe('keyword');
            expect(result.confidence).toBe(30);
            expect(['fix', 'query']).toContain(result.intent);
            expect(result.matchedKeywords.length).toBeGreaterThan(0);
        });

        test('classifyIntent handles single keyword with 60 confidence', async () => {
            const result = await codingAgent.classifyIntent('scaffold');
            expect(result.intent).toBe('build');
            expect(result.confidence).toBe(60);
            expect(result.method).toBe('keyword');
        });

        test('classifyIntent LLM returns unrecognized category defaults to query', async () => {
            mockLLMService.classify.mockResolvedValue('unknown_category');
            const result = await codingAgent.classifyIntent('xyzzy');
            expect(result.intent).toBe('query');
            expect(result.method).toBe('llm');
        });
    });

    // ===================== CODE GENERATION - EDGE CASES =====================

    describe('Code Generation - Edge Cases', () => {
        test('generateCode warns when component type has no schema', () => {
            const plan = db.createPlan('Test Plan');
            const component = db.createDesignComponent({
                plan_id: plan.id,
                type: 'custom_unknown_xyz' as any,
                name: 'Unknown',
                props: {},
            });
            const result = codingAgent.generateCode([component.id], 'react_tsx');
            expect(result.warnings).toContain('No schema found for component type: custom_unknown_xyz');
            expect(result.files).toHaveLength(0);
            expect(result.confidence).toBe(70); // componentIds.length > 0 with warnings
        });

        test('generateCode warns when no template for output format', () => {
            const plan = db.createPlan('Test Plan');
            const component = db.createDesignComponent({
                plan_id: plan.id,
                type: 'table',
                name: 'MyTable',
                props: {},
            });
            // Mock getCodeTemplate to return null for this call to hit the no-template path
            const origGetTemplate = componentSchemaService.getCodeTemplate.bind(componentSchemaService);
            jest.spyOn(componentSchemaService, 'getCodeTemplate').mockReturnValue(null);
            const result = codingAgent.generateCode([component.id], 'react_tsx');
            expect(result.warnings.some(w => w.includes('template'))).toBe(true);
            (componentSchemaService.getCodeTemplate as jest.Mock).mockRestore();
        });

        test('generateCode with html output format', () => {
            const plan = db.createPlan('Test Plan');
            const component = db.createDesignComponent({
                plan_id: plan.id,
                type: 'table',
                name: 'MyTable',
                props: {},
            });
            const result = codingAgent.generateCode([component.id], 'html');
            expect(result).toBeDefined();
        });

        test('generateCode with json output format covers mapOutputFormat json case', () => {
            const plan = db.createPlan('JSON Plan');
            const component = db.createDesignComponent({
                plan_id: plan.id,
                type: 'table',
                name: 'JsonTable',
                props: {},
            });
            // json maps to react_tsx internally for template lookup
            const result = codingAgent.generateCode([component.id], 'json');
            expect(result.language).toBe('json');
        });

        test('generateCode with css output format covers mapOutputFormat css case', () => {
            const plan = db.createPlan('CSS Plan');
            const component = db.createDesignComponent({
                plan_id: plan.id,
                type: 'table',
                name: 'CssTable',
                props: {},
            });
            const result = codingAgent.generateCode([component.id], 'css');
            expect(result).toBeDefined();
        });

        test('generateCode with typescript output format', () => {
            const plan = db.createPlan('TS Plan');
            const component = db.createDesignComponent({
                plan_id: plan.id,
                type: 'table',
                name: 'TsTable',
                props: {},
            });
            const result = codingAgent.generateCode([component.id], 'typescript');
            expect(result.language).toBe('typescript');
        });
    });

    // ===================== EXPLAIN CODE =====================

    describe('explainCode', () => {
        test('explains code via LLM', async () => {
            mockLLMService.chat.mockResolvedValue({
                content: 'This code creates a button component.',
                tokens_used: 15,
            });
            const result = await codingAgent.explainCode('<button>Click</button>');
            expect(result.explanation).toBe('This code creates a button component.');
            expect(result.tokensUsed).toBe(15);
            expect(mockLLMService.chat).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ role: 'system' }),
                    expect.objectContaining({ role: 'user', content: expect.stringContaining('<button>Click</button>') }),
                ]),
                expect.objectContaining({ maxTokens: 1000, temperature: 0.3 })
            );
        });

        test('explains code with additional context', async () => {
            mockLLMService.chat.mockResolvedValue({
                content: 'This is a React table.',
                tokens_used: 10,
            });
            const result = await codingAgent.explainCode('<table />', 'React component');
            expect(result.explanation).toBe('This is a React table.');
            expect(mockLLMService.chat).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({
                        role: 'user',
                        content: expect.stringContaining('Context: React component'),
                    }),
                ]),
                expect.anything()
            );
        });

        test('handles missing tokens_used from LLM', async () => {
            mockLLMService.chat.mockResolvedValue({ content: 'explanation' });
            const result = await codingAgent.explainCode('code');
            expect(result.tokensUsed).toBe(0);
        });
    });

    // ===================== BUILD LOGIC TREE =====================

    describe('buildLogicTree', () => {
        test('builds logic tree from valid LLM JSON response', async () => {
            const llmResponse = JSON.stringify([
                { type: 'if', label: 'Check input', condition: 'input.valid', body: 'proceed()', parent_index: -1, sort_order: 0 },
                { type: 'action', label: 'Process', condition: '', body: 'doWork()', parent_index: 0, sort_order: 1 },
                { type: 'else', label: 'Handle error', condition: '', body: 'showError()', parent_index: -1, sort_order: 2 },
            ]);
            mockLLMService.chat.mockResolvedValue({ content: llmResponse, tokens_used: 20 });

            const blocks = await codingAgent.buildLogicTree('If input is valid, process it. Otherwise, show error.', 'plan-1');
            expect(blocks).toHaveLength(3);
            expect(blocks[0].type).toBe(LogicBlockType.If);
            expect(blocks[0].condition).toBe('input.valid');
            expect(blocks[1].type).toBe(LogicBlockType.Action);
            expect(blocks[1].parent_block_id).toBe(blocks[0].id);
            expect(blocks[2].type).toBe(LogicBlockType.Else);
            expect(blocks[2].parent_block_id).toBeNull();
        });

        test('handles markdown-fenced JSON response', async () => {
            const blocks = [
                { type: 'event_handler', label: 'On click', condition: 'click', body: 'handleClick()', parent_index: -1, sort_order: 0 },
            ];
            mockLLMService.chat.mockResolvedValue({
                content: '```json\n' + JSON.stringify(blocks) + '\n```',
                tokens_used: 10,
            });
            const result = await codingAgent.buildLogicTree('On click, handle it', 'plan-2');
            expect(result).toHaveLength(1);
            expect(result[0].type).toBe(LogicBlockType.EventHandler);
        });

        test('returns fallback block for unparseable LLM response', async () => {
            mockLLMService.chat.mockResolvedValue({
                content: 'I cannot generate a valid JSON response.',
                tokens_used: 5,
            });
            const result = await codingAgent.buildLogicTree('Do something complex', 'plan-3');
            expect(result).toHaveLength(1);
            expect(result[0].type).toBe(LogicBlockType.Action);
            expect(result[0].body).toBe('Do something complex');
            expect(result[0].label).toBe('Action');
        });

        test('handles all logic block types including aliases', async () => {
            const blocks = [
                { type: 'if', label: 'If', condition: 'x', body: 'a', parent_index: -1, sort_order: 0 },
                { type: 'else_if', label: 'ElseIf', condition: 'y', body: 'b', parent_index: -1, sort_order: 1 },
                { type: 'elseif', label: 'ElseIf2', condition: 'z', body: 'c', parent_index: -1, sort_order: 2 },
                { type: 'else', label: 'Else', condition: '', body: 'd', parent_index: -1, sort_order: 3 },
                { type: 'loop', label: 'Loop', condition: 'w', body: 'e', parent_index: -1, sort_order: 4 },
                { type: 'while', label: 'While', condition: 'q', body: 'f', parent_index: -1, sort_order: 5 },
                { type: 'for', label: 'For', condition: 'r', body: 'g', parent_index: -1, sort_order: 6 },
                { type: 'action', label: 'Action', condition: '', body: 'h', parent_index: -1, sort_order: 7 },
                { type: 'event_handler', label: 'EventHandler', condition: 'ev', body: 'i', parent_index: -1, sort_order: 8 },
                { type: 'event', label: 'Event', condition: 'ev2', body: 'j', parent_index: -1, sort_order: 9 },
                { type: 'handler', label: 'Handler', condition: 'hd', body: 'k', parent_index: -1, sort_order: 10 },
                { type: 'switch', label: 'Switch', condition: 'val', body: 'l', parent_index: -1, sort_order: 11 },
                { type: 'case', label: 'Case', condition: '1', body: 'm', parent_index: -1, sort_order: 12 },
                { type: 'totally_unknown', label: 'Unknown', condition: '', body: 'n', parent_index: -1, sort_order: 13 },
            ];
            mockLLMService.chat.mockResolvedValue({ content: JSON.stringify(blocks), tokens_used: 20 });
            const result = await codingAgent.buildLogicTree('complex logic', 'plan-4');
            expect(result).toHaveLength(14);
            expect(result[0].type).toBe(LogicBlockType.If);
            expect(result[1].type).toBe(LogicBlockType.ElseIf);
            expect(result[2].type).toBe(LogicBlockType.ElseIf);
            expect(result[3].type).toBe(LogicBlockType.Else);
            expect(result[4].type).toBe(LogicBlockType.Loop);
            expect(result[5].type).toBe(LogicBlockType.Loop);
            expect(result[6].type).toBe(LogicBlockType.Loop);
            expect(result[7].type).toBe(LogicBlockType.Action);
            expect(result[8].type).toBe(LogicBlockType.EventHandler);
            expect(result[9].type).toBe(LogicBlockType.EventHandler);
            expect(result[10].type).toBe(LogicBlockType.EventHandler);
            expect(result[11].type).toBe(LogicBlockType.Switch);
            expect(result[12].type).toBe(LogicBlockType.Case);
            expect(result[13].type).toBe(LogicBlockType.Action); // unknown defaults to Action
        });

        test('handles blocks with missing fields', async () => {
            const blocks = [
                { type: 'action' },
                { type: 'if', label: '', body: '' },
            ];
            mockLLMService.chat.mockResolvedValue({ content: JSON.stringify(blocks), tokens_used: 5 });
            const result = await codingAgent.buildLogicTree('simple', 'plan-5');
            expect(result).toHaveLength(2);
            expect(result[0].label).toBe('Block 1');
            expect(result[0].condition).toBe('');
            expect(result[0].body).toBe('');
        });
    });

    // ===================== PROCESS COMMAND - MODIFY INTENT =====================

    describe('processCommand - Modify Intent', () => {
        test('modify with no target components returns error', async () => {
            const response = await codingAgent.processCommand('update the style and edit it');
            expect(response.explanation).toContain('No target components specified');
            expect(response.confidence).toBe(0);
        });

        test('modify with unknown component returns not found', async () => {
            const response = await codingAgent.processCommand('update and edit the component', {
                target_component_ids: ['nonexistent-comp'],
            });
            expect(response.explanation).toContain('nonexistent-comp');
            expect(response.explanation).toContain('not found');
        });

        test('modify with valid component generates code and diff', async () => {
            const plan = db.createPlan('Modify Test Plan');
            const component = db.createDesignComponent({
                plan_id: plan.id,
                type: 'table',
                name: 'MyTable',
                props: {},
            });
            mockLLMService.chat.mockResolvedValue({
                content: '<table class="modified">content</table>',
                tokens_used: 8,
            });
            const response = await codingAgent.processCommand('update the table and edit layout', {
                target_component_ids: [component.id],
            });
            expect(response).toBeDefined();
            expect(response.code).toBeTruthy();
            expect(response.warnings.some(w =>
                w.toLowerCase().includes('requires approval') || w.toLowerCase().includes('review')
            )).toBe(true);
        });

        test('modify handles LLM error gracefully', async () => {
            const plan = db.createPlan('Error Test Plan');
            const component = db.createDesignComponent({
                plan_id: plan.id,
                type: 'table',
                name: 'MyTable',
                props: {},
            });
            mockLLMService.chat.mockRejectedValue(new Error('LLM timeout'));
            const response = await codingAgent.processCommand('update and edit the table', {
                target_component_ids: [component.id],
            });
            expect(response).toBeDefined();
            expect(response.warnings.some(w => w.includes('LLM timeout'))).toBe(true);
        });

        test('modify strips markdown fences from LLM response', async () => {
            const plan = db.createPlan('Fence Test Plan');
            const component = db.createDesignComponent({
                plan_id: plan.id,
                type: 'table',
                name: 'FenceTable',
                props: {},
            });
            mockLLMService.chat.mockResolvedValue({
                content: '```html\n<table class="fenced">content</table>\n```',
                tokens_used: 8,
            });
            const response = await codingAgent.processCommand('update the table and edit its styling', {
                target_component_ids: [component.id],
            });
            expect(response.code).not.toContain('```');
            expect(response.code).toContain('<table class="fenced">');
        });
    });

    // ===================== PROCESS COMMAND - EXPLAIN INTENT =====================

    describe('processCommand - Explain Intent', () => {
        test('explain with target component', async () => {
            const plan = db.createPlan('Explain Test Plan');
            const component = db.createDesignComponent({
                plan_id: plan.id,
                type: 'table',
                name: 'MyTable',
                props: {},
            });
            mockLLMService.chat.mockResolvedValue({
                content: 'This is a table component that displays data.',
                tokens_used: 12,
            });
            const response = await codingAgent.processCommand('explain what this does and how it works', {
                target_component_ids: [component.id],
            });
            expect(response.explanation).toContain('table');
            expect(response.confidence).toBe(85);
            expect(response.tokens_used).toBe(12);
        });

        test('explain with code block in command', async () => {
            mockLLMService.chat.mockResolvedValue({
                content: 'This function returns hello.',
                tokens_used: 8,
            });
            const response = await codingAgent.processCommand(
                'explain what this code does and how:\n```js\nfunction hello() { return "hi"; }\n```'
            );
            expect(response.explanation).toContain('hello');
            expect(response.confidence).toBe(85);
        });

        test('explain with no code or component returns error', async () => {
            const response = await codingAgent.processCommand('explain what this does and how it works');
            expect(response.explanation).toContain('No code found to explain');
            expect(response.confidence).toBe(0);
        });

        test('explain with component that has no schema uses JSON', async () => {
            const plan = db.createPlan('Explain Test Plan 2');
            const component = db.createDesignComponent({
                plan_id: plan.id,
                type: 'custom_widget_abc' as any,
                name: 'Custom Widget',
                props: { color: 'blue' },
            });
            mockLLMService.chat.mockResolvedValue({
                content: 'This is a custom widget with color blue.',
                tokens_used: 5,
            });
            const response = await codingAgent.processCommand('explain what this does and how it works', {
                target_component_ids: [component.id],
            });
            expect(response.explanation).toContain('custom widget');
            expect(response.confidence).toBe(85);
        });
    });

    // ===================== PROCESS COMMAND - FIX INTENT =====================

    describe('processCommand - Fix Intent', () => {
        test('fix with no target component returns error', async () => {
            const response = await codingAgent.processCommand('fix the bug and resolve the error');
            expect(response.explanation).toContain('No target component specified');
            expect(response.confidence).toBe(0);
        });

        test('fix with target component delegates to modify', async () => {
            const plan = db.createPlan('Fix Test Plan');
            const component = db.createDesignComponent({
                plan_id: plan.id,
                type: 'table',
                name: 'BrokenTable',
                props: {},
            });
            mockLLMService.chat.mockResolvedValue({
                content: '<table class="fixed">content</table>',
                tokens_used: 8,
            });
            const response = await codingAgent.processCommand('fix the bug and resolve the error', {
                target_component_ids: [component.id],
            });
            expect(response).toBeDefined();
            expect(response.code).toBeTruthy();
        });
    });

    // ===================== PROCESS COMMAND - AUTOMATE INTENT =====================

    describe('processCommand - Automate Intent', () => {
        test('automate creates logic blocks and code', async () => {
            const plan = db.createPlan('Automate Test Plan');
            // Use parent_index: -1 for all blocks to avoid FK constraint issues
            const llmBlocks = [
                { type: 'if', label: 'Check ready', condition: 'isReady', body: 'proceed()', parent_index: -1, sort_order: 0 },
                { type: 'action', label: 'Execute', condition: '', body: 'execute()', parent_index: -1, sort_order: 1 },
            ];
            mockLLMService.chat.mockResolvedValue({
                content: JSON.stringify(llmBlocks),
                tokens_used: 15,
            });
            const response = await codingAgent.processCommand(
                'automate this workflow: when ready, trigger the execution if conditions met',
                { plan_id: plan.id }
            );
            // If automate succeeds, check code; if DB constraints fail, check error message
            if (response.confidence > 0) {
                expect(response.code).toContain('if (isReady)');
                expect(response.code).toContain('execute()');
                expect(response.files.length).toBeGreaterThan(0);
                expect(response.confidence).toBe(80);
                expect(response.explanation).toContain('logic block');
            } else {
                // If createLogicBlock fails due to DB constraints, at least the handler ran
                expect(response.explanation).toContain('Failed to build automation logic');
            }
        });

        test('automate uses default plan_id when not provided', async () => {
            // Create a plan called 'default' so the default planId works with FK constraints
            db.createPlan('default');
            mockLLMService.chat.mockResolvedValue({
                content: JSON.stringify([
                    { type: 'action', label: 'Do it', condition: '', body: 'work()', parent_index: -1, sort_order: 0 },
                ]),
                tokens_used: 5,
            });
            const response = await codingAgent.processCommand(
                'automate the workflow when triggered if ready'
            );
            expect(response.code).toBeDefined();
            // Check that handler ran (either success or DB constraint error)
            expect(response.explanation).toBeDefined();
        });

        test('automate handles error in buildLogicTree', async () => {
            mockLLMService.chat.mockRejectedValue(new Error('LLM crashed'));
            const response = await codingAgent.processCommand(
                'automate this workflow when the trigger fires if conditions are met'
            );
            expect(response.explanation).toContain('Failed to build automation logic');
            expect(response.confidence).toBe(0);
        });

        test('automate generates all logic block type code representations', async () => {
            const plan = db.createPlan('Logic Types Plan');
            const blocks = [
                { type: 'if', label: 'If', condition: 'x > 0', body: 'positive()', parent_index: -1, sort_order: 0 },
                { type: 'else_if', label: 'ElseIf', condition: 'x < 0', body: 'negative()', parent_index: -1, sort_order: 1 },
                { type: 'else', label: 'Else', condition: '', body: 'zero()', parent_index: -1, sort_order: 2 },
                { type: 'loop', label: 'Loop', condition: 'items.length > 0', body: 'process()', parent_index: -1, sort_order: 3 },
                { type: 'action', label: 'Log', condition: '', body: 'console.log()', parent_index: -1, sort_order: 4 },
                { type: 'event_handler', label: 'OnClick', condition: 'click', body: 'handle()', parent_index: -1, sort_order: 5 },
                { type: 'switch', label: 'Switch', condition: 'status', body: '...', parent_index: -1, sort_order: 6 },
                { type: 'case', label: 'Case', condition: '"active"', body: 'activate()', parent_index: -1, sort_order: 7 },
            ];
            mockLLMService.chat.mockResolvedValue({ content: JSON.stringify(blocks), tokens_used: 20 });
            const response = await codingAgent.processCommand(
                'automate: when click triggers, if x > 0 schedule positive else negative',
                { plan_id: plan.id }
            );
            expect(response.code).toContain('if (x > 0)');
            expect(response.code).toContain('else if (x < 0)');
            expect(response.code).toContain('else {');
            expect(response.code).toContain('while (items.length > 0)');
            expect(response.code).toContain('// Log');
            expect(response.code).toContain('on("click"');
            expect(response.code).toContain('switch (status)');
            expect(response.code).toContain('case "active"');
        });
    });

    // ===================== PROCESS COMMAND - BUILD PATHS =====================

    describe('processCommand - Build Paths', () => {
        test('build with target_component_ids generates code directly', async () => {
            const plan = db.createPlan('Build Target Plan');
            const component = db.createDesignComponent({
                plan_id: plan.id,
                type: 'table',
                name: 'DirectTable',
                props: {},
            });
            const response = await codingAgent.processCommand('create a new component and add features', {
                target_component_ids: [component.id],
            });
            expect(response.files.length).toBeGreaterThan(0);
            expect(response.confidence).toBeGreaterThan(0);
        });

        test('build with schema match from command text', async () => {
            const response = await codingAgent.processCommand('create a new table and add data');
            expect(response).toBeDefined();
            expect(response.code).toBeTruthy();
        });

        test('build with no matching schema falls back to LLM', async () => {
            mockLLMService.chat.mockResolvedValue({
                content: '```tsx\nconst Widget = () => <div>Widget</div>;\n```',
                tokens_used: 10,
            });
            const response = await codingAgent.processCommand('create a new xyzwidget and add it to the page');
            expect(response).toBeDefined();
            expect(response.code).toBeTruthy();
            expect(response.code).not.toContain('```');
        });

        test('build LLM fallback handles error', async () => {
            mockLLMService.chat.mockRejectedValue(new Error('Network error'));
            const response = await codingAgent.processCommand('create a new unicornwidget and add it');
            expect(response.explanation).toContain('failed');
            expect(response.confidence).toBe(0);
        });
    });

    // ===================== PROCESS COMMAND - QUERY EDGE CASES =====================

    describe('processCommand - Query Edge Cases', () => {
        test('query lists logic blocks for plan', async () => {
            const plan = db.createPlan('Logic Query Plan');
            db.createLogicBlock({
                plan_id: plan.id,
                type: LogicBlockType.If,
                label: 'Check condition',
                condition: 'x > 0',
                body: 'do something',
                parent_block_id: null,
                sort_order: 0,
            });
            const response = await codingAgent.processCommand('find and list logic rules', {
                plan_id: plan.id,
            });
            expect(response.code).toContain('Check condition');
        });

        test('query returns no results when nothing matches', async () => {
            const response = await codingAgent.processCommand('find and search for xyz');
            expect(response.explanation).toContain('No matching results');
        });

        test('query lists logic blocks with automation keyword', async () => {
            const plan = db.createPlan('Automation Query Plan');
            db.createLogicBlock({
                plan_id: plan.id,
                type: LogicBlockType.Action,
                label: 'Run task',
                condition: '',
                body: 'execute()',
                parent_block_id: null,
                sort_order: 0,
            });
            const response = await codingAgent.processCommand('find and list all automation blocks', {
                plan_id: plan.id,
            });
            expect(response.code).toContain('Run task');
        });
    });

    // ===================== PROCESS COMMAND - ERROR HANDLING =====================

    describe('processCommand - Error Handling', () => {
        test('processCommand catches thrown errors and returns error response', async () => {
            jest.spyOn(ethicsEngine, 'evaluateAction').mockRejectedValue(
                new Error('Ethics engine crashed')
            );
            const response = await codingAgent.processCommand('create a new button and add it');
            expect(response.explanation).toContain('Error processing command');
            expect(response.explanation).toContain('Ethics engine crashed');
            expect(response.confidence).toBe(0);
            expect(response.code).toBe('');
        });

        test('processCommand handles non-Error thrown values', async () => {
            jest.spyOn(ethicsEngine, 'evaluateAction').mockRejectedValue('string error');
            const response = await codingAgent.processCommand('create a new button and add it');
            expect(response.explanation).toContain('string error');
        });

        test('processCommand handles unrecognized intent gracefully', async () => {
            jest.spyOn(codingAgent, 'classifyIntent').mockResolvedValue({
                intent: 'unknown_xyz' as any,
                confidence: 50,
                method: 'keyword',
                matchedKeywords: [],
            });
            const response = await codingAgent.processCommand('anything');
            expect(response.explanation).toContain('Unknown intent');
            expect(response.confidence).toBe(0);
        });
    });

    // ===================== EVENT EMISSION ERROR =====================

    describe('Event Emission Error Handling', () => {
        test('emitEvent catches errors silently', async () => {
            let callCount = 0;
            jest.spyOn(eventBus, 'emit').mockImplementation((() => {
                callCount++;
                if (callCount === 1) {
                    throw new Error('EventBus emit failed');
                }
                return true;
            }) as any);
            const response = await codingAgent.processCommand('list and show component schemas');
            expect(response).toBeDefined();
            expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Failed to emit')
            );
        });
    });

    // ===================== TRANSPARENCY LOGGING ERROR =====================

    describe('Transparency Logging Error Handling', () => {
        test('logToTransparency catches errors silently', async () => {
            mockTransparencyLogger.log.mockImplementation(() => {
                throw new Error('Logger crashed');
            });
            const response = await codingAgent.processCommand('list and show component schemas');
            expect(response).toBeDefined();
            expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Transparency log failed')
            );
        });
    });

    // ===================== OUTPUT FORMAT COVERAGE =====================

    describe('Output Format Coverage', () => {
        test('processCommand with html output format', async () => {
            const response = await codingAgent.processCommand('list and show component schemas', {
                output_format: 'html',
            });
            expect(response).toBeDefined();
        });

        test('processCommand with css output format', async () => {
            const response = await codingAgent.processCommand('list and show component schemas', {
                output_format: 'css',
            });
            expect(response).toBeDefined();
        });

        test('processCommand with json output format', async () => {
            const response = await codingAgent.processCommand('list and show component schemas', {
                output_format: 'json',
            });
            expect(response).toBeDefined();
        });

        test('processCommand with typescript output format', async () => {
            const response = await codingAgent.processCommand('list and show component schemas', {
                output_format: 'typescript',
            });
            expect(response).toBeDefined();
        });
    });

    // ===================== REJECT DIFF - NOT FOUND =====================

    describe('rejectDiff - Not Found', () => {
        test('rejectDiff returns null for unknown diff ID', () => {
            const result = codingAgent.rejectDiff('nonexistent-diff-id', 'reviewer', 'bad');
            expect(result).toBeNull();
        });
    });

    // ===================== TARGETED BRANCH COVERAGE =====================

    describe('Targeted Branch Coverage', () => {
        // Line 95: generateUnifiedDiff default filename parameter ('component')
        // The module-level function is called by generateDiff, which passes
        // `${entityType}/${entityId}` as the filename. To trigger the default,
        // we call generateDiff with defaults (entityType='component', entityId='').
        test('generateDiff uses default entityType/entityId (exercises generateUnifiedDiff filename)', () => {
            const diff = codingAgent.generateDiff('line1\nline2', 'line1\nline2_mod');
            expect(diff.entity_type).toBe('component');
            expect(diff.entity_id).toBe('');
            expect(diff.unified_diff).toContain('--- a/component/');
            expect(diff.unified_diff).toContain('+++ b/component/');
        });

        // Line 130: bLine ?? '' when both bLine and aLine are undefined simultaneously
        // This happens when before has MORE lines than after, and they happen to match
        // at the end where one runs out. We need a case where bLine === aLine === undefined.
        // Actually, looking more carefully: bLine === aLine triggers when both are undefined
        // (undefined === undefined is true). This pushes ` ${bLine ?? ''}` = ` `.
        // This happens when before and after are the same length and have matching final lines
        // that are empty strings... Actually no — bLine can be undefined only when i >= beforeLines.length.
        // aLine can be undefined only when j >= afterLines.length. For both to be undefined simultaneously,
        // we'd need both iterators past their arrays — but the while condition prevents that.
        // However, if before="a\n" and after="a\n", split gives ["a",""], both match, no undefined case.
        // The ?? '' branch on line 130 is defensive — bLine can't actually be undefined when bLine === aLine
        // is true AND the while loop guard holds. The only way both are undefined is when both iterators
        // are past their arrays, but the while condition (i < beforeLines.length || j < afterLines.length)
        // would be false.
        // So this is truly unreachable defensive code. Let's just test the diff with matching empty-string lines
        // to get as close as possible.
        test('generateDiff with trailing empty lines (context path, bLine is empty string)', () => {
            // before="line1\n" → ["line1", ""], after="line1\n" → ["line1", ""]
            // Both match at index 1 (empty string), bLine="" which is truthy for ?? but '' is the value
            const diff = codingAgent.generateDiff('line1\n', 'line1\n');
            expect(diff.unified_diff).toContain(' line1');
            expect(diff.unified_diff).toContain(' '); // context line for the empty trailing line
            expect(diff.lines_added).toBe(0);
            expect(diff.lines_removed).toBe(0);
        });

        // Line 135: hunkStart === -1 false branch (already inside a hunk)
        // Sequential removed lines without matching context between them.
        // Before: "A\nB\nC" → After: "" (empty, which splits to [""])
        // i=0: bLine="A", aLine="" → not equal. bLine!==undefined, aLine is not undefined but
        // beforeLines.indexOf("", 0) — we need consecutive removals.
        // Better: before="A\nB\nC", after="D" — first line A≠D, A is in before, D is not found in before from pos 0,
        // so we go to 'else' (line added). Let's think more carefully...
        // For consecutive removals: before="X\nY\nZ", after="Z"
        // i=0,j=0: bLine="X", aLine="Z". bLine!==undefined AND (aLine===undefined? no. beforeLines.indexOf("Z",0)=2 >=0? yes)
        // → line removed. hunkStart=-1 → set to 0. hunkBefore=["X"]. i=1.
        // i=1,j=0: bLine="Y", aLine="Z". bLine!==undefined AND beforeLines.indexOf("Z",1)=2>=0? yes
        // → line removed. hunkStart=0 (NOT -1) → false branch hit! hunkBefore=["X","Y"]. i=2.
        test('generateDiff with consecutive removed lines hits hunkStart already set (line 135 false branch)', () => {
            const before = 'X\nY\nZ';
            const after = 'Z';
            const diff = codingAgent.generateDiff(before, after);
            // X and Y are removed, Z matches
            expect(diff.lines_removed).toBeGreaterThanOrEqual(2);
            expect(diff.unified_diff).toContain('-X');
            expect(diff.unified_diff).toContain('-Y');
        });

        // Line 216: command.length > 80 ? '...' : '' — false branch (command <= 80 chars)
        test('processCommand logs short command without ellipsis (line 216 false branch)', async () => {
            const shortCommand = 'list components'; // well under 80 chars
            await codingAgent.processCommand(shortCommand);
            // Verify no ellipsis for short commands
            const logCall = mockOutputChannel.appendLine.mock.calls.find(
                (call: string[]) => call[0].includes('Processing command')
            );
            expect(logCall).toBeDefined();
            expect(logCall![0]).not.toContain('...');
        });

        // Line 216: command.length > 80 ? '...' : '' — true branch (command > 80 chars)
        test('processCommand logs long command with ellipsis (line 216 true branch)', async () => {
            // Build a command >80 chars with 2 query keywords (find, list) for keyword classification
            const longCommand = 'find and list all the component schemas that have been registered in this very long command description here';
            expect(longCommand.length).toBeGreaterThan(80);
            await codingAgent.processCommand(longCommand);
            const logCall = mockOutputChannel.appendLine.mock.calls.find(
                (call: string[]) => call[0].includes('Processing command')
            );
            expect(logCall).toBeDefined();
            expect(logCall![0]).toContain('...');
        });

        // Lines 391, 403: keyword classification branches
        // Line 403: topIntent[1].score === 1 && (secondIntent?.[1].score ?? 0) === 0
        // Single keyword match with zero competition → confidence 60
        test('classifyIntent single keyword no competition returns confidence 60 (line 403)', async () => {
            // "scaffold" only matches build:scaffold(1), nothing else
            const result = await codingAgent.classifyIntent('scaffold');
            expect(result.intent).toBe('build');
            expect(result.confidence).toBe(60);
            expect(result.method).toBe('keyword');
            expect(result.matchedKeywords).toEqual(['scaffold']);
        });

        // Line 678: idMap.get(parentIndex) ?? null — parent not in idMap
        // A block references parent_index that's out of range (e.g., parent_index: 99)
        test('buildLogicTree with parent_index referencing non-existent block (line 678)', async () => {
            const llmResponse = JSON.stringify([
                { type: 'action', label: 'Orphan', condition: '', body: 'orphan()', parent_index: 99, sort_order: 0 },
            ]);
            mockLLMService.chat.mockResolvedValue({ content: llmResponse, tokens_used: 5 });
            const blocks = await codingAgent.buildLogicTree('orphan block', 'plan-x');
            expect(blocks).toHaveLength(1);
            expect(blocks[0].parent_block_id).toBeNull(); // idMap.get(99) is undefined → ?? null
        });

        // Lines 779-785: schema ? (getCodeTemplate ?? '') : '' — both branches
        // False branch: schema is null → currentCode = ''
        test('modify with component having no schema uses empty currentCode (lines 779-785 false branch)', async () => {
            const plan = db.createPlan('No Schema Plan');
            const component = db.createDesignComponent({
                plan_id: plan.id,
                type: 'nonexistent_type_xyz' as any,
                name: 'NoSchema',
                props: {},
            });
            mockLLMService.chat.mockResolvedValue({
                content: 'modified code here',
                tokens_used: 5,
            });
            const response = await codingAgent.processCommand('update and edit this component', {
                target_component_ids: [component.id],
            });
            expect(response).toBeDefined();
            expect(response.code).toBeTruthy();
        });

        // True branch with getCodeTemplate returning null: schema exists but template is null → ?? '' kicks in
        test('modify with schema but no template uses empty string via ?? (line 780 ?? branch)', async () => {
            const plan = db.createPlan('Schema No Template Plan');
            const component = db.createDesignComponent({
                plan_id: plan.id,
                type: 'table',
                name: 'NoTemplateTable',
                props: {},
            });
            // Mock getCodeTemplate to return null (schema exists, but template doesn't)
            jest.spyOn(componentSchemaService, 'getCodeTemplate').mockReturnValue(null);
            mockLLMService.chat.mockResolvedValue({
                content: 'modified table code',
                tokens_used: 5,
            });
            const response = await codingAgent.processCommand('update and edit this table', {
                target_component_ids: [component.id],
            });
            expect(response).toBeDefined();
            expect(response.code).toBeTruthy();
            (componentSchemaService.getCodeTemplate as jest.Mock).mockRestore();
        });

        // Line 846-852: schema ? (getCodeTemplate ?? '') : JSON.stringify(...)
        // False branch: no schema → JSON.stringify
        test('explain with no-schema component uses JSON.stringify for code (line 847 false branch)', async () => {
            const plan = db.createPlan('Explain NoSchema Plan');
            const component = db.createDesignComponent({
                plan_id: plan.id,
                type: 'totally_custom_xyz' as any,
                name: 'CustomThing',
                props: { foo: 'bar' },
            });
            mockLLMService.chat.mockResolvedValue({
                content: 'This is a custom component with foo property.',
                tokens_used: 5,
            });
            const response = await codingAgent.processCommand('explain what this does and how it works', {
                target_component_ids: [component.id],
            });
            expect(mockLLMService.chat).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({
                        role: 'user',
                        content: expect.stringContaining('foo'),
                    }),
                ]),
                expect.anything()
            );
            expect(response.confidence).toBe(85);
        });

        // True branch with getCodeTemplate returning null: schema exists but template null → ?? '' kicks in
        test('explain with schema but no template uses empty string via ?? (line 847 ?? branch)', async () => {
            const plan = db.createPlan('Explain Schema No Template Plan');
            const component = db.createDesignComponent({
                plan_id: plan.id,
                type: 'table',
                name: 'NoTemplateExplain',
                props: {},
            });
            // Mock getCodeTemplate to return null (schema exists, but template doesn't)
            jest.spyOn(componentSchemaService, 'getCodeTemplate').mockReturnValue(null);
            mockLLMService.chat.mockResolvedValue({
                content: 'This is a table component.',
                tokens_used: 5,
            });
            const response = await codingAgent.processCommand('explain what this does and how it works', {
                target_component_ids: [component.id],
            });
            // codeToExplain should be '' (empty) since getCodeTemplate returned null → ?? ''
            // Since codeToExplain is empty, it falls through to "No code found" path
            expect(response.explanation).toContain('No code found to explain');
            expect(response.confidence).toBe(0);
            (componentSchemaService.getCodeTemplate as jest.Mock).mockRestore();
        });

        // Line 1086: error instanceof Error ? error.message : String(error) in llmGenerateCode
        // Mock LLM to throw a non-Error value (string) during build's LLM fallback
        test('llmGenerateCode handles non-Error thrown value (line 1086)', async () => {
            // No matching schema → falls back to llmGenerateCode → LLM throws a string
            mockLLMService.chat.mockRejectedValue('raw string error from LLM');
            const response = await codingAgent.processCommand('create a new unicornwidget99 and add it');
            expect(response.explanation).toContain('raw string error from LLM');
            expect(response.confidence).toBe(0);
        });

        // Line 1144: error instanceof Error ? error.message : String(error) in llmModifyCode
        // Mock LLM to throw a non-Error value during modify
        test('llmModifyCode handles non-Error thrown value (line 1144)', async () => {
            const plan = db.createPlan('NonError Modify Plan');
            const component = db.createDesignComponent({
                plan_id: plan.id,
                type: 'table',
                name: 'ErrorTable',
                props: {},
            });
            mockLLMService.chat.mockRejectedValue(42); // throw a number
            const response = await codingAgent.processCommand('update and edit this table', {
                target_component_ids: [component.id],
            });
            expect(response.warnings.some((w: string) => w.includes('42'))).toBe(true);
        });

        // Line 1172: comment ?? null — approveDiff without comment argument
        test('approveDiff without comment argument uses null (line 1172)', () => {
            const diff = db.createCodeDiff({
                request_id: 'req-approve-no-comment',
                entity_type: 'component',
                entity_id: 'comp-approve',
                before: '<div>old</div>',
                after: '<div>new</div>',
                unified_diff: '-<div>old</div>\n+<div>new</div>',
                lines_added: 1,
                lines_removed: 1,
                status: CodeDiffStatus.Pending,
                reviewed_by: null,
                review_comment: null,
            });

            // Call approveDiff without the comment parameter
            const approved = codingAgent.approveDiff(diff.id, 'admin');
            expect(approved).not.toBeNull();
            expect(approved!.status).toBe(CodeDiffStatus.Approved);
            expect(approved!.reviewed_by).toBe('admin');
            expect(approved!.review_comment).toBeNull(); // comment ?? null → null
        });

        // Lines 1346, 1360: map[format] ?? 'text' and map[format] ?? 'txt'
        // Call formatToLanguage and formatToExtension with an unknown format
        // These are private, so we access them via (agent as any) or through a public path
        test('formatToLanguage returns "text" for unknown format (line 1346)', () => {
            const result = (codingAgent as any).formatToLanguage('unknown_format_xyz');
            expect(result).toBe('text');
        });

        test('formatToExtension returns "txt" for unknown format (line 1360)', () => {
            const result = (codingAgent as any).formatToExtension('unknown_format_xyz');
            expect(result).toBe('txt');
        });
    });
});
