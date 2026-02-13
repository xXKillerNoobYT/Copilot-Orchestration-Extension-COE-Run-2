// ============================================================
// FreedomGuard_AI Ethics Engine
// Deterministic ethics enforcement for the COE system.
//
// Evaluates every action against loaded ethics modules, rules,
// sensitivity levels, and absolute blocks. Every evaluation
// produces an immutable audit trail. No LLM calls — purely
// rule-based, fast, and predictable.
//
// Architecture:
//   Action request → absolute-block check → module evaluation
//     → rule evaluation (priority-sorted) → sensitivity gate
//     → audit entry → transparency log → event emission
//     → EthicsEvaluationResult
// ============================================================

import * as crypto from 'crypto';
import { Database } from './database';
import { EventBus, COEEventType } from './event-bus';
import {
    EthicsModule,
    EthicsRule,
    EthicsAuditEntry,
    EthicsSensitivity,
    EthicsEvaluationResult,
    EthicsActionContext,
} from '../types';

// ==================== TRANSPARENCY LOGGER INTERFACE ====================
// TransparencyLogger may not exist yet. We define a minimal interface
// matching the expected contract so the engine compiles standalone.
// When the real TransparencyLogger is created, it must satisfy this shape.

export interface TransparencyLoggerLike {
    log(entry: {
        source: string;
        category: string;
        action: string;
        detail: string;
        severity: 'info' | 'warning' | 'error' | 'critical';
        entityType?: string;
        entityId?: string;
        correlationId?: string;
    }): void;
}

// ==================== OUTPUT CHANNEL INTERFACE ====================
// Matches VS Code OutputChannel.appendLine but stays decoupled for testing.

export interface OutputChannelLike {
    appendLine(msg: string): void;
}

// ==================== DEFAULT MODULE DEFINITIONS ====================

interface DefaultModuleSeed {
    name: string;
    description: string;
    sensitivity: EthicsSensitivity;
    scope: string[];
    allowed_actions: string[];
    blocked_actions: string[];
    rules: Array<{
        name: string;
        description: string;
        condition: string;
        action: EthicsRule['action'];
        priority: number;
        message: string;
    }>;
}

const DEFAULT_MODULES: DefaultModuleSeed[] = [
    {
        name: 'Privacy',
        description:
            'Protects user privacy by blocking unauthorized data collection, analytics tracking, '
            + 'and behavior monitoring. Ensures personal information is handled with explicit consent.',
        sensitivity: EthicsSensitivity.High,
        scope: ['data_access', 'user_info'],
        allowed_actions: [],
        blocked_actions: [
            'collect_user_data',
            'send_analytics',
            'track_behavior',
            'store_without_consent',
        ],
        rules: [
            {
                name: 'block_data_collection',
                description: 'Block any action that collects user data without consent',
                condition: 'collect_user_data|send_analytics|track_behavior|store_without_consent',
                action: 'block',
                priority: 1,
                message:
                    'This action attempts to collect or transmit user data without explicit consent. '
                    + 'Privacy module has blocked it.',
            },
            {
                name: 'audit_data_access',
                description: 'Audit all data access actions for transparency',
                condition: 'data_access|user_info|read_user',
                action: 'audit',
                priority: 10,
                message: 'Data access action logged for privacy audit trail.',
            },
        ],
    },
    {
        name: 'Speech',
        description:
            'Protects freedom of expression by preventing content censorship, '
            + 'communication filtering, and suppression of user-generated content.',
        sensitivity: EthicsSensitivity.Medium,
        scope: ['content', 'communication'],
        allowed_actions: [],
        blocked_actions: [
            'censor_content',
            'filter_expression',
            'suppress_speech',
        ],
        rules: [
            {
                name: 'block_censorship',
                description: 'Block any action that censors or suppresses user expression',
                condition: 'censor_content|filter_expression|suppress_speech',
                action: 'block',
                priority: 1,
                message:
                    'This action would censor or suppress user expression. '
                    + 'Speech module has blocked it.',
            },
            {
                name: 'warn_content_modification',
                description: 'Warn when content is being modified by the system',
                condition: 'modify_content|edit_content|transform_content',
                action: 'warn',
                priority: 5,
                message:
                    'Content is being modified by an automated process. '
                    + 'Ensure this aligns with user intent.',
            },
        ],
    },
    {
        name: 'Self-Protection',
        description:
            'Prevents destructive system-level operations including file deletion, '
            + 'security feature disabling, and firewall modification.',
        sensitivity: EthicsSensitivity.Maximum,
        scope: ['system', 'security'],
        allowed_actions: [],
        blocked_actions: [
            'delete_system_files',
            'disable_security',
            'modify_firewall',
        ],
        rules: [
            {
                name: 'block_destructive_system_ops',
                description: 'Block any action that could destroy or compromise the system',
                condition: 'delete_system_files|disable_security|modify_firewall|format_disk',
                action: 'block',
                priority: 1,
                message:
                    'This action could compromise system integrity. '
                    + 'Self-Protection module has blocked it.',
            },
            {
                name: 'warn_system_modification',
                description: 'Warn when system configuration is being changed',
                condition: 'modify_system|change_config|update_system',
                action: 'warn',
                priority: 5,
                message:
                    'System configuration is being modified. '
                    + 'Review this change carefully.',
            },
        ],
    },
    {
        name: 'Data Sovereignty',
        description:
            'Ensures data remains under user control. Blocks unauthorized data transfers, '
            + 'external sharing without consent, and data exfiltration attempts.',
        sensitivity: EthicsSensitivity.High,
        scope: ['data_transfer', 'storage'],
        allowed_actions: [],
        blocked_actions: [
            'exfiltrate_data',
            'unauthorized_transfer',
            'share_without_consent',
        ],
        rules: [
            {
                name: 'block_data_exfiltration',
                description: 'Block any attempt to move data outside authorized boundaries',
                condition: 'exfiltrate_data|unauthorized_transfer|share_without_consent',
                action: 'block',
                priority: 1,
                message:
                    'This action would transfer data outside authorized boundaries. '
                    + 'Data Sovereignty module has blocked it.',
            },
            {
                name: 'audit_data_movement',
                description: 'Audit all data transfer operations',
                condition: 'transfer_data|export_data|upload_data|sync_data',
                action: 'audit',
                priority: 10,
                message: 'Data movement action logged for sovereignty audit.',
            },
        ],
    },
    {
        name: 'Transparency',
        description:
            'Ensures all automated actions are logged and visible. This module never blocks '
            + 'actions; it guarantees that every action leaves an auditable trace.',
        sensitivity: EthicsSensitivity.Low,
        scope: ['logging', 'audit'],
        allowed_actions: [],
        blocked_actions: [],
        rules: [
            {
                name: 'log_all_actions',
                description: 'Audit every action that passes through the ethics engine',
                condition: 'true',
                action: 'audit',
                priority: 100,
                message: 'Action logged for transparency.',
            },
        ],
    },
    {
        name: 'Consent',
        description:
            'Requires explicit user approval for sensitive operations. Blocks execution '
            + 'of actions that have not received prior consent. Allows safe read operations '
            + 'and UI code generation by default.',
        sensitivity: EthicsSensitivity.High,
        scope: ['sensitive_operations'],
        allowed_actions: ['read_local_files', 'generate_ui_code'],
        blocked_actions: ['execute_without_approval'],
        rules: [
            {
                name: 'block_unapproved_execution',
                description: 'Block execution of sensitive operations without user consent',
                condition: 'execute_without_approval|run_unapproved|auto_execute',
                action: 'block',
                priority: 1,
                message:
                    'This action requires explicit user consent before execution. '
                    + 'Consent module has blocked it.',
            },
            {
                name: 'warn_sensitive_operation',
                description: 'Warn for any operation marked as sensitive',
                condition: 'sensitive_|requires_consent|needs_approval',
                action: 'warn',
                priority: 5,
                message:
                    'This is a sensitive operation. User consent is recommended.',
            },
        ],
    },
];

