import { createHash } from 'crypto';
import { LiquidObservatoryEvidenceError as EvidenceError } from './liquid-evidence-error';
import { LiquidNativeReader, LiquidPairObservation } from './liquid-paired-source';

const HASH = /^[0-9a-f]{64}$/;
const HEX = /^(?:[0-9a-f]{2})*$/;
const invalid = (): never => { throw new EvidenceError('invalid-liquid-projection', 'The native Liquid public block evidence is malformed.'); };
const digest = (bytes: Buffer): Buffer => createHash('sha256').update(createHash('sha256').update(bytes).digest()).digest();

/** Native RPC monetary decimals have eight places; no floating-point multiplication. */
export function liquidAtomic(value: unknown): string {
  if (typeof value !== 'number' && typeof value !== 'string' || typeof value === 'number' && !Number.isFinite(value)) return invalid();
  const text = String(value);
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) return invalid();
  const exponent = Number(match[3] || 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 20) return invalid();
  const fraction = match[2] || '';
  const scale = 8 + exponent - fraction.length;
  if (scale < 0 || match[1].length + fraction.length + scale > 30) return invalid();
  return BigInt(match[1] + fraction + '0'.repeat(scale)).toString();
}

export interface LiquidPublicIssuance {
  txid: string; vin: number; asset: string; entropy: string; token: string | null;
  isReissuance: boolean; assetAmountAtomic: string | null; tokenAmountAtomic: string | null;
  assetAmountCommitment: string | null; tokenAmountCommitment: string | null;
}
export interface LiquidPublicPegInput {
  txid: string; vin: number; parentTxid: string; parentVout: number; amountAtomic: string;
  asset: string; parentGenesis: string; claimScript: string; parentTransaction: string;
  parentProof: string; parentBlockHash: string;
}
/** Native decoded public request; confirmation does not prove a federation parent payout. */
export interface LiquidPublicPegOutput {
  txid: string; vout: number; parentGenesis: string; parentScript: string;
  parentAddress: string | null; asset: string; amountAtomic: string;
}
export interface LiquidPublicBlock {
  height: number; hash: string; previousHash: string | null; time: number;
  parameterRoot: string | null; parameterType: 'full' | 'compact' | null;
  signblockScript: string; fedpegScript: string | null; fedpegProgram: string | null;
  blockWitnessBytes: number; issuances: LiquidPublicIssuance[]; pegInputs: LiquidPublicPegInput[];
  pegOutputs: LiquidPublicPegOutput[];
  confidentialOutputs: number; explicitOutputs: number;
}
export interface LiquidVerifiedPegInput {
  txid: string; vin: number; parentTxid: string; parentVout: number; amountAtomic: string;
  parentBlockHash: string; parentBlockHeight: number; parentConfirmations: number;
  parentOutputScript: string; parentProofSha256: string; claimScript: string;
}

/** Accepted Elements claim plus an independent native parent inclusion/outpoint proof. @asyncUnsafe */
export async function verifyLiquidPegInput(input: LiquidPublicPegInput, observation: LiquidPairObservation,
  parent: LiquidNativeReader, signal: AbortSignal): Promise<LiquidVerifiedPegInput> {
  const active = (): void => { if (signal.aborted) throw new EvidenceError('liquid-source-deadline', 'The public parent proof read was cancelled.', 504); };
  active();
  if (input.parentGenesis !== observation.parent.genesis || input.asset !== observation.profile.policyAsset) return invalid();
  const [accepted, transaction, header] = await Promise.all([
    parent.call('verifytxoutproof', [input.parentProof], signal),
    parent.call('decoderawtransaction', [input.parentTransaction], signal),
    parent.call('getblockheader', [input.parentBlockHash, true], signal),
  ]);
  active();
  if (!Array.isArray(accepted) || accepted.length !== 1 || accepted[0] !== input.parentTxid
    || transaction?.txid !== input.parentTxid || !Array.isArray(transaction.vout)
    || header?.hash !== input.parentBlockHash || !Number.isSafeInteger(header.height) || header.height < 0
    || header.height > observation.parent.height) return invalid();
  const output = transaction.vout.find(value => value.n === input.parentVout);
  if (!output || liquidAtomic(output.value) !== input.amountAtomic || typeof output.scriptPubKey?.hex !== 'string'
    || !HEX.test(output.scriptPubKey.hex) || output.scriptPubKey.hex.length === 0) return invalid();
  const confirmations = observation.parent.height - header.height + 1;
  if (confirmations < observation.profile.peginConfirmationDepth) return invalid();
  const canonical = await parent.call('getblockhash', [header.height], signal);
  active();
  if (canonical !== input.parentBlockHash) throw new EvidenceError('liquid-parent-proof-reorg', 'The peg deposit proof is no longer canonical.', 409);
  return { txid: input.txid, vin: input.vin, parentTxid: input.parentTxid, parentVout: input.parentVout,
    amountAtomic: input.amountAtomic, parentBlockHash: input.parentBlockHash, parentBlockHeight: header.height,
    parentConfirmations: confirmations, parentOutputScript: output.scriptPubKey.hex, claimScript: input.claimScript,
    parentProofSha256: createHash('sha256').update(Buffer.from(input.parentProof, 'hex')).digest('hex') };
}

function commitment(value: unknown, prefix: string): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !new RegExp('^0[' + prefix + '][0-9a-f]{64}$').test(value)) return invalid();
  return value;
}

