import { arkService } from './ark.service';

const unavailable = {
  name: 'FirstPartyDataUnavailableError',
  code: 'first-party-data-unavailable',
  statusCode: 503,
  capability: 'ark',
};

describe('ArkService', () => {
  it('never substitutes production fixtures for missing first-party data', () =>
    Promise.all([
      expect(arkService.$getOperators()).rejects.toMatchObject(unavailable),
      expect(arkService.$getBatches()).rejects.toMatchObject(unavailable),
      expect(arkService.$getBatch('batch-id')).rejects.toMatchObject(
        unavailable
      ),
      expect(arkService.$getVtxo('vtxo-id')).rejects.toMatchObject(unavailable),
      expect(arkService.$getVirtualTxs()).rejects.toMatchObject(unavailable),
    ]));

  it('fails proof verification closed without a semantic verifier', () =>
    Promise.all([
      expect(arkService.$verifyProof('vtxo-id', [])).rejects.toMatchObject(
        unavailable
      ),
      expect(
        arkService.$verifyProof('vtxo-id', ['plausible-node'])
      ).rejects.toMatchObject(unavailable),
    ]));
});
