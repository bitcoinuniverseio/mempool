import { Transaction } from '@interfaces/electrs.interface';
import { getVarIntLength } from './script.utils';
import { hash, Hash } from './sha256';
import { AddressType, detectAddressType } from './address-utils';
import { uint8ArrayToHexString, convertScriptSigAsm, isInternalKeyNUMS } from './transaction.utils';


// Adapted from bitcoinjs-lib at https://github.com/bitcoinjs/bitcoinjs-lib/blob/32e08aa57f6a023e995d8c4f0c9fbdc5f11d1fa0/ts_src/transaction.ts#L78
/**
 * @param buffer The raw transaction data
 * @param network
 * @param inputs Additional information from a PSBT, if available
 * @returns The decoded transaction object and the raw hex
 */
function fromBuffer(buffer: Uint8Array, network: string, inputs?: PsbtKeyValueMap[]): { tx: Transaction, hex: string } {
  let offset = 0;

  // Parse raw transaction
  const tx = {
    status: {
      confirmed: null,
      block_height: null,
      block_hash: null,
      block_time: null,
    }
  } as Transaction;

  [tx.version, offset] = readInt32(buffer, offset);

  let marker, flag;
  [marker, offset] = readInt8(buffer, offset);
  [flag, offset] = readInt8(buffer, offset);

  let isLegacyTransaction = true;
  if (marker === 0x00 && flag === 0x01) {
    isLegacyTransaction = false;
  } else {
    offset -= 2;
  }

  let vinLen;
  [vinLen, offset] = readVarInt(buffer, offset);
  if (vinLen === 0) {
    throw new Error('Transaction has no inputs');
  }
  tx.vin = [];
  for (let i = 0; i < vinLen; ++i) {
    let txid, vout, scriptsig, sequence;
    [txid, offset] = readSlice(buffer, offset, 32);
    txid = uint8ArrayToHexString(txid.reverse());
    [vout, offset] = readInt32(buffer, offset, true);
    [scriptsig, offset] = readVarSlice(buffer, offset);
    scriptsig = uint8ArrayToHexString(scriptsig);
    [sequence, offset] = readInt32(buffer, offset, true);
    const is_coinbase = txid === '0'.repeat(64);
    const scriptsig_asm = convertScriptSigAsm(scriptsig);
    tx.vin.push({ txid, vout, scriptsig, sequence, is_coinbase, scriptsig_asm, prevout: null });
  }

  let voutLen;
  [voutLen, offset] = readVarInt(buffer, offset);
  tx.vout = [];
  for (let i = 0; i < voutLen; ++i) {
    let value, scriptpubkeyArray, scriptpubkey;
    [value, offset] = readInt64(buffer, offset);
    value = Number(value);
    [scriptpubkeyArray, offset] = readVarSlice(buffer, offset);
    scriptpubkey = uint8ArrayToHexString(scriptpubkeyArray);
    const scriptpubkey_asm = convertScriptSigAsm(scriptpubkey);
    const toAddress = scriptPubKeyToAddress(scriptpubkey, network);
    const scriptpubkey_type = toAddress.type;
    const scriptpubkey_address = toAddress?.address;
    tx.vout.push({ value, scriptpubkey, scriptpubkey_asm, scriptpubkey_type, scriptpubkey_address });
  }

  if (!isLegacyTransaction) {
    for (let i = 0; i < vinLen; ++i) {
      let witness;
      [witness, offset] = readVector(buffer, offset);
      tx.vin[i].witness = witness.map(uint8ArrayToHexString);
    }
  }

  [tx.locktime, offset] = readInt32(buffer, offset, true);

  if (offset !== buffer.length) {
    throw new Error('Transaction has unexpected data');
  }

  // Optionally add data from PSBT: prevouts, redeem/witness scripts and signatures
  if (inputs) {
    for (let i = 0; i < tx.vin.length; i++) {
      const vin = tx.vin[i];
      const inputRecords = inputs[i];

      const groups = {
        nonWitnessUtxo: inputRecords.get(PSBT_IN.NON_WITNESS_UTXO)?.[0] || null,
        witnessUtxo: inputRecords.get(PSBT_IN.WITNESS_UTXO)?.[0] || null,
        finalScriptSig: inputRecords.get(PSBT_IN.FINAL_SCRIPTSIG)?.[0] || null,
        finalScriptWitness: inputRecords.get(PSBT_IN.FINAL_SCRIPTWITNESS)?.[0] || null,
        redeemScript: inputRecords.get(PSBT_IN.REDEEM_SCRIPT)?.[0] || null,
        witnessScript: inputRecords.get(PSBT_IN.WITNESS_SCRIPT)?.[0] || null,
        partialSigs: inputRecords.get(PSBT_IN.PARTIAL_SIG) || [],
        tapLeafScripts: inputRecords.get(PSBT_IN.TAP_LEAF_SCRIPT) || [],
        tapScriptSigs: inputRecords.get(PSBT_IN.TAP_SCRIPT_SIG) || [],
        tapInternalKey: inputRecords.get(PSBT_IN.TAP_INTERNAL_KEY)?.[0] || null,
      };

      // Fill prevout
      if (groups.witnessUtxo && !vin.prevout) {
        let value, scriptpubkeyArray, scriptpubkey, outputOffset = 0;
        [value, outputOffset] = readInt64(groups.witnessUtxo.value, outputOffset);
        value = Number(value);
        [scriptpubkeyArray, outputOffset] = readVarSlice(groups.witnessUtxo.value, outputOffset);
        scriptpubkey = uint8ArrayToHexString(scriptpubkeyArray);
        const scriptpubkey_asm = convertScriptSigAsm(scriptpubkey);
        const toAddress = scriptPubKeyToAddress(scriptpubkey, network);
        const scriptpubkey_type = toAddress.type;
        const scriptpubkey_address = toAddress?.address;
        vin.prevout = { value, scriptpubkey, scriptpubkey_asm, scriptpubkey_type, scriptpubkey_address };
      }
      if (groups.nonWitnessUtxo && !vin.prevout) {
        const utxoTx = fromBuffer(groups.nonWitnessUtxo.value, network).tx;
        vin.prevout = utxoTx.vout[vin.vout];
      }

      // Fill final scriptSig or witness
      let finalizedScriptSig = false;
      if (groups.finalScriptSig) {
        vin.scriptsig = uint8ArrayToHexString(groups.finalScriptSig.value);
        vin.scriptsig_asm = convertScriptSigAsm(vin.scriptsig);
        finalizedScriptSig = true;
      }
      let finalizedWitness = false;
      if (groups.finalScriptWitness) {
        let witness = [];
        let witnessOffset = 0;
        [witness, witnessOffset] = readVector(groups.finalScriptWitness.value, witnessOffset);
        vin.witness = witness.map(uint8ArrayToHexString);
        finalizedWitness = true;
      }
      if (finalizedScriptSig && finalizedWitness) {
        continue;
      }

      // Fill redeem script and/or witness script
      if (groups.redeemScript && !finalizedScriptSig) {
        const redeemScript = groups.redeemScript.value;
        if (redeemScript.length > 520) {
          throw new Error('Redeem script must be <= 520 bytes');
        }
        let pushOpcode;
        if (redeemScript.length < 0x4c) {
          pushOpcode = new Uint8Array([redeemScript.length]);
        } else if (redeemScript.length <= 0xff) {
          pushOpcode = new Uint8Array([0x4c, redeemScript.length]); // OP_PUSHDATA1
        } else {
          pushOpcode = new Uint8Array([0x4d, redeemScript.length & 0xff, redeemScript.length >> 8]); // OP_PUSHDATA2
        }
        vin.scriptsig = (vin.scriptsig || '') + uint8ArrayToHexString(pushOpcode) + uint8ArrayToHexString(redeemScript);
        vin.scriptsig_asm = convertScriptSigAsm(vin.scriptsig);
        vin.inner_redeemscript_asm = vin.scriptsig_asm.split(' ').reverse()[0];
      }
      if (groups.witnessScript && !finalizedWitness) {
        vin.witness = (vin.witness || []).concat(uint8ArrayToHexString(groups.witnessScript.value));
        vin.inner_witnessscript_asm = convertScriptSigAsm(vin.witness[vin.witness.length - 1]);
      }

      // Fill partial signatures
      for (const record of groups.partialSigs) {
        const signature = record.value;
        const scriptpubkey_type = vin.prevout?.scriptpubkey_type;
        if (scriptpubkey_type === 'multisig' && !finalizedScriptSig) {
          if (signature.length > 74) {
            throw new Error('Signature must be <= 74 bytes');
          }
          const pushOpcode = new Uint8Array([signature.length]);
          vin.scriptsig = uint8ArrayToHexString(pushOpcode) + uint8ArrayToHexString(signature) + (vin.scriptsig || '');
          vin.scriptsig_asm = convertScriptSigAsm(vin.scriptsig);
        }
        if (scriptpubkey_type === 'p2sh') {
          const redeemScriptStr = vin.scriptsig_asm ? vin.scriptsig_asm.split(' ').reverse()[0] : '';
          if (redeemScriptStr.startsWith('00') && redeemScriptStr.length === 68 && vin.witness?.length) {
            if (!finalizedWitness) {
              vin.witness.unshift(uint8ArrayToHexString(signature));
            }
          } else {
            if (!finalizedScriptSig) {
              if (signature.length > 74) {
                throw new Error('Signature must be <= 74 bytes');
              }
              const pushOpcode = new Uint8Array([signature.length]);
              vin.scriptsig = uint8ArrayToHexString(pushOpcode) + uint8ArrayToHexString(signature) + (vin.scriptsig || '');
              vin.scriptsig_asm = convertScriptSigAsm(vin.scriptsig);
            }
          }
        }
        if (scriptpubkey_type === 'v0_p2wsh' && !finalizedWitness) {
          vin.witness = vin.witness || [];
          vin.witness.unshift(uint8ArrayToHexString(signature));
        }
      }

      if (groups.tapLeafScripts.length && groups.tapInternalKey && !finalizedWitness) {
        // If no signature is present, assume key spend *except* if internal key is provably unspendable
        if (!groups.tapScriptSigs.length) {
          if (isInternalKeyNUMS(uint8ArrayToHexString(groups.tapInternalKey.value))) {
            // unspendable internal key, use the first tap leaf script provided
            const record = groups.tapLeafScripts[0];
            const controlBlock = uint8ArrayToHexString(record.keyData);
            const tapLeaf = uint8ArrayToHexString(record.value.slice(0, -1));
            vin.witness = vin.witness || [];
            vin.witness.unshift(tapLeaf, controlBlock);
            vin.inner_witnessscript_asm = convertScriptSigAsm(tapLeaf);
          }
        } else {
          // get the hash with the most signatures
          const leafScriptSignatures: { [leafHash: string]: number } = {};
          let maxSignatures = 0;
          let scriptMostSigs = '';

          for (const record of groups.tapScriptSigs) {
            const leafHash = uint8ArrayToHexString(record.keyData.slice(32));
            if (!leafScriptSignatures[leafHash]) {
              leafScriptSignatures[leafHash] = 0;
            }
            leafScriptSignatures[leafHash]++;
            if (leafScriptSignatures[leafHash] > maxSignatures) {
              maxSignatures = leafScriptSignatures[leafHash];
              scriptMostSigs = leafHash;
            }
          }

          // find the script with most signatures
          for (const record of groups.tapLeafScripts) {
            const leafVersion = uint8ArrayToHexString(record.value.slice(-1));
            const script = uint8ArrayToHexString(record.value.slice(0, -1));
            const scriptSize = uint8ArrayToHexString(compactSize(record.value.length - 1));
            if (taggedHash('TapLeaf', leafVersion + scriptSize + script) === scriptMostSigs) {
              // add the script
              const controlBlock = uint8ArrayToHexString(record.keyData);
              const tapLeaf = uint8ArrayToHexString(record.value.slice(0, -1));
              vin.witness = vin.witness || [];
              vin.witness.unshift(tapLeaf, controlBlock);
              vin.inner_witnessscript_asm = convertScriptSigAsm(tapLeaf);
              // add the signatures that are part of this script
              for (const sigRecord of groups.tapScriptSigs) {
                const sigLeafHash = uint8ArrayToHexString(sigRecord.keyData.slice(32));
                if (sigLeafHash === scriptMostSigs) {
                  vin.witness.unshift(uint8ArrayToHexString(sigRecord.value));
                }
              }
              break;
            }
          }
        }
      }
    }
  }

  // Calculate final size, weight, and txid
  const hasWitness = tx.vin.some(vin => vin.witness?.length);
  let witnessSize = 0;
  if (hasWitness) {
    for (let i = 0; i < tx.vin.length; ++i) {
      const witnessItems = tx.vin[i].witness || [];
      witnessSize += getVarIntLength(witnessItems.length);
      for (const item of witnessItems) {
        const witnessItem = hexStringToUint8Array(item);
        witnessSize += getVarIntLength(witnessItem.length);
        witnessSize += witnessItem.length;
      }
    }
    witnessSize += 2;
  }

  const rawHex = serializeTransaction(tx, hasWitness);
  tx.size = rawHex.length;
  tx.weight = (tx.size - witnessSize) * 3 + tx.size;
  tx.txid = txid(tx);

  return { tx, hex: uint8ArrayToHexString(rawHex) };
}

