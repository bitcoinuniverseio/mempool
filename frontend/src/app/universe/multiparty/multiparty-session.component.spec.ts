// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { MultipartySessionComponent } from './multiparty-session.component';

describe('unavailable signing session presentation', () => {
  beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
  afterEach(() => TestBed.resetTestingModule());

  it('shows an arbitrary requested ID without inventing signing rounds, keys or participants', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    vi.spyOn(TestBed.inject(ActivatedRoute).snapshot.paramMap, 'get').mockReturnValue('session-does-not-exist');
    const view = TestBed.createComponent(MultipartySessionComponent);
    expect(view.componentInstance.sessionId).toBe('');
    view.detectChanges();
    const content = view.nativeElement.textContent;
    expect(content).toContain('session-does-not-exist');
    expect(view.nativeElement.querySelector('[role="alert"]').textContent).toContain('cannot establish whether');
    expect(content).toContain('Not verified');
    expect(content).not.toMatch(/COMPLETE|ROUND 2|1\/2|a89c7d8e|2 participants|created in-memory/);
    expect(view.nativeElement.querySelector('a').getAttribute('href')).toBe('/tools/multiparty/musig2');
  });
});
