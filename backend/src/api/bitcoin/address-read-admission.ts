import { AsyncLocalStorage } from 'async_hooks';

const busy = (): Error => Object.assign(new Error('Address lookup is busy'), { code: 'EADDRESSBUSY' });

/** Caller termination does not terminate a raw Electrum request. */
class AddressReadOwner {
  private readonly pending = new Set<Promise<unknown>>();
  private release: (() => void) | null = null;
  sealed = false;
  track<T>(factory: () => Promise<T>): Promise<T> {
    if (this.sealed) {
      const rejected = Promise.reject<T>(busy());
      rejected.catch(() => { /* A sealed continuation is already caller-terminal. */ });
      return rejected;
    }
    const operation = Promise.resolve().then(() => {
      if (this.sealed) { throw busy(); }
      return factory();
    });
    // Own the deferred factory before dispatch, including synchronous failure.
    this.pending.add(operation);
    const settled = (): void => { this.pending.delete(operation); this.idle(); };
    operation.then(settled, settled).catch(() => { /* Local bookkeeping never redispatches raw work. */ });
    return operation;
  }
  seal(release: () => void): void { this.sealed = true; this.release = release; this.idle(); }
  private idle(): void {
    if (this.sealed && this.pending.size === 0 && this.release) {
      const release = this.release; this.release = null; release();
    }
  }
}

/** No request queue: excess address work must retry rather than exhaust Core. */
export class AddressReadAdmission {
  private active = 0;
  private readonly context = new AsyncLocalStorage<AddressReadOwner>();
  constructor(private readonly maximum = 2) {}
  async run<T>(read: () => Promise<T>): Promise<T> {
    if (this.active >= this.maximum) { throw busy(); }
    this.active++;
    const owner = new AddressReadOwner();
    try { return await this.context.run(owner, read); } finally { owner.seal(() => this.active--); }
  }
  /** A direct capability read owns admission; an existing route lease is reused. */
  inheritOrRun<T>(read: () => Promise<T>): Promise<T> {
    const owner = this.context.getStore();
    return owner ? Promise.resolve().then(() => {
      if (owner.sealed) { throw busy(); }
      return read();
    }) : this.run(read);
  }
  /** Register RAW completion, before wrapping it in a caller deadline race. */
  track<T>(factory: () => Promise<T>): Promise<T> {
    const owner = this.context.getStore();
    return owner ? owner.track(factory) : Promise.resolve().then(factory);
  }
}
export const addressReadAdmission = new AddressReadAdmission();
