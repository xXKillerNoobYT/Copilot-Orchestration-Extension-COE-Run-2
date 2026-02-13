# Universal Agent Response Schema

**Version**: 1.0  
**Date**: February 5, 2026  
**Status**: Required for LM Studio Integration  
**Purpose**: Single JSON schema shared by ALL agents in COE

---

## Why Universal Schema?

**LM Studio configures structured output at the SERVER level**, not per-request. This architectural constraint means:
- ✅ **ONE schema for all agents** (Planning, Answer, Verification, Clarity, Research, Custom)
- ❌ **NOT** different schemas per agent type
- 🔧 Configured once in LM Studio, applies globally

**Benefits**:
- Simpler LM Studio configuration
- Consistent response format across all agents
- Easier parsing and validation in TypeScript
- Works with simple 7B-14B models (structured output improves reliability)

---

## The Universal Schema

### JSON Schema (for LM Studio)

**Copy-paste into LM Studio Server Settings → Structured Output:**

```json
{
  "type": "object",
  "properties": {
    "response_type": {
      "type": "string",
      "enum": ["planning", "answer", "verification", "clarity", "research", "custom", "error"],
      "description": "Which agent is responding"
    },
    "status": {
      "type": "string",
      "enum": ["success", "needs_clarification", "error", "PASS", "FAIL", "PARTIAL"],
      "description": "Overall status of the response"
    },
    "message": {
      "type": "string",
      "description": "Primary response text (answer, explanation, summary, etc.)"
    },
    "planning_data": {
      "type": "object",
      "properties": {
        "summary": { "type": "string" },
        "steps": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "step_number": { "type": "integer" },
              "action": { "type": "string" },
              "details": { "type": "string" },
              "estimated_minutes": { "type": "integer" }
            },
            "required": ["step_number", "action"]
          }
        },
        "dependencies": {
          "type": "array",
          "items": { "type": "string" }
        }
      }
    },
    "verification_data": {
      "type": "object",
      "properties": {
        "checks": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "criterion": { "type": "string" },
              "passed": { "type": "boolean" },
              "note": { "type": "string" }
            },
            "required": ["criterion", "passed"]
          }
        },
        "suggestions": {
          "type": "array",
          "items": { "type": "string" }
        }
      }
    },
    "clarity_data": {
      "type": "object",
      "properties": {
        "completeness_score": { 
          "type": "integer",
          "minimum": 0,
          "maximum": 100
        },
        "clarity_score": { 
          "type": "integer",
          "minimum": 0,
          "maximum": 100
        },
        "accuracy_score": { 
          "type": "integer",
          "minimum": 0,
          "maximum": 100
        },
        "total_score": { 
          "type": "integer",
          "minimum": 0,
          "maximum": 100
        },
        "follow_up_questions": {
          "type": "array",
          "items": { "type": "string" }
        }
      }
    },
    "research_data": {
      "type": "object",
      "properties": {
        "findings": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "topic": { "type": "string" },
              "description": { "type": "string" },
              "source_file": { "type": "string" },
              "relevance": {
                "type": "string",
                "enum": ["high", "medium", "low"]
              }
            },
            "required": ["topic", "description"]
          }
        },
        "sources": {
          "type": "array",
          "items": { "type": "string" }
        }
      }
    },
    "answer_data": {
      "type": "object",
      "properties": {
        "confidence": {
          "type": "string",
          "enum": ["high", "medium", "low"]
        },
        "sources": {
          "type": "array",
          "items": { "type": "string" }
        },
        "follow_up_needed": { "type": "boolean" }
      }
    },
    "custom_fields": {
      "type": "object",
      "description": "Flexible object for custom agent responses",
      "additionalProperties": true
    },
    "error_details": {
      "type": "object",
      "properties": {
        "error_code": { "type": "string" },
        "error_message": { "type": "string" },
        "suggested_action": { "type": "string" }
      }
    }
  },
  "required": ["response_type", "status", "message"],
  "additionalProperties": false
}
```

### TypeScript Interface (for COE Code)

**Use for type safety in TypeScript:**

