import { networkObservatoryService } from './network-observatory.service';

const unavailable = {
  name: 'FirstPartyDataUnavailableError',
  code: 'first-party-data-unavailable',
  statusCode: 503,
  capability: 'network-observatory',
};

describe('NetworkObservatoryService', () => {
  it('never simulates node, propagation, or template observations', () =>
    Promise.all([
      expect(networkObservatoryService.$getNodes()).rejects.toMatchObject(
        unavailable
      ),
      expect(networkObservatoryService.$getPropagation()).rejects.toMatchObject(
        unavailable
      ),
      expect(
        networkObservatoryService.$getPropagation('transaction-id')
      ).rejects.toMatchObject(unavailable),
      expect(networkObservatoryService.$getTemplates()).rejects.toMatchObject(
        unavailable
      ),
    ]));
});
