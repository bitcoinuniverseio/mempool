import { createHash } from 'crypto';
import { Transaction } from 'bitcoinjs-lib';
import { WorkbenchCoreReader } from '../intelligence/workbench/workbench-core';
import { SPV_GENESIS } from '../intelligence/verification/spv-proof';

export interface TapdProofSource {
  request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
}
export type TaprootProofVerdict =
  | { valid: true; stage: 'verified'; asset_id: string; genesis_point: string; proofs_in_file: number;
      network: string; proof_sha256: string; verification_scope: string;
      anchor: { txid: string; outpoint: string; block_height: number; block_hash: string };
      source: { network: string; genesis_hash: string; block_hash: string; block_height: number; observed_at: string;
        tapd_version: string; tapd_block_hash: string; tapd_block_height: number } }
  | { valid: false; stage: 'invalid-input' | 'unavailable-verifier' | 'invalid-proof' | 'asset-mismatch' | 'anchor-mismatch'; error: string };

const hash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const uint = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 0xffffffff;
const outpoint = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}:(0|[1-9][0-9]{0,9})$/.test(v) && uint(Number(v.split(':')[1]));
const unknown = (message: string): never => { throw new Error(message); };
let activeProofs = 0;

export function canonicalProof(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 1024 * 1024) return null;
  const encoded = value.replace(/[ \t\r\n]/g, '');
  if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return null;
  return Buffer.from(encoded, 'base64').toString('base64') === encoded ? encoded : null;
}

function claim(body: any) {
  const proof = body?.decoded_proof;
  const asset = proof?.asset;
  const anchor = asset?.chain_anchor;
  if (proof?.proof_at_depth !== 0 || !uint(proof?.number_of_proofs) || proof.number_of_proofs < 1 ||
      !hash(asset?.asset_genesis?.asset_id) || !outpoint(asset?.asset_genesis?.genesis_point) ||
      !uint(anchor?.block_height) || !hash(anchor?.anchor_block_hash) || !outpoint(anchor?.anchor_outpoint) ||
      typeof anchor?.anchor_tx !== 'string' || anchor.anchor_tx.length > 8000000 || !/^(?:[0-9a-f]{2})+$/.test(anchor.anchor_tx)) {
    return unknown('tapd returned incomplete or malformed proof identity/anchor evidence.');
  }
  let tx: Transaction;
  try { tx = Transaction.fromHex(anchor.anchor_tx); } catch { return unknown('tapd returned a malformed anchor transaction.'); }
  const index = Number(anchor.anchor_outpoint.split(':')[1]);
  if (tx.getId() !== anchor.anchor_outpoint.split(':')[0] || !tx.outs[index] || !/^5120[0-9a-f]{64}$/.test(tx.outs[index].script.toString('hex'))) {
    return unknown('tapd anchor transaction does not bind the stated Taproot output.');
  }
  return { id: asset.asset_genesis.asset_id as string, genesis: asset.asset_genesis.genesis_point as string,
    count: proof.number_of_proofs as number, height: anchor.block_height as number, hash: anchor.anchor_block_hash as string,
    outpoint: anchor.anchor_outpoint as string, raw: anchor.anchor_tx as string, txid: tx.getId() };
}

