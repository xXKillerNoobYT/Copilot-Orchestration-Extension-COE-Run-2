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
.ai-level-toggle { display: flex; align-items: center; gap: 4px; background: var(--bg3); border-radius: 6px; padding: 2px; }
.ai-level-toggle button { background: none; border: none; color: var(--subtext); padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.78em; font-weight: 500; transition: all 0.15s; white-space: nowrap; }
.ai-level-toggle button:hover { color: var(--text); }
.ai-level-toggle button.active { background: var(--blue); color: #fff; }
.ai-level-label { font-size: 0.75em; color: var(--overlay); margin-right: 2px; }
.live-preview-mini { position: fixed; bottom: 16px; left: 16px; width: 340px; background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; z-index: 200; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.3); transition: transform 0.25s ease, opacity 0.25s ease; }
.live-preview-mini.hidden { transform: translateY(120%); opacity: 0; pointer-events: none; }
.live-preview-mini.minimized .live-preview-body { display: none; }
.live-preview-mini.minimized { width: 200px; }
.live-preview-header { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: var(--bg3); border-bottom: 1px solid var(--border); font-size: 0.8em; font-weight: 600; cursor: pointer; }
.live-preview-header-btns { display: flex; gap: 6px; }
.live-preview-header-btns span { cursor: pointer; opacity: 0.7; font-size: 1.1em; }
.live-preview-header-btns span:hover { opacity: 1; }
.live-preview-body { padding: 10px; max-height: 300px; overflow: auto; font-size: 0.78em; }
.live-preview-body .lp-row { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid var(--border); }
.live-preview-body .lp-label { color: var(--subtext); }
.live-preview-body .lp-val { color: var(--text); font-weight: 500; }
.lp-minimap { width: 100%; height: 200px; background: var(--surface); border-radius: 6px; position: relative; overflow: hidden; margin-bottom: 8px; border: 1px solid var(--overlay); }
.lp-minimap-page { font-size: 0.7em; color: var(--subtext); padding: 4px 6px; position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.5); }
.lp-minimap-comp { position: absolute; border: 1px solid var(--accent); border-radius: 3px; background: rgba(137,180,250,0.15); font-size: 0.6em; color: var(--subtext); display: flex; align-items: center; justify-content: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 1px 3px; }
.lp-minimap-comp.selected { border-color: var(--green); background: rgba(166,227,161,0.2); }
.lp-summary { display: flex; gap: 12px; padding: 6px 0; font-size: 0.85em; color: var(--subtext); flex-wrap: wrap; }
.lp-summary span { display: flex; align-items: center; gap: 4px; }

