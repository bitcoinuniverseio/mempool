/**
 * Long indexing loops call throwIfIndexingStopped() between items once
 * shutdown has begun. Every loop indexes only what is still missing, so the
 * next run resumes where this one stopped.
 */
export class IndexingStopped extends Error {
  constructor() {
    super('Indexing stopped for shutdown; the next run resumes from the missing items.');
  }
}

let stopRequested = false;

export function requestIndexingStop(): void {
  stopRequested = true;
}

export function throwIfIndexingStopped(): void {
  if (stopRequested) {
    throw new IndexingStopped();
  }
}