export type PsbtKeyValue = { keyData: Uint8Array; value: Uint8Array; };
export type PsbtKeyValueMap = Map<number, PsbtKeyValue[]>;

export const PSBT_IN = {
  NON_WITNESS_UTXO: 0x00,
  WITNESS_UTXO: 0x01,
  PARTIAL_SIG: 0x02,
  REDEEM_SCRIPT: 0x04,
  WITNESS_SCRIPT: 0x05,
  BIP32_DERIVATION: 0x06,
  FINAL_SCRIPTSIG: 0x07,
  FINAL_SCRIPTWITNESS: 0x08,
  TAP_SCRIPT_SIG: 0x14,
  TAP_LEAF_SCRIPT: 0x15,
  TAP_INTERNAL_KEY: 0x17,
};

const PSBT_OUT = {
  TAP_INTERNAL_KEY: 0x05,
  TAP_TREE: 0x06,
};

/**
 * Decodes a PSBT buffer into the unsigned raw transaction and input/output maps
 * @param psbtBuffer
 * @returns
 *   - the unsigned transaction from a PSBT
 *   - the full input map for each input
 *   - the full output map for each output
 */
function decodePsbt(psbtBuffer: Uint8Array): { rawTx: Uint8Array; inputs: PsbtKeyValueMap[]; outputs: PsbtKeyValueMap[]; } {
  let offset = 0;

  // magic: "psbt" in ASCII
  const expectedMagic = [0x70, 0x73, 0x62, 0x74];
  for (let i = 0; i < expectedMagic.length; i++) {
    if (psbtBuffer[offset + i] !== expectedMagic[i]) {
      throw new Error('Invalid PSBT magic bytes');
    }
  }
  offset += expectedMagic.length;

  const separator = psbtBuffer[offset];
  offset += 1;
  if (separator !== 0xff) {
    throw new Error('Invalid PSBT separator');
  }

  // GLOBAL MAP
  let rawTx: Uint8Array | null = null;
  while (offset < psbtBuffer.length) {
    const [keyLen, newOffset] = readVarInt(psbtBuffer, offset);
    offset = newOffset;
    // key length of 0 means the end of the global map
    if (keyLen === 0) {
      break;
    }
    const key = psbtBuffer.slice(offset, offset + keyLen);
    offset += keyLen;
    const [valLen, newOffset2] = readVarInt(psbtBuffer, offset);
    offset = newOffset2;
    const value = psbtBuffer.slice(offset, offset + valLen);
    offset += valLen;

    // Global key type 0x00 holds the unsigned transaction.
    if (key[0] === 0x00) {
      rawTx = value;
    }
  }

  if (!rawTx) {
    throw new Error('Unsigned transaction not found in PSBT');
  }

  const readMaps = (count: number, startOffset: number): { map: PsbtKeyValueMap[]; offset: number } => {
    const map: PsbtKeyValueMap[] = [];
    let offset = startOffset;

    for (let i = 0; i < count; i++) {
      const records: PsbtKeyValueMap = new Map();
    const seenKeys = new Set<string>();
    while (offset < psbtBuffer.length) {
      const [keyLen, newOffset] = readVarInt(psbtBuffer, offset);
      offset = newOffset;
      if (keyLen === 0) {
        break;
      }
      const key = psbtBuffer.slice(offset, offset + keyLen);
      offset += keyLen;

      const keyHex = uint8ArrayToHexString(key);
      if (seenKeys.has(keyHex)) {
          throw new Error('Duplicate key in map');
      }
      seenKeys.add(keyHex);

      const [valLen, newOffset2] = readVarInt(psbtBuffer, offset);
      offset = newOffset2;
      const value = psbtBuffer.slice(offset, offset + valLen);
      offset += valLen;

        const [keyType, keyDataOffset] = readVarInt(key, 0);
        const bucket = records.get(keyType) || [];
        bucket.push({ keyData: key.slice(keyDataOffset), value });
        records.set(keyType, bucket);
      }
      map.push(records);
  }

    return { map, offset };
  };

  let numInputs: number;
  let numOutputs: number;
  let txOffset = 0;
  // Skip version (4 bytes)
  txOffset += 4;
  const [inputCount, newTxOffset] = readVarInt(rawTx, txOffset);
  txOffset = newTxOffset;
  numInputs = inputCount;
  for (let i = 0; i < numInputs; i++) {
    txOffset += 32; // prev txid
    txOffset += 4; // vout
    const [scriptLength, scriptOffset] = readVarInt(rawTx, txOffset);
    txOffset = scriptOffset;
    txOffset += scriptLength;
    txOffset += 4; // sequence
  }
  const [outputCount, _] = readVarInt(rawTx, txOffset);
  numOutputs = outputCount;

  // INPUT MAPS
  const inputMaps = readMaps(numInputs, offset);
  offset = inputMaps.offset;
  const inputs = inputMaps.map;

  // OUTPUT MAPS
  const outputMaps = readMaps(numOutputs, offset);
  const outputs = outputMaps.map;

  return { rawTx, inputs, outputs };
}