/* AI CHAT OVERLAY */
.ai-chat-overlay { position: fixed; bottom: 80px; right: 20px; width: 380px; height: 500px; background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; z-index: 300; box-shadow: 0 8px 32px rgba(0,0,0,0.4); display: flex; flex-direction: column; transition: height 0.2s; }
.ai-chat-overlay.hidden { display: none; }
.ai-chat-overlay.minimized { height: 48px; overflow: hidden; }
.ai-chat-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: var(--bg3); border-bottom: 1px solid var(--border); cursor: move; user-select: none; border-radius: 12px 12px 0 0; flex-shrink: 0; }
.ai-chat-header-title { font-weight: 600; font-size: 0.85em; color: var(--text); }
.ai-chat-header-btns { display: flex; gap: 6px; }
.ai-chat-header-btns button { background: none; border: none; color: var(--subtext); cursor: pointer; font-size: 1em; padding: 2px 6px; border-radius: 4px; line-height: 1; }
.ai-chat-header-btns button:hover { background: var(--surface); color: var(--text); }
.ai-chat-context { font-size: 0.7em; color: var(--overlay); padding: 4px 12px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.ai-chat-messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.ai-chat-msg { display: flex; flex-direction: column; }
.ai-chat-msg.user { align-items: flex-end; }
.ai-chat-msg.ai { align-items: flex-start; }
.ai-chat-msg.system { align-items: center; }
.ai-chat-bubble { display: inline-block; padding: 8px 12px; border-radius: 10px; max-width: 85%; font-size: 0.85em; line-height: 1.4; word-wrap: break-word; }
.ai-chat-msg.user .ai-chat-bubble { background: var(--blue); color: #fff; border-bottom-right-radius: 2px; }
.ai-chat-msg.ai .ai-chat-bubble { background: var(--bg3); color: var(--text); border-bottom-left-radius: 2px; }
.ai-chat-msg.system .ai-chat-bubble { background: none; color: var(--overlay); font-size: 0.75em; font-style: italic; }
.ai-chat-input-area { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--border); flex-shrink: 0; }
.ai-chat-input-area input { flex: 1; background: var(--bg); border: 1px solid var(--border); color: var(--text); padding: 8px 10px; border-radius: 8px; font-size: 0.85em; outline: none; }
.ai-chat-input-area input:focus { border-color: var(--blue); }
.ai-chat-input-area button { background: var(--blue); color: #fff; border: none; padding: 8px 14px; border-radius: 8px; cursor: pointer; font-size: 0.85em; font-weight: 500; }
.ai-chat-input-area button:hover { opacity: 0.9; }
.ai-chat-loading { text-align: center; padding: 8px; color: var(--overlay); font-size: 0.8em; }
.ai-chat-toggle-btn { background: var(--blue); color: #fff; border: none; border-radius: 50%; width: 44px; height: 44px; position: fixed; bottom: 20px; right: 20px; z-index: 299; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,0.3); font-size: 1.4em; display: flex; align-items: center; justify-content: center; transition: transform 0.15s; }
.ai-chat-toggle-btn:hover { transform: scale(1.1); }
.ai-chat-toggle-btn.active { background: var(--red); }

/* MAIN */
.main { max-width: 1200px; margin: 0 auto; padding: 24px 20px; }
.main.designer-open { max-width: 100%; }
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
.btn-red { background: var(--red); color: var(--bg); opacity: 0.9; }
.btn-red:hover { opacity: 1; }
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
.multi-select-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.multi-select-grid .option-btn { font-size: 0.85em; padding: 6px 14px; }
.design-card { background: var(--bg2); border: 2px solid var(--border); border-radius: var(--radius); padding: 14px; cursor: pointer; text-align: center; transition: all 0.15s; }
.design-card:hover { border-color: var(--blue); transform: translateY(-1px); }
.design-card.selected { border-color: var(--blue); background: rgba(137,180,250,0.08); box-shadow: 0 0 0 1px var(--blue); }
.design-card .preview { font-size: 1.8em; margin-bottom: 6px; line-height: 1.3; color: var(--overlay); }
.design-card strong { display: block; font-size: 0.9em; margin-bottom: 2px; }
.design-card span { font-size: 0.8em; color: var(--subtext); }
.step-desc { color: var(--subtext); font-size: 0.9em; margin: 4px 0 10px; }

/* CUSTOM COLOR PICKER */
.custom-colors { display: none; margin-top: 14px; padding: 16px; background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); }
.custom-colors.visible { display: block; }
.custom-colors h4 { margin: 0 0 12px; font-size: 0.95em; color: var(--text); }
.color-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.color-row:last-child { margin-bottom: 0; }
.color-row label { flex: 0 0 120px; font-size: 0.85em; color: var(--subtext); }
.color-row input[type="color"] { width: 40px; height: 32px; padding: 2px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg3); cursor: pointer; }
.color-row input[type="color"]::-webkit-color-swatch-wrapper { padding: 2px; }
.color-row input[type="color"]::-webkit-color-swatch { border: none; border-radius: 4px; }
.color-row .color-hex { font-size: 0.8em; color: var(--overlay); font-family: monospace; min-width: 64px; }
.color-preview-bar { display: flex; height: 32px; border-radius: 6px; overflow: hidden; margin-top: 12px; border: 1px solid var(--border); }
.color-preview-bar div { flex: 1; }

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
.designer-sidebar { border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; }
.designer-sidebar h3 { padding: 12px 16px; font-size: 0.9em; color: var(--blue); border-bottom: 1px solid var(--border); margin: 0; flex-shrink: 0; }
.comp-palette { flex: 1; overflow-y: auto; padding: 8px; min-height: 0; }
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
.coding-main { display: flex; flex-direction: column; min-height: 0; }
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
.layer-list { padding: 4px; overflow-y: auto; flex: 1; min-height: 0; }
.layer-item { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 4px; font-size: 0.8em; cursor: pointer; }
.layer-item:hover { background: var(--bg3); }
.layer-item.selected { background: var(--bg3); color: var(--blue); }
.layer-item .layer-icon { width: 16px; text-align: center; color: var(--overlay); }
.layer-item .layer-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ===== PAGE TREE (Sub-pages) ===== */
.page-tree { padding: 4px 8px; border-bottom: 1px solid var(--border); background: var(--bg3); overflow-x: auto; overflow-y: auto; max-height: 200px; }
.page-tree-item { display: flex; align-items: center; gap: 4px; padding: 4px 6px; border-radius: 4px; cursor: pointer; font-size: 0.8em; color: var(--subtext); white-space: nowrap; }
.page-tree-item:hover { background: var(--bg); color: var(--text); }
.page-tree-item.active { background: var(--bg2); color: var(--blue); font-weight: 600; }
.page-tree-item .tree-indent { display: inline-block; width: 16px; flex-shrink: 0; }
.page-tree-item .tree-toggle { cursor: pointer; width: 14px; text-align: center; font-size: 0.7em; flex-shrink: 0; }
.page-tree-item .tree-name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.page-tree-actions { display: none; gap: 2px; margin-left: auto; flex-shrink: 0; }
.page-tree-item:hover .page-tree-actions { display: flex; }
.page-tree-actions button { background: none; border: none; color: var(--subtext); cursor: pointer; font-size: 0.75em; padding: 2px 4px; border-radius: 3px; }
.page-tree-actions button:hover { background: var(--surface); color: var(--text); }
.page-tree-actions button.danger:hover { color: var(--red); }
.page-tree-add { display: flex; align-items: center; gap: 4px; padding: 4px 6px; cursor: pointer; color: var(--overlay); font-size: 0.8em; }
.page-tree-add:hover { color: var(--blue); }

/* ===== REQUIREMENTS (User Stories) ===== */
.req-list { display: flex; flex-direction: column; gap: 6px; }
.req-item { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; font-size: 0.8em; position: relative; }
.req-item .req-role { font-weight: 600; color: var(--mauve); font-size: 0.85em; margin-bottom: 2px; }
.req-item .req-action { color: var(--text); margin-bottom: 2px; }
.req-item .req-benefit { color: var(--subtext); font-size: 0.9em; }
.req-item .req-remove { position: absolute; top: 4px; right: 6px; background: none; border: none; color: var(--overlay); cursor: pointer; font-size: 0.9em; padding: 2px; }
.req-item .req-remove:hover { color: var(--red); }
.req-add { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
.req-add select, .req-add input { padding: 4px 8px; font-size: 0.8em; margin-top: 0; }

/* ===== CONTEXT MENU ===== */
.ctx-menu { position: fixed; z-index: 300; background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; padding: 4px 0; min-width: 160px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
.ctx-menu-item { padding: 6px 14px; font-size: 0.85em; cursor: pointer; color: var(--text); }
.ctx-menu-item:hover { background: var(--bg3); }
.ctx-menu-item.danger { color: var(--red); }
.ctx-menu-sep { border-top: 1px solid var(--border); margin: 4px 0; }

/* TOAST NOTIFICATIONS */
.coe-notification { position: fixed; bottom: 20px; right: 20px; z-index: 400; background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 14px 40px 14px 18px; max-width: 420px; box-shadow: 0 4px 16px rgba(0,0,0,0.3); animation: slideUp 0.3s; }
.coe-notif-success { border-left: 4px solid var(--green); }
.coe-notif-warning { border-left: 4px solid var(--yellow); }
.coe-notif-error { border-left: 4px solid var(--red); }
.coe-notif-info { border-left: 4px solid var(--blue); }
.notif-content { font-size: 0.9em; margin-bottom: 6px; }
.notif-actions { display: flex; gap: 8px; margin-top: 8px; }
.notif-close { position: absolute; top: 8px; right: 10px; background: none; border: none; color: var(--subtext); cursor: pointer; font-size: 1.2em; padding: 0; line-height: 1; }
@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

/* EMPTY CANVAS GUIDE */
.empty-canvas-guide { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; color: var(--text); padding: 40px; }
.empty-canvas-guide p { color: var(--subtext); max-width: 360px; }

/* COMPONENT LABELS ON CANVAS */
.design-el .comp-label { position: absolute; top: 2px; left: 4px; font-size: 0.7em; font-weight: 600; color: var(--blue); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: calc(100% - 8px); pointer-events: none; z-index: 2; }
.design-el .comp-type-label { position: absolute; top: 14px; left: 4px; font-size: 0.6em; color: var(--overlay); white-space: nowrap; pointer-events: none; z-index: 2; }
.design-el .comp-notes { position: absolute; bottom: 2px; left: 4px; right: 4px; font-size: 0.6em; color: var(--subtext); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; z-index: 2; }

/* PAGE EDGE RESIZE HANDLES */
.canvas-resize-handle { position: absolute; background: var(--blue); opacity: 0; transition: opacity 0.15s; z-index: 10; }
.canvas-resize-handle:hover { opacity: 0.6; cursor: nwse-resize; }
.canvas-resize-right { right: -4px; top: 0; width: 8px; height: 100%; cursor: ew-resize; }
.canvas-resize-bottom { bottom: -4px; left: 0; height: 8px; width: 100%; cursor: ns-resize; }
.canvas-resize-corner { right: -4px; bottom: -4px; width: 12px; height: 12px; cursor: nwse-resize; border-radius: 0 0 4px 0; }
.design-canvas:hover .canvas-resize-handle { opacity: 0.3; }

/* ==================== NOTIFICATION BADGES ==================== */
.tab-badge { position: absolute; top: 2px; right: 2px; min-width: 16px; height: 16px; border-radius: 8px; font-size: 0.65em; font-weight: 700; color: #fff; display: flex; align-items: center; justify-content: center; padding: 0 4px; line-height: 1; }
.tab-badge.red { background: var(--red); }
.tab-badge.orange { background: #f5a623; }
.tab-badge.yellow { background: var(--yellow); color: #1e1e2e; }
.tab-badge.blue { background: var(--blue); }
.tab { position: relative; }
.tab-badge:empty { display: none; }

/* ==================== PROJECT STATUS ==================== */
.status-layout { display: grid; grid-template-columns: 220px 1fr 280px; gap: 12px; min-height: 500px; }
.status-tree { background: var(--surface); border-radius: 8px; padding: 8px; overflow-y: auto; max-height: 600px; }
.status-tree-item { padding: 6px 8px; cursor: pointer; border-radius: 4px; font-size: 0.85em; display: flex; align-items: center; gap: 6px; }
.status-tree-item:hover { background: var(--overlay); }
.status-tree-item.active { background: var(--blue); color: #fff; }
.status-tree-item .status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.status-dot.not_started { background: var(--overlay); }
.status-dot.planned { background: var(--yellow); }
.status-dot.in_progress { background: var(--blue); }
.status-dot.implemented { background: var(--green); }
.status-dot.verified { background: var(--teal, #00b894); }
.status-dot.has_issues { background: var(--red); }
.status-canvas { background: var(--mantle); border-radius: 8px; padding: 12px; overflow: auto; position: relative; }
.status-detail { background: var(--surface); border-radius: 8px; padding: 12px; overflow-y: auto; max-height: 600px; }
.status-detail h3 { margin: 0 0 8px; font-size: 0.95em; }
.status-checklist { list-style: none; padding: 0; margin: 8px 0; }
.status-checklist li { padding: 4px 0; font-size: 0.85em; display: flex; align-items: center; gap: 6px; }
.status-checklist input[type="checkbox"] { margin: 0; }
.readiness-bar { height: 20px; background: var(--surface); border-radius: 10px; overflow: hidden; margin: 8px 0; }
.readiness-fill { height: 100%; border-radius: 10px; transition: width 0.3s; }
.readiness-fill.red { background: var(--red); }
.readiness-fill.yellow { background: var(--yellow); }
.readiness-fill.green { background: var(--green); }
.mode-selector { display: flex; gap: 4px; margin: 8px 0; }
.mode-btn { padding: 4px 10px; border-radius: 4px; border: 1px solid var(--overlay); background: transparent; color: var(--text); cursor: pointer; font-size: 0.8em; }
.mode-btn.active { background: var(--blue); color: #fff; border-color: var(--blue); }

/* ==================== AI PANELS ==================== */
.ai-panels { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
.ai-panel { background: var(--surface); border-radius: 8px; border: 1px solid var(--overlay); }
.ai-panel-header { padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; border-bottom: 1px solid var(--overlay); }
.ai-panel-header h3 { margin: 0; font-size: 0.9em; }
.ai-panel-body { padding: 12px; display: none; }
.ai-panel.open .ai-panel-body { display: block; }
.ai-card { background: var(--mantle); border-radius: 6px; padding: 10px; margin-bottom: 8px; }
.ai-card-title { font-weight: 600; font-size: 0.9em; margin-bottom: 4px; }
.ai-card-desc { font-size: 0.82em; color: var(--subtext); }
.ai-card-actions { display: flex; gap: 6px; margin-top: 8px; }
.readiness-score { font-size: 2em; font-weight: 700; text-align: center; padding: 16px; }
.readiness-score.green { color: var(--green); }
.readiness-score.yellow { color: var(--yellow); }
.readiness-score.red { color: var(--red); }

/* ==================== VERSION CONTROL ==================== */
.version-list { max-height: 300px; overflow-y: auto; }
.version-item { display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px solid var(--overlay); font-size: 0.85em; }
.version-item:last-child { border-bottom: none; }
.version-label { font-weight: 600; }
.version-meta { color: var(--subtext); font-size: 0.8em; }

/* ==================== BRANCH TOGGLE ==================== */
.branch-toggle { display: flex; gap: 2px; background: var(--surface); border-radius: 6px; padding: 2px; margin-right: 12px; }
.branch-toggle button { padding: 4px 12px; border: none; background: transparent; color: var(--text); cursor: pointer; border-radius: 4px; font-size: 0.82em; display: flex; align-items: center; gap: 6px; transition: background 0.15s, color 0.15s; }
.branch-toggle button.active { background: var(--accent); color: #fff; }
.branch-toggle button:hover:not(.active) { background: var(--overlay); }
.branch-indicator { font-size: 0.75em; padding: 1px 5px; border-radius: 3px; font-weight: 600; }
.branch-indicator.live { background: rgba(166,227,161,0.2); color: var(--green); }
.branch-indicator.features { background: rgba(137,180,250,0.2); color: var(--blue); }
.branch-change-count { font-size: 0.7em; padding: 0 4px; border-radius: 8px; background: var(--yellow); color: var(--base); font-weight: 700; margin-left: 2px; }
.threshold-warning { background: rgba(249,226,175,0.15); border: 1px solid var(--yellow); border-radius: 6px; padding: 8px 12px; margin: 8px 0; font-size: 0.85em; display: flex; align-items: center; gap: 8px; }
.threshold-warning .warning-icon { font-size: 1.2em; }
.merge-preview-item { padding: 4px 8px; font-size: 0.85em; border-left: 3px solid var(--overlay); margin: 4px 0; }
.merge-preview-item.added { border-left-color: var(--green); }
.merge-preview-item.modified { border-left-color: var(--yellow); }
.merge-preview-item.deleted { border-left-color: var(--red); }
.merge-modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); z-index: 400; display: flex; align-items: center; justify-content: center; }
.merge-modal { background: var(--surface); border-radius: 8px; padding: 20px; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; border: 1px solid var(--overlay); }
.merge-modal h3 { margin: 0 0 12px 0; }
.merge-modal .diff-summary { margin: 12px 0; }
.merge-modal .merge-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }

/* ==================== ELEMENT CHAT ==================== */
.element-chat { margin-top: 12px; border-top: 1px solid var(--overlay); padding-top: 8px; }
.chat-messages { max-height: 200px; overflow-y: auto; margin-bottom: 8px; }
.chat-msg { padding: 4px 8px; margin: 4px 0; border-radius: 4px; font-size: 0.82em; }
.chat-msg.user { background: var(--blue); color: #fff; margin-left: 20%; text-align: right; }
.chat-msg.ai { background: var(--surface); margin-right: 20%; }
.chat-input-row { display: flex; gap: 4px; }
.chat-input-row input { flex: 1; font-size: 0.85em; }

/* ==================== DATA MODEL DESIGNER ==================== */
.data-model-panel { background: var(--surface); border-radius: 8px; padding: 12px; }
.data-model-item { padding: 8px; border-bottom: 1px solid var(--overlay); cursor: pointer; position: relative; }
.data-model-item:hover { background: var(--overlay); }
.data-model-item[draggable="true"] { cursor: grab; }
.data-model-item.dragging { opacity: 0.5; }
.data-model-field { font-size: 0.8em; color: var(--subtext); padding: 2px 0 2px 12px; }
.data-model-field .required { color: var(--yellow); }
.data-model-bound-badge { position: absolute; top: 4px; right: 4px; font-size: 0.65em; background: var(--blue); color: var(--bg); padding: 1px 6px; border-radius: 8px; }

/* Data Model Editor Modal */
.dm-field-row { display: flex; gap: 6px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border); }
.dm-field-row input, .dm-field-row select { margin-top: 0; font-size: 0.85em; }
.dm-field-name { flex: 2; min-width: 0; }
.dm-field-type { flex: 2; min-width: 0; }
.dm-field-checks { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
.dm-field-checks label { margin: 0; font-size: 0.8em; display: flex; align-items: center; gap: 3px; }
.dm-field-checks input[type="checkbox"] { width: auto; margin: 0; }
.dm-field-remove { background: var(--red); color: #fff; border: none; padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8em; flex-shrink: 0; }
.dm-fields-list { max-height: 300px; overflow-y: auto; margin: 8px 0; }

/* Canvas component data binding indicator */
.comp-data-badge { position: absolute; top: -8px; right: -8px; background: var(--teal); color: var(--bg); font-size: 0.6em; padding: 1px 5px; border-radius: 6px; z-index: 5; pointer-events: none; }
.design-el.data-drop-target { outline: 2px dashed var(--teal); outline-offset: 2px; }

/* Wizard guided-tour color classes */
.status-done { border-left: 3px solid var(--green); }
.status-question { border-left: 3px solid var(--red); }
.status-working { border-left: 3px solid var(--peach); }
.status-pending { border-left: 3px solid var(--overlay); }

/* Guided highlight animation */
.guided-highlight { outline: 2px solid var(--highlight-color, var(--blue)); outline-offset: 4px; animation: pulse-outline 1.5s ease-in-out 2; }
@keyframes pulse-outline { 0%, 100% { outline-offset: 4px; opacity: 1; } 50% { outline-offset: 8px; opacity: 0.7; } }
@keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
@keyframes pulse-red { 0%, 100% { background: var(--red); } 50% { background: #991b1b; } }
.processing-banner { border-left: 3px solid var(--blue); padding: 8px 12px; margin: 8px 0; display: flex; align-items: center; gap: 8px; background: var(--bg); border-radius: 4px; }

/* Wizard dot clickable */
.wizard-dot { cursor: pointer; }
.wizard-dot:hover { transform: scale(1.3); }

/* Preview card clickable */
.preview-card.clickable { cursor: pointer; transition: border-color 0.2s; }
.preview-card.clickable:hover { border-color: var(--blue); background: rgba(137,180,250,0.08); }

/* Wizard help text */
.wizard-help { font-size: 0.82em; color: var(--subtext); margin: 8px 0 12px; line-height: 1.5; padding: 8px 12px; background: var(--bg3); border-radius: 6px; border-left: 3px solid var(--blue); }
.wizard-option-detail { font-size: 0.75em; color: var(--overlay); margin-top: 2px; }

/* Ticket hierarchy */
.ticket-children { margin-left: 24px; border-left: 2px solid var(--bg3); padding-left: 8px; }
.ticket-expand-btn { background: none; border: none; color: var(--subtext); cursor: pointer; font-size: 0.9em; padding: 0 4px; }
.ticket-child-badge { font-size: 0.7em; background: var(--bg3); color: var(--subtext); padding: 1px 6px; border-radius: 8px; margin-left: 4px; }

@media (max-width: 1024px) {
    .designer-layout { grid-template-columns: 1fr; }
    .designer-sidebar, .designer-props { display: none; }
    .coding-layout { grid-template-columns: 1fr; }
    .coding-sidebar { display: none; }
    .settings-grid { grid-template-columns: 1fr; }
    .settings-nav { display: none; }
    .status-layout { grid-template-columns: 1fr; }
    .status-tree, .status-detail { display: none; }
}

/* ==================== DESIGN QA PANEL ==================== */
.qa-panel { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; margin-top: 16px; }
.qa-panel h3 { font-size: 1em; color: var(--blue); margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
.qa-score { font-size: 2em; font-weight: 700; text-align: center; padding: 8px 0; }
.qa-score.green { color: var(--green); }
.qa-score.yellow { color: var(--yellow); }
.qa-score.red { color: var(--red); }
.qa-gaps { display: flex; gap: 12px; margin: 12px 0; flex-wrap: wrap; }
.qa-gap-item { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 8px 14px; font-size: 0.85em; display: flex; align-items: center; gap: 6px; }
.qa-gap-item .gap-count { font-weight: 700; font-size: 1.1em; }
.qa-phases { display: flex; gap: 8px; margin: 12px 0; }
.qa-phase { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; font-size: 0.8em; display: flex; align-items: center; gap: 6px; }
.qa-phase .phase-dot { width: 8px; height: 8px; border-radius: 50%; }
.qa-phase .phase-dot.done { background: var(--green); }
.qa-phase .phase-dot.running { background: var(--blue); animation: pulse-dot 1.5s infinite; }
.qa-phase .phase-dot.pending { background: var(--overlay); }
.qa-drafts { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px 14px; margin-top: 10px; display: flex; justify-content: space-between; align-items: center; }
.qa-drafts .draft-count { font-weight: 600; font-size: 0.9em; }
.qa-drafts .draft-actions { display: flex; gap: 6px; }

/* ==================== QUESTION POPUP ==================== */
.question-popup-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 350; display: flex; align-items: center; justify-content: center; }
.question-popup { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; padding: 24px; width: 90%; max-width: 560px; max-height: 80vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
.question-popup h2 { margin-bottom: 6px; font-size: 1.1em; }
.question-popup .q-position { font-size: 0.8em; color: var(--overlay); margin-bottom: 16px; }
.question-popup .q-source-badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 0.75em; font-weight: 600; margin-bottom: 12px; }
.question-popup .q-source-badge.planning { background: rgba(137,180,250,0.15); color: var(--blue); }
.question-popup .q-source-badge.design { background: rgba(203,166,247,0.15); color: var(--mauve); }
.question-popup .q-source-badge.coding { background: rgba(166,227,161,0.15); color: var(--green); }
.question-popup .q-source-badge.verification { background: rgba(249,226,175,0.15); color: var(--yellow); }
.question-popup .q-source-badge.boss { background: rgba(243,139,168,0.15); color: var(--red); }
.question-popup .q-source-badge.clarity { background: rgba(148,226,213,0.15); color: var(--teal); }
.question-popup .q-text { font-size: 1em; line-height: 1.5; margin-bottom: 16px; padding: 12px; background: var(--bg); border-radius: 6px; border-left: 3px solid var(--blue); }
.question-popup .q-suggested { background: var(--bg3); border-radius: 6px; padding: 10px; margin-bottom: 14px; font-size: 0.9em; }
.question-popup .q-suggested strong { color: var(--teal); display: block; margin-bottom: 4px; font-size: 0.85em; }
.question-popup .q-options { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.question-popup .q-option { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; font-size: 0.9em; transition: all 0.15s; }
.question-popup .q-option:hover { border-color: var(--blue); }
.question-popup .q-option.selected { border-color: var(--blue); background: rgba(137,180,250,0.08); }
.question-popup .q-option input[type="radio"] { margin: 0; }
.question-popup .q-yesno { display: flex; gap: 8px; margin-bottom: 14px; }
.question-popup .q-yesno button { flex: 1; padding: 10px; border-radius: 6px; font-weight: 600; font-size: 0.95em; }
.question-popup .q-nav-btn { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; background: var(--bg3); border: 1px solid var(--border); border-radius: 4px; color: var(--subtext); font-size: 0.8em; cursor: pointer; margin-top: 8px; }
.question-popup .q-nav-btn:hover { border-color: var(--blue); color: var(--blue); }
.question-popup .q-actions { display: flex; gap: 8px; margin-top: 16px; justify-content: space-between; }
.question-badge-pulse { animation: pulse-red 1.5s infinite; }

/* ==================== PHASE PROGRESS INDICATOR ==================== */
.phase-indicator { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 20px; margin-bottom: 20px; }
.phase-indicator .phase-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.phase-indicator .phase-version { font-size: 0.8em; color: var(--overlay); }
.phase-indicator .phase-time { font-size: 0.8em; color: var(--subtext); }
.phase-stages { display: flex; align-items: center; gap: 0; width: 100%; }
.phase-stage { flex: 1; position: relative; }
.phase-stage-label { font-size: 0.75em; color: var(--subtext); text-align: center; margin-bottom: 8px; font-weight: 600; }
.phase-stage-label.active { color: var(--blue); }
.phase-stage-label.done { color: var(--green); }
.phase-dots { display: flex; align-items: center; justify-content: center; gap: 4px; }
.phase-dot { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--overlay); background: transparent; transition: all 0.2s; }
.phase-dot.filled { background: var(--green); border-color: var(--green); }
.phase-dot.current { background: var(--blue); border-color: var(--blue); box-shadow: 0 0 6px rgba(137,180,250,0.5); animation: pulse-dot 1.5s infinite; }
.phase-dot.empty { background: transparent; border-color: var(--overlay); }
.phase-connector { flex: 1; height: 2px; background: var(--overlay); margin: 0 2px; }
.phase-connector.done { background: var(--green); }
.phase-approve-bar { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border); }

/* ==================== GUIDED TOUR ==================== */
.guided-tour { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 40px; text-align: center; }
.guided-tour h2 { font-size: 1.4em; margin-bottom: 8px; color: var(--text); }
.guided-tour .tour-subtitle { color: var(--subtext); font-size: 1em; margin-bottom: 32px; }
.guided-tour .tour-stages { display: flex; gap: 24px; justify-content: center; margin-bottom: 32px; flex-wrap: wrap; }
.guided-tour .tour-stage { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 20px; width: 220px; text-align: center; }
.guided-tour .tour-stage-num { font-size: 1.6em; font-weight: 700; color: var(--blue); margin-bottom: 8px; }
.guided-tour .tour-stage-title { font-weight: 600; margin-bottom: 4px; }
.guided-tour .tour-stage-desc { font-size: 0.85em; color: var(--subtext); line-height: 1.4; }

/* ==================== DRAFT COMPONENT STYLES ==================== */
.design-el.draft-component { border: 2px dashed var(--yellow) !important; opacity: 0.7; }
.design-el.draft-component .draft-badge { position: absolute; top: -10px; right: -10px; background: var(--yellow); color: var(--bg); font-size: 0.6em; font-weight: 700; padding: 2px 6px; border-radius: 4px; z-index: 5; pointer-events: none; text-transform: uppercase; }
.design-el.draft-component .draft-actions { display: none; position: absolute; bottom: -28px; left: 50%; transform: translateX(-50%); gap: 4px; z-index: 10; }
.design-el.draft-component:hover .draft-actions { display: flex; }
.design-el.draft-component:hover { opacity: 1; }
.draft-actions .btn { padding: 2px 8px; font-size: 0.7em; }
</style>
</head>
<body>

<!-- TOP NAV -->
<div class="topnav">
    <span class="logo">COE</span>
    <div class="tabs">
        <button class="tab active" data-page="dashboard">Dashboard<span class="tab-badge" id="badge-dashboard"></span></button>
        <button class="tab" data-page="tasks">Tasks<span class="tab-badge" id="badge-tasks"></span></button>
        <button class="tab" data-page="tickets">Tickets<span class="tab-badge red" id="badge-tickets"></span></button>
        <button class="tab" data-page="planning">Planning & Design<span class="tab-badge" id="badge-planning"></span></button>
        <button class="tab" data-page="agents">Agents<span class="tab-badge" id="badge-agents"></span></button>
        <button class="tab" data-page="coding">Coding<span class="tab-badge" id="badge-coding"></span></button>
        <button class="tab" data-page="github">GitHub<span class="tab-badge" id="badge-github"></span></button>
        <button class="tab" data-page="settings">Settings<span class="tab-badge" id="badge-settings"></span></button>
        <button class="tab" data-page="system">System<span class="tab-badge" id="badge-system"></span></button>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-left:8px">
        <button class="btn btn-sm btn-secondary" onclick="renderQuestionPopup()" style="position:relative;padding:4px 10px;font-size:0.85em">
            Questions <span class="tab-badge red" id="badge-questions-nav" style="position:absolute;top:-4px;right:-4px"></span>
        </button>
    </div>
    <div class="status">
        <span class="ai-level-label">AI:</span>
        <div class="ai-level-toggle" id="aiLevelToggle">
            <button data-ai="manual" onclick="setGlobalAiLevel('manual')" title="Full human control">Manual</button>
            <button data-ai="suggestions" onclick="setGlobalAiLevel('suggestions')" class="active" title="AI recommends, you decide">Suggest</button>
            <button data-ai="smart" onclick="setGlobalAiLevel('smart')" title="AI fills, you review">Smart</button>
            <button data-ai="hybrid" onclick="setGlobalAiLevel('hybrid')" title="AI auto-handles routine">Hybrid</button>
        </div>
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
    <div style="margin-bottom:12px;display:flex;gap:12px;align-items:center">
        <label style="font-size:0.85em;color:var(--subtext)">Type:
            <select id="ticketOperationFilter" onchange="loadTickets()" style="background:var(--bg);color:var(--text);border:1px solid var(--border);padding:4px 8px;border-radius:4px;font-size:0.9em">
                <option value="">All</option>
                <option value="user_created">User Created</option>
                <option value="plan_generation">Plan Generation</option>
                <option value="design_change">Design Changes</option>
                <option value="coding_session">Coding Sessions</option>
                <option value="verification">Verification</option>
                <option value="ai_question">AI Questions</option>
                <option value="suggestion">Suggestions</option>
            </select>
        </label>
    </div>
    <table>
        <thead><tr><th>#</th><th>Title</th><th>Status</th><th>Priority</th><th>Type</th><th>Actions</th></tr></thead>
        <tbody id="ticketTableBody"></tbody>
    </table>
    <div id="ticketDetail"></div>
</div>

<!-- ==================== PLANNING ==================== -->
<div class="page" id="page-planning">
    <h1>Planning</h1>
    <p class="subtitle">Create and manage development plans</p>

    <!-- ===== PHASE PROGRESS INDICATOR ===== -->
    <div id="phaseIndicatorContainer" style="display:none"></div>

    <!-- ===== GUIDED TOUR (shown when no plans) ===== -->
    <div id="guidedTourContainer" style="display:none"></div>

    <!-- ===== WIZARD SECTION ===== -->
    <div class="section" id="wizardSection">
        <h2 id="wizardHeader">Create New Plan</h2>
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
                        <div class="design-card" data-val="custom"><div class="preview" id="customThemePreview" style="display:flex;gap:2px;justify-content:center"><span style="width:12px;height:12px;border-radius:50%;background:#1a1b2e;display:inline-block"></span><span style="width:12px;height:12px;border-radius:50%;background:#2d2e4a;display:inline-block"></span><span style="width:12px;height:12px;border-radius:50%;background:#e0e0f0;display:inline-block"></span><span style="width:12px;height:12px;border-radius:50%;background:#7c8af4;display:inline-block"></span><span style="width:12px;height:12px;border-radius:50%;background:#6ecf8a;display:inline-block"></span></div><strong>Custom</strong><span>Pick your colors</span></div>
                    </div>
                    <div class="custom-colors" id="customColorPicker">
                        <h4>Custom Color Palette</h4>
                        <div class="color-row">
                            <label>Background</label>
                            <input type="color" id="ccBg" value="#1a1b2e" onchange="updateCustomColors()">
                            <span class="color-hex" id="ccBgHex">#1a1b2e</span>
                        </div>
                        <div class="color-row">
                            <label>Surface</label>
                            <input type="color" id="ccSurface" value="#2d2e4a" onchange="updateCustomColors()">
                            <span class="color-hex" id="ccSurfaceHex">#2d2e4a</span>
                        </div>
                        <div class="color-row">
                            <label>Text</label>
                            <input type="color" id="ccText" value="#e0e0f0" onchange="updateCustomColors()">
                            <span class="color-hex" id="ccTextHex">#e0e0f0</span>
                        </div>
                        <div class="color-row">
                            <label>Primary Accent</label>
                            <input type="color" id="ccAccent" value="#7c8af4" onchange="updateCustomColors()">
                            <span class="color-hex" id="ccAccentHex">#7c8af4</span>
                        </div>
                        <div class="color-row">
                            <label>Secondary Accent</label>
                            <input type="color" id="ccSecondary" value="#6ecf8a" onchange="updateCustomColors()">
                            <span class="color-hex" id="ccSecondaryHex">#6ecf8a</span>
                        </div>
                        <div class="color-preview-bar" id="colorPreviewBar">
                            <div style="background:#1a1b2e"></div>
                            <div style="background:#2d2e4a"></div>
                            <div style="background:#e0e0f0"></div>
                            <div style="background:#7c8af4"></div>
                            <div style="background:#6ecf8a"></div>
                        </div>
                    </div>
                    <div class="btn-row"><button class="btn btn-secondary" onclick="wizPrev()">Back</button><button class="btn btn-primary" onclick="wizNext()">Next</button></div>
                </div>
                <!-- Step 6: Key Pages / Screens -->
                <div class="wizard-step" id="wstep6">
                    <label>Key Pages / Screens</label>
                    <p class="step-desc">Select the pages your app needs (click to toggle, add custom below)</p>
                    <div class="multi-select-grid" id="pagesOptions">
                        <button class="option-btn selected" data-val="Dashboard">Dashboard</button>
                        <button class="option-btn" data-val="Login / Signup">Login / Signup</button>
                        <button class="option-btn" data-val="User Profile">User Profile</button>
                        <button class="option-btn" data-val="Settings">Settings</button>
                        <button class="option-btn" data-val="Admin Panel">Admin Panel</button>
                        <button class="option-btn" data-val="Landing Page">Landing Page</button>
                        <button class="option-btn" data-val="Search / Browse">Search / Browse</button>
                        <button class="option-btn" data-val="Detail View">Detail View</button>
                        <button class="option-btn" data-val="Checkout / Cart">Checkout / Cart</button>
                        <button class="option-btn" data-val="Notifications">Notifications</button>
                    </div>
                    <div class="form-group" style="margin-top:8px">
                        <input type="text" id="wizCustomPage" placeholder="Add your own page..." style="width:calc(100% - 80px);display:inline-block" onkeydown="if(event.key==='Enter'){addCustomPage();event.preventDefault()}">
                        <button class="btn btn-secondary btn-sm" onclick="addCustomPage()" style="vertical-align:top;margin-left:4px">Add</button>
                    </div>
                    <div class="btn-row"><button class="btn btn-secondary" onclick="wizPrev()">Back</button><button class="btn btn-primary" onclick="wizNext()">Next</button></div>
                </div>
                <!-- Step 7: User Types / Roles -->
                <div class="wizard-step" id="wstep7">
                    <label>User Types / Roles</label>
                    <p class="step-desc">Who will use this app? (select all that apply)</p>
                    <div class="multi-select-grid" id="rolesOptions">
                        <button class="option-btn selected" data-val="Regular User">Regular User</button>
                        <button class="option-btn" data-val="Admin">Admin</button>
                        <button class="option-btn" data-val="Guest / Visitor">Guest / Visitor</button>
                        <button class="option-btn" data-val="Moderator">Moderator</button>
                        <button class="option-btn" data-val="API Consumer">API Consumer</button>
                    </div>
                    <div class="btn-row"><button class="btn btn-secondary" onclick="wizPrev()">Back</button><button class="btn btn-primary" onclick="wizNext()">Next</button></div>
                </div>
                <!-- Step 8: Core Features -->
                <div class="wizard-step" id="wstep8">
                    <label>Core Features</label>
                    <p class="step-desc">What features does your app need? (select all that apply)</p>
                    <div class="multi-select-grid" id="featuresOptions">
                        <button class="option-btn selected" data-val="CRUD Operations">CRUD Operations</button>
                        <button class="option-btn" data-val="User Authentication">User Authentication</button>
                        <button class="option-btn" data-val="Search & Filtering">Search & Filtering</button>
                        <button class="option-btn" data-val="File Upload">File Upload</button>
                        <button class="option-btn" data-val="Notifications / Alerts">Notifications / Alerts</button>
                        <button class="option-btn" data-val="Real-time Updates">Real-time Updates</button>
                        <button class="option-btn" data-val="Data Export">Data Export</button>
                        <button class="option-btn" data-val="Charts / Analytics">Charts / Analytics</button>
                        <button class="option-btn" data-val="Chat / Messaging">Chat / Messaging</button>
                        <button class="option-btn" data-val="Payment Integration">Payment Integration</button>
                    </div>
                    <div class="btn-row"><button class="btn btn-secondary" onclick="wizPrev()">Back</button><button class="btn btn-primary" onclick="wizNext()">Next</button></div>
                </div>
                <!-- Step 9: Tech Stack -->
                <div class="wizard-step" id="wstep9">
                    <label>Tech Stack</label>
                    <p class="step-desc">What technology stack will this app use?</p>
                    <div class="design-grid" data-field="techStack">
                        <div class="design-card selected" data-val="React + Node"><div class="preview">R+N</div><strong>React + Node</strong><span>Full-stack JavaScript</span></div>
                        <div class="design-card" data-val="Vue + Express"><div class="preview">V+E</div><strong>Vue + Express</strong><span>Progressive framework</span></div>
                        <div class="design-card" data-val="HTML/CSS/JS"><div class="preview">HTM</div><strong>HTML/CSS/JS</strong><span>Vanilla web stack</span></div>
                        <div class="design-card" data-val="Custom"><div class="preview">?</div><strong>Custom</strong><span>Specify your own</span></div>
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
                    <div class="impact-metric"><span class="imp-label">Pages</span><span class="imp-value" id="impPages">--</span></div>
                    <div class="impact-metric"><span class="imp-label">Complexity</span><span class="imp-value" id="impComplexity">--</span></div>
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
            <div class="preview-grid" id="previewGrid">
                <div class="preview-card clickable" data-pv-step="4" onclick="editWizardStage(4)" title="Click to edit layout"><strong>Layout</strong><span id="pvLayout">--</span></div>
                <div class="preview-card clickable" data-pv-step="5" onclick="editWizardStage(5)" title="Click to edit theme"><strong>Theme</strong><span id="pvTheme">--</span></div>
                <div class="preview-card clickable" data-pv-step="6" onclick="editWizardStage(6)" title="Click to edit pages"><strong>Pages</strong><span id="pvPages">--</span></div>
                <div class="preview-card clickable" data-pv-step="9" onclick="editWizardStage(9)" title="Click to edit tech stack"><strong>Tech Stack</strong><span id="pvTechStack">--</span></div>
                <div class="preview-card clickable" data-pv-step="10" onclick="editWizardStage(10)" title="Click to edit AI level"><strong>AI Level</strong><span id="pvAI">--</span></div>
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

    <!-- Data Model Editor Modal -->
    <div class="modal-overlay" id="dmEditorModal">
        <div class="modal" style="max-width:700px">
            <button class="modal-close" onclick="closeModal('dmEditorModal')">&times;</button>
            <h2 id="dmEditorTitle">New Data Model</h2>
            <input type="hidden" id="dmEditId" value="">
            <div class="form-group"><label for="dmEditName">Model Name</label><input type="text" id="dmEditName" placeholder="e.g. Products, Users, Orders"></div>
            <div class="form-group"><label for="dmEditDesc">Description</label><textarea id="dmEditDesc" style="min-height:50px" placeholder="What does this data model represent?"></textarea></div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
                <h3 style="margin:0">Fields</h3>
                <button class="btn btn-sm btn-secondary" onclick="dmAddField()">+ Add Field</button>
            </div>
            <div class="dm-fields-list" id="dmFieldsList"></div>
            <div class="btn-row" style="margin-top:16px">
                <button class="btn btn-primary" onclick="dmSaveModel()">Save Model</button>
                <button class="btn btn-danger" id="dmDeleteBtn" style="display:none" onclick="dmDeleteModel()">Delete Model</button>
            </div>
        </div>
    </div>

    <div class="section" id="activePlanSection">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <h2>Active Plan</h2>
            <div style="display:flex;gap:6px">
                <button class="btn btn-sm btn-secondary" onclick="showAllPlans()" id="showAllPlansBtn" style="display:none">Show All Plans</button>
                <button class="btn btn-sm btn-secondary" onclick="showCreatePlanWizard()">+ New Plan</button>
            </div>
        </div>
        <div id="activePlanDisplay"></div>
        <div id="plansList" style="display:none"></div>
    </div>

    <!-- ==================== VISUAL DESIGNER (integrated) ==================== -->
    <div class="section" id="designerSection" style="display:none">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <h2 id="designerTitle">Visual Designer</h2>
            <div style="display:flex;align-items:center;gap:8px">
                <div class="branch-toggle" id="branchToggle">
                    <button class="active" data-branch="live" onclick="switchBranch('live')">Live Version <span class="branch-indicator live" id="liveVersionLabel">v1.0</span><span class="branch-change-count" id="liveChangeCount" style="display:none">0</span></button>
                    <button data-branch="features" onclick="switchBranch('features')">Features Design <span class="branch-indicator features" id="featuresVersionLabel">draft</span><span class="branch-change-count" id="featuresChangeCount" style="display:none">0</span></button>
                </div>
                <button class="btn btn-sm btn-secondary" onclick="openStatusView(currentDesignerPlanId)">Status</button>
                <button class="btn btn-sm btn-secondary" onclick="openVersionPanel(currentDesignerPlanId)">Versions</button>
                <button class="btn btn-sm btn-secondary" onclick="runAiBugCheck()">Bug Check</button>
                <button class="btn btn-sm btn-secondary" id="startCodingBtn" onclick="sendToCodeFromDesign()">Send to Coding</button>
                <button class="btn btn-sm btn-secondary" id="mergeToLiveBtn" style="display:none" onclick="showMergePreview()">Merge to Live</button>
                <button class="btn btn-primary btn-sm" onclick="exportDesignSpec()">Export Spec</button>
                <button class="btn btn-secondary btn-sm" onclick="closeDesigner()">Close Designer</button>
            </div>
        </div>
        <div id="branchThresholdWarning" style="display:none"></div>
        <div class="responsive-bar" id="designerBar">
            <button class="responsive-btn active" data-bp="desktop" onclick="setBreakpoint('desktop')">Desktop (1440)</button>
            <button class="responsive-btn" data-bp="tablet" onclick="setBreakpoint('tablet')">Tablet (768)</button>
            <button class="responsive-btn" data-bp="mobile" onclick="setBreakpoint('mobile')">Mobile (375)</button>
            <div class="zoom-control"><label for="canvasZoom">Zoom:</label><input type="range" id="canvasZoom" min="25" max="200" value="100" oninput="setCanvasZoom(this.value)"><span id="zoomLabel">100%</span></div>
        </div>
        <div id="designerContainer">
            <div class="page-tree" id="pageTree"></div>
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
                        <div class="comp-palette-item" draggable="true" data-comp="chart_bar"><div class="comp-icon">||</div><span>Bar Chart</span></div>
                        <div class="comp-palette-item" draggable="true" data-comp="chart_line"><div class="comp-icon">/\\</div><span>Line Chart</span></div>
                        <div class="comp-palette-item" draggable="true" data-comp="chart_pie"><div class="comp-icon">O</div><span>Pie Chart</span></div>
                        <div class="comp-palette-item" draggable="true" data-comp="metric_card"><div class="comp-icon">#</div><span>Metric Card</span></div>
                        <div class="comp-palette-item" draggable="true" data-comp="data_table"><div class="comp-icon">T</div><span>Data Table</span></div>
                        <div class="comp-palette-item" draggable="true" data-comp="data_list"><div class="comp-icon">L</div><span>Data List</span></div>
                        <div class="comp-palette-item" draggable="true" data-comp="kanban_board"><div class="comp-icon">KB</div><span>Kanban</span></div>
                        <div class="comp-palette-item" draggable="true" data-comp="progress_bar"><div class="comp-icon">==</div><span>Progress</span></div>
                        <div class="comp-palette-item" draggable="true" data-comp="status_badge"><div class="comp-icon">.</div><span>Status Badge</span></div>
                        <div class="comp-palette-item" draggable="true" data-comp="avatar"><div class="comp-icon">@</div><span>Avatar</span></div>
                        <div class="comp-palette-item" draggable="true" data-comp="search_box"><div class="comp-icon">?</div><span>Search Box</span></div>
                        <div class="comp-palette-item" draggable="true" data-comp="filter_bar"><div class="comp-icon">Y</div><span>Filter Bar</span></div>
                        <div class="comp-palette-item" draggable="true" data-comp="timeline_view"><div class="comp-icon">|.</div><span>Timeline</span></div>
                        <div class="comp-palette-item" draggable="true" data-comp="calendar_view"><div class="comp-icon">31</div><span>Calendar</span></div>
                        <div class="comp-palette-item" draggable="true" data-comp="map_view"><div class="comp-icon">M</div><span>Map</span></div>
                    </div>
                    <h3>Layers</h3>
                    <div class="layer-list" id="layerList"></div>
                    <h3>Data Models</h3>
                    <div class="data-model-panel" id="dataModelPanel">
                        <button class="btn btn-sm btn-secondary" onclick="openDataModelEditor()" style="width:100%;margin-bottom:8px">+ New Model</button>
                        <div id="dataModelList"></div>
                    </div>
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
    </div>

    <!-- ==================== DESIGN QA PANEL ==================== -->
    <div class="section" id="qaSection" style="display:none">
        <div class="qa-panel" id="qaPanelContent">
            <h3>Design QA <span class="badge badge-gray" id="qaScoreBadge">--</span></h3>
            <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
                <div style="text-align:center;min-width:80px">
                    <div class="qa-score" id="qaScoreValue">--</div>
                    <div style="font-size:0.8em;color:var(--subtext)">QA Score</div>
                </div>
                <div style="flex:1;min-width:200px">
                    <div class="qa-gaps" id="qaGaps">
                        <div class="qa-gap-item"><span class="gap-count" style="color:var(--red)">--</span> Critical</div>
                        <div class="qa-gap-item"><span class="gap-count" style="color:var(--yellow)">--</span> Warning</div>
                        <div class="qa-gap-item"><span class="gap-count" style="color:var(--overlay)">--</span> Info</div>
                    </div>
                    <div class="qa-phases" id="qaPhases">
                        <div class="qa-phase"><span class="phase-dot pending"></span> Architect Review</div>
                        <div class="qa-phase"><span class="phase-dot pending"></span> Gap Analysis</div>
                        <div class="qa-phase"><span class="phase-dot pending"></span> Hardening</div>
                    </div>
                </div>
                <div>
                    <button class="btn btn-primary btn-sm" id="qaRunBtn" onclick="runDesignQA()">Run QA</button>
                </div>
            </div>
            <div class="qa-drafts" id="qaDrafts" style="display:none">
                <div class="draft-count" id="qaDraftCount">0 pending drafts</div>
                <div class="draft-actions">
                    <button class="btn btn-sm btn-success" onclick="qaBulkDraftAction('approve')">Approve All</button>
                    <button class="btn btn-sm btn-danger" onclick="qaBulkDraftAction('reject')">Reject All</button>
                </div>
            </div>
        </div>
    </div>

    <!-- ==================== PROJECT STATUS (integrated) ==================== -->
    <div class="section" id="statusSection" style="display:none">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <h2 id="statusTitle">Project Status</h2>
            <div style="display:flex;gap:8px;align-items:center">
                <div class="mode-selector">
                    <button class="mode-btn active" onclick="setStatusMode('fullstack')">Full Stack</button>
                    <button class="mode-btn" onclick="setStatusMode('frontend')">Frontend</button>
                    <button class="mode-btn" onclick="setStatusMode('backend')">Backend</button>
                </div>
                <button class="btn btn-sm btn-primary" onclick="statusAutofill()">Autofill</button>
                <button class="btn btn-sm btn-secondary" onclick="reviewPlanForCode()">Review Plan</button>
                <button class="btn btn-sm btn-secondary" onclick="closeStatusView()">Close</button>
            </div>
        </div>
        <div style="margin-bottom:10px">
            <span style="font-size:0.85em;color:var(--subtext)" id="statusReadinessLabel">Readiness: 0%</span>
            <div class="readiness-bar"><div class="readiness-fill red" id="readinessFill" style="width:0%"></div></div>
        </div>
        <div class="status-layout">
            <div class="status-tree" id="statusTree"></div>
            <div class="status-canvas" id="statusCanvas"><div class="empty">Select a plan to view project status</div></div>
            <div class="status-detail" id="statusDetail">
                <h3>Element Detail</h3>
                <p style="color:var(--subtext);font-size:0.85em">Select an element from the tree to see details</p>
                <div id="statusDetailContent"></div>
                <div class="element-chat" id="elementChatSection" style="display:none">
                    <h3>Element Chat</h3>
                    <div class="chat-messages" id="elementChatMessages"></div>
                    <div class="chat-input-row">
                        <input type="text" id="elementChatInput" placeholder="Ask about this element..." onkeydown="if(event.key==='Enter'){sendElementChatMessage()}">
                        <button class="btn btn-sm btn-primary" onclick="sendElementChatMessage()">Send</button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- ==================== AI PANELS ==================== -->
    <div class="ai-panels" id="aiPanelsSection" style="display:none">
        <div class="ai-panel open" id="aiSuggestionsPanel">
            <div class="ai-panel-header" onclick="toggleAiPanel('aiSuggestionsPanel')">
                <h3>AI Suggestions <span class="badge badge-blue" id="aiSuggestionsCount">0</span></h3>
                <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();refreshAiSuggestions()">Refresh</button>
            </div>
            <div class="ai-panel-body" id="aiSuggestionsBody"><div class="empty">No suggestions yet. Click Refresh to generate.</div></div>
        </div>
        <div class="ai-panel" id="aiReadinessPanel">
            <div class="ai-panel-header" onclick="toggleAiPanel('aiReadinessPanel')">
                <h3>Code Readiness Review</h3>
                <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();reviewPlanForCode()">Review Plan</button>
            </div>
            <div class="ai-panel-body" id="aiReadinessBody"><div class="empty">Click "Review Plan" to check code readiness.</div></div>
        </div>
        <div class="ai-panel" id="aiQuestionsPanel">
            <div class="ai-panel-header" onclick="toggleAiPanel('aiQuestionsPanel')">
                <h3>AI Questions <span class="badge badge-yellow" id="aiQuestionsCount">0</span></h3>
                <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();autofillAiQuestions()">Autofill All</button>
            </div>
            <div class="ai-panel-body" id="aiQuestionsBody"><div class="empty">No questions yet.</div></div>
        </div>
    </div>

    <!-- ==================== VERSION HISTORY ==================== -->
    <div class="section" id="versionSection" style="display:none">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <h3>Version History</h3>
            <div style="display:flex;gap:8px">
                <select id="versionBranchFilter" onchange="loadVersions(currentDesignerPlanId || statusPlanId)" style="padding:2px 6px;border-radius:4px;background:var(--surface);color:var(--text);border:1px solid var(--overlay);font-size:0.85em">
                    <option value="all">All Branches</option>
                    <option value="live">Live</option>
                    <option value="features">Features</option>
                </select>
                <button class="btn btn-sm btn-primary" onclick="saveVersion()">Save Version</button>
                <button class="btn btn-sm btn-secondary" onclick="closeVersionPanel()">Close</button>
            </div>
        </div>
        <div class="version-list" id="versionList"><div class="empty">No versions saved yet.</div></div>
    </div>
</div>

<!-- ==================== MERGE MODAL ==================== -->
<div id="mergeModalOverlay" class="merge-modal-overlay" style="display:none">
    <div class="merge-modal">
        <h3>Merge Features Design to Live</h3>
        <p style="color:var(--subtext);font-size:0.9em">Features Design changes will overwrite Live Version. A backup of the current Live state will be saved automatically.</p>
        <div class="diff-summary" id="mergeDiffSummary"><div class="empty">Loading diff...</div></div>
        <div class="merge-actions">
            <button class="btn btn-secondary" onclick="closeMergeModal()">Cancel</button>
            <button class="btn btn-primary" id="confirmMergeBtn" onclick="executeMerge()">Merge to Live</button>
        </div>
    </div>
</div>

<!-- ==================== AGENTS ==================== -->
<div class="page" id="page-agents">
    <h1>Agents</h1>
    <p class="subtitle">AI agents registered in the orchestration system</p>
    <div class="card-grid" id="agentCards"></div>
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

// ==================== STATE PERSISTENCE ====================
function saveState(key, val) { try { localStorage.setItem('coe_' + key, JSON.stringify(val)); } catch(e) { if (e && e.name === 'QuotaExceededError') { console.warn('localStorage quota exceeded for key:', key); } } }
function loadState(key, fallback) { try { var v = localStorage.getItem('coe_' + key); return v ? JSON.parse(v) : fallback; } catch(e) { return fallback; } }

function switchToTab(pageName) {
    document.querySelectorAll('.topnav .tab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
    var tab = document.querySelector('.topnav .tab[data-page="' + pageName + '"]');
    if (tab) tab.classList.add('active');
    var page = document.getElementById('page-' + pageName);
    if (page) page.classList.add('active');
    saveState('activeTab', pageName);
    loadPage(pageName);
}

// ==================== TAB NAVIGATION ====================
document.querySelectorAll('.topnav .tab').forEach(tab => {
    tab.addEventListener('click', () => {
        switchToTab(tab.dataset.page);
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
async function api(path, opts) {
    if (!opts) opts = {};
    var res = await fetch(API + '/' + path, {
        headers: { 'Content-Type': 'application/json' },
        method: opts.method || 'GET',
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    var data;
    try {
        data = await res.json();
    } catch(e) {
        throw new Error('API error on ' + path + ': invalid response (HTTP ' + res.status + ')');
    }
    if (!res.ok) {
        throw new Error((data && data.error) || 'API error: HTTP ' + res.status);
    }
    // Unwrap paginated responses: { data: [...], total, page, limit, totalPages }
    if (data && typeof data === 'object' && Array.isArray(data.data) && 'total' in data && 'page' in data) {
        return data.data;
    }
    return data;
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
        case 'planning': loadPlans().then(function() {
            // Auto-load the active plan's designer if one exists
            var savedPlan = activePlanId || loadState('activePlanId', null);
            if (savedPlan && !currentDesignerPlanId) {
                openPlanDesignerFromList(savedPlan);
            }
        }); break;
        case 'agents': loadAgents(); break;
        case 'coding': loadCodingSessions(); break;
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
var expandedTickets = {};

async function loadTickets() {
    try {
        var opFilter = '';
        var filterEl = document.getElementById('ticketOperationFilter');
        if (filterEl && filterEl.value) opFilter = '&operation_type=' + encodeURIComponent(filterEl.value);
        const result = await api('tickets?limit=200' + opFilter);
        const tickets = Array.isArray(result) ? result : (result.data || []);
        // Separate root tickets (no parent) from children
        var roots = tickets.filter(function(t) { return !t.parent_ticket_id; });
        var childMap = {};
        tickets.forEach(function(t) {
            if (t.parent_ticket_id) {
                if (!childMap[t.parent_ticket_id]) childMap[t.parent_ticket_id] = [];
                childMap[t.parent_ticket_id].push(t);
            }
        });
        var html = '';
        roots.forEach(function(t) {
            var children = childMap[t.id] || [];
            var hasChildren = children.length > 0;
            var isExpanded = expandedTickets[t.id];
            html += ticketRow(t, 0, hasChildren, isExpanded, children.length);
            if (hasChildren && isExpanded) {
                children.forEach(function(c) {
                    var grandchildren = childMap[c.id] || [];
                    html += ticketRow(c, 1, grandchildren.length > 0, expandedTickets[c.id], grandchildren.length);
                    if (grandchildren.length > 0 && expandedTickets[c.id]) {
                        grandchildren.forEach(function(gc) { html += ticketRow(gc, 2, false, false, 0); });
                    }
                });
            }
        });
        document.getElementById('ticketTableBody').innerHTML = html || '<tr><td colspan="6" class="empty">No tickets</td></tr>';
    } catch (err) {
        document.getElementById('ticketTableBody').innerHTML = '<tr><td colspan="6" class="empty">Error: ' + esc(String(err)) + '</td></tr>';
    }
}

function ticketRow(t, depth, hasChildren, isExpanded, childCount) {
    var indent = depth > 0 ? 'padding-left:' + (depth * 24) + 'px;' : '';
    var expandBtn = hasChildren ? '<button class="ticket-expand-btn" onclick="toggleTicketChildren(\\'' + t.id + '\\')">' + (isExpanded ? '\\u25BC' : '\\u25B6') + '</button>' : '<span style="width:18px;display:inline-block"></span>';
    var childBadge = hasChildren ? '<span class="ticket-child-badge" title="' + (childCount || 0) + ' sub-tickets">' + (childCount || 0) + '</span>' : '';
    var depthClass = depth > 0 ? ' style="opacity:0.85"' : '';
    return '<tr data-ticket-id="' + t.id + '" data-depth="' + depth + '"' + depthClass + '>' +
        '<td style="' + indent + '">' + expandBtn + 'TK-' + String(t.ticket_number).padStart(3, '0') + childBadge + '</td>' +
        '<td class="clickable" onclick="showTicketDetail(\\'' + t.id + '\\')">' + esc(t.title) + (depth > 0 ? ' <span style="color:var(--overlay);font-size:0.8em">(sub)</span>' : '') + '</td>' +
        '<td>' + statusBadge(t.status) + '</td>' +
        '<td>' + prioBadge(t.priority) + '</td>' +
        '<td style="font-size:0.8em;text-transform:capitalize">' + esc((t.operation_type || 'user created').replace(/_/g, ' ')) + (t.auto_created ? '<span style="font-size:0.7em;color:var(--overlay);margin-left:4px">(auto)</span>' : '') + '</td>' +
        '<td>' + ticketActions(t) + '</td>' +
        '</tr>';
}

function toggleTicketChildren(ticketId) {
    expandedTickets[ticketId] = !expandedTickets[ticketId];
    loadTickets();
}

async function createChildTicket(parentId) {
    var title = prompt('Sub-ticket title:');
    if (!title) return;
    try {
        await api('tickets', { method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ title: title, parent_ticket_id: parentId, creator: 'user' }) });
        showNotification('Sub-ticket created', 'success');
        loadTickets();
    } catch(e) { showNotification('Failed to create sub-ticket', 'error'); }
}

function ticketActions(t) {
    var html = '';
    if (t.status === 'open') {
        if (t.auto_created) {
            html += '<button class="btn btn-sm btn-red" onclick="cancelAutoTicket(\\'' + t.id + '\\')">Cancel</button> ';
        } else {
            html += '<button class="btn btn-sm btn-success" onclick="updateTicketStatus(\\'' + t.id + '\\', \\'resolved\\')">Resolve</button> ';
        }
    }
    if (t.status === 'open' || t.status === 'in_review') html += '<button class="btn btn-sm btn-secondary" onclick="createChildTicket(\\'' + t.id + '\\')">+ Sub</button> ';
    if (t.status === 'escalated') html += '<button class="btn btn-sm btn-success" onclick="updateTicketStatus(\\'' + t.id + '\\', \\'resolved\\')">Resolve</button> ';
    if (t.status === 'in_review' && t.auto_created) {
        html += '<button class="btn btn-sm btn-red" onclick="cancelAutoTicket(\\'' + t.id + '\\')">Cancel</button> ';
    }
    return html;
}

async function cancelAutoTicket(id) {
    if (!confirm('Cancel this ticket? Processing will stop.')) return;
    await api('tickets/' + id, { method: 'PUT', body: { status: 'on_hold' } });
    loadTickets();
}

async function showTicketDetail(id) {
    const data = await api('tickets/' + id);
    const replies = data.replies || [];
    var parentInfo = '';
    if (data.parent_ticket_id) {
        parentInfo = '<div class="detail-row"><span>Parent</span><span class="clickable" onclick="showTicketDetail(\\'' + data.parent_ticket_id + '\\')" style="color:var(--blue);cursor:pointer">View parent ticket</span></div>';
    }
    var childInfo = '';
    if (data.child_count > 0) {
        childInfo = '<div class="detail-row"><span>Sub-tickets</span><span>' + data.child_count + ' sub-ticket(s)</span></div>';
    }
    // Build agent badge
    var agentBadge = '';
    if (data.agent_label) {
        var dotStyle = data.processing_status === 'processing' ? 'display:inline-block;width:8px;height:8px;border-radius:50%;background:' + data.agent_color + ';animation:pulse-dot 1.5s infinite;margin-right:6px;' : '';
        agentBadge = '<div class="detail-row"><span>Assigned Agent</span><span style="display:flex;align-items:center">' +
            (dotStyle ? '<span style="' + dotStyle + '"></span>' : '') +
            '<span style="background:' + data.agent_color + ';color:#fff;padding:2px 8px;border-radius:4px;font-size:0.85em">' + esc(data.agent_label) + '</span>' +
            (data.processing_status ? '<span style="margin-left:8px;color:var(--subtext);font-size:0.8em">' + esc(data.processing_status) + '</span>' : '') +
            '</span></div>';
    }
    // Stage badge
    var stageBadge = '';
    if (data.stage_label) {
        stageBadge = '<div class="detail-row"><span>Stage</span><span style="padding:2px 8px;border-radius:4px;font-size:0.85em;background:var(--bg3);color:var(--text)">' + esc(data.stage_label) + '</span></div>';
    }
    // Acceptance criteria
    var criteriaSection = '';
    if (data.acceptance_criteria) {
        criteriaSection = '<div style="margin-top:12px"><strong style="color:var(--text)">Acceptance Criteria</strong>' +
            '<div style="white-space:pre-wrap;color:var(--subtext);padding:8px 12px;background:var(--bg);border-radius:6px;margin-top:4px;border-left:3px solid var(--blue)">' + esc(data.acceptance_criteria) + '</div></div>';
    }
    // Verification result
    var verificationSection = '';
    if (data.verification_result) {
        try {
            var vr = JSON.parse(data.verification_result);
            var vrColor = vr.passed ? 'var(--green)' : 'var(--red)';
            verificationSection = '<div style="margin-top:12px"><strong style="color:var(--text)">Verification Result</strong>' +
                '<div style="padding:8px 12px;background:var(--bg);border-radius:6px;margin-top:4px;border-left:3px solid ' + vrColor + '">' +
                '<div>Score: ' + (vr.clarity_score || 'N/A') + ' | ' + (vr.passed ? 'PASSED' : 'FAILED') + (vr.attempt_number ? ' (attempt ' + vr.attempt_number + ')' : '') + '</div>' +
                (vr.failure_details ? '<div style="color:var(--subtext);margin-top:4px">' + esc(vr.failure_details) + '</div>' : '') +
                '</div></div>';
        } catch(e) { /* ignore parse errors */ }
    }
    document.getElementById('ticketDetail').innerHTML = '<div class="detail-panel">' +
        '<h3>TK-' + String(data.ticket_number).padStart(3, '0') + ': ' + esc(data.title) + '</h3>' +
        '<div class="detail-row"><span>Status</span>' + statusBadge(data.status) + '</div>' +
        '<div class="detail-row"><span>Priority</span>' + prioBadge(data.priority) + '</div>' +
        '<div class="detail-row"><span>Creator</span><span>' + esc(data.creator) + '</span></div>' +
        agentBadge + stageBadge +
        parentInfo + childInfo +
        (data.body ? '<div style="margin-top:12px;white-space:pre-wrap;color:var(--subtext);padding:12px;background:var(--bg);border-radius:6px">' + esc(data.body) + '</div>' : '') +
        criteriaSection + verificationSection +
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
    name: '', description: '', scale: 'MVP', focus: 'Frontend',
    priorities: ['Core business logic'],
    layout: 'sidebar', theme: 'dark',
    pages: ['Dashboard'],
    userRoles: ['Regular User'],
    features: ['CRUD Operations'],
    techStack: 'React + Node',
    aiLevel: 'suggestions',
    customColors: null
};
var wizEditPlanId = null; // Set when editing an existing plan (null = creating new)

// Adaptive step logic: which steps to show based on scale + focus
function getActiveSteps() {
    const s = wizConfig.scale, f = wizConfig.focus;
    if (s === 'MVP' && f === 'Backend') return [0,1,2,3,8,9,10]; // skip layout/theme/pages, keep features/tech
    if (s === 'MVP') return [0,1,2,3,4,5,6,8,9,10]; // skip roles, keep pages/features + tech
    if (s === 'Small') return [0,1,2,3,4,5,6,7,8,9,10]; // all steps including tech
    return [0,1,2,3,4,5,6,7,8,9,10]; // Full Stack / Large+ = all steps
}

function renderWizardDots() {
    const active = getActiveSteps();
    const dotsEl = document.getElementById('wizardDots');
    dotsEl.innerHTML = active.map((s, i) => {
        let cls = 'wizard-dot';
        if (s === wizStep) cls += ' active';
        else if (active.indexOf(wizStep) > i) cls += ' done';
        return '<div class="' + cls + '" data-step="' + s + '" onclick="wizGoTo(' + s + ')" title="Step ' + s + '"></div>';
    }).join('');
}

// Update preview card visibility based on active wizard steps
function updatePreviewCards() {
    var active = getActiveSteps();
    var grid = document.getElementById('previewGrid');
    if (!grid) return;
    grid.querySelectorAll('.preview-card[data-pv-step]').forEach(function(card) {
        var step = parseInt(card.dataset.pvStep, 10);
        card.style.display = active.indexOf(step) >= 0 ? '' : 'none';
    });
}

// Edit wizard stage from preview card click
var wizEditMode = false;
function editWizardStage(stepNum) {
    var active = getActiveSteps();
    if (active.indexOf(stepNum) < 0) {
        showNotification('This setting is not available for the current scale/focus', 'warning');
        return;
    }
    var wizSection = document.getElementById('wizardSection');
    var pdSection = document.getElementById('planDesigner');
    // Show wizard, hide plan designer
    wizSection.style.display = '';
    pdSection.style.display = 'none';
    wizEditMode = true;
    wizGoTo(stepNum);
    wizSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function applyWizardEdit() {
    syncWizConfig();
    // Disable apply button to prevent double-click
    var applyBtns = document.querySelectorAll('.wiz-apply-btn');
    applyBtns.forEach(function(b) { b.disabled = true; b.textContent = 'Applying...'; });
    // Update the plan config via API
    if (pdPlanId) {
        api('plans/' + pdPlanId, { method: 'PUT', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ config_json: JSON.stringify(wizConfig) }) }).then(function() {
            wizEditMode = false;
            showNotification('Plan config updated', 'success');
            // Restore plan designer view
            document.getElementById('wizardSection').style.display = 'none';
            document.getElementById('planDesigner').style.display = '';
            // Update preview cards
            var el = function(id, v) { var e = document.getElementById(id); if (e) e.textContent = v || '--'; };
            el('pvLayout', wizConfig.layout || 'Default');
            el('pvTheme', wizConfig.theme || 'Dark');
            el('pvPages', (wizConfig.pages || []).join(', ') || 'Default');
            el('pvTechStack', wizConfig.techStack || 'React + Node');
            el('pvAI', wizConfig.aiLevel || 'Suggestions');
            updatePreviewCards();
            updateWireframe();
        }).catch(function(err) {
            showNotification('Failed to update plan: ' + err, 'error');
            applyBtns.forEach(function(b) { b.disabled = false; b.textContent = 'Apply Changes'; });
        });
    } else {
        wizEditMode = false;
        document.getElementById('wizardSection').style.display = 'none';
        document.getElementById('planDesigner').style.display = '';
    }
}

// Wizard step help text content
var wizardStepHelp = {
    0: 'Give your project a clear name and description. The AI uses this to understand what you are building and generate better suggestions.',
    1: '<b>MVP</b> \\u2014 Pros: Fast to build, focused scope, quick validation. Cons: Limited features, may need rebuild.\\n<b>Small</b> \\u2014 Pros: Room for core features + polish. Cons: Takes longer than MVP.\\n<b>Medium</b> \\u2014 Pros: Full feature set, scalable. Cons: Significant planning needed.\\n<b>Large/Enterprise</b> \\u2014 Pros: Production-ready, all features. Cons: Long timeline, complex coordination.',
    2: '<b>Frontend</b> \\u2014 Focus on UI/UX, page layouts, components. Best if your backend already exists.\\n<b>Backend</b> \\u2014 Focus on API, database, business logic. Best if UI is secondary.\\n<b>Full Stack</b> \\u2014 Both frontend and backend. The complete picture.',
    3: 'Pick what matters most for your project. This helps the AI prioritize tasks and focus on what you care about.',
    4: '<b>Sidebar</b> \\u2014 Classic layout with navigation on the left. Great for dashboards and admin panels.\\n<b>Tabs</b> \\u2014 Top tab navigation. Good for simple apps with few main sections.\\n<b>Wizard</b> \\u2014 Step-by-step flow. Perfect for forms, onboarding, or guided processes.\\n<b>Custom</b> \\u2014 Design your own layout from scratch.',
    5: 'Pick a color theme for your app. This sets the design tokens that all components will use.',
    6: 'Select the main pages/screens your app needs. You can also add custom pages. Each page becomes a design canvas.',
    7: 'Define who will use your app. This helps generate proper navigation, permissions, and user stories.',
    8: 'Select the core features your app needs. The AI uses these to suggest components, generate tasks, and plan the architecture.',
    9: '<b>React + Node</b> \\u2014 Modern, huge ecosystem, great for SPAs.\\n<b>Vue + Express</b> \\u2014 Simple, approachable, good for smaller teams.\\n<b>HTML/CSS/JS</b> \\u2014 No framework, pure web. Simple and lightweight.\\n<b>Custom</b> \\u2014 Specify your own stack.',
    10: '<b>Manual</b> \\u2014 You make all decisions. AI stays quiet.\\n<b>Suggestions</b> \\u2014 AI recommends, you decide. Good balance.\\n<b>Smart Defaults</b> \\u2014 AI fills in everything, you review. Fastest.\\n<b>Hybrid</b> \\u2014 AI handles routine tasks automatically, asks for important decisions.'
};

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
    saveState('wizStep', wizStep);
    renderWizardDots();
    updateImpact();
    injectWizardHelp(n);
}

function injectWizardHelp(stepNum) {
    // Remove any existing help and apply-edit button
    document.querySelectorAll('.wizard-help-injected, .wiz-apply-btn').forEach(function(el) { el.remove(); });
    var step = document.getElementById('wstep' + stepNum);
    if (!step) return;
    // Add help text
    var helpText = wizardStepHelp[stepNum];
    if (helpText) {
        var helpDiv = document.createElement('div');
        helpDiv.className = 'wizard-help wizard-help-injected';
        helpDiv.innerHTML = helpText.replace(/\\\\n/g, '<br>');
        // Insert after the first label or step-desc
        var anchor = step.querySelector('.step-desc') || step.querySelector('label');
        if (anchor && anchor.nextSibling) {
            anchor.parentNode.insertBefore(helpDiv, anchor.nextSibling);
        } else {
            step.insertBefore(helpDiv, step.firstChild);
        }
    }
    // If in edit mode, add Apply button
    if (wizEditMode) {
        var applyBtn = document.createElement('button');
        applyBtn.className = 'btn btn-success btn-sm wiz-apply-btn';
        applyBtn.textContent = 'Apply Changes';
        applyBtn.onclick = applyWizardEdit;
        applyBtn.style.marginTop = '8px';
        var btnRow = step.querySelector('.btn-row');
        if (btnRow) btnRow.appendChild(applyBtn);
    }
}

function syncWizConfig() {
    wizConfig.name = document.getElementById('wizName')?.value || '';
    wizConfig.description = document.getElementById('wizDesc')?.value || '';
    wizConfig.scale = document.querySelector('#scaleOptions .selected')?.dataset.val || 'MVP';
    wizConfig.focus = document.querySelector('#focusOptions .selected')?.dataset.val || 'Frontend';
    wizConfig.priorities = [...document.querySelectorAll('#priorityOptions .selected')].map(b => b.dataset.val);
    // Design cards (layout, theme, techStack, aiLevel)
    document.querySelectorAll('.design-grid').forEach(grid => {
        const field = grid.dataset.field;
        const sel = grid.querySelector('.design-card.selected');
        if (field && sel) wizConfig[field] = sel.dataset.val;
    });
    // Multi-select grids (pages, roles, features)
    wizConfig.pages = [...document.querySelectorAll('#pagesOptions .option-btn.selected')].map(b => b.dataset.val);
    wizConfig.userRoles = [...document.querySelectorAll('#rolesOptions .option-btn.selected')].map(b => b.dataset.val);
    wizConfig.features = [...document.querySelectorAll('#featuresOptions .option-btn.selected')].map(b => b.dataset.val);
    // Custom colors
    if (wizConfig.theme === 'custom') {
        var ccBg = document.getElementById('ccBg');
        if (ccBg) {
            wizConfig.customColors = {
                background: ccBg.value,
                surface: document.getElementById('ccSurface').value,
                text: document.getElementById('ccText').value,
                accent: document.getElementById('ccAccent').value,
                secondary: document.getElementById('ccSecondary').value
            };
        }
    } else {
        wizConfig.customColors = null;
    }
    // Persist wizard state
    saveState('wizConfig', wizConfig);
    saveState('wizStep', wizStep);
}

// Option button selection (single-select for scale/focus)
document.querySelectorAll('#scaleOptions .option-btn, #focusOptions .option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        btn.parentElement.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        syncWizConfig();
        // Check if current step is still active after scale/focus change
        var active = getActiveSteps();
        if (active.indexOf(wizStep) < 0) {
            // Jump to nearest active step
            var nearest = active[0];
            for (var ai = 0; ai < active.length; ai++) {
                if (active[ai] <= wizStep) nearest = active[ai];
            }
            wizGoTo(nearest);
        }
        renderWizardDots(); // scale/focus change may alter active steps
        updateImpact();
    });
});
// Multi-select for priorities
document.querySelectorAll('#priorityOptions .option-btn').forEach(btn => {
    btn.addEventListener('click', () => { btn.classList.toggle('selected'); syncWizConfig(); updateImpact(); });
});
// Multi-select for pages, roles, features
document.querySelectorAll('#pagesOptions .option-btn, #rolesOptions .option-btn, #featuresOptions .option-btn').forEach(btn => {
    btn.addEventListener('click', () => { btn.classList.toggle('selected'); syncWizConfig(); updateImpact(); });
});
// Add custom page to pages list
function addCustomPage() {
    var input = document.getElementById('wizCustomPage');
    var val = input.value.trim();
    if (!val) return;
    var container = document.getElementById('pagesOptions');
    var btn = document.createElement('button');
    btn.className = 'option-btn selected';
    btn.dataset.val = val;
    btn.textContent = val;
    btn.addEventListener('click', function() { btn.classList.toggle('selected'); syncWizConfig(); updateImpact(); });
    container.appendChild(btn);
    input.value = '';
    syncWizConfig();
    updateImpact();
}
// Design card selection (single-select per grid)
document.querySelectorAll('.design-card').forEach(card => {
    card.addEventListener('click', () => {
        card.parentElement.querySelectorAll('.design-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        syncWizConfig();
        updateImpact();
        // Toggle custom color picker visibility
        var picker = document.getElementById('customColorPicker');
        if (picker) {
            var isThemeGrid = card.parentElement.dataset.field === 'theme';
            if (isThemeGrid && card.dataset.val === 'custom') {
                picker.classList.add('visible');
            } else if (isThemeGrid) {
                picker.classList.remove('visible');
                wizConfig.customColors = null;
            }
        }
    });
});

// ===== CUSTOM COLOR PICKER =====
function updateCustomColors() {
    var bg = document.getElementById('ccBg').value;
    var surface = document.getElementById('ccSurface').value;
    var text = document.getElementById('ccText').value;
    var accent = document.getElementById('ccAccent').value;
    var secondary = document.getElementById('ccSecondary').value;
    // Update hex labels
    document.getElementById('ccBgHex').textContent = bg;
    document.getElementById('ccSurfaceHex').textContent = surface;
    document.getElementById('ccTextHex').textContent = text;
    document.getElementById('ccAccentHex').textContent = accent;
    document.getElementById('ccSecondaryHex').textContent = secondary;
    // Update preview bar
    var bar = document.getElementById('colorPreviewBar');
    if (bar) {
        bar.innerHTML = '<div style="background:' + bg + '"></div>' +
            '<div style="background:' + surface + '"></div>' +
            '<div style="background:' + text + '"></div>' +
            '<div style="background:' + accent + '"></div>' +
            '<div style="background:' + secondary + '"></div>';
    }
    // Update the Custom card preview dots
    var preview = document.getElementById('customThemePreview');
    if (preview) {
        var colors = [bg, surface, text, accent, secondary];
        preview.innerHTML = colors.map(function(c) {
            return '<span style="width:12px;height:12px;border-radius:50%;background:' + c + ';display:inline-block;border:1px solid rgba(255,255,255,0.15)"></span>';
        }).join('');
    }
    // Store in config
    wizConfig.customColors = {
        background: bg, surface: surface, text: text,
        accent: accent, secondary: secondary
    };
}

// ===== IMPACT SIMULATOR (client-side, no LLM) =====
function updateImpact() {
    const s = wizConfig.scale, f = wizConfig.focus;
    const prios = wizConfig.priorities || [];
    const pages = wizConfig.pages || [];
    const features = wizConfig.features || [];
    const baseTasks = { MVP: 8, Small: 15, Medium: 28, Large: 50, Enterprise: 80 };
    var tasks = baseTasks[s] || 28;
    if (f === 'Full Stack') tasks = Math.round(tasks * 1.3);
    tasks += prios.length * 3;
    tasks += pages.length * 2; // Each page adds roughly 2 tasks
    tasks += features.length * 3; // Each feature adds roughly 3 tasks
    var p1Pct = (s === 'Large' || s === 'Enterprise') ? 0.5 : 0.4;
    var p1 = Math.round(tasks * p1Pct);
    var hours = Math.round(tasks * 30 / 60);
    var days = Math.ceil(hours / 6);
    var risk = s === 'Enterprise' ? 'High' : s === 'Large' ? 'Medium-High' : s === 'Medium' ? 'Medium' : 'Low';
    // Feature complexity
    var complexity = features.length <= 3 ? 'Low' : features.length <= 6 ? 'Medium' : 'High';

    var el = function(id, text) { var e = document.getElementById(id); if (e) e.textContent = text; };
    el('impTasks', tasks + ' tasks');
    el('impP1', p1 + ' critical');
    el('impTime', '~' + hours + 'h (' + days + ' days)');
    el('impRisk', risk);
    el('impStack', wizConfig.techStack || 'Custom');
    el('impPages', pages.length + ' pages');
    el('impComplexity', complexity);
}

// Initial impact update
setTimeout(updateImpact, 100);
renderWizardDots();

// Restore wizard state from localStorage
(function restoreWizard() {
    var saved = loadState('wizConfig', null);
    var savedStep = loadState('wizStep', 0);
    if (!saved || !saved.name) return; // Nothing meaningful saved
    // Restore text fields
    var nameEl = document.getElementById('wizName');
    var descEl = document.getElementById('wizDesc');
    if (nameEl && saved.name) nameEl.value = saved.name;
    if (descEl && saved.description) descEl.value = saved.description;
    // Restore single-select option buttons (scale, focus)
    if (saved.scale) {
        document.querySelectorAll('#scaleOptions .option-btn').forEach(function(b) {
            b.classList.toggle('selected', b.dataset.val === saved.scale);
        });
    }
    if (saved.focus) {
        document.querySelectorAll('#focusOptions .option-btn').forEach(function(b) {
            b.classList.toggle('selected', b.dataset.val === saved.focus);
        });
    }
    // Restore multi-select priorities
    if (saved.priorities && saved.priorities.length) {
        document.querySelectorAll('#priorityOptions .option-btn').forEach(function(b) {
            b.classList.toggle('selected', saved.priorities.indexOf(b.dataset.val) >= 0);
        });
    }
    // Restore design cards
    var fields = ['layout', 'theme', 'techStack', 'aiLevel'];
    fields.forEach(function(field) {
        if (saved[field]) {
            var grid = document.querySelector('.design-grid[data-field="' + field + '"]');
            if (grid) {
                grid.querySelectorAll('.design-card').forEach(function(c) {
                    c.classList.toggle('selected', c.dataset.val === saved[field]);
                });
            }
        }
    });
    // Restore multi-select grids (pages, roles, features)
    if (saved.pages && saved.pages.length) {
        document.querySelectorAll('#pagesOptions .option-btn').forEach(function(b) {
            b.classList.toggle('selected', saved.pages.indexOf(b.dataset.val) >= 0);
        });
    }
    if (saved.userRoles && saved.userRoles.length) {
        document.querySelectorAll('#rolesOptions .option-btn').forEach(function(b) {
            b.classList.toggle('selected', saved.userRoles.indexOf(b.dataset.val) >= 0);
        });
    }
    if (saved.features && saved.features.length) {
        document.querySelectorAll('#featuresOptions .option-btn').forEach(function(b) {
            b.classList.toggle('selected', saved.features.indexOf(b.dataset.val) >= 0);
        });
    }
    // Restore custom colors
    if (saved.theme === 'custom' && saved.customColors) {
        var picker = document.getElementById('customColorPicker');
        if (picker) picker.classList.add('visible');
        var cc = saved.customColors;
        if (cc.background) document.getElementById('ccBg').value = cc.background;
        if (cc.surface) document.getElementById('ccSurface').value = cc.surface;
        if (cc.text) document.getElementById('ccText').value = cc.text;
        if (cc.accent) document.getElementById('ccAccent').value = cc.accent;
        if (cc.secondary) document.getElementById('ccSecondary').value = cc.secondary;
        updateCustomColors();
    }
    // Apply to wizConfig
    wizConfig = saved;
    // Restore wizard step
    if (savedStep > 0) {
        wizGoTo(savedStep);
    }
    renderWizardDots();
    updateImpact();
})();

// ===== PLAN GENERATION =====
async function wizGenerate() {
    wizEditMode = false; // Reset edit mode if user generates instead of applying
    syncWizConfig();
    const name = wizConfig.name.trim();
    const desc = wizConfig.description.trim();
    if (!name) { document.getElementById('wizName').focus(); return; }
    if (!desc) { document.getElementById('wizDesc').focus(); showNotification('Please add a project description', 'warning'); return; }
    const out = document.getElementById('wizOutput');
    out.style.display = '';
    out.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Generating plan with AI... This may take a moment.</div>';
    const design = {
        layout: wizConfig.layout, theme: wizConfig.theme,
        pages: wizConfig.pages || ['Dashboard'],
        userRoles: wizConfig.userRoles || ['Regular User'],
        features: wizConfig.features || ['CRUD Operations'],
        techStack: wizConfig.techStack || 'React + Node',
        aiLevel: wizConfig.aiLevel,
        customColors: wizConfig.customColors || null
    };
    try {
        const data = await api('plans/generate', { method: 'POST', body: {
            name, description: desc, scale: wizConfig.scale, focus: wizConfig.focus,
            priorities: wizConfig.priorities, design
        }});
        if (data.plan) {
            if (data.taskCount > 0) {
                out.innerHTML = '<div class="detail-panel">' +
                    '<div style="color:var(--green);font-size:1.1em;margin-bottom:8px">Plan \\u201c' + esc(data.plan.name) + '\\u201d created!</div>' +
                    '<div style="font-size:2em;font-weight:700;color:var(--blue)">' + data.taskCount + '</div>' +
                    '<div style="color:var(--subtext);margin-bottom:8px">tasks generated</div>' +
                    '</div>';
            } else {
                var errMsg = data.error_detail || 'AI could not generate structured tasks.';
                out.innerHTML = '<div class="detail-panel" style="border-left:4px solid var(--yellow);padding-left:16px">' +
                    '<div style="color:var(--yellow);font-weight:600;margin-bottom:8px">Plan Created — Task Generation Issue</div>' +
                    '<div style="margin-bottom:12px;color:var(--subtext)">' + esc(errMsg) + '</div>' +
                    '<div class="btn-row">' +
                    '<button class="btn btn-primary" onclick="retryTaskGeneration(\\'' + data.plan.id + '\\')">Retry AI Generation</button>' +
                    '<button class="btn btn-secondary" onclick="showPlanDetail(\\'' + data.plan.id + '\\')">Add Tasks Manually</button>' +
                    '</div>' +
                    (data.raw_response ? '<details style="margin-top:12px"><summary style="cursor:pointer;color:var(--subtext);font-size:0.85em">Show AI Response</summary><pre style="white-space:pre-wrap;color:var(--subtext);margin-top:4px;font-size:0.85em;max-height:200px;overflow:auto">' + esc(data.raw_response) + '</pre></details>' : '') +
                    '</div>';
            }
            await openPlanDesigner(data.plan.id, data.plan.name, design);
            await loadPlans();
            updateTabBadges();
            // Clear wizard saved state after successful creation
            saveState('wizConfig', null);
            saveState('wizStep', 0);
            // AI-level-aware design generation and chat activation
            var planAiLevel = design.aiLevel || currentAiLevel || 'suggestions';
            if (planAiLevel === 'hybrid' || planAiLevel === 'smart') {
                // Auto-generate design immediately
                showNotification('AI is auto-generating your visual design layout...', 'info');
                generateDesignForPlan(data.plan.id, design, data.plan.name, desc, wizConfig.scale, wizConfig.focus, data.tasks || []);
                // In Hybrid mode, also auto-open AI chat and start guiding the user
                if (planAiLevel === 'hybrid') {
                    setTimeout(function() {
                        if (!aiChatVisible) toggleAiChat();
                    }, 1500);
                }
            } else if (planAiLevel === 'suggestions') {
                // Generate design in background but don't auto-open chat
                generateDesignForPlan(data.plan.id, design, data.plan.name, desc, wizConfig.scale, wizConfig.focus, data.tasks || []);
            }
            // Manual mode: don't auto-generate design — user adds components manually
        } else if (data.error) {
            out.innerHTML = '<div class="detail-panel" style="color:var(--red)">Error: ' + esc(data.error) + '</div>';
        } else {
            out.innerHTML = '<div class="detail-panel" style="color:var(--red)">Unexpected response from server</div>';
        }
    } catch (err) {
        out.innerHTML = '<div class="detail-panel" style="color:var(--red)">Error: ' + esc(String(err)) + '</div>';
    }
}

async function wizUpdatePlan() {
    if (!wizEditPlanId) { wizGenerate(); return; }
    syncWizConfig();
    var name = wizConfig.name.trim();
    if (!name) { document.getElementById('wizName').focus(); return; }
    var out = document.getElementById('wizOutput');
    out.style.display = '';
    out.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Updating plan configuration...</div>';
    var design = {
        layout: wizConfig.layout, theme: wizConfig.theme,
        pages: wizConfig.pages || ['Dashboard'],
        userRoles: wizConfig.userRoles || ['Regular User'],
        features: wizConfig.features || ['CRUD Operations'],
        techStack: wizConfig.techStack || 'React + Node',
        aiLevel: wizConfig.aiLevel,
        customColors: wizConfig.customColors || null
    };
    try {
        // Update the existing plan's config — NOT create a new one
        await api('plans/' + wizEditPlanId, { method: 'PUT', body: {
            name: name,
            config_json: JSON.stringify({
                scale: wizConfig.scale, focus: wizConfig.focus,
                priorities: wizConfig.priorities,
                description: wizConfig.description,
                design: design,
                aiLevel: wizConfig.aiLevel
            })
        }});
        out.innerHTML = '<div class="detail-panel" style="color:var(--green)">Plan \\u201c' + esc(name) + '\\u201d updated successfully.</div>';
        showNotification('Plan updated. Design and tasks preserved.', 'success');
        // Reload plans list and designer
        await loadPlans();
        updateTabBadges();
        if (dsgPlanId === wizEditPlanId) {
            await loadDesignerForPlan(wizEditPlanId);
        }
        wizEditPlanId = null;
        updateWizardGenerateButton();
        // Hide wizard after update
        setTimeout(function() {
            document.getElementById('wizardSection').style.display = 'none';
            out.style.display = 'none';
        }, 2000);
    } catch (err) {
        out.innerHTML = '<div class="detail-panel" style="color:var(--red)">Update failed: ' + esc(String(err)) + '</div>';
    }
}

async function wizQuick() {
    syncWizConfig();
    const name = document.getElementById('wizName').value.trim();
    const desc = document.getElementById('wizDesc').value.trim();
    if (!name || !desc) { document.getElementById('wizName').focus(); return; }
    const out = document.getElementById('wizOutput');
    out.style.display = '';
    out.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Generating plan...</div>';
    try {
        var design = {
            layout: wizConfig.layout, theme: wizConfig.theme,
            pages: wizConfig.pages || ['Dashboard'],
            userRoles: wizConfig.userRoles || ['Regular User'],
            features: wizConfig.features || ['CRUD Operations'],
            techStack: wizConfig.techStack || 'React + Node',
            aiLevel: wizConfig.aiLevel,
            customColors: wizConfig.customColors || null
        };
        const data = await api('plans/generate', { method: 'POST', body: {
            name, description: desc, scale: wizConfig.scale, focus: wizConfig.focus,
            priorities: wizConfig.priorities, design
        }});
        if (data.plan) {
            if (data.taskCount > 0) {
                out.innerHTML = '<div class="detail-panel" style="color:var(--green)">Plan \\u201c' + esc(data.plan.name) + '\\u201d created with ' + data.taskCount + ' tasks.</div>';
            } else {
                out.innerHTML = '<div class="detail-panel" style="color:var(--yellow)">Plan \\u201c' + esc(data.plan.name) + '\\u201d created. Add tasks manually in the designer.</div>';
            }
            await openPlanDesigner(data.plan.id, data.plan.name, design);
            await loadPlans();
            updateTabBadges();
            // Clear wizard saved state after successful creation
            saveState('wizConfig', null);
            saveState('wizStep', 0);
            // AI-level-aware design generation for quick generate too
            var qAiLevel = design.aiLevel || currentAiLevel || 'suggestions';
            if (qAiLevel !== 'manual') {
                generateDesignForPlan(data.plan.id, design, data.plan.name, desc, wizConfig.scale, wizConfig.focus, data.tasks || []);
            }
            if (qAiLevel === 'hybrid') {
                setTimeout(function() { if (!aiChatVisible) toggleAiChat(); }, 1500);
            }
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

async function openPlanDesigner(planId, planName, design) {
    pdPlanId = planId;
    pdDesign = design || {};
    document.getElementById('wizardSection').style.display = 'none';
    document.getElementById('planDesigner').style.display = '';
    document.getElementById('pdPlanName').textContent = 'Plan Designer: ' + planName;
    // Show design preview
    const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v || '--'; };
    el('pvLayout', pdDesign.layout || 'Default');
    el('pvTheme', pdDesign.theme || 'Dark');
    el('pvPages', (pdDesign.pages || []).join(', ') || 'Default');
    el('pvTechStack', pdDesign.techStack || 'React + Node');
    el('pvAI', pdDesign.aiLevel || 'Suggestions');
    updatePreviewCards();
    updateWireframe();
    await loadPlanDesignerTasks(planId);
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
    // Reset wizard state for new plan
    wizEditPlanId = null;
    wizEditMode = false;
    wizStep = 0;
    wizConfig = {
        name: '', description: '', scale: 'MVP', focus: 'Frontend',
        priorities: ['Core business logic'],
        layout: 'sidebar', theme: 'dark',
        pages: ['Dashboard'],
        userRoles: ['Regular User'],
        features: ['CRUD Operations'],
        techStack: 'React + Node',
        aiLevel: 'suggestions',
        customColors: null
    };
    // Reset form fields
    var nameEl = document.getElementById('wizName');
    var descEl = document.getElementById('wizDesc');
    if (nameEl) nameEl.value = '';
    if (descEl) descEl.value = '';
    // Reset option buttons to defaults
    document.querySelectorAll('#scaleOptions .option-btn').forEach(function(b) {
        b.classList.toggle('selected', b.dataset.val === 'MVP');
    });
    document.querySelectorAll('#focusOptions .option-btn').forEach(function(b) {
        b.classList.toggle('selected', b.dataset.val === 'Frontend');
    });
    document.querySelectorAll('#priorityOptions .option-btn').forEach(function(b) {
        b.classList.toggle('selected', b.dataset.val === 'Core business logic');
    });
    document.querySelectorAll('#pagesOptions .option-btn').forEach(function(b) {
        b.classList.toggle('selected', b.dataset.val === 'Dashboard');
    });
    document.querySelectorAll('#rolesOptions .option-btn').forEach(function(b) {
        b.classList.toggle('selected', b.dataset.val === 'Regular User');
    });
    document.querySelectorAll('#featuresOptions .option-btn').forEach(function(b) {
        b.classList.toggle('selected', b.dataset.val === 'CRUD Operations');
    });
    // Reset design cards
    ['layout', 'theme', 'techStack', 'aiLevel'].forEach(function(field) {
        var grid = document.querySelector('.design-grid[data-field="' + field + '"]');
        if (grid) {
            grid.querySelectorAll('.design-card').forEach(function(c, i) {
                c.classList.toggle('selected', i === 0);
            });
        }
    });
    // Hide custom color picker
    var picker = document.getElementById('customColorPicker');
    if (picker) picker.classList.remove('visible');
    // Clear saved state
    saveState('wizConfig', null);
    saveState('wizStep', 0);
    // Reset UI
    wizGoTo(0);
    renderWizardDots();
    updateImpact();
    updateWizardGenerateButton();
}

// ===== PLAN LIST =====
var activePlanId = null;

async function loadPlans() {
    try {
        const result = await api('plans');
        const plans = Array.isArray(result) ? result : [];
        var display = document.getElementById('activePlanDisplay');
        var listEl = document.getElementById('plansList');
        var showAllBtn = document.getElementById('showAllPlansBtn');
        var wizSection = document.getElementById('wizardSection');
        var activePlanSec = document.getElementById('activePlanSection');

        var phaseContainer = document.getElementById('phaseIndicatorContainer');
        var tourContainer = document.getElementById('guidedTourContainer');

        if (plans.length === 0) {
            // No plans — show guided tour, hide wizard initially, hide active plan section
            if (wizSection) wizSection.style.display = 'none';
            if (activePlanSec) activePlanSec.style.display = 'none';
            if (phaseContainer) phaseContainer.style.display = 'none';
            if (tourContainer) tourContainer.style.display = '';
            display.innerHTML = '';
            if (showAllBtn) showAllBtn.style.display = 'none';
            renderGuidedTour();
            return;
        }

        // Has plans — hide the wizard and tour, show the active plan section prominently
        if (wizSection) wizSection.style.display = 'none';
        if (tourContainer) tourContainer.style.display = 'none';
        if (activePlanSec) activePlanSec.style.display = '';

        // Find active plan (first active, or most recent)
        var active = plans.find(function(p) { return p.status === 'active'; }) || plans[0];
        activePlanId = active.id;
        saveState('activePlanId', activePlanId);

        // Render phase indicator and QA panel for active plan
        renderPhaseIndicator(activePlanId);
        renderQAPanel(activePlanId);

        // Parse config to show plan details
        var planConfig = {};
        try { planConfig = JSON.parse(active.config_json || '{}'); } catch(e) { /* ignore */ }
        var scale = planConfig.scale || '';
        var focus = planConfig.focus || '';
        var desc = planConfig.description || '';

        var taskBadge = active.has_tasks ? '<span class="badge badge-green">' + active.task_count + ' tasks</span>' : '<span class="badge badge-yellow">No tasks</span>';
        var designBadge = active.has_design ? '<span class="badge badge-blue">' + active.design_component_count + ' components</span>' : '<span class="badge" style="background:rgba(108,112,134,0.15);color:var(--overlay)">No design</span>';
        var scaleBadge = scale ? '<span class="badge" style="background:rgba(116,199,236,0.15);color:var(--sapphire)">' + esc(scale) + '</span>' : '';
        var focusBadge = focus ? '<span class="badge" style="background:rgba(203,166,247,0.15);color:var(--mauve)">' + esc(focus) + '</span>' : '';

        display.innerHTML = '<div class="card" style="padding:16px">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
            '<div><h3 style="margin:0">' + esc(active.name) + '</h3>' +
            (desc ? '<div style="font-size:0.9em;color:var(--subtext);margin-top:4px;max-width:500px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(desc) + '</div>' : '') +
            '<div style="font-size:0.85em;color:var(--overlay);margin-top:4px">Created: ' + esc(active.created_at) + '</div></div>' +
            '<div style="display:flex;gap:6px">' +
            '<button class="btn btn-sm btn-primary" onclick="openPlanDesignerFromList(\\'' + active.id + '\\')">Open Designer</button>' +
            '<button class="btn btn-sm btn-secondary" onclick="showPlanDetail(\\'' + active.id + '\\')">View Tasks</button>' +
            '<button class="btn btn-sm btn-secondary" onclick="openStatusView(\\'' + active.id + '\\')">Status</button>' +
            '<button class="btn btn-sm btn-secondary" onclick="editPlanWizard(\\'' + active.id + '\\')">Edit Plan</button>' +
            '</div></div>' +
            '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">' +
            statusBadge(active.status) + ' ' + taskBadge + ' ' + designBadge + ' ' + scaleBadge + ' ' + focusBadge +
            '</div></div>';

        // Show "all plans" and "new plan" buttons
        if (showAllBtn) showAllBtn.style.display = plans.length > 1 ? '' : 'none';

        // Build full list (hidden by default)
        listEl.innerHTML = plans.length ? '<table><thead><tr><th>Name</th><th>Status</th><th>Tasks</th><th>Design</th><th>Created</th><th>Actions</th></tr></thead><tbody>' +
            plans.map(function(p) {
                var tb = p.has_tasks ? '<span class="badge badge-green">' + p.task_count + ' tasks</span>' : '<span class="badge badge-yellow">No tasks</span>';
                var db = p.has_design ? '<span class="badge badge-blue">' + p.design_component_count + ' components</span>' : '<span class="badge" style="background:rgba(108,112,134,0.15);color:var(--overlay)">No design</span>';
                var activeTag = p.id === activePlanId ? ' <span class="badge badge-green">ACTIVE</span>' : '';
                return '<tr><td class="clickable" onclick="showPlanDetail(\\'' + p.id + '\\')">' + esc(p.name) + activeTag + '</td><td>' + statusBadge(p.status) + '</td><td>' + tb + '</td><td>' + db + '</td><td>' + esc(p.created_at) + '</td><td style="display:flex;gap:4px">' +
                    (p.id !== activePlanId ? '<button class="btn btn-sm btn-success" onclick="setActivePlan(\\'' + p.id + '\\')">Set Active</button>' : '') +
                    '<button class="btn btn-sm btn-secondary" onclick="showPlanDetail(\\'' + p.id + '\\')">Tasks</button><button class="btn btn-sm btn-primary" onclick="openPlanDesignerFromList(\\'' + p.id + '\\')">Design</button></td></tr>';
            }).join('') +
            '</tbody></table>' : '';
    } catch (err) {
        document.getElementById('activePlanDisplay').innerHTML = '<div class="empty">Error: ' + esc(String(err)) + '</div>';
    }
}

function showAllPlans() {
    var list = document.getElementById('plansList');
    list.style.display = list.style.display === 'none' ? '' : 'none';
    var btn = document.getElementById('showAllPlansBtn');
    if (btn) btn.textContent = list.style.display === 'none' ? 'Show All Plans' : 'Hide All Plans';
}

function showCreatePlanWizard() {
    wizEditPlanId = null;
    updateWizardGenerateButton();
    var wizSection = document.getElementById('wizardSection');
    if (wizSection) {
        wizSection.style.display = '';
        wizSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

async function editPlanWizard(planId) {
    try {
        var planData = await api('plans/' + planId);
        var config = {};
        try { config = JSON.parse(planData.config_json || '{}'); } catch(e) {}
        var design = config.design || {};

        // Load plan config into wizard fields
        wizEditPlanId = planId;
        wizConfig.name = planData.name || '';
        wizConfig.description = config.description || '';
        wizConfig.scale = config.scale || 'MVP';
        wizConfig.focus = config.focus || 'Frontend';
        wizConfig.priorities = config.priorities || ['Core business logic'];
        wizConfig.layout = design.layout || 'sidebar';
        wizConfig.theme = design.theme || 'dark';
        wizConfig.pages = design.pages || ['Dashboard'];
        wizConfig.userRoles = design.userRoles || ['Regular User'];
        wizConfig.features = design.features || ['CRUD Operations'];
        wizConfig.techStack = design.techStack || 'React + Node';
        wizConfig.aiLevel = design.aiLevel || config.aiLevel || 'suggestions';
        wizConfig.customColors = design.customColors || null;

        // Set form values
        var nameEl = document.getElementById('wizName');
        if (nameEl) nameEl.value = wizConfig.name;
        var descEl = document.getElementById('wizDesc');
        if (descEl) descEl.value = wizConfig.description;

        // Set selected options in option grids
        function setSelected(containerId, val) {
            var container = document.getElementById(containerId);
            if (!container) return;
            container.querySelectorAll('.option-btn, .design-card').forEach(function(b) {
                b.classList.remove('selected');
                if (b.dataset.val === val) b.classList.add('selected');
            });
        }
        function setMultiSelected(containerId, vals) {
            var container = document.getElementById(containerId);
            if (!container) return;
            container.querySelectorAll('.option-btn').forEach(function(b) {
                b.classList.toggle('selected', vals.indexOf(b.dataset.val) >= 0);
            });
        }
        setSelected('scaleOptions', wizConfig.scale);
        setSelected('focusOptions', wizConfig.focus);
        setMultiSelected('priorityOptions', wizConfig.priorities);
        // Design grids
        document.querySelectorAll('.design-grid').forEach(function(grid) {
            var field = grid.dataset.field;
            if (!field) return;
            grid.querySelectorAll('.design-card').forEach(function(card) {
                card.classList.toggle('selected', card.dataset.val === wizConfig[field]);
            });
        });
        setMultiSelected('pagesOptions', wizConfig.pages);
        setMultiSelected('rolesOptions', wizConfig.userRoles);
        setMultiSelected('featuresOptions', wizConfig.features);

        updateWizardGenerateButton();
        // Show wizard at step 0
        var wizSection = document.getElementById('wizardSection');
        if (wizSection) {
            wizSection.style.display = '';
            wizGoTo(0);
            wizSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        updateImpactPanel();
    } catch (err) {
        showNotification('Could not load plan for editing: ' + String(err), 'error');
    }
}

function updateWizardGenerateButton() {
    var btn = document.querySelector('#wstep10 .btn-success');
    var header = document.getElementById('wizardHeader');
    if (wizEditPlanId) {
        if (btn) { btn.textContent = 'Update Plan'; btn.setAttribute('onclick', 'wizUpdatePlan()'); }
        if (header) header.textContent = 'Update Plan: ' + (wizConfig.name || 'Untitled');
    } else {
        if (btn) { btn.textContent = 'Generate Plan'; btn.setAttribute('onclick', 'wizGenerate()'); }
        if (header) header.textContent = 'Create New Plan';
    }
}

async function setActivePlan(planId) {
    try {
        await api('plans/' + planId, { method: 'PUT', body: { status: 'active' } });
        activePlanId = planId;
        saveState('activePlanId', planId);
        showNotification('Plan set as active', 'success');
        await loadPlans();
    } catch(e) { showNotification('Failed to set active plan', 'error'); }
}

async function openPlanDesignerFromList(id) {
    await loadDesignerForPlan(id);
}

async function showPlanDetail(id) {
    const data = await api('plans/' + id);
    const tasks = data.tasks || [];
    const verified = tasks.filter(t => t.status === 'verified').length;
    const pct = tasks.length > 0 ? Math.round((verified / tasks.length) * 100) : 0;
    // Use a dedicated detail container — replace instead of append to prevent duplicates
    var detailContainer = document.getElementById('planDetailContainer');
    if (!detailContainer) {
        detailContainer = document.createElement('div');
        detailContainer.id = 'planDetailContainer';
        document.getElementById('plansList').appendChild(detailContainer);
    }
    detailContainer.innerHTML = '<div class="detail-panel"><h3>' + esc(data.name) + '</h3>' +
        '<div class="detail-row"><span>Status</span>' + statusBadge(data.status) + '</div>' +
        '<div class="detail-row"><span>Tasks</span><span>' + verified + '/' + tasks.length + ' verified (' + pct + '%)</span></div>' +
        '<div class="progress-wrap" style="margin-top:12px"><div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div></div>' +
        '<div class="btn-row">' +
        (data.status === 'draft' ? '<button class="btn btn-primary" onclick="activatePlan(\\'' + id + '\\')">Activate</button>' : '') +
        '<button class="btn btn-secondary" onclick="openPlanDesignerFromList(\\'' + id + '\\')">Open Designer</button>' +
        '<button class="btn btn-secondary" onclick="openStatusView(\\'' + id + '\\')">Status</button>' +
        '<button class="btn btn-secondary" onclick="openVersionPanel(\\'' + id + '\\')">Versions</button>' +
        '<button class="btn btn-secondary" onclick="sendToCodeFromPlan(\\'' + id + '\\')">Send to Coding</button>' +
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
// Alias for use in status/AI panels
Object.defineProperty(window, 'currentDesignerPlanId', { get: function() { return dsgPlanId; } });
let dsgPages = [];
let dsgComponents = [];
let dsgSelectedId = null;
let dsgCurrentPageId = null;
let dsgBreakpoint = 'desktop';
let dsgZoom = 100;
let dsgDraggingEl = null;
let dsgResizing = null;
let dsgDragOffset = { x: 0, y: 0 };
let dsgExpandedPages = {};
let dsgDefaultRoles = ['User', 'Developer', 'Admin'];

async function loadDesignerPlanList() {
    try {
        // Populate coding task select
        const tasksResult = await api('tasks');
        const tasks = Array.isArray(tasksResult) ? tasksResult : [];
        const tsel = document.getElementById('codingTaskSelect');
        if (tsel) tsel.innerHTML = '<option value="">Link to task...</option>' + tasks.map(function(t) { return '<option value="' + t.id + '">' + esc(t.title) + '</option>'; }).join('');
    } catch(e) {}
}

async function loadDesignerForPlan(planId) {
    if (!planId) {
        closeDesigner();
        return;
    }
    dsgPlanId = planId;
    saveState('designerPlanId', planId);
    // Fetch full plan data including config_json
    var planData = null;
    try {
        planData = await api('plans/' + planId);
    } catch (e) {
        // Fallback: fetch from plans list
        var plans = await api('plans');
        planData = Array.isArray(plans) ? plans.find(function(p) { return p.id === planId; }) : null;
    }
    var planConfig = {};
    try { planConfig = JSON.parse((planData && planData.config_json) || '{}'); } catch(e) {}
    var planDesign = planConfig.design || {};
    var title = document.getElementById('designerTitle');
    if (title) title.textContent = 'Visual Designer' + (planData ? ' \u2014 ' + planData.name : '');
    document.getElementById('designerSection').style.display = '';
    document.querySelector('.main').classList.add('designer-open');
    // Scroll to designer
    document.getElementById('designerSection').scrollIntoView({ behavior: 'smooth' });

    // Check if design pages exist already
    var existingPages = await api('design/pages?plan_id=' + planId);
    var hasExistingDesign = Array.isArray(existingPages) && existingPages.length > 0;

    // If no design pages exist and the plan has wizard page config, create pages from wizard config
    if (!hasExistingDesign && planDesign.pages && planDesign.pages.length > 0) {
        // Create pages from wizard config before loading
        for (var wi = 0; wi < planDesign.pages.length; wi++) {
            var wizPageName = planDesign.pages[wi];
            await api('design/pages', { method: 'POST', body: {
                plan_id: planId,
                name: wizPageName,
                route: '/' + wizPageName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
                sort_order: wi * 10
            }});
        }
    }

    await loadDesignerPages();
    await loadDesignerTokens();
    await loadDataModels(planId);
    setupCanvasDataModelDrop();
    loadAiSuggestions(planId);
    loadAiQuestions(planId);
    document.getElementById('aiPanelsSection').style.display = '';
    updateTabBadges();
    // Initialize branch system
    currentDesignerBranch = 'live';
    branchChangeCount = 0;
    updateBranchToggleUI();
    loadBranchInfo(planId);
    // Show live preview with designer minimap
    showLivePreview();
    updateLivePreview();
    startDesignerPreviewRefresh();

    // If no existing design and plan has AI config, auto-trigger design generation
    if (!hasExistingDesign && planData) {
        var autoAiLevel = planDesign.aiLevel || currentAiLevel || 'suggestions';
        // In Hybrid/Smart mode, auto-generate design immediately
        if (autoAiLevel === 'hybrid' || autoAiLevel === 'smart') {
            showNotification('AI is auto-generating design layout based on your plan settings...', 'info');
            generateDesignForPlan(planId, planDesign, planData.name || '', planConfig.description || '',
                planConfig.scale || 'MVP', planConfig.focus || 'Full Stack', planData.tasks || []);
            // In Hybrid mode, also auto-open AI chat with design context
            if (autoAiLevel === 'hybrid') {
                setTimeout(function() {
                    if (!aiChatVisible) {
                        toggleAiChat();
                        setTimeout(function() {
                            // Send a proactive AI message about the design
                            var chatInput = document.getElementById('aiChatInput');
                            if (chatInput) {
                                chatInput.value = 'I just created a new plan "' + (planData.name || '') + '". Help me review and refine the generated design layout.';
                                sendAiChatMessage();
                            }
                        }, 1000);
                    }
                }, 500);
            }
        } else if (autoAiLevel === 'suggestions') {
            // Suggestions mode: show a prompt to generate design, don't auto-start
            showNotification('Open the AI chat or click "Generate Design" to create a visual layout.', 'info');
        }
    }
    // Show QA panel when designer is open
    renderQAPanel(planId);
}

function closeDesigner() {
    document.getElementById('designerSection').style.display = 'none';
    document.querySelector('.main').classList.remove('designer-open');
    dsgPlanId = null;
    dsgPages = [];
    dsgComponents = [];
    dsgSelectedId = null;
    dsgCurrentPageId = null;
    saveState('designerPlanId', null);
    closeLivePreview();
    var qaSection = document.getElementById('qaSection');
    if (qaSection) qaSection.style.display = 'none';
}

async function loadDesignerPages() {
    var result = await api('design/pages?plan_id=' + dsgPlanId);
    dsgPages = Array.isArray(result) ? result : [];
    if (dsgPages.length === 0) {
        // Only create a default Home page if loadDesignerForPlan didn't already create pages from wizard config
        var page = await api('design/pages', { method: 'POST', body: { plan_id: dsgPlanId, name: 'Home', route: '/' } });
        if (page && page.id) dsgPages = [page];
    }
    renderPageTree();
    if (!dsgCurrentPageId || !dsgPages.find(function(p) { return p.id === dsgCurrentPageId; })) {
        dsgCurrentPageId = dsgPages[0] ? dsgPages[0].id : null;
    }
    await loadPageComponents();
}

function getChildPagesOf(parentId) {
    return dsgPages.filter(function(p) { return p.parent_page_id === parentId; });
}

function renderPageTree() {
    var tree = document.getElementById('pageTree');
    if (!tree) return;
    var html = '';
    // Render root pages (no parent)
    var roots = dsgPages.filter(function(p) { return !p.parent_page_id; });
    roots.forEach(function(p) { html += renderPageTreeNode(p, 0); });
    html += '<div class="page-tree-add" onclick="addDesignPage(null)">+ Page</div>';
    tree.innerHTML = html;
}

function renderPageTreeNode(page, indent) {
    var children = getChildPagesOf(page.id);
    var hasChildren = children.length > 0;
    var isExpanded = dsgExpandedPages[page.id] !== false;
    var isActive = page.id === dsgCurrentPageId;
    var indentHtml = '';
    for (var i = 0; i < indent; i++) indentHtml += '<span class="tree-indent"></span>';
    var toggleHtml = hasChildren
        ? '<span class="tree-toggle" onclick="event.stopPropagation();togglePageExpand(\\'' + page.id + '\\')">' + (isExpanded ? '\\u25BC' : '\\u25B6') + '</span>'
        : '<span class="tree-toggle"></span>';
    var html = '<div class="page-tree-item' + (isActive ? ' active' : '') + '" onclick="switchDesignPage(\\'' + page.id + '\\')" oncontextmenu="showPageContextMenu(event,\\'' + page.id + '\\')">' +
        indentHtml + toggleHtml +
        '<span class="tree-name">' + esc(page.name) + '</span>' +
        '<span class="page-tree-actions">' +
        (indent < 10 ? '<button title="Add sub-page" onclick="event.stopPropagation();addDesignPage(\\'' + page.id + '\\')">+</button>' : '') +
        '<button title="Rename" onclick="event.stopPropagation();renamePage(\\'' + page.id + '\\')">\\u270E</button>' +
        '<button class="danger" title="Delete" onclick="event.stopPropagation();deletePage(\\'' + page.id + '\\')">\\u2715</button>' +
        '</span></div>';
    if (hasChildren && isExpanded) {
        children.forEach(function(c) { html += renderPageTreeNode(c, indent + 1); });
    }
    return html;
}

function togglePageExpand(pageId) {
    dsgExpandedPages[pageId] = dsgExpandedPages[pageId] === false ? true : false;
    renderPageTree();
}

async function switchDesignPage(pageId) {
    dsgCurrentPageId = pageId;
    dsgSelectedId = null;
    renderPageTree();
    await loadPageComponents();
}

async function addDesignPage(parentId) {
    var name = prompt('Page name:', 'New Page');
    if (!name) return;
    var parentDepth = 0;
    if (parentId) {
        var parent = dsgPages.find(function(p) { return p.id === parentId; });
        parentDepth = parent ? parent.depth : 0;
        if (parentDepth >= 10) { alert('Maximum sub-page depth of 10 reached'); return; }
        dsgExpandedPages[parentId] = true;
    }
    var siblings = parentId ? getChildPagesOf(parentId) : dsgPages.filter(function(p) { return !p.parent_page_id; });
    await api('design/pages', { method: 'POST', body: {
        plan_id: dsgPlanId,
        parent_page_id: parentId || null,
        name: name,
        sort_order: siblings.length * 10
    }});
    await loadDesignerPages();
}

async function renamePage(pageId) {
    var page = dsgPages.find(function(p) { return p.id === pageId; });
    if (!page) return;
    var name = prompt('Rename page:', page.name);
    if (!name || name === page.name) return;
    await api('design/pages/' + pageId, { method: 'PUT', body: { name: name } });
    await loadDesignerPages();
}

async function deletePage(pageId) {
    var page = dsgPages.find(function(p) { return p.id === pageId; });
    if (!page) return;
    var children = getChildPagesOf(pageId);
    var msg = 'Delete page "' + page.name + '"?';
    if (children.length > 0) msg += '\\nSub-pages will be moved up one level.';
    if (!confirm(msg)) return;
    await api('design/pages/' + pageId, { method: 'DELETE' });
    if (dsgCurrentPageId === pageId) dsgCurrentPageId = null;
    await loadDesignerPages();
}

function showPageContextMenu(e, pageId) {
    e.preventDefault();
    e.stopPropagation();
    var existing = document.getElementById('pageCtxMenu');
    if (existing) existing.remove();
    var page = dsgPages.find(function(p) { return p.id === pageId; });
    if (!page) return;
    var menu = document.createElement('div');
    menu.id = 'pageCtxMenu';
    menu.className = 'ctx-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    var canAddChild = page.depth < 10;
    menu.innerHTML =
        '<div class="ctx-menu-item" onclick="renamePage(\\'' + pageId + '\\');closeCtxMenu()">Rename</div>' +
        (canAddChild ? '<div class="ctx-menu-item" onclick="addDesignPage(\\'' + pageId + '\\');closeCtxMenu()">Add Sub-page</div>' : '') +
        '<div class="ctx-menu-sep"></div>' +
        '<div class="ctx-menu-item danger" onclick="deletePage(\\'' + pageId + '\\');closeCtxMenu()">Delete</div>';
    document.body.appendChild(menu);
    setTimeout(function() { document.addEventListener('click', closeCtxMenu, { once: true }); }, 10);
}

function closeCtxMenu() {
    var m = document.getElementById('pageCtxMenu');
    if (m) m.remove();
}

async function loadPageComponents() {
    const result = await api('design/components?page_id=' + dsgCurrentPageId);
    dsgComponents = Array.isArray(result) ? result : [];
    renderCanvas();
    renderLayers();
    renderProps();
    // Show empty canvas guide if no components
    if (dsgComponents.length === 0) {
        var canvas = document.getElementById('designCanvas');
        if (canvas) {
            canvas.innerHTML = '<div class="empty-canvas-guide">' +
                '<div style="font-size:1.5em;margin-bottom:8px">Empty Canvas</div>' +
                '<p>Drag components from the palette on the left, or let AI generate an initial layout.</p>' +
                '<button class="btn btn-primary" onclick="triggerAiDesignGeneration()" style="margin-top:12px">Generate Design with AI</button>' +
                '</div>';
        }
    }
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
    canvas.innerHTML = dsgComponents.map(c => renderDesignElement(c)).join('') +
        '<div class="canvas-resize-handle canvas-resize-right" onmousedown="onCanvasResizeStart(event, \\'right\\')"></div>' +
        '<div class="canvas-resize-handle canvas-resize-bottom" onmousedown="onCanvasResizeStart(event, \\'bottom\\')"></div>' +
        '<div class="canvas-resize-handle canvas-resize-corner" onmousedown="onCanvasResizeStart(event, \\'corner\\')"></div>';
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

    // Build label overlays: name, type, and notes/content
    var compName = comp.name || def.label || comp.type;
    var compTypeLbl = comp.type.charAt(0).toUpperCase() + comp.type.slice(1);
    var compNotes = '';
    var props = comp.props || {};
    if (props.label) compNotes = String(props.label);
    else if (props.placeholder) compNotes = String(props.placeholder);
    else if (comp.content && comp.content !== compName) compNotes = comp.content;

    // Data model badge
    var dataBadge = '';
    if (props.data_model_id) {
        var boundModel = dmAllModels.find(function(m) { return m.id === props.data_model_id; });
        var badgeLabel = boundModel ? boundModel.name : 'Data';
        dataBadge = '<div class="comp-data-badge" title="Bound to: ' + esc(badgeLabel) + '">' + esc(badgeLabel) + '</div>';
    }

    return '<div class="design-el' + sel + '" data-id="' + comp.id + '" style="' + styleStr + '" ' +
        'onmousedown="onElMouseDown(event, \\'' + comp.id + '\\')" onclick="selectDesignEl(event, \\'' + comp.id + '\\')">' +
        '<div class="comp-label">' + esc(compName) + '</div>' +
        '<div class="comp-type-label">' + esc(compTypeLbl) + '</div>' +
        dataBadge +
        (compNotes ? '<div class="comp-notes">' + esc(compNotes) + '</div>' : '') +
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

function renderPageRequirements() {
    var page = dsgPages.find(function(p) { return p.id === dsgCurrentPageId; });
    if (!page) return '';
    var reqs = page.requirements || [];
    var html = '<div class="prop-section"><h4>Page Requirements</h4>' +
        '<div class="req-list">';
    reqs.forEach(function(r, i) {
        html += '<div class="req-item">' +
            '<div class="req-role">As a ' + esc(r.role) + '</div>' +
            '<div class="req-action">I want ' + esc(r.action) + '</div>' +
            (r.benefit ? '<div class="req-benefit">So that ' + esc(r.benefit) + '</div>' : '') +
            '<button class="req-remove" onclick="removePageReq(' + i + ')">&times;</button></div>';
    });
    html += '</div><div class="req-add">' +
        '<select id="pageReqRole" style="width:100%"><option value="User">As a User</option><option value="Developer">As a Developer</option><option value="Admin">As an Admin</option><option value="">Custom...</option></select>' +
        '<input id="pageReqAction" placeholder="I want..." style="width:100%">' +
        '<input id="pageReqBenefit" placeholder="So that... (optional)" style="width:100%">' +
        '<button class="btn btn-sm btn-secondary" onclick="addPageReq()" style="width:100%">+ Add Requirement</button>' +
        '</div></div>';
    return html;
}

function renderCompRequirements(comp) {
    var reqs = comp.requirements || [];
    var html = '<div class="prop-section"><h4>Requirements</h4>' +
        '<div class="req-list">';
    reqs.forEach(function(r, i) {
        html += '<div class="req-item">' +
            '<div class="req-role">As a ' + esc(r.role) + '</div>' +
            '<div class="req-action">I want ' + esc(r.action) + '</div>' +
            (r.benefit ? '<div class="req-benefit">So that ' + esc(r.benefit) + '</div>' : '') +
            '<button class="req-remove" onclick="removeCompReq(\\'' + comp.id + '\\',' + i + ')">&times;</button></div>';
    });
    html += '</div><div class="req-add">' +
        '<select id="compReqRole" style="width:100%"><option value="User">As a User</option><option value="Developer">As a Developer</option><option value="Admin">As an Admin</option><option value="">Custom...</option></select>' +
        '<input id="compReqAction" placeholder="I want..." style="width:100%">' +
        '<input id="compReqBenefit" placeholder="So that... (optional)" style="width:100%">' +
        '<button class="btn btn-sm btn-secondary" onclick="addCompReq(\\'' + comp.id + '\\')" style="width:100%">+ Add Requirement</button>' +
        '</div></div>';
    return html;
}

async function addPageReq() {
    var page = dsgPages.find(function(p) { return p.id === dsgCurrentPageId; });
    if (!page) return;
    var roleSelect = document.getElementById('pageReqRole');
    var role = roleSelect.value || prompt('Enter custom role:');
    if (!role) return;
    var action = document.getElementById('pageReqAction').value;
    if (!action) { alert('Please enter what this role wants'); return; }
    var benefit = document.getElementById('pageReqBenefit').value;
    var reqs = page.requirements || [];
    reqs.push({ role: role, action: action, benefit: benefit });
    await api('design/pages/' + page.id, { method: 'PUT', body: { requirements: reqs } });
    page.requirements = reqs;
    renderProps();
}

async function removePageReq(index) {
    var page = dsgPages.find(function(p) { return p.id === dsgCurrentPageId; });
    if (!page) return;
    var reqs = page.requirements || [];
    reqs.splice(index, 1);
    await api('design/pages/' + page.id, { method: 'PUT', body: { requirements: reqs } });
    page.requirements = reqs;
    renderProps();
}

async function addCompReq(compId) {
    var comp = dsgComponents.find(function(c) { return c.id === compId; });
    if (!comp) return;
    var roleSelect = document.getElementById('compReqRole');
    var role = roleSelect.value || prompt('Enter custom role:');
    if (!role) return;
    var action = document.getElementById('compReqAction').value;
    if (!action) { alert('Please enter what this role wants'); return; }
    var benefit = document.getElementById('compReqBenefit').value;
    var reqs = comp.requirements || [];
    reqs.push({ role: role, action: action, benefit: benefit });
    await api('design/components/' + compId, { method: 'PUT', body: { requirements: reqs } });
    comp.requirements = reqs;
    renderProps();
}

async function removeCompReq(compId, index) {
    var comp = dsgComponents.find(function(c) { return c.id === compId; });
    if (!comp) return;
    var reqs = comp.requirements || [];
    reqs.splice(index, 1);
    await api('design/components/' + compId, { method: 'PUT', body: { requirements: reqs } });
    comp.requirements = reqs;
    renderProps();
}

function renderProps() {
    var panel = document.getElementById('propsPanel');
    var comp = dsgComponents.find(function(c) { return c.id === dsgSelectedId; });
    if (!comp) {
        // Show page requirements when no component is selected
        panel.innerHTML = renderPageRequirements() ||
            '<div class="prop-section"><p style="color:var(--subtext);font-size:0.85em;padding:8px 0">Select a component to edit its properties</p></div>';
        return;
    }
    var s = comp.styles || {};
    panel.innerHTML = '' +
        '<div class="prop-section"><h4>Element</h4>' +
        '<div class="prop-row"><label for="prop-' + comp.id + '-name">Name</label><input id="prop-' + comp.id + '-name" value="' + esc(comp.name) + '" onchange="updateCompProp(\\'' + comp.id + '\\', \\'name\\', this.value)"></div>' +
        '<div class="prop-row"><label>Type</label><span style="font-size:0.85em;color:var(--blue)">' + esc(comp.type) + '</span></div>' +
        '<div class="prop-row"><label for="prop-' + comp.id + '-content">Content</label><input id="prop-' + comp.id + '-content" value="' + esc(comp.content) + '" onchange="updateCompProp(\\'' + comp.id + '\\', \\'content\\', this.value)"></div>' +
        '</div>' +
        renderCompRequirements(comp) +
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
        '<div class="prop-row"><label for="prop-' + comp.id + '-opacity">Opacity</label><input id="prop-' + comp.id + '-opacity" type="range" min="0" max="1" step="0.05" value="' + (s.opacity !== undefined ? s.opacity : 1) + '" oninput="updateCompStyle(\\'' + comp.id + '\\', \\'opacity\\', +this.value)"></div>' +
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

// ==================== TOAST NOTIFICATIONS ====================
var notifQueue = [];
var notifTimers = [];
var NOTIF_MAX = 3;
var lastNotifMsg = '';
var lastNotifTime = 0;

function showNotification(message, type, actions) {
    // Dedup: same message within 2 seconds = skip
    var now = Date.now();
    if (message === lastNotifMsg && (now - lastNotifTime) < 2000) return;
    lastNotifMsg = message;
    lastNotifTime = now;

    var existing = document.querySelectorAll('.coe-notification');
    // If at max, queue it
    if (existing.length >= NOTIF_MAX) {
        notifQueue.push({ message: message, type: type, actions: actions });
        return;
    }

    _showNotifElement(message, type, actions);
}

function _showNotifElement(message, type, actions) {
    var div = document.createElement('div');
    div.className = 'coe-notification coe-notif-' + (type || 'info');
    var html = '<div class="notif-content">' + esc(message) + '</div>';
    if (actions && actions.length) {
        html += '<div class="notif-actions">';
        actions.forEach(function(a) {
            html += '<button class="btn btn-sm ' + (a.primary ? 'btn-primary' : 'btn-secondary') + '" onclick="' + esc(a.onclick || '') + '">' + esc(a.label) + '</button>';
        });
        html += '</div>';
    }
    html += '<button class="notif-close" onclick="_dismissNotif(this.parentElement)">&times;</button>';
    div.innerHTML = html;
    document.body.appendChild(div);
    if (!actions || !actions.length) {
        var timer = setTimeout(function() { _dismissNotif(div); }, 8000);
        div._notifTimer = timer;
    }
}

function _dismissNotif(el) {
    if (!el || !el.parentElement) return;
    if (el._notifTimer) {
        clearTimeout(el._notifTimer);
        el._notifTimer = null;
    }
    el.remove();
    // Show next queued notification
    if (notifQueue.length > 0) {
        var next = notifQueue.shift();
        _showNotifElement(next.message, next.type, next.actions);
    }
}

// ==================== AI DESIGN GENERATION ====================
async function generateDesignForPlan(planId, design, planName, planDesc, scale, focus, tasks) {
    showNotification('AI is generating your initial design layout...', 'info');
    try {
        var result = await api('design/generate', { method: 'POST', body: {
            plan_id: planId, design: design || {}, plan_name: planName || '',
            plan_description: planDesc || '', scale: scale || 'MVP', focus: focus || 'Full Stack',
            tasks: (tasks || []).map(function(t) { return { title: t.title || t }; })
        }});
        if (result && result.pages && result.pages.length > 0) {
            var compCount = result.componentCount || 0;
            showNotification('AI generated ' + compCount + ' components across ' + result.pages.length + ' page(s). Tickets created for all design steps.', 'success');
            // If designer is open for this plan, reload pages and components
            if (dsgPlanId === planId) {
                await loadDesignerPages();
                await loadPageComponents();
                updateLivePreview();
            }
        } else {
            showNotification((result && result.error) || 'AI could not generate a design. Add components manually from the palette.', 'warning');
        }
        // Refresh ticket badge counts — design generation creates multiple tickets
        updateTabBadges();
    } catch (err) {
        showNotification('Design generation failed: ' + String(err), 'error');
    }
}

async function triggerAiDesignGeneration() {
    if (!dsgPlanId) return;
    // Fetch plan config to get design preferences
    try {
        var planData = await api('plans/' + dsgPlanId);
        var config = {};
        try { config = JSON.parse(planData.config_json || '{}'); } catch(e) {}
        var design = config.design || {};
        // Ensure aiLevel is set from plan config or current global setting
        if (!design.aiLevel) design.aiLevel = currentAiLevel || 'suggestions';
        await generateDesignForPlan(dsgPlanId, design, planData.name || '', config.description || '', config.scale || 'MVP', config.focus || 'Full Stack', planData.tasks || []);
    } catch (err) {
        showNotification('Could not load plan data: ' + String(err), 'error');
    }
}

// ==================== TASK REGENERATION ====================
async function retryTaskGeneration(planId) {
    var out = document.getElementById('wizOutput');
    if (out) {
        out.style.display = '';
        out.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Retrying task generation...</div>';
    }
    try {
        var data = await api('plans/' + planId + '/regenerate-tasks', { method: 'POST' });
        if (data.taskCount > 0) {
            if (out) out.innerHTML = '<div class="detail-panel" style="color:var(--green)">Successfully generated ' + data.taskCount + ' tasks!</div>';
            showNotification('Generated ' + data.taskCount + ' tasks for your plan.', 'success');
            if (pdPlanId === planId) loadPlanDesignerTasks(planId);
            loadPlans();
            updateTabBadges();
        } else {
            if (out) out.innerHTML = '<div class="detail-panel" style="color:var(--yellow)">Retry did not produce tasks. ' + esc(data.error_detail || 'Try again later or add tasks manually.') + '</div>';
            showNotification('Task regeneration did not produce results.', 'warning');
        }
    } catch (err) {
        if (out) out.innerHTML = '<div class="detail-panel" style="color:var(--red)">Retry failed: ' + esc(String(err)) + '</div>';
        showNotification('Task retry failed: ' + String(err), 'error');
    }
}

// ==================== PAGE CANVAS RESIZE (drag edges) ====================
var canvasResizing = false;
var canvasResizeEdge = null;
var canvasResizeStartX = 0;
var canvasResizeStartY = 0;
var canvasResizeStartW = 0;
var canvasResizeStartH = 0;

function onCanvasResizeStart(e, edge) {
    e.stopPropagation();
    e.preventDefault();
    canvasResizing = true;
    canvasResizeEdge = edge;
    canvasResizeStartX = e.clientX;
    canvasResizeStartY = e.clientY;
    var canvas = document.getElementById('designCanvas');
    canvasResizeStartW = parseInt(canvas.style.width) || 1440;
    canvasResizeStartH = parseInt(canvas.style.height) || 900;
    document.addEventListener('mousemove', onCanvasResizeMove);
    document.addEventListener('mouseup', onCanvasResizeEnd);
}

function onCanvasResizeMove(e) {
    if (!canvasResizing) return;
    var dx = e.clientX - canvasResizeStartX;
    var dy = e.clientY - canvasResizeStartY;
    var zoom = (dsgZoom || 100) / 100;
    var canvas = document.getElementById('designCanvas');
    if (canvasResizeEdge === 'right' || canvasResizeEdge === 'corner') {
        canvas.style.width = Math.max(320, canvasResizeStartW + Math.round(dx / zoom)) + 'px';
    }
    if (canvasResizeEdge === 'bottom' || canvasResizeEdge === 'corner') {
        canvas.style.height = Math.max(200, canvasResizeStartH + Math.round(dy / zoom)) + 'px';
    }
}

function onCanvasResizeEnd() {
    if (!canvasResizing) return;
    canvasResizing = false;
    document.removeEventListener('mousemove', onCanvasResizeMove);
    document.removeEventListener('mouseup', onCanvasResizeEnd);
    // Save new size to page
    var canvas = document.getElementById('designCanvas');
    var newW = parseInt(canvas.style.width) || 1440;
    var newH = parseInt(canvas.style.height) || 900;
    if (dsgCurrentPageId) {
        api('design/pages/' + dsgCurrentPageId, { method: 'PUT', body: { width: newW, height: newH } }).then(function() {
            var page = dsgPages.find(function(p) { return p.id === dsgCurrentPageId; });
            if (page) { page.width = newW; page.height = newH; }
        });
    }
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
    container.insertAdjacentHTML('beforeend', '<div class="coding-msg user"><div class="msg-role"> You</div><div class="msg-bubble">' + renderMarkdown(text) + '</div><div class="msg-meta">just now</div></div>');
    container.insertAdjacentHTML('beforeend', '<div class="coding-msg agent loading" id="loadingMsg"><div class="msg-role"> Coding Agent</div><div class="msg-bubble">Thinking...</div></div>');
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
    if (!currentSessionId) return alert('Start or select a session first');
    const taskId = document.getElementById('codingTaskSelect')?.value;
    if (!taskId) return alert('Select a task first');

    // Show loading state
    var btn = document.querySelector('#page-coding .btn-secondary');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }
    const container = document.getElementById('codingMessages');
    container.innerHTML += '<div class="coding-msg system loading" id="promptLoading"><div class="msg-bubble">Generating prompt with local LLM...</div></div>';
    container.scrollTop = container.scrollHeight;

    try {
        await api('coding/generate-prompt', {
            method: 'POST',
            body: { session_id: currentSessionId, task_id: taskId },
        });
        var loading = document.getElementById('promptLoading');
        if (loading) loading.remove();
        await loadCodingMessages();
    } catch (e) {
        var ld = document.getElementById('promptLoading');
        if (ld) ld.remove();
        alert('Prompt generation failed: ' + String(e));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Generate Prompt'; }
    }
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
    loadSettingsPage();
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

        'design-quality': () => {
            var dq = settingsConfig.designQuality || {};
            return '<div class="settings-section"><h3>Design Quality</h3>' +
                settingRow('QA Score Threshold', 'Minimum QA score to pass (50-100)', '<input id="setting-dq-threshold" type="range" min="50" max="100" value="' + (dq.qaScoreThreshold || 80) + '" oninput="document.getElementById(\\'dq-threshold-val\\').textContent=this.value" onchange="updateSetting(\\'designQuality.qaScoreThreshold\\', +this.value)"> <span id="dq-threshold-val">' + (dq.qaScoreThreshold || 80) + '</span>', 'setting-dq-threshold') +
                settingRow('Auto-run QA', 'Automatically run QA after design changes', '<div class="toggle-switch' + (dq.autoRunQA ? ' on' : '') + '" onclick="this.classList.toggle(\\'on\\');updateSetting(\\'designQuality.autoRunQA\\', this.classList.contains(\\'on\\'))"></div>') +
            '</div>';
        },

        'ticket-processing': () => {
            var tp = settingsConfig.ticketProcessing || {};
            return '<div class="settings-section"><h3>Ticket Processing</h3>' +
                settingRow('Max Active Tickets', 'Maximum tickets processed simultaneously', '<input id="setting-tp-maxActive" type="number" value="' + (tp.maxActive || 5) + '" min="1" max="20" onchange="updateSetting(\\'ticketProcessing.maxActive\\', +this.value)">', 'setting-tp-maxActive') +
                settingRow('Max Retries', 'Retry failed ticket processing', '<input id="setting-tp-maxRetries" type="number" value="' + (tp.maxRetries || 3) + '" min="0" max="10" onchange="updateSetting(\\'ticketProcessing.maxRetries\\', +this.value)">', 'setting-tp-maxRetries') +
                settingRow('Max Clarifications', 'Max clarification rounds per ticket', '<input id="setting-tp-maxClarifications" type="number" value="' + (tp.maxClarifications || 3) + '" min="1" max="10" onchange="updateSetting(\\'ticketProcessing.maxClarifications\\', +this.value)">', 'setting-tp-maxClarifications') +
            '</div>';
        },

        'boss-ai': () => {
            var boss = settingsConfig.bossAgent || {};
            return '<div class="settings-section"><h3>Boss AI Configuration</h3>' +
                settingRow('Idle Timeout (minutes)', 'Time before boss triggers idle check', '<input id="setting-boss-idle" type="number" value="' + (boss.idleTimeout || 10) + '" min="1" max="60" onchange="updateSetting(\\'bossAgent.idleTimeout\\', +this.value)">', 'setting-boss-idle') +
                settingRow('Stuck Phase Timeout (minutes)', 'Time before escalating stuck phases', '<input id="setting-boss-stuck" type="number" value="' + (boss.stuckPhaseTimeout || 30) + '" min="5" max="120" onchange="updateSetting(\\'bossAgent.stuckPhaseTimeout\\', +this.value)">', 'setting-boss-stuck') +
                settingRow('Task Overload Threshold', 'Max concurrent tasks before warning', '<input id="setting-boss-overload" type="number" value="' + (boss.taskOverloadThreshold || 10) + '" min="3" max="50" onchange="updateSetting(\\'bossAgent.taskOverloadThreshold\\', +this.value)">', 'setting-boss-overload') +
                settingRow('Escalation Threshold', 'Failures before escalating to user', '<input id="setting-boss-escalation" type="number" value="' + (boss.escalationThreshold || 3) + '" min="1" max="10" onchange="updateSetting(\\'bossAgent.escalationThreshold\\', +this.value)">', 'setting-boss-escalation') +
            '</div>';
        },

        'clarity-agent': () => {
            var clarity = settingsConfig.clarityAgent || {};
            return '<div class="settings-section"><h3>Clarity Agent</h3>' +
                settingRow('Auto-resolve Score', 'Minimum clarity score for automatic resolution (0-100)', '<input id="setting-clarity-autoResolve" type="number" value="' + (clarity.autoResolveScore || 85) + '" min="50" max="100" onchange="updateSetting(\\'clarityAgent.autoResolveScore\\', +this.value)">', 'setting-clarity-autoResolve') +
                settingRow('Clarification Score', 'Below this score, request user clarification (0-100)', '<input id="setting-clarity-clarification" type="number" value="' + (clarity.clarificationScore || 60) + '" min="20" max="100" onchange="updateSetting(\\'clarityAgent.clarificationScore\\', +this.value)">', 'setting-clarity-clarification') +
            '</div>';
        },

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

// ==================== NOTIFICATION BADGES ====================
var badgeCounts = {};
async function updateTabBadges() {
    try {
        var planId = currentDesignerPlanId || '';
        var url = 'notifications/counts';
        if (planId) url += '?plan_id=' + encodeURIComponent(planId);
        badgeCounts = await api(url);
        var tabs = ['dashboard', 'tasks', 'tickets', 'planning', 'coding', 'agents', 'github', 'settings', 'system'];
        tabs.forEach(function(tab) {
            var el = document.getElementById('badge-' + tab);
            if (!el) return;
            var count = badgeCounts[tab] || 0;
            el.textContent = count > 0 ? String(count) : '';
            el.className = 'tab-badge' + (count > 0 ? ' red' : '');
        });
    } catch(e) { /* silent */ }
}
setInterval(updateTabBadges, 30000);

// ==================== PROJECT STATUS ====================
var statusPlanId = null;
var statusMode = 'fullstack';
var statusSelectedElement = null;

function openStatusView(planId) {
    if (!planId) { showNotification('No plan selected', 'error'); return; }
    statusPlanId = planId;
    document.getElementById('statusSection').style.display = '';
    document.getElementById('statusTitle').textContent = 'Project Status';
    loadStatusData(planId);
}

function closeStatusView() {
    document.getElementById('statusSection').style.display = 'none';
    statusPlanId = null;
}

function setStatusMode(mode) {
    statusMode = mode;
    document.querySelectorAll('.mode-btn').forEach(function(b) { b.classList.toggle('active', b.textContent.toLowerCase().replace(/\s/g, '') === mode); });
    if (statusPlanId) loadStatusData(statusPlanId);
}

async function loadStatusData(planId) {
    try {
        var pages = await api('design/pages?plan_id=' + encodeURIComponent(planId));
        var summary = await api('status/summary?plan_id=' + encodeURIComponent(planId));
        renderStatusTree(Array.isArray(pages) ? pages : (pages.data || []));
        var readiness = calculateProjectReadiness(summary);
        var fill = document.getElementById('readinessFill');
        if (fill) {
            fill.style.width = readiness + '%';
            fill.className = 'readiness-fill ' + (readiness >= 80 ? 'green' : readiness >= 50 ? 'yellow' : 'red');
        }
        var readLabel = document.getElementById('statusReadinessLabel');
        if (readLabel) readLabel.textContent = 'Readiness: ' + readiness + '%';
        renderStatusCanvas(Array.isArray(pages) ? pages : (pages.data || []));
    } catch(e) {
        console.error('loadStatusData error:', e);
        var tree = document.getElementById('statusTree');
        if (tree) tree.innerHTML = '<div class="empty">Failed to load status data: ' + esc(String(e)) + '</div>';
    }
}

function renderStatusTree(pages) {
    var tree = document.getElementById('statusTree');
    if (!Array.isArray(pages) || !pages.length) { tree.innerHTML = '<div class="empty">No pages in design</div>'; return; }
    // Restore element status map from localStorage
    elementStatusMap = loadState('elementStatusMap', {}) || {};
    var html = '';
    pages.forEach(function(p) {
        var st = elementStatusMap[p.id] || 'not_started';
        var dotColor = st === 'verified' ? 'green' : st === 'implemented' ? 'blue' : st === 'in_progress' ? 'peach' : st === 'has_issues' ? 'red' : 'gray';
        html += '<div class="status-tree-item' + (statusSelectedElement === p.id ? ' active' : '') + '" onclick="selectStatusElement(\\''+p.id+'\\', \\'page\\')">';
        html += '<span class="status-dot" style="background:var(--' + dotColor + ')"></span>';
        html += esc(p.name || 'Untitled');
        html += '</div>';
    });
    tree.innerHTML = html;
}

function renderStatusCanvas(pages) {
    var canvas = document.getElementById('statusCanvas');
    if (!pages.length) { canvas.innerHTML = '<div class="empty">No pages to display</div>'; return; }
    var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">';
    pages.forEach(function(p) {
        html += '<div class="card" style="cursor:pointer;padding:12px" onclick="selectStatusElement(\\''+p.id+'\\', \\'page\\')">';
        html += '<div style="font-weight:600;font-size:0.9em">' + esc(p.name || 'Untitled') + '</div>';
        html += '<div style="font-size:0.75em;color:var(--subtext)">' + esc(p.route || '/') + '</div>';
        html += '</div>';
    });
    html += '</div>';
    canvas.innerHTML = html;
}

async function selectStatusElement(id, type) {
    statusSelectedElement = id;
    var detail = document.getElementById('statusDetailContent');
    try {
        var issues = await api('status/issues?plan_id=' + encodeURIComponent(statusPlanId) + '&element_id=' + encodeURIComponent(id));
        var html = '<h4>Status</h4>';
        var curStatus = elementStatusMap[id] || 'not_started';
        html += '<select onchange="updateElementStatus(\\''+id+'\\', \\''+type+'\\', this.value)" style="width:100%;margin-bottom:8px">';
        ['not_started','planned','in_progress','implemented','verified','has_issues'].forEach(function(s) {
            html += '<option value="'+s+'"' + (s === curStatus ? ' selected' : '') + '>' + s.replace(/_/g,' ') + '</option>';
        });
        html += '</select>';
        html += '<h4>Issues (' + (Array.isArray(issues) ? issues.length : 0) + ')</h4>';
        if (Array.isArray(issues) && issues.length) {
            issues.forEach(function(iss) {
                html += '<div class="ai-card"><div class="ai-card-title">' + esc(iss.description) + '</div>';
                html += '<div class="ai-card-desc">' + esc(iss.severity) + ' — ' + esc(iss.status) + '</div>';
                html += '<div class="ai-card-actions"><button class="btn btn-sm btn-success" onclick="resolveIssue(\\''+iss.id+'\\')">Resolve</button></div></div>';
            });
        }
        html += '<button class="btn btn-sm btn-secondary" onclick="addIssue(\\''+id+'\\', \\''+type+'\\')" style="margin-top:8px">+ Report Issue</button>';
        detail.innerHTML = html;
        document.getElementById('elementChatSection').style.display = '';
        loadElementChat(id, type);
    } catch(e) {
        detail.innerHTML = '<div class="empty">Error loading element details</div>';
    }
    if (statusPlanId) loadStatusData(statusPlanId);
}

async function addIssue(elementId, elementType) {
    var desc = prompt('Describe the issue:');
    if (!desc) return;
    var severity = prompt('Severity (bug/improvement/question):', 'bug') || 'bug';
    try {
        await api('status/issues', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({
            element_id: elementId, element_type: elementType, plan_id: statusPlanId,
            description: desc, severity: severity, mode: statusMode
        })});
        showNotification('Issue reported', 'success');
        selectStatusElement(elementId, elementType);
    } catch(e) { showNotification('Failed to report issue', 'error'); }
}

async function resolveIssue(issueId) {
    try {
        await api('status/issues/' + issueId, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ status: 'resolved' })});
        showNotification('Issue resolved', 'success');
        if (statusSelectedElement) selectStatusElement(statusSelectedElement, 'page');
    } catch(e) { showNotification('Failed to resolve issue', 'error'); }
}

var elementStatusMap = {};
function updateElementStatus(id, type, newStatus) {
    elementStatusMap[id] = newStatus;
    saveState('elementStatusMap', elementStatusMap);
    showNotification('Status updated to: ' + newStatus.replace(/_/g, ' '), 'success');
    // Refresh status tree to show updated status dot
    if (statusPlanId) loadStatusData(statusPlanId);
}

function calculateProjectReadiness(summary) {
    if (!summary || typeof summary !== 'object') return 0;
    var issTotal = summary.issues && typeof summary.issues.total === 'number' ? summary.issues.total : 0;
    var issResolved = summary.issues && typeof summary.issues.resolved === 'number' ? summary.issues.resolved : 0;
    var qTotal = summary.questions && typeof summary.questions.total === 'number' ? summary.questions.total : 0;
    var qAnswered = summary.questions && typeof summary.questions.answered === 'number' ? summary.questions.answered : 0;
    var qAutofilled = summary.questions && typeof summary.questions.autofilled === 'number' ? summary.questions.autofilled : 0;
    var total = issTotal + qTotal;
    var resolved = issResolved + qAnswered + qAutofilled;
    if (total === 0) return 50;
    return Math.round((resolved / total) * 100);
}

async function statusAutofill() {
    if (!statusPlanId) return;
    if (currentAiLevel === 'manual') {
        showNotification('Autofill is disabled in Manual mode.', 'info');
        return;
    }
    showNotification('Auto-filling questions...', 'info');
    try {
        var result = await api('ai/autofill', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ plan_id: statusPlanId, ai_level: currentAiLevel })});
        showNotification('Autofilled ' + (result.autofilled || 0) + ' questions', 'success');
        loadStatusData(statusPlanId);
    } catch(e) { showNotification('Autofill failed', 'error'); }
}

async function reportMicroFix(elementId) {
    var desc = prompt('Describe the micro-fix needed:');
    if (!desc) return;
    try {
        await api('coding/micro-fix', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({
            element_id: elementId, plan_id: statusPlanId, issue_description: desc, element_type: 'component'
        })});
        showNotification('Micro-fix reported and sent to coding agent', 'success');
    } catch(e) { showNotification('Failed to report micro-fix', 'error'); }
}

// ==================== ELEMENT CHAT ====================
async function loadElementChat(elementId, elementType) {
    try {
        var data = await api('elements/' + encodeURIComponent(elementId) + '/chat?type=' + elementType);
        var container = document.getElementById('elementChatMessages');
        if (!data.messages || data.messages.length === 0) {
            container.innerHTML = '<div class="empty" style="font-size:0.8em">No messages yet</div>';
            return;
        }
        var html = '';
        data.messages.forEach(function(msg) {
            html += '<div class="chat-msg ' + (msg.author === 'user' ? 'user' : 'ai') + '">' + esc(msg.body) + '</div>';
        });
        container.innerHTML = html;
        container.scrollTop = container.scrollHeight;
    } catch(e) { /* silent */ }
}

async function sendElementChatMessage() {
    var input = document.getElementById('elementChatInput');
    var message = input.value.trim();
    if (!message || !statusSelectedElement) return;
    input.value = '';
    var container = document.getElementById('elementChatMessages');
    container.innerHTML += '<div class="chat-msg user">' + esc(message) + '</div>';
    container.scrollTop = container.scrollHeight;
    try {
        await api('elements/' + encodeURIComponent(statusSelectedElement) + '/chat', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ message: message, element_type: 'page' })
        });
    } catch(e) { showNotification('Failed to send message', 'error'); }
}

// ==================== AI PANELS ====================
function toggleAiPanel(panelId) {
    var panel = document.getElementById(panelId);
    if (panel) panel.classList.toggle('open');
}

async function refreshAiSuggestions() {
    var planId = currentDesignerPlanId || statusPlanId;
    if (!planId) { showNotification('No plan selected', 'error'); return; }
    showNotification('Generating AI suggestions...', 'info');
    try {
        var result = await api('ai/suggestions', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ plan_id: planId })});
        renderAiSuggestions(result.suggestions || []);
        showNotification('Generated ' + (result.count || 0) + ' suggestions', 'success');
        document.getElementById('aiPanelsSection').style.display = '';
    } catch(e) { showNotification('Failed to generate suggestions', 'error'); }
}

function renderAiSuggestions(suggestions) {
    var body = document.getElementById('aiSuggestionsBody');
    var count = document.getElementById('aiSuggestionsCount');
    var pending = suggestions.filter(function(s) { return s.status === 'pending'; });
    count.textContent = String(pending.length);
    if (!suggestions.length) { body.innerHTML = '<div class="empty">No suggestions. Click Refresh to generate.</div>'; return; }
    var html = '';
    suggestions.forEach(function(s) {
        html += '<div class="ai-card">';
        html += '<div style="display:flex;justify-content:space-between"><div class="ai-card-title">' + esc(s.title) + '</div>' + prioBadge(s.priority) + '</div>';
        html += '<div class="ai-card-desc">' + esc(s.description) + '</div>';
        if (s.reasoning) html += '<div class="ai-card-desc" style="margin-top:4px;font-style:italic">Reasoning: ' + esc(s.reasoning) + '</div>';
        if (s.status === 'pending') {
            html += '<div class="ai-card-actions">';
            html += '<button class="btn btn-sm btn-success" onclick="acceptSuggestion(\\''+s.id+'\\')">Accept</button>';
            html += '<button class="btn btn-sm btn-secondary" onclick="dismissSuggestion(\\''+s.id+'\\')">Dismiss</button>';
            html += '</div>';
        } else {
            html += '<div class="ai-card-desc" style="margin-top:4px">' + statusBadge(s.status) + '</div>';
        }
        html += '</div>';
    });
    body.innerHTML = html;
}

async function acceptSuggestion(id) {
    try {
        await api('ai/suggestions/' + id + '/accept', { method: 'POST' });
        showNotification('Suggestion accepted', 'success');
        var planId = currentDesignerPlanId || statusPlanId;
        if (planId) loadAiSuggestions(planId);
    } catch(e) { showNotification('Failed to accept suggestion', 'error'); }
}

async function dismissSuggestion(id) {
    try {
        await api('ai/suggestions/' + id + '/dismiss', { method: 'POST' });
        showNotification('Suggestion dismissed', 'info');
        var planId = currentDesignerPlanId || statusPlanId;
        if (planId) loadAiSuggestions(planId);
    } catch(e) { showNotification('Failed to dismiss suggestion', 'error'); }
}

async function loadAiSuggestions(planId) {
    try {
        var suggestions = await api('ai/suggestions?plan_id=' + encodeURIComponent(planId));
        renderAiSuggestions(Array.isArray(suggestions) ? suggestions : []);
    } catch(e) { /* silent */ }
}

async function reviewPlanForCode() {
    var planId = currentDesignerPlanId || statusPlanId;
    if (!planId) { showNotification('No plan selected', 'error'); return; }
    showNotification('Reviewing plan for code readiness...', 'info');
    try {
        var result = await api('ai/review-plan', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ plan_id: planId, ai_level: currentAiLevel })});
        renderReadinessReview(result);
        document.getElementById('aiPanelsSection').style.display = '';
        var panel = document.getElementById('aiReadinessPanel');
        if (!panel.classList.contains('open')) panel.classList.add('open');
        showNotification('Review complete: ' + (result.readiness_score || 0) + '% ready', 'success');
    } catch(e) { showNotification('Review failed', 'error'); }
}

function renderReadinessReview(result) {
    var body = document.getElementById('aiReadinessBody');
    var score = result.readiness_score || 0;
    var color = score >= 80 ? 'green' : score >= 50 ? 'yellow' : 'red';
    var html = '<div class="readiness-score ' + color + '">' + score + '%</div>';
    html += '<div style="text-align:center;margin-bottom:12px;font-size:0.9em">' + statusBadge(result.readiness_level || 'not_ready') + '</div>';
    html += '<p style="font-size:0.85em">' + esc(result.summary || '') + '</p>';
    if (result.missing_details && result.missing_details.length) {
        html += '<h4 style="margin-top:12px">Missing Details</h4>';
        result.missing_details.forEach(function(d) {
            html += '<div class="ai-card"><div class="ai-card-title">' + esc(d.area) + '</div>';
            html += '<div class="ai-card-desc">' + esc(d.description) + '</div>';
            html += '<div class="ai-card-desc">' + prioBadge(d.priority) + '</div></div>';
        });
    }
    if (result.questions_generated) html += '<p style="font-size:0.8em;color:var(--subtext)">' + result.questions_generated + ' questions generated, ' + result.suggestions_generated + ' suggestions created</p>';
    body.innerHTML = html;
}

async function loadAiQuestions(planId) {
    try {
        var questions = await api('ai/questions?plan_id=' + encodeURIComponent(planId));
        renderAiQuestions(Array.isArray(questions) ? questions : []);
    } catch(e) { /* silent */ }
}

function renderAiQuestions(questions) {
    var body = document.getElementById('aiQuestionsBody');
    var count = document.getElementById('aiQuestionsCount');
    var pending = questions.filter(function(q) { return q.status === 'pending'; });
    count.textContent = String(pending.length);
    if (!questions.length) { body.innerHTML = '<div class="empty">No questions yet.</div>'; return; }
    var html = '';
    questions.forEach(function(q) {
        html += '<div class="ai-card">';
        html += '<div class="ai-card-title">' + esc(q.question) + '</div>';
        if (q.ai_reasoning) html += '<div class="ai-card-desc" style="font-style:italic">' + esc(q.ai_reasoning) + '</div>';
        if (q.status === 'pending') {
            if (q.question_type === 'yes_no') {
                html += '<div class="ai-card-actions">';
                html += '<button class="btn btn-sm btn-success" onclick="answerQuestion(\\''+q.id+'\\', \\'yes\\')">Yes</button>';
                html += '<button class="btn btn-sm btn-danger" onclick="answerQuestion(\\''+q.id+'\\', \\'no\\')">No</button>';
                html += '<button class="btn btn-sm btn-secondary" onclick="dismissQuestion(\\''+q.id+'\\')">Skip</button>';
                html += '</div>';
            } else if (q.question_type === 'choice' && q.options && q.options.length) {
                html += '<div class="ai-card-actions" style="flex-wrap:wrap">';
                q.options.forEach(function(opt) {
                    html += '<button class="btn btn-sm btn-secondary" onclick="answerQuestion(\\''+q.id+'\\', \\''+esc(opt)+'\\')">'+esc(opt)+'</button>';
                });
                html += '<button class="btn btn-sm btn-secondary" onclick="dismissQuestion(\\''+q.id+'\\')">Skip</button>';
                html += '</div>';
            } else {
                html += '<div class="ai-card-actions">';
                html += '<input type="text" id="qinput-'+q.id+'" placeholder="Your answer..." style="flex:1;font-size:0.85em">';
                html += '<button class="btn btn-sm btn-primary" onclick="answerQuestion(\\''+q.id+'\\', document.getElementById(\\'qinput-'+q.id+'\\').value)">Answer</button>';
                html += '<button class="btn btn-sm btn-secondary" onclick="dismissQuestion(\\''+q.id+'\\')">Skip</button>';
                html += '</div>';
            }
        } else {
            html += '<div class="ai-card-desc" style="margin-top:4px">Answer: <strong>' + esc(q.user_answer || 'N/A') + '</strong>';
            if (q.status === 'autofilled') html += ' <span class="badge badge-blue">Autofilled</span>';
            html += '</div>';
        }
        html += '</div>';
    });
    body.innerHTML = html;
}

async function answerQuestion(id, answer) {
    if (!answer) return;
    try {
        await api('ai/questions/' + id + '/answer', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ answer: answer })});
        showNotification('Question answered', 'success');
        var planId = currentDesignerPlanId || statusPlanId;
        if (planId) loadAiQuestions(planId);
    } catch(e) { showNotification('Failed to answer question', 'error'); }
}

async function dismissQuestion(id) {
    try {
        await api('ai/questions/' + id + '/dismiss', { method: 'POST' });
        var planId = currentDesignerPlanId || statusPlanId;
        if (planId) loadAiQuestions(planId);
    } catch(e) { showNotification('Failed to dismiss question', 'error'); }
}

async function autofillAiQuestions() {
    var planId = currentDesignerPlanId || statusPlanId;
    if (!planId) { showNotification('No plan selected', 'error'); return; }
    if (currentAiLevel === 'manual') {
        showNotification('Autofill is disabled in Manual mode. Switch to Suggestions or higher.', 'info');
        return;
    }
    showNotification('Auto-filling questions with AI...', 'info');
    try {
        var result = await api('ai/autofill', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ plan_id: planId, ai_level: currentAiLevel })});
        showNotification('Autofilled ' + (result.autofilled || 0) + ' questions', 'success');
        loadAiQuestions(planId);
    } catch(e) { showNotification('Autofill failed', 'error'); }
}

