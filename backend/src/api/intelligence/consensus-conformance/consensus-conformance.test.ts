import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { gunzipSync, gzipSync } from 'zlib';
import { ConsensusConformanceService } from './consensus-conformance.service';
import { ConformanceStore } from './conformance-evidence';
import { parserCorpus } from './conformance-corpus';
import { childJson } from './conformance-runner';
import { NODE_ENGINE_CODE } from './conformance-node-code';

describe('bounded measured conformance evidence', () => {
  it('does not manufacture evaluated engines, cases or machine proofs without configuration', () => {
    const s = new ConsensusConformanceService('');
    expect(s.getOverview()).toMatchObject({
      total_implementations_evaluated: 0,
      total_differential_cases: 0,
      machine_proved_formal_theorems_count: 0,
    });
    expect(s.listFormalArtifacts().formal_artifacts).toEqual([]);
    expect(s.listTargets().targets.map((t) => t.target_id)).toEqual([
      'transaction_parse',
      'block_parse',
      'script_verify',
      'compact_size',
    ]);
  });
  it('rejects unknown, nonfinite, fractional and negative campaign parameters', async () => {
    const s = new ConsensusConformanceService('');
    for (const [target, seed] of [
      ['bad', 42],
      ['transaction_parse', NaN],
      ['transaction_parse', -1],
      ['compact_size', 0.5],
    ] as [string, number][])
      await expect(s.startCampaign(target, seed)).rejects.toMatchObject({ status: 400 });
    await expect(s.startCampaign('compact_size', 0)).rejects.toMatchObject({ code: 'unavailable-runner' });
    expect(s.listCampaigns().campaigns).toEqual([]);
  });
  it('binds deterministic mutations to the seed without changing the negative baseline', () => {
    const a = parserCorpus('transaction_parse', 42),
      b = parserCorpus('transaction_parse', 43);
    expect(a).toEqual(parserCorpus('transaction_parse', 42));
    expect(a.slice(0, 5)).toEqual(b.slice(0, 5));
    expect(a.slice(5)).not.toEqual(b.slice(5));
    expect(a.every((i) => i.hex.length <= 8192)).toBe(true);
  });
  it('executes the actual JavaScript parser and independently rejects truncation and trailing bytes', async () => {
    const inputs = parserCorpus('transaction_parse', 42);
    const { data } = await childJson(
      process.execPath,
      ['-e', NODE_ENGINE_CODE, require.resolve('bitcoinjs-lib'), require.resolve('varuint-bitcoin')],
      { target: 'transaction_parse', inputs }
    );
    expect(data.results.find((r) => r.id === 'legacy-roundtrip').outcome.status).toBe('accepted');
    expect(data.results.find((r) => r.id === 'truncated').outcome.status).toBe('rejected');
    expect(data.results.find((r) => r.id === 'trailing-byte').outcome.status).toBe('rejected');
    expect(data.results.every((r) => r.execution_time_ms >= 0)).toBe(true);
  });
  it('retains actual nonminimal CompactSize library behavior instead of manufacturing agreement', async () => {
    const { data } = await childJson(
      process.execPath,
      ['-e', NODE_ENGINE_CODE, require.resolve('bitcoinjs-lib'), require.resolve('varuint-bitcoin')],
      { target: 'compact_size', inputs: parserCorpus('compact_size', 0) }
    );
    expect(data.results.find((r) => r.id === 'nonminimal-one').outcome).toMatchObject({
      status: 'accepted',
      value: '1',
    });
    expect(data.results.find((r) => r.id === 'truncated-u64').outcome.status).toBe('rejected');
  });
  it('durably authenticates every report across restart and rejects a different key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'conformance-test-')),
      path = join(dir, 'state.gz'),
      key = join(dir, 'key'),
      wrong = join(dir, 'wrong');
    writeFileSync(key, randomBytes(32));
    writeFileSync(wrong, randomBytes(32));
    const a = new ConformanceStore(path, key);
    await a.write({ schema: 'test', cases: [{ input: '00', outcome: 'rejected' }] });
    a.close();
    const b = new ConformanceStore(path, key);
    expect(b.read()).toEqual({ schema: 'test', cases: [{ input: '00', outcome: 'rejected' }] });
    b.close();
    const c = new ConformanceStore(path, wrong);
    expect(() => c.read()).toThrow(/authentication/);
    c.close();
  });
  it('rejects corrupted persisted bytes rather than returning a partial report', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'conformance-test-')),
      path = join(dir, 'state.gz'),
      key = join(dir, 'key');
    writeFileSync(key, randomBytes(32));
    const a = new ConformanceStore(path, key);
    await a.write({ cases: [] });
    a.close();
    const bytes = readFileSync(path);
    bytes[Math.floor(bytes.length / 2)] ^= 1;
    writeFileSync(path, bytes);
    const b = new ConformanceStore(path, key);
    expect(() => b.read()).toThrow();
    b.close();
  });
  it('prevents two writers from replacing one another even before their first write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'conformance-test-')),
      path = join(dir, 'state.gz'),
      key = join(dir, 'key');
    writeFileSync(key, randomBytes(32));
    const a = new ConformanceStore(path, key);
    a.read();
    const b = new ConformanceStore(path, key);
    expect(() => b.read()).toThrow();
    b.close();
    a.close();
  });
});

