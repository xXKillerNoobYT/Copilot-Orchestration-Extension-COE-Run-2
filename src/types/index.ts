// ============================================================
// COE Type Definitions
// Central type system for the Copilot Orchestration Extension
// ============================================================

// --- Enums ---

export enum TaskStatus {
    NotStarted = 'not_started',
    InProgress = 'in_progress',
    Blocked = 'blocked',
    PendingVerification = 'pending_verification',
    Verified = 'verified',
    NeedsReCheck = 'needs_recheck',
    Failed = 'failed',
    Decomposed = 'decomposed'
}

export enum TaskPriority {
    P1 = 'P1',
    P2 = 'P2',
    P3 = 'P3'
}

export enum TicketStatus {
    Open = 'open',
    InReview = 'in_review',
    OnHold = 'on_hold',
    Resolved = 'resolved',
    Escalated = 'escalated',
    Blocked = 'blocked',
    Cancelled = 'cancelled'     // v7.0: Boss AI can cancel tickets (reviewable for re-engagement)
}

export enum TicketPriority {
    P1 = 'P1',
    P2 = 'P2',
    P3 = 'P3'
}

export enum AgentType {
    Orchestrator = 'orchestrator',
    Planning = 'planning',
    Answer = 'answer',
    Verification = 'verification',
    Research = 'research',
    Clarity = 'clarity',
    Boss = 'boss',
    Custom = 'custom',
    UITesting = 'ui_testing',
    Observation = 'observation',
    DesignArchitect = 'design_architect',
    GapHunter = 'gap_hunter',
    DesignHardener = 'design_hardener',
    DecisionMemory = 'decision_memory',
    Review = 'review',
    CodingDirector = 'coding_director',  // v7.0: Interface to external coding agent
    BackendArchitect = 'backend_architect',  // v8.0: Deep BE-specific QA and architecture generation
    UserCommunication = 'user_communication'  // v9.0: Mediates ALL system-to-user messages
}

export enum AgentStatus {
    Idle = 'idle',
    Working = 'working',
    Error = 'error',
    Disabled = 'disabled'
}

/** v7.0: Lead agent team queues — Boss AI distributes tickets across these */
export enum LeadAgentQueue {
    Orchestrator = 'orchestrator',      // Catch-all for unclassified work
    Planning = 'planning',              // Plans, designs, research coordination, decomposition
    Verification = 'verification',      // Testing, review, QA, acceptance checking
    CodingDirector = 'coding_director'  // Interface to external coding agent (MCP)
}

export enum PlanStatus {
    Draft = 'draft',
    Active = 'active',
    Completed = 'completed',
    Archived = 'archived'
}

/** Project lifecycle phases — grouped into 3 stages */
export enum ProjectPhase {
    // Stage 1: Plan & Design
    Planning = 'planning',
    Designing = 'designing',
    DesignReview = 'design_review',
    TaskGeneration = 'task_generation',
    // Stage 2: Code Implementation
    Coding = 'coding',
    DesignUpdate = 'design_update',
    // Stage 3: Verification
    Verification = 'verification',
    Complete = 'complete',
}

/** Standardized error codes per True Plan Doc 02 */
export enum ErrorCode {
    InvalidParam = 'INVALID_PARAM',
    TokenLimitExceeded = 'TOKEN_LIMIT_EXCEEDED',
    Timeout = 'TIMEOUT',
    InternalError = 'INTERNAL_ERROR',
    RateLimit = 'RATE_LIMIT',
    InvalidState = 'INVALID_STATE',
    ResourceNotFound = 'RESOURCE_NOT_FOUND',
    AuthError = 'AUTH_ERROR',
    SchemaValidationFailed = 'SCHEMA_VALIDATION_FAILED',
    RecoveryTriggered = 'RECOVERY_TRIGGERED',
    BreakerFailed = 'BREAKER_FAILED',
    ToolNotFound = 'TOOL_NOT_FOUND',
    DelegationFailed = 'DELEGATION_FAILED',
    LoopDetected = 'LOOP_DETECTED',
    DriftThresholdExceeded = 'DRIFT_THRESHOLD_EXCEEDED',
    CoherenceDrop = 'COHERENCE_DROP',
    TicketUpdateConflict = 'TICKET_UPDATE_CONFLICT',
}

/** Error severity levels */
export type ErrorSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Priority impact on workflow */
export type PriorityImpact = 'NONE' | 'P3_IGNORABLE' | 'P2_DELAYED' | 'P1_BLOCKED';

/** Standardized error response per True Plan Doc 02 */
export interface StandardErrorResponse {
    success: false;
    error: {
        code: ErrorCode;
        message: string;
        details?: Record<string, unknown>;
        severity: ErrorSeverity;
        retryable: boolean;
        retry_after_seconds?: number;
        fallback_suggested: boolean;
        priority_impact: PriorityImpact;
    };
    context: {
        task_id?: string;
        agent_name?: string;
        timestamp: string;
    };
}

/** Error code metadata for retry/escalation logic */
export const ERROR_CODE_META: Record<ErrorCode, { severity: ErrorSeverity; retryable: boolean; defaultRetryDelay: number; priorityImpact: PriorityImpact }> = {
    [ErrorCode.InvalidParam]:           { severity: 'MEDIUM',   retryable: false, defaultRetryDelay: 0,  priorityImpact: 'P1_BLOCKED' },
    [ErrorCode.TokenLimitExceeded]:     { severity: 'HIGH',     retryable: true,  defaultRetryDelay: 15, priorityImpact: 'P1_BLOCKED' },
    [ErrorCode.Timeout]:                { severity: 'HIGH',     retryable: true,  defaultRetryDelay: 30, priorityImpact: 'P2_DELAYED' },
    [ErrorCode.InternalError]:          { severity: 'CRITICAL', retryable: false, defaultRetryDelay: 0,  priorityImpact: 'P1_BLOCKED' },
    [ErrorCode.RateLimit]:              { severity: 'MEDIUM',   retryable: true,  defaultRetryDelay: 60, priorityImpact: 'P2_DELAYED' },
    [ErrorCode.InvalidState]:           { severity: 'MEDIUM',   retryable: false, defaultRetryDelay: 0,  priorityImpact: 'P1_BLOCKED' },
    [ErrorCode.ResourceNotFound]:       { severity: 'LOW',      retryable: false, defaultRetryDelay: 0,  priorityImpact: 'P3_IGNORABLE' },
    [ErrorCode.AuthError]:              { severity: 'CRITICAL', retryable: false, defaultRetryDelay: 0,  priorityImpact: 'P1_BLOCKED' },
    [ErrorCode.SchemaValidationFailed]: { severity: 'MEDIUM',   retryable: false, defaultRetryDelay: 0,  priorityImpact: 'P2_DELAYED' },
    [ErrorCode.RecoveryTriggered]:      { severity: 'HIGH',     retryable: true,  defaultRetryDelay: 10, priorityImpact: 'P1_BLOCKED' },
    [ErrorCode.BreakerFailed]:          { severity: 'HIGH',     retryable: false, defaultRetryDelay: 0,  priorityImpact: 'P1_BLOCKED' },
    [ErrorCode.ToolNotFound]:           { severity: 'MEDIUM',   retryable: false, defaultRetryDelay: 0,  priorityImpact: 'P2_DELAYED' },
    [ErrorCode.DelegationFailed]:       { severity: 'MEDIUM',   retryable: true,  defaultRetryDelay: 15, priorityImpact: 'P2_DELAYED' },
    [ErrorCode.LoopDetected]:           { severity: 'HIGH',     retryable: false, defaultRetryDelay: 0,  priorityImpact: 'P1_BLOCKED' },
    [ErrorCode.DriftThresholdExceeded]: { severity: 'MEDIUM',   retryable: false, defaultRetryDelay: 0,  priorityImpact: 'P1_BLOCKED' },
    [ErrorCode.CoherenceDrop]:          { severity: 'MEDIUM',   retryable: true,  defaultRetryDelay: 20, priorityImpact: 'P2_DELAYED' },
    [ErrorCode.TicketUpdateConflict]:   { severity: 'HIGH',     retryable: true,  defaultRetryDelay: 1,  priorityImpact: 'P2_DELAYED' },
};

/** Helper to create a StandardErrorResponse */
export function createErrorResponse(
    code: ErrorCode,
    message: string,
    options?: { details?: Record<string, unknown>; taskId?: string; agentName?: string }
): StandardErrorResponse {
    const meta = ERROR_CODE_META[code];
    return {
        success: false,
        error: {
            code,
            message,
            details: options?.details,
            severity: meta.severity,
            retryable: meta.retryable,
            retry_after_seconds: meta.retryable ? meta.defaultRetryDelay : undefined,
            fallback_suggested: meta.severity === 'HIGH' || meta.severity === 'CRITICAL',
            priority_impact: meta.priorityImpact,
        },
        context: {
            task_id: options?.taskId,
            agent_name: options?.agentName,
            timestamp: new Date().toISOString(),
        },
    };
}

/** Maps each phase to its stage number (1, 2, or 3) */
export const PHASE_STAGE_MAP: Record<ProjectPhase, number> = {
    [ProjectPhase.Planning]: 1,
    [ProjectPhase.Designing]: 1,
    [ProjectPhase.DesignReview]: 1,
    [ProjectPhase.TaskGeneration]: 1,
    [ProjectPhase.Coding]: 2,
    [ProjectPhase.DesignUpdate]: 2,
    [ProjectPhase.Verification]: 3,
    [ProjectPhase.Complete]: 3,
};

/** Phase display order for UI rendering */
export const PHASE_ORDER: ProjectPhase[] = [
    ProjectPhase.Planning,
    ProjectPhase.Designing,
    ProjectPhase.DesignReview,
    ProjectPhase.TaskGeneration,
    ProjectPhase.Coding,
    ProjectPhase.Verification,
    ProjectPhase.Complete,
];

export enum VerificationStatus {
    NotStarted = 'not_started',
    InProgress = 'in_progress',
    Passed = 'passed',
    Failed = 'failed',
    NeedsReCheck = 'needs_recheck'
}

export enum ConversationRole {
    User = 'user',
    Agent = 'agent',
    System = 'system'
}

// --- Intelligent Task Management (Agent Enhancement) ---

/** A structured checklist item with verification method */
export interface TaskChecklistItem {
    item: string;
    required: boolean;
    verification?: string;  // How to verify this item is done
}

/** Structured passing criteria for task verification */
export interface PassingCriterion {
    criterion: string;
    verification_method: 'unit_test' | 'integration_test' | 'manual_check' | 'code_review' | 'build_check';
    must_pass: boolean;
}

/** Intelligent task requirements — designed to let a small LLM outperform larger models */
export interface TaskRequirements {
    /** Non-negotiable items that MUST be done for this task to be considered complete */
    minimum_requirements: TaskChecklistItem[];
    /** Structured pass/fail criteria with verification methods */
    passing_criteria: PassingCriterion[];
    /** Common pitfalls and things to check for this type of task */
    gotchas: string[];
    /** Explicit completion signals — what "done" looks like */
    definition_of_done: string;
    /** Step-by-step implementation guide */
    implementation_steps: string[];
    /** Things to verify before marking complete */
    pre_completion_checklist: string[];
}

// --- Core Data Models ---