/** Only public consensus observations are normalized; opaque output amounts remain unknown. */
export function projectLiquidPublicBlock(header: any, block: any): LiquidPublicBlock {
  if (!Number.isSafeInteger(header?.height) || header.height < 0 || !HASH.test(header.hash)
    || block?.hash !== header.hash || block.height !== header.height || !Number.isSafeInteger(block.time)
    || !Array.isArray(block.tx) || block.tx.length > 100000
    || header.height > 0 && !HASH.test(header.previousblockhash)) return invalid();
  const current = header.dynamic_parameters?.current;
  const root = current?.root ?? null;
  if (current && (!HASH.test(root) || !['full', 'compact'].includes(current.type))) return invalid();
  const signblock = current?.signblockscript ?? header.signblock_challenge;
  if (typeof signblock !== 'string' || !HEX.test(signblock)) return invalid();
  const fedpegScript = current?.fedpegscript ?? null, fedpegProgram = current?.fedpeg_program ?? null;
  if (current?.type === 'full' && (typeof fedpegScript !== 'string' || !HEX.test(fedpegScript)
    || typeof fedpegProgram !== 'string' || !HEX.test(fedpegProgram))) return invalid();
  const witness = header.signblock_witness_hex ?? '';
  const witnessItems = typeof witness === 'string' ? [witness] : witness;
  if (!Array.isArray(witnessItems) || witnessItems.length > 10000
    || witnessItems.some(item => typeof item !== 'string' || !HEX.test(item))) return invalid();
  const result: LiquidPublicBlock = { height: header.height, hash: header.hash,
    previousHash: header.height === 0 ? null : header.previousblockhash, time: block.time,
    parameterRoot: root, parameterType: current?.type ?? null, signblockScript: signblock,
    fedpegScript, fedpegProgram, blockWitnessBytes: witnessItems.reduce((bytes, item) => bytes + item.length / 2, 0),
    issuances: [], pegInputs: [], pegOutputs: [], confidentialOutputs: 0, explicitOutputs: 0 };
  for (const transaction of block.tx) {
    if (!HASH.test(transaction?.txid) || !Array.isArray(transaction.vin) || !Array.isArray(transaction.vout)) return invalid();
    for (const [vin, input] of transaction.vin.entries()) {
      const issuance = input.issuance;
      if (issuance) {
        if (!HASH.test(issuance.asset) || !HASH.test(issuance.assetEntropy) || typeof issuance.isreissuance !== 'boolean'
          || issuance.token !== undefined && !HASH.test(issuance.token)) return invalid();
        const assetCommitment = commitment(issuance.assetamountcommitment, '89');
        const tokenCommitment = commitment(issuance.tokenamountcommitment, '89');
        if (assetCommitment && issuance.assetamount !== undefined || tokenCommitment && issuance.tokenamount !== undefined) return invalid();
        result.issuances.push({ txid: transaction.txid, vin, asset: issuance.asset, entropy: issuance.assetEntropy,
          token: issuance.token ?? null, isReissuance: issuance.isreissuance,
          assetAmountAtomic: issuance.assetamount === undefined ? null : liquidAtomic(issuance.assetamount),
          tokenAmountAtomic: issuance.tokenamount === undefined ? null : liquidAtomic(issuance.tokenamount),
          assetAmountCommitment: assetCommitment, tokenAmountCommitment: tokenCommitment });
      }
      if (input.is_pegin === true) {
        const values = input.pegin_witness;
        if (!Array.isArray(values) || values.length !== 6 || values.some(v => typeof v !== 'string' || !HEX.test(v))
          || values[0].length !== 16 || values[1].length !== 64 || values[2].length !== 64
          || values[5].length < 160 || !HASH.test(input.txid) || !Number.isSafeInteger(input.vout) || input.vout < 0) return invalid();
        result.pegInputs.push({ txid: transaction.txid, vin, parentTxid: input.txid, parentVout: input.vout,
          amountAtomic: Buffer.from(values[0], 'hex').readBigUInt64LE().toString(),
          asset: Buffer.from(values[1], 'hex').reverse().toString('hex'),
          parentGenesis: Buffer.from(values[2], 'hex').reverse().toString('hex'), claimScript: values[3],
          parentTransaction: values[4], parentProof: values[5],
          parentBlockHash: digest(Buffer.from(values[5].slice(0, 160), 'hex')).reverse().toString('hex') });
      }
    }
    for (const output of transaction.vout) {
      const valueCommitment = commitment(output.valuecommitment, '89');
      const assetCommitment = commitment(output.assetcommitment, 'ab');
      if (valueCommitment && output.value !== undefined || assetCommitment && output.asset !== undefined) return invalid();
      if (valueCommitment || assetCommitment) result.confidentialOutputs++;
      else { if (!HASH.test(output.asset)) return invalid(); liquidAtomic(output.value); result.explicitOutputs++; }
      // Elements 23.3.4 getrawtransaction/getblock decoder publishes these exact fields.
      // Keep the decoded destination as a request observation, not a payout identity.
      const destination = output.scriptPubKey;
      if (destination?.pegout_chain !== undefined) {
        if (!HASH.test(destination.pegout_chain) || typeof destination.pegout_hex !== 'string'
          || !HEX.test(destination.pegout_hex) || !destination.pegout_hex.length || destination.pegout_hex.length > 20000
          || !Number.isSafeInteger(output.n) || output.n < 0 || valueCommitment || assetCommitment
          || !HASH.test(output.asset) || destination.pegout_address !== undefined
          && (typeof destination.pegout_address !== 'string' || destination.pegout_address.length > 128)) return invalid();
        result.pegOutputs.push({ txid: transaction.txid, vout: output.n, parentGenesis: destination.pegout_chain,
          parentScript: destination.pegout_hex, parentAddress: destination.pegout_address ?? null,
          asset: output.asset, amountAtomic: liquidAtomic(output.value) });
      }
    }
  }
  return result;
}
