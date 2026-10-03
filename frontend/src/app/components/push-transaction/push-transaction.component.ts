import { Component, OnDestroy, OnInit } from '@angular/core';
import { UntypedFormBuilder, UntypedFormGroup, Validators } from '@angular/forms';
import { ApiService } from '@app/services/api.service';
import { StateService } from '@app/services/state.service';
import { SeoService } from '@app/services/seo.service';
import { OpenGraphService } from '@app/services/opengraph.service';
import { seoDescriptionNetwork } from '@app/shared/common.utils';
import { ActivatedRoute, Router } from '@angular/router';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { firstValueFrom, Subject, Subscription, takeUntil } from 'rxjs';
import { TxResult } from '@interfaces/node-api.interface';

@Component({
  selector: 'app-push-transaction',
  templateUrl: './push-transaction.component.html',
  styleUrls: ['./push-transaction.component.scss'],
  standalone: false,
})
export class PushTransactionComponent implements OnInit, OnDestroy {
  private readonly cancelled$ = new Subject<void>();
  private readonly subscriptions = new Subscription();
  private destroyed = false;
  private revision = 0;
  pushTxForm: UntypedFormGroup;
  error: string = '';
  txId: string = '';
  isLoading = false;

  submitTxsForm: UntypedFormGroup;
  errorPackage: string = '';
  packageMessage: string = '';
  results: TxResult[] = [];
  invalidMaxfeerate = false;
  invalidMaxburnamount = false;
  isLoadingPackage = false;

  network = this.stateService.network;

  constructor(
    private formBuilder: UntypedFormBuilder,
    private apiService: ApiService,
    public stateService: StateService,
    private seoService: SeoService,
    private ogService: OpenGraphService,
    private route: ActivatedRoute,
    private router: Router,
    private relativeUrlPipe: RelativeUrlPipe,
  ) { }

  ngOnInit(): void {
    this.pushTxForm = this.formBuilder.group({
      txHash: ['', Validators.required],
    });

    this.submitTxsForm = this.formBuilder.group({
      txs: ['', Validators.required],
      maxfeerate: ['', Validators.min(0)],
      maxburnamount: ['', Validators.min(0)],
    });

    this.subscriptions.add(this.stateService.networkChanged$.subscribe((network) => {
      if (network !== this.network) { this.cancelRequests(); this.error = ''; this.errorPackage = ''; this.txId = ''; this.results = []; this.packageMessage = ''; }
      this.network = network;
    }));

    this.seoService.setTitle($localize`:@@f13cbfe8cfc955918e9f64466d2cafddb4760d9a:Broadcast Transaction`);
    this.seoService.setDescription($localize`:@@meta.description.push-tx:Broadcast a transaction to the ${this.stateService.network==='liquid'||this.stateService.network==='liquidtestnet'?'Liquid':'Bitcoin'}${seoDescriptionNetwork(this.stateService.network)} network using the transaction's hash.`);

    this.subscriptions.add(this.route.fragment.subscribe(async (fragment) => {
      const fragmentParams = new URLSearchParams(fragment || '');
      return this.handleColdcardPushTx(fragmentParams);
    }));
  }

  private cancelRequests(): void {
    this.revision++; this.cancelled$.next(); this.isLoading = false; this.isLoadingPackage = false;
  }

  ngOnDestroy(): void {
    this.destroyed = true; this.cancelRequests(); this.subscriptions.unsubscribe(); this.cancelled$.complete();
  }

  async postTx(hex?: string): Promise<string | null> {
    if (this.destroyed || this.isLoading || this.isLoadingPackage) { return null; }
    const revision = this.revision;
    this.isLoading = true; this.error = ''; this.txId = '';
    try {
      const txid = await firstValueFrom(this.apiService.postTransaction$(hex || this.pushTxForm.get('txHash').value).pipe(takeUntil(this.cancelled$)));
      if (this.destroyed || revision !== this.revision) { return null; }
      this.txId = txid; this.pushTxForm.reset(); return txid;
    } catch (error) {
      if (!this.destroyed && revision === this.revision) {
        const raw = typeof error.error === 'string' ? error.error : error.message;
        const message = raw?.replace(/\\/g, '').match('"message":"(.*?)"')?.[1] || raw || 'Request unavailable';
        this.error = 'Failed to broadcast transaction, reason: ' + message;
      }
      return null;
    } finally { if (revision === this.revision) { this.isLoading = false; } }
  }

