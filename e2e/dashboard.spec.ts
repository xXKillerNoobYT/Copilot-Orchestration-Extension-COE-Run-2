import { test, expect } from '@playwright/test';
import { AppPage } from './pages/app.page';

test.describe('COE Webapp — Dashboard', () => {
    let app: AppPage;

    test.beforeEach(async ({ page }) => {
        app = new AppPage(page);
        await app.goto();
    });

    test('dashboard shows heading and subtitle', async () => {
        const heading = app.dashboardPage.locator('h1');
        await expect(heading).toHaveText('Dashboard');
        await expect(app.page.locator('#dashPlanName')).toBeVisible();
    });

    test('dashboard has stat cards container', async () => {
        const cardGrid = app.page.locator('#dashCards');
        await expect(cardGrid).toBeVisible();
    });

    test('dashboard has agents table', async () => {
        const agentTable = app.dashboardPage.locator('table');
        await expect(agentTable).toBeVisible();

        // Check headers exist
        const headers = app.dashboardPage.locator('th');
        await expect(headers.nth(0)).toHaveText('Agent');
        await expect(headers.nth(1)).toHaveText('Type');
        await expect(headers.nth(2)).toHaveText('Status');
        await expect(headers.nth(3)).toHaveText('Current Task');
    });

    test('dashboard has recent activity section', async () => {
        const auditSection = app.page.locator('#dashAudit');
        await expect(auditSection).toBeVisible();
    });

    test('progress bar section exists', async () => {
        const progressWrap = app.page.locator('#dashProgress');
        // It may be hidden if no active plan, but element should exist
        await expect(progressWrap).toBeAttached();
    });
});