export interface Task {
    id: string;
    title: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
    dependencies: string[];       // array of task IDs
    acceptance_criteria: string;
    plan_id: string | null;
    parent_task_id: string | null;
    sort_order: number;
    estimated_minutes: number;
    files_modified: string[];
    context_bundle: string | null; // JSON string of context for coding AI
    /** Intelligent task requirements — structured checklists, passing criteria, gotchas */
    task_requirements: string | null; // JSON string of TaskRequirements
    created_at: string;
    updated_at: string;
}

/** Processing status for tickets in the auto-processing queue */
export type TicketProcessingStatus = 'queued' | 'processing' | 'awaiting_user' | 'verifying' | 'holding' | null;

/** Deliverable type determines verification strategy */
export type TicketDeliverableType = 'communication' | 'design_change' | 'code_generation' | 'verification' | 'plan_generation' | null;

export interface Ticket {
    id: string;
    ticket_number: number;
    title: string;
    body: string;
    status: TicketStatus;
    priority: TicketPriority;
    creator: string;
    assignee: string | null;
    task_id: string | null;
    parent_ticket_id: string | null;
    auto_created: boolean;
    operation_type: string;
    // v4.0 — Ticket processing fields
    acceptance_criteria: string | null;
    blocking_ticket_id: string | null;
    is_ghost: boolean;
    processing_agent: string | null;
    processing_status: TicketProcessingStatus;
    deliverable_type: TicketDeliverableType;
    verification_result: string | null;
    source_page_ids: string | null;
    source_component_ids: string | null;
    retry_count: number;
    max_retries: number;
    stage: number;
    // v4.1 — Error tracking for AI retry context
    last_error: string | null;
    last_error_at: string | null;
    // v7.0 — Team queue assignment
    assigned_queue: string | null;       // Which lead agent queue this ticket belongs to
    cancellation_reason: string | null;  // Why this ticket was cancelled (for re-engagement review)
    created_at: string;
    updated_at: string;
}

export interface TicketReply {
    id: string;
    ticket_id: string;
    author: string;
    body: string;
    clarity_score: number | null;
    created_at: string;
}

export interface Conversation {
    id: string;
    agent: string;
    role: ConversationRole;
    content: string;
    task_id: string | null;
    ticket_id: string | null;
    tokens_used: number | null;
    created_at: string;
}

export interface Plan {
    id: string;
    name: string;
    status: PlanStatus;
    config_json: string;
    created_at: string;
    updated_at: string;
}

export interface Agent {
    id: string;
    name: string;
    type: AgentType;
    status: AgentStatus;
    config_yaml: string | null;
    last_activity: string | null;
    current_task: string | null;
    created_at: string;
}

export interface AuditLogEntry {
    id: string;
    agent: string;
    action: string;
    detail: string;
    created_at: string;
}

export interface VerificationResult {
    id: string;
    task_id: string;
    status: VerificationStatus;
    results_json: string;
    test_output: string | null;
    coverage_percent: number | null;
    created_at: string;
}

export interface EvolutionLogEntry {
    id: string;
    pattern: string;
    proposal: string;
    status: 'proposed' | 'approved' | 'applied' | 'rolled_back' | 'rejected';
    applied_at: string | null;
    result: string | null;
    created_at: string;
}

// --- GitHub Types ---

export interface GitHubIssue {
    id: string;
    github_id: number;
    number: number;
    title: string;
    body: string;
    state: 'open' | 'closed';
    labels: string[];
    assignees: string[];
    repo_owner: string;
    repo_name: string;
    task_id: string | null;
    local_checksum: string;
    remote_checksum: string;
    synced_at: string;
    created_at: string;
    updated_at: string;
}

// --- LLM Types ---

export interface LLMConfig {
    endpoint: string;
    model: string;
    timeoutSeconds: number;
    startupTimeoutSeconds: number;
    streamStallTimeoutSeconds: number;
    /** Max tokens for output generation (sent to API as max_tokens). Default: 30000. */
    maxTokens: number;
    /** Max tokens for input prompt (hard limit from LM Studio). Default: 4000. Prompts exceeding this are truncated with a warning. */
    maxInputTokens: number;
    /** v6.0: Max concurrent LLM requests (LM Studio thread limit). Default: 4. */
    maxConcurrentRequests?: number;
    /** v6.0: LLM slots reserved for Boss AI (never used by ticket processing). Default: 1. */
    bossReservedSlots?: number;
    /** v6.0: Max retries for a failed LLM request before giving up. Default: 5. */
    maxRequestRetries?: number;
}

export interface LLMMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface LLMRequest {
    messages: LLMMessage[];
    max_tokens?: number;
    temperature?: number;
    stream?: boolean;
    /** v9.0: Override model ID for this specific request (multi-model routing) */
    model?: string;
}

export interface LLMResponse {
    content: string;
    tokens_used: number;
    model: string;
    finish_reason: string;
}

export interface LLMStreamChunk {
    content: string;
    done: boolean;
}

// --- MCP Types ---

export interface MCPToolResult {
    success: boolean;
    data?: unknown;
    error?: string;
}

export interface GetNextTaskResult {
    task_id: string;
    title: string;
    description: string;
    priority: TaskPriority;
    acceptance_criteria: string;
    context_bundle: Record<string, unknown>;
    dependencies_completed: string[];
    related_files: string[];
    plan_excerpt: string;
}

export interface ReportTaskDoneInput {
    task_id: string;
    summary: string;
    files_modified: string[];
    decisions_made: string[];
}

export interface AskQuestionInput {
    question: string;
    task_id?: string;
    context?: string;
}

export interface AskQuestionResult {
    answer: string;
    confidence: number;
    sources: string[];
    escalated: boolean;
}

export interface GetErrorsInput {
    task_id: string;
    error_message: string;
    stack_trace?: string;
}

export interface CallCOEAgentInput {
    agent_name: string;
    message: string;
    context?: Record<string, unknown>;
}

export interface ScanCodebaseResult {
    aligned_files: string[];
    mismatched_files: Array<{ file: string; issue: string }>;
    missing_files: string[];
    summary: string;
    drift_percentage: number;
}

// --- Config Types ---

export interface COEConfig {
    version: string;
    llm: LLMConfig;
    taskQueue: {
        maxPending: number;
    };
    verification: {
        delaySeconds: number;
        coverageThreshold: number;
    };
    watcher: {
        debounceMs: number;
    };
    agents: {
        [key: string]: {
            contextLimit: number;
            enabled: boolean;
        };
    };
    github?: {
        token: string;
        owner: string;
        repo: string;
        syncIntervalMinutes: number;
        autoImport: boolean;
    };
    models?: {
        [modelId: string]: {
            contextWindowTokens: number;
            maxOutputTokens: number;
        };
    };
    tokenBudget?: TokenBudgetConfig;
    /** Sync configuration for multi-device sync (v2.0) */
    sync?: {
        enabled: boolean;
        backend: 'cloud' | 'nas' | 'p2p';
        endpoint: string;
        autoSyncIntervalSeconds: number;
    };
    /** Ethics configuration (v2.0) */
    ethics?: {
        enabled: boolean;
        sensitivity: 'low' | 'medium' | 'high' | 'maximum';
    };
    /** Design QA thresholds (v4.0) */
    designQaScoreThreshold?: number;       // default 80, min 50
    /** Ticket processing limits (v4.0) */
    maxActiveTickets?: number;             // default 10
    maxTicketRetries?: number;             // default 3
    maxClarificationRounds?: number;       // default 5
    /** Boss AI thresholds (v4.0) */
    bossIdleTimeoutMinutes?: number;       // default 5
    bossStuckPhaseMinutes?: number;        // default 30
    bossTaskOverloadThreshold?: number;    // default 20
    bossEscalationThreshold?: number;      // default 5
    /** Clarity Agent thresholds (v4.0) */
    clarityAutoResolveScore?: number;      // default 85
    clarityClarificationScore?: number;    // default 70
    /** v5.0: Global AI processing mode */
    aiMode?: 'manual' | 'suggest' | 'smart' | 'hybrid';  // default 'smart'
    /** v5.0: Auto-run Boss AI countdown (enables/disables idle timer) */
    bossAutoRunEnabled?: boolean;          // default true
    /** v6.0: Max concurrent ticket pipelines (batch size). Default: 3. */
    bossParallelBatchSize?: number;        // default 3
    /** v6.0: Model each agent prefers (key=agent name, value=model ID). Agents not listed use main model. */
    agentModels?: { [agentName: string]: string };
    /** v6.0: Hold timeout when waiting for model swap (ms). Default: 1 hour. */
    modelHoldTimeoutMs?: number;           // default 3600000
    /** v6.0: Currently loaded model in LM Studio (auto-detected or set by Boss). */
    activeModel?: string;
    /** v6.0: Max different models to use in one queue cycle (prevents excessive swapping). Default: 2. */
    maxModelsPerCycle?: number;            // default 2
    /** v6.0: Whether multi-model mode is enabled (default: false, one model at a time). */
    multiModelEnabled?: boolean;           // default false
    /** v7.0: Boss-controlled slot allocation per team queue. Total must not exceed bossParallelBatchSize. */
    teamSlotAllocation?: Record<string, number>;
    /** v7.0: How often Boss reviews cancelled tickets for re-engagement (ms). Default: 30 min. */
    cancelledTicketReviewIntervalMs?: number;
    /** v7.0: Max time for a synchronous support agent call (ms). Default: 60s. */
    maxSupportAgentSyncTimeoutMs?: number;
    // v9.0: Agent Hierarchy, Workflow Designer, User Communication
    /** v9.0: Maximum depth for agent tree (always 10). */
    maxAgentTreeDepth?: number;
    /** v9.0: Default max fanout (children) per tree node. Default: 5. */
    defaultMaxFanout?: number;
    /** v9.0: Whether MCP confirmation is required before calling agents externally. */
    mcpConfirmationRequired?: boolean;
    /** v9.0: Timeout for MCP confirmation before expiry (ms). Default: 60000. */
    mcpConfirmationTimeoutMs?: number;
    /** v9.0: User's self-reported programming level. Default: 'good'. */
    userProgrammingLevel?: string;
    /** v9.0: Whether the Workflow Designer is enabled. Default: true. */
    workflowDesignerEnabled?: boolean;
    /** v9.0: Whether ALL user-facing messages go through UserCommAgent. Default: true. */
    userCommInterceptAll?: boolean;
    /** v9.0: Per-agent model assignments (key=agent type, value=model config). */
    agentModelAssignments?: Record<string, { model_id: string; capability: string }>;
    /** v9.0: Which tree template to use for new plans. Default: 'standard'. */
    defaultTreeTemplate?: string;
}

// --- Agent Framework Types ---

export interface AgentContext {
    task?: Task;
    ticket?: Ticket;
    plan?: Plan;
    conversationHistory: Conversation[];
    additionalContext?: Record<string, unknown>;
}

export interface AgentResponse {
    content: string;
    confidence?: number;
    sources?: string[];
    actions?: AgentAction[];
    tokensUsed?: number;
}

