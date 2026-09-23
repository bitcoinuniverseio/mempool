#!/usr/bin/env node
/**
 * Qualifies a packed release artifact with nothing but the artifact.
 *
 *   node scripts/universe/qualify-artifact.mjs <mempool-<sha>.tar.gz> --commit <sha> [--network mainnet]
 *
 * The artifact workflow used to qualify the acceptance envelope in the
 * checkout and then pack an archive without it: docs/ was staged and left out
 * of the tar member list, and the evidence files the envelope names were never
 * staged at all. release.sh then refused the candidate on the host, or a
 * candidate that passed in the checkout would have needed the checkout to
 * pass again. This reads the archive the way the host will:
 *
 * 1. Lists its members and refuses absolute or parent-relative names, and any
 *    link under docs/, before extracting a byte.
 * 2. Requires the release manifest, the protocol manifest, the acceptance
 *    envelope and the gate script inside the archive.
 * 3. Extracts into a fresh directory, holds RELEASE-MANIFEST.json to the
 *    commit being released, and runs the release gate from the extracted
 *    protocol-contract.mjs with the extracted directory as the evidence root,
 *    so every referenced evidence file is checked for presence, containment
 *    and SHA-256 from inside the artifact.
 *
 * Exit 0 only when the exact archive qualifies. The workflow runs this before
 * upload, so an archive that fails here is never published.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REQUIRED_MEMBERS = [
  'RELEASE-MANIFEST.json',
  'docs/protocols/PROTOCOL-COVERAGE.json',
  'docs/acceptance/qualified-release-evidence.json',
  'scripts/universe/protocol-contract.mjs',
];

/**
 * Runs tar from the archive's own directory with a bare file name, because
 * GNU tar reads a drive-letter path such as C:\x as a remote host.
 */
function tar(args, archive) {
  const result = spawnSync('tar', [...args, '-f', path.basename(archive)], {
    cwd: path.dirname(archive), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw new Error(`tar could not run: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`tar ${args[0]} failed: ${(result.stderr || '').trim()}`);
  return result.stdout;
}

function memberName(line) {
  return line.replace(/^\.\//, '').replace(/\/$/, '');
}

/** Problems with the member list alone, before anything is extracted. */
export function memberProblems(names, verboseLines) {
  const problems = [];
  for (const raw of names) {
    const name = raw.replace(/^\.\//, '');
    if (!name) continue;
    if (name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..')) {
      problems.push(`The archive member ${JSON.stringify(raw)} is absolute or escapes the release directory.`);
    }
  }
  // A link can point anywhere once extracted, so the evidence tree carries none.
  for (const line of verboseLines) {
    if (!/^[lh]/.test(line)) continue;
    if (/\s(\.\/)?docs\//.test(line)) {
      problems.push(`The archive carries a link in its evidence tree: ${line.trim()}`);
    }
  }
  const present = new Set(names.map(memberName));
  for (const required of REQUIRED_MEMBERS) {
    if (!present.has(required)) {
      problems.push(`The archive does not carry ${required}.`);
    }
  }
  return problems;
}

/**
 * @returns {Promise<string[]>} problems; empty when the archive qualifies.
 */
export async function qualifyArtifact(archive, { commit, network = 'mainnet' }) {
  if (!commit || !/^[0-9a-f]{40}$/i.test(commit)) {
    return ['A full 40 character release commit is required.'];
  }
  const names = tar(['-tz'], archive).split('\n').filter(Boolean);
  const verbose = tar(['-tvz'], archive).split('\n').filter(Boolean);
  const listed = memberProblems(names, verbose);
  if (listed.length) return listed;

  const extracted = mkdtempSync(path.join(tmpdir(), 'qualify-artifact-'));
  try {
    tar(['-xz', '-C', extracted], archive);
    const problems = [];
    let manifestCommit;
    try {
      manifestCommit = JSON.parse(readFileSync(path.join(extracted, 'RELEASE-MANIFEST.json'), 'utf8')).commit;
    } catch (error) {
      return [`RELEASE-MANIFEST.json is not readable: ${error instanceof Error ? error.message : error}.`];
    }
    if (manifestCommit !== commit) {
      problems.push(`RELEASE-MANIFEST.json names ${JSON.stringify(manifestCommit)}, not the release commit ${commit}.`);
    }
    // The gate that runs is the one the artifact carries, not the checkout's.
    const contract = await import(pathToFileURL(path.join(extracted, 'scripts', 'universe', 'protocol-contract.mjs')).href);
    let manifest;
    let acceptanceEvidence;
    try {
      manifest = JSON.parse(readFileSync(path.join(extracted, contract.STAGED_MANIFEST_PATH ?? 'docs/protocols/PROTOCOL-COVERAGE.json'), 'utf8'));
      acceptanceEvidence = JSON.parse(readFileSync(path.join(extracted, contract.STAGED_ACCEPTANCE_PATH ?? 'docs/acceptance/qualified-release-evidence.json'), 'utf8'));
    } catch (error) {
      return [...problems, `The carried manifest or acceptance envelope is not readable JSON: ${error instanceof Error ? error.message : error}.`];
    }
    const report = contract.releaseGate(manifest, {
      artifactCommit: commit,
      network,
      acceptanceEvidence,
      acceptanceRoot: extracted,
    });
    return [...problems, ...report.problems];
  } finally {
    rmSync(extracted, { recursive: true, force: true });
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const archive = argv[0];
  const flag = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  if (!archive || archive.startsWith('--')) {
    process.stderr.write('Usage: qualify-artifact.mjs <archive.tar.gz> --commit <sha> [--network <name>]\n');
    process.exitCode = 2;
    return;
  }
  const problems = await qualifyArtifact(path.resolve(archive), { commit: flag('--commit'), network: flag('--network') ?? 'mainnet' });
  if (problems.length) {
    process.stderr.write(`${archive} does not qualify on its own:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${archive} qualifies on its own for ${flag('--commit')}.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