// ==================== VERSION CONTROL ====================
async function openVersionPanel(planId) {
    if (!planId) planId = currentDesignerPlanId || statusPlanId;
    if (!planId) { showNotification('No plan selected', 'error'); return; }
    document.getElementById('versionSection').style.display = '';
    loadVersions(planId);
}

function closeVersionPanel() {
    document.getElementById('versionSection').style.display = 'none';
}

async function loadVersions(planId) {
    try {
        var versions = await api('plans/' + encodeURIComponent(planId) + '/versions');
        var filterEl = document.getElementById('versionBranchFilter');
        var filter = filterEl ? filterEl.value : 'all';
        var filtered = Array.isArray(versions) ? versions : [];
        if (filter !== 'all') {
            filtered = filtered.filter(function(v) { return v.branch_type === filter; });
        }
        renderVersionList(filtered, planId);
    } catch(e) {
        document.getElementById('versionList').innerHTML = '<div class="empty">Failed to load versions: ' + esc(String(e)) + '</div>';
    }
}

function renderVersionList(versions, planId) {
    var list = document.getElementById('versionList');
    if (!versions || !versions.length) { list.innerHTML = '<div class="empty">No versions saved yet. Click Save Version to create one.</div>'; return; }
    var html = '';
    versions.forEach(function(v) {
        var branchTag = v.branch_type === 'features' ? '<span class="branch-indicator features" style="margin-left:6px">features</span>' : '<span class="branch-indicator live" style="margin-left:6px">live</span>';
        var activeTag = v.is_active ? ' <span style="color:var(--green);font-size:0.75em">(active)</span>' : '';
        html += '<div class="version-item">';
        html += '<div><div class="version-label">v' + v.version_number + ': ' + esc(v.label) + branchTag + activeTag + '</div>';
        html += '<div class="version-meta">' + formatTime(v.created_at) + ' by ' + esc(v.created_by);
        if (v.change_count > 0) html += ' | ' + v.change_count + ' changes';
        html += '</div>';
        if (v.change_summary) html += '<div class="version-meta">' + esc(v.change_summary) + '</div>';
        html += '</div>';
        html += '<div style="display:flex;gap:4px">';
        html += '<button class="btn btn-sm btn-secondary" onclick="restoreVersion(\\''+planId+'\\', \\''+v.id+'\\', '+v.version_number+')">Restore</button>';
        html += '<button class="btn btn-sm btn-danger" onclick="deleteVersion(\\''+planId+'\\', \\''+v.id+'\\')">Delete</button>';
        html += '</div>';
        html += '</div>';
    });
    list.innerHTML = html;
}

