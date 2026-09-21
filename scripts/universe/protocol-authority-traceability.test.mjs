import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  buildTraceability,
  validateTraceability,
} from "./protocol-authority-traceability.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const manifestPath = path.resolve(
  root,
  "docs/protocols/PROTOCOL-COVERAGE.json",
);
const artifactPath = path.resolve(
  root,
  "docs/acceptance/protocol-authority-traceability-2026-09-21.json",
);

test("authority traceability retains every manifest protocol and operation without qualifying it", () => {
  const manifestBytes = readFileSync(manifestPath);
  const document = buildTraceability();
  assert.equal(validateTraceability(document, manifestBytes), true);
  assert.equal(document.protocols.length, 39);
  assert.equal(document.summary.operationCount, 123);
  assert.equal(document.summary.qualifiedProtocols, 0);
  assert(document.protocols.every((protocol) => protocol.status === "BLOCKED"));
  assert(
    document.protocols
      .flatMap((protocol) => protocol.operations)
      .every((operation) => operation.acceptance === "NOT TESTED"),
  );
});

test("stored authority traceability is current", () => {
  const manifestBytes = readFileSync(manifestPath);
  const stored = JSON.parse(readFileSync(artifactPath, "utf8"));
  assert.equal(validateTraceability(stored, manifestBytes), true);
  assert.deepEqual(stored, buildTraceability());
});

test("forged qualification is rejected even when the source binding remains intact", () => {
  const manifestBytes = readFileSync(manifestPath);
  const forged = structuredClone(buildTraceability());
  forged.summary.qualifiedProtocols = 39;
  forged.protocols[0].status = "PASS";
  assert.throws(() => validateTraceability(forged, manifestBytes));
});
