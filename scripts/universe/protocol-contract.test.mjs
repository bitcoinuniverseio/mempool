import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  PATHS,
  apiAllowlist,
  assertRosterResolvesUniquely,
  checkRoster,
  checkSurfaces,
  comparable,
  diffManifests,
  protocolCopyIds,
  readmeBlockOf,
  releaseGate,
  renderMarkdown,
  renderReadmeBlock,
  renderRoster,
  validateManifest,
} from './protocol-contract.mjs';

/**
 * A gate that has only ever passed has not shown it can fail.
 *
 * The gate this replaced was green while production served two protocols the
 * recorded roster did not carry, so every case below is one the old gate could
 * not see, written against the roster this repository actually pins.
 */

const pinned = JSON.parse(await readFile(PATHS.manifest, 'utf8'));

/** A copy with one thing changed, so a case says exactly what it varied. */
function withProtocol(manifest, id, changes) {
  return {
    ...manifest,
    protocols: manifest.protocols.map((protocol) =>
      protocol.id === id ? { ...protocol, ...changes } : protocol,
    ),
  };
}

function problems(report) {
  return report.problems.join('\n');
}

test('the roster this repository pins is one the gate accepts', () => {
  assert.deepEqual(validateManifest(pinned).problems, []);
});

test('a manifest with no provenance is refused', () => {
  const stripped = { ...pinned };
  delete stripped.sourceSha;
  delete stripped.sourceRepository;
  const found = problems(validateManifest(stripped));
  assert.match(found, /names no commit it was produced from/);
  assert.match(found, /the roster is owned by bitcoinuniverseio\/backend-apis/);
});

test('a manifest from another schema is refused', () => {
  const found = problems(
    validateManifest({ ...pinned, schemaVersion: 'something-else' }),
  );
  assert.match(found, /this gate reads universe-explorer-protocol-manifest-v1/);
});

test('a protocol that claims to be readable with no authority is refused', () => {
  const found = problems(
    validateManifest(
      withProtocol(pinned, 'dunes', {
        releaseStatus: 'VERIFIED READ ONLY',
        indexerAuthority: undefined,
      }),
    ),
  );
  assert.match(found, /dunes is marked readable but names no authority/);
});

test('a protocol duplicated under incompatible ids is refused', () => {
  const doubled = {
    ...pinned,
    protocols: [
      ...pinned.protocols,
      { ...pinned.protocols[0], id: 'runes_v2', aliases: ['runes'] },
    ],
  };
  const found = problems(assertRosterResolvesUniquely(doubled.protocols));
  assert.match(found, /"runes" is claimed by both runes and runes_v2/);
});

test('an alias two protocols both claim is refused', () => {
  const clashing = [
    { id: 'a', aliases: ['shared'] },
    { id: 'b', aliases: ['shared'] },
  ];
  assert.match(
    problems(assertRosterResolvesUniquely(clashing)),
    /"shared" is claimed by both a and b/,
  );
});

test('a protocol that disappears from the roster fails the lock', () => {
  const lock = renderRoster(pinned);
  const shrunk = {
    ...pinned,
    protocols: pinned.protocols.filter((p) => p.id !== 'zrc20'),
  };
  assert.match(
    problems(checkRoster(shrunk, lock)),
    /zrc20 is in PROTOCOL-ROSTER\.lock but no longer in the pinned manifest/,
  );
});

test('a protocol added without recording it fails the lock', () => {
  const lock = renderRoster({
    ...pinned,
    protocols: pinned.protocols.filter((p) => p.id !== 'dunes'),
  });
  assert.match(
    problems(checkRoster(pinned, lock)),
    /dunes is in the pinned manifest but not in PROTOCOL-ROSTER\.lock/,
  );
});

test('the lock accepts the roster it was rendered from', () => {
  assert.deepEqual(checkRoster(pinned, renderRoster(pinned)).problems, []);
});

