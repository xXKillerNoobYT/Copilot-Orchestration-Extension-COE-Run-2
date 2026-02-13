# Agile Stories & Developer Tasks

**Version**: 2.0
**Date**: February 12, 2026

---

## Overview

This document contains all user stories and developer tasks for the Visual Program Designer expansion (v2.0). Stories are organized into 7 epics, each with acceptance criteria and decomposed into 15-45 minute engineering tasks per COE conventions.

**Total**: 7 Epics | 38 User Stories | 130+ Developer Tasks

---

## Epic 1: Visual Program Designer Canvas

> The core drag-and-drop design surface where users build program interfaces visually. Extends the existing plan builder into a full GUI designer with snap grid, alignment, zoom/pan, and undo/redo.

---

### US-01: Drag components from library onto canvas

**As a** program designer, **I want** to drag components from the left panel library and drop them onto the canvas, **so that** I can build interfaces visually without writing code.

**Acceptance Criteria:**
- [ ] AC1: User can drag any component from the 5 category groups onto the canvas
- [ ] AC2: Component snaps to grid on drop (8px default)
- [ ] AC3: Component appears with default size and properties
- [ ] AC4: Drop position matches cursor position
- [ ] AC5: Event `design:component_created` is emitted on drop

**Priority:** P1
**Estimated Effort:** 4 hours
**Dependencies:** Component library (US-07)

#### DT-01: Implement drag source handlers for component library
**Parent Story:** US-01 | **Time:** 30 min
**Description:** Add HTML5 drag event handlers (dragstart, dragend) to each component item in the library panel. Set `dataTransfer` with component type and default props.
**Files:** `src/views/plan-builder.ts` (webview HTML section)
**Test:** Drag a Button component — `dataTransfer` contains `{"type":"button","name":"Button"}`.

#### DT-02: Implement canvas drop zone handler
**Parent Story:** US-01 | **Time:** 45 min
**Description:** Add dragover (prevent default) and drop handlers to the canvas element. On drop, read component type from `dataTransfer`, calculate grid-snapped position, and call `createDesignComponent()`.
**Files:** `src/views/plan-builder.ts`, `src/core/designer-engine.ts`
**Test:** Drop a Button on canvas at (100,100) with 8px grid — component created at (96,96).

#### DT-03: Create default component dimensions and styles
**Parent Story:** US-01 | **Time:** 30 min
**Description:** Define default width, height, and styles for each of the 15+ component types in a `COMPONENT_DEFAULTS` map.
**Files:** `src/core/component-schema.ts` (new file)
**Test:** `getDefaultProps('button')` returns `{width: 120, height: 40, styles: {backgroundColor: '#3B82F6', ...}}`.

#### DT-04: Emit design event on component creation
**Parent Story:** US-01 | **Time:** 15 min
**Description:** After successful component creation, emit `design:component_created` via the event bus with component data.
**Files:** `src/views/plan-builder.ts`, `src/core/event-bus.ts`
**Test:** Listen for `design:component_created` — fires with correct component ID after drop.

---

### US-02: Select, move, and resize components on canvas

**As a** program designer, **I want** to click to select components, drag to move them, and resize with handles, **so that** I can arrange my layout precisely.

**Acceptance Criteria:**
- [ ] AC1: Click selects a component, showing selection handles
- [ ] AC2: Drag moves the selected component, snapping to grid
- [ ] AC3: Resize handles on corners and edges allow proportional and free resizing
- [ ] AC4: Alignment guides appear when near other components
- [ ] AC5: Position and size update in Properties panel in real-time

**Priority:** P1
**Estimated Effort:** 6 hours
**Dependencies:** US-01

#### DT-05: Implement click-to-select with visual handles
**Parent Story:** US-02 | **Time:** 45 min
**Description:** On canvas click, hit-test against all component bounds. If hit, set selection state and render 8 resize handles (4 corners + 4 edges) around the component.
**Files:** `src/views/plan-builder.ts`
**Test:** Click on a Button component — 8 blue handle squares appear around it.

#### DT-06: Implement drag-to-move with grid snapping
**Parent Story:** US-02 | **Time:** 45 min
**Description:** On mousedown on selected component (not on handles), begin drag. Track mouse delta, apply grid snap via `DesignerEngine.snapToGrid()`, update component position, and call `updateDesignComponent()`.
**Files:** `src/views/plan-builder.ts`, `src/core/designer-engine.ts`
**Test:** Drag component from (100,100) by (13,17) — snaps to (112,112) with 8px grid.

#### DT-07: Implement resize handles
**Parent Story:** US-02 | **Time:** 45 min
**Description:** On mousedown on a handle, begin resize. Track mouse delta, apply to width/height (or both for corner handles), enforce minimum sizes (20x20), snap to grid.
**Files:** `src/views/plan-builder.ts`
**Test:** Drag bottom-right corner handle — component width and height increase proportionally.

#### DT-08: Show alignment guides during move/resize
**Parent Story:** US-02 | **Time:** 30 min
**Description:** During drag operations, call `DesignerEngine.getAlignmentGuides()` to find alignment points with other components. Render guide lines (thin blue/red lines) on canvas.
**Files:** `src/views/plan-builder.ts`, `src/core/designer-engine.ts`
**Test:** Move component near another's left edge — vertical guide line appears.

#### DT-09: Sync selection to Properties panel
**Parent Story:** US-02 | **Time:** 30 min
**Description:** When selection changes, send component data to the Properties panel via webview messaging. Update position/size fields in real-time during drag/resize.
**Files:** `src/views/plan-builder.ts`
**Test:** Select a component — Properties panel shows its x, y, width, height, and all style values.

---

### US-03: Multi-select and group operations

**As a** program designer, **I want** to select multiple components and align/distribute them as a group, **so that** I can create consistent layouts quickly.

**Acceptance Criteria:**
- [ ] AC1: Shift+click adds to selection, Ctrl+A selects all
- [ ] AC2: Rectangle drag-select selects all enclosed components
- [ ] AC3: Align operations work on multi-selection (left, right, center, top, bottom, middle)
- [ ] AC4: Distribute operations space components evenly (horizontal, vertical)
- [ ] AC5: Auto-arrange places selected components in a grid

**Priority:** P2
**Estimated Effort:** 4 hours
**Dependencies:** US-02

#### DT-10: Implement shift-click and ctrl-A selection
**Parent Story:** US-03 | **Time:** 30 min
**Description:** Modify click handler: if Shift held, toggle component in selection set. If Ctrl+A, select all components on current page.
**Files:** `src/views/plan-builder.ts`
**Test:** Shift+click 3 components — all 3 show selection handles.

#### DT-11: Implement rectangle drag-select
**Parent Story:** US-03 | **Time:** 30 min
**Description:** On mousedown on empty canvas area, begin rubber-band selection. Draw selection rectangle. On mouseup, use `DesignerEngine.getComponentsInRect()` to find enclosed components.
**Files:** `src/views/plan-builder.ts`, `src/core/designer-engine.ts`
**Test:** Drag a rectangle over 4 components — all 4 selected.

#### DT-12: Wire alignment and distribution toolbar buttons
**Parent Story:** US-03 | **Time:** 30 min
**Description:** Add toolbar buttons for align-left, align-right, align-center, align-top, align-bottom, align-middle, distribute-h, distribute-v. Each calls the corresponding `DesignerEngine.performLayout()` method.
**Files:** `src/views/plan-builder.ts`, `src/core/designer-engine.ts`
**Test:** Select 3 components, click "Align Left" — all share the same x coordinate.

---

### US-04: Properties panel updates component in real-time

**As a** program designer, **I want** to edit component properties in the right panel and see changes instantly on canvas, **so that** I can fine-tune my design without trial and error.

**Acceptance Criteria:**
- [ ] AC1: Properties tab shows field label, placeholder, font size, alignment, required, enabled
- [ ] AC2: Appearance tab shows colors, borders, shadows, spacing, opacity
- [ ] AC3: Actions tab shows event bindings (onClick, onChange, etc.)
- [ ] AC4: Changes apply to canvas in < 100ms
- [ ] AC5: Changes persist to database on blur/enter

**Priority:** P1
**Estimated Effort:** 5 hours
**Dependencies:** US-02

#### DT-13: Build Properties tab form with all fields
**Parent Story:** US-04 | **Time:** 45 min
**Description:** Create the Properties tab HTML form in the right panel with inputs for: Field Label (text), Placeholder (text), Font Size (radio: S/M/L), Alignment (button group: left/center/right/justify), Required (toggle), Enabled (toggle).
**Files:** `src/views/plan-builder.ts`
**Test:** Select a TextBox — Properties tab shows all 6 fields with current values.

