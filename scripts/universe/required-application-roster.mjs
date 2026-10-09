import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  reconcileOperations,
  rootedProofReader,
} from "./reconciled-operations.mjs";

export const COVERAGE_PATH =
  "docs/acceptance/required-application-coverage-2026-10-09.json";
export const COVERAGE_SHA256 =
  "a668b4819f96840621309399ebcfe47bb291a1aaa1cb57053a374102cf141901";
export const HISTORICAL_PATH =
  "docs/acceptance/operation-matrix-2026-09-06.json";
export const ROSTER_PATH = "docs/acceptance/reconciled-operations.json";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const sortedIdsDigest = (ids) =>
  digest(Buffer.from(JSON.stringify([...ids].sort())));
const registrySource = "docs/acceptance/source-proof/backend-apis-e53604da/";
const metadataSource =
  "docs/acceptance/source-proof/registry-metadata-2026-10-09/";
const frontendSource =
  "docs/acceptance/source-proof/mempool-reviewed-2026-10-09/";
const historicalRawPath =
  "docs/acceptance/source-proof/historical-source-candidates-reviewed-2026-10-09.json.gz";
const historicalCompressedSha256 =
  "6c40b8996e28c90e4e074b22ac8fa2ae9175e6546ee97cc6415b813ff6bc1969";
const historicalRawSha256 =
  "602c73f86f2ef58b14a9ddf178814264989c281f9048aa29ab0bc03f23d3a9a1";
const lfBytes = (bytes) =>
  Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n"));

/** This successor carries the complete required coverage, but cannot grant
 * semantic reconciliation or functional acceptance from source declarations.
 * A reviewed selected-context definition is not the full consumer/variant row.
 */
