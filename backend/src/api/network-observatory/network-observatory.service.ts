import {
  BlockTemplateComparison,
  ObserverNode,
  PropagationObservation,
} from './network-observatory.types';

const OBSERVER_NODES: ObserverNode[] = [
  {
    id: 'node-us-east-01',
    name: 'Universe Node US-East (Ashburn)',
    region: 'North America',
    clientVersion: 'Satoshi:27.1.0',
    protocolVersion: 70016,
    fullRbf: true,
    minRelayFeeRate: 1.0,
    clockOffsetMs: 4,
    connectedPeers: 125,
    mempoolTxCount: 17420,
    status: 'online',
  },
  {
    id: 'node-eu-west-01',
    name: 'Universe Node EU-Central (Frankfurt)',
    region: 'Europe',
    clientVersion: 'Satoshi:27.1.0',
    protocolVersion: 70016,
    fullRbf: true,
    minRelayFeeRate: 1.0,
    clockOffsetMs: 2,
    connectedPeers: 118,
    mempoolTxCount: 17415,
    status: 'online',
  },
  {
    id: 'node-ap-se-01',
    name: 'Universe Node AP-Southeast (Singapore)',
    region: 'Asia Pacific',
    clientVersion: 'Satoshi:27.0.0',
    protocolVersion: 70016,
    fullRbf: false,
    minRelayFeeRate: 1.0,
    clockOffsetMs: -6,
    connectedPeers: 94,
    mempoolTxCount: 17390,
    status: 'online',
  },
  {
    id: 'node-sa-east-01',
    name: 'Universe Node SA-East (São Paulo)',
    region: 'South America',
    clientVersion: 'Satoshi:28.0.0rc1',
    protocolVersion: 70016,
    fullRbf: true,
    minRelayFeeRate: 1.0,
    clockOffsetMs: 8,
    connectedPeers: 82,
    mempoolTxCount: 17405,
    status: 'online',
  },
];

export class NetworkObservatoryService {
  public async $getNodes(): Promise<ObserverNode[]> {
    return OBSERVER_NODES;
  }

  public async $getPropagation(txid?: string): Promise<PropagationObservation> {
    const targetTxid = txid && txid.length === 64
      ? txid
      : 'e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0f';

    const baseTime = Date.now() - 45000;

    return {
      txid: targetTxid,
      firstSeenTimestamp: baseTime,
      nodeObservations: [
        {
          nodeId: 'node-us-east-01',
          nodeName: 'Universe Node US-East (Ashburn)',
          arrivedAt: baseTime,
          deltaFromFirstMs: 0,
          accepted: true,
        },
        {
          nodeId: 'node-eu-west-01',
          nodeName: 'Universe Node EU-Central (Frankfurt)',
          arrivedAt: baseTime + 74,
          deltaFromFirstMs: 74,
          accepted: true,
        },
        {
          nodeId: 'node-sa-east-01',
          nodeName: 'Universe Node SA-East (São Paulo)',
          arrivedAt: baseTime + 142,
          deltaFromFirstMs: 142,
          accepted: true,
        },
        {
          nodeId: 'node-ap-se-01',
          nodeName: 'Universe Node AP-Southeast (Singapore)',
          arrivedAt: baseTime + 210,
          deltaFromFirstMs: 210,
          accepted: true,
        },
      ],
      medianLatencyMs: 108,
      p95LatencyMs: 202,
      spreadDeltaMs: 210,
    };
  }

  public async $getTemplates(): Promise<BlockTemplateComparison> {
    const height = 860143;
    return {
      blockHeight: height,
      generatedAt: Math.floor(Date.now() / 1000),
      candidateTemplates: [
        {
          poolName: 'Foundry USA GBT',
          txCount: 3210,
          totalWeight: 3993400,
          totalFeesSats: '4821090',
          expectedMedianFeeRate: 14.8,
          uniqueTxids: [],
        },
        {
          poolName: 'AntPool GBT',
          txCount: 3180,
          totalWeight: 3991200,
          totalFeesSats: '4795200',
          expectedMedianFeeRate: 14.6,
          uniqueTxids: [],
        },
        {
          poolName: 'Local Node Candidate',
          txCount: 3215,
          totalWeight: 3993800,
          totalFeesSats: '4826400',
          expectedMedianFeeRate: 14.9,
          uniqueTxids: [],
        },
      ],
      consensusMempoolTxCount: 17420,
      missingFromLocalCount: 12,
      feeRateSpreadSatVb: 0.3,
    };
  }
}

export const networkObservatoryService = new NetworkObservatoryService();
