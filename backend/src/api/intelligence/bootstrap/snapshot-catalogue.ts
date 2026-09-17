import { createPublicKey, verify as verifySignature } from 'crypto';
import { readFileSync } from 'fs';
import { BootstrapEvidenceError } from './bootstrap-errors';
import {
  BootstrapCatalogue,
  BootstrapCatalogueProducer,
  BootstrapCatalogueSnapshot,
  BootstrapPinnedCommitment,
} from './bootstrap.models';
import { NETWORK_MAGIC } from './snapshot-format';

const hex = (value: unknown, bytes: number): value is string =>
  typeof value === 'string' && new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(value);
const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value);
const version = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value);
const height = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const invalid = (detail: string): never => {
  throw new BootstrapEvidenceError(
    'invalid-catalogue',
    'The trusted snapshot catalogue is malformed: ' + detail
  );
};

/** ed25519 SPKI DER prefix for a raw 32 byte public key. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** The bytes a producer signs: the identifying snapshot fields, sorted keys, no whitespace. */
export function deterministicSnapshotJson(snapshot: BootstrapCatalogueSnapshot): Buffer {
  const signed: Record<string, string | number> = {
    blockHash: snapshot.blockHash,
    coreVersion: snapshot.coreVersion,
    height: snapshot.height,
    id: snapshot.id,
    network: snapshot.network,
    sha256: snapshot.sha256,
    sizeBytes: snapshot.sizeBytes,
  };
  return Buffer.from(JSON.stringify(signed, Object.keys(signed).sort()), 'utf8');
}

export function verifyManifestSignature(
  snapshot: BootstrapCatalogueSnapshot,
  producer: BootstrapCatalogueProducer
): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(producer.publicKey, 'hex')]),
      format: 'der',
      type: 'spki',
    });
    return verifySignature(
      null,
      deterministicSnapshotJson(snapshot),
      key,
      Buffer.from(snapshot.manifest.signature, 'hex')
    );
  } catch {
    return false;
  }
}

export function parseCatalogue(text: string): BootstrapCatalogue {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return invalid('not JSON.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return invalid('the document is not an object.');
  }
  const producers: BootstrapCatalogueProducer[] = [];
  if (!Array.isArray(raw.producers)) {
    return invalid('producers must be an array.');
  }
  for (const p of raw.producers) {
    if (!id(p?.id) || p.algorithm !== 'ed25519' || !hex(p.publicKey, 32)) {
      return invalid('a producer needs an id, algorithm ed25519 and a 32 byte hex publicKey.');
    }
    if (producers.some((known) => known.id === p.id)) {
      return invalid(`producer ${p.id} is listed twice.`);
    }
    producers.push({ id: p.id, algorithm: 'ed25519', publicKey: p.publicKey });
  }
  const pinned: BootstrapPinnedCommitment[] = [];
  if (!Array.isArray(raw.pinnedCommitments)) {
    return invalid('pinnedCommitments must be an array.');
  }
  for (const c of raw.pinnedCommitments) {
    if (
      !NETWORK_MAGIC[c?.network] ||
      !version(c.coreVersion) ||
      !height(c.height) ||
      !hex(c.blockHash, 32) ||
      !hex(c.utxoCommitment, 32) ||
      (c.coinCount !== undefined && c.coinCount !== null && !height(c.coinCount))
    ) {
      return invalid('a pinned commitment needs network, coreVersion, height, 32 byte blockHash and utxoCommitment.');
    }
    pinned.push({
      network: c.network,
      coreVersion: c.coreVersion,
      height: c.height,
      blockHash: c.blockHash,
      utxoCommitment: c.utxoCommitment,
      coinCount: c.coinCount ?? null,
    });
  }
  const snapshots: BootstrapCatalogueSnapshot[] = [];
  if (!Array.isArray(raw.snapshots)) {
    return invalid('snapshots must be an array.');
  }
  for (const s of raw.snapshots) {
    if (
      !id(s?.id) ||
      !NETWORK_MAGIC[s.network] ||
      !version(s.coreVersion) ||
      !height(s.height) ||
      !hex(s.blockHash, 32) ||
      !height(s.sizeBytes) ||
      s.sizeBytes < 1 ||
      !hex(s.sha256, 32) ||
      typeof s.source !== 'string' ||
      !s.source ||
      !id(s.manifest?.producerId) ||
      !hex(s.manifest.signature, 64)
    ) {
      return invalid(`snapshot ${typeof s?.id === 'string' ? s.id : '(unnamed)'} is missing a required field.`);
    }
    if (snapshots.some((known) => known.id === s.id)) {
      return invalid(`snapshot ${s.id} is listed twice.`);
    }
    if (!producers.some((p) => p.id === s.manifest.producerId)) {
      return invalid(`snapshot ${s.id} names unknown producer ${s.manifest.producerId}.`);
    }
    snapshots.push({
      id: s.id,
      network: s.network,
      coreVersion: s.coreVersion,
      height: s.height,
      blockHash: s.blockHash,
      sizeBytes: s.sizeBytes,
      sha256: s.sha256,
      source: s.source,
      manifest: { producerId: s.manifest.producerId, signature: s.manifest.signature },
    });
  }
  return { producers, pinnedCommitments: pinned, snapshots };
}

