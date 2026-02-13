import { InputValidator } from '../src/core/input-validator';

describe('InputValidator', () => {

    // ==================== HTML SANITIZATION ====================

    test('sanitizeHtml escapes angle brackets', () => {
        expect(InputValidator.sanitizeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;');
    });

    test('sanitizeHtml escapes ampersands', () => {
        expect(InputValidator.sanitizeHtml('a & b')).toBe('a &amp; b');
    });

    test('sanitizeHtml escapes quotes', () => {
        expect(InputValidator.sanitizeHtml('He said "hello"')).toContain('&quot;');
    });

    test('sanitizeHtml handles single quotes', () => {
        expect(InputValidator.sanitizeHtml("it's")).toContain('&#x27;');
    });

    test('sanitizeHtml returns empty string for non-string', () => {
        expect(InputValidator.sanitizeHtml(null as any)).toBe('');
        expect(InputValidator.sanitizeHtml(undefined as any)).toBe('');
        expect(InputValidator.sanitizeHtml(123 as any)).toBe('');
    });

    test('sanitizeHtml leaves safe text unchanged', () => {
        expect(InputValidator.sanitizeHtml('Hello World 123')).toBe('Hello World 123');
    });

    // ==================== TASK TITLE ====================

    test('validateTaskTitle rejects empty string', () => {
        const result = InputValidator.validateTaskTitle('');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('required');
    });

    test('validateTaskTitle rejects non-string', () => {
        expect(InputValidator.validateTaskTitle(123).valid).toBe(false);
        expect(InputValidator.validateTaskTitle(null).valid).toBe(false);
        expect(InputValidator.validateTaskTitle(undefined).valid).toBe(false);
    });

    test('validateTaskTitle trims whitespace', () => {
        const result = InputValidator.validateTaskTitle('  Hello World  ');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('Hello World');
    });

    test('validateTaskTitle rejects >500 chars', () => {
        const longTitle = 'x'.repeat(501);
        expect(InputValidator.validateTaskTitle(longTitle).valid).toBe(false);
    });

    test('validateTaskTitle accepts valid title', () => {
        const result = InputValidator.validateTaskTitle('Create user login endpoint');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('Create user login endpoint');
    });

    // ==================== PRIORITY ====================

    test('validatePriority accepts P1, P2, P3', () => {
        expect(InputValidator.validatePriority('P1').valid).toBe(true);
        expect(InputValidator.validatePriority('P2').valid).toBe(true);
        expect(InputValidator.validatePriority('P3').valid).toBe(true);
    });

    test('validatePriority rejects invalid priority', () => {
        expect(InputValidator.validatePriority('P4').valid).toBe(false);
        expect(InputValidator.validatePriority('high').valid).toBe(false);
        expect(InputValidator.validatePriority(1).valid).toBe(false);
    });

    test('validatePriority defaults to P2 on invalid', () => {
        expect(InputValidator.validatePriority('invalid').value).toBe('P2');
    });

    // ==================== MINUTES ====================

    test('validateMinutes accepts valid number', () => {
        expect(InputValidator.validateMinutes(30).valid).toBe(true);
        expect(InputValidator.validateMinutes(30).value).toBe(30);
    });

    test('validateMinutes parses string to number', () => {
        expect(InputValidator.validateMinutes('45').valid).toBe(true);
        expect(InputValidator.validateMinutes('45').value).toBe(45);
    });

    test('validateMinutes rounds to integer', () => {
        expect(InputValidator.validateMinutes(30.5).value).toBe(31);
    });

    test('validateMinutes rejects out of range', () => {
        expect(InputValidator.validateMinutes(0).valid).toBe(false);
        expect(InputValidator.validateMinutes(10000).valid).toBe(false);
        expect(InputValidator.validateMinutes(-5).valid).toBe(false);
    });

    test('validateMinutes rejects NaN', () => {
        expect(InputValidator.validateMinutes('abc').valid).toBe(false);
        expect(InputValidator.validateMinutes(NaN).valid).toBe(false);
    });

    // ==================== URL ====================

    test('validateUrl accepts valid URL', () => {
        expect(InputValidator.validateUrl('https://example.com').valid).toBe(true);
        expect(InputValidator.validateUrl('http://localhost:3030').valid).toBe(true);
    });

    test('validateUrl rejects invalid URL', () => {
        expect(InputValidator.validateUrl('not-a-url').valid).toBe(false);
        expect(InputValidator.validateUrl('').valid).toBe(false);
    });

    test('validateUrl rejects non-string', () => {
        expect(InputValidator.validateUrl(123).valid).toBe(false);
    });

    // ==================== EMAIL ====================

    test('validateEmail accepts valid email', () => {
        expect(InputValidator.validateEmail('user@example.com').valid).toBe(true);
    });

    test('validateEmail lowercases email', () => {
        expect(InputValidator.validateEmail('User@EXAMPLE.COM').value).toBe('user@example.com');
    });

    test('validateEmail rejects invalid email', () => {
        expect(InputValidator.validateEmail('not-an-email').valid).toBe(false);
        expect(InputValidator.validateEmail('@missing.com').valid).toBe(false);
        expect(InputValidator.validateEmail('user@').valid).toBe(false);
    });

    // ==================== UUID ====================

    test('validateId accepts valid UUID', () => {
        expect(InputValidator.validateId('550e8400-e29b-41d4-a716-446655440000').valid).toBe(true);
    });

    test('validateId rejects invalid UUID', () => {
        expect(InputValidator.validateId('not-a-uuid').valid).toBe(false);
        expect(InputValidator.validateId('').valid).toBe(false);
        expect(InputValidator.validateId(123).valid).toBe(false);
    });

    // ==================== STRING ====================

    test('validateString accepts valid string', () => {
        expect(InputValidator.validateString('Hello').valid).toBe(true);
    });

    test('validateString trims whitespace', () => {
        expect(InputValidator.validateString('  Hello  ').value).toBe('Hello');
    });

    test('validateString rejects too long', () => {
        expect(InputValidator.validateString('x'.repeat(101), 100).valid).toBe(false);
    });

    test('validateString rejects non-string', () => {
        expect(InputValidator.validateString(123).valid).toBe(false);
    });

    // ==================== NUMBER ====================

    test('validateNumber accepts valid number', () => {
        expect(InputValidator.validateNumber(42, 0, 100).valid).toBe(true);
    });

    test('validateNumber parses string', () => {
        expect(InputValidator.validateNumber('42', 0, 100).value).toBe(42);
    });

    test('validateNumber rejects out of range', () => {
        expect(InputValidator.validateNumber(200, 0, 100).valid).toBe(false);
        expect(InputValidator.validateNumber(-1, 0, 100).valid).toBe(false);
    });

    test('validateNumber rejects NaN', () => {
        expect(InputValidator.validateNumber('abc').valid).toBe(false);
    });

    // ==================== STRING ARRAY ====================

    test('validateStringArray accepts valid array', () => {
        expect(InputValidator.validateStringArray(['a', 'b', 'c']).valid).toBe(true);
        expect(InputValidator.validateStringArray(['a', 'b', 'c']).value).toEqual(['a', 'b', 'c']);
    });

    test('validateStringArray filters non-strings', () => {
        expect(InputValidator.validateStringArray(['a', 123, 'b'] as any).value).toEqual(['a', 'b']);
    });

    test('validateStringArray rejects non-array', () => {
        expect(InputValidator.validateStringArray('not-array').valid).toBe(false);
    });

    test('validateStringArray rejects too many items', () => {
        const big = Array(101).fill('item');
        expect(InputValidator.validateStringArray(big, 100).valid).toBe(false);
    });

    // ==================== JSON ====================

    test('validateJson accepts valid JSON string', () => {
        expect(InputValidator.validateJson('{"key":"value"}').valid).toBe(true);
        expect(InputValidator.validateJson('{"key":"value"}').value).toEqual({ key: 'value' });
    });

    test('validateJson accepts object directly', () => {
        expect(InputValidator.validateJson({ key: 'value' }).valid).toBe(true);
    });

    test('validateJson rejects invalid JSON', () => {
        expect(InputValidator.validateJson('not json').valid).toBe(false);
    });

    test('validateJson rejects non-object JSON', () => {
        expect(InputValidator.validateJson('"just a string"').valid).toBe(false);
    });

    // ==================== COLOR ====================

    test('validateColor accepts hex colors', () => {
        expect(InputValidator.validateColor('#fff').valid).toBe(true);
        expect(InputValidator.validateColor('#89b4fa').valid).toBe(true);
        expect(InputValidator.validateColor('#89b4fa99').valid).toBe(true);
    });

    test('validateColor accepts rgb/rgba', () => {
        expect(InputValidator.validateColor('rgb(255, 0, 0)').valid).toBe(true);
        expect(InputValidator.validateColor('rgba(255, 0, 0, 0.5)').valid).toBe(true);
    });

    test('validateColor accepts named colors', () => {
        expect(InputValidator.validateColor('red').valid).toBe(true);
        expect(InputValidator.validateColor('transparent').valid).toBe(true);
    });

    test('validateColor rejects invalid', () => {
        expect(InputValidator.validateColor('not-a-color').valid).toBe(false);
        expect(InputValidator.validateColor('#gggggg').valid).toBe(false);
    });

    // ==================== COMPONENT TYPE ====================

    test('validateComponentType accepts all 17 types', () => {
        const types = ['container', 'text', 'button', 'input', 'image', 'card', 'nav', 'modal', 'sidebar', 'header', 'footer', 'list', 'table', 'form', 'divider', 'icon', 'custom'];
        for (const type of types) {
            expect(InputValidator.validateComponentType(type).valid).toBe(true);
        }
    });

    test('validateComponentType rejects invalid type', () => {
        expect(InputValidator.validateComponentType('invalid').valid).toBe(false);
        expect(InputValidator.validateComponentType(123).valid).toBe(false);
    });

    // ==================== RATE LIMITER ====================

    test('checkRateLimit allows within limit', () => {
        InputValidator.resetRateLimits();
        for (let i = 0; i < 60; i++) {
            expect(InputValidator.checkRateLimit('test-key')).toBe(true);
        }
    });

    test('checkRateLimit blocks when exhausted', () => {
        InputValidator.resetRateLimits();
        // Exhaust the bucket (60 tokens default)
        for (let i = 0; i < 60; i++) {
            InputValidator.checkRateLimit('exhaust-key');
        }
        expect(InputValidator.checkRateLimit('exhaust-key')).toBe(false);
    });

    test('checkRateLimit different keys are independent', () => {
        InputValidator.resetRateLimits();
        for (let i = 0; i < 60; i++) {
            InputValidator.checkRateLimit('key-a');
        }
        expect(InputValidator.checkRateLimit('key-a')).toBe(false);
        expect(InputValidator.checkRateLimit('key-b')).toBe(true); // different key
    });

    test('resetRateLimits clears all buckets', () => {
        InputValidator.resetRateLimits();
        for (let i = 0; i < 60; i++) {
            InputValidator.checkRateLimit('reset-key');
        }
        expect(InputValidator.checkRateLimit('reset-key')).toBe(false);
        InputValidator.resetRateLimits();
        expect(InputValidator.checkRateLimit('reset-key')).toBe(true);
    });

    // ==================== EDGE CASES ====================

    test('sanitizeHtml handles empty string', () => {
        expect(InputValidator.sanitizeHtml('')).toBe('');
    });

    test('validateTaskTitle with only whitespace', () => {
        expect(InputValidator.validateTaskTitle('   ').valid).toBe(false);
    });

    test('validateMinutes with boundary values', () => {
        expect(InputValidator.validateMinutes(1).valid).toBe(true);
        expect(InputValidator.validateMinutes(9999).valid).toBe(true);
    });

    test('validateColor with hsl', () => {
        expect(InputValidator.validateColor('hsl(120, 100%, 50%)').valid).toBe(true);
    });

    test('validateString with exactly max length', () => {
        expect(InputValidator.validateString('x'.repeat(100), 100).valid).toBe(true);
    });

    test('validateNumber with float', () => {
        expect(InputValidator.validateNumber(3.14, 0, 10).valid).toBe(true);
        expect(InputValidator.validateNumber(3.14, 0, 10).value).toBe(3.14);
    });
});
