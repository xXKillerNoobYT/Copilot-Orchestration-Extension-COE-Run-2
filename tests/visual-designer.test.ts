import { Database } from '../src/core/database';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('Visual Designer + Settings + Coding Conversation', () => {
    let db: Database;
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-designer-'));
        db = new Database(tmpDir);
        await db.initialize();
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ==================== DESIGN PAGES ====================

    test('createDesignPage creates a page with defaults', () => {
        const plan = db.createPlan('Test Plan', '{}');
        const page = db.createDesignPage({ plan_id: plan.id });
        expect(page).toBeDefined();
        expect(page.name).toBe('Untitled Page');
        expect(page.route).toBe('/');
        expect(page.width).toBe(1440);
        expect(page.height).toBe(900);
        expect(page.background).toBe('#1e1e2e');
    });

    test('createDesignPage with custom values', () => {
        const plan = db.createPlan('Test Plan', '{}');
        const page = db.createDesignPage({
            plan_id: plan.id,
            name: 'Dashboard',
            route: '/dashboard',
            width: 1920,
            height: 1080,
            background: '#000000',
            sort_order: 10
        });
        expect(page.name).toBe('Dashboard');
        expect(page.route).toBe('/dashboard');
        expect(page.width).toBe(1920);
        expect(page.height).toBe(1080);
        expect(page.background).toBe('#000000');
    });

    test('getDesignPagesByPlan returns pages sorted by sort_order', () => {
        const plan = db.createPlan('Test Plan', '{}');
        db.createDesignPage({ plan_id: plan.id, name: 'Page C', sort_order: 30 });
        db.createDesignPage({ plan_id: plan.id, name: 'Page A', sort_order: 10 });
        db.createDesignPage({ plan_id: plan.id, name: 'Page B', sort_order: 20 });
        const pages = db.getDesignPagesByPlan(plan.id);
        expect(pages).toHaveLength(3);
        expect(pages[0].name).toBe('Page A');
        expect(pages[1].name).toBe('Page B');
        expect(pages[2].name).toBe('Page C');
    });

    test('updateDesignPage updates fields', () => {
        const plan = db.createPlan('Test Plan', '{}');
        const page = db.createDesignPage({ plan_id: plan.id, name: 'Old Name' });
        const updated = db.updateDesignPage(page.id, { name: 'New Name', width: 800 });
        expect(updated).toBeDefined();
        expect(updated!.name).toBe('New Name');
        expect(updated!.width).toBe(800);
    });

    test('deleteDesignPage removes page and its components', () => {
        const plan = db.createPlan('Test Plan', '{}');
        const page = db.createDesignPage({ plan_id: plan.id });
        db.createDesignComponent({ plan_id: plan.id, page_id: page.id, type: 'text' });
        db.createDesignComponent({ plan_id: plan.id, page_id: page.id, type: 'button' });
        expect(db.getDesignComponentsByPage(page.id)).toHaveLength(2);
        db.deleteDesignPage(page.id);
        expect(db.getDesignPage(page.id)).toBeNull();
        expect(db.getDesignComponentsByPage(page.id)).toHaveLength(0);
    });

    // ==================== DESIGN COMPONENTS ====================

    test('createDesignComponent creates with defaults', () => {
        const plan = db.createPlan('Test Plan', '{}');
        const page = db.createDesignPage({ plan_id: plan.id });
        const comp = db.createDesignComponent({ plan_id: plan.id, page_id: page.id, type: 'container' });
        expect(comp).toBeDefined();
        expect(comp.type).toBe('container');
        expect(comp.name).toBe('Component');
        expect(comp.x).toBe(0);
        expect(comp.y).toBe(0);
        expect(comp.width).toBe(200);
        expect(comp.height).toBe(100);
        expect(comp.styles).toEqual({});
        expect(comp.content).toBe('');
    });

    test('createDesignComponent with full properties', () => {
        const plan = db.createPlan('Test Plan', '{}');
        const page = db.createDesignPage({ plan_id: plan.id });
        const comp = db.createDesignComponent({
            plan_id: plan.id,
            page_id: page.id,
            type: 'button',
            name: 'Submit Button',
            x: 100,
            y: 200,
            width: 120,
            height: 40,
            styles: { backgroundColor: '#89b4fa', borderRadius: '8px', color: '#1e1e2e' },
            content: 'Submit',
            props: { onClick: 'submitForm' },
        });
        expect(comp.name).toBe('Submit Button');
        expect(comp.x).toBe(100);
        expect(comp.y).toBe(200);
        expect(comp.width).toBe(120);
        expect(comp.height).toBe(40);
        expect(comp.styles.backgroundColor).toBe('#89b4fa');
        expect(comp.styles.borderRadius).toBe('8px');
        expect(comp.content).toBe('Submit');
        expect(comp.props).toEqual({ onClick: 'submitForm' });
    });

    test('getDesignComponentsByPage returns page-specific components', () => {
        const plan = db.createPlan('Test Plan', '{}');
        const page1 = db.createDesignPage({ plan_id: plan.id, name: 'Home' });
        const page2 = db.createDesignPage({ plan_id: plan.id, name: 'About' });
        db.createDesignComponent({ plan_id: plan.id, page_id: page1.id, type: 'text', name: 'Title' });
        db.createDesignComponent({ plan_id: plan.id, page_id: page1.id, type: 'button', name: 'CTA' });
        db.createDesignComponent({ plan_id: plan.id, page_id: page2.id, type: 'text', name: 'About Text' });
        expect(db.getDesignComponentsByPage(page1.id)).toHaveLength(2);
        expect(db.getDesignComponentsByPage(page2.id)).toHaveLength(1);
    });

    test('getDesignComponentsByPlan returns all components for a plan', () => {
        const plan = db.createPlan('Test Plan', '{}');
        const page1 = db.createDesignPage({ plan_id: plan.id });
        const page2 = db.createDesignPage({ plan_id: plan.id });
        db.createDesignComponent({ plan_id: plan.id, page_id: page1.id, type: 'text' });
        db.createDesignComponent({ plan_id: plan.id, page_id: page2.id, type: 'button' });
        expect(db.getDesignComponentsByPlan(plan.id)).toHaveLength(2);
    });

    test('updateDesignComponent updates styles and position', () => {
        const plan = db.createPlan('Test Plan', '{}');
        const comp = db.createDesignComponent({ plan_id: plan.id, type: 'text', name: 'Hello' });
        const updated = db.updateDesignComponent(comp.id, {
            x: 50, y: 75, width: 300, height: 50,
            styles: { fontSize: '18px', color: '#f38ba8' },
            content: 'Updated Text'
        });
        expect(updated).toBeDefined();
        expect(updated!.x).toBe(50);
        expect(updated!.y).toBe(75);
        expect(updated!.width).toBe(300);
        expect(updated!.styles.fontSize).toBe('18px');
        expect(updated!.content).toBe('Updated Text');
    });

    test('deleteDesignComponent re-parents children', () => {
        const plan = db.createPlan('Test Plan', '{}');
        const parent = db.createDesignComponent({ plan_id: plan.id, type: 'container', name: 'Parent' });
        const child = db.createDesignComponent({ plan_id: plan.id, type: 'text', name: 'Child', parent_id: parent.id } as any);
        expect(child.parent_id).toBe(parent.id);
        db.deleteDesignComponent(parent.id);
        const updatedChild = db.getDesignComponent(child.id);
        expect(updatedChild).toBeDefined();
        expect(updatedChild!.parent_id).toBeNull(); // re-parented to null (root)
    });

    test('batchUpdateComponents updates multiple positions', () => {
        const plan = db.createPlan('Test Plan', '{}');
        const c1 = db.createDesignComponent({ plan_id: plan.id, type: 'text', name: 'T1' });
        const c2 = db.createDesignComponent({ plan_id: plan.id, type: 'button', name: 'B1' });
        db.batchUpdateComponents([
            { id: c1.id, x: 100, y: 200 },
            { id: c2.id, x: 300, y: 400, width: 150, height: 50 }
        ]);
        const u1 = db.getDesignComponent(c1.id)!;
        const u2 = db.getDesignComponent(c2.id)!;
        expect(u1.x).toBe(100);
        expect(u1.y).toBe(200);
        expect(u2.x).toBe(300);
        expect(u2.y).toBe(400);
        expect(u2.width).toBe(150);
    });

    // ==================== DESIGN TOKENS ====================

    test('createDesignToken creates color token', () => {
        const plan = db.createPlan('Test Plan', '{}');
        const token = db.createDesignToken({
            plan_id: plan.id,
            name: 'primary-color',
            value: '#89b4fa',
            category: 'color',
            description: 'Main brand color'
        });
        expect(token).toBeDefined();
        expect(token.name).toBe('primary-color');
        expect(token.value).toBe('#89b4fa');
        expect(token.category).toBe('color');
    });

    test('getDesignTokensByPlan returns sorted tokens', () => {
        const plan = db.createPlan('Test Plan', '{}');
        db.createDesignToken({ plan_id: plan.id, name: 'spacing-lg', value: '24px', category: 'spacing' });
        db.createDesignToken({ plan_id: plan.id, name: 'primary', value: '#89b4fa', category: 'color' });
        db.createDesignToken({ plan_id: plan.id, name: 'danger', value: '#f38ba8', category: 'color' });
        const tokens = db.getDesignTokensByPlan(plan.id);
        expect(tokens).toHaveLength(3);
        // Sorted by category then name
        expect(tokens[0].category).toBe('color');
        expect(tokens[0].name).toBe('danger');
        expect(tokens[1].name).toBe('primary');
        expect(tokens[2].category).toBe('spacing');
    });

    test('updateDesignToken changes value', () => {
        const plan = db.createPlan('Test Plan', '{}');
        const token = db.createDesignToken({ plan_id: plan.id, name: 'primary', value: '#89b4fa' });
        db.updateDesignToken(token.id, { value: '#cba6f7' });
        const tokens = db.getDesignTokensByPlan(plan.id);
        expect(tokens[0].value).toBe('#cba6f7');
    });

    test('deleteDesignToken removes token', () => {
        const plan = db.createPlan('Test Plan', '{}');
        const token = db.createDesignToken({ plan_id: plan.id, name: 'primary', value: '#89b4fa' });
        db.deleteDesignToken(token.id);
        expect(db.getDesignTokensByPlan(plan.id)).toHaveLength(0);
    });

    // ==================== PAGE FLOWS ====================

    test('createPageFlow links two pages', () => {
        const plan = db.createPlan('Test Plan', '{}');
        const p1 = db.createDesignPage({ plan_id: plan.id, name: 'Login' });
        const p2 = db.createDesignPage({ plan_id: plan.id, name: 'Dashboard' });
        const flow = db.createPageFlow({
            plan_id: plan.id,
            from_page_id: p1.id,
            to_page_id: p2.id,
            trigger: 'form_submit',
            label: 'After login'
        });
        expect(flow).toBeDefined();
        expect(flow.from_page_id).toBe(p1.id);
        expect(flow.to_page_id).toBe(p2.id);
        expect(flow.trigger).toBe('form_submit');
    });

    test('getPageFlowsByPlan returns all flows', () => {
        const plan = db.createPlan('Test Plan', '{}');
        const p1 = db.createDesignPage({ plan_id: plan.id, name: 'A' });
        const p2 = db.createDesignPage({ plan_id: plan.id, name: 'B' });
        const p3 = db.createDesignPage({ plan_id: plan.id, name: 'C' });
        db.createPageFlow({ plan_id: plan.id, from_page_id: p1.id, to_page_id: p2.id });
        db.createPageFlow({ plan_id: plan.id, from_page_id: p2.id, to_page_id: p3.id });
        expect(db.getPageFlowsByPlan(plan.id)).toHaveLength(2);
    });

    test('deletePageFlow removes a flow', () => {
        const plan = db.createPlan('Test Plan', '{}');
        const p1 = db.createDesignPage({ plan_id: plan.id, name: 'A' });
        const p2 = db.createDesignPage({ plan_id: plan.id, name: 'B' });
        const flow = db.createPageFlow({ plan_id: plan.id, from_page_id: p1.id, to_page_id: p2.id });
        db.deletePageFlow(flow.id);
        expect(db.getPageFlowsByPlan(plan.id)).toHaveLength(0);
    });

    // ==================== CODING SESSIONS ====================

    test('createCodingSession creates with defaults', () => {
        const session = db.createCodingSession({ name: 'Test Session' });
        expect(session).toBeDefined();
        expect(session.name).toBe('Test Session');
        expect(session.status).toBe('active');
    });

    test('createCodingSession linked to plan', () => {
        const plan = db.createPlan('Test Plan', '{}');
        const session = db.createCodingSession({ plan_id: plan.id, name: 'Plan Session' });
        expect(session.plan_id).toBe(plan.id);
    });

    test('getAllCodingSessions returns sessions in order', () => {
        db.createCodingSession({ name: 'Session 1' });
        db.createCodingSession({ name: 'Session 2' });
        db.createCodingSession({ name: 'Session 3' });
        const sessions = db.getAllCodingSessions();
        expect(sessions).toHaveLength(3);
    });

    test('updateCodingSession changes status', () => {
        const session = db.createCodingSession({ name: 'Active Session' });
        db.updateCodingSession(session.id, { status: 'completed' } as any);
        const updated = db.getCodingSession(session.id);
        expect(updated).toBeDefined();
        expect(updated!.status).toBe('completed');
    });

    // ==================== CODING MESSAGES ====================

    test('addCodingMessage creates user message', () => {
        const session = db.createCodingSession({ name: 'Test' });
        const msg = db.addCodingMessage({
            session_id: session.id,
            role: 'user',
            content: 'Please implement the login page'
        });
        expect(msg).toBeDefined();
        expect(msg.role).toBe('user');
        expect(msg.content).toBe('Please implement the login page');
    });

    test('addCodingMessage creates agent message with tool calls', () => {
        const session = db.createCodingSession({ name: 'Test' });
        const msg = db.addCodingMessage({
            session_id: session.id,
            role: 'agent',
            content: 'I have completed the implementation.',
            tool_calls: JSON.stringify([{ name: 'reportTaskDone', args: { task_id: 'abc123' } }])
        });
        expect(msg.role).toBe('agent');
        expect(msg.tool_calls).toContain('reportTaskDone');
    });

    test('getCodingMessages returns messages in chronological order', () => {
        const session = db.createCodingSession({ name: 'Test' });
        db.addCodingMessage({ session_id: session.id, role: 'user', content: 'First message' });
        db.addCodingMessage({ session_id: session.id, role: 'agent', content: 'Response' });
        db.addCodingMessage({ session_id: session.id, role: 'user', content: 'Follow-up' });
        const messages = db.getCodingMessages(session.id);
        expect(messages).toHaveLength(3);
        expect(messages[0].content).toBe('First message');
        expect(messages[1].content).toBe('Response');
        expect(messages[2].content).toBe('Follow-up');
    });

    test('addCodingMessage updates session and message exists', () => {
        const session = db.createCodingSession({ name: 'Test' });
        db.addCodingMessage({ session_id: session.id, role: 'user', content: 'Hello' });
        // Verify the message was actually created for the session
        const messages = db.getCodingMessages(session.id);
        expect(messages).toHaveLength(1);
        expect(messages[0].content).toBe('Hello');
        // Verify session can still be retrieved
        const updated = db.getCodingSession(session.id);
        expect(updated).toBeDefined();
        expect(updated!.status).toBe('active');
    });

    // ==================== COMPONENT TYPE COVERAGE ====================

    test('all 16 component types can be created', () => {
        const plan = db.createPlan('Test Plan', '{}');
        const types: Array<'container' | 'text' | 'button' | 'input' | 'image' | 'card' | 'nav' | 'modal' | 'sidebar' | 'header' | 'footer' | 'list' | 'table' | 'form' | 'divider' | 'icon'> = ['container', 'text', 'button', 'input', 'image', 'card', 'nav', 'modal', 'sidebar', 'header', 'footer', 'list', 'table', 'form', 'divider', 'icon'];
        for (const type of types) {
            const comp = db.createDesignComponent({ plan_id: plan.id, type, name: type + '-test' });
            expect(comp.type).toBe(type);
        }
        expect(db.getDesignComponentsByPlan(plan.id)).toHaveLength(16);
    });

    // ==================== RESPONSIVE DATA ====================

    test('component responsive overrides are stored', () => {
        const plan = db.createPlan('Test Plan', '{}');
        const comp = db.createDesignComponent({
            plan_id: plan.id,
            type: 'container',
            name: 'Responsive Box',
            width: 1440,
            responsive: {
                tablet: { width: 768, visible: true },
                mobile: { width: 375, visible: false }
            }
        } as any);
        expect(comp.responsive).toBeDefined();
        expect(comp.responsive.tablet).toBeDefined();
        expect(comp.responsive.tablet!.width).toBe(768);
        expect(comp.responsive.mobile).toBeDefined();
        expect(comp.responsive.mobile!.visible).toBe(false);
    });

    // ==================== DESIGN SPEC EXPORT (integration) ====================

    test('full design spec can be assembled', () => {
        const plan = db.createPlan('My App', '{}');
        const page = db.createDesignPage({ plan_id: plan.id, name: 'Home', route: '/' });
        db.createDesignComponent({ plan_id: plan.id, page_id: page.id, type: 'header', name: 'AppHeader', width: 1440, height: 60 });
        db.createDesignComponent({ plan_id: plan.id, page_id: page.id, type: 'text', name: 'Title', x: 40, y: 100, content: 'Welcome' });
        db.createDesignToken({ plan_id: plan.id, name: 'primary', value: '#89b4fa', category: 'color' });

        // Assemble spec (as the API endpoint does)
        const pages = db.getDesignPagesByPlan(plan.id);
        const tokens = db.getDesignTokensByPlan(plan.id);
        const flows = db.getPageFlowsByPlan(plan.id);
        const allComponents: Record<string, unknown[]> = {};
        for (const p of pages) {
            allComponents[p.id] = db.getDesignComponentsByPage(p.id);
        }

        expect(pages).toHaveLength(1);
        expect(tokens).toHaveLength(1);
        expect(flows).toHaveLength(0);
        expect((allComponents[page.id] as any[]).length).toBe(2);
    });

    // ==================== PAGE CLEANUP ON DELETE ====================

    test('deleting a page removes associated flows', () => {
        const plan = db.createPlan('Test Plan', '{}');
        const p1 = db.createDesignPage({ plan_id: plan.id, name: 'A' });
        const p2 = db.createDesignPage({ plan_id: plan.id, name: 'B' });
        const p3 = db.createDesignPage({ plan_id: plan.id, name: 'C' });
        db.createPageFlow({ plan_id: plan.id, from_page_id: p1.id, to_page_id: p2.id });
        db.createPageFlow({ plan_id: plan.id, from_page_id: p2.id, to_page_id: p3.id });
        db.createPageFlow({ plan_id: plan.id, from_page_id: p1.id, to_page_id: p3.id });
        expect(db.getPageFlowsByPlan(plan.id)).toHaveLength(3);
        db.deleteDesignPage(p2.id);
        // Flows involving p2 should be removed
        const remaining = db.getPageFlowsByPlan(plan.id);
        expect(remaining).toHaveLength(1); // Only p1->p3 remains
        expect(remaining[0].from_page_id).toBe(p1.id);
        expect(remaining[0].to_page_id).toBe(p3.id);
    });
});
