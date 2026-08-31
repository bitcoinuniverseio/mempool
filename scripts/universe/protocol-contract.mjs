#!/usr/bin/env node
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
      `${cell(coverageState(protocol.coverage))} |`,
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

${readable.length} of ${manifest.protocols.length} protocols are readable today; the rest are recorded here but not yet served.

| id | family | chain | authority | release status | coverage |
|---|---|---|---|---|---|
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
    `${readable.length} of the ${manifest.protocols.length} protocols in the registry are readable today:`,
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

function usage(message) {
  process.stderr.write(`${message}\n\n`);
  process.stderr.write(
    'Usage:\n' +
      '  protocol-contract.mjs --record --from <url|file>   pin a manifest and rewrite what it generates\n' +
      '  protocol-contract.mjs --check                      the offline gate\n' +
      '  protocol-contract.mjs --against <url|file>         compare the pin against what is served\n',
  );
  process.exit(2);
}

async function main() {
  const argv = process.argv.slice(2);
  const fromIndex = argv.indexOf('--from');
  const againstIndex = argv.indexOf('--against');
  const wantsRecord = argv.includes('--record');
  const wantsCheck = argv.includes('--check');

  const modes = [wantsRecord, wantsCheck, againstIndex !== -1].filter(Boolean);
  if (modes.length !== 1) {
    usage('Pass exactly one of --record, --check, --against.');
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
