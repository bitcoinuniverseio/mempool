export class MempoolSourceUnavailable extends Error {
  constructor(message: string) { super(message); this.name = 'MempoolSourceUnavailable'; }
}

export function incrementalFeeFrom(info: any): number {
  const fee = info?.incrementalrelayfee;
  if (typeof fee !== 'number' || !Number.isFinite(fee) || fee < 0) {
    throw new MempoolSourceUnavailable('The node did not supply a valid incremental relay fee; fee planning is unavailable.');
  }
  const rate = fee * 100_000;
  if (!Number.isFinite(rate)) throw new MempoolSourceUnavailable('The node relay fee is out of range.');
  return rate;
}
