import { AddressReadTrace, addressReadFailure, AddressReadDiagnostic } from '../api/bitcoin/address-read-diagnostic';

it('reports one fixed privacy-safe failure phase with actual monotonic durations', () => {
  let now = 10;
  const records: AddressReadDiagnostic[] = [];
  const trace = new AddressReadTrace(15000, record => { records.push(record); }, () => now);
  now = 25; trace.mark('balance-first'); now = 30; trace.failure('operation-deadline');
  trace.mark('checkpoint-after'); trace.failure('caller-cancelled');
  expect(records).toEqual([{ schemaVersion: 'universe-private-address-read-diagnostic-v1', operation: 'summary',
    phase: 'balance-first', category: 'operation-deadline', elapsedMs: 20, phaseElapsedMs: 5, consumerDeadlineMs: 15000 }]);
  expect(Object.keys(records[0]).sort()).toEqual(['schemaVersion', 'operation', 'phase', 'category', 'elapsedMs', 'phaseElapsedMs', 'consumerDeadlineMs'].sort());
});

it('does not invent an entered phase or usable time when none was observed', () => {
  const report = jest.fn();
  const trace = new AddressReadTrace(15000, report, () => NaN);
  trace.failure('caller-cancelled');
  expect(report.mock.calls[0][0]).toMatchObject({ phase: 'unknown', elapsedMs: null, phaseElapsedMs: null });
});

it('classifies only safe source codes and never copies raw upstream data', () => {
  expect(addressReadFailure({ code: 'EADDRESSSOURCE', url: 'http://private/address/secret', message: 'credentials' })).toBe('source-disagreement');
  expect(addressReadFailure({ code: 'ETIMEDOUT', message: 'secret body' })).toBe('upstream-failure');
  expect(addressReadFailure(null)).toBe('upstream-failure');
});

it('isolates synchronous and asynchronous reporter failures without unhandled rejection', async () => {
  for (const report of [(): never => { throw Error('reporter failure'); }, (): Promise<never> => Promise.reject(Error('reporter failure'))]) {
    const trace = new AddressReadTrace(15000, report);
    expect(() => trace.failure('upstream-failure')).not.toThrow();
    await Promise.resolve(); await Promise.resolve();
  }
});

it('ready or already ended work emits nothing and backwards clocks remain unknown', () => {
  const report = jest.fn(); let now = 10;
  const ready = new AddressReadTrace(15000, report, () => now); ready.close(); ready.failure('upstream-failure');
  expect(report).not.toHaveBeenCalled();
  const backwards = new AddressReadTrace(15000, report, () => now); backwards.mark('checkpoint-before'); now = 1;
  backwards.failure('upstream-failure');
  expect(report.mock.calls[0][0]).toMatchObject({ elapsedMs: null, phaseElapsedMs: null });
});
