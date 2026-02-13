import { HistoryManager, HistoryEntry } from '../src/core/history-manager';

describe('HistoryManager', () => {

    // ==================== BASIC PUSH & STATE ====================

    test('new manager has no state', () => {
        const hm = new HistoryManager<string>();
        expect(hm.getCurrentState()).toBeNull();
        expect(hm.canUndo()).toBe(false);
        expect(hm.canRedo()).toBe(false);
    });

    test('push adds state', () => {
        const hm = new HistoryManager<{ count: number }>();
        hm.push('init', { count: 0 });
        expect(hm.getCurrentState()).toEqual({ count: 0 });
    });

    test('push multiple states', () => {
        const hm = new HistoryManager<number>();
        hm.push('first', 1);
        hm.push('second', 2);
        hm.push('third', 3);
        expect(hm.getCurrentState()).toBe(3);
    });

    test('push deep clones state', () => {
        const hm = new HistoryManager<{ items: number[] }>();
        const data = { items: [1, 2, 3] };
        hm.push('init', data);
        data.items.push(4); // Mutate original
        expect(hm.getCurrentState()!.items).toEqual([1, 2, 3]); // Clone unchanged
    });

    // ==================== UNDO ====================

    test('undo returns previous state', () => {
        const hm = new HistoryManager<string>();
        hm.push('init', 'alpha');
        hm.push('change', 'beta');
        const result = hm.undo();
        expect(result).toBe('alpha');
    });

    test('undo with single state returns null', () => {
        const hm = new HistoryManager<string>();
        hm.push('init', 'only');
        expect(hm.undo()).toBeNull();
    });

    test('undo with empty stack returns null', () => {
        const hm = new HistoryManager<string>();
        expect(hm.undo()).toBeNull();
    });

    test('canUndo is true with >1 entries', () => {
        const hm = new HistoryManager<number>();
        hm.push('a', 1);
        expect(hm.canUndo()).toBe(false);
        hm.push('b', 2);
        expect(hm.canUndo()).toBe(true);
    });

    test('multiple undos walk back through history', () => {
        const hm = new HistoryManager<number>();
        hm.push('a', 10);
        hm.push('b', 20);
        hm.push('c', 30);
        hm.push('d', 40);
        expect(hm.undo()).toBe(30);
        expect(hm.undo()).toBe(20);
        expect(hm.undo()).toBe(10);
        expect(hm.undo()).toBeNull(); // Can't go before initial
    });

    test('getCurrentState after undo reflects undone state', () => {
        const hm = new HistoryManager<string>();
        hm.push('a', 'first');
        hm.push('b', 'second');
        hm.undo();
        expect(hm.getCurrentState()).toBe('first');
    });

    // ==================== REDO ====================

    test('redo returns next state after undo', () => {
        const hm = new HistoryManager<string>();
        hm.push('a', 'first');
        hm.push('b', 'second');
        hm.undo();
        const result = hm.redo();
        expect(result).toBe('second');
    });

    test('redo with nothing undone returns null', () => {
        const hm = new HistoryManager<string>();
        hm.push('a', 'first');
        expect(hm.redo()).toBeNull();
    });

    test('canRedo is true after undo', () => {
        const hm = new HistoryManager<number>();
        hm.push('a', 1);
        hm.push('b', 2);
        expect(hm.canRedo()).toBe(false);
        hm.undo();
        expect(hm.canRedo()).toBe(true);
    });

    test('multiple redo after multiple undo', () => {
        const hm = new HistoryManager<number>();
        hm.push('a', 1);
        hm.push('b', 2);
        hm.push('c', 3);
        hm.undo(); // -> 2
        hm.undo(); // -> 1
        expect(hm.redo()).toBe(2);
        expect(hm.redo()).toBe(3);
        expect(hm.redo()).toBeNull(); // Nothing more to redo
    });

    // ==================== BRANCHING ====================

    test('push after undo clears redo stack', () => {
        const hm = new HistoryManager<string>();
        hm.push('a', 'alpha');
        hm.push('b', 'beta');
        hm.push('c', 'gamma');
        hm.undo(); // -> beta
        hm.push('d', 'delta'); // branches — gamma is lost
        expect(hm.canRedo()).toBe(false);
        expect(hm.getCurrentState()).toBe('delta');
    });

    test('redo not available after branch', () => {
        const hm = new HistoryManager<number>();
        hm.push('a', 1);
        hm.push('b', 2);
        hm.undo();
        hm.push('c', 3);
        expect(hm.redo()).toBeNull();
    });

    // ==================== MAX DEPTH ====================

    test('respects maxDepth', () => {
        const hm = new HistoryManager<number>(5);
        for (let i = 0; i < 10; i++) {
            hm.push(`step-${i}`, i);
        }
        expect(hm.size().undo).toBe(5);
        expect(hm.getCurrentState()).toBe(9);
    });

    test('maxDepth evicts oldest entries', () => {
        const hm = new HistoryManager<number>(3);
        hm.push('a', 1);
        hm.push('b', 2);
        hm.push('c', 3);
        hm.push('d', 4); // evicts 1
        const history = hm.getUndoHistory();
        expect(history).toHaveLength(3);
        expect(history[0].label).toBe('b'); // oldest remaining
    });

    test('default maxDepth is 100', () => {
        const hm = new HistoryManager<number>();
        for (let i = 0; i < 150; i++) {
            hm.push(`step-${i}`, i);
        }
        expect(hm.size().undo).toBe(100);
    });

    // ==================== HISTORY DISPLAY ====================

    test('getUndoHistory returns labels and timestamps', () => {
        const hm = new HistoryManager<string>();
        hm.push('Create element', 'a');
        hm.push('Move element', 'b');
        const history = hm.getUndoHistory();
        expect(history).toHaveLength(2);
        expect(history[0].label).toBe('Create element');
        expect(history[1].label).toBe('Move element');
        expect(history[0].id).toBe('1');
        expect(history[1].id).toBe('2');
        expect(history[0].timestamp).toBeDefined();
    });

    test('getRedoHistory returns undone entries', () => {
        const hm = new HistoryManager<string>();
        hm.push('a', 'alpha');
        hm.push('b', 'beta');
        hm.push('c', 'gamma');
        hm.undo();
        hm.undo();
        const redo = hm.getRedoHistory();
        expect(redo).toHaveLength(2);
        expect(redo[0].label).toBe('c'); // stack order — last undone first
        expect(redo[1].label).toBe('b');
    });

    test('getUndoHistory does not include state data', () => {
        const hm = new HistoryManager<{ secret: string }>();
        hm.push('test', { secret: 'password' });
        const history = hm.getUndoHistory();
        expect(history[0]).not.toHaveProperty('state');
    });

    // ==================== SIZE ====================

    test('size returns undo and redo counts', () => {
        const hm = new HistoryManager<number>();
        expect(hm.size()).toEqual({ undo: 0, redo: 0 });
        hm.push('a', 1);
        hm.push('b', 2);
        hm.push('c', 3);
        expect(hm.size()).toEqual({ undo: 3, redo: 0 });
        hm.undo();
        expect(hm.size()).toEqual({ undo: 2, redo: 1 });
        hm.undo();
        expect(hm.size()).toEqual({ undo: 1, redo: 2 });
    });

    // ==================== CLEAR ====================

    test('clear resets everything', () => {
        const hm = new HistoryManager<string>();
        hm.push('a', 'alpha');
        hm.push('b', 'beta');
        hm.undo();
        hm.clear();
        expect(hm.size()).toEqual({ undo: 0, redo: 0 });
        expect(hm.getCurrentState()).toBeNull();
        expect(hm.canUndo()).toBe(false);
        expect(hm.canRedo()).toBe(false);
    });

    test('clear resets id counter', () => {
        const hm = new HistoryManager<string>();
        hm.push('a', 'alpha');
        hm.push('b', 'beta');
        hm.clear();
        hm.push('c', 'gamma');
        const history = hm.getUndoHistory();
        expect(history[0].id).toBe('1'); // Counter was reset
    });

    // ==================== DEEP CLONE INTEGRITY ====================

    test('getCurrentState returns a clone, not reference', () => {
        const hm = new HistoryManager<{ items: number[] }>();
        hm.push('init', { items: [1, 2, 3] });
        const state = hm.getCurrentState()!;
        state.items.push(4);
        expect(hm.getCurrentState()!.items).toEqual([1, 2, 3]); // Not mutated
    });

    test('undo returns a clone, not reference', () => {
        const hm = new HistoryManager<{ value: number }>();
        hm.push('a', { value: 1 });
        hm.push('b', { value: 2 });
        const undone = hm.undo()!;
        undone.value = 999;
        expect(hm.getCurrentState()!.value).toBe(1); // Not mutated
    });

    test('redo returns a clone, not reference', () => {
        const hm = new HistoryManager<{ value: number }>();
        hm.push('a', { value: 1 });
        hm.push('b', { value: 2 });
        hm.undo();
        const redone = hm.redo()!;
        redone.value = 999;
        expect(hm.getCurrentState()!.value).toBe(2); // Not mutated
    });

    // ==================== COMPLEX STATE ====================

    test('handles complex nested objects', () => {
        interface DesignState {
            pages: Array<{ id: string; components: Array<{ type: string; x: number; y: number }> }>;
            tokens: Record<string, string>;
        }
        const hm = new HistoryManager<DesignState>();
        hm.push('init', {
            pages: [{ id: 'p1', components: [{ type: 'button', x: 0, y: 0 }] }],
            tokens: { primary: '#007bff' }
        });
        hm.push('add component', {
            pages: [{ id: 'p1', components: [{ type: 'button', x: 0, y: 0 }, { type: 'text', x: 100, y: 100 }] }],
            tokens: { primary: '#007bff' }
        });
        const prev = hm.undo()!;
        expect(prev.pages[0].components).toHaveLength(1);
        const next = hm.redo()!;
        expect(next.pages[0].components).toHaveLength(2);
    });

    test('handles array state', () => {
        const hm = new HistoryManager<string[]>();
        hm.push('a', ['one']);
        hm.push('b', ['one', 'two']);
        hm.push('c', ['one', 'two', 'three']);
        expect(hm.undo()).toEqual(['one', 'two']);
        expect(hm.undo()).toEqual(['one']);
    });

    test('handles primitive state', () => {
        const hm = new HistoryManager<number>();
        hm.push('a', 42);
        hm.push('b', 99);
        expect(hm.undo()).toBe(42);
        expect(hm.redo()).toBe(99);
    });

    // ==================== EDGE CASES ====================

    test('rapid push-undo-push cycle', () => {
        const hm = new HistoryManager<number>();
        for (let i = 0; i < 50; i++) {
            hm.push(`step-${i}`, i);
            if (i % 3 === 0 && hm.canUndo()) {
                hm.undo();
                hm.push(`branch-${i}`, i * 100);
            }
        }
        // Should still be functional
        expect(hm.getCurrentState()).toBeDefined();
        expect(hm.size().undo).toBeGreaterThan(0);
    });

    test('undo all then push creates fresh branch', () => {
        const hm = new HistoryManager<string>();
        hm.push('a', 'first');
        hm.push('b', 'second');
        hm.push('c', 'third');
        hm.undo();
        hm.undo();
        // At 'first' now
        hm.push('new', 'new-branch');
        expect(hm.getCurrentState()).toBe('new-branch');
        expect(hm.canRedo()).toBe(false);
        expect(hm.size().undo).toBe(2); // 'first' + 'new-branch'
    });

    test('timestamps are ISO format', () => {
        const hm = new HistoryManager<string>();
        hm.push('test', 'value');
        const history = hm.getUndoHistory();
        const ts = history[0].timestamp;
        expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test('ids are incrementing strings', () => {
        const hm = new HistoryManager<number>();
        hm.push('a', 1);
        hm.push('b', 2);
        hm.push('c', 3);
        const history = hm.getUndoHistory();
        expect(history.map(h => h.id)).toEqual(['1', '2', '3']);
    });
});
