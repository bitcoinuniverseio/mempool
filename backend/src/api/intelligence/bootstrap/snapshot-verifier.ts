import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import * as https from 'https';
import { WorkbenchCoreReader } from '../workbench/workbench-core';
import { BootstrapEnvironment } from './bootstrap-config';
import { BootstrapEvidenceError } from './bootstrap-errors';
import { BootstrapStore } from './bootstrap-store';
import {
  BootstrapCatalogue,
  BootstrapCatalogueSnapshot,
  NodeBootstrapCheck,
  NodeBootstrapVerification,
} from './bootstrap.models';
import { BootstrapNodeReader } from './node-reader';
import {
  classifySource,
  pinnedCommitmentFor,
  producerFor,
  verifyManifestSignature,
} from './snapshot-catalogue';
import { NETWORK_MAGIC, SnapshotFormatError, SnapshotStreamDecoder } from './snapshot-format';

/** Streams the bytes of an allowlisted source; tests substitute a fake. */
export interface SnapshotByteSource {
  open(source: string, kind: 'file' | 'https'): Promise<AsyncIterable<Buffer> & { destroy?: (err?: Error) => void }>;
}

export const nodeByteSource: SnapshotByteSource = {
  open(source, kind) {
    if (kind === 'file') {
      return Promise.resolve(createReadStream(source, { highWaterMark: 4 * 1024 * 1024 }));
    }
    return new Promise((resolve, reject) => {
      const request = https.get(source, { headers: { 'user-agent': 'universe-bootstrap-verifier' } }, (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`The snapshot source answered HTTP ${response.statusCode}.`));
          return;
        }
        resolve(response);
      });
      request.on('error', reject);
    });
  },
};

const pending = (): NodeBootstrapCheck => ({ status: 'pending' });
const valid = (expected: string | number | null, observed: string | number | null): NodeBootstrapCheck => ({ status: 'valid', expected, observed });
const invalid = (expected: string | number | null, observed: string | number | null, reason: string): NodeBootstrapCheck => ({ status: 'invalid', expected, observed, reason });
const skipped = (reason: string, expected: string | number | null = null): NodeBootstrapCheck => ({ status: 'not-evaluated', expected, reason });
const compare = (expected: string | number | null, observed: string | number | null, reason: string): NodeBootstrapCheck =>
  expected === observed ? valid(expected, observed) : invalid(expected, observed, reason);

export function newVerificationRecord(
  verificationId: string,
  snapshot: BootstrapCatalogueSnapshot,
  callerInputs: { sha256: string | null; utxo_hash: string | null; height: number | null },
  now: string
): NodeBootstrapVerification {
  return {
    verification_id: verificationId,
    snapshot_id: snapshot.id,
    network: snapshot.network,
    state: 'pending',
    valid: false,
    status: 'pending',
    requested_at: now,
    checks: {
      file_size: pending(),
      sha256: pending(),
      manifest_signature: pending(),
      network_magic: pending(),
      base_block_hash: pending(),
      base_height: pending(),
      coins_count: pending(),
      utxo_commitment: pending(),
    },
    evidence: {
      source_kind: null,
      source_ref: null,
      bytes_read: 0,
      header_format: null,
      snapshot_version: null,
      core_node_id: null,
      core_block_hash_at_height: null,
      pinned_commitment_source: null,
    },
    checkpoints: [{ at: now, stage: 'queued' }],
    caller_inputs: { ...callerInputs, matched: null },
    file_size_valid: false,
    sha256_valid: false,
    manifest_hash_valid: false,
    signature_valid: false,
    expected_metadata_match: false,
    overall_verified: false,
    details: 'Verification has not run yet. A queued run proves nothing about the bytes.',
    verified_at: now,
  };
}

