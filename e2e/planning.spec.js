import { test, expect } from '@playwright/test';
import { AppPage } from './pages/app.page';
test.describe('COE Webapp — Planning Page', () => {
    let app;
    test.beforeEach(async ({ page }) => {
        app = new AppPage(page);
        await app.goto();
        await app.navigateToTab('planning');
    });
    test('shows planning heading and subtitle', async () => {
        await expect(app.planningPage.locator('h1')).toHaveText('Planning');
        await expect(app.planningPage.locator('.subtitle')).toHaveText('Create and manage development plans');
    });
    test('has the plan wizard section', async () => {
        const wizardSection = app.page.locator('#wizardSection');
        await expect(wizardSection).toBeVisible();
    });
    test('wizard step 0 is visible by default', async () => {
        const step0 = app.page.locator('#wstep0');
        await expect(step0).toBeVisible();
    });
    test('wizard has plan name and description inputs', async () => {
        const nameInput = app.page.locator('#wizName');
        const descInput = app.page.locator('#wizDesc');
        await expect(nameInput).toBeVisible();
        await expect(descInput).toBeVisible();
    });
    test('wizard has Next and Quick Generate buttons', async () => {
        const nextBtn = app.page.locator('#wstep0 button:has-text("Next")');
        const quickBtn = app.page.locator('#wstep0 button:has-text("Quick Generate")');
        await expect(nextBtn).toBeVisible();
        await expect(quickBtn).toBeVisible();
    });
    test('wizard name input accepts text', async () => {
        const nameInput = app.page.locator('#wizName');
        await nameInput.fill('My Test Plan');
        await expect(nameInput).toHaveValue('My Test Plan');
    });
    test('wizard description textarea accepts text', async () => {
        const descInput = app.page.locator('#wizDesc');
        await descInput.fill('A description of the plan');
        await expect(descInput).toHaveValue('A description of the plan');
    });
});
