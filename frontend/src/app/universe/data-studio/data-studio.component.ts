import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, of } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import {
  DatasetManifest,
  McpToolDeclaration,
  QueryResult,
  StreamManifest,
} from '@app/universe/universe.types';

interface DataStudioViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly datasets?: DatasetManifest[];
  readonly streams?: StreamManifest[];
  readonly mcpTools?: McpToolDeclaration[];
  readonly selectedDataset?: DatasetManifest;
  readonly queryResult?: QueryResult;
  readonly executing?: boolean;
}

@Component({
  selector: 'app-data-studio',
  templateUrl: './data-studio.component.html',
  styleUrls: ['../product-page.scss', './data-studio.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataStudioComponent implements OnInit {
  selectedDatasetId = 'bitcoin.blocks';
  queryLimit = 20;

  private readonly state = new BehaviorSubject<DataStudioViewModel>({ kind: 'loading' });
  readonly vm$: Observable<DataStudioViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
  ) {
    this.seo.setTitle('Universe Data Studio & Developer Platform');
  }

  ngOnInit(): void {
    this.api.getDataCatalog$()
      .pipe(catchError(() => of(null)))
      .subscribe((catalog) => {
        if (!catalog) {
          this.state.next({ kind: 'error' });
          return;
        }
        const selected = catalog.datasets.find((d) => d.id === this.selectedDatasetId) || catalog.datasets[0];
        this.state.next({
          kind: 'ready',
          datasets: catalog.datasets,
          streams: catalog.streams,
          mcpTools: catalog.mcpTools,
          selectedDataset: selected,
        });
        this.runQuery();
      });
  }

  onDatasetChange(id: string): void {
    this.selectedDatasetId = id;
    const current = this.state.getValue();
    if (current.datasets) {
      const selected = current.datasets.find((d) => d.id === id);
      this.state.next({ ...current, selectedDataset: selected });
      this.runQuery();
    }
  }

  runQuery(): void {
    const current = this.state.getValue();
    this.state.next({ ...current, executing: true });

    this.api.executeDataQuery$({
      datasetId: this.selectedDatasetId,
      limit: this.queryLimit,
    }).pipe(
      catchError(() => of(null))
    ).subscribe((queryResult) => {
      const stateNow = this.state.getValue();
      this.state.next({
        ...stateNow,
        executing: false,
        queryResult: queryResult || undefined,
      });
    });
  }
}