```typescript
/**
 * Universal response format for all COE agents.
 * 
 * **Simple explanation**: Like a standardized form where different agents 
 * fill out different sections, but all use the same form template.
 */
export interface UniversalAgentResponse {
  /** Which agent generated this response */
  response_type: 'planning' | 'answer' | 'verification' | 'clarity' | 'research' | 'custom' | 'error';
  
  /** Overall status */
  status: 'success' | 'needs_clarification' | 'error' | 'PASS' | 'FAIL' | 'PARTIAL';
  
  /** Primary response text */
  message: string;
  
  /** Planning-specific data (only populated by Planning Agent) */
  planning_data?: {
    summary: string;
    steps: Array<{
      step_number: number;
      action: string;
      details: string;
      estimated_minutes?: number;
    }>;
    dependencies?: string[];
  };
  
  /** Verification-specific data (only populated by Verification Agent) */
  verification_data?: {
    checks: Array<{
      criterion: string;
      passed: boolean;
      note?: string;
    }>;
    suggestions?: string[];
  };
  
  /** Clarity-specific data (only populated by Clarity Agent) */
  clarity_data?: {
    completeness_score?: number;  // 0-100
    clarity_score?: number;        // 0-100
    accuracy_score?: number;       // 0-100
    total_score?: number;          // 0-100
    follow_up_questions?: string[];
  };
  
  /** Research-specific data (only populated by Research Agent) */
  research_data?: {
    findings: Array<{
      topic: string;
      description: string;
      source_file?: string;
      relevance?: 'high' | 'medium' | 'low';
    }>;
    sources?: string[];
  };
  
  /** Answer-specific data (only populated by Answer Agent) */
  answer_data?: {
    confidence: 'high' | 'medium' | 'low';
    sources?: string[];
    follow_up_needed?: boolean;
  };
  
  /** Custom agent data (flexible structure for user-created agents) */
  custom_fields?: Record<string, unknown>;
  
  /** Error details (only populated when status='error') */
  error_details?: {
    error_code?: string;
    error_message?: string;
    suggested_action?: string;
  };
}
```

### Zod Schema (for Runtime Validation)

**Use for validating LLM responses:**

```typescript
import { z } from 'zod';

export const UniversalAgentResponseSchema = z.object({
  response_type: z.enum(['planning', 'answer', 'verification', 'clarity', 'research', 'custom', 'error']),
  status: z.enum(['success', 'needs_clarification', 'error', 'PASS', 'FAIL', 'PARTIAL']),
  message: z.string(),
  
  planning_data: z.object({
    summary: z.string(),
    steps: z.array(z.object({
      step_number: z.number().int(),
      action: z.string(),
      details: z.string(),
      estimated_minutes: z.number().int().optional()
    })),
    dependencies: z.array(z.string()).optional()
  }).optional(),
  
  verification_data: z.object({
    checks: z.array(z.object({
      criterion: z.string(),
      passed: z.boolean(),
      note: z.string().optional()
    })),
    suggestions: z.array(z.string()).optional()
  }).optional(),
  
  clarity_data: z.object({
    completeness_score: z.number().int().min(0).max(100).optional(),
    clarity_score: z.number().int().min(0).max(100).optional(),
    accuracy_score: z.number().int().min(0).max(100).optional(),
    total_score: z.number().int().min(0).max(100).optional(),
    follow_up_questions: z.array(z.string()).optional()
  }).optional(),
  
  research_data: z.object({
    findings: z.array(z.object({
      topic: z.string(),
      description: z.string(),
      source_file: z.string().optional(),
      relevance: z.enum(['high', 'medium', 'low']).optional()
    })),
    sources: z.array(z.string()).optional()
  }).optional(),
  
  answer_data: z.object({
    confidence: z.enum(['high', 'medium', 'low']),
    sources: z.array(z.string()).optional(),
    follow_up_needed: z.boolean().optional()
  }).optional(),
  
  custom_fields: z.record(z.unknown()).optional(),
  
  error_details: z.object({
    error_code: z.string().optional(),
    error_message: z.string().optional(),
    suggested_action: z.string().optional()
  }).optional()
});

export type UniversalAgentResponse = z.infer<typeof UniversalAgentResponseSchema>;
```

---

## Usage Examples by Agent

### Planning Agent

**Prompt**:
```
You are the Planning Agent. Analyze this request and create an implementation plan.

Request: "Add user authentication to the app"

Respond with JSON:
- response_type: "planning"
- status: "success" or "needs_clarification"
- message: Brief summary
- planning_data: { summary, steps (with step_number, action, details, estimated_minutes) }
```

