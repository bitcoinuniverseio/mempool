import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

/**
 * Standard PNG Signature Bytes.
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Validate a PNG buffer.
 * Rejects zero-byte, corrupt, transparent-only, blank, or near-uniform images.
 */
export function validatePng(buffer, options = {}) {
  if (!buffer || buffer.length === 0) {
    throw new Error('Image buffer is empty or zero-byte');
  }

  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Invalid image: does not match PNG signature');
  }

  let png;
  try {
    png = PNG.sync.read(buffer);
  } catch (err) {
    throw new Error(`Corrupt PNG data: ${err.message}`);
  }

  const { width, height, data } = png;
  if (width === 0 || height === 0) {
    throw new Error('PNG dimensions cannot be zero');
  }

  // Check blank, transparent, or uniform
  let nonZeroAlpha = 0;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  const totalPixels = width * height;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a > 0) nonZeroAlpha++;
    rSum += r;
    gSum += g;
    bSum += b;
  }

  if (nonZeroAlpha === 0 && !options.allowTransparent) {
    throw new Error('Image is completely transparent');
  }

  const rMean = rSum / totalPixels;
  const gMean = gSum / totalPixels;
  const bMean = bSum / totalPixels;

  let variance = 0;
  for (let i = 0; i < data.length; i += 4) {
    const rDiff = data[i] - rMean;
    const gDiff = data[i + 1] - gMean;
    const bDiff = data[i + 2] - bMean;
    variance += (rDiff * rDiff + gDiff * gDiff + bDiff * bDiff) / 3;
  }
  const stdDev = Math.sqrt(variance / totalPixels);

  if (stdDev < 0.5 && !options.allowUniform) {
    throw new Error(`Image is blank or near-uniform (standard deviation: ${stdDev.toFixed(2)})`);
  }

  return { width, height, png };
}

/**
 * Calculate SSIM (Structural Similarity Index) between two image buffers.
 */
export function calculateSsim(img1Data, img2Data, width, height) {
  const K1 = 0.01;
  const K2 = 0.03;
  const L = 255;
  const C1 = (K1 * L) ** 2;
  const C2 = (K2 * L) ** 2;

  let mean1 = 0;
  let mean2 = 0;
  const totalPixels = width * height;

  // Convert to grayscale luminance
  const l1 = new Float32Array(totalPixels);
  const l2 = new Float32Array(totalPixels);

  for (let i = 0, p = 0; i < img1Data.length; i += 4, p++) {
    l1[p] = 0.299 * img1Data[i] + 0.587 * img1Data[i + 1] + 0.114 * img1Data[i + 2];
    l2[p] = 0.299 * img2Data[i] + 0.587 * img2Data[i + 1] + 0.114 * img2Data[i + 2];
    mean1 += l1[p];
    mean2 += l2[p];
  }

  mean1 /= totalPixels;
  mean2 /= totalPixels;

  let var1 = 0;
  let var2 = 0;
  let covar = 0;

  for (let p = 0; p < totalPixels; p++) {
    const d1 = l1[p] - mean1;
    const d2 = l2[p] - mean2;
    var1 += d1 * d1;
    var2 += d2 * d2;
    covar += d1 * d2;
  }

  var1 /= totalPixels;
  var2 /= totalPixels;
  covar /= totalPixels;

  const numerator = (2 * mean1 * mean2 + C1) * (2 * covar + C2);
  const denominator = (mean1 * mean1 + mean2 * mean2 + C1) * (var1 + var2 + C2);

  return denominator === 0 ? 1.0 : Math.max(0, Math.min(1.0, numerator / denominator));
}

/**
 * Compares two PNG images, generating diff and overlay images, pixel metrics,
 * and SSIM perceptual score.
 */
