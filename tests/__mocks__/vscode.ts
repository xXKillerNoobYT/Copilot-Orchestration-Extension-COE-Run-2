// Mock VS Code API for testing outside of VS Code runtime

export const window = {
    createOutputChannel: jest.fn(() => ({
        appendLine: jest.fn(),
        show: jest.fn(),
        dispose: jest.fn(),
    })),
    showInformationMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showInputBox: jest.fn(),
    showQuickPick: jest.fn(),
    registerTreeDataProvider: jest.fn(),
    withProgress: jest.fn((_opts: unknown, fn: Function) => fn()),
};

export const workspace = {
    getConfiguration: jest.fn(() => ({
        get: jest.fn(),
    })),
    workspaceFolders: [{ uri: { fsPath: '/tmp/test-workspace' } }],
    createFileSystemWatcher: jest.fn(() => ({
        onDidChange: jest.fn(),
        onDidCreate: jest.fn(),
        onDidDelete: jest.fn(),
        dispose: jest.fn(),
    })),
    openTextDocument: jest.fn(() => Promise.resolve({
        getText: jest.fn(() => ''),
    })),
};

export const commands = {
    registerCommand: jest.fn(),
    executeCommand: jest.fn(),
};

export const ExtensionContext = jest.fn();

export class EventEmitter {
    event = jest.fn();
    fire = jest.fn();
    dispose = jest.fn();
}

export class TreeItem {
    label: string;
    collapsibleState: number;
    description?: string;
    tooltip?: string;
    iconPath?: unknown;
    contextValue?: string;
    command?: unknown;

    constructor(label: string, collapsibleState: number = 0) {
        this.label = label;
        this.collapsibleState = collapsibleState;
    }
}

export enum TreeItemCollapsibleState {
    None = 0,
    Collapsed = 1,
    Expanded = 2,
}

export class ThemeIcon {
    constructor(public id: string) {}
}

export class RelativePattern {
    constructor(public base: string, public pattern: string) {}
}

export enum ProgressLocation {
    Notification = 15,
    SourceControl = 1,
    Window = 10,
}

export const Uri = {
    file: (path: string) => ({ fsPath: path, scheme: 'file' }),
};