/**
 * Encodes an unsigned transaction and input/output data into a PSBT buffer
 * @param rawTx - The unsigned transaction as Uint8Array
 * @param inputs - Array of input maps containing key-value pairs for each input
 * @param outputs - Array of output maps containing key-value pairs for each output
 * @returns PSBT buffer as Uint8Array
 */
export function encodePsbt(rawTx: Uint8Array, inputs: PsbtKeyValueMap[], outputs: PsbtKeyValueMap[]): Uint8Array {
  const result: number[] = [];

  // Magic bytes: "psbt" in ASCII
  result.push(0x70, 0x73, 0x62, 0x74);

  // Separator
  result.push(0xff);

  const writeKeyValue = (keyType: number, keyData: Uint8Array, value: Uint8Array): void => {
    const keyTypeBytes = varIntToBytes(keyType);
    const keyLength = keyTypeBytes.length + keyData.length;
    result.push(...varIntToBytes(keyLength));
    result.push(...keyTypeBytes);
    result.push(...keyData);
    result.push(...varIntToBytes(value.length));
    result.push(...value);
  };

  const writeMap = (records: PsbtKeyValueMap): void => {
    for (const [keyType, items] of records) {
      for (const record of items) {
        writeKeyValue(keyType, record.keyData, record.value);
      }
    }
    result.push(0x00);
  };

  // GLOBAL MAP
  // Add unsigned transaction (key type 0x00)
  writeKeyValue(0x00, new Uint8Array(), rawTx);

  // End global map
  result.push(0x00);

  // INPUT MAPS
  for (const inputMap of inputs) {
    writeMap(inputMap);
  }

  // OUTPUT MAPS
  for (const outputMap of outputs) {
    writeMap(outputMap);
  }

  return new Uint8Array(result);
}

