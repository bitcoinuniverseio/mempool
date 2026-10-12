import { AddressSourceCheckpoint } from './address-source-checkpoint';
import { SharedAddressSource, SHARED_CHECKPOINT_FRESH_MS, ValidatedAddresses } from './shared-address-source';

const checkpoint = (blockHash: string): AddressSourceCheckpoint => ({
  genesisHash: 'g', blockHeight: 10, blockHash, network: 'mainnet', signetChallenge: null, verifiedAt: 'now',
} as AddressSourceCheckpoint);

function controlled(): { verify: jest.Mock; settle: Array<(value?: Error) => void> } {
  const settle: Array<(value?: Error) => void> = [];
  const verify = jest.fn(() => new Promise<AddressSourceCheckpoint>((resolve, reject) => {
    const call = settle.length;
    settle.push(error => error ? reject(error) : resolve(checkpoint('hash-' + call)));
  }));
  return { verify, settle };
}

describe('shared address source verification', () => {
  it('lets concurrent readers share one verification before their reads', async () => {
    const source = new SharedAddressSource(() => 1000);
    const { verify, settle } = controlled();
    const readers = [source.verify(10, verify), source.verify(10, verify), source.verify(10, verify)];
    expect(verify).toHaveBeenCalledTimes(1);
    settle[0]();
    await expect(Promise.all(readers)).resolves.toEqual([checkpoint('hash-0'), checkpoint('hash-0'), checkpoint('hash-0')]);
  });

  it('reuses a completed checkpoint only while it is fresh', async () => {
    let now = 1000;
    const source = new SharedAddressSource(() => now);
    const { verify, settle } = controlled();
    const first = source.verify(10, verify);
    settle[0]();
    await first;
    now += SHARED_CHECKPOINT_FRESH_MS;
    await source.verify(10, verify);
    expect(verify).toHaveBeenCalledTimes(1);
    now += 1;
    const later = source.verify(10, verify);
    expect(verify).toHaveBeenCalledTimes(2);
    settle[1]();
    await expect(later).resolves.toEqual(checkpoint('hash-1'));
  });

  it('never fences a read with a verification that began before the read ended', async () => {
    let now = 1000;
    const source = new SharedAddressSource(() => now);
    const { verify, settle } = controlled();
    const before = source.verify(10, verify);
    now = 1200; // the read ends while the first verification is still in flight
    const after = source.verify(10, verify, 1200);
    const sibling = source.verify(10, verify, 1150);
    expect(verify).toHaveBeenCalledTimes(1);
    now = 1300;
    settle[0]();
    await before;
    await new Promise(resolve => setImmediate(resolve));
    expect(verify).toHaveBeenCalledTimes(2); // one later verification covers both readers
    settle[1]();
    await expect(Promise.all([after, sibling])).resolves.toEqual([checkpoint('hash-1'), checkpoint('hash-1')]);
  });

  it('does not accept a fresh completed checkpoint as the one after a read', async () => {
    let now = 1000;
    const source = new SharedAddressSource(() => now);
    const { verify, settle } = controlled();
    const before = source.verify(10, verify);
    settle[0]();
    await before;
    now = 1100;
    const after = source.verify(10, verify, 1100);
    expect(verify).toHaveBeenCalledTimes(2);
    settle[1]();
    await expect(after).resolves.toEqual(checkpoint('hash-1'));
  });

  it('gives every sharer the failure and verifies afresh next time', async () => {
    const source = new SharedAddressSource(() => 1000);
    const { verify, settle } = controlled();
    const readers = [source.verify(10, verify), source.verify(10, verify)];
    settle[0](new Error('Address source differs from the owned active chain'));
    await expect(readers[0]).rejects.toThrow('differs');
    await expect(readers[1]).rejects.toThrow('differs');
    const next = source.verify(10, verify);
    expect(verify).toHaveBeenCalledTimes(2);
    settle[1]();
    await expect(next).resolves.toEqual(checkpoint('hash-1'));
  });

  it('keeps separate heights apart', async () => {
    const source = new SharedAddressSource(() => 1000);
    const { verify, settle } = controlled();
    const a = source.verify(10, verify);
    const b = source.verify(11, verify);
    expect(verify).toHaveBeenCalledTimes(2);
    settle[0]();
    settle[1]();
    await Promise.all([a, b]);
  });
});

describe('validated addresses', () => {
  it('asks the node once for a valid address and never remembers an invalid one', async () => {
    const validate = jest.fn(async (address: string) => ({ isvalid: address !== 'bad', scriptPubKey: '00' }));
    const addresses = new ValidatedAddresses<{ isvalid: boolean; scriptPubKey: string }>(2);
    await addresses.read('a', validate);
    await addresses.read('a', validate);
    expect(validate).toHaveBeenCalledTimes(1);
    await addresses.read('bad', validate);
    await addresses.read('bad', validate);
    expect(validate).toHaveBeenCalledTimes(3);
    await addresses.read('b', validate);
    await addresses.read('c', validate); // evicts 'a'
    await addresses.read('a', validate);
    expect(validate).toHaveBeenCalledTimes(6);
  });
});
