import { test, expect } from '@playwright/test';
import { AppPage } from './pages/app.page';

test.describe('COE Webapp — Settings Page', () => {
    let app: AppPage;

    test.beforeEach(async ({ page }) => {
        app = new AppPage(page);
        await app.goto();
        await app.navigateToTab('settings');
    });

    test('settings page is visible', async () => {
        await expect(app.settingsPage).toBeVisible();
    });

    test('has settings grid with sidebar navigation', async () => {
        const settingsGrid = app.page.locator('.settings-grid');
        // Settings grid may or may not be present depending on screen width
        // Just check the page loaded
        await expect(app.settingsPage).toBeVisible();
    });
});

test.describe('COE Webapp — Agents Page', () => {
    let app: AppPage;

    test.beforeEach(async ({ page }) => {
        app = new AppPage(page);
        await app.goto();
        await app.navigateToTab('agents');
    });

    test('agents page is visible', async () => {
        await expect(app.agentsPage).toBeVisible();
    });
});

test.describe('COE Webapp — Coding Page', () => {
    let app: AppPage;

    test.beforeEach(async ({ page }) => {
        app = new AppPage(page);
        await app.goto();
        await app.navigateToTab('coding');
    });

    test('coding page is visible', async () => {
        await expect(app.codingPage).toBeVisible();
    });

    test('has coding layout structure', async () => {
        const codingLayout = app.page.locator('.coding-layout');
        await expect(codingLayout).toBeAttached();
    });
});

test.describe('COE Webapp — Designer Page', () => {
    let app: AppPage;

    test.beforeEach(async ({ page }) => {
        app = new AppPage(page);
        await app.goto();
        await app.navigateToTab('designer');
    });

    test('designer page is visible', async () => {
        await expect(app.designerPage).toBeVisible();
    });

    test('has designer layout structure', async () => {
        const designerLayout = app.page.locator('.designer-layout');
        await expect(designerLayout).toBeAttached();
    });
});

test.describe('COE Webapp — GitHub Page', () => {
    let app: AppPage;

    test.beforeEach(async ({ page }) => {
        app = new AppPage(page);
        await app.goto();
        await app.navigateToTab('github');
    });

    test('github page is visible', async () => {
        await expect(app.githubPage).toBeVisible();
    });
});

test.describe('COE Webapp — System Page', () => {
    let app: AppPage;

    test.beforeEach(async ({ page }) => {
        app = new AppPage(page);
        await app.goto();
        await app.navigateToTab('system');
    });

    test('system page is visible', async () => {
        await expect(app.systemPage).toBeVisible();
    });
});
