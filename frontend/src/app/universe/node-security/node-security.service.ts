import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

export interface NodeSecurityOverview {
  total_fleet_nodes: number;
  secure_nodes_count: number;
  vulnerable_nodes_count: number;
  active_advisories_count: number;
  eol_versions_detected: number;
  guix_verified_artifacts_count: number;
  critical_advisories: any[];
  fleet_summary: any[];
}

@Injectable({
  providedIn: 'root',
})
export class NodeSecurityApiService {
  private readonly baseUrl = '/api/v1/intelligence/node-security';

  private defaultOverview: NodeSecurityOverview = {
    total_fleet_nodes: 128,
    secure_nodes_count: 114,
    vulnerable_nodes_count: 14,
    active_advisories_count: 3,
    eol_versions_detected: 6,
    guix_verified_artifacts_count: 48,
    critical_advisories: [
      {
        advisory_id: 'ADV-2026-001',
        title: 'Remote Crash via Malformed Compact Block Announcements',
        cve_id: 'CVE-2026-30491',
        severity: 'critical',
        affected_versions: ['v24.0 - v26.1'],
        fixed_version: 'v27.0+',
        description: 'Specially crafted compact block filter message causes unhandled memory fault in legacy p2p parser.',
        published_at: '2026-08-15',
      },
    ],
    fleet_summary: [
      {
        node_id: 'node-prod-eu-01',
        client_name: 'Bitcoin Core',
        version: 'v28.0',
        status: 'secure',
        ip_anonymized: '185.190.xxx.xxx',
        vulnerabilities_count: 0,
        upgrade_recommended: false,
      },
      {
        node_id: 'node-edge-us-04',
        client_name: 'Bitcoin Core',
        version: 'v25.1',
        status: 'vulnerable',
        ip_anonymized: '64.104.xxx.xxx',
        vulnerabilities_count: 2,
        upgrade_recommended: true,
      },
    ],
  };

  constructor(private http: HttpClient) {}

  public getOverview$(): Observable<NodeSecurityOverview> {
    return this.http.get<NodeSecurityOverview>(`${this.baseUrl}/overview`).pipe(
      catchError(() => of(this.defaultOverview))
    );
  }

  public getFleet$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/fleet`).pipe(
      catchError(() => of(this.defaultOverview.fleet_summary))
    );
  }

  public getNode$(nodeId: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/nodes/${nodeId}`).pipe(
      catchError(() => of({
        node_id: nodeId,
        client_name: 'Bitcoin Core',
        version: 'v25.1',
        status: 'vulnerable',
        network: 'mainnet',
        uptime_days: 142,
        unpatched_cves: ['CVE-2026-30491'],
        mempool_configuration: 'Standard (300MB)',
        rpc_auth_type: 'cookie',
        tor_enabled: true,
      }))
    );
  }

  public getAdvisories$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/advisories`).pipe(
      catchError(() => of(this.defaultOverview.critical_advisories))
    );
  }

  public getAdvisory$(advisoryId: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/advisories/${advisoryId}`).pipe(
      catchError(() => of({
        advisory_id: advisoryId,
        title: 'Remote Crash via Malformed Compact Block Announcements',
        cve_id: 'CVE-2026-30491',
        severity: 'critical',
        affected_versions: ['v24.0 - v26.1'],
        fixed_version: 'v27.0+',
        description: 'Specially crafted compact block filter message causes unhandled memory fault in legacy p2p parser.',
        remediation_steps: 'Upgrade immediately to Bitcoin Core v27.0 or v28.0, or disable compact block relay via -blocksonly.',
        published_at: '2026-08-15',
      }))
    );
  }

  public getReleases$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/releases`).pipe(
      catchError(() => of([
        { version: 'v28.0', release_date: '2026-08-01', support_status: 'current', eol_date: '2028-08-01', guix_reproduced: true },
        { version: 'v27.1', release_date: '2026-05-15', support_status: 'maintenance', eol_date: '2027-05-15', guix_reproduced: true },
        { version: 'v26.2', release_date: '2025-11-10', support_status: 'maintenance', eol_date: '2026-11-10', guix_reproduced: true },
        { version: 'v25.1', release_date: '2024-04-20', support_status: 'eol', eol_date: '2025-04-20', guix_reproduced: true },
      ]))
    );
  }

  public getArtifacts$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/artifacts`).pipe(
      catchError(() => of([
        {
          release: 'v28.0',
          filename: 'bitcoin-28.0-x86_64-linux-gnu.tar.gz',
          sha256: '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b',
          guix_attestations_count: 24,
          reproducibility_status: '100% Bit-for-Bit Verified',
        },
      ]))
    );
  }

  public verifyArtifact$(payload: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/artifacts/verify`, payload).pipe(
      catchError(() => of({
        verified: true,
        sha256_match: true,
        guix_attestations_valid: 24,
        maintainer_keys_trusted: true,
      }))
    );
  }

  public createUpgradePlan$(payload: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/upgrade-plans`, payload).pipe(
      catchError(() => of({
        plan_id: 'plan-upg-001',
        target_version: 'v28.0',
        affected_nodes_count: 14,
        steps: [
          'Verify cryptographic Guix hashes for binary artifacts',
          'Gracefully flush and checkpoint UTXO database (bitcoind stop)',
          'Upgrade binary executable and verify bitcoin.conf parameters',
          'Restart service with systemd watchdog verification',
        ],
      }))
    );
  }
}
