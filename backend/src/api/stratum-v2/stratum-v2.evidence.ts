export class StratumV2EvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) { super(message); }
}
export const invalid = (): StratumV2EvidenceError => new StratumV2EvidenceError('invalid-sv2-observation', 'The authenticated SV2 observation failed its source or wire contract.');
