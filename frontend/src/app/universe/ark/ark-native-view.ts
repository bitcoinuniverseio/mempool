import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { ArkBatch, ArkOperator } from '../universe.types';

export interface ArkNativeObservation {
  schema: 'universe-ark-native-observation-v1';
  profileSha256: string;
  profile: {schema: 'universe-ark-native-profile-v1'; dialect: 'arkade'; version: 'v0.9.16';
    sourceRevision: string; providerId: string; providerName: string; signerPubkey: string;
    forfeitPubkey: string; network: 'signet'; genesisHash: string; signetChallenge: string;
    blockOneHash: string; publicationIntent: 'owned-public-indexer'};
  anchor: {height: number; hash: string};
  observedAt: string;
  info: {version: 'v0.9.16'; network: 'signet'; signerPubkey: string; forfeitPubkey: string;
    sessionDurationSeconds: string; scheduledSession: unknown | null;
    unilateralExitDelay: {unit: 'seconds' | 'blocks'; value: string};
    boardingExitDelay: {unit: 'seconds' | 'blocks'; value: string}; providerDigest: string};
}
export interface ArkBatchWindow {after: string; before?: string; limit: number;}
export interface ArkBatchPage {
  batches: ArkBatch[]; total: null;
  page: {after: string; before: string; limit: number; nativeObservedCount: number; observedCount: number;
    completeCatalogue: false; scope: 'bounded-native-completed-rounds'; continuation: null};
}
export interface ArkNativeProofInput {
  schema: 'universe-ark-native-proof-v1'; network: 'signet'; providerId: string;
  batchOutpoint: string; vtxoOutpoint: string;
  arkade: {nodes: Array<{txid: string; tx: string; children: Record<string, string>}>;
    leaf_outpoint: string; default_vtxo: Record<string, unknown>};
}
export interface ArkNativeProofVerdict {
  schema: 'universe-ark-native-proof-verdict-v1'; valid: boolean | null;
  stage: 'verified-native-proof' | 'invalid-native-proof' | 'unavailable-native-verifier';
  exitViable: null; protocolVerified: null; error?: string; source?: ArkNativeObservation;
  evidence?: {vtxoOutpoint: string; batchOutpoint: string; amountAtomic: string; script: string;
    expiryUnixSeconds: string; nativePsbtSha256: string[];
    transactionChecks: Array<{txid: string; input_outpoint: string; fee_sats: number | null; signature_valid: boolean | null}>};
  scope: string;
}
const hash = /^[0-9a-f]{64}$/;
const pubkey = /^(02|03)[0-9a-f]{64}$/;
const uint = /^(0|[1-9][0-9]{0,19})$/;
const seconds = /^(0|[1-9][0-9]{0,11})$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const boundedUint = (v: unknown): v is string => typeof v === 'string' && uint.test(v) && BigInt(v) <= 18446744073709551615n;
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const outpoint = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}:(0|[1-9][0-9]{0,9})$/.test(v) && Number(v.split(':')[1]) <= 0xffffffff;
const keys = (v: unknown, allowed: string[]): boolean => object(v) && Object.keys(v).every(k => allowed.includes(k));
function reject(message: string): never {throw new Error(message);}
export const ARK_NATIVE_PROOF_SCOPE = 'Native provider membership, original signed PSBT identity, independently observed confirmed unspent Bitcoin anchor, public DefaultVtxo policy and reconstructed Taproot key-path signatures. No unilateral exit, spend-policy acceptance, future expiry or whole Ark lifecycle is established.';

