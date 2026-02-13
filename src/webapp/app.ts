export function getAppHtml(port: number): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>COE — Copilot Orchestration Extension</title>
<style>
:root {
    --bg: #1e1e2e; --bg2: #181825; --bg3: #313244; --surface: #45475a;
    --text: #cdd6f4; --subtext: #a6adc8; --overlay: #6c7086;
    --blue: #89b4fa; --green: #a6e3a1; --red: #f38ba8; --yellow: #f9e2af;
    --mauve: #cba6f7; --teal: #94e2d5; --peach: #fab387;
    --border: #45475a; --radius: 8px;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }

/* NAV */
.topnav { display: flex; align-items: center; background: var(--bg2); border-bottom: 1px solid var(--border); padding: 0 20px; height: 52px; position: sticky; top: 0; z-index: 100; }
.topnav .logo { font-weight: 700; font-size: 1.1em; color: var(--blue); margin-right: 32px; letter-spacing: -0.5px; }
.topnav .tabs { display: flex; gap: 4px; }
.topnav .tab { padding: 8px 16px; border-radius: 6px; cursor: pointer; color: var(--subtext); font-size: 0.9em; font-weight: 500; transition: all 0.15s; border: none; background: none; }
.topnav .tab:hover { background: var(--bg3); color: var(--text); }
.topnav .tab.active { background: var(--bg3); color: var(--blue); }
.topnav .status { margin-left: auto; display: flex; align-items: center; gap: 12px; font-size: 0.85em; }
.topnav .status .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.topnav .status .dot.online { background: var(--green); }
.topnav .status .dot.offline { background: var(--red); }

/* MAIN */
.main { max-width: 1200px; margin: 0 auto; padding: 24px 20px; }
.page { display: none; }
.page.active { display: block; }

/* CARDS */
.card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
.card { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; }
.card .val { font-size: 2em; font-weight: 700; color: var(--blue); }
.card .lbl { font-size: 0.8em; color: var(--subtext); margin-top: 2px; }

/* PROGRESS BAR */
.progress-wrap { margin-bottom: 24px; }
.progress-bar { height: 20px; background: var(--bg3); border-radius: 10px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--green); border-radius: 10px; transition: width 0.5s; }
.progress-text { text-align: center; margin-top: 6px; font-weight: 600; font-size: 0.9em; }

/* TABLES */
table { width: 100%; border-collapse: collapse; background: var(--bg2); border-radius: var(--radius); overflow: hidden; }
th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid var(--border); }
th { font-size: 0.8em; text-transform: uppercase; color: var(--subtext); font-weight: 600; background: var(--bg3); }
tr:hover td { background: rgba(137,180,250,0.05); }
tr:last-child td { border-bottom: none; }

/* BADGES */
.badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 0.75em; font-weight: 600; }
.badge-green { background: rgba(166,227,161,0.15); color: var(--green); }
.badge-blue { background: rgba(137,180,250,0.15); color: var(--blue); }
.badge-red { background: rgba(243,139,168,0.15); color: var(--red); }
.badge-yellow { background: rgba(249,226,175,0.15); color: var(--yellow); }
.badge-mauve { background: rgba(203,166,247,0.15); color: var(--mauve); }
.badge-gray { background: rgba(108,112,134,0.15); color: var(--overlay); }

/* BUTTONS */
button, .btn { padding: 8px 18px; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.9em; transition: all 0.15s; }
.btn-primary { background: var(--blue); color: var(--bg); }
.btn-primary:hover { filter: brightness(1.1); }
.btn-success { background: var(--green); color: var(--bg); }
.btn-danger { background: var(--red); color: var(--bg); }
.btn-secondary { background: var(--bg3); color: var(--text); }
.btn-secondary:hover { background: var(--surface); }
.btn-sm { padding: 4px 10px; font-size: 0.8em; }
.btn-row { display: flex; gap: 8px; margin-top: 16px; }

/* FORMS */
input, textarea, select { width: 100%; padding: 10px 12px; background: var(--bg3); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font-family: inherit; font-size: 0.95em; margin-top: 4px; }
input:focus, textarea:focus, select:focus { outline: none; border-color: var(--blue); }
textarea { min-height: 80px; resize: vertical; }
label { display: block; margin-top: 12px; font-weight: 500; font-size: 0.9em; color: var(--subtext); }
.form-group { margin-bottom: 12px; }

/* MODAL */
.modal-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); z-index: 200; align-items: center; justify-content: center; }
.modal-overlay.open { display: flex; }
.modal { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; padding: 24px; width: 90%; max-width: 600px; max-height: 80vh; overflow-y: auto; }
.modal h2 { margin-bottom: 16px; font-size: 1.2em; }
.modal-close { float: right; background: none; border: none; color: var(--subtext); cursor: pointer; font-size: 1.2em; }

/* SECTION */
h1 { font-size: 1.4em; margin-bottom: 4px; }
h2 { font-size: 1.1em; margin: 20px 0 10px; color: var(--text); }
.subtitle { color: var(--subtext); margin-bottom: 20px; font-size: 0.9em; }
.section { margin-bottom: 24px; }
.empty { text-align: center; padding: 40px; color: var(--subtext); }
.clickable { cursor: pointer; }
.clickable:hover { color: var(--blue); }

/* AUDIT */
.audit-entry { padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 0.9em; }
.audit-entry:last-child { border-bottom: none; }
.audit-time { color: var(--overlay); font-size: 0.8em; }
.audit-agent { color: var(--mauve); font-weight: 600; }

/* DETAIL PANEL */
.detail-panel { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; margin-top: 16px; }
.detail-panel h3 { margin-bottom: 12px; }
.detail-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 0.9em; }
.detail-row:last-child { border-bottom: none; }

/* THREAD */
.thread-reply { padding: 12px; margin-bottom: 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); }
.thread-reply.user { border-left: 3px solid var(--blue); }
.thread-reply.agent { border-left: 3px solid var(--mauve); }
.thread-reply .author { font-weight: 600; font-size: 0.85em; }
.thread-reply .body { margin-top: 4px; white-space: pre-wrap; }
.thread-reply .meta { color: var(--overlay); font-size: 0.8em; margin-top: 4px; }

/* WIZARD */
.wizard-steps { display: flex; gap: 8px; margin-bottom: 20px; }
.wizard-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--bg3); transition: all 0.2s; }
.wizard-dot.active { background: var(--blue); }
.wizard-dot.done { background: var(--green); }
.wizard-step { display: none; }
.wizard-step.active { display: block; }
.option-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.option-btn { padding: 8px 16px; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; background: var(--bg); color: var(--text); transition: all 0.15s; }
.option-btn:hover { border-color: var(--blue); }
.option-btn.selected { border-color: var(--blue); background: rgba(137,180,250,0.1); color: var(--blue); }

/* SPINNER */
.spinner { display: inline-block; width: 18px; height: 18px; border: 2px solid var(--subtext); border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; vertical-align: middle; margin-right: 8px; }
@keyframes spin { to { transform: rotate(360deg); } }
.loading-overlay { text-align: center; padding: 40px; }

/* RESPONSIVE */
@media (max-width: 768px) {
    .topnav { padding: 0 10px; overflow-x: auto; }
    .topnav .tab { padding: 6px 10px; font-size: 0.8em; white-space: nowrap; }
    .main { padding: 16px 10px; }
    .card-grid { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }
    .wizard-layout { flex-direction: column; }
    .wizard-right { width: 100%; position: static; }
}

/* WIZARD LAYOUT */
.wizard-layout { display: flex; gap: 24px; }
.wizard-left { flex: 1; min-width: 0; }
.wizard-right { width: 280px; flex-shrink: 0; }

/* IMPACT SIMULATOR */
.impact-panel { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; position: sticky; top: 70px; }
.impact-panel h3 { font-size: 0.95em; color: var(--blue); margin-bottom: 12px; }
.impact-metric { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 0.9em; }
.impact-metric:last-child { border-bottom: none; }
.impact-metric .imp-label { color: var(--subtext); }
.impact-metric .imp-value { font-weight: 600; color: var(--text); }

/* DESIGN CARDS */
.design-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-top: 10px; }
.design-card { background: var(--bg2); border: 2px solid var(--border); border-radius: var(--radius); padding: 14px; cursor: pointer; text-align: center; transition: all 0.15s; }
.design-card:hover { border-color: var(--blue); transform: translateY(-1px); }
.design-card.selected { border-color: var(--blue); background: rgba(137,180,250,0.08); box-shadow: 0 0 0 1px var(--blue); }
.design-card .preview { font-size: 1.8em; margin-bottom: 6px; line-height: 1.3; color: var(--overlay); }
.design-card strong { display: block; font-size: 0.9em; margin-bottom: 2px; }
.design-card span { font-size: 0.8em; color: var(--subtext); }
.step-desc { color: var(--subtext); font-size: 0.9em; margin: 4px 0 10px; }

/* DRAG & DROP TREE */
.drag-tree { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px; min-height: 200px; }
.drag-node { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid transparent; border-radius: 6px; margin-bottom: 2px; cursor: grab; font-size: 0.9em; transition: all 0.1s; background: var(--bg); }
.drag-node:hover { border-color: var(--border); background: var(--bg3); }
.drag-node.dragging { opacity: 0.4; transform: scale(0.97); }
.drag-node.drop-target { border-color: var(--blue); background: rgba(137,180,250,0.1); }
.drag-node .drag-grip { color: var(--overlay); cursor: grab; flex-shrink: 0; }
.drag-node .drag-icon { flex-shrink: 0; }
.drag-node .drag-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.drag-node .drag-prio { font-size: 0.75em; font-weight: 700; padding: 2px 6px; border-radius: 4px; }
.drag-node .prio-p1 { color: var(--red); background: rgba(243,139,168,0.1); }
.drag-node .prio-p2 { color: var(--yellow); background: rgba(249,226,175,0.1); }
.drag-node .prio-p3 { color: var(--overlay); background: rgba(108,112,134,0.1); }
.drag-node .drag-est { font-size: 0.8em; color: var(--subtext); flex-shrink: 0; }
.drag-children { padding-left: 24px; border-left: 2px solid var(--border); margin-left: 12px; margin-bottom: 4px; }
.drop-zone { height: 4px; border-radius: 2px; margin: 2px 0; transition: all 0.15s; }
.drop-zone.drop-target { height: 24px; background: rgba(137,180,250,0.15); border: 1px dashed var(--blue); }

/* CONTEXT MENU */
.context-menu { position: fixed; background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 4px; z-index: 300; min-width: 160px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
.ctx-item { padding: 8px 14px; border-radius: 4px; cursor: pointer; font-size: 0.9em; }
.ctx-item:hover { background: var(--bg3); }
.ctx-danger { color: var(--red); }
.ctx-danger:hover { background: rgba(243,139,168,0.1); }

/* DESIGN PREVIEW */
.preview-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 16px; }
.preview-card { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 12px; text-align: center; }
.preview-card strong { display: block; font-size: 0.8em; color: var(--subtext); text-transform: uppercase; margin-bottom: 4px; }
.preview-card span { font-size: 0.95em; font-weight: 600; }
.preview-wireframe { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; font-family: monospace; font-size: 0.85em; color: var(--subtext); line-height: 1.5; white-space: pre; overflow-x: auto; }

/* ===== SETTINGS TAB ===== */
.settings-grid { display: grid; grid-template-columns: 220px 1fr; gap: 0; min-height: 600px; background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.settings-nav { border-right: 1px solid var(--border); padding: 8px 0; }
.settings-nav-item { padding: 10px 20px; cursor: pointer; font-size: 0.9em; color: var(--subtext); transition: all 0.15s; border-left: 3px solid transparent; }
.settings-nav-item:hover { background: var(--bg3); color: var(--text); }
.settings-nav-item.active { background: var(--bg3); color: var(--blue); border-left-color: var(--blue); font-weight: 600; }
.settings-panel { padding: 24px; overflow-y: auto; max-height: 700px; }
.settings-section { margin-bottom: 24px; }
.settings-section h3 { font-size: 1em; color: var(--blue); margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
.setting-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid rgba(69,71,90,0.3); }
.setting-row:last-child { border-bottom: none; }
.setting-label { flex: 1; }
.setting-label strong { display: block; font-size: 0.9em; }
.setting-label span { font-size: 0.8em; color: var(--subtext); }
.setting-control { flex-shrink: 0; width: 240px; }
.setting-control input, .setting-control select { width: 100%; margin-top: 0; }
.toggle-switch { position: relative; width: 44px; height: 24px; background: var(--bg3); border-radius: 12px; cursor: pointer; transition: all 0.2s; }
.toggle-switch.on { background: var(--green); }
.toggle-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; background: white; border-radius: 50%; transition: all 0.2s; }
.toggle-switch.on::after { left: 22px; }

/* ===== VISUAL DESIGNER ===== */
.designer-layout { display: grid; grid-template-columns: 240px 1fr 280px; gap: 0; height: calc(100vh - 120px); background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.designer-sidebar { border-right: 1px solid var(--border); display: flex; flex-direction: column; }
.designer-sidebar h3 { padding: 12px 16px; font-size: 0.9em; color: var(--blue); border-bottom: 1px solid var(--border); margin: 0; }
.comp-palette { flex: 1; overflow-y: auto; padding: 8px; }
.comp-palette-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; margin-bottom: 4px; cursor: grab; font-size: 0.85em; background: var(--bg); transition: all 0.15s; }
.comp-palette-item:hover { border-color: var(--blue); background: var(--bg3); }
.comp-palette-item .comp-icon { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: var(--bg3); border-radius: 4px; font-size: 0.9em; }
.designer-canvas-wrap { position: relative; overflow: auto; background: repeating-conic-gradient(var(--bg3) 0% 25%, var(--bg) 0% 50%) 0 0 / 20px 20px; }
.designer-canvas { position: relative; margin: 20px; background: var(--bg); border: 1px solid var(--border); box-shadow: 0 4px 24px rgba(0,0,0,0.3); transform-origin: top left; }
.design-el { position: absolute; border: 1px solid transparent; cursor: move; transition: border-color 0.1s; min-width: 10px; min-height: 10px; }
.design-el:hover { border-color: rgba(137,180,250,0.3); }
.design-el.selected { border-color: var(--blue); outline: 1px dashed var(--blue); outline-offset: 1px; }
.design-el .resize-handle { position: absolute; width: 8px; height: 8px; background: var(--blue); border-radius: 2px; display: none; }
.design-el.selected .resize-handle { display: block; }
.resize-handle.se { bottom: -4px; right: -4px; cursor: se-resize; }
.resize-handle.sw { bottom: -4px; left: -4px; cursor: sw-resize; }
.resize-handle.ne { top: -4px; right: -4px; cursor: ne-resize; }
.resize-handle.nw { top: -4px; left: -4px; cursor: nw-resize; }
.resize-handle.n { top: -4px; left: 50%; transform: translateX(-50%); cursor: n-resize; }
.resize-handle.s { bottom: -4px; left: 50%; transform: translateX(-50%); cursor: s-resize; }
.resize-handle.e { top: 50%; right: -4px; transform: translateY(-50%); cursor: e-resize; }
.resize-handle.w { top: 50%; left: -4px; transform: translateY(-50%); cursor: w-resize; }
.designer-props { border-left: 1px solid var(--border); overflow-y: auto; padding: 0; }
.designer-props h3 { padding: 12px 16px; font-size: 0.9em; color: var(--blue); border-bottom: 1px solid var(--border); margin: 0; position: sticky; top: 0; background: var(--bg2); z-index: 5; }
.prop-section { padding: 12px 16px; border-bottom: 1px solid var(--border); }
.prop-section h4 { font-size: 0.8em; text-transform: uppercase; color: var(--subtext); margin-bottom: 8px; }
.prop-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.prop-row label { font-size: 0.8em; color: var(--subtext); width: 60px; flex-shrink: 0; }
.prop-row input, .prop-row select { flex: 1; padding: 4px 8px; font-size: 0.85em; margin-top: 0; }
.prop-row input[type="color"] { width: 32px; height: 24px; padding: 0; cursor: pointer; }
.prop-row input[type="number"] { width: 60px; }
.page-tabs { display: flex; gap: 2px; padding: 8px; border-bottom: 1px solid var(--border); overflow-x: auto; background: var(--bg3); }
.page-tab { padding: 6px 14px; border-radius: 6px 6px 0 0; cursor: pointer; font-size: 0.8em; background: var(--bg); color: var(--subtext); border: 1px solid var(--border); border-bottom: none; }
.page-tab.active { background: var(--bg2); color: var(--blue); font-weight: 600; }
.page-tab-add { padding: 6px 10px; cursor: pointer; color: var(--overlay); font-size: 0.8em; }
.page-tab-add:hover { color: var(--blue); }

/* ===== RESPONSIVE PREVIEW ===== */
.responsive-bar { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: var(--bg2); border-bottom: 1px solid var(--border); }
.responsive-btn { padding: 4px 12px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--subtext); cursor: pointer; font-size: 0.8em; }
.responsive-btn.active { border-color: var(--blue); color: var(--blue); background: rgba(137,180,250,0.08); }
.zoom-control { margin-left: auto; display: flex; align-items: center; gap: 4px; font-size: 0.8em; color: var(--subtext); }
.zoom-control input { width: 60px; margin-top: 0; }

