import { stratumV2Service } from './stratum-v2.service';

describe('StratumV2Service', () => {
  it('returns Stratum V2 active subprotocols and Noise protocol status', async () => {
    const roles = await stratumV2Service.$getRoles();
    expect(roles.length).toBeGreaterThan(0);
    expect(roles[0].noiseProtocolSecured).toBe(true);
    expect(roles[0].negotiatedSubprotocols.includes('job-declaration')).toBe(true);
  });

  it('tracks template-to-job lineage and fee deltas', async () => {
    const templates = await stratumV2Service.$getTemplates();
    expect(templates.length).toBeGreaterThan(0);
    expect(templates[0].declaredTxCount).toBeGreaterThan(0);
  });

  it('provides miner-declared transaction acceptance logs', async () => {
    const declarations = await stratumV2Service.$getDeclarations();
    expect(declarations.length).toBeGreaterThan(0);
    expect(declarations[0].acceptedByPool).toBe(true);
  });
});
