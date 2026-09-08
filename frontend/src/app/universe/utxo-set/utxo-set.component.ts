import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import {
  BehaviorSubject,
  Observable,
  catchError,
  combineLatest,
  of,
} from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { formatAtomicAmount } from '@app/universe/universe-evidence';
import { UniverseIdentifierComponent } from '@app/universe/universe-identifier.component';
import {
  ProtocolBearingUtxos,
  ScriptTypeDistribution,
  SupplyCohort,
  UtreexoRootsView,
  UtxoCheckpoint,
} from '@app/universe/universe.types';

interface UtxoViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly checkpoints?: UtxoCheckpoint[];
  readonly valueCohorts?: SupplyCohort[];
  readonly scriptTypes?: ScriptTypeDistribution[];
  readonly protocolUtxos?: ProtocolBearingUtxos;
  readonly utreexo?: UtreexoRootsView;
}

@Component({
  selector: 'app-utxo-set',
  templateUrl: './utxo-set.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule, UniverseIdentifierComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UtxoSetComponent implements OnInit {
  protected readonly formatAtomicAmount = formatAtomicAmount;
  private readonly state = new BehaviorSubject<UtxoViewModel>({
    kind: 'loading',
  });
  readonly vm$: Observable<UtxoViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService
  ) {
    this.seo.setTitle('UTXO-Set, Supply & Utreexo Observatory');
  }

  ngOnInit(): void {
    combineLatest([
      this.api.getUtxoCheckpoints$(),
      this.api.getUtxoDistribution$(),
      this.api.getProtocolBearingUtxos$(),
      this.api.getUtreexoRoots$(),
    ])
      .pipe(catchError(() => of(null)))
      .subscribe((result) => {
        if (!result) {
          this.state.next({ kind: 'error' });
          return;
        }
        const [checkpointsData, distData, protocolUtxos, utreexo] = result;
        this.state.next({
          kind: 'ready',
          checkpoints: checkpointsData.checkpoints,
          valueCohorts: distData.valueCohorts,
          scriptTypes: distData.scriptTypes,
          protocolUtxos: protocolUtxos || undefined,
          utreexo: utreexo || undefined,
        });
      });
  }
}