// ==================== ETHICS ENGINE ====================

export class EthicsEngine {
    // Actions that can NEVER be overridden, regardless of module config or user override.
    // These represent fundamental safety invariants.
    private static readonly ABSOLUTE_BLOCKS: ReadonlyArray<string> = [
        'create_backdoor',
        'install_spyware',
        'install_keylogger',
        'collect_data_unauthorized',
        'delete_system_files',
        'disable_security',
        'exfiltrate_data',
        'bypass_authentication',
        'inject_malicious_code',
        'track_without_consent',
    ];

    // Cache of enabled modules, refreshed on each evaluation for correctness.
    private cachedModules: EthicsModule[] | null = null;
    private cacheTimestamp: number = 0;
    private static readonly CACHE_TTL_MS = 5000; // 5 seconds

    constructor(
        private database: Database,
        private eventBus: EventBus,
        private transparencyLogger: TransparencyLoggerLike,
        private outputChannel: OutputChannelLike
    ) {}

    // ==================== CORE EVALUATION ====================

    /**
     * Evaluate an action against all ethics modules and rules.
     *
     * Evaluation pipeline:
     *   1. Absolute block check (cannot override)
     *   2. Load enabled modules
     *   3. Per-module blocked_actions check
     *   4. Per-module rule evaluation (priority-sorted, lower = higher priority)
     *   5. Sensitivity-level gating
     *   6. Create audit entry
     *   7. Log via transparency logger
     *   8. Emit event
     *
     * @param context - The action context to evaluate
     * @returns EthicsEvaluationResult with decision, triggered rules, messages, and audit ID
     */
    async evaluateAction(context: EthicsActionContext): Promise<EthicsEvaluationResult> {
        const startTime = Date.now();
        const triggeredRules: EthicsRule[] = [];
        const messages: string[] = [];
        // Use the union type directly so TS doesn't narrow too aggressively
        // after break-out branches.
        let decision: 'allowed' | 'blocked' | 'warned' = 'allowed';
        let triggeringModuleId: string | null = null;
        let triggeringRuleId: string | null = null;

        try {
            // ── Step 1: Absolute Block Check ────────────────────────
            if (this.isAbsoluteBlocked(context.action)) {
                decision = 'blocked';
                messages.push(
                    `ABSOLUTE BLOCK: Action "${context.action}" is permanently blocked. `
                    + 'This action violates fundamental safety invariants and cannot be overridden.'
                );
                this.outputChannel.appendLine(
                    `[EthicsEngine] ABSOLUTE BLOCK: "${context.action}" from ${context.source}`
                );

                // Create audit entry for absolute block
                const auditEntry = this.createAuditEntry(
                    'absolute_block',
                    null,
                    context,
                    'blocked'
                );

                // Log via transparency logger
                this.logToTransparency(context, 'blocked', 'Absolute block triggered', 'critical');

                // Emit blocked event
                this.emitEvent('ethics:action_blocked' as COEEventType, context, 'blocked', {
                    reason: 'absolute_block',
                    action: context.action,
                });

                return {
                    allowed: false,
                    decision: 'blocked',
                    triggeredRules: [],
                    messages,
                    auditEntryId: auditEntry.id,
                };
            }

            // ── Step 2: Load Enabled Modules ────────────────────────
            const modules = this.getEnabledModulesWithCache();

            if (modules.length === 0) {
                // No modules enabled — allow by default, still audit
                messages.push('No ethics modules enabled. Action allowed by default.');
                const auditEntry = this.createAuditEntry(
                    'no_modules',
                    null,
                    context,
                    'allowed'
                );
                this.logToTransparency(context, 'allowed', 'No modules enabled', 'info');
                this.emitEvent('ethics:check_passed' as COEEventType, context, 'allowed', {});
                return {
                    allowed: true,
                    decision: 'allowed',
                    triggeredRules: [],
                    messages,
                    auditEntryId: auditEntry.id,
                };
            }

            // ── Step 3 & 4: Per-Module Evaluation ───────────────────
            for (const module of modules) {
                const moduleResult = this.evaluateModule(module, context);

                if (moduleResult.triggered) {
                    triggeredRules.push(...moduleResult.triggeredRules);
                    messages.push(...moduleResult.messages);

                    // Track the most restrictive decision
                    if (moduleResult.decision === 'blocked') {
                        decision = 'blocked';
                        triggeringModuleId = module.id;
                        if (moduleResult.triggeredRules.length > 0) {
                            triggeringRuleId = moduleResult.triggeredRules[0].id;
                        }
                        // Once blocked, no need to check further modules
                        break;
                    } else if (moduleResult.decision === 'warned') {
                        // Only escalate to warned if we haven't already been blocked
                        // (blocked would have triggered break above)
                        decision = 'warned';
                        triggeringModuleId = triggeringModuleId ?? module.id;
                        if (!triggeringRuleId && moduleResult.triggeredRules.length > 0) {
                            triggeringRuleId = moduleResult.triggeredRules[0].id;
                        }
                    }
                }

                // ── Step 5: Sensitivity-Level Gating ────────────────
                const sensitivityResult = this.applySensitivity(module, context, decision);
                if (sensitivityResult.overrideDecision) {
                    if (sensitivityResult.overrideDecision === 'blocked') {
                        decision = 'blocked';
                        triggeringModuleId = module.id;
                        messages.push(...sensitivityResult.messages);
                        break;
                    } else if (sensitivityResult.overrideDecision === 'warned') {
                        // Only escalate to warned if we haven't been blocked
                        // (blocked would have triggered break above)
                        decision = 'warned';
                        triggeringModuleId = triggeringModuleId ?? module.id;
                        messages.push(...sensitivityResult.messages);
                    }
                }
            }

            // If no module triggered anything, add a clean pass message
            if (messages.length === 0) {
                messages.push(`Action "${context.action}" passed all ethics checks.`);
            }

            // ── Step 6: Create Audit Entry ──────────────────────────
            const finalDecision = decision === 'warned' ? 'warned' : decision;
            const auditEntry = this.createAuditEntry(
                triggeringModuleId ?? (modules[0]?.id ?? 'unknown'),
                triggeringRuleId,
                context,
                finalDecision
            );

            // ── Step 7: Log via Transparency Logger ─────────────────
            const severity = decision === 'blocked' ? 'warning'
                : decision === 'warned' ? 'info'
                : 'info';
            this.logToTransparency(
                context,
                finalDecision,
                messages.join(' | '),
                severity
            );

            // ── Step 8: Emit Event ──────────────────────────────────
            const eventType = decision === 'blocked'
                ? 'ethics:action_blocked' as COEEventType
                : 'ethics:check_passed' as COEEventType;

            this.emitEvent(eventType, context, finalDecision, {
                triggeredRuleCount: triggeredRules.length,
                modulesEvaluated: modules.length,
                durationMs: Date.now() - startTime,
            });

            const allowed = decision === 'allowed' || decision === 'warned';

            this.outputChannel.appendLine(
                `[EthicsEngine] ${decision.toUpperCase()}: "${context.action}" `
                + `from ${context.source} (${triggeredRules.length} rules triggered, `
                + `${Date.now() - startTime}ms)`
            );

            return {
                allowed,
                decision: decision === 'warned' ? 'warned' : decision,
                triggeredRules,
                messages,
                auditEntryId: auditEntry.id,
            };
        } catch (error) {
            // Safety net: if evaluation itself fails, block the action and log the error
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(
                `[EthicsEngine] EVALUATION ERROR: ${errorMsg}. Blocking action as safety measure.`
            );

            const auditEntry = this.createAuditEntry(
                'error',
                null,
                context,
                'blocked'
            );

            this.logToTransparency(
                context,
                'blocked',
                `Evaluation error: ${errorMsg}`,
                'error'
            );

            this.emitEvent('ethics:action_blocked' as COEEventType, context, 'blocked', {
                reason: 'evaluation_error',
                error: errorMsg,
            });

            return {
                allowed: false,
                decision: 'blocked',
                triggeredRules: [],
                messages: [
                    `Ethics evaluation encountered an error: ${errorMsg}. `
                    + 'Action blocked as a safety measure.',
                ],
                auditEntryId: auditEntry.id,
            };
        }
    }

