import { Psbt, Transaction } from 'bitcoinjs-lib';
import { ArkNativeProofDependencies, ArkNativeProofInput, finalizeNativeKeyPath, verifyArkNativeProof } from './ark-native-proof';
jest.mock('../intelligence/workbench/workbench-core', () => ({ ownedWorkbenchCore: {} }));
jest.mock('../intelligence/workbench/transaction-script-verifier', () => ({ verifyTransactionScripts: async (): Promise<null> => null }));

// Public, genuinely confirmed custom-Signet native v0.9.16 records, acquired 2026-10-04.
// These fixture checks are components, not another operated transaction or exit.
const batch = '8e224a0bf49792951f47a028bc22fa3e1e3620742a400a5f2488a7d0ea76c2c4';
const leaf = '8b02aac1e8a438246ddd8a3efaf7e5450598fa5cd31c081f905b765c6b621538';
const block = '0000009898d6eb3cbe8305297653c85259dad656a8ecbf6e7e3d3d3e12e6ccc4';
const batchScript = '5120f9f3c00409568cbae73c695f03450f165f6db3521c1ce219ff18848600f52612';
const leafScript = '5120a1a6d7b68df33f69c29051e1814c1f96a7367bc4ce344608b579f2828c29e226';
const original = 'cHNidP8BAGsDAAAAAcTCdurQp4gkXwpAKnQgNh4++iK8KKBHH5WSl/QLSiKOAAAAAAD/////AhAnAAAAAAAAIlEgoabXto3zP2nCkFHhgUwflqc2e8TONEYItXnygowp4iYAAAAAAAAAAARRAk5zAAAAAAABE0CMzh6kphvjjioBe/iLrovtYQl2e1ggL7sh4keKnmf/oiX+QHWnr2otAUK80sQE7kTQ3njPPvWjpPnpvH08HRT/Dd5jb3NpZ25lcgAAAAAhAkQENU1Ub5oCeO9WoKBUPQfbddZiOo9y2lcbmKlCVE4jDd5jb3NpZ25lcgAAAAEhAtItw9wKvpRGvpT5KU9n6wWd6jcnnNCbRCABTj6ctb8EB95leHBpcnkDnQRAAAAA';
function node(tx = original): ArkNativeProofInput['arkade']['nodes'][number] { return { txid: leaf, tx, children: {} }; }
function unsigned(tx = original): string { return Transaction.fromBuffer(Psbt.fromBase64(tx).data.globalMap.unsignedTx.toBuffer()).toHex(); }
const anchor = { anchor_outpoint: batch + ':0', amount_sats: 10000, script_pub_key: batchScript };
function request(): ArkNativeProofInput {
  return { schema: 'universe-ark-native-proof-v1', network: 'signet', providerId: 'universe-owned-custom-signet-ark-v3', batchOutpoint: batch + ':0', vtxoOutpoint: leaf + ':0',
    arkade: { nodes: [node()], leaf_outpoint: leaf + ':0', default_vtxo: { version: 2, pubkey: '4be2a30ad136463c1ee3f0550ebaab9446c27659168d5b8a146668adf8a35576',
      server_pubkey: '63d03d54b486ffb4a8a66009ebe0beeaab91bb749e7336e895bf26f3821faaab', exit_delay_seconds: 86016 } } };
}
interface ComponentDependencies extends ArkNativeProofDependencies {
  vtxo: { outpoint: { txid: string; vout: number }; amount: string; script: string; expiresAt: string; commitmentTxids: string[];
    isPreconfirmed: boolean; isSpent: boolean; isSwept: boolean; isUnrolled: boolean };
}
function dependencies(): ComponentDependencies {
  const vtxo = { outpoint: { txid: leaf, vout: 0 }, amount: '10000', script: leafScript, expiresAt: '1791738722', commitmentTxids: [batch],
    isPreconfirmed: false, isSpent: false, isSwept: false, isUnrolled: false };
  const observation = { schema: 'universe-ark-native-observation-v1', profile: {}, profileSha256: '0b73d45a4774af0484fe1b4359331a558ee04977bdd684953cb8d245d8158672',
    anchor: { height: 3187, hash: block }, observedAt: '2026-10-04T17:22:00Z', info: { providerDigest: '2e640d99227ae93ff39f5f7d6a26d98980be41b5cf19c0949da1e96c0850032b',
      signerPubkey: '0263d03d54b486ffb4a8a66009ebe0beeaab91bb749e7336e895bf26f3821faaab', unilateralExitDelay: { unit: 'seconds', value: '86016' } } };
  const source = { profile: { network: 'signet', providerId: request().providerId }, observe: jest.fn(async (path: string) => {
    const payload = path === '/v1/info' ? {} : path.includes('/vtxos?') ? { vtxos: [vtxo], page: { current: 1, next: 1, total: 1 } }
      : path.includes('/commitmentTx/') ? { batches: { 0: { swept: false, expiresAt: vtxo.expiresAt } } }
      : path.includes('/tree?') ? { vtxoTree: [{ txid: leaf, children: {} }], page: { current: 1, next: 1, total: 1 } }
      : { txs: [original] };
    return { observation, payload };
  }) };
  const core = { network: 'signet', call: jest.fn(async (method: string) => {
    if (method === 'getblockchaininfo') {return { chain: 'signet', blocks: 3187, bestblockhash: block };}
    if (method === 'getrawtransaction') {return { txid: batch, confirmations: 1, vout: [{ n: 0, value: 0.0001, scriptPubKey: { hex: batchScript } }] };}
    if (method === 'gettxout') {return { value: 0.0001, bestblock: block, confirmations: 1, scriptPubKey: { hex: batchScript } };}
    throw Error('Unexpected component RPC');
  }) };
  return { source: source as unknown as ArkNativeProofDependencies['source'], core, vtxo };
}

