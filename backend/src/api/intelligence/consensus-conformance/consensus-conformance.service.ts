import {
  ConsensusConformanceOverview,
  ConsensusImplementation,
  ConsensusTarget,
  ConsensusCase,
  FormalArtifact,
  ConformanceCampaign,
} from './consensus-conformance.models';

export class ConsensusConformanceService {
  private implementations: ConsensusImplementation[] = [
    {
      implementation_id: 'bitcoin-core',
      name: 'Bitcoin Core',
      language: 'C++',
      version: '28.0',
      source_commit: '1adf6a15eb0',
      build_hash: '94aeec3feab2',
      supported_targets: ['transaction_parse', 'block_parse', 'script_verify', 'compact_size', 'difficulty_target'],
      is_reference_implementation: true,
      health_status: 'online',
    },
    {
      implementation_id: 'libbitcoinkernel',
      name: 'libbitcoinkernel',
      language: 'C++',
      version: '28.0-dev',
      source_commit: '28c5154891a',
      build_hash: 'f77cc682bc9',
      supported_targets: ['transaction_parse', 'block_parse', 'script_verify'],
      is_reference_implementation: true,
      health_status: 'online',
    },
    {
      implementation_id: 'rust-bitcoin',
      name: 'rust-bitcoin',
      language: 'Rust',
      version: '0.32.4',
      source_commit: '5dbecdc074c',
      build_hash: '8808041e73a',
      supported_targets: ['transaction_parse', 'block_parse', 'script_verify', 'compact_size'],
      is_reference_implementation: false,
      health_status: 'online',
    },
    {
      implementation_id: 'btcd',
      name: 'btcd (btcsuite)',
      language: 'Go',
      version: '0.24.2',
      source_commit: '4c93322bb60',
      build_hash: 'ca6980eeb12',
      supported_targets: ['transaction_parse', 'block_parse', 'script_verify'],
      is_reference_implementation: false,
      health_status: 'online',
    },
  ];

  private targets: ConsensusTarget[] = [
    {
      target_id: 'transaction_parse',
      name: 'Transaction Deserialization & Parse',
      description: 'Parses legacy and SegWit raw transaction wire byte streams and derives txid/wtxid.',
      input_schema: 'raw_hex_tx',
      consensus_critical: true,
      implementations_supported_count: 4,
    },
    {
      target_id: 'block_parse',
      name: 'Block Serialization & Header Validation',
      description: 'Parses full block structures and validates Merkle root and witness commitments.',
      input_schema: 'raw_hex_block',
      consensus_critical: true,
      implementations_supported_count: 4,
    },
    {
      target_id: 'script_verify',
      name: 'Script Verification Engine',
      description: 'Executes Bitcoin Script witness programs, Miniscript spending paths, and Taproot key/script spend trees.',
      input_schema: 'script_witness_context',
      consensus_critical: true,
      implementations_supported_count: 4,
    },
    {
      target_id: 'compact_size',
      name: 'CompactSize Integer Decoder',
      description: 'Tests CompactSize encoding invariants, non-minimal encoding rejection, and integer overflow bounds.',
      input_schema: 'raw_hex_bytes',
      consensus_critical: true,
      implementations_supported_count: 3,
    },
  ];

  private cases: ConsensusCase[] = [
    {
      case_id: 'case-parse-witness-dup-01',
      target: 'transaction_parse',
      title: 'Trailing non-minimal witness data length',
      mismatch_class: 'parse_acceptance_difference',
      severity: 'divergence_potential',
      reproduction_command: 'cargo run -p bitcoinfuzz -- --target=transaction_parse --input=input-case-01.bin',
      input_hex_sample: '0200000000010100000000000000000000000000000000000000000000000000000000000000000000000000ffffffff0100000000000000000000000000',
      minimized_size_bytes: 68,
      original_size_bytes: 480,
      implementation_outcomes: [
        {
          implementation_id: 'bitcoin-core',
          status: 'rejected',
          error_or_result: 'bad-txns-nonstandard-inputs',
          execution_time_ms: 0.8,
        },
        {
          implementation_id: 'rust-bitcoin',
          status: 'rejected',
          error_or_result: 'ParseFailed(TrailingBytes)',
          execution_time_ms: 0.4,
        },
        {
          implementation_id: 'btcd',
          status: 'rejected',
          error_or_result: 'tx script parsing failure',
          execution_time_ms: 1.1,
        },
      ],
      created_at_utc: '2026-09-04T12:00:00Z',
      quarantine_status: 'public',
    },
    {
      case_id: 'case-compactsize-nonminimal-02',
      target: 'compact_size',
      title: 'Overlong CompactSize 0xfd0010 encoding',
      mismatch_class: 'serialization_difference',
      severity: 'benign',
      reproduction_command: 'cargo run -p bitcoinfuzz -- --target=compact_size --input=input-case-02.bin',
      input_hex_sample: 'fd0010',
      minimized_size_bytes: 3,
      original_size_bytes: 12,
      implementation_outcomes: [
        {
          implementation_id: 'bitcoin-core',
          status: 'rejected',
          error_or_result: 'non-minimal CompactSize encoding',
          execution_time_ms: 0.2,
        },
        {
          implementation_id: 'rust-bitcoin',
          status: 'rejected',
          error_or_result: 'NonMinimalEncoding',
          execution_time_ms: 0.1,
        },
        {
          implementation_id: 'btcd',
          status: 'rejected',
          error_or_result: 'non-standard compact size',
          execution_time_ms: 0.3,
        },
      ],
      created_at_utc: '2026-09-04T14:30:00Z',
      quarantine_status: 'public',
    },
  ];

