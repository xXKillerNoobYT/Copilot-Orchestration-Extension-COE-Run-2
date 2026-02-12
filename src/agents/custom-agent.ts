import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { BaseAgent } from './base-agent';
import {
    AgentType, AgentContext, AgentResponse, AgentStatus,
    CustomAgentConfig, ConversationRole
} from '../types';
import { Database } from '../core/database';
import { LLMService } from '../core/llm-service';
import { ConfigManager } from '../core/config';
import * as vscode from 'vscode';

export class CustomAgentRunner extends BaseAgent {
    readonly name = 'Custom Agent Runner';
    readonly type = AgentType.Custom;
    readonly systemPrompt = 'You manage and execute user-created custom agents.';

    private customAgentsDir: string;

    constructor(
        database: Database,
        llm: LLMService,
        config: ConfigManager,
        outputChannel: vscode.OutputChannel
    ) {
        super(database, llm, config, outputChannel);
        this.customAgentsDir = path.join(config.getCOEDir(), 'agents', 'custom');
    }

    async initialize(): Promise<void> {
        await super.initialize();
        if (!fs.existsSync(this.customAgentsDir)) {
            fs.mkdirSync(this.customAgentsDir, { recursive: true });
        }
    }

    async runCustomAgent(agentName: string, message: string, context: AgentContext): Promise<AgentResponse> {
        const config = this.loadAgentConfig(agentName);
        if (!config) {
            return { content: `Custom agent not found: ${agentName}` };
        }

        // HARDLOCK CHECK — custom agents NEVER write or execute
        if (config.permissions.writeFiles || config.permissions.executeCode) {
            this.database.addAuditLog(this.name, 'hardlock_block',
                `BLOCKED: Agent "${agentName}" attempted write/execute permission`);
            return { content: `BLOCKED: Custom agents cannot write files or execute code.` };
        }

        this.database.updateAgentStatus(agentName, AgentStatus.Working);
        this.database.addAuditLog(this.name, 'custom_agent_start',
            `Running custom agent "${agentName}": ${message.substring(0, 80)}`);

        const startTime = Date.now();
        let llmCallCount = 0;
        const results: string[] = [];

        try {
            // Process each goal in priority order
            const sortedGoals = [...config.goals].sort((a, b) => a.priority - b.priority);
            const maxGoals = Math.min(sortedGoals.length, config.limits.maxGoals);

            for (let i = 0; i < maxGoals; i++) {
                const goal = sortedGoals[i];

                // Time budget check
                const elapsed = (Date.now() - startTime) / 1000 / 60;
                if (elapsed > config.limits.maxTimeMinutes) {
                    this.database.addAuditLog(this.name, 'custom_agent_timeout',
                        `Agent "${agentName}" timed out at ${elapsed.toFixed(1)} min`);
                    break;
                }

                // LLM call budget check
                if (llmCallCount >= config.limits.maxLLMCalls) {
                    this.database.addAuditLog(this.name, 'custom_agent_budget',
                        `Agent "${agentName}" exceeded LLM call limit (${config.limits.maxLLMCalls})`);
                    break;
                }

                // Per-goal timeout
                const goalStart = Date.now();
                const goalTimeoutMs = config.limits.timePerGoalMinutes * 60 * 1000;

                try {
                    const goalResponse = await Promise.race([
                        this.llm.chat([
                            { role: 'system', content: config.systemPrompt },
                            { role: 'user', content: `Goal ${i + 1}: ${goal.description}\n\nContext: ${message}\n\nChecklist:\n${config.checklist.map(c => `- ${c.item}`).join('\n')}` },
                        ], { maxTokens: this.config.getAgentContextLimit('custom') }),
                        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Goal timeout')), goalTimeoutMs)),
                    ]);

                    llmCallCount++;
                    results.push(`Goal ${i + 1} (${goal.description}): ${goalResponse.content}`);

                    // Loop detection: check if response is too similar to previous
                    if (results.length >= 3) {
                        const last3 = results.slice(-3);
                        const similarity = this.checkSimilarity(last3);
                        if (similarity > 0.85) {
                            this.database.addAuditLog(this.name, 'custom_agent_loop',
                                `Agent "${agentName}" detected loop at goal ${i + 1}`);
                            break;
                        }
                    }

                    this.database.addConversation(
                        agentName,
                        ConversationRole.Agent,
                        goalResponse.content,
                        context.task?.id,
                        context.ticket?.id,
                        goalResponse.tokens_used
                    );

                } catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    this.outputChannel.appendLine(`Custom agent goal ${i + 1} error: ${msg}`);
                    results.push(`Goal ${i + 1} (${goal.description}): ERROR - ${msg}`);
                }
            }
        } finally {
            this.database.updateAgentStatus(agentName, AgentStatus.Idle);
            const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
            this.database.addAuditLog(this.name, 'custom_agent_complete',
                `Agent "${agentName}" completed: ${results.length} goals, ${llmCallCount} LLM calls, ${totalTime}s`);
        }

