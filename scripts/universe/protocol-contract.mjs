#!/usr/bin/env node
/*
 * Outstanding: WP08 of the Dogecoin mainnet readiness plan. The recorded
 * manifest must only be regenerated from a qualified source, after the
 * acceptance rows in the handoff bundle pass.
 */
/**
 * The protocol roster gate.
 *
 * The roster is owned by backend-apis: a TypeScript registry that
 * `/api/v1/universe/protocols` serves and that
 * `contracts/universe-explorer-protocols.json` records there. This repository
 * consumes it, so it pins a copy and this gate holds the two together.
 *
 * What it replaced mattered. The old gate rendered a Markdown table from the
 * recorded JSON and compared it against the committed Markdown, so the only
 * thing it could prove was that a file agreed with itself. Two protocols,
 * `dunes` and `zrc20`, were added to the registry and served in production
 * while the recorded roster here still said thirty-six, and every run was
 * green throughout.
 *
 * Three modes:
 *
 *   --record --from <url|file>   pin a manifest and rewrite what is generated
 *                                from it
 *   --check                      the offline gate CI runs on every commit
 *   --against <url|file>         compare the pinned manifest against what a
 *                                deployment actually serves
 *
 * `--check` never reaches the network. It holds the pinned manifest to its
 * schema and its provenance, holds this repository's own surfaces to the
 * pinned roster, and refuses a roster that lost an entry. `--against` is the
 * cross-repository half: it reads the served document and fails on any field
 * of any protocol that differs.
 */

import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const MANIFEST_SCHEMA_VERSION = 'universe-explorer-protocol-manifest-v1';
export const PROTOCOL_SCHEMA_VERSION = 'universe-explorer-protocol-v1';
export const SOURCE_REPOSITORY = 'bitcoinuniverseio/backend-apis';

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

export const PATHS = {
  manifest: path.join(
    REPOSITORY_ROOT,
    'docs',
    'protocols',
    'PROTOCOL-COVERAGE.json',
  ),
  markdown: path.join(
    REPOSITORY_ROOT,
    'docs',
    'protocols',
    'PROTOCOL-COVERAGE.md',
  ),
  roster: path.join(
    REPOSITORY_ROOT,
    'docs',
    'protocols',
    'PROTOCOL-ROSTER.lock',
  ),
  readme: path.join(REPOSITORY_ROOT, 'README.md'),
  protocolCopy: path.join(
    REPOSITORY_ROOT,
    'frontend',
    'src',
    'app',
    'universe',
    'universe-protocol-copy.ts',
  ),
  apiService: path.join(
    REPOSITORY_ROOT,
    'frontend',
    'src',
    'app',
    'universe',
    'universe-api.service.ts',
  ),
};

const READABLE_STATUSES = new Set([
  'VERIFIED READ ONLY',
  'PRODUCTION VERIFIED',
]);
const RELEASE_STATUSES = new Set([
  'PRODUCTION VERIFIED',
  'VERIFIED READ ONLY',
  'BLOCKED',
  'INTENTIONALLY DISABLED',
]);
const COVERAGE_STATES = new Set([
  'complete',
  'partial',
  'positive-only',
  'demand-populated',
  'unknown',
]);
const COMMIT_SHA = /^[0-9a-f]{7,64}$/;
const SHA256 = /^[0-9a-f]{64}$/i;
export const ACCEPTANCE_EVIDENCE_SCHEMA_VERSION =
  'universe-explorer-acceptance-v1';
const TRUSTED_ACCEPTANCE_PRODUCER = 'universe-acceptance-runner-v1';

const README_MARKER_OPEN = '<!-- protocol-coverage:readable -->';
const README_MARKER_CLOSE = '<!-- /protocol-coverage:readable -->';

/** Compares content, not line endings: this tree is checked out with CRLF. */
export const normalise = (text) => text.split('\r\n').join('\n');

export class GateFailure extends Error {}

