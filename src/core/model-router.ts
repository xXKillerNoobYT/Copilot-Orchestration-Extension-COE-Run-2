/**
 * ModelRouter — v9.0 Multi-Model Routing
 *
 * Routes agents to appropriate LLM based on capability requirements.
 * Resolution order: (1) Agent-specific assignment → (2) Capability default → (3) Global default.
 *
 * Niche agent routing:
 * - L8-L9 workers default to 'fast' model (cheapest).
 * - Checkers (L9) use 'reasoning' model.
 * - Workers needing vision use 'vision' model.
 * - All configurable per-agent.
 *
 * Probes LM Studio `/v1/models` to detect available models and capabilities.
 */

import { Database } from './database';
import {
    ModelAssignment,
    ModelCapability,
    ModelPreference,
    AgentLevel,
    LLMConfig,
} from '../types';

/** Detected model info from LM Studio */
export interface DetectedModel {
    id: string;
    type: string;         // 'llm' | 'vlm' | 'embeddings'
    state: string;        // 'loaded' | 'not-loaded'
    arch: string;
    publisher: string;
    quantization: string;
    maxContextLength: number;
    capabilities: ModelCapability[];
}

/** Global default model ID sentinel */
const GLOBAL_AGENT_TYPE = '__global__';

export class ModelRouter {
    private detectedModels: DetectedModel[] = [];
    private lastDetectionTime = 0;
    private readonly detectionCacheTtl = 300000; // 5 minutes

    constructor(
        private readonly database: Database,
        private readonly llmConfig: LLMConfig
    ) {}

    // ==================== MODEL DETECTION ====================

    /**
     * Probe LM Studio's /v1/models endpoint to discover available models
     * and infer their capabilities from model type and architecture.
     */
    async detectModelCapabilities(): Promise<DetectedModel[]> {
        // Cache: skip re-detection if recent
        if (Date.now() - this.lastDetectionTime < this.detectionCacheTtl && this.detectedModels.length > 0) {
            return this.detectedModels;
        }

        try {
            const response = await fetch(`${this.llmConfig.endpoint}/models`, {
                signal: AbortSignal.timeout(10000),
            });

            if (!response.ok) {
                return this.detectedModels; // Return cached or empty
            }

            const data = await response.json() as {
                data?: Array<{
                    id: string;
                    type?: string;
                    state?: string;
                    arch?: string;
                    publisher?: string;
                    quantization?: string;
                    max_context_length?: number;
                }>;
            };

            if (!data.data || data.data.length === 0) {
                return this.detectedModels;
            }

            this.detectedModels = data.data.map(m => ({
                id: m.id,
                type: m.type ?? 'llm',
                state: m.state ?? 'unknown',
                arch: m.arch ?? 'unknown',
                publisher: m.publisher ?? 'unknown',
                quantization: m.quantization ?? 'unknown',
                maxContextLength: m.max_context_length ?? 0,
                capabilities: this.inferCapabilities(m),
            }));

            this.lastDetectionTime = Date.now();
            return this.detectedModels;
        } catch {
            /* istanbul ignore next */
            return this.detectedModels;
        }
    }

    /**
     * Infer capabilities from model metadata.
     * VLM types → vision, reasoning models → reasoning, small/quantized → fast, etc.
     */
    private inferCapabilities(model: {
        id: string;
        type?: string;
        arch?: string;
        publisher?: string;
        quantization?: string;
    }): ModelCapability[] {
        const caps: ModelCapability[] = [ModelCapability.General];
        const id = (model.id ?? '').toLowerCase();
        const arch = (model.arch ?? '').toLowerCase();

        // Vision models
        if (model.type === 'vlm' || id.includes('vision') || id.includes('llava') || id.includes('bakllava')) {
            caps.push(ModelCapability.Vision);
        }

        // Reasoning models
        if (id.includes('reason') || id.includes('think') || id.includes('cot') || arch.includes('reason')) {
            caps.push(ModelCapability.Reasoning);
        }

        // Code models
        if (id.includes('code') || id.includes('coder') || id.includes('starcoder') || id.includes('deepseek-coder')) {
            caps.push(ModelCapability.Code);
        }

        // Fast models (small quantization or small parameter count)
        const quant = (model.quantization ?? '').toLowerCase();
        if (quant.includes('q4') || quant.includes('q3') || id.includes('tiny') || id.includes('mini') || id.includes('phi-2')) {
            caps.push(ModelCapability.Fast);
        }

        // Tool use (function calling capable)
        if (id.includes('hermes') || id.includes('functionary') || id.includes('gorilla') || id.includes('firefunction')) {
            caps.push(ModelCapability.ToolUse);
        }

        return [...new Set(caps)]; // Deduplicate
    }

    /**
     * Get all detected models.
     */
    getAvailableModels(): DetectedModel[] {
        return [...this.detectedModels];
    }

    /**
     * Get detected models filtered by capability.
     */
    getModelsByCapability(capability: ModelCapability): DetectedModel[] {
        return this.detectedModels.filter(m => m.capabilities.includes(capability));
    }

    /**
     * Get only loaded models.
     */
    getLoadedModels(): DetectedModel[] {
        return this.detectedModels.filter(m => m.state === 'loaded');
    }

    // ==================== MODEL ASSIGNMENT CRUD ====================

    /**
     * Set which model an agent type should use for a given capability.
     * Creates or updates the assignment.
     */
    setModelAssignment(agentType: string, capability: ModelCapability, modelId: string, isDefault?: boolean): ModelAssignment {
        const existing = this.database.getModelAssignmentForAgent(agentType, capability);
        if (existing) {
            this.database.updateModelAssignment(existing.id, { model_id: modelId, is_default: isDefault });
            return this.database.getModelAssignment(existing.id)!;
        }
        return this.database.createModelAssignment({
            agent_type: agentType,
            capability,
            model_id: modelId,
            is_default: isDefault,
        });
    }