/* ===== CODING CONVERSATION ===== */
.coding-layout { display: grid; grid-template-columns: 240px 1fr; gap: 0; height: calc(100vh - 120px); background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.coding-sidebar { border-right: 1px solid var(--border); display: flex; flex-direction: column; }
.coding-sidebar h3 { padding: 12px 16px; font-size: 0.9em; color: var(--blue); border-bottom: 1px solid var(--border); margin: 0; }
.session-list { flex: 1; overflow-y: auto; padding: 4px; }
.session-item { padding: 10px 12px; border-radius: 6px; cursor: pointer; font-size: 0.85em; margin-bottom: 2px; }
.session-item:hover { background: var(--bg3); }
.session-item.active { background: var(--bg3); color: var(--blue); }
.session-item .session-name { font-weight: 500; }
.session-item .session-meta { font-size: 0.75em; color: var(--overlay); margin-top: 2px; }
.coding-main { display: flex; flex-direction: column; }
.coding-header { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
.coding-messages { flex: 1; overflow-y: auto; padding: 16px; }
.coding-msg { margin-bottom: 12px; max-width: 85%; }
.coding-msg.user { margin-left: auto; }
.coding-msg.agent { margin-right: auto; }
.coding-msg .msg-bubble { padding: 10px 14px; border-radius: 12px; font-size: 0.9em; line-height: 1.5; white-space: pre-wrap; }
.coding-msg.user .msg-bubble { background: var(--blue); color: var(--bg); border-bottom-right-radius: 4px; }
.coding-msg.agent .msg-bubble { background: var(--bg3); color: var(--text); border-bottom-left-radius: 4px; }
.coding-msg.system .msg-bubble { background: rgba(249,226,175,0.1); color: var(--yellow); border: 1px solid rgba(249,226,175,0.2); text-align: center; font-size: 0.8em; max-width: 100%; }
.coding-msg .msg-role { font-size: 0.75em; font-weight: 600; margin-bottom: 3px; }
.coding-msg.user .msg-role { color: var(--blue); text-align: right; }
.coding-msg.agent .msg-role { color: var(--mauve); }
.coding-msg.system .msg-role { color: var(--yellow); text-align: center; }
.coding-msg .msg-meta { font-size: 0.75em; color: var(--overlay); margin-top: 4px; }
.coding-msg .msg-tools { margin-top: 6px; font-size: 0.8em; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; }
.coding-msg .msg-tools strong { color: var(--mauve); }
.coding-msg.loading .msg-bubble { background: var(--bg3); color: var(--subtext); font-style: italic; animation: pulse 1.5s infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
.coding-msg .msg-bubble pre { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px; margin: 8px 0; overflow-x: auto; font-family: 'Cascadia Code', 'Fira Code', monospace; font-size: 0.85em; line-height: 1.4; white-space: pre; }
.coding-msg .msg-bubble code { font-family: 'Cascadia Code', 'Fira Code', monospace; font-size: 0.9em; }
.msg-confidence { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.7em; font-weight: 600; margin-left: 8px; }
.confidence-high { background: rgba(166,227,161,0.15); color: var(--green); }
.confidence-mid { background: rgba(249,226,175,0.15); color: var(--yellow); }
.confidence-low { background: rgba(243,139,168,0.15); color: var(--red); }
.coding-input { padding: 12px 16px; border-top: 1px solid var(--border); display: flex; gap: 8px; background: var(--bg2); }
.coding-input textarea { flex: 1; min-height: 40px; max-height: 120px; resize: vertical; margin-top: 0; }
.coding-input .btn { align-self: flex-end; }
.mcp-tools-list { padding: 4px 16px; border-bottom: 1px solid var(--border); display: flex; gap: 4px; flex-wrap: wrap; background: var(--bg3); }
.mcp-tool-chip { padding: 2px 8px; border-radius: 10px; font-size: 0.7em; background: rgba(203,166,247,0.15); color: var(--mauve); }

/* ===== DESIGN TOKENS ===== */
.token-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; margin-top: 8px; }
.token-card { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px; display: flex; align-items: center; gap: 8px; font-size: 0.85em; }
.token-card .token-swatch { width: 28px; height: 28px; border-radius: 4px; border: 1px solid var(--border); flex-shrink: 0; }
.token-card .token-info { flex: 1; overflow: hidden; }
.token-card .token-name { font-weight: 600; font-size: 0.85em; }
.token-card .token-val { font-size: 0.8em; color: var(--subtext); font-family: monospace; }

/* ===== LAYER PANEL ===== */
.layer-list { padding: 4px; }
.layer-item { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 4px; font-size: 0.8em; cursor: pointer; }
.layer-item:hover { background: var(--bg3); }
.layer-item.selected { background: var(--bg3); color: var(--blue); }
.layer-item .layer-icon { width: 16px; text-align: center; color: var(--overlay); }
.layer-item .layer-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

@media (max-width: 1024px) {
    .designer-layout { grid-template-columns: 1fr; }
    .designer-sidebar, .designer-props { display: none; }
    .coding-layout { grid-template-columns: 1fr; }
    .coding-sidebar { display: none; }
    .settings-grid { grid-template-columns: 1fr; }
    .settings-nav { display: none; }
}
</style>
</head>
<body>

<!-- TOP NAV -->
<div class="topnav">
    <span class="logo">COE</span>
    <div class="tabs">
        <button class="tab active" data-page="dashboard">Dashboard</button>
        <button class="tab" data-page="tasks">Tasks</button>
        <button class="tab" data-page="tickets">Tickets</button>
        <button class="tab" data-page="planning">Planning</button>
        <button class="tab" data-page="agents">Agents</button>
        <button class="tab" data-page="designer">Designer</button>
        <button class="tab" data-page="coding">Coding</button>
        <button class="tab" data-page="github">GitHub</button>
        <button class="tab" data-page="settings">Settings</button>
        <button class="tab" data-page="system">System</button>
    </div>
    <div class="status">
        <span class="dot online" id="statusDot"></span>
        <span id="statusText">MCP: port ${port}</span>
    </div>
</div>

<div class="main">
<!-- ==================== DASHBOARD ==================== -->
<div class="page active" id="page-dashboard">
    <h1>Dashboard</h1>
    <p class="subtitle" id="dashPlanName">Loading...</p>
    <div class="card-grid" id="dashCards"></div>
    <div class="progress-wrap" id="dashProgress" style="display:none">
        <h2>Plan Progress</h2>
        <div class="progress-bar"><div class="progress-fill" id="dashProgressFill"></div></div>
        <div class="progress-text" id="dashProgressText"></div>
    </div>
    <div class="section">
        <h2>Agents</h2>
        <table><thead><tr><th>Agent</th><th>Type</th><th>Status</th><th>Current Task</th></tr></thead>
        <tbody id="dashAgents"></tbody></table>
    </div>
    <div class="section">
        <h2>Recent Activity</h2>
        <div id="dashAudit" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius)"></div>
    </div>
</div>

<!-- ==================== TASKS ==================== -->
<div class="page" id="page-tasks">
    <div style="display:flex;justify-content:space-between;align-items:center">
        <h1>Tasks</h1>
        <button class="btn btn-primary" onclick="openModal('taskModal')">+ New Task</button>
    </div>
    <p class="subtitle">Manage your task queue</p>
    <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-sm btn-secondary task-filter active" data-filter="all">All</button>
        <button class="btn btn-sm btn-secondary task-filter" data-filter="not_started">Not Started</button>
        <button class="btn btn-sm btn-secondary task-filter" data-filter="in_progress">In Progress</button>
        <button class="btn btn-sm btn-secondary task-filter" data-filter="pending_verification">Pending</button>
        <button class="btn btn-sm btn-secondary task-filter" data-filter="verified">Verified</button>
        <button class="btn btn-sm btn-secondary task-filter" data-filter="failed">Failed</button>
    </div>
    <table>
        <thead><tr><th>Priority</th><th>Title</th><th>Status</th><th>Est.</th><th>Actions</th></tr></thead>
        <tbody id="taskTableBody"></tbody>
    </table>
    <div id="taskDetail"></div>
</div>

<!-- ==================== TICKETS ==================== -->
<div class="page" id="page-tickets">
    <div style="display:flex;justify-content:space-between;align-items:center">
        <h1>Tickets</h1>
        <button class="btn btn-primary" onclick="openModal('ticketModal')">+ New Ticket</button>
    </div>
    <p class="subtitle">Questions and decisions that need human input</p>
    <table>
        <thead><tr><th>#</th><th>Title</th><th>Status</th><th>Priority</th><th>Creator</th><th>Actions</th></tr></thead>
        <tbody id="ticketTableBody"></tbody>
    </table>
    <div id="ticketDetail"></div>
</div>

<!-- ==================== PLANNING ==================== -->
<div class="page" id="page-planning">
    <h1>Planning</h1>
    <p class="subtitle">Create and manage development plans</p>

    <!-- ===== WIZARD SECTION ===== -->
    <div class="section" id="wizardSection">
        <h2>Create New Plan</h2>
        <div class="wizard-steps" id="wizardDots"></div>
        <div class="wizard-layout">
            <div class="wizard-left">
                <!-- Step 0: Name & Description -->
                <div class="wizard-step active" id="wstep0">
                    <div class="form-group"><label for="wizName">Plan Name</label><input type="text" id="wizName" placeholder="e.g., My Web App MVP"></div>
                    <div class="form-group"><label for="wizDesc">Description</label><textarea id="wizDesc" placeholder="Describe what you want to build..."></textarea></div>
                    <div class="btn-row">
                        <button class="btn btn-primary" onclick="wizNext()">Next</button>
                        <button class="btn btn-secondary" onclick="wizQuick()">Quick Generate</button>
                    </div>
                </div>
                <!-- Step 1: Scale -->
                <div class="wizard-step" id="wstep1">
                    <label>Project Scale</label>
                    <p class="step-desc">How big is this project?</p>
                    <div class="option-grid" id="scaleOptions">
                        <div class="option-btn selected" data-val="MVP">MVP</div>
                        <div class="option-btn" data-val="Small">Small</div>
                        <div class="option-btn" data-val="Medium">Medium</div>
                        <div class="option-btn" data-val="Large">Large</div>
                        <div class="option-btn" data-val="Enterprise">Enterprise</div>
                    </div>
                    <div class="btn-row"><button class="btn btn-secondary" onclick="wizPrev()">Back</button><button class="btn btn-primary" onclick="wizNext()">Next</button></div>
                </div>
                <!-- Step 2: Focus -->
                <div class="wizard-step" id="wstep2">
                    <label>Primary Focus</label>
                    <p class="step-desc">What's your main focus?</p>
                    <div class="option-grid" id="focusOptions">
                        <div class="option-btn selected" data-val="Frontend">Frontend</div>
                        <div class="option-btn" data-val="Backend">Backend</div>
                        <div class="option-btn" data-val="Full Stack">Full Stack</div>
                    </div>
                    <div class="btn-row"><button class="btn btn-secondary" onclick="wizPrev()">Back</button><button class="btn btn-primary" onclick="wizNext()">Next</button></div>
                </div>
                <!-- Step 3: Priorities -->
                <div class="wizard-step" id="wstep3">
                    <label>Key Priorities (click to select)</label>
                    <p class="step-desc">Which parts matter most right now?</p>
                    <div class="option-grid" id="priorityOptions">
                        <div class="option-btn selected" data-val="Core business logic">Core logic</div>
                        <div class="option-btn" data-val="User authentication">Auth</div>
                        <div class="option-btn" data-val="Visual design & UX">Design/UX</div>
                        <div class="option-btn" data-val="Scalability & performance">Performance</div>
                        <div class="option-btn" data-val="Third-party integrations">Integrations</div>
                        <div class="option-btn" data-val="Testing & QA">Testing</div>
                        <div class="option-btn" data-val="Documentation">Docs</div>
                    </div>
                    <div class="btn-row"><button class="btn btn-secondary" onclick="wizPrev()">Back</button><button class="btn btn-primary" onclick="wizNext()">Next</button></div>
                </div>
                <!-- Step 4: Page Layout -->
                <div class="wizard-step" id="wstep4">
                    <label>Page Layout</label>
                    <p class="step-desc">How should the plan dashboard be organized?</p>
                    <div class="design-grid" data-field="layout">
                        <div class="design-card selected" data-val="sidebar"><div class="preview">|||</div><strong>Sidebar</strong><span>Fixed nav + content</span></div>
                        <div class="design-card" data-val="tabs"><div class="preview">===</div><strong>Tabs</strong><span>Top tab navigation</span></div>
                        <div class="design-card" data-val="wizard"><div class="preview">1-2-3</div><strong>Wizard</strong><span>Step-by-step flow</span></div>
                        <div class="design-card" data-val="custom"><div class="preview">*</div><strong>Custom</strong><span>Design your own</span></div>
                    </div>
                    <div class="btn-row"><button class="btn btn-secondary" onclick="wizPrev()">Back</button><button class="btn btn-primary" onclick="wizNext()">Next</button></div>
                </div>
                <!-- Step 5: Color Theme -->
                <div class="wizard-step" id="wstep5">
                    <label>Color Theme</label>
                    <p class="step-desc">Choose a visual theme for the interface</p>
                    <div class="design-grid" data-field="theme">
                        <div class="design-card" data-val="light"><div class="preview" style="background:#f5f5f5;color:#333;border-radius:6px;padding:4px">Aa</div><strong>Light</strong><span>Clean & bright</span></div>
                        <div class="design-card selected" data-val="dark"><div class="preview" style="background:#1e1e2e;color:#cdd6f4;border-radius:6px;padding:4px">Aa</div><strong>Dark</strong><span>Easy on the eyes</span></div>
                        <div class="design-card" data-val="high-contrast"><div class="preview" style="background:#000;color:#fff;border-radius:6px;padding:4px">Aa</div><strong>High Contrast</strong><span>Maximum readability</span></div>
                        <div class="design-card" data-val="custom"><div class="preview">?</div><strong>Custom</strong><span>Pick your colors</span></div>
                    </div>
                    <div class="btn-row"><button class="btn btn-secondary" onclick="wizPrev()">Back</button><button class="btn btn-primary" onclick="wizNext()">Next</button></div>
                </div>
                <!-- Step 6: Task Display -->
                <div class="wizard-step" id="wstep6">
                    <label>Task Display Format</label>
                    <p class="step-desc">How should tasks be visualized?</p>
                    <div class="design-grid" data-field="taskDisplay">
                        <div class="design-card selected" data-val="tree"><div class="preview">+-+-</div><strong>Tree</strong><span>Hierarchical view</span></div>
                        <div class="design-card" data-val="kanban"><div class="preview">|=|=|</div><strong>Kanban</strong><span>Column board</span></div>
                        <div class="design-card" data-val="grid"><div class="preview">[][][]</div><strong>Grid</strong><span>Card layout</span></div>
                        <div class="design-card" data-val="custom"><div class="preview">*</div><strong>Custom</strong><span>Your own format</span></div>
                    </div>
                    <div class="btn-row"><button class="btn btn-secondary" onclick="wizPrev()">Back</button><button class="btn btn-primary" onclick="wizNext()">Next</button></div>
                </div>
                <!-- Step 7: Dependency Visualization -->
                <div class="wizard-step" id="wstep7">
                    <label>Dependency Visualization</label>
                    <p class="step-desc">How should task dependencies be shown?</p>
                    <div class="design-grid" data-field="depViz">
                        <div class="design-card" data-val="network"><div class="preview">o-o-o</div><strong>Network Graph</strong><span>Connected nodes</span></div>
                        <div class="design-card selected" data-val="hierarchy"><div class="preview">V</div><strong>Hierarchy</strong><span>Parent-child tree</span></div>
                        <div class="design-card" data-val="timeline"><div class="preview">-->--></div><strong>Timeline</strong><span>Sequential flow</span></div>
                        <div class="design-card" data-val="list"><div class="preview">#</div><strong>List</strong><span>Simple dependency list</span></div>
                    </div>
                    <div class="btn-row"><button class="btn btn-secondary" onclick="wizPrev()">Back</button><button class="btn btn-primary" onclick="wizNext()">Next</button></div>
                </div>
                <!-- Step 8: Timeline -->
                <div class="wizard-step" id="wstep8">
                    <label>Timeline Representation</label>
                    <p class="step-desc">How do you want to see project timeline?</p>
                    <div class="design-grid" data-field="timeline">
                        <div class="design-card" data-val="gantt"><div class="preview">====</div><strong>Gantt Chart</strong><span>Time-based bars</span></div>
                        <div class="design-card selected" data-val="linear"><div class="preview">--></div><strong>Linear</strong><span>Simple timeline</span></div>
                        <div class="design-card" data-val="kanban"><div class="preview">|=|=|</div><strong>Kanban</strong><span>Status columns</span></div>
                        <div class="design-card" data-val="calendar"><div class="preview">[31]</div><strong>Calendar</strong><span>Date-based view</span></div>
                    </div>
                    <div class="btn-row"><button class="btn btn-secondary" onclick="wizPrev()">Back</button><button class="btn btn-primary" onclick="wizNext()">Next</button></div>
                </div>
                <!-- Step 9: Input Style -->
                <div class="wizard-step" id="wstep9">
                    <label>User Input Style</label>
                    <p class="step-desc">How should forms and edits work?</p>
                    <div class="design-grid" data-field="inputStyle">
                        <div class="design-card" data-val="inline"><div class="preview">_|</div><strong>Inline Edit</strong><span>Edit in place</span></div>
                        <div class="design-card selected" data-val="modal"><div class="preview">[X]</div><strong>Modal</strong><span>Popup dialogs</span></div>
                        <div class="design-card" data-val="sidebar"><div class="preview">|>|</div><strong>Sidebar Panel</strong><span>Slide-in panel</span></div>
                        <div class="design-card" data-val="fullpage"><div class="preview">[==]</div><strong>Full Page</strong><span>Dedicated form pages</span></div>
                    </div>
                    <div class="btn-row"><button class="btn btn-secondary" onclick="wizPrev()">Back</button><button class="btn btn-primary" onclick="wizNext()">Next</button></div>
                </div>
                <!-- Step 10: AI Level -->
                <div class="wizard-step" id="wstep10">
                    <label>AI Assistance Level</label>
                    <p class="step-desc">How much should AI help with your workflow?</p>
                    <div class="design-grid" data-field="aiLevel">
                        <div class="design-card" data-val="manual"><div class="preview">M</div><strong>Manual</strong><span>Full human control</span></div>
                        <div class="design-card selected" data-val="suggestions"><div class="preview">?!</div><strong>Suggestions</strong><span>AI recommends, you decide</span></div>
                        <div class="design-card" data-val="smart"><div class="preview">AI</div><strong>Smart Defaults</strong><span>AI fills, you review</span></div>
                        <div class="design-card" data-val="hybrid"><div class="preview">H+</div><strong>Hybrid</strong><span>AI auto-handles P3</span></div>
                    </div>
                    <div class="btn-row"><button class="btn btn-secondary" onclick="wizPrev()">Back</button><button class="btn btn-primary btn-success" onclick="wizGenerate()">Generate Plan</button></div>
                </div>
            </div>
            <!-- Impact Simulator (right panel) -->
            <div class="wizard-right">
                <div class="impact-panel" id="impactPanel">
                    <h3>Plan Impact Simulator</h3>
                    <div class="impact-metric"><span class="imp-label">Total Tasks</span><span class="imp-value" id="impTasks">--</span></div>
                    <div class="impact-metric"><span class="imp-label">P1 Critical</span><span class="imp-value" id="impP1">--</span></div>
                    <div class="impact-metric"><span class="imp-label">Timeline</span><span class="imp-value" id="impTime">--</span></div>
                    <div class="impact-metric"><span class="imp-label">Risk Level</span><span class="imp-value" id="impRisk">--</span></div>
                    <div class="impact-metric"><span class="imp-label">Tech Stack</span><span class="imp-value" id="impStack">--</span></div>
                </div>
            </div>
        </div>
        <div id="wizOutput" style="margin-top:16px;display:none"></div>
    </div>

    <!-- ===== PLAN DESIGNER (shown after generation) ===== -->
    <div class="section" id="planDesigner" style="display:none">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h2 id="pdPlanName">Plan Designer</h2>
            <div style="display:flex;gap:8px">
                <button class="btn btn-secondary btn-sm" onclick="pdAddPhase()">+ Phase</button>
                <button class="btn btn-secondary btn-sm" onclick="pdAddTask()">+ Task</button>
                <button class="btn btn-primary btn-sm" onclick="pdSave()">Save Order</button>
                <button class="btn btn-secondary btn-sm" onclick="pdBackToWizard()">New Plan</button>
            </div>
        </div>
        <!-- Design Preview -->
        <div id="designPreview" style="margin-bottom:16px">
            <div class="preview-grid">
                <div class="preview-card"><strong>Layout</strong><span id="pvLayout">--</span></div>
                <div class="preview-card"><strong>Theme</strong><span id="pvTheme">--</span></div>
                <div class="preview-card"><strong>Task View</strong><span id="pvDisplay">--</span></div>
                <div class="preview-card"><strong>Dependencies</strong><span id="pvDeps">--</span></div>
                <div class="preview-card"><strong>AI Level</strong><span id="pvAI">--</span></div>
            </div>
            <div class="preview-wireframe" id="wireframe"></div>
        </div>
        <!-- Drag & Drop Tree -->
        <div class="drag-tree" id="dragTree"><div class="empty">Loading tasks...</div></div>
    </div>

    <!-- Context Menu (global, hidden) -->
    <div class="context-menu" id="ctxMenu" style="display:none">
        <div class="ctx-item" onclick="ctxEdit()">Edit</div>
        <div class="ctx-item" onclick="ctxAddSub()">Add Sub-task</div>
        <div class="ctx-item ctx-danger" onclick="ctxDelete()">Delete</div>
    </div>

    <!-- Task Edit Modal -->
    <div class="modal-overlay" id="pdEditModal">
        <div class="modal">
            <button class="modal-close" onclick="closeModal('pdEditModal')">&times;</button>
            <h2>Edit Task</h2>
            <div class="form-group"><label for="pdEditTitle">Title</label><input type="text" id="pdEditTitle"></div>
            <div class="form-group"><label for="pdEditDesc">Description</label><textarea id="pdEditDesc"></textarea></div>
            <div class="form-group"><label for="pdEditPrio">Priority</label><select id="pdEditPrio"><option value="P1">P1 - Critical</option><option value="P2" selected>P2 - Important</option><option value="P3">P3 - Nice to Have</option></select></div>
            <div class="form-group"><label for="pdEditEst">Estimated Minutes</label><input type="number" id="pdEditEst" value="30" min="5" max="480"></div>
            <div class="form-group"><label for="pdEditAC">Acceptance Criteria</label><textarea id="pdEditAC"></textarea></div>
            <div class="btn-row"><button class="btn btn-primary" onclick="pdSaveEdit()">Save Changes</button></div>
        </div>
    </div>

    <div class="section">
        <h2>Existing Plans</h2>
        <div id="plansList"></div>
    </div>
</div>

<!-- ==================== AGENTS ==================== -->
<div class="page" id="page-agents">
    <h1>Agents</h1>
    <p class="subtitle">AI agents registered in the orchestration system</p>
    <div class="card-grid" id="agentCards"></div>
</div>

<!-- ==================== VISUAL DESIGNER ==================== -->
<div class="page" id="page-designer">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <h1>Visual Designer</h1>
        <div style="display:flex;gap:8px">
            <select id="designerPlanSelect" name="designerPlanSelect" style="width:200px;margin-top:0" onchange="loadDesignerForPlan(this.value)"><option value="">Select a plan...</option></select>
            <button class="btn btn-primary btn-sm" onclick="exportDesignSpec()">Export Spec</button>
        </div>
    </div>
    <div class="responsive-bar" id="designerBar" style="display:none">
        <button class="responsive-btn active" data-bp="desktop" onclick="setBreakpoint('desktop')">Desktop (1440)</button>
        <button class="responsive-btn" data-bp="tablet" onclick="setBreakpoint('tablet')">Tablet (768)</button>
        <button class="responsive-btn" data-bp="mobile" onclick="setBreakpoint('mobile')">Mobile (375)</button>
        <div class="zoom-control"><label for="canvasZoom">Zoom:</label><input type="range" id="canvasZoom" min="25" max="200" value="100" oninput="setCanvasZoom(this.value)"><span id="zoomLabel">100%</span></div>
    </div>
    <div id="designerContainer" style="display:none">
        <div class="page-tabs" id="pageTabs"></div>
        <div class="designer-layout">
            <!-- Component Palette + Layers -->
            <div class="designer-sidebar">
                <h3>Components</h3>
                <div class="comp-palette" id="compPalette">
                    <div class="comp-palette-item" draggable="true" data-comp="container"><div class="comp-icon">[ ]</div><span>Container</span></div>
                    <div class="comp-palette-item" draggable="true" data-comp="text"><div class="comp-icon">Aa</div><span>Text</span></div>
                    <div class="comp-palette-item" draggable="true" data-comp="button"><div class="comp-icon">Btn</div><span>Button</span></div>
                    <div class="comp-palette-item" draggable="true" data-comp="input"><div class="comp-icon">__</div><span>Input</span></div>
                    <div class="comp-palette-item" draggable="true" data-comp="image"><div class="comp-icon">Img</div><span>Image</span></div>
                    <div class="comp-palette-item" draggable="true" data-comp="card"><div class="comp-icon">[=]</div><span>Card</span></div>
                    <div class="comp-palette-item" draggable="true" data-comp="nav"><div class="comp-icon">Nav</div><span>Navbar</span></div>
                    <div class="comp-palette-item" draggable="true" data-comp="modal"><div class="comp-icon">[X]</div><span>Modal</span></div>
                    <div class="comp-palette-item" draggable="true" data-comp="sidebar"><div class="comp-icon">|||</div><span>Sidebar</span></div>
                    <div class="comp-palette-item" draggable="true" data-comp="header"><div class="comp-icon">H</div><span>Header</span></div>
                    <div class="comp-palette-item" draggable="true" data-comp="footer"><div class="comp-icon">__F</div><span>Footer</span></div>
                    <div class="comp-palette-item" draggable="true" data-comp="list"><div class="comp-icon">=-</div><span>List</span></div>
                    <div class="comp-palette-item" draggable="true" data-comp="table"><div class="comp-icon">|||</div><span>Table</span></div>
                    <div class="comp-palette-item" draggable="true" data-comp="form"><div class="comp-icon">F</div><span>Form</span></div>
                    <div class="comp-palette-item" draggable="true" data-comp="divider"><div class="comp-icon">---</div><span>Divider</span></div>
                    <div class="comp-palette-item" draggable="true" data-comp="icon"><div class="comp-icon">*</div><span>Icon</span></div>
                </div>
                <h3>Layers</h3>
                <div class="layer-list" id="layerList"></div>
            </div>
            <!-- Canvas -->
            <div class="designer-canvas-wrap" id="canvasWrap">
                <div class="designer-canvas" id="designCanvas" style="width:1440px;height:900px" onclick="onCanvasClick(event)" ondragover="onCanvasDragOver(event)" ondrop="onCanvasDrop(event)"></div>
            </div>
            <!-- Properties Panel -->
            <div class="designer-props">
                <h3>Properties</h3>
                <div id="propsPanel">
                    <div class="prop-section"><p style="color:var(--subtext);font-size:0.85em;padding:8px 0">Select a component to edit its properties</p></div>
                </div>
                <h3>Design Tokens</h3>
                <div id="tokenPanel" style="padding:12px 16px">
                    <button class="btn btn-sm btn-secondary" onclick="openTokenEditor()" style="width:100%;margin-bottom:8px">+ Add Token</button>
                    <div id="tokenList"></div>
                </div>
            </div>
        </div>
    </div>
    <div id="designerEmpty" class="empty" style="margin-top:40px">Select a plan above to start designing, or create a new plan in the Planning tab.</div>
</div>

<!-- ==================== CODING CONVERSATION ==================== -->
<div class="page" id="page-coding">
    <h1>Coding Conversation</h1>
    <p class="subtitle">Interact with coding agents — generate prompts, track responses, manage MCP tool calls</p>
    <div class="coding-layout">
        <div class="coding-sidebar">
            <h3>Sessions</h3>
            <div style="padding:8px"><button class="btn btn-sm btn-primary" onclick="newCodingSession()" style="width:100%">+ New Session</button></div>
            <div class="session-list" id="sessionList"></div>
            <h3>MCP Tools</h3>
            <div style="padding:8px;font-size:0.8em;color:var(--subtext)">
                <div class="mcp-tools-list" style="flex-direction:column;padding:8px">
                    <div class="mcp-tool-chip">getNextTask</div>
                    <div class="mcp-tool-chip">reportTaskDone</div>
                    <div class="mcp-tool-chip">askQuestion</div>
                    <div class="mcp-tool-chip">getErrors</div>
                    <div class="mcp-tool-chip">callCOEAgent</div>
                    <div class="mcp-tool-chip">scanCodeBase</div>
                </div>
            </div>
        </div>
        <div class="coding-main">
            <div class="coding-header">
                <span id="codingSessionName" style="font-weight:600">No session selected</span>
                <div style="display:flex;gap:8px">
                    <select id="codingTaskSelect" name="codingTaskSelect" style="width:180px;margin-top:0;font-size:0.85em"><option value="">Link to task...</option></select>
                    <button class="btn btn-sm btn-secondary" onclick="generatePromptFromTask()">Generate Prompt</button>
                    <button class="btn btn-sm btn-secondary" onclick="copyCodingToClipboard()">Copy All</button>
                </div>
            </div>
            <div class="coding-messages" id="codingMessages">
                <div class="empty">Start a session to begin the coding conversation.</div>
            </div>
            <div class="coding-input">
                <textarea id="codingInput" name="codingInput" placeholder="Type a message or paste agent response..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendCodingMsg()}"></textarea>
                <div style="display:flex;flex-direction:column;gap:4px">
                    <button class="btn btn-primary btn-sm" id="codingSendBtn" onclick="sendCodingMsg()">User Send</button>
                    <button class="btn btn-secondary btn-sm" id="codingAgentBtn" onclick="addAgentResponse()">Agent Response</button>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- ==================== SETTINGS ==================== -->
<div class="page" id="page-settings">
    <h1>Settings</h1>
    <p class="subtitle">Configure COE extension settings</p>
    <div class="settings-grid">
        <div class="settings-nav">
            <div class="settings-nav-item active" data-settings="llm" onclick="showSettingsSection('llm')">LLM Configuration</div>
            <div class="settings-nav-item" data-settings="agents" onclick="showSettingsSection('agents')">Agents</div>
            <div class="settings-nav-item" data-settings="tasks" onclick="showSettingsSection('tasks')">Task Queue</div>
            <div class="settings-nav-item" data-settings="verification" onclick="showSettingsSection('verification')">Verification</div>
            <div class="settings-nav-item" data-settings="github-settings" onclick="showSettingsSection('github-settings')">GitHub</div>
            <div class="settings-nav-item" data-settings="designer-settings" onclick="showSettingsSection('designer-settings')">Designer</div>
            <div class="settings-nav-item" data-settings="appearance" onclick="showSettingsSection('appearance')">Appearance</div>
            <div class="settings-nav-item" data-settings="advanced" onclick="showSettingsSection('advanced')">Advanced</div>
        </div>
        <div class="settings-panel" id="settingsPanel"></div>
    </div>
</div>

<!-- ==================== GITHUB ==================== -->
<div class="page" id="page-github">
    <h1>GitHub Issues</h1>
    <p class="subtitle">Synced issues from your GitHub repository</p>
    <div class="btn-row" style="margin-bottom:16px">
        <button class="btn btn-primary" onclick="syncGitHub()">Sync Now</button>
    </div>
    <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-sm btn-secondary gh-filter active" data-filter="all">All</button>
        <button class="btn btn-sm btn-secondary gh-filter" data-filter="open">Open</button>
        <button class="btn btn-sm btn-secondary gh-filter" data-filter="closed">Closed</button>
        <button class="btn btn-sm btn-secondary gh-filter" data-filter="linked">Linked to Task</button>
    </div>
    <table>
        <thead><tr><th>#</th><th>Title</th><th>State</th><th>Labels</th><th>Task</th><th>Actions</th></tr></thead>
        <tbody id="ghTableBody"></tbody>
    </table>
</div>

<!-- ==================== SYSTEM ==================== -->
<div class="page" id="page-system">
    <h1>System</h1>
    <p class="subtitle">Audit log, configuration, and evolution</p>
    <div style="display:flex;gap:8px;margin-bottom:16px">
        <button class="btn btn-sm btn-secondary sys-tab active" data-sys="audit">Audit Log</button>
        <button class="btn btn-sm btn-secondary sys-tab" data-sys="config">Config</button>
        <button class="btn btn-sm btn-secondary sys-tab" data-sys="evolution">Evolution</button>
    </div>
    <div id="sysAudit" class="sys-panel"></div>
    <div id="sysConfig" class="sys-panel" style="display:none"></div>
    <div id="sysEvolution" class="sys-panel" style="display:none"></div>
</div>
</div>

<!-- ==================== MODALS ==================== -->
<div class="modal-overlay" id="taskModal">
    <div class="modal">
        <button class="modal-close" onclick="closeModal('taskModal')">&times;</button>
        <h2>Create Task</h2>
        <div class="form-group"><label for="newTaskTitle">Title</label><input type="text" id="newTaskTitle" placeholder="Task title"></div>
        <div class="form-group"><label for="newTaskDesc">Description</label><textarea id="newTaskDesc" placeholder="What needs to be done..."></textarea></div>
        <div class="form-group"><label for="newTaskPrio">Priority</label><select id="newTaskPrio"><option value="P1">P1 — Must Have</option><option value="P2" selected>P2 — Should Have</option><option value="P3">P3 — Nice to Have</option></select></div>
        <div class="form-group"><label for="newTaskEst">Estimated Minutes</label><input type="number" id="newTaskEst" value="30" min="5" max="480"></div>
        <div class="form-group"><label for="newTaskAC">Acceptance Criteria</label><textarea id="newTaskAC" placeholder="How do we know this is done?"></textarea></div>
        <div class="btn-row"><button class="btn btn-primary" onclick="createTask()">Create Task</button></div>
    </div>
</div>

<div class="modal-overlay" id="ticketModal">
    <div class="modal">
        <button class="modal-close" onclick="closeModal('ticketModal')">&times;</button>
        <h2>Create Ticket</h2>
        <div class="form-group"><label for="newTicketTitle">Title</label><input type="text" id="newTicketTitle" placeholder="Question or issue..."></div>
        <div class="form-group"><label for="newTicketBody">Description</label><textarea id="newTicketBody" placeholder="Details..."></textarea></div>
        <div class="form-group"><label for="newTicketPrio">Priority</label><select id="newTicketPrio"><option value="P1">P1</option><option value="P2" selected>P2</option><option value="P3">P3</option></select></div>
        <div class="btn-row"><button class="btn btn-primary" onclick="createTicket()">Create Ticket</button></div>
    </div>
</div>

<script>
const API = 'http://localhost:${port}/api';
let currentTaskFilter = 'all';
let wizStep = 0;

// ==================== TAB NAVIGATION ====================
document.querySelectorAll('.topnav .tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.topnav .tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('page-' + tab.dataset.page).classList.add('active');
        loadPage(tab.dataset.page);
    });
});

