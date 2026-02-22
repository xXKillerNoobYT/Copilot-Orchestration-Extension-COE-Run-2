import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../src/core/database';
import { ModelRouter } from '../src/core/model-router';
import { ModelCapability, AgentLevel } from '../src/types';

describe('ModelRouter', () => {
    let db: Database;
    let tmpDir: string;
    let router: ModelRouter;
    const llmConfig = {
        endpoint: 'http://localhost:1234/v1',
        model: 'test-model',
        maxTokens: 4096,
        maxInputTokens: 4000,
        timeoutSeconds: 900,
        startupTimeoutSeconds: 300,
        streamStallTimeoutSeconds: 120,
        thinkingTimeoutSeconds: 5400,
    };

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-test-'));
        db = new Database(tmpDir);
        await db.initialize();
        router = new ModelRouter(db, llmConfig);
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ==================== MODEL DETECTION ====================

    describe('detectModelCapabilities', () => {
        test('returns empty array when API is unavailable (no server running in tests)', async () => {
            const result = await router.detectModelCapabilities();
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(0);
        });
    });

    // ==================== getAvailableModels ====================

    describe('getAvailableModels', () => {
        test('returns empty array initially', () => {
            const models = router.getAvailableModels();
            expect(models).toEqual([]);
        });

        test('returns detected models after detection', async () => {
            await router.detectModelCapabilities();
            const models = router.getAvailableModels();
            expect(Array.isArray(models)).toBe(true);
            // No server running, so still empty
            expect(models.length).toBe(0);
        });
    });

    // ==================== getModelsByCapability ====================

    describe('getModelsByCapability', () => {
        test('filters by capability', () => {
            const result = router.getModelsByCapability(ModelCapability.Vision);
            expect(result).toEqual([]);
        });
    });

    // ==================== getLoadedModels ====================

    describe('getLoadedModels', () => {
        test('filters by state loaded', () => {
            const result = router.getLoadedModels();
            expect(result).toEqual([]);
        });
    });

    // ==================== setModelAssignment ====================

    describe('setModelAssignment', () => {
        test('creates new assignment in DB, verify with getModelForAgent', () => {
            const assignment = router.setModelAssignment('boss', ModelCapability.General, 'my-model-1');
            expect(assignment).toBeDefined();
            expect(assignment.id).toBeDefined();
            expect(assignment.agent_type).toBe('boss');
            expect(assignment.capability).toBe(ModelCapability.General);
            expect(assignment.model_id).toBe('my-model-1');

            const modelId = router.getModelForAgent('boss', ModelCapability.General);
            expect(modelId).toBe('my-model-1');
        });

        test('updates existing assignment', () => {
            router.setModelAssignment('boss', ModelCapability.General, 'model-a');
            const updated = router.setModelAssignment('boss', ModelCapability.General, 'model-b');
            expect(updated.model_id).toBe('model-b');

            // Verify only one assignment exists for this agent+capability
            const all = router.getAllAssignments();
            const bossGeneral = all.filter(a => a.agent_type === 'boss' && a.capability === ModelCapability.General);
            expect(bossGeneral.length).toBe(1);
            expect(bossGeneral[0].model_id).toBe('model-b');
        });
    });

    // ==================== setGlobalDefault ====================

    describe('setGlobalDefault', () => {
        test('creates assignment for __global__ agent type', () => {
            const assignment = router.setGlobalDefault(ModelCapability.General, 'global-model');
            expect(assignment.agent_type).toBe('__global__');
            expect(assignment.model_id).toBe('global-model');
            expect(assignment.is_default).toBe(true);
        });
    });

    // ==================== removeModelAssignment ====================

    describe('removeModelAssignment', () => {
        test('deletes assignment and returns true', () => {
            const assignment = router.setModelAssignment('boss', ModelCapability.General, 'to-delete');
            const result = router.removeModelAssignment(assignment.id);
            expect(result).toBe(true);

            // After removal, should fall back to config default
            const model = router.getModelForAgent('boss');
            expect(model).toBe('test-model');
        });

        test('returns false for non-existent', () => {
            const result = router.removeModelAssignment('non-existent-id');
            expect(result).toBe(false);
        });
    });

    // ==================== getAllAssignments ====================

    describe('getAllAssignments', () => {
        test('returns all assignments', () => {
            router.setModelAssignment('boss', ModelCapability.General, 'model-1');
            router.setModelAssignment('planner', ModelCapability.Reasoning, 'model-2');
            router.setModelAssignment('coder', ModelCapability.Code, 'model-3');

            const all = router.getAllAssignments();
            expect(all.length).toBe(3);
            const types = all.map(a => a.agent_type);
            expect(types).toContain('boss');
            expect(types).toContain('planner');
            expect(types).toContain('coder');
        });

        test('returns empty array when none exist', () => {
            const all = router.getAllAssignments();
            expect(all.length).toBe(0);
        });
    });

    // ==================== getModelForAgent (resolution chain) ====================

    describe('getModelForAgent', () => {
        test('follows resolution chain: agent-specific > global > config default', () => {
            router.setGlobalDefault(ModelCapability.General, 'global-model');
            router.setModelAssignment('boss', ModelCapability.General, 'boss-specific');

            // Agent-specific should win over global
            expect(router.getModelForAgent('boss', ModelCapability.General)).toBe('boss-specific');
            // Unknown agent falls to global
            expect(router.getModelForAgent('unknown', ModelCapability.General)).toBe('global-model');
        });

        test('returns config default when no assignments exist', () => {
            const modelId = router.getModelForAgent('any-agent');
            expect(modelId).toBe('test-model');
        });

        test('global capability-specific takes priority over global default', () => {
            router.setGlobalDefault(ModelCapability.General, 'global-general');
            router.setGlobalDefault(ModelCapability.Reasoning, 'global-reasoning');
            const model = router.getModelForAgent('some-agent', ModelCapability.Reasoning);
            expect(model).toBe('global-reasoning');
        });
    });

    // ==================== getModelPreference ====================

    describe('getModelPreference', () => {
        test('returns full ModelPreference object', () => {
            const pref = router.getModelPreference('boss');
            expect(pref).toBeDefined();
            expect(pref.model_id).toBe('test-model');
            expect(pref.capability).toBe(ModelCapability.General);
            expect(pref.temperature).toBe(0.7);
            expect(pref.max_output_tokens).toBe(4096);
        });

        test('includes fallback_model_id', () => {
            router.setModelAssignment('boss', ModelCapability.Reasoning, 'reasoning-model');
            const pref = router.getModelPreference('boss', ModelCapability.Reasoning);
            expect(pref.model_id).toBe('reasoning-model');
            // Fallback should be non-null since primary differs from config default
            expect(pref.fallback_model_id).not.toBeNull();
        });

        test('capability defaults to General when not specified', () => {
            const pref = router.getModelPreference('boss');
            expect(pref.capability).toBe(ModelCapability.General);
        });
    });

    // ==================== getModelForNicheAgent ====================

    describe('getModelForNicheAgent', () => {
        test('L8 worker defaults to fast capability', () => {
            router.setGlobalDefault(ModelCapability.Fast, 'fast-model');
            const modelId = router.getModelForNicheAgent('worker-1', AgentLevel.L8_Worker, ModelCapability.General);
            expect(modelId).toBe('fast-model');
        });

        test('L9 checker defaults to reasoning capability', () => {
            router.setGlobalDefault(ModelCapability.Reasoning, 'reasoning-model');
            const modelId = router.getModelForNicheAgent('checker-1', AgentLevel.L9_Checker, ModelCapability.General);
            expect(modelId).toBe('reasoning-model');
        });

        test('uses explicit assignment when set', () => {
            router.setModelAssignment('custom-worker', ModelCapability.General, 'custom-model');
            const modelId = router.getModelForNicheAgent('custom-worker', AgentLevel.L8_Worker, ModelCapability.General);
            expect(modelId).toBe('custom-model');
        });

        test('L7 worker group also defaults to fast capability', () => {
            router.setGlobalDefault(ModelCapability.Fast, 'fast-model');
            const modelId = router.getModelForNicheAgent('group-1', AgentLevel.L7_WorkerGroup, ModelCapability.General);
            expect(modelId).toBe('fast-model');
        });
    });

    // ==================== requestModelSwap ====================

    describe('requestModelSwap', () => {
        test('returns swap info', () => {
            const result = router.requestModelSwap('new-model-id');
            expect(result.currentModel).toBe('test-model');
            expect(result.targetModel).toBe('new-model-id');
            expect(result.isLoaded).toBe(false);
            expect(Array.isArray(result.affectedAgents)).toBe(true);
        });
    });

    // ==================== seedDefaults ====================

    describe('seedDefaults', () => {
        test('creates global + per-agent defaults', () => {
            router.seedDefaults(['boss', 'planner', 'coder']);
            const all = router.getAllAssignments();
            // global + 3 agent types = 4
            expect(all.length).toBe(4);
            const types = all.map(a => a.agent_type);
            expect(types).toContain('__global__');
            expect(types).toContain('boss');
            expect(types).toContain('planner');
            expect(types).toContain('coder');
        });

        test('skips agents that already have assignments', () => {
            // Set a default assignment for boss (is_default=true) so seedDefaults finds it
            router.setModelAssignment('boss', ModelCapability.General, 'existing-model', true);
            router.seedDefaults(['boss', 'planner']);

            const all = router.getAllAssignments();
            // boss already existed (1) + global (1) + planner (1) = 3
            expect(all.length).toBe(3);

            // Boss should still have the original model
            const bossModel = router.getModelForAgent('boss', ModelCapability.General);
            expect(bossModel).toBe('existing-model');
        });
    });

    // ==================== inferCapabilities ====================

    describe('inferCapabilities', () => {
        test('detects vision capability from vlm type', () => {
            const caps = (router as any).inferCapabilities({
                id: 'llava-model', type: 'vlm', arch: 'llava', publisher: 'test', quantization: 'q8',
            });
            expect(caps).toContain(ModelCapability.Vision);
            expect(caps).toContain(ModelCapability.General);
        });

        test('detects reasoning capability from id keyword', () => {
            const caps = (router as any).inferCapabilities({
                id: 'mistral-reasoning-7b', type: 'llm', arch: 'mistral', publisher: 'mistralai', quantization: 'q8',
            });
            expect(caps).toContain(ModelCapability.Reasoning);
        });

        test('detects code capability from id keyword', () => {
            const caps = (router as any).inferCapabilities({
                id: 'deepseek-coder-33b', type: 'llm', arch: 'deepseek', publisher: 'deepseek', quantization: 'q4',
            });
            expect(caps).toContain(ModelCapability.Code);
            expect(caps).toContain(ModelCapability.Fast); // q4 quantization triggers fast
        });

        test('detects fast capability from small quantization', () => {
            const caps = (router as any).inferCapabilities({
                id: 'phi-2-small', type: 'llm', arch: 'phi', publisher: 'microsoft', quantization: 'q3_k',
            });
            expect(caps).toContain(ModelCapability.Fast);
        });

        test('detects tool use capability from hermes keyword', () => {
            const caps = (router as any).inferCapabilities({
                id: 'hermes-2-pro', type: 'llm', arch: 'llama', publisher: 'nous', quantization: 'q8',
            });
            expect(caps).toContain(ModelCapability.ToolUse);
        });
    });
});
