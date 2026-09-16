import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StateService } from '@app/services/state.service';

export type SimplicityProofState =
  | 'source_only'
  | 'compiled'
  | 'executed'
  | 'proof_manifest_valid'
  | 'proof_checked'
  | 'proof_failed'
  | 'unsupported_proof_system';

export interface SimplicityProgramRoot {
  cmr: string; // Commitment Merkle Root
  imr: string; // Identity Merkle Root
  amr: string; // Annotated Merkle Root
}

export interface SimplicityProgramResourceBound {
  max_cost_weight: number;
  max_memory_cells: number;
  max_call_depth: number;
  jets_cost_discount: number;
  pruned_witness_ratio_pct: number;
}

export interface SimplicityProgramOccurrence {
  occurrence_id: string;
  txid: string;
  input_index: number;
  block_height: number;
  block_hash: string;
  network: 'liquid-v1' | 'liquid-testnet' | 'elements-regtest';
  spent_amount_sats: number;
  asset_id: string;
  confirmed_at: string;
}

export interface SimplicityProgram {
  program_id: string;
  program_name: string;
  cmr: string;
  imr: string;
  amr: string;
  source_text?: string;
  program_bytes_hex: string;
  program_type: string;
  toolchain_revision: string;
  resource_bounds: SimplicityProgramResourceBound;
  jets: string[];
  occurrences_count: number;
  formal_verification_state: SimplicityProofState;
  first_seen_height: number;
  provenance: {
    author?: string;
    verified_commit?: string;
    proof_system?: string;
  };
}

export interface SimplicityExecutionStep {
  step: number;
  node_name: string;
  expression: string;
  cost: number;
  memory_delta: number;
  environment_snapshot: string;
}

export interface SimplicityExecution {
  execution_id: string;
  program_id: string;
  cmr: string;
  txid?: string;
  input_index?: number;
  success: boolean;
  total_cost: number;
  total_cells: number;
  witness_hex: string;
  steps: SimplicityExecutionStep[];
  executed_at: string;
}

export interface SimplicityToolchain {
  toolchain_id: string;
  version: string;
  rust_simplicity_rev: string;
  libsimplicity_rev: string;
  simplicity_hl_rev: string;
  supported_jets_count: number;
  is_active: boolean;
  released_at: string;
}

export interface SimplicityOverview {
  total_programs: number;
  total_occurrences: number;
  verified_proofs_count: number;
  active_toolchain: SimplicityToolchain;
  recent_programs: SimplicityProgram[];
  recent_occurrences: SimplicityProgramOccurrence[];
}

export interface SimplicityTransaction { txid: string; has_simplicity: boolean; executions: SimplicityExecution[]; }

@Injectable({
  providedIn: 'root',
})
export class SimplicityApiService {
  private apiBaseUrl = '';

  constructor(
    private httpClient: HttpClient,
    private stateService: StateService
  ) {
    if (!this.stateService.isBrowser && this.stateService.env) {
      this.apiBaseUrl =
        this.stateService.env.NGINX_PROTOCOL +
        '://' +
        this.stateService.env.NGINX_HOSTNAME +
        ':' +
        this.stateService.env.NGINX_PORT;
    }
  }

  getOverview$(): Observable<SimplicityOverview> {
    return this.httpClient.get<SimplicityOverview>(
      `${this.apiBaseUrl}/api/v1/intelligence/simplicity/overview`
    );
  }

  getPrograms$(): Observable<SimplicityProgram[]> {
    return this.httpClient.get<SimplicityProgram[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/simplicity/programs`
    );
  }

  getProgramById$(programId: string): Observable<SimplicityProgram> {
    return this.httpClient.get<SimplicityProgram>(
      `${this.apiBaseUrl}/api/v1/intelligence/simplicity/programs/${encodeURIComponent(programId)}`
    );
  }

  getTransactionExecution$(txid: string): Observable<SimplicityTransaction> {
    return this.httpClient.get<SimplicityTransaction>(
      `${this.apiBaseUrl}/api/v1/intelligence/simplicity/transactions/${encodeURIComponent(txid)}`
    );
  }

  getToolchains$(): Observable<SimplicityToolchain[]> {
    return this.httpClient.get<SimplicityToolchain[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/simplicity/toolchains`
    );
  }

  decodeProgram$(programHex: string): Observable<any> {
    return this.httpClient.post<any>(
      `${this.apiBaseUrl}/api/v1/intelligence/simplicity/programs/decode`,
      { program_hex: programHex }
    );
  }

  verifyFormalProof$(proofPackage: any): Observable<any> {
    return this.httpClient.post<any>(
      `${this.apiBaseUrl}/api/v1/intelligence/simplicity/formal-artifacts/verify`,
      proofPackage
    );
  }
}
