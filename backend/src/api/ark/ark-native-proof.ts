import { createHash } from 'crypto';
import { performance } from 'perf_hooks';
import { Psbt, Transaction } from 'bitcoinjs-lib';
import { AnchorReadError } from '../intelligence/ark-vpack/anchor-reader';
import { reconstructVpack, verifyReconstructedTransactions } from '../intelligence/ark-vpack/vpack-reconstruction';
import { WorkbenchCoreReader } from '../intelligence/workbench/workbench-core';
import { ArkNativeObservation, ArkNativeSource, ArkNativeSourceError } from './ark-native-source';

export interface ArkNativeProofInput {
  schema: 'universe-ark-native-proof-v1'; network: 'signet'; providerId: string;
  batchOutpoint: string; vtxoOutpoint: string;
  arkade: { nodes: Array<{ txid: string; tx: string; children: Record<string, string> }>;
    leaf_outpoint: string; default_vtxo: Record<string, unknown> };
}
export interface ArkNativeProofVerdict {
  schema: 'universe-ark-native-proof-verdict-v1'; valid: boolean | null;
  stage: 'verified-native-proof' | 'invalid-native-proof' | 'unavailable-native-verifier';
  exitViable: null; protocolVerified: null; error?: string;
  source?: ArkNativeObservation;
  evidence?: { vtxoOutpoint: string; batchOutpoint: string; amountAtomic: string;
    script: string; expiryUnixSeconds: string; nativePsbtSha256: string[];
    transactionChecks: ReturnType<typeof verifyReconstructedTransactions> };
  scope: string;
}
export interface ArkNativeProofDependencies {
  source: Pick<ArkNativeSource, 'profile' | 'observe'>; core: WorkbenchCoreReader;
  reconstruct?: typeof reconstructVpack;
}
const HASH = /^[0-9a-f]{64}$/;
const OUTPOINT = /^([0-9a-f]{64}):(0|[1-9][0-9]{0,9})$/;
const SCOPE = 'Native provider membership, original signed PSBT identity, independently observed confirmed unspent Bitcoin anchor, public DefaultVtxo policy and reconstructed Taproot key-path signatures. No unilateral exit, spend-policy acceptance, future expiry or whole Ark lifecycle is established.';
function invalid(message: string): never { throw new AnchorReadError('invalid-native-proof', message, 400); }
function unavailable(message: string): never { throw new ArkNativeSourceError('unavailable-native-verifier', message); }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: unknown, allowed: string[]): boolean => object(value) && Object.keys(value).every(key => allowed.includes(key));
const outpoint = (value: unknown): value is string => typeof value === 'string' && OUTPOINT.test(value) && Number(value.split(':')[1]) <= 0xffffffff;
const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const ordered = (value: unknown): string | undefined => object(value) ? JSON.stringify(Object.keys(value).sort().map(key => [key, value[key]])) : JSON.stringify(value);

