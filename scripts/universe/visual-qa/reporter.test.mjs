import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VisualQAReporter } from './reporter.mjs';

test('generates summary.json, review.json, junit.xml and report.html', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reporter-test-'));

  try {
    const reporter = new VisualQAReporter({
      outDir: dir,
      runId: 'run-test-123',
      candidateCommit: 'abcdef123',
      referenceCommit: '987654321',
    });

    reporter.addCase({
      caseId: 'home_populated_default_1280',
      routeId: 'home',
      scenarioId: 'default',
      browser: 'chromium',
      viewport: '1280',
      theme: 'default',
      status: 'pass',
      reviewStatus: 'approved',
      reviewNote: 'Looks clean',
      diffMetrics: { changedPixels: 0, changedRatio: 0, ssim: 1.0 },
    });

    const result = reporter.generateAll();
    assert.equal(result.summary.goStatus, 'GO');
    assert.equal(result.summary.totalScreenshots, 1);
    assert.equal(result.summary.automaticFailures, 0);

    assert.ok(existsSync(join(dir, 'summary.json')));
    assert.ok(existsSync(join(dir, 'review.json')));
    assert.ok(existsSync(join(dir, 'junit.xml')));
    assert.ok(existsSync(join(dir, 'report.html')));

    const html = readFileSync(join(dir, 'report.html'), 'utf8');
    assert.ok(html.includes('Checkscreenshots Visual Review'));
    assert.ok(html.includes('home_populated_default_1280'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('computes NO_GO when there are automatic failures or unreviewed cases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reporter-nogo-test-'));

  try {
    const reporter = new VisualQAReporter({
      outDir: dir,
      runId: 'run-test-456',
      candidateCommit: 'abcdef123',
      referenceCommit: '987654321',
    });

    reporter.addCase({
      caseId: 'address_populated_default_1280',
      routeId: 'address',
      scenarioId: 'default',
      browser: 'chromium',
      viewport: '1280',
      theme: 'default',
      status: 'fail',
      failureReason: 'Pixel diff exceeded threshold',
      diffMetrics: { changedPixels: 450, changedRatio: 0.02, ssim: 0.98 },
    });

    const result = reporter.generateAll();
    assert.equal(result.summary.goStatus, 'NO_GO');
    assert.equal(result.summary.automaticFailures, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