/** Collects every problem so one run names all of them, not just the first. */
export class Report {
  constructor() {
    this.problems = [];
  }
  fail(message) {
    this.problems.push(message);
  }
  throwIfFailed(headline) {
    if (!this.problems.length) return;
    throw new GateFailure(
      `${headline}\n${this.problems.map((p) => `  - ${p}`).join('\n')}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Manifest shape and provenance
// ---------------------------------------------------------------------------

export function coverageState(coverage) {
  if (coverage === null || coverage === undefined || coverage === '') {
    return 'unknown';
  }
  if (typeof coverage === 'string') return coverage;
  return typeof coverage.state === 'string' ? coverage.state : 'unknown';
}

/**
 * Refuses a roster that cannot be resolved to one entry.
 *
 * A protocol duplicated under incompatible ids, or an alias two entries both
 * claim, makes every lookup answer by table order. The registry refuses to
 * build one; this refuses to record one.
 */
export function assertRosterResolvesUniquely(protocols, report = new Report()) {
  const owner = new Map();
  for (const protocol of protocols) {
    const claims = [protocol?.id, ...(protocol?.aliases ?? [])];
    for (const claim of claims) {
      if (typeof claim !== 'string' || !claim.trim()) {
        report.fail(
          `${protocol?.id ?? '<unnamed>'} claims an empty id or alias.`,
        );
        continue;
      }
      const key = claim.trim().toLowerCase();
      const existing = owner.get(key);
      if (existing && existing !== protocol.id) {
        report.fail(
          `"${key}" is claimed by both ${existing} and ${protocol.id}.`,
        );
      } else if (existing === protocol.id && key !== protocol.id) {
        report.fail(`${protocol.id} repeats the alias "${key}".`);
      }
      owner.set(key, protocol.id);
    }
  }
  return report;
}

/**
 * Holds a manifest to its envelope.
 *
 * A roster with no provenance can only be compared against whatever is being
 * served right now, which is a check that passes the day it is written and
 * says nothing after. Every field here exists so a mismatch names both sides.
 */
/**
 * IMPLEMENTATION-HANDOFF [FE-GATE-04] | all 39 protocols and operation IDs.
 * Reconciled 2026-09-21: --release and releaseGate now exist. Do not create
 * a parallel gate. WP01 completes evidence qualification; WP02 wires it into
 * release; WP03 reconciles the denominator. The requirements below are
 * historical and must be applied to the existing implementation.
 * Verified: this validates shape/status vocabulary; it does not require passing
 * operation evidence. A roster gate PASS is not the requested release GO.
 * Prerequisites: BE acceptance schema plus complete operation inventory.
 * 1. Extend schema validation to reject missing/duplicate operation IDs,
 *    acceptance evidence with mismatched protocol/network/revision, and claimed
 *    complete coverage with unresolved applicable rows or an unknown denominator.
 * 2. Keep roster consistency mode usable during development; add an explicit
 *    release acceptance mode that fails on FAIL/BLOCKED/NOT TESTED and requires
 *    justified exclusions. Do not silently redefine --check as functional tests.
 * 3. Bind evidence to accepted code/config/dependencies; changes invalidate only
 *    affected evidence. Historical readable declarations must not count as passes.
 * 4. Extend protocol-contract.test.mjs with forged complete, absent evidence,
 *    missing operation, wrong-network/revision and fully evidenced fixtures.
 *    Run node --test scripts/universe/protocol-contract.test.mjs and this script
 *    --check. After qualification, use --record --from the accepted manifest,
 *    review generated changes, then --against the deployed owned manifest.
 * Preserve prior WP08 handoff requirements. No generated files are hand-edited.
 */
export function validateManifest(manifest, report = new Report()) {
  if (typeof manifest !== 'object' || manifest === null) {
    report.fail('The manifest is not an object.');
    return report;
  }
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    report.fail(
      `The manifest schema is ${JSON.stringify(manifest.schemaVersion)}; this gate reads ${MANIFEST_SCHEMA_VERSION}.`,
    );
  }
  if (
    typeof manifest.registryVersion !== 'string' ||
    !manifest.registryVersion
  ) {
    report.fail('The manifest carries no registryVersion.');
  }
  if (manifest.sourceRepository !== SOURCE_REPOSITORY) {
    report.fail(
      `The manifest names ${JSON.stringify(manifest.sourceRepository)} as its source; the roster is owned by ${SOURCE_REPOSITORY}.`,
    );
  }
  if (
    typeof manifest.sourceSha !== 'string' ||
    !COMMIT_SHA.test(manifest.sourceSha)
  ) {
    report.fail(
      `The manifest names no commit it was produced from (sourceSha ${JSON.stringify(manifest.sourceSha)}).`,
    );
  }
  if (
    typeof manifest.generatedAt !== 'string' ||
    Number.isNaN(Date.parse(manifest.generatedAt))
  ) {
    report.fail('The manifest carries no readable generatedAt time.');
  }
  if (!Array.isArray(manifest.primaryStrip) || !manifest.primaryStrip.length) {
    report.fail('The manifest carries no primaryStrip.');
  }
  if (!Array.isArray(manifest.protocols) || !manifest.protocols.length) {
    report.fail('The manifest carries no protocols.');
    return report;
  }

  for (const protocol of manifest.protocols) {
    const id = protocol?.id ?? '<unnamed>';
    if (protocol?.schemaVersion !== PROTOCOL_SCHEMA_VERSION) {
      report.fail(
        `${id} carries schema ${JSON.stringify(protocol?.schemaVersion)}.`,
      );
    }
    for (const field of ['id', 'displayName', 'shortName', 'family', 'chain']) {
      if (typeof protocol?.[field] !== 'string' || !protocol[field]) {
        report.fail(`${id} is missing ${field}.`);
      }
    }
    for (const field of [
      'aliases',
      'networks',
      'implementedReadOperations',
      'authorizedReadOperations',
    ]) {
      if (!Array.isArray(protocol?.[field])) {
        report.fail(`${id} is missing the ${field} list.`);
      }
    }
    if (!RELEASE_STATUSES.has(protocol?.releaseStatus)) {
      report.fail(
        `${id} has release status ${JSON.stringify(protocol?.releaseStatus)}.`,
      );
    }
    if (!COVERAGE_STATES.has(coverageState(protocol?.coverage))) {
      report.fail(`${id} has coverage ${JSON.stringify(protocol?.coverage)}.`);
    }
    if (
      READABLE_STATUSES.has(protocol?.releaseStatus) &&
      (typeof protocol?.indexerAuthority !== 'string' ||
        !protocol.indexerAuthority)
    ) {
      report.fail(`${id} is marked readable but names no authority.`);
    }
  }

  assertRosterResolvesUniquely(manifest.protocols, report);
  return report;
}

/** Every id and alias the roster answers to, lowercased. */
export function resolvableNames(protocols) {
  const names = new Map();
  for (const protocol of protocols) {
    names.set(protocol.id.toLowerCase(), protocol);
    for (const alias of protocol.aliases ?? []) {
      names.set(String(alias).toLowerCase(), protocol);
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// Generated documents
// ---------------------------------------------------------------------------

/**
 * Escapes a value so it can never break the table it is written into.
 *
 * The backslash goes first: escaping the pipe alone leaves a value ending in
 * a backslash able to consume the escape and split the row, which is a cell
 * that reads as two. Newlines end a row outright, so they become spaces.
 */
function cell(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ');
}

export function readableProtocols(manifest) {
  return manifest.protocols.filter((p) =>
    READABLE_STATUSES.has(p.releaseStatus),
  );
}

export function renderMarkdown(manifest) {
  const readable = readableProtocols(manifest);
  const rows = manifest.protocols.map(
    (protocol) =>
      `| ${cell(protocol.id)} | ${cell(protocol.family)} | ${cell(protocol.chain)} | ` +
      `${cell(protocol.indexerAuthority ?? 'none')} | ${cell(protocol.releaseStatus)} | ` +
      `${cell(coverageState(protocol.coverage))} | ${cell((protocol.implementedReadOperations ?? []).join(', '))} |`,
  );
  return `# Protocol coverage

The roster is owned by \`${cell(manifest.sourceRepository)}\`, in
\`src/universe-explorer/registry/explorer-protocol-registry.ts\`, and served by
\`/api/v1/universe/protocols\`. This file and \`PROTOCOL-COVERAGE.json\` are the
copy this repository pins. Do not edit rows by hand: record a new manifest with

\`\`\`
node scripts/universe/protocol-contract.mjs --record --from <manifest url or file>
\`\`\`

\`node scripts/universe/protocol-contract.mjs --check\` holds this repository's
own surfaces to the pinned roster, and
\`node scripts/universe/protocol-contract.mjs --against <origin>\` fails when a
deployment serves a roster that differs from it.

Release status semantics: every protocol starts BLOCKED and is upgraded only when
its explorer integration is completed and verified against its Universe authority.
A protocol never silently disappears from this table: \`PROTOCOL-ROSTER.lock\`
records every id that has been published, and the gate fails when one of them
stops appearing.

Pinned from ${cell(manifest.sourceRepository)} at commit ${cell(manifest.sourceSha)},
manifest schema ${cell(manifest.schemaVersion)}, registry version ${cell(manifest.registryVersion)},
recorded ${cell(manifest.generatedAt)}.

${manifest.protocols.length} protocol identities are retained. ${readable.length} carry historical readable declarations; these are not current runtime or E2E passes. Operation descriptors identify implemented public reads and their owned authority routes; configuration and acceptance are separate. The registry is not the complete application operation inventory.

| id | family | chain | authority | historical declaration | coverage | implemented reads |
|---|---|---|---|---|---|---|
${rows.join('\n')}
`;
}

/**
 * The readable list the README publishes.
 *
 * The README said three protocols were readable, backed by Ord, for as long
 * as three Zcash protocols had also been readable. Generating the sentence
 * from the pinned roster is the only version of it that stays true.
 */
export function renderReadmeBlock(manifest) {
  const readable = readableProtocols(manifest);
  const byChain = new Map();
  for (const protocol of readable) {
    if (!byChain.has(protocol.chain)) byChain.set(protocol.chain, []);
    byChain.get(protocol.chain).push(protocol);
  }
  const lines = [...byChain.entries()].map(([chain, protocols]) => {
    const authorities = [
      ...new Set(protocols.map((p) => p.indexerAuthority).filter(Boolean)),
    ];
    const names = protocols.map((p) => `**${p.displayName}**`).join(', ');
    return `- On ${chain}: ${names}, from ${authorities.join(' and ')}.`;
  });
  return [
    README_MARKER_OPEN,
    '',
    `${readable.length} of the ${manifest.protocols.length} protocols carry historical readable declarations (not current E2E acceptance):`,
    '',
    ...lines,
    '',
    README_MARKER_CLOSE,
  ].join('\n');
}

export function replaceReadmeBlock(readme, block) {
  const text = normalise(readme);
  const start = text.indexOf(README_MARKER_OPEN);
  const end = text.indexOf(README_MARKER_CLOSE);
  if (start === -1 || end === -1 || end < start) {
    throw new GateFailure(
      `README.md carries no ${README_MARKER_OPEN} block for the readable protocol list.`,
    );
  }
  return (
    text.slice(0, start) + block + text.slice(end + README_MARKER_CLOSE.length)
  );
}

export function readmeBlockOf(readme) {
  const text = normalise(readme);
  const start = text.indexOf(README_MARKER_OPEN);
  const end = text.indexOf(README_MARKER_CLOSE);
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start, end + README_MARKER_CLOSE.length);
}

// ---------------------------------------------------------------------------
// This repository's own surfaces
// ---------------------------------------------------------------------------

/** The protocol ids `universe-protocol-copy.ts` writes prose for. */
export function protocolCopyIds(source) {
  const start = source.indexOf('const PROTOCOL_COPY');
  if (start === -1) {
    throw new GateFailure(
      'universe-protocol-copy.ts no longer declares PROTOCOL_COPY; the gate cannot read its ids.',
    );
  }
  return [...source.slice(start).matchAll(/^ {2}([a-z0-9_]+): \{/gm)].map(
    (match) => match[1],
  );
}

/** The chain protocol paths the API client will call, by chain. */
export function apiAllowlist(source) {
  const match = source.match(
    /const allowed = chain === '(\w+)'\s*\?\s*\[([^\]]*)\]\s*:\s*\[([^\]]*)\];/,
  );
  if (!match) {
    throw new GateFailure(
      'universe-api.service.ts no longer declares the chain protocol allowlist in a shape the gate can read.',
    );
  }
  const parse = (list) =>
    [...list.matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
  const namedChain = match[1];
  const otherChain = namedChain === 'dogecoin' ? 'zcash' : 'dogecoin';
  return new Map([
    [namedChain, parse(match[2])],
    [otherChain, parse(match[3])],
  ]);
}

/**
 * Holds this repository's surfaces to the pinned roster.
 *
 * Both directions matter. A surface naming a protocol the registry does not
 * carry is a route to something the product does not have; a readable
 * protocol with no route is a capability the product hides.
 */
export function checkSurfaces(manifest, sources, report = new Report()) {
  const names = resolvableNames(manifest.protocols);

  for (const id of protocolCopyIds(sources.protocolCopy)) {
    if (!names.has(id.toLowerCase())) {
      report.fail(
        `universe-protocol-copy.ts writes prose for "${id}", which is not in the registry.`,
      );
    }
  }

  const allowlist = apiAllowlist(sources.apiService);
  for (const [chain, entries] of allowlist) {
    for (const entry of entries) {
      const protocol = names.get(entry.toLowerCase());
      if (!protocol) {
        report.fail(
          `the ${chain} API allowlist calls "${entry}", which is not in the registry.`,
        );
        continue;
      }
      if (protocol.chain !== chain) {
        report.fail(
          `the ${chain} API allowlist calls "${entry}", which the registry places on ${protocol.chain}.`,
        );
      }
    }
    const routed = new Set(
      entries.map((entry) => names.get(entry.toLowerCase())?.id).filter(Boolean),
    );
    for (const protocol of manifest.protocols) {
      if (protocol.chain !== chain) continue;
      if (!READABLE_STATUSES.has(protocol.releaseStatus)) continue;
      if (!routed.has(protocol.id)) {
        report.fail(
          `${protocol.id} is readable on ${chain} but the API allowlist has no path for it.`,
        );
      }
    }
  }

  return report;
}

/**
 * Refuses a roster that quietly lost an entry.
 *
 * The lock is every id that has been published. Removing a protocol is a
 * decision, and a decision leaves a diff: the id has to come out of the lock
 * in the same commit that takes it out of the registry.
 */
export function checkRoster(manifest, lock, report = new Report()) {
  // Normalise first. This tree is checked out with CRLF on Windows, and
  // JavaScript counts a carriage return as a line terminator, so `.` will not
  // cross one and `$` cannot assert an end after one. `/#.*$/` therefore
  // matched nothing on a CRLF checkout and every comment line in this file
  // was read as a protocol id that had gone missing.
  const locked = normalise(lock)
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean);
  const present = new Set(manifest.protocols.map((p) => p.id));
  for (const id of locked) {
    if (!present.has(id)) {
      report.fail(
        `${id} is in PROTOCOL-ROSTER.lock but no longer in the pinned manifest. A protocol may not disappear silently: take it out of the lock in the same commit if that is intended.`,
      );
    }
  }
  const lockedSet = new Set(locked);
  for (const id of present) {
    if (!lockedSet.has(id)) {
      report.fail(
        `${id} is in the pinned manifest but not in PROTOCOL-ROSTER.lock. Record it with --record.`,
      );
    }
  }
  return report;
}

