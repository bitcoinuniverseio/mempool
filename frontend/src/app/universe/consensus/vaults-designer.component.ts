import {
  Component,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { compileVaultScripts } from './vault-script-template';

@Component({
  selector: 'app-vaults-designer',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div
          class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2"
        >
          <h1 class="m-0">Guided Vault State-Machine Designer</h1>
          <span class="badge bg-primary"
            >Interactive Covenant Architecture</span
          >
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Configure custody parameters, time-delayed withdrawal stages, and
          emergency recovery clawback paths.
        </p>

        <!-- Navigation Tabs -->
        <nav
          class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle"
        >
          <a class="nav-link" [routerLink]="'/labs/consensus' | relativeUrl"
            >Consensus Proposals</a
          >
          <a
            class="nav-link"
            [routerLink]="'/labs/consensus/compare' | relativeUrl"
            >Compare Matrix</a
          >
          <a class="nav-link" [routerLink]="'/labs/vaults' | relativeUrl"
            >Vaults Overview</a
          >
          <a
            class="nav-link active"
            [routerLink]="'/labs/vaults/designer' | relativeUrl"
            >Vault Designer</a
          >
          <a
            class="nav-link"
            [routerLink]="'/labs/vaults/simulate' | relativeUrl"
            >Covenant Simulator</a
          >
        </nav>
      </header>

      <!-- Designer Form -->
      <div class="card p-4 mb-4 bg-body-tertiary border">
        <h2 class="h5 mb-3">Custody Parameters</h2>
        <form (ngSubmit)="compileVault()" #designForm="ngForm">
          <div class="row g-3">
            <div class="col-12 col-md-6">
              <label for="hotKey" class="form-label small text-muted"
                >Hot Operating Key (Unvault Trigger)</label
              >
              <input
                id="hotKey"
                type="text"
                class="form-control font-monospace"
                placeholder="02... (Compressed Public Key)"
                [(ngModel)]="hotKey"
                (ngModelChange)="edited()"
                name="hotKey"
                required
              />
            </div>
            <div class="col-12 col-md-6">
              <label for="coldKey" class="form-label small text-muted"
                >Cold Emergency Key (Clawback Destination)</label
              >
              <input
                id="coldKey"
                type="text"
                class="form-control font-monospace"
                placeholder="03... (Compressed Public Key)"
                [(ngModel)]="coldKey"
                (ngModelChange)="edited()"
                name="coldKey"
                required
              />
            </div>
            <div class="col-12 col-md-6">
              <label for="delayBlocks" class="form-label small text-muted"
                >Challenge Timelock Delay (Blocks)</label
              >
              <input
                id="delayBlocks"
                type="number"
                class="form-control font-monospace"
                [(ngModel)]="delayBlocks"
                (ngModelChange)="edited()"
                name="delayBlocks"
                min="10"
                max="1008"
                required
              />
              <div class="small text-muted mt-1">
                Approx. {{ ((delayBlocks * 10) / 60).toFixed(1) }} hours at
                10-minute block interval
              </div>
            </div>
            <div class="col-12 col-md-6">
              <label for="targetBip" class="form-label small text-muted"
                >Target Covenant Primitive</label
              >
              <select
                id="targetBip"
                class="form-select"
                [(ngModel)]="targetBip"
                (ngModelChange)="edited()"
                name="targetBip"
              >
                <option value="bip-119">
                  BIP-119 (OP_CHECKTEMPLATEVERIFY)
                </option>
                <option value="bip-347">BIP-347 (OP_CAT in Tapscript)</option>
                <option value="bip-443">
                  BIP-443 (OP_CHECKCONTRACTVERIFY)
                </option>
              </select>
            </div>
          </div>

          <label for="vault-template-hash"
            >Exact unvault transaction CTV hash</label
          ><input
            id="vault-template-hash"
            name="templateHash"
            class="form-control font-monospace"
            [(ngModel)]="templateHash"
            (ngModelChange)="edited()"
          />
          <p *ngIf="error" role="alert" class="text-danger">{{ error }}</p>
          <div
            class="d-flex flex-wrap justify-content-between align-items-center gap-2 mt-4"
          >
            <button
              type="button"
              class="btn btn-outline-secondary"
              (click)="loadDemoKeys()"
            >
              Load Demo Keys
            </button>
            <button
              type="submit"
              class="btn btn-primary px-4"
              [disabled]="!hotKey || !coldKey"
            >
              Compile State Machine
            </button>
          </div>
        </form>
      </div>

      <!-- State Machine Diagram & Details -->
      <div *ngIf="compiled" class="card p-4 bg-body-tertiary border">
        <h2 class="h5 mb-3">Vault script templates constructed</h2>
        <p>{{ scripts?.scope }}</p>
        <h3 class="h6">Initial witness script</h3>
        <p class="font-monospace text-break">{{ scripts?.vaultScript }}</p>
        <h3 class="h6">Unvault witness script</h3>
        <p class="font-monospace text-break">{{ scripts?.unvaultScript }}</p>
        <p>
          The following diagram describes intended branches; it does not certify
          a funded vault.
        </p>

        <div class="row g-3 mb-4 text-center">
          <div class="col-12 col-md-4">
            <div class="p-3 border rounded bg-body h-100">
              <div class="badge bg-primary mb-2">State 1: Vaulted</div>
              <div class="small fw-semibold">
                Balance Locked at Cold Address
              </div>
              <div class="small text-muted mt-1">
                Spends restricted by covenant script to unvaulting trigger.
              </div>
            </div>
          </div>
          <div class="col-12 col-md-4">
            <div class="p-3 border rounded bg-body h-100">
              <div class="badge bg-warning text-dark mb-2">
                State 2: Unvaulting (Pending)
              </div>
              <div class="small fw-semibold">
                {{ delayBlocks }} Blocks Challenge Window
              </div>
              <div class="small text-muted mt-1">
                Hot key initiated withdrawal. Emergency clawback can cancel.
              </div>
            </div>
          </div>
          <div class="col-12 col-md-4">
            <div class="p-3 border rounded bg-body h-100">
              <div class="badge bg-success mb-2">
                State 3: Settled or Recovered
              </div>
              <div class="small fw-semibold">Settled or Cold Recovery</div>
              <div class="small text-muted mt-1">
                Either CSV expires to destination or cold key recovers balance.
              </div>
            </div>
          </div>
        </div>

        <div class="d-flex justify-content-end">
          <a
            [routerLink]="'/labs/vaults/simulate' | relativeUrl"
            class="btn btn-primary"
          >
            Test in Covenant Simulator &rarr;
          </a>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .nav-link {
        color: inherit;
        padding: 0.4rem 0.8rem;
        border-radius: 0.375rem;
      }
      .nav-link.active {
        background-color: var(--bs-primary, #f7931a);
        color: #fff;
      }
    `,
  ],
})
export class VaultsDesignerComponent {
  hotKey = '';
  coldKey = '';
  delayBlocks = 144;
  targetBip = 'bip-119';
  compiled = false;
  templateHash = '';
  error: string | null = null;
  scripts: ReturnType<typeof compileVaultScripts> | null = null;
  edited(): void {
    this.compiled = false;
    this.scripts = null;
    this.error = null;
  }

  constructor(private cd: ChangeDetectorRef) {}

  loadDemoKeys(): void {
    this.hotKey =
      '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
    this.coldKey =
      '02c6047f9441ed7d6d3045406e95c07cd85a778e4b8cef3ca7abac09b95c709ee5';
    this.edited();
  }

  compileVault(): void {
    this.edited();
    try {
      if (this.targetBip !== 'bip-119')
        throw new Error(
          'Only the explicit CTV script template is implemented. Other proposals need their own complete construction.'
        );
      this.scripts = compileVaultScripts(
        this.hotKey,
        this.coldKey,
        this.delayBlocks,
        this.templateHash
      );
      this.compiled = true;
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : 'Script construction failed';
    }
    this.cd.markForCheck();
  }
}
