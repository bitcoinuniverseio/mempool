import { Application, Request, Response } from 'express';
import { QueryStudioEvidenceError, queryStudioService, usageMetricsUnavailable } from './query-studio.service';
import { developerIdentity, IdentityError } from '../identity/developer-identity';
import { ownerOf, requireOwner, sendIdentityError } from '../identity/owner-auth';
import { handleError } from '../../../utils/api';

/** An absent source is a 503 that names the source, never a 500 and never an invented row. */
function fail(req: Request, res: Response, e: unknown, status: number, fallback: string): void {
  if (e instanceof QueryStudioEvidenceError) {
    res.status(e.status).json({ stage: e.code, error: e.message });
    return;
  }
  if (e instanceof IdentityError) {
    sendIdentityError(res, e, fallback);
    return;
  }
  handleError(req, res, status, e instanceof Error ? e.message : fallback);
}

/**
 * Developer platform and Query Studio.
 *
 * Identity: POST developer/owners creates a new owner and returns its first
 * key once; every other developer, webhook, saved-query route requires that
 * key. There is no user_id anywhere; the owner is who holds the key.
 */
class QueryStudioRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/';

    app
      .post(prefix + 'developer/owners', this.$postOwner)
      .post(prefix + 'developer/keys', requireOwner('keys:manage'), this.$postKey)
      .get(prefix + 'developer/keys', requireOwner(), this.$getKeys)
      .delete(prefix + 'developer/keys/:id', requireOwner('keys:manage'), this.$deleteKey)
      .get(prefix + 'developer/usage', requireOwner(), this.$getUsage)
      .post(prefix + 'developer/webhooks', requireOwner('webhooks'), this.$postWebhook)
      .get(prefix + 'developer/webhooks', requireOwner('webhooks'), this.$getWebhooks)
      .get(prefix + 'developer/webhooks/:id/attempts', requireOwner('webhooks'), this.$getWebhookAttempts)
      .post(prefix + 'query/execute', this.$postExecute)
      .get(prefix + 'query/schema', this.$getSchema)
      .get(prefix + 'query/history', this.$getHistory)
      .post(prefix + 'query/saved', requireOwner('queries'), this.$postSaveQuery)
      .get(prefix + 'query/saved', requireOwner('queries'), this.$getSavedQueries);
  }

  private async $postOwner(req: Request, res: Response): Promise<void> {
    try {
      const key = await developerIdentity.bootstrapOwner(req.body?.name ?? req.body?.label, req.ip || req.socket.remoteAddress || 'unknown');
      res.status(201).json({ ...key, storage: 'durable' });
    } catch (e) {
      fail(req, res, e, 500, 'Owner creation failed');
    }
  }

  private async $postKey(req: Request, res: Response): Promise<void> {
    try {
      const { label, name, scopes, rate_limit, expires_in_days } = req.body ?? {};
      const key = await developerIdentity.generateApiKey(ownerOf(res), name ?? label, scopes, rate_limit !== undefined ? Number(rate_limit) : undefined, expires_in_days !== undefined ? Number(expires_in_days) : undefined);
      res.status(201).json(key);
    } catch (e) {
      fail(req, res, e, 500, 'API key generation failed');
    }
  }

  private async $getKeys(req: Request, res: Response): Promise<void> {
    try {
      const keys = await developerIdentity.listKeys(ownerOf(res));
      res.json({ keys, count: keys.length });
    } catch (e) {
      fail(req, res, e, 500, 'Failed to fetch keys');
    }
  }

  private async $deleteKey(req: Request, res: Response): Promise<void> {
    try {
      const revoked = await developerIdentity.revokeApiKey(ownerOf(res), req.params.id);
      if (!revoked) {
        res.status(404).json({ error: 'Key not found.' });
        return;
      }
      res.json({ revoked: true });
    } catch (e) {
      fail(req, res, e, 500, 'Failed to revoke key');
    }
  }

  private async $getUsage(req: Request, res: Response): Promise<void> {
    try {
      throw new QueryStudioEvidenceError('unavailable-usage-metrics', usageMetricsUnavailable);
    } catch (e) {
      fail(req, res, e, 500, 'Failed to fetch usage metrics');
    }
  }

  private async $postWebhook(req: Request, res: Response): Promise<void> {
    try {
      const { target_url, events } = req.body ?? {};
      const webhook = await developerIdentity.registerWebhook(ownerOf(res), target_url, events ?? ['watchlist.notification']);
      res.status(201).json(webhook);
    } catch (e) {
      fail(req, res, e, 400, 'Failed to register webhook');
    }
  }

  private async $getWebhooks(req: Request, res: Response): Promise<void> {
    try {
      const webhooks = await developerIdentity.listWebhooks(ownerOf(res));
      res.json({ webhooks, count: webhooks.length });
    } catch (e) {
      fail(req, res, e, 500, 'Failed to fetch webhooks');
    }
  }

  private async $getWebhookAttempts(req: Request, res: Response): Promise<void> {
    try {
      const attempts = await developerIdentity.listAttempts(ownerOf(res), req.params.id);
      if (attempts === null) {
        res.status(404).json({ error: 'Webhook not found.' });
        return;
      }
      res.json({ attempts, count: attempts.length });
    } catch (e) {
      fail(req, res, e, 500, 'Failed to fetch delivery attempts');
    }
  }

  private async $postExecute(req: Request, res: Response): Promise<void> {
    try {
      const sql = String(req.body?.sql || '');
      const maxRows = req.body?.max_rows !== undefined ? parseInt(req.body.max_rows, 10) : 100;
      if (!sql) {
        res.status(400).json({ error: 'sql parameter required.' });
        return;
      }
      const result = queryStudioService.executeQuery(sql, maxRows);
      res.json(result);
    } catch (e) {
      fail(req, res, e, 400, 'Query execution error');
    }
  }

  private async $getSchema(req: Request, res: Response): Promise<void> {
    try {
      const schema = queryStudioService.getSchema();
      res.json({ tables: schema, count: schema.length });
    } catch (e) {
      fail(req, res, e, 500, 'Failed to fetch schema');
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
      const { title, sql } = req.body ?? {};
      const saved = await queryStudioService.saveQuery(ownerOf(res), title, sql);
      res.status(201).json(saved);
    } catch (e) {
      fail(req, res, e, 500, 'Failed to save query');
    }
  }

  private async $getSavedQueries(req: Request, res: Response): Promise<void> {
    try {
      const rawLimit=req.query.limit, cursor=req.query.cursor;
      if(rawLimit!==undefined&&(typeof rawLimit!=='string'||!/^[1-9][0-9]{0,2}$/.test(rawLimit))||cursor!==undefined&&typeof cursor!=='string')throw new IdentityError('invalid_page','Invalid saved-query pagination input.',400);
      res.json(await queryStudioService.getSavedQueryPage(ownerOf(res),rawLimit===undefined?200:Number(rawLimit),cursor as string|undefined));
    } catch (e) {
      fail(req, res, e, 500, 'Failed to fetch saved queries');
    }
  }
}

export default new QueryStudioRoutes();
