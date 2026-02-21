# Critical Fix Plan: ErrorCode Standardization

**Priority**: MUST FIX before production deployment
**Estimated Effort**: 6-8 hours
**Testing Time**: 4-6 hours
**Total Timeline**: 10-14 hours

---

## Overview

The COE extension is missing comprehensive error handling standardization. This plan outlines the complete implementation of ErrorCode enum, StandardErrorResponse interface, and error propagation through all 4 architecture layers.

---

## Phase 1: Type Definitions (1-2 hours)

### File: `src/types/index.ts`

Add the following types at the end of the file:

```typescript
// ============================================================
// ERROR HANDLING TYPES (Standardized across all layers)
// ============================================================

export enum ErrorCode {
    // Validation & Parameters (4 codes)
    INVALID_PARAM = 'INVALID_PARAM',
    SCHEMA_VALIDATION_FAILED = 'SCHEMA_VALIDATION_FAILED',
    INVALID_STATE = 'INVALID_STATE',
    RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',

    // LLM & Token Management (3 codes)
    TOKEN_LIMIT_EXCEEDED = 'TOKEN_LIMIT_EXCEEDED',
    TIMEOUT = 'TIMEOUT',
    RATE_LIMIT = 'RATE_LIMIT',

    // System Failures (4 codes)
    INTERNAL_ERROR = 'INTERNAL_ERROR',
    AUTH_ERROR = 'AUTH_ERROR',
    TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',
    DELEGATION_FAILED = 'DELEGATION_FAILED',

    // Recovery & Escalation (3 codes)
    RECOVERY_TRIGGERED = 'RECOVERY_TRIGGERED',
    BREAKER_FAILED = 'BREAKER_FAILED',
    COHERENCE_DROP = 'COHERENCE_DROP',

    // Domain-Specific (3 codes)
    LOOP_DETECTED = 'LOOP_DETECTED',
    DRIFT_THRESHOLD_EXCEEDED = 'DRIFT_THRESHOLD_EXCEEDED',
    TICKET_UPDATE_CONFLICT = 'TICKET_UPDATE_CONFLICT',
}

export enum ErrorSeverity {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
    CRITICAL = 'CRITICAL',
}

export enum PriorityImpact {
    NONE = 'NONE',
    P3_IGNORABLE = 'P3_IGNORABLE',
    P2_DELAYED = 'P2_DELAYED',
    P1_BLOCKED = 'P1_BLOCKED',
}

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
        ticket_id?: string;
        agent_name?: string;
        timestamp: string;
    };
}

export interface ErrorCodeMetadata {
    code: ErrorCode;
    severity: ErrorSeverity;
    retryable: boolean;
    default_retry_after_seconds: number;
    fallback_suggested: boolean;
    priority_impact: PriorityImpact;
}

export const ERROR_CODE_REGISTRY: Record<ErrorCode, ErrorCodeMetadata> = {
    [ErrorCode.INVALID_PARAM]: {
        code: ErrorCode.INVALID_PARAM,
        severity: ErrorSeverity.MEDIUM,
        retryable: false,
        default_retry_after_seconds: 0,
        fallback_suggested: true,
        priority_impact: PriorityImpact.P1_BLOCKED,
    },
    [ErrorCode.TOKEN_LIMIT_EXCEEDED]: {
        code: ErrorCode.TOKEN_LIMIT_EXCEEDED,
        severity: ErrorSeverity.HIGH,
        retryable: true,
        default_retry_after_seconds: 30,
        fallback_suggested: true,
        priority_impact: PriorityImpact.P1_BLOCKED,
    },
    [ErrorCode.TIMEOUT]: {
        code: ErrorCode.TIMEOUT,
        severity: ErrorSeverity.HIGH,
        retryable: true,
        default_retry_after_seconds: 10,
        fallback_suggested: false,
        priority_impact: PriorityImpact.P2_DELAYED,
    },
    [ErrorCode.INTERNAL_ERROR]: {
        code: ErrorCode.INTERNAL_ERROR,
        severity: ErrorSeverity.CRITICAL,
        retryable: false,
        default_retry_after_seconds: 0,
        fallback_suggested: true,
        priority_impact: PriorityImpact.P1_BLOCKED,
    },
    [ErrorCode.RATE_LIMIT]: {
        code: ErrorCode.RATE_LIMIT,
        severity: ErrorSeverity.MEDIUM,
        retryable: true,
        default_retry_after_seconds: 60,
        fallback_suggested: false,
        priority_impact: PriorityImpact.P2_DELAYED,
    },
    [ErrorCode.INVALID_STATE]: {
        code: ErrorCode.INVALID_STATE,
        severity: ErrorSeverity.MEDIUM,
        retryable: false,
        default_retry_after_seconds: 0,
        fallback_suggested: true,
        priority_impact: PriorityImpact.P1_BLOCKED,
    },
    [ErrorCode.RESOURCE_NOT_FOUND]: {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        severity: ErrorSeverity.LOW,
        retryable: false,
        default_retry_after_seconds: 0,
        fallback_suggested: false,
        priority_impact: PriorityImpact.P3_IGNORABLE,
    },
    [ErrorCode.AUTH_ERROR]: {
        code: ErrorCode.AUTH_ERROR,
        severity: ErrorSeverity.CRITICAL,
        retryable: false,
        default_retry_after_seconds: 0,
        fallback_suggested: true,
        priority_impact: PriorityImpact.P1_BLOCKED,
    },
    [ErrorCode.SCHEMA_VALIDATION_FAILED]: {
        code: ErrorCode.SCHEMA_VALIDATION_FAILED,
        severity: ErrorSeverity.MEDIUM,
        retryable: false,
        default_retry_after_seconds: 0,
        fallback_suggested: true,
        priority_impact: PriorityImpact.P2_DELAYED,
    },
    [ErrorCode.RECOVERY_TRIGGERED]: {
        code: ErrorCode.RECOVERY_TRIGGERED,
        severity: ErrorSeverity.HIGH,
        retryable: true,
        default_retry_after_seconds: 10,
        fallback_suggested: true,
        priority_impact: PriorityImpact.P1_BLOCKED,
    },
    [ErrorCode.BREAKER_FAILED]: {
        code: ErrorCode.BREAKER_FAILED,
        severity: ErrorSeverity.HIGH,
        retryable: false,
        default_retry_after_seconds: 0,
        fallback_suggested: true,
        priority_impact: PriorityImpact.P1_BLOCKED,
    },
    [ErrorCode.TOOL_NOT_FOUND]: {
        code: ErrorCode.TOOL_NOT_FOUND,
        severity: ErrorSeverity.MEDIUM,
        retryable: false,
        default_retry_after_seconds: 0,
        fallback_suggested: true,
        priority_impact: PriorityImpact.P2_DELAYED,
    },
    [ErrorCode.DELEGATION_FAILED]: {
        code: ErrorCode.DELEGATION_FAILED,
        severity: ErrorSeverity.MEDIUM,
        retryable: true,
        default_retry_after_seconds: 15,
        fallback_suggested: false,
        priority_impact: PriorityImpact.P2_DELAYED,
    },
    [ErrorCode.LOOP_DETECTED]: {
        code: ErrorCode.LOOP_DETECTED,
        severity: ErrorSeverity.HIGH,
        retryable: false,
        default_retry_after_seconds: 0,
        fallback_suggested: true,
        priority_impact: PriorityImpact.P1_BLOCKED,
    },
    [ErrorCode.DRIFT_THRESHOLD_EXCEEDED]: {
        code: ErrorCode.DRIFT_THRESHOLD_EXCEEDED,
        severity: ErrorSeverity.MEDIUM,
        retryable: false,
        default_retry_after_seconds: 0,
        fallback_suggested: false,
        priority_impact: PriorityImpact.P1_BLOCKED,
    },
    [ErrorCode.COHERENCE_DROP]: {
        code: ErrorCode.COHERENCE_DROP,
        severity: ErrorSeverity.MEDIUM,
        retryable: true,
        default_retry_after_seconds: 20,
        fallback_suggested: false,
        priority_impact: PriorityImpact.P2_DELAYED,
    },
    [ErrorCode.TICKET_UPDATE_CONFLICT]: {
        code: ErrorCode.TICKET_UPDATE_CONFLICT,
        severity: ErrorSeverity.HIGH,
        retryable: true,
        default_retry_after_seconds: 1,
        fallback_suggested: false,
        priority_impact: PriorityImpact.P2_DELAYED,
    },
};
```