async function saveVersion() {
    var planId = currentDesignerPlanId || statusPlanId;
    if (!planId) { showNotification('No plan selected', 'error'); return; }
    var label = (prompt('Version label:', 'Snapshot') || '').trim();
    if (!label) return;
    try {
        var version = await api('plans/' + encodeURIComponent(planId) + '/versions', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ label: label, created_by: 'user', branch_type: currentDesignerBranch || 'live' })
        });
        showNotification('Version v' + (version && version.version_number ? version.version_number : '?') + ' saved (' + (currentDesignerBranch || 'live') + ')', 'success');
        loadVersions(planId);
    } catch(e) { showNotification('Failed to save version: ' + String(e), 'error'); }
}

async function restoreVersion(planId, versionId, versionNumber) {
    if (!confirm('Restore to version ' + versionNumber + '? This will update the plan config.')) return;
    try {
        await api('plans/' + encodeURIComponent(planId) + '/versions/' + versionId + '/restore', { method: 'POST' });
        showNotification('Restored to version ' + versionNumber, 'success');
        loadVersions(planId);
    } catch(e) { showNotification('Failed to restore version', 'error'); }
}

async function deleteVersion(planId, versionId) {
    if (!confirm('Delete this version?')) return;
    try {
        await api('plans/' + encodeURIComponent(planId) + '/versions/' + versionId, { method: 'DELETE' });
        showNotification('Version deleted', 'info');
        loadVersions(planId);
    } catch(e) { showNotification('Failed to delete version', 'error'); }
}

