const assert = require('node:assert/strict');
const test = require('node:test');
const { createHash } = require('node:crypto');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, dirname, basename } = require('node:path');
const { URL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { bindRuntimeConfigScript } = require('../runtime-config-script.cjs');

const html = '<head>\n<!-- CONFIG -->\n<script src="/resources/config.js"></script>\n<!-- END CONFIG -->\n<script src="/resources/customize.js"></script>\n</head>';
test('binds exact bytes and changes only the config URL within preserved markers', () => {
  const bytes = Buffer.from('window.__env={GIT_COMMIT_HASH:"actual"};\n');
  const result = bindRuntimeConfigScript(html, bytes);
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(new URL(result.url, 'https://owned.invalid').pathname, '/resources/config.js');
  assert.equal(result.html.replace(result.url, '/resources/config.js'), html);
  assert.equal(bindRuntimeConfigScript(result.html, bytes).html, result.html);
  assert.notEqual(bindRuntimeConfigScript(html, Buffer.concat([bytes, Buffer.from('\n')])).url, result.url);
});
test('replaces an old epoch instead of appending queries, supports legacy templates, and rejects incomplete or ambiguous config markers', () => {
  const bytes = Buffer.from('config');
  const result = bindRuntimeConfigScript(html.replace('/resources/config.js', '/resources/config.js?old=epoch'), bytes);
  assert.equal(result.html.includes('old=epoch'), false);
  assert.equal((result.html.match(/\?v=/g) || []).length, 1);
  assert.throws(() => bindRuntimeConfigScript('<!-- CONFIG --><script src="/resources/config.js"></script>', bytes));
  assert.ok(bindRuntimeConfigScript('<script src="/resources/config.js"></script>', bytes).html.includes('/resources/config.js?v='));
  assert.throws(() => bindRuntimeConfigScript(html.replace('</script>', '</script><script src="/resources/config.js"></script>'), bytes));
});
test('real generator binds written config for default and configured builds while preserving runtime templates and mounts', () => {
  const root = resolve(__dirname, '..');
  const directory = mkdtempSync(join(tmpdir(), 'universe-runtime-config-'));
  try {
    mkdirSync(join(directory, 'src/resources'), { recursive: true });
    writeFileSync(join(directory, 'src/index.mempool.html'), html);
    writeFileSync(join(directory, 'src/index.liquid.html'), readFileSync(join(root, 'src/index.liquid.html')));
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ version: '3.3.1' }));
    const run = () => {
      const result = spawnSync(process.execPath, [join(root, 'generate-config.js')], {
        cwd: directory, env: { ...process.env, DOCKER_COMMIT_HASH: 'fixture-release' }, encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      const config = readFileSync(join(directory, 'src/resources/config.js'));
      const index = readFileSync(join(directory, 'src/index.html'), 'utf8');
      const sha = createHash('sha256').update(config).digest('hex');
      assert.ok(index.includes(`/resources/config.js?v=${sha}`));
      assert.ok(config.toString().includes("GIT_COMMIT_HASH = 'fixture-release'"));
      return { config, index };
    };
    const first = run();
    assert.equal(run().index, first.index);
    writeFileSync(join(directory, 'mempool-frontend-config.json'), JSON.stringify({ SIGNET_ENABLED: true, UNIVERSE_CHAIN_NETWORKS: { bitcoin: 'signet' } }));
    const configured = run();
    assert.notEqual(configured.index, first.index);
    assert.ok(configured.config.toString().includes('SIGNET_ENABLED = true'));
    const template = readFileSync(join(directory, 'src/resources/config.template.js'), 'utf8');
    assert.ok(template.includes('${__SIGNET_ENABLED__}'));
    writeFileSync(join(directory, 'mempool-frontend-config.json'), JSON.stringify({ BASE_MODULE: 'liquid', ROOT_NETWORK: 'liquid' }));
    const liquid = run();
    assert.ok(liquid.config.toString().includes("BASE_MODULE = 'liquid'"));
    // A runtime mount remains at config.js. No browser checksum gate is added.
    writeFileSync(join(directory, 'src/resources/config.js'), 'runtime-mounted-environment');
    assert.ok(configured.index.includes('/resources/config.js?v='));
    assert.equal(readFileSync(join(directory, 'src/resources/config.js'), 'utf8'), 'runtime-mounted-environment');
  } finally {
    assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('universe-runtime-config-'));
    rmSync(directory, { recursive: true, force: true });
  }
});
