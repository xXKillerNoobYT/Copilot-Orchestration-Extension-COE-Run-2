# Directive: Custom Agent Creation & Execution

## Goal
Allow users to create specialized read-only agents via YAML config.

## Inputs
- Agent name, description, system prompt
- Goals (prioritized list)
- Checklist items
- Routing keywords
- Permission settings (read-only enforced)

## Process — Creation
1. User opens Custom Agent Builder (command or UI)
2. Fill in: name, description, system prompt
3. Add goals with priority ordering
4. Add checklist items
5. Set routing keywords
6. Review permissions: read/search/tickets/LLM = configurable, write/execute = LOCKED
7. Save → YAML written to `.coe/agents/custom/{name}.yaml`
8. Agent registered in database

## Process — Execution
1. Custom agent triggered (keyword match, ticket assignment, or manual)
2. Load YAML config
3. HARDLOCK CHECK: verify no write/execute permissions (always deny)
4. For each goal (in priority order):
   a. Load relevant context
   b. Call LLM with system prompt + goal
   c. Validate response format
   d. Check against checklist items
   e. Store results in ticket
5. After each goal: safety checks
   - Token usage within limit?
   - Response coherent (not looping)?
   - Time budget OK (<5 min/goal)?
   - No write attempts?
6. If any safety check fails → halt + report partial results
7. All goals complete → return results via ticket system

## Safety Limits
| Guard | Default | Maximum |
|-------|---------|---------|
| Goals per run | 20 | 20 |
| LLM calls per run | 50 | 50 |
| Time per goal | 5 min | 5 min |
| Total runtime | 30 min | 30 min |
| Loop detection | 3 similar | 3 |

## Hardlocked Permissions (CANNOT be overridden)
- Cannot write or edit any file
- Cannot execute any command
- Cannot modify other agents
- Cannot modify own config

## Outputs
- Agent YAML file in `.coe/agents/custom/`
- Agent record in database
- Execution results via ticket system
- Full audit trail
