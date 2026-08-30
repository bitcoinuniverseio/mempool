/**
 * Proof that the component identity check can fail.
 *
 * Each case is a way the three components behind this origin have drifted
 * apart, or could. They are worth writing down because none of them looks like
 * an outage: every one of these deployments serves pages, answers the API, and
 * is wrong about what it is.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildManifest, verifyManifest } from './release-manifest.mjs';

const COMMIT = 'bea93c1ec7f608313e6ac1d0b0ba9a29e2a7c2f1';
const MANIFEST = buildManifest({ commit: COMMIT, builtAt: '2026-08-29T22:00:00.000Z' });

function observed(overrides = {}) {
  return {
    frontendCommit: 'bea93c1ec',
    backendCommit: 'bea93c1ec',
    overlayRelease: 'a06f8ed1b',
    overlayReleases: ['a06f8ed1b', 'a06f8ed1b', 'a06f8ed1b'],
    chainCapabilitySchema: 'universe-chain-capability-v1',
    ...overrides,
  };
}

function said(result, needle) {
  return result.failures.some((failure) => failure.includes(needle));
}

test('a coherent deployment passes', () => {
  const result = verifyManifest(MANIFEST, observed());
  assert.deepEqual(result.failures, []);
  assert.equal(result.notes.length, 4);
});

test('the manifest states one commit for all three components it carries', () => {
  assert.equal(MANIFEST.components.frontend.commit, COMMIT);
  assert.equal(MANIFEST.components.explorerBackend.commit, COMMIT);
  assert.equal(MANIFEST.components.gateway.commit, COMMIT);
  assert.equal(MANIFEST.shortCommit, 'bea93c1ec');
});

test('the overlay commit is recorded and not pinned', () => {
  // Pinning it would couple two release trains that are not coupled. What the
  // release requires of the overlay is the contract and an identity.
  assert.equal(MANIFEST.overlay.commit, null);
  assert.deepEqual(verifyManifest(MANIFEST, observed({ overlayRelease: 'ffffff1', overlayReleases: ['ffffff1'] })).failures, []);
});

test('an origin serving a frontend from another release is detected', () => {
  // The exact fault this exists for: 43 commits of work on develop, an origin
  // serving the release before it, and every check green.
  assert.ok(said(verifyManifest(MANIFEST, observed({ frontendCommit: '521a091' })), 'serves frontend 521a091'));
});

test('a backend from another release is detected', () => {
  assert.ok(
    said(verifyManifest(MANIFEST, observed({ backendCommit: '521a091' })), 'explorer backend 521a091'),
  );
});

test('a component that publishes nothing is detected', () => {
  assert.ok(said(verifyManifest(MANIFEST, observed({ frontendCommit: null })), 'no frontend commit'));
  assert.ok(said(verifyManifest(MANIFEST, observed({ backendCommit: null })), 'no explorer backend commit'));
});

test('an overlay that cannot name itself is detected', () => {
  assert.ok(
    said(verifyManifest(MANIFEST, observed({ overlayRelease: 'development' })), 'which is not a commit'),
  );
  assert.ok(said(verifyManifest(MANIFEST, observed({ overlayRelease: null })), 'which is not a commit'));
  assert.ok(said(verifyManifest(MANIFEST, observed({ overlayRelease: 'HEAD' })), 'which is not a commit'));
});

test('two overlay processes answering one origin are detected', () => {
  const result = verifyManifest(
    MANIFEST,
    observed({ overlayReleases: ['a06f8ed1b', 'a06f8ed1b', 'c0e28dc6f'] }),
  );
  assert.ok(said(result, 'more than one process is answering'));
});

test('an overlay answering a different contract than this release reads is detected', () => {
  const result = verifyManifest(
    MANIFEST,
    observed({ chainCapabilitySchema: 'universe-chain-capability-v2' }),
  );
  assert.ok(said(result, 'universe-chain-capability-v2'));
});

test('a missing or foreign manifest is detected rather than assumed good', () => {
  assert.ok(said(verifyManifest(null, observed()), 'missing or declares'));
  assert.ok(said(verifyManifest({ schemaVersion: 'something-else' }, observed()), 'missing or declares'));
  assert.ok(
    said(
      verifyManifest({ schemaVersion: 'universe-release-manifest-v1' }, observed()),
      'names no commit',
    ),
  );
});

test('a manifest cannot be built without a commit', () => {
  assert.throws(() => buildManifest({ commit: 'development' }), /needs a commit/);
  assert.throws(() => buildManifest({ commit: '' }), /needs a commit/);
});
