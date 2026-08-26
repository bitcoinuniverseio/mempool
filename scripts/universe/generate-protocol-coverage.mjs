#!/usr/bin/env node
/**
 * Generates the protocol coverage documentation from the explorer protocol
 * manifest.
 *
 * The manifest is whatever `/api/v1/universe/protocols` serves, which is the
 * same contract the explorer frontend consumes. `docs/protocols/
 * PROTOCOL-COVERAGE.json` is the recorded manifest and `PROTOCOL-COVERAGE.md`
 * is its human-readable table, so the table can never drift from the recorded
 * manifest without `--check` failing.
 *
 *   node scripts/universe/generate-protocol-coverage.mjs --from <url|file>
 *   node scripts/universe/generate-protocol-coverage.mjs --check
 *
 * `--from` records a fresh manifest and rewrites both files. `--check` takes no
 * source: it re-derives the table from the recorded manifest and fails if the
 * committed table differs, which is the gate CI runs.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const JSON_PATH = path.join(
  REPOSITORY_ROOT,
  'docs',
  'protocols',
  'PROTOCOL-COVERAGE.json',
);
const MARKDOWN_PATH = path.join(
  REPOSITORY_ROOT,
  'docs',
  'protocols',
  'PROTOCOL-COVERAGE.md',
);

function usage(message) {
  process.stderr.write(`${message}\n\n`);
  process.stderr.write(
    'Usage:\n' +
      '  generate-protocol-coverage.mjs --from <url|file>   record a manifest and rewrite the docs\n' +
      '  generate-protocol-coverage.mjs --check             verify the table matches the recorded manifest\n',
  );
  process.exit(2);
}

async function loadManifest(source) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`The manifest source answered HTTP ${response.status}.`);
    }
    return response.json();
  }
  return JSON.parse(await readFile(path.resolve(source), 'utf8'));
}

/** Rejects anything that is not a protocol manifest before it is recorded. */
function validateManifest(manifest) {
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    typeof manifest.registryVersion !== 'string' ||
    !Array.isArray(manifest.protocols) ||
    manifest.protocols.length === 0
  ) {
    throw new Error(
      'The manifest must be an object with a registryVersion and a non-empty protocols array.',
    );
  }
  for (const protocol of manifest.protocols) {
    for (const field of ['id', 'family', 'chain', 'releaseStatus']) {
      if (typeof protocol?.[field] !== 'string' || !protocol[field]) {
        throw new Error(
          `Protocol ${protocol?.id ?? '<unnamed>'} is missing ${field}.`,
        );
      }
    }
  }
}

function coverageCell(coverage) {
  if (coverage === null || coverage === undefined || coverage === '') {
    return 'unknown';
  }
  if (typeof coverage === 'string') return coverage;
  return typeof coverage.state === 'string' ? coverage.state : 'unknown';
}

/** Escapes the pipe so an authority id can never break the table. */
function cell(value) {
  return String(value ?? '').replace(/\|/g, '\\|');
}

function renderMarkdown(manifest) {
  const live = manifest.protocols.filter(
    (protocol) =>
      protocol.releaseStatus === 'VERIFIED READ ONLY' ||
      protocol.releaseStatus === 'PRODUCTION VERIFIED',
  ).length;
  const rows = manifest.protocols.map(
    (protocol) =>
      `| ${cell(protocol.id)} | ${cell(protocol.family)} | ${cell(protocol.chain)} | ` +
      `${cell(protocol.indexerAuthority ?? 'none')} | ${cell(protocol.releaseStatus)} | ` +
      `${cell(coverageCell(protocol.coverage))} |`,
  );
  return `# Protocol coverage

Generated from the explorer protocol registry in backend-apis
(src/universe-explorer/registry/explorer-protocol-registry.ts), as served by
\`/api/v1/universe/protocols\`. Do not edit rows by hand: regenerate with

\`\`\`
node scripts/universe/generate-protocol-coverage.mjs --from <manifest url or file>
\`\`\`

and verify with \`node scripts/universe/generate-protocol-coverage.mjs --check\`.

Release status semantics: every protocol starts BLOCKED and is upgraded only when
its explorer integration is completed and verified against its Universe authority.
A protocol never silently disappears from this table.

Registry version ${cell(manifest.registryVersion)}. ${live} of ${manifest.protocols.length} protocols are readable today; the rest are recorded here but not yet served.

| id | family | chain | authority | release status | coverage |
|---|---|---|---|---|---|
${rows.join('\n')}
`;
}

async function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const fromIndex = argv.indexOf('--from');
  const source = fromIndex === -1 ? null : argv[fromIndex + 1];

  if (check && source) {
    usage('Pass either --check or --from, not both.');
  }
  if (!check && !source) {
    usage('A manifest source is required.');
  }

  if (check) {
    const manifest = JSON.parse(await readFile(JSON_PATH, 'utf8'));
    validateManifest(manifest);
    const expected = renderMarkdown(manifest);
    const actual = await readFile(MARKDOWN_PATH, 'utf8');
    if (expected !== actual) {
      process.stderr.write(
        'PROTOCOL-COVERAGE.md does not match PROTOCOL-COVERAGE.json.\n' +
          'Regenerate it with --from and commit the result.\n',
      );
      process.exit(1);
    }
    process.stdout.write(
      `Protocol coverage table matches the recorded manifest (${manifest.protocols.length} protocols).\n`,
    );
    return;
  }

  const manifest = await loadManifest(source);
  validateManifest(manifest);
  const recorded = {
    registryVersion: manifest.registryVersion,
    generatedAt: new Date().toISOString(),
    protocols: manifest.protocols,
  };
  await writeFile(JSON_PATH, `${JSON.stringify(recorded, null, 2)}\n`, 'utf8');
  await writeFile(MARKDOWN_PATH, renderMarkdown(recorded), 'utf8');
  process.stdout.write(
    `Recorded ${recorded.protocols.length} protocols at registry version ${recorded.registryVersion}.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
