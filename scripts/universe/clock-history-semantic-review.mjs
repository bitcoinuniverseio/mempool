import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
const hash = (b) => createHash("sha256").update(b).digest("hex");
export const CLOCK_HISTORY_PREFIX =
  "docs/acceptance/source-proof/clock-history-ac8ec2a64-2026-10-09/";
const clockPaths = [
  "frontend/src/app/components/clock/clock.component.ts",
  "frontend/src/app/components/clock/clock.component.html",
  "frontend/src/app/components/clock/clock-routing-history.spec.ts",
];
export const clockSnapshotPath = (path, fallback) =>
  clockPaths.includes(path) ? CLOCK_HISTORY_PREFIX + path : fallback;

/** Source semantics only. Historical actual failures remain failures. */
export function clockHistorySemanticReview(historical, common, readProof) {
  const bindings = clockPaths.map((path) => {
    const snapshotPath = CLOCK_HISTORY_PREFIX + path;
    const sha256 = hash(
      Buffer.from(readProof(path).toString("utf8").replaceAll("\r\n", "\n")),
    );
    assert.equal(
      hash(readProof(snapshotPath)),
      sha256,
      `Current Clock history source proof drift: ${path}`,
    );
    return {
      path,
      snapshotPath,
      sha256,
      encoding: "UTF-8 LF-normalized source, frozen snapshot bytes",
    };
  });
  const archivePath =
    CLOCK_HISTORY_PREFIX + "prior-nine-definition-roster.json.gz";
  const bytes = readProof(archivePath);
  assert.equal(
    hash(bytes),
    "70956404f50ae56de8818220a2d7e6bcaae3622a3e386f2802efcbd7c11277c9",
  );
  const raw = gunzipSync(bytes);
  assert.equal(
    hash(raw),
    "ac0b51a7e8e817fd7d7083aaa9c8384ddbe2d9daf75cda1a8db308886c316795",
  );
  const prior = JSON.parse(raw);
  assert.equal(prior.operations.length, 9);
  assert.deepEqual(prior.historical, historical);
  const failurePath =
    CLOCK_HISTORY_PREFIX + "clock-1501-actual-history-defect.json";
  const failureBytes = readProof(failurePath);
  assert.equal(
    hash(failureBytes),
    "9bfa568f2768db1ed62de17efeb790741a12c404a58632eb6e755d8968b9b8fa",
  );
  const failure = JSON.parse(failureBytes);
  assert.equal(failure.actualResult, "FAIL");
  assert.equal(
    failure.sourceCommit,
    "1501dbc53067ca0e69b440bc15bcee6e18a86b49",
  );
  const consolePath =
    CLOCK_HISTORY_PREFIX + "clock-1501-out-of-window-console.json";
  assert.equal(
    hash(readProof(consolePath)),
    "f6f76dd0af13c2bc887e16f5251c02235988edb7dc390375c56507d7509c4f73",
  );
  const sources = bindings.map((b) => ({
    path: b.snapshotPath,
    sha256: b.sha256,
  }));
  const definition = {
    ...common,
    id: "reviewed:signet-clock-history-window",
    method: "UI",
    entryPoint: "/signet/clock/:mode/:index",
    inputContract:
      "Offered block alias, mined/mempool modes, query/fragment, back/forward, malformed or positive safe integer index, observed mined window and configured projected window",
    outputContract:
      "Replace alias/invalid index history entry while preserving selected network/query/fragment; valid out-of-window index retained with explicit unavailable UI when observed blocks exist; never invent block zero or dereference absent height/size/tx_count",
    lifecycle:
      "Direct navigation, alias normalization, back/back/forward/forward, refresh, observed block-window changes and existing shared fee availability; source revision ac8ec2a645520ac58e007f5a974561e12e65928d",
    expectedResult:
      "Correct source semantics and controlled Router regression tests; separate actual bounded repair validation is PASS, while complete required APP-CLOCK acceptance remains NOT TESTED",
    inputs: [
      "block/0?stats=false#clock",
      "-1, nonnumeric, fractional, suffixed and unsafe index",
      "mined/15 versus mined/999",
      "mempool/7 versus mempool/8 with default8; configured12/index11",
      "empty or shortened observed window",
    ],
    execution: [
      "Use actual scoped router and Clock template",
      "Normalize through replaceUrl preserving query/fragment; exercise real popstate",
      "Keep positive index and gate every block dereference through selectedBlock",
      "Compare future actual bundle against preserved actual1501 failure separately",
    ],
    assertions: [
      "Whole-decimal nonnegative safe integer parsing; invalid values become zero",
      "Selected network/query/fragment and forward history persist",
      "Mined availability follows observed slice of at most16blocks",
      "Projected availability follows configured positive safe integer capacity, default8 only when invalid configuration",
      "No absent-block crash or valid out-of-window block0 fallback",
      "All original APP-CLOCK variants and candidate-bound functional proof remain unresolved",
    ],
    sources,
  };
  const candidate = {
    id: "current:clock-history-window-ac8ec2-20261009",
    reason:
      "Distinct current alias/history and safe window semantics after actual1501 failures; source checks do not establish functionality",
    sources,
  };
  const mapping = {
    candidateId: candidate.id,
    operationIds: [definition.id],
    reason: candidate.reason,
    sources,
  };
  const repairedPath =
    CLOCK_HISTORY_PREFIX + "clock-ac8-actual-repair-readback.json";
  const repairedBytes = readProof(repairedPath);
  assert.equal(
    hash(repairedBytes),
    "41e1d264a73416a64d8ff989e09d98e1f7bc5af1e52b0fe3589963f24e7bf955",
  );
  const repaired = JSON.parse(repairedBytes);
  assert.equal(repaired.result, "PASS");
  assert.equal(
    repaired.frontendSource,
    "ac8ec2a645520ac58e007f5a974561e12e65928d",
  );
  assert.equal(repaired.fullRequiredOperationAcceptance, false);
  const lineage = {
    schemaVersion: "universe-clock-history-semantic-lineage-v1",
    sourceRevision: "ac8ec2a645520ac58e007f5a974561e12e65928d",
    previousRoster: {
      path: archivePath,
      sha256: hash(bytes),
      decompressedSha256: hash(raw),
      encoding: "gzip original raw roster bytes",
      reviewedDefinitionCount: 9,
    },
    historicalActualFailure: {
      sourceRevision: failure.sourceCommit,
      result: "FAIL",
      evidence: [
        { path: failurePath, sha256: hash(failureBytes) },
        { path: consolePath, sha256: hash(readProof(consolePath)) },
      ],
    },
    requiredClockFunctionalAcceptance: "NOT TESTED",
    boundedRepairValidation: {
      sourceRevision: repaired.frontendSource,
      result: repaired.result,
      scope: repaired.scope,
      fullRequiredOperationAcceptance: false,
      evidence: { path: repairedPath, sha256: hash(repairedBytes) },
    },
    functionalAcceptance: false,
  };
  return { definition, candidate, mapping, bindings, lineage };
}