#### DT-14: Build Appearance tab with style controls
**Parent Story:** US-04 | **Time:** 45 min
**Description:** Create Appearance tab with: background color picker, text color picker, border (width, color, radius), box shadow, padding (4 sides), margin (4 sides), opacity slider.
**Files:** `src/views/plan-builder.ts`
**Test:** Change background color to red — canvas component updates instantly.

#### DT-15: Build Actions tab with event bindings
**Parent Story:** US-04 | **Time:** 30 min
**Description:** Create Actions tab showing available events for the selected component type (onClick, onChange, onSubmit, etc.) with a code editor area for each binding.
**Files:** `src/views/plan-builder.ts`
**Test:** Add onClick handler to a Button — Actions tab shows the code binding.

#### DT-16: Implement real-time canvas sync from property changes
**Parent Story:** US-04 | **Time:** 30 min
**Description:** On any property input change, immediately update the component's visual on canvas (no save needed). Use `requestAnimationFrame` for batching.
**Files:** `src/views/plan-builder.ts`
**Test:** Type in placeholder field — canvas component shows new placeholder text within 100ms.

#### DT-17: Persist property changes to database on commit
**Parent Story:** US-04 | **Time:** 30 min
**Description:** On input blur or Enter key, call `database.updateDesignComponent()` with changed fields. Debounce to prevent excessive writes.
**Files:** `src/views/plan-builder.ts`, `src/core/database.ts`
**Test:** Change font size and tab away — database row updated with new value.

---

### US-05: Canvas zoom, pan, and grid snap controls

**As a** program designer, **I want** zoom in/out, pan the canvas, and toggle grid snap, **so that** I can work at different detail levels.

**Acceptance Criteria:**
- [ ] AC1: Zoom In / Zoom Out buttons in bottom bar (also Ctrl+scroll)
- [ ] AC2: Zoom range: 25% to 400%
- [ ] AC3: Pan with middle-mouse-button drag or Space+drag
- [ ] AC4: Grid Snap toggle in bottom bar
- [ ] AC5: Zoom level displayed in bottom bar

**Priority:** P2
**Estimated Effort:** 3 hours
**Dependencies:** US-01

#### DT-18: Implement zoom with CSS transform
**Parent Story:** US-05 | **Time:** 30 min
**Description:** Track zoom level as a float (0.25 to 4.0). Apply CSS `transform: scale(zoomLevel)` to the canvas container. Update on Ctrl+scroll or button click (+/- 10% per step).
**Files:** `src/views/plan-builder.ts`
**Test:** Click Zoom In 3 times from 100% — canvas shows at 130%.

#### DT-19: Implement canvas panning
**Parent Story:** US-05 | **Time:** 30 min
**Description:** On middle-mouse-button down (or Space+mousedown), begin pan mode. Track mouse delta, apply to canvas scroll/translate offset.
**Files:** `src/views/plan-builder.ts`
**Test:** Middle-click and drag — canvas viewport moves with cursor.

#### DT-20: Add bottom bar controls
**Parent Story:** US-05 | **Time:** 30 min
**Description:** Render bottom bar with: Zoom In button, Zoom Out button, zoom percentage label, Grid Snap checkbox, Asset Library button, Page Settings button, Preview button.
**Files:** `src/views/plan-builder.ts`
**Test:** Bottom bar visible with all controls; clicking Grid Snap toggles snapping behavior.

---

### US-06: Undo/redo operations on canvas

**As a** program designer, **I want** to undo and redo my design changes, **so that** I can experiment safely.

**Acceptance Criteria:**
- [ ] AC1: Ctrl+Z undoes the last action
- [ ] AC2: Ctrl+Shift+Z (or Ctrl+Y) redoes the last undone action
- [ ] AC3: Undo stack holds at least 50 actions
- [ ] AC4: Undo covers: create, delete, move, resize, property change
- [ ] AC5: Redo stack clears when a new action is performed

**Priority:** P2
**Estimated Effort:** 3 hours
**Dependencies:** US-02, US-04

#### DT-21: Implement undo/redo command stack
**Parent Story:** US-06 | **Time:** 45 min
**Description:** Create an `UndoManager` class with push(action), undo(), redo() methods. Each action stores: type, componentId, previousState, newState. Max stack size: 50.
**Files:** `src/core/designer-engine.ts`
**Test:** Push 3 actions, undo twice — state reverts to action 1.

#### DT-22: Capture undoable actions from all canvas operations
**Parent Story:** US-06 | **Time:** 30 min
**Description:** Wrap all canvas mutations (create, delete, move, resize, property change) to push an undo record before applying the change.
**Files:** `src/views/plan-builder.ts`, `src/core/designer-engine.ts`
**Test:** Create a component, move it, undo — component returns to original position.

#### DT-23: Wire keyboard shortcuts Ctrl+Z and Ctrl+Shift+Z
**Parent Story:** US-06 | **Time:** 15 min
**Description:** Add keydown listener in webview for Ctrl+Z (undo) and Ctrl+Shift+Z (redo). Call UndoManager methods and re-render canvas.
**Files:** `src/views/plan-builder.ts`
**Test:** Press Ctrl+Z after moving a component — component returns to previous position.

---

## Epic 2: Component Library System

> A comprehensive library of 50+ components organized into 5 category groups, each with defined properties, events, default styles, and code mappings.

---

### US-07: Browse component library organized by category

**As a** program designer, **I want** to browse components in the left panel organized by category, **so that** I can quickly find the component I need.

**Acceptance Criteria:**
- [ ] AC1: Left panel shows 5 collapsible category groups
- [ ] AC2: Each component shows icon and name
- [ ] AC3: Categories can be expanded/collapsed
- [ ] AC4: Search/filter bar at top of library

**Priority:** P1
**Estimated Effort:** 3 hours
**Dependencies:** None

#### DT-24: Create component library data structure
**Parent Story:** US-07 | **Time:** 30 min
**Description:** Define the 5 category groups with all component entries in `ComponentSchemaService`. Each entry: type, name, icon, category, defaultProps.
**Files:** `src/core/component-schema.ts`
**Test:** `getAllSchemas()` returns 50+ components across 5 categories.

#### DT-25: Render collapsible category panels in left sidebar
**Parent Story:** US-07 | **Time:** 30 min
**Description:** Build the left panel HTML with collapsible sections for each category. Each section header shows category name and component count.
**Files:** `src/views/plan-builder.ts`
**Test:** Click "Containers/Layouts" header — section expands showing Panel, TabView, SplitView, etc.

#### DT-26: Add search/filter bar to component library
**Parent Story:** US-07 | **Time:** 30 min
**Description:** Add text input at top of library panel. On input, filter visible components by name substring match (case-insensitive).
**Files:** `src/views/plan-builder.ts`
**Test:** Type "tab" — only TabView and DataTable remain visible.

---

### US-08: Use primitive input components

**As a** program designer, **I want** to use TextBox, Password, Number, Checkbox, Radio, Slider, Dropdown, DatePicker, and Toggle components, **so that** I can build input forms.

**Acceptance Criteria:**
- [ ] AC1: All 9 primitive input types available in library
- [ ] AC2: Each renders with realistic visual preview on canvas
- [ ] AC3: Each has appropriate property controls (placeholder, min/max, options list, etc.)
- [ ] AC4: Each maps to correct code output

**Priority:** P1
**Estimated Effort:** 6 hours
**Dependencies:** US-07

#### DT-27: Define schemas for all 9 primitive inputs
**Parent Story:** US-08 | **Time:** 45 min
**Description:** Create `ComponentSchema` entries for: textbox, textarea, password, number, checkbox, checkbox_group, radio_group, slider, dropdown, date_picker, toggle_switch. Each with props, events, and defaults.
**Files:** `src/core/component-schema.ts`, `src/types/index.ts`
**Test:** `getSchema('slider')` returns `{props: {min, max, step, value}, events: ['onChange'], defaults: {min: 0, max: 100}}`.

#### DT-28: Implement canvas renderers for primitive inputs
**Parent Story:** US-08 | **Time:** 45 min
**Description:** Create render functions that draw each input type on the canvas with realistic appearance (text fields with borders, checkboxes with check marks, sliders with tracks, etc.).
**Files:** `src/views/plan-builder.ts`
**Test:** Drop a Slider on canvas — renders as a track with a draggable thumb.

