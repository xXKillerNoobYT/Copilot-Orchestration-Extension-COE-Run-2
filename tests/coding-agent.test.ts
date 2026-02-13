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
});
