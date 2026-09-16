import config from '../../../config';
import PoolsRepository from '../../../repositories/PoolsRepository';
import { EventEnvelopeValidator } from '../events/event-envelope';
import { AuthenticatedOwner, IdentityError } from '../identity/developer-identity';
import { KnowledgeLabelRow, ownerStore } from '../identity/owner-store';

/**
 * Entity labels with the evidence behind them.
 *
 * The revision this replaces seeded labels such as "Binance Cold Storage 1"
 * with an invented proof-of-reserves reference and reported any submission
 * as verified when its cryptographic_proof field was a non-empty string.
 *
 * Two kinds of label exist now. Pool labels come from the mining pools
 * definition this explorer already uses to attribute blocks; their evidence
 * is the coinbase tags and payout addresses in that definition. Submitted
 * labels come from an authenticated owner, are persisted, and stay
 * provisional: this service verifies no signature, so it never says
 * verified about one.
 */

export interface EvidenceItem {
  evidence_type: 'bip322_signature' | 'proof_of_reserves' | 'public_disclosure' | 'on_chain_multisig' | 'coinbase_tag' | 'payout_address';
  reference_uri: string;
  cryptographic_proof?: string;
  verified_at_utc: string | null;
  description: string;
}

export interface EntityLabel {
  label_id: string;
  entity_type: 'address' | 'entity' | 'xpub' | 'pool';
  entity_id: string;
  name: string;
  category: 'exchange' | 'mining_pool' | 'custodian' | 'merchant' | 'defi' | 'infrastructure';
  confidence_level: 1 | 2 | 3;
  confidence_score: number;
  status: 'verified' | 'contested' | 'provisional';
  /** Where the label comes from. */
  source: 'pools_definition' | 'submitted';
  evidence: EvidenceItem[];
  dispute_reason?: string;
  submitted_by?: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeAuditRecord {
  audit_id: string;
  label_id: string;
  action: 'created' | 'updated' | 'challenged' | 'verified' | 'rejected';
  actor_id: string;
  evidence_summary: string;
  timestamp_utc: string;
}

export const ENTITY_TYPES = ['address', 'entity', 'xpub', 'pool'] as const;
export const CATEGORIES = ['exchange', 'mining_pool', 'custodian', 'merchant', 'defi', 'infrastructure'] as const;
export const EVIDENCE_TYPES = ['bip322_signature', 'proof_of_reserves', 'public_disclosure', 'on_chain_multisig'] as const;
export const KNOWLEDGE_LIMITS = { labelsPerOwner: 500, nameLength: 128, entityIdLength: 160, evidenceItems: 10, uriLength: 1024, descriptionLength: 1024, proofLength: 4096 } as const;

export type PoolReader = () => Promise<{ name: string; slug: string; link: string; regexes: string; addresses: string }[]>;

export class KnowledgeRegistryService {
  private static instance: KnowledgeRegistryService;
  private poolCache: { at: number; labels: EntityLabel[] } | null = null;
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public poolReader: PoolReader = async () => (config.DATABASE.ENABLED ? PoolsRepository.$getPools() : []);

  private constructor() {}

  public static getInstance(): KnowledgeRegistryService {
    if (!KnowledgeRegistryService.instance) {
      KnowledgeRegistryService.instance = new KnowledgeRegistryService();
    }
    return KnowledgeRegistryService.instance;
  }

  /** Test seam. */
  public resetForTests(): void {
    this.poolCache = null;
  }

  private static parseList(value: string): string[] {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
  }

