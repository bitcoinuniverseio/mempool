import {
  parseExplorerContext,
  sameExplorerContext,
} from './contracts/explorer-context';
import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  EXPLORER_REGISTRY_VERSION,
  explorerProtocolManifest,
  resolveExplorerProtocol,
} from './registry/explorer-protocol-registry';
import {
  explorerProtocolManifestDocument,
  type ExplorerProtocolManifestDocument,
} from './registry/explorer-protocol-manifest';
import { resolveReleaseIdentity } from './release-identity';
import { sealedAcceptanceFromEnvironment } from './registry/protocol-functional-acceptance';
import {
  ExplorerSourcesService,
  explorerSourceStatus,
  type ExplorerSourcePublicStatus,
} from './sources/explorer-sources.service';
import {
  OUTPOINT_ENRICHMENT_BATCH_LIMIT,
  OutpointEnrichmentService,
  type OutpointEnrichmentResult,
} from './outpoints/outpoint-enrichment.service';
import { OutpointEnricherRegistry } from './outpoints/outpoint-enricher';
import {
  TRANSACTION_FLOW_BATCH_LIMIT,
  TransactionFlowService,
  type TransactionFlowFailureStatus,
} from './transactions/transaction-flow.service';
import { TransactionAssetSummaryService } from './transactions/transaction-asset-summary.service';
import type { ExplorerTransactionAssetSummary } from './contracts/transaction-asset-summary';
import type {
  ExplorerAddressAssetView,
  ExplorerTransactionAssetFlow,
} from './contracts/explorer-evidence';
import {
  ADDRESS_HOLDINGS_UTXO_PAGE_LIMIT,
  AddressHoldingsService,
} from './transactions/address-holdings.service';
import {
  AssetLookupService,
  type AssetLookupResult,
} from './assets/asset-lookup.service';
import {
  ProtocolActivityService,
  parseProtocolActivityQuery,
} from './protocol-activity/protocol-activity.service';
import type { ExplorerProtocolActivityPage } from './contracts/explorer-protocol-activity';
import { PROTOCOL_FEED_ROUTES } from './protocol-activity/protocol-feed-directory';
import { ProtocolObjectsService } from './protocol-objects/protocol-objects.service';
import type { ExplorerProtocolObjectsPage } from './contracts/explorer-protocol-objects';

const TXID_PATTERN = /^[0-9a-f]{64}$/;
const VOUT_PATTERN = /^(0|[1-9][0-9]{0,9})$/;
const MAXIMUM_OUTPOINT_LENGTH = 75;

export interface ExplorerPublicSourceView {
  chain?: string;
  network?: string;
  authorityId: string;
  protocols: readonly string[];
  ready: boolean;
  checkpoint: {
    heightAtomic: string;
    blockHash: string;
    observedAt: string;
  } | null;
  status: ExplorerSourcePublicStatus;
  checkedAt: string;
  /** Configured, but no source check has completed yet. */
  measurementPending?: boolean;
  /** Blocks behind the chain reference, as a decimal string. */
  lagBlocks: string | null;
  /** When this authority last answered ready with a usable checkpoint. */
  lastSuccessAt: string | null;
  /**
   * When this authority last answered a check at all, ready or not.
   *
   * An indexer that is still scanning answers every check and says it is not
   * ready. Without this the only timestamp was lastSuccessAt, so an authority
   * that had never finished scanning published a null one beside a checkpoint
   * that was moving, and the document read as an outage.
   */
  lastAnsweredAt: string | null;
  /**
   * Consecutive checks the authority did not answer. A truthful "not ready" is
   * an answer and does not count here.
   */
  consecutiveFailures: number;
}

export interface ExplorerSourceCounts {
  configured: number;
  ready: number;
  stale: number;
  degraded: number;
  unreachable: number;
}

/**
 * What the registry says a protocol can do, kept apart from whether its
 * authority can answer right now.
 *
 * Those two were previously rendered side by side with equal weight, so a
 * protocol whose authority was unreachable still led with the registry's
 * "read only" capability and read as live. Availability is the primary fact;
 * capability is what it would be able to do once available.
 */
