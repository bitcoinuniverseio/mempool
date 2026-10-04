import { EventEnvelopeValidator as validator } from './event-envelope';

const make = (payload: Record<string, unknown>): ReturnType<typeof validator.createEnvelope> => validator.createEnvelope({ network: 'signet', source_id: 'controlled',
  event_type: 'observed', entity_type: 'template', entity_id: 'controlled', payload });

describe('complete versioned event payload integrity', () => {
  it('covers nested template fields and rejects mutation after publication', () => {
    const envelope = make({ template: { height: 3186, total_fees_sats: 100, txids: ['a', 'b'] } });
    expect(validator.validateEnvelope(envelope).valid).toBe(true);
    envelope.payload = { template: { height: 3187, total_fees_sats: 200, txids: ['a', 'b'] } };
    expect(validator.validateEnvelope(envelope)).toMatchObject({ valid: false, error: 'Event payload digest mismatch.' });
  });

  it('canonicalizes nested member order while preserving array order and all member names', () => {
    const a = { template: { height: 1, txids: ['a', 'b'], nested: { value: 2, other: 3 } } };
    const b = { template: { nested: { other: 3, value: 2 }, txids: ['a', 'b'], height: 1 } };
    expect(validator.computePayloadHash(a)).toBe(validator.computePayloadHash(b));
    expect(validator.computePayloadHash(a)).not.toBe(validator.computePayloadHash({ template: { ...a.template, txids: ['b', 'a'] } }));
    const special = JSON.parse('{"template":{"__proto__":{"observed":1},"value":2}}');
    expect(validator.computePayloadHash(special)).not.toBe(validator.computePayloadHash({ template: { value: 2 } }));
  });

  it('retains verifiable flat version1.0 compatibility and refuses unverifiable historical nested records', () => {
    const envelope = make({ value_sats: 100, label: 'old' });
    envelope.schema_version = '1.0.0';
    envelope.clock_offset_ms = 0; envelope.clock_uncertainty_ms = 1;
    expect(validator.validateEnvelope(envelope).valid).toBe(true);
    const oldNested = make({ template: { height: 1 } });
    oldNested.schema_version = '1.0.0';
    oldNested.clock_offset_ms = 0; oldNested.clock_uncertainty_ms = 1;
    expect(validator.validateEnvelope(oldNested)).toMatchObject({ valid: false, error: expect.stringContaining('unverifiable') });
    expect(() => validator.createEnvelope({ network: 'signet', source_id: 'old', event_type: 'observed', entity_type: 'template', entity_id: 'old', payload: oldNested.payload }, '1.0.0')).toThrow(/version 1.1/);
  });

  it('rejects unsupported schemas, invalid digest bytes and unsafe atomic quantities', () => {
    const envelope = make({ value_sats: 100 });
    envelope.schema_version = '9.0.0';
    expect(validator.validateEnvelope(envelope).valid).toBe(false);
    envelope.schema_version = '1.1.0'; envelope.payload_hash = 'dummy';
    expect(validator.validateEnvelope(envelope).valid).toBe(false);
    expect(() => make({ value_sats: Number.MAX_SAFE_INTEGER + 1 })).toThrow(/Integer constraint/);
    envelope.source_sequence = Number.MAX_SAFE_INTEGER + 1;
    expect(validator.validateEnvelope(envelope).valid).toBe(false);
    expect(() => validator.createEnvelope({ network: 'signet', source_id: 'fractional', source_sequence: 1.5,
      event_type: 'observed', entity_type: 'template', entity_id: 'fractional', payload: { label: 'invalid' } })).toThrow(/source_sequence/);
  });

  it('does not invent a Core version for an unspecified event producer', () => {
    expect(make({ label: 'unknown' })).toMatchObject({ source_software: 'Universe Explorer event producer', source_version: 'unknown' });
  });

  it('preserves unknown clocks explicitly and never rounds or fabricates measurements', () => {
    expect(make({ label: 'unmeasured' })).toMatchObject({ schema_version: '1.2.0', clock_offset_ms: null, clock_uncertainty_ms: null });
    const input = { network: 'signet', source_id: 'controlled', event_type: 'observed', entity_type: 'template', entity_id: 'controlled', payload: {} };
    for (const measurement of [{ clock_offset_ms: 0 }, { clock_offset_ms: 0, clock_uncertainty_ms: -1 },
      { clock_offset_ms: 0.5, clock_uncertainty_ms: 1 }, { clock_offset_ms: 0, clock_uncertainty_ms: Number.MAX_SAFE_INTEGER + 1 }]) {
      expect(() => validator.createEnvelope({ ...input, ...measurement })).toThrow(/Clock measurements/);
    }
    expect(() => validator.createEnvelope(input, '1.1.0')).toThrow(/version 1.2/);
    const measured = validator.createEnvelope({ ...input, clock_offset_ms: -2, clock_uncertainty_ms: 3 });
    expect(validator.validateEnvelope(measured).valid).toBe(true);
    measured.clock_uncertainty_ms = null;
    expect(validator.validateEnvelope(measured).valid).toBe(false);
  });
});
