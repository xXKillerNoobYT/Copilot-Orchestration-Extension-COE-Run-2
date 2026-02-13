/**
 * CodingAgentService — Integrated AI coding agent for COE v2.0
 *
 * Processes natural-language commands to build, modify, explain, fix,
 * automate, and query the Visual Program Designer's component tree.
 *
 * Architecture:
 *   1. Intent classification (keyword-first, LLM fallback)
 *   2. Ethics gate (EthicsEngine evaluation before every action)
 *   3. Route to handler: build → modify → explain → fix → automate → query
 *   4. Code generation (component schemas → code templates)
 *   5. Diff generation (deterministic, no LLM)
 *   6. Event emission for real-time UI updates
 *
 * Design principles:
 *   - Keyword-first classification: >2 keyword hits = instant intent, no LLM call
 *   - Ethics-first: every action passes through EthicsEngine before execution
 *   - Deterministic where possible: diff gen, template interpolation, intent classification
 *   - LLM used only for: ambiguous intents, code explanation, logic tree generation
 *
 * Layer 3 (Execution) service in the COE 3-layer architecture.
 */

import * as crypto from 'crypto';
import { Database } from './database';
import { EventBus } from './event-bus';
import { EthicsEngine, TransparencyLoggerLike } from './ethics-engine';
import { ComponentSchemaService } from './component-schema';
import {
    CodingAgentRequest,
    CodingAgentResponse,
    CodeDiff,
    CodeDiffStatus,
    LogicBlock,
    LogicBlockType,
    EthicsActionContext,
    LLMMessage,
} from '../types';

// ==================== INTERFACES ====================

/** Minimal LLM service interface for loose coupling */
export interface LLMServiceLike {
    chat(messages: LLMMessage[], options?: {
        maxTokens?: number;
        temperature?: number;
        stream?: boolean;
    }): Promise<{ content: string; tokens_used?: number }>;
    classify(message: string, categories: string[]): Promise<string>;
}

/** Intent classification result */
export interface IntentClassification {
    intent: CodingAgentRequest['intent'];
    confidence: number;
    method: 'keyword' | 'llm';
    matchedKeywords: string[];
}

/** Code generation result (before wrapping into CodingAgentResponse) */
interface CodeGenResult {
    code: string;
    language: string;
    files: Array<{ name: string; content: string; language: string }>;
    explanation: string;
    warnings: string[];
    confidence: number;
}

/** Output channel interface for decoupling from VS Code */
interface OutputChannelLike {
    appendLine(msg: string): void;
}

// ==================== KEYWORD MAPS ====================

const INTENT_KEYWORDS: Record<CodingAgentRequest['intent'], string[]> = {
    build: ['create', 'add', 'build', 'new', 'make', 'generate', 'insert', 'place', 'scaffold', 'bootstrap'],
    modify: ['change', 'update', 'edit', 'move', 'resize', 'rename', 'replace', 'swap', 'refactor', 'adjust'],
    explain: ['explain', 'what', 'why', 'how', 'describe', 'tell me', 'show me', 'understand', 'clarify'],
    fix: ['fix', 'bug', 'error', 'broken', 'wrong', 'issue', 'debug', 'repair', 'patch', 'resolve'],
    automate: ['automate', 'if', 'when', 'trigger', 'rule', 'schedule', 'repeat', 'workflow', 'cron', 'hook'],
    query: ['find', 'search', 'list', 'show', 'get', 'count', 'filter', 'where', 'lookup', 'fetch'],
};

/** Minimum keyword hits for instant classification (no LLM needed) */
const KEYWORD_CONFIDENCE_THRESHOLD = 2;

// ==================== DIFF GENERATION ====================

/**
 * Generate a unified diff between two code strings.
 * Deterministic — no LLM involved.
 */
function generateUnifiedDiff(before: string, after: string, filename: string = 'component'): string {
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    const diffLines: string[] = [];

    diffLines.push(`--- a/${filename}`);
    diffLines.push(`+++ b/${filename}`);

    // Simple line-by-line diff (Myers-like, but simplified for typical component changes)
    const maxLen = Math.max(beforeLines.length, afterLines.length);
    let hunkStart = -1;
    let hunkBefore: string[] = [];
    let hunkAfter: string[] = [];
    let contextBefore = 0;
    let contextAfter = 0;

    const flushHunk = () => {
        if (hunkBefore.length === 0 && hunkAfter.length === 0) return;
        diffLines.push(`@@ -${hunkStart + 1},${hunkBefore.length} +${hunkStart + 1},${hunkAfter.length} @@`);
        for (const line of hunkBefore) diffLines.push(`-${line}`);
        for (const line of hunkAfter) diffLines.push(`+${line}`);
        hunkBefore = [];
        hunkAfter = [];
    };

    let i = 0;
    let j = 0;

    while (i < beforeLines.length || j < afterLines.length) {
        const bLine = i < beforeLines.length ? beforeLines[i] : undefined;
        const aLine = j < afterLines.length ? afterLines[j] : undefined;

        if (bLine === aLine) {
            // Lines match — context
            flushHunk();
            diffLines.push(` ${bLine ?? ''}`);
            i++;
            j++;
        } else if (bLine !== undefined && (aLine === undefined || beforeLines.indexOf(aLine!, i) >= 0)) {
            // Line removed
            if (hunkStart === -1) hunkStart = i;
            hunkBefore.push(bLine);
            i++;
        } else {
            // Line added
            if (hunkStart === -1) hunkStart = j;
            hunkAfter.push(aLine!);
            j++;
        }
    }

    flushHunk();

    return diffLines.join('\n');
}

