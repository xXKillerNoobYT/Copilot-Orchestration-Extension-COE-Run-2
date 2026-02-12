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
    Resolved = 'resolved',
    Escalated = 'escalated',
    Blocked = 'blocked'
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
    Custom = 'custom'
}

export enum AgentStatus {
    Idle = 'idle',
    Working = 'working',
    Error = 'error',
    Disabled = 'disabled'
}

export enum PlanStatus {
    Draft = 'draft',
    Active = 'active',
    Completed = 'completed',
    Archived = 'archived'
}

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
    created_at: string;
    updated_at: string;
}

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
    maxTokens: number;
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
    type: 'create_task' | 'create_ticket' | 'update_task' | 'escalate' | 'log';
    payload: Record<string, unknown>;
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
    // Responsive overrides
    responsive: {
        tablet?: Partial<ComponentStyles & { x: number; y: number; width: number; height: number; visible: boolean }>;
        mobile?: Partial<ComponentStyles & { x: number; y: number; width: number; height: number; visible: boolean }>;
    };
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

export interface DesignPage {
    id: string;
    plan_id: string;
    name: string;
    route: string;
    sort_order: number;
    width: number;
    height: number;
    background: string;
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
    created_at: string;
    updated_at: string;
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