// This tree is checked out with CRLF on Windows. JavaScript counts a carriage
// return as a line terminator, so `.` will not cross one and `$` cannot assert
// an end after one: the comment stripper matched nothing and the gate reported
// all three comment lines of the lock file as protocols that had disappeared.
// Linux CI never saw it, because Linux checkouts are LF.
test('the lock reads the same whichever line ending it was checked out with', () => {
  const lf = renderRoster(pinned);
  const crlf = lf.split('\n').join('\r\n');
  assert.deepEqual(checkRoster(pinned, crlf).problems, []);
  assert.deepEqual(checkRoster(pinned, lf).problems, []);
});

test('this repository names no protocol the registry does not carry', async () => {
  const sources = {
    protocolCopy: await readFile(PATHS.protocolCopy, 'utf8'),
    apiService: await readFile(PATHS.apiService, 'utf8'),
  };
  assert.deepEqual(checkSurfaces(pinned, sources).problems, []);
});

test('prose for a protocol the registry dropped is a failure', async () => {
  const sources = {
    protocolCopy: `const PROTOCOL_COPY = {\n  not_a_protocol: {\n`,
    apiService: await readFile(PATHS.apiService, 'utf8'),
  };
  assert.match(
    problems(checkSurfaces(pinned, sources)),
    /writes prose for "not_a_protocol", which is not in the registry/,
  );
});

test('an API path for a protocol the registry does not carry is a failure', async () => {
  const sources = {
    protocolCopy: await readFile(PATHS.protocolCopy, 'utf8'),
    apiService:
      "const allowed = chain === 'dogecoin'\n" +
      "      ? ['doginals', 'drc20', 'doge-tap', 'dunes', 'invented']\n" +
      "      : ['zerdinals', 'zrunes', 'zrc20'];",
  };
  assert.match(
    problems(checkSurfaces(pinned, sources)),
    /the dogecoin API allowlist calls "invented", which is not in the registry/,
  );
});

test('an API path pointed at the wrong chain is a failure', async () => {
  const sources = {
    protocolCopy: await readFile(PATHS.protocolCopy, 'utf8'),
    apiService:
      "const allowed = chain === 'dogecoin'\n" +
      "      ? ['doginals', 'drc20', 'doge-tap', 'dunes', 'zrunes']\n" +
      "      : ['zerdinals', 'zrunes', 'zrc20'];",
  };
  assert.match(
    problems(checkSurfaces(pinned, sources)),
    /the dogecoin API allowlist calls "zrunes", which the registry places on zcash/,
  );
});

test('a readable protocol with no route is a failure', async () => {
  const sources = {
    protocolCopy: await readFile(PATHS.protocolCopy, 'utf8'),
    apiService:
      "const allowed = chain === 'dogecoin'\n" +
      "      ? ['doginals', 'drc20', 'doge-tap', 'dunes']\n" +
      "      : ['zerdinals', 'zrunes'];",
  };
  assert.match(
    problems(checkSurfaces(pinned, sources)),
    /zrc20 is readable on zcash but the API allowlist has no path for it/,
  );
});

test('the allowlist reader follows the aliases the registry publishes', async () => {
  const allowlist = apiAllowlist(await readFile(PATHS.apiService, 'utf8'));
  assert.ok(allowlist.get('dogecoin').includes('doge-tap'));
  const tapDoge = pinned.protocols.find((p) => p.id === 'tap_doge');
  assert.ok(tapDoge.aliases.includes('doge-tap'));
});

test('the copy reader finds the ids the frontend actually writes prose for', async () => {
  const ids = protocolCopyIds(await readFile(PATHS.protocolCopy, 'utf8'));
  assert.ok(ids.includes('ordinals'));
  assert.ok(ids.includes('drc20'));
});

