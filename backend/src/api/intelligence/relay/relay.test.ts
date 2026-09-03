import { relayCollectorService } from './relay-collector.service';

describe('Product 2: Distributed Relay and Policy Observatory', () => {
  it('retrieves global sensor fleet with deployment regions and clock uncertainties', () => {
    const sensors = relayCollectorService.getSensors();
    expect(sensors.length).toBeGreaterThanOrEqual(4);

    for (const sensor of sensors) {
      expect(sensor.id).toBeDefined();
      expect(sensor.region).toBeDefined();
      expect(sensor.clock_uncertainty_ms).toBeGreaterThanOrEqual(0);
      expect(typeof sensor.clock_offset_ms).toBe('number');
      expect(sensor.status).toBe('online');
    }
  });

  it('correlates transaction propagation across multiple staging sensors with percentiles', () => {
    const txid = '3b8908fef9b8098c772274b7c1265882e70c8cf865d1d6cb58a74e54e44f479d';
    const baseTime = Date.now() - 10000;

    // Sensor 1: US-East (first seen, 0ms delta)
    relayCollectorService.recordSensorObservation(
      txid,
      'sensor-us-east-01',
      new Date(baseTime).toISOString(),
      true,
      'bip324'
    );

    // Sensor 2: EU-Central (80ms delta)
    relayCollectorService.recordSensorObservation(
      txid,
      'sensor-eu-central-01',
      new Date(baseTime + 80).toISOString(),
      true,
      'bip324'
    );

    // Sensor 3: SA-East (150ms delta)
    relayCollectorService.recordSensorObservation(
      txid,
      'sensor-sa-east-01',
      new Date(baseTime + 150).toISOString(),
      true,
      'bip324'
    );

    // Sensor 4: AP-Southeast (220ms delta)
    const lifecycle = relayCollectorService.recordSensorObservation(
      txid,
      'sensor-ap-se-01',
      new Date(baseTime + 220).toISOString(),
      true,
      'legacy'
    );

    expect(lifecycle.observations.length).toBe(4);
    expect(lifecycle.latency_percentiles.p50_ms).toBeGreaterThan(0);
    expect(lifecycle.latency_percentiles.p100_ms).toBe(220);
    expect(lifecycle.spread_delta_ms).toBe(220);
    expect(lifecycle.bip324_ratio).toBe(0.75); // 3 of 4 sensors were BIP324
  });

  it('deduplicates redelivered observations from the same sensor', () => {
    const txid = '3b8908fef9b8098c772274b7c1265882e70c8cf865d1d6cb58a74e54e44f479d';
    const initialCount = relayCollectorService.getPropagationForTx(txid).observations.length;

    // Re-record for sensor-us-east-01
    relayCollectorService.recordSensorObservation(
      txid,
      'sensor-us-east-01',
      new Date().toISOString(),
      true,
      'bip324'
    );

    const afterCount = relayCollectorService.getPropagationForTx(txid).observations.length;
    expect(afterCount).toBe(initialCount);
  });

  it('strictly preserves peer privacy: zero peer IP addresses or peer identifiers exposed', () => {
    const overview = relayCollectorService.getOverview();
    const serialized = JSON.stringify(overview);

    // Check for IP regexes
    const ipv4Regex = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/;
    expect(ipv4Regex.test(serialized)).toBe(false);

    expect(serialized).not.toContain('peer_ip');
    expect(serialized).not.toContain('remote_addr');
    expect(serialized).not.toContain('peer_id');
  });

  it('measures BIP324 transport adoption and states Erlay capability accurately', () => {
    const metrics = relayCollectorService.getTransportMetrics();
    expect(metrics.total_peers).toBeGreaterThan(0);
    expect(metrics.bip324_peers).toBeGreaterThan(0);
    expect(metrics.bip324_percent).toBeGreaterThan(0);
    expect(metrics.bip324_percent).toBeLessThanOrEqual(100);
    expect(metrics.erlay_status).toBe('unsupported'); // Erlay unsupported in Core 27
  });

  it('exposes active policy differences across sensor nodes', () => {
    const diffs = relayCollectorService.getPolicyDifferences();
    expect(diffs.length).toBeGreaterThanOrEqual(1);
    const fullRbfDiff = diffs.find((d) => d.policy === 'mempoolfullrbf');
    expect(fullRbfDiff).toBeDefined();
    expect(fullRbfDiff?.nodes_aligned.length).toBeGreaterThan(0);
    expect(fullRbfDiff?.nodes_divergent).toContain('sensor-ap-se-01');
  });
});
