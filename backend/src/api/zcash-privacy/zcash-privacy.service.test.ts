import { zcashPrivacyService } from './zcash-privacy.service';

const unavailable = {
  name: 'FirstPartyDataUnavailableError',
  code: 'first-party-data-unavailable',
  statusCode: 503,
  capability: 'zcash-privacy',
};

describe('ZcashPrivacyService', () => {
  it('never returns privacy summary, pool, or upgrade fixtures', () =>
    Promise.all([
      expect(zcashPrivacyService.$getSummary()).rejects.toMatchObject(
        unavailable
      ),
      expect(zcashPrivacyService.$getPools()).rejects.toMatchObject(
        unavailable
      ),
      expect(zcashPrivacyService.$getUpgrades()).rejects.toMatchObject(
        unavailable
      ),
    ]));
});