describe('actual native signed PSBT public previous-output enrichment', () => {
  it('preserves native ID and original PSBT bytes while verifying its actual Schnorr signature', () => {
    const before = Psbt.fromBase64(original);
    expect(before.data.inputs[0].witnessUtxo).toBeUndefined();
    const result = finalizeNativeKeyPath([node()], [unsigned()], anchor);
    expect(result.checks).toEqual([{ txid: leaf, input_outpoint: batch + ':0', fee_sats: 0, signature_valid: true }]);
    expect(Transaction.fromHex(result.hexes[0]).getId()).toBe(leaf);
    expect(result.digests).toHaveLength(1);
    expect(Psbt.fromBase64(original).data.inputs[0].witnessUtxo).toBeUndefined();
  });
  it.each([{ ...anchor, amount_sats: 10001 }, { ...anchor, script_pub_key: leafScript }])('rejects cryptographic validity for another public value or script', wrong => {
    expect(finalizeNativeKeyPath([node()], [unsigned()], wrong).checks[0].signature_valid).toBe(false);
  });
  it('rejects a foreign previous outpoint before finalizing', () => {
    expect(() => finalizeNativeKeyPath([node()], [unsigned()], { ...anchor, anchor_outpoint: batch + ':1' })).toThrow('foreign previous output');
  });
  it('rejects conflicting pre-existing witness metadata', () => {
    const psbt = Psbt.fromBase64(original); psbt.updateInput(0, { witnessUtxo: { value: 10001, script: Buffer.from(batchScript, 'hex') } });
    expect(() => finalizeNativeKeyPath([node(psbt.toBase64())], [unsigned()], anchor)).toThrow('metadata disagrees');
  });
  it('reports a mutated genuine signature as false', () => {
    const psbt = Psbt.fromBase64(original); const signature = psbt.data.inputs[0].tapKeySig;
    if (!signature) { throw Error('Missing genuine fixture signature'); }
    signature[0] ^= 1;
    expect(finalizeNativeKeyPath([node(psbt.toBase64())], [unsigned()], anchor).checks[0].signature_valid).toBe(false);
  });
});