/**
 * Count lines added/removed in a unified diff string.
 */
function countDiffLines(diff: string): { added: number; removed: number } {
    let added = 0;
    let removed = 0;
    for (const line of diff.split('\n')) {
        if (line.startsWith('+') && !line.startsWith('+++')) added++;
        if (line.startsWith('-') && !line.startsWith('---')) removed++;
    }
    return { added, removed };
}

// ==================== CODING AGENT SERVICE ====================

export class CodingAgentService {
    constructor(
        private llmService: LLMServiceLike,
        private database: Database,
        private ethicsEngine: EthicsEngine,
        private componentSchemaService: ComponentSchemaService,
        private eventBus: EventBus,
        private transparencyLogger: TransparencyLoggerLike,
        private outputChannel: OutputChannelLike
    ) {}

    // ==================== MAIN ENTRY POINT ====================

    /**
     * Process a natural-language command through the coding agent pipeline.
     *
     * Pipeline:
     *   1. Classify intent (keyword-first, LLM fallback)
     *   2. Ethics gate (block disallowed actions)
     *   3. Route to appropriate handler
     *   4. Build response with generated code, diffs, and explanations
     *   5. Emit events for real-time UI updates
     *
     * @param command   The user's natural-language command
     * @param context   Additional context (component IDs, page ID, plan ID, format)
     * @returns         CodingAgentResponse with generated code and metadata
     */
    async processCommand(
        command: string,
        context: {
            target_component_ids?: string[];
            page_id?: string | null;
            plan_id?: string | null;
            output_format?: CodingAgentRequest['output_format'];
            session_id?: string | null;
            constraints?: Record<string, unknown>;
        } = {}
    ): Promise<CodingAgentResponse> {
        const startTime = Date.now();
        const requestId = crypto.randomUUID();

        // Emit command received event
        this.emitEvent('coding_agent:command_received', {
            request_id: requestId,
            command,
            context,
        });

        this.outputChannel.appendLine(
            `[CodingAgent] Processing command: "${command.substring(0, 80)}${command.length > 80 ? '...' : ''}"`
        );

        try {
            // ── Step 1: Classify intent ──
            const classification = await this.classifyIntent(command);
            this.outputChannel.appendLine(
                `[CodingAgent] Intent: ${classification.intent} ` +
                `(confidence: ${classification.confidence}, method: ${classification.method})`
            );

            // Build the request object
            const request: CodingAgentRequest = {
                id: requestId,
                command,
                intent: classification.intent,
                target_component_ids: context.target_component_ids ?? [],
                page_id: context.page_id ?? null,
                plan_id: context.plan_id ?? null,
                output_format: context.output_format ?? 'react_tsx',
                constraints: context.constraints ?? {},
                session_id: context.session_id ?? null,
                created_at: new Date().toISOString(),
            };

            // ── Step 2: Ethics gate ──
            const ethicsContext: EthicsActionContext = {
                action: `coding_agent_${request.intent}`,
                source: 'coding_agent',
                targetEntityType: 'code',
                targetEntityId: request.target_component_ids[0] ?? undefined,
                metadata: {
                    command: request.command,
                    intent: request.intent,
                    output_format: request.output_format,
                },
            };

            const ethicsResult = await this.ethicsEngine.evaluateAction(ethicsContext);

            if (!ethicsResult.allowed) {
                this.outputChannel.appendLine(
                    `[CodingAgent] BLOCKED by ethics engine: ${ethicsResult.messages.join('; ')}`
                );

                return this.buildResponse(requestId, {
                    code: '',
                    language: request.output_format,
                    files: [],
                    explanation: `Action blocked by ethics engine: ${ethicsResult.messages.join('; ')}`,
                    warnings: ethicsResult.messages,
                    confidence: 0,
                }, startTime, 0, true);
            }

            // ── Step 3: Emit generating event ──
            this.emitEvent('coding_agent:generating', {
                request_id: requestId,
                intent: request.intent,
            });

            // ── Step 4: Route to handler ──
            let result: CodeGenResult;
            let tokensUsed = 0;

            switch (request.intent) {
                case 'build':
                    result = await this.handleBuild(request);
                    break;
                case 'modify':
                    result = await this.handleModify(request);
                    break;
                case 'explain': {
                    const explainResult = await this.handleExplain(request);
                    result = explainResult.result;
                    tokensUsed = explainResult.tokensUsed;
                    break;
                }
                case 'fix':
                    result = await this.handleFix(request);
                    break;
                case 'automate':
                    result = await this.handleAutomate(request);
                    break;
                case 'query':
                    result = this.handleQuery(request);
                    break;
                default:
                    result = {
                        code: '',
                        language: request.output_format,
                        files: [],
                        explanation: `Unknown intent: ${request.intent}`,
                        warnings: [`Unrecognized intent "${request.intent}"`],
                        confidence: 0,
                    };
            }

            // ── Step 5: Build and return response ──
            const response = this.buildResponse(
                requestId,
                result,
                startTime,
                tokensUsed,
                false
            );

            // ── Step 6: Emit completed event ──
            this.emitEvent('coding_agent:completed', {
                request_id: requestId,
                intent: request.intent,
                confidence: result.confidence,
                duration_ms: response.duration_ms,
                has_diff: response.diff !== null,
            });

            this.outputChannel.appendLine(
                `[CodingAgent] Completed: ${request.intent} (${response.duration_ms}ms, ` +
                `confidence: ${result.confidence}%, ${response.files.length} file(s))`
            );

            // Log to transparency
            this.logToTransparency(request, response);

            return response;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(
                `[CodingAgent] ERROR: ${errorMsg}`
            );

            return this.buildResponse(requestId, {
                code: '',
                language: context.output_format ?? 'react_tsx',
                files: [],
                explanation: `Error processing command: ${errorMsg}`,
                warnings: [errorMsg],
                confidence: 0,
            }, startTime, 0, false);
        }
    }