export function renderRoster(manifest) {
  return `# Every protocol id this explorer has published.
# The gate fails when one of these stops appearing in the pinned manifest, so a
# removal has to be a deliberate edit here rather than a quiet absence.
${[...manifest.protocols.map((p) => p.id)].sort().join('\n')}
`;
}

// ---------------------------------------------------------------------------
// Cross-repository comparison
// ---------------------------------------------------------------------------

/** The part of a document that is a claim about the roster. */
export function comparable(document) {
  return {
    schemaVersion: document.schemaVersion,
    registryVersion: document.registryVersion,
    sourceRepository: document.sourceRepository,
    primaryStrip: document.primaryStrip,
    protocols: document.protocols,
  };
}

/**
 * Names every difference between the pinned roster and a served one.
 *
 * Reporting the whole diff rather than the first mismatch is the difference
 * between "the roster moved" and a list of what moved, which is what someone
 * reading a failed release needs.
 */
export function diffManifests(pinned, served, report = new Report()) {
  for (const field of [
    'schemaVersion',
    'registryVersion',
    'sourceRepository',
  ]) {
    if (pinned[field] !== served[field]) {
      report.fail(
        `${field}: pinned ${JSON.stringify(pinned[field])}, served ${JSON.stringify(served[field])}.`,
      );
    }
  }
  if (
    JSON.stringify(pinned.primaryStrip) !== JSON.stringify(served.primaryStrip)
  ) {
    report.fail(
      `primaryStrip: pinned ${JSON.stringify(pinned.primaryStrip)}, served ${JSON.stringify(served.primaryStrip)}.`,
    );
  }

  const pinnedById = new Map((pinned.protocols ?? []).map((p) => [p.id, p]));
  const servedById = new Map((served.protocols ?? []).map((p) => [p.id, p]));

  for (const id of servedById.keys()) {
    if (!pinnedById.has(id)) {
      report.fail(`${id} is served but is not in the pinned manifest.`);
    }
  }
  for (const id of pinnedById.keys()) {
    if (!servedById.has(id)) {
      report.fail(`${id} is pinned but is not served.`);
    }
  }
  for (const [id, pinnedEntry] of pinnedById) {
    const servedEntry = servedById.get(id);
    if (!servedEntry) continue;
    const fields = new Set([
      ...Object.keys(pinnedEntry),
      ...Object.keys(servedEntry),
    ]);
    for (const field of fields) {
      const a = JSON.stringify(pinnedEntry[field]);
      const b = JSON.stringify(servedEntry[field]);
      if (a !== b) {
        report.fail(`${id}.${field}: pinned ${a}, served ${b}.`);
      }
    }
  }

  const order = (document) => (document.protocols ?? []).map((p) => p.id);
  if (
    report.problems.length === 0 &&
    JSON.stringify(order(pinned)) !== JSON.stringify(order(served))
  ) {
    report.fail(
      'the roster order differs, which changes the order of the public protocol strip.',
    );
  }
  return report;
}