function summarise(record: NodeBootstrapVerification): void {
  const c = record.checks;
  record.file_size_valid = c.file_size.status === 'valid';
  record.sha256_valid = c.sha256.status === 'valid';
  record.signature_valid = c.manifest_signature.status === 'valid';
  record.manifest_hash_valid = record.signature_valid;
  record.expected_metadata_match = [c.network_magic, c.base_block_hash, c.base_height, c.coins_count].every((check) => check.status === 'valid');
  record.overall_verified = record.state === 'valid';
  record.valid = record.state === 'valid';
  record.status = record.state;
  const observedSha = typeof c.sha256.observed === 'string' ? c.sha256.observed : null;
  const observedUtxo = typeof c.utxo_commitment.observed === 'string' ? c.utxo_commitment.observed : null;
  const inputs = record.caller_inputs;
  if (inputs.sha256 || inputs.utxo_hash || inputs.height !== null) {
    inputs.matched =
      (inputs.sha256 === null || (observedSha !== null && inputs.sha256 === observedSha)) &&
      (inputs.utxo_hash === null || (observedUtxo !== null && inputs.utxo_hash === observedUtxo)) &&
      (inputs.height === null || inputs.height === c.base_height.expected);
  }
}

export class SnapshotVerifier {
  constructor(
    private readonly env: BootstrapEnvironment,
    private readonly nodes: BootstrapNodeReader,
    private readonly core: WorkbenchCoreReader,
    private readonly bytes: SnapshotByteSource = nodeByteSource,
    private readonly clock: () => string = () => new Date().toISOString()
  ) {}

