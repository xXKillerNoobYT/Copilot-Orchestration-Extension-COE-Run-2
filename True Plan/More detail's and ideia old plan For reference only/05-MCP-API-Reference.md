# COE MCP API Reference

**Version**: 1.0  
**Date**: January 17, 2026  
**Status**: Draft  
**Protocol**: Model Context Protocol (MCP) v1.0  
**Cross-References**: [Master Plan](PROJECT-BREAKDOWN%20&%20TODO%20List%20.md), [Architecture](01-Architecture-Document.md), [Workflows](03-Workflow-Orchestration.md)

---

## Overview

This document provides complete API specifications for all MCP (Model Context Protocol) tools used by the Copilot Orchestration Extension. These tools enable GitHub Copilot and other coding agents to interact with the planning and orchestration system.

---

## Transport & Protocol

### Transport Layer
- **Protocol**: JSON-RPC 2.0
- **Transport**: Stdio (stdin/stdout)
- **Encoding**: UTF-8
- **Message Format**: Newline-delimited JSON

### Tool Registration

Tool registration is centralized in:

- **`src/mcpServer/integration.ts`**

The registry provides:
- A single source of truth for MCP tool names
- Startup logging of available tools
- Integration tests to verify required tools are registered

Current registered tools:
`getNextTask`, `reportTaskDone`, `askQuestion`

### JSON-RPC Message Handling

JSON-RPC parsing and validation lives in:

- **`src/mcpServer/jsonrpc.ts`**

Responsibilities:
- Parse raw JSON (single or batch)
- Validate JSON-RPC 2.0 structure
- Emit standard errors (`-32700` parse error, `-32600` invalid request)
- Provide helper for creating error responses

**Example: Single Request**
```json
{"jsonrpc":"2.0","method":"getNextTask","id":1}
```

**Example: Batch Request**
```json
[
  {"jsonrpc":"2.0","method":"getNextTask","id":1},
  {"jsonrpc":"2.0","method":"askQuestion","params":{"question":"What now?"},"id":2}
]
```

**Example: Invalid Request Error**
```json
{"jsonrpc":"2.0","id":1,"error":{"code":-32600,"message":"Invalid Request: method must be a string"}}
```

### Server Lifecycle

#### File Structure

The MCP server is organized into a modular structure:

- **`src/mcpServer/server.ts`**: Contains the `MCPServer` class responsible for:
  - JSON-RPC 2.0 message parsing and routing
  - Method handlers for `getNextTask`, `reportTaskDone`, `askQuestion`, and `callCOEAgent`
  - Request validation and error handling
  - Response/error formatting
  - Graceful shutdown handlers (SIGINT/SIGTERM)
  
- **`src/mcpServer/index.ts`**: Provides the singleton pattern and exports:
  - `initializeMCPServer()`: Creates and starts the server instance
  - `getMCPServerInstance()`: Returns the server instance (for testing)
  - `resetMCPServerForTests()`: Stops and clears the server instance
  - Standalone mode support with graceful shutdown handlers

#### Graceful Shutdown

The MCP server now registers process handlers for:
- **SIGINT** (Ctrl+C)
- **SIGTERM** (process termination)

On shutdown it:
1. Stops listening to stdin
2. Unregisters signal handlers
3. Logs shutdown messages for debugging

#### Initialization in Extension

```typescript
// Server starts on extension activation (src/extension.ts)
import { initializeMCPServer } from './mcpServer';

export function activate(context: vscode.ExtensionContext) {
  // ... other initialization ...
  
  // Start MCP server after Orchestrator is ready
  initializeMCPServer();
  
  // ... rest of activation ...
}
```

#### Standalone Mode

To run the MCP server as a standalone process:

```bash
npm run compile
node out/mcpServer/index.js
```

The server will:
- Start listening for JSON-RPC 2.0 requests on stdin
- Output logs to stderr (so stdout is reserved for JSON-RPC responses)
- Handle SIGINT (Ctrl+C) and SIGTERM signals for graceful shutdown
- Log startup messages indicating standalone mode

**Use cases for standalone mode:**
- Testing the MCP protocol independently
- Debugging server behavior without VS Code
- Integration testing with external tools
- Running the MCP server as a service

**Note**: In standalone mode, orchestrator services must be initialized separately for full functionality.

#### Graceful Shutdown

```typescript
// Automatic shutdown handlers in standalone mode
process.on('SIGINT', () => {
  logInfo('Received SIGINT, shutting down gracefully...');
  resetMCPServerForTests();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logInfo('Received SIGTERM, shutting down gracefully...');
  resetMCPServerForTests();
  process.exit(0);
});
```

---

## Tool 1: getNextTask

### Purpose
Retrieve the next available task from the queue with full context and plan references.

### Method
`getNextTask`

### Request Parameters
```typescript
interface GetNextTaskRequest {
  filter?: 'ready' | 'blocked' | 'all';       // Optional: Queue filter
  priority?: 'critical' | 'high' | 'medium' | 'low';  // Optional: Priority filter
  includeContext?: boolean;                    // Default: true
  includeDetailedPrompt?: boolean;             // Default: true
  includeRelatedFiles?: boolean;               // Default: true
}
```

