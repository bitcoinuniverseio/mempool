import { generateKeyPairSync, sign as signEd25519 } from 'crypto';
import { Transaction } from 'bitcoinjs-lib';
import privateSubmissionService, { SubmissionEvidenceError } from './private-submission.service';
import { setPrivateRelayRuntime } from './private-relay.runtime';
import { ACCELERATOR_RECEIPT_SCHEMA, AcceleratorDirectory, deterministicJson, parseAcceleratorDirectory, receiptSigningMessage, useAcceleratorDirectory } from './accelerator-directory';
import { OrderingEvidenceService } from './ordering-evidence.service';
import { AcceleratorReceipt } from './private-submission.models';
import { DiagnosisReaders } from './transaction-diagnosis';
import config from '../../../config';
import { BlockExtended, MempoolTransactionExtended, TransactionExtended } from '../../../mempool.interfaces';
import { CandidateTemplate } from '../templates/template-collector.service';

const TX = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';
const PARENT = 'aa'.repeat(32);
const CHILD = 'bb'.repeat(32);
const UNSEEN = 'cc'.repeat(32);
const BLOCK = '00'.repeat(32);

/**
 * These assertions replace a suite that asserted the unavailable constants
 * the service used to throw. The relay and overview paths are still owned
 * elsewhere and keep their unavailable states; diagnosis, ordering and the
 * accelerator directory now read owned sources, faked here.
 */
describe('PrivateSubmissionService', () => {
  const unavailable = (code: string) => expect.objectContaining({ code });

  // The private relay itself (queueing, worker, abort, overview and capabilities)
  // is covered in private-relay.test.ts with fakes for the durable store and
  // the transport. Here: without a database the whole feature reports the
  // missing store rather than queueing a broadcast nothing sends.
  it('reports the missing durable store rather than queueing a broadcast nothing sends', async () => {
    setPrivateRelayRuntime({ network: 'signet', endpoints: { endpoints: [], issues: [], unconfigured: true }, store: null, worker: null, coreVersion: () => '?' });
    try {
      await expect(privateSubmissionService.submitPrivate({ raw_tx: '02'.repeat(80), method: 'privatebroadcast_tor' }))
        .rejects.toMatchObject({ code: 'durable-store-unavailable' });
      await expect(privateSubmissionService.getPrivateSubmission('tok-priv-1', 'ab'.repeat(32))).rejects.toMatchObject({ code: 'durable-store-unavailable' });
      await expect(privateSubmissionService.abortPrivateSubmission('tok-priv-1', 'ab'.repeat(32))).rejects.toMatchObject({ code: 'durable-store-unavailable' });
      await expect(privateSubmissionService.getOverview()).rejects.toMatchObject({ code: 'durable-store-unavailable' });
      await expect(privateSubmissionService.getCapabilities()).rejects.toMatchObject({ code: 'durable-store-unavailable' });
    } finally {
      setPrivateRelayRuntime(null);
    }
  });

  it('raises the typed error the routes map to a status', () => {
    try {
      privateSubmissionService.listAcceleratorProviders();
      throw new Error('expected the provider read to refuse without a directory');
    } catch (err) {
      expect(err).toBeInstanceOf(SubmissionEvidenceError);
      expect((err as SubmissionEvidenceError).status).toBe(503);
    }
  });
});

