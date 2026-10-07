import {
  Cat20Holder,
  Cat20Token,
  FractalBlockSummary,
  FractalMempoolOverview,
  FractalTransactionView,
  Cat20Page,
  Cat20PageRequest,
  FractalTip,
} from './fractal.types';
import { FractalEvidenceError } from './fractal.errors';
import { FractalNativeReader, atomic, evidence, hash, height, inputHash, object } from './fractal.native';
import { Cat20Projection } from './fractal.cat';
export { FractalEvidenceError } from './fractal.errors';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */

const nodeUnavailable =
  'Fractal Bitcoin observations are unavailable. Tip, mempool, block and transaction reads require the owned Fractal Bitcoin node (fractald RPC), which is not connected on this deployment.';

const cat20Unavailable =
  'CAT-20 observations are unavailable. Token, supply and holder reads require the owned CAT-20 covenant indexer over the owned Fractal Bitcoin node, which is not connected on this deployment.';

/**
 * Fractal Bitcoin chain and CAT-20 evidence.
 *
 * Every read here needs an owned Fractal node, and the CAT-20 reads need an
 * owned covenant indexer on top of it. Neither is connected, so each read
 * reports the absent source. The revision this replaces answered from
 * constants: a fixed tip height, an invented block for any height, a
 * transaction decoded as a CAT-20 transfer whenever its txid ended in a
 * chosen pair of characters, and a token directory with holders and balances
 * that no indexer had observed.
 */
export class FractalService {
  constructor(private readonly native?: FractalNativeReader, private readonly cat?: Cat20Projection) {}

  private source(): FractalNativeReader {
    if (!this.native) { throw new FractalEvidenceError('unavailable-fractal-node', nodeUnavailable); }
    return this.native;
  }
  /* IMPLEMENTATION-HANDOFF [WP-BE-007]
   * Defect BE-007; COV-BE-007 tip, mempool, block, transaction, CAT20 token
   * list/detail/holders. The previous seven methods always threw. Explicit
   * native/read-only projection adapters are now implemented; full operated
   * lifecycle and UI acceptance remain pending. See the current
   * source reproducer and frontend Fractal/CAT20 consumers for offered scope.
   * 1. Pin the operated Fractal release/genesis/network and CAT tracker schema
   *    against R-BE-FRACTAL/R-BE-CAT. CAT requires the chain's enabled covenant
   *    rules; do not infer Bitcoin mainnet support from shared address syntax.
   * 2. Add owned-node RPC and owned tracker clients with bounded total
   *    deadlines, authenticated transport, strict hash/height/token inputs and
   *    pagination. Source mempool/block/tx bytes from the selected Fractal
   *    node and prove tracker checkpoint agreement before joining token data.
   * 3. Map CAT20 supply/holders using exact atomic strings and checked contract
   *    identifiers. Track spent covenant UTXOs, pending versus confirmed
   *    state and rollback to a common ancestor after reorg or interrupted
   *    indexing. Reuse the operated tracker, never infer token type from txid.
   * 4. Wire fractal.types/routes and universe-api/Fractal/CAT20 consumers;
   *    preserve null/not-found versus unavailable, correct network labels,
   *    empty valid data, loading/error/retry and cursor boundaries.
   * 5. Run supported Fractal testnet node+tracker journeys for every listed
   *    read, real token lifecycle observations, large holder sets, malformed
   *    IDs, wrong chain, spent outputs, restart/reorg and dependent totals.
   * Acceptance: seven source-to-UI operations with exact identities, amounts
   * and checkpoints; a fixture or HTTP503 is not a completed integration.
   * Rollback: back up tracker DB, deploy schema before compatible readers,
   * preserve the last verified checkpoint and restore the matched release.
   * Preserve this acceptance annotation until all seven genuine journeys pass.
   */
  /** @asyncUnsafe Native failures propagate to the HTTP error boundary. */
  public async $getTip(): Promise<FractalTip> {
    const source = this.source();
    return source.attempt(/** @asyncUnsafe Native failures propagate to attempt/HTTP boundaries. */ async (signal, observation) => {
      const header = object(await source.call('getblockheader', [observation.checkpoint.hash], signal));
      evidence(hash(header.hash) === observation.checkpoint.hash && height(header.height) === observation.checkpoint.height);
      return { schema: 'fractal-tip-v1', ...observation.checkpoint, time: height(header.time), network: observation.network, observation };
    });
  }

