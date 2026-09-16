import {
  Component,
  Inject,
  ChangeDetectorRef,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { NodeSecurityApiService } from './node-security.service';
import {
  NodeSecurityEvidenceComponent,
  securityError,
} from './node-security-evidence.component';
@Component({
  selector: 'app-node-security-artifacts',
  standalone: true,
  imports: [CommonModule, FormsModule, NodeSecurityEvidenceComponent],
  template: ` <app-node-security-evidence
      view="artifacts"
      title="Release Artifacts and Attestations"
    ></app-node-security-evidence>
    <div class="container-xl pb-4">
      <h2>Request artifact verification</h2>
      <p>
        A checksum identifies bytes. Release signature, source binding and
        reproducible-build evidence are separate checks.
      </p>
      <form (ngSubmit)="verify()">
        <label for="artifact-sha">SHA256 checksum</label
        ><input
          id="artifact-sha"
          class="form-control mb-3"
          name="sha"
          [(ngModel)]="sha256"
          (ngModelChange)="reset()"
          maxlength="64"
          required
        /><label for="artifact-version">Release version (optional)</label
        ><input
          id="artifact-version"
          class="form-control mb-3"
          name="version"
          [(ngModel)]="version"
          (ngModelChange)="reset()"
          maxlength="128"
        /><button class="btn btn-primary" [disabled]="loading">
          {{ loading ? 'Checking source…' : 'Request verification' }}
        </button>
      </form>
      <p *ngIf="error" class="alert alert-warning mt-3" role="alert">
        {{ error }}
      </p>
      <p *ngIf="result" role="status">
        State: {{ result.state }} · {{ result.stage }}. {{ result.error }} No
        reproducible-build verdict is established by this response.
      </p>
    </div>`,
})
export class NodeSecurityArtifactsComponent implements OnInit, OnDestroy {
  sha256 = '';
  version = '';
  loading = false;
  error = '';
  result: any = null;
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
    this.result = null;
    this.error = '';
    this.loading = false;
    this.cdr.markForCheck();
  }
  verify(): void {
    this.reset();
    if (!/^[0-9a-f]{64}$/i.test(this.sha256)) {
      this.error = 'Enter a 32-byte hexadecimal checksum.';
      return;
    }
    this.loading = true;
    this.request = this.api
      .verifyArtifact$({
        sha256: this.sha256,
        ...(this.version.trim() ? { version: this.version.trim() } : {}),
      })
      .subscribe({
        next: (r) => {
          this.loading = false;
          this.cdr.markForCheck();
          if (r?.verified !== false || r?.state !== 'unverified') {
            this.error =
              'Unsupported artifact verification response. No verification is established.';
            return;
          }
          this.result = r;
        },
        error: (e) => {
          this.loading = false;
          this.cdr.markForCheck();
          this.error = securityError(e);
        },
      });
  }
  ngOnDestroy(): void {
    this.reset();
    this.network?.unsubscribe();
  }
}