**Expected Response**:
```json
{
  "response_type": "planning",
  "status": "success",
  "message": "Created 5-step authentication implementation plan",
  "planning_data": {
    "summary": "Implement JWT-based user authentication with email/password",
    "steps": [
      {
        "step_number": 1,
        "action": "Create User database table",
        "details": "Schema: id, email, password_hash, created_at, updated_at",
        "estimated_minutes": 20
      },
      {
        "step_number": 2,
        "action": "Implement password hashing",
        "details": "Use bcrypt with salt rounds=10, hash on user creation",
        "estimated_minutes": 15
      },
      {
        "step_number": 3,
        "action": "Create JWT helper functions",
        "details": "generateToken(), verifyToken() using jsonwebtoken library",
        "estimated_minutes": 25
      },
      {
        "step_number": 4,
        "action": "Build login endpoint",
        "details": "POST /api/auth/login - validates credentials, returns JWT",
        "estimated_minutes": 30
      },
      {
        "step_number": 5,
        "action": "Add authentication middleware",
        "details": "Verify JWT on protected routes, attach user to req.user",
        "estimated_minutes": 20
      }
    ],
    "dependencies": ["database setup", "express server"]
  }
}
```

---

### Answer Agent

**Prompt**:
```
You are the Answer Agent. Answer this question based on the codebase context.

Question: "How does authentication work in this app?"

Context: [relevant code snippets from auth.ts, jwt.ts, etc.]

Respond with JSON:
- response_type: "answer"
- status: "success"
- message: Detailed answer
- answer_data: { confidence, sources, follow_up_needed }
```

**Expected Response**:
```json
{
  "response_type": "answer",
  "status": "success",
  "message": "Authentication uses JWT (JSON Web Tokens) stored in httpOnly cookies. When users log in with email/password, the server validates credentials against the database, then generates a JWT containing the user ID and expiration time. This token is returned in a secure httpOnly cookie. On subsequent requests, the authentication middleware (in src/middleware/auth.ts) verifies the JWT and attaches the user object to the request.",
  "answer_data": {
    "confidence": "high",
    "sources": [
      "src/auth/jwt.ts",
      "src/middleware/auth.ts",
      "src/routes/auth.ts"
    ],
    "follow_up_needed": false
  }
}
```

---

### Verification Agent

**Prompt**:
```
You are the Verification Agent. Check if these acceptance criteria are met.

Criteria:
1. File src/auth/jwt.ts exists
2. Function generateToken() is exported
3. Function verifyToken() is exported
4. Uses jsonwebtoken library

Codebase: [file contents]

Respond with JSON:
- response_type: "verification"
- status: "PASS", "FAIL", or "PARTIAL"
- message: Summary of results
- verification_data: { checks (criterion, passed, note), suggestions }
```

**Expected Response**:
```json
{
  "response_type": "verification",
  "status": "PASS",
  "message": "All 4 acceptance criteria passed",
  "verification_data": {
    "checks": [
      {
        "criterion": "File src/auth/jwt.ts exists",
        "passed": true,
        "note": "Found at src/auth/jwt.ts"
      },
      {
        "criterion": "Function generateToken() is exported",
        "passed": true,
        "note": "Exported on line 15"
      },
      {
        "criterion": "Function verifyToken() is exported",
        "passed": true,
        "note": "Exported on line 28"
      },
      {
        "criterion": "Uses jsonwebtoken library",
        "passed": true,
        "note": "Imported on line 1: import jwt from 'jsonwebtoken'"
      }
    ],
    "suggestions": []
  }
}
```

---

### Clarity Agent

**Prompt**:
```
You are the Clarity Agent. Score this reply on completeness, clarity, and accuracy (0-100 each).

Original Question: "How did you implement the login feature?"

Reply: "I updated the auth file"

Score the reply and generate follow-up questions if score < 85.

Respond with JSON:
- response_type: "clarity"
- status: "needs_clarification" or "success"
- message: Explanation of scores
- clarity_data: { completeness_score, clarity_score, accuracy_score, total_score, follow_up_questions }
```

**Expected Response**:
```json
{
  "response_type": "clarity",
  "status": "needs_clarification",
  "message": "Reply is too vague (total score: 35/100). Missing file name, changes made, and implementation details.",
  "clarity_data": {
    "completeness_score": 20,
    "clarity_score": 40,
    "accuracy_score": 45,
    "total_score": 35,
    "follow_up_questions": [
      "Which specific auth file did you update? (e.g., src/auth/login.ts)",
      "What changes did you make to implement login?",
      "Does the login feature use JWT tokens or sessions?",
      "Are there any new dependencies added?",
      "What testing did you perform?"
    ]
  }
}
```