#### DT-29: Create property panel configurations for each input type
**Parent Story:** US-08 | **Time:** 30 min
**Description:** Define which properties appear in the Properties panel for each input type. E.g., TextBox shows placeholder+maxLength; Slider shows min+max+step; Dropdown shows options list.
**Files:** `src/views/plan-builder.ts`, `src/core/component-schema.ts`
**Test:** Select a Dropdown — Properties panel shows "Options" field where user can add/remove items.

---

### US-09: Use container and layout components

**As a** program designer, **I want** to use Panel, TabView, SplitView, Modal, Collapsible, and DataGrid components, **so that** I can structure complex layouts.

**Acceptance Criteria:**
- [ ] AC1: All 7 container types available in library
- [ ] AC2: Containers accept child components (drop targets)
- [ ] AC3: Tab views show tab bar with switchable content areas
- [ ] AC4: SplitView shows resizable divider between panels
- [ ] AC5: DataGrid shows column headers with sample rows

**Priority:** P1
**Estimated Effort:** 8 hours
**Dependencies:** US-07, US-01

#### DT-30: Define schemas for container components
**Parent Story:** US-09 | **Time:** 30 min
**Description:** Create schemas for: panel, section, tab_view, split_view, collapsible, modal, side_drawer, data_grid, table. Each with child-acceptance rules and layout properties.
**Files:** `src/core/component-schema.ts`, `src/types/index.ts`
**Test:** `getSchema('tab_view')` returns `{acceptsChildren: true, props: {tabs: [], activeTab: 0}}`.

#### DT-31: Implement parent-child drop targeting
**Parent Story:** US-09 | **Time:** 45 min
**Description:** When dragging a component over a container, highlight the container as a valid drop target. On drop inside a container, set `parent_id` to the container's ID and position relative to container bounds.
**Files:** `src/views/plan-builder.ts`, `src/core/database.ts`
**Test:** Drop a Button inside a Panel — Button's parent_id is Panel's ID.

#### DT-32: Render tab view with tab switching
**Parent Story:** US-09 | **Time:** 45 min
**Description:** Render TabView on canvas with tab bar at top. Each tab is clickable, switching which child components are visible.
**Files:** `src/views/plan-builder.ts`
**Test:** Click Tab 2 in a TabView — children of Tab 2 become visible, Tab 1 children hide.

#### DT-33: Render split view with draggable divider
**Parent Story:** US-09 | **Time:** 30 min
**Description:** Render SplitView with two panels and a draggable divider between them. Dragging the divider resizes the panels proportionally.
**Files:** `src/views/plan-builder.ts`
**Test:** Drag divider right — left panel grows, right panel shrinks.

#### DT-34: Render data grid with column headers
**Parent Story:** US-09 | **Time:** 45 min
**Description:** Render DataGrid with configurable columns (name, type, width), header row, and sample data rows. Columns are resizable.
**Files:** `src/views/plan-builder.ts`
**Test:** Drop a DataGrid — shows Name, Status, Date, Actions columns with 3 sample rows.

---

### US-10: Use IF/THEN logic blocks with visual editor

**As a** program designer, **I want** to use visual IF/THEN/ELSE logic blocks, **so that** I can define conditional behavior without writing code.

**Acceptance Criteria:**
- [ ] AC1: IF block has condition field with dropdown operators
- [ ] AC2: THEN block has action field with action type dropdown
- [ ] AC3: ELSE block is optional, shows alternative action
- [ ] AC4: Blocks are visually connected with flow lines
- [ ] AC5: Generated code preview updates as blocks change

**Priority:** P2
**Estimated Effort:** 8 hours
**Dependencies:** US-07, US-08

#### DT-35: Define LogicBlock type and schema
**Parent Story:** US-10 | **Time:** 30 min
**Description:** Add `LogicBlock` interface to types. Create schema entries for: if_block, then_block, else_block, and_block, or_block, loop_block, try_catch_block.
**Files:** `src/types/index.ts`, `src/core/component-schema.ts`
**Test:** `LogicBlock` type compiles with all required fields.

#### DT-36: Render IF/THEN/ELSE visual blocks on canvas
**Parent Story:** US-10 | **Time:** 45 min
**Description:** Render logic blocks with distinct visual styles: IF (blue header), THEN (green header), ELSE (orange header). Show condition/action text inside each block. Connect with flow arrows.
**Files:** `src/views/plan-builder.ts`
**Test:** Drop IF block — renders blue header with "IF" label, condition field, and "is met" dropdown.

#### DT-37: Build condition editor with operators
**Parent Story:** US-10 | **Time:** 45 min
**Description:** When editing an IF block condition, show: left operand (text/dropdown), operator (equals, not equals, greater than, less than, contains, is empty, is true), right operand.
**Files:** `src/views/plan-builder.ts`
**Test:** Set condition "user.age > 18" — condition field displays "user.age is greater than 18".

#### DT-38: Build action editor with action types
**Parent Story:** US-10 | **Time:** 30 min
**Description:** When editing a THEN/ELSE block, show action type dropdown: Perform Task, Navigate To, Show Alert, Set Value, Call API, Run Script. Each shows appropriate sub-fields.
**Files:** `src/views/plan-builder.ts`
**Test:** Select "Navigate To" action — shows route/page selector sub-field.

#### DT-39: Generate code preview from logic blocks
**Parent Story:** US-10 | **Time:** 45 min
**Description:** Convert the visual logic block tree into TypeScript code. Show in a read-only code preview panel below the canvas.
**Files:** `src/core/coding-agent.ts`
**Test:** IF age > 18 THEN allow ELSE deny → generates `if (user.age > 18) { allow(); } else { deny(); }`.

---

### US-11: Use data and sync widgets

**As a** program designer, **I want** to use sync status, change history, and storage binding widgets, **so that** I can build multi-device aware applications.

**Acceptance Criteria:**
- [ ] AC1: Sync Status widget shows current sync state with progress
- [ ] AC2: Change History widget shows timeline of recent changes
- [ ] AC3: Cloud & NAS Sync widget shows connection status with configure buttons
- [ ] AC4: Local Storage binding widget maps UI to storage keys

**Priority:** P2
**Estimated Effort:** 4 hours
**Dependencies:** US-07, Sync Service (US-22)

#### DT-40: Define schemas for data/sync components
**Parent Story:** US-11 | **Time:** 30 min
**Description:** Create schemas for: sync_status, change_history, cloud_sync, nas_sync, p2p_sync, storage_binding, state_viewer.
**Files:** `src/core/component-schema.ts`
**Test:** All 7 schemas registered with appropriate props and events.

#### DT-41: Render sync status widget on canvas
**Parent Story:** US-11 | **Time:** 30 min
**Description:** Render as a card showing: "Sync Status" header, status text (Syncing.../Resolving Conflict.../Up to date), progress indicator, "View Details" link.
**Files:** `src/views/plan-builder.ts`
**Test:** Drop Sync Status widget — renders card with current sync state.

#### DT-42: Render change history widget on canvas
**Parent Story:** US-11 | **Time:** 30 min
**Description:** Render as a scrollable list with timestamped entries: "04/15/2023 - File synced on Laptop", "04/14/2023 - Permission changed: Action B", etc.
**Files:** `src/views/plan-builder.ts`
**Test:** Drop Change History widget — renders timeline with sample entries.

---

### US-12: Use ethics and rights components

**As a** program designer, **I want** to use Freedom Module cards, sensitivity sliders, and transparency log viewers, **so that** I can build ethically-aware applications.

**Acceptance Criteria:**
- [ ] AC1: Freedom Module card shows module name, sensitivity slider, and toggle options
- [ ] AC2: Sensitivity slider ranges from Low to High with visual feedback
- [ ] AC3: Rule exceptions table shows Allow/Block columns with Edit/Delete actions
- [ ] AC4: Transparency log viewer shows timestamped action entries

**Priority:** P2
**Estimated Effort:** 4 hours
**Dependencies:** US-07, Ethics Engine (US-26)

#### DT-43: Define schemas for ethics/rights components
**Parent Story:** US-12 | **Time:** 30 min
**Description:** Create schemas for: freedom_module_card, sensitivity_slider, rule_exceptions_table, monitoring_toggle, transparency_log_viewer.
**Files:** `src/core/component-schema.ts`
**Test:** All 5 schemas registered with appropriate props.

