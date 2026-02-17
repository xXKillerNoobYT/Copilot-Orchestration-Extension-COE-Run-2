import { BaseAgent } from './base-agent';
import { AgentType, AgentContext, AgentResponse, BackendArchitectMode, BackendQAScore, BackendElement } from '../types';

/**
 * Backend Architect Agent — Agent #17
 *
 * Reviews, generates, and scores back-end architecture designs.
 * Parallel to the FrontendArchitectAgent for front-end design.
 *
 * 8 Scoring Categories (100 total):
 *   - API RESTfulness (0-15)
 *   - DB Normalization (0-15)
 *   - Service Separation (0-15)
 *   - Auth & Security (0-15)
 *   - Error Handling (0-10)
 *   - Caching Strategy (0-10)
 *   - Scalability (0-10)
 *   - Documentation (0-10)
 *
 * 3 Operating Modes:
 *   - auto_generate: Reads plan + FE + data models → generates full BE architecture
 *   - scaffold: Generates basic structure, user fills details
 *   - suggest: Watches design, suggests improvements as review items
 */
export class BackendArchitectAgent extends BaseAgent {
    readonly name = 'Backend Architect';
    readonly type = AgentType.BackendArchitect;
    readonly systemPrompt = `You are the Backend Architect agent for the Copilot Orchestration Extension (COE).

## YOUR ONE JOB
Review and score back-end architecture quality, OR generate back-end architecture from plan requirements.

## WHAT YOU RECEIVE
A complete design context including all backend elements (API routes, DB tables, services, controllers, middleware, auth layers, background jobs, cache strategies, queues), data models, and the original plan requirements.

## SCORING CRITERIA (for review mode)
- API RESTfulness (0-15 points): proper HTTP methods, resource naming, status codes, versioning
- DB Normalization (0-15 points): proper table structure, indexes, foreign keys, no redundancy
- Service Separation (0-15 points): single responsibility, dependency injection, clean boundaries
- Auth & Security (0-15 points): authentication coverage, authorization layers, input validation
- Error Handling (0-10 points): consistent error responses, proper status codes, logging
- Caching Strategy (0-10 points): appropriate cache layers, TTL settings, invalidation
- Scalability (0-10 points): horizontal scaling readiness, statelessness, queue usage
- Documentation (0-10 points): API documentation, schema docs, service descriptions

## RULES
1. Score EVERY category independently. Do not inflate or deflate.
2. If a category has zero data (e.g. no cache defined), score it 0 and note it as a finding.
3. Every finding must include a concrete recommendation — never say "consider improving" without saying HOW.
4. The overall_score MUST equal the sum of all category_scores.
5. Findings must reference specific elements by name and type.

## REQUIRED JSON OUTPUT (review mode)
Respond with ONLY valid JSON. No markdown, no explanation.

{
    "overall_score": <0-100>,
    "category_scores": {
        "api_restfulness": <0-15>,
        "db_normalization": <0-15>,
        "service_separation": <0-15>,
        "auth_security": <0-15>,
        "error_handling": <0-10>,
        "caching_strategy": <0-10>,
        "scalability": <0-10>,
        "documentation": <0-10>
    },
    "findings": [
        {
            "category": "api_restfulness|db_normalization|service_separation|auth_security|error_handling|caching_strategy|scalability|documentation",
            "severity": "critical|major|minor",
            "element_name": "<element>",
            "element_type": "<type>",
            "title": "<short title>",
            "description": "<what's wrong>",
            "recommendation": "<how to fix>"
        }
    ],
    "assessment": "<overall assessment paragraph>",
    "recommendations": ["<top recommendations>"]
}

## REQUIRED JSON OUTPUT (generate/scaffold mode)
{
    "elements": [
        {
            "type": "api_route|db_table|service|controller|middleware|auth_layer|background_job|cache_strategy|queue_definition",
            "name": "<element name>",
            "domain": "<domain/feature group>",
            "layer": "<presentation|business|data|infrastructure>",
            "config": { ... },
            "connections": [
                { "target_name": "<name>", "target_type": "<type>", "relationship": "<description>" }
            ]
        }
    ],
    "summary": "<what was generated and why>"
}

## EXAMPLES

Example 1 — High quality BE architecture (score 82):
{
    "overall_score": 82,
    "category_scores": { "api_restfulness": 14, "db_normalization": 13, "service_separation": 12, "auth_security": 13, "error_handling": 8, "caching_strategy": 7, "scalability": 8, "documentation": 7 },
    "findings": [
        {
            "category": "caching_strategy",
            "severity": "minor",
            "element_name": "User Profile Route",
            "element_type": "api_route",
            "title": "No cache TTL on frequently accessed endpoint",
            "description": "The user profile endpoint is accessed frequently but has no caching configured.",
            "recommendation": "Add a cache_strategy element with 300s TTL for the /api/users/:id endpoint and invalidate on user update."
        }
    ],
    "assessment": "The backend architecture demonstrates strong API design with proper RESTful conventions. Service separation is well-structured with clear domain boundaries. Minor caching improvements recommended.",
    "recommendations": ["Add caching to high-traffic read endpoints", "Add API documentation for all public endpoints"]
}

Example 2 — Low quality BE architecture (score 28):
{
    "overall_score": 28,
    "category_scores": { "api_restfulness": 5, "db_normalization": 6, "service_separation": 4, "auth_security": 3, "error_handling": 3, "caching_strategy": 2, "scalability": 3, "documentation": 2 },
    "findings": [
        {
            "category": "auth_security",
            "severity": "critical",
            "element_name": "Admin Routes",
            "element_type": "api_route",
            "title": "Admin endpoints have no auth middleware",
            "description": "Routes under /api/admin/ have no authentication or authorization middleware attached.",
            "recommendation": "Add an auth_layer element with role-based access control and attach it as middleware to all /api/admin/* routes."
        },
        {
            "category": "db_normalization",
            "severity": "major",
            "element_name": "Orders Table",
            "element_type": "db_table",
            "title": "Denormalized customer data in orders table",
            "description": "The orders table stores customer_name, customer_email, and customer_address directly instead of referencing the customers table.",
            "recommendation": "Remove duplicated customer fields. Add a customer_id foreign key referencing the customers table."
        }
    ],
    "assessment": "The backend architecture is incomplete. Most API routes lack auth, database tables have normalization issues, and there is no caching or documentation.",
    "recommendations": ["Add authentication middleware to all non-public routes", "Normalize database tables by removing redundant data", "Define a caching strategy for read-heavy endpoints", "Add OpenAPI documentation for all endpoints"]
}`;

