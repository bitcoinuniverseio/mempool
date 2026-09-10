import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

import {
  DatasetManifest,
  McpToolDeclaration,
  QueryResult,
  StreamManifest,
} from '@app/universe/universe.types';

interface DataStudioViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly message?: string;
  readonly datasets?: DatasetManifest[];
  readonly streams?: StreamManifest[];
  readonly mcpTools?: McpToolDeclaration[];
  readonly selectedDataset?: DatasetManifest;
  readonly queryResult?: QueryResult;
  readonly queryError?: string;
  readonly executing?: boolean;
}

@Component({
  selector: 'app-data-studio',
  templateUrl: './data-studio.component.html',
  styleUrls: ['../product-page.scss', './data-studio.component.scss'],
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, FormsModule, RouterModule],
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
    this.api.getDataCatalog$().subscribe({
      next: (catalog) => {
        const selected = catalog.datasets.find((d) => d.id === this.selectedDatasetId) || catalog.datasets[0];
        this.state.next({
          kind: 'ready',
          datasets: catalog.datasets,
          streams: catalog.streams,
          mcpTools: catalog.mcpTools,
          selectedDataset: selected,
        });
        this.runQuery();
      },
      // A failed read is an error, not an empty catalog. The two are different
      // facts, and the page has an error state for the first.
      error: (err) => {
        this.state.next({ kind: 'error', message: loadFailureMessage(classifyLoadFailure(err)) });
      },
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
    this.state.next({ ...current, executing: true, queryError: undefined });

    this.api.executeDataQuery$({
      datasetId: this.selectedDatasetId,
      limit: this.queryLimit,
    }).subscribe({
      next: (queryResult) => {
        const stateNow = this.state.getValue();
        this.state.next({ ...stateNow, executing: false, queryResult });
      },
      error: (err) => {
        const stateNow = this.state.getValue();
        this.state.next({
          ...stateNow,
          executing: false,
          queryResult: undefined,
          queryError: loadFailureMessage(classifyLoadFailure(err)),
        });
      },
    });
  }
}
