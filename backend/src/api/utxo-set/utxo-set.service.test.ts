import { utxoSetService } from './utxo-set.service';

describe('UtxoSetService', () => {
  it('returns periodic coinstatsindex MuHash checkpoints', async () => {
    const checkpoints = await utxoSetService.$getCheckpoints();
    expect(checkpoints.length).toBeGreaterThan(0);
    expect(checkpoints[0].muhashHex).toHaveLength(64);
    expect(checkpoints[0].totalTxOuts).toBeGreaterThan(100000000);
  });

  it('provides value and script type cohort distributions', async () => {
    const dist = await utxoSetService.$getDistribution();
    expect(dist.valueCohorts.length).toBeGreaterThan(0);
    expect(dist.scriptTypes.length).toBeGreaterThan(0);
    const taproot = dist.scriptTypes.find((s) => s.scriptType === 'p2tr');
    expect(taproot).toBeDefined();
    expect(taproot?.count).toBeGreaterThan(0);
  });

  it('tracks protocol-bearing UTXO counts', async () => {
    const protocols = await utxoSetService.$getProtocolUtxos();
    expect(protocols.ordinalsBearingCount).toBeGreaterThan(0);
    expect(protocols.runesBearingCount).toBeGreaterThan(0);
    expect(protocols.pureBitcoinCount).toBeGreaterThan(0);
  });

  it('provides Utreexo accumulator root states', async () => {
    const utreexo = await utxoSetService.$getUtreexoRoots();
    expect(utreexo.numLeaves).toBeGreaterThan(0);
    expect(utreexo.roots.length).toBeGreaterThan(0);
  });
});
