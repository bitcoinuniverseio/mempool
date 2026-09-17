import { PrivateRelayEndpoint, PrivateRelayEndpointIssue, PrivateRelayEndpointSet } from './private-relay.types';

/**
 * Reads the owned relay endpoints from UNIVERSE_PRIVATE_RELAY_ENDPOINTS.
 *
 * The value is a JSON array of
 *   { id, transport: 'tor' | 'i2p', proxy: 'socks5h://host:port',
 *     submitUrl: 'http://<owned>.onion/api/tx', network, timeoutMs? }
 *
 * Every entry is checked against the backend's own network, and the submit
 * host must be an onion or i2p name so that a misconfiguration cannot turn
 * the private path into a clearnet post to somebody else's broadcaster. An
 * entry that fails is reported by id with its reason and never used.
 */
export const PRIVATE_RELAY_ENDPOINTS_ENV = 'UNIVERSE_PRIVATE_RELAY_ENDPOINTS';

const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_ENDPOINTS = 16;

export function parsePrivateRelayEndpoints(value: string | undefined, network: string): PrivateRelayEndpointSet {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return { endpoints: [], issues: [], unconfigured: true };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { endpoints: [], issues: [{ id: '*', reason: 'not-json' }], unconfigured: false };
  }
  if (!Array.isArray(parsed)) {
    return { endpoints: [], issues: [{ id: '*', reason: 'not-an-array' }], unconfigured: false };
  }
  if (parsed.length > MAX_ENDPOINTS) {
    return { endpoints: [], issues: [{ id: '*', reason: 'too-many-endpoints' }], unconfigured: false };
  }
  const endpoints: PrivateRelayEndpoint[] = [];
  const issues: PrivateRelayEndpointIssue[] = [];
  const seen = new Set<string>();
  parsed.forEach((entry, index) => {
    const result = parseEndpoint(entry, network);
    const id = typeof entry?.id === 'string' && entry.id ? String(entry.id).slice(0, 64) : `#${index}`;
    if ('reason' in result) {
      issues.push({ id, reason: result.reason });
      return;
    }
    if (seen.has(result.endpoint.id)) {
      issues.push({ id, reason: 'duplicate-id' });
      return;
    }
    seen.add(result.endpoint.id);
    endpoints.push(result.endpoint);
  });
  return { endpoints, issues, unconfigured: false };
}

function parseEndpoint(entry: any, network: string): { endpoint: PrivateRelayEndpoint } | { reason: string } {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { reason: 'not-an-object' };
  if (typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.id)) return { reason: 'invalid-id' };
  if (entry.transport !== 'tor' && entry.transport !== 'i2p') return { reason: 'invalid-transport' };
  if (typeof entry.network !== 'string' || entry.network !== network) return { reason: 'network-mismatch' };

  let proxy: URL;
  try {
    proxy = new URL(String(entry.proxy));
  } catch {
    return { reason: 'invalid-proxy' };
  }
  if (!['socks5h:', 'socks5:', 'socks:'].includes(proxy.protocol) || !proxy.hostname || !proxy.port || (proxy.pathname !== '' && proxy.pathname !== '/') || proxy.search || proxy.hash) {
    return { reason: 'invalid-proxy' };
  }

  let submitUrl: URL;
  try {
    submitUrl = new URL(String(entry.submitUrl));
  } catch {
    return { reason: 'invalid-submit-url' };
  }
  if (!['http:', 'https:'].includes(submitUrl.protocol) || submitUrl.username || submitUrl.password || submitUrl.hash) {
    return { reason: 'invalid-submit-url' };
  }
  const host = submitUrl.hostname.toLowerCase();
  const expectedSuffix = entry.transport === 'tor' ? '.onion' : '.i2p';
  if (!host.endsWith(expectedSuffix)) return { reason: 'submit-host-not-' + entry.transport };

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (entry.timeoutMs !== undefined) {
    if (typeof entry.timeoutMs !== 'number' || !Number.isInteger(entry.timeoutMs) || entry.timeoutMs < MIN_TIMEOUT_MS || entry.timeoutMs > MAX_TIMEOUT_MS) {
      return { reason: 'invalid-timeout' };
    }
    timeoutMs = entry.timeoutMs;
  }

  return {
    endpoint: {
      id: entry.id,
      transport: entry.transport,
      proxy: proxy.toString(),
      submitUrl: submitUrl.toString(),
      network: entry.network,
      timeoutMs,
    },
  };
}

/** Which transport a submission method asks for; null when the method is not a private relay method. */
export function transportForMethod(method: string): PrivateRelayEndpoint['transport'] | 'any' | null {
  switch (method) {
    case 'privatebroadcast_tor': return 'tor';
    case 'privatebroadcast_i2p': return 'i2p';
    case 'configured_private_relay': return 'any';
    default: return null;
  }
}

export function endpointsForTransport(endpoints: PrivateRelayEndpoint[], transport: PrivateRelayEndpoint['transport'] | 'any'): PrivateRelayEndpoint[] {
  return transport === 'any' ? endpoints : endpoints.filter(endpoint => endpoint.transport === transport);
}