describe('transaction diagnosis from the owned mempool', () => {
  const entry = (overrides: Partial<MempoolTransactionExtended> = {}): MempoolTransactionExtended => ({
    txid: TX, fee: 1500, vsize: 250, weight: 1000, feePerVsize: 6, effectiveFeePerVsize: 9, adjustedFeePerVsize: 9, adjustedVsize: 250, sigops: 4, order: 1,
    vin: [{ sequence: 0xfffffffd, txid: PARENT, vout: 0, is_coinbase: false } as any], vout: [], version: 2, locktime: 0, size: 300, status: { confirmed: false },
    ancestors: [{ txid: PARENT, fee: 100, weight: 800 }], descendants: [], bestDescendant: null, cpfpChecked: true, position: { block: 2, vsize: 1_500_000 }, firstSeen: 1_700_000_000,
    ...overrides,
  } as unknown as MempoolTransactionExtended);
  const readers = (held: Record<string, MempoolTransactionExtended>, extra: Partial<DiagnosisReaders> = {}): DiagnosisReaders => ({
    mempoolEntry: txid => held[txid],
    mempoolInfo: () => ({ mempoolminfee: 0.00001, minrelaytxfee: 0.00001, loaded: true }),
    replaces: () => undefined,
    replacedBy: () => undefined,
    ...extra,
  });
  afterEach(() => { privateSubmissionService.diagnosisReaders = readers({}); });

  it('answers a held transaction with its own fee, package, policy and replacement facts', () => {
    privateSubmissionService.diagnosisReaders = readers({ [TX]: entry() }, { replaces: () => ['dd'.repeat(32)] });
    const diagnosis = privateSubmissionService.diagnoseTransaction(TX);
    expect(diagnosis).toMatchObject({
      txid: TX, vsize: 250, feerate_sats_vb: 6, is_mempool_present: true, is_policy_compliant: true, rbf_eligible: true, cpfp_eligible: true, has_conflicts: true, acceleration_recommended: true,
      package: { effective_feerate_sats_vb: 9, ancestor_count: 1, descendant_count: 0, ancestor_fee_sats: 100, ancestor_weight: 800, cpfp_boosted: true, cpfp_checked: true, projected_block_index: 2 },
      policy: { mempool_min_fee_sats_vb: 1, min_relay_fee_sats_vb: 1, mempool_loaded: true },
      replacement: { signals_rbf: true, replaces_txids: ['dd'.repeat(32)], replaced_by_txid: null, is_replacement: false },
      first_seen_utc: '2023-11-14T22:13:20.000Z',
    });
    expect(diagnosis.available_methods).toEqual(['public_p2p']);
  });

  it('derives the facts from the entry, not the txid: a different entry gives a different diagnosis', () => {
    privateSubmissionService.diagnosisReaders = readers({ [TX]: entry({ fee: 100, vsize: 400, effectiveFeePerVsize: 0.25, vin: [{ sequence: 0xffffffff, txid: PARENT, vout: 0 } as any], ancestors: [], descendants: [{ txid: CHILD, fee: 10, weight: 400 }], position: { block: 0, vsize: 1 } }) });
    const diagnosis = privateSubmissionService.diagnoseTransaction(TX);
    expect(diagnosis).toMatchObject({ feerate_sats_vb: 0.25, is_policy_compliant: false, rbf_eligible: false, cpfp_eligible: false, acceleration_recommended: false, package: { descendant_count: 1, cpfp_boosted: false } });
  });

  it('answers an unknown transaction with a typed 404 rather than a diagnosis', () => {
    privateSubmissionService.diagnosisReaders = readers({});
    expect(() => privateSubmissionService.diagnoseTransaction(TX)).toThrow(expect.objectContaining({ code: 'transaction-not-in-mempool', status: 404 }));
  });

  it('resolves a raw transaction to its txid before the lookup', () => {
    const built = new Transaction();
    built.addInput(Buffer.alloc(32, 1), 0);
    built.addOutput(Buffer.from('6a', 'hex'), 0);
    const raw = built.toHex();
    const seen: string[] = [];
    privateSubmissionService.diagnosisReaders = readers({}, { mempoolEntry: txid => { seen.push(txid); return undefined; } });
    expect(() => privateSubmissionService.diagnoseTransaction(raw)).toThrow(/no entry/);
    expect(seen).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/)]);
    expect(seen[0]).not.toBe(raw);
  });
});

