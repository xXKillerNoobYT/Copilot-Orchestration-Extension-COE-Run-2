/**
 * NicheAgentFactory — v10.0 Niche Agent Spawner
 *
 * Creates and configures niche agent instances from `niche_agent_definitions`.
 * Seeds ~600 niche agent definitions across 8 domains on first run.
 * Provides AI-assisted agent selection for tasks.
 *
 * v10.0 Distribution (aligned with 6-branch architecture):
 *   Code Domain (~100): FE ~35, BE ~35, Testing ~15, Infra ~15
 *   Design Domain (~60): UIDesign ~25, UXDesign ~20, Brand ~15
 *   Data Domain (~40): Schema ~15, Migration ~10, Seed ~8, Query ~7
 *   Docs Domain (~30): APIDocs ~12, UserDocs ~10, InternalDocs ~8
 *   Planning Domain (~80): Architecture ~25, Decomposition ~20, Estimation ~15, Dependency ~20
 *   Verification Domain (~80): Security ~25, Performance ~20, Compliance ~15, Quality ~20
 *   Co-Director Domain (~60): ProjectMgmt ~20, Coordination ~20, Reporting ~20
 *   Orchestrator Domain (~30): Routing ~10, Scheduling ~10, LoadBalancing ~10
 *   Data-Extended (~40): Analytics ~15, ETL ~15, ML ~10
 *   Coding-Extended (~50): Language ~20, Framework ~15, DevOps ~15
 */

import { Database } from './database';
import {
    NicheAgentDefinition,
    AgentLevel,
    AgentTreeNode,
    AgentPermission,
    ModelCapability,
    TreeNodeStatus,
} from '../types';

/** Shortened definition for seeding — avoids verbose boilerplate */
interface SeedDef {
    name: string;
    level: AgentLevel;
    specialty: string;
    domain: string;
    area: string;
    parentLevel?: AgentLevel;
    requiredCap?: ModelCapability;
    defaultCap?: ModelCapability;
    promptTemplate: string;
}

export class NicheAgentFactory {
    constructor(private readonly database: Database) {}

    // ==================== SPAWN ====================

    /**
     * Spawn a niche agent from a definition into the agent tree.
     * Creates a tree node configured from the niche definition.
     */
    spawnNicheAgent(
        definitionId: string,
        parentNodeId: string,
        scope: string,
        taskId?: string
    ): AgentTreeNode | null {
        const def = this.database.getNicheAgentDefinition(definitionId);
        if (!def) return null;

        const parentNode = this.database.getTreeNode(parentNodeId);
        if (!parentNode) return null;

        return this.database.createTreeNode({
            name: def.name,
            agent_type: `niche_${def.specialty}`,
            level: def.level,
            parent_id: parentNodeId,
            task_id: taskId ?? parentNode.task_id ?? null,
            scope,
            permissions: this.getPermissionsForLevel(def.level),
            model_preference: {
                model_id: '',  // Resolved at runtime by ModelRouter
                capability: def.default_model_capability,
                fallback_model_id: null,
                temperature: 0.7,
                max_output_tokens: 4096,
            },
            max_fanout: def.level >= AgentLevel.L8_Worker ? 0 : 3,
            max_depth_below: Math.max(0, 9 - def.level),
            escalation_threshold: 3,
            escalation_target_id: parentNodeId,
            context_isolation: true,
            history_isolation: true,
            status: TreeNodeStatus.Idle,
            input_contract: def.input_contract,
            output_contract: def.output_contract,
            niche_definition_id: definitionId,
        });
    }

    /**
     * Get default permissions for a given level.
     */
    private getPermissionsForLevel(level: AgentLevel): AgentPermission[] {
        if (level >= AgentLevel.L8_Worker) {
            // Workers and checkers: read, execute, escalate only
            return [AgentPermission.Read, AgentPermission.Execute, AgentPermission.Escalate];
        }
        if (level >= AgentLevel.L5_SubManager) {
            // Sub-managers through team leads: read, write, execute, escalate
            return [AgentPermission.Read, AgentPermission.Write, AgentPermission.Execute, AgentPermission.Escalate];
        }
        // Managers (L4): full set minus delete
        return [
            AgentPermission.Read, AgentPermission.Write, AgentPermission.Execute,
            AgentPermission.Escalate, AgentPermission.Spawn, AgentPermission.Configure,
        ];
    }

    // ==================== QUERY ====================

    /**
     * Get available niche agent definitions, optionally filtered.
     */
    getAvailableNicheAgents(level?: AgentLevel, specialty?: string): NicheAgentDefinition[] {
        if (level !== undefined && specialty) {
            const byLevel = this.database.getNicheAgentsByLevel(level);
            return byLevel.filter(d => d.specialty.includes(specialty));
        }
        if (level !== undefined) {
            return this.database.getNicheAgentsByLevel(level);
        }
        if (specialty) {
            return this.database.getNicheAgentsBySpecialty(specialty);
        }
        return this.database.getAllNicheAgentDefinitions();
    }

    /**
     * Get niche agents by domain.
     */
    getAgentsByDomain(domain: string): NicheAgentDefinition[] {
        return this.database.getNicheAgentsByDomain(domain);
    }

    /**
     * Get a single niche agent definition by ID.
     */
    getDefinition(id: string): NicheAgentDefinition | null {
        return this.database.getNicheAgentDefinition(id);
    }

    /**
     * Get total count of niche agent definitions.
     */
    getCount(): number {
        return this.database.getNicheAgentCount();
    }

    // ==================== TASK SELECTION ====================

    /**
     * Select relevant niche agents for a task based on keyword matching.
     * Returns definitions sorted by relevance (most keywords matched first).
     */
    selectNicheAgentsForTask(
        taskDescription: string,
        domain?: string,
        maxResults: number = 10
    ): NicheAgentDefinition[] {
        const keywords = this.extractKeywords(taskDescription);
        if (keywords.length === 0) return [];

        let candidates: NicheAgentDefinition[];
        if (domain) {
            candidates = this.database.getNicheAgentsByDomain(domain);
        } else {
            candidates = this.database.getAllNicheAgentDefinitions();
        }

        // Score each candidate by keyword overlap
        const scored = candidates.map(def => {
            const defKeywords = [
                def.name.toLowerCase(),
                def.specialty.toLowerCase(),
                def.area.toLowerCase(),
                def.domain.toLowerCase(),
            ].join(' ');

            let score = 0;
            for (const kw of keywords) {
                if (defKeywords.includes(kw)) score++;
            }
            return { def, score };
        });

        // Filter out zero-score, sort by score descending
        return scored
            .filter(s => s.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, maxResults)
            .map(s => s.def);
    }

