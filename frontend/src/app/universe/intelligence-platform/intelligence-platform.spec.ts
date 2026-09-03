import { describe, it, expect } from 'vitest';
import { of } from 'rxjs';
import { IntelligenceApiService } from './intelligence-api.service';

describe('Unified Intelligence Platform Frontend Services', () => {
  const recordedCalls: Array<{ method: string; url: string; body?: any }> = [];

  const mockHttp: any = {
    get: (url: string) => {
      recordedCalls.push({ method: 'GET', url });
      if (url.includes('/relay/overview')) {
        return of({ fleet_size: 4 });
      }
      if (url.includes('/history/coverage')) {
        return of({ total_checkpoints: 5 });
      }
      if (url.includes('/utxo/overview')) {
        return of({ total_utxos: 175420100 });
      }
      if (url.includes('/watchlists')) {
        return of({ watchlists: [{ name: 'Vault' }] });
      }
      if (url.includes('/protocols')) {
        return of({ protocols: [{ protocol_id: 'ordinals' }] });
      }
      return of({ ok: true });
    },
    post: (url: string, body: any) => {
      recordedCalls.push({ method: 'POST', url, body });
      if (url.includes('/policy/evaluations')) {
        return of({ package_report: { overall_allowed: true } });
      }
      if (url.includes('/history/replays')) {
        return of({ target_block_height: body.block_height });
      }
      if (url.includes('/graph/queries')) {
        return of({ root_entity: body.root_entity });
      }
      if (url.includes('/workbench/script/analyze')) {
        return of({ is_standard: true });
      }
      if (url.includes('/query/execute')) {
        return of({ row_count: 10 });
      }
      if (url.includes('/protocols/decode')) {
        return of({ decoded: [{ protocol_id: 'runes' }] });
      }
      return of({ ok: true, body });
    },
  };

  const mockStateService: any = {
    isBrowser: true,
    env: {
      NGINX_PROTOCOL: 'http',
      NGINX_HOSTNAME: 'localhost',
      NGINX_PORT: 8080,
    },
  };

  const service = new IntelligenceApiService(mockHttp, mockStateService);

  it('evaluates transaction packages via POST /api/v1/intelligence/policy/evaluations', () => {
    const rawTxs = ['020000000100...'];
    service.evaluatePackage$(rawTxs).subscribe((res) => {
      expect(res.package_report.overall_allowed).toBe(true);
    });

    const call = recordedCalls[recordedCalls.length - 1];
    expect(call.method).toBe('POST');
    expect(call.url).toContain('/api/v1/intelligence/policy/evaluations');
    expect(call.body.transactions).toEqual(rawTxs);
  });

  it('fetches relay overview via GET /api/v1/intelligence/relay/overview', () => {
    service.getRelayOverview$().subscribe((res) => {
      expect(res.fleet_size).toBe(4);
    });

    const call = recordedCalls[recordedCalls.length - 1];
    expect(call.method).toBe('GET');
    expect(call.url).toContain('/api/v1/intelligence/relay/overview');
  });

  it('replays mempool state via POST /api/v1/intelligence/history/replays', () => {
    service.replayHistory$(undefined, 860020).subscribe((res) => {
      expect(res.target_block_height).toBe(860020);
    });

    const call = recordedCalls[recordedCalls.length - 1];
    expect(call.method).toBe('POST');
    expect(call.url).toContain('/api/v1/intelligence/history/replays');
    expect(call.body.block_height).toBe(860020);
  });

  it('queries multi-hop transaction graph via POST /api/v1/intelligence/graph/queries', () => {
    service.queryGraph$('tx123', 2, 'both', 5000).subscribe((res) => {
      expect(res.root_entity).toBe('tx123');
    });

    const call = recordedCalls[recordedCalls.length - 1];
    expect(call.method).toBe('POST');
    expect(call.url).toContain('/api/v1/intelligence/graph/queries');
    expect(call.body.root_entity).toBe('tx123');
  });

  it('analyzes scripts via POST /api/v1/intelligence/workbench/script/analyze', () => {
    service.analyzeScript$('0014...').subscribe((res) => {
      expect(res.is_standard).toBe(true);
    });

    const call = recordedCalls[recordedCalls.length - 1];
    expect(call.method).toBe('POST');
    expect(call.url).toContain('/api/v1/intelligence/workbench/script/analyze');
  });

  it('executes sandboxed developer queries via POST /api/v1/intelligence/query/execute', () => {
    service.executeDevQuery$('SELECT * FROM mempool_transactions').subscribe((res) => {
      expect(res.row_count).toBe(10);
    });

    const call = recordedCalls[recordedCalls.length - 1];
    expect(call.method).toBe('POST');
    expect(call.url).toContain('/api/v1/intelligence/query/execute');
  });

  it('manages privacy-first watchlists via /api/v1/intelligence/watchlists', () => {
    service.getWatchlists$('user-1').subscribe((res) => {
      expect(res.watchlists.length).toBe(1);
    });

    const call = recordedCalls[recordedCalls.length - 1];
    expect(call.method).toBe('GET');
    expect(call.url).toContain('/api/v1/intelligence/watchlists');
  });

  it('decodes protocol payloads via POST /api/v1/intelligence/protocols/decode', () => {
    service.decodeProtocolPayload$('6a5d04140105e80702').subscribe((res) => {
      expect(res.decoded.length).toBe(1);
    });

    const call = recordedCalls[recordedCalls.length - 1];
    expect(call.method).toBe('POST');
    expect(call.url).toContain('/api/v1/intelligence/protocols/decode');
  });
});
