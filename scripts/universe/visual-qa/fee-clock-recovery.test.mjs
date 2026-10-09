import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  assertAsset,
  coreFixtureNetwork,
  fixtureFrame,
  validateBuildReceipt,
  rootedLocalFile,
  verifyGitSourceInputs,
  loadExpectedBuildReceipt,
  expectedLoadedAsset,
} from "./fee-clock-recovery.mjs";

test("candidate asset pin refuses drift or absent expected hash", () => {
  const bytes = Buffer.from("controlled static artifact");
  const pin = createHash("sha256").update(bytes).digest("hex");
  assertAsset(bytes, pin, "main.js");
  assert.throws(
    () => assertAsset(Buffer.from("different artifact"), pin, "main.js"),
    /asset drift/,
  );
  assert.throws(() => assertAsset(bytes, undefined, "main.js"), /asset drift/);
});
test("controlled source refuses implicit Mainnet and unsupported network fallback", () => {
  assert.equal(coreFixtureNetwork("/signet/api/v1/ws"), "signet");
  assert.equal(coreFixtureNetwork("/testnet/api/v1/ws"), "testnet");
  for (const path of [
    "/api/v1/ws",
    "/mainnet/api/v1/ws",
    "/testnet4/api/v1/ws",
    "/signet/api/v1/universe/ws",
  ])
    assert.throws(() => coreFixtureNetwork(path));
  assert.throws(() => fixtureFrame("mainnet", new Date().toISOString()));
});
test("fixture wire proof has coherent explicit scope and ascending bootstrap blocks", () => {
  const f = fixtureFrame("signet", "2026-10-09T00:00:00.000Z", 71, 325071);
  assert.equal(f.feeEstimate.network, f.network);
  assert.equal(f.liveObservation.network, f.network);
  assert.equal(f.backendInfo.chainSync.network, f.network);
  assert.equal(f.blocks.at(-1).id, f.feeEstimate.tip.hash);
  assert.equal(f.blocks.at(-1).height, f.feeEstimate.tip.height);
  assert.equal(f.feeEstimate.values.fastestFee, 71);
});