  /** @asyncUnsafe One label per pool in the definition used for block attribution. */
  private async poolLabels(now = Date.now()): Promise<EntityLabel[]> {
    if (this.poolCache && now - this.poolCache.at < 10 * 60_000) { return this.poolCache.labels; }
    let pools: { name: string; slug: string; link: string; regexes: string; addresses: string }[] = [];
    try { pools = await this.poolReader(); } catch { pools = []; }
    const labels: EntityLabel[] = pools.filter(pool => pool.slug && pool.slug !== 'unknown').map(pool => {
      const tags = KnowledgeRegistryService.parseList(pool.regexes);
      const addresses = KnowledgeRegistryService.parseList(pool.addresses);
      const evidence: EvidenceItem[] = [
        ...tags.map(tag => ({ evidence_type: 'coinbase_tag' as const, reference_uri: pool.link || '', verified_at_utc: null, description: `Coinbase tag ${JSON.stringify(tag)} in the pools definition.` })),
        ...addresses.map(address => ({ evidence_type: 'payout_address' as const, reference_uri: pool.link || '', verified_at_utc: null, description: `Payout address ${address} in the pools definition.` })),
      ];
      return {
        label_id: `pool-${pool.slug}`, entity_type: 'pool' as const, entity_id: `pool-${pool.slug}`, name: pool.name, category: 'mining_pool' as const,
        confidence_level: evidence.length ? 2 : 1, confidence_score: evidence.length ? 0.9 : 0.5, status: evidence.length ? 'verified' as const : 'provisional' as const,
        source: 'pools_definition' as const, evidence, created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(),
      };
    });
    this.poolCache = { at: now, labels };
    return labels;
  }

  private submitted(row: KnowledgeLabelRow): EntityLabel {
    const document = row.document as Partial<EntityLabel>;
    return {
      label_id: row.label_id, entity_type: row.entity_type as EntityLabel['entity_type'], entity_id: row.entity_id, name: String(document.name ?? ''),
      category: (document.category as EntityLabel['category']) ?? 'infrastructure', confidence_level: (document.confidence_level as EntityLabel['confidence_level']) ?? 1,
      confidence_score: Number(document.confidence_score ?? 0.5), status: row.status as EntityLabel['status'], source: 'submitted', evidence: (document.evidence as EvidenceItem[]) ?? [],
      dispute_reason: document.dispute_reason, submitted_by: row.owner_id, created_at: row.created_at, updated_at: row.updated_at,
    };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getLabels(category?: string, limit = 200): Promise<EntityLabel[]> {
    const pools = await this.poolLabels();
    const stored = (await ownerStore().listKnowledgeLabels(config.MEMPOOL.NETWORK, Math.max(1, Math.min(1000, limit)))).map(row => this.submitted(row));
    const all = [...stored, ...pools];
    return category ? all.filter(label => label.category === category) : all;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getLabelByEntity(entityId: string): Promise<EntityLabel | null> {
    const pool = (await this.poolLabels()).find(label => label.entity_id === entityId);
    if (pool) { return pool; }
    const [row] = await ownerStore().findKnowledgeLabelsByEntity(config.MEMPOOL.NETWORK, entityId);
    return row ? this.submitted(row) : null;
  }

  private static requireEnum<T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] {
    if (typeof value !== 'string' || !allowed.includes(value)) { throw new IdentityError(`invalid_${field}`, `${field} must be one of ${allowed.join(', ')}`, 400); }
    return value;
  }

  private static requireText(value: unknown, field: string, max: number): string {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) { throw new IdentityError(`invalid_${field}`, `${field} must be 1 to ${max} characters`, 400); }
    return value.trim();
  }

