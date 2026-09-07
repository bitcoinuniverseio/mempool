import * as secp256k1 from '@noble/secp256k1';
import { AddressTypeInfo } from './address-utils';
import { ScriptInfo } from './script.utils';
import { computeLeafHash, taggedHash, scriptPubKeyToAddress, ParsedTaproot, TapLeaf, convertScriptSigAsm, isInternalKeyNUMS } from './transaction.utils';

const SECP256K1_ORDER = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');

function computeMerkleRoot(scriptHex: string, leafVersion: number, merkleBranches: string[]): string {
  const leafHash = computeLeafHash(scriptHex, leafVersion);
  return (merkleBranches || []).reduce((acc, branch) => {
    const firstChild = acc < branch ? acc : branch;
    const secondChild = firstChild === acc ? branch : acc;
    return taggedHash('TapBranch', firstChild + secondChild);
  }, leafHash);
}

export function computeTaprootOutputKey(internalKey: string, merkleRoot: string): { outputKey: string; parity: number } {
  const tweakHash = taggedHash('TapTweak', internalKey + merkleRoot); // HashTapTweak(internalKey || m)
  const tweak = BigInt('0x' + tweakHash) % SECP256K1_ORDER; // int(HashTapTweak(internalKey || m))
  const internalKeyPoint = secp256k1.Point.fromHex(`02${internalKey}`); // P = lift_x(internalKey)
  const outputKeyPoint = internalKeyPoint.add(secp256k1.Point.BASE.multiply(tweak)); // Q = P + int(HashTapTweak(internalKey || m)) * G
  const parity = Number(outputKeyPoint.y & 1n);
  const outputKey = outputKeyPoint.x.toString(16).padStart(64, '0');
  return { outputKey, parity };
}

function deriveTaprootAddress(internalKey: string, merkleRoot: string, network: string): { address: string; parity: number } {
  const { outputKey, parity } = computeTaprootOutputKey(internalKey, merkleRoot);
  return { address: scriptPubKeyToAddress(`5120${outputKey}`, network).address, parity };
}

/** Populate an address' taptree using a PSBT involving the taproot address */
export function fillTapTree(addressTypeInfo: AddressTypeInfo, leaves: TapLeaf[]) {
  if (addressTypeInfo?.type !== 'v1_p2tr') {
    return;
  }

  let commitment: { internalKey: string; merkleRoot: string; parity: number };
  if (addressTypeInfo.scripts.size) {
    const tapInfo: ParsedTaproot = addressTypeInfo.scripts.values().next().value.taprootInfo;
    commitment = {
      internalKey: tapInfo.scriptPath.internalKey,
      merkleRoot: computeMerkleRoot(tapInfo.scriptPath.script, tapInfo.scriptPath.leafVersion, tapInfo.scriptPath.merkleBranches),
      parity: tapInfo.scriptPath.parity,
    };
  }

  // Adds the internal key to the leaf if needed and fills the commitment when the leaf matches the address
  const leafMatchesAddress = (leaf: TapLeaf): leaf is TapLeaf & { internalKey: string } => {
    leaf.internalKey = leaf.internalKey ?? commitment?.internalKey;
    if (!leaf.internalKey) {
      throw new Error('Internal key is needed to validate leaves');
    }

    if (commitment && leaf.internalKey !== commitment.internalKey) {
      return false;
    }

    const resolvedMerkleRoot = computeMerkleRoot(leaf.scriptHex, leaf.leafVersion, leaf.merkleBranches);
    if (commitment) {
      return resolvedMerkleRoot === commitment.merkleRoot;
    }

    const { address, parity } = deriveTaprootAddress(leaf.internalKey, resolvedMerkleRoot, addressTypeInfo.network);
    if (addressTypeInfo.address !== address) {
      return false;
    }

    commitment = {
      internalKey: leaf.internalKey,
      merkleRoot: resolvedMerkleRoot,
      parity,
    };
    return true;
  };

  let addedScript = false;
  try {
    for (const leaf of leaves) {
      if (leafMatchesAddress(leaf)) {
        const controlBlockPrefix = (leaf.leafVersion | commitment.parity).toString(16).padStart(2, '0');
        const controlBlock = controlBlockPrefix + leaf.internalKey + leaf.merkleBranches.join('');
        const taprootInfo: ParsedTaproot = {
          keyPath: false,
          stack: [],
          controlBlock,
          scriptPath: {
            script: leaf.scriptHex,
            leafVersion: leaf.leafVersion,
            parity: commitment.parity,
            internalKey: leaf.internalKey,
            merkleBranches: leaf.merkleBranches.slice(),
            isNUMS: isInternalKeyNUMS(leaf.internalKey),
          },
        };
        const scriptInfo = new ScriptInfo('inner_witnessscript', leaf.scriptHex, convertScriptSigAsm(leaf.scriptHex), undefined, taprootInfo);
        const scriptAdded = addressTypeInfo.processScript(scriptInfo);
        if (scriptAdded) {
          addressTypeInfo.tapscript = true;
          addedScript = true;
        }
      }
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error('An error occurred while filling the taproot tree');
  }

  if (!addedScript) {
    throw new Error('No valid taproot scripts found that match this address, or all provided scripts are already loaded for this address');
  }
}