export interface AgentAction {
    type: 'create_task' | 'create_ticket' | 'update_task' | 'escalate' | 'log'
        | 'dispatch_agent'      // v6.0: call agent directly (always creates tracking ticket)
        | 'reprioritize'        // v6.0: change ticket priority
        | 'reorder_queue'       // v6.0: move ticket to front/back of queue
        | 'hold_ticket'         // v6.0: put ticket on hold (model mismatch)
        | 'update_notepad'      // v6.0: Boss AI writes to its persistent notepad
        // v7.0: Team queue orchestration
        | 'assign_task'         // Structured task assignment with success criteria
        | 'escalate_to_boss'    // Lead agent returns ticket to Boss with structured reason
        | 'call_support_agent'  // Lead agent calls support agent (sync or async)
        | 'block_ticket'        // Mark ticket blocked with reason
        | 'cancel_ticket'       // Remove ticket from queue, mark cancelled
        | 'move_to_queue'       // Move ticket between team queues
        | 'save_document'       // Save research findings to support docs folder
        | 'update_slot_allocation'; // Boss dynamically reallocates team slots
    payload: Record<string, unknown>;
}

// --- v7.0: Team Queue Orchestration Types ---

/** Structured task assignment — Boss/Orchestrator assigns work with success criteria */
export interface TaskAssignment {
    /** Which agent to assign the task to */
    target_agent: string;
    /** Human-readable task description (the prompt sent to the agent) */
    task_message: string;
    /** Structured success criteria — how to determine if the task succeeded */
    success_criteria: TaskCriterion[];
    /** Priority for queue ordering */
    priority: TicketPriority;
    /** The source ticket this assignment relates to (if any) */
    source_ticket_id?: string;
    /** Who requested this assignment (boss, orchestrator, lead agent) */
    requester: string;
    /** Which lead agent queue to route through (null = direct dispatch) */
    target_queue?: LeadAgentQueue;
    /** Maximum time before the assignment is considered failed (ms) */
    timeout_ms?: number;
    /** Additional context to pass to the agent */
    context?: Record<string, unknown>;
}

/** Individual success criterion for a task assignment */
export interface TaskCriterion {
    criterion: string;
    verification_method: 'output_contains' | 'ticket_resolved' | 'file_exists' | 'info_gathered' | 'manual_check';
    required: boolean;
}

/** Result of a completed task assignment */
export interface TaskAssignmentResult {
    assignment_id: string;
    status: 'completed' | 'failed' | 'partial' | 'timeout';
    agent_response: string;
    criteria_results: Array<{ criterion: string; passed: boolean; detail: string }>;
    duration_ms: number;
    escalation_reason?: string;
}

/** Lead agent escalation payload — sent back to Boss when agent can't proceed */
export interface EscalationPayload {
    ticket_id: string;
    reason: string;
    recommended_target: LeadAgentQueue | null;
    blocking_info_needed?: string;
    priority_override?: TicketPriority;
}

/** Support agent call — lead agent requests help from a support agent */
export interface SupportAgentCall {
    /** Which support agent to call: 'research', 'answer', 'clarity', 'decision_memory', 'observation' */
    agent_name: string;
    /** The query/prompt for the support agent */
    query: string;
    /** Which ticket this call is for (tracking) */
    ticket_id: string;
    /** sync = inline call (agent waits for result), async = sub-ticket (agent's ticket goes on hold) */
    mode: 'sync' | 'async';
    /** What to do with the result: resume processing, block ticket, or escalate to boss */
    callback_action: 'resume' | 'block' | 'escalate';
}

/** Support document — organized reference material saved by Research Agent */
export interface SupportDocument {
    id: string;
    plan_id: string | null;
    folder_name: string;
    document_name: string;
    content: string;
    summary: string | null;
    category: string;
    source_ticket_id: string | null;
    source_agent: string | null;
    tags: string[];
    is_verified: boolean;
    verified_by: string | null;
    relevance_score: number;
    /** v8.0: Who created this document — determines editing rights */
    source_type: 'user' | 'system';
    /** v8.0: Lock status — user docs only editable by user, system docs only by system */
    is_locked: boolean;
    created_at: string;
    updated_at: string;
}

/** Per-team queue status — used by Boss AI for decision-making and UI display */
export interface TeamQueueStatus {
    queue: LeadAgentQueue;
    pending: number;
    active: number;
    blocked: number;
    cancelled: number;
    lastServedAt: number;       // Timestamp for round-robin balancing
    allocatedSlots: number;     // Boss-assigned slot count for this team
    /** v10.0: Slots this team has borrowed from idle teams */
    borrowedSlots: number;
    /** v10.0: Slots this team has lent to busy teams (its own slots in use by others) */
    lentSlots: number;
    /** v10.0: Effective slots = allocatedSlots + borrowedSlots - lentSlots */
    effectiveSlots: number;
}

/** Boss notepad section — persistent memory across Boss cycles */
export interface BossNotepadSection {
    id: string;
    section: string;            // 'queue_strategy' | 'blockers' | 'patterns' | 'next_actions' | 'general'
    content: string;
    updated_at: string;
}

// --- Design Component Types ---

export interface DesignComponent {
    id: string;
    plan_id: string;
    page_id: string | null;
    type: 'container' | 'text' | 'button' | 'input' | 'image' | 'card' | 'nav' | 'modal' | 'sidebar' | 'header' | 'footer' | 'list' | 'table' | 'form' | 'divider' | 'icon' | 'custom';
    name: string;
    parent_id: string | null;
    sort_order: number;
    // Position & sizing
    x: number;
    y: number;
    width: number;
    height: number;
    // Style properties
    styles: ComponentStyles;
    // Content
    content: string;
    props: Record<string, unknown>;
    // Requirements (user stories for this component)
    requirements: DesignRequirement[];
    // Responsive overrides
    responsive: {
        tablet?: Partial<ComponentStyles & { x: number; y: number; width: number; height: number; visible: boolean }>;
        mobile?: Partial<ComponentStyles & { x: number; y: number; width: number; height: number; visible: boolean }>;
    };
    // Draft flag (set by Design Hardener / QA pipeline)
    is_draft?: boolean;
    created_at: string;
    updated_at: string;
}

export interface ComponentStyles {
    backgroundColor?: string;
    color?: string;
    fontSize?: string;
    fontWeight?: string;
    fontFamily?: string;
    padding?: string;
    margin?: string;
    borderRadius?: string;
    border?: string;
    boxShadow?: string;
    opacity?: number;
    display?: string;
    flexDirection?: string;
    justifyContent?: string;
    alignItems?: string;
    gap?: string;
    overflow?: string;
    position?: string;
    zIndex?: number;
    textAlign?: string;
    lineHeight?: string;
    letterSpacing?: string;
    cursor?: string;
}

export interface DesignRequirement {
    role: string;
    action: string;
    benefit: string;
}

export interface DesignPage {
    id: string;
    plan_id: string;
    parent_page_id: string | null;
    depth: number;
    name: string;
    route: string;
    sort_order: number;
    width: number;
    height: number;
    background: string;
    requirements: DesignRequirement[];
    created_at: string;
    updated_at: string;
}

export interface DesignToken {
    id: string;
    plan_id: string;
    category: 'color' | 'spacing' | 'typography' | 'border' | 'shadow' | 'breakpoint';
    name: string;
    value: string;
    description: string;
    created_at: string;
}

export interface PageFlow {
    id: string;
    plan_id: string;
    from_page_id: string;
    to_page_id: string;
    trigger: string;
    label: string;
    created_at: string;
}

export interface CodingMessage {
    id: string;
    session_id: string;
    role: 'user' | 'agent' | 'system';
    content: string;
    tool_calls: string;
    task_id: string | null;
    created_at: string;
}

export interface CodingSession {
    id: string;
    plan_id: string | null;
    name: string;
    status: 'active' | 'completed' | 'paused';
    version_snapshot_id: string | null;
    branch_type: string | null;
    created_at: string;
    updated_at: string;
}

// --- Token & Context Management Types ---

export enum ContentType {
    Code = 'code',
    NaturalText = 'natural_text',
    JSON = 'json',
    Markdown = 'markdown',
    Mixed = 'mixed'
}

export enum ContextCategory {
    SystemPrompt = 'system_prompt',
    CurrentTask = 'current_task',
    UserMessage = 'user_message',
    ActivePlan = 'active_plan',
    RelatedTicket = 'related_ticket',
    RecentHistory = 'recent_history',
    DesignComponents = 'design_components',
    ComponentSchemas = 'component_schemas',
    EthicsRules = 'ethics_rules',
    SyncState = 'sync_state',
    OlderHistory = 'older_history',
    Supplementary = 'supplementary',
}

export enum ContextPriority {
    Mandatory = 1,
    Important = 2,
    Supplementary = 3,
    Optional = 4,
}

export enum ContextBreakingLevel {
    None = 0,
    SummarizeOld = 1,
    PrioritizeRecent = 2,
    SmartChunking = 3,
    DiscardLowRelevance = 4,
    FreshStart = 5,
}

export enum DecompositionStrategy {
    ByFile = 'by_file',
    ByPropertyGroup = 'by_property_group',
    ByComponent = 'by_component',
    ByDependency = 'by_dependency',
    ByPhase = 'by_phase',
    ByComplexity = 'by_complexity',
    Hybrid = 'hybrid',
}

export enum SubtaskCategory {
    Setup = 'setup',
    Implementation = 'implementation',
    Testing = 'testing',
    Documentation = 'documentation',
    Integration = 'integration',
    Styling = 'styling',
    Configuration = 'configuration',
}

export interface ModelProfile {
    id: string;
    name: string;
    contextWindowTokens: number;
    maxOutputTokens: number;
    tokensPerChar: Record<ContentType, number>;
    overheadTokensPerMessage: number;
}

export interface TokenBudget {
    modelProfile: ModelProfile;
    totalContextWindow: number;
    reservedForOutput: number;
    availableForInput: number;
    consumed: number;
    remaining: number;
    warningLevel: 'ok' | 'warning' | 'critical' | 'exceeded';
    items: TokenBudgetItem[];
}

export interface TokenBudgetItem {
    label: string;
    contentType: ContentType;
    charCount: number;
    estimatedTokens: number;
    priority: ContextPriority;
    included: boolean;
}

export interface TokenBudgetWarning {
    level: 'warning' | 'critical';
    message: string;
    budgetUsedPercent: number;
    remainingTokens: number;
    suggestion: string;
}

export interface ContextItem {
    id: string;
    label: string;
    content: string;
    contentType: ContentType;
    category: ContextCategory;
    priority: ContextPriority;
    relevanceScore: number;
    estimatedTokens: number;
    metadata: {
        sourceType: 'task' | 'ticket' | 'plan' | 'history' | 'component' | 'schema' | 'ethics_rule' | 'sync_state' | 'code' | 'custom';
        sourceId: string;
        createdAt: string;
        isStale: boolean;
        relatedTaskIds: string[];
        relatedFilePatterns: string[];
    };
}

export interface RelevanceKeywordSet {
    taskKeywords: string[];
    fileKeywords: string[];
    domainKeywords: string[];
}

export interface ContextFeedResult {
    messages: LLMMessage[];
    budget: TokenBudget;
    includedItems: ContextItem[];
    excludedItems: ContextItem[];
    compressionApplied: boolean;
    totalItemsConsidered: number;
}

export interface ContextBreakingResult {
    strategyApplied: ContextBreakingLevel;
    originalTokens: number;
    resultTokens: number;
    reductionPercent: number;
    itemsDropped: number;
    freshStartTriggered: boolean;
    savedState: ContextSnapshot | null;
}

export interface ContextSnapshot {
    id: string;
    agent_type: string;
    task_id: string | null;
    ticket_id: string | null;
    summary: string;
    essential_context: string;
    resume_instructions: string;
    created_at: string;
}

