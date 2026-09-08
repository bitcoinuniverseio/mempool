/**
 * The portfolio session: vault state, a binary value mask, and global
 * display preferences exposed as signals. When the mask is active,
 * components bind placeholders instead of absolute values.
 */

import { Injectable, computed, signal } from '@angular/core';
import { PortfoliosStore } from './portfolios.store';

export type PrivacyLevel = 'open' | 'values-hidden';

@Injectable({ providedIn: 'root' })
export class PortfolioSessionService {
  private readonly _privacyLevel = signal<PrivacyLevel>('open');
  private readonly _activeSection = signal<string>('overview');
  private readonly _refreshing = signal<boolean>(false);

  readonly privacyLevel = this._privacyLevel.asReadonly();
  readonly activeSection = this._activeSection.asReadonly();
  readonly refreshing = this._refreshing.asReadonly();
  readonly valuesHidden = computed(() => this._privacyLevel() !== 'open');
  constructor(private readonly store: PortfoliosStore) {}

  cyclePrivacy(): void {
    this._privacyLevel.update((current) =>
      current === 'open' ? 'values-hidden' : 'open'
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

  lockNow(): void {
    this.store.lock();
  }
}
