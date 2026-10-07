/** Public source failures contain no credentials, caller-supplied origin or RPC payload. */
export class ZcashPrivacyEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}