export interface DecompositionResult {
    originalTaskId: string;
    subtasks: SubtaskDefinition[];
    strategy: DecompositionStrategy;
    reason: string;
    estimatedTotalMinutes: number;
    isFullyCovered: boolean;
}

export interface SubtaskDefinition {
    title: string;
    description: string;
    priority: TaskPriority;
    estimatedMinutes: number;
    acceptanceCriteria: string;
    dependencies: string[];
    filesToModify: string[];
    filesToCreate: string[];
    contextBundle: string;
    category: SubtaskCategory;
}

export interface DecompositionRule {
    name: string;
    condition: (task: Task, metadata: TaskMetadata) => boolean;
    strategy: DecompositionStrategy;
    priority: number;
    decompose: (task: Task, metadata: TaskMetadata) => SubtaskDefinition[];
}

export interface TaskMetadata {
    fileCount: number;
    filesModified: string[];
    filesToCreate: string[];
    componentCount: number;
    propertyCount: number;
    dependencyCount: number;
    hasTests: boolean;
    hasDocs: boolean;
    hasUI: boolean;
    isDesignTask: boolean;
    isSyncTask: boolean;
    isEthicsTask: boolean;
    estimatedComplexity: 'low' | 'medium' | 'high' | 'very_high';
    keywordSignals: string[];
}

export interface TokenBudgetConfig {
    warningThresholdPercent: number;
    criticalThresholdPercent: number;
    inputBufferPercent: number;
}

// --- Custom Agent Types ---

export interface CustomAgentConfig {
    name: string;
    description: string;
    systemPrompt: string;
    goals: Array<{
        description: string;
        priority: number;
    }>;
    checklist: Array<{
        item: string;
        required: boolean;
    }>;
    routingKeywords: string[];
    permissions: {
        readFiles: boolean;
        searchCode: boolean;
        createTickets: boolean;
        callLLM: boolean;
        // These are ALWAYS false (hardlocked)
        writeFiles: false;
        executeCode: false;
    };
    limits: {
        maxGoals: number;
        maxLLMCalls: number;
        maxTimeMinutes: number;
        timePerGoalMinutes: number;
    };
}

// ============================================================
// Program Designer v2.0 — New Type Definitions
// Sync, Ethics, Coding Agent, Transparency, Component Schema
// ============================================================

// --- v2.0 Enums ---

export enum SyncBackend {
    Cloud = 'cloud',
    NAS = 'nas',
    P2P = 'p2p'
}

export enum SyncStatus {
    Idle = 'idle',
    Syncing = 'syncing',
    Conflict = 'conflict',
    Error = 'error',
    Offline = 'offline'
}

export enum ConflictResolutionStrategy {
    LastWriteWins = 'last_write_wins',
    UserChoice = 'user_choice',
    Merge = 'merge',
    KeepLocal = 'keep_local',
    KeepRemote = 'keep_remote'
}

export enum EthicsSensitivity {
    Low = 'low',
    Medium = 'medium',
    High = 'high',
    Maximum = 'maximum'
}

export enum CodeDiffStatus {
    Pending = 'pending',
    Approved = 'approved',
    Rejected = 'rejected',
    Applied = 'applied'
}

export enum LogicBlockType {
    If = 'if',
    ElseIf = 'else_if',
    Else = 'else',
    Loop = 'loop',
    Action = 'action',
    EventHandler = 'event_handler',
    Switch = 'switch',
    Case = 'case',
    TryCatch = 'try_catch'
}

// --- Component Schema Types ---

export interface ComponentSchema {
    id: string;
    /** Component type identifier: matches DesignComponent.type or extended types */
    type: string;
    /** Human-readable display name */
    display_name: string;
    /** Category for grouping in the component library palette */
    category: 'primitive_input' | 'container' | 'interactive_logic' | 'data_sync' | 'ethics_rights' | 'display' | 'navigation' | 'custom';
    /** Description shown in the component library tooltip */
    description: string;
    /** Configurable properties with types, defaults, and validation */
    properties: ComponentSchemaProperty[];
    /** Events this component can emit */
    events: ComponentSchemaEvent[];
    /** Default styles applied when dragged onto canvas */
    default_styles: Partial<ComponentStyles>;
    /** Default dimensions (width x height) */
    default_size: { width: number; height: number };
    /** Code templates keyed by output format */
    code_templates: {
        react_tsx: string;
        html: string;
        css: string;
    };
    /** Icon identifier for the component palette (VS Code codicon name) */
    icon: string;
    /** Whether this is a container that can hold children */
    is_container: boolean;
    /** Allowed child component types (empty array = any, null = no children) */
    allowed_children: string[] | null;
    /** Minimum and maximum instance counts per page (null = unlimited) */
    instance_limits: { min: number; max: number | null };
    created_at: string;
    updated_at: string;
}

export interface ComponentSchemaProperty {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'color' | 'enum' | 'json' | 'expression';
    default_value: unknown;
    required: boolean;
    description: string;
    /** For enum types, the allowed values */
    enum_values?: string[];
    /** Validation constraints */
    validation?: {
        min?: number;
        max?: number;
        pattern?: string;
        max_length?: number;
    };
}

export interface ComponentSchemaEvent {
    name: string;
    description: string;
    /** TypeScript type signature for the event payload */
    payload_type: string;
    /** Example handler code */
    example_handler: string;
}

// --- Sync Types ---

export interface SyncConfig {
    id: string;
    /** Which sync backend to use */
    backend: SyncBackend;
    /** Backend-specific endpoint URL */
    endpoint: string;
    /** Reference to a stored credential (never store raw secrets) */
    credentials_ref: string;
    /** Whether sync is currently enabled */
    enabled: boolean;
    /** Auto-sync interval in seconds (0 = manual only) */
    auto_sync_interval_seconds: number;
    /** Conflict resolution default strategy */
    default_conflict_strategy: ConflictResolutionStrategy;
    /** Maximum file size to sync in bytes (default 50MB) */
    max_file_size_bytes: number;
    /** Directories/patterns to exclude from sync */
    exclude_patterns: string[];
    /** This device's unique identifier */
    device_id: string;
    /** Display name for this device */
    device_name: string;
    created_at: string;
    updated_at: string;
}

export interface SyncState {
    device_id: string;
    device_name: string;
    status: SyncStatus;
    /** ISO timestamp of last successful sync */
    last_sync_at: string | null;
    /** Number of pending local changes */
    pending_changes: number;
    /** Number of unresolved conflicts */
    unresolved_conflicts: number;
    /** Current sync progress (0-100, null if not syncing) */
    progress_percent: number | null;
    /** Error message if status is 'error' */
    error_message: string | null;
    /** Vector clock for causal ordering */
    vector_clock: Record<string, number>;
}

export interface SyncConflict {
    id: string;
    /** The entity type that conflicted */
    entity_type: 'design_component' | 'design_page' | 'design_token' | 'page_flow' | 'task' | 'plan';
    /** The entity ID */
    entity_id: string;
    /** JSON snapshot of the local version */
    local_version: string;
    /** JSON snapshot of the remote version */
    remote_version: string;
    /** Device ID that created the remote version */
    remote_device_id: string;
    /** ISO timestamp of local change */
    local_changed_at: string;
    /** ISO timestamp of remote change */
    remote_changed_at: string;
    /** The specific fields that conflict */
    conflicting_fields: string[];
    /** Current resolution status */
    resolution: ConflictResolutionStrategy | null;
    /** Who resolved it (device_id or 'auto') */
    resolved_by: string | null;
    /** ISO timestamp of resolution */
    resolved_at: string | null;
    created_at: string;
}

export interface SyncChange {
    id: string;
    /** The entity type that changed */
    entity_type: string;
    /** The entity ID */
    entity_id: string;
    /** Type of change */
    change_type: 'create' | 'update' | 'delete';
    /** Device that originated the change */
    device_id: string;
    /** SHA-256 hash of the entity state before the change */
    before_hash: string;
    /** SHA-256 hash of the entity state after the change */
    after_hash: string;
    /** JSON diff (RFC 6902 JSON Patch format) */
    patch: string;
    /** Monotonic sequence number per device */
    sequence_number: number;
    /** Whether this change has been synced to remote */
    synced: boolean;
    created_at: string;
}

// --- Ethics Types ---

export interface EthicsModule {
    id: string;
    /** Human-readable module name (e.g. "Data Privacy", "Content Safety") */
    name: string;
    /** Detailed description of what this module governs */
    description: string;
    /** Whether this module is currently active */
    enabled: boolean;
    /** Sensitivity level controlling how strict the rules are */
    sensitivity: EthicsSensitivity;
    /** Broad action categories this module governs */
    scope: string[];
    /** Actions explicitly allowed under this module */
    allowed_actions: string[];
    /** Actions explicitly blocked under this module */
    blocked_actions: string[];
    /** Ordered list of rules within this module */
    rules: EthicsRule[];
    /** Version for tracking module updates */
    version: number;
    created_at: string;
    updated_at: string;
}

export interface EthicsRule {
    id: string;
    /** Parent module ID */
    module_id: string;
    /** Human-readable rule name */
    name: string;
    /** Natural language description of the rule */
    description: string;
    /** The condition expression (evaluated against action context) */
    condition: string;
    /** What happens when the condition matches */
    action: 'allow' | 'block' | 'warn' | 'audit';
    /** Priority for rule evaluation order (lower = higher priority) */
    priority: number;
    /** Whether this rule is currently active */
    enabled: boolean;
    /** Optional message shown when rule triggers */
    message: string;
    created_at: string;
}

export interface EthicsAuditEntry {
    id: string;
    /** The module that evaluated this action */
    module_id: string;
    /** The specific rule that triggered (null if no rule matched) */
    rule_id: string | null;
    /** The action that was evaluated */
    action_description: string;
    /** The evaluation result */
    decision: 'allowed' | 'blocked' | 'warned' | 'overridden';
    /** The agent or service that requested the action */
    requestor: string;
    /** Context JSON at the time of evaluation */
    context_snapshot: string;
    /** If overridden, who approved the override */
    override_by: string | null;
    /** Reason for override (if applicable) */
    override_reason: string | null;
    created_at: string;
}

export interface EthicsEvaluationResult {
    allowed: boolean;
    decision: 'allowed' | 'blocked' | 'warned';
    triggeredRules: EthicsRule[];
    messages: string[];
    auditEntryId: string;
}

export interface EthicsActionContext {
    action: string;
    source: string;
    targetEntityType?: string;
    targetEntityId?: string;
    metadata?: Record<string, unknown>;
}

// --- Coding Agent Types ---

export interface CodingAgentRequest {
    id: string;
    /** The natural language command from the user */
    command: string;
    /** Intent classification result */
    intent: 'build' | 'modify' | 'explain' | 'fix' | 'automate' | 'query';
    /** Target component IDs this command applies to */
    target_component_ids: string[];
    /** Target page ID context */
    page_id: string | null;
    /** Target plan ID context */
    plan_id: string | null;
    /** The output format requested */
    output_format: 'react_tsx' | 'html' | 'css' | 'typescript' | 'json';
    /** Additional constraints or preferences */
    constraints: Record<string, unknown>;
    /** Conversation session ID for multi-turn interactions */
    session_id: string | null;
    created_at: string;
}

