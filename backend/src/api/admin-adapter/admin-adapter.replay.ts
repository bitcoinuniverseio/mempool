import config from '../../config';
import DB from '../../database';
import logger from '../../logger';
import redisCache from '../redis-cache';
import {
  ADMIN_NONCE_RETENTION_MS,
  AdminAdapterNonceStore,
  type AdminReplayClaim,
  type AdminReplayStore,
  UnavailableAdminReplayStore,
} from './admin-adapter.security';

/**
 * The shared replay stores behind the admin guard.
 *
 * A nonce is claimed once, for the whole freshness window, in a store every
 * backend worker shares. The MySQL store is preferred because the adapter
 * already needs the database for durable runs; Redis is the shared store when
 * the database is off; with neither the guard fails closed. The in-memory
 * store is only honoured on an explicit single-process opt-in, and is logged
 * as such, because it cannot stop a replay against a second process.
 */

export const ADMIN_REPLAY_STORE_ENVIRONMENT_VARIABLE = 'EXPLORER_ADMIN_REPLAY_STORE';

/** How often at most the MySQL store sweeps expired rows. */
const SWEEP_INTERVAL_MS = 60_000;

function isDuplicateKey(e: unknown): boolean {
  const error = e as { code?: string; errno?: number } | null;
  return error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062;
}

/** One row per claimed nonce in the owned database. */
export class MysqlAdminReplayStore implements AdminReplayStore {
  readonly kind = 'database';
  private lastSweepMs = 0;

  /** @asyncUnsafe Every rejection is turned into an unavailable claim. */
  async claim(scope: string, nonce: string, nowMs: number): Promise<AdminReplayClaim> {
    const now = new Date(nowMs);
    const expiresAt = new Date(nowMs + ADMIN_NONCE_RETENTION_MS);
    try {
      if (nowMs - this.lastSweepMs >= SWEEP_INTERVAL_MS) {
        this.lastSweepMs = nowMs;
        // Only rows past their retention go; a live nonce is never removed.
        await DB.query('DELETE FROM admin_nonces WHERE expires_at <= ?', [now]);
      }
      try {
        await DB.query('INSERT INTO admin_nonces (scope, nonce, expires_at) VALUES (?, ?, ?)', [
          scope,
          nonce,
          expiresAt,
        ]);
        return 'claimed';
      } catch (e) {
        if (!isDuplicateKey(e)) {
          throw e;
        }
        // The row exists. It may only be reused once its retention ended;
        // the update is atomic on that condition.
        const [result]: any[] = await DB.query(
          'UPDATE admin_nonces SET expires_at = ? WHERE scope = ? AND nonce = ? AND expires_at <= ?',
          [expiresAt, scope, nonce, now],
        );
        return Number(result?.affectedRows ?? 0) === 1 ? 'claimed' : 'replayed';
      }
    } catch (e) {
      logger.warn('[admin-adapter] The database replay store could not claim a nonce: ' + (e instanceof Error ? e.message : e));
      return 'unavailable';
    }
  }
}

/** SET NX PX in the shared Redis, keyed by scope and nonce. */
export class RedisAdminReplayStore implements AdminReplayStore {
  readonly kind = 'redis';

  /** @asyncUnsafe Every rejection is turned into an unavailable claim. */
  async claim(scope: string, nonce: string, _nowMs: number): Promise<AdminReplayClaim> {
    try {
      const claimed = await redisCache.$claimOnce(`admin-nonce:${scope}:${nonce}`, ADMIN_NONCE_RETENTION_MS);
      return claimed ? 'claimed' : 'replayed';
    } catch (e) {
      logger.warn('[admin-adapter] The Redis replay store could not claim a nonce: ' + (e instanceof Error ? e.message : e));
      return 'unavailable';
    }
  }
}

/**
 * Picks the store for this process and logs the choice once. The environment
 * variable is an override for operators; unset, the choice follows what is
 * already enabled. `memory` is never chosen implicitly.
 */
export function createAdminReplayStore(
  environment: Record<string, string | undefined> = process.env,
  enabled: { database: boolean; redis: boolean } = {
    database: config.DATABASE.ENABLED === true,
    redis: config.REDIS.ENABLED === true,
  },
): AdminReplayStore {
  const requested = String(environment[ADMIN_REPLAY_STORE_ENVIRONMENT_VARIABLE] ?? '').trim().toLowerCase();
  let store: AdminReplayStore;
  if (requested === 'memory') {
    logger.warn(
      `[admin-adapter] ${ADMIN_REPLAY_STORE_ENVIRONMENT_VARIABLE}=memory: admin replay protection is single-process only and cannot stop a replay against another worker.`,
    );
    store = new AdminAdapterNonceStore();
  } else if (requested === 'database' || (requested === '' && enabled.database)) {
    store = enabled.database
      ? new MysqlAdminReplayStore()
      : new UnavailableAdminReplayStore(`${ADMIN_REPLAY_STORE_ENVIRONMENT_VARIABLE}=database was requested but the database is disabled`);
  } else if (requested === 'redis' || (requested === '' && enabled.redis)) {
    store = enabled.redis
      ? new RedisAdminReplayStore()
      : new UnavailableAdminReplayStore(`${ADMIN_REPLAY_STORE_ENVIRONMENT_VARIABLE}=redis was requested but Redis is disabled`);
  } else if (requested !== '') {
    store = new UnavailableAdminReplayStore(`${ADMIN_REPLAY_STORE_ENVIRONMENT_VARIABLE}=${requested} is not a known replay store`);
  } else {
    store = new UnavailableAdminReplayStore(
      `neither the database nor Redis is enabled, so no shared replay store exists (set ${ADMIN_REPLAY_STORE_ENVIRONMENT_VARIABLE}=memory only for a single-process deployment)`,
    );
  }
  logger.info(`[admin-adapter] Admin replay store: ${store.kind}.`);
  return store;
}
