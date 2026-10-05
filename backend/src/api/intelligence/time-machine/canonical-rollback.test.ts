import { TimeMachineService, TIME_MACHINE_LIMITS } from './time-machine.service';
import { validateHistorySnapshot } from './history-validation';
import { HistoryStore } from './history-store';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CanonicalPollFence } from './canonical-poll-fence';
const hash = (n: number) => n.toString(16).padStart(64, '0');
const tx = { txid: 'a'.repeat(64), weight: 437, vsize: 109.25, fee: 1000 } as any;
const block = (height: number) => ({ id: hash(height), height, weight: 1000, extras: { totalFees: 1000 } } as any);
const rollback = { status: 'verified-rollback' as const, network: 'signet', observedAt: 1200, previousTip: { height: 2, hash: hash(2) }, canonicalTip: { height: 1, hash: hash(1) }, commonAncestor: { height: 1, hash: hash(1) }, orphanedBlocks: [{ height: 2, hash: hash(2) }] };
describe('canonical source rollback history', () => {
  it('invalidates orphan snapshot and classifies only observed orphan reentry', () => {
    const pool: any = {};
    const history = new TimeMachineService({ store: null, network: 'signet', now: 1000, feed: () => pool });
    history.observeBlock(block(1), [], 1000);
    const orphan = history.observeBlock(block(2), [tx], 1100);
    (history as any).observeCanonicalChange(rollback);
    expect(history.getStateByHash(orphan.state_hash)).toBeNull();
    history.observePoll([{ ...tx, vsize: 110 }], [], true, 1300);
    expect(history.getTransactionLifecycle(tx.txid).slice(-1)[0].event_type).toBe('accepted');
    pool[tx.txid] = { ...tx, vsize: 110 };
    history.observePoll([], [], true, 1400);
    history.observeVerifiedReentries([tx.txid], { height: 1, hash: hash(1) }, history.getPollGeneration() - 1, 1401);
    expect(history.getTransactionLifecycle(tx.txid).slice(-1)[0].event_type).toBe('reaccepted_after_reorg');
    history.observePoll([{ ...tx, vsize: 110 }], [], true, 1500);
    expect(history.getTransactionLifecycle(tx.txid).slice(-1)[0].event_type).toBe('accepted');
  });
  it('persists sequence-bound orphan provenance and expected tip across restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orphan-history-'));
    const pool: any = { [tx.txid]: { ...tx, vsize: 110 } };
    let history = new TimeMachineService({ store: new HistoryStore(join(directory, 'history.gz'), 'signet'), network: 'signet', now: 1000, feed: () => pool });
    try {
      history.observeBlock(block(1), [], 1000); history.observeBlock(block(2), [tx], 1100);
      history.observeCanonicalChange(rollback); await history.closeHistory();
      history = new TimeMachineService({ store: new HistoryStore(join(directory, 'history.gz'), 'signet'), network: 'signet', now: 1250, feed: () => pool });
      expect(history.getCoverage().persistence.error).toBeNull();
      expect(history.getPendingCanonicalTip()).toEqual({ height: 1, hash: hash(1) });
      history.observePoll([], [], true, 1300);
      history.observeVerifiedReentries([tx.txid], { height: 1, hash: hash(1) }, history.getPollGeneration() - 1, 1301);
      expect(history.getTransactionLifecycle(tx.txid).slice(-1)[0].event_type).toBe('reaccepted_after_reorg');
      expect(history.getPendingCanonicalTip()).toBeNull();
    } finally { await history.closeHistory(); rmSync(directory, { recursive: true, force: true }); }
  });
  it('requires complete poll, matching full membership and current native cached transaction', () => {
    const pool: any = {};
    const history = new TimeMachineService({ store: null, network: 'signet', now: 1000, feed: () => pool });
    history.observeBlock(block(1), [], 1000); history.observeBlock(block(2), [tx], 1100); history.observeCanonicalChange(rollback);
    history.observePoll([], [], false, 1300); history.observeVerifiedReentries([tx.txid], { height: 1, hash: hash(1) }, history.getPollGeneration() - 1, 1301);
    expect(history.getPendingCanonicalTip()).not.toBeNull();
    history.observePoll([], [], true, 1400); history.observeVerifiedReentries([tx.txid], { height: 1, hash: hash(1) }, history.getPollGeneration() - 1, 1401);
    expect(history.getPendingCanonicalTip()).not.toBeNull();
    pool[tx.txid] = { ...tx, vsize: 110 }; history.observePoll([], [], true, 1500);
    history.observeVerifiedReentries([], { height: 1, hash: hash(1) }, history.getPollGeneration() - 1, 1501); expect(history.getPendingCanonicalTip()).not.toBeNull();
  });
  it('fences source changes during actual cache update without stale authorization', async () => {
    const expected = { height: 1, hash: hash(1) };
    let source = expected;
    const reader = jest.fn(async () => source);
    const fence = await CanonicalPollFence.begin(expected, reader);
    expect(await fence.verify()).toBe(true);
    source = { height: 2, hash: hash(2) }; // changes while the existing transaction cache is updated
    expect(await fence.verify()).toBe(false);
    source = expected; expect(await fence.verify()).toBe(false);
    expect(reader).toHaveBeenCalledTimes(3);
    const unused = jest.fn(async () => expected); const empty = await CanonicalPollFence.begin(null, unused);
    expect(await empty.verify()).toBe(false); expect(unused).not.toHaveBeenCalled();
  });
  it('requires exactly one new complete callback after the captured poll generation', () => {
    const pool: any = { [tx.txid]: { ...tx, vsize: 110 } };
    const history = new TimeMachineService({ store: null, network: 'signet', now: 1000, feed: () => pool });
    history.observeBlock(block(1), [], 1000); history.observeBlock(block(2), [tx], 1100); history.observeCanonicalChange(rollback);
    history.observePoll([], [], true, 1300);
    const noCallbackToken = history.getPollGeneration();
    expect(history.observeVerifiedReentries([tx.txid], { height: 1, hash: hash(1) }, noCallbackToken, 1301)).toBe(false);
    const superseded = history.getPollGeneration();
    history.observePoll([], [], true, 1400); history.observePoll([], [], true, 1500);
    expect(history.observeVerifiedReentries([tx.txid], { height: 1, hash: hash(1) }, superseded, 1501)).toBe(false);
    const actualToken = history.getPollGeneration(); history.observePoll([], [], true, 1600);
    expect(history.observeVerifiedReentries([tx.txid], { height: 1, hash: hash(1) }, actualToken, 1601)).toBe(true);
    expect(history.getTransactionLifecycle(tx.txid).filter(event => event.event_type === 'reaccepted_after_reorg')).toHaveLength(1);
    expect(history.observeVerifiedReentries([tx.txid], { height: 1, hash: hash(1) }, actualToken, 1602)).toBe(false);
  });
  it('rejects membership that differs from the actual complete transaction cache', () => {
    const extra = 'b'.repeat(64), pool: any = { [tx.txid]: { ...tx, vsize: 110 }, [extra]: { ...tx, txid: extra, vsize: 110 } };
    const history = new TimeMachineService({ store: null, network: 'signet', now: 1000, feed: () => pool });
    history.observeBlock(block(1), [], 1000); history.observeBlock(block(2), [tx], 1100); history.observeCanonicalChange(rollback);
    let token = history.getPollGeneration(); history.observePoll([], [], true, 1300);
    expect(history.observeVerifiedReentries([tx.txid], { height: 1, hash: hash(1) }, token, 1301)).toBe(false);
    token = history.getPollGeneration(); history.observePoll([], [], true, 1400);
    expect(history.observeVerifiedReentries([tx.txid, extra, extra], { height: 1, hash: hash(1) }, token, 1401)).toBe(false);
    token = history.getPollGeneration(); history.observePoll([], [], true, 1500);
    expect(history.observeVerifiedReentries([tx.txid, extra], { height: 1, hash: hash(1) }, token, 1501)).toBe(true);
  });
  it('does not classify unknown ordinary repeated admission as reorg', () => {
    const history = new TimeMachineService({ store: null, network: 'signet', now: 1000 });
    history.observePoll([{ ...tx, vsize: 110 }], [], true, 1100);
    history.observePoll([{ ...tx, vsize: 110 }], [], true, 1200);
    expect(history.getTransactionLifecycle(tx.txid).map(event => event.event_type)).toEqual(['accepted', 'accepted']);
  });
  it('rejects foreign network notification before modifying state', () => {
    const history = new TimeMachineService({ store: null, network: 'signet', now: 1000, feed: () => ({}) });
    const checkpoint = history.observeBlock(block(2), [tx], 1100);
    expect(() => (history as any).observeCanonicalChange({ ...rollback, network: 'mainnet' })).toThrow(/network/i);
    expect(history.getStateByHash(checkpoint.state_hash)).not.toBeNull();
  });
  it('rejects out-of-order or contradictory canonical points before changing state', () => {
    const history = new TimeMachineService({ store: null, network: 'signet', now: 1000, feed: () => ({}) });
    const checkpoint = history.observeBlock(block(2), [tx], 1100);
    expect(() => history.observeCanonicalChange({ ...rollback, observedAt: 1099 })).toThrow(/timestamp/);
    expect(() => history.observeCanonicalChange({ ...rollback, canonicalTip: { height: 1, hash: 'f'.repeat(64) } })).toThrow(/ancestry/);
    expect(history.getStateByHash(checkpoint.state_hash)).not.toBeNull();
  });
  it('retains unknown legacy confirmation semantics without guessing its block hash', () => {
    const pool: any = { [tx.txid]: { ...tx, vsize: 110 } };
    const history = new TimeMachineService({ store: null, network: 'signet', now: 1000, feed: () => pool });
    history.observeBlock(block(1), [], 1000);
    history.recordLifecycleEvent({ event_id: 'old-v1', txid: tx.txid, event_type: 'confirmed', block_height: 2, timestamp_utc: new Date(1100).toISOString(), vsize: 110, weight: 437, fee_sats: 1000, fee_rate: 9.09 });
    history.observeCanonicalChange(rollback); history.observePoll([], [], true, 1300);
    history.observeVerifiedReentries([tx.txid], { height: 1, hash: hash(1) }, history.getPollGeneration() - 1, 1301);
    expect(history.getTransactionLifecycle(tx.txid)).toHaveLength(1);
    expect(history.getPendingCanonicalTip()).toBeNull();
  });
});

