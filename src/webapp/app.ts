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
    <div class="section">
        <h2>Create New Plan</h2>
        <div class="wizard-steps">
            <div class="wizard-dot active" id="wdot0"></div>
            <div class="wizard-dot" id="wdot1"></div>
            <div class="wizard-dot" id="wdot2"></div>
            <div class="wizard-dot" id="wdot3"></div>
        </div>
        <div class="wizard-step active" id="wstep0">
            <div class="form-group"><label>Plan Name</label><input type="text" id="wizName" placeholder="e.g., My Web App MVP"></div>
            <div class="form-group"><label>Description</label><textarea id="wizDesc" placeholder="Describe what you want to build..."></textarea></div>
            <div class="btn-row">
                <button class="btn btn-primary" onclick="wizNext(1)">Next</button>
                <button class="btn btn-secondary" onclick="wizQuick()">Quick Generate</button>
            </div>
        </div>
        <div class="wizard-step" id="wstep1">
            <label>Project Scale</label>
            <div class="option-grid" id="scaleOptions">
                <div class="option-btn selected" data-val="MVP">MVP</div>
                <div class="option-btn" data-val="Small">Small</div>
                <div class="option-btn" data-val="Medium">Medium</div>
                <div class="option-btn" data-val="Large">Large</div>
                <div class="option-btn" data-val="Enterprise">Enterprise</div>
            </div>
            <div class="btn-row"><button class="btn btn-secondary" onclick="wizPrev(0)">Back</button><button class="btn btn-primary" onclick="wizNext(2)">Next</button></div>
        </div>
        <div class="wizard-step" id="wstep2">
            <label>Primary Focus</label>
            <div class="option-grid" id="focusOptions">
                <div class="option-btn selected" data-val="Frontend">Frontend</div>
                <div class="option-btn" data-val="Backend">Backend</div>
                <div class="option-btn" data-val="Full Stack">Full Stack</div>
            </div>
            <div class="btn-row"><button class="btn btn-secondary" onclick="wizPrev(1)">Back</button><button class="btn btn-primary" onclick="wizNext(3)">Next</button></div>
        </div>
        <div class="wizard-step" id="wstep3">
            <label>Key Priorities (click to select)</label>
            <div class="option-grid" id="priorityOptions">
                <div class="option-btn selected" data-val="Core business logic">Core logic</div>
                <div class="option-btn" data-val="User authentication">Auth</div>
                <div class="option-btn" data-val="Visual design & UX">Design/UX</div>
                <div class="option-btn" data-val="Scalability & performance">Performance</div>
                <div class="option-btn" data-val="Third-party integrations">Integrations</div>
                <div class="option-btn" data-val="Testing & QA">Testing</div>
                <div class="option-btn" data-val="Documentation">Docs</div>
            </div>
            <div class="btn-row"><button class="btn btn-secondary" onclick="wizPrev(2)">Back</button><button class="btn btn-primary" onclick="wizGenerate()">Generate Plan</button></div>
        </div>
        <div id="wizOutput" style="margin-top:16px;display:none"></div>
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
        <div class="form-group"><label>Title</label><input type="text" id="newTaskTitle" placeholder="Task title"></div>
        <div class="form-group"><label>Description</label><textarea id="newTaskDesc" placeholder="What needs to be done..."></textarea></div>
        <div class="form-group"><label>Priority</label><select id="newTaskPrio"><option value="P1">P1 — Must Have</option><option value="P2" selected>P2 — Should Have</option><option value="P3">P3 — Nice to Have</option></select></div>
        <div class="form-group"><label>Estimated Minutes</label><input type="number" id="newTaskEst" value="30" min="5" max="480"></div>
        <div class="form-group"><label>Acceptance Criteria</label><textarea id="newTaskAC" placeholder="How do we know this is done?"></textarea></div>
        <div class="btn-row"><button class="btn btn-primary" onclick="createTask()">Create Task</button></div>
    </div>
</div>

<div class="modal-overlay" id="ticketModal">
    <div class="modal">
        <button class="modal-close" onclick="closeModal('ticketModal')">&times;</button>
        <h2>Create Ticket</h2>
        <div class="form-group"><label>Title</label><input type="text" id="newTicketTitle" placeholder="Question or issue..."></div>
        <div class="form-group"><label>Description</label><textarea id="newTicketBody" placeholder="Details..."></textarea></div>
        <div class="form-group"><label>Priority</label><select id="newTicketPrio"><option value="P1">P1</option><option value="P2" selected>P2</option><option value="P3">P3</option></select></div>
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
    return res.json();
}

function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
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
        let tasks = await api('tasks');
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
        const tickets = await api('tickets');
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

