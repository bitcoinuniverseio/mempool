import { validateHistorySnapshot } from './history-validation';

/** Accept only integer satoshis or the rounding noise of a floating conversion. */
export function canonicalObservedFee(value: number): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(rounded)
    || Math.abs(value - rounded) > Math.min(0.000001, Number.EPSILON * Math.max(1, value))) {
    throw new Error('Observed fee must be a nonnegative integer number of satoshis.');
  }
  return rounded;
}

/** Explicit repair of legacy floating conversion noise; all other guards stay intact. */
export function migrateObservedFeeNoise(value: unknown, network: string, limits: { checkpoints: number; events: number }): { snapshot: ReturnType<typeof validateHistorySnapshot>; changed: number } {
  const candidate = value as { events?: Array<{ fee_sats: number; fee_rate: number; vsize: number }> };
  if (!candidate || !Array.isArray(candidate.events) || candidate.events.length > limits.events) {
    throw new Error('Invalid observed history snapshot.');
  }
  let changed = 0;
  const events = candidate.events.map(event => {
    if (!event || Number.isSafeInteger(event.fee_sats)) { return event; }
    const fee = canonicalObservedFee(event.fee_sats);
    const rate = event.vsize > 0 ? Math.round(fee / event.vsize * 100) / 100 : 0;
    const oldRate = event.vsize > 0 ? Math.round(event.fee_sats / event.vsize * 100) / 100 : 0;
    if (event.fee_rate !== oldRate || rate !== oldRate) {
      throw new Error('Legacy fee conversion does not preserve the observed fee rate.');
    }
    changed++;
    return { ...event, fee_sats: fee };
  });
  const snapshot = validateHistorySnapshot({ ...candidate, events }, network, limits);
  return { snapshot, changed };
}
