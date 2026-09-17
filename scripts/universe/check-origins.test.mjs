import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  classifyHost, contextOf, extractReferences, formatFinding, isCallSite, normalizeHost, scanText,
  FORBIDDEN_HOSTS, DENY_MARKER,
} from './check-origins.mjs';

const gate = new URL('./check-origins.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/**
 * The six inert fixtures of the 2026-09-16 audit (evidence/origin-gate-
 * reproduction.json). Each is one fetch expression in a file; the text is
 * scanned, never executed.
 */
const AUDIT_FIXTURES = [
  { name: 'root-domain', text: 'fetch("https://mempool.space/api/blocks/tip/height");', reject: true },
  { name: 'forbidden-subdomain', text: 'fetch("https://api.hiro.so/extended/v1/tx");', reject: true },
  { name: 'explorer-subdomain', text: 'fetch("https://api.mempool.space/api/blocks/tip/height");', reject: true },
  { name: 'uppercase-forbidden', text: 'fetch("https://MEMPOOL.SPACE/api/blocks/tip/height");', reject: true },
  { name: 'unlisted-provider', text: 'fetch("https://api.blockcypher.com/v1/btc/main");', reject: true },
  { name: 'owned-control', text: 'fetch("https://explorer.bitcoinuniverse.io/api/v1/backend-info");', reject: false },
];

function kinds(findings) {
  return findings.map((finding) => finding.kind);
}

test('the audit fixtures: five rejected, the owned control permitted by the approved policy only', () => {
  for (const fixture of AUDIT_FIXTURES) {
    const findings = scanText(fixture.text, { file: `${fixture.name}.js`, context: 'source' });
    if (fixture.reject) {
      assert.deepEqual(kinds(findings), ['forbidden-origin'], fixture.name);
    } else {
      assert.deepEqual(findings, [], fixture.name);
      assert.equal(classifyHost('explorer.bitcoinuniverse.io').category, 'approved');
    }
  }
  // The control is allowed because bitcoinuniverse.io is approved, not because
  // it is merely absent from the denylist: an equally unknown host at the same
  // call site is refused.
  const unknown = scanText('fetch("https://explorer.someone-else.example/api/v1/backend-info");', { context: 'source' });
  assert.deepEqual(kinds(unknown), ['unapproved-runtime-origin']);
});

test('the gate rejects the fixtures from the command line too, without executing them', () => {
  const directory = mkdtempSync(join(tmpdir(), 'origin-fixtures-'));
  try {
    for (const fixture of AUDIT_FIXTURES) {
      const file = join(directory, `${fixture.name}.js`);
      writeFileSync(file, fixture.text);
      const result = spawnSync(process.execPath, [gate, file], { encoding: 'utf8', timeout: 20_000 });
      assert.equal(result.status, fixture.reject ? 1 : 0, `${fixture.name}: ${result.stdout}${result.stderr}`);
      if (fixture.reject) assert.match(result.stderr, /forbidden-origin/);
      const json = spawnSync(process.execPath, [gate, '--json', file], { encoding: 'utf8', timeout: 20_000 });
      const { findings } = JSON.parse(json.stdout);
      assert.equal(findings.length, fixture.reject ? 1 : 0);
      if (fixture.reject) {
        assert.ok(findings[0].file.endsWith(`${fixture.name}.js`));
        assert.equal(findings[0].line, 1);
        assert.ok(findings[0].origin);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('hosts are compared after WHATWG parsing, lower-casing and trailing-dot removal', () => {
  assert.equal(normalizeHost('MEMPOOL.SPACE.'), 'mempool.space');
  assert.equal(normalizeHost('[::1]'), '::1');
  assert.equal(classifyHost('Api.Mempool.Space').category, 'forbidden');
  assert.equal(classifyHost('mempool.space.').category, 'forbidden');
  assert.equal(classifyHost('api.hiro.so').matched, 'hiro.so');
  const [reference] = extractReferences('const u = "HTTPS://API.BLOCKCYPHER.COM:443/v1";');
  assert.equal(reference.host, 'api.blockcypher.com');
  assert.equal(reference.port, '');
  assert.equal(reference.origin, 'https://api.blockcypher.com');
});

test('lookalike suffixes: an infix provider is rejected, a shared substring is not a match', () => {
  // `mempool.space.evil.example` is not a subdomain of mempool.space; it is
  // rejected as a lookalike so a registrable-domain trick never passes.
  assert.equal(classifyHost('mempool.space.evil.example').category, 'lookalike');
  assert.deepEqual(kinds(scanText('fetch("https://mempool.space.evil.example/api");')), ['lookalike-origin']);
  // `notmempool.space` shares no label boundary with mempool.space. It is an
  // unknown host, refused by the runtime policy rather than by the denylist,
  // and never reported as mempool.space.
  assert.equal(classifyHost('notmempool.space').category, 'unknown');
  const findings = scanText('fetch("https://notmempool.space/api");');
  assert.deepEqual(kinds(findings), ['unapproved-runtime-origin']);
  assert.equal(findings[0].matched, undefined);
  // A file name is not a host.
  assert.deepEqual(scanText("import { BtcComponent } from './btc.component';"), []);
});

test('credentials in a URL are a finding and are never printed', () => {
  const text = 'const r = await fetch("https://operator:hunter2-secret@services.example.net/api/v1");';
  const findings = scanText(text, { file: 'src/x.ts', context: 'source' });
  assert.deepEqual(kinds(findings), ['credential-in-url', 'unapproved-runtime-origin']);
  for (const finding of findings) {
    const printed = formatFinding(finding) + JSON.stringify(finding);
    assert.doesNotMatch(printed, /hunter2|operator/);
    assert.equal(finding.host, 'services.example.net');
  }
  // Credentials on an owned host are still a finding: a bearer in a URL is a
  // secret in configuration.
  const owned = scanText('SERVICES_API=https://token:abc@explorer.bitcoinuniverse.io/api', { context: 'runtime-config' });
  assert.deepEqual(kinds(owned), ['credential-in-url']);
  assert.doesNotMatch(JSON.stringify(owned), /abc/);
  // Loopback credentials are local (Core RPC style) and not reported.
  assert.deepEqual(scanText('const rpc = "http://user:pass@127.0.0.1:8332";'), []);
});

test('ports do not change the verdict', () => {
  assert.deepEqual(scanText('fetch("https://explorer.bitcoinuniverse.io:8443/api/v1/backend-info");'), []);
  const findings = scanText('fetch("https://mempool.space:443/api/v1/fees");');
  assert.deepEqual(kinds(findings), ['forbidden-origin']);
  assert.equal(findings[0].port, '');
  const odd = scanText('proxy_pass http://node201.hnl.mempool.space:3000;', { context: 'runtime-config' });
  assert.equal(odd[0].port, '3000');
  assert.equal(odd[0].origin, 'http://node201.hnl.mempool.space:3000');
});

test('redirects to a forbidden provider are rejected', () => {
  assert.deepEqual(kinds(scanText('return 301 https://mempool.space$request_uri;', { context: 'runtime-config' })), ['forbidden-origin']);
  assert.deepEqual(kinds(scanText("res.redirect('https://api.blockcypher.com/v1/btc/main');")), ['forbidden-origin']);
  assert.deepEqual(kinds(scanText('rewrite ^/liquid/(.*) https://liquid.network/$1;', { context: 'runtime-config' })), []);
});

test('approved metadata and citation contexts', () => {
  // The Liquid asset catalogue is the documented metadata exception.
  assert.deepEqual(scanText('"LIQUID_API": "https://liquid.network/api/v1",', { context: 'runtime-config' }), []);
  // A specification citation in a comment or a specification field is not a fetch.
  assert.deepEqual(scanText('  // see pointer docs: https://docs.ordinals.com/inscriptions/pointer.html'), []);
  assert.deepEqual(scanText("        specification_url: 'https://docs.ordinals.com/runes.html',"), []);
  // The same host at a call site is a call, not a citation.
  assert.deepEqual(kinds(scanText("fetch('https://docs.ordinals.com/runes.html')")), ['citation-host-called']);
  // Documentation may cite any host; a bundle may cite none.
  assert.deepEqual(scanText('Compare with https://mempool.space/docs/api', { context: 'documentation' }), []);
  assert.deepEqual(kinds(scanText('x="https://docs.ordinals.com/"', { context: 'bundle' })), ['citation-host-called']);
  assert.deepEqual(kinds(scanText('x="https://mempool.space/"', { context: 'bundle' })), ['forbidden-origin']);
  // A comment naming a forbidden provider in code is still a finding: comments
  // are stripped from bundles, so the source scan is the only place it shows.
  assert.deepEqual(kinds(scanText('// fallback: https://mempool.space/api')), ['forbidden-origin']);
  // An unknown host in a code comment is a citation, not a call.
  assert.deepEqual(scanText('// adapted from https://stackoverflow.example/q/1'), []);
});

test('build inputs are allowed in build context only', () => {
  const line = 'RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash -';
  assert.deepEqual(scanText(line, { context: 'build' }), []);
  assert.deepEqual(kinds(scanText(line, { context: 'source' })), ['unapproved-runtime-origin']);
  assert.deepEqual(kinds(scanText('"POOLS_JSON_URL": "https://raw.githubusercontent.com/x/y/pools.json",', { context: 'runtime-config' })), ['unapproved-runtime-origin']);
  assert.equal(contextOf('docker/backend/Dockerfile'), 'build');
  assert.equal(contextOf('.github/workflows/docker.yml'), 'build');
  assert.equal(contextOf('docker/init.sh'), 'build');
});

test('runtime configuration values are all judged, call sites in code are judged, plain links are not', () => {
  assert.equal(contextOf('docker/backend/start.sh'), 'runtime-config');
  assert.equal(contextOf('docker/frontend/entrypoint.sh'), 'runtime-config');
  assert.equal(contextOf('production/mempool-config.mainnet.json'), 'runtime-config');
  assert.equal(contextOf('backend/mempool-config.sample.json'), 'runtime-config');
  assert.equal(contextOf('backend/src/api/about.routes.ts'), 'source');
  assert.equal(contextOf('backend/src/__tests__/config.test.ts'), 'test');
  assert.equal(contextOf('docs/operations/INSTALL.md'), 'documentation');
  assert.equal(contextOf('docs/research/competitors.md'), 'citation');
  assert.equal(contextOf('scripts/universe/check-origins.test.mjs'), 'gate');
  // Configuration: an unknown host is a finding even without a call token.
  assert.deepEqual(kinds(scanText('__X_API__=${X_API:=https://api.partner.example/v1}', { context: 'runtime-config' })), ['unapproved-runtime-origin']);
  // Code: an unknown host is a finding only where a request is made.
  assert.ok(isCallSite('axios.get(url)'));
  assert.deepEqual(kinds(scanText("axios.get('https://api.partner.example/v1/tx')")), ['unapproved-runtime-origin']);
  assert.deepEqual(scanText("link: 'https://pool.example/about'"), []);
  // Same-origin, loopback and container names are fine everywhere.
  assert.deepEqual(scanText("fetch('/api/v1/blocks'); fetch('http://127.0.0.1:8999/x'); fetch('http://api:8999/x'); fetch('ws://localhost:8999/ws');", { context: 'runtime-config' }), []);
  // Unit tests keep the denylist and nothing else.
  assert.deepEqual(kinds(scanText("fetch('https://user:pw@partner.example/x'); fetch('https://mempool.space/x');", { context: 'test' })), ['forbidden-origin']);
});

test('a script that refuses a forbidden host may name it on a marked line', () => {
  const line = `    mempoolhqx4isw62xs7abwphsq7ldayuidyx2v2oethdhhj6mlo2r6ad.onion) ;; # ${DENY_MARKER}`;
  assert.deepEqual(scanText(line, { context: 'runtime-config' }), []);
  assert.deepEqual(kinds(scanText(line.replace(` # ${DENY_MARKER}`, ''), { context: 'runtime-config' })), ['forbidden-origin']);
  assert.deepEqual(kinds(scanText(line, { context: 'bundle' })), ['forbidden-origin']);
});

test('findings are structured: file, line, field, origin', () => {
  const [finding] = scanText('__MEMPOOL_SERVICES_API__=${MEMPOOL_SERVICES_API:="https://mempool.space/api/v1/services"}', { file: 'docker/backend/start.sh', context: 'runtime-config' });
  assert.equal(finding.file, 'docker/backend/start.sh');
  assert.equal(finding.line, 1);
  assert.equal(finding.field, '__MEMPOOL_SERVICES_API__');
  assert.equal(finding.origin, 'https://mempool.space');
  assert.equal(formatFinding(finding), '  docker/backend/start.sh:1: forbidden-origin https://mempool.space [__MEMPOOL_SERVICES_API__]');
  const [json] = scanText('    "API": "https://mempool.space/api/v1/services",', { file: 'c.json', context: 'runtime-config' });
  assert.equal(json.field, 'API');
});

test('the denylist covers the providers the audit named', () => {
  for (const host of ['mempool.space', 'api.mempool.space', 'hiro.so', 'unisat.io', 'blockcypher.com', 'ordinals.com', 'blockstream.info']) {
    assert.equal(classifyHost(host).category, 'forbidden', host);
  }
  assert.ok(FORBIDDEN_HOSTS.every((host) => host === normalizeHost(host)));
});
