export interface CashuMint {
  mint_id: string;
  mint_url: string;
  /** From the mint's NUT-06 info; null when it did not answer. */
  name: string | null;
  nuts_supported: number[];
  active_keysets_count: number;
  keysets: { id: string; unit: string; active: boolean }[];
  last_heartbeat: string | null;
  reachable: boolean;
  error: string | null;
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
  verified_at: string | null;
}

export interface EcashOverview {
  total_cashu_mints: number;
  reachable_cashu_mints: number;
  /** Null: no Fedimint client is connected, so nothing is counted. */
  total_fedimint_federations: number | null;
  total_verified_guardians: number | null;
  /** Null: this deployment keeps no claim registry. */
  active_claims_count: number | null;
  mints: CashuMint[];
  federations: FedimintFederation[];
  federations_note: string;
  last_updated: string;
}
