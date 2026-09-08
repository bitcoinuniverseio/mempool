import { fractalService } from './fractal.service';

const unavailable = {
  name: 'FirstPartyDataUnavailableError',
  code: 'first-party-data-unavailable',
  statusCode: 503,
  capability: 'fractal',
};

describe('FractalService', () => {
  it('never constructs chain or CAT-20 records without first-party data', () =>
    Promise.all([
      expect(fractalService.$getTip()).rejects.toMatchObject(unavailable),
      expect(fractalService.$getMempool()).rejects.toMatchObject(unavailable),
      expect(fractalService.$getBlock('100')).rejects.toMatchObject(
        unavailable
      ),
      expect(
        fractalService.$getTransaction('transaction-id')
      ).rejects.toMatchObject(unavailable),
      expect(fractalService.$getCat20Tokens()).rejects.toMatchObject(
        unavailable
      ),
      expect(fractalService.$getCat20Token('token-id')).rejects.toMatchObject(
        unavailable
      ),
      expect(fractalService.$getCat20Holders('token-id')).rejects.toMatchObject(
        unavailable
      ),
    ]));
});
