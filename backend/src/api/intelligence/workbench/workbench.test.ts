import { workbenchService } from './workbench.service';

describe('Product 7: Bitcoin Script, Descriptor, Miniscript, and PSBT Workbench', () => {
  const p2wpkhScript = '0014751e76e8199196d454941c45d1b3a323f1433bd6';
  const p2trScript = '5120a60869f0dbcf1dc659c9cecbaf8050135ea9e8cdcfa87e556e3f72f10749297c';
  const p2pkhScript = '76a91438908fef9b8098c772274b7c1265882e70c8cf8688ac';

  it('analyzes standard SegWit and Taproot scriptPubKeys with satisfaction weights', () => {
    const wpkhAnalysis = workbenchService.analyzeScript(p2wpkhScript);
    expect(wpkhAnalysis.script_type).toBe('p2wpkh');
    expect(wpkhAnalysis.is_standard).toBe(true);
    expect(wpkhAnalysis.consensus_valid).toBe(true);
    expect(wpkhAnalysis.max_satisfaction_weight).toBe(272);

    const trAnalysis = workbenchService.analyzeScript(p2trScript);
    expect(trAnalysis.script_type).toBe('p2tr');
    expect(trAnalysis.is_standard).toBe(true);
    expect(trAnalysis.max_satisfaction_weight).toBe(260);

    const pkhAnalysis = workbenchService.analyzeScript(p2pkhScript);
    expect(pkhAnalysis.script_type).toBe('p2pkh');
    expect(pkhAnalysis.malleability_warnings.length).toBeGreaterThan(0);
  });

  it('simulates stack execution steps with before and after stack snapshots', () => {
    const simulation = workbenchService.simulateStack(p2wpkhScript, ['30440220...', '0279be66...']);
    expect(simulation.length).toBeGreaterThanOrEqual(2);
    expect(simulation[0].opcode).toBe('INITIAL_WITNESS');
    expect(simulation[1].opcode).toBe('OP_CHECKSIG');
    expect(simulation[1].stack_after).toContain('1');
  });

  it('compiles spending policy into Miniscript and calculates worst-case weight', () => {
    const compiled = workbenchService.compileMiniscript('and(pk(A),older(144))');
    expect(compiled.miniscript).toContain('wsh(');
    expect(compiled.max_witness_size).toBeGreaterThan(0);
    expect(compiled.worst_case_satisfaction_weight).toBeGreaterThan(0);
    expect(compiled.properties.non_malleable).toBe(true);
    expect(compiled.properties.timelock_safe).toBe(true);
  });

  it('parses output descriptors and derives addresses for key ranges', () => {
    const desc = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZtsWPgv2EZpqRz12345/0/*)#abc12345';
    const parsed = workbenchService.parseDescriptor(desc);
    expect(parsed.is_valid).toBe(true);
    expect(parsed.script_type).toBe('p2wpkh');
    expect(parsed.is_range).toBe(true);
    expect(parsed.derived_samples.length).toBe(3);
    for (const sample of parsed.derived_samples) {
      expect(sample.address).toMatch(/^bc1q/);
      expect(sample.script_pub_key).toMatch(/^0014/);
    }
  });

  it('analyzes PSBT byte payloads and determines completion status', () => {
    const dummyPsbtHex = '70736274ff0100520200000001000000';
    const analysis = workbenchService.analyzePsbt(dummyPsbtHex);
    expect(analysis.input_count).toBeGreaterThan(0);
    expect(analysis.output_count).toBeGreaterThan(0);
    expect(analysis.total_fee_sats).toBeGreaterThan(0);
    expect(analysis.is_complete).toBe(true);
  });
});
