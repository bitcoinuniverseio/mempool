// @vitest-environment jsdom
import { AddressTypeInfo } from './address-utils';
import { fillTapTree } from './taproot-tree.utils';

describe('lazy taproot tree validation', () => {
  it('accepts an independently derived commitment and rejects an altered leaf', () => {
    const internalKey = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
    // Independently generated with bitcoinjs-lib payments.p2tr and tiny-secp256k1,
    // using this internal key and a one-leaf script tree containing OP_TRUE.
    const commitment = 'bc1pndkwpkc8ql3fly4l3zf76xg36wt785khdw7xsygvf8dzemkghc3sqkwrav';
    const address = new AddressTypeInfo('', commitment, 'v1_p2tr');
    fillTapTree(address, [{ internalKey, leafVersion: 0xc0, scriptHex: '51', merkleBranches: [] }]);
    expect(address.scripts.size).toBe(1);
    const altered = new AddressTypeInfo('', commitment, 'v1_p2tr');
    expect(() => fillTapTree(altered, [{ internalKey, leafVersion: 0xc0, scriptHex: '52', merkleBranches: [] }]))
      .toThrow(/No valid taproot scripts/);
    expect(altered.scripts.size).toBe(0);
  });
});
