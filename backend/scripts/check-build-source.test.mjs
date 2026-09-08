import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scriptPath = fileURLToPath(
  new URL("./check-build-source.mjs", import.meta.url)
);
const tempBase = resolve(tmpdir());

function createSourceTree(context) {
  const sourceRoot = mkdtempSync(join(tempBase, "mempool-build-source-"));
  const resolvedRoot = resolve(sourceRoot);

  context.after(() => {
    const isOwnedTempPath =
      resolvedRoot.startsWith(`${tempBase}${sep}`) &&
      basename(resolvedRoot).startsWith("mempool-build-source-");
    assert.equal(isOwnedTempPath, true);
    rmSync(resolvedRoot, { recursive: true, force: true });
  });

  return resolvedRoot;
}

function runCheck(sourceRoot) {
  return spawnSync(process.execPath, [scriptPath, sourceRoot], {
    encoding: "utf8",
  });
}

test("accepts source trees without spec files", (context) => {
  const sourceRoot = createSourceTree(context);
  const nestedDirectory = join(sourceRoot, "feature");
  mkdirSync(nestedDirectory);
  writeFileSync(join(sourceRoot, "service.ts"), "export const value = true;\n");
  writeFileSync(
    join(nestedDirectory, "service.test.ts"),
    "export const testValue = true;\n"
  );

  const result = runCheck(sourceRoot);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("rejects nested spec files and reports their paths", (context) => {
  const sourceRoot = createSourceTree(context);
  const nestedDirectory = join(sourceRoot, "feature");
  mkdirSync(nestedDirectory);
  writeFileSync(
    join(nestedDirectory, "service.spec.ts"),
    "export const fixture = true;\n"
  );

  const result = runCheck(sourceRoot);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /files ending in \.spec\.ts are not allowed/);
  assert.match(result.stderr, /feature[\\/]service\.spec\.ts/);
});