    protected async parseResponse(raw: string, _context: AgentContext): Promise<AgentResponse> {
        let content = raw;
        let actions: AgentResponse['actions'] = [];

        try {
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);

                // Detect if this is a review response (has overall_score) or generate response (has elements)
                if (parsed.overall_score !== undefined) {
                    const score = parsed.overall_score ?? 0;
                    content = `Backend Architecture Review Score: ${score}/100\n\n${parsed.assessment || ''}\n\nFindings: ${(parsed.findings || []).length}\nRecommendations: ${(parsed.recommendations || []).join(', ')}`;
                    actions = (parsed.findings || []).map(function (f: any) {
                        return {
                            type: 'backend_finding',
                            description: '[' + f.severity + '] ' + f.title + ': ' + f.description,
                            data: f,
                        };
                    });
                } else if (parsed.elements) {
                    const elementCount = (parsed.elements || []).length;
                    content = `Backend Architecture Generated: ${elementCount} elements\n\n${parsed.summary || ''}`;
                    actions = (parsed.elements || []).map(function (e: any) {
                        return {
                            type: 'backend_element_generated',
                            description: e.type + ': ' + e.name + ' (' + e.domain + '/' + e.layer + ')',
                            data: e,
                        };
                    });
                }
            }
        } catch {
            /* use raw content */
        }

        return { content, actions };
    }

    /**
     * Review the complete backend architecture for a plan and produce a quality score.
     * Fetches all backend elements from the database, builds a rich context string,
     * and sends it to the LLM for evaluation.
     */
    async reviewBackend(planId: string): Promise<AgentResponse> {
        const plan = this.database.getPlan(planId);
        if (!plan) {
            return { content: `Plan not found: ${planId}` };
        }

        const elements = this.database.getBackendElementsByPlan(planId);
        const dataModels = this.database.getDataModelsByPlan(planId);

        let planConfig: Record<string, unknown> = {};
        try { planConfig = JSON.parse(plan.config_json || '{}'); } catch { /* ignore */ }

        // Build backend context description
        const sections: string[] = [];

        sections.push('=== PLAN OVERVIEW ===');
        sections.push('Plan: ' + plan.name);
        sections.push('Scale: ' + (planConfig.scale || 'MVP'));
        sections.push('Focus: ' + (planConfig.focus || 'Full Stack'));

        // Group elements by type
        const byType: Record<string, BackendElement[]> = {};
        for (const el of elements) {
            if (!byType[el.type]) { byType[el.type] = []; }
            byType[el.type].push(el);
        }

        sections.push('');
        sections.push('=== BACKEND ELEMENTS (' + elements.length + ') ===');

        const typeLabels: Record<string, string> = {
            api_route: 'API Routes',
            db_table: 'Database Tables',
            service: 'Services',
            controller: 'Controllers',
            middleware: 'Middleware',
            auth_layer: 'Auth Layers',
            background_job: 'Background Jobs',
            cache_strategy: 'Cache Strategies',
            queue_definition: 'Queue Definitions',
        };

        for (const [type, label] of Object.entries(typeLabels)) {
            const typeElements = byType[type] || [];
            if (typeElements.length > 0) {
                sections.push('');
                sections.push('--- ' + label + ' (' + typeElements.length + ') ---');
                for (const el of typeElements) {
                    const draft = el.is_draft ? ' [DRAFT]' : '';
                    const config = el.config_json ? JSON.stringify(JSON.parse(el.config_json), null, 0).substring(0, 200) : 'none';
                    sections.push('  - ' + el.name + draft + ' (domain: ' + (el.domain || 'unassigned') + ', layer: ' + (el.layer || 'unassigned') + ')');
                    sections.push('    config: ' + config);
                }
            }
        }

        sections.push('');
        sections.push('=== DATA MODELS (' + dataModels.length + ') ===');
        for (const m of dataModels) {
            sections.push('  - ' + m.name + ': ' + m.fields.length + ' fields, ' + m.relationships.length + ' relationships');
            for (const f of m.fields) {
                sections.push('      field: ' + f.name + ' (' + f.type + ')' + (f.required ? ' [required]' : ''));
            }
        }

        const designDesc = sections.join('\n');

        const prompt = 'Review the following backend architecture specification and score its quality across all eight categories. Identify specific issues and provide actionable recommendations.\n\n' + designDesc;

        const context: AgentContext = { conversationHistory: [], plan };
        return this.processMessage(prompt, context);
    }

    /**
     * Generate backend architecture from plan requirements, FE design, and data models.
     *
     * @param planId - The plan to generate architecture for
     * @param mode - Generation mode: auto_generate, scaffold, or suggest
     * @returns Generated elements as AgentResponse with actions
     */
    async generateArchitecture(planId: string, mode: BackendArchitectMode): Promise<AgentResponse> {
        const plan = this.database.getPlan(planId);
        if (!plan) {
            return { content: `Plan not found: ${planId}` };
        }

        const pages = this.database.getDesignPagesByPlan(planId);
        const components = this.database.getDesignComponentsByPlan(planId);
        const dataModels = this.database.getDataModelsByPlan(planId);
        const existingElements = this.database.getBackendElementsByPlan(planId);

        let planConfig: Record<string, unknown> = {};
        try { planConfig = JSON.parse(plan.config_json || '{}'); } catch { /* ignore */ }

        const sections: string[] = [];

        sections.push('=== GENERATION MODE: ' + mode.toUpperCase() + ' ===');
        if (mode === 'auto_generate') {
            sections.push('Generate a complete backend architecture with all necessary elements.');
        } else if (mode === 'scaffold') {
            sections.push('Generate a basic backend structure with placeholder details for the user to fill in.');
        } else {
            sections.push('Suggest improvements and additions to the existing backend architecture.');
        }

        sections.push('');
        sections.push('=== PLAN ===');
        sections.push('Name: ' + plan.name);
        sections.push('Config: ' + (plan.config_json || '{}'));

        sections.push('');
        sections.push('=== FRONTEND PAGES (' + pages.length + ') ===');
        for (const p of pages) {
            sections.push('- ' + p.name + ' (route: ' + p.route + ')');
        }

        sections.push('');
        sections.push('=== FRONTEND COMPONENTS (' + components.length + ') ===');
        for (const p of pages) {
            var pageComps = components.filter(function (c) { return c.page_id === p.id; });
            if (pageComps.length > 0) {
                sections.push('Page "' + p.name + '":');
                for (const c of pageComps) {
                    sections.push('  - ' + c.type + ': "' + c.name + '"' + (c.content ? ' content="' + c.content.substring(0, 40) + '"' : ''));
                }
            }
        }

        sections.push('');
        sections.push('=== DATA MODELS (' + dataModels.length + ') ===');
        for (const m of dataModels) {
            sections.push('- ' + m.name + ': ' + m.fields.length + ' fields');
            for (const f of m.fields) {
                sections.push('    ' + f.name + ' (' + f.type + ')' + (f.required ? ' [required]' : ''));
            }
            for (const r of m.relationships) {
                sections.push('    → ' + r.type + ' relationship to ' + r.target_model_id);
            }
        }

        if (existingElements.length > 0) {
            sections.push('');
            sections.push('=== EXISTING BACKEND ELEMENTS (' + existingElements.length + ') ===');
            for (const el of existingElements) {
                sections.push('- [' + el.type + '] ' + el.name + ' (domain: ' + (el.domain || 'none') + ')');
            }
        }

        const prompt = 'Based on the plan requirements, frontend design, and data models, generate the backend architecture elements. Follow the output format specified in your instructions.\n\n' + sections.join('\n');

        const context: AgentContext = { conversationHistory: [], plan };
        return this.processMessage(prompt, context);
    }

    /**
     * Suggest connections/links between backend elements and frontend elements.
     * Returns AI-suggested links for the Link Manager to process.
     */
    async suggestConnections(planId: string): Promise<AgentResponse> {
        const plan = this.database.getPlan(planId);
        if (!plan) {
            return { content: `Plan not found: ${planId}` };
        }

        const pages = this.database.getDesignPagesByPlan(planId);
        const components = this.database.getDesignComponentsByPlan(planId);
        const backendElements = this.database.getBackendElementsByPlan(planId);
        const dataModels = this.database.getDataModelsByPlan(planId);

        const sections: string[] = [];

        sections.push('=== SUGGEST CONNECTIONS ===');
        sections.push('Analyze the frontend and backend elements and suggest connections between them.');
        sections.push('Connection types: fe_to_fe, be_to_be, fe_to_be, be_to_fe');
        sections.push('');

        sections.push('=== FRONTEND PAGES & COMPONENTS ===');
        for (const p of pages) {
            var pageComps = components.filter(function (c) { return c.page_id === p.id; });
            sections.push('Page "' + p.name + '" (id: ' + p.id + '):');
            for (const c of pageComps) {
                sections.push('  - ' + c.type + ': "' + c.name + '" (id: ' + c.id + ')');
            }
        }

        sections.push('');
        sections.push('=== BACKEND ELEMENTS ===');
        for (const el of backendElements) {
            sections.push('- [' + el.type + '] "' + el.name + '" (id: ' + el.id + ', domain: ' + (el.domain || 'none') + ')');
        }

        sections.push('');
        sections.push('=== DATA MODELS ===');
        for (const m of dataModels) {
            sections.push('- "' + m.name + '" (id: ' + m.id + '): bound_components=' + (m.bound_components.join(', ') || 'none'));
        }

        const prompt = `Analyze the frontend and backend elements and suggest meaningful connections.

For each suggested connection, provide:
{
    "suggestions": [
        {
            "link_type": "fe_to_fe|be_to_be|fe_to_be|be_to_fe",
            "from_type": "page|component|backend_element|data_model",
            "from_id": "<id>",
            "from_name": "<name>",
            "to_type": "page|component|backend_element|data_model",
            "to_id": "<id>",
            "to_name": "<name>",
            "label": "<relationship description>",
            "confidence": <0.0-1.0>,
            "reasoning": "<why this connection exists>"
        }
    ],
    "summary": "<overall connection analysis>"
}

` + sections.join('\n');

        const context: AgentContext = { conversationHistory: [], plan };
        return this.processMessage(prompt, context);
    }
}
