/** Public failures expose the phase, never protected native configuration. */
export class LiquidObservatoryEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}