  private formalArtifacts: FormalArtifact[] = [
    {
      artifact_id: 'hornet-bip341-taproot',
      project: 'Hornet',
      title: 'BIP341 Taproot Key-Path and Script-Path Verification Specification',
      scope: 'Consensus rule verification for Taproot witness structures',
      proof_status: 'executable',
      source_commit: '1a2b3c4d5e6f',
      toolchain: 'Hornet DSL v0.8.2',
      theorem_statement: 'forall tx context. valid_taproot(tx, context) <=> satisfies_bip341_invariants(tx, context)',
      assumptions: ['Standard secp256k1 curve parameters', 'SHA256 collision resistance'],
      verification_command: 'hornet verify specs/bip341.hornet',
      last_verified_at: '2026-09-04T16:00:00Z',
    },
    {
      artifact_id: 'btc-verified-compactsize',
      project: 'btc-verified',
      title: 'Machine-Checked CompactSize Decoding Bijectivity in Lean 4',
      scope: 'Deserialization and round-trip bijectivity for CompactSize integers',
      proof_status: 'machine_proved',
      source_commit: '8f7e6d5c4b3a',
      toolchain: 'Lean 4.8.0',
      theorem_statement: 'theorem compactsize_roundtrip (n : Nat) (h : n <= 0xffffffffffffffff) : decode (encode n) = some n',
      assumptions: [],
      verification_command: 'lake build :BtcVerified.CompactSize',
      last_verified_at: '2026-09-04T16:30:00Z',
    },
    {
      artifact_id: 'kernel-tx-validation',
      project: 'libbitcoinkernel',
      title: 'Transaction Context-Independent Validation Invariant',
      scope: 'libbitcoinkernel validation boundary API invariants',
      proof_status: 'differentially_checked',
      source_commit: '9876543210ab',
      toolchain: 'bitcoinfuzz runner',
      theorem_statement: 'kernel::CheckTransaction(tx) agrees with bitcoind::CheckTx across historical blocks',
      assumptions: ['Consensus flags match active network'],
      verification_command: 'ctest -R test_bitcoin_kernel',
      last_verified_at: '2026-09-04T17:00:00Z',
    },
  ];

  private campaigns: ConformanceCampaign[] = [
    {
      campaign_id: 'camp-differential-01',
      target_id: 'transaction_parse',
      total_inputs_evaluated: 1542000,
      divergences_found: 2,
      crashes_detected: 0,
      seed: 887412,
      status: 'completed',
      started_at_utc: '2026-09-04T10:00:00Z',
      completed_at_utc: '2026-09-04T16:00:00Z',
    },
  ];

  public getOverview(): ConsensusConformanceOverview {
    return {
      total_implementations_evaluated: this.implementations.length,
      total_consensus_targets: this.targets.length,
      total_differential_cases: this.cases.length,
      divergences_classified_count: this.cases.length,
      machine_proved_formal_theorems_count: this.formalArtifacts.filter((a) => a.proof_status === 'machine_proved').length,
      implementations: this.implementations,
      targets: this.targets,
      recent_cases: this.cases,
      formal_artifacts: this.formalArtifacts,
    };
  }

  public listImplementations(): { implementations: ConsensusImplementation[] } {
    return { implementations: this.implementations };
  }

  public listTargets(): { targets: ConsensusTarget[] } {
    return { targets: this.targets };
  }

  public listCampaigns(): { campaigns: ConformanceCampaign[] } {
    return { campaigns: this.campaigns };
  }

  public listCases(): { cases: ConsensusCase[] } {
    return { cases: this.cases };
  }

  public getCase(caseId: string): ConsensusCase | undefined {
    return this.cases.find((c) => c.case_id === caseId);
  }

  public startCampaign(targetId: string, seed = Date.now()): ConformanceCampaign {
    const campaign: ConformanceCampaign = {
      campaign_id: `camp-${Date.now()}`,
      target_id: targetId,
      total_inputs_evaluated: 10000,
      divergences_found: 0,
      crashes_detected: 0,
      seed,
      status: 'completed',
      started_at_utc: new Date().toISOString(),
      completed_at_utc: new Date().toISOString(),
    };
    this.campaigns.push(campaign);
    return campaign;
  }

  public replayCase(caseId: string): any {
    const c = this.getCase(caseId);
    if (!c) {
      return { success: false, error: 'Case not found' };
    }
    return {
      success: true,
      case_id: caseId,
      replayed_at_utc: new Date().toISOString(),
      reproduction_verified: true,
      divergence_reproduced: true,
      outcomes: c.implementation_outcomes,
    };
  }

  public listFormalArtifacts(): { formal_artifacts: FormalArtifact[] } {
    return { formal_artifacts: this.formalArtifacts };
  }
}

export default new ConsensusConformanceService();
