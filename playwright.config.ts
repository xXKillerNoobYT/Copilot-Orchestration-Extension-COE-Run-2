import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for COE webapp E2E tests.
 * 
 * The webapp is served by the MCP server at http://localhost:3030/app
 * The MCP server must be running before tests execute (start the extension via F5,
 * or run the MCP server standalone).
 * 
 * Usage:
 *   npx playwright test                    # run all tests
 *   npx playwright test --ui               # interactive UI mode
 *   npx playwright test --headed           # see the browser
 *   npx playwright test --project=chromium # specific browser
 */
export default defineConfig({
    testDir: './e2e',
    outputDir: './e2e/test-results',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: [
        ['html', { outputFolder: './e2e/playwright-report' }],
        ['list'],
    ],
    timeout: 30_000,
    expect: {
        timeout: 5_000,
    },

    use: {
        baseURL: 'http://localhost:3030',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        // Uncomment to test more browsers:
        // {
        //     name: 'firefox',
        //     use: { ...devices['Desktop Firefox'] },
        // },
        // {
        //     name: 'webkit',
        //     use: { ...devices['Desktop Safari'] },
        // },
        // {
        //     name: 'mobile-chrome',
        //     use: { ...devices['Pixel 5'] },
        // },
    ],

    /* No webServer config — the MCP server must already be running.
       Start the extension (F5) or manually run: npm run build && start the extension.
       If you want auto-start, uncomment and adapt:
    webServer: {
        command: 'npm run start-mcp',
        url: 'http://localhost:3030/health',
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },
    */
});