document.querySelectorAll('.task-filter').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.task-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTaskFilter = btn.dataset.filter;
        loadTasks();
    });
});

document.querySelectorAll('.sys-tab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.sys-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.sys-panel').forEach(p => p.style.display = 'none');
        btn.classList.add('active');
        document.getElementById('sys' + btn.dataset.sys.charAt(0).toUpperCase() + btn.dataset.sys.slice(1)).style.display = '';
    });
});

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ==================== API HELPERS ====================
async function api(path, opts = {}) {
    const res = await fetch(API + '/' + path, {
        headers: { 'Content-Type': 'application/json' },
        ...opts,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const json = await res.json();
    // Unwrap paginated responses: { data: [...], total, page, limit, totalPages }
    if (json && typeof json === 'object' && Array.isArray(json.data) && 'total' in json && 'page' in json) {
        return json.data;
    }
    return json;
}

function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function renderMarkdown(text) {
    var BT3 = String.fromCharCode(96,96,96);
    var BT1 = String.fromCharCode(96);
    var parts = text.split(new RegExp('(' + BT3 + '[\\\\s\\\\S]*?' + BT3 + ')', 'g'));
    var inlineCodeRe = new RegExp(BT1 + '([^' + BT1 + ']+)' + BT1, 'g');
    return parts.map(function(part) {
        if (part.indexOf(BT3) === 0) {
            var inner = part.slice(3, part.length - 3);
            var nlIdx = inner.indexOf('\\n');
            var lang = nlIdx >= 0 ? inner.slice(0, nlIdx).trim() : '';
            var code = nlIdx >= 0 ? inner.slice(nlIdx + 1) : inner;
            if (code.endsWith('\\n')) code = code.slice(0, -1);
            return '<pre><code data-lang="' + esc(lang || 'text') + '">' + esc(code) + '</code></pre>';
        }
        var lines = part.split('\\n');
        return lines.map(function(line) {
            var h = esc(line);
            h = h.replace(/^### (.+)/, '<strong style="display:block;font-size:0.95em;color:var(--teal);margin:4px 0">$1</strong>');
            h = h.replace(/^## (.+)/, '<strong style="display:block;font-size:1.05em;color:var(--blue);margin:6px 0">$1</strong>');
            h = h.replace(/^# (.+)/, '<strong style="display:block;font-size:1.15em;color:var(--blue);margin:8px 0">$1</strong>');
            h = h.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
            h = h.replace(inlineCodeRe, '<code style="background:var(--bg);padding:1px 5px;border-radius:3px;font-size:0.9em">$1</code>');
            if (h.match(/^- /)) h = '<div style="padding-left:12px">' + h.replace(/^- /, '&#8226; ') + '</div>';
            if (h.match(/^\\d+\\. /)) h = '<div style="padding-left:12px">' + h + '</div>';
            return h;
        }).join('<br>');
    }).join('');
}
function formatTime(ts) {
    if (!ts) return '';
    try {
        var d = new Date(ts);
        return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch(e) { return ts; }
}
function statusBadge(s) {
    const map = { not_started: 'gray', in_progress: 'blue', pending_verification: 'yellow', verified: 'green', failed: 'red', blocked: 'mauve', needs_recheck: 'yellow',
        open: 'blue', resolved: 'green', escalated: 'red', in_review: 'yellow',
        idle: 'gray', working: 'blue', error: 'red', disabled: 'gray',
        draft: 'gray', active: 'green', completed: 'green', archived: 'gray' };
    return '<span class="badge badge-' + (map[s] || 'gray') + '">' + esc(s) + '</span>';
}
function prioBadge(p) {
    const map = { P1: 'red', P2: 'yellow', P3: 'gray' };
    return '<span class="badge badge-' + (map[p] || 'gray') + '">' + esc(p) + '</span>';
}

// ==================== LOAD PAGES ====================
function loadPage(page) {
    switch (page) {
        case 'dashboard': loadDashboard(); break;
        case 'tasks': loadTasks(); break;
        case 'tickets': loadTickets(); break;
        case 'planning': loadPlans(); break;
        case 'agents': loadAgents(); break;
        case 'designer': loadDesignerPlanList(); break;
        case 'coding': loadCodingSessions(); loadDesignerPlanList(); break;
        case 'settings': loadSettings(); break;
        case 'github': loadGitHubIssues(); break;
        case 'system': loadAudit(); loadConfig(); loadEvolution(); break;
    }
}

async function loadDashboard() {
    try {
        const data = await api('dashboard');
        const s = data.stats || {};
        document.getElementById('dashPlanName').textContent = data.plan ? 'Active Plan: ' + data.plan.name : 'No active plan — create one to get started';
        document.getElementById('dashCards').innerHTML = [
            { val: s.total_tasks || 0, lbl: 'Total Tasks' },
            { val: s.tasks_verified || 0, lbl: 'Verified' },
            { val: s.tasks_in_progress || 0, lbl: 'In Progress' },
            { val: s.total_tickets || 0, lbl: 'Tickets' },
            { val: s.total_conversations || 0, lbl: 'Conversations' },
            { val: (data.agents || []).length, lbl: 'Agents' },
        ].map(c => '<div class="card"><div class="val">' + c.val + '</div><div class="lbl">' + c.lbl + '</div></div>').join('');

        const pp = data.planProgress;
        if (pp && pp.total > 0) {
            const pct = Math.round((pp.verified / pp.total) * 100);
            document.getElementById('dashProgress').style.display = '';
            document.getElementById('dashProgressFill').style.width = pct + '%';
            document.getElementById('dashProgressText').textContent = pct + '% complete (' + pp.verified + '/' + pp.total + ' tasks verified)';
        } else {
            document.getElementById('dashProgress').style.display = 'none';
        }

        document.getElementById('dashAgents').innerHTML = (data.agents || []).map(a =>
            '<tr><td>' + esc(a.name) + '</td><td>' + esc(a.type) + '</td><td>' + statusBadge(a.status) + '</td><td>' + esc(a.current_task || '—') + '</td></tr>'
        ).join('') || '<tr><td colspan="4" class="empty">No agents</td></tr>';

        document.getElementById('dashAudit').innerHTML = (data.recentAudit || []).map(e =>
            '<div class="audit-entry"><span class="audit-agent">' + esc(e.agent) + '</span>: ' + esc(e.action) + ' — ' + esc(e.detail) + '<div class="audit-time">' + esc(e.created_at) + '</div></div>'
        ).join('') || '<div class="empty">No activity yet</div>';
    } catch (err) {
        document.getElementById('dashCards').innerHTML = '<div class="empty">Failed to load dashboard: ' + esc(String(err)) + '</div>';
    }
}

async function loadTasks() {
    try {
        const result = await api('tasks');
        let tasks = Array.isArray(result) ? result : [];
        if (currentTaskFilter !== 'all') tasks = tasks.filter(t => t.status === currentTaskFilter);
        document.getElementById('taskTableBody').innerHTML = tasks.map(t =>
            '<tr>' +
            '<td>' + prioBadge(t.priority) + '</td>' +
            '<td class="clickable" onclick="showTaskDetail(\\'' + t.id + '\\')">' + esc(t.title) + '</td>' +
            '<td>' + statusBadge(t.status) + '</td>' +
            '<td>' + t.estimated_minutes + 'min</td>' +
            '<td>' + taskActions(t) + '</td>' +
            '</tr>'
        ).join('') || '<tr><td colspan="5" class="empty">No tasks</td></tr>';
    } catch (err) {
        document.getElementById('taskTableBody').innerHTML = '<tr><td colspan="5" class="empty">Error: ' + esc(String(err)) + '</td></tr>';
    }
}

function taskActions(t) {
    let html = '';
    if (t.status === 'not_started') html += '<button class="btn btn-sm btn-primary" onclick="updateTaskStatus(\\'' + t.id + '\\', \\'in_progress\\')">Start</button> ';
    if (t.status === 'in_progress') html += '<button class="btn btn-sm btn-success" onclick="updateTaskStatus(\\'' + t.id + '\\', \\'pending_verification\\')">Done</button> ';
    if (t.status === 'pending_verification') html += '<button class="btn btn-sm btn-success" onclick="updateTaskStatus(\\'' + t.id + '\\', \\'verified\\')">Approve</button> <button class="btn btn-sm btn-danger" onclick="updateTaskStatus(\\'' + t.id + '\\', \\'failed\\')">Reject</button> ';
    if (t.status === 'failed') html += '<button class="btn btn-sm btn-secondary" onclick="updateTaskStatus(\\'' + t.id + '\\', \\'not_started\\')">Retry</button> ';
    return html;
}

async function showTaskDetail(id) {
    const data = await api('tasks/' + id);
    document.getElementById('taskDetail').innerHTML = '<div class="detail-panel">' +
        '<h3>' + esc(data.title) + '</h3>' +
        '<div class="detail-row"><span>Status</span>' + statusBadge(data.status) + '</div>' +
        '<div class="detail-row"><span>Priority</span>' + prioBadge(data.priority) + '</div>' +
        '<div class="detail-row"><span>Estimated</span><span>' + data.estimated_minutes + ' min</span></div>' +
        (data.description ? '<div style="margin-top:12px"><strong>Description</strong><p style="white-space:pre-wrap;color:var(--subtext);margin-top:4px">' + esc(data.description) + '</p></div>' : '') +
        (data.acceptance_criteria ? '<div style="margin-top:12px"><strong>Acceptance Criteria</strong><p style="white-space:pre-wrap;color:var(--subtext);margin-top:4px">' + esc(data.acceptance_criteria) + '</p></div>' : '') +
        (data.files_modified && data.files_modified.length ? '<div style="margin-top:12px"><strong>Files Modified</strong><div style="color:var(--subtext);font-size:0.9em;margin-top:4px">' + data.files_modified.map(f => '<div><code>' + esc(f) + '</code></div>').join('') + '</div></div>' : '') +
        '</div>';
}

async function updateTaskStatus(id, status) {
    await api('tasks/' + id, { method: 'PUT', body: { status } });
    loadTasks();
    if (document.getElementById('page-dashboard').classList.contains('active')) loadDashboard();
}

async function createTask() {
    const title = document.getElementById('newTaskTitle').value.trim();
    if (!title) return;
    await api('tasks', { method: 'POST', body: {
        title,
        description: document.getElementById('newTaskDesc').value,
        priority: document.getElementById('newTaskPrio').value,
        estimated_minutes: parseInt(document.getElementById('newTaskEst').value) || 30,
        acceptance_criteria: document.getElementById('newTaskAC').value,
    }});
    closeModal('taskModal');
    document.getElementById('newTaskTitle').value = '';
    document.getElementById('newTaskDesc').value = '';
    document.getElementById('newTaskAC').value = '';
    loadTasks();
}

// ==================== TICKETS ====================
async function loadTickets() {
    try {
        const result = await api('tickets');
        const tickets = Array.isArray(result) ? result : [];
        document.getElementById('ticketTableBody').innerHTML = tickets.map(t =>
            '<tr>' +
            '<td>TK-' + String(t.ticket_number).padStart(3, '0') + '</td>' +
            '<td class="clickable" onclick="showTicketDetail(\\'' + t.id + '\\')">' + esc(t.title) + '</td>' +
            '<td>' + statusBadge(t.status) + '</td>' +
            '<td>' + prioBadge(t.priority) + '</td>' +
            '<td>' + esc(t.creator) + '</td>' +
            '<td>' + ticketActions(t) + '</td>' +
            '</tr>'
        ).join('') || '<tr><td colspan="6" class="empty">No tickets</td></tr>';
    } catch (err) {
        document.getElementById('ticketTableBody').innerHTML = '<tr><td colspan="6" class="empty">Error: ' + esc(String(err)) + '</td></tr>';
    }
}

function ticketActions(t) {
    let html = '';
    if (t.status === 'open') html += '<button class="btn btn-sm btn-success" onclick="updateTicketStatus(\\'' + t.id + '\\', \\'resolved\\')">Resolve</button> <button class="btn btn-sm btn-danger" onclick="updateTicketStatus(\\'' + t.id + '\\', \\'escalated\\')">Escalate</button> ';
    if (t.status === 'escalated') html += '<button class="btn btn-sm btn-success" onclick="updateTicketStatus(\\'' + t.id + '\\', \\'resolved\\')">Resolve</button> ';
    return html;
}

async function showTicketDetail(id) {
    const data = await api('tickets/' + id);
    const replies = data.replies || [];
    document.getElementById('ticketDetail').innerHTML = '<div class="detail-panel">' +
        '<h3>TK-' + String(data.ticket_number).padStart(3, '0') + ': ' + esc(data.title) + '</h3>' +
        '<div class="detail-row"><span>Status</span>' + statusBadge(data.status) + '</div>' +
        '<div class="detail-row"><span>Priority</span>' + prioBadge(data.priority) + '</div>' +
        '<div class="detail-row"><span>Creator</span><span>' + esc(data.creator) + '</span></div>' +
        (data.body ? '<div style="margin-top:12px;white-space:pre-wrap;color:var(--subtext);padding:12px;background:var(--bg);border-radius:6px">' + esc(data.body) + '</div>' : '') +
        '<h3 style="margin-top:16px">Thread (' + replies.length + ')</h3>' +
        replies.map(r =>
            '<div class="thread-reply ' + (r.author === 'user' ? 'user' : 'agent') + '">' +
            '<span class="author">' + esc(r.author) + '</span>' +
            (r.clarity_score != null ? '<span style="float:right;color:var(--overlay);font-size:0.8em">Clarity: ' + r.clarity_score + '/100</span>' : '') +
            '<div class="body">' + esc(r.body) + '</div>' +
            '<div class="meta">' + esc(r.created_at) + '</div></div>'
        ).join('') +
        (replies.length === 0 ? '<div class="empty">No replies yet</div>' : '') +
        (data.status !== 'resolved' ?
            '<div style="margin-top:12px"><textarea id="ticketReplyText" placeholder="Type your reply..."></textarea>' +
            '<div class="btn-row"><button class="btn btn-primary" onclick="sendTicketReply(\\'' + id + '\\')">Send Reply</button></div></div>' : '') +
        '</div>';
}

async function updateTicketStatus(id, status) {
    await api('tickets/' + id, { method: 'PUT', body: { status } });
    loadTickets();
}

async function sendTicketReply(id) {
    const text = document.getElementById('ticketReplyText').value.trim();
    if (!text) return;
    await api('tickets/' + id + '/replies', { method: 'POST', body: { body: text, author: 'user' } });
    showTicketDetail(id);
}

async function createTicket() {
    const title = document.getElementById('newTicketTitle').value.trim();
    if (!title) return;
    await api('tickets', { method: 'POST', body: {
        title,
        body: document.getElementById('newTicketBody').value,
        priority: document.getElementById('newTicketPrio').value,
    }});
    closeModal('ticketModal');
    document.getElementById('newTicketTitle').value = '';
    document.getElementById('newTicketBody').value = '';
    loadTickets();
}

// ==================== PLANNING — ADAPTIVE WIZARD + DRAG & DROP ====================

// Wizard config state
let wizConfig = {
    name: '', description: '', scale: 'MVP', focus: 'Full Stack',
    priorities: ['Core business logic'],
    layout: 'sidebar', theme: 'dark', taskDisplay: 'tree',
    depViz: 'hierarchy', timeline: 'linear', inputStyle: 'modal', aiLevel: 'suggestions'
};

// Adaptive step logic: which steps to show based on scale + focus
function getActiveSteps() {
    const s = wizConfig.scale, f = wizConfig.focus;
    if (s === 'MVP' && f === 'Backend') return [0,1,2,3,6,9,10];
    if (s === 'MVP') return [0,1,2,3,4,5,6,10];
    if (s === 'Small') return [0,1,2,3,4,5,6,7,10];
    if (f === 'Frontend') return [0,1,2,3,4,5,6,7,8,10];
    return [0,1,2,3,4,5,6,7,8,9,10]; // Large/Enterprise + Full Stack = all
}

function renderWizardDots() {
    const active = getActiveSteps();
    const dotsEl = document.getElementById('wizardDots');
    dotsEl.innerHTML = active.map((s, i) => {
        let cls = 'wizard-dot';
        if (s === wizStep) cls += ' active';
        else if (active.indexOf(wizStep) > i) cls += ' done';
        return '<div class="' + cls + '" data-step="' + s + '"></div>';
    }).join('');
}

function wizNext() {
    // Validate step 0
    if (wizStep === 0 && !document.getElementById('wizName').value.trim()) {
        document.getElementById('wizName').focus(); return;
    }
    // Sync config from current step
    syncWizConfig();
    const active = getActiveSteps();
    const curIdx = active.indexOf(wizStep);
    if (curIdx < active.length - 1) {
        wizGoTo(active[curIdx + 1]);
    }
}

function wizPrev() {
    syncWizConfig();
    const active = getActiveSteps();
    const curIdx = active.indexOf(wizStep);
    if (curIdx > 0) {
        wizGoTo(active[curIdx - 1]);
    }
}

function wizGoTo(n) {
    document.getElementById('wstep' + wizStep)?.classList.remove('active');
    document.getElementById('wstep' + n)?.classList.add('active');
    wizStep = n;
    renderWizardDots();
    updateImpact();
}

function syncWizConfig() {
    wizConfig.name = document.getElementById('wizName')?.value || '';
    wizConfig.description = document.getElementById('wizDesc')?.value || '';
    wizConfig.scale = document.querySelector('#scaleOptions .selected')?.dataset.val || 'MVP';
    wizConfig.focus = document.querySelector('#focusOptions .selected')?.dataset.val || 'Full Stack';
    wizConfig.priorities = [...document.querySelectorAll('#priorityOptions .selected')].map(b => b.dataset.val);
    // Design cards
    document.querySelectorAll('.design-grid').forEach(grid => {
        const field = grid.dataset.field;
        const sel = grid.querySelector('.design-card.selected');
        if (field && sel) wizConfig[field] = sel.dataset.val;
    });
}

// Option button selection (single-select for scale/focus)
document.querySelectorAll('#scaleOptions .option-btn, #focusOptions .option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        btn.parentElement.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        syncWizConfig();
        renderWizardDots(); // scale/focus change may alter active steps
        updateImpact();
    });
});
// Multi-select for priorities
document.querySelectorAll('#priorityOptions .option-btn').forEach(btn => {
    btn.addEventListener('click', () => { btn.classList.toggle('selected'); syncWizConfig(); updateImpact(); });
});
// Design card selection (single-select per grid)
document.querySelectorAll('.design-card').forEach(card => {
    card.addEventListener('click', () => {
        card.parentElement.querySelectorAll('.design-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        syncWizConfig();
        updateImpact();
    });
});

// ===== IMPACT SIMULATOR (client-side, no LLM) =====
function updateImpact() {
    const s = wizConfig.scale, f = wizConfig.focus;
    const prios = wizConfig.priorities || [];
    const baseTasks = { MVP: 8, Small: 15, Medium: 28, Large: 50, Enterprise: 80 };
    let tasks = baseTasks[s] || 28;
    if (f === 'Full Stack') tasks = Math.round(tasks * 1.3);
    tasks += prios.length * 3;
    const p1Pct = (s === 'Large' || s === 'Enterprise') ? 0.5 : 0.4;
    const p1 = Math.round(tasks * p1Pct);
    const hours = Math.round(tasks * 30 / 60);
    const days = Math.ceil(hours / 6);
    const risk = s === 'Enterprise' ? 'High' : s === 'Large' ? 'Medium-High' : s === 'Medium' ? 'Medium' : 'Low';
    const stacks = { Frontend: 'React/Vue + CSS', Backend: 'Node.js + SQLite', 'Full Stack': 'React + Node + SQLite' };

    const el = (id, text) => { const e = document.getElementById(id); if (e) e.textContent = text; };
    el('impTasks', tasks + ' tasks');
    el('impP1', p1 + ' critical');
    el('impTime', '~' + hours + 'h (' + days + ' days)');
    el('impRisk', risk);
    el('impStack', stacks[f] || 'Custom');
}

// Initial impact update
setTimeout(updateImpact, 100);
renderWizardDots();

// ===== PLAN GENERATION =====
async function wizGenerate() {
    syncWizConfig();
    const name = wizConfig.name.trim();
    const desc = wizConfig.description.trim();
    if (!name) { document.getElementById('wizName').focus(); return; }
    const out = document.getElementById('wizOutput');
    out.style.display = '';
    out.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Generating plan with AI... This may take a moment.</div>';
    const design = {
        layout: wizConfig.layout, theme: wizConfig.theme, taskDisplay: wizConfig.taskDisplay,
        depViz: wizConfig.depViz, timeline: wizConfig.timeline, inputStyle: wizConfig.inputStyle,
        aiLevel: wizConfig.aiLevel
    };
    try {
        const data = await api('plans/generate', { method: 'POST', body: {
            name, description: desc, scale: wizConfig.scale, focus: wizConfig.focus,
            priorities: wizConfig.priorities, design
        }});
        if (data.plan) {
            if (data.taskCount > 0) {
                out.innerHTML = '<div class="detail-panel" style="color:var(--green)">Plan \\u201c' + esc(data.plan.name) + '\\u201d created with ' + data.taskCount + ' tasks.</div>';
            } else {
                out.innerHTML = '<div class="detail-panel" style="color:var(--yellow)">Plan \\u201c' + esc(data.plan.name) + '\\u201d created. AI could not generate structured tasks — add tasks manually in the designer.' +
                    (data.raw_response ? '<details style="margin-top:8px"><summary style="cursor:pointer;color:var(--subtext)">AI Response</summary><pre style="white-space:pre-wrap;color:var(--subtext);margin-top:4px;font-size:0.85em">' + esc(data.raw_response) + '</pre></details>' : '') +
                    '</div>';
            }
            openPlanDesigner(data.plan.id, data.plan.name, design);
            loadPlans();
        } else if (data.error) {
            out.innerHTML = '<div class="detail-panel" style="color:var(--red)">Error: ' + esc(data.error) + '</div>';
        } else {
            out.innerHTML = '<div class="detail-panel" style="color:var(--red)">Unexpected response from server</div>';
        }
    } catch (err) {
        out.innerHTML = '<div class="detail-panel" style="color:var(--red)">Error: ' + esc(String(err)) + '</div>';
    }
}

async function wizQuick() {
    const name = document.getElementById('wizName').value.trim();
    const desc = document.getElementById('wizDesc').value.trim();
    if (!name || !desc) { document.getElementById('wizName').focus(); return; }
    const out = document.getElementById('wizOutput');
    out.style.display = '';
    out.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Generating plan...</div>';
    try {
        const data = await api('plans/generate', { method: 'POST', body: { name, description: desc } });
        if (data.plan) {
            if (data.taskCount > 0) {
                out.innerHTML = '<div class="detail-panel" style="color:var(--green)">Plan \\u201c' + esc(data.plan.name) + '\\u201d created with ' + data.taskCount + ' tasks.</div>';
            } else {
                out.innerHTML = '<div class="detail-panel" style="color:var(--yellow)">Plan \\u201c' + esc(data.plan.name) + '\\u201d created. Add tasks manually in the designer.</div>';
            }
            openPlanDesigner(data.plan.id, data.plan.name, {});
            loadPlans();
        } else if (data.error) {
            out.innerHTML = '<div class="detail-panel" style="color:var(--red)">Error: ' + esc(data.error) + '</div>';
        } else {
            out.innerHTML = '<div class="detail-panel" style="color:var(--red)">Unexpected response from server</div>';
        }
    } catch (err) {
        out.innerHTML = '<div class="detail-panel" style="color:var(--red)">Error: ' + esc(String(err)) + '</div>';
    }
}

// ===== PLAN DESIGNER (DRAG & DROP TREE) =====
let pdTasks = [];
let pdPlanId = null;
let pdDesign = {};
let draggedId = null;
let ctxTargetId = null;

function openPlanDesigner(planId, planName, design) {
    pdPlanId = planId;
    pdDesign = design || {};
    document.getElementById('wizardSection').style.display = 'none';
    document.getElementById('planDesigner').style.display = '';
    document.getElementById('pdPlanName').textContent = 'Plan Designer: ' + planName;
    // Show design preview
    const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v || '--'; };
    el('pvLayout', pdDesign.layout || 'Default');
    el('pvTheme', pdDesign.theme || 'Dark');
    el('pvDisplay', pdDesign.taskDisplay || 'Tree');
    el('pvDeps', pdDesign.depViz || 'Hierarchy');
    el('pvAI', pdDesign.aiLevel || 'Suggestions');
    updateWireframe();
    loadPlanDesignerTasks(planId);
}

function updateWireframe() {
    const wf = document.getElementById('wireframe');
    if (!wf) return;
    const layout = pdDesign.layout || 'sidebar';
    const wireframes = {
        sidebar: '+-------+------------------+\\n| NAV   | Content Area     |\\n|       |                  |\\n| Tasks | [Task Details]   |\\n| Plans |                  |\\n| Agents| [Verification]   |\\n+-------+------------------+',
        tabs:   '+---+---+---+---+----------+\\n| T1| T2| T3| T4|          |\\n+---+---+---+---+----------+\\n|                          |\\n|     Content Area         |\\n|     [Active Tab View]    |\\n+--------------------------+',
        wizard: '+--[1]--[2]--[3]--[4]------+\\n|                          |\\n|   Step N of M            |\\n|   [Current Question]     |\\n|                          |\\n|   [Back]    [Next]       |\\n+--------------------------+',
        custom: '+--------+-----------------+\\n|        |                 |\\n| Custom layout             |\\n| designed by you          |\\n|        |                 |\\n+--------------------------+'
    };
    wf.textContent = wireframes[layout] || wireframes.sidebar;
}

async function loadPlanDesignerTasks(planId) {
    try {
        const data = await api('plans/' + planId);
        pdTasks = data.tasks || [];
        renderDragTree();
    } catch (err) {
        document.getElementById('dragTree').innerHTML = '<div class="empty">Error loading tasks: ' + esc(String(err)) + '</div>';
    }
}

function taskStatusIcon(status) {
    const map = { verified: '\\u2705', in_progress: '\\uD83D\\uDD04', failed: '\\u274C', decomposed: '\\uD83D\\uDCE6',
                  pending_verification: '\\u23F3', blocked: '\\uD83D\\uDEAB', needs_recheck: '\\u26A0', not_started: '\\u2B1C' };
    return map[status] || '\\u2B1C';
}

function renderDragTree() {
    const container = document.getElementById('dragTree');
    if (!pdTasks.length) { container.innerHTML = '<div class="empty">No tasks in this plan. Click "+ Task" to add one.</div>'; return; }
    const parents = pdTasks.filter(t => !t.parent_task_id).sort((a,b) => (a.sort_order||0) - (b.sort_order||0));
    const childMap = {};
    pdTasks.filter(t => t.parent_task_id).forEach(t => {
        (childMap[t.parent_task_id] = childMap[t.parent_task_id] || []).push(t);
    });
    for (const k of Object.keys(childMap)) childMap[k].sort((a,b) => (a.sort_order||0) - (b.sort_order||0));

    let html = '';
    for (const parent of parents) {
        const children = childMap[parent.id] || [];
        html += renderDragNode(parent, children);
    }
    // Global drop zone at end
    html += '<div class="drop-zone" data-parent="" data-after="last" ondragover="onDragOver(event)" ondrop="onDrop(event)" ondragleave="onDragLeave(event)"></div>';
    container.innerHTML = html;
}

function renderDragNode(task, children) {
    const icon = taskStatusIcon(task.status);
    let html = '<div class="drag-node" draggable="true" data-id="' + task.id + '" ' +
        'ondragstart="onDragStart(event)" ondragover="onDragOver(event)" ondrop="onDrop(event)" ondragend="onDragEnd(event)" ondragleave="onDragLeave(event)" ' +
        'oncontextmenu="onCtxMenu(event, \\'' + task.id + '\\')" ondblclick="ctxTargetId=\\'' + task.id + '\\';ctxEdit()">' +
        '<span class="drag-grip">\\u2800\\u2800\\u2800\\u2800\\u2800\\u2800</span>' +
        '<span class="drag-icon">' + icon + '</span>' +
        '<span class="drag-title">' + esc(task.title) + '</span>' +
        '<span class="drag-prio prio-' + task.priority.toLowerCase() + '">' + task.priority + '</span>' +
        '<span class="drag-est">' + task.estimated_minutes + 'min</span>' +
        '</div>';

    if (children.length > 0) {
        html += '<div class="drag-children">';
        for (const child of children) html += renderDragNode(child, []);
        html += '<div class="drop-zone" data-parent="' + task.id + '" data-after="last" ondragover="onDragOver(event)" ondrop="onDrop(event)" ondragleave="onDragLeave(event)"></div>';
        html += '</div>';
    }
    return html;
}

// ===== HTML5 DRAG & DROP =====
function onDragStart(e) {
    const node = e.target.closest('.drag-node');
    if (!node) return;
    draggedId = node.dataset.id;
    node.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedId);
}

function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = e.target.closest('.drag-node, .drop-zone');
    if (target && !target.classList.contains('drop-target')) {
        document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
        target.classList.add('drop-target');
    }
}

function onDragLeave(e) {
    const target = e.target.closest('.drag-node, .drop-zone');
    if (target) target.classList.remove('drop-target');
}

function onDrop(e) {
    e.preventDefault();
    document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
    if (!draggedId) return;
    const target = e.target.closest('.drag-node, .drop-zone');
    if (!target) return;
    const targetId = target.dataset.id || null;
    const targetParent = target.dataset.parent !== undefined ? target.dataset.parent : null;
    const isDropZone = target.classList.contains('drop-zone');

    if (isDropZone) {
        // Drop into a parent group (at end)
        recomputeOrder(draggedId, null, targetParent || null);
    } else if (targetId && targetId !== draggedId) {
        // Drop before/after another node
        const targetTask = pdTasks.find(t => t.id === targetId);
        if (targetTask) {
            recomputeOrder(draggedId, targetId, targetTask.parent_task_id);
        }
    }
    draggedId = null;
}

function onDragEnd(e) {
    document.querySelectorAll('.dragging, .drop-target').forEach(el => el.classList.remove('dragging', 'drop-target'));
    draggedId = null;
}

function recomputeOrder(movedId, afterId, newParentId) {
    const moved = pdTasks.find(t => t.id === movedId);
    if (!moved) return;
    moved.parent_task_id = newParentId || null;
    const siblings = pdTasks.filter(t => (t.parent_task_id || null) === (newParentId || null) && t.id !== movedId)
        .sort((a,b) => (a.sort_order||0) - (b.sort_order||0));
    const insertIdx = afterId ? siblings.findIndex(t => t.id === afterId) + 1 : siblings.length;
    siblings.splice(insertIdx, 0, moved);
    siblings.forEach((t, i) => { t.sort_order = i * 10; });
    renderDragTree();
}

async function pdSave() {
    const orders = pdTasks.map(t => ({ id: t.id, sort_order: t.sort_order || 0, parent_task_id: t.parent_task_id || null }));
    try {
        await api('tasks/reorder', { method: 'POST', body: { orders } });
        // Visual feedback
        const btn = document.querySelector('#planDesigner .btn-primary');
        if (btn) { const old = btn.textContent; btn.textContent = 'Saved!'; setTimeout(() => btn.textContent = old, 1500); }
    } catch (err) { alert('Save failed: ' + String(err)); }
}

// ===== CONTEXT MENU =====
function onCtxMenu(e, taskId) {
    e.preventDefault();
    ctxTargetId = taskId;
    const menu = document.getElementById('ctxMenu');
    menu.style.display = '';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
}
document.addEventListener('click', () => { document.getElementById('ctxMenu').style.display = 'none'; });

function ctxEdit() {
    document.getElementById('ctxMenu').style.display = 'none';
    const task = pdTasks.find(t => t.id === ctxTargetId);
    if (!task) return;
    document.getElementById('pdEditTitle').value = task.title;
    document.getElementById('pdEditDesc').value = task.description || '';
    document.getElementById('pdEditPrio').value = task.priority;
    document.getElementById('pdEditEst').value = task.estimated_minutes;
    document.getElementById('pdEditAC').value = task.acceptance_criteria || '';
    openModal('pdEditModal');
}

async function pdSaveEdit() {
    if (!ctxTargetId) return;
    const updates = {
        title: document.getElementById('pdEditTitle').value,
        description: document.getElementById('pdEditDesc').value,
        priority: document.getElementById('pdEditPrio').value,
        estimated_minutes: parseInt(document.getElementById('pdEditEst').value) || 30,
        acceptance_criteria: document.getElementById('pdEditAC').value,
    };
    await api('tasks/' + ctxTargetId, { method: 'PUT', body: updates });
    closeModal('pdEditModal');
    await loadPlanDesignerTasks(pdPlanId);
}

async function ctxAddSub() {
    document.getElementById('ctxMenu').style.display = 'none';
    if (!ctxTargetId || !pdPlanId) return;
    await api('tasks', { method: 'POST', body: {
        title: 'New Sub-task', plan_id: pdPlanId, parent_task_id: ctxTargetId, priority: 'P2'
    }});
    await loadPlanDesignerTasks(pdPlanId);
}

async function ctxDelete() {
    document.getElementById('ctxMenu').style.display = 'none';
    if (!ctxTargetId) return;
    if (!confirm('Delete this task?')) return;
    await api('tasks/' + ctxTargetId, { method: 'DELETE' });
    await loadPlanDesignerTasks(pdPlanId);
}

async function pdAddPhase() {
    if (!pdPlanId) return;
    await api('tasks', { method: 'POST', body: {
        title: 'New Phase', plan_id: pdPlanId, priority: 'P2', description: 'Phase group — add sub-tasks inside'
    }});
    await loadPlanDesignerTasks(pdPlanId);
}

async function pdAddTask() {
    if (!pdPlanId) return;
    await api('tasks', { method: 'POST', body: { title: 'New Task', plan_id: pdPlanId, priority: 'P2' }});
    await loadPlanDesignerTasks(pdPlanId);
}

function pdBackToWizard() {
    document.getElementById('planDesigner').style.display = 'none';
    document.getElementById('wizardSection').style.display = '';
}

// ===== PLAN LIST =====
async function loadPlans() {
    try {
        const result = await api('plans');
        const plans = Array.isArray(result) ? result : [];
        document.getElementById('plansList').innerHTML = plans.length ? '<table><thead><tr><th>Name</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>' +
            plans.map(p => '<tr><td class="clickable" onclick="showPlanDetail(\\'' + p.id + '\\')">' + esc(p.name) + '</td><td>' + statusBadge(p.status) + '</td><td>' + esc(p.created_at) + '</td><td><button class="btn btn-sm btn-primary" onclick="openPlanDesignerFromList(\\'' + p.id + '\\')">Design</button></td></tr>').join('') +
            '</tbody></table>' : '<div class="empty">No plans yet. Create one above.</div>';
    } catch (err) {
        document.getElementById('plansList').innerHTML = '<div class="empty">Error: ' + esc(String(err)) + '</div>';
    }
}

async function openPlanDesignerFromList(id) {
    try {
        const data = await api('plans/' + id);
        const cfg = data.config_json ? JSON.parse(data.config_json) : {};
        openPlanDesigner(id, data.name, cfg.design || {});
    } catch (err) { alert('Error: ' + String(err)); }
}

async function showPlanDetail(id) {
    const data = await api('plans/' + id);
    const tasks = data.tasks || [];
    const verified = tasks.filter(t => t.status === 'verified').length;
    const pct = tasks.length > 0 ? Math.round((verified / tasks.length) * 100) : 0;
    document.getElementById('plansList').innerHTML += '<div class="detail-panel"><h3>' + esc(data.name) + '</h3>' +
        '<div class="detail-row"><span>Status</span>' + statusBadge(data.status) + '</div>' +
        '<div class="detail-row"><span>Tasks</span><span>' + verified + '/' + tasks.length + ' verified (' + pct + '%)</span></div>' +
        '<div class="progress-wrap" style="margin-top:12px"><div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div></div>' +
        '<div class="btn-row">' +
        (data.status === 'draft' ? '<button class="btn btn-primary" onclick="activatePlan(\\'' + id + '\\')">Activate</button>' : '') +
        '<button class="btn btn-secondary" onclick="openPlanDesignerFromList(\\'' + id + '\\')">Open Designer</button>' +
        '</div></div>';
}

async function activatePlan(id) {
    await api('plans/' + id, { method: 'PUT', body: { status: 'active' } });
    loadPlans();
    loadDashboard();
}

// ==================== AGENTS ====================
async function loadAgents() {
    try {
        const result = await api('agents');
        const agents = Array.isArray(result) ? result : [];
        document.getElementById('agentCards').innerHTML = agents.map(a =>
            '<div class="card">' +
            '<div style="display:flex;justify-content:space-between;align-items:center">' +
            '<strong>' + esc(a.name) + '</strong>' + statusBadge(a.status) + '</div>' +
            '<div class="lbl" style="margin-top:8px">Type: ' + esc(a.type) + '</div>' +
            (a.current_task ? '<div class="lbl">Task: ' + esc(a.current_task) + '</div>' : '') +
            (a.last_activity ? '<div class="lbl">Last: ' + esc(a.last_activity) + '</div>' : '') +
            '</div>'
        ).join('') || '<div class="empty">No agents registered</div>';
    } catch (err) {
        document.getElementById('agentCards').innerHTML = '<div class="empty">Error: ' + esc(String(err)) + '</div>';
    }
}

// ==================== SYSTEM ====================
async function loadAudit() {
    try {
        const result = await api('audit');
        const log = Array.isArray(result) ? result : [];
        document.getElementById('sysAudit').innerHTML = '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius)">' +
            log.map(e =>
                '<div class="audit-entry"><span class="audit-agent">' + esc(e.agent) + '</span>: ' + esc(e.action) + ' — ' + esc(e.detail) +
                '<div class="audit-time">' + esc(e.created_at) + '</div></div>'
            ).join('') + (log.length === 0 ? '<div class="empty">No audit entries</div>' : '') +
            '</div>';
    } catch (err) {
        document.getElementById('sysAudit').innerHTML = '<div class="empty">Error: ' + esc(String(err)) + '</div>';
    }
}

async function loadConfig() {
    try {
        const cfg = await api('config');
        document.getElementById('sysConfig').innerHTML = '<pre style="background:var(--bg2);padding:16px;border-radius:var(--radius);border:1px solid var(--border);overflow-x:auto;font-size:0.9em">' + esc(JSON.stringify(cfg, null, 2)) + '</pre>';
    } catch (err) {
        document.getElementById('sysConfig').innerHTML = '<div class="empty">Error: ' + esc(String(err)) + '</div>';
    }
}

async function loadEvolution() {
    try {
        const result = await api('evolution');
        const log = Array.isArray(result) ? result : [];
        document.getElementById('sysEvolution').innerHTML = log.length ? '<table><thead><tr><th>Pattern</th><th>Proposal</th><th>Status</th><th>Result</th></tr></thead><tbody>' +
            log.map(e => '<tr><td>' + esc(e.pattern) + '</td><td>' + esc(e.proposal) + '</td><td>' + statusBadge(e.status) + '</td><td>' + esc(e.result || '—') + '</td></tr>').join('') +
            '</tbody></table>' : '<div class="empty">No evolution entries yet</div>';
    } catch (err) {
        document.getElementById('sysEvolution').innerHTML = '<div class="empty">Error: ' + esc(String(err)) + '</div>';
    }
}

// ==================== GITHUB ISSUES ====================
let currentGhFilter = 'all';

document.querySelectorAll('.gh-filter').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.gh-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentGhFilter = btn.dataset.filter;
        loadGitHubIssues();
    });
});

