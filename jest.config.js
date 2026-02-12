/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/tests'],
    testMatch: ['**/*.test.ts'],
    moduleNameMapper: {
        '^@core/(.*)$': '<rootDir>/src/core/$1',
        '^@agents/(.*)$': '<rootDir>/src/agents/$1',
        '^@mcp/(.*)$': '<rootDir>/src/mcp/$1',
        '^@types/(.*)$': '<rootDir>/src/types/$1',
        '^vscode$': '<rootDir>/tests/__mocks__/vscode.ts',
    },
    modulePathIgnorePatterns: ['<rootDir>/dist/'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: {
                module: 'commonjs',
                target: 'ES2022',
                lib: ['ES2022'],
                strict: true,
                esModuleInterop: true,
                skipLibCheck: true,
                resolveJsonModule: true,
                moduleResolution: 'node',
                types: ['jest', 'node'],
            },
        }],
    },
};
