import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationTargetStatus } from './acceptance-browser.mjs';

test('NAV-001 cannot pass the mining entry by rendering the home page', () => {
  assert.equal(navigationTargetStatus('/mining/blocks', '/'), 'NOT VERIFIED');
});

test('redirects and default children require their own target assertion', () => {
  assert.equal(navigationTargetStatus('/clock', '/clock/mined/0'), 'NOT VERIFIED');
  assert.equal(navigationTargetStatus('/mining', '/mining/pools'), 'NOT VERIFIED');
});

test('matching navigation is rendering evidence only and runtime errors fail', () => {
  assert.equal(navigationTargetStatus('/payments/silent/address', '/payments/silent/address'), 'PASS');
  assert.equal(navigationTargetStatus('/payments/silent/address', '/payments/silent/address', ['Angular error']), 'FAIL');
});