  private amount(value: unknown, precision: number): number | null {
    if (value == null || value === '') { return null; }
    const text = String(value).trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) { throw new Error('Use a nonnegative decimal amount'); }
    const [whole, fraction = ''] = text.split('.');
    if (fraction.length > precision) { throw new Error('Amount has unsupported fractional precision'); }
    const atomic = BigInt(whole) * 10n ** BigInt(precision) + BigInt(fraction.padEnd(precision, '0') || '0');
    if (atomic > BigInt(Number.MAX_SAFE_INTEGER)) { throw new Error('Amount exceeds exact supported range'); }
    return Number(atomic) / 100_000_000;
  }

  submitTxs() {
    if (this.destroyed || this.isLoading || this.isLoadingPackage) { return; }
    let txs: string[] = [];
    try {
      txs = (this.submitTxsForm.get('txs')?.value as string).split(',').map(hex => hex.trim());
      if (!txs.length || txs.some(tx => !tx || !/^(?:[a-fA-F0-9]{2})+$/.test(tx))) { this.errorPackage = 'Enter complete transaction hex values'; return; }
      if (txs.length > 25) { this.errorPackage = 'Exceeded maximum of 25 transactions'; return; }
      if (txs?.length === 1 && [this.submitTxsForm.get('maxfeerate')?.value, this.submitTxsForm.get('maxburnamount')?.value].every(value => value == null || value === '')) {
        this.pushTxForm.get('txHash').setValue(txs[0]);
        this.submitTxsForm.get('txs').setValue('');
        this.postTx();
        return;
      }
    } catch (e) {
      this.errorPackage = e?.message;
      return;
    }

    let maxfeerate: number | null, maxburnamount: number | null;
    this.invalidMaxfeerate = false; this.invalidMaxburnamount = false;
    try { maxfeerate = this.amount(this.submitTxsForm.get('maxfeerate')?.value, 3); }
    catch (error) { this.invalidMaxfeerate = true; this.errorPackage = 'Maximum fee rate: ' + error.message; return; }
    try { maxburnamount = this.amount(this.submitTxsForm.get('maxburnamount')?.value, 0); }
    catch (error) { this.invalidMaxburnamount = true; this.errorPackage = 'Maximum burn amount: ' + error.message; return; }
    const revision = this.revision;
    this.isLoadingPackage = true;
    this.errorPackage = '';
    this.results = [];
    this.apiService.submitPackage$(txs, maxfeerate, maxburnamount).pipe(takeUntil(this.cancelled$))
      .subscribe((result) => {
        if (this.destroyed || revision !== this.revision) { return; }
        this.isLoadingPackage = false;

        this.packageMessage = result['package_msg'];
        for (const wtxid in result['tx-results']) {
          this.results.push(result['tx-results'][wtxid]);
        }

        this.submitTxsForm.reset();
      },
      (error) => {
        if (this.destroyed || revision !== this.revision) { return; }
        if (typeof error.error?.error === 'string') {
          const matchText = error.error.error.replace(/\\/g, '').match('"message":"(.*?)"');
          this.errorPackage = matchText && matchText[1] || error.error.error;
        } else if (error.message) {
          this.errorPackage = error.message;
        }
        this.isLoadingPackage = false;
      });
  }

  private async handleColdcardPushTx(fragmentParams: URLSearchParams): Promise<boolean> {
    // maybe conforms to Coldcard nfc-pushtx spec
    if (fragmentParams && fragmentParams.get('t')) {
      const revision = this.revision;
      try {
        const pushNetwork = fragmentParams.get('n');

        // Redirect to the appropriate network-specific URL
        if (this.stateService.network !== '' && !pushNetwork) {
          this.router.navigateByUrl(`/pushtx#${fragmentParams.toString()}`);
          return false;
        } else if (this.stateService.network !== 'testnet' && pushNetwork === 'XTN') {
          this.router.navigateByUrl(`/testnet/pushtx#${fragmentParams.toString()}`);
          return false;
        } else if (pushNetwork === 'XRT') {
          this.error = 'Regtest is not supported';
          return false;
        } else if (pushNetwork && !['XTN', 'XRT'].includes(pushNetwork)) {
          this.error = 'Invalid network';
          return false;
        }

        const rawTx = this.base64UrlToU8Array(fragmentParams.get('t'));
        if (!fragmentParams.get('c')) {
          this.error = 'Missing checksum, URL is probably truncated';
          return false;
        }
        const rawCheck = this.base64UrlToU8Array(fragmentParams.get('c'));


        // check checksum
        const hashTx = await crypto.subtle.digest('SHA-256', rawTx);
        if (this.destroyed || revision !== this.revision) { return false; }
        if (this.u8ArrayToHex(new Uint8Array(hashTx.slice(24))) !== this.u8ArrayToHex(rawCheck)) {
          this.error = 'Bad checksum, URL is probably truncated';
          return false;
        }

        const hexTx = this.u8ArrayToHex(rawTx);
        this.pushTxForm.get('txHash').setValue(hexTx);

        try {
          const txid = await this.postTx(hexTx);
          if (!txid || this.destroyed) { return false; }
          this.router.navigate([this.relativeUrlPipe.transform('/tx'), txid]);
        } catch (e) {
          // error already handled
          return false;
        }

        return true;
      } catch (e) {
        this.error = 'Failed to decode transaction';
        return false;
      }
    }
  }

  private base64UrlToU8Array(base64Url: string): Uint8Array {
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/').padEnd(base64Url.length + (4 - base64Url.length % 4) % 4, '=');
    const binaryString = atob(base64);
    return new Uint8Array([...binaryString].map(char => char.charCodeAt(0)));
  }

  private u8ArrayToHex(arr: Uint8Array): string {
    return Array.from(arr).map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
}
