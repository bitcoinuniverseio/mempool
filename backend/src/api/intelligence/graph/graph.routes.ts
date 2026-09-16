import { Application, Request, Response } from 'express';
import { GraphInputError, GraphIndexError, txGraphService } from './tx-graph.service';
import { ownerOf, requireOwner, sendIdentityError } from '../identity/owner-auth';
import { handleError } from '../../../utils/api';

function integerParameter(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) throw new GraphInputError('Expected an integer parameter');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new GraphInputError('Expected a safe integer parameter');
  return parsed;
}

/**
 * Graph queries and paths are public reads over the owned index. Saved
 * cases belong to an owner and need a key with the cases scope.
 */
class GraphRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/graph/';
    const guard = requireOwner('cases');

    app
      .post(prefix + 'queries', this.$postQuery)
      .get(prefix + 'queries/:id', this.$getQuery)
      .post(prefix + 'paths', this.$postPaths)
      .post(prefix + 'exports', this.$postExports)
      .get(prefix + 'cases', guard, this.$getCases)
      .post(prefix + 'cases', guard, this.$postCase)
      .get(prefix + 'cases/:id', guard, this.$getCase)
      .patch(prefix + 'cases/:id', guard, this.$patchCase)
      .delete(prefix + 'cases/:id', guard, this.$deleteCase);
  }

  private static fail(req: Request, res: Response, e: unknown, fallback: string): void {
    if (e instanceof GraphIndexError) {
      res.status(e.status).json({ error: e.message, code: e.status === 404 ? 'not_found' : 'index_unavailable' });
      return;
    }
    if (e instanceof GraphInputError) {
      res.status(400).json({ error: e.message, code: 'invalid_input' });
      return;
    }
    handleError(req, res, 500, e instanceof Error ? e.message : fallback);
  }

  private async $postQuery(req: Request, res: Response): Promise<void> {
    try {
      const root = String(req.body?.root_entity || '');
      const hops = integerParameter(req.body?.hops, 2);
      const direction = req.body?.direction || 'both';
      const minValue = integerParameter(req.body?.min_value_sats, 0);
      if (!root) {
        res.status(400).json({ error: 'root_entity parameter required.' });
        return;
      }
      res.json(await txGraphService.queryGraph(root, hops, direction, minValue));
    } catch (e) {
      GraphRoutes.fail(req, res, e, 'Graph query failed');
    }
  }

  private async $getQuery(req: Request, res: Response): Promise<void> {
    try {
      res.json(await txGraphService.queryGraph(req.params.id, 2));
    } catch (e) {
      GraphRoutes.fail(req, res, e, 'Graph query lookup failed');
    }
  }

  private async $postPaths(req: Request, res: Response): Promise<void> {
    try {
      const from = String(req.body?.from_entity || '');
      const to = String(req.body?.to_entity || '');
      if (!from || !to) {
        res.status(400).json({ error: 'from_entity and to_entity parameters required.' });
        return;
      }
      res.json(await txGraphService.findShortestPath(from, to));
    } catch (e) {
      GraphRoutes.fail(req, res, e, 'Path search failed');
    }
  }

  /**
   * An export is the query result itself, produced now. There is no export
   * queue, so nothing is reported as ready before it exists.
   */
  private async $postExports(req: Request, res: Response): Promise<void> {
    try {
      const format = String(req.body?.format || 'json');
      if (format !== 'json') {
        res.status(400).json({ error: 'Only json export is available.', code: 'unsupported_format' });
        return;
      }
      const root = String(req.body?.root_entity || req.body?.query_id || '');
      if (!root) {
        res.status(400).json({ error: 'root_entity parameter required.' });
        return;
      }
      const result = await txGraphService.queryGraph(root, integerParameter(req.body?.hops, 2), req.body?.direction || 'both', 0);
      res.setHeader('content-disposition', `attachment; filename="graph-${root.slice(0, 16)}.json"`);
      res.json({ format, exported_at: new Date().toISOString(), graph: result });
    } catch (e) {
      GraphRoutes.fail(req, res, e, 'Export failed');
    }
  }

  private async $getCases(req: Request, res: Response): Promise<void> {
    try {
      const cases = await txGraphService.getCases(ownerOf(res));
      res.json({ cases, count: cases.length });
    } catch (e) {
      sendIdentityError(res, e, 'Failed to fetch graph cases');
    }
  }

  private async $getCase(req: Request, res: Response): Promise<void> {
    try {
      const found = await txGraphService.getCaseById(ownerOf(res), req.params.id);
      if (!found) { res.status(404).json({ error: `Case '${req.params.id}' not found.` }); return; }
      res.json(found);
    } catch (e) {
      sendIdentityError(res, e, 'Failed to fetch graph case');
    }
  }

  private async $postCase(req: Request, res: Response): Promise<void> {
    try {
      const { title, root_entity, hops, filters, layout, notes, nodes_count } = req.body ?? {};
      res.status(201).json(await txGraphService.saveCase(ownerOf(res), title, root_entity, hops, filters, layout, notes, nodes_count));
    } catch (e) {
      if (e instanceof GraphInputError) { res.status(400).json({ error: e.message, code: 'invalid_input' }); return; }
      sendIdentityError(res, e, 'Failed to save graph case');
    }
  }

  private async $patchCase(req: Request, res: Response): Promise<void> {
    try {
      const updated = await txGraphService.updateCase(ownerOf(res), req.params.id, req.body ?? {});
      if (!updated) { res.status(404).json({ error: `Case '${req.params.id}' not found.` }); return; }
      res.json(updated);
    } catch (e) {
      sendIdentityError(res, e, 'Failed to update graph case');
    }
  }

  private async $deleteCase(req: Request, res: Response): Promise<void> {
    try {
      const deleted = await txGraphService.deleteCase(ownerOf(res), req.params.id);
      if (!deleted) { res.status(404).json({ error: `Case '${req.params.id}' not found.` }); return; }
      res.json({ deleted: true });
    } catch (e) {
      sendIdentityError(res, e, 'Failed to delete graph case');
    }
  }
}

export default new GraphRoutes();