#### DT-44: Render Freedom Module card on canvas
**Parent Story:** US-12 | **Time:** 30 min
**Description:** Render as a card with: module name header, Low-High sensitivity slider, checkboxes for options (e.g., "Log Access Attempts", "Block Tracking Scripts").
**Files:** `src/views/plan-builder.ts`
**Test:** Drop Freedom Module card — renders with slider and configurable options.

#### DT-45: Render rule exceptions table on canvas
**Parent Story:** US-12 | **Time:** 30 min
**Description:** Render as a data table with columns: Name, Date, Actions (Edit/Delete). Shows allow/block rules with action buttons.
**Files:** `src/views/plan-builder.ts`
**Test:** Drop rule exceptions table — renders with sample Allow/Block rows.

---

## Epic 3: Integrated AI Coding Agent

> A Copilot-style coding agent built into the designer that interprets natural language, generates code, explains changes, and enforces ethical boundaries.

---

### US-13: Ask the coding agent natural-language questions

**As a** program designer, **I want** to type questions or commands in natural language, **so that** the agent can help me build my program.

**Acceptance Criteria:**
- [ ] AC1: Command bar at top of canvas accepts text input
- [ ] AC2: Agent responds within 5 seconds for simple commands
- [ ] AC3: Agent understands "add", "remove", "change", "explain", "fix" intents
- [ ] AC4: Response appears in a chat panel or inline toast
- [ ] AC5: Command history accessible with up/down arrows

**Priority:** P1
**Estimated Effort:** 6 hours
**Dependencies:** LLM Service (existing)

#### DT-46: Build command bar UI in designer canvas
**Parent Story:** US-13 | **Time:** 30 min
**Description:** Add a command bar input at the top of the canvas with placeholder "Ask the agent anything..." and a send button. Style to match existing design system.
**Files:** `src/views/plan-builder.ts`
**Test:** Command bar visible, accepts text input, sends on Enter.

#### DT-47: Implement intent classifier for coding agent
**Parent Story:** US-13 | **Time:** 45 min
**Description:** Create `CodingAgentService.classifyIntent()` using the existing LLM service. Two-stage: keyword match first, LLM fallback. Intents: build, modify, explain, fix, automate, query.
**Files:** `src/core/coding-agent.ts` (new file)
**Test:** "Add a login form" → `build`, "Why does this button look wrong?" → `explain`.

#### DT-48: Route classified intents to handlers
**Parent Story:** US-13 | **Time:** 30 min
**Description:** Create handler methods for each intent: `handleBuild()`, `handleModify()`, `handleExplain()`, `handleFix()`, `handleAutomate()`, `handleQuery()`. Wire to the intent classifier output.
**Files:** `src/core/coding-agent.ts`
**Test:** "Add a text field" routes to `handleBuild()` which creates a TextBox component.

#### DT-49: Build chat/response panel UI
**Parent Story:** US-13 | **Time:** 30 min
**Description:** Add a collapsible chat panel (bottom or right) showing agent responses with timestamps. Support markdown rendering in responses.
**Files:** `src/views/plan-builder.ts`
**Test:** Send command — response appears in chat panel with formatted text.

#### DT-50: Implement command history
**Parent Story:** US-13 | **Time:** 15 min
**Description:** Store last 50 commands in memory. Up/Down arrow keys in command bar cycle through history.
**Files:** `src/views/plan-builder.ts`
**Test:** Send 3 commands, press Up arrow — shows previous command.

---

### US-14: Agent generates code from visual design

**As a** program designer, **I want** the agent to generate code files from my visual design, **so that** my design becomes a runnable application.

**Acceptance Criteria:**
- [ ] AC1: "Generate Code" button triggers full code generation
- [ ] AC2: Supports React TSX, HTML, and CSS output formats
- [ ] AC3: Generated code is clean, readable, and properly formatted
- [ ] AC4: Output includes file structure (components, styles, pages)
- [ ] AC5: Code passes ethics validation before delivery

**Priority:** P1
**Estimated Effort:** 8 hours
**Dependencies:** US-08, US-09, Component Schema Service

#### DT-51: Implement component tree extraction
**Parent Story:** US-14 | **Time:** 30 min
**Description:** Extract the full component hierarchy from the current design page: all components with parent-child relationships, positions, styles, and props.
**Files:** `src/core/coding-agent.ts`, `src/core/database.ts`
**Test:** Page with 10 components → tree structure with correct nesting.

#### DT-52: Implement React TSX code generation
**Parent Story:** US-14 | **Time:** 45 min
**Description:** Extend `DesignerEngine.exportToReact()` to handle all new component types. Generate proper TSX with imports, props, and className bindings.
**Files:** `src/core/designer-engine.ts`
**Test:** Page with Button + TextBox + Panel → valid `.tsx` file that compiles.

#### DT-53: Implement HTML/CSS code generation
**Parent Story:** US-14 | **Time:** 45 min
**Description:** Extend `DesignerEngine.exportToHTML()` and `exportToCSS()` to handle all new component types.
**Files:** `src/core/designer-engine.ts`
**Test:** Page with Form layout → valid `.html` + `.css` files.

#### DT-54: Add ethics validation gate to code generation
**Parent Story:** US-14 | **Time:** 30 min
**Description:** Before returning generated code, pass it through `EthicsEngine.evaluateCode()` to check for prohibited patterns (tracking, data collection without consent, etc.).
**Files:** `src/core/coding-agent.ts`, `src/core/ethics-engine.ts`
**Test:** Code with `navigator.geolocation` → ethics warning unless privacy module allows it.

#### DT-55: Build code output viewer panel
**Parent Story:** US-14 | **Time:** 30 min
**Description:** Create a panel that shows generated code with syntax highlighting, file tabs (one per output file), and a "Copy" button.
**Files:** `src/views/plan-builder.ts`
**Test:** Generate code → panel shows files with syntax-highlighted TypeScript/HTML/CSS.

---

### US-15: Preview generated code in real-time

**As a** program designer, **I want** to see a live preview of the generated code as I design, **so that** I understand what the agent is creating.

**Acceptance Criteria:**
- [ ] AC1: Preview panel shows rendered output of current design
- [ ] AC2: Preview updates within 2 seconds of design changes
- [ ] AC3: Viewport toggle (Mobile 375px, Tablet 768px, Desktop 1280px)
- [ ] AC4: Preview button in bottom bar opens the panel

**Priority:** P2
**Estimated Effort:** 4 hours
**Dependencies:** US-14

#### DT-56: Build preview panel with iframe renderer
**Parent Story:** US-15 | **Time:** 45 min
**Description:** Create a preview panel that generates HTML from the current design and renders it in a sandboxed iframe. Debounce updates to 500ms.
**Files:** `src/views/plan-builder.ts`
**Test:** Place a Button on canvas — preview shows rendered button within 2s.

#### DT-57: Add viewport toggle for responsive preview
**Parent Story:** US-15 | **Time:** 30 min
**Description:** Add Mobile/Tablet/Desktop toggle buttons. Each sets the iframe width to 375px/768px/1280px. Apply responsive overrides from component `responsive` field.
**Files:** `src/views/plan-builder.ts`
**Test:** Toggle to Mobile — preview iframe shrinks to 375px width, responsive rules apply.

---

### US-16: Agent explains code in simple terms

**As a** program designer, **I want** the agent to explain any generated code in simple language, **so that** I can learn programming while using the tool.

**Acceptance Criteria:**
- [ ] AC1: "Explain" button on each code block
- [ ] AC2: Explanation is non-technical, uses analogies where helpful
- [ ] AC3: Explanation highlights which design elements map to which code

**Priority:** P3
**Estimated Effort:** 3 hours
**Dependencies:** US-14, LLM Service

#### DT-58: Implement code explanation via LLM
**Parent Story:** US-16 | **Time:** 45 min
**Description:** Create `CodingAgentService.explainCode(code, context)` that sends code to LLM with a prompt requesting simple, non-technical explanation.
**Files:** `src/core/coding-agent.ts`
**Test:** Explain a form handler → response mentions "when the user clicks submit, this sends the data to..."

#### DT-59: Build explanation overlay UI
**Parent Story:** US-16 | **Time:** 30 min
**Description:** Add "Explain" button to code viewer. On click, show explanation in a callout/tooltip panel next to the code block with line-by-line annotations.
**Files:** `src/views/plan-builder.ts`
**Test:** Click "Explain" on a React component → explanation panel appears.

---

### US-17: Review diffs before code is applied

**As a** program designer, **I want** to review diffs before the agent commits changes, **so that** I remain in full control of my project.

