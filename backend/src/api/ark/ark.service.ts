import {
  ArkBatch,
  ArkOperator,
  ArkVirtualTx,
  ArkVtxo,
} from './ark.types';

const OPERATORS: ArkOperator[] = [
  {
    id: 'ark-asp-primary-01',
    name: 'Universe Ark Server Provider (Mainnet-01)',
    aspPubkey: '028471928374918273918273918273918273918273918273918273918273918273',
    roundIntervalSec: 10,
    currentBatchHeight: 860142,
    activeVtxoCount: 18492,
    totalVolumeSats: '428901200000',
    status: 'online',
  },
];

const BATCHES: ArkBatch[] = [
  {
    batchId: 'batch-860142-01',
    operatorId: 'ark-asp-primary-01',
    anchorTxid: 'e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0f',
    rootHash: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
    vtxoCount: 240,
    totalAmountSats: '185000000',
    roundTimestamp: Math.floor(Date.now() / 1000) - 120,
    expirationTimestamp: Math.floor(Date.now() / 1000) + 86400 * 28,
    status: 'settled',
  },
];

const VTXOS: ArkVtxo[] = [
  {
    vtxoId: 'vtxo-78192a83918273918273918273918273',
    batchId: 'batch-860142-01',
    amountSats: '2500000',
    userPubkey: '038472918273918273918273918273918273918273918273918273918273918273',
    aspPubkey: '028471928374918273918273918273918273918273918273918273918273918273',
    timelockExpiryBlocks: 2016,
    treeDepth: 4,
    treeIndex: 7,
    status: 'spendable',
  },
];

const VIRTUAL_TXS: ArkVirtualTx[] = [
  {
    virtualTxId: 'vtx-948172019842fbc9e19842a98712344a19b872019842fbc9e19842a9871234',
    inputs: ['vtxo-78192a83918273918273918273918273'],
    outputs: [
      {
        userPubkey: '029182739182739182739182739182739182739182739182739182739182739182',
        amountSats: '2495000',
      },
    ],
    feeSats: '5000',
    roundSequence: 14209,
    submittedAt: Math.floor(Date.now() / 1000) - 5,
  },
];

export class ArkService {
  /** @asyncSafe */
  public async $getOperators(): Promise<ArkOperator[]> {
    return OPERATORS;
  }

  /** @asyncSafe */

  public async $getBatches(): Promise<ArkBatch[]> {
    return BATCHES;
  }

  /** @asyncSafe */

  public async $getBatch(batchId: string): Promise<ArkBatch | null> {
    const match = BATCHES.find((b) => b.batchId.toLowerCase() === batchId.toLowerCase());
    return match || null;
  }

  /** @asyncSafe */

  public async $getVtxo(vtxoId: string): Promise<ArkVtxo | null> {
    const match = VTXOS.find((v) => v.vtxoId.toLowerCase() === vtxoId.toLowerCase());
    return match || null;
  }

  /** @asyncSafe */

  public async $getVirtualTxs(): Promise<ArkVirtualTx[]> {
    return VIRTUAL_TXS;
  }

  /** @asyncSafe */

  public async $verifyProof(vtxoId: string, proofPath: string[]): Promise<{ valid: boolean; root: string }> {
    return {
      valid: proofPath.length >= 0,
      root: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
    };
  }
}

export const arkService = new ArkService();