export type ExplorerProtocolAvailability =
  | 'available'
  | 'stale'
  | 'degraded'
  | 'unreachable'
  | 'unconfigured'
  | 'not-implemented'
  | 'disabled';

export interface ExplorerProtocolAvailabilityView {
  protocolId: string;
  authorityId: string | null;
  availability: ExplorerProtocolAvailability;
  /** What the registry says the protocol implements, kept separate. */
  capability: string;
  implementedReadOperations: readonly string[];
  authorityAvailability: ExplorerSourcePublicStatus | 'unconfigured';
  lagBlocks: string | null;
  checkedAt: string | null;
  lastSuccessAt: string | null;
}

/**
 * Resolves one protocol's registry capability against its authority's runtime
 * status into the single answer a reader needs.
 *
 * The registry decides for a protocol the explorer has not implemented: no
 * authority state makes such a protocol readable, and a healthy authority
 * behind an unimplemented protocol must not be reported as though the protocol
 * were available. Otherwise the authority decides, because a readable protocol
 * whose authority cannot answer is not readable.
 */
/**
 * IMPLEMENTATION-HANDOFF B07 (2026-09-18):
 * This maps current source availability and handlers, not operation acceptance
 * or historical completeness. Preserve not-implemented, unconfigured,
 * catching-up and unavailable outcomes until the underlying authority/reader
 * issue is fixed and evidenced. A readable BLOCKED protocol does not gain
 * verified capability. Exercise each real scoped route, then verify UI badges
 * agree with independent availability and coverage evidence.
 */

export function protocolAvailabilityFrom(
  status: ExplorerSourcePublicStatus | null,
  releaseStatus?: string,
  implementedReadOperations: readonly string[] = [],
): ExplorerProtocolAvailability {
  const capability = (releaseStatus ?? '')
    .toUpperCase()
    .replace(/[_-]+/g, ' ')
    .trim();
  if (
    capability === 'BLOCKED' &&
    !implementedReadOperations.some((operation) => operation !== 'registry')
  )
    return 'not-implemented';
  if (capability === 'INTENTIONALLY DISABLED') return 'disabled';

  switch (status) {
    case 'ready':
      return 'available';
    case 'stale':
      return 'stale';
    case 'degraded':
      return 'degraded';
    case 'unreachable':
      return 'unreachable';
    default:
      return 'unconfigured';
  }
}

export interface ExplorerTransactionBatchItem {
  txid: string;
  status: 'ok' | 'invalid' | TransactionFlowFailureStatus;
  flow: ExplorerTransactionAssetFlow | null;
}

/**
 * Public read-only Universe Explorer overlay routes. Served behind the
 * same-origin explorer gateway as `/api/v1/universe/*`; this service never
 * exposes indexer credentials, origins, or internal topology.
 */
@Controller('universe')
export class UniverseExplorerController {
  constructor(
    private readonly sources: ExplorerSourcesService,
    private readonly outpoints: OutpointEnrichmentService,
    private readonly transactions: TransactionFlowService,
    private readonly summaries: TransactionAssetSummaryService,
    private readonly assets: AssetLookupService,
    private readonly holdings: AddressHoldingsService,
    private readonly activity: ProtocolActivityService,
    private readonly objects: ProtocolObjectsService,
    private readonly outpointRegistry?: OutpointEnricherRegistry,
  ) {}

  /**
   * Asset lookups share one response shape and one failure vocabulary.
   * A miss is a 404 with the checkpoint that proves the miss; an authority
   * that could not answer is a 502, so an outage is never rendered as
   * "this does not exist".
   */
  private assetResponse<T>(result: AssetLookupResult<T>): AssetLookupResult<T> {
    if (result.status === 'ok') return result;
    if (result.status === 'not-found') {
      throw new NotFoundException(result);
    }
    if (result.status === 'unconfigured') {
      throw new ServiceUnavailableException(result);
    }
    throw new BadGatewayException(result);
  }

