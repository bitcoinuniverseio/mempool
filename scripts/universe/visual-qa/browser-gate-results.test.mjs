import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  captureFailureMessages,
  keyboardFailureMessages,
  liveFailureMessages,
} from './browser-gate-results.mjs';

const captureScript = readFileSync(new URL('./capture.mjs', import.meta.url), 'utf8');
const keyboardScript = readFileSync(new URL('./keyboard-check.mjs', import.meta.url), 'utf8');
const liveScript = readFileSync(new URL('./live-e2e.mjs', import.meta.url), 'utf8');

test('capture fails every recorded defect and ignores expected observations', () => {
  const failures = captureFailureMessages({
    findings: [{
      route: 'home',
      state: 'populated',
      theme: 'dark',
      viewport: '320',
      overflowBy: 4,
      consoleErrors: ['boom'],
      expectedFetchErrors: ['expected refusal'],
      brokenImages: ['/missing.png'],
      error: 'navigation timeout',
      progress: { error: 'progress probe crashed' },
      violations: [{ id: 'button-name' }],
      obscured: [{ id: 'target-size' }],
      contrast: {
        error: 'probe crashed',
        text: [{ ratio: 2.1, required: 4.5 }],
        canvas: [
          { blank: true, selector: '#chart' },
          { blank: false, selector: '#painted' },
          { blank: false, selector: '#unreadable', error: 'tainted canvas' },
        ],
      },
    }],
  }, ['home/populated/dark@320: loader never resolved']);

  assert.equal(failures.length, 11);
  assert.ok(failures.some((failure) => failure.includes('horizontal overflow')));
  assert.ok(failures.some((failure) => failure.includes('console error')));
  assert.ok(failures.some((failure) => failure.includes('broken image')));
  assert.ok(failures.some((failure) => failure.includes('navigation failed')));
  assert.ok(failures.some((failure) => failure.includes('progress probe failed')));
  assert.ok(failures.some((failure) => failure.includes('accessibility violation')));
  assert.ok(failures.some((failure) => failure.includes('contrast probe failed')));
  assert.ok(failures.some((failure) => failure.includes('text contrast')));
  assert.ok(failures.some((failure) => failure.includes('canvas drew nothing')));
  assert.ok(failures.some((failure) => failure.includes('canvas probe failed')));
  assert.ok(failures.some((failure) => failure.includes('loader never resolved')));
  assert.ok(failures.every((failure) => !failure.includes('expected refusal')));
  assert.ok(failures.every((failure) => !failure.includes('obscured')));
});

test('capture passes a clean report', () => {
  assert.deepEqual(captureFailureMessages({ findings: [{}] }), []);
});

test('keyboard fails every nonzero defect count', () => {
  const failures = keyboardFailureMessages({ unnamed: 1, invisible: 2, offscreen: 3, moving: 4 });
  assert.equal(failures.length, 4);
  assert.deepEqual(keyboardFailureMessages(), []);
});

test('live check flattens every failure with its route', () => {
  assert.deepEqual(liveFailureMessages([
    { path: '/one', failures: ['did not load', 'console error'] },
    { path: '/two', failures: ['503 /api/data'] },
  ]), [
    '/one: did not load',
    '/one: console error',
    '/two: 503 /api/data',
  ]);
  assert.deepEqual(liveFailureMessages([{ path: '/', failures: [] }]), []);
});

test('each browser entry point exits nonzero when its classified failures are nonempty', () => {
  assert.match(
    captureScript,
    /captureFailureMessages\(report, progress\)[\s\S]*?if \(failures\.length > 0\)[\s\S]*?process\.exitCode = 1/,
  );
  assert.match(
    keyboardScript,
    /keyboardFailureMessages\([\s\S]*?process\.exitCode = failures\.length \? 1 : 0/,
  );
  assert.match(
    liveScript,
    /liveFailureMessages\(results\)[\s\S]*?process\.exitCode = failures\.length \? 1 : 0/,
  );
});