### Response
```typescript
interface GetNextTaskResponse {
  success: boolean;
  task: Task | null;
  queueLength: number;
  nextTasksPreview: TaskPreview[];
}

interface Task {
  // Identification
  taskId: string;
  title: string;
  description: string;
  
  // Classification
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending' | 'ready' | 'in-progress' | 'done' | 'blocked';
  
  // Dependencies
  dependencies: string[];
  blockedBy: string[];
  relatedTasks: string[];
  
  // Super-Detailed Prompt (for AI guidance)
  superDetailedPrompt?: {
    description: string;
    context: string;
    requirements: string[];
    designReferences: {
      fromPlan: string;
      colorPalette?: Record<string, any>;
      typography?: Record<string, any>;
      accessibilityNotes?: string;
      [key: string]: any;
    };
    files: {
      readFrom: string[];
      writeTo: string[];
      referencedIn: string[];
    };
    acceptanceCriteria: string[];
    estimatedHours: number;
    complexityLevel: 'easy' | 'medium' | 'hard' | 'expert';
    skillsRequired: string[];
  };
  
  // Plan Reference
  planReference: {
    planId: string;
    version: string;
    affectedSections: string[];
  };
  
  // Estimation
  estimatedHours: number;
  actualHours?: number;
}

interface TaskPreview {
  id: string;
  title: string;
  priority: string;
}
```

### Request Example
```json
{
  "jsonrpc": "2.0",
  "method": "getNextTask",
  "params": {
    "filter": "ready",
    "priority": "high",
    "includeContext": true,
    "includeDetailedPrompt": true,
    "includeRelatedFiles": true
  },
  "id": 1
}
```

### Response Example (Success)
```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "task": {
      "taskId": "TASK-001",
      "title": "Implement color palette system",
      "description": "Create CSS variables and design tokens from design-system.json",
      "priority": "high",
      "status": "ready",
      "dependencies": [],
      "blockedBy": [],
      "relatedTasks": ["TASK-002", "TASK-003"],
      "superDetailedPrompt": {
        "description": "Create CSS variables for the complete color palette",
        "context": "This is the foundation for theming - all components depend on this",
        "requirements": [
          "Define 12 primary colors with 3 variants each (light/medium/dark)",
          "Each color must support light AND dark theme auto-switching",
          "Colors must meet WCAG AA contrast ratios (4.5:1 minimum)",
          "Must work with accessibility tools (color-blind friendly)"
        ],
        "designReferences": {
          "fromPlan": "Docs/Plans/my-app/design-system.json colors section",
          "colorPalette": {
            "primary": {
              "light": "#E3F2FD",
              "medium": "#2196F3",
              "dark": "#1565C0"
            },
            "secondary": {
              "light": "#F3E5F5",
              "medium": "#9C27B0",
              "dark": "#6A1B9A"
            }
          },
          "accessibilityNotes": "Avoid pure red/green - 8% of males have red-green color blindness"
        },
        "files": {
          "readFrom": ["Docs/Plans/my-app/design-system.json"],
          "writeTo": ["src/styles/colors.css", "src/styles/_variables.scss"],
          "referencedIn": ["src/App.vue", "tailwind.config.js"]
        },
        "acceptanceCriteria": [
          "All 12 colors defined with 3 variants each",
          "CSS variables output: --color-primary-light, --color-primary-medium, --color-primary-dark",
          "SCSS variables mirror CSS for Sass compilation",
          "Light mode colors render correctly",
          "Dark mode colors render correctly with inversion",
          "All colors meet WCAG AA contrast (verified with tool)",
          "No colors use pure red/green (colorblind-safe)",
          "Can toggle theme in browser dev tools"
        ],
        "estimatedHours": 2.5,
        "complexityLevel": "medium",
        "skillsRequired": ["CSS", "Color theory", "Accessibility (WCAG)"]
      },
      "planReference": {
        "planId": "my-app",
        "version": "1.0.0",
        "affectedSections": ["Color & Theme", "Accessibility"]
      },
      "estimatedHours": 2.5
    },
    "queueLength": 34,
    "nextTasksPreview": [
      { "id": "TASK-002", "title": "Build page navigation component", "priority": "high" },
      { "id": "TASK-003", "title": "Create task list UI", "priority": "medium" }
    ]
  },
  "id": 1
}
```

### Response Example (No Tasks Available)
```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "task": null,
    "queueLength": 0,
    "nextTasksPreview": []
  },
  "id": 1
}
```

### Error Codes
- `400` - Invalid filter or priority value
- `500` - Internal server error
- `503` - Task queue unavailable

### Error Injection Test Specification (MVP)

**Purpose**: Validate error handling for MCP tools under failure conditions

**Test File**: `tests/mcp-tools.error.test.ts`

**Error Cases for Critical Tools**:

#### Tool: createTicket

| Error Scenario | Trigger | Expected Response | Recovery |
|---|---|---|---|
| **DB Locked** | 2 agents write simultaneously | `{ code: 'DB_LOCKED', retryable: true, retry_after_seconds: 2 }` | Retry with exponential backoff (max 5x) |
| **Invalid Input** | Missing required field `title` | `{ code: 'INVALID_PARAM', retryable: false, details: { field: 'title', reason: 'required' } }` | Reject, log error |
| **DB Unavailable** | Database connection fails | `{ code: 'RESOURCE_NOT_FOUND', retryable: true, fallback_suggested: true }` | Use in-memory fallback + warn user |

