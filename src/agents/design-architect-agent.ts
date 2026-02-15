import { BaseAgent } from './base-agent';
import { AgentType, AgentContext, AgentResponse } from '../types';

/**
 * Design Architect Agent — Reviews overall design structure and scores quality.
 *
 * This agent evaluates a visual design specification across six categories:
 * - Page hierarchy and navigation flow
 * - Component completeness per page
 * - Layout and positioning quality
 * - Design token consistency
 * - Data binding coverage
 * - User flow completeness
 *
 * It produces a 0-100 quality score with per-category breakdowns,
 * detailed findings, and actionable recommendations.
 */
export class DesignArchitectAgent extends BaseAgent {
    readonly name = 'Design Architect';
    readonly type = AgentType.DesignArchitect;
    readonly systemPrompt = `You are the Design Architect agent for the Copilot Orchestration Extension (COE).

## YOUR ONE JOB
Review the overall design structure and score its quality.

## WHAT YOU RECEIVE
A complete design context including all pages, components, data models, design tokens, user flows, and the original plan requirements.

## SCORING CRITERIA
- Page hierarchy and navigation flow (0-20 points)
- Component completeness per page (0-20 points)
- Layout and positioning quality (0-20 points)
- Design token consistency (0-15 points)
- Data binding coverage (0-15 points)
- User flow completeness (0-10 points)

## RULES
1. Score EVERY category independently. Do not inflate or deflate.
2. If a category has zero data (e.g. no tokens defined), score it 0 and note it as a finding.
3. Every finding must include a concrete recommendation — never say "consider improving" without saying HOW.
4. The design_score MUST equal the sum of all category_scores.
5. Findings must reference specific pages and components by name.

## REQUIRED JSON OUTPUT
Respond with ONLY valid JSON. No markdown, no explanation.

{
    "design_score": <0-100>,
    "category_scores": { "hierarchy": <0-20>, "components": <0-20>, "layout": <0-20>, "tokens": <0-15>, "data_binding": <0-15>, "user_flow": <0-10> },
    "findings": [
        {
            "category": "hierarchy|components|layout|tokens|data_binding|user_flow",
            "severity": "critical|major|minor",
            "page_name": "<page>",
            "title": "<short title>",
            "description": "<what's wrong>",
            "recommendation": "<how to fix>"
        }
    ],
    "structure_assessment": "<overall assessment paragraph>",
    "recommendations": ["<top recommendations>"]
}

## EXAMPLES

Example 1 — High quality design (score 85):
{
    "design_score": 85,
    "category_scores": { "hierarchy": 18, "components": 17, "layout": 18, "tokens": 12, "data_binding": 12, "user_flow": 8 },
    "findings": [
        {
            "category": "tokens",
            "severity": "minor",
            "page_name": "Settings",
            "title": "Hardcoded color on Settings header",
            "description": "The Settings page header uses #333333 instead of a design token.",
            "recommendation": "Replace #333333 with the 'surface-secondary' token value."
        }
    ],
    "structure_assessment": "The design demonstrates strong page hierarchy with clear navigation. Component coverage is thorough across all pages. Minor token consistency issues on the Settings page.",
    "recommendations": ["Replace hardcoded colors with design tokens on Settings page", "Add error state components to form pages"]
}

Example 2 — Low quality design (score 32):
{
    "design_score": 32,
    "category_scores": { "hierarchy": 8, "components": 6, "layout": 10, "tokens": 2, "data_binding": 4, "user_flow": 2 },
    "findings": [
        {
            "category": "hierarchy",
            "severity": "critical",
            "page_name": "Dashboard",
            "title": "No navigation to child pages",
            "description": "Dashboard has 3 child pages but no nav component linking to them.",
            "recommendation": "Add a sidebar or tab nav component with links to Reports, Analytics, and Settings."
        },
        {
            "category": "data_binding",
            "severity": "major",
            "page_name": "Users",
            "title": "Table component not bound to User model",
            "description": "The Users page has a table component but it is not bound to the User data model.",
            "recommendation": "Bind the table component's data source to the User data model and map columns to User fields."
        }
    ],
    "structure_assessment": "The design is incomplete. Most pages lack sufficient components, navigation is disconnected, and design tokens are barely defined. Data binding is sparse.",
    "recommendations": ["Define a complete set of design tokens before adding more components", "Add navigation components to every page", "Bind all data-display components to their data models"]
}`;

