import { describe, it, expect } from 'vitest';
import { of, throwError } from 'rxjs';
import { IntelligenceApiService } from './intelligence-api.service';
import { PolicyLabComponent } from './policy-lab.component';
import { ScriptWorkbenchComponent } from './script-workbench.component';
import { VerifyProofComponent } from './verify-proof.component';
import { RelayObservatoryComponent } from './relay-observatory.component';
import { TimeMachineComponent } from './time-machine.component';
import { MiningTemplatesComponent } from './mining-templates.component';
import { UtxoIntelligenceComponent } from './utxo-intelligence.component';
import { TransactionGraphComponent } from './transaction-graph.component';
import { IncidentCenterComponent } from './incident-center.component';
import { KnowledgeRegistryComponent } from './knowledge-registry.component';
import { DeveloperPlatformComponent } from './developer-platform.component';
import { QueryStudioComponent } from './query-studio.component';
import { WatchlistsComponent } from './watchlists.component';
import { ProtocolExplorerComponent } from './protocol-explorer.component';

describe('Unified Intelligence Platform Frontend Services', () => {
  const recordedCalls: Array<{ method: string; url: string; body?: any }> = [];

  const mockHttp: any = {
    get: (url: string) => {
      recordedCalls.push({ method: 'GET', url });
      if (url.includes('/relay/overview')) {
        return of({ fleet_size: 4, online_sensor_regions_count: 4 });
      }
      if (url.includes('/history/coverage')) {
        return of({ total_checkpoints: 5 });
      }
      if (url.includes('/utxo/overview')) {
        return of({ total_utxos: 175420100, block_height: 887412 });
      }
      if (url.includes('/watchlists')) {
        return of({ watchlists: [{ name: 'Vault', privacy_mode: 'blinded' }] });
      }
      if (url.includes('/protocols')) {
        return of({ protocols: [{ name: 'Ordinals', active: true }] });
      }
      if (url.includes('/templates/overview')) {
        return of({ sources: [{ name: 'Core GBT' }], latest_templates: [{ template_id: 't1' }, { template_id: 't2' }] });
      }
      if (url.includes('/incidents')) {
        return of({ incidents: [] });
      }
      if (url.includes('/knowledge/labels')) {
        return of({ labels: [{ name: 'Exchange A', status: 'verified', confidence_level: 3 }] });
      }
      if (url.includes('/developer/keys')) {
        return of({ keys: [], usage: { monthly_requests: 100 } });
      }
      if (url.includes('/query/schema')) {
        return of({ tables: [{ table_name: 'mempool_transactions' }] });
      }
      return of({ ok: true });
    },
    post: (url: string, body: any) => {
      recordedCalls.push({ method: 'POST', url, body });
      if (url.includes('/policy/evaluations')) {
        return of({ package_report: { overall_allowed: true } });
      }
      if (url.includes('/history/replays')) {
        return of({ target_block_height: body.block_height, state_hash: 'abc123' });
      }
      if (url.includes('/graph/queries')) {
        return of({ root_entity: body.root_entity, nodes: [], edges: [] });
      }
      if (url.includes('/workbench/script/analyze')) {
        return of({ is_standard: true });
      }
      if (url.includes('/query/execute')) {
        return of({ row_count: 10, rows: [], columns: [] });
      }
      if (url.includes('/protocols/decode')) {
        return of({ decoded: [{ protocol_name: 'Runes', operation_type: 'edicts' }] });
      }
      if (url.includes('/proofs/spv')) {
        return of({ tx_index: 2, merkle_root: 'root123', hashes: [] });
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
  const mockCdr: any = { markForCheck: () => {} };

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

  // Component rendering and lifecycle assertions
  describe('Component Lifecycle and State Verification', () => {
    it('PolicyLabComponent: does not evaluate transactions on ngOnInit', () => {
      const cmp = new PolicyLabComponent(service, mockCdr);
      cmp.ngOnInit();
      expect(cmp.evaluationResult).toBeNull();
      expect(cmp.loading).toBe(false);
      expect(cmp.rawTransactionsInput).toBe('');
    });

    it('ScriptWorkbenchComponent: does not analyze script on ngOnInit', () => {
      const cmp = new ScriptWorkbenchComponent(service, mockCdr);
      cmp.ngOnInit();
      expect(cmp.scriptResult).toBeNull();
      expect(cmp.loading).toBe(false);
      expect(cmp.scriptInput).toBe('');
    });

    it('VerifyProofComponent: does not generate SPV proof on ngOnInit', () => {
      const cmp = new VerifyProofComponent(service, mockCdr);
      cmp.ngOnInit();
      expect(cmp.spvResult).toBeNull();
      expect(cmp.loadingSpv).toBe(false);
      expect(cmp.spvTxid).toBe('');
      expect(cmp.spvBlockHash).toBe('');
    });

    it('TimeMachineComponent: does not trigger replay on ngOnInit', () => {
      const cmp = new TimeMachineComponent(service, mockCdr);
      cmp.ngOnInit();
      expect(cmp.currentState).toBeNull();
      expect(cmp.loading).toBe(false);
      expect(cmp.targetHeight).toBeNull();
    });

    it('TransactionGraphComponent: does not expand graph on ngOnInit', () => {
      const cmp = new TransactionGraphComponent(service, mockCdr);
      cmp.ngOnInit();
      expect(cmp.activeResult).toBeNull();
      expect(cmp.loading).toBe(false);
      expect(cmp.rootEntity).toBe('');
    });

    it('QueryStudioComponent: does not execute query on ngOnInit', () => {
      const cmp = new QueryStudioComponent(service, mockCdr);
      cmp.ngOnInit();
      expect(cmp.queryResult).toBeNull();
      expect(cmp.loading).toBe(false);
      expect(cmp.sqlQuery).toBe('');
    });

    it('ProtocolExplorerComponent: does not decode payload on ngOnInit', () => {
      const cmp = new ProtocolExplorerComponent(service, mockCdr);
      cmp.ngOnInit();
      expect(cmp.decodedResults).toEqual([]);
      expect(cmp.decoding).toBe(false);
      expect(cmp.decodeInput).toBe('');
    });

    it('RelayObservatoryComponent: populates overview without hardcoded sensor counts', () => {
      const cmp = new RelayObservatoryComponent(service, mockCdr);
      cmp.ngOnInit();
      expect(cmp.overview).toBeDefined();
      expect(cmp.overview.online_sensor_regions_count).toBe(4);
      expect(cmp.activeLifecycle).toBeNull();
    });

    it('MiningTemplatesComponent: loads sources and does not auto-diff', () => {
      const cmp = new MiningTemplatesComponent(service, mockCdr);
      cmp.ngOnInit();
      expect(cmp.overview).toBeDefined();
      expect(cmp.activeDiff).toBeNull();
    });

    it('UtxoIntelligenceComponent: binds block height from overview', () => {
      const cmp = new UtxoIntelligenceComponent(service, mockCdr);
      cmp.ngOnInit();
      expect(cmp.overview).toBeDefined();
      expect(cmp.overview.block_height).toBe(887412);
    });

    it('IncidentCenterComponent: tracks active divergences dynamically', () => {
      const cmp = new IncidentCenterComponent(service, mockCdr);
      cmp.ngOnInit();
      expect(cmp.incidents).toEqual([]);
      expect(cmp.activeIncidentsCount).toBe(0);
    });

    it('KnowledgeRegistryComponent: computes verified count and filters', () => {
      const cmp = new KnowledgeRegistryComponent(service, mockCdr);
      cmp.ngOnInit();
      expect(cmp.labels.length).toBe(1);
      expect(cmp.verifiedCount).toBe(1);
      cmp.searchFilter = 'nonexistent';
      expect(cmp.filteredLabels.length).toBe(0);
    });

    it('DeveloperPlatformComponent: handles empty keys and provisions new keys', () => {
      const cmp = new DeveloperPlatformComponent(service, mockCdr);
      cmp.ngOnInit();
      expect(cmp.keys).toEqual([]);
      cmp.newKeyLabel = 'Test Key';
      cmp.createKey();
      expect(cmp.generatedKeySecret).toBeDefined();
    });

    it('WatchlistsComponent: supports local sample watchlist creation', () => {
      const cmp = new WatchlistsComponent(service, mockCdr);
      cmp.ngOnInit();
      expect(cmp.watchlists.length).toBe(1);
      cmp.createSampleWatchlist();
      expect(cmp.watchlists[0].name).toBe('Cold Storage Vault Monitoring');
    });
  });
});
