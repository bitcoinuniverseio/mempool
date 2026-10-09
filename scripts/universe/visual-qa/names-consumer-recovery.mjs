import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  AUDIT_ROOT,
  ORIGIN,
  loadExpectedBuildReceipt,
  expectedLoadedAsset,
  assertAsset,
  fixtureFrame,
} from "./fee-clock-recovery.mjs";
import { fixtures } from "./fixtures.mjs";
const sha = (b) => createHash("sha256").update(b).digest("hex");
const repo = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
export const CANDIDATE = "c4ac2aaf0c87b296c052009fffe38cb8bc7acf11";
export function namesFixture(raw, network, now, mode = "served") {
  assert(
    ["mainnet", "signet", "testnet", "testnet4", "regtest"].includes(network),
    "Unsupported fixture scope",
  );
  assert(
    ["served", "stale", "bad-proof", "unconfigured", "not-found"].includes(
      mode,
    ),
    "Unknown fixture mode",
  );
  assert.equal(raw.schemaVersion, "index-names-explorer-asset-v1");
  assert.equal(raw.fullSpecMembershipQualified, false);
  const value = structuredClone(raw),
    stamp = new Date(now).toISOString();
  value.observedAt = stamp;
  value.checkpoint.observedAt = stamp;
  value.ownership.observedAt = stamp;
  value.ownership.checkpoint.observedAt = stamp;
  value.network = "bitcoin:" + network;
  value.checkpoint.network = value.network;
  value.ownership.checkpoint.network = value.network;
  if (mode === "stale") {
    const stale = new Date(now - 31000).toISOString();
    value.observedAt = stale;
    value.checkpoint.observedAt = stale;
    value.ownership.observedAt = stale;
    value.ownership.checkpoint.observedAt = stale;
  }
  if (mode === "bad-proof") value.ownership.confirmationsAtomic = "2";
  return {
    schemaVersion: "universe-names-explorer-asset-v1",
    chain: "bitcoin",
    network,
    authorityId: "index-names",
    status: ["unconfigured", "not-found"].includes(mode) ? mode : "served",
    value: ["unconfigured", "not-found"].includes(mode) ? null : value,
  };
}
export function assertScopeAttemptBudget(rows) {
  assert(rows.length > 0, "Scope attempt observations required");
  for (const row of rows)
    assert.equal(
      row.attempts,
      1,
      "One HTTP attempt per actual scope transition required: " +
        row.lane +
        " " +
        row.network,
    );
}
export function assertScopeAttemptCoverage(rows) {
  const expected = ["Names", "Inscription", "rune", "sat"]
    .flatMap((lane) =>
      ["mainnet", "signet"].map((network) => lane + ":" + network),
    )
    .sort();
  assert.deepEqual(
    rows.map((row) => row.lane + ":" + row.network).sort(),
    expected,
    "Complete four-lane/two-scope attempt coverage required",
  );
}
export function ordinaryFixture(path, raw) {
  if (path.includes("/inscriptions/"))
    return {
      id: raw.assetId,
      numberAtomic: "1",
      address: "controlled-ordinary-owner",
      contentType: null,
      contentLengthAtomic: null,
      heightAtomic: null,
      feeAtomic: null,
      valueAtomic: null,
      satAtomic: null,
      satpoint: null,
      timestampAtomic: null,
      charms: [],
      parents: [],
      childCountAtomic: null,
      rune: null,
      metaprotocol: null,
    };
  if (path.includes("/runes/"))
    return {
      id: "840000:0",
      rune: "CONTROLLEDRUNE",
      spacedRune: "CONTROLLED•RUNE",
      symbol: null,
      divisibilityAtomic: "0",
      blockAtomic: null,
      numberAtomic: "1",
      mintsAtomic: "1",
      burnedAtomic: "0",
      premineAtomic: "0",
      etchingTxid: null,
      timestampAtomic: null,
      turbo: false,
      mintable: false,
      terms: null,
      parentInscriptionId: null,
    };
  if (path.includes("/sats/"))
    return {
      numberAtomic: "1",
      rarity: "common",
      name: "controlled-sat-fixture",
      decimal: null,
      degree: null,
      percentile: null,
      blockAtomic: null,
      cycleAtomic: null,
      epochAtomic: null,
      periodAtomic: null,
      offsetAtomic: null,
      timestampAtomic: null,
      satpoint: null,
      address: null,
      inscriptions: [],
    };
  throw new Error("Unsupported ordinary fixture lane");
}
export async function run(context, page, pins, raw) {
  assert(
    /^[0-9a-f]{40}$/.test(pins.sourceCommit),
    "Exact candidate source required",
  );
  assert.equal(
    pins.sourceVerification?.sourceCommit,
    pins.sourceCommit,
    "Candidate source inputs must be verified",
  );
  assert(pins.mainAsset, "Pinned main required");
  assert.equal(typeof context.routeWebSocket, "function");
  assert.equal(typeof page.clock?.install, "function");
  const report = {
    schemaVersion: "universe-controlled-names-consumer-browser-v1",
    classification: "Controlled local fixture integration",
    frontendSource: pins.sourceCommit,
    realSignetWholePasses: 0,
    nativeRequestsForwarded: 0,
    checks: [],
    requests: [],
    scopeAttemptBudget: [],
    requestBudgetChecks: [],
    lateResponseAttempts: [],
    errors: [],
    loadedAssets: {},
    navigation:
      "public browser History/popstate and rendered link/button clicks; no Angular state or CSS injection",
  };
  page.__namesReport = report;
  page.setDefaultTimeout(10000);
  report.namesFixtureScope =
    "Mainnet synthetic positive paired DTO; scoped Signet pending/negative observations only. No native Mainnet or Signet acceptance.";
  const tasks = [],
    held = [];
  let now = Date.now(),
    mode = "served",
    hold = false,
    ordinaryMode = "unconfigured";
  await page.clock.install({ time: new Date(now) });
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("response", (r) => {
    const url = new URL(r.url());
    if (url.origin !== ORIGIN) return;
    try {
      const asset = expectedLoadedAsset(
        pins,
        url.pathname,
        r.request().resourceType(),
        r.status(),
      );
      if (asset)
        tasks.push(
          r
            .body()
            .then((b) => {
              assertAsset(b, asset.sha256, asset.name);
              report.loadedAssets[asset.name] = asset.sha256;
            })
            .catch((e) => report.errors.push(e.message)),
        );
    } catch (e) {
      report.errors.push(e.message);
    }
  });
  const fill = (route, value, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(value),
    });
  await context.route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.origin !== ORIGIN) {
      report.requests.push({
        url: url.origin + url.pathname,
        action: "external-aborted",
      });
      return route.abort();
    }
    if (!url.pathname.includes("/api/")) {
      if (
        req.resourceType() === "document" ||
        /^\/(resources|assets)\//.test(url.pathname) ||
        /\.(js|css|png|svg|woff2?|ttf|ico|jpe?g|webp|json|webmanifest)$/.test(
          url.pathname,
        )
      )
        return route.continue();
      return route.abort();
    }
    const path = url.pathname.replace(
        /^\/(signet|testnet|testnet4|regtest)(?=\/api\/)/,
        "",
      ),
      network =
        url.searchParams.get("network") ||
        (url.pathname.startsWith("/signet/") ? "signet" : "mainnet");
    report.requests.push({
      path,
      network,
      method: req.method(),
      action: "fixture-only",
    });
    if (path.includes("/protocols/names/objects/")) {
      if (hold) {
        await new Promise((resolve) => held.push({ route, network, resolve }));
        return;
      }
      return fill(route, namesFixture(raw, network, now, mode));
    }
    if (/^\/api\/v1\/universe\/(inscriptions|runes|sats)\//.test(path)) {
      if (ordinaryMode === "hold") {
        await new Promise((resolve) =>
          held.push({ route, network, resolve, ordinary: true }),
        );
        return;
      }
      if (ordinaryMode === "ready")
        return fill(route, {
          status: "ok",
          chain: "bitcoin",
          network,
          authorityId: "ord",
          checkpoint: null,
          value: ordinaryFixture(path, raw),
        });
      return fill(
        route,
        {
          status: "unconfigured",
          chain: "bitcoin",
          network,
          authorityId: "ord",
          value: null,
        },
        503,
      );
    }
    if (path === "/api/v1/universe/protocols")
      return fill(route, {
        registryVersion: "controlled-local",
        primaryStrip: ["names"],
        protocols: [
          {
            schemaVersion: "universe-explorer-protocol-v1",
            id: "names",
            aliases: [],
            displayName: "Names",
            shortName: "Names",
            family: "INSCRIPTIONS",
            chain: "bitcoin",
            networks: ["mainnet", "signet"],
            icon: "protocol-names",
            visualToken: "protocol-names",
            implementedReadOperations: ["registry", "objects"],
            authorizedReadOperations: ["registry", "objects"],
            releaseStatus: "BLOCKED",
            indexerAuthority: "index-names",
            coverage: "unknown",
          },
        ],
      });
    if (path === "/api/v1/universe/protocols/names/objects")
      return fill(route, {
        schemaVersion: "universe-protocol-objects-v1",
        protocolId: "names",
        state: "served",
        authorityId: "index-names",
        objectsPath: "/v1/explorer/protocols/names/objects",
        items: [
          {
            assetId: raw.assetId,
            kind: "namespace",
            namespace: "sats",
            name: null,
          },
        ],
        nextCursor: null,
        checkpoint: null,
        degradedReason: null,
        observedAt: new Date(now).toISOString(),
      });
    if (path === "/api/v1/universe/sources")
      return fill(route, {
        generatedAt: new Date(now).toISOString(),
        sources: [],
      });
    return fill(
      route,
      fixtures[path] ?? { error: "Controlled unavailable; no forwarding" },
      fixtures[path] === undefined ? 503 : 200,
    );
  });
  await context.routeWebSocket("**/*", (ws) => {
    const u = new URL(ws.url());
    assert.equal(u.origin.replace("ws:", "http:"), ORIGIN);
    ws.onMessage(() => {});
    if (/\/api\/v1\/ws$/.test(u.pathname)) {
      let frame = fixtureFrame(
        u.pathname.startsWith("/signet") ? "signet" : "testnet",
        new Date(now).toISOString(),
      );
      if (
        !u.pathname.startsWith("/signet") &&
        !u.pathname.startsWith("/testnet")
      )
        frame = {
          ...frame,
          network: "mainnet",
          backendInfo: {
            ...frame.backendInfo,
            chainSync: {
              ...frame.backendInfo.chainSync,
              chain: "main",
              network: "mainnet",
            },
          },
          feeEstimate: { ...frame.feeEstimate, network: "mainnet" },
          liveObservation: { ...frame.liveObservation, network: "mainnet" },
        };
      ws.send(JSON.stringify(frame));
    }
  });
  const root = () => page.locator("app-universe-inscription"),
    section = () => root().locator(".names-detail");
  async function check(name, action) {
    await action();
    report.checks.push({ name, result: "PASS" });
  }
  async function waitText(locator, text) {
    await locator
      .getByText(text, { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 10000 });
  }
  async function navigate(path) {
    assert(path.startsWith("/") && !path.startsWith("//"));
    await page.evaluate((path) => {
      history.pushState({}, "", path);
      dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
    }, path);
  }
  const count = (path) =>
    report.requests.filter((r) => r.path?.includes(path)).length;
  const base = "/inscription/" + raw.assetId;
  await page.goto(ORIGIN + "/protocols/names", {
    waitUntil: "domcontentloaded",
  });
  await check(
    "raw catalog mapped to validated existing-page link",
    async () => {
      const link = page.locator(".authority-objects a.identifier");
      await link.waitFor({ state: "visible" });
      assert.equal(await link.getAttribute("href"), base + "?protocol=names");
      await link.click();
      await waitText(section(), "Observed inscription owner");
      assert((await section().innerText()).includes(raw.ownership.owner));
      await waitText(
        root(),
        "This deployment has no asset authority configured",
      );
    },
  );
  await check("ordinary page performs zero extra Names reads", async () => {
    const before = report.requests.filter((r) =>
      r.path?.includes("/protocols/names/objects/"),
    ).length;
    await navigate(base);
    await section().waitFor({ state: "detached" });
    assert.equal(
      report.requests.filter((r) =>
        r.path?.includes("/protocols/names/objects/"),
      ).length,
      before,
    );
  });
  await check(
    "explicit query starts one Names read and keeps generic Ord independent",
    async () => {
      await navigate(base + "?protocol=names");
      await waitText(section(), "Observed inscription owner");
      assert(
        !(await section().innerText()).includes("controlled-ordinary-owner"),
      );
    },
  );
  await check(
    "completed Names same-context query restores original observation with zero HTTP",
    async () => {
      const before = count("/protocols/names/objects/"),
        text = await section().innerText();
      await navigate(base + "?protocol=names&unrelated=1");
      await waitText(section(), "Observed inscription owner");
      assert.equal(count("/protocols/names/objects/"), before);
      report.requestBudgetChecks.push({
        lane: "Names",
        operation: "completed query-only",
        expected: 0,
        observed: count("/protocols/names/objects/") - before,
      });
      assert.equal(await section().innerText(), text);
    },
  );
  for (const [state, text] of [
    ["unconfigured", "Names details are not configured"],
    ["not-found", "No indexed first Names claim"],
    ["stale", "Names observation is stale"],
    ["bad-proof", "Names ownership proof is unavailable"],
  ])
    await check(
      state + " removes owner and explicit retry recovers",
      async () => {
        mode = state;
        await section()
          .getByRole("button", { name: "Retry Names details" })
          .count()
          .then(async (count) => {
            if (count)
              await section()
                .getByRole("button", { name: "Retry Names details" })
                .click();
            else {
              await navigate(base);
              await navigate(base + "?protocol=names");
            }
          });
        await waitText(section(), text);
        assert(!(await section().innerText()).includes(raw.ownership.owner));
        mode = "served";
        const beforeRetry = count("/protocols/names/objects/");
        await section()
          .getByRole("button", { name: "Retry Names details" })
          .click();
        await waitText(section(), "Observed inscription owner");
        assert.equal(count("/protocols/names/objects/"), beforeRetry + 1);
        report.requestBudgetChecks.push({
          lane: "Names",
          operation: state + " manual retry",
          expected: 1,
          observed: count("/protocols/names/objects/") - beforeRetry,
        });
      },
    );
  await check(
    "scope A-B-A pending clears previous ownership and late old response cannot restore it",
    async () => {
      hold = true;
      await navigate("/signet" + base + "?protocol=names");
      await waitText(section(), "Reading the Names authority");
      assert(!(await section().innerText()).includes(raw.ownership.owner));
      await navigate(base + "?protocol=names");
      await waitText(section(), "Reading the Names authority");
      assert(held.length >= 2);
      hold = false;
      for (const network of ["signet", "mainnet"])
        report.scopeAttemptBudget.push({
          lane: "Names",
          network,
          attempts: held.filter((h) => h.network === network && !h.ordinary)
            .length,
        });
      for (const h of held.splice(0)) {
        await fill(
          h.route,
          namesFixture(
            raw,
            h.network,
            now,
            h.network === "signet" ? "bad-proof" : "served",
          ),
        )
          .then(() =>
            report.lateResponseAttempts.push({
              network: h.network,
              kind: "Names",
              transport: "fulfill-attempt-resolved",
              effect: "replacement DOM checked separately",
            }),
          )
          .catch(() =>
            report.lateResponseAttempts.push({
              network: h.network,
              kind: "Names",
              transport: "cancelled-before-delivery",
              effect: "no old observer callback injected",
            }),
          );
        h.resolve();
      }
      await waitText(section(), "Observed inscription owner");
      assert(page.url().startsWith(ORIGIN + base));
    },
  );
  await check(
    "duplicate query unavailable with zero additional Names reads",
    async () => {
      const before = report.requests.filter((r) =>
        r.path?.includes("/protocols/names/objects/"),
      ).length;
      await navigate(base + "?protocol=names&protocol=names");
      await waitText(section(), "single protocol=names");
      assert.equal(
        report.requests.filter((r) =>
          r.path?.includes("/protocols/names/objects/"),
        ).length,
        before,
      );
    },
  );
  await check("local expiry drops Names owner without polling", async () => {
    await navigate(base + "?protocol=names");
    await waitText(section(), "Observed inscription owner");
    const before = report.requests.filter((r) =>
      r.path?.includes("/protocols/names/objects/"),
    ).length;
    await page.clock.fastForward(31000);
    now += 31000;
    await waitText(section(), "Names observation is stale");
    assert.equal(
      report.requests.filter((r) =>
        r.path?.includes("/protocols/names/objects/"),
      ).length,
      before,
    );
  });
  await check(
    "ordinary inscription ready clears on scope pending then explicit retry is coalesced",
    async () => {
      ordinaryMode = "ready";
      const beforeMain = count("/inscriptions/");
      await navigate(base);
      await waitText(root(), "controlled-ordinary-owner");
      assert.equal(count("/inscriptions/"), beforeMain + 1);
      report.scopeAttemptBudget.push({
        lane: "Inscription",
        network: "mainnet",
        attempts: count("/inscriptions/") - beforeMain,
      });
      const beforeQuery = count("/inscriptions/");
      await navigate(base + "?unrelated=1");
      await waitText(root(), "controlled-ordinary-owner");
      assert.equal(count("/inscriptions/"), beforeQuery);
      report.requestBudgetChecks.push({
        lane: "Inscription",
        operation: "completed query-only",
        expected: 0,
        observed: count("/inscriptions/") - beforeQuery,
      });
      ordinaryMode = "hold";
      await navigate("/signet" + base);
      await root()
        .locator("[aria-busy=true]")
        .first()
        .waitFor({ state: "visible" });
      assert(!(await root().innerText()).includes("controlled-ordinary-owner"));
      await page.clock.fastForward(35001);
      now += 35001;
      await root()
        .getByRole("button", { name: "Retry inscription read" })
        .waitFor({ state: "visible" });
      ordinaryMode = "unconfigured";
      const before = report.requests.filter((r) =>
        r.path?.includes("/inscriptions/"),
      ).length;
      await root()
        .getByRole("button", { name: "Retry inscription read" })
        .click();
      await waitText(
        root(),
        "This deployment has no asset authority configured",
      );
      assert.equal(
        report.requests.filter((r) => r.path?.includes("/inscriptions/"))
          .length,
        before + 1,
      );
      report.requestBudgetChecks.push({
        lane: "Inscription",
        operation: "manual retry",
        expected: 1,
        observed: count("/inscriptions/") - before,
      });
      report.scopeAttemptBudget.push({
        lane: "Inscription",
        network: "signet",
        attempts: held.filter((h) => h.ordinary).length,
      });
      for (const h of held.splice(0)) {
        await fill(h.route, {
          status: "ok",
          chain: "bitcoin",
          network: h.network,
          value: { id: raw.assetId, address: "late-old-owner" },
        })
          .then(() =>
            report.lateResponseAttempts.push({
              network: h.network,
              kind: "ordinary",
              transport: "fulfill-attempt-resolved",
              effect: "replacement DOM rejects late-old-owner",
            }),
          )
          .catch(() =>
            report.lateResponseAttempts.push({
              network: h.network,
              kind: "ordinary",
              transport: "cancelled-before-delivery",
              effect: "no old observer callback injected",
            }),
          );
        h.resolve();
      }
      assert(!(await root().innerText()).includes("late-old-owner"));
    },
  );
  for (const [kind, ref, title, retry, marker] of [
    ["rune", "840000:0", "Rune", "Retry", "CONTROLLED•RUNE"],
    ["sat", "1", "Satoshi", "Retry", "controlled-sat-fixture"],
  ])
    await check(
      kind + " exact scope/query/retry attempt budget without Names enrichment",
      async () => {
        const lane = "/" + (kind === "rune" ? "runes" : "sats") + "/",
          beforeNames = count("/protocols/names/objects/");
        ordinaryMode = "ready";
        const beforeStart = count(lane);
        await navigate("/" + kind + "/" + ref);
        await page
          .getByRole("heading", { name: title, exact: true })
          .waitFor({ state: "visible" });
        await waitText(page.locator("body"), marker);
        assert.equal(count(lane), beforeStart + 1);
        report.scopeAttemptBudget.push({
          lane: kind,
          network: "mainnet",
          attempts: count(lane) - beforeStart,
        });
        const beforeQuery = count(lane);
        await navigate("/" + kind + "/" + ref + "?unrelated=1");
        await waitText(page.locator("body"), marker);
        assert.equal(count(lane), beforeQuery);
        report.requestBudgetChecks.push({
          lane: kind,
          operation: "completed query-only",
          expected: 0,
          observed: count(lane) - beforeQuery,
        });
        ordinaryMode = "hold";
        const beforeSwitch = count(lane);
        await navigate("/signet/" + kind + "/" + ref + "?unrelated=1");
        await page
          .locator(".universe-asset [aria-busy=true]")
          .first()
          .waitFor({ state: "visible" });
        assert(
          !(await page.locator(".universe-asset").innerText()).includes(marker),
        );
        await page.clock.fastForward(35001);
        now += 35001;
        await page
          .getByRole("button", { name: retry, exact: true })
          .waitFor({ state: "visible" });
        assert.equal(count(lane), beforeSwitch + 1);
        report.scopeAttemptBudget.push({
          lane: kind,
          network: "signet",
          attempts: count(lane) - beforeSwitch,
        });
        ordinaryMode = "unconfigured";
        const before = count(lane);
        await page.getByRole("button", { name: retry, exact: true }).click();
        await waitText(
          page.locator("body"),
          "This deployment has no asset authority configured",
        );
        assert.equal(count(lane), before + 1);
        report.requestBudgetChecks.push({
          lane: kind,
          operation: "manual retry",
          expected: 1,
          observed: count(lane) - before,
        });
        assert.equal(count("/protocols/names/objects/"), beforeNames);
        for (const h of held.splice(0)) {
          await fill(
            h.route,
            {
              status: "unconfigured",
              chain: "bitcoin",
              network: h.network,
              value: null,
            },
            503,
          ).catch(() => {});
          h.resolve();
        }
      },
    );
  await Promise.all(tasks);
  assert.deepEqual(report.errors, []);
  assert(report.loadedAssets[pins.mainAsset]);
  assert(report.loadedAssets["resources/config.js"]);
  assertScopeAttemptCoverage(report.scopeAttemptBudget);
  assertScopeAttemptBudget(report.scopeAttemptBudget);
  report.result = "PASS";
  return report;
}
async function main() {
  const pins = loadExpectedBuildReceipt(
      AUDIT_ROOT,
      process.argv[2] ??
        "namespace-asset-loading-preview-build-receipt-c4ac2aaf0.json",
      repo,
    ),
    rawBytes = readFileSync(
      resolve(
        repo,
        "frontend/src/app/universe/inscription/names-explorer-asset.paired-fixture.json",
      ),
    ),
    raw = JSON.parse(rawBytes);
  assert.equal(
    sha(rawBytes),
    pins.sourceFiles[
      "frontend/src/app/universe/inscription/names-explorer-asset.paired-fixture.json"
    ],
    "Paired fixture drift",
  );
  const require = createRequire(new URL("./package.json", import.meta.url)),
    { chromium } = require("playwright"),
    browser = await chromium.launch({ headless: true }),
    output = resolve(
      AUDIT_ROOT,
      "names-controlled-browser-" +
        pins.sourceCommit.slice(0, 12) +
        "-" +
        Date.now() +
        "-receipt.json",
    );
  let page;
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
    });
    page = await context.newPage();
    const report = await run(context, page, pins, raw);
    report.expectedBuildReceipt = pins.expectedReceipt;
    report.sourceVerification = pins.sourceVerification;
    report.harnessSha256 = sha(readFileSync(fileURLToPath(import.meta.url)));
    report.pairedFixtureSha256 = sha(rawBytes);
    report.pairedFixtureEncoding = "exact raw file bytes";
    report.fixtureValidity =
      "synthetic controlled DTO; no native build/profile/protocol full membership qualification";
    writeFileSync(output, JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
    });
    console.log(
      JSON.stringify({
        result: report.result,
        checks: report.checks.length,
        output,
      }),
    );
  } catch (error) {
    writeFileSync(
      output,
      JSON.stringify(
        {
          ...page?.__namesReport,
          result: "FAIL",
          error: error.message,
          dom: await page
            ?.locator("body")
            .innerText()
            .catch(() => null),
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    throw error;
  } finally {
    await browser.close();
  }
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  await main();
