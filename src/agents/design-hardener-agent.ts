import { BaseAgent } from './base-agent';
import { AgentType, AgentContext, AgentResponse, DesignComponent, DesignGapAnalysis, DesignGap, DesignHardeningResult } from '../types';

/**
 * Design Hardener Agent — Takes a DesignGapAnalysis and creates draft components
 * in the database for user review.
 *
 * This agent does NOT auto-apply changes. It creates proposals as draft components
 * (is_draft = 1) that the user must approve before they become part of the design.
 *
 * Approach:
 * 1. Simple fixes (add_component with enough detail) are created directly — no LLM call needed.
 * 2. Complex fixes (add_page, or gaps without enough detail) are sent to the LLM
 *    for detailed proposals, then created as drafts.
 */
export class DesignHardenerAgent extends BaseAgent {
    readonly name = 'Design Hardener';
    readonly type = AgentType.DesignHardener;
    readonly systemPrompt = `YOUR ONE JOB: Given a list of design gaps with suggested fixes, generate the specific component data needed to fill each gap.

RULES:
1. For each gap with a suggested_fix, generate a concrete component specification.
2. Components must have sensible default sizes and positions based on the fix suggestion.
3. For add_page fixes: describe the page layout with its essential components.
4. Content text should be descriptive placeholder text appropriate for the component type.
5. Do not duplicate existing components — only create what's missing.

REQUIRED JSON OUTPUT:
{
    "proposals": [
        {
            "gap_id": "<matching gap id>",
            "action": "add_component|add_page",
            "page_id": "<target page id or null for new pages>",
            "page_name": "<for new pages>",
            "page_route": "<for new pages>",
            "components": [
                {
                    "component_type": "button|text|input|header|sidebar|footer|form|container|image|nav|card|list|table|modal|loading|empty_state",
                    "name": "<descriptive name>",
                    "content_text": "<placeholder content>",
                    "x": 0, "y": 0, "width": 200, "height": 50,
                    "styles": {}
                }
            ]
        }
    ],
    "summary": "<what was proposed>"
}`;

