import { EventEnvelopeValidator } from '../events/event-envelope';

export interface EvidenceItem {
  evidence_type: 'bip322_signature' | 'proof_of_reserves' | 'public_disclosure' | 'on_chain_multisig';
  reference_uri: string;
  cryptographic_proof?: string;
  verified_at_utc: string;
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
  evidence: EvidenceItem[];
  dispute_reason?: string;
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

export class KnowledgeRegistryService {
  private static instance: KnowledgeRegistryService;
  private labels: Map<string, EntityLabel> = new Map();
  private auditLog: KnowledgeAuditRecord[] = [];

  private constructor() {
    this.seedDefaultLabels();
  }

  public static getInstance(): KnowledgeRegistryService {
    if (!KnowledgeRegistryService.instance) {
      KnowledgeRegistryService.instance = new KnowledgeRegistryService();
    }
    return KnowledgeRegistryService.instance;
  }

  private seedDefaultLabels(): void {
    const l1: EntityLabel = {
      label_id: 'lbl-foundry-usa',
      entity_type: 'pool',
      entity_id: 'pool-foundry-usa',
      name: 'Foundry USA Pool',
      category: 'mining_pool',
      confidence_level: 3,
      confidence_score: 1.0,
      status: 'verified',
      evidence: [
        {
          evidence_type: 'on_chain_multisig',
          reference_uri: 'btc:block:coinbase:860100',
          cryptographic_proof: 'Coinbase signature string /Foundry USA/',
          verified_at_utc: '2026-08-01T00:00:00Z',
          description: 'Coinbase script witness tag directly produced by Foundry USA template.',
        },
      ],
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-01T00:00:00Z',
    };

    const l2: EntityLabel = {
      label_id: 'lbl-binance-cold',
      entity_type: 'address',
      entity_id: '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo',
      name: 'Binance Cold Storage 1',
      category: 'exchange',
      confidence_level: 3,
      confidence_score: 1.0,
      status: 'verified',
      evidence: [
        {
          evidence_type: 'proof_of_reserves',
          reference_uri: 'https://binance.com/en/proof-of-reserves',
          cryptographic_proof: 'BIP322 signature signed by private key of 34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo',
          verified_at_utc: '2026-07-15T12:00:00Z',
          description: 'Public Merkle Proof of Reserves published with on-chain signed message.',
        },
      ],
      created_at: '2026-07-15T12:00:00Z',
      updated_at: '2026-07-15T12:00:00Z',
    };

    this.labels.set(l1.label_id, l1);
    this.labels.set(l2.label_id, l2);

    this.auditLog.push(
      {
        audit_id: 'aud-01',
        label_id: l1.label_id,
        action: 'verified',
        actor_id: 'system-validator',
        evidence_summary: 'Verified coinbase template tag.',
        timestamp_utc: l1.created_at,
      },
      {
        audit_id: 'aud-02',
        label_id: l2.label_id,
        action: 'verified',
        actor_id: 'system-validator',
        evidence_summary: 'Verified BIP322 Proof of Reserves cryptographic signature.',
        timestamp_utc: l2.created_at,
      }
    );
  }

  public getLabels(category?: string): EntityLabel[] {
    const list = Array.from(this.labels.values());
    if (category) {
      return list.filter((l) => l.category === category);
    }
    return list;
  }

  public getLabelByEntity(entityId: string): EntityLabel | null {
    for (const l of this.labels.values()) {
      if (l.entity_id === entityId || l.label_id === entityId) {
        return l;
      }
    }
    return null;
  }

  public submitLabel(
    actorId: string,
    entityType: EntityLabel['entity_type'],
    entityId: string,
    name: string,
    category: EntityLabel['category'],
    evidence: EvidenceItem[]
  ): EntityLabel {
    if (!evidence || evidence.length === 0) {
      throw new Error('Evidence-backed policy violation: At least one verifiable evidence reference is mandatory.');
    }

    const labelId = EventEnvelopeValidator.generateUuidV7();
    const hasCrypto = evidence.some((e) => e.cryptographic_proof && e.cryptographic_proof.length > 0);
    const confidenceLevel: EntityLabel['confidence_level'] = hasCrypto ? 3 : 2;
    const confidenceScore = hasCrypto ? 1.0 : 0.88;

    const label: EntityLabel = {
      label_id: labelId,
      entity_type: entityType,
      entity_id: entityId,
      name,
      category,
      confidence_level: confidenceLevel,
      confidence_score: confidenceScore,
      status: hasCrypto ? 'verified' : 'provisional',
      evidence,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.labels.set(labelId, label);

    this.auditLog.unshift({
      audit_id: EventEnvelopeValidator.generateUuidV7(),
      label_id: labelId,
      action: hasCrypto ? 'verified' : 'created',
      actor_id: actorId,
      evidence_summary: evidence[0].description,
      timestamp_utc: new Date().toISOString(),
    });

    return label;
  }

  public challengeLabel(labelId: string, actorId: string, disputeReason: string, counterEvidenceUri: string): boolean {
    const label = this.labels.get(labelId);
    if (!label) return false;

    label.status = 'contested';
    label.dispute_reason = disputeReason;
    label.updated_at = new Date().toISOString();

    this.auditLog.unshift({
      audit_id: EventEnvelopeValidator.generateUuidV7(),
      label_id: labelId,
      action: 'challenged',
      actor_id: actorId,
      evidence_summary: `Challenged: ${disputeReason} (Counter-evidence: ${counterEvidenceUri})`,
      timestamp_utc: new Date().toISOString(),
    });

    return true;
  }

  public getAuditLog(): KnowledgeAuditRecord[] {
    return this.auditLog;
  }
}

export const knowledgeRegistryService = KnowledgeRegistryService.getInstance();
