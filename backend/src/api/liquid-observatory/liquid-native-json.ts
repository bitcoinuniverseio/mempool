import { LiquidObservatoryEvidenceError as EvidenceError } from './liquid-evidence-error';

/** Keep native monetary tokens exact before JSON.parse can round them to binary64. */
export function parseLiquidRpcJson(text: unknown): any {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 8 * 1024 * 1024) {
    throw new EvidenceError('invalid-liquid-native-json', 'The native Liquid JSON response exceeds its bound or is not raw text.');
  }
  const monetary = new Set(['value', 'assetamount', 'tokenamount']);
  let output = '', index = 0;
  try {
    while (index < text.length) {
      if (text[index] !== '"') { output += text[index++]; continue; }
      const start = index++;
      while (index < text.length) {
        if (text[index] === '\\') { index += 2; continue; }
        if (text[index++] === '"') break;
      }
      const token = text.slice(start, index);
      output += token;
      // Decoding the key also protects valid escaped spellings of monetary keys.
      if (!monetary.has(JSON.parse(token))) continue;
      const number = /^(\s*:\s*)(-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)(?=\s*[,}])/.exec(text.slice(index));
      if (number) { output += number[1] + JSON.stringify(number[2]); index += number[0].length; }
    }
    return JSON.parse(output);
  } catch {
    throw new EvidenceError('invalid-liquid-native-json', 'The native Liquid JSON response is malformed.');
  }
}
