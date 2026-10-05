export interface CanonicalTip { height: number; hash: string }
/** Three sequential observations around the existing IDs, Blocks and cache-update operations. */
export class CanonicalPollFence {
  private matched = false;
  private constructor(readonly expected: CanonicalTip | null, private readonly read: () => Promise<CanonicalTip>) { }
  public static async begin(expected: CanonicalTip | null, read: () => Promise<CanonicalTip>): Promise<CanonicalPollFence> {
    const fence = new CanonicalPollFence(expected ? { ...expected } : null, read);
    if (expected) { fence.matched = true; await fence.verify(); }
    return fence;
  }
  /** @asyncSafe All provider failures make this fence permanently unavailable. */
  public async verify(): Promise<boolean> {
    if (!this.expected || !this.matched) return false;
    try {
      const observed = await this.read();
      this.matched = Number.isSafeInteger(observed.height) && observed.height >= 0 && typeof observed.hash === 'string' && /^[0-9a-f]{64}$/.test(observed.hash) &&
        observed.height === this.expected.height && observed.hash === this.expected.hash;
    } catch { this.matched = false; }
    return this.matched;
  }
}
