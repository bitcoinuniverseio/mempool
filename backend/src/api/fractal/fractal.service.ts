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
export class FractalService {
  /* IMPLEMENTATION-HANDOFF [WP-BE-007]
   * Defect BE-007; COV-BE-007 tip, mempool, block, transaction, CAT20 token
   * list/detail/holders. All seven methods always throw; production environment
   * variables cannot complete an adapter that does not exist. See the current
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
   * Preparation only; no executable integration or deployment is changed.
   */
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
