import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { IncidentMonitor } from './incident-monitor';
import { IncidentLedger } from './incident-ledger';
import { IncidentProfile } from './incident-types';
const profile: IncidentProfile = { schema: 'universe-incident-profile-v1', network: 'signet', stale_after_seconds: 30,
  sources: [{ source_id: 'own', independence_id: 'own-instance', implementation: 'bitcoin-core', source_revision: null,
    binary_sha256: '1'.repeat(64), configuration_sha256: '2'.repeat(64), genesis_hash: '3'.repeat(64), block_one_hash: '4'.repeat(64), signet_challenge: '51' }] };
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'incident-monitor-owned-')); });
afterEach(() => { jest.useRealTimers(); rmSync(dir, { recursive: true, force: true }); });
it('rejects a foreign network before any native call', async () => {
  const call = jest.fn(), ledger = new IncidentLedger(join(dir, 'ledger'), profile), monitor = new IncidentMonitor(ledger, new Map([['own', { call }]]));
  try { await expect(monitor.observe('mainnet')).rejects.toMatchObject({ code: 'incident-network-mismatch', status: 400 }); expect(call).not.toHaveBeenCalled(); }
  finally { monitor.close(); }
});
it('shares only a currently active observation and preserves prior state when the source fails', async () => {
  let reject!: (error: Error) => void;
  const call = jest.fn(() => new Promise((_, no) => { reject = no; }));
  const ledger = new IncidentLedger(join(dir, 'ledger'), profile), monitor = new IncidentMonitor(ledger, new Map([['own', { call }]]));
  try {
    const a = monitor.observe('signet'), b = monitor.observe('signet'); expect(a).toBe(b); expect(call).toHaveBeenCalledTimes(1);
    reject(Error('Controlled source outage')); await expect(a).rejects.toThrow();
    const view = ledger.view(); expect(view.count).toBe(0); expect(view.coverage.observation_count).toBe(0); expect(view.coverage.gaps[0].reason).toBe('source-unavailable');
  } finally { monitor.close(); }
});
it('enforces the total deadline and prevents late writes/new native calls when transport ignores cancellation', async () => {
  jest.useFakeTimers(); let resolve!: (value: unknown) => void;
  const call = jest.fn(() => new Promise(yes => { resolve = yes; }));
  const file = join(dir, 'ledger'), ledger = new IncidentLedger(file, profile), monitor = new IncidentMonitor(ledger, new Map([['own', { call }]]));
  try {
    const request = monitor.observe('signet'); const assertion = expect(request).rejects.toMatchObject({ code: 'incident-deadline', status: 504 });
    await jest.advanceTimersByTimeAsync(15000); await assertion;
    const committed = readFileSync(file); resolve({ chain: 'signet', initialblockdownload: false, blocks: 1, bestblockhash: '4'.repeat(64), signet_challenge: '51' });
    await Promise.resolve(); await Promise.resolve(); expect(readFileSync(file)).toEqual(committed); expect(call).toHaveBeenCalledTimes(1);
  } finally { monitor.close(); }
});
it('unrefs background polling and closes its timer and writer ownership', () => {
  const ledger = new IncidentLedger(join(dir, 'ledger'), profile), monitor = new IncidentMonitor(ledger, new Map([['own', { call: jest.fn() }]]));
  monitor.start(); const timer = (monitor as any).timer as NodeJS.Timeout;
  expect(timer.hasRef()).toBe(false); monitor.close(); expect((timer as any)._destroyed).toBe(true);
});
it('refuses changed registration bytes and changed ledger binding without resetting history', async () => {
  const file = join(dir, 'registration.json'), ledgerPath = join(dir, 'ledger');
  writeFileSync(file, JSON.stringify({ profile, readers: [{ source_id: 'own', origin: 'http://127.0.0.1:1', cookie_file: join(dir, 'cookie') }] }), { mode: 0o600 });
  const beforeProfile = process.env.UNIVERSE_INCIDENT_PROFILE_FILE, beforeLedger = process.env.UNIVERSE_INCIDENT_LEDGER_FILE;
  process.env.UNIVERSE_INCIDENT_PROFILE_FILE = file; process.env.UNIVERSE_INCIDENT_LEDGER_FILE = ledgerPath;
  let monitor: IncidentMonitor | undefined;
  try {
    let factory: typeof import('./incident-monitor').configuredIncidentMonitor;
    jest.isolateModules(() => { factory = require('./incident-monitor').configuredIncidentMonitor; });
    monitor = await factory!(); const original = readFileSync(ledgerPath);
    process.env.UNIVERSE_INCIDENT_LEDGER_FILE = join(dir, 'foreign'); await expect(factory!()).rejects.toMatchObject({ code: 'incident-registration-changed' });
    process.env.UNIVERSE_INCIDENT_LEDGER_FILE = ledgerPath; writeFileSync(file, readFileSync(file, 'utf8') + '\n');
    await expect(factory!()).rejects.toMatchObject({ code: 'incident-registration-changed' }); expect(readFileSync(ledgerPath)).toEqual(original);
  } finally {
    monitor?.close(); if (beforeProfile === undefined) delete process.env.UNIVERSE_INCIDENT_PROFILE_FILE; else process.env.UNIVERSE_INCIDENT_PROFILE_FILE = beforeProfile;
    if (beforeLedger === undefined) delete process.env.UNIVERSE_INCIDENT_LEDGER_FILE; else process.env.UNIVERSE_INCIDENT_LEDGER_FILE = beforeLedger;
  }
});
