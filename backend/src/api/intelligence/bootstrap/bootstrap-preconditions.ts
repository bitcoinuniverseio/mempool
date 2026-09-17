import { BootstrapNodeReader } from './node-reader';
import { BootstrapEnvironment } from './bootstrap-config';
import { BootstrapEvidenceError } from './bootstrap-errors';
import { BootstrapStore } from './bootstrap-store';
import { CapacityMeasurement, measureCapacity, StatfsReader } from './bootstrap-capacity';
import {
  BootstrapCatalogue,
  BootstrapCatalogueSnapshot,
  BootstrapPinnedCommitment,
  NodeBootstrapVerification,
} from './bootstrap.models';
import { pinnedCommitmentFor } from './snapshot-catalogue';
import { NETWORK_MAGIC } from './snapshot-format';

export type NodeObservation = Awaited<ReturnType<BootstrapNodeReader['read']>>;

/** assumeutxo shipped in 26.0; the versioned snapshot file format in 28.0. */
export const MIN_SUPPORTED_CORE_MAJOR = 26;
export const VERSIONED_SNAPSHOT_MAJOR = 28;
/** Chainstate on disk is assumed to need as much as the snapshot file; headroom is a tenth on top. */
export const CHAINSTATE_ESTIMATE_FACTOR = 1;
export const HEADROOM_FACTOR = 0.1;

export function parseCoreVersion(subversion: string): { version: string; major: number } | null {
  const match = /^\/Satoshi:(\d+)\.(\d+)\.(\d+)/.exec(subversion);
  return match ? { version: `${match[1]}.${match[2]}.${match[3]}`, major: Number(match[1]) } : null;
}

export function requireSupportedNode(observation: NodeObservation, network: string): { version: string; major: number } {
  const { capability } = observation;
  if (!NETWORK_MAGIC[capability.network] || capability.network !== network) {
    throw new BootstrapEvidenceError('unsupported-network', `The owned node serves ${capability.network}, not ${network}.`, 409);
  }
  const parsed = parseCoreVersion(capability.exact_version);
  if (!parsed || parsed.major < MIN_SUPPORTED_CORE_MAJOR) {
    throw new BootstrapEvidenceError('unsupported-version', `The owned node reports ${capability.exact_version}; AssumeUTXO needs Bitcoin Core ${MIN_SUPPORTED_CORE_MAJOR}.0 or later.`, 409);
  }
  return parsed;
}

export function requireFreshObservation(observation: NodeObservation, now: number, maxAgeMs: number): void {
  const age = now - Date.parse(observation.observation.observed_at);
  if (!Number.isFinite(age) || age > maxAgeMs || age < 0) {
    throw new BootstrapEvidenceError('stale-measurement', `The node observation is ${age} ms old, outside the accepted ${maxAgeMs} ms.`, 409);
  }
}

export function requiredBytesForLoad(snapshotBytes: number): { chainstate_estimate_bytes: number; headroom_bytes: number; required_bytes: number } {
  const chainstate = Math.ceil(snapshotBytes * CHAINSTATE_ESTIMATE_FACTOR);
  const headroom = Math.ceil((snapshotBytes + chainstate) * HEADROOM_FACTOR);
  return { chainstate_estimate_bytes: chainstate, headroom_bytes: headroom, required_bytes: snapshotBytes + chainstate + headroom };
}

export interface LoadEligibility {
  version: { version: string; major: number };
  pinned: BootstrapPinnedCommitment;
  verification: NodeBootstrapVerification;
  capacity: CapacityMeasurement;
  required: ReturnType<typeof requiredBytesForLoad>;
}

/** A snapshot the observed node can load: same format family and a commitment pinned for its exact release. */
export function compatibleSnapshots(
  catalogue: BootstrapCatalogue,
  network: string,
  version: { version: string; major: number }
): Array<{ snapshot: BootstrapCatalogueSnapshot; pinned: BootstrapPinnedCommitment }> {
  const versioned = version.major >= VERSIONED_SNAPSHOT_MAJOR;
  const out: Array<{ snapshot: BootstrapCatalogueSnapshot; pinned: BootstrapPinnedCommitment }> = [];
  for (const snapshot of catalogue.snapshots) {
    const producedBy = parseCoreVersion('/Satoshi:' + snapshot.coreVersion + '/');
    if (snapshot.network !== network || !producedBy || (producedBy.major >= VERSIONED_SNAPSHOT_MAJOR) !== versioned) {
      continue;
    }
    const pinned = pinnedCommitmentFor(catalogue, { ...snapshot, coreVersion: version.version });
    if (pinned) {
      out.push({ snapshot, pinned });
    }
  }
  return out.sort((a, b) => b.snapshot.height - a.snapshot.height);
}

/**
 * Everything a load needs, checked against measurements rather than the
 * request: node version and network, chainstate phase, a commitment pinned
 * for the node's exact release, a verification run that reached valid over
 * the bytes, and measured capacity for file, chainstate and headroom.
 */
/** @asyncUnsafe Rejections are typed BootstrapEvidenceErrors for the caller. */
export async function evaluateLoadEligibility(input: {
  observation: NodeObservation;
  network: string;
  snapshot: BootstrapCatalogueSnapshot;
  catalogue: BootstrapCatalogue;
  store: BootstrapStore;
  env: BootstrapEnvironment;
  now: number;
  statfs?: StatfsReader;
}): Promise<LoadEligibility> {
  const { observation, snapshot, catalogue } = input;
  const version = requireSupportedNode(observation, input.network);
  if (!observation.capability.supports_loadtxoutset) {
    throw new BootstrapEvidenceError('node-capability-missing', 'The owned node does not expose loadtxoutset.', 409);
  }
  if (snapshot.network !== input.network) {
    throw new BootstrapEvidenceError('unsupported-network', `Snapshot ${snapshot.id} is for ${snapshot.network}.`, 409);
  }
  const match = compatibleSnapshots(catalogue, input.network, version).find((entry) => entry.snapshot.id === snapshot.id);
  if (!match) {
    throw new BootstrapEvidenceError('no-compatible-snapshot', `No commitment is pinned for snapshot ${snapshot.id} on Bitcoin Core ${version.version}, or its file format predates that release.`, 409);
  }
  const verification = await input.store.latestVerification(snapshot.id, input.network);
  if (!verification || verification.state !== 'valid') {
    throw new BootstrapEvidenceError('snapshot-not-verified', `Snapshot ${snapshot.id} has no verification run that reached valid (latest: ${verification?.state ?? 'none'}).`, 409);
  }
  const chain = observation.observation;
  if (
    chain.current_phase !== 'traditional_ibd' ||
    chain.dual_chainstate_active ||
    chain.active_chainstate.type !== 'ibd' ||
    chain.tip_height >= snapshot.height ||
    observation.observation.estimated_remaining_blocks + chain.tip_height < snapshot.height
  ) {
    throw new BootstrapEvidenceError('chainstate-not-eligible', `The node is in phase ${chain.current_phase} at height ${chain.tip_height}; loading needs a plain IBD chainstate below the snapshot height with headers past it.`, 409);
  }
  const capacity = await measureCapacity(input.env, Math.round(chain.disk_used_gb * 1073741824), input.now, input.statfs);
  const required = requiredBytesForLoad(snapshot.sizeBytes);
  if (capacity.free_bytes < required.required_bytes) {
    throw new BootstrapEvidenceError('insufficient-capacity', `Measured free space ${capacity.free_bytes} bytes is below the ${required.required_bytes} bytes the load needs.`, 409);
  }
  return { version, pinned: match.pinned, verification, capacity, required };
}
