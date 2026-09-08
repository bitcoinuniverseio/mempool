import { readFileSync } from 'node:fs';
import { convertToParamMap } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { LiquidUnblindWorkspaceComponent } from '@app/universe/liquid-observatory/liquid-unblind-workspace.component';
import { PaymentStudioComponent } from '@app/universe/payment-studio/payment-studio.component';
import { portfolioNativeAssetKey } from '@app/universe/portfolio/data/portfolio-data.service';
import { PORTFOLIO_START_ROUTE } from '@app/universe/portfolio/home/portfolio-home.component';
import { RgbStudioComponent } from '@app/universe/rgb/rgb-studio.component';
import { ScriptStudioComponent } from '@app/universe/script-studio/script-studio.component';
import { LightningStandardsComponent } from '@app/universe/taproot-assets/lightning-standards.component';
import { TaprootAssetsComponent } from '@app/universe/taproot-assets/taproot-assets.component';
import { ZcashViewingKeyWorkspaceComponent } from '@app/universe/zcash-privacy/zcash-viewing-key-workspace.component';

const seo = { setTitle: vi.fn() } as unknown as SeoService;

function captureAfter<T>(observable: Observable<T>, action: () => void): T {
  let latest: T | undefined;
  const subscription = observable.subscribe((value) => {
    latest = value;
  });
  action();
  subscription.unsubscribe();
  if (latest === undefined) {
    throw new Error('Expected a synchronous state emission.');
  }
  return latest;
}

describe('payment standards', () => {
  it('rejects malformed BIP21 input without replacing the user query', () => {
    const subject = new PaymentStudioComponent(seo);
    subject.bip21Uri = 'bitcoin:not-valid?amount=-1';

    const result = captureAfter(subject.parsedBip21$, () =>
      subject.parseBip21()
    );

    expect(result).toBeNull();
    expect(subject.bip21Uri).toBe('bitcoin:not-valid?amount=-1');
    expect(subject.bip21Notice).toContain('recognizable Bitcoin address');
  });

  it('parses fields but states that the destination was not verified', () => {
    const subject = new PaymentStudioComponent(seo);
    subject.bip21Uri = `bitcoin:bc1q${'q'.repeat(38)}?amount=0.001&label=Local`;

    const result = captureAfter(subject.parsedBip21$, () =>
      subject.parseBip21()
    );

    expect(result?.amountBtc).toBe('0.001');
    expect(subject.bip21Notice).toContain('not verified');
  });

  it('does not fabricate a DNSSEC answer', () => {
    const subject = new PaymentStudioComponent(seo);
    subject.bip353Name = 'alice@example.test';

    const result = captureAfter(subject.bip353$, () => subject.resolveBip353());

    expect(result?.kind).toBe('unavailable');
    expect(subject.bip353Name).toBe('alice@example.test');
    expect(result).not.toHaveProperty('resolvedAddress');
    expect(result).not.toHaveProperty('dnssecValid');
  });
});