  @Get('inscriptions/:reference')
  @Header('Cache-Control', 'public, max-age=30')
  async inscription(
    @Param('reference') reference: string,
    @Query('chain') chain?: string,
    @Query('network') network?: string,
  ) {
    const context = parseExplorerContext(chain, network);
    if (
      typeof reference !== 'string' ||
      !AssetLookupService.validInscriptionReference(reference)
    ) {
      throw new BadRequestException(
        'An inscription reference is an inscription id or an inscription number',
      );
    }
    return this.assetResponse(
      await (
        chain === undefined && network === undefined
          ? this.assets
          : this.assets.forContext(context)
      ).inscription(reference),
    );
  }

  @Get('runes/:reference')
  @Header('Cache-Control', 'public, max-age=30')
  async rune(
    @Param('reference') reference: string,
    @Query('chain') chain?: string,
    @Query('network') network?: string,
  ) {
    const context = parseExplorerContext(chain, network);
    if (
      typeof reference !== 'string' ||
      !AssetLookupService.validRuneReference(reference)
    ) {
      throw new BadRequestException(
        'A rune reference is a rune name or a rune id in block:index form',
      );
    }
    return this.assetResponse(
      await (
        chain === undefined && network === undefined
          ? this.assets
          : this.assets.forContext(context)
      ).rune(reference),
    );
  }

  @Get('sats/:reference')
  @Header('Cache-Control', 'public, max-age=300')
  async sat(
    @Param('reference') reference: string,
    @Query('chain') chain?: string,
    @Query('network') network?: string,
  ) {
    const context = parseExplorerContext(chain, network);
    if (
      typeof reference !== 'string' ||
      !AssetLookupService.validSatReference(reference)
    ) {
      throw new BadRequestException('A sat reference is an ordinal number');
    }
    return this.assetResponse(
      await (
        chain === undefined && network === undefined
          ? this.assets
          : this.assets.forContext(context)
      ).sat(reference),
    );
  }

  @Get('blocks/:height/inscriptions')
  @Header('Cache-Control', 'public, max-age=30')
  async blockInscriptions(
    @Param('height') height: string,
    @Query('page') page?: string,
    @Query('chain') chain?: string,
    @Query('network') network?: string,
  ) {
    const context = parseExplorerContext(chain, network);
    if (typeof height !== 'string' || !AssetLookupService.validHeight(height)) {
      throw new BadRequestException('A block height is an unsigned integer');
    }
    const parsed =
      typeof page === 'string' && /^(0|[1-9][0-9]{0,2})$/.test(page)
        ? Number(page)
        : 0;
    return this.assetResponse(
      await (
        chain === undefined && network === undefined
          ? this.assets
          : this.assets.forContext(context)
      ).blockInscriptions(height, parsed),
    );
  }

  @Get('transactions/:txid')
  @Header('Cache-Control', 'public, max-age=10')
  async transaction(
    @Param('txid') txid: string,
    @Query('chain') chain?: string,
    @Query('network') network?: string,
  ): Promise<ExplorerTransactionAssetFlow> {
    const context = parseExplorerContext(chain, network);
    if (typeof txid !== 'string' || !TXID_PATTERN.test(txid)) {
      throw new BadRequestException('txid must be 64 lowercase hex characters');
    }
    const result = await (
      chain === undefined && network === undefined
        ? this.transactions
        : this.transactions.forContext(context)
    ).flow(txid);
    if (result.status === 'ok') return result.flow;
    if (result.status === 'not-found') {
      throw new NotFoundException({
        error: 'transaction-not-found',
        txid,
      });
    }
    if (result.status === 'unconfigured') {
      throw new ServiceUnavailableException({
        error: 'bitcoin-authority-unconfigured',
        authorityId: 'mempool-backend',
      });
    }
    throw new BadGatewayException({
      error: 'bitcoin-authority-unavailable',
      txid,
    });
  }