    protected async parseResponse(raw: string, _context: AgentContext): Promise<AgentResponse> {
        let content = raw;
        const actions: AgentResponse['actions'] = [];

        try {
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                const proposalCount = (parsed.proposals || []).length;
                content = 'Design Hardener: ' + proposalCount + ' proposals generated.\n\n' + (parsed.summary || '');

                for (const proposal of (parsed.proposals || [])) {
                    actions.push({
                        type: 'log',
                        payload: {
                            gap_id: proposal.gap_id,
                            action: proposal.action,
                            page_id: proposal.page_id,
                            page_name: proposal.page_name,
                            component_count: (proposal.components || []).length,
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
     * Harden a design by creating draft components/pages to fill gaps.
     *
     * @param planId - The plan to harden
     * @param gapAnalysis - The gap analysis from the Gap Hunter agent
     * @returns A result describing what was created
     */
    async hardenDesign(planId: string, gapAnalysis: DesignGapAnalysis): Promise<DesignHardeningResult> {
        const result: DesignHardeningResult = {
            plan_id: planId,
            gaps_addressed: 0,
            drafts_created: 0,
            pages_created: 0,
            actions_taken: [],
        };

        // Filter gaps that have an actionable suggested_fix
        const actionableGaps = gapAnalysis.gaps.filter(function (gap) {
            if (!gap.suggested_fix) { return false; }
            var action = gap.suggested_fix.action;
            return action === 'add_component' || action === 'add_page' || action === 'modify_component';
        });

        if (actionableGaps.length === 0) {
            this.outputChannel.appendLine('[Design Hardener] No actionable gaps to harden.');
            this.database.addAuditLog(this.name, 'harden_design', 'Plan ' + planId + ': no actionable gaps');
            return result;
        }

        this.outputChannel.appendLine(
            '[Design Hardener] Processing ' + actionableGaps.length + ' actionable gaps for plan ' + planId
        );

        // Separate gaps into simple (can handle directly) and complex (need LLM)
        var simpleGaps: DesignGap[] = [];
        var complexGaps: DesignGap[] = [];

        for (var i = 0; i < actionableGaps.length; i++) {
            var gap = actionableGaps[i];
            var fix = gap.suggested_fix;

            if (fix.action === 'add_page') {
                // add_page always needs LLM to generate page layout with components
                complexGaps.push(gap);
            } else if (fix.action === 'add_component' && fix.component_type && fix.target_page_id && fix.position) {
                // Simple: we have all the info needed to create directly
                simpleGaps.push(gap);
            } else if (fix.action === 'modify_component' && fix.component_type && fix.target_page_id) {
                // modify_component with enough detail — create a draft replacement directly
                simpleGaps.push(gap);
            } else {
                // Not enough detail — ask LLM
                complexGaps.push(gap);
            }
        }

        this.outputChannel.appendLine(
            '[Design Hardener] ' + simpleGaps.length + ' simple gaps (direct), ' +
            complexGaps.length + ' complex gaps (LLM-assisted)'
        );

        // --- Handle simple gaps directly ---
        for (var si = 0; si < simpleGaps.length; si++) {
            var simpleGap = simpleGaps[si];
            var simpleFix = simpleGap.suggested_fix;

            try {
                if (simpleFix.action === 'add_component' || simpleFix.action === 'modify_component') {
                    var pageId = simpleFix.target_page_id;
                    if (!pageId) {
                        result.actions_taken.push({
                            gap_id: simpleGap.id,
                            action: simpleFix.action,
                            result: 'skipped: no target_page_id',
                        });
                        continue;
                    }

                    var pos = simpleFix.position || { x: 0, y: 0, width: 200, height: 50 };
                    var compName = simpleFix.component_name || simpleGap.title;
                    var compType = simpleFix.component_type || 'container';
                    var contentText = '';

                    // Generate sensible placeholder content based on component type
                    if (compType === 'button') {
                        contentText = compName.replace(/\s*button\s*/i, '') || 'Click me';
                    } else if (compType === 'text') {
                        contentText = (simpleFix.properties && simpleFix.properties.content)
                            ? String(simpleFix.properties.content)
                            : compName;
                    } else if (compType === 'header') {
                        contentText = compName.replace(/\s*header\s*/i, '') || 'Header';
                    } else if (compType === 'footer') {
                        contentText = compName.replace(/\s*footer\s*/i, '') || 'Footer';
                    } else if (compType === 'sidebar' || compType === 'nav') {
                        contentText = 'Navigation';
                    } else if (compType === 'input') {
                        contentText = compName.replace(/\s*input\s*/i, '') || 'Enter value...';
                    } else if (compType === 'container') {
                        contentText = '';
                    } else {
                        contentText = compName;
                    }

                    var comp = this.database.createDesignComponent({
                        page_id: pageId,
                        plan_id: planId,
                        type: compType as DesignComponent['type'],
                        name: compName,
                        x: pos.x,
                        y: pos.y,
                        width: pos.width,
                        height: pos.height,
                        content: contentText,
                        props: simpleFix.properties ? simpleFix.properties : {},
                    });

                    // Mark as draft
                    this.database.updateDesignComponent(comp.id, { is_draft: 1 });

                    result.drafts_created++;
                    result.gaps_addressed++;
                    result.actions_taken.push({
                        gap_id: simpleGap.id,
                        action: simpleFix.action,
                        result: 'draft created: ' + compType + ' "' + compName + '" (id: ' + comp.id + ')',
                    });

                    this.outputChannel.appendLine(
                        '[Design Hardener] Created draft ' + compType + ' "' + compName + '" on page ' + pageId
                    );
                }
            } catch (error) {
                var errMsg = error instanceof Error ? error.message : String(error);
                result.actions_taken.push({
                    gap_id: simpleGap.id,
                    action: simpleFix.action,
                    result: 'error: ' + errMsg,
                });
                this.outputChannel.appendLine(
                    '[Design Hardener] Error creating draft for gap ' + simpleGap.id + ': ' + errMsg
                );
            }
        }

        // --- Handle complex gaps via LLM ---
        if (complexGaps.length > 0) {
            try {
                var sections: string[] = [];
                sections.push('=== DESIGN GAPS REQUIRING DETAILED PROPOSALS ===');
                sections.push('Plan ID: ' + planId);
                sections.push('');

                for (var ci = 0; ci < complexGaps.length; ci++) {
                    var complexGap = complexGaps[ci];
                    sections.push('Gap #' + (ci + 1) + ':');
                    sections.push('  ID: ' + complexGap.id);
                    sections.push('  Category: ' + complexGap.category);
                    sections.push('  Severity: ' + complexGap.severity);
                    sections.push('  Title: ' + complexGap.title);
                    sections.push('  Description: ' + complexGap.description);
                    if (complexGap.page_id) {
                        sections.push('  Page ID: ' + complexGap.page_id);
                    }
                    if (complexGap.page_name) {
                        sections.push('  Page Name: ' + complexGap.page_name);
                    }
                    if (complexGap.suggested_fix) {
                        sections.push('  Suggested Fix Action: ' + complexGap.suggested_fix.action);
                        if (complexGap.suggested_fix.component_name) {
                            sections.push('  Suggested Component: ' + complexGap.suggested_fix.component_name);
                        }
                        if (complexGap.suggested_fix.properties) {
                            sections.push('  Properties: ' + JSON.stringify(complexGap.suggested_fix.properties));
                        }
                    }
                    sections.push('');
                }

                var prompt = 'Generate detailed component proposals for the following design gaps. Each proposal must include concrete component specifications with types, names, content text, positions, and sizes.\n\n' + sections.join('\n');

                var context: AgentContext = { conversationHistory: [] };
                var llmResponse = await this.processMessage(prompt, context);

                // Parse LLM proposals
                var proposals: Array<{
                    gap_id: string;
                    action: string;
                    page_id: string | null;
                    page_name: string | null;
                    page_route: string | null;
                    components: Array<{
                        component_type: string;
                        name: string;
                        content_text: string;
                        x: number;
                        y: number;
                        width: number;
                        height: number;
                        styles: Record<string, unknown>;
                    }>;
                }> = [];

                try {
                    var jsonMatch = (llmResponse.content || '').match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        var parsed = JSON.parse(jsonMatch[0]);
                        proposals = parsed.proposals || [];
                    }
                } catch {
                    this.outputChannel.appendLine('[Design Hardener] Failed to parse LLM proposals');
                }

                // Process each proposal
                for (var pi = 0; pi < proposals.length; pi++) {
                    var proposal = proposals[pi];

                    try {
                        if (proposal.action === 'add_page') {
                            // Create the new page
                            var newPage = this.database.createDesignPage({
                                plan_id: planId,
                                name: proposal.page_name || 'New Page',
                                route: proposal.page_route || '/' + (proposal.page_name || 'new-page').toLowerCase().replace(/\s+/g, '-'),
                            });

                            result.pages_created++;

                            // Create draft components in the new page
                            var pageComponents = proposal.components || [];
                            for (var pci = 0; pci < pageComponents.length; pci++) {
                                var pComp = pageComponents[pci];
                                var createdComp = this.database.createDesignComponent({
                                    page_id: newPage.id,
                                    plan_id: planId,
                                    type: (pComp.component_type || 'container') as DesignComponent['type'],
                                    name: pComp.name || 'Component',
                                    x: pComp.x ?? 0,
                                    y: pComp.y ?? 0,
                                    width: pComp.width ?? 200,
                                    height: pComp.height ?? 50,
                                    content: pComp.content_text || '',
                                    styles: pComp.styles || {},
                                });

                                // Mark as draft
                                this.database.updateDesignComponent(createdComp.id, { is_draft: 1 });
                                result.drafts_created++;
                            }

                            result.gaps_addressed++;
                            result.actions_taken.push({
                                gap_id: proposal.gap_id,
                                action: 'add_page',
                                result: 'page created: "' + (proposal.page_name || 'New Page') + '" (id: ' + newPage.id + ') with ' + pageComponents.length + ' draft components',
                            });

                            this.outputChannel.appendLine(
                                '[Design Hardener] Created page "' + (proposal.page_name || 'New Page') + '" with ' + pageComponents.length + ' draft components'
                            );
                        } else if (proposal.action === 'add_component') {
                            var targetPageId = proposal.page_id;
                            if (!targetPageId) {
                                result.actions_taken.push({
                                    gap_id: proposal.gap_id,
                                    action: 'add_component',
                                    result: 'skipped: no page_id in proposal',
                                });
                                continue;
                            }

                            var proposalComponents = proposal.components || [];
                            for (var cci = 0; cci < proposalComponents.length; cci++) {
                                var cComp = proposalComponents[cci];
                                var created = this.database.createDesignComponent({
                                    page_id: targetPageId,
                                    plan_id: planId,
                                    type: (cComp.component_type || 'container') as DesignComponent['type'],
                                    name: cComp.name || 'Component',
                                    x: cComp.x ?? 0,
                                    y: cComp.y ?? 0,
                                    width: cComp.width ?? 200,
                                    height: cComp.height ?? 50,
                                    content: cComp.content_text || '',
                                    styles: cComp.styles || {},
                                });

                                // Mark as draft
                                this.database.updateDesignComponent(created.id, { is_draft: 1 });
                                result.drafts_created++;
                            }

                            result.gaps_addressed++;
                            result.actions_taken.push({
                                gap_id: proposal.gap_id,
                                action: 'add_component',
                                result: proposalComponents.length + ' draft components created on page ' + targetPageId,
                            });

                            this.outputChannel.appendLine(
                                '[Design Hardener] Created ' + proposalComponents.length + ' draft components on page ' + targetPageId
                            );
                        }
                    } catch (propError) {
                        var propErrMsg = propError instanceof Error ? propError.message : String(propError);
                        result.actions_taken.push({
                            gap_id: proposal.gap_id,
                            action: proposal.action,
                            result: 'error: ' + propErrMsg,
                        });
                        this.outputChannel.appendLine(
                            '[Design Hardener] Error processing proposal for gap ' + proposal.gap_id + ': ' + propErrMsg
                        );
                    }
                }
            } catch (llmError) {
                var llmErrMsg = llmError instanceof Error ? llmError.message : String(llmError);
                this.outputChannel.appendLine('[Design Hardener] LLM analysis failed: ' + llmErrMsg);

                // Record all complex gaps as failed
                for (var fi = 0; fi < complexGaps.length; fi++) {
                    result.actions_taken.push({
                        gap_id: complexGaps[fi].id,
                        action: complexGaps[fi].suggested_fix.action,
                        result: 'error: LLM analysis failed — ' + llmErrMsg,
                    });
                }
            }
        }

        // Log summary
        this.database.addAuditLog(
            this.name,
            'harden_design',
            'Plan ' + planId + ': addressed=' + result.gaps_addressed +
            ', drafts=' + result.drafts_created +
            ', pages=' + result.pages_created +
            ' (from ' + actionableGaps.length + ' actionable gaps)'
        );

        this.outputChannel.appendLine(
            '[Design Hardener] Complete: ' + result.gaps_addressed + ' gaps addressed, ' +
            result.drafts_created + ' drafts created, ' + result.pages_created + ' pages created'
        );

        return result;
    }
}