    // ==================== INTENT CLASSIFICATION ====================

    /**
     * Two-stage intent classification:
     *   Stage 1: Keyword scoring (fast, deterministic)
     *   Stage 2: LLM fallback (only if keyword scoring is ambiguous)
     *
     * @param command  The natural-language command to classify
     * @returns        Classification result with intent, confidence, and method
     */
    async classifyIntent(command: string): Promise<IntentClassification> {
        const normalizedCommand = command.toLowerCase().trim();

        // ── Stage 1: Keyword scoring ──
        const scores: Record<string, { score: number; keywords: string[] }> = {};

        for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
            const matchedKeywords: string[] = [];
            for (const keyword of keywords) {
                if (normalizedCommand.includes(keyword)) {
                    matchedKeywords.push(keyword);
                }
            }
            scores[intent] = { score: matchedKeywords.length, keywords: matchedKeywords };
        }

        // Find the top-scoring intent
        const sorted = Object.entries(scores).sort((a, b) => b[1].score - a[1].score);
        const topIntent = sorted[0];
        const secondIntent = sorted[1];

        // If top intent has >= threshold hits AND is clearly ahead of second place
        if (
            topIntent[1].score >= KEYWORD_CONFIDENCE_THRESHOLD &&
            topIntent[1].score > (secondIntent?.[1].score ?? 0)
        ) {
            const confidence = Math.min(100, 60 + topIntent[1].score * 15);
            return {
                intent: topIntent[0] as CodingAgentRequest['intent'],
                confidence,
                method: 'keyword',
                matchedKeywords: topIntent[1].keywords,
            };
        }

        // Single strong keyword hit with no competition
        if (topIntent[1].score === 1 && (secondIntent?.[1].score ?? 0) === 0) {
            return {
                intent: topIntent[0] as CodingAgentRequest['intent'],
                confidence: 60,
                method: 'keyword',
                matchedKeywords: topIntent[1].keywords,
            };
        }