async function loadGitHubIssues() {
    try {
        const result = await api('github/issues');
        let issues = Array.isArray(result) ? result : [];
        if (currentGhFilter === 'open') issues = issues.filter(i => i.state === 'open');
        else if (currentGhFilter === 'closed') issues = issues.filter(i => i.state === 'closed');
        else if (currentGhFilter === 'linked') issues = issues.filter(i => i.task_id);

        document.getElementById('ghTableBody').innerHTML = issues.map(i =>
            '<tr>' +
            '<td>#' + i.number + '</td>' +
            '<td>' + esc(i.title) + '</td>' +
            '<td>' + statusBadge(i.state) + '</td>' +
            '<td>' + (i.labels || []).map(l => '<span class="badge badge-blue" style="margin-right:4px">' + esc(l) + '</span>').join('') + '</td>' +
            '<td>' + (i.task_id ? '<span class="badge badge-green">Linked</span>' : '<span class="badge badge-gray">—</span>') + '</td>' +
            '<td>' + (!i.task_id ? '<button class="btn btn-sm btn-primary" onclick="convertGhIssue(\\'' + i.id + '\\')">→ Task</button>' : '') + '</td>' +
            '</tr>'
        ).join('') || '<tr><td colspan="6" class="empty">No GitHub issues synced. Click "Sync Now" to import.</td></tr>';
    } catch (err) {
        document.getElementById('ghTableBody').innerHTML = '<tr><td colspan="6" class="empty">Error: ' + esc(String(err)) + '</td></tr>';
    }
}