// ---------------------------------------------------------------------------
// Release gate
// ---------------------------------------------------------------------------

/** The only acceptance values a descriptor may carry. */
const ACCEPTANCE_RESULTS = new Set([
  'PASS',
  'FAIL',
  'BLOCKED',
  'NOT TESTED',
  'NOT APPLICABLE',
]);

/**
 * The gate a public release must pass, kept apart from the roster check.
 *
 * `--check` asks whether this repository still agrees with itself about which
 * protocols exist. That question has an answer on every commit, and a release
 * needs a different one: is this exact revision, serving this exact network,
 * backed by evidence for every operation it advertises.
 *
 * Splitting them matters because the roster check is the one that runs
 * constantly, and a gate that runs constantly is a gate people learn to make
 * green. Nothing here can be satisfied by editing a label.
 */
/**
 * IMPLEMENTATION-HANDOFF [WP01] | F001 | preparation 2026-09-21
 * State: IMPLEMENTED LOCALLY. releaseGate now rejects descriptor-only labels, requires a
 * versioned qualified envelope, checks rooted evidence hashes and identity bindings, and
 * derives counters from context-qualified rows. Real network evidence and public release
 * remain unverified.
 * Governing requirements: REQ-EVIDENCE, REQ-NETWORK, REQ-COVERAGE;
 * docs/implementation-prep/blockers-20260921/WORK-PACKAGES.json and bundled
 * research/source-register.json.
 * Prerequisites: WP03. 1. Replace label-only qualification in releaseGate with the
 * qualified-envelope verifier described above; retain offline roster mode. 2. Load safe rooted
 * evidence paths, verify hashes and candidate/dependency/config bindings, then derive counters
 * from required rows. 3. Separate Signet acceptance from Mainnet configuration evidence and
 * qualify exclusions. 4. Extend protocol-contract.test.mjs with missing/tampered/wrong-network
 * evidence and the saved 123-label forgery. Run node --test
 * scripts/universe/protocol-contract.test.mjs; source-only gate success is not release
 * acceptance.
 * Acceptance: The saved forgery is rejected; real complete qualified Signet or justified
 * Testnet evidence is accepted for a Mainnet candidate only with its independent configuration
 * proof; every applicable operation and required variant is accounted for.
 * Rollback: No database migration is justified by this finding. Version evidence readers
 * additively; retain previously accepted artifacts for emergency rollback. Never disable the
 * gate to release.
 * Local gate behavior is verified by the focused contract suite; it is not release acceptance.
 */
function qualifiedAcceptanceKey({
  protocol,
  operation,
  variant,
  chain,
  network,
}) {
  return [protocol, operation, variant, chain, network].join('|');
}

function requiredVariants(operation) {
  const variants = operation.requiredVariants ?? operation.variants;
  if (!Array.isArray(variants) || !variants.length) return ['default'];
  return [...new Set(variants.filter((variant) => typeof variant === 'string' && variant))];
}

function pathIsWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function evidenceRoot(root, report) {
  const rootPath = path.resolve(root ?? REPOSITORY_ROOT);
  try {
    const rootStat = lstatSync(rootPath);
    if (!rootStat.isDirectory()) {
      report.fail(`The acceptance evidence root ${rootPath} is not a directory.`);
      return null;
    }
    return { rootPath, rootRealPath: realpathSync(rootPath) };
  } catch (error) {
    report.fail(
      `The acceptance evidence root ${rootPath} could not be read: ${error instanceof Error ? error.message : error}.`,
    );
    return null;
  }
}

