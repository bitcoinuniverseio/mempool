import { dataStudioService } from './data-studio.service';

const unavailable = {
  name: 'FirstPartyDataUnavailableError',
  code: 'first-party-data-unavailable',
  statusCode: 503,
  capability: 'data-studio',
};

describe('DataStudioService', () => {
  it('never advertises or queries fixture datasets in production', () =>
    Promise.all([
      expect(dataStudioService.$getCatalog()).rejects.toMatchObject(
        unavailable
      ),
      expect(
        dataStudioService.$executeQuery({ datasetId: 'bitcoin.blocks' })
      ).rejects.toMatchObject(unavailable),
      expect(
        dataStudioService.$executeQuery({ datasetId: 'unknown' })
      ).rejects.toMatchObject(unavailable),
    ]));
});
