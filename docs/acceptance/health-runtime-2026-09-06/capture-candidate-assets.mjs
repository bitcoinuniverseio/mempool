import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const root = process.argv[2], dist = resolve(root, 'frontend/dist/mempool/browser');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const html = readFileSync(resolve(dist, 'index.html'), 'utf8');
const names = ['index.html', ...[...html.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))"/g)].map(match => match[1])];
const files = [];
for (const name of [...new Set(names)]) {
  if (/^(?:https?:)?\/\//.test(name) || name.includes('..')) continue;
  const local = resolve(dist, name.replace(/^\//, '')), bytes = readFileSync(local);
  const url = `http://127.0.0.1:4310/${name === 'index.html' ? '' : name.replace(/^\//, '')}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const served = Buffer.from(await response.arrayBuffer());
  files.push({ path: name, url, status: response.status, bytes: bytes.length,
    localSha256: hash(bytes), servedSha256: hash(served), matches: response.status === 200 && hash(bytes) === hash(served),
    localLastWriteUtc: statSync(local).mtime.toISOString() });
}
const source = '64d9ebccd6deb1da07c14fbb3fe77596af1f3646', latest = 'c65ab3fb00117e8515b22d40d5a3e2aa62d38f6f';
const changed = execFileSync('git', ['diff', '--name-only', source, latest, '--', 'frontend', 'scripts/universe/gateway.mjs'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const result = { recordedAt: new Date().toISOString(), method: 'Actual local gateway GET bytes compared with the built frontend files from the candidate directory',
  source, currentRepositorySource: latest, changedFrontendOrGatewayFilesSinceRuntimeSource: changed ? changed.split(/\r?\n/) : [],
  gatewaySourceSha256: hash(readFileSync(resolve(root, 'scripts/universe/gateway.mjs'))), files,
  accepted: files.every(file => file.matches) && changed.length === 0,
  limitation: 'This binds the served local assets and unchanged frontend/gateway source. It does not assert that the newly repaired mempool backend is serving; Bitcoin data still come from the older public backend.' };
writeFileSync(resolve(root, 'docs/acceptance/health-runtime-2026-09-06/candidate-asset-binding.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ accepted: result.accepted, checkedAssets: files.length, changedSourceFiles: result.changedFrontendOrGatewayFilesSinceRuntimeSource }));
if (!result.accepted) process.exitCode = 1;
