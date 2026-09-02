import { Application, Request, Response } from 'express';
import config from '../../config';
import { handleError } from '../../utils/api';
import bitcoinClient from '../bitcoin/bitcoin-client';
import { $nodeOverview } from './node-console';
import {
  ALLOWED_METHODS,
  methodNamed,
  readArguments,
  type AllowedMethod,
} from './rpc-allowlist';

/**
 * The public, read only view of this node.
 *
 * The interesting route here is the last one, and what makes it safe is not
 * this file. It is `rpc-allowlist.ts`: a method absent from that file has no
 * path to a call, because the only way a name becomes a call is by matching
 * an entry there and then being invoked through the entry's own recorded
 * client method. There is no string interpolation into a method name
 * anywhere in this file, and there must never be.
 *
 * The trimming happens here too, before the answer is serialized, so a
 * change that forgot it would show up as a redaction test failure rather
 * than as an address on a public page.
 */

/** Calls a minute, per method, before the route starts refusing. */
export const RATE_LIMIT_PER_MINUTE = 30;

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * A per method budget, so one expensive method cannot be hammered.
 *
 * Deliberately in memory and deliberately per process. It exists to stop a
 * page or a script from making the node's RPC budget its own, not to stop a
 * determined attacker, and a shared store for that would be a dependency
 * this route does not otherwise need.
 */
const buckets = new Map<string, Bucket>();

export function takeToken(method: string, now: number = Date.now()): boolean {
  const bucket = buckets.get(method);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(method, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_PER_MINUTE) { return false; }
  bucket.count += 1;
  return true;
}

/** Forgets every budget. For tests, so one does not leak into the next. */
export function resetRateLimits(): void {
  buckets.clear();
}

/** The catalog, without the functions, which do not serialize. */
export function catalogOf(methods: readonly AllowedMethod[] = ALLOWED_METHODS): unknown[] {
  return methods.map((method) => ({
    name: method.name,
    category: method.category,
    summary: method.summary,
    params: method.params,
    immutable: method.immutable,
    redacted: method.redact !== undefined,
    redactionNote: method.redactionNote ?? null,
  }));
}

class NodeConsoleRoutes {
  public initRoutes(app: Application): void {
    const prefix = config.MEMPOOL.API_URL_PREFIX;
    app
      .get(prefix + 'node/overview', this.$getOverview)
      .get(prefix + 'node/rpc/catalog', this.getCatalog)
      .post(prefix + 'node/rpc', this.$callMethod);
  }

  /**
   * The overview changes with the node, so it is cached briefly rather than
   * not at all. Ten seconds is well under a block and well over the time a
   * page takes to load its own panels.
   */
  private static setShortCache(res: Response): void {
    res.header('Pragma', 'public');
    res.header('Cache-control', 'public, max-age=10');
  }

  private async $getOverview(req: Request, res: Response): Promise<void> {
    try {
      const overview = await $nodeOverview();
      NodeConsoleRoutes.setShortCache(res);
      res.json(overview);
    } catch (e) {
      // Every section catches its own failure, so reaching here means the
      // assembly itself broke rather than the node being quiet.
      handleError(req, res, 500, 'Failed to describe this node');
    }
  }

  /**
   * The catalog is the allowlist itself, which changes only when the build
   * does, so it is cached for an hour.
   */
  private getCatalog(req: Request, res: Response): void {
    res.header('Cache-control', 'public, max-age=3600');
    res.json({
      methods: catalogOf(),
      note: 'These are the only node methods this route will call. Anything else is refused, including methods that merely read, when they describe this process rather than the chain or when their cost is unbounded.',
    });
  }

  private async $callMethod(req: Request, res: Response): Promise<void> {
    const method = methodNamed(req.body?.method);
    if (!method) {
      // The same answer for a method that exists in Core but is not allowed
      // and for one that does not exist at all. Telling them apart would
      // turn this route into a way to enumerate the node's build.
      handleError(req, res, 400, 'That is not a method this route will call. GET node/rpc/catalog lists the ones it will.');
      return;
    }
    const args = readArguments(method, req.body?.args);
    if (!Array.isArray(args)) {
      handleError(req, res, 400, args.message);
      return;
    }
    if (!takeToken(method.name)) {
      handleError(req, res, 429, `Too many calls to ${method.name}. This route allows ${RATE_LIMIT_PER_MINUTE} a minute for each method.`);
      return;
    }
    try {
      // The only invocation in this file, and it goes through the client
      // method the allowlist entry recorded. No name from the request ever
      // reaches this line.
      const client = bitcoinClient as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
      const call = client[method.clientMethod];
      if (typeof call !== 'function') {
        handleError(req, res, 501, `This deployment's node client does not implement ${method.name}.`);
        return;
      }
      const raw = await call.apply(bitcoinClient, args);
      const result = method.redact ? method.redact(raw) : raw;
      res.header('Cache-control', method.immutable ? 'public, max-age=3600' : 'no-store');
      res.json({
        method: method.name,
        args,
        result,
        redacted: method.redact !== undefined,
        redactionNote: method.redactionNote ?? null,
      });
    } catch (e: any) {
      // The node's own words, which are what a reader came for, bounded so a
      // long rejection cannot itself become the payload.
      const message = typeof e?.message === 'string' ? e.message.slice(0, 500) : '';
      handleError(req, res, 400, message
        ? `The node refused: ${message}`
        : 'The node did not answer that call.');
    }
  }
}

export default new NodeConsoleRoutes();
