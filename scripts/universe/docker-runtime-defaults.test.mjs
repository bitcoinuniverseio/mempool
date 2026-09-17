import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { scanText } from './check-origins.mjs';

/**
 * The container start scripts render the runtime configuration that the
 * images actually run with. These tests run the real scripts against copies
 * of the real templates and judge the rendered result with the origin gate:
 * an unconfigured service must fail visibly rather than reach a third party.
 */

const root = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const repo = (...parts) => join(root, ...parts);
const posix = (path) => path.split(sep).join('/');
const startSh = readFileSync(repo('docker', 'backend', 'start.sh'), 'utf8');
const entrypointSh = readFileSync(repo('docker', 'frontend', 'entrypoint.sh'), 'utf8');
const backendTemplate = readFileSync(repo('docker', 'backend', 'mempool-config.json'), 'utf8');

/** On Windows the POSIX tools the scripts use (find, sed, envsubst) live in Git's own bin directories. */
const posixBins = process.platform === 'win32'
  ? spawnSync('bash', ['-c', 'cygpath -w /usr/bin; cygpath -w /mingw64/bin'], { encoding: 'utf8' }).stdout.split(/\r?\n/).filter(Boolean)
  : [];

/** A shell environment with nothing of this process's configuration in it. */
function bareEnvironment(extra = {}, binDirectory) {
  const environment = {
    PATH: [binDirectory, ...posixBins, process.env.PATH].filter(Boolean).join(delimiter),
    HOME: process.env.HOME ?? process.env.USERPROFILE ?? tmpdir(),
    TEMP: tmpdir(), TMP: tmpdir(),
  };
  if (process.env.SYSTEMROOT) environment.SYSTEMROOT = process.env.SYSTEMROOT;
  if (process.env.SystemRoot) environment.SystemRoot = process.env.SystemRoot;
  return { ...environment, ...extra };
}

/** Run docker/backend/start.sh in a scratch directory; `node` is a stub. */
function renderBackend(extra = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'backend-render-'));
  try {
    const bin = join(directory, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'node'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(bin, 'node'), 0o755);
    writeFileSync(join(directory, 'start.sh'), startSh.replaceAll('\r\n', '\n'));
    writeFileSync(join(directory, 'mempool-config.json'), backendTemplate);
    const result = spawnSync('bash', ['start.sh'], {
      cwd: directory, encoding: 'utf8', env: bareEnvironment(extra, bin), timeout: 30_000,
    });
    assert.equal(result.error, undefined);
    const rendered = readFileSync(join(directory, 'mempool-config.json'), 'utf8');
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, rendered };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Run docker/frontend/entrypoint.sh against scratch nginx and web roots. */
function renderFrontend(extra = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'frontend-render-'));
  try {
    const etc = join(directory, 'etc', 'nginx');
    const patch = join(directory, 'patch');
    const www = join(directory, 'www', 'resources');
    mkdirSync(join(etc, 'conf.d'), { recursive: true });
    mkdirSync(patch);
    mkdirSync(www, { recursive: true });
    copyFileSync(repo('nginx.conf'), join(etc, 'nginx.conf'));
    copyFileSync(repo('nginx-mempool.conf'), join(etc, 'conf.d', 'nginx-mempool.conf'));
    // The shape frontend/generate-config.js writes for string settings.
    writeFileSync(join(www, 'config.template.js'), [
      '(function (window) {',
      '  window.__env = window.__env || {};',
      "    window.__env.MEMPOOL_WEBSITE_URL = '${__MEMPOOL_WEBSITE_URL__}';",
      "    window.__env.SERVICES_API = '${__SERVICES_API__}';",
      "    window.__env.ONION_SERVICES_API = '${__ONION_SERVICES_API__}';",
      '  }(this));',
    ].join('\n'));
    writeFileSync(join(www, 'config.js'), '');
    writeFileSync(join(directory, 'entrypoint.sh'), entrypointSh.replaceAll('\r\n', '\n'));
    const result = spawnSync('bash', ['entrypoint.sh', 'true'], {
      cwd: directory, encoding: 'utf8', timeout: 30_000,
      // Forward slashes: the script hands these paths to find and xargs.
      env: bareEnvironment({ NGINX_ETC: posix(etc), PATCH_DIR: posix(patch), MEMPOOL_WWW: posix(join(directory, 'www')), ...extra }),
    });
    assert.equal(result.error, undefined);
    const rendered = readFileSync(join(www, 'config.js'), 'utf8');
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, rendered };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('the shipped templates carry no third-party or unapproved runtime origin', () => {
  for (const [file, text] of [
    ['docker/backend/start.sh', startSh],
    ['docker/frontend/entrypoint.sh', entrypointSh],
    ['docker/backend/mempool-config.json', backendTemplate],
  ]) {
    assert.deepEqual(scanText(text, { file, context: 'runtime-config' }), [], file);
  }
});

