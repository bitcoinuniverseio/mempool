import { protocolRegistryService } from './protocol-registry.service';

describe('Product 12: Universal Protocol Intelligence Registry and Adapter Platform', () => {
  it('registers comprehensive protocol catalog across tokens, layer-2, privacy, and metadata', () => {
    const protocols = protocolRegistryService.getAdapters();
    expect(protocols.length).toBeGreaterThanOrEqual(5);

    const ids = protocols.map((p) => p.protocol_id);
    expect(ids).toContain('ordinals');
    expect(ids).toContain('runes');
    expect(ids).toContain('brc20');
    expect(ids).toContain('lightning');
    expect(ids).toContain('bip352_silent_payments');
    expect(ids).toContain('opentimestamps');
  });

  it('decodes Runestone edicts from OP_RETURN OP_13 tag', () => {
    const runesScriptHex = '6a5d04140105e80702'; // OP_RETURN OP_13 Runestone
    const decoded = protocolRegistryService.decodePayload(runesScriptHex);

    expect(decoded.length).toBeGreaterThan(0);
    expect(decoded[0].protocol_id).toBe('runes');
    expect(decoded[0].operation_type).toBe('edict_transfer');
    expect(decoded[0].parameters.rune_name).toBeDefined();
    expect(decoded[0].confidence).toBe(1.0);
  });

  it('decodes Ordinal inscription envelopes from witness script tags', () => {
    const ordScriptHex = '0063036f726401010a696d6167652f7765627000...';
    const decoded = protocolRegistryService.decodePayload(ordScriptHex);

    expect(decoded.length).toBeGreaterThan(0);
    expect(decoded[0].protocol_id).toBe('ordinals');
    expect(decoded[0].operation_type).toBe('inscription_reveal');
    expect(decoded[0].parameters.content_type).toBe('image/webp');
  });

  it('provides protocol activity metrics with block weight and fee shares', () => {
    const runesMetrics = protocolRegistryService.getMetrics('runes');
    expect(runesMetrics.protocol_id).toBe('runes');
    expect(runesMetrics.weight_share_percent).toBeGreaterThan(0);
    expect(runesMetrics.fee_share_percent).toBeGreaterThan(0);
    expect(runesMetrics.tx_count_24h).toBeGreaterThan(0);

    const ordinalsMetrics = protocolRegistryService.getMetrics('ordinals');
    expect(ordinalsMetrics.weight_share_percent).toBeGreaterThan(0);
  });
});
