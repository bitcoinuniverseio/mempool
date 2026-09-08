import { taprootAssetsService } from './taproot-assets.service';

const unavailable = {
  name: 'FirstPartyDataUnavailableError',
  code: 'first-party-data-unavailable',
  statusCode: 503,
  capability: 'taproot-assets',
};

describe('TaprootAssetsService', () => {
  it('never returns asset, offer, or quote fixtures', () =>
    Promise.all([
      expect(taprootAssetsService.$getAssets()).rejects.toMatchObject(
        unavailable
      ),
      expect(taprootAssetsService.$getAsset('asset-id')).rejects.toMatchObject(
        unavailable
      ),
      expect(taprootAssetsService.$getGroups()).rejects.toMatchObject(
        unavailable
      ),
      expect(taprootAssetsService.$getOffers()).rejects.toMatchObject(
        unavailable
      ),
      expect(taprootAssetsService.$getRfqQuotes()).rejects.toMatchObject(
        unavailable
      ),
    ]));

  it('fails proof verification closed without a semantic verifier', () =>
    Promise.all([
      expect(
        taprootAssetsService.$verifyProof('asset-id', '')
      ).rejects.toMatchObject(unavailable),
      expect(
        taprootAssetsService.$verifyProof('asset-id', 'plausible-proof-data')
      ).rejects.toMatchObject(unavailable),
    ]));
});
