import {
  EventEnvelopeValidator,
} from './event-envelope';
import { IntelligenceEventBus } from './intelligence-event-bus';
import { developerIdentity, IdentityError, validateWebhookUrl } from '../identity/developer-identity';
import { MemoryOwnerStore, useOwnerStore } from '../identity/owner-store';

describe('Phase 1 Foundation: Event Envelope & Event Bus', () => {
  it('generates valid UUIDv7 identifiers', () => {
    const id1 = EventEnvelopeValidator.generateUuidV7();
    const id2 = EventEnvelopeValidator.generateUuidV7();
    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id2).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id1).not.toEqual(id2);
  });

  it('computes deterministic SHA-256 payload hash regardless of key order', () => {
    const payloadA = { fee_sats: 5000, txid: 'abcd', weight: 400 };
    const payloadB = { txid: 'abcd', weight: 400, fee_sats: 5000 };
    const hashA = EventEnvelopeValidator.computePayloadHash(payloadA);
    const hashB = EventEnvelopeValidator.computePayloadHash(payloadB);
    expect(hashA).toBe(hashB);
  });

  it('enforces integer satoshis and virtual bytes, rejecting floating point amounts', () => {
    const validPayload = { fee_sats: 2500, vsize: 140, total_sats: 100000 };
    expect(() => EventEnvelopeValidator.assertIntegerAmounts(validPayload)).not.toThrow();

    const invalidFee = { fee_sats: 2500.5, vsize: 140 };
    expect(() => EventEnvelopeValidator.assertIntegerAmounts(invalidFee)).toThrow(
      /Integer constraint violation/
    );

    const invalidVsize = { fee_sats: 2500, vsize: 140.2 };
    expect(() => EventEnvelopeValidator.assertIntegerAmounts(invalidVsize)).toThrow(
      /Integer constraint violation/
    );
  });

  it('creates a validated event envelope with proper topic hierarchy', () => {
    const envelope = EventEnvelopeValidator.createEnvelope({
      event_type: 'observed',
      network: 'bitcoin',
      source_id: 'sensor-us-east-01',
      entity_type: 'mempool',
      entity_id: 'tx-test-01',
      payload: { fee_sats: 4500, vsize: 200 },
    });

    expect(envelope.event_id).toBeDefined();
    expect(envelope.schema_version).toBe('1.0.0');
    expect(envelope.clock_uncertainty_ms).toBeGreaterThanOrEqual(0);

    const subject = EventEnvelopeValidator.buildSubject(
      envelope.network,
      envelope.entity_type,
      envelope.event_type
    );
    expect(subject).toBe('btc.bitcoin.mempool.observed');
  });

  it('publishes and delivers events with wildcard matching and deduplication', (done) => {
    const bus = IntelligenceEventBus.getInstance();
    const envelope = EventEnvelopeValidator.createEnvelope({
      event_type: 'observed',
      network: 'bitcoin',
      source_id: 'sensor-test-01',
      entity_type: 'relay',
      entity_id: 'tx-broadcast-01',
      payload: { fee_sats: 1200, vsize: 110 },
    });

    const subject = 'btc.bitcoin.relay.observed';
    const unsubscribe = bus.subscribe('btc.bitcoin.relay.*', (env, ack) => {
      expect(env.entity_id).toBe('tx-broadcast-01');
      ack();
      unsubscribe();
      done();
    });

    bus.publish(subject, envelope);
  });

  it('quarantines malformed envelopes into dead-letter storage', () => {
    const bus = IntelligenceEventBus.getInstance();
    const badEnvelope: any = {
      event_id: '0191ae32-1234-7000-8000-000000000000',
      schema_version: '1.0.0',
      event_type: 'observed',
      network: 'bitcoin',
      source_id: 'sensor-test-01',
      source_sequence: 1,
      observed_at_utc: new Date().toISOString(),
      clock_offset_ms: 0,
      clock_uncertainty_ms: 1,
      entity_type: 'mempool',
      entity_id: 'tx-bad-amount',
      payload_hash: 'dummyhash',
      payload: { fee_sats: 10.5 }, // invalid float
    };

    const published = bus.publish('btc.bitcoin.test.bad', badEnvelope);
    expect(published).toBe(false);

    const deadLetters = bus.getDeadLetterQueue();
    expect(deadLetters.length).toBeGreaterThan(0);
    expect(deadLetters[deadLetters.length - 1].reason).toMatch(/Integer constraint violation/);
  });

  it('authenticates developer API keys and enforces scope validation', async () => {
    useOwnerStore(new MemoryOwnerStore());
    developerIdentity.resetForTests();
    const first = await developerIdentity.bootstrapOwner('Test Owner', '203.0.113.50');
    const owner = (await developerIdentity.authenticateKey(first.secret_key))!;
    const key = await developerIdentity.generateApiKey(owner, 'Test Key', ['read', 'queries']);
    expect(key.secret_key.startsWith('uip_live_')).toBe(true);

    const authValid = await developerIdentity.authenticateKey(key.secret_key, 'read');
    expect(authValid).not.toBeNull();
    expect(authValid?.owner_id).toBe(first.owner_id);

    const authForbiddenScope = await developerIdentity.authenticateKey(key.secret_key, 'node:rpc');
    expect(authForbiddenScope).toBeNull();

    await developerIdentity.revokeApiKey(owner, key.key_id);
    const authRevoked = await developerIdentity.authenticateKey(key.secret_key);
    expect(authRevoked).toBeNull();
  });

  it('enforces SSRF protection blocking private, loopback, and metadata URLs', () => {
    expect(() => validateWebhookUrl('https://127.0.0.1:8080/hook')).toThrow(IdentityError);
    expect(() => validateWebhookUrl('https://localhost:3000/webhook')).toThrow(IdentityError);
    expect(() => validateWebhookUrl('https://169.254.169.254/latest/meta-data/')).toThrow(IdentityError);
    expect(() => validateWebhookUrl('https://10.0.0.5/api')).toThrow(IdentityError);
    expect(() => validateWebhookUrl('https://192.168.1.100/hook')).toThrow(IdentityError);
    expect(() => validateWebhookUrl('http://api.external-auditor.org/webhook')).toThrow(IdentityError);
    expect(validateWebhookUrl('https://api.external-auditor.org/webhook').hostname).toBe('api.external-auditor.org');
  });
});
