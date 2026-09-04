import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NodeSecurityApiService } from './node-security.service';

@Component({
  selector: 'app-node-security-upgrade',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Fleet Upgrade Readiness Assessment</h1>
          <p class="text-muted mb-0">Evaluate breaking configuration changes, database migrations, and safe rollout sequencing.</p>
        </div>
        <a routerLink="/node/security" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="row g-4">
        <div class="col-lg-5">
          <div class="card bg-dark border-secondary p-3">
            <h5 class="card-title mb-3">Generate Upgrade Plan</h5>
            <div class="mb-3">
              <label class="form-label text-muted small text-uppercase">Target Release</label>
              <select class="form-select bg-black text-light border-secondary" [(ngModel)]="targetVersion">
                <option value="v28.0">Bitcoin Core v28.0 (Latest Stable)</option>
                <option value="v27.1">Bitcoin Core v27.1 (LTS Maintenance)</option>
              </select>
            </div>
            <button class="btn btn-primary w-100" (click)="generatePlan()" [disabled]="generating">
              {{ generating ? 'Analyzing Fleet Dependencies...' : 'Generate Safe Migration Plan' }}
            </button>
          </div>
        </div>

        <div class="col-lg-7">
          <div class="card bg-dark border-secondary p-4 h-100" *ngIf="plan">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h5 class="card-title text-success mb-0">Upgrade Plan: {{ plan.plan_id }}</h5>
              <span class="badge bg-info">{{ plan.affected_nodes_count }} Nodes Affected</span>
            </div>

            <ol class="list-group list-group-numbered list-group-flush bg-transparent">
              <li *ngFor="let step of plan.steps" class="list-group-item bg-transparent text-light border-secondary">
                {{ step }}
              </li>
            </ol>
          </div>

          <div class="card bg-dark border-secondary p-5 text-center h-100 d-flex justify-content-center" *ngIf="!plan">
            <p class="text-muted mb-0">Select target version and click "Generate Safe Migration Plan".</p>
          </div>
        </div>
      </div>
    </div>
  `
})
export class NodeSecurityUpgradeComponent {
  public targetVersion = 'v28.0';
  public generating = false;
  public plan: any = null;

  constructor(private api: NodeSecurityApiService) {}

  public generatePlan(): void {
    this.generating = true;
    this.api.createUpgradePlan$({ target_version: this.targetVersion }).subscribe(res => {
      this.plan = res;
      this.generating = false;
    });
  }
}
