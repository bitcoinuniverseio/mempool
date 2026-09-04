import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { BlockspaceApiService, BlockspaceSemanticClass } from './blockspace.service';

@Component({
  selector: 'app-blockspace-taxonomy',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Transaction Semantics Taxonomy</h1>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Authoritative taxonomy defining transaction classifications, witness patterns, and demand motives across the Bitcoin network.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/intelligence/blockspace">Overview</a>
          <a class="nav-link" routerLink="/intelligence/blockspace/composition">Composition</a>
          <a class="nav-link" routerLink="/intelligence/blockspace/regimes">Fee Regimes</a>
          <a class="nav-link" routerLink="/intelligence/blockspace/compare">Regime Compare</a>
          <a class="nav-link active" routerLink="/intelligence/blockspace/taxonomy">Taxonomy Catalog</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading taxonomy classes...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && taxonomy.length > 0" class="content-body">
        <div class="row g-4">
          <div class="col-12 col-md-6" *ngFor="let item of taxonomy">
            <div class="card p-4 bg-body-tertiary border h-100">
              <div class="d-flex justify-content-between align-items-center mb-2">
                <span class="badge" [ngClass]="{
                  'bg-success': item.category === 'monetary',
                  'bg-info': item.category === 'layer2',
                  'bg-warning text-dark': item.category === 'arbitrary_data',
                  'bg-secondary': item.category === 'infrastructure'
                }">
                  {{ item.category }}
                </span>
                <span class="text-muted small">ID: {{ item.class_id }}</span>
              </div>
              <h2 class="h5 mb-2">{{ item.name }}</h2>
              <p class="text-muted small mb-3">{{ item.description }}</p>

              <div class="mt-auto pt-3 border-top d-flex justify-content-between text-muted small">
                <span>Weight Share: <strong class="text-body">{{ item.weight_share_percentage }}%</strong></span>
                <span>Fee Share: <strong class="text-body">{{ item.fee_share_percentage }}%</strong></span>
                <span>24h Count: <strong class="text-body">{{ item.tx_count_24h | number }}</strong></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .intelligence-page {
      padding: 1.5rem 1rem 3rem;
    }
  `]
})
export class BlockspaceTaxonomyComponent implements OnInit, OnDestroy {
  public taxonomy: BlockspaceSemanticClass[] = [];
  public loading = true;
  public error = '';

  private sub?: Subscription;

  constructor(
    private blockspaceApi: BlockspaceApiService,
    private cd: ChangeDetectorRef,
  ) {}

  public ngOnInit(): void {
    this.sub = this.blockspaceApi.getTaxonomy().subscribe({
      next: (data) => {
        this.taxonomy = data;
        this.loading = false;
        this.cd.markForCheck();
      },
      error: (err) => {
        this.error = err?.message || 'Failed to load taxonomy';
        this.loading = false;
        this.cd.markForCheck();
      },
    });
  }

  public ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
