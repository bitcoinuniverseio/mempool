import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fixtures } from "./fixtures.mjs";
export const CANDIDATE = "ac8ec2a645520ac58e007f5a974561e12e65928d";
export const ORIGIN = "http://localhost:4200";
export function coreFixtureNetwork(path) {
  const match = /^\/(signet|testnet)\/api\/v1\/ws$/.exec(path);
  assert(match, "Unsupported fixture socket scope");
  return match[1];
}
const hash = (b) => createHash("sha256").update(b).digest("hex");
export function assertAsset(bytes, expected, path) {
  assert.equal(hash(bytes), expected, "Candidate asset drift: " + path);
}
export function fixtureFrame(network, observedAt, fee = 71, height = 325071) {
  assert(["signet", "testnet"].includes(network));
  const tip = { height, hash: (network === "signet" ? "b" : "c").repeat(64) };
  const values = Object.fromEntries(
    ["fastestFee", "halfHourFee", "hourFee", "economyFee", "minimumFee"].map(
      (k) => [k, fee],
    ),
  );
  const feeEstimate = {
    schemaVersion: "universe-fee-estimate-v1",
    chain: "bitcoin",
    network,
    status: "ready",
    observedAt,
    tip,
    values,
    reason: null,
  };
  return {
    network,
    blocks: fixtures["/api/v1/blocks"]
      .map((b, i) => ({
        ...b,
        height: height - i,
        id: i ? "d".repeat(64) : tip.hash,
      }))
      .reverse(),
    feeEstimate,
    fees: values,
    liveObservation: {
      ...feeEstimate,
      schemaVersion: "universe-live-observation-v1",
    },
    mempoolInfo: {
      loaded: true,
      size: 0,
      bytes: 0,
      usage: 0,
      maxmempool: 300000000,
      mempoolminfee: 0.00001,
      minrelaytxfee: 0.00001,
    },
    "mempool-blocks": fixtures["/api/v1/fees/mempool-blocks"],
    loadingIndicators: { mempool: 100, blocks: 100 },
    conversions: { USD: 96400, EUR: 89100 },
    backendInfo: {
      version: "3.3.1",
      gitCommit: "controlled-local-only",
      chainSync: {
        chain: network === "signet" ? "signet" : "test",
        network,
        blocks: height,
        headers: height,
        initialBlockDownload: false,
        verificationProgress: 1,
      },
    },
  };
}
export async function checkFeeClockRecovery(context, page, pins) {
  assert.equal(pins.sourceCommit, CANDIDATE);
  assert.equal(
    typeof context.routeWebSocket,
    "function",
    "Public websocket interception unsupported",
  );
  assert.equal(
    typeof page.clock?.install,
    "function",
    "Public clock API unsupported",
  );
  const report = {
    schemaVersion: "universe-controlled-fee-clock-browser-v1",
    classification: "Controlled local fixture integration",
    frontendSource: CANDIDATE,
    origin: ORIGIN,
    realSignetWholePasses: 0,
    nativeRequestsForwarded: 0,
    controlledProtocol: true,
    checks: [],
    requests: [],
    sockets: [],
    errors: [],
  };
  let now = Date.now(),
    auto = true;
  const loaded = new Map(),
    assetTasks = [];
  page.on("response", (response) => {
    const url = new URL(response.url()),
      name = url.pathname.slice(1),
      expected = pins.artifactFiles[name];
    if (url.origin === ORIGIN && expected)
      assetTasks.push(
        response.body().then((bytes) => {
          assertAsset(bytes, expected, name);
          loaded.set(name, expected);
        }),
      );
    else if (url.origin === ORIGIN && /^main\.[a-f0-9]+\.js$/.test(name))
      report.errors.push("Unexpected main bundle: " + name);
  });
  report.runtimeProbe = {
    publicRouteWebSocket: true,
    publicClockInstall: true,
    publicClockFastForward: typeof page.clock.fastForward === "function",
  };
  await page.clock.install({ time: new Date(now) });
  // Keep animation/render scheduling live during bootstrap.
  page.__feeClockReport = report;
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("console", (m) => {
    if (
      m.type() === "error" &&
      /(?:TypeError|ReferenceError|NG\d{4})/.test(m.text())
    )
      report.errors.push(m.text());
  });
  const peers = [];
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
        /^\/(?:resources|assets)\//.test(url.pathname) ||
        /\.(?:js|css|png|svg|woff2?|ttf|ico|jpe?g|webp|json|webmanifest)$/.test(
          url.pathname,
        )
      )
        return route.continue();
      report.requests.push({
        path: url.pathname,
        action: "unmatched-nonstatic-aborted",
      });
      return route.abort();
    }
    const path = url.pathname.replace(/^\/(?:signet|testnet)(?=\/api\/)/, "");
    report.requests.push({
      path: url.pathname,
      method: req.method(),
      action: "fixture-only",
    });
    const value = fixtures[path];
    return route.fulfill({
      status: value === undefined ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        value ?? { error: "Controlled unavailable; no native forwarding" },
      ),
    });
  });
  await context.routeWebSocket("**/*", (ws) => {
    const url = new URL(ws.url());
    if (!/^\/(signet|testnet)\/api\/v1\/ws$/.test(url.pathname)) {
      report.sockets.push({
        path: url.pathname,
        action: "unsupported-fixture-scope-closed",
      });
      ws.close({ code: 1008, reason: "Controlled unsupported channel" });
      return;
    }
    const network = coreFixtureNetwork(url.pathname);
    assert.equal(url.host, new URL(ORIGIN).host);
    const peer = { ws, network, closed: false, id: peers.length };
    peers.push(peer);
    report.sockets.push({ id: peer.id, path: url.pathname, network });
    if (!url.pathname.endsWith("/api/v1/ws")) {
      ws.close({ code: 1008, reason: "Controlled unsupported channel" });
      return;
    }
    ws.onClose(() => {
      peer.closed = true;
    });
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.action === "ping") ws.send(JSON.stringify({ pong: true }));
      else if (auto && ["init", "want"].includes(message.action))
        ws.send(
          JSON.stringify(fixtureFrame(network, new Date(now).toISOString())),
        );
    });
  });
  const navigation = async (path) => {
    await page.evaluate((p) => {
      history.pushState(null, "", p);
      dispatchEvent(new PopStateEvent("popstate"));
    }, path);
  };
  const wait = async (predicate) => {
    const deadline = Date.now() + 12000;
    while (!(await predicate())) {
      assert(Date.now() < deadline, "Fixture event deadline");
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  const advance = async (ms) => {
    await page.clock.fastForward(ms);
    now = await page.evaluate(() => Date.now());
  };
  const clock = () => page.locator("app-clock .stats.top.right");
  const text = () => clock().innerText();
  const ready = async (fee) =>
    wait(async () => {
      const value = await clock()
        .innerText()
        .catch(() => "");
      return (
        value.includes(String(fee)) && !/stale|syncing|unavailable/i.test(value)
      );
    });
  const status = async (expected) =>
    wait(async () =>
      (await text().catch(() => ""))
        .toLowerCase()
        .includes(expected.toLowerCase()),
    );
  const send = (peer, frame) => peer.ws.send(JSON.stringify(frame));
  const record = async (id, detail = {}) =>
    report.checks.push({
      id,
      result: "PASS",
      rendered: await text(),
      ...detail,
    });
  await page.goto(ORIGIN + "/signet", { waitUntil: "domcontentloaded" });
  await page.locator("app-fees-box").waitFor({ timeout: 15000 });
  await wait(async () =>
    (await page.locator("app-fees-box").innerText()).includes("71"),
  );
  report.checks.push({
    id: "fees-box-ready",
    result: "PASS",
    rendered: await page.locator("app-fees-box").innerText(),
  });
  await navigation("/signet/clock/mined/0");
  await ready(71);
  await record("clock-ready");
  auto = false;
  await advance(120001);
  await status("Stale");
  assert((await text()).includes("71"));
  await record("expired-observation-stale-retains-dated-values");
  await navigation("/signet");
  await page.locator("app-fees-box").waitFor();
  await wait(async () =>
    (await page.locator("app-fees-box").innerText()).includes("stale"),
  );
  report.checks.push({
    id: "fees-box-shared-expiry",
    result: "PASS",
    rendered: await page.locator("app-fees-box").innerText(),
  });
  await navigation("/signet/clock/mined/0");
  await status("Stale");
  let count = peers.length;
  await clock().getByRole("button", { name: "Retry", exact: true }).click();
  await wait(() => peers.length > count);
  await status("Syncing");
  assert.equal(await clock().getByRole("button").isDisabled(), true);
  assert(!(await text()).includes("71"));
  await record("retry-clears-values-single-shared-socket", {
    newSockets: peers.length - count,
  });
  assert.equal(peers.length - count, 1);
  await advance(5001);
  await status("Unavailable");
  await record("silent-retry-bounded-null-timeout");
  count = peers.length;
  await clock().getByRole("button", { name: "Retry", exact: true }).click();
  await wait(() => peers.length > count);
  const lastGood = new Date(now).toISOString();
  send(peers.at(-1), fixtureFrame("signet", lastGood, 89));
  await ready(89);
  await record("newer-observation-recovers");
  peers.at(-1).ws.close({ code: 1001, reason: "Controlled disconnect" });
  await status("Stale");
  await record("controlled-disconnect-stale");
  count = peers.length;
  await clock().getByRole("button", { name: "Retry", exact: true }).click();
  await wait(() => peers.length > count);
  send(peers.at(-1), fixtureFrame("signet", lastGood, 89));
  await status("Syncing");
  assert(!(await text()).includes("89"));
  await record("valid-but-replayed-observation-rejected");
  await advance(1000);
  send(peers.at(-1), fixtureFrame("signet", new Date(now).toISOString(), 97));
  await ready(97);
  const old = peers.at(-1);
  await navigation("/testnet/clock/mined/0");
  await wait(() => peers.at(-1).network === "testnet");
  send(
    peers.at(-1),
    fixtureFrame("testnet", new Date(now).toISOString(), 113, 500113),
  );
  await ready(113);
  await navigation("/signet/clock/mined/0");
  await wait(
    () => peers.at(-1).network === "signet" && peers.at(-1).id > old.id,
  );
  await advance(1);
  send(
    peers.at(-1),
    fixtureFrame("signet", new Date(now).toISOString(), 127, 325127),
  );
  await ready(127);
  let delivery = "sent";
  try {
    send(old, fixtureFrame("signet", new Date(now).toISOString(), 999, 888888));
  } catch {
    delivery = "closed-old-socket-refused";
  }
  send(peers.at(-1), {
    ...fixtureFrame("testnet", new Date(now).toISOString(), 997, 777777),
    network: "testnet",
  });
  const wrongMeta = fixtureFrame(
    "signet",
    new Date(now + 1).toISOString(),
    996,
    666666,
  );
  wrongMeta.backendInfo.chainSync = {
    ...wrongMeta.backendInfo.chainSync,
    chain: "test",
    network: "testnet",
  };
  send(peers.at(-1), wrongMeta);
  await page.waitForTimeout(100);
  await ready(127);
  assert(
    !(await text()).includes("999") &&
      !(await text()).includes("997") &&
      !(await text()).includes("996"),
  );
  assert.equal(
    old.closed,
    true,
    "Prior concrete socket not closed by scope transition",
  );
  assert.equal(
    await page.locator("app-clock .block-height").innerText(),
    "325127",
  );
  await record("rapid-scope-A-B-A-old-and-foreign-frames-isolated", {
    oldSocketClosed: old.closed,
    lateOldDelivery: delivery,
    blockHeight: "325127",
    limitation:
      "Native WebSocket close/subscriber cancellation may suppress delivery; no forced frontend callback or hidden application mutation.",
  });
  await Promise.all(assetTasks);
  assert(
    loaded.has("main.6ef32583fd5bf71e.js") && loaded.has("resources/config.js"),
    "Actual page did not load pinned main/config",
  );
  report.loadedAssetHashes = Object.fromEntries(loaded);
  assert.deepEqual(report.errors, []);
  report.completedAt = new Date().toISOString();
  report.result = "PASS";
  report.browserPages = context.pages().length;
  assert.equal(report.browserPages, 1);
  return report;
}
async function main() {
  const audit = resolve(process.argv[2]);
  assert(existsSync(audit));
  const pins = JSON.parse(
    readFileSync(
      resolve(audit, "clock-history-preview-build-receipt-ac8ec2a64.json"),
    ),
  );
  assert.equal(pins.sourceCommit, CANDIDATE);
  for (const name of ["main.6ef32583fd5bf71e.js", "resources/config.js"]) {
    const response = await fetch(ORIGIN + "/" + name);
    assert.equal(response.status, 200);
    assertAsset(
      Buffer.from(await response.arrayBuffer()),
      pins.artifactFiles[name],
      name,
    );
  }
  const require = createRequire(new URL("./package.json", import.meta.url));
  const { chromium } = require("playwright");
  const output = resolve(
    audit,
    "fee-clock-controlled-browser-ac8-" + Date.now() + "-receipt.json",
  );
  assert(!existsSync(output));
  const browser = await chromium.launch({ headless: true });
  let report, page;
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
    });
    page = await context.newPage();
    report = await checkFeeClockRecovery(context, page, pins);
    report.playwrightPackageVersion =
      require("playwright/package.json").version;
    report.harnessSha256 = hash(readFileSync(new URL(import.meta.url)));
    report.fixtureModuleSha256 = hash(
      readFileSync(new URL("./fixtures.mjs", import.meta.url)),
    );
    report.assetPins = {
      main: pins.artifactFiles["main.6ef32583fd5bf71e.js"],
      config: pins.artifactFiles["resources/config.js"],
    };
    writeFileSync(output, JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
    });
    console.log(
      JSON.stringify({
        result: report.result,
        checks: report.checks.length,
        output,
        realSignetWholePasses: 0,
      }),
    );
  } catch (error) {
    writeFileSync(
      output,
      JSON.stringify(
        {
          ...page?.__feeClockReport,
          result: "FAIL",
          classification: "Controlled local fixture integration",
          error: error.message,
          realSignetWholePasses: 0,
          dom:
            page &&
            (await page
              .locator("body")
              .innerText()
              .catch(() => "unavailable")),
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
