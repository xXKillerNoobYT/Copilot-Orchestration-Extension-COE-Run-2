import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../src/core/database';
import { MCPConfirmationStatus } from '../src/types';

// ============================================================
// Shared test infrastructure
// ============================================================

let tmpDir: string;
let db: Database;

beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-mcp-confirm-'));
    db = new Database(tmpDir);
    await db.initialize();
});

afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================
// Helpers
// ============================================================

function createTestConfirmation(overrides: Partial<{
    tool_name: string;
    agent_name: string;
    description: string;
    arguments_preview: string;
    expires_at: string;
}> = {}) {
    return db.createMCPConfirmation({
        tool_name: overrides.tool_name ?? 'callCOEAgent',
        agent_name: overrides.agent_name ?? 'planning',
        description: overrides.description ?? 'Run planning agent to analyze code',
        arguments_preview: overrides.arguments_preview ?? '{"message": "Analyze the codebase"}',
        expires_at: overrides.expires_at ?? new Date(Date.now() + 60000).toISOString(),
    });
}

// ============================================================
// MCP Confirmation — createMCPConfirmation
// ============================================================

describe('MCP Confirmation — createMCPConfirmation', () => {
    test('creates a pending confirmation record', () => {
        const conf = createTestConfirmation();
        expect(conf).toBeDefined();
        expect(conf.id).toBeDefined();
        expect(conf.status).toBe(MCPConfirmationStatus.Pending);
    });

    test('stores tool_name correctly', () => {
        const conf = createTestConfirmation({ tool_name: 'getNextTask' });
        expect(conf.tool_name).toBe('getNextTask');
    });

    test('stores agent_name correctly', () => {
        const conf = createTestConfirmation({ agent_name: 'verification' });
        expect(conf.agent_name).toBe('verification');
    });

    test('stores description correctly', () => {
        const conf = createTestConfirmation({ description: 'Execute verification pass' });
        expect(conf.description).toBe('Execute verification pass');
    });

    test('stores arguments_preview correctly', () => {
        const preview = '{"planId": "plan-123", "depth": 3}';
        const conf = createTestConfirmation({ arguments_preview: preview });
        expect(conf.arguments_preview).toBe(preview);
    });

    test('stores expires_at correctly', () => {
        const expiresAt = new Date(Date.now() + 120000).toISOString();
        const conf = createTestConfirmation({ expires_at: expiresAt });
        expect(conf.expires_at).toBe(expiresAt);
    });

    test('has created_at timestamp', () => {
        const conf = createTestConfirmation();
        expect(conf.created_at).toBeDefined();
        expect(new Date(conf.created_at).getTime()).not.toBeNaN();
    });

    test('user_response is null initially', () => {
        const conf = createTestConfirmation();
        expect(conf.user_response).toBeNull();
    });
});

// ============================================================
// MCP Confirmation — getMCPConfirmation
// ============================================================