// ==================== PLANNING ====================
function wizNext(n) {
    if (n === 1 && !document.getElementById('wizName').value.trim()) { document.getElementById('wizName').focus(); return; }
    document.getElementById('wstep' + wizStep).classList.remove('active');
    document.getElementById('wstep' + n).classList.add('active');
    document.getElementById('wdot' + wizStep).classList.remove('active');
    document.getElementById('wdot' + wizStep).classList.add('done');
    document.getElementById('wdot' + n).classList.add('active');
    wizStep = n;
}
function wizPrev(n) {
    document.getElementById('wstep' + wizStep).classList.remove('active');
    document.getElementById('wstep' + n).classList.add('active');
    document.getElementById('wdot' + wizStep).classList.remove('active');
    document.getElementById('wdot' + n).classList.add('active');
    document.getElementById('wdot' + n).classList.remove('done');
    wizStep = n;
}

// Option button selection
document.querySelectorAll('#scaleOptions .option-btn, #focusOptions .option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        btn.parentElement.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
    });
});
document.querySelectorAll('#priorityOptions .option-btn').forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('selected'));
});

async function wizGenerate() {
    const name = document.getElementById('wizName').value.trim();
    const desc = document.getElementById('wizDesc').value.trim();
    const scale = document.querySelector('#scaleOptions .selected')?.dataset.val || 'MVP';
    const focus = document.querySelector('#focusOptions .selected')?.dataset.val || 'Full Stack';
    const priorities = [...document.querySelectorAll('#priorityOptions .selected')].map(b => b.dataset.val);
    const out = document.getElementById('wizOutput');
    out.style.display = '';
    out.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Generating plan with AI... This may take a moment.</div>';
    try {
        const data = await api('plans/generate', { method: 'POST', body: { name, description: desc, scale, focus, priorities } });
        if (data.taskCount) {
            out.innerHTML = '<div class="detail-panel"><h3>Plan "' + esc(name) + '" created!</h3><p>' + data.taskCount + ' tasks generated.</p></div>';
            loadPlans();
        } else if (data.raw_response) {
            out.innerHTML = '<div class="detail-panel"><pre style="white-space:pre-wrap;color:var(--subtext)">' + esc(data.raw_response) + '</pre></div>';
        } else {
            out.innerHTML = '<div class="detail-panel" style="color:var(--red)">Unexpected response</div>';
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
        if (data.taskCount) {
            out.innerHTML = '<div class="detail-panel"><h3>Plan "' + esc(name) + '" created!</h3><p>' + data.taskCount + ' tasks generated.</p></div>';
            loadPlans();
        } else {
            out.innerHTML = '<div class="detail-panel"><pre style="white-space:pre-wrap;color:var(--subtext)">' + esc(JSON.stringify(data, null, 2)) + '</pre></div>';
        }
    } catch (err) {
        out.innerHTML = '<div class="detail-panel" style="color:var(--red)">Error: ' + esc(String(err)) + '</div>';
    }
}

async function loadPlans() {
    try {
        const plans = await api('plans');
        document.getElementById('plansList').innerHTML = plans.length ? '<table><thead><tr><th>Name</th><th>Status</th><th>Created</th></tr></thead><tbody>' +
            plans.map(p => '<tr><td class="clickable" onclick="showPlanDetail(\\'' + p.id + '\\')">' + esc(p.name) + '</td><td>' + statusBadge(p.status) + '</td><td>' + esc(p.created_at) + '</td></tr>').join('') +
            '</tbody></table>' : '<div class="empty">No plans yet. Create one above.</div>';
    } catch (err) {
        document.getElementById('plansList').innerHTML = '<div class="empty">Error: ' + esc(String(err)) + '</div>';
    }
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
        (data.status === 'draft' ? '<div class="btn-row"><button class="btn btn-primary" onclick="activatePlan(\\'' + id + '\\')">Activate Plan</button></div>' : '') +
        '</div>';
}

async function activatePlan(id) {
    await api('plans/' + id, { method: 'PUT', body: { status: 'active' } });
    loadPlans();
    loadDashboard();
}

// ==================== AGENTS ====================
async function loadAgents() {
    try {
        const agents = await api('agents');
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
        const log = await api('audit');
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
        const log = await api('evolution');
        document.getElementById('sysEvolution').innerHTML = log.length ? '<table><thead><tr><th>Pattern</th><th>Proposal</th><th>Status</th><th>Result</th></tr></thead><tbody>' +
            log.map(e => '<tr><td>' + esc(e.pattern) + '</td><td>' + esc(e.proposal) + '</td><td>' + statusBadge(e.status) + '</td><td>' + esc(e.result || '—') + '</td></tr>').join('') +
            '</tbody></table>' : '<div class="empty">No evolution entries yet</div>';
    } catch (err) {
        document.getElementById('sysEvolution').innerHTML = '<div class="empty">Error: ' + esc(String(err)) + '</div>';
    }
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
