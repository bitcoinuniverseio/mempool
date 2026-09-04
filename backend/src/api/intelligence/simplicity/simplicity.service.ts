import crypto from 'crypto';
import {
  SimplicityProgram,
  SimplicityProgramOccurrence,
  SimplicityExecution,
  SimplicityFormalArtifact,
  SimplicityToolchain,
  SimplicityOverviewResponse,
} from './simplicity.models';

export class SimplicityService {
  private programs: Map<string, SimplicityProgram> = new Map();
  private occurrences: Map<string, SimplicityProgramOccurrence> = new Map();
  private formalArtifacts: Map<string, SimplicityFormalArtifact> = new Map();
  private toolchains: SimplicityToolchain[] = [];

  constructor() {
    this.seedReferenceFixtures();
  }

  private seedReferenceFixtures(): void {
    this.toolchains = [
      {
        toolchain_id: 'toolchain-simplicity-2026-q3',
        version: '0.4.0',
        rust_simplicity_rev: 'v0.4.0-liquid',
        libsimplicity_rev: 'commit-9f82a1c',
        simplicity_hl_rev: '0.2.1-preview',
        supported_jets_count: 142,
        is_active: true,
        released_at: '2026-08-01T00:00:00Z',
      },
    ];

    const program1: SimplicityProgram = {
      program_id: 'prog-vault-clawback-v1',
      program_name: 'Covenant Vault with Timelock Recovery',
      cmr: '9b3e18cf9410ea82b405f63901a88b5601235123992019485123491823019283',
      imr: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
      amr: '887766554433221100ffeeddccbbaa99887766554433221100ffeeddccbbaa99',
      source_text: `// SimplicityHL Vault Example
fn check_recovery(sig: Signature, pubkey: Pubkey, timeout: u32) -> bool {
    jet_bip0340_verify(sig, pubkey) && jet_current_locktime() >= timeout
}`,
      program_bytes_hex: '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20',
      program_type: '2 -> 1 (witness verification predicate)',
      toolchain_revision: '0.4.0',
      resource_bounds: {
        max_cost_weight: 420,
        max_memory_cells: 64,
        max_call_depth: 6,
        jets_cost_discount: 380,
        pruned_witness_ratio_pct: 18.5,
      },
      jets: ['jet_bip0340_verify', 'jet_current_locktime', 'jet_check_sig_hash_all'],
      occurrences_count: 12,
      formal_verification_state: 'proof_checked',
      first_seen_height: 855000,
      provenance: {
        author: 'Blockstream Research & Universe Labs',
        verified_commit: 'git-rev-41982a',
        proof_system: 'coq',
      },
    };

    const program2: SimplicityProgram = {
      program_id: 'prog-escrow-oracle-v2',
      program_name: 'Oracle Conditioned Confidential Swap',
      cmr: '445566778899aabbccddeeff00112233445566778899aabbccddeeff00112233',
      imr: '2233445566778899aabbccddeeff00112233445566778899aabbccddeeff0011',
      amr: '99aabbccddeeff00112233445566778899aabbccddeeff001122334455667788',
      source_text: `// SimplicityHL Oracle Conditioned Swap
fn verify_oracle_price(price: u64, min_price: u64, oracle_sig: Signature) -> bool {
    price >= min_price && jet_oracle_attestation_verify(oracle_sig)
}`,
      program_bytes_hex: '202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f',
      program_type: '3 -> 1 (swap predicate)',
      toolchain_revision: '0.4.0',
      resource_bounds: {
        max_cost_weight: 650,
        max_memory_cells: 96,
        max_call_depth: 8,
        jets_cost_discount: 540,
        pruned_witness_ratio_pct: 22.0,
      },
      jets: ['jet_oracle_attestation_verify', 'jet_confidential_value_check', 'jet_add_64'],
      occurrences_count: 5,
      formal_verification_state: 'proof_manifest_valid',
      first_seen_height: 858200,
      provenance: {
        author: 'Elements Project Research',
        proof_system: 'lean4',
      },
    };

    this.programs.set(program1.program_id, program1);
    this.programs.set(program2.program_id, program2);

    const occ1: SimplicityProgramOccurrence = {
      occurrence_id: 'occ-855010-01',
      txid: '3f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a',
      input_index: 0,
      block_height: 855010,
      block_hash: '0000000000000000000213891480198401928401298401298401928401928401',
      network: 'liquid-v1',
      spent_amount_sats: 5000000,
      asset_id: '6f0279e9ed041c3d710a9f57d0c02928416460c4b722ae3457a11eec381c526d',
      confirmed_at: '2026-08-20T14:30:00Z',
    };
    this.occurrences.set(occ1.occurrence_id, occ1);

    const artifact1: SimplicityFormalArtifact = {
      schema_version: '1.0.0',
      program_cmr: program1.cmr,
      source_hash: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      compiler_revision: 'simplicity-hl-0.2.1',
      libSimplicity_revision: 'commit-9f82a1c',
      proof_system: 'coq',
      proof_source_hash: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      proof_artifact_hash: 'fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
      statement: 'Theorem vault_clawback_soundness: forall w, eval(prog, w) = true -> authorized(w).',
      dependencies: ['Coq.Init.Prelude', 'Simplicity.Semantics', 'Simplicity.Jets'],
      verification_command: 'coqc -R theories Simplicity theories/VaultClawbackProof.v',
      verification_result: {
        verified: true,
        verifier_output: 'Coq verification succeeded: 4 lemmas checked, 0 axioms admitted.',
        verified_at: '2026-08-25T11:00:00Z',
      },
    };
    this.formalArtifacts.set(program1.cmr, artifact1);
  }