export function decodeRawTransaction(input: string, network: string): { tx: Transaction, hex: string, psbt?: string } {
  const buffer = convertTextToBuffer(input);

  if (buffer[0] === 0x70 && buffer[1] === 0x73 && buffer[2] === 0x62 && buffer[3] === 0x74) { // PSBT magic bytes
    const { rawTx, inputs } = decodePsbt(buffer);
    return { ...fromBuffer(rawTx, network, inputs), psbt: uint8ArrayToHexString(buffer) };
  }

  return fromBuffer(buffer, network);
}

export function serializeTransaction(tx: Transaction, includeWitness: boolean = true): Uint8Array {
  const result: number[] = [];

  // Add version
  result.push(...intToBytes(tx.version, 4));

  if (includeWitness) {
    // Add SegWit marker and flag bytes (0x00, 0x01)
    result.push(0x00, 0x01);
  }

  // Add input count and inputs
  result.push(...varIntToBytes(tx.vin.length));
  for (const input of tx.vin) {
    result.push(...hexStringToUint8Array(input.txid).reverse());
    result.push(...intToBytes(input.vout, 4));
    const scriptSig = hexStringToUint8Array(input.scriptsig);
    result.push(...varIntToBytes(scriptSig.length));
    result.push(...scriptSig);
    result.push(...intToBytes(input.sequence, 4));
  }

  // Add output count and outputs
  result.push(...varIntToBytes(tx.vout.length));
  for (const output of tx.vout) {
    result.push(...bigIntToBytes(BigInt(output.value), 8));
    const scriptPubKey = hexStringToUint8Array(output.scriptpubkey);
    result.push(...varIntToBytes(scriptPubKey.length));
    result.push(...scriptPubKey);
  }

  if (includeWitness) {
    for (const input of tx.vin) {
      const witnessItems = input.witness || [];
      result.push(...varIntToBytes(witnessItems.length));
      for (const item of witnessItems) {
        const witnessBytes = hexStringToUint8Array(item);
        result.push(...varIntToBytes(witnessBytes.length));
        result.push(...witnessBytes);
      }
    }
  }

  // Add locktime
  result.push(...intToBytes(tx.locktime, 4));

  return new Uint8Array(result);
}

function txid(tx: Transaction): string {
  const serializedTx = serializeTransaction(tx, false);
  const hash1 = new Hash().update(serializedTx).digest();
  const hash2 = new Hash().update(hash1).digest();
  return uint8ArrayToHexString(hash2.reverse());
}

export function scriptPubKeyToAddress(scriptPubKey: string, network: string): { address: string, type: string } {
  // P2PKH
  if (/^76a914[0-9a-f]{40}88ac$/.test(scriptPubKey)) {
    return { address: p2pkh(scriptPubKey.substring(6, 6 + 40), network), type: 'p2pkh' };
  }
  // P2PK
  if (/^21[0-9a-f]{66}ac$/.test(scriptPubKey) || /^41[0-9a-f]{130}ac$/.test(scriptPubKey)) {
    return { address: null, type: 'p2pk' };
  }
  // P2SH
  if (/^a914[0-9a-f]{40}87$/.test(scriptPubKey)) {
    return { address: p2sh(scriptPubKey.substring(4, 4 + 40), network), type: 'p2sh' };
  }
  // P2WPKH
  if (/^0014[0-9a-f]{40}$/.test(scriptPubKey)) {
    return { address: p2wpkh(scriptPubKey.substring(4, 4 + 40), network), type: 'v0_p2wpkh' };
  }
  // P2WSH
  if (/^0020[0-9a-f]{64}$/.test(scriptPubKey)) {
    return { address: p2wsh(scriptPubKey.substring(4, 4 + 64), network), type: 'v0_p2wsh' };
  }
  // P2TR
  if (/^5120[0-9a-f]{64}$/.test(scriptPubKey)) {
    return { address: p2tr(scriptPubKey.substring(4, 4 + 64), network), type: 'v1_p2tr' };
  }
  // multisig
  if (/^[0-9a-f]+ae$/.test(scriptPubKey)) {
    return { address: null, type: 'multisig' };
  }
  // anchor
  if (scriptPubKey === '51024e73') {
    return { address: p2a(network), type: 'anchor' };
  }
  // op_return
  if (/^6a/.test(scriptPubKey)) {
    return { address: null, type: 'op_return' };
  }
  return { address: null, type: 'unknown' };
}

