import { Component, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Observable, Subject, combineLatest, of } from 'rxjs';
import { catchError, map, startWith, switchMap, takeUntil, distinctUntilChanged } from 'rxjs/operators';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { StateService } from '@app/services/state.service';
import { UniverseApiService } from '../universe-api.service';
import { ArkVtxo } from '../universe.types';

interface View { kind: 'loading' | 'error' | 'ready'; id: string; network: string; value?: ArkVtxo; error?: string; }
export function checkedVtxo(value: unknown, id: string, network: string): ArkVtxo {
  const v = value as ArkVtxo & { network?: string };
  if (!v || v.vtxoId !== id || v.network !== network || typeof v.batchId !== 'string' || !v.batchId ||
      typeof v.amountSats !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(v.amountSats) || BigInt(v.amountSats) > 2100000000000000n ||
      !['spendable','settled','exiting','expired'].includes(v.status) ||
      ![v.timelockExpiryBlocks,v.treeDepth,v.treeIndex].every(n => Number.isSafeInteger(n) && n >= 0) ||
      ![v.userPubkey,v.aspPubkey].every(k => typeof k === 'string' && /^(?:02|03)?[0-9a-f]{64}$/i.test(k)) ||
      (v.exitTxid !== undefined && !/^[0-9a-f]{64}$/i.test(v.exitTxid))) throw Error('The VTXO response is malformed or not bound to this ID and network.');
  return v;
}
@Component({ selector: 'app-ark-vtxo-detail', standalone: true, imports: [RelativeUrlPipe, CommonModule, RouterModule], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="container-xl py-4"><a [routerLink]="'/ark/vpack' | relativeUrl">Back to Ark V-PACK</a>
    <h1>VTXO Inspector</h1><p>Inspect provider-reported lifecycle and exit metadata. This view does not verify an exit proof or establish spendability.</p>
    <ng-container *ngIf="vm$ | async as vm"><p class="font-monospace text-break">{{ vm.id }} · {{ vm.network }}</p>
      <p *ngIf="vm.kind === 'loading'" role="status">Reading VTXO provider evidence…</p>
      <p *ngIf="vm.kind === 'error'" role="alert">{{ vm.error }}</p>
      <dl *ngIf="vm.value as v"><dt>Provider-reported status</dt><dd>{{ v.status }}</dd><dt>Amount (sats)</dt><dd>{{ v.amountSats }}</dd>
        <dt>Batch ID</dt><dd>{{ v.batchId }}</dd><dt>Reported timelock expiry (blocks)</dt><dd>{{ v.timelockExpiryBlocks }}</dd>
        <dt>Tree depth / index</dt><dd>{{ v.treeDepth }} / {{ v.treeIndex }}</dd><dt>Exit transaction</dt><dd>{{ v.exitTxid || 'Not supplied' }}</dd>
        <dt>Anchor outpoint and unilateral exit proof</dt><dd>Not established by this response.</dd></dl></ng-container></div>` })
export class ArkVtxoDetailComponent implements OnInit, OnDestroy {
  vm$: Observable<View>;
  private readonly destroyed = new Subject<void>();
  constructor(private route: ActivatedRoute, private api: UniverseApiService, private state: StateService) {}
  ngOnInit(): void {
    this.vm$ = combineLatest([this.route.paramMap.pipe(map(p => p.get('vtxoId') || '')), this.state.networkChanged$.pipe(startWith(this.state.network),map(n => n || 'mainnet'),distinctUntilChanged())]).pipe(
      switchMap(([id, network]) => {
        if (!id || id.length > 256 || /[\s\x00-\x1f]/.test(id)) return of<View>({kind:'error',id,network,error:'Enter a bounded public VTXO identifier.'});
        return this.api.getArkVtxo$(id).pipe(map(value => ({kind:'ready',id,network,value:checkedVtxo(value,id,network)} as View)),
          catchError(e => of<View>({kind:'error',id,network,error:e?.error?.error || e?.message || 'The owned Ark provider is unavailable.'})),
          startWith<View>({kind:'loading',id,network}));
      }), takeUntil(this.destroyed));
  }
  ngOnDestroy(): void {this.destroyed.next();this.destroyed.complete();}
}