  /**
   * The compact transaction asset summary (summary-v1).
   *
   * Deliberately separate from the flow route above and bounded by its own
   * deadline, so the slowest outpoint read cannot hold the page's asset count
   * hostage. A source delay returns the known facts with explicit coverage and
   * a Retry-After; it never degrades into an empty successful token list.
   */
  @Get('transactions/:txid/assets')
  @Header('Cache-Control', 'public, max-age=10')
  async transactionAssets(
    @Param('txid') txid: string,
    @Res({ passthrough: true }) response: Response,
    @Query('chain') chain?: string,
    @Query('network') network?: string,
  ): Promise<ExplorerTransactionAssetSummary> {
    const context = parseExplorerContext(chain, network);
    if (typeof txid !== 'string' || !TXID_PATTERN.test(txid)) {
      throw new BadRequestException('txid must be 64 lowercase hex characters');
    }
    const result = await (
      chain === undefined && network === undefined
        ? this.summaries
        : this.summaries.forContext(context)
    ).summary(txid);
    if (result.status === 'ok') {
      if (result.summary.retryAfterSeconds !== null) {
        response.setHeader(
          'Retry-After',
          String(result.summary.retryAfterSeconds),
        );
      }
      return result.summary;
    }
    if (result.status === 'not-found') {
      throw new NotFoundException({ error: 'transaction-not-found', txid });
    }
    if (result.status === 'unconfigured') {
      throw new ServiceUnavailableException({
        error: 'bitcoin-authority-unconfigured',
        authorityId: 'mempool-backend',
      });
    }
    throw new BadGatewayException({
      error: 'bitcoin-authority-unavailable',
      txid,
    });
  }

  @Post('transactions/batch')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async transactionBatch(
    @Body() body: unknown,
    @Query('chain') chain?: string,
    @Query('network') network?: string,
  ): Promise<{ results: ExplorerTransactionBatchItem[] }> {
    const context = parseExplorerContext(chain, network);
    if (
      typeof body !== 'object' ||
      body === null ||
      Array.isArray(body) ||
      !Array.isArray((body as { txids?: unknown }).txids)
    ) {
      throw new BadRequestException(
        'The body must be an object with a txids array',
      );
    }
    const txids = (body as { txids: unknown[] }).txids;
    if (txids.length === 0 || txids.length > TRANSACTION_FLOW_BATCH_LIMIT) {
      throw new BadRequestException(
        `txids must list between 1 and ${TRANSACTION_FLOW_BATCH_LIMIT} entries`,
      );
    }
    const results: ExplorerTransactionBatchItem[] = [];
    for (const entry of txids) {
      if (typeof entry !== 'string' || !TXID_PATTERN.test(entry)) {
        results.push({
          txid: typeof entry === 'string' ? entry.slice(0, 64) : '',
          status: 'invalid',
          flow: null,
        });
        continue;
      }
      const result = await (
        chain === undefined && network === undefined
          ? this.transactions
          : this.transactions.forContext(context)
      ).flow(entry);
      results.push(
        result.status === 'ok'
          ? { txid: entry, status: 'ok', flow: result.flow }
          : { txid: entry, status: result.status, flow: null },
      );
    }
    return { results };
  }