**Test Example**:
```typescript
describe('createTicket error injection', () => {
  test('DB_LOCKED: retry on simultaneous write', async () => {
    // Mock DB to reject with LOCKED error 3 times
    mockDb.onWrite()
      .onCallThrow(new Error('SQLITE_BUSY'))
      .onCallThrow(new Error('SQLITE_BUSY'))
      .onCallThrow(new Error('SQLITE_BUSY'))
      .onCall(() => ({ id: 'TK-123' }));
    
    const result = await mcp.createTicket({ title: 'Test' });
    
    expect(result.success).toBe(true);
    expect(result.ticket.id).toBe('TK-123');
    expect(mockDb.write).toHaveBeenCalledTimes(4);  // 3 failures + 1 success
  });
});
```

#### Tool: reportTaskStatus

| Error Scenario | Trigger | Expected Response |Recovery |
|---|---|---|---|
| **Task Not Found** | Invalid `task_id` | `{ code: 'RESOURCE_NOT_FOUND', retryable: false }` | Log error, continue |
| **Invalid State** | Status = 'invalid_value' | `{ code: 'INVALID_PARAM', retryable: false, details: { field: 'status' } }` | Reject, validate in client |
| **Cascaded Failure** | Ticket update fails → task unblock fails | `{ success: false, error: { code: 'INTERNAL_ERROR' }, cascaded: { ticketsResolved: 0, tasksUnblocked: 0 } }` | Rollback ticket changes, retry |

#### Tool: askQuestion

| Error Scenario | Trigger | Expected Response | Recovery |
|---|---|---|---|
| **Timeout** (Answer Team unavailable) | No response after 30s | `{ code: 'TIMEOUT', retryable: true, fallback_suggested: true, retry_after_seconds: 10 }` | Create user ticket instead |
| **Token Limit** (question context too large) | Question + context > 80% of limit | `{ code: 'TOKEN_LIMIT_EXCEEDED', retryable: false, fallback_suggested: true }` | Reject, suggest shorter context |
| **Invalid Question** | Message malformed JSON | `{ code: 'INVALID_PARAM', retryable: false }` | Parse error, reject |

**Test Example**:
```typescript
test('askQuestion: timeout after 30s → suggest ticket fallback', async () => {
  mockAnswerTeam.delay = 35 * 1000;  // Simulate 35 sec delay
  
  const result = await mcp.askQuestion({
    question: 'Should we use X or Y?',
    context: { taskId: 'TASK-001' }
  });
  
  expect(result.error.code).toBe('TIMEOUT');
  expect(result.fallback_suggested).toBe(true);
  expect(result.error.message).toContain('Create ticket');
});
```

**Test Coverage Target**: Each critical tool has ≥3 error injection tests (error case + recovery)

### Current Implementation (MT-001.2) ✅

**File**: `src/mcpServer/tools/getNextTask.ts` (Completed Feb 3, 2026)

The current implementation provides a simplified but functional version:

**Actual Parameters:**
```typescript
interface GetNextTaskParams {
  filter?: 'ready' | 'blocked' | 'all';  // Default: 'ready'
  includeContext?: boolean;               // Default: true
}
```

**Actual Response Structure:**
```typescript
interface GetNextTaskResponse {
  success: boolean;
  task: Task | null;        // Task from orchestrator
  queueStatus?: {
    isEmpty: boolean;
    message?: string;
  };
  error?: {
    code: string;           // INVALID_FILTER, ORCHESTRATOR_NOT_INITIALIZED, INTERNAL_ERROR
    message: string;
  };
}
```

**JSON-RPC Response (backward compatible):**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "id": "TASK-001",
    "ticketId": "TICKET-001",
    "title": "Implement feature X",
    "status": "pending",
    "createdAt": "2026-02-03T12:00:00Z"
  }
}
```

**Features Implemented:**
- ✅ Parameter validation with detailed error messages
- ✅ Filter support (ready/blocked/all)
- ✅ Context inclusion/exclusion
- ✅ Empty queue handling
- ✅ Orchestrator error handling
- ✅ Backward compatible responses (returns just task data)

**Test Coverage:**
- ✅ 23 comprehensive tests (all passing)
- ✅ Parameter validation (10 tests)
- ✅ Task retrieval (4 tests)
- ✅ Filter handling (3 tests)
- ✅ Error handling (3 tests)
 ✅ Edge cases (3 tests)

**Note**: The full specification above represents the planned enhanced version. The current implementation provides core functionality and will be extended in future iterations to match the complete specification.

---

## Tool 2: reportTaskDone

### Purpose
Report task completion with rich status details, testing results, and follow-up observations.

### Method
`reportTaskDone`

### Current Implementation (MT-001.3) ✅

**File**: `src/mcpServer/tools/reportTaskDone.ts` (Completed Feb 3, 2026)

The current implementation provides core functionality:

**Actual Parameters:**
```typescript
interface ReportTaskDoneParams {
  taskId: string;
  status: 'done' | 'failed' | 'blocked' | 'partial';
  taskDescription?: string;
  codeDiff?: string;   // Optional: triggers verification
  notes?: string;
}
```

**Actual Response Structure:**
```typescript
interface ReportTaskDoneResponse {
  success: boolean;
  taskId: string;
  status: string;
  message: string;
  verification?: {
    passed: boolean;
    explanation: string;
  };
  error?: {
    code: string;       // TASK_NOT_FOUND, INTERNAL_ERROR
    message: string;
  };
}
```

**Features Implemented:**
- ✅ Validates parameters (taskId/status)
- ✅ Ensures task exists before update
- ✅ Updates ticket status (done/blocked/in-progress)
- ✅ Appends report notes to description
- ✅ Triggers Verification Agent when codeDiff provided
- ✅ Marks task blocked if verification fails

**Test Coverage:**
- ✅ 11 comprehensive tests in `tests/mcpServer/tools/reportTaskDone.spec.ts`

**Note**: The full specification below represents the planned enhanced version. The current implementation provides core functionality and will be expanded in later stages.

### Request Parameters
```typescript
interface ReportTaskDoneRequest {
  taskId: string;
  status: 'done' | 'failed' | 'blocked' | 'partial';
  
