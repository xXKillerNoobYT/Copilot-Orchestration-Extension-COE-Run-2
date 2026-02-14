/**
 * TestRunnerService Tests (1.3.2)
 * Tests parsing of Jest output formats and error handling.
 */

import { TestRunnerService, TestRunResult } from '../src/core/test-runner';
import * as childProcess from 'child_process';

// Mock child_process
jest.mock('child_process', () => ({
    exec: jest.fn(),
}));

const mockExec = childProcess.exec as unknown as jest.Mock;
const mockOutput = { appendLine: jest.fn() } as any;

describe('TestRunnerService', () => {
    let runner: TestRunnerService;

    beforeEach(() => {
        runner = new TestRunnerService('/workspace', mockOutput);
        mockExec.mockReset();
        mockOutput.appendLine.mockReset();
    });

    test('parses Jest text output with pass/fail counts', async () => {
        mockExec.mockImplementation((_cmd: string, _opts: any, callback: Function) => {
            callback(null,
                'Tests:   2 failed, 8 passed, 10 total\nTime:    3.5s',
                ''
            );
        });

        const result = await runner.runTests('npx jest');
        expect(result.passed).toBe(8);
        expect(result.failed).toBe(2);
        expect(result.success).toBe(false);
    });

    test('parses Jest text output with all passing', async () => {
        mockExec.mockImplementation((_cmd: string, _opts: any, callback: Function) => {
            callback(null,
                'Tests:   12 passed, 12 total\nTime:    2.1s',
                ''
            );
        });

        const result = await runner.runTests();
        expect(result.passed).toBe(12);
        expect(result.failed).toBe(0);
        expect(result.success).toBe(true);
    });

    test('parses coverage from Jest output', async () => {
        mockExec.mockImplementation((_cmd: string, _opts: any, callback: Function) => {
            callback(null,
                'Tests:   5 passed, 5 total\nAll files  |   87.5 |    82.3 |   90.1 |   87.5 |\nTime: 4s',
                ''
            );
        });

        const result = await runner.runTests();
        expect(result.coverage).toBe(87.5);
    });

    test('handles exec error gracefully', async () => {
        mockExec.mockImplementation((_cmd: string, _opts: any, callback: Function) => {
            callback(new Error('Command failed'), 'Tests:   1 failed, 0 passed, 1 total', '');
        });

        const result = await runner.runTests();
        expect(result.failed).toBe(1);
        expect(result.success).toBe(false);
    });

    test('returns empty results for no files', async () => {
        const result = await runner.runTestsForFiles([]);
        expect(result.passed).toBe(0);
        expect(result.failed).toBe(0);
        expect(result.success).toBe(true);
        expect(result.rawOutput).toBe('No files to test');
    });

    test('runTestsForFiles builds command with file patterns and calls runTests', async () => {
        mockExec.mockImplementation((_cmd: string, _opts: any, callback: Function) => {
            callback(null, 'Tests:   3 passed, 3 total\nTime: 1s', '');
        });

        const result = await runner.runTestsForFiles([
            'src/core/database.ts',
            'src/core/llm-service.ts',
        ]);

        expect(mockExec).toHaveBeenCalledTimes(1);
        const calledCmd = mockExec.mock.calls[0][0] as string;
        expect(calledCmd).toContain('--findRelatedTests');
        expect(calledCmd).toContain('"src/core/database.ts"');
        expect(calledCmd).toContain('"src/core/llm-service.ts"');
        expect(result.passed).toBe(3);
        expect(result.success).toBe(true);
    });

    test('parseJestJson parses output starting with {"numFailedTestSuites"', async () => {
        const jestJson = JSON.stringify({
            numFailedTestSuites: 0,
            numPassedTestSuites: 2,
            numFailedTests: 1,
            numPassedTests: 9,
            numPendingTests: 2,
        });
        mockExec.mockImplementation((_cmd: string, _opts: any, callback: Function) => {
            callback(null, `Some preamble text\n${jestJson}\nDone.`, '');
        });

        const result = await runner.runTests();
        expect(result.passed).toBe(9);
        expect(result.failed).toBe(1);
        expect(result.skipped).toBe(2);
        expect(result.success).toBe(false);
    });

    test('parseJestJson falls back to regex when {"numFailedTestSuites" prefix is absent', async () => {
        // JSON blob that contains "numPassedTests" but does NOT start with {"numFailedTestSuites"
        const jestJson = JSON.stringify({
            numPassedTests: 7,
            numFailedTests: 0,
            numPendingTests: 1,
        });
        // Prefix the JSON with a different key ordering so indexOf('{"numFailedTestSuites"') === -1
        const output = `Starting tests...\n${jestJson}\nAll done.`;
        mockExec.mockImplementation((_cmd: string, _opts: any, callback: Function) => {
            callback(null, output, '');
        });

        const result = await runner.runTests();
        expect(result.passed).toBe(7);
        expect(result.failed).toBe(0);
        expect(result.skipped).toBe(1);
        expect(result.success).toBe(true);
    });

    test('extractFromJestJson extracts coverage from coverageSummary', async () => {
        const jestJson = JSON.stringify({
            numFailedTestSuites: 0,
            numPassedTestSuites: 1,
            numFailedTests: 0,
            numPassedTests: 5,
            numPendingTests: 0,
            coverageSummary: {
                lines: { pct: 94.2 },
                statements: { pct: 93.1 },
                functions: { pct: 88.0 },
                branches: { pct: 78.5 },
            },
        });
        mockExec.mockImplementation((_cmd: string, _opts: any, callback: Function) => {
            callback(null, jestJson, '');
        });

        const result = await runner.runTests();
        expect(result.passed).toBe(5);
        expect(result.failed).toBe(0);
        expect(result.coverage).toBe(94.2);
        expect(result.success).toBe(true);
    });

    test('extractFromJestJson extracts coverage when coverageMap is present', async () => {
        const jestJson = JSON.stringify({
            numFailedTestSuites: 0,
            numPassedTestSuites: 1,
            numFailedTests: 0,
            numPassedTests: 3,
            numPendingTests: 0,
            coverageMap: { 'src/index.ts': {} },
            coverageSummary: {
                lines: { pct: 76.3 },
            },
        });
        mockExec.mockImplementation((_cmd: string, _opts: any, callback: Function) => {
            callback(null, jestJson, '');
        });

        const result = await runner.runTests();
        expect(result.coverage).toBe(76.3);
    });

    test('extractFromJestJson returns null coverage when no coverageSummary lines', async () => {
        const jestJson = JSON.stringify({
            numFailedTestSuites: 0,
            numPassedTestSuites: 1,
            numFailedTests: 0,
            numPassedTests: 4,
            numPendingTests: 0,
        });
        mockExec.mockImplementation((_cmd: string, _opts: any, callback: Function) => {
            callback(null, jestJson, '');
        });

        const result = await runner.runTests();
        expect(result.coverage).toBeNull();
    });

    test('parseJestText parses output with skipped tests', async () => {
        mockExec.mockImplementation((_cmd: string, _opts: any, callback: Function) => {
            callback(null,
                'Tests:   2 failed, 3 skipped, 8 passed, 13 total\nTime:    5s',
                ''
            );
        });

        const result = await runner.runTests();
        expect(result.passed).toBe(8);
        expect(result.failed).toBe(2);
        expect(result.skipped).toBe(3);
        expect(result.success).toBe(false);
    });

    test('parseJestText parses alternate format "X passing, Y failing"', async () => {
        mockExec.mockImplementation((_cmd: string, _opts: any, callback: Function) => {
            callback(null, '12 passing, 2 failing\nDone in 3s', '');
        });

        const result = await runner.runTests();
        expect(result.passed).toBe(12);
        expect(result.failed).toBe(2);
        expect(result.skipped).toBe(0);
        expect(result.success).toBe(false);
    });

    test('parseJestText alternate format with zero failures', async () => {
        mockExec.mockImplementation((_cmd: string, _opts: any, callback: Function) => {
            callback(null, '10 passed, 0 failed\nDone in 2s', '');
        });

        const result = await runner.runTests();
        expect(result.passed).toBe(10);
        expect(result.failed).toBe(0);
        expect(result.success).toBe(true);
    });

    test('parseCoverage parses "Coverage: X%" format', async () => {
        mockExec.mockImplementation((_cmd: string, _opts: any, callback: Function) => {
            callback(null,
                'Tests:   5 passed, 5 total\nCoverage: 92.5%\nTime: 2s',
                ''
            );
        });

        const result = await runner.runTests();
        expect(result.passed).toBe(5);
        expect(result.coverage).toBe(92.5);
        expect(result.success).toBe(true);
    });

    test('runTests returns default result for unparseable output with no error', async () => {
        mockExec.mockImplementation((_cmd: string, _opts: any, callback: Function) => {
            callback(null, 'gibberish output that cannot be parsed', '');
        });

        const result = await runner.runTests();
        expect(result.passed).toBe(0);
        expect(result.failed).toBe(0);
        expect(result.skipped).toBe(0);
        expect(result.coverage).toBeNull();
        expect(result.success).toBe(true);
        expect(result.rawOutput).toContain('gibberish');
    });

    test('runTests returns failed result for unparseable output with error', async () => {
        mockExec.mockImplementation((_cmd: string, _opts: any, callback: Function) => {
            callback(new Error('Process exited with code 1'), 'xyzzy nothing parseable here', '');
        });

        const result = await runner.runTests();
        expect(result.passed).toBe(0);
        expect(result.failed).toBe(1);
        expect(result.skipped).toBe(0);
        expect(result.coverage).toBeNull();
        expect(result.success).toBe(false);
        expect(result.rawOutput).toContain('xyzzy');
    });

    test('stderr content is included in rawOutput', async () => {
        mockExec.mockImplementation((_cmd: string, _opts: any, callback: Function) => {
            callback(null, 'Tests:   3 passed, 3 total\nTime: 1s', 'Some stderr warning output');
        });

        const result = await runner.runTests();
        expect(result.rawOutput).toContain('Some stderr warning output');
        expect(result.passed).toBe(3);
    });

    test('extractFromJestJson handles zero/missing numPassedTests', async () => {
        const jestJson = JSON.stringify({
            numFailedTestSuites: 1,
            numPassedTestSuites: 0,
            numFailedTests: 3,
            numPassedTests: 0,
            numPendingTests: 0,
        });
        mockExec.mockImplementation((_cmd: string, _opts: any, callback: Function) => {
            callback(null, jestJson, '');
        });

        const result = await runner.runTests();
        expect(result.passed).toBe(0);
        expect(result.failed).toBe(3);
    });

    test('parseJestJson catch branch: malformed JSON after brace-matching', async () => {
        // Output has {"numFailedTestSuites" prefix so brace-matching runs,
        // but the extracted substring is invalid JSON → catch returns null → falls through to text parsing
        const malformedOutput = '{"numFailedTestSuites": INVALID_NOT_JSON}';
        mockExec.mockImplementation((_cmd: string, _opts: any, callback: Function) => {
            callback(null, malformedOutput, '');
        });

        const result = await runner.runTests();
        // parseJestJson returns null (line 111), parseJestText also won't match → default result
        expect(result.passed).toBe(0);
        expect(result.failed).toBe(0);
        expect(result.success).toBe(true);
        expect(result.rawOutput).toContain('INVALID_NOT_JSON');
    });
});
