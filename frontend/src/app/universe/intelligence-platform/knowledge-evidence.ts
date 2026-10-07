export interface KnowledgeLabel {
  label_id: string; entity_id: string; entity_type: string; name: string; category: string;
  confidence_level: number; confidence_score: number; status: string; source: string;
  evidence: Array<{ evidence_type: string; reference_uri: string; description: string; verified_at_utc: string | null }>;
}
export interface KnowledgeAudit {
  audit_id: string; label_id: string; action: string; actor_id: string; evidence_summary: string; timestamp_utc: string;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max=1024): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const member = (value: unknown, choices: string[]): boolean => typeof value === 'string' && choices.includes(value);
const utc = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function rows(value: unknown, schema: string, network: string, field: string): unknown[] {
  if (!object(value) || value.schema !== schema || value.network !== network || !Array.isArray(value[field]) ||
      value[field].length > 200 || value.count !== value[field].length) { throw new Error('Mismatched or malformed selected-network knowledge response.'); }
  return value[field];
}
export function checkedKnowledgeLabels(value: unknown, network: string): KnowledgeLabel[] {
  const result=rows(value,'universe-knowledge-labels-v1',network,'labels');const ids=new Set<string>();
  for (const item of result) {
    if (!object(item) || !text(item.label_id,160) || ids.has(item.label_id) || !text(item.entity_id,160) || !text(item.name,128) ||
        !member(item.entity_type,['address','entity','xpub','pool']) || !member(item.category,['exchange','mining_pool','custodian','merchant','defi','infrastructure']) ||
        typeof item.confidence_level !== 'number' || ![1,2,3].includes(item.confidence_level) || typeof item.confidence_score !== 'number' || !Number.isFinite(item.confidence_score) || item.confidence_score < 0 || item.confidence_score > 1 ||
        !member(item.status,['verified','contested','provisional']) || !member(item.source,['pools_definition','submitted']) ||
        !utc(item.created_at) || !utc(item.updated_at) || !Array.isArray(item.evidence) || item.evidence.length > 1024 ||
        item.evidence.some(e=>!object(e) || !member(e.evidence_type,['bip322_signature','proof_of_reserves','public_disclosure','on_chain_multisig','coinbase_tag','payout_address']) || typeof e.reference_uri !== 'string' || e.reference_uri.length > 1024 || (e.reference_uri.length === 0 && item.source !== 'pools_definition') || !text(e.description) || !(e.verified_at_utc === null || utc(e.verified_at_utc)))) { throw new Error('Malformed knowledge attribution evidence.'); }
    ids.add(item.label_id);
  }
  return result as KnowledgeLabel[];
}
export function checkedKnowledgeAudit(value: unknown, network: string): KnowledgeAudit[] {
  const result=rows(value,'universe-knowledge-audit-v1',network,'audit_events');const ids=new Set<string>();
  for (const item of result) {
    if (!object(item) || !text(item.audit_id,160) || ids.has(item.audit_id) || !text(item.label_id,160) || !text(item.actor_id,160) ||
        !member(item.action,['created','updated','challenged','verified','rejected']) || !text(item.evidence_summary) || !utc(item.timestamp_utc)) { throw new Error('Malformed knowledge audit evidence.'); }
    ids.add(item.audit_id);
  }
  return result as KnowledgeAudit[];
}
