import { test, expect } from '@playwright/test';
import { AppPage } from './pages/app.page';

test.describe('COE Webapp — Tickets Page', () => {
    let app: AppPage;

    test.beforeEach(async ({ page }) => {
        app = new AppPage(page);
        await app.goto();
        await app.navigateToTab('tickets');
    });

    test('shows tickets heading and subtitle', async () => {
        await expect(app.ticketsPage.locator('h1')).toHaveText('Tickets');
        await expect(app.ticketsPage.locator('.subtitle')).toHaveText('Questions and decisions that need human input');
    });

    test('has "New Ticket" button', async () => {
        const btn = app.ticketsPage.locator('button:has-text("+ New Ticket")');
        await expect(btn).toBeVisible();
    });

    test('has ticket table with correct headers', async () => {
        const headers = app.ticketsPage.locator('th');
        await expect(headers.nth(0)).toHaveText('#');
        await expect(headers.nth(1)).toHaveText('Title');
        await expect(headers.nth(2)).toHaveText('Status');
        await expect(headers.nth(3)).toHaveText('Priority');
        await expect(headers.nth(4)).toHaveText('Type');
        await expect(headers.nth(5)).toHaveText('Actions');
    });
});
