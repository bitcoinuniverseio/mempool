import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { qualifyApplication } from './reconciled-release.mjs';
import { validateRequiredApplicationCoverage } from './required-application-roster.mjs';
import { projectProtocolFunctionalAcceptance, STAGED_MANIFEST_PATH, STAGED_ACCEPTANCE_PATH } from './protocol-contract.mjs';
import { rootedProofReader } from './reconciled-operations.mjs';

export const FUNCTIONAL_PROJECTION_PATH = 'docs/acceptance/protocol-functional-acceptance.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

/** Carry every validated read and current reviewed source dependency. */
export function stageQualifiedApplicationClosure(sourceRoot, stageRoot, artifactCommit) {
  const originalRead = rootedProofReader(sourceRoot);
  const closure = new Map();
  const readProof = relative => {
    const bytes = originalRead(relative), sha256 = hash(bytes);
    if (closure.has(relative) && hash(closure.get(relative)) !== sha256) throw Error('Evidence changed during qualification');
    closure.set(relative, bytes);
    return bytes;
  };
  const rosterBytes = readProof('docs/acceptance/reconciled-operations.json');
  const roster = JSON.parse(rosterBytes.toString('utf8'));
  const protocolBytes = readProof(STAGED_ACCEPTANCE_PATH);
  const appBytes = readProof('docs/acceptance/qualified-application-evidence.json');
  qualifyApplication(rosterBytes, JSON.parse(appBytes.toString('utf8')), protocolBytes, artifactCommit, readProof);
  if (validateRequiredApplicationCoverage(roster, readProof).mappingReviewComplete !== true) throw Error('Required coverage review is unresolved');
  for (const item of [...roster.operations, ...roster.mappings, ...(roster.currentSourceCandidates ?? [])]) {
    for (const source of item.sources ?? []) if (hash(readProof(source.path)) !== source.sha256) throw Error('Reviewed source proof drift');
  }
  const rootStat = lstatSync(stageRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw Error('Stage root must be a plain directory');
  const stage = realpathSync(stageRoot), stagedReader = rootedProofReader(stage);
  const targets = [...closure].map(([path, bytes]) => {
    if (!path.startsWith('docs/') || isAbsolute(path) || path.split(/[\\/]/).includes('..')) throw Error('Carried proof must be a plain path under docs/');
    const target = resolve(stage, path), tail = relative(stage, target);
    if (tail === '..' || tail.startsWith(`..${sep}`) || isAbsolute(tail)) throw Error('Stage path escapes root');
    let current = stage;
    for (const part of relative(stage, dirname(target)).split(sep).filter(Boolean)) {
      current = join(current, part);
      if (!existsSync(current)) break;
      const stat = lstatSync(current), parent = relative(stage, realpathSync(current));
      if (!stat.isDirectory() || stat.isSymbolicLink() || parent === '..' || parent.startsWith(`..${sep}`) || isAbsolute(parent)) throw Error('Unsafe stage ancestor');
    }
    if (existsSync(target)) {
      const stat = lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink() || hash(stagedReader(path)) !== hash(bytes)) throw Error('Staged proof differs; preserved existing bytes');
    }
    return { path, target, bytes };
  });
  // All targets have passed before any missing file is created. Reuse only
  // identical bytes, and never overwrite a target appearing after preflight.
  for (const { path, target, bytes } of targets) {
    if (existsSync(target)) {
      if (hash(stagedReader(path)) !== hash(bytes)) throw Error('Staged proof changed after preflight; preserved existing bytes');
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes, { flag: 'wx' });
  }
  return [...closure].map(([path, bytes]) => ({ path, sha256: hash(bytes) }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, sourceRoot, stageRoot, artifactCommit] = process.argv.slice(2);
    if (command !== 'stage-required' || !sourceRoot || !stageRoot || !/^[0-9a-f]{40}$/.test(artifactCommit ?? '')) throw Error('Invalid required-proof staging arguments');
    stageQualifiedApplicationClosure(sourceRoot, stageRoot, artifactCommit);
    console.log('Complete qualified application proof closure staged.');
  } catch {
    console.error('Complete application proof staging refused; no release qualification.');
    process.exitCode = 1;
  }
}

/** Run over the complete carried evidence closure, outside HTTP/native budgets. */
export function qualifiedFunctionalProjection(root, { artifactCommit, network }) {
  const readProof = rootedProofReader(root);
  const protocolBytes = readProof(STAGED_ACCEPTANCE_PATH);
  const acceptanceEvidence = JSON.parse(protocolBytes.toString('utf8'));
  const projection = projectProtocolFunctionalAcceptance(
    JSON.parse(readProof(STAGED_MANIFEST_PATH).toString('utf8')),
    { artifactCommit, network, acceptanceRoot: root, acceptanceEvidence,
      application: {
        protocolBytes,
        rosterBytes: readProof('docs/acceptance/reconciled-operations.json'),
        acceptanceBytes: readProof('docs/acceptance/qualified-application-evidence.json'),
        readProof,
      } },
  );
  if (!projection) throw Error('Full carried acceptance did not qualify; no functional projection authorized.');
  const bytes = Buffer.from(JSON.stringify(projection, null, 2) + '\n');
  return { bytes, member: {
    path: FUNCTIONAL_PROJECTION_PATH, bytes: bytes.length, sha256: hash(bytes),
    validatorSha256: hash(readProof('scripts/universe/protocol-contract.mjs')),
    evidenceEnvelopeSha256: hash(protocolBytes),
  } };
}

export function emitQualifiedFunctionalProjection(root, expected) {
  const result = qualifiedFunctionalProjection(root, expected);
  mkdirSync(dirname(join(root, FUNCTIONAL_PROJECTION_PATH)), { recursive: true });
  writeFileSync(join(root, FUNCTIONAL_PROJECTION_PATH), result.bytes);
  return result.member;
}