        // ── Stage 2: LLM fallback ──
        try {
            const categories = Object.keys(INTENT_KEYWORDS);
            const classified = await this.llmService.classify(command, categories);
            const matchedIntent = categories.find(c => c === classified) ?? 'query';

            return {
                intent: matchedIntent as CodingAgentRequest['intent'],
                confidence: 70,
                method: 'llm',
                matchedKeywords: [],
            };
        } catch (error) {
            // LLM unavailable — fall back to best keyword guess or 'query'
            this.outputChannel.appendLine(
                `[CodingAgent] LLM classify failed, using keyword fallback: ${error}`
            );

            return {
                intent: topIntent[1].score > 0
                    ? topIntent[0] as CodingAgentRequest['intent']
                    : 'query',
                confidence: 30,
                method: 'keyword',
                matchedKeywords: topIntent[1].keywords,
            };
        }
    }

    // ==================== CODE GENERATION ====================

    /**
     * Generate code from component schemas.
     *
     * Takes an array of component IDs, resolves their schemas,
     * applies code templates, and composes output files.
     *
     * @param componentIds  Array of design component IDs from the database
     * @param format        Output format (react_tsx, html, css)
     * @returns             CodeGenResult with generated files
     */
    generateCode(
        componentIds: string[],
        format: CodingAgentRequest['output_format']
    ): CodeGenResult {
        const files: Array<{ name: string; content: string; language: string }> = [];
        const warnings: string[] = [];
        let mainCode = '';

        for (const componentId of componentIds) {
            // Look up the design component in the database
            const component = this.database.getDesignComponent(componentId);
            if (!component) {
                warnings.push(`Component not found: ${componentId}`);
                continue;
            }

            // Get the schema for this component type
            const schema = this.componentSchemaService.getSchema(component.type);
            if (!schema) {
                warnings.push(`No schema found for component type: ${component.type}`);
                continue;
            }

            // Get the template for the requested format
            const templateFormat = this.mapOutputFormat(format);
            const template = this.componentSchemaService.getCodeTemplate(
                component.type,
                templateFormat,
                component.props as Record<string, unknown>
            );

            if (!template) {
                warnings.push(`No ${templateFormat} template for component type: ${component.type}`);
                continue;
            }

            const fileName = this.generateFileName(component.type, format);
            files.push({
                name: fileName,
                content: template,
                language: this.formatToLanguage(format),
            });

            mainCode += template + '\n\n';
        }

        const confidence = componentIds.length > 0 && warnings.length === 0 ? 90
            : componentIds.length > 0 ? 70
            : 30;

        return {
            code: mainCode.trimEnd(),
            language: this.formatToLanguage(format),
            files,
            explanation: `Generated ${files.length} file(s) from ${componentIds.length} component(s)` +
                (warnings.length > 0 ? `. ${warnings.length} warning(s).` : '.'),
            warnings,
            confidence,
        };
    }

    // ==================== DIFF GENERATION ====================

    /**
     * Generate a unified diff between old and new code.
     * Deterministic — no LLM involved.
     *
     * @param oldCode    The original code
     * @param newCode    The modified code
     * @param entityType Entity being modified (e.g., 'component', 'page')
     * @param entityId   Entity ID
     * @param requestId  Source request ID
     * @returns          CodeDiff object ready for storage
     */
    generateDiff(
        oldCode: string,
        newCode: string,
        entityType: string = 'component',
        entityId: string = '',
        requestId: string = ''
    ): CodeDiff {
        const unified = generateUnifiedDiff(oldCode, newCode, `${entityType}/${entityId}`);
        const { added, removed } = countDiffLines(unified);

        const diff: CodeDiff = {
            id: crypto.randomUUID(),
            request_id: requestId,
            entity_type: entityType,
            entity_id: entityId,
            before: oldCode,
            after: newCode,
            unified_diff: unified,
            lines_added: added,
            lines_removed: removed,
            status: CodeDiffStatus.Pending,
            reviewed_by: null,
            review_comment: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };

        return diff;
    }

    // ==================== CODE EXPLANATION ====================

    /**
     * Generate a plain-language explanation of code via LLM.
     *
     * @param code     The code to explain
     * @param context  Additional context about the code
     * @returns        Human-readable explanation
     */
    async explainCode(code: string, context: string = ''): Promise<{ explanation: string; tokensUsed: number }> {
        const messages: LLMMessage[] = [
            {
                role: 'system',
                content:
                    'You are a code explanation assistant. Explain the following code in simple, ' +
                    'clear language. Focus on what the code does, not how it does it. ' +
                    'Use bullet points for clarity. Keep the explanation under 200 words.',
            },
            {
                role: 'user',
                content: context
                    ? `Context: ${context}\n\nCode:\n\`\`\`\n${code}\n\`\`\``
                    : `Explain this code:\n\`\`\`\n${code}\n\`\`\``,
            },
        ];

        const response = await this.llmService.chat(messages, {
            maxTokens: 500,
            temperature: 0.3,
            stream: false,
        });

        return {
            explanation: response.content.trim(),
            tokensUsed: response.tokens_used ?? 0,
        };
    }

    // ==================== LOGIC TREE BUILDING ====================

    /**
     * Convert natural language into a tree of LogicBlock objects via LLM.
     *
     * Example input: "When a user clicks the submit button, validate the form.
     *                  If validation passes, save the data. Otherwise, show errors."
     *
     * @param naturalLanguage  Plain English logic description
     * @param planId           Plan ID to associate the logic blocks with
     * @returns                Array of LogicBlock objects forming a tree
     */
    async buildLogicTree(
        naturalLanguage: string,
        planId: string
    ): Promise<LogicBlock[]> {
        const messages: LLMMessage[] = [
            {
                role: 'system',
                content:
                    'You are a logic tree builder. Convert the user\'s natural language description ' +
                    'into a structured logic tree. Output a JSON array of logic blocks.\n\n' +
                    'Each block has:\n' +
                    '  - type: "if" | "else_if" | "else" | "loop" | "action" | "event_handler" | "switch" | "case"\n' +
                    '  - label: Short display label\n' +
                    '  - condition: Boolean expression (empty for action/else)\n' +
                    '  - body: The action code or description\n' +
                    '  - parent_index: Index of parent block (-1 for top level)\n' +
                    '  - sort_order: Order within parent\n\n' +
                    'Respond with ONLY the JSON array, no markdown, no explanation.',
            },
            {
                role: 'user',
                content: naturalLanguage,
            },
        ];

        const response = await this.llmService.chat(messages, {
            maxTokens: 1000,
            temperature: 0.2,
            stream: false,
        });

        // Parse the LLM response
        let rawBlocks: Array<{
            type: string;
            label: string;
            condition: string;
            body: string;
            parent_index: number;
            sort_order: number;
        }>;

        try {
            // Try to extract JSON from the response (strip markdown fences if present)
            let jsonStr = response.content.trim();
            if (jsonStr.startsWith('```')) {
                jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
            }
            rawBlocks = JSON.parse(jsonStr);
        } catch {
            this.outputChannel.appendLine(
                `[CodingAgent] Failed to parse logic tree from LLM response. Creating fallback.`
            );
            // Fallback: create a single action block with the natural language as body
            return [this.createLogicBlock(planId, {
                type: LogicBlockType.Action,
                label: 'Action',
                condition: '',
                body: naturalLanguage,
                parent_block_id: null,
                sort_order: 0,
            })];
        }

        // Convert raw blocks into LogicBlock objects with proper parent relationships
        const blocks: LogicBlock[] = [];
        const idMap = new Map<number, string>(); // raw index → generated ID

        for (let i = 0; i < rawBlocks.length; i++) {
            const raw = rawBlocks[i];
            const blockType = this.parseLogicBlockType(raw.type);
            const parentIndex = raw.parent_index ?? -1;
            const parentId = parentIndex >= 0 ? (idMap.get(parentIndex) ?? null) : null;

            const block = this.createLogicBlock(planId, {
                type: blockType,
                label: raw.label || `Block ${i + 1}`,
                condition: raw.condition || '',
                body: raw.body || '',
                parent_block_id: parentId,
                sort_order: raw.sort_order ?? i,
            });

            idMap.set(i, block.id);
            blocks.push(block);
        }

        this.outputChannel.appendLine(
            `[CodingAgent] Built logic tree: ${blocks.length} block(s) from natural language`
        );

        return blocks;
    }

    // ==================== INTENT HANDLERS ====================

    /**
     * Handle 'build' intent — generate new code from component schemas.
     */
    private async handleBuild(request: CodingAgentRequest): Promise<CodeGenResult> {
        if (request.target_component_ids.length > 0) {
            return this.generateCode(request.target_component_ids, request.output_format);
        }

        // No specific components — try to extract component type from command
        const allSchemas = this.componentSchemaService.getAllSchemas();
        const normalizedCmd = request.command.toLowerCase();

        for (const schema of allSchemas) {
            if (
                normalizedCmd.includes(schema.type.replace(/_/g, ' ')) ||
                normalizedCmd.includes(schema.display_name.toLowerCase())
            ) {
                const template = this.componentSchemaService.getCodeTemplate(
                    schema.type,
                    this.mapOutputFormat(request.output_format)
                );

                if (template) {
                    return {
                        code: template,
                        language: this.formatToLanguage(request.output_format),
                        files: [{
                            name: this.generateFileName(schema.type, request.output_format),
                            content: template,
                            language: this.formatToLanguage(request.output_format),
                        }],
                        explanation: `Generated ${schema.display_name} component using the ${request.output_format} template.`,
                        warnings: [],
                        confidence: 85,
                    };
                }
            }
        }

        // Fallback: use LLM to generate code
        return this.llmGenerateCode(request);
    }

    /**
     * Handle 'modify' intent — modify existing component code.
     */
    private async handleModify(request: CodingAgentRequest): Promise<CodeGenResult> {
        if (request.target_component_ids.length === 0) {
            return {
                code: '',
                language: this.formatToLanguage(request.output_format),
                files: [],
                explanation: 'No target components specified for modification.',
                warnings: ['Please specify which component(s) to modify.'],
                confidence: 0,
            };
        }

        const componentId = request.target_component_ids[0];
        const component = this.database.getDesignComponent(componentId);

        if (!component) {
            return {
                code: '',
                language: this.formatToLanguage(request.output_format),
                files: [],
                explanation: `Component ${componentId} not found.`,
                warnings: [`Component not found: ${componentId}`],
                confidence: 0,
            };
        }

        // Get current code
        const schema = this.componentSchemaService.getSchema(component.type);
        const currentCode = schema
            ? (this.componentSchemaService.getCodeTemplate(
                component.type,
                this.mapOutputFormat(request.output_format),
                component.props as Record<string, unknown>
            ) ?? '')
            : '';

        // Use LLM to apply the modification
        const modifyResult = await this.llmModifyCode(currentCode, request);

        // Generate diff
        if (currentCode && modifyResult.code) {
            const diff = this.generateDiff(
                currentCode,
                modifyResult.code,
                'component',
                componentId,
                request.id
            );

            // Store the diff
            this.database.createCodeDiff({
                request_id: request.id,
                entity_type: 'component',
                entity_id: componentId,
                before: diff.before,
                after: diff.after,
                unified_diff: diff.unified_diff,
                lines_added: diff.lines_added,
                lines_removed: diff.lines_removed,
                status: CodeDiffStatus.Pending,
                reviewed_by: null,
                review_comment: null,
            });

            // Emit diff pending event
            this.emitEvent('coding_agent:diff_pending', {
                request_id: request.id,
                diff_id: diff.id,
                entity_type: 'component',
                entity_id: componentId,
                lines_added: diff.lines_added,
                lines_removed: diff.lines_removed,
            });

            modifyResult.warnings.push('Code diff generated. Requires approval before applying.');
        }

        return modifyResult;
    }

    /**
     * Handle 'explain' intent — explain code or components.
     */
    private async handleExplain(
        request: CodingAgentRequest
    ): Promise<{ result: CodeGenResult; tokensUsed: number }> {
        let codeToExplain = '';
        let context = request.command;

        if (request.target_component_ids.length > 0) {
            const componentId = request.target_component_ids[0];
            const component = this.database.getDesignComponent(componentId);

            if (component) {
                const schema = this.componentSchemaService.getSchema(component.type);
                codeToExplain = schema
                    ? (this.componentSchemaService.getCodeTemplate(
                        component.type,
                        this.mapOutputFormat(request.output_format),
                        component.props as Record<string, unknown>
                    ) ?? '')
                    : JSON.stringify(component, null, 2);

                context = `Component: ${component.type} (${component.name})`;
            }
        }

        if (!codeToExplain) {
            // Extract code from the command itself (if it contains code)
            const codeMatch = request.command.match(/```[\s\S]*?```/);
            if (codeMatch) {
                codeToExplain = codeMatch[0].replace(/^```\w*\n?/, '').replace(/```$/, '');
            }
        }

        if (!codeToExplain) {
            return {
                result: {
                    code: '',
                    language: 'text',
                    files: [],
                    explanation: 'No code found to explain. Please provide code or select a component.',
                    warnings: ['No code or component specified for explanation.'],
                    confidence: 0,
                },
                tokensUsed: 0,
            };
        }

        this.emitEvent('coding_agent:explaining', {
            request_id: request.id,
        });

        const { explanation, tokensUsed } = await this.explainCode(codeToExplain, context);

        return {
            result: {
                code: codeToExplain,
                language: this.formatToLanguage(request.output_format),
                files: [],
                explanation,
                warnings: [],
                confidence: 85,
            },
            tokensUsed,
        };
    }

    /**
     * Handle 'fix' intent — diagnose and fix issues.
     */
    private async handleFix(request: CodingAgentRequest): Promise<CodeGenResult> {
        if (request.target_component_ids.length === 0) {
            return {
                code: '',
                language: this.formatToLanguage(request.output_format),
                files: [],
                explanation: 'No target component specified for fixing. Please select a component.',
                warnings: ['No component selected.'],
                confidence: 0,
            };
        }

        // Delegate to modify handler with fix context
        return this.handleModify(request);
    }

    /**
     * Handle 'automate' intent — build logic trees from natural language.
     */
    private async handleAutomate(request: CodingAgentRequest): Promise<CodeGenResult> {
        const planId = request.plan_id ?? 'default';

        try {
            const blocks = await this.buildLogicTree(request.command, planId);

            // Store the blocks in the database
            for (const block of blocks) {
                this.database.createLogicBlock({
                    plan_id: planId,
                    type: block.type,
                    label: block.label,
                    condition: block.condition,
                    body: block.body,
                    parent_block_id: block.parent_block_id,
                    sort_order: block.sort_order,
                });
            }

            // Generate code representation
            const codeRepresentation = blocks.map(b => {
                switch (b.type) {
                    case LogicBlockType.If:
                        return `if (${b.condition}) {\n  ${b.body}\n}`;
                    case LogicBlockType.ElseIf:
                        return `else if (${b.condition}) {\n  ${b.body}\n}`;
                    case LogicBlockType.Else:
                        return `else {\n  ${b.body}\n}`;
                    case LogicBlockType.Loop:
                        return `while (${b.condition}) {\n  ${b.body}\n}`;
                    case LogicBlockType.Action:
                        return `// ${b.label}\n${b.body}`;
                    case LogicBlockType.EventHandler:
                        return `on("${b.condition}", () => {\n  ${b.body}\n})`;
                    case LogicBlockType.Switch:
                        return `switch (${b.condition}) {\n  ${b.body}\n}`;
                    case LogicBlockType.Case:
                        return `case ${b.condition}:\n  ${b.body}\n  break;`;
                    default:
                        return `// ${b.label}: ${b.body}`;
                }
            }).join('\n\n');

            return {
                code: codeRepresentation,
                language: 'typescript',
                files: [{
                    name: 'logic-tree.ts',
                    content: codeRepresentation,
                    language: 'typescript',
                }],
                explanation: `Created ${blocks.length} logic block(s) from your automation description.`,
                warnings: [],
                confidence: 80,
            };
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return {
                code: '',
                language: 'typescript',
                files: [],
                explanation: `Failed to build automation logic: ${msg}`,
                warnings: [msg],
                confidence: 0,
            };
        }
    }

    /**
     * Handle 'query' intent — search and list components/entities.
     * Deterministic — no LLM needed.
     */
    private handleQuery(request: CodingAgentRequest): CodeGenResult {
        const normalizedCmd = request.command.toLowerCase();
        const results: string[] = [];

        // Query component schemas
        if (normalizedCmd.includes('component') || normalizedCmd.includes('schema')) {
            const schemas = this.componentSchemaService.getAllSchemas();
            results.push(`Found ${schemas.length} component schemas:`);
            for (const schema of schemas) {
                results.push(`  - ${schema.display_name} (${schema.type}) [${schema.category}]`);
            }
        }

        // Query code diffs
        if (normalizedCmd.includes('diff') || normalizedCmd.includes('change')) {
            const pendingDiffs = this.database.getPendingCodeDiffs();
            results.push(`\nPending code diffs: ${pendingDiffs.length}`);
            for (const diff of pendingDiffs) {
                results.push(`  - ${diff.entity_type}/${diff.entity_id}: +${diff.lines_added}/-${diff.lines_removed}`);
            }
        }

        // Query logic blocks
        if (normalizedCmd.includes('logic') || normalizedCmd.includes('automation') || normalizedCmd.includes('rule')) {
            if (request.plan_id) {
                const blocks = this.database.getLogicBlocksByPlan(request.plan_id);
                results.push(`\nLogic blocks in plan: ${blocks.length}`);
                for (const block of blocks) {
                    results.push(`  - [${block.type}] ${block.label}: ${block.condition || block.body}`);
                }
            }
        }

        if (results.length === 0) {
            results.push('No matching results found. Try querying for: components, diffs, logic blocks.');
        }

        const output = results.join('\n');

        return {
            code: output,
            language: 'text',
            files: [],
            explanation: output,
            warnings: [],
            confidence: 90,
        };
    }

    // ==================== LLM HELPERS ====================

    /**
     * Use LLM to generate code when templates aren't available.
     */
    private async llmGenerateCode(request: CodingAgentRequest): Promise<CodeGenResult> {
        const messages: LLMMessage[] = [
            {
                role: 'system',
                content:
                    `You are a code generator for a visual program designer. Generate clean, ` +
                    `well-structured ${request.output_format} code based on the user's request. ` +
                    `Include appropriate comments. Output ONLY the code, no markdown fences or explanations.`,
            },
            {
                role: 'user',
                content: request.command,
            },
        ];

        try {
            const response = await this.llmService.chat(messages, {
                maxTokens: 2000,
                temperature: 0.3,
                stream: false,
            });

            let code = response.content.trim();
            // Strip markdown fences if present
            if (code.startsWith('```')) {
                code = code.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
            }

            return {
                code,
                language: this.formatToLanguage(request.output_format),
                files: [{
                    name: `generated.${this.formatToExtension(request.output_format)}`,
                    content: code,
                    language: this.formatToLanguage(request.output_format),
                }],
                explanation: 'Code generated via LLM based on your description.',
                warnings: ['This code was generated by AI and should be reviewed before use.'],
                confidence: 65,
            };
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return {
                code: '',
                language: this.formatToLanguage(request.output_format),
                files: [],
                explanation: `LLM code generation failed: ${msg}`,
                warnings: [msg],
                confidence: 0,
            };
        }
    }

    /**
     * Use LLM to modify existing code.
     */
    private async llmModifyCode(
        currentCode: string,
        request: CodingAgentRequest
    ): Promise<CodeGenResult> {
        const messages: LLMMessage[] = [
            {
                role: 'system',
                content:
                    `You are a code modification assistant. The user wants to modify existing code. ` +
                    `Apply the requested changes and output ONLY the modified code. ` +
                    `Preserve the existing structure as much as possible. No markdown fences.`,
            },
            {
                role: 'user',
                content: `Current code:\n${currentCode}\n\nRequested change: ${request.command}`,
            },
        ];

        try {
            const response = await this.llmService.chat(messages, {
                maxTokens: 2000,
                temperature: 0.2,
                stream: false,
            });

            let code = response.content.trim();
            if (code.startsWith('```')) {
                code = code.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
            }

            return {
                code,
                language: this.formatToLanguage(request.output_format),
                files: [{
                    name: `modified.${this.formatToExtension(request.output_format)}`,
                    content: code,
                    language: this.formatToLanguage(request.output_format),
                }],
                explanation: 'Code modified via LLM based on your description.',
                warnings: ['Modified code requires review before applying.'],
                confidence: 65,
            };
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return {
                code: currentCode,
                language: this.formatToLanguage(request.output_format),
                files: [],
                explanation: `Code modification failed: ${msg}`,
                warnings: [msg],
                confidence: 0,
            };
        }
    }

    // ==================== APPROVAL FLOW ====================

    /**
     * Approve a pending code diff.
     *
     * @param diffId     The diff ID to approve
     * @param reviewedBy Who approved it
     * @param comment    Optional review comment
     */
    approveDiff(diffId: string, reviewedBy: string, comment?: string): CodeDiff | null {
        const diff = this.database.getCodeDiff(diffId);
        if (!diff) return null;

        const updated = this.database.updateCodeDiff(diffId, {
            status: CodeDiffStatus.Approved,
            reviewed_by: reviewedBy,
            review_comment: comment ?? null,
        });

        if (updated) {
            this.emitEvent('coding_agent:diff_approved', {
                diff_id: diffId,
                reviewed_by: reviewedBy,
                entity_type: diff.entity_type,
                entity_id: diff.entity_id,
            });

            this.outputChannel.appendLine(
                `[CodingAgent] Diff ${diffId} approved by ${reviewedBy}`
            );
        }

        return updated;
    }

    /**
     * Reject a pending code diff.
     *
     * @param diffId     The diff ID to reject
     * @param reviewedBy Who rejected it
     * @param comment    Rejection reason
     */
    rejectDiff(diffId: string, reviewedBy: string, comment: string): CodeDiff | null {
        const diff = this.database.getCodeDiff(diffId);
        if (!diff) return null;

        const updated = this.database.updateCodeDiff(diffId, {
            status: CodeDiffStatus.Rejected,
            reviewed_by: reviewedBy,
            review_comment: comment,
        });

        if (updated) {
            this.emitEvent('coding_agent:diff_rejected', {
                diff_id: diffId,
                reviewed_by: reviewedBy,
                reason: comment,
                entity_type: diff.entity_type,
                entity_id: diff.entity_id,
            });

            this.outputChannel.appendLine(
                `[CodingAgent] Diff ${diffId} rejected by ${reviewedBy}: ${comment}`
            );
        }

        return updated;
    }

    // ==================== PRIVATE HELPERS ====================

    /**
     * Build a CodingAgentResponse from a CodeGenResult.
     */
    private buildResponse(
        requestId: string,
        result: CodeGenResult,
        startTime: number,
        tokensUsed: number,
        requiresApproval: boolean
    ): CodingAgentResponse {
        return {
            id: crypto.randomUUID(),
            request_id: requestId,
            code: result.code,
            language: result.language,
            explanation: result.explanation,
            files: result.files,
            confidence: result.confidence,
            warnings: result.warnings,
            requires_approval: requiresApproval || result.warnings.some(w =>
                w.includes('requires approval') || w.includes('Requires approval')
            ),
            diff: null, // Diffs are stored separately and linked via request_id
            tokens_used: tokensUsed,
            duration_ms: Date.now() - startTime,
            created_at: new Date().toISOString(),
        };
    }

    /**
     * Create a LogicBlock object (not saved to DB, caller handles persistence).
     */
    private createLogicBlock(
        planId: string,
        data: {
            type: LogicBlockType;
            label: string;
            condition: string;
            body: string;
            parent_block_id: string | null;
            sort_order: number;
        }
    ): LogicBlock {
        return {
            id: crypto.randomUUID(),
            page_id: null,
            component_id: null,
            plan_id: planId,
            type: data.type,
            label: data.label,
            condition: data.condition,
            body: data.body,
            parent_block_id: data.parent_block_id,
            sort_order: data.sort_order,
            generated_code: '',
            x: 0,
            y: data.sort_order * 120,
            width: 280,
            height: 100,
            collapsed: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
    }

    /**
     * Parse a string into a LogicBlockType enum value.
     */
    private parseLogicBlockType(type: string): LogicBlockType {
        const normalized = type.toLowerCase().trim();
        const mapping: Record<string, LogicBlockType> = {
            'if': LogicBlockType.If,
            'else_if': LogicBlockType.ElseIf,
            'elseif': LogicBlockType.ElseIf,
            'else': LogicBlockType.Else,
            'loop': LogicBlockType.Loop,
            'while': LogicBlockType.Loop,
            'for': LogicBlockType.Loop,
            'action': LogicBlockType.Action,
            'event_handler': LogicBlockType.EventHandler,
            'event': LogicBlockType.EventHandler,
            'handler': LogicBlockType.EventHandler,
            'switch': LogicBlockType.Switch,
            'case': LogicBlockType.Case,
        };
        return mapping[normalized] ?? LogicBlockType.Action;
    }

    /**
     * Map CodingAgentRequest output_format to component schema template format.
     */
    private mapOutputFormat(format: CodingAgentRequest['output_format']): 'react_tsx' | 'html' | 'css' {
        switch (format) {
            case 'react_tsx':
            case 'typescript':
                return 'react_tsx';
            case 'html':
                return 'html';
            case 'css':
                return 'css';
            case 'json':
                return 'react_tsx'; // Default to react for JSON format
            default:
                return 'react_tsx';
        }
    }

    /**
     * Map output format to language name.
     */
    private formatToLanguage(format: CodingAgentRequest['output_format']): string {
        const map: Record<string, string> = {
            react_tsx: 'typescript',
            html: 'html',
            css: 'css',
            typescript: 'typescript',
            json: 'json',
        };
        return map[format] ?? 'text';
    }

    /**
     * Map output format to file extension.
     */
    private formatToExtension(format: CodingAgentRequest['output_format']): string {
        const map: Record<string, string> = {
            react_tsx: 'tsx',
            html: 'html',
            css: 'css',
            typescript: 'ts',
            json: 'json',
        };
        return map[format] ?? 'txt';
    }

    /**
     * Generate a filename for a component.
     */
    private generateFileName(
        componentType: string,
        format: CodingAgentRequest['output_format']
    ): string {
        const ext = this.formatToExtension(format);
        const name = componentType.replace(/_/g, '-');
        return `${name}.${ext}`;
    }

    /**
     * Emit an event via the EventBus.
     */
    private emitEvent(type: string, data: Record<string, unknown>): void {
        try {
            this.eventBus.emit(type as any, 'coding_agent', data);
        } catch (err) {
            this.outputChannel.appendLine(
                `[CodingAgent] WARNING: Failed to emit ${type}: ${err}`
            );
        }
    }

    /**
     * Log a completed request/response to the transparency logger.
     */
    private logToTransparency(
        request: CodingAgentRequest,
        response: CodingAgentResponse
    ): void {
        try {
            this.transparencyLogger.log({
                source: 'coding_agent',
                category: 'code_generation',
                action: `${request.intent}: ${request.command.substring(0, 100)}`,
                detail: JSON.stringify({
                    request_id: request.id,
                    response_id: response.id,
                    intent: request.intent,
                    confidence: response.confidence,
                    files_count: response.files.length,
                    tokens_used: response.tokens_used,
                    duration_ms: response.duration_ms,
                }),
                severity: response.confidence >= 50 ? 'info' : 'warning',
                entityType: 'coding_agent_request',
                entityId: request.id,
            });
        } catch (err) {
            this.outputChannel.appendLine(
                `[CodingAgent] WARNING: Transparency log failed: ${err}`
            );
        }
    }
}