  // Status Details
  statusDetails?: {
    progressPercent?: number;      // 0-100 for partial completion
    blockedReason?: string;        // Why task is blocked
    failureReason?: string;        // What went wrong
    partiallyDone?: string;        // What's complete vs incomplete
  };
  
  // Implementation Notes
  implementationNotes?: string;
  filesModified?: string[];
  
  // Testing
  testing?: {
    testsAdded: boolean;
    testFileCreated?: string;
    testsPassed: boolean;
    testsFailed: number;
    testCoveragePercent?: number;
    failedTestNames?: string[];
    accessibilityTestsPassed?: boolean;
  };
  
  // Acceptance Criteria Verification
  acceptanceCriteriaVerification?: {
    [criterionIndex: number]: {
      text: string;
      status: 'passed' | 'failed' | 'not-applicable';
    };
  };
  
  // Follow-ups
  followUpTasks?: {
    title: string;
    why: string;
    estimatedHours?: number;
  }[];
  
  // Observations
  observations?: string[];
}
```

### Response
```typescript
interface ReportTaskDoneResponse {
  success: boolean;
  taskId: string;
  status: string;
  message: string;
  
  // Verification
  verificationTaskCreated?: {
    taskId: string;
    title: string;
    why: string;
    automationLevel: string;
  };
  
  // Observations Processed
  observationsProcessed?: {
    observationId: string;
    observation: string;
    status: string;
    suggestedFollowUp?: string;
  }[];
  
  // Next Task
  nextTaskId?: string;
  nextTaskPreview?: {
    title: string;
    priority: string;
  };
  
  // Dashboard Update
  dashboardUpdate?: {
    completedCount: number;
    totalCount: number;
    percentComplete: number;
    blockedCount: number;
    verificationPendingCount: number;
  };
}
```

### Request Example
```json
{
  "jsonrpc": "2.0",
  "method": "reportTaskDone",
  "params": {
    "taskId": "TASK-001",
    "status": "done",
    "implementationNotes": "Created CSS variables for all colors. Implemented light/dark theme toggle using CSS custom properties.",
    "filesModified": [
      "src/styles/colors.css",
      "src/styles/_variables.scss"
    ],
    "testing": {
      "testsAdded": true,
      "testFileCreated": "src/styles/colors.test.ts",
      "testsPassed": true,
      "testsFailed": 0,
      "testCoveragePercent": 92,
      "accessibilityTestsPassed": true
    },
    "acceptanceCriteriaVerification": {
      "0": { "text": "All 12 colors defined with 3 variants", "status": "passed" },
      "1": { "text": "CSS variables output correctly", "status": "passed" },
      "2": { "text": "WCAG AA contrast verified", "status": "passed" }
    },
    "observations": [
      "Found that HSL is better than HEX for theme switching",
      "Need to add color utility functions for blending"
    ],
    "followUpTasks": [
      {
        "title": "Test colors in real components",
        "why": "Need to verify colors work in actual component rendering",
        "estimatedHours": 1
      }
    ]
  },
  "id": 2
}
```

### Response Example
```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "taskId": "TASK-001",
    "status": "done",
    "message": "Task marked complete. 33 ready tasks, 2 blocked, 1 verification task created",
    "verificationTaskCreated": {
      "taskId": "TASK-VERIFY-001",
      "title": "Verify color palette in components",
      "why": "Ensure colors display correctly in real UI components",
      "automationLevel": "semi-automated - agent will check, human reviews if needed"
    },
    "observationsProcessed": [
      {
        "observationId": "OBS-001",
        "observation": "Found that HSL is better than HEX for theme switching",
        "status": "noted",
        "suggestedFollowUp": "Document color format best practices"
      }
    ],
    "nextTaskId": "TASK-002",
    "nextTaskPreview": {
      "title": "Build page navigation component",
      "priority": "high"
    },
    "dashboardUpdate": {
      "completedCount": 1,
      "totalCount": 35,
      "percentComplete": 2.9,
      "blockedCount": 2,
      "verificationPendingCount": 1
    }
  },
  "id": 2
}
```

### Error Codes
- `404` - Task not found
- `400` - Invalid status value
- `409` - Task already marked as done
- `500` - Internal server error

---

## Tool 3: askQuestion

### Purpose
Query the Answer Team for context-aware answers from plan and codebase.

### Method
`askQuestion`

### Current Implementation (MT-001.4) ✅

**File**: `src/mcpServer/tools/askQuestion.ts` (Completed Feb 3, 2026)

**Actual Parameters:**
```typescript
interface AskQuestionParams {
  question: string;
  chatId?: string;
}
```

**Actual Response Structure:**
```typescript
interface AskQuestionResponse {
  success: boolean;
  answer?: string;
  ticketId?: string;
  error?: {
    code: string;    // ANSWER_TIMEOUT | INTERNAL_ERROR
    message: string;
  };
}
```

**Timeout Behavior:**
- 45-second timeout using Promise.race
- On timeout, creates a ticket and returns `ANSWER_TIMEOUT`

**Test Coverage:**
- ✅ 7 tests in `tests/mcpServer/tools/askQuestion.spec.ts`

**Note**: The detailed schema below represents the planned full version.

### Request Parameters
```typescript
interface AskQuestionRequest {
  question: string;
  context?: string;
  currentTaskId?: string;
  searchInPlan?: string;           // Optional: search term or section
  includeRelatedDecisions?: boolean;  // Default: true
}
```

### Response
```typescript
interface AskQuestionResponse {
  success: boolean;
  question: string;
  answerFromPlan?: string;
  confidence: number;  // 0.0 - 1.0
  
