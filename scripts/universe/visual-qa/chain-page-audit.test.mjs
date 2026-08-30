/**
 * Proof that the public chain page gate can fail.
 *
 * Every defect it exists for shipped past a suite that was green, so a gate
 * that has only ever passed proves nothing about the next one. Each case here
 * reconstructs a state that actually reached production, or one a change could
 * plausibly reintroduce, and asserts that this gate names it.
 *
 * The passing case is here for the same reason in reverse: a check that fails
 * on healthy output gets switched off, and the honest degraded state of a chain
 * in an index recovery must go through.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { auditChainPage, auditRelease } from './chain-page-audit.mjs';

const SNAPSHOT = 'dogecoin-mainnet-9304b4b3a53e788898da63a1b52cd509';

/** Dogecoin as production reported it on 2026-08-29, degraded and truthful. */
function envelope(overrides = {}) {
  return {
    schemaVersion: 'universe-chain-capability-v1',
    chain: 'dogecoin',
    network: 'mainnet',
    ready: false,
    mempool: { supported: true, state: 'ready', completeness: 'complete', snapshotId: SNAPSHOT },
    reads: {
      transaction: true,
      block: true,
      address: true,
      outpoint: true,
      feeEstimates: true,
      projectedBlocks: false,
    },
    coverage: {
      confirmedHistory: 'unavailable',
      addressHistory: 'unavailable',
      protocolHistory: 'unavailable',
    },
    degradedReasons: [
      'base-chain-authority-unavailable',
      'confirmed-history-authority-unavailable',
      'protocol-history-unavailable',
    ],
    release: { sha: 'bea93c1ec' },
    ...overrides,
  };
}

/** The page as this release renders it for that document. */
function seenPage(overrides = {}) {
  return {
    primary: [
      'DOGECOIN OVERVIEW',
      'CHAIN Degraded CHAIN TIP Block 6,352,650 BEHIND TIP Not stated',
      'Why Dogecoin is not ready',
      'Questions this chain can answer',
      'How much history is readable now',
      'Dogecoin fees are quoted per kilobyte, not in sat/vB.',
      'No projected blocks are shown for this chain.',
    ].join('\n'),
    disclosure: `Where these readings came from Pending snapshot ${SNAPSHOT} Overlay release bea93c1ec`,
    rail: [
      { label: 'CHAIN', value: 'Degraded' },
      { label: 'CHAIN TIP', value: 'Block 6,352,650' },
      { label: 'BEHIND TIP', value: 'Not stated' },
      { label: 'LAST OBSERVED', value: '3 seconds ago' },
      { label: 'PENDING COVERAGE', value: 'Complete' },
    ],
    headings: ['DOGECOIN OVERVIEW', 'Why Dogecoin is not ready'],
    notReadyReasons: [
      "The node that serves this chain's own blocks and transactions did not answer.",
      'The source of confirmed history did not answer, so history older than the pending set cannot be read.',
      'At least one protocol indexer this chain needs is not answering, so protocol history cannot be read.',
    ],
    coverage: [
      { label: 'Confirmed history', state: 'Unavailable' },
      { label: 'Address history', state: 'Unavailable' },
      { label: 'Protocol history', state: 'Unavailable' },
    ],
    entries: [
      { href: '/dogecoin/mempool', title: 'Pending transactions', detail: 'What our node has seen' },
      { href: '/dogecoin/protocols', title: 'Protocols', detail: 'Assets carried on this chain' },
    ],
    horizontalOverflow: 0,
    ...overrides,
  };
}

function audit(envelopeOverrides = {}, seenOverrides = {}, observations = {}) {
  return auditChainPage({
    chain: 'dogecoin',
    envelope: envelope(envelopeOverrides),
    seen: seenOverrides === null ? null : seenPage(seenOverrides),
    observations: {
      entryStatus: { '/dogecoin/mempool': 200, '/dogecoin/protocols': 200 },
      ...observations,
    },
  });
}

function saidSomethingAbout(result, needle) {
  return result.failures.some((failure) => failure.includes(needle));
}

test('a truthfully degraded chain passes', () => {
  const result = audit();
  assert.deepEqual(result.failures, []);
  assert.ok(result.notes.length > 5);
});

test('a ready chain with no fault panel passes', () => {
  const result = audit(
    {
      ready: true,
      coverage: {
        confirmedHistory: 'complete',
        addressHistory: 'complete',
        protocolHistory: 'complete',
      },
      degradedReasons: [],
    },
    {
      notReadyReasons: [],
      coverage: [
        { label: 'Confirmed history', state: 'Complete' },
        { label: 'Address history', state: 'Complete' },
        { label: 'Protocol history', state: 'Complete' },
      ],
    },
  );
  assert.deepEqual(result.failures, []);
});

test('the dashboard this one replaced is detected', () => {
  // An origin serving the old build renders a page with none of this
  // structure. It loads, it answers 200, and every other check passes.
  const result = auditChainPage({ chain: 'dogecoin', envelope: envelope(), seen: null });
  assert.ok(saidSomethingAbout(result, 'not serving the chain dashboard this release ships'));
});

test('a raw snapshot identifier restored to the primary interface is detected', () => {
  const result = audit({}, { primary: `${seenPage().primary}\nsnapshot ${SNAPSHOT}` });
  assert.ok(saidSomethingAbout(result, 'whole snapshot identifier is in the primary interface'));
});

test('a snapshot identifier that is nowhere at all is detected', () => {
  const result = audit({}, { disclosure: 'Where these readings came from' });
  assert.ok(saidSomethingAbout(result, 'dropped rather than filed'));
});

