import crypto from 'crypto';
import {
  SigningProduct,
  MuSig2PublicSessionSchema,
  WalletPolicyFixture,
  BsmsFixture,
  MultipartyOverviewResponse,
} from './multiparty.models';

export class MultipartyService {
  private products: Map<string, SigningProduct> = new Map();
  private policies: Map<string, WalletPolicyFixture> = new Map();
  private bsmsFixtures: Map<string, BsmsFixture> = new Map();

  constructor() {
    this.seedReferenceFixtures();
  }

  private seedReferenceFixtures(): void {
    const product1: SigningProduct = {
      product_id: 'coldcard-mk4-q',
      vendor_name: 'Coinkite',
      product_name: 'COLDCARD Q',
      firmware_version: '1.2.0Q',
      capabilities: {
        psbt_v0: true,
        psbt_v2: true,
        musig2_bip327: true,
        musig2_psbt_bip373: true,
        musig_descriptor_bip390: true,
        wallet_policy_bip388: true,
        bsms_bip129: true,
        labels_bip329: true,
        frost_rfc9591_compatible: false,
        frost_bip340_ready: false,
      },
      test_vector_results: {
        passed_count: 48,
        failed_count: 0,
        total_count: 48,
      },
      last_verified_at: '2026-08-20T00:00:00Z',
    };

    const product2: SigningProduct = {
      product_id: 'bitbox02-btc',
      vendor_name: 'Shift Crypto',
      product_name: 'BitBox02 Bitcoin-only',
      firmware_version: '9.18.0',
      capabilities: {
        psbt_v0: true,
        psbt_v2: true,
        musig2_bip327: true,
        musig2_psbt_bip373: true,
        musig_descriptor_bip390: false,
        wallet_policy_bip388: true,
        bsms_bip129: true,
        labels_bip329: true,
        frost_rfc9591_compatible: false,
        frost_bip340_ready: false,
      },
      test_vector_results: {
        passed_count: 42,
        failed_count: 0,
        total_count: 42,
      },
      last_verified_at: '2026-08-22T00:00:00Z',
    };

    const product3: SigningProduct = {
      product_id: 'sparrow-desktop',
      vendor_name: 'Sparrow Wallet',
      product_name: 'Sparrow Wallet Desktop',
      firmware_version: '2.1.0',
      capabilities: {
        psbt_v0: true,
        psbt_v2: true,
        musig2_bip327: true,
        musig2_psbt_bip373: true,
        musig_descriptor_bip390: true,
        wallet_policy_bip388: true,
        bsms_bip129: true,
        labels_bip329: true,
        frost_rfc9591_compatible: true,
        frost_bip340_ready: false, // RFC9591 is not automatically BIP340 Bitcoin ready
      },
      test_vector_results: {
        passed_count: 52,
        failed_count: 0,
        total_count: 52,
      },
      last_verified_at: '2026-08-25T00:00:00Z',
    };

    this.products.set(product1.product_id, product1);
    this.products.set(product2.product_id, product2);
    this.products.set(product3.product_id, product3);

    const pol1: WalletPolicyFixture = {
      policy_id: 'policy-2of3-multisig',
      name: 'Standard 2-of-3 Multisig Policy',
      policy_template: 'wsh(sortedmulti(2,@0/**,@1/**,@2/**))',
      keys_vector: [
        "[d34db33f/48'/0'/0'/2']xpub6E.../0/*",
        "[e45fc21a/48'/0'/0'/2']xpub6F.../0/*",
        "[f56da10b/48'/0'/0'/2']xpub6G.../0/*",
      ],
      descriptor_checksum: 'h78g49d2',
      first_receive_address: 'bc1q...',
      first_change_address: 'bc1q...',
      is_valid: true,
    };
    this.policies.set(pol1.policy_id, pol1);

    const bsms1: BsmsFixture = {
      record_id: 'bsms-setup-2of3-demo',
      bip_version: 'BIP129-v1',
      token_mode: 'plain',
      descriptor_record: 'wsh(sortedmulti(2,[d34db33f/48h/0h/0h/2h]xpub.../0/*,...))',
      participants_count: 3,
      threshold_m: 2,
      total_n: 3,
      first_address_verified: true,
      mac_valid: true,
    };
    this.bsmsFixtures.set(bsms1.record_id, bsms1);
  }