export function readArkSource(value: unknown, network: string): ArkNativeObservation {
  if (!object(value) || value.schema !== 'universe-ark-native-observation-v1' || !hash.test(value.profileSha256)
    || !object(value.profile) || value.profile.schema !== 'universe-ark-native-profile-v1'
    || value.profile.dialect !== 'arkade' || value.profile.version !== 'v0.9.16'
    || value.profile.network !== network || network !== 'signet' || !/^[0-9a-f]{40}$/.test(value.profile.sourceRevision)
    || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.profile.providerId) || typeof value.profile.providerName !== 'string'
    || !value.profile.providerName.length || value.profile.providerName.length > 128
    || !pubkey.test(value.profile.signerPubkey) || !pubkey.test(value.profile.forfeitPubkey)
    || !hash.test(value.profile.genesisHash) || !hash.test(value.profile.blockOneHash)
    || !/^(?:[0-9a-f]{2}){1,10000}$/.test(value.profile.signetChallenge)
    || value.profile.publicationIntent !== 'owned-public-indexer'
    || !object(value.anchor) || !integer(value.anchor.height) || !hash.test(value.anchor.hash)
    || typeof value.observedAt !== 'string' || !Number.isFinite(Date.parse(value.observedAt))
    || !object(value.info) || value.info.network !== network || value.info.version !== value.profile.version
    || value.info.signerPubkey !== value.profile.signerPubkey || value.info.forfeitPubkey !== value.profile.forfeitPubkey
    || !boundedUint(value.info.sessionDurationSeconds) || !hash.test(value.info.providerDigest)) reject('Malformed or foreign Ark provider observation.');
  for (const delay of [value.info.unilateralExitDelay, value.info.boardingExitDelay]) {
    if (!object(delay) || !['seconds', 'blocks'].includes(delay.unit) || !boundedUint(delay.value)) reject('Malformed Ark relative-locktime units.');
  }
  return value as ArkNativeObservation;
}
export function sameArkSource(a: ArkNativeObservation, b: ArkNativeObservation): boolean {
  return a.profileSha256 === b.profileSha256 && a.info.providerDigest === b.info.providerDigest
    && Object.keys(a.profile).length === Object.keys(b.profile).length
    && Object.keys(a.profile).every(key => a.profile[key] === b.profile[key]);
}
export function readArkOperator(value: unknown, network: string): ArkOperator {
  if (!object(value) || typeof value.name !== 'string' || !value.name.length || value.name.length > 128 || value.status !== 'observed'
    || [value.activeVtxoCount,value.currentBatchHeight,value.roundIntervalSec].some(v => v !== null && !integer(v))
    || value.totalVolumeSats !== null && !boundedUint(value.totalVolumeSats)) reject('Malformed native Ark operator facts.');
  const source = readArkSource(value.source, network);
  if (value.id !== source.profile.providerId || value.aspPubkey !== source.info.signerPubkey
    || value.providerVersion !== source.info.version || value.sessionDurationSeconds !== source.info.sessionDurationSeconds) reject('Native Ark operator does not match its source observation.');
  return value as ArkOperator;
}
export function arkWindow(after: string, before: string, limit: number): ArkBatchWindow {
  if (!seconds.test(after) || before && !seconds.test(before) || before && BigInt(after) >= BigInt(before)
    || !integer(limit) || limit < 1 || limit > 100) reject('Use an after/before interval in Unix seconds and a limit from 1 to 100.');
  return {after, ...(before ? {before} : {}), limit};
}
export function readArkBatch(value: unknown, network: string): ArkBatch {
  if (!object(value) || !uuid.test(value.batchId) || typeof value.operatorId !== 'string' || !hash.test(value.anchorTxid)
    || value.rootHash !== null && !hash.test(value.rootHash)
    || value.vtxoCount !== null && (!integer(value.vtxoCount) || value.vtxoCount > 100000)
    || value.totalAmountSats !== null && !boundedUint(value.totalAmountSats)
    || !integer(value.roundTimestamp) || value.roundTimestamp > 999999999999
    || value.expirationTimestamp !== null && !integer(value.expirationTimestamp)
    || !['observed-completed', 'swept'].includes(value.status) || value.nativeStage !== 'FINALIZATION_STAGE'
    || !integer(value.endedAt) || value.endedAt < value.roundTimestamp || value.confirmation !== null) reject('Malformed native completed-round observation.');
  const source = readArkSource(value.source, network);
  if (source.profile.providerId !== value.operatorId) reject('Ark round belongs to a different provider.');
  return value as ArkBatch;
}
export function readArkBatchPage(value: unknown, network: string, window: ArkBatchWindow): ArkBatchPage {
  if (!object(value) || !Array.isArray(value.batches) || value.total !== null || !object(value.page)) reject('Malformed bounded Ark completed-round page.');
  const p = value.page;
  if (!seconds.test(p.after) || !seconds.test(p.before) || BigInt(p.after) >= BigInt(p.before)
    || p.after !== window.after || window.before !== undefined && p.before !== window.before || p.limit !== window.limit
    || !integer(p.nativeObservedCount) || p.nativeObservedCount > p.limit || p.observedCount !== value.batches.length
    || p.observedCount > p.nativeObservedCount || p.completeCatalogue !== false
    || p.scope !== 'bounded-native-completed-rounds' || p.continuation !== null) reject('Ark response does not match the requested bounded window.');
  let previousStart = Infinity; let source: ArkNativeObservation | undefined;
  const ids = new Set<string>();
  for (const row of value.batches) {
    const b = readArkBatch(row, network);
    if (ids.has(b.batchId) || b.roundTimestamp > previousStart || b.roundTimestamp >= Number(p.before)
      || p.after !== '0' && b.roundTimestamp <= Number(p.after)
      || source && (!sameArkSource(source, b.source!) || source.anchor.height !== b.source!.anchor.height || source.anchor.hash !== b.source!.anchor.hash)) reject('Ark window rows disagree in source, order or interval.');
    ids.add(b.batchId); previousStart = b.roundTimestamp; source = b.source;
  }
  return value as ArkBatchPage;
}
function psbtBytes(tx: string): Uint8Array {
  if (typeof tx !== 'string' || tx.length > 90000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(tx)) reject('Original native PSBT must use bounded standard base64.');
  let binary: string;
  try {binary = atob(tx);} catch {reject('Invalid native PSBT base64.');}
  if (binary.length > 65536 || btoa(binary) !== tx || !binary.startsWith('psbt\xff')) reject('A complete original signed PSBT is required.');
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
export function readArkProof(text: string, network: string): ArkNativeProofInput {
  if (new TextEncoder().encode(text).length > 2100000) reject('Native proof package exceeds the bounded 2.1 MB input.');
  let v: any; try {v = JSON.parse(text);} catch {reject('Paste a versioned JSON proof package.');}
  if (!keys(v, ['schema','network','providerId','batchOutpoint','vtxoOutpoint','arkade'])
    || v.schema !== 'universe-ark-native-proof-v1' || v.network !== network || network !== 'signet'
    || !/^[a-zA-Z0-9_-]{1,128}$/.test(v.providerId) || !outpoint(v.batchOutpoint) || !outpoint(v.vtxoOutpoint)
    || !keys(v.arkade, ['nodes','leaf_outpoint','default_vtxo']) || v.arkade.leaf_outpoint !== v.vtxoOutpoint
    || !Array.isArray(v.arkade.nodes) || !v.arkade.nodes.length || v.arkade.nodes.length > 128) reject('Supply the complete native PSBT tree for the selected Signet provider, batch and VTXO. A hash array is unsupported.');
  const ids = new Set<string>();
  for (const node of v.arkade.nodes) {
    if (!keys(node, ['txid','tx','children']) || !hash.test(node.txid) || ids.has(node.txid) || !object(node.children)
      || Object.keys(node.children).some(k => !/^(0|[1-9][0-9]{0,9})$/.test(k) || Number(k) > 0xffffffff)
      || Object.values(node.children).some(id => typeof id !== 'string' || !hash.test(id))) reject('Native tree nodes and child identities must be unique and explicit.');
    psbtBytes(node.tx); ids.add(node.txid);
  }
  if (!ids.has(v.vtxoOutpoint.split(':')[0])) reject('The selected VTXO transaction is absent from the complete tree.');
  const policy = v.arkade.default_vtxo;
  const secondsPolicy = policy?.version === 2;
  if (!keys(policy, secondsPolicy ? ['version','pubkey','server_pubkey','exit_delay_seconds'] : ['pubkey','server_pubkey','exit_delay_blocks'])
    || !hash.test(policy.pubkey) || !hash.test(policy.server_pubkey)
    || !integer(secondsPolicy ? policy.exit_delay_seconds : policy.exit_delay_blocks)) reject('Supply the public DefaultVtxo policy with explicit seconds or blocks.');
  return v;
}
export function readArkVerdict(value: unknown, request: ArkNativeProofInput, selected: ArkNativeObservation): ArkNativeProofVerdict {
  if (!object(value) || value.schema !== 'universe-ark-native-proof-verdict-v1' || value.exitViable !== null || value.protocolVerified !== null
    || value.scope !== ARK_NATIVE_PROOF_SCOPE || ![true,false,null].includes(value.valid)
    || value.stage !== (value.valid === true ? 'verified-native-proof' : value.valid === false ? 'invalid-native-proof' : 'unavailable-native-verifier')) reject('Malformed or overstated native Ark proof verdict.');
  if (value.source) {
    const source = readArkSource(value.source, request.network);
    if (source.profile.providerId !== request.providerId || !sameArkSource(source, selected)
      || Date.parse(source.observedAt) < Date.parse(selected.observedAt)
      || source.anchor.height < selected.anchor.height || source.anchor.height === selected.anchor.height && source.anchor.hash !== selected.anchor.hash) reject('Ark proof source changed or belongs to a different provider/context.');
  }
  if (value.valid !== true) {
    if (typeof value.error !== 'string' || !value.error.length || value.error.length > 2048 || value.evidence !== undefined) reject('Invalid/unavailable proof must not carry positive evidence.');
    return value as ArkNativeProofVerdict;
  }
  const e = value.evidence;
  if (!value.source || !object(e) || e.vtxoOutpoint !== request.vtxoOutpoint || e.batchOutpoint !== request.batchOutpoint
    || !boundedUint(e.amountAtomic) || BigInt(e.amountAtomic) === 0n || !/^5120[0-9a-f]{64}$/.test(e.script)
    || !seconds.test(e.expiryUnixSeconds) || BigInt(e.expiryUnixSeconds) <= BigInt(Math.floor(Date.parse(value.source.observedAt) / 1000))
    || !Array.isArray(e.transactionChecks) || !e.transactionChecks.length || e.transactionChecks.length > request.arkade.nodes.length
    || !Array.isArray(e.nativePsbtSha256) || e.nativePsbtSha256.length !== e.transactionChecks.length) reject('Native proof evidence does not bind the requested batch, VTXO or current observation.');
  let previous = request.batchOutpoint; const checked = new Set<string>();
  e.transactionChecks.forEach((check: any, index: number) => {
    const node = request.arkade.nodes.find(n => n.txid === check.txid);
    if (!node || checked.has(check.txid) || check.signature_valid !== true || !integer(check.fee_sats)
      || !outpoint(check.input_outpoint) || (index === 0 ? check.input_outpoint !== previous : !check.input_outpoint.startsWith(previous + ':'))
      || e.nativePsbtSha256[index] !== bytesToHex(sha256(psbtBytes(node.tx)))) reject('Native PSBT digest, signature or transaction path does not match the submitted package.');
    checked.add(check.txid); previous = check.txid;
  });
  if (previous !== request.vtxoOutpoint.split(':')[0]) reject('Native verified path does not terminate at the selected VTXO.');
  return value as ArkNativeProofVerdict;
}
