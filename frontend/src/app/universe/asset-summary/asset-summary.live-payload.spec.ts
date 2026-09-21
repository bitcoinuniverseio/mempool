// @vitest-environment jsdom
import 'zone.js';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SimpleChange } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';
import { of } from 'rxjs';
import { TransactionAssetsComponent } from '@app/universe/transaction-assets/transaction-assets.component';
import {
  decodeTransactionAssetSummary,
} from '@app/universe/transaction-assets/transaction-assets.types';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { resolveTemplates } from './asset-summary.test-render';

/**
 * The rebuilt panel against a payload the live authority actually returned.
 *
 * `live-evidence/mainnet-summary-20260919.json` is the verbatim body of
 * `GET /api/v1/universe/transactions/{txid}/assets` from
 * `https://explorer.bitcoinuniverse.io` on 2026-09-19, for a confirmed mainnet
 * transaction in block 0000000000000000000048c5b08853cc2a5c2a8941830089fa5dcdcb4847fb9e.
 * It is read-only public data and is pinned here because a fixture written by
 * the same hand that wrote the decoder proves less than the real thing.
 *
 * It matters in two directions.
 *
 * It is the producer as deployed today, which does not send the per-asset
 * evidence or effect evidence the rebuilt decoder reads. A consumer that
 * required them would break the live site on the first deploy, so the decoder
 * has to accept their absence, and this asserts that it does.
 *
 * It also records what the deployed producer gets wrong, which is what the
 * backend repairs on this branch fix. Its checkpoint states height zero beside
 * the real tip block hash, and all thirty one roster protocols report
 * `no-transaction-reader` even though two adapters are configured there. Both
 * are asserted below, so when the repaired producer ships this test fails and
 * says so rather than quietly passing on stale expectations.
 */
function livePayload(): unknown {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, 'live-evidence/mainnet-summary-20260919.json');
  return JSON.parse(readFileSync(path, 'utf8'));
}

const CONTEXT = {
  chain: 'bitcoin',
  network: 'mainnet',
  txid: '5b63ff3a594995bb9890f7cc96449f9d95a4f35b3f98bf2a753831ee7906a347',
};

describe('the live production payload', () => {
  it('decodes under the rebuilt decoder without its optional evidence', () => {
    const decoded = decodeTransactionAssetSummary(livePayload(), CONTEXT);
    expect(decoded.txid).toBe(CONTEXT.txid);
    expect(decoded.assets).toHaveLength(0);
    expect(decoded.perProtocolCoverage).toHaveLength(31);
    // Nothing conclusive, so no total. This is the state the live site is in.
    expect(decoded.counts.totalCount).toBeNull();
    expect(decoded.retryAfterSeconds).toBe(5);
  });

  it('records the two producer defects this branch repairs', () => {
    const payload = livePayload() as {
      checkpoint: { heightAtomic: string; blockHash: string };
      perProtocolCoverage: { reason: string }[];
    };
    // A real tip block hash beside height zero: the transaction was not read at
    // genesis, and a consumer comparing reorg epochs would trust this over every
    // real reading. The repaired producer returns null instead.
    expect(payload.checkpoint.heightAtomic).toBe('0');
    expect(payload.checkpoint.blockHash).not.toBe('0'.repeat(64));
    // Every protocol reads as having no reader at all, including the six that
    // two configured adapters do read. The repaired producer separates a
    // missing reader from a configured one that did not answer.
    const reasons = new Set(payload.perProtocolCoverage.map((entry) => entry.reason));
    expect([...reasons]).toEqual(['no-transaction-reader']);
  });

  it('never states a coverage state the contract does not define', () => {
    const decoded = decodeTransactionAssetSummary(livePayload(), CONTEXT);
    for (const entry of decoded.perProtocolCoverage) {
      expect(entry.state).toBe('unconfigured');
      expect(entry.chain).toBe('bitcoin');
      expect(entry.network).toBe('mainnet');
    }
  });
});

describe('the panel rendering the live production payload', () => {
  beforeAll(async () => {
    Object.defineProperty(TransactionAssetsComponent, 'ctorParameters', {
      configurable: true,
      value: () => [{ type: UniverseApiService }],
    });
    await resolveTemplates(import.meta.url, '../transaction-assets');
    TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
  });
  afterEach(() => TestBed.resetTestingModule());

  function render() {
    const decoded = decodeTransactionAssetSummary(livePayload(), CONTEXT);
    TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [TransactionAssetsComponent],
      providers: [
        {
          provide: UniverseApiService,
          useValue: {
            getTransactionAssets$: () => of(decoded),
            getProtocols$: () => of({ protocols: [] }),
          },
        },
      ],
      errorOnUnknownElements: false,
      errorOnUnknownProperties: false,
    });
    const view = TestBed.createComponent(TransactionAssetsComponent);
    view.componentInstance.txid = CONTEXT.txid;
    view.componentInstance.chain = 'bitcoin';
    view.componentInstance.ngOnChanges({
      txid: new SimpleChange(undefined, CONTEXT.txid, true),
    });
    view.detectChanges();
    return view;
  }

  it('says partial and nothing found so far, never that there are none', () => {
    const text = render().nativeElement.textContent as string;
    expect(text).toContain('Partial');
    expect(text).toContain('0 assets found so far');
    // The distinction the whole feature rests on: unknown is not empty.
    expect(text).not.toContain('No supported assets');
    expect(text).not.toContain('reports no supported assets');
  });

  it('states every unread protocol as a limit rather than as waiting', () => {
    const element = render().nativeElement as HTMLElement;
    const text = element.textContent as string;
    expect(text).toContain('Coverage details for 31 of 31 sources');
    expect(text).toContain('No source set up');
    expect(text).toContain('No source reads this protocol per transaction');
    expect(text).not.toContain('Waiting on');
    // Nothing here could clear on a retry, so no retry is offered.
    expect(element.querySelector('.summary-coverage .summary-retry')).toBeNull();
  });

  it('renders no asset table and no fabricated row', () => {
    const element = render().nativeElement as HTMLElement;
    expect(element.querySelector('table.summary-table')).toBeNull();
    expect(element.querySelectorAll('.asset-row')).toHaveLength(0);
  });
});