async function syncGitHub() {
    document.getElementById('ghTableBody').innerHTML = '<tr><td colspan="6" class="loading-overlay"><div class="spinner"></div> Syncing...</td></tr>';
    try {
        // Trigger import via API (simple version — full sync done via command)
        await loadGitHubIssues();
    } catch (err) {
        document.getElementById('ghTableBody').innerHTML = '<tr><td colspan="6" class="empty">Sync failed: ' + esc(String(err)) + '</td></tr>';
    }
}

async function convertGhIssue(id) {
    try {
        const result = await api('github/issues/' + id + '/convert', { method: 'POST' });
        if (result.success) {
            loadGitHubIssues();
            if (document.getElementById('page-tasks').classList.contains('active')) loadTasks();
        } else {
            alert('Failed: ' + (result.error || 'Unknown error'));
        }
    } catch (err) {
        alert('Error: ' + String(err));
    }
}

// ==================== VISUAL DESIGNER ====================

let dsgPlanId = null;
let dsgPages = [];
let dsgComponents = [];
let dsgSelectedId = null;
let dsgCurrentPageId = null;
let dsgBreakpoint = 'desktop';
let dsgZoom = 100;
let dsgDraggingEl = null;
let dsgResizing = null;
let dsgDragOffset = { x: 0, y: 0 };

