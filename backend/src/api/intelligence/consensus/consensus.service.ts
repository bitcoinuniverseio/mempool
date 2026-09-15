import crypto from 'crypto';
import { checkBareCtv } from './ctv';
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
      status: 'draft',
      covenant_type: 'non_recursive',
      activation_mechanism: 'Not specified by this BIP',
      spec_url:
        'https://github.com/bitcoin/bips/blob/master/bip-0119.mediawiki',
      summary:
        'Deterministic commitment to spending transaction outputs, enabling simple non-recursive covenants, congestion-control trees, and payment pools.',
      opcodes: ['OP_CHECKTEMPLATEVERIFY', 'OP_NOP4'],
      expressiveness_score: null,
      security_surface_rating: null,
      created_at: '2020-01-06T00:00:00Z',
    };

    const p2: ConsensusProposal = {
      proposal_id: 'bip-347',
      bip_number: 347,
      title: 'OP_CAT in Tapscript',
      author: 'Ethan Heilman, Armin Sabouri',
      proposal_type: 'covenant',
      status: 'complete',
      covenant_type: 'recursive',
      activation_mechanism: 'Not specified by this BIP',
      spec_url:
        'https://github.com/bitcoin/bips/blob/master/bip-0347.mediawiki',
      summary:
        'Restores OP_CAT opcode in Tapscript allowing string concatenation, which in combination with Schnorr signatures enables covenants, Merkle trees, and recursive vaults.',
      opcodes: ['OP_CAT', 'OP_SUCCESS126'],
      expressiveness_score: null,
      security_surface_rating: null,
      created_at: '2023-12-11T00:00:00Z',
    };

    const p3: ConsensusProposal = {
      proposal_id: 'bip-443',
      bip_number: 443,
      title: 'OP_CHECKCONTRACTVERIFY',
      author: 'Salvatore Ingala',
      proposal_type: 'introspection',
      status: 'draft',
      covenant_type: 'general',
      activation_mechanism: 'Not specified by this BIP',
      spec_url:
        'https://github.com/bitcoin/bips/blob/master/bip-0443.mediawiki',
      summary:
        'Proposed tapscript checks bind carried data, Taproot program commitments and aggregate input/output amount constraints.',
      opcodes: ['OP_CHECKCONTRACTVERIFY', 'OP_SUCCESS187'],
      expressiveness_score: null,
      security_surface_rating: null,
      created_at: '2025-05-08T00:00:00Z',
    };

    this.proposals.set(p1.proposal_id, p1);
    this.proposals.set(p2.proposal_id, p2);
    this.proposals.set(p3.proposal_id, p3);

    this.vaultTemplates = [
      {
        template_id: 'vault-simple-ctv',
        name: 'Simple CTV Time-Delayed Vault',
        description:
          'Standard 2-stage vault using OP_CHECKTEMPLATEVERIFY with unvaulting trigger and cold recovery key.',
        proposal_target: 'bip-119',
        hot_key_threshold: 1,
        recovery_delay_blocks: 144,
        auto_cancel_available: true,
      },
      {
        template_id: 'vault-cat-recursive',
        name: 'OP_CAT Introspecting Recursive Vault',
        description:
          'General recursive vault that preserves custody rules on partial withdrawals without pre-computing all spending trees.',
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
      covenant_types: Object.entries(typesCount).map(([type, count]) => ({
        type,
        count,
      })),
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

  public simulateCovenant(
    req: CovenantSimulationRequest
  ): CovenantSimulationResult {
    if (!req.proposal_id) {
      throw new Error('proposal_id is required for covenant simulation.');
    }

    const proposal = this.proposals.get(req.proposal_id);
    if (!proposal) {
      throw new Error(
        `Proposal ${req.proposal_id} not registered in Consensus Lab.`
      );
    }

    if (req.proposal_id !== 'bip-119')
      throw new Error(
        'This endpoint currently checks bare BIP119 commitments. Complete hypothetical OP_CAT and OP_CHECKCONTRACTVERIFY interpreters are not yet connected.'
      );
    const evidence = checkBareCtv(
      req.transaction_hex!,
      req.input_index!,
      req.covenant_script
    );
    return {
      simulation_id: 'cov-sim-' + crypto.randomBytes(8).toString('hex'),
      proposal_id: req.proposal_id,
      valid: evidence.template_matches ? null : false,
      ...evidence,
      scope:
        'BIP119 bare-script template equality under hypothetical activation. Full script execution, key authorization, timelock maturity, chain activation and vault state transitions are not established.',
      state_transitions: [],
      witness_weight_estimate: null,
      covenant_restrictions_summary: [
        'The hash binds version, locktime, scriptSigs when present, input count and sequences, output count and bytes, and the executing input index.',
        'It does not bind input outpoints or witness signatures. Template equality alone is not a safe vault or a valid spend.',
        'Deposit, recovery key and hot-key fields do not constitute executable transaction evidence.',
      ],
    };
  }
}

export const consensusService = ConsensusService.getInstance();