  /** @asyncUnsafe Native failures propagate to the HTTP error boundary. */
  public async $getMempool(): Promise<FractalMempoolOverview> {
    const source = this.source();
    return source.attempt(/** @asyncUnsafe Native failures propagate to attempt/HTTP boundaries. */ async (signal, observation) => {
      const mempool = object(await source.call('getmempoolinfo', [], signal));
      evidence(mempool.loaded === true, 'unavailable-fractal-mempool');
      return { schema: 'fractal-mempool-v1', observation, count: height(mempool.size), totalBytes: height(mempool.bytes),
        totalWeight: null, minFeeRate: null, maxFeeRate: null, medianFeeRate: null, pendingCat20TxCount: null,
        unavailable: ['transaction-weight-and-fee-distribution-not-observed', 'pending-cat20-not-indexed'] };
    });
  }

  /** @asyncUnsafe Native failures propagate to the HTTP error boundary. */
  public async $getBlock(hashOrHeight: string): Promise<FractalBlockSummary | null> {
    evidence(/^(0|[1-9][0-9]{0,9})$/.test(hashOrHeight) || /^[0-9a-f]{64}$/.test(hashOrHeight), 'invalid-fractal-input', 400);
    const source = this.source();
    return source.attempt(/** @asyncUnsafe Native failures propagate to attempt/HTTP boundaries. */ async (signal, observation) => {
      const selectedHash = hashOrHeight.length === 64 ? hashOrHeight : await source.call('getblockhash', [Number(hashOrHeight)], signal);
      if (selectedHash === null) { return null; }
      const blockHash = hash(selectedHash);
      const value = await source.call('getblock', [blockHash, 1], signal);
      if (value === null) { return null; }
      const block = object(value);
      evidence(hash(block.hash) === blockHash && await source.call('getblockhash', [height(block.height)], signal) === blockHash, 'fractal-noncanonical-block', 409);
      evidence(Array.isArray(block.tx) && typeof block.difficulty === 'number' && Number.isFinite(block.difficulty));
      return { schema: 'fractal-block-v1', observation, hash: blockHash, height: height(block.height), time: height(block.time), txCount: block.tx.length,
        size: height(block.size), weight: height(block.weight), merkleRoot: hash(block.merkleroot), difficulty: block.difficulty };
    });
  }