export function buildRequiredApplicationRoster(
  historicalBytes,
  coverageBytes,
  readProof,
) {
  assert.equal(
    digest(coverageBytes),
    COVERAGE_SHA256,
    "Required coverage snapshot byte drift",
  );
  const coverage = JSON.parse(coverageBytes.toString("utf8"));
  const historical = JSON.parse(historicalBytes.toString("utf8"));
  const archivedHistorical = readProof(historicalRawPath);
  assert.equal(
    digest(archivedHistorical),
    historicalCompressedSha256,
    "Archived raw historical proof drift",
  );
  const rawHistorical = gunzipSync(archivedHistorical);
  assert.equal(
    digest(rawHistorical),
    historicalRawSha256,
    "Raw historical proof bytes drift",
  );
  assert.deepEqual(
    JSON.parse(rawHistorical),
    historical,
    "Current historical source lineage changed from reviewed raw proof",
  );
  assert.equal(coverage.rows.length, 632);
  assert.equal(new Set(coverage.rows.map((row) => row.coverageId)).size, 632);
  assert.equal(historical.rows.length, 1617);
  const requiredFields = coverage.requiredFields;
  for (const row of coverage.rows) {
    for (const field of requiredFields)
      assert(
        Object.hasOwn(row, field),
        `Lost required field ${row.coverageId}/${field}`,
      );
    assert(
      Array.isArray(row.expectedAssertions) &&
        row.expectedAssertions.length > 0,
    );
    assert(Array.isArray(row.executionSteps) && row.executionSteps.length > 0);
  }
  const protocols = coverage.rows.filter(
    (row) => row.category === "protocol-operation",
  );
  assert.equal(protocols.length, 123);
  assert.equal(
    new Set(protocols.map((row) => row.entryPoint.protocol)).size,
    39,
  );
  const proof = (paths) =>
    paths.map((path) => ({ path, sha256: digest(readProof(path)) }));
  const registryProof = proof([
    registrySource + "registry/explorer-protocol-registry.ts",
    registrySource + "registry/explorer-protocol-manifest.ts",
    registrySource + "universe-explorer.controller.ts",
    metadataSource + "mounted-signet-registry-protocols.json",
  ]);
  const currentSourceBindings = [];
  const frontendProof = (paths) =>
    proof(
      paths.map((path) => {
        const snapshotPath = frontendSource + path;
        const currentHash = digest(lfBytes(readProof(path)));
        assert.equal(
          digest(readProof(snapshotPath)),
          currentHash,
          `Current source proof drift: ${path}`,
        );
        currentSourceBindings.push({
          path,
          snapshotPath,
          sha256: currentHash,
          encoding: "UTF-8 LF-normalized source, frozen snapshot bytes",
        });
        return snapshotPath;
      }),
    );
  const clockProof = frontendProof([
    "frontend/src/app/bitcoin-clock-routes.ts",
    "frontend/src/app/app-routing.module.ts",
    "frontend/src/app/components/clock/clock.component.ts",
    "frontend/src/app/services/state.service.ts",
  ]);
  const websocketProof = frontendProof([
    "frontend/src/app/services/websocket.service.ts",
    "frontend/src/app/services/websocket-response-scope.ts",
  ]);
  const common = {
    role: "public-reader",
    chain: "bitcoin",
    network: "signet",
    specificationRevision:
      "implementation-handoff-2026-10-09/API-03/API-04/API-05/API-06",
    owner: "Application and source contract owners",
    prerequisites: [
      "Candidate identity pinned",
      "Owned source context verified",
      "Complete required-row variants reviewed separately",
    ],
  };
  const operations = [
    {
      ...common,
      id: "reviewed:signet-registry-read",
      method: "GET",
      entryPoint: "/api/v1/universe/protocols?chain=bitcoin&network=signet",
      inputContract:
        "Validated selected Bitcoin Signet query; no wallet, pagination or source data identifier",
      outputContract:
        "universe-explorer-protocol-manifest-v1: sourceSha, registry1.1.0, global39 identities and123 descriptors; declarations include other-chain/Mainnet networks and are not runtime availability",
      lifecycle:
        "Read global declared roster through same-origin selected-context query; compare each identity and descriptor pin; do not promote native readiness or consumer journeys",
      expectedResult:
        "Exact global declaration roster, with every per-protocol requirement retained; no protocol data or functionality inferred",
      inputs: [
        "chain=bitcoin,network=signet",
        "All39 required protocol IDs and123 declared operation keys",
      ],
      execution: [
        "Read the mounted manifest and compare all declarations",
        "Exercise each required consumer and lifecycle variant under its own required coverage row before functional acceptance",
      ],
      assertions: [
        "Global GET retains all39 identities/123 descriptors",
        "Selected context validates without Mainnet data fallback",
        "Capability declarations do not establish availability",
        "All39 protocol-specific display, drift, recovery and context obligations remain separate required rows",
      ],
      sources: registryProof,
    },
    {
      ...common,
      id: "reviewed:signet-clock-route",
      method: "UI",
      entryPoint: "/signet/clock/:mode/:index",
      inputContract:
        "Existing Clock modes/indexes under selected Signet parent; relative default clock/mempool/0; selected StateService network/unit",
      outputContract:
        "Existing Clock block/mempool display and fee quality state inherited from selected-context shared state; unavailable source never establishes current fees",
      lifecycle:
        "Direct link, refresh, relative redirect, network switch and shared feed freshness; root and other offered network variants remain required",
      expectedResult:
        "Clock resolves within Signet context and inherits the existing selected unit and bounded availability state",
      inputs: [
        "/signet/clock",
        "/signet/clock/mempool/0",
        "Explicit wrong/stale source context",
      ],
      execution: [
        "Resolve actual network-parent route before fallback",
        "Validate Clock state after refresh/switch and independent feed expiry",
      ],
      assertions: [
        "Signet prefix persists through defaults",
        "Root Clock routes and other offered parents are retained",
        "Shared source metadata gates current fee display",
        "Full APP-CLOCK variants require separate functional proof",
      ],
      sources: clockProof,
    },
    {
      ...common,
      id: "reviewed:signet-core-websocket",
      method: "WS",
      entryPoint: "/signet/api/v1/ws",
      inputContract:
        "Base WebsocketResponse in captured socket/context generation, explicit network and backendInfo.chainSync claims, live metadata and legitimate auxiliary messages",
      outputContract:
        "Selected Signet block/mempool/address/shared state only after scope ingress validation; missing current-data proof remains bounded unavailable",
      lifecycle:
        "Bootstrap, subscribe, rapid A-B-A switch, reconnect, old callbacks, owned timers and HTTP closure cancellation",
      expectedResult:
        "Foreign explicit claims reject before any shared state mutation; replacements retain their own context; legitimate auxiliary messages remain usable",
      inputs: [
        "Selected Signet socket",
        "Correctly scoped socket with wrong frame metadata",
        "Late prior socket callback and bootstrap response",
      ],
      execution: [
        "Validate whole frame before block/mempool/address writes",
        "Switch and reconnect through real socket lifecycle",
        "Verify missing metadata and auxiliary frame behavior",
      ],
      assertions: [
        "Wrong network or Core chain claim is rejected before mutation",
        "Old subscription callbacks cannot affect replacement context",
        "Current data requires versioned source proof",
        "Remaining APP-CORE-WS consumer/recovery variants require functional receipts",
      ],
      sources: websocketProof,
    },
  ];
  const currentSourceCandidates = [
    {
      id: "current:clock-network-routes-20261009",
      reason:
        "Current scoped Clock helper introduced after historical source inventory",
      sources: clockProof,
    },
    {
      id: "current:base-websocket-scope-ingress-20261009",
      reason:
        "Current whole-frame scope validation and owned lifecycle guards require distinct current source lineage",
      sources: websocketProof,
    },
  ];
  const mappings = historical.rows
    .filter(
      (row) =>
        (row.kind === "protocol-operation" && row.operation === "registry") ||
        row.kind === "protocol-identity",
    )
    .map((row) => ({
      candidateId: row.id,
      operationIds: ["reviewed:signet-registry-read"],
      reason:
        "Reviewed global registry declaration identity only. Historical status and per-protocol consumer/lifecycle/context obligations are not inherited as functional acceptance.",
      sources: registryProof,
    }));
  assert.equal(mappings.length, 78);
  mappings.push(
    {
      candidateId: currentSourceCandidates[0].id,
      operationIds: [operations[1].id],
      reason:
        "Current exact network-parent helper and Clock/StateService define this selected-context UI operation, with remaining required variants blocked.",
      sources: clockProof,
    },
    {
      candidateId: currentSourceCandidates[1].id,
      operationIds: [operations[2].id],
      reason:
        "Current base socket ingress and lifecycle implementation define a separate WS operation; no source test becomes functional acceptance.",
      sources: websocketProof,
    },
  );
  const roster = reconcileOperations(
    historical,
    {
      schemaVersion: "universe-semantic-operation-review-v1",
      operations,
      mappings,
      currentSourceCandidates,
    },
    readProof,
  );
  roster.historicalArtifactSha256 = digest(lfBytes(historicalBytes));
  roster.historicalArtifactHashEncoding =
    "UTF-8 LF-normalized historical artifact text; complete parsed historical records retained unchanged";
  roster.historicalArtifact = HISTORICAL_PATH;
  roster.historicalRawProvenance = {
    path: historicalRawPath,
    sha256: historicalCompressedSha256,
    encoding: "gzip of original raw historical source-candidate artifact bytes",
    decompressedSha256: historicalRawSha256,
    bytes: rawHistorical.length,
    scope:
      "Current 1617-row source-candidate document at review time; not the unrecovered original243-row acceptance bundle",
  };
  roster.currentSourceBindings = currentSourceBindings;
  const candidateMap = new Map(
    mappings.map((mapping) => [mapping.candidateId, mapping.operationIds]),
  );
  const requiredMappings = coverage.rows.map((row, index) => {
    let operationIds = [];
    let candidateIds = [];
    let basis =
      "No exact reviewed source operation/context/lifecycle mapping exists for this entire required row.";
    if (
      row.category === "protocol-operation" &&
      row.entryPoint.operation === "registry"
    ) {
      candidateIds = historical.rows
        .filter(
          (candidate) =>
            candidate.kind === "protocol-operation" &&
            candidate.protocol === row.entryPoint.protocol &&
            candidate.operation === "registry",
        )
        .map((candidate) => candidate.id);
      operationIds = [operations[0].id];
      basis =
        "Exact protocol registry declaration is reviewed many-to-one; per-protocol display/recovery/consumer/context requirements are preserved and remain unresolved.";
    } else if (row.coverageId === "APP-CLOCK") {
      candidateIds = [currentSourceCandidates[0].id];
      operationIds = [operations[1].id];
      basis =
        "Current selected Signet route/UI contract reviewed; full root/other-network/consumer/lifecycle variants remain unresolved.";
    } else if (row.coverageId === "APP-CORE-WS") {
      candidateIds = [currentSourceCandidates[1].id];
      operationIds = [operations[2].id];
      basis =
        "Current selected Signet base socket contract reviewed; full consumer/channel/lifecycle/context variants remain unresolved.";
    }
    return {
      coverageId: row.coverageId,
      rowPointer: `/rows/${index}`,
      fullRequirementSha256: digest(Buffer.from(JSON.stringify(row))),
      mappingStatus: operationIds.length
        ? "PARTIALLY_REVIEWED_BLOCKED"
        : "BLOCKED_UNRESOLVED",
      candidateIds,
      operationIds,
      basis,
      unresolved: [
        "All original executionSteps/expectedAssertions/testInputs/prerequisites/network variants remain required",
        "Complete semantic mapping of the required consumer, lifecycle and context variants",
        "Candidate-bound functional receipt after supported-context execution",
      ],
      functionalAcceptance: false,
    };
  });
  roster.requiredApplicationCoverage = {
    schemaVersion: "universe-required-application-coverage-v1",
    snapshot: {
      path: COVERAGE_PATH,
      sha256: COVERAGE_SHA256,
      hashEncoding: "raw-bytes",
    },
    coverageCount: 632,
    orderedCoverageIds: coverage.rows.map((row) => row.coverageId),
    sortedCoverageIdsSha256: sortedIdsDigest(
      coverage.rows.map((row) => row.coverageId),
    ),
    sortedIdsHashEncoding: "UTF-8 JSON.stringify sorted ID array",
    counts: { protocols: 39, protocolOperationDeclarations: 123 },
    requiredFields: structuredClone(requiredFields),
    mappings: requiredMappings,
    mappingReviewComplete: false,
    countingPolicy:
      "Required coverage rows are not source candidates or the unresolved semantic operation denominator.",
  };
  roster.sourceCandidateCoverageLinks = [
    ...historical.rows,
    ...currentSourceCandidates,
  ].map((candidate) => ({
    candidateId: candidate.id,
    reviewedOperationIds: candidateMap.get(candidate.id) ?? [],
    coverageIds: requiredMappings
      .filter((mapping) => mapping.candidateIds.includes(candidate.id))
      .map((mapping) => mapping.coverageId),
    status: candidateMap.has(candidate.id)
      ? "SELECTED_DEFINITION_REVIEWED_REQUIRED_VARIANTS_BLOCKED"
      : "BLOCKED_UNRESOLVED",
    functionalAcceptance: false,
  }));
  roster.blockers.push(
    ...requiredMappings.map((mapping) => ({
      coverageId: mapping.coverageId,
      kind: "required-application-coverage",
      reason: mapping.basis,
      unresolved: mapping.unresolved,
    })),
  );
  roster.operationDenominatorReconciled = false;
  roster.operationDenominator = null;
  roster.reviewedSelectedOperationDefinitions = operations.length;
  roster.functionalAcceptance = false;
  roster.reviewVersion = "required-application-roster-2026-10-09-v1";
  return roster;
}

