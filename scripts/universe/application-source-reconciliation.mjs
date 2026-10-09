import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { gunzipSync } from "node:zlib";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const currentMatrixFile = "docs/acceptance/operation-matrix-2026-09-06.json";
const outputFile =
  "docs/acceptance/application-source-reconciliation-2026-10-09.json";
const legacyOutputFile =
  "docs/acceptance/application-source-reconciliation-2026-09-21.json";
const activeMatrixFile =
  "docs/acceptance/operation-matrix-source-successor-2026-10-09.json";
const historicalProof = {
  path: "docs/acceptance/source-proof/source-ledger-original-1592-a391.json.gz",
  sha256: "9437c1ed33632b220d78faffa3df48c5133f11291edff342e3c95e5253da8280",
  rawSha256: "1ad07ca5aae8a7d07f812ece7d5179b1ca0d9deb91eb4682198a180c54f2cc0a",
  revision: "a391eff7c3d0f7f2f250d41d3921ece217620ac1",
};
const legacyProof = {
  path: "docs/acceptance/source-proof/source-reconciliation-v1-f90b.json.gz",
  sha256: "1c854c2ab479796ee3ea53aa5f19e9dff56b6176f417add55a1425517f531b7a",
  rawSha256: "e060899501919bf51795402d2cc2245ac2197ec0de8016fe81853b486b1be3b7",
  revision: "f90bbc3520a353107235b5acfda91c6f250d19a4",
};
const sourceDocumentHash = (bytes) =>
  sha256(Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n")));
const historicalSha256 =
  "1ad07ca5aa e8a7d07f812ece7d5179b1ca0d9de b91eb4682198a180c54f2cc0a".replaceAll(
    " ",
    "",
  );
const historicalArtifact =
  "mempool_HANDOFF_2026-09-21/inventory/application-source-candidates.json";
const contractFields = [
  "kind",
  "entry",
  "sourceFile",
  "operation",
  "method",
  "route",
  "routeTemplate",
  "role",
  "network",
  "requiredServices",
  "assertions",
  "remainingWork",
];
const operationKinds = new Set([
  "named-operation",
  "protocol-operation",
  "current-api-addition",
  "health-verification",
  "transaction-summary-variant",
  "admin-resource-variant",
  "admin-operation-variant",
  "portfolio-history-variant",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stable(value) {
  return JSON.stringify(value);
}

function contract(row) {
  return Object.fromEntries(
    contractFields
      .filter((field) => Object.hasOwn(row, field))
      .map((field) => [field, row[field]]),
  );
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function historicalSnapshot(rows) {
  return rows.map((row) => ({
    id: row.id,
    contract: contract(row),
  }));
}

function loadHistorical(historicalPath) {
  if (historicalPath) {
    const bytes = readFileSync(historicalPath);
    assert.equal(
      sha256(bytes),
      historicalSha256,
      "The supplied historical application-candidate artifact changed",
    );
    const document = JSON.parse(bytes.toString("utf8"));
    assert(
      Array.isArray(document.rows),
      "Historical application artifact has no rows",
    );
    return { rows: document.rows, snapshot: historicalSnapshot(document.rows) };
  }

  const existingPath = path.resolve(root, legacyOutputFile);
  assert(
    existsSync(existingPath),
    `Missing ${legacyOutputFile}; supply --historical on first generation`,
  );
  const existing = readJson(existingPath);
  assert.equal(
    existing.historicalSha256,
    historicalSha256,
    "Historical artifact binding changed",
  );
  assert(
    Array.isArray(existing.historicalSnapshot),
    "Reconciliation has no historical snapshot",
  );
  return {
    rows: existing.historicalSnapshot.map((row) => ({
      id: row.id,
      ...row.contract,
    })),
    snapshot: existing.historicalSnapshot,
  };
}

function archivedJson(proof) {
  const bytes = readFileSync(path.resolve(root, proof.path));
  assert.equal(sha256(bytes), proof.sha256, "Archived source proof drift");
  const raw = gunzipSync(bytes);
  assert.equal(sha256(raw), proof.rawSha256, "Archived raw Git blob drift");
  return JSON.parse(raw);
}

function plainCurrentPath(value) {
  assert(
    typeof value === "string" &&
      value.startsWith("docs/acceptance/") &&
      !value.includes("\\") &&
      !value.split("/").includes("..") &&
      value.endsWith(".json"),
    "Current ledger must be a plain acceptance JSON path",
  );
  return value;
}

export function buildReconciliation({
  historicalPath,
  currentArtifact = currentMatrixFile,
} = {}) {
  plainCurrentPath(currentArtifact);
  const currentPath = path.resolve(root, currentArtifact);
  const currentBytes = readFileSync(currentPath);
  const current = JSON.parse(currentBytes.toString("utf8"));
  assert(Array.isArray(current.rows), "Current operation matrix has no rows");
  const historical = loadHistorical(historicalPath);
  const original = archivedJson(historicalProof);
  assert.deepEqual(
    historical.snapshot,
    historicalSnapshot(original.rows),
    "Original historical source lineage drift",
  );
  assert.deepEqual(
    readJson(path.resolve(root, legacyOutputFile)),
    archivedJson(legacyProof),
    "Immutable v1 source reconciliation changed",
  );
  const historicalById = new Map(historical.rows.map((row) => [row.id, row]));
  const currentById = new Map(current.rows.map((row) => [row.id, row]));
  assert.equal(
    historicalById.size,
    historical.rows.length,
    "Historical candidate IDs are duplicated",
  );
  assert.equal(
    currentById.size,
    current.rows.length,
    "Current matrix IDs are duplicated",
  );

  const historicalIds = [...historicalById.keys()].sort();
  const currentIds = [...currentById.keys()].sort();
  const addedIds = currentIds.filter((id) => !historicalById.has(id));
  const removedIds = historicalIds.filter((id) => !currentById.has(id));
  const changed = [];
  for (const id of historicalIds) {
    const before = historicalById.get(id);
    const after = currentById.get(id);
    if (after && stable(contract(before)) !== stable(contract(after))) {
      changed.push({ id, before: contract(before), after: contract(after) });
    }
  }

  const sourceCandidateBindings = historicalIds.map((id) => {
    const row = currentById.get(id);
    assert(
      row,
      `Historical source candidate disappeared without a retirement record: ${id}`,
    );
    return {
      id,
      kind: row.kind,
      mappingStatus: operationKinds.has(row.kind)
        ? "OPERATION_ROW_UNVERIFIED"
        : "SOURCE_CANDIDATE_RETAINED_UNRESOLVED",
      acceptanceStatus: row.status ?? "NOT TESTED",
      role: row.role ?? null,
      network: row.network ?? "unverified",
      method: row.method ?? null,
      route: row.route ?? null,
      sourceArtifacts: [
        ...new Set((row.sources ?? []).map((source) => source.artifact)),
      ].sort(),
      linkedRows: [...new Set((row.links ?? []).map((link) => link.id))].sort(),
    };
  });

  const added = addedIds.map((id) => {
    const row = currentById.get(id);
    return {
      id,
      kind: row.kind,
      contract: contract(row),
      acceptanceStatus: row.status ?? "NOT TESTED",
    };
  });

  return {
    schemaVersion: "universe-application-source-reconciliation-v2",
    status: "SOURCE-PRESERVED / SEMANTIC-DENOMINATOR-UNRESOLVED",
    historicalArtifact,
    historicalSha256,
    historicalRowCount: historicalIds.length,
    historicalSnapshot: historical.snapshot,
    currentMatrixArtifact: currentArtifact,
    currentMatrixSha256: sourceDocumentHash(currentBytes),
    currentMatrixHashEncoding:
      "UTF-8 LF-normalized source-ledger text only; raw execution evidence is never normalized",
    originalHistoricalGitProof: {
      ...historicalProof,
      blobPath: currentMatrixFile,
    },
    priorV1GitProof: {
      ...legacyProof,
      blobPath: legacyOutputFile,
      expectedMatrixGitSha256:
        "4be18080cea60bf5ed6ab0a2bd8f35680068513824efdc1e4c33f0a0e205bde3",
    },
    baselineCause:
      "v1 correctly bound the f458505 matrix at f90bbc35. Later ddd791/4935/ad161/2d5/63402 source regenerations changed its bytes without refreshing v1. Current Git LF3a9 and Windows CRLF602 additionally differ by checkout encoding.",
    sourceFreshness: {
      status: "SOURCE_HASH_BINDING_ONLY_INVENTORY_SCOPE_UNRESOLVED",
      omissions: [
        "54ad protocol-coverage helper/types/templates are outside the existing path inventory",
        "f28 required-roster verifier is outside the application-operation inventory",
      ],
      semanticCompleteness: false,
    },
    currentMatrixRowCount: currentIds.length,
    sourceCandidateCount: historicalIds.length,
    semanticOperationDenominatorReconciled: false,
    policy:
      "Stable source candidates are preserved and individually bound to current rows; source presence, declarations and component records do not qualify functional acceptance or define the complete operation denominator.",
    added,
    changed,
    removed: removedIds,
    retiredWithProof: [],
    sourceCandidateBindings,
  };
}

export function validateReconciliation(document, currentBytes) {
  assert(
    [
      "universe-application-source-reconciliation-v1",
      "universe-application-source-reconciliation-v2",
    ].includes(document.schemaVersion),
  );
  assert.equal(document.historicalSha256, historicalSha256);
  assert.equal(document.historicalRowCount, 1592);
  assert.equal(document.sourceCandidateCount, document.historicalRowCount);
  assert.equal(document.semanticOperationDenominatorReconciled, false);
  assert.equal(
    document.removed.length,
    0,
    "A removed candidate needs an explicit retirement proof",
  );
  if (
    document.schemaVersion === "universe-application-source-reconciliation-v1"
  )
    assert.equal(document.currentMatrixSha256, sha256(currentBytes));
  else {
    assert.equal(
      document.currentMatrixSha256,
      sourceDocumentHash(currentBytes),
    );
    assert.equal(
      document.currentMatrixHashEncoding,
      "UTF-8 LF-normalized source-ledger text only; raw execution evidence is never normalized",
    );
    assert.deepEqual(document.originalHistoricalGitProof, {
      ...historicalProof,
      blobPath: currentMatrixFile,
    });
    assert.deepEqual(document.priorV1GitProof, {
      ...legacyProof,
      blobPath: legacyOutputFile,
      expectedMatrixGitSha256:
        "4be18080cea60bf5ed6ab0a2bd8f35680068513824efdc1e4c33f0a0e205bde3",
    });
    assert.deepEqual(
      document.historicalSnapshot,
      historicalSnapshot(archivedJson(historicalProof).rows),
    );
    assert.equal(document.sourceFreshness.semanticCompleteness, false);
  }
  assert.equal(document.historicalSnapshot.length, document.historicalRowCount);
  assert.equal(
    document.sourceCandidateBindings.length,
    document.historicalRowCount,
  );
  assert.equal(
    new Set(document.historicalSnapshot.map((row) => row.id)).size,
    document.historicalRowCount,
  );
  assert.equal(
    new Set(document.sourceCandidateBindings.map((row) => row.id)).size,
    document.historicalRowCount,
  );
  assert.deepEqual(
    document.added.map((row) => row.id).sort(),
    [
      "PRO-35/chain-detail",
      "PRO-35/chain-list",
      "PRO-35/events",
      "PRO-35/holders",
      ...["bitcoin", "dogecoin", "zcash"].flatMap((chain) =>
        [
          "confirmation",
          "incomplete-authority",
          "precision-conflict",
          "proven-empty",
          "reorg",
          "success",
          "timeout",
        ].map((variant) => `SUMMARY/transaction-assets/${chain}/${variant}`),
      ),
    ].sort(),
  );
  return true;
}

function parseArgs(args) {
  const result = {
    check: false,
    historicalPath: null,
    currentArtifact: activeMatrixFile,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--check") result.check = true;
    else if (arg === "--current")
      result.currentArtifact = plainCurrentPath(args[++index]);
    else if (arg === "--historical") {
      const value = args[++index];
      assert(
        value && !value.startsWith("--"),
        "--historical requires a file path",
      );
      result.historicalPath = path.resolve(value);
    } else {
      assert.fail(
        `Usage: application-source-reconciliation.mjs [--check] [--historical path] [--current docs/acceptance/ledger.json]`,
      );
    }
  }
  return result;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = parseArgs(process.argv.slice(2));
  const document = buildReconciliation(args);
  const currentBytes = readFileSync(path.resolve(root, args.currentArtifact));
  if (args.check) {
    const stored = readJson(path.resolve(root, outputFile));
    validateReconciliation(stored, currentBytes);
    assert.deepEqual(
      stored,
      document,
      "Application source reconciliation is stale; regenerate it",
    );
  } else {
    validateReconciliation(document, currentBytes);
    writeFileSync(
      path.resolve(root, outputFile),
      `${JSON.stringify(document, null, 2)}\n`,
    );
  }
  console.log(
    JSON.stringify(
      {
        artifact: outputFile,
        historicalRowCount: document.historicalRowCount,
        currentMatrixRowCount: document.currentMatrixRowCount,
        added: document.added.length,
        changed: document.changed.length,
        removed: document.removed.length,
        semanticOperationDenominatorReconciled:
          document.semanticOperationDenominatorReconciled,
      },
      null,
      2,
    ),
  );
}
