import { Application, Request, Response } from 'express';
import config from '../../config';
import { handleError } from '../../utils/api';
import { LiquidObservatoryEvidenceError, liquidObservatoryService } from './liquid-observatory.service';
import { configuredLiquidPairProfile } from './liquid-paired-source';
import { elementsNodeSource } from './elements-node-source';

function fail(req: Request, res: Response, e: unknown): void {
  if (res.destroyed || res.headersSent) return;
  if (e instanceof LiquidObservatoryEvidenceError) { res.status(e.status).json({ stage: e.code, error: e.message }); return; }
  handleError(req, res, 500, e instanceof Error ? e.message : 'The request could not be served');
}
function selectors(req: Request, pagination = false): { offset: number; limit: number } {
  const query = req.query || {}, allowed = pagination ? ['network', 'offset', 'limit'] : ['network'];
  if (Object.keys(query).some(key => !allowed.includes(key))) throw new LiquidObservatoryEvidenceError('invalid-query', 'Unsupported public Liquid query selector.', 400);
  if (query.network !== undefined) {
    if (typeof query.network !== 'string' || !['liquidv1', 'liquidtestnet', 'elementsregtest'].includes(query.network)) throw new LiquidObservatoryEvidenceError('invalid-liquid-network', 'A single explicit Liquid network selector is required.', 400);
    if (query.network !== configuredLiquidPairProfile().network) throw new LiquidObservatoryEvidenceError('liquid-network-mismatch', 'The requested network does not match the operator-bound Liquid pair.', 409);
  }
  const number = (key: string, fallback: number): number => {
    const value = query[key];
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,5})$/.test(value)) throw new LiquidObservatoryEvidenceError('invalid-liquid-pagination', 'A single canonical integer pagination selector is required.', 400);
    return Number(value);
  };
  return { offset: number('offset', 0), limit: number('limit', 100) };
}
/** A disconnected request cannot advance durable partial acquisition. @asyncSafe */
async function bounded(req: Request, res: Response, read: (signal: AbortSignal) => Promise<unknown>): Promise<void> {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
  const abort = (): void => controller.abort(), closed = (): void => { if (!res.writableEnded) abort(); };
  req.once('aborted', abort); res.once('close', closed);
  try { const result = await read(controller.signal); if (!controller.signal.aborted && !res.destroyed) res.json(result); else if (!res.destroyed) throw new LiquidObservatoryEvidenceError('liquid-source-deadline', 'The bounded Liquid read exceeded its deadline.', 504); }
  catch (error) { fail(req, res, error); }
  finally { clearTimeout(timeout); req.removeListener('aborted', abort); res.removeListener('close', closed); }
}
class LiquidObservatoryRoutes {
  public initRoutes(app: Application): void {
    const prefix = config.MEMPOOL.API_URL_PREFIX + 'liquid/observatory/';
    app.get(prefix + 'node', this.$getNode)
      .get(prefix + 'summary', this.$getSummary).get(prefix + 'assets', this.$getAssets)
      .get(prefix + 'assets/:assetId', this.$getAsset).get(prefix + 'pegs', this.$getPegs)
      .get(prefix + 'federation', this.$getFederation).get(prefix + 'projection', this.$getProjection)
      .post(prefix + 'projection/advance', this.$advanceProjection);
  }
  private async $getNode(req: Request, res: Response): Promise<void> {
    try {
      if (Object.keys(req.query || {}).some(key => key !== 'network')) throw new LiquidObservatoryEvidenceError('invalid-query', 'Only the public network selector is accepted.', 400);
      const network = req.query?.network;
      if (network !== undefined && (typeof network !== 'string' || !['liquidv1', 'liquidtestnet', 'elementsregtest'].includes(network))) {
        throw new LiquidObservatoryEvidenceError('invalid-liquid-network', 'A single supported Liquid network selector is required.', 400);
      }
      res.json(await elementsNodeSource.snapshot(network === undefined ? 'liquidv1' : network as string));
    } catch (e) { fail(req, res, e); }
  }
  private async $getSummary(req: Request, res: Response): Promise<void> {
    await bounded(req, res, async signal => { selectors(req); return liquidObservatoryService.$getSummary(signal); });
  }
  private async $getAssets(req: Request, res: Response): Promise<void> {
    await bounded(req, res, async signal => { const page = selectors(req, true); return liquidObservatoryService.$getAssets(page.offset, page.limit, signal); });
  }
  private async $getAsset(req: Request, res: Response): Promise<void> {
    await bounded(req, res, async signal => {
      selectors(req);
      let asset;
      try { asset = await liquidObservatoryService.$getAsset(req.params.assetId, signal); }
      catch (error) { throw error; }
      if (!asset) { res.status(404); return { error: 'asset-not-in-publication', scope: 'operator-published-catalog' }; }
      return asset;
    });
  }
  private async $getPegs(req: Request, res: Response): Promise<void> {
    await bounded(req, res, async signal => { const page = selectors(req, true); return liquidObservatoryService.$getPegs(page.offset, page.limit, signal); });
  }
  private async $getFederation(req: Request, res: Response): Promise<void> {
    await bounded(req, res, async signal => { selectors(req); return liquidObservatoryService.$getFederation(signal); });
  }
  private async $getProjection(req: Request, res: Response): Promise<void> {
    await bounded(req, res, async signal => { selectors(req); return liquidObservatoryService.$getProjection(signal); });
  }
  private async $advanceProjection(req: Request, res: Response): Promise<void> {
    await bounded(req, res, async signal => {
      selectors(req);
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).sort().join(',') !== 'blockHash,height') throw new LiquidObservatoryEvidenceError('invalid-liquid-cursor', 'Supply only the last observed height and blockHash cursor.', 400);
      return liquidObservatoryService.$advanceProjection(req.body.height, req.body.blockHash, signal);
    });
  }
}
export default new LiquidObservatoryRoutes();
