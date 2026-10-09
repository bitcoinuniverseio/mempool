import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rootedProofReader } from "./reconciled-operations.mjs";
import { qualifyApplication } from "./reconciled-release.mjs";
import {
  COVERAGE_PATH,
  HISTORICAL_PATH,
  ROSTER_PATH,
  buildRequiredApplicationRoster,
  validateRequiredApplicationRoster,
  validateRequiredApplicationCoverage,
  sortedIdsDigest,
} from "./required-application-roster.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const reader = rootedProofReader(root);
const cache = new Map();
const read = (path) => {
  if (!cache.has(path)) cache.set(path, reader(path));
  return cache.get(path);
};
const historicalBytes = read(HISTORICAL_PATH),
  coverageBytes = read(COVERAGE_PATH);
const build = () =>
  buildRequiredApplicationRoster(historicalBytes, coverageBytes, read);

test("actual carried roster preserves every632 requirement row and1617 historical source records", () => {
  const roster = build();
  const snapshot = JSON.parse(coverageBytes);
  assert.deepEqual(roster.historical, JSON.parse(historicalBytes));
  assert.equal(roster.requiredApplicationCoverage.coverageCount, 632);
  assert.deepEqual(
    roster.requiredApplicationCoverage.orderedCoverageIds,
    snapshot.rows.map((row) => row.coverageId),
  );
  assert.equal(roster.sourceCandidateCoverageLinks.length, 1625);
  assert.equal(roster.operations.length, 9);
  assert.equal(roster.mappings.length, 89);
  assert.equal(
    roster.requiredApplicationCoverage.mappings.filter(
      (row) => row.operationIds.length,
    ).length,
    47,
  );
  assert.equal(roster.operationDenominator, null);
  assert.equal(roster.operationDenominatorReconciled, false);
  assert.equal(roster.functionalAcceptance, false);
  assert(
    roster.operations.every(
      (row) => row.status === "NOT TESTED" && row.evidence.length === 0,
    ),
  );
  assert.equal(
    validateRequiredApplicationRoster(
      JSON.parse(read(ROSTER_PATH)),
      historicalBytes,
      coverageBytes,
      read,
    ),
    true,
  );
  const verified = validateRequiredApplicationCoverage(roster, read);
  assert.equal(verified.coverageCount, 632);
  assert.equal(
    verified.coverageIdsSha256,
    sortedIdsDigest(snapshot.rows.map((row) => row.coverageId)),
  );
  assert.equal(verified.mappingReviewComplete, false);
});

test("fee precision, bootstrap, socket, view and recovery retain separate exact semantics", () => {
  const roster = build();
  const byId = new Map(
    roster.operations.map((operation) => [operation.id, operation]),
  );
  assert.equal(
    byId.get("reviewed:signet-fees-rounded-rest").entryPoint,
    "/signet/api/v1/fees/recommended",
  );
  assert.equal(
    byId.get("reviewed:signet-fees-precise-rest").entryPoint,
    "/signet/api/v1/fees/precise",
  );
  assert.match(
    byId.get("reviewed:signet-fees-precise-rest").outputContract,
    /0\.001sat\/vB/,
  );
  assert.match(
    byId.get("reviewed:signet-fee-bootstrap").outputContract,
    /nullable legacy fees/,
  );
  assert.match(
    byId.get("reviewed:signet-fee-websocket").assertions.join(" "),
    /renew fee source age/,
  );
  assert.match(
    byId.get("reviewed:signet-fee-network-recovery").outputContract,
    /5s recovery or120s/,
  );
  const required = roster.requiredApplicationCoverage.mappings.find(
    (row) => row.coverageId === "APP-FEE-ESTIMATE",
  );
  assert.equal(required.operationIds.length, 6);
  assert.equal(required.mappingStatus, "PARTIALLY_REVIEWED_BLOCKED");
  assert(required.unresolved.length > 0);
  for (const id of ["API-acb46fc98372", "API-69f42dde6f4c", "API-d9ecd7443173"])
    assert(roster.mappings.some((mapping) => mapping.candidateId === id));
  assert.equal(roster.blockers.length, 2168);
  assert.equal(roster.functionalAcceptance, false);
});

