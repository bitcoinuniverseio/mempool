import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, of } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import {
  AnimaOrganism,
  AnimaOrganismsDocument,
  AnimaStatusDocument,
} from '@app/universe/universe.types';
import { shortenIdentifier } from '@app/universe/universe-evidence';

interface AnimaItemsViewModel {
  readonly kind: 'loading' | 'ready' | 'degraded' | 'error';
  readonly organisms?: AnimaOrganism[];
  readonly total?: number;
  readonly loadingMore?: boolean;
  readonly canLoadMore?: boolean;
  readonly degradedReason?: string | null;
}

/**
 * The organism list. ANIMA calls its items organisms: state machines whose
 * state lives in Bitcoin outputs. The list is the authority's, paged, with
 * each entry linking to its full record.
 */
@Component({
  selector: 'app-anima-items',
  templateUrl: './anima-items.component.html',
  styleUrls: ['./anima-page.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnimaItemsComponent implements OnInit {
  private readonly state = new BehaviorSubject<AnimaItemsViewModel>({ kind: 'loading' });
  readonly vm$: Observable<AnimaItemsViewModel> = this.state.asObservable();
  readonly shorten = shortenIdentifier;

  private organisms: AnimaOrganism[] = [];
  private total = 0;
  private loadingMore = false;

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
  ) {
    this.seo.setTitle($localize`ANIMA organisms`);
  }

  ngOnInit(): void {
    this.api.getAnimaStatus$()
      .pipe(catchError(() => of<AnimaStatusDocument | null>(null)))
      .subscribe((status) => {
        if (status === null) {
          this.state.next({ kind: 'error' });
          return;
        }
        if (status.state !== 'served') {
          this.state.next({
            kind: 'degraded',
            degradedReason:
              status.degradedReason
              ?? 'The ANIMA authority is not answering, so no organisms are shown.',
          });
          return;
        }
        this.loadFirstPage();
      });
  }

  more(): void {
    if (this.loadingMore || this.organisms.length >= this.total) {return;}
    this.loadingMore = true;
    this.publish();
    this.api.getAnimaOrganisms$(this.organisms.length, 50)
      .pipe(catchError(() => of<AnimaOrganismsDocument | null>(null)))
      .subscribe((page) => {
        this.loadingMore = false;
        if (page !== null) {
          this.organisms = this.organisms.concat(page.organisms);
          this.total = page.total;
        }
        this.publish();
      });
  }

  private loadFirstPage(): void {
    this.api.getAnimaOrganisms$(0, 50)
      .pipe(catchError(() => of<AnimaOrganismsDocument | null>(null)))
      .subscribe((page) => {
        if (page === null) {
          this.state.next({ kind: 'error' });
          return;
        }
        this.organisms = page.organisms;
        this.total = page.total;
        this.publish();
      });
  }

  private publish(): void {
    this.state.next({
      kind: 'ready',
      organisms: this.organisms,
      total: this.total,
      loadingMore: this.loadingMore,
      canLoadMore: this.organisms.length < this.total,
    });
  }
}
