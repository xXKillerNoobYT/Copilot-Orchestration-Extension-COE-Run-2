# Security & Authentication Specification

**Version**: 1.0  
**Date**: February 1, 2026  
**Status**: MVP Security Baseline  
**Scope**: Auth, Data Protection, Token Management, Access Control

---

## Overview

This document defines security policies for the COE VS Code extension, focusing on **authentication**, **data protection**, **token management**, and **access control** for MVP deployment.

**Philosophy**: Security by design, not retrofit. Minimal viable security for MVP, with roadmap for production hardening.

---

## Authentication & Token Management

### GitHub OAuth Tokens

**Storage**: VS Code Secrets API (`context.secrets`)

**Approach**:
```typescript
// Store GitHub personal access token
await context.secrets.store('coe.github.token', userToken);

// Retrieve for API calls
const token = await context.secrets.get('coe.github.token');
```

**Benefits**:
- Encrypted at rest (OS-level keychain: macOS Keychain, Windows Credential Manager, Linux libsecret)
- No local file storage of credentials
- Automatic cleanup on extension uninstall

**Token Scopes Required**:
- `repo` (read/write issues, PRs)
- `read:user` (user info for attributions)

**Rotation Policy**:
- MVP: No automatic rotation (user must manual re-auth)
- Post-MVP: Prompt user to rotate tokens every 90 days

**Revocation**: User can revoke via GitHub Settings → Developer Settings → Personal Access Tokens

---

### Copilot API Credentials

**Current State**: Assumed handled by GitHub Copilot extension (no direct management)

**Approach**:
- COE does NOT store Copilot tokens directly
- Relies on Copilot extension's existing auth flow
- MCP calls to Copilot assume authenticated context

**Future**: If direct Copilot API access needed, use `context.secrets` similar to GitHub token

---

## Data at Rest Protection

### SQLite Database Encryption

**MVP State**: **Plaintext storage** (known limitation)

**Justification**: 
- MVP is local-only (no network exposure)
- All data from user's own GitHub repos (user owns data)
- Complexity vs. value trade-off for initial release

