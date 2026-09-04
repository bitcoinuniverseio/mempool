import { payjoinService } from './payjoin.service';

describe('PayjoinService', () => {
  it('should return overview with active directories and compatibility catalog', () => {
    const overview = payjoinService.getOverview();
    expect(overview).toBeDefined();
    expect(overview.active_directories_count).toBeGreaterThan(0);
    expect(overview.compatibility_catalog.length).toBeGreaterThan(0);
  });

  it('should analyze Payjoin proposal and identify broken heuristics', () => {
    const result = payjoinService.analyzeProposal({
      original_psbt: 'cHNidP8BAFICAAAAAQAAAAAAAAAAAAAAAQAAAAAAAAAAAA==',
      proposal_psbt: 'cHNidP8BAFICAAAAAgAAAAAAAAAAAAAAAgAAAAAAAAAAAA==',
    });
    expect(result.analysis_id).toBeDefined();
    expect(result.inputs_added_by_receiver).toBe(1);
    expect(result.heuristics_broken).toContain('Common-Input-Ownership Heuristic (CIOH)');
    expect(result.privacy_score_gain).toBeGreaterThan(50);
  });

  it('should progress through playground sandbox lifecycle phases', () => {
    const session = payjoinService.createPlaygroundSession(250000);
    expect(session.step).toBe('original_created');

    const step2 = payjoinService.advancePlaygroundSession(session.session_id);
    expect(step2.step).toBe('proposal_generated');

    const step3 = payjoinService.advancePlaygroundSession(session.session_id);
    expect(step3.step).toBe('signed_and_broadcast');
    expect(step3.payjoin_txid).toBeDefined();
  });
});
