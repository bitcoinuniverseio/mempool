export class LightningEvidenceError extends Error {
  constructor(public readonly code:string,message:string,public readonly status=503){super(message);}
}
export const LIGHTNING_SCOPE='Owned node snapshot only. Slot occupancy is not a jamming diagnosis. Hold durations, failure rates, onion queues and mitigation effectiveness require telemetry not provided by ListChannels.';
export const LIGHTNING_LIMITS={channels:1000,htlcsPerChannel:966,freshMs:30000,timeoutMs:10000,bodyBytes:8*1024*1024} as const;
