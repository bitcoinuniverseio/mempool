// The shapes `/api/v1/node/*` answers with.
//
// Every section carries its own state. A section that is unavailable says so
// with the node's own words; it never arrives as an empty object, because an
// empty object and a quiet node are the same shape and cannot be told apart.

export type SectionState = 'ready' | 'unavailable';

export interface Section<T> {
  readonly state: SectionState;
  readonly data: T | null;
  readonly reason: string | null;
}

export interface ChainSection {
  readonly chain: string;
  readonly blocks: number;
  readonly headers: number;
  readonly initialBlockDownload: boolean;
  readonly verificationProgress: number;
  readonly pruned: boolean;
  readonly sizeOnDiskBytes: number | null;
  readonly difficulty: number | null;
  readonly blocksBehindHeaders: number;
}

export interface IndexSection {
  readonly name: string;
  readonly synced: boolean;
  readonly bestBlockHeight: number;
}

export interface MempoolSection {
  readonly transactionCount: number;
  readonly virtualSize: number;
  readonly usageBytes: number;
  readonly maxMempoolBytes: number;
  readonly minRelayFeeSatPerVb: number;
  readonly incrementalRelayFeeSatPerVb: number;
  readonly mempoolMinFeeSatPerVb: number;
  readonly fullReplacementEnabled: boolean;
  /** False on a release too old to have the setting, which is not the same as off. */
  readonly fullReplacementReported: boolean;
}

export interface NetworkSection {
  readonly version: number;
  readonly subversion: string;
  readonly protocolVersion: number;
  readonly connections: number;
  readonly connectionsIn: number;
  readonly connectionsOut: number;
  readonly reachable: string[];
  readonly relayFeeSatPerVb: number;
}

export interface PeerSummary {
  readonly network: string;
  readonly inbound: number;
  readonly outbound: number;
  readonly relaying: number;
}

export interface PeersSection {
  readonly total: number;
  readonly byNetwork: PeerSummary[];
  readonly versions: { subversion: string; count: number }[];
  readonly oldestConnectionSeconds: number | null;
}

export interface NodeOverview {
  readonly observedAt: string;
  readonly chain: Section<ChainSection>;
  readonly indexes: Section<IndexSection[]>;
  readonly mempool: Section<MempoolSection>;
  readonly network: Section<NetworkSection>;
  readonly peers: Section<PeersSection>;
}

export interface RpcParam {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly description: string;
  readonly max?: number;
}

export interface RpcMethod {
  readonly name: string;
  readonly category: 'chain' | 'mempool' | 'network' | 'mining' | 'decode';
  readonly summary: string;
  readonly params: RpcParam[];
  readonly immutable: boolean;
  /** True when the answer is trimmed before it leaves the server. */
  readonly redacted: boolean;
  readonly redactionNote: string | null;
}

export interface RpcCatalog {
  readonly methods: RpcMethod[];
  readonly note: string;
}

export interface RpcResult {
  readonly method: string;
  /** The arguments the server actually used, after checking them. */
  readonly args: unknown[];
  readonly result: unknown;
  readonly redacted: boolean;
  readonly redactionNote: string | null;
}