async function loadDesignerPlanList() {
    try {
        const plansResult = await api('plans');
        const plans = Array.isArray(plansResult) ? plansResult : [];
        const sel = document.getElementById('designerPlanSelect');
        sel.innerHTML = '<option value="">Select a plan...</option>' + plans.map(p => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('');
        // Also populate coding task select
        const tasksResult = await api('tasks');
        const tasks = Array.isArray(tasksResult) ? tasksResult : [];
        const tsel = document.getElementById('codingTaskSelect');
        if (tsel) tsel.innerHTML = '<option value="">Link to task...</option>' + tasks.map(t => '<option value="' + t.id + '">' + esc(t.title) + '</option>').join('');
    } catch(e) {}
}

async function loadDesignerForPlan(planId) {
    if (!planId) {
        document.getElementById('designerContainer').style.display = 'none';
        document.getElementById('designerEmpty').style.display = '';
        document.getElementById('designerBar').style.display = 'none';
        return;
    }
    dsgPlanId = planId;
    document.getElementById('designerContainer').style.display = '';
    document.getElementById('designerEmpty').style.display = 'none';
    document.getElementById('designerBar').style.display = '';
    await loadDesignerPages();
    await loadDesignerTokens();
}

async function loadDesignerPages() {
    const result = await api('design/pages?plan_id=' + dsgPlanId);
    dsgPages = Array.isArray(result) ? result : [];
    if (dsgPages.length === 0) {
        const page = await api('design/pages', { method: 'POST', body: { plan_id: dsgPlanId, name: 'Home' } });
        if (page && page.id) dsgPages = [page];
    }
    renderPageTabs();
    if (!dsgCurrentPageId || !dsgPages.find(p => p.id === dsgCurrentPageId)) {
        dsgCurrentPageId = dsgPages[0].id;
    }
    await loadPageComponents();
}

function renderPageTabs() {
    const tabs = document.getElementById('pageTabs');
    tabs.innerHTML = dsgPages.map(p =>
        '<div class="page-tab' + (p.id === dsgCurrentPageId ? ' active' : '') + '" onclick="switchDesignPage(\\'' + p.id + '\\')">' + esc(p.name) + '</div>'
    ).join('') + '<div class="page-tab-add" onclick="addDesignPage()">+ Page</div>';
}

async function switchDesignPage(pageId) {
    dsgCurrentPageId = pageId;
    dsgSelectedId = null;
    renderPageTabs();
    await loadPageComponents();
}

async function addDesignPage() {
    const name = prompt('Page name:', 'New Page');
    if (!name) return;
    await api('design/pages', { method: 'POST', body: { plan_id: dsgPlanId, name, sort_order: dsgPages.length * 10 } });
    await loadDesignerPages();
}

async function loadPageComponents() {
    const result = await api('design/components?page_id=' + dsgCurrentPageId);
    dsgComponents = Array.isArray(result) ? result : [];
    renderCanvas();
    renderLayers();
    renderProps();
}

function renderCanvas() {
    const canvas = document.getElementById('designCanvas');
    const page = dsgPages.find(p => p.id === dsgCurrentPageId);
    if (page) {
        const bpWidths = { desktop: page.width, tablet: 768, mobile: 375 };
        const w = bpWidths[dsgBreakpoint] || page.width;
        canvas.style.width = w + 'px';
        canvas.style.height = page.height + 'px';
        canvas.style.background = page.background || '#1e1e2e';
        canvas.style.transform = 'scale(' + (dsgZoom / 100) + ')';
    }
    canvas.innerHTML = dsgComponents.map(c => renderDesignElement(c)).join('');
}

function renderDesignElement(comp) {
    const sel = comp.id === dsgSelectedId ? ' selected' : '';
    const styles = comp.styles || {};
    let styleStr = 'left:' + comp.x + 'px;top:' + comp.y + 'px;width:' + comp.width + 'px;height:' + comp.height + 'px;';
    if (styles.backgroundColor) styleStr += 'background-color:' + styles.backgroundColor + ';';
    if (styles.color) styleStr += 'color:' + styles.color + ';';
    if (styles.fontSize) styleStr += 'font-size:' + styles.fontSize + ';';
    if (styles.fontWeight) styleStr += 'font-weight:' + styles.fontWeight + ';';
    if (styles.borderRadius) styleStr += 'border-radius:' + styles.borderRadius + ';';
    if (styles.border) styleStr += 'border:' + styles.border + ';';
    if (styles.padding) styleStr += 'padding:' + styles.padding + ';';
    if (styles.boxShadow) styleStr += 'box-shadow:' + styles.boxShadow + ';';
    if (styles.display) styleStr += 'display:' + styles.display + ';';
    if (styles.flexDirection) styleStr += 'flex-direction:' + styles.flexDirection + ';';
    if (styles.justifyContent) styleStr += 'justify-content:' + styles.justifyContent + ';';
    if (styles.alignItems) styleStr += 'align-items:' + styles.alignItems + ';';
    if (styles.gap) styleStr += 'gap:' + styles.gap + ';';
    if (styles.opacity !== undefined) styleStr += 'opacity:' + styles.opacity + ';';
    if (styles.overflow) styleStr += 'overflow:' + styles.overflow + ';';

    const typeDefaults = {
        container: { bg: 'rgba(137,180,250,0.08)', label: 'Container' },
        text: { bg: 'transparent', label: comp.content || 'Text' },
        button: { bg: 'var(--blue)', label: comp.content || 'Button' },
        input: { bg: 'var(--bg3)', label: '[Input]' },
        image: { bg: 'var(--bg3)', label: '[Image]' },
        card: { bg: 'var(--bg2)', label: 'Card' },
        nav: { bg: 'var(--bg2)', label: 'Navbar' },
        modal: { bg: 'var(--bg2)', label: 'Modal' },
        sidebar: { bg: 'var(--bg2)', label: 'Sidebar' },
        header: { bg: 'var(--bg3)', label: 'Header' },
        footer: { bg: 'var(--bg3)', label: 'Footer' },
        list: { bg: 'transparent', label: 'List' },
        table: { bg: 'transparent', label: 'Table' },
        form: { bg: 'transparent', label: 'Form' },
        divider: { bg: 'var(--border)', label: '' },
        icon: { bg: 'transparent', label: '*' },
    };
    const def = typeDefaults[comp.type] || { bg: 'transparent', label: comp.type };
    if (!styles.backgroundColor) styleStr += 'background-color:' + def.bg + ';';

    return '<div class="design-el' + sel + '" data-id="' + comp.id + '" style="' + styleStr + '" ' +
        'onmousedown="onElMouseDown(event, \\'' + comp.id + '\\')" onclick="selectDesignEl(event, \\'' + comp.id + '\\')">' +
        '<span style="font-size:0.75em;color:var(--subtext);pointer-events:none;user-select:none">' + esc(def.label) + '</span>' +
        '<div class="resize-handle se" onmousedown="onResizeStart(event, \\'' + comp.id + '\\', \\'se\\')"></div>' +
        '<div class="resize-handle e" onmousedown="onResizeStart(event, \\'' + comp.id + '\\', \\'e\\')"></div>' +
        '<div class="resize-handle s" onmousedown="onResizeStart(event, \\'' + comp.id + '\\', \\'s\\')"></div>' +
        '<div class="resize-handle sw" onmousedown="onResizeStart(event, \\'' + comp.id + '\\', \\'sw\\')"></div>' +
        '<div class="resize-handle nw" onmousedown="onResizeStart(event, \\'' + comp.id + '\\', \\'nw\\')"></div>' +
        '<div class="resize-handle ne" onmousedown="onResizeStart(event, \\'' + comp.id + '\\', \\'ne\\')"></div>' +
        '<div class="resize-handle n" onmousedown="onResizeStart(event, \\'' + comp.id + '\\', \\'n\\')"></div>' +
        '<div class="resize-handle w" onmousedown="onResizeStart(event, \\'' + comp.id + '\\', \\'w\\')"></div>' +
        '</div>';
}

function renderLayers() {
    const el = document.getElementById('layerList');
    el.innerHTML = dsgComponents.map(c =>
        '<div class="layer-item' + (c.id === dsgSelectedId ? ' selected' : '') + '" onclick="selectDesignEl(null, \\'' + c.id + '\\')">' +
        '<span class="layer-icon">' + (c.type === 'text' ? 'Aa' : c.type === 'button' ? 'Btn' : '[ ]') + '</span>' +
        '<span class="layer-name">' + esc(c.name) + '</span></div>'
    ).join('') || '<div style="padding:8px;font-size:0.8em;color:var(--subtext)">No components</div>';
}

function selectDesignEl(e, id) {
    if (e) e.stopPropagation();
    dsgSelectedId = id;
    renderCanvas();
    renderLayers();
    renderProps();
}

function onCanvasClick(e) {
    if (e.target.id === 'designCanvas') {
        dsgSelectedId = null;
        renderCanvas();
        renderLayers();
        renderProps();
    }
}

function renderProps() {
    const panel = document.getElementById('propsPanel');
    const comp = dsgComponents.find(c => c.id === dsgSelectedId);
    if (!comp) {
        panel.innerHTML = '<div class="prop-section"><p style="color:var(--subtext);font-size:0.85em;padding:8px 0">Select a component to edit its properties</p></div>';
        return;
    }
    const s = comp.styles || {};
    panel.innerHTML = '' +
        '<div class="prop-section"><h4>Element</h4>' +
        '<div class="prop-row"><label for="prop-' + comp.id + '-name">Name</label><input id="prop-' + comp.id + '-name" value="' + esc(comp.name) + '" onchange="updateCompProp(\\'' + comp.id + '\\', \\'name\\', this.value)"></div>' +
        '<div class="prop-row"><label>Type</label><span style="font-size:0.85em;color:var(--blue)">' + esc(comp.type) + '</span></div>' +
        '<div class="prop-row"><label for="prop-' + comp.id + '-content">Content</label><input id="prop-' + comp.id + '-content" value="' + esc(comp.content) + '" onchange="updateCompProp(\\'' + comp.id + '\\', \\'content\\', this.value)"></div>' +
        '</div>' +
        '<div class="prop-section"><h4>Position & Size</h4>' +
        '<div class="prop-row"><label for="prop-' + comp.id + '-x">X</label><input id="prop-' + comp.id + '-x" type="number" value="' + comp.x + '" onchange="updateCompProp(\\'' + comp.id + '\\', \\'x\\', +this.value)"></div>' +
        '<div class="prop-row"><label for="prop-' + comp.id + '-y">Y</label><input id="prop-' + comp.id + '-y" type="number" value="' + comp.y + '" onchange="updateCompProp(\\'' + comp.id + '\\', \\'y\\', +this.value)"></div>' +
        '<div class="prop-row"><label for="prop-' + comp.id + '-width">Width</label><input id="prop-' + comp.id + '-width" type="number" value="' + comp.width + '" onchange="updateCompProp(\\'' + comp.id + '\\', \\'width\\', +this.value)"></div>' +
        '<div class="prop-row"><label for="prop-' + comp.id + '-height">Height</label><input id="prop-' + comp.id + '-height" type="number" value="' + comp.height + '" onchange="updateCompProp(\\'' + comp.id + '\\', \\'height\\', +this.value)"></div>' +
        '</div>' +
        '<div class="prop-section"><h4>Appearance</h4>' +
        '<div class="prop-row"><label for="prop-' + comp.id + '-bgColor">BG</label><input id="prop-' + comp.id + '-bgColor" type="color" value="' + (s.backgroundColor || '#313244') + '" onchange="updateCompStyle(\\'' + comp.id + '\\', \\'backgroundColor\\', this.value)"><input id="prop-' + comp.id + '-bgHex" value="' + esc(s.backgroundColor || '') + '" placeholder="#hex" onchange="updateCompStyle(\\'' + comp.id + '\\', \\'backgroundColor\\', this.value)" style="flex:1"></div>' +
        '<div class="prop-row"><label for="prop-' + comp.id + '-fgColor">Color</label><input id="prop-' + comp.id + '-fgColor" type="color" value="' + (s.color || '#cdd6f4') + '" onchange="updateCompStyle(\\'' + comp.id + '\\', \\'color\\', this.value)"><input id="prop-' + comp.id + '-fgHex" value="' + esc(s.color || '') + '" placeholder="#hex" onchange="updateCompStyle(\\'' + comp.id + '\\', \\'color\\', this.value)" style="flex:1"></div>' +
        '<div class="prop-row"><label for="prop-' + comp.id + '-font">Font</label><input id="prop-' + comp.id + '-font" value="' + esc(s.fontSize || '14px') + '" onchange="updateCompStyle(\\'' + comp.id + '\\', \\'fontSize\\', this.value)"></div>' +
        '<div class="prop-row"><label for="prop-' + comp.id + '-weight">Weight</label><select id="prop-' + comp.id + '-weight" onchange="updateCompStyle(\\'' + comp.id + '\\', \\'fontWeight\\', this.value)"><option' + (!s.fontWeight || s.fontWeight==='normal' ? ' selected' : '') + '>normal</option><option' + (s.fontWeight==='bold' ? ' selected' : '') + '>bold</option><option' + (s.fontWeight==='600' ? ' selected' : '') + '>600</option></select></div>' +
        '<div class="prop-row"><label for="prop-' + comp.id + '-radius">Radius</label><input id="prop-' + comp.id + '-radius" value="' + esc(s.borderRadius || '0px') + '" onchange="updateCompStyle(\\'' + comp.id + '\\', \\'borderRadius\\', this.value)"></div>' +
        '<div class="prop-row"><label for="prop-' + comp.id + '-border">Border</label><input id="prop-' + comp.id + '-border" value="' + esc(s.border || 'none') + '" placeholder="1px solid #ccc" onchange="updateCompStyle(\\'' + comp.id + '\\', \\'border\\', this.value)"></div>' +
        '<div class="prop-row"><label for="prop-' + comp.id + '-shadow">Shadow</label><input id="prop-' + comp.id + '-shadow" value="' + esc(s.boxShadow || 'none') + '" onchange="updateCompStyle(\\'' + comp.id + '\\', \\'boxShadow\\', this.value)"></div>' +
        '<div class="prop-row"><label for="prop-' + comp.id + '-opacity">Opacity</label><input id="prop-' + comp.id + '-opacity" type="range" min="0" max="1" step="0.05" value="' + (s.opacity ?? 1) + '" oninput="updateCompStyle(\\'' + comp.id + '\\', \\'opacity\\', +this.value)"></div>' +
        '<div class="prop-row"><label for="prop-' + comp.id + '-padding">Padding</label><input id="prop-' + comp.id + '-padding" value="' + esc(s.padding || '0px') + '" onchange="updateCompStyle(\\'' + comp.id + '\\', \\'padding\\', this.value)"></div>' +
        '</div>' +
        '<div class="prop-section"><h4>Layout (Flex)</h4>' +
        '<div class="prop-row"><label for="prop-' + comp.id + '-display">Display</label><select id="prop-' + comp.id + '-display" onchange="updateCompStyle(\\'' + comp.id + '\\', \\'display\\', this.value)"><option' + (s.display==='block' ? ' selected' : '') + '>block</option><option' + (s.display==='flex' ? ' selected' : '') + '>flex</option><option' + (s.display==='grid' ? ' selected' : '') + '>grid</option><option' + (s.display==='none' ? ' selected' : '') + '>none</option></select></div>' +
        '<div class="prop-row"><label for="prop-' + comp.id + '-dir">Dir</label><select id="prop-' + comp.id + '-dir" onchange="updateCompStyle(\\'' + comp.id + '\\', \\'flexDirection\\', this.value)"><option' + (s.flexDirection==='row' ? ' selected' : '') + '>row</option><option' + (s.flexDirection==='column' || !s.flexDirection ? ' selected' : '') + '>column</option></select></div>' +
        '<div class="prop-row"><label for="prop-' + comp.id + '-justify">Justify</label><select id="prop-' + comp.id + '-justify" onchange="updateCompStyle(\\'' + comp.id + '\\', \\'justifyContent\\', this.value)"><option>flex-start</option><option' + (s.justifyContent==='center' ? ' selected' : '') + '>center</option><option' + (s.justifyContent==='flex-end' ? ' selected' : '') + '>flex-end</option><option' + (s.justifyContent==='space-between' ? ' selected' : '') + '>space-between</option></select></div>' +
        '<div class="prop-row"><label for="prop-' + comp.id + '-align">Align</label><select id="prop-' + comp.id + '-align" onchange="updateCompStyle(\\'' + comp.id + '\\', \\'alignItems\\', this.value)"><option>stretch</option><option' + (s.alignItems==='center' ? ' selected' : '') + '>center</option><option' + (s.alignItems==='flex-start' ? ' selected' : '') + '>flex-start</option><option' + (s.alignItems==='flex-end' ? ' selected' : '') + '>flex-end</option></select></div>' +
        '<div class="prop-row"><label for="prop-' + comp.id + '-gap">Gap</label><input id="prop-' + comp.id + '-gap" value="' + esc(s.gap || '0px') + '" onchange="updateCompStyle(\\'' + comp.id + '\\', \\'gap\\', this.value)"></div>' +
        '</div>' +
        '<div class="prop-section"><h4>Actions</h4>' +
        '<button class="btn btn-sm btn-secondary" onclick="duplicateComponent(\\'' + comp.id + '\\')" style="margin-right:4px">Duplicate</button>' +
        '<button class="btn btn-sm btn-danger" onclick="deleteComponent(\\'' + comp.id + '\\')">Delete</button>' +
        '</div>';
}

async function updateCompProp(id, key, value) {
    const comp = dsgComponents.find(c => c.id === id);
    if (!comp) return;
    comp[key] = value;
    await api('design/components/' + id, { method: 'PUT', body: { [key]: value } });
    renderCanvas();
    renderLayers();
}

async function updateCompStyle(id, key, value) {
    const comp = dsgComponents.find(c => c.id === id);
    if (!comp) return;
    if (!comp.styles) comp.styles = {};
    comp.styles[key] = value;
    await api('design/components/' + id, { method: 'PUT', body: { styles: comp.styles } });
    renderCanvas();
}

async function duplicateComponent(id) {
    const comp = dsgComponents.find(c => c.id === id);
    if (!comp) return;
    await api('design/components', { method: 'POST', body: {
        plan_id: comp.plan_id, page_id: comp.page_id, type: comp.type,
        name: comp.name + ' Copy', x: comp.x + 20, y: comp.y + 20,
        width: comp.width, height: comp.height, styles: comp.styles,
        content: comp.content, props: comp.props
    }});
    await loadPageComponents();
}

async function deleteComponent(id) {
    if (!confirm('Delete this component?')) return;
    await api('design/components/' + id, { method: 'DELETE' });
    dsgSelectedId = null;
    await loadPageComponents();
}

// Canvas drag-and-drop from palette
function onCanvasDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }

