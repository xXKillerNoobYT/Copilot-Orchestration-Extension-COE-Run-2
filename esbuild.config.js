const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const serverOnly = process.argv.includes('--server');

async function main() {
    const contexts = [];

    // --- Extension build (skip when --server) ---
    if (!serverOnly) {
        const extCtx = await esbuild.context({
            entryPoints: ['src/extension.ts'],
            bundle: true,
            format: 'cjs',
            minify: production,
            sourcemap: !production,
            sourcesContent: false,
            platform: 'node',
            outfile: 'dist/extension.js',
            external: [
                'vscode',
                'node:sqlite'
            ],
            logLevel: 'info',
            define: {
                'process.env.NODE_ENV': production ? '"production"' : '"development"'
            }
        });
        contexts.push(extCtx);
    }

    // --- Standalone server build ---
    const serverCtx = await esbuild.context({
        entryPoints: ['src/server.ts'],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        outfile: 'dist/server.js',
        external: [
            // vscode is NOT external — if any import leaks, the build fails
            'node:sqlite'
        ],
        logLevel: 'info',
        define: {
            'process.env.NODE_ENV': production ? '"production"' : '"development"'
        }
    });
    contexts.push(serverCtx);

    if (watch) {
        for (const ctx of contexts) {
            await ctx.watch();
        }
        console.log('Watching for changes...');
    } else {
        for (const ctx of contexts) {
            await ctx.rebuild();
            await ctx.dispose();
        }
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
