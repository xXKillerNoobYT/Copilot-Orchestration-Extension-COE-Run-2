/**
 * StartupTickets — v10.0 System Bootstrap
 *
 * Creates 20 startup tickets that bootstrap the COE system on first activation.
 * Each ticket is a self-contained task processed by the existing ticket pipeline.
 *
 * Tickets are created in dependency order:
 *   1-2:   LLM & tree skeleton
 *   3-9:   Branch sub-groups (one per branch)
 *   10-15: Niche agent seeding (one per domain)
 *   16:    Default tool assignments
 *   17:    System health check
 *   18:    Group composition validation
 *   19:    Welcome report
 *   20:    System initialized marker
 *
 * Wire in: extension.ts after all services initialized.
 */

import { Database } from './database';
import { EventBus } from './event-bus';
import { TicketPriority, TicketStatus } from '../types';

export interface OutputChannelLike {
    appendLine(msg: string): void;
}

/** A startup ticket definition */
interface StartupTicketDef {
    /** Sequential order (1-20) */
    order: number;
    /** Ticket title */
    title: string;
    /** Ticket body / description */
    body: string;
    /** Priority */
    priority: TicketPriority;
    /** Category tag */
    category: string;
    /** Dependencies — ticket orders that must complete first */
    depends_on: number[];
}

