import { AnchorReadError } from './anchor-reader';
import { reconstructVpack } from './vpack-reconstruction';

function canonical(value: any): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

function minimal(evidence: any, network: string) {
  const [txid, output] = evidence.anchor_outpoint.split(':');
  return { vtxo_id: evidence.vtxo_id, version: 1, network, amount_sats: evidence.amount_sats,
    script_pubkey: evidence.script_pub_key, sequence: evidence.sequence, exit_delay_blocks: evidence.exit_delta,
    anchor_outpoint: { txid, vout: Number(output) }, asp_pubkey: evidence.asp_pubkey,
    user_pubkey: evidence.user_pubkey, expires_at_height: evidence.expiry };
}

/** @asyncUnsafe rejections propagate to the caller, which handles them. */
export async function translateVpackDialect(request: any) {
  const { source_dialect: source, target_dialect: target, package: pkg, network } = request || {};
  if (!['arkade', 'bark', 'mvv'].includes(source) || !['arkade', 'bark', 'mvv'].includes(target) || source === target) throw new AnchorReadError('invalid-dialects', 'Select two different supported dialect names.', 400);
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new AnchorReadError('invalid-package', 'Supply a source package object.', 400);
  if (source !== 'mvv' && target !== 'mvv') throw new AnchorReadError('incompatible-dialect-proof', 'Native Bark and Arkade templates require different input sequences. Rewriting them changes transaction identities and signatures; a lossless cross-protocol conversion is not established.', 400);
  const native = source === 'mvv' ? pkg.native_package : pkg;
  const nativeKind = native && typeof native.bark_hex === 'string' ? 'bark' : native?.arkade && typeof native.arkade === 'object' ? 'arkade' : null;
  const key = nativeKind === 'bark' ? 'bark_hex' : 'arkade';
  if (!nativeKind || Object.keys(native).some(field => field !== key) || (source !== 'mvv' && source !== nativeKind)) throw new AnchorReadError('missing-native-proof', 'A lossless conversion requires the complete native bark_hex or arkade tree proof. A minimal summary cannot reconstruct missing signatures or policy branches.', 400);
  if (source === 'mvv' && target !== nativeKind) throw new AnchorReadError('incompatible-dialect-proof', 'The preserved proof belongs to a different protocol; changing its native transaction template would invalidate identities and signatures.', 400);
  if (source === 'mvv' && Object.keys(pkg).some(key => !['minimal_viable_vtxo', 'native_package'].includes(key))) throw new AnchorReadError('unsupported-extension', 'The target codec cannot preserve an unknown source extension; conversion was rejected.', 400);
  const evidence = await reconstructVpack({ network, ...native });
  const mvv = minimal(evidence, network);
  if (source === 'mvv') {
    if (!pkg.minimal_viable_vtxo || Object.keys(pkg.minimal_viable_vtxo).length !== Object.keys(mvv).length ||
      Object.keys(mvv).some(key => canonical(pkg.minimal_viable_vtxo[key]) !== canonical(mvv[key]))) throw new AnchorReadError('metadata-mismatch', 'MVV fields do not match the preserved native proof.', 400);
  }
  return { success: true, source_dialect: source, target_dialect: target,
    package: target === 'mvv' ? { minimal_viable_vtxo: mvv, native_package: native } : native,
    fields_preserved: Object.keys(mvv), fields_lost: [], source_data_preserved: true, native_bytes_preserved: nativeKind === 'bark', native_psbts_preserved: nativeKind === 'arkade',
    summary_complete: Object.values(mvv).every(value => value !== null && value !== undefined),
    vtxo_id: evidence.vtxo_id, anchor: evidence.anchor, protocol_verified: null, exit_viable: null,
    verification_scope: 'Native proof and MVV summary envelope round-trip, preserving source data and every native transaction/PSBT byte. Summary fields come from the actual codec; unavailable fields remain null. This envelope retains its original protocol and does not migrate funds or establish exit viability.' };
}