export function compareImages(expectedBuffer, candidateBuffer, options = {}) {
  const expectedInfo = validatePng(expectedBuffer, options);
  const candidateInfo = validatePng(candidateBuffer, options);

  if (expectedInfo.width !== candidateInfo.width || expectedInfo.height !== candidateInfo.height) {
    throw new Error(
      `Image dimension mismatch: expected ${expectedInfo.width}x${expectedInfo.height} but got ${candidateInfo.width}x${candidateInfo.height}`
    );
  }

  const { width, height } = expectedInfo;
  const totalPixels = width * height;

  const diffPng = new PNG({ width, height });
  const overlayPng = new PNG({ width, height });

  // Apply active masks if provided
  const now = options.now ? new Date(options.now) : new Date();
  const activeMasks = (options.masks || []).filter((mask) => {
    if (mask.expiresAt && new Date(mask.expiresAt) <= now) {
      throw new Error(`Visual mask '${mask.name || mask.selector}' has expired at ${mask.expiresAt}`);
    }
    return true;
  });

  const img1Data = Buffer.from(expectedInfo.png.data);
  const img2Data = Buffer.from(candidateInfo.png.data);

  // Mask out regions if specified
  for (const mask of activeMasks) {
    if (mask.rect) {
      const { x, y, w, h } = mask.rect;
      for (let row = y; row < y + h && row < height; row++) {
        for (let col = x; col < x + w && col < width; col++) {
          const idx = (row * width + col) * 4;
          img1Data[idx] = 0; img1Data[idx + 1] = 0; img1Data[idx + 2] = 0;
          img2Data[idx] = 0; img2Data[idx + 1] = 0; img2Data[idx + 2] = 0;
        }
      }
    }
  }

  const pixelmatchThreshold = options.threshold ?? 0.1;
  const changedPixelCount = pixelmatch(
    img1Data,
    img2Data,
    diffPng.data,
    width,
    height,
    { threshold: pixelmatchThreshold }
  );

  const changedPixelRatio = changedPixelCount / totalPixels;

  // Generate 50/50 overlay
  for (let i = 0; i < img1Data.length; i += 4) {
    overlayPng.data[i] = Math.round((img1Data[i] + img2Data[i]) / 2);
    overlayPng.data[i + 1] = Math.round((img1Data[i + 1] + img2Data[i + 1]) / 2);
    overlayPng.data[i + 2] = Math.round((img1Data[i + 2] + img2Data[i + 2]) / 2);
    overlayPng.data[i + 3] = 255;
  }

  // Calculate channel deltas
  let maxChannelDelta = 0;
  let totalChannelDelta = 0;

  for (let i = 0; i < img1Data.length; i += 4) {
    const dr = Math.abs(img1Data[i] - img2Data[i]);
    const dg = Math.abs(img1Data[i + 1] - img2Data[i + 1]);
    const db = Math.abs(img1Data[i + 2] - img2Data[i + 2]);
    const localMax = Math.max(dr, dg, db);
    if (localMax > maxChannelDelta) maxChannelDelta = localMax;
    totalChannelDelta += dr + dg + db;
  }
  const meanChannelDelta = totalChannelDelta / (totalPixels * 3);

  // Calculate SSIM
  const ssim = calculateSsim(img1Data, img2Data, width, height);

  // Evaluate against strict limits
  const isCanvasOrWebgl = Boolean(options.isCanvas);
  const maxAllowedRatio = isCanvasOrWebgl ? 0.005 : 0.0005; // 0.5% vs 0.05%
  const minRequiredSsim = isCanvasOrWebgl ? 0.990 : 0.998;

  const passed = changedPixelRatio <= maxAllowedRatio && ssim >= minRequiredSsim;

  return {
    passed,
    width,
    height,
    totalPixels,
    changedPixelCount,
    changedPixelRatio,
    maxChannelDelta,
    meanChannelDelta,
    ssim,
    maxAllowedRatio,
    minRequiredSsim,
    diffBuffer: PNG.sync.write(diffPng),
    overlayBuffer: PNG.sync.write(overlayPng),
  };
}

/**
 * File path or buffer wrapper for compareImages with disk artifact writing.
 */
export function comparePngs(expected, candidate, options = {}) {
  const buf1 = typeof expected === 'string' ? readFileSync(expected) : expected;
  const buf2 = typeof candidate === 'string' ? readFileSync(candidate) : candidate;
  const result = compareImages(buf1, buf2, options);

  if (options.outDiffPath && result.diffBuffer) {
    writeFileSync(options.outDiffPath, result.diffBuffer);
  }
  if (options.outOverlayPath && result.overlayBuffer) {
    writeFileSync(options.outOverlayPath, result.overlayBuffer);
  }

  return {
    ...result,
    changedPixels: result.changedPixelCount,
    changedRatio: result.changedPixelRatio,
  };
}
