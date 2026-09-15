import { Psbt, networks, payments } from 'bitcoinjs-lib';
import * as crypto from 'crypto';
import { payjoinService, PayjoinUnavailableError } from './payjoin.service';

/**
 * PSBTs are built with bitcoinjs-lib so the analysis has real inputs and
 * outputs to compare. Directory probes are stubbed; nothing leaves the host.
 */
const script = (seed: string) => payments.p2wpkh({ hash: crypto.createHash('sha256').update(seed).digest().subarray(0, 20), network: networks.regtest }).output!;
function psbt(inputs: { txid: string; vout: number; value: number }[], outputs: { seed: string; value: number }[]): string {
  const p = new Psbt({ network: networks.regtest });
  for (const input of inputs) { p.addInput({ hash: input.txid, index: input.vout, witnessUtxo: { script: script('in' + input.txid), value: input.value } }); }
  for (const output of outputs) { p.addOutput({ script: script(output.seed), value: output.value }); }
  return p.toBase64();
}
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

describe('payjoin proposal analysis reads the transactions', () => {
  it('counts receiver inputs, contributed sats, fee delta and the broken heuristic', () => {
    const original = psbt([{ txid: A, vout: 0, value: 100_000 }], [{ seed: 'pay', value: 60_000 }, { seed: 'change', value: 39_000 }]);
    const proposal = psbt([{ txid: A, vout: 0, value: 100_000 }, { txid: B, vout: 1, value: 25_000 }], [{ seed: 'pay', value: 85_000 }, { seed: 'change', value: 38_800 }]);
    const result = payjoinService.analyzeProposal({ original_psbt: original, proposal_psbt: proposal });
    expect(result).toMatchObject({ inputs_added_by_receiver: 1, receiver_contributed_sats: 25_000, original_fee_sats: 1000, proposal_fee_sats: 1200, fee_delta_sats: 200, is_valid: true, privacy_score_gain: 2 });
    expect(result.heuristics_broken).toEqual(['Common-Input-Ownership Heuristic (CIOH)', 'Payment-Amount Heuristic']);
    expect(result.original).toEqual({ inputs: 1, outputs: 2 });
    expect(result.proposal).toEqual({ inputs: 2, outputs: 2 });
  });

  it('a proposal that drops the sender input or adds nothing is not a valid payjoin', () => {
    const original = psbt([{ txid: A, vout: 0, value: 100_000 }], [{ seed: 'pay', value: 60_000 }]);
    const dropped = psbt([{ txid: B, vout: 0, value: 100_000 }], [{ seed: 'pay', value: 60_000 }]);
    const result = payjoinService.analyzeProposal({ original_psbt: original, proposal_psbt: dropped });
    expect(result.is_valid).toBe(false);
    expect(result.validation_messages.join(' ')).toMatch(/dropped 1 of the sender's original inputs/);
    const same = payjoinService.analyzeProposal({ original_psbt: original, proposal_psbt: original });
    expect(same).toMatchObject({ inputs_added_by_receiver: 0, is_valid: false, heuristics_broken: [] });
  });

  it('rejects missing or malformed PSBTs instead of scoring their lengths', () => {
    expect(() => payjoinService.analyzeProposal({ original_psbt: '', proposal_psbt: 'x' })).toThrow(/required/);
    expect(() => payjoinService.analyzeProposal({ original_psbt: 'not a psbt', proposal_psbt: 'still not' })).toThrow(/not a valid PSBT/);
  });
});

describe('payjoin directories and overview', () => {
  beforeEach(() => { payjoinService.resetForTests(); payjoinService.configuredDirectories = () => []; });

  it('is unavailable until a directory is configured', async () => {
    await expect(payjoinService.getDirectories()).rejects.toThrow(PayjoinUnavailableError);
    await expect(payjoinService.getOverview()).rejects.toThrow(/UNIVERSE_PAYJOIN_DIRECTORIES/);
  });

  it('probes configured directories and reports what came back', async () => {
    payjoinService.configuredDirectories = () => ['https://directory.example.org', 'https://down.example.org', 'http://insecure.example.org'];
    payjoinService.prober = async url => url.hostname.startsWith('directory')
      ? { ok: true, status: 200, body: Buffer.from('keys'), latency_ms: 42, error: null }
      : { ok: false, status: null, body: null, latency_ms: null, error: 'ECONNREFUSED' };
    // Resolution is pinned to a public address for the test.
    const identity = await import('../identity/developer-identity');
    jest.spyOn(identity, 'resolvePublicAddress').mockResolvedValue({ address: '203.0.113.5', family: 4 });
    const directories = await payjoinService.getDirectories();
    expect(directories).toHaveLength(3);
    expect(directories[0]).toMatchObject({ bip77_supported: true, latency_ms: 42, error: null, ohttp_key_hash: crypto.createHash('sha256').update('keys').digest('hex') });
    expect(directories[1]).toMatchObject({ bip77_supported: false, latency_ms: null, error: 'ECONNREFUSED', ohttp_key_hash: null });
    expect(directories[2]).toMatchObject({ bip77_supported: false, error: expect.stringMatching(/https/) });
    const overview = await payjoinService.getOverview();
    expect(overview).toMatchObject({ active_directories_count: 1, configured_directories_count: 3, total_payjoins_detected_24h: null });
  });

  it('the playground is a labelled walkthrough with no transaction ids', () => {
    const session = payjoinService.createPlaygroundSession(50_000);
    expect(session).toMatchObject({ simulated: true, step: 'original_created', original_txid: null, payjoin_txid: null, amount_sats: 50_000 });
    const advanced = payjoinService.advancePlaygroundSession(session.session_id);
    expect(advanced.step).toBe('proposal_generated');
    expect(payjoinService.advancePlaygroundSession(session.session_id)).toMatchObject({ step: 'signed_and_broadcast', payjoin_txid: null });
    expect(() => payjoinService.createPlaygroundSession(-1)).toThrow();
    expect(() => payjoinService.advancePlaygroundSession('missing')).toThrow(/not found/);
  });
});
