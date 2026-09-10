import config from '../../config';
import {
  Bolt12Offer,
  LightningRfqQuote,
  TaprootAssetGroup,
  TaprootAssetItem,
} from './taproot-assets.types';
import { TapdAuthority, TapdError, TaprootProofVerdict, axiosTapdHttp, tapdConfigFromEnvironment } from './taproot-assets.authority';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class TaprootAssetsEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const universeUnavailable =
  'Taproot Assets observations are unavailable. Asset, group and proof reads require the owned asset Universe (tapd, UNIVERSE_TAPD_ORIGIN with its macaroon) and Bitcoin anchor reader, which are not connected on this deployment.';

const offersUnavailable =
  'BOLT12 offer observations are unavailable. Offer decoding and validity require the owned Lightning node offer source, which is not connected on this deployment.';

const rfqUnavailable =
  'Lightning RFQ observations are unavailable. Quotes require the owned tapd RFQ source (UNIVERSE_TAPD_ORIGIN with its macaroon), which is not connected on this deployment.';

export interface TaprootAssetsServiceOptions {
  /** The owned tapd, or null when the deployment configured none. */
  authority?: TapdAuthority | null;
}

/**
 * Taproot Assets, BOLT12 offers and Lightning RFQ evidence.
 *
 * Assets, groups, quotes and proof verdicts come from the owned tapd named by
 * UNIVERSE_TAPD_ORIGIN, on the backend's own network, with every proof anchor
 * checked against the owned Bitcoin reader. A deployment that names no tapd
 * gets a 503 that says so: an empty directory and an absent directory are
 * different answers, and this never turns the second into the first. BOLT12
 * offers have no owned source yet and stay unavailable.
 */
export class TaprootAssetsService {
  private authority: TapdAuthority | null | undefined;

  constructor(private readonly options: TaprootAssetsServiceOptions = {}) {}

  /** @asyncSafe */
  public async $getAssets(): Promise<TaprootAssetItem[]> {
    return this.read('unavailable-universe', universeUnavailable, authority => authority.listAssets());
  }

  /** @asyncSafe */
  public async $getAsset(assetId: string): Promise<TaprootAssetItem | null> {
    if (typeof assetId !== 'string' || !/^[0-9a-f]{64}$/i.test(assetId)) {
      throw new TaprootAssetsEvidenceError('invalid-input', 'A 32-byte hexadecimal asset ID is required.', 400);
    }
    return this.read('unavailable-universe', universeUnavailable, authority => authority.getAsset(assetId));
  }

  /** @asyncSafe */
  public async $getGroups(): Promise<TaprootAssetGroup[]> {
    return this.read('unavailable-universe', universeUnavailable, authority => authority.listGroups());
  }

  /** @asyncSafe */
  public async $getOffers(): Promise<Bolt12Offer[]> {
    throw new TaprootAssetsEvidenceError('unavailable-offer-source', offersUnavailable);
  }

  /** @asyncSafe */
  public async $getRfqQuotes(): Promise<LightningRfqQuote[]> {
    return this.read('unavailable-rfq-source', rfqUnavailable, authority => authority.getRfqQuotes());
  }

  /** @asyncSafe */
  public async $verifyProof(assetId: string, proofData: string): Promise<TaprootProofVerdict> {
    if (typeof assetId !== 'string' || !/^[0-9a-f]{64}$/i.test(assetId)
      || typeof proofData !== 'string' || !proofData.trim() || proofData.length > 1024 * 1024) {
      return { valid: false, stage: 'invalid-input', error: 'A 32-byte hexadecimal asset ID and a nonempty proof payload of at most 1 MiB are required.' };
    }
    const encoded = proofData.replace(/[ \t\r\n]/g, '');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      return { valid: false, stage: 'invalid-input', error: 'The proof payload must be the base64 encoding of a Taproot Assets proof file.' };
    }
    const authority = this.resolveAuthority();
    if (!authority) {
      return {
        valid: false, stage: 'unavailable-verifier',
        error: 'The Taproot Assets proof verifier (owned tapd) and Bitcoin anchor reader are not connected. No asset commitment or anchor was verified.',
      };
    }
    try {
      return await authority.verifyProof(assetId, encoded);
    } catch (error) {
      if (error instanceof TapdError) {return { valid: false, stage: 'unavailable-verifier', error: error.message };}
      throw error;
    }
  }

  /** @asyncSafe */
  private async read<T>(code: string, absent: string, operation: (authority: TapdAuthority) => Promise<T>): Promise<T> {
    const authority = this.resolveAuthority();
    if (!authority) {throw new TaprootAssetsEvidenceError(code, absent);}
    try {
      return await operation(authority);
    } catch (error) {
      if (error instanceof TapdError) {throw new TaprootAssetsEvidenceError(error.code, error.message);}
      throw error;
    }
  }

  /** Built on first use so the environment is read once the process is configured. */
  private resolveAuthority(): TapdAuthority | null {
    if (this.authority !== undefined) {return this.authority;}
    if (this.options.authority !== undefined) {
      this.authority = this.options.authority;
      return this.authority;
    }
    const tapd = tapdConfigFromEnvironment();
    this.authority = tapd ? new TapdAuthority(config.MEMPOOL.NETWORK, axiosTapdHttp(tapd), {
      $getBlockHash: (height: number) => import('../bitcoin/bitcoin-api-factory').then(module => module.default.$getBlockHash(height)),
    }) : null;
    return this.authority;
  }
}

export const taprootAssetsService = new TaprootAssetsService();
