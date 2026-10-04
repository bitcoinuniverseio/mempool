import { describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import { checksumCreate } from 'utxo-descriptors';
import { WatchlistsComponent } from './watchlists.component';
import { descriptorScripts } from './watchlist-descriptor';
import { createBase58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';

function setup() {
  const response = new Subject<any>();
  const api: any = { addWatchlistEntity$: vi.fn(() => response) };
  const page = new WatchlistsComponent(api, { key: 'public-component-marker' } as any, { markForCheck: () => {} } as any, { network: '', env: { ROOT_NETWORK: 'signet' } } as any);
  page.entityType.owned = 'descriptor'; page.descriptorCount.owned = 1;
  return { page, api, response };
}

describe('descriptor watch selected root network', () => {
  it('binds public script derivation to Signet rather than mainnet on an empty root selector', () => {
    const { page, api, response } = setup();
    // Re-encode the existing public xpub fixture with the test-network version.
    const codec = createBase58check(sha256);
    const publicBytes = codec.decode('xpub6CFtfy4QXsEUW5CtgE7mZe1Lvs15Yw7ctjdyaDRy89JdhtyM1wFf8uY2BdyJ3JmAFfrHdw77hEit1ebVXxB2dytGAvq9mmQJ2c83G1q8P7A');
    publicBytes.set([0x04, 0x35, 0x87, 0xcf], 0);
    const expression = `wpkh(${codec.encode(publicBytes)}/0/*)`;
    const descriptor = expression + '#' + checksumCreate(expression);
    page.entityRaw.owned = descriptor; page.addEntity('owned');
    expect(api.addWatchlistEntity$.mock.calls[0][4]).toEqual(descriptorScripts(descriptor, 'signet', 0, 1));
    expect(response.observed).toBe(true); page.ngOnDestroy(); expect(response.observed).toBe(false);
  });
  it('rejects a mainnet extended key before registration in a Signet root deployment', () => {
    const { page, api } = setup();
    const expression = 'wpkh(xpub6CFtfy4QXsEUW5CtgE7mZe1Lvs15Yw7ctjdyaDRy89JdhtyM1wFf8uY2BdyJ3JmAFfrHdw77hEit1ebVXxB2dytGAvq9mmQJ2c83G1q8P7A/0/*)';
    page.entityRaw.owned = expression + '#' + checksumCreate(expression); page.addEntity('owned');
    expect(api.addWatchlistEntity$).not.toHaveBeenCalled(); expect(page.loadError).toBeTruthy(); page.ngOnDestroy();
  });
});
