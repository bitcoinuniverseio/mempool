// @vitest-environment jsdom
import 'zone.js';
import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { ChainReasonListComponent } from './chain-reason-list.component';
import { describeChainReasons } from './chain-reasons';

describe('chain reason list', () => {
  beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
  afterEach(() => TestBed.resetTestingModule());

  function render(codes: readonly string[]): ReturnType<typeof TestBed.createComponent<ChainReasonListComponent>> {
    TestBed.configureTestingModule({});
    const view = TestBed.createComponent(ChainReasonListComponent);
    view.componentInstance.reasons = describeChainReasons(codes);
    view.detectChanges();
    return view;
  }

  it('marks a stated limit apart from an outage so it does not read as one', () => {
    const view = render(['confirmed-history-authority-unavailable', 'reorg-evidence-tail-only']);
    const items = view.nativeElement.querySelectorAll('li');
    expect(items.length).toBe(2);
    expect(items[0].className).toContain('reason--fault');
    expect(items[1].className).toContain('reason--limit');
    // The two must not present identically, which is the whole point.
    expect(items[0].className).not.toBe(items[1].className);
  });

  it('gives every coverage limit the same limit treatment', () => {
    const view = render([
      'pending-protocol-coverage-unavailable',
      'pending-protocol-coverage-partial',
      'pending-protocol-coverage-unknown',
      'reorg-evidence-unknown',
    ]);
    const items = view.nativeElement.querySelectorAll('li');
    expect(items.length).toBe(4);
    for (const item of items) {
      expect(item.className).toContain('reason--limit');
    }
  });

  it('shows a code it has no sentence for rather than dropping it', () => {
    const view = render(['some-code-this-build-never-heard-of']);
    const item = view.nativeElement.querySelector('li');
    expect(item.className).toContain('reason--unstated');
    expect(item.textContent).toContain('Some code this build never heard of');
  });

  it('names the kind for a screen reader, not only by colour', () => {
    const view = render(['confirmed-history-authority-unavailable']);
    expect(view.nativeElement.querySelector('.visually-hidden').textContent.trim()).toBe('Problem:');
    // Colour alone would leave the distinction invisible to assistive tech.
    expect(view.nativeElement.querySelector('svg')).toBeTruthy();
  });

  it('renders nothing when there is nothing to explain', () => {
    const view = render([]);
    expect(view.nativeElement.querySelectorAll('li').length).toBe(0);
  });
});
