import { describe, expect, it } from 'vitest';

import { bannerState } from './connectivity-banner.component';

describe('bannerState', () => {
  it('puts the missing network above everything, because it changes what every page means', () => {
    expect(bannerState(true, true, true)).toBe('offline');
    expect(bannerState(true, false, true)).toBe('offline');
  });

  it('offers the update before the install', () => {
    expect(bannerState(false, true, true)).toBe('update');
  });

  it('offers installation when there is nothing more urgent', () => {
    expect(bannerState(false, false, true)).toBe('install');
  });

  it('says nothing when there is nothing to say', () => {
    expect(bannerState(false, false, false)).toBeNull();
  });
});
