/**
 * What an address page is allowed to say, and what it must never say.
 *
 * These judgements are separated from the browser that collects the evidence
 * so they can be tested without one. The browser part is unavoidably slow and
 * flaky to assert against; the rules are neither, and the rules are the part
 * that was wrong.
 *
 * The page in the production screenshot rendered four lines:
 *
 *   Address
 *   Error loading address data.
 *   (405 OK: Address lookups cannot be used with bitcoind as backend.)
 *   There are too many transactions on this address, more than the backend
 *   can handle. See more on setting up a stronger backend.
 *
 * Every rule below exists because of one of those lines.
 */

/**
 * Text that must never appear on an address page while the deployment says it
 * can serve addresses.
 *
 * Two are the sentences from the screenshot. The third is the reason phrase
 * defect: a status number pasted to whatever word the proxy chain happened to
 * put in the status line, presented to a reader as a diagnosis. It appeared as
 * "405 OK", but the shape is what matters, so any status paired with a success
 * phrase is refused rather than that one string.
 */
export const FORBIDDEN_PHRASES = [
  'Address lookups cannot be used with bitcoind as backend',
  'There are too many transactions on this address',
  'Error loading address data',
];

/**
 * A number-and-reason-phrase pair that contradicts itself.
 *
 * `4xx OK`, `5xx OK`, `5xx Created` and their relatives are all the same bug:
 * the number says the request failed and the word beside it says it did not.
 * Matching the shape rather than the one observed string means the next proxy
 * to invent a different cheerful word is caught too.
 */
const CONTRADICTORY_STATUS = /\b[45]\d{2}\s+(OK|Created|Accepted|No Content|Success)\b/i;

/** Placeholders that mean the page rendered a value it never had. */
const UNRESOLVED_VALUE = /\bundefined\b|\bNaN\b|\bnull\b/;

function failure(check, detail) {
  return { check, detail };
}

/**
 * Holds one loaded address page to the contract.
 *
 * @param {object} page
 * @param {string} page.address        the address the page was opened for
 * @param {string} page.text           everything a reader can see
 * @param {string[]} page.consoleErrors
 * @param {object|null} page.summary   the address document the API returned
 * @param {'ready'|'syncing'|'degraded'|'unavailable'|'disabled'} page.indexState
 */
export function auditAddressPage(page) {
  const failures = [];
  const notes = [];
  const text = page.text ?? '';

  for (const phrase of FORBIDDEN_PHRASES) {
    if (text.includes(phrase)) {
      failures.push(failure('address-page', `${page.address}: the page says "${phrase}"`));
    }
  }

  const contradiction = text.match(CONTRADICTORY_STATUS);
  if (contradiction) {
    failures.push(failure(
      'address-page',
      `${page.address}: the page shows "${contradiction[0]}", a failing status paired with a success phrase`,
    ));
  }

  if (page.indexState !== 'ready') {
    // Not a passing state for a release, but the page is still held to saying
    // something true about it rather than nothing.
    failures.push(failure('address-page', `${page.address}: the address index is ${page.indexState}`));
    return { failures, notes };
  }

  // The page must have rendered the address it was opened for. A page that
  // shows a different one, or none, has resolved something it should not have.
  if (!text.includes(page.address)) {
    failures.push(failure('address-page', `${page.address}: the page does not name the address it was opened for`));
  }

  if (UNRESOLVED_VALUE.test(text)) {
    failures.push(failure('address-page', `${page.address}: the page renders an unresolved value`));
  }

  if (!page.summary) {
    failures.push(failure('address-page', `${page.address}: the address API returned nothing while the page loaded`));
    return { failures, notes };
  }

  const stats = page.summary.chain_stats ?? {};
  for (const field of ['funded_txo_count', 'funded_txo_sum', 'spent_txo_count', 'spent_txo_sum', 'tx_count']) {
    if (!Number.isInteger(stats[field])) {
      failures.push(failure(
        'address-page',
        `${page.address}: chain_stats.${field} is ${JSON.stringify(stats[field])} rather than a whole number`,
      ));
    }
  }

  // An address that has confirmed history must show some. A page that renders
  // an empty table over a non-empty index is the "unknown became zero" defect
  // wearing a working layout, and it is the one failure here that looks fine.
  const confirmed = Number.isInteger(stats.tx_count) ? stats.tx_count : 0;
  if (confirmed > 0 && !page.transactionsRendered) {
    failures.push(failure(
      'address-page',
      `${page.address}: the index reports ${confirmed} confirmed transactions and the page rendered none`,
    ));
  }

  for (const message of page.consoleErrors ?? []) {
    failures.push(failure('address-page', `${page.address}: console error: ${message}`));
  }

  if (!failures.length) {
    notes.push(`${page.address}: renders ${confirmed} confirmed transactions with whole-number amounts`);
  }
  return { failures, notes };
}

/**
 * A string that is not an address gets told so.
 *
 * This is the string from the screenshot, whose bech32 checksum does not
 * verify. The old page answered it with a contradiction and a wrong
 * explanation; the only thing it may say now is that it is not an address.
 */
export function auditMalformedAddressPage(page) {
  const failures = [];
  const notes = [];
  const text = page.text ?? '';

  for (const phrase of FORBIDDEN_PHRASES) {
    if (text.includes(phrase)) {
      failures.push(failure('malformed-address', `the page says "${phrase}"`));
    }
  }
  const contradiction = text.match(CONTRADICTORY_STATUS);
  if (contradiction) {
    failures.push(failure('malformed-address', `the page shows "${contradiction[0]}"`));
  }
  if (!/not a valid/i.test(text)) {
    failures.push(failure('malformed-address', 'the page does not say the address is invalid'));
  }
  if (!failures.length) {
    notes.push('a malformed address is named as invalid rather than blamed on its history');
  }
  return { failures, notes };
}
