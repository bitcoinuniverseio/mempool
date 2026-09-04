import crypto from 'crypto';
import logger from '../../../logger';
import { IntelligenceEventBus } from '../events/intelligence-event-bus';
import {
  CashuMint,
  FedimintFederation,
  EcashProviderClaim,
  EcashOverview,
} from './ecash.models';

export class EcashService {
  private static instance: EcashService;
  private eventBus = IntelligenceEventBus.getInstance();

  private mints: Map<string, CashuMint> = new Map();
  private federations: Map<string, FedimintFederation> = new Map();
  private claims: Map<string, EcashProviderClaim> = new Map();

  private constructor() {
    this.seedInitialData();
  }

  public static getInstance(): EcashService {
    if (!EcashService.instance) {
      EcashService.instance = new EcashService();
    }
    return EcashService.instance;
  }

  private seedInitialData(): void {
    const mint1: CashuMint = {
      mint_id: 'mint-minibits',
      mint_url: 'https://mint.minibits.cash/Bitcoin',
      name: 'Minibits Mint',
      nuts_supported: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      active_keysets_count: 2,
      keysets: [
        { id: '009a1f2942da3204', unit: 'sat', active: true },
        { id: '005b4c3e2f1a9876', unit: 'sat', active: false },
      ],
      last_heartbeat: new Date().toISOString(),
    };

    const mint2: CashuMint = {
      mint_id: 'mint-macadamia',
      mint_url: 'https://mint.macadamia.cash',
      name: 'Macadamia Mint',
      nuts_supported: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      active_keysets_count: 1,
      keysets: [
        { id: '008f7e6d5c4b3a21', unit: 'sat', active: true },
      ],
      last_heartbeat: new Date().toISOString(),
    };

    this.mints.set(mint1.mint_id, mint1);
    this.mints.set(mint2.mint_id, mint2);

    const fed1: FedimintFederation = {
      federation_id: 'fed-mutiny-net',
      name: 'MutinyNet Federation',
      guardians_count: 5,
      threshold: 3,
      invite_code_sample: 'fed11qgqrgvnhwden5te0v9k8q6ewvdhk6tmv9i58getnw4h8g6r4vajkger9wcez6unsv96xuetnvd5kzmtcv4ekzarfde585tewwajkcmpjv968gmnyv3ex2um5wf5kgetj9ehx2am09ehx2ap0qf6x2umn9exsumr9wexjuepqfx4829',
      modules: ['lightning', 'wallet', 'mint', 'meta'],
      current_epoch: 14820,
      last_epoch_at: new Date().toISOString(),
    };

    const fed2: FedimintFederation = {
      federation_id: 'fed-fedi-community',
      name: 'Global Community Federation',
      guardians_count: 7,
      threshold: 5,
      invite_code_sample: 'fed11qgqrgvnhwden5te0v9k8q6ewvdhk6tmv9i58getnw4h8g6r4vajkger9wcez6unsv96xuetnvd5kzmtcv4ekzarfde585tewwajkcmpjv968gmnyv3ex2um5wf5kgetj9ehx2am09ehx2ap0qf6x2umn9exsumr9wexjuepq89274',
      modules: ['lightning', 'wallet', 'mint'],
      current_epoch: 9240,
      last_epoch_at: new Date().toISOString(),
    };

    this.federations.set(fed1.federation_id, fed1);
    this.federations.set(fed2.federation_id, fed2);

    const claim1: EcashProviderClaim = {
      claim_id: 'claim-1',
      provider_type: 'cashu_mint',
      identifier: 'mint-minibits',
      domain: 'mint.minibits.cash',
      operator_pubkey: '0289a1c2d3e4f5061728394a5b6c7d8e9f0123456789abcdef0123456789abcd',
      attestation_signature: crypto.randomBytes(64).toString('hex'),
      verified_at: new Date().toISOString(),
    };

    this.claims.set(claim1.claim_id, claim1);
  }

  public getOverview(): EcashOverview {
    const mintList = Array.from(this.mints.values());
    const fedList = Array.from(this.federations.values());
    const guardiansTotal = fedList.reduce((acc, f) => acc + f.guardians_count, 0);

    return {
      total_cashu_mints: mintList.length,
      total_fedimint_federations: fedList.length,
      total_verified_guardians: guardiansTotal,
      active_claims_count: this.claims.size,
      mints: mintList,
      federations: fedList,
      last_updated: new Date().toISOString(),
    };
  }

  public getMints(): CashuMint[] {
    return Array.from(this.mints.values());
  }

  public getMintById(mintId: string): CashuMint | null {
    return this.mints.get(mintId) || null;
  }

  public getFederations(): FedimintFederation[] {
    return Array.from(this.federations.values());
  }

  public getFederationById(federationId: string): FedimintFederation | null {
    return this.federations.get(federationId) || null;
  }

  public registerClaim(claim: Omit<EcashProviderClaim, 'claim_id' | 'verified_at'>): EcashProviderClaim {
    if (!claim.domain || !claim.operator_pubkey) {
      throw new Error('Domain and operator public key are required.');
    }

    const newClaim: EcashProviderClaim = {
      ...claim,
      claim_id: 'clm-' + crypto.randomBytes(4).toString('hex'),
      verified_at: new Date().toISOString(),
    };

    this.claims.set(newClaim.claim_id, newClaim);
    logger.info(`EcashService: Registered provider claim for ${claim.domain}`);
    return newClaim;
  }
}

export const ecashService = EcashService.getInstance();