    // ==================== MODULE MANAGEMENT ====================

    /**
     * Get all ethics modules (enabled and disabled).
     */
    getModules(): EthicsModule[] {
        return this.database.getAllEthicsModules();
    }

    /**
     * Enable a specific ethics module.
     */
    enableModule(moduleId: string): EthicsModule | null {
        this.invalidateCache();
        const updated = this.database.updateEthicsModule(moduleId, { enabled: true });
        if (updated) {
            this.outputChannel.appendLine(
                `[EthicsEngine] Module enabled: ${updated.name} (${moduleId})`
            );
            this.logToTransparency(
                { action: 'enable_module', source: 'ethics_engine', metadata: { moduleId } },
                'allowed',
                `Ethics module "${updated.name}" enabled`,
                'info'
            );
            this.emitEvent('ethics:check_passed' as COEEventType,
                { action: 'enable_module', source: 'ethics_engine' },
                'allowed',
                { moduleId, moduleName: updated.name }
            );
        }
        return updated;
    }

    /**
     * Disable a specific ethics module.
     */
    disableModule(moduleId: string): EthicsModule | null {
        this.invalidateCache();
        const updated = this.database.updateEthicsModule(moduleId, { enabled: false });
        if (updated) {
            this.outputChannel.appendLine(
                `[EthicsEngine] Module disabled: ${updated.name} (${moduleId})`
            );
            this.logToTransparency(
                { action: 'disable_module', source: 'ethics_engine', metadata: { moduleId } },
                'allowed',
                `Ethics module "${updated.name}" disabled`,
                'warning'
            );
            this.emitEvent('ethics:check_passed' as COEEventType,
                { action: 'disable_module', source: 'ethics_engine' },
                'allowed',
                { moduleId, moduleName: updated.name }
            );
        }
        return updated;
    }

