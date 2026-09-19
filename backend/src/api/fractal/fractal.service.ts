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
