import axios, { AxiosError } from 'axios';
import * as net from 'net';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { PrivateRelayEndpoint, PrivateRelayOutcome, PrivateRelayTransportAdapter } from './private-relay.types';

/**
 * Posts a raw transaction to an owned onion or i2p endpoint through the owned
 * SOCKS proxy. The contract is the one the explorer's own /api/tx and every
 * esplora/electrs instance accept: the hex as a text/plain body, the txid back
 * as text on 200, the node's rejection reason as text on 400.
 *
 * Nothing about the transaction is logged. The outcome carries only a bounded
 * reason string derived from the status or the error code.
 */
const MAX_REASON = 200;

export class SocksPrivateRelayTransport implements PrivateRelayTransportAdapter {
  /** @asyncUnsafe Every failure is folded into the returned outcome. */
  public async submit(endpoint: PrivateRelayEndpoint, rawTx: string, expectedTxid: string): Promise<PrivateRelayOutcome> {
    const agent = new SocksProxyAgent(endpoint.proxy, { timeout: endpoint.timeoutMs });
    try {
      const response = await axios.post(endpoint.submitUrl, rawTx, {
        headers: { 'Content-Type': 'text/plain', 'User-Agent': 'universe-private-relay' },
        httpAgent: agent,
        httpsAgent: agent,
        proxy: false,
        timeout: endpoint.timeoutMs,
        maxRedirects: 0,
        maxContentLength: 4096,
        maxBodyLength: rawTx.length + 64,
        responseType: 'text',
        transformResponse: [(data) => data],
        validateStatus: () => true,
      });
      return classifyResponse(response.status, response.data, expectedTxid);
    } catch (error) {
      return { kind: 'unreachable', reason: describeTransportError(error) };
    }
  }

  /** @asyncUnsafe Every failure is folded into the returned boolean. */
  public async probeProxy(endpoint: PrivateRelayEndpoint): Promise<boolean> {
    let proxy: URL;
    try {
      proxy = new URL(endpoint.proxy);
    } catch {
      return false;
    }
    return new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: proxy.hostname, port: Number(proxy.port) });
      const done = (ok: boolean): void => { socket.destroy(); resolve(ok); };
      socket.setTimeout(Math.min(endpoint.timeoutMs, 5_000));
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
    });
  }
}

export function classifyResponse(status: number, body: unknown, expectedTxid: string): PrivateRelayOutcome {
  const text = typeof body === 'string' ? body.trim() : '';
  if (status >= 200 && status < 300) {
    const returned = text.toLowerCase();
    if (/^[0-9a-f]{64}$/.test(returned)) {
      if (returned !== expectedTxid) {
        return { kind: 'rejected', reason: 'endpoint-returned-different-txid', httpStatus: status };
      }
      return { kind: 'submitted', txid: returned, httpStatus: status };
    }
    // An owned endpoint that answers 2xx without a txid did accept the body;
    // the confirmation tracker decides what became of it.
    return { kind: 'submitted', txid: expectedTxid, httpStatus: status };
  }
  if (status === 400 || status === 422) {
    return { kind: 'rejected', reason: boundedReason(text || `http-${status}`), httpStatus: status };
  }
  return { kind: 'unreachable', reason: `http-${status}` };
}

export function describeTransportError(error: unknown): string {
  const axiosError = error as AxiosError;
  if (axiosError?.code) return boundedReason(String(axiosError.code).toLowerCase());
  if (error instanceof Error && error.message) return boundedReason(error.message.replace(/[0-9a-f]{64,}/gi, '<hex>'));
  return 'transport-error';
}

function boundedReason(reason: string): string {
  return reason.replace(/\s+/g, ' ').slice(0, MAX_REASON);
}
