# VS Code Marketplace Publishing

## Purpose
Publish COE to the VS Code Marketplace so developers can install it with one click.

## Prerequisites
1. `vsce` installed: `npm install -g @vscode/vsce`
2. Azure DevOps personal access token (PAT)
3. Publisher account on VS Code Marketplace

## Pre-Publish Checklist
- [ ] Version bumped in `package.json` (currently 1.0.0)
- [ ] `CHANGELOG.md` updated with latest changes
- [ ] `README.md` has features, setup, configuration, architecture
- [ ] `LICENSE` file exists (MIT)
- [ ] `.vscodeignore` excludes source, tests, dev files
- [ ] `resources/coe-icon.png` exists (128x128)
- [ ] All tests pass: `npm test`
- [ ] Build succeeds: `npm run build`
- [ ] Type check passes: `npx tsc --noEmit`
- [ ] No hardcoded secrets in source
- [ ] `package.json` has: publisher, repository, icon, galleryBanner, keywords, license

## Publishing Steps
1. Package: `vsce package`
2. Fix any warnings from the packaging step
3. Test locally: `code --install-extension copilot-orchestration-extension-1.0.0.vsix`
4. Publish: `vsce publish`
5. Verify on Marketplace

## Package Contents
After `.vscodeignore` filtering, the VSIX includes:
- `dist/extension.js` (bundled by esbuild)
- `package.json`
- `README.md`
- `CHANGELOG.md`
- `LICENSE`
- `resources/` (icons)

## Quality Checks
- Activation time < 2 seconds
- MCP server response < 200ms p95
- Web app load < 1 second
- Memory usage < 50MB idle
- No localhost-only dependencies exposed
- SQL injection protection (parameterized queries)
- XSS protection in web app (all user input escaped)
- Custom agent hardlock enforced (no write/execute)