export interface CodingAgentResponse {
    id: string;
    /** The request this responds to */
    request_id: string;
    /** Generated code (main output) */
    code: string;
    /** Language of the generated code */
    language: string;
    /** Natural language explanation of what was generated */
    explanation: string;
    /** Multiple output files if the generation spans several files */
    files: Array<{ name: string; content: string; language: string }>;
    /** Confidence score (0-100) */
    confidence: number;
    /** Warnings or suggestions */
    warnings: string[];
    /** Whether this response requires user approval before applying */
    requires_approval: boolean;
    /** The diff if this modifies existing code */
    diff: CodeDiff | null;
    /** Tokens consumed by the LLM */
    tokens_used: number;
    /** Processing time in milliseconds */
    duration_ms: number;
    created_at: string;
}

export interface CodeDiff {
    id: string;
    /** Source request ID */
    request_id: string;
    /** The entity being modified (component, page, file) */
    entity_type: string;
    /** Entity ID */
    entity_id: string;
    /** Code before the change */
    before: string;
    /** Code after the change */
    after: string;
    /** Unified diff format string */
    unified_diff: string;
    /** Number of lines added */
    lines_added: number;
    /** Number of lines removed */
    lines_removed: number;
    /** Current approval status */
    status: CodeDiffStatus;
    /** Who approved/rejected */
    reviewed_by: string | null;
    /** Review comment */
    review_comment: string | null;
    created_at: string;
    updated_at: string;
}

// --- Logic Block Types ---

export interface LogicBlock {
    id: string;
    /** Parent page or component this logic belongs to */
    page_id: string | null;
    component_id: string | null;
    plan_id: string;
    /** Block type */
    type: LogicBlockType;
    /** Display label in the visual editor */
    label: string;
    /** The condition expression (for if/else_if/loop/switch) */
    condition: string;
    /** The body code or nested block references */
    body: string;
    /** Parent block ID for nesting (null = top level) */
    parent_block_id: string | null;
    /** Ordering within the parent */
    sort_order: number;
    /** Generated TypeScript code from this block */
    generated_code: string;
    /** Visual position on canvas */
    x: number;
    y: number;
    width: number;
    height: number;
    /** Whether this block is collapsed in the visual editor */
    collapsed: boolean;
    created_at: string;
    updated_at: string;
}

// --- Device & Transparency Types ---

export interface DeviceInfo {
    id: string;
    /** Unique device identifier (machine-generated UUID) */
    device_id: string;
    /** User-facing device name */
    name: string;
    /** Operating system identifier */
    os: string;
    /** Last known IP address or network identifier */
    last_address: string;
    /** Last time this device was seen online */
    last_seen_at: string;
    /** Whether this is the current device */
    is_current: boolean;
    /** Whether sync is enabled for this device */
    sync_enabled: boolean;
    /** Device-specific vector clock value */
    clock_value: number;
    created_at: string;
}

export interface ActionLog {
    id: string;
    /** Which subsystem performed the action */
    source: 'coding_agent' | 'ethics_engine' | 'sync_service' | 'designer_engine' | 'user' | 'system';
    /** Action category for filtering */
    category: 'code_generation' | 'ethics_decision' | 'sync_operation' | 'design_change' | 'configuration' | 'error';
    /** Human-readable action description */
    action: string;
    /** Detailed payload/context as JSON */
    detail: string;
    /** Severity level */
    severity: 'info' | 'warning' | 'error' | 'critical';
    /** Related entity type (optional) */
    entity_type: string | null;
    /** Related entity ID (optional) */
    entity_id: string | null;
    /** Device that originated the action */
    device_id: string | null;
    /** Session or request ID for correlation */
    correlation_id: string | null;
    /** Whether this entry has been synced to remote log */
    synced: boolean;
    created_at: string;
}

// --- Conflict Resolution Types ---

export interface ResolutionSuggestion {
    strategy: ConflictResolutionStrategy;
    confidence: number;
    reason: string;
    preview: string;
}

// --- Enhanced Planning Types (Phase 3) ---

export type ImplementationStatus = 'not_started' | 'planned' | 'in_progress' | 'implemented' | 'verified' | 'has_issues';
export type IssueSeverity = 'bug' | 'improvement' | 'question';
export type IssueStatus = 'open' | 'resolved' | 'wontfix';
export type PlanMode = 'frontend' | 'backend' | 'fullstack';
export type SuggestionType = 'layout' | 'missing_component' | 'ux_issue' | 'implementation_blocker' | 'plan_update' | 'architecture' | 'review_request' | 'general';
export type SuggestionActionType = 'add_component' | 'modify_component' | 'create_ticket' | 'update_task' | 'add_task' | 'modify_plan' | null;
export type SuggestionStatus = 'pending' | 'accepted' | 'dismissed' | 'applied' | 'rejected';
export type QuestionCategory = 'frontend' | 'backend' | 'ux' | 'architecture' | 'data' | 'general';
export type QuestionType = 'yes_no' | 'choice' | 'text' | 'confirm';
export type QuestionStatus = 'pending' | 'answered' | 'autofilled' | 'dismissed';
export type ReadinessLevel = 'not_ready' | 'needs_work' | 'almost_ready' | 'ready';

export interface ElementStatusData {
    implementation_status: ImplementationStatus;
    has_questions: boolean;
    checklist: Array<{ item: string; done: boolean; mode: PlanMode }>;
}

/** Phase-aware lifecycle stage for element status */
export type LifecycleStage = 'design' | 'coding' | 'testing' | 'verification';

/** Persisted per-element status record (stored in element_status table) */
export interface ElementStatus {
    id: string;
    element_id: string;
    element_type: 'component' | 'page';
    plan_id: string;
    /** Current implementation status */
    implementation_status: ImplementationStatus;
    /** Which lifecycle stage this element is in */
    lifecycle_stage: LifecycleStage;
    /** Readiness percentage 0-100 for current stage */
    readiness_pct: number;
    /** Computed readiness level */
    readiness_level: ReadinessLevel;
    /** Per-mode (frontend/backend) status JSON */
    mode_status: Record<PlanMode, ImplementationStatus>;
    /** Checklist items JSON */
    checklist: Array<{ item: string; done: boolean; mode: PlanMode }>;
    /** Notes/comments */
    notes: string;
    created_at: string;
    updated_at: string;
}

/** Summary of a page's readiness across all its elements */
export interface PageReadinessSummary {
    page_id: string;
    page_name: string;
    total_elements: number;
    elements_by_status: Record<ImplementationStatus, number>;
    readiness_pct: number;
    readiness_level: ReadinessLevel;
    open_issues: number;
    pending_questions: number;
    lifecycle_stage: LifecycleStage;
}

export interface ElementIssue {
    id: string;
    element_id: string;
    element_type: 'component' | 'page';
    plan_id: string;
    description: string;
    status: IssueStatus;
    severity: IssueSeverity;
    mode: PlanMode;
    reported_by: string;
    created_at: string;
    resolved_at: string | null;
}

export interface AISuggestion {
    id: string;
    plan_id: string;
    component_id: string | null;
    page_id: string | null;
    type: SuggestionType;
    title: string;
    description: string;
    reasoning: string;
    /** The goal this suggestion achieves */
    goal: string;
    /** Which agent generated this suggestion */
    source_agent: string | null;
    /** What kind of entity is being targeted */
    target_type: 'page' | 'component' | 'token' | 'flow' | 'property' | 'requirement' | null;
    /** ID of the target entity */
    target_id: string | null;
    /** Current value before the change (JSON) */
    current_value: string | null;
    /** Proposed new value (JSON) */
    suggested_value: string | null;
    action_type: SuggestionActionType;
    action_payload: Record<string, unknown>;
    priority: TicketPriority;
    status: SuggestionStatus;
    ticket_id: string | null;
    /** When the suggestion was approved */
    approved_at: string | null;
    /** When the suggestion was rejected */
    rejected_at: string | null;
    /** Reason for rejection (if rejected) */
    rejection_reason: string | null;
    created_at: string;
    updated_at: string;
}

export interface AIQuestion {
    id: string;
    plan_id: string;
    component_id: string | null;
    page_id: string | null;
    category: QuestionCategory;
    question: string;
    question_type: QuestionType;
    options: string[];
    ai_reasoning: string;
    ai_suggested_answer: string | null;
    user_answer: string | null;
    status: QuestionStatus;
    ticket_id: string | null;
    created_at: string;
    updated_at: string;
    // v4.0 fields
    source_agent?: string | null;
    source_ticket_id?: string | null;
    navigate_to?: string | null;
    is_ghost?: boolean;
    queue_priority?: number;           // 1=P1, 2=P2, 3=P3
    answered_at?: string | null;
    ai_continued?: boolean;
    dismiss_count?: number;
    previous_decision_id?: string | null;
    conflict_decision_id?: string | null;
    technical_context?: string | null;
    friendly_message?: string | null;
}

export interface PlanVersion {
    id: string;
    plan_id: string;
    version_number: number;
    label: string;
    snapshot: string;
    change_summary: string;
    created_by: string;
    branch_type: 'live' | 'features';
    is_active: boolean;
    change_count: number;
    merge_diff: string | null;
    created_at: string;
}

export interface DesignChangeLog {
    id: string;
    plan_id: string;
    branch_type: 'live' | 'features';
    change_type: 'add' | 'update' | 'delete';
    entity_type: 'page' | 'component' | 'token' | 'data_model';
    entity_id: string;
    description: string;
    session_change_number: number;
    created_at: string;
}

export interface PlanReviewResult {
    readiness_score: number;
    readiness_level: ReadinessLevel;
    summary: string;
    missing_details: Array<{ area: string; description: string; priority: string }>;
    questions_generated: number;
    suggestions_generated: number;
    tickets_created: number;
}

export interface DataModelField {
    name: string;
    type: string;
    required: boolean;
    visible: boolean;
    description: string;
    default_value?: unknown;
    validation?: string;
    display_hint?: string;
    enum_values?: string[];
    ref_model_id?: string;
    formula?: string;
}

export interface DataModelRelationship {
    target_model_id: string;
    type: 'one_to_one' | 'one_to_many' | 'many_to_many';
    field_name: string;
    description: string;
    cascade_delete: boolean;
    display_as: 'inline' | 'link' | 'expandable' | 'count_badge';
}

export interface DataModel {
    id: string;
    plan_id: string;
    name: string;
    description: string;
    fields: DataModelField[];
    relationships: DataModelRelationship[];
    bound_components: string[];
    ai_backend_suggestion: string | null;
    created_at: string;
    updated_at: string;
}

// --- AI Chat Types (v3.0) ---

export interface AIChatSession {
    id: string;
    plan_id: string | null;
    ticket_id: string | null;
    session_name: string;
    status: 'active' | 'archived';
    created_at: string;
    updated_at: string;
}

export interface AIChatMessage {
    id: string;
    session_id: string;
    ticket_reply_id: string | null;
    role: 'user' | 'ai' | 'system';
    content: string;
    context_page: string;
    context_element_id: string | null;
    context_element_type: string | null;
    ai_level: string;
    created_at: string;
}

// --- Design QA Types (v4.0) ---

/** Result of Design Architect review */
export interface DesignGapAnalysis {
    plan_id: string;
    analysis_timestamp: string;
    overall_score: number;
    gaps: DesignGap[];
    summary: string;
    pages_analyzed: number;
    components_analyzed: number;
}

