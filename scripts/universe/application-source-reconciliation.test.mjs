import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
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
  "docs/acceptance/operation-matrix-2026-09-06.json",
);
const artifactPath = path.resolve(
  root,
  "docs/acceptance/application-source-reconciliation-2026-09-21.json",
);

test("application source reconciliation preserves the historical candidate set", () => {
  const currentBytes = readFileSync(currentPath);
  const document = buildReconciliation();
  validateReconciliation(document, currentBytes);
  assert.equal(document.historicalRowCount, 1592);
  assert.equal(document.currentMatrixRowCount, 1617);
  assert.equal(document.added.length, 25);
  assert.equal(document.changed.length, 17);
  assert.deepEqual(document.removed, []);
});

test("stored application source reconciliation is current", () => {
  const currentBytes = readFileSync(currentPath);
  const stored = JSON.parse(readFileSync(artifactPath, "utf8"));
  assert.equal(validateReconciliation(stored, currentBytes), true);
  assert.deepEqual(stored, buildReconciliation());
});