    /**
     * Extract keywords from a task description for matching.
     */
    private extractKeywords(text: string): string[] {
        const stopWords = new Set([
            'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
            'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
            'would', 'shall', 'should', 'may', 'might', 'can', 'could',
            'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
            'as', 'into', 'through', 'during', 'before', 'after', 'above',
            'below', 'between', 'out', 'off', 'over', 'under', 'again',
            'further', 'then', 'once', 'here', 'there', 'when', 'where',
            'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
            'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
            'same', 'so', 'than', 'too', 'very', 'just', 'because',
            'and', 'but', 'or', 'if', 'while', 'about', 'this', 'that',
            'it', 'its', 'they', 'them', 'their', 'we', 'us', 'our',
            'i', 'me', 'my', 'you', 'your', 'he', 'she', 'him', 'her',
        ]);

        return text
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2 && !stopWords.has(w));
    }

    // ==================== SYSTEM PROMPT ====================

    /**
     * Build a complete system prompt for a spawned niche agent.
     * Replaces template variables with actual context.
     */
    buildNicheSystemPrompt(
        definition: NicheAgentDefinition,
        scope: string,
        parentContext: string
    ): string {
        let prompt = definition.system_prompt_template;

        // Replace template variables
        prompt = prompt.replace(/\{\{scope\}\}/g, scope);
        prompt = prompt.replace(/\{\{parentContext\}\}/g, parentContext);
        prompt = prompt.replace(/\{\{name\}\}/g, definition.name);
        prompt = prompt.replace(/\{\{specialty\}\}/g, definition.specialty);
        prompt = prompt.replace(/\{\{domain\}\}/g, definition.domain);
        prompt = prompt.replace(/\{\{area\}\}/g, definition.area);
        prompt = prompt.replace(/\{\{level\}\}/g, String(definition.level));

        // Add contracts if defined
        if (definition.input_contract) {
            prompt += `\n\nInput Contract:\n${definition.input_contract}`;
        }
        if (definition.output_contract) {
            prompt += `\n\nOutput Contract:\n${definition.output_contract}`;
        }

        return prompt;
    }

    // ==================== UPDATE ====================

    /**
     * Update a niche agent definition.
     */
    updateDefinition(id: string, updates: Partial<NicheAgentDefinition>): boolean {
        return this.database.updateNicheAgentDefinition(id, updates);
    }

    // ==================== SEED DEFAULTS ====================

    /**
     * Populate ~600 niche agent definitions on first run.
     * Idempotent — skips if definitions already exist.
     *
     * Original 4 domains (~230):
     *   Code (~100), Design (~60), Data (~40), Docs (~30)
     * v10.0 new domains (~370):
     *   Planning (~80), Verification (~80), Co-Director (~60),
     *   Orchestrator (~30), Data-Extended (~40), Coding-Extended (~50), Security (~30)
     */
    seedDefaultDefinitions(): number {
        const existing = this.database.getNicheAgentCount();
        if (existing > 0) return 0; // Already seeded

        const defs = this.buildAllDefinitions();
        let count = 0;
        for (const def of defs) {
            this.database.createNicheAgentDefinition({
                name: def.name,
                level: def.level,
                specialty: def.specialty,
                domain: def.domain,
                area: def.area,
                parent_level: def.parentLevel ?? (Math.max(0, def.level - 1) as AgentLevel),
                required_capability: def.requiredCap ?? ModelCapability.General,
                default_model_capability: def.defaultCap ?? ModelCapability.Fast,
                system_prompt_template: def.promptTemplate,
            });
            count++;
        }
        return count;
    }

    /**
     * Build all ~600 niche agent definitions.
     */
    private buildAllDefinitions(): SeedDef[] {
        return [
            // Original v9.0 domains (~230)
            ...this.buildCodeDomain(),
            ...this.buildDesignDomain(),
            ...this.buildDataDomain(),
            ...this.buildDocsDomain(),
            // v10.0 new domains (~370)
            ...this.buildPlanningDomain(),
            ...this.buildVerificationDomain(),
            ...this.buildCoDirectorDomain(),
            ...this.buildOrchestratorDomain(),
            ...this.buildDataExtendedDomain(),
            ...this.buildCodingExtendedDomain(),
            ...this.buildSecurityDomain(),
        ];
    }

    // ==================== CODE DOMAIN (~100) ====================

    private buildCodeDomain(): SeedDef[] {
        return [
            ...this.buildCodeFrontend(),
            ...this.buildCodeBackend(),
            ...this.buildCodeTesting(),
            ...this.buildCodeInfra(),
        ];
    }

    private buildCodeFrontend(): SeedDef[] {
        const d = 'code'; const a = 'frontend';
        const tp = (name: string, task: string) =>
            `You are ${name}, a specialized {{domain}}.{{area}} agent. Scope: {{scope}}. Parent context: {{parentContext}}. Task: ${task}`;

        return [
            // L4 Managers
            { name: 'FeatureManager', level: AgentLevel.L4_Manager, specialty: 'frontend.features', domain: d, area: a, promptTemplate: tp('FeatureManager', 'Manage frontend feature implementation'), defaultCap: ModelCapability.General },
            { name: 'ComponentManager', level: AgentLevel.L4_Manager, specialty: 'frontend.components', domain: d, area: a, promptTemplate: tp('ComponentManager', 'Manage UI component development') },
            { name: 'StyleManager', level: AgentLevel.L4_Manager, specialty: 'frontend.styles', domain: d, area: a, promptTemplate: tp('StyleManager', 'Manage CSS/styling implementation') },
            { name: 'StateManager', level: AgentLevel.L4_Manager, specialty: 'frontend.state', domain: d, area: a, promptTemplate: tp('StateManager', 'Manage state management implementation') },
            // L5 SubManagers
            { name: 'ReactComponentSub', level: AgentLevel.L5_SubManager, specialty: 'frontend.components.react', domain: d, area: a, promptTemplate: tp('ReactComponentSub', 'Manage React component development') },
            { name: 'HTMLTemplateSub', level: AgentLevel.L5_SubManager, specialty: 'frontend.components.html', domain: d, area: a, promptTemplate: tp('HTMLTemplateSub', 'Manage HTML template development') },
            { name: 'CSSModuleSub', level: AgentLevel.L5_SubManager, specialty: 'frontend.styles.css', domain: d, area: a, promptTemplate: tp('CSSModuleSub', 'Manage CSS module development') },
            { name: 'AnimationSub', level: AgentLevel.L5_SubManager, specialty: 'frontend.styles.animation', domain: d, area: a, promptTemplate: tp('AnimationSub', 'Manage CSS animations and transitions') },
            { name: 'FormSub', level: AgentLevel.L5_SubManager, specialty: 'frontend.components.form', domain: d, area: a, promptTemplate: tp('FormSub', 'Manage form component development') },
            { name: 'NavigationSub', level: AgentLevel.L5_SubManager, specialty: 'frontend.components.navigation', domain: d, area: a, promptTemplate: tp('NavigationSub', 'Manage navigation component development') },
            { name: 'LayoutSub', level: AgentLevel.L5_SubManager, specialty: 'frontend.components.layout', domain: d, area: a, promptTemplate: tp('LayoutSub', 'Manage layout component development') },
            // L6 Team Leads
            { name: 'ButtonLead', level: AgentLevel.L6_TeamLead, specialty: 'frontend.components.button', domain: d, area: a, promptTemplate: tp('ButtonLead', 'Lead button component implementation') },
            { name: 'InputLead', level: AgentLevel.L6_TeamLead, specialty: 'frontend.components.input', domain: d, area: a, promptTemplate: tp('InputLead', 'Lead input component implementation') },
            { name: 'TableLead', level: AgentLevel.L6_TeamLead, specialty: 'frontend.components.table', domain: d, area: a, promptTemplate: tp('TableLead', 'Lead table/data grid implementation') },
            { name: 'ModalLead', level: AgentLevel.L6_TeamLead, specialty: 'frontend.components.modal', domain: d, area: a, promptTemplate: tp('ModalLead', 'Lead modal/dialog implementation') },
            { name: 'CardLead', level: AgentLevel.L6_TeamLead, specialty: 'frontend.components.card', domain: d, area: a, promptTemplate: tp('CardLead', 'Lead card component implementation') },
            { name: 'ListLead', level: AgentLevel.L6_TeamLead, specialty: 'frontend.components.list', domain: d, area: a, promptTemplate: tp('ListLead', 'Lead list component implementation') },
            { name: 'FormFieldLead', level: AgentLevel.L6_TeamLead, specialty: 'frontend.components.formfield', domain: d, area: a, promptTemplate: tp('FormFieldLead', 'Lead form field implementation') },
            // L7 Worker Groups
            { name: 'ButtonWorkerGroup', level: AgentLevel.L7_WorkerGroup, specialty: 'frontend.components.button.workers', domain: d, area: a, promptTemplate: tp('ButtonWorkerGroup', 'Coordinate button workers') },
            { name: 'InputWorkerGroup', level: AgentLevel.L7_WorkerGroup, specialty: 'frontend.components.input.workers', domain: d, area: a, promptTemplate: tp('InputWorkerGroup', 'Coordinate input workers') },
            { name: 'StyleWorkerGroup', level: AgentLevel.L7_WorkerGroup, specialty: 'frontend.styles.workers', domain: d, area: a, promptTemplate: tp('StyleWorkerGroup', 'Coordinate style workers') },
            // L8 Workers
            { name: 'ButtonStyleWorker', level: AgentLevel.L8_Worker, specialty: 'frontend.components.button.style', domain: d, area: a, promptTemplate: tp('ButtonStyleWorker', 'Implement button styling'), defaultCap: ModelCapability.Fast },
            { name: 'ButtonLogicWorker', level: AgentLevel.L8_Worker, specialty: 'frontend.components.button.logic', domain: d, area: a, promptTemplate: tp('ButtonLogicWorker', 'Implement button logic/handlers'), defaultCap: ModelCapability.Fast },
            { name: 'InputValidationWorker', level: AgentLevel.L8_Worker, specialty: 'frontend.components.input.validation', domain: d, area: a, promptTemplate: tp('InputValidationWorker', 'Implement input validation'), defaultCap: ModelCapability.Fast },
            { name: 'InputStyleWorker', level: AgentLevel.L8_Worker, specialty: 'frontend.components.input.style', domain: d, area: a, promptTemplate: tp('InputStyleWorker', 'Implement input styling'), defaultCap: ModelCapability.Fast },
            { name: 'TableRenderWorker', level: AgentLevel.L8_Worker, specialty: 'frontend.components.table.render', domain: d, area: a, promptTemplate: tp('TableRenderWorker', 'Implement table rendering'), defaultCap: ModelCapability.Fast },
            { name: 'TableSortWorker', level: AgentLevel.L8_Worker, specialty: 'frontend.components.table.sort', domain: d, area: a, promptTemplate: tp('TableSortWorker', 'Implement table sorting'), defaultCap: ModelCapability.Fast },
            { name: 'ModalTransitionWorker', level: AgentLevel.L8_Worker, specialty: 'frontend.components.modal.transition', domain: d, area: a, promptTemplate: tp('ModalTransitionWorker', 'Implement modal transitions'), defaultCap: ModelCapability.Fast },
            { name: 'ResponsiveLayoutWorker', level: AgentLevel.L8_Worker, specialty: 'frontend.styles.responsive', domain: d, area: a, promptTemplate: tp('ResponsiveLayoutWorker', 'Implement responsive layouts'), defaultCap: ModelCapability.Fast },
            { name: 'ThemeWorker', level: AgentLevel.L8_Worker, specialty: 'frontend.styles.theme', domain: d, area: a, promptTemplate: tp('ThemeWorker', 'Implement theme variables'), defaultCap: ModelCapability.Fast },
            { name: 'AccessibilityWorker', level: AgentLevel.L8_Worker, specialty: 'frontend.accessibility', domain: d, area: a, promptTemplate: tp('AccessibilityWorker', 'Implement accessibility features'), defaultCap: ModelCapability.Fast },
            // L9 Checkers
            { name: 'ComponentRenderChecker', level: AgentLevel.L9_Checker, specialty: 'frontend.components.checker', domain: d, area: a, promptTemplate: tp('ComponentRenderChecker', 'Verify component renders correctly'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'StyleConsistencyChecker', level: AgentLevel.L9_Checker, specialty: 'frontend.styles.checker', domain: d, area: a, promptTemplate: tp('StyleConsistencyChecker', 'Verify style consistency'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'AccessibilityChecker', level: AgentLevel.L9_Checker, specialty: 'frontend.accessibility.checker', domain: d, area: a, promptTemplate: tp('AccessibilityChecker', 'Verify accessibility compliance'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'ResponsiveChecker', level: AgentLevel.L9_Checker, specialty: 'frontend.responsive.checker', domain: d, area: a, promptTemplate: tp('ResponsiveChecker', 'Verify responsive behavior'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
        ];
    }

    private buildCodeBackend(): SeedDef[] {
        const d = 'code'; const a = 'backend';
        const tp = (name: string, task: string) =>
            `You are ${name}, a specialized {{domain}}.{{area}} agent. Scope: {{scope}}. Parent context: {{parentContext}}. Task: ${task}`;

        return [
            // L4 Managers
            { name: 'APIManager', level: AgentLevel.L4_Manager, specialty: 'backend.api', domain: d, area: a, promptTemplate: tp('APIManager', 'Manage API endpoint development'), defaultCap: ModelCapability.General },
            { name: 'ServiceManager', level: AgentLevel.L4_Manager, specialty: 'backend.service', domain: d, area: a, promptTemplate: tp('ServiceManager', 'Manage backend service development') },
            { name: 'AuthManager', level: AgentLevel.L4_Manager, specialty: 'backend.auth', domain: d, area: a, promptTemplate: tp('AuthManager', 'Manage authentication/authorization') },
            { name: 'DatabaseCodeManager', level: AgentLevel.L4_Manager, specialty: 'backend.database', domain: d, area: a, promptTemplate: tp('DatabaseCodeManager', 'Manage database interaction code') },
            // L5 SubManagers
            { name: 'RestEndpointSub', level: AgentLevel.L5_SubManager, specialty: 'backend.api.rest', domain: d, area: a, promptTemplate: tp('RestEndpointSub', 'Manage REST endpoint development') },
            { name: 'GraphQLSub', level: AgentLevel.L5_SubManager, specialty: 'backend.api.graphql', domain: d, area: a, promptTemplate: tp('GraphQLSub', 'Manage GraphQL schema/resolvers') },
            { name: 'MiddlewareSub', level: AgentLevel.L5_SubManager, specialty: 'backend.middleware', domain: d, area: a, promptTemplate: tp('MiddlewareSub', 'Manage middleware development') },
            { name: 'ValidationSub', level: AgentLevel.L5_SubManager, specialty: 'backend.validation', domain: d, area: a, promptTemplate: tp('ValidationSub', 'Manage input validation logic') },
            { name: 'CacheSub', level: AgentLevel.L5_SubManager, specialty: 'backend.cache', domain: d, area: a, promptTemplate: tp('CacheSub', 'Manage caching implementation') },
            { name: 'QueueSub', level: AgentLevel.L5_SubManager, specialty: 'backend.queue', domain: d, area: a, promptTemplate: tp('QueueSub', 'Manage message queue implementation') },
            // L6 Team Leads
            { name: 'CRUDRouteLead', level: AgentLevel.L6_TeamLead, specialty: 'backend.api.crud', domain: d, area: a, promptTemplate: tp('CRUDRouteLead', 'Lead CRUD endpoint implementation') },
            { name: 'AuthRouteLead', level: AgentLevel.L6_TeamLead, specialty: 'backend.auth.routes', domain: d, area: a, promptTemplate: tp('AuthRouteLead', 'Lead auth endpoint implementation') },
            { name: 'WebhookLead', level: AgentLevel.L6_TeamLead, specialty: 'backend.api.webhook', domain: d, area: a, promptTemplate: tp('WebhookLead', 'Lead webhook endpoint implementation') },
            { name: 'ORMLead', level: AgentLevel.L6_TeamLead, specialty: 'backend.database.orm', domain: d, area: a, promptTemplate: tp('ORMLead', 'Lead ORM/query building implementation') },
            { name: 'ErrorHandlerLead', level: AgentLevel.L6_TeamLead, specialty: 'backend.error', domain: d, area: a, promptTemplate: tp('ErrorHandlerLead', 'Lead error handling implementation') },
            { name: 'LoggingLead', level: AgentLevel.L6_TeamLead, specialty: 'backend.logging', domain: d, area: a, promptTemplate: tp('LoggingLead', 'Lead logging implementation') },
            // L7 Worker Groups
            { name: 'CRUDWorkerGroup', level: AgentLevel.L7_WorkerGroup, specialty: 'backend.api.crud.workers', domain: d, area: a, promptTemplate: tp('CRUDWorkerGroup', 'Coordinate CRUD workers') },
            { name: 'AuthWorkerGroup', level: AgentLevel.L7_WorkerGroup, specialty: 'backend.auth.workers', domain: d, area: a, promptTemplate: tp('AuthWorkerGroup', 'Coordinate auth workers') },
            // L8 Workers
            { name: 'GetEndpointWorker', level: AgentLevel.L8_Worker, specialty: 'backend.api.crud.get', domain: d, area: a, promptTemplate: tp('GetEndpointWorker', 'Implement GET endpoints'), defaultCap: ModelCapability.Fast },
            { name: 'PostEndpointWorker', level: AgentLevel.L8_Worker, specialty: 'backend.api.crud.post', domain: d, area: a, promptTemplate: tp('PostEndpointWorker', 'Implement POST endpoints'), defaultCap: ModelCapability.Fast },
            { name: 'PutEndpointWorker', level: AgentLevel.L8_Worker, specialty: 'backend.api.crud.put', domain: d, area: a, promptTemplate: tp('PutEndpointWorker', 'Implement PUT endpoints'), defaultCap: ModelCapability.Fast },
            { name: 'DeleteEndpointWorker', level: AgentLevel.L8_Worker, specialty: 'backend.api.crud.delete', domain: d, area: a, promptTemplate: tp('DeleteEndpointWorker', 'Implement DELETE endpoints'), defaultCap: ModelCapability.Fast },
            { name: 'JWTWorker', level: AgentLevel.L8_Worker, specialty: 'backend.auth.jwt', domain: d, area: a, promptTemplate: tp('JWTWorker', 'Implement JWT auth'), defaultCap: ModelCapability.Fast },
            { name: 'PasswordHashWorker', level: AgentLevel.L8_Worker, specialty: 'backend.auth.password', domain: d, area: a, promptTemplate: tp('PasswordHashWorker', 'Implement password hashing'), defaultCap: ModelCapability.Fast },
            { name: 'RateLimitWorker', level: AgentLevel.L8_Worker, specialty: 'backend.middleware.ratelimit', domain: d, area: a, promptTemplate: tp('RateLimitWorker', 'Implement rate limiting'), defaultCap: ModelCapability.Fast },
            { name: 'SQLQueryWorker', level: AgentLevel.L8_Worker, specialty: 'backend.database.sql', domain: d, area: a, promptTemplate: tp('SQLQueryWorker', 'Write SQL queries'), defaultCap: ModelCapability.Fast },
            { name: 'CacheSetupWorker', level: AgentLevel.L8_Worker, specialty: 'backend.cache.setup', domain: d, area: a, promptTemplate: tp('CacheSetupWorker', 'Implement cache setup'), defaultCap: ModelCapability.Fast },
            { name: 'WebSocketWorker', level: AgentLevel.L8_Worker, specialty: 'backend.api.websocket', domain: d, area: a, promptTemplate: tp('WebSocketWorker', 'Implement WebSocket handlers'), defaultCap: ModelCapability.Fast },
            // L9 Checkers
            { name: 'APIContractChecker', level: AgentLevel.L9_Checker, specialty: 'backend.api.checker', domain: d, area: a, promptTemplate: tp('APIContractChecker', 'Verify API contracts/schemas'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'AuthSecurityChecker', level: AgentLevel.L9_Checker, specialty: 'backend.auth.checker', domain: d, area: a, promptTemplate: tp('AuthSecurityChecker', 'Verify authentication security'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'SQLInjectionChecker', level: AgentLevel.L9_Checker, specialty: 'backend.database.checker', domain: d, area: a, promptTemplate: tp('SQLInjectionChecker', 'Check for SQL injection vulnerabilities'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'ErrorHandlingChecker', level: AgentLevel.L9_Checker, specialty: 'backend.error.checker', domain: d, area: a, promptTemplate: tp('ErrorHandlingChecker', 'Verify error handling completeness'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            // +3 to reach 35
            { name: 'PaginationWorker', level: AgentLevel.L8_Worker, specialty: 'backend.api.pagination', domain: d, area: a, promptTemplate: tp('PaginationWorker', 'Implement API pagination'), defaultCap: ModelCapability.Fast },
            { name: 'FileUploadWorker', level: AgentLevel.L8_Worker, specialty: 'backend.api.upload', domain: d, area: a, promptTemplate: tp('FileUploadWorker', 'Implement file upload handling'), defaultCap: ModelCapability.Fast },
            { name: 'SessionWorker', level: AgentLevel.L8_Worker, specialty: 'backend.auth.session', domain: d, area: a, promptTemplate: tp('SessionWorker', 'Implement session management'), defaultCap: ModelCapability.Fast },
        ];
    }

    private buildCodeTesting(): SeedDef[] {
        const d = 'code'; const a = 'testing';
        const tp = (name: string, task: string) =>
            `You are ${name}, a specialized {{domain}}.{{area}} agent. Scope: {{scope}}. Parent context: {{parentContext}}. Task: ${task}`;

        return [
            // L4 Manager
            { name: 'TestManager', level: AgentLevel.L4_Manager, specialty: 'testing.management', domain: d, area: a, promptTemplate: tp('TestManager', 'Manage test suite development') },
            // L5 SubManagers
            { name: 'UnitTestSub', level: AgentLevel.L5_SubManager, specialty: 'testing.unit', domain: d, area: a, promptTemplate: tp('UnitTestSub', 'Manage unit test development') },
            { name: 'IntegrationTestSub', level: AgentLevel.L5_SubManager, specialty: 'testing.integration', domain: d, area: a, promptTemplate: tp('IntegrationTestSub', 'Manage integration test development') },
            { name: 'E2ETestSub', level: AgentLevel.L5_SubManager, specialty: 'testing.e2e', domain: d, area: a, promptTemplate: tp('E2ETestSub', 'Manage E2E test development') },
            // L6 Team Leads
            { name: 'MockLead', level: AgentLevel.L6_TeamLead, specialty: 'testing.mocks', domain: d, area: a, promptTemplate: tp('MockLead', 'Lead mock/stub development') },
            { name: 'FixtureLead', level: AgentLevel.L6_TeamLead, specialty: 'testing.fixtures', domain: d, area: a, promptTemplate: tp('FixtureLead', 'Lead test fixture development') },
            // L8 Workers
            { name: 'UnitTestWorker', level: AgentLevel.L8_Worker, specialty: 'testing.unit.writer', domain: d, area: a, promptTemplate: tp('UnitTestWorker', 'Write unit tests'), defaultCap: ModelCapability.Fast },
            { name: 'IntegrationTestWorker', level: AgentLevel.L8_Worker, specialty: 'testing.integration.writer', domain: d, area: a, promptTemplate: tp('IntegrationTestWorker', 'Write integration tests'), defaultCap: ModelCapability.Fast },
            { name: 'E2ETestWorker', level: AgentLevel.L8_Worker, specialty: 'testing.e2e.writer', domain: d, area: a, promptTemplate: tp('E2ETestWorker', 'Write E2E tests'), defaultCap: ModelCapability.Fast },
            { name: 'MockWorker', level: AgentLevel.L8_Worker, specialty: 'testing.mocks.writer', domain: d, area: a, promptTemplate: tp('MockWorker', 'Create mock implementations'), defaultCap: ModelCapability.Fast },
            // L9 Checkers
            { name: 'CoverageChecker', level: AgentLevel.L9_Checker, specialty: 'testing.coverage.checker', domain: d, area: a, promptTemplate: tp('CoverageChecker', 'Verify test coverage adequacy'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'TestQualityChecker', level: AgentLevel.L9_Checker, specialty: 'testing.quality.checker', domain: d, area: a, promptTemplate: tp('TestQualityChecker', 'Verify test quality and assertions'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            // +3 to reach 15
            { name: 'PerformanceTestSub', level: AgentLevel.L5_SubManager, specialty: 'testing.performance', domain: d, area: a, promptTemplate: tp('PerformanceTestSub', 'Manage performance test development') },
            { name: 'SnapshotTestWorker', level: AgentLevel.L8_Worker, specialty: 'testing.snapshot.writer', domain: d, area: a, promptTemplate: tp('SnapshotTestWorker', 'Write snapshot tests'), defaultCap: ModelCapability.Fast },
            { name: 'TestDataFactoryWorker', level: AgentLevel.L8_Worker, specialty: 'testing.data.factory', domain: d, area: a, promptTemplate: tp('TestDataFactoryWorker', 'Create test data factories'), defaultCap: ModelCapability.Fast },
        ];
    }

    private buildCodeInfra(): SeedDef[] {
        const d = 'code'; const a = 'infra';
        const tp = (name: string, task: string) =>
            `You are ${name}, a specialized {{domain}}.{{area}} agent. Scope: {{scope}}. Parent context: {{parentContext}}. Task: ${task}`;

        return [
            // L4 Manager
            { name: 'InfraManager', level: AgentLevel.L4_Manager, specialty: 'infra.management', domain: d, area: a, promptTemplate: tp('InfraManager', 'Manage infrastructure development') },
            // L5 SubManagers
            { name: 'CISub', level: AgentLevel.L5_SubManager, specialty: 'infra.ci', domain: d, area: a, promptTemplate: tp('CISub', 'Manage CI pipeline development') },
            { name: 'DeploySub', level: AgentLevel.L5_SubManager, specialty: 'infra.deploy', domain: d, area: a, promptTemplate: tp('DeploySub', 'Manage deployment configuration') },
            { name: 'DockerSub', level: AgentLevel.L5_SubManager, specialty: 'infra.docker', domain: d, area: a, promptTemplate: tp('DockerSub', 'Manage Docker configuration') },
            // L6 Team Leads
            { name: 'BuildConfigLead', level: AgentLevel.L6_TeamLead, specialty: 'infra.build', domain: d, area: a, promptTemplate: tp('BuildConfigLead', 'Lead build configuration') },
            { name: 'MonitoringLead', level: AgentLevel.L6_TeamLead, specialty: 'infra.monitoring', domain: d, area: a, promptTemplate: tp('MonitoringLead', 'Lead monitoring setup') },
            // L8 Workers
            { name: 'GithubActionsWorker', level: AgentLevel.L8_Worker, specialty: 'infra.ci.github', domain: d, area: a, promptTemplate: tp('GithubActionsWorker', 'Write GitHub Actions workflows'), defaultCap: ModelCapability.Fast },
            { name: 'DockerfileWorker', level: AgentLevel.L8_Worker, specialty: 'infra.docker.dockerfile', domain: d, area: a, promptTemplate: tp('DockerfileWorker', 'Write Dockerfiles'), defaultCap: ModelCapability.Fast },
            { name: 'NginxConfigWorker', level: AgentLevel.L8_Worker, specialty: 'infra.deploy.nginx', domain: d, area: a, promptTemplate: tp('NginxConfigWorker', 'Write Nginx configurations'), defaultCap: ModelCapability.Fast },
            { name: 'EnvConfigWorker', level: AgentLevel.L8_Worker, specialty: 'infra.config.env', domain: d, area: a, promptTemplate: tp('EnvConfigWorker', 'Manage environment configurations'), defaultCap: ModelCapability.Fast },
            // L9 Checkers
            { name: 'SecurityConfigChecker', level: AgentLevel.L9_Checker, specialty: 'infra.security.checker', domain: d, area: a, promptTemplate: tp('SecurityConfigChecker', 'Verify infrastructure security'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'BuildHealthChecker', level: AgentLevel.L9_Checker, specialty: 'infra.build.checker', domain: d, area: a, promptTemplate: tp('BuildHealthChecker', 'Verify build configuration health'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            // +3 to reach 15
            { name: 'KubernetesSub', level: AgentLevel.L5_SubManager, specialty: 'infra.k8s', domain: d, area: a, promptTemplate: tp('KubernetesSub', 'Manage Kubernetes configuration') },
            { name: 'TerraformWorker', level: AgentLevel.L8_Worker, specialty: 'infra.deploy.terraform', domain: d, area: a, promptTemplate: tp('TerraformWorker', 'Write Terraform/IaC configurations'), defaultCap: ModelCapability.Fast },
            { name: 'SSLCertWorker', level: AgentLevel.L8_Worker, specialty: 'infra.security.ssl', domain: d, area: a, promptTemplate: tp('SSLCertWorker', 'Manage SSL/TLS certificate configuration'), defaultCap: ModelCapability.Fast },
        ];
    }

    // ==================== DESIGN DOMAIN (~60) ====================

    private buildDesignDomain(): SeedDef[] {
        return [
            ...this.buildDesignUI(),
            ...this.buildDesignUX(),
            ...this.buildDesignBrand(),
        ];
    }

    private buildDesignUI(): SeedDef[] {
        const d = 'design'; const a = 'ui';
        const tp = (name: string, task: string) =>
            `You are ${name}, a specialized {{domain}}.{{area}} agent. Scope: {{scope}}. Parent context: {{parentContext}}. Task: ${task}`;

        return [
            // L4 Managers
            { name: 'UIComponentDesignManager', level: AgentLevel.L4_Manager, specialty: 'ui.components', domain: d, area: a, promptTemplate: tp('UIComponentDesignManager', 'Manage UI component design') },
            { name: 'UILayoutDesignManager', level: AgentLevel.L4_Manager, specialty: 'ui.layout', domain: d, area: a, promptTemplate: tp('UILayoutDesignManager', 'Manage UI layout design') },
            // L5 SubManagers
            { name: 'IconSub', level: AgentLevel.L5_SubManager, specialty: 'ui.icons', domain: d, area: a, promptTemplate: tp('IconSub', 'Manage icon selection and design') },
            { name: 'TypographySub', level: AgentLevel.L5_SubManager, specialty: 'ui.typography', domain: d, area: a, promptTemplate: tp('TypographySub', 'Manage typography decisions') },
            { name: 'ColorSub', level: AgentLevel.L5_SubManager, specialty: 'ui.color', domain: d, area: a, promptTemplate: tp('ColorSub', 'Manage color palette decisions') },
            { name: 'SpacingSub', level: AgentLevel.L5_SubManager, specialty: 'ui.spacing', domain: d, area: a, promptTemplate: tp('SpacingSub', 'Manage spacing and grid decisions') },
            { name: 'MotionDesignSub', level: AgentLevel.L5_SubManager, specialty: 'ui.motion', domain: d, area: a, promptTemplate: tp('MotionDesignSub', 'Manage motion/animation design') },
            // L6 Team Leads
            { name: 'ButtonDesignLead', level: AgentLevel.L6_TeamLead, specialty: 'ui.components.button', domain: d, area: a, promptTemplate: tp('ButtonDesignLead', 'Lead button design') },
            { name: 'FormDesignLead', level: AgentLevel.L6_TeamLead, specialty: 'ui.components.form', domain: d, area: a, promptTemplate: tp('FormDesignLead', 'Lead form design') },
            { name: 'CardDesignLead', level: AgentLevel.L6_TeamLead, specialty: 'ui.components.card', domain: d, area: a, promptTemplate: tp('CardDesignLead', 'Lead card component design') },
            { name: 'NavigationDesignLead', level: AgentLevel.L6_TeamLead, specialty: 'ui.components.navigation', domain: d, area: a, promptTemplate: tp('NavigationDesignLead', 'Lead navigation design') },
            // L8 Workers
            { name: 'IconSelectionWorker', level: AgentLevel.L8_Worker, specialty: 'ui.icons.selection', domain: d, area: a, promptTemplate: tp('IconSelectionWorker', 'Select appropriate icons'), defaultCap: ModelCapability.Fast },
            { name: 'ColorContrastWorker', level: AgentLevel.L8_Worker, specialty: 'ui.color.contrast', domain: d, area: a, promptTemplate: tp('ColorContrastWorker', 'Ensure color contrast compliance'), defaultCap: ModelCapability.Fast },
            { name: 'FontPairingWorker', level: AgentLevel.L8_Worker, specialty: 'ui.typography.pairing', domain: d, area: a, promptTemplate: tp('FontPairingWorker', 'Select font pairings'), defaultCap: ModelCapability.Fast },
            { name: 'SpacingGridWorker', level: AgentLevel.L8_Worker, specialty: 'ui.spacing.grid', domain: d, area: a, promptTemplate: tp('SpacingGridWorker', 'Define spacing grid system'), defaultCap: ModelCapability.Fast },
            { name: 'MicroAnimationWorker', level: AgentLevel.L8_Worker, specialty: 'ui.motion.micro', domain: d, area: a, promptTemplate: tp('MicroAnimationWorker', 'Design micro-animations'), defaultCap: ModelCapability.Fast },
            { name: 'DarkModeWorker', level: AgentLevel.L8_Worker, specialty: 'ui.color.darkmode', domain: d, area: a, promptTemplate: tp('DarkModeWorker', 'Design dark mode variants'), defaultCap: ModelCapability.Fast },
            // L9 Checkers
            { name: 'UIConsistencyChecker', level: AgentLevel.L9_Checker, specialty: 'ui.consistency.checker', domain: d, area: a, promptTemplate: tp('UIConsistencyChecker', 'Verify UI consistency'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'ContrastRatioChecker', level: AgentLevel.L9_Checker, specialty: 'ui.contrast.checker', domain: d, area: a, promptTemplate: tp('ContrastRatioChecker', 'Verify WCAG contrast ratios'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'DesignTokenChecker', level: AgentLevel.L9_Checker, specialty: 'ui.tokens.checker', domain: d, area: a, promptTemplate: tp('DesignTokenChecker', 'Verify design token usage'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            // +5 to reach 25
            { name: 'TableDesignLead', level: AgentLevel.L6_TeamLead, specialty: 'ui.components.table', domain: d, area: a, promptTemplate: tp('TableDesignLead', 'Lead table/data grid design') },
            { name: 'ModalDesignLead', level: AgentLevel.L6_TeamLead, specialty: 'ui.components.modal', domain: d, area: a, promptTemplate: tp('ModalDesignLead', 'Lead modal/dialog design') },
            { name: 'GradientWorker', level: AgentLevel.L8_Worker, specialty: 'ui.color.gradient', domain: d, area: a, promptTemplate: tp('GradientWorker', 'Design gradient color schemes'), defaultCap: ModelCapability.Fast },
            { name: 'ShadowDepthWorker', level: AgentLevel.L8_Worker, specialty: 'ui.spacing.shadows', domain: d, area: a, promptTemplate: tp('ShadowDepthWorker', 'Define shadow and depth tokens'), defaultCap: ModelCapability.Fast },
            { name: 'BorderRadiusWorker', level: AgentLevel.L8_Worker, specialty: 'ui.spacing.borders', domain: d, area: a, promptTemplate: tp('BorderRadiusWorker', 'Define border radius tokens'), defaultCap: ModelCapability.Fast },
        ];
    }

    private buildDesignUX(): SeedDef[] {
        const d = 'design'; const a = 'ux';
        const tp = (name: string, task: string) =>
            `You are ${name}, a specialized {{domain}}.{{area}} agent. Scope: {{scope}}. Parent context: {{parentContext}}. Task: ${task}`;

        return [
            // L4 Managers
            { name: 'FlowDesignManager', level: AgentLevel.L4_Manager, specialty: 'ux.flow', domain: d, area: a, promptTemplate: tp('FlowDesignManager', 'Manage user flow design') },
            { name: 'InteractionDesignManager', level: AgentLevel.L4_Manager, specialty: 'ux.interaction', domain: d, area: a, promptTemplate: tp('InteractionDesignManager', 'Manage interaction design') },
            // L5 SubManagers
            { name: 'OnboardingSub', level: AgentLevel.L5_SubManager, specialty: 'ux.flow.onboarding', domain: d, area: a, promptTemplate: tp('OnboardingSub', 'Manage onboarding flow design') },
            { name: 'ErrorStateSub', level: AgentLevel.L5_SubManager, specialty: 'ux.states.error', domain: d, area: a, promptTemplate: tp('ErrorStateSub', 'Manage error state design') },
            { name: 'EmptyStateSub', level: AgentLevel.L5_SubManager, specialty: 'ux.states.empty', domain: d, area: a, promptTemplate: tp('EmptyStateSub', 'Manage empty state design') },
            { name: 'LoadingStateSub', level: AgentLevel.L5_SubManager, specialty: 'ux.states.loading', domain: d, area: a, promptTemplate: tp('LoadingStateSub', 'Manage loading state design') },
            // L6 Team Leads
            { name: 'FormFlowLead', level: AgentLevel.L6_TeamLead, specialty: 'ux.flow.form', domain: d, area: a, promptTemplate: tp('FormFlowLead', 'Lead form flow design') },
            { name: 'SearchFlowLead', level: AgentLevel.L6_TeamLead, specialty: 'ux.flow.search', domain: d, area: a, promptTemplate: tp('SearchFlowLead', 'Lead search flow design') },
            { name: 'FeedbackLead', level: AgentLevel.L6_TeamLead, specialty: 'ux.interaction.feedback', domain: d, area: a, promptTemplate: tp('FeedbackLead', 'Lead user feedback design') },
            // L8 Workers
            { name: 'TooltipWorker', level: AgentLevel.L8_Worker, specialty: 'ux.interaction.tooltip', domain: d, area: a, promptTemplate: tp('TooltipWorker', 'Design tooltip interactions'), defaultCap: ModelCapability.Fast },
            { name: 'NotificationWorker', level: AgentLevel.L8_Worker, specialty: 'ux.interaction.notification', domain: d, area: a, promptTemplate: tp('NotificationWorker', 'Design notification patterns'), defaultCap: ModelCapability.Fast },
            { name: 'ErrorMessageWorker', level: AgentLevel.L8_Worker, specialty: 'ux.states.error.message', domain: d, area: a, promptTemplate: tp('ErrorMessageWorker', 'Write user-friendly error messages'), defaultCap: ModelCapability.Fast },
            { name: 'ProgressIndicatorWorker', level: AgentLevel.L8_Worker, specialty: 'ux.interaction.progress', domain: d, area: a, promptTemplate: tp('ProgressIndicatorWorker', 'Design progress indicators'), defaultCap: ModelCapability.Fast },
            // L9 Checkers
            { name: 'FlowCompletenessChecker', level: AgentLevel.L9_Checker, specialty: 'ux.flow.checker', domain: d, area: a, promptTemplate: tp('FlowCompletenessChecker', 'Verify user flow completeness'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'MicroCopyChecker', level: AgentLevel.L9_Checker, specialty: 'ux.copy.checker', domain: d, area: a, promptTemplate: tp('MicroCopyChecker', 'Verify microcopy quality'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            // +5 to reach 20
            { name: 'NavigationFlowLead', level: AgentLevel.L6_TeamLead, specialty: 'ux.flow.navigation', domain: d, area: a, promptTemplate: tp('NavigationFlowLead', 'Lead navigation flow design') },
            { name: 'CheckoutFlowLead', level: AgentLevel.L6_TeamLead, specialty: 'ux.flow.checkout', domain: d, area: a, promptTemplate: tp('CheckoutFlowLead', 'Lead checkout/wizard flow design') },
            { name: 'ConfirmationWorker', level: AgentLevel.L8_Worker, specialty: 'ux.interaction.confirmation', domain: d, area: a, promptTemplate: tp('ConfirmationWorker', 'Design confirmation dialog patterns'), defaultCap: ModelCapability.Fast },
            { name: 'SkeletonScreenWorker', level: AgentLevel.L8_Worker, specialty: 'ux.states.skeleton', domain: d, area: a, promptTemplate: tp('SkeletonScreenWorker', 'Design skeleton screen loading states'), defaultCap: ModelCapability.Fast },
            { name: 'AccessibilityFlowChecker', level: AgentLevel.L9_Checker, specialty: 'ux.accessibility.flow.checker', domain: d, area: a, promptTemplate: tp('AccessibilityFlowChecker', 'Verify flow accessibility compliance'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
        ];
    }

    private buildDesignBrand(): SeedDef[] {
        const d = 'design'; const a = 'brand';
        const tp = (name: string, task: string) =>
            `You are ${name}, a specialized {{domain}}.{{area}} agent. Scope: {{scope}}. Parent context: {{parentContext}}. Task: ${task}`;

        return [
            // L4 Manager
            { name: 'BrandManager', level: AgentLevel.L4_Manager, specialty: 'brand.management', domain: d, area: a, promptTemplate: tp('BrandManager', 'Manage brand consistency') },
            // L5 SubManagers
            { name: 'ToneSub', level: AgentLevel.L5_SubManager, specialty: 'brand.tone', domain: d, area: a, promptTemplate: tp('ToneSub', 'Manage brand tone of voice') },
            { name: 'VisualIdentitySub', level: AgentLevel.L5_SubManager, specialty: 'brand.visual', domain: d, area: a, promptTemplate: tp('VisualIdentitySub', 'Manage visual brand identity') },
            // L6 Team Leads
            { name: 'LogoUsageLead', level: AgentLevel.L6_TeamLead, specialty: 'brand.logo', domain: d, area: a, promptTemplate: tp('LogoUsageLead', 'Lead logo usage guidelines') },
            { name: 'VoiceLead', level: AgentLevel.L6_TeamLead, specialty: 'brand.voice', domain: d, area: a, promptTemplate: tp('VoiceLead', 'Lead brand voice guidelines') },
            // L8 Workers
            { name: 'BrandColorWorker', level: AgentLevel.L8_Worker, specialty: 'brand.color', domain: d, area: a, promptTemplate: tp('BrandColorWorker', 'Apply brand colors'), defaultCap: ModelCapability.Fast },
            { name: 'BrandCopyWorker', level: AgentLevel.L8_Worker, specialty: 'brand.copy', domain: d, area: a, promptTemplate: tp('BrandCopyWorker', 'Write brand-aligned copy'), defaultCap: ModelCapability.Fast },
            { name: 'IllustrationStyleWorker', level: AgentLevel.L8_Worker, specialty: 'brand.illustration', domain: d, area: a, promptTemplate: tp('IllustrationStyleWorker', 'Define illustration style'), defaultCap: ModelCapability.Fast },
            // L9 Checkers
            { name: 'BrandConsistencyChecker', level: AgentLevel.L9_Checker, specialty: 'brand.consistency.checker', domain: d, area: a, promptTemplate: tp('BrandConsistencyChecker', 'Verify brand consistency'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'ToneChecker', level: AgentLevel.L9_Checker, specialty: 'brand.tone.checker', domain: d, area: a, promptTemplate: tp('ToneChecker', 'Verify brand tone consistency'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            // +5 to reach 15
            { name: 'StyleGuideSub', level: AgentLevel.L5_SubManager, specialty: 'brand.styleguide', domain: d, area: a, promptTemplate: tp('StyleGuideSub', 'Manage brand style guide') },
            { name: 'PhotographyLead', level: AgentLevel.L6_TeamLead, specialty: 'brand.photography', domain: d, area: a, promptTemplate: tp('PhotographyLead', 'Lead photography style guidelines') },
            { name: 'IconographyWorker', level: AgentLevel.L8_Worker, specialty: 'brand.iconography', domain: d, area: a, promptTemplate: tp('IconographyWorker', 'Define branded iconography style'), defaultCap: ModelCapability.Fast },
            { name: 'MotionBrandWorker', level: AgentLevel.L8_Worker, specialty: 'brand.motion', domain: d, area: a, promptTemplate: tp('MotionBrandWorker', 'Define branded motion principles'), defaultCap: ModelCapability.Fast },
            { name: 'BrandSpacingWorker', level: AgentLevel.L8_Worker, specialty: 'brand.spacing', domain: d, area: a, promptTemplate: tp('BrandSpacingWorker', 'Define brand spacing standards'), defaultCap: ModelCapability.Fast },
        ];
    }

    // ==================== DATA DOMAIN (~40) ====================

    private buildDataDomain(): SeedDef[] {
        const d = 'data';
        const tp = (name: string, area: string, task: string) =>
            `You are ${name}, a specialized {{domain}}.${area} agent. Scope: {{scope}}. Parent context: {{parentContext}}. Task: ${task}`;

        return [
            // Schema area (~15)
            { name: 'SchemaManager', level: AgentLevel.L4_Manager, specialty: 'data.schema', domain: d, area: 'schema', promptTemplate: tp('SchemaManager', 'schema', 'Manage database schema design') },
            { name: 'TableDesignSub', level: AgentLevel.L5_SubManager, specialty: 'data.schema.tables', domain: d, area: 'schema', promptTemplate: tp('TableDesignSub', 'schema', 'Manage table schema design') },
            { name: 'IndexSub', level: AgentLevel.L5_SubManager, specialty: 'data.schema.indexes', domain: d, area: 'schema', promptTemplate: tp('IndexSub', 'schema', 'Manage database index design') },
            { name: 'RelationshipSub', level: AgentLevel.L5_SubManager, specialty: 'data.schema.relationships', domain: d, area: 'schema', promptTemplate: tp('RelationshipSub', 'schema', 'Manage entity relationship design') },
            { name: 'ColumnLead', level: AgentLevel.L6_TeamLead, specialty: 'data.schema.columns', domain: d, area: 'schema', promptTemplate: tp('ColumnLead', 'schema', 'Lead column definition') },
            { name: 'ConstraintLead', level: AgentLevel.L6_TeamLead, specialty: 'data.schema.constraints', domain: d, area: 'schema', promptTemplate: tp('ConstraintLead', 'schema', 'Lead constraint definition') },
            { name: 'ColumnTypeWorker', level: AgentLevel.L8_Worker, specialty: 'data.schema.columns.types', domain: d, area: 'schema', promptTemplate: tp('ColumnTypeWorker', 'schema', 'Define column types'), defaultCap: ModelCapability.Fast },
            { name: 'ForeignKeyWorker', level: AgentLevel.L8_Worker, specialty: 'data.schema.fk', domain: d, area: 'schema', promptTemplate: tp('ForeignKeyWorker', 'schema', 'Define foreign keys'), defaultCap: ModelCapability.Fast },
            { name: 'IndexWorker', level: AgentLevel.L8_Worker, specialty: 'data.schema.indexes.create', domain: d, area: 'schema', promptTemplate: tp('IndexWorker', 'schema', 'Create indexes'), defaultCap: ModelCapability.Fast },
            { name: 'SchemaValidator', level: AgentLevel.L9_Checker, specialty: 'data.schema.checker', domain: d, area: 'schema', promptTemplate: tp('SchemaValidator', 'schema', 'Validate schema integrity'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'NormalizationChecker', level: AgentLevel.L9_Checker, specialty: 'data.schema.normalization.checker', domain: d, area: 'schema', promptTemplate: tp('NormalizationChecker', 'schema', 'Check schema normalization'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            // +4 to reach 15
            { name: 'TriggerSub', level: AgentLevel.L5_SubManager, specialty: 'data.schema.triggers', domain: d, area: 'schema', promptTemplate: tp('TriggerSub', 'schema', 'Manage database trigger design') },
            { name: 'ViewLead', level: AgentLevel.L6_TeamLead, specialty: 'data.schema.views', domain: d, area: 'schema', promptTemplate: tp('ViewLead', 'schema', 'Lead database view definition') },
            { name: 'DefaultValueWorker', level: AgentLevel.L8_Worker, specialty: 'data.schema.defaults', domain: d, area: 'schema', promptTemplate: tp('DefaultValueWorker', 'schema', 'Define column default values'), defaultCap: ModelCapability.Fast },
            { name: 'PartitionWorker', level: AgentLevel.L8_Worker, specialty: 'data.schema.partitions', domain: d, area: 'schema', promptTemplate: tp('PartitionWorker', 'schema', 'Design table partitioning'), defaultCap: ModelCapability.Fast },

            // Migration area (~10)
            { name: 'MigrationManager', level: AgentLevel.L4_Manager, specialty: 'data.migration', domain: d, area: 'migration', promptTemplate: tp('MigrationManager', 'migration', 'Manage database migrations') },
            { name: 'MigrationScriptSub', level: AgentLevel.L5_SubManager, specialty: 'data.migration.scripts', domain: d, area: 'migration', promptTemplate: tp('MigrationScriptSub', 'migration', 'Manage migration scripts') },
            { name: 'RollbackLead', level: AgentLevel.L6_TeamLead, specialty: 'data.migration.rollback', domain: d, area: 'migration', promptTemplate: tp('RollbackLead', 'migration', 'Lead rollback procedures') },
            { name: 'MigrationUpWorker', level: AgentLevel.L8_Worker, specialty: 'data.migration.up', domain: d, area: 'migration', promptTemplate: tp('MigrationUpWorker', 'migration', 'Write up-migrations'), defaultCap: ModelCapability.Fast },
            { name: 'MigrationDownWorker', level: AgentLevel.L8_Worker, specialty: 'data.migration.down', domain: d, area: 'migration', promptTemplate: tp('MigrationDownWorker', 'migration', 'Write down-migrations'), defaultCap: ModelCapability.Fast },
            { name: 'MigrationSafetyChecker', level: AgentLevel.L9_Checker, specialty: 'data.migration.checker', domain: d, area: 'migration', promptTemplate: tp('MigrationSafetyChecker', 'migration', 'Verify migration safety'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            // +4 to reach 10
            { name: 'DataTransformSub', level: AgentLevel.L5_SubManager, specialty: 'data.migration.transform', domain: d, area: 'migration', promptTemplate: tp('DataTransformSub', 'migration', 'Manage data transformation scripts') },
            { name: 'SchemaDiffLead', level: AgentLevel.L6_TeamLead, specialty: 'data.migration.diff', domain: d, area: 'migration', promptTemplate: tp('SchemaDiffLead', 'migration', 'Lead schema diff analysis') },
            { name: 'DataBackfillWorker', level: AgentLevel.L8_Worker, specialty: 'data.migration.backfill', domain: d, area: 'migration', promptTemplate: tp('DataBackfillWorker', 'migration', 'Write data backfill scripts'), defaultCap: ModelCapability.Fast },
            { name: 'MigrationOrderWorker', level: AgentLevel.L8_Worker, specialty: 'data.migration.order', domain: d, area: 'migration', promptTemplate: tp('MigrationOrderWorker', 'migration', 'Determine migration execution order'), defaultCap: ModelCapability.Fast },

            // Seed area (~8)
            { name: 'SeedManager', level: AgentLevel.L4_Manager, specialty: 'data.seed', domain: d, area: 'seed', promptTemplate: tp('SeedManager', 'seed', 'Manage seed data') },
            { name: 'SeedGeneratorSub', level: AgentLevel.L5_SubManager, specialty: 'data.seed.generator', domain: d, area: 'seed', promptTemplate: tp('SeedGeneratorSub', 'seed', 'Manage seed data generation') },
            { name: 'TestDataWorker', level: AgentLevel.L8_Worker, specialty: 'data.seed.test', domain: d, area: 'seed', promptTemplate: tp('TestDataWorker', 'seed', 'Generate test data'), defaultCap: ModelCapability.Fast },
            { name: 'FixtureDataWorker', level: AgentLevel.L8_Worker, specialty: 'data.seed.fixture', domain: d, area: 'seed', promptTemplate: tp('FixtureDataWorker', 'seed', 'Generate fixture data'), defaultCap: ModelCapability.Fast },
            { name: 'SeedIdempotencyChecker', level: AgentLevel.L9_Checker, specialty: 'data.seed.checker', domain: d, area: 'seed', promptTemplate: tp('SeedIdempotencyChecker', 'seed', 'Verify seed idempotency'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            // +3 to reach 8
            { name: 'SeedCleanupLead', level: AgentLevel.L6_TeamLead, specialty: 'data.seed.cleanup', domain: d, area: 'seed', promptTemplate: tp('SeedCleanupLead', 'seed', 'Lead seed data cleanup procedures') },
            { name: 'DemoDataWorker', level: AgentLevel.L8_Worker, specialty: 'data.seed.demo', domain: d, area: 'seed', promptTemplate: tp('DemoDataWorker', 'seed', 'Generate demo/sample data'), defaultCap: ModelCapability.Fast },
            { name: 'RelationalSeedWorker', level: AgentLevel.L8_Worker, specialty: 'data.seed.relational', domain: d, area: 'seed', promptTemplate: tp('RelationalSeedWorker', 'seed', 'Generate relationally consistent seed data'), defaultCap: ModelCapability.Fast },

            // Query area (~7)
            { name: 'QueryManager', level: AgentLevel.L4_Manager, specialty: 'data.query', domain: d, area: 'query', promptTemplate: tp('QueryManager', 'query', 'Manage query optimization') },
            { name: 'QueryOptSub', level: AgentLevel.L5_SubManager, specialty: 'data.query.optimization', domain: d, area: 'query', promptTemplate: tp('QueryOptSub', 'query', 'Manage query optimization') },
            { name: 'SelectQueryWorker', level: AgentLevel.L8_Worker, specialty: 'data.query.select', domain: d, area: 'query', promptTemplate: tp('SelectQueryWorker', 'query', 'Optimize SELECT queries'), defaultCap: ModelCapability.Fast },
            { name: 'JoinQueryWorker', level: AgentLevel.L8_Worker, specialty: 'data.query.join', domain: d, area: 'query', promptTemplate: tp('JoinQueryWorker', 'query', 'Optimize JOIN queries'), defaultCap: ModelCapability.Fast },
            { name: 'QueryPerformanceChecker', level: AgentLevel.L9_Checker, specialty: 'data.query.checker', domain: d, area: 'query', promptTemplate: tp('QueryPerformanceChecker', 'query', 'Check query performance'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            // +2 to reach 7
            { name: 'AggregateQueryWorker', level: AgentLevel.L8_Worker, specialty: 'data.query.aggregate', domain: d, area: 'query', promptTemplate: tp('AggregateQueryWorker', 'query', 'Optimize aggregate/GROUP BY queries'), defaultCap: ModelCapability.Fast },
            { name: 'SubqueryWorker', level: AgentLevel.L8_Worker, specialty: 'data.query.subquery', domain: d, area: 'query', promptTemplate: tp('SubqueryWorker', 'query', 'Optimize subqueries and CTEs'), defaultCap: ModelCapability.Fast },
        ];
    }

    // ==================== DOCS DOMAIN (~30) ====================

    private buildDocsDomain(): SeedDef[] {
        const d = 'docs';
        const tp = (name: string, area: string, task: string) =>
            `You are ${name}, a specialized {{domain}}.${area} agent. Scope: {{scope}}. Parent context: {{parentContext}}. Task: ${task}`;

        return [
            // API Docs area (~12)
            { name: 'APIDocsManager', level: AgentLevel.L4_Manager, specialty: 'docs.api', domain: d, area: 'api', promptTemplate: tp('APIDocsManager', 'api', 'Manage API documentation') },
            { name: 'EndpointDocSub', level: AgentLevel.L5_SubManager, specialty: 'docs.api.endpoints', domain: d, area: 'api', promptTemplate: tp('EndpointDocSub', 'api', 'Manage endpoint documentation') },
            { name: 'SchemaDocSub', level: AgentLevel.L5_SubManager, specialty: 'docs.api.schemas', domain: d, area: 'api', promptTemplate: tp('SchemaDocSub', 'api', 'Manage API schema documentation') },
            { name: 'ExampleLead', level: AgentLevel.L6_TeamLead, specialty: 'docs.api.examples', domain: d, area: 'api', promptTemplate: tp('ExampleLead', 'api', 'Lead code example writing') },
            { name: 'RequestDocWorker', level: AgentLevel.L8_Worker, specialty: 'docs.api.request', domain: d, area: 'api', promptTemplate: tp('RequestDocWorker', 'api', 'Document request schemas'), defaultCap: ModelCapability.Fast },
            { name: 'ResponseDocWorker', level: AgentLevel.L8_Worker, specialty: 'docs.api.response', domain: d, area: 'api', promptTemplate: tp('ResponseDocWorker', 'api', 'Document response schemas'), defaultCap: ModelCapability.Fast },
            { name: 'CodeExampleWorker', level: AgentLevel.L8_Worker, specialty: 'docs.api.examples.code', domain: d, area: 'api', promptTemplate: tp('CodeExampleWorker', 'api', 'Write code examples'), defaultCap: ModelCapability.Fast },
            { name: 'ErrorDocWorker', level: AgentLevel.L8_Worker, specialty: 'docs.api.errors', domain: d, area: 'api', promptTemplate: tp('ErrorDocWorker', 'api', 'Document error responses'), defaultCap: ModelCapability.Fast },
            { name: 'APIDocCompletenessChecker', level: AgentLevel.L9_Checker, specialty: 'docs.api.checker', domain: d, area: 'api', promptTemplate: tp('APIDocCompletenessChecker', 'api', 'Verify API doc completeness'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'APIExampleChecker', level: AgentLevel.L9_Checker, specialty: 'docs.api.examples.checker', domain: d, area: 'api', promptTemplate: tp('APIExampleChecker', 'api', 'Verify code examples work'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            // +2 to reach 12
            { name: 'AuthDocLead', level: AgentLevel.L6_TeamLead, specialty: 'docs.api.auth', domain: d, area: 'api', promptTemplate: tp('AuthDocLead', 'api', 'Lead authentication documentation') },
            { name: 'WebhookDocWorker', level: AgentLevel.L8_Worker, specialty: 'docs.api.webhooks', domain: d, area: 'api', promptTemplate: tp('WebhookDocWorker', 'api', 'Document webhook endpoints'), defaultCap: ModelCapability.Fast },

            // User Docs area (~10)
            { name: 'UserDocsManager', level: AgentLevel.L4_Manager, specialty: 'docs.user', domain: d, area: 'user', promptTemplate: tp('UserDocsManager', 'user', 'Manage user documentation') },
            { name: 'GuideSub', level: AgentLevel.L5_SubManager, specialty: 'docs.user.guides', domain: d, area: 'user', promptTemplate: tp('GuideSub', 'user', 'Manage user guides') },
            { name: 'TutorialSub', level: AgentLevel.L5_SubManager, specialty: 'docs.user.tutorials', domain: d, area: 'user', promptTemplate: tp('TutorialSub', 'user', 'Manage tutorials') },
            { name: 'QuickStartLead', level: AgentLevel.L6_TeamLead, specialty: 'docs.user.quickstart', domain: d, area: 'user', promptTemplate: tp('QuickStartLead', 'user', 'Lead quickstart guide writing') },
            { name: 'StepByStepWorker', level: AgentLevel.L8_Worker, specialty: 'docs.user.steps', domain: d, area: 'user', promptTemplate: tp('StepByStepWorker', 'user', 'Write step-by-step instructions'), defaultCap: ModelCapability.Fast },
            { name: 'ScreenshotWorker', level: AgentLevel.L8_Worker, specialty: 'docs.user.screenshots', domain: d, area: 'user', promptTemplate: tp('ScreenshotWorker', 'user', 'Document with screenshots'), defaultCap: ModelCapability.Fast },
            { name: 'FAQWorker', level: AgentLevel.L8_Worker, specialty: 'docs.user.faq', domain: d, area: 'user', promptTemplate: tp('FAQWorker', 'user', 'Write FAQ entries'), defaultCap: ModelCapability.Fast },
            { name: 'ReadabilityChecker', level: AgentLevel.L9_Checker, specialty: 'docs.user.readability.checker', domain: d, area: 'user', promptTemplate: tp('ReadabilityChecker', 'user', 'Check documentation readability'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            // +2 to reach 10
            { name: 'TroubleshootingWorker', level: AgentLevel.L8_Worker, specialty: 'docs.user.troubleshooting', domain: d, area: 'user', promptTemplate: tp('TroubleshootingWorker', 'user', 'Write troubleshooting guides'), defaultCap: ModelCapability.Fast },
            { name: 'ReleaseNotesWorker', level: AgentLevel.L8_Worker, specialty: 'docs.user.releases', domain: d, area: 'user', promptTemplate: tp('ReleaseNotesWorker', 'user', 'Write release notes for users'), defaultCap: ModelCapability.Fast },

            // Internal Docs area (~8)
            { name: 'InternalDocsManager', level: AgentLevel.L4_Manager, specialty: 'docs.internal', domain: d, area: 'internal', promptTemplate: tp('InternalDocsManager', 'internal', 'Manage internal documentation') },
            { name: 'ArchDocSub', level: AgentLevel.L5_SubManager, specialty: 'docs.internal.architecture', domain: d, area: 'internal', promptTemplate: tp('ArchDocSub', 'internal', 'Manage architecture documentation') },
            { name: 'ADRLead', level: AgentLevel.L6_TeamLead, specialty: 'docs.internal.adr', domain: d, area: 'internal', promptTemplate: tp('ADRLead', 'internal', 'Lead architecture decision records') },
            { name: 'ChangelogWorker', level: AgentLevel.L8_Worker, specialty: 'docs.internal.changelog', domain: d, area: 'internal', promptTemplate: tp('ChangelogWorker', 'internal', 'Write changelog entries'), defaultCap: ModelCapability.Fast },
            { name: 'ArchDiagramWorker', level: AgentLevel.L8_Worker, specialty: 'docs.internal.diagrams', domain: d, area: 'internal', promptTemplate: tp('ArchDiagramWorker', 'internal', 'Create architecture diagrams'), defaultCap: ModelCapability.Fast },
            { name: 'InlineCommentWorker', level: AgentLevel.L8_Worker, specialty: 'docs.internal.comments', domain: d, area: 'internal', promptTemplate: tp('InlineCommentWorker', 'internal', 'Write inline code comments'), defaultCap: ModelCapability.Fast },
            { name: 'InternalDocChecker', level: AgentLevel.L9_Checker, specialty: 'docs.internal.checker', domain: d, area: 'internal', promptTemplate: tp('InternalDocChecker', 'internal', 'Verify internal doc accuracy'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            // +1 to reach 8
            { name: 'RunbookWorker', level: AgentLevel.L8_Worker, specialty: 'docs.internal.runbooks', domain: d, area: 'internal', promptTemplate: tp('RunbookWorker', 'internal', 'Write operational runbooks'), defaultCap: ModelCapability.Fast },
        ];
    }

    // ==================== PLANNING DOMAIN (~80) ====================

    private buildPlanningDomain(): SeedDef[] {
        return [
            ...this.buildPlanningArchitecture(),
            ...this.buildPlanningDecomposition(),
            ...this.buildPlanningEstimation(),
            ...this.buildPlanningDependency(),
        ];
    }

    private buildPlanningArchitecture(): SeedDef[] {
        const d = 'planning'; const a = 'architecture';
        const tp = (name: string, task: string) =>
            `You are ${name}, a specialized {{domain}}.{{area}} agent. Scope: {{scope}}. Parent context: {{parentContext}}. Task: ${task}`;

        return [
            { name: 'SystemArchitectManager', level: AgentLevel.L4_Manager, specialty: 'planning.architecture', domain: d, area: a, promptTemplate: tp('SystemArchitectManager', 'Manage system architecture decisions') },
            { name: 'FrontendArchSub', level: AgentLevel.L5_SubManager, specialty: 'planning.architecture.frontend', domain: d, area: a, promptTemplate: tp('FrontendArchSub', 'Manage frontend architecture decisions') },
            { name: 'BackendArchSub', level: AgentLevel.L5_SubManager, specialty: 'planning.architecture.backend', domain: d, area: a, promptTemplate: tp('BackendArchSub', 'Manage backend architecture decisions') },
            { name: 'DataArchSub', level: AgentLevel.L5_SubManager, specialty: 'planning.architecture.data', domain: d, area: a, promptTemplate: tp('DataArchSub', 'Manage data architecture decisions') },
            { name: 'IntegrationArchSub', level: AgentLevel.L5_SubManager, specialty: 'planning.architecture.integration', domain: d, area: a, promptTemplate: tp('IntegrationArchSub', 'Manage integration architecture') },
            { name: 'MicroserviceLead', level: AgentLevel.L6_TeamLead, specialty: 'planning.architecture.microservice', domain: d, area: a, promptTemplate: tp('MicroserviceLead', 'Lead microservice architecture design') },
            { name: 'MonolithLead', level: AgentLevel.L6_TeamLead, specialty: 'planning.architecture.monolith', domain: d, area: a, promptTemplate: tp('MonolithLead', 'Lead monolith architecture design') },
            { name: 'EventDrivenLead', level: AgentLevel.L6_TeamLead, specialty: 'planning.architecture.event', domain: d, area: a, promptTemplate: tp('EventDrivenLead', 'Lead event-driven architecture design') },
            { name: 'APIDesignLead', level: AgentLevel.L6_TeamLead, specialty: 'planning.architecture.api', domain: d, area: a, promptTemplate: tp('APIDesignLead', 'Lead API design decisions') },
            { name: 'ComponentDiagramWorker', level: AgentLevel.L8_Worker, specialty: 'planning.architecture.diagrams.component', domain: d, area: a, promptTemplate: tp('ComponentDiagramWorker', 'Create component diagrams'), defaultCap: ModelCapability.Fast },
            { name: 'SequenceDiagramWorker', level: AgentLevel.L8_Worker, specialty: 'planning.architecture.diagrams.sequence', domain: d, area: a, promptTemplate: tp('SequenceDiagramWorker', 'Create sequence diagrams'), defaultCap: ModelCapability.Fast },
            { name: 'DataFlowDiagramWorker', level: AgentLevel.L8_Worker, specialty: 'planning.architecture.diagrams.dataflow', domain: d, area: a, promptTemplate: tp('DataFlowDiagramWorker', 'Create data flow diagrams'), defaultCap: ModelCapability.Fast },
            { name: 'TechStackWorker', level: AgentLevel.L8_Worker, specialty: 'planning.architecture.techstack', domain: d, area: a, promptTemplate: tp('TechStackWorker', 'Evaluate and recommend tech stack'), defaultCap: ModelCapability.Fast },
            { name: 'ScalabilityWorker', level: AgentLevel.L8_Worker, specialty: 'planning.architecture.scalability', domain: d, area: a, promptTemplate: tp('ScalabilityWorker', 'Plan scalability strategy'), defaultCap: ModelCapability.Fast },
            { name: 'PatternSelectionWorker', level: AgentLevel.L8_Worker, specialty: 'planning.architecture.patterns', domain: d, area: a, promptTemplate: tp('PatternSelectionWorker', 'Select design patterns'), defaultCap: ModelCapability.Fast },
            { name: 'ArchReviewChecker', level: AgentLevel.L9_Checker, specialty: 'planning.architecture.checker', domain: d, area: a, promptTemplate: tp('ArchReviewChecker', 'Review architecture decisions'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'ArchConsistencyChecker', level: AgentLevel.L9_Checker, specialty: 'planning.architecture.consistency.checker', domain: d, area: a, promptTemplate: tp('ArchConsistencyChecker', 'Verify architecture consistency'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'LayeringLead', level: AgentLevel.L6_TeamLead, specialty: 'planning.architecture.layering', domain: d, area: a, promptTemplate: tp('LayeringLead', 'Lead layered architecture decisions') },
            { name: 'CachingStrategyWorker', level: AgentLevel.L8_Worker, specialty: 'planning.architecture.caching', domain: d, area: a, promptTemplate: tp('CachingStrategyWorker', 'Plan caching strategy'), defaultCap: ModelCapability.Fast },
            { name: 'StateManagementPlanWorker', level: AgentLevel.L8_Worker, specialty: 'planning.architecture.state', domain: d, area: a, promptTemplate: tp('StateManagementPlanWorker', 'Plan state management approach'), defaultCap: ModelCapability.Fast },
            { name: 'ErrorStrategyWorker', level: AgentLevel.L8_Worker, specialty: 'planning.architecture.errors', domain: d, area: a, promptTemplate: tp('ErrorStrategyWorker', 'Plan error handling strategy'), defaultCap: ModelCapability.Fast },
            { name: 'SecurityArchWorker', level: AgentLevel.L8_Worker, specialty: 'planning.architecture.security', domain: d, area: a, promptTemplate: tp('SecurityArchWorker', 'Plan security architecture'), defaultCap: ModelCapability.Fast },
            { name: 'DeploymentArchLead', level: AgentLevel.L6_TeamLead, specialty: 'planning.architecture.deployment', domain: d, area: a, promptTemplate: tp('DeploymentArchLead', 'Lead deployment architecture decisions') },
            { name: 'BoundaryWorker', level: AgentLevel.L8_Worker, specialty: 'planning.architecture.boundaries', domain: d, area: a, promptTemplate: tp('BoundaryWorker', 'Define module boundaries'), defaultCap: ModelCapability.Fast },
            { name: 'TradeoffAnalysisChecker', level: AgentLevel.L9_Checker, specialty: 'planning.architecture.tradeoffs.checker', domain: d, area: a, promptTemplate: tp('TradeoffAnalysisChecker', 'Analyze architecture tradeoffs'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
        ];
    }

    private buildPlanningDecomposition(): SeedDef[] {
        const d = 'planning'; const a = 'decomposition';
        const tp = (name: string, task: string) =>
            `You are ${name}, a specialized {{domain}}.{{area}} agent. Scope: {{scope}}. Parent context: {{parentContext}}. Task: ${task}`;

        return [
            { name: 'DecompositionManager', level: AgentLevel.L4_Manager, specialty: 'planning.decomposition', domain: d, area: a, promptTemplate: tp('DecompositionManager', 'Manage task decomposition') },
            { name: 'FeatureDecompSub', level: AgentLevel.L5_SubManager, specialty: 'planning.decomposition.feature', domain: d, area: a, promptTemplate: tp('FeatureDecompSub', 'Decompose features into tasks') },
            { name: 'EpicDecompSub', level: AgentLevel.L5_SubManager, specialty: 'planning.decomposition.epic', domain: d, area: a, promptTemplate: tp('EpicDecompSub', 'Decompose epics into features') },
            { name: 'StoryDecompSub', level: AgentLevel.L5_SubManager, specialty: 'planning.decomposition.story', domain: d, area: a, promptTemplate: tp('StoryDecompSub', 'Decompose stories into tasks') },
            { name: 'AtomicTaskLead', level: AgentLevel.L6_TeamLead, specialty: 'planning.decomposition.atomic', domain: d, area: a, promptTemplate: tp('AtomicTaskLead', 'Ensure tasks are atomic and actionable') },
            { name: 'SubtaskSplitWorker', level: AgentLevel.L8_Worker, specialty: 'planning.decomposition.split', domain: d, area: a, promptTemplate: tp('SubtaskSplitWorker', 'Split tasks into subtasks'), defaultCap: ModelCapability.Fast },
            { name: 'AcceptanceCriteriaWorker', level: AgentLevel.L8_Worker, specialty: 'planning.decomposition.criteria', domain: d, area: a, promptTemplate: tp('AcceptanceCriteriaWorker', 'Write acceptance criteria'), defaultCap: ModelCapability.Fast },
            { name: 'TaskPriorityWorker', level: AgentLevel.L8_Worker, specialty: 'planning.decomposition.priority', domain: d, area: a, promptTemplate: tp('TaskPriorityWorker', 'Assign task priorities'), defaultCap: ModelCapability.Fast },
            { name: 'ScopeDefWorker', level: AgentLevel.L8_Worker, specialty: 'planning.decomposition.scope', domain: d, area: a, promptTemplate: tp('ScopeDefWorker', 'Define task scope boundaries'), defaultCap: ModelCapability.Fast },
            { name: 'TaskOrderingWorker', level: AgentLevel.L8_Worker, specialty: 'planning.decomposition.ordering', domain: d, area: a, promptTemplate: tp('TaskOrderingWorker', 'Determine task execution order'), defaultCap: ModelCapability.Fast },
            { name: 'GranularityChecker', level: AgentLevel.L9_Checker, specialty: 'planning.decomposition.granularity.checker', domain: d, area: a, promptTemplate: tp('GranularityChecker', 'Verify task granularity is appropriate'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'CompletenessChecker', level: AgentLevel.L9_Checker, specialty: 'planning.decomposition.completeness.checker', domain: d, area: a, promptTemplate: tp('CompletenessChecker', 'Verify decomposition covers all requirements'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'ParallelismLead', level: AgentLevel.L6_TeamLead, specialty: 'planning.decomposition.parallel', domain: d, area: a, promptTemplate: tp('ParallelismLead', 'Identify parallelizable tasks') },
            { name: 'BlockerIdentificationWorker', level: AgentLevel.L8_Worker, specialty: 'planning.decomposition.blockers', domain: d, area: a, promptTemplate: tp('BlockerIdentificationWorker', 'Identify potential blockers'), defaultCap: ModelCapability.Fast },
            { name: 'MilestoneWorker', level: AgentLevel.L8_Worker, specialty: 'planning.decomposition.milestones', domain: d, area: a, promptTemplate: tp('MilestoneWorker', 'Define project milestones'), defaultCap: ModelCapability.Fast },
            { name: 'RiskDecompWorker', level: AgentLevel.L8_Worker, specialty: 'planning.decomposition.risk', domain: d, area: a, promptTemplate: tp('RiskDecompWorker', 'Identify task-level risks'), defaultCap: ModelCapability.Fast },
            { name: 'TestableDecompWorker', level: AgentLevel.L8_Worker, specialty: 'planning.decomposition.testable', domain: d, area: a, promptTemplate: tp('TestableDecompWorker', 'Ensure tasks have testable outcomes'), defaultCap: ModelCapability.Fast },
            { name: 'OverlapChecker', level: AgentLevel.L9_Checker, specialty: 'planning.decomposition.overlap.checker', domain: d, area: a, promptTemplate: tp('OverlapChecker', 'Check for task overlap/duplication'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'ScopeLead', level: AgentLevel.L6_TeamLead, specialty: 'planning.decomposition.scope.lead', domain: d, area: a, promptTemplate: tp('ScopeLead', 'Lead scope management for decomposed tasks') },
            { name: 'DeliveryPhaseWorker', level: AgentLevel.L8_Worker, specialty: 'planning.decomposition.phases', domain: d, area: a, promptTemplate: tp('DeliveryPhaseWorker', 'Define delivery phases'), defaultCap: ModelCapability.Fast },
        ];
    }

    private buildPlanningEstimation(): SeedDef[] {
        const d = 'planning'; const a = 'estimation';
        const tp = (name: string, task: string) =>
            `You are ${name}, a specialized {{domain}}.{{area}} agent. Scope: {{scope}}. Parent context: {{parentContext}}. Task: ${task}`;

        return [
            { name: 'EstimationManager', level: AgentLevel.L4_Manager, specialty: 'planning.estimation', domain: d, area: a, promptTemplate: tp('EstimationManager', 'Manage task estimation') },
            { name: 'EffortEstSub', level: AgentLevel.L5_SubManager, specialty: 'planning.estimation.effort', domain: d, area: a, promptTemplate: tp('EffortEstSub', 'Manage effort estimation') },
            { name: 'ComplexitySub', level: AgentLevel.L5_SubManager, specialty: 'planning.estimation.complexity', domain: d, area: a, promptTemplate: tp('ComplexitySub', 'Manage complexity assessment') },
            { name: 'TimeEstLead', level: AgentLevel.L6_TeamLead, specialty: 'planning.estimation.time', domain: d, area: a, promptTemplate: tp('TimeEstLead', 'Lead time estimation') },
            { name: 'StoryPointWorker', level: AgentLevel.L8_Worker, specialty: 'planning.estimation.storypoints', domain: d, area: a, promptTemplate: tp('StoryPointWorker', 'Assign story point estimates'), defaultCap: ModelCapability.Fast },
            { name: 'TimeBoxingWorker', level: AgentLevel.L8_Worker, specialty: 'planning.estimation.timebox', domain: d, area: a, promptTemplate: tp('TimeBoxingWorker', 'Define time boxes for tasks'), defaultCap: ModelCapability.Fast },
            { name: 'ComplexityScoreWorker', level: AgentLevel.L8_Worker, specialty: 'planning.estimation.complexity.score', domain: d, area: a, promptTemplate: tp('ComplexityScoreWorker', 'Score task complexity'), defaultCap: ModelCapability.Fast },
            { name: 'RiskFactorWorker', level: AgentLevel.L8_Worker, specialty: 'planning.estimation.risk', domain: d, area: a, promptTemplate: tp('RiskFactorWorker', 'Estimate risk factors'), defaultCap: ModelCapability.Fast },
            { name: 'ConfidenceWorker', level: AgentLevel.L8_Worker, specialty: 'planning.estimation.confidence', domain: d, area: a, promptTemplate: tp('ConfidenceWorker', 'Assign estimation confidence levels'), defaultCap: ModelCapability.Fast },
            { name: 'BufferCalcWorker', level: AgentLevel.L8_Worker, specialty: 'planning.estimation.buffer', domain: d, area: a, promptTemplate: tp('BufferCalcWorker', 'Calculate estimation buffers'), defaultCap: ModelCapability.Fast },
            { name: 'EstimationAccuracyChecker', level: AgentLevel.L9_Checker, specialty: 'planning.estimation.accuracy.checker', domain: d, area: a, promptTemplate: tp('EstimationAccuracyChecker', 'Verify estimation accuracy'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'VelocityLead', level: AgentLevel.L6_TeamLead, specialty: 'planning.estimation.velocity', domain: d, area: a, promptTemplate: tp('VelocityLead', 'Track and predict velocity') },
            { name: 'HistoricalCompWorker', level: AgentLevel.L8_Worker, specialty: 'planning.estimation.historical', domain: d, area: a, promptTemplate: tp('HistoricalCompWorker', 'Compare with historical estimates'), defaultCap: ModelCapability.Fast },
            { name: 'ResourceEstWorker', level: AgentLevel.L8_Worker, specialty: 'planning.estimation.resources', domain: d, area: a, promptTemplate: tp('ResourceEstWorker', 'Estimate resource requirements'), defaultCap: ModelCapability.Fast },
            { name: 'ReasonablenessChecker', level: AgentLevel.L9_Checker, specialty: 'planning.estimation.reasonableness.checker', domain: d, area: a, promptTemplate: tp('ReasonablenessChecker', 'Verify estimates are reasonable'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
        ];
    }

    private buildPlanningDependency(): SeedDef[] {
        const d = 'planning'; const a = 'dependency';
        const tp = (name: string, task: string) =>
            `You are ${name}, a specialized {{domain}}.{{area}} agent. Scope: {{scope}}. Parent context: {{parentContext}}. Task: ${task}`;

        return [
            { name: 'DependencyManager', level: AgentLevel.L4_Manager, specialty: 'planning.dependency', domain: d, area: a, promptTemplate: tp('DependencyManager', 'Manage dependency analysis') },
            { name: 'TaskDepSub', level: AgentLevel.L5_SubManager, specialty: 'planning.dependency.tasks', domain: d, area: a, promptTemplate: tp('TaskDepSub', 'Manage task dependency mapping') },
            { name: 'ModuleDepSub', level: AgentLevel.L5_SubManager, specialty: 'planning.dependency.modules', domain: d, area: a, promptTemplate: tp('ModuleDepSub', 'Manage module dependency mapping') },
            { name: 'ExternalDepSub', level: AgentLevel.L5_SubManager, specialty: 'planning.dependency.external', domain: d, area: a, promptTemplate: tp('ExternalDepSub', 'Manage external dependency tracking') },
            { name: 'CriticalPathLead', level: AgentLevel.L6_TeamLead, specialty: 'planning.dependency.critical', domain: d, area: a, promptTemplate: tp('CriticalPathLead', 'Identify critical path') },
            { name: 'DepGraphWorker', level: AgentLevel.L8_Worker, specialty: 'planning.dependency.graph', domain: d, area: a, promptTemplate: tp('DepGraphWorker', 'Build dependency graphs'), defaultCap: ModelCapability.Fast },
            { name: 'CircularDepWorker', level: AgentLevel.L8_Worker, specialty: 'planning.dependency.circular', domain: d, area: a, promptTemplate: tp('CircularDepWorker', 'Detect circular dependencies'), defaultCap: ModelCapability.Fast },
            { name: 'PackageDepWorker', level: AgentLevel.L8_Worker, specialty: 'planning.dependency.packages', domain: d, area: a, promptTemplate: tp('PackageDepWorker', 'Analyze package dependencies'), defaultCap: ModelCapability.Fast },
            { name: 'VersionConflictWorker', level: AgentLevel.L8_Worker, specialty: 'planning.dependency.versions', domain: d, area: a, promptTemplate: tp('VersionConflictWorker', 'Resolve version conflicts'), defaultCap: ModelCapability.Fast },
            { name: 'OrderingWorker', level: AgentLevel.L8_Worker, specialty: 'planning.dependency.ordering', domain: d, area: a, promptTemplate: tp('OrderingWorker', 'Determine build order from deps'), defaultCap: ModelCapability.Fast },
            { name: 'DepCycleChecker', level: AgentLevel.L9_Checker, specialty: 'planning.dependency.cycle.checker', domain: d, area: a, promptTemplate: tp('DepCycleChecker', 'Check for dependency cycles'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'DepCompletenessChecker', level: AgentLevel.L9_Checker, specialty: 'planning.dependency.completeness.checker', domain: d, area: a, promptTemplate: tp('DepCompletenessChecker', 'Verify all dependencies declared'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'ImpactAnalysisLead', level: AgentLevel.L6_TeamLead, specialty: 'planning.dependency.impact', domain: d, area: a, promptTemplate: tp('ImpactAnalysisLead', 'Lead dependency impact analysis') },
            { name: 'UpstreamWorker', level: AgentLevel.L8_Worker, specialty: 'planning.dependency.upstream', domain: d, area: a, promptTemplate: tp('UpstreamWorker', 'Analyze upstream dependencies'), defaultCap: ModelCapability.Fast },
            { name: 'DownstreamWorker', level: AgentLevel.L8_Worker, specialty: 'planning.dependency.downstream', domain: d, area: a, promptTemplate: tp('DownstreamWorker', 'Analyze downstream impacts'), defaultCap: ModelCapability.Fast },
            { name: 'LicenseDepWorker', level: AgentLevel.L8_Worker, specialty: 'planning.dependency.license', domain: d, area: a, promptTemplate: tp('LicenseDepWorker', 'Check dependency licenses'), defaultCap: ModelCapability.Fast },
            { name: 'SecurityDepWorker', level: AgentLevel.L8_Worker, specialty: 'planning.dependency.security', domain: d, area: a, promptTemplate: tp('SecurityDepWorker', 'Check dependency security advisories'), defaultCap: ModelCapability.Fast },
            { name: 'DepAuditChecker', level: AgentLevel.L9_Checker, specialty: 'planning.dependency.audit.checker', domain: d, area: a, promptTemplate: tp('DepAuditChecker', 'Audit dependency health'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'BottleneckLead', level: AgentLevel.L6_TeamLead, specialty: 'planning.dependency.bottleneck', domain: d, area: a, promptTemplate: tp('BottleneckLead', 'Identify dependency bottlenecks') },
            { name: 'ParallelPathWorker', level: AgentLevel.L8_Worker, specialty: 'planning.dependency.parallel', domain: d, area: a, promptTemplate: tp('ParallelPathWorker', 'Identify parallel execution paths'), defaultCap: ModelCapability.Fast },
        ];
    }

    // ==================== VERIFICATION DOMAIN (~80) ====================

    private buildVerificationDomain(): SeedDef[] {
        return [
            ...this.buildVerificationSecurity(),
            ...this.buildVerificationPerformance(),
            ...this.buildVerificationCompliance(),
            ...this.buildVerificationQuality(),
        ];
    }

    private buildVerificationSecurity(): SeedDef[] {
        const d = 'verification'; const a = 'security';
        const tp = (name: string, task: string) =>
            `You are ${name}, a specialized {{domain}}.{{area}} agent. Scope: {{scope}}. Parent context: {{parentContext}}. Task: ${task}`;

        return [
            { name: 'SecurityAuditManager', level: AgentLevel.L4_Manager, specialty: 'verification.security', domain: d, area: a, promptTemplate: tp('SecurityAuditManager', 'Manage security auditing') },
            { name: 'InputSanitizeSub', level: AgentLevel.L5_SubManager, specialty: 'verification.security.input', domain: d, area: a, promptTemplate: tp('InputSanitizeSub', 'Manage input sanitization verification') },
            { name: 'AuthAuditSub', level: AgentLevel.L5_SubManager, specialty: 'verification.security.auth', domain: d, area: a, promptTemplate: tp('AuthAuditSub', 'Audit authentication mechanisms') },
            { name: 'DataProtectionSub', level: AgentLevel.L5_SubManager, specialty: 'verification.security.data', domain: d, area: a, promptTemplate: tp('DataProtectionSub', 'Verify data protection measures') },
            { name: 'XSSDetectLead', level: AgentLevel.L6_TeamLead, specialty: 'verification.security.xss', domain: d, area: a, promptTemplate: tp('XSSDetectLead', 'Lead XSS detection') },
            { name: 'CSRFDetectLead', level: AgentLevel.L6_TeamLead, specialty: 'verification.security.csrf', domain: d, area: a, promptTemplate: tp('CSRFDetectLead', 'Lead CSRF detection') },
            { name: 'InjectionLead', level: AgentLevel.L6_TeamLead, specialty: 'verification.security.injection', domain: d, area: a, promptTemplate: tp('InjectionLead', 'Lead injection vulnerability detection') },
            { name: 'XSSWorker', level: AgentLevel.L8_Worker, specialty: 'verification.security.xss.scan', domain: d, area: a, promptTemplate: tp('XSSWorker', 'Scan for XSS vulnerabilities'), defaultCap: ModelCapability.Fast },
            { name: 'SQLiWorker', level: AgentLevel.L8_Worker, specialty: 'verification.security.sqli.scan', domain: d, area: a, promptTemplate: tp('SQLiWorker', 'Scan for SQL injection vulnerabilities'), defaultCap: ModelCapability.Fast },
            { name: 'CSRFWorker', level: AgentLevel.L8_Worker, specialty: 'verification.security.csrf.scan', domain: d, area: a, promptTemplate: tp('CSRFWorker', 'Scan for CSRF vulnerabilities'), defaultCap: ModelCapability.Fast },
            { name: 'HeaderSecurityWorker', level: AgentLevel.L8_Worker, specialty: 'verification.security.headers', domain: d, area: a, promptTemplate: tp('HeaderSecurityWorker', 'Check security headers'), defaultCap: ModelCapability.Fast },
            { name: 'SecretsDetectWorker', level: AgentLevel.L8_Worker, specialty: 'verification.security.secrets', domain: d, area: a, promptTemplate: tp('SecretsDetectWorker', 'Detect hardcoded secrets'), defaultCap: ModelCapability.Fast },
            { name: 'EncryptionWorker', level: AgentLevel.L8_Worker, specialty: 'verification.security.encryption', domain: d, area: a, promptTemplate: tp('EncryptionWorker', 'Verify encryption implementation'), defaultCap: ModelCapability.Fast },
            { name: 'PermissionWorker', level: AgentLevel.L8_Worker, specialty: 'verification.security.permissions', domain: d, area: a, promptTemplate: tp('PermissionWorker', 'Verify permission enforcement'), defaultCap: ModelCapability.Fast },
            { name: 'DependencyVulnWorker', level: AgentLevel.L8_Worker, specialty: 'verification.security.deps', domain: d, area: a, promptTemplate: tp('DependencyVulnWorker', 'Check dependency vulnerabilities'), defaultCap: ModelCapability.Fast },
            { name: 'SecurityReportChecker', level: AgentLevel.L9_Checker, specialty: 'verification.security.report.checker', domain: d, area: a, promptTemplate: tp('SecurityReportChecker', 'Compile security audit report'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'ThreatModelChecker', level: AgentLevel.L9_Checker, specialty: 'verification.security.threat.checker', domain: d, area: a, promptTemplate: tp('ThreatModelChecker', 'Verify threat model coverage'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'CORSWorker', level: AgentLevel.L8_Worker, specialty: 'verification.security.cors', domain: d, area: a, promptTemplate: tp('CORSWorker', 'Verify CORS configuration'), defaultCap: ModelCapability.Fast },
            { name: 'RateLimitVerifyWorker', level: AgentLevel.L8_Worker, specialty: 'verification.security.ratelimit', domain: d, area: a, promptTemplate: tp('RateLimitVerifyWorker', 'Verify rate limiting effectiveness'), defaultCap: ModelCapability.Fast },
            { name: 'OWASPChecker', level: AgentLevel.L9_Checker, specialty: 'verification.security.owasp.checker', domain: d, area: a, promptTemplate: tp('OWASPChecker', 'Verify OWASP top 10 coverage'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
        ];
    }

    private buildVerificationPerformance(): SeedDef[] {
        const d = 'verification'; const a = 'performance';
        const tp = (name: string, task: string) =>
            `You are ${name}, a specialized {{domain}}.{{area}} agent. Scope: {{scope}}. Parent context: {{parentContext}}. Task: ${task}`;

        return [
            { name: 'PerformanceManager', level: AgentLevel.L4_Manager, specialty: 'verification.performance', domain: d, area: a, promptTemplate: tp('PerformanceManager', 'Manage performance verification') },
            { name: 'LoadTestSub', level: AgentLevel.L5_SubManager, specialty: 'verification.performance.load', domain: d, area: a, promptTemplate: tp('LoadTestSub', 'Manage load testing') },
            { name: 'ProfilingSub', level: AgentLevel.L5_SubManager, specialty: 'verification.performance.profiling', domain: d, area: a, promptTemplate: tp('ProfilingSub', 'Manage performance profiling') },
            { name: 'BenchmarkLead', level: AgentLevel.L6_TeamLead, specialty: 'verification.performance.benchmark', domain: d, area: a, promptTemplate: tp('BenchmarkLead', 'Lead performance benchmarking') },
            { name: 'MemoryLeakLead', level: AgentLevel.L6_TeamLead, specialty: 'verification.performance.memory', domain: d, area: a, promptTemplate: tp('MemoryLeakLead', 'Lead memory leak detection') },
            { name: 'ResponseTimeWorker', level: AgentLevel.L8_Worker, specialty: 'verification.performance.response', domain: d, area: a, promptTemplate: tp('ResponseTimeWorker', 'Measure response times'), defaultCap: ModelCapability.Fast },
            { name: 'ThroughputWorker', level: AgentLevel.L8_Worker, specialty: 'verification.performance.throughput', domain: d, area: a, promptTemplate: tp('ThroughputWorker', 'Measure throughput'), defaultCap: ModelCapability.Fast },
            { name: 'MemoryUsageWorker', level: AgentLevel.L8_Worker, specialty: 'verification.performance.memory.usage', domain: d, area: a, promptTemplate: tp('MemoryUsageWorker', 'Analyze memory usage'), defaultCap: ModelCapability.Fast },
            { name: 'CPUProfileWorker', level: AgentLevel.L8_Worker, specialty: 'verification.performance.cpu', domain: d, area: a, promptTemplate: tp('CPUProfileWorker', 'Profile CPU usage'), defaultCap: ModelCapability.Fast },
            { name: 'QueryPerfWorker', level: AgentLevel.L8_Worker, specialty: 'verification.performance.queries', domain: d, area: a, promptTemplate: tp('QueryPerfWorker', 'Analyze query performance'), defaultCap: ModelCapability.Fast },
            { name: 'BundleSizeWorker', level: AgentLevel.L8_Worker, specialty: 'verification.performance.bundle', domain: d, area: a, promptTemplate: tp('BundleSizeWorker', 'Analyze bundle size'), defaultCap: ModelCapability.Fast },
            { name: 'RenderPerfWorker', level: AgentLevel.L8_Worker, specialty: 'verification.performance.render', domain: d, area: a, promptTemplate: tp('RenderPerfWorker', 'Measure render performance'), defaultCap: ModelCapability.Fast },
            { name: 'N1QueryWorker', level: AgentLevel.L8_Worker, specialty: 'verification.performance.n1', domain: d, area: a, promptTemplate: tp('N1QueryWorker', 'Detect N+1 query issues'), defaultCap: ModelCapability.Fast },
            { name: 'PerfRegressionChecker', level: AgentLevel.L9_Checker, specialty: 'verification.performance.regression.checker', domain: d, area: a, promptTemplate: tp('PerfRegressionChecker', 'Check for performance regressions'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'PerfBudgetChecker', level: AgentLevel.L9_Checker, specialty: 'verification.performance.budget.checker', domain: d, area: a, promptTemplate: tp('PerfBudgetChecker', 'Verify performance budgets met'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'CacheHitWorker', level: AgentLevel.L8_Worker, specialty: 'verification.performance.cache', domain: d, area: a, promptTemplate: tp('CacheHitWorker', 'Analyze cache hit rates'), defaultCap: ModelCapability.Fast },
            { name: 'LazyLoadLead', level: AgentLevel.L6_TeamLead, specialty: 'verification.performance.lazy', domain: d, area: a, promptTemplate: tp('LazyLoadLead', 'Lead lazy loading verification') },
            { name: 'ConcurrencyWorker', level: AgentLevel.L8_Worker, specialty: 'verification.performance.concurrency', domain: d, area: a, promptTemplate: tp('ConcurrencyWorker', 'Test concurrency behavior'), defaultCap: ModelCapability.Fast },
            { name: 'BottleneckChecker', level: AgentLevel.L9_Checker, specialty: 'verification.performance.bottleneck.checker', domain: d, area: a, promptTemplate: tp('BottleneckChecker', 'Identify performance bottlenecks'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'StartupTimeWorker', level: AgentLevel.L8_Worker, specialty: 'verification.performance.startup', domain: d, area: a, promptTemplate: tp('StartupTimeWorker', 'Measure startup/init time'), defaultCap: ModelCapability.Fast },
        ];
    }

    private buildVerificationCompliance(): SeedDef[] {
        const d = 'verification'; const a = 'compliance';
        const tp = (name: string, task: string) =>
            `You are ${name}, a specialized {{domain}}.{{area}} agent. Scope: {{scope}}. Parent context: {{parentContext}}. Task: ${task}`;

        return [
            { name: 'ComplianceManager', level: AgentLevel.L4_Manager, specialty: 'verification.compliance', domain: d, area: a, promptTemplate: tp('ComplianceManager', 'Manage compliance verification') },
            { name: 'A11ySub', level: AgentLevel.L5_SubManager, specialty: 'verification.compliance.a11y', domain: d, area: a, promptTemplate: tp('A11ySub', 'Manage accessibility compliance') },
            { name: 'CodingStandardsSub', level: AgentLevel.L5_SubManager, specialty: 'verification.compliance.standards', domain: d, area: a, promptTemplate: tp('CodingStandardsSub', 'Manage coding standards compliance') },
            { name: 'WCAGLead', level: AgentLevel.L6_TeamLead, specialty: 'verification.compliance.wcag', domain: d, area: a, promptTemplate: tp('WCAGLead', 'Lead WCAG compliance verification') },
            { name: 'LintRuleLead', level: AgentLevel.L6_TeamLead, specialty: 'verification.compliance.lint', domain: d, area: a, promptTemplate: tp('LintRuleLead', 'Lead lint rule compliance') },
            { name: 'ARIAWorker', level: AgentLevel.L8_Worker, specialty: 'verification.compliance.aria', domain: d, area: a, promptTemplate: tp('ARIAWorker', 'Verify ARIA label usage'), defaultCap: ModelCapability.Fast },
            { name: 'SemanticHTMLWorker', level: AgentLevel.L8_Worker, specialty: 'verification.compliance.semantic', domain: d, area: a, promptTemplate: tp('SemanticHTMLWorker', 'Verify semantic HTML usage'), defaultCap: ModelCapability.Fast },
            { name: 'KeyboardNavWorker', level: AgentLevel.L8_Worker, specialty: 'verification.compliance.keyboard', domain: d, area: a, promptTemplate: tp('KeyboardNavWorker', 'Verify keyboard navigation'), defaultCap: ModelCapability.Fast },
            { name: 'NamingConventionWorker', level: AgentLevel.L8_Worker, specialty: 'verification.compliance.naming', domain: d, area: a, promptTemplate: tp('NamingConventionWorker', 'Check naming conventions'), defaultCap: ModelCapability.Fast },
            { name: 'FileStructureWorker', level: AgentLevel.L8_Worker, specialty: 'verification.compliance.structure', domain: d, area: a, promptTemplate: tp('FileStructureWorker', 'Check file structure conventions'), defaultCap: ModelCapability.Fast },
            { name: 'TypeSafetyWorker', level: AgentLevel.L8_Worker, specialty: 'verification.compliance.types', domain: d, area: a, promptTemplate: tp('TypeSafetyWorker', 'Verify type safety'), defaultCap: ModelCapability.Fast },
            { name: 'A11yChecker', level: AgentLevel.L9_Checker, specialty: 'verification.compliance.a11y.checker', domain: d, area: a, promptTemplate: tp('A11yChecker', 'Full accessibility audit'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'StandardsChecker', level: AgentLevel.L9_Checker, specialty: 'verification.compliance.standards.checker', domain: d, area: a, promptTemplate: tp('StandardsChecker', 'Full coding standards audit'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'I18nWorker', level: AgentLevel.L8_Worker, specialty: 'verification.compliance.i18n', domain: d, area: a, promptTemplate: tp('I18nWorker', 'Verify internationalization compliance'), defaultCap: ModelCapability.Fast },
            { name: 'LicenseComplianceWorker', level: AgentLevel.L8_Worker, specialty: 'verification.compliance.license', domain: d, area: a, promptTemplate: tp('LicenseComplianceWorker', 'Verify license compliance'), defaultCap: ModelCapability.Fast },
        ];
    }

    private buildVerificationQuality(): SeedDef[] {
        const d = 'verification'; const a = 'quality';
        const tp = (name: string, task: string) =>
            `You are ${name}, a specialized {{domain}}.{{area}} agent. Scope: {{scope}}. Parent context: {{parentContext}}. Task: ${task}`;

        return [
            { name: 'CodeQualityManager', level: AgentLevel.L4_Manager, specialty: 'verification.quality', domain: d, area: a, promptTemplate: tp('CodeQualityManager', 'Manage code quality verification') },
            { name: 'CodeSmellSub', level: AgentLevel.L5_SubManager, specialty: 'verification.quality.smells', domain: d, area: a, promptTemplate: tp('CodeSmellSub', 'Detect code smells') },
            { name: 'DuplicationSub', level: AgentLevel.L5_SubManager, specialty: 'verification.quality.duplication', domain: d, area: a, promptTemplate: tp('DuplicationSub', 'Detect code duplication') },
            { name: 'ComplexityLead', level: AgentLevel.L6_TeamLead, specialty: 'verification.quality.complexity', domain: d, area: a, promptTemplate: tp('ComplexityLead', 'Lead complexity analysis') },
            { name: 'CyclomaticComplexityWorker', level: AgentLevel.L8_Worker, specialty: 'verification.quality.cyclomatic', domain: d, area: a, promptTemplate: tp('CyclomaticComplexityWorker', 'Measure cyclomatic complexity'), defaultCap: ModelCapability.Fast },
            { name: 'DuplicateCodeWorker', level: AgentLevel.L8_Worker, specialty: 'verification.quality.duplicate', domain: d, area: a, promptTemplate: tp('DuplicateCodeWorker', 'Find duplicate code'), defaultCap: ModelCapability.Fast },
            { name: 'DeadCodeWorker', level: AgentLevel.L8_Worker, specialty: 'verification.quality.deadcode', domain: d, area: a, promptTemplate: tp('DeadCodeWorker', 'Find dead/unused code'), defaultCap: ModelCapability.Fast },
            { name: 'FunctionLengthWorker', level: AgentLevel.L8_Worker, specialty: 'verification.quality.length', domain: d, area: a, promptTemplate: tp('FunctionLengthWorker', 'Check function length'), defaultCap: ModelCapability.Fast },
            { name: 'CouplingWorker', level: AgentLevel.L8_Worker, specialty: 'verification.quality.coupling', domain: d, area: a, promptTemplate: tp('CouplingWorker', 'Analyze module coupling'), defaultCap: ModelCapability.Fast },
            { name: 'CohesionWorker', level: AgentLevel.L8_Worker, specialty: 'verification.quality.cohesion', domain: d, area: a, promptTemplate: tp('CohesionWorker', 'Analyze module cohesion'), defaultCap: ModelCapability.Fast },
            { name: 'SOLIDWorker', level: AgentLevel.L8_Worker, specialty: 'verification.quality.solid', domain: d, area: a, promptTemplate: tp('SOLIDWorker', 'Check SOLID principle adherence'), defaultCap: ModelCapability.Fast },
            { name: 'DRYWorker', level: AgentLevel.L8_Worker, specialty: 'verification.quality.dry', domain: d, area: a, promptTemplate: tp('DRYWorker', 'Check DRY principle adherence'), defaultCap: ModelCapability.Fast },
            { name: 'MaintainabilityChecker', level: AgentLevel.L9_Checker, specialty: 'verification.quality.maintainability.checker', domain: d, area: a, promptTemplate: tp('MaintainabilityChecker', 'Calculate maintainability index'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'TechDebtChecker', level: AgentLevel.L9_Checker, specialty: 'verification.quality.debt.checker', domain: d, area: a, promptTemplate: tp('TechDebtChecker', 'Assess technical debt'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'CodeReviewChecker', level: AgentLevel.L9_Checker, specialty: 'verification.quality.review.checker', domain: d, area: a, promptTemplate: tp('CodeReviewChecker', 'Automated code review'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'ReadabilityLead', level: AgentLevel.L6_TeamLead, specialty: 'verification.quality.readability', domain: d, area: a, promptTemplate: tp('ReadabilityLead', 'Lead readability analysis') },
            { name: 'CommentQualityWorker', level: AgentLevel.L8_Worker, specialty: 'verification.quality.comments', domain: d, area: a, promptTemplate: tp('CommentQualityWorker', 'Check comment quality'), defaultCap: ModelCapability.Fast },
            { name: 'ImportOrganizationWorker', level: AgentLevel.L8_Worker, specialty: 'verification.quality.imports', domain: d, area: a, promptTemplate: tp('ImportOrganizationWorker', 'Check import organization'), defaultCap: ModelCapability.Fast },
            { name: 'ErrorHandlingQualityWorker', level: AgentLevel.L8_Worker, specialty: 'verification.quality.errorhandling', domain: d, area: a, promptTemplate: tp('ErrorHandlingQualityWorker', 'Check error handling quality'), defaultCap: ModelCapability.Fast },
            { name: 'OverallQualityChecker', level: AgentLevel.L9_Checker, specialty: 'verification.quality.overall.checker', domain: d, area: a, promptTemplate: tp('OverallQualityChecker', 'Overall code quality score'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
        ];
    }

    // ==================== CO-DIRECTOR DOMAIN (~60) ====================

    private buildCoDirectorDomain(): SeedDef[] {
        const d = 'co_director';
        const tp = (name: string, area: string, task: string) =>
            `You are ${name}, a specialized {{domain}}.${area} agent. Scope: {{scope}}. Parent context: {{parentContext}}. Task: ${task}`;

        return [
            // Project Management (~20)
            { name: 'ProjectTrackingManager', level: AgentLevel.L4_Manager, specialty: 'co_director.tracking', domain: d, area: 'project', promptTemplate: tp('ProjectTrackingManager', 'project', 'Track project progress') },
            { name: 'SprintPlanningSub', level: AgentLevel.L5_SubManager, specialty: 'co_director.sprint', domain: d, area: 'project', promptTemplate: tp('SprintPlanningSub', 'project', 'Manage sprint planning') },
            { name: 'BacklogSub', level: AgentLevel.L5_SubManager, specialty: 'co_director.backlog', domain: d, area: 'project', promptTemplate: tp('BacklogSub', 'project', 'Manage product backlog') },
            { name: 'RoadmapSub', level: AgentLevel.L5_SubManager, specialty: 'co_director.roadmap', domain: d, area: 'project', promptTemplate: tp('RoadmapSub', 'project', 'Manage project roadmap') },
            { name: 'VelocityTrackingLead', level: AgentLevel.L6_TeamLead, specialty: 'co_director.velocity', domain: d, area: 'project', promptTemplate: tp('VelocityTrackingLead', 'project', 'Track team velocity') },
            { name: 'BurndownLead', level: AgentLevel.L6_TeamLead, specialty: 'co_director.burndown', domain: d, area: 'project', promptTemplate: tp('BurndownLead', 'project', 'Lead burndown tracking') },
            { name: 'ProgressWorker', level: AgentLevel.L8_Worker, specialty: 'co_director.tracking.progress', domain: d, area: 'project', promptTemplate: tp('ProgressWorker', 'project', 'Track task progress'), defaultCap: ModelCapability.Fast },
            { name: 'BlockerTrackWorker', level: AgentLevel.L8_Worker, specialty: 'co_director.tracking.blockers', domain: d, area: 'project', promptTemplate: tp('BlockerTrackWorker', 'project', 'Track and resolve blockers'), defaultCap: ModelCapability.Fast },
            { name: 'DeadlineWorker', level: AgentLevel.L8_Worker, specialty: 'co_director.tracking.deadlines', domain: d, area: 'project', promptTemplate: tp('DeadlineWorker', 'project', 'Track deadlines and milestones'), defaultCap: ModelCapability.Fast },
            { name: 'ScopeCreepWorker', level: AgentLevel.L8_Worker, specialty: 'co_director.tracking.scope', domain: d, area: 'project', promptTemplate: tp('ScopeCreepWorker', 'project', 'Detect scope creep'), defaultCap: ModelCapability.Fast },
            { name: 'RiskTrackingWorker', level: AgentLevel.L8_Worker, specialty: 'co_director.tracking.risks', domain: d, area: 'project', promptTemplate: tp('RiskTrackingWorker', 'project', 'Track project risks'), defaultCap: ModelCapability.Fast },
            { name: 'ProjectHealthChecker', level: AgentLevel.L9_Checker, specialty: 'co_director.health.checker', domain: d, area: 'project', promptTemplate: tp('ProjectHealthChecker', 'project', 'Assess overall project health'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'RetroWorker', level: AgentLevel.L8_Worker, specialty: 'co_director.tracking.retro', domain: d, area: 'project', promptTemplate: tp('RetroWorker', 'project', 'Generate retrospective insights'), defaultCap: ModelCapability.Fast },
            { name: 'PriorityQueueWorker', level: AgentLevel.L8_Worker, specialty: 'co_director.backlog.priority', domain: d, area: 'project', promptTemplate: tp('PriorityQueueWorker', 'project', 'Manage priority queue'), defaultCap: ModelCapability.Fast },
            { name: 'SprintGoalWorker', level: AgentLevel.L8_Worker, specialty: 'co_director.sprint.goals', domain: d, area: 'project', promptTemplate: tp('SprintGoalWorker', 'project', 'Define sprint goals'), defaultCap: ModelCapability.Fast },
            { name: 'CapacityWorker', level: AgentLevel.L8_Worker, specialty: 'co_director.sprint.capacity', domain: d, area: 'project', promptTemplate: tp('CapacityWorker', 'project', 'Plan sprint capacity'), defaultCap: ModelCapability.Fast },
            { name: 'RoadmapUpdateWorker', level: AgentLevel.L8_Worker, specialty: 'co_director.roadmap.update', domain: d, area: 'project', promptTemplate: tp('RoadmapUpdateWorker', 'project', 'Update roadmap status'), defaultCap: ModelCapability.Fast },
            { name: 'ScheduleChecker', level: AgentLevel.L9_Checker, specialty: 'co_director.schedule.checker', domain: d, area: 'project', promptTemplate: tp('ScheduleChecker', 'project', 'Verify schedule feasibility'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'FeatureFlagLead', level: AgentLevel.L6_TeamLead, specialty: 'co_director.features', domain: d, area: 'project', promptTemplate: tp('FeatureFlagLead', 'project', 'Lead feature flag management') },
            { name: 'ReleaseTrackWorker', level: AgentLevel.L8_Worker, specialty: 'co_director.tracking.release', domain: d, area: 'project', promptTemplate: tp('ReleaseTrackWorker', 'project', 'Track release readiness'), defaultCap: ModelCapability.Fast },

            // Coordination (~20)
            { name: 'CoordinationManager', level: AgentLevel.L4_Manager, specialty: 'co_director.coordination', domain: d, area: 'coordination', promptTemplate: tp('CoordinationManager', 'coordination', 'Manage team coordination') },
            { name: 'CrossTeamSub', level: AgentLevel.L5_SubManager, specialty: 'co_director.coordination.cross', domain: d, area: 'coordination', promptTemplate: tp('CrossTeamSub', 'coordination', 'Manage cross-team coordination') },
            { name: 'HandoffSub', level: AgentLevel.L5_SubManager, specialty: 'co_director.coordination.handoff', domain: d, area: 'coordination', promptTemplate: tp('HandoffSub', 'coordination', 'Manage task handoff processes') },
            { name: 'ConflictResLead', level: AgentLevel.L6_TeamLead, specialty: 'co_director.coordination.conflicts', domain: d, area: 'coordination', promptTemplate: tp('ConflictResLead', 'coordination', 'Lead conflict resolution') },
            { name: 'MergeConflictWorker', level: AgentLevel.L8_Worker, specialty: 'co_director.coordination.merge', domain: d, area: 'coordination', promptTemplate: tp('MergeConflictWorker', 'coordination', 'Resolve merge conflicts'), defaultCap: ModelCapability.Fast },
            { name: 'TaskAssignmentWorker', level: AgentLevel.L8_Worker, specialty: 'co_director.coordination.assign', domain: d, area: 'coordination', promptTemplate: tp('TaskAssignmentWorker', 'coordination', 'Assign tasks to agents'), defaultCap: ModelCapability.Fast },
            { name: 'ContextSharingWorker', level: AgentLevel.L8_Worker, specialty: 'co_director.coordination.context', domain: d, area: 'coordination', promptTemplate: tp('ContextSharingWorker', 'coordination', 'Share context between agents'), defaultCap: ModelCapability.Fast },
            { name: 'DependencyCoordWorker', level: AgentLevel.L8_Worker, specialty: 'co_director.coordination.deps', domain: d, area: 'coordination', promptTemplate: tp('DependencyCoordWorker', 'coordination', 'Coordinate dependent tasks'), defaultCap: ModelCapability.Fast },
            { name: 'CoordinationChecker', level: AgentLevel.L9_Checker, specialty: 'co_director.coordination.checker', domain: d, area: 'coordination', promptTemplate: tp('CoordinationChecker', 'coordination', 'Verify coordination completeness'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'StatusSyncWorker', level: AgentLevel.L8_Worker, specialty: 'co_director.coordination.sync', domain: d, area: 'coordination', promptTemplate: tp('StatusSyncWorker', 'coordination', 'Synchronize status across agents'), defaultCap: ModelCapability.Fast },

            // Reporting (~20)
            { name: 'ReportingManager', level: AgentLevel.L4_Manager, specialty: 'co_director.reporting', domain: d, area: 'reporting', promptTemplate: tp('ReportingManager', 'reporting', 'Manage progress reporting') },
            { name: 'StatusReportSub', level: AgentLevel.L5_SubManager, specialty: 'co_director.reporting.status', domain: d, area: 'reporting', promptTemplate: tp('StatusReportSub', 'reporting', 'Manage status reports') },
            { name: 'MetricsSub', level: AgentLevel.L5_SubManager, specialty: 'co_director.reporting.metrics', domain: d, area: 'reporting', promptTemplate: tp('MetricsSub', 'reporting', 'Manage project metrics') },
            { name: 'DashboardLead', level: AgentLevel.L6_TeamLead, specialty: 'co_director.reporting.dashboard', domain: d, area: 'reporting', promptTemplate: tp('DashboardLead', 'reporting', 'Lead dashboard creation') },
            { name: 'DailyReportWorker', level: AgentLevel.L8_Worker, specialty: 'co_director.reporting.daily', domain: d, area: 'reporting', promptTemplate: tp('DailyReportWorker', 'reporting', 'Generate daily reports'), defaultCap: ModelCapability.Fast },
            { name: 'WeeklyReportWorker', level: AgentLevel.L8_Worker, specialty: 'co_director.reporting.weekly', domain: d, area: 'reporting', promptTemplate: tp('WeeklyReportWorker', 'reporting', 'Generate weekly reports'), defaultCap: ModelCapability.Fast },
            { name: 'MetricCalcWorker', level: AgentLevel.L8_Worker, specialty: 'co_director.reporting.metrics.calc', domain: d, area: 'reporting', promptTemplate: tp('MetricCalcWorker', 'reporting', 'Calculate project metrics'), defaultCap: ModelCapability.Fast },
            { name: 'TrendAnalysisWorker', level: AgentLevel.L8_Worker, specialty: 'co_director.reporting.trends', domain: d, area: 'reporting', promptTemplate: tp('TrendAnalysisWorker', 'reporting', 'Analyze project trends'), defaultCap: ModelCapability.Fast },
            { name: 'ChangelogGenWorker', level: AgentLevel.L8_Worker, specialty: 'co_director.reporting.changelog', domain: d, area: 'reporting', promptTemplate: tp('ChangelogGenWorker', 'reporting', 'Generate changelogs'), defaultCap: ModelCapability.Fast },
            { name: 'ReportAccuracyChecker', level: AgentLevel.L9_Checker, specialty: 'co_director.reporting.accuracy.checker', domain: d, area: 'reporting', promptTemplate: tp('ReportAccuracyChecker', 'reporting', 'Verify report accuracy'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
        ];
    }

    // ==================== ORCHESTRATOR DOMAIN (~30) ====================

    private buildOrchestratorDomain(): SeedDef[] {
        const d = 'orchestrator';
        const tp = (name: string, area: string, task: string) =>
            `You are ${name}, a specialized {{domain}}.${area} agent. Scope: {{scope}}. Parent context: {{parentContext}}. Task: ${task}`;

        return [
            // Routing (~10)
            { name: 'RoutingManager', level: AgentLevel.L4_Manager, specialty: 'orchestrator.routing', domain: d, area: 'routing', promptTemplate: tp('RoutingManager', 'routing', 'Manage task routing') },
            { name: 'IntentClassifySub', level: AgentLevel.L5_SubManager, specialty: 'orchestrator.routing.intent', domain: d, area: 'routing', promptTemplate: tp('IntentClassifySub', 'routing', 'Classify task intents') },
            { name: 'BranchRoutingLead', level: AgentLevel.L6_TeamLead, specialty: 'orchestrator.routing.branch', domain: d, area: 'routing', promptTemplate: tp('BranchRoutingLead', 'routing', 'Route tasks to branches') },
            { name: 'IntentScoreWorker', level: AgentLevel.L8_Worker, specialty: 'orchestrator.routing.score', domain: d, area: 'routing', promptTemplate: tp('IntentScoreWorker', 'routing', 'Score intent classification'), defaultCap: ModelCapability.Fast },
            { name: 'AgentMatchWorker', level: AgentLevel.L8_Worker, specialty: 'orchestrator.routing.match', domain: d, area: 'routing', promptTemplate: tp('AgentMatchWorker', 'routing', 'Match tasks to agents'), defaultCap: ModelCapability.Fast },
            { name: 'RerouteWorker', level: AgentLevel.L8_Worker, specialty: 'orchestrator.routing.reroute', domain: d, area: 'routing', promptTemplate: tp('RerouteWorker', 'routing', 'Handle task rerouting'), defaultCap: ModelCapability.Fast },
            { name: 'FallbackRoutingWorker', level: AgentLevel.L8_Worker, specialty: 'orchestrator.routing.fallback', domain: d, area: 'routing', promptTemplate: tp('FallbackRoutingWorker', 'routing', 'Handle fallback routing'), defaultCap: ModelCapability.Fast },
            { name: 'RoutingAccuracyChecker', level: AgentLevel.L9_Checker, specialty: 'orchestrator.routing.accuracy.checker', domain: d, area: 'routing', promptTemplate: tp('RoutingAccuracyChecker', 'routing', 'Verify routing accuracy'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'ContextRoutingWorker', level: AgentLevel.L8_Worker, specialty: 'orchestrator.routing.context', domain: d, area: 'routing', promptTemplate: tp('ContextRoutingWorker', 'routing', 'Route based on context'), defaultCap: ModelCapability.Fast },
            { name: 'PriorityRoutingWorker', level: AgentLevel.L8_Worker, specialty: 'orchestrator.routing.priority', domain: d, area: 'routing', promptTemplate: tp('PriorityRoutingWorker', 'routing', 'Route based on priority'), defaultCap: ModelCapability.Fast },

            // Scheduling (~10)
            { name: 'SchedulingManager', level: AgentLevel.L4_Manager, specialty: 'orchestrator.scheduling', domain: d, area: 'scheduling', promptTemplate: tp('SchedulingManager', 'scheduling', 'Manage task scheduling') },
            { name: 'QueueManageSub', level: AgentLevel.L5_SubManager, specialty: 'orchestrator.scheduling.queue', domain: d, area: 'scheduling', promptTemplate: tp('QueueManageSub', 'scheduling', 'Manage task queues') },
            { name: 'PriorityQueueLead', level: AgentLevel.L6_TeamLead, specialty: 'orchestrator.scheduling.priority', domain: d, area: 'scheduling', promptTemplate: tp('PriorityQueueLead', 'scheduling', 'Lead priority queue management') },
            { name: 'QueueReorderWorker', level: AgentLevel.L8_Worker, specialty: 'orchestrator.scheduling.reorder', domain: d, area: 'scheduling', promptTemplate: tp('QueueReorderWorker', 'scheduling', 'Reorder queue by priority'), defaultCap: ModelCapability.Fast },
            { name: 'TimeoutWorker', level: AgentLevel.L8_Worker, specialty: 'orchestrator.scheduling.timeout', domain: d, area: 'scheduling', promptTemplate: tp('TimeoutWorker', 'scheduling', 'Handle task timeouts'), defaultCap: ModelCapability.Fast },
            { name: 'RetryWorker', level: AgentLevel.L8_Worker, specialty: 'orchestrator.scheduling.retry', domain: d, area: 'scheduling', promptTemplate: tp('RetryWorker', 'scheduling', 'Handle task retries'), defaultCap: ModelCapability.Fast },
            { name: 'BatchingWorker', level: AgentLevel.L8_Worker, specialty: 'orchestrator.scheduling.batch', domain: d, area: 'scheduling', promptTemplate: tp('BatchingWorker', 'scheduling', 'Batch related tasks'), defaultCap: ModelCapability.Fast },
            { name: 'ThrottleWorker', level: AgentLevel.L8_Worker, specialty: 'orchestrator.scheduling.throttle', domain: d, area: 'scheduling', promptTemplate: tp('ThrottleWorker', 'scheduling', 'Throttle task execution'), defaultCap: ModelCapability.Fast },
            { name: 'ScheduleOptChecker', level: AgentLevel.L9_Checker, specialty: 'orchestrator.scheduling.opt.checker', domain: d, area: 'scheduling', promptTemplate: tp('ScheduleOptChecker', 'scheduling', 'Verify schedule optimization'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'FairnessWorker', level: AgentLevel.L8_Worker, specialty: 'orchestrator.scheduling.fairness', domain: d, area: 'scheduling', promptTemplate: tp('FairnessWorker', 'scheduling', 'Ensure fair scheduling'), defaultCap: ModelCapability.Fast },

            // Load Balancing (~10)
            { name: 'LoadBalanceManager', level: AgentLevel.L4_Manager, specialty: 'orchestrator.loadbalance', domain: d, area: 'loadbalance', promptTemplate: tp('LoadBalanceManager', 'loadbalance', 'Manage load balancing') },
            { name: 'AgentLoadSub', level: AgentLevel.L5_SubManager, specialty: 'orchestrator.loadbalance.agents', domain: d, area: 'loadbalance', promptTemplate: tp('AgentLoadSub', 'loadbalance', 'Monitor agent load') },
            { name: 'DistributionLead', level: AgentLevel.L6_TeamLead, specialty: 'orchestrator.loadbalance.distribute', domain: d, area: 'loadbalance', promptTemplate: tp('DistributionLead', 'loadbalance', 'Lead work distribution') },
            { name: 'LoadMonitorWorker', level: AgentLevel.L8_Worker, specialty: 'orchestrator.loadbalance.monitor', domain: d, area: 'loadbalance', promptTemplate: tp('LoadMonitorWorker', 'loadbalance', 'Monitor agent workloads'), defaultCap: ModelCapability.Fast },
            { name: 'RebalanceWorker', level: AgentLevel.L8_Worker, specialty: 'orchestrator.loadbalance.rebalance', domain: d, area: 'loadbalance', promptTemplate: tp('RebalanceWorker', 'loadbalance', 'Rebalance agent workloads'), defaultCap: ModelCapability.Fast },
            { name: 'AgentPoolWorker', level: AgentLevel.L8_Worker, specialty: 'orchestrator.loadbalance.pool', domain: d, area: 'loadbalance', promptTemplate: tp('AgentPoolWorker', 'loadbalance', 'Manage agent pool'), defaultCap: ModelCapability.Fast },
            { name: 'SpilloverWorker', level: AgentLevel.L8_Worker, specialty: 'orchestrator.loadbalance.spillover', domain: d, area: 'loadbalance', promptTemplate: tp('SpilloverWorker', 'loadbalance', 'Handle spillover to other branches'), defaultCap: ModelCapability.Fast },
            { name: 'HealthPingWorker', level: AgentLevel.L8_Worker, specialty: 'orchestrator.loadbalance.health', domain: d, area: 'loadbalance', promptTemplate: tp('HealthPingWorker', 'loadbalance', 'Ping agent health'), defaultCap: ModelCapability.Fast },
            { name: 'BalanceChecker', level: AgentLevel.L9_Checker, specialty: 'orchestrator.loadbalance.checker', domain: d, area: 'loadbalance', promptTemplate: tp('BalanceChecker', 'loadbalance', 'Verify load balance fairness'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'AutoScaleWorker', level: AgentLevel.L8_Worker, specialty: 'orchestrator.loadbalance.autoscale', domain: d, area: 'loadbalance', promptTemplate: tp('AutoScaleWorker', 'loadbalance', 'Auto-scale agent pool'), defaultCap: ModelCapability.Fast },
        ];
    }

    // ==================== DATA EXTENDED DOMAIN (~40) ====================

    private buildDataExtendedDomain(): SeedDef[] {
        const d = 'data_ext';
        const tp = (name: string, area: string, task: string) =>
            `You are ${name}, a specialized {{domain}}.${area} agent. Scope: {{scope}}. Parent context: {{parentContext}}. Task: ${task}`;

        return [
            // Analytics (~15)
            { name: 'AnalyticsManager', level: AgentLevel.L4_Manager, specialty: 'data.analytics', domain: d, area: 'analytics', promptTemplate: tp('AnalyticsManager', 'analytics', 'Manage data analytics') },
            { name: 'DashboardDataSub', level: AgentLevel.L5_SubManager, specialty: 'data.analytics.dashboard', domain: d, area: 'analytics', promptTemplate: tp('DashboardDataSub', 'analytics', 'Manage dashboard data') },
            { name: 'ReportDataSub', level: AgentLevel.L5_SubManager, specialty: 'data.analytics.reports', domain: d, area: 'analytics', promptTemplate: tp('ReportDataSub', 'analytics', 'Manage report data') },
            { name: 'KPILead', level: AgentLevel.L6_TeamLead, specialty: 'data.analytics.kpi', domain: d, area: 'analytics', promptTemplate: tp('KPILead', 'analytics', 'Lead KPI definition') },
            { name: 'AggregationWorker', level: AgentLevel.L8_Worker, specialty: 'data.analytics.aggregation', domain: d, area: 'analytics', promptTemplate: tp('AggregationWorker', 'analytics', 'Build data aggregations'), defaultCap: ModelCapability.Fast },
            { name: 'TimeSeriesWorker', level: AgentLevel.L8_Worker, specialty: 'data.analytics.timeseries', domain: d, area: 'analytics', promptTemplate: tp('TimeSeriesWorker', 'analytics', 'Build time series analysis'), defaultCap: ModelCapability.Fast },
            { name: 'FunnelWorker', level: AgentLevel.L8_Worker, specialty: 'data.analytics.funnel', domain: d, area: 'analytics', promptTemplate: tp('FunnelWorker', 'analytics', 'Build funnel analysis'), defaultCap: ModelCapability.Fast },
            { name: 'CohortWorker', level: AgentLevel.L8_Worker, specialty: 'data.analytics.cohort', domain: d, area: 'analytics', promptTemplate: tp('CohortWorker', 'analytics', 'Build cohort analysis'), defaultCap: ModelCapability.Fast },
            { name: 'RetentionWorker', level: AgentLevel.L8_Worker, specialty: 'data.analytics.retention', domain: d, area: 'analytics', promptTemplate: tp('RetentionWorker', 'analytics', 'Build retention analysis'), defaultCap: ModelCapability.Fast },
            { name: 'VisualizationWorker', level: AgentLevel.L8_Worker, specialty: 'data.analytics.visualization', domain: d, area: 'analytics', promptTemplate: tp('VisualizationWorker', 'analytics', 'Create data visualizations'), defaultCap: ModelCapability.Fast },
            { name: 'DataAccuracyChecker', level: AgentLevel.L9_Checker, specialty: 'data.analytics.accuracy.checker', domain: d, area: 'analytics', promptTemplate: tp('DataAccuracyChecker', 'analytics', 'Verify data accuracy'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'EventTrackingWorker', level: AgentLevel.L8_Worker, specialty: 'data.analytics.events', domain: d, area: 'analytics', promptTemplate: tp('EventTrackingWorker', 'analytics', 'Set up event tracking'), defaultCap: ModelCapability.Fast },
            { name: 'ABTestDataWorker', level: AgentLevel.L8_Worker, specialty: 'data.analytics.abtest', domain: d, area: 'analytics', promptTemplate: tp('ABTestDataWorker', 'analytics', 'Analyze A/B test data'), defaultCap: ModelCapability.Fast },
            { name: 'DataQualityChecker', level: AgentLevel.L9_Checker, specialty: 'data.analytics.quality.checker', domain: d, area: 'analytics', promptTemplate: tp('DataQualityChecker', 'analytics', 'Check data quality'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'SegmentationWorker', level: AgentLevel.L8_Worker, specialty: 'data.analytics.segmentation', domain: d, area: 'analytics', promptTemplate: tp('SegmentationWorker', 'analytics', 'Build data segmentation'), defaultCap: ModelCapability.Fast },

            // ETL (~15)
            { name: 'ETLManager', level: AgentLevel.L4_Manager, specialty: 'data.etl', domain: d, area: 'etl', promptTemplate: tp('ETLManager', 'etl', 'Manage ETL pipelines') },
            { name: 'ExtractSub', level: AgentLevel.L5_SubManager, specialty: 'data.etl.extract', domain: d, area: 'etl', promptTemplate: tp('ExtractSub', 'etl', 'Manage data extraction') },
            { name: 'TransformSub', level: AgentLevel.L5_SubManager, specialty: 'data.etl.transform', domain: d, area: 'etl', promptTemplate: tp('TransformSub', 'etl', 'Manage data transformation') },
            { name: 'LoadSub', level: AgentLevel.L5_SubManager, specialty: 'data.etl.load', domain: d, area: 'etl', promptTemplate: tp('LoadSub', 'etl', 'Manage data loading') },
            { name: 'PipelineLead', level: AgentLevel.L6_TeamLead, specialty: 'data.etl.pipeline', domain: d, area: 'etl', promptTemplate: tp('PipelineLead', 'etl', 'Lead pipeline development') },
            { name: 'CSVExtractWorker', level: AgentLevel.L8_Worker, specialty: 'data.etl.extract.csv', domain: d, area: 'etl', promptTemplate: tp('CSVExtractWorker', 'etl', 'Extract data from CSV'), defaultCap: ModelCapability.Fast },
            { name: 'APIExtractWorker', level: AgentLevel.L8_Worker, specialty: 'data.etl.extract.api', domain: d, area: 'etl', promptTemplate: tp('APIExtractWorker', 'etl', 'Extract data from APIs'), defaultCap: ModelCapability.Fast },
            { name: 'CleansingWorker', level: AgentLevel.L8_Worker, specialty: 'data.etl.transform.cleanse', domain: d, area: 'etl', promptTemplate: tp('CleansingWorker', 'etl', 'Cleanse/normalize data'), defaultCap: ModelCapability.Fast },
            { name: 'MappingWorker', level: AgentLevel.L8_Worker, specialty: 'data.etl.transform.mapping', domain: d, area: 'etl', promptTemplate: tp('MappingWorker', 'etl', 'Map data between schemas'), defaultCap: ModelCapability.Fast },
            { name: 'BulkLoadWorker', level: AgentLevel.L8_Worker, specialty: 'data.etl.load.bulk', domain: d, area: 'etl', promptTemplate: tp('BulkLoadWorker', 'etl', 'Bulk load data'), defaultCap: ModelCapability.Fast },
            { name: 'IncrementalLoadWorker', level: AgentLevel.L8_Worker, specialty: 'data.etl.load.incremental', domain: d, area: 'etl', promptTemplate: tp('IncrementalLoadWorker', 'etl', 'Incremental data loading'), defaultCap: ModelCapability.Fast },
            { name: 'ETLValidationChecker', level: AgentLevel.L9_Checker, specialty: 'data.etl.validation.checker', domain: d, area: 'etl', promptTemplate: tp('ETLValidationChecker', 'etl', 'Validate ETL output'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'DataLineageWorker', level: AgentLevel.L8_Worker, specialty: 'data.etl.lineage', domain: d, area: 'etl', promptTemplate: tp('DataLineageWorker', 'etl', 'Track data lineage'), defaultCap: ModelCapability.Fast },
            { name: 'ReconciliationWorker', level: AgentLevel.L8_Worker, specialty: 'data.etl.reconcile', domain: d, area: 'etl', promptTemplate: tp('ReconciliationWorker', 'etl', 'Reconcile source vs target data'), defaultCap: ModelCapability.Fast },
            { name: 'ETLPerformanceChecker', level: AgentLevel.L9_Checker, specialty: 'data.etl.performance.checker', domain: d, area: 'etl', promptTemplate: tp('ETLPerformanceChecker', 'etl', 'Check ETL performance'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },

            // ML (~10)
            { name: 'MLPipelineManager', level: AgentLevel.L4_Manager, specialty: 'data.ml', domain: d, area: 'ml', promptTemplate: tp('MLPipelineManager', 'ml', 'Manage ML data pipelines') },
            { name: 'FeatureEngineerSub', level: AgentLevel.L5_SubManager, specialty: 'data.ml.features', domain: d, area: 'ml', promptTemplate: tp('FeatureEngineerSub', 'ml', 'Manage feature engineering') },
            { name: 'DataPrepLead', level: AgentLevel.L6_TeamLead, specialty: 'data.ml.prep', domain: d, area: 'ml', promptTemplate: tp('DataPrepLead', 'ml', 'Lead ML data preparation') },
            { name: 'FeatureWorker', level: AgentLevel.L8_Worker, specialty: 'data.ml.features.build', domain: d, area: 'ml', promptTemplate: tp('FeatureWorker', 'ml', 'Build ML features'), defaultCap: ModelCapability.Fast },
            { name: 'TrainingDataWorker', level: AgentLevel.L8_Worker, specialty: 'data.ml.training', domain: d, area: 'ml', promptTemplate: tp('TrainingDataWorker', 'ml', 'Prepare training datasets'), defaultCap: ModelCapability.Fast },
            { name: 'ValidationDataWorker', level: AgentLevel.L8_Worker, specialty: 'data.ml.validation', domain: d, area: 'ml', promptTemplate: tp('ValidationDataWorker', 'ml', 'Prepare validation datasets'), defaultCap: ModelCapability.Fast },
            { name: 'DataAugmentWorker', level: AgentLevel.L8_Worker, specialty: 'data.ml.augment', domain: d, area: 'ml', promptTemplate: tp('DataAugmentWorker', 'ml', 'Augment training data'), defaultCap: ModelCapability.Fast },
            { name: 'BiasDetectionWorker', level: AgentLevel.L8_Worker, specialty: 'data.ml.bias', domain: d, area: 'ml', promptTemplate: tp('BiasDetectionWorker', 'ml', 'Detect data bias'), defaultCap: ModelCapability.Fast },
            { name: 'DataDriftChecker', level: AgentLevel.L9_Checker, specialty: 'data.ml.drift.checker', domain: d, area: 'ml', promptTemplate: tp('DataDriftChecker', 'ml', 'Detect data drift'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'DataBalanceChecker', level: AgentLevel.L9_Checker, specialty: 'data.ml.balance.checker', domain: d, area: 'ml', promptTemplate: tp('DataBalanceChecker', 'ml', 'Check dataset balance'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
        ];
    }

    // ==================== CODING EXTENDED DOMAIN (~50) ====================

    private buildCodingExtendedDomain(): SeedDef[] {
        const d = 'code_ext';
        const tp = (name: string, area: string, task: string) =>
            `You are ${name}, a specialized {{domain}}.${area} agent. Scope: {{scope}}. Parent context: {{parentContext}}. Task: ${task}`;

        return [
            // Language-Specific (~20)
            { name: 'TypeScriptManager', level: AgentLevel.L4_Manager, specialty: 'code.lang.typescript', domain: d, area: 'language', promptTemplate: tp('TypeScriptManager', 'language', 'Manage TypeScript development') },
            { name: 'PythonManager', level: AgentLevel.L4_Manager, specialty: 'code.lang.python', domain: d, area: 'language', promptTemplate: tp('PythonManager', 'language', 'Manage Python development') },
            { name: 'TSTypeSub', level: AgentLevel.L5_SubManager, specialty: 'code.lang.typescript.types', domain: d, area: 'language', promptTemplate: tp('TSTypeSub', 'language', 'Manage TypeScript type definitions') },
            { name: 'TSGenericsLead', level: AgentLevel.L6_TeamLead, specialty: 'code.lang.typescript.generics', domain: d, area: 'language', promptTemplate: tp('TSGenericsLead', 'language', 'Lead TypeScript generics development') },
            { name: 'TSDecoratorWorker', level: AgentLevel.L8_Worker, specialty: 'code.lang.typescript.decorators', domain: d, area: 'language', promptTemplate: tp('TSDecoratorWorker', 'language', 'Implement TS decorators'), defaultCap: ModelCapability.Fast },
            { name: 'TSEnumWorker', level: AgentLevel.L8_Worker, specialty: 'code.lang.typescript.enums', domain: d, area: 'language', promptTemplate: tp('TSEnumWorker', 'language', 'Implement TS enums and unions'), defaultCap: ModelCapability.Fast },
            { name: 'TSUtilityTypeWorker', level: AgentLevel.L8_Worker, specialty: 'code.lang.typescript.utility', domain: d, area: 'language', promptTemplate: tp('TSUtilityTypeWorker', 'language', 'Implement TS utility types'), defaultCap: ModelCapability.Fast },
            { name: 'PythonAsyncWorker', level: AgentLevel.L8_Worker, specialty: 'code.lang.python.async', domain: d, area: 'language', promptTemplate: tp('PythonAsyncWorker', 'language', 'Implement Python async/await'), defaultCap: ModelCapability.Fast },
            { name: 'PythonDataClassWorker', level: AgentLevel.L8_Worker, specialty: 'code.lang.python.dataclass', domain: d, area: 'language', promptTemplate: tp('PythonDataClassWorker', 'language', 'Implement Python dataclasses'), defaultCap: ModelCapability.Fast },
            { name: 'GoLangWorker', level: AgentLevel.L8_Worker, specialty: 'code.lang.go', domain: d, area: 'language', promptTemplate: tp('GoLangWorker', 'language', 'Implement Go code'), defaultCap: ModelCapability.Fast },
            { name: 'RustWorker', level: AgentLevel.L8_Worker, specialty: 'code.lang.rust', domain: d, area: 'language', promptTemplate: tp('RustWorker', 'language', 'Implement Rust code'), defaultCap: ModelCapability.Fast },
            { name: 'JavaWorker', level: AgentLevel.L8_Worker, specialty: 'code.lang.java', domain: d, area: 'language', promptTemplate: tp('JavaWorker', 'language', 'Implement Java code'), defaultCap: ModelCapability.Fast },
            { name: 'CSharpWorker', level: AgentLevel.L8_Worker, specialty: 'code.lang.csharp', domain: d, area: 'language', promptTemplate: tp('CSharpWorker', 'language', 'Implement C# code'), defaultCap: ModelCapability.Fast },
            { name: 'TSStrictChecker', level: AgentLevel.L9_Checker, specialty: 'code.lang.typescript.strict.checker', domain: d, area: 'language', promptTemplate: tp('TSStrictChecker', 'language', 'Verify TypeScript strict mode compliance'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'PythonTypeChecker', level: AgentLevel.L9_Checker, specialty: 'code.lang.python.types.checker', domain: d, area: 'language', promptTemplate: tp('PythonTypeChecker', 'language', 'Verify Python type hints'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'SQLLangSub', level: AgentLevel.L5_SubManager, specialty: 'code.lang.sql', domain: d, area: 'language', promptTemplate: tp('SQLLangSub', 'language', 'Manage SQL development') },
            { name: 'BashWorker', level: AgentLevel.L8_Worker, specialty: 'code.lang.bash', domain: d, area: 'language', promptTemplate: tp('BashWorker', 'language', 'Implement Bash scripts'), defaultCap: ModelCapability.Fast },
            { name: 'YAMLWorker', level: AgentLevel.L8_Worker, specialty: 'code.lang.yaml', domain: d, area: 'language', promptTemplate: tp('YAMLWorker', 'language', 'Write YAML configs'), defaultCap: ModelCapability.Fast },
            { name: 'RegexWorker', level: AgentLevel.L8_Worker, specialty: 'code.lang.regex', domain: d, area: 'language', promptTemplate: tp('RegexWorker', 'language', 'Write regular expressions'), defaultCap: ModelCapability.Fast },
            { name: 'GraphQLSchemaWorker', level: AgentLevel.L8_Worker, specialty: 'code.lang.graphql', domain: d, area: 'language', promptTemplate: tp('GraphQLSchemaWorker', 'language', 'Write GraphQL schemas'), defaultCap: ModelCapability.Fast },

            // Framework-Specific (~15)
            { name: 'ReactFrameworkSub', level: AgentLevel.L5_SubManager, specialty: 'code.framework.react', domain: d, area: 'framework', promptTemplate: tp('ReactFrameworkSub', 'framework', 'Manage React framework patterns') },
            { name: 'NextJSSub', level: AgentLevel.L5_SubManager, specialty: 'code.framework.nextjs', domain: d, area: 'framework', promptTemplate: tp('NextJSSub', 'framework', 'Manage Next.js patterns') },
            { name: 'ExpressSub', level: AgentLevel.L5_SubManager, specialty: 'code.framework.express', domain: d, area: 'framework', promptTemplate: tp('ExpressSub', 'framework', 'Manage Express.js patterns') },
            { name: 'ReactHookWorker', level: AgentLevel.L8_Worker, specialty: 'code.framework.react.hooks', domain: d, area: 'framework', promptTemplate: tp('ReactHookWorker', 'framework', 'Implement React hooks'), defaultCap: ModelCapability.Fast },
            { name: 'ReactContextWorker', level: AgentLevel.L8_Worker, specialty: 'code.framework.react.context', domain: d, area: 'framework', promptTemplate: tp('ReactContextWorker', 'framework', 'Implement React context'), defaultCap: ModelCapability.Fast },
            { name: 'SSRWorker', level: AgentLevel.L8_Worker, specialty: 'code.framework.nextjs.ssr', domain: d, area: 'framework', promptTemplate: tp('SSRWorker', 'framework', 'Implement SSR pages'), defaultCap: ModelCapability.Fast },
            { name: 'APIRouteWorker', level: AgentLevel.L8_Worker, specialty: 'code.framework.nextjs.api', domain: d, area: 'framework', promptTemplate: tp('APIRouteWorker', 'framework', 'Implement API routes'), defaultCap: ModelCapability.Fast },
            { name: 'ExpressMiddlewareWorker', level: AgentLevel.L8_Worker, specialty: 'code.framework.express.middleware', domain: d, area: 'framework', promptTemplate: tp('ExpressMiddlewareWorker', 'framework', 'Implement Express middleware'), defaultCap: ModelCapability.Fast },
            { name: 'TailwindWorker', level: AgentLevel.L8_Worker, specialty: 'code.framework.tailwind', domain: d, area: 'framework', promptTemplate: tp('TailwindWorker', 'framework', 'Implement Tailwind CSS'), defaultCap: ModelCapability.Fast },
            { name: 'PrismaWorker', level: AgentLevel.L8_Worker, specialty: 'code.framework.prisma', domain: d, area: 'framework', promptTemplate: tp('PrismaWorker', 'framework', 'Implement Prisma ORM'), defaultCap: ModelCapability.Fast },
            { name: 'JestWorker', level: AgentLevel.L8_Worker, specialty: 'code.framework.jest', domain: d, area: 'framework', promptTemplate: tp('JestWorker', 'framework', 'Write Jest test suites'), defaultCap: ModelCapability.Fast },
            { name: 'VSCodeExtWorker', level: AgentLevel.L8_Worker, specialty: 'code.framework.vscode', domain: d, area: 'framework', promptTemplate: tp('VSCodeExtWorker', 'framework', 'Implement VS Code extension features'), defaultCap: ModelCapability.Fast },
            { name: 'FrameworkPatternChecker', level: AgentLevel.L9_Checker, specialty: 'code.framework.patterns.checker', domain: d, area: 'framework', promptTemplate: tp('FrameworkPatternChecker', 'framework', 'Verify framework pattern usage'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'SocketIOWorker', level: AgentLevel.L8_Worker, specialty: 'code.framework.socketio', domain: d, area: 'framework', promptTemplate: tp('SocketIOWorker', 'framework', 'Implement Socket.IO real-time'), defaultCap: ModelCapability.Fast },
            { name: 'ElectronWorker', level: AgentLevel.L8_Worker, specialty: 'code.framework.electron', domain: d, area: 'framework', promptTemplate: tp('ElectronWorker', 'framework', 'Implement Electron desktop features'), defaultCap: ModelCapability.Fast },

            // DevOps (~15)
            { name: 'DevOpsManager', level: AgentLevel.L4_Manager, specialty: 'code.devops', domain: d, area: 'devops', promptTemplate: tp('DevOpsManager', 'devops', 'Manage DevOps practices') },
            { name: 'CICDSub', level: AgentLevel.L5_SubManager, specialty: 'code.devops.cicd', domain: d, area: 'devops', promptTemplate: tp('CICDSub', 'devops', 'Manage CI/CD pipelines') },
            { name: 'ContainerSub', level: AgentLevel.L5_SubManager, specialty: 'code.devops.containers', domain: d, area: 'devops', promptTemplate: tp('ContainerSub', 'devops', 'Manage containerization') },
            { name: 'PipelineLead', level: AgentLevel.L6_TeamLead, specialty: 'code.devops.pipeline', domain: d, area: 'devops', promptTemplate: tp('PipelineLead', 'devops', 'Lead CI/CD pipeline development') },
            { name: 'GithubActionWorker', level: AgentLevel.L8_Worker, specialty: 'code.devops.github.actions', domain: d, area: 'devops', promptTemplate: tp('GithubActionWorker', 'devops', 'Write GitHub Actions'), defaultCap: ModelCapability.Fast },
            { name: 'DockerComposeWorker', level: AgentLevel.L8_Worker, specialty: 'code.devops.docker.compose', domain: d, area: 'devops', promptTemplate: tp('DockerComposeWorker', 'devops', 'Write Docker Compose files'), defaultCap: ModelCapability.Fast },
            { name: 'HelmChartWorker', level: AgentLevel.L8_Worker, specialty: 'code.devops.helm', domain: d, area: 'devops', promptTemplate: tp('HelmChartWorker', 'devops', 'Write Helm charts'), defaultCap: ModelCapability.Fast },
            { name: 'MonitoringConfigWorker', level: AgentLevel.L8_Worker, specialty: 'code.devops.monitoring', domain: d, area: 'devops', promptTemplate: tp('MonitoringConfigWorker', 'devops', 'Configure monitoring'), defaultCap: ModelCapability.Fast },
            { name: 'AlertConfigWorker', level: AgentLevel.L8_Worker, specialty: 'code.devops.alerts', domain: d, area: 'devops', promptTemplate: tp('AlertConfigWorker', 'devops', 'Configure alerting'), defaultCap: ModelCapability.Fast },
            { name: 'SecretsManageWorker', level: AgentLevel.L8_Worker, specialty: 'code.devops.secrets', domain: d, area: 'devops', promptTemplate: tp('SecretsManageWorker', 'devops', 'Manage secrets configuration'), defaultCap: ModelCapability.Fast },
            { name: 'BackupWorker', level: AgentLevel.L8_Worker, specialty: 'code.devops.backup', domain: d, area: 'devops', promptTemplate: tp('BackupWorker', 'devops', 'Configure backup strategies'), defaultCap: ModelCapability.Fast },
            { name: 'RollbackPlanWorker', level: AgentLevel.L8_Worker, specialty: 'code.devops.rollback', domain: d, area: 'devops', promptTemplate: tp('RollbackPlanWorker', 'devops', 'Create rollback plans'), defaultCap: ModelCapability.Fast },
            { name: 'InfraAsCodeChecker', level: AgentLevel.L9_Checker, specialty: 'code.devops.iac.checker', domain: d, area: 'devops', promptTemplate: tp('InfraAsCodeChecker', 'devops', 'Verify infrastructure as code'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'PipelineSecurityChecker', level: AgentLevel.L9_Checker, specialty: 'code.devops.security.checker', domain: d, area: 'devops', promptTemplate: tp('PipelineSecurityChecker', 'devops', 'Verify pipeline security'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'BluegreenDeployWorker', level: AgentLevel.L8_Worker, specialty: 'code.devops.bluegreen', domain: d, area: 'devops', promptTemplate: tp('BluegreenDeployWorker', 'devops', 'Configure blue-green deployments'), defaultCap: ModelCapability.Fast },
        ];
    }

    // ==================== SECURITY DOMAIN (~30) ====================

    private buildSecurityDomain(): SeedDef[] {
        const d = 'security';
        const tp = (name: string, area: string, task: string) =>
            `You are ${name}, a specialized {{domain}}.${area} agent. Scope: {{scope}}. Parent context: {{parentContext}}. Task: ${task}`;

        return [
            { name: 'SecurityManager', level: AgentLevel.L4_Manager, specialty: 'security.management', domain: d, area: 'management', promptTemplate: tp('SecurityManager', 'management', 'Manage security practices') },
            { name: 'PenTestSub', level: AgentLevel.L5_SubManager, specialty: 'security.pentest', domain: d, area: 'pentest', promptTemplate: tp('PenTestSub', 'pentest', 'Manage penetration testing') },
            { name: 'HardeningSub', level: AgentLevel.L5_SubManager, specialty: 'security.hardening', domain: d, area: 'hardening', promptTemplate: tp('HardeningSub', 'hardening', 'Manage security hardening') },
            { name: 'ThreatModelSub', level: AgentLevel.L5_SubManager, specialty: 'security.threats', domain: d, area: 'threats', promptTemplate: tp('ThreatModelSub', 'threats', 'Manage threat modeling') },
            { name: 'AuthSecurityLead', level: AgentLevel.L6_TeamLead, specialty: 'security.auth', domain: d, area: 'auth', promptTemplate: tp('AuthSecurityLead', 'auth', 'Lead authentication security') },
            { name: 'DataSecurityLead', level: AgentLevel.L6_TeamLead, specialty: 'security.data', domain: d, area: 'data', promptTemplate: tp('DataSecurityLead', 'data', 'Lead data security') },
            { name: 'NetworkSecurityLead', level: AgentLevel.L6_TeamLead, specialty: 'security.network', domain: d, area: 'network', promptTemplate: tp('NetworkSecurityLead', 'network', 'Lead network security') },
            { name: 'OAuthWorker', level: AgentLevel.L8_Worker, specialty: 'security.auth.oauth', domain: d, area: 'auth', promptTemplate: tp('OAuthWorker', 'auth', 'Implement OAuth security'), defaultCap: ModelCapability.Fast },
            { name: 'MFAWorker', level: AgentLevel.L8_Worker, specialty: 'security.auth.mfa', domain: d, area: 'auth', promptTemplate: tp('MFAWorker', 'auth', 'Implement MFA security'), defaultCap: ModelCapability.Fast },
            { name: 'EncryptionAtRestWorker', level: AgentLevel.L8_Worker, specialty: 'security.data.encryption.rest', domain: d, area: 'data', promptTemplate: tp('EncryptionAtRestWorker', 'data', 'Implement encryption at rest'), defaultCap: ModelCapability.Fast },
            { name: 'EncryptionInTransitWorker', level: AgentLevel.L8_Worker, specialty: 'security.data.encryption.transit', domain: d, area: 'data', promptTemplate: tp('EncryptionInTransitWorker', 'data', 'Implement encryption in transit'), defaultCap: ModelCapability.Fast },
            { name: 'InputSanitizeWorker', level: AgentLevel.L8_Worker, specialty: 'security.input.sanitize', domain: d, area: 'input', promptTemplate: tp('InputSanitizeWorker', 'input', 'Implement input sanitization'), defaultCap: ModelCapability.Fast },
            { name: 'CSPWorker', level: AgentLevel.L8_Worker, specialty: 'security.headers.csp', domain: d, area: 'headers', promptTemplate: tp('CSPWorker', 'headers', 'Configure Content Security Policy'), defaultCap: ModelCapability.Fast },
            { name: 'CORSConfigWorker', level: AgentLevel.L8_Worker, specialty: 'security.headers.cors', domain: d, area: 'headers', promptTemplate: tp('CORSConfigWorker', 'headers', 'Configure CORS policy'), defaultCap: ModelCapability.Fast },
            { name: 'APIKeyWorker', level: AgentLevel.L8_Worker, specialty: 'security.auth.apikey', domain: d, area: 'auth', promptTemplate: tp('APIKeyWorker', 'auth', 'Implement API key security'), defaultCap: ModelCapability.Fast },
            { name: 'RBACWorker', level: AgentLevel.L8_Worker, specialty: 'security.auth.rbac', domain: d, area: 'auth', promptTemplate: tp('RBACWorker', 'auth', 'Implement RBAC'), defaultCap: ModelCapability.Fast },
            { name: 'AuditLogWorker', level: AgentLevel.L8_Worker, specialty: 'security.audit.logging', domain: d, area: 'audit', promptTemplate: tp('AuditLogWorker', 'audit', 'Implement security audit logging'), defaultCap: ModelCapability.Fast },
            { name: 'VulnScanWorker', level: AgentLevel.L8_Worker, specialty: 'security.pentest.vulnscan', domain: d, area: 'pentest', promptTemplate: tp('VulnScanWorker', 'pentest', 'Run vulnerability scans'), defaultCap: ModelCapability.Fast },
            { name: 'PrivacyWorker', level: AgentLevel.L8_Worker, specialty: 'security.data.privacy', domain: d, area: 'data', promptTemplate: tp('PrivacyWorker', 'data', 'Implement privacy controls'), defaultCap: ModelCapability.Fast },
            { name: 'ThreatAssessWorker', level: AgentLevel.L8_Worker, specialty: 'security.threats.assess', domain: d, area: 'threats', promptTemplate: tp('ThreatAssessWorker', 'threats', 'Assess security threats'), defaultCap: ModelCapability.Fast },
            { name: 'SecurityAuditChecker', level: AgentLevel.L9_Checker, specialty: 'security.audit.checker', domain: d, area: 'audit', promptTemplate: tp('SecurityAuditChecker', 'audit', 'Full security audit'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'ComplianceSecChecker', level: AgentLevel.L9_Checker, specialty: 'security.compliance.checker', domain: d, area: 'compliance', promptTemplate: tp('ComplianceSecChecker', 'compliance', 'Verify security compliance'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'PenTestReportChecker', level: AgentLevel.L9_Checker, specialty: 'security.pentest.report.checker', domain: d, area: 'pentest', promptTemplate: tp('PenTestReportChecker', 'pentest', 'Verify penetration test results'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
            { name: 'SessionSecurityWorker', level: AgentLevel.L8_Worker, specialty: 'security.auth.session', domain: d, area: 'auth', promptTemplate: tp('SessionSecurityWorker', 'auth', 'Secure session management'), defaultCap: ModelCapability.Fast },
            { name: 'FileUploadSecWorker', level: AgentLevel.L8_Worker, specialty: 'security.input.upload', domain: d, area: 'input', promptTemplate: tp('FileUploadSecWorker', 'input', 'Secure file uploads'), defaultCap: ModelCapability.Fast },
            { name: 'LogInjectionWorker', level: AgentLevel.L8_Worker, specialty: 'security.injection.log', domain: d, area: 'injection', promptTemplate: tp('LogInjectionWorker', 'injection', 'Prevent log injection'), defaultCap: ModelCapability.Fast },
            { name: 'PathTraversalWorker', level: AgentLevel.L8_Worker, specialty: 'security.injection.path', domain: d, area: 'injection', promptTemplate: tp('PathTraversalWorker', 'injection', 'Prevent path traversal'), defaultCap: ModelCapability.Fast },
            { name: 'SSRFWorker', level: AgentLevel.L8_Worker, specialty: 'security.injection.ssrf', domain: d, area: 'injection', promptTemplate: tp('SSRFWorker', 'injection', 'Prevent SSRF attacks'), defaultCap: ModelCapability.Fast },
            { name: 'SupplyChainWorker', level: AgentLevel.L8_Worker, specialty: 'security.supply.chain', domain: d, area: 'supply', promptTemplate: tp('SupplyChainWorker', 'supply', 'Analyze supply chain security'), defaultCap: ModelCapability.Fast },
            { name: 'HardeningChecker', level: AgentLevel.L9_Checker, specialty: 'security.hardening.checker', domain: d, area: 'hardening', promptTemplate: tp('HardeningChecker', 'hardening', 'Verify security hardening'), defaultCap: ModelCapability.Reasoning, requiredCap: ModelCapability.Reasoning },
        ];
    }
}
