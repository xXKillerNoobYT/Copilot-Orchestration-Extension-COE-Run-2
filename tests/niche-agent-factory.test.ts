import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../src/core/database';
import { NicheAgentFactory } from '../src/core/niche-agent-factory';
import {
    AgentLevel,
    AgentPermission,
    ModelCapability,
    TreeNodeStatus,
} from '../src/types';

describe('NicheAgentFactory', () => {
    let db: Database;
    let tmpDir: string;
    let factory: NicheAgentFactory;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-test-'));
        db = new Database(tmpDir);
        await db.initialize();
        factory = new NicheAgentFactory(db);
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ==================== SEED DEFAULTS ====================

    describe('seedDefaultDefinitions', () => {
        test('seeds ~600 niche agents on first call and returns count', () => {
            const count = factory.seedDefaultDefinitions();
            expect(count).toBeGreaterThanOrEqual(400);
            expect(count).toBeLessThanOrEqual(700);
        });

        test('returns 0 on second call (idempotent)', () => {
            const firstRun = factory.seedDefaultDefinitions();
            expect(firstRun).toBeGreaterThan(0);
            const secondRun = factory.seedDefaultDefinitions();
            expect(secondRun).toBe(0);
        });
    });

    // ==================== GET COUNT ====================

    describe('getCount', () => {
        test('returns count after seeding', () => {
            expect(factory.getCount()).toBe(0);
            const seeded = factory.seedDefaultDefinitions();
            expect(factory.getCount()).toBe(seeded);
        });
    });

    // ==================== GET AVAILABLE NICHE AGENTS ====================

    describe('getAvailableNicheAgents', () => {
        beforeEach(() => {
            factory.seedDefaultDefinitions();
        });

        test('returns all definitions when no filter provided', () => {
            const all = factory.getAvailableNicheAgents();
            expect(all.length).toBeGreaterThan(0);
            expect(all.length).toBe(factory.getCount());
        });

        test('filters by level', () => {
            const workers = factory.getAvailableNicheAgents(AgentLevel.L8_Worker);
            expect(workers.length).toBeGreaterThan(0);
            expect(workers.every(a => a.level === AgentLevel.L8_Worker)).toBe(true);
        });

        test('filters by specialty substring', () => {
            const feAgents = factory.getAvailableNicheAgents(undefined, 'frontend');
            expect(feAgents.length).toBeGreaterThan(0);
            expect(feAgents.every(a => a.specialty.includes('frontend'))).toBe(true);
        });

        test('filters by both level and specialty', () => {
            const feWorkers = factory.getAvailableNicheAgents(AgentLevel.L8_Worker, 'frontend');
            expect(feWorkers.length).toBeGreaterThan(0);
            expect(feWorkers.every(a => a.level === AgentLevel.L8_Worker)).toBe(true);
            expect(feWorkers.every(a => a.specialty.includes('frontend'))).toBe(true);
        });
    });

    // ==================== GET AGENTS BY DOMAIN ====================

    describe('getAgentsByDomain', () => {
        beforeEach(() => {
            factory.seedDefaultDefinitions();
        });

        test('code domain returns ~100 agents', () => {
            const codeAgents = factory.getAgentsByDomain('code');
            expect(codeAgents.length).toBeGreaterThanOrEqual(60);
            expect(codeAgents.length).toBeLessThanOrEqual(120);
            expect(codeAgents.every(a => a.domain === 'code')).toBe(true);
        });

        test('design domain returns ~60 agents', () => {
            const designAgents = factory.getAgentsByDomain('design');
            expect(designAgents.length).toBeGreaterThanOrEqual(30);
            expect(designAgents.length).toBeLessThanOrEqual(80);
            expect(designAgents.every(a => a.domain === 'design')).toBe(true);
        });

        test('data domain returns ~40 agents', () => {
            const dataAgents = factory.getAgentsByDomain('data');
            expect(dataAgents.length).toBeGreaterThanOrEqual(20);
            expect(dataAgents.length).toBeLessThanOrEqual(60);
            expect(dataAgents.every(a => a.domain === 'data')).toBe(true);
        });

        test('docs domain returns ~30 agents', () => {
            const docsAgents = factory.getAgentsByDomain('docs');
            expect(docsAgents.length).toBeGreaterThanOrEqual(15);
            expect(docsAgents.length).toBeLessThanOrEqual(45);
            expect(docsAgents.every(a => a.domain === 'docs')).toBe(true);
        });
    });

    // ==================== GET DEFINITION ====================

    describe('getDefinition', () => {
        test('returns specific definition by ID', () => {
            factory.seedDefaultDefinitions();
            const all = factory.getAvailableNicheAgents();
            const first = all[0];
            const retrieved = factory.getDefinition(first.id);
            expect(retrieved).not.toBeNull();
            expect(retrieved!.id).toBe(first.id);
            expect(retrieved!.name).toBe(first.name);
        });

        test('returns null for bad ID', () => {
            const result = factory.getDefinition('bad-id');
            expect(result).toBeNull();
        });
    });

    // ==================== SELECT NICHE AGENTS FOR TASK ====================

    describe('selectNicheAgentsForTask', () => {
        beforeEach(() => {
            factory.seedDefaultDefinitions();
        });

        test('Build React button component returns frontend agents', () => {
            const agents = factory.selectNicheAgentsForTask('Build React button component');
            expect(agents.length).toBeGreaterThan(0);
            // Should include agents related to frontend/button/component/react
            const hasRelevant = agents.some(a =>
                a.specialty.includes('frontend') ||
                a.specialty.includes('button') ||
                a.specialty.includes('component') ||
                a.name.toLowerCase().includes('react') ||
                a.name.toLowerCase().includes('button') ||
                a.name.toLowerCase().includes('component')
            );
            expect(hasRelevant).toBe(true);
        });

        test('Write SQL migration returns data agents', () => {
            const agents = factory.selectNicheAgentsForTask('Write SQL migration');
            expect(agents.length).toBeGreaterThan(0);
            const hasDataRelated = agents.some(a =>
                a.domain === 'data' ||
                a.specialty.includes('sql') ||
                a.specialty.includes('migration')
            );
            expect(hasDataRelated).toBe(true);
        });

        test('Create API documentation returns docs agents', () => {
            const agents = factory.selectNicheAgentsForTask('Create API documentation');
            expect(agents.length).toBeGreaterThan(0);
            const hasDocsRelated = agents.some(a =>
                a.domain === 'docs' ||
                a.specialty.includes('api') ||
                a.specialty.includes('doc')
            );
            expect(hasDocsRelated).toBe(true);
        });

        test('returns empty array for empty input', () => {
            const agents = factory.selectNicheAgentsForTask('');
            expect(agents).toEqual([]);
        });

        test('with domain filter narrows results', () => {
            const agents = factory.selectNicheAgentsForTask('migration rollback schema', 'data');
            expect(agents.length).toBeGreaterThan(0);
            expect(agents.every(a => a.domain === 'data')).toBe(true);
        });

        test('with maxResults limits output', () => {
            const agents = factory.selectNicheAgentsForTask('frontend component design layout', undefined, 3);
            expect(agents.length).toBeLessThanOrEqual(3);
        });
    });

    // ==================== BUILD NICHE SYSTEM PROMPT ====================

    describe('buildNicheSystemPrompt', () => {
        test('replaces template variables ({{scope}}, {{name}}, etc)', () => {
            factory.seedDefaultDefinitions();
            const agents = factory.getAvailableNicheAgents(AgentLevel.L8_Worker);
            const def = agents[0];

            const prompt = factory.buildNicheSystemPrompt(def, 'frontend.buttons', 'Build the dashboard');
            expect(prompt).toContain('frontend.buttons'); // {{scope}}
            expect(prompt).toContain('Build the dashboard'); // {{parentContext}}
            expect(prompt).toContain(def.name); // {{name}}
            expect(prompt).toContain(def.domain); // {{domain}}
            expect(prompt).toContain(def.area); // {{area}}
            expect(prompt).not.toContain('{{scope}}');
            expect(prompt).not.toContain('{{parentContext}}');
            expect(prompt).not.toContain('{{name}}');
        });

        test('appends contracts', () => {
            factory.seedDefaultDefinitions();
            const agents = factory.getAvailableNicheAgents(AgentLevel.L8_Worker);
            const def = { ...agents[0] };
            def.input_contract = '{"type":"object","properties":{"code":"string"}}';
            def.output_contract = '{"type":"object","properties":{"result":"string"}}';

            const prompt = factory.buildNicheSystemPrompt(def, 'scope', 'context');
            expect(prompt).toContain('Input Contract:');
            expect(prompt).toContain(def.input_contract);
            expect(prompt).toContain('Output Contract:');
            expect(prompt).toContain(def.output_contract);
        });
    });

    // ==================== UPDATE DEFINITION ====================

    describe('updateDefinition', () => {
        test('updates niche agent fields', () => {
            factory.seedDefaultDefinitions();
            const agents = factory.getAvailableNicheAgents();
            const def = agents[0];

            const result = factory.updateDefinition(def.id, { name: 'UpdatedName' });
            expect(result).toBe(true);

            const updated = factory.getDefinition(def.id);
            expect(updated!.name).toBe('UpdatedName');
        });
    });

    // ==================== SPAWN NICHE AGENT ====================

    describe('spawnNicheAgent', () => {
        test('creates tree node from definition', () => {
            factory.seedDefaultDefinitions();
            const workers = factory.getAvailableNicheAgents(AgentLevel.L8_Worker);
            expect(workers.length).toBeGreaterThan(0);

            const parentNode = db.createTreeNode({
                name: 'TestParent',
                agent_type: 'test',
                level: AgentLevel.L4_Manager,
                parent_id: null,
                scope: 'test',
                permissions: [AgentPermission.Read],
                model_preference: {
                    model_id: '',
                    capability: ModelCapability.General,
                    fallback_model_id: null,
                    temperature: 0.7,
                    max_output_tokens: 4096,
                },
                max_fanout: 5,
                max_depth_below: 5,
                escalation_threshold: 3,
                context_isolation: true,
                history_isolation: true,
                status: TreeNodeStatus.Idle,
            });

            const spawned = factory.spawnNicheAgent(workers[0].id, parentNode.id, 'frontend.buttons');
            expect(spawned).not.toBeNull();
            expect(spawned!.level).toBe(AgentLevel.L8_Worker);
            expect(spawned!.parent_id).toBe(parentNode.id);
            expect(spawned!.scope).toBe('frontend.buttons');
            expect(spawned!.niche_definition_id).toBe(workers[0].id);
            expect(spawned!.status).toBe(TreeNodeStatus.Idle);
            expect(spawned!.context_isolation).toBe(true);
            expect(spawned!.max_fanout).toBe(0); // L8 workers get 0
        });

        test('returns null for bad definition ID', () => {
            const result = factory.spawnNicheAgent('bad-def-id', 'parent-id', 'scope');
            expect(result).toBeNull();
        });

        test('returns null for bad parent node ID', () => {
            factory.seedDefaultDefinitions();
            const workers = factory.getAvailableNicheAgents(AgentLevel.L8_Worker);
            const result = factory.spawnNicheAgent(workers[0].id, 'bad-parent-id', 'scope');
            expect(result).toBeNull();
        });
    });
});