/** All 20 bootstrap ticket definitions */
const STARTUP_TICKET_DEFS: StartupTicketDef[] = [
    // ==================== Phase 1: Foundation ====================
    {
        order: 1,
        title: 'Validate LLM connection and profile setup',
        body: [
            '**Objective:** Verify the LLM endpoint is reachable and at least one profile is configured.',
            '',
            '**Steps:**',
            '1. Send a lightweight health-check request to the configured LLM endpoint.',
            '2. Verify the active LLM profile exists and has valid capabilities.',
            '3. If no profile exists, create a default Base profile from config.',
            '4. Log connection latency and model name.',
            '',
            '**Success criteria:** LLM responds within 30s. At least one profile marked active.',
        ].join('\n'),
        priority: TicketPriority.P1,
        category: 'system_bootstrap',
        depends_on: [],
    },
    {
        order: 2,
        title: 'Build L0-L1 tree skeleton',
        body: [
            '**Objective:** Create the Boss AI node (L0) and Top Orchestrator group (L1).',
            '',
            '**Steps:**',
            '1. Ensure L0 Boss AI node exists (via ensureDefaultTree).',
            '2. Create L1 Top Orchestrator group with 10 slots (1 head + 9 mandatory).',
            '3. Fill mandatory roles: HeadOrchestrator, Planning, Verification, Review, Observation, StructureImprovement, 3x Orchestrator, 1x OpenSlot.',
            '4. Validate group composition.',
            '',
            '**Success criteria:** L0 node active. L1 group created with all 10 slots populated.',
        ].join('\n'),
        priority: TicketPriority.P1,
        category: 'system_bootstrap',
        depends_on: [1],
    },

    // ==================== Phase 2: Branch Heads & Sub-Groups ====================
    {
        order: 3,
        title: 'Build L2 branch heads',
        body: [
            '**Objective:** Create 6 branch head nodes at L2, one per branch.',
            '',
            '**Branches:** Planning, Verification, Coding/Execution, Co-Director, Data, Orchestrator.',
            '',
            '**Steps:**',
            '1. For each branch, create an L2 head orchestrator node under L1.',
            '2. Assign branch-appropriate niche specialties.',
            '3. Wire parent-child relationships.',
            '',
            '**Success criteria:** 6 L2 nodes exist, one per branch, all children of L1 head.',
        ].join('\n'),
        priority: TicketPriority.P1,
        category: 'system_bootstrap',
        depends_on: [2],
    },
    {
        order: 4,
        title: 'Build L3 sub-groups for Planning branch',
        body: [
            '**Objective:** Create L3 group under the Planning branch head.',
            '',
            '**Steps:**',
            '1. Create L3 group with Planning branch head as parent.',
            '2. Fill 10 slots following mandatory composition rules.',
            '3. Assign planning-specific niche agents (architecture, decomposition, estimation).',
            '4. Validate group composition.',
            '',
            '**Success criteria:** L3 Planning group created with valid composition.',
        ].join('\n'),
        priority: TicketPriority.P2,
        category: 'system_bootstrap',
        depends_on: [3],
    },
    {
        order: 5,
        title: 'Build L3 sub-groups for Verification branch',
        body: [
            '**Objective:** Create L3 group under the Verification branch head.',
            '',
            '**Steps:**',
            '1. Create L3 group with Verification branch head as parent.',
            '2. Fill 10 slots following mandatory composition rules.',
            '3. Assign verification-specific niche agents (testing, security, performance).',
            '4. Validate group composition.',
            '',
            '**Success criteria:** L3 Verification group created with valid composition.',
        ].join('\n'),
        priority: TicketPriority.P2,
        category: 'system_bootstrap',
        depends_on: [3],
    },
    {
        order: 6,
        title: 'Build L3 sub-groups for Coding/Execution branch',
        body: [
            '**Objective:** Create L3 group under the Coding/Execution branch head.',
            '',
            '**Steps:**',
            '1. Create L3 group with Coding/Execution branch head as parent.',
            '2. Fill 10 slots following mandatory composition rules.',
            '3. Assign coding-specific niche agents (language, framework, devops).',
            '4. Validate group composition.',
            '',
            '**Success criteria:** L3 Coding group created with valid composition.',
        ].join('\n'),
        priority: TicketPriority.P2,
        category: 'system_bootstrap',
        depends_on: [3],
    },
    {
        order: 7,
        title: 'Build L3 sub-groups for Co-Director branch',
        body: [
            '**Objective:** Create L3 group under the Co-Director branch head.',
            '',
            '**Steps:**',
            '1. Create L3 group with Co-Director branch head as parent.',
            '2. Fill 10 slots following mandatory composition rules.',
            '3. Assign coordination-specific niche agents (project management, reporting).',
            '4. Validate group composition.',
            '',
            '**Success criteria:** L3 Co-Director group created with valid composition.',
        ].join('\n'),
        priority: TicketPriority.P2,
        category: 'system_bootstrap',
        depends_on: [3],
    },
    {
        order: 8,
        title: 'Build L3 sub-groups for Data branch',
        body: [
            '**Objective:** Create L3 group under the Data branch head.',
            '',
            '**Steps:**',
            '1. Create L3 group with Data branch head as parent.',
            '2. Fill 10 slots following mandatory composition rules.',
            '3. Assign data-specific niche agents (schema, migration, ETL, analytics).',
            '4. Validate group composition.',
            '',
            '**Success criteria:** L3 Data group created with valid composition.',
        ].join('\n'),
        priority: TicketPriority.P2,
        category: 'system_bootstrap',
        depends_on: [3],
    },
    {
        order: 9,
        title: 'Build L3 sub-groups for Orchestrator branch',
        body: [
            '**Objective:** Create L3 group under the Orchestrator branch head.',
            '',
            '**Steps:**',
            '1. Create L3 group with Orchestrator branch head as parent.',
            '2. Fill 10 slots following mandatory composition rules.',
            '3. Assign orchestration-specific niche agents (routing, scheduling, load balancing).',
            '4. Validate group composition.',
            '',
            '**Success criteria:** L3 Orchestrator group created with valid composition.',
        ].join('\n'),
        priority: TicketPriority.P2,
        category: 'system_bootstrap',
        depends_on: [3],
    },

    // ==================== Phase 3: Niche Agent Seeding ====================
    {
        order: 10,
        title: 'Seed niche agent definitions — Planning domain',
        body: [
            '**Objective:** Seed ~80 niche agent definitions for the Planning domain.',
            '',
            '**Domains:** Architecture, Decomposition, Estimation, Dependency Analysis.',
            '',
            '**Steps:**',
            '1. Call NicheAgentFactory.seedDefaultDefinitions() if not already seeded.',
            '2. Verify Planning domain agents exist in database.',
            '3. Log count of Planning domain definitions.',
            '',
            '**Success criteria:** ≥70 Planning domain niche agent definitions in database.',
        ].join('\n'),
        priority: TicketPriority.P2,
        category: 'system_bootstrap',
        depends_on: [4],
    },
    {
        order: 11,
        title: 'Seed niche agent definitions — Verification domain',
        body: [
            '**Objective:** Seed ~80 niche agent definitions for the Verification domain.',
            '',
            '**Domains:** Security Testing, Performance Testing, Compliance, Quality Assurance.',
            '',
            '**Steps:**',
            '1. Verify Verification domain agents exist in database.',
            '2. Log count of Verification domain definitions.',
            '',
            '**Success criteria:** ≥70 Verification domain niche agent definitions in database.',
        ].join('\n'),
        priority: TicketPriority.P2,
        category: 'system_bootstrap',
        depends_on: [5],
    },
    {
        order: 12,
        title: 'Seed niche agent definitions — Coding domain',
        body: [
            '**Objective:** Seed ~150 niche agent definitions for the Coding/Execution domain.',
            '',
            '**Domains:** Language-specific, Framework-specific, DevOps, Database.',
            '',
            '**Steps:**',
            '1. Verify Coding domain agents exist in database.',
            '2. Log count of Coding domain definitions.',
            '',
            '**Success criteria:** ≥100 Coding domain niche agent definitions in database.',
        ].join('\n'),
        priority: TicketPriority.P2,
        category: 'system_bootstrap',
        depends_on: [6],
    },
    {
        order: 13,
        title: 'Seed niche agent definitions — Co-Director domain',
        body: [
            '**Objective:** Seed ~60 niche agent definitions for the Co-Director domain.',
            '',
            '**Domains:** Project Management, Coordination, Reporting.',
            '',
            '**Steps:**',
            '1. Verify Co-Director domain agents exist in database.',
            '2. Log count of Co-Director domain definitions.',
            '',
            '**Success criteria:** ≥50 Co-Director domain niche agent definitions in database.',
        ].join('\n'),
        priority: TicketPriority.P2,
        category: 'system_bootstrap',
        depends_on: [7],
    },
    {
        order: 14,
        title: 'Seed niche agent definitions — Data domain',
        body: [
            '**Objective:** Seed ~100 niche agent definitions for the Data domain.',
            '',
            '**Domains:** Schema Design, Migration, ETL, Analytics, ML.',
            '',
            '**Steps:**',
            '1. Verify Data domain agents exist in database.',
            '2. Log count of Data domain definitions.',
            '',
            '**Success criteria:** ≥80 Data domain niche agent definitions in database.',
        ].join('\n'),
        priority: TicketPriority.P2,
        category: 'system_bootstrap',
        depends_on: [8],
    },
    {
        order: 15,
        title: 'Seed niche agent definitions — Orchestrator domain',
        body: [
            '**Objective:** Seed ~30 niche agent definitions for the Orchestrator domain.',
            '',
            '**Domains:** Routing, Scheduling, Load Balancing.',
            '',
            '**Steps:**',
            '1. Verify Orchestrator domain agents exist in database.',
            '2. Log count of Orchestrator domain definitions.',
            '',
            '**Success criteria:** ≥25 Orchestrator domain niche agent definitions in database.',
        ].join('\n'),
        priority: TicketPriority.P2,
        category: 'system_bootstrap',
        depends_on: [9],
    },

    // ==================== Phase 4: Configuration & Validation ====================
    {
        order: 16,
        title: 'Configure default tool assignments',
        body: [
            '**Objective:** Grant default tools to all tree nodes based on their group roles.',
            '',
            '**Steps:**',
            '1. For each filled group slot, determine the role (HeadOrchestrator, Planning, Worker, etc.).',
            '2. Use ToolAssignmentManager.grantDefaultToolsForRole() for each node.',
            '3. Verify tool inheritance works (FileRead, CodeAnalyze, Lint should propagate).',
            '4. Log total tools assigned.',
            '',
            '**Success criteria:** All tree nodes have appropriate tools for their roles.',
        ].join('\n'),
        priority: TicketPriority.P2,
        category: 'system_bootstrap',
        depends_on: [10, 11, 12, 13, 14, 15],
    },
    {
        order: 17,
        title: 'Run initial system health check',
        body: [
            '**Objective:** Verify all core systems are operational.',
            '',
            '**Steps:**',
            '1. Check LLM endpoint reachability.',
            '2. Check database integrity (all tables exist, no corruption).',
            '3. Verify EventBus is emitting events.',
            '4. Verify MCP server is listening on configured port.',
            '5. Check ticket processor is running.',
            '6. Log system health summary.',
            '',
            '**Success criteria:** All 5 checks pass. System health logged as "healthy".',
        ].join('\n'),
        priority: TicketPriority.P1,
        category: 'system_bootstrap',
        depends_on: [16],
    },
    {
        order: 18,
        title: 'Validate group composition for all L1-L3 groups',
        body: [
            '**Objective:** Run group composition validator on every group in the tree.',
            '',
            '**Steps:**',
            '1. Get all groups at L1, L2, L3.',
            '2. For each group, run validateGroupComposition().',
            '3. Log any warnings (soft violations) and errors (hard violations).',
            '4. If hard violations found, create follow-up tickets to fix them.',
            '',
            '**Success criteria:** Zero hard violations. All groups have valid mandatory roles.',
        ].join('\n'),
        priority: TicketPriority.P2,
        category: 'system_bootstrap',
        depends_on: [16],
    },
    {
        order: 19,
        title: 'Generate welcome report for user',
        body: [
            '**Objective:** Create a summary report of the system bootstrap for the user.',
            '',
            '**Report includes:**',
            '- Total tree nodes created',
            '- Total groups built',
            '- Total niche agent definitions seeded',
            '- Active LLM profile name and endpoint',
            '- Total tool assignments granted',
            '- Any warnings or issues found during bootstrap',
            '',
            '**Success criteria:** Report generated and logged to output channel.',
        ].join('\n'),
        priority: TicketPriority.P3,
        category: 'system_bootstrap',
        depends_on: [17, 18],
    },
    {
        order: 20,
        title: 'Mark system as initialized',
        body: [
            '**Objective:** Set the system initialization flag and emit completion event.',
            '',
            '**Steps:**',
            '1. Set config flag: system_initialized = true.',
            '2. Emit event: system:bootstrap_complete.',
            '3. Log final message: "COE v10.0 bootstrap complete."',
            '',
            '**Success criteria:** Flag set. Event emitted. System ready for user tickets.',
        ].join('\n'),
        priority: TicketPriority.P1,
        category: 'system_bootstrap',
        depends_on: [19],
    },
];

