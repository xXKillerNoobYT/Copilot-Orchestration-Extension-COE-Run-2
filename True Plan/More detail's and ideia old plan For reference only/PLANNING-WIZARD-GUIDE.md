# Planning Wizard & Visual Designer - User Guide

**Version**: 1.0  
**Date**: February 5, 2026  
**Status**: Draft - Awaiting MT-033 Implementation  
**Purpose**: Complete guide for visual plan creation designed for non-technical users

---

## Table of Contents

1. [Overview](#overview)
2. [Getting Started](#getting-started)
3. [The 6-Page Wizard](#the-6-page-wizard)
4. [Feature Blocks](#feature-blocks)
5. [Block Linking & Conditionals](#block-linking--conditionals)
6. [User & Developer Stories](#user--developer-stories)
7. [Success Criteria](#success-criteria)
8. [Plan Templates](#plan-templates)
9. [Export & Sharing](#export--sharing)
10. [Advanced Features](#advanced-features)

---

## Overview

The Planning Wizard is a **visual, step-by-step tool** for creating comprehensive project plans **without writing any code or technical documents**. It's designed for:

- **Non-technical users** - No coding knowledge required
- **Visual thinkers** - Drag-and-drop blocks instead of text
- **Collaboration** - Multiple people can contribute to same plan
- **Completeness** - Guides you through everything needed for a solid plan

### Why Use the Planning Wizard?

**Traditional Planning** (painful):
```
1. Open blank document
2. Stare at cursor
3. Wonder what to write
4. Write vague requirements
5. Developers ask "what do you mean by X?"
6. Repeat until frustrated
```

**Planning Wizard** (easy):
```
1. Click "New Plan"
2. Answer simple questions in 6 pages
3. Drag blocks, draw links
4. Export complete plan
5. Developers get clear, detailed specs
6. Build your app!
```

### What You Get

A complete plan with:
- ✅ Clear project overview
- ✅ Feature breakdown (blocks)
- ✅ Dependencies visualized
- ✅ User stories ("As a user, I want...")
- ✅ Developer stories ("As a developer, I need...")
- ✅ Success criteria (how to know it's done)
- ✅ Exportable to Markdown, JSON, PDF

---

## Getting Started

### Opening the Wizard

1. **From VS Code sidebar**:
   - Click COE icon
   - Click "New Plan" button
   - Planning Wizard opens

2. **From command palette**:
   - Press `Ctrl+Shift+P` (Windows) or `Cmd+Shift+P` (Mac)
   - Type `COE: Open Planning Wizard`
   - Press Enter

3. **From file menu**:
   - File → New → COE Plan
   - Planning Wizard opens

### Wizard Layout

```
┌─────────────────────────────────────────────────┐
│  Planning Wizard                    Progress: 1/6│
├─────────────────────────────────────────────────┤
│  ● Project Overview                             │
│  ○ Feature Blocks                               │
│  ○ Block Linking                                │
│  ○ User Stories                                 │
│  ○ Developer Stories                            │
│  ○ Success Criteria                             │
├─────────────────────────────────────────────────┤
│                                                 │
│  [Page 1 content here]                          │
│                                                 │
│                                                 │
├─────────────────────────────────────────────────┤
│  [Save Draft]    [◀ Back]        [Next ▶]      │
└─────────────────────────────────────────────────┘
```

- **Progress dots**: Show which page you're on
- **Auto-save**: Saves every 30 seconds
- **Back/Next**: Navigate between pages
- **Save Draft**: Save current state without completing

---

## The 6-Page Wizard

### Page 1: Project Overview

**Purpose**: High-level description of what you're building.

**Fields**:

1. **Project Name** (required, max 100 chars)
   - Example: "Employee Task Manager"
   - Tip: Short, descriptive, no jargon

2. **Description** (required, max 500 chars)
   - Example: "A web app for managing tasks across teams. Users can create, assign, and track tasks. Managers can view reports and analytics."
   - Tip: Explain what it does and who uses it

3. **High-Level Goals** (1-10 goals, each max 200 chars)
   - Example:
     - "Make task assignment simple and fast"
     - "Provide real-time updates to all team members"
     - "Generate weekly progress reports"
   - Tip: Focus on **why** (benefits), not **how** (technical details)

**Example Filled Page 1**:
```
Project Name: Employee Task Manager

Description:
A web application for managing tasks across teams. Users can create, 
assign, and track tasks with due dates and priorities. Managers can 
view reports and analytics on team productivity.

High-Level Goals:
1. Make task assignment simple and fast
2. Provide real-time updates to all team members
3. Generate weekly progress reports for managers
4. Support teams of 5-500 people
5. Work on desktop and mobile
```

---

### Page 2: Feature Blocks

**Purpose**: Break your project into bite-sized features.

**What are Feature Blocks?**

Think of your app as LEGO blocks. Each block is one feature:
- "User Login"
- "Task Creation"
- "Dashboard"
- "Reports"

**Adding a Feature Block**:

1. Click "Add Feature Block"
2. Fill in the form:

```
┌─────────────────────────────────────────────────┐
│  New Feature Block                              │
├─────────────────────────────────────────────────┤
│  Name*: [Task Creation                        ] │
│                                                 │
│  Description*:                                  │
│  ┌─────────────────────────────────────────┐   │
│  │ Allow users to create new tasks with    │   │
│  │ title, description, due date, priority, │   │
│  │ and assignee.                            │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  Purpose:                                       │
│  ┌─────────────────────────────────────────┐   │
│  │ Enable users to add work items to the   │   │
│  │ system for tracking                      │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  Priority: [High ▼]                             │
│                                                 │
│  Acceptance Criteria (auto-generated):          │
│  • User can enter task title (required)         │
│  • User can select due date from calendar       │
│  • Task appears in task list immediately        │
│  [Edit Criteria]                                │
│                                                 │
│  Technical Notes (for developers):              │
│  ┌─────────────────────────────────────────┐   │
│  │ May need database schema for tasks      │   │
│  │ table. Should auto-save drafts.          │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  [Cancel]                        [Add Block]    │
└─────────────────────────────────────────────────┘
```

3. Click "Add Block"
4. Block appears in visual canvas

**Visual Canvas**:

```
┌─────────────────────────────────────────────────┐
│  ┌──────────────┐  ┌──────────────┐             │
│  │ User Login   │  │ Dashboard    │             │
│  │ Priority: High│ │ Priority: High│             │
│  └──────────────┘  └──────────────┘             │
│                                                 │
│  ┌──────────────┐  ┌──────────────┐             │
│  │ Task Creation│  │ Task List    │             │
│  │ Priority: High│ │ Priority: High│             │
│  └──────────────┘  └──────────────┘             │
│                                                 │
│  ┌──────────────┐                               │
│  │ Reports      │                               │
│  │ Priority: Med │                               │
│  └──────────────┘                               │
│                                                 │
│  [+ Add Feature Block]                          │
└─────────────────────────────────────────────────┘
```

**Actions on Blocks**:
- **Click**: View details
- **Double-click**: Edit
- **Drag**: Reorder
- **Right-click**: Delete, Duplicate, Change Color
- **Hover**: Show acceptance criteria

**Color Coding**:
- 🔴 Red = Critical (must have for launch)
- 🟡 Yellow = Important (nice to have soon)
- 🟢 Green = Future (can wait)
- 🔵 Blue = Infrastructure (technical, not user-facing)

---

### Page 3: Block Linking

**Purpose**: Show which features depend on each other.

**Why Link Blocks?**

Dependencies answer: "What must be done before this?"

Example:
- Can't create tasks before users can log in
- Can't show reports before there are tasks

**Creating Links**:

1. **Drag arrows** between blocks:
   ```
   ┌──────────────┐          ┌──────────────┐
   │ User Login   │─────────>│ Dashboard    │
   └──────────────┘          └──────────────┘
        │
        ↓
   ┌──────────────┐
   │ Task Creation│
   └──────────────┘
   ```

2. **Set link type**:
   - **Requires** (hard dependency): "Dashboard REQUIRES User Login"
   - **Suggests** (soft dependency): "Dashboard SUGGESTS Task Creation (works without, better with)"
   - **Blocks** (conflict): "Old Dashboard BLOCKS New Dashboard"

3. **Add conditions** (optional):
   ```
   When [User Login] is [complete]
   → Then [Dashboard] [can start]
   ```

**Visual Graph**:

```
┌─────────────────────────────────────────────────┐
│  Dependency Graph                               │
├─────────────────────────────────────────────────┤
│                                                 │
│         ┌──────────────┐                        │
│         │ User Login   │                        │
│         └───────┬──────┘                        │
│                 │ requires                      │
│        ┌────────┴────────┐                      │
│        │                 │                      │
│        ↓                 ↓                      │
│  ┌──────────┐      ┌──────────┐                │
│  │Dashboard │      │  Tasks   │                │
│  └─────┬────┘      └─────┬────┘                │
│        │ suggests        │ requires             │
│        └────────┬────────┘                      │
│                 ↓                               │
│           ┌──────────┐                          │
│           │ Reports  │                          │
│           └──────────┘                          │
│                                                 │
│  🔴 Critical Path: Login → Tasks → Reports      │
│  ⚠️ Warning: Circular dependency detected       │
└─────────────────────────────────────────────────┘
```

**Critical Path** (red line): Minimum features needed for MVP, in order.

**Cycle Detection**: Wizard warns if you create circular dependencies (A → B → C → A).

---

### Page 4: User Stories

**Purpose**: Describe features from user's perspective.

**Template**:
```
As a [user type],
I want to [action],
So that [benefit].
```

**Example**:
```
As a team member,
I want to create a new task,
So that I can track work that needs to be done.
```

**Creating User Stories**:

1. Click "Add User Story"
2. Fill in template:

```
┌─────────────────────────────────────────────────┐
│  New User Story                                 │
├─────────────────────────────────────────────────┤
│  As a [team member            ▼]                │
│  I want to [create a new task               ]   │
│  So that [I can track work that needs doing ]   │
│                                                 │
│  Linked Feature: [Task Creation ▼]              │
│                                                 │
│  Acceptance Criteria (auto-generated):          │
│  • Team member can access task creation form    │
│  • All required fields are validated            │
│  • Task appears in list after creation          │
│  [Edit Criteria] [Add Criterion]                │
│                                                 │
│  Priority: [High ▼]                             │
│                                                 │
│  Notes:                                         │
│  ┌─────────────────────────────────────────┐   │
│  │ Should work on mobile too               │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  [Cancel]                        [Add Story]    │
└─────────────────────────────────────────────────┘
```

3. Click "Add Story"

**User Types** (common options):
- Team Member
- Manager
- Administrator
- Guest User
- Power User
- Mobile User

**Viewing Stories**:

```
┌─────────────────────────────────────────────────┐
│  User Stories (15)                              │
├─────────────────────────────────────────────────┤
│                                                 │
│  📋 Task Creation (5 stories)                   │
│  ├─ As a team member, I want to create tasks   │
│  ├─ As a manager, I want to assign tasks       │
│  ├─ As a user, I want to set due dates         │
│  ├─ As a user, I want to add attachments       │
│  └─ As a mobile user, I want quick task entry  │
│                                                 │
│  📊 Dashboard (4 stories)                       │
│  ├─ As a user, I want to see my tasks          │
│  ├─ As a manager, I want to see team tasks     │
│  ├─ As a user, I want to filter by priority    │
│  └─ As a user, I want to search tasks          │
│                                                 │
│  📈 Reports (3 stories)                         │
│  └─ ...                                         │
│                                                 │
│  [+ Add User Story]   [Bulk Import]  [Export]   │
└─────────────────────────────────────────────────┘
```

---

### Page 5: Developer Stories

**Purpose**: Technical requirements from developer's perspective.

**Template**:
```
As a developer,
I need to [technical action],
So that [technical benefit or user benefit].
```

**Example**:
```
As a developer,
I need to implement a RESTful API for tasks,
So that the frontend can create/read/update/delete tasks.
```

**Creating Developer Stories**:

1. Click "Add Developer Story"
2. Fill in template:

```
┌─────────────────────────────────────────────────┐
│  New Developer Story                            │
├─────────────────────────────────────────────────┤
│  As a developer,                                │
│  I need to [implement task API endpoints    ]   │
│  So that [frontend can manage tasks         ]   │
│                                                 │
│  Linked Feature: [Task Creation ▼]              │
│  Related User Story: [Create new task ▼]        │
│                                                 │
│  Technical Requirements:                        │
│  ┌─────────────────────────────────────────┐   │
│  │ Endpoints:                               │   │
│  │ POST /api/tasks - Create task            │   │
│  │ GET /api/tasks/:id - Get task            │   │
│  │ PUT /api/tasks/:id - Update task         │   │
│  │ DELETE /api/tasks/:id - Delete task      │   │
│  │                                           │   │
│  │ Database:                                 │   │
│  │ - tasks table with columns: id, title,   │   │
│  │   description, priority, due_date, etc.  │   │
│  │                                           │   │
│  │ Validation:                               │   │
│  │ - Title required, max 200 chars          │   │
│  │ - Priority: low/medium/high/critical     │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  Success Criteria:                              │
│  • All 4 endpoints respond correctly            │
│  • Database migrations created                  │
│  • API documentation generated                  │
│  • Unit tests pass (≥80% coverage)              │
│  [Add Criterion]                                │
│                                                 │
│  Estimated Complexity: [Medium ▼]               │
│                                                 │
│  [Cancel]                        [Add Story]    │
└─────────────────────────────────────────────────┘
```

**Complexity Levels**:
- **Trivial**: <1 hour, simple change
- **Small**: 1-4 hours, one file or function
- **Medium**: 4-16 hours, multiple files
- **Large**: 16-40 hours, new feature or module
- **X-Large**: 40+ hours, major system change

**Viewing Developer Stories**:

```
┌─────────────────────────────────────────────────┐
│  Developer Stories (12)                 by Complexity│
├─────────────────────────────────────────────────┤
│                                                 │
│  🔴 Large (2)                                   │
│  ├─ Implement authentication system             │
│  └─ Build real-time WebSocket sync              │
│                                                 │
│  🟡 Medium (5)                                  │
│  ├─ Create task API endpoints                   │
│  ├─ Build dashboard view                        │
│  ├─ Implement notification system               │
│  └─ ...                                         │
│                                                 │
│  🟢 Small (4)                                   │
│  └─ ...                                         │
│                                                 │
│  ⚪ Trivial (1)                                 │
│  └─ Add environment variable for API URL        │
│                                                 │
│  Total Estimated Time: 120-180 hours            │
│  [+ Add Developer Story]            [Export]    │
└─────────────────────────────────────────────────┘
```

---

### Page 6: Success Criteria

**Purpose**: Define how to know when each feature is "done".

**SMART Framework**:
- **S**pecific - Not vague ("works"), but precise ("responds in <2s")
- **M**easurable - Can be tested ("10+ concurrent users")
- **A**chievable - Realistic given time/resources
- **R**elevant - Actually matters to project goals
- **T**ime-bound - Has a deadline or metric

**Creating Success Criteria**:

1. Select a feature block or user story
2. Click "Add Criterion"
3. Fill in form:

```
┌─────────────────────────────────────────────────┐
│  New Success Criterion                          │
├─────────────────────────────────────────────────┤
│  For: [Task Creation ▼]                         │
│                                                 │
│  Criterion: [Users can create tasks <2 seconds]│
│                                                 │
│  SMART Check:                                   │
│  ✅ Specific: Yes - "create tasks in <2 seconds"│
│  ✅ Measurable: Yes - can time with stopwatch   │
│  ✅ Achievable: Yes - reasonable for web app    │
│  ✅ Relevant: Yes - speed affects user experience│
│  ✅ Time-bound: Yes - has metric (2 seconds)    │
│                                                 │
│  Test Method: [Performance test ▼]              │
│  How to verify:                                 │
│  ┌─────────────────────────────────────────┐   │
│  │ 1. Open task creation form               │   │
│  │ 2. Fill all required fields              │   │
│  │ 3. Click "Create"                         │   │
│  │ 4. Time from click to task appearing     │   │
│  │ 5. Must be ≤2 seconds                     │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  Priority: [High ▼]                             │
│                                                 │
│  [Cancel]                    [Add Criterion]    │
└─────────────────────────────────────────────────┘
```

**SMART Validation**:

Wizard automatically checks if criterion is SMART:

```
⚠️ Not Measurable
Your criterion "Task creation works well" is vague.
Make it measurable: "Task creation succeeds 99% of the time"

✅ Suggestion:
"Users can successfully create tasks with 99% success rate 
(1 failure per 100 attempts allowed)"
```

**Viewing Criteria**:

```
┌─────────────────────────────────────────────────┐
│  Success Criteria (25)                          │
├─────────────────────────────────────────────────┤
│                                                 │
│  Task Creation (8 criteria)                     │
│  ✅ Users can create task in <2 seconds         │
│  ✅ All required fields validated before submit │
│  ✅ Task appears in list within 1 second        │
│  ✅ 99% success rate (automated test)           │
│  ✅ Works on Chrome, Firefox, Safari, Edge      │
│  ✅ Mobile responsive (< 400px width)           │
│  ✅ Handles 100 concurrent task creations       │
│  ✅ Auto-saves drafts every 30 seconds          │
│                                                 │
│  Dashboard (6 criteria)                         │
│  ✅ Displays 1000+ tasks without lag            │
│  └─ ...                                         │
│                                                 │
│  Reports (4 criteria)                           │
│  └─ ...                                         │
│                                                 │
│  [+ Add Criterion]   [Validate All]  [Export]   │
└─────────────────────────────────────────────────┘
```

---

## Feature Blocks

### Anatomy of a Feature Block

```
┌──────────────────────────────────────┐
│  🔴 Task Creation            [⋮]    │  ← Name + Priority Color + Menu
├──────────────────────────────────────┤
│  Allow users to create new tasks    │  ← Brief Description
│  with title, description, priority   │
│                                      │
│  Depends on: User Login (required)   │  ← Dependencies
│                                      │
│  5 User Stories • 3 Dev Stories      │  ← Story Count
│  8 Success Criteria                  │  ← Criteria Count
│                                      │
│  Estimated: 16-24 hours              │  ← Time Estimate
└──────────────────────────────────────┘
```

### Block States

- 🔘 **Not Started** - Gray, no work done yet
- 🔄 **In Progress** - Blue outline, being worked on
- ✅ **Complete** - Green checkmark, all criteria met
- ⚠️ **Blocked** - Red warning, dependency not met
- 🚫 **Cancelled** - Strikethrough, won't be built

### Block Relationships

```
┌──────────────┐
│ Block A      │─── requires ───>┌──────────────┐
└──────────────┘                 │ Block B      │
       │                         └──────────────┘
       │ suggests
       ↓
┌──────────────┐
│ Block C      │──── blocks ────>┌──────────────┐
└──────────────┘                 │ Block D      │
                                 └──────────────┘
```

- **Requires**: Hard dependency. Block A cannot start until Block B is complete.
- **Suggests**: Soft dependency. Block A works without Block C, but better with it.
- **Blocks**: Conflict. Block C and Block D can't both exist (choose one).

---

## Block Linking & Conditionals

### Simple Dependencies

**Drag an arrow** from one block to another:

```
[User Login] ────> [Dashboard]
```

This creates: "Dashboard REQUIRES User Login"

### Conditional Logic

**Add conditions** to dependencies:

```
When [User Login] is [complete]
→ Then [Dashboard] [can start]

When [User Login] is [blocked]
→ Then [Dashboard] [is paused]

When [Old Dashboard] is [complete]
→ Then [Old Dashboard] [is archived]
```

**Condition Builder**:

```
┌─────────────────────────────────────────────────┐
│  Condition Editor                               │
├─────────────────────────────────────────────────┤
│  When [User Login      ▼] is [complete    ▼]   │
│  Then [Dashboard       ▼] [can start     ▼]    │
│                                                 │
│  [+ Add Another Condition]                      │
│                                                 │
│  Examples:                                      │
│  • When X is complete → Then Y can start        │
│  • When X is blocked → Then Y is paused         │
│  • When X is started → Then Z gets notification │
│                                                 │
│  [Cancel]                               [Save]  │
└─────────────────────────────────────────────────┘
```

**Available States**:
- Not Started
- In Progress
- Complete
- Blocked
- Cancelled

**Available Actions**:
- Can start
- Is paused
- Is blocked
- Sends notification
- Is archived
- Gets priority boost

---

## User & Developer Stories

### User Story Best Practices

**Good user stories**:
```
✅ As a team member, I want to create tasks with due dates,
   so that I can track deadlines.
   (Specific, clear benefit)

✅ As a manager, I want to see team workload,
   so that I can balance assignments fairly.
   (Measurable outcome)
```

**Bad user stories**:
```
❌ As a user, I want the app to work.
   (Too vague)

❌ As a user, I want to use the database.
   (Technical detail, not user-facing)

❌ The system should be fast.
   (Not a story format, no user perspective)
```

### Developer Story Best Practices

**Good developer stories**:
```
✅ As a developer, I need to create a tasks database table,
   so that task data persists between sessions.
   (Clear technical need + justification)

✅ As a developer, I need to implement rate limiting,
   so that the API doesn't get overwhelmed by spam.
   (Security/performance concern)
```

**Bad developer stories**:
```
❌ As a developer, I need to write some code.
   (No specifics)

❌ As a developer, I need to make it work.
   (Vague, no actionable detail)
```

---

## Success Criteria

### SMART Examples

**Specific**:
```
❌ "Login works"
✅ "Users can log in with email and password in <2 seconds"
```

**Measurable**:
```
❌ "App is fast"
✅ "Task list loads 1000 tasks in <1 second"
```

**Achievable**:
```
❌ "Supports 1 billion users" (for MVP with one developer)
✅ "Supports 100 concurrent users" (realistic for MVP)
```

**Relevant**:
```
❌ "Button is #3498db blue" (unless brand-critical)
✅ "Button has 4.5:1 contrast ratio for accessibility"
```

**Time-bound**:
```
❌ "Eventually has reports"
✅ "Weekly report generates Monday 9am, includes data from previous 7 days"
```

### Test Methods

- **Manual Test**: Human follows steps, verifies result
- **Automated Test**: Unit/integration test passes
- **Performance Test**: Load testing, benchmarks
- **User Acceptance**: Real user confirms "this is what I wanted"
- **Accessibility Test**: Screen reader, keyboard nav, contrast checker
- **Security Test**: Penetration testing, vulnerability scan

---

## Plan Templates

### Available Templates

1. **Web Application**
   - Frontend + Backend + Database
   - User auth, CRUD operations, admin panel
   - Example: Task manager, Blog, E-commerce

2. **REST API**
   - Endpoints, authentication, documentation
   - Rate limiting, versioning
   - Example: Weather API, Payment API

3. **CLI Tool**
   - Commands, arguments, help system
   - Configuration, output formats
   - Example: Build tool, Deployment script

4. **VS Code Extension**
   - Commands, sidebar, webviews
   - Language support, debugging
   - Example: Linter, Formatter, Theme

5. **Documentation Site**
   - Pages, navigation, search
   - Examples, tutorials, API reference
   - Example: Project docs, User guide

### Using a Template

1. Click "Use Template" on Page 1
2. Select template type
3. Wizard pre-fills:
   - Common feature blocks
   - Typical dependencies
   - Standard user stories
   - Best practice dev stories
   - SMART success criteria
4. Customize to your needs
5. Add/remove/edit as needed

**Example: Web Application Template**

Pre-filled feature blocks:
- User Authentication
- User Profile
- Dashboard
- CRUD Operations (Create, Read, Update, Delete)
- Admin Panel
- Settings
- API Integration
- Database Setup

Pre-filled user stories (examples):
- "As a user, I want to log in..."
- "As a user, I want to view my profile..."
- "As an admin, I want to manage users..."

---

## Export & Sharing

### Export Formats

**1. Markdown** (best for documentation)
```markdown
# Employee Task Manager

## Project Overview
A web application for managing tasks across teams...

## Features

### Task Creation (Priority: High)
Allow users to create new tasks with title, description...

**User Stories**:
- As a team member, I want to create tasks...

**Developer Stories**:
- As a developer, I need to implement task API...

**Success Criteria**:
- Users can create task in <2 seconds
- 99% success rate
...
```

**2. JSON** (best for programmatic use)
```json
{
  "project": {
    "name": "Employee Task Manager",
    "description": "A web application...",
    "features": [
      {
        "id": "F1",
        "name": "Task Creation",
        "priority": "high",
        "userStories": [...],
        "devStories": [...],
        "successCriteria": [...]
      }
    ]
  }
}
```

**3. PDF** (best for printing/sharing with non-technical stakeholders)
- Professional formatting
- Includes dependency graph diagrams
- Table of contents
- Page numbers

**4. YAML** (best for config files)
```yaml
project:
  name: Employee Task Manager
  features:
    - name: Task Creation
      priority: high
      user_stories:
        - as: team member
          want: create tasks
          so_that: track work
```

### Sharing Plans

**Export to file**:
1. Click "Export" on any page
2. Choose format (Markdown/JSON/PDF/YAML)
3. Save file
4. Share via email, Slack, GitHub, etc.

**Generate shareable link** (if COE cloud features enabled):
1. Click "Share"
2. Set permissions (view-only / can-edit)
3. Copy link
4. Share link with team

**Collaborate live** (if COE cloud features enabled):
- Multiple users edit same plan simultaneously
- See others' cursors and changes
- Comments and suggestions
- Version history

---

## Advanced Features

### AI Suggestions

**Enable AI Help**:
1. Click "🤖 AI Suggestions" button
2. AI analyzes your plan
3. Suggests:
   - Missing features ("You have login but no logout")
   - Implied dependencies ("Dashboard requires data, add Task Creation first")
   - User stories from features ("You have Task Creation → suggest 5 user stories")
   - Success criteria from stories ("User wants speed → suggest <2s response time")

**Example**:
```
🤖 AI Suggestion

You added "User Login" but I don't see a "Forgot Password" feature.

Suggested Feature Block:
┌──────────────────────────────────────┐
│  Password Reset                      │
│  Allow users to reset forgotten pass │
│  Depends on: User Login (required)   │
│  Priority: Medium                     │
└──────────────────────────────────────┘

[Accept] [Modify] [Dismiss]
```

### Version History

**Auto-saved versions**:
- Every major change (added/removed block)
- Every manual save
- Before export
- Maximum 20 versions stored

**Compare versions**:
```
┌─────────────────────────────────────────────────┐
│  Version History                                │
├─────────────────────────────────────────────────┤
│  v7 (current) - 2026-02-05 14:30                │
│  Added Reports feature, 3 dev stories           │
│  [View]                                         │
│                                                 │
│  v6 - 2026-02-05 14:15                          │
│  Added Dashboard dependencies                   │
│  [View] [Restore] [Compare to v7]               │
│                                                 │
│  v5 - 2026-02-05 14:00                          │
│  Created initial feature blocks                 │
│  [View] [Restore] [Compare to v7]               │
└─────────────────────────────────────────────────┘
```

**Diff view**:
```
┌─────────────────────────────────────────────────┐
│  Comparing v6 to v7                             │
├─────────────────────────────────────────────────┤
│  + Added: Reports feature                       │
│  + Added: 3 developer stories for Reports       │
│  ~ Modified: Dashboard now depends on Reports   │
│  - Removed: Old Analytics feature               │
│                                                 │
│  [Restore v6] [Keep v7] [Export Diff]           │
└─────────────────────────────────────────────────┘
```

### Analytics Dashboard

**Plan Metrics**:
- Total features: 12
- High priority: 5
- Medium priority: 4
- Low priority: 3
- Total user stories: 28
- Total dev stories: 15
- Total success criteria: 45
- Estimated time: 120-180 hours
- Completeness score: 87/100

**Complexity Graph**:
```
┌─────────────────────────────────────────────────┐
│  Estimated Effort by Feature                    │
├─────────────────────────────────────────────────┤
│  Authentication      ████████████ 48h           │
│  Task Management     ████████ 32h               │
│  Dashboard           ██████ 24h                 │
│  Reports             ████ 16h                   │
│  Settings            ██ 8h                      │
│  Admin Panel         ████ 16h                   │
│                                                 │
│  Total: 144 hours                               │
└─────────────────────────────────────────────────┘
```

**Dependency Depth**:
```
┌─────────────────────────────────────────────────┐
│  Critical Path: Login → Tasks → Reports         │
│  Minimum time: 96 hours (if done sequentially)  │
│  With parallelization: 48 hours (2 developers)  │
│                                                 │
│  Bottlenecks:                                   │
│  ⚠️ Authentication blocks 8 other features      │
│  ⚠️ Dashboard has 5 dependencies (complex)      │
└─────────────────────────────────────────────────┘
```

---

## Keyboard Shortcuts

| Action | Windows/Linux | macOS |
|--------|---------------|-------|
| Next page | `Ctrl+→` | `Cmd+→` |
| Previous page | `Ctrl+←` | `Cmd+←` |
| Add block | `Ctrl+N` | `Cmd+N` |
| Delete selected | `Delete` | `Delete` |
| Duplicate selected | `Ctrl+D` | `Cmd+D` |
| Save draft | `Ctrl+S` | `Cmd+S` |
| Export | `Ctrl+E` | `Cmd+E` |
| Undo | `Ctrl+Z` | `Cmd+Z` |
| Redo | `Ctrl+Y` | `Cmd+Shift+Z` |
| Search | `Ctrl+F` | `Cmd+F` |
| Zoom in | `Ctrl++` | `Cmd++` |
| Zoom out | `Ctrl+-` | `Cmd+-` |

---

## Tips & Tricks

### For Non-Technical Users

1. **Start with template** - Don't reinvent the wheel
2. **Use simple language** - Explain like you're talking to a friend
3. **One feature = One block** - Don't combine "Login and Dashboard and Reports" into one block
4. **Draw the links** - Visual dependencies are easier than text
5. **Ask "why?"** - Every feature should have clear user benefit

### For Technical Users

1. **Split large features** - Authentication → Login, Logout, Password Reset, 2FA
2. **Include non-functional requirements** - Performance, security, accessibility
3. **Document assumptions** - "Assumes MySQL database", "Requires Node 18+"
4. **Link to external docs** - Tech specs, API docs, design files
5. **Estimate conservatively** - Double your initial estimate

### Common Mistakes

❌ **Too vague**: "Make a website"  
✅ **Specific**: "Build task management web app with user auth, CRUD operations, and reports"

❌ **Too technical**: "Implement OAuth 2.0 JWT token-based authentication with refresh tokens"  
✅ **User-focused**: "Users can log in securely and stay logged in for 30 days"

❌ **No dependencies**: All blocks independent  
✅ **Realistic dependencies**: Show what must be done first

❌ **No success criteria**: "It works"  
✅ **SMART criteria**: "Responds in <2s for 100 concurrent users"

---

## Troubleshooting

### "I can't find the Planning Wizard"

1. Check COE sidebar is open (click COE icon)
2. Look for "New Plan" button
3. Try Command Palette: `Ctrl+Shift+P` → `COE: Open Planning Wizard`
4. Ensure COE extension is activated (check Extensions panel)

### "My plan won't save"

1. Check you have write permissions to workspace folder
2. Ensure `.coe/` directory exists
3. Try "Save Draft" button
4. Check for error message in Output panel (View → Output → COE)

### "Dependency graph shows circular dependency"

```
⚠️ Circular Dependency Detected
A → B → C → A

This means feature A depends on B, B depends on C, and C depends on A.
One of these dependencies must be removed or this will never finish.

Suggested fix: Remove link C → A

[Remove C → A] [Remove B → C] [Remove A → B] [Ignore]
```

### "AI suggestions are off/wrong"

1. Disable AI if not helpful: Settings → COE → AI Suggestions: Off
2. AI works better with more context (fill in more details first)
3. AI is a suggestion tool, not a requirement (you can ignore all suggestions)
4. Report bad suggestions: Help → Report Issue

---

## Implementation Checklist (for MT-033)

- [ ] Wizard UI framework (MT-033.1)
- [ ] Page 1: Project Overview (MT-033.2)
- [ ] Page 2: Feature Blocks (MT-033.3)
- [ ] Page 3: Block Linking (MT-033.4)
- [ ] Page 3: Conditional logic (MT-033.5)
- [ ] Page 4: User Stories (MT-033.6)
- [ ] Page 5: Developer Stories (MT-033.7)
- [ ] Page 6: Success Criteria (MT-033.8)
- [ ] Detailed text box system (MT-033.9)
- [ ] Plan templates library (MT-033.10)
- [ ] Export formats (MT-033.11)
- [ ] Dependency graph (MT-033.12)
- [ ] Auto-validation (MT-033.13)
- [ ] Collaboration features (MT-033.14)
- [ ] Plan versioning (MT-033.15)
- [ ] Analytics dashboard (MT-033.16)
- [ ] AI suggestions (MT-033.17)
- [ ] Comprehensive tests (MT-033.18)

---

**Next Steps**: Implement MT-033 tasks to build this Planning Wizard!