  /**
   * The Bitcoin address asset-holdings view: every paginated unspent
   * output enriched through every configured protocol authority, with
   * exact aggregates and per-authority coverage accounting.
   */
  @Get('addresses/:address/holdings')
  @Header('Cache-Control', 'public, max-age=10')
  async addressHoldings(
    @Param('address') address: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('chain') chain?: string,
    @Query('network') network?: string,
  ): Promise<ExplorerAddressAssetView> {
    const context = parseExplorerContext(chain, network);
    let parsedLimit = ADDRESS_HOLDINGS_UTXO_PAGE_LIMIT;
    if (limit !== undefined) {
      if (!/^[1-9][0-9]{0,2}$/.test(limit) || Number(limit) > 100) {
        throw new BadRequestException('limit must be an integer from 1 to 100');
      }
      parsedLimit = Number(limit);
    }
    let parsedOffset = 0;
    if (offset !== undefined) {
      if (
        !/^(?:0|[1-9][0-9]{0,6})$/.test(offset) ||
        Number(offset) > 1_000_000
      ) {
        throw new BadRequestException(
          'offset must be an integer from 0 to 1000000',
        );
      }
      parsedOffset = Number(offset);
    }
    const result = await (
      chain === undefined && network === undefined
        ? this.holdings
        : this.holdings.forContext(context)
    ).view(address, parsedLimit, parsedOffset);
    if (result.status === 'ok') return result.view;
    if (result.status === 'invalid') {
      throw new BadRequestException('invalid Bitcoin address');
    }
    if (result.status === 'unconfigured') {
      throw new ServiceUnavailableException({
        error: 'bitcoin-authority-unconfigured',
        authorityId: 'mempool-backend',
      });
    }
    throw new BadGatewayException({
      error: 'bitcoin-authority-unavailable',
      address,
    });
  }

  @Get('outpoints/:txid/:vout')
  @Header('Cache-Control', 'public, max-age=10')
  async outpoint(
    @Param('txid') txid: string,
    @Param('vout') vout: string,
    @Query('chain') chain?: string,
    @Query('network') network?: string,
  ): Promise<OutpointEnrichmentResult> {
    const context = parseExplorerContext(chain, network);
    if (typeof txid !== 'string' || !TXID_PATTERN.test(txid)) {
      throw new BadRequestException('txid must be 64 lowercase hex characters');
    }
    if (typeof vout !== 'string' || !VOUT_PATTERN.test(vout)) {
      throw new BadRequestException('vout must be an unsigned integer');
    }
    if (Number(vout) > 0xffffffff)
      throw new BadRequestException('vout must be an unsigned 32-bit integer');
    if (this.outpointRegistry)
      return this.outpointRegistry
        .forContext(context)
        .enrichOutpoint(`${txid}:${vout}`);
    return (
      chain === undefined && network === undefined
        ? this.outpoints
        : this.outpoints.forContext(context)
    ).enrichOutpoint(`${txid}:${vout}`);
  }

  @Post('outpoints/batch')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async outpointBatch(
    @Body() body: unknown,
    @Query('chain') chain?: string,
    @Query('network') network?: string,
  ): Promise<{ results: OutpointEnrichmentResult[] }> {
    const context = parseExplorerContext(chain, network);
    if (
      typeof body !== 'object' ||
      body === null ||
      Array.isArray(body) ||
      !Array.isArray((body as { outpoints?: unknown }).outpoints)
    ) {
      throw new BadRequestException(
        'The body must be an object with an outpoints array',
      );
    }
    const outpoints = (body as { outpoints: unknown[] }).outpoints;
    if (
      outpoints.length === 0 ||
      outpoints.length > OUTPOINT_ENRICHMENT_BATCH_LIMIT
    ) {
      throw new BadRequestException(
        `outpoints must list between 1 and ${OUTPOINT_ENRICHMENT_BATCH_LIMIT} entries`,
      );
    }
    const bounded = outpoints.map((entry) =>
      typeof entry === 'string' && entry.length <= MAXIMUM_OUTPOINT_LENGTH
        ? entry
        : '',
    );
    if (this.outpointRegistry)
      return {
        results: await this.outpointRegistry
          .forContext(context)
          .enrichOutpoints(bounded),
      };
    return {
      results: await (
        chain === undefined && network === undefined
          ? this.outpoints
          : this.outpoints.forContext(context)
      ).enrichOutpoints(bounded),
    };
  }

