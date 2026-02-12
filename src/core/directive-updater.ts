import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * DirectiveUpdater appends learnings to directive files when the
 * evolution system applies proposals. Maps patterns to directives
 * by keyword matching against directive filenames and content.
 */
export class DirectiveUpdater {
    private directivesDir: string;

    constructor(
        private workspaceRoot: string,
        private outputChannel: vscode.OutputChannel
    ) {
        this.directivesDir = path.join(workspaceRoot, 'directives');
    }

    /**
     * Append a learning to the most relevant directive file.
     * Creates a "## Learned" section if it doesn't exist.
     */
    async appendLearning(pattern: string, proposal: string, result: string): Promise<string | null> {
        const directives = this.listDirectives();
        if (directives.length === 0) {
            this.outputChannel.appendLine('DirectiveUpdater: No directives found');
            return null;
        }

        // Find the best-matching directive by keyword overlap
        const patternWords = this.extractKeywords(pattern + ' ' + proposal);
        let bestMatch = '';
        let bestScore = 0;

        for (const directive of directives) {
            const name = path.basename(directive, '.md').replace(/-/g, ' ').toLowerCase();
            let content = '';
            try {
                content = fs.readFileSync(directive, 'utf-8').toLowerCase();
            } catch {
                continue;
            }

            let score = 0;
            for (const word of patternWords) {
                if (name.includes(word)) score += 3; // filename match is strong signal
                if (content.includes(word)) score += 1; // content match is weaker
            }

            if (score > bestScore) {
                bestScore = score;
                bestMatch = directive;
            }
        }

        // Minimum threshold: at least 2 keyword matches
        if (bestScore < 2) {
            this.outputChannel.appendLine(
                `DirectiveUpdater: No directive matched pattern "${pattern}" (best score: ${bestScore})`
            );
            return null;
        }

        // Append learning to the matched directive
        try {
            let content = fs.readFileSync(bestMatch, 'utf-8');

            const entry = [
                '',
                `- **${new Date().toISOString().split('T')[0]}**: ${pattern}`,
                `  - Proposal: ${proposal}`,
                `  - Result: ${result}`,
            ].join('\n');

            if (content.includes('## Learned')) {
                // Append to existing section
                content = content.replace(
                    '## Learned',
                    `## Learned\n${entry}`
                );
            } else {
                // Add new section at end
                content += `\n\n## Learned\n${entry}\n`;
            }

            fs.writeFileSync(bestMatch, content, 'utf-8');
            const directiveName = path.basename(bestMatch);
            this.outputChannel.appendLine(
                `DirectiveUpdater: Appended learning to ${directiveName}`
            );
            return directiveName;
        } catch (err) {
            this.outputChannel.appendLine(
                `DirectiveUpdater: Failed to update ${bestMatch}: ${err}`
            );
            return null;
        }
    }

    private listDirectives(): string[] {
        try {
            if (!fs.existsSync(this.directivesDir)) return [];
            return fs.readdirSync(this.directivesDir)
                .filter(f => f.endsWith('.md'))
                .map(f => path.join(this.directivesDir, f));
        } catch {
            return [];
        }
    }

    private extractKeywords(text: string): string[] {
        const stopWords = new Set([
            'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
            'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
            'would', 'could', 'should', 'may', 'might', 'can', 'shall',
            'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
            'and', 'or', 'not', 'no', 'but', 'if', 'then', 'else',
            'this', 'that', 'it', 'its', 'so', 'as', 'than', 'too',
        ]);

        return text.toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2 && !stopWords.has(w));
    }
}