/**
 * StartupTicketManager — creates and tracks the 20 bootstrap tickets.
 */
export class StartupTicketManager {
    constructor(
        private database: Database,
        private eventBus: EventBus,
        private outputChannel: OutputChannelLike
    ) {}

    /**
     * Check if bootstrap tickets have already been created.
     * Looks for tickets with category 'system_bootstrap' and the marker title.
     */
    isBootstrapComplete(): boolean {
        // Check if the final ticket "Mark system as initialized" exists and is completed
        const completed = this.database.getTicketsByStatus(TicketStatus.Completed);
        return completed.some(t => t.title === 'Mark system as initialized' && t.ticket_category === 'system_bootstrap');
    }

    /**
     * Check if bootstrap has been started (at least ticket #1 exists).
     */
    isBootstrapStarted(): boolean {
        const allTickets = this.database.getAllTickets();
        return allTickets.some(t => t.ticket_category === 'system_bootstrap');
    }

    /**
     * Create all 20 bootstrap tickets.
     * Idempotent — skips if bootstrap tickets already exist.
     * Returns the created tickets or empty array if already bootstrapped.
     */
    createBootstrapTickets(): { created: number; skipped: boolean } {
        if (this.isBootstrapStarted()) {
            this.outputChannel.appendLine(
                '[StartupTickets] Bootstrap tickets already exist — skipping creation.'
            );
            return { created: 0, skipped: true };
        }

        this.outputChannel.appendLine(
            '[StartupTickets] Creating 20 bootstrap tickets...'
        );

        // Map from order number to ticket ID for dependency wiring
        const orderToId = new Map<number, string>();

        for (const def of STARTUP_TICKET_DEFS) {
            // Build blocking ticket ID from dependencies
            const blockingIds = def.depends_on
                .map(dep => orderToId.get(dep))
                .filter(Boolean) as string[];

            const ticket = this.database.createTicket({
                title: def.title,
                body: def.body,
                priority: def.priority,
                status: def.depends_on.length === 0 ? TicketStatus.Open : TicketStatus.Blocked,
                creator: 'system',
                auto_created: true,
                operation_type: 'system_bootstrap',
                ticket_category: def.category,
                blocking_ticket_id: blockingIds.length > 0 ? blockingIds[0] : undefined,
                related_ticket_ids: blockingIds.length > 1 ? JSON.stringify(blockingIds.slice(1)) : undefined,
            });

            orderToId.set(def.order, ticket.id);

            this.outputChannel.appendLine(
                `[StartupTickets] Created ticket ${def.order}/20: ${def.title} (${ticket.id})`
            );
        }

        this.eventBus.emit('system:bootstrap_started', 'startup-tickets', {
            ticket_count: 20,
            ticket_ids: [...orderToId.values()],
        });

        this.outputChannel.appendLine(
            '[StartupTickets] All 20 bootstrap tickets created successfully.'
        );

        return { created: 20, skipped: false };
    }

    /**
     * Get the current bootstrap progress.
     */
    getBootstrapProgress(): { total: number; completed: number; in_progress: number; blocked: number; failed: number } {
        const allTickets = this.database.getAllTickets();
        const bootstrapTickets = allTickets.filter(t => t.ticket_category === 'system_bootstrap');

        return {
            total: bootstrapTickets.length,
            completed: bootstrapTickets.filter(t =>
                t.status === TicketStatus.Completed || t.status === TicketStatus.Resolved
            ).length,
            in_progress: bootstrapTickets.filter(t =>
                t.status === TicketStatus.Open || t.status === TicketStatus.Validated ||
                t.status === TicketStatus.ReadyForWork || t.status === TicketStatus.UnderReview
            ).length,
            blocked: bootstrapTickets.filter(t => t.status === TicketStatus.Blocked).length,
            failed: bootstrapTickets.filter(t => t.status === TicketStatus.Failed).length,
        };
    }
}