describe('ordering evidence from recorded templates and first-seen observations', () => {
  const template = (id: string, txids: string[], observedAt: string): CandidateTemplate => ({
    template_id: id, source_id: 'src-core-gbt', source_name: 'Bitcoin Core getblocktemplate', source_type: 'core_gbt', height: 100, prev_block_hash: PARENT,
    tx_count: txids.length, total_weight: 0, total_fees_sats: 0, sigops_count: null, coinbase_value_sats: null, fingerprint_hash: 'f', observed_at_utc: observedAt, txids,
  });
  const block = (): [BlockExtended, TransactionExtended[]] => [
    { id: BLOCK, height: 100, previousblockhash: PARENT, timestamp: 1_700_000_100 } as unknown as BlockExtended,
    [
      { txid: 'coinbase', vin: [{ is_coinbase: true }], fee: 0, vsize: 100 },
      { txid: TX, vin: [{ txid: 'ee'.repeat(32) }], fee: 1000, vsize: 200, effectiveFeePerVsize: 5 },
      { txid: CHILD, vin: [{ txid: TX }], fee: 500, vsize: 100 },
      { txid: UNSEEN, vin: [{ txid: 'ff'.repeat(32) }], fee: 300, vsize: 150 },
    ] as unknown as TransactionExtended[],
  ];
  function service(templates: CandidateTemplate[], seen: Record<string, string>): OrderingEvidenceService {
    return new OrderingEvidenceService({
      templatesForHeight: height => templates.filter(t => t.height === height),
      firstSeen: txid => (seen[txid] ? { first_observed_utc: seen[txid], source_id: 'owned-mempool-poller-test' } : null),
    }, 'signet');
  }
  afterEach(() => { privateSubmissionService.ordering = new OrderingEvidenceService({ templatesForHeight: () => [], firstSeen: () => null }); });

  it('compares the mined order with the recorded template and the first-seen observations', () => {
    const ordering = service([template('tmpl-1', [UNSEEN, TX], '2023-11-14T22:14:00.000Z')], { [TX]: '2023-11-14T22:13:00.000Z', [CHILD]: '2023-11-14T22:13:30.000Z' });
    privateSubmissionService.ordering = ordering;
    ordering.observeBlock(...block(), Date.parse('2023-11-14T22:15:00.000Z'));

    const first = privateSubmissionService.getTransactionOrdering(TX);
    expect(first).toMatchObject({ block_hash: BLOCK, block_height: 100, block_position: 1, evidence_state: 'ordering_changed_between_template_and_block', first_sensor_seen_utc: '2023-11-14T22:13:00.000Z', first_template_seen_utc: '2023-11-14T22:14:00.000Z', template_position: 2, fee_sats_vb: 5, package_feerate_sats_vb: 5, is_ordering_sensitive: true, confidence_rating: 'high', template_coverage: 'template-observed', template_ids: ['tmpl-1'] });
    const child = privateSubmissionService.getTransactionOrdering(CHILD);
    expect(child).toMatchObject({ block_position: 2, evidence_state: 'dependency_required_order', dependency_txids: [TX], template_ids: [], confidence_rating: 'high' });
    const unseen = privateSubmissionService.getTransactionOrdering(UNSEEN);
    expect(unseen).toMatchObject({ block_position: 3, evidence_state: 'observed_only_in_template', first_sensor_seen_utc: undefined, template_position: 1, sensor_observer_id: null });

    const whole = privateSubmissionService.getBlockOrdering(BLOCK);
    expect(whole).toMatchObject({ block_hash: BLOCK, height: 100, network: 'signet', template_coverage: 'template-observed', templates_compared: ['tmpl-1'], sensor: { observers: 1, observer_id: 'owned-mempool-poller-test' } });
    expect(whole.transactions.map(t => t.txid)).toEqual([TX, CHILD, UNSEEN]);

    const findings = privateSubmissionService.listOrderingFindings();
    expect(findings.state).toBe('observed');
    expect(findings.findings.map(f => [f.txid, f.evidence_state])).toEqual([[TX, 'ordering_changed_between_template_and_block'], [CHILD, 'dependency_required_order'], [UNSEEN, 'observed_only_in_template']]);
    expect(findings.coverage).toEqual([{ block_hash: BLOCK, height: 100, template_coverage: 'template-observed', transactions: 3, findings: 3 }]);
  });

  it('reports a height with no recorded template as no-template-observed, not as an empty success', () => {
    const ordering = service([], { [TX]: '2023-11-14T22:13:00.000Z' });
    privateSubmissionService.ordering = ordering;
    ordering.observeBlock(...block());
    const whole = privateSubmissionService.getBlockOrdering(BLOCK);
    expect(whole.template_coverage).toBe('no-template-observed');
    expect(whole.templates_compared).toEqual([]);
    expect(whole.transactions.every(t => t.evidence_state === 'insufficient_coverage' && t.template_coverage === 'no-template-observed')).toBe(true);
    expect(whole.transactions[0].confidence_rating).toBe('medium');
    expect(whole.transactions[2].confidence_rating).toBe('low');
    const findings = privateSubmissionService.listOrderingFindings();
    expect(findings.findings).toEqual([]);
    expect(findings.coverage[0].template_coverage).toBe('no-template-observed');
  });

  it('ignores templates for another parent and answers unknown blocks and transactions with typed 404s', () => {
    const ordering = service([{ ...template('tmpl-other', [TX], '2023-11-14T22:14:00.000Z'), prev_block_hash: 'dd'.repeat(32) }], {});
    privateSubmissionService.ordering = ordering;
    expect(privateSubmissionService.listOrderingFindings()).toMatchObject({ state: 'no-blocks-observed', findings: [], coverage: [] });
    expect(() => privateSubmissionService.getBlockOrdering(BLOCK)).toThrow(expect.objectContaining({ code: 'block-not-observed', status: 404 }));
    expect(() => privateSubmissionService.getTransactionOrdering(TX)).toThrow(expect.objectContaining({ code: 'transaction-not-observed', status: 404 }));
    ordering.observeBlock(...block());
    expect(privateSubmissionService.getBlockOrdering(BLOCK).template_coverage).toBe('no-template-observed');
  });
});

