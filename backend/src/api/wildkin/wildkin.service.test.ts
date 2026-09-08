import { wildkinService } from './wildkin.service';

const unavailable = {
  name: 'FirstPartyDataUnavailableError',
  code: 'first-party-data-unavailable',
  statusCode: 503,
  capability: 'wildkin',
};

describe('WildkinService', () => {
  it('never returns creature, braid, or status fixtures', () =>
    Promise.all([
      expect(wildkinService.$getStatus()).rejects.toMatchObject(unavailable),
      expect(wildkinService.$getCreatures()).rejects.toMatchObject(unavailable),
      expect(wildkinService.$getCreature('creature-id')).rejects.toMatchObject(
        unavailable
      ),
      expect(wildkinService.$getBraids()).rejects.toMatchObject(unavailable),
    ]));
});