    /**
     * Set the sensitivity level for a specific module.
     */
    setSensitivity(moduleId: string, sensitivity: EthicsSensitivity): EthicsModule | null {
        this.invalidateCache();
        const updated = this.database.updateEthicsModule(moduleId, { sensitivity });
        if (updated) {
            this.outputChannel.appendLine(
                `[EthicsEngine] Sensitivity set: ${updated.name} → ${sensitivity}`
            );
            this.logToTransparency(
                { action: 'set_sensitivity', source: 'ethics_engine', metadata: { moduleId, sensitivity } },
                'allowed',
                `Module "${updated.name}" sensitivity set to ${sensitivity}`,
                'info'
            );
        }
        return updated;
    }

    // ==================== ACTION LISTS ====================

    /**
     * Get all actions explicitly allowed across all enabled modules.
     * Returns a deduplicated, sorted array.
     */
    getAllowedActions(): string[] {
        const modules = this.database.getEnabledEthicsModules();
        const allowed = new Set<string>();
        for (const module of modules) {
            for (const action of module.allowed_actions) {
                allowed.add(action);
            }
        }
        return Array.from(allowed).sort();
    }

    /**
     * Get all blocked actions — module-level blocks plus absolute blocks.
     * Returns a deduplicated, sorted array.
     */
    getBlockedActions(): string[] {
        const modules = this.database.getEnabledEthicsModules();
        const blocked = new Set<string>(EthicsEngine.ABSOLUTE_BLOCKS);
        for (const module of modules) {
            for (const action of module.blocked_actions) {
                blocked.add(action);
            }
        }
        return Array.from(blocked).sort();
    }

    // ==================== AUDIT ====================

    /**
     * Retrieve ethics audit log entries.
     *
     * @param limit - Maximum entries to return (default 100)
     * @param moduleId - Optional filter by module ID
     */
    audit(limit?: number, moduleId?: string): EthicsAuditEntry[] {
        return this.database.getEthicsAuditLog(limit, moduleId);
    }

    // ==================== MODULE CREATION ====================

    /**
     * Create a new ethics module.
     */
    createModule(
        name: string,
        description: string,
        scope: string[]
    ): EthicsModule {
        this.invalidateCache();
        const module = this.database.createEthicsModule({
            name,
            description,
            scope,
            sensitivity: EthicsSensitivity.Medium,
            enabled: true,
            allowed_actions: [],
            blocked_actions: [],
            version: 1,
        });

        this.outputChannel.appendLine(
            `[EthicsEngine] Module created: ${name} (${module.id})`
        );

        this.logToTransparency(
            { action: 'create_module', source: 'ethics_engine', metadata: { moduleId: module.id } },
            'allowed',
            `Ethics module "${name}" created with scope: [${scope.join(', ')}]`,
            'info'
        );

        this.emitEvent('ethics:check_passed' as COEEventType,
            { action: 'create_module', source: 'ethics_engine' },
            'allowed',
            { moduleId: module.id, moduleName: name, scope }
        );

        return module;
    }

    // ==================== RULE MANAGEMENT ====================

