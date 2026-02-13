/**
 * CustomAgentBuilder - Per True Plan 03-Agent-Teams-and-Roles.md
 */

export interface CustomAgentConfig {
    id: string;
    name: string;
    description: string;
    version: string;
    author: string;
    systemPrompt: string;
    goals: Array<{
        id: string;
        description: string;
        priority: number;
        checklist: string[];
    }>;
    routingKeywords: string[];
    permissions: {
        readFiles: boolean;
        searchCode: boolean;
        createTickets: boolean;
        callLlm: boolean;
        writeFiles: false;
        executeCode: false;
    };
    safetyLimits: {
        maxGoalsPerRun: number;
        maxLlmCallsPerRun: number;
        maxTimePerGoalMs: number;
        maxTotalTimeMs: number;
        loopDetectionThreshold: number;
    };
    tags: string[];
    icon: string;
    createdAt: string;
    updatedAt: string;
}

export interface AgentExecutionState {
    agentId: string;
    status: "idle" | "running" | "paused" | "completed" | "halted" | "error";
    currentGoalIndex: number;
    goalResults: Array<{
        goalId: string;
        status: "pending" | "running" | "completed" | "skipped" | "timeout" | "error";
        result?: string;
        checklistResults: Array<{ item: string; passed: boolean }>;
        llmCallCount: number;
        durationMs: number;
        startedAt?: string;
        completedAt?: string;
    }>;
    totalLlmCalls: number;
    totalDurationMs: number;
    startedAt?: string;
    completedAt?: string;
    errors: string[];
    loopDetections: number;
    halted: boolean;
    haltReason?: string;
}

export interface AgentTemplate {
    id: string;
    name: string;
    description: string;
    category: "research" | "documentation" | "code-review" | "bug-analysis" | "qa" | "custom";
    config: Partial<CustomAgentConfig>;
    popularity: number;
}