async function onCanvasDrop(e) {
    e.preventDefault();
    const compType = e.dataTransfer.getData('text/plain');
    if (!compType || !dsgPlanId || !dsgCurrentPageId) return;
    const canvas = document.getElementById('designCanvas');
    const rect = canvas.getBoundingClientRect();
    const scale = dsgZoom / 100;
    const x = Math.round((e.clientX - rect.left) / scale);
    const y = Math.round((e.clientY - rect.top) / scale);
    const defaults = { container: { w: 300, h: 200 }, text: { w: 200, h: 30 }, button: { w: 120, h: 40 }, input: { w: 240, h: 36 },
        image: { w: 200, h: 150 }, card: { w: 280, h: 180 }, nav: { w: 1440, h: 60 }, modal: { w: 400, h: 300 },
        sidebar: { w: 240, h: 600 }, header: { w: 1440, h: 80 }, footer: { w: 1440, h: 60 }, list: { w: 240, h: 200 },
        table: { w: 400, h: 200 }, form: { w: 300, h: 250 }, divider: { w: 400, h: 2 }, icon: { w: 32, h: 32 } };
    const d = defaults[compType] || { w: 200, h: 100 };
    await api('design/components', { method: 'POST', body: {
        plan_id: dsgPlanId, page_id: dsgCurrentPageId, type: compType, name: compType.charAt(0).toUpperCase() + compType.slice(1),
        x, y, width: d.w, height: d.h, styles: {}, content: compType === 'text' ? 'Text' : compType === 'button' ? 'Click me' : ''
    }});
    await loadPageComponents();
}

// Palette items drag
document.querySelectorAll('.comp-palette-item').forEach(item => {
    item.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', item.dataset.comp); e.dataTransfer.effectAllowed = 'copy'; });
});

