import { ownedWorkbenchCore, WorkbenchCoreReader } from '../workbench/workbench-core';
import { decodeMerkleProof } from './merkle-proof';
import { VerificationEvidenceError } from './verification-errors';

export const SPV_GENESIS: Record<string, string> = {
  mainnet: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
  testnet: '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943',
  testnet4: '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043',
  signet: '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',
  regtest: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
};
const hash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const scope = 'Independent partial Merkle reconstruction plus owned Bitcoin Core active-chain/header verification. This verifies txid inclusion at the observed checkpoint; it does not independently replay consensus in the browser, verify witness data, or establish current spendability.';

let activeReads = 0;

export class SpvProofReader {
  constructor(private core: WorkbenchCoreReader = ownedWorkbenchCore) {}

  private input(request: any): void {
    if (!request || typeof request !== 'object' || Array.isArray(request) || !hash(request.txid) ||
      request.block_hash !== undefined && !hash(request.block_hash) ||
      request.block_height !== undefined && !integer(request.block_height) ||
      request.tx_index !== undefined && !integer(request.tx_index)) {
      throw new VerificationEvidenceError('invalid-proof-request', 'Supply a lowercase txid and valid optional block hash, height and transaction index.', 400);
    }
    if (request.network !== undefined && request.network !== this.core.network) throw new VerificationEvidenceError('wrong-network', 'Proof network differs from the configured Bitcoin network.', 400);
  }

  private async call(method: string, params: unknown[]): Promise<any> {
    try { return await this.core.call(method, params); }
    catch { throw new VerificationEvidenceError('unavailable-bitcoin-reader', 'The owned Bitcoin reader could not complete this proof read. No verdict is available.'); }
  }

  private async checkpoint() {
    const chain = await this.call('getblockchaininfo', []);
    const expected = this.core.network === 'mainnet' ? 'main' : this.core.network === 'testnet' ? 'test' : this.core.network;
    const genesis = await this.call('getblockhash', [0]);
    if (!SPV_GENESIS[this.core.network] || chain.chain !== expected || genesis !== SPV_GENESIS[this.core.network] || !hash(chain.bestblockhash) || !integer(chain.blocks) || chain.initialblockdownload !== false) {
      throw new VerificationEvidenceError('invalid-proof-source', 'Owned node network, genesis or sync checkpoint is inconsistent. No verdict is available.');
    }
    return { network: this.core.network, chain: chain.chain, genesis_hash: genesis, block_hash: chain.bestblockhash, block_height: chain.blocks, observed_at: new Date().toISOString() };
  }

  private invalid(error: string) {
    return { is_valid: false, is_verified: false, verification_status: 'invalid', error, network: this.core.network, verification_scope: scope };
  }

  async generate(request: any) { return this.limited(() => this.generateProof(request)); }
  async verify(request: any) { return this.limited(() => this.verifyProof(request)); }

  private async limited<T>(read: () => Promise<T>): Promise<T> {
    if (activeReads >= 4) throw new VerificationEvidenceError('proof-reader-busy', 'The bounded proof reader is busy; retry.');
    activeReads++;
    try { return await read(); } finally { activeReads--; }
  }

  private async generateProof(request: any) {
    this.input(request);
    if (!hash(request.block_hash)) throw new VerificationEvidenceError('invalid-proof-request', 'A concrete block hash is required to generate this proof.', 400);
    const before = await this.checkpoint();
    let proofHex: unknown;
    try { proofHex = await this.core.call('gettxoutproof', [[request.txid], request.block_hash]); }
    catch (error) {
      if ((error as { code?: number }).code === -5) throw new VerificationEvidenceError('unavailable-proof', 'The requested transaction/block proof is unavailable to the owned node.', 503);
      throw new VerificationEvidenceError('unavailable-bitcoin-reader', 'The owned reader could not generate a proof.');
    }
    return this.verifyProof({ ...request, proof_hex: proofHex }, before);
  }

  private async verifyProof(request: any, checkpoint?: Awaited<ReturnType<SpvProofReader['checkpoint']>>) {
    this.input(request);
    let decoded: ReturnType<typeof decodeMerkleProof>;
    try { decoded = decodeMerkleProof(request.proof_hex); }
    catch (error) { return this.invalid(error instanceof Error ? error.message : 'Invalid proof bytes'); }
    const match = decoded.matches.find(item => item.txid === request.txid);
    if (!match || request.tx_index !== undefined && request.tx_index !== match.index || request.block_hash !== undefined && request.block_hash !== decoded.blockHash) return this.invalid('Requested transaction, index or block does not match the proof.');
    const metadata: Record<string, unknown> = { merkle_root: decoded.merkleRoot, flags: decoded.flags, hashes: decoded.hashes, header_hex: decoded.headerHex, transaction_count: decoded.transactionCount };
    for (const [key, value] of Object.entries(metadata)) if (request[key] !== undefined && JSON.stringify(request[key]) !== JSON.stringify(value)) return this.invalid(`Supplied ${key} differs from the proof bytes.`);
    const before = checkpoint || await this.checkpoint();
    let header: any;
    try { header = await this.core.call('getblockheader', [decoded.blockHash, true]); }
    catch { throw new VerificationEvidenceError('unavailable-proof-block', 'The proof block is unavailable to the owned node. Chain membership is unknown.'); }
    if (header?.confirmations === -1) return this.invalid('The proof block is outside the owned active chain.');
    if (header?.hash !== decoded.blockHash || header.merkleroot !== decoded.merkleRoot || !integer(header.height) || !Number.isSafeInteger(header.confirmations) || header.confirmations < 1 || header.confirmations !== before.block_height - header.height + 1 || !integer(header.nTx) || header.nTx < 1) throw new VerificationEvidenceError('invalid-proof-source', 'Owned block metadata is inconsistent with the proof/checkpoint.');
    if (header.nTx !== decoded.transactionCount) return this.invalid('Proof transaction count differs from the owned block.');
    if (request.block_height !== undefined && request.block_height !== header.height) return this.invalid('Supplied block height differs from the owned block.');
    const rawHeader = await this.call('getblockheader', [decoded.blockHash, false]);
    if (rawHeader !== decoded.headerHex) throw new VerificationEvidenceError('invalid-proof-source', 'Owned raw header differs from the proof.');
    const activeHash = await this.call('getblockhash', [header.height]);
    if (activeHash !== decoded.blockHash) return this.invalid('The proof block is outside the owned active chain.');
    const verified = await this.call('verifytxoutproof', [request.proof_hex]);
    if (!Array.isArray(verified) || verified.some(txid => !hash(txid))) throw new VerificationEvidenceError('invalid-proof-source', 'Owned proof verification returned invalid evidence.');
    if (JSON.stringify([...verified].sort()) !== JSON.stringify(decoded.matches.map(item => item.txid).sort())) return this.invalid('Owned Core and independent Merkle verification disagree.');
    const after = await this.checkpoint();
    if (after.block_hash !== before.block_hash || after.block_height !== before.block_height || after.genesis_hash !== before.genesis_hash) throw new VerificationEvidenceError('proof-source-changed', 'The active chain changed during verification; retry for a consistent checkpoint.');
    return { txid: request.txid, block_hash: decoded.blockHash, block_height: header.height, tx_index: match.index,
      ...metadata, proof_hex: String(request.proof_hex).toLowerCase(), matches: decoded.matches,
      is_valid: true, is_verified: true, verification_status: 'valid', network: this.core.network,
      confirmations: header.confirmations, nonzero_flag_padding: decoded.nonzeroPadding,
      generated_at_utc: new Date().toISOString(), source: after, verification_scope: scope };
  }
}
