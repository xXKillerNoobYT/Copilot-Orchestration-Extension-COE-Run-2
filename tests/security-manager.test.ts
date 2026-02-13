import { SecurityManager, ApiKey, SecurityConfig } from '../src/core/security-manager';

describe('SecurityManager', () => {
    let manager: SecurityManager;

    beforeEach(() => {
        manager = new SecurityManager();
    });

    // ==================== API KEY MANAGEMENT ====================

    describe('API Key Management', () => {
        it('should generate an API key with coe_ prefix', () => {
            const key = manager.generateApiKey('test-app', ['tasks:read']);
            expect(key.key).toMatch(/^coe_/);
        });

        it('should generate an API key with the correct name', () => {
            const key = manager.generateApiKey('my-service', ['tasks:read']);
            expect(key.name).toBe('my-service');
        });

        it('should generate an API key with specified permissions', () => {
            const perms = ['tasks:read', 'tasks:create', 'plans:read'];
            const key = manager.generateApiKey('test-app', perms);
            expect(key.permissions).toEqual(perms);
        });

        it('should generate an active API key by default', () => {
            const key = manager.generateApiKey('test-app', ['tasks:read']);
            expect(key.active).toBe(true);
        });

        it('should generate a key with length matching config', () => {
            const mgr = new SecurityManager({ apiKeyLength: 16 });
            const key = mgr.generateApiKey('test', ['tasks:read']);
            // "coe_" prefix (4 chars) + 16 random chars = 20
            expect(key.key.length).toBe(4 + 16);
        });

        it('should validate an active API key', () => {
            const key = manager.generateApiKey('test-app', ['tasks:read']);
            const result = manager.validateApiKey(key.key);
            expect(result).not.toBeNull();
            expect(result!.name).toBe('test-app');
        });

        it('should update lastUsed on validation', () => {
            const key = manager.generateApiKey('test-app', ['tasks:read']);
            expect(key.lastUsed).toBeUndefined();
            manager.validateApiKey(key.key);
            expect(key.lastUsed).toBeDefined();
        });

        it('should reject an invalid API key', () => {
            const result = manager.validateApiKey('coe_nonexistent');
            expect(result).toBeNull();
        });

        it('should reject an inactive API key', () => {
            const key = manager.generateApiKey('test-app', ['tasks:read']);
            manager.revokeApiKey(key.key);
            const result = manager.validateApiKey(key.key);
            expect(result).toBeNull();
        });

        it('should reject an expired API key', () => {
            const key = manager.generateApiKey('test-app', ['tasks:read']);
            key.expiresAt = new Date(Date.now() - 10000).toISOString();
            const result = manager.validateApiKey(key.key);
            expect(result).toBeNull();
        });

        it('should mark expired key as inactive after validation attempt', () => {
            const key = manager.generateApiKey('test-app', ['tasks:read']);
            key.expiresAt = new Date(Date.now() - 10000).toISOString();
            manager.validateApiKey(key.key);
            expect(key.active).toBe(false);
        });

        it('should revoke an API key', () => {
            const key = manager.generateApiKey('test-app', ['tasks:read']);
            const result = manager.revokeApiKey(key.key);
            expect(result).toBe(true);
            expect(key.active).toBe(false);
        });

        it('should return false when revoking non-existent key', () => {
            const result = manager.revokeApiKey('coe_nonexistent');
            expect(result).toBe(false);
        });

        it('should return all API keys with masked key values', () => {
            manager.generateApiKey('app-1', ['tasks:read']);
            manager.generateApiKey('app-2', ['plans:read']);
            const keys = manager.getAllApiKeys();
            expect(keys).toHaveLength(2);
            keys.forEach(k => {
                expect(k.key).toMatch(/^coe_\w{4}\.\.\.$/);  
            });
        });

        it('should set rateLimit to default maxRequestsPerMinute', () => {
            const key = manager.generateApiKey('test', ['tasks:read']);
            expect(key.rateLimit).toBe(120);
        });

        it('should set createdAt timestamp', () => {
            const before = new Date().toISOString();
            const key = manager.generateApiKey('test', ['tasks:read']);
            const after = new Date().toISOString();
            expect(key.createdAt >= before).toBe(true);
            expect(key.createdAt <= after).toBe(true);
        });

        it('should assign unique IDs to keys', () => {
            const k1 = manager.generateApiKey('a', []);
            const k2 = manager.generateApiKey('b', []);
            expect(k1.id).not.toBe(k2.id);
        });
    });

    // ==================== AUTHENTICATION ====================

    describe('Authentication', () => {
        it('should authenticate with a valid API key', () => {
            const key = manager.generateApiKey('test-app', ['tasks:read']);
            const result = manager.authenticate(key.key, '127.0.0.1');
            expect(result.authenticated).toBe(true);
            expect(result.apiKey).toBeDefined();
            expect(result.apiKey!.name).toBe('test-app');
        });

        it('should fail authentication with wrong key', () => {
            const result = manager.authenticate('coe_wrongkey', '127.0.0.1');
            expect(result.authenticated).toBe(false);
            expect(result.error).toBe('Invalid API key');
        });

        it('should allow all when auth is disabled', () => {
            const mgr = new SecurityManager({ enableAuth: false });
            const result = mgr.authenticate('anything', '127.0.0.1');
            expect(result.authenticated).toBe(true);
        });

        it('should track failed attempts', () => {
            manager.authenticate('coe_wrong1', '10.0.0.1');
            manager.authenticate('coe_wrong2', '10.0.0.1');
            expect(manager.isLockedOut('10.0.0.1')).toBe(false);
        });

        it('should lock out after max failed attempts', () => {
            const source = '10.0.0.2';
            for (let i = 0; i < 5; i++) {
                manager.authenticate(`coe_wrong${i}`, source);
            }
            expect(manager.isLockedOut(source)).toBe(true);
        });

        it('should reject authentication during lockout', () => {
            const source = '10.0.0.3';
            for (let i = 0; i < 5; i++) {
                manager.authenticate(`coe_wrong${i}`, source);
            }
            const key = manager.generateApiKey('valid', ['tasks:read']);
            const result = manager.authenticate(key.key, source);
            expect(result.authenticated).toBe(false);
            expect(result.error).toContain('locked');
        });

        it('should enforce lockout duration', () => {
            const mgr = new SecurityManager({ lockoutDurationMs: 100 });
            const source = '10.0.0.4';
            for (let i = 0; i < 5; i++) {
                mgr.authenticate(`coe_wrong${i}`, source);
            }
            expect(mgr.isLockedOut(source)).toBe(true);
        });

        it('should reset failed attempts on successful auth', () => {
            const source = '10.0.0.5';
            for (let i = 0; i < 3; i++) {
                manager.authenticate(`coe_wrong${i}`, source);
            }
            const key = manager.generateApiKey('valid', ['tasks:read']);
            manager.authenticate(key.key, source);
            for (let i = 0; i < 3; i++) {
                manager.authenticate(`coe_wrong${i}`, source);
            }
            expect(manager.isLockedOut(source)).toBe(false);
        });

        it('should log auth_success event on successful authentication', () => {
            const key = manager.generateApiKey('test-app', ['tasks:read']);
            manager.authenticate(key.key, '127.0.0.1');
            const successEvents = manager.getSecurityLogByType('auth_success');
            expect(successEvents.length).toBeGreaterThanOrEqual(1);
        });

        it('should log auth_failure event on failed authentication', () => {
            manager.authenticate('coe_invalid', '127.0.0.1');
            const failEvents = manager.getSecurityLogByType('auth_failure');
            expect(failEvents.length).toBeGreaterThanOrEqual(1);
        });

        it('should log brute_force_detected after max failures', () => {
            const source = '10.0.0.6';
            for (let i = 0; i < 5; i++) {
                manager.authenticate('coe_wrong' + i, source);
            }
            const bruteForceEvents = manager.getSecurityLogByType('brute_force_detected');
            expect(bruteForceEvents.length).toBeGreaterThanOrEqual(1);
        });
    });

    // ==================== CSRF PROTECTION ====================

    describe('CSRF Protection', () => {
        it('should generate a CSRF token', () => {
            const token = manager.generateCsrfToken('session-1');
            expect(token).toBeDefined();
            expect(typeof token).toBe('string');
            expect(token.length).toBe(32);
        });

        it('should validate a correct CSRF token', () => {
            const token = manager.generateCsrfToken('session-2');
            const valid = manager.validateCsrfToken('session-2', token);
            expect(valid).toBe(true);
        });

        it('should reject a wrong CSRF token', () => {
            manager.generateCsrfToken('session-3');
            const valid = manager.validateCsrfToken('session-3', 'wrong-token');
            expect(valid).toBe(false);
        });

        it('should reject expired CSRF token', () => {
            const mgr = new SecurityManager({ csrfTokenExpiry: 1 });
            const token = mgr.generateCsrfToken('session-4');
            const start = Date.now();
            while (Date.now() - start < 5) { /* spin */ }
            const valid = mgr.validateCsrfToken('session-4', token);
            expect(valid).toBe(false);
        });

        it('should reject token for unknown session', () => {
            const valid = manager.validateCsrfToken('no-such-session', 'some-token');
            expect(valid).toBe(false);
        });

        it('should allow all when CSRF is disabled', () => {
            const mgr = new SecurityManager({ enableCsrf: false });
            const valid = mgr.validateCsrfToken('any', 'any');
            expect(valid).toBe(true);
        });

        it('should log csrf_violation on missing session token', () => {
            manager.validateCsrfToken('unknown-session', 'token');
            const events = manager.getSecurityLogByType('csrf_violation');
            expect(events.length).toBeGreaterThanOrEqual(1);
            expect(events[0].details).toContain('No CSRF token found');
        });

        it('should log csrf_violation on token mismatch', () => {
            manager.generateCsrfToken('session-x');
            manager.validateCsrfToken('session-x', 'bad-token');
            const events = manager.getSecurityLogByType('csrf_violation');
            expect(events.some(e => e.details.includes('mismatch'))).toBe(true);
        });

        it('should delete expired token entry on validation', () => {
            const mgr = new SecurityManager({ csrfTokenExpiry: 1 });
            const token = mgr.generateCsrfToken('session-del');
            const start = Date.now();
            while (Date.now() - start < 5) { /* spin */ }
            mgr.validateCsrfToken('session-del', token);
            mgr.validateCsrfToken('session-del', token);
            const events = mgr.getSecurityLogByType('csrf_violation');
            expect(events.some(e => e.details.includes('No CSRF token found') && e.source === 'session-del')).toBe(true);
        });

        it('should overwrite previous token for same session', () => {
            const token1 = manager.generateCsrfToken('session-ow');
            const token2 = manager.generateCsrfToken('session-ow');
            expect(token1).not.toBe(token2);
            expect(manager.validateCsrfToken('session-ow', token2)).toBe(true);
            expect(manager.validateCsrfToken('session-ow', token1)).toBe(false);
        });
    });

    // ==================== RATE LIMITING ====================

    describe('Rate Limiting', () => {
        it('should allow requests within the limit', () => {
            const result = manager.checkRateLimit('client-1');
            expect(result.allowed).toBe(true);
        });

        it('should return remaining count', () => {
            const result = manager.checkRateLimit('client-2');
            expect(result.remaining).toBe(119);
        });

        it('should block when rate limit exceeded', () => {
            const mgr = new SecurityManager({ maxRequestsPerMinute: 3 });
            mgr.checkRateLimit('client-3');
            mgr.checkRateLimit('client-3');
            mgr.checkRateLimit('client-3');
            const result = mgr.checkRateLimit('client-3');
            expect(result.allowed).toBe(false);
            expect(result.remaining).toBe(0);
        });

        it('should use custom rate limit when provided', () => {
            const result1 = manager.checkRateLimit('client-4', 2);
            expect(result1.allowed).toBe(true);
            const result2 = manager.checkRateLimit('client-4', 2);
            expect(result2.allowed).toBe(true);
            const result3 = manager.checkRateLimit('client-4', 2);
            expect(result3.allowed).toBe(false);
        });

        it('should allow all when rate limiting is disabled', () => {
            const mgr = new SecurityManager({ enableRateLimit: false });
            const result = mgr.checkRateLimit('client-5');
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(Infinity);
        });

        it('should return resetAt timestamp', () => {
            const before = Date.now();
            const result = manager.checkRateLimit('client-6');
            expect(result.resetAt).toBeGreaterThanOrEqual(before);
            expect(result.resetAt).toBeLessThanOrEqual(before + 60001);
        });

        it('should track different sources independently', () => {
            const mgr = new SecurityManager({ maxRequestsPerMinute: 2 });
            mgr.checkRateLimit('source-a');
            mgr.checkRateLimit('source-a');
            const resultA = mgr.checkRateLimit('source-a');
            expect(resultA.allowed).toBe(false);
            const resultB = mgr.checkRateLimit('source-b');
            expect(resultB.allowed).toBe(true);
        });

        it('should log rate_limit event when exceeded', () => {
            const mgr = new SecurityManager({ maxRequestsPerMinute: 1 });
            mgr.checkRateLimit('rate-src');
            mgr.checkRateLimit('rate-src');
            const events = mgr.getSecurityLogByType('rate_limit');
            expect(events.length).toBeGreaterThanOrEqual(1);
        });

        it('should decrement remaining correctly', () => {
            const mgr = new SecurityManager({ maxRequestsPerMinute: 5 });
            expect(mgr.checkRateLimit('dec-test').remaining).toBe(4);
            expect(mgr.checkRateLimit('dec-test').remaining).toBe(3);
            expect(mgr.checkRateLimit('dec-test').remaining).toBe(2);
            expect(mgr.checkRateLimit('dec-test').remaining).toBe(1);
            expect(mgr.checkRateLimit('dec-test').remaining).toBe(0);
        });
    });

    // ==================== PERMISSION CHECKING ====================

    describe('Permission Checking', () => {
        it('should allow exact permission match', () => {
            const key = manager.generateApiKey('test', ['tasks:read']);
            const allowed = manager.checkPermission(key, 'tasks', 'read');
            expect(allowed).toBe(true);
        });

        it('should deny non-matching permission', () => {
            const key = manager.generateApiKey('test', ['tasks:read']);
            const allowed = manager.checkPermission(key, 'tasks', 'delete');
            expect(allowed).toBe(false);
        });

        it('should allow wildcard permission (resource:*)', () => {
            const key = manager.generateApiKey('test', ['tasks:*']);
            expect(manager.checkPermission(key, 'tasks', 'read')).toBe(true);
            expect(manager.checkPermission(key, 'tasks', 'create')).toBe(true);
            expect(manager.checkPermission(key, 'tasks', 'delete')).toBe(true);
        });

        it('should not allow wildcard on different resource', () => {
            const key = manager.generateApiKey('test', ['tasks:*']);
            expect(manager.checkPermission(key, 'plans', 'read')).toBe(false);
        });

        it('should allow super wildcard (*:*)', () => {
            const key = manager.generateApiKey('admin', ['*:*']);
            expect(manager.checkPermission(key, 'tasks', 'read')).toBe(true);
            expect(manager.checkPermission(key, 'plans', 'delete')).toBe(true);
            expect(manager.checkPermission(key, 'config', 'update')).toBe(true);
        });

        it('should log permission_denied event', () => {
            const key = manager.generateApiKey('limited', ['tasks:read']);
            manager.checkPermission(key, 'config', 'delete');
            const events = manager.getSecurityLogByType('permission_denied');
            expect(events.length).toBeGreaterThanOrEqual(1);
            expect(events[0].details).toContain('Denied delete on config');
        });

        it('should handle multiple permissions on a key', () => {
            const key = manager.generateApiKey('multi', ['tasks:read', 'plans:create', 'agents:execute']);
            expect(manager.checkPermission(key, 'tasks', 'read')).toBe(true);
            expect(manager.checkPermission(key, 'plans', 'create')).toBe(true);
            expect(manager.checkPermission(key, 'agents', 'execute')).toBe(true);
            expect(manager.checkPermission(key, 'tasks', 'delete')).toBe(false);
        });
    });

    // ==================== SECURITY HEADERS ====================

    describe('Security Headers', () => {
        it('should return all required security headers', () => {
            const headers = manager.getSecurityHeaders();
            expect(headers).toHaveProperty('X-Content-Type-Options');
            expect(headers).toHaveProperty('X-Frame-Options');
            expect(headers).toHaveProperty('X-XSS-Protection');
            expect(headers).toHaveProperty('Strict-Transport-Security');
            expect(headers).toHaveProperty('Content-Security-Policy');
            expect(headers).toHaveProperty('Referrer-Policy');
            expect(headers).toHaveProperty('Permissions-Policy');
        });

        it('should set X-Content-Type-Options to nosniff', () => {
            const headers = manager.getSecurityHeaders();
            expect(headers['X-Content-Type-Options']).toBe('nosniff');
        });

        it('should set X-Frame-Options to DENY', () => {
            const headers = manager.getSecurityHeaders();
            expect(headers['X-Frame-Options']).toBe('DENY');
        });

        it('should set X-XSS-Protection to 1; mode=block', () => {
            const headers = manager.getSecurityHeaders();
            expect(headers['X-XSS-Protection']).toBe('1; mode=block');
        });

        it('should include Content-Security-Policy', () => {
            const headers = manager.getSecurityHeaders();
            expect(headers['Content-Security-Policy']).toContain("default-src");
        });

        it('should include Strict-Transport-Security with max-age', () => {
            const headers = manager.getSecurityHeaders();
            expect(headers['Strict-Transport-Security']).toContain('max-age=');
        });

        it('should include Referrer-Policy', () => {
            const headers = manager.getSecurityHeaders();
            expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
        });

        it('should include Permissions-Policy that blocks camera/mic/geo', () => {
            const headers = manager.getSecurityHeaders();
            expect(headers['Permissions-Policy']).toContain('camera=()');
            expect(headers['Permissions-Policy']).toContain('microphone=()');
            expect(headers['Permissions-Policy']).toContain('geolocation()');
        });
    });

    // ==================== SECURITY AUDIT ====================

    describe('Security Audit', () => {
        it('should log events with correct structure', () => {
            manager.generateApiKey('test', ['tasks:read']);
            const log = manager.getSecurityLog();
            expect(log.length).toBeGreaterThanOrEqual(1);
            const event = log[0];
            expect(event).toHaveProperty('id');
            expect(event).toHaveProperty('type');
            expect(event).toHaveProperty('severity');
            expect(event).toHaveProperty('source');
            expect(event).toHaveProperty('details');
            expect(event).toHaveProperty('timestamp');
        });

        it('should return log with limit', () => {
            for (let i = 0; i < 10; i++) {
                manager.generateApiKey(`app-${i}`, []);
            }
            const limited = manager.getSecurityLog(3);
            expect(limited).toHaveLength(3);
        });

        it('should return most recent entries when limited', () => {
            for (let i = 0; i < 5; i++) {
                manager.generateApiKey(`app-${i}`, []);
            }
            const limited = manager.getSecurityLog(2);
            expect(limited[1].details).toContain('app-4');
        });

        it('should filter by type', () => {
            const key = manager.generateApiKey('test', ['tasks:read']);
            manager.authenticate(key.key, '127.0.0.1');
            manager.authenticate('coe_wrong', '127.0.0.1');

            const created = manager.getSecurityLogByType('api_key_created');
            expect(created.length).toBeGreaterThanOrEqual(1);

            const successes = manager.getSecurityLogByType('auth_success');
            expect(successes.length).toBeGreaterThanOrEqual(1);

            const failures = manager.getSecurityLogByType('auth_failure');
            expect(failures.length).toBeGreaterThanOrEqual(1);
        });

        it('should get critical events', () => {
            for (let i = 0; i < 5; i++) {
                manager.authenticate(`coe_wrong${i}`, '10.0.0.99');
            }
            const critical = manager.getCriticalEvents();
            expect(critical.length).toBeGreaterThanOrEqual(1);
            expect(critical[0].severity).toBe('critical');
        });

        it('should return accurate security stats', () => {
            const key = manager.generateApiKey('test', ['tasks:read']);
            manager.authenticate(key.key, '127.0.0.1');
            manager.authenticate('coe_bad', '10.0.0.50');

            const stats = manager.getSecurityStats();
            expect(stats.totalEvents).toBeGreaterThanOrEqual(3);
            expect(stats.activeKeys).toBe(1);
            expect(stats.authFailures).toBeGreaterThanOrEqual(1);
        });

        it('should cap log at 10000 entries', () => {
            const mgr = new SecurityManager();
            for (let i = 0; i < 10005; i++) {
                mgr.generateApiKey(`app-${i}`, []);
            }
            const log = mgr.getSecurityLog(99999);
            expect(log.length).toBeLessThanOrEqual(10000);
        });

        it('should track lockedSources in stats', () => {
            const source = '10.0.0.77';
            for (let i = 0; i < 5; i++) {
                manager.authenticate(`coe_wrong${i}`, source);
            }
            const stats = manager.getSecurityStats();
            expect(stats.lockedSources).toBeGreaterThanOrEqual(1);
        });

        it('should have unique IDs for events', () => {
            manager.generateApiKey('a', []);
            manager.generateApiKey('b', []);
            const log = manager.getSecurityLog();
            const ids = log.map(e => e.id);
            expect(new Set(ids).size).toBe(ids.length);
        });
    });

    // ==================== CONFIGURATION ====================

    describe('Configuration', () => {
        it('should use default config values', () => {
            const config = manager.getConfig();
            expect(config.enableAuth).toBe(true);
            expect(config.enableCsrf).toBe(true);
            expect(config.enableRateLimit).toBe(true);
            expect(config.maxRequestsPerMinute).toBe(120);
            expect(config.maxFailedAttempts).toBe(5);
            expect(config.lockoutDurationMs).toBe(900000);
            expect(config.csrfTokenExpiry).toBe(3600000);
            expect(config.apiKeyLength).toBe(32);
        });

        it('should accept custom config overrides', () => {
            const mgr = new SecurityManager({
                maxRequestsPerMinute: 60,
                maxFailedAttempts: 3,
                apiKeyLength: 64,
            });
            const config = mgr.getConfig();
            expect(config.maxRequestsPerMinute).toBe(60);
            expect(config.maxFailedAttempts).toBe(3);
            expect(config.apiKeyLength).toBe(64);
            expect(config.enableAuth).toBe(true);
        });

        it('should update config at runtime', () => {
            manager.updateConfig({ maxRequestsPerMinute: 200 });
            const config = manager.getConfig();
            expect(config.maxRequestsPerMinute).toBe(200);
        });

        it('should return a copy of config (not reference)', () => {
            const config = manager.getConfig();
            config.maxRequestsPerMinute = 9999;
            expect(manager.getConfig().maxRequestsPerMinute).toBe(120);
        });
    });

    // ==================== RESET ====================

    describe('Reset', () => {
        it('should clear all state on reset', () => {
            manager.generateApiKey('test', ['tasks:read']);
            manager.generateCsrfToken('session-1');
            manager.authenticate('coe_wrong', '10.0.0.1');
            manager.checkRateLimit('client-1');

            manager.reset();

            expect(manager.getAllApiKeys()).toHaveLength(0);
            expect(manager.getSecurityLog()).toHaveLength(0);
            expect(manager.getSecurityStats().totalEvents).toBe(0);
            expect(manager.getSecurityStats().activeKeys).toBe(0);
        });

        it('should reset id counter', () => {
            manager.generateApiKey('before', []);
            manager.reset();
            const key = manager.generateApiKey('after', []);
            expect(key.id).toBe('key-1');
        });
    });

    // ==================== EDGE CASES ====================

    describe('Edge Cases', () => {
        it('should handle empty permission list', () => {
            const key = manager.generateApiKey('empty', []);
            expect(manager.checkPermission(key, 'tasks', 'read')).toBe(false);
        });

        it('should handle authentication with empty string key', () => {
            const result = manager.authenticate('', '127.0.0.1');
            expect(result.authenticated).toBe(false);
        });

        it('should handle CSRF validation with empty token', () => {
            manager.generateCsrfToken('session-edge');
            expect(manager.validateCsrfToken('session-edge', '')).toBe(false);
        });

        it('should handle rate limit check with empty source', () => {
            const result = manager.checkRateLimit('');
            expect(result.allowed).toBe(true);
        });

        it('should handle concurrent key generation', () => {
            const keys: ApiKey[] = [];
            for (let i = 0; i < 100; i++) {
                keys.push(manager.generateApiKey('key-' + i, ['tasks:read']));
            }
            const uniqueIds = new Set(keys.map(k => k.id));
            const uniqueKeys = new Set(keys.map(k => k.key));
            expect(uniqueIds.size).toBe(100);
            expect(uniqueKeys.size).toBe(100);
        });
    });
});
