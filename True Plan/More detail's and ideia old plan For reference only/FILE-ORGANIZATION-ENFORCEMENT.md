# File Organization & Enforcement Rules

**Mandatory structure for keeping the COE project clean and navigable**

**Version**: 1.0  
**Date**: January 27, 2026  
**Status**: Active enforcement policy  

---

## 🎯 Purpose

This plan defines **where files belong** and **how to keep folders clean**. It enforces a minimalist approach to prevent project bloat and ensures developers (especially noobs) can find documentation quickly.

**Golden Rule**: Every file has ONE correct home. If it doesn't belong, archive it or delete it.

---

## 📁 Folder Structure & Purposes

### Root Folder (`./`) — **Exceptions Only**

**Purpose**: Essential project files ONLY (no junk!)

**Allowed Files**:
```
./
├── PRD.md              # Product Requirements Document (source of truth)
├── PRD.json            # Generated from PRD.ipynb
├── PRD.ipynb           # Source notebook (edits go here)
├── package.json        # Node.js dependencies
├── tsconfig.json       # TypeScript configuration
├── jest.config.js      # Test configuration
├── jest.setup.js       # Test setup
├── README.md           # Project overview
├── LICENSE             # License file
├── CHANGELOG.md        # Version history
├── .gitignore          # Git ignore rules
├── .eslintrc.json      # Linting rules
└── ... (build configs) # webpack.config.js, etc.
```

**NOT Allowed** (move to proper folders):
- ❌ Temporary code files (.ts, .js) → Move to `src/`
- ❌ Documentation (.md except PRD/README/CHANGELOG) → Move to `docs/` or `Plans/`
- ❌ Test files → Move to `tests/`
- ❌ Status reports → Move to `Status/`
- ❌ Archives → Move to `Status/archive/`
- ❌ Build outputs → Add to `.gitignore`

**Enforcement**: Run cleanup check before committing P1 tasks.

---

### `Plans/` — **Architecture & Technical Specifications**

**Purpose**: **Source of truth** for system architecture, agent roles, workflows, specifications.

**What Belongs Here**:
- ✅ Architecture documents (01-Architecture-Document.md, etc.)
- ✅ Agent role definitions (02-Agent-Role-Definitions.md, etc.)
- ✅ System specifications (TICKET-SYSTEM-SPECIFICATION.md, etc.)
- ✅ Workflow diagrams (AI-USE-SYSTEM-DIAGRAMS.md, etc.)
- ✅ Planning philosophies (MODULAR-EXECUTION-PHILOSOPHY.md, etc.)
- ✅ Master plans (CONSOLIDATED-MASTER-PLAN.md, etc.)
- ✅ Breakdown plans for complex features (e.g., Plans/mcp-server-breakdown.md)

**What Does NOT Belong Here**:
- ❌ Usage guides (those go in `docs/`)
- ❌ Status reports (those go in `Status/`)
- ❌ Code examples (those go in `docs/` with links to Plans)
- ❌ Temporary notes (create issue or add to `Status/current-plan.md`)