/** A native tapd verdict plus independently read owned-chain anchor bytes, not browser consensus verification. */
export async function verifyTaprootProof(network: string, http: TapdProofSource, core: WorkbenchCoreReader,
  assetId: string, encoded: string): Promise<TaprootProofVerdict> {
  let timer: NodeJS.Timeout | undefined;
  const operation = runVerification(network, http, core, assetId, encoded);
  try {
    return await Promise.race([operation, new Promise<TaprootProofVerdict>(resolve => {
      timer = setTimeout(() => resolve({ valid: false, stage: 'unavailable-verifier', error: 'The bounded proof verification deadline expired; no verdict is available.' }), 45000);
      timer.unref();
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

// A timed-out caller does not release its concurrency slot while underlying I/O is still running.
async function runVerification(network: string, http: TapdProofSource, core: WorkbenchCoreReader,
  assetId: string, encoded: string): Promise<TaprootProofVerdict> {
  const proof = canonicalProof(encoded);
  if (!proof || typeof assetId !== 'string' || !hash(assetId.toLowerCase())) return { valid: false, stage: 'invalid-input', error: 'Supply a hexadecimal asset ID and canonical base64 proof file of at most 1 MiB.' };
  if (activeProofs >= 2) return { valid: false, stage: 'unavailable-verifier', error: 'The bounded Taproot proof verifier is busy; retry.' };
  activeProofs++;
  try {
    const request = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
      const response = await http.request(method, path, body);
      // Native malformed-proof failures can be gRPC Unknown/HTTP 500. They are not proof verdicts.
      if (response.status !== 200) unknown('tapd could not complete the proof operation; no native verdict is available.');
      return response.body as any;
    };
    const checkpoint = async () => {
      const chain = await core.call('getblockchaininfo', []);
      const genesis = await core.call('getblockhash', [0]);
      const expected = network === 'mainnet' ? 'main' : network === 'testnet' ? 'test' : network;
      if (core.network !== network || !SPV_GENESIS[network] || genesis !== SPV_GENESIS[network] || chain?.chain !== expected ||
          chain.initialblockdownload !== false || !uint(chain.blocks) || !hash(chain.bestblockhash)) unknown('Owned Bitcoin network, genesis or sync checkpoint is inconsistent.');
      return { network, genesis_hash: genesis as string, block_hash: chain.bestblockhash as string, block_height: chain.blocks as number };
    };
    const before = await checkpoint();
    const daemon = async () => {
      const info = await request('GET', '/v1/taproot-assets/getinfo');
      const selected = info?.network === 'testnet3' ? 'testnet' : info?.network;
      if (selected !== network || info?.sync_to_chain !== true || !uint(info?.block_height) || !hash(info?.block_hash) ||
          typeof info?.version !== 'string' || !info.version || info.version.length > 256 || info.block_height !== before.block_height || info.block_hash !== before.block_hash ||
          await core.call('getblockhash', [info.block_height]) !== info.block_hash) unknown('tapd network or synced chain checkpoint is inconsistent with owned Bitcoin.');
      return { version: info.version as string, height: info.block_height as number, hash: info.block_hash as string };
    };
    const tapd = await daemon();
    const assertStable = async () => {
      if (JSON.stringify(tapd) !== JSON.stringify(await daemon()) || JSON.stringify(before) !== JSON.stringify(await checkpoint())) {
        unknown('Proof sources changed checkpoint during verification; retry.');
      }
    };
    // tapd v0.6.0 RESTJsonUnmarshalOpts explicitly uses UseHexForBytes (not protobuf base64).
    const bytes = Buffer.from(proof, 'base64');
    const raw = bytes.toString('hex');
    const decoded = claim(await request('POST', '/v1/taproot-assets/proofs/decode', { raw_proof: raw, proof_at_depth: 0 }));
    if (decoded.id !== assetId.toLowerCase()) {
      await assertStable();
      return { valid: false, stage: 'asset-mismatch', error: 'The decoded proof belongs to a different asset.' };
    }
    const response = await request('POST', '/v1/taproot-assets/proofs/verify', { raw_proof_file: raw, genesis_point: decoded.genesis });
    if (response?.valid === false) {
      await assertStable();
      return { valid: false, stage: 'invalid-proof', error: 'The owned tapd verifier rejected this proof file.' };
    }
    if (response?.valid !== true) unknown('tapd returned no boolean proof verdict.');
    const verified = claim(response);
    if (verified.id !== decoded.id || verified.genesis !== decoded.genesis || verified.count !== decoded.count) unknown('tapd decode and verification disagree about the same proof file identity.');
    if (JSON.stringify(verified) !== JSON.stringify(decoded)) unknown('tapd decode and verification disagree about the same proof file anchor.');
    if (verified.height > before.block_height || await core.call('getblockhash', [verified.height]) !== verified.hash) {
      await assertStable();
      return { valid: false, stage: 'anchor-mismatch', error: 'The verified proof anchor is not on the owned active chain at its stated height.' };
    }
    const header = await core.call('getblockheader', [verified.hash, true]);
    if (header?.hash !== verified.hash || header?.height !== verified.height || !Number.isSafeInteger(header?.confirmations) || header.confirmations !== before.block_height - verified.height + 1) unknown('Owned Bitcoin anchor header is inconsistent.');
    const ownedRaw = await core.call('getrawtransaction', [verified.txid, false, verified.hash]);
    if (ownedRaw !== verified.raw) unknown('Owned Bitcoin anchor transaction bytes differ from the verified proof.');
    const afterTapd = await daemon();
    const after = await checkpoint();
    if (JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(tapd) !== JSON.stringify(afterTapd)) unknown('Proof sources changed checkpoint during verification; retry.');
    return { valid: true, stage: 'verified', asset_id: verified.id, genesis_point: verified.genesis, proofs_in_file: verified.count,
      network, proof_sha256: createHash('sha256').update(bytes).digest('hex'),
      verification_scope: 'Owned tapd native proof-file verification, exact decoded/verified identity binding, and owned Bitcoin active-chain anchor transaction readback. This is not independent browser consensus validation or a current-spendability claim.',
      anchor: { txid: verified.txid, outpoint: verified.outpoint, block_height: verified.height, block_hash: verified.hash },
      source: { ...after, observed_at: new Date().toISOString(), tapd_version: tapd.version, tapd_block_hash: tapd.hash, tapd_block_height: tapd.height } };
  } catch {
    // RPC/HTTP errors can contain credentials, submitted proof bytes or private metadata.
    return { valid: false, stage: 'unavailable-verifier', error: 'The owned proof sources did not provide consistent, complete native verification and Bitcoin anchor evidence. No positive or invalid-proof verdict is available.' };
  } finally { activeProofs--; }
}