export function loadCatalogue(file: string | undefined): BootstrapCatalogue {
  if (!file) {
    throw new BootstrapEvidenceError(
      'unavailable-manifest',
      'Bootstrap evidence is unavailable. A trusted signed snapshot catalogue, producer keys and pinned Bitcoin Core commitments are required (UNIVERSE_BOOTSTRAP_SNAPSHOT_CATALOGUE).'
    );
  }
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new BootstrapEvidenceError(
      'unavailable-manifest',
      'Bootstrap evidence is unavailable. The configured snapshot catalogue could not be read.'
    );
  }
  return parseCatalogue(text);
}

export function producerFor(
  catalogue: BootstrapCatalogue,
  snapshot: BootstrapCatalogueSnapshot
): BootstrapCatalogueProducer | undefined {
  return catalogue.producers.find((p) => p.id === snapshot.manifest.producerId);
}

/** The operator-pinned Core commitment for this exact network, release, height and block. */
export function pinnedCommitmentFor(
  catalogue: BootstrapCatalogue,
  snapshot: Pick<BootstrapCatalogueSnapshot, 'network' | 'coreVersion' | 'height' | 'blockHash'>
): BootstrapPinnedCommitment | undefined {
  return catalogue.pinnedCommitments.find(
    (c) =>
      c.network === snapshot.network &&
      c.coreVersion === snapshot.coreVersion &&
      c.height === snapshot.height &&
      c.blockHash === snapshot.blockHash
  );
}

/** A source is usable only under an operator allowlisted https origin or local directory. */
export function classifySource(
  source: string,
  allowlist: string[]
): { kind: 'https' | 'file'; ref: string } {
  if (/^https:\/\//i.test(source)) {
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      throw new BootstrapEvidenceError('source-not-allowlisted', 'The snapshot source URL is malformed.');
    }
    if (url.username || url.password || url.protocol !== 'https:') {
      throw new BootstrapEvidenceError('source-not-allowlisted', 'The snapshot source URL is not a plain https URL.');
    }
    if (!allowlist.some((entry) => /^https:\/\//i.test(entry) && source.startsWith(entry.endsWith('/') ? entry : entry + '/'))) {
      throw new BootstrapEvidenceError('source-not-allowlisted', 'The snapshot source origin is not allowlisted (UNIVERSE_BOOTSTRAP_SOURCE_ALLOWLIST).');
    }
    return { kind: 'https', ref: url.origin + url.pathname.replace(/.*\//, '/') };
  }
  if (/^[a-z]+:\/\//i.test(source)) {
    throw new BootstrapEvidenceError('source-not-allowlisted', 'Only https URLs and local paths are accepted as snapshot sources.');
  }
  const normalised = source.replace(/\\/g, '/');
  const allowed = allowlist.some((entry) => {
    if (/^https:\/\//i.test(entry)) {
      return false;
    }
    const dir = entry.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
    return normalised.startsWith(dir) && !normalised.slice(dir.length).split('/').includes('..');
  });
  if (!allowed) {
    throw new BootstrapEvidenceError('source-not-allowlisted', 'The snapshot source path is not under an allowlisted directory (UNIVERSE_BOOTSTRAP_SOURCE_ALLOWLIST).');
  }
  return { kind: 'file', ref: normalised.replace(/.*\//, '') };
}