/** Original PSBT bytes remain evidence. Only authenticated public previous-output metadata is added. */
export function finalizeNativeKeyPath(
  nodes: ArkNativeProofInput['arkade']['nodes'], unsignedHexes: string[],
  anchor: { anchor_outpoint: string; amount_sats: number | null; script_pub_key: string | null },
): { hexes: string[]; digests: string[]; checks: ReturnType<typeof verifyReconstructedTransactions> } {
  if (typeof anchor.amount_sats !== 'number' || !Number.isSafeInteger(anchor.amount_sats) || anchor.amount_sats <= 0 || typeof anchor.script_pub_key !== 'string' || !/^5120[0-9a-f]{64}$/.test(anchor.script_pub_key)) {unavailable('The public anchor value and Taproot script are unavailable.');}
  let previousOutpoint = anchor.anchor_outpoint;
  let previousValue = anchor.amount_sats;
  let previousScript = anchor.script_pub_key;
  const finalized: string[] = [], digests: string[] = [];
  for (const hex of unsignedHexes) {
    const unsigned = Transaction.fromHex(hex);
    const node = nodes.find(item => item.txid === unsigned.getId());
    if (!node) {invalid('The reconstructed transaction has no original native PSBT.');}
    const bytes = Buffer.from(node.tx, 'base64');
    if (bytes.toString('base64') !== node.tx || bytes.length > 65536) {invalid('The native PSBT encoding is not canonical and bounded.');}
    const psbt = Psbt.fromBuffer(bytes);
    const original = Transaction.fromBuffer(psbt.data.globalMap.unsignedTx.toBuffer());
    if (original.getId() !== node.txid || original.toHex() !== unsigned.toHex() || original.ins.length !== 1) {invalid('The original native PSBT transaction identity changed.');}
    const input = psbt.data.inputs[0];
    const actualOutpoint = Buffer.from(original.ins[0].hash).reverse().toString('hex') + ':' + original.ins[0].index;
    if (actualOutpoint !== previousOutpoint) {invalid('The signed native PSBT refers to a foreign previous output.');}
    if (!input.tapKeySig || ![64, 65].includes(input.tapKeySig.length) || input.tapScriptSig?.length || input.tapLeafScript?.length || input.finalScriptSig || input.finalScriptWitness) {invalid('A complete native Taproot key-path signature is required. Other witness dialects are unsupported.');}
    if (input.witnessUtxo && (input.witnessUtxo.value !== previousValue || input.witnessUtxo.script.toString('hex') !== previousScript)) {invalid('The PSBT previous-output metadata disagrees with independently verified evidence.');}
    if (input.nonWitnessUtxo) {
      const prev = Transaction.fromBuffer(input.nonWitnessUtxo);
      const output = prev.outs[original.ins[0].index];
      if (prev.getId() + ':' + original.ins[0].index !== previousOutpoint || !output || output.value !== previousValue || output.script.toString('hex') !== previousScript) {invalid('The full previous transaction disagrees with independently verified evidence.');}
    }
    if (!input.witnessUtxo) {psbt.updateInput(0, { witnessUtxo: { value: previousValue, script: Buffer.from(previousScript, 'hex') } });}
    psbt.finalizeInput(0);
    const transaction = psbt.extractTransaction(true);
    if (transaction.getId() !== node.txid || transaction.ins[0].witness.length !== 1) {invalid('The reconstructed native witness changed its transaction identity or dialect.');}
    finalized.push(transaction.toHex()); digests.push(sha(bytes));
    if (finalized.length < unsignedHexes.length) {
      const next = Transaction.fromHex(unsignedHexes[finalized.length]);
      const output = transaction.outs[next.ins[0]?.index];
      if (!output) {invalid('The native path refers to a missing intermediate output.');}
      previousOutpoint = transaction.getId() + ':' + next.ins[0].index;
      previousValue = output.value; previousScript = output.script.toString('hex');
    }
  }
  return { hexes: finalized, digests, checks: verifyReconstructedTransactions(finalized, anchor) };
}

