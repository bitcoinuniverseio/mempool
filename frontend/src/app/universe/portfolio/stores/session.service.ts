/**
 * The portfolio session: vault state, privacy mode, and global display
 * preferences exposed as signals. Privacy mode is one global control:
 * when active, absolute values never render into the DOM at all -
 * components bind masked placeholders instead of blurring real numbers.
 */

import { Injectable, computed, signal } from '@angular/core';
import { PortfoliosStore } from './portfolios.store';

export type PrivacyLevel = 'open' | 'values-hidden' | 'presentation';

@Injectable({ providedIn: 'root' })
export class PortfolioSessionService {
  private readonly _privacyLevel = signal<PrivacyLevel>('open');
  private readonly _activeSection = signal<string>('overview');
  private readonly _refreshing = signal<boolean>(false);

  readonly privacyLevel = this._privacyLevel.asReadonly();
  readonly activeSection = this._activeSection.asReadonly();
  readonly refreshing = this._refreshing.asReadonly();
  readonly valuesHidden = computed(
    () => this._privacyLevel() !== 'open',
  );
  readonly identifiersHidden = computed(
    () => this._privacyLevel() === 'presentation' || this._privacyLevel() === 'values-hidden' && this.currentHideIdentifiers(),
  );

  private currentHideIdentifiers = signal(false);

  constructor(private readonly store: PortfoliosStore) {}

  cyclePrivacy(): void {
    this._privacyLevel.update((current) =>
      current === 'open' ? 'values-hidden' : current === 'values-hidden' ? 'presentation' : 'open',
    );
  }

  setPrivacy(level: PrivacyLevel): void {
    this._privacyLevel.set(level);
  }

  /** Whether absolute numbers may render at all. */
  mayShowValues(): boolean {
    return this._privacyLevel() === 'open';
  }

  setSection(section: string): void {
    this._activeSection.set(section);
  }

  setRefreshing(refreshing: boolean): void {
    this._refreshing.set(refreshing);
  }

  /** Wires portfolio-level privacy defaults when a portfolio opens. */
  adoptPortfolioPrivacy(hideIdentifiers: boolean): void {
    this.currentHideIdentifiers.set(hideIdentifiers);
  }

  lockNow(): void {
    this.store.lock();
  }
}