describe('local protocol workspaces', () => {
  it('never turns an RGB-shaped string into a validation success', () => {
    const subject = new RgbStudioComponent(seo);
    subject.consignmentHex = 'aabbccdd';
    const timer = vi.spyOn(globalThis, 'setTimeout');

    const result = captureAfter(subject.result$, () => subject.validate());

    expect(timer).not.toHaveBeenCalled();
    timer.mockRestore();
    expect(result?.kind).toBe('unavailable');
    expect(result).not.toHaveProperty('valid');
    expect(subject.consignmentHex).toBe('aabbccdd');
  });

  it('rejects malformed RGB input', () => {
    const subject = new RgbStudioComponent(seo);
    subject.consignmentHex = 'not a consignment';
    const result = captureAfter(subject.result$, () => subject.validate());
    expect(result?.kind).toBe('invalid-input');
  });

  it('does not expose a Zcash viewing-key input while scanning is unavailable', () => {
    const subject = new ZcashViewingKeyWorkspaceComponent(seo);
    const template = readFileSync(
      new URL(
        './zcash-privacy/zcash-viewing-key-workspace.component.html',
        import.meta.url
      ),
      'utf8'
    );

    expect(subject).not.toHaveProperty('viewingKey');
    expect(subject).not.toHaveProperty('scan');
    expect(template).not.toMatch(/<input|<textarea|type="password"/i);
    expect(template).toContain('has no viewing-key input');
  });

  it('does not expose a Liquid blinding-key input while unblinding is unavailable', () => {
    const subject = new LiquidUnblindWorkspaceComponent(seo);
    const template = readFileSync(
      new URL(
        './liquid-observatory/liquid-unblind-workspace.component.html',
        import.meta.url
      ),
      'utf8'
    );

    expect(subject).not.toHaveProperty('blindingKey');
    expect(subject).not.toHaveProperty('unblind');
    expect(template).not.toMatch(/<input|<textarea|type="password"/i);
    expect(template).toContain('has no blinding-key input');
  });

  it('does not simulate Script execution or address derivation', () => {
    const subject = new ScriptStudioComponent(seo);
    subject.scriptInput = 'OP_TRUE';

    const result = captureAfter(subject.result$, () => subject.trace());

    expect(result?.kind).toBe('unavailable');
    expect(result?.tokens).toEqual(['OP_TRUE']);
    expect(result).not.toHaveProperty('satisfactionValid');
    expect(result).not.toHaveProperty('derivedAddress');
    expect(subject.scriptInput).toBe('OP_TRUE');
  });
});

describe('provider-backed standards data', () => {
  it('does not decode a plausible BOLT12 string without a real decoder', () => {
    const api = {} as UniverseApiService;
    const subject = new LightningStandardsComponent(api, seo);
    subject.offerInput = 'lno1qqqqqq';

    subject.decode();

    expect(subject.offerInspection?.kind).toBe('unavailable');
    expect(subject.offerInspection).not.toHaveProperty('valid');
    expect(subject.offerInput).toBe('lno1qqqqqq');
  });

  it('shows an error when either Lightning provider request fails', () => {
    const api = {
      getBolt12Offers$: () => throwError(() => new Error('offline')),
      getLightningRfq$: () => of({ quotes: [], total: 0 }),
    } as unknown as UniverseApiService;
    const subject = new LightningStandardsComponent(api, seo);

    const result = captureAfter(subject.vm$, () => subject.ngOnInit());

    expect(result.kind).toBe('error');
  });

  it('does not turn a failed Taproot Assets request into an empty success', () => {
    const api = {
      getTaprootAssets$: () => throwError(() => new Error('offline')),
      getTaprootAssetGroups$: () => of({ groups: [], total: 0 }),
    } as unknown as UniverseApiService;
    const route = { paramMap: of(convertToParamMap({})) };
    const subject = new TaprootAssetsComponent(api, route as never, seo);

    const result = captureAfter(subject.vm$, () => subject.ngOnInit());

    expect(result.kind).toBe('error');
  });
});

describe('portfolio identity and entry actions', () => {
  it('separates native assets by chain and network', () => {
    expect(
      portfolioNativeAssetKey({ chain: 'bitcoin', network: 'mainnet' })
    ).toBe('bitcoin:mainnet:base:native:bitcoin');
    expect(
      portfolioNativeAssetKey({ chain: 'dogecoin', network: 'mainnet' })
    ).toBe('dogecoin:mainnet:base:native:dogecoin');
    expect(
      portfolioNativeAssetKey({ chain: 'bitcoin', network: 'testnet' })
    ).toBe('bitcoin:testnet:base:native:bitcoin');
  });

  it('opens the real portfolio entry flow instead of a fixed address', () => {
    expect(PORTFOLIO_START_ROUTE).toBe('/portfolio/new');
    expect(PORTFOLIO_START_ROUTE).not.toContain('example');
  });
});
