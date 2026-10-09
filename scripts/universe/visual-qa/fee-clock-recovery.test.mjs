import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  assertAsset,
  coreFixtureNetwork,
  fixtureFrame,
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