export function validateRequiredApplicationRoster(
  roster,
  historicalBytes,
  coverageBytes,
  readProof,
) {
  const expected = buildRequiredApplicationRoster(
    historicalBytes,
    coverageBytes,
    readProof,
  );
  assert.deepEqual(
    roster,
    expected,
    "Required coverage/source lineage/semantic review drift or premature acceptance",
  );
  return true;
}

/** Shared fail-closed binding for release/projector consumers. It verifies the
 * full snapshot and row requirements, not just a literal count or ID digest.
 * The existing application gate remains separately mandatory.
 */
export function validateRequiredApplicationCoverage(roster, readProof) {
  const required = roster.requiredApplicationCoverage;
  assert(required, "Required application coverage snapshot is absent");
  assert.equal(
    required.schemaVersion,
    "universe-required-application-coverage-v1",
  );
  assert.equal(required.snapshot?.path, COVERAGE_PATH);
  assert.equal(required.snapshot?.sha256, COVERAGE_SHA256);
  const bytes = readProof(required.snapshot.path);
  assert.equal(
    digest(bytes),
    COVERAGE_SHA256,
    "Required coverage snapshot byte drift",
  );
  const snapshot = JSON.parse(bytes.toString("utf8"));
  assert.equal(snapshot.rows.length, 632);
  const ids = snapshot.rows.map((row) => row.coverageId);
  assert.equal(new Set(ids).size, 632);
  assert.equal(required.coverageCount, 632);
  assert.deepEqual(
    required.orderedCoverageIds,
    ids,
    "Required coverage IDs lost or reordered",
  );
  assert.equal(required.sortedCoverageIdsSha256, sortedIdsDigest(ids));
  assert.deepEqual(required.requiredFields, snapshot.requiredFields);
  assert.deepEqual(required.counts, {
    protocols: 39,
    protocolOperationDeclarations: 123,
  });
  assert.equal(
    snapshot.rows.filter((row) => row.category === "protocol-operation").length,
    123,
  );
  assert.equal(
    new Set(
      snapshot.rows
        .filter((row) => row.category === "protocol-operation")
        .map((row) => row.entryPoint.protocol),
    ).size,
    39,
  );
  assert(Array.isArray(required.mappings));
  assert.deepEqual(
    required.mappings.map((row) => row.coverageId),
    ids,
    "Required coverage mappings lost or duplicated",
  );
  const operationIds = new Set(roster.operations.map((row) => row.id));
  const candidateIds = new Set(
    [...roster.historical.rows, ...(roster.currentSourceCandidates ?? [])].map(
      (row) => row.id,
    ),
  );
  assert.equal(
    candidateIds.size,
    roster.historical.rows.length +
      (roster.currentSourceCandidates ?? []).length,
    "Source candidate IDs repeat",
  );
  const linkedCandidates = roster.sourceCandidateCoverageLinks;
  assert(Array.isArray(linkedCandidates));
  assert.deepEqual(
    linkedCandidates.map((row) => row.candidateId).sort(),
    [...candidateIds].sort(),
    "Required source lineage lost or duplicated",
  );
  for (const linked of linkedCandidates) {
    const semantic = roster.mappings.find(
      (mapping) => mapping.candidateId === linked.candidateId,
    );
    assert.deepEqual(
      linked.reviewedOperationIds,
      semantic?.operationIds ?? [],
      "Reviewed source lineage operation drift",
    );
    assert.deepEqual(
      linked.coverageIds,
      required.mappings
        .filter((mapping) => mapping.candidateIds.includes(linked.candidateId))
        .map((mapping) => mapping.coverageId),
      "Required coverage/source lineage drift",
    );
  }
  const fullyReviewed = required.mappingReviewComplete === true;
  if (roster.operationDenominatorReconciled === true)
    assert(fullyReviewed, "Required application coverage review is unresolved");
  const completeIndices = (actual, values, label) =>
    assert.deepEqual(
      actual,
      values.map((_, index) => index),
      `Required ${label} coverage is incomplete`,
    );
  required.mappings.forEach((mapping, index) => {
    const row = snapshot.rows[index];
    assert.equal(mapping.rowPointer, `/rows/${index}`);
    assert.equal(
      mapping.fullRequirementSha256,
      digest(Buffer.from(JSON.stringify(row))),
      "Required assertions/steps/variants drift",
    );
    for (const field of snapshot.requiredFields)
      assert(Object.hasOwn(row, field));
    assert(
      Array.isArray(mapping.operationIds) &&
        Array.isArray(mapping.candidateIds),
    );
    assert.equal(
      new Set(mapping.operationIds).size,
      mapping.operationIds.length,
    );
    assert.equal(
      new Set(mapping.candidateIds).size,
      mapping.candidateIds.length,
    );
    for (const id of mapping.operationIds)
      assert(operationIds.has(id), "Required mapping operation is absent");
    for (const id of mapping.candidateIds)
      assert(candidateIds.has(id), "Required mapping candidate is absent");
    assert(Array.isArray(mapping.unresolved));
    if (fullyReviewed) {
      assert.equal(mapping.mappingStatus, "REVIEWED");
      assert.equal(
        mapping.unresolved.length,
        0,
        "Required mapping variants remain unresolved",
      );
      assert(
        mapping.operationIds.length > 0 && mapping.candidateIds.length > 0,
      );
      completeIndices(
        mapping.coveredAssertionIndices,
        row.expectedAssertions,
        "assertion",
      );
      completeIndices(
        mapping.coveredExecutionStepIndices,
        row.executionSteps,
        "execution step",
      );
      completeIndices(mapping.coveredInputIndices, row.testInputs, "input");
      completeIndices(
        mapping.coveredPrerequisiteIndices,
        row.prerequisites,
        "prerequisite",
      );
      assert.deepEqual(
        mapping.reviewedNetworkPolicy,
        row.network,
        "Required context variants were dropped",
      );
      assert.deepEqual(
        mapping.reviewedRolePolicy,
        { role: row.role, wallet: row.wallet },
        "Required role/wallet variants were dropped",
      );
    } else {
      assert.equal(
        mapping.functionalAcceptance,
        false,
        "Incomplete coverage cannot claim functional acceptance",
      );
      assert(
        mapping.unresolved.length > 0,
        "Unreviewed required row needs an explicit blocker",
      );
      assert(
        ["PARTIALLY_REVIEWED_BLOCKED", "BLOCKED_UNRESOLVED"].includes(
          mapping.mappingStatus,
        ),
      );
    }
  });
  return {
    coverageCount: 632,
    coverageIdsSha256: required.sortedCoverageIdsSha256,
    snapshotSha256: COVERAGE_SHA256,
    mappingReviewComplete: fullyReviewed,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const cache = new Map();
  const rooted = rootedProofReader(root);
  const read = (path) => {
    if (!cache.has(path)) cache.set(path, rooted(path));
    return cache.get(path);
  };
  const roster = buildRequiredApplicationRoster(
    read(HISTORICAL_PATH),
    read(COVERAGE_PATH),
    read,
  );
  if (process.argv.includes("--check"))
    validateRequiredApplicationRoster(
      JSON.parse(read(ROSTER_PATH)),
      read(HISTORICAL_PATH),
      read(COVERAGE_PATH),
      read,
    );
  else
    writeFileSync(
      resolve(root, ROSTER_PATH),
      JSON.stringify(roster, null, 2) + "\n",
      { flag: "wx" },
    );
  console.log(
    JSON.stringify({
      requiredCoverage: 632,
      historicalCandidates: 1617,
      currentCandidates: 2,
      reviewedSelectedDefinitions: roster.operations.length,
      partiallyReviewedCoverage:
        roster.requiredApplicationCoverage.mappings.filter(
          (row) => row.operationIds.length,
        ).length,
      blockers: roster.blockers.length,
      operationDenominatorReconciled: false,
      operationDenominator: null,
      functionalAcceptance: false,
    }),
  );
}
