import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LiveFeedFreshness } from './live-feed-freshness';
describe('independent shared dashboard freshness', () => {
  let feed: LiveFeedFreshness;
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T12:00:00Z')); feed = new LiveFeedFreshness(); });
  afterEach(() => { feed.destroy(); vi.useRealTimers(); });
  it('bounds first arrival and retry and rejects the same producer replay', () => {
    vi.advanceTimersByTime(5000); expect(feed.state$.value.status).toBe('error');
    const at = new Date().toISOString(); feed.accept(at); expect(feed.state$.value.status).toBe('data');
    feed.retry(); feed.accept(at); expect(feed.state$.value.status).toBe('loading');
    vi.advanceTimersByTime(5000); expect(feed.state$.value.status).toBe('error');
    feed.accept(new Date().toISOString()); expect(feed.state$.value.status).toBe('data');
  });
  it('ages after first data and preserves the original time across disconnect', () => {
    const at = new Date().toISOString(); feed.accept(at); vi.advanceTimersByTime(120000);
    expect(feed.state$.value).toEqual({ status: 'stale', value: true, at: Date.parse(at), reason: 'network' });
    feed.reset(); expect(feed.state$.value.status).toBe('loading'); expect(vi.getTimerCount()).toBe(1);
  });
  it('future, malformed and expired proof never proves live readiness', () => {
    feed.accept('not a date'); feed.accept(new Date(Date.now() + 6000).toISOString());
    feed.accept(new Date(Date.now() - 120001).toISOString()); expect(feed.state$.value.status).toBe('loading');
  });
});