        return {
            content: results.join('\n\n---\n\n'),
            tokensUsed: llmCallCount,
        };
    }

    private loadAgentConfig(name: string): CustomAgentConfig | null {
        const filePath = path.join(this.customAgentsDir, `${name}.yaml`);
        if (!fs.existsSync(filePath)) {
            // Try .yml extension
            const altPath = path.join(this.customAgentsDir, `${name}.yml`);
            if (!fs.existsSync(altPath)) return null;
            return this.parseYaml(altPath);
        }
        return this.parseYaml(filePath);
    }

    private parseYaml(filePath: string): CustomAgentConfig | null {
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed = yaml.load(raw) as Record<string, unknown>;

            // Force hardlock permissions
            return {
                name: (parsed.name as string) || path.basename(filePath, path.extname(filePath)),
                description: (parsed.description as string) || '',
                systemPrompt: (parsed.systemPrompt as string) || (parsed.system_prompt as string) || '',
                goals: (parsed.goals as CustomAgentConfig['goals']) || [],
                checklist: (parsed.checklist as CustomAgentConfig['checklist']) || [],
                routingKeywords: (parsed.routingKeywords as string[]) || (parsed.routing_keywords as string[]) || [],
                permissions: {
                    readFiles: true,
                    searchCode: true,
                    createTickets: true,
                    callLLM: true,
                    writeFiles: false,   // HARDLOCKED
                    executeCode: false,  // HARDLOCKED
                },
                limits: {
                    maxGoals: Math.min((parsed.limits as any)?.maxGoals || 20, 20),
                    maxLLMCalls: Math.min((parsed.limits as any)?.maxLLMCalls || 50, 50),
                    maxTimeMinutes: Math.min((parsed.limits as any)?.maxTimeMinutes || 30, 30),
                    timePerGoalMinutes: Math.min((parsed.limits as any)?.timePerGoalMinutes || 5, 5),
                },
            };
        } catch (error) {
            this.outputChannel.appendLine(`Error loading custom agent YAML: ${error}`);
            return null;
        }
    }

    private checkSimilarity(texts: string[]): number {
        if (texts.length < 2) return 0;
        // Simple similarity: check if last entry is very similar to previous ones
        const last = texts[texts.length - 1].toLowerCase();
        const prev = texts[texts.length - 2].toLowerCase();
        const words1 = new Set(last.split(/\s+/));
        const words2 = new Set(prev.split(/\s+/));
        const intersection = new Set([...words1].filter(w => words2.has(w)));
        const union = new Set([...words1, ...words2]);
        return union.size > 0 ? intersection.size / union.size : 0;
    }

    listCustomAgents(): string[] {
        if (!fs.existsSync(this.customAgentsDir)) return [];
        return fs.readdirSync(this.customAgentsDir)
            .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
            .map(f => path.basename(f, path.extname(f)));
    }

    saveCustomAgent(config: CustomAgentConfig): void {
        // Force hardlock
        config.permissions.writeFiles = false;
        config.permissions.executeCode = false;

        const filePath = path.join(this.customAgentsDir, `${config.name}.yaml`);
        fs.writeFileSync(filePath, yaml.dump(config), 'utf-8');
        this.database.registerAgent(config.name, AgentType.Custom, yaml.dump(config));
        this.database.addAuditLog(this.name, 'custom_agent_saved', `Custom agent "${config.name}" saved`);
    }
}