---

## Phase 2: Base Agent Error Handling (1-2 hours)

### File: `src/agents/base-agent.ts`

Add helper methods for standardized error handling:

```typescript
import { ErrorCode, ErrorSeverity, PriorityImpact, StandardErrorResponse, ERROR_CODE_REGISTRY } from '../types';

export class BaseAgent {
    // ... existing code ...

    /**
     * Create a standardized error response
     */
    protected createErrorResponse(
        code: ErrorCode,
        message: string,
        details?: Record<string, unknown>,
        taskId?: string,
        ticketId?: string
    ): StandardErrorResponse {
        const metadata = ERROR_CODE_REGISTRY[code];
        return {
            success: false,
            error: {
                code,
                message,
                details,
                severity: metadata.severity,
                retryable: metadata.retryable,
                retry_after_seconds: metadata.retryable ? metadata.default_retry_after_seconds : undefined,
                fallback_suggested: metadata.fallback_suggested,
                priority_impact: metadata.priority_impact,
            },
            context: {
                task_id: taskId,
                ticket_id: ticketId,
                agent_name: this.agentType,
                timestamp: new Date().toISOString(),
            },
        };
    }

    /**
     * Throw a standardized error (for sync code paths)
     */
    protected throwError(
        code: ErrorCode,
        message: string,
        details?: Record<string, unknown>,
        taskId?: string,
        ticketId?: string
    ): never {
        const errorResponse = this.createErrorResponse(code, message, details, taskId, ticketId);
        const error = new Error(JSON.stringify(errorResponse));
        error.name = 'StandardError';
        throw error;
    }
}
```