test('the README block states the roster it was generated from', async () => {
  const block = readmeBlockOf(await readFile(PATHS.readme, 'utf8'));
  assert.equal(block, renderReadmeBlock(pinned));
  // Counted from the pin rather than written down, so a roster change is a
  // regenerate rather than an edit here.
  const readable = pinned.protocols.filter((p) =>
    ['VERIFIED READ ONLY', 'PRODUCTION VERIFIED'].includes(p.releaseStatus),
  ).length;
  assert.match(
    block,
    new RegExp(
      `${readable} of the ${pinned.protocols.length} protocols carry historical readable declarations`,
    ),
  );
});

test('a served roster that gained a protocol is named, not tolerated', () => {
  const served = {
    ...pinned,
    protocols: [
      ...pinned.protocols,
      { ...pinned.protocols[0], id: 'brand_new', aliases: [] },
    ],
  };
  assert.match(
    problems(diffManifests(comparable(pinned), comparable(served))),
    /brand_new is served but is not in the pinned manifest/,
  );
});

test('a served roster that dropped a protocol is named', () => {
  const served = {
    ...pinned,
    protocols: pinned.protocols.filter((p) => p.id !== 'dunes'),
  };
  assert.match(
    problems(diffManifests(comparable(pinned), comparable(served))),
    /dunes is pinned but is not served/,
  );
});

test('a served roster that changed one field of one protocol is named', () => {
  const served = withProtocol(pinned, 'doginals', {
    releaseStatus: 'VERIFIED READ ONLY',
  });
  assert.match(
    problems(diffManifests(comparable(pinned), comparable(served))),
    /doginals\.releaseStatus: pinned "BLOCKED", served "VERIFIED READ ONLY"/,
  );
});

test('a served roster that changed an authority is named', () => {
  const served = withProtocol(pinned, 'zrunes', {
    indexerAuthority: 'somebody-elses-indexer',
  });
  assert.match(
    problems(diffManifests(comparable(pinned), comparable(served))),
    /zrunes\.indexerAuthority: pinned "index-zcash-metaprotocols", served "somebody-elses-indexer"/,
  );
});

test('a served roster in a different order is named', () => {
  const served = {
    ...pinned,
    protocols: [...pinned.protocols].reverse(),
  };
  assert.match(
    problems(diffManifests(comparable(pinned), comparable(served))),
    /the roster order differs/,
  );
});

test('a value carrying a pipe or a backslash cannot split a table row', () => {
  const rendered = renderMarkdown({
    ...pinned,
    protocols: [
      {
        ...pinned.protocols[0],
        id: 'trick',
        family: 'a\\',
        chain: 'b|c',
        indexerAuthority: 'd\ne',
      },
    ],
  });
  const row = rendered
    .split('\n')
    .find((line) => line.startsWith('| trick '));
  assert.equal(row.split(/(?<!\\)\|/).length - 1, 8);
});

test('a served roster identical to the pin reports nothing', () => {
  assert.deepEqual(
    diffManifests(comparable(pinned), comparable(pinned)).problems,
    [],
  );
});


/**
 * The release gate.
 *
 * The roster check runs on every commit, and a gate that runs constantly is one
 * people learn to make green. Each case below is a way a release could be
 * declared complete without being complete, so the gate has to refuse it.
 */