    /**
     * Add a rule to an existing module.
     */
    addRule(
        moduleId: string,
        rule: {
            name: string;
            description: string;
            condition: string;
            action: EthicsRule['action'];
            priority: number;
            message: string;
            enabled?: boolean;
        }
    ): EthicsRule {
        this.invalidateCache();
        const ethicsRule = this.database.createEthicsRule({
            module_id: moduleId,
            name: rule.name,
            description: rule.description,
            condition: rule.condition,
            action: rule.action,
            priority: rule.priority,
            enabled: rule.enabled !== false,
            message: rule.message,
        });

        this.outputChannel.appendLine(
            `[EthicsEngine] Rule added: "${rule.name}" to module ${moduleId}`
        );

        this.logToTransparency(
            { action: 'add_rule', source: 'ethics_engine', metadata: { moduleId, ruleName: rule.name } },
            'allowed',
            `Rule "${rule.name}" added to module ${moduleId}`,
            'info'
        );

        return ethicsRule;
    }

    // ==================== OVERRIDE ====================

    /**
     * Override a previous ethics decision.
     *
     * CONSTRAINTS:
     *   - Cannot override absolute blocks (will throw)
     *   - Must provide a human identity and justification
     *   - The override is logged permanently in the audit trail
     *   - Emits 'ethics:user_override' event
     *
     * @param auditEntryId - The audit entry to override
     * @param overrideBy - Identity of the person overriding (e.g. "user:john")
     * @param reason - Justification for the override
     */
    async override(
        auditEntryId: string,
        overrideBy: string,
        reason: string
    ): Promise<void> {
        // Validate inputs
        if (!auditEntryId || !overrideBy || !reason) {
            throw new Error(
                'Override requires auditEntryId, overrideBy, and reason. All must be non-empty.'
            );
        }

        // Retrieve the original audit entry to check if it's an absolute block
        const auditLog = this.database.getEthicsAuditLog(1000);
        const originalEntry = auditLog.find(e => e.id === auditEntryId);

        if (!originalEntry) {
            throw new Error(`Audit entry not found: ${auditEntryId}`);
        }

        // Parse the context snapshot to check for absolute block
        let contextSnapshot: Record<string, unknown> = {};
        try {
            contextSnapshot = JSON.parse(originalEntry.context_snapshot || '{}');
        } catch {
            // If parsing fails, context is malformed but we can still check module_id
        }

        // Check if this was an absolute block
        const originalAction = (contextSnapshot.action as string) || '';
        if (
            originalEntry.module_id === 'absolute_block'
            || this.isAbsoluteBlocked(originalAction)
        ) {
            throw new Error(
                `Cannot override absolute block for action "${originalAction}". `
                + 'Absolute blocks are permanent safety invariants.'
            );
        }

        // Perform the override
        this.database.updateEthicsAuditEntry(auditEntryId, overrideBy, reason);

        this.outputChannel.appendLine(
            `[EthicsEngine] OVERRIDE: Entry ${auditEntryId} overridden by ${overrideBy}. `
            + `Reason: ${reason}`
        );

        // Log via transparency logger
        this.transparencyLogger.log({
            source: 'ethics_engine',
            category: 'ethics_decision',
            action: 'override',
            detail: JSON.stringify({
                auditEntryId,
                overrideBy,
                reason,
                originalDecision: originalEntry.decision,
                originalAction: originalEntry.action_description,
            }),
            severity: 'warning',
            entityType: 'ethics_audit',
            entityId: auditEntryId,
        });

        // Emit override event
        this.eventBus.emit(
            'ethics:check_passed' as COEEventType, // ethics:user_override mapped to nearest valid type
            'ethics_engine',
            {
                eventSubtype: 'user_override',
                auditEntryId,
                overrideBy,
                reason,
                originalDecision: originalEntry.decision,
                originalAction: originalEntry.action_description,
            }
        );
    }

    // ==================== SEEDING ====================

    /**
     * Seed the default FreedomGuard_AI modules if no modules exist.
     *
     * Creates 6 modules:
     *   1. Privacy — data access + user info protection
     *   2. Speech — content + communication freedom
     *   3. Self-Protection — system + security integrity
     *   4. Data Sovereignty — data transfer + storage control
     *   5. Transparency — universal audit logging
     *   6. Consent — sensitive operations require approval
     *
     * Each module includes pre-configured rules with appropriate priority ordering.
     * This method is idempotent — if modules already exist, it does nothing.
     *
     * @returns The number of modules created (0 if modules already exist)
     */
    seedDefaultModules(): number {
        const existing = this.database.getAllEthicsModules();
        if (existing.length > 0) {
            this.outputChannel.appendLine(
                `[EthicsEngine] Seed skipped: ${existing.length} modules already exist.`
            );
            return 0;
        }

        this.outputChannel.appendLine(
            '[EthicsEngine] Seeding default FreedomGuard_AI modules...'
        );

        let created = 0;

        for (const seed of DEFAULT_MODULES) {
            // Create the module
            const module = this.database.createEthicsModule({
                name: seed.name,
                description: seed.description,
                enabled: true,
                sensitivity: seed.sensitivity,
                scope: seed.scope,
                allowed_actions: seed.allowed_actions,
                blocked_actions: seed.blocked_actions,
                version: 1,
            });

            // Create rules for this module
            for (const ruleSeed of seed.rules) {
                this.database.createEthicsRule({
                    module_id: module.id,
                    name: ruleSeed.name,
                    description: ruleSeed.description,
                    condition: ruleSeed.condition,
                    action: ruleSeed.action,
                    priority: ruleSeed.priority,
                    enabled: true,
                    message: ruleSeed.message,
                });
            }

            created++;
            this.outputChannel.appendLine(
                `[EthicsEngine]   Created module: ${seed.name} `
                + `(${seed.rules.length} rules, sensitivity: ${seed.sensitivity})`
            );
        }

        this.invalidateCache();

        this.logToTransparency(
            { action: 'seed_default_modules', source: 'ethics_engine' },
            'allowed',
            `Seeded ${created} default FreedomGuard_AI modules`,
            'info'
        );

        this.outputChannel.appendLine(
            `[EthicsEngine] Seeding complete. ${created} modules created.`
        );

        return created;
    }