test("one global registry read keeps all39 protocol-specific consumer requirements blocked", () => {
  const roster = build();
  const rows = roster.requiredApplicationCoverage.mappings.filter((row) =>
    row.coverageId.endsWith("-registry"),
  );
  assert.equal(rows.length, 39);
  assert(
    rows.every(
      (row) =>
        row.operationIds[0] === "reviewed:signet-registry-read" &&
        row.unresolved.length > 0 &&
        row.functionalAcceptance === false,
    ),
  );
  assert.equal(
    roster.requiredApplicationCoverage.counts.protocolOperationDeclarations,
    123,
  );
  assert.equal(roster.operations[0].method, "GET");
  assert.equal(roster.operations[1].method, "UI");
  assert.equal(roster.operations[2].method, "WS");
});

test("IDs, complete requirements, source lineage and fake acceptance cannot be dropped or promoted", () => {
  for (const mutate of [
    (r) => r.requiredApplicationCoverage.mappings.pop(),
    (r) => r.sourceCandidateCoverageLinks.pop(),
    (r) => r.historical.rows.pop(),
    (r) =>
      (r.requiredApplicationCoverage.mappings[0].fullRequirementSha256 =
        "0".repeat(64)),
    (r) =>
      (r.requiredApplicationCoverage.mappings[0].functionalAcceptance = true),
    (r) => (r.operationDenominatorReconciled = true),
  ]) {
    const roster = build();
    mutate(roster);
    assert.throws(() => validateRequiredApplicationCoverage(roster, read));
    assert.throws(() =>
      validateRequiredApplicationRoster(
        roster,
        historicalBytes,
        coverageBytes,
        read,
      ),
    );
  }
  const changed = JSON.parse(coverageBytes);
  changed.rows[0].expectedAssertions.pop();
  assert.throws(
    () =>
      validateRequiredApplicationCoverage(build(), (path) =>
        path === COVERAGE_PATH
          ? Buffer.from(JSON.stringify(changed))
          : read(path),
      ),
    /byte drift/,
  );
  assert.throws(
    () => validateRequiredApplicationCoverage({ operations: [] }, read),
    /snapshot is absent/,
  );
});

test("existing application gate refuses the actual unreconciled roster", () => {
  assert.throws(
    () =>
      qualifyApplication(
        Buffer.from(JSON.stringify(build())),
        {},
        Buffer.from("{}"),
        "0".repeat(40),
        read,
      ),
    /denominator is unresolved/,
  );
});

test("current source proof drift prevents semantic review regeneration", () => {
  assert.throws(
    () =>
      validateRequiredApplicationRoster(
        build(),
        historicalBytes,
        coverageBytes,
        (path) =>
          path === "frontend/src/app/bitcoin-clock-routes.ts"
            ? Buffer.from("changed")
            : read(path),
      ),
    /drift/,
  );
});

test("checkout line endings cannot change reviewed source or historical lineage", () => {
  const expected = build();
  const lfHistorical = Buffer.from(
    historicalBytes.toString("utf8").replaceAll("\r\n", "\n"),
  );
  const crlfHistorical = Buffer.from(
    lfHistorical.toString("utf8").replaceAll("\n", "\r\n"),
  );
  const alternateSourceReader = (path) =>
    path.startsWith("frontend/")
      ? Buffer.from(read(path).toString("utf8").replaceAll("\r\n", "\n"))
      : read(path);
  assert.deepEqual(
    buildRequiredApplicationRoster(
      lfHistorical,
      coverageBytes,
      alternateSourceReader,
    ),
    expected,
  );
  assert.deepEqual(
    buildRequiredApplicationRoster(
      crlfHistorical,
      coverageBytes,
      alternateSourceReader,
    ),
    expected,
  );
});
