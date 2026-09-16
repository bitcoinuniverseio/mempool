import { verifyProviderManifest } from './provider-manifest';
import { translateVpackDialect } from './dialect-translator';
import { planVpackExit } from './exit-planner';
import { AnchorReader } from './anchor-reader';
import {
  VpackOverview,
  VpackImplementationAdapter,
  VpackProvider,
} from './ark-vpack.models';

export class ArkVpackService {
  private versions: string[] = ['vpack-wire-v1', 'mvv-native-proof-envelope-v1'];
  private anchorReads = new Map<string, number>();

  private implementations: VpackImplementationAdapter[] = [
    {
      implementation_id: 'arkade',
      implementation_name: 'Arkade native TxTree and DefaultVtxo codec',
      implementation_revision: '@arkade-os/sdk 0.4.72',
      supported_vpack_versions: ['mvv-native-proof-envelope-v1'],
      dialect_features: {
        native_extensions_supported: ['native_psbt_tree', 'default_vtxo_public_policy'],
        fee_anchor_type: 'ephemeral_anchor_v3',
        taproot_tree_style: 'standard_bip341_taptree',
      },
    },
    {
      implementation_id: 'bark',
      implementation_name: 'Bark native ProtocolEncoding codec',
      implementation_revision: 'ark-lib 0.7.1',
      supported_vpack_versions: ['mvv-native-proof-envelope-v1'],
      dialect_features: {
        native_extensions_supported: ['native_protocol_encoding', 'preserved_native_proof'],
        fee_anchor_type: 'cpfp_anchor_output',
        taproot_tree_style: 'script_path_multisig',
      },
    },
  ];

  private providers: VpackProvider[] = [];


  public getOverview(): VpackOverview {
    for (const [outpoint, at] of this.anchorReads) if (at < Date.now() - 86400000) this.anchorReads.delete(outpoint);
    return {
      total_vpack_versions: this.versions.length,
      active_providers_count: this.providers.length,
      supported_implementations: this.implementations,
      recent_verified_anchors: this.anchorReads.size,
      registry_status: 'unconfigured',
      observation_scope: 'Configured providers only; no external provider has been independently registered. Anchor count covers up to 10000 distinct successful owned-source reads retained in this process during the last 24 hours.',
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

  /** @asyncUnsafe rejections propagate to the caller, which handles them. */
  public async verifyPublicAnchor(anchorOutpoint: string, expectedDescriptor?: string) {
    const result = await new AnchorReader().verify(anchorOutpoint, expectedDescriptor);
    if (result.outpoint_verified) {
      const key = result.source.network + ':' + result.anchor_outpoint;
      this.anchorReads.delete(key);
      this.anchorReads.set(key, Date.now());
      if (this.anchorReads.size > 10000) this.anchorReads.delete(this.anchorReads.keys().next().value!);
    }
    return result;
  }

  public verifyManifest(manifest: any) {
    return verifyProviderManifest(manifest, this.providers.map(provider => provider.identity_key));
  }

  public translateDialect(request: any) { return translateVpackDialect(request); }

  public planUnilateralExit(request: any) {
    return planVpackExit(request);
  }
}

export default new ArkVpackService();
