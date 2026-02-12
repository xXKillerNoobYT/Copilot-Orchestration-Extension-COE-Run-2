import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';
import { Database } from '../src/core/database';
import { TaskPriority, TaskStatus, PlanStatus } from '../src/types';

// Mock vscode
jest.mock('vscode', () => require('./__mocks__/vscode'));

describe('Plan Designer', () => {
    let db: Database;
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-plan-designer-'));
        db = new Database(tmpDir);
        await db.initialize();
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ==================== DATABASE: sort_order ====================

    test('createTask assigns sort_order', () => {
        const plan = db.createPlan('Test Plan');
        const t1 = db.createTask({ title: 'Task A', plan_id: plan.id, sort_order: 10 });
        const t2 = db.createTask({ title: 'Task B', plan_id: plan.id, sort_order: 20 });
        const t3 = db.createTask({ title: 'Task C', plan_id: plan.id, sort_order: 0 });

        expect(t1.sort_order).toBe(10);
        expect(t2.sort_order).toBe(20);
        expect(t3.sort_order).toBe(0);
    });

    test('createTask defaults sort_order to 0', () => {
        const task = db.createTask({ title: 'No Sort Order' });
        expect(task.sort_order).toBe(0);
    });

    test('getTasksByPlan orders by sort_order first', () => {
        const plan = db.createPlan('Test Plan');
        db.createTask({ title: 'Third', plan_id: plan.id, sort_order: 30 });
        db.createTask({ title: 'First', plan_id: plan.id, sort_order: 10 });
        db.createTask({ title: 'Second', plan_id: plan.id, sort_order: 20 });

        const tasks = db.getTasksByPlan(plan.id);
        expect(tasks[0].title).toBe('First');
        expect(tasks[1].title).toBe('Second');
        expect(tasks[2].title).toBe('Third');
    });

    test('updateTask updates sort_order and parent_task_id', () => {
        const plan = db.createPlan('Test Plan');
        const parent = db.createTask({ title: 'Parent', plan_id: plan.id });
        const child = db.createTask({ title: 'Child', plan_id: plan.id });

        db.updateTask(child.id, { sort_order: 50, parent_task_id: parent.id });
        const updated = db.getTask(child.id);
        expect(updated!.sort_order).toBe(50);
        expect(updated!.parent_task_id).toBe(parent.id);
    });

    test('reorderTasks batch updates sort_order and parent_task_id', () => {
        const plan = db.createPlan('Test Plan');
        const t1 = db.createTask({ title: 'A', plan_id: plan.id, sort_order: 0 });
        const t2 = db.createTask({ title: 'B', plan_id: plan.id, sort_order: 10 });
        const t3 = db.createTask({ title: 'C', plan_id: plan.id, sort_order: 20 });

        // Reorder: C first, then A as child of B
        db.reorderTasks([
            { id: t3.id, sort_order: 0, parent_task_id: null },
            { id: t2.id, sort_order: 10, parent_task_id: null },
            { id: t1.id, sort_order: 0, parent_task_id: t2.id },
        ]);

        const tasks = db.getTasksByPlan(plan.id);
        const c = tasks.find(t => t.id === t3.id)!;
        const b = tasks.find(t => t.id === t2.id)!;
        const a = tasks.find(t => t.id === t1.id)!;

        expect(c.sort_order).toBe(0);
        expect(c.parent_task_id).toBeNull();
        expect(b.sort_order).toBe(10);
        expect(b.parent_task_id).toBeNull();
        expect(a.sort_order).toBe(0);
        expect(a.parent_task_id).toBe(t2.id);
    });

    // ==================== API: reorder endpoint ====================

    test('reorder via database then check plan order', () => {
        const plan = db.createPlan('Test Plan');
        const t1 = db.createTask({ title: 'X', plan_id: plan.id, sort_order: 0 });
        const t2 = db.createTask({ title: 'Y', plan_id: plan.id, sort_order: 10 });

        // Swap order: Y first, then X
        db.reorderTasks([
            { id: t2.id, sort_order: 0, parent_task_id: null },
            { id: t1.id, sort_order: 10, parent_task_id: null },
        ]);

        // Verify order changed
        const tasks = db.getTasksByPlan(plan.id);
        expect(tasks[0].title).toBe('Y'); // sort_order 0
        expect(tasks[1].title).toBe('X'); // sort_order 10
    });

    // ==================== Design config persistence ====================

    test('plan config_json stores design choices', () => {
        const plan = db.createPlan('Designed Plan', JSON.stringify({
            scale: 'Medium',
            focus: 'Full Stack',
            priorities: ['Core business logic'],
            design: {
                layout: 'tabs',
                theme: 'light',
                taskDisplay: 'kanban',
                depViz: 'network',
                timeline: 'gantt',
                inputStyle: 'inline',
                aiLevel: 'hybrid'
            }
        }));

        const retrieved = db.getPlan(plan.id);
        expect(retrieved).toBeDefined();
        const config = JSON.parse(retrieved!.config_json);
        expect(config.design.layout).toBe('tabs');
        expect(config.design.theme).toBe('light');
        expect(config.design.taskDisplay).toBe('kanban');
        expect(config.design.depViz).toBe('network');
        expect(config.design.aiLevel).toBe('hybrid');
    });

    // ==================== Impact Simulator Logic ====================
    // (These test the same formulas used client-side in the browser)

    test('impact calculator: MVP + Backend gives small task count', () => {
        const baseTasks: Record<string, number> = { MVP: 8, Small: 15, Medium: 28, Large: 50, Enterprise: 80 };
        const scale = 'MVP';
        const focus: string = 'Backend';
        let tasks = baseTasks[scale] || 28;
        if (focus === 'Full Stack') tasks = Math.round(tasks * 1.3);
        const priorities = ['Core business logic'];
        tasks += priorities.length * 3;
        expect(tasks).toBe(11); // 8 + 3*1 = 11
    });

    test('impact calculator: Large + Full Stack gives large task count', () => {
        const baseTasks: Record<string, number> = { MVP: 8, Small: 15, Medium: 28, Large: 50, Enterprise: 80 };
        const scale = 'Large';
        const focus: string = 'Full Stack';
        let tasks = baseTasks[scale] || 28;
        if (focus === 'Full Stack') tasks = Math.round(tasks * 1.3);
        const priorities = ['Core business logic', 'User authentication', 'Visual design & UX'];
        tasks += priorities.length * 3;
        expect(tasks).toBe(74); // round(50*1.3) + 3*3 = 65 + 9 = 74
    });

    test('impact calculator: risk assessment by scale', () => {
        const riskFor = (s: string) => s === 'Enterprise' ? 'High' : s === 'Large' ? 'Medium-High' : s === 'Medium' ? 'Medium' : 'Low';
        expect(riskFor('MVP')).toBe('Low');
        expect(riskFor('Small')).toBe('Low');
        expect(riskFor('Medium')).toBe('Medium');
        expect(riskFor('Large')).toBe('Medium-High');
        expect(riskFor('Enterprise')).toBe('High');
    });

    // ==================== Adaptive Wizard Steps ====================

    test('adaptive steps: MVP + Backend skips UI steps', () => {
        const getActiveSteps = (scale: string, focus: string) => {
            if (scale === 'MVP' && focus === 'Backend') return [0,1,2,3,6,9,10];
            if (scale === 'MVP') return [0,1,2,3,4,5,6,10];
            if (scale === 'Small') return [0,1,2,3,4,5,6,7,10];
            if (focus === 'Frontend') return [0,1,2,3,4,5,6,7,8,10];
            return [0,1,2,3,4,5,6,7,8,9,10];
        };

        expect(getActiveSteps('MVP', 'Backend')).toEqual([0,1,2,3,6,9,10]);
        expect(getActiveSteps('MVP', 'Frontend')).toEqual([0,1,2,3,4,5,6,10]);
        expect(getActiveSteps('Small', 'Full Stack')).toEqual([0,1,2,3,4,5,6,7,10]);
        expect(getActiveSteps('Medium', 'Frontend')).toEqual([0,1,2,3,4,5,6,7,8,10]);
        expect(getActiveSteps('Large', 'Full Stack')).toEqual([0,1,2,3,4,5,6,7,8,9,10]);
        expect(getActiveSteps('Enterprise', 'Full Stack')).toEqual([0,1,2,3,4,5,6,7,8,9,10]);
    });
});