---

### Research Agent

**Prompt**:
```
You are the Research Agent. Investigate this topic in the codebase.

Topic: "Find all places where database migrations are defined"

Codebase: [relevant files]

Respond with JSON:
- response_type: "research"
- status: "success"
- message: Summary of findings
- research_data: { findings (topic, description, source_file, relevance), sources }
```

**Expected Response**:
```json
{
  "response_type": "research",
  "status": "success",
  "message": "Found 3 database migration locations",
  "research_data": {
    "findings": [
      {
        "topic": "Sequelize Migrations Folder",
        "description": "Primary migration files stored in database/migrations/ directory. Contains 15 migration files using Sequelize syntax.",
        "source_file": "database/migrations/",
        "relevance": "high"
      },
      {
        "topic": "Migration Runner Script",
        "description": "Script to run migrations: scripts/migrate.js. Executes 'sequelize db:migrate' command.",
        "source_file": "scripts/migrate.js",
        "relevance": "high"
      },
      {
        "topic": "Migration Config",
        "description": "Sequelize configuration in config/database.js defines migration table name and path.",
        "source_file": "config/database.js",
        "relevance": "medium"
      }
    ],
    "sources": [
      "database/migrations/",
      "scripts/migrate.js",
      "config/database.js"
    ]
  }
}
```

---

### Custom Agent

**Prompt**:
```
You are a custom Security Analyzer agent. Scan code for security vulnerabilities.

Code: [code to analyze]

Respond with JSON:
- response_type: "custom"
- status: "success"
- message: Summary
- custom_fields: { your custom data structure }
```

**Expected Response**:
```json
{
  "response_type": "custom",
  "status": "success",
  "message": "Security scan complete: Found 3 vulnerabilities (1 critical, 2 medium)",
  "custom_fields": {
    "scan_type": "static_analysis",
    "files_scanned": 12,
    "vulnerabilities": [
      {
        "severity": "critical",
        "type": "SQL Injection",
        "file": "src/api/users.ts",
        "line": 45,
        "description": "User input directly concatenated into SQL query",
        "suggestion": "Use parameterized queries or an ORM"
      },
      {
        "severity": "medium",
        "type": "Hardcoded Secret",
        "file": "src/config/api.ts",
        "line": 12,
        "description": "API key hardcoded in source",
        "suggestion": "Move to environment variable"
      },
      {
        "severity": "medium",
        "type": "Missing Input Validation",
        "file": "src/api/auth.ts",
        "line": 78,
        "description": "Email input not validated before database query",
        "suggestion": "Add email format validation"
      }
    ],
    "scan_duration_ms": 1250,
    "timestamp": "2026-02-05T14:30:00Z"
  }
}
```

---

### Error Response

**When any agent encounters an error:**

```json
{
  "response_type": "error",
  "status": "error",
  "message": "Failed to complete planning due to missing context",
  "error_details": {
    "error_code": "MISSING_CONTEXT",
    "error_message": "Cannot plan without PRD or feature specification",
    "suggested_action": "Provide PRD.json or detailed feature description"
  }
}
```

---

## Validation & Error Handling

### Validating Responses in TypeScript

```typescript
import { UniversalAgentResponseSchema } from './schemas/universalAgentResponse';

async function callAgent(prompt: string): Promise<UniversalAgentResponse> {
  const rawResponse = await llmService.call(prompt);
  
  // Parse JSON
  let parsed;
  try {
    parsed = JSON.parse(rawResponse);
  } catch (error) {
    throw new Error(`LLM returned invalid JSON: ${rawResponse}`);
  }
  
  // Validate against schema
  const result = UniversalAgentResponseSchema.safeParse(parsed);
  
  if (!result.success) {
    throw new Error(`LLM response failed validation: ${result.error.message}`);
  }
  
  return result.data;
}
```

### Handling Different Response Types

