import {
  INDEXED_TIP_METHOD,
  readIndexedTip,
} from '../api/bitcoin/electrum-indexed-tip';

/**
 * How the address index reports the height it has reached.
 *
 * This is tested by asserting the wire call, not by mocking the answer,
 * because the defect it exists for was entirely in the call. The client
 * library's `blockchainHeaders_subscribe` convenience method sends one
 * argument; Fulcrum answers `Expected at most 0 parameters for
 * blockchain.headers.subscribe, got 1 instead` and refuses. The throw was
 * swallowed into a null height, a null height made the index look
 * unreachable, and an unreachable index fails the release gate. Every
 * cutover to this deployment rolled back while Fulcrum was healthy and
 * answering the whole time, and the suite stayed green throughout,
 * because every test mocked the answer and none of them looked at the
 * question.
 */

describe('reading the Electrum indexed tip', () => {
  it('asks blockchain.headers.subscribe with no parameters', async () => {
    const calls: { method: string; params: unknown[] }[] = [];
    await readIndexedTip((method, params) => {
      calls.push({ method, params });
      return Promise.resolve({ height: 965_056 });
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe(INDEXED_TIP_METHOD);
    // The arity is the whole defect. Fulcrum accepts zero parameters here
    // and refuses one, so this must stay empty.
    expect(calls[0].params).toEqual([]);
  });

  it('returns the height the server reported', async () => {
    const tip = await readIndexedTip(() => Promise.resolve({ height: 965_056 }));
    expect(tip).toBe(965_056);
  });

  it('accepts the block_height spelling some servers use', async () => {
    const tip = await readIndexedTip(() =>
      Promise.resolve({ block_height: 900_001 }),
    );
    expect(tip).toBe(900_001);
  });

  it('answers null when the server refuses the call', async () => {
    // The exact refusal Fulcrum 2.1.1 returns for the wrong arity.
    const tip = await readIndexedTip(() =>
      Promise.reject(
        new Error(
          'Expected at most 0 parameters for blockchain.headers.subscribe, got 1 instead',
        ),
      ),
    );
    expect(tip).toBeNull();
  });

  it('answers null rather than a fraction or a string', async () => {
    expect(await readIndexedTip(() => Promise.resolve({ height: 1.5 }))).toBeNull();
    expect(
      await readIndexedTip(() => Promise.resolve({ height: '965056' })),
    ).toBeNull();
  });

  it('answers null when the server says nothing useful', async () => {
    expect(await readIndexedTip(() => Promise.resolve({}))).toBeNull();
    expect(await readIndexedTip(() => Promise.resolve(null))).toBeNull();
    expect(await readIndexedTip(() => Promise.resolve(undefined))).toBeNull();
  });
});
