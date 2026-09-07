// @vitest-environment jsdom
import { addressToScriptPubKey, decodeRawTransaction, encodePsbt, hexStringToUint8Array, scriptPubKeyToAddress, serializeTransaction } from './transaction-codec.utils';
import { uint8ArrayToHexString } from './transaction.utils';

// Bitcoin's genesis transaction is an independent wire-format and txid vector.
const genesis = '0100000001' + '00'.repeat(32) + 'ffffffff4d04ffff001d010445'
  + '5468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73'
  + 'ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000';

describe('lazy transaction codec', () => {
  it('decodes the published genesis txid and preserves its wire bytes', () => {
    const { tx } = decodeRawTransaction(genesis, '');
    expect(tx.txid).toBe('4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b');
    expect(tx.vout[0].value).toBe(5_000_000_000);
    expect(uint8ArrayToHexString(serializeTransaction(tx, false))).toBe(genesis);
  });

  it('decodes the same transaction inside a PSBT envelope', () => {
    const psbt = encodePsbt(hexStringToUint8Array(genesis), [new Map()], [new Map()]);
    expect(decodeRawTransaction(uint8ArrayToHexString(psbt), '').tx.txid)
      .toBe('4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b');
    expect(() => decodeRawTransaction('70736274ff', '')).toThrow();
  });

  it('preserves the published genesis address script and rejects checksum corruption', () => {
    const address = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
    const script = '76a91462e907b15cbf27d5425399ebf6f0fb50ebb88f1888ac';
    expect(addressToScriptPubKey(address, '').scriptPubKey).toBe(script);
    expect(scriptPubKeyToAddress(script, '').address).toBe(address);
    expect(addressToScriptPubKey(address.slice(0, -1) + 'b', '').scriptPubKey).toBeNull();
  });
});