**Acceptance Criteria:**
- [ ] AC1: Agent shows side-by-side diff (before/after)
- [ ] AC2: Changed lines highlighted in green (additions) and red (deletions)
- [ ] AC3: User can Approve, Reject, or Edit before applying
- [ ] AC4: Rejected diffs are logged with reason

**Priority:** P1
**Estimated Effort:** 4 hours
**Dependencies:** US-14

#### DT-60: Implement diff generation engine
**Parent Story:** US-17 | **Time:** 45 min
**Description:** Create `CodingAgentService.generateDiff(oldCode, newCode)` that produces a line-by-line diff with additions, deletions, and unchanged lines.
**Files:** `src/core/coding-agent.ts`
**Test:** Old code 5 lines, new code 7 lines → diff shows 2 additions and 0 deletions.

#### DT-61: Build diff viewer UI with approve/reject buttons
**Parent Story:** US-17 | **Time:** 45 min
**Description:** Create a diff viewer panel with side-by-side layout, color-coded changes, and Approve / Reject / Edit buttons at the bottom.
**Files:** `src/views/plan-builder.ts`
**Test:** Code change generates diff → viewer shows colored diff with action buttons.

#### DT-62: Log diff approval/rejection with transparency logger
**Parent Story:** US-17 | **Time:** 30 min
**Description:** On approve or reject, call `TransparencyLogger.logAction()` with the diff details, decision, and timestamp.
**Files:** `src/core/transparency-logger.ts`, `src/core/coding-agent.ts`
**Test:** Reject a diff → action log entry created with reason "rejected by user".

---

### US-18: Agent builds IF/THEN rules from natural language

**As a** program designer, **I want** to describe logic in plain English and have the agent create visual IF/THEN blocks, **so that** I don't need to script logic by hand.

**Acceptance Criteria:**
- [ ] AC1: "When user clicks Submit, validate form, if valid send data, else show errors" → 3 connected logic blocks
- [ ] AC2: Generated blocks are editable in the visual editor
- [ ] AC3: Agent explains the logic it created

**Priority:** P2
**Estimated Effort:** 4 hours
**Dependencies:** US-10, US-13

#### DT-63: Implement NL-to-logic-block converter
**Parent Story:** US-18 | **Time:** 45 min
**Description:** Create `CodingAgentService.buildLogicTree(naturalLanguage)` that uses LLM to parse natural language into a `LogicBlock[]` tree structure.
**Files:** `src/core/coding-agent.ts`
**Test:** "If logged in show dashboard else show login" → `[{type:'if', condition:'user.isLoggedIn'}, {type:'then', action:'showDashboard'}, {type:'else', action:'showLogin'}]`.

#### DT-64: Place generated logic blocks on canvas
**Parent Story:** US-18 | **Time:** 30 min
**Description:** After generating logic blocks, create corresponding `DesignComponent` entries on the canvas with visual flow connections.
**Files:** `src/core/coding-agent.ts`, `src/core/database.ts`
**Test:** NL command creates 3 connected blocks on canvas in vertical flow layout.

---

### US-19: Agent breaks complex tasks into subtasks automatically

**As a** program designer, **I want** the agent to decompose complex requests into subtasks, **so that** the result is correct and reliable.

**Acceptance Criteria:**
- [ ] AC1: "Build a login system" decomposes into 5+ subtasks
- [ ] AC2: Each subtask is 15-45 minutes
- [ ] AC3: Dependencies between subtasks are tracked
- [ ] AC4: User can review and modify the decomposition

**Priority:** P2
**Estimated Effort:** 3 hours
**Dependencies:** US-13, Planning Agent (existing)

#### DT-65: Implement auto-decomposition for complex commands
**Parent Story:** US-19 | **Time:** 45 min
**Description:** When `CodingAgentService` receives a command estimated at >45 min, call the existing Planning Agent to decompose it into subtasks. Display the task tree for user approval.
**Files:** `src/core/coding-agent.ts`, `src/agents/orchestrator.ts`
**Test:** "Build a user management system" → tree of 8 subtasks with dependencies.

#### DT-66: Build decomposition review UI
**Parent Story:** US-19 | **Time:** 30 min
**Description:** Show the generated subtask tree in a modal with approve/edit/reject options. User can rename, reorder, or remove subtasks before confirming.
**Files:** `src/views/plan-builder.ts`
**Test:** Review modal shows task tree — user edits a task name and approves.

---

### US-20: Agent refuses unsafe or unethical commands

**As a** program designer, **I want** the agent to refuse harmful commands and explain why, **so that** nothing dangerous is ever created.

**Acceptance Criteria:**
- [ ] AC1: "Add tracking pixel" → blocked if privacy module is active
- [ ] AC2: "Generate backdoor" → always blocked
- [ ] AC3: Blocked action shows explanation and safe alternative
- [ ] AC4: All blocks are logged in ethics audit

**Priority:** P1
**Estimated Effort:** 3 hours
**Dependencies:** Ethics Engine (US-26)

#### DT-67: Implement ethics pre-check in command pipeline
**Parent Story:** US-20 | **Time:** 30 min
**Description:** Before any command is executed, pass it through `EthicsEngine.evaluateAction()`. If blocked, return the block reason and do not proceed.
**Files:** `src/core/coding-agent.ts`, `src/core/ethics-engine.ts`
**Test:** "Add a keylogger" → blocked with reason "Violates privacy module: unauthorized data collection".

#### DT-68: Build blocked-action UI with explanation
**Parent Story:** US-20 | **Time:** 30 min
**Description:** When a command is blocked, show a warning panel with: the command, the reason it was blocked, which module blocked it, and suggested safe alternatives.
**Files:** `src/views/plan-builder.ts`
**Test:** Blocked command shows red warning with "This action was blocked by the Privacy module."

#### DT-69: Log all blocked actions to ethics audit
**Parent Story:** US-20 | **Time:** 15 min
**Description:** Every blocked action creates an `EthicsAuditEntry` in the database with the command, block reason, module, timestamp.
**Files:** `src/core/ethics-engine.ts`, `src/core/database.ts`
**Test:** Block a command → `ethics_audit` table has new entry.

---

## Epic 4: Multi-Device Sync

> Cloud, NAS, and P2P sync backends with distributed locking, conflict resolution, and version histories for seamless multi-computer workflows.

---

### US-21: Install on multiple computers and continue work

**As a** user, **I want** to install on my home PC, work laptop, and tablet and pick up where I left off, **so that** I can work from anywhere.

**Acceptance Criteria:**
- [ ] AC1: Device registers itself on first launch
- [ ] AC2: Shared project opens with latest state from any device
- [ ] AC3: Offline changes sync when connectivity returns

**Priority:** P2
**Estimated Effort:** 6 hours
**Dependencies:** Sync Service infrastructure

#### DT-70: Implement device registration
**Parent Story:** US-21 | **Time:** 30 min
**Description:** On first launch, generate a device ID (UUID), store in local config, register with sync backend (device name, OS, last active timestamp).
**Files:** `src/core/sync-service.ts` (new), `src/core/config.ts`
**Test:** First launch creates device entry; second launch reuses same ID.

#### DT-71: Implement offline change queue
**Parent Story:** US-21 | **Time:** 45 min
**Description:** When offline, queue all database changes in a local `sync_outbox` table. When connectivity returns, flush the outbox in order.
**Files:** `src/core/sync-service.ts`, `src/core/database.ts`
**Test:** Make 5 changes offline, reconnect → all 5 changes synced.

---

### US-22: Choose sync type (Cloud, NAS, P2P)

**As a** user, **I want** to choose how my data syncs between devices, **so that** I control where my data lives.

**Acceptance Criteria:**
- [ ] AC1: Settings panel shows 3 sync options (Cloud, NAS, P2P)
- [ ] AC2: Each option has appropriate configuration fields
- [ ] AC3: Sync mode can be changed at any time
- [ ] AC4: Connection test button validates configuration

**Priority:** P2
**Estimated Effort:** 6 hours
**Dependencies:** US-21

#### DT-72: Build sync configuration UI
**Parent Story:** US-22 | **Time:** 30 min
**Description:** Add "Sync Settings" section to settings panel with radio buttons for Cloud/NAS/P2P. Each shows relevant config fields (Cloud: endpoint URL; NAS: share path; P2P: discovery port).
**Files:** `src/views/plan-builder.ts` or settings webview
**Test:** Select NAS → shows "NAS Path" input field.

