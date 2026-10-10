/** Tracks actual completion, including children admitted by work already running. */
export class TaskDrain {
  private readonly active = new Set<Promise<unknown>>();

  public track<T>(work: Promise<T>): Promise<T> {
    this.active.add(work);
    // Observe both outcomes without creating an unowned rejecting promise.
    work.then(() => this.active.delete(work), () => this.active.delete(work)).catch(() => undefined);
    return work;
  }

  /** @asyncSafe Completion is observed; operation failures belong to their caller. */
  public async drain(): Promise<void> {
    while (this.active.size) {
      await Promise.allSettled([...this.active]);
    }
  }
}