test('backend: a minimal environment renders valid JSON with no external data source', () => {
  const { status, stderr, rendered } = renderBackend();
  assert.equal(status, 0, stderr);
  const config = JSON.parse(rendered);
  assert.deepEqual(scanText(rendered, { file: 'mempool-config.json', context: 'rendered-config' }), []);
  assert.equal(config.EXTERNAL_DATA_SERVER.MEMPOOL_API, '');
  assert.equal(config.EXTERNAL_DATA_SERVER.MEMPOOL_ONION, '');
  assert.equal(config.MEMPOOL_SERVICES.API, '');
  assert.equal(config.MEMPOOL_SERVICES.ACCELERATIONS, false);
  assert.equal(config.FIAT_PRICE.ENABLED, false);
  assert.equal(config.MEMPOOL.AUTOMATIC_POOLS_UPDATE, false);
  assert.equal(config.MEMPOOL.POOLS_JSON_URL, '');
  assert.equal(config.MEMPOOL.POOLS_JSON_TREE_URL, '');
  assert.deepEqual(config.ESPLORA.FALLBACK, []);
  // The one documented external metadata source stays: the Liquid asset catalogue.
  assert.equal(config.EXTERNAL_DATA_SERVER.LIQUID_API, 'https://liquid.network/api/v1');
  assert.doesNotMatch(rendered, /mempool\.space|mempoolhqx4|blockstream|__[A-Z0-9_]+__/);
});

test('backend: explicit owned endpoints are preserved exactly', () => {
  const owned = {
    EXTERNAL_DATA_SERVER_MEMPOOL_API: 'https://explorer.bitcoinuniverse.io/api/v1',
    EXTERNAL_DATA_SERVER_MEMPOOL_ONION: 'http://universe3xample2onion4address5for6tests7only8abcdefg.onion/api/v1',
    MEMPOOL_SERVICES_API: 'https://Services.BitcoinUniverse.io:8443/api/v1/services',
    MEMPOOL_POOLS_JSON_URL: 'http://api:8999/pools/pools-v2.json',
    MEMPOOL_POOLS_JSON_TREE_URL: '/pools/tree',
    FIAT_PRICE_ENABLED: 'true',
  };
  const { status, stderr, rendered } = renderBackend(owned);
  assert.equal(status, 0, stderr);
  const config = JSON.parse(rendered);
  assert.equal(config.EXTERNAL_DATA_SERVER.MEMPOOL_API, owned.EXTERNAL_DATA_SERVER_MEMPOOL_API);
  assert.equal(config.EXTERNAL_DATA_SERVER.MEMPOOL_ONION, owned.EXTERNAL_DATA_SERVER_MEMPOOL_ONION);
  assert.equal(config.MEMPOOL_SERVICES.API, owned.MEMPOOL_SERVICES_API);
  assert.equal(config.MEMPOOL.POOLS_JSON_URL, owned.MEMPOOL_POOLS_JSON_URL);
  assert.equal(config.MEMPOOL.POOLS_JSON_TREE_URL, owned.MEMPOOL_POOLS_JSON_TREE_URL);
  assert.equal(config.FIAT_PRICE.ENABLED, true);
  assert.deepEqual(scanText(rendered, { file: 'mempool-config.json', context: 'rendered-config' }), []);
});

