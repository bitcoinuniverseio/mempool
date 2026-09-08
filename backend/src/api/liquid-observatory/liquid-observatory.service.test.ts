import { liquidObservatoryService } from './liquid-observatory.service';

const unavailable = {
  name: 'FirstPartyDataUnavailableError',
  code: 'first-party-data-unavailable',
  statusCode: 503,
  capability: 'liquid-observatory',
};

describe('LiquidObservatoryService', () => {
  it('never returns asset, peg, or federation fixtures', () =>
    Promise.all([
      expect(liquidObservatoryService.$getSummary()).rejects.toMatchObject(
        unavailable
      ),
      expect(liquidObservatoryService.$getAssets()).rejects.toMatchObject(
        unavailable
      ),
      expect(
        liquidObservatoryService.$getAsset('asset-id')
      ).rejects.toMatchObject(unavailable),
      expect(liquidObservatoryService.$getPegs()).rejects.toMatchObject(
        unavailable
      ),
      expect(liquidObservatoryService.$getFederation()).rejects.toMatchObject(
        unavailable
      ),
    ]));
});