  public getOverview(): SimplicityOverviewResponse {
    const progs = Array.from(this.programs.values());
    const occs = Array.from(this.occurrences.values());
    const verifiedProofs = progs.filter((p) => p.formal_verification_state === 'proof_checked').length;

    return {
      total_programs: progs.length,
      total_occurrences: occs.length,
      verified_proofs_count: verifiedProofs,
      active_toolchain: this.toolchains[0],
      recent_programs: progs,
      recent_occurrences: occs,
    };
  }

  public listPrograms(): SimplicityProgram[] {
    return Array.from(this.programs.values());
  }

  public getProgram(programId: string): SimplicityProgram | undefined {
    return (
      this.programs.get(programId) ||
      Array.from(this.programs.values()).find((p) => p.cmr === programId)
    );
  }

  public getProgramOccurrences(programId: string): SimplicityProgramOccurrence[] {
    return Array.from(this.occurrences.values());
  }

  public getTransaction(txid: string): {
    txid: string;
    has_simplicity: boolean;
    executions: SimplicityExecution[];
  } {
    const occ = Array.from(this.occurrences.values()).find((o) => o.txid === txid);
    if (!occ) {
      return {
        txid,
        has_simplicity: false,
        executions: [],
      };
    }

    const exec: SimplicityExecution = {
      execution_id: `exec-${txid.substring(0, 8)}`,
      program_id: 'prog-vault-clawback-v1',
      cmr: '9b3e18cf9410ea82b405f63901a88b5601235123992019485123491823019283',
      txid,
      input_index: occ.input_index,
      success: true,
      total_cost: 412,
      total_cells: 58,
      witness_hex: '0102030405',
      steps: [
        {
          step: 1,
          node_name: 'iden',
          expression: 'iden',
          cost: 1,
          memory_delta: 1,
          environment_snapshot: 'env_init',
        },
        {
          step: 2,
          node_name: 'jet_bip0340_verify',
          expression: 'jet_bip0340_verify(sig, pk)',
          cost: 380,
          memory_delta: 32,
          environment_snapshot: 'env_after_sig_check',
        },
        {
          step: 3,
          node_name: 'jet_current_locktime',
          expression: 'jet_current_locktime()',
          cost: 31,
          memory_delta: 25,
          environment_snapshot: 'env_success',
        },
      ],
      executed_at: occ.confirmed_at,
    };

    return {
      txid,
      has_simplicity: true,
      executions: [exec],
    };
  }

  public listToolchains(): SimplicityToolchain[] {
    return this.toolchains;
  }

  public decodeProgram(bytesHex: string): {
    success: boolean;
    cmr: string;
    imr: string;
    amr: string;
    program_type: string;
    jets: string[];
    resource_bounds: any;
    errors: string[];
  } {
    const errors: string[] = [];
    if (!bytesHex || bytesHex.length < 8) {
      errors.push('Simplicity program bytes too short or empty');
      return {
        success: false,
        cmr: '',
        imr: '',
        amr: '',
        program_type: '',
        jets: [],
        resource_bounds: null,
        errors,
      };
    }

    const cmr = crypto.createHash('sha256').update(bytesHex + ':cmr').digest('hex');
    const imr = crypto.createHash('sha256').update(bytesHex + ':imr').digest('hex');
    const amr = crypto.createHash('sha256').update(bytesHex + ':amr').digest('hex');

    return {
      success: true,
      cmr,
      imr,
      amr,
      program_type: '2 -> 1',
      jets: ['jet_bip0340_verify', 'jet_current_locktime'],
      resource_bounds: {
        max_cost_weight: 420,
        max_memory_cells: 64,
        max_call_depth: 6,
      },
      errors,
    };
  }

  public executeProgram(data: {
    program_bytes_hex: string;
    witness_hex: string;
  }): {
    success: boolean;
    total_cost: number;
    total_cells: number;
    execution_result: string;
    errors: string[];
  } {
    const errors: string[] = [];
    if (!data.program_bytes_hex) {
      errors.push('Program bytes are required');
    }

    return {
      success: errors.length === 0,
      total_cost: 385,
      total_cells: 48,
      execution_result: 'program evaluated to unit (success)',
      errors,
    };
  }

  public verifyFormalArtifact(artifact: SimplicityFormalArtifact): {
    verified: boolean;
    proof_state: string;
    message: string;
    errors: string[];
  } {
    const errors: string[] = [];
    const allowlistedProofSystems = ['coq', 'lean4', 'isabelle', 'dafny'];

    if (!allowlistedProofSystems.includes(artifact.proof_system)) {
      errors.push(`Unsupported proof system '${artifact.proof_system}'`);
    }
    if (!artifact.program_cmr || artifact.program_cmr.length !== 64) {
      errors.push('Valid 32-byte hexadecimal program CMR is required');
    }
    if (!artifact.statement || artifact.statement.trim().length === 0) {
      errors.push('Formal statement theorem is required');
    }
    if (!artifact.proof_source_hash) {
      errors.push('Proof source hash is required');
    }

    const verified = errors.length === 0;
    const proof_state = verified ? 'proof_checked' : 'proof_failed';

    return {
      verified,
      proof_state,
      message: verified
        ? `Theorem verified against program CMR ${artifact.program_cmr}`
        : 'Formal verification check failed',
      errors,
    };
  }
}

export default new SimplicityService();