test('backend: disallowed, malformed and credential-bearing endpoints stop the container without echoing secrets', () => {
  const cases = [
    { env: { MEMPOOL_SERVICES_API: 'https://mempool.space/api/v1/services' }, message: /MEMPOOL_SERVICES_API .*host: mempool\.space/ },
    { env: { MEMPOOL_SERVICES_API: 'https://MEMPOOL.SPACE./api/v1/services' }, message: /host: mempool\.space\)/ },
    { env: { EXTERNAL_DATA_SERVER_MEMPOOL_API: 'https://api.mempool.space/api/v1' }, message: /EXTERNAL_DATA_SERVER_MEMPOOL_API .*host: api\.mempool\.space/ },
    { env: { EXTERNAL_DATA_SERVER_MEMPOOL_API: 'https://explorer.bitcoinuniverse.io.evil.example/api/v1' }, message: /host: explorer\.bitcoinuniverse\.io\.evil\.example/ },
    { env: { EXTERNAL_DATA_SERVER_MEMPOOL_ONION: 'http://mempoolhqx4isw62xs7abwphsq7ldayuidyx2v2oethdhhj6mlo2r6ad.onion/api/v1' }, message: /EXTERNAL_DATA_SERVER_MEMPOOL_ONION .*host: mempoolhqx4/ },
    { env: { EXTERNAL_DATA_SERVER_MEMPOOL_API: 'http://universe3xample2onion4address5for6tests7only8abcdefg.onion/api/v1' }, message: /EXTERNAL_DATA_SERVER_MEMPOOL_API .*\.onion/ },
    { env: { EXTERNAL_DATA_SERVER_LIQUID_API: 'https://blockstream.info/liquid/api' }, message: /EXTERNAL_DATA_SERVER_LIQUID_API .*host: blockstream\.info/ },
    { env: { MEMPOOL_POOLS_JSON_URL: 'https://raw.githubusercontent.com/mempool/mining-pools/master/pools-v2.json' }, message: /MEMPOOL_POOLS_JSON_URL .*host: raw\.githubusercontent\.com/ },
    { env: { MEMPOOL_SERVICES_API: 'ftp://explorer.bitcoinuniverse.io/services' }, message: /MEMPOOL_SERVICES_API must be empty, a \/path, or an http\(s\) URL/ },
    { env: { MEMPOOL_SERVICES_API: 'explorer.bitcoinuniverse.io/services' }, message: /MEMPOOL_SERVICES_API must be empty/ },
    { env: { MEMPOOL_SERVICES_API: 'https://explorer.bitcoinuniverse.io/api"; rm -rf /' }, message: /MEMPOOL_SERVICES_API/ },
    { env: { MEMPOOL_SERVICES_API: 'https://svc:s3cretpass@explorer.bitcoinuniverse.io/api/v1/services' }, message: /MEMPOOL_SERVICES_API must not carry credentials/, secret: 's3cretpass' },
    { env: { EXTERNAL_DATA_SERVER_MEMPOOL_API: 'https://token-abc123@mempool.space/api/v1' }, message: /must not carry credentials/, secret: 'token-abc123' },
  ];
  for (const { env, message, secret } of cases) {
    const { status, stdout, stderr, rendered } = renderBackend(env);
    assert.equal(status, 78, `${JSON.stringify(env)} ${stdout}${stderr}`);
    assert.match(stderr, message, JSON.stringify(env));
    assert.match(stderr, /refusing to start/);
    // Configuration is not rendered on refusal: the template is untouched.
    assert.match(rendered, /__MEMPOOL_SERVICES_API__/);
    if (secret) {
      assert.doesNotMatch(stdout + stderr, new RegExp(secret));
    }
  }
});

