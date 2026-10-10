import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  namesFixture,
  run,
  assertScopeAttemptBudget,
  assertScopeAttemptCoverage,
  ordinaryFixture,
} from "./names-consumer-recovery.mjs";
const raw = JSON.parse(
  readFileSync(
    new URL(
      "../../../frontend/src/app/universe/inscription/names-explorer-asset.paired-fixture.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
test("fixture observation is internally dated and original paired bytes remain immutable", () => {
  const original = JSON.stringify(raw),
    now = Date.parse("2026-10-09T20:00:00Z"),
    v = namesFixture(raw, "mainnet", now);
  assert.equal(v.value.observedAt, new Date(now).toISOString());
  assert.equal(
    v.value.checkpoint.observedAt,
    v.value.ownership.checkpoint.observedAt,
  );
  assert.equal(v.value.ownership.observedAt, v.value.observedAt);
  assert.equal(v.value.fullSpecMembershipQualified, false);
  assert.equal(v.value.namespaceRegistrationPrivileges, false);
  assert.equal(JSON.stringify(raw), original);
});
test("indexed miss/unconfigured contain no owner, stale and contradictory proof stay distinct", () => {
  for (const status of ["not-found", "unconfigured"]) {
    const v = namesFixture(raw, "mainnet", 0, status);
    assert.equal(v.status, status);
    assert.equal(v.value, null);
  }
  assert.equal(
    Date.parse(namesFixture(raw, "mainnet", 31000, "stale").value.observedAt),
    0,
  );
  assert.equal(
    namesFixture(raw, "mainnet", 0, "bad-proof").value.ownership
      .confirmationsAtomic,
    "2",
  );
});
test("unsupported fixture scope/mode rejected rather than fallback", () => {
  assert.throws(() => namesFixture(raw, "unknown", 0), /scope/);
  assert.throws(() => namesFixture(raw, "mainnet", 0, "invented"), /mode/);
});
test("wrong candidate fails before page/interception infrastructure starts", async () => {
  await assert.rejects(run({}, {}, { sourceCommit: "other" }, raw));
});

test("actual scope attempt guard cannot promote duplicate reads or empty observations", () => {
  assert.throws(() => assertScopeAttemptBudget([]), /observations/);
  assert.throws(
    () =>
      assertScopeAttemptBudget([
        { lane: "Names", network: "signet", attempts: 2 },
      ]),
    /One HTTP/,
  );
  assertScopeAttemptBudget([{ lane: "Names", network: "signet", attempts: 1 }]);
});

test("ordinary synthetic fixture lanes keep minimum arrays/atomic quantities and reject substitution", () => {
  assert.deepEqual(ordinaryFixture("/inscriptions/x", raw).parents, []);
  assert.equal(ordinaryFixture("/runes/x", raw).mintsAtomic, "1");
  assert.deepEqual(ordinaryFixture("/sats/x", raw).inscriptions, []);
  assert.throws(() => ordinaryFixture("/other/x", raw), /Unsupported/);
});

test("scope coverage guard rejects omitted/duplicate lanes instead of reducing the controlled matrix", () => {
  const rows = ["Names", "Inscription", "rune", "sat"].flatMap((lane) =>
    ["mainnet", "signet"].map((network) => ({ lane, network, attempts: 1 })),
  );
  assertScopeAttemptCoverage(rows);
  assert.throws(() => assertScopeAttemptCoverage(rows.slice(1)), /coverage/);
  assert.throws(
    () => assertScopeAttemptCoverage([...rows.slice(1), rows[1]]),
    /coverage/,
  );
});
