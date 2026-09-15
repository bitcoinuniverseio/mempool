import { consensusService } from './consensus.service';
import { Transaction } from 'bitcoinjs-lib';
import { ctvTemplateHashes } from './ctv';

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

  it('rejects the former unsigned shape-only request instead of inventing vault execution', () => {
    expect(() =>
      consensusService.simulateCovenant({
        proposal_id: 'bip-119',
        covenant_script: 'OP_CHECKTEMPLATEVERIFY',
        deposit_sats: 1000,
        timelock_blocks: 144,
        recovery_pubkey: 'not-a-key',
        unvault_pubkey: 'not-a-key',
      })
    ).toThrow(/bare/);
  });
  it('checks actual CTV bytes with unknown full vault execution and witness weight', () => {
    const transaction = new Transaction();
    transaction.version = 2;
    transaction.addInput(Buffer.alloc(32, 1), 0, 144);
    transaction.addOutput(Buffer.from('51', 'hex'), 1000);
    const hash = ctvTemplateHashes(transaction.toHex(), [0]).hashes[0];
    const result = consensusService.simulateCovenant({
      proposal_id: 'bip-119',
      covenant_script: '20' + hash + 'b3',
      transaction_hex: transaction.toHex(),
      input_index: 0,
      deposit_sats: 10000000,
      timelock_blocks: 144,
      recovery_pubkey:
        '0289a1c2d3e4f5061728394a5b6c7d8e9f0123456789abcdef0123456789abcd',
      unvault_pubkey:
        '0379be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    });
    expect(result.valid).toBeNull();
    expect(result.template_matches).toBe(true);
    expect(result.state_transitions).toEqual([]);
    expect(result.witness_weight_estimate).toBeNull();
  });
});
