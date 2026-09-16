import { Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';
import { StateService } from '@app/services/state.service';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { OpenTimestampsApiService, TimestampStampResult, TimestampUpgradeResult } from './opentimestamps.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

const DIGEST = /^[0-9a-f]{64}$/i;

/**
 * Stamp a digest.
 *
 * The file, if one is chosen, is hashed in the browser and never uploaded;
 * only its SHA-256 goes to the allowlisted calendars, through this
 * deployment's own record store. A stamp is a calendar's promise. The
 * Bitcoin attestation exists only after the calendar has anchored, which is
 * why the result shows "pending" until the reader asks for the attestation
 * and the owned Bitcoin reader confirms it.
 */
@Component({
  selector: 'app-opentimestamps-stamp',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, FormsModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Stamp a digest</h1>
          <p class="text-muted mb-0">The file is hashed here; only its SHA-256 is sent to the calendars.</p>
        </div>
        <a [routerLink]="'/tools/timestamp' | relativeUrl" class="btn btn-outline-secondary btn-sm">Overview</a>
      </div>

      <div class="alert alert-warning" role="alert" *ngIf="loadError">{{ loadError }}</div>
      <p class="small text-muted" role="note">Network: {{ api.network }}</p>

      <div class="row g-4">
        <div class="col-lg-6">
          <div class="card p-3">
            <div class="mb-3">
              <label for="ots-file" class="form-label">File</label>
              <input id="ots-file" type="file" class="form-control" (change)="hashFile($event)" [disabled]="hashing || stamping">
              <p class="small text-muted mt-2 mb-0" *ngIf="hashing" role="status">Hashing {{ fileName }}</p>
              <p class="small text-muted mt-2 mb-0" *ngIf="!hashing && fileName">{{ fileName }}, {{ fileSize | number }} bytes</p>
            </div>
            <div class="mb-3">
              <label for="ots-digest" class="form-label">SHA-256 digest</label>
              <input id="ots-digest" type="text" class="form-control font-monospace" placeholder="64 hexadecimal characters"
                [(ngModel)]="digest" (ngModelChange)="digestEdited()" autocomplete="off" spellcheck="false" [attr.aria-invalid]="digest && !digestValid ? true : null">
              <p class="small text-muted mt-2 mb-0" *ngIf="digest && !digestValid">A SHA-256 digest has 64 hexadecimal characters.</p>
            </div>
            <button class="btn btn-primary w-100" (click)="stamp()" [disabled]="stamping || hashing || !digestValid">
              {{ stamping ? 'Submitting to calendars' : 'Stamp' }}
            </button>
          </div>
        </div>

        <div class="col-lg-6">
          <div class="card p-3 h-100" *ngIf="stampResult; else empty" role="status" aria-live="polite">
            <div class="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-3">
              <h2 class="h5 mb-0">{{ upgrade?.verified ? 'Anchored in Bitcoin' : 'Stamped, waiting for a calendar' }}</h2>
              <span class="badge" [class.badge-success]="upgrade?.verified" [class.badge-warning]="!upgrade?.verified">
                {{ upgrade?.verified ? 'BITCOIN CONFIRMED' : 'PENDING' }}
              </span>
            </div>

            <dl class="row mb-3 small" *ngIf="upgrade?.verified">
              <dt class="col-sm-4 text-muted">Block</dt>
              <dd class="col-sm-8 fw-bold">{{ upgrade?.verification?.earliest_proven_block_height }}</dd>
              <dt class="col-sm-4 text-muted">Block time</dt>
              <dd class="col-sm-8">{{ upgrade?.verification?.earliest_proven_time_utc | date:'medium' }}</dd>
              <dt class="col-sm-4 text-muted">Block hash</dt>
              <dd class="col-sm-8 font-monospace text-break">{{ upgrade?.verification?.bitcoin_block_hash }}</dd>
            </dl>

            <ul class="list-unstyled mb-3 small">
              <li *ngFor="let calendar of calendarRows" class="d-flex align-items-center gap-2 py-1">
                <span class="status-dot" [class.dot-ok]="calendar.status === 'verified'" [class.dot-wait]="calendar.status === 'pending' || calendar.status === 'upgraded'" [class.dot-bad]="calendar.status === 'unreachable'" aria-hidden="true"></span>
                <span class="flex-grow-1">{{ calendar.calendar_id }}</span>
                <span class="text-muted">{{ calendarLabel(calendar.status) }}</span>
              </li>
            </ul>

            <label for="ots-proof-out" class="form-label small text-muted mb-1">Proof (.ots, base64)</label>
            <textarea id="ots-proof-out" class="form-control font-monospace small mb-3" rows="4" readonly [value]="currentProof"></textarea>

            <div class="d-flex flex-wrap gap-2">
              <button class="btn btn-outline-primary btn-sm" type="button" (click)="checkAttestation()" [disabled]="upgrading || upgrade?.verified">
                {{ upgrading ? 'Asking the calendars' : 'Check for the Bitcoin attestation' }}
              </button>
              <button class="btn btn-outline-secondary btn-sm" type="button" (click)="copyProof()">{{ copied ? 'Copied' : 'Copy proof' }}</button>
              <a class="btn btn-outline-secondary btn-sm" [href]="proofHref" [download]="proofFileName">Download .ots</a>
            </div>
            <p class="small text-muted mt-3 mb-0" *ngIf="!upgrade?.verified">Calendars anchor on their own schedule, usually within hours. Keep the proof; it is the only copy.</p>
            <p class="small text-muted mt-2 mb-0" *ngIf="upgradeNote">{{ upgradeNote }}</p>
          </div>
          <ng-template #empty>
            <div class="card p-4 h-100 d-flex justify-content-center text-center">
              <p class="text-muted mb-0">Choose a file or paste a SHA-256 digest.</p>
            </div>
          </ng-template>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .status-dot { display: inline-block; width: 0.6rem; height: 0.6rem; border-radius: 50%; background: var(--u-state-neutral, #999); }
    .dot-ok { background: var(--u-state-proven); }
    .dot-wait { background: var(--u-state-pending); }
    .dot-bad { background: var(--u-state-unavailable, #c0392b); }
  `],
})
export class OpenTimestampsStampComponent implements OnDestroy {
  public digest = '';
  public fileName = '';
  public fileSize = 0;
  public hashing = false;
  public stamping = false;
  public upgrading = false;
  public copied = false;
  public stampResult: TimestampStampResult | null = null;
  public upgrade: TimestampUpgradeResult | null = null;
  public upgradeNote: string | null = null;
  public loadError: string | null = null;
  /** Bumped on every file choice or digest edit; a late hash result for an older input is dropped. */
  private selection = 0;
  private readonly networkSubscription: Subscription;

  constructor(public api: OpenTimestampsApiService, private stateService: StateService) {
    // A result belongs to the network it was stamped on. A switch clears the
    // display; the proof the user downloaded is theirs and is unaffected.
    this.networkSubscription = this.stateService.networkChanged$.pipe(distinctUntilChanged()).subscribe(() => this.reset());
  }

  public ngOnDestroy(): void {
    this.networkSubscription.unsubscribe();
  }

  public get digestValid(): boolean {
    return DIGEST.test(this.digest.trim());
  }

  public get currentProof(): string {
    return this.upgrade?.ots_proof_base64 ?? this.stampResult?.ots_proof_base64 ?? '';
  }

  public get proofHref(): string {
    return 'data:application/octet-stream;base64,' + this.currentProof;
  }

  public get proofFileName(): string {
    return (this.fileName || this.digest.slice(0, 16)) + '.ots';
  }

  /** Calendar rows from the upgrade when one ran, otherwise from the stamp. */
  public get calendarRows(): { calendar_id: string; status: 'pending' | 'upgraded' | 'verified' | 'unreachable' }[] {
    if (this.upgrade) {
      return this.upgrade.calendars.map(c => ({ calendar_id: c.calendar_id ?? c.calendar_url, status: c.status }));
    }
    return (this.stampResult?.calendars_contacted ?? []).map(c => ({ calendar_id: c.calendar_id, status: c.status }));
  }

  public calendarLabel(status: string): string {
    switch (status) {
      case 'verified': return 'anchored';
      case 'upgraded': return 'answered, not verified';
      case 'pending': return 'promised';
      default: return 'did not answer';
    }
  }

  public reset(): void {
    this.stampResult = null;
    this.upgrade = null;
    this.upgradeNote = null;
    this.copied = false;
  }

  /** A digest the user typed belongs to no chosen file. */
  public digestEdited(): void {
    this.selection += 1;
    this.fileName = '';
    this.fileSize = 0;
    this.hashing = false;
    this.reset();
  }

  /**
   * The digest and the file it came from change together. Choosing a file
   * clears the previous digest before the hash starts, a failed hash leaves
   * no file and no digest, and a hash that finishes after a newer choice is
   * dropped, so the Stamp button can never send one file's digest under
   * another file's name.
   */
  public async hashFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const selection = ++this.selection;
    this.hashing = true;
    this.fileName = file.name;
    this.fileSize = file.size;
    this.digest = '';
    this.loadError = null;
    this.reset();
    try {
      const bytes = await file.arrayBuffer();
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      if (selection !== this.selection) return;
      this.digest = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      if (selection !== this.selection) return;
      this.fileName = '';
      this.fileSize = 0;
      this.digest = '';
      this.loadError = 'The file could not be read and hashed in this browser. Choose it again, or paste its SHA-256 digest.';
    } finally {
      if (selection === this.selection) this.hashing = false;
    }
  }

  public stamp(): void {
    if (!this.digestValid) return;
    const digest = this.digest.trim().toLowerCase();
    const network = this.api.network;
    this.stamping = true;
    this.loadError = null;
    this.reset();
    // A digest that did not reach a calendar has not been stamped: the API
    // answers an error, never an invented proof, and this page shows that.
    // The request is bound to the network selected now; a switch while it is
    // in flight discards the answer instead of showing it under the new one.
    this.api.stampDigest$(digest).subscribe({
      next: res => {
        this.stamping = false;
        if (this.api.network !== network) return;
        this.stampResult = res;
      },
      error: err => {
        this.stamping = false;
        if (this.api.network !== network) return;
        this.stampResult = null;
        this.loadError = loadFailureMessage(classifyLoadFailure(err));
      },
    });
  }

  public checkAttestation(): void {
    if (!this.currentProof) return;
    const network = this.api.network;
    this.upgrading = true;
    this.upgradeNote = null;
    this.api.upgradeProof$({ ots_proof: this.currentProof, digest: this.digest.trim().toLowerCase() }).subscribe({
      next: res => {
        this.upgrading = false;
        if (this.api.network !== network || !this.stampResult && !this.upgrade) return;
        this.upgrade = res;
        if (!res.verified) {
          this.upgradeNote = res.upgraded ? 'A calendar answered, but the attestation did not verify: ' + (res.verification.errors[0] ?? res.status) : 'No calendar has anchored this digest yet.';
        }
      },
      error: err => {
        this.upgrading = false;
        if (this.api.network !== network) return;
        this.upgradeNote = loadFailureMessage(classifyLoadFailure(err));
      },
    });
  }

  public async copyProof(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.currentProof);
      this.copied = true;
      setTimeout(() => { this.copied = false; }, 2000);
    } catch {
      this.copied = false;
    }
  }
}
