import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { convertToParamMap, provideRouter } from '@angular/router';
import {
  provideZonelessChangeDetection,
  ɵresolveComponentResources,
} from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { renderApplication } from '@angular/platform-server';
import { StateService } from '@app/services/state.service';
import { NodeSecurityApiService } from './node-security.service';
import { NodeSecurityEvidenceComponent } from './node-security-evidence.component';
import { NodeSecurityUpgradeComponent } from './node-security-upgrade.component';
import { NodeSecurityReleasesComponent } from './node-security-releases.component';
import {
  NodeSecurityConfigurationComponent,
  LOCAL_RPC_EXAMPLE,
} from './node-security-configuration.component';
import { NodeSecurityArtifactsComponent } from './node-security-artifacts.component';
const state = () => ({
  isBrowser: false,
  network: 'signet',
  networkChanged$: new Subject<string>(),
  env: {
    ROOT_NETWORK: 'mainnet',
    BASE_MODULE: 'mempool',
    NGINX_PROTOCOL: 'http',
    NGINX_HOSTNAME: 'localhost',
    NGINX_PORT: 8999,
  },
});
const route = () => ({
  paramMap: new BehaviorSubject(convertToParamMap({ nodeId: 'first' })),
});
describe('Node security actual backend contracts and stale evidence', () => {
  it('uses selected network/SSR prefix, decodes envelopes, rejects malformed arrays and binds detail identity', () => {
    const http: any = {
        get: vi.fn(() =>
          of({ fleet: [{ node_id: 'a', exposure_status: 'unverifiable' }] })
        ),
      },
      api = new NodeSecurityApiService(http, state() as any);
    let rows: any;
    api.getFleet$().subscribe((v) => (rows = v));
    expect(rows[0].node_id).toBe('a');
    expect(http.get).toHaveBeenCalledWith(
      'http://localhost:8999/signet/api/v1/intelligence/node-security/fleet'
    );
    http.get.mockReturnValue(of([]));
    const err = vi.fn();
    api.getFleet$().subscribe({ error: err });
    expect(err).toHaveBeenCalled();
    http.get.mockReturnValue(of({ node_id: 'wrong' }));
    api.getNode$('a/b').subscribe({ error: err });
    expect(http.get).toHaveBeenLastCalledWith(
      'http://localhost:8999/signet/api/v1/intelligence/node-security/nodes/a%2Fb'
    );
    expect(err).toHaveBeenCalledTimes(2);
  });
  it('clears node record before route/network read and exposes errors, resumes after error, cancels on destroy', () => {
    const network$ = new BehaviorSubject('signet'),
      requests: Subject<any>[] = [],
      r = route();
    const api: any = {
      network$,
      getNode$: vi.fn(() => {
        const s = new Subject();
        requests.push(s);
        return s;
      }),
      getNodeExposures$: () =>
        throwError(() => ({ error: { error: 'Exposure source absent' } })),
    };
    const page = new NodeSecurityEvidenceComponent(
      api,
      r as any,
      { markForCheck: vi.fn() } as any
    );
    page.view = 'node';
    page.ngOnInit();
    requests[0].next({ node_id: 'first' });
    expect(page.vm.data.node_id).toBe('first');
    r.paramMap.next(convertToParamMap({ nodeId: 'second' }));
    expect(page.vm.data).toBeUndefined();
    expect(page.vm.loading).toBe(true);
    requests[0].next({ node_id: 'stale' });
    expect(page.vm.data).toBeUndefined();
    requests[1].error({ error: { error: 'Inventory unavailable' } });
    expect(page.vm.error).toBe('Inventory unavailable');
    network$.next('testnet');
    expect(requests).toHaveLength(3);
    requests[2].next({ node_id: 'second' });
    expect(page.vm.data.node_id).toBe('second');
    page.ngOnDestroy();
    requests[2].next({ node_id: 'after-destroy' });
    expect(page.vm.data.node_id).toBe('second');
  });
  it('requires both upgrade versions and cancels result on edits and network changes', () => {
    const network$ = new Subject<string>(),
      request = new Subject<any>(),
      api: any = { network$, createUpgradePlan$: vi.fn(() => request) },
      page = new NodeSecurityUpgradeComponent(api, {
        markForCheck: vi.fn(),
      } as any);
    page.ngOnInit();
    page.generatePlan();
    expect(api.createUpgradePlan$).not.toHaveBeenCalled();
    page.fromVersion = '28.0';
    page.targetVersion = '29.0';
    page.generatePlan();
    expect(api.createUpgradePlan$).toHaveBeenCalledWith({
      from_version: '28.0',
      target_version: '29.0',
    });
    page.reset();
    request.next({ plan_id: 'stale' });
    expect(page.plan).toBeNull();
    page.generatePlan();
    network$.next('testnet');
    request.next({ plan_id: 'wrong-network' });
    expect(page.plan).toBeNull();
    page.ngOnDestroy();
  });
  it('cannot turn unsupported HTTP200 verification into a Guix verdict and clears pending requests', () => {
    const request = new Subject<any>(),
      api: any = { network$: of('signet'), verifyArtifact$: () => request },
      page = new NodeSecurityArtifactsComponent(api, {
        markForCheck: vi.fn(),
      } as any);
    page.ngOnInit();
    page.sha256 = 'ab'.repeat(32);
    page.verify();
    request.next({ verified: true, state: 'reproducible_build_verified' });
    expect(page.result).toBeNull();
    expect(page.error).toContain('Unsupported');
    page.verify();
    page.reset();
    request.next({ verified: false, state: 'unverified' });
    expect(page.result).toBeNull();
    page.ngOnDestroy();
  });
  it('has no executable shared password, fixed port, daemon or resource assumptions', () => {
    const lines = LOCAL_RPC_EXAMPLE.split('\n').filter(
      (l) => !l.startsWith('#')
    );
    expect(lines).toEqual(['server=1', 'rest=0']);
    expect(lines.some((l) => /rpcpassword|8332|daemon|dbcache/.test(l))).toBe(
      false
    );
  });
  it('renders real release signature state separately from reproducibility and scoped configuration copy', async () => {
    await ɵresolveComponentResources((url) =>
      Promise.resolve(
        readFileSync(resolve('src/app/universe/node-security', url), 'utf8')
      )
    );
    const api: any = {
      network$: of('signet'),
      getReleases$: () =>
        of([
          {
            release_id: 'r',
            project: 'Bitcoin Core',
            version: '29.0',
            release_date_utc: '2025-04-14',
            official_tarball_sha256: 'ab'.repeat(32),
            signature_verified: false,
            eol_status: 'supported',
            release_notes_url: 'https://bitcoincore.org/',
          },
        ]),
    };
    const render = (component: any) =>
      renderApplication(
        (context) =>
          bootstrapApplication(
            component,
            {
              providers: [
                provideZonelessChangeDetection(),
                provideRouter([]),
                { provide: StateService, useValue: state() },
                { provide: NodeSecurityApiService, useValue: api },
              ],
            },
            context
          ),
        {
          allowedHosts: ['localhost'],
          document:
            '<!doctype html><html><body><app-node-security-releases></app-node-security-releases><app-node-security-configuration></app-node-security-configuration></body></html>',
          url: 'http://localhost/',
        }
      );
    const html = await render(NodeSecurityReleasesComponent);
    expect(html).toContain('Release signature: Not verified');
    expect(html).toContain('not established by this release record');
    expect(html).not.toContain('100% REPRODUCED');
    const config = await render(NodeSecurityConfigurationComponent);
    expect(config).toContain('not an audit');
    expect(config).not.toContain('rpcpassword=');
  });
});
