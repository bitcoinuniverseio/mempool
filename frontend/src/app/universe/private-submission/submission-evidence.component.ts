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
import { PrivateSubmissionApiService } from './private-submission.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { rawTransactionId, validProvider } from './submission-validation';
const failure = (e: any) =>
  e?.error?.error || e?.message || 'Owned submission evidence unavailable.';
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
  vm: any = { loading: true };
  raw = '';
  diagnosis: any = null;
  diagnosisError = '';
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
              return { data, loading: false };
            }),
            catchError((e) => of({ error: failure(e), loading: false })),
            startWith({ loading: true })
          );
        })
      )
      .subscribe((v) => {
        this.vm = v;
        this.cdr.markForCheck();
      });
  }
  clear(): void {
    this.request?.unsubscribe();
    this.diagnosis = null;
    this.diagnosisError = '';
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
        this.diagnosisError = failure(e);
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
