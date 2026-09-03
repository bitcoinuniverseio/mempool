/**
 * The /portfolio home. Behavior is locked by the product spec:
 * - no local portfolio exists → onboarding;
 * - vault locked → locked shell without exposing any private value;
 * - vault unlocked with portfolios → the last active portfolio.
 */

import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PortfoliosStore } from '../stores/portfolios.store';

@Component({
  selector: 'app-portfolio-home',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="home">
      @switch (store.vaultKind()) {
        @case ('absent') {
          <section class="panel">
            <h1 i18n="@@universe.portfolio.home.welcome">Portfolio Intelligence</h1>
            <p i18n="@@universe.portfolio.home.intro">
              Track Bitcoin-native assets and UTXOs with exact values, honest coverage,
              and a vault that never leaves this browser.
            </p>
            <div class="actions">
              <a class="primary" routerLink="/portfolio/new" i18n="@@universe.portfolio.home.get-started">Get started</a>
              <a routerLink="/portfolio/bitcoin/mainnet/bc1qexample000000000000000" i18n="@@universe.portfolio.home.lookup">Look up one address</a>
            </div>
          </section>
        }
        @case ('locked') {
          <section class="panel locked" aria-live="polite">
            <h1 i18n="@@universe.portfolio.home.locked-title">Portfolio locked</h1>
            <p i18n="@@universe.portfolio.home.locked-copy">
              Your portfolios are protected. Nothing - names, balances, counts - is shown until you unlock.
            </p>
            <form (submit)="unlock($event, passphraseInput.value)">
              <label>
                <span i18n="@@universe.portfolio.home.passphrase">Passphrase</span>
                <input #passphraseInput type="password" name="passphrase" autocomplete="current-password" required />
              </label>
              @if (unlockError()) {
                <p class="error" role="alert">{{ unlockError() }}</p>
              }
              <button type="submit" class="primary" i18n="@@universe.portfolio.home.unlock">Unlock</button>
            </form>
          </section>
        }
        @default {
          <p role="status" i18n="@@universe.portfolio.home.opening">Opening your portfolio…</p>
        }
      }
    </div>
  `,
  styles: [
    `
      .home { display: flex; justify-content: center; padding: 8vh 8px 8px; }
      .panel {
        max-width: 460px; width: 100%; padding: 28px; border-radius: 14px;
        background: var(--u-surface, #fff);
        border: 1px solid var(--u-separator, rgba(0,0,0,0.08));
      }
      h1 { margin: 0 0 8px; font-size: 22px; }
      .actions { display: flex; gap: 10px; margin-top: 18px; flex-wrap: wrap; }
      a { padding: 10px 16px; border-radius: 9px; border: 1px solid var(--u-separator, rgba(0,0,0,0.14)); min-height: 44px; display: inline-flex; align-items: center; }
      a.primary { background: var(--u-brand, #c40059); color: #fff; border: none; font-weight: 600; }
      label { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; font-size: 13px; }
      input { padding: 10px; border-radius: 8px; border: 1px solid var(--u-separator, rgba(0,0,0,0.16)); min-height: 44px; }
      .error { color: #a02020; font-size: 13px; }
      button.primary { background: var(--u-brand, #c40059); color: #fff; border: none; padding: 10px 16px; border-radius: 9px; font-weight: 600; min-height: 44px; cursor: pointer; }
    `,
  ],
})
export class PortfolioHomeComponent implements OnInit {
  readonly store = inject(PortfoliosStore);
  private readonly router = inject(Router);

  private readonly unlockErrorSignal = signal('');

  ngOnInit(): void {
    if (this.store.vaultKind() === 'unlocked') {
      this.openActive();
    }
  }

  protected unlockError(): string {
    return this.unlockErrorSignal();
  }

  protected unlock(event: Event, passphrase: string): void {
    event.preventDefault();
    void this.store.unlock(passphrase).then((ok) => {
      if (ok) {
        this.unlockErrorSignal.set('');
        this.openActive();
      } else {
        // Constant shape: wrong passphrase and missing vault look alike.
        this.unlockErrorSignal.set($localize`:@@universe.portfolio.home.unlock-failed:That passphrase did not unlock the portfolio.`);
      }
    });
  }

  private openActive(): void {
    const active = this.store.activePortfolio();
    if (active !== null) {
      void this.router.navigate(['/portfolio/p', active.id, 'overview']);
      return;
    }
    void this.router.navigate(['/portfolio/new']);
  }
}
