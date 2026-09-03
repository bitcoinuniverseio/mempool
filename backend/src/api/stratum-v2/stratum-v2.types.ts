/**
 * Types for Stratum V2 Job-Declaration and Template Observatory.
 */

export interface StratumV2RoleStatus {
  readonly role: 'mining-proxy' | 'job-declarator' | 'template-provider' | 'pool';
  readonly name: string;
  readonly endpoint: string;
  readonly noiseProtocolSecured: boolean;
  readonly negotiatedSubprotocols: readonly string[];
  readonly connectedDownstreams: number;
  readonly uptimeSec: number;
  readonly status: 'active' | 'degraded';
}

export interface StratumV2Template {
  readonly templateId: string;
  readonly blockHeight: number;
  readonly coinbaseTxValueSats: string;
  readonly declaredTxCount: number;
  readonly poolSelectedTxCount: number;
  readonly feeRateDeltaSatVb: number;
  readonly totalWeight: number;
  readonly status: 'mining' | 'superseded' | 'won';
  readonly generatedAt: number;
}

export interface StratumV2JobDeclaration {
  readonly jobId: string;
  readonly templateId: string;
  readonly declaratorId: string;
  readonly minerDeclaredTxids: readonly string[];
  readonly poolModifiedTxids: readonly string[];
  readonly acceptedByPool: boolean;
  readonly poolRejectionCode?: string;
  readonly latencyMs: number;
}