/** The pin with every operation accepted, which is what a real release needs. */
function releasable(manifest, overrides = {}) {
  const sourceSha = 'a'.repeat(40);
  const dependencyRevision = 'fixture-backend-dependencies-v1';
  const configurationDigest = 'b'.repeat(64);
  const specificationRevision = 'fixture-protocol-spec-v1';
  const evidencePath = 'scripts/universe/protocol-contract.mjs';
  const evidenceSha = createHash('sha256')
    .update(readFileSync(new URL('./protocol-contract.mjs', import.meta.url)))
    .digest('hex');
  const protocols = manifest.protocols.map((protocol) => ({
    ...protocol,
    networks: ['mainnet'],
    coverage: 'unknown',
    releaseStatus: 'BLOCKED',
    readOperationDescriptors: (protocol.readOperationDescriptors ?? []).map(
      (operation) => ({ ...operation, acceptance: 'PASS' }),
    ),
  }));
  const declared = protocols.reduce(
    (total, protocol) => total + protocol.readOperationDescriptors.length,
    0,
  );
  const rows = protocols.flatMap((protocol) =>
    protocol.readOperationDescriptors.map((operation) => ({
      protocol: protocol.id,
      operation: operation.id,
      variant: 'default',
      role: 'read',
      chain: protocol.chain,
      network: 'mainnet',
      result: 'PASS',
      codeRevision: sourceSha,
      dependencyRevision,
      configurationDigest,
      specificationRevision,
      ranAt: '2026-09-21T17:00:00.000Z',
      checkpoint: { height: 1, blockHash: 'c'.repeat(64) },
      evidence: [{ path: evidencePath, sha256: evidenceSha }],
      assertions: ['fixture evidence is bound to the qualified row'],
      authorityReadback: ['fixture authority readback is present'],
      consumerAssertions: ['fixture consumer assertion is present'],
    })),
  );
  return {
    ...manifest,
    sourceSha,
    protocols,
    acceptance: {
      declared,
      passed: declared,
      failed: 0,
      blocked: 0,
      notApplicable: 0,
      notTested: 0,
      rejected: 0,
    },
    acceptanceEvidence: {
      schemaVersion: 'universe-explorer-acceptance-v1',
      generatedAt: '2026-09-21T17:00:00.000Z',
      provenance: {
        producer: 'universe-acceptance-runner-v1',
        executionEnvironment: 'controlled-offline-fixture',
        command: 'fixture acceptance command',
      },
      candidate: {
        sourceSha,
        artifactCommit: 'd'.repeat(40),
        dependencyRevision,
        configurationDigest,
        specificationRevisions: [specificationRevision],
        acceptanceNetwork: 'mainnet',
        deploymentNetwork: 'mainnet',
      },
      rows,
      exclusions: [],
    },
    ...overrides,
  };
}

test('a release with every operation accepted passes', () => {
  assert.deepEqual(releaseGate(releasable(pinned)).problems, []);
});

test('the acceptance envelope binds the separate mempool artifact revision', () => {
  const manifest = releasable(pinned);
  assert.deepEqual(
    releaseGate(manifest, { artifactCommit: 'd'.repeat(40) }).problems,
    [],
  );
  assert.match(
    problems(releaseGate(manifest, { artifactCommit: 'e'.repeat(40) })),
    /names artifact d{40}, not the intended artifact e{40}/,
  );
});

test('descriptor labels and counters without an evidence envelope are refused', () => {
  const forged = releasable(pinned);
  delete forged.acceptanceEvidence;
  assert.match(
    problems(releaseGate(forged)),
    /no qualified acceptance evidence artifact/,
  );
});

test('missing evidence rows are refused', () => {
  const manifest = releasable(pinned);
  manifest.acceptanceEvidence = {
    ...manifest.acceptanceEvidence,
    rows: manifest.acceptanceEvidence.rows.slice(1),
  };
  assert.match(
    problems(releaseGate(manifest)),
    /is missing from the acceptance evidence/,
  );
});

test('tampered evidence bytes are refused', () => {
  const manifest = releasable(pinned);
  const [first, ...rest] = manifest.acceptanceEvidence.rows;
  manifest.acceptanceEvidence = {
    ...manifest.acceptanceEvidence,
    rows: [
      {
        ...first,
        evidence: [{ ...first.evidence[0], sha256: '0'.repeat(64) }],
      },
      ...rest,
    ],
  };
  assert.match(
    problems(releaseGate(manifest)),
    /has SHA-256 .* not the recorded/,
  );
});

test('evidence paths that escape the rooted artifact are refused', () => {
  const manifest = releasable(pinned);
  const [first, ...rest] = manifest.acceptanceEvidence.rows;
  manifest.acceptanceEvidence = {
    ...manifest.acceptanceEvidence,
    rows: [
      {
        ...first,
        evidence: [
          { ...first.evidence[0], path: '../outside-acceptance-evidence.json' },
        ],
      },
      ...rest,
    ],
  };
  assert.match(
    problems(releaseGate(manifest)),
    /escapes the evidence root/,
  );
});

