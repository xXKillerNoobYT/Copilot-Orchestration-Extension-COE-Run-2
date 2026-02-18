import { test, expect } from '@playwright/test';
import { AppPage, ALL_TABS } from './pages/app.page';
test.describe('COE Webapp — App Shell & Navigation', () => {
    let app;
    test.beforeEach(async ({ page }) => {
        app = new AppPage(page);
        await app.goto();
    });
    test('loads the app and shows the title', async ({ page }) => {
        await expect(page).toHaveTitle('COE — Copilot Orchestration Extension');
    });
    test('displays the COE logo in the navbar', async () => {
        await expect(app.logo).toBeVisible();
        await expect(app.logo).toHaveText('COE');
    });
    test('shows MCP status indicator', async () => {
        await expect(app.statusDot).toBeVisible();
        await expect(app.statusText).toContainText('MCP');
    });
    test('renders all 9 navigation tabs', async () => {
        await expect(app.navTabs).toHaveCount(9);
    });
    test('dashboard tab is active by default', async () => {
        await expect(app.dashboardTab).toHaveClass(/active/);
        await expect(app.dashboardPage).toBeVisible();
    });
    test.describe('tab navigation', () => {
        for (const tab of ALL_TABS) {
            test(`can navigate to "${tab}" tab`, async () => {
                await app.navigateToTab(tab);
                // The clicked tab should be active
                const tabButton = app.page.locator(`.tab[data-page="${tab}"]`);
                await expect(tabButton).toHaveClass(/active/);
                // The corresponding page should be visible
                const pageDiv = app.page.locator(`#page-${tab}`);
                await expect(pageDiv).toBeVisible();
                // All other pages should be hidden
                for (const other of ALL_TABS) {
                    if (other !== tab) {
                        await expect(app.page.locator(`#page-${other}`)).not.toBeVisible();
                    }
                }
            });
        }
    });
    test('switching tabs back and forth works', async () => {
        await app.navigateToTab('tasks');
        await expect(app.tasksPage).toBeVisible();
        await app.navigateToTab('settings');
        await expect(app.settingsPage).toBeVisible();
        await expect(app.tasksPage).not.toBeVisible();
        await app.navigateToTab('dashboard');
        await expect(app.dashboardPage).toBeVisible();
    });
});