export function addressToScriptPubKey(address: string, network: string): { scriptPubKey: string | null, type: AddressType } {
  const type = detectAddressType(address, network);

  if (type === 'p2pk') {
    if (address.length === 66) {
      return { scriptPubKey: '21' + address + 'ac', type };
    }
    if (address.length === 130) {
      return { scriptPubKey: '41' + address + 'ac', type };
    }
    return { scriptPubKey: null, type };
  }

  if (type === 'p2pkh' || type === 'p2sh') {
    return { scriptPubKey: base58ToSpk(address, network), type };
  }

  if (type === 'v0_p2wpkh' || type === 'v0_p2wsh' || type === 'v1_p2tr' || address === p2a(network)) {
    return { scriptPubKey: bech32ToSpk(address, network), type };
  }

  return { scriptPubKey: null, type };
}

function p2pkh(pubKeyHash: string, network: string): string {
  const pubkeyHashArray = hexStringToUint8Array(pubKeyHash);
  const version = ['testnet', 'testnet4', 'signet'].includes(network) ? 0x6f : 0x00;
  const versionedPayload = Uint8Array.from([version, ...pubkeyHashArray]);
  const hash1 = new Hash().update(versionedPayload).digest();
  const hash2 = new Hash().update(hash1).digest();
  const checksum = hash2.slice(0, 4);
  const finalPayload = Uint8Array.from([...versionedPayload, ...checksum]);
  const bitcoinAddress = base58Encode(finalPayload);
  return bitcoinAddress;
}

function p2sh(scriptHash: string, network: string): string {
  const scriptHashArray = hexStringToUint8Array(scriptHash);
  const version = ['testnet', 'testnet4', 'signet'].includes(network) ? 0xc4 : 0x05;
  const versionedPayload = Uint8Array.from([version, ...scriptHashArray]);
  const hash1 = new Hash().update(versionedPayload).digest();
  const hash2 = new Hash().update(hash1).digest();
  const checksum = hash2.slice(0, 4);
  const finalPayload = Uint8Array.from([...versionedPayload, ...checksum]);
  const bitcoinAddress = base58Encode(finalPayload);
  return bitcoinAddress;
}

function p2wpkh(pubKeyHash: string, network: string): string {
  const pubkeyHashArray = hexStringToUint8Array(pubKeyHash);
  const hrp = ['testnet', 'testnet4', 'signet'].includes(network) ? 'tb' : 'bc';
  const version = 0;
  const words = [version].concat(toWords(pubkeyHashArray));
  const bech32Address = bech32Encode(hrp, words);
  return bech32Address;
}

function p2wsh(scriptHash: string, network: string): string {
  const scriptHashArray = hexStringToUint8Array(scriptHash);
  const hrp = ['testnet', 'testnet4', 'signet'].includes(network) ? 'tb' : 'bc';
  const version = 0;
  const words = [version].concat(toWords(scriptHashArray));
  const bech32Address = bech32Encode(hrp, words);
  return bech32Address;
}

function p2tr(pubKey: string, network: string): string {
  const pubkeyArray = hexStringToUint8Array(pubKey);
  const hrp = ['testnet', 'testnet4', 'signet'].includes(network) ? 'tb' : 'bc';
  const version = 1;
  const words = [version].concat(toWords(pubkeyArray));
  const bech32Address = bech32Encode(hrp, words, 'bech32m');
  return bech32Address;
}

function p2a(network: string): string {
  const pubkeyHashArray = hexStringToUint8Array('4e73');
  const hrp = ['testnet', 'testnet4', 'signet'].includes(network) ? 'tb' : 'bc';
  const version = 1;
  const words = [version].concat(toWords(pubkeyHashArray));
  const bech32Address = bech32Encode(hrp, words, 'bech32m');
  return bech32Address;
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// base58 encoding
function base58Encode(data: Uint8Array): string {
  const hexString = Array.from(data)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');

  let num = BigInt('0x' + hexString);

  let encoded = '';
  while (num > 0) {
    const remainder = Number(num % 58n);
    num = num / 58n;
    encoded = BASE58_ALPHABET[remainder] + encoded;
  }

  for (const byte of data) {
    if (byte === 0) {
      encoded = '1' + encoded;
    } else {
      break;
    }
  }

  return encoded;
}

// base58 decoding
function base58Decode(s: string): Uint8Array {
  let num = BigInt(0);
  const base = BigInt(58);

  for (let i = 0; i < s.length; i++) {
    const char = s[i];
    const index = BASE58_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error('Invalid base58 character');
    }
    num = num * base + BigInt(index);
  }

  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;

  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }

  for (let i = 0; i < s.length && s[i] === '1'; i++) {
    bytes.unshift(0);
  }

  return new Uint8Array(bytes);
}

