/**
 * NicheAgentFactory — v9.0 Niche Agent Spawner
 *
 * Creates and configures niche agent instances from `niche_agent_definitions`.
 * Seeds ~230 niche agent definitions across 4 domains (Code, Design, Data, Docs)
 * on first run. Provides AI-assisted agent selection for tasks.
 *
 * Distribution:
 *   Code Domain (~100): FE ~35, BE ~35, Testing ~15, Infra ~15
 *   Design Domain (~60): UIDesign ~25, UXDesign ~20, Brand ~15
 *   Data Domain (~40): Schema ~15, Migration ~10, Seed ~8, Query ~7
 *   Docs Domain (~30): APIDocs ~12, UserDocs ~10, InternalDocs ~8
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
     * Populate ~230 niche agent definitions on first run.
     * Idempotent — skips if definitions already exist.
     *
     * Code Domain (~100): FE ~35, BE ~35, Testing ~15, Infra ~15
     * Design Domain (~60): UIDesign ~25, UXDesign ~20, Brand ~15
     * Data Domain (~40): Schema ~15, Migration ~10, Seed ~8, Query ~7
     * Docs Domain (~30): APIDocs ~12, UserDocs ~10, InternalDocs ~8
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
     * Build all ~230 niche agent definitions.
     */
    private buildAllDefinitions(): SeedDef[] {
        return [
            ...this.buildCodeDomain(),
            ...this.buildDesignDomain(),
            ...this.buildDataDomain(),
            ...this.buildDocsDomain(),
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
}
