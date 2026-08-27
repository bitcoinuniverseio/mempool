import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subscription, catchError, map, of, startWith, switchMap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { UniverseLocalService } from '@app/universe/universe-local.service';
import { BookmarkButtonComponent } from '@app/universe/bookmark-button/bookmark-button.component';
import {
  ExplorerNotableSat,
  ExplorerOutpointPosition,
  OutpointEnrichment,
} from '@app/universe/universe.types';
import {
  EvidenceView,
  ProtocolGroup,
  formatAtomicAmount,
  groupPositionsByProtocol,
  outpointEvidence,
  shortenIdentifier,
} from '@app/universe/universe-evidence';

interface OutpointViewModel {
  readonly kind: 'loading' | 'ready' | 'invalid' | 'error';
  readonly txid?: string;
  readonly vout?: string;
  readonly result?: OutpointEnrichment;
  readonly evidence?: EvidenceView;
  readonly groups?: readonly ProtocolGroup[];
}

const TXID = /^[0-9a-f]{64}$/;
const VOUT = /^(0|[1-9][0-9]{0,9})$/;

/**
 * One transaction output, treated as the thing it actually is: the unit that
 * carries protocol assets on Bitcoin. Every other explorer treats an output as
 * a row inside a transaction. Making it addressable is what lets a holder ask
 * "what exactly is sitting on this UTXO right now" and get an answer with the
 * evidence attached.
 */
@Component({
  selector: 'app-universe-outpoint',
  standalone: true,
  imports: [CommonModule, RouterModule, BookmarkButtonComponent],
  templateUrl: './outpoint.component.html',
  styleUrls: ['./outpoint.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OutpointComponent implements OnInit, OnDestroy {
  vm$: Observable<OutpointViewModel>;

  private visitSubscription?: Subscription;

  readonly shorten = shortenIdentifier;

  constructor(
    private route: ActivatedRoute,
    private api: UniverseApiService,
    private local: UniverseLocalService,
    private seo: SeoService,
  ) {}

  ngOnInit(): void {
    this.vm$ = this.route.paramMap.pipe(
      switchMap((params): Observable<OutpointViewModel> => {
        const txid = (params.get('txid') || '').toLowerCase();
        const vout = params.get('vout') || '';
        if (!TXID.test(txid) || !VOUT.test(vout)) {
          return of<OutpointViewModel>({ kind: 'invalid' });
        }
        this.seo.setTitle(`Output ${shortenIdentifier(txid)}:${vout}`);
        return this.api.getOutpoint$(txid, vout).pipe(
          map((result): OutpointViewModel => ({
            kind: 'ready',
            txid,
            vout,
            result,
            evidence: outpointEvidence(result),
            groups: groupPositionsByProtocol(result.positions || []),
          })),
          catchError((error: HttpErrorResponse) => {
            // A 5xx from the overlay is still a real answer about the state of
            // the deployment, so it renders as an unavailable authority rather
            // than a blank page.
            if (error?.status >= 500 || error?.status === 0) {
              const result: OutpointEnrichment = {
                outpoint: `${txid}:${vout}`,
                status: 'unavailable',
                positions: [],
                coveredProtocolIds: [],
                unknownAttachments: false,
                checkpoint: null,
              };
              return of<OutpointViewModel>({
                kind: 'ready',
                txid,
                vout,
                result,
                evidence: outpointEvidence(result),
                groups: [],
              });
            }
            return of<OutpointViewModel>({ kind: 'error', txid, vout });
          }),
          startWith<OutpointViewModel>({ kind: 'loading', txid, vout }),
        );
      }),
    );

    this.visitSubscription = this.route.paramMap.subscribe((params) => {
      const txid = (params.get('txid') || '').toLowerCase();
      const vout = params.get('vout') || '';
      if (!TXID.test(txid) || !VOUT.test(vout)) {return;}
      this.local.recordVisit({
        kind: 'outpoint',
        value: `${txid}:${vout}`,
        path: `/outpoint/${txid}/${vout}`,
        label: `${shortenIdentifier(txid)}:${vout}`,
      });
    });
  }

  ngOnDestroy(): void {
    this.visitSubscription?.unsubscribe();
  }

  quantityLabel(position: ExplorerOutpointPosition): string {
    if (!position.quantityAtomic) {return '';}
    return formatAtomicAmount(position.quantityAtomic);
  }

  satsLabel(valueSatsAtomic: string): string {
    return formatAtomicAmount(valueSatsAtomic);
  }

  rarityLabel(sat: ExplorerNotableSat): string {
    return sat.rarity;
  }

  trackByGroup(index: number, group: ProtocolGroup): string {
    return group.protocolId;
  }

  trackByPosition(index: number, position: ExplorerOutpointPosition): string {
    return `${position.outpoint}:${position.asset?.assetId ?? index}`;
  }
}
