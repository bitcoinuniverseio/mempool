import test from 'node:test';
import assert from 'node:assert/strict';
import { progressFailures } from './capture.mjs';

/**
 * The gate that would have stopped the release.
 *
 * A Charts page whose spinner never stopped and a Mining dashboard of 35
 * skeletons passed every other check in the matrix. These cases assert the new
 * one actually fires, and that it does not fire on a page that finished.
 */

const at = (overrides) => ({
  findings: [{
    route: 'graphs', routeName: 'Graphs', state: 'populated',
    theme: 'default', viewport: '1440',
    progress: { spinners: [], skeletons: 0, charts: [], statusPanels: [], loadingAnnouncements: [], textLength: 900, skeletonOnly: false },
    ...overrides,
  }],
});

const withProgress = (state, progress) => at({
  state,
  progress: { spinners: [], skeletons: 0, charts: [], statusPanels: [], loadingAnnouncements: [], textLength: 900, skeletonOnly: false, ...progress },
});

test('a populated page that finished raises nothing', () => {
  assert.deepEqual(progressFailures(withProgress('populated', { charts: [{ selector: 'div.chart', width: 800, height: 500, svgMarks: 40, canvasCount: 0, canvasPixels: 0, drewNothing: false }] })), []);
});

test('a spinner still turning on a populated page fails the run', () => {
  const failures = progressFailures(withProgress('populated', { spinners: ['div.spinner-border'] }));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /never stopped loading/);
});

test('skeletons that never resolved fail the run', () => {
  const failures = progressFailures(withProgress('populated', { skeletons: 35 }));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /35 skeleton/);
});

test('a chart panel that drew nothing fails the run', () => {
  const failures = progressFailures(withProgress('populated', {
    charts: [{ selector: 'div.chart', width: 800, height: 500, svgMarks: 0, canvasCount: 0, canvasPixels: 0, drewNothing: true }],
  }));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /drew nothing/);
});

test('a page that is only placeholders fails the run', () => {
  const failures = progressFailures(withProgress('populated', { skeletons: 4, textLength: 60, skeletonOnly: true }));
  assert.ok(failures.some((line) => /placeholders/.test(line)));
});

test('a failure state that waits without saying why fails the run', () => {
  const failures = progressFailures(withProgress('chain-down', { spinners: ['div.spinner-border'], statusPanels: [] }));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /nothing said about why/);
});

test('a failure state that says what happened is accepted', () => {
  assert.deepEqual(
    progressFailures(withProgress('chain-down', {
      spinners: ['div.load-status-spinner'],
      statusPanels: ['The service behind this panel is unavailable. Retry'],
    })),
    [],
  );
});

test('an empty range on a failure state is not treated as unfinished', () => {
  assert.deepEqual(progressFailures(withProgress('authority-empty', {})), []);
});

test('a finding with no probe at all is skipped rather than guessed at', () => {
  assert.deepEqual(progressFailures({ findings: [{ route: 'graphs', state: 'populated' }] }), []);
});

test('the loading fixture is judged on whether the wait is announced, not on having finished', () => {
  // This fixture holds every request open on purpose. Asking it to have
  // finished would be asking the wrong question.
  assert.deepEqual(
    progressFailures(withProgress('loading', { skeletons: 6, loadingAnnouncements: ['Loading protocol registry'] })),
    [],
  );
  assert.deepEqual(
    progressFailures(withProgress('loading', { spinners: ['div.load-status-spinner'] })),
    [],
  );
});

test('a page that waits with nothing on screen saying so fails the run', () => {
  const failures = progressFailures(withProgress('loading', { skeletons: 6, loadingAnnouncements: [] }));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /nothing on screen that says so/);
});

test('a page with nothing to fetch owes the reader no loader', () => {
  // The docs and source pages render from what is already in the bundle. Under
  // the loading fixture they simply appear, and demanding a spinner from them
  // was the rule failing a page for having nothing to wait for.
  assert.deepEqual(
    progressFailures(withProgress('loading', { skeletons: 0, spinners: [], loadingAnnouncements: [] })),
    [],
  );
});
