import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StateService } from '@app/services/state.service';

export interface ConsensusProposal {
  proposal_id: string;
  bip_number?: number;
  title: string;
  author: string;
  proposal_type: 'covenant' | 'arithmetic' | 'introspection' | 'upgrade';
  status: 'draft' | 'proposed' | 'active_discussion' | 'superseded';
  covenant_type: 'recursive' | 'non_recursive' | 'general';
  activation_mechanism: string;
  spec_url: string;
  summary: string;
  opcodes: string[];
  expressiveness_score: number;
  security_surface_rating: 'minimal' | 'moderate' | 'complex';
  created_at: string;
}

export interface CovenantSimulationResult {
  simulation_id: string;
  proposal_id: string;
  valid: boolean;
  state_transitions: {
    from_state: string;
    to_state: string;
    trigger: string;
    delay_blocks?: number;
  }[];
  witness_weight_estimate: number;
  covenant_restrictions_summary: string[];
}

export interface VaultDesignTemplate {
  template_id: string;
  name: string;
  description: string;
  proposal_target: string;
  hot_key_threshold: number;
  recovery_delay_blocks: number;
  auto_cancel_available: boolean;
}

export interface ConsensusLabOverview {
  proposals_count: number;
  covenant_types: { type: string; count: number }[];
  featured_proposals: ConsensusProposal[];
  vault_templates: VaultDesignTemplate[];
  last_updated: string;
}

@Injectable({
  providedIn: 'root',
})
export class ConsensusApiService {
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

  getOverview$(): Observable<ConsensusLabOverview> {
    return this.httpClient.get<ConsensusLabOverview>(
      `${this.apiBaseUrl}/api/v1/intelligence/consensus/overview`
    );
  }

  getProposals$(): Observable<ConsensusProposal[]> {
    return this.httpClient.get<ConsensusProposal[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/consensus/proposals`
    );
  }

  getProposalById$(proposalId: string): Observable<ConsensusProposal> {
    return this.httpClient.get<ConsensusProposal>(
      `${this.apiBaseUrl}/api/v1/intelligence/consensus/proposals/${encodeURIComponent(proposalId)}`
    );
  }

  getVaultTemplates$(): Observable<VaultDesignTemplate[]> {
    return this.httpClient.get<VaultDesignTemplate[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/consensus/vaults/templates`
    );
  }

  simulateCovenant$(req: {
    proposal_id: string;
    covenant_script: string;
    deposit_sats: number;
    timelock_blocks: number;
    recovery_pubkey: string;
    unvault_pubkey: string;
  }): Observable<CovenantSimulationResult> {
    return this.httpClient.post<CovenantSimulationResult>(
      `${this.apiBaseUrl}/api/v1/intelligence/consensus/simulations`,
      req
    );
  }
}
