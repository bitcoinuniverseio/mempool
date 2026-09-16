import { TaprootControlBlock } from '@scure/btc-signer';
import { TxTree, DefaultVtxo, scriptFromTapLeafScript } from '@arkade-os/sdk';
import { pathToFileURL } from 'node:url';

const hex = value => Buffer.from(value).toString('hex');
function decodeHex(value, bytes) {
  if (typeof value !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(value) || (bytes !== undefined && value.length !== bytes * 2)) throw Error('invalid public hexadecimal');
  return Uint8Array.from(Buffer.from(value, 'hex'));
}
export function decodeArkade(pkg) {
  if (!pkg || Object.keys(pkg).some(key => !['nodes', 'leaf_outpoint', 'default_vtxo'].includes(key))) throw Error('unsupported package extension; refusing data loss');
  if (!Array.isArray(pkg.nodes) || !pkg.nodes.length || pkg.nodes.length > 128 || !/^[0-9a-f]{64}:(0|[1-9][0-9]*)$/i.test(pkg.leaf_outpoint)) throw Error('invalid bounded native tree or leaf outpoint');
  const ids = new Set();
  for (const node of pkg.nodes) {
    if (!node || Object.keys(node).some(key => !['txid', 'tx', 'children'].includes(key)) || !/^[0-9a-f]{64}$/.test(node.txid) || ids.has(node.txid) || typeof node.tx !== 'string' || !node.children || Array.isArray(node.children) || typeof node.children !== 'object') throw Error('invalid native tree node');
    ids.add(node.txid);
    if (Object.keys(node.children).some(key => !/^(0|[1-9][0-9]*)$/.test(key)) || Object.values(node.children).some(id => typeof id !== 'string' || !/^[0-9a-f]{64}$/.test(id))) throw Error('invalid children');
  }
  const byId = new Map(pkg.nodes.map(node => [node.txid, node]));
  function visit(id, path = new Set()) {
    if (!byId.has(id) || path.has(id) || path.size > 128) throw Error('missing child or cyclic native tree');
    const next = new Set(path); next.add(id); for (const child of Object.values(byId.get(id).children)) visit(child, next);
  }
  for (const id of ids) visit(id);
  const graph = TxTree.create(pkg.nodes); graph.validate();
  for (const node of pkg.nodes) if (!graph.find(node.txid)) throw Error('declared txid does not match PSBT');
  const [leafId, leafIndexText] = pkg.leaf_outpoint.split(':'); const leafIndex = Number(leafIndexText);
  const leaf = graph.find(leafId); if (!leaf || leaf.children.size || leafIndex >= leaf.root.outputsLength) throw Error('selected leaf output is unavailable');
  const options = pkg.default_vtxo;
  if (!options || Object.keys(options).some(key => !['pubkey', 'server_pubkey', 'exit_delay_blocks'].includes(key)) || !Number.isSafeInteger(options.exit_delay_blocks) || options.exit_delay_blocks < 1 || options.exit_delay_blocks > 65535) throw Error('a complete DefaultVtxo public policy is required');
  const policy = new DefaultVtxo.Script({ pubKey: decodeHex(options.pubkey, 32), serverPubKey: decodeHex(options.server_pubkey, 32), csvTimelock: { type: 'blocks', value: BigInt(options.exit_delay_blocks) } });
  const output = leaf.root.getOutput(leafIndex);
  if (hex(output.script) !== hex(policy.pkScript)) throw Error('DefaultVtxo policy does not match the actual leaf output');
  function findPath(node) {
    if (node.txid === leafId) return [node];
    for (const child of node.children.values()) { const path = findPath(child); if (path) return [node, ...path]; }
    return null;
  }
  const path = findPath(graph); const transactions = [], finalized = [];
  for (const node of path) {
    try { node.root.finalize(); finalized.push(true); } catch { finalized.push(false); }
    transactions.push(hex(node.root.toBytes(true, true)));
  }
  const rootInput = graph.root.getInput(0);
  return { engine: '@arkade-os/sdk 0.4.72', arkade: pkg, vtxo_id: pkg.leaf_outpoint.toLowerCase(),
    anchor_outpoint: hex(rootInput.txid) + ':' + rootInput.index, amount_sats: Number(output.amount), script_pub_key: hex(output.script),
    user_pubkey: '02' + options.pubkey.toLowerCase(), asp_pubkey: '02' + options.server_pubkey.toLowerCase(), exit_delta: options.exit_delay_blocks,
    exit_path: { script_hex: hex(scriptFromTapLeafScript(policy.exit())), control_block_hex: hex(TaprootControlBlock.encode(policy.exit()[0])), leaf_version: 192, sequence: options.exit_delay_blocks, signature_bytes: 64 },
    sequence: leaf.root.getInput(0).sequence ?? 0xffffffff, expiry: null, transactions, finalized,
    signature_verification: null, exit_viable: null, scope: 'Official Arkade native TxTree and DefaultVtxo public policy decoding. Original PSBT nodes preserved; selected path reconstructed without signing. Batch expiry and full protocol validity are not established.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = ''; for await (const chunk of process.stdin) { input += chunk; if (input.length > 2100000) { process.stdout.write('{"error":"package too large"}'); process.exit(2); } }
  try { process.stdout.write(JSON.stringify(decodeArkade(JSON.parse(input)))); }
  catch { process.stdout.write('{"error":"native Arkade package or public policy rejected"}'); process.exitCode = 2; }
}