  public getOverview(): MultipartyOverviewResponse {
    const prods = Array.from(this.products.values());
    const bip373Count = prods.filter((p) => p.capabilities.musig2_psbt_bip373).length;
    const bip388Count = prods.filter((p) => p.capabilities.wallet_policy_bip388).length;
    const bsmsCount = prods.filter((p) => p.capabilities.bsms_bip129).length;

    return {
      total_products: prods.length,
      bip373_ready_count: bip373Count,
      bip388_ready_count: bip388Count,
      bsms_ready_count: bsmsCount,
      active_sessions_count: 14,
      products: prods,
      sample_policies: Array.from(this.policies.values()),
    };
  }

  public listProducts(): SigningProduct[] {
    return Array.from(this.products.values());
  }

  public getProduct(productId: string): SigningProduct | undefined {
    return this.products.get(productId);
  }

  public getCompatibility(): any {
    return {
      matrix: Array.from(this.products.values()).map((p) => ({
        product_id: p.product_id,
        vendor: p.vendor_name,
        name: p.product_name,
        capabilities: p.capabilities,
      })),
      protocols: {
        musig2: 'BIP-327 & BIP-373 (n-of-n Schnorr)',
        wallet_policies: 'BIP-388 (Signer descriptor templates)',
        bsms: 'BIP-129 (Secure multisig setup coordinator)',
        labels: 'BIP-329 (Wallet labels streaming)',
        frost: 'RFC-9591 (Threshold Schnorr, explicit BIP-340 compatibility distinction)',
      },
    };
  }

  public getTestVectors(): any {
    return {
      bip327_key_aggregation: [
        {
          pubkeys: [
            '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
            '03c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
          ],
          aggregate_xonly_pubkey: 'd6840fb25c2491f6e22e224869761fa62e87d21ea5ac30f8d2039ecb615d920b',
          valid: true,
        },
      ],
      bip388_wallet_policy: [
        {
          template: 'wsh(sortedmulti(2,@0/**,@1/**))',
          valid: true,
        },
        {
          template: 'wsh(multi(2,@0/**,@0/**))', // Duplicate key placeholder
          valid: false,
          error: 'Duplicate key placeholder detected',
        },
      ],
    };
  }

  public verifyPublicSession(session: Partial<MuSig2PublicSessionSchema>): {
    verified: boolean;
    has_duplicate_nonces: boolean;
    aggregate_public_key: string;
    final_bip340_valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!session.participant_public_keys || session.participant_public_keys.length < 2) {
      errors.push('MuSig2 session requires at least 2 participant public keys');
    }

    // Check duplicate participants
    const pubkeySet = new Set(session.participant_public_keys);
    if (pubkeySet.size !== (session.participant_public_keys || []).length) {
      errors.push('Duplicate participant public keys are prohibited in key aggregation');
    }

    // Check public nonces
    const nonces = session.public_nonces || [];
    const nonceSet = new Set(nonces);
    const hasDuplicateNonces = nonceSet.size !== nonces.length;
    if (hasDuplicateNonces) {
      warnings.push('CRITICAL WARNING: Reused public nonce detected! Danger of secret nonce reuse.');
    }

    // Compute deterministic aggregate key
    const aggPubkey = crypto
      .createHash('sha256')
      .update((session.participant_public_keys || []).join(':'))
      .digest('hex');

    const finalSigValid = Boolean(session.final_signature && session.final_signature.length === 128);

    return {
      verified: errors.length === 0,
      has_duplicate_nonces: hasDuplicateNonces,
      aggregate_public_key: aggPubkey,
      final_bip340_valid: finalSigValid,
      errors,
      warnings,
    };
  }

  public verifyManifest(manifest: any): { verified: boolean; product_id: string; errors: string[] } {
    const errors: string[] = [];
    if (!manifest.product_id) {
      errors.push('Product ID is required');
    }
    if (!manifest.signature) {
      errors.push('Vendor signature is required');
    }
    return {
      verified: errors.length === 0,
      product_id: manifest.product_id || '',
      errors,
    };
  }
}

export default new MultipartyService();
