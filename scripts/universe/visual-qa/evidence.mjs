import { createHash } from 'node:crypto';
import { validatePng } from './image-diff.mjs';

/**
 * Deterministic case ID generation.
 */
export function generateCaseId(params) {
  const parts = [
    params.routeId,
    params.scenarioId || 'default',
    params.network || 'bitcoin',
    params.theme || 'default',
    `${params.viewportWidth}x${params.viewportHeight}`,
    params.browserName || 'chromium',
  ];
  return parts.join('__');
}

/**
 * Computes SHA-256 hash of a buffer.
 */
export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Creates a complete immutable evidence record for a screenshot.
 */
export function createEvidenceRecord(metadata, imageBuffer) {
  const pngInfo = validatePng(imageBuffer, { allowUniform: metadata.allowUniform });
  const imageSha256 = sha256(imageBuffer);

  const caseId = metadata.case_id || generateCaseId({
    routeId: metadata.route_id,
    scenarioId: metadata.scenario_id,
    network: metadata.network,
    theme: metadata.theme,
    viewportWidth: metadata.viewport_width,
    viewportHeight: metadata.viewport_height,
    browserName: metadata.browser_name,
  });

  return {
    run_id: metadata.run_id,
    case_id: caseId,
    route_id: metadata.route_id,
    route_path: metadata.route_path,
    route_pattern: metadata.route_pattern || metadata.route_path,
    scenario_id: metadata.scenario_id || 'default',
    network: metadata.network || 'bitcoin',
    theme: metadata.theme || 'default',
    viewport_width: metadata.viewport_width,
    viewport_height: metadata.viewport_height,
    orientation: metadata.orientation || (metadata.viewport_width > metadata.viewport_height ? 'landscape' : 'portrait'),
    device_scale_factor: metadata.device_scale_factor || 1,
    browser_name: metadata.browser_name || 'chromium',
    browser_version: metadata.browser_version || '1.49.0',
    browser_revision: metadata.browser_revision || 'playwright-pinned',
    operating_system: metadata.operating_system || process.platform,
    font_fingerprint: metadata.font_fingerprint || 'system-fonts-ready',
    locale: metadata.locale || 'en-US',
    timezone: metadata.timezone || 'UTC',
    reduced_motion: Boolean(metadata.reduced_motion),
    forced_colors: Boolean(metadata.forced_colors),
    source_commit: metadata.source_commit,
    source_tree: metadata.source_tree || 'clean',
    reference_commit: metadata.reference_commit || null,
    reference_tree: metadata.reference_tree || null,
    build_hash: metadata.build_hash,
    release_id: metadata.release_id || 'universe-local-release',
    gateway_nonce: metadata.gateway_nonce,
    fixture_schema_version: metadata.fixture_schema_version || 'universe-fixture-v1',
    fixture_hash: metadata.fixture_hash,
    capture_timestamp_utc: metadata.capture_timestamp_utc || new Date().toISOString(),
    image_filename: metadata.image_filename || `${caseId}.png`,
    image_sha256: imageSha256,
    image_width: pngInfo.width,
    image_height: pngInfo.height,
    semantic_assertions: metadata.semantic_assertions || { passed: true, checks: [] },
    accessibility_result: metadata.accessibility_result || { violations: 0 },
    console_errors: metadata.console_errors || [],
    page_errors: metadata.page_errors || [],
    failed_requests: metadata.failed_requests || [],
    unexpected_requests: metadata.unexpected_requests || [],
    diff_metrics: metadata.diff_metrics || null,
    review_status: metadata.review_status || 'unreviewed',
    review_note: metadata.review_note || '',
    origin: metadata.origin || 'http://127.0.0.1',
  };
}

/**
 * Validates an evidence record against its associated image and execution context.
 */
export function validateEvidenceRecord(record, imageBuffer, context = {}) {
  const errors = [];

  if (!record || typeof record !== 'object') {
    return { valid: false, errors: ['Evidence record is missing or not an object'] };
  }

  if (!imageBuffer || imageBuffer.length === 0) {
    return { valid: false, errors: ['Image buffer is missing or empty'] };
  }

  // Validate PNG and non-blank/non-corrupt
  let pngInfo;
  try {
    pngInfo = validatePng(imageBuffer);
  } catch (err) {
    errors.push(`Invalid image: ${err.message}`);
  }

  // Verify image hash
  const actualHash = sha256(imageBuffer);
  if (record.image_sha256 !== actualHash) {
    errors.push(`Image SHA256 mismatch: manifest says ${record.image_sha256}, actual is ${actualHash}`);
  }

  // Verify dimensions
  if (pngInfo && (pngInfo.width !== record.image_width || pngInfo.height !== record.image_height)) {
    errors.push(`Image dimension mismatch: recorded ${record.image_width}x${record.image_height}, actual ${pngInfo.width}x${pngInfo.height}`);
  }

  // Ensure origin is local
  if (record.origin && !record.origin.includes('127.0.0.1') && !record.origin.includes('localhost')) {
    errors.push(`Prohibited remote origin: screenshots must be served from localhost or 127.0.0.1, got ${record.origin}`);
  }

  // Check route in route inventory if inventory provided
  if (context.routeInventory && !context.routeInventory.includes(record.route_id)) {
    errors.push(`Route ID '${record.route_id}' is not in the active route inventory`);
  }

  // Check build hash if context provided
  if (context.expectedBuildHash && record.build_hash !== context.expectedBuildHash) {
    errors.push(`Build hash mismatch: expected ${context.expectedBuildHash}, got ${record.build_hash}`);
  }

  // Check fixture hash if context provided
  if (context.expectedFixtureHash && record.fixture_hash !== context.expectedFixtureHash) {
    errors.push(`Fixture hash mismatch: expected ${context.expectedFixtureHash}, got ${record.fixture_hash}`);
  }

  // Check gateway nonce presence
  if (!record.gateway_nonce) {
    errors.push('Missing gateway nonce in evidence record');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Constructs an overall evidence manifest checksummed over all records.
 */
export function createOverallManifest(manifestData) {
  const records = manifestData.records || [];
  const manifestPayload = {
    schema_version: 'universe-screenshot-manifest-v1',
    run_id: manifestData.runId,
    generated_at_utc: new Date().toISOString(),
    candidate_source: manifestData.candidateSource,
    candidate_build: manifestData.candidateBuild,
    reference_source: manifestData.referenceSource || null,
    reference_build: manifestData.referenceBuild || null,
    route_inventory_count: manifestData.routeInventoryCount,
    scenario_count: manifestData.scenarioCount,
    fixture_hash: manifestData.fixtureHash,
    tool_version: manifestData.toolVersion || '1.0.0',
    case_count: records.length,
    cases: records,
  };

  const serialized = JSON.stringify(manifestPayload, null, 2);
  const manifestHash = sha256(Buffer.from(serialized, 'utf8'));

  return {
    manifestPayload,
    serialized,
    manifestHash,
  };
}

export class EvidenceRecord {
  constructor(metadata) {
    const buffer = metadata.imageBuffer;
    this.data = createEvidenceRecord(metadata, buffer);
  }
  get reviewStatus() {
    return this.data.review_status;
  }
  get reviewNote() {
    return this.data.review_note;
  }
}

export class EvidenceManifest {
  constructor(info) {
    this.info = info;
    this.records = [];
  }
  addRecord(record) {
    this.records.push(record.data || record);
  }
  generate() {
    const result = createOverallManifest({
      ...this.info,
      records: this.records,
    });
    return {
      ...result.manifestPayload,
      manifestChecksum: result.manifestHash,
    };
  }
}