/** @asyncSafe Source/parser failures are returned as explicit invalid or unavailable scoped verdicts. */
export async function verifyArkNativeProof(raw: unknown, dependencies: ArkNativeProofDependencies): Promise<ArkNativeProofVerdict> {
  let initial: ArkNativeObservation | undefined;
  const deadline = performance.now() + 28000;
  let closed = false;
  const active = (): void => { if (closed || performance.now() >= deadline) {unavailable('The bounded native proof attempt timed out.');} };
  let timer: NodeJS.Timeout | undefined;
  /** @asyncUnsafe The outer attempt catches and converts source and parser rejections. */
  const task = async (): Promise<ArkNativeProofVerdict> => {
    const request = raw as ArkNativeProofInput;
    if (!keys(request, ['schema', 'network', 'providerId', 'batchOutpoint', 'vtxoOutpoint', 'arkade']) || request.schema !== 'universe-ark-native-proof-v1' || request.network !== 'signet'
      || !outpoint(request.batchOutpoint) || !outpoint(request.vtxoOutpoint) || typeof request.providerId !== 'string'
      || !keys(request.arkade, ['nodes', 'leaf_outpoint', 'default_vtxo']) || request.arkade.leaf_outpoint !== request.vtxoOutpoint
      || !Array.isArray(request.arkade.nodes) || request.arkade.nodes.length < 1 || request.arkade.nodes.length > 128 || JSON.stringify(request).length > 2_100_000) {invalid('Supply the versioned complete native PSBT tree, selected batch and VTXO; a hash array is not a proof.');}
    const ids = new Set<string>();
    for (const node of request.arkade.nodes) {
      if (!keys(node, ['txid', 'tx', 'children']) || !HASH.test(node.txid) || ids.has(node.txid) || typeof node.tx !== 'string' || node.tx.length > 90000
        || !object(node.children) || Object.keys(node.children).some(key => !/^(0|[1-9][0-9]{0,9})$/.test(key)) || Object.values(node.children).some(id => typeof id !== 'string' || !HASH.test(id))) {invalid('The bounded native tree identities and children must be unique and explicit.');}
      ids.add(node.txid);
    }
    if (dependencies.core.network !== 'signet' || dependencies.source.profile.network !== 'signet' || dependencies.source.profile.providerId !== request.providerId) {invalid('The proof belongs to a different configured source.');}
    /** @asyncUnsafe Source rejections propagate to the outer attempt. */
    const read = async (path: string): Promise<Awaited<ReturnType<ArkNativeSource['observe']>>['payload']> => {
      active(); const result = await dependencies.source.observe(path); active();
      if (!initial) {initial = result.observation;}
      else if (result.observation.profileSha256 !== initial.profileSha256 || result.observation.info.providerDigest !== initial.info.providerDigest
        || ordered(result.observation.anchor) !== ordered(initial.anchor)) {unavailable('The provider identity or canonical checkpoint changed during proof verification.');}
      return result.payload;
    };
    await read('/v1/info');
    if (!initial) { unavailable('The native source observation is unavailable.'); }
    const first = initial as ArkNativeObservation;
    const policy = request.arkade.default_vtxo;
    const delay = first.info.unilateralExitDelay;
    const fields = delay.unit === 'seconds' ? ['version', 'pubkey', 'server_pubkey', 'exit_delay_seconds'] : ['pubkey', 'server_pubkey', 'exit_delay_blocks'];
    if (!keys(policy, fields) || typeof policy.pubkey !== 'string' || !HASH.test(policy.pubkey) || policy.server_pubkey !== first.info.signerPubkey.slice(2)
      || (delay.unit === 'seconds' ? policy.version !== 2 || policy.exit_delay_seconds !== Number(delay.value) : policy.exit_delay_blocks !== Number(delay.value))) {invalid('The complete native public policy does not match the observed provider and relative-locktime units.');}
    const [batchTxid, batchIndex] = request.batchOutpoint.split(':');
    const vtxos = await read('/v1/indexer/vtxos?outpoints=' + request.vtxoOutpoint + '&page.size=1&page.index=1');
    if (!Array.isArray(vtxos.vtxos) || vtxos.vtxos.length !== 1) {unavailable('The selected native VTXO is unavailable.');}
    const vtxo = vtxos.vtxos[0];
    if (!Number.isInteger(vtxo.outpoint?.vout) || vtxo.outpoint.vout < 0 || vtxo.outpoint.vout > 0xffffffff || vtxo.outpoint?.txid + ':' + vtxo.outpoint?.vout !== request.vtxoOutpoint || typeof vtxo.amount !== 'string' || !/^[1-9][0-9]{0,15}$/.test(vtxo.amount) || !/^5120[0-9a-f]{64}$/.test(vtxo.script)
      || !/^[1-9][0-9]{0,11}$/.test(vtxo.expiresAt) || !Array.isArray(vtxo.commitmentTxids) || !vtxo.commitmentTxids.includes(batchTxid)
      || [vtxo.isPreconfirmed, vtxo.isSpent, vtxo.isSwept, vtxo.isUnrolled].some(value => typeof value !== 'boolean')) {unavailable('The native VTXO response does not establish the requested membership and lifecycle.');}
    if (vtxo.isPreconfirmed || vtxo.isSpent || vtxo.isSwept || vtxo.isUnrolled || BigInt(vtxo.expiresAt) <= BigInt(Math.floor(Date.parse(first.observedAt) / 1000))) {invalid('The observed native VTXO is preconfirmed, spent, swept, unrolled or expired.');}
    const commitment = await read('/v1/indexer/commitmentTx/' + batchTxid);
    const batch = commitment.batches?.[batchIndex];
    if (!batch || batch.swept !== false || batch.expiresAt !== vtxo.expiresAt) {invalid('The native batch lifecycle does not match the selected VTXO.');}
    const tree: Array<{ txid: string; children: Record<string, string> }> = [];
    let total = 0;
    for (let index = 1; index <= 2; index++) {
      const page = await read('/v1/indexer/batch/' + batchTxid + '/' + batchIndex + '/tree?page.size=100&page.index=' + index);
      if (!Array.isArray(page.vtxoTree) || page.vtxoTree.length > 100 || !page.page || page.page.current !== index || !Number.isInteger(page.page.total) || page.page.total < 1 || page.page.total > 2
        || page.page.next !== Math.min(index + 1, page.page.total) || (total && page.page.total !== total)) {unavailable('The native tree pagination does not prove a bounded complete snapshot.');}
      total = page.page.total; tree.push(...page.vtxoTree);
      if (index === total) {break;}
    }
    if (tree.some(node => !object(node) || !HASH.test(node.txid) || !object(node.children)
      || Object.keys(node.children).some(index => !/^(0|[1-9][0-9]{0,9})$/.test(index))
      || Object.values(node.children).some(txid => typeof txid !== 'string' || !HASH.test(txid)))) { unavailable('The native tree response is malformed.'); }
    if (tree.length !== request.arkade.nodes.length || tree.length > 128 || new Set(tree.map(node => node.txid)).size !== tree.length) {invalid('The supplied proof omits or duplicates native tree nodes.');}
    for (const node of request.arkade.nodes) {
      const actual = tree.find(item => item.txid === node.txid);
      if (!actual || ordered(actual.children) !== ordered(node.children)) {invalid('The supplied native tree differs from the provider membership.');}
    }
    for (let offset = 0; offset < request.arkade.nodes.length; offset += 32) {
      const nodes = request.arkade.nodes.slice(offset, offset + 32);
      const payload = await read('/v1/indexer/virtualTx/' + nodes.map(node => node.txid).join(','));
      if (!Array.isArray(payload.txs) || payload.txs.length !== nodes.length || nodes.some(node => !payload.txs.includes(node.tx))) {invalid('The original signed PSBT bytes differ from the native provider.');}
    }
    /** @asyncUnsafe The outer attempt catches RPC rejection; deadline prevents subsequent reads. */
    const callCore: WorkbenchCoreReader['call'] = async (method, params) => { active(); const result = await dependencies.core.call(method, params); active(); return result; };
    const core: WorkbenchCoreReader = { network: 'signet', call: callCore };
    const evidence = await (dependencies.reconstruct || reconstructVpack)({ network: 'signet', arkade: request.arkade, expected_vtxo_id: request.vtxoOutpoint }, core);
    active();
    if (evidence.anchor_outpoint !== request.batchOutpoint || evidence.vtxo_id !== request.vtxoOutpoint || evidence.expected_id_matches !== true
      || String(evidence.amount_sats) !== vtxo.amount || evidence.script_pub_key !== vtxo.script || evidence.anchor.spend_status !== 'unspent' || evidence.anchor.exists_onchain !== true
      || evidence.anchor.source.block_hash !== first.anchor.hash || evidence.anchor.source.block_height !== first.anchor.height) {invalid('The reconstructed proof does not match the native VTXO and confirmed unspent canonical anchor.');}
    const witness = finalizeNativeKeyPath(request.arkade.nodes, evidence.transactions, evidence.anchor);
    if (!witness.checks.length || witness.checks.some(check => check.signature_valid !== true)) {invalid('A reconstructed native Taproot key-path signature is invalid or unavailable.');}
    await read('/v1/info');
    return { schema: 'universe-ark-native-proof-verdict-v1', valid: true, stage: 'verified-native-proof', exitViable: null, protocolVerified: null, source: initial,
      evidence: { vtxoOutpoint: request.vtxoOutpoint, batchOutpoint: request.batchOutpoint, amountAtomic: vtxo.amount, script: vtxo.script,
        expiryUnixSeconds: vtxo.expiresAt, nativePsbtSha256: witness.digests, transactionChecks: witness.checks }, scope: SCOPE };
  };
  try {
    const timeout = new Promise<never>((_accept, reject) => { timer = setTimeout(() => { closed = true; reject(new ArkNativeSourceError('unavailable-native-verifier', 'The bounded native proof attempt timed out.')); }, 28000); });
    return await Promise.race([task(), timeout]);
  } catch (error) {
    const isInvalid = error instanceof AnchorReadError && error.status === 400;
    return { schema: 'universe-ark-native-proof-verdict-v1', valid: isInvalid ? false : null,
      stage: isInvalid ? 'invalid-native-proof' : 'unavailable-native-verifier', exitViable: null, protocolVerified: null,
      ...(initial ? { source: initial } : {}), error: isInvalid ? error.message : 'The independently anchored native proof could not be verified.', scope: SCOPE };
  } finally { closed = true; if (timer) {clearTimeout(timer);} }
}
