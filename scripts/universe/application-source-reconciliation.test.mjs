import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import {
  buildReconciliation,
  validateReconciliation,
} from "./application-source-reconciliation.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const currentPath = path.resolve(
  root,
  "docs/acceptance/operation-matrix-source-successor-2026-10-09.json",
);
const artifactPath = path.resolve(
  root,
  "docs/acceptance/application-source-reconciliation-2026-10-09.json",
);

test("application source reconciliation preserves the historical candidate set", () => {
  const currentBytes = readFileSync(currentPath);
  const document = buildReconciliation({
    currentArtifact:
      "docs/acceptance/operation-matrix-source-successor-2026-10-09.json",
  });
  validateReconciliation(document, currentBytes);
  assert.equal(document.historicalRowCount, 1592);
  assert.equal(document.currentMatrixRowCount, 1617);
  assert.equal(document.added.length, 25);
  assert.equal(document.changed.length, 19);
  const legacy = JSON.parse(
    readFileSync(
      path.resolve(
        root,
        "docs/acceptance/application-source-reconciliation-2026-09-21.json",
      ),
    ),
  );
  const additional = document.changed.filter(
    (row) => !legacy.changed.some((old) => old.id === row.id),
  );
  assert.deepEqual(additional.map((row) => row.id).sort(), [
    "PRO-17/activity",
    "PRO-17/registry",
  ]);
  for (const row of additional) {
    assert.deepEqual(row.before.requiredServices, ["index-op20"]);
    assert.deepEqual(row.after.requiredServices, ["index-op20-op-names"]);
    assert.equal(row.before.method, row.after.method);
    assert.equal(row.before.route, row.after.route);
    assert.deepEqual(row.before.assertions, row.after.assertions);
  }
  assert.deepEqual(document.removed, []);
});

test("stored application source reconciliation is current", () => {
  const currentBytes = readFileSync(currentPath);
  const stored = JSON.parse(readFileSync(artifactPath, "utf8"));
  assert.equal(validateReconciliation(stored, currentBytes), true);
  assert.deepEqual(
    stored,
    buildReconciliation({
      currentArtifact:
        "docs/acceptance/operation-matrix-source-successor-2026-10-09.json",
    }),
  );
});

test("v1 keeps its exact historical raw binding and refuses changed current source", () => {
  const old = JSON.parse(
    readFileSync(
      path.resolve(
        root,
        "docs/acceptance/application-source-reconciliation-2026-09-21.json",
      ),
    ),
  );
  const priorBytes = gunzipSync(
    readFileSync(
      path.resolve(
        root,
        "docs/acceptance/source-proof/source-ledger-v1-bound-f458.json.gz",
      ),
    ),
  );
  assert.equal(validateReconciliation(old, priorBytes), true);
  assert.throws(() => validateReconciliation(old, readFileSync(currentPath)));
});

test("v2 normalizes only source-ledger encoding and preserves strict raw archives", () => {
  const currentBytes = readFileSync(currentPath);
  const document = buildReconciliation({
    currentArtifact:
      "docs/acceptance/operation-matrix-source-successor-2026-10-09.json",
  });
  const lf = currentBytes.toString("utf8").replaceAll("\r\n", "\n");
  assert.equal(validateReconciliation(document, Buffer.from(lf)), true);
  assert.equal(
    validateReconciliation(document, Buffer.from(lf.replaceAll("\n", "\r\n"))),
    true,
  );
  const tampered = structuredClone(document);
  tampered.originalHistoricalGitProof.rawSha256 = "0".repeat(64);
  assert.throws(() => validateReconciliation(tampered, currentBytes));
  const altered = JSON.parse(currentBytes);
  altered.rows.pop();
  assert.throws(() =>
    validateReconciliation(document, Buffer.from(JSON.stringify(altered))),
  );
  assert.equal(document.semanticOperationDenominatorReconciled, false);
  assert.equal(document.sourceFreshness.semanticCompleteness, false);
});
