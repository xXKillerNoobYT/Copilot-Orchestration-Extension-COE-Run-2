declare module 'node:sqlite' {
    interface RunResult {
        changes: number | bigint;
        lastInsertRowid: number | bigint;
    }

    class StatementSync {
        run(...params: unknown[]): RunResult;
        get(...params: unknown[]): unknown;
        all(...params: unknown[]): unknown[];
    }

    export class DatabaseSync {
        constructor(location: string);
        exec(sql: string): void;
        prepare(sql: string): StatementSync;
        close(): void;
    }
}
