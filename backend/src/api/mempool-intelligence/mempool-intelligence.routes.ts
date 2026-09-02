import { Application, Request, Response } from 'express';
import config from '../../config';
import mempool from '../mempool';
import { handleError } from '../../utils/api';
import intelligence from './mempool-intelligence';
import { $simulate, validateRawTxs } from './package-service';

const TXID = /^[a-f0-9]{64}$/i;

/** Largest page a caller may ask for, so one request cannot walk the mempool. */
export const MAX_LIMIT = 200;
export const DEFAULT_LIMIT = 50;

/**
 * Reads a bounded non negative integer from a query string.
 *
 * An absent value takes the default. A malformed one is refused rather than
 * silently coerced, because a caller who sent `limit=abc` and got fifty rows
 * has been told their request was understood when it was not.
 */
export function readBound(
  raw: unknown,
  fallback: number,
  max: number,
): number | null {
  if (raw === undefined || raw === null || raw === '') { return fallback; }
  if (typeof raw !== 'string') { return null; }
  if (!/^[0-9]{1,9}$/.test(raw)) { return null; }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > max) { return null; }
  return value;
}

/**
 * The cluster, chunk and fee rate diagram routes.
 *
 * Everything answered here is derived from the mempool this process already
 * holds, so no route costs a Bitcoin Core RPC call. Each answer carries the
 * age of the snapshot it was built from, because a cluster is a live thing and
 * a reader who is not told how old the answer is will assume it is current.
 */
class MempoolIntelligenceRoutes {
  public initRoutes(app: Application): void {
    const prefix = config.MEMPOOL.API_URL_PREFIX;
    app
      .get(prefix + 'mempool/clusters', this.getClusters)
      .get(prefix + 'mempool/clusters/:reference', this.getCluster)
      .get(prefix + 'mempool/feerate-diagram', this.getDiagram)
      .get(prefix + 'mempool/packages/:txid', this.getPackage)
      .post(prefix + 'mempool/simulate', this.$simulatePackage);
  }

  /**
   * Clusters are live, so the cache window matches the freshness budget the
   * service works to rather than the longer window immutable data gets.
   */
  private static setLiveCache(res: Response): void {
    res.header('Pragma', 'public');
    res.header('Cache-control', 'public, max-age=5');
    res.setHeader('Expires', new Date(Date.now() + 5000).toUTCString());
  }

  private getClusters(req: Request, res: Response): void {
    try {
      const offset = readBound(req.query.offset, 0, 1_000_000);
      const limit = readBound(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
      if (offset === null) {
        handleError(req, res, 400, 'offset must be a whole number');
        return;
      }
      if (limit === null || limit === 0) {
        handleError(req, res, 400, `limit must be a whole number from 1 to ${MAX_LIMIT}`);
        return;
      }
      // `minTxCount=2` is how the packages page asks for only the clusters
      // that actually have a dependency in them.
      const minTxCount = readBound(req.query.minTxCount, 1, 1000);
      if (minTxCount === null || minTxCount === 0) {
        handleError(req, res, 400, 'minTxCount must be a whole number of at least 1');
        return;
      }
      const result = intelligence.listClusters(
        mempool.getMempool(), offset, limit, Date.now(), minTxCount,
      );
      MempoolIntelligenceRoutes.setLiveCache(res);
      res.json(result);
    } catch (e) {
      handleError(req, res, 500, 'Failed to build the mempool clusters');
    }
  }

  private getCluster(req: Request, res: Response): void {
    try {
      const reference = req.params.reference;
      if (!TXID.test(reference)) {
        handleError(req, res, 400, 'A cluster is addressed by a 64 character transaction id');
        return;
      }
      const found = intelligence.getCluster(mempool.getMempool(), reference.toLowerCase());
      if (!found) {
        // A cluster only exists while its members are unconfirmed. Saying so
        // is different from saying the id was never valid, so the message
        // names the reason rather than the status alone.
        handleError(req, res, 404, 'No unconfirmed cluster holds that transaction');
        return;
      }
      MempoolIntelligenceRoutes.setLiveCache(res);
      res.json({ cluster: found.cluster, freshness: found.freshness });
    } catch (e) {
      handleError(req, res, 500, 'Failed to build that mempool cluster');
    }
  }

  private getDiagram(req: Request, res: Response): void {
    try {
      const result = intelligence.getDiagram(mempool.getMempool());
      MempoolIntelligenceRoutes.setLiveCache(res);
      res.json(result);
    } catch (e) {
      handleError(req, res, 500, 'Failed to build the fee rate diagram');
    }
  }

  private getPackage(req: Request, res: Response): void {
    try {
      const txid = req.params.txid;
      if (!TXID.test(txid)) {
        handleError(req, res, 400, 'A transaction id is 64 hexadecimal characters');
        return;
      }
      const found = intelligence.getPackageFor(mempool.getMempool(), txid.toLowerCase());
      if (!found) {
        handleError(req, res, 404, 'That transaction is not in this node mempool');
        return;
      }
      MempoolIntelligenceRoutes.setLiveCache(res);
      res.json({ cluster: found.cluster, freshness: found.freshness });
    } catch (e) {
      handleError(req, res, 500, 'Failed to build that package');
    }
  }

  /**
   * Says what this node would do with a package, without sending it.
   *
   * Not cached, and explicitly so. The answer depends on the mempool at this
   * instant, and a cached verdict on a replacement is a verdict about a
   * conflict that may already be gone.
   */
  private async $simulatePackage(req: Request, res: Response): Promise<void> {
    const invalid = validateRawTxs(req.body?.rawTxs);
    if (invalid) {
      handleError(req, res, invalid.status, invalid.message);
      return;
    }
    try {
      const simulation = await $simulate(req.body.rawTxs as string[]);
      res.header('Cache-control', 'no-store');
      res.json(simulation);
    } catch (e: any) {
      // A transaction the node cannot decode is the caller's error, not this
      // service failing, and it is reported as the former with the node's own
      // words rather than as an opaque five hundred.
      const message = typeof e?.message === 'string' ? e.message : '';
      if (/decode|deserial|malformed|hex/i.test(message)) {
        handleError(req, res, 400, `The node could not read one of these transactions: ${message}`);
        return;
      }
      handleError(req, res, 500, 'Failed to simulate that package');
    }
  }
}

export default new MempoolIntelligenceRoutes();
