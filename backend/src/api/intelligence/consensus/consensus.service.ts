import crypto from 'crypto';
import logger from '../../../logger';
import { IntelligenceEventBus } from '../events/intelligence-event-bus';
import {
  ConsensusProposal,
  CovenantSimulationRequest,
  CovenantSimulationResult,
  VaultDesignTemplate,
  ConsensusLabOverview,
} from './consensus.models';

export class ConsensusService {
  private static instance: ConsensusService;
  private eventBus = IntelligenceEventBus.getInstance();

  private proposals: Map<string, ConsensusProposal> = new Map();
  private vaultTemplates: VaultDesignTemplate[] = [];

  private constructor() {
    this.seedInitialData();
  }

  public static getInstance(): ConsensusService {
    if (!ConsensusService.instance) {
      ConsensusService.instance = new ConsensusService();
    }
    return ConsensusService.instance;
  }

  private seedInitialData(): void {
    const p1: ConsensusProposal = {
      proposal_id: 'bip-119',
      bip_number: 119,
      title: 'CHECKTEMPLATEVERIFY (CTV)',
      author: 'Jeremy Rubin',
      proposal_type: 'covenant',
      status: 'active_discussion',
      covenant_type: 'non_recursive',
      activation_mechanism: 'Speedy Trial / BIP9 Soft Fork',
      spec_url: 'https://github.com/bitcoin/bips/blob/master/bip-0119.mediawiki',
      summary: 'Deterministic commitment to spending transaction outputs, enabling simple non-recursive covenants, congestion-control trees, and payment pools.',
      opcodes: ['OP_CHECKTEMPLATEVERIFY', 'OP_NOP4'],
      expressiveness_score: 72,
      security_surface_rating: 'minimal',
      created_at: '2020-01-20T00:00:00Z',
    };

    const p2: ConsensusProposal = {
      proposal_id: 'bip-347',
      bip_number: 347,
      title: 'OP_CAT in Tapscript',
      author: 'Ethan Heilman, Armin Sabouri',
      proposal_type: 'covenant',
      status: 'active_discussion',
      covenant_type: 'recursive',
      activation_mechanism: 'BIP9 Soft Fork',
      spec_url: 'https://github.com/bitcoin/bips/blob/master/bip-0347.mediawiki',
      summary: 'Restores OP_CAT opcode in Tapscript allowing string concatenation, which in combination with Schnorr signatures enables covenants, Merkle trees, and recursive vaults.',
      opcodes: ['OP_CAT', 'OP_SUCCESS126'],
      expressiveness_score: 95,
      security_surface_rating: 'moderate',
      created_at: '2023-10-21T00:00:00Z',
    };

    const p3: ConsensusProposal = {
      proposal_id: 'bip-443',
      bip_number: 443,
      title: 'OP_TXHASH and OP_CHECKTXHASHVERIFY',
      author: 'Brandon Black',
      proposal_type: 'introspection',
      status: 'proposed',
      covenant_type: 'general',
      activation_mechanism: 'BIP8 / BIP9 Soft Fork',
      spec_url: 'https://github.com/bitcoin/bips/blob/master/bip-0443.mediawiki',
      summary: 'Generalized transaction introspection allowing scripts to hash specific selectable fields of the spending transaction.',
      opcodes: ['OP_TXHASH', 'OP_CHECKTXHASHVERIFY'],
      expressiveness_score: 88,
      security_surface_rating: 'moderate',
      created_at: '2024-02-14T00:00:00Z',
    };

    this.proposals.set(p1.proposal_id, p1);
    this.proposals.set(p2.proposal_id, p2);
    this.proposals.set(p3.proposal_id, p3);

    this.vaultTemplates = [
      {
        template_id: 'vault-simple-ctv',
        name: 'Simple CTV Time-Delayed Vault',
        description: 'Standard 2-stage vault using OP_CHECKTEMPLATEVERIFY with unvaulting trigger and cold recovery key.',
        proposal_target: 'bip-119',
        hot_key_threshold: 1,
        recovery_delay_blocks: 144,
        auto_cancel_available: true,
      },
      {
        template_id: 'vault-cat-recursive',
        name: 'OP_CAT Introspecting Recursive Vault',
        description: 'General recursive vault that preserves custody rules on partial withdrawals without pre-computing all spending trees.',
        proposal_target: 'bip-347',
        hot_key_threshold: 2,
        recovery_delay_blocks: 288,
        auto_cancel_available: true,
      },
    ];
  }

  public getOverview(): ConsensusLabOverview {
    const props = Array.from(this.proposals.values());
    const typesCount: Record<string, number> = {};
    for (const p of props) {
      typesCount[p.covenant_type] = (typesCount[p.covenant_type] || 0) + 1;
    }

    return {
      proposals_count: props.length,
      covenant_types: Object.entries(typesCount).map(([type, count]) => ({ type, count })),
      featured_proposals: props,
      vault_templates: this.vaultTemplates,
      last_updated: new Date().toISOString(),
    };
  }

  public getProposals(): ConsensusProposal[] {
    return Array.from(this.proposals.values());
  }

  public getProposalById(id: string): ConsensusProposal | null {
    return this.proposals.get(id) || null;
  }

  public getVaultTemplates(): VaultDesignTemplate[] {
    return this.vaultTemplates;
  }

  public simulateCovenant(req: CovenantSimulationRequest): CovenantSimulationResult {
    if (!req.proposal_id) {
      throw new Error('proposal_id is required for covenant simulation.');
    }

    const proposal = this.proposals.get(req.proposal_id);
    if (!proposal) {
      throw new Error(`Proposal ${req.proposal_id} not registered in Consensus Lab.`);
    }

    return {
      simulation_id: 'cov-sim-' + crypto.randomBytes(4).toString('hex'),
      proposal_id: req.proposal_id,
      valid: true,
      state_transitions: [
        {
          from_state: 'Vaulted (Cold Balance)',
          to_state: 'Unvaulting (Pending Challenge Window)',
          trigger: 'Hot Key Authorization Signature',
          delay_blocks: 0,
        },
        {
          from_state: 'Unvaulting (Pending Challenge Window)',
          to_state: 'Settled (Destination Address)',
          trigger: 'Timelock Expiration (CSV)',
          delay_blocks: req.timelock_blocks || 144,
        },
        {
          from_state: 'Unvaulting (Pending Challenge Window)',
          to_state: 'Recovered (Emergency Cold Key)',
          trigger: 'Emergency Clawback Cold Key Signature',
          delay_blocks: 0,
        },
      ],
      witness_weight_estimate: 280,
      covenant_restrictions_summary: [
        `Destination address locked to ${proposal.covenant_type} template commitment.`,
        `Emergency cancellation active for ${req.timelock_blocks || 144} blocks (~24h).`,
        `Spending transaction must match exact hash commitment parameters.`,
      ],
    };
  }
}

export const consensusService = ConsensusService.getInstance();