/** A single design gap found by Gap Hunter */
export interface DesignGap {
    id: string;
    category: 'missing_component' | 'missing_nav' | 'missing_page' | 'missing_state' | 'incomplete_flow' | 'accessibility' | 'responsive' | 'user_story_gap' | 'data_binding';
    severity: 'critical' | 'major' | 'minor';
    page_id?: string;
    page_name?: string;
    component_id?: string;
    title: string;
    description: string;
    related_requirement?: string;
    suggested_fix: DesignGapFix;
}

/** A suggested fix for a design gap — ready for the Hardener */
export interface DesignGapFix {
    action: 'add_component' | 'add_page' | 'modify_component' | 'add_navigation' | 'flag_review';
    target_page_id?: string;
    component_type?: string;
    component_name?: string;
    properties?: Record<string, unknown>;
    position?: { x: number; y: number; width: number; height: number };
}

/** Result of Design Hardener processing */
export interface DesignHardeningResult {
    plan_id: string;
    gaps_addressed: number;
    drafts_created: number;
    pages_created: number;
    actions_taken: Array<{ gap_id: string; action: string; result: string }>;
}

// --- User Decision Memory Types (v4.0) ---

/** A user decision tracked by the Decision Memory Agent */
export interface UserDecision {
    id: string;
    plan_id: string;
    category: string;
    topic: string;
    decision: string;
    question_id: string | null;
    ticket_id: string | null;
    superseded_by: string | null;
    is_active: boolean;
    context: string | null;
    affected_entities: string | null;
    created_at: string;
    updated_at: string;
}

/** Result of a decision memory lookup */
export interface DecisionLookupResult {
    found: boolean;
    decision: string;
    confidence: number;
    questionId: string;
    category: string;
    decidedAt: string;
}

/** Result of a decision match check before creating a question */
export interface DecisionMatchResult {
    exactMatch: boolean;
    similarMatch: boolean;
    potentialConflict: boolean;
    decision?: UserDecision;
    conflictingDecision?: UserDecision;
}

// --- Phase Gate Types (v4.0) ---

/** Result of checking if a phase gate's criteria are met */
export interface PhaseGateResult {
    passed: boolean;
    blockers: string[];
    progress: { done: number; total: number };
}

/** Ticket verification result stored as JSON */
export interface TicketVerificationResult {
    clarity_score: number;
    deliverable_check: boolean;
    passed: boolean;
    attempt_number: number;
    failure_details?: string;
}

// --- Per-Ticket Run Logging Types (v4.1) ---

/** Status of a single ticket processing run */
export type TicketRunStatus = 'started' | 'completed' | 'failed' | 'review_passed' | 'review_flagged';

/** A single processing run for a ticket — each retry gets its own run log */
export interface TicketRun {
    id: string;
    ticket_id: string;
    run_number: number;
    agent_name: string;
    status: TicketRunStatus;
    /** The prompt/message sent to the agent */
    prompt_sent: string;
    /** The agent's response content */
    response_received: string | null;
    /** JSON of review agent scores/decision (if review gate ran) */
    review_result: string | null;
    /** JSON of verification result (clarity + deliverable check) */
    verification_result: string | null;
    /** Error message if the run failed */
    error_message: string | null;
    /** Error stack trace (truncated to 2000 chars) */
    error_stack: string | null;
    /** Tokens consumed by LLM during this run */
    tokens_used: number | null;
    /** Total processing time for this run in milliseconds */
    duration_ms: number;
    started_at: string;
    completed_at: string | null;
}

// --- Enhanced Component Property Types (v4.1) ---

/** Structured UX notes with templates and free-text */
export interface UXNotes {
    templates: {
        /** "As a user, I expect..." */
        user_expectation: string;
        /** "When an error occurs, the user sees..." */
        error_state: string;
        /** "While loading, the user sees..." */
        loading_state: string;
        /** "When there is no data, the user sees..." */
        empty_state: string;
    };
    /** Additional free-form UX notes */
    freeform: string;
}

/** Structured DX notes with templates and free-text */
export interface DXNotes {
    templates: {
        /** "Implement using..." */
        implementation: string;
        /** "Required libraries/APIs..." */
        dependencies: string;
        /** Estimated implementation complexity */
        complexity: 'low' | 'medium' | 'high';
        /** "API endpoints needed..." */
        api_endpoints: string;
    };
    /** Additional free-form developer notes */
    freeform: string;
}

/** Page-level UX notes with templates */
export interface PageUXNotes {
    templates: {
        /** "The user journey through this page..." */
        user_journey: string;
        /** "Users arrive here from..." */
        entry_points: string;
        /** "Users leave this page to..." */
        exit_points: string;
        /** "When errors occur on this page..." */
        error_handling: string;
    };
    freeform: string;
}

/** Page-level DX notes with templates */
export interface PageDXNotes {
    templates: {
        /** "Implement this page using..." */
        implementation: string;
        /** "This page depends on..." */
        dependencies: string;
        complexity: 'low' | 'medium' | 'high';
        /** "Testing approach for this page..." */
        testing_notes: string;
    };
    freeform: string;
}

/** Component interaction specification */
export interface ComponentInteraction {
    /** Event type: click, hover, submit, change, focus, blur, etc. */
    event: string;
    /** What happens: navigate, api_call, toggle, validate, etc. */
    action: string;
    /** Target page/component/endpoint */
    target?: string;
    /** Human-readable description of the interaction */
    description?: string;
}

/** Component data binding specification */
export interface ComponentDataBinding {
    /** Field name in the data source */
    field: string;
    /** Data source name or endpoint */
    source: string;
    /** Data type: string, number, boolean, array, object */
    type: string;
}

/** Component accessibility properties */
export interface ComponentAccessibility {
    aria_label?: string;
    aria_role?: string;
    tab_index?: number;
    /** Text read by screen readers in addition to visible content */
    screen_reader_text?: string;
}

/** Component validation rule for form elements */
export interface ComponentValidationRule {
    /** Rule type: required, min_length, max_length, pattern, custom */
    rule: string;
    /** Error message shown when validation fails */
    message: string;
}

/** Component visual state variant */
export interface ComponentState {
    /** State name: default, hover, active, disabled, loading, error, empty, focused */
    name: string;
    /** Style overrides for this state */
    styles: Partial<ComponentStyles>;
    /** When this state is active: "on hover", "when loading", "if disabled", etc. */
    conditions: string;
}

/** Enhanced component properties — stored in DesignComponent.props JSON */
export interface EnhancedComponentProps {
    ux_notes?: UXNotes;
    dx_notes?: DXNotes;
    interactions?: ComponentInteraction[];
    data_bindings?: ComponentDataBinding[];
    accessibility?: ComponentAccessibility;
    validation_rules?: ComponentValidationRule[];
    states?: ComponentState[];
    [key: string]: unknown;
}

/** Enhanced page metadata — stored in DesignPage meta JSON column */
export interface EnhancedPageMeta {
    ux_notes?: PageUXNotes;
    dx_notes?: PageDXNotes;
    auth_required?: boolean;
    data_sources?: Array<{ name: string; endpoint: string; type: string }>;
    seo?: { title: string; description: string };
    loading_strategy?: 'eager' | 'lazy' | 'ssr';
    [key: string]: unknown;
}

// ============================================================
// v8.0: Back-End Designer Types
// ============================================================

// --- Backend Element Types ---

export type BackendElementType =
    | 'api_route'
    | 'db_table'
    | 'service'
    | 'controller'
    | 'middleware'
    | 'auth_layer'
    | 'background_job'
    | 'cache_strategy'
    | 'queue_definition';

export type BackendElementLayer =
    | 'routes'
    | 'models'
    | 'services'
    | 'middleware'
    | 'auth'
    | 'jobs'
    | 'caching'
    | 'queues';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

export type AuthType = 'none' | 'jwt' | 'api_key' | 'oauth2' | 'session' | 'custom';

/** A back-end architecture element displayed as a card on the BE designer canvas */
export interface BackendElement {
    id: string;
    plan_id: string;
    type: BackendElementType;
    name: string;
    /** Domain/feature group: 'auth', 'users', 'products', etc. */
    domain: string;
    /** Layer classification for layer-view grouping */
    layer: BackendElementLayer;
    /** Full detail JSON — schema varies by element type (ApiRouteConfig, DbTableConfig, etc.) */
    config_json: string;
    /** Visual position on BE canvas */
    x: number;
    y: number;
    width: number;
    height: number;
    /** Whether collapsed on canvas (card summary vs expanded detail) */
    is_collapsed: boolean;
    /** Draft flag — same pattern as FE is_draft, pending user approval */
    is_draft: boolean;
    /** Sort order within its layer/domain */
    sort_order: number;
    created_at: string;
    updated_at: string;
}

/** API Route config — stored in BackendElement.config_json when type = 'api_route' */
export interface ApiRouteConfig {
    path: string;
    method: HttpMethod;
    description: string;
    auth: AuthType;
    request_body?: Record<string, unknown>;
    response_body?: Record<string, unknown>;
    query_params?: Array<{ name: string; type: string; required: boolean; description?: string }>;
    path_params?: Array<{ name: string; type: string; description?: string }>;
    /** References to middleware BackendElement IDs */
    middleware_ids: string[];
    rate_limit?: string;
    cache_ttl?: number;
    /** HTTP status codes this route can return */
    status_codes?: Array<{ code: number; description: string }>;
}

/** Database Table config — stored in BackendElement.config_json when type = 'db_table' */
export interface DbTableConfig {
    table_name: string;
    columns: Array<{
        name: string;
        type: string;           // 'TEXT' | 'INTEGER' | 'REAL' | 'BLOB' | 'BOOLEAN' | 'TIMESTAMP' | etc.
        primary_key: boolean;
        nullable: boolean;
        unique: boolean;
        default_value?: string;
        foreign_key?: { table: string; column: string; on_delete?: string; on_update?: string };
        description?: string;
    }>;
    indexes: Array<{ name: string; columns: string[]; unique: boolean }>;
    /** Links to DataModel.id for shared core data model system */
    data_model_id?: string;
    /** Table-level constraints */
    constraints?: string[];
}

/** Service/Controller config — stored in BackendElement.config_json when type = 'service' | 'controller' */
export interface ServiceConfig {
    description: string;
    methods: Array<{
        name: string;
        params: Array<{ name: string; type: string; required?: boolean }>;
        return_type: string;
        description: string;
        is_async?: boolean;
    }>;
    /** Service IDs or names this service depends on */
    dependencies: string[];
    is_singleton: boolean;
}

/** Middleware config — stored in BackendElement.config_json when type = 'middleware' */
export interface MiddlewareConfig {
    description: string;
    /** Scope: global (all routes), route (specific routes), group (route groups) */
    applies_to: 'global' | 'route' | 'group';
    /** Execution order (lower = earlier) */
    order: number;
    /** Middleware-specific configuration parameters */
    config_params: Record<string, unknown>;
}

/** Auth Layer config — stored in BackendElement.config_json when type = 'auth_layer' */
export interface AuthLayerConfig {
    auth_type: AuthType;
    provider: string;
    token_expiry?: string;
    refresh_enabled: boolean;
    scopes: string[];
    /** Route element IDs protected by this auth layer */
    protected_routes: string[];
}

/** Background Job config — stored in BackendElement.config_json when type = 'background_job' */
export interface BackgroundJobConfig {
    /** Cron expression or 'on_demand' */
    schedule: string;
    description: string;
    max_retries: number;
    timeout_seconds: number;
    /** Service IDs this job depends on */
    dependencies: string[];
}

