import { inspectWorkbenchPsbt, PsbtAnalysisResult } from './psbt-analysis';
import { address, networks, script, initEccLib } from 'bitcoinjs-lib';
import * as secp256k1 from 'tiny-secp256k1';
import { ownedWorkbenchCore, WorkbenchCoreReader } from './workbench-core';
import { compilePolicy, CompiledPolicy, CompilerError, inspectTaprootTree } from './miniscript-compiler';
import { traceScript, ScriptTrace } from './script-trace';
export { PsbtAnalysisResult } from './psbt-analysis';

initEccLib(secp256k1);

export interface ScriptAnalysisResult {
  asm: string;
  hex: string;
  script_type: string;
  is_standard: boolean | null;
  standardness_rule_violations: string[];
  consensus_valid: boolean | null;
  malleability_warnings: string[];
  max_satisfaction_weight: number | null;
  op_count: number;
  analysis_scope: string;
  source: { network: string; chain: string; block_hash: string };
}

export interface StackStep {
  step: number;
  opcode: string;
  stack_before: string[];
  stack_after: string[];
  description: string;
}

export interface DescriptorParseResult {
  descriptor: string;
  checksum: string;
  is_valid: boolean;
  script_type: string;
  is_range: boolean;
  is_multipath: boolean;
  internal_key?: string;
  taproot_leaves_count?: number;
  derived_samples: Array<{ index: number; branch?: number; address: string; script_pub_key: string }>;
  source: { network: string; chain: string; block_hash: string };
  derivation_note?: string;
  taproot_trees?: any[];
  taproot_tree_status?: 'verified-commitments' | 'unavailable';
  taproot_tree_note?: string;
}

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class WorkbenchEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

/**
 * Script, descriptor, Miniscript and PSBT workbench.
 *
 * Every answer here used to be invented: any script was consensus-valid, the
 * stack simulation always ran one OP_CHECKSIG that succeeded, every policy
 * compiled to the same Miniscript, descriptors derived random addresses under
 * a constant internal key, and every PSBT had the same txid and fee. None of
 * that computed anything from the caller's input, so each read reports the
 * engine it would need.
 */
export class WorkbenchService {
  private static instance: WorkbenchService;

  public constructor(private readonly core: WorkbenchCoreReader = ownedWorkbenchCore) {}

  private async source(): Promise<{ network: string; chain: string; block_hash: string }> {
    const expected = { mainnet: 'main', testnet: 'test', testnet4: 'testnet4', signet: 'signet', regtest: 'regtest' }[this.core.network];
    if (!expected) throw new WorkbenchEvidenceError('unsupported-network', 'No Bitcoin source is configured for this network.');
    const info = await this.rpc('getblockchaininfo', []);
    if (info?.chain !== expected) throw new WorkbenchEvidenceError('wrong-network', 'The owned Bitcoin Core chain does not match the configured network.');
    if (typeof info.bestblockhash !== 'string' || !/^[0-9a-f]{64}$/i.test(info.bestblockhash)) throw new WorkbenchEvidenceError('invalid-source', 'The owned Bitcoin Core returned no valid checkpoint.');
    return { network: this.core.network, chain: info.chain, block_hash: info.bestblockhash };
  }

  private async rpc(method: string, params: unknown[]): Promise<any> {
    try { return await this.core.call(method, params); }
    catch (error) {
      if ([-5, -8, -22, -32602].includes((error as { code?: number }).code!)) throw new WorkbenchEvidenceError('invalid-input', 'Bitcoin Core rejected the supplied script or descriptor.', 400);
      throw new WorkbenchEvidenceError('unavailable-bitcoin-reader', 'The owned Bitcoin Core did not complete the requested read.');
    }
  }

  public static getInstance(): WorkbenchService {
    if (!WorkbenchService.instance) {
      WorkbenchService.instance = new WorkbenchService();
    }
    return WorkbenchService.instance;
  }

  public async analyzeScript(scriptHex: string): Promise<ScriptAnalysisResult> {
    if (typeof scriptHex !== 'string' || scriptHex.length > 20000 || !/^(?:[0-9a-f]{2})*$/i.test(scriptHex)) throw new WorkbenchEvidenceError('invalid-script', 'Script must be even-length hexadecimal of at most 10000 bytes.', 400);
    const chunks = script.decompile(Buffer.from(scriptHex, 'hex'));
    if (!chunks) throw new WorkbenchEvidenceError('invalid-script', 'Script contains a truncated data push.', 400);
    const source = await this.source();
    const decoded = await this.rpc('decodescript', [scriptHex]);
    if (typeof decoded?.asm !== 'string' || typeof decoded?.type !== 'string') throw new WorkbenchEvidenceError('invalid-source', 'Bitcoin Core returned an invalid script decode.');
    return { asm: decoded.asm, hex: scriptHex.toLowerCase(), script_type: decoded.type,
      is_standard: null, consensus_valid: null, standardness_rule_violations: [],
      malleability_warnings: ['Disassembly does not execute a spending transaction; standardness, consensus validity and malleability were not evaluated.'],
      max_satisfaction_weight: null, op_count: chunks.filter(chunk => typeof chunk === 'number' && chunk > 0x60).length,
      analysis_scope: 'Bitcoin Core script disassembly and output-template classification only.', source };
  }

  public async simulateStack(scriptHex: string, witnessHexes: string[] = []): Promise<ScriptTrace> {
    try { return await traceScript(scriptHex, witnessHexes); }
    catch (error) {
      if (error instanceof CompilerError) throw new WorkbenchEvidenceError(error.code, error.message, error.status);
      throw error;
    }
  }