test('a release the overlay could not name is detected', () => {
  assert.ok(
    saidSomethingAbout(audit({ release: { sha: 'development' } }), 'which is not a commit'),
  );
});

test('a missing release identifier is detected', () => {
  assert.ok(saidSomethingAbout(audit({ release: {} }), 'which is not a commit'));
  assert.ok(saidSomethingAbout(audit({ release: undefined }), 'which is not a commit'));
});

test('a malformed release identifier is detected', () => {
  assert.ok(saidSomethingAbout(audit({ release: { sha: 'HEAD' } }), 'which is not a commit'));
});

test('a chain that is not ready and does not say why is detected', () => {
  assert.ok(saidSomethingAbout(audit({}, { notReadyReasons: [] }), 'gives no explanation'));
});

test('a raw reason code printed instead of an explanation is detected', () => {
  const result = audit({}, { notReadyReasons: ['base-chain-authority-unavailable'] });
  assert.ok(saidSomethingAbout(result, 'gives no explanation'));
});

test('a ready chain still showing a fault panel is detected', () => {
  const result = audit({ ready: true }, {});
  assert.ok(saidSomethingAbout(result, 'ready while the page still shows a fault explanation'));
});

test('an unavailable history reported as nothing at all is detected', () => {
  const result = audit(
    {},
    {
      coverage: [
        { label: 'Confirmed history', state: 'Complete' },
        { label: 'Address history', state: 'Complete' },
        { label: 'Protocol history', state: 'Complete' },
      ],
    },
  );
  assert.ok(saidSomethingAbout(result, 'address history is unavailable and the page does not say so'));
});

test('the wrong chain rendered under the right route is detected', () => {
  const result = audit(
    {},
    {
      headings: ['ZCASH OVERVIEW'],
      primary: seenPage().primary.replace('DOGECOIN', 'ZCASH') + '\nZcash',
    },
  );
  assert.ok(saidSomethingAbout(result, 'does not name Dogecoin'));
  assert.ok(saidSomethingAbout(result, 'mentions Zcash in its own content'));
});

test('a status rail that lost its labels is detected', () => {
  const result = audit(
    {},
    { rail: seenPage().rail.map((reading) => ({ label: '', value: reading.value })) },
  );
  assert.ok(saidSomethingAbout(result, 'value with no label'));
});

test('an empty scan is a failure rather than a pass', () => {
  // A selector change that matches nothing must not read as a clean page.
  const result = audit({}, { rail: [], coverage: [], entries: [], headings: [] });
  assert.ok(saidSomethingAbout(result, 'status rail has 0 readings'));
  assert.ok(saidSomethingAbout(result, 'history coverage dimensions'));
  assert.ok(saidSomethingAbout(result, 'next action(s)'));
});

test('the phrases of the dashboard this replaced are detected', () => {
  const result = audit({}, { primary: `${seenPage().primary}\nWhat is happening now` });
  assert.ok(saidSomethingAbout(result, 'What is happening now'));
});

test('losing what makes this chain itself is detected', () => {
  const result = audit({}, { primary: seenPage().primary.replace('per kilobyte', 'per byte') });
  assert.ok(saidSomethingAbout(result, 'fee-unit'));
});

test('a next action pointing at another chain is detected', () => {
  const result = audit(
    {},
    {
      entries: [
        { href: '/zcash/mempool', title: 'Pending transactions', detail: 'Wrong chain' },
        { href: '/dogecoin/protocols', title: 'Protocols', detail: 'Assets on this chain' },
      ],
    },
  );
  assert.ok(saidSomethingAbout(result, 'is not a Dogecoin route'));
});

test('a next action whose destination does not answer is detected', () => {
  const result = audit({}, {}, { entryStatus: { '/dogecoin/mempool': 404, '/dogecoin/protocols': 200 } });
  assert.ok(saidSomethingAbout(result, '/dogecoin/mempool answered HTTP 404'));
});

test('a bare link with no description is detected', () => {
  const result = audit(
    {},
    {
      entries: [
        { href: '/dogecoin/mempool', title: 'Open mempool', detail: '' },
        { href: '/dogecoin/protocols', title: 'Open protocols', detail: '' },
      ],
    },
  );
  assert.ok(saidSomethingAbout(result, 'no title or no description'));
});

test('sideways scroll, console errors and third-party requests are detected', () => {
  const result = audit(
    {},
    { horizontalOverflow: 42 },
    {
      consoleErrors: ['TypeError: undefined'],
      failedRequests: ['/api/v1/dogecoin/status HTTP 502'],
      foreignRequests: ['https://example.invalid/pixel.gif'],
    },
  );
  assert.ok(saidSomethingAbout(result, 'scrolls sideways by 42'));
  assert.ok(saidSomethingAbout(result, 'console error(s)'));
  assert.ok(saidSomethingAbout(result, 'failed request(s)'));
  assert.ok(saidSomethingAbout(result, 'third-party address(es)'));
});

test('an origin serving a different build than the release names is detected', () => {
  assert.deepEqual(auditRelease('bea93c1ec', 'bea93c1ec7f608313').failures, []);
  assert.deepEqual(auditRelease('bea93c1ec', null).failures, []);
  assert.ok(
    auditRelease('521a091', 'bea93c1ec7f608313').failures[0].includes('this run expected'),
  );
  assert.ok(auditRelease(null, null).failures[0].includes('publishes no frontend commit'));
});
