import { IncidentLedger } from './incident-ledger';
import { IncidentCoreReader, IncidentRpcReader, incidentFailure, observeIncidentSource, readIncidentProtected, validateIncidentProfile } from './incident-source';
import { IncidentResponse } from './incident-types';
import { createHash } from 'crypto';

/** One bounded acquisition at a time; configured deployments may also call start() for cold polling. */
export class IncidentMonitor {
  private active: Promise<IncidentResponse> | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private controller: AbortController | undefined;
  private closed = false;
  constructor(public readonly ledger: IncidentLedger, private readonly readers: Map<string, IncidentCoreReader>, private readonly registrationGuard?: (signal: AbortSignal) => Promise<void>) {
    if (readers.size !== ledger.profile.sources.length || ledger.profile.sources.some(s => !readers.has(s.source_id))) throw incidentFailure('invalid-incident-registration');
  }
  public observe(network: string): Promise<IncidentResponse> {
    if (network !== this.ledger.profile.network) return Promise.reject(incidentFailure('incident-network-mismatch', 400));
    if (this.closed) return Promise.reject(incidentFailure('incident-monitor-closed'));
    if (this.active) return this.active;
    const controller = this.controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(incidentFailure('incident-deadline', 504)); }, 15000); });
    /** @asyncUnsafe Staged observations commit only after all sources pass. */
    const work = async () => {
      if (this.registrationGuard) await this.registrationGuard(controller.signal);
      if (controller.signal.aborted) throw incidentFailure('incident-deadline', 504);
      const observations = await Promise.all(this.ledger.profile.sources.map(s => observeIncidentSource(this.ledger.profile, s, this.readers.get(s.source_id)!, controller.signal)));
      if (controller.signal.aborted || this.closed) throw incidentFailure('incident-deadline', 504);
      return this.ledger.record(observations);
    };
    this.active = Promise.race([deadline, work()]).catch(error => {
      controller.abort();
      if (!this.closed) this.ledger.gap('source-unavailable');
      throw error;
    }).finally(() => { clearTimeout(timer!); if (this.controller === controller) this.controller = undefined; this.active = null; });
    return this.active;
  }
  public start(): void {
    if (this.timer || this.closed) return;
    this.timer = setInterval(() => { this.observe(this.ledger.profile.network).catch(() => undefined); }, 30000);
    this.timer.unref();
  }
  public close(): void { this.closed = true; if (this.timer) clearInterval(this.timer); this.controller?.abort(); this.ledger.close(); }
}
let configured: { path: string; ledgerPath: string; registrySha256: string; monitor: IncidentMonitor } | undefined;
let loading: Promise<IncidentMonitor> | undefined;
/** Default disabled; profile and credentials are read from selected protected files, never from a caller URL. */
export async function configuredIncidentMonitor(): Promise<IncidentMonitor> {
  const path = process.env.UNIVERSE_INCIDENT_PROFILE_FILE;
  const ledgerPath = process.env.UNIVERSE_INCIDENT_LEDGER_FILE;
  if (!path || !ledgerPath) throw incidentFailure('unavailable-incident-ledger');
  if (configured) {
    if (configured.path !== path || configured.ledgerPath !== ledgerPath) throw incidentFailure('incident-registration-changed');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
    try {
      const bytes = await readIncidentProtected(path, 65536, controller.signal);
      if (createHash('sha256').update(bytes).digest('hex') !== configured.registrySha256) throw incidentFailure('incident-registration-changed');
    } catch { throw incidentFailure('incident-registration-changed'); }
    finally { clearTimeout(timer); }
    return configured.monitor;
  }
  if (loading) return loading;
  loading = (async () => {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const bytes = await readIncidentProtected(path, 65536, controller.signal);
      const raw = JSON.parse(bytes.toString('utf8'));
      const profile = validateIncidentProfile(raw.profile);
      if (!Array.isArray(raw.readers) || raw.readers.length !== profile.sources.length) throw incidentFailure('invalid-incident-registration');
      const readers = new Map<string, IncidentCoreReader>();
      for (const row of raw.readers) {
        if (!row || typeof row.source_id !== 'string' || readers.has(row.source_id) || !profile.sources.some(s => s.source_id === row.source_id)
          || typeof row.origin !== 'string' || typeof row.cookie_file !== 'string') throw incidentFailure('invalid-incident-registration');
        readers.set(row.source_id, new IncidentRpcReader(row.origin, row.cookie_file));
      }
      if (controller.signal.aborted) throw incidentFailure('incident-deadline', 504);
      const registrySha256 = createHash('sha256').update(bytes).digest('hex');
      /** @asyncUnsafe The immutable registry is fenced before every background/native observation. */
      const registrationGuard = async (signal: AbortSignal) => {
        if (process.env.UNIVERSE_INCIDENT_PROFILE_FILE !== path || process.env.UNIVERSE_INCIDENT_LEDGER_FILE !== ledgerPath
          || createHash('sha256').update(await readIncidentProtected(path, 65536, signal)).digest('hex') !== registrySha256) throw incidentFailure('incident-registration-changed');
      };
      const monitor = new IncidentMonitor(new IncidentLedger(ledgerPath, profile), readers, registrationGuard);
      configured = { path, ledgerPath, registrySha256, monitor }; monitor.start(); return monitor;
    } catch { throw incidentFailure('unavailable-incident-ledger'); }
    finally { clearTimeout(timer); }
  })().finally(() => { loading = undefined; });
  return loading;
}
