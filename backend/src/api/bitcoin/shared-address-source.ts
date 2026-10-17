import { AddressSourceCheckpoint } from './address-source-checkpoint';

/** How long a completed verification may serve as the checkpoint taken before a read. */
export const SHARED_CHECKPOINT_FRESH_MS = 1000;

interface Flight {
  startedAt: number;
  completedAt: number;
  pending: boolean;
  promise: Promise<AddressSourceCheckpoint>;
}

type Verify = (indexedTip: number | null) => Promise<AddressSourceCheckpoint>;

/**
 * One owned-node verification answers every address read that asks the same
 * question at the same time.
 *
 * A verification costs three round trips to the owned node, and each read used
 * to pay for two of them alone. Readers now join the verification in flight.
 * The fence around a read is unchanged: the checkpoint taken before it may be
 * at most SHARED_CHECKPOINT_FRESH_MS old, and the one taken after it must have
 * started after the read finished (`notBefore`).
 */
export class SharedAddressSource {
  private readonly flights = new Map<number | null, Flight>();

  constructor(private readonly now: () => number = Date.now) {}

  verify(indexedTip: number | null, verify: Verify, notBefore?: number): Promise<AddressSourceCheckpoint> {
    const flight = this.flights.get(indexedTip);
    if (flight) {
      if (notBefore === undefined) {
        if (flight.pending || this.now() - flight.completedAt <= SHARED_CHECKPOINT_FRESH_MS) {
          return flight.promise;
        }
      } else if (flight.startedAt >= notBefore) {
        return flight.promise;
      } else if (flight.pending) {
        // That verification began before this read ended, so it cannot fence it.
        const retry = (): Promise<AddressSourceCheckpoint> => this.verify(indexedTip, verify, notBefore);
        return flight.promise.then(retry, retry);
      }
    }
    return this.start(indexedTip, verify);
  }

  private start(indexedTip: number | null, verify: Verify): Promise<AddressSourceCheckpoint> {
    const flight: Flight = { startedAt: this.now(), completedAt: 0, pending: true, promise: undefined as never };
    flight.promise = verify(indexedTip).then(checkpoint => {
      flight.pending = false;
      flight.completedAt = this.now();
      return checkpoint;
    }, error => {
      flight.pending = false;
      if (this.flights.get(indexedTip) === flight) {
        this.flights.delete(indexedTip);
      }
      throw error;
    });
    // Each caller handles its own copy of a rejection; this one is the map's.
    flight.promise.catch(() => undefined);
    this.flights.set(indexedTip, flight);
    while (this.flights.size > 8) {
      this.flights.delete(this.flights.keys().next().value as number | null);
    }
    return flight.promise;
  }
}

/** An address encodes one script for the life of the process. */
export class ValidatedAddresses<T extends { isvalid?: boolean }> {
  private readonly entries = new Map<string, T>();

  constructor(private readonly limit = 20000) {}

  async read(address: string, validate: (address: string) => Promise<T>): Promise<T> {
    const known = this.entries.get(address);
    if (known) {
      return known;
    }
    const info = await validate(address);
    if (info?.isvalid) {
      if (this.entries.size >= this.limit) {
        this.entries.delete(this.entries.keys().next().value as string);
      }
      this.entries.set(address, info);
    }
    return info;
  }
}