  /**
   * Runs every check independently and persists the outcome. The record is
   * valid only when every check is valid; a commitment that could not be
   * evaluated leaves the record unavailable, never valid.
   */
  /** @asyncUnsafe Every step writes its own outcome; a store failure is logged by the caller. */
  public async run(
    record: NodeBootstrapVerification,
    catalogue: BootstrapCatalogue,
    snapshot: BootstrapCatalogueSnapshot,
    store: BootstrapStore
  ): Promise<NodeBootstrapVerification> {
    const checkpoint = (stage: string, detail?: string): void => {
      record.checkpoints.push({ at: this.clock(), stage, ...(detail ? { detail } : {}) });
    };
    record.state = 'verifying';
    record.started_at = this.clock();
    checkpoint('started');
    summarise(record);
    await store.updateVerification(record);

    const producer = producerFor(catalogue, snapshot);
    record.checks.manifest_signature = producer && verifyManifestSignature(snapshot, producer)
      ? valid(producer.id, producer.id)
      : invalid(snapshot.manifest.producerId, null, 'The manifest signature does not verify against the producer key.');
    checkpoint('manifest-signature', record.checks.manifest_signature.status);

    const pinned = pinnedCommitmentFor(catalogue, snapshot);
    record.evidence.pinned_commitment_source = pinned ? 'operator-pinned Bitcoin Core chainparams for ' + pinned.coreVersion : null;

    let unavailableReason: string | undefined;
    try {
      const observed = await this.nodes.read();
      record.evidence.core_node_id = observed.capability.node_id;
      if (observed.capability.network !== snapshot.network) {
        record.checks.base_block_hash = invalid(snapshot.blockHash, null, 'The owned node serves a different network than the snapshot.');
        record.checks.base_height = invalid(snapshot.height, null, 'The owned node serves a different network than the snapshot.');
      } else {
        const hashAtHeight = await this.core.call('getblockhash', [snapshot.height]);
        const header = typeof hashAtHeight === 'string' ? await this.core.call('getblockheader', [hashAtHeight, true]) : null;
        record.evidence.core_block_hash_at_height = typeof hashAtHeight === 'string' ? hashAtHeight : null;
        if (typeof hashAtHeight !== 'string' || header?.hash !== hashAtHeight || header?.height !== snapshot.height) {
          throw new Error('The owned node did not return a consistent header for the snapshot height.');
        }
        record.checks.base_height = hashAtHeight === snapshot.blockHash
          ? valid(snapshot.height, header.height)
          : invalid(snapshot.height, header.height, 'The owned node has a different block at the catalogue height.');
      }
    } catch (e) {
      unavailableReason = 'The owned Core node could not confirm the snapshot base block: ' + (e instanceof Error ? e.message : String(e));
      record.checks.base_height = skipped(unavailableReason, snapshot.height);
    }
    checkpoint('core-base-block', record.checks.base_height.status);

    let sha256: string | null = null;
    let decoded: ReturnType<SnapshotStreamDecoder['finish']> | null = null;
    let formatError: SnapshotFormatError | null = null;
    try {
      const source = classifySource(snapshot.source, this.env.sourceAllowlist);
      record.evidence.source_kind = source.kind;
      record.evidence.source_ref = source.ref;
      const outcome = await this.stream(snapshot, source.kind, checkpoint);
      sha256 = outcome.sha256;
      decoded = outcome.decoded;
      formatError = outcome.formatError;
      record.evidence.bytes_read = outcome.bytesRead;
    } catch (e) {
      record.evidence.bytes_read = e instanceof StreamAbort ? e.bytesRead : record.evidence.bytes_read;
      const message = e instanceof Error ? e.message : String(e);
      unavailableReason = unavailableReason ?? message;
      record.checks.file_size = skipped(message, snapshot.sizeBytes);
      record.checks.sha256 = skipped(message, snapshot.sha256);
      record.checks.network_magic = skipped(message, NETWORK_MAGIC[snapshot.network]);
      record.checks.base_block_hash = skipped(message, snapshot.blockHash);
      record.checks.coins_count = skipped(message, pinned?.coinCount ?? null);
      record.checks.utxo_commitment = skipped(message, pinned?.utxoCommitment ?? null);
      record.reason = e instanceof BootstrapEvidenceError ? e.code : e instanceof StreamAbort ? e.reason : 'source-read-failed';
      checkpoint('bytes', 'aborted: ' + (e instanceof Error ? e.message : String(e)));
    }

    if (sha256 !== null) {
      record.checks.file_size = compare(snapshot.sizeBytes, record.evidence.bytes_read, 'The source did not have the catalogue byte length.');
      record.checks.sha256 = compare(snapshot.sha256, sha256, 'The bytes do not hash to the signed manifest sha256.');
    }
    if (formatError) {
      // The bytes were still hashed in full; only the structural checks fall out.
      const e = formatError;
      record.checks.network_magic = e.reason === 'network-magic-mismatch'
        ? invalid(NETWORK_MAGIC[snapshot.network], null, e.message)
        : skipped(e.message, NETWORK_MAGIC[snapshot.network]);
      record.checks.base_block_hash = invalid(snapshot.blockHash, null, e.message);
      record.checks.coins_count = skipped(e.message, pinned?.coinCount ?? null);
      record.checks.utxo_commitment = skipped(e.message, pinned?.utxoCommitment ?? null);
      if (e.reason !== 'network-magic-mismatch') {
        record.reason = 'snapshot-format:' + e.reason;
      }
      checkpoint('bytes', 'format: ' + e.message);
    }
    if (decoded !== null) {
      record.evidence.header_format = decoded.header.format;
      record.evidence.snapshot_version = decoded.header.version;
      record.checks.network_magic = decoded.header.format === 'legacy'
        ? skipped('A pre-28.0 snapshot header carries no network magic.', NETWORK_MAGIC[snapshot.network])
        : compare(NETWORK_MAGIC[snapshot.network], decoded.header.network_magic, 'The snapshot header names another network.');
      record.checks.base_block_hash = compare(snapshot.blockHash, decoded.header.base_block_hash, 'The snapshot header base block is not the catalogue block.');
      if (decoded.max_coin_height > snapshot.height) {
        record.checks.base_block_hash = invalid(snapshot.blockHash, decoded.header.base_block_hash, `A coin is at height ${decoded.max_coin_height}, above the base height.`);
      }
      record.checks.coins_count = pinned?.coinCount !== null && pinned?.coinCount !== undefined
        ? compare(pinned.coinCount, decoded.header.coins_count, 'The coins count differs from the pinned commitment.')
        : valid(null, decoded.header.coins_count);
      if (!pinned) {
        record.checks.utxo_commitment = skipped('No commitment is pinned for this network, Core version, height and block; a node running that release cannot load it.', null);
        record.reason = record.reason ?? 'no-pinned-commitment';
      } else if (decoded.hash_serialized_3 === null) {
        record.checks.utxo_commitment = skipped('hash_serialized_3 was not computed: ' + decoded.hash_reason + '. The operator load job leaves the definitive check to Core.', pinned.utxoCommitment);
        record.reason = record.reason ?? 'utxo-commitment-not-evaluated';
      } else {
        record.checks.utxo_commitment = compare(pinned.utxoCommitment, decoded.hash_serialized_3, 'The streamed hash_serialized_3 is not the pinned Core commitment.');
      }
      checkpoint('bytes', `${decoded.bytes_read} bytes, ${decoded.coins_read} coins`);
    }

    const checks = Object.values(record.checks);
    if (checks.some((check) => check.status === 'invalid')) {
      record.state = 'invalid';
      record.details = 'At least one independent check failed; see checks.';
    } else if (checks.every((check) => check.status === 'valid' || (check === record.checks.network_magic && check.status === 'not-evaluated' && decoded?.header.format === 'legacy'))) {
      record.state = 'valid';
      record.details = 'Bytes, manifest signature, base block, coins count and hash_serialized_3 all match the signed catalogue, the owned node and the pinned Core commitment.';
      record.reason = undefined;
    } else {
      record.state = 'unavailable';
      record.details = unavailableReason ?? 'A required check could not be evaluated; the snapshot is not verified.';
      record.reason = record.reason ?? 'check-not-evaluated';
    }
    record.finished_at = this.clock();
    record.verified_at = record.finished_at;
    checkpoint('finished', record.state);
    summarise(record);
    await store.updateVerification(record);
    return record;
  }

