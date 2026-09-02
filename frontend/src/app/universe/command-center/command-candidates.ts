import { classifyUniverseQuery } from '@app/universe/universe-identifier';
import { getRegex, Network } from '@app/shared/regex.utils';

/**
 * What one line of input could be, resolved as far as honesty allows locally.
 *
 * Every candidate this module returns is a deterministic consequence of the
 * text: an address prefix, a hash shape, a known identifier grammar. Where
 * the text genuinely admits more than one subject, such as a 64 character
 * hash being a block or a transaction, every reading comes back as its own
 * candidate and the visitor chooses. Nothing here picks for them, and
 * nothing here invents a claim that needs the chain to verify.
 *
 * The one refusal this module owns: text that looks like key material is
 * named as such and never becomes a network request.
 */

export type CandidateSource = 'pattern' | 'chain-node' | 'universe-index';

export interface CommandCandidate {
  /** What the candidate is, in one word for grouping and screen readers. */
  readonly kind: string;
  /** Chain it belongs to, where one applies. */
  readonly chain: string | null;
  readonly label: string;
  /** Where the visitor lands on choosing it. */
  readonly path: string;
  readonly source: CandidateSource;
  /** True when the text is exactly this kind of thing, not merely plausibly. */
  readonly exact: boolean;
  /** The authority that produced the claim, when an index produced it. */
  readonly authority?: string;
}

const HASH_64 = /^[0-9a-f]{64}$/i;
const HEX_EVEN = /^[0-9a-f]+$/i;
const PSBT_BASE64 = /^cHNidP[1-9A-Za-z][^A-Za-z0-9+/=]*[A-Za-z0-9+/=]+$/;
const PSBT_HEX = /^70736274ff[0-9a-f]+$/i;
const INTEGER = /^\d{1,9}$/;

/**
 * Address encodings by their human readable prefixes, naming only the chains
 * this deployment can open a page for today.
 *
 * Fractal Bitcoin reuses Bitcoin's encodings, so a Bitcoin shaped address is
 * valid on both chains. The Fractal Explorer is its own product in the
 * program and does not exist yet, so no fractal candidate is offered: naming
 * a chain with nowhere to open would be support implied, not delivered.
 */
const ADDRESS_PREFIXES: ReadonlyArray<{ readonly test: RegExp; readonly chains: readonly string[] }> = [
  { test: /^bc1[0-9a-z]{6,90}/i, chains: ['bitcoin'] },
  { test: /^tb1[0-9a-z]{6,90}/i, chains: ['bitcoin'] },
  { test: /^[13][a-km-zA-HJ-NP-Z1-9]{25,62}$/, chains: ['bitcoin'] },
  { test: /^D[a-km-zA-HJ-NP-Z1-9]{25,62}$/, chains: ['dogecoin'] },
  { test: /^[9n][a-km-zA-HJ-NP-Z1-9]{25,62}$/, chains: ['dogecoin'] },
  { test: /^lq1[a-z0-9]{6,90}/i, chains: ['liquid'] },
  { test: /^eltc1[a-z0-9]{6,90}/i, chains: ['liquid'] },
  { test: /^(t1|t3)[a-km-zA-HJ-NP-Z1-9]{25,62}$/, chains: ['zcash'] },
  { test: /^(zs|ztestsapling)[a-z0-9]{20,90}/i, chains: ['zcash'] },
  { test: /^u1[a-z0-9]{6,90}/i, chains: ['zcash'] },
];

/** Where an address on a named chain opens. */
const CHAIN_ADDRESS_PATH: Record<string, string> = {
  bitcoin: '/address',
  dogecoin: '/dogecoin/address',
  zcash: '/zcash/address',
  liquid: '/address',
};

/**
 * True for text that must never reach a search backend.
 *
 * Key material has shapes: extended private keys name themselves, WIF keys
 * have their version bytes, BIP38 passphrases begin 6P, and a recovery
 * phrase is a run of twelve or more short lowercase words. None of these is
 * an explorer query. The honest answer is a local refusal, in words, with
 * nothing sent anywhere.
 */
export function looksSecretLike(text: string): boolean {
  const value = (text ?? '').trim();
  if (!value) { return false; }

  if (/\b(xprv|yprv|zprv|vprv|tprv|uprv|vprv|YPRV|ZPRV)[a-km-zA-HJ-NP-Z1-9]{20,}\b/.test(value)) {
    return true;
  }
  // WIF: version byte 5, K, or L, then base58 check characters.
  if (/\b[5KL][1-9A-HJ-NP-Za-km-z]{50,51}\b/.test(value)) {
    return true;
  }
  // BIP38 encrypted keys.
  if (/\b6P[1-9A-HJ-NP-Za-km-z]{40,60}\b/.test(value)) {
    return true;
  }
  // A seed phrase: twelve or more space separated lowercase words.
  const words = value.toLowerCase().split(/[\s,]+/).filter((word) => /^[a-z]{3,8}$/.test(word));
  if (words.length >= 12 && words.length === value.trim().toLowerCase().split(/[\s,]+/).filter(Boolean).length) {
    return true;
  }
  return false;
}

