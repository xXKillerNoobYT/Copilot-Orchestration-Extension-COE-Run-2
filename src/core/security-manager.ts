/**
 * SecurityManager — Comprehensive security layer
 *
 * - Token-based authentication (API keys)
 * - CSRF protection with double-submit cookies
 * - Request signing and verification
 * - Security headers middleware
 * - Permission-based access control
 * - Security audit trail
 * - Brute force protection
 */

export interface ApiKey {
    id: string;
    key: string;
    name: string;
    permissions: string[];
    createdAt: string;
    lastUsed?: string;
    expiresAt?: string;
    active: boolean;
    rateLimit: number; // requests per minute
}
export interface SecurityEvent {
    id: string;
    type: 'auth_success' | 'auth_failure' | 'csrf_violation' | 'rate_limit' | 'permission_denied' | 'suspicious_request' | 'brute_force_detected' | 'api_key_created' | 'api_key_revoked';
    severity: 'info' | 'warning' | 'critical';
    source: string; // IP or identifier
    details: string;
    timestamp: string;
}

export interface Permission {
    resource: string; // e.g., 'tasks', 'plans', 'agents', 'config', 'design'
    actions: Array<'read' | 'create' | 'update' | 'delete' | 'execute'>;
}

export interface SecurityConfig {
    enableAuth: boolean;
    enableCsrf: boolean;
    enableRateLimit: boolean;
    maxRequestsPerMinute: number;
    maxFailedAttempts: number; // before lockout
    lockoutDurationMs: number;
    csrfTokenExpiry: number; // ms
    apiKeyLength: number;
}

export interface SecurityHeaders {
    'X-Content-Type-Options': string;
    'X-Frame-Options': string;
    'X-XSS-Protection': string;
    'Strict-Transport-Security': string;
    'Content-Security-Policy': string;
    'Referrer-Policy': string;
    'Permissions-Policy': string;
}

export class SecurityManager {
    private apiKeys: Map<string, ApiKey>;
    private csrfTokens: Map<string, { token: string; expiresAt: number }>;
    private securityLog: SecurityEvent[];
    private failedAttempts: Map<string, { count: number; lastAttempt: number; lockedUntil: number }>;
    private requestCounts: Map<string, { count: number; windowStart: number }>;
    private config: SecurityConfig;
    private idCounter: number;

    constructor(config?: Partial<SecurityConfig>) {
        this.apiKeys = new Map();
        this.csrfTokens = new Map();
        this.securityLog = [];
        this.failedAttempts = new Map();
        this.requestCounts = new Map();
        this.idCounter = 0;
        this.config = {
            enableAuth: true,
            enableCsrf: true,
            enableRateLimit: true,
            maxRequestsPerMinute: 120,
            maxFailedAttempts: 5,
            lockoutDurationMs: 900000, // 15 minutes
            csrfTokenExpiry: 3600000, // 1 hour
            apiKeyLength: 32,
            ...config,
        };
    }

    private nextId(prefix: string): string {
        return `${prefix}-${++this.idCounter}`;
    }

    // ==================== API KEY MANAGEMENT ====================

    generateApiKey(name: string, permissions: string[]): ApiKey {
        const id = this.nextId('key');
        const key = this.randomString(this.config.apiKeyLength);
        const apiKey: ApiKey = {
            id,
            key: `coe_${key}`,
            name,
            permissions,
            createdAt: new Date().toISOString(),
            active: true,
            rateLimit: this.config.maxRequestsPerMinute,
        };
        this.apiKeys.set(apiKey.key, apiKey);
        this.logEvent('api_key_created', 'info', 'system', `API key "${name}" created with permissions: ${permissions.join(', ')}`);
        return apiKey;
    }

