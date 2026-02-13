import { CustomAgentBuilder, CustomAgentConfig, AgentExecutionState, AgentTemplate, AgentValidationResult } from "../src/core/custom-agent-builder";

describe("CustomAgentBuilder", () => {
    let builder: CustomAgentBuilder;

    beforeEach(() => {
        builder = new CustomAgentBuilder();
    });

    const validConfig: Partial<CustomAgentConfig> = {
        name: "Test Agent",
        description: "A dummy test agent",
        systemPrompt: "You are a helpful test agent for unit testing.",
        goals: [{ id: "g1", description: "Run tests", priority: 1, checklist: ["check1", "check2"] }],
        routingKeywords: ["test", "validate"],
        tags: ["testing", "qa"],
        icon: "test-tube"
    };

    describe("Agent CRUD", () => {
        test("createAgent returns a valid agent with defaults", () => {
            const agent = builder.createAgent({ name: "My Agent" });
            expect(agent.name).toBe("My Agent");
            expect(agent.id).toBeDefined();
            expect(agent.version).toBe("1.0.0");
            expect(agent.author).toBe("user");
            expect(agent.icon).toBe("bot");
        });

        test("createAgent uses provided id", () => {
            const agent = builder.createAgent({ id: "custom-id", name: "Test" });
            expect(agent.id).toBe("custom-id");
        });

        test("createAgent generates unique ids", () => {
            const a1 = builder.createAgent({ name: "A1" });
            const a2 = builder.createAgent({ name: "A2" });
            expect(a1.id).not.toBe(a2.id);
        });

        test("createAgent sets createdAt and updatedAt", () => {
            const agent = builder.createAgent(validConfig);
            expect(agent.createdAt).toBeDefined();
            expect(agent.updatedAt).toBeDefined();
            expect(new Date(agent.createdAt).getTime()).toBeLessThanOrEqual(Date.now());
        });

        test("createAgent with full config", () => {
            const agent = builder.createAgent(validConfig);
            expect(agent.name).toBe("Test Agent");
            expect(agent.description).toBe("A dummy test agent");
            expect(agent.goals.length).toBe(1);
            expect(agent.routingKeywords).toContain("test");
            expect(agent.tags).toContain("testing");
        });

        test("createAgent with empty config uses all defaults", () => {
            const agent = builder.createAgent({});
            expect(agent.name).toBe("Untitled Agent");
            expect(agent.systemPrompt).toBe("You are a specialized AI agent.");
            expect(agent.goals).toHaveLength(0);
        });

        test("getAgent returns created agent", () => {
            const agent = builder.createAgent(validConfig);
            const fetched = builder.getAgent(agent.id);
            expect(fetched).toBeDefined();
            expect(fetched!.name).toBe("Test Agent");
        });

        test("getAgent returns undefined for unknown id", () => {
            expect(builder.getAgent("nonexistent")).toBeUndefined();
        });

        test("getAllAgents returns all created agents", () => {
            builder.createAgent({ name: "A1" });
            builder.createAgent({ name: "A2" });
            builder.createAgent({ name: "A3" });
            expect(builder.getAllAgents()).toHaveLength(3);
        });

        test("updateAgent changes fields", () => {
            const agent = builder.createAgent(validConfig);
            const updated = builder.updateAgent(agent.id, { name: "Updated Name", description: "New desc" });
            expect(updated).not.toBeNull();
            expect(updated!.name).toBe("Updated Name");
            expect(updated!.description).toBe("New desc");
        });

        test("updateAgent returns null for unknown id", () => {
            expect(builder.updateAgent("nonexistent", { name: "X" })).toBeNull();
        });

        test("updateAgent updates updatedAt timestamp", () => {
            const agent = builder.createAgent(validConfig);
            const originalUpdated = agent.updatedAt;
            const updated = builder.updateAgent(agent.id, { name: "New Name" });
            expect(updated!.updatedAt).toBeDefined();
        });

        test("deleteAgent removes agent", () => {
            const agent = builder.createAgent(validConfig);
            expect(builder.deleteAgent(agent.id)).toBe(true);
            expect(builder.getAgent(agent.id)).toBeUndefined();
        });

        test("deleteAgent returns false for unknown id", () => {
            expect(builder.deleteAgent("nonexistent")).toBe(false);
        });

        test("createAgent caps goals at 20", () => {
            const goals = Array.from({ length: 25 }, (_, i) => ({
                id: "g" + i, description: "Goal " + i, priority: i, checklist: [] }));
            const agent = builder.createAgent({ ...validConfig, goals });
            expect(agent.goals.length).toBeLessThanOrEqual(20);
        });

        test("createAgent caps checklist items at 50", () => {
            const checklist = Array.from({ length: 60 }, (_, i) => "item" + i);
            const agent = builder.createAgent({ ...validConfig, goals: [{ id: "g1", description: "G", priority: 1, checklist }] });
            expect(agent.goals[0].checklist.length).toBeLessThanOrEqual(50);
        });
    });
    describe("Hardlock Security", () => {
        test("createAgent always sets writeFiles to false", () => {
            const agent = builder.createAgent({ ...validConfig, permissions: { readFiles: true, searchCode: true, createTickets: true, callLlm: true, writeFiles: false, executeCode: false } });
            expect(agent.permissions.writeFiles).toBe(false);
        });

        test("createAgent always sets executeCode to false", () => {
            const agent = builder.createAgent({ ...validConfig, permissions: { readFiles: true, searchCode: true, createTickets: true, callLlm: true, writeFiles: false, executeCode: false } });
            expect(agent.permissions.executeCode).toBe(false);
        });

        test("updateAgent cannot enable writeFiles", () => {
            const agent = builder.createAgent(validConfig);
            const updated = builder.updateAgent(agent.id, { permissions: { readFiles: true, searchCode: true, createTickets: true, callLlm: true, writeFiles: false, executeCode: false } });
            expect(updated!.permissions.writeFiles).toBe(false);
        });

        test("updateAgent cannot enable executeCode", () => {
            const agent = builder.createAgent(validConfig);
            const updated = builder.updateAgent(agent.id, { permissions: { readFiles: true, searchCode: true, createTickets: true, callLlm: true, writeFiles: false, executeCode: false } });
            expect(updated!.permissions.executeCode).toBe(false);
        });

        test("validation rejects writeFiles true", () => {
            const result = builder.validateAgent({ ...validConfig, permissions: { readFiles: true, searchCode: true, createTickets: true, callLlm: true, writeFiles: true as any, executeCode: false } });
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes("writeFiles"))).toBe(true);
        });

        test("validation rejects executeCode true", () => {
            const result = builder.validateAgent({ ...validConfig, permissions: { readFiles: true, searchCode: true, createTickets: true, callLlm: true, writeFiles: false, executeCode: true as any } });
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes("executeCode"))).toBe(true);
        });

        test("default permissions are read-only", () => {
            const agent = builder.createAgent({ name: "Test" });
            expect(agent.permissions.readFiles).toBe(true);
            expect(agent.permissions.searchCode).toBe(true);
            expect(agent.permissions.writeFiles).toBe(false);
            expect(agent.permissions.executeCode).toBe(false);
        });
    });
    describe("Safety Limits", () => {
        test("maxGoalsPerRun capped at 20", () => {
            const agent = builder.createAgent({ ...validConfig, safetyLimits: { maxGoalsPerRun: 100, maxLlmCallsPerRun: 50, maxTimePerGoalMs: 300000, maxTotalTimeMs: 1800000, loopDetectionThreshold: 3 } });
            expect(agent.safetyLimits.maxGoalsPerRun).toBeLessThanOrEqual(20);
        });

        test("maxLlmCallsPerRun capped at 50", () => {
            const agent = builder.createAgent({ ...validConfig, safetyLimits: { maxGoalsPerRun: 20, maxLlmCallsPerRun: 1000, maxTimePerGoalMs: 300000, maxTotalTimeMs: 1800000, loopDetectionThreshold: 3 } });
            expect(agent.safetyLimits.maxLlmCallsPerRun).toBeLessThanOrEqual(50);
        });

        test("maxTimePerGoalMs capped at 300000", () => {
            const agent = builder.createAgent({ ...validConfig, safetyLimits: { maxGoalsPerRun: 20, maxLlmCallsPerRun: 50, maxTimePerGoalMs: 9999999, maxTotalTimeMs: 1800000, loopDetectionThreshold: 3 } });
            expect(agent.safetyLimits.maxTimePerGoalMs).toBeLessThanOrEqual(300000);
        });

        test("maxTotalTimeMs capped at 1800000", () => {
            const agent = builder.createAgent({ ...validConfig, safetyLimits: { maxGoalsPerRun: 20, maxLlmCallsPerRun: 50, maxTimePerGoalMs: 300000, maxTotalTimeMs: 9999999, loopDetectionThreshold: 3 } });
            expect(agent.safetyLimits.maxTotalTimeMs).toBeLessThanOrEqual(1800000);
        });

        test("default safety limits are reasonable", () => {
            const agent = builder.createAgent({ name: "Test" });
            expect(agent.safetyLimits.maxGoalsPerRun).toBe(20);
            expect(agent.safetyLimits.maxLlmCallsPerRun).toBe(50);
            expect(agent.safetyLimits.maxTimePerGoalMs).toBe(300000);
            expect(agent.safetyLimits.maxTotalTimeMs).toBe(1800000);
            expect(agent.safetyLimits.loopDetectionThreshold).toBe(3);
        });

        test("updateAgent caps safety limits too", () => {
            const agent = builder.createAgent(validConfig);
            const updated = builder.updateAgent(agent.id, { safetyLimits: { maxGoalsPerRun: 999, maxLlmCallsPerRun: 999, maxTimePerGoalMs: 9999999, maxTotalTimeMs: 9999999, loopDetectionThreshold: 3 } });
            expect(updated!.safetyLimits.maxGoalsPerRun).toBeLessThanOrEqual(20);
            expect(updated!.safetyLimits.maxLlmCallsPerRun).toBeLessThanOrEqual(50);
        });
    });
    describe("Validation", () => {
        test("valid config passes validation", () => {
            const result = builder.validateAgent(validConfig);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        test("missing name fails validation", () => {
            const result = builder.validateAgent({ ...validConfig, name: "" });
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes("name"))).toBe(true);
        });

        test("name over 100 chars fails", () => {
            const result = builder.validateAgent({ ...validConfig, name: "x".repeat(101) });
            expect(result.valid).toBe(false);
        });

        test("short system prompt fails", () => {
            const result = builder.validateAgent({ ...validConfig, systemPrompt: "short" });
            expect(result.valid).toBe(false);
        });

        test("no goals fails validation", () => {
            const result = builder.validateAgent({ ...validConfig, goals: [] });
            expect(result.valid).toBe(false);
        });

        test("goal with empty description fails", () => {
            const result = builder.validateAgent({ ...validConfig, goals: [{ id: "g1", description: "", priority: 1, checklist: [] }] });
            expect(result.valid).toBe(false);
        });

        test("over 20 goals fails validation", () => {
            const goals = Array.from({ length: 21 }, (_, i) => ({ id: "g" + i, description: "Goal " + i, priority: i, checklist: [] }));
            const result = builder.validateAgent({ ...validConfig, goals });
            expect(result.valid).toBe(false);
        });

        test("no routing keywords generates warning", () => {
            const result = builder.validateAgent({ ...validConfig, routingKeywords: [] });
            expect(result.warnings.length).toBeGreaterThan(0);
        });

        test("long system prompt generates warning", () => {
            const result = builder.validateAgent({ ...validConfig, systemPrompt: "x".repeat(5001) });
            expect(result.warnings.some(w => w.includes("very long"))).toBe(true);
        });
    });
    describe("Execution", () => {
        test("startExecution creates running state", () => {
            const agent = builder.createAgent(validConfig);
            const state = builder.startExecution(agent.id);
            expect(state).not.toBeNull();
            expect(state!.status).toBe("running");
            expect(state!.agentId).toBe(agent.id);
            expect(state!.goalResults).toHaveLength(1);
        });

        test("startExecution returns null for unknown agent", () => {
            expect(builder.startExecution("nonexistent")).toBeNull();
        });

        test("processGoal completes a goal", () => {
            const agent = builder.createAgent(validConfig);
            builder.startExecution(agent.id);
            const state = builder.processGoal(agent.id, "done", [true, true], 2, 1000);
            expect(state).not.toBeNull();
            expect(state!.goalResults[0].status).toBe("completed");
            expect(state!.goalResults[0].result).toBe("done");
        });

        test("processGoal tracks LLM call count", () => {
            const agent = builder.createAgent({ ...validConfig, goals: [
                { id: "g1", description: "G1", priority: 1, checklist: [] },
                { id: "g2", description: "G2", priority: 2, checklist: [] }
            ] });
            builder.startExecution(agent.id);
            builder.processGoal(agent.id, "r1", [], 5, 2000);
            const state = builder.getExecution(agent.id);
            expect(state!.totalLlmCalls).toBe(5);
            expect(state!.totalDurationMs).toBe(2000);
        });

        test("processGoal halts when LLM budget exceeded", () => {
            const agent = builder.createAgent({ ...validConfig, goals: [
                { id: "g1", description: "G1", priority: 1, checklist: [] },
                { id: "g2", description: "G2", priority: 2, checklist: [] }
            ], safetyLimits: { maxGoalsPerRun: 20, maxLlmCallsPerRun: 5, maxTimePerGoalMs: 300000, maxTotalTimeMs: 1800000, loopDetectionThreshold: 3 } });
            builder.startExecution(agent.id);
            const state = builder.processGoal(agent.id, "r1", [], 6, 1000);
            expect(state!.status).toBe("halted");
            expect(state!.haltReason).toContain("LLM call budget");
        });

        test("processGoal halts when total runtime exceeded", () => {
            const agent = builder.createAgent({ ...validConfig, goals: [
                { id: "g1", description: "G1", priority: 1, checklist: [] },
                { id: "g2", description: "G2", priority: 2, checklist: [] }
            ], safetyLimits: { maxGoalsPerRun: 20, maxLlmCallsPerRun: 50, maxTimePerGoalMs: 300000, maxTotalTimeMs: 5000, loopDetectionThreshold: 3 } });
            builder.startExecution(agent.id);
            const state = builder.processGoal(agent.id, "r1", [], 1, 6000);
            expect(state!.status).toBe("halted");
            expect(state!.haltReason).toContain("runtime");
        });

        test("processGoal returns null for non-running execution", () => {
            expect(builder.processGoal("nonexistent", "r", [], 1, 100)).toBeNull();
        });

        test("pauseExecution pauses running execution", () => {
            const agent = builder.createAgent(validConfig);
            builder.startExecution(agent.id);
            expect(builder.pauseExecution(agent.id)).toBe(true);
            expect(builder.getExecution(agent.id)!.status).toBe("paused");
        });

        test("resumeExecution resumes paused execution", () => {
            const agent = builder.createAgent(validConfig);
            builder.startExecution(agent.id);
            builder.pauseExecution(agent.id);
            expect(builder.resumeExecution(agent.id)).toBe(true);
            expect(builder.getExecution(agent.id)!.status).toBe("running");
        });

        test("haltExecution halts running execution", () => {
            const agent = builder.createAgent(validConfig);
            builder.startExecution(agent.id);
            expect(builder.haltExecution(agent.id, "manual stop")).toBe(true);
            const state = builder.getExecution(agent.id);
            expect(state!.status).toBe("halted");
            expect(state!.haltReason).toBe("manual stop");
        });

        test("haltExecution returns false for completed execution", () => {
            const agent = builder.createAgent(validConfig);
            builder.startExecution(agent.id);
            builder.processGoal(agent.id, "done", [true], 1, 100);
            expect(builder.haltExecution(agent.id, "too late")).toBe(false);
        });

        test("pauseExecution returns false for non-running", () => {
            expect(builder.pauseExecution("nonexistent")).toBe(false);
        });

        test("resumeExecution returns false for non-paused", () => {
            const agent = builder.createAgent(validConfig);
            builder.startExecution(agent.id);
            expect(builder.resumeExecution(agent.id)).toBe(false);
        });
    });
    describe("Loop Detection", () => {
        test("detects loop with identical responses", () => {
            const agent = builder.createAgent({ ...validConfig, goals: [
                { id: "g1", description: "G1", priority: 1, checklist: [] },
                { id: "g2", description: "G2", priority: 2, checklist: [] },
                { id: "g3", description: "G3", priority: 3, checklist: [] },
                { id: "g4", description: "G4", priority: 4, checklist: [] }
            ], safetyLimits: { maxGoalsPerRun: 20, maxLlmCallsPerRun: 50, maxTimePerGoalMs: 300000, maxTotalTimeMs: 1800000, loopDetectionThreshold: 3 } });
            builder.startExecution(agent.id);
            builder.processGoal(agent.id, "same response", [], 1, 100);
            builder.processGoal(agent.id, "same response", [], 1, 100);
            const state = builder.processGoal(agent.id, "same response", [], 1, 100);
            expect(state!.status).toBe("halted");
            expect(state!.haltReason).toContain("Loop detected");
        });

        test("does not false positive on different responses", () => {
            const agent = builder.createAgent({ ...validConfig, goals: [
                { id: "g1", description: "G1", priority: 1, checklist: [] },
                { id: "g2", description: "G2", priority: 2, checklist: [] },
                { id: "g3", description: "G3", priority: 3, checklist: [] }
            ] });
            builder.startExecution(agent.id);
            builder.processGoal(agent.id, "completely different result A", [], 1, 100);
            builder.processGoal(agent.id, "another unique result B with more text", [], 1, 100);
            const state = builder.processGoal(agent.id, "yet another totally different response C", [], 1, 100);
            expect(state!.status).not.toBe("halted");
        });
    });
    describe("Templates", () => {
        test("has 4 built-in templates", () => {
            expect(builder.getAllTemplates()).toHaveLength(4);
        });

        test("getTemplate returns research template", () => {
            const t = builder.getTemplate("tmpl-research");
            expect(t).toBeDefined();
            expect(t!.category).toBe("research");
        });

        test("getTemplate returns code-review template", () => {
            const t = builder.getTemplate("tmpl-code-review");
            expect(t).toBeDefined();
            expect(t!.category).toBe("code-review");
        });

        test("getTemplate returns documentation template", () => {
            const t = builder.getTemplate("tmpl-documentation");
            expect(t).toBeDefined();
            expect(t!.category).toBe("documentation");
        });

        test("getTemplate returns bug-analysis template", () => {
            const t = builder.getTemplate("tmpl-bug-analysis");
            expect(t).toBeDefined();
            expect(t!.category).toBe("bug-analysis");
        });

        test("getTemplate returns undefined for unknown", () => {
            expect(builder.getTemplate("nonexistent")).toBeUndefined();
        });

        test("getTemplatesByCategory filters correctly", () => {
            const research = builder.getTemplatesByCategory("research");
            expect(research).toHaveLength(1);
            expect(research[0].id).toBe("tmpl-research");
        });

        test("createFromTemplate creates agent from template", () => {
            const agent = builder.createFromTemplate("tmpl-research");
            expect(agent).not.toBeNull();
            expect(agent!.name).toBe("Research Agent");
            expect(agent!.permissions.writeFiles).toBe(false);
        });

        test("createFromTemplate with overrides", () => {
            const agent = builder.createFromTemplate("tmpl-code-review", { name: "My Reviewer" });
            expect(agent!.name).toBe("My Reviewer");
        });

        test("createFromTemplate returns null for unknown template", () => {
            expect(builder.createFromTemplate("nonexistent")).toBeNull();
        });

        test("createFromTemplate increments popularity", () => {
            const before = builder.getTemplate("tmpl-research")!.popularity;
            builder.createFromTemplate("tmpl-research");
            const after = builder.getTemplate("tmpl-research")!.popularity;
            expect(after).toBe(before + 1);
        });
    });
    describe("Gallery & Search", () => {
        test("searchAgents finds by name", () => {
            builder.createAgent({ ...validConfig, name: "My Special Agent" });
            const results = builder.searchAgents("Special");
            expect(results.length).toBeGreaterThan(0);
        });

        test("searchAgents finds by tag", () => {
            builder.createAgent({ ...validConfig, tags: ["unique-tag"] });
            const results = builder.searchAgents("unique-tag");
            expect(results.length).toBeGreaterThan(0);
        });

        test("searchAgents finds by keyword", () => {
            builder.createAgent({ ...validConfig, routingKeywords: ["super-unique"] });
            const results = builder.searchAgents("super-unique");
            expect(results.length).toBeGreaterThan(0);
        });

        test("searchAgents is case-insensitive", () => {
            builder.createAgent({ ...validConfig, name: "CASE TEST AGENT" });
            expect(builder.searchAgents("case test").length).toBeGreaterThan(0);
        });

        test("searchAgents returns empty for no match", () => {
            expect(builder.searchAgents("xyzzynomatch")).toHaveLength(0);
        });

        test("getAgentsByTag filters correctly", () => {
            builder.createAgent({ ...validConfig, tags: ["alpha"] });
            builder.createAgent({ ...validConfig, tags: ["beta"] });
            builder.createAgent({ ...validConfig, tags: ["alpha"] });
            expect(builder.getAgentsByTag("alpha")).toHaveLength(2);
            expect(builder.getAgentsByTag("beta")).toHaveLength(1);
        });
    });
    describe("YAML Export/Import", () => {
        test("exportToYaml returns YAML string", () => {
            const agent = builder.createAgent(validConfig);
            const yaml = builder.exportToYaml(agent.id);
            expect(yaml).not.toBeNull();
            expect(yaml!).toContain("name: Test Agent");
            expect(yaml!).toContain("id:");
        });

        test("exportToYaml returns null for unknown", () => {
            expect(builder.exportToYaml("nonexistent")).toBeNull();
        });

        test("exportToYaml includes goals", () => {
            const agent = builder.createAgent(validConfig);
            const yaml = builder.exportToYaml(agent.id)!;
            expect(yaml).toContain("goals:");
            expect(yaml).toContain("Run tests");
        });

        test("importFromYaml creates agent from YAML", () => {
            const yaml = "name: Imported Agent\ndescription: From YAML\nversion: 2.0.0\nauthor: tester\nsystemPrompt: You are an imported agent.\ntags: imported, yaml\nicon: star";
            const agent = builder.importFromYaml(yaml);
            expect(agent).not.toBeNull();
            expect(agent!.name).toBe("Imported Agent");
            expect(agent!.author).toBe("tester");
            expect(agent!.tags).toContain("imported");
        });

        test("importFromYaml returns null for invalid YAML", () => {
            expect(builder.importFromYaml("")).toBeNull();
        });

        test("importFromYaml returns null for YAML without name", () => {
            expect(builder.importFromYaml("description: no name")).toBeNull();
        });

        test("roundtrip export/import preserves name", () => {
            const agent = builder.createAgent(validConfig);
            const yaml = builder.exportToYaml(agent.id)!;
            const imported = builder.importFromYaml(yaml);
            expect(imported!.name).toBe(agent.name);
        });
    });
    describe("Reset", () => {
        test("reset clears all agents", () => {
            builder.createAgent(validConfig);
            builder.createAgent({ name: "Another" });
            builder.reset();
            expect(builder.getAllAgents()).toHaveLength(0);
        });

        test("reset preserves templates", () => {
            builder.createAgent(validConfig);
            builder.reset();
            expect(builder.getAllTemplates()).toHaveLength(4);
        });

        test("reset clears executions", () => {
            const agent = builder.createAgent(validConfig);
            builder.startExecution(agent.id);
            builder.reset();
            expect(builder.getExecution(agent.id)).toBeUndefined();
        });
    });
});