function verifyEvidenceFiles(entries, context, report, owner) {
  if (!Array.isArray(entries) || !entries.length) {
    report.fail(`${owner} carries no evidence files.`);
    return;
  }
  if (!context) return;

  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) {
      report.fail(`${owner} carries a malformed evidence file record.`);
      continue;
    }
    if (typeof entry.path !== 'string' || !entry.path.trim()) {
      report.fail(`${owner} carries an evidence record with no relative path.`);
      continue;
    }
    if (path.isAbsolute(entry.path)) {
      report.fail(`${owner} names an absolute evidence path ${entry.path}.`);
      continue;
    }
    if (typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256)) {
      report.fail(`${owner} carries an invalid SHA-256 for ${entry.path}.`);
      continue;
    }

    const target = path.resolve(context.rootPath, entry.path);
    if (!pathIsWithin(context.rootPath, target)) {
      report.fail(`${owner} escapes the evidence root through ${entry.path}.`);
      continue;
    }

    let actual;
    try {
      const targetStat = lstatSync(target);
      if (targetStat.isSymbolicLink()) {
        report.fail(`${owner} names a symlink instead of an evidence file: ${entry.path}.`);
        continue;
      }
      if (!targetStat.isFile()) {
        report.fail(`${owner} names a non-file evidence path: ${entry.path}.`);
        continue;
      }
      actual = realpathSync(target);
    } catch (error) {
      report.fail(
        `${owner} names unreadable evidence ${entry.path}: ${error instanceof Error ? error.message : error}.`,
      );
      continue;
    }

    if (!pathIsWithin(context.rootRealPath, actual)) {
      report.fail(`${owner} escapes the evidence root through ${entry.path}.`);
      continue;
    }

    let digest;
    try {
      digest = createHash('sha256').update(readFileSync(actual)).digest('hex');
    } catch (error) {
      report.fail(
        `${owner} evidence ${entry.path} could not be hashed: ${error instanceof Error ? error.message : error}.`,
      );
      continue;
    }
    if (digest !== entry.sha256.toLowerCase()) {
      report.fail(
        `${owner} evidence ${entry.path} has SHA-256 ${digest}, not the recorded ${entry.sha256}.`,
      );
    }
  }
}