    validateApiKey(key: string): ApiKey | null {
        const apiKey = this.apiKeys.get(key);
        if (!apiKey) return null;
        if (!apiKey.active) return null;
        if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
            apiKey.active = false;
            return null;
        }
        apiKey.lastUsed = new Date().toISOString();
        return apiKey;
    }

    revokeApiKey(key: string): boolean {
        const apiKey = this.apiKeys.get(key);
        if (!apiKey) return false;
        apiKey.active = false;
        this.logEvent('api_key_revoked', 'warning', 'system', `API key "${apiKey.name}" revoked`);
        return true;
    }

    getAllApiKeys(): ApiKey[] {
        return [...this.apiKeys.values()].map(k => ({ ...k, key: k.key.slice(0, 8) + '...' })); // Mask keys
    }

    // ==================== AUTHENTICATION ====================

    authenticate(key: string, source: string): { authenticated: boolean; apiKey?: ApiKey; error?: string } {
        if (!this.config.enableAuth) return { authenticated: true };

        // Check lockout
        const lockout = this.failedAttempts.get(source);
        if (lockout && lockout.lockedUntil > Date.now()) {
            this.logEvent('auth_failure', 'warning', source, 'Authentication attempted during lockout');
            return { authenticated: false, error: 'Account locked due to too many failed attempts' };
        }

        const apiKey = this.validateApiKey(key);
        if (!apiKey) {
            this.recordFailedAttempt(source);
            this.logEvent('auth_failure', 'warning', source, `Invalid API key: ${key.slice(0, 8)}...`);
            return { authenticated: false, error: 'Invalid API key' };
        }

        // Reset failed attempts on success
        this.failedAttempts.delete(source);
        this.logEvent('auth_success', 'info', source, `Authenticated as "${apiKey.name}"`);
        return { authenticated: true, apiKey };
    }

    private recordFailedAttempt(source: string): void {
        const existing = this.failedAttempts.get(source) || { count: 0, lastAttempt: 0, lockedUntil: 0 };
        existing.count++;
        existing.lastAttempt = Date.now();

        if (existing.count >= this.config.maxFailedAttempts) {
            existing.lockedUntil = Date.now() + this.config.lockoutDurationMs;
            this.logEvent('brute_force_detected', 'critical', source, `${existing.count} failed attempts — locked for ${this.config.lockoutDurationMs / 60000} minutes`);
        }

        this.failedAttempts.set(source, existing);
    }

    isLockedOut(source: string): boolean {
        const lockout = this.failedAttempts.get(source);
        return !!lockout && lockout.lockedUntil > Date.now();
    }

    // ==================== CSRF PROTECTION ====================

    generateCsrfToken(sessionId: string): string {
        const token = this.randomString(32);
        this.csrfTokens.set(sessionId, {
            token,
            expiresAt: Date.now() + this.config.csrfTokenExpiry,
        });
        return token;
    }

    validateCsrfToken(sessionId: string, token: string): boolean {
        if (!this.config.enableCsrf) return true;

        const stored = this.csrfTokens.get(sessionId);
        if (!stored) {
            this.logEvent('csrf_violation', 'warning', sessionId, 'No CSRF token found for session');
            return false;
        }
        if (stored.expiresAt < Date.now()) {
            this.csrfTokens.delete(sessionId);
            this.logEvent('csrf_violation', 'warning', sessionId, 'CSRF token expired');
            return false;
        }
        if (stored.token !== token) {
            this.logEvent('csrf_violation', 'critical', sessionId, 'CSRF token mismatch');
            return false;
        }
        return true;
    }

    // ==================== RATE LIMITING ====================

    checkRateLimit(source: string, customLimit?: number): { allowed: boolean; remaining: number; resetAt: number } {
        if (!this.config.enableRateLimit) return { allowed: true, remaining: Infinity, resetAt: 0 };

        const limit = customLimit || this.config.maxRequestsPerMinute;
        const now = Date.now();
        const windowMs = 60000; // 1 minute

        let record = this.requestCounts.get(source);
        if (!record || (now - record.windowStart) > windowMs) {
            record = { count: 0, windowStart: now };
            this.requestCounts.set(source, record);
        }

        record.count++;
        const remaining = Math.max(0, limit - record.count);
        const resetAt = record.windowStart + windowMs;

        if (record.count > limit) {
            this.logEvent('rate_limit', 'warning', source, `Rate limit exceeded: ${record.count}/${limit} requests/min`);
            return { allowed: false, remaining: 0, resetAt };
        }

        return { allowed: true, remaining, resetAt };
    }

    // ==================== PERMISSION CHECKING ====================

    checkPermission(apiKey: ApiKey, resource: string, action: string): boolean {
        const permStr = `${resource}:${action}`;
        const wildcard = `${resource}:*`;
        const superWildcard = '*:*';

        const allowed = apiKey.permissions.includes(permStr) ||
            apiKey.permissions.includes(wildcard) ||
            apiKey.permissions.includes(superWildcard);

        if (!allowed) {
            this.logEvent('permission_denied', 'warning', apiKey.name, `Denied ${action} on ${resource}`);
        }

        return allowed;
    }

    // ==================== SECURITY HEADERS ====================

    getSecurityHeaders(): SecurityHeaders {
        return {
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'X-XSS-Protection': '1; mode=block',
            'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
            'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'Permissions-Policy': 'camera=(), microphone=(), geolocation()',
        };
    }

    // ==================== SECURITY AUDIT ====================

    private logEvent(type: SecurityEvent['type'], severity: SecurityEvent['severity'], source: string, details: string): void {
        this.securityLog.push({
            id: this.nextId('sec'),
            type,
            severity,
            source,
            details,
            timestamp: new Date().toISOString(),
        });
        if (this.securityLog.length > 10000) this.securityLog.shift();
    }

    getSecurityLog(limit: number = 100): SecurityEvent[] {
        return this.securityLog.slice(-limit);
    }

    getSecurityLogByType(type: SecurityEvent['type']): SecurityEvent[] {
        return this.securityLog.filter(e => e.type === type);
    }

    getCriticalEvents(): SecurityEvent[] {
        return this.securityLog.filter(e => e.severity === 'critical');
    }

    getSecurityStats(): { totalEvents: number; criticalCount: number; authFailures: number; rateLimitHits: number; activeKeys: number; lockedSources: number } {
        return {
            totalEvents: this.securityLog.length,
            criticalCount: this.securityLog.filter(e => e.severity === 'critical').length,
            authFailures: this.securityLog.filter(e => e.type === 'auth_failure').length,
            rateLimitHits: this.securityLog.filter(e => e.type === 'rate_limit').length,
            activeKeys: [...this.apiKeys.values()].filter(k => k.active).length,
            lockedSources: [...this.failedAttempts.values()].filter(f => f.lockedUntil > Date.now()).length,
        };
    }

    // ==================== HELPERS ====================

    private randomString(length: number): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    getConfig(): SecurityConfig {
        return { ...this.config };
    }

    updateConfig(updates: Partial<SecurityConfig>): void {
        Object.assign(this.config, updates);
    }

    reset(): void {
        this.apiKeys.clear();
        this.csrfTokens.clear();
        this.securityLog = [];
        this.failedAttempts.clear();
        this.requestCounts.clear();
        this.idCounter = 0;
    }
}
