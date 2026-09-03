import { dataStudioService } from './data-studio.service';

describe('DataStudioService', () => {
  it('returns comprehensive dataset, stream, and mcp catalog', async () => {
    const catalog = await dataStudioService.$getCatalog();
    expect(catalog.datasets.length).toBeGreaterThan(0);
    expect(catalog.streams.length).toBeGreaterThan(0);
    expect(catalog.mcpTools.length).toBeGreaterThan(0);

    const blocksDataset = catalog.datasets.find((d) => d.id === 'bitcoin.blocks');
    expect(blocksDataset).toBeDefined();
    expect(blocksDataset?.fields.some((f) => f.name === 'height')).toBe(true);
  });

  it('executes structured query against bitcoin.blocks dataset', async () => {
    const result = await dataStudioService.$executeQuery({
      datasetId: 'bitcoin.blocks',
      limit: 2,
    });
    expect(result.datasetId).toBe('bitcoin.blocks');
    expect(result.rowCount).toBe(2);
    expect(result.columns.length).toBeGreaterThan(0);
    expect(result.executionTimeMs).toBeGreaterThan(0);
  });

  // @asyncUnsafe - the rejection is the expected outcome under test.
  it('throws for non-existent dataset query', async () => {
    // .then(success, failure): the two-argument form handles the rejection
    // explicitly, which is exactly the behaviour under test.
    await dataStudioService
      .$executeQuery({ datasetId: 'invalid.dataset' })
      .then(
        () => {
          throw new Error('expected the query to be rejected');
        },
        (error) => {
          expect(error).toBeDefined();
        },
      );
  });
});
