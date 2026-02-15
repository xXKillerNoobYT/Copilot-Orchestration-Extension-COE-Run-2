import * as vscode from 'vscode';
import { exec } from 'child_process';

export interface TestRunResult {
    passed: number;
    failed: number;
    skipped: number;
    coverage: number | null;
    rawOutput: string;
    success: boolean;
    duration: number;
}

export class TestRunnerService {
    private workspaceRoot: string;
    private outputChannel: vscode.OutputChannel;
    private defaultCommand: string;
    private timeoutMs: number;

    constructor(workspaceRoot: string, outputChannel: vscode.OutputChannel) {
        this.workspaceRoot = workspaceRoot;
        this.outputChannel = outputChannel;
        this.defaultCommand = 'npx jest --json --coverage 2>&1';
        this.timeoutMs = 120_000; // 2 minutes max
    }

    async runTests(command?: string): Promise<TestRunResult> {
        const cmd = command || this.defaultCommand;
        this.outputChannel.appendLine(`TestRunner: Running "${cmd}" in ${this.workspaceRoot}`);
        const startTime = Date.now();

        return new Promise<TestRunResult>((resolve) => {
            exec(cmd, {
                cwd: this.workspaceRoot,
                timeout: this.timeoutMs,
                maxBuffer: 10 * 1024 * 1024, // 10MB
                env: { ...process.env, FORCE_COLOR: '0', CI: 'true' },
            }, (error, stdout, stderr) => {
                const duration = Date.now() - startTime;
                const rawOutput = stdout + (stderr ? `\n${stderr}` : '');

                // Try to parse Jest JSON output first
                const result = this.parseJestJson(rawOutput) || this.parseJestText(rawOutput);

                if (result) {
                    result.rawOutput = rawOutput;
                    result.duration = duration;
                    result.success = result.failed === 0 && !error;
                    this.outputChannel.appendLine(
                        `TestRunner: ${result.passed} passed, ${result.failed} failed, ${result.skipped} skipped` +
                        (result.coverage !== null ? `, ${result.coverage}% coverage` : '') +
                        ` (${duration}ms)`
                    );
                    resolve(result);
                } else {
                    // Could not parse — return raw output
                    this.outputChannel.appendLine(`TestRunner: Could not parse output (${duration}ms)`);
                    resolve({
                        passed: 0,
                        failed: error ? 1 : 0,
                        skipped: 0,
                        coverage: null,
                        rawOutput,
                        success: !error,
                        duration,
                    });
                }
            });
        });
    }

    async runTestsForFiles(files: string[]): Promise<TestRunResult> {
        if (files.length === 0) {
            return {
                passed: 0, failed: 0, skipped: 0,
                coverage: null, rawOutput: 'No files to test', success: true, duration: 0,
            };
        }

        // Build a Jest command that targets specific files
        const filePatterns = files
            .map(f => f.replace(/\\/g, '/'))
            .join('|');
        const cmd = `npx jest --json --coverage --findRelatedTests ${files.map(f => `"${f}"`).join(' ')} 2>&1`;
        return this.runTests(cmd);
    }

    private parseJestJson(output: string): TestRunResult | null {
        try {
            // Jest JSON output starts with a { and ends with }
            const jsonStart = output.indexOf('{"numFailedTestSuites"');
            if (jsonStart === -1) {
                // Try finding any JSON blob
                const jsonMatch = output.match(/\{[\s\S]*"numPassedTests"[\s\S]*\}/);
                if (!jsonMatch) return null;
                return this.extractFromJestJson(JSON.parse(jsonMatch[0]));
            }

            // Find the end of JSON (matching braces)
            let depth = 0;
            let jsonEnd = jsonStart;
            for (let i = jsonStart; i < output.length; i++) {
                if (output[i] === '{') depth++;
                if (output[i] === '}') depth--;
                if (depth === 0) { jsonEnd = i + 1; break; }
            }

            const parsed = JSON.parse(output.substring(jsonStart, jsonEnd));
            return this.extractFromJestJson(parsed);
        } catch {
            return null;
        }
    }

    private extractFromJestJson(json: Record<string, unknown>): TestRunResult {
        const passed = (json.numPassedTests as number) ?? 0;
        const failed = (json.numFailedTests as number) ?? 0;
        const pending = (json.numPendingTests as number) ?? 0;

        // Extract coverage from snapshot
        let coverage: number | null = null;
        if (json.coverageMap || json.coverageSummary) {
            const summary = json.coverageSummary as Record<string, { pct: number }> | undefined;
            if (summary?.lines) {
                coverage = summary.lines.pct;
            }
        }

        return {
            passed,
            failed,
            skipped: pending,
            coverage,
            rawOutput: '',
            success: failed === 0,
            duration: 0,
        };
    }

    private parseJestText(output: string): TestRunResult | null {
        // Parse Jest text output format:
        // Tests:   3 failed, 12 passed, 15 total
        // or: Test Suites: 1 failed, 3 passed, 4 total
        const testsMatch = output.match(/Tests:\s+(?:(\d+)\s+failed,\s+)?(?:(\d+)\s+skipped,\s+)?(\d+)\s+passed,\s+(\d+)\s+total/i);
        if (!testsMatch) {
            // Try alternate format
            const altMatch = output.match(/(\d+)\s+pass(?:ed|ing).*?(\d+)\s+fail(?:ed|ing)?/i);
            if (altMatch) {
                return {
                    passed: parseInt(altMatch[1], 10),
                    failed: parseInt(altMatch[2], 10),
                    skipped: 0,
                    coverage: this.parseCoverage(output),
                    rawOutput: '',
                    success: parseInt(altMatch[2], 10) === 0,
                    duration: 0,
                };
            }
            return null;
        }

        const failed = testsMatch[1] ? parseInt(testsMatch[1], 10) : 0;
        const skipped = testsMatch[2] ? parseInt(testsMatch[2], 10) : 0;
        const passed = parseInt(testsMatch[3], 10);

        return {
            passed,
            failed,
            skipped,
            coverage: this.parseCoverage(output),
            rawOutput: '',
            success: failed === 0,
            duration: 0,
        };
    }

    private parseCoverage(output: string): number | null {
        // Parse Jest coverage summary:
        // All files  |   87.5 |    82.3 |   90.1 |   87.5 |
        // Statements line
        const coverageMatch = output.match(/All files\s*\|\s*([\d.]+)/);
        if (coverageMatch) {
            return parseFloat(coverageMatch[1]);
        }

        // Alternative: "Coverage: 87.5%"
        const altMatch = output.match(/coverage[:\s]+(\d+(?:\.\d+)?)\s*%/i);
        if (altMatch) {
            return parseFloat(altMatch[1]);
        }

        return null;
    }
}