test('a Signet result without Mainnet configuration proof is refused', () => {
  const manifest = releasable(pinned);
  manifest.acceptanceEvidence = {
    ...manifest.acceptanceEvidence,
    candidate: {
      ...manifest.acceptanceEvidence.candidate,
      acceptanceNetwork: 'signet',
    },
    rows: manifest.acceptanceEvidence.rows.map((row) => ({
      ...row,
      network: 'signet',
    })),
  };
  assert.match(
    problems(releaseGate(manifest, { network: 'mainnet' })),
    /no independent mainnet configuration proof/,
  );
});

test('Signet acceptance needs and accepts independent Mainnet configuration proof', () => {
  const manifest = releasable(pinned);
  const candidate = manifest.acceptanceEvidence.candidate;
  manifest.acceptanceEvidence = {
    ...manifest.acceptanceEvidence,
    candidate: {
      ...candidate,
      acceptanceNetwork: 'signet',
      configurationProof: {
        network: 'mainnet',
        sourceRevision: manifest.sourceSha,
        configurationDigest: candidate.configurationDigest,
        assertions: ['the release configuration selects Mainnet'],
        evidence: manifest.acceptanceEvidence.rows[0].evidence,
      },
    },
    rows: manifest.acceptanceEvidence.rows.map((row) => ({
      ...row,
      network: 'signet',
    })),
  };
  assert.deepEqual(releaseGate(manifest, { network: 'mainnet' }).problems, []);
});

test('the roster this repository pins today is not releasable', () => {
  // The pinned manifest carries no acceptance summary and no accepted
  // operation. The roster check passes on it; the release gate must not.
  assert.deepEqual(validateManifest(pinned).problems, []);
  assert.notEqual(releaseGate(pinned).problems.length, 0);
});

test('a manifest with no acceptance summary has an unknown denominator', () => {
  const stripped = releasable(pinned);
  delete stripped.acceptance;
  assert.match(
    problems(releaseGate(stripped)),
    /publishes no acceptance summary, so the denominator is unknown/,
  );
});

test('a denominator that does not count the declared operations is refused', () => {
  const manifest = releasable(pinned);
  assert.match(
    problems(
      releaseGate({
        ...manifest,
        acceptance: { ...manifest.acceptance, declared: 4, passed: 4 },
      }),
    ),
    /counts 4 declared operations; the manifest declares/,
  );
});

test('a summary claiming more passes than the descriptors do is refused', () => {
  const manifest = releasable(pinned);
  const [first, ...rest] = manifest.protocols;
  assert.match(
    problems(
      releaseGate({
        ...manifest,
        protocols: [
          {
            ...first,
            readOperationDescriptors: first.readOperationDescriptors.map(
              (operation, index) =>
                index === 0
                  ? { ...operation, acceptance: 'NOT TESTED' }
                  : operation,
            ),
          },
          ...rest,
        ],
      }),
    ),
    /descriptors claim to pass/,
  );
});

test('an acceptance value outside the closed set is refused', () => {
  const manifest = releasable(pinned);
  const [first, ...rest] = manifest.protocols;
  assert.match(
    problems(
      releaseGate({
        ...manifest,
        protocols: [
          {
            ...first,
            readOperationDescriptors: first.readOperationDescriptors.map(
              (operation) => ({ ...operation, acceptance: 'COMPLETE' }),
            ),
          },
          ...rest,
        ],
      }),
    ),
    /carries acceptance "COMPLETE"/,
  );
});

test('unqualified evidence records block a release', () => {
  const manifest = releasable(pinned);
  assert.match(
    problems(
      releaseGate({
        ...manifest,
        acceptance: { ...manifest.acceptance, rejected: 2 },
      }),
    ),
    /2 acceptance records could not be qualified as evidence/,
  );
});