describe('accelerator provider directory and receipt verification', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const rawPublicKey = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32).toString('hex');
  const directoryText = JSON.stringify({
    schema: 'universe-accelerator-directory-v1', revision: 'r1',
    providers: [
      { id: 'accel-one', name: 'Accelerator One', networks: [config.MEMPOOL.NETWORK, 'signet'], issuer: 'Universe operations', protocolVersion: ACCELERATOR_RECEIPT_SCHEMA,
        keys: [{ kid: 'k1', algorithm: 'ed25519', publicKey: rawPublicKey, validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z' }, { kid: 'k0', algorithm: 'ed25519', publicKey: rawPublicKey, validFrom: '2020-01-01T00:00:00.000Z', validUntil: '2021-01-01T00:00:00.000Z' }],
        terms: { minimum_fee_sats: 1000, maximum_tx_vsize: 100000, payment_methods: ['lightning'], partner_mining_claims: ['none verified'] } },
      { id: 'elsewhere', name: 'Other network only', networks: ['other-network'], issuer: 'x', protocolVersion: ACCELERATOR_RECEIPT_SCHEMA, keys: [{ kid: 'k', algorithm: 'secp256k1-schnorr', publicKey: 'ab'.repeat(32), validFrom: '2026-01-01T00:00:00.000Z', validUntil: null }] },
    ],
  });
  const directory: AcceleratorDirectory = parseAcceleratorDirectory(directoryText, '/etc/universe/accelerators.json', Date.parse('2026-09-17T00:00:00.000Z'));
  const NOW = Date.parse('2026-09-17T12:00:00.000Z');

  function receipt(overrides: Partial<AcceleratorReceipt> = {}): AcceleratorReceipt {
    const payload = {
      schema_version: ACCELERATOR_RECEIPT_SCHEMA, provider_id: 'accel-one', receipt_id: 'rcpt-1', txid: TX, network: config.MEMPOOL.NETWORK,
      submitted_at_utc: '2026-09-17T11:00:00.000Z', expires_at_utc: '2026-09-18T11:00:00.000Z', target_feerate_sats_vb: 20, provider_fee_sats: 5000,
      claimed_mining_coverage_pct: 30, claimed_partner_pools: ['pool-a'], status: 'active' as const,
      ...overrides,
    };
    const { provider_signature, key_id, ...signed } = payload as Partial<AcceleratorReceipt>;
    void provider_signature; void key_id;
    const signature = signEd25519(null, receiptSigningMessage(signed as AcceleratorReceipt), privateKey).toString('hex');
    return { ...(signed as AcceleratorReceipt), key_id: 'k1', provider_signature: signature, ...('provider_signature' in overrides ? { provider_signature: overrides.provider_signature as string } : {}), ...('key_id' in overrides ? { key_id: overrides.key_id as string } : {}) };
  }

  beforeEach(() => { useAcceleratorDirectory(directory); });
  afterEach(() => { useAcceleratorDirectory(undefined); });

  it('lists the directory providers for this network and reads one by id', () => {
    const listed = privateSubmissionService.listAcceleratorProviders();
    expect(listed.providers.map(p => p.provider_id)).toEqual(['accel-one']);
    expect(listed.directory).toEqual({ source: '/etc/universe/accelerators.json', revision: 'r1', loaded_at_utc: '2026-09-17T00:00:00.000Z' });
    const one = privateSubmissionService.getAcceleratorProvider('accel-one');
    expect(one).toMatchObject({ name: 'Accelerator One', identity_key: rawPublicKey, health_status: 'unmeasured', status_endpoint: null, provider_signature: null, issuer: 'Universe operations', minimum_fee_sats: 1000, effective_from: '2020-01-01T00:00:00.000Z', expires_at: '2027-01-01T00:00:00.000Z' });
    expect(one.keys?.map(k => k.kid)).toEqual(['k1', 'k0']);
    expect(() => privateSubmissionService.getAcceleratorProvider('nobody')).toThrow(expect.objectContaining({ code: 'provider-not-in-directory', status: 404 }));
  });

  it('reports the unconfigured directory rather than a directory of providers', () => {
    useAcceleratorDirectory(null);
    expect(() => privateSubmissionService.listAcceleratorProviders()).toThrow(expect.objectContaining({ code: 'unavailable-registry', status: 503 }));
    expect(() => privateSubmissionService.listAcceleratorProviders()).toThrow(/UNIVERSE_ACCELERATOR_PROVIDER_DIRECTORY/);
    const result = privateSubmissionService.verifyAcceleratorReceipt(receipt(), NOW);
    expect(result).toMatchObject({ verified: false, stage: 'unavailable-trust' });
  });

  it('verifies an authentic receipt with the directory key valid at issue and records it', () => {
    const result = privateSubmissionService.verifyAcceleratorReceipt(receipt(), NOW);
    expect(result).toMatchObject({ verified: true, stage: 'verified', errors: [], provider_id: 'accel-one', receipt_id: 'rcpt-1', key_id: 'k1', algorithm: 'ed25519', verified_at_utc: '2026-09-17T12:00:00.000Z', directory: { revision: 'r1' }, replay: { seen_count: 1 } });
    expect(result.scope).toMatch(/not that the acceleration was delivered/);
  });

  it('fails independently on an altered signature, txid, provider, network, expiry and terms', () => {
    const cases: Array<[Partial<AcceleratorReceipt>, string, RegExp]> = [
      [receipt({ provider_signature: 'ab'.repeat(64) }), 'invalid', /does not verify/],
      [{ ...receipt(), txid: 'ee'.repeat(32) }, 'invalid', /does not verify/],
      [{ ...receipt(), provider_fee_sats: 1 }, 'invalid', /does not verify/],
      [{ ...receipt(), provider_id: 'elsewhere' }, 'unavailable-trust', /not a directory key of provider elsewhere/],
      [{ ...receipt(), provider_id: 'nobody' }, 'unavailable-trust', /not in the owned directory/],
      [{ ...receipt(), key_id: 'k9' }, 'unavailable-trust', /not a directory key/],
      [receipt({ key_id: 'k0' }), 'unavailable-trust', /was not valid at/],
      [receipt({ network: 'other-network' }), 'wrong-network', /this deployment serves/],
      [receipt({ expires_at_utc: '2026-09-17T11:30:00.000Z' }), 'expired', /expired at/],
      [receipt({ schema_version: 'someone-elses-receipt-v3' }), 'unsupported', /no other receipt encoding/],
      [{ ...receipt(), submitted_at_utc: undefined as unknown as string }, 'invalid', /submitted_at_utc/],
    ];
    for (const [payload, stage, message] of cases) {
      const result = privateSubmissionService.verifyAcceleratorReceipt(payload, NOW);
      expect(result.verified).toBe(false);
      expect(result.stage).toBe(stage);
      expect(result.errors.join('\n')).toMatch(message);
    }
  });

  it('flags a replay of a verified receipt as a duplicate', () => {
    expect(privateSubmissionService.verifyAcceleratorReceipt(receipt({ receipt_id: 'rcpt-dup' }), NOW).stage).toBe('verified');
    const again = privateSubmissionService.verifyAcceleratorReceipt(receipt({ receipt_id: 'rcpt-dup' }), NOW + 1000);
    expect(again).toMatchObject({ verified: false, stage: 'duplicate', replay: { first_verified_at_utc: '2026-09-17T12:00:00.000Z', seen_count: 2 } });
    expect(privateSubmissionService.verifyAcceleratorReceipt(receipt({ receipt_id: 'rcpt-other' }), NOW).stage).toBe('verified');
  });

  it('still names the faults in a receipt it can read', () => {
    const malformed = privateSubmissionService.verifyAcceleratorReceipt({ provider_id: '', txid: 'bad' });
    expect(malformed.verified).toBe(false);
    expect(malformed.stage).toBe('invalid');
    expect(malformed.errors).toContain('provider_id is required');
    expect(malformed.errors).toContain('Valid 32-byte txid is required');
    const nonhex = { provider_id: 'provider', receipt_id: 'receipt', provider_signature: 'ab'.repeat(64), txid: 'z'.repeat(64) };
    expect(privateSubmissionService.verifyAcceleratorReceipt(nonhex)).toMatchObject({ verified: false, stage: 'invalid' });
    expect(privateSubmissionService.verifyAcceleratorReceipt({ ...nonhex, txid: 'ab'.repeat(32) })).toMatchObject({ verified: false, stage: 'unsupported' });
  });

  it('uses the documented deterministic encoding', () => {
    expect(deterministicJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' }, u: undefined })).toBe('{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
    expect(receiptSigningMessage({ b: 1 } as unknown as AcceleratorReceipt).toString('utf8')).toBe(ACCELERATOR_RECEIPT_SCHEMA + '\n{"b":1}');
  });

  it('refuses a malformed directory file', () => {
    expect(() => parseAcceleratorDirectory('nope', 'f')).toThrow(/not JSON/);
    expect(() => parseAcceleratorDirectory(JSON.stringify({ schema: 'other', revision: '1', providers: [] }), 'f')).toThrow(/must declare schema/);
    expect(() => parseAcceleratorDirectory(JSON.stringify({ schema: 'universe-accelerator-directory-v1', revision: '1', providers: [{ id: 'p', name: 'P', networks: ['signet'], issuer: 'i', protocolVersion: 'v', keys: [{ kid: 'k', algorithm: 'rsa', publicKey: 'ab', validFrom: 'x' }] }] }), 'f')).toThrow(/supported algorithm/);
  });
});
