import { describe, expect, it } from 'vitest';
import { PayjoinDirectoryComponent } from './payjoin-directory.component';
import { bootstrapApplication } from '@angular/platform-browser';
import { renderApplication } from '@angular/platform-server';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { PayjoinApiService } from './payjoin.service';

describe('Payjoin key evidence', () => {
  it('renders absent and malformed key hashes as unavailable without throwing', () => {
    const component = new PayjoinDirectoryComponent({} as never, {} as never);
    expect(component.keyLabel(null)).toBe('Key unavailable');
    expect(component.keyLabel('html response')).toBe('Key unavailable');
    expect(component.keyLabel('a'.repeat(64))).toBe('a'.repeat(16) + '...');
  });
  it('renders the actual unavailable-directory template with unknown protocol capability', async () => {
    const html = await renderApplication(context => bootstrapApplication(PayjoinDirectoryComponent, {
      providers: [provideZonelessChangeDetection(), provideRouter([]),
        { provide: StateService, useValue: { network: '', env: { BASE_MODULE: 'mempool', ROOT_NETWORK: 'mainnet' } } },
        { provide: PayjoinApiService, useValue: { getDirectories$: () => of([{ url: 'https://owned.example', ohttp_key_hash: null, bip77_supported: false, bip78_supported: false, bip77_state: 'unknown', bip78_state: 'unavailable', latency_ms: null, error: 'Probe unavailable', last_tested_at: '2026-10-03' }]) } }],
    }, context), { document: '<html><body><app-payjoin-directory></app-payjoin-directory></body></html>', url: 'http://localhost/', allowedHosts: ['localhost'] });
    expect(html).toContain('Key unavailable');
    expect(html).toContain('unknown');
    expect(html).toContain('Probe unavailable');
    expect(html).not.toContain('v2 Enabled');
  });
});