function validateQualifiedAcceptanceEvidence(
  manifest,
  descriptors,
  summary,
  evidence,
  expected,
  report,
) {
  if (typeof evidence !== 'object' || evidence === null) {
    report.fail(
      'The release has no qualified acceptance evidence artifact; descriptor labels alone are not evidence.',
    );
    return;
  }
  if (evidence.schemaVersion !== ACCEPTANCE_EVIDENCE_SCHEMA_VERSION) {
    report.fail(
      `The acceptance evidence schema is ${JSON.stringify(evidence.schemaVersion)}; this gate reads ${ACCEPTANCE_EVIDENCE_SCHEMA_VERSION}.`,
    );
  }
  if (
    typeof evidence.generatedAt !== 'string' ||
    Number.isNaN(Date.parse(evidence.generatedAt))
  ) {
    report.fail('The acceptance evidence carries no readable generatedAt time.');
  }
  const provenance = evidence.provenance;
  if (typeof provenance !== 'object' || provenance === null) {
    report.fail('The acceptance evidence carries no trusted run provenance.');
  } else {
    if (provenance.producer !== TRUSTED_ACCEPTANCE_PRODUCER) {
      report.fail(
        `The acceptance evidence producer is ${JSON.stringify(provenance.producer)}, not ${TRUSTED_ACCEPTANCE_PRODUCER}.`,
      );
    }
    if (
      typeof provenance.executionEnvironment !== 'string' ||
      !provenance.executionEnvironment.trim()
    ) {
      report.fail('The acceptance evidence carries no execution environment.');
    }
    if (typeof provenance.command !== 'string' || !provenance.command.trim()) {
      report.fail('The acceptance evidence carries no run command provenance.');
    }
  }

  const candidate = evidence.candidate;
  if (typeof candidate !== 'object' || candidate === null) {
    report.fail('The acceptance evidence carries no candidate binding.');
    return;
  }

  if (
    typeof candidate.sourceSha !== 'string' ||
    !COMMIT_SHA.test(candidate.sourceSha)
  ) {
    report.fail('The acceptance candidate carries no valid source revision.');
  } else if (candidate.sourceSha !== manifest.sourceSha) {
    report.fail(
      `The acceptance evidence was produced for ${candidate.sourceSha}, not the manifest revision ${manifest.sourceSha}.`,
    );
  }
  if (expected.sourceSha && candidate.sourceSha !== expected.sourceSha) {
    report.fail(
      `The acceptance evidence was produced for ${candidate.sourceSha}, not the intended revision ${expected.sourceSha}.`,
    );
  }
  if (
    expected.artifactCommit &&
    candidate.artifactCommit !== expected.artifactCommit
  ) {
    report.fail(
      `The acceptance evidence names artifact ${candidate.artifactCommit}, not the intended artifact ${expected.artifactCommit}.`,
    );
  }

  for (const field of ['dependencyRevision', 'acceptanceNetwork', 'deploymentNetwork']) {
    if (typeof candidate[field] !== 'string' || !candidate[field].trim()) {
      report.fail(`The acceptance candidate carries no ${field}.`);
    }
  }
  if (
    typeof candidate.configurationDigest !== 'string' ||
    !SHA256.test(candidate.configurationDigest)
  ) {
    report.fail('The acceptance candidate carries no valid configuration digest.');
  }
  if (
    !Array.isArray(candidate.specificationRevisions) ||
    !candidate.specificationRevisions.length ||
    candidate.specificationRevisions.some(
      (revision) => typeof revision !== 'string' || !revision.trim(),
    )
  ) {
    report.fail('The acceptance candidate carries no specification revisions.');
  }
  if (
    expected.network &&
    candidate.deploymentNetwork !== expected.network
  ) {
    report.fail(
      `The acceptance evidence targets ${candidate.deploymentNetwork}, not the ${expected.network} network this release serves.`,
    );
  }

  const context = evidenceRoot(expected.acceptanceRoot, report);
  if (candidate.acceptanceNetwork !== candidate.deploymentNetwork) {
    const proof = candidate.configurationProof;
    if (typeof proof !== 'object' || proof === null) {
      report.fail(
        `Acceptance on ${candidate.acceptanceNetwork} has no independent ${candidate.deploymentNetwork} configuration proof.`,
      );
    } else {
      if (proof.network !== candidate.deploymentNetwork) {
        report.fail(
          `The configuration proof targets ${JSON.stringify(proof.network)}, not ${candidate.deploymentNetwork}.`,
        );
      }
      if (proof.configurationDigest !== candidate.configurationDigest) {
        report.fail('The configuration proof does not bind the candidate configuration digest.');
      }
      if (typeof proof.sourceRevision !== 'string' || !proof.sourceRevision.trim()) {
        report.fail('The configuration proof carries no source revision.');
      }
      if (!Array.isArray(proof.assertions) || !proof.assertions.length) {
        report.fail('The configuration proof carries no assertions.');
      }
      verifyEvidenceFiles(proof.evidence, context, report, 'The configuration proof');
    }
  }

  const protocolsById = new Map(manifest.protocols.map((protocol) => [protocol.id, protocol]));
  const required = new Map();
  for (const descriptor of descriptors) {
    const protocol = protocolsById.get(descriptor.protocol);
    if (!protocol) continue;
    for (const variant of requiredVariants(descriptor)) {
      const key = qualifiedAcceptanceKey({
        protocol: descriptor.protocol,
        operation: descriptor.id,
        variant,
        chain: protocol.chain,
        network: candidate.acceptanceNetwork,
      });
      required.set(key, { descriptor, protocol, variant });
    }
  }

  if (!Array.isArray(evidence.rows)) {
    report.fail('The acceptance evidence carries no rows.');
    return;
  }
  const seen = new Map();
  const counts = {
    PASS: 0,
    FAIL: 0,
    BLOCKED: 0,
    'NOT APPLICABLE': 0,
    'NOT TESTED': 0,
  };
  for (const row of evidence.rows) {
    if (typeof row !== 'object' || row === null) {
      report.fail('The acceptance evidence carries a malformed row.');
      continue;
    }
    const rowFields = ['protocol', 'operation', 'variant', 'role', 'chain', 'network'];
    if (rowFields.some((field) => typeof row[field] !== 'string' || !row[field].trim())) {
      report.fail('An acceptance row is missing a stable operation, variant, role, chain, or network key.');
      continue;
    }
    const key = qualifiedAcceptanceKey({
      protocol: row.protocol,
      operation: row.operation,
      variant: row.variant,
      chain: row.chain,
      network: row.network,
    });
    if (seen.has(key)) {
      report.fail(`The acceptance evidence repeats ${key}.`);
      continue;
    }
    seen.set(key, row);
    const expectedRow = required.get(key);
    if (!expectedRow) {
      report.fail(`The acceptance evidence contains an unrequired row ${key}.`);
      continue;
    }

    const { descriptor, protocol } = expectedRow;
    if (row.chain !== protocol.chain) {
      report.fail(`${key} names chain ${row.chain}, but the manifest names ${protocol.chain}.`);
    }
    if (row.network !== candidate.acceptanceNetwork) {
      report.fail(`${key} is not qualified for the candidate acceptance network.`);
    }
    if (!ACCEPTANCE_RESULTS.has(row.result)) {
      report.fail(`${key} carries acceptance ${JSON.stringify(row.result)}.`);
    } else {
      counts[row.result] += 1;
      if (row.result !== descriptor.acceptance) {
        report.fail(
          `${key} records ${row.result}, but the manifest descriptor records ${descriptor.acceptance}.`,
        );
      }
    }
    if (row.codeRevision !== candidate.sourceSha) {
      report.fail(`${key} does not bind the candidate source revision.`);
    }
    if (row.dependencyRevision !== candidate.dependencyRevision) {
      report.fail(`${key} does not bind the candidate dependency revision.`);
    }
    if (row.configurationDigest !== candidate.configurationDigest) {
      report.fail(`${key} does not bind the candidate configuration digest.`);
    }
    if (
      typeof row.specificationRevision !== 'string' ||
      !candidate.specificationRevisions?.includes(row.specificationRevision)
    ) {
      report.fail(`${key} does not bind a declared specification revision.`);
    }
    if (typeof row.ranAt !== 'string' || Number.isNaN(Date.parse(row.ranAt))) {
      report.fail(`${key} carries no readable run time.`);
    }
    if (!Array.isArray(row.assertions) || !row.assertions.length) {
      report.fail(`${key} carries no assertions.`);
    }
    if (!Array.isArray(row.authorityReadback) || !row.authorityReadback.length) {
      report.fail(`${key} carries no authoritative readback assertions.`);
    }
    if (
      !Array.isArray(row.consumerAssertions) ||
      !row.consumerAssertions.length
    ) {
      report.fail(`${key} carries no consumer assertions.`);
    }
    verifyEvidenceFiles(row.evidence, context, report, `Acceptance row ${key}`);
    if (row.result === 'PASS') {
      const checkpoint = row.checkpoint;
      const hasHeight =
        (Number.isInteger(checkpoint?.height) && checkpoint.height >= 0) ||
        (typeof checkpoint?.heightAtomic === 'string' && /^\d+$/.test(checkpoint.heightAtomic));
      if (
        typeof checkpoint !== 'object' ||
        checkpoint === null ||
        !hasHeight ||
        typeof checkpoint.blockHash !== 'string' ||
        !SHA256.test(checkpoint.blockHash)
      ) {
        report.fail(`${key} passes without a qualified height and block hash checkpoint.`);
      }
    }
  }

  for (const [key, expectedRow] of required) {
    if (!seen.has(key)) {
      report.fail(`${key} is missing from the acceptance evidence.`);
    } else if (expectedRow.descriptor.acceptance === 'NOT APPLICABLE') {
      const exclusions = Array.isArray(evidence.exclusions) ? evidence.exclusions : [];
      if (!exclusions.some((exclusion) => exclusion?.operationKey === key && typeof exclusion.justification === 'string' && exclusion.justification.trim())) {
        report.fail(`${key} is not applicable without a qualified exclusion justification.`);
      }
    }
  }
  if (!Array.isArray(evidence.exclusions)) {
    report.fail('The acceptance evidence carries no exclusions list.');
  } else {
    const known = new Set(required.keys());
    const exclusionKeys = new Set();
    for (const exclusion of evidence.exclusions) {
      if (typeof exclusion !== 'object' || exclusion === null) {
        report.fail('The acceptance evidence carries a malformed exclusion.');
        continue;
      }
      if (!known.has(exclusion.operationKey)) {
        report.fail(`The acceptance evidence excludes an unrequired row ${exclusion.operationKey}.`);
      }
      if (exclusionKeys.has(exclusion.operationKey)) {
        report.fail(`The acceptance evidence repeats exclusion ${exclusion.operationKey}.`);
      }
      exclusionKeys.add(exclusion.operationKey);
      if (typeof exclusion.justification !== 'string' || !exclusion.justification.trim()) {
        report.fail(`The acceptance evidence exclusion ${exclusion.operationKey} has no justification.`);
      }
    }
  }

  if (summary && typeof summary === 'object') {
    const expectedCounts = {
      declared: required.size,
      passed: counts.PASS,
      failed: counts.FAIL,
      blocked: counts.BLOCKED,
      notApplicable: counts['NOT APPLICABLE'],
      notTested: counts['NOT TESTED'],
    };
    for (const [field, value] of Object.entries(expectedCounts)) {
      if (summary[field] !== value) {
        report.fail(
          `The acceptance summary ${field} is ${summary[field]}, but qualified rows derive ${value}.`,
        );
      }
    }
  }
}