  public async compileMiniscript(policy: string): Promise<CompiledPolicy> {
    try { return await compilePolicy(policy); }
    catch (error) {
      if (error instanceof CompilerError) throw new WorkbenchEvidenceError(error.code, error.message, error.status);
      throw error;
    }
  }

  public async parseDescriptor(descriptorStr: string, range: [number, number] = [0, 4], requireAddresses = false): Promise<DescriptorParseResult> {
    if (typeof descriptorStr !== 'string' || !descriptorStr.trim() || descriptorStr.length > 16384) throw new WorkbenchEvidenceError('invalid-descriptor', 'A public descriptor of at most 16384 characters is required.', 400);
    // Never forward extended private keys or WIF keys to the node.
    if (/(?:[xtyzuvYZUV]prv[1-9A-HJ-NP-Za-km-z]+|(?:^|[(,])(?:5[1-9A-HJ-NP-Za-km-z]{50}|[KL9c][1-9A-HJ-NP-Za-km-z]{51})(?=[),/]))/.test(descriptorStr)) throw new WorkbenchEvidenceError('private-key-forbidden', 'Use a public descriptor; private keys must remain in your wallet.', 400);
    if (!Array.isArray(range) || range.length !== 2 || !range.every(value => Number.isSafeInteger(value) && value >= 0 && value <= 0x7fffffff) || range[1] < range[0] || range[1] - range[0] > 99) throw new WorkbenchEvidenceError('invalid-range', 'Derivation range must contain at most 100 nonnegative child indexes.', 400);
    const source = await this.source();
    const info = await this.rpc('getdescriptorinfo', [descriptorStr]);
    if (info.hasprivatekeys) throw new WorkbenchEvidenceError('private-key-forbidden', 'Use a public descriptor; private keys must remain in your wallet.', 400);
    if (typeof info.descriptor !== 'string' || typeof info.checksum !== 'string' || typeof info.isrange !== 'boolean') throw new WorkbenchEvidenceError('invalid-source', 'Bitcoin Core returned invalid descriptor metadata.');
    const expansion: string[] = info.multipath_expansion ?? [info.descriptor];
    if (!Array.isArray(expansion) || expansion.length > 10 || !expansion.every(value => typeof value === 'string')) throw new WorkbenchEvidenceError('invalid-source', 'Descriptor expansion exceeds the bounded supported shape.');
    const types = { pk: 'p2pk', pkh: 'p2pkh', sh: 'p2sh', wpkh: 'p2wpkh', wsh: 'p2wsh', tr: 'p2tr', multi: 'multisig', sortedmulti: 'multisig' };
    const outer = /^([a-z0-9_]+)\(/i.exec(info.descriptor)?.[1] ?? 'unknown';
    const result: DescriptorParseResult = { descriptor: info.descriptor, checksum: info.checksum, is_valid: true,
      script_type: types[outer] ?? outer, is_range: info.isrange, is_multipath: expansion.length > 1, derived_samples: [], source };
    if (['pk', 'multi', 'sortedmulti', 'raw'].includes(outer)) {
      if (requireAddresses) throw new WorkbenchEvidenceError('no-address', 'This descriptor has no standard address representation.', 400);
      result.derivation_note = 'Valid descriptor without a standard address representation.';
      return result;
    }
    const network = this.core.network === 'mainnet' ? networks.bitcoin : this.core.network === 'regtest' ? networks.regtest : networks.testnet;
    for (let branch = 0; branch < expansion.length; branch++) {
      const derived = await this.rpc('deriveaddresses', info.isrange ? [expansion[branch], range] : [expansion[branch]]);
      if (!Array.isArray(derived) || derived.length > 100 || !derived.every(value => typeof value === 'string')) throw new WorkbenchEvidenceError('invalid-source', 'Bitcoin Core returned an invalid address derivation.');
      for (let i = 0; i < derived.length; i++) {
        let output: Buffer;
        try { output = address.toOutputScript(derived[i], network); }
        catch { throw new WorkbenchEvidenceError('wrong-network', 'Bitcoin Core derived an address outside the configured network.'); }
        result.derived_samples.push({ index: info.isrange ? range[0] + i : 0, ...(expansion.length > 1 ? { branch } : {}), address: derived[i], script_pub_key: output.toString('hex') });
      }
    }
    if (outer === 'tr') {
      result.taproot_trees = [];
      for (let branch = 0; branch < expansion.length; branch++) {
        const sample = result.derived_samples.find(value => (value.branch ?? 0) === branch);
        if (!sample) continue;
        try {
          const tree = await inspectTaprootTree(expansion[branch], sample.index);
          if (tree.script_pub_key !== sample.script_pub_key) throw new WorkbenchEvidenceError('source-disagreement', 'The native Taproot commitment does not match the Core-derived output.');
          result.taproot_trees.push({ ...tree, branch, index: sample.index });
        } catch (error) {
          if (error instanceof WorkbenchEvidenceError) throw error;
          result.taproot_tree_status = 'unavailable';
          result.taproot_tree_note = 'Address derivation succeeded, but the separate pinned tree engine could not inspect all branches. No tree verification is claimed for omitted branches.';
        }
      }
      if (result.taproot_trees.length === expansion.length) result.taproot_tree_status = 'verified-commitments';
    }
    return result;
  }

  public analyzePsbt(psbtBase64OrHex: string): PsbtAnalysisResult {
    try {
      return inspectWorkbenchPsbt(psbtBase64OrHex);
    } catch {
      throw new WorkbenchEvidenceError('invalid-psbt', 'The PSBT is malformed, unsupported, oversized, or contains inconsistent transaction metadata.', 400);
    }
  }
}

export const workbenchService = WorkbenchService.getInstance();
