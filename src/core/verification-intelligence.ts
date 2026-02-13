/**
 * VerificationIntelligence - Advanced verification logic
 *
 * - Acceptance criteria matching (fuzzy + keyword)
 * - Coverage enforcement with thresholds
 * - Flaky test detection via historical results
 * - Verification report generation
 */

export interface AcceptanceCriterion {
    text: string;
    keywords: string[];
    matched: boolean;
    confidence: number;
    matchedBy?: string;
}

export interface CoverageReport {
    statements: number;
    branches: number;
    functions: number;
    lines: number;
    meetsThreshold: boolean;
    threshold: { statements: number; branches: number; functions: number; lines: number };
    uncoveredFiles: string[];
    delta: { statements: number; branches: number; functions: number; lines: number };
}

export interface FlakyTestResult {
    testName: string;
    suite: string;
    passRate: number;
    lastNResults: boolean[];
    isFlaky: boolean;
    recommendation: 'investigate' | 'quarantine' | 'stable' | 'failing';
}

export interface VerificationReport {
    taskId: string;
    timestamp: string;
    overallStatus: 'passed' | 'failed' | 'partial' | 'needs_review';
    criteriaResults: AcceptanceCriterion[];
    criteriaScore: number;
    coverageReport: CoverageReport | null;
    flakyTests: FlakyTestResult[];
    testResults: { total: number; passed: number; failed: number; skipped: number };
    recommendations: string[];
    blockers: string[];
}

export class VerificationIntelligence {
    private testHistory: Map<string, boolean[]>;
    private coverageHistory: CoverageReport[];
    private _customThresholds: Partial<CoverageReport['threshold']> | null = null;

    constructor() {
        this.testHistory = new Map();
        this.coverageHistory = [];
    }

    parseAcceptanceCriteria(text: string): AcceptanceCriterion[] {
        const lines = text.split(/[\n\r]+/)
            .map(l => l.replace(/^[\s\-*\d.)+]+/, '').trim())
            .filter(l => l.length > 5);

