# Phase 1: Test Coverage to 80%+ (Priority: HIGHEST)

**Goal**: Bring global test coverage from current levels to >=80% across statements, branches, functions, and lines.
**Status**: IN PROGRESS
**Current**: 4,423 tests passing, 147 test suites

## Critical Coverage Gaps (By Priority)

### Tier 1: Planning Agents (~19% coverage → 80%+)
These 13 untested files are the biggest gap:

| File | LOC | Test File Needed |
|------|-----|-----------------|
| src/agents/planning/context.ts | 591 | tests/agents/planning/context.test.ts |
| src/agents/planning/prdParser.ts | 509 | tests/agents/planning/prdParser.test.ts |
| src/agents/planning/vagueness.ts | 521 | tests/agents/planning/vagueness.test.ts |
| src/agents/planning/decomposer.ts | 479 | tests/agents/planning/decomposer.test.ts |
| src/agents/planning/estimation.ts | 465 | tests/agents/planning/estimation.test.ts |
| src/agents/planning/patterns.ts | 500 | tests/agents/planning/patterns.test.ts |
| src/agents/planning/prompts.ts | 461 | tests/agents/planning/prompts.test.ts |
| src/agents/planning/priority.ts | 440 | tests/agents/planning/priority.test.ts |
| src/agents/planning/handoff.ts | 408 | tests/agents/planning/handoff.test.ts |
| src/agents/planning/tasksync.ts | 465 | tests/agents/planning/tasksync.test.ts |
| src/agents/planning/zenTasks.ts | 436 | tests/agents/planning/zenTasks.test.ts |
| src/agents/planning/analysis.ts | 327 | tests/agents/planning/analysis.test.ts |
| src/agents/planning/index.ts | 461 | tests/agents/planning/index.test.ts |
| src/agents/planning/planValidator.ts | 588 | tests/agents/planning/planValidator.test.ts |

### Tier 2: UI Layer (~48% coverage → 80%+)
15+ untested UI files:

| File | LOC | Test File Needed |
|------|-----|-----------------|
| src/ui/planAnalytics.ts | 1102 | tests/ui/planAnalytics.test.ts |
| src/ui/blockCanvas.ts | 1046 | tests/ui/blockCanvas.test.ts |
| src/ui/planValidator.ts | 922 | tests/ui/planValidator.test.ts |
| src/ui/planCollaboration.ts | 747 | tests/ui/planCollaboration.test.ts |
| src/ui/planHealth.ts | 713 | tests/ui/planHealth.test.ts |
| src/ui/planExport.ts | 651 | tests/ui/planExport.test.ts |
| src/ui/dependencyGraph.ts | 622 | tests/ui/dependencyGraph.test.ts |
| src/ui/agentGallery.ts | 586 | tests/ui/agentGallery.test.ts |
| src/ui/planningWizard.ts | 180 | tests/ui/planningWizard.test.ts |
| src/ui/planningWizardIntegration.ts | - | tests/ui/planningWizardIntegration.test.ts |
| src/ui/planTemplates.ts | - | tests/ui/planTemplates.test.ts |
| src/ui/planVersioning.ts | - | tests/ui/planVersioning.test.ts |
| src/ui/wizardHtml.ts | - | tests/ui/wizardHtml.test.ts |
| src/ui/wizardPages.ts | - | tests/ui/wizardPages.test.ts |
| src/ui/aiSuggestions.ts | - | tests/ui/aiSuggestions.test.ts |
| src/ui/detailedTextBox.ts | - | tests/ui/detailedTextBox.test.ts |
| src/ui/canvasToPlan.ts | - | tests/ui/canvasToPlan.test.ts |
| src/ui/blockPropertyPanel.ts | - | tests/ui/blockPropertyPanel.test.ts |
| src/ui/dragDropHandlers.ts | - | tests/ui/dragDropHandlers.test.ts |

### Tier 3: Planning Integration (0% coverage)

| File | LOC | Test File Needed |
|------|-----|-----------------|
| src/planning/documentationSync.ts | 744 | tests/planning/documentationSync.test.ts |
| src/planning/driftDetection.ts | 725 | tests/planning/driftDetection.test.ts |
| src/planning/orchestratorIntegration.ts | 670 | tests/planning/orchestratorIntegration.test.ts |
| src/planning/schema.ts | - | tests/planning/schema.test.ts |
| src/planning/index.ts | - | tests/planning/index.test.ts |

### Tier 4: Error Handling (~40% coverage)

| File | LOC | Test File Needed |
|------|-----|-----------------|
| src/errors/stateErrors.ts | 259 | tests/errors/stateErrors.test.ts |
| src/errors/timeoutErrors.ts | 217 | tests/errors/timeoutErrors.test.ts |
| src/errors/validationErrors.ts | 243 | tests/errors/validationErrors.test.ts |

### Tier 5: Clarity Agent (~75% coverage)

| File | LOC | Test File Needed |
|------|-----|-----------------|
| src/agents/clarity/followUp.ts | 513 | tests/agents/clarity/followUp.test.ts |
| src/agents/clarity/scoring.ts | 472 | tests/agents/clarity/scoring.test.ts |
| src/agents/clarity/trigger.ts | 392 | tests/agents/clarity/trigger.test.ts |
| src/agents/clarity/index.ts | 283 | tests/agents/clarity/index.test.ts |

### Tier 6: MCP Server (~44% coverage)

| File | LOC | Test File Needed |
|------|-----|-----------------|
| src/mcpServer/server.ts | 409 | tests/mcpServer/server.test.ts |
| src/mcpServer/integration.ts | 50 | tests/mcpServer/integration.test.ts |
| src/mcpServer/tools/getErrors.ts | - | tests/mcpServer/tools/getErrors.test.ts |

## Approach
- Write tests following project conventions (Test N: prefix, JSDoc, typed catch)
- Focus on exported functions first (public API)
- Mock VS Code APIs, fs, and LLM calls
- Target 15-25 tests per file for comprehensive coverage