// Element movement
function onElMouseDown(e, id) {
    if (e.target.classList.contains('resize-handle')) return;
    e.preventDefault();
    dsgDraggingEl = id;
    const comp = dsgComponents.find(c => c.id === id);
    if (!comp) return;
    const canvas = document.getElementById('designCanvas');
    const rect = canvas.getBoundingClientRect();
    const scale = dsgZoom / 100;
    dsgDragOffset = { x: e.clientX / scale - comp.x, y: e.clientY / scale - comp.y };
    selectDesignEl(e, id);

    const onMove = (ev) => {
        if (!dsgDraggingEl) return;
        const c = dsgComponents.find(c => c.id === dsgDraggingEl);
        if (!c) return;
        c.x = Math.max(0, Math.round(ev.clientX / scale - dsgDragOffset.x));
        c.y = Math.max(0, Math.round(ev.clientY / scale - dsgDragOffset.y));
        const el = document.querySelector('.design-el[data-id="' + dsgDraggingEl + '"]');
        if (el) { el.style.left = c.x + 'px'; el.style.top = c.y + 'px'; }
    };
    const onUp = () => {
        if (dsgDraggingEl) {
            const c = dsgComponents.find(c => c.id === dsgDraggingEl);
            if (c) api('design/components/' + c.id, { method: 'PUT', body: { x: c.x, y: c.y } });
        }
        dsgDraggingEl = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        renderProps();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

// Resize
function onResizeStart(e, id, handle) {
    e.stopPropagation();
    e.preventDefault();
    const comp = dsgComponents.find(c => c.id === id);
    if (!comp) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = comp.width;
    const startH = comp.height;
    const startCX = comp.x;
    const startCY = comp.y;
    const scale = dsgZoom / 100;

    const onMove = (ev) => {
        const dx = (ev.clientX - startX) / scale;
        const dy = (ev.clientY - startY) / scale;
        if (handle.includes('e')) comp.width = Math.max(10, Math.round(startW + dx));
        if (handle.includes('s')) comp.height = Math.max(10, Math.round(startH + dy));
        if (handle.includes('w')) { comp.width = Math.max(10, Math.round(startW - dx)); comp.x = Math.round(startCX + dx); }
        if (handle.includes('n')) { comp.height = Math.max(10, Math.round(startH - dy)); comp.y = Math.round(startCY + dy); }
        const el = document.querySelector('.design-el[data-id="' + id + '"]');
        if (el) { el.style.width = comp.width + 'px'; el.style.height = comp.height + 'px'; el.style.left = comp.x + 'px'; el.style.top = comp.y + 'px'; }
    };
    const onUp = () => {
        api('design/components/' + id, { method: 'PUT', body: { x: comp.x, y: comp.y, width: comp.width, height: comp.height } });
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        renderProps();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

// Responsive + Zoom
function setBreakpoint(bp) {
    dsgBreakpoint = bp;
    document.querySelectorAll('.responsive-btn').forEach(b => b.classList.toggle('active', b.dataset.bp === bp));
    renderCanvas();
}
function setCanvasZoom(val) {
    dsgZoom = parseInt(val);
    document.getElementById('zoomLabel').textContent = dsgZoom + '%';
    renderCanvas();
}

// Design Tokens
async function loadDesignerTokens() {
    if (!dsgPlanId) return;
    const result = await api('design/tokens?plan_id=' + dsgPlanId);
    const tokens = Array.isArray(result) ? result : [];
    const el = document.getElementById('tokenList');
    el.innerHTML = tokens.length ? '<div class="token-grid">' + tokens.map(t => {
        const isColor = t.category === 'color';
        return '<div class="token-card">' +
            (isColor ? '<div class="token-swatch" style="background:' + esc(t.value) + '"></div>' : '') +
            '<div class="token-info"><div class="token-name">' + esc(t.name) + '</div><div class="token-val">' + esc(t.value) + '</div></div>' +
            '<span style="cursor:pointer;color:var(--red);font-size:0.8em" onclick="deleteToken(\\'' + t.id + '\\')">&times;</span></div>';
    }).join('') + '</div>' : '<div style="font-size:0.8em;color:var(--subtext)">No tokens. Add colors, spacing, fonts.</div>';
}

async function openTokenEditor() {
    const name = prompt('Token name (e.g., primary-color):');
    if (!name) return;
    const value = prompt('Token value (e.g., #89b4fa):');
    if (!value) return;
    const category = value.startsWith('#') || value.startsWith('rgb') ? 'color' : value.match(/\\d+px/) ? 'spacing' : 'typography';
    await api('design/tokens', { method: 'POST', body: { plan_id: dsgPlanId, name, value, category } });
    await loadDesignerTokens();
}

async function deleteToken(id) {
    await api('design/tokens/' + id, { method: 'DELETE' });
    await loadDesignerTokens();
}

async function exportDesignSpec() {
    if (!dsgPlanId) return alert('Select a plan first');
    try {
        const spec = await api('design/export', { method: 'POST', body: { plan_id: dsgPlanId } });
        const blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'design-spec-' + Date.now() + '.json'; a.click();
        URL.revokeObjectURL(url);
    } catch (e) { alert('Export failed: ' + String(e)); }
}

// ==================== CODING CONVERSATION ====================
let codingSessions = [];
let currentSessionId = null;
let codingMessages = [];

async function loadCodingSessions() {
    const result = await api('coding/sessions');
    codingSessions = Array.isArray(result) ? result : [];
    const list = document.getElementById('sessionList');
    list.innerHTML = codingSessions.map(s =>
        '<div class="session-item' + (s.id === currentSessionId ? ' active' : '') + '" onclick="openCodingSession(\\'' + s.id + '\\')">' +
        '<div class="session-name">' + esc(s.name) + '</div>' +
        '<div class="session-meta">' + esc(s.status) + ' — ' + esc(s.updated_at || '') + '</div></div>'
    ).join('') || '<div style="padding:8px;font-size:0.8em;color:var(--subtext)">No sessions yet</div>';
}

async function newCodingSession() {
    const name = prompt('Session name:', 'Coding Session');
    if (!name) return;
    const planId = document.getElementById('designerPlanSelect')?.value || null;
    const session = await api('coding/sessions', { method: 'POST', body: { name, plan_id: planId } });
    currentSessionId = session.id;
    await loadCodingSessions();
    await loadCodingMessages();
}

async function openCodingSession(id) {
    currentSessionId = id;
    const session = codingSessions.find(s => s.id === id);
    document.getElementById('codingSessionName').textContent = session ? session.name : 'Session';
    await loadCodingSessions();
    await loadCodingMessages();
}

async function loadCodingMessages() {
    if (!currentSessionId) return;
    const data = await api('coding/sessions/' + currentSessionId);
    codingMessages = data.messages || [];
    const container = document.getElementById('codingMessages');
    if (codingMessages.length === 0) {
        container.innerHTML = '<div class="empty">No messages yet. Type below or generate a prompt from a task.</div>';
        return;
    }
    container.innerHTML = codingMessages.map(m => {
        var toolsHtml = '';
        var confidenceBadge = '';
        if (m.role === 'agent' && m.tool_calls && m.tool_calls !== '[]') {
            try {
                var tc = JSON.parse(m.tool_calls);
                if (tc.confidence !== undefined) {
                    var cls = tc.confidence >= 70 ? 'confidence-high' : tc.confidence >= 40 ? 'confidence-mid' : 'confidence-low';
                    confidenceBadge = '<span class="msg-confidence ' + cls + '">' + tc.confidence + '%</span>';
                }
                var metaParts = [];
                if (tc.duration_ms) metaParts.push(tc.duration_ms + 'ms');
                if (tc.tokens_used) metaParts.push(tc.tokens_used + ' tokens');
                if (tc.files && tc.files.length > 0) metaParts.push(tc.files.length + ' file(s)');
                if (tc.requires_approval) metaParts.push('Needs approval');
                if (tc.warnings && tc.warnings.length > 0) metaParts.push(tc.warnings.length + ' warning(s)');
                if (metaParts.length > 0) {
                    toolsHtml = '<div class="msg-tools">' + esc(metaParts.join(' | ')) + '</div>';
                }
            } catch (e) {
                toolsHtml = '<div class="msg-tools"><strong>Tools:</strong> ' + esc(m.tool_calls) + '</div>';
            }
        } else if (m.tool_calls && m.tool_calls !== '[]') {
            toolsHtml = '<div class="msg-tools"><strong>Tools:</strong> ' + esc(m.tool_calls) + '</div>';
        }
        var contentHtml = renderMarkdown(m.content || '');
        var roleLabel = m.role === 'user' ? 'You' : m.role === 'agent' ? 'Coding Agent' : 'System';
        var roleIcon = m.role === 'user' ? '' : m.role === 'agent' ? '' : '';
        return '<div class="coding-msg ' + esc(m.role) + '">' +
            '<div class="msg-role">' + roleIcon + ' ' + roleLabel + '</div>' +
            '<div class="msg-bubble">' + contentHtml + '</div>' + toolsHtml +
            '<div class="msg-meta">' + formatTime(m.created_at) + confidenceBadge + '</div></div>';
    }).join('');
    container.scrollTop = container.scrollHeight;
}

async function sendCodingMsg() {
    if (!currentSessionId) return alert('Start or select a session first');
    const input = document.getElementById('codingInput');
    const text = input.value.trim();
    if (!text) return;
    const taskId = document.getElementById('codingTaskSelect')?.value || null;

    // Clear input and show loading state
    input.value = '';
    input.disabled = true;
    const sendBtn = document.getElementById('codingSendBtn');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Thinking...'; }

    // Show user message + loading bubble immediately
    const container = document.getElementById('codingMessages');
    container.innerHTML += '<div class="coding-msg user"><div class="msg-role"> You</div><div class="msg-bubble">' + renderMarkdown(text) + '</div><div class="msg-meta">just now</div></div>';
    container.innerHTML += '<div class="coding-msg agent loading" id="loadingMsg"><div class="msg-role"> Coding Agent</div><div class="msg-bubble">Thinking...</div></div>';
    container.scrollTop = container.scrollHeight;

    try {
        await api('coding/process', { method: 'POST', body: {
            session_id: currentSessionId, content: text, task_id: taskId
        }});
        var loading = document.getElementById('loadingMsg');
        if (loading) loading.remove();
        await loadCodingMessages();
    } catch (e) {
        var ld = document.getElementById('loadingMsg');
        if (ld) ld.remove();
        container.innerHTML += '<div class="coding-msg system"><div class="msg-bubble">Error: ' + esc(String(e)) + '</div></div>';
        container.scrollTop = container.scrollHeight;
    } finally {
        input.disabled = false;
        input.focus();
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'User Send'; }
    }
}

async function addAgentResponse() {
    if (!currentSessionId) return alert('Start or select a session first');
    const text = document.getElementById('codingInput').value.trim();
    if (!text) return;
    await api('coding/messages', { method: 'POST', body: {
        session_id: currentSessionId, role: 'agent', content: text
    }});
    document.getElementById('codingInput').value = '';
    await loadCodingMessages();
}

async function generatePromptFromTask() {
    const taskId = document.getElementById('codingTaskSelect')?.value;
    if (!taskId) return alert('Select a task first');
    try {
        const task = await api('tasks/' + taskId);
        const prompt = [
            '## Task: ' + task.title,
            '',
            '**Priority:** ' + task.priority,
            '**Estimated:** ' + task.estimated_minutes + ' minutes',
            '',
            '### Description',
            task.description || 'No description provided.',
            '',
            '### Acceptance Criteria',
            task.acceptance_criteria || 'None specified.',
            '',
            '### Instructions',
            'Please implement this task. When done, use the MCP tool reportTaskDone with:',
            '- task_id: ' + task.id,
            '- summary: What you did',
            '- files_modified: Array of file paths changed',
            '- decisions_made: Any architectural decisions',
            '',
            'If you have questions, use askQuestion tool.',
            'If you encounter errors, use getErrors tool.',
        ].join('\\n');
        document.getElementById('codingInput').value = prompt;
    } catch (e) { alert('Error: ' + String(e)); }
}

function copyCodingToClipboard() {
    const text = codingMessages.map(m => '[' + m.role.toUpperCase() + ']\\n' + m.content).join('\\n\\n---\\n\\n');
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.querySelector('#page-coding .btn-secondary:last-child');
        if (btn) { const old = btn.textContent; btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = old, 1500); }
    });
}

// ==================== SETTINGS ====================
let settingsConfig = {};

async function loadSettings() {
    settingsConfig = await api('config');
    showSettingsSection('llm');
}

function showSettingsSection(section) {
    document.querySelectorAll('.settings-nav-item').forEach(i => i.classList.toggle('active', i.dataset.settings === section));
    const panel = document.getElementById('settingsPanel');

    const sections = {
        llm: () => '<div class="settings-section"><h3>LLM Configuration</h3>' +
            settingRow('API Endpoint', 'URL of the LLM server (LM Studio, Ollama, OpenAI)', '<input id="setting-llm-endpoint" value="' + esc(settingsConfig.llm?.endpoint || '') + '" onchange="updateSetting(\\'llm.endpoint\\', this.value)">', 'setting-llm-endpoint') +
            settingRow('Model', 'Model identifier', '<input id="setting-llm-model" value="' + esc(settingsConfig.llm?.model || '') + '" onchange="updateSetting(\\'llm.model\\', this.value)">', 'setting-llm-model') +
            settingRow('Max Tokens', 'Maximum response length', '<input id="setting-llm-maxTokens" type="number" value="' + (settingsConfig.llm?.maxTokens || 4096) + '" onchange="updateSetting(\\'llm.maxTokens\\', +this.value)">', 'setting-llm-maxTokens') +
            settingRow('Timeout (seconds)', 'Max total request time', '<input id="setting-llm-timeoutSeconds" type="number" value="' + (settingsConfig.llm?.timeoutSeconds || 900) + '" onchange="updateSetting(\\'llm.timeoutSeconds\\', +this.value)">', 'setting-llm-timeoutSeconds') +
            settingRow('Startup Timeout', 'Wait for model load', '<input id="setting-llm-startupTimeout" type="number" value="' + (settingsConfig.llm?.startupTimeoutSeconds || 300) + '" onchange="updateSetting(\\'llm.startupTimeoutSeconds\\', +this.value)">', 'setting-llm-startupTimeout') +
            settingRow('Stream Stall Timeout', 'Max gap between stream chunks', '<input id="setting-llm-streamStall" type="number" value="' + (settingsConfig.llm?.streamStallTimeoutSeconds || 120) + '" onchange="updateSetting(\\'llm.streamStallTimeoutSeconds\\', +this.value)">', 'setting-llm-streamStall') +
            '</div>',

        agents: () => {
            const agents = settingsConfig.agents || {};
            return '<div class="settings-section"><h3>Agent Configuration</h3>' +
                Object.entries(agents).map(([name, cfg]) =>
                    settingRow(name.charAt(0).toUpperCase() + name.slice(1) + ' Agent', 'Context limit and enabled state',
                        '<div style="display:flex;gap:8px;align-items:center"><input id="setting-agent-' + name + '-contextLimit" type="number" value="' + ((cfg && cfg.contextLimit) || 4096) + '" style="width:80px" onchange="updateAgentSetting(\\'' + name + '\\', \\'contextLimit\\', +this.value)"><div class="toggle-switch' + ((cfg && cfg.enabled !== false) ? ' on' : '') + '" onclick="toggleAgent(\\'' + name + '\\', this)"></div></div>', 'setting-agent-' + name + '-contextLimit')
                ).join('') + '</div>';
        },

        tasks: () => '<div class="settings-section"><h3>Task Queue</h3>' +
            settingRow('Max Pending Tasks', 'Maximum tasks in queue before blocking', '<input id="setting-taskQueue-maxPending" type="number" value="' + (settingsConfig.taskQueue?.maxPending || 50) + '" onchange="updateSetting(\\'taskQueue.maxPending\\', +this.value)">', 'setting-taskQueue-maxPending') +
            '</div>',

        verification: () => '<div class="settings-section"><h3>Verification</h3>' +
            settingRow('Delay (seconds)', 'Wait before running verification after task completion', '<input id="setting-verification-delay" type="number" value="' + (settingsConfig.verification?.delaySeconds || 5) + '" onchange="updateSetting(\\'verification.delaySeconds\\', +this.value)">', 'setting-verification-delay') +
            settingRow('Coverage Threshold (%)', 'Minimum test coverage to pass', '<input id="setting-verification-coverage" type="number" value="' + (settingsConfig.verification?.coverageThreshold || 80) + '" min="0" max="100" onchange="updateSetting(\\'verification.coverageThreshold\\', +this.value)">', 'setting-verification-coverage') +
            '</div>',

        'github-settings': () => '<div class="settings-section"><h3>GitHub Integration</h3>' +
            settingRow('Personal Access Token', 'GitHub PAT for API access', '<input id="setting-github-token" type="password" value="' + esc(settingsConfig.github?.token || '') + '" onchange="updateSetting(\\'github.token\\', this.value)">', 'setting-github-token') +
            settingRow('Repository Owner', 'GitHub username or org', '<input id="setting-github-owner" value="' + esc(settingsConfig.github?.owner || '') + '" onchange="updateSetting(\\'github.owner\\', this.value)">', 'setting-github-owner') +
            settingRow('Repository Name', 'Repository name', '<input id="setting-github-repo" value="' + esc(settingsConfig.github?.repo || '') + '" onchange="updateSetting(\\'github.repo\\', this.value)">', 'setting-github-repo') +
            settingRow('Sync Interval (minutes)', 'How often to auto-sync', '<input id="setting-github-syncInterval" type="number" value="' + (settingsConfig.github?.syncIntervalMinutes || 15) + '" onchange="updateSetting(\\'github.syncIntervalMinutes\\', +this.value)">', 'setting-github-syncInterval') +
            '</div>',

        'designer-settings': () => '<div class="settings-section"><h3>Visual Designer</h3>' +
            settingRow('Default Canvas Width', 'Desktop canvas width in pixels', '<input id="setting-designer-width" type="number" value="1440">', 'setting-designer-width') +
            settingRow('Default Canvas Height', 'Canvas height in pixels', '<input id="setting-designer-height" type="number" value="900">', 'setting-designer-height') +
            settingRow('Grid Snap', 'Snap components to grid', '<input id="setting-designer-gridSnap" type="number" value="8" min="1" max="100">', 'setting-designer-gridSnap') +
            settingRow('Show Grid', 'Display grid lines on canvas', '<div class="toggle-switch on" onclick="this.classList.toggle(\\'on\\')"></div>') +
            '</div>',

        appearance: () => '<div class="settings-section"><h3>Appearance</h3>' +
            settingRow('Theme', 'Dashboard color theme', '<select id="setting-ui-theme"><option selected>Dark (Catppuccin Mocha)</option><option>Light</option><option>High Contrast</option></select>', 'setting-ui-theme') +
            settingRow('Compact Mode', 'Reduce padding and spacing', '<div class="toggle-switch" onclick="this.classList.toggle(\\'on\\')"></div>') +
            settingRow('Font Size', 'Base font size', '<select id="setting-ui-fontSize"><option>Small (13px)</option><option selected>Medium (14px)</option><option>Large (16px)</option></select>', 'setting-ui-fontSize') +
            '</div>',

        advanced: () => '<div class="settings-section"><h3>Advanced</h3>' +
            settingRow('Watcher Debounce (ms)', 'File change detection delay', '<input id="setting-advanced-debounce" type="number" value="' + (settingsConfig.watcher?.debounceMs || 2000) + '" onchange="updateSetting(\\'watcher.debounceMs\\', +this.value)">', 'setting-advanced-debounce') +
            settingRow('Database Path', 'SQLite database location', '<input id="setting-advanced-dbPath" value=".coe/tickets.db" disabled style="opacity:0.6">', 'setting-advanced-dbPath') +
            settingRow('MCP Port', 'MCP server port (auto-increments if busy)', '<input id="setting-advanced-mcpPort" type="number" value="3030" disabled style="opacity:0.6">', 'setting-advanced-mcpPort') +
            '<div class="btn-row"><button class="btn btn-danger btn-sm" onclick="if(confirm(\\'Reset all settings to defaults?\\'))resetSettings()">Reset to Defaults</button></div>' +
            '</div>',
    };

    panel.innerHTML = (sections[section] || sections.llm)();
}

function settingRow(label, desc, control, forId) {
    const labelTag = forId ? '<label for="' + forId + '"><strong>' + label + '</strong><span>' + desc + '</span></label>' : '<div class="setting-label"><strong>' + label + '</strong><span>' + desc + '</span></div>';
    return '<div class="setting-row">' + labelTag + '<div class="setting-control">' + control + '</div></div>';
}

async function updateSetting(path, value) {
    const parts = path.split('.');
    const update = {};
    let current = update;
    for (let i = 0; i < parts.length - 1; i++) {
        current[parts[i]] = { ...(settingsConfig[parts[i]] || {}) };
        current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
    // Deep merge with existing
    const merged = { ...settingsConfig };
    for (const key of Object.keys(update)) {
        merged[key] = { ...merged[key], ...update[key] };
    }
    try {
        settingsConfig = await api('config', { method: 'PUT', body: merged });
    } catch (e) { console.error('Settings save error:', e); }
}

function updateAgentSetting(name, key, value) {
    if (!settingsConfig.agents) settingsConfig.agents = {};
    if (!settingsConfig.agents[name]) settingsConfig.agents[name] = { contextLimit: 4096, enabled: true };
    settingsConfig.agents[name][key] = value;
    updateSetting('agents', settingsConfig.agents);
}

function toggleAgent(name, el) {
    el.classList.toggle('on');
    updateAgentSetting(name, 'enabled', el.classList.contains('on'));
}

async function resetSettings() {
    try {
        await api('config', { method: 'PUT', body: {} });
        settingsConfig = await api('config');
        showSettingsSection('llm');
    } catch(e) { alert('Reset failed: ' + e); }
}

// ==================== INIT ====================
loadDashboard();
setInterval(() => {
    if (document.getElementById('page-dashboard').classList.contains('active')) loadDashboard();
}, 5000);
</script>
</body>
</html>`;
}
