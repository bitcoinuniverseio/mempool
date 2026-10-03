import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { defer, finalize, Subscription, timeout } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { atomicBtc, checkedReconstruction, UtxoReconstructionView } from './utxo-reconstruction-view';

@Component({
  selector: 'app-utxo-reconstruction', standalone: true, imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="box my-3" aria-label="Anchored unspent output reconstruction">
      <h2 class="h5">Reconstruct unspent outputs</h2>
      <p>The native output list is unavailable. Start an independent read from confirmed history, mempool and outspend checks.
        Each Continue reads one bounded page. Outputs become eligible only after every closure check succeeds.</p>
      <button class="btn btn-primary me-2" (click)="start()" [disabled]="pending || view?.status === 'PARTIAL'">{{ view ? 'Start new reconstruction' : 'Start reconstruction' }}</button>
      <button *ngIf="view?.status === 'PARTIAL'" class="btn btn-primary me-2" (click)="advance()" [disabled]="pending">{{ error ? 'Retry page' : 'Continue reconstruction' }}</button>
      <button *ngIf="view || pending" class="btn btn-outline-secondary" (click)="cancel()">Cancel reconstruction</button>
      <p *ngIf="pending" role="status">Reading a bounded reconstruction page...</p>
      <p *ngIf="error" class="alert alert-warning" role="alert">{{ error }}</p>
      <div *ngIf="view">
        <p><strong>{{ view.status }}</strong> {{ view.reason }}</p>
        <p>Phase: {{ view.progress.phase }}. Confirmed transactions: {{ view.progress.confirmedTransactionsProcessed | number }} / {{ view.progress.confirmedTransactionsExpected | number }}.
          Mempool transactions: {{ view.progress.mempoolTransactionsProcessed | number }} / {{ view.progress.mempoolTransactionsExpected | number }}.
          Verified outputs: {{ view.progress.verifiedOutputs | number }} / {{ view.progress.candidateOutputs | number }}.</p>
        <p class="small text-break">Selected network: {{ view.network }}. Observed block {{ view.source.blockHeight }}: <code>{{ view.source.blockHash }}</code>.
          Source: <code>{{ view.source.sourceId }}</code>. Mempool identity: <code>{{ view.source.mempoolIdentity }}</code>.
          Observed {{ view.observedAt }}; session expires {{ view.expiresAt }}.</p>
        <details class="small text-break mb-3"><summary>Source identity</summary>
          <p>Genesis: <code>{{ view.source.genesisHash }}</code>. Script: <code>{{ view.source.scriptPubKey }}</code>.
            Verified {{ view.source.verifiedAt }}.</p><p *ngIf="view.source.signetChallenge">Signet challenge: <code>{{ view.source.signetChallenge }}</code>.</p>
        </details>
        <p *ngIf="view.status === 'PARTIAL'">Partial reconstruction. No eligible output list or complete balance has been established.</p>
        <p *ngIf="view.status === 'INVALIDATED' || view.status === 'BLOCKED'">Restart explicitly after the source is stable and available. Prior progress does not establish eligible outputs.</p>
        <div *ngIf="view.result">
          <p>Complete at the observed source tip and mempool identity; subsequent blocks or mempool changes require a new read.</p>
          <p>{{ view.result.outputCount | number }} outputs. Exact balance: {{ view.result.balanceAtomic }} sat ({{ btc(view.result.balanceAtomic) }} BTC).</p>
          <div tabindex="0" role="region" aria-label="Reconstructed unspent outputs, scroll horizontally" class="table-responsive">
            <table class="table"><thead><tr><th>Outpoint</th><th>Atomic amount (sat)</th><th>Status</th></tr></thead><tbody>
              <tr *ngFor="let output of visibleOutputs"><td class="text-break"><a [routerLink]="txPath(output.txid)">{{ output.txid }}</a>:{{ output.vout }}</td>
                <td>{{ output.valueAtomic }}</td><td>{{ output.status.confirmed ? 'Confirmed at ' + output.status.block_height : 'Observed in mempool' }}</td></tr>
            </tbody></table>
          </div>
          <p>Showing {{ visibleOutputs.length | number }} of {{ view.result.outputCount | number }} reconstructed outputs.</p>
          <button class="btn btn-outline-secondary" *ngIf="visibleOutputs.length < view.result.outputCount" (click)="showMore()">Show more reconstructed outputs</button>
        </div>
      </div>
    </section>`,
})
export class UtxoReconstructionComponent implements OnInit, OnChanges, OnDestroy {
  @Input() address = '';
  view: UtxoReconstructionView | null = null;
  pending = false;
  error: string | null = null;
  private network: string;
  private request?: Subscription;
  private readonly subscriptions = new Subscription();
  private revision = 0;
  private destroyed = false;
  private shown = 100;
  readonly btc = atomicBtc;

  constructor(private http: HttpClient, private state: StateService, private cd: ChangeDetectorRef) { this.network = state.network || 'mainnet'; }
  get visibleOutputs(): NonNullable<UtxoReconstructionView['result']>['items'] { return this.view?.result?.items.slice(0, this.shown) || []; }
  private prefix(network = this.network): string { return network === 'mainnet' || network === this.state.env.ROOT_NETWORK ? '' : '/' + network; }
  txPath(txid: string): string { return `${this.prefix()}/tx/${txid}`; }
  showMore(): void { this.shown += 100; }
  ngOnInit(): void {
    this.subscriptions.add(this.state.networkChanged$.subscribe(network => {
      const selected = network || 'mainnet';
      if (selected !== this.network) { this.abandon(); this.network = selected; }
    }));
  }
  ngOnChanges(): void { this.abandon(); }
  ngOnDestroy(): void { this.destroyed = true; this.abandon(); this.subscriptions.unsubscribe(); }

  private base(address = this.address, network = this.network): string {
    return `${this.prefix(network)}/api/v1/address/${encodeURIComponent(address)}/utxo-reconstruction`;
  }
  private abandon(): void {
    const old = this.view;
    this.revision++; this.request?.unsubscribe(); this.request = undefined;
    this.pending = false; this.view = null; this.error = null; this.shown = 100;
    if (old && old.status !== 'CANCELLED') {
      // Cleanup is bound to the old address/network; it never writes the next scope's UI.
      this.http.delete(this.base(old.address, old.network) + '/' + old.sessionId).pipe(timeout(5000)).subscribe({ error: () => {} });
    }
    if (!this.destroyed) { this.cd.markForCheck(); }
  }
  start(): void {
    if (this.destroyed || this.pending || this.view?.status === 'PARTIAL') { return; }
    if (!['mainnet', 'signet', 'testnet', 'testnet4', 'regtest'].includes(this.network)) {
      this.error = 'This reconstruction requires a configured Bitcoin Esplora history source on a supported Bitcoin network.'; return;
    }
    if (!/^[a-zA-Z0-9]{2,120}$/.test(this.address)) { this.error = 'This reconstruction requires a supported public address.'; return; }
    this.abandon();
    this.read('create');
  }
  advance(): void { if (!this.destroyed && !this.pending && this.view?.status === 'PARTIAL') { this.read('next'); } }
  cancel(): void {
    if (this.destroyed) { return; }
    const old = this.view;
    this.revision++; this.request?.unsubscribe(); this.request = undefined;
    this.pending = false; this.view = null;
    this.error = 'Reconstruction abandoned locally. No eligible outputs are retained.';
    if (old) { this.read('cancel', old); }
  }
  private read(action: 'create' | 'next' | 'cancel', previous = this.view): void {
    const revision = this.revision, address = this.address, network = this.network;
    this.pending = true; this.error = null;
    const path = this.base(address, network);
    this.request = defer(() => action === 'create' ? this.http.post(path, {}) : action === 'next'
      ? this.http.post(`${path}/${previous.sessionId}/next`, { cursor: previous.cursor })
      : this.http.delete(`${path}/${previous.sessionId}`)).pipe(timeout(25000), finalize(() => {
        if (!this.destroyed && revision === this.revision) { this.pending = false; this.cd.markForCheck(); }
      })).subscribe({ next: value => {
        if (this.destroyed || revision !== this.revision) { return; }
        try { this.view = checkedReconstruction(value, address, network, previous || undefined, action); }
        catch (error) { this.error = error.message; }
        this.cd.markForCheck();
      }, error: error => {
        if (this.destroyed || revision !== this.revision) { return; }
        this.error = action === 'cancel' ? 'Abandoned locally; server cleanup was not confirmed. No eligible outputs are retained. The server session expires at ' + previous.expiresAt + '.' :
          typeof error?.error?.error === 'string' ? error.error.error : 'Reconstruction source unavailable or page deadline exceeded. Retry the same page or cancel and restart.';
        this.cd.markForCheck();
      } });
  }
}
