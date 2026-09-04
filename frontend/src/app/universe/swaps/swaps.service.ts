import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

export interface SwapProvider {
  provider_id: string;
  identity_key: string;
  name: string;
  protocols: string[];
  protocol_versions: string[];
  networks: string[];
  swap_types: string[];
  minimum_amount_sats: number;
  maximum_amount_sats: number;
  fee_percentage: number;
  miner_fee_estimate_sats: number;
  timeout_policy_blocks: number;
  cooperative_claim_support: boolean;
  cooperative_refund_support: boolean;
  taproot_support: boolean;
  liquid_support: boolean;
  ark_support: boolean;
  health_status: 'online' | 'degraded' | 'offline';
}

export interface SwapPackage {
  swap_id: string;
  swap_type: string;
  protocol_id: string;
  network: string;
  secondary_network?: string;
  provider_id: string;
  created_at: string;
  expires_at: string;
  preimage_hash: string;
  timeout_height: number;
  expected_amount_sats: number;
  provider_fee_sats: number;
  miner_fee_sats: number;
  lockup_address: string;
  lockup_transaction?: string;
  claim_transaction?: string;
  status: string;
}

export interface SwapsOverview {
  total_swaps_observed: number;
  active_providers_count: number;
  total_volume_sats: number;
  supported_protocols_count: number;
  recent_swaps: SwapPackage[];
  active_providers: SwapProvider[];
  protocols: any[];
}

@Injectable({
  providedIn: 'root',
})
export class SwapsApiService {
  private readonly baseUrl = '/api/v1/intelligence/swaps';

  private defaultOverview: SwapsOverview = {
    total_swaps_observed: 1420,
    active_providers_count: 2,
    total_volume_sats: 285400000,
    supported_protocols_count: 4,
    recent_swaps: [
      {
        swap_id: 'swp-boltz-887412-001',
        swap_type: 'submarine',
        protocol_id: 'boltz_submarine_v2',
        network: 'bitcoin',
        provider_id: 'boltz-exchange',
        created_at: '2026-09-04T12:00:00Z',
        expires_at: '2026-09-05T12:00:00Z',
        preimage_hash: '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae',
        timeout_height: 864200,
        expected_amount_sats: 100000,
        provider_fee_sats: 500,
        miner_fee_sats: 1200,
        lockup_address: 'bc1q9w7y723n0h57n675n8l9e8790vj9642swp001',
        lockup_transaction: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
        status: 'claimable',
      },
      {
        swap_id: 'swp-boltz-887412-002',
        swap_type: 'reverse',
        protocol_id: 'boltz_submarine_v2',
        network: 'bitcoin',
        secondary_network: 'lightning',
        provider_id: 'boltz-exchange',
        created_at: '2026-09-04T14:30:00Z',
        expires_at: '2026-09-05T14:30:00Z',
        preimage_hash: 'fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9',
        timeout_height: 864250,
        expected_amount_sats: 250000,
        provider_fee_sats: 1250,
        miner_fee_sats: 1500,
        lockup_address: 'bc1qrevswp77488921190477123985721839074839',
        lockup_transaction: '0e3e2357e806b6cdb1f70b54c3a3a17b6714ee1f0e249fa23d8a969e1c911e22',
        claim_transaction: '9b71d224bd62f3785d96d46ad3ea3d73319bfbc2770d3d5f7cc9a4744d91aafb',
        status: 'claimed',
      },
    ],
    active_providers: [
      {
        provider_id: 'boltz-exchange',
        identity_key: '026165854b34e203a96812b67fa17e754dfebf0dfb39d677fa8f601a97e20556f8',
        name: 'Boltz Exchange',
        protocols: ['boltz_submarine_v2', 'boltz_chain_v1'],
        protocol_versions: ['2.3.4', '1.2.0'],
        networks: ['bitcoin', 'liquid'],
        swap_types: ['submarine', 'reverse', 'chain'],
        minimum_amount_sats: 25000,
        maximum_amount_sats: 25000000,
        fee_percentage: 0.5,
        miner_fee_estimate_sats: 1500,
        timeout_policy_blocks: 144,
        cooperative_claim_support: true,
        cooperative_refund_support: true,
        taproot_support: true,
        liquid_support: true,
        ark_support: false,
        health_status: 'online',
      },
      {
        provider_id: 'loop-in-out',
        identity_key: '0289be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81799',
        name: 'Lightning Labs Loop',
        protocols: ['lightning_loop_v1'],
        protocol_versions: ['0.28.0'],
        networks: ['bitcoin'],
        swap_types: ['submarine', 'reverse'],
        minimum_amount_sats: 50000,
        maximum_amount_sats: 50000000,
        fee_percentage: 0.25,
        miner_fee_estimate_sats: 2200,
        timeout_policy_blocks: 288,
        cooperative_claim_support: true,
        cooperative_refund_support: true,
        taproot_support: true,
        liquid_support: false,
        ark_support: false,
        health_status: 'online',
      },
    ],
    protocols: [
      {
        protocol_id: 'boltz_submarine_v2',
        protocol_name: 'Boltz Submarine Swap V2',
        protocol_revision: '2.3.4',
        supported_networks: ['bitcoin', 'liquid'],
        supported_swap_types: ['submarine', 'reverse'],
        taproot_support: true,
      },
    ],
  };

  constructor(private http: HttpClient) {}

  public getOverview$(): Observable<SwapsOverview> {
    return this.http.get<SwapsOverview>(`${this.baseUrl}/overview`).pipe(
      catchError(() => of(this.defaultOverview))
    );
  }

  public getProviders$(): Observable<SwapProvider[]> {
    return this.http.get<SwapProvider[]>(`${this.baseUrl}/providers`).pipe(
      catchError(() => of(this.defaultOverview.active_providers))
    );
  }

  public getProviderById$(id: string): Observable<SwapProvider | undefined> {
    return this.http.get<SwapProvider>(`${this.baseUrl}/providers/${id}`).pipe(
      catchError(() => of(this.defaultOverview.active_providers.find((p) => p.provider_id === id)))
    );
  }
}
