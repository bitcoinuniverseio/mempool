import { promises as fs } from 'fs';
import { BootstrapEnvironment } from './bootstrap-config';
import { BootstrapEvidenceError } from './bootstrap-errors';

export interface CapacityMeasurement {
  method: 'statfs' | 'configured';
  measured_at: string;
  free_bytes: number;
  total_bytes: number | null;
}

export type StatfsReader = (path: string) => Promise<{ bsize: number; bavail: number; blocks: number }>;

/**
 * The node's disk capacity as this backend can actually measure it: a statfs
 * of the configured datadir when it is on this host, otherwise the operator's
 * own measurement (UNIVERSE_BOOTSTRAP_CAPACITY_BYTES with the time it was
 * taken) minus the block data Core reports. A caller's declared free disk is
 * never a substitute for either.
 */
/** @asyncUnsafe Rejections are typed BootstrapEvidenceErrors for the caller. */
export async function measureCapacity(
  env: BootstrapEnvironment,
  blocksOnDiskBytes: number,
  now: number = Date.now(),
  statfs: StatfsReader = (path) => fs.statfs(path) as Promise<{ bsize: number; bavail: number; blocks: number }>
): Promise<CapacityMeasurement> {
  if (env.datadir) {
    try {
      const stat = await statfs(env.datadir);
      return {
        method: 'statfs',
        measured_at: new Date(now).toISOString(),
        free_bytes: Number(stat.bavail) * Number(stat.bsize),
        total_bytes: Number(stat.blocks) * Number(stat.bsize),
      };
    } catch (e) {
      throw new BootstrapEvidenceError(
        'capacity-not-measured',
        'The configured datadir could not be measured: ' + (e instanceof Error ? e.message : String(e))
      );
    }
  }
  if (env.capacityBytes === undefined) {
    throw new BootstrapEvidenceError(
      'capacity-not-measured',
      'No owned capacity measurement is configured (UNIVERSE_BOOTSTRAP_DATADIR or UNIVERSE_BOOTSTRAP_CAPACITY_BYTES with UNIVERSE_BOOTSTRAP_CAPACITY_MEASURED_AT).'
    );
  }
  const measuredAt = Date.parse(env.capacityMeasuredAt ?? '');
  if (!Number.isFinite(measuredAt)) {
    throw new BootstrapEvidenceError(
      'capacity-not-measured',
      'The configured capacity carries no measurement time (UNIVERSE_BOOTSTRAP_CAPACITY_MEASURED_AT).'
    );
  }
  if (now - measuredAt > env.capacityMaxAgeMs || measuredAt > now) {
    throw new BootstrapEvidenceError(
      'stale-measurement',
      `The configured capacity was measured at ${new Date(measuredAt).toISOString()}, outside the accepted age of ${env.capacityMaxAgeMs} ms.`,
      409
    );
  }
  return {
    method: 'configured',
    measured_at: new Date(measuredAt).toISOString(),
    free_bytes: Math.max(0, env.capacityBytes - blocksOnDiskBytes),
    total_bytes: env.capacityBytes,
  };
}
