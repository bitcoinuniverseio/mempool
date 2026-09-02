/**
 * Shapes that must never be read as data.
 *
 * Key material names itself often enough to be caught: extended private
 * keys carry their version prefixes, WIF keys their version bytes, BIP38
 * passphrases begin 6P, and a recovery phrase is a long run of short words.
 * Anything matching is refused before it becomes a request, a log line, or
 * a stored entry, wherever the explorer accepts pasted text.
 */

const EXTENDED_KEY = /\b(xprv|yprv|zprv|vprv|tprv|uprv)[a-km-zA-HJ-NP-Z1-9]{20,}\b/;
const WIF_KEY = /\b[5KL][1-9A-HJ-NP-Za-km-z]{50,51}\b/;
const BIP38_PASSPHRASE = /\b6P[1-9A-HJ-NP-Za-km-z]{40,60}\b/;

/** True when the text looks like private key material. */
export function looksSecretLike(text: string): boolean {
  const value = (text ?? '').trim();
  if (!value) { return false; }

  if (EXTENDED_KEY.test(value)) { return true; }
  if (WIF_KEY.test(value)) { return true; }
  if (BIP38_PASSPHRASE.test(value)) { return true; }

  // A seed phrase: twelve or more space separated lowercase words, and
  // nothing else in the input.
  const words = value.toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (words.length >= 12 && words.every((word) => /^[a-z]{3,8}$/.test(word))) {
    return true;
  }
  return false;
}