        return lines.map(line => ({
            text: line,
            keywords: this.extractKeywords(line),
            matched: false,
            confidence: 0,
        }));
    }

    extractKeywords(text: string): string[] {
        const stopwords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
            'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
            'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
            'through', 'during', 'before', 'after', 'above', 'below', 'between',
            'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either', 'neither',
            'each', 'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such',
            'that', 'this', 'these', 'those', 'it', 'its', 'when', 'where', 'which', 'who']);

        return text.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .split(/\s+/)
            .filter(w => w.length > 2 && !stopwords.has(w));
    }

    matchCriteria(criteria: AcceptanceCriterion[], testOutput: string, changedFiles: string[]): AcceptanceCriterion[] {
        const outputLower = testOutput.toLowerCase();
        const filesLower = changedFiles.map(f => f.toLowerCase());

        return criteria.map(c => {
            let matchCount = 0;
            const matchedBy: string[] = [];

            for (const keyword of c.keywords) {
                if (outputLower.includes(keyword)) {
                    matchCount++;
                    matchedBy.push('test output contains "' + keyword + '"');
                }
                if (filesLower.some(f => f.includes(keyword))) {
                    matchCount++;
                    matchedBy.push('file name contains "' + keyword + '"');
                }
            }

            const confidence = c.keywords.length > 0 ? matchCount / c.keywords.length : 0;

            return {
                ...c,
                matched: confidence >= 0.5,
                confidence: Math.round(confidence * 100) / 100,
                matchedBy: matchedBy.length > 0 ? matchedBy.join('; ') : undefined,
            };
        });
    }

    parseCoverageOutput(output: string): CoverageReport {
        const coverageMatch = output.match(/All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/);

        const defaultThresholds = { statements: 80, branches: 70, functions: 80, lines: 80 };
        const thresholds = {
            ...defaultThresholds,
            ...(this._customThresholds ?? {}),
        };

        const report: CoverageReport = {
            statements: coverageMatch ? parseFloat(coverageMatch[1]) : 0,
            branches: coverageMatch ? parseFloat(coverageMatch[2]) : 0,
            functions: coverageMatch ? parseFloat(coverageMatch[3]) : 0,
            lines: coverageMatch ? parseFloat(coverageMatch[4]) : 0,
            meetsThreshold: false,
            threshold: thresholds,
            uncoveredFiles: [],
            delta: { statements: 0, branches: 0, functions: 0, lines: 0 },
        };

        report.meetsThreshold = report.statements >= report.threshold.statements &&
            report.branches >= report.threshold.branches &&
            report.functions >= report.threshold.functions &&
            report.lines >= report.threshold.lines;

        const fileLines = output.matchAll(/([^\s|]+\.[jt]sx?)\s*\|\s*([\d.]+)/g);
        for (const match of fileLines) {
            if (parseFloat(match[2]) < 50) {
                report.uncoveredFiles.push(match[1]);
            }
        }

        if (this.coverageHistory.length > 0) {
            const last = this.coverageHistory[this.coverageHistory.length - 1];
            report.delta = {
                statements: Math.round((report.statements - last.statements) * 100) / 100,
                branches: Math.round((report.branches - last.branches) * 100) / 100,
                functions: Math.round((report.functions - last.functions) * 100) / 100,
                lines: Math.round((report.lines - last.lines) * 100) / 100,
            };
        }

        this.coverageHistory.push(report);
        return report;
    }

    recordTestResults(results: Array<{ name: string; suite: string; passed: boolean }>): FlakyTestResult[] {
        for (const r of results) {
            const key = r.suite + '::' + r.name;
            const history = this.testHistory.get(key) || [];
            history.push(r.passed);
            if (history.length > 10) { history.shift(); }
            this.testHistory.set(key, history);
        }

        return this.detectFlakyTests();
    }

    detectFlakyTests(): FlakyTestResult[] {
        const results: FlakyTestResult[] = [];

        for (const [key, history] of this.testHistory) {
            if (history.length < 3) { continue; }

            const parts = key.split('::');
            const suite = parts[0];
            const name = parts[1];
            const passCount = history.filter(Boolean).length;
            const passRate = passCount / history.length;

            let recommendation: FlakyTestResult['recommendation'];
            if (passRate >= 0.95) { recommendation = 'stable'; }
            else if (passRate <= 0.1) { recommendation = 'failing'; }
            else if (passRate >= 0.2 && passRate <= 0.8) { recommendation = 'quarantine'; }
            else { recommendation = 'investigate'; }

            results.push({
                testName: name,
                suite,
                passRate: Math.round(passRate * 100) / 100,
                lastNResults: [...history],
                isFlaky: passRate > 0.1 && passRate < 0.9,
                recommendation,
            });
        }

        return results.filter(r => r.isFlaky || r.recommendation !== 'stable');
    }

    generateReport(
        taskId: string,
        criteriaText: string,
        testOutput: string,
        changedFiles: string[],
        testSummary: { total: number; passed: number; failed: number; skipped: number }
    ): VerificationReport {
        const criteria = this.parseAcceptanceCriteria(criteriaText);
        const matchedCriteria = this.matchCriteria(criteria, testOutput, changedFiles);
        const flakyTests = this.detectFlakyTests();

        const matchedCount = matchedCriteria.filter(c => c.matched).length;
        const criteriaScore = criteria.length > 0 ? Math.round((matchedCount / criteria.length) * 100) : 100;

        const recommendations: string[] = [];
        const blockers: string[] = [];

        if (testSummary.failed > 0) {
            blockers.push(testSummary.failed + ' test(s) failing');
        }

        const unmatchedCriteria = matchedCriteria.filter(c => !c.matched);
        if (unmatchedCriteria.length > 0) {
            recommendations.push(unmatchedCriteria.length + ' acceptance criteria not yet verified: ' + unmatchedCriteria.map(c => c.text).join('; '));
        }

        const flakyCount = flakyTests.filter(f => f.isFlaky).length;
        if (flakyCount > 0) {
            recommendations.push(flakyCount + ' flaky test(s) detected — consider quarantining');
        }

        if (testSummary.skipped > 0) {
            recommendations.push(testSummary.skipped + ' test(s) skipped — ensure they are not hiding failures');
        }

        let overallStatus: VerificationReport['overallStatus'];
        if (testSummary.failed > 0) { overallStatus = 'failed'; }
        else if (criteriaScore >= 80 && testSummary.passed > 0) { overallStatus = 'passed'; }
        else if (criteriaScore >= 50) { overallStatus = 'partial'; }
        else { overallStatus = 'needs_review'; }

        return {
            taskId,
            timestamp: new Date().toISOString(),
            overallStatus,
            criteriaResults: matchedCriteria,
            criteriaScore,
            coverageReport: null,
            flakyTests,
            testResults: testSummary,
            recommendations,
            blockers,
        };
    }

    setCoverageThresholds(thresholds: Partial<CoverageReport['threshold']>): void {
        this._customThresholds = thresholds;
    }

    getTestHistory(): Map<string, boolean[]> {
        return this.testHistory;
    }

    getCoverageHistory(): CoverageReport[] {
        return this.coverageHistory;
    }

    reset(): void {
        this.testHistory.clear();
        this.coverageHistory = [];
        this._customThresholds = null;
    }
}
