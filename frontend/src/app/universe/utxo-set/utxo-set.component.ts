import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, combineLatest, map, of } from 'rxjs';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
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
  readonly message?: string;
}

@Component({
  selector: 'app-utxo-set',
  templateUrl: './utxo-set.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UtxoSetComponent implements OnInit {
  // Templates format raw strings through the Number global; AOT needs it bound.
  protected readonly Number = Number;
  private readonly state = new BehaviorSubject<UtxoViewModel>({ kind: 'loading' });
  readonly vm$: Observable<UtxoViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
  ) {
    this.seo.setTitle('UTXO-Set, Supply & Utreexo Observatory');
  }

  ngOnInit(): void {
    // No per-read fallback: a checkpoint or cohort table the source could not
    // answer is an error with its reason, not an empty table.
    combineLatest([
      this.api.getUtxoCheckpoints$(),
      this.api.getUtxoDistribution$(),
      this.api.getProtocolBearingUtxos$(),
      this.api.getUtreexoRoots$(),
    ]).pipe(
      map(([checkpointsData, distData, protocolUtxos, utreexo]): UtxoViewModel => ({
        kind: 'ready',
        checkpoints: checkpointsData.checkpoints,
        valueCohorts: distData.valueCohorts,
        scriptTypes: distData.scriptTypes,
        protocolUtxos,
        utreexo,
      })),
      catchError((error) => of<UtxoViewModel>({ kind: 'error', message: loadFailureMessage(classifyLoadFailure(error)) })),
    ).subscribe((vm) => this.state.next(vm));
  }
}
