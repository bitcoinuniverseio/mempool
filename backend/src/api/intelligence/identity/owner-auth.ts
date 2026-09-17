import { NextFunction, Request, Response } from 'express';
import { AuthenticatedOwner, developerIdentity, IdentityError } from './developer-identity';
import { ownerUsageLedger } from './owner-usage-ledger';

/**
 * Owner authentication for the intelligence surfaces.
 *
 * The owner is the owner of the API key that signed the request, read from
 * `Authorization: Bearer uip_live_...` or `X-Api-Key`. A `user_id` in a body
 * or query string is never an identity. Missing or bad keys answer 401 with
 * no detail about which part was wrong; a key without the needed scope
 * answers 403.
 */
export function bearerFromRequest(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header === 'string' && /^bearer\s+/i.test(header)) {
    return header.replace(/^bearer\s+/i, '').trim() || null;
  }
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.trim()) {
    return apiKey.trim();
  }
  return null;
}

export function ownerOf(res: Response): AuthenticatedOwner {
  const owner = res.locals.owner as AuthenticatedOwner | undefined;
  if (!owner) { throw new IdentityError('unauthenticated', 'authentication required', 401); }
  return owner;
}

export function requireOwner(scope?: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const secret = bearerFromRequest(req);
      const owner = secret ? await developerIdentity.authenticateKey(secret) : null;
      if (!owner) {
        res.status(401).json({ error: 'A valid API key is required.', code: 'unauthenticated' });
        return;
      }
      if (scope && !owner.scopes.includes('*') && !owner.scopes.includes(scope)) {
        res.status(403).json({ error: `This key lacks the ${scope} scope.`, code: 'forbidden' });
        return;
      }
      res.locals.owner = owner;
      recordOwnerUsage(res, owner);
      next();
    } catch (error) {
      res.status(503).json({ error: 'Owner authentication is unavailable: ' + (error instanceof Error ? error.message : String(error)), code: 'auth_unavailable' });
    }
  };
}

/** Counts the authenticated request in the owned usage ledger once its response has finished. */
export function recordOwnerUsage(res: Response, owner: AuthenticatedOwner, startedAt = Date.now()): void {
  if (typeof res.once !== 'function') { return; }
  res.once('finish', () => { ownerUsageLedger.record(owner.owner_id, owner.key_id, res.statusCode, Date.now() - startedAt); });
}

/** Maps an IdentityError to its status and a plain body; anything else is a 500. */
export function sendIdentityError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof IdentityError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  res.status(500).json({ error: error instanceof Error ? error.message : fallback });
}
