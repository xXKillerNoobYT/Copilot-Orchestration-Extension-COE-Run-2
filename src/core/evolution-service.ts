import * as vscode from 'vscode';
import { Database } from './database';
import { ConfigManager } from './config';
import { LLMService } from './llm-service';

interface DetectedPattern {
    signature: string;
    frequency: number;
    severity: number;
    score: number;
    examples: string[];
}

interface EvolutionProposal {
    pattern: string;
    proposal: string;
    affectsP1: boolean;
}

export class EvolutionService {
    private callCounter = 0;
    private readonly checkInterval = 20; // every 20 AI calls, run pattern detection

    constructor(
        private database: Database,
        private config: ConfigManager,
        private llm: LLMService,
        private outputChannel: vscode.OutputChannel
    ) {}

    incrementCallCounter(): void {
        this.callCounter++;
        if (this.callCounter >= this.checkInterval) {
            this.callCounter = 0;
            // Fire and forget — don't block the caller
            this.detectPatterns().catch(err =>
                this.outputChannel.appendLine(`Evolution pattern detection error: ${err}`)
            );
        }
    }

    async detectPatterns(): Promise<DetectedPattern[]> {
        const auditLog = this.database.getAuditLog(200);

        // Group errors by signature (action + first 50 chars of detail)
        const errorGroups = new Map<string, { count: number; severity: number; examples: string[] }>();

        for (const entry of auditLog) {
            if (entry.action === 'error' || entry.detail.toLowerCase().includes('failed') || entry.detail.toLowerCase().includes('timeout')) {
                const signature = `${entry.action}:${entry.detail.substring(0, 50)}`;
                const existing = errorGroups.get(signature);
                if (existing) {
                    existing.count++;
                    if (existing.examples.length < 3) existing.examples.push(entry.detail);
                } else {
                    const severity = entry.detail.toLowerCase().includes('critical') ? 3
                        : entry.detail.toLowerCase().includes('timeout') ? 2
                        : 1;
                    errorGroups.set(signature, { count: 1, severity, examples: [entry.detail] });
                }
            }
        }

        // Score each pattern: frequency * severity
        const patterns: DetectedPattern[] = [];
        for (const [signature, data] of errorGroups) {
            const score = data.count * data.severity;
            if (score >= 9) { // Threshold: only significant patterns
                patterns.push({
                    signature,
                    frequency: data.count,
                    severity: data.severity,
                    score,
                    examples: data.examples,
                });
            }
        }

        // Sort by score descending
        patterns.sort((a, b) => b.score - a.score);

        this.outputChannel.appendLine(`Evolution: detected ${patterns.length} significant patterns`);

        // Generate proposals for top patterns
        for (const pattern of patterns.slice(0, 3)) {
            try {
                await this.generateProposal(pattern);
            } catch (err) {
                this.outputChannel.appendLine(`Evolution proposal generation failed: ${err}`);
            }
        }

        return patterns;
    }

    private async generateProposal(pattern: DetectedPattern): Promise<EvolutionProposal | null> {
        // Check if we already have a proposal for this pattern
        const existingLog = this.database.getEvolutionLog(50);
        const alreadyProposed = existingLog.some(e =>
            e.pattern === pattern.signature && (e.status === 'proposed' || e.status === 'applied')
        );
        if (alreadyProposed) return null;

        try {
            const response = await this.llm.chat([
                {
                    role: 'system',
                    content: `You are the Evolution Agent for COE. Given a recurring error pattern, propose a minimal, safe fix. Respond in JSON: {"proposal": "one sentence describing the fix", "affects_p1": true/false, "change_type": "config|prompt|threshold|routing"}`
                },
                {
                    role: 'user',
                    content: `Pattern: ${pattern.signature}\nFrequency: ${pattern.frequency} times\nSeverity: ${pattern.severity}/3\nExamples:\n${pattern.examples.join('\n')}`
                }
            ], { maxTokens: 200, temperature: 0.3, stream: false });

            const match = response.content.match(/\{[\s\S]*\}/);
            if (!match) return null;

            const parsed = JSON.parse(match[0]);
            const proposal: EvolutionProposal = {
                pattern: pattern.signature,
                proposal: parsed.proposal || 'No proposal generated',
                affectsP1: parsed.affects_p1 === true,
            };

            // Store in evolution log
            const entry = this.database.addEvolutionEntry(pattern.signature, proposal.proposal);

            if (!proposal.affectsP1) {
                // Auto-apply non-P1 changes
                this.database.updateEvolutionEntry(entry.id, 'applied', 'Auto-applied (non-P1)');
                this.outputChannel.appendLine(`Evolution: auto-applied fix for "${pattern.signature}"`);
            } else {
                // P1 changes need human approval — create a ticket
                this.database.createTicket({
                    title: `[Evolution] Proposed fix: ${proposal.proposal.substring(0, 60)}`,
                    body: `The Evolution System detected a recurring pattern and proposes a fix.\n\nPattern: ${pattern.signature}\nFrequency: ${pattern.frequency} occurrences\nProposal: ${proposal.proposal}\n\nApprove this change? Reply "approved" to apply or "rejected" to dismiss.`,
                    priority: 'P1' as any,
                    creator: 'Evolution System',
                });
                this.outputChannel.appendLine(`Evolution: P1 proposal created for "${pattern.signature}" — awaiting human approval`);
            }

            return proposal;
        } catch (err) {
            this.outputChannel.appendLine(`Evolution proposal error: ${err}`);
            return null;
        }
    }

    async monitorAppliedChanges(): Promise<void> {
        const appliedEntries = this.database.getEvolutionLog(50)
            .filter(e => e.status === 'applied' && e.applied_at);

        for (const entry of appliedEntries) {
            if (!entry.applied_at) continue;

            const appliedTime = new Date(entry.applied_at).getTime();
            const hoursSinceApplied = (Date.now() - appliedTime) / (1000 * 60 * 60);

            // 48-hour monitoring window
            if (hoursSinceApplied >= 48 && !entry.result?.includes('monitored')) {
                // Check if the pattern is still occurring
                const recentAudit = this.database.getAuditLog(100);
                const stillOccurring = recentAudit.some(a =>
                    a.detail.includes(entry.pattern.substring(0, 30)) &&
                    new Date(a.created_at).getTime() > appliedTime
                );

                if (stillOccurring) {
                    // Rollback — problem not fixed
                    this.database.updateEvolutionEntry(entry.id, 'rolled_back', 'Pattern still occurring after 48h monitoring');
                    this.outputChannel.appendLine(`Evolution: rolled back "${entry.pattern}" — pattern still occurring`);
                } else {
                    // Success — mark as monitored
                    this.database.updateEvolutionEntry(entry.id, 'applied', 'monitored: pattern resolved');
                    this.outputChannel.appendLine(`Evolution: confirmed fix for "${entry.pattern}" — pattern resolved`);
                }
            }
        }
    }

    getCallCounter(): number {
        return this.callCounter;
    }
}