// ==================== BRANCH MANAGEMENT ====================

var currentDesignerBranch = 'live';
var branchChangeCount = 0;

async function switchBranch(targetBranch) {
    if (targetBranch === currentDesignerBranch) return;
    var planId = currentDesignerPlanId;
    if (!planId) { showNotification('No plan selected', 'error'); return; }

    try {
        var result = await api('plans/' + encodeURIComponent(planId) + '/switch-branch', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ target_branch: targetBranch })
        });
        currentDesignerBranch = targetBranch;
        branchChangeCount = 0;
        updateBranchToggleUI();

        // If target branch has a snapshot, reload the designer with that data
        if (result.snapshot && result.has_existing_version) {
            showNotification('Switched to ' + targetBranch + ' branch (loaded saved state)', 'success');
        } else {
            showNotification('Switched to ' + targetBranch + ' branch (starting fresh)', 'info');
        }

        // Reload designer data
        if (typeof loadDesignerPlan === 'function') {
            loadDesignerPlan(planId);
        }
        loadBranchInfo(planId);
    } catch(e) { showNotification('Failed to switch branch: ' + String(e), 'error'); }
}

function updateBranchToggleUI() {
    var toggleBtns = document.querySelectorAll('#branchToggle button');
    toggleBtns.forEach(function(btn) {
        if (btn.getAttribute('data-branch') === currentDesignerBranch) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Show/hide branch-specific buttons
    var startCodingBtn = document.getElementById('startCodingBtn');
    var mergeBtn = document.getElementById('mergeToLiveBtn');
    if (startCodingBtn) startCodingBtn.style.display = currentDesignerBranch === 'live' ? '' : 'none';
    if (mergeBtn) mergeBtn.style.display = currentDesignerBranch === 'features' ? '' : 'none';
}

async function loadBranchInfo(planId) {
    if (!planId) return;
    try {
        var info = await api('plans/' + encodeURIComponent(planId) + '/branches');
        var liveLabel = document.getElementById('liveVersionLabel');
        var featuresLabel = document.getElementById('featuresVersionLabel');
        var liveCount = document.getElementById('liveChangeCount');
        var featuresCount = document.getElementById('featuresChangeCount');

        if (info.live && liveLabel) {
            liveLabel.textContent = 'v' + info.live.version_number;
            if (liveCount) {
                if (info.live.pending_changes > 0) {
                    liveCount.textContent = String(info.live.pending_changes);
                    liveCount.style.display = '';
                } else { liveCount.style.display = 'none'; }
            }
        } else if (liveLabel) { liveLabel.textContent = 'v1.0'; }

        if (info.features && featuresLabel) {
            featuresLabel.textContent = 'v' + info.features.version_number;
            if (featuresCount) {
                if (info.features.pending_changes > 0) {
                    featuresCount.textContent = String(info.features.pending_changes);
                    featuresCount.style.display = '';
                } else { featuresCount.style.display = 'none'; }
            }
        } else if (featuresLabel) { featuresLabel.textContent = 'draft'; }
    } catch(e) { /* silently fail */ }
}

async function trackDesignChange(changeType, entityType, entityId, description) {
    var planId = currentDesignerPlanId;
    if (!planId) return;
    try {
        var result = await api('plans/' + encodeURIComponent(planId) + '/micro-version', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
                branch_type: currentDesignerBranch,
                change_type: changeType,
                entity_type: entityType,
                entity_id: entityId,
                description: description
            })
        });
        branchChangeCount = result.change_count || 0;

        // Show threshold warning on live branch
        var warningEl = document.getElementById('branchThresholdWarning');
        if (result.threshold_warning && currentDesignerBranch === 'live' && warningEl) {
            warningEl.style.display = '';
            warningEl.innerHTML = '<div class="threshold-warning">' +
                '<span class="warning-icon">!</span>' +
                '<span>You have made <strong>' + result.change_count + '</strong> changes on Live (threshold: ' + result.threshold + '). ' +
                'Consider switching to <strong>Features Design</strong> for larger changes. ' +
                '<button class="btn btn-sm btn-secondary" onclick="switchBranch(\\\'features\\\')" style="margin-left:8px">Switch to Features</button> ' +
                '<button class="btn btn-sm btn-secondary" onclick="dismissThresholdWarning()" style="margin-left:4px">Dismiss</button>' +
                '</span></div>';
        }

        loadBranchInfo(planId);
    } catch(e) { /* silently fail */ }
}