---

## Phase 3: MCP Server Error Handling (2-3 hours)

### File: `src/mcp/server.ts`

Update all tool handlers to return StandardErrorResponse. Example pattern:

```typescript
// BEFORE
if (!task) {
    return {
        success: false,
        error: 'No tasks ready. All tasks are either completed, blocked, or pending verification.',
    };
}

// AFTER
if (!task) {
    const errorResponse = this.createStandardError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'No tasks ready. All tasks are either completed, blocked, or pending verification.',
        { queue_status: { isEmpty: true } }
    );
    return errorResponse;
}
```

Add helper method to MCPServer class:

```typescript
private createStandardError(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>
): StandardErrorResponse {
    const metadata = ERROR_CODE_REGISTRY[code];
    return {
        success: false,
        error: {
            code,
            message,
            details,
            severity: metadata.severity,
            retryable: metadata.retryable,
            retry_after_seconds: metadata.retryable ? metadata.default_retry_after_seconds : undefined,
            fallback_suggested: metadata.fallback_suggested,
            priority_impact: metadata.priority_impact,
        },
        context: {
            timestamp: new Date().toISOString(),
        },
    };
}
```

Update these MCP tools:
- `getNextTask` (line 107-180)
- `reportTaskDone` (line 182-233)
- `askQuestion` (line 235-277)
- `getErrors` (line 279-331)
- `callCOEAgent` (line 333-431)
- `scanCodeBase` (line 433-488)
- `getAgentDescriptions` (line 490-507)
- `confirmAgentCall` (line 508-552)
- `getTicketHistory` (line 554-612)

---

## Phase 4: Core Services Error Handling (2-3 hours)

### Key Files to Update

1. **src/core/database.ts** — Database operation errors
2. **src/core/llm-service.ts** — LLM timeout/token errors
3. **src/core/task-decomposition-engine.ts** — Validation errors
4. **src/core/context-breaking-chain.ts** — Recovery errors
5. **src/core/ethics-engine.ts** — Ethics decision errors
6. **src/core/ticket-processor.ts** — Ticket operation errors

Pattern for each service:

```typescript
import { ErrorCode, ErrorSeverity, StandardErrorResponse } from '../types';

class MyService {
    async doSomething(): Promise<Result | StandardErrorResponse> {
        try {
            // operation
        } catch (e) {
            const error: StandardErrorResponse = {
                success: false,
                error: {
                    code: ErrorCode.INTERNAL_ERROR,
                    message: 'Failed to do something',
                    details: { originalError: String(e) },
                    severity: ErrorSeverity.HIGH,
                    retryable: false,
                    fallback_suggested: true,
                    priority_impact: PriorityImpact.P1_BLOCKED,
                },
                context: {
                    agent_name: 'MyService',
                    timestamp: new Date().toISOString(),
                },
            };
            return error;
        }
    }
}
```

---

## Phase 5: Agent Error Handling (1-2 hours)

### Update All 18 Agent Files

Update each agent to use StandardErrorResponse in their process() methods:

Files to update:
- `src/agents/orchestrator.ts`
- `src/agents/planning-agent.ts`
- `src/agents/answer-agent.ts`
- `src/agents/verification-agent.ts`
- `src/agents/research-agent.ts`
- `src/agents/clarity-agent.ts`
- `src/agents/boss-agent.ts`
- `src/agents/custom-agent.ts`
- `src/agents/ui-testing-agent.ts`
- `src/agents/observation-agent.ts`
- `src/agents/design-architect-agent.ts`
- `src/agents/gap-hunter-agent.ts`
- `src/agents/design-hardener-agent.ts`
- `src/agents/decision-memory-agent.ts`
- `src/agents/review-agent.ts`
- `src/agents/coding-director-agent.ts`
- `src/agents/backend-architect-agent.ts`
- `src/agents/user-communication-agent.ts`