test('a release cut from something that is not a commit is refused by validation', () => {
  assert.match(
    problems(releaseGate(releasable(pinned, { sourceSha: 'development' }))),
    /names no commit it was produced from/,
  );
});

test('a manifest from another revision than the release intends is refused', () => {
  assert.match(
    problems(releaseGate(releasable(pinned), { sourceSha: 'b'.repeat(40) })),
    /The release intends b{40}; the manifest was produced by a{40}/,
  );
});

test('a protocol that does not serve the released network is refused', () => {
  const manifest = releasable(pinned);
  const [first, ...rest] = manifest.protocols;
  assert.match(
    problems(
      releaseGate(
        {
          ...manifest,
          protocols: [{ ...first, networks: ['signet'] }, ...rest],
        },
        { network: 'mainnet' },
      ),
    ),
    new RegExp(`${first.id} does not declare the mainnet network`),
  );
});

test('a duplicated operation is refused', () => {
  const manifest = releasable(pinned);
  const [first, ...rest] = manifest.protocols;
  const doubled = [
    ...first.readOperationDescriptors,
    first.readOperationDescriptors[0],
  ];
  assert.match(
    problems(
      releaseGate({
        ...manifest,
        protocols: [
          {
            ...first,
            readOperationDescriptors: doubled,
            implementedReadOperations: doubled.map((operation) => operation.id),
          },
          ...rest,
        ],
      }),
    ),
    /more than once/,
  );
});

test('an operation list that does not match the descriptors is refused', () => {
  const manifest = releasable(pinned);
  const [first, ...rest] = manifest.protocols;
  assert.match(
    problems(
      releaseGate({
        ...manifest,
        protocols: [
          { ...first, implementedReadOperations: ['registry'] },
          ...rest,
        ],
      }),
    ),
    /lists operations its descriptors do not match/,
  );
});

test('a complete coverage claim is refused while an operation is unaccepted', () => {
  const manifest = releasable(pinned);
  const [first, ...rest] = manifest.protocols;
  assert.match(
    problems(
      releaseGate({
        ...manifest,
        protocols: [
          {
            ...first,
            coverage: 'complete',
            readOperationDescriptors: first.readOperationDescriptors.map(
              (operation, index) =>
                index === 0
                  ? { ...operation, acceptance: 'BLOCKED' }
                  : operation,
            ),
          },
          ...rest,
        ],
      }),
    ),
    /claims complete historical coverage with 1 operations not accepted/,
  );
});

test('a readable release label is refused while an operation is unaccepted', () => {
  const manifest = releasable(pinned);
  const [first, ...rest] = manifest.protocols;
  assert.match(
    problems(
      releaseGate({
        ...manifest,
        protocols: [
          {
            ...first,
            releaseStatus: 'VERIFIED READ ONLY',
            indexerAuthority: first.indexerAuthority ?? 'ord',
            readOperationDescriptors: first.readOperationDescriptors.map(
              (operation, index) =>
                index === 0
                  ? { ...operation, acceptance: 'NOT APPLICABLE' }
                  : operation,
            ),
          },
          ...rest,
        ],
      }),
    ),
    /carries release status VERIFIED READ ONLY with 1 operations not accepted/,
  );
});

test('blocked and not applicable are honest results, and neither is a pass', () => {
  const manifest = releasable(pinned);
  const [first, ...rest] = manifest.protocols;
  assert.match(
    problems(
      releaseGate({
        ...manifest,
        protocols: [
          {
            ...first,
            readOperationDescriptors: first.readOperationDescriptors.map(
              (operation, index) =>
                index === 0
                  ? { ...operation, acceptance: 'BLOCKED' }
                  : operation,
            ),
          },
          ...rest,
        ],
        acceptance: {
          ...manifest.acceptance,
          passed: manifest.acceptance.passed - 1,
          blocked: 1,
        },
      }),
    ),
    /1 blocked, 0 not applicable, 0 not tested/,
  );
});
