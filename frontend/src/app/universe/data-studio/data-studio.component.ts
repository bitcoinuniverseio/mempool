import { ChangeDetectionStrategy, Component, OnInit, OnDestroy, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { DataStudioApiService } from './data-studio-api.service';
@Component({
  selector: 'app-data-studio',
  templateUrl: './data-studio.component.html',
  styleUrls: ['../product-page.scss', './data-studio.component.scss'],
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, FormsModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataStudioComponent implements OnInit, OnDestroy {
  selectedDatasetId = 'bitcoin.blocks';
  queryLimit = 20;
  queryOffset = 0;
  orderBy = 'height';
  orderDirection = 'desc';
  filterField = 'height';
  filterOperator = 'gte';
  filterValue = '';
  selectedFields = '';
  private read?: Subscription;
  private query?: Subscription;
  private generation = 0;
  private state = new BehaviorSubject<any>({ kind: 'loading' });
  readonly vm$: Observable<any> = this.state.asObservable();
  constructor(
    @Inject(DataStudioApiService) public api: DataStudioApiService,
    @Inject(SeoService) private seo: SeoService
  ) {
    seo.setTitle('Universe Data Studio');
  }
  ngOnInit() {
    this.read = this.api.watchCatalog$().subscribe((catalog) => {
      this.invalidateQuery();
      if (catalog.kind === 'ready') {
        const selected = catalog.datasets.find((d) => d.id === this.selectedDatasetId) ?? catalog.datasets[0];
        this.selectedDatasetId = selected?.id ?? '';
        this.resetControls(selected);
        this.state.next({ ...catalog, selectedDataset: selected, executing: false });
        if (selected) this.runQuery();
      } else this.state.next(catalog);
    });
  }
  private resetControls(dataset: any) {
    this.queryOffset = 0;
    this.orderBy = dataset?.fields[0]?.name ?? '';
    this.filterField = this.orderBy;
    this.filterValue = '';
    this.selectedFields = '';
  }
  invalidateQuery() {
    this.generation++;
    this.query?.unsubscribe();
    const current = this.state.value;
    this.state.next({ ...current, queryResult: undefined, queryError: undefined, executing: false });
  }
  onDatasetChange(id: string) {
    this.invalidateQuery();
    this.selectedDatasetId = id;
    const current = this.state.value,
      selected = current.datasets?.find((d) => d.id === id);
    this.resetControls(selected);
    this.state.next({ ...current, selectedDataset: selected, queryResult: undefined });
    if (selected) this.runQuery();
  }
  runQuery() {
    this.invalidateQuery();
    const current = this.state.value;
    if (!current.selectedDataset) return;
    const body: any = {
      datasetId: this.selectedDatasetId,
      snapshotId: current.selectedDataset.snapshotId,
      limit: this.queryLimit,
      offset: this.queryOffset,
      orderBy: this.orderBy,
      orderDirection: this.orderDirection,
    };
    if (this.selectedFields.trim()) body.fields = this.selectedFields.split(',').map((x) => x.trim());
    if (this.filterValue !== '') {
      const type = current.selectedDataset.fields.find((f) => f.name === this.filterField)?.type;
      body.filters = [
        {
          field: this.filterField,
          operator: this.filterOperator,
          value: type === 'integer' ? Number(this.filterValue) : this.filterValue,
        },
      ];
    }
    const generation = this.generation;
    this.state.next({ ...current, queryResult: undefined, executing: true });
    this.query = this.api.query$(body).subscribe({
      next: (queryResult) => {
        if (generation !== this.generation) return;
        this.state.next({ ...this.state.value, queryResult, executing: false });
      },
      error: (e) => {
        if (generation !== this.generation) return;
        this.state.next({
          ...this.state.value,
          executing: false,
          queryResult: undefined,
          queryError: e?.error?.error ?? 'Owned query evidence is unavailable.',
        });
      },
    });
  }
  nextPage() {
    const next = this.state.value.queryResult?.nextOffset;
    if (next !== null && next !== undefined) {
      this.queryOffset = next;
      this.runQuery();
    }
  }
  ngOnDestroy() {
    this.invalidateQuery();
    this.read?.unsubscribe();
  }
}