  // Evidence
  evidence?: {
    source: string;
    planVersion: string;
    section: string;
    exactQuote?: string;
    lineNumbers?: number[];
  };
  
  // Guidance
  guidance?: {
    implementation?: string;
    animation?: string;
    accessibility?: string;
    examples?: Record<string, string>;
  };
  
  // Related Context
  relatedDesignChoices?: string[];
  relatedDecisions?: Decision[];
  
  // Uncertainty
  uncertainty?: string;  // Explanation if confidence < 0.7
}
```

### Request Example
```json
{
  "jsonrpc": "2.0",
  "method": "askQuestion",
  "params": {
    "question": "Should sidebar collapse on mobile?",
    "context": "Working on Navigation component, unsure about responsive behavior",
    "currentTaskId": "TASK-003",
    "searchInPlan": "responsive-design|mobile",
    "includeRelatedDecisions": true
  },
  "id": 3
}
```

### Response Example (High Confidence)
```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "question": "Should sidebar collapse on mobile?",
    "answerFromPlan": "Yes, sidebar should collapse to hamburger menu on screens < 768px",
    "confidence": 0.98,
    "evidence": {
      "source": "Docs/Plans/my-app/plan.json",
      "planVersion": "1.0.0",
      "section": "designChoices.navigationStyle",
      "exactQuote": "Sidebar collapses to hamburger menu on mobile (< 768px breakpoint)",
      "lineNumbers": [45, 48]
    },
    "guidance": {
      "implementation": "Use media query @media (max-width: 768px) to toggle sidebar visibility",
      "animation": "Collapse with 200ms slide-out animation using CSS transition",
      "accessibility": "Ensure hamburger button has aria-label and aria-expanded attributes",
      "examples": {
        "mediaQuery": "@media (max-width: 768px) { .sidebar { display: none; } }",
        "jsToggle": "document.querySelector('[aria-label=\"Menu\"]').onclick = () => sidebar.classList.toggle('visible')"
      }
    },
    "relatedDesignChoices": [
      "Page Layout: Sidebar Navigation (persistent on desktop)",
      "Breakpoints: Mobile 0-767px, Tablet 768px-1023px, Desktop 1024px+",
      "Animation: All transitions use 200ms timing function"
    ]
  },
  "id": 3
}
```

### Response Example (Low Confidence)
```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "question": "What animation library should I use?",
    "confidence": 0.35,
    "uncertainty": "The plan doesn't specify which animation library to use. This decision might need to be made based on your team's preference or project requirements.",
    "guidance": {
      "implementation": "Common options: Framer Motion, GSAP, or CSS transitions. Consider asking the user or checking existing codebase for patterns."
    }
  },
  "id": 3
}
```

### Error Codes
- `400` - Empty question
- `404` - Current task not found
- `500` - Internal server error

---

## Tool 4: reportObservation

### Purpose
Report discoveries, issues, or new work identified during task execution.

### Method
`reportObservation`

### Request Parameters
```typescript
interface ReportObservationRequest {
  taskId: string;
  observation: string;
  type: 'discovery' | 'issue' | 'improvement' | 'dependency' | 'test-failure' | 'architecture-concern';
  severity: 'critical' | 'high' | 'medium' | 'low';
  
  details?: {
    what: string;
    why: string;
    impact: string;
    suggestedAction: string;
  };
  
  relatedToTask?: string;
  createNewTask?: boolean;
  newTaskDetails?: {
    title: string;
    priority: string;
    estimatedHours: number;
  };
  