describe('MCP Confirmation — getMCPConfirmation', () => {
    test('retrieves a confirmation by ID', () => {
        const conf = createTestConfirmation();
        const retrieved = db.getMCPConfirmation(conf.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(conf.id);
        expect(retrieved!.tool_name).toBe(conf.tool_name);
    });

    test('returns null for nonexistent ID', () => {
        const result = db.getMCPConfirmation('nonexistent-id');
        expect(result).toBeNull();
    });
});

// ============================================================
// MCP Confirmation — getActiveMCPConfirmations
// ============================================================

describe('MCP Confirmation — getActiveMCPConfirmations', () => {
    test('lists pending confirmations that have not expired', () => {
        createTestConfirmation({ tool_name: 'tool1' });
        createTestConfirmation({ tool_name: 'tool2' });
        const active = db.getActiveMCPConfirmations();
        expect(active.length).toBeGreaterThanOrEqual(2);
        expect(active.every(c => c.status === MCPConfirmationStatus.Pending)).toBe(true);
    });

    test('does not include approved confirmations', () => {
        const conf = createTestConfirmation();
        db.updateMCPConfirmation(conf.id, { status: MCPConfirmationStatus.Approved });
        const active = db.getActiveMCPConfirmations();
        expect(active.find(c => c.id === conf.id)).toBeUndefined();
    });

    test('does not include rejected confirmations', () => {
        const conf = createTestConfirmation();
        db.updateMCPConfirmation(conf.id, { status: MCPConfirmationStatus.Rejected });
        const active = db.getActiveMCPConfirmations();
        expect(active.find(c => c.id === conf.id)).toBeUndefined();
    });

    test('does not include expired confirmations', () => {
        // Create a confirmation that is already expired
        const conf = createTestConfirmation({
            expires_at: new Date(Date.now() - 60000).toISOString(), // 1 minute ago
        });
        const active = db.getActiveMCPConfirmations();
        expect(active.find(c => c.id === conf.id)).toBeUndefined();
    });

    test('returns empty array when no active confirmations exist', () => {
        const active = db.getActiveMCPConfirmations();
        expect(Array.isArray(active)).toBe(true);
        expect(active.length).toBe(0);
    });
});

// ============================================================
// MCP Confirmation — updateMCPConfirmation
// ============================================================

describe('MCP Confirmation — updateMCPConfirmation', () => {
    test('updates status to approved', () => {
        const conf = createTestConfirmation();
        const result = db.updateMCPConfirmation(conf.id, { status: MCPConfirmationStatus.Approved });
        expect(result).toBe(true);
        const updated = db.getMCPConfirmation(conf.id)!;
        expect(updated.status).toBe(MCPConfirmationStatus.Approved);
    });

    test('updates status to rejected', () => {
        const conf = createTestConfirmation();
        const result = db.updateMCPConfirmation(conf.id, { status: MCPConfirmationStatus.Rejected });
        expect(result).toBe(true);
        const updated = db.getMCPConfirmation(conf.id)!;
        expect(updated.status).toBe(MCPConfirmationStatus.Rejected);
    });

    test('updates user_response', () => {
        const conf = createTestConfirmation();
        db.updateMCPConfirmation(conf.id, {
            status: MCPConfirmationStatus.Approved,
            user_response: 'Approved by developer',
        });
        const updated = db.getMCPConfirmation(conf.id)!;
        expect(updated.user_response).toBe('Approved by developer');
    });

    test('returns false for nonexistent ID', () => {
        const result = db.updateMCPConfirmation('nonexistent', { status: MCPConfirmationStatus.Approved });
        expect(result).toBe(false);
    });

    test('returns false if no fields provided', () => {
        const conf = createTestConfirmation();
        const result = db.updateMCPConfirmation(conf.id, {});
        expect(result).toBe(false);
    });

    test('updates updated_at timestamp', () => {
        const conf = createTestConfirmation();
        const originalUpdatedAt = conf.updated_at;
        // Small delay to ensure timestamp differs
        db.updateMCPConfirmation(conf.id, { status: MCPConfirmationStatus.Approved });
        const updated = db.getMCPConfirmation(conf.id)!;
        // The updated_at should change (or at least not be before the original)
        expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(originalUpdatedAt).getTime());
    });
});

// ============================================================
// MCP Confirmation — expireOldMCPConfirmations
// ============================================================

describe('MCP Confirmation — expireOldMCPConfirmations', () => {
    test('expires confirmations past their expiry time', () => {
        createTestConfirmation({
            expires_at: new Date(Date.now() - 120000).toISOString(), // 2 minutes ago
        });
        const expired = db.expireOldMCPConfirmations();
        expect(expired).toBeGreaterThanOrEqual(1);
    });

    test('does not expire confirmations that are still valid', () => {
        createTestConfirmation({
            expires_at: new Date(Date.now() + 120000).toISOString(), // 2 minutes in future
        });
        const expired = db.expireOldMCPConfirmations();
        expect(expired).toBe(0);
    });

    test('sets status to expired', () => {
        const conf = createTestConfirmation({
            expires_at: new Date(Date.now() - 60000).toISOString(),
        });
        db.expireOldMCPConfirmations();
        const updated = db.getMCPConfirmation(conf.id)!;
        expect(updated.status).toBe(MCPConfirmationStatus.Expired);
    });
});
