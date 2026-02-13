# MCP askQuestion Payloads Reference
**Version**: 1.0  
**Date**: January 20, 2026  
**Source**: AI Teams Documentation v2.2  
**Purpose**: Standardized payload examples for the `askQuestion` MCP tool

---

## Overview

The `askQuestion` MCP tool is the primary mechanism for the Coding AI (GitHub Copilot) to request clarification, research, or delegation when encountering ambiguities during implementation. This document provides realistic, high-quality sample payloads that improve debugging, training, testing, and documentation clarity.

---

## Current Implementation (MT-001.4) ✅

**File**: `src/mcpServer/tools/askQuestion.ts` (Completed Feb 3, 2026)

The current implementation supports a simplified payload while keeping the full schema above as the long-term goal.

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
  ticketId?: string; // Created on timeout
  error?: {
    code: string;    // ANSWER_TIMEOUT | INTERNAL_ERROR
    message: string;
  };
}
```

**Timeout Behavior:**
- If the Answer Agent takes longer than **45 seconds**, a ticket is created automatically.
- The response includes `ticketId` and an `ANSWER_TIMEOUT` error.

**Test Coverage:**
- ✅ 7 tests in `tests/mcpServer/tools/askQuestion.spec.ts`
- Covers validation, success, timeout ticket creation, and failure paths

**Note**: The payload examples below represent the full target schema. The current implementation will be expanded in later stages.

---

## Recommended Payload Schema

All `askQuestion` calls should follow this structure:

```json
{
  "question": "string – clear, specific question",
  "context_summary": "string – 1-2 sentence summary of current task & progress",
  "current_file": "string – relative path or null",
  "relevant_snippets": [
    { 
      "file": "string", 
      "line_start": "number", 
      "line_end": "number", 
      "content": "string (50-150 lines max)" 
    }
  ],
  "plan_references": [
    { 
      "section": "string", 
      "quote": "string or null" 
    }
  ],
  "task_id": "string",
  "confidence_level": "number (0–100 – how sure the Coding AI is)",
  "possible_options": ["string", "string"] | null,
  "priority_level": "integer (1-3, default: 2)"
}
```

### Token Impact
- Typical payload: 400-800 tokens (question + snippets)
- Keep snippets under 2000 tokens total
- Priority-aware: P1 questions get immediate routing

---

## Category 1: Architectural / Technology Choice Ambiguity

**When to Use**: Plan mentions a technology but doesn't specify implementation approach or provider.

### Example: Authentication Provider Selection

```json
{
  "question": "Which authentication provider and flow should be used for user login? The plan mentions JWT but does not specify whether we should use a third-party service (Auth0, Firebase, Supabase), self-hosted with bcrypt + refresh tokens, or another approach.",
  "context_summary": "Currently implementing POST /auth/login endpoint in src/routes/auth.ts. Task requires secure password-based login with token return.",
  "current_file": "src/routes/auth.ts",
  "relevant_snippets": [
    {
      "file": "docs/architecture.md",
      "line_start": 45,
      "line_end": 52,
      "content": "Authentication: Use JWT tokens for session management. Tokens expire after 15 minutes. Refresh tokens stored in httpOnly cookies."
    }
  ],
  "plan_references": [
    { 
      "section": "Security → Authentication", 
      "quote": "Use JWT tokens for session management." 
    }
  ],
  "task_id": "task-0789",
  "confidence_level": 35,
  "possible_options": [
    "A) Self-hosted: bcrypt hash + JWT (access + refresh)",
    "B) Third-party: Auth0 with OAuth2 Authorization Code + PKCE",
    "C) Supabase Auth (PostgreSQL-based, includes JWT out of box)"
  ],
  "priority_level": 1
}
```

---

## Category 2: Naming / Structure / Convention Uncertainty

**When to Use**: Plan describes what to create but folder structure and naming conventions are ambiguous.

### Example: Service Class Location & Naming

```json
{
  "question": "What naming convention and folder location should be used for the new UserService class? Should it be services/user.service.ts, domain/user/UserService.ts, features/user/user.service.ts, or another structure? Also, should the class be named UserService, UserDomainService, or IUserService?",
  "context_summary": "Task is to create service layer logic for user creation and profile updates.",
  "current_file": null,
  "relevant_snippets": [],
  "plan_references": [
    { 
      "section": "Project Structure", 
      "quote": "Use domain-driven structure where appropriate." 
    }
  ],
  "task_id": "task-0912",
  "confidence_level": 45,
  "possible_options": [
    "A) src/services/user.service.ts – UserService",
    "B) src/domain/user/UserService.ts – UserService",
    "C) src/features/user/services/user.service.ts – UserService"
  ],
  "priority_level": 2
}
```

---

## Category 3: Acceptance Criteria Interpretation

**When to Use**: Acceptance criteria seem partially conflicting or vague.

### Example: Conflicting Response Requirements

```json
{
  "question": "The acceptance criteria state both 'return 201 Created with user object' and 'return minimal user data for security'. Which fields should be included in the response body? Full profile or only id, email, createdAt?",
  "context_summary": "Finishing POST /users endpoint. Already implemented user creation in database.",
  "current_file": "src/controllers/users.controller.ts",
  "relevant_snippets": [
    {
      "file": "tasks/task-0789.md",
      "line_start": 12,
      "line_end": 18,
      "content": "- Return 201 Created\n- Return user object in body\n- Do not expose password or sensitive fields"
    }
  ],
  "plan_references": [],
  "task_id": "task-0789",
  "confidence_level": 60,
  "possible_options": null,
  "priority_level": 1
}
```

---

## Category 4: Error / Test Failure Interpretation

**When to Use**: Test is failing but root cause is unclear from the error message.

### Example: Unexpected Test Status Code

```json
{
  "question": "Test 'should reject duplicate email' is failing with 'Expected status 409 but got 201'. However the code correctly checks for existing email and throws ConflictException. Why is the status not being set to 409? Is the exception filter not catching it correctly?",
  "context_summary": "Writing user registration e2e test suite. Failing on duplicate email scenario.",
  "current_file": "test/e2e/users.e2e-spec.ts",
  "relevant_snippets": [
    {
      "file": "src/filters/conflict.exception-filter.ts",
      "line_start": 8,
      "line_end": 15,
      "content": "@Catch(ConflictException)\nexport class ConflictExceptionFilter implements ExceptionFilter { ... status: 409 ... }"
    }
  ],
  "plan_references": [],
  "task_id": "task-1123",
  "confidence_level": 25,
  "possible_options": [
    "A) Exception filter is not registered globally",
    "B) NestJS version mismatch in testing module",
    "C) Wrong import path for ConflictException"
  ],
  "priority_level": 1
}
```

---

## Category 5: Design System / UI Guideline Question

**When to Use**: Implementing a UI component but styling rules are ambiguous.

### Example: Button Styling Clarification

```json
{
  "question": "For the primary Submit button in the new user form, should we use bg-primary-600 hover:bg-primary-700 (from design-system.json) or bg-blue-600 hover:bg-blue-700? Also, should padding be py-3 px-6 or py-2.5 px-5?",
  "context_summary": "Creating <Button variant=\"primary\">Submit</Button> in registration form.",
  "current_file": "src/components/Button.tsx",
  "relevant_snippets": [
    {
      "file": "design-system.json",
      "line_start": 23,
      "line_end": 28,
      "content": "\"primary\": { \"bg\": \"bg-primary-600\", \"hover\": \"hover:bg-primary-700\", \"padding\": \"py-3 px-6\" }"
    }
  ],
  "plan_references": [
    { 
      "section": "UI Components", 
      "quote": "All buttons must follow design-system.json tokens." 
    }
  ],
  "task_id": "task-1456",
  "confidence_level": 70,
  "possible_options": null,
  "priority_level": 2
}
```

---

## Integration with Answer Team

### Routing Logic
- **Low confidence (<50%)**: Immediate routing to Answer Team, highest queue priority
- **Medium confidence (50-75%)**: Normal queue, may trigger Researcher if Answer Team uncertain
- **High confidence (>75%)**: Logged but low urgency, may batch with other questions

### Priority Awareness
- **P1 questions**: Bypass queue, Answer Team responds immediately
- **P2 questions**: Normal queue flow
- **P3 questions**: Batched, processed during idle time

### Researcher Integration
If Answer Team cannot resolve (confidence <0.7), escalates to Researcher Team for documentation scraping and solution research.

---

## Best Practices for Coding AI

1. **Always include task_id** for proper tracking
2. **Provide context_summary** even if brief
3. **Keep snippets focused** (50-150 lines each, max 3-4 snippets)
4. **List possible_options** when you see multiple valid paths (helps Answer Team provide targeted response)
5. **Set confidence_level honestly** (triggers appropriate urgency)
6. **Reference PRD sections** in plan_references when available
7. **Use priority_level** to signal urgency (P1 for blocking issues)

---

## Recommended Next Steps

1. Add this document to `05-MCP-API-Reference.md` as Appendix A
2. Create JSON schema file → `schemas/askQuestion.payload.schema.json`
3. Add 8-12 integration tests validating these payload shapes
4. Update Coding AI prompt template to reference these examples explicitly
5. Add to Stage 1 (F037) implementation milestone

---

**End of askQuestion Payloads Reference**