describe('versioned native proof scope and independently anchored source fences', () => {
  it('reuses the actual pinned Arkade codec and VPACK anchor/path verifier for the genuine fixture', async () => {
    const deps = dependencies();
    const result = await verifyArkNativeProof(request(), deps);
    expect(result).toMatchObject({ valid: true, stage: 'verified-native-proof', exitViable: null, protocolVerified: null,
      evidence: { amountAtomic: '10000', expiryUnixSeconds: '1791738722', transactionChecks: [{ signature_valid: true }] } });
  });
  it.each([[], ['00'.repeat(32)], { ...request(), network: 'mainnet' }, { ...request(), providerId: 'foreign' }])('rejects legacy or foreign-context input before source IO', async input => {
    const deps = dependencies();
    expect(await verifyArkNativeProof(input, deps)).toMatchObject({ valid: false, stage: 'invalid-native-proof' });
    expect(deps.source.observe).not.toHaveBeenCalled(); expect(deps.core.call).not.toHaveBeenCalled();
  });
  it.each(['isSpent', 'isSwept', 'isUnrolled', 'isPreconfirmed'] as const)('rejects current native lifecycle %s', async field => {
    const deps = dependencies(); deps.vtxo[field] = true;
    expect(await verifyArkNativeProof(request(), deps)).toMatchObject({ valid: false, exitViable: null });
    expect(deps.core.call).not.toHaveBeenCalled();
  });
  it('keeps expiry timestamps separate from relative seconds and refuses expired observations', async () => {
    const deps = dependencies(); deps.vtxo.expiresAt = '1';
    expect(await verifyArkNativeProof(request(), deps)).toMatchObject({ valid: false });
  });
  it('refuses incomplete native pagination rather than accepting a partial proof tree', async () => {
    const deps = dependencies(); const observe = deps.source.observe;
    deps.source.observe = jest.fn(async (path: string) => { const result = await observe(path); if (path.includes('/tree?')) {result.payload.page.total = 3;} return result; });
    expect(await verifyArkNativeProof(request(), deps)).toMatchObject({ valid: null, stage: 'unavailable-native-verifier' });
  });
  it('refuses a later changed canonical identity without attempting the codec/Core reads', async () => {
    const deps = dependencies(); const observe = deps.source.observe; let count = 0;
    deps.source.observe = jest.fn(async (path: string) => { const result = await observe(path); if (++count === 2) {return { ...result, observation: { ...result.observation, anchor: { height: 3188, hash: '11'.repeat(32) } } };} return result; });
    expect(await verifyArkNativeProof(request(), deps)).toMatchObject({ valid: null }); expect(deps.core.call).not.toHaveBeenCalled();
  });
  it('does not accept an input native policy with invented height units', async () => {
    const deps = dependencies(); const input = request(); input.arkade.default_vtxo = { ...input.arkade.default_vtxo, exit_delay_seconds: 168 };
    expect(await verifyArkNativeProof(input, deps)).toMatchObject({ valid: false }); expect(deps.core.call).not.toHaveBeenCalled();
  });
  it('does not continue source or Core reads after a bounded timeout and late provider response', async () => {
    jest.useFakeTimers();
    try {
      const deps = dependencies();
      let release: (() => void) | undefined;
      const originalRead = deps.source.observe;
      deps.source.observe = jest.fn(async (path: string) => {
        await new Promise<void>(accept => { release = accept; });
        return originalRead(path);
      });
      const promise = verifyArkNativeProof(request(), deps);
      await jest.advanceTimersByTimeAsync(28000);
      expect(await promise).toMatchObject({ valid: null, stage: 'unavailable-native-verifier' });
      if (!release) { throw Error('The bounded initial request was not started'); }
      release(); await Promise.resolve(); await Promise.resolve();
      expect(deps.source.observe).toHaveBeenCalledTimes(1);
      expect(deps.core.call).not.toHaveBeenCalled();
    } finally { jest.useRealTimers(); }
  });
  it('refuses a foreign independently observed anchor checkpoint', async () => {
    const deps = dependencies();
    deps.core.call = jest.fn(async (method: string) => {
      if (method === 'getblockchaininfo') { return { chain: 'signet', blocks: 3188, bestblockhash: '22'.repeat(32) }; }
      if (method === 'getrawtransaction') { return { txid: batch, confirmations: 1, vout: [{ n: 0, value: 0.0001, scriptPubKey: { hex: batchScript } }] }; }
      return { value: 0.0001, bestblock: '22'.repeat(32), confirmations: 1, scriptPubKey: { hex: batchScript } };
    });
    expect(await verifyArkNativeProof(request(), deps)).toMatchObject({ valid: false, stage: 'invalid-native-proof' });
  });
});
