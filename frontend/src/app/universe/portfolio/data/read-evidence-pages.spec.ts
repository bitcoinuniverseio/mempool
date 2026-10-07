import { describe, expect, it } from 'vitest';
import { of, Subject, throwError } from 'rxjs';
import { readEvidencePages } from './read-evidence-pages';

describe('bounded evidence pages', () => {
  it('reads all opaque cursors and deduplicates repeated rows', async () => {
    const calls: (string | undefined)[] = [];
    const result = await readEvidencePages(cursor => { calls.push(cursor); return of({ rows: cursor ? ['a', 'b'] : ['a'], sourceState: 'proven', nextCursor: cursor ? null : 'opaque' }); }, page => page.rows, row => row, new Subject());
    expect(calls).toEqual([undefined, 'opaque']);
    expect(result).toMatchObject({ rows: ['a', 'b'], complete: true });
  });
  it('retains earlier rows on continuation failure and exposes partial coverage', async () => {
    const result = await readEvidencePages(cursor => cursor ? throwError(() => Error('outage')) : of({ rows: ['a'], sourceState: 'proven', nextCursor: 'next' }), page => page.rows, row => row, new Subject());
    expect(result).toMatchObject({ rows: ['a'], complete: false, nextCursor: 'next', error: 'outage' });
    const resumed = await readEvidencePages(cursor => {
      expect(cursor).toBe('next');
      return of({ rows: ['b'], sourceState: 'proven', nextCursor: null });
    }, page => page.rows, row => row, new Subject(), result);
    expect(resumed).toMatchObject({ rows: ['a', 'b'], complete: true });
  });
  it('stops repeated cursors without inventing complete coverage', async () => {
    const result = await readEvidencePages(() => of({ rows: ['a'], sourceState: 'proven', nextCursor: 'cycle' }), page => page.rows, row => row, new Subject());
    expect(result.complete).toBe(false);
    expect(result.error).toContain('repeated');
  });
});