**Editing Rules**:
- **DON'T edit Plans/** unless working on a feature that requires plan updates
- **DO reference Plans/** from other docs (don't duplicate content)
- **DO create new plan files** for complex feature breakdowns (20+ min work)
- **DO keep Plans/README.md** updated as index

---

### `docs/` — **Usage Guides & Quick References**

**Purpose**: **How-to guides** for developers. Auto-updated during feature work.

**What Belongs Here**:
- ✅ Feature usage guides (mcp-tools-reference.md, testing-guide.md, etc.)
- ✅ Quick references (atomic-task-self-test.md, task-breakdown-workflow.md, etc.)
- ✅ Implementation guides (debug-guide.md, llm-configuration-guide.md, etc.)
- ✅ Workflow tutorials (task-rollback-recovery.md, breaking-down-tasks-examples.md, etc.)

**What Does NOT Belong Here**:
- ❌ Architecture specs (those go in `Plans/`)
- ❌ Status logs (those go in `Status/`)
- ❌ API specifications (those go in `Plans/COE-Master-Plan/`)

**Auto-Update Rule**:
- **WHEN**: After completing feature that affects user-facing functionality
- **HOW**: Update relevant guide in `docs/` (or create new guide if needed)
- **EXAMPLE**: Implementing new MCP tool → Update `docs/mcp-tools-reference.md`

**Naming Convention**:
- Feature guides: `[feature-name]-guide.md` (e.g., `testing-guide.md`)
- Quick references: `[topic]-reference.md` or `[topic]-quick-ref.md`
- Workflows: `[workflow-name]-workflow.md`

---

### `Status/` — **Current Status ONLY (Minimalist!)**

**Purpose**: Track **what's happening NOW** (99% current status, 1% recent context).

**Allowed Files** (Keep ≤ 5 files at all times):
```
Status/
├── current-plan.md      # Current phase, active tasks, blockers
├── status-log.md        # Brief chronological update log
├── agent-status-report.md # Agent team status (if needed)
└── archive/             # OLD reports (>6 months or completed phases)
```

**Minimalist Rules**:
1. **≤ 5 current files** — If more, archive the old ones
2. **Brief updates** — Status log entries should be <200 words each
3. **Archive aggressively** — Reports >6 months old → `Status/archive/`
4. **No detailed specs** — Detailed docs belong in `Plans/` or `docs/`

**What Does NOT Belong Here**:
- ❌ Architecture plans (those go in `Plans/`)
- ❌ Usage guides (those go in `docs/`)
- ❌ Old completion reports (archive to `Status/archive/`)
- ❌ Detailed implementation notes (create issue or doc)

**Archive Triggers**:
- Phase complete → Archive phase reports
- 6+ months old → Archive automatically
- Status/ has >5 files → Archive oldest

---

### `src/` — **Source Code**

**Purpose**: **All TypeScript/JavaScript code**.

**Structure**:
```
src/
├── extension.ts          # VS Code extension entry point
├── agents/               # Agent team implementations
├── mcpServer/            # MCP protocol server
├── orchestrator/         # Programming Orchestrator
├── tasks/                # Task management
├── services/             # Business logic services
├── utils/                # Utility functions
├── types/                # TypeScript type definitions
├── ui/                   # React/webview components
├── db/                   # Database schemas & migrations
└── test/                 # Test utilities (not test files!)
```

**What Does NOT Belong Here**:
- ❌ Test files (those go in `tests/`)
- ❌ Documentation (MD files go in `docs/` or `Plans/`)
- ❌ Configuration (goes in `./` or `.vscode/`)

---

### `tests/` — **Test Files**

**Purpose**: **All test files** (unit, integration, E2E).

**Structure**:
```
tests/
├── *.test.ts             # Test files for src/*
└── fixtures/             # Test data/mocks
```

**Naming Convention**: `[sourceFileName].test.ts`
- Example: `src/mcpServer/server.ts` → `tests/mcpServer.server.test.ts`

---

### `.github/` — **GitHub Workflows & Skills**

**Purpose**: CI/CD workflows, Copilot skills, issue templates.

**Structure**:
```
.github/
├── workflows/            # GitHub Actions (CI/CD)
├── skills/               # Copilot development skills
│   ├── linting-skill/
│   ├── testing-skill/
│   ├── mcp-tool-skill/
│   └── ... (13 skills)
├── copilot-instructions.md  # Copilot AI instructions (this gets rewritten!)
└── ISSUE_TEMPLATE/       # GitHub issue templates
```

---

### `.vscode/` — **VS Code Configuration**

**Purpose**: Editor settings, launch configs, GitHub Issues.

**Structure**:
```
.vscode/
├── settings.json         # Workspace settings
├── launch.json           # Debug configurations
├── tasks.json            # VS Code tasks
└── github-issues/        # Local GitHub Issues (from MCP tools)
```

---

## 🧹 Cleanup Rules

### Daily Cleanup (During Development)

**Before committing P1 tasks**:
1. **Check root folder** — No orphaned code files (.ts, .js)
2. **Check imports** — Remove unused imports (ESLint auto-fix)
3. **Check Status/** — ≤5 files (archive old reports)

**Command**:
```bash
# Run linting skill (auto-fixes)
./.github/skills/linting-skill/eslint-fix.sh
```

---

### Weekly Cleanup (Maintenance)

**Every Friday or before major releases**:
1. **Archive old Status/ files** — >6 months → `Status/archive/`
2. **Remove dead code** — Unused functions, commented-out code
3. **Update docs/** — Reflect any changes made during the week
4. **Validate links** — Ensure all internal links work

**Command** (future):
```bash
# Cleanup script (to be created)
npm run cleanup
```

---

### Monthly Cleanup (Deep Clean)

**First Monday of each month**:
1. **Review Plans/** — Archive outdated specs
2. **Review docs/** — Remove obsolete guides
3. **Review Status/archive/** — Delete >2 years old
4. **Dependency audit** — `npm audit`, update packages

---

## 🚨 Enforcement Mechanisms

### Pre-Commit Checks (Automated)

**Git hooks** (`.git/hooks/pre-commit`):
```bash
#!/bin/bash
# Check for orphaned files in root
if ls ./*.ts ./*.js 2>/dev/null; then
  echo "❌ Error: Code files found in root folder!"
  echo "   Move to src/ or tests/"
  exit 1
fi

# Check Status/ file count
status_count=$(ls Status/*.md 2>/dev/null | wc -l)
if [ "$status_count" -gt 5 ]; then
  echo "⚠️  Warning: Status/ has $status_count files (limit: 5)"
  echo "   Archive old reports to Status/archive/"
fi
```

---

### CI/CD Checks (GitHub Actions)

**Workflow**: `.github/workflows/file-organization.yml`
```yaml
name: File Organization Check
on: [push, pull_request]
jobs:
  check-organization:
    runs-on: ubuntu-latest
    steps:
      - name: Check root folder
        run: |
          if ls ./*.ts ./*.js 2>/dev/null; then
            echo "::error::Code files in root folder"
            exit 1
          fi
      
      - name: Check Status/ size
        run: |
          count=$(ls Status/*.md 2>/dev/null | wc -l)
          if [ "$count" -gt 5 ]; then
            echo "::warning::Status/ has $count files (limit: 5)"
          fi
```

---

### Copilot Enforcement (Instructions)

**In `.github/copilot-instructions.md`**:
- Rule: "Check file location before creating new files"
- Rule: "Archive Status/ reports when >5 files exist"
- Rule: "Auto-update docs/ when implementing features"

---

## 📊 Folder Size Targets

| Folder | Target Size | Enforcement |
|--------|-------------|-------------|
| **Root** | ≤20 files | Pre-commit hook |
| **Status/** | ≤5 .md files | Weekly check |
| **Plans/** | No limit | Keep organized with README.md index |
| **docs/** | ≤30 files | Monthly review |
| **src/** | No limit | Follow structure rules |
| **tests/** | Match src/ | One test file per source file |
| **Status/archive/** | Unlimited | Auto-cleanup >2 years |

---

## 🎯 Quick Reference: Where Does This File Go?

| File Type | Example | Correct Folder |
|-----------|---------|----------------|
| Architecture spec | "Agent role definitions" | `Plans/` |
| Usage guide | "How to use MCP tools" | `docs/` |
| Current status | "What we're working on now" | `Status/current-plan.md` |
| Old status report | "Phase 0 complete summary" | `Status/archive/` |
| Source code | "MCP server implementation" | `src/` |
| Test file | "MCP server tests" | `tests/` |
| Skill definition | "Linting skill instructions" | `.github/skills/` |
| Config file | "TypeScript config" | `./` (root) |
| Breakdown plan | "MCP tools implementation steps" | `Plans/mcp-tools-breakdown.md` |

---

## 📚 Related Resources

- **Modular Philosophy**: [Plans/MODULAR-EXECUTION-PHILOSOPHY.md](MODULAR-EXECUTION-PHILOSOPHY.md) — Why atomic tasks matter
- **Task Breakdown**: [docs/task-breakdown-workflow.md](../docs/task-breakdown-workflow.md) — When to create Plans/ breakdown docs
- **MCP Tools**: [docs/mcp-tools-reference.md](../docs/mcp-tools-reference.md) — reportObservation for cleanup notes

---

**Next Review**: February 27, 2026  
**Owner**: All developers (enforced by Copilot instructions)