export interface AgentValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}export class CustomAgentBuilder {
    private agents: Map<string, CustomAgentConfig> = new Map();
    private executions: Map<string, AgentExecutionState> = new Map();
    private templates: Map<string, AgentTemplate> = new Map();
    private idCounter = 0;
    constructor() { this.initializeTemplates(); }
    private nextId(prefix: string): string { return prefix + "-" + String(++this.idCounter); }    createAgent(config: Partial<CustomAgentConfig>): CustomAgentConfig {
        const id = config.id || this.nextId("agent");
        const agent: CustomAgentConfig = { id, name: config.name || "Untitled Agent",
            description: config.description || "", version: config.version || "1.0.0",
            author: config.author || "user",
            systemPrompt: config.systemPrompt || "You are a specialized AI agent.",
            goals: (config.goals || []).slice(0, 20).map((g, i) => ({
                id: g.id || this.nextId("goal"), description: g.description || "",
                priority: g.priority || i + 1, checklist: (g.checklist || []).slice(0, 50) })),
            routingKeywords: config.routingKeywords || [],
            permissions: { readFiles: config.permissions?.readFiles ?? true,
                searchCode: config.permissions?.searchCode ?? true,
                createTickets: config.permissions?.createTickets ?? true,
                callLlm: config.permissions?.callLlm ?? true,
                writeFiles: false, executeCode: false },
            safetyLimits: { maxGoalsPerRun: Math.min(config.safetyLimits?.maxGoalsPerRun ?? 20, 20),
                maxLlmCallsPerRun: Math.min(config.safetyLimits?.maxLlmCallsPerRun ?? 50, 50),
                maxTimePerGoalMs: Math.min(config.safetyLimits?.maxTimePerGoalMs ?? 300000, 300000),
                maxTotalTimeMs: Math.min(config.safetyLimits?.maxTotalTimeMs ?? 1800000, 1800000),
                loopDetectionThreshold: config.safetyLimits?.loopDetectionThreshold ?? 3 },
            tags: config.tags || [], icon: config.icon || "bot",
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        this.agents.set(id, agent); return agent; }
    getAgent(id: string): CustomAgentConfig | undefined { return this.agents.get(id); }
    getAllAgents(): CustomAgentConfig[] { return [...this.agents.values()]; }    updateAgent(id: string, updates: Partial<CustomAgentConfig>): CustomAgentConfig | null {
        const agent = this.agents.get(id); if (!agent) return null;
        if (updates.name !== undefined) agent.name = updates.name;
        if (updates.description !== undefined) agent.description = updates.description;
        if (updates.systemPrompt !== undefined) agent.systemPrompt = updates.systemPrompt;
        if (updates.goals !== undefined) agent.goals = updates.goals.slice(0, 20);
        if (updates.routingKeywords !== undefined) agent.routingKeywords = updates.routingKeywords;
        if (updates.tags !== undefined) agent.tags = updates.tags;
        if (updates.icon !== undefined) agent.icon = updates.icon;
        if (updates.permissions) { agent.permissions.readFiles = updates.permissions.readFiles ?? agent.permissions.readFiles;
            agent.permissions.searchCode = updates.permissions.searchCode ?? agent.permissions.searchCode;
            agent.permissions.createTickets = updates.permissions.createTickets ?? agent.permissions.createTickets;
            agent.permissions.callLlm = updates.permissions.callLlm ?? agent.permissions.callLlm;
            agent.permissions.writeFiles = false; agent.permissions.executeCode = false; }
        if (updates.safetyLimits) {
            agent.safetyLimits.maxGoalsPerRun = Math.min(updates.safetyLimits.maxGoalsPerRun ?? agent.safetyLimits.maxGoalsPerRun, 20);
            agent.safetyLimits.maxLlmCallsPerRun = Math.min(updates.safetyLimits.maxLlmCallsPerRun ?? agent.safetyLimits.maxLlmCallsPerRun, 50);
            agent.safetyLimits.maxTimePerGoalMs = Math.min(updates.safetyLimits.maxTimePerGoalMs ?? agent.safetyLimits.maxTimePerGoalMs, 300000);
            agent.safetyLimits.maxTotalTimeMs = Math.min(updates.safetyLimits.maxTotalTimeMs ?? agent.safetyLimits.maxTotalTimeMs, 1800000); }
        agent.updatedAt = new Date().toISOString(); return agent; }
    deleteAgent(id: string): boolean { return this.agents.delete(id); }    validateAgent(config: Partial<CustomAgentConfig>): AgentValidationResult {
        const errors: string[] = []; const warnings: string[] = [];
        if (!config.name || config.name.trim().length === 0) errors.push("Agent name is required");
        if (config.name && config.name.length > 100) errors.push("Agent name must be 100 characters or less");
        if (!config.systemPrompt || config.systemPrompt.trim().length < 10) errors.push("System prompt must be at least 10 characters");
        if (!config.goals || config.goals.length === 0) errors.push("At least one goal is required");
        if (config.goals && config.goals.length > 20) errors.push("Maximum 20 goals allowed");
        if (config.goals) { for (let i = 0; i < config.goals.length; i++) {
            if (!config.goals[i].description || config.goals[i].description.trim().length === 0) errors.push("Goal " + (i+1) + " description is required");
            if (config.goals[i].checklist && config.goals[i].checklist.length > 50) errors.push("Goal " + (i+1) + " checklist exceeds 50 items"); } }
        if (!config.routingKeywords || config.routingKeywords.length === 0) warnings.push("No routing keywords - agent will only be triggered manually");
        if (config.systemPrompt && config.systemPrompt.length > 5000) warnings.push("System prompt is very long (>5000 chars) - may use excessive tokens");
        if ((config.permissions as any)?.writeFiles === true) errors.push("writeFiles permission is hardlocked to false - cannot be enabled");
        if ((config.permissions as any)?.executeCode === true) errors.push("executeCode permission is hardlocked to false - cannot be enabled");
        return { valid: errors.length === 0, errors, warnings }; }    startExecution(agentId: string): AgentExecutionState | null {
        const agent = this.agents.get(agentId); if (!agent) return null;
        const sorted = [...agent.goals].sort((a, b) => a.priority - b.priority);
        const state: AgentExecutionState = { agentId, status: "running", currentGoalIndex: 0,
            goalResults: sorted.slice(0, agent.safetyLimits.maxGoalsPerRun).map(g => ({
                goalId: g.id, status: "pending" as const,
                checklistResults: g.checklist.map(item => ({ item, passed: false })),
                llmCallCount: 0, durationMs: 0 })),
            totalLlmCalls: 0, totalDurationMs: 0, startedAt: new Date().toISOString(),
            errors: [], loopDetections: 0, halted: false };
        this.executions.set(agentId, state); return state; }    processGoal(agentId: string, result: string, checklistPassed: boolean[], llmCalls: number, durationMs: number): AgentExecutionState | null {
        const state = this.executions.get(agentId); const agent = this.agents.get(agentId);
        if (!state || !agent || state.status !== "running") return null;
        const gr = state.goalResults[state.currentGoalIndex]; if (!gr) return null;
        gr.status = "completed"; gr.result = result; gr.llmCallCount = llmCalls; gr.durationMs = durationMs;
        gr.startedAt = new Date(Date.now() - durationMs).toISOString(); gr.completedAt = new Date().toISOString();
        for (let i = 0; i < gr.checklistResults.length && i < checklistPassed.length; i++) gr.checklistResults[i].passed = checklistPassed[i];
        state.totalLlmCalls += llmCalls; state.totalDurationMs += durationMs;        if (state.totalLlmCalls >= agent.safetyLimits.maxLlmCallsPerRun) { state.halted = true; state.haltReason = "LLM call budget exceeded"; state.status = "halted"; return state; }
        if (state.totalDurationMs >= agent.safetyLimits.maxTotalTimeMs) { state.halted = true; state.haltReason = "Total runtime exceeded"; state.status = "halted"; return state; }
        const cr = state.goalResults.filter(g => g.result).map(g => g.result!);
        if (cr.length >= agent.safetyLimits.loopDetectionThreshold) {
            const recent = cr.slice(-agent.safetyLimits.loopDetectionThreshold);
            if (recent.every(r => this.similarity(r, recent[0]) > 0.8)) {
                state.loopDetections++; if (state.loopDetections >= 1) {
                    state.halted = true; state.haltReason = "Loop detected: " + agent.safetyLimits.loopDetectionThreshold + " similar responses";
                    state.status = "halted"; return state; } } }
        state.currentGoalIndex++;
        if (state.currentGoalIndex >= state.goalResults.length) { state.status = "completed"; state.completedAt = new Date().toISOString(); }
        return state; }    getExecution(agentId: string): AgentExecutionState | undefined { return this.executions.get(agentId); }
    pauseExecution(agentId: string): boolean { const s = this.executions.get(agentId); if (!s || s.status !== "running") return false; s.status = "paused"; return true; }
    resumeExecution(agentId: string): boolean { const s = this.executions.get(agentId); if (!s || s.status !== "paused") return false; s.status = "running"; return true; }
    haltExecution(agentId: string, reason: string): boolean { const s = this.executions.get(agentId); if (!s || (s.status !== "running" && s.status !== "paused")) return false; s.status = "halted"; s.halted = true; s.haltReason = reason; return true; }    getTemplate(id: string): AgentTemplate | undefined { return this.templates.get(id); }
    getAllTemplates(): AgentTemplate[] { return [...this.templates.values()]; }
    getTemplatesByCategory(category: string): AgentTemplate[] { return [...this.templates.values()].filter(t => t.category === category); }
    createFromTemplate(templateId: string, overrides?: Partial<CustomAgentConfig>): CustomAgentConfig | null {
        const template = this.templates.get(templateId); if (!template) return null;
        template.popularity++;
        return this.createAgent({ ...template.config, ...overrides }); }    searchAgents(query: string): CustomAgentConfig[] {
        const q = query.toLowerCase();
        return [...this.agents.values()].filter(a =>
            a.name.toLowerCase().includes(q) ||
            a.description.toLowerCase().includes(q) ||
            a.tags.some(t => t.toLowerCase().includes(q)) ||
            a.routingKeywords.some(k => k.toLowerCase().includes(q))); }
    getAgentsByTag(tag: string): CustomAgentConfig[] {
        return [...this.agents.values()].filter(a => a.tags.includes(tag)); }    exportToYaml(agentId: string): string | null {
        const agent = this.agents.get(agentId); if (!agent) return null;
        const lines: string[] = [];
        lines.push("id: " + agent.id);
        lines.push("name: " + agent.name);
        lines.push("description: " + agent.description);
        lines.push("version: " + agent.version);
        lines.push("author: " + agent.author);
        lines.push("systemPrompt: " + agent.systemPrompt);
        lines.push("goals:");
        for (const g of agent.goals) {
            lines.push("  - id: " + g.id);
            lines.push("    description: " + g.description);
            lines.push("    priority: " + g.priority);
            lines.push("    checklist: " + g.checklist.join(", ")); }
        lines.push("tags: " + agent.tags.join(", "));
        lines.push("icon: " + agent.icon);
        return lines.join("\n"); }    importFromYaml(yaml: string): CustomAgentConfig | null {
        try {
            const lines = yaml.split("\n");
            const data: any = {};
            for (const line of lines) {
                const match = line.match(/^(\w+):\s*(.*)$/);
                if (match) data[match[1]] = match[2]; }
            if (!data.name) return null;
            return this.createAgent({ name: data.name, description: data.description || "",
                version: data.version || "1.0.0", author: data.author || "user",
                systemPrompt: data.systemPrompt || "You are a specialized AI agent.",
                tags: data.tags ? data.tags.split(", ") : [],
                icon: data.icon || "bot" });
        } catch { return null; } }    private similarity(a: string, b: string): number {
        if (a === b) return 1;
        if (!a || !b) return 0;
        const maxLen = Math.max(a.length, b.length);
        let matches = 0;
        for (let i = 0; i < Math.min(a.length, b.length); i++) { if (a[i] === b[i]) matches++; }
        return matches / maxLen; }
    reset(): void { this.agents.clear(); this.executions.clear(); this.templates.clear(); this.idCounter = 0; this.initializeTemplates(); }    private initializeTemplates(): void {
        this.templates.set("tmpl-research", { id: "tmpl-research", name: "Research Agent",
            description: "An agent that researches topics and gathers information",
            category: "research", popularity: 0,
            config: { name: "Research Agent", systemPrompt: "You are a research agent that gathers and analyzes information.",
                routingKeywords: ["research", "investigate", "analyze", "find"], tags: ["research", "analysis"], icon: "search" } });        this.templates.set("tmpl-code-review", { id: "tmpl-code-review", name: "Code Review Agent",
            description: "An agent that reviews code for quality and best practices",
            category: "code-review", popularity: 0,
            config: { name: "Code Review Agent", systemPrompt: "You are a code review agent that analyzes code quality.",
                routingKeywords: ["review", "code quality", "best practices", "lint"], tags: ["code-review", "quality"], icon: "code" } });        this.templates.set("tmpl-documentation", { id: "tmpl-documentation", name: "Documentation Agent",
            description: "An agent that generates and improves documentation",
            category: "documentation", popularity: 0,
            config: { name: "Documentation Agent", systemPrompt: "You are a documentation agent that creates clear docs.",
                routingKeywords: ["document", "readme", "api docs", "write docs"], tags: ["documentation", "writing"], icon: "book" } });        this.templates.set("tmpl-bug-analysis", { id: "tmpl-bug-analysis", name: "Bug Analysis Agent",
            description: "An agent that analyzes bugs and suggests fixes",
            category: "bug-analysis", popularity: 0,
            config: { name: "Bug Analysis Agent", systemPrompt: "You are a bug analysis agent that identifies and diagnoses issues.",
                routingKeywords: ["bug", "error", "issue", "debug", "fix"], tags: ["bug-analysis", "debugging"], icon: "bug" } });
    }
}