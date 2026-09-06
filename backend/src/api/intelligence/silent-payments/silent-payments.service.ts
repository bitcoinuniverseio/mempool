import { createHash } from 'crypto';
import config from '../../../config';
import DB from '../../../database';
import logger from '../../../logger';
import blocks from '../../blocks';
import bitcoinApi from '../../bitcoin/bitcoin-api-factory';
import bitcoinClient from '../../bitcoin/bitcoin-client';
import { IEsploraApi } from '../../bitcoin/esplora-api.interface';
import { buildSilentPaymentBundle, SILENT_PAYMENTS_SCHEMA_QUERIES } from './silent-payments-ingestion';
import { decodeSilentAddress, inspectPsbt, SP_NETWORKS } from './silent-payments-parsers';
import { SilentPaymentBlockBundle, SilentPaymentBlockManifest, SilentPaymentCoverageOverview, SilentPaymentSupportClaim } from './silent-payments.models';

export class SilentPaymentUnavailable extends Error {}

export class SilentPaymentsService {
  private static instance: SilentPaymentsService;
  private started = false;
  private queue: Promise<void> = Promise.resolve();
  private initialized = false;
  private failure: string | undefined;
  private readonly network = config.MEMPOOL.NETWORK === 'testnet' ? 'testnet' : config.MEMPOOL.NETWORK || 'mainnet';

  public static getInstance(): SilentPaymentsService {
    if (!SilentPaymentsService.instance) {SilentPaymentsService.instance = new SilentPaymentsService();}
    return SilentPaymentsService.instance;
  }

  public start(): void {
    if (this.started) {return;}
    this.started = true;
    blocks.setNewBlockCallback((block, txids, transactions) => {
      this.queue = this.queue.then(/** @asyncUnsafe The following catch records ingestion failures. */ async () => {
        await this.assertSource(this.network);
        await this.ensureStorage();
        await this.reconcileAndIngest(block, transactions);
        this.failure = undefined;
      }).catch(error => {
        this.failure = error instanceof SilentPaymentUnavailable ? error.message : 'First-party block ingestion failed; checkpoint was not advanced.';
        logger.warn(`Silent Payments: ${this.failure}`);
      });
    });
  }

  /** @asyncUnsafe Source/storage failures propagate to the route or shared-event error boundary. */
  private async ensureStorage(): Promise<void> {
    if (!config.DATABASE.ENABLED) {throw new SilentPaymentUnavailable('Silent Payment persistence requires the configured MySQL database.');}
    if (this.initialized) {return;}
    for (const query of SILENT_PAYMENTS_SCHEMA_QUERIES) {await DB.query(query);}
    this.initialized = true;
  }

  /** @asyncUnsafe Source/storage failures propagate to the route or shared-event error boundary. */
  private async assertSource(network: string): Promise<void> {
    if (!SP_NETWORKS.includes(network) || network !== this.network) {throw new SilentPaymentUnavailable(`No first-party Bitcoin source is configured for ${network}.`);}
    let info: any;
    try { info = await bitcoinClient.getBlockchainInfo(); }
    catch { throw new SilentPaymentUnavailable('Configured Bitcoin Core RPC is unavailable.'); }
    const actual = ({ main: 'mainnet', test: 'testnet', testnet4: 'testnet4', signet: 'signet', regtest: 'regtest' })[info?.chain];
    if (actual !== network) {throw new SilentPaymentUnavailable('Configured Bitcoin Core chain does not match the requested network.');}
    if (info.initialblockdownload) {throw new SilentPaymentUnavailable('Configured Bitcoin Core is still synchronizing.');}
    // Check the shared Esplora/electrum source against Core before accepting its block data.
    let coreHash: string;
    try { coreHash = await bitcoinClient.getBlockHash(0); }
    catch { throw new SilentPaymentUnavailable('Cannot verify Bitcoin source identity.'); }
    if (await bitcoinApi.$getBlockHash(0) !== coreHash) {throw new SilentPaymentUnavailable('Shared Bitcoin source and Core have different genesis blocks.');}
  }

  /** @asyncUnsafe Source/storage failures propagate to the route or shared-event error boundary. */
  private async latest(network: string): Promise<SilentPaymentBlockManifest | null> {
    const [rows]: any = await DB.query('SELECT manifest_json FROM intelligence_silent_payment_blocks WHERE chain = ? AND network = ? ORDER BY height DESC LIMIT 1', ['bitcoin', network]);
    return rows.length ? JSON.parse(rows[0].manifest_json) : null;
  }

  /** Serialized shared-block consumer. Each row atomically contains both bundle and checkpoint. */
  /** @asyncUnsafe Source/storage failures propagate to the route or shared-event error boundary. */
  public async ingestBlock(network: string, block: IEsploraApi.Block, transactions: IEsploraApi.Transaction[]): Promise<void> {
    if (network !== this.network) {throw new SilentPaymentUnavailable('Cannot ingest a different source network.');}
    const { manifest, bytes } = buildSilentPaymentBundle(network, block, transactions);
    await DB.$atomicQuery([
      { query: 'DELETE FROM intelligence_silent_payment_blocks WHERE chain = ? AND network = ? AND height >= ? AND (height > ? OR block_hash <> ?)', params: ['bitcoin', network, block.height, block.height, block.id] },
      { query: `INSERT INTO intelligence_silent_payment_blocks (chain, network, height, block_hash, previous_block_hash, bundle_hash, manifest_json, bundle_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE bundle_hash = VALUES(bundle_hash), manifest_json = VALUES(manifest_json), bundle_json = VALUES(bundle_json)`, params: ['bitcoin', network, block.height, block.id, block.previousblockhash, manifest.bundle_hash, JSON.stringify(manifest), bytes] }
    ]);
  }

  /** @asyncUnsafe Source/storage failures propagate to the route or shared-event error boundary. */
  private async reconcileAndIngest(block: IEsploraApi.Block, transactions: IEsploraApi.Transaction[]): Promise<void> {
    let checkpoint = await this.latest(this.network);
    const sourceTip = await bitcoinApi.$getBlockHeightTip();
    let walked = 0;
    while (checkpoint && (checkpoint.height > sourceTip || await bitcoinApi.$getBlockHash(checkpoint.height) !== checkpoint.block_hash)) {
      if (++walked > 144) {throw new SilentPaymentUnavailable('Reorg recovery reached its 144-block batch limit; recovery resumes on the next shared block.');}
      await DB.query('DELETE FROM intelligence_silent_payment_blocks WHERE chain = ? AND network = ? AND height >= ?', ['bitcoin', this.network, checkpoint.height]);
      checkpoint = await this.latest(this.network);
    }
    if (checkpoint && checkpoint.height >= block.height) {return;}
    // Restart/retry catches up in bounded batches through the existing shared source client.
    const start = checkpoint ? checkpoint.height + 1 : block.height;
    const end = Math.min(block.height, start + 143);
    for (let height = start; height <= end; height++) {
      const hash = height === block.height ? block.id : await bitcoinApi.$getBlockHash(height);
      const nextBlock = height === block.height ? block : await bitcoinApi.$getBlock(hash);
      const txs = height === block.height ? transactions : await bitcoinApi.$getTxsForBlock(hash);
      if (checkpoint && nextBlock.previousblockhash !== checkpoint.block_hash) {throw new SilentPaymentUnavailable('Block continuity changed during ingestion; retry on the next shared block.');}
      if (await bitcoinApi.$getBlockHash(height) !== nextBlock.id) {throw new SilentPaymentUnavailable('Block changed during ingestion; checkpoint was not advanced.');}
      await this.ingestBlock(this.network, nextBlock, txs);
      checkpoint = { height, block_hash: nextBlock.id } as SilentPaymentBlockManifest;
    }
  }

  public async getCoverageOverview(network = 'mainnet'): Promise<SilentPaymentCoverageOverview> {
    const empty: SilentPaymentCoverageOverview = { chain: 'bitcoin', network, status: 'unavailable', latest_indexed_height: null, total_indexed_blocks: null, total_candidate_outputs: null, total_sp_outputs_detected: null, ecosystem_adoption_count: null, support_claims: [], last_updated: null, recent_manifests: [] };
    try {
      await this.assertSource(network); await this.ensureStorage();
      const [rows]: any = await DB.query('SELECT manifest_json FROM intelligence_silent_payment_blocks WHERE chain = ? AND network = ? ORDER BY height DESC LIMIT 10', ['bitcoin', network]);
      const recent: SilentPaymentBlockManifest[] = rows.map(row => JSON.parse(row.manifest_json));
      if (recent.length && await bitcoinApi.$getBlockHash(recent[0].height) !== recent[0].block_hash) {throw new SilentPaymentUnavailable('Persisted checkpoint was displaced; reorg recovery is pending.');}
      const [totals]: any = await DB.query('SELECT COUNT(*) AS blocks, SUM(CAST(JSON_EXTRACT(manifest_json, \'$.candidate_output_count\') AS UNSIGNED)) AS candidates FROM intelligence_silent_payment_blocks WHERE chain = ? AND network = ?', ['bitcoin', network]);
      const tip = await bitcoinApi.$getBlockHeightTip();
      return { ...empty, status: !recent.length ? 'empty' : this.failure || recent[0].height < tip ? 'stale' : 'current', reason: this.failure, latest_indexed_height: recent[0]?.height ?? null, total_indexed_blocks: Number(totals[0].blocks), total_candidate_outputs: Number(totals[0].candidates || 0), last_updated: recent[0]?.created_at ?? null, recent_manifests: recent, support_claims: await this.getSupportRegistry() };
    } catch (error) {
      return { ...empty, reason: error instanceof SilentPaymentUnavailable ? error.message : 'Silent Payment storage or configured first-party source is unavailable.' };
    }
  }