function dismissThresholdWarning() {
    var el = document.getElementById('branchThresholdWarning');
    if (el) el.style.display = 'none';
}

async function showMergePreview() {
    var planId = currentDesignerPlanId;
    if (!planId) { showNotification('No plan selected', 'error'); return; }

    document.getElementById('mergeModalOverlay').style.display = 'flex';
    document.getElementById('mergeDiffSummary').innerHTML = '<div class="empty">Loading diff preview...</div>';

    try {
        var result = await api('plans/' + encodeURIComponent(planId) + '/merge-preview');
        var diff = result.diff || [];
        if (!diff.length) {
            document.getElementById('mergeDiffSummary').innerHTML = '<div class="empty">No differences found between branches.</div>';
            return;
        }
        var html = '<p style="font-size:0.9em;color:var(--subtext)">' + diff.length + ' change(s) will be applied:</p>';
        var added = diff.filter(function(d) { return d.type === 'added'; });
        var modified = diff.filter(function(d) { return d.type === 'modified'; });
        var deleted = diff.filter(function(d) { return d.type === 'deleted'; });

        if (added.length) {
            html += '<div style="margin:8px 0"><strong style="color:var(--green)">Added (' + added.length + ')</strong>';
            added.forEach(function(d) { html += '<div class="merge-preview-item added">' + esc(d.description) + '</div>'; });
            html += '</div>';
        }
        if (modified.length) {
            html += '<div style="margin:8px 0"><strong style="color:var(--yellow)">Modified (' + modified.length + ')</strong>';
            modified.forEach(function(d) { html += '<div class="merge-preview-item modified">' + esc(d.description) + '</div>'; });
            html += '</div>';
        }
        if (deleted.length) {
            html += '<div style="margin:8px 0"><strong style="color:var(--red)">Deleted (' + deleted.length + ')</strong>';
            deleted.forEach(function(d) { html += '<div class="merge-preview-item deleted">' + esc(d.description) + '</div>'; });
            html += '</div>';
        }
        html += '<p style="font-size:0.85em;color:var(--subtext);margin-top:12px">Features Design wins on conflicts. A backup of current Live will be created automatically.</p>';
        document.getElementById('mergeDiffSummary').innerHTML = html;
    } catch(e) {
        document.getElementById('mergeDiffSummary').innerHTML = '<div class="empty" style="color:var(--red)">Failed to load diff: ' + esc(String(e)) + '</div>';
    }
}

function closeMergeModal() {
    document.getElementById('mergeModalOverlay').style.display = 'none';
}

async function executeMerge() {
    var planId = currentDesignerPlanId;
    if (!planId) return;

    document.getElementById('confirmMergeBtn').disabled = true;
    document.getElementById('confirmMergeBtn').textContent = 'Merging...';

    try {
        var result = await api('plans/' + encodeURIComponent(planId) + '/merge', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({})
        });
        closeMergeModal();
        showNotification('Merged ' + (result.diff ? result.diff.length : 0) + ' changes from Features Design to Live', 'success');

        // Switch to live branch and reload
        currentDesignerBranch = 'live';
        branchChangeCount = 0;
        updateBranchToggleUI();
        if (typeof loadDesignerPlan === 'function') {
            loadDesignerPlan(planId);
        }
        loadBranchInfo(planId);
    } catch(e) {
        showNotification('Merge failed: ' + String(e), 'error');
    } finally {
        document.getElementById('confirmMergeBtn').disabled = false;
        document.getElementById('confirmMergeBtn').textContent = 'Merge to Live';
    }
}

// ==================== DATA MODELS ====================
var dmFieldTypes = ['short_text','long_text','rich_text','code','slug','integer','decimal','currency','percentage','rating','quantity','boolean','date','time','datetime','duration','timestamp','date_range','email','phone','url','address','person_name','username','image','file','video','audio','avatar','coordinates','region','enum','multi_enum','tags','status','json','array','object','key_value','reference','multi_reference','lookup','formula','aggregation','auto_increment','color','icon','badge','progress'];
var dmAllModels = [];

async function loadDataModels(planId) {
    try {
        var models = await api('data-models?plan_id=' + encodeURIComponent(planId));
        dmAllModels = Array.isArray(models) ? models : [];
        renderDataModelList(dmAllModels);
    } catch(e) { dmAllModels = []; renderDataModelList([]); }
}

