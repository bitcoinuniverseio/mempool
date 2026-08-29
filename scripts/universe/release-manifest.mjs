#!/usr/bin/env node
/**
 * What a release is, written down once, and checked against what is serving.
 *
 * A deployment here is three components behind one origin, and each publishes
 * its own commit: the frontend in `/resources/config.js`, the explorer backend
 * on `/api/v1/backend-info`, and the protocol overlay in the `release.sha` of
 * every chain capability document. Nothing recorded what a release expected
 * those three to be, so nothing could tell a coherent deployment from an
 * origin serving a frontend from one release, a backend from another, and an
 * overlay that could not name itself at all. Every one of those has happened.
 *
 * The manifest is generated from the commit being built and travels inside the
 * artifact. `verify` reads it and holds a live origin to it.
 *
 * Deliberately, the overlay commit is not pinned. The overlay is built from a
 * different repository on its own release train, and a manifest that pinned it
 * would either be wrong every time that train moved or would couple two
 * releases that are not coupled. What this pins is what the overlay has to
 * satisfy: the contract versions this frontend reads, and that it can name
 * itself at all. The commit it reports is recorded rather than required.
 *
 * Usage:
 *   release-manifest.mjs emit --commit=<sha> --out=<path> [--built-at=<iso>]
 *   release-manifest.mjs verify --manifest=<path> --origin=<url>
 */
import { readFileSync, writeFileSync } from 'node:fs';

export const RELEASE_MANIFEST_SCHEMA = 'universe-release-manifest-v1';

/**
 * The contracts this frontend reads, by the version string each document
 * declares. A deployment whose overlay answers a different one renders pages
 * against a shape nobody tested, which is a fault that looks like missing data
 * rather than like a version mismatch.
 */
export const REQUIRED_CONTRACTS = {
  chainCapability: 'universe-chain-capability-v1',
};

const COMMIT_SHA = /^[0-9a-f]{7,64}$/;

/**
 * The three components this artifact carries, all built from one commit.
 *
 * Stating that they are the same commit is the point. It is what makes a
 * frontend and a backend reporting different builds a detectable fault rather
 * than an open question.
 */
export function buildManifest({ commit, builtAt }) {
  if (!COMMIT_SHA.test(String(commit ?? ''))) {
    throw new Error(`release manifest needs a commit, got ${JSON.stringify(commit ?? null)}`);
  }
  return {
    schemaVersion: RELEASE_MANIFEST_SCHEMA,
    commit,
    shortCommit: commit.slice(0, 9),
    builtAt,
    components: {
      frontend: { commit, publishedAt: '/resources/config.js' },
      explorerBackend: { commit, publishedAt: '/api/v1/backend-info' },
      gateway: { commit, publishedAt: null },
    },
    // Not pinned, for the reason at the top of this file. Recorded at cutover.
    overlay: { commit: null, publishedAt: '/api/v1/chains' },
    requires: { ...REQUIRED_CONTRACTS },
  };
}

/**
 * Holds observed component identities to a manifest.
 *
 * Pure, so the cases it exists for can be tested without an origin. The caller
 * reads the three published values; this decides whether they are a release.
 */
