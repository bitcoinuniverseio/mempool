import { utxoSetService } from './utxo-set.service';

const unavailable = {
  name: 'FirstPartyDataUnavailableError',
  code: 'first-party-data-unavailable',
  statusCode: 503,
  capability: 'utxo-set',
};

describe('UtxoSetService', () => {
  it('never returns checkpoint, distribution, protocol, or root fixtures', () =>
    Promise.all([
      expect(utxoSetService.$getCheckpoints()).rejects.toMatchObject(
        unavailable
      ),
      expect(utxoSetService.$getDistribution()).rejects.toMatchObject(
        unavailable
      ),
      expect(utxoSetService.$getProtocolUtxos()).rejects.toMatchObject(
        unavailable
      ),
      expect(utxoSetService.$getUtreexoRoots()).rejects.toMatchObject(
        unavailable
      ),
    ]));

  it('fails proof verification closed without a semantic verifier', () =>
    Promise.all([
      expect(utxoSetService.$verifyUtreexoProof([])).rejects.toMatchObject(
        unavailable
      ),
      expect(
        utxoSetService.$verifyUtreexoProof(['plausible-node'])
      ).rejects.toMatchObject(unavailable),
    ]));
});
