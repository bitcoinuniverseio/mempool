import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { OpenTimestampsApiService, TimestampStampResult, TimestampUpgradeResult } from './opentimestamps.service';

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
  imports: [CommonModule, RouterModule, FormsModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Stamp a digest</h1>
          <p class="text-muted mb-0">The file is hashed here; only its SHA-256 is sent to the calendars.</p>
        </div>
        <a routerLink="/tools/timestamp" class="btn btn-outline-secondary btn-sm">Overview</a>
      </div>

      <div class="alert alert-warning" role="alert" *ngIf="loadError">{{ loadError }}</div>

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
                [(ngModel)]="digest" (ngModelChange)="reset()" autocomplete="off" spellcheck="false" [attr.aria-invalid]="digest && !digestValid ? true : null">
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
                <span class="status-dot" [class.dot-ok]="calendar.status === 'verified'" [class.dot-wait]="calendar.status === 'pending'" [class.dot-bad]="calendar.status === 'unreachable'" aria-hidden="true"></span>
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
export class OpenTimestampsStampComponent {
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

  constructor(private api: OpenTimestampsApiService) {}

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
  public get calendarRows(): { calendar_id: string; status: 'pending' | 'verified' | 'unreachable' }[] {
    if (this.upgrade) {
      return this.upgrade.calendars.map(c => ({ calendar_id: c.calendar_id ?? c.calendar_url, status: c.status }));
    }
    return (this.stampResult?.calendars_contacted ?? []).map(c => ({ calendar_id: c.calendar_id, status: c.status }));
  }

  public calendarLabel(status: string): string {
    return status === 'verified' ? 'anchored' : status === 'pending' ? 'promised' : 'did not answer';
  }

  public reset(): void {
    this.stampResult = null;
    this.upgrade = null;
    this.upgradeNote = null;
    this.copied = false;
  }

  public async hashFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.hashing = true;
    this.fileName = file.name;
    this.fileSize = file.size;
    this.reset();
    try {
      const bytes = await file.arrayBuffer();
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      this.digest = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
      this.loadError = null;
    } catch {
      this.loadError = 'The file could not be hashed in this browser.';
    } finally {
      this.hashing = false;
    }
  }

  public stamp(): void {
    if (!this.digestValid) return;
    this.stamping = true;
    this.loadError = null;
    this.reset();
    // A digest that did not reach a calendar has not been stamped: the API
    // answers an error, never an invented proof, and this page shows that.
    this.api.stampDigest$(this.digest.trim().toLowerCase()).subscribe({
      next: res => {
        this.stampResult = res;
        this.stamping = false;
      },
      error: err => {
        this.stampResult = null;
        this.loadError = loadFailureMessage(classifyLoadFailure(err));
        this.stamping = false;
      },
    });
  }

  public checkAttestation(): void {
    if (!this.currentProof) return;
    this.upgrading = true;
    this.upgradeNote = null;
    this.api.upgradeProof$({ ots_proof: this.currentProof, digest: this.digest.trim().toLowerCase() }).subscribe({
      next: res => {
        this.upgrade = res;
        this.upgrading = false;
        if (!res.verified) {
          this.upgradeNote = res.upgraded ? 'A calendar answered, but the attestation did not verify: ' + (res.verification.errors[0] ?? res.status) : 'No calendar has anchored this digest yet.';
        }
      },
      error: err => {
        this.upgrading = false;
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
