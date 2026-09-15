import { Point } from '@noble/secp256k1';

function key(value: string): string {
  if (!/^(02|03)[0-9a-f]{64}$/i.test(value))
    throw new Error('Use a compressed 33-byte public key.');
  Point.fromHex(value).assertValidity();
  return value.toLowerCase();
}
function scriptNumber(value: number): string {
  if (value <= 16) return (0x50 + value).toString(16);
  const bytes: number[] = [];
  let n = value;
  while (n) {
    bytes.push(n & 255);
    n >>= 8;
  }
  if (bytes[bytes.length - 1] & 128) bytes.push(0);
  return (
    bytes.length.toString(16).padStart(2, '0') +
    bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')
  );
}
export function compileVaultScripts(
  hot: string,
  cold: string,
  delay: number,
  templateHash: string
) {
  const hotKey = key(hot),
    coldKey = key(cold);
  if (hotKey === coldKey) throw new Error('Hot and recovery keys must differ.');
  if (!Number.isInteger(delay) || delay < 1 || delay > 65535)
    throw new Error('The block delay must be an integer from 1 to 65535.');
  if (!/^[0-9a-f]{64}$/i.test(templateHash))
    throw new Error(
      'Provide the BIP119 hash of the exact unvault transaction template.'
    );
  // IF cold CHECKSIG ELSE hot CHECKSIGVERIFY <hash> CTV ENDIF
  const vaultScript =
    '63' +
    '21' +
    coldKey +
    'ac' +
    '67' +
    '21' +
    hotKey +
    'ad' +
    '20' +
    templateHash.toLowerCase() +
    'b3' +
    '68';
  // IF cold CHECKSIG ELSE <delay> CSV DROP hot CHECKSIG ENDIF
  const unvaultScript =
    '63' +
    '21' +
    coldKey +
    'ac' +
    '67' +
    scriptNumber(delay) +
    'b275' +
    '21' +
    hotKey +
    'ac' +
    '68';
  return {
    vaultScript,
    unvaultScript,
    scope:
      'Script construction only. The CTV hash must independently match a transaction paying the intended unvault script. No complete vault, activation, signature, funding or recovery proof is established.',
  };
}