  // The roster travels with its own identity: which schema, which registry
  // version, which repository produced it and which commit of that repository
  // answered. The explorer frontend records this document and fails its
  // release when what production serves differs from what it recorded, and
  // that comparison is only meaningful because both sides are named.
  @Get('protocols')
  @Header('Cache-Control', 'public, max-age=60')
  async protocols(
    @Query('chain') chain?: string,
    @Query('network') network?: string,
  ): Promise<ExplorerProtocolManifestDocument> {
    if (network !== undefined) parseExplorerContext(chain, network);
    const sourceSha = resolveReleaseIdentity().sha;
    const scope = network !== undefined ? parseExplorerContext(chain, network) : undefined;
    const functionalAcceptance = await sealedAcceptanceFromEnvironment(sourceSha, EXPLORER_REGISTRY_VERSION);
    return explorerProtocolManifestDocument({
      chain:
        network === undefined &&
        typeof chain === 'string' &&
        chain.trim().length > 0
          ? chain
          : undefined,
      sourceSha,
      ...(scope ? { acceptanceScope: scope, functionalAcceptance } : {}),
    });
  }

  /**
   * One protocol's recent activity, read from that protocol's own authority.
   *
   * The failure vocabulary is deliberate: a protocol the registry does not
   * publish is a 404 plain and simple; a protocol whose authority publishes
   * no feed this explorer reads is a 404 that says so; and a configured
   * authority that could not answer is a 502, because "the feed is down"
   * must never render as "this protocol has no activity". An unconfigured
   * authority is a served page with an explicit state, matching the chain
   * capability envelopes: the truth "this deployment cannot see it yet" is a
   * fact about the deployment, not a transport error.
   */
  @Get('protocols/:protocolId/activity')
  @Header('Cache-Control', 'no-store')
  async protocolActivity(
    @Param('protocolId') protocolId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('chain') chain?: string,
    @Query('network') network?: string,
  ): Promise<ExplorerProtocolActivityPage> {
    const context = parseExplorerContext(chain, network);
    if (
      typeof protocolId !== 'string' ||
      !/^[a-z0-9_-]{1,64}$/.test(protocolId)
    ) {
      throw new BadRequestException(
        'A protocol id is a short lowercase registry id',
      );
    }
    const resolved = resolveExplorerProtocol(protocolId);
    if (resolved) protocolId = resolved.id;
    if (!resolved) {
      throw new NotFoundException({
        schemaVersion: 'universe-protocol-activity-v1',
        protocolId,
        state: 'unsupported',
        degradedReason: 'The registry does not publish this protocol.',
      });
    }
    if (!this.activity.supports(protocolId)) {
      throw new NotFoundException({
        schemaVersion: 'universe-protocol-activity-v1',
        protocolId,
        state: 'unsupported',
        degradedReason:
          'This protocol has an authority in the registry but no activity feed route yet.',
      });
    }
    const query = parseProtocolActivityQuery(
      { cursor, limit },
      {
        authorityId: PROTOCOL_FEED_ROUTES[protocolId].authorityId,
        protocolId,
      },
    );
    if (!query) {
      throw new BadRequestException(
        'A cursor is an opaque token the authority issued and a limit is a small count',
      );
    }
    const result = await this.activity.activity(
      protocolId,
      query.cursor,
      query.limit,
      context,
    );
    if (result.ok) {
      if (result.page.state === 'unavailable') {
        throw new BadGatewayException(result.page);
      }
      return result.page;
    }
    throw new NotFoundException({
      schemaVersion: 'universe-protocol-activity-v1',
      protocolId,
      state: 'unsupported',
      degradedReason: 'The registry does not publish this protocol.',
    });
  }