    // ==================== PRIVATE HELPERS ====================

    /**
     * Check if an action matches any absolute block.
     * Uses exact match and substring match for robustness.
     */
    private isAbsoluteBlocked(action: string): boolean {
        const normalizedAction = action.toLowerCase().trim();

        for (const blocked of EthicsEngine.ABSOLUTE_BLOCKS) {
            // Exact match
            if (normalizedAction === blocked) {
                return true;
            }
            // Substring match — catch variants like "try_to_create_backdoor"
            if (normalizedAction.includes(blocked)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get enabled modules with short-lived cache to avoid repeated DB queries
     * during burst evaluations.
     */
    private getEnabledModulesWithCache(): EthicsModule[] {
        const now = Date.now();
        if (this.cachedModules && (now - this.cacheTimestamp) < EthicsEngine.CACHE_TTL_MS) {
            return this.cachedModules;
        }
        this.cachedModules = this.database.getEnabledEthicsModules();
        this.cacheTimestamp = now;
        return this.cachedModules;
    }

    /**
     * Invalidate the module cache (called when modules are modified).
     */
    private invalidateCache(): void {
        this.cachedModules = null;
        this.cacheTimestamp = 0;
    }

    /**
     * Evaluate a single module against an action context.
     *
     * Steps:
     *   1. Check if action is in module's blocked_actions list
     *   2. Evaluate each enabled rule by priority (ascending)
     *   3. Aggregate results
     */
    private evaluateModule(
        module: EthicsModule,
        context: EthicsActionContext
    ): ModuleEvaluationResult {
        const result: ModuleEvaluationResult = {
            triggered: false,
            decision: 'allowed',
            triggeredRules: [],
            messages: [],
        };

        const normalizedAction = context.action.toLowerCase().trim();

        // ── Check module-level blocked_actions ──────────────────
        for (const blockedAction of module.blocked_actions) {
            if (
                normalizedAction === blockedAction.toLowerCase()
                || normalizedAction.includes(blockedAction.toLowerCase())
            ) {
                result.triggered = true;
                result.decision = 'blocked';
                result.messages.push(
                    `[${module.name}] Action "${context.action}" is in the module's blocked list.`
                );
                return result;
            }
        }

        // ── Evaluate rules (sorted by priority, lower = higher priority) ──
        const enabledRules = (module.rules || [])
            .filter(r => r.enabled)
            .sort((a, b) => a.priority - b.priority);

        for (const rule of enabledRules) {
            const matches = this.matchesCondition(rule.condition, context);

            if (matches) {
                result.triggered = true;
                result.triggeredRules.push(rule);

                switch (rule.action) {
                    case 'block':
                        result.decision = 'blocked';
                        result.messages.push(
                            `[${module.name}/${rule.name}] BLOCKED: ${rule.message || rule.description}`
                        );
                        // Block is final for this module
                        return result;

                    case 'warn':
                        if (result.decision !== 'blocked') {
                            result.decision = 'warned';
                        }
                        result.messages.push(
                            `[${module.name}/${rule.name}] WARNING: ${rule.message || rule.description}`
                        );
                        break;

                    case 'audit':
                        // Audit rules don't change the decision
                        result.messages.push(
                            `[${module.name}/${rule.name}] AUDIT: ${rule.message || rule.description}`
                        );
                        break;

                    case 'allow':
                        // Explicit allow — no change needed
                        break;
                }
            }
        }

        return result;
    }

    /**
     * Match a rule condition against an action context.
     *
     * Condition formats:
     *   - "true" — always matches
     *   - "action1|action2|action3" — pipe-separated alternatives (any match = true)
     *   - Simple string — substring match against action name
     *
     * Matching is case-insensitive.
     */
    private matchesCondition(condition: string, context: EthicsActionContext): boolean {
        const normalizedCondition = condition.toLowerCase().trim();
        const normalizedAction = context.action.toLowerCase().trim();

        // Special: always-true condition
        if (normalizedCondition === 'true') {
            return true;
        }

        // Pipe-separated alternatives
        if (normalizedCondition.includes('|')) {
            const alternatives = normalizedCondition.split('|').map(s => s.trim());
            for (const alt of alternatives) {
                if (alt.length === 0) continue;
                if (normalizedAction.includes(alt) || alt.includes(normalizedAction)) {
                    return true;
                }
            }
            return false;
        }

        // Simple substring match (bidirectional)
        return (
            normalizedAction.includes(normalizedCondition)
            || normalizedCondition.includes(normalizedAction)
        );
    }

    /**
     * Apply sensitivity-level gating to the current decision.
     *
     * Sensitivity levels:
     *   - Low:     Log only. Never blocks. Always allows.
     *   - Medium:  Warn on suspicious actions. Block clear violations (already caught by rules).
     *   - High:    Block anything NOT in allowed_actions list.
     *   - Maximum: Block ALL automated actions. Only manual/user actions pass.
     */
    private applySensitivity(
        module: EthicsModule,
        context: EthicsActionContext,
        currentDecision: EthicsEvaluationResult['decision']
    ): SensitivityResult {
        const result: SensitivityResult = {
            overrideDecision: null,
            messages: [],
        };

        const normalizedAction = context.action.toLowerCase().trim();

        switch (module.sensitivity) {
            case EthicsSensitivity.Low:
                // Low sensitivity: log only, never escalate
                // Even if rules triggered a warn, we don't escalate further
                break;

            case EthicsSensitivity.Medium:
                // Medium: warn on suspicious patterns not already caught
                if (currentDecision === 'allowed') {
                    const suspicious = this.isSuspiciousAction(normalizedAction);
                    if (suspicious) {
                        result.overrideDecision = 'warned';
                        result.messages.push(
                            `[${module.name}] Medium sensitivity: Action "${context.action}" flagged `
                            + 'as potentially suspicious. Proceeding with warning.'
                        );
                    }
                }
                break;

            case EthicsSensitivity.High:
                // High: block anything not in allowed_actions
                if (currentDecision !== 'blocked') {
                    const isExplicitlyAllowed = module.allowed_actions.some(
                        a => normalizedAction === a.toLowerCase()
                            || normalizedAction.includes(a.toLowerCase())
                    );

                    if (!isExplicitlyAllowed && module.allowed_actions.length > 0) {
                        result.overrideDecision = 'blocked';
                        result.messages.push(
                            `[${module.name}] High sensitivity: Action "${context.action}" `
                            + 'is not in the allowed actions list. Blocked by sensitivity policy.'
                        );
                    } else if (!isExplicitlyAllowed && module.allowed_actions.length === 0) {
                        // High sensitivity with no allowed_actions list: don't block everything,
                        // but warn if not already warned
                        if (currentDecision === 'allowed') {
                            result.overrideDecision = 'warned';
                            result.messages.push(
                                `[${module.name}] High sensitivity: Action "${context.action}" `
                                + 'reviewed under high sensitivity. No explicit allow list configured.'
                            );
                        }
                    }
                }
                break;

            case EthicsSensitivity.Maximum:
                // Maximum: block ALL automated actions
                if (currentDecision !== 'blocked') {
                    const isUserAction = context.source === 'user'
                        || context.source === 'manual'
                        || context.source === 'human';

                    if (!isUserAction) {
                        result.overrideDecision = 'blocked';
                        result.messages.push(
                            `[${module.name}] Maximum sensitivity: All automated actions are blocked. `
                            + `Action "${context.action}" from source "${context.source}" requires `
                            + 'manual execution.'
                        );
                    }
                }
                break;
        }

        return result;
    }

    /**
     * Heuristic check for suspicious action patterns.
     * Used by Medium sensitivity to issue warnings for edge cases.
     */
    private isSuspiciousAction(action: string): boolean {
        const suspiciousPatterns = [
            'delete', 'remove', 'destroy', 'drop',
            'execute', 'eval', 'run_script',
            'send_', 'upload_', 'transmit_',
            'modify_permission', 'change_access',
            'override_', 'bypass_', 'skip_',
            'install_', 'download_',
            'encrypt', 'decrypt',
            'root', 'admin', 'sudo',
        ];

        return suspiciousPatterns.some(pattern => action.includes(pattern));
    }

    /**
     * Create an audit entry in the database.
     */
    private createAuditEntry(
        moduleId: string,
        ruleId: string | null,
        context: EthicsActionContext,
        decision: 'allowed' | 'blocked' | 'warned' | 'overridden'
    ): EthicsAuditEntry {
        return this.database.createEthicsAuditEntry({
            module_id: moduleId,
            rule_id: ruleId,
            action_description: context.action,
            decision,
            requestor: context.source,
            context_snapshot: JSON.stringify({
                action: context.action,
                source: context.source,
                targetEntityType: context.targetEntityType ?? null,
                targetEntityId: context.targetEntityId ?? null,
                metadata: context.metadata ?? {},
                timestamp: new Date().toISOString(),
            }),
            override_by: null,
            override_reason: null,
        });
    }

    /**
     * Log an ethics decision via the transparency logger.
     */
    private logToTransparency(
        context: EthicsActionContext | { action: string; source: string; metadata?: Record<string, unknown> },
        decision: string,
        detail: string,
        severity: 'info' | 'warning' | 'error' | 'critical'
    ): void {
        try {
            this.transparencyLogger.log({
                source: 'ethics_engine',
                category: 'ethics_decision',
                action: context.action,
                detail: `[${decision.toUpperCase()}] ${detail}`,
                severity,
                entityType: ('targetEntityType' in context) ? context.targetEntityType : undefined,
                entityId: ('targetEntityId' in context) ? context.targetEntityId : undefined,
            });
        } catch (error) {
            // Transparency logging failure must not prevent ethics evaluation
            const msg = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(
                `[EthicsEngine] Transparency log failed (non-fatal): ${msg}`
            );
        }
    }

    /**
     * Emit an event via the EventBus.
     */
    private emitEvent(
        type: COEEventType,
        context: EthicsActionContext | { action: string; source: string },
        decision: string,
        extra: Record<string, unknown>
    ): void {
        try {
            this.eventBus.emit(
                type,
                'ethics_engine',
                {
                    action: context.action,
                    source: context.source,
                    decision,
                    ...extra,
                }
            );
        } catch (error) {
            // Event emission failure must not prevent ethics evaluation
            const msg = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(
                `[EthicsEngine] Event emission failed (non-fatal): ${msg}`
            );
        }
    }

    // ==================== INSPECTION / DIAGNOSTICS ====================

    /**
     * Get a summary of the current ethics engine state.
     * Useful for dashboards and health checks.
     */
    getStatus(): EthicsEngineStatus {
        const allModules = this.database.getAllEthicsModules();
        const enabledModules = allModules.filter(m => m.enabled);
        const totalRules = allModules.reduce((sum, m) => sum + (m.rules?.length ?? 0), 0);
        const enabledRules = enabledModules.reduce(
            (sum, m) => sum + (m.rules?.filter(r => r.enabled)?.length ?? 0), 0
        );
        const recentAudit = this.database.getEthicsAuditLog(10);
        const recentBlocks = recentAudit.filter(e => e.decision === 'blocked').length;

        return {
            totalModules: allModules.length,
            enabledModules: enabledModules.length,
            totalRules,
            enabledRules,
            absoluteBlockCount: EthicsEngine.ABSOLUTE_BLOCKS.length,
            recentEvaluations: recentAudit.length,
            recentBlocks,
            moduleNames: allModules.map(m => ({
                name: m.name,
                enabled: m.enabled,
                sensitivity: m.sensitivity,
                ruleCount: m.rules?.length ?? 0,
            })),
        };
    }

    /**
     * Check if a specific action would be blocked WITHOUT creating an audit entry.
     * Useful for UI hints and pre-flight checks.
     */
    wouldBlock(action: string): { blocked: boolean; reason: string } {
        // Check absolute blocks first
        if (this.isAbsoluteBlocked(action)) {
            return {
                blocked: true,
                reason: `Absolute block: "${action}" is permanently blocked.`,
            };
        }

        // Check module-level blocks
        const modules = this.database.getEnabledEthicsModules();
        const normalizedAction = action.toLowerCase().trim();

        for (const module of modules) {
            for (const blockedAction of module.blocked_actions) {
                if (
                    normalizedAction === blockedAction.toLowerCase()
                    || normalizedAction.includes(blockedAction.toLowerCase())
                ) {
                    return {
                        blocked: true,
                        reason: `Module "${module.name}" blocks this action.`,
                    };
                }
            }

            // Check block rules
            const blockRules = (module.rules || [])
                .filter(r => r.enabled && r.action === 'block');

            for (const rule of blockRules) {
                const context: EthicsActionContext = { action, source: 'preflight_check' };
                if (this.matchesCondition(rule.condition, context)) {
                    return {
                        blocked: true,
                        reason: `Rule "${rule.name}" in module "${module.name}" would block this action.`,
                    };
                }
            }

            // Check Maximum sensitivity
            if (module.sensitivity === EthicsSensitivity.Maximum) {
                return {
                    blocked: true,
                    reason: `Module "${module.name}" has Maximum sensitivity — all automated actions blocked.`,
                };
            }

            // Check High sensitivity with allowed_actions
            if (
                module.sensitivity === EthicsSensitivity.High
                && module.allowed_actions.length > 0
            ) {
                const isAllowed = module.allowed_actions.some(
                    a => normalizedAction === a.toLowerCase()
                        || normalizedAction.includes(a.toLowerCase())
                );
                if (!isAllowed) {
                    // Check if the action is within this module's scope
                    const inScope = module.scope.some(
                        s => normalizedAction.includes(s.toLowerCase())
                    );
                    if (inScope) {
                        return {
                            blocked: true,
                            reason: `Module "${module.name}" (High sensitivity) requires action to be in allowed list.`,
                        };
                    }
                }
            }
        }

        return {
            blocked: false,
            reason: 'Action would be allowed.',
        };
    }

    /**
     * Get the list of absolute blocks (read-only).
     */
    getAbsoluteBlocks(): ReadonlyArray<string> {
        return EthicsEngine.ABSOLUTE_BLOCKS;
    }
}

// ==================== INTERNAL TYPES ====================

interface ModuleEvaluationResult {
    triggered: boolean;
    decision: 'allowed' | 'blocked' | 'warned';
    triggeredRules: EthicsRule[];
    messages: string[];
}

interface SensitivityResult {
    overrideDecision: 'blocked' | 'warned' | null;
    messages: string[];
}

export interface EthicsEngineStatus {
    totalModules: number;
    enabledModules: number;
    totalRules: number;
    enabledRules: number;
    absoluteBlockCount: number;
    recentEvaluations: number;
    recentBlocks: number;
    moduleNames: Array<{
        name: string;
        enabled: boolean;
        sensitivity: EthicsSensitivity;
        ruleCount: number;
    }>;
}
