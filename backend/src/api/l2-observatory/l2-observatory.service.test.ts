import { l2ObservatoryService } from './l2-observatory.service';

const unavailable = {
  name: 'FirstPartyDataUnavailableError',
  code: 'first-party-data-unavailable',
  statusCode: 503,
  capability: 'l2-observatory',
};

describe('L2ObservatoryService', () => {
  it('never returns bridge, challenge, or reserve fixtures', () =>
    Promise.all([
      expect(l2ObservatoryService.$getSystems()).rejects.toMatchObject(
        unavailable
      ),
      expect(
        l2ObservatoryService.$getSystem('system-id')
      ).rejects.toMatchObject(unavailable),
      expect(l2ObservatoryService.$getChallenges()).rejects.toMatchObject(
        unavailable
      ),
      expect(
        l2ObservatoryService.$getChallenges('system-id')
      ).rejects.toMatchObject(unavailable),
      expect(
        l2ObservatoryService.$getReserveAudit('system-id')
      ).rejects.toMatchObject(unavailable),
    ]));
});
