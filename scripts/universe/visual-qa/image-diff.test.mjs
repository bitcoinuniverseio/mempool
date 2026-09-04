import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { validatePng, calculateSsim, compareImages } from './image-diff.mjs';

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

test('rejects zero-byte buffer', () => {
  assert.throws(() => validatePng(Buffer.alloc(0)), /empty or zero-byte/);
});

test('rejects non-PNG data', () => {
  assert.throws(() => validatePng(Buffer.from('HELLO_NON_PNG')), /does not match PNG signature/);
});

test('rejects uniform/blank image unless explicitly allowed', () => {
  const blankPng = createSamplePng(50, 50, () => [255, 255, 255, 255]);
  assert.throws(() => validatePng(blankPng), /blank or near-uniform/);

  // Allowed when explicit flag is on
  const validated = validatePng(blankPng, { allowUniform: true });
  assert.equal(validated.width, 50);
});

test('dimension mismatch between expected and candidate is rejected', () => {
  const img1 = createSamplePng(50, 50, (x, y) => [(x * 5) % 255, (y * 5) % 255, 100, 255]);
  const img2 = createSamplePng(60, 50, (x, y) => [(x * 5) % 255, (y * 5) % 255, 100, 255]);
  assert.throws(() => compareImages(img1, img2), /Image dimension mismatch/);
});

test('identical images yield zero changed pixels and SSIM of 1.0', () => {
  const pattern = (x, y) => [(x * 13) % 255, (y * 17) % 255, (x + y) % 255, 255];
  const img1 = createSamplePng(40, 40, pattern);
  const img2 = createSamplePng(40, 40, pattern);

  const result = compareImages(img1, img2);
  assert.equal(result.passed, true);
  assert.equal(result.changedPixelCount, 0);
  assert.equal(result.changedPixelRatio, 0);
  assert.equal(result.maxChannelDelta, 0);
  assert.ok(result.ssim >= 0.9999);
});

test('detects meaningful pixel change and computes diff and overlay', () => {
  const img1 = createSamplePng(50, 50, (x, y) => [(x * 5) % 255, (y * 5) % 255, 100, 255]);
  const img2 = createSamplePng(50, 50, (x, y) => {
    // Inject a modified square in the center
    if (x >= 20 && x < 30 && y >= 20 && y < 30) {
      return [255, 0, 0, 255];
    }
    return [(x * 5) % 255, (y * 5) % 255, 100, 255];
  });

  const result = compareImages(img1, img2);
  assert.ok(result.changedPixelCount > 0);
  assert.ok(result.diffBuffer.length > 0);
  assert.ok(result.overlayBuffer.length > 0);
  assert.ok(result.ssim < 1.0);
});

test('expired visual mask throws and fails closed', () => {
  const img1 = createSamplePng(40, 40, (x, y) => [(x * 10) % 255, (y * 10) % 255, 50, 255]);
  const img2 = createSamplePng(40, 40, (x, y) => [(x * 10) % 255, (y * 10) % 255, 50, 255]);

  const expiredMasks = [
    {
      selector: '.unstable-widget',
      expiresAt: '2026-01-01T00:00:00Z',
      rect: { x: 0, y: 0, w: 10, h: 10 },
    },
  ];

  assert.throws(
    () => compareImages(img1, img2, { masks: expiredMasks, now: '2026-09-01T00:00:00Z' }),
    /expired/
  );
});
