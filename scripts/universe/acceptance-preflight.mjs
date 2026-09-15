import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '../..');
// --origin and --network point the probes at the gateway under test; the
// network becomes the route prefix the gateway expects (/signet/api/...).
// Without them the historic local candidate defaults apply.
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const positional = args.filter((value, index) => !value.startsWith('--') && (index === 0 || !args[index - 1].startsWith('--')));
const origin = option('--origin', 'http://localhost:4310').replace(/\/$/, '');
const network = option('--network', '');
const prefix = network && network !== 'mainnet' ? `/${network}` : '';
const probes = [];
// Invalid detail IDs exercise transport only. They are never authority fixtures.
for (const bare of [
  '/__gateway/health', '/api/v1/__acceptance', '/api/v1/backend-info',
  '/api/v1/capabilities', '/api/v1/universe/status',
  '/api/v1/anima/status', '/api/v1/anima/events?from=0&limit=1',
  '/api/v1/anima/events/invalid-acceptance-identity',
  '/api/v1/anima/organisms?offset=0&limit=1',
  '/api/v1/anima/organisms/invalid-acceptance-identity',
  '/api/v1/anima/organisms/invalid-acceptance-identity/history?limit=1',
]) {
  const path = bare.startsWith('/__gateway') ? bare : prefix + bare;
  try {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(12000), headers: { accept: 'application/json' } });
    const body = await response.text();
    const type = response.headers.get('content-type');
    let document = null;
    try { document = JSON.parse(body); } catch { /* A non-JSON reply remains a contract error. */ }
    probes.push({ path, status: response.status, contentType: type, document,
      bodySha256: createHash('sha256').update(body).digest('hex'),
      contract: type?.includes('application/json') && document !== null ? 'JSON' : 'FAIL_NON_JSON',
      acceptance: 'NOT AN OPERATION PASS', checkedAt: new Date().toISOString() });
  } catch (error) {
    probes.push({ path, status: null, error: error.cause?.code ?? error.message, acceptance: 'BLOCKED', checkedAt: new Date().toISOString() });
  }
}
const sourcePaths = ['scripts/universe/gateway.mjs', 'scripts/universe/acceptance-server.cjs'];
const report = {
  checkedAt: new Date().toISOString(), origin, network: network || 'mainnet',
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  scope: 'Actual candidate gateway with isolated compiled parser/swap handlers; no indexer, chain authority or database configured.',
  source: sourcePaths.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex') })),
  probes, realNetworkE2ePasses: 0, realSignetE2ePasses: 0,
  prerequisites: {
    'PRE-01': 'The established D:/universe/.ssh/config loader is unreadable by this session (Permission denied). No owned Core network/checkpoint or controlled reference was obtained.',
    'PRE-02': 'No approved disposable MySQL credential loader in the scoped candidate configuration/environment. DATABASE.ENABLED=false; no SQL attempted.',
    'PRE-03': 'No overlay listener on 127.0.0.1:3400 or approved per-authority context/reference. Gateway errors do not establish a production outage.',
    'PRE-04': 'No configured provider trust, versioned signed manifest, health history or authenticated settlement receipt source in the scoped candidate.',
    'PRE-05': 'No active paired Control Center test identities, controlled audit persistence or safely configured private operation runtime.',
    'PRE-06': 'Universe CI triggers self-hosted jobs on develop/main push and pull requests. No push, PR, workflow or deployment invoked.',
  },
};
writeFileSync(resolve(root, positional[0] || 'docs/acceptance/preflight-2026-09-06.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ origin, probes: probes.map(({path,status,contract}) => ({path,status,contract})), realNetworkE2ePasses: 0 }));