function renderDataModelList(models) {
    var container = document.getElementById('dataModelList');
    if (!container) return;
    if (!models.length) { container.innerHTML = '<div style="font-size:0.8em;color:var(--subtext);padding:4px">No data models</div>'; return; }
    var html = '';
    models.forEach(function(m) {
        var bound = (m.bound_components && m.bound_components.length) ? '<span class="data-model-bound-badge">' + m.bound_components.length + ' bound</span>' : '';
        html += '<div class="data-model-item" draggable="true" data-model-id="' + esc(m.id) + '" onclick="editDataModel(\\'' + m.id + '\\')">';
        html += bound;
        html += '<div style="font-weight:600;font-size:0.85em">' + esc(m.name) + '</div>';
        if (m.fields && m.fields.length) {
            m.fields.slice(0, 4).forEach(function(f) {
                html += '<div class="data-model-field">' + esc(f.name) + ' <span style="color:var(--overlay)">(' + esc(f.type) + ')</span>';
                if (f.required) html += ' <span style="color:var(--yellow)">*</span>';
                html += '</div>';
            });
            if (m.fields.length > 4) html += '<div class="data-model-field" style="color:var(--overlay)">+' + (m.fields.length - 4) + ' more</div>';
        }
        html += '</div>';
    });
    container.innerHTML = html;
    // Set up drag events on data model items
    container.querySelectorAll('.data-model-item[draggable]').forEach(function(item) {
        item.addEventListener('dragstart', function(e) {
            e.dataTransfer.setData('application/x-data-model', item.dataset.modelId);
            e.dataTransfer.effectAllowed = 'link';
            item.classList.add('dragging');
        });
        item.addEventListener('dragend', function() { item.classList.remove('dragging'); });
    });
}

function openDataModelEditor() {
    var planId = currentDesignerPlanId;
    if (!planId) { showNotification('Open a plan first', 'error'); return; }
    document.getElementById('dmEditorTitle').textContent = 'New Data Model';
    document.getElementById('dmEditId').value = '';
    document.getElementById('dmEditName').value = '';
    document.getElementById('dmEditDesc').value = '';
    document.getElementById('dmDeleteBtn').style.display = 'none';
    var fieldsList = document.getElementById('dmFieldsList');
    fieldsList.innerHTML = '';
    // Add default ID field
    dmAddFieldRow(fieldsList, { name: 'id', type: 'auto_increment', required: true, visible: false, description: 'Primary key' });
    openModal('dmEditorModal');
}

async function editDataModel(modelId) {
    try {
        var model = await api('data-models/' + modelId);
        document.getElementById('dmEditorTitle').textContent = 'Edit: ' + (model.name || 'Data Model');
        document.getElementById('dmEditId').value = model.id;
        document.getElementById('dmEditName').value = model.name || '';
        document.getElementById('dmEditDesc').value = model.description || '';
        document.getElementById('dmDeleteBtn').style.display = '';
        var fieldsList = document.getElementById('dmFieldsList');
        fieldsList.innerHTML = '';
        var fields = model.fields || [];
        if (!fields.length) fields = [{ name: 'id', type: 'auto_increment', required: true, visible: false, description: 'Primary key' }];
        fields.forEach(function(f) { dmAddFieldRow(fieldsList, f); });
        openModal('dmEditorModal');
    } catch(e) { showNotification('Failed to load data model', 'error'); }
}

function dmAddField() {
    var fieldsList = document.getElementById('dmFieldsList');
    dmAddFieldRow(fieldsList, { name: '', type: 'short_text', required: false, visible: true, description: '' });
}

function dmAddFieldRow(container, field) {
    var row = document.createElement('div');
    row.className = 'dm-field-row';
    var typeOpts = dmFieldTypes.map(function(t) { return '<option value="' + t + '"' + (t === field.type ? ' selected' : '') + '>' + t.replace(/_/g, ' ') + '</option>'; }).join('');
    row.innerHTML = '<input class="dm-field-name" type="text" placeholder="Field name" value="' + esc(field.name || '') + '">' +
        '<select class="dm-field-type">' + typeOpts + '</select>' +
        '<div class="dm-field-checks">' +
        '<label><input type="checkbox"' + (field.required ? ' checked' : '') + ' class="dm-field-req"> Req</label>' +
        '<label><input type="checkbox"' + (field.visible !== false ? ' checked' : '') + ' class="dm-field-vis"> Vis</label>' +
        '</div>' +
        '<button class="dm-field-remove" onclick="this.parentElement.remove()">X</button>';
    container.appendChild(row);
}

function dmCollectFields() {
    var rows = document.querySelectorAll('#dmFieldsList .dm-field-row');
    var fields = [];
    var seen = {};
    rows.forEach(function(row) {
        var nameEl = row.querySelector('.dm-field-name');
        if (!nameEl) return;
        var name = nameEl.value.trim();
        if (!name) return;
        // Prevent duplicate field names (case-insensitive)
        var lname = name.toLowerCase();
        if (seen[lname]) return;
        seen[lname] = true;
        fields.push({
            name: name,
            type: row.querySelector('.dm-field-type') ? row.querySelector('.dm-field-type').value : 'string',
            required: row.querySelector('.dm-field-req') ? row.querySelector('.dm-field-req').checked : false,
            visible: row.querySelector('.dm-field-vis') ? row.querySelector('.dm-field-vis').checked : true,
            description: ''
        });
    });
    return fields;
}

async function dmSaveModel() {
    var planId = currentDesignerPlanId;
    if (!planId) { showNotification('No plan open', 'error'); return; }
    var name = document.getElementById('dmEditName').value.trim();
    if (!name) { showNotification('Model name is required', 'error'); return; }
    var fields = dmCollectFields();
    var desc = document.getElementById('dmEditDesc').value.trim();
    var modelId = document.getElementById('dmEditId').value;
    try {
        if (modelId) {
            await api('data-models/' + modelId, { method: 'PUT', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ name: name, description: desc, fields: fields }) });
            showNotification('Data model updated', 'success');
        } else {
            await api('data-models', { method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ plan_id: planId, name: name, description: desc, fields: fields }) });
            showNotification('Data model "' + name + '" created', 'success');
        }
        closeModal('dmEditorModal');
        loadDataModels(planId);
    } catch(e) { showNotification('Failed to save data model: ' + String(e), 'error'); }
}

async function dmDeleteModel() {
    var modelId = document.getElementById('dmEditId').value;
    if (!modelId) return;
    var model = dmAllModels.find(function(m) { return m.id === modelId; });
    var boundCount = model && model.bound_components ? model.bound_components.length : 0;
    var msg = boundCount > 0
        ? 'This data model is bound to ' + boundCount + ' component(s). Deleting it will remove all bindings. Continue?'
        : 'Delete this data model?';
    if (!confirm(msg)) return;
    try {
        await api('data-models/' + modelId, { method: 'DELETE' });
        showNotification('Data model deleted', 'info');
        closeModal('dmEditorModal');
        loadDataModels(currentDesignerPlanId);
        if (dsgCurrentPageId) loadPageComponents(dsgCurrentPageId);
    } catch(e) { showNotification('Failed to delete data model', 'error'); }
}

// ==================== DATA MODEL DRAG-DROP BINDING ====================
var _canvasDropSetup = false;
function setupCanvasDataModelDrop() {
    if (_canvasDropSetup) return; // Prevent duplicate listeners
    var canvas = document.getElementById('designCanvas');
    if (!canvas) return;
    _canvasDropSetup = true;
    canvas.addEventListener('dragover', function(e) {
        if (e.dataTransfer.types.indexOf('application/x-data-model') >= 0) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'link';
            // Highlight target component
            var target = e.target.closest('.design-el');
            canvas.querySelectorAll('.design-el.data-drop-target').forEach(function(c) { c.classList.remove('data-drop-target'); });
            if (target) target.classList.add('data-drop-target');
        }
    });
    canvas.addEventListener('dragleave', function(e) {
        if (!canvas.contains(e.relatedTarget)) {
            canvas.querySelectorAll('.data-drop-target').forEach(function(c) { c.classList.remove('data-drop-target'); });
        }
    });
    canvas.addEventListener('drop', function(e) {
        e.preventDefault();
        var modelId = e.dataTransfer.getData('application/x-data-model');
        canvas.querySelectorAll('.data-drop-target').forEach(function(c) { c.classList.remove('data-drop-target'); });
        if (!modelId) return;
        var target = e.target.closest('.design-el');
        var compId = target ? target.dataset.id : null;
        if (!target || !compId) { showNotification('Drop on a component to bind data', 'warning'); return; }
        bindDataModelToComponent(modelId, compId);
    });
}

async function bindDataModelToComponent(modelId, componentId) {
    try {
        // Update component props with data_model_id
        await api('design/components/' + componentId, { method: 'PUT', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ props: { data_model_id: modelId } }) });
        // Update model bound_components
        var model = dmAllModels.find(function(m) { return m.id === modelId; });
        if (model) {
            var bound = (model.bound_components || []).slice();
            if (bound.indexOf(componentId) < 0) bound.push(componentId);
            await api('data-models/' + modelId, { method: 'PUT', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ bound_components: bound }) });
        }
        showNotification('Data model bound to component', 'success');
        loadDataModels(currentDesignerPlanId);
        if (dsgCurrentPageId) loadPageComponents(dsgCurrentPageId);
    } catch(e) { showNotification('Failed to bind data model: ' + String(e), 'error'); }
}

async function unbindDataModel(componentId) {
    try {
        var comp = dsgComponents.find(function(c) { return c.id === componentId; });
        var modelId = comp && comp.props && comp.props.data_model_id;
        await api('design/components/' + componentId, { method: 'PUT', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ props: { data_model_id: null } }) });
        if (modelId) {
            var model = dmAllModels.find(function(m) { return m.id === modelId; });
            if (model) {
                var bound = (model.bound_components || []).filter(function(id) { return id !== componentId; });
                await api('data-models/' + modelId, { method: 'PUT', headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({ bound_components: bound }) });
            }
        }
        showNotification('Data model unbound', 'info');
        loadDataModels(currentDesignerPlanId);
        if (dsgCurrentPageId) loadPageComponents(dsgCurrentPageId);
    } catch(e) { showNotification('Unbind failed', 'error'); }
}

// ==================== SEND TO CODING FROM DESIGN ====================
async function sendToCodeFromDesign() {
    var planId = currentDesignerPlanId;
    if (!planId) { showNotification('No plan selected', 'error'); return; }

    // Enforce Live-only for Start Coding
    if (currentDesignerBranch !== 'live') {
        showNotification('Start Coding is only available on the Live branch. Merge your Features Design first.', 'error');
        return;
    }

    showNotification('Creating coding session from Live design...', 'info');
    try {
        var result = await api('coding/start-from-live', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
                plan_id: planId,
                branch_type: currentDesignerBranch,
                ai_level: currentAiLevel
            })
        });
        showNotification('Coding session created (v' + (result.version_number || '?') + ') with ' + (result.generated_tasks || 0) + ' tasks', 'success');
        switchToTab('coding');
    } catch(e) { showNotification('Failed to start coding: ' + String(e), 'error'); }
}

async function sendToCodeFromPlan(planId) {
    if (!planId) { showNotification('No plan selected', 'error'); return; }
    showNotification('Sending plan design to coding agent...', 'info');
    try {
        await api('coding/from-design', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ plan_id: planId })
        });
        showNotification('Design sent to coding session', 'success');
        switchToTab('coding');
    } catch(e) { showNotification('Failed to send to coding', 'error'); }
}

// ==================== AI BUG CHECK ====================
async function runAiBugCheck() {
    var planId = currentDesignerPlanId || statusPlanId;
    if (!planId) { showNotification('No plan selected', 'error'); return; }
    showNotification('Running AI bug check...', 'info');
    try {
        var result = await api('ai/bug-check', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ plan_id: planId })
        });
        showNotification('Bug check found ' + (result.count || 0) + ' issues', result.count > 0 ? 'warning' : 'success');
    } catch(e) { showNotification('Bug check failed', 'error'); }
}

// ==================== DESIGN QA PANEL (C7) ====================
var qaLastResult = null;

async function renderQAPanel(planId) {
    if (!planId) return;
    var section = document.getElementById('qaSection');
    if (section) section.style.display = '';

    // Fetch current drafts
    try {
        var drafts = await api('design/drafts?plan_id=' + encodeURIComponent(planId));
        var draftArr = Array.isArray(drafts) ? drafts : (drafts.data || []);
        var pendingDrafts = draftArr.filter(function(d) { return d.status === 'pending' || d.status === 'draft'; });

        var draftEl = document.getElementById('qaDrafts');
        if (pendingDrafts.length > 0 && draftEl) {
            draftEl.style.display = '';
            var countEl = document.getElementById('qaDraftCount');
            if (countEl) countEl.textContent = pendingDrafts.length + ' pending draft' + (pendingDrafts.length !== 1 ? 's' : '');
        } else if (draftEl) {
            draftEl.style.display = 'none';
        }
    } catch(e) {
        // Drafts endpoint may not exist yet
    }

    // If we have cached QA results, render them
    if (qaLastResult) renderQAResults(qaLastResult);
}

function renderQAResults(result) {
    qaLastResult = result;
    var score = result.score || 0;
    var scoreClass = score >= 80 ? 'green' : score >= 60 ? 'yellow' : 'red';

    var scoreEl = document.getElementById('qaScoreValue');
    if (scoreEl) {
        scoreEl.textContent = score;
        scoreEl.className = 'qa-score ' + scoreClass;
    }
    var badgeEl = document.getElementById('qaScoreBadge');
    if (badgeEl) {
        badgeEl.textContent = score + '/100';
        badgeEl.className = 'badge badge-' + scoreClass;
    }

    // Gap counts by severity
    var gaps = result.gaps || {};
    var gapsEl = document.getElementById('qaGaps');
    if (gapsEl) {
        gapsEl.innerHTML =
            '<div class="qa-gap-item"><span class="gap-count" style="color:var(--red)">' + (gaps.critical || 0) + '</span> Critical</div>' +
            '<div class="qa-gap-item"><span class="gap-count" style="color:var(--yellow)">' + (gaps.warning || 0) + '</span> Warning</div>' +
            '<div class="qa-gap-item"><span class="gap-count" style="color:var(--overlay)">' + (gaps.info || 0) + '</span> Info</div>';
    }

    // Phase indicators
    var phases = result.phases || {};
    var phasesEl = document.getElementById('qaPhases');
    if (phasesEl) {
        var phaseNames = ['architect_review', 'gap_analysis', 'hardening'];
        var phaseLabels = ['Architect Review', 'Gap Analysis', 'Hardening'];
        phasesEl.innerHTML = phaseNames.map(function(name, i) {
            var state = phases[name] || 'pending';
            var dotClass = state === 'done' || state === 'complete' || state === 'completed' ? 'done' : state === 'running' || state === 'in_progress' ? 'running' : 'pending';
            return '<div class="qa-phase"><span class="phase-dot ' + dotClass + '"></span> ' + phaseLabels[i] + '</div>';
        }).join('');
    }
}

