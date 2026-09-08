import { stratumV2Service } from './stratum-v2.service';

const unavailable = {
  name: 'FirstPartyDataUnavailableError',
  code: 'first-party-data-unavailable',
  statusCode: 503,
  capability: 'stratum-v2',
};

describe('StratumV2Service', () => {
  it('never returns role, template, or declaration fixtures', () =>
    Promise.all([
      expect(stratumV2Service.$getRoles()).rejects.toMatchObject(unavailable),
      expect(stratumV2Service.$getTemplates()).rejects.toMatchObject(
        unavailable
      ),
      expect(stratumV2Service.$getDeclarations()).rejects.toMatchObject(
        unavailable
      ),
    ]));
});
