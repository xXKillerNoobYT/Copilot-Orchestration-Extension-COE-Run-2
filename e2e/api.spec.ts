import { test, expect } from '@playwright/test';

test.describe('COE API — Health & Root', () => {

    test('GET /health returns ok status', async ({ request }) => {
        const response = await request.get('/health');
        expect(response.ok()).toBeTruthy();

        const body = await response.json();
        expect(body.status).toBe('ok');
        expect(body.tools).toBeDefined();
        expect(Array.isArray(body.tools)).toBe(true);
    });

    test('GET / returns server info', async ({ request }) => {
        const response = await request.get('/');
        expect(response.ok()).toBeTruthy();

        const body = await response.json();
        expect(body.name).toBe('COE MCP Server');
        expect(body.version).toBe('1.0.0');
        expect(body.webapp).toContain('/app');
        expect(body.mcp_endpoint).toContain('/mcp');
        expect(body.tools).toBeDefined();
    });

    test('GET /app returns HTML', async ({ request }) => {
        const response = await request.get('/app');
        expect(response.ok()).toBeTruthy();

        const contentType = response.headers()['content-type'];
        expect(contentType).toContain('text/html');

        const body = await response.text();
        expect(body).toContain('COE');
        expect(body).toContain('<!DOCTYPE html>');
    });

    test('GET /api/dashboard returns dashboard data', async ({ request }) => {
        const response = await request.get('/api/dashboard');
        expect(response.ok()).toBeTruthy();

        const body = await response.json();
        expect(body.stats).toBeDefined();
        expect(body.agents).toBeDefined();
        expect(body.recentAudit).toBeDefined();
    });

    test('GET /api/events/metrics returns metrics', async ({ request }) => {
        const response = await request.get('/api/events/metrics');
        expect(response.ok()).toBeTruthy();
    });

    test('GET /nonexistent returns 404', async ({ request }) => {
        const response = await request.get('/nonexistent-path-12345');
        expect(response.status()).toBe(404);
    });
});