#### DT-73: Implement CloudSyncAdapter
**Parent Story:** US-22 | **Time:** 45 min
**Description:** Create adapter that syncs via HTTPS REST to a cloud endpoint. Methods: push(changes), pull(), getStatus().
**Files:** `src/core/sync-service.ts`
**Test:** Push 3 changes to mock cloud endpoint → response confirms receipt.

#### DT-74: Implement NASSyncAdapter
**Parent Story:** US-22 | **Time:** 45 min
**Description:** Create adapter that syncs via file operations on a network share (SMB/NFS path). Uses file-based locking.
**Files:** `src/core/sync-service.ts`
**Test:** Write sync file to NAS path → other device reads and applies changes.

#### DT-75: Implement P2PSyncAdapter
**Parent Story:** US-22 | **Time:** 45 min
**Description:** Create adapter that syncs directly between devices via TCP or WebRTC. Includes device discovery on local network.
**Files:** `src/core/sync-service.ts`
**Test:** Two devices on same network discover each other and exchange changes.

---

### US-23: Instances sync without conflicts

**As a** user, **I want** multiple running instances to cooperate peacefully, **so that** my data is never corrupted.

**Acceptance Criteria:**
- [ ] AC1: Distributed advisory locking prevents simultaneous edits to same resource
- [ ] AC2: Non-overlapping changes merge automatically
- [ ] AC3: Overlapping changes trigger Conflict Resolution mode
- [ ] AC4: All sync operations logged in transparency log

**Priority:** P2
**Estimated Effort:** 6 hours
**Dependencies:** US-22

#### DT-76: Implement distributed advisory locking
**Parent Story:** US-23 | **Time:** 45 min
**Description:** Create lock mechanism: acquire_lock(resource_id, device_id), release_lock(). Stale lock detection after 5 minutes. Lock storage depends on sync backend.
**Files:** `src/core/conflict-resolver.ts` (new)
**Test:** Device A locks resource → Device B's lock attempt returns "locked by Device A".

#### DT-77: Implement field-level change detection
**Parent Story:** US-23 | **Time:** 45 min
**Description:** Track which fields changed per entity per sync cycle. Use SHA-256 hashes per field for efficient comparison.
**Files:** `src/core/conflict-resolver.ts`
**Test:** Device A changes title, Device B changes description → no conflict (different fields).

#### DT-78: Implement automatic merge for non-overlapping changes
**Parent Story:** US-23 | **Time:** 30 min
**Description:** When both devices changed different fields, auto-merge by taking the latest value for each field.
**Files:** `src/core/conflict-resolver.ts`
**Test:** Device A changes x, Device B changes y → merged result has both changes.

---

### US-24: View sync status and resolve conflicts manually

**As a** user, **I want** to see sync status and manually resolve conflicts, **so that** I'm always in control.

**Acceptance Criteria:**
- [ ] AC1: Sync status indicator in bottom bar (green=synced, yellow=syncing, red=conflict)
- [ ] AC2: Conflict resolution dialog shows both versions side-by-side
- [ ] AC3: User can choose: keep local, keep remote, or merge manually

**Priority:** P2
**Estimated Effort:** 4 hours
**Dependencies:** US-23

#### DT-79: Add sync status indicator to bottom bar
**Parent Story:** US-24 | **Time:** 30 min
**Description:** Show a colored dot and text in the bottom bar: green "Synced", yellow "Syncing...", red "Conflict (1)". Clicking opens sync details panel.
**Files:** `src/views/plan-builder.ts`
**Test:** During sync, indicator shows yellow with "Syncing..." text.

#### DT-80: Build conflict resolution dialog
**Parent Story:** US-24 | **Time:** 45 min
**Description:** Modal showing: conflict summary, side-by-side comparison (local vs remote values for each conflicting field), and three buttons: Keep Local, Keep Remote, Merge Manually.
**Files:** `src/views/plan-builder.ts`
**Test:** Conflict on title field → dialog shows both versions with action buttons.

---

### US-25: View change history across all devices

**As a** user, **I want** to see a unified change history from all devices, **so that** I can track what happened and when.

**Acceptance Criteria:**
- [ ] AC1: Change history panel shows all sync changes chronologically
- [ ] AC2: Each entry shows: timestamp, device, what changed, who made the change
- [ ] AC3: History is filterable by device and date range

**Priority:** P3
**Estimated Effort:** 3 hours
**Dependencies:** US-23

#### DT-81: Build change history panel
**Parent Story:** US-25 | **Time:** 30 min
**Description:** Create a panel showing `sync_changes` entries with device icon, timestamp, change description, and entity link.
**Files:** `src/views/plan-builder.ts`, `src/core/sync-service.ts`
**Test:** 10 sync changes from 2 devices → history shows all 10 with correct device labels.

#### DT-82: Add device and date filters to history
**Parent Story:** US-25 | **Time:** 30 min
**Description:** Add dropdown filter for device selection and date range picker. Filter `sync_changes` query accordingly.
**Files:** `src/views/plan-builder.ts`
**Test:** Filter by "Work Laptop" → only changes from that device shown.

---

## Epic 5: Ethics & Rights Framework

> FreedomGuard_AI-based ethics system with configurable freedom modules, sensitivity controls, runtime ethics auditor, and permission manifests.

---

### US-26: Enable and disable freedom modules

**As a** user, **I want** to enable or disable modules like Privacy, Speech, and Self-Protection, **so that** I control my program's ethical boundaries.

**Acceptance Criteria:**
- [ ] AC1: Settings panel lists all available modules with toggle switches
- [ ] AC2: Each module shows description and current sensitivity level
- [ ] AC3: Enabling/disabling takes effect immediately
- [ ] AC4: Change is logged in ethics audit

**Priority:** P1
**Estimated Effort:** 4 hours
**Dependencies:** None

#### DT-83: Create EthicsEngine service
**Parent Story:** US-26 | **Time:** 45 min
**Description:** Create `EthicsEngine` class with: `getModules()`, `enableModule(id)`, `disableModule(id)`, `evaluateAction(action)`. Load modules from `ethics_modules` database table.
**Files:** `src/core/ethics-engine.ts` (new), `src/types/index.ts`
**Test:** Enable privacy module → `getModules()` shows privacy as active.

#### DT-84: Create ethics_modules and ethics_rules database tables
**Parent Story:** US-26 | **Time:** 30 min
**Description:** Add CREATE TABLE statements and CRUD methods for `ethics_modules` (id, name, description, enabled, sensitivity) and `ethics_rules` (id, module_id, type, action, allowed).
**Files:** `src/core/database.ts`, `src/types/index.ts`
**Test:** Create module, add 3 rules → all persisted and retrievable.

#### DT-85: Build ethics settings panel UI
**Parent Story:** US-26 | **Time:** 30 min
**Description:** Add "Ethics & Rights" section to settings with module list. Each module shows: name, description, enabled toggle, sensitivity display.
**Files:** `src/views/plan-builder.ts`
**Test:** Toggle Privacy module off → module disabled, logged in ethics audit.

---

### US-27: Configure sensitivity levels per module

**As a** user, **I want** to set sensitivity from Low to Maximum for each module, **so that** I control how strictly rules are enforced.

**Acceptance Criteria:**
- [ ] AC1: Each module has a sensitivity slider (Low/Medium/High/Maximum)
- [ ] AC2: Low = log only, Medium = warn + block violations, High = ask permission, Maximum = manual only
- [ ] AC3: Sensitivity change takes effect immediately

**Priority:** P2
**Estimated Effort:** 2 hours
**Dependencies:** US-26

#### DT-86: Add sensitivity levels to EthicsEngine
**Parent Story:** US-27 | **Time:** 30 min
**Description:** Implement `setSensitivity(moduleId, level)` where level is 1-4. Modify `evaluateAction()` to check sensitivity: 1=log, 2=warn+block, 3=ask, 4=block all.
**Files:** `src/core/ethics-engine.ts`
**Test:** Set privacy to High (3) → any data action prompts "Permission required".

#### DT-87: Add sensitivity slider to module UI
**Parent Story:** US-27 | **Time:** 30 min
**Description:** Add a 4-step slider (Low/Medium/High/Maximum) to each module card in settings. Update database on change.
**Files:** `src/views/plan-builder.ts`
**Test:** Move slider to High → label updates, database updated.

---

### US-28: View transparency log of all actions

**As a** user, **I want** to see a log of everything the agent did, **so that** I can audit its behavior.

