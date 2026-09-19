import {
  Cat20Holder,
  Cat20Token,
  FractalBlockSummary,
  FractalMempoolOverview,
  FractalTransactionView,
} from './fractal.types';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class FractalEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

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
/**
 * IMPLEMENTATION-HANDOFF [TX-07] TX-07-MEMPOOL-FRACTAL-READS
 * Coverage G17/P-cat20-*; D12/D14. R-FRACTAL-040/R-CAT/R-ARCH.
 * Verified cause: all seven public read methods unconditionally throw 503. This
 * is missing implementation, not a problem solved by setting an environment flag.
 * 1. Add PROPOSED NEW fractal-read.client.ts as a small read-only, per-network
 * owned-node transport. Reuse existing outbound transport/security conventions
 * and the read-port contract in backend-apis/src/cat20/fractal-node-read.client.ts;
 * do not import wallet/signing modules or create another blockchain indexer.
 * 2. Replace $getTip/$getMempool/$getBlock/$getTransaction throws with validated
 * owned-node reads. Allowlist only needed read RPC methods, enforce context and
 * node identity, bound payload/deadline, and map a proven missing tx to null.
 * Decode raw tx values as exact atomic strings; unavailable fee/prevout is not 0.
 * 3. Replace $getCat20Tokens/$getCat20Token/$getCat20Holders throws with the
 * existing first-party index-cat20 read contract, retaining pagination/coverage.
 * Use authoritative deploy/mint/transfer/burn decisions, never txid suffixes or
 * current holder balances as transaction effects. Preserve exact types already
 * in fractal.types.ts and add nullable evidence fields where data is unknown.
 * 4. Let the overlay summary reader call this owned base-tx read path plus the
 * CAT authority projection; no circular request back into the summary endpoint.
 * Separate mainnet/Testnet configuration, credentials and caches. Missing
 * configuration remains explicit 503; never restore the removed constants.
 * Depends TX-01/02; coordinate FractalRoutes, frontend API/context and new tx
 * route. Tests: backend/src/api/fractal/fractal.service.test.ts plus new read-
 * client tests for all seven methods, wrong chain, timeout, absence, large values,
 * CAT validity and reorg. Use the existing backend test runner; commands in
 * COMMANDS.md are verified against package.json. No signing/broadcast needed.
 */
export class FractalService {
  /** @asyncSafe */
  public async $getTip(): Promise<{ height: number; hash: string; time: number; network: string }> {
    throw new FractalEvidenceError('unavailable-fractal-node', nodeUnavailable);
  }

  /** @asyncSafe */
  public async $getMempool(): Promise<FractalMempoolOverview> {
    throw new FractalEvidenceError('unavailable-fractal-node', nodeUnavailable);
  }

  /** @asyncSafe */
  public async $getBlock(_hashOrHeight: string): Promise<FractalBlockSummary | null> {
    throw new FractalEvidenceError('unavailable-fractal-node', nodeUnavailable);
  }

  /** @asyncSafe */
  public async $getTransaction(_txid: string): Promise<FractalTransactionView | null> {
    throw new FractalEvidenceError('unavailable-fractal-node', nodeUnavailable);
  }

  /** @asyncSafe */
  public async $getCat20Tokens(): Promise<Cat20Token[]> {
    throw new FractalEvidenceError('unavailable-cat20-indexer', cat20Unavailable);
  }

  /** @asyncSafe */
  public async $getCat20Token(_tokenId: string): Promise<Cat20Token | null> {
    throw new FractalEvidenceError('unavailable-cat20-indexer', cat20Unavailable);
  }

  /** @asyncSafe */
  public async $getCat20Holders(_tokenId: string): Promise<Cat20Holder[]> {
    throw new FractalEvidenceError('unavailable-cat20-indexer', cat20Unavailable);
  }
}

export const fractalService = new FractalService();
