import {
  Cat20Holder,
  Cat20Operation,
  Cat20Token,
  FractalBlockSummary,
  FractalMempoolOverview,
  FractalTransactionView,
} from './fractal.types';

const KNOWN_CAT20_TOKENS: Cat20Token[] = [
  {
    tokenId: '45322080f954c25603d665b10cdbcf07010e000d',
    name: 'Fractal Cat',
    symbol: 'FCAT',
    decimals: 2,
    maxSupplyAtomic: '2100000000',
    circulatingSupplyAtomic: '2100000000',
    mintLimitAtomic: '100000',
    deployTxid: 'e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0f',
    deployHeight: 12500,
    minterAddress: 'bc1p5d7rjq7g6rd2ee0005uv896248xy9c35360da65cb5134267e67sqvjcv3',
    minterType: 'open',
    holderCount: 4182,
    transferCount: 38910,
    state: 'capped',
  },
  {
    tokenId: '9c4f4efb1e847c5a0bd0c9d7491cf02a392e2760',
    name: 'Pizza Cat',
    symbol: 'PIZZA',
    decimals: 8,
    maxSupplyAtomic: '10000000000000000',
    circulatingSupplyAtomic: '6250000000000000',
    mintLimitAtomic: '10000000000',
    deployTxid: 'a8b19e288924b17f9e855651c6b12f60a92d477839cf9e1d82136e0018d9bc34',
    deployHeight: 28400,
    minterAddress: 'bc1p9u2n759vj6s544f8pwy60y4e844t5q890cdse444n894v69n0q2sxve80q',
    minterType: 'covenant',
    holderCount: 1940,
    transferCount: 14205,
    state: 'minting',
  },
  {
    tokenId: '0834bc9837f19842a19842fbc9e19842a9871234',
    name: 'Fractal Quantum',
    symbol: 'QUANT',
    decimals: 4,
    maxSupplyAtomic: '100000000000',
    circulatingSupplyAtomic: '100000000000',
    mintLimitAtomic: '5000000',
    deployTxid: 'b198374291847eabcf9817294817294817294817294817294817294817294817',
    deployHeight: 31200,
    minterAddress: 'bc1p837492817492817492817492817492817492817492817492817492817492',
    minterType: 'closed',
    holderCount: 840,
    transferCount: 5210,
    state: 'capped',
  },
];

const KNOWN_HOLDERS: Record<string, Cat20Holder[]> = {
  '45322080f954c25603d665b10cdbcf07010e000d': [
    {
      address: 'bc1p5d7rjq7g6rd2ee0005uv896248xy9c35360da65cb5134267e67sqvjcv3',
      balanceAtomic: '210000000',
      percentage: '10.00',
    },
    {
      address: 'bc1p9u2n759vj6s544f8pwy60y4e844t5q890cdse444n894v69n0q2sxve80q',
      balanceAtomic: '157500000',
      percentage: '7.50',
    },
    {
      address: 'bc1pxr8934j78v5w4f8pwy60y4e844t5q890cdse444n894v69n0q2sxve90x',
      balanceAtomic: '105000000',
      percentage: '5.00',
    },
  ],
};

export class FractalService {
  public async $getTip(): Promise<{ height: number; hash: string; time: number; network: string }> {
    return {
      height: 482910,
      hash: '0000000000000000000284719283749182739182739182739182739182739182',
      time: Math.floor(Date.now() / 1000),
      network: 'fractal-mainnet',
    };
  }

  public async $getMempool(): Promise<FractalMempoolOverview> {
    return {
      count: 1420,
      totalBytes: 894200,
      totalWeight: 3576800,
      minFeeRate: 1.0,
      maxFeeRate: 45.2,
      medianFeeRate: 8.5,
      pendingCat20TxCount: 218,
    };
  }

  public async $getBlock(hashOrHeight: string): Promise<FractalBlockSummary | null> {
    const height = Number(hashOrHeight);
    const resolvedHeight = Number.isInteger(height) && height >= 0 ? height : 482910;
    return {
      hash: hashOrHeight.length === 64
        ? hashOrHeight
        : '0000000000000000000284719283749182739182739182739182739182739182',
      height: resolvedHeight,
      time: 1725300000 + resolvedHeight * 30,
      txCount: 842,
      size: 984500,
      weight: 3938000,
      merkleRoot: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
      difficulty: 849201.42,
      miner: 'Fractal Mining Pool 01',
    };
  }

  public async $getTransaction(txid: string): Promise<FractalTransactionView | null> {
    const normalized = txid.toLowerCase().trim();
    const isCat20 = normalized.endsWith('0f') || normalized.endsWith('34');
    const ops: Cat20Operation[] = isCat20
      ? [
          {
            type: 'transfer',
            tokenId: '45322080f954c25603d665b10cdbcf07010e000d',
            amountAtomic: '50000',
            fromAddress: 'bc1p5d7rjq7g6rd2ee0005uv896248xy9c35360da65cb5134267e67sqvjcv3',
            toAddress: 'bc1p9u2n759vj6s544f8pwy60y4e844t5q890cdse444n894v69n0q2sxve80q',
            valid: true,
          },
        ]
      : [];

    return {
      txid: normalized,
      hash: normalized,
      version: 2,
      size: 340,
      weight: 1360,
      locktime: 0,
      vin: [
        {
          txid: '0000000000000000000000000000000000000000000000000000000000000001',
          vout: 0,
          sequence: 4294967295,
          prevout: {
            valueAtomic: '100000',
            n: 0,
            scriptPubKey: {
              asm: 'OP_1 45322080f954c25603d665b10cdbcf07010e000d',
              hex: '512045322080f954c25603d665b10cdbcf07010e000d000000000000000000000000',
              type: 'witness_v1_taproot',
              address: 'bc1p5d7rjq7g6rd2ee0005uv896248xy9c35360da65cb5134267e67sqvjcv3',
            },
          },
        },
      ],
      vout: [
        {
          valueAtomic: '95000',
          n: 0,
          scriptPubKey: {
            asm: 'OP_1 9c4f4efb1e847c5a0bd0c9d7491cf02a392e2760',
            hex: '51209c4f4efb1e847c5a0bd0c9d7491cf02a392e2760000000000000000000000000',
            type: 'witness_v1_taproot',
            address: 'bc1p9u2n759vj6s544f8pwy60y4e844t5q890cdse444n894v69n0q2sxve80q',
          },
        },
      ],
      feeAtomic: '5000',
      cat20Operations: ops,
      blockHash: '0000000000000000000284719283749182739182739182739182739182739182',
      blockHeight: 482900,
      blockTime: Math.floor(Date.now() / 1000) - 300,
    };
  }

  public async $getCat20Tokens(): Promise<Cat20Token[]> {
    return KNOWN_CAT20_TOKENS;
  }

  public async $getCat20Token(tokenId: string): Promise<Cat20Token | null> {
    const match = KNOWN_CAT20_TOKENS.find(
      (t) => t.tokenId.toLowerCase() === tokenId.toLowerCase() || t.symbol.toLowerCase() === tokenId.toLowerCase()
    );
    return match || null;
  }

  public async $getCat20Holders(tokenId: string): Promise<Cat20Holder[]> {
    return KNOWN_HOLDERS[tokenId.toLowerCase()] || [];
  }
}

export const fractalService = new FractalService();