    /**
     * Set the global default model for a capability.
     */
    setGlobalDefault(capability: ModelCapability, modelId: string): ModelAssignment {
        return this.setModelAssignment(GLOBAL_AGENT_TYPE, capability, modelId, true);
    }

    /**
     * Remove a model assignment.
     */
    removeModelAssignment(id: string): boolean {
        return this.database.deleteModelAssignment(id);
    }

    /**
     * Get all model assignments.
     */
    getAllAssignments(): ModelAssignment[] {
        return this.database.getAllModelAssignments();
    }

    // ==================== MODEL RESOLUTION ====================

    /**
     * Get the model ID to use for a given agent and capability.
     *
     * Resolution chain:
     * 1. Agent-specific assignment for this capability
     * 2. Agent-specific default assignment (is_default=true)
     * 3. Global default for this capability
     * 4. Global default (is_default=true)
     * 5. Configured default model from LLMConfig
     */
    getModelForAgent(agentType: string, capability?: ModelCapability): string {
        // 1. Agent-specific + capability
        if (capability) {
            const specific = this.database.getModelAssignmentForAgent(agentType, capability);
            if (specific) return specific.model_id;
        }

        // 2. Agent-specific default
        const agentDefault = this.database.getModelAssignmentForAgent(agentType);
        if (agentDefault) return agentDefault.model_id;

        // 3. Global default for this capability
        if (capability) {
            const globalCap = this.database.getModelAssignmentForAgent(GLOBAL_AGENT_TYPE, capability);
            if (globalCap) return globalCap.model_id;
        }

        // 4. Global default
        const globalDefault = this.database.getModelAssignmentForAgent(GLOBAL_AGENT_TYPE);
        if (globalDefault) return globalDefault.model_id;

        // 5. LLMConfig default
        return this.llmConfig.model;
    }

    /**
     * Build a full ModelPreference object for a given agent, incorporating
     * model assignments and reasonable defaults.
     */
    getModelPreference(agentType: string, capability?: ModelCapability): ModelPreference {
        const modelId = this.getModelForAgent(agentType, capability);

        // Try to find a fallback model
        let fallbackModelId: string | null = null;
        if (capability) {
            // Fallback: try general capability
            const generalAssignment = this.database.getModelAssignmentForAgent(agentType, ModelCapability.General);
            if (generalAssignment && generalAssignment.model_id !== modelId) {
                fallbackModelId = generalAssignment.model_id;
            }
        }
        if (!fallbackModelId && modelId !== this.llmConfig.model) {
            fallbackModelId = this.llmConfig.model;
        }

        return {
            model_id: modelId,
            capability: capability ?? ModelCapability.General,
            fallback_model_id: fallbackModelId,
            temperature: 0.7,
            max_output_tokens: this.llmConfig.maxTokens,
        };
    }

    // ==================== NICHE AGENT ROUTING ====================

    /**
     * Get the appropriate model for a niche agent based on its level and role.
     * L8-L9 workers → fast model
     * L9 checkers → reasoning model
     * Vision-needed → vision model
     * Otherwise → general model
     */
    getModelForNicheAgent(
        agentType: string,
        level: AgentLevel,
        defaultCapability: ModelCapability
    ): string {
        // First check if there's an explicit assignment
        const explicit = this.database.getModelAssignmentForAgent(agentType, defaultCapability);
        if (explicit) return explicit.model_id;

        // Niche agent defaults by level
        let capability = defaultCapability;
        if (level === AgentLevel.L9_Checker) {
            // Checkers default to reasoning
            capability = ModelCapability.Reasoning;
        } else if (level === AgentLevel.L8_Worker || level === AgentLevel.L7_WorkerGroup) {
            // Workers default to fast
            capability = ModelCapability.Fast;
        }

        return this.getModelForAgent(agentType, capability);
    }

    // ==================== MODEL SWAP NOTIFICATION ====================

    /**
     * Request a model swap — returns info about what would change.
     * The actual swap must be done in LM Studio manually or via its API.
     * This just records the intent and returns recommendations.
     */
    requestModelSwap(targetModelId: string): {
        currentModel: string;
        targetModel: string;
        isLoaded: boolean;
        affectedAgents: ModelAssignment[];
    } {
        const isLoaded = this.detectedModels.some(
            m => m.id === targetModelId && m.state === 'loaded'
        );

        // Find all assignments that currently use a model that would be replaced
        const allAssignments = this.database.getAllModelAssignments();
        const affectedAgents = allAssignments.filter(
            a => a.model_id === this.llmConfig.model
        );

        return {
            currentModel: this.llmConfig.model,
            targetModel: targetModelId,
            isLoaded,
            affectedAgents,
        };
    }

    // ==================== SEED DEFAULTS ====================

    /**
     * Seed default model assignments for known agent types.
     * Only creates assignments that don't already exist.
     */
    seedDefaults(agentTypes: string[]): void {
        // Ensure global default exists
        const globalDefault = this.database.getModelAssignmentForAgent(GLOBAL_AGENT_TYPE);
        if (!globalDefault) {
            this.database.createModelAssignment({
                agent_type: GLOBAL_AGENT_TYPE,
                capability: ModelCapability.General,
                model_id: this.llmConfig.model,
                is_default: true,
            });
        }

        // For each known agent type, only create if no assignment exists
        for (const agentType of agentTypes) {
            const existing = this.database.getModelAssignmentForAgent(agentType);
            if (!existing) {
                this.database.createModelAssignment({
                    agent_type: agentType,
                    capability: ModelCapability.General,
                    model_id: this.llmConfig.model,
                    is_default: true,
                });
            }
        }
    }
}