/** Cache Strategy config — stored in BackendElement.config_json when type = 'cache_strategy' */
export interface CacheStrategyConfig {
    backend: 'memory' | 'redis' | 'memcached' | 'custom';
    default_ttl_seconds: number;
    max_size_mb: number;
    eviction_policy: 'lru' | 'lfu' | 'ttl';
    /** Route element IDs using this cache strategy */
    cached_routes: string[];
}

/** Queue Definition config — stored in BackendElement.config_json when type = 'queue_definition' */
export interface QueueDefinitionConfig {
    backend: 'memory' | 'redis' | 'rabbitmq' | 'sqs' | 'custom';
    max_concurrency: number;
    retry_policy: { max_retries: number; backoff: 'linear' | 'exponential' };
    dead_letter_queue: boolean;
    /** Types of jobs this queue can process */
    job_types: string[];
}

// --- v8.0: Element Link Types ---

export type LinkType = 'fe_to_fe' | 'be_to_be' | 'fe_to_be' | 'be_to_fe';
export type LinkGranularity = 'high' | 'component';
export type LinkSource = 'manual' | 'auto_detected' | 'ai_suggested';

/** A connection between two design elements (FE↔FE, BE↔BE, FE→BE, BE→FE) */
export interface ElementLink {
    id: string;
    plan_id: string;
    link_type: LinkType;
    granularity: LinkGranularity;
    source: LinkSource;
    /** Source element reference */
    from_element_type: 'page' | 'component' | 'backend_element' | 'data_model';
    from_element_id: string;
    /** Target element reference */
    to_element_type: 'page' | 'component' | 'backend_element' | 'data_model';
    to_element_id: string;
    /** Human-readable label for the connection */
    label: string;
    /** Additional metadata (trigger, data flow direction, etc.) */
    metadata_json: string;
    /** If AI-suggested, confidence score 0-100 */
    confidence: number | null;
    /** If AI-suggested, whether the user has approved this link */
    is_approved: boolean;
    created_at: string;
    updated_at: string;
}

/** Relationship matrix data for the Link Matrix UI */
export interface LinkMatrix {
    rows: Array<{ id: string; name: string; type: string; element_type: string }>;
    cols: Array<{ id: string; name: string; type: string; element_type: string }>;
    cells: Array<{ row: number; col: number; link_type: LinkType; link_id: string; label: string }>;
}

/** Tree node for the Link Tree navigation UI */
export interface LinkTreeNode {
    id: string;
    name: string;
    type: string;
    element_type: string;
    children: LinkTreeNode[];
    links: ElementLink[];
}

// --- v8.0: Tag System Types ---

export type TagColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray' | 'custom';

/** A tag definition — pre-defined (builtin) or user-created */
export interface TagDefinition {
    id: string;
    plan_id: string | null;  // null = global
    name: string;
    color: TagColor;
    /** Custom hex color (only used when color = 'custom') */
    custom_color: string | null;
    /** Is this a built-in tag? Built-in tags cannot be deleted. */
    is_builtin: boolean;
    /** Description of what this tag means */
    description: string;
    created_at: string;
}

/** An assignment of a tag to an element (junction table) */
export interface ElementTag {
    id: string;
    tag_id: string;
    /** What type of element is tagged */
    element_type: 'component' | 'page' | 'backend_element' | 'data_model' | 'document';
    element_id: string;
    created_at: string;
}

/** Pre-defined built-in tags seeded on initialization */
export const BUILTIN_TAGS: ReadonlyArray<{ name: string; color: TagColor; description: string }> = [
    { name: 'setting', color: 'blue', description: 'User-configurable setting or preference' },
    { name: 'automatic', color: 'purple', description: 'Auto-managed by the system — no user config needed' },
    { name: 'hardcoded', color: 'red', description: 'Contains hardcoded values that may need extraction' },
    { name: 'env-variable', color: 'yellow', description: 'Uses environment variables for configuration' },
    { name: 'feature-flag', color: 'orange', description: 'Behind a feature flag — can be toggled on/off' },
] as const;

// --- v8.0: Unified Review Queue Types ---

export type ReviewItemType = 'fe_draft' | 'be_draft' | 'link_suggestion' | 'tag_suggestion';
export type ReviewItemStatus = 'pending' | 'approved' | 'rejected';

/** A review queue item — pending draft, suggestion, or change requiring user approval */
export interface ReviewQueueItem {
    id: string;
    plan_id: string;
    item_type: ReviewItemType;
    /** Reference to the actual element (component ID, BE element ID, link ID) */
    element_id: string;
    element_type: string;
    /** Display title for the review item */
    title: string;
    /** Description of what this review item proposes */
    description: string;
    /** Which agent or source created this item */
    source_agent: string;
    /** Current review status */
    status: ReviewItemStatus;
    /** Priority for ordering */
    priority: TicketPriority;
    /** When the item was reviewed */
    reviewed_at: string | null;
    /** Notes from the reviewer */
    review_notes: string | null;
    created_at: string;
    updated_at: string;
}

// --- v8.0: Backend Architect QA Scores ---

/** Backend QA scoring result from the Backend Architect agent */
export interface BackendQAScore {
    plan_id: string;
    overall_score: number;  // 0-100
    category_scores: {
        api_restfulness: number;      // 0-15
        db_normalization: number;     // 0-15
        service_separation: number;   // 0-15
        auth_security: number;        // 0-15
        error_handling: number;       // 0-10
        caching_strategy: number;     // 0-10
        scalability: number;          // 0-10
        documentation: number;        // 0-10
    };
    findings: Array<{
        category: string;
        severity: 'critical' | 'major' | 'minor';
        element_id?: string;
        element_name?: string;
        title: string;
        description: string;
        recommendation: string;
    }>;
    assessment: string;
    recommendations: string[];
    timestamp: string;
}

/** Backend Architect operating mode */
export type BackendArchitectMode = 'auto_generate' | 'scaffold' | 'suggest';

// ============================================================
// v9.0: Agent Hierarchy, Workflow Designer, User Communication
// ============================================================

// --- v9.0 Enums ---

/** 10-level agent hierarchy — from Boss (L0) through niche Checkers (L9) */
export enum AgentLevel {
    L0_Boss = 0,
    L1_GlobalOrchestrator = 1,
    L2_DomainOrchestrator = 2,
    L3_AreaOrchestrator = 3,
    L4_Manager = 4,
    L5_SubManager = 5,
    L6_TeamLead = 6,
    L7_WorkerGroup = 7,
    L8_Worker = 8,
    L9_Checker = 9
}

/** Permissions that can be granted to agents in the hierarchy */
export enum AgentPermission {
    Read = 'read',
    Write = 'write',
    Execute = 'execute',
    Escalate = 'escalate',
    Spawn = 'spawn',
    Configure = 'configure',
    Approve = 'approve',
    Delete = 'delete'
}

/** Model capabilities for multi-model routing */
export enum ModelCapability {
    Reasoning = 'reasoning',
    Vision = 'vision',
    Fast = 'fast',
    ToolUse = 'tool_use',
    Code = 'code',
    General = 'general'
}

/** Step types for workflow definitions */
export enum WorkflowStepType {
    AgentCall = 'agent_call',
    Condition = 'condition',
    ParallelBranch = 'parallel_branch',
    UserApproval = 'user_approval',
    Escalation = 'escalation',
    ToolUnlock = 'tool_unlock',
    Wait = 'wait',
    Loop = 'loop',
    SubWorkflow = 'sub_workflow'
}

/** Workflow definition lifecycle status */
export enum WorkflowStatus {
    Draft = 'draft',
    Active = 'active',
    Running = 'running',
    Paused = 'paused',
    Completed = 'completed',
    Failed = 'failed',
    Archived = 'archived'
}

/** Runtime execution status for workflow steps and executions */
export enum WorkflowExecutionStatus {
    Pending = 'pending',
    Running = 'running',
    WaitingApproval = 'waiting_approval',
    WaitingCondition = 'waiting_condition',
    Completed = 'completed',
    Failed = 'failed',
    Skipped = 'skipped',
    Cancelled = 'cancelled'
}

/** User programming proficiency level — affects how UserCommAgent communicates */
export enum UserProgrammingLevel {
    Noob = 'noob',
    New = 'new',
    GettingAround = 'getting_around',
    Good = 'good',
    ReallyGood = 'really_good',
    Expert = 'expert'
}

/** Per-area preference action — how the system should handle decisions in an area */
export enum UserPreferenceAction {
    AlwaysDecide = 'always_decide',
    AlwaysRecommend = 'always_recommend',
    NeverTouch = 'never_touch',
    AskMe = 'ask_me'
}

/** Status of a question escalation chain as it bubbles up the agent tree */
export enum EscalationChainStatus {
    Escalating = 'escalating',
    Answered = 'answered',
    Blocked = 'blocked',
    Paused = 'paused',
    TimedOut = 'timed_out'
}

/** Tree node runtime status */
export enum TreeNodeStatus {
    Idle = 'idle',
    Active = 'active',
    Working = 'working',
    WaitingChild = 'waiting_child',
    Escalated = 'escalated',
    Completed = 'completed',
    Failed = 'failed',
    Pruned = 'pruned'
}

/** MCP confirmation status */
export enum MCPConfirmationStatus {
    Pending = 'pending',
    Approved = 'approved',
    Rejected = 'rejected',
    Expired = 'expired'
}

// --- v9.0 Interfaces ---

/** A node in the 10-level agent hierarchy tree */
export interface AgentTreeNode {
    id: string;
    /** Unique instance ID for this specific tree instantiation */
    instance_id: string;
    /** The agent type this node represents */
    agent_type: string;
    /** Display name (e.g., "ComponentManager", "ButtonLead") */
    name: string;
    /** Hierarchy level (0-9) */
    level: AgentLevel;
    /** Parent node ID (null for L0 Boss) */
    parent_id: string | null;
    /** Task/plan this tree is processing */
    task_id: string | null;
    /** Workflow execution this node belongs to (if any) */
    workflow_execution_id: string | null;
    /** Scope keywords for context slicing (e.g., "frontend", "react", "buttons") */
    scope: string;
    /** Permissions granted to this node */
    permissions: AgentPermission[];
    /** Model preference for this node */
    model_preference: ModelPreference | null;
    /** Max children this node can spawn */
    max_fanout: number;
    /** Max depth below this node */
    max_depth_below: number;
    /** Number of escalations before auto-escalating to parent */
    escalation_threshold: number;
    /** ID of the node to escalate to (usually parent, but can be configured) */
    escalation_target_id: string | null;
    /** Whether context is isolated to this node's scope */
    context_isolation: boolean;
    /** Whether conversation history is isolated per-node */
    history_isolation: boolean;
    /** Current runtime status */
    status: TreeNodeStatus;
    /** Number of retries this node has attempted */
    retries: number;
    /** Number of escalations this node has triggered */
    escalations: number;
    /** Total tokens consumed by this node */
    tokens_consumed: number;
    /** JSON schema of expected input */
    input_contract: string | null;
    /** JSON schema of expected output */
    output_contract: string | null;
    /** Niche agent definition ID (for L4-L9 niche agents) */
    niche_definition_id: string | null;
    created_at: string;
    updated_at: string;
}