/**
 * Every reading of one line, best first.
 *
 * `network` is the network the visitor is on, used only where the reading
 * depends on it, such as a block height or the address shape check.
 */
export function localCandidates(raw: string, network: Network): CommandCandidate[] {
  const value = (raw ?? '').trim();
  if (!value || value.length > 4096) { return []; }

  const candidates: CommandCandidate[] = [];

  // Universe identifiers: outpoints, inscriptions, runes, sats.
  for (const match of classifyUniverseQuery(value)) {
    if (match.kind === 'protocol') { continue; }
    candidates.push({
      kind: match.kind.replace(/-/g, ' '),
      chain: 'bitcoin',
      label: match.value,
      path: match.route.join('/').replace(/\/+/g, '/'),
      source: 'pattern',
      exact: true,
    });
  }

  // PSBTs, by their magic in either encoding, and raw transactions by shape.
  if (PSBT_BASE64.test(value) || PSBT_HEX.test(value) || /70736274ff/i.test(value)) {
    candidates.push({
      kind: 'psbt',
      chain: 'bitcoin',
      label: 'A PSBT to decode locally',
      path: '/tools/psbt',
      source: 'pattern',
      exact: true,
    });
  } else if (HEX_EVEN.test(value) && value.length >= 20 && !HASH_64.test(value)) {
    candidates.push({
      kind: 'raw transaction',
      chain: 'bitcoin',
      label: 'Hexadecimal that may be a raw transaction',
      path: '/tx/preview',
      source: 'pattern',
      exact: false,
    });
  }

  // Addresses, once per chain whose encoding the prefix names.
  for (const prefix of ADDRESS_PREFIXES) {
    if (prefix.test.test(value)) {
      for (const chain of prefix.chains) {
        candidates.push({
          kind: 'address',
          chain,
          label: value,
          path: `${CHAIN_ADDRESS_PATH[chain] ?? '/address'}/${value}`,
          source: 'pattern',
          exact: true,
        });
      }
      break;
    }
  }

  // A 64 character hash is a block or a transaction. Both readings stand as
  // candidates; the chain decides which exists when one is chosen.
  const lower = value.toLowerCase();
  if (HASH_64.test(value)) {
    candidates.push(
      {
        kind: 'transaction',
        chain: 'bitcoin',
        label: lower,
        path: `/tx/${lower}`,
        source: 'chain-node',
        exact: false,
      },
      {
        kind: 'block',
        chain: 'bitcoin',
        label: lower,
        path: `/block/${lower}`,
        source: 'chain-node',
        exact: false,
      },
    );
  }

  // A plausible height, on the network being read.
  if (INTEGER.test(value)) {
    candidates.push({
      kind: 'block height',
      chain: 'bitcoin',
      label: `Block ${value}`,
      path: `/block/${value}`,
      source: 'chain-node',
      exact: false,
    });
  }

  // An address on the network being read, when no prefix named a chain.
  if (!candidates.length && getRegex('address', network).test(value)) {
    candidates.push({
      kind: 'address',
      chain: 'bitcoin',
      label: value,
      path: `/address/${value}`,
      source: 'pattern',
      exact: true,
    });
  }

  return candidates;
}

/** Removes duplicate paths, keeping the first of each. */
export function dedupeCandidates(candidates: readonly CommandCandidate[]): CommandCandidate[] {
  const seen = new Set<string>();
  const kept: CommandCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.kind}|${candidate.chain}|${candidate.path}`;
    if (seen.has(key)) { continue; }
    seen.add(key);
    kept.push(candidate);
  }
  return kept;
}

/** Turns backend search groups into the same candidate shape. */
export function candidatesFromSearch(
  groups: ReadonlyArray<{
    chain: string;
    results: ReadonlyArray<{
      kind: string;
      reference: string;
      label: string;
      path: string;
      exact: boolean;
      proof: { authority: string; state: string };
    }>;
  }>,
): CommandCandidate[] {
  const candidates: CommandCandidate[] = [];
  for (const group of groups) {
    for (const result of group.results) {
      candidates.push({
        kind: result.kind,
        chain: group.chain,
        label: result.label,
        path: result.path,
        source: 'universe-index',
        exact: result.exact,
        authority: result.proof?.authority,
      });
    }
  }
  return candidates;
}
