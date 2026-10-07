/** Observed source identity; an independent operator profile is still needed for native qualification. */
export interface TemplateObservationContext {
  readonly schema: 'universe-template-observation-context-v1';
  readonly chain: 'bitcoin'; readonly network: string;
  readonly genesis_hash: string; readonly block_one_hash: string; readonly signet_challenge: string | null;
  readonly checkpoint: { readonly height: number; readonly block_hash: string };
  readonly observed_at_utc: string;
  readonly provenance: 'bitcoin-core-gbt' | 'backend-mempool-projection';
  readonly input_core_template_id: string | null;
}
export const safeQuantity = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const hash = (value: unknown): boolean => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export function observedUtc(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,19) === value.slice(0,19);
}
export function validTemplateContext(value: any, network: string): value is TemplateObservationContext {
  return !!value && value.schema === 'universe-template-observation-context-v1' && value.chain === 'bitcoin' && value.network === network && hash(value.genesis_hash) && hash(value.block_one_hash) &&
    (network === 'signet' ? typeof value.signet_challenge === 'string' && /^(?:[0-9a-f]{2}){1,10000}$/.test(value.signet_challenge) : value.signet_challenge === null) &&
    safeQuantity(value.checkpoint?.height) && hash(value.checkpoint.block_hash) && observedUtc(value.observed_at_utc) &&
    (value.provenance === 'bitcoin-core-gbt' ? value.input_core_template_id === null : value.provenance === 'backend-mempool-projection' && (value.input_core_template_id === null || typeof value.input_core_template_id === 'string' && value.input_core_template_id.length > 0 && value.input_core_template_id.length <= 128));
}
export function sameTemplateContext(a: TemplateObservationContext | null, b: TemplateObservationContext | null): boolean {
  return !!a && !!b && a.network === b.network && a.genesis_hash === b.genesis_hash && a.block_one_hash === b.block_one_hash && a.signet_challenge === b.signet_challenge && a.checkpoint.height === b.checkpoint.height && a.checkpoint.block_hash === b.checkpoint.block_hash;
}
export function templateWeight(value: unknown, estimate: unknown, basis: unknown): string {
  if (basis === 'vsize-derived-estimate') { return value === null && safeQuantity(estimate) ? `${estimate} WU (vsize-derived estimate; measured weight unavailable)` : 'Not reported'; }
  if (basis === undefined || basis === null) { return safeQuantity(value) ? `${value} WU (basis unavailable)` : 'Not reported'; }
  return basis === 'core-transaction-weights' && safeQuantity(value) && (estimate === null || estimate === undefined) ? `${value} WU` : 'Not reported';
}

/** Every captured observation field is bound, independent of JSON property ordering. */
export function capturedTemplateContext(a: TemplateObservationContext | null, b: TemplateObservationContext | null): boolean {
  if (a === null || b === null) { return a === b; }
  return sameTemplateContext(a,b) && a.schema === b.schema && a.chain === b.chain && a.observed_at_utc === b.observed_at_utc && a.provenance === b.provenance && a.input_core_template_id === b.input_core_template_id;
}
