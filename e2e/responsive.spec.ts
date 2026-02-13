import { test, expect } from '@playwright/test';
import { AppPage } from './pages/app.page';

test.describe('COE Webapp — Responsive Design', () => {
    let app: AppPage;

    test.beforeEach(async ({ page }) => {
        app = new AppPage(page);
        await app.goto();
    });

    test('renders correctly at desktop width (1280px)', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 720 });
        await expect(app.logo).toBeVisible();
        await expect(app.navTabs.first()).toBeVisible();
        await expect(app.dashboardPage).toBeVisible();
    });

    test('renders correctly at tablet width (768px)', async ({ page }) => {
        await page.setViewportSize({ width: 768, height: 1024 });
        await expect(app.logo).toBeVisible();
        await expect(app.dashboardPage).toBeVisible();
    });

    test('renders at mobile width (375px)', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await expect(app.logo).toBeVisible();
        // Navigation tabs should still exist (they may overflow-scroll)
        await expect(app.navTabs.first()).toBeAttached();
    });

    test('navigation still works at small viewport', async ({ page }) => {
        await page.setViewportSize({ width: 480, height: 800 });
        await app.navigateToTab('tasks');
        await expect(app.tasksPage).toBeVisible();
    });
});

test.describe('COE Webapp — Visual Regression Smoke', () => {
    test('app shell matches screenshot', async ({ page }) => {
        const app = new AppPage(page);
        await app.goto();
        // Give time for any animations/loading to finish
        await page.waitForTimeout(500);
        await expect(page).toHaveScreenshot('app-shell.png', {
            maxDiffPixelRatio: 0.05,
        });
    });
});