function base58ToSpk(address: string, network: string): string | null {
  try {
    const decoded = base58Decode(address);
    if (decoded.length !== 25) {
      return null;
    }

    const version = decoded[0];
    const payload = decoded.slice(1, 21);
    const checksum = decoded.slice(21, 25);

    // Verify checksum
    const versionedPayload = new Uint8Array([version, ...payload]);
    const hash1 = new Hash().update(versionedPayload).digest();
    const hash2 = new Hash().update(hash1).digest();
    const expectedChecksum = hash2.slice(0, 4);
    if (checksum.length !== expectedChecksum.length) {
      return null;
    }
    for (let i = 0; i < checksum.length; i++) {
      if (checksum[i] !== expectedChecksum[i]) {
        return null;
      }
    }

    const payloadHex = uint8ArrayToHexString(payload);

    // P2PKH
    const p2pkhVersion = ['testnet', 'testnet4', 'signet'].includes(network) ? 0x6f : 0x00;
    if (version === p2pkhVersion) {
      return '76a914' + payloadHex + '88ac';
    }

    // P2SH
    const p2shVersion = ['testnet', 'testnet4', 'signet'].includes(network) ? 0xc4 : 0x05;
    if (version === p2shVersion) {
      return 'a914' + payloadHex + '87';
    }

  } catch (e) {
    // Invalid base58
  }
  return null;
}

// bech32 encoding / decoding
// Adapted from https://github.com/bitcoinjs/bech32/blob/5ceb0e3d4625561a459c85643ca6947739b2d83c/src/index.ts
const BECH32_ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
type Bech32Encoding = 'bech32' | 'bech32m';

function bech32Encode(prefix: string, words: number[], encoding: Bech32Encoding = 'bech32'): string {
  const constant = encoding === 'bech32m' ? 0x2bc830a3 : 1;
  const checksum = createChecksum(prefix, words, constant);
  const combined = words.concat(checksum);
  let result = prefix + '1';
  for (let i = 0; i < combined.length; ++i) {
    result += BECH32_ALPHABET.charAt(combined[i]);
  }
  return result;
}

/* Decodes a *valid* bech32 or bech32m encoded address into its prefix and payload */
function bech32Decode(address: string): { prefix: string, words: number[], encoding: Bech32Encoding } {
  const normalized = address.toLowerCase();
  const separator = normalized.lastIndexOf('1');
  const prefix = normalized.slice(0, separator);
  const encodedWords = normalized.slice(separator + 1);
  const words: number[] = [];
  for (let i = 0; i < encodedWords.length; i++) {
    words.push(BECH32_ALPHABET.indexOf(encodedWords.charAt(i)));
  }

  const polymod = bech32Polymod(prefix, words);
  let encoding: Bech32Encoding;
  if (polymod === 1) {
    encoding = 'bech32';
  } else if (polymod === 0x2bc830a3) {
    encoding = 'bech32m';
  } else {
    throw new Error('Invalid bech32 checksum');
  }

  return { prefix, words: words.slice(0, -6), encoding };
}

function bech32ToSpk(address: string, network: string): string | null {
  const expectedHrp = ['testnet', 'testnet4', 'signet'].includes(network) ? 'tb' : 'bc';
  try {
    const decoded = bech32Decode(address);
    if (decoded.prefix !== expectedHrp) {
      return null;
    }
    const version = decoded.words[0];
    const data = fromWords(decoded.words.slice(1));
    const versionOpcode = version === 0 ? '00' : (version + 0x50).toString(16).padStart(2, '0');
    const pushLen = data.length.toString(16).padStart(2, '0');
    return versionOpcode + pushLen + uint8ArrayToHexString(data);
  } catch (e) {
    // Invalid bech32 address
  }
  return null;
}

function bech32Polymod(prefix: string, words: number[]): number {
  let chk = prefixChk(prefix);
  for (let i = 0; i < words.length; ++i) {
    chk = polymodStep(chk) ^ words[i];
  }
  return chk;
}

function polymodStep(pre) {
  const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  const b = pre >> 25;
  return (
    ((pre & 0x1ffffff) << 5) ^
    ((b & 1 ? GENERATORS[0] : 0) ^
      (b & 2 ? GENERATORS[1] : 0) ^
      (b & 4 ? GENERATORS[2] : 0) ^
      (b & 8 ? GENERATORS[3] : 0) ^
      (b & 16 ? GENERATORS[4] : 0))
  );
}

function prefixChk(prefix) {
  let chk = 1;
  for (let i = 0; i < prefix.length; ++i) {
    const c = prefix.charCodeAt(i);
    chk = polymodStep(chk) ^ (c >> 5);
  }
  chk = polymodStep(chk);
  for (let i = 0; i < prefix.length; ++i) {
    const c = prefix.charCodeAt(i);
    chk = polymodStep(chk) ^ (c & 0x1f);
  }
  return chk;
}

function createChecksum(prefix: string, words: number[], constant: number) {
  const POLYMOD_CONST = constant;
  let chk = prefixChk(prefix);
  for (let i = 0; i < words.length; ++i) {
    const x = words[i];
    chk = polymodStep(chk) ^ x;
  }
  for (let i = 0; i < 6; ++i) {
    chk = polymodStep(chk);
  }
  chk ^= POLYMOD_CONST;

  const checksum = [];
  for (let i = 0; i < 6; ++i) {
    checksum.push((chk >> (5 * (5 - i))) & 31);
  }
  return checksum;
}

function convertBits(data, fromBits, toBits, pad) {
  let acc = 0;
  let bits = 0;
  const ret = [];
  const maxV = (1 << toBits) - 1;

  for (let i = 0; i < data.length; ++i) {
    const value = data[i];
    if (value < 0 || value >> fromBits) {throw new Error('Invalid value');}
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxV);
    }
  }
  if (pad) {
    if (bits > 0) {
      ret.push((acc << (toBits - bits)) & maxV);
    }
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxV)) {
    throw new Error('Invalid data');
  }
  return ret;
}

function toWords(bytes) {
  return convertBits(bytes, 8, 5, true);
}

function fromWords(words: number[]) {
  return new Uint8Array(convertBits(words, 5, 8, false));
}

