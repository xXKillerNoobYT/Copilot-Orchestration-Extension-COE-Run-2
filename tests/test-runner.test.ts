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
});
