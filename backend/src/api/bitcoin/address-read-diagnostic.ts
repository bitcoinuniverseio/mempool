import { performance } from 'perf_hooks';

const PHASES = ['checkpoint-before', 'address-validation', 'balance-first', 'http-summary-first',
  'http-summary-repeat', 'balance-repeat', 'checkpoint-after'] as const;
export type AddressReadPhase = typeof PHASES[number];
export type AddressReadFailure = 'caller-cancelled' | 'operation-deadline' | 'source-disagreement' | 'upstream-failure';
export interface AddressReadDiagnostic {
  readonly schemaVersion: 'universe-private-address-read-diagnostic-v1';
  readonly operation: 'summary';
  readonly phase: AddressReadPhase | 'unknown';
  readonly category: AddressReadFailure;
  readonly elapsedMs: number | null;
  readonly phaseElapsedMs: number | null;
  readonly consumerDeadlineMs: number;
}
export type AddressReadReporter = (record: AddressReadDiagnostic) => void | Promise<void>;
export interface AddressReadDiagnosticOptions { readonly report?: AddressReadReporter; readonly now?: () => number; }

export function addressReadFailure(error: unknown): AddressReadFailure {
  return (error as { code?: unknown } | null)?.code === 'EADDRESSSOURCE' ? 'source-disagreement' : 'upstream-failure';
}

/** A failure observation, never a native source timestamp or native owner deadline. */
export class AddressReadTrace {
  private phase: AddressReadPhase | 'unknown' = 'unknown';
  private phaseStart: number | null = null;
  private readonly start: number | null;
  private ended = false;
  constructor(private readonly consumerDeadlineMs: number, private readonly report: AddressReadReporter,
    private readonly now: () => number = (): number => performance.now()) { this.start = this.time(); }
  private time(): number | null {
    try { const value = this.now(); return Number.isFinite(value) ? value : null; } catch { return null; }
  }
  private elapsed(start: number | null, end: number | null): number | null {
    const value = start === null || end === null ? NaN : end - start;
    return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? Math.round(value) : null;
  }
  mark(phase: AddressReadPhase): void {
    if (this.ended) { return; }
    this.phase = PHASES.includes(phase) ? phase : 'unknown';
    this.phaseStart = this.phase === 'unknown' ? null : this.time();
  }
  close(): void { this.ended = true; }
  failure(category: AddressReadFailure): void {
    if (this.ended) { return; }
    this.ended = true;
    const now = this.time();
    const record: AddressReadDiagnostic = { schemaVersion: 'universe-private-address-read-diagnostic-v1',
      operation: 'summary', phase: this.phase, category, elapsedMs: this.elapsed(this.start, now),
      phaseElapsedMs: this.elapsed(this.phaseStart, now), consumerDeadlineMs: this.consumerDeadlineMs };
    try {
      const result = this.report(record);
      if (result && typeof result.then === 'function') { Promise.resolve(result).catch(() => { /* Reporting cannot affect source ownership or its error. */ }); }
    } catch { /* Reporting cannot replace the original source error. */ }
  }
}
