import { createHash } from 'crypto';
import { Transaction } from 'bitcoinjs-lib';

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest();
const uint32 = (value: number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
};
const compactSize = (value: number) => {
  if (value < 253) return Buffer.from([value]);
  if (value < 65536) {
    const bytes = Buffer.alloc(3);
    bytes[0] = 253;
    bytes.writeUInt16LE(value, 1);
    return bytes;
  }
  return Buffer.concat([Buffer.from([254]), uint32(value)]);
};
const string = (bytes: Buffer) =>
  Buffer.concat([compactSize(bytes.length), bytes]);
/** BIP119 DefaultCheckTemplateVerifyHash. One bounded precomputation per transaction. */
export function ctvTemplateHashes(
  transactionHex: string,
  indexes: number[]
): { hashes: string[] } {
  if (
    typeof transactionHex !== 'string' ||
    transactionHex.length > 800000 ||
    !/^(?:[0-9a-f]{2})+$/i.test(transactionHex)
  )
    throw new Error('Provide bounded canonical transaction hex.');
  if (
    !Array.isArray(indexes) ||
    !indexes.length ||
    indexes.length > 1000 ||
    indexes.some(
      (index) => !Number.isInteger(index) || index < 0 || index > 0xffffffff
    )
  )
    throw new Error('CTV indexes must be uint32 integers.');
  // Hash tests intentionally include arbitrary signed int64 output values. Read
  // their exact wire bytes; converting them through JavaScript numbers loses bits.
  const bytes = Buffer.from(transactionHex, 'hex');
  let offset = 0;
  const read = (length: number) => {
    if (length < 0 || offset + length > bytes.length)
      throw new Error('Truncated transaction.');
    const value = bytes.subarray(offset, offset + length);
    offset += length;
    return value;
  };
  const size = () => {
    const prefix = read(1)[0];
    if (prefix < 253) return prefix;
    if (prefix === 255)
      throw new Error('Transaction collection exceeds byte bound.');
    const value =
      prefix === 253 ? read(2).readUInt16LE() : read(4).readUInt32LE();
    if (value < (prefix === 253 ? 253 : 65536) || value > bytes.length)
      throw new Error('Invalid compact size.');
    return value;
  };
  const version = read(4);
  let witness = false;
  if (bytes[offset] === 0 && bytes[offset + 1] !== 0) {
    const flag = read(2)[1];
    if (flag !== 1) throw new Error('Unknown witness flags.');
    witness = true;
  }
  const inputCount = size();
  if (!inputCount || inputCount > 10000)
    throw new Error('Input count exceeds supported bound.');
  const scriptSigs: Buffer[] = [],
    sequenceBytes: Buffer[] = [];
  for (let i = 0; i < inputCount; i++) {
    read(36);
    scriptSigs.push(read(size()));
    sequenceBytes.push(read(4));
  }
  const outputCount = size();
  if (outputCount > 10000)
    throw new Error('Output count exceeds supported bound.');
  const outputBytes: Buffer[] = [];
  for (let i = 0; i < outputCount; i++) {
    const value = read(8);
    outputBytes.push(Buffer.concat([value, string(read(size()))]));
  }
  if (witness) {
    let present = false;
    for (let i = 0; i < inputCount; i++) {
      const count = size();
      present ||= count > 0;
      for (let j = 0; j < count; j++) read(size());
    }
    if (!present) throw new Error('Superfluous witness marker.');
  }
  const locktime = read(4);
  if (offset !== bytes.length) throw new Error('Trailing transaction bytes.');
  const scripts = scriptSigs.some((script) => script.length)
    ? sha256(Buffer.concat(scriptSigs.map(string)))
    : Buffer.alloc(0);
  const sequences = sha256(Buffer.concat(sequenceBytes));
  const outputs = sha256(Buffer.concat(outputBytes));
  const prefix = Buffer.concat([
    version,
    locktime,
    scripts,
    uint32(inputCount),
    sequences,
    uint32(outputCount),
    outputs,
  ]);
  return {
    hashes: indexes.map((index) =>
      sha256(Buffer.concat([prefix, uint32(index)])).toString('hex')
    ),
  };
}

export function checkBareCtv(
  transactionHex: string,
  inputIndex: number,
  covenantScript: string
) {
  if (
    typeof covenantScript !== 'string' ||
    !/^20[0-9a-f]{64}b3$/i.test(covenantScript)
  )
    throw new Error(
      'This checker requires the exact bare BIP119 script: PUSH32 <template hash> OP_CHECKTEMPLATEVERIFY. Other scripts require a complete hypothetical interpreter.'
    );
  const { hashes } = ctvTemplateHashes(transactionHex, [inputIndex]);
  const transaction = Transaction.fromHex(transactionHex);
  if (inputIndex >= transaction.ins.length)
    throw new Error('The spending input index is out of bounds.');
  if (!transaction.ins.length || !transaction.outs.length)
    throw new Error('Transaction must have inputs and outputs.');
  if (
    transaction.outs.some(
      (output) => output.value < 0 || output.value > 2100000000000000
    ) ||
    transaction.outs.reduce((sum, output) => sum + output.value, 0) >
      2100000000000000
  )
    throw new Error('Invalid transaction output amounts.');
  return {
    template_matches: hashes[0] === covenantScript.slice(2, 66).toLowerCase(),
    calculated_template_hash: hashes[0],
    committed_template_hash: covenantScript.slice(2, 66).toLowerCase(),
    transaction_id: transaction.getId(),
    input_index: inputIndex,
  };
}
