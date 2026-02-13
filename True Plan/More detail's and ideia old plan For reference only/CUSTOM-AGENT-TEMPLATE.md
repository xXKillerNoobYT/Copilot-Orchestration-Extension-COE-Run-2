# Custom Agent Builder - Template Specification

**Version**: 1.0  
**Date**: February 5, 2026  
**Status**: Draft - Awaiting MT-030 Implementation  
**Purpose**: Complete specification for building custom AI agents with hardlock on coding

---

## Table of Contents

1. [Overview](#overview)
2. [Agent Template Schema](#agent-template-schema)
3. [Hardlock System](#hardlock-system)
4. [Template Sections](#template-sections)
5. [Built-in Templates Library](#built-in-templates-library)
6. [Variable Substitution](#variable-substitution)
7. [Permissions Model](#permissions-model)
8. [Example Templates](#example-templates)

---

## Overview

The Custom Agent Builder allows users to create specialized AI agents for specific tasks **without writing any code**. These agents work with simple 7B-14B models and are designed for:

- **Research & Analysis** - Gathering information from codebase/docs
- **Documentation** - Writing guides, READMEs, API docs
- **Code Review** - Reading code and suggesting improvements (READ-ONLY)
- **Bug Analysis** - Investigating issues, identifying patterns
- **Question Answering** - Domain-specific Q&A

**CRITICAL CONSTRAINT**: Custom agents **CANNOT write/edit code**. This hardlock ensures they:
- Don't accidentally break working code
- Force proper routing to Programming/Planning teams for code changes
- Keep scope limited and predictable
- Work reliably with simple models (no complex multi-step reasoning required)

---

## Agent Template Schema

All custom agents follow this YAML schema:

```yaml
# Agent Metadata (Required)
name: "my-custom-agent"              # Unique identifier, lowercase-kebab-case
display_name: "My Custom Agent"      # Human-readable name
version: "1.0.0"                     # Semantic versioning
author: "username"                   # Creator
description: "Brief description"     # Max 200 chars
tags: ["research", "documentation"]  # For categorization/search

# System Prompt (Required)
system_prompt: |
  You are a specialized agent for {{purpose}}.
  Your role is to {{primary_goal}}.
  
  CONSTRAINTS:
  - You CANNOT write or edit code
  - You CAN read files, search code, and analyze patterns
  - You MUST escalate coding tasks to Programming Team
  
  WORKFLOW:
  {{workflow_steps}}

# Goal List (Required, 1-20 goals)
goals:
  - id: "G1"
    text: "Primary goal description"
    priority: "high"             # high/medium/low
  - id: "G2"
    text: "Secondary goal"
    priority: "medium"

# Checklist (Required, 1-50 items)
checklist:
  - id: "CL1"
    text: "Verify input parameters are valid"
    required: true
  - id: "CL2"
    text: "Check for edge cases"
    required: true
  - id: "CL3"
    text: "Document findings in ticket"
    required: false

# Custom Lists (Optional, up to 7)
custom_lists:
  - name: "Common Patterns"
    description: "Patterns to look for during analysis"
    items:
      - "Repeated code blocks"
      - "Missing error handling"
      - "Undocumented functions"
  
  - name: "Known Issues"
    description: "Issues to flag if found"
    items:
      - "SQL injection vulnerabilities"
      - "Unhandled promise rejections"

# Configuration (Optional)
config:
  model: "ministral-3-14b-reasoning"   # Preferred model
  max_tokens: 2048                     # Max response length
  temperature: 0.2                     # Lower = more consistent
  timeout_seconds: 120                 # Per-request timeout
  max_context_tokens: 4000             # Total context limit
  
# Routing Rules (Optional)
routing:
  keywords:                           # Route if ticket contains these
    - "analyze"
    - "investigate"
    - "explain"
  patterns:                           # Regex patterns
    - "why does .* not work"
  ticket_tags:                        # Route if ticket has these tags
    - "analysis"
    - "research"
  priority: "P1"                      # Agent priority level

# Permissions (Optional, defaults shown)
permissions:
  read_files: true
  search_code: true
  create_tickets: true
  call_llm: true
  access_network: false
  write_files: false                  # ALWAYS false (hardlock)
  execute_code: false                 # ALWAYS false (hardlock)
```

**Validation Rules**:
- `name`: Must be unique, lowercase-kebab-case, max 50 chars
- `goals`: Min 1, max 20, each max 200 chars
- `checklist`: Min 1, max 50, each max 150 chars
- `custom_lists`: Max 7 lists, each list max 100 items
- `system_prompt`: Max 4000 chars
- `permissions.write_files`: Must be false (enforced by hardlock)

---

## Hardlock System

**Purpose**: Prevent custom agents from writing/editing code files to ensure safety and proper workflow routing.

### Blocked Operations

Custom agents **CANNOT** call:
- `create_file`
- `replace_string_in_file`
- `multi_replace_string_in_file`
- `run_in_terminal` (with write operations)
- Any file system write operation

### Allowed Operations

Custom agents **CAN** call:
- `read_file`
- `grep_search`
- `semantic_search`
- `file_search`
- `list_dir`
- `create_ticket` (to escalate coding tasks)

### Error Handling

When a custom agent attempts a blocked operation:

```typescript
{
  "error": {
    "code": "HARDLOCK_VIOLATION",
    "message": "Custom agents cannot write code. This task requires the Programming Team.",
    "suggested_action": "create_ticket",
    "ticket_template": {
      "title": "Code Change Required: {{brief_description}}",
      "type": "feature",
      "priority": "P1",
      "assignedTeam": "Programming",
      "description": "Custom agent {{agent_name}} needs code changes:\n\n{{details}}"
    }
  }
}
```

**User Experience**: Extension shows:
```
⚠️ Code Change Required

The "{{agent_name}}" agent needs to modify code, but custom agents 
are read-only for safety.

A ticket has been created for the Programming Team:
📋 TK-1234: Code Change Required: {{brief_description}}

[View Ticket] [OK]
```

---

## Template Sections

### 1. System Prompt

**Purpose**: Defines agent's role, constraints, and instructions for the LLM.

**Best Practices**:
- Start with role definition ("You are a...")
- State primary constraints clearly
- Use simple, step-by-step instructions (for simple models)
- Include workflow checklist
- Use variable substitution for flexibility

**Example**:
```yaml
system_prompt: |
  You are a Documentation Assistant specialized in writing clear, beginner-friendly guides.
  
  YOUR ROLE:
  - Read existing code and documentation
  - Write new documentation based on code analysis
  - Suggest improvements to existing docs
  - CANNOT modify code (read-only)
  
  WORKFLOW:
  1. Read the file: {{file_path}}
  2. Identify key concepts, functions, classes
  3. Check existing documentation completeness
  4. Write missing documentation sections
  5. Follow checklist: {{checklist}}
  
  OUTPUT FORMAT:
  - Use Markdown
  - Include code examples
  - Add "Simple explanation" for beginners
  - Max 500 words per section
```

### 2. Goal List

**Purpose**: Break down agent's mission into specific, measurable goals.

**Format**:
```yaml
goals:
  - id: "G1"                          # Unique ID (G1-G20)
    text: "Create comprehensive API documentation"
    priority: "high"                  # high/medium/low
    success_criteria: "All public functions have JSDoc with examples"
  
  - id: "G2"
    text: "Identify undocumented edge cases"
    priority: "medium"
    success_criteria: "List 5+ edge cases not mentioned in docs"
```

**Best Practices**:
- Start with 3-5 goals, add more as needed
- Each goal should be testable (clear success criteria)
- Order by priority (high-priority goals first)
- Keep goal text concise but specific

### 3. Checklist

**Purpose**: Step-by-step verification checklist for the agent to follow.

**Format**:
```yaml
checklist:
  - id: "CL1"
    text: "Verify all input parameters are valid"
    required: true                    # Must complete for success
    
  - id: "CL2"
    text: "Check for null/undefined edge cases"
    required: true
    
  - id: "CL3"
    text: "Review error messages for clarity"
    required: false                   # Optional improvement
```

**Best Practices**:
- Start with 5-10 core items
- Mark critical items as `required: true`
- Order by execution sequence
- Be specific (avoid vague items like "check everything")
- Simple models work better with explicit checklists

### 4. Custom Lists

**Purpose**: Flexible lists for domain-specific data that doesn't fit goals/checklist.

**Use Cases**:
- **Common Patterns**: Patterns to detect ("SQL injection", "hardcoded credentials")
- **Known Issues**: Project-specific issues to flag
- **Output Templates**: Structured output formats
- **Reference Data**: URLs, file paths, standard values
- **Examples**: Sample inputs/outputs for testing
- **Exclusions**: Files/patterns to ignore
- **Priorities**: Severity rankings for findings

**Example**:
```yaml
custom_lists:
  - name: "Security Patterns"
    description: "Security issues to detect during code review"
    items:
      - "eval() or Function() calls"
      - "Unvalidated user input in SQL"
      - "Hardcoded API keys or passwords"
      - "Missing input sanitization"
      - "Insecure random number generation"
  
  - name: "Documentation Templates"
    description: "Standard JSDoc sections to include"
    items:
      - "@param {type} name - description"
      - "@returns {type} description"
      - "@throws {ErrorType} when condition"
      - "@example Basic usage: code here"
      - "**Simple explanation**: beginner-friendly analogy"
```

---

## Built-in Templates Library

### 1. Research Assistant

**Purpose**: Investigates questions by reading codebase and docs.

**Specialties**:
- Code structure analysis
- Dependency tracing
- Pattern identification
- Root cause investigation

**Use When**:
- "How does feature X work?"
- "Why is Y happening?"
- "Where is Z implemented?"

### 2. Documentation Writer

**Purpose**: Generates documentation from code analysis.

**Specialties**:
- API documentation
- README generation
- Tutorial writing
- Code commenting

**Use When**:
- Missing documentation
- Onboarding new developers
- Public API needs docs

### 3. Code Reviewer (Read-Only)

**Purpose**: Reviews code for quality, not functionality.

**Specialties**:
- Style consistency
- Best practices
- Performance patterns
- Security issues (detection only)

**Use When**:
- Pre-commit review
- Refactoring suggestions
- Learning feedback

### 4. Bug Analyzer

**Purpose**: Investigates bug reports and finds patterns.

**Specialties**:
- Stack trace analysis
- Error pattern detection
- Reproduction step generation
- Related issue linking

**Use When**:
- Bug investigation
- Pattern analysis
- Root cause identification

### 5. Test Case Suggester

**Purpose**: Suggests test cases based on code analysis (doesn't write tests).

**Specialties**:
- Edge case identification
- Test coverage gaps
- Scenario generation
- Input boundary analysis

**Use When**:
- Planning test suite
- Identifying missing tests
- Review test completeness

---

## Variable Substitution

**Purpose**: Make prompts dynamic and reusable with placeholders.

### Standard Variables

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `{{task_id}}` | Current task ID | `TK-1234` |
| `{{ticket_id}}` | Related ticket ID | `TK-5678` |
| `{{user_query}}` | User's question | `"How does auth work?"` |
| `{{file_path}}` | Target file path | `src/auth/login.ts` |
| `{{selection}}` | Selected code | `function login() {...}` |
| `{{workspace_root}}` | Workspace folder | `/home/user/project` |
| `{{agent_name}}` | Agent's name | `Documentation Writer` |
| `{{timestamp}}` | Current time | `2026-02-05 14:30:00` |

### Custom Variables

Define custom variables in agent config:

```yaml
variables:
  project_name: "My Project"
  coding_standard: "Airbnb JavaScript Style Guide"
  output_format: "Markdown with code examples"
```

Use in prompt:
```yaml
system_prompt: |
  You are reviewing code for {{project_name}}.
  Follow {{coding_standard}}.
  Output in {{output_format}}.
```

### Syntax

```yaml
# Simple substitution
"Hello, {{user_name}}!"

# With default value
"File: {{file_path|unknown}}"

# Conditional (if variable exists)
"{{#has_selection}}Selected: {{selection}}{{/has_selection}}"
```

---

## Permissions Model

**Purpose**: Fine-grained control over agent capabilities.

### Permission Levels

| Permission | Default | Description | Hardlock Override |
|------------|---------|-------------|-------------------|
| `read_files` | `true` | Can call read_file, list_dir | No |
| `search_code` | `true` | Can call grep_search, semantic_search | No |
| `create_tickets` | `true` | Can create new tickets | No |
| `call_llm` | `true` | Can make LLM requests | No |
| `access_network` | `false` | Can make HTTP requests | No |
| `write_files` | `false` | Can call create_file, replace_string | **YES - Always false** |
| `execute_code` | `false` | Can run terminal commands | **YES - Always false** |

### Hardlock Enforcement

These permissions are **ALWAYS false** for custom agents, regardless of config:

```yaml
permissions:
  write_files: false      # ⚠️ Cannot be changed
  execute_code: false     # ⚠️ Cannot be changed
```

Any attempt to set these to `true` will:
1. Show validation error in UI
2. Reject save operation
3. Log security warning

**Rationale**:
- **Safety**: Prevents accidental code corruption
- **Workflow**: Forces proper routing (custom agents → Programming Team)
- **Simplicity**: Simple models shouldn't make complex code changes
- **Testing**: Easier to test when scope is limited

---

## Example Templates

### Example 1: Security Analyzer

```yaml
name: "security-analyzer"
display_name: "Security Pattern Analyzer"
version: "1.0.0"
author: "security-team"
description: "Detects common security anti-patterns in code (read-only)"
tags: ["security", "code-review", "analysis"]

system_prompt: |
  You are a Security Pattern Analyzer specialized in detecting security issues.
  
  YOUR ROLE:
  - Read code files and identify security anti-patterns
  - Flag potential vulnerabilities
  - Suggest security improvements
  - CANNOT modify code (read-only)
  
  WORKFLOW:
  1. Read file: {{file_path}}
  2. Check each pattern from "Security Patterns" list
  3. For each match, create detailed finding
  4. Rate severity: Critical/High/Medium/Low
  5. Suggest mitigation (but don't implement)
  
  OUTPUT:
  - List all findings with line numbers
  - Explain why each is a security risk
  - Suggest fix (escalate implementation to Programming Team)

goals:
  - id: "G1"
    text: "Identify all SQL injection risks"
    priority: "high"
  - id: "G2"
    text: "Find hardcoded credentials"
    priority: "high"
  - id: "G3"
    text: "Detect missing input validation"
    priority: "medium"

checklist:
  - id: "CL1"
    text: "Check for eval() or Function() usage"
    required: true
  - id: "CL2"
    text: "Verify all user inputs are validated"
    required: true
  - id: "CL3"
    text: "Look for hardcoded secrets"
    required: true
  - id: "CL4"
    text: "Check error messages don't leak sensitive info"
    required: true

custom_lists:
  - name: "Security Patterns"
    description: "Patterns that indicate security issues"
    items:
      - "eval() or new Function()"
      - "innerHTML without sanitization"
      - "Unvalidated req.query or req.params in SQL"
      - "process.env in client-side code"
      - "Hardcoded passwords, API keys, tokens"
      - "Math.random() for crypto/security"
  
  - name: "Severity Ratings"
    description: "How to rate severity of findings"
    items:
      - "Critical: Direct exploit possible (SQL injection)"
      - "High: Major data leak risk (exposed credentials)"
      - "Medium: Exploitable with effort (missing CSP)"
      - "Low: Best practice violation (weak hash)"

config:
  model: "ministral-3-14b-reasoning"
  max_tokens: 2048
  temperature: 0.1                    # Very consistent for security
  timeout_seconds: 120

routing:
  keywords: ["security", "vulnerability", "exploit", "sanitize"]
  ticket_tags: ["security", "audit"]
  priority: "P0"                      # Security is always high priority

permissions:
  read_files: true
  search_code: true
  create_tickets: true
  call_llm: true
  access_network: false               # No external calls
  write_files: false                  # Hardlock enforced
  execute_code: false                 # Hardlock enforced
```

### Example 2: API Documentation Generator

```yaml
name: "api-doc-generator"
display_name: "API Documentation Generator"
version: "1.0.0"
author: "docs-team"
description: "Generates comprehensive API documentation from code"
tags: ["documentation", "api", "reference"]

system_prompt: |
  You are an API Documentation Generator.
  
  YOUR ROLE:
  - Read API endpoint code
  - Generate OpenAPI/Swagger documentation
  - Write clear descriptions and examples
  - CANNOT modify code (read-only)
  
  WORKFLOW:
  1. Read file: {{file_path}}
  2. Identify all exported functions/classes
  3. Extract parameters, return types, errors
  4. Generate documentation sections:
     - Description (what it does)
     - Parameters (each param documented)
     - Returns (what it returns)
     - Errors (what can go wrong)
     - Example (working code sample)
     - Simple Explanation (beginner-friendly)
  5. Output in {{output_format}}
  
  QUALITY CHECKLIST:
  {{checklist}}

goals:
  - id: "G1"
    text: "Document all public API endpoints"
    priority: "high"
  - id: "G2"
    text: "Provide working code examples"
    priority: "high"
  - id: "G3"
    text: "Include beginner explanations"
    priority: "medium"

checklist:
  - id: "CL1"
    text: "Every parameter has type and description"
    required: true
  - id: "CL2"
    text: "Return value is documented with type"
    required: true
  - id: "CL3"
    text: "All possible errors are listed"
    required: true
  - id: "CL4"
    text: "Example code is complete and runnable"
    required: true
  - id: "CL5"
    text: "Simple explanation uses analogy or metaphor"
    required: false

custom_lists:
  - name: "Documentation Sections"
    description: "Required sections for each endpoint"
    items:
      - "## Description"
      - "## Parameters"
      - "## Returns"
      - "## Errors"
      - "## Example"
      - "## Simple Explanation"
  
  - name: "Example Templates"
    description: "Code example patterns"
    items:
      - "// Example: Basic usage"
      - "// Example: With error handling"
      - "// Example: Advanced usage"

variables:
  output_format: "Markdown"
  style_guide: "Google Developer Documentation Style Guide"

config:
  model: "ministral-3-14b-reasoning"
  max_tokens: 3000                    # Longer for detailed docs
  temperature: 0.3
  timeout_seconds: 180

routing:
  keywords: ["document", "api", "endpoint", "reference"]
  patterns: ["how to use", "api docs"]
  ticket_tags: ["documentation", "api"]
  priority: "P1"

permissions:
  read_files: true
  search_code: true
  create_tickets: true
  call_llm: true
  access_network: false
  write_files: false                  # Hardlock
  execute_code: false                 # Hardlock
```

---

## Implementation Checklist (for MT-030)

- [ ] Schema validation with Zod (MT-030.1)
- [ ] Hardlock enforcement (MT-030.2)
- [ ] Template editor UI (MT-030.3)
- [ ] System prompt editor (MT-030.4)
- [ ] Goal list manager (MT-030.5)
- [ ] Checklist manager (MT-030.6)
- [ ] Custom lists (up to 7) (MT-030.7)
- [ ] Agent metadata (MT-030.8)
- [ ] Storage system (MT-030.9)
- [ ] Execution framework (MT-030.10)
- [ ] Test mode (MT-030.11)
- [ ] Templates library (MT-030.12)
- [ ] Variable substitution (MT-030.13)
- [ ] Versioning (MT-030.14)
- [ ] Activation/deactivation (MT-030.15)
- [ ] Routing rules (MT-030.16)
- [ ] Performance metrics (MT-030.17)
- [ ] Sharing/export (MT-030.18)
- [ ] Permissions model (MT-030.19)
- [ ] Context limits (MT-030.20)
- [ ] Agent gallery (MT-030.21)
- [ ] Comprehensive tests (MT-030.22)

---

**Next Steps**: Implement MT-030 tasks to bring this specification to life!