const pin = (b) => createHash("sha256").update(b).digest("hex");
const consumerPaths = [
  "frontend/src/app/components/clock/clock.component.ts",
  "frontend/src/app/components/clock/clock.component.html",
  "frontend/src/app/services/fee-estimate.ts",
  "frontend/src/app/services/websocket.service.ts",
  "frontend/src/app/services/state.service.ts",
];
function receipt(root) {
  const config = Buffer.from("window.__env.GIT_COMMIT_HASH = 'abcdef0';\n"),
    configHash = pin(config);
  return {
    schemaVersion: "universe-private-preview-build-v1",
    sourceCommit: "abcdef0" + "1".repeat(33),
    sourceDrift: [],
    artifactPath: join(root, "artifact"),
    artifactFiles: {
      "main.abcdef0123.js": pin(Buffer.from("main")),
      "resources/config.js": configHash,
    },
    configSha256: configHash,
    configScriptPath: "/resources/config.js?v=" + configHash,
    sourceFiles: Object.fromEntries(
      consumerPaths.map((p) => [p, "a".repeat(64)]),
    ),
  };
}
test("explicit candidate manifest rejects incomplete, drifting and unsafe receipt bindings", () => {
  const r = receipt("/fixture");
  assert.equal(validateBuildReceipt(r), "main.abcdef0123.js");
  for (const change of [
    (v) => (v.schemaVersion = "unknown"),
    (v) => (v.sourceCommit = "short"),
    (v) => (v.sourceDrift = ["changed"]),
    (v) => (v.sourceFiles = {}),
    (v) => (v.configSha256 = "f".repeat(64)),
    (v) => (v.configScriptPath = "https://external/config.js"),
    (v) => (v.artifactFiles["../main.js"] = "a".repeat(64)),
    (v) => (v.artifactFiles["https://external/main.js"] = "a".repeat(64)),
    (v) => (v.artifactFiles["main.bbbbbbbb.js"] = "a".repeat(64)),
  ]) {
    const v = structuredClone(r);
    change(v);
    assert.throws(() => validateBuildReceipt(v));
  }
});
test("receipt and artifact resolution refuses external roots and links", () => {
  const root = mkdtempSync(join(tmpdir(), "receipt-root-")),
    outside = mkdtempSync(join(tmpdir(), "receipt-outside-"));
  try {
    writeFileSync(join(root, "receipt.json"), "{}");
    writeFileSync(join(outside, "receipt.json"), "{}");
    assert.equal(
      rootedLocalFile(root, "receipt.json"),
      join(root, "receipt.json"),
    );
    assert.throws(
      () => rootedLocalFile(root, join(outside, "receipt.json")),
      /outside/,
    );
    assert.throws(
      () => rootedLocalFile(root, "https://external/receipt.json"),
      /local/,
    );
    symlinkSync(
      outside,
      join(root, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.throws(() => rootedLocalFile(root, "linked/receipt.json"), /Linked/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
test("matching asset hashes cannot bypass a foreign configuration source stamp", () => {
  const root = mkdtempSync(join(tmpdir(), "receipt-config-"));
  try {
    const v = receipt(root);
    mkdirSync(join(root, "artifact/resources"), { recursive: true });
    writeFileSync(join(root, "artifact/main.abcdef0123.js"), "main");
    const config = Buffer.from("window.__env.GIT_COMMIT_HASH = 'fffffff';");
    v.configSha256 = v.artifactFiles["resources/config.js"] = pin(config);
    v.configScriptPath = "/resources/config.js?v=" + pin(config);
    writeFileSync(join(root, "artifact/resources/config.js"), config);
    writeFileSync(join(root, "receipt.json"), JSON.stringify(v));
    assert.throws(
      () => loadExpectedBuildReceipt(root, "receipt.json", root),
      /stamp mismatch/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("exact committed source validation rejects drift and names explicit checkout encoding", () => {
  const root = mkdtempSync(join(tmpdir(), "receipt-git-"));
  const git = (args) =>
    execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  try {
    git(["init", "-q"]);
    mkdirSync(join(root, "frontend"), { recursive: true });
    writeFileSync(
      join(root, "frontend/source.ts"),
      "export const value = 1;\n",
    );
    git(["add", "frontend/source.ts"]);
    git([
      "-c",
      "user.name=ControlledFixture",
      "-c",
      "user.email=fixture@invalid",
      "commit",
      "-qm",
      "controlled source",
    ]);
    const sha = git(["rev-parse", "HEAD"]).trim();
    const pins = {
      sourceCommit: sha,
      sourceFiles: {
        "frontend/source.ts": pin(Buffer.from("export const value = 1;\r\n")),
      },
    };
    const verified = verifyGitSourceInputs(pins, root);
    assert.equal(verified.sourceFilesVerified, 1);
    assert.equal(
      verified.encodings["frontend/source.ts"],
      "source checkout CRLF",
    );
    writeFileSync(
      join(root, "frontend/source.ts"),
      "export const value = 1;\r\n// mixed\n",
    );
    // A new uncommitted source must not satisfy the expected committed input.
    pins.sourceFiles["frontend/source.ts"] = pin(
      Buffer.from("export const value = 1;\r\n// mixed\n"),
    );
    assert.throws(
      () => verifyGitSourceInputs(pins, root),
      /source content drift/,
    );
    pins.sourceFiles["frontend/source.ts"] = "0".repeat(64);
    assert.throws(
      () => verifyGitSourceInputs(pins, root),
      /source drift|source bytes unavailable\/drifted/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("actual document and every successful network asset require carried pins", () => {
  const pins = {
    artifactFiles: {
      "index.html": "a".repeat(64),
      "main.abc.js": "b".repeat(64),
    },
  };
  assert.deepEqual(expectedLoadedAsset(pins, "/signet", "document", 200), {
    name: "index.html",
    sha256: "a".repeat(64),
  });
  assert.equal(expectedLoadedAsset(pins, "/api/v1/fees", "xhr", 200), null);
  assert.equal(expectedLoadedAsset(pins, "/missing.png", "image", 404), null);
  for (const type of ["script", "stylesheet", "font", "image"])
    assert.throws(
      () => expectedLoadedAsset(pins, "/unknown.file", type, 200),
      /Unpinned/,
    );
});
