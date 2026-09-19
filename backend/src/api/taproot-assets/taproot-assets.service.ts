import { ownedWorkbenchCore } from '../intelligence/workbench/workbench-core';
import { canonicalProof } from './taproot-proof';
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
/**
 * IMPLEMENTATION-HANDOFF [TX-07] TX-07-PUBLIC-PROOF-BOUNDARY
 * Coverage G16/T-taproot_assets-*; required scope reconciliation, not a claim
 * that every public Bitcoin commitment reveals an asset. R-TAPROOT-ASSETS.
 * 1. Keep this offered product in the inventory even though the 39-entry
 * Universe protocol manifest does not enumerate it. Add summary facts only
 * from a validated, explicitly public proof/asset publication bound to the
 * requested anchor tx, network and asset id. Never infer an amount from P2TR.
 * 2. Do not scan or publish a connected wallet's private list/proofs to populate
 * an unauthenticated tx page. Reuse an authorized public-proof read seam where
 * one exists; otherwise report not-publicly-observable and document the exact
 * publication prerequisite rather than returning zero or fabricating one unit.
 * 3. Keep proof authorization, visibility scope and validation state in the
 * summary-reader cache key. Proof unavailability must not hide independently
 * verified Rune/inscription assets on the same transaction.
 * Depends TX-01/02/06. Tests: existing Taproot Assets service/proof tests plus
 * new summary boundary tests: public validated proof, invalid/mismatched proof,
 * private proof not disclosed, missing proof, wrong network and reload. This
 * feature does not authorize new mints, wallet transfers or private-data export.
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
    const encoded = canonicalProof(proofData);
    if (!encoded) {
      return { valid: false, stage: 'invalid-input', error: 'The proof payload must be the base64 encoding of a Taproot Assets proof file.' };
    }
    try {
      const authority = this.resolveAuthority();
      if (!authority) {
        return {
          valid: false, stage: 'unavailable-verifier',
          error: 'The Taproot Assets proof verifier (owned tapd) and Bitcoin anchor reader are not connected. No asset commitment or anchor was verified.',
        };
      }
      return await authority.verifyProof(assetId, encoded);
    } catch (error) {
      if (error instanceof TapdError) {return { valid: false, stage: 'unavailable-verifier', error: error.message };}
      return { valid: false, stage: 'unavailable-verifier', error: 'The owned Taproot Assets verifier configuration or source is unavailable.' };
    }
  }

  /** @asyncSafe */
  private async read<T>(code: string, absent: string, operation: (authority: TapdAuthority) => Promise<T>): Promise<T> {
    try {
      const authority = this.resolveAuthority();
      if (!authority) {throw new TaprootAssetsEvidenceError(code, absent);}
      return await operation(authority);
    } catch (error) {
      if (error instanceof TaprootAssetsEvidenceError) throw error;
      if (error instanceof TapdError) {throw new TaprootAssetsEvidenceError(error.code, error.message);}
      throw new TaprootAssetsEvidenceError(code, 'The owned Taproot Assets source configuration or read is unavailable.');
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
    this.authority = tapd ? new TapdAuthority(config.MEMPOOL.NETWORK, axiosTapdHttp(tapd), ownedWorkbenchCore) : null;
    return this.authority;
  }
}

export const taprootAssetsService = new TaprootAssetsService();
