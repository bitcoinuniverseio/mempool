import { Application, Request, Response } from 'express';
import config from '../config';
import capabilities from './capabilities';
import { handleError } from '../utils/api';

/**
 * Publishes what this deployment can actually serve. The frontend reads it to
 * render truthful states instead of guessing from its own build-time flags,
 * and the release procedure reads it to refuse an incoherent cutover.
 */
class CapabilitiesRoutes {
  public initRoutes(app: Application): void {
    app.get(config.MEMPOOL.API_URL_PREFIX + 'capabilities', async (req: Request, res: Response) => {
      try {
        /*
         * IMPLEMENTATION-HANDOFF [M23-HEALTH] | F-M23-03, F-M23-04
         * Coverage: C-BTC-INDEX, C-STATS-FRESH, C-MINING-READY, C-ADDRESS-READY.
         * Preparation only, 2026-09-23. Dependencies: M23-BASE, M23-NET.
         * Live operational observation, not a mainnet functional test:
         * /api/v1/capabilities at 2026-09-23T17:39:41.778Z reported address
         * index unavailable, statistics lag 80936 seconds, and mining ready
         * despite its indexed height 968172 versus backend-info Core 968299.
         * The running backend named 537235052, not the inspected branch tip.
         * Verified current-source cause for the readiness gap is in
         * capabilities.ts:$miningReport: indexed = total > 0 && poolCount > 0;
         * highest/newest are reported but never constrain readiness. Causes
         * of the actual address outage and stalled ingestion remain unresolved.
         * Sources: Bitcoin Core 31.0 getblockchaininfo RPC; repository
         * capabilities.ts, bitcoin/address-index.ts, backend-info-checkpoint.ts;
         * user requirements for authoritative freshness and truthful states.
         * 1. In capabilities.ts:$miningReport compare the indexed checkpoint
         * to a fresh, same-network Core observation and expose the existing
         * indexedTip/bitcoinCoreTip/lagBlocks fields. Define a bounded allowed
         * lag in the owning configuration contract, tested at its boundary;
         * do not infer collector freshness from block mining timestamps alone.
         * Preserve unknown separately when a reference checkpoint is absent,
         * stale or inconsistent. Existing historical rows must not prove ready.
         * 2. Keep this endpoint, release gates and frontend consumers on that
         * shared result; coordinate any response/type changes. Exercise cache
         * expiry and network identity so a prior ready response cannot conceal
         * dependency loss or survive a chain change. Do not substitute HTTP 200
         * or a row count for the final outcome.
         * 3. Diagnose the live outage through authorized service/configuration
         * identity, cookie freshness, index reachability and ingestion logs.
         * Compare Core, completed block cache, SQL tip, address index and
         * statistics collector independently. Do not assert one common cause
         * without evidence; never restart an active reorg/indexer blindly.
         * 4. Add focused tests in the existing capabilities test suite (locate
         * before editing): fresh/lagged/unknown tip, database loss, empty rows,
         * pool metadata missing, observation expiry, recovery and reorg.
         * Run cd backend; npm run test:ci -- --runInBand; npm run lint;
         * npm run build. Commands are declared, not executed on SERVER here.
         * Acceptance additionally requires real Signet API-to-UI address,
         * UTXO/history, mining and statistics outcomes across reload/reconnect;
         * faults belong in an isolated environment, not production. Preserve
         * historical coverage and accurately report gaps, without fake backfill.
         * Rollback: retain the prior artifact, configuration and database backup;
         * no destructive rescan, migration or permission relaxation is authorized
         * merely by this annotation. Record the verified cause before repair.
         */
        const report = await capabilities.$report();
        res.header('Pragma', 'public');
        res.header('Cache-control', 'public');
        res.setHeader('Expires', new Date(Date.now() + 1000 * 10).toUTCString());
        res.json(report);
      } catch (e) {
        handleError(req, res, 500, 'Failed to build the capability report');
      }
    });
  }
}

export default new CapabilitiesRoutes();
