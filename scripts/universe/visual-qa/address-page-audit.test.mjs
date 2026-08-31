import test from 'node:test';
import assert from 'node:assert/strict';

import { auditAddressPage, auditMalformedAddressPage } from './address-page-audit.mjs';

/**
 * These are written as the failure first and the pass second, because a gate
 * that has only ever been run against a working system has not been shown to
 * work. Every one of them reconstructs a page that did reach production, or
 * one that plausibly could, and requires the audit to reject it.
 */

const ADDRESS = '1Q2TWHE3GMdB6BZKafqwxXtWAWgFt5Jvm3';

function goodPage(overrides = {}) {
  return {
    address: ADDRESS,
    text: `Address ${ADDRESS} Confirmed balance 0.5 BTC 4 transactions`,
    consoleErrors: [],
    indexState: 'ready',
    transactionsRendered: true,
    summary: {
      address: ADDRESS,
      chain_stats: {
        funded_txo_count: 4,
        funded_txo_sum: 5_000_000_000,
        spent_txo_count: 3,
        spent_txo_sum: 4_500_000_000,
        tx_count: 4,
      },
    },
    ...overrides,
  };
}

test('a working address page passes', () => {
  const { failures } = auditAddressPage(goodPage());
  assert.deepEqual(failures, []);
});

/**
 * The page from the screenshot, reconstructed line for line. If this gate had
 * existed, that release could not have shipped.
 */
test('the page that shipped is rejected', () => {
  const { failures } = auditAddressPage(goodPage({
    text:
      'Address bc1qcx70rmarfudyct7lx0ptrat2c5kgstghx2j69 Error loading address data. ' +
      '(405 OK: Address lookups cannot be used with bitcoind as backend.) ' +
      'There are too many transactions on this address, more than the backend can handle. ' +
      'See more on setting up a stronger backend.',
  }));
  const detail = failures.map((f) => f.detail).join(' | ');
  assert.ok(failures.length >= 3, `expected several failures, got ${failures.length}`);
  assert.match(detail, /Error loading address data/);
  assert.match(detail, /cannot be used with bitcoind/);
  assert.match(detail, /too many transactions/);
  assert.match(detail, /405 OK/);
});

test('a failing status paired with a success phrase is rejected whatever the words are', () => {
  // The proxy that produced "405 OK" is free to write something else next
  // time, so the shape is what is refused rather than the one string.
  for (const rendered of ['503 OK', '502 Created', '404 Accepted', '500 Success']) {
    const { failures } = auditAddressPage(goodPage({ text: `Address ${ADDRESS} (${rendered})` }));
    assert.ok(
      failures.some((f) => f.detail.includes(rendered)),
      `expected ${rendered} to be rejected`,
    );
  }
});

test('an honest failing status on its own is not what this rule is about', () => {
  const { failures } = auditAddressPage(goodPage({ text: `Address ${ADDRESS} (HTTP 503) 4 transactions` }));
  assert.deepEqual(failures, []);
});

test('a page rendered while the index is not ready fails the release', () => {
  for (const state of ['syncing', 'degraded', 'unavailable', 'disabled']) {
    const { failures } = auditAddressPage(goodPage({ indexState: state }));
    assert.ok(failures.some((f) => f.detail.includes(state)), `expected ${state} to fail`);
  }
});

/**
 * The quiet one. Everything renders, nothing errors, and the page shows an
 * empty history for an address the index says has four transactions. It looks
 * like a working page showing an address with no activity.
 */
test('an empty table over a non-empty index is rejected', () => {
  const { failures } = auditAddressPage(goodPage({ transactionsRendered: false }));
  assert.ok(failures.some((f) => /rendered none/.test(f.detail)));
});

test('an amount that is not a whole number of satoshis is rejected', () => {
  for (const value of ['5000000000', 5.5, null, undefined]) {
    const page = goodPage();
    page.summary.chain_stats.funded_txo_sum = value;
    const { failures } = auditAddressPage(page);
    assert.ok(
      failures.some((f) => f.detail.includes('funded_txo_sum')),
      `expected ${JSON.stringify(value)} to be rejected`,
    );
  }
});

test('a placeholder rendered as text is rejected', () => {
  for (const rendered of ['undefined', 'NaN', 'null']) {
    const { failures } = auditAddressPage(goodPage({ text: `Address ${ADDRESS} Balance ${rendered} BTC` }));
    assert.ok(failures.some((f) => /unresolved value/.test(f.detail)), `expected ${rendered} to be rejected`);
  }
});

test('a page that does not name the address it was opened for is rejected', () => {
  const { failures } = auditAddressPage(goodPage({ text: 'Address Confirmed balance 0.5 BTC' }));
  assert.ok(failures.some((f) => /does not name the address/.test(f.detail)));
});

test('a console error is a failure even when the page looks right', () => {
  const { failures } = auditAddressPage(goodPage({ consoleErrors: ['Refused to execute inline script'] }));
  assert.ok(failures.some((f) => /console error/.test(f.detail)));
});

test('a malformed address must be named as invalid', () => {
  const good = auditMalformedAddressPage({
    text: 'Address bc1qcx70rmarfudyct7lx0ptrat2c5kgstghx2j69 This is not a valid Bitcoin address. Check the address and try again.',
  });
  assert.deepEqual(good.failures, []);
});

test('a malformed address explained as having too much history is rejected', () => {
  const { failures } = auditMalformedAddressPage({
    text: 'Error loading address data. (405 OK) There are too many transactions on this address',
  });
  assert.ok(failures.length >= 3);
});

test('a malformed address that says nothing at all is rejected', () => {
  const { failures } = auditMalformedAddressPage({ text: 'Address' });
  assert.ok(failures.some((f) => /does not say the address is invalid/.test(f.detail)));
});
