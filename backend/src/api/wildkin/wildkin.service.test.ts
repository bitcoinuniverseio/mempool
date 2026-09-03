import { wildkinService } from './wildkin.service';

describe('WildkinService', () => {
  it('returns ruleset v0 status summary', async () => {
    const status = await wildkinService.$getStatus();
    expect(status.ruleset).toBe('Wildkin ruleset v0');
    expect(status.totalCreaturesCount).toBeGreaterThan(0);
    expect(status.latestCreatures.length).toBeGreaterThan(0);
  });

  it('tracks parent-child provenance and braid ceremonies', async () => {
    const braids = await wildkinService.$getBraids();
    expect(braids.length).toBeGreaterThan(0);
    expect(braids[0].heirCreatureId).toBe('wk-cr-003');
    expect(braids[0].parentAId).toBe('wk-cr-001');
    expect(braids[0].parentBId).toBe('wk-cr-002');
    expect(braids[0].valid).toBe(true);
  });

  it('retrieves creature with binding UTXO and genome', async () => {
    const creature = await wildkinService.$getCreature('wk-cr-001');
    expect(creature).not.toBeNull();
    expect(creature?.bindingUtxo).toBeDefined();
    expect(creature?.formatTag).toBe('wk');
  });
});