  attachedFiles?: string[];
  references?: string[];
}
```

### Response
```typescript
interface ReportObservationResponse {
  success: boolean;
  observationId: string;
  observation: string;
  type: string;
  severity: string;
  status: 'logged' | 'task-created';
  
  newTaskCreated?: {
    taskId: string;
    title: string;
    priority: string;
    addedToQueue: boolean;
    position: string;
  };
  
  dashboardAlert?: {
    message: string;
    timestamp: string;
    visible: boolean;
  };
}
```

### Request Example
```json
{
  "jsonrpc": "2.0",
  "method": "reportObservation",
  "params": {
    "taskId": "TASK-001",
    "observation": "Found that HSL color format is better for theme switching than HEX",
    "type": "discovery",
    "severity": "medium",
    "details": {
      "what": "HSL colors allow easier manipulation of lightness for dark mode",
      "why": "Current implementation uses HEX, making theme switching complex",
      "impact": "More maintainable theming system if we switch to HSL",
      "suggestedAction": "Refactor color system to use HSL format"
    },
    "createNewTask": true,
    "newTaskDetails": {
      "title": "Refactor color format from HEX to HSL",
      "priority": "medium",
      "estimatedHours": 3
    },
    "references": ["https://developer.mozilla.org/en-US/docs/Web/CSS/color_value"]
  },
  "id": 4
}
```

### Response Example
```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "observationId": "OBS-001",
    "observation": "Found that HSL color format is better for theme switching than HEX",
    "type": "discovery",
    "severity": "medium",
    "status": "task-created",
    "newTaskCreated": {
      "taskId": "TASK-089",
      "title": "Refactor color format from HEX to HSL",
      "priority": "medium",
      "addedToQueue": true,
      "position": "after current task dependencies"
    },
    "dashboardAlert": {
      "message": "New observation: HSL format discovery",
      "timestamp": "2026-01-17T14:32:00Z",
      "visible": true
    }
  },
  "id": 4
}
```

---

## Tool 5: reportTestFailure

### Purpose
Report test failures and request investigation tasks.

### Method
`reportTestFailure`

### Request Parameters
```typescript
interface ReportTestFailureRequest {
  taskId: string;
  testName: string;
  testFile: string;
  
  failureDetails: {
    error: string;
    failingColor?: any;
    expectedValue?: any;
    actualValue?: any;
    failedAssertion?: string;
  };
  
  previousStatus: 'passing_before' | 'never_passed' | 'flaky';
  context?: string;
  causePossibility?: string[];
  needsInvestigation: boolean;
  actionNeeded: string;
}
```

### Response
```typescript
interface ReportTestFailureResponse {
  success: boolean;
  testFailureId: string;
  testName: string;
  status: 'failure_logged';
  
  blockingTask?: {
    blockingTaskId: string;
    message: string;
  };
  
  investigationTaskCreated?: {
    taskId: string;
    title: string;
    priority: 'critical';
    blocker: boolean;
    details: string;
    addedToQueue: boolean;
    position: 'immediate (highest priority)';
  };
  
  suspectedRootCauseAnalysis?: {
    likeliestCause: string;
    suggestedInvestigation: string[];
  };
  
  dashboardAlert?: {
    type: 'critical';
    message: string;
    timestamp: string;
    requiresHumanAttention: boolean;
  };
}
```

---

## Tool 6: reportVerificationResult

### Purpose
Report results of verification/testing tasks.

### Method
`reportVerificationResult`

### Request Parameters
```typescript
interface ReportVerificationResultRequest {
  verificationTaskId: string;
  originalTaskId: string;
  verificationStatus: 'passed' | 'failed' | 'partial' | 'needs-manual-review';
  
  verification: {
    checklist: {
      item: string;
      status: 'passed' | 'failed' | 'skipped';
      note?: string;
    }[];
    
    failedItems?: {
      item: string;
      issue: string;
      why: string;
    }[];
    
    summary: string;
  };
  
  originalTaskStatus: 'done' | 'done_but_incomplete' | 'needs_rework';
  suggestedActions?: string[];
}
```

### Response
```typescript
interface ReportVerificationResultResponse {
  success: boolean;
  verificationTaskId: string;
  verificationStatus: string;
  originalTaskStatus: string;
  message: string;
  
  issuesFound?: {
    issueId: string;
    title: string;
    relatedComponents: string[];
    severity: string;
  }[];
  
  followUpTasksCreated?: {
    taskId: string;
    title: string;
    relatedTo: string;
    priority: string;
  }[];
  
  originalTaskMarked: string;
  blockerCleared: boolean;
  