export function verifyManifest(manifest, observed) {
  const failures = [];
  const notes = [];

  if (!manifest || manifest.schemaVersion !== RELEASE_MANIFEST_SCHEMA) {
    failures.push(
      `the release manifest is missing or declares ${JSON.stringify(manifest?.schemaVersion ?? null)}, not ${RELEASE_MANIFEST_SCHEMA}`,
    );
    return { failures, notes };
  }
  const expected = manifest.shortCommit;
  if (!COMMIT_SHA.test(String(expected ?? ''))) {
    failures.push(`the release manifest names no commit`);
    return { failures, notes };
  }

  const frontend = observed.frontendCommit;
  if (!frontend) {
    failures.push('the origin publishes no frontend commit');
  } else if (!expected.startsWith(frontend) && !frontend.startsWith(expected)) {
    failures.push(`the origin serves frontend ${frontend}, and this release is ${expected}`);
  } else {
    notes.push(`frontend ${frontend}`);
  }

  const backend = observed.backendCommit;
  if (!backend) {
    failures.push('the origin publishes no explorer backend commit');
  } else if (!expected.startsWith(backend) && !backend.startsWith(expected)) {
    failures.push(`the origin runs explorer backend ${backend}, and this release is ${expected}`);
  } else {
    notes.push(`explorer backend ${backend}`);
  }

  // The overlay is not pinned, so what is checked is that it can name itself
  // and that it answers the contract this frontend reads.
  const overlay = observed.overlayRelease;
  if (!overlay || overlay === 'development' || !COMMIT_SHA.test(String(overlay))) {
    failures.push(
      `the overlay names its release as ${JSON.stringify(overlay ?? null)}, which is not a commit`,
    );
  } else {
    notes.push(`overlay ${overlay}, which this release does not pin`);
  }

  const contract = observed.chainCapabilitySchema;
  if (contract !== manifest.requires?.chainCapability) {
    failures.push(
      `the chain documents declare ${JSON.stringify(contract ?? null)} and this release reads ${JSON.stringify(manifest.requires?.chainCapability ?? null)}`,
    );
  } else {
    notes.push(`chain capability contract ${contract}`);
  }

  if (observed.overlayReleases && new Set(observed.overlayReleases).size > 1) {
    failures.push(
      `the chain documents name ${new Set(observed.overlayReleases).size} different overlay releases, so more than one process is answering`,
    );
  }

  return { failures, notes };
}

async function readObserved(origin) {
  const base = origin.replace(/\/$/, '');
  const config = await fetch(`${base}/resources/config.js`, {
    signal: AbortSignal.timeout(20_000),
  }).then((response) => response.text());
  const info = await fetch(`${base}/api/v1/backend-info`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
    .then((response) => response.json())
    .catch(() => null);
  const chains = await fetch(`${base}/api/v1/chains`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
    .then((response) => response.json())
    .catch(() => null);

  const releases = Array.isArray(chains)
    ? chains.map((entry) => entry?.release?.sha).filter((sha) => typeof sha === 'string')
    : [];
  return {
    frontendCommit: config.match(/GIT_COMMIT_HASH\s*=\s*'([^']+)'/)?.[1] ?? null,
    backendCommit: info?.gitCommit ?? null,
    overlayRelease: releases[0] ?? null,
    overlayReleases: releases,
    chainCapabilitySchema: Array.isArray(chains) ? (chains[0]?.schemaVersion ?? null) : null,
  };
}

function argument(name) {
  const found = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : null;
}

async function main() {
  const command = process.argv[2];
  if (command === 'emit') {
    const manifest = buildManifest({
      commit: argument('commit'),
      builtAt: argument('built-at') ?? new Date().toISOString(),
    });
    const out = argument('out');
    const rendered = `${JSON.stringify(manifest, null, 2)}\n`;
    if (out) {
      writeFileSync(out, rendered, 'utf8');
      console.log(`Release manifest for ${manifest.shortCommit} written to ${out}`);
    } else {
      process.stdout.write(rendered);
    }
    return;
  }

  if (command === 'verify') {
    const path = argument('manifest');
    const origin = argument('origin');
    if (!path || !origin) {
      throw new Error('verify needs --manifest=<path> and --origin=<url>');
    }
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    const observed = await readObserved(origin);
    const { failures, notes } = verifyManifest(manifest, observed);
    console.log(`Release manifest ${manifest.shortCommit ?? 'unknown'} against ${origin}`);
    for (const note of notes) console.log(`  ok    ${note}`);
    for (const failure of failures) console.error(`  FAIL  ${failure}`);
    if (failures.length) {
      console.error(`\n${failures.length} component identity check(s) failed`);
      process.exit(1);
    }
    console.log('\nEvery component identity matches the release manifest');
    return;
  }

  throw new Error('usage: release-manifest.mjs {emit|verify} ...');
}

if (process.argv[1]?.endsWith('release-manifest.mjs')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
