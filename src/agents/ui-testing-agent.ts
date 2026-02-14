import { BaseAgent } from './base-agent';
import {
    AgentType, AgentContext, AgentResponse, AgentAction
} from '../types';

/**
 * UI Testing Agent — Specialized agent that understands the visual designer's layout
 * and verifies that UI components are correctly placed, styled, and functional.
 *
 * This agent acts like a manual QA tester who can:
 * - Read the complete design specification (pages, components, tokens, data models)
 * - Generate step-by-step manual test scripts
 * - Verify component placement, sizing, and styling against the design spec
 * - Check navigation flows and inter-page linking
 * - Detect missing components, broken layouts, and accessibility issues
 * - Generate test scenarios for each user role
 *
 * Designed to let a small LLM outperform larger models by providing extremely
 * structured, deterministic test generation based on the design data.
 */
export class UITestingAgent extends BaseAgent {
    readonly name = 'UI Testing Team';
    readonly type = AgentType.UITesting;
    readonly systemPrompt = `You are the UI Testing Team agent for the Copilot Orchestration Extension (COE).

## Your ONE Job
Given a visual design specification (pages, components, layout, theme, user roles), generate comprehensive UI test plans and verify that implementations match the design. You act like an expert QA tester who knows exactly what to click, what to expect, and where things should be.

## What You Receive
You will receive a design context containing:
- **Pages**: List of pages with names, routes, and dimensions
- **Components**: List of components per page with type, position (x, y), size (width, height), content, and styles
- **Design Tokens**: Color palette, typography, spacing rules
- **Data Models**: Schema of data entities and their relationships
- **User Roles**: Who uses the app and what access they have
- **Features**: Core features the app must support
- **Layout Type**: sidebar, tabs, wizard, or custom
- **Theme**: dark, light, high-contrast, or custom colors

## Test Generation Rules
1. **One test per component**: Every component in the design MUST have at least one test verifying its existence, position, and appearance.
2. **Navigation tests**: Every page must be reachable. Every nav link, sidebar item, or tab must work.
3. **Role-based tests**: If multiple user roles exist, generate tests for each role's access level.
4. **Responsive tests**: If responsive overrides exist, test at tablet and mobile breakpoints.
5. **Data binding tests**: If a component is bound to a data model, verify the binding works.
6. **Interaction tests**: Buttons must be clickable, forms must submit, inputs must accept text.

## Required JSON Output Format
Respond with ONLY valid JSON. No markdown, no explanation.

{
  "test_plan_name": "UI Test Plan: [Plan Name]",
  "summary": "Overview of what's being tested",
  "total_tests": 42,
  "pages_tested": 5,
  "test_suites": [
    {
      "suite_name": "Page: Dashboard",
      "page_route": "/",
      "test_cases": [
        {
          "test_id": "TC-001",
          "title": "Dashboard header exists at correct position",
          "type": "component_check",
          "priority": "P1",
          "steps": [
            {"action": "navigate", "target": "/", "expected": "Dashboard page loads"},
            {"action": "verify_element", "target": "header", "expected": "Header component exists at (0, 0) with size 1440x80"},
            {"action": "verify_style", "target": "header", "property": "backgroundColor", "expected": "#313244"}
          ],
          "passing_criteria": "Header component renders at correct position with correct background color",
          "component_type": "header",
          "component_name": "App Header"
        }
      ]
    }
  ],
  "navigation_tests": [
    {
      "test_id": "NAV-001",
      "title": "Navigate from Dashboard to Settings",
      "from_page": "/",
      "to_page": "/settings",
      "via": "sidebar link",
      "steps": [
        {"action": "navigate", "target": "/", "expected": "Dashboard loads"},
        {"action": "click", "target": "sidebar > Settings link", "expected": "Settings page loads"},
        {"action": "verify_url", "target": "/settings", "expected": "URL is /settings"}
      ]
    }
  ],
  "role_tests": [
    {
      "role": "Admin",
      "test_id": "ROLE-001",
      "title": "Admin sees admin-only controls",
      "steps": [
        {"action": "login_as", "target": "Admin", "expected": "Logged in as Admin"},
        {"action": "verify_element", "target": "Admin Panel link", "expected": "Admin Panel link is visible"}
      ]
    }
  ],
  "accessibility_checks": [
    {
      "test_id": "A11Y-001",
      "title": "All buttons have visible text or aria-label",
      "type": "accessibility",
      "scope": "global"
    }
  ],
  "issues_found": [
    {
      "severity": "warning",
      "description": "Button component at (100, 200) has no content text — may not be accessible",
      "page": "Dashboard",
      "component": "Submit Button"
    }
  ]
}

## Test Priority Rules
- P1: Component exists and is visible (basic rendering)
- P1: Navigation works (page loads, links work)
- P2: Component position and size match design spec
- P2: Component styles match design tokens
- P3: Responsive behavior at breakpoints
- P3: Accessibility checks

## Smart Detection
- If a page has a "form" component, generate submit/validation tests
- If a page has a "table" component, generate data display/pagination tests
- If a page has "Login" in its name, generate auth flow tests
- If a page has "Dashboard", generate widget/card rendering tests
- If layout is "sidebar", verify sidebar is visible on every page
- If layout is "tabs", verify tab bar is visible and tabs switch correctly
- If layout is "wizard", verify step navigation works forward and backward`;