/** Predefined tree structure template */
export interface AgentTreeTemplate {
    id: string;
    name: string;
    description: string;
    /** JSON array of template node definitions (no instance IDs — those are generated on spawn) */
    nodes_json: string;
    /** Whether this is the default template for new plans */
    is_default: boolean;
    created_at: string;
    updated_at: string;
}

/** Per-agent model configuration */
export interface ModelPreference {
    model_id: string;
    capability: ModelCapability;
    fallback_model_id: string | null;
    temperature: number;
    max_output_tokens: number;
}

/** Workflow definition — a template for multi-step processes */
export interface WorkflowDefinition {
    id: string;
    /** Plan ID (null = global reusable template) */
    plan_id: string | null;
    name: string;
    description: string;
    /** Mermaid source for visual rendering */
    mermaid_source: string;
    status: WorkflowStatus;
    /** Who created this workflow */
    created_by: string;
    /** Version number for tracking changes */
    version: number;
    /** Acceptance criteria for the workflow as a whole */
    acceptance_criteria: string;
    /** Tags for categorization */
    tags: string[];
    /** Whether this is a reusable template */
    is_template: boolean;
    created_at: string;
    updated_at: string;
}

/** A step within a workflow definition */
export interface WorkflowStep {
    id: string;
    workflow_id: string;
    step_type: WorkflowStepType;
    /** Display label in the visual editor */
    label: string;
    /** Agent type to invoke (for agent_call steps) */
    agent_type: string | null;
    /** Prompt to send to the agent */
    agent_prompt: string | null;
    /** Condition expression (for condition steps) — evaluated via safe AST parser */
    condition_expression: string | null;
    /** Tools to unlock at this step (for tool_unlock steps) */
    tools_unlocked: string[];
    /** Acceptance criteria for this specific step */
    acceptance_criteria: string | null;
    /** Max retries before escalation */
    max_retries: number;
    /** Delay between retries in ms */
    retry_delay_ms: number;
    /** Step ID to escalate to on failure */
    escalation_step_id: string | null;
    /** Next step ID (for linear flow) */
    next_step_id: string | null;
    /** Step ID for true branch (for condition steps) */
    true_branch_step_id: string | null;
    /** Step ID for false branch (for condition steps) */
    false_branch_step_id: string | null;
    /** Step IDs for parallel execution */
    parallel_step_ids: string[];
    /** Model preference for this step's agent call */
    model_preference: ModelPreference | null;
    /** Visual x position in workflow designer */
    x: number;
    /** Visual y position in workflow designer */
    y: number;
    /** Sort order for execution sequence */
    sort_order: number;
    created_at: string;
    updated_at: string;
}

/** Runtime execution state for a workflow */
export interface WorkflowExecution {
    id: string;
    workflow_id: string;
    /** Ticket being processed through this workflow (if any) */
    ticket_id: string | null;
    /** Task being processed (if any) */
    task_id: string | null;
    /** Current step being executed */
    current_step_id: string | null;
    status: WorkflowExecutionStatus;
    /** JSON map of step ID -> WorkflowStepResult */
    step_results_json: string;
    /** JSON map of workflow variables ($result, $score, etc.) */
    variables_json: string;
    /** Total tokens consumed */
    tokens_consumed: number;
    started_at: string;
    completed_at: string | null;
}

/** Result of executing a single workflow step */
export interface WorkflowStepResult {
    step_id: string;
    status: WorkflowExecutionStatus;
    /** Agent response content */
    agent_response: string | null;
    /** Whether acceptance criteria were met */
    acceptance_check: boolean | null;
    /** Number of retries consumed */
    retries: number;
    /** Duration in milliseconds */
    duration_ms: number;
    /** Tokens consumed for this step */
    tokens_used: number;
    /** Error message (if failed) */
    error: string | null;
}

/** Permission configuration for an agent */
export interface AgentPermissionSet {
    id: string;
    /** Agent type this permission set applies to */
    agent_type: string;
    /** Specific instance ID (null = applies to all instances of this type) */
    agent_instance_id: string | null;
    /** Granted permissions */
    permissions: AgentPermission[];
    /** Tools this agent is allowed to use */
    allowed_tools: string[];
    /** Tools this agent is explicitly blocked from using */
    blocked_tools: string[];
    /** Whether this agent can spawn child agents */
    can_spawn: boolean;
    /** Maximum LLM calls per processing cycle */
    max_llm_calls: number;
    /** Maximum time in minutes before timeout */
    max_time_minutes: number;
    created_at: string;
    updated_at: string;
}

/** User profile — programming level, preferences, communication style */
export interface UserProfile {
    id: string;
    /** User's programming proficiency level */
    programming_level: UserProgrammingLevel;
    /** Areas the user is strong in */
    strengths: string[];
    /** Areas the user is weak in */
    weaknesses: string[];
    /** Technical areas the user knows well */
    known_areas: string[];
    /** Technical areas the user is unfamiliar with */
    unknown_areas: string[];
    /** Per-area action preferences */
    area_preferences: Record<string, UserPreferenceAction>;
    /** Cached repeat answers for common questions */
    repeat_answers: Record<string, string>;
    /** Communication style preference */
    communication_style: 'technical' | 'simple' | 'balanced';
    /** Free-form notes about user preferences */
    notes: string;
    created_at: string;
    updated_at: string;
}

/** Per-level conversation in the agent tree (isolated per node) */
export interface AgentConversation {
    id: string;
    /** Which tree node this conversation belongs to */
    tree_node_id: string;
    /** Level in the hierarchy */
    level: AgentLevel;
    /** Parent conversation ID (for threading) */
    parent_conversation_id: string | null;
    /** Message role */
    role: ConversationRole;
    /** Message content */
    content: string;
    /** Tokens consumed */
    tokens_used: number;
    /** Link to escalation chain question (if this message is part of a chain) */
    question_id: string | null;
    created_at: string;
}

/** Tracks a question as it escalates up the agent tree */
export interface EscalationChain {
    id: string;
    /** Root node of the tree this chain belongs to */
    tree_root_id: string;
    /** Node that originated the question (usually an L8 worker) */
    originating_node_id: string;
    /** Node currently processing the question */
    current_node_id: string;
    /** The original question */
    question: string;
    /** Current status of the escalation */
    status: EscalationChainStatus;
    /** The answer (once resolved) */
    answer: string | null;
    /** JSON array of node IDs this question has visited */
    levels_traversed: string;
    /** Level at which the question was finally answered (null if unresolved) */
    resolved_at_level: AgentLevel | null;
    /** If the question caused a new ticket, the ticket ID */
    ticket_id: string | null;
    /** Additional context for the question */
    context: string | null;
    created_at: string;
    resolved_at: string | null;
}

/** Agent-to-model mapping for multi-model routing */
export interface ModelAssignment {
    id: string;
    /** Agent type or specific niche agent name */
    agent_type: string;
    /** Which capability this assignment is for */
    capability: ModelCapability;
    /** The model ID to use */
    model_id: string;
    /** Whether this is the default for this agent type */
    is_default: boolean;
    /** Priority for selection (lower = higher priority) */
    priority: number;
    created_at: string;
    updated_at: string;
}

/** MCP confirmation stage — before calling agents externally */
export interface MCPConfirmation {
    id: string;
    /** The MCP tool being called */
    tool_name: string;
    /** Agent name being invoked */
    agent_name: string;
    /** Human-readable description of what will happen */
    description: string;
    /** Preview of arguments being passed */
    arguments_preview: string;
    /** Current status */
    status: MCPConfirmationStatus;
    /** When this confirmation expires */
    expires_at: string;
    /** User's response (if any) */
    user_response: string | null;
    created_at: string;
    updated_at: string;
}

/** Agent description for MCP tool display */
export interface AgentDescription {
    agent_type: string;
    name: string;
    description: string;
    capabilities: string[];
    accepts_input: string;
    produces_output: string;
}

/** Safe expression AST node — uses recursive descent parser, never arbitrary code execution */
export interface ConditionNode {
    type: 'comparison' | 'logical' | 'string_op' | 'literal' | 'variable' | 'not';
    /** For comparison: '>', '<', '>=', '<=', '==', '!=' */
    operator?: string;
    /** For logical: '&&', '||' */
    logical_op?: string;
    /** For string_op: 'contains', 'startsWith', 'endsWith' */
    string_op?: string;
    /** For literal: the actual value */
    value?: string | number | boolean;
    /** For variable: the variable name (e.g., '$result', '$score') */
    variable?: string;
    /** For comparison/logical: left operand */
    left?: ConditionNode;
    /** For comparison/logical: right operand */
    right?: ConditionNode;
    /** For not: inner expression */
    operand?: ConditionNode;
}

/** Niche agent definition — template for L4-L9 leaf agents (~230 total) */
export interface NicheAgentDefinition {
    id: string;
    /** Display name (e.g., "InputFieldWorker", "RouteChecker") */
    name: string;
    /** Hierarchy level this agent operates at */
    level: AgentLevel;
    /** Domain specialty (e.g., "frontend.components.input", "backend.routes.crud") */
    specialty: string;
    /** Domain group (e.g., "code", "design", "data", "docs") */
    domain: string;
    /** Area within domain (e.g., "frontend", "backend", "testing", "infra") */
    area: string;
    /** System prompt template — {{scope}}, {{parentContext}} replaced at spawn time */
    system_prompt_template: string;
    /** Parent level this agent reports to */
    parent_level: AgentLevel;
    /** Required model capability for this agent */
    required_capability: ModelCapability;
    /** Default model capability to use if no specific assignment */
    default_model_capability: ModelCapability;
    /** JSON schema of expected input */
    input_contract: string | null;
    /** JSON schema of expected output */
    output_contract: string | null;
    created_at: string;
    updated_at: string;
}

/** Model info as detected from LM Studio /v1/models endpoint */
export interface DetectedModelInfo {
    id: string;
    name: string;
    capabilities: ModelCapability[];
    context_window: number;
    max_output_tokens: number;
    is_loaded: boolean;
}

/** Question box options presented to user via UserCommAgent */
export interface UserQuestionBox {
    id: string;
    /** Question title — rewritten for user's programming level */
    title: string;
    /** Context explanation — why this question matters */
    context: string;
    /** A/B/C options with pros/cons */
    options: UserQuestionOption[];
    /** Index of the recommended option */
    recommended_index: number;
    /** Whether to show "Other" free text input */
    show_other: boolean;
    /** Whether to show "I Don't Know" button */
    show_idk: boolean;
    /** Whether to show "Don't Care / You Decide" button */
    show_dont_care: boolean;
    /** The escalation chain ID this question belongs to */
    escalation_chain_id: string | null;
    /** The ticket ID this question is about */
    ticket_id: string | null;
    /** Technical area classification */
    technical_area: string;
    /** Question type classification */
    question_type: 'preference' | 'technical' | 'design' | 'architecture' | 'config';
    created_at: string;
}

/** A single option in a UserQuestionBox */
export interface UserQuestionOption {
    label: string;
    description: string;
    pros: string[];
    cons: string[];
}

/** Profile suggestion from UserCommAgent — auto-detect patterns in user behavior */
export interface ProfileSuggestion {
    id: string;
    suggestion_type: 'add_known_area' | 'add_strength' | 'update_level' | 'add_preference';
    area: string;
    reason: string;
    /** Evidence (e.g., "You've answered 5 auth questions confidently") */
    evidence: string;
    /** Whether the user has responded */
    status: 'pending' | 'accepted' | 'dismissed';
    created_at: string;
}
