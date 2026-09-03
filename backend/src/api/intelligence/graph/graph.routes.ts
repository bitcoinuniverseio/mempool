import { Application, Request, Response } from 'express';
import { txGraphService } from './tx-graph.service';
import { handleError } from '../../../utils/api';

class GraphRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/graph/';

    app
      .post(prefix + 'queries', this.$postQuery)
      .get(prefix + 'queries/:id', this.$getQuery)
      .post(prefix + 'paths', this.$postPaths)
      .post(prefix + 'exports', this.$postExports)
      .get(prefix + 'cases', this.$getCases)
      .post(prefix + 'cases', this.$postCase)
      .patch(prefix + 'cases/:id', this.$patchCase)
      .delete(prefix + 'cases/:id', this.$deleteCase);
  }

  private async $postQuery(req: Request, res: Response): Promise<void> {
    try {
      const root = String(req.body.root_entity || '');
      const hops = req.body.hops !== undefined ? parseInt(req.body.hops, 10) : 2;
      const direction = req.body.direction || 'both';
      const minValue = req.body.min_value_sats !== undefined ? parseInt(req.body.min_value_sats, 10) : 0;

      if (!root) {
        res.status(400).json({ error: 'root_entity parameter required.' });
        return;
      }

      const result = txGraphService.queryGraph(root, hops, direction, minValue);
      res.json(result);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Graph query failed');
    }
  }

  private async $getQuery(req: Request, res: Response): Promise<void> {
    try {
      const result = txGraphService.queryGraph(req.params.id, 2);
      res.json(result);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Graph query lookup failed');
    }
  }

  private async $postPaths(req: Request, res: Response): Promise<void> {
    try {
      const from = String(req.body.from_entity || '');
      const to = String(req.body.to_entity || '');
      if (!from || !to) {
        res.status(400).json({ error: 'from_entity and to_entity parameters required.' });
        return;
      }
      const pathResult = txGraphService.findShortestPath(from, to);
      res.json(pathResult);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Path search failed');
    }
  }

  private async $postExports(req: Request, res: Response): Promise<void> {
    try {
      const format = req.body.format || 'json';
      res.json({
        export_id: 'exp-' + Date.now(),
        status: 'ready',
        format,
        download_url: `/api/v1/intelligence/graph/queries/${req.body.query_id || 'root'}?format=${format}`,
      });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Export failed');
    }
  }

  private async $getCases(req: Request, res: Response): Promise<void> {
    try {
      const userId = String(req.query.user_id || 'user-default');
      const cases = txGraphService.getCases(userId);
      res.json({ cases, count: cases.length });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch graph cases');
    }
  }

  private async $postCase(req: Request, res: Response): Promise<void> {
    try {
      const { user_id, title, root_entity, hops, filters, layout, notes } = req.body;
      const saved = txGraphService.saveCase(
        user_id || 'user-default',
        title || 'Untitled Case',
        root_entity || 'unknown',
        hops || 2,
        filters || {},
        layout || {},
        notes || ''
      );
      res.json(saved);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to save graph case');
    }
  }

  private async $patchCase(req: Request, res: Response): Promise<void> {
    try {
      const updated = txGraphService.updateCase(req.params.id, req.body);
      if (!updated) {
        res.status(404).json({ error: `Case '${req.params.id}' not found.` });
        return;
      }
      res.json(updated);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to update graph case');
    }
  }

  private async $deleteCase(req: Request, res: Response): Promise<void> {
    try {
      const deleted = txGraphService.deleteCase(req.params.id);
      res.json({ deleted });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to delete graph case');
    }
  }
}

export default new GraphRoutes();