export function hexStringToUint8Array(hex: string): Uint8Array {
  const buf = new Uint8Array(hex.length / 2);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return buf;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  return new Uint8Array([...binaryString].map(char => char.charCodeAt(0)));
}

export function uint8ArrayToBase64(uint8Array: Uint8Array): string {
  let binaryString = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binaryString += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binaryString);
}

function intToBytes(value: number, byteLength: number): number[] {
  const bytes = [];
  for (let i = 0; i < byteLength; i++) {
    bytes.push((value >> (8 * i)) & 0xff);
  }
  return bytes;
}

export function bigIntToBytes(value: bigint, byteLength: number): number[] {
  const bytes = [];
  for (let i = 0; i < byteLength; i++) {
    bytes.push(Number((value >> BigInt(8 * i)) & 0xffn));
  }
  return bytes;
}

export function varIntToBytes(value: number | bigint): number[] {
  const bytes = [];

  if (typeof value === 'number') {
    if (value < 0xfd) {
      bytes.push(value);
    } else if (value <= 0xffff) {
      bytes.push(0xfd, value & 0xff, (value >> 8) & 0xff);
    } else if (value <= 0xffffffff) {
      bytes.push(0xfe, ...intToBytes(value, 4));
    }
  } else {
    if (value < 0xfdn) {
      bytes.push(Number(value));
    } else if (value <= 0xffffn) {
      bytes.push(0xfd, Number(value & 0xffn), Number((value >> 8n) & 0xffn));
    } else if (value <= 0xffffffffn) {
      bytes.push(0xfe, ...intToBytes(Number(value), 4));
    } else {
      bytes.push(0xff, ...bigIntToBytes(value, 8));
    }
  }

  return bytes;
}

function readInt8(buffer: Uint8Array, offset: number): [number, number] {
  if (offset + 1 > buffer.length) {
    throw new Error('Buffer out of bounds');
  }
  return [buffer[offset], offset + 1];
}

function readInt16(buffer: Uint8Array, offset: number): [number, number] {
  if (offset + 2 > buffer.length) {
    throw new Error('Buffer out of bounds');
  }
  return [buffer[offset] | (buffer[offset + 1] << 8), offset + 2];
}

function readInt32(buffer: Uint8Array, offset: number, unsigned: boolean = false): [number, number] {
  if (offset + 4 > buffer.length) {
    throw new Error('Buffer out of bounds');
  }
  const value = buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16) | (buffer[offset + 3] << 24);
  return [unsigned ? value >>> 0 : value, offset + 4];
}

function readInt64(buffer: Uint8Array, offset: number): [bigint, number] {
  if (offset + 8 > buffer.length) {
    throw new Error('Buffer out of bounds');
  }
  const low = BigInt(buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16) | (buffer[offset + 3] << 24));
  const high = BigInt(buffer[offset + 4] | (buffer[offset + 5] << 8) | (buffer[offset + 6] << 16) | (buffer[offset + 7] << 24));
  return [(high << 32n) | (low & 0xffffffffn), offset + 8];
}

function readVarInt(buffer: Uint8Array, offset: number): [number, number] {
  const [first, newOffset] = readInt8(buffer, offset);

  if (first < 0xfd) {
    return [first, newOffset];
  } else if (first === 0xfd) {
    return readInt16(buffer, newOffset);
  } else if (first === 0xfe) {
    return readInt32(buffer, newOffset, true);
  } else if (first === 0xff) {
    const [bigValue, nextOffset] = readInt64(buffer, newOffset);

    if (bigValue > Number.MAX_SAFE_INTEGER) {
      throw new Error('VarInt exceeds safe integer range');
    }

    const numValue = Number(bigValue);
    return [numValue, nextOffset];
  } else {
    throw new Error('Invalid VarInt prefix');
  }
}

function readSlice(buffer: Uint8Array, offset: number, n: number | bigint): [Uint8Array, number] {
  const length = Number(n);
  if (offset + length > buffer.length) {
    throw new Error('Cannot read slice out of bounds');
  }
  const slice = buffer.slice(offset, offset + length);
  return [slice, offset + length];
}

function readVarSlice(buffer: Uint8Array, offset: number): [Uint8Array, number] {
  const [length, newOffset] = readVarInt(buffer, offset);
  return readSlice(buffer, newOffset, length);
}

function readVector(buffer: Uint8Array, offset: number): [Uint8Array[], number] {
  const [count, newOffset] = readVarInt(buffer, offset);
  let updatedOffset = newOffset;
  const vector: Uint8Array[] = [];

  for (let i = 0; i < count; i++) {
    const [slice, nextOffset] = readVarSlice(buffer, updatedOffset);
    vector.push(slice);
    updatedOffset = nextOffset;
  }

  return [vector, updatedOffset];
}

// SHA256(SHA256(tag) || SHA256(tag) || dataHex)
export function taggedHash(tag: string, dataHex: string): string {
  const encoder = new TextEncoder();
  const tagHash = hash(encoder.encode(tag));
  return uint8ArrayToHexString(hash(new Uint8Array([...tagHash, ...tagHash, ...hexStringToUint8Array(dataHex)])));
}

export function compactSize(n: number): Uint8Array {
  if (n <= 252) {
    return new Uint8Array([n]);
  } else if (n <= 0xffff) {
    return new Uint8Array([0xfd, n & 0xff, (n >> 8) & 0xff]);
  } else if (n <= 0xffffffff) {
    return new Uint8Array([0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);
  } else {
    const buffer = new Uint8Array(9);
    buffer[0] = 0xff;
    let num = BigInt(n);
    for (let i = 1; i <= 8; i++) {
      buffer[i] = Number(num & BigInt(0xff));
      num >>= BigInt(8);
    }
    return buffer;
  }
}

export function convertTextToBuffer(input: string): Uint8Array {
  if (!input.length) {
    throw new Error('Empty input');
  }

  let buffer: Uint8Array;
  if (input.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(input)) {
    buffer = hexStringToUint8Array(input);
  } else if (/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)|[A-Za-z0-9+/]{3}=)?$/.test(input)) {
    buffer = base64ToUint8Array(input);
  } else {
    throw new Error('Invalid input: not hex or base64');
  }
  return buffer;
}

