import {
  L2BridgeSystem,
  L2Challenge,
  L2ReserveAudit,
} from './l2-observatory.types';

const SYSTEMS: L2BridgeSystem[] = [
  {
    id: 'bitvm2-permissionless',
    name: 'BitVM2 Universal Bridge',
    architecture: 'bitvm2',
    trustModel: '1-of-n',
    bridgeContractAddress: 'bc1pbitvm2bridgecontract8492019482019482019482019482019482019482',
    lockedBtcSats: '42500000000',
    operatorCount: 32,
    challengePeriodBlocks: 144,
    activeChallengesCount: 0,
    status: 'live',
    description: '1-of-N honest verifier optimistic bridge with SNARK verification inside Bitcoin Script.',
  },
  {
    id: 'citrea-clementine',
    name: 'Citrea Clementine Peg',
    architecture: 'clementine-bitvm',
    trustModel: '1-of-n',
    bridgeContractAddress: 'bc1pclementinereserve849201948201948201948201948201948201948201',
    lockedBtcSats: '128500000000',
    operatorCount: 16,
    challengePeriodBlocks: 288,
    activeChallengesCount: 1,
    status: 'live',
    description: 'Trust-minimized two-way peg protocol for the Citrea zero-knowledge rollup on Bitcoin.',
  },
  {
    id: 'bitlayer-bridge',
    name: 'Bitlayer BitVM Bridge',
    architecture: 'zk-rollup-bridge',
    trustModel: 'committee-attested',
    bridgeContractAddress: 'bc1pbitlayerbridge8492019482019482019482019482019482019482019482',
    lockedBtcSats: '89200000000',
    operatorCount: 21,
    challengePeriodBlocks: 144,
    activeChallengesCount: 0,
    status: 'live',
    description: 'BitVM fraud-proof verification bridge with threshold committee assertion.',
  },
];

const CHALLENGES: L2Challenge[] = [
  {
    challengeId: 'ch-citrea-849201',
    systemId: 'citrea-clementine',
    assertionTxid: 'e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0f',
    challengeTxid: 'b198374291847eabcf9817294817294817294817294817294817294817294817',
    assertBlockHeight: 860130,
    challengerAddress: 'bc1pchallenger849201948201948201948201948201948201948201948201',
    bondAmountSats: '10000000',
    status: 'pending_response',
    timeoutBlockHeight: 860418,
  },
];

const AUDIT: Record<string, L2ReserveAudit> = {
  'citrea-clementine': {
    systemId: 'citrea-clementine',
    totalLockedReserveSats: '128500000000',
    reportedL2SupplySats: '128500000000',
    reserveRatio: '1.0000',
    lastAuditHeight: 860142,
    reserveOutpoints: [
      {
        outpoint: 'e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0f:0',
        valueSats: '64250000000',
      },
      {
        outpoint: 'b198374291847eabcf9817294817294817294817294817294817294817294817:0',
        valueSats: '64250000000',
      },
    ],
  },
};

export class L2ObservatoryService {
  public async $getSystems(): Promise<L2BridgeSystem[]> {
    return SYSTEMS;
  }

  public async $getSystem(id: string): Promise<L2BridgeSystem | null> {
    const match = SYSTEMS.find((s) => s.id.toLowerCase() === id.toLowerCase());
    return match || null;
  }

  public async $getChallenges(systemId?: string): Promise<L2Challenge[]> {
    if (systemId) {
      return CHALLENGES.filter((c) => c.systemId.toLowerCase() === systemId.toLowerCase());
    }
    return CHALLENGES;
  }

  public async $getReserveAudit(systemId: string): Promise<L2ReserveAudit | null> {
    return AUDIT[systemId.toLowerCase()] || null;
  }
}

export const l2ObservatoryService = new L2ObservatoryService();