test('frontend: a minimal environment renders no services endpoint and no third-party link', () => {
  const { status, stderr, rendered } = renderFrontend();
  assert.equal(status, 0, stderr);
  assert.deepEqual(scanText(rendered, { file: 'config.js', context: 'rendered-config' }), []);
  assert.match(rendered, /window\.__env\.SERVICES_API = '';/);
  assert.match(rendered, /window\.__env\.ONION_SERVICES_API = '';/);
  assert.match(rendered, /window\.__env\.MEMPOOL_WEBSITE_URL = 'https:\/\/explorer\.bitcoinuniverse\.io';/);
  assert.doesNotMatch(rendered, /mempool\.space|mempoolhqx4|\$\{__/);
});

test('frontend: owned endpoints are preserved exactly and onion transport is explicit configuration', () => {
  const owned = {
    SERVICES_API: 'https://services.bitcoinuniverse.io/api/v1/services',
    ONION_SERVICES_API: 'http://universe3xample2onion4address5for6tests7only8abcdefg.onion/api/v1/services',
  };
  const { status, stderr, rendered } = renderFrontend(owned);
  assert.equal(status, 0, stderr);
  assert.match(rendered, new RegExp(`SERVICES_API = '${owned.SERVICES_API}';`));
  assert.match(rendered, new RegExp(`ONION_SERVICES_API = '${owned.ONION_SERVICES_API}';`));
  assert.deepEqual(scanText(rendered, { file: 'config.js', context: 'rendered-config' }), []);
});

test('frontend: disallowed, malformed and credential-bearing endpoints stop the container without echoing secrets', () => {
  const cases = [
    { env: { SERVICES_API: 'https://mempool.space/api/v1/services' }, message: /SERVICES_API .*host: mempool\.space/ },
    { env: { SERVICES_API: 'https://Api.Mempool.Space/api/v1/services' }, message: /host: api\.mempool\.space/ },
    { env: { SERVICES_API: 'http://universe3xample2onion4address5for6tests7only8abcdefg.onion/api/v1/services' }, message: /SERVICES_API .*\.onion/ },
    { env: { ONION_SERVICES_API: 'http://mempoolhqx4isw62xs7abwphsq7ldayuidyx2v2oethdhhj6mlo2r6ad.onion/api/v1/services' }, message: /ONION_SERVICES_API .*mempoolhqx4/ },
    { env: { ONION_SERVICES_API: 'https://services.example.net/api' }, message: /ONION_SERVICES_API .*host: services\.example\.net/ },
    { env: { SERVICES_API: 'wss://services.bitcoinuniverse.io/api' }, message: /SERVICES_API must be empty, a \/path, or an http\(s\) URL/ },
    { env: { SERVICES_API: 'https://svc:s3cretpass@services.bitcoinuniverse.io/api/v1/services' }, message: /must not carry credentials/, secret: 's3cretpass' },
    { env: { PROXIED_SERVICES: 'true' }, message: /PROXIED_SERVICES=true needs PROXIED_SERVICES_HOST/ },
    { env: { PROXIED_SERVICES: 'true', PROXIED_SERVICES_HOST: 'https://mempool.space' }, message: /PROXIED_SERVICES_HOST .*host: mempool\.space/ },
  ];
  for (const { env, message, secret } of cases) {
    const { status, stdout, stderr, rendered } = renderFrontend(env);
    assert.equal(status, 78, `${JSON.stringify(env)} ${stdout}${stderr}`);
    assert.match(stderr, message, JSON.stringify(env));
    assert.equal(rendered, '', 'config.js is not rendered on refusal');
    if (secret) assert.doesNotMatch(stdout + stderr, new RegExp(secret));
  }
});
