import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, Optional } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, timeout } from 'rxjs';
import { IntelligenceApiService } from './intelligence-api.service';
import { StateService } from '@app/services/state.service';
import { atomicToDisplay } from '../portfolio/shared/exact';
import { capturedTemplateContext, observedUtc, sameTemplateContext, templateWeight, validTemplateContext } from './mining-template-observation';

@Component({
  selector: 'app-mining-templates',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header">
        <div class="title-row">
          <h1>Mining Templates</h1>
          <span class="badge" [ngClass]="activeSourceCount > 0 ? 'badge-success' : 'badge-secondary'" *ngIf="overview">
            {{ activeSourceCount }} reported active / {{ overview.sources.length }} configured sources
          </span>
          <span class="badge badge-secondary" *ngIf="!overview && loadingOverview">
            Querying Template Endpoints...
          </span>
        </div>
        <p class="subtitle">
          Collected node templates and local projections. Differences do not establish miner policy or explain mining decisions.
        </p>
      </header>

      <p>Selected source route: {{ network }}. Observed identity is not an independent operator profile or miner identity.</p>
      <p *ngIf="overview?.current_observation_context as context">Observed genesis: {{ context.genesis_hash }}; block one: {{ context.block_one_hash }}; checkpoint: {{ context.checkpoint.height }} / {{ context.checkpoint.block_hash }}. Signet challenge: {{ context.signet_challenge || 'Not applicable' }}.</p>
      <p *ngIf="overview && !overview.current_observation_context">Current observed chain identity unavailable. Retained templates may have historical observations.</p>
      <button type="button" class="btn btn-outline-secondary mb-3" [disabled]="loadingOverview" (click)="refresh()">Refresh templates</button>
      <div *ngIf="overviewError" role="alert" class="alert alert-danger mb-4">
        {{ overviewError }}
      </div>

      <!-- Sources Status Grid -->
      <section *ngIf="overview?.sources" class="row g-3 mb-4">
        <div *ngFor="let source of overview.sources" class="col-md-4">
          <div class="card p-3 bg-dark-subtle h-100">
            <div class="d-flex justify-content-between">
              <span class="badge badge-primary">{{ source.source_type | uppercase }}</span>
              <span class="badge" [ngClass]="{ 'badge-success': source.status === 'active', 'badge-warning': source.status === 'degraded', 'badge-danger': source.status === 'offline', 'badge-secondary': source.status === 'not_collected' }">{{ source.status | uppercase }}</span>
            </div>
            <h5 class="mt-2 mb-1">{{ source.name }}</h5>
            <div class="small text-muted font-monospace text-break">{{ source.source_id }}</div>
            <div class="small text-muted mt-2">{{ !source.software_version || source.software_version === 'unknown until first template' ? 'Software version not reported' : source.software_version }}</div>
            <div class="small text-muted">Last collection: {{ source.last_template_at || 'Not collected' }}</div>
            <p *ngIf="source.last_error">{{ source.last_error }}</p>
          </div>
        </div>
      </section>

      <!-- Candidate Templates -->
      <section class="card mb-4" *ngIf="overview && overview.latest_templates">
        <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <h4 class="mb-0">Latest templates</h4>
          <button
            type="button"
            class="btn btn-sm btn-primary"
            [disabled]="loadingDiff || overview.latest_templates.length < 2"
            (click)="compareActiveTemplates()"
          >
            {{ loadingDiff ? 'Analyzing Diff...' : 'Diff Selected Templates' }}
          </button>
        </div>
        <div class="card-body">
          <p>Newest {{ overview.latest_templates.length }} of {{ overview.candidate_templates_count }} retained templates. Transaction IDs are limited to 5,000 per template.</p>
          <label for="templateA">Template A</label><select id="templateA" class="form-select" [(ngModel)]="selectedTemplateA" (ngModelChange)="invalidateDiff()"><option *ngFor="let t of overview.latest_templates" [value]="t.template_id">{{ t.template_id }} · {{ t.source_name }} · height {{ t.height }}</option></select>
          <label for="templateB">Template B</label><select id="templateB" class="form-select" [(ngModel)]="selectedTemplateB" (ngModelChange)="invalidateDiff()"><option *ngFor="let t of overview.latest_templates" [value]="t.template_id">{{ t.template_id }} · {{ t.source_name }} · height {{ t.height }}</option></select>
          <p *ngIf="diffError" role="alert">{{ diffError }}</p>
        </div>
        <div class="table-responsive" tabindex="0" role="region" aria-label="Collected mining templates">
          <table class="table table-hover mb-0">
            <thead>
              <tr>
                <th>Template ID</th>
                <th>Source</th>
                <th>Height</th>
                <th>Transactions</th>
                <th>Non-coinbase transaction weight</th>
                <th>Fees</th>
                <th>Transaction-order fingerprint</th>
                <th>Parent block</th>
                <th>Observed UTC</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let tmpl of overview.latest_templates">
                <td class="font-monospace fw-bold">{{ tmpl.template_id }}</td>
                <td>{{ tmpl.source_name }}</td>
                <td>{{ tmpl.height }}</td>
                <td>{{ tmpl.tx_count | number }} ({{ tmpl.txids.length }} IDs returned{{ tmpl.txids_truncated ? '; truncated' : '' }})</td>
                <td>{{ formatWeight(tmpl.total_weight, tmpl.estimated_weight, tmpl.weight_basis) }}</td>
                <td>{{ formatFees(tmpl.total_fees_sats) }}</td>
                <td class="font-monospace small text-muted">{{ tmpl.fingerprint_hash | slice:0:16 }}...</td>
                <td class="font-monospace small text-break">{{ tmpl.prev_block_hash }}</td>
                <td>{{ tmpl.observed_at_utc }}<p>{{ tmpl.observation_context?.provenance || 'Observed chain identity unavailable' }}</p><p *ngIf="tmpl.source_type === 'mempool_projection'">Core template input: {{ tmpl.observation_context?.input_core_template_id || 'Not reported' }}</p></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Template Diff View -->
      <section class="card mb-4" *ngIf="activeDiff">
        <div class="card-header">
          <h4 class="mb-0">Template Divergence Analysis</h4>
          <p>{{ activeDiff.comparison_context }}. Changes list at most 5,000 IDs per direction.</p>
        </div>
        <div class="card-body">
          <div class="row text-center g-3 mb-3">
            <div class="col-md-4">
              <div class="p-3 rounded bg-dark-subtle h-100">
                <div class="small text-muted">Similarity Score</div>
                <div class="h3 my-1 text-primary">{{ (activeDiff.similarity_score * 100).toFixed(1) }}%</div>
                <div class="small text-muted">Source-reported set overlap</div>
                <p *ngIf="diffMembershipPartial">Full transaction membership unavailable to this browser. Bounded change lists and overlap come from the source; local set verification is partial.</p>
              </div>
            </div>
            <div class="col-md-4">
              <div class="p-3 rounded bg-dark-subtle h-100">
                <div class="small text-muted">Fee Differential</div>
                <div class="h3 my-1">{{ activeDiff.fee_delta_sats === null ? 'Not comparable' : activeDiff.fee_delta_sats + ' sats' }}</div>
                <div class="small text-muted">Template B minus template A</div>
              </div>
            </div>
            <div class="col-md-4">
              <div class="p-3 rounded bg-dark-subtle h-100">
                <div class="small text-muted">Weight Differential</div>
                <div class="h3 my-1">{{ activeDiff.weight_delta === null ? 'Not measured or comparable' : activeDiff.weight_delta + ' WU' }}</div>
                <div class="small text-muted">Template B minus template A</div>
              </div>
            </div>
          </div>
          <div class="alert alert-secondary mb-0" *ngIf="activeDiff.explanation">
            <strong>Observatory Finding:</strong> {{ activeDiff.explanation }}
          </div>
        </div>
      </section>
    </div>
  `,
  styles: [`
    .intelligence-page { padding-top: 2rem; padding-bottom: 4rem; }
    .page-header { margin-bottom: 2rem; }
    .title-row { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
    .badge {
      display: inline-block; padding: 0.35em 0.65em; font-size: 0.75em;
      font-weight: 700; line-height: 1; text-align: center; white-space: nowrap;
      vertical-align: baseline; border-radius: 0.25rem;
    }
    .badge-primary { background-color: var(--primary, #0d6efd); color: #fff; }
    .badge-success { background-color: var(--success, #198754); color: #fff; }
  `],
})
export class MiningTemplatesComponent implements OnInit, OnDestroy {
  overview: any = null;
  loadingOverview = false;
  overviewError: string | null = null;

  activeDiff: any = null;
  loadingDiff = false;

  diffMembershipPartial = false;
  selectedTemplateA = ''; selectedTemplateB = ''; diffError: string | null = null;
  private overviewRead?: Subscription; private diffRead?: Subscription; private networkRead?: Subscription;
  private revision = 0; private destroyed = false;

  constructor(private api: IntelligenceApiService, private cdr: ChangeDetectorRef, @Optional() private state: StateService = null) {}
  get network(): string { return this.state?.network || this.state?.env?.ROOT_NETWORK || 'mainnet'; }
  get activeSourceCount(): number { return this.overview?.sources?.filter((s: any) => s.status === 'active').length ?? 0; }
  formatFees(value: unknown): string { return integer(value) ? atomicToDisplay(String(value), 8) + ' BTC' : 'Not reported'; }
  formatWeight(value: unknown, estimate?: unknown, basis?: unknown): string { return templateWeight(value, estimate, basis); }
  ngOnInit(): void {
    let context = this.network;
    this.refresh();
    this.networkRead = this.state?.networkChanged$.subscribe(() => {
      if (this.network !== context) { context = this.network; this.refresh(); }
    });
  }
  invalidateDiff(): void { this.revision++; this.diffRead?.unsubscribe(); this.activeDiff = null; this.diffMembershipPartial = false; this.loadingDiff = false; this.diffError = null; this.cdr.markForCheck(); }
  refresh(): void {
    if (this.destroyed) { return; }
    this.overviewRead?.unsubscribe(); this.invalidateDiff(); this.overview = null; this.selectedTemplateA = ''; this.selectedTemplateB = ''; this.overviewError = null; this.loadingOverview = true;
    const revision = this.revision, network = this.network;
    this.overviewRead = this.api.getTemplateOverview$().pipe(timeout(15000)).subscribe({ next: res => {
      if (this.destroyed || revision !== this.revision || network !== this.network) { return; }
      this.loadingOverview = false;
      if (!validOverview(res, network)) { this.overviewError = 'Template overview contains invalid or mismatched observations.'; this.cdr.markForCheck(); return; }
      this.overview = res; this.selectedTemplateA = res.latest_templates[0]?.template_id ?? ''; this.selectedTemplateB = res.latest_templates[1]?.template_id ?? ''; this.cdr.markForCheck();
    }, error: err => { if (this.destroyed || revision !== this.revision || network !== this.network) { return; } this.loadingOverview = false; this.overviewError = err?.error?.error || 'Mining template source unavailable. Refresh to retry.'; this.cdr.markForCheck(); } });
  }
  compareActiveTemplates(): void {
    if (this.destroyed || this.loadingDiff || !this.overview) { return; }
    this.invalidateDiff(); const revision = this.revision, network = this.network;
    const a = this.overview.latest_templates.find((t: any) => t.template_id === this.selectedTemplateA), b = this.overview.latest_templates.find((t: any) => t.template_id === this.selectedTemplateB);
    if (!a || !b || a.template_id === b.template_id) { this.diffError = 'Select two distinct collected templates.'; return; }
    if (a.height !== b.height || a.prev_block_hash !== b.prev_block_hash) { this.diffError = 'These templates extend different heights or parents and are not directly comparable.'; return; }
    this.loadingDiff = true;
    this.diffRead = this.api.diffTemplates$(a.template_id, b.template_id).pipe(timeout(15000)).subscribe({ next: diff => {
      if (this.destroyed || revision !== this.revision || network !== this.network || a.template_id !== this.selectedTemplateA || b.template_id !== this.selectedTemplateB) { return; }
      this.loadingDiff = false;
      if (!validDiff(diff, a, b)) { this.diffError = 'Returned template difference does not match the selected identities or observations.'; this.cdr.markForCheck(); return; }
      this.diffMembershipPartial = a.tx_count > a.txids.length || b.tx_count > b.txids.length; this.activeDiff = diff; this.cdr.markForCheck();
    }, error: () => { if (this.destroyed || revision !== this.revision || network !== this.network) { return; } this.loadingDiff = false; this.diffError = 'Template comparison unavailable. Retry the selected pair.'; this.cdr.markForCheck(); } });
  }
  ngOnDestroy(): void { this.destroyed = true; this.overviewRead?.unsubscribe(); this.networkRead?.unsubscribe(); this.invalidateDiff(); }
}

function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function text(value: unknown, max = 256): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max; }
function hash(value: unknown): boolean { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value); }
const utc = observedUtc;
function ids(value: unknown): value is string[] { return Array.isArray(value) && value.length <= 5000 && value.every(hash) && new Set(value).size === value.length; }
function validOverview(value: any, network: string): boolean {
  if (value?.configured_network !== undefined && value.configured_network !== network || value?.current_observation_context != null && !validTemplateContext(value.current_observation_context,network)) { return false; }
  if (!value || !Array.isArray(value.sources) || value.sources.length > 2 || !integer(value.sources_count) || value.sources_count !== value.sources.length || !integer(value.candidate_templates_count) || value.candidate_templates_count > 200 || !Array.isArray(value.latest_templates) || value.latest_templates.length > 24 || value.latest_templates.length !== Math.min(24,value.candidate_templates_count)) { return false; }
  const sources = new Map<string, any>();
  for (const source of value.sources) {
    if (!source || !text(source.source_id) || sources.has(source.source_id) || !text(source.name) || !['core_gbt','mempool_projection'].includes(source.source_type) || !['active','degraded','offline','not_collected'].includes(source.status) || !(source.software_version === null || text(source.software_version)) || !(source.last_template_at === null || utc(source.last_template_at)) || !(source.last_error === null || text(source.last_error,4096))) { return false; }
    sources.set(source.source_id,source);
  }
  const seen = new Set<string>();
  return value.latest_templates.every((t: any) => {
    const source = sources.get(t?.source_id);
    if (!t || !source || !text(t.template_id,128) || seen.has(t.template_id) || t.source_type !== source.source_type || t.source_name !== source.name || !integer(t.height) || !hash(t.prev_block_hash) || !integer(t.tx_count) || !(t.total_weight === null || integer(t.total_weight)) || !integer(t.total_fees_sats) || !hash(t.fingerprint_hash) || !utc(t.observed_at_utc) || !ids(t.txids) || t.txids.length !== Math.min(5000,t.tx_count) || !(t.sigops_count === null || integer(t.sigops_count)) || !(t.coinbase_value_sats === null || integer(t.coinbase_value_sats))) { return false; }
    if (t.configured_network !== undefined && t.configured_network !== network || t.observation_context != null && (!validTemplateContext(t.observation_context,network) || t.observation_context.checkpoint.height + 1 !== t.height || t.observation_context.checkpoint.block_hash !== t.prev_block_hash || t.observation_context.provenance !== (t.source_type === 'core_gbt' ? 'bitcoin-core-gbt' : 'backend-mempool-projection') || Date.parse(t.observation_context.observed_at_utc) > Date.parse(t.observed_at_utc))) { return false; }
    if (t.weight_basis !== undefined && (t.source_type === 'core_gbt' ? t.weight_basis !== 'core-transaction-weights' || !integer(t.total_weight) || t.estimated_weight !== null : t.weight_basis !== 'vsize-derived-estimate' || t.total_weight !== null || !integer(t.estimated_weight))) { return false; }
    if (t.txids_returned_count !== undefined && t.txids_returned_count !== t.txids.length || t.txids_truncated !== undefined && t.txids_truncated !== (t.tx_count > t.txids.length)) { return false; }
    seen.add(t.template_id); return true;
  });
}
function validDiff(value: any, a: any, b: any): boolean {
  const ca = a.observation_context ?? null, cb = b.observation_context ?? null;
  const comparable = sameTemplateContext(ca,cb);
  const expectedContext = !ca || !cb ? 'unavailable' : comparable ? 'same-observed-context' : 'different-observed-context';
  const fullMembership = a.tx_count === a.txids.length && b.tx_count === b.txids.length;
  const setA = new Set<string>(a.txids), setB = new Set<string>(b.txids);
  const expectedAdded = b.txids.filter((id: string) => !setA.has(id)), expectedRemoved = a.txids.filter((id: string) => !setB.has(id));
  const expectedSimilarity = Number((a.txids.filter((id: string) => setB.has(id)).length / Math.max(1,a.txids.length,b.txids.length)).toFixed(4));
  const expectedFee = comparable ? b.total_fees_sats - a.total_fees_sats : null;
  const expectedWeight = comparable && a.total_weight !== null && b.total_weight !== null ? b.total_weight - a.total_weight : null;
  return !!value && value.template_a_id === a.template_id && value.template_b_id === b.template_id && value.height === a.height && typeof value.similarity_score === 'number' && Number.isFinite(value.similarity_score) && value.similarity_score >= 0 && value.similarity_score <= 1 && (!fullMembership || value.similarity_score === expectedSimilarity) && ids(value.added_to_b) && ids(value.removed_from_b) && integer(value.reordered_count) && value.reordered_count <= Math.min(a.tx_count,b.tx_count) &&
    (!fullMembership || JSON.stringify(value.added_to_b) === JSON.stringify(expectedAdded) && JSON.stringify(value.removed_from_b) === JSON.stringify(expectedRemoved)) && value.comparison_context === expectedContext && capturedTemplateContext(value.observation_context_a,ca) && capturedTemplateContext(value.observation_context_b,cb) &&
    value.fee_delta_sats === expectedFee && value.weight_delta === expectedWeight && text(value.explanation,4096);
}