  /** @asyncUnsafe The caller records a rejection as the run outcome. */
  private async stream(
    snapshot: BootstrapCatalogueSnapshot,
    kind: 'file' | 'https',
    checkpoint: (stage: string, detail?: string) => void
  ): Promise<{ sha256: string; bytesRead: number; decoded: ReturnType<SnapshotStreamDecoder['finish']> | null; formatError: SnapshotFormatError | null }> {
    const limit = Math.min(this.env.maxSnapshotBytes, snapshot.sizeBytes);
    const hash = createHash('sha256');
    const decoder = new SnapshotStreamDecoder(snapshot.network);
    let formatError: SnapshotFormatError | null = null;
    let bytesRead = 0;
    let abort: StreamAbort | undefined;
    const stream = await this.bytes.open(snapshot.source, kind);
    const deadline = setTimeout(() => {
      abort = new StreamAbort('deadline-exceeded', `The verification deadline of ${this.env.verifyDeadlineMs} ms passed after ${bytesRead} bytes.`, bytesRead);
      stream.destroy?.(abort);
    }, this.env.verifyDeadlineMs);
    checkpoint('bytes', 'streaming from ' + kind);
    try {
      for await (const chunk of stream) {
        if (abort) {
          throw abort;
        }
        bytesRead += chunk.length;
        if (bytesRead > limit) {
          abort = new StreamAbort('size-exceeded', `The source exceeded the bounded size of ${limit} bytes.`, bytesRead);
          stream.destroy?.(abort);
          throw abort;
        }
        hash.update(chunk);
        if (!formatError) {
          try {
            decoder.feed(chunk);
          } catch (e) {
            if (!(e instanceof SnapshotFormatError)) {
              throw e;
            }
            formatError = e;
          }
        }
      }
      if (abort) {
        throw abort;
      }
    } catch (e) {
      stream.destroy?.();
      throw e;
    } finally {
      clearTimeout(deadline);
    }
    let decoded: ReturnType<SnapshotStreamDecoder['finish']> | null = null;
    if (!formatError) {
      try {
        decoded = decoder.finish();
      } catch (e) {
        if (!(e instanceof SnapshotFormatError)) {
          throw e;
        }
        formatError = e;
      }
    }
    return { sha256: hash.digest('hex'), bytesRead, decoded, formatError };
  }
}

export class StreamAbort extends Error {
  constructor(public readonly reason: string, message: string, public readonly bytesRead: number) {
    super(message);
  }
}
