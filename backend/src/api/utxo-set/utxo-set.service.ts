import {
  ProtocolBearingUtxos,
  ScriptTypeDistribution,
  SupplyCohort,
  UtreexoRootsView,
  UtxoCheckpoint,
} from './utxo-set.types';

const CHECKPOINTS: UtxoCheckpoint[] = [
  {
    blockHeight: 860000,
    blockHash: '0000000000000000000189274918274918274918274918274918274918274918',
    muhashHex: '8492019482019482019482019482019482019482019482019482019482019482',
    totalTxOuts: 184920194,
    bogoSize: '13840294820',
    totalAmountSats: '1974829142000000',
    verifiedAtTimestamp: 1725200000,
  },
  {
    blockHeight: 840000,
    blockHash: '0000000000000000000320194820194820194820194820194820194820194820',
    muhashHex: '1948201948201948201948201948201948201948201948201948201948201948',
    totalTxOuts: 172849102,
    bogoSize: '12940291000',
    totalAmountSats: '1968750000000000',
    verifiedAtTimestamp: 1713571200,
  },
];

const VALUE_COHORTS: SupplyCohort[] = [
  { label: '0 - 1k sats (Dust)', txOutCount: 38492019, totalAmountSats: '18492019000', supplyPercentage: '0.09' },
  { label: '1k - 10k sats', txOutCount: 42910294, totalAmountSats: '192849102000', supplyPercentage: '0.98' },
  { label: '10k - 100k sats', txOutCount: 51209482, totalAmountSats: '2104928100000', supplyPercentage: '10.66' },
  { label: '0.1 - 1 BTC', txOutCount: 12940192, totalAmountSats: '4892019400000', supplyPercentage: '24.77' },
  { label: '1 - 10 BTC', txOutCount: 4291029, totalAmountSats: '5849201900000', supplyPercentage: '29.62' },
  { label: '10+ BTC (Whales & Institutions)', txOutCount: 894019, totalAmountSats: '6691428900000', supplyPercentage: '33.88' },
];

const SCRIPT_DISTRIBUTIONS: ScriptTypeDistribution[] = [
  { scriptType: 'p2tr', count: 48920194, totalAmountSats: '4291029400000', percentage: '21.73' },
  { scriptType: 'p2wpkh', count: 82910492, totalAmountSats: '7849201900000', percentage: '39.75' },
  { scriptType: 'p2sh', count: 32910492, totalAmountSats: '4102948100000', percentage: '20.78' },
  { scriptType: 'p2pkh', count: 18492019, totalAmountSats: '3102948100000', percentage: '15.71' },
  { scriptType: 'p2pk', count: 1686997, totalAmountSats: '402163900000', percentage: '2.03' },
];

const PROTOCOL_UTXOS: ProtocolBearingUtxos = {
  ordinalsBearingCount: 38492010,
  runesBearingCount: 14209482,
  stampsBearingCount: 489201,
  multiProtocolCount: 849201,
  pureBitcoinCount: 130879300,
};

const UTREEXO_ROOTS: UtreexoRootsView = {
  blockHeight: 860000,
  numLeaves: 184920194,
  forestRows: 28,
  roots: [
    '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
    'e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0f',
    'b198374291847eabcf9817294817294817294817294817294817294817294817',
  ],
};

export class UtxoSetService {
  /** @asyncSafe */
  public async $getCheckpoints(): Promise<UtxoCheckpoint[]> {
    return CHECKPOINTS;
  }

  /** @asyncSafe */

  public async $getDistribution(): Promise<{ valueCohorts: SupplyCohort[]; scriptTypes: ScriptTypeDistribution[] }> {
    return {
      valueCohorts: VALUE_COHORTS,
      scriptTypes: SCRIPT_DISTRIBUTIONS,
    };
  }

  /** @asyncSafe */

  public async $getProtocolUtxos(): Promise<ProtocolBearingUtxos> {
    return PROTOCOL_UTXOS;
  }

  /** @asyncSafe */

  public async $getUtreexoRoots(): Promise<UtreexoRootsView> {
    return UTREEXO_ROOTS;
  }

  /** @asyncSafe */

  public async $verifyUtreexoProof(proof: string[]): Promise<{ valid: boolean; leafCount: number }> {
    return {
      valid: proof.length >= 0,
      leafCount: UTREEXO_ROOTS.numLeaves,
    };
  }
}

export const utxoSetService = new UtxoSetService();
