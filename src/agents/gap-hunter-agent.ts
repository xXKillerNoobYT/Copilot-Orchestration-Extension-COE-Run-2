import { BaseAgent } from './base-agent';
import { AgentType, AgentContext, AgentResponse, DesignGap, DesignGapAnalysis, DesignGapFix, BackendElement } from '../types';

/**
 * Gap Hunter Agent — Finds missing pages, components, flows, and UX gaps in a design.
 *
 * Uses a hybrid approach:
 * 1. Deterministic checks (15 pure-function checks — reliable, no LLM cost)
 * 2. LLM analysis for nuanced gaps that deterministic checks cannot catch
 *
 * Each deterministic check returns an array of DesignGap objects.
 * If no critical deterministic gaps are found, the LLM is called for deeper analysis.
 * Results are merged into a single DesignGapAnalysis.
 */
export class GapHunterAgent extends BaseAgent {
    readonly name = 'Gap Hunter';
    readonly type = AgentType.GapHunter;
    readonly systemPrompt = `YOUR ONE JOB: Analyze a design and find missing pages, components, flows, and UX gaps that deterministic checks cannot catch.

WHAT YOU RECEIVE: A design context with all pages, components, data models, tokens, and the plan requirements. You also receive the list of gaps already found by deterministic analysis.

RULES:
1. Focus on gaps the deterministic checks missed — user flow gaps, missing interaction patterns, missing edge-case pages.
2. Consider the plan's requirements when evaluating completeness.
3. Each gap must have a concrete suggested fix with component type and approximate position.
4. Mark severity: critical (blocks core functionality), major (degrades UX), minor (nice-to-have).

REQUIRED JSON OUTPUT:
{
    "additional_gaps": [
        {
            "category": "missing_component|missing_nav|missing_page|missing_state|incomplete_flow|accessibility|responsive|user_story_gap|data_binding",
            "severity": "critical|major|minor",
            "page_id": "<id or null>",
            "page_name": "<name or null>",
            "title": "<short title>",
            "description": "<what's missing>",
            "related_requirement": "<optional>",
            "suggested_fix": {
                "action": "add_component|add_page|modify_component|add_navigation|flag_review",
                "target_page_id": "<id or null>",
                "component_type": "<type or null>",
                "component_name": "<name>",
                "properties": {},
                "position": { "x": 0, "y": 0, "width": 200, "height": 50 }
            }
        }
    ],
    "coverage_assessment": "<paragraph>"
}`;

    protected async parseResponse(raw: string, _context: AgentContext): Promise<AgentResponse> {
        let content = raw;
        const actions: AgentResponse['actions'] = [];

        try {
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                const gapCount = (parsed.additional_gaps || []).length;
                content = `LLM Gap Analysis: ${gapCount} additional gaps found.\n\n${parsed.coverage_assessment || ''}`;

                for (const g of (parsed.additional_gaps || [])) {
                    actions.push({
                        type: 'log',
                        payload: {
                            gap_category: g.category,
                            gap_severity: g.severity,
                            gap_title: g.title,
                            gap_description: g.description,
                            suggested_fix: g.suggested_fix,
                        },
                    });
                }
            }
        } catch {
            /* use raw content on parse failure */
        }

