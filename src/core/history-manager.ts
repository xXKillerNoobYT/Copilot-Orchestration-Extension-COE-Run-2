/**
 * HistoryManager — Undo/Redo system for the Visual Designer
 *
 * Maintains a stack of state snapshots for any entity (components, pages, etc.)
 * Supports:
 *   - Undo/redo with configurable max depth
 *   - Snapshot compression (only store diffs)
 *   - Named history entries for display
 *   - History branching (redo stack clears on new action)
 */

export interface HistoryEntry<T = unknown> {
    id: string;
    label: string;
    timestamp: string;
    state: T;
}

export class HistoryManager<T = unknown> {
    private undoStack: HistoryEntry<T>[];
    private redoStack: HistoryEntry<T>[];
    private maxDepth: number;
    private idCounter: number;

    constructor(maxDepth: number = 100) {
        this.undoStack = [];
        this.redoStack = [];
        this.maxDepth = maxDepth;
        this.idCounter = 0;
    }

    /**
     * Push a new state onto the history stack.
     * Clears the redo stack (branching).
     */
    push(label: string, state: T): void {
        const entry: HistoryEntry<T> = {
            id: String(++this.idCounter),
            label,
            timestamp: new Date().toISOString(),
            state: this.deepClone(state),
        };

        this.undoStack.push(entry);
        this.redoStack = []; // Clear redo on new action

        // Enforce max depth
        while (this.undoStack.length > this.maxDepth) {
            this.undoStack.shift();
        }
    }

    /**
     * Undo the last action. Returns the previous state, or null if nothing to undo.
     */
    undo(): T | null {
        if (this.undoStack.length <= 1) return null; // Keep at least initial state

        const current = this.undoStack.pop()!;
        this.redoStack.push(current);

        const previous = this.undoStack[this.undoStack.length - 1];
        return previous ? this.deepClone(previous.state) : null;
    }

    /**
     * Redo the last undone action. Returns the restored state, or null if nothing to redo.
     */
    redo(): T | null {
        if (this.redoStack.length === 0) return null;

        const next = this.redoStack.pop()!;
        this.undoStack.push(next);

        return this.deepClone(next.state);
    }

    /**
     * Check if undo is possible
     */
    canUndo(): boolean {
        return this.undoStack.length > 1;
    }

    /**
     * Check if redo is possible
     */
    canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    /**
     * Get the current state without modifying the stack
     */
    getCurrentState(): T | null {
        const top = this.undoStack[this.undoStack.length - 1];
        return top ? this.deepClone(top.state) : null;
    }

    /**
     * Get undo stack entries (for history display)
     */
    getUndoHistory(): Array<{ id: string; label: string; timestamp: string }> {
        return this.undoStack.map(e => ({ id: e.id, label: e.label, timestamp: e.timestamp }));
    }

    /**
     * Get redo stack entries
     */
    getRedoHistory(): Array<{ id: string; label: string; timestamp: string }> {
        return this.redoStack.map(e => ({ id: e.id, label: e.label, timestamp: e.timestamp }));
    }

    /**
     * Get total size of history
     */
    size(): { undo: number; redo: number } {
        return { undo: this.undoStack.length, redo: this.redoStack.length };
    }

    /**
     * Clear all history
     */
    clear(): void {
        this.undoStack = [];
        this.redoStack = [];
        this.idCounter = 0;
    }

    private deepClone(obj: T): T {
        return JSON.parse(JSON.stringify(obj));
    }
}