  /** @asyncUnsafe Source/storage failures propagate to the route or shared-event error boundary. */
  private async stored(height: number, network: string): Promise<{ manifest: SilentPaymentBlockManifest; bytes: string } | null> {
    if (!Number.isSafeInteger(height) || height < 0 || height > 0xffffffff) {throw new Error('Invalid block height.');}
    await this.assertSource(network); await this.ensureStorage();
    const [rows]: any = await DB.query('SELECT manifest_json, bundle_json FROM intelligence_silent_payment_blocks WHERE chain = ? AND network = ? AND height = ?', ['bitcoin', network, height]);
    if (!rows.length) {return null;}
    const manifest = JSON.parse(rows[0].manifest_json);
    const bytes = rows[0].bundle_json;
    if (manifest.block_hash !== await bitcoinApi.$getBlockHash(height)) {throw new SilentPaymentUnavailable('Requested checkpoint was displaced; reorg recovery is pending.');}
    if (createHash('sha256').update(bytes).digest('hex') !== manifest.bundle_hash) {throw new SilentPaymentUnavailable('Stored bundle integrity check failed.');}
    return { manifest, bytes };
  }

  /** @asyncUnsafe Source/storage failures propagate to the route or shared-event error boundary. */
  public async getBlockManifest(height: number, network = 'mainnet'): Promise<SilentPaymentBlockManifest | null> { return (await this.stored(height, network))?.manifest || null; }
  /** @asyncUnsafe Source/storage failures propagate to the route or shared-event error boundary. */
  public async getBlockBundle(height: number, network = 'mainnet'): Promise<SilentPaymentBlockBundle | null> { const stored = await this.stored(height, network); return stored ? JSON.parse(stored.bytes) : null; }
  /** @asyncUnsafe Source/storage failures propagate to the route or shared-event error boundary. */
  public async getBlockBundleBytes(height: number, network = 'mainnet'): Promise<string | null> { return (await this.stored(height, network))?.bytes || null; }
  /** @asyncUnsafe Source/storage failures propagate to the route or shared-event error boundary. */
  public async getSupportRegistry(): Promise<SilentPaymentSupportClaim[]> {
    await this.ensureStorage();
    const [rows]: any = await DB.query('SELECT claim_json FROM intelligence_silent_payment_support ORDER BY observed_at DESC LIMIT 100');
    return rows.map(row => {
      const claim: SilentPaymentSupportClaim = JSON.parse(row.claim_json);
      const capabilities = ['send_supported', 'receive_supported', 'bip352_compliance', 'bip375_send_psbt', 'bip376_spend_psbt'];
      if ([claim.wallet_id, claim.name, claim.verified_version].some(value => typeof value !== 'string' || !value.trim()) || capabilities.some(key => typeof claim[key] !== 'boolean') || !Number.isFinite(Date.parse(claim.updated_at)) || !['documented', 'tested'].includes(claim.status)) {throw new SilentPaymentUnavailable('Stored wallet support evidence is incomplete.');}
      let evidence: URL;
      try { evidence = new URL(claim.evidence_url); }
      catch { throw new SilentPaymentUnavailable('Stored wallet support evidence URL is invalid.'); }
      if (evidence.protocol !== 'https:' || !evidence.hostname || evidence.username || evidence.password) {throw new SilentPaymentUnavailable('Stored wallet support evidence URL is invalid.');}
      return claim;
    });
  }
  public validateSilentPaymentAddress(address: unknown, network?: string) { return decodeSilentAddress(address, network); }
  public validatePsbtFields(psbt: unknown) { return inspectPsbt(psbt); }
}

export const silentPaymentsService = SilentPaymentsService.getInstance();
