import { Component, OnDestroy, OnInit } from '@angular/core';
import { UntypedFormBuilder, UntypedFormGroup, Validators } from '@angular/forms';
import { ApiService } from '@app/services/api.service';
import { StateService } from '@app/services/state.service';
import { SeoService } from '@app/services/seo.service';
import { OpenGraphService } from '@app/services/opengraph.service';
import { defer, finalize, Subject, Subscription, takeUntil } from 'rxjs';
import { TestMempoolAcceptResult } from '@interfaces/node-api.interface';

@Component({
  selector: 'app-test-transactions',
  templateUrl: './test-transactions.component.html',
  styleUrls: ['./test-transactions.component.scss'],
  standalone: false,
})
export class TestTransactionsComponent implements OnInit, OnDestroy {
  private readonly cancelled$ = new Subject<void>();
  private readonly subscriptions = new Subscription();
  private destroyed = false;
  private revision = 0;
  private network = this.stateService.network;
  testTxsForm: UntypedFormGroup;
  error: string = '';
  results: TestMempoolAcceptResult[] = [];
  isLoading = false;
  invalidMaxfeerate = false;

  constructor(
    private formBuilder: UntypedFormBuilder,
    private apiService: ApiService,
    public stateService: StateService,
    private seoService: SeoService,
    private ogService: OpenGraphService,
  ) { }

  ngOnInit(): void {
    this.testTxsForm = this.formBuilder.group({
      txs: ['', Validators.required],
      maxfeerate: ['', Validators.min(0)]
    });

    this.subscriptions.add(this.stateService.networkChanged$.subscribe(network => {
      if (network !== this.network) { this.cancelRequests(); this.results = []; this.error = ''; this.invalidMaxfeerate = false; }
      this.network = network;
    }));

    this.seoService.setTitle($localize`:@@f74d6f23e06c5a75d95a994017c00191c162ba9f:Test Transactions`);
  }

  private cancelRequests(): void {
    this.revision++; this.cancelled$.next(); this.isLoading = false;
  }

  ngOnDestroy(): void {
    this.destroyed = true; this.cancelRequests(); this.subscriptions.unsubscribe(); this.cancelled$.complete();
  }

  private feeAmount(value: unknown): number | null {
    if (value == null || value === '') { return null; }
    const text = String(value).trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) { throw new Error('Use a nonnegative decimal amount'); }
    const [whole, fraction = ''] = text.split('.');
    if (fraction.length > 3) { throw new Error('Amount has unsupported fractional precision'); }
    const atomic = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0') || '0');
    if (atomic > BigInt(Number.MAX_SAFE_INTEGER)) { throw new Error('Amount exceeds exact supported range'); }
    return Number(atomic) / 100_000_000;
  }

  testTxs() {
    if (this.destroyed || this.isLoading) { return; }
    let txs: string[] = [];
    try {
      txs = (this.testTxsForm.get('txs')?.value as string).split(',').map(hex => hex.trim());
      if (!txs.length || txs.some(tx => !tx || !/^(?:[a-fA-F0-9]{2})+$/.test(tx))) {
        this.error = 'Enter complete transaction hex values';
        return;
      } else if (txs.length > 25) {
        this.error = 'Exceeded maximum of 25 transactions';
        return;
      }
    } catch (e) {
      this.error = e?.message;
      return;
    }

    let maxfeerate: number | null;
    this.invalidMaxfeerate = false;
    try { maxfeerate = this.feeAmount(this.testTxsForm.get('maxfeerate')?.value); }
    catch (error) { this.invalidMaxfeerate = true; this.error = 'Maximum fee rate: ' + error.message; return; }
    const revision = this.revision;
    this.isLoading = true;
    this.error = '';
    this.results = [];
    defer(() => this.apiService.testTransactions$(txs, maxfeerate === 0.1 ? null : maxfeerate)).pipe(
      takeUntil(this.cancelled$), finalize(() => { if (revision === this.revision) { this.isLoading = false; } })
    ).subscribe((result) => {
        if (this.destroyed || revision !== this.revision) { return; }
        this.results = result || [];
        this.testTxsForm.reset();
      },
      (error) => {
        if (this.destroyed || revision !== this.revision) { return; }
        if (typeof error?.error === 'string') {
          const matchText = error.error.replace(/\\/g, '').match('"message":"(.*?)"');
          this.error = matchText && matchText[1] || error.error;
        } else if (error?.message) {
          this.error = error.message;
        } else {
          this.error = 'Transaction test source is unavailable. Retry when the selected backend is ready.';
        }
      });
  }

}
