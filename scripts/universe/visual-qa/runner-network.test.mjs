import assert from 'node:assert/strict';
import test from 'node:test';

import { isRunnerNetworkChange, navigateTolerantly, separateRunnerNetworkErrors } from './runner-network.mjs';

const noSleep = { sleep: async () => {} };

test('only the exact Chromium signal is treated as the runner network', () => {
  assert.equal(isRunnerNetworkChange('Failed to load resource: net::ERR_NETWORK_CHANGED'), true);
  assert.equal(isRunnerNetworkChange('Failed to load resource: the server responded with a status of 502'), false);
  assert.equal(isRunnerNetworkChange(undefined), false);
  assert.deepEqual(separateRunnerNetworkErrors(['a net::ERR_NETWORK_CHANGED', 'b 502']), { runner: ['a net::ERR_NETWORK_CHANGED'], origin: ['b 502'] });
});

test('a navigation the runner network undid is retried once and reported', async () => {
  const collected = [];
  const page = {
    calls: 0,
    async goto() {
      this.calls++;
      if (this.calls === 1) {
        collected.push('Failed to load resource: net::ERR_NETWORK_CHANGED');
        throw new Error('page.goto: net::ERR_NETWORK_CHANGED');
      }
    },
  };
  const { notes } = await navigateTolerantly(page, 'https://origin.example/dogecoin', {}, collected, noSleep);
  assert.equal(page.calls, 2);
  assert.deepEqual(collected, [], 'the flap\'s console lines do not count against the origin');
  assert.equal(notes.length, 1);
  assert.match(notes[0], /runner network changed during navigation .* retried once/);
});

test('an origin failure is not retried and keeps its console lines', async () => {
  const collected = ['Failed to load resource: the server responded with a status of 502'];
  const page = { calls: 0, async goto() { this.calls++; throw new Error('page.goto: Timeout 45000ms exceeded.'); } };
  await assert.rejects(navigateTolerantly(page, 'https://origin.example/dogecoin', {}, collected, noSleep), /Timeout 45000ms/);
  assert.equal(page.calls, 1);
  assert.equal(collected.length, 1);
});

test('a second flap in a row is not hidden', async () => {
  const collected = [];
  const page = { calls: 0, async goto() { this.calls++; collected.push('x net::ERR_NETWORK_CHANGED'); throw new Error('net::ERR_NETWORK_CHANGED'); } };
  await assert.rejects(navigateTolerantly(page, 'https://origin.example/address/1', {}, collected, noSleep), /NETWORK_CHANGED/);
  assert.equal(page.calls, 2);
  assert.equal(collected.length, 1, 'the second attempt\'s evidence stays');
});

test('a flap after the load event still triggers one retry', async () => {
  const collected = [];
  const page = {
    calls: 0,
    async goto() {
      this.calls++;
      if (this.calls === 1) collected.push('Failed to load resource: net::ERR_NETWORK_CHANGED');
    },
  };
  const { notes } = await navigateTolerantly(page, 'https://origin.example/zcash', {}, collected, noSleep);
  assert.equal(page.calls, 2);
  assert.deepEqual(collected, []);
  assert.match(notes[0], /while .* was loading; retried once/);
});

