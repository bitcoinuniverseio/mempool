import { NatsJetStreamEventBusProvider } from './intelligence-event-bus';
import { EventEnvelopeValidator } from './event-envelope';
import config from '../../../config';

// Run only against an explicitly provided disposable, authenticated broker.
const integration = process.env.NATS_QUALIFICATION_URL ? describe : describe.skip;
integration('actual JetStream qualification', () => {
  jest.setTimeout(25000);
  it('refuses altered persisted nested events without silently omitting or deleting their history', async () => {
    const { connect } = require('@nats-io/transport-node'), { jetstream, jetstreamManager } = require('@nats-io/jetstream');
    const client = await connect({ servers: process.env.NATS_QUALIFICATION_URL, user: process.env.NATS_USER, pass: process.env.NATS_PASSWORD });
    const provider = new NatsJetStreamEventBusProvider(process.env.NATS_QUALIFICATION_URL!);
    const network = config.MEMPOOL.NETWORK, subject = `btc.${network}.integrity_${Date.now().toString(36)}.observed`;
    const envelope = EventEnvelopeValidator.createEnvelope({ network, source_id: 'controlled-integrity', event_type: 'observed',
      entity_type: 'template', entity_id: 'controlled', payload: { template: { height: 3186, total_fees_sats: 100 } } });
    envelope.payload.template.height = 3187;
    try {
      expect(await provider.connect()).toBe(true);
      expect(await provider.publish(subject, envelope)).toBe(false);
      const bytes = Buffer.from(JSON.stringify(envelope));
      await jetstream(client).publish(subject, bytes);
      await expect(provider.replayRecent(subject)).rejects.toThrow(/invalid or unverifiable/);
      const manager = await jetstreamManager(client);
      const retained = await manager.streams.getMessage('INTELLIGENCE_' + network.toUpperCase(), { last_by_subj: subject });
      expect(Buffer.from(retained.data).equals(bytes)).toBe(true);
    } finally { await provider.drain(); await client.drain(); }
  });
  it('refuses an existing durable whose acknowledgement contract can discard consumer effects', async () => {
    const {connect}=require('@nats-io/transport-node'),{jetstreamManager}=require('@nats-io/jetstream');
    const client=await connect({servers:process.env.NATS_QUALIFICATION_URL,user:process.env.NATS_USER,pass:process.env.NATS_PASSWORD});
    const provider=new NatsJetStreamEventBusProvider(process.env.NATS_QUALIFICATION_URL!);
    const suffix=Date.now().toString(36),durableName='incompatible_'+suffix,network=config.MEMPOOL.NETWORK,subject=`btc.${network}.incompatible_${suffix}.observed`;
    try {
      expect(await provider.connect()).toBe(true);
      const manager=await jetstreamManager(client);
      await manager.consumers.add('INTELLIGENCE_'+network.toUpperCase(),{durable_name:durableName,filter_subject:subject,ack_policy:'none',deliver_policy:'all'});
      await expect(provider.subscribe(subject,jest.fn(),{durableName})).rejects.toThrow('Incompatible consumer delivery contract');
      await expect(provider.subscribe(subject,jest.fn(),{maxRetries:NaN})).rejects.toThrow('Invalid consumer retry bound');
    } finally { await provider.drain();await client.drain(); }
  });
  it('quarantines malformed persisted bytes after bounded retries and records the broker receipt', async () => {
    const { connect } = require('@nats-io/transport-node');
    const { jetstream, jetstreamManager } = require('@nats-io/jetstream');
    const client = await connect({ servers: process.env.NATS_QUALIFICATION_URL, user: process.env.NATS_USER, pass: process.env.NATS_PASSWORD });
    const provider = new NatsJetStreamEventBusProvider(process.env.NATS_QUALIFICATION_URL!);
    const suffix = Date.now().toString(36), durableName = `malformed_${suffix}`;
    const network = config.MEMPOOL.NETWORK, stream = 'INTELLIGENCE_' + network.toUpperCase();
    const subject = `btc.${network}.malformed_${suffix}.observed`;
    let stop: () => void = () => undefined;
    try {
      expect(await provider.connect()).toBe(true);
      const manager = await jetstreamManager(client);
      await jetstream(client).publish(subject, Buffer.from('{malformed'), { msgID: durableName });
      const handler = jest.fn();
      stop = await provider.subscribe(subject, handler, { durableName, maxRetries: 0 });
      let quarantined: any;
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        try {
          const message = await manager.streams.getMessage(stream, { last_by_subj: `btc.${network}.deadletter.failed` });
          if (message) {
            const record = JSON.parse(Buffer.from(message.data).toString());
            if (record.consumer === durableName) { quarantined = record; break; }
          }
        } catch (error) { if ((error as any).apiError?.()?.code !== 404) throw error; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      expect(quarantined).toMatchObject({ consumer: durableName, source_subject: subject, reason: 'consumer_retry_limit' });
      expect(quarantined.payload_digest).toMatch(/^[a-f0-9]{64}$/);
      expect(handler).not.toHaveBeenCalled();
    } finally { stop(); await provider.drain(); await client.drain(); }
  });
  it('requires broker receipts, isolates networks and resumes an unacknowledged durable delivery', async () => {
    const url = process.env.NATS_QUALIFICATION_URL!;
    const network = config.MEMPOOL.NETWORK;
    const suffix = Date.now().toString(36);
    const subject = `btc.${network}.qualification_${suffix}.observed`;
    const durableName = `qualification_${suffix}`;
    const event = EventEnvelopeValidator.createEnvelope({ network, event_type: 'observed', entity_type: 'template', entity_id: suffix, source_id: 'qualification', payload: { test: true } });
    const first = new NatsJetStreamEventBusProvider(url);
    const second = new NatsJetStreamEventBusProvider(url);
    const offline = new NatsJetStreamEventBusProvider('nats://127.0.0.1:1');
    expect(await offline.connect()).toBe(false);
    expect(await first.publish(`btc.foreign.qualification_${suffix}.observed`, event)).toBe(false);
    expect(await first.publish(subject, event)).toBe(true);
    expect(await first.publish(subject, event)).toBe(true);
    let stopFirst: () => void = () => undefined;
    let stopSecond: () => void = () => undefined;
    const bounded = <T>(promise: Promise<T>) => Promise.race([promise, new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Actual broker delivery timed out')), 10000);
      promise.finally(() => clearTimeout(timer)).catch(() => undefined);
    })]);
    try {
      let failed!: () => void;
      const firstDelivery = new Promise<void>(resolve => failed = resolve);
      stopFirst = await first.subscribe(subject, () => { failed(); }, { durableName });
      await bounded(firstDelivery);
      stopFirst();
      await first.drain();
      let completed!: () => void;
      let deliveries = 0;
      const secondDelivery = new Promise<void>(resolve => completed = resolve);
      stopSecond = await second.subscribe(subject, (actual, ack) => {
        expect(actual.event_id).toBe(event.event_id);
        deliveries++;
        ack();
        completed();
      }, { durableName });
      await bounded(secondDelivery);
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(deliveries).toBe(1);
      expect(await second.diagnostics()).toMatchObject({ available: true, network, consumers: [{ name: durableName, pending: 0, ack_pending: 0 }] });
    } finally {
      stopFirst(); stopSecond();
      await first.drain(); await second.drain();
    }
  });
});
