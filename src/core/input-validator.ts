/**
 * InputValidator — Centralized input validation and sanitization
 *
 * Prevents XSS, SQL injection (defense-in-depth), and malformed data.
 * Used by all API endpoints and agent inputs.
 */

export class InputValidator {
    /**
     * Sanitize a string for safe HTML display (prevents XSS)
     */
    static sanitizeHtml(input: string): string {
        if (typeof input !== 'string') return '';
        return input
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;')
            .replace(/\//g, '&#x2F;');
    }

    /**
     * Validate and sanitize a task title
     */
    static validateTaskTitle(title: unknown): { valid: boolean; value: string; error?: string } {
        if (typeof title !== 'string' || !title.trim()) {
            return { valid: false, value: '', error: 'Title is required and must be a non-empty string' };
        }
        const cleaned = title.trim();
        if (cleaned.length > 500) {
            return { valid: false, value: '', error: 'Title must be 500 characters or less' };
        }
        return { valid: true, value: cleaned };
    }

    /**
     * Validate a priority value
     */
    static validatePriority(priority: unknown): { valid: boolean; value: string; error?: string } {
        const validPriorities = ['P1', 'P2', 'P3'];
        if (typeof priority !== 'string' || !validPriorities.includes(priority)) {
            return { valid: false, value: 'P2', error: `Priority must be one of: ${validPriorities.join(', ')}` };
        }
        return { valid: true, value: priority };
    }

    /**
     * Validate estimated minutes
     */
    static validateMinutes(minutes: unknown): { valid: boolean; value: number; error?: string } {
        const num = typeof minutes === 'number' ? minutes : parseInt(String(minutes));
        if (isNaN(num) || num < 1 || num > 9999) {
            return { valid: false, value: 30, error: 'Minutes must be between 1 and 9999' };
        }
        return { valid: true, value: Math.round(num) };
    }

    /**
     * Validate a URL
     */
    static validateUrl(url: unknown): { valid: boolean; value: string; error?: string } {
        if (typeof url !== 'string' || !url.trim()) {
            return { valid: false, value: '', error: 'URL is required' };
        }
        try {
            new URL(url);
            return { valid: true, value: url.trim() };
        } catch {
            return { valid: false, value: '', error: 'Invalid URL format' };
        }
    }

    /**
     * Validate an email address
     */
    static validateEmail(email: unknown): { valid: boolean; value: string; error?: string } {
        if (typeof email !== 'string') return { valid: false, value: '', error: 'Email must be a string' };
        const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!pattern.test(email)) return { valid: false, value: '', error: 'Invalid email format' };
        return { valid: true, value: email.trim().toLowerCase() };
    }

    /**
     * Validate a UUID
     */
    static validateId(id: unknown): { valid: boolean; value: string; error?: string } {
        if (typeof id !== 'string') return { valid: false, value: '', error: 'ID must be a string' };
        const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!pattern.test(id)) return { valid: false, value: '', error: 'Invalid UUID format' };
        return { valid: true, value: id };
    }

    /**
     * Validate a non-empty string with max length
     */
    static validateString(input: unknown, maxLength: number = 10000): { valid: boolean; value: string; error?: string } {
        if (typeof input !== 'string') return { valid: false, value: '', error: 'Must be a string' };
        const trimmed = input.trim();
        if (trimmed.length > maxLength) return { valid: false, value: '', error: `Must be ${maxLength} characters or less` };
        return { valid: true, value: trimmed };
    }

    /**
     * Validate a number within range
     */
    static validateNumber(input: unknown, min: number = 0, max: number = 999999): { valid: boolean; value: number; error?: string } {
        const num = typeof input === 'number' ? input : parseFloat(String(input));
        if (isNaN(num)) return { valid: false, value: min, error: 'Must be a number' };
        if (num < min || num > max) return { valid: false, value: min, error: `Must be between ${min} and ${max}` };
        return { valid: true, value: num };
    }

    /**
     * Validate an array of strings
     */
    static validateStringArray(input: unknown, maxItems: number = 100): { valid: boolean; value: string[]; error?: string } {
        if (!Array.isArray(input)) return { valid: false, value: [], error: 'Must be an array' };
        if (input.length > maxItems) return { valid: false, value: [], error: `Max ${maxItems} items` };
        const cleaned = input.filter(item => typeof item === 'string').map(s => s.trim());
        return { valid: true, value: cleaned };
    }

    /**
     * Validate JSON string is parseable
     */
    static validateJson(input: unknown): { valid: boolean; value: Record<string, unknown>; error?: string } {
        if (typeof input === 'object' && input !== null) return { valid: true, value: input as Record<string, unknown> };
        if (typeof input !== 'string') return { valid: false, value: {}, error: 'Must be a JSON string or object' };
        try {
            const parsed = JSON.parse(input);
            if (typeof parsed !== 'object' || parsed === null) return { valid: false, value: {}, error: 'Must parse to an object' };
            return { valid: true, value: parsed };
        } catch {
            return { valid: false, value: {}, error: 'Invalid JSON' };
        }
    }

    /**
     * Validate CSS color value
     */
    static validateColor(input: unknown): { valid: boolean; value: string; error?: string } {
        if (typeof input !== 'string') return { valid: false, value: '#000000', error: 'Must be a string' };
        const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
        const rgb = /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/;
        const hsl = /^hsla?\(\s*\d+\s*,\s*\d+%?\s*,\s*\d+%?/;
        const named = /^(transparent|black|white|red|green|blue|yellow|orange|purple|pink|gray|grey)$/i;
        if (hex.test(input) || rgb.test(input) || hsl.test(input) || named.test(input)) {
            return { valid: true, value: input };
        }
        return { valid: false, value: '#000000', error: 'Invalid color format' };
    }

    /**
     * Validate component type
     */
    static validateComponentType(input: unknown): { valid: boolean; value: string; error?: string } {
        const validTypes = ['container', 'text', 'button', 'input', 'image', 'card', 'nav', 'modal', 'sidebar', 'header', 'footer', 'list', 'table', 'form', 'divider', 'icon', 'custom'];
        if (typeof input !== 'string' || !validTypes.includes(input)) {
            return { valid: false, value: 'container', error: `Type must be one of: ${validTypes.join(', ')}` };
        }
        return { valid: true, value: input };
    }

    /**
     * Rate limiter — simple token bucket
     */
    private static rateLimitBuckets: Map<string, { tokens: number; lastRefill: number }> = new Map();

    static checkRateLimit(key: string, maxTokens: number = 60, refillRate: number = 1): boolean {
        const now = Date.now();
        let bucket = this.rateLimitBuckets.get(key);
        if (!bucket) {
            bucket = { tokens: maxTokens, lastRefill: now };
            this.rateLimitBuckets.set(key, bucket);
        }
        // Refill tokens
        const elapsed = (now - bucket.lastRefill) / 1000;
        bucket.tokens = Math.min(maxTokens, bucket.tokens + elapsed * refillRate);
        bucket.lastRefill = now;
        // Consume
        if (bucket.tokens >= 1) {
            bucket.tokens--;
            return true;
        }
        return false;
    }

    static resetRateLimits(): void {
        this.rateLimitBuckets.clear();
    }
}
