import { consensusService } from './consensus.service';

describe('ConsensusService', () => {
  it('should return overview with proposals count and vault templates', () => {
    const overview = consensusService.getOverview();
    expect(overview).toBeDefined();
    expect(overview.proposals_count).toBeGreaterThan(0);
    expect(overview.featured_proposals.length).toBeGreaterThan(0);
    expect(overview.vault_templates.length).toBeGreaterThan(0);
  });

  it('should fetch proposal by ID (e.g. bip-119)', () => {
    const p = consensusService.getProposalById('bip-119');
    expect(p).not.toBeNull();
    expect(p?.bip_number).toBe(119);
    expect(p?.opcodes).toContain('OP_CHECKTEMPLATEVERIFY');
  });

  it('should simulate covenant state transitions and timelocks', () => {
    const result = consensusService.simulateCovenant({
      proposal_id: 'bip-119',
      covenant_script: 'OP_CHECKTEMPLATEVERIFY',
      deposit_sats: 10000000,
      timelock_blocks: 144,
      recovery_pubkey: '0289a1c2d3e4f5061728394a5b6c7d8e9f0123456789abcdef0123456789abcd',
      unvault_pubkey: '0379be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    });
    expect(result.valid).toBe(true);
    expect(result.state_transitions.length).toBe(3);
    expect(result.state_transitions[1].delay_blocks).toBe(144);
  });
});