        return { content, actions };
    }

    /**
     * Analyze a plan's design for gaps using deterministic checks + optional LLM analysis.
     */
    async analyzeGaps(planId: string): Promise<DesignGapAnalysis> {
        const plan = this.database.getPlan(planId);
        if (!plan) {
            return {
                plan_id: planId,
                analysis_timestamp: new Date().toISOString(),
                overall_score: 0,
                gaps: [],
                summary: 'Plan not found: ' + planId,
                pages_analyzed: 0,
                components_analyzed: 0,
            };
        }

        const pages = this.database.getDesignPagesByPlan(planId);
        const allComponents = this.database.getDesignComponentsByPlan(planId);
        const dataModels = this.database.getDataModelsByPlan(planId);

        let planConfig: Record<string, unknown> = {};
        try { planConfig = JSON.parse(plan.config_json || '{}'); } catch { /* ignore */ }

        // Build lookup structures
        const componentsByPage: Record<string, typeof allComponents> = {};
        for (const page of pages) {
            componentsByPage[page.id] = [];
        }
        for (const comp of allComponents) {
            if (comp.page_id && componentsByPage[comp.page_id]) {
                componentsByPage[comp.page_id].push(comp);
            }
        }

        // Get page flows for navigation checks
        let pageFlows: Array<{ from_page_id: string; to_page_id: string }> = [];
        try {
            pageFlows = this.database.getPageFlowsByPlan(planId);
        } catch {
            /* flows table may not exist yet */
        }

        // --- Run all 15 deterministic checks ---
        const deterministicGaps: DesignGap[] = [];

        // Check 1: Page has 0 components
        for (const page of pages) {
            const pageComps = componentsByPage[page.id] || [];
            if (pageComps.length === 0) {
                deterministicGaps.push({
                    id: 'gap-det-1-' + page.id,
                    category: 'missing_component',
                    severity: 'critical',
                    page_id: page.id,
                    page_name: page.name,
                    title: 'Empty page: ' + page.name,
                    description: 'Page "' + page.name + '" has zero components. Every page should have at least basic structural components.',
                    suggested_fix: {
                        action: 'add_component',
                        target_page_id: page.id,
                        component_type: 'container',
                        component_name: page.name + ' Main Container',
                        properties: {},
                        position: { x: 0, y: 0, width: 1440, height: 900 },
                    },
                });
            }
        }

        // Check 2: Page missing header component
        for (const page of pages) {
            const pageComps = componentsByPage[page.id] || [];
            const hasHeader = pageComps.some(function (c) { return c.type === 'header'; });
            if (!hasHeader && pageComps.length > 0) {
                deterministicGaps.push({
                    id: 'gap-det-2-' + page.id,
                    category: 'missing_component',
                    severity: 'major',
                    page_id: page.id,
                    page_name: page.name,
                    title: 'Missing header on ' + page.name,
                    description: 'Page "' + page.name + '" has no header component. Headers provide branding, navigation, and user orientation.',
                    suggested_fix: {
                        action: 'add_component',
                        target_page_id: page.id,
                        component_type: 'header',
                        component_name: page.name + ' Header',
                        properties: {},
                        position: { x: 0, y: 0, width: 1440, height: 80 },
                    },
                });
            }
        }

        // Check 3: Page missing nav/sidebar (only if multi-page app, 2+ pages)
        if (pages.length >= 2) {
            for (const page of pages) {
                const pageComps = componentsByPage[page.id] || [];
                const hasNav = pageComps.some(function (c) {
                    return c.type === 'nav' || c.type === 'sidebar';
                });
                if (!hasNav && pageComps.length > 0) {
                    deterministicGaps.push({
                        id: 'gap-det-3-' + page.id,
                        category: 'missing_nav',
                        severity: 'major',
                        page_id: page.id,
                        page_name: page.name,
                        title: 'Missing navigation on ' + page.name,
                        description: 'Page "' + page.name + '" has no nav or sidebar component. Multi-page apps need consistent navigation.',
                        suggested_fix: {
                            action: 'add_component',
                            target_page_id: page.id,
                            component_type: 'sidebar',
                            component_name: page.name + ' Sidebar',
                            properties: {},
                            position: { x: 0, y: 80, width: 240, height: 760 },
                        },
                    });
                }
            }
        }

        // Check 4: Page missing footer
        for (const page of pages) {
            const pageComps = componentsByPage[page.id] || [];
            const hasFooter = pageComps.some(function (c) { return c.type === 'footer'; });
            if (!hasFooter && pageComps.length > 0) {
                deterministicGaps.push({
                    id: 'gap-det-4-' + page.id,
                    category: 'missing_component',
                    severity: 'minor',
                    page_id: page.id,
                    page_name: page.name,
                    title: 'Missing footer on ' + page.name,
                    description: 'Page "' + page.name + '" has no footer component. Footers provide copyright, links, and legal info.',
                    suggested_fix: {
                        action: 'add_component',
                        target_page_id: page.id,
                        component_type: 'footer',
                        component_name: page.name + ' Footer',
                        properties: {},
                        position: { x: 0, y: 840, width: 1440, height: 60 },
                    },
                });
            }
        }

        // Check 5: Form without submit button
        for (const page of pages) {
            const pageComps = componentsByPage[page.id] || [];
            const hasForms = pageComps.filter(function (c) { return c.type === 'form'; });
            for (const form of hasForms) {
                // Look for a button that is a child of the form or on the same page with "submit" in content/name
                const hasSubmitButton = pageComps.some(function (c) {
                    if (c.type !== 'button') { return false; }
                    // Child of form or nearby
                    if (c.parent_id === form.id) { return true; }
                    var nameMatch = (c.name || '').toLowerCase();
                    var contentMatch = (c.content || '').toLowerCase();
                    return nameMatch.indexOf('submit') !== -1 || contentMatch.indexOf('submit') !== -1 ||
                        nameMatch.indexOf('save') !== -1 || contentMatch.indexOf('save') !== -1 ||
                        nameMatch.indexOf('send') !== -1 || contentMatch.indexOf('send') !== -1;
                });
                if (!hasSubmitButton) {
                    deterministicGaps.push({
                        id: 'gap-det-5-' + form.id,
                        category: 'missing_component',
                        severity: 'major',
                        page_id: page.id,
                        page_name: page.name,
                        title: 'Form without submit button: ' + form.name,
                        description: 'Form "' + form.name + '" on page "' + page.name + '" has no submit/save button. Users cannot submit the form.',
                        suggested_fix: {
                            action: 'add_component',
                            target_page_id: page.id,
                            component_type: 'button',
                            component_name: form.name + ' Submit Button',
                            properties: { content: 'Submit' },
                            position: {
                                x: form.x,
                                y: form.y + form.height + 10,
                                width: 120,
                                height: 40,
                            },
                        },
                    });
                }
            }
        }

        // Check 6: No login/signup page (scan plan config_json for auth-related keywords)
        var configStr = (plan.config_json || '').toLowerCase();
        var authKeywords = ['auth', 'login', 'sign up', 'user', 'account', 'password', 'register', 'session'];
        var hasAuthRequirement = authKeywords.some(function (kw) { return configStr.indexOf(kw) !== -1; });
        if (hasAuthRequirement) {
            var pageNames = pages.map(function (p) { return p.name.toLowerCase(); });
            var pageRoutes = pages.map(function (p) { return p.route.toLowerCase(); });
            var hasAuthPage = pageNames.some(function (n) {
                return n.indexOf('login') !== -1 || n.indexOf('sign') !== -1 ||
                    n.indexOf('auth') !== -1 || n.indexOf('register') !== -1;
            }) || pageRoutes.some(function (r) {
                return r.indexOf('login') !== -1 || r.indexOf('sign') !== -1 ||
                    r.indexOf('auth') !== -1 || r.indexOf('register') !== -1;
            });
            if (!hasAuthPage) {
                deterministicGaps.push({
                    id: 'gap-det-6-global',
                    category: 'missing_page',
                    severity: 'critical',
                    title: 'No login/signup page',
                    description: 'The plan mentions authentication-related concepts but there is no login or signup page in the design.',
                    related_requirement: 'Authentication requirements detected in plan config',
                    suggested_fix: {
                        action: 'add_page',
                        component_type: 'page',
                        component_name: 'Login Page',
                        properties: { route: '/login' },
                        position: { x: 0, y: 0, width: 1440, height: 900 },
                    },
                });
            }
        }

        // Check 7: No 404/error page
        var hasErrorPage = pages.some(function (p) {
            var nameLower = p.name.toLowerCase();
            var routeLower = p.route.toLowerCase();
            return nameLower.indexOf('404') !== -1 || nameLower.indexOf('error') !== -1 ||
                nameLower.indexOf('not found') !== -1 || routeLower.indexOf('404') !== -1 ||
                routeLower.indexOf('error') !== -1;
        });
        if (!hasErrorPage && pages.length > 0) {
            deterministicGaps.push({
                id: 'gap-det-7-global',
                category: 'missing_page',
                severity: 'minor',
                title: 'No 404/error page',
                description: 'The design has no dedicated error or 404 page. Users hitting invalid routes will see a broken experience.',
                suggested_fix: {
                    action: 'add_page',
                    component_type: 'page',
                    component_name: '404 Not Found',
                    properties: { route: '/404' },
                    position: { x: 0, y: 0, width: 1440, height: 900 },
                },
            });
        }

        // Check 8: No loading state component
        var hasLoadingComponent = allComponents.some(function (c) {
            var nameLower = (c.name || '').toLowerCase();
            var contentLower = (c.content || '').toLowerCase();
            return nameLower.indexOf('loading') !== -1 || nameLower.indexOf('spinner') !== -1 ||
                nameLower.indexOf('skeleton') !== -1 || contentLower.indexOf('loading') !== -1;
        });
        if (!hasLoadingComponent && allComponents.length > 0) {
            deterministicGaps.push({
                id: 'gap-det-8-global',
                category: 'missing_state',
                severity: 'major',
                title: 'No loading state component',
                description: 'No component in the design represents a loading state (spinner, skeleton, progress bar). Users will see blank screens during data fetches.',
                suggested_fix: {
                    action: 'add_component',
                    target_page_id: pages.length > 0 ? pages[0].id : undefined,
                    component_type: 'custom',
                    component_name: 'Loading Spinner',
                    properties: { variant: 'spinner' },
                    position: { x: 620, y: 400, width: 200, height: 100 },
                },
            });
        }

        // Check 9: No empty state component
        var hasEmptyState = allComponents.some(function (c) {
            var nameLower = (c.name || '').toLowerCase();
            var contentLower = (c.content || '').toLowerCase();
            return nameLower.indexOf('empty') !== -1 || nameLower.indexOf('no data') !== -1 ||
                nameLower.indexOf('no results') !== -1 || contentLower.indexOf('no items') !== -1 ||
                contentLower.indexOf('nothing here') !== -1 || contentLower.indexOf('no data') !== -1;
        });
        if (!hasEmptyState && allComponents.length > 0) {
            deterministicGaps.push({
                id: 'gap-det-9-global',
                category: 'missing_state',
                severity: 'minor',
                title: 'No empty state component',
                description: 'No component represents an empty state (no data, no results). Lists and tables should show a helpful message when empty.',
                suggested_fix: {
                    action: 'add_component',
                    target_page_id: pages.length > 0 ? pages[0].id : undefined,
                    component_type: 'custom',
                    component_name: 'Empty State',
                    properties: { content: 'No items to display' },
                    position: { x: 520, y: 300, width: 400, height: 200 },
                },
            });
        }

        // Check 10: Page unreachable (no nav link, no flow points to it)
        if (pages.length > 1) {
            var flowTargets = new Set(pageFlows.map(function (f) { return f.to_page_id; }));
            var flowSources = new Set(pageFlows.map(function (f) { return f.from_page_id; }));

            // The first page (by sort order) is assumed reachable (home/entry point)
            var entryPageId = pages[0].id;

            for (var i = 1; i < pages.length; i++) {
                var page = pages[i];
                var isFlowTarget = flowTargets.has(page.id);
                // Also check if any nav/sidebar on other pages references this page
                var isLinkedFromNav = allComponents.some(function (c) {
                    if (c.page_id === page.id) { return false; } // not self-reference
                    if (c.type !== 'nav' && c.type !== 'sidebar' && c.type !== 'button') { return false; }
                    var contentLower = (c.content || '').toLowerCase();
                    var propsStr = JSON.stringify(c.props || {}).toLowerCase();
                    var pageLower = page.name.toLowerCase();
                    var routeLower = page.route.toLowerCase();
                    return contentLower.indexOf(pageLower) !== -1 || contentLower.indexOf(routeLower) !== -1 ||
                        propsStr.indexOf(routeLower) !== -1 || propsStr.indexOf(page.id) !== -1;
                });
                if (!isFlowTarget && !isLinkedFromNav) {
                    deterministicGaps.push({
                        id: 'gap-det-10-' + page.id,
                        category: 'incomplete_flow',
                        severity: 'critical',
                        page_id: page.id,
                        page_name: page.name,
                        title: 'Unreachable page: ' + page.name,
                        description: 'Page "' + page.name + '" has no navigation link or flow pointing to it. Users cannot reach this page.',
                        suggested_fix: {
                            action: 'add_navigation',
                            target_page_id: entryPageId,
                            component_type: 'nav',
                            component_name: 'Link to ' + page.name,
                            properties: { target_route: page.route },
                            position: { x: 0, y: 80, width: 240, height: 40 },
                        },
                    });
                }
            }
        }

        // Check 11: Button/link with empty content text
        for (const page of pages) {
            const pageComps = componentsByPage[page.id] || [];
            for (const comp of pageComps) {
                if (comp.type === 'button' || comp.type === 'nav') {
                    var contentText = (comp.content || '').trim();
                    if (contentText.length === 0) {
                        deterministicGaps.push({
                            id: 'gap-det-11-' + comp.id,
                            category: 'accessibility',
                            severity: 'major',
                            page_id: page.id,
                            page_name: page.name,
                            component_id: comp.id,
                            title: 'Empty content on ' + comp.type + ': ' + comp.name,
                            description: comp.type.charAt(0).toUpperCase() + comp.type.slice(1) + ' "' + comp.name + '" on page "' + page.name + '" has empty content text. Screen readers and users cannot determine its purpose.',
                            suggested_fix: {
                                action: 'modify_component',
                                target_page_id: page.id,
                                component_type: comp.type,
                                component_name: comp.name,
                                properties: { content: comp.name },
                                position: { x: comp.x, y: comp.y, width: comp.width, height: comp.height },
                            },
                        });
                    }
                }
            }
        }

        // Check 12: No responsive breakpoint overrides
        var hasResponsiveOverrides = allComponents.some(function (c) {
            if (!c.responsive) { return false; }
            var hasTablet = c.responsive.tablet && Object.keys(c.responsive.tablet).length > 0;
            var hasMobile = c.responsive.mobile && Object.keys(c.responsive.mobile).length > 0;
            return hasTablet || hasMobile;
        });
        if (!hasResponsiveOverrides && allComponents.length > 0) {
            deterministicGaps.push({
                id: 'gap-det-12-global',
                category: 'responsive',
                severity: 'minor',
                title: 'No responsive breakpoint overrides',
                description: 'No component in the design has responsive overrides (tablet/mobile). The design may not adapt to different screen sizes.',
                suggested_fix: {
                    action: 'flag_review',
                    component_name: 'Responsive Design Review',
                    properties: { note: 'Add tablet and mobile breakpoint overrides to key layout components' },
                    position: { x: 0, y: 0, width: 0, height: 0 },
                },
            });
        }

        // Check 13: Data model with no bound component
        for (const model of dataModels) {
            var hasBoundComponent = (model.bound_components || []).length > 0;
            if (!hasBoundComponent) {
                // Also check if any component references this model by name in props
                var modelNameLower = model.name.toLowerCase();
                var isReferencedInProps = allComponents.some(function (c) {
                    var propsStr = JSON.stringify(c.props || {}).toLowerCase();
                    return propsStr.indexOf(modelNameLower) !== -1 || propsStr.indexOf(model.id) !== -1;
                });
                if (!isReferencedInProps) {
                    deterministicGaps.push({
                        id: 'gap-det-13-' + model.id,
                        category: 'user_story_gap',
                        severity: 'minor',
                        title: 'Unbound data model: ' + model.name,
                        description: 'Data model "' + model.name + '" has no bound components. The data exists but is not displayed or editable anywhere in the UI.',
                        suggested_fix: {
                            action: 'add_component',
                            target_page_id: pages.length > 0 ? pages[0].id : undefined,
                            component_type: 'table',
                            component_name: model.name + ' Table',
                            properties: { data_model_id: model.id },
                            position: { x: 260, y: 100, width: 1000, height: 400 },
                        },
                    });
                }
            }
        }

        // Check 14: One-way navigation (page linked from A but no way back)
        if (pageFlows.length > 0) {
            for (const flow of pageFlows) {
                var hasReturnFlow = pageFlows.some(function (f) {
                    return f.from_page_id === flow.to_page_id && f.to_page_id === flow.from_page_id;
                });
                // Also check if the target page has nav that could link back
                var targetComps = componentsByPage[flow.to_page_id] || [];
                var hasNavBack = targetComps.some(function (c) {
                    return c.type === 'nav' || c.type === 'sidebar';
                });
                if (!hasReturnFlow && !hasNavBack) {
                    var fromPage = pages.find(function (p) { return p.id === flow.from_page_id; });
                    var toPage = pages.find(function (p) { return p.id === flow.to_page_id; });
                    if (fromPage && toPage) {
                        // Avoid duplicates: only add if we haven't flagged this pair already
                        var dupId = 'gap-det-14-' + flow.to_page_id + '-' + flow.from_page_id;
                        var alreadyFlagged = deterministicGaps.some(function (g) { return g.id === dupId; });
                        if (!alreadyFlagged) {
                            deterministicGaps.push({
                                id: dupId,
                                category: 'incomplete_flow',
                                severity: 'major',
                                page_id: toPage.id,
                                page_name: toPage.name,
                                title: 'One-way navigation: ' + fromPage.name + ' -> ' + toPage.name,
                                description: 'Page "' + toPage.name + '" is linked from "' + fromPage.name + '" but has no way to navigate back. Users could get stuck.',
                                suggested_fix: {
                                    action: 'add_navigation',
                                    target_page_id: toPage.id,
                                    component_type: 'button',
                                    component_name: 'Back to ' + fromPage.name,
                                    properties: { target_route: fromPage.route },
                                    position: { x: 20, y: 20, width: 120, height: 40 },
                                },
                            });
                        }
                    }
                }
            }
        }

        // Check 15: Form with input but no label component nearby
        for (const page of pages) {
            const pageComps = componentsByPage[page.id] || [];
            var inputs = pageComps.filter(function (c) { return c.type === 'input'; });
            for (const input of inputs) {
                // Look for a text component that serves as a label near the input
                var hasLabel = pageComps.some(function (c) {
                    if (c.type !== 'text') { return false; }
                    // Check proximity: label should be within 100px above or to the left of the input
                    var isAbove = c.y <= input.y && (input.y - c.y) < 100 && Math.abs(c.x - input.x) < 200;
                    var isLeft = c.x < input.x && (input.x - c.x) < 200 && Math.abs(c.y - input.y) < 50;
                    // Also check if it's a parent container or same parent
                    var isSameParent = c.parent_id !== null && c.parent_id === input.parent_id;
                    return isAbove || isLeft || isSameParent;
                });
                if (!hasLabel) {
                    deterministicGaps.push({
                        id: 'gap-det-15-' + input.id,
                        category: 'accessibility',
                        severity: 'major',
                        page_id: page.id,
                        page_name: page.name,
                        component_id: input.id,
                        title: 'Input without label: ' + input.name,
                        description: 'Input "' + input.name + '" on page "' + page.name + '" has no label component nearby. This is an accessibility violation — screen readers cannot describe the field.',
                        suggested_fix: {
                            action: 'add_component',
                            target_page_id: page.id,
                            component_type: 'text',
                            component_name: input.name + ' Label',
                            properties: { content: input.name },
                            position: {
                                x: input.x,
                                y: input.y - 30,
                                width: input.width,
                                height: 24,
                            },
                        },
                    });
                }
            }
        }

        // --- Count deterministic gaps by severity ---
        var criticalCount = deterministicGaps.filter(function (g) { return g.severity === 'critical'; }).length;
        var majorCount = deterministicGaps.filter(function (g) { return g.severity === 'major'; }).length;
        var minorCount = deterministicGaps.filter(function (g) { return g.severity === 'minor'; }).length;

        this.outputChannel.appendLine(
            '[Gap Hunter] Deterministic analysis: ' + deterministicGaps.length + ' gaps found (' +
            criticalCount + ' critical, ' + majorCount + ' major, ' + minorCount + ' minor)'
        );

        // --- LLM analysis for nuanced gaps (only if no critical deterministic gaps) ---
        var llmGaps: DesignGap[] = [];
        var coverageAssessment = '';

        if (criticalCount === 0) {
            try {
                // Build context for LLM
                var sections: string[] = [];

                sections.push('=== PLAN ===');
                sections.push('Name: ' + plan.name);
                sections.push('Config: ' + plan.config_json);

                sections.push('');
                sections.push('=== PAGES (' + pages.length + ') ===');
                for (const p of pages) {
                    sections.push('- ' + p.name + ' (id: ' + p.id + ', route: ' + p.route + ')');
                }

                sections.push('');
                sections.push('=== COMPONENTS (' + allComponents.length + ') ===');
                for (const p of pages) {
                    var pComps = componentsByPage[p.id] || [];
                    sections.push('Page "' + p.name + '" (' + pComps.length + ' components):');
                    for (const c of pComps) {
                        sections.push('  - ' + c.type + ': "' + c.name + '" content="' + (c.content || '').substring(0, 60) + '"');
                    }
                }

                sections.push('');
                sections.push('=== DATA MODELS (' + dataModels.length + ') ===');
                for (const m of dataModels) {
                    sections.push('- ' + m.name + ': ' + m.fields.length + ' fields, bound to: ' + (m.bound_components.join(', ') || 'none'));
                }

                sections.push('');
                sections.push('=== DETERMINISTIC GAPS ALREADY FOUND (' + deterministicGaps.length + ') ===');
                for (const g of deterministicGaps) {
                    sections.push('- [' + g.severity + '] ' + g.title + ': ' + g.description);
                }

                var prompt = 'Analyze this design for gaps that the deterministic checks missed. Focus on user flow gaps, missing interaction patterns, and edge-case pages.\n\n' + sections.join('\n');

                var context: AgentContext = { conversationHistory: [], plan: plan };
                var llmResponse = await this.processMessage(prompt, context);

                // Parse the LLM response for additional gaps
                try {
                    var jsonMatch = (llmResponse.content || '').match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        var parsed = JSON.parse(jsonMatch[0]);
                        coverageAssessment = parsed.coverage_assessment || '';

                        if (parsed.additional_gaps && Array.isArray(parsed.additional_gaps)) {
                            for (var gi = 0; gi < parsed.additional_gaps.length; gi++) {
                                var rawGap = parsed.additional_gaps[gi];
                                var fix: DesignGapFix = {
                                    action: rawGap.suggested_fix?.action || 'flag_review',
                                    target_page_id: rawGap.suggested_fix?.target_page_id || undefined,
                                    component_type: rawGap.suggested_fix?.component_type || undefined,
                                    component_name: rawGap.suggested_fix?.component_name || 'Unknown',
                                    properties: rawGap.suggested_fix?.properties || {},
                                    position: rawGap.suggested_fix?.position || { x: 0, y: 0, width: 200, height: 50 },
                                };
                                llmGaps.push({
                                    id: 'gap-llm-' + gi + '-' + (rawGap.page_id || 'global'),
                                    category: rawGap.category || 'user_story_gap',
                                    severity: rawGap.severity || 'minor',
                                    page_id: rawGap.page_id || undefined,
                                    page_name: rawGap.page_name || undefined,
                                    title: rawGap.title || 'LLM-detected gap',
                                    description: rawGap.description || '',
                                    related_requirement: rawGap.related_requirement || undefined,
                                    suggested_fix: fix,
                                });
                            }
                        }
                    }
                } catch {
                    this.outputChannel.appendLine('[Gap Hunter] Failed to parse LLM gap response');
                }
            } catch (error) {
                var errMsg = error instanceof Error ? error.message : String(error);
                this.outputChannel.appendLine('[Gap Hunter] LLM analysis failed: ' + errMsg);
                coverageAssessment = 'LLM analysis skipped due to error: ' + errMsg;
            }
        } else {
            coverageAssessment = 'LLM analysis skipped — ' + criticalCount + ' critical deterministic gaps must be fixed first.';
        }

        // --- Merge results ---
        var allGaps = deterministicGaps.concat(llmGaps);
        var totalCritical = allGaps.filter(function (g) { return g.severity === 'critical'; }).length;
        var totalMajor = allGaps.filter(function (g) { return g.severity === 'major'; }).length;
        var totalMinor = allGaps.filter(function (g) { return g.severity === 'minor'; }).length;

        // Calculate overall score: start at 100, deduct per gap
        var score = 100;
        score -= totalCritical * 15;
        score -= totalMajor * 5;
        score -= totalMinor * 2;
        if (score < 0) { score = 0; }

        var summary = 'Gap analysis complete: ' + allGaps.length + ' gaps found (' +
            totalCritical + ' critical, ' + totalMajor + ' major, ' + totalMinor + ' minor). ' +
            'Score: ' + score + '/100. ' +
            (deterministicGaps.length > 0
                ? deterministicGaps.length + ' found by deterministic checks. '
                : 'No deterministic gaps. ') +
            (llmGaps.length > 0
                ? llmGaps.length + ' found by LLM analysis. '
                : '') +
            (coverageAssessment ? coverageAssessment : '');

        this.database.addAuditLog(this.name, 'gap_analysis',
            'Plan ' + planId + ': score=' + score + ', gaps=' + allGaps.length +
            ' (' + totalCritical + 'C/' + totalMajor + 'M/' + totalMinor + 'm)');

        return {
            plan_id: planId,
            analysis_timestamp: new Date().toISOString(),
            overall_score: score,
            gaps: allGaps,
            summary: summary,
            pages_analyzed: pages.length,
            components_analyzed: allComponents.length,
        };
    }

    // ==================== BACKEND GAP ANALYSIS (v8.0) ====================

    /**
     * Analyze a plan's backend architecture for gaps using 5 deterministic checks.
     *
     * BE Check #16: API route with no middleware → major gap
     * BE Check #17: DB table with 3+ columns but no indexes → major gap
     * BE Check #18: Orphaned service (no route consumers) → minor gap
     * BE Check #19: Non-public API route with no auth → critical gap
     * BE Check #20: Data model exists but no matching DB table → major gap
     */
    analyzeBackendGaps(planId: string): DesignGap[] {
        const backendElements = this.database.getBackendElementsByPlan(planId);
        const dataModels = this.database.getDataModelsByPlan(planId);
        const deterministicGaps: DesignGap[] = [];

        // Build type lookups
        var routes: BackendElement[] = [];
        var tables: BackendElement[] = [];
        var services: BackendElement[] = [];
        var middleware: BackendElement[] = [];
        var authLayers: BackendElement[] = [];

        for (var i = 0; i < backendElements.length; i++) {
            var el = backendElements[i];
            if (el.type === 'api_route') { routes.push(el); }
            else if (el.type === 'db_table') { tables.push(el); }
            else if (el.type === 'service') { services.push(el); }
            else if (el.type === 'middleware') { middleware.push(el); }
            else if (el.type === 'auth_layer') { authLayers.push(el); }
        }

        // BE Check #16: API route with no middleware
        for (var ri = 0; ri < routes.length; ri++) {
            var route = routes[ri];
            var config: Record<string, unknown> = {};
            try { config = JSON.parse(route.config_json || '{}'); } catch { /* ignore */ }

            var middlewareIds = config.middleware_ids;
            var hasMiddleware = Array.isArray(middlewareIds) && middlewareIds.length > 0;

            if (!hasMiddleware) {
                deterministicGaps.push({
                    id: 'gap-be-16-' + route.id,
                    category: 'missing_component',
                    severity: 'major',
                    title: 'API route without middleware: ' + route.name,
                    description: 'API route "' + route.name + '" has no middleware attached. Routes should have at least logging, error handling, or validation middleware.',
                    suggested_fix: {
                        action: 'modify_component',
                        component_type: 'middleware',
                        component_name: route.name + ' Middleware',
                        properties: { target_route_id: route.id },
                        position: { x: 0, y: 0, width: 0, height: 0 },
                    },
                });
            }
        }

        // BE Check #17: DB table with 3+ columns but no indexes
        for (var ti = 0; ti < tables.length; ti++) {
            var table = tables[ti];
            var tableConfig: Record<string, unknown> = {};
            try { tableConfig = JSON.parse(table.config_json || '{}'); } catch { /* ignore */ }

            var columns = tableConfig.columns;
            var indexes = tableConfig.indexes;
            var columnCount = Array.isArray(columns) ? columns.length : 0;
            var indexCount = Array.isArray(indexes) ? indexes.length : 0;

            if (columnCount >= 3 && indexCount === 0) {
                deterministicGaps.push({
                    id: 'gap-be-17-' + table.id,
                    category: 'missing_component',
                    severity: 'major',
                    title: 'DB table without indexes: ' + table.name,
                    description: 'Database table "' + table.name + '" has ' + columnCount + ' columns but no indexes defined. Queries on this table will perform full table scans.',
                    suggested_fix: {
                        action: 'modify_component',
                        component_type: 'db_table',
                        component_name: table.name + ' Indexes',
                        properties: { target_table_id: table.id },
                        position: { x: 0, y: 0, width: 0, height: 0 },
                    },
                });
            }
        }

        // BE Check #18: Orphaned service (no route references it)
        for (var si = 0; si < services.length; si++) {
            var service = services[si];
            var serviceNameLower = service.name.toLowerCase();
            var serviceId = service.id;

            // Check if any route's config references this service
            var isReferenced = routes.some(function (r) {
                var rConfigStr = (r.config_json || '').toLowerCase();
                return rConfigStr.indexOf(serviceNameLower) !== -1 || rConfigStr.indexOf(serviceId) !== -1;
            });

            // Also check if any other service references it (dependency)
            if (!isReferenced) {
                isReferenced = services.some(function (s) {
                    if (s.id === serviceId) { return false; }
                    var sConfigStr = (s.config_json || '').toLowerCase();
                    return sConfigStr.indexOf(serviceNameLower) !== -1 || sConfigStr.indexOf(serviceId) !== -1;
                });
            }

            if (!isReferenced) {
                deterministicGaps.push({
                    id: 'gap-be-18-' + service.id,
                    category: 'user_story_gap',
                    severity: 'minor',
                    title: 'Orphaned service: ' + service.name,
                    description: 'Service "' + service.name + '" is not referenced by any API route or other service. It may be unused or missing connections.',
                    suggested_fix: {
                        action: 'flag_review',
                        component_type: 'service',
                        component_name: service.name,
                        properties: { note: 'Connect this service to consuming routes or remove if unnecessary' },
                        position: { x: 0, y: 0, width: 0, height: 0 },
                    },
                });
            }
        }

        // BE Check #19: Non-public API route with no auth
        for (var ai = 0; ai < routes.length; ai++) {
            var authRoute = routes[ai];
            var authConfig: Record<string, unknown> = {};
            try { authConfig = JSON.parse(authRoute.config_json || '{}'); } catch { /* ignore */ }

            var routePath = (authConfig.path as string || authRoute.name || '').toLowerCase();
            var isPublicRoute = routePath.indexOf('public') !== -1 ||
                routePath.indexOf('health') !== -1 ||
                routePath.indexOf('status') !== -1 ||
                routePath.indexOf('login') !== -1 ||
                routePath.indexOf('signup') !== -1 ||
                routePath.indexOf('register') !== -1 ||
                routePath.indexOf('webhook') !== -1;

            if (!isPublicRoute) {
                var routeAuth = authConfig.auth;
                var hasAuth = routeAuth !== undefined && routeAuth !== null && routeAuth !== false && routeAuth !== 'none';

                // Also check if any auth_layer covers this route
                if (!hasAuth) {
                    hasAuth = authLayers.some(function (al) {
                        var alConfig: Record<string, unknown> = {};
                        try { alConfig = JSON.parse(al.config_json || '{}'); } catch { /* ignore */ }
                        var protectedRoutes = alConfig.protected_routes;
                        if (Array.isArray(protectedRoutes)) {
                            return protectedRoutes.some(function (pr: string) {
                                return routePath.indexOf(pr.toLowerCase()) !== -1;
                            });
                        }
                        var appliesTo = alConfig.applies_to;
                        return appliesTo === 'global';
                    });
                }

                if (!hasAuth) {
                    deterministicGaps.push({
                        id: 'gap-be-19-' + authRoute.id,
                        category: 'missing_component',
                        severity: 'critical',
                        title: 'Non-public route without auth: ' + authRoute.name,
                        description: 'API route "' + authRoute.name + '" (' + routePath + ') is not marked as public and has no authentication configured. Unauthenticated access to non-public endpoints is a security risk.',
                        suggested_fix: {
                            action: 'add_component',
                            component_type: 'auth_layer',
                            component_name: authRoute.name + ' Auth',
                            properties: { target_route_id: authRoute.id, auth_type: 'jwt' },
                            position: { x: 0, y: 0, width: 0, height: 0 },
                        },
                    });
                }
            }
        }

        // BE Check #20: Data model exists but no matching DB table
        for (var di = 0; di < dataModels.length; di++) {
            var model = dataModels[di];
            var modelNameLower = model.name.toLowerCase();

            var hasMatchingTable = tables.some(function (t) {
                var tNameLower = t.name.toLowerCase();
                var tConfig: Record<string, unknown> = {};
                try { tConfig = JSON.parse(t.config_json || '{}'); } catch { /* ignore */ }
                var tableName = ((tConfig.table_name as string) || '').toLowerCase();

                // Check various naming conventions: exact, plural, snake_case
                return tNameLower.indexOf(modelNameLower) !== -1 ||
                    modelNameLower.indexOf(tNameLower) !== -1 ||
                    tableName.indexOf(modelNameLower) !== -1 ||
                    modelNameLower.indexOf(tableName) !== -1 ||
                    tConfig.data_model_id === model.id;
            });

            if (!hasMatchingTable) {
                deterministicGaps.push({
                    id: 'gap-be-20-' + model.id,
                    category: 'missing_component',
                    severity: 'major',
                    title: 'Data model without DB table: ' + model.name,
                    description: 'Data model "' + model.name + '" exists but has no matching database table in the backend design. The data has no persistence layer.',
                    suggested_fix: {
                        action: 'add_component',
                        component_type: 'db_table',
                        component_name: model.name + ' Table',
                        properties: { data_model_id: model.id },
                        position: { x: 0, y: 0, width: 0, height: 0 },
                    },
                });
            }
        }

        this.outputChannel.appendLine(
            '[Gap Hunter] Backend deterministic analysis: ' + deterministicGaps.length + ' gaps found'
        );

        return deterministicGaps;
    }

    /**
     * Combined analysis: Run both frontend (analyzeGaps) and backend (analyzeBackendGaps)
     * gap analysis, merge the results into a single DesignGapAnalysis.
     */
    async analyzeAllGaps(planId: string): Promise<DesignGapAnalysis> {
        // Run frontend analysis (includes LLM)
        const feAnalysis = await this.analyzeGaps(planId);

        // Run backend deterministic checks
        const beGaps = this.analyzeBackendGaps(planId);

        // Merge
        const allGaps = feAnalysis.gaps.concat(beGaps);

        var totalCritical = allGaps.filter(function (g) { return g.severity === 'critical'; }).length;
        var totalMajor = allGaps.filter(function (g) { return g.severity === 'major'; }).length;
        var totalMinor = allGaps.filter(function (g) { return g.severity === 'minor'; }).length;

        // Recalculate score
        var score = 100;
        score -= totalCritical * 15;
        score -= totalMajor * 5;
        score -= totalMinor * 2;
        if (score < 0) { score = 0; }

        var summary = 'Combined gap analysis: ' + allGaps.length + ' total gaps (' +
            totalCritical + ' critical, ' + totalMajor + ' major, ' + totalMinor + ' minor). ' +
            'FE gaps: ' + feAnalysis.gaps.length + ', BE gaps: ' + beGaps.length + '. ' +
            'Score: ' + score + '/100.';

        this.database.addAuditLog(this.name, 'all_gaps_analysis',
            'Plan ' + planId + ': score=' + score + ', total=' + allGaps.length +
            ' (FE=' + feAnalysis.gaps.length + ', BE=' + beGaps.length + ')');

        return {
            plan_id: planId,
            analysis_timestamp: new Date().toISOString(),
            overall_score: score,
            gaps: allGaps,
            summary: summary,
            pages_analyzed: feAnalysis.pages_analyzed,
            components_analyzed: feAnalysis.components_analyzed,
        };
    }
}
