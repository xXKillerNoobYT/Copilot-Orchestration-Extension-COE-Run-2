# Visual Plan Builder

## Purpose
A Mac-style sidebar webview that provides a visual interface for creating, editing, and managing development plans with drag-and-drop task trees and responsive UI design specifications.

## Opening
- Command: `coe.openPlanBuilder`
- Opens as a VS Code webview panel

## Layout

### Left Sidebar (280px)
- Plan selector dropdown
- Collapsible task tree (Mac Finder style)
  - Plan > Phase (parent tasks) > Task (children)
  - Each node shows: status icon, title, priority badge, progress bar
  - Click to select; arrow to expand/collapse
- Action buttons: + Task, Export

### Right Panel (detail)
- Task detail editor when a task is selected
- Fields: title, description, acceptance criteria, priority, status, estimated minutes
- Files modified list
- Responsive UI spec section

## Tree Structure
- Root = Plan node
- Parent tasks with children display as "phases" (collapsible)
- Leaf tasks display as individual items
- Decomposed tasks show aggregate progress (e.g., "3/5 sub-tasks verified")

## Responsive UI Design Spec
Each task can have responsive design specifications:
- Three viewport toggles: Mobile (375px), Tablet (768px), Desktop (1280px)
- Element visibility table: toggle show/hide per breakpoint
- Element properties: name, type, description

## Data Persistence
- All changes saved via the Database CRUD methods
- `webview.onDidReceiveMessage` handles:
  - `getPlans` — list all plans
  - `getPlanTasks` — get tasks for a plan + build tree
  - `updateTask` — update task fields
  - `createTask` — create new task
  - `deleteTask` — remove task
  - `reorderTask` — change parent
  - `exportMarkdown` — export plan as markdown

## Export
- Command: `coe.exportPlanAsMarkdown`
- Generates a markdown document with:
  - Plan name, status, creation date
  - All tasks organized by parent/child hierarchy
  - Status icons, priority, estimated time, acceptance criteria
  - Overall progress percentage