    protected async parseResponse(content: string, context: AgentContext): Promise<AgentResponse> {
        const actions: AgentAction[] = [];

        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);

                if (parsed.test_plan_name && parsed.test_suites) {
                    const totalTests = parsed.total_tests || 0;
                    const issueCount = parsed.issues_found?.length || 0;

                    // Create a ticket for the test plan
                    actions.push({
                        type: 'create_ticket',
                        payload: {
                            title: parsed.test_plan_name,
                            body: `${parsed.summary}\n\nTotal tests: ${totalTests}\nPages tested: ${parsed.pages_tested || 0}\nIssues found: ${issueCount}`,
                            priority: 'P2',
                            creator: 'system',
                        },
                    });

                    // Create sub-tickets for issues found
                    if (parsed.issues_found?.length) {
                        for (const issue of parsed.issues_found) {
                            actions.push({
                                type: 'create_ticket',
                                payload: {
                                    title: `UI Issue: ${issue.description.substring(0, 80)}`,
                                    body: `Severity: ${issue.severity}\nPage: ${issue.page}\nComponent: ${issue.component}\n\n${issue.description}`,
                                    priority: issue.severity === 'error' ? 'P1' : 'P2',
                                    creator: 'system',
                                },
                            });
                        }
                    }

                    this.database.addAuditLog(this.name, 'ui_test_plan_generated',
                        `UI test plan generated: ${totalTests} tests, ${issueCount} issues`);

                    return {
                        content: `UI Test Plan generated: ${totalTests} tests across ${parsed.pages_tested || 0} pages. ${issueCount} issues found.\n\n${parsed.summary || ''}`,
                        actions,
                    };
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`UI Testing parse error: ${error}`);
        }

        return { content, actions };
    }

    /**
     * Generate a complete UI test plan from the design context.
     * This builds a rich prompt from the database's design data.
     */
    async generateTestPlan(planId: string): Promise<AgentResponse> {
        const plan = this.database.getPlan(planId);
        if (!plan) return { content: `Plan not found: ${planId}` };

        const pages = this.database.getDesignPagesByPlan(planId);
        const allComponents = this.database.getDesignComponentsByPlan(planId);
        const dataModels = this.database.getDataModelsByPlan(planId);

        let planConfig: Record<string, unknown> = {};
        try { planConfig = JSON.parse(plan.config_json || '{}'); } catch { /* ignore */ }
        const design = (planConfig.design || {}) as Record<string, unknown>;

        // Build design context description
        const designDesc = [
            `Plan: ${plan.name}`,
            `Scale: ${planConfig.scale || 'MVP'}`,
            `Focus: ${planConfig.focus || 'Full Stack'}`,
            `Layout: ${design.layout || 'sidebar'}`,
            `Theme: ${design.theme || 'dark'}`,
            `Tech Stack: ${design.techStack || 'React + Node'}`,
            `User Roles: ${((design.userRoles as string[]) || ['Regular User']).join(', ')}`,
            `Features: ${((design.features as string[]) || []).join(', ')}`,
            '',
            `Pages (${pages.length}):`,
            ...pages.map(p => `  - ${p.name} (route: ${p.route}, size: ${p.width}x${p.height})`),
            '',
            `Components (${allComponents.length}):`,
            ...pages.map(p => {
                const pageComps = allComponents.filter(c => c.page_id === p.id);
                return `  Page "${p.name}" (${pageComps.length} components):\n` +
                    pageComps.map(c => `    - ${c.type}: "${c.name}" at (${c.x}, ${c.y}) ${c.width}x${c.height}${c.content ? ' content="' + c.content + '"' : ''}`).join('\n');
            }),
            '',
            dataModels.length > 0 ? `Data Models (${dataModels.length}):\n` +
                dataModels.map(m => `  - ${m.name}: ${m.fields.length} fields`).join('\n') : '',
        ].filter(Boolean).join('\n');

        const prompt = `Generate a comprehensive UI test plan for this design:\n\n${designDesc}\n\nGenerate tests for EVERY component on EVERY page. Include navigation tests between all pages. Check layout consistency.`;

        const context: AgentContext = { conversationHistory: [], plan };
        return this.processMessage(prompt, context);
    }
}