**Post-MVP Roadmap**:
1. Integrate SQLite encryption extension (e.g., [sqlcipher](https://www.zetetic.net/sqlcipher/))
2. Encrypt ticket DB + task queue with user-derived key
3. Store encryption key in OS keychain via `context.secrets`

**Recommendation**: Add warning to docs:
> ⚠️ **MVP Limitation**: Ticket and task data stored in plaintext SQLite. Do not store sensitive credentials, API keys, or PII in ticket content. Post-MVP will add encryption.

---

### Sensitive Data Detection (MVP)

**Purpose**: Warn user if they attempt to store sensitive data in tickets/tasks

**Approach**: Heuristic pattern matching on ticket content

**Patterns** (regex-based):
```typescript
const SENSITIVE_PATTERNS = {
  apiKey: /\b(api[_-]?key|token|secret|password)\b.*[:=]\s*['\"]?[\w\-]{16,}['\"]?/i,
  email: /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i,
  phoneNumber: /\b\+?1?\d{3}[-.]?\d{3}[-.]?\d{4}\b/,
  creditCard: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
  sshKey: /-----BEGIN (RSA|OPENSSH) PRIVATE KEY-----/,
  awsKey: /AKIA[0-9A-Z]{16}/
};

async function flagSensitiveContent(content: string): Promise<string[]> {
  const warnings: string[] = [];
  
  for (const [type, pattern] of Object.entries(SENSITIVE_PATTERNS)) {
    if (pattern.test(content)) {
      warnings.push(`Potential ${type} detected`);
    }
  }
  
  return warnings;
}
```

**UI Behavior**:
- If sensitive data detected: Show modal warning
- "This content may contain sensitive data. Are you sure you want to store it?"
- Options: [Continue] [Edit Content] [Cancel]

**Ticket Schema Addition**:
```sql
ALTER TABLE tickets ADD COLUMN has_sensitive_data BOOLEAN DEFAULT 0;
```

If user proceeds despite warning, flag is set to `true` for audit trail.

---

## Input Validation & Sanitization (OWASP Rules)

**Purpose**: Prevent XSS, injection, and malformed data attacks in tickets, MCP payloads, and UI rendering.

### Overview

All user inputs and external data (GitHub Issues, MCP responses, AI-generated content) **MUST** be validated and sanitized before:
1. Storing in database (SQL injection prevention)
2. Displaying in UI (XSS prevention)
3. Passing to MCP tools (command injection prevention)
4. Including in prompts (prompt injection prevention)

### Rule 1: SQL Injection Prevention

**Approach**: Use parameterized queries ONLY — Never string concatenation.

**✅ Good (Parameterized)**:
```typescript
const ticket = await db.get(
  `SELECT * FROM tickets WHERE id = ?`,
  [ticketId]  // Parameterized — safe
);

await db.run(
  `INSERT INTO tickets (title, description) VALUES (?, ?)`,
  [title, description]  // Safe
);
```

**❌ Bad (String Interpolation)**:
```typescript
// NEVER DO THIS - Vulnerable to SQL injection
const ticket = await db.get(
  `SELECT * FROM tickets WHERE id = ${ticketId}`
);
```

### Rule 2: XSS Prevention in UI Rendering

**Approach**: Escape all HTML entities before rendering in webviews or TreeViews.

**Sanitization Function**:
```typescript
function sanitizeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

// Use before rendering
const safeTitle = sanitizeHtml(ticket.title);
treeItem.description = safeTitle;  // Now safe for display
```

**Markdown Rendering**: Use `marked` library with sanitization enabled:
```typescript
import { marked } from 'marked';

marked.setOptions({
  sanitize: true,  // Strip HTML tags
  gfm: true        // GitHub-flavored markdown
});

const safeHtml = marked.parse(ticket.description);
```

### Rule 3: MCP Payload Validation

**Approach**: Validate structure and content before passing to MCP tools.

**Schema Validation**:
```typescript
import Ajv from 'ajv';

const ajv = new Ajv();
const mcpPayloadSchema = {
  type: 'object',
  properties: {
    question: { type: 'string', maxLength: 500 },
    context: { type: 'string', maxLength: 2000 },
    priority: { type: 'string', enum: ['P1', 'P2', 'P3'] }
  },
  required: ['question'],
  additionalProperties: false
};

const validate = ajv.compile(mcpPayloadSchema);

function sanitizeMcpPayload(payload: any): any {
  if (!validate(payload)) {
    throw new Error(`Invalid MCP payload: ${ajv.errorsText(validate.errors)}`);
  }
  
  // Additional sanitization
  return {
    ...payload,
    question: sanitizeHtml(payload.question),
    context: payload.context ? sanitizeHtml(payload.context) : undefined
  };
}
```

### Rule 4: Command Injection Prevention

**Approach**: Never pass user input directly to shell commands. Use allowlists and escaping.

**✅ Good (Allowlist + Escape)**:
```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Use execFile (no shell) instead of exec
const ALLOWED_COMMANDS = ['git', 'npm', 'node'];

async function runSafeCommand(command: string, args: string[]) {
  if (!ALLOWED_COMMANDS.includes(command)) {
    throw new Error(`Command not allowed: ${command}`);
  }
  
  // execFile doesn't use shell — safe from injection
  const { stdout } = await execFileAsync(command, args);
  return stdout;
}
```

**❌ Bad (Shell Injection Vulnerable)**:
```typescript
// NEVER DO THIS
const result = exec(`git commit -m "${userMessage}"`);
// userMessage = '"; rm -rf / #' → deletes system
```

### Rule 5: Prompt Injection Prevention (AI Context)

**Approach**: Clearly demarcate user input from system instructions when building AI prompts.

**Safe Prompt Construction**:
```typescript
function buildSafePrompt(userQuestion: string, codeContext: string): string {
  // Use XML-like tags to isolate user input
  return `
<system>
You are an Answer Team agent. Respond to the question using only the provided code context.
</system>

<code_context>
${sanitizeForPrompt(codeContext)}
</code_context>

<user_question>
${sanitizeForPrompt(userQuestion)}
</user_question>

Provide a concise answer with sources.
`;
}

function sanitizeForPrompt(input: string): string {
  // Escape closing tags to prevent injection
  return input
    .replace(/<\/system>/gi, '&lt;/system&gt;')
    .replace(/<\/code_context>/gi, '&lt;/code_context&gt;')
    .replace(/<\/user_question>/gi, '&lt;/user_question&gt;');
}
```

### Rule 6: Path Traversal Prevention

**Approach**: Validate and sanitize file paths before file system operations.

**Safe Path Validation**:
```typescript
import path from 'path';

function sanitizePath(userPath: string, baseDir: string): string {
  const resolved = path.resolve(baseDir, userPath);
  
  // Ensure resolved path is within baseDir (prevent ../ attacks)
  if (!resolved.startsWith(path.resolve(baseDir))) {
    throw new Error(`Path traversal attempt blocked: ${userPath}`);
  }
  
  return resolved;
}

// Usage
const safeFilePath = sanitizePath(userInput, workspaceRoot);
fs.readFileSync(safeFilePath);  // Now safe
```

### Validation Enforcement Checklist

- [ ] All database queries use parameterized statements
- [ ] All UI text passes through `sanitizeHtml()` before rendering
- [ ] All MCP payloads validated with JSON schema
- [ ] No user input passed directly to shell commands
- [ ] AI prompts use tagged isolation for user content
- [ ] File paths validated against traversal attacks
- [ ] Error messages don't leak sensitive system info

**Reference**: OWASP Top 10 2021 — A03:2021 Injection

---

## Data Retention & Archival

**Ticket Retention Policy** (configurable):
- Active tickets: No limit
- Resolved tickets: Archived after 90 days (move to `tickets_archive` table)
- Archived tickets: Retained for 1 year, then purged

**Config**:
```yaml
data_retention:
  ticket_archive_days: 90       # Days before resolved tickets archived
  ticket_purge_days: 365        # Days before archived tickets deleted
  log_retention_days: 30        # System logs
  pii_detection_enabled: true   # Warn on sensitive content
```

**Archival Process** (runs daily):
```typescript
async function archiveOldTickets() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 90);
  
  const oldTickets = await db.all(
    `SELECT * FROM tickets 
     WHERE status = 'resolved' AND updated_at < ?`,
    [cutoffDate.toISOString()]
  );
  
  // Move to archive table
  for (const ticket of oldTickets) {
    await db.run(`INSERT INTO tickets_archive SELECT * FROM tickets WHERE id = ?`, [ticket.id]);
    await db.run(`DELETE FROM tickets WHERE id = ?`, [ticket.id]);
  }
  
  console.log(`Archived ${oldTickets.length} old tickets`);
}
```

---

## Access Control

### File System Permissions

**Workspace Files**:
- `.coe/` directory: User read/write only (chmod 700)
- `tickets.db`: User read/write only (chmod 600)
- Plan files (`plan.json`, `PRD.md`): User read/write (chmod 644, user can share)

**Enforcement** (on extension activation):
```typescript
import fs from 'fs';

async function secureCoeDirectory() {
  const coePath = path.join(workspaceRoot, '.coe');
  
  // Create .coe if not exists
  if (!fs.existsSync(coePath)) {
    fs.mkdirSync(coePath, { mode: 0o700 });
  } else {
    // Secure existing directory
    fs.chmodSync(coePath, 0o700);
  }
  
  // Secure database
  const dbPath = path.join(coePath, 'tickets.db');
  if (fs.existsSync(dbPath)) {
    fs.chmodSync(dbPath, 0o600);
  }
}
```

---

### Role-Based Access (Future)

**MVP**: Single-user local extension (no roles)

**Post-MVP** (if team features added):
- **Owner**: Full access (create/modify plans, tickets, settings)
- **Contributor**: Can create tickets, view tasks, cannot modify plan
- **Viewer**: Read-only access to dashboard, tickets

**Implementation**: Would require server-side component (out of MVP scope)

---

## Network Security

### GitHub API Calls (HTTPS/TLS)

**Enforcement**: All GitHub API calls use HTTPS (enforced by GitHub API client libraries)

**Certificate Validation**: Enabled by default (Node.js validates TLS certificates)

**No Bypass**: Extension does NOT support `rejectUnauthorized: false` (blocks MITM attacks)

**Rate Limiting**: See [03-Workflow-Orchestration.md › GitHub API Rate Limit Resilience](03-Workflow-Orchestration.md)

---

### MCP Server (stdio Transport)

**Current State**: JSON-RPC over stdio (stdin/stdout)

**Security**:
- No network exposure (local process communication only)
- Isolated to VS Code extension sandbox
- Cannot be accessed by other processes

**Benefits**: No auth needed, no CSRF/XSS risks

**Trade-off**: Can't be accessed remotely (but that's a feature for MVP)

---

## Input Validation & Sanitization

### XSS Prevention (Sidebar WebView)

**Risk**: User-generated ticket content rendered in VS Code webview could contain malicious scripts

**Mitigation**:
```typescript
// Sanitize before rendering in webview
import sanitizeHtml from 'sanitize-html';

function renderTicketContent(rawContent: string): string {
  return sanitizeHtml(rawContent, {
    allowedTags: ['b', 'i', 'em', 'strong', 'code', 'pre', 'p', 'br'],
    allowedAttributes: {}  // No attributes (no onclick, href, etc.)
  });
}
```

**VS Code CSP**: Webview Content Security Policy blocks inline scripts by default

---

### SQL Injection Prevention

**Approach**: Parameterized queries (ALWAYS)

**Example** (SAFE):
```typescript
// ✅ GOOD: Parameterized
const result = await db.run(
  `UPDATE tickets SET status = ? WHERE id = ?`,
  [newStatus, ticketId]
);
```

**Anti-pattern** (UNSAFE):
```typescript
// ❌ BAD: String concatenation (vulnerable!)
const result = await db.run(
  `UPDATE tickets SET status = '${newStatus}' WHERE id = '${ticketId}'`
);
```

**Enforcement**: Lint rule (`no-sql-concat`) in ESLint config

---

## Secrets Management Best Practices

### Do NOT Store in Extension

❌ **Never store**:
- API keys in extension code
- Passwords in config files
- Tokens in plaintext files
- Encryption keys in source code

✅ **Always use**:
- `context.secrets` for sensitive tokens
- Environment variables for dev/test credentials (not committed)
- External key vaults for production (future)

---

### Example: Secure Token Flow

```typescript
class GitHubService {
  constructor(private context: vscode.ExtensionContext) {}
  
  async authenticate() {
    // Check if token exists
    let token = await this.context.secrets.get('coe.github.token');
    
    if (!token) {
      // Prompt user for token
      token = await vscode.window.showInputBox({
        prompt: 'Enter GitHub Personal Access Token',
        password: true,  // Masks input
        placeHolder: 'ghp_...'
      });
      
      if (token) {
        // Store securely
        await this.context.secrets.store('coe.github.token', token);
      }
    }
    
    return token;
  }
  
  async revokeToken() {
    await this.context.secrets.delete('coe.github.token');
    vscode.window.showInformationMessage('GitHub token revoked');
  }
}
```

---

## Security Checklist (MVP Gate)

**Before MVP release, verify**:

- [ ] GitHub tokens stored in `context.secrets` (not files)
- [ ] SQLite file permissions set to 600 (user-only)
- [ ] All SQL queries use parameterized statements (no string concat)
- [ ] Webview content sanitized (no XSS risk)
- [ ] Sensitive data detection warns user (PII, API keys)
- [ ] No credentials committed to git (check `.gitignore`)
- [ ] HTTPS enforced for all GitHub API calls
- [ ] MCP server uses stdio (no network exposure)
- [ ] Data retention policy documented (90-day archive)
- [ ] Security warning in README about plaintext DB (MVP limitation)

---

## Known Limitations (MVP)

1. **Plaintext SQLite**: No encryption at rest (roadmap: post-MVP)
2. **No Token Rotation**: User must manually re-auth (roadmap: auto-prompt every 90 days)
3. **Basic PII Detection**: Regex-based, may have false positives/negatives (roadmap: ML-based detection)
4. **Single-User Only**: No multi-user access control (roadmap: team features)
5. **No Audit Logging**: Changes not logged to immutable log (roadmap: audit trail for compliance)

**Mitigation**: MVP docs clearly state "For personal use only, not recommended for regulated industries (HIPAA, SOC2, etc.)"

---

## Post-MVP Security Roadmap

### Phase 1 (Q2 2026)
- Integrate sqlcipher for DB encryption
- Auto-prompt token rotation every 90 days
- Enhanced PII detection (ML-based)

### Phase 2 (Q3 2026)
- Audit logging system (append-only log)
- Role-based access control (if team features added)
- Security scan integration (Snyk, Dependabot)

### Phase 3 (Q4 2026)
- SOC2 Type II compliance (if enterprise adoption)
- Penetration testing + bug bounty program
- Security incident response plan

---

## References

- VS Code Secrets API: https://code.visualstudio.com/api/references/vscode-api#SecretStorage
- SQLite Security: https://www.sqlite.org/security.html
- sqlcipher: https://www.zetetic.net/sqlcipher/
- OWASP XSS Prevention: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- VS Code Webview Security: https://code.visualstudio.com/api/extension-guides/webview#security