describe('restart and authenticated report validation', () => {
  const fixture = () => {
    const directory = mkdtempSync(join(tmpdir(), 'conformance-restart-')),
      key = join(directory, 'key'),
      manifest = join(directory, 'manifest.json');
    writeFileSync(key, randomBytes(32));
    const pin = { path: process.execPath, sha256: '0'.repeat(64) };
    writeFileSync(
      manifest,
      JSON.stringify({
        schema: 'conformance-engines-v1',
        artifact_directory: directory,
        authentication_key_file: key,
        core: pin,
        rust: pin,
        btcd: pin,
        node: pin,
        bitcoinjs_transaction_sha256: '0'.repeat(64),
        bitcoinjs_block_sha256: '0'.repeat(64),
        varuint_sha256: '0'.repeat(64),
        javascript_tree_sha256: '0'.repeat(64),
        execution_token_sha256: '0'.repeat(64),
      })
    );
    return { directory, key, manifest, path: join(directory, 'campaigns.json.gz') };
  };
  it('marks an authenticated unfinished campaign interrupted across restart', async () => {
    const f = fixture(),
      store = new ConformanceStore(f.path, f.key);
    await store.write({
      schema: 'conformance-state-v1',
      campaigns: [
        { campaign_id: '00000000-0000-4000-8000-000000000001', target_id: 'compact_size', seed: 0, status: 'running' },
      ],
      cases: [],
      replays: [],
    });
    store.close();
    const s = new ConsensusConformanceService(f.manifest);
    expect(s.listCampaigns().campaigns[0]).toMatchObject({ status: 'interrupted' });
    expect(s.getOverview().total_differential_cases).toBe(0);
    s.close();
  });
  it('rejects a forged result even if an attacker recomputes the outer storage checksum', async () => {
    const f = fixture(),
      store = new ConformanceStore(f.path, f.key);
    await store.write({ schema: 'conformance-state-v1', campaigns: [], cases: [], replays: [] });
    store.close();
    const outer = JSON.parse(gunzipSync(readFileSync(f.path)).toString());
    const signed = JSON.parse(outer.body);
    signed.body = signed.body.replace('cases":[]', 'cases":[{"forged":true}]');
    outer.body = JSON.stringify(signed);
    outer.sha256 = require('crypto').createHash('sha256').update(outer.body).digest('hex');
    writeFileSync(f.path, gzipSync(JSON.stringify(outer)));
    const s = new ConsensusConformanceService(f.manifest);
    await expect(s.startCampaign('compact_size', 0)).rejects.toMatchObject({ code: 'campaign-state-unavailable' });
    expect(s.listCases().cases).toEqual([]);
    s.close();
  });
  it('rejects authenticated records whose case input digest is inconsistent', async () => {
    const f = fixture(),
      store = new ConformanceStore(f.path, f.key);
    await store.write({
      schema: 'conformance-state-v1',
      campaigns: [],
      cases: [{ case_id: 'bad', input: { hex: '00' }, input_sha256: '0'.repeat(64) }],
      replays: [],
    });
    store.close();
    const s = new ConsensusConformanceService(f.manifest);
    await expect(s.startCampaign('compact_size', 0)).rejects.toMatchObject({ code: 'campaign-state-unavailable' });
    s.close();
  });
});
