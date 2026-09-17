import {
  Component,
  Input,
  Inject,
  ChangeDetectorRef,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { combineLatest, Observable, of, Subscription } from 'rxjs';
import { catchError, map, startWith, switchMap } from 'rxjs/operators';
import {
  OrderingEvidenceState,
  PrivateSubmissionApiService,
} from './private-submission.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { rawTransactionId, validProvider } from './submission-validation';
const failure = (e: any) =>
  e?.error?.error || e?.message || 'Owned submission evidence unavailable.';
const stageOf = (e: any): string | null =>
  typeof e?.error?.stage === 'string' ? e.error.stage : null;
const statusOf = (e: any): number | null =>
  typeof e?.status === 'number' ? e.status : null;

/** Plain-language labels for the typed ordering states the backend emits. */
export const ORDERING_STATE_LABELS: Record<OrderingEvidenceState, string> = {
  publicly_observed_before_inclusion: 'Seen in this observer\'s mempool before the block included it.',
  not_observed_by_our_sensors: 'Never seen by this observer before inclusion.',
  observed_only_in_template: 'Seen only in a collected block template, not in the mempool poll.',
  provider_receipt_precedes_inclusion: 'A provider receipt predates inclusion.',
  included_without_public_observation: 'Included without any public observation by this observer.',
  ordering_changed_between_template_and_block: 'Its position changed between the collected template and the mined block.',
  dependency_required_order: 'Its position follows from a dependency on an earlier transaction in the block.',
  fee_consistent_order: 'Its position is consistent with fee-rate ordering.',
  protocol_sensitive_order: 'Its position matters to a protocol that depends on ordering.',
  insufficient_coverage: 'This observer has too little coverage of the block to say.',
  unknown: 'Unknown.',
};

@Component({
  selector: 'app-submission-evidence',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, RelativeUrlPipe],
  templateUrl: './submission-evidence.component.html',
  styles: [
    'nav{display:flex;gap:1rem;flex-wrap:wrap;margin:1rem 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}',
  ],
})
export class SubmissionEvidenceComponent implements OnInit, OnDestroy {
  @Input() view = 'overview';
  @Input() title = 'Private submission evidence';
  /**
   * loading; data; or error with the backend's typed stage and HTTP status,
   * so a 404 (transaction-not-observed, block-not-observed,
   * provider-not-in-directory) reads as "not observed here", never as an
   * empty success, and a 503 reads as an absent source.
   */
  vm: any = { loading: true };
  raw = '';
  diagnosis: any = null;
  diagnosisError = '';
  diagnosisStage: string | null = null;
  diagnosisStatus: number | null = null;
  diagnosing = false;
  private sub?: Subscription;
  private request?: Subscription;
  links = [
    ['/mempool/submission', 'Overview'],
    ['/mempool/private-broadcast', 'Broadcast'],
    ['/mempool/accelerators', 'Accelerators'],
    ['/mempool/receipts', 'Receipts'],
    ['/intelligence/ordering', 'Ordering'],
  ];
  readonly orderingLabels = ORDERING_STATE_LABELS;
  constructor(
    @Inject(PrivateSubmissionApiService)
    private api: PrivateSubmissionApiService,
    @Inject(ActivatedRoute) private route: ActivatedRoute,
    @Inject(ChangeDetectorRef) private cdr: ChangeDetectorRef
  ) {}
  ngOnInit(): void {
    this.sub = combineLatest([this.api.network$, this.route.paramMap])
      .pipe(
        switchMap(([, p]) => {
          this.clear();
          let req: Observable<any>;
          const id =
            this.view === 'provider'
              ? p.get('providerId')
              : this.view === 'tx'
                ? p.get('txid')
                : p.get('blockHash');
          if (['provider', 'tx', 'block'].includes(this.view) && !id)
            return of({
              error: 'A record identity is required.',
              loading: false,
            });
          req =
            this.view === 'provider'
              ? this.api.getAccelerator$(id!)
              : this.view === 'tx'
                ? this.api.getTxOrdering$(id!)
                : this.view === 'block'
                  ? this.api.getBlockOrdering$(id!)
                  : this.view === 'ordering'
                    ? this.api.listOrderingFindings$()
                    : this.api.getOverview$();
          return req.pipe(
            map((data) => {
              if (!data || typeof data !== 'object')
                throw Error('Malformed evidence response.');
              if (
                this.view === 'provider' &&
                (!validProvider(data) || data.provider_id !== id)
              )
                throw Error('Malformed or mismatched provider record.');
              if (this.view === 'tx' && data.txid !== id)
                throw Error('Transaction identity mismatch.');
              if (
                this.view === 'block' &&
                (data.block_hash !== id || !Array.isArray(data.transactions))
              )
                throw Error('Block identity or transactions mismatch.');
              if (this.view === 'overview' && (!data.relay || !data.queue || !data.worker))
                throw Error('Overview response carries no relay, queue or worker facts.');
              return { data, loading: false };
            }),
            catchError((e) => of({ error: failure(e), stage: stageOf(e), status: statusOf(e), loading: false })),
            startWith({ loading: true })
          );
        })
      )
      .subscribe((v) => {
        this.vm = v;
        this.cdr.markForCheck();
      });
  }
  /** A 404 names a record this observer does not hold; a 5xx names an absent source. */
  errorKind(vm: any): 'not-observed' | 'unavailable' | 'other' {
    if (vm?.status === 404) return 'not-observed';
    if (typeof vm?.status === 'number' && vm.status >= 500) return 'unavailable';
    return 'other';
  }
  orderingLabel(state: unknown): string {
    return (typeof state === 'string' && (this.orderingLabels as Record<string, string>)[state]) || 'Unknown.';
  }
  clear(): void {
    this.request?.unsubscribe();
    this.diagnosis = null;
    this.diagnosisError = '';
    this.diagnosisStage = null;
    this.diagnosisStatus = null;
    this.diagnosing = false;
    this.cdr.markForCheck();
  }
  diagnose(): void {
    this.clear();
    const raw = this.raw.trim();
    let txid: string;
    try {
      txid = /^[0-9a-f]{64}$/i.test(raw)
        ? raw.toLowerCase()
        : rawTransactionId(raw);
    } catch {
      this.diagnosisError =
        'Provide a transaction ID or complete raw transaction.';
      return;
    }
    this.diagnosing = true;
    this.request = this.api.diagnose$(raw).subscribe({
      next: (r) => {
        this.diagnosing = false;
        if (!r || r.txid?.toLowerCase() !== txid) {
          this.diagnosisError = 'Diagnosis transaction identity mismatch.';
        } else this.diagnosis = r;
        this.cdr.markForCheck();
      },
      error: (e) => {
        this.diagnosing = false;
        this.diagnosisStage = stageOf(e);
        this.diagnosisStatus = statusOf(e);
        this.diagnosisError =
          this.diagnosisStage === 'transaction-not-in-mempool'
            ? 'This transaction is not in the owned mempool, so it has no mempool facts to report: ' + failure(e)
            : failure(e);
        this.cdr.markForCheck();
      },
    });
  }
  display(v: any): string {
    return v === null || v === undefined
      ? 'Unknown'
      : typeof v === 'object'
        ? JSON.stringify(v, null, 2)
        : String(v);
  }
  ngOnDestroy(): void {
    this.clear();
    this.sub?.unsubscribe();
  }
}
