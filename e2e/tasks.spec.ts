import { test, expect } from '@playwright/test';
import { AppPage } from './pages/app.page';

test.describe('COE Webapp — Tasks Page', () => {
    let app: AppPage;

    test.beforeEach(async ({ page }) => {
        app = new AppPage(page);
        await app.goto();
        await app.navigateToTab('tasks');
    });

    test('shows tasks heading and subtitle', async () => {
        await expect(app.tasksPage.locator('h1')).toHaveText('Tasks');
        await expect(app.tasksPage.locator('.subtitle')).toHaveText('Manage your task queue');
    });

    test('has "New Task" button', async () => {
        const newTaskBtn = app.tasksPage.locator('button:has-text("+ New Task")');
        await expect(newTaskBtn).toBeVisible();
    });

    test('has task filter buttons', async () => {
        const filters = app.tasksPage.locator('.task-filter');
        await expect(filters).toHaveCount(6);

        // Check filter labels
        await expect(filters.nth(0)).toHaveText('All');
        await expect(filters.nth(1)).toHaveText('Not Started');
        await expect(filters.nth(2)).toHaveText('In Progress');
        await expect(filters.nth(3)).toHaveText('Pending');
        await expect(filters.nth(4)).toHaveText('Verified');
        await expect(filters.nth(5)).toHaveText('Failed');
    });

    test('"All" filter is active by default', async () => {
        const allFilter = app.tasksPage.locator('.task-filter[data-filter="all"]');
        await expect(allFilter).toHaveClass(/active/);
    });

    test('has task table with correct headers', async () => {
        const headers = app.tasksPage.locator('th');
        await expect(headers.nth(0)).toHaveText('Priority');
        await expect(headers.nth(1)).toHaveText('Title');
        await expect(headers.nth(2)).toHaveText('Status');
        await expect(headers.nth(3)).toHaveText('Est.');
        await expect(headers.nth(4)).toHaveText('Actions');
    });

    test('clicking filter buttons changes active state', async () => {
        const inProgressFilter = app.tasksPage.locator('.task-filter[data-filter="in_progress"]');
        await inProgressFilter.click();
        await expect(inProgressFilter).toHaveClass(/active/);

        // "All" should no longer be active
        const allFilter = app.tasksPage.locator('.task-filter[data-filter="all"]');
        await expect(allFilter).not.toHaveClass(/active/);
    });
});
