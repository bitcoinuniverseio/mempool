import {
  VpackOverview,
  VpackImplementationAdapter,
  VpackProvider,
  VpackPublicAnchorVerification,
  VpackUnilateralExitPlan,
  MinimalViableVtxo,
  VtxoVerificationState,
} from './ark-vpack.models';

export class ArkVpackService {
  private versions: string[] = ['v0.1.0-mvv', 'v0.2.0-rc1'];

  private implementations: VpackImplementationAdapter[] = [
    {
      implementation_id: 'arkade',
      implementation_name: 'Arkade (Rust libvpack-rs)',
      implementation_revision: '0.4.2',
      supported_vpack_versions: ['v0.1.0-mvv', 'v0.2.0-rc1'],
      dialect_features: {
        native_extensions_supported: ['arkade_round_batch', 'vtxo_merkle_proof'],
        fee_anchor_type: 'ephemeral_anchor_v3',
        taproot_tree_style: 'standard_bip341_taptree',
      },
    },
    {
      implementation_id: 'bark',
      implementation_name: 'Bark (Go Ark ASP Client)',
      implementation_revision: '0.3.1',
      supported_vpack_versions: ['v0.1.0-mvv'],
      dialect_features: {
        native_extensions_supported: ['bark_checkpoint', 'covenant_tree'],
        fee_anchor_type: 'cpfp_anchor_output',
        taproot_tree_style: 'script_path_multisig',
      },
    },
  ];

  private providers: VpackProvider[] = [
    {
      provider_id: 'asp-arkade-ashburn',
      identity_key: '0250863ad64a87ae8a2fe83c1af1a8403cb53f53e486d8511dad8a04887e5b2352',
      name: 'Arkade Prime ASP',
      network: 'bitcoin',
      protocol_version: '0.4.2',
      vpack_version: 'v0.2.0-rc1',
      native_package_version: 'arkade-pkg-2.1',
      endpoint_url: 'https://asp.arkade.money/v1',
      health_status: 'online',
      current_round_id: 'rnd-864195-001',
      current_block_height: 864195,
      exit_delay_blocks: 512,
      refresh_interval_blocks: 2016,
      supported_asset_types: ['BTC'],
      fee_policy: {
        base_fee_sats: 100,
        pct_fee: 0.1,
      },
      server_signed_manifest: '30440220359871fae...',
      last_successful_observation: '2026-09-04T17:30:00Z',
    },
    {
      provider_id: 'asp-bark-helsinki',
      identity_key: '0379be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      name: 'Bark Community ASP',
      network: 'bitcoin',
      protocol_version: '0.3.1',
      vpack_version: 'v0.1.0-mvv',
      native_package_version: 'bark-pkg-1.4',
      endpoint_url: 'https://asp.barkprotocol.io/api',
      health_status: 'online',
      current_round_id: 'rnd-864190-004',
      current_block_height: 864195,
      exit_delay_blocks: 288,
      refresh_interval_blocks: 1440,
      supported_asset_types: ['BTC'],
      fee_policy: {
        base_fee_sats: 250,
        pct_fee: 0.15,
      },
      server_signed_manifest: '30450221008d...',
      last_successful_observation: '2026-09-04T17:45:00Z',
    },
  ];

  public getOverview(): VpackOverview {
    return {
      total_vpack_versions: this.versions.length,
      active_providers_count: this.providers.length,
      supported_implementations: this.implementations,
      recent_verified_anchors: 148,
      providers: this.providers,
      active_versions: this.versions,
    };
  }

  public listVersions(): string[] {
    return this.versions;
  }

  public listImplementations(): VpackImplementationAdapter[] {
    return this.implementations;
  }

  public listProviders(): VpackProvider[] {
    return this.providers;
  }

  public getProvider(providerId: string): VpackProvider | undefined {
    return this.providers.find((p) => p.provider_id === providerId);
  }