```typescript
function handleAgentResponse(response: UniversalAgentResponse): void {
  switch (response.response_type) {
    case 'planning':
      if (response.planning_data) {
        console.log(`Plan: ${response.planning_data.summary}`);
        response.planning_data.steps.forEach(step => {
          console.log(`  ${step.step_number}. ${step.action}`);
        });
      }
      break;
      
    case 'verification':
      if (response.verification_data) {
        const passedCount = response.verification_data.checks.filter(c => c.passed).length;
        console.log(`Passed ${passedCount}/${response.verification_data.checks.length} checks`);
        
        response.verification_data.checks.forEach(check => {
          console.log(`  ${check.passed ? '✓' : '✗'} ${check.criterion}`);
        });
      }
      break;
      
    case 'clarity':
      if (response.clarity_data && response.clarity_data.total_score < 85) {
        console.log(`Clarity score too low: ${response.clarity_data.total_score}/100`);
        console.log('Follow-up questions:');
        response.clarity_data.follow_up_questions?.forEach(q => console.log(`  - ${q}`));
      }
      break;
      
    case 'answer':
      console.log(`Answer (${response.answer_data?.confidence} confidence):`);
      console.log(response.message);
      if (response.answer_data?.sources) {
        console.log('Sources:', response.answer_data.sources.join(', '));
      }
      break;
      
    case 'custom':
      console.log('Custom agent response:', response.custom_fields);
      break;
      
    case 'error':
      console.error(`Agent error: ${response.error_details?.error_message}`);
      console.error(`Suggested action: ${response.error_details?.suggested_action}`);
      break;
  }
}
```

---

## Prompting Best Practices for Structured Output

### ✅ DO: Be Explicit About Schema

```
Respond with JSON matching this structure:
{
  "response_type": "planning",
  "status": "success",
  "message": "summary here",
  "planning_data": {
    "summary": "brief overview",
    "steps": [
      { "step_number": 1, "action": "...", "details": "..." }
    ]
  }
}
```

### ✅ DO: Include Example Responses

```
Example response:
{
  "response_type": "verification",
  "status": "PASS",
  "message": "All 3 checks passed",
  "verification_data": {
    "checks": [
      { "criterion": "File exists", "passed": true, "note": "Found" }
    ]
  }
}
```

### ❌ DON'T: Rely on Implicit Understanding

```
"Just respond in the usual format"  ← Too vague for simple models
```

### ❌ DON'T: Ask for Fields Not in Schema

```
"Include priority and tags"  ← If not in schema, LLM can't add them
```

---

## Integration with PROJECT-BREAKDOWN Tasks

### MT-009.2: LM Studio Connection (Updated)

**New acceptance criteria**:
- Universal schema configured in LM Studio server settings
- All agents receive structured responses matching schema
- Validation layer rejects malformed responses

### MT-011: Clarity Agent (Updated)

**Uses `clarity_data` section**:
- `completeness_score`, `clarity_score`, `accuracy_score`, `total_score`
- `follow_up_questions` array

### MT-012: Planning Team (Updated)

**Uses `planning_data` section**:
- `summary`, `steps` array, `dependencies` array

### MT-014: Answer Team (Updated)

**Uses `answer_data` section**:
- `confidence`, `sources`, `follow_up_needed`

### MT-030: Custom Agents (Updated)

**Uses `custom_fields` object**:
- Flexible structure for user-defined agent responses
- Still validated as valid JSON object

---

## Testing the Schema

### Manual Test with curl

```bash
curl -X POST http://192.168.1.205:1234/v1/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mistralai/ministral-3-14b-reasoning",
    "prompt": "You are a Planning Agent. Create a plan to add user login.\n\nRespond with JSON:\n{\n  \"response_type\": \"planning\",\n  \"status\": \"success\",\n  \"message\": \"Created login implementation plan\",\n  \"planning_data\": {\n    \"summary\": \"...\",\n    \"steps\": [\n      {\"step_number\": 1, \"action\": \"...\", \"details\": \"...\"}\n    ]\n  }\n}",
    "max_tokens": 1000,
    "temperature": 0.2
  }'
```

**Expected**: JSON response matching `planning` schema structure.

### Unit Test

```typescript
describe('Universal Agent Schema', () => {
  it('should validate planning agent response', () => {
    const response = {
      response_type: 'planning',
      status: 'success',
      message: 'Plan created',
      planning_data: {
        summary: 'Implement login',
        steps: [
          { step_number: 1, action: 'Create User table', details: 'Add schema' }
        ]
      }
    };
    
    const result = UniversalAgentResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
  });
  
  it('should reject response with invalid response_type', () => {
    const response = {
      response_type: 'invalid_type',
      status: 'success',
      message: 'Test'
    };
    
    const result = UniversalAgentResponseSchema.safeParse(response);
    expect(result.success).toBe(false);
  });
});
```

---

**Implementation Reference**: See `LM-STUDIO-SETUP.md` for detailed LM Studio configuration instructions.
