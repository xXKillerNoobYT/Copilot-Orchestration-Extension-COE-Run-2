var fs=require("fs");
var p="C:/Users/weird/OneDrive/Documents/GitHub/Copilot-Orchestration-Extension-COE-Run-2/src/core/custom-agent-builder.ts";
var L=[];
L.push("    exportToYaml(agentId) {");
L.push("        var agent = this.agents.get(agentId);");
L.push("        if (\!agent) { return null; }");