**Acceptance Criteria:**
- [ ] AC1: Transparency Log panel shows all logged actions chronologically
- [ ] AC2: Each entry shows: timestamp, category, action, ethics check result
- [ ] AC3: Filterable by category (code_gen, ethics, sync, etc.)
- [ ] AC4: Exportable as JSON or CSV

**Priority:** P1
**Estimated Effort:** 4 hours
**Dependencies:** US-26

#### DT-88: Create TransparencyLogger service
**Parent Story:** US-28 | **Time:** 30 min
**Description:** Create `TransparencyLogger` class with: `logAction(entry)`, `getLog(filters)`, `exportLog(format)`. Stores in `action_log` database table.
**Files:** `src/core/transparency-logger.ts` (new), `src/core/database.ts`
**Test:** Log 5 actions → `getLog()` returns all 5 in chronological order.

#### DT-89: Create action_log database table
**Parent Story:** US-28 | **Time:** 30 min
**Description:** Add `action_log` table: id, timestamp, device_id, category, action, detail, input, output, ethics_check, user_approved, metadata.
**Files:** `src/core/database.ts`
**Test:** Insert and query action log entries successfully.

#### DT-90: Build Transparency Log viewer panel
**Parent Story:** US-28 | **Time:** 30 min
**Description:** Create a panel with: filterable list of log entries, category dropdown filter, date range filter, export button (JSON/CSV).
**Files:** `src/views/plan-builder.ts`
**Test:** Open log viewer → shows all entries with filter controls.

#### DT-91: Implement log export (JSON and CSV)
**Parent Story:** US-28 | **Time:** 30 min
**Description:** Implement `TransparencyLogger.exportLog('json')` and `exportLog('csv')`. Trigger file download via VS Code API.
**Files:** `src/core/transparency-logger.ts`
**Test:** Export as CSV → valid CSV file with all log columns.

---

### US-29: Agent blocks harmful code generation

**As a** user, **I want** the system to block generation of backdoors, spyware, and tracking code, **so that** harmful code is never created.

**Acceptance Criteria:**
- [ ] AC1: Hardcoded blocklist of always-prohibited patterns
- [ ] AC2: Module-specific blocks based on sensitivity settings
- [ ] AC3: Block explanation provided to user
- [ ] AC4: User can override with explicit confirmation (logged)

**Priority:** P1
**Estimated Effort:** 3 hours
**Dependencies:** US-26

#### DT-92: Define hardcoded prohibited code patterns
**Parent Story:** US-29 | **Time:** 30 min
**Description:** Create a `PROHIBITED_PATTERNS` list in EthicsEngine: keylogger, backdoor, data exfiltration, cryptominer, reverse shell, credential harvesting. These are always blocked regardless of settings.
**Files:** `src/core/ethics-engine.ts`
**Test:** `evaluateCode('keylogger.start()')` → always blocked.

#### DT-93: Implement code scanning for prohibited patterns
**Parent Story:** US-29 | **Time:** 30 min
**Description:** Implement `EthicsEngine.evaluateCode(code)` that scans generated code against prohibited patterns (regex + keyword matching) and module-specific rules.
**Files:** `src/core/ethics-engine.ts`
**Test:** Code with `navigator.sendBeacon` + privacy module active → blocked with "unauthorized data transmission".

#### DT-94: Implement user override with logging
**Parent Story:** US-29 | **Time:** 30 min
**Description:** When a module-specific (not hardcoded) block occurs, show "Override" button. On click, require explicit confirmation text, log override in ethics audit.
**Files:** `src/core/ethics-engine.ts`, `src/views/plan-builder.ts`
**Test:** Override a privacy block → ethics_audit entry with `status: 'override'`.

---

### US-30: Define allowed and blocked actions per module

**As a** user, **I want** to customize which actions each module allows or blocks, **so that** I have fine-grained control.

**Acceptance Criteria:**
- [ ] AC1: Each module shows a rules table with Allow/Block entries
- [ ] AC2: User can add custom rules
- [ ] AC3: Rules have descriptions explaining what they do
- [ ] AC4: Default rules provided for each module

**Priority:** P3
**Estimated Effort:** 3 hours
**Dependencies:** US-26

#### DT-95: Seed default rules for each module
**Parent Story:** US-30 | **Time:** 30 min
**Description:** On first launch (or ethics engine init), seed `ethics_rules` with default rules: Privacy (block tracking, block data collection, allow local storage), Speech (allow all content, block censorship), etc.
**Files:** `src/core/ethics-engine.ts`
**Test:** Fresh init → privacy module has 5 default rules.

#### DT-96: Build rules editor UI
**Parent Story:** US-30 | **Time:** 30 min
**Description:** Add a rules table to each module settings card showing: rule name, type (allow/block), description, Edit/Delete buttons, and "Add Rule" button.
**Files:** `src/views/plan-builder.ts`
**Test:** Add custom rule "Block camera access" → appears in rules table.

---

## Epic 6: Code Generation Pipeline

> Component-to-code mapping with templates for React, HTML, CSS, and JSON output. Real-time preview and custom template support.

---

### US-31: Export design to React TSX

**As a** developer, **I want** to export my design as React TSX components, **so that** I can use the generated code in a React project.

**Acceptance Criteria:**
- [ ] AC1: Each component maps to a React component with proper imports
- [ ] AC2: Props are typed with TypeScript interfaces
- [ ] AC3: Styles use CSS modules or inline styles (configurable)
- [ ] AC4: Output compiles without errors

**Priority:** P1
**Estimated Effort:** 4 hours
**Dependencies:** US-14, Component Schema Service

#### DT-97: Create code templates for all component types (React)
**Parent Story:** US-31 | **Time:** 45 min
**Description:** Define React TSX templates for each of the 50+ component types in `ComponentSchemaService`. Each template maps props and styles to JSX output.
**Files:** `src/core/component-schema.ts`
**Test:** `getCodeTemplate('button', 'react')` → valid TSX string with onClick prop.

#### DT-98: Generate TypeScript prop interfaces
**Parent Story:** US-31 | **Time:** 30 min
**Description:** For each component, generate a TypeScript interface for its props based on schema definition.
**Files:** `src/core/designer-engine.ts`
**Test:** Button schema → `interface ButtonProps { label: string; onClick?: () => void; disabled?: boolean; }`.

---

### US-32: Export design to HTML/CSS

**As a** developer, **I want** to export my design as static HTML and CSS files, **so that** I can use the output for prototypes or static sites.

**Acceptance Criteria:**
- [ ] AC1: Clean, semantic HTML output
- [ ] AC2: CSS with proper class names and media queries
- [ ] AC3: Responsive breakpoints applied from design settings

**Priority:** P1
**Estimated Effort:** 3 hours
**Dependencies:** US-14

#### DT-99: Create HTML templates for all component types
**Parent Story:** US-32 | **Time:** 45 min
**Description:** Define HTML templates for each component type. Use semantic elements where appropriate (form, nav, table, etc.).
**Files:** `src/core/component-schema.ts`
**Test:** `getCodeTemplate('data_grid', 'html')` → `<table>` with proper structure.

#### DT-100: Generate responsive CSS with media queries
**Parent Story:** US-32 | **Time:** 30 min
**Description:** From each component's `responsive` field (tablet/mobile overrides), generate `@media` queries in the CSS output.
**Files:** `src/core/designer-engine.ts`
**Test:** Component with mobile override `{display: 'none'}` → CSS includes `@media (max-width: 375px) { .comp { display: none; } }`.

---

### US-33: Live code preview as design changes

**As a** developer, **I want** to see code update in real-time as I modify the design, **so that** I understand the code impact of each change.

**Acceptance Criteria:**
- [ ] AC1: Code panel updates within 2 seconds of design change
- [ ] AC2: Changed lines are highlighted
- [ ] AC3: Multiple output formats shown in tabs

**Priority:** P2
**Estimated Effort:** 3 hours
**Dependencies:** US-14, US-15

#### DT-101: Implement debounced code regeneration
**Parent Story:** US-33 | **Time:** 30 min
**Description:** On any component change event, debounce 500ms, then regenerate code for current page. Diff against previous generation and highlight changed lines.
**Files:** `src/views/plan-builder.ts`, `src/core/coding-agent.ts`
**Test:** Move a component → code panel updates within 2s with position change highlighted.

#### DT-102: Add format tabs to code panel
**Parent Story:** US-33 | **Time:** 30 min
**Description:** Add tabs for React TSX, HTML, CSS, and JSON output formats. Each tab shows the generated code for that format.
**Files:** `src/views/plan-builder.ts`
**Test:** Click CSS tab → shows CSS output for current design.

