export interface CashuMint {
  mint_id: string;
  mint_url: string;
  name: string;
  nuts_supported: number[];
  active_keysets_count: number;
  keysets: { id: string; unit: string; active: boolean }[];
  last_heartbeat: string;
}

export interface FedimintFederation {
  federation_id: string;
  name: string;
  guardians_count: number;
  threshold: number;
  invite_code_sample?: string;
  modules: string[];
  current_epoch: number;
  last_epoch_at: string;
}

export interface EcashProviderClaim {
  claim_id: string;
  provider_type: 'cashu_mint' | 'fedimint_federation';
  identifier: string;
  domain: string;
  operator_pubkey: string;
  attestation_signature: string;
  verified_at: string;
}

export interface EcashOverview {
  total_cashu_mints: number;
  total_fedimint_federations: number;
  total_verified_guardians: number;
  active_claims_count: number;
  mints: CashuMint[];
  federations: FedimintFederation[];
  last_updated: string;
}