export function computeLeafHash(scriptHex: string, leafVersion: number): string {
  const versionHex = leafVersion.toString(16).padStart(2, '0');
  const scriptSizeHex = uint8ArrayToHexString(compactSize(scriptHex.length / 2));
  return taggedHash('TapLeaf', versionHex + scriptSizeHex + scriptHex);
}

export interface TapLeaf {
  leafVersion: number;
  scriptHex: string;
  merkleBranches: string[];
  internalKey?: string;
}

/** Decode a PSBT_IN_TAP_LEAF_SCRIPT into a tapleaf */
export function parseTapLeafRecord(record: PsbtKeyValue): TapLeaf {
  const controlBlock = record.keyData;
  const valueLength = record.value.length;
  const leafVersion = record.value[valueLength - 1];
  const scriptHex = uint8ArrayToHexString(record.value.slice(0, valueLength - 1));
  const internalKey = uint8ArrayToHexString(controlBlock.slice(1, 33));
  const merkleBranches: string[] = [];
  for (let offset = 33; offset < controlBlock.length; offset += 32) {
    merkleBranches.push(uint8ArrayToHexString(controlBlock.slice(offset, offset + 32)));
  }
  return { leafVersion, scriptHex, merkleBranches, internalKey };
}

/** Decode a PSBT_OUT_TAP_TREE into its leaves */
export function parseTapTreeRecord(value: Uint8Array): TapLeaf[] {
  const leaves: TapLeaf[] = [];
  const stack: { depth: number; hash: string; leaves: TapLeaf[] }[] = [];
  let offset = 0;

  while (offset < value.length) {
    const depth = value[offset++];
    const leafVersion = value[offset++];
    const [scriptLength, scriptOffset] = readVarInt(value, offset);
    offset = scriptOffset;
    const [scriptBytes, nextOffset] = readSlice(value, offset, scriptLength);
    offset = nextOffset;
    const scriptHex = uint8ArrayToHexString(scriptBytes);
    const leaf: TapLeaf = {
      leafVersion,
      scriptHex,
      merkleBranches: [],
    };
    leaves.push(leaf);
    stack.push({ depth, hash: computeLeafHash(scriptHex, leafVersion), leaves: [leaf] });

    while (stack.length >= 2 && stack[stack.length - 1].depth === stack[stack.length - 2].depth) {
      const right = stack.pop();
      const left = stack.pop();
      for (const l of left.leaves) {
        l.merkleBranches.push(right.hash);
      }
      for (const r of right.leaves) {
        r.merkleBranches.push(left.hash);
      }
      const firstChild = left.hash < right.hash ? left.hash : right.hash;
      const secondChild = firstChild === left.hash ? right.hash : left.hash;
      stack.push({ depth: left.depth - 1, hash: taggedHash('TapBranch', firstChild + secondChild), leaves: left.leaves.concat(right.leaves) });
    }
  }

  return leaves;
}

/**
 * Extract taproot leaves from a PSBT, tapleaves, and/or taptree
 * At least one of the inputs (`psbt`, `tapleaves`, or `tapTree`) must be provided
 *
 * @param psbt Raw PSBT
 * @param tapleaves Array of PSBT_IN_TAP_LEAF_SCRIPT's keyData/value fields
 * @param tapTree PSBT_OUT_TAP_TREE value field
 * @param internalKey Optional x-only internal key
 * @throws {Error} If no tapleaves are found or extraction fails
 */
export function extractTapLeaves(psbt: Uint8Array, tapleaves: PsbtKeyValue[], tapTree: Uint8Array, internalKey: Uint8Array): TapLeaf[] {
  const leaves: TapLeaf[] = [];
  const seenLeaves = new Set<string>();

  let providedInternalKey: string | undefined;
  const getProvidedInternalKey = (): string | undefined => {
    if (providedInternalKey !== undefined) {
      return providedInternalKey;
    }
    providedInternalKey = internalKey ? uint8ArrayToHexString(internalKey) : undefined;
    return providedInternalKey;
  };

  const addLeaf = (leaf: TapLeaf): void => {
    const key = `${leaf.leafVersion}${leaf.merkleBranches.join('')}${leaf.scriptHex}${leaf.internalKey || ''}`;
    if (seenLeaves.has(key)) {
      return;
    }
    seenLeaves.add(key);
    leaves.push(leaf);
  };

  try {
    if (psbt) {
      const decoded = decodePsbt(psbt);
      for (const input of decoded.inputs) {
        for (const record of input.get(PSBT_IN.TAP_LEAF_SCRIPT) || []) {
          addLeaf(parseTapLeafRecord(record));
        }
      }

      for (const output of decoded.outputs) {
        const tapInternalKeyRecord = output.get(PSBT_OUT.TAP_INTERNAL_KEY)?.[0];
        const tapTreeRecord = output.get(PSBT_OUT.TAP_TREE)?.[0];
        if (tapTreeRecord) {
          // If PSBT_OUT_TAP_INTERNAL_KEY is omitted, fallback to provided ikey
          const internalKey = tapInternalKeyRecord ? uint8ArrayToHexString(tapInternalKeyRecord.value) : getProvidedInternalKey();
          for (const leaf of parseTapTreeRecord(tapTreeRecord.value)) {
            addLeaf({ ...leaf, internalKey });
          }
        }
      }
    }

    for (const tapleaf of tapleaves || []) {
      addLeaf(parseTapLeafRecord(tapleaf));
    }

    if (tapTree) {
      for (const leaf of parseTapTreeRecord(tapTree)) {
        addLeaf({ ...leaf, internalKey: getProvidedInternalKey() });
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to extract taproot leaves');
  }

  if (!leaves.length) {
    throw new Error('No tapleaves found');
  }

  return leaves;
}
