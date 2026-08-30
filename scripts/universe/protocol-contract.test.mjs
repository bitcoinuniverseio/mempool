import assert from 'node:assert/strict';
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
  assert.match(block, /6 of the 38 protocols in the registry are readable/);
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
  assert.equal(row.split(/(?<!\\)\|/).length - 1, 7);
});

test('a served roster identical to the pin reports nothing', () => {
  assert.deepEqual(
    diffManifests(comparable(pinned), comparable(pinned)).problems,
    [],
  );
});
