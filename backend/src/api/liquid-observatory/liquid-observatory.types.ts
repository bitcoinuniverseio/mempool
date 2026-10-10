import { LiquidPairObservation } from './liquid-paired-source';
import { LiquidRegistryEntry } from './liquid-registry-publication';
import { LiquidPublicPegOutput, LiquidVerifiedPegInput } from './liquid-public-projection';

export interface LiquidObservatoryCoverage {
  schemaVersion: 'universe-liquid-observatory-v1';
  status: 'PARTIAL' | 'COMPLETE_AT_OBSERVED_PAIR';
  source: LiquidPairObservation;
  progress: { processedBlocks: number; expectedBlocks: number; nextHeight: number; pageLimit: 16 };
  cursor: { height: number; blockHash: string | null };
  scope: 'best-chain-public-blocks-and-parent-peg-evidence';
}
export interface LiquidAssetRecord extends LiquidRegistryEntry {
  coverage: LiquidObservatoryCoverage;
  publication: { revision: string; sha256: string; scope: string };
  initialIssuanceAmountAtomic: string | null;
  initialIssuanceAmountCommitment: string | null;
  circulatingAmount: null; issuerPubkey: null; hasProof: true;
}
export interface LiquidPegRecord extends LiquidVerifiedPegInput {
  id: string; type: 'peg-in'; liquidTxid: string; liquidVin: number;
  amountSats: string; status: 'confirmed'; confirmations: number;
  timestamp: number; liquidBlockHash: string; liquidBlockHeight: number;
  federationWitnessAddress: null;
}
export interface LiquidAssetPage {
  coverage: LiquidObservatoryCoverage; assets: LiquidAssetRecord[]; total: number;
  offset: number; limit: number; nextOffset: number | null;
  publication: { revision: string; sha256: string; scope: string };
}
export interface LiquidPegPage {
  coverage: LiquidObservatoryCoverage; pegs: LiquidPegRecord[]; total: number;
  offset: number; limit: number; nextOffset: number | null;
  pegOuts: { status: 'OBSERVED_REQUESTS_ONLY'; requests: LiquidPegOutRecord[]; total: number;
    nextOffset: number | null; parentPayoutStatus: 'UNKNOWN'; reason: string };
}
export interface LiquidPegOutRecord extends LiquidPublicPegOutput {
  id: string; type: 'peg-out'; status: 'request-confirmed'; confirmations: number;
  liquidBlockHash: string; liquidBlockHeight: number; timestamp: number;
  parentPayoutStatus: 'UNKNOWN'; bitcoinTxid: null;
}
export interface LiquidFederationEpoch {
  coverage: LiquidObservatoryCoverage;
  epochNumber: number; signblockscript: string; fedpegScript: string; fedpegProgram: string;
  parametersRoot: string; activeSigners: null; totalSigners: null; threshold: null;
  startHeight: number; endHeight: number; blockSignerCounts: null;
  observedFullParameterRecordsTotal: number; parameterHistoryLimit: 100;
  observedFullParameterRecords: { height: number; blockHash: string; parametersRoot: string; signblockScript: string }[];
}
export interface LiquidObservatorySummary {
  coverage: LiquidObservatoryCoverage; blockHeight: number; blockHash: string;
  dynamicFederation: { currentEpoch: number; signersOnline: null; totalSigners: null; blockSigningThreshold: null; parametersRoot: string };
  peggedReserveSats: null; activeAssetCount: null; confidentialTxPercentage: null;
  observedIssuanceCount: number;
  observedOutputCounts: { confidential: number; explicit: number; scope: 'projected-public-outputs'; amountsUnknown: true };
  recentPegs: LiquidPegRecord[];
}