    protected async parseResponse(raw: string, _context: AgentContext): Promise<AgentResponse> {
        let content = raw;
        let actions: AgentResponse['actions'] = [];

        try {
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                const score = parsed.design_score ?? 0;
                content = `Design Review Score: ${score}/100\n\n${parsed.structure_assessment || ''}\n\nFindings: ${(parsed.findings || []).length}\nRecommendations: ${(parsed.recommendations || []).join(', ')}`;
                actions = (parsed.findings || []).map(function (f: any) {
                    return {
                        type: 'design_finding',
                        description: '[' + f.severity + '] ' + f.title + ': ' + f.description,
                        data: f,
                    };
                });
            }
        } catch {
            /* use raw content */
        }

        return { content, actions };
    }

    /**
     * Review the complete design for a plan and produce a quality score.
     * Fetches all design data from the database, builds a rich context string,
     * and sends it to the LLM for evaluation.
     */
    async reviewDesign(planId: string): Promise<AgentResponse> {
        const plan = this.database.getPlan(planId);
        if (!plan) {
            return { content: `Plan not found: ${planId}` };
        }

        const pages = this.database.getDesignPagesByPlan(planId);
        const allComponents = this.database.getDesignComponentsByPlan(planId);
        const tokens = this.database.getDesignTokensByPlan(planId);
        const dataModels = this.database.getDataModelsByPlan(planId);

        let planConfig: Record<string, unknown> = {};
        try { planConfig = JSON.parse(plan.config_json || '{}'); } catch { /* ignore */ }
        const design = (planConfig.design || {}) as Record<string, unknown>;

        // Build design context description
        const sections: string[] = [];

        sections.push('=== PLAN OVERVIEW ===');
        sections.push('Plan: ' + plan.name);
        sections.push('Scale: ' + (planConfig.scale || 'MVP'));
        sections.push('Focus: ' + (planConfig.focus || 'Full Stack'));
        sections.push('Layout: ' + (design.layout || 'sidebar'));
        sections.push('Theme: ' + (design.theme || 'dark'));

        sections.push('');
        sections.push('=== PAGES (' + pages.length + ') ===');
        for (const p of pages) {
            const depth = p.depth || 0;
            const indent = '  '.repeat(depth);
            sections.push(indent + '- ' + p.name + ' (route: ' + p.route + ', size: ' + p.width + 'x' + p.height + ', depth: ' + depth + ')');
        }

        sections.push('');
        sections.push('=== COMPONENTS (' + allComponents.length + ') ===');
        for (const p of pages) {
            const pageComps = allComponents.filter(function (c) { return c.page_id === p.id; });
            sections.push('Page "' + p.name + '" (' + pageComps.length + ' components):');
            for (const c of pageComps) {
                const contentSnippet = c.content ? ' content="' + c.content.substring(0, 60) + '"' : '';
                sections.push('  - ' + c.type + ': "' + c.name + '" at (' + c.x + ', ' + c.y + ') ' + c.width + 'x' + c.height + contentSnippet);
            }
        }

        sections.push('');
        sections.push('=== DESIGN TOKENS (' + tokens.length + ') ===');
        for (const t of tokens) {
            sections.push('  - [' + t.category + '] ' + t.name + ': ' + t.value + (t.description ? ' (' + t.description + ')' : ''));
        }

        sections.push('');
        sections.push('=== DATA MODELS (' + dataModels.length + ') ===');
        for (const m of dataModels) {
            sections.push('  - ' + m.name + ': ' + m.fields.length + ' fields, ' + m.relationships.length + ' relationships');
            for (const f of m.fields) {
                sections.push('      field: ' + f.name + ' (' + f.type + ')' + (f.required ? ' [required]' : ''));
            }
            if (m.bound_components.length > 0) {
                sections.push('      bound to components: ' + m.bound_components.join(', '));
            }
        }

        const designDesc = sections.join('\n');

        const prompt = 'Review the following design specification and score its quality across all six categories. Identify specific issues and provide actionable recommendations.\n\n' + designDesc;

        const context: AgentContext = { conversationHistory: [], plan };
        return this.processMessage(prompt, context);
    }
}
