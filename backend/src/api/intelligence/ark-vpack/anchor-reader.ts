import { WorkbenchCoreReader, ownedWorkbenchCore } from '../workbench/workbench-core';
import { WorkbenchService } from '../workbench/workbench.service';

export class AnchorReadError extends Error {
  constructor(public code: string, message: string, public status = 503) { super(message); }
}

/** Fresh public outpoint evidence. An output alone cannot prove an Ark protocol commitment. */
export class AnchorReader {
  constructor(private core: WorkbenchCoreReader = ownedWorkbenchCore) {}

  async verify(outpoint: string, descriptor?: string) {
    const match = typeof outpoint === 'string' && /^([0-9a-f]{64}):(0|[1-9][0-9]{0,9})$/i.exec(outpoint);
    if (!match || Number(match[2]) > 0xffffffff) throw new AnchorReadError('invalid-outpoint', 'Use a 64-character transaction ID and an unsigned output index separated by a colon.', 400);
    const txid = match[1].toLowerCase(), index = Number(match[2]);
    const expectedChain = { mainnet: 'main', testnet: 'test', testnet4: 'testnet4', signet: 'signet', regtest: 'regtest' }[this.core.network];
    const before = await this.call('getblockchaininfo', []);
    if (!expectedChain || before.chain !== expectedChain) throw new AnchorReadError('wrong-network', 'The owned Bitcoin source does not match the configured network.');
    if (!/^[0-9a-f]{64}$/.test(before.bestblockhash) || !Number.isSafeInteger(before.blocks)) throw new AnchorReadError('invalid-source', 'Bitcoin Core returned an invalid checkpoint.');
    let tx: any = null;
    try { tx = await this.core.call('getrawtransaction', [txid, true]); }
    catch (error) { if ((error as { code?: number }).code !== -5) throw new AnchorReadError('unavailable-source', 'Bitcoin Core could not read the anchor transaction.'); }
    if (tx && (tx.txid !== txid || !Array.isArray(tx.vout))) throw new AnchorReadError('invalid-source', 'Bitcoin Core returned inconsistent transaction data.');
    const utxo = await this.call('gettxout', [txid, index, true]);
    const output = tx?.vout.find((item: any) => item.n === index);
    if (utxo && (utxo.bestblock !== before.bestblockhash || !utxo.scriptPubKey || !Number.isSafeInteger(utxo.confirmations))) throw new AnchorReadError('source-changed', 'The UTXO checkpoint changed; retry the verification.');
    if (utxo && output && utxo.scriptPubKey.hex !== output.scriptPubKey?.hex) throw new AnchorReadError('invalid-source', 'Transaction and UTXO scripts disagree.');
    const scriptHex = utxo?.scriptPubKey?.hex ?? output?.scriptPubKey?.hex ?? null;
    let commitment: boolean | null = null;
    let descriptorEvidence: any = null;
    if (descriptor !== undefined) {
      if (typeof descriptor !== 'string' || !descriptor.trim()) throw new AnchorReadError('invalid-descriptor', 'Expected descriptor must be a public descriptor.', 400);
      descriptorEvidence = await new WorkbenchService(this.core).parseDescriptor(descriptor);
      if (descriptorEvidence.is_range || descriptorEvidence.is_multipath) throw new AnchorReadError('ambiguous-descriptor', 'Use a concrete single-output public descriptor.', 400);
      if (descriptorEvidence.derived_samples.length !== 1) throw new AnchorReadError('unsupported-descriptor', 'The descriptor must derive one standard output script.', 400);
      commitment = scriptHex === null ? null : scriptHex === descriptorEvidence.derived_samples[0].script_pub_key;
    }
    const after = await this.call('getblockchaininfo', []);
    if (after.chain !== before.chain || after.bestblockhash !== before.bestblockhash) throw new AnchorReadError('source-changed', 'The chain checkpoint changed; retry the verification.');
    const confirmations = utxo?.confirmations ?? (tx && Number.isSafeInteger(tx.confirmations) ? Math.max(0, tx.confirmations) : null);
    const known = !!(utxo || output);
    const status = utxo ? 'unspent' : output ? 'spent' : tx ? 'invalid-output' : 'unknown';
    return {
      anchor_outpoint: `${txid}:${index}`, exists_onchain: known && confirmations !== null ? confirmations > 0 : tx ? false : null,
      confirmations, block_height: confirmations && confirmations > 0 ? before.blocks - confirmations + 1 : null,
      spend_status: status, script_pub_key: scriptHex, amount_sats: known ? Math.round((utxo?.value ?? output.value) * 1e8) : null,
      outpoint_verified: known, commitment_matches: commitment, verified: known && commitment === true,
      protocol_verified: null, exit_delay_blocks: null,
      verification_scope: 'Owned Core transaction/output existence and current UTXO view, including mempool spends. Optional descriptor equality verifies only the supplied output commitment; Ark round membership and exit conditions require the full protocol proof.',
      descriptor_evidence: descriptorEvidence,
      source: { network: this.core.network, chain: before.chain, block_hash: before.bestblockhash, block_height: before.blocks, observed_at: new Date().toISOString() },
      errors: status === 'unknown' ? ['Transaction is unavailable to the owned source; absence is not proven.'] : status === 'invalid-output' ? ['The transaction has no such output.'] : commitment === false ? ['The supplied descriptor does not match the anchor output.'] : [],
    };
  }

  private async call(method: string, params: unknown[]): Promise<any> {
    try { return await this.core.call(method, params); }
    catch { throw new AnchorReadError('unavailable-source', 'The owned Bitcoin Core could not complete the requested read.'); }
  }
}
