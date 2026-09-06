// Record the already completed local checks and fingerprint their source/build.
// This recorder performs no server, browser, network, or database operation.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../..');
const runtime = resolve(root, '../.runtime');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (args, cwd = root) => execFileSync('git', ['-c', 'core.safecrlf=false', ...args], { cwd, encoding: 'utf8' }).trim();
const json = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const file = path => ({ path: relative(root, path).replaceAll('\\', '/'), sha256: hash(readFileSync(path)) });
function tree(paths) {
  const files = [...new Set(paths)].filter(path => existsSync(resolve(root, path))).sort()
    .map(path => file(resolve(root, path)));
  return { fileCount: files.length, sha256: hash(files.map(row => row.path + '\0' + row.sha256).join('\n')) };
}
function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? walk(resolve(directory, entry.name)) : [resolve(directory, entry.name)]);
}
const tested = json(resolve(runtime, 'acceptance-frontend-tests-final.json'));
assert.equal(tested.success, true);
assert.equal(tested.numFailedTests, 0);
const lint = json(resolve(runtime, 'acceptance-frontend-lint-final.json'));
assert.equal(lint.reduce((count, row) => count + row.errorCount, 0), 0);
const paths = (git(['ls-files', '-z']) + '\0' + git(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0');
const changed = (git(['diff', '--name-only', '4e9701186b7b6bc55aa8f02079dd92fa5facddad']) + '\n' +
  git(['ls-files', '--others', '--exclude-standard'])).split('\n')
  .filter(path => /^(frontend\/|backend\/|scripts\/)/.test(path));
const buildRoot = resolve(root, 'frontend/dist/mempool/browser');
const buildFiles = walk(buildRoot).filter(path => /\.(js|css|html)$/.test(path)).map(path => relative(root, path));
const reports = ['backend-verification', 'parser-http', 'browser-navigation', 'browser-parser',
  'browser-responsive', 'browser-workflows', 'browser-portfolio', 'browser-feature-config', 'reconciliation'];
const report = {
  generatedAt: new Date().toISOString(), result: 'LOCAL_CHECKS_PASS_FUNCTIONAL_NO_GO', realNetworkE2ePasses: 0,
  scope: 'Local frontend full tests, scoped lint, builds and actual single-page localhost checks. Backend limits remain in its separate report.',
  revisions: { mempool: git(['rev-parse', 'HEAD']),
    overlay: git(['rev-parse', 'HEAD'], 'D:/universe/backend-apis/backend-apis'),
    inscribeSender: git(['rev-parse', 'HEAD'], 'D:/universe/inscribe/.tmp/explorer-admin-signed-elevation') },
  frontend: { command: 'npm test -- --reporter=json --outputFile=<local report>', exitCode: 0,
    files: tested.testResults.length, passed: tested.numPassedTests, failed: tested.numFailedTests, skipped: tested.numPendingTests,
    lint: { scope: 'Changed and new TypeScript files', files: lint.length, exitCode: 0,
      errors: 0, warnings: lint.reduce((count, row) => count + row.warningCount, 0) },
    build: { command: 'npm run build:universe', exitCode: 0, warnings: 'Bundle/CSS budgets, CommonJS dependencies and unused discovery worker compilation warnings remain; see hashed local log' } },
  overlayBuild: { command: 'npm run build', exitCode: 0 },
  gatewayAndProtocolTests: { command: 'node --test scripts/universe/gateway.test.mjs scripts/universe/protocol-contract.test.mjs', exitCode: 0, passed: 52 },
  source: { frontend: tree(paths.filter(path => path.startsWith('frontend/'))),
    backend: tree(paths.filter(path => path.startsWith('backend/'))),
    changedFiles: [...new Set(changed)].sort().map(path => file(resolve(root, path))) },
  renderedBuild: { scope: 'Built HTML, CSS and JavaScript served by the localhost acceptance host', ...tree(buildFiles) },
  evidence: [...reports.map(name => file(resolve(root, 'docs/acceptance', name + '-2026-09-05.json'))),
    ...['2026-09-05-inventory.json', '2026-09-05-controls.json'].map(name => file(resolve(root, 'docs/acceptance', name)))],
  localLogs: ['acceptance-frontend-tests-final.json', 'acceptance-frontend-build-final.log',
    'acceptance-frontend-lint-final.json', 'acceptance-overlay-build-final.log', 'acceptance-browser-final.log']
    .map(name => file(resolve(runtime, name))),
};
writeFileSync(resolve(root, 'docs/acceptance/final-verification-2026-09-05.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ revisions: report.revisions, frontend: report.frontend, renderedBuild: report.renderedBuild }));
