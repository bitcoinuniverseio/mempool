import { Application, Request, Response } from 'express';
import config from '../../config';
import { handleError } from '../../utils/api';
import { L2ObservatoryEvidenceError, l2ObservatoryService } from './l2-observatory.service';

/** An absent source is a 503 that names the source, never a 500 and never an empty list. */
function fail(req: Request, res: Response, e: unknown): void {
  if (e instanceof L2ObservatoryEvidenceError) {
    res.status(e.status).json({ stage: e.code, error: e.message });
    return;
  }
  handleError(req, res, 500, e instanceof Error ? e.message : 'The request could not be served');
}

class L2ObservatoryRoutes {
  public initRoutes(app: Application): void {
    const prefix = config.MEMPOOL.API_URL_PREFIX + 'l2/';

    app
      .get(prefix + 'systems', this.$getSystems)
      .get(prefix + 'systems/:systemId', this.$getSystem)
      .get(prefix + 'challenges', this.$getChallenges)
      .get(prefix + 'reserves/:systemId', this.$getReserveAudit);
  }

  private async $getSystems(req: Request, res: Response): Promise<void> {
    try {
      const systems = await l2ObservatoryService.$getSystems();
      res.json({ systems, total: systems.length });
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getSystem(req: Request, res: Response): Promise<void> {
    try {
      const system = await l2ObservatoryService.$getSystem(req.params.systemId);
      if (!system) {
        res.status(404).json({ error: 'l2-system-not-found' });
        return;
      }
      res.json(system);
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getChallenges(req: Request, res: Response): Promise<void> {
    try {
      const systemId = req.query.systemId as string | undefined;
      const challenges = await l2ObservatoryService.$getChallenges(systemId);
      res.json({ challenges, total: challenges.length });
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getReserveAudit(req: Request, res: Response): Promise<void> {
    try {
      const audit = await l2ObservatoryService.$getReserveAudit(req.params.systemId);
      if (!audit) {
        res.status(404).json({ error: 'l2-reserve-audit-not-found' });
        return;
      }
      res.json(audit);
    } catch (e) {
      fail(req, res, e);
    }
  }
}

export default new L2ObservatoryRoutes();