async function runDesignQA() {
    var planId = currentDesignerPlanId || activePlanId;
    if (!planId) { showNotification('No plan selected', 'error'); return; }

    var btn = document.getElementById('qaRunBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Running...'; }

    try {
        var result = await api('design/full-qa', { method: 'POST', body: { plan_id: planId } });
        renderQAResults(result);
        showNotification('QA complete: score ' + (result.score || 0), result.score >= 80 ? 'success' : 'warning');
    } catch(e) {
        showNotification('QA failed: ' + String(e), 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Run QA'; }
    }
}

async function qaBulkDraftAction(action) {
    var planId = currentDesignerPlanId || activePlanId;
    if (!planId) return;

    try {
        var drafts = await api('design/drafts?plan_id=' + encodeURIComponent(planId));
        var draftArr = Array.isArray(drafts) ? drafts : (drafts.data || []);
        var pending = draftArr.filter(function(d) { return d.status === 'pending' || d.status === 'draft'; });

        for (var i = 0; i < pending.length; i++) {
            await api('design/drafts/' + pending[i].id + '/' + action, { method: 'POST' });
        }
        showNotification(pending.length + ' draft(s) ' + action + 'd', 'success');
        renderQAPanel(planId);
    } catch(e) {
        showNotification('Bulk ' + action + ' failed: ' + String(e), 'error');
    }
}

// ==================== QUESTION POPUP (E3) ====================
var questionQueue = [];
var questionCurrentIndex = 0;

async function renderQuestionPopup() {
    var planId = currentDesignerPlanId || activePlanId;
    if (!planId) return;

    try {
        var result = await api('questions/queue?plan_id=' + encodeURIComponent(planId));
        questionQueue = Array.isArray(result) ? result : (result.questions || result.data || []);
    } catch(e) {
        questionQueue = [];
    }

    updateQuestionBadge();

    if (questionQueue.length === 0) {
        var body = document.getElementById('questionPopupBody');
        if (body) body.innerHTML = '<div style="text-align:center;padding:30px;color:var(--subtext)"><div style="font-size:2em;margin-bottom:8px">&#10003;</div><div style="font-size:1.1em;font-weight:600">All caught up!</div><div style="font-size:0.9em;margin-top:4px">No pending questions right now.</div></div>';
        document.getElementById('questionPopupOverlay').style.display = 'flex';
        document.getElementById('questionPosition').textContent = '';
        return;
    }

    questionCurrentIndex = 0;
    renderCurrentQuestion();
    document.getElementById('questionPopupOverlay').style.display = 'flex';
}

function renderCurrentQuestion() {
    if (questionCurrentIndex >= questionQueue.length) {
        closeQuestionPopup();
        showNotification('All questions answered!', 'success');
        return;
    }

    var q = questionQueue[questionCurrentIndex];
    var posEl = document.getElementById('questionPosition');
    if (posEl) posEl.textContent = 'Question ' + (questionCurrentIndex + 1) + ' of ' + questionQueue.length;

    var agentClass = (q.source_agent || '').toLowerCase().replace(/agent$/i, '').replace(/\s+/g, '');
    var body = '';

    // Source badge
    body += '<div class="q-source-badge ' + esc(agentClass) + '">' + esc(q.source_agent || 'System') + '</div>';

    // Question text
    body += '<div class="q-text">' + esc(q.question || q.text || '') + '</div>';

    // AI suggested answer
    if (q.suggested_answer || q.ai_suggestion) {
        body += '<div class="q-suggested"><strong>AI Suggested Answer:</strong>' + esc(q.suggested_answer || q.ai_suggestion) + '</div>';
    }

    // Response controls based on question type
    var qType = q.question_type || q.type || 'text';

    if (qType === 'multiple_choice' && q.options && q.options.length > 0) {
        body += '<div class="q-options" id="qOptions">';
        q.options.forEach(function(opt, i) {
            body += '<label class="q-option" onclick="selectQuestionOption(this)"><input type="radio" name="qAnswer" value="' + esc(opt) + '"> ' + esc(opt) + '</label>';
        });
        body += '<label class="q-option" onclick="selectQuestionOption(this)"><input type="radio" name="qAnswer" value="__other"> Other: <input type="text" id="qOtherText" style="width:200px;margin-left:6px;padding:4px 8px" onclick="event.stopPropagation()" placeholder="Type your answer..."></label>';
        body += '</div>';
    } else if (qType === 'yes_no') {
        body += '<div class="q-yesno">';
        body += '<button class="btn btn-success" onclick="submitQuestionAnswer(\\'' + q.id + '\\', \\'yes\\')">Yes</button>';
        body += '<button class="btn btn-danger" onclick="submitQuestionAnswer(\\'' + q.id + '\\', \\'no\\')">No</button>';
        body += '</div>';
    } else {
        body += '<div class="form-group"><textarea id="qTextAnswer" placeholder="Type your answer..." rows="3"></textarea></div>';
    }

    // Navigation hint
    if (q.navigation_area || q.context_area) {
        body += '<button class="q-nav-btn" onclick="navigateToArea(\\'' + esc(q.navigation_area || q.context_area) + '\\')">Go to: ' + esc(q.navigation_area || q.context_area) + '</button>';
    }

    // Actions
    body += '<div class="q-actions">';
    body += '<button class="btn btn-secondary btn-sm" onclick="dismissQuestion(\\'' + q.id + '\\')">Dismiss</button>';
    if (qType !== 'yes_no') {
        body += '<button class="btn btn-primary" onclick="submitCurrentQuestion(\\'' + q.id + '\\', \\'' + esc(qType) + '\\')">Submit Answer</button>';
    }
    body += '</div>';

    var bodyEl = document.getElementById('questionPopupBody');
    if (bodyEl) bodyEl.innerHTML = body;
}

function selectQuestionOption(el) {
    document.querySelectorAll('#qOptions .q-option').forEach(function(o) { o.classList.remove('selected'); });
    el.classList.add('selected');
    var radio = el.querySelector('input[type="radio"]');
    if (radio) radio.checked = true;
}

async function submitCurrentQuestion(questionId, qType) {
    var answer = '';
    if (qType === 'multiple_choice') {
        var checked = document.querySelector('input[name="qAnswer"]:checked');
        if (!checked) { showNotification('Please select an option', 'warning'); return; }
        answer = checked.value;
        if (answer === '__other') {
            var otherInput = document.getElementById('qOtherText');
            answer = otherInput ? otherInput.value.trim() : '';
            if (!answer) { showNotification('Please enter your answer', 'warning'); return; }
        }
    } else {
        var textArea = document.getElementById('qTextAnswer');
        answer = textArea ? textArea.value.trim() : '';
        if (!answer) { showNotification('Please enter your answer', 'warning'); return; }
    }

    await submitQuestionAnswer(questionId, answer);
}

async function submitQuestionAnswer(questionId, answer) {
    try {
        await api('questions/' + questionId + '/answer', { method: 'POST', body: { answer: answer } });
        showNotification('Answer submitted', 'success');
        questionQueue.splice(questionCurrentIndex, 1);
        updateQuestionBadge();
        if (questionQueue.length === 0) {
            closeQuestionPopup();
            showNotification('All questions answered!', 'success');
        } else {
            if (questionCurrentIndex >= questionQueue.length) questionCurrentIndex = 0;
            renderCurrentQuestion();
        }
    } catch(e) {
        showNotification('Failed to submit answer: ' + String(e), 'error');
    }
}

async function dismissQuestion(questionId) {
    try {
        await api('questions/' + questionId + '/dismiss', { method: 'POST' });
        showNotification('Question dismissed', 'info');
        questionQueue.splice(questionCurrentIndex, 1);
        updateQuestionBadge();
        if (questionQueue.length === 0) {
            closeQuestionPopup();
        } else {
            if (questionCurrentIndex >= questionQueue.length) questionCurrentIndex = 0;
            renderCurrentQuestion();
        }
    } catch(e) {
        showNotification('Failed to dismiss: ' + String(e), 'error');
    }
}

function closeQuestionPopup() {
    var overlay = document.getElementById('questionPopupOverlay');
    if (overlay) overlay.style.display = 'none';
}

function navigateToArea(area) {
    closeQuestionPopup();
    var lower = (area || '').toLowerCase();
    if (lower.indexOf('design') >= 0 || lower.indexOf('visual') >= 0) {
        switchToTab('planning');
    } else if (lower.indexOf('task') >= 0) {
        switchToTab('tasks');
    } else if (lower.indexOf('code') >= 0 || lower.indexOf('coding') >= 0) {
        switchToTab('coding');
    } else if (lower.indexOf('setting') >= 0) {
        switchToTab('settings');
    } else {
        switchToTab('planning');
    }
}

function updateQuestionBadge() {
    var count = questionQueue.length;
    var badgeEl = document.getElementById('badge-questions-nav');
    if (badgeEl) {
        badgeEl.textContent = count > 0 ? String(count) : '';
        // Pulse red if any P1 questions
        var hasP1 = questionQueue.some(function(q) { return q.priority === 'P1'; });
        badgeEl.className = 'tab-badge' + (count > 0 ? ' red' : '') + (hasP1 ? ' question-badge-pulse' : '');
    }
}

// ==================== PHASE PROGRESS INDICATOR (F7) ====================
var phaseData = null;

async function renderPhaseIndicator(planId) {
    if (!planId) return;
    var container = document.getElementById('phaseIndicatorContainer');
    if (!container) return;

    try {
        var result = await api('plans/' + planId + '/phase');
        phaseData = result;
    } catch(e) {
        // Phase endpoint may not exist yet, try to derive from plan data
        try {
            var plan = await api('plans/' + planId);
            phaseData = { current_phase: plan.phase || plan.status || 'planning', version: plan.version || '1.0', time_in_phase: '' };
        } catch(e2) {
            container.style.display = 'none';
            return;
        }
    }

    container.style.display = '';
    var currentPhase = (phaseData.current_phase || phaseData.phase || 'planning').toLowerCase();

    // Define stages and their phases
    var stages = [
        { label: 'Plan & Design', phases: ['planning', 'designing', 'design_review', 'designreview', 'task_generation', 'taskgeneration'] },
        { label: 'Code', phases: ['coding', 'design_update', 'designupdate'] },
        { label: 'Verify', phases: ['verification', 'complete', 'completed'] }
    ];

    // Determine which stage is current/complete
    var currentStageIdx = -1;
    var currentPhaseIdx = -1;
    for (var s = 0; s < stages.length; s++) {
        for (var p = 0; p < stages[s].phases.length; p++) {
            if (stages[s].phases[p] === currentPhase) {
                currentStageIdx = s;
                currentPhaseIdx = p;
                break;
            }
        }
        if (currentStageIdx >= 0) break;
    }
    if (currentStageIdx < 0) currentStageIdx = 0;

    var html = '<div class="phase-indicator">';
    html += '<div class="phase-header">';
    html += '<span class="phase-version">Version ' + esc(phaseData.version || '1.0') + '</span>';
    if (phaseData.time_in_phase) {
        html += '<span class="phase-time">In current phase: ' + esc(phaseData.time_in_phase) + '</span>';
    }
    html += '</div>';
    html += '<div class="phase-stages">';

    stages.forEach(function(stage, sIdx) {
        var stageState = sIdx < currentStageIdx ? 'done' : sIdx === currentStageIdx ? 'active' : '';
        html += '<div class="phase-stage">';
        html += '<div class="phase-stage-label ' + stageState + '">' + stage.label + '</div>';
        html += '<div class="phase-dots">';

        stage.phases.forEach(function(ph, pIdx) {
            var dotState = '';
            if (sIdx < currentStageIdx) {
                dotState = 'filled';
            } else if (sIdx === currentStageIdx) {
                if (pIdx < currentPhaseIdx) dotState = 'filled';
                else if (pIdx === currentPhaseIdx) dotState = 'current';
                else dotState = 'empty';
            } else {
                dotState = 'empty';
            }
            html += '<div class="phase-dot ' + dotState + '" title="' + esc(ph) + '"></div>';
            if (pIdx < stage.phases.length - 1) {
                var connDone = sIdx < currentStageIdx || (sIdx === currentStageIdx && pIdx < currentPhaseIdx);
                html += '<div class="phase-connector' + (connDone ? ' done' : '') + '"></div>';
            }
        });

        html += '</div></div>';
        if (sIdx < stages.length - 1) {
            var connDone = sIdx < currentStageIdx;
            html += '<div class="phase-connector' + (connDone ? ' done' : '') + '" style="min-width:20px"></div>';
        }
    });

    html += '</div>';

    // Approve Design button during design_review phase
    if (currentPhase === 'design_review' || currentPhase === 'designreview') {
        html += '<div class="phase-approve-bar">';
        html += '<span style="font-size:0.9em;color:var(--subtext)">Design is ready for review</span>';
        html += '<button class="btn btn-success btn-sm" onclick="approveDesignPhase(\\'' + planId + '\\')">Approve Design</button>';
        html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
}

async function approveDesignPhase(planId) {
    if (!confirm('Approve this design and move to the coding phase?')) return;
    try {
        await api('plans/' + planId + '/approve-design', { method: 'POST' });
        showNotification('Design approved! Moving to coding phase.', 'success');
        renderPhaseIndicator(planId);
    } catch(e) {
        showNotification('Approval failed: ' + String(e), 'error');
    }
}

// ==================== GUIDED TOUR (D4) ====================
function renderGuidedTour() {
    var container = document.getElementById('guidedTourContainer');
    if (!container) return;

    container.style.display = '';
    container.innerHTML = '<div class="guided-tour">' +
        '<h2>Welcome to COE</h2>' +
        '<p class="tour-subtitle">Your AI-powered development orchestrator. Let\\\'s build something great.</p>' +
        '<div class="tour-stages">' +
            '<div class="tour-stage">' +
                '<div class="tour-stage-num">1</div>' +
                '<div class="tour-stage-title">Plan & Design</div>' +
                '<div class="tour-stage-desc">Define your project, design the UI, set priorities. The AI helps generate tasks and review architecture.</div>' +
            '</div>' +
            '<div class="tour-stage">' +
                '<div class="tour-stage-num">2</div>' +
                '<div class="tour-stage-title">Code Implementation</div>' +
                '<div class="tour-stage-desc">AI coding agents pick up tasks one at a time via MCP. You review, provide feedback, iterate.</div>' +
            '</div>' +
            '<div class="tour-stage">' +
                '<div class="tour-stage-num">3</div>' +
                '<div class="tour-stage-title">Verification</div>' +
                '<div class="tour-stage-desc">Automated testing, design QA, and human verification ensure quality before completion.</div>' +
            '</div>' +
        '</div>' +
        '<button class="btn btn-primary" onclick="startFirstPlan()" style="padding:12px 32px;font-size:1em">Create Your First Plan</button>' +
    '</div>';
}

function startFirstPlan() {
    var container = document.getElementById('guidedTourContainer');
    if (container) container.style.display = 'none';
    var wizSection = document.getElementById('wizardSection');
    if (wizSection) wizSection.style.display = '';
    showCreatePlanWizard();
}

// ==================== SETTINGS PAGE ENHANCEMENTS (H/Step 34) ====================
function loadSettingsPage() {
    var nav = document.querySelector('.settings-nav');
    if (!nav) return;

    // Add new settings sections to nav if not already there
    var existingItems = nav.querySelectorAll('.settings-nav-item');
    var hasDesignQuality = false;
    var hasTicketProcessing = false;
    var hasBossAi = false;
    var hasClarity = false;
    existingItems.forEach(function(item) {
        if (item.dataset.settings === 'design-quality') hasDesignQuality = true;
        if (item.dataset.settings === 'ticket-processing') hasTicketProcessing = true;
        if (item.dataset.settings === 'boss-ai') hasBossAi = true;
        if (item.dataset.settings === 'clarity-agent') hasClarity = true;
    });

    // Insert new nav items before Advanced
    var advancedItem = nav.querySelector('[data-settings="advanced"]');
    if (!hasDesignQuality && advancedItem) {
        var dqItem = document.createElement('div');
        dqItem.className = 'settings-nav-item';
        dqItem.dataset.settings = 'design-quality';
        dqItem.textContent = 'Design Quality';
        dqItem.onclick = function() { showSettingsSection('design-quality'); };
        nav.insertBefore(dqItem, advancedItem);
    }
    if (!hasTicketProcessing && advancedItem) {
        var tpItem = document.createElement('div');
        tpItem.className = 'settings-nav-item';
        tpItem.dataset.settings = 'ticket-processing';
        tpItem.textContent = 'Ticket Processing';
        tpItem.onclick = function() { showSettingsSection('ticket-processing'); };
        nav.insertBefore(tpItem, advancedItem);
    }
    if (!hasBossAi && advancedItem) {
        var bItem = document.createElement('div');
        bItem.className = 'settings-nav-item';
        bItem.dataset.settings = 'boss-ai';
        bItem.textContent = 'Boss AI';
        bItem.onclick = function() { showSettingsSection('boss-ai'); };
        nav.insertBefore(bItem, advancedItem);
    }
    if (!hasClarity && advancedItem) {
        var cItem = document.createElement('div');
        cItem.className = 'settings-nav-item';
        cItem.dataset.settings = 'clarity-agent';
        cItem.textContent = 'Clarity Agent';
        cItem.onclick = function() { showSettingsSection('clarity-agent'); };
        nav.insertBefore(cItem, advancedItem);
    }
}

// ==================== SSE EVENT LISTENERS (D1-D3) ====================
var sseConnection = null;
var sseReconnectTimer = null;
var processingBannerPlanId = null;

function initSSE() {
    if (sseConnection) { try { sseConnection.close(); } catch(e) { /* ignore */ } }

    try {
        sseConnection = new EventSource(API.replace('/api', '') + '/events');
    } catch(e) {
        console.warn('SSE connection failed:', e);
        return;
    }

    sseConnection.onopen = function() {
        console.log('SSE connected');
        if (sseReconnectTimer) { clearTimeout(sseReconnectTimer); sseReconnectTimer = null; }
    };

    sseConnection.onerror = function() {
        console.warn('SSE connection error, reconnecting in 10s...');
        if (!sseReconnectTimer) {
            sseReconnectTimer = setTimeout(function() { sseReconnectTimer = null; initSSE(); }, 10000);
        }
    };

    // Plan events
    sseConnection.addEventListener('plan:tasks_generated', function(e) {
        loadTasks();
        showNotification('Tasks have been generated', 'success');
    });

    sseConnection.addEventListener('plan:config_updated', function(e) {
        var planId = currentDesignerPlanId || activePlanId;
        if (planId) loadPlans();
    });

    // Design events
    sseConnection.addEventListener('design:generated', function(e) {
        var planId = currentDesignerPlanId;
        if (planId && typeof loadDesignerForPlan === 'function') {
            loadDesignerForPlan(planId);
        }
    });

    sseConnection.addEventListener('design:draft_approved', function(e) {
        var planId = currentDesignerPlanId || activePlanId;
        if (planId) renderQAPanel(planId);
        showNotification('Design draft approved', 'success');
    });

    sseConnection.addEventListener('design:draft_rejected', function(e) {
        var planId = currentDesignerPlanId || activePlanId;
        if (planId) renderQAPanel(planId);
        showNotification('Design draft rejected', 'info');
    });

    // Ticket events
    sseConnection.addEventListener('ticket:resolved', function(e) {
        loadTickets();
        updateTabBadges();
    });

    sseConnection.addEventListener('ticket:replied', function(e) {
        loadTickets();
        updateTabBadges();
    });

    // Phase events
    sseConnection.addEventListener('phase:changed', function(e) {
        var planId = currentDesignerPlanId || activePlanId;
        if (planId) renderPhaseIndicator(planId);
        showNotification('Phase changed', 'info');
    });

    // Question events
    sseConnection.addEventListener('question:created', function(e) {
        var planId = currentDesignerPlanId || activePlanId;
        if (planId) {
            api('questions/queue?plan_id=' + encodeURIComponent(planId)).then(function(result) {
                questionQueue = Array.isArray(result) ? result : (result.questions || result.data || []);
                updateQuestionBadge();
            });
        }
    });

    // Ticket processing events
    sseConnection.addEventListener('ticket:processing_started', function(e) {
        showProcessingBanner(true, e.data);
    });

    sseConnection.addEventListener('ticket:processing_completed', function(e) {
        showProcessingBanner(false);
        loadTickets();
    });
}

function showProcessingBanner(show, data) {
    var existingBanner = document.getElementById('processingBanner');
    if (!show) {
        if (existingBanner) existingBanner.remove();
        return;
    }
    if (existingBanner) return; // Already showing

    var msg = 'Processing ticket...';
    if (data) {
        try { var parsed = JSON.parse(data); msg = 'Processing: ' + (parsed.title || parsed.ticket_id || 'ticket'); } catch(e) { /* ignore */ }
    }

    var banner = document.createElement('div');
    banner.id = 'processingBanner';
    banner.className = 'processing-banner';
    banner.innerHTML = '<span class="spinner"></span> ' + esc(msg);
    var mainEl = document.querySelector('.main');
    if (mainEl) mainEl.insertBefore(banner, mainEl.firstChild);
}

// ==================== DRAFT COMPONENT RENDERING (C4) ====================
// This enhances the existing renderDesignElement function to handle draft components

var _origRenderDesignElement = null;

function installDraftRendering() {
    // Check if already installed
    if (_origRenderDesignElement) return;

    // Wait for renderDesignElement to be defined
    if (typeof renderDesignElement !== 'function') {
        setTimeout(installDraftRendering, 500);
        return;
    }

    _origRenderDesignElement = renderDesignElement;

    // Override with draft-aware version
    renderDesignElement = function(comp) {
        var baseHtml = _origRenderDesignElement(comp);
        if (!comp.is_draft) return baseHtml;

        // Add draft classes and badge
        baseHtml = baseHtml.replace('class="design-el', 'class="design-el draft-component');

        // Insert draft badge and hover actions before the closing </div>
        var lastDivIdx = baseHtml.lastIndexOf('</div>');
        var draftInsert = '<div class="draft-badge">DRAFT</div>' +
            '<div class="draft-actions">' +
            '<button class="btn btn-sm btn-success" onclick="event.stopPropagation();approveDraftComponent(\\'' + comp.id + '\\')">Approve</button>' +
            '<button class="btn btn-sm btn-danger" onclick="event.stopPropagation();rejectDraftComponent(\\'' + comp.id + '\\')">Reject</button>' +
            '</div>';
        baseHtml = baseHtml.slice(0, lastDivIdx) + draftInsert + baseHtml.slice(lastDivIdx);

        return baseHtml;
    };
}

async function approveDraftComponent(compId) {
    try {
        await api('design/components/' + compId + '/approve', { method: 'POST' });
        showNotification('Component approved', 'success');
        if (dsgCurrentPageId) loadPageComponents(dsgCurrentPageId);
        var planId = currentDesignerPlanId || activePlanId;
        if (planId) renderQAPanel(planId);
    } catch(e) {
        showNotification('Approve failed: ' + String(e), 'error');
    }
}

async function rejectDraftComponent(compId) {
    try {
        await api('design/components/' + compId + '/reject', { method: 'POST' });
        showNotification('Component rejected', 'info');
        if (dsgCurrentPageId) loadPageComponents(dsgCurrentPageId);
        var planId = currentDesignerPlanId || activePlanId;
        if (planId) renderQAPanel(planId);
    } catch(e) {
        showNotification('Reject failed: ' + String(e), 'error');
    }
}

// ==================== INIT ====================
(function restoreState() {
    var savedTab = loadState('activeTab', 'dashboard');
    if (savedTab && savedTab !== 'dashboard') {
        switchToTab(savedTab);
    } else {
        loadDashboard();
    }
    // Restore designer if it was open
    var savedDesignerPlan = loadState('designerPlanId', null);
    if (savedDesignerPlan && savedTab === 'planning') {
        setTimeout(function() { loadDesignerForPlan(savedDesignerPlan); }, 300);
    }
    // Initialize SSE for live updates
    setTimeout(initSSE, 1000);
    // Install draft component rendering
    setTimeout(installDraftRendering, 500);
    // Load question badge count
    setTimeout(function() {
        var planId = loadState('activePlanId', null);
        if (planId) {
            api('questions/queue?plan_id=' + encodeURIComponent(planId)).then(function(result) {
                questionQueue = Array.isArray(result) ? result : (result.questions || result.data || []);
                updateQuestionBadge();
            }).catch(function() { /* ignore */ });
        }
    }, 1500);
})();
setInterval(() => {
    if (document.getElementById('page-dashboard').classList.contains('active')) loadDashboard();
}, 5000);

// ==================== GLOBAL AI LEVEL TOGGLE ====================
var currentAiLevel = loadState('aiLevel', 'suggestions') || 'suggestions';

function setGlobalAiLevel(level) {
    currentAiLevel = level;
    saveState('aiLevel', level);
    // Update toggle buttons in top nav
    document.querySelectorAll('#aiLevelToggle button').forEach(function(b) {
        b.classList.toggle('active', b.dataset.ai === level);
    });
    // Sync with wizard config if wizard is visible
    wizConfig.aiLevel = level;
    var aiGrid = document.querySelector('.design-grid[data-field="aiLevel"]');
    if (aiGrid) {
        aiGrid.querySelectorAll('.design-card').forEach(function(c) {
            c.classList.toggle('selected', c.dataset.val === level);
        });
    }
    // Update plan if we have one open
    if (pdPlanId || currentDesignerPlanId) {
        var planId = pdPlanId || currentDesignerPlanId;
        api('plans/' + planId, { method: 'PUT',
            body: { config_json: JSON.stringify(Object.assign({}, wizConfig, { aiLevel: level })) }
        });
    }
    // Update preview card
    var pvAI = document.getElementById('pvAI');
    if (pvAI) pvAI.textContent = level.charAt(0).toUpperCase() + level.slice(1);
    showNotification('AI level set to: ' + level, 'info');
}

// Restore AI level on page load
(function restoreAiLevel() {
    var saved = loadState('aiLevel', 'suggestions');
    if (saved) {
        currentAiLevel = saved;
        document.querySelectorAll('#aiLevelToggle button').forEach(function(b) {
            b.classList.toggle('active', b.dataset.ai === saved);
        });
    }
})();

// ==================== LIVE DESIGN PREVIEW ====================
var livePreviewVisible = false;
var livePreviewMinimized = false;
var livePreviewMode = 'wizard'; // 'wizard' or 'designer'
var livePreviewRefreshTimer = null;

function showLivePreview() {
    var panel = document.getElementById('livePreviewPanel');
    if (!panel) return;
    livePreviewVisible = true;
    livePreviewMinimized = false;
    panel.classList.remove('hidden');
    panel.classList.remove('minimized');
}

function closeLivePreview() {
    var panel = document.getElementById('livePreviewPanel');
    if (!panel) return;
    livePreviewVisible = false;
    panel.classList.add('hidden');
    if (livePreviewRefreshTimer) { clearInterval(livePreviewRefreshTimer); livePreviewRefreshTimer = null; }
}

function toggleMinimizePreview() {
    var panel = document.getElementById('livePreviewPanel');
    if (!panel) return;
    livePreviewMinimized = !livePreviewMinimized;
    panel.classList.toggle('minimized', livePreviewMinimized);
}

function updateLivePreview() {
    var bodyEl = document.getElementById('livePreviewBody');
    if (!bodyEl) return;

    // Check which mode we're in
    var designerSection = document.getElementById('designerSection');
    var wizSection = document.getElementById('wizardSection');
    var isDesigner = designerSection && designerSection.style.display !== 'none';
    var isWizard = wizSection && wizSection.style.display !== 'none';

    if (isDesigner) {
        livePreviewMode = 'designer';
        renderDesignerMinimap(bodyEl);
    } else if (isWizard) {
        livePreviewMode = 'wizard';
        renderWizardPreview(bodyEl);
    } else {
        bodyEl.innerHTML = '<div class="empty" style="font-size:0.8em">Open the wizard or designer to see live updates</div>';
    }
}

function renderWizardPreview(container) {
    var cfg = wizConfig;
    var layoutIcon = cfg.layout === 'tabs' ? 'Tabs' : cfg.layout === 'wizard' ? 'Wizard' : 'Sidebar';
    // Simple wireframe based on layout
    var wireframe = '<div class="lp-minimap" style="height:140px">';
    if (cfg.layout === 'sidebar') {
        wireframe += '<div style="position:absolute;left:0;top:0;bottom:0;width:25%;background:var(--overlay);border-right:1px solid var(--border)"></div>';
        wireframe += '<div style="position:absolute;left:27%;top:8%;width:68%;height:12%;background:var(--overlay);border-radius:3px"></div>';
        wireframe += '<div style="position:absolute;left:27%;top:24%;width:45%;height:8%;background:var(--overlay);border-radius:3px"></div>';
        wireframe += '<div style="position:absolute;left:27%;top:36%;width:68%;height:50%;background:var(--overlay);border-radius:3px"></div>';
    } else if (cfg.layout === 'tabs') {
        wireframe += '<div style="position:absolute;left:0;top:0;right:0;height:14%;background:var(--overlay);border-bottom:1px solid var(--border);display:flex;gap:2px;padding:2px 4px">';
        for (var i = 0; i < Math.min(4, (cfg.pages || []).length || 3); i++) {
            wireframe += '<div style="flex:1;background:' + (i === 0 ? 'var(--accent)' : 'var(--surface)') + ';border-radius:3px 3px 0 0"></div>';
        }
        wireframe += '</div>';
        wireframe += '<div style="position:absolute;left:5%;top:20%;width:90%;height:70%;background:var(--overlay);border-radius:3px"></div>';
    } else {
        wireframe += '<div style="position:absolute;left:10%;top:8%;width:80%;height:10%;background:var(--accent);border-radius:3px;opacity:0.3"></div>';
        wireframe += '<div style="position:absolute;left:10%;top:24%;width:80%;height:60%;background:var(--overlay);border-radius:3px"></div>';
        wireframe += '<div style="position:absolute;left:30%;top:88%;width:40%;height:8%;background:var(--accent);border-radius:3px;opacity:0.5"></div>';
    }
    wireframe += '<div class="lp-minimap-page">' + esc(cfg.name || 'Project') + ' | ' + layoutIcon + '</div>';
    wireframe += '</div>';

    container.innerHTML = wireframe +
        '<div class="lp-summary">' +
        '<span>' + (cfg.pages || []).length + ' pages</span>' +
        '<span>' + (cfg.features || []).length + ' features</span>' +
        '<span>' + esc(cfg.theme || 'dark') + '</span>' +
        '<span>' + esc(currentAiLevel) + '</span>' +
        '</div>' +
        '<div class="lp-row"><span class="lp-label">Scale</span><span class="lp-val">' + esc(cfg.scale || 'MVP') + '</span></div>' +
        '<div class="lp-row"><span class="lp-label">Tech</span><span class="lp-val">' + esc(cfg.techStack || 'React + Node') + '</span></div>' +
        '<div class="lp-row"><span class="lp-label">Est. Tasks</span><span class="lp-val">' + (document.getElementById('impTasks') ? document.getElementById('impTasks').textContent : '--') + '</span></div>';
}

function renderDesignerMinimap(container) {
    var previewW = 320;
    var previewH = 200;

    // Get current page components
    var comps = dsgComponents || [];
    var pageName = '';
    if (dsgCurrentPageId && dsgPages) {
        var pg = dsgPages.find(function(p) { return p.id === dsgCurrentPageId; });
        if (pg) pageName = pg.name || 'Page';
    }

    if (!comps.length) {
        container.innerHTML = '<div class="lp-minimap" style="height:' + previewH + 'px"><div class="lp-minimap-page">' + esc(pageName || 'No page selected') + ' | 0 components</div></div>' +
            '<div class="lp-summary"><span>Branch: ' + (currentDesignerBranch || 'live') + '</span></div>';
        return;
    }

    // Calculate bounds and scale
    var minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
    comps.forEach(function(c) {
        var x = parseInt(c.x) || 0;
        var y = parseInt(c.y) || 0;
        var w = parseInt(c.width) || 100;
        var h = parseInt(c.height) || 40;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x + w > maxX) maxX = x + w;
        if (y + h > maxY) maxY = y + h;
    });

    var contentW = Math.max(maxX - minX, 100);
    var contentH = Math.max(maxY - minY, 80);
    var padding = 16;
    var scaleX = (previewW - padding * 2) / contentW;
    var scaleY = (previewH - padding * 2 - 20) / contentH; // -20 for label bar
    var scale = Math.min(scaleX, scaleY, 1);

    var html = '<div class="lp-minimap" style="height:' + previewH + 'px">';
    comps.forEach(function(c) {
        var x = ((parseInt(c.x) || 0) - minX) * scale + padding;
        var y = ((parseInt(c.y) || 0) - minY) * scale + padding;
        var w = Math.max((parseInt(c.width) || 100) * scale, 8);
        var h = Math.max((parseInt(c.height) || 40) * scale, 6);
        var isSelected = c.id === dsgSelectedId;
        html += '<div class="lp-minimap-comp' + (isSelected ? ' selected' : '') + '" style="left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px">';
        if (w > 30) html += esc(c.type || '');
        html += '</div>';
    });
    html += '<div class="lp-minimap-page">' + esc(pageName) + ' | ' + comps.length + ' components</div>';
    html += '</div>';

    html += '<div class="lp-summary">';
    html += '<span>Branch: ' + (currentDesignerBranch || 'live') + '</span>';
    html += '<span>Changes: ' + (branchChangeCount || 0) + '</span>';
    html += '<span>Pages: ' + (dsgPages ? dsgPages.length : 0) + '</span>';
    html += '</div>';

    container.innerHTML = html;
}

// Auto-show live preview when wizard is visible, update every time config changes
var _origSyncWizConfig = syncWizConfig;
syncWizConfig = function() {
    _origSyncWizConfig();
    updateLivePreview();
    // Show live preview panel when wizard is active
    var wizSection = document.getElementById('wizardSection');
    if (wizSection && wizSection.style.display !== 'none') {
        if (!livePreviewVisible) {
            showLivePreview();
        }
    }
};

// Start auto-refresh for designer minimap
function startDesignerPreviewRefresh() {
    if (livePreviewRefreshTimer) clearInterval(livePreviewRefreshTimer);
    livePreviewRefreshTimer = setInterval(function() {
        if (livePreviewVisible && !livePreviewMinimized && livePreviewMode === 'designer') {
            updateLivePreview();
        }
    }, 2000);
}

// Auto-ticket creation for plan stages now handled in backend (POST /api/plans/generate)

// ==================== AI CHAT OVERLAY ====================
var aiChatSessionId = null;
var aiChatMinimized = false;
var aiChatVisible = false;
var aiChatDragState = null;

async function toggleAiChat() {
    aiChatVisible = !aiChatVisible;
    var overlay = document.getElementById('aiChatOverlay');
    var toggleBtn = document.getElementById('aiChatToggleBtn');
    if (!overlay) return;
    if (aiChatVisible) {
        overlay.classList.remove('hidden');
        aiChatMinimized = false;
        overlay.classList.remove('minimized');
        if (!aiChatSessionId) await initAiChatSession();
        updateAiChatContext();
        var input = document.getElementById('aiChatInput');
        if (input) input.focus();
    } else {
        overlay.classList.add('hidden');
    }
    if (toggleBtn) toggleBtn.classList.toggle('active', aiChatVisible);
}

function minimizeAiChat() {
    aiChatMinimized = !aiChatMinimized;
    var overlay = document.getElementById('aiChatOverlay');
    if (overlay) overlay.classList.toggle('minimized', aiChatMinimized);
}

async function initAiChatSession() {
    // Try to resume latest active session
    try {
        var listResp = await api('ai-chat/sessions?status=active');
        if (listResp.sessions && listResp.sessions.length > 0) {
            aiChatSessionId = listResp.sessions[0].id;
            loadAiChatMessages();
            return;
        }
    } catch(e) { /* ignore, create new */ }

    // Create new session
    try {
        var planId = currentDesignerPlanId || statusPlanId || null;
        var session = await api('ai-chat/sessions', {
            method: 'POST',
            body: { plan_id: planId, session_name: 'Chat ' + new Date().toLocaleTimeString() }
        });
        aiChatSessionId = session.id;
        addAiChatSystemMessage('AI chat session started. Ask me anything about your project.');
    } catch(e) {
        addAiChatSystemMessage('Failed to start chat session. Try again later.');
    }
}

function addAiChatSystemMessage(text) {
    var container = document.getElementById('aiChatMessages');
    if (!container) return;
    var div = document.createElement('div');
    div.className = 'ai-chat-msg system';
    div.innerHTML = '<div class="ai-chat-bubble">' + esc(text) + '</div>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

async function loadAiChatMessages() {
    if (!aiChatSessionId) return;
    try {
        var data = await api('ai-chat/sessions/' + aiChatSessionId + '/messages');
        var container = document.getElementById('aiChatMessages');
        if (!container) return;
        container.innerHTML = '';
        if (data.messages) {
            for (var i = 0; i < data.messages.length; i++) {
                var msg = data.messages[i];
                var cssClass = msg.role === 'user' ? 'user' : (msg.role === 'ai' ? 'ai' : 'system');
                var div = document.createElement('div');
                div.className = 'ai-chat-msg ' + cssClass;
                div.innerHTML = '<div class="ai-chat-bubble">' + esc(msg.content) + '</div>';
                container.appendChild(div);
            }
        }
        container.scrollTop = container.scrollHeight;
    } catch(e) {
        console.error('Failed to load chat messages:', e);
    }
}

async function sendAiChatMessage() {
    var input = document.getElementById('aiChatInput');
    if (!input) return;
    var content = input.value.trim();
    if (!content) return;
    // Ensure session exists — retry init if needed
    if (!aiChatSessionId) {
        await initAiChatSession();
        if (!aiChatSessionId) {
            addAiChatSystemMessage('Unable to create chat session. Check that the server is running.');
            return;
        }
    }

    var context = getAiChatContext();
    input.value = '';
    input.disabled = true;

    // Add user message immediately
    var container = document.getElementById('aiChatMessages');
    if (container) {
        var userDiv = document.createElement('div');
        userDiv.className = 'ai-chat-msg user';
        userDiv.innerHTML = '<div class="ai-chat-bubble">' + esc(content) + '</div>';
        container.appendChild(userDiv);
        // Add loading indicator
        var loadingDiv = document.createElement('div');
        loadingDiv.className = 'ai-chat-loading';
        loadingDiv.id = 'aiChatLoading';
        loadingDiv.textContent = 'Thinking...';
        container.appendChild(loadingDiv);
        container.scrollTop = container.scrollHeight;
    }

    try {
        var result = await api('ai-chat/sessions/' + aiChatSessionId + '/messages', {
            method: 'POST',
            body: { content: content, context: context, ai_level: currentAiLevel }
        });

        // Remove loading indicator
        var loading = document.getElementById('aiChatLoading');
        if (loading) loading.remove();

        // Add AI response if generated
        if (result.ai_response && container) {
            var aiDiv = document.createElement('div');
            aiDiv.className = 'ai-chat-msg ai';
            aiDiv.innerHTML = '<div class="ai-chat-bubble">' + esc(result.ai_response) + '</div>';
            container.appendChild(aiDiv);
            container.scrollTop = container.scrollHeight;
        }
    } catch(e) {
        var loading2 = document.getElementById('aiChatLoading');
        if (loading2) loading2.remove();
        addAiChatSystemMessage('Error: ' + String(e));
    }
    input.disabled = false;
    input.focus();
}

function getAiChatContext() {
    var activePage = document.querySelector('.page:not([style*="display: none"]):not([style*="display:none"])');
    var pageId = activePage ? activePage.id : 'unknown';
    var context = { page: pageId };
    // Check designer selection globals
    if (typeof selectedComponent !== 'undefined' && selectedComponent) {
        context.element_id = selectedComponent.id || selectedComponent;
        context.element_type = 'component';
    } else if (typeof selectedPageId !== 'undefined' && selectedPageId) {
        context.element_id = selectedPageId;
        context.element_type = 'page';
    }
    return context;
}

function updateAiChatContext() {
    var context = getAiChatContext();
    var el = document.getElementById('aiChatContext');
    if (!el) return;
    var label = (context.page || 'unknown').replace('page-', '');
    var text = 'Page: ' + label;
    if (context.element_type && context.element_id) {
        text += ' | ' + context.element_type + ' selected';
    }
    text += ' | AI: ' + (currentAiLevel || 'suggestions');
    el.textContent = text;
}

// Drag support
(function() {
    setTimeout(function() {
        var header = document.getElementById('aiChatHeader');
        var overlay = document.getElementById('aiChatOverlay');
        if (!header || !overlay) return;
        header.addEventListener('mousedown', function(e) {
            if (e.target.tagName === 'BUTTON') return;
            aiChatDragState = { x: e.clientX - overlay.offsetLeft, y: e.clientY - overlay.offsetTop };
            function onMove(ev) {
                if (!aiChatDragState) return;
                overlay.style.left = (ev.clientX - aiChatDragState.x) + 'px';
                overlay.style.top = (ev.clientY - aiChatDragState.y) + 'px';
                overlay.style.right = 'auto';
                overlay.style.bottom = 'auto';
            }
            function onUp() {
                aiChatDragState = null;
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }, 200);
})();

// Update context when tab changes — wrap switchToTab
var _origSwitchToTab = switchToTab;
switchToTab = function(pageName) {
    _origSwitchToTab(pageName);
    updateAiChatContext();
};
</script>

<!-- Live Preview Mini-Panel -->
<div class="live-preview-mini hidden" id="livePreviewPanel">
    <div class="live-preview-header" onclick="toggleMinimizePreview()">
        <span>Live Design Preview</span>
        <div class="live-preview-header-btns">
            <span onclick="event.stopPropagation();toggleMinimizePreview()" title="Minimize">_</span>
            <span onclick="event.stopPropagation();closeLivePreview()" title="Close">x</span>
        </div>
    </div>
    <div class="live-preview-body" id="livePreviewBody">
        <div class="empty" style="font-size:0.8em">Start the wizard or open the designer to see live updates</div>
    </div>
</div>

<!-- AI Chat Overlay -->
<div class="ai-chat-overlay hidden" id="aiChatOverlay">
    <div class="ai-chat-header" id="aiChatHeader">
        <span class="ai-chat-header-title">AI Assistant</span>
        <div class="ai-chat-header-btns">
            <button onclick="minimizeAiChat()" title="Minimize">_</button>
            <button onclick="toggleAiChat()" title="Close">&times;</button>
        </div>
    </div>
    <div class="ai-chat-context" id="aiChatContext">Initializing...</div>
    <div class="ai-chat-messages" id="aiChatMessages"></div>
    <div class="ai-chat-input-area">
        <input type="text" id="aiChatInput" placeholder="Ask the AI assistant..."
               onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendAiChatMessage();}">
        <button onclick="sendAiChatMessage()">Send</button>
    </div>
</div>

<!-- AI Chat Toggle Button -->
<button class="ai-chat-toggle-btn" id="aiChatToggleBtn" onclick="toggleAiChat()" title="AI Chat">
    &#x1F4AC;
</button>

<!-- Question Popup Overlay -->
<div class="question-popup-overlay" id="questionPopupOverlay" style="display:none">
    <div class="question-popup" id="questionPopupContent">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <h2 id="questionPopupTitle">Question</h2>
            <button style="background:none;border:none;color:var(--subtext);cursor:pointer;font-size:1.3em;padding:0 4px" onclick="closeQuestionPopup()">&times;</button>
        </div>
        <div class="q-position" id="questionPosition">Question 1 of 1</div>
        <div id="questionPopupBody"></div>
    </div>
</div>

</body>
</html>`;
}
