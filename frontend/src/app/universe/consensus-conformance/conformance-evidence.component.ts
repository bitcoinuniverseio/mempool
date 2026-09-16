import { Component, Input, OnInit, OnDestroy, Inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Subscription, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { ConsensusConformanceApiService } from './consensus-conformance.service';
@Component({
  selector: 'app-conformance-evidence',
  standalone: true,
  styles: ['nav { gap: 1rem; }'],
  imports: [CommonModule, FormsModule, RouterModule, RelativeUrlPipe],
  template: ` <section class="container-xl py-4">
    <h1>{{ title }}</h1>
    <p>
      Bounded local engine evidence. Parsing success is not consensus validity; a completed campaign is not full
      conformance certification.
    </p>
    <nav class="d-flex flex-wrap gap-3 mb-4" aria-label="Conformance pages">
      <a *ngFor="let link of links" [routerLink]="link.path | relativeUrl">{{ link.label }}</a>
    </nav>
    <p role="status" *ngIf="loading">Loading authenticated evidence…</p>
    <p class="alert alert-warning" role="alert" *ngIf="error">{{ error }}</p>
    <ng-container *ngIf="value">
      <ng-container *ngIf="mode === 'overview' || mode === 'differential' || mode === 'corpora'">
        <p>{{ value.scope }}</p>
        <p>
          Runner availability: <strong>{{ value.availability }}</strong>
        </p>
        <dl class="row">
          <dt class="col-sm-6">Measured input cases</dt>
          <dd class="col-sm-6">{{ value.total_differential_cases }}</dd>
          <dt class="col-sm-6">Measured implementations</dt>
          <dd class="col-sm-6">{{ value.total_implementations_evaluated }}</dd>
          <dt class="col-sm-6">Observed library or policy differences</dt>
          <dd class="col-sm-6">{{ value.divergences_classified_count }}</dd>
          <dt class="col-sm-6">Authenticated machine-proved artifacts</dt>
          <dd class="col-sm-6">{{ value.machine_proved_formal_theorems_count }}</dd>
        </dl>
        <h2 class="h4">Pinned engines</h2>
        <p *ngIf="!value.implementations?.length">No verified engine configuration is available.</p>
        <ul>
          <li *ngFor="let engine of value.implementations">
            {{ engine.name }} {{ engine.version }}: {{ engine.health_status
            }}<small class="d-block text-break">Executable or source digest: {{ engine.build_hash }}</small>
          </li>
        </ul>
        <h2 class="h4">Executable bounded corpus targets</h2>
        <ul>
          <li *ngFor="let t of value.targets">
            <strong>{{ t.name }}</strong
            >: {{ t.description }}
          </li>
        </ul>
        <p>
          Corpus inputs and measured outcomes are retained with each case. Branch coverage and automatic minimization
          have not been measured.
        </p>
        <form class="card card-body mb-4" (ngSubmit)="runCampaign()">
          <h2 class="h4">Run an authorized local campaign</h2>
          <label for="conformance-target">Target</label
          ><select
            id="conformance-target"
            class="form-control mb-2"
            name="target"
            [(ngModel)]="target"
            (ngModelChange)="invalidateResult()"
          >
            <option *ngFor="let t of value.targets" [value]="t.target_id">{{ t.name }}</option></select
          ><label for="conformance-seed">Nonnegative integer seed</label
          ><input
            id="conformance-seed"
            class="form-control mb-2"
            type="number"
            min="0"
            step="1"
            name="seed"
            [(ngModel)]="seed"
            (ngModelChange)="invalidateResult()"
          /><label for="conformance-token">Operator execution token</label
          ><input
            id="conformance-token"
            class="form-control mb-2"
            type="password"
            autocomplete="off"
            name="token"
            [(ngModel)]="token"
            (ngModelChange)="invalidateResult()"
          />
          <p class="small">
            Use only your authorized operator token on a trusted local runner. It stays in page memory and is cleared on
            navigation or backend changes. Execution may create and mine an isolated regtest chain; no production chain
            is used.
          </p>
          <button id="conformance-run" class="btn btn-primary" [disabled]="busy || !token">
            {{ busy ? 'Executing bounded corpus…' : 'Run bounded campaign' }}
          </button>
        </form>
        <h2 class="h4">Remaining acceptance</h2>
        <ul>
          <li *ngFor="let item of value.unsupported_acceptance">{{ item }}</li>
        </ul>
      </ng-container>
      <ng-container *ngIf="mode === 'cases'"
        ><p *ngIf="!value.cases?.length">No authenticated measured cases are available.</p>
        <ul>
          <li *ngFor="let c of value.cases">
            <a [routerLink]="['/labs/consensus/case' | relativeUrl, c.case_id]">{{ c.title }}</a>:
            {{ c.has_difference ? 'Observed difference' : 'No difference in measured outputs' }}; {{ c.target }}
          </li>
        </ul></ng-container
      >
      <ng-container *ngIf="mode === 'case'"
        ><h2 class="h4">{{ value.title }}</h2>
        <p class="text-break">Case: {{ value.case_id }}</p>
        <p>{{ value.scope }}</p>
        <p>
          Classification: {{ value.mismatch_class }}. Severity: {{ value.severity }}. Automatic minimization:
          {{ value.minimization_performed ? 'performed' : 'not performed' }}.
        </p>
        <label for="conformance-case-hex">Recorded input hex</label
        ><textarea
          id="conformance-case-hex"
          class="form-control font-monospace"
          rows="4"
          readonly
          [value]="value.input_hex_sample"
        ></textarea>
        <h3 class="h5 mt-3">Measured engine outcomes</h3>
        <div *ngFor="let o of value.implementation_outcomes" class="card card-body mb-2">
          <strong>{{ o.implementation_id }}: {{ o.status }}</strong
          ><span>{{ o.execution_time_ms | number: '1.2-3' }} ms ({{ o.timing_scope }})</span
          ><code class="text-break">{{ o | json }}</code>
        </div>
        <h3 class="h5">Independent vector expectations</h3>
        <p *ngFor="let e of value.expectations">
          {{ e.implementation_id }} expected {{ e.expected }}, observed {{ e.actual }}:
          {{ e.passed ? 'matched' : 'FAILED' }}
        </p>
        <label for="conformance-token">Operator execution token</label
        ><input
          id="conformance-token"
          class="form-control mb-2"
          type="password"
          autocomplete="off"
          [(ngModel)]="token"
          (ngModelChange)="invalidateResult()"
        /><button id="conformance-replay" class="btn btn-primary" (click)="replay()" [disabled]="busy || !token">
          {{ busy ? 'Replaying recorded input…' : 'Replay actual engines' }}
        </button></ng-container
      >
      <ng-container *ngIf="mode === 'formal'"
        ><p>{{ value.availability }}</p>
        <p *ngIf="!value.formal_artifacts?.length">
          No authenticated machine-checked proof is available from this runner.
        </p>
        <article *ngFor="let artifact of value.formal_artifacts">
          <h2 class="h4">{{ artifact.title }}</h2>
          <p>{{ artifact.scope }}</p>
          <pre>{{ artifact | json }}</pre>
        </article></ng-container
      >
      <ng-container *ngIf="mode === 'specifications'"
        ><p>BIP references are specifications, not evidence that this runner formally proved them.</p>
        <ul>
          <li *ngFor="let bip of [141, 340, 341, 342]">
            <a [href]="'https://github.com/bitcoin/bips/blob/master/bip-' + bip + '.mediawiki'">BIP {{ bip }}</a>: no
            machine-proof claim from this runner.
          </li>
        </ul></ng-container
      >
    </ng-container>
    <article class="alert alert-info mt-4" id="conformance-result" *ngIf="result">
      <h2 class="h4">
        {{
          mode === 'case'
            ? result.reproduced
              ? 'Recorded outcomes reproduced'
              : 'Replay outcomes differ'
            : 'Campaign ' + result.status
        }}
      </h2>
      <p>{{ result.scope }}</p>
      <p *ngIf="mode !== 'case'">
        {{ result.total_inputs_evaluated }} inputs executed; {{ result.divergences_found }} observed differences;
        {{ result.expectation_failures }} failed vector expectations.
      </p>
      <a *ngIf="mode !== 'case'" [routerLink]="'/labs/consensus/cases' | relativeUrl"
        >Inspect measured cases and replay</a
      >
      <pre class="text-wrap text-break">{{ result | json }}</pre>
    </article>
  </section>`,
})
export class ConformanceEvidenceComponent implements OnInit, OnDestroy {
  @Input() mode = 'overview';
  value: any = null;
  result: any = null;
  loading = false;
  error: string | null = null;
  busy = false;
  token = '';
  target = 'transaction_parse';
  seed = 42;
  private request?: Subscription;
  private read?: Subscription;
  private generation = 0;
  links = [
    { label: 'Overview', path: '/labs/consensus/conformance' },
    { label: 'Differential campaigns', path: '/labs/consensus/differential' },
    { label: 'Measured cases', path: '/labs/consensus/cases' },
    { label: 'Formal proofs', path: '/labs/consensus/formal' },
    { label: 'BIP references', path: '/labs/consensus/specifications' },
    { label: 'Corpora', path: '/labs/consensus/corpora' },
  ];
  get title() {
    return (
      {
        overview: 'Consensus conformance evidence',
        differential: 'Bounded differential campaigns',
        corpora: 'Measured corpora and seed inputs',
        cases: 'Authenticated execution cases',
        case: 'Recorded case and replay',
        formal: 'Formal proof evidence',
        specifications: 'BIP specification references',
      } as any
    )[this.mode];
  }
  constructor(
    @Inject(ActivatedRoute) private route: ActivatedRoute,
    @Inject(ConsensusConformanceApiService) private api: ConsensusConformanceApiService,
    @Inject(ChangeDetectorRef) private cdr: ChangeDetectorRef
  ) {}
  ngOnInit() {
    this.read = this.route.paramMap
      .pipe(
        switchMap((params) => {
          this.reset();
          const id = params.get('caseId');
          if (this.mode === 'case' && !id)
            return of({ loading: false, value: null, error: 'This address does not name a case.' });
          return this.api.watch$(
            this.mode === 'case'
              ? '/cases/' + encodeURIComponent(id ?? '')
              : this.mode === 'cases'
                ? '/cases'
                : this.mode === 'formal'
                  ? '/formal-artifacts'
                  : '/overview'
          );
        })
      )
      .subscribe((state) => {
        if (state.loading) this.reset();
        this.loading = state.loading;
        this.value = state.value;
        this.error = state.error;
        this.cdr.markForCheck();
      });
  }
  invalidateResult() {
    this.generation++;
    this.request?.unsubscribe();
    this.result = null;
    this.busy = false;
    this.error = null;
  }
  private reset() {
    this.invalidateResult();
    this.value = null;
    this.token = '';
  }
  runCampaign() {
    if (!Number.isSafeInteger(this.seed) || this.seed < 0) {
      this.error = 'Enter a nonnegative safe integer seed.';
      return;
    }
    if (!this.token || this.busy) return;
    this.execute(this.api.startCampaign$(this.target, this.seed, this.token));
  }
  replay() {
    if (!this.value?.case_id || !this.token || this.busy) return;
    this.execute(this.api.replayCase$(this.value.case_id, this.token));
  }
  private execute(call: any) {
    this.invalidateResult();
    const generation = this.generation;
    this.busy = true;
    this.request = call.subscribe({
      next: (result: any) => {
        if (generation !== this.generation) return;
        this.result = result;
        this.busy = false;
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        if (generation !== this.generation) return;
        this.result = null;
        this.busy = false;
        this.error =
          e?.status === 403
            ? 'Operator token rejected.'
            : (e?.error?.error ?? 'Execution failed; no completed result is claimed.');
        this.cdr.markForCheck();
      },
    });
  }
  ngOnDestroy() {
    this.reset();
    this.read?.unsubscribe();
  }
}