  /** @asyncUnsafe A submission is stored as provisional with the evidence the owner supplied; nothing is verified here. */
  public async submitLabel(owner: AuthenticatedOwner, entityType: unknown, entityId: unknown, name: unknown, category: unknown, evidence: unknown): Promise<EntityLabel> {
    const type = KnowledgeRegistryService.requireEnum(entityType, ENTITY_TYPES, 'entity_type');
    const id = KnowledgeRegistryService.requireText(entityId, 'entity_id', KNOWLEDGE_LIMITS.entityIdLength);
    const cleanName = KnowledgeRegistryService.requireText(name, 'name', KNOWLEDGE_LIMITS.nameLength);
    const cleanCategory = KnowledgeRegistryService.requireEnum(category, CATEGORIES, 'category');
    if (!Array.isArray(evidence) || evidence.length === 0 || evidence.length > KNOWLEDGE_LIMITS.evidenceItems) {
      throw new IdentityError('invalid_evidence', `evidence must be 1 to ${KNOWLEDGE_LIMITS.evidenceItems} items`, 400);
    }
    const items: EvidenceItem[] = evidence.map(item => ({
      evidence_type: KnowledgeRegistryService.requireEnum(item?.evidence_type, EVIDENCE_TYPES, 'evidence_type'),
      reference_uri: KnowledgeRegistryService.requireText(item?.reference_uri, 'reference_uri', KNOWLEDGE_LIMITS.uriLength),
      cryptographic_proof: typeof item?.cryptographic_proof === 'string' && item.cryptographic_proof.length <= KNOWLEDGE_LIMITS.proofLength ? item.cryptographic_proof : undefined,
      verified_at_utc: null,
      description: KnowledgeRegistryService.requireText(item?.description, 'description', KNOWLEDGE_LIMITS.descriptionLength),
    }));
    const store = ownerStore();
    if ((await store.countKnowledgeLabels(owner.owner_id, config.MEMPOOL.NETWORK)) >= KNOWLEDGE_LIMITS.labelsPerOwner) {
      throw new IdentityError('quota', `an owner may submit at most ${KNOWLEDGE_LIMITS.labelsPerOwner} labels`, 409);
    }
    const now = new Date().toISOString();
    const row: KnowledgeLabelRow = {
      label_id: EventEnvelopeValidator.generateUuidV7(), owner_id: owner.owner_id, network: config.MEMPOOL.NETWORK, entity_type: type, entity_id: id, status: 'provisional',
      document: { name: cleanName, category: cleanCategory, confidence_level: 1, confidence_score: 0.5, evidence: items }, created_at: now, updated_at: now,
    };
    await store.insertKnowledgeLabel(row);
    await store.insertKnowledgeAudit({ audit_id: EventEnvelopeValidator.generateUuidV7(), label_id: row.label_id, network: config.MEMPOOL.NETWORK, action: 'created', actor_owner_id: owner.owner_id, summary: items[0].description, created_at: now });
    return this.submitted(row);
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async challengeLabel(owner: AuthenticatedOwner, labelId: string, disputeReason: unknown, counterEvidenceUri: unknown): Promise<boolean> {
    const reason = KnowledgeRegistryService.requireText(disputeReason, 'dispute_reason', KNOWLEDGE_LIMITS.descriptionLength);
    const uri = counterEvidenceUri === undefined ? '' : KnowledgeRegistryService.requireText(counterEvidenceUri, 'counter_evidence_uri', KNOWLEDGE_LIMITS.uriLength);
    const store = ownerStore();
    const row = await store.getKnowledgeLabel(config.MEMPOOL.NETWORK, labelId);
    if (!row) { return false; }
    const now = new Date().toISOString();
    await store.updateKnowledgeLabel(config.MEMPOOL.NETWORK, labelId, 'contested', { ...row.document, dispute_reason: reason }, now);
    await store.insertKnowledgeAudit({ audit_id: EventEnvelopeValidator.generateUuidV7(), label_id: labelId, network: config.MEMPOOL.NETWORK, action: 'challenged', actor_owner_id: owner.owner_id, summary: `Challenged: ${reason}${uri ? ` (Counter-evidence: ${uri})` : ''}`, created_at: now });
    return true;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getAuditLog(limit = 200): Promise<KnowledgeAuditRecord[]> {
    return (await ownerStore().listKnowledgeAudit(config.MEMPOOL.NETWORK, Math.max(1, Math.min(1000, limit)))).map(row => ({
      audit_id: row.audit_id, label_id: row.label_id, action: row.action as KnowledgeAuditRecord['action'], actor_id: row.actor_owner_id, evidence_summary: row.summary, timestamp_utc: row.created_at,
    }));
  }
}

export const knowledgeRegistryService = KnowledgeRegistryService.getInstance();
