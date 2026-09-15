import {
  Component,
  Inject,
  ChangeDetectorRef,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import {
  NodeSecurityApiService,
  UpgradeWavePlan,
} from './node-security.service';
import {
  NodeSecurityEvidenceComponent,
  securityError,
} from './node-security-evidence.component';
@Component({
  selector: 'app-node-security-upgrade',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, RelativeUrlPipe],
  template: ` <div class="container-xl py-4">
    <h1>Fleet Upgrade Readiness Assessment</h1>
    <a [routerLink]="'/node/security' | relativeUrl">Node security overview</a>
    <p>
      A plan requires the owned fleet inventory, release compatibility and
      configuration evidence. No upgrade is executed here.
    </p>
    <form (ngSubmit)="generatePlan()">
      <label for="upgrade-from">Current version</label
      ><input
        id="upgrade-from"
        class="form-control mb-3"
        name="from"
        maxlength="128"
        [(ngModel)]="fromVersion"
        (ngModelChange)="reset()"
        required
      />
      <label for="upgrade-target">Target version</label
      ><input
        id="upgrade-target"
        class="form-control mb-3"
        name="target"
        maxlength="128"
        [(ngModel)]="targetVersion"
        (ngModelChange)="reset()"
        required
      />
      <button
        class="btn btn-primary"
        [disabled]="generating || !fromVersion.trim() || !targetVersion.trim()"
      >
        {{
          generating ? 'Reading fleet evidence…' : 'Request upgrade assessment'
        }}
      </button>
    </form>
    <p *ngIf="loadError" role="alert" class="alert alert-warning mt-3">
      {{ loadError }}
    </p>
    <section *ngIf="plan">
      <h2>Upgrade plan {{ plan.plan_id }}</h2>
      <p>
        {{ plan.target_software }} · {{ plan.from_version }} to
        {{ plan.target_version }} · {{ plan.nodes_count }} nodes
      </p>
      <h3>Required intermediate versions</h3>
      <p>
        {{ plan.intermediate_versions_required.join(', ') || 'None reported' }}
      </p>
      <h3>Configuration changes</h3>
      <p *ngFor="let c of plan.configuration_changes_required">
        {{ c.option }} · {{ c.action }} · {{ c.notes }}
      </p>
      <h3>Canary stages</h3>
      <ol>
        <li *ngFor="let s of plan.canary_stages">
          Stage {{ s.stage_number }}: {{ s.node_ids.join(', ') }} · verify for
          {{ s.verification_wait_minutes }} minutes
        </li>
      </ol>
      <p>Rollback boundary: {{ plan.rollback_boundary }}</p>
      <p>Estimated downtime: {{ plan.estimated_downtime_seconds }} seconds</p>
      <p>This assessment is not an executed or verified fleet upgrade.</p>
    </section>
  </div>`,
})
export class NodeSecurityUpgradeComponent implements OnInit, OnDestroy {
  fromVersion = '';
  targetVersion = '';
  generating = false;
  plan: UpgradeWavePlan | null = null;
  loadError: string | null = null;
  private request?: Subscription;
  private network?: Subscription;
  constructor(
    @Inject(NodeSecurityApiService) private api: NodeSecurityApiService,
    @Inject(ChangeDetectorRef) private cdr: ChangeDetectorRef
  ) {}
  ngOnInit(): void {
    this.network = this.api.network$.subscribe(() => this.reset());
  }
  reset(): void {
    this.request?.unsubscribe();
    this.plan = null;
    this.loadError = null;
    this.generating = false;
    this.cdr.markForCheck();
  }
  generatePlan(): void {
    this.reset();
    const from_version = this.fromVersion.trim(),
      target_version = this.targetVersion.trim();
    if (
      !from_version ||
      !target_version ||
      from_version.length > 128 ||
      target_version.length > 128
    ) {
      this.loadError =
        'Enter both release versions, at most 128 characters each.';
      return;
    }
    this.generating = true;
    this.request = this.api
      .createUpgradePlan$({ from_version, target_version })
      .subscribe({
        next: (p) => {
          this.plan = p;
          this.generating = false;
          this.cdr.markForCheck();
        },
        error: (e) => {
          this.loadError = securityError(e);
          this.generating = false;
          this.cdr.markForCheck();
        },
      });
  }
  ngOnDestroy(): void {
    this.reset();
    this.network?.unsubscribe();
  }
}
