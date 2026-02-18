import { expect } from '@playwright/test';
/**
 * Page object for the COE webapp. Encapsulates navigation, tab switching,
 * and common UI interactions so tests stay readable and DRY.
 */
export class AppPage {
    page;
    // Top navigation
    logo;
    statusDot;
    statusText;
    navTabs;
    // Tab buttons (by data-page attribute)
    dashboardTab;
    tasksTab;
    ticketsTab;
    planningTab;
    agentsTab;
    codingTab;
    githubTab;
    settingsTab;
    systemTab;
    // Page containers
    dashboardPage;
    tasksPage;
    ticketsPage;
    planningPage;
    agentsPage;
    codingPage;
    githubPage;
    settingsPage;
    systemPage;
    constructor(page) {
        this.page = page;
        // Nav
        this.logo = page.locator('.topnav .logo');
        this.statusDot = page.locator('#statusDot');
        this.statusText = page.locator('#statusText');
        this.navTabs = page.locator('.topnav .tabs .tab');
        // Tabs
        this.dashboardTab = page.locator('.tab[data-page="dashboard"]');
        this.tasksTab = page.locator('.tab[data-page="tasks"]');
        this.ticketsTab = page.locator('.tab[data-page="tickets"]');
        this.planningTab = page.locator('.tab[data-page="planning"]');
        this.agentsTab = page.locator('.tab[data-page="agents"]');
        this.codingTab = page.locator('.tab[data-page="coding"]');
        this.githubTab = page.locator('.tab[data-page="github"]');
        this.settingsTab = page.locator('.tab[data-page="settings"]');
        this.systemTab = page.locator('.tab[data-page="system"]');
        // Pages
        this.dashboardPage = page.locator('#page-dashboard');
        this.tasksPage = page.locator('#page-tasks');
        this.ticketsPage = page.locator('#page-tickets');
        this.planningPage = page.locator('#page-planning');
        this.agentsPage = page.locator('#page-agents');
        this.codingPage = page.locator('#page-coding');
        this.githubPage = page.locator('#page-github');
        this.settingsPage = page.locator('#page-settings');
        this.systemPage = page.locator('#page-system');
    }
    /** Navigate to /app */
    async goto() {
        await this.page.goto('/app');
    }
    /** Navigate to a specific tab */
    async navigateToTab(tab) {
        const tabButton = this.page.locator(`.tab[data-page="${tab}"]`);
        await tabButton.click();
        await expect(this.page.locator(`#page-${tab}`)).toBeVisible();
    }
    /** Get the currently active tab name */
    async getActiveTab() {
        const activeTab = this.page.locator('.tab.active');
        return activeTab.getAttribute('data-page');
    }
    /** Get the currently visible page */
    getVisiblePage() {
        return this.page.locator('.page.active');
    }
    /** Open a modal by ID */
    async openModal(modalId) {
        await this.page.evaluate((id) => {
            const fn = window.openModal;
            if (fn)
                fn(id);
        }, modalId);
    }
    /** Close any open modal */
    async closeModal() {
        const overlay = this.page.locator('.modal-overlay.open');
        if (await overlay.isVisible()) {
            await overlay.locator('.modal-close').click();
        }
    }
    /** Wait for the dashboard to finish its initial data load */
    async waitForDashboardLoad() {
        // The dashboard shows "Loading..." initially, then replaces it
        await expect(this.page.locator('#dashPlanName')).not.toHaveText('Loading...', { timeout: 10_000 });
    }
    /** Get all stat cards from the dashboard */
    async getDashboardCards() {
        const cards = this.page.locator('#dashCards .card');
        const count = await cards.count();
        const result = [];
        for (let i = 0; i < count; i++) {
            const card = cards.nth(i);
            result.push({
                value: await card.locator('.val').textContent() ?? '',
                label: await card.locator('.lbl').textContent() ?? '',
            });
        }
        return result;
    }
}
export const ALL_TABS = [
    'dashboard', 'tasks', 'tickets', 'planning', 'agents',
    'coding', 'github', 'settings', 'system',
];