  /** @asyncUnsafe Native failures propagate to the HTTP error boundary. */
  public async $getTransaction(txid: string): Promise<FractalTransactionView | null> {
    inputHash(txid);
    const source = this.source();
    return source.attempt(/** @asyncUnsafe Native failures propagate to attempt/HTTP boundaries. */ async (signal, observation) => {
      const indexes = object(await source.call('getindexinfo', ['txindex'], signal));
      evidence(indexes.txindex, 'unavailable-fractal-txindex');
      const index = object(indexes.txindex);
      evidence(index.synced === true && typeof index.best_block_height === 'number' && Number.isSafeInteger(index.best_block_height)
        && index.best_block_height >= observation.checkpoint.height, 'unavailable-fractal-txindex');
      const value = await source.call('getrawtransaction', [txid, true], signal);
      if (value === null) { return null; }
      const tx = object(value);
      evidence(hash(tx.txid) === txid && Array.isArray(tx.vin) && Array.isArray(tx.vout));
      evidence(typeof tx.version === 'number' && Number.isInteger(tx.version) && tx.version >= -2147483648 && tx.version <= 2147483647);
      let blockHeight: number | undefined;
      if (tx.blockhash) {
        const header = object(await source.call('getblockheader', [hash(tx.blockhash)], signal));
        blockHeight = height(header.height);
        evidence(await source.call('getblockhash', [blockHeight], signal) === tx.blockhash, 'fractal-noncanonical-transaction', 409);
      }
      return { schema: 'fractal-transaction-v1', observation, txid, hash: hash(tx.hash), version: tx.version, size: height(tx.size),
        weight: height(tx.weight), locktime: height(tx.locktime), blockHash: tx.blockhash === undefined ? undefined : hash(tx.blockhash), blockHeight, blockTime: tx.blocktime === undefined ? undefined : height(tx.blocktime),
        feeAtomic: null, feeState: 'unknown-prevouts', cat20State: 'not-joined',
        vin: tx.vin.map((entry: unknown) => {
          const vin = object(entry);
          evidence((typeof vin.coinbase === 'string') !== (typeof vin.txid === 'string'));
          evidence(vin.coinbase === undefined || (typeof vin.coinbase === 'string' && /^(?:[0-9a-f]{2})*$/.test(vin.coinbase)));
          const scriptSig = vin.scriptSig === undefined ? undefined : object(vin.scriptSig).hex;
          evidence(scriptSig === undefined || (typeof scriptSig === 'string' && /^(?:[0-9a-f]{2})*$/.test(scriptSig)));
          evidence(vin.txinwitness === undefined || (Array.isArray(vin.txinwitness) && vin.txinwitness.every(item => typeof item === 'string' && /^(?:[0-9a-f]{2})*$/.test(item))));
          return { ...(typeof vin.coinbase === 'string' ? { coinbase: vin.coinbase } : { txid: hash(vin.txid), vout: height(vin.vout) }),
            sequence: height(vin.sequence), scriptSig, witness: vin.txinwitness as string[] | undefined };
        }),
        vout: tx.vout.map((entry: unknown) => {
          const vout = object(entry); const script = object(vout.scriptPubKey);
          evidence(typeof script.hex === 'string' && /^(?:[0-9a-f]{2})*$/.test(script.hex) && typeof script.asm === 'string' && typeof script.type === 'string');
          evidence(script.address === undefined || typeof script.address === 'string');
          return { valueAtomic: atomic(vout.value), n: height(vout.n), scriptPubKey: { asm: script.asm, hex: script.hex, type: script.type, address: script.address } };
        }) };
    });
  }

  /** @asyncUnsafe Native failures propagate to the HTTP error boundary. */
  public async $getCat20Tokens(request: Cat20PageRequest = {}): Promise<Cat20Page<Cat20Token>> {
    if (!this.cat) { throw new FractalEvidenceError('unavailable-cat20-indexer', cat20Unavailable); }
    return this.cat.tokens(request);
  }

  /** @asyncUnsafe Native failures propagate to the HTTP error boundary. */
  public async $getCat20Token(tokenId: string): Promise<unknown> {
    if (!this.cat) { throw new FractalEvidenceError('unavailable-cat20-indexer', cat20Unavailable); }
    return this.cat.token(tokenId);
  }

  /** @asyncUnsafe Native failures propagate to the HTTP error boundary. */
  public async $getCat20Holders(tokenId: string, request: Cat20PageRequest = {}): Promise<Cat20Page<Cat20Holder>> {
    if (!this.cat) { throw new FractalEvidenceError('unavailable-cat20-indexer', cat20Unavailable); }
    return this.cat.holders(tokenId, request);
  }
}

export let fractalService = new FractalService();
/** Startup wiring explicitly supplies independently measured source/profile and read-only projection. */
export function configureFractalSource(native: FractalNativeReader, cat?: Cat20Projection): void {
  fractalService = new FractalService(native, cat);
}
