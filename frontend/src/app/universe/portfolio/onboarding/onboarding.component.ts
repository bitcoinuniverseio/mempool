/**
 * The onboarding wizard.
 *
 * Entry choices: open one public address without saving, create a
 * portfolio from one address, add a Bitcoin watch-only wallet (xpub /
 * descriptor), import an address list, or create a manual-only portfolio.
 * Private credentials are detected and rejected locally before any
 * network request, and the wizard never fakes progress or data.
 */

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { PortfoliosStore } from '../stores/portfolios.store';
import {
  looksSecretLike,
  secretRejectionCopy,
  looksLikePublicExtendedKey,
  looksLikeDescriptor,
} from '../shared/secret-detection';
import {
  classifyDescriptor,
  classifyExtendedKey,
} from '../shared/derivation';
import type { LocalAccount, LocalPortfolio, ScriptKind } from '../stores/portfolio-model';

type EntryChoice =
  | 'ephemeral'
  | 'address'
  | 'watch-only'
  | 'list'
  | 'manual';

const ADDRESS_PATTERNS: readonly { chain: string; network: string; pattern: RegExp; label: string }[] = [
  { chain: 'bitcoin', network: 'mainnet', pattern: /^bc1[02-9ac-hj-np-z]{11,71}$/, label: 'Bitcoin (native SegWit)' },
  { chain: 'bitcoin', network: 'mainnet', pattern: /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/, label: 'Bitcoin (legacy / SegWit)' },
  { chain: 'dogecoin', network: 'mainnet', pattern: /^[DA9][1-9A-HJ-NP-Za-km-z]{20,60}$/, label: 'Dogecoin' },
  { chain: 'zcash', network: 'mainnet', pattern: /^t[13][a-km-zA-HJ-NP-Z1-9]{25,60}$/, label: 'Zcash (transparent)' },
];