describe('coinbase and native canonical restoration', () => {
  it('retires a coinbase-only obsolete restoration target on independently verified canonical progression', () => {
    const history = new TimeMachineService({ store: null, network: 'signet', now: 1000, feed: () => ({}) });
    history.observeBlock(block(2), [{ ...tx, vin: [{ is_coinbase: true }] }], 1100); history.observeCanonicalChange(rollback);
    expect(history.getCanonicalRecoveryRequest()?.expectedCanonicalTip).toEqual({ height: 1, hash: hash(1) });
    const events = history.getTransactionLifecycle(tx.txid);
    history.observeCanonicalChange({ status: 'verified-progression', network: 'signet', observedAt: 1300,
      previousCanonicalTip: { height: 1, hash: hash(1) }, canonicalTip: { height: 3, hash: hash(3) } });
    expect(history.getCanonicalRecoveryRequest()).toBeNull();
    expect(history.getTransactionLifecycle(tx.txid)).toEqual(events);
    expect(history.getCoverage().total_checkpoints).toBe(0);
  });
  it('persists the new actual canonical point without authorizing a stale or incomplete poll after restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'progression-restart-'));
    const file = join(directory, 'history.gz'), pool: any = { [tx.txid]: tx };
    let history = new TimeMachineService({ store: new HistoryStore(file, 'signet'), network: 'signet', now: 1000, feed: () => pool });
    try {
      history.observeBlock(block(2), [tx], 1100); history.observeCanonicalChange(rollback);
      history.observeCanonicalChange({ status: 'verified-progression', network: 'signet', observedAt: 1300,
        previousCanonicalTip: { height: 1, hash: hash(1) }, canonicalTip: { height: 3, hash: hash(3) } });
      await history.closeHistory();
      history = new TimeMachineService({ store: new HistoryStore(file, 'signet'), network: 'signet', now: 1400, feed: () => pool });
      expect(history.getCoverage().persistence.error).toBeNull();
      expect(history.getPendingCanonicalTip()).toEqual({ height: 3, hash: hash(3) });
      let token = history.getPollGeneration(); history.observePoll([], [], false, 1500);
      expect(history.observeVerifiedReentries([tx.txid], { height: 3, hash: hash(3) }, token, 1501)).toBe(false);
      token = history.getPollGeneration(); history.observePoll([], [], true, 1600);
      expect(history.observeVerifiedReentries([tx.txid], { height: 1, hash: hash(1) }, token, 1601)).toBe(false);
      token = history.getPollGeneration(); history.observePoll([], [], true, 1700);
      expect(history.observeVerifiedReentries([tx.txid], { height: 3, hash: hash(3) }, token, 1701)).toBe(true);
      expect(history.getTransactionLifecycle(tx.txid).slice(-1)[0].event_type).toBe('reaccepted_after_reorg');
    } finally { await history.closeHistory(); rmSync(directory, { recursive: true, force: true }); }
  });
  it('records actual normalized coinbase fact and never stages proven coinbase reentry', () => {
    const history = new TimeMachineService({ store: null, network: 'signet', now: 1000, feed: () => ({}) });
    const coinbase = { ...tx, vin: [{ is_coinbase: true }] };
    history.observeBlock(block(2), [coinbase], 1100);
    expect((history.getTransactionLifecycle(tx.txid)[0] as any).is_coinbase).toBe(true);
    history.observeCanonicalChange(rollback);
    expect(history.getPendingCanonicalTip()).toBeNull();
    expect((history as any).getCanonicalRestorationTarget()).toEqual({ height: 2, hash: hash(2) });
  });
  it('retires nonreentering orphan provenance only on actual matching restoration without checkpoint invention', () => {
    const history = new TimeMachineService({ store: null, network: 'signet', now: 1000, feed: () => ({}) });
    const prior = history.observeBlock(block(2), [tx], 1100);
    history.observeCanonicalChange(rollback); history.observePoll([], [], false, 1300);
    const original = history.getTransactionLifecycle(tx.txid);
    (history as any).observeCanonicalChange({ status: 'verified-restoration', network: 'signet', observedAt: 1400,
      restoredTarget: { height: 2, hash: hash(2) }, canonicalTip: { height: 2, hash: hash(2) } });
    expect(history.getPendingCanonicalTip()).toBeNull();
    expect((history as any).getCanonicalRestorationTarget()).toBeNull();
    expect(history.getStateByHash(prior.state_hash)).toBeNull();
    expect(history.getTransactionLifecycle(tx.txid)).toEqual(original);
    expect(history.getCoverage().coverage_gaps.length).toBeGreaterThan(0);
  });
  it('keeps absent legacy coinbase fact unknown and requires exact restoration target', () => {
    const history = new TimeMachineService({ store: null, network: 'signet', now: 1000, feed: () => ({}) });
    history.observeBlock(block(2), [tx], 1100); history.observeCanonicalChange(rollback);
    expect(history.getTransactionLifecycle(tx.txid)[0].is_coinbase).toBeUndefined();
    expect(history.getPendingCanonicalTip()).not.toBeNull();
    expect(() => history.observeCanonicalChange({ status: 'verified-restoration', network: 'signet', observedAt: 1300,
      restoredTarget: { height: 1, hash: hash(1) }, canonicalTip: { height: 1, hash: hash(1) } })).toThrow();
    expect(() => history.observeCanonicalChange({ status: 'verified-restoration', network: 'testnet', observedAt: 1300,
      restoredTarget: { height: 2, hash: hash(2) }, canonicalTip: { height: 2, hash: hash(2) } })).toThrow();
    expect(history.getCanonicalRestorationTarget()).toEqual({ height: 2, hash: hash(2) });
    expect(history.getPendingCanonicalTip()).not.toBeNull();
  });
  it('persists independently observed restoration target even with no eligible reentry candidate', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'coinbase-restoration-'));
    let history = new TimeMachineService({ store: new HistoryStore(join(directory, 'history.gz'), 'signet'), network: 'signet', now: 1000, feed: () => ({}) });
    try {
      history.observeBlock(block(2), [{ ...tx, vin: [{ is_coinbase: true }] }], 1100);
      history.observeCanonicalChange(rollback); await history.closeHistory();
      history = new TimeMachineService({ store: new HistoryStore(join(directory, 'history.gz'), 'signet'), network: 'signet', now: 1250, feed: () => ({}) });
      expect(history.getCoverage().persistence.error).toBeNull();
      expect(history.getPendingCanonicalTip()).toBeNull();
      expect(history.getCanonicalRestorationTarget()).toEqual({ height: 2, hash: hash(2) });
      expect(history.getTransactionLifecycle(tx.txid)[0].is_coinbase).toBe(true);
      history.observeCanonicalChange({ status: 'verified-restoration', network: 'signet', observedAt: 1300,
        restoredTarget: { height: 2, hash: hash(2) }, canonicalTip: { height: 2, hash: hash(2) } });
      await history.closeHistory();
      history = new TimeMachineService({ store: new HistoryStore(join(directory, 'history.gz'), 'signet'), network: 'signet', now: 1400, feed: () => ({}) });
      expect(history.getCoverage().persistence.error).toBeNull();
      expect(history.getCanonicalRestorationTarget()).toBeNull();
      expect(history.getCoverage().total_checkpoints).toBe(0);
    } finally { await history.closeHistory(); rmSync(directory, { recursive: true, force: true }); }
  });
  it('rejects malformed persisted coinbase and restoration metadata instead of guessing legacy facts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'restoration-validation-'));
    const file = join(directory, 'history.gz');
    const history = new TimeMachineService({ store: new HistoryStore(file, 'signet'), network: 'signet', now: 1000, feed: () => ({}) });
    let reader: HistoryStore | undefined;
    try {
      history.observeBlock(block(2), [tx], 1100); history.observeCanonicalChange(rollback); await history.closeHistory();
      reader = new HistoryStore(file, 'signet');
      const original = reader.read();
      expect(validateHistorySnapshot(original, 'signet', TIME_MACHINE_LIMITS).events[0].is_coinbase).toBeUndefined();
      for (const malformed of [
        (copy: any) => { copy.events[0].is_coinbase = 'true'; },
        (copy: any) => { copy.canonicalRestorationTarget.hash = 'not-a-block-hash'; },
        (copy: any) => { copy.canonicalRestorationTarget.rollback_sequence = copy.eventSequence + 1; },
        (copy: any) => { copy.canonicalRestorationTarget.observed_at = new Date(copy.observedThrough + 1).toISOString(); },
      ]) {
        const copy = JSON.parse(JSON.stringify(original)); malformed(copy);
        expect(() => validateHistorySnapshot(copy, 'signet', TIME_MACHINE_LIMITS)).toThrow();
      }
    } finally { reader?.close(); await history.closeHistory(); rmSync(directory, { recursive: true, force: true }); }
  });
});
