/**
 * AgentFileCleanupService — Detect, read, process, and organize stray files (v7.0)
 *
 * External coding agents sometimes create .md/.txt files in the workspace root
 * (implementation plans, phase summaries, README drafts, etc.). This service:
 *
 * 1. Watches for new agent-created files in the workspace root
 * 2. Reads and classifies their content
 * 3. Saves them to the support_documents system via DocumentManager
 * 4. Creates a Boss directive ticket for review
 * 5. Optionally deletes the original file after processing
 *
 * Files are identified by pattern matching against known agent output patterns.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Database } from './database';
import { EventBus } from './event-bus';
import { DocumentManagerService } from './document-manager';
import { TicketPriority } from '../types';

export interface AgentFile {
    filePath: string;
    fileName: string;
    size: number;
    category: 'plan' | 'readme' | 'report' | 'output' | 'unknown';
    detectedAt: number;
}

export interface ProcessResult {
    filePath: string;
    documentId: string | null;
    ticketId: string | null;
    category: string;
    success: boolean;
    error?: string;
}

export class AgentFileCleanupService {
    /** Patterns that identify agent-created files in workspace root */
    private readonly agentFilePatterns: RegExp[] = [
        /Phase \d+.*\.(md|txt)$/i,
        /implementation[_ -]plan\.(md|txt)$/i,
        /agent[_ -]output.*\.(md|txt|json)$/i,
        /task[_ -](summary|report|plan).*\.(md|txt)$/i,
        /coding[_ -](plan|output|result).*\.(md|txt)$/i,
        /design[_ -](spec|document|plan).*\.(md|txt)$/i,
        /progress[_ -](report|update).*\.(md|txt)$/i,
    ];

    /** Track files we've already processed to avoid duplicates */
    private processedFiles = new Set<string>();

    /** File watcher disposable */
    private watcher: vscode.FileSystemWatcher | null = null;

    /** Debounce timer for batch processing */
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;

    /** Queue of files pending processing */
    private pendingFiles: string[] = [];

    constructor(
        private workspaceRoot: string,
        private database: Database,
        private documentManager: DocumentManagerService,
        private eventBus: EventBus,
        private outputChannel: vscode.OutputChannel
    ) {}

    // ==================== SCAN ====================

    /**
     * Scan workspace root for existing agent-created files.
     * Returns list of detected agent files without processing them.
     */
    scanForAgentFiles(): AgentFile[] {
        const results: AgentFile[] = [];

        try {
            const entries = fs.readdirSync(this.workspaceRoot, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isFile()) continue;

                // Check if file matches any agent pattern
                if (this.isAgentFile(entry.name)) {
                    const filePath = path.join(this.workspaceRoot, entry.name);
                    const stats = fs.statSync(filePath);

                    results.push({
                        filePath,
                        fileName: entry.name,
                        size: stats.size,
                        category: this.classifyFile(entry.name),
                        detectedAt: Date.now(),
                    });
                }
            }

            // Also check for README.md in root (only if it looks auto-generated)
            const readmePath = path.join(this.workspaceRoot, 'README.md');
            if (fs.existsSync(readmePath) && !results.some(f => f.fileName === 'README.md')) {
                try {
                    const content = fs.readFileSync(readmePath, 'utf-8');
                    // Only flag README.md if it contains agent-like content
                    if (this.looksAgentGenerated(content)) {
                        const stats = fs.statSync(readmePath);
                        results.push({
                            filePath: readmePath,
                            fileName: 'README.md',
                            size: stats.size,
                            category: 'readme',
                            detectedAt: Date.now(),
                        });
                    }
                } catch {
                    // Ignore read errors
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`[FileCleanup] Scan error: ${error}`);
        }

        if (results.length > 0) {
            this.outputChannel.appendLine(
                `[FileCleanup] Found ${results.length} agent file(s): ${results.map(f => f.fileName).join(', ')}`
            );
        }

        return results;
    }

    // ==================== PROCESS ====================

    /**
     * Process a single agent file: read, classify, save to documents, create review ticket.
     */
    async processAgentFile(filePath: string): Promise<ProcessResult> {
        const fileName = path.basename(filePath);
        const result: ProcessResult = {
            filePath,
            documentId: null,
            ticketId: null,
            category: 'unknown',
            success: false,
        };

        try {
            // Skip if already processed
            if (this.processedFiles.has(filePath)) {
                result.success = true;
                result.error = 'Already processed';
                return result;
            }

            // Read file content
            if (!fs.existsSync(filePath)) {
                result.error = 'File not found';
                return result;
            }

            const content = fs.readFileSync(filePath, 'utf-8');
            if (!content.trim()) {
                result.error = 'File is empty';
                return result;
            }

            // Classify
            result.category = this.classifyFile(fileName, content);

            // Determine folder name based on category
            const folderMap: Record<string, string> = {
                plan: 'Agent Plans',
                readme: 'Agent Output',
                report: 'Agent Reports',
                output: 'Agent Output',
                unknown: 'Agent Output',
            };
            const folderName = folderMap[result.category] || 'Agent Output';

            // Save to support documents
            const doc = this.documentManager.saveDocument(
                folderName,
                fileName,
                content,
                {
                    category: `agent_${result.category}`,
                    source_agent: 'External Coding Agent',
                    tags: ['agent-output', result.category, 'needs-review'],
                    summary: this.generateSummary(content, result.category),
                    relevance_score: 60, // Moderate — needs verification
                }
            );
            result.documentId = doc.id;

            // Create a Boss directive ticket for review
            const ticket = this.database.createTicket({
                title: `Review agent output: ${fileName}`,
                body: `External coding agent created file "${fileName}" in workspace root.\n\n` +
                    `Category: ${result.category}\n` +
                    `Size: ${content.length} characters\n` +
                    `Saved to: Support Documents → ${folderName}\n` +
                    `Document ID: ${doc.id}\n\n` +
                    `--- Preview (first 500 chars) ---\n${content.substring(0, 500)}${content.length > 500 ? '...' : ''}\n\n` +
                    `Please review this agent output and determine:\n` +
                    `1. Is this content relevant and accurate?\n` +
                    `2. Should it be verified and kept, or discarded?\n` +
                    `3. Does it indicate a completed task that needs verification?`,
                priority: TicketPriority.P3,
                creator: 'file_cleanup',
                operation_type: 'boss_directive',
            });
            result.ticketId = ticket.id;

            // Mark as processed
            this.processedFiles.add(filePath);
            result.success = true;

            // Emit events
            this.eventBus.emit('agent_file:processed', 'file-cleanup', {
                filePath,
                fileName,
                category: result.category,
                documentId: doc.id,
                ticketId: ticket.id,
            });

            this.outputChannel.appendLine(
                `[FileCleanup] Processed "${fileName}" → folder "${folderName}", ticket TK-${ticket.ticket_number}`
            );

        } catch (error) {
            result.error = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`[FileCleanup] Error processing "${fileName}": ${result.error}`);
        }

        return result;
    }

    // ==================== ORGANIZE ====================

    /**
     * Process and optionally delete all detected agent files.
     * Returns results for each processed file.
     */
    async cleanupProcessedFiles(deleteOriginals: boolean = false): Promise<ProcessResult[]> {
        const agentFiles = this.scanForAgentFiles();
        const results: ProcessResult[] = [];

        for (const file of agentFiles) {
            const result = await this.processAgentFile(file.filePath);
            results.push(result);

            // Delete original if requested and processing succeeded
            if (deleteOriginals && result.success && result.documentId) {
                try {
                    fs.unlinkSync(file.filePath);
                    this.eventBus.emit('agent_file:cleaned', 'file-cleanup', {
                        filePath: file.filePath,
                        fileName: file.fileName,
                        deleted: true,
                    });
                    this.outputChannel.appendLine(`[FileCleanup] Deleted original: ${file.fileName}`);
                } catch (error) {
                    this.outputChannel.appendLine(
                        `[FileCleanup] Could not delete "${file.fileName}": ${error}`
                    );
                }
            }
        }

        return results;
    }

    // ==================== WATCH ====================

    /**
     * Start watching workspace root for new agent files.
     * Returns a disposable to stop watching.
     */
    startWatching(): vscode.Disposable {
        // Watch for .md and .txt files in workspace root (not subdirectories)
        this.watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.workspaceRoot, '*.{md,txt}')
        );

        this.watcher.onDidCreate(uri => this.onFileCreated(uri));
        this.watcher.onDidChange(uri => this.onFileChanged(uri));

        this.outputChannel.appendLine('[FileCleanup] Watching workspace root for agent files.');

        // Do an initial scan
        const existing = this.scanForAgentFiles();
        if (existing.length > 0) {
            this.outputChannel.appendLine(
                `[FileCleanup] Initial scan found ${existing.length} agent file(s) — queueing for processing`
            );
            for (const file of existing) {
                this.queueFileForProcessing(file.filePath);
            }
        }

        return new vscode.Disposable(() => this.stopWatching());
    }

    /**
     * Stop watching for agent files.
     */
    stopWatching(): void {
        if (this.watcher) {
            this.watcher.dispose();
            this.watcher = null;
        }
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.pendingFiles = [];
        this.outputChannel.appendLine('[FileCleanup] Stopped watching for agent files.');
    }

    // ==================== INTERNAL HELPERS ====================

    private onFileCreated(uri: vscode.Uri): void {
        const fileName = path.basename(uri.fsPath);

        // Only process files in workspace root (not subdirectories)
        if (path.dirname(uri.fsPath) !== this.workspaceRoot) return;

        if (this.isAgentFile(fileName)) {
            this.eventBus.emit('agent_file:detected', 'file-cleanup', {
                filePath: uri.fsPath,
                fileName,
            });
            this.outputChannel.appendLine(`[FileCleanup] Agent file detected: ${fileName}`);
            this.queueFileForProcessing(uri.fsPath);
        }
    }

    private onFileChanged(uri: vscode.Uri): void {
        // Only re-process if the file hasn't been processed yet
        if (this.processedFiles.has(uri.fsPath)) return;

        const fileName = path.basename(uri.fsPath);
        if (path.dirname(uri.fsPath) !== this.workspaceRoot) return;

        if (this.isAgentFile(fileName)) {
            this.queueFileForProcessing(uri.fsPath);
        }
    }

    /**
     * Queue a file for debounced processing.
     * Files are batched to avoid processing during rapid creation/editing.
     */
    private queueFileForProcessing(filePath: string): void {
        if (!this.pendingFiles.includes(filePath)) {
            this.pendingFiles.push(filePath);
        }

        // Debounce: wait 5 seconds before processing, in case the agent
        // is still writing the file
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.processPendingFiles();
        }, 5000);
    }

    private async processPendingFiles(): Promise<void> {
        const files = [...this.pendingFiles];
        this.pendingFiles = [];

        for (const filePath of files) {
            await this.processAgentFile(filePath);
        }
    }

    /**
     * Check if a filename matches known agent output patterns.
     */
    private isAgentFile(fileName: string): boolean {
        return this.agentFilePatterns.some(pattern => pattern.test(fileName));
    }

    /**
     * Classify a file based on its name and optionally its content.
     */
    private classifyFile(fileName: string, content?: string): AgentFile['category'] {
        const nameLower = fileName.toLowerCase();

        if (/plan/i.test(nameLower) || /phase\s*\d+/i.test(nameLower)) return 'plan';
        if (/readme/i.test(nameLower)) return 'readme';
        if (/report|summary|progress/i.test(nameLower)) return 'report';
        if (/output|result/i.test(nameLower)) return 'output';

        // Content-based classification if name is ambiguous
        if (content) {
            if (/## (Phase|Step|Task)\s+\d+/i.test(content)) return 'plan';
            if (/## Summary|## Overview|## Introduction/i.test(content)) return 'report';
            if (/# README|## Getting Started|## Installation/i.test(content)) return 'readme';
        }

        return 'unknown';
    }

    /**
     * Check if content looks like it was generated by an AI coding agent.
     */
    private looksAgentGenerated(content: string): boolean {
        const agentMarkers = [
            /generated by|auto-generated|created by ai/i,
            /## Implementation Plan/i,
            /## Phase \d+/i,
            /## Task Breakdown/i,
            /\*\*Note:\*\* This (file|document) was (automatically|auto)/i,
        ];
        return agentMarkers.some(marker => marker.test(content));
    }

    /**
     * Generate a brief summary of file content for the support document.
     */
    private generateSummary(content: string, category: string): string {
        // Count headings, lines, code blocks
        const headings = (content.match(/^#{1,3}\s+.+$/gm) || []).length;
        const lines = content.split('\n').length;
        const codeBlocks = (content.match(/```/g) || []).length / 2;

        const categoryLabels: Record<string, string> = {
            plan: 'Implementation plan',
            readme: 'README/documentation',
            report: 'Progress report',
            output: 'Agent output',
            unknown: 'Unclassified agent file',
        };

        let summary = `${categoryLabels[category] || 'Agent file'}: `;
        summary += `${lines} lines`;
        if (headings > 0) summary += `, ${headings} section(s)`;
        if (codeBlocks > 0) summary += `, ${Math.floor(codeBlocks)} code block(s)`;

        // Extract first heading as topic
        const firstHeading = content.match(/^#{1,3}\s+(.+)$/m);
        if (firstHeading) {
            summary += `. Topic: "${firstHeading[1].trim()}"`;
        }

        return summary.substring(0, 300);
    }
}