@Component({
  selector: 'app-onboarding',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <header>
        <h1 i18n="@@universe.portfolio.onboarding.title">Create your portfolio</h1>
        <p class="soft" i18n="@@universe.portfolio.onboarding.copy">
          Everything private stays in this browser, encrypted. Watch-only: seed phrases and
          private keys are never accepted.
        </p>
      </header>

      @switch (step()) {
        @case ('choose') {
          <section class="choices" aria-label="Entry choices">
            <button type="button" (click)="choose('address')">
              <strong i18n="@@universe.portfolio.onboarding.from-address">Create from one address</strong>
              <span i18n="@@universe.portfolio.onboarding.from-address-copy">Track one public address with labels and history.</span>
            </button>
            <button type="button" (click)="choose('watch-only')">
              <strong i18n="@@universe.portfolio.onboarding.watch-only">Add a Bitcoin watch-only wallet</strong>
              <span i18n="@@universe.portfolio.onboarding.watch-only-copy">Derive addresses from an xpub, ypub, zpub, or descriptor. The key never leaves this browser.</span>
            </button>
            <button type="button" (click)="choose('list')">
              <strong i18n="@@universe.portfolio.onboarding.list">Import an address list</strong>
              <span i18n="@@universe.portfolio.onboarding.list-copy">Paste one public address per line.</span>
            </button>
            <button type="button" (click)="choose('manual')">
              <strong i18n="@@universe.portfolio.onboarding.manual">Create a manual-only portfolio</strong>
              <span i18n="@@universe.portfolio.onboarding.manual-copy">Keep explicit, user-entered positions. Clearly separated from chain facts.</span>
            </button>
            <button type="button" (click)="choose('ephemeral')">
              <strong i18n="@@universe.portfolio.onboarding.ephemeral">Open one address without saving</strong>
              <span i18n="@@universe.portfolio.onboarding.ephemeral-copy">No vault, no record, no history.</span>
            </button>
          </section>
        }
        @case ('vault') {
          <section class="panel">
            <h2 i18n="@@universe.portfolio.onboarding.vault-title">Protect your portfolio</h2>
            <p class="soft" i18n="@@universe.portfolio.onboarding.vault-copy">
              Choose a passphrase. It derives the encryption key in this browser and is never stored
              or sent. Losing it means losing local access to these definitions - the blockchain is untouched.
            </p>
            <label>
              <span i18n="@@universe.portfolio.onboarding.passphrase">Passphrase</span>
              <input #passInput type="password" autocomplete="new-password" required minlength="8" />
            </label>
            <label>
              <span i18n="@@universe.portfolio.onboarding.passphrase-repeat">Repeat passphrase</span>
              <input #repeatInput type="password" autocomplete="new-password" required />
            </label>
            @if (error(); as message) { <p class="error" role="alert">{{ message }}</p> }
            <div class="actions">
              <button type="button" class="primary" (click)="createVault(passInput.value, repeatInput.value)" i18n="@@universe.portfolio.onboarding.vault-create">Create encrypted vault</button>
              <button type="button" (click)="step.set('choose')" i18n="@@universe.portfolio.onboarding.back">Back</button>
            </div>
          </section>
        }
        @case ('input') {
          <section class="panel">
            <h2>{{ inputTitle() }}</h2>
            <label>
              <span>{{ inputLabel() }}</span>
              @if (stepChoice() === 'watch-only') {
                <textarea #materialInput rows="3" (input)="validateMaterial(materialInput.value)"></textarea>
              } @else {
                <textarea #materialInput rows="4" (input)="validateMaterial(materialInput.value)"></textarea>
              }
            </label>
            @if (rejection(); as message) { <p class="error" role="alert">{{ message }}</p> }
            @if (validation(); as validation) { <p class="ok">{{ validation }}</p> }
            <p class="soft" i18n="@@universe.portfolio.onboarding.input-note">
              Detection runs locally before anything is sent or stored. Rejected input is discarded immediately.
            </p>
            <div class="actions">
              <button type="button" class="primary" [disabled]="!valid()" (click)="save()" i18n="@@universe.portfolio.onboarding.save">Save portfolio</button>
              <button type="button" (click)="step.set('choose')" i18n="@@universe.portfolio.onboarding.back">Back</button>
            </div>
          </section>
        }
        @case ('done') {
          <section class="panel" role="status">
            <h2 i18n="@@universe.portfolio.onboarding.created">Portfolio created</h2>
            <p class="soft" i18n="@@universe.portfolio.onboarding.created-copy">Opening the overview…</p>
          </section>
        }
      }
    </div>
  `,
  styles: [
    `
      .wrap { max-width: 560px; margin: 0 auto; padding: 16px 8px; display: flex; flex-direction: column; gap: 16px; }
      .choices { display: flex; flex-direction: column; gap: 10px; }
      .choices button, .panel { text-align: left; padding: 16px; border-radius: 12px; border: 1px solid var(--u-separator, rgba(0,0,0,0.1)); background: var(--u-surface, #fff); cursor: pointer; display: flex; flex-direction: column; gap: 4px; min-height: 44px; }
      .choices button strong { font-size: 14.5px; }
      .choices button span { font-size: 12.5px; color: var(--u-fg-soft, inherit); }
      .panel { cursor: default; }
      h1 { margin: 0; font-size: 20px; }
      h2 { margin: 0 0 8px; font-size: 16px; }
      label { display: flex; flex-direction: column; gap: 4px; margin: 10px 0; font-size: 13px; }
      input, textarea { padding: 10px; border-radius: 8px; border: 1px solid var(--u-separator, rgba(0,0,0,0.16)); font: inherit; }
      textarea { font-family: monospace; font-size: 12.5px; }
      .actions { display: flex; gap: 10px; margin-top: 8px; }
      button.primary, button { border-radius: 9px; border: 1px solid var(--u-separator, rgba(0,0,0,0.14)); background: transparent; padding: 10px 16px; min-height: 44px; cursor: pointer; }
      button.primary { background: var(--u-brand, #c40059); color: #fff; border: none; font-weight: 600; }
      button:disabled { opacity: 0.5; cursor: not-allowed; }
      .error { color: #a02020; font-size: 13px; }
      .ok { color: #1c7c31; font-size: 13px; }
      .soft { font-size: 12.5px; color: var(--u-fg-soft, inherit); }
    `,
  ],
})
export class OnboardingComponent {
  readonly store = inject(PortfoliosStore);
  private readonly router = inject(Router);

  readonly step = signal<'choose' | 'vault' | 'input' | 'done'>('choose');
  readonly stepChoice = signal<EntryChoice>('address');
  readonly error = signal('');
  readonly rejection = signal('');
  readonly validation = signal('');
  readonly valid = signal(false);

  private portfolio: LocalPortfolio | null = null;
  private material = '';

  protected choose(choice: EntryChoice): void {
    this.stepChoice.set(choice);
    if (choice === 'ephemeral') {
      void this.router.navigate(['/portfolio/bitcoin/mainnet/bc1qexample000000000000000']);
      return;
    }
    if (choice === 'manual') {
      void this.finishManual();
      return;
    }
    this.step.set(this.store.vaultKind() === 'unlocked' ? 'input' : 'vault');
  }

  protected inputTitle(): string {
    switch (this.stepChoice()) {
      case 'address':
        return $localize`:@@universe.portfolio.onboarding.address-title:Add one public address`;
      case 'watch-only':
        return $localize`:@@universe.portfolio.onboarding.watch-title:Add a watch-only wallet`;
      default:
        return $localize`:@@universe.portfolio.onboarding.list-title:Import an address list`;
    }
  }

  protected inputLabel(): string {
    switch (this.stepChoice()) {
      case 'watch-only':
        return $localize`:@@universe.portfolio.onboarding.watch-label:Extended public key or output descriptor`;
      default:
        return $localize`:@@universe.portfolio.onboarding.address-label:Public address(es)`;
    }
  }

  protected createVault(passphrase: string, repeat: string): void {
    if (passphrase.length < 8) {
      this.error.set($localize`:@@universe.portfolio.onboarding.passphrase-short:Use at least 8 characters.`);
      return;
    }
    if (passphrase !== repeat) {
      this.error.set($localize`:@@universe.portfolio.onboarding.passphrase-mismatch:The passphrases do not match.`);
      return;
    }
    this.error.set('');
    void this.store.createVault(passphrase).then(() => this.step.set('input'));
  }

  /**
   * Local validation before anything leaves the page. Private material
   * trips the safety check and the input model is cleared immediately.
   */
  protected validateMaterial(value: string): void {
    this.material = value;
    this.rejection.set('');
    this.validation.set('');
    this.valid.set(false);
    const text = value.trim();
    if (text.length === 0) return;
    const secret = looksSecretLike(text);
    if (secret.secret && secret.kind !== null) {
      this.rejection.set(secretRejectionCopy(secret.kind));
      this.material = '';
      return;
    }
    if (this.stepChoice() === 'watch-only') {
      const extended = looksLikePublicExtendedKey(text)
        ? classifyExtendedKey(text)
        : null;
      if (extended !== null) {
        this.validation.set(
          $localize`:@@universe.portfolio.onboarding.xpub-ok:Extended public key accepted (${extended.script}:SCRIPT:).`,
        );
        this.valid.set(true);
        return;
      }
      const descriptor = looksLikeDescriptor(text) ? classifyDescriptor(text) : null;
      if (descriptor !== null) {
        this.validation.set(
          descriptor.checksumValid === false
            ? $localize`:@@universe.portfolio.onboarding.descriptor-bad-checksum:The descriptor parses but its checksum is not valid - check for typos.`
            : $localize`:@@universe.portfolio.onboarding.descriptor-ok:Descriptor accepted.`,
        );
        this.valid.set(descriptor.checksumValid !== false);
        return;
      }
      this.rejection.set(
        $localize`:@@universe.portfolio.onboarding.watch-bad:That is not a recognized extended public key or public descriptor.`,
      );
      return;
    }
    const addresses = text
      .split(/[\s,;]+/)
      .map((candidate) => candidate.trim())
      .filter((candidate) => candidate.length > 0);
    const unknown = addresses.filter(
      (candidate) => !ADDRESS_PATTERNS.some((entry) => entry.pattern.test(candidate)),
    );
    if (addresses.length === 0 || unknown.length > 0) {
      this.rejection.set(
        $localize`:@@universe.portfolio.onboarding.addresses-bad:Some entries are not recognized public addresses on a supported chain.`,
      );
      return;
    }
    this.validation.set(
      $localize`:@@universe.portfolio.onboarding.addresses-ok:${addresses.length}:count: address(es) recognized.`,
    );
    this.valid.set(true);
  }

  protected async save(): Promise<void> {
    const portfolio =
      this.portfolio ??
      (await this.store.createPortfolio(this.defaultName()));
    this.portfolio = portfolio;
    const now = new Date().toISOString();
    const accounts: LocalAccount[] = [...portfolio.accounts];
    if (this.stepChoice() === 'watch-only') {
      const extended = classifyExtendedKey(this.material);
      const descriptor = extended === null ? classifyDescriptor(this.material) : null;
      if (extended !== null) {
        accounts.push({
          id: crypto.randomUUID(),
          name: $localize`:@@universe.portfolio.onboarding.watch-account:Watch-only wallet`,
          chain: 'bitcoin',
          network: extended.testnet ? 'testnet' : 'mainnet',
          kind: 'xpub',
          xpub: { key: extended.key, script: extended.script as ScriptKind, account: 0, gapLimit: 20, branches: ['external'] },
          tags: [],
          createdAt: now,
        });
      } else if (descriptor !== null) {
        accounts.push({
          id: crypto.randomUUID(),
          name: $localize`:@@universe.portfolio.onboarding.descriptor-account:Descriptor wallet`,
          chain: 'bitcoin',
          network: descriptor.testnet ? 'testnet' : 'mainnet',
          kind: 'descriptor',
          descriptor: { value: descriptor.value, gapLimit: 20 },
          tags: [],
          createdAt: now,
        });
      }
    } else {
      const addresses = this.material
        .split(/[\s,;]+/)
        .map((candidate) => candidate.trim())
        .filter((candidate) => candidate.length > 0);
      for (const address of addresses) {
        const match = ADDRESS_PATTERNS.find((entry) => entry.pattern.test(address));
        if (match === undefined) continue;
        accounts.push({
          id: crypto.randomUUID(),
          name: address.slice(0, 12) + '…',
          chain: match.chain,
          network: match.network,
          kind: addresses.length > 1 ? 'addresses' : 'address',
          addresses: [address],
          tags: [],
          createdAt: now,
        });
      }
    }
    await this.store.updatePortfolio(portfolio.id, (current) => ({ ...current, accounts }));
    this.step.set('done');
    void this.router.navigate(['/portfolio/p', portfolio.id, 'overview']);
  }

  private async finishManual(): Promise<void> {
    const portfolio =
      this.portfolio ??
      (await this.store.createPortfolio(
        this.store.vaultKind() === 'unlocked'
          ? $localize`:@@universe.portfolio.onboarding.manual-name:Manual portfolio`
          : '',
        { sessionOnly: this.store.vaultKind() !== 'unlocked' },
      ));
    this.portfolio = portfolio;
    this.step.set('done');
    void this.router.navigate(['/portfolio/p', portfolio.id, 'overview']);
  }

  private defaultName(): string {
    switch (this.stepChoice()) {
      case 'watch-only':
        return $localize`:@@universe.portfolio.onboarding.default-watch:Watch-only portfolio`;
      case 'list':
        return $localize`:@@universe.portfolio.onboarding.default-list:Address list portfolio`;
      default:
        return $localize`:@@universe.portfolio.onboarding.default-address:My portfolio`;
    }
  }
}