---

### US-34: Component-to-code mapping with custom templates

**As a** power user, **I want** to define custom code templates for components, **so that** generated code matches my project's conventions.

**Acceptance Criteria:**
- [ ] AC1: Template editor accessible from component settings
- [ ] AC2: Templates use mustache-style variables ({{props.label}}, {{styles.color}})
- [ ] AC3: Custom templates override defaults
- [ ] AC4: Templates saved per project

**Priority:** P3
**Estimated Effort:** 4 hours
**Dependencies:** US-31

#### DT-103: Build template editor UI
**Parent Story:** US-34 | **Time:** 45 min
**Description:** Add a "Code Template" section to the Actions tab in Properties panel. Show a code editor with the current template and variable reference guide.
**Files:** `src/views/plan-builder.ts`
**Test:** Open template editor for Button → shows current React template with editable code.

#### DT-104: Implement custom template storage and override
**Parent Story:** US-34 | **Time:** 30 min
**Description:** Store custom templates in `component_schemas` table (per plan_id). When generating code, check for custom template first, fall back to default.
**Files:** `src/core/component-schema.ts`, `src/core/database.ts`
**Test:** Save custom button template → code generation uses custom template.

---

## Epic 7: Transparency & Logging

> Global action logging, per-task change history, code-generation audit trail, and export/import functionality.

---

### US-35: View global AI action log

**As a** user, **I want** to see every action the AI took, **so that** I maintain full oversight.

**Acceptance Criteria:**
- [ ] AC1: Action log panel shows all AI actions chronologically
- [ ] AC2: Each entry: timestamp, action type, description, result
- [ ] AC3: Color-coded by category (blue=code_gen, green=approved, red=blocked)
- [ ] AC4: Paginated for performance (50 entries per page)

**Priority:** P1
**Estimated Effort:** 3 hours
**Dependencies:** US-28

#### DT-105: Wire all AI actions to transparency logger
**Parent Story:** US-35 | **Time:** 45 min
**Description:** Add `TransparencyLogger.logAction()` calls to: CodingAgentService (every command, every code gen), EthicsEngine (every check), SyncService (every sync), Orchestrator (every route decision).
**Files:** `src/core/coding-agent.ts`, `src/core/ethics-engine.ts`, `src/core/sync-service.ts`, `src/agents/orchestrator.ts`
**Test:** Execute 5 different operations → action_log has 5+ entries covering all categories.

#### DT-106: Build paginated action log viewer
**Parent Story:** US-35 | **Time:** 30 min
**Description:** Create action log panel with pagination (50 per page), infinite scroll or page buttons, and category color coding.
**Files:** `src/views/plan-builder.ts`
**Test:** 200 log entries → first page shows 50, scroll loads next 50.

---

### US-36: View per-task change history

**As a** user, **I want** to see the change history for any specific task or component, **so that** I can trace what happened.

**Acceptance Criteria:**
- [ ] AC1: Each task/component has a "History" tab
- [ ] AC2: Shows all changes made to that entity chronologically
- [ ] AC3: Each entry shows: what changed, who changed it (user/agent/sync), when

**Priority:** P2
**Estimated Effort:** 2 hours
**Dependencies:** US-35

#### DT-107: Filter action log by entity ID
**Parent Story:** US-36 | **Time:** 30 min
**Description:** Add `getLog({entityId})` filter to TransparencyLogger. Match against metadata.entityId field in action_log entries.
**Files:** `src/core/transparency-logger.ts`
**Test:** `getLog({entityId: 'comp-123'})` → returns only entries related to that component.

#### DT-108: Add History tab to Properties panel
**Parent Story:** US-36 | **Time:** 30 min
**Description:** Add a "History" tab to the right-side Properties panel that shows the filtered action log for the selected component.
**Files:** `src/views/plan-builder.ts`
**Test:** Select a Button → History tab shows 3 entries: created, moved, resized.

---

### US-37: Export and import logs

**As a** user, **I want** to export logs for auditing and import them on other devices, **so that** I maintain records.

**Acceptance Criteria:**
- [ ] AC1: Export as JSON or CSV
- [ ] AC2: Import validates format and appends to existing log
- [ ] AC3: Export supports date range filtering

**Priority:** P3
**Estimated Effort:** 2 hours
**Dependencies:** US-28

#### DT-109: Implement log import with validation
**Parent Story:** US-37 | **Time:** 30 min
**Description:** Implement `TransparencyLogger.importLog(data, format)` that validates structure (required fields, valid timestamps) and appends entries to action_log.
**Files:** `src/core/transparency-logger.ts`
**Test:** Import valid JSON with 10 entries → action_log grows by 10.

#### DT-110: Add import button to log viewer
**Parent Story:** US-37 | **Time:** 15 min
**Description:** Add "Import" button to log viewer. Opens file picker, reads file, calls importLog().
**Files:** `src/views/plan-builder.ts`
**Test:** Click Import, select JSON file → entries appear in log.

---

### US-38: Code-generation audit trail

**As a** user, **I want** a dedicated audit trail for all generated code, **so that** I can review what the agent built.

**Acceptance Criteria:**
- [ ] AC1: Every code generation creates a timestamped snapshot
- [ ] AC2: Snapshots include: input (design state), output (code), diff, approval status
- [ ] AC3: Audit trail is searchable by date and component

**Priority:** P2
**Estimated Effort:** 3 hours
**Dependencies:** US-14, US-28

#### DT-111: Create code_diffs database table
**Parent Story:** US-38 | **Time:** 30 min
**Description:** Add `code_diffs` table: id, plan_id, page_id, old_code, new_code, diff_text, format, status (pending/approved/rejected), created_at.
**Files:** `src/core/database.ts`
**Test:** Insert and query code diff entries.

#### DT-112: Store code generation snapshots
**Parent Story:** US-38 | **Time:** 30 min
**Description:** After every code generation, store the design state hash, generated code, and diff in `code_diffs` table.
**Files:** `src/core/coding-agent.ts`, `src/core/database.ts`
**Test:** Generate code → new entry in code_diffs with correct old/new code.

#### DT-113: Build code audit trail viewer
**Parent Story:** US-38 | **Time:** 30 min
**Description:** Create a panel showing code generation history: list of diffs with timestamps, formats, approval status. Click to expand and see the diff.
**Files:** `src/views/plan-builder.ts`
**Test:** 5 code generations → audit trail shows 5 entries, clickable to view diff.

---

## Summary

| Epic | Stories | Tasks | Priority | Estimated Hours |
|------|---------|-------|----------|-----------------|
| 1. Designer Canvas | 6 | 23 | P1/P2 | 23 |
| 2. Component Library | 6 | 22 | P1/P2 | 33 |
| 3. AI Coding Agent | 8 | 24 | P1/P2/P3 | 35 |
| 4. Multi-Device Sync | 5 | 13 | P2/P3 | 25 |
| 5. Ethics & Rights | 5 | 14 | P1/P2/P3 | 16 |
| 6. Code Generation | 4 | 8 | P1/P2/P3 | 14 |
| 7. Transparency & Logging | 4 | 9 | P1/P2/P3 | 10 |
| **Total** | **38** | **113** | | **~156 hours** |

### Implementation Order (Recommended)

**Sprint 1 (Foundation):** US-07, US-26, US-28 — Component library, ethics engine, transparency logger
**Sprint 2 (Canvas Core):** US-01, US-02, US-04 — Drag/drop, selection, properties
**Sprint 3 (Components):** US-08, US-09, US-10 — Primitive inputs, containers, logic blocks
**Sprint 4 (Agent Core):** US-13, US-14, US-17, US-20 — NL commands, code gen, diffs, ethics blocking
**Sprint 5 (Canvas Polish):** US-03, US-05, US-06, US-15 — Multi-select, zoom, undo, preview
**Sprint 6 (Sync):** US-21, US-22, US-23, US-24 — Device registration, sync backends, conflict resolution
**Sprint 7 (Advanced):** US-11, US-12, US-18, US-19 — Data/sync widgets, ethics components, NL logic, auto-decomposition
**Sprint 8 (Export & Polish):** US-31, US-32, US-33, US-35, US-38 — Code export, live preview, audit trail
**Sprint 9 (Power User):** US-16, US-25, US-27, US-29, US-30, US-34, US-36, US-37 — Explanations, history, sensitivity, custom templates