export function releaseGate(manifest, expected = {}, report = new Report()) {
  validateManifest(manifest, report);
  if (report.problems.length) return report;

  const { sourceSha, network } = expected;

  // Wrong revision. validateManifest has already refused a manifest that names
  // no commit; this is the separate question of whether it names the right one.
  if (sourceSha && manifest.sourceSha !== sourceSha) {
    report.fail(
      `The release intends ${sourceSha}; the manifest was produced by ${manifest.sourceSha}.`,
    );
  }

  // Unknown denominator. A percentage whose denominator is missing, or which
  // counts something other than the operations actually declared here, is the
  // shape every forged completion takes.
  const summary = manifest.acceptance;
  const descriptors = manifest.protocols.flatMap((protocol) =>
    (protocol.readOperationDescriptors ?? []).map((operation) => ({
      protocol: protocol.id,
      ...operation,
    })),
  );
  if (typeof summary !== 'object' || summary === null) {
    report.fail(
      'The manifest publishes no acceptance summary, so the denominator is unknown.',
    );
  } else {
    if (summary.declared !== descriptors.length) {
      report.fail(
        `The acceptance summary counts ${summary.declared} declared operations; the manifest declares ${descriptors.length}.`,
      );
    }
    const total =
      summary.passed +
      summary.failed +
      summary.blocked +
      summary.notApplicable +
      summary.notTested;
    if (total !== summary.declared) {
      report.fail(
        `The acceptance results add up to ${total}, not the ${summary.declared} operations declared.`,
      );
    }
    if (summary.rejected > 0) {
      report.fail(
        `${summary.rejected} acceptance records could not be qualified as evidence.`,
      );
    }
  }

  // Missing and duplicate operations.
  for (const protocol of manifest.protocols) {
    const operations = protocol.readOperationDescriptors ?? [];
    if (!operations.length) {
      report.fail(`${protocol.id} declares no read operations.`);
      continue;
    }
    const ids = operations.map((operation) => operation.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (duplicates.length) {
      report.fail(
        `${protocol.id} declares ${[...new Set(duplicates)].join(', ')} more than once.`,
      );
    }
    if (
      JSON.stringify(protocol.implementedReadOperations) !== JSON.stringify(ids)
    ) {
      report.fail(
        `${protocol.id} lists operations its descriptors do not match.`,
      );
    }
  }

  // Wrong network. A release serves one network, and a protocol that does not
  // declare it cannot be part of that release.
  if (network) {
    for (const protocol of manifest.protocols) {
      if (!(protocol.networks ?? []).includes(network)) {
        report.fail(
          `${protocol.id} does not declare the ${network} network this release serves.`,
        );
      }
    }
  }

  // Forged completion. Every descriptor carries a value from the closed set,
  // and a passing operation must be one the summary also counted.
  const passed = descriptors.filter(
    (descriptor) => descriptor.acceptance === 'PASS',
  );
  for (const descriptor of descriptors) {
    if (!ACCEPTANCE_RESULTS.has(descriptor.acceptance)) {
      report.fail(
        `${descriptor.protocol}.${descriptor.id} carries acceptance ${JSON.stringify(descriptor.acceptance)}.`,
      );
    }
  }
  if (summary && summary.passed !== passed.length) {
    report.fail(
      `The summary counts ${summary.passed} passing operations; ${passed.length} descriptors claim to pass.`,
    );
  }

  // A descriptor is a declaration, not proof. The qualified envelope binds
  // every required row to the revision, dependency set, configuration, spec,
  // network, checkpoint, and hashed evidence that produced its result.
  validateQualifiedAcceptanceEvidence(
    manifest,
    descriptors,
    summary,
    expected.acceptanceEvidence ?? manifest.acceptanceEvidence,
    expected,
    report,
  );

  // Missing history. A complete coverage claim and a verified release label are
  // both statements about every operation, so neither survives an operation
  // that was never accepted.
  for (const protocol of manifest.protocols) {
    const operations = protocol.readOperationDescriptors ?? [];
    const unaccepted = operations.filter(
      (operation) => operation.acceptance !== 'PASS',
    );
    if (!unaccepted.length) continue;
    if (coverageState(protocol.coverage) === 'complete') {
      report.fail(
        `${protocol.id} claims complete historical coverage with ${unaccepted.length} operations not accepted.`,
      );
    }
    if (READABLE_STATUSES.has(protocol.releaseStatus)) {
      report.fail(
        `${protocol.id} carries release status ${protocol.releaseStatus} with ${unaccepted.length} operations not accepted.`,
      );
    }
  }

  // A release is complete only when nothing is left outstanding. Blocked and
  // not applicable are honest results, and neither is a pass.
  if (summary && summary.passed !== summary.declared) {
    report.fail(
      `${summary.declared - summary.passed} of ${summary.declared} declared operations are not accepted ` +
        `(${summary.failed} failed, ${summary.blocked} blocked, ${summary.notApplicable} not applicable, ${summary.notTested} not tested).`,
    );
  }
  return report;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

async function loadDocument(source) {
  if (/^https?:\/\//i.test(source)) {
    const url = /\/api\//.test(source)
      ? source
      : `${source.replace(/\/+$/, '')}/api/v1/universe/protocols`;
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    // Read the body either way. An unread body leaves the connection open and
    // the process cannot finish on its own while it is held.
    const body = await response.text();
    if (!response.ok) {
      throw new GateFailure(
        `${url} answered HTTP ${response.status}; the roster could not be read.`,
      );
    }
    try {
      return JSON.parse(body);
    } catch {
      throw new GateFailure(
        `${url} did not answer with JSON; the roster could not be read.`,
      );
    }
  }
  return JSON.parse(await readFile(path.resolve(source), 'utf8'));
}

async function readSources() {
  const [protocolCopy, apiService, markdown, roster, readme] =
    await Promise.all([
      readFile(PATHS.protocolCopy, 'utf8'),
      readFile(PATHS.apiService, 'utf8'),
      readFile(PATHS.markdown, 'utf8'),
      readFile(PATHS.roster, 'utf8'),
      readFile(PATHS.readme, 'utf8'),
    ]);
  return { protocolCopy, apiService, markdown, roster, readme };
}

async function record(source) {
  const document = await loadDocument(source);
  validateManifest(document).throwIfFailed(
    'The manifest that was read cannot be recorded.',
  );
  const readme = await readFile(PATHS.readme, 'utf8');
  await writeFile(
    PATHS.manifest,
    `${JSON.stringify(document, null, 2)}\n`,
    'utf8',
  );
  await writeFile(PATHS.markdown, renderMarkdown(document), 'utf8');
  await writeFile(PATHS.roster, renderRoster(document), 'utf8');
  await writeFile(
    PATHS.readme,
    replaceReadmeBlock(readme, renderReadmeBlock(document)),
    'utf8',
  );
  process.stdout.write(
    `Pinned ${document.protocols.length} protocols from ${document.sourceRepository} at ${document.sourceSha}.\n`,
  );
}

async function check() {
  const manifest = JSON.parse(await readFile(PATHS.manifest, 'utf8'));
  validateManifest(manifest).throwIfFailed(
    'The pinned protocol manifest is not a manifest this gate can trust.',
  );
  const sources = await readSources();

  const report = new Report();
  if (normalise(renderMarkdown(manifest)) !== normalise(sources.markdown)) {
    report.fail(
      'PROTOCOL-COVERAGE.md no longer matches the pinned manifest. Regenerate with --record.',
    );
  }
  const readmeBlock = readmeBlockOf(sources.readme);
  if (readmeBlock === null) {
    report.fail(
      `README.md carries no ${README_MARKER_OPEN} block for the readable protocol list.`,
    );
  } else if (readmeBlock !== renderReadmeBlock(manifest)) {
    report.fail(
      'The README readable-protocol list no longer matches the pinned manifest. Regenerate with --record.',
    );
  }
  checkRoster(manifest, sources.roster, report);
  checkSurfaces(manifest, sources, report);
  report.throwIfFailed('The protocol roster gate failed.');

  process.stdout.write(
    `The pinned roster holds: ${manifest.protocols.length} protocols from ` +
      `${manifest.sourceRepository} at ${manifest.sourceSha}, ` +
      `${readableProtocols(manifest).length} readable, every surface accounted for.\n`,
  );
}

async function against(source) {
  const [pinned, served] = await Promise.all([
    readFile(PATHS.manifest, 'utf8').then(JSON.parse),
    loadDocument(source),
  ]);
  validateManifest(served).throwIfFailed(
    `${source} did not serve a manifest this gate can read.`,
  );
  const report = diffManifests(comparable(pinned), comparable(served));
  if (report.problems.length) {
    report.problems.push(
      `pinned from ${pinned.sourceSha}, served by ${served.sourceSha}. ` +
        'Record the served roster with --record once the deployment is the one this release intends.',
    );
  }
  report.throwIfFailed(
    'What is served does not match the pinned protocol roster.',
  );
  process.stdout.write(
    `The served roster matches the pinned one: ${served.protocols.length} protocols, ` +
      `registry ${served.registryVersion}, served by ${served.sourceSha}.\n`,
  );
}

/**
 * Runs the release gate against a manifest and says nothing but the verdict.
 *
 * It reads a served origin or a file so the same command can qualify a release
 * candidate before it is deployed and the real deployment afterwards.
 */
async function release(source, expected) {
  const manifest = await loadDocument(source);
  const acceptanceEvidence = expected.acceptancePath
    ? await loadDocument(expected.acceptancePath)
    : expected.acceptanceEvidence;
  const acceptanceRoot =
    expected.acceptanceRoot ??
    (expected.acceptancePath
      ? path.dirname(path.resolve(expected.acceptancePath))
      : undefined);
  releaseGate(manifest, {
    ...expected,
    acceptanceEvidence,
    acceptanceRoot,
  }).throwIfFailed(
    `${source} is not releasable.`,
  );
  process.stdout.write(
    `Release gate passed: ${manifest.protocols.length} protocols from ${manifest.sourceSha}, ` +
      `all ${manifest.acceptance.declared} declared operations accepted.
`,
  );
}

function usage(message) {
  process.stderr.write(`${message}\n\n`);
  process.stderr.write(
    'Usage:\n' +
      '  protocol-contract.mjs --record --from <url|file>   pin a manifest and rewrite what it generates\n' +
      '  protocol-contract.mjs --check                      the offline gate\n' +
      '  protocol-contract.mjs --against <url|file>         compare the pin against what is served\n' +
      '  protocol-contract.mjs --release <url|file>         the release gate, stricter than --check\n' +
      '      [--expect-sha <sha>] [--expect-artifact-commit <sha>] [--network <name>] [--acceptance <file>] [--acceptance-root <dir>]\n',
  );
  process.exit(2);
}

async function main() {
  const argv = process.argv.slice(2);
  const fromIndex = argv.indexOf('--from');
  const againstIndex = argv.indexOf('--against');
  const wantsRecord = argv.includes('--record');
  const wantsCheck = argv.includes('--check');
  const releaseIndex = argv.indexOf('--release');
  const expectShaIndex = argv.indexOf('--expect-sha');
  const artifactCommitIndex = argv.indexOf('--expect-artifact-commit');
  const networkIndex = argv.indexOf('--network');
  const acceptanceIndex = argv.indexOf('--acceptance');
  const acceptanceRootIndex = argv.indexOf('--acceptance-root');

  const modes = [
    wantsRecord,
    wantsCheck,
    againstIndex !== -1,
    releaseIndex !== -1,
  ].filter(Boolean);
  if (modes.length !== 1) {
    usage('Pass exactly one of --record, --check, --against, --release.');
  }
  if (releaseIndex !== -1) {
    if (!argv[releaseIndex + 1]) usage('--release needs a url or file.');
    if (artifactCommitIndex !== -1 && !argv[artifactCommitIndex + 1]) {
      usage('--expect-artifact-commit needs a commit.');
    }
    if (acceptanceIndex !== -1 && !argv[acceptanceIndex + 1]) {
      usage('--acceptance needs a JSON file.');
    }
    if (acceptanceRootIndex !== -1 && !argv[acceptanceRootIndex + 1]) {
      usage('--acceptance-root needs a directory.');
    }
    await release(argv[releaseIndex + 1], {
      sourceSha: expectShaIndex === -1 ? undefined : argv[expectShaIndex + 1],
      artifactCommit:
        artifactCommitIndex === -1
          ? undefined
          : argv[artifactCommitIndex + 1],
      network: networkIndex === -1 ? undefined : argv[networkIndex + 1],
      acceptancePath:
        acceptanceIndex === -1 ? undefined : argv[acceptanceIndex + 1],
      acceptanceRoot:
        acceptanceRootIndex === -1 ? undefined : argv[acceptanceRootIndex + 1],
    });
    return;
  }
  if (wantsRecord) {
    if (fromIndex === -1 || !argv[fromIndex + 1]) {
      usage('--record needs --from <url|file>.');
    }
    await record(argv[fromIndex + 1]);
    return;
  }
  if (wantsCheck) {
    await check();
    return;
  }
  if (!argv[againstIndex + 1]) usage('--against needs a url or file.');
  await against(argv[againstIndex + 1]);
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    // Set the code rather than exiting here, so the process ends when its own
    // handles close instead of being torn down in the middle of a socket
    // teardown. Exiting mid-teardown aborts with a libuv assertion and an
    // exit code of 127 on Windows, which is a gate whose verdict depends on
    // which machine ran it.
    process.exitCode = 1;
  });
}
