import { Application, Request, Response } from 'express';
import { queryStudioService } from './query-studio.service';
import { DeveloperIdentityManager } from '../identity/developer-identity';
import { handleError } from '../../../utils/api';

class QueryStudioRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/';

    app
      .post(prefix + 'developer/keys', this.$postKey)
      .get(prefix + 'developer/keys', this.$getKeys)
      .delete(prefix + 'developer/keys/:id', this.$deleteKey)
      .get(prefix + 'developer/usage', this.$getUsage)
      .post(prefix + 'developer/webhooks', this.$postWebhook)
      .get(prefix + 'developer/webhooks', this.$getWebhooks)
      .post(prefix + 'query/execute', this.$postExecute)
      .get(prefix + 'query/schema', this.$getSchema)
      .get(prefix + 'query/history', this.$getHistory)
      .post(prefix + 'query/saved', this.$postSaveQuery)
      .get(prefix + 'query/saved', this.$getSavedQueries);
  }

  private async $postKey(req: Request, res: Response): Promise<void> {
    try {
      const { user_id, label, scopes } = req.body;
      const keyData = DeveloperIdentityManager.generateApiKey(
        user_id || 'dev-default',
        label || 'Default Key',
        scopes || ['read']
      );
      res.json(keyData);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'API key generation failed');
    }
  }

  private async $getKeys(req: Request, res: Response): Promise<void> {
    try {
      const userId = String(req.query.user_id || 'dev-default');
      const keys = DeveloperIdentityManager.getUserKeys(userId);
      res.json({ keys, count: keys.length });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch keys');
    }
  }

  private async $deleteKey(req: Request, res: Response): Promise<void> {
    try {
      const revoked = DeveloperIdentityManager.revokeApiKey(req.params.id);
      res.json({ revoked });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to revoke key');
    }
  }

  private async $getUsage(req: Request, res: Response): Promise<void> {
    try {
      res.json({
        period: '30d',
        requests_total: 124500,
        requests_remaining: 875500,
        quota_limit: 1000000,
        p95_latency_ms: 42,
        error_rate_percent: 0.02,
      });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch usage metrics');
    }
  }

  private async $postWebhook(req: Request, res: Response): Promise<void> {
    try {
      const { user_id, target_url, events } = req.body;
      const webhook = DeveloperIdentityManager.registerWebhook(
        user_id || 'dev-default',
        target_url,
        events || ['mempool.evaluated']
      );
      res.json(webhook);
    } catch (e) {
      handleError(req, res, 400, e instanceof Error ? e.message : 'Failed to register webhook');
    }
  }

  private async $getWebhooks(req: Request, res: Response): Promise<void> {
    try {
      const userId = String(req.query.user_id || 'dev-default');
      const hooks = DeveloperIdentityManager.getUserWebhooks(userId);
      res.json({ webhooks: hooks, count: hooks.length });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch webhooks');
    }
  }

  private async $postExecute(req: Request, res: Response): Promise<void> {
    try {
      const sql = String(req.body.sql || '');
      const maxRows = req.body.max_rows !== undefined ? parseInt(req.body.max_rows, 10) : 100;
      if (!sql) {
        res.status(400).json({ error: 'sql parameter required.' });
        return;
      }
      const result = queryStudioService.executeQuery(sql, maxRows);
      res.json(result);
    } catch (e) {
      handleError(req, res, 400, e instanceof Error ? e.message : 'Query execution error');
    }
  }

  private async $getSchema(req: Request, res: Response): Promise<void> {
    try {
      const schema = queryStudioService.getSchema();
      res.json({ tables: schema, count: schema.length });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch schema');
    }
  }

  private async $getHistory(req: Request, res: Response): Promise<void> {
    try {
      const history = queryStudioService.getHistory();
      res.json({ history, count: history.length });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch query history');
    }
  }

  private async $postSaveQuery(req: Request, res: Response): Promise<void> {
    try {
      const { user_id, title, sql } = req.body;
      if (!sql || !title) {
        res.status(400).json({ error: 'title and sql required.' });
        return;
      }
      const saved = queryStudioService.saveQuery(user_id || 'dev-default', title, sql);
      res.json(saved);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to save query');
    }
  }

  private async $getSavedQueries(req: Request, res: Response): Promise<void> {
    try {
      const userId = String(req.query.user_id || 'dev-default');
      const queries = queryStudioService.getSavedQueries(userId);
      res.json({ saved_queries: queries, count: queries.length });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch saved queries');
    }
  }
}

export default new QueryStudioRoutes();
