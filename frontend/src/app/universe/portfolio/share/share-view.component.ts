/**
 * The encrypted share view: a recipient opens /portfolio/share/:id, the
 * browser downloads only ciphertext, and the decryption key arrives in
 * the URL fragment - which the server never sees. No decryption happens
 * server-side; expired and revoked states are explicit.
 */

import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { formatExact } from '../shared/exact';

interface SharePayload {
  readonly format: 'universe-portfolio-share';
  readonly formatVersion: 1;
  readonly nonceB64: string;
  readonly ctB64: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

@Component({
  selector: 'app-share-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="share">
      @switch (state()) {
        @case ('loading') {
          <p role="status" i18n="@@universe.portfolio.share.loading">Fetching the encrypted snapshot…</p>
        }
        @case ('expired') {
          <p role="note" i18n="@@universe.portfolio.share.expired">This shared snapshot has expired.</p>
        }
        @case ('missing') {
          <p role="note" i18n="@@universe.portfolio.share.missing">This share does not exist or was revoked.</p>
        }
        @case ('no-key') {
          <p role="note" i18n="@@universe.portfolio.share.no-key">
            The decryption key is missing from the link fragment. Shares only open through the
            full link the sender received.
          </p>
        }
        @case ('ready') {
          <h1 i18n="@@universe.portfolio.share.title">Shared portfolio snapshot</h1>
          <p class="soft" i18n="@@universe.portfolio.share.decrypted-locally">
            Decrypted in your browser. The server stored only ciphertext and an expiry.
          </p>
          @if (snapshot(); as snapshot) {
            <p class="soft" i18n="@@universe.portfolio.share.age">
              Snapshot age: {{ snapshotAge() }}
            </p>
            <table>
              <thead>
                <tr>
                  <th scope="col" i18n="@@universe.portfolio.share.asset">Asset</th>
                  <th scope="col" i18n="@@universe.portfolio.share.share">Share</th>
                </tr>
              </thead>
              <tbody>
                @for (row of snapshot.holdings; track row.asset) {
                  <tr><td>{{ row.asset }}</td><td>{{ row.share }}</td></tr>
                }
              </tbody>
            </table>
          }
        }
        @default {
          <p role="note" i18n="@@universe.portfolio.share.failed">This share could not be opened.</p>
        }
      }
    </div>
  `,
  styles: [
    `
      .share { max-width: 560px; margin: 0 auto; padding: 16px 8px; }
      h1 { font-size: 18px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
      th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--u-separator, rgba(0,0,0,0.06)); }
      .soft { font-size: 12.5px; color: var(--u-fg-soft, inherit); }
    `,
  ],
})
export class ShareViewComponent implements OnInit {
  private readonly http = inject(HttpClient);
  readonly shareId = input<string>('');

  private readonly stateSignal = signal<'loading' | 'ready' | 'expired' | 'missing' | 'no-key' | 'failed'>('loading');
  private readonly snapshotSignal = signal<{ readonly holdings: readonly { readonly asset: string; readonly share: string }[]; readonly createdAt: string } | null>(null);

  readonly state = this.stateSignal.asReadonly();
  readonly snapshot = this.snapshotSignal.asReadonly();
  readonly snapshotAge = computed(() => {
    const snapshot = this.snapshotSignal();
    if (snapshot === null) return '';
    const days = Math.max(0, Math.floor((Date.now() - new Date(snapshot.createdAt).getTime()) / 86_400_000));
    return formatExact(String(days), 'en');
  });

  ngOnInit(): void {
    void this.open();
  }

  private async open(): Promise<void> {
    const shareId = this.shareId();
    const keyFragment = window.location.hash.replace(/^#key=/, '');
    if (shareId.length === 0) {
      this.stateSignal.set('missing');
      return;
    }
    try {
      const response = this.http.get<SharePayload>(
        `/api/v2/universe/portfolio-share/${encodeURIComponent(shareId)}`,
        { responseType: 'json' },
      );
      const payload = await new Promise<SharePayload | null>((resolve) => {
        response.subscribe({
          next: (value) => resolve(value),
          error: () => resolve(null),
        });
      });
      if (payload === null) {
        this.stateSignal.set('missing');
        return;
      }
      if (new Date(payload.expiresAt).getTime() < Date.now()) {
        this.stateSignal.set('expired');
        return;
      }
      if (keyFragment.length === 0) {
        this.stateSignal.set('no-key');
        return;
      }
      const plaintext = await this.decrypt(payload, keyFragment);
      this.snapshotSignal.set(plaintext);
      this.stateSignal.set('ready');
      // The key must not linger: drop the fragment after use.
      history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch {
      this.stateSignal.set('failed');
    }
  }

  private async decrypt(payload: SharePayload, keyB64Url: string): Promise<{ holdings: { asset: string; share: string }[]; createdAt: string }> {
    const keyBytes = Uint8Array.from(atob(keyB64Url.replace(/-/g, '+').replace(/_/g, '/')), (character) => character.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', keyBytes as BufferSource, 'AES-GCM', false, ['decrypt']);
    const nonce = Uint8Array.from(atob(payload.nonceB64), (character) => character.charCodeAt(0));
    const ct = Uint8Array.from(atob(payload.ctB64), (character) => character.charCodeAt(0));
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, key, ct as BufferSource);
    return JSON.parse(new TextDecoder().decode(plaintext));
  }
}
