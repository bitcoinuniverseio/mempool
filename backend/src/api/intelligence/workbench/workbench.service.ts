export interface ScriptAnalysisResult {
  asm: string;
  hex: string;
  script_type: string;
  is_standard: boolean;
  standardness_rule_violations: string[];
  consensus_valid: boolean;
  malleability_warnings: string[];
  max_satisfaction_weight: number;
  op_count: number;
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
  script_type: 'p2pk' | 'p2pkh' | 'p2sh' | 'p2wpkh' | 'p2wsh' | 'p2tr' | 'multisig';
  is_range: boolean;
  is_multipath: boolean;
  internal_key?: string;
  taproot_leaves_count?: number;
  derived_samples: Array<{ index: number; address: string; script_pub_key: string }>;
}

export interface PsbtAnalysisResult {
  version: 0 | 2;
  txid: string;
  input_count: number;
  output_count: number;
  total_fee_sats: number;
  feerate_sats_vb: number;
  inputs_status: Array<{
    index: number;
    has_utxo: boolean;
    required_sigs: number;
    present_sigs: number;
    is_finalized: boolean;
    missing_signers: string[];
  }>;
  is_complete: boolean;
  warnings: string[];
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

const scriptEngineUnavailable =
  'Script analysis is unavailable. Disassembly, standardness, stack execution and Miniscript compilation require the owned script engine (bitcoind decodescript and the owned Miniscript compiler, UNIVERSE_SCRIPT_ENGINE_ORIGIN), which is not connected on this deployment.';

const descriptorWalletUnavailable =
  'Descriptor parsing is unavailable. Checksums, script types and derived addresses require the owned descriptor wallet (bitcoind getdescriptorinfo and deriveaddresses), which is not connected on this deployment.';

const psbtDecoderUnavailable =
  'PSBT analysis is unavailable. Input status, fees and completion require the owned PSBT decoder (bitcoind decodepsbt and analyzepsbt) with its UTXO reader, which is not connected on this deployment.';

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

  private constructor() {}

  public static getInstance(): WorkbenchService {
    if (!WorkbenchService.instance) {
      WorkbenchService.instance = new WorkbenchService();
    }
    return WorkbenchService.instance;
  }

  public analyzeScript(scriptHex: string): ScriptAnalysisResult {
    void scriptHex;
    throw new WorkbenchEvidenceError('unavailable-script-engine', scriptEngineUnavailable);
  }

  public simulateStack(scriptHex: string, witnessHexes: string[] = []): StackStep[] {
    void scriptHex; void witnessHexes;
    throw new WorkbenchEvidenceError('unavailable-script-engine', scriptEngineUnavailable);
  }

  public compileMiniscript(policy: string): {
    miniscript: string;
    max_witness_size: number;
    worst_case_satisfaction_weight: number;
    properties: { non_malleable: boolean; timelock_safe: boolean };
  } {
    void policy;
    throw new WorkbenchEvidenceError('unavailable-script-engine', scriptEngineUnavailable);
  }

  public parseDescriptor(descriptorStr: string): DescriptorParseResult {
    void descriptorStr;
    throw new WorkbenchEvidenceError('unavailable-descriptor-wallet', descriptorWalletUnavailable);
  }

  public analyzePsbt(psbtBase64OrHex: string): PsbtAnalysisResult {
    void psbtBase64OrHex;
    throw new WorkbenchEvidenceError('unavailable-psbt-decoder', psbtDecoderUnavailable);
  }
}

export const workbenchService = WorkbenchService.getInstance();