  /**
   * One protocol's standing objects, read from that protocol's own
   * authority, on the same terms as the activity route above: an authority
   * that cannot answer is a 502, an unconfigured one is a served page
   * saying so, and a protocol with no objects route this explorer reads is
   * a 404 that names that fact.
   */
  @Get('protocols/:protocolId/objects')
  @Header('Cache-Control', 'no-store')
  async protocolObjects(
    @Param('protocolId') protocolId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('chain') chain?: string,
    @Query('network') network?: string,
  ): Promise<ExplorerProtocolObjectsPage> {
    const context = parseExplorerContext(chain, network);
    if (
      typeof protocolId !== 'string' ||
      !/^[a-z0-9_-]{1,64}$/.test(protocolId)
    ) {
      throw new BadRequestException(
        'A protocol id is a short lowercase registry id',
      );
    }
    const resolved = resolveExplorerProtocol(protocolId);
    if (resolved) protocolId = resolved.id;
    if (!resolved) {
      throw new NotFoundException({
        schemaVersion: 'universe-protocol-objects-v1',
        protocolId,
        state: 'unsupported',
        degradedReason: 'The registry does not publish this protocol.',
      });
    }
    if (!this.objects.supports(protocolId)) {
      throw new NotFoundException({
        schemaVersion: 'universe-protocol-objects-v1',
        protocolId,
        state: 'unsupported',
        degradedReason:
          'This protocol has an authority in the registry but no objects route yet.',
      });
    }
    const query = parseProtocolActivityQuery({ cursor, limit });
    if (!query) {
      throw new BadRequestException(
        'A cursor is an opaque token the authority issued and a limit is a small count',
      );
    }
    const result = await this.objects.objects(
      protocolId,
      query.cursor,
      query.limit,
      context,
    );
    if (result.ok) {
      if (result.page.state === 'unavailable') {
        throw new BadGatewayException(result.page);
      }
      return result.page;
    }
    throw new NotFoundException({
      schemaVersion: 'universe-protocol-objects-v1',
      protocolId,
      state: 'unsupported',
      degradedReason: 'The registry does not publish this protocol.',
    });
  }

  @Get('status')
  @Header('Cache-Control', 'no-store')
  async status(
    @Query('chain') chain?: string,
    @Query('network') network?: string,
  ): Promise<{
    registryVersion: string;
    protocolCount: number;
    sources: ExplorerSourceCounts;
    generatedAt: string;
  }> {
    const context = parseExplorerContext(chain, network);
    const counts: ExplorerSourceCounts = {
      configured: 0,
      ready: 0,
      stale: 0,
      degraded: 0,
      unreachable: 0,
    };
    for (const source of await this.sources.snapshot()) {
      if (
        !sameExplorerContext(
          source.checkpoint ?? {
            chain: source.chain ?? 'bitcoin',
            network: source.network ?? 'mainnet',
          },
          context,
        )
      )
        continue;
      counts.configured += 1;
      const status = explorerSourceStatus(source);
      if (status === 'ready') counts.ready += 1;
      else if (status === 'stale') counts.stale += 1;
      else if (status === 'unreachable') counts.unreachable += 1;
      else counts.degraded += 1;
    }
    return {
      registryVersion: EXPLORER_REGISTRY_VERSION,
      protocolCount: explorerProtocolManifest().length,
      sources: counts,
      generatedAt: new Date().toISOString(),
    };
  }

