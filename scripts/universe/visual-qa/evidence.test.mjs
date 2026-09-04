import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import {
  generateCaseId,
  createEvidenceRecord,
  validateEvidenceRecord,
  createOverallManifest,
  sha256,
} from './evidence.mjs';

function createSamplePng(width, height, fillPattern) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) * 4;
      const [r, g, b, a] = fillPattern(x, y);
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = a;
    }
  }
  return PNG.sync.write(png);
}

test('deterministic case ID generation format', () => {
  const caseId = generateCaseId({
    routeId: 'policy-lab',
    scenarioId: 'default',
    network: 'bitcoin',
    theme: 'dark',
    viewportWidth: 1280,
    viewportHeight: 900,
    browserName: 'chromium',
  });
  assert.equal(caseId, 'policy-lab__default__bitcoin__dark__1280x900__chromium');
});

test('valid evidence record creation and validation passes', () => {
  const samplePng = createSamplePng(100, 50, (x, y) => [(x * 3) % 255, (y * 5) % 255, 120, 255]);
  const metadata = {
    run_id: 'run-12345',
    route_id: 'home',
    route_path: '/',
    source_commit: 'fade747b1',
    build_hash: 'build-abc',
    gateway_nonce: 'nonce-xyz',
    fixture_hash: 'fix-123',
    viewport_width: 100,
    viewport_height: 50,
    browser_name: 'chromium',
    origin: 'http://127.0.0.1:8099',
  };

  const record = createEvidenceRecord(metadata, samplePng);
  assert.equal(record.route_id, 'home');
  assert.equal(record.image_width, 100);
  assert.equal(record.image_height, 50);
  assert.ok(record.image_sha256);

  const validation = validateEvidenceRecord(record, samplePng, {
    routeInventory: ['home', 'blocks'],
    expectedBuildHash: 'build-abc',
    expectedFixtureHash: 'fix-123',
  });
  assert.equal(validation.valid, true);
  assert.equal(validation.errors.length, 0);
});

test('negative test: arbitrary HELLO-style image without valid provenance is rejected', () => {
  // Generate a small synthetic 400x100 image with text pattern
  const arbitraryImage = createSamplePng(400, 100, (x, y) => {
    // Generate synthetic patterned stripes resembling unverified image
    return [x % 250, y % 200, 150, 255];
  });

  // Attempt 1: Validate with missing sidecar record
  const res1 = validateEvidenceRecord(null, arbitraryImage);
  assert.equal(res1.valid, false);
  assert.ok(res1.errors.some((e) => e.includes('missing')));

  // Attempt 2: Validate with forged or missing metadata
  const forgedRecord = {
    image_sha256: 'deadbeef00000000000000000000000000000000000000000000000000000000',
    route_id: 'unknown-random-route',
    origin: 'https://external-uncontrolled-site.com',
    gateway_nonce: null,
  };
  const res2 = validateEvidenceRecord(forgedRecord, arbitraryImage, {
    routeInventory: ['home', 'blocks'],
  });
  assert.equal(res2.valid, false);
  assert.ok(res2.errors.some((e) => e.includes('mismatch')));
  assert.ok(res2.errors.some((e) => e.includes('remote origin')));
  assert.ok(res2.errors.some((e) => e.includes('not in the active route inventory')));
});

test('negative test: remote runner or external origin is rejected', () => {
  const samplePng = createSamplePng(60, 40, (x, y) => [(x * 7) % 255, (y * 7) % 255, 80, 255]);
  const metadata = {
    route_id: 'blocks',
    gateway_nonce: 'nonce-1',
    origin: 'https://github-actions-runner-farm.net',
  };
  const record = createEvidenceRecord(metadata, samplePng);
  const res = validateEvidenceRecord(record, samplePng);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes('Prohibited remote origin')));
});

test('overall manifest connects all records and generates valid checksum', () => {
  const samplePng = createSamplePng(60, 40, (x, y) => [(x * 7) % 255, (y * 7) % 255, 80, 255]);
  const record = createEvidenceRecord({
    route_id: 'home',
    gateway_nonce: 'nonce-1',
    source_commit: 'fade747b1',
    build_hash: 'build-1',
    fixture_hash: 'fix-1',
    viewport_width: 60,
    viewport_height: 40,
  }, samplePng);

  const manifest = createOverallManifest({
    runId: 'run-999',
    candidateSource: 'fade747b1',
    candidateBuild: 'build-1',
    routeInventoryCount: 1,
    scenarioCount: 1,
    fixtureHash: 'fix-1',
    records: [record],
  });

  assert.equal(manifest.manifestPayload.case_count, 1);
  assert.ok(manifest.manifestHash.length === 64);
  assert.equal(sha256(Buffer.from(manifest.serialized, 'utf8')), manifest.manifestHash);
});
