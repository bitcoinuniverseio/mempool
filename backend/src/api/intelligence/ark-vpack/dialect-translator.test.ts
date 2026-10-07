import { translateVpackDialect } from './dialect-translator';
import { reconstructVpack } from './vpack-reconstruction';
jest.mock('./vpack-reconstruction', () => ({ reconstructVpack: jest.fn() }));
jest.mock('../workbench/workbench-core', () => ({ ownedWorkbenchCore: {} }));
const evidence = { bark_hex: 'abcd', anchor_outpoint: '11'.repeat(32) + ':0', vtxo_id: '22'.repeat(32) + ':1', amount_sats: 1000,
  script_pub_key: '5120' + '33'.repeat(32), sequence: 0, exit_delta: 144, expiry: 100000, asp_pubkey: '02' + '44'.repeat(32), user_pubkey: '03' + '55'.repeat(32), anchor: {} };
describe('Loss-rejecting native proof envelopes', () => {
  beforeEach(() => (reconstructVpack as jest.Mock).mockResolvedValue(evidence));
  it('round-trips every native byte and ignores harmless JSON key ordering', async () => {
    const forward = await translateVpackDialect({ source_dialect: 'bark', target_dialect: 'mvv', network: 'signet', package: { bark_hex: 'abcd' } });
    const pkg = forward.package as any; pkg.minimal_viable_vtxo.anchor_outpoint = { vout: 0, txid: '11'.repeat(32) };
    const reverse = await translateVpackDialect({ source_dialect: 'mvv', target_dialect: 'bark', network: 'signet', package: pkg });
    expect(reverse.package).toEqual({ bark_hex: 'abcd' });
  });
  it('rejects extensions that cannot survive in native output', async () => {
    await expect(translateVpackDialect({ source_dialect: 'mvv', target_dialect: 'bark', network: 'signet', package: { native_package: { bark_hex: 'abcd' }, unknown_policy: true } })).rejects.toMatchObject({ code: 'unsupported-extension' });
  });
  it.each([['arkade', 'bark'], ['bark', 'arkade']])('refuses unestablished %s to %s compatibility', async (source, target) => {
    await expect(translateVpackDialect({ source_dialect: source, target_dialect: target, package: {} })).rejects.toMatchObject({ code: 'incompatible-dialect-proof' });
  });
  it('round-trips versioned native seconds policy without converting it to blocks', async () => {
    (reconstructVpack as jest.Mock).mockResolvedValue({ ...evidence, expiry: null, exit_delta: null, exit_locktime: { version: 2, unit: 'seconds', value: 86016 } });
    const native = { arkade: { preserved: 'original native PSBT and seconds policy' } };
    const forward = await translateVpackDialect({ source_dialect: 'arkade', target_dialect: 'mvv', network: 'signet', package: native });
    expect((forward.package as any).minimal_viable_vtxo).toMatchObject({ version: 2, exit_delay_blocks: null, exit_delay_seconds: 86016 });
    expect((forward.package as any).minimal_viable_vtxo).toMatchObject({ expires_at_height: null, expires_at_timestamp: null });
    expect(forward.summary_complete).toBe(false);
    const reverse = await translateVpackDialect({ source_dialect: 'mvv', target_dialect: 'arkade', network: 'signet', package: forward.package });
    expect(reverse.package).toEqual(native);
    const changed = JSON.parse(JSON.stringify(forward.package)); changed.minimal_viable_vtxo.exit_delay_blocks = 168;
    await expect(translateVpackDialect({ source_dialect: 'mvv', target_dialect: 'arkade', network: 'signet', package: changed })).rejects.toMatchObject({ code: 'metadata-mismatch' });
  });
  it('rejects an untyped native expiry rather than treating it as a block height', async () => {
    (reconstructVpack as jest.Mock).mockResolvedValue({ ...evidence, exit_delta: null, exit_locktime: { version: 2, unit: 'seconds', value: 86016 } });
    await expect(translateVpackDialect({ source_dialect: 'arkade', target_dialect: 'mvv', network: 'signet', package: { arkade: {} } })).rejects.toMatchObject({ code: 'unsupported-expiry-unit' });
  });
  it.each([{ version: 2, unit: 'blocks', value: 86016 }, { version: 2, unit: 'seconds', value: 86017 }, { version: 3, unit: 'seconds', value: 86016 }])('rejects unsupported native locktime without summary loss', async locktime => {
    (reconstructVpack as jest.Mock).mockResolvedValue({ ...evidence, exit_delta: null, exit_locktime: locktime });
    await expect(translateVpackDialect({ source_dialect: 'arkade', target_dialect: 'mvv', network: 'signet', package: { arkade: {} } })).rejects.toMatchObject({ code: 'invalid-locktime' });
  });
});