  dashboardUpdate?: {
    message: string;
    issuesCount: number;
    followUpTasksCount: number;
  };
}
```

---

## Error Handling

### Standard Error Response
```typescript
interface ErrorResponse {
  jsonrpc: '2.0';
  error: {
    code: number;
    message: string;
    data?: any;
  };
  id: number | string | null;
}
```

### Error Codes
| Code | Message | Description |
|------|---------|-------------|
| -32700 | Parse error | Invalid JSON |
| -32600 | Invalid Request | Missing required fields |
| -32601 | Method not found | Unknown tool name |
| -32602 | Invalid params | Parameter validation failed |
| -32603 | Internal error | Server-side error |
| 400 | Bad Request | Invalid parameter values |
| 404 | Not Found | Resource not found (task, plan, etc.) |
| 409 | Conflict | State conflict (e.g., task already done) |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Server Error | Unexpected server error |
| 503 | Service Unavailable | Server temporarily unavailable |

### Error Example
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": 404,
    "message": "Task not found",
    "data": {
      "taskId": "TASK-999",
      "suggestion": "Check if task ID is correct or if task has been deleted"
    }
  },
  "id": 2
}
```

---

## Rate Limiting

### Limits
- **Per Agent**: 100 requests per minute
- **Global**: 500 requests per minute
- **Burst**: Up to 10 requests per second for short bursts

