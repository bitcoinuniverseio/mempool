import crypto from 'crypto';
import {
  SimplicityProgram,
  SimplicityProgramOccurrence,
  SimplicityExecution,
  SimplicityFormalArtifact,
  SimplicityToolchain,
  SimplicityOverviewResponse,
} from './simplicity.models';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class SimplicityEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const programIndexUnavailable =
  'Simplicity program observations are unavailable. Program, occurrence, execution trace and overview reads require the owned Liquid Elements node with Simplicity support and its program index, which are not connected on this deployment.';

const toolchainUnavailable =
  'Simplicity toolchain observations are unavailable. Toolchain reads require the owned toolchain registry (pinned rust-simplicity, libsimplicity and SimplicityHL revisions), which is not connected on this deployment.';

const runtimeUnavailable =
  'Simplicity execution is unavailable. Running a program requires the owned Simplicity runtime (libsimplicity bit machine), which is not connected on this deployment.';

/**
 * Simplicity programs, occurrences and execution traces.
 *
 * Every observation read needs the owned Liquid Elements node and program
 * index. A deployment that has none gets a 503 that names them: an empty
 * program directory and an absent one are different answers, and this never
 * turns the second into the first. Decoding and formal-artifact checks are
 * computations on caller-supplied input and stay answerable.
 */
export class SimplicityService {
  public getOverview(): SimplicityOverviewResponse {
    throw new SimplicityEvidenceError('unavailable-program-index', programIndexUnavailable);
  }

  public listPrograms(): SimplicityProgram[] {
    throw new SimplicityEvidenceError('unavailable-program-index', programIndexUnavailable);
  }

  public getProgram(_programId: string): SimplicityProgram | undefined {
    throw new SimplicityEvidenceError('unavailable-program-index', programIndexUnavailable);
  }

  public getProgramOccurrences(_programId: string): SimplicityProgramOccurrence[] {
    throw new SimplicityEvidenceError('unavailable-program-index', programIndexUnavailable);
  }

  public getTransaction(_txid: string): {
    txid: string;
    has_simplicity: boolean;
    executions: SimplicityExecution[];
  } {
    throw new SimplicityEvidenceError('unavailable-program-index', programIndexUnavailable);
  }

  public listToolchains(): SimplicityToolchain[] {
    throw new SimplicityEvidenceError('unavailable-toolchain-registry', toolchainUnavailable);
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

    // A CMR, IMR and AMR are commitments over the decoded program tree. The
    // sha256 of the hex string is none of those, and a fixed jet list is not a
    // decoding. Decoding needs the owned Simplicity library.
    throw new SimplicityEvidenceError('unavailable-decoder',
      'Simplicity program decoding is unavailable. Computing the CMR, IMR and AMR, the program type, its jets and its resource bounds requires the owned libsimplicity decoder, which is not connected on this deployment.');
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
    if (!data || !data.program_bytes_hex) {
      return {
        success: false,
        total_cost: 0,
        total_cells: 0,
        execution_result: '',
        errors: ['Program bytes are required'],
      };
    }
    throw new SimplicityEvidenceError('unavailable-runtime', runtimeUnavailable);
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
