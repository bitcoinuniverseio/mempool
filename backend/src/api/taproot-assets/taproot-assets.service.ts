import {
  Bolt12Offer,
  LightningRfqQuote,
  TaprootAssetGroup,
  TaprootAssetItem,
} from './taproot-assets.types';

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
  'Taproot Assets observations are unavailable. Asset, group and proof reads require the owned asset Universe (tapd) and Bitcoin anchor reader, which are not connected on this deployment.';

const offersUnavailable =
  'BOLT12 offer observations are unavailable. Offer decoding and validity require the owned Lightning node offer source, which is not connected on this deployment.';

const rfqUnavailable =
  'Lightning RFQ observations are unavailable. Quotes require the owned RFQ price source with actual expiry, which is not connected on this deployment.';

/**
 * Taproot Assets, BOLT12 offers and Lightning RFQ evidence.
 *
 * The revision this replaces answered the five reads from constants: two
 * assets with invented genesis points and anchors, two groups, one offer that
 * claimed to be valid with nothing having decoded it, and one quote whose
 * expiry was fixed when the module loaded and so was stale for the life of
 * the process. A reader could not tell those from observations, and the
 * offer's validity and the quote's expiry are exactly the fields a reader
 * acts on.
 *
 * Each read now names the integration it is waiting on. An empty directory
 * and an absent directory are different answers: this deployment can give
 * neither for assets, so it says so rather than returning an empty list.
 */
export class TaprootAssetsService {
  /** @asyncSafe */
  public async $getAssets(): Promise<TaprootAssetItem[]> {
    throw new TaprootAssetsEvidenceError('unavailable-universe', universeUnavailable);
  }

  /** @asyncSafe */
  public async $getAsset(_assetId: string): Promise<TaprootAssetItem | null> {
    throw new TaprootAssetsEvidenceError('unavailable-universe', universeUnavailable);
  }

  /** @asyncSafe */
  public async $getGroups(): Promise<TaprootAssetGroup[]> {
    throw new TaprootAssetsEvidenceError('unavailable-universe', universeUnavailable);
  }

  /** @asyncSafe */
  public async $getOffers(): Promise<Bolt12Offer[]> {
    throw new TaprootAssetsEvidenceError('unavailable-offer-source', offersUnavailable);
  }

  /** @asyncSafe */
  public async $getRfqQuotes(): Promise<LightningRfqQuote[]> {
    throw new TaprootAssetsEvidenceError('unavailable-rfq-source', rfqUnavailable);
  }

  /** @asyncSafe */
  public async $verifyProof(assetId: string, proofData: string): Promise<{
    valid: false; stage: 'invalid-input' | 'unavailable-verifier'; error: string;
  }> {
    if (typeof assetId !== 'string' || !/^[0-9a-f]{64}$/i.test(assetId)
      || typeof proofData !== 'string' || !proofData.trim() || proofData.length > 1024 * 1024) {
      return { valid: false, stage: 'invalid-input', error: 'A 32-byte hexadecimal asset ID and a nonempty proof payload of at most 1 MiB are required.' };
    }
    return {
      valid: false, stage: 'unavailable-verifier',
      error: 'The Taproot Assets proof verifier and owned Bitcoin anchor reader are not connected. No asset commitment or anchor was verified.',
    };
  }
}

export const taprootAssetsService = new TaprootAssetsService();