### Rate Limit Headers (HTTP transport)
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1642435200
```

---

## Testing

### Example Test (Jest)
```typescript
describe('MCP getNextTask', () => {
  it('should return next ready task', async () => {
    const request = {
      jsonrpc: '2.0',
      method: 'getNextTask',
      params: { filter: 'ready', priority: 'high' },
      id: 1
    };
    
    const response = await mcpServer.handle(request);
    
    expect(response.result.success).toBe(true);
    expect(response.result.task).toBeTruthy();
    expect(response.result.task.status).toBe('ready');
    expect(response.result.task.priority).toBe('high');
  });
  
  it('should return null when no tasks available', async () => {
    // Empty queue
    taskQueue.clear();
    
    const request = {
      jsonrpc: '2.0',
      method: 'getNextTask',
      params: {},
      id: 2
    };
    
    const response = await mcpServer.handle(request);
    
    expect(response.result.success).toBe(true);
    expect(response.result.task).toBeNull();
    expect(response.result.queueLength).toBe(0);
  });
});
```

---

## Tool Versions & Error Handling (v3.9+)

### askQuestion (v1.2)

**Purpose**: Request clarification on ambiguous directives

**Enhanced Parameters**:
```json
{
  "question": {"type": "string", "maxLength": 300, "required": true},
  "context_summary": {"type": "string", "required": true},
  "current_file": {"type": ["string", "null"]},
  "relevant_snippets": {"type": "array", "maxLength": 2000, "items": {"file": "string", "content": "string"}},
  "task_id": {"type": "string", "required": true},
  "confidence_level": {"type": "integer", "minimum": 0, "maximum": 100},
  "priority_level": {"type": "integer", "enum": [1, 2, 3], "default": 2},
  "possible_options": {"type": ["array", "null"], "items": "string"}
}
```

**Returns**:
```json
{
  "answer": "string",
  "source": ["string", "null"],
  "confidence": "integer (0-100)",
  "follow_up_needed": "boolean",
  "escalated_to_user": "boolean"
}
```

**Error Responses**:
```json
{
  "success": false,
  "error": {
    "code": "TOKEN_LIMIT_EXCEEDED | TIMEOUT | INVALID_STATE",
    "message": "string",
    "severity": "HIGH | MEDIUM",
    "retryable": true,
    "priority_impact": "P1_BLOCKED | P2_DELAYED",
    "retry_after_seconds": 10
  }
}
```

**Token Impact**: ~400-800 tokens added  
**Copilot Compat**: `/agent call MCP askQuestion {json_props}`

### reportTaskCompleted (v1.2)

**Purpose**: Signal task completion with metrics

**Parameters**:
```json
{
  "task_id": {"type": "string", "required": true},
  "status": {"type": "string", "enum": ["success", "partial", "failed"], "required": true},
  "output_summary": {"type": "string", "maxLength": 500},
  "files_modified": {"type": "array", "items": "string"},
  "coverage_percent": ["number", "null"],
  "test_results": {"passed": "integer", "failed": "integer"},
  "priority_completed": {"type": "integer", "enum": [1, 2, 3]}
}
```

**Returns**:
```json
{
  "acknowledged": true,
  "next_task_suggested": ["string", "null"]
}
```

**Token Impact**: ~200-500  
**Copilot Compat**: `/agent call MCP reportTaskCompleted {json_props}`

### reportObservation (v1.1)

**Purpose**: Log non-urgent insights (async, queued)

**Parameters**:
```json
{
  "observation": {"type": "string", "maxLength": 1000, "required": true},
  "category": {"type": "string", "enum": ["optimization", "potential_bug", "style_note", "docs_improvement", "other"]},
  "priority": {"type": "integer", "enum": [1, 2, 3], "default": 3},
  "task_id": "string",
  "file_path": ["string", "null"]
}
```

**Returns**:
```json
{
  "logged": true,
  "observation_id": "string"
}
```

**Token Impact**: ~150-300  
**Copilot Compat**: `/agent call MCP reportObservation {json_props}`

### reportIssue (v1.1)

**Purpose**: Flag blocking or concerning issues

**Parameters**:
```json
{
  "issue_description": {"type": "string", "maxLength": 800, "required": true},
  "severity": {"type": "integer", "enum": [1, 2, 3], "description": "1=critical", "required": true},
  "task_id": "string",
  "file_path": ["string", "null"],
  "repro_steps": "string",
  "immediate": {"type": "boolean", "default": false}
}
```

**Returns**:
```json
{
  "logged": true,
  "escalated": "boolean"
}
```

**Error Codes**: INVALID_PARAM, RATE_LIMIT  
**Token Impact**: ~250-600  
**Copilot Compat**: `/agent call MCP reportIssue {json_props}`

### getImmediateAnswer (v1.0)

**Purpose**: Synchronous call for urgent clarifications (blocks caller)

**Parameters**:
```json
{
  "query": {"type": "string", "maxLength": 400, "required": true},
  "context_bundle": {"type": "object"},
  "max_wait_seconds": {"type": "integer", "default": 30}
}
```

**Returns**:
```json
{
  "answer": "string",
  "source": ["string", "null"],
  "timeout": "boolean"
}
```

**Error Codes**: TIMEOUT (HIGH severity, no retry)  
**Token Impact**: ~500-1200  
**Copilot Compat**: `/agent call MCP getImmediateAnswer {json_props}`

### reportTaskStatus (v1.3)

**Purpose**: Rich in-progress status updates with metrics

**Parameters** (Expanded):
```json
{
  "task_id": {"type": "string", "required": true},
  "status": {"type": "string", "enum": ["in_progress", "blocked", "done", "failed", "paused"]},
  "progress_percent": {"type": "integer", "minimum": 0, "maximum": 100},
  "details": {"type": "string", "maxLength": 600},
  "metrics": {
    "tokens_used": "integer",
    "time_seconds": "number",
    "coverage_added": "number"
  },
  "priority": {"type": "integer", "enum": [1, 2, 3]}
}
```

**Returns**:
```json
{
  "acknowledged": true,
  "next_action": ["string", "null"],
  "cascaded": {
    "ticketsResolved": {"type": "integer", "description": "Count of tickets closed (when task status=done)"},
    "tasksUnblocked": {"type": "integer", "description": "Count of dependent tasks moved to ready queue"}
  }
}
```

**Cascaded Fields** (NEW in v1.3):
- `cascaded.ticketsResolved`: When task marked done, count any linked investigation tickets that auto-close
- `cascaded.tasksUnblocked`: When ticket resolved, count tasks that transition from blocked→ready

**Example Response**:
```json
{
  "acknowledged": true,
  "next_action": "continue",
  "cascaded": {
    "ticketsResolved": 1,
    "tasksUnblocked": 1
  }
}
```

**Token Impact**: ~300-700  
**Copilot Compat**: `/agent call MCP reportTaskStatus {json_props}`

---

## Global Error Response Schema (v4.0+)

**All tools return standardized error schema on failure**:

```json
{
  "success": false,
  "error": {
    "code": "string",
    "message": "string",
    "details": ["object", "null"],
    "severity": "enum (LOW | MEDIUM | HIGH | CRITICAL)",
    "retryable": "boolean",
    "retry_after_seconds": ["integer", "null"],
    "fallback_suggested": "boolean",
    "priority_impact": "enum (NONE | P3_IGNORABLE | P2_DELAYED | P1_BLOCKED)",
    "log_level": "enum (DEBUG | INFO | WARN | ERROR)"
  },
  "context": {
    "task_id": ["string", "null"],
    "agent_name": ["string", "null"],
    "timestamp": "string (ISO 8601)"
  }
}
```

---

## Error Codes Reference

See `Docs/ERROR-HANDLING.md` for complete error codes registry with:
- All error code definitions (INVALID_PARAM, TOKEN_LIMIT_EXCEEDED, TIMEOUT, etc.)
- Severity levels and escalation paths
- Retry guidance and fallback strategies
- User-facing message templates
- Integration with backup system and context breaking

---

## Security

### Authentication
- MCP server runs locally (no network exposure)
- No authentication required for localhost stdio transport
- Future: OAuth tokens for remote MCP servers

### Authorization
- Tool calls validated against agent permissions
- Read-only tools: `askQuestion`, `getNextTask`
- Write tools: `reportTaskDone`, `reportObservation`, etc.
- Admin tools: (future) `clearQueue`, `resetPlan`

### Input Validation
- All parameters validated against schema
- SQL injection prevention (no SQL used)
- Path traversal prevention (file paths validated)
- XSS prevention (output sanitized)

---

## Performance Benchmarks

| Operation | Target | Current |
|-----------|--------|---------|
| getNextTask | <100ms | ~80ms |
| reportTaskDone | <200ms | ~150ms |
| askQuestion | <500ms | ~300ms |
| reportObservation | <100ms | ~90ms |

---

## Changelog

### v1.0.0 (2026-01-17)
- Initial MCP API specification
- 6 core tools defined
- JSON-RPC 2.0 over stdio transport

---

## References

- [MCP Protocol Specification](https://github.com/modelcontextprotocol/specification)
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)
- [Master Plan](PROJECT-BREAKDOWN%20&%20TODO%20List%20.md)
- [Architecture Document](01-Architecture-Document.md)
- [Agent Role Definitions](02-Agent-Role-Definitions.md)

**Document Status**: Complete  
**Next Review**: After MCP server implementation  
**Owner**: Plan Master Agent + Development Team
