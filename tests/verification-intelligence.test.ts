import {
    VerificationIntelligence,
    AcceptanceCriterion,
    CoverageReport,
    FlakyTestResult,
    VerificationReport,
} from '../src/core/verification-intelligence';

describe('VerificationIntelligence', () => {
    let vi: VerificationIntelligence;

    beforeEach(() => {
        vi = new VerificationIntelligence();
    });

    afterEach(() => {
        vi.reset();
    });
    describe('parseAcceptanceCriteria', () => {
        test('parses a single criterion', () => {
            const result = vi.parseAcceptanceCriteria('Login form validates email format');
            expect(result).toHaveLength(1);
            expect(result[0].text).toBe('Login form validates email format');
            expect(result[0].matched).toBe(false);
            expect(result[0].confidence).toBe(0);
        });

        test('parses multi-line criteria with bullet points', () => {
            const text = `- Login form validates email format
- Password must be at least 8 characters
- Show error message on invalid input`;
            const result = vi.parseAcceptanceCriteria(text);
            expect(result).toHaveLength(3);
            expect(result[0].text).toBe('Login form validates email format');
            expect(result[1].text).toBe('Password must be at least 8 characters');
            expect(result[2].text).toBe('Show error message on invalid input');
        });

        test('parses numbered criteria', () => {
            const text = `1. Returns JWT token on success
2. Returns 401 on invalid credentials
3. Rate limits after 5 failed attempts`;
            const result = vi.parseAcceptanceCriteria(text);
            expect(result).toHaveLength(3);
            expect(result[0].text).toBe('Returns JWT token on success');
        });

        test('filters out short lines (<=5 chars)', () => {
            const text = `OK
This is a valid criterion
No`;
            const result = vi.parseAcceptanceCriteria(text);
            expect(result).toHaveLength(1);
            expect(result[0].text).toBe('This is a valid criterion');
        });

        test('returns empty array for empty text', () => {
            const result = vi.parseAcceptanceCriteria('');
            expect(result).toHaveLength(0);
        });

        test('handles criteria with special characters', () => {
            const text = 'GET /health returns {status: ok} with HTTP 200';
            const result = vi.parseAcceptanceCriteria(text);
            expect(result).toHaveLength(1);
            expect(result[0].keywords.length).toBeGreaterThan(0);
        });
    });

    describe('extractKeywords', () => {
        test('extracts meaningful keywords', () => {
            const keywords = vi.extractKeywords('Login form validates email format before submission');
            expect(keywords).toContain('login');
            expect(keywords).toContain('form');
            expect(keywords).toContain('validates');
            expect(keywords).toContain('email');
            expect(keywords).toContain('format');
            expect(keywords).toContain('submission');
        });

        test('filters out stopwords', () => {
            const keywords = vi.extractKeywords('The form should be validated before the user can submit');
            expect(keywords).not.toContain('the');
            expect(keywords).not.toContain('be');
            expect(keywords).not.toContain('can');
            expect(keywords).toContain('form');
            expect(keywords).toContain('validated');
        });

        test('filters out words with 2 or fewer characters', () => {
            const keywords = vi.extractKeywords('Go to page 5 if ok');
            expect(keywords).not.toContain('go');
            expect(keywords).not.toContain('ok');
        });

        test('converts to lowercase', () => {
            const keywords = vi.extractKeywords('API Endpoint Returns JSON');
            expect(keywords).toContain('api');
            expect(keywords).toContain('endpoint');
            expect(keywords).toContain('returns');
            expect(keywords).toContain('json');
        });

        test('strips special characters before extracting', () => {
            const keywords = vi.extractKeywords('status: ok with {code: 200}');
            expect(keywords).toContain('status');
            expect(keywords).toContain('code');
            expect(keywords).toContain('200');
        });

        test('returns empty array for empty text', () => {
            const keywords = vi.extractKeywords('');
            expect(keywords).toHaveLength(0);
        });
    });

    describe('matchCriteria', () => {
        test('matches criterion against test output containing keyword', () => {
            const criteria: AcceptanceCriterion[] = [{
                text: 'Login form validates email',
                keywords: ['login', 'form', 'validates', 'email'],
                matched: false, confidence: 0,
            }];
            const result = vi.matchCriteria(criteria, 'PASS: login form test validates email format', []);
            expect(result[0].matched).toBe(true);
            expect(result[0].confidence).toBeGreaterThanOrEqual(0.5);
        });

        test('matches criterion against changed file names', () => {
            const criteria: AcceptanceCriterion[] = [{
                text: 'Database migration runs',
                keywords: ['database', 'migration', 'runs'],
                matched: false, confidence: 0,
            }];
            const result = vi.matchCriteria(criteria, '', ['src/database/migration.ts']);
            expect(result[0].matched).toBe(true);
            expect(result[0].confidence).toBeGreaterThanOrEqual(0.5);
        });

        test('calculates confidence correctly', () => {
            const criteria: AcceptanceCriterion[] = [{
                text: 'test criterion',
                keywords: ['alpha', 'beta', 'gamma', 'delta'],
                matched: false, confidence: 0,
            }];
            const result = vi.matchCriteria(criteria, 'alpha beta', []);
            expect(result[0].confidence).toBe(0.5);
        });

        test('returns confidence 0 when no matches', () => {
            const criteria: AcceptanceCriterion[] = [{
                text: 'test criterion',
                keywords: ['foo', 'bar'],
                matched: false, confidence: 0,
            }];
            const result = vi.matchCriteria(criteria, 'completely unrelated output', []);
            expect(result[0].confidence).toBe(0);
            expect(result[0].matched).toBe(false);
        });

        test('handles partial matches below threshold', () => {
            const criteria: AcceptanceCriterion[] = [{
                text: 'test criterion',
                keywords: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'],
                matched: false, confidence: 0,
            }];
            const result = vi.matchCriteria(criteria, 'alpha only', []);
            expect(result[0].matched).toBe(false);
            expect(result[0].confidence).toBe(0.2);
        });

        test('handles all keywords matched (confidence = 1)', () => {
            const criteria: AcceptanceCriterion[] = [{
                text: 'test criterion',
                keywords: ['login', 'email'],
                matched: false, confidence: 0,
            }];
            const result = vi.matchCriteria(criteria, 'login email test', []);
            expect(result[0].confidence).toBe(1);
            expect(result[0].matched).toBe(true);
        });

        test('multiple criteria with mixed match results', () => {
            const criteria: AcceptanceCriterion[] = [
                { text: 'crit1', keywords: ['login', 'form'], matched: false, confidence: 0 },
                { text: 'crit2', keywords: ['xyz', 'abc'], matched: false, confidence: 0 },
            ];
            const result = vi.matchCriteria(criteria, 'login form test', []);
            expect(result[0].matched).toBe(true);
            expect(result[1].matched).toBe(false);
        });

        test('handles criterion with no keywords (confidence 0)', () => {
            const criteria: AcceptanceCriterion[] = [{
                text: 'empty', keywords: [], matched: false, confidence: 0,
            }];
            const result = vi.matchCriteria(criteria, 'some output', []);
            expect(result[0].confidence).toBe(0);
            expect(result[0].matched).toBe(false);
        });

        test('matchedBy includes details about what matched', () => {
            const criteria: AcceptanceCriterion[] = [{
                text: 'test', keywords: ['login'], matched: false, confidence: 0,
            }];
            const result = vi.matchCriteria(criteria, 'login test passed', []);
            expect(result[0].matchedBy).toContain('login');
        });

        test('matchedBy is undefined when no matches', () => {
            const criteria: AcceptanceCriterion[] = [{
                text: 'test', keywords: ['xyz'], matched: false, confidence: 0,
            }];
            const result = vi.matchCriteria(criteria, 'unrelated', []);
            expect(result[0].matchedBy).toBeUndefined();
        });
    });

    describe('parseCoverageOutput', () => {
        const sampleCoverage = [
            '----------|---------|----------|---------|---------|',
            'File      | % Stmts | % Branch | % Funcs | % Lines |',
            '----------|---------|----------|---------|---------|',
            'All files |   87.5  |    72.3  |   90.1  |   88.5  |',
            '----------|---------|----------|---------|---------|',
        ].join('\n');

        test('parses Jest coverage summary correctly', () => {
            const report = vi.parseCoverageOutput(sampleCoverage);
            expect(report.statements).toBe(87.5);
            expect(report.branches).toBe(72.3);
            expect(report.functions).toBe(90.1);
            expect(report.lines).toBe(88.5);
        });

        test('detects threshold met when all values above threshold', () => {
            const report = vi.parseCoverageOutput(sampleCoverage);
            expect(report.meetsThreshold).toBe(true);
        });

        test('detects threshold violation', () => {
            const lowCoverage = 'All files |   50.0  |    40.0  |   60.0  |   55.0  |';
            const report = vi.parseCoverageOutput(lowCoverage);
            expect(report.meetsThreshold).toBe(false);
        });

        test('finds uncovered files with <50% coverage', () => {
            const output = sampleCoverage + '\nutils.ts |   30.0  |    20.0  |   40.0  |   35.0  |';
            const report = vi.parseCoverageOutput(output);
            expect(report.uncoveredFiles).toContain('utils.ts');
        });

        test('calculates delta from previous run', () => {
            vi.parseCoverageOutput('All files |   80.0  |    70.0  |   80.0  |   80.0  |');
            const second = vi.parseCoverageOutput('All files |   85.0  |    75.0  |   82.0  |   84.0  |');
            expect(second.delta.statements).toBe(5);
            expect(second.delta.branches).toBe(5);
            expect(second.delta.functions).toBe(2);
            expect(second.delta.lines).toBe(4);
        });

        test('handles empty coverage output', () => {
            const report = vi.parseCoverageOutput('');
            expect(report.statements).toBe(0);
            expect(report.branches).toBe(0);
            expect(report.functions).toBe(0);
            expect(report.lines).toBe(0);
            expect(report.meetsThreshold).toBe(false);
        });

        test('handles custom thresholds', () => {
            vi.setCoverageThresholds({ statements: 90, branches: 85 });
            const report = vi.parseCoverageOutput(sampleCoverage);
            expect(report.threshold.statements).toBe(90);
            expect(report.threshold.branches).toBe(85);
            expect(report.threshold.functions).toBe(80);
            expect(report.threshold.lines).toBe(80);
            expect(report.meetsThreshold).toBe(false);
        });

        test('stores coverage in history', () => {
            vi.parseCoverageOutput(sampleCoverage);
            expect(vi.getCoverageHistory()).toHaveLength(1);
            vi.parseCoverageOutput(sampleCoverage);
            expect(vi.getCoverageHistory()).toHaveLength(2);
        });

        test('delta is zero on first run', () => {
            const report = vi.parseCoverageOutput(sampleCoverage);
            expect(report.delta.statements).toBe(0);
            expect(report.delta.branches).toBe(0);
            expect(report.delta.functions).toBe(0);
            expect(report.delta.lines).toBe(0);
        });

        test('does not include files with >= 50% coverage in uncoveredFiles', () => {
            const output = sampleCoverage + '\nhealthy.ts |   75.0  |    60.0  |   80.0  |   70.0  |';
            const report = vi.parseCoverageOutput(output);
            expect(report.uncoveredFiles).not.toContain('healthy.ts');
        });

        test('captures multiple uncovered files', () => {
            const output = [
                'All files |   80.0  |    70.0  |   80.0  |   80.0  |',
                'low-a.ts  |   20.0  |    10.0  |   15.0  |   18.0  |',
                'low-b.tsx |   30.0  |    25.0  |   28.0  |   22.0  |',
                'ok.ts     |   90.0  |    85.0  |   88.0  |   92.0  |',
            ].join('\n');
            const report = vi.parseCoverageOutput(output);
            expect(report.uncoveredFiles).toContain('low-a.ts');
            expect(report.uncoveredFiles).toContain('low-b.tsx');
            expect(report.uncoveredFiles).not.toContain('ok.ts');
        });

        test('handles negative delta when coverage decreases', () => {
            vi.parseCoverageOutput('All files |   90.0  |    85.0  |   90.0  |   90.0  |');
            const second = vi.parseCoverageOutput('All files |   80.0  |    70.0  |   75.0  |   78.0  |');
            expect(second.delta.statements).toBe(-10);
            expect(second.delta.branches).toBe(-15);
            expect(second.delta.functions).toBe(-15);
            expect(second.delta.lines).toBe(-12);
        });
    });

    describe('recordTestResults', () => {
        test('records results and stores them in test history keyed by suite::name', () => {
            vi.recordTestResults([
                { name: 'validates-email', suite: 'auth', passed: true },
            ]);
            const history = vi.getTestHistory();
            expect(history.has('auth::validates-email')).toBe(true);
            expect(history.get('auth::validates-email')).toEqual([true]);
        });

        test('appends to existing history on subsequent calls', () => {
            vi.recordTestResults([{ name: 'test-x', suite: 's1', passed: true }]);
            vi.recordTestResults([{ name: 'test-x', suite: 's1', passed: false }]);
            vi.recordTestResults([{ name: 'test-x', suite: 's1', passed: true }]);
            const history = vi.getTestHistory();
            expect(history.get('s1::test-x')).toEqual([true, false, true]);
        });

        test('caps history at 10 entries per test (shifts oldest)', () => {
            for (let i = 0; i < 15; i++) {
                vi.recordTestResults([{ name: 'capped', suite: 's', passed: i % 2 === 0 }]);
            }
            const history = vi.getTestHistory();
            const entries = history.get('s::capped')!;
            expect(entries).toHaveLength(10);
        });

        test('handles multiple tests in a single call', () => {
            vi.recordTestResults([
                { name: 'a', suite: 'core', passed: true },
                { name: 'b', suite: 'core', passed: false },
                { name: 'c', suite: 'util', passed: true },
            ]);
            const history = vi.getTestHistory();
            expect(history.size).toBe(3);
            expect(history.has('core::a')).toBe(true);
            expect(history.has('core::b')).toBe(true);
            expect(history.has('util::c')).toBe(true);
        });

        test('returns flaky test analysis from detectFlakyTests', () => {
            vi.recordTestResults([{ name: 'flicker', suite: 's', passed: true }]);
            vi.recordTestResults([{ name: 'flicker', suite: 's', passed: false }]);
            const flaky = vi.recordTestResults([{ name: 'flicker', suite: 's', passed: true }]);
            expect(Array.isArray(flaky)).toBe(true);
        });

        test('returns empty array when called with empty results', () => {
            const flaky = vi.recordTestResults([]);
            expect(flaky).toEqual([]);
        });
    });

    describe('detectFlakyTests', () => {
        test('ignores tests with fewer than 3 history entries', () => {
            vi.recordTestResults([{ name: 'new-test', suite: 's', passed: true }]);
            vi.recordTestResults([{ name: 'new-test', suite: 's', passed: false }]);
            const flaky = vi.detectFlakyTests();
            expect(flaky).toHaveLength(0);
        });

        test('identifies stable tests (passRate >= 0.95) and filters them out', () => {
            for (let i = 0; i < 5; i++) {
                vi.recordTestResults([{ name: 'solid', suite: 's', passed: true }]);
            }
            const flaky = vi.detectFlakyTests();
            const solidTest = flaky.find(f => f.testName === 'solid');
            expect(solidTest).toBeUndefined();
        });

        test('identifies always-failing tests (passRate <= 0.1) with failing recommendation', () => {
            for (let i = 0; i < 5; i++) {
                vi.recordTestResults([{ name: 'broken', suite: 's', passed: false }]);
            }
            const results = vi.detectFlakyTests();
            const broken = results.find(f => f.testName === 'broken');
            expect(broken).toBeDefined();
            expect(broken!.recommendation).toBe('failing');
            expect(broken!.isFlaky).toBe(false);
            expect(broken!.passRate).toBe(0);
        });

        test('identifies flaky tests for quarantine (passRate between 0.2 and 0.8)', () => {
            const mixedResults = [true, false, true, false, true, false];
            for (const passed of mixedResults) {
                vi.recordTestResults([{ name: 'intermittent', suite: 'flaky-suite', passed }]);
            }
            const results = vi.detectFlakyTests();
            const intermittent = results.find(f => f.testName === 'intermittent');
            expect(intermittent).toBeDefined();
            expect(intermittent!.isFlaky).toBe(true);
            expect(intermittent!.recommendation).toBe('quarantine');
            expect(intermittent!.passRate).toBe(0.5);
            expect(intermittent!.suite).toBe('flaky-suite');
        });

        test('identifies tests to investigate (passRate between 0.8-0.95 exclusive)', () => {
            const results = [true, true, true, true, true, true, true, true, true, false];
            for (const passed of results) {
                vi.recordTestResults([{ name: 'flicker', suite: 's', passed }]);
            }
            const detected = vi.detectFlakyTests();
            const flicker = detected.find(f => f.testName === 'flicker');
            expect(flicker).toBeDefined();
            expect(flicker!.recommendation).toBe('investigate');
        });

        test('returns lastNResults as a copy of history', () => {
            const pattern = [true, false, true, false, true];
            for (const passed of pattern) {
                vi.recordTestResults([{ name: 'hist', suite: 's', passed }]);
            }
            const results = vi.detectFlakyTests();
            const hist = results.find(f => f.testName === 'hist');
            expect(hist).toBeDefined();
            expect(hist!.lastNResults).toEqual(pattern);
        });

        test('handles multiple tests with different stability levels', () => {
            for (let i = 0; i < 5; i++) {
                vi.recordTestResults([{ name: 'rock', suite: 's', passed: true }]);
            }
            for (let i = 0; i < 5; i++) {
                vi.recordTestResults([{ name: 'crash', suite: 's', passed: false }]);
            }
            for (const p of [true, false, true, false, true]) {
                vi.recordTestResults([{ name: 'wobbly', suite: 's', passed: p }]);
            }
            const results = vi.detectFlakyTests();
            expect(results.find(f => f.testName === 'rock')).toBeUndefined();
            expect(results.find(f => f.testName === 'crash')).toBeDefined();
            expect(results.find(f => f.testName === 'wobbly')).toBeDefined();
        });

        test('returns empty array when no tests have been recorded', () => {
            const results = vi.detectFlakyTests();
            expect(results).toEqual([]);
        });
    });

    describe('generateReport', () => {
        test('generates passing report when all tests pass and criteria met', () => {
            const report = vi.generateReport(
                'task-1',
                'Login form validates email format',
                'PASS: login form validates email test passed',
                ['src/login-form.ts'],
                { total: 10, passed: 10, failed: 0, skipped: 0 }
            );
            expect(report.overallStatus).toBe('passed');
            expect(report.testResults.passed).toBe(10);
            expect(report.blockers).toHaveLength(0);
        });

        test('generates failing report when tests fail', () => {
            const report = vi.generateReport(
                'task-2',
                'Database migration runs successfully',
                'FAIL: migration test',
                ['src/db/migration.ts'],
                { total: 5, passed: 3, failed: 2, skipped: 0 }
            );
            expect(report.overallStatus).toBe('failed');
            expect(report.blockers.length).toBeGreaterThan(0);
            expect(report.blockers[0]).toContain('2 test(s) failing');
        });

        test('generates partial report when some criteria unmatched', () => {
            const criteria = `Login validates email
Password hashing uses bcrypt
Rate limiting on login endpoint`;
            const report = vi.generateReport(
                'task-3',
                criteria,
                'login email test passed validates',
                ['src/login.ts'],
                { total: 5, passed: 5, failed: 0, skipped: 0 }
            );
            expect(['passed', 'partial']).toContain(report.overallStatus);
        });

        test('generates needs_review report when criteria score is low', () => {
            const criteria = `Feature uses GraphQL subscriptions
WebSocket connection established`;
            const report = vi.generateReport(
                'task-4',
                criteria,
                'no relevant output here',
                ['src/unrelated.ts'],
                { total: 1, passed: 1, failed: 0, skipped: 0 }
            );
            expect(report.overallStatus).toBe('needs_review');
        });

        test('includes recommendations for unmatched criteria', () => {
            const report = vi.generateReport(
                'task-5',
                'Feature X does something specific',
                'unrelated output',
                [],
                { total: 5, passed: 5, failed: 0, skipped: 0 }
            );
            const recWithCriteria = report.recommendations.find(r => r.includes('acceptance criteria'));
            expect(recWithCriteria).toBeDefined();
        });

        test('includes blockers for failing tests', () => {
            const report = vi.generateReport(
                'task-6',
                'Something works',
                'FAIL',
                [],
                { total: 10, passed: 7, failed: 3, skipped: 0 }
            );
            expect(report.blockers).toContain('3 test(s) failing');
        });

        test('includes flaky test warnings in recommendations', () => {
            const results = [true, false, true, false, true];
            for (const passed of results) {
                vi.recordTestResults([{ name: 'flaky', suite: 's1', passed }]);
            }
            const report = vi.generateReport(
                'task-7',
                'Something works',
                'test output',
                [],
                { total: 5, passed: 5, failed: 0, skipped: 0 }
            );
            const flakyRec = report.recommendations.find(r => r.includes('flaky'));
            expect(flakyRec).toBeDefined();
        });

        test('handles task with no acceptance criteria', () => {
            const report = vi.generateReport(
                'task-8',
                '',
                'all tests pass',
                ['src/file.ts'],
                { total: 5, passed: 5, failed: 0, skipped: 0 }
            );
            expect(report.criteriaScore).toBe(100);
            expect(report.overallStatus).toBe('passed');
        });

        test('report includes correct taskId', () => {
            const report = vi.generateReport(
                'my-task-id-123',
                'something works',
                'output',
                [],
                { total: 1, passed: 1, failed: 0, skipped: 0 }
            );
            expect(report.taskId).toBe('my-task-id-123');
        });

        test('report includes valid ISO timestamp', () => {
            const before = new Date().toISOString();
            const report = vi.generateReport(
                'task-ts',
                'criterion text here',
                'output',
                [],
                { total: 1, passed: 1, failed: 0, skipped: 0 }
            );
            expect(report.timestamp).toBeDefined();
            expect(new Date(report.timestamp).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime() - 1000);
        });

        test('includes skipped test recommendation', () => {
            const report = vi.generateReport(
                'task-skip',
                '',
                'output',
                [],
                { total: 10, passed: 7, failed: 0, skipped: 3 }
            );
            const skipRec = report.recommendations.find(r => r.includes('skipped'));
            expect(skipRec).toBeDefined();
            expect(skipRec).toContain('3 test(s) skipped');
        });

        test('coverageReport is null by default', () => {
            const report = vi.generateReport(
                'task-cov',
                '',
                'output',
                [],
                { total: 1, passed: 1, failed: 0, skipped: 0 }
            );
            expect(report.coverageReport).toBeNull();
        });

        test('testResults matches the provided summary exactly', () => {
            const summary = { total: 25, passed: 20, failed: 3, skipped: 2 };
            const report = vi.generateReport(
                'task-summary',
                'criteria',
                'output',
                [],
                summary
            );
            expect(report.testResults).toEqual(summary);
        });

        test('generates partial when criteriaScore >= 50 but < 80 with passing tests', () => {
            const criteria = `- Database query optimization works
- Quantum flux capacitor stabilized`;
            const report = vi.generateReport(
                'task-partial',
                criteria,
                'database query optimization',
                ['src/database.ts'],
                { total: 5, passed: 5, failed: 0, skipped: 0 }
            );
            if (report.criteriaScore >= 50 && report.criteriaScore < 80) {
                expect(report.overallStatus).toBe('partial');
            }
        });
    });

    describe('setCoverageThresholds', () => {
        test('sets partial thresholds that merge with defaults', () => {
            vi.setCoverageThresholds({ statements: 95 });
            const report = vi.parseCoverageOutput('All files |   92.0  |    75.0  |   85.0  |   90.0  |');
            expect(report.threshold.statements).toBe(95);
            expect(report.threshold.branches).toBe(70);
            expect(report.threshold.functions).toBe(80);
            expect(report.threshold.lines).toBe(80);
            expect(report.meetsThreshold).toBe(false);
        });

        test('sets all custom thresholds at once', () => {
            vi.setCoverageThresholds({ statements: 50, branches: 50, functions: 50, lines: 50 });
            const report = vi.parseCoverageOutput('All files |   60.0  |    55.0  |   65.0  |   58.0  |');
            expect(report.threshold).toEqual({ statements: 50, branches: 50, functions: 50, lines: 50 });
            expect(report.meetsThreshold).toBe(true);
        });

        test('custom thresholds persist across multiple parseCoverageOutput calls', () => {
            vi.setCoverageThresholds({ lines: 95 });
            const first = vi.parseCoverageOutput('All files |   90.0  |    80.0  |   85.0  |   92.0  |');
            const second = vi.parseCoverageOutput('All files |   91.0  |    81.0  |   86.0  |   96.0  |');
            expect(first.threshold.lines).toBe(95);
            expect(first.meetsThreshold).toBe(false);
            expect(second.threshold.lines).toBe(95);
            expect(second.meetsThreshold).toBe(true);
        });
    });

    describe('getTestHistory / getCoverageHistory / reset', () => {
        test('getTestHistory returns the internal map with correct keys', () => {
            vi.recordTestResults([{ name: 'test-x', suite: 'suite-y', passed: true }]);
            const history = vi.getTestHistory();
            expect(history).toBeInstanceOf(Map);
            expect(history.size).toBe(1);
            expect(history.get('suite-y::test-x')).toEqual([true]);
        });

        test('getCoverageHistory returns array of all past coverage reports', () => {
            vi.parseCoverageOutput('All files |   80.0  |    70.0  |   80.0  |   80.0  |');
            vi.parseCoverageOutput('All files |   85.0  |    75.0  |   85.0  |   85.0  |');
            const history = vi.getCoverageHistory();
            expect(history).toHaveLength(2);
            expect(history[0].statements).toBe(80);
            expect(history[1].statements).toBe(85);
        });

        test('reset clears test history, coverage history, and custom thresholds', () => {
            vi.recordTestResults([{ name: 'a', suite: 'b', passed: true }]);
            vi.recordTestResults([{ name: 'a', suite: 'b', passed: false }]);
            vi.recordTestResults([{ name: 'a', suite: 'b', passed: true }]);
            vi.parseCoverageOutput('All files |   80.0  |    70.0  |   80.0  |   80.0  |');
            vi.setCoverageThresholds({ statements: 95 });

            expect(vi.getTestHistory().size).toBe(1);
            expect(vi.getCoverageHistory()).toHaveLength(1);

            vi.reset();

            expect(vi.getTestHistory().size).toBe(0);
            expect(vi.getCoverageHistory()).toHaveLength(0);

            const report = vi.parseCoverageOutput('All files |   82.0  |    72.0  |   82.0  |   82.0  |');
            expect(report.threshold.statements).toBe(80);
            expect(report.meetsThreshold).toBe(true);
        });

        test('reset allows fresh start with no delta calculation', () => {
            vi.parseCoverageOutput('All files |   80.0  |    70.0  |   80.0  |   80.0  |');
            vi.reset();
            const report = vi.parseCoverageOutput('All files |   90.0  |    75.0  |   85.0  |   88.0  |');
            expect(report.delta.statements).toBe(0);
            expect(report.delta.branches).toBe(0);
            expect(report.delta.functions).toBe(0);
            expect(report.delta.lines).toBe(0);
        });
    });

    describe('edge cases', () => {
        test('empty test output yields no criterion matches', () => {
            const criteria: AcceptanceCriterion[] = [{
                text: 'something works',
                keywords: ['something', 'works'],
                matched: false, confidence: 0,
            }];
            const result = vi.matchCriteria(criteria, '', []);
            expect(result[0].matched).toBe(false);
            expect(result[0].confidence).toBe(0);
        });

        test('no changed files still allows matching from test output', () => {
            const criteria: AcceptanceCriterion[] = [{
                text: 'database works',
                keywords: ['database', 'works'],
                matched: false, confidence: 0,
            }];
            const result = vi.matchCriteria(criteria, 'database works', []);
            expect(result[0].matched).toBe(true);
        });

        test('criteria with only spaces parses to empty', () => {
            const result = vi.parseAcceptanceCriteria('     ');
            expect(result).toHaveLength(0);
        });

        test('very long criteria text is parsed correctly', () => {
            const longLine = 'This is a very long acceptance criterion that goes on and on describing many requirements including database optimization and API performance and security and so on';
            const result = vi.parseAcceptanceCriteria(longLine);
            expect(result).toHaveLength(1);
            expect(result[0].keywords.length).toBeGreaterThan(3);
        });

        test('constructor initializes empty state', () => {
            const fresh = new VerificationIntelligence();
            expect(fresh.getTestHistory().size).toBe(0);
            expect(fresh.getCoverageHistory()).toHaveLength(0);
            expect(fresh.detectFlakyTests()).toHaveLength(0);
        });

        test('multiple suites with same test name are tracked separately', () => {
            for (let i = 0; i < 3; i++) {
                vi.recordTestResults([
                    { name: 'shared name', suite: 'suite-a', passed: true },
                    { name: 'shared name', suite: 'suite-b', passed: false },
                ]);
            }
            const history = vi.getTestHistory();
            expect(history.get('suite-a::shared name')).toEqual([true, true, true]);
            expect(history.get('suite-b::shared name')).toEqual([false, false, false]);
        });

        test('matching is case-insensitive for test output', () => {
            const criteria: AcceptanceCriterion[] = [{
                text: 'test', keywords: ['login'], matched: false, confidence: 0,
            }];
            const result = vi.matchCriteria(criteria, 'LOGIN TEST PASSED', []);
            expect(result[0].matched).toBe(true);
        });

        test('matching is case-insensitive for file names', () => {
            const criteria: AcceptanceCriterion[] = [{
                text: 'test', keywords: ['login'], matched: false, confidence: 0,
            }];
            const result = vi.matchCriteria(criteria, '', ['src/Login.ts']);
            expect(result[0].matched).toBe(true);
        });

        test('parseCoverageOutput with malformed data returns zeros', () => {
            const report = vi.parseCoverageOutput('This is not a coverage table at all');
            expect(report.statements).toBe(0);
            expect(report.branches).toBe(0);
            expect(report.functions).toBe(0);
            expect(report.lines).toBe(0);
            expect(report.meetsThreshold).toBe(false);
        });

        test('matchCriteria counts keyword in both test output and file names', () => {
            const criteria: AcceptanceCriterion[] = [{
                text: 'database test',
                keywords: ['database'],
                matched: false,
                confidence: 0,
            }];
            const result = vi.matchCriteria(criteria, 'database test passed', ['src/database.ts']);
            expect(result[0].confidence).toBeGreaterThan(1);
            expect(result[0].matched).toBe(true);
            expect(result[0].matchedBy).toContain('test output');
            expect(result[0].matchedBy).toContain('file name');
        });

        test('generateReport with zero tests and empty criteria gives partial status', () => {
            const report = vi.generateReport(
                'TASK-ZERO',
                '',
                '',
                [],
                { total: 0, passed: 0, failed: 0, skipped: 0 }
            );
            expect(report.overallStatus).toBe('partial');
            expect(report.criteriaScore).toBe(100);
            expect(report.blockers).toHaveLength(0);
        });
    });
});
