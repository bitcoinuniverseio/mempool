import { firstValueFrom, Observable, Subject, takeUntil, timeout } from 'rxjs';

export interface EvidencePageRead<T> { rows: T[]; complete: boolean; sourceComplete: boolean; nextCursor?: string; error?: string }

/** Bounded cursor traversal. Retained rows never imply complete coverage. */
export async function readEvidencePages<T, P extends { readonly nextCursor: string | null; readonly sourceState: string }>(
  request: (cursor?: string) => Observable<P>,
  accept: (page: P) => readonly T[],
  identity: (row: T) => string,
  cancel: Subject<void>,
  resume?: EvidencePageRead<T>,
): Promise<EvidencePageRead<T>> {
  const rows = new Map<string, T>((resume?.rows ?? []).map(row => [identity(row), row]));
  const cursors = new Set<string>();
  let cursor = resume?.nextCursor;
  let complete = resume?.sourceComplete ?? true;
  try {
    for (let count = 0; count < 50; count++) {
      const page = await firstValueFrom(request(cursor).pipe(timeout(15000), takeUntil(cancel)));
      if (page.nextCursor !== null && (typeof page.nextCursor !== 'string' || !page.nextCursor || cursors.has(page.nextCursor))) throw Error('Invalid or repeated continuation cursor');
      const accepted = accept(page);
      if (accepted.length > 250) throw Error('Oversized evidence page');
      for (const row of accepted) {
        const key = identity(row);
        const prior = rows.get(key);
        if (prior && JSON.stringify(prior) !== JSON.stringify(row)) throw Error('Conflicting repeated evidence');
        rows.set(key, row);
      }
      if (!['proven', 'live'].includes(page.sourceState)) complete = false;
      if (page.nextCursor === null) return { rows: [...rows.values()], complete, sourceComplete: complete };
      cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    return { rows: [...rows.values()], complete: false, sourceComplete: complete, nextCursor: cursor, error: 'Evidence page limit reached' };
  } catch (error) {
    return { rows: [...rows.values()], complete: false, sourceComplete: complete, nextCursor: cursor, error: error instanceof Error ? error.message : 'Evidence read failed' };
  }
}
