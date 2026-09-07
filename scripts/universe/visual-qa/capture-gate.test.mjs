import test from 'node:test';
import assert from 'node:assert/strict';
import { summarise, captureGateFailed } from './capture.mjs';

const finding = (extra = {}) => ({
  route: 'graphs', state: 'populated', theme: 'default', viewport: '1440',
  contrast: { sampled: 1, text: [], canvas: [] },
  progress: { spinners: [], skeletons: 0, charts: [], statusPanels: [], loadingAnnouncements: [], textLength: 900, skeletonOnly: false },
  ...extra,
});

function decision(t, findings) {
  t.mock.method(console, 'log', () => {});
  return captureGateFailed(summarise({ browser: 'chromium', base: 'http://127.0.0.1', screenshots: [], findings }));
}

test('a complete capture with no gated findings succeeds', (t) => {
  assert.equal(decision(t, [finding()]), false);
});

for (const error of ['page.goto: net::ERR_CONNECTION_REFUSED', 'page.screenshot: Target page, context or browser has been closed']) {
  test(`navigation/capture failure gates the actual summary: ${error}`, (t) => {
    // A capture error must fail on its own, even outside the progress gate.
    assert.equal(decision(t, [finding({ route: 'route-outside-progress-gate', error, progress: null, contrast: null })]), true);
  });
}

test('one failed capture cannot be hidden by another completed screenshot', (t) => {
  assert.equal(decision(t, [finding(), finding({ error: 'TargetClosedError' })]), true);
});

test('existing unfinished, contrast and unmatched-fixture gates remain blocking', (t) => {
  t.mock.method(console, 'log', () => {});
  for (const row of [
    finding({ progress: { spinners: ['.spinner'], skeletons: 0, charts: [], statusPanels: [], textLength: 900 } }),
    finding({ contrast: { error: 'probe failed' } }),
    finding({ unmatchedFixtures: ['GET /unmatched'] }),
  ]) {
    assert.equal(captureGateFailed(summarise({ browser: 'chromium', screenshots: [], findings: [row] })), true);
  }
});