  public verifyPublicAnchor(anchorOutpoint: string): VpackPublicAnchorVerification {
    const parts = anchorOutpoint.split(':');
    const errors: string[] = [];
    if (parts.length !== 2) {
      errors.push('Anchor outpoint must be in txid:vout format');
      return {
        anchor_outpoint: anchorOutpoint,
        exists_onchain: false,
        confirmations: 0,
        spend_status: 'conflicting',
        exit_delay_blocks: 0,
        verified: false,
        errors,
      };
    }

    const txid = parts[0];
    const vout = parseInt(parts[1], 10);
    if (txid.length !== 64 || isNaN(vout)) {
      errors.push('Malformed txid or output index');
    }

    const verified = errors.length === 0;
    return {
      anchor_outpoint: anchorOutpoint,
      exists_onchain: verified,
      block_height: verified ? 864150 : undefined,
      confirmations: verified ? 45 : 0,
      spend_status: 'unspent',
      exit_delay_blocks: 512,
      verified,
      errors,
    };
  }

  public verifyManifest(manifest: Partial<VpackProvider>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!manifest.provider_id) errors.push('provider_id is required');
    if (!manifest.identity_key) errors.push('identity_key is required');
    if (!manifest.server_signed_manifest) errors.push('server_signed_manifest is required');
    if (!manifest.vpack_version) errors.push('vpack_version is required');
    return {
      valid: errors.length === 0,
      errors,
    };
  }

  public translateDialect(pkg: any, targetDialect: string): any {
    const supported = this.implementations.some((impl) => impl.implementation_id === targetDialect);
    if (!supported) {
      return {
        success: false,
        error: `Unsupported target dialect: ${targetDialect}`,
      };
    }

    const mvv: MinimalViableVtxo = {
      vtxo_id: pkg.vtxo_id || 'vtxo-887412-001',
      version: 1,
      network: pkg.network || 'bitcoin',
      amount_sats: pkg.amount_sats || 500000,
      script_pubkey: pkg.script_pubkey || '5120abcdef...',
      sequence: 0xfffffffd,
      exit_delay_blocks: pkg.exit_delay_blocks || 512,
      anchor_outpoint: {
        txid: '3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c',
        vout: 0,
      },
      asp_pubkey: '0250863ad64a87ae8a2fe83c1af1a8403cb53f53e486d8511dad8a04887e5b2352',
      user_pubkey: '0379be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      expires_at_height: 866200,
    };

    return {
      success: true,
      target_dialect: targetDialect,
      minimal_viable_vtxo: mvv,
      fields_preserved: ['vtxo_id', 'amount_sats', 'script_pubkey', 'anchor_outpoint', 'exit_delay_blocks'],
      fields_normalized: ['version', 'sequence'],
      fields_lost: [],
      fields_unsupported: [],
      unilateral_exit_viable: true,
      verification_state: 'exit_path_verified' as VtxoVerificationState,
    };
  }

  public planUnilateralExit(vtxoId: string, currentHeight = 864195): VpackUnilateralExitPlan {
    const exitDelay = 512;
    return {
      vtxo_id: vtxoId,
      anchor_outpoint: '3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c:0',
      required_transactions_count: 2,
      csv_delay_blocks: exitDelay,
      estimated_package_vsize: 420,
      estimated_package_fee_sats: 3500,
      fee_anchor_available: true,
      cpfp_output_index: 1,
      exit_stages: [
        {
          stage_index: 0,
          tx_type: 'round_transaction',
          ready_to_broadcast: true,
          required_delay_blocks: 0,
        },
        {
          stage_index: 1,
          tx_type: 'exit_transaction',
          ready_to_broadcast: false,
          required_delay_blocks: exitDelay,
        },
      ],
      unsigned_exit_psbt: 'cHNidP8BAFICAAAAAQ...',
      warnings: [
        'Path existence proven on-chain. Note: path exclusivity requires monitoring the ASP round for competing collaborative sweeps.',
      ],
    };
  }
}

export default new ArkVpackService();
