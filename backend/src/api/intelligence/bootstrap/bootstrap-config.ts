/**
 * Additive environment configuration for the bootstrap surface. Every key is
 * optional; an absent key leaves the matching subfeature unavailable and the
 * read-only node observation untouched.
 */
export interface BootstrapEnvironment {
  /** Path to the trusted catalogue JSON (producers, pinnedCommitments, snapshots). */
  catalogueFile?: string;
  /** Comma separated https origins and local directory prefixes a snapshot source may live under. */
  sourceAllowlist: string[];
  /** Upper bound on snapshot bytes a verification will stream. */
  maxSnapshotBytes: number;
  /** Wall clock deadline for one verification run. */
  verifyDeadlineMs: number;
  /** Directory on the Core host that generated snapshots are written to. */
  snapshotDir?: string;
  /** Core datadir path for a statfs capacity measurement. */
  datadir?: string;
  /** Operator measured volume capacity in bytes, with the time it was measured. */
  capacityBytes?: number;
  capacityMeasuredAt?: string;
  capacityMaxAgeMs: number;
  /** Deadline for one operator RPC (dumptxoutset or loadtxoutset). */
  jobTimeoutMs: number;
  /** Lease a worker holds on a running job; a crashed worker's job is reclaimed after it lapses. */
  jobLeaseMs: number;
  /** How often the worker looks for queued or lapsed jobs. */
  jobPollMs: number;
}

const integer = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return value !== undefined && Number.isSafeInteger(n) && n > 0 ? n : fallback;
};

export function readBootstrapEnvironment(env: NodeJS.ProcessEnv = process.env): BootstrapEnvironment {
  const capacity = Number(env.UNIVERSE_BOOTSTRAP_CAPACITY_BYTES);
  return {
    catalogueFile: env.UNIVERSE_BOOTSTRAP_SNAPSHOT_CATALOGUE || undefined,
    sourceAllowlist: String(env.UNIVERSE_BOOTSTRAP_SOURCE_ALLOWLIST || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
    maxSnapshotBytes: integer(env.UNIVERSE_BOOTSTRAP_MAX_SNAPSHOT_BYTES, 32 * 1024 ** 3),
    verifyDeadlineMs: integer(env.UNIVERSE_BOOTSTRAP_VERIFY_DEADLINE_MS, 60 * 60 * 1000),
    snapshotDir: env.UNIVERSE_BOOTSTRAP_SNAPSHOT_DIR || undefined,
    datadir: env.UNIVERSE_BOOTSTRAP_DATADIR || undefined,
    capacityBytes: Number.isSafeInteger(capacity) && capacity > 0 ? capacity : undefined,
    capacityMeasuredAt: env.UNIVERSE_BOOTSTRAP_CAPACITY_MEASURED_AT || undefined,
    capacityMaxAgeMs: integer(env.UNIVERSE_BOOTSTRAP_CAPACITY_MAX_AGE_MS, 24 * 60 * 60 * 1000),
    jobTimeoutMs: integer(env.UNIVERSE_BOOTSTRAP_JOB_TIMEOUT_MS, 6 * 60 * 60 * 1000),
    jobLeaseMs: integer(env.UNIVERSE_BOOTSTRAP_JOB_LEASE_MS, 5 * 60 * 1000),
    jobPollMs: integer(env.UNIVERSE_BOOTSTRAP_JOB_POLL_MS, 15 * 1000),
  };
}