  @Get('sources')
  @Header('Cache-Control', 'no-store')
  async listSources(
    @Query('chain') chain?: string,
    @Query('network') network?: string,
  ): Promise<{
    generatedAt: string;
    sources: ExplorerPublicSourceView[];
  }> {
    const context = parseExplorerContext(chain, network);
    const generatedAt = new Date().toISOString();
    const views = new Map<string, ExplorerPublicSourceView>();
    for (const source of await this.sources.snapshot()) {
      if (
        !sameExplorerContext(
          source.checkpoint ?? {
            chain: source.chain ?? 'bitcoin',
            network: source.network ?? 'mainnet',
          },
          context,
        )
      )
        continue;
      views.set(source.authorityId, {
        chain: context.chain,
        network: context.network,
        authorityId: source.authorityId,
        protocols: source.protocols,
        ready: source.ready,
        checkpoint: source.checkpoint
          ? {
              ...source.checkpoint,
              heightAtomic: source.checkpoint.heightAtomic,
              blockHash: source.checkpoint.blockHash,
              observedAt: source.checkpoint.observedAt,
            }
          : null,
        status: explorerSourceStatus(source),
        checkedAt: source.checkedAt,
        ...(source.measurementPending ? { measurementPending: true } : {}),
        lagBlocks: source.lagBlocks,
        lastSuccessAt: source.lastSuccessAt,
        lastAnsweredAt: source.lastAnsweredAt,
        consecutiveFailures: source.consecutiveFailures,
      });
    }
    const protocols = explorerProtocolManifest().filter(
      (protocol) =>
        protocol.chain === context.chain &&
        protocol.networks.includes(context.network),
    );
    for (const protocol of protocols) {
      const authorityId = protocol.indexerAuthority;
      if (!authorityId || views.has(authorityId)) continue;
      views.set(authorityId, {
        chain: context.chain,
        network: context.network,
        authorityId,
        protocols: protocols
          .filter((p) => p.indexerAuthority === authorityId)
          .map((p) => p.id),
        ready: false,
        checkpoint: null,
        status: 'unconfigured',
        checkedAt: generatedAt,
        lagBlocks: null,
        lastSuccessAt: null,
        lastAnsweredAt: null,
        consecutiveFailures: 0,
      });
    }
    return {
      generatedAt,
      sources: [...views.values()].sort((a, b) =>
        a.authorityId.localeCompare(b.authorityId),
      ),
    };
  }

  /**
   * Current availability per protocol.
   *
   * The protocols page needs one answer per protocol, and it needs runtime
   * availability to outrank registry capability. Deriving that here means the
   * ordering is decided once, next to the snapshot it comes from, instead of
   * in every client that renders a badge.
   */
  @Get('availability')
  @Header('Cache-Control', 'no-store')
  async availability(
    @Query('chain') chain?: string,
    @Query('network') network?: string,
  ): Promise<{
    generatedAt: string;
    protocols: ExplorerProtocolAvailabilityView[];
  }> {
    const context = parseExplorerContext(chain, network);
    const generatedAt = new Date().toISOString();
    const byAuthority = new Map<
      string,
      {
        protocols: readonly string[];
        status: ExplorerSourcePublicStatus;
        lagBlocks: string | null;
        checkedAt: string;
        lastSuccessAt: string | null;
      }
    >();
    for (const source of await this.sources.snapshot()) {
      if (
        !sameExplorerContext(
          source.checkpoint ?? {
            chain: source.chain ?? 'bitcoin',
            network: source.network ?? 'mainnet',
          },
          context,
        )
      )
        continue;
      byAuthority.set(source.authorityId, {
        protocols: source.protocols,
        status: explorerSourceStatus(source),
        lagBlocks: source.lagBlocks,
        checkedAt: source.checkedAt,
        lastSuccessAt: source.lastSuccessAt,
      });
    }

    const protocols = explorerProtocolManifest().map((protocol) => {
      const authorityId = protocol.indexerAuthority ?? null;
      const authority = authorityId ? byAuthority.get(authorityId) : undefined;
      // Authority ids identify deployments, not protocol capabilities. A
      // deployment must explicitly claim this protocol before its health can
      // make the protocol readable. Otherwise one healthy route can
      // accidentally promote every registry entry that shares its authority
      // id (for example OP_RETURN making OP_NAMES look available).
      const observed = authority?.protocols.includes(protocol.id)
        ? authority
        : undefined;
      return {
        protocolId: protocol.id,
        authorityId,
        availability: protocolAvailabilityFrom(
          observed?.status ?? null,
          protocol.releaseStatus,
          protocol.implementedReadOperations,
        ),
        capability: protocol.releaseStatus,
        implementedReadOperations: protocol.implementedReadOperations,
        authorityAvailability: observed?.status ?? 'unconfigured',
        lagBlocks: observed?.lagBlocks ?? null,
        checkedAt: observed?.checkedAt ?? null,
        lastSuccessAt: observed?.lastSuccessAt ?? null,
      };
    });

    return { generatedAt, protocols };
  }
}