Each agent should catch LLM errors and transform them to StandardErrorResponse.

---

## Phase 6: Testing (4-6 hours)

### Test Files to Create

1. **tests/types/error-codes.test.ts**
   - Test ErrorCode enum completeness (all 17 codes)
   - Test ERROR_CODE_REGISTRY coverage
   - Test metadata correctness (severity/retryable/priority_impact)

2. **tests/mcp/error-responses.test.ts**
   - Test each MCP tool returns StandardErrorResponse on error
   - Test error code selection logic
   - Test context field population

3. **tests/agents/agent-error-handling.test.ts**
   - Test each agent transforms errors to StandardErrorResponse
   - Test error context includes agent_name
   - Test severity levels propagate correctly

4. **tests/core/service-error-handling.test.ts**
   - Test database service errors
   - Test LLM service errors
   - Test task decomposition errors

5. **tests/integration/error-propagation.test.ts**
   - Test error propagation from Layer 4 → Layer 1
   - Test severity-based UI handling
   - Test retry logic based on retryable flag
   - Test priority_impact workflow effects

### Test Coverage Checklist

- [ ] All 17 ErrorCode values covered by tests
- [ ] Each ErrorSeverity level tested
- [ ] Each PriorityImpact level tested
- [ ] MCP layer error handling (9 tools)
- [ ] Agent layer error handling (18 agents)
- [ ] Service layer error handling (40+ services)
- [ ] Error context population (timestamp, agent_name, task_id, ticket_id)
- [ ] Error propagation through layers

---

## Implementation Checklist

### Code Changes
- [ ] Add ErrorCode enum to types/index.ts
- [ ] Add ErrorSeverity enum to types/index.ts
- [ ] Add PriorityImpact enum to types/index.ts
- [ ] Add StandardErrorResponse interface to types/index.ts
- [ ] Add ERROR_CODE_REGISTRY to types/index.ts
- [ ] Add helper methods to BaseAgent
- [ ] Update MCPServer error handling (9 tools)
- [ ] Update Database service error handling
- [ ] Update LLMService error handling
- [ ] Update all 18 agent error handling
- [ ] Update all core services error handling (40+)

### Testing
- [ ] Create error types unit tests
- [ ] Create MCP error response tests
- [ ] Create agent error handling tests
- [ ] Create service error handling tests
- [ ] Create integration tests for error propagation
- [ ] Verify test coverage > 90%

### Documentation
- [ ] Update CHANGELOG.md
- [ ] Add error handling guide to documentation
- [ ] Document ErrorCode registry usage
- [ ] Document StandardErrorResponse schema

### QA
- [ ] Manual testing of each MCP tool error path
- [ ] Manual testing of each agent error scenario
- [ ] Cross-browser testing (VS Code, webapp)
- [ ] Performance testing (error handling overhead)

---

## Verification Criteria

**Success when:**
1. ✅ All 9 MCP tools return StandardErrorResponse on any error
2. ✅ All 18 agents properly wrap errors in StandardErrorResponse
3. ✅ All core services use StandardErrorResponse for failures
4. ✅ Error context includes: timestamp, agent_name, task_id (if applicable), ticket_id (if applicable)
5. ✅ All 17 ErrorCode values used somewhere in codebase
6. ✅ ERROR_CODE_REGISTRY complete with all metadata
7. ✅ Test coverage ≥ 90% for error handling paths
8. ✅ Integration tests verify error propagation through all layers
9. ✅ No hardcoded error codes (all use ErrorCode enum)
10. ✅ No inconsistent error response formats

---

## Timeline Estimate

| Phase | Task | Hours |
|-------|------|-------|
| 1 | Type definitions | 1-2 |
| 2 | BaseAgent helpers | 1 |
| 3 | MCP Server updates | 2-3 |
| 4 | Core services | 2-3 |
| 5 | Agent updates | 1-2 |
| 6 | Testing | 4-6 |
| **Total** | **Implementation** | **11-17 hours** |

With concurrent work (multiple developers), can be completed in 1-2 days.

---

## Risk Assessment

**Low Risk Areas:**
- Adding new enums to types/index.ts (backward compatible)
- Adding helper methods to BaseAgent (non-breaking)

**Medium Risk Areas:**
- Changing MCP error response formats (may affect external clients)
- Updating all 9 MCP tools (widespread change)

**Mitigation:**
1. Version the error response format (add `version: '1.0'` field)
2. Implement feature flag for StandardErrorResponse adoption
3. Support both old and new formats during transition period
4. Clear deprecation timeline for old format

---

**End of Critical Fix Plan**
