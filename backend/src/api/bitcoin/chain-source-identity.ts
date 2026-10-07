import { createHash } from 'crypto';
import { Application } from 'express';
import config from '../../config';
import { verifyAddressSource } from './address-source-checkpoint';

export interface IdentityIndexReader {
  selector: unknown;
  tip(signal: AbortSignal): Promise<number | null>;
  hash(height: number, signal: AbortSignal): Promise<unknown>;
}
export interface IdentityDependencies {
  index(): IdentityIndexReader;
  core: { rpc: { call(method: string, params: unknown[], options: { signal: AbortSignal }): Promise<any> } };
  releaseSha(): string | null | undefined;
}
export class ChainSourceIdentity {
  private active = 0;
  constructor(private dependencies: IdentityDependencies, private budgetMs = 15000) {}

  async observe(signal?: AbortSignal) {
    if (this.active >= 2) throw new Error('Identity observation capacity unavailable');
    const releaseSha = this.dependencies.releaseSha();
    if (!releaseSha || !/^[0-9a-f]{40}$/.test(releaseSha)) throw new Error('Artifact revision unavailable');
    if (!['mainnet', 'testnet', 'testnet4', 'signet', 'regtest'].includes(config.MEMPOOL.NETWORK)) throw new Error('Bitcoin source unavailable');
    this.active++;
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const ensureActive = (): void => { if (controller.signal.aborted) throw new Error('Identity observation cancelled or exceeded deadline'); };
    let timer: ReturnType<typeof setTimeout>;
    const work = /** @asyncUnsafe */ async () => {
      ensureActive();
      const reader = this.dependencies.index();
      const configurationSha256 = createHash('sha256').update(JSON.stringify({
        schema: 'universe-chain-source-configuration-v1', network: config.MEMPOOL.NETWORK,
        core: { host: config.CORE_RPC.HOST, port: config.CORE_RPC.PORT },
        index: reader.selector, signetChallenge: process.env.UNIVERSE_SIGNET_CHALLENGE ?? null,
      })).digest('hex');
      const tip = await reader.tip(controller.signal);
      ensureActive();
      const core = { rpc: { call: /** @asyncUnsafe */ async (method: string, params: unknown[]) => {
        ensureActive();
        const value = await this.dependencies.core.rpc.call(method, params, { signal: controller.signal });
        ensureActive();
        if (method === 'getblockchaininfo' && value.initialblockdownload !== false) throw new Error('Owned node readiness unavailable');
        return value;
      } } };
      const checkpoint = await verifyAddressSource(tip, (height) => {
        ensureActive();
        return reader.hash(height, controller.signal);
      }, core, this.budgetMs);
      ensureActive();
      return {
        schema: 'universe-chain-source-identity-v1', chain: 'bitcoin', network: checkpoint.network,
        genesisHash: checkpoint.genesisHash, signetChallenge: checkpoint.signetChallenge,
        checkpoint: { heightAtomic: String(checkpoint.blockHeight), blockHash: checkpoint.blockHash },
        releaseSha, configurationSha256, observedAt: checkpoint.verifiedAt,
      };
    };
    try {
      return await Promise.race([work(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Identity observation exceeded deadline')); }, this.budgetMs);
      })]);
    } finally { clearTimeout(timer!); controller.abort(); signal?.removeEventListener('abort', abort); this.active--; }
  }
}

export function mountChainSourceIdentity(app: Application, observer: ChainSourceIdentity): void {
  app.get(config.MEMPOOL.API_URL_PREFIX + 'chain-source/identity', async (req, res) => {
    const controller = new AbortController();
    const close = (): void => { if (!res.writableEnded) controller.abort(); };
    req.once('aborted', close); res.once('close', close);
    res.set('Cache-Control', 'no-store');
    try { res.json(await observer.observe(controller.signal)); }
    catch (error) {
      if (!res.destroyed && !res.writableEnded) res.status(error instanceof Error && /deadline/.test(error.message) ? 504 : 503)
        .json({ error: 'Configured chain source identity is unavailable' });
    } finally { req.removeListener('aborted', close); res.removeListener('close', close); }
  });
}
