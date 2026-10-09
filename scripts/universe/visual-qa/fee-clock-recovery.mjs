import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { isUtf8 } from "node:buffer";
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
// An explicit manifest changes the tested candidate, never historical receipts.
export const AUDIT_ROOT =
  "C:/universe/mempool/audits/implementation-20261009-api";
const plainPath = (path) =>
  typeof path === "string" &&
  path.length > 0 &&
  path.length <= 512 &&
  !/[\\\r\n?#%:]/.test(path) &&
  !path.startsWith("/") &&
  path.split("/").every((p) => p && p !== "." && p !== "..");
export function rootedLocalFile(root, path, directory = false) {
  assert(
    typeof path === "string" && !/^[a-z]+:\/\//i.test(path),
    "Receipt must be local",
  );
  const base = realpathSync(root),
    absolute = resolve(root, path),
    rel = relative(base, absolute);
  assert(
    rel && !rel.startsWith("..") && !isAbsolute(rel),
    "Receipt/artifact outside audit root",
  );
  let current = absolute;
  while (current !== base) {
    assert(
      !lstatSync(current).isSymbolicLink(),
      "Linked receipt/artifact path",
    );
    current = dirname(current);
  }
  assert(
    directory
      ? lstatSync(absolute).isDirectory()
      : lstatSync(absolute).isFile(),
    "Wrong receipt/artifact type",
  );
  return absolute;
}
export function validateBuildReceipt(pins) {
  assert(
    pins?.schemaVersion === "universe-private-preview-build-v1",
    "Unsupported build receipt",
  );
  assert(
    /^[0-9a-f]{40}$/.test(pins.sourceCommit),
    "Exact source revision required",
  );
  assert.deepEqual(pins.sourceDrift, [], "Source drift in build receipt");
  for (const field of ["artifactFiles", "sourceFiles"]) {
    assert(
      pins[field] &&
        typeof pins[field] === "object" &&
        !Array.isArray(pins[field]),
      "Missing build file manifest",
    );
    const rows = Object.entries(pins[field]);
    assert(
      rows.length > 0 && rows.length <= 10000,
      "Unbounded/empty build manifest",
    );
    for (const [path, value] of rows)
      assert(
        plainPath(path) && /^[0-9a-f]{64}$/.test(value),
        "Unsafe build file/hash",
      );
  }
  assert(
    Object.keys(pins.sourceFiles).every(
      (p) => p.startsWith("frontend/") || p.startsWith("scripts/universe/"),
    ),
    "Non-source input path",
  );
  for (const path of [
    "frontend/src/app/components/clock/clock.component.ts",
    "frontend/src/app/components/clock/clock.component.html",
    "frontend/src/app/services/fee-estimate.ts",
    "frontend/src/app/services/websocket.service.ts",
    "frontend/src/app/services/state.service.ts",
  ])
    assert(pins.sourceFiles[path], "Missing consumer source pin");
  const mains = Object.keys(pins.artifactFiles).filter((p) =>
    /^main\.[a-f0-9]+\.js$/.test(p),
  );
  assert.equal(mains.length, 1, "Exactly one pinned main required");
  assert(
    pins.configSha256 &&
      pins.configSha256 === pins.artifactFiles["resources/config.js"],
    "Config manifest mismatch",
  );
  assert.equal(
    pins.configScriptPath,
    "/resources/config.js?v=" + pins.configSha256,
    "Config bootstrap pin mismatch",
  );
  return mains[0];
}
export function verifyGitSourceInputs(pins, repo) {
  assert(
    /^[0-9a-f]{40}$/.test(pins.sourceCommit),
    "Exact source commit required",
  );
  assert.equal(
    execFileSync("git", ["-C", repo, "cat-file", "-t", pins.sourceCommit], {
      encoding: "utf8",
    }).trim(),
    "commit",
    "Source revision must be a commit",
  );
  const paths = Object.keys(pins.sourceFiles).sort();
  const bytes = execFileSync("git", ["-C", repo, "cat-file", "--batch"], {
    input: paths.map((p) => pins.sourceCommit + ":" + p).join("\n") + "\n",
    maxBuffer: 256 * 1024 * 1024,
  });
  let cursor = 0;
  const encodings = {};
  for (const path of paths) {
    const end = bytes.indexOf(10, cursor);
    assert(end >= cursor);
    const header = bytes.subarray(cursor, end).toString("ascii");
    const parts = header.split(" ");
    assert(
      parts[1] === "blob" && /^\d+$/.test(parts[2]),
      "Source file absent from exact candidate: " + path,
    );
    const size = Number(parts[2]),
      body = bytes.subarray(end + 1, end + 1 + size);
    assert.equal(body.length, size);
    cursor = end + 2 + size;
    if (hash(body) === pins.sourceFiles[path])
      encodings[path] = "exact Git blob bytes";
    else {
      // Explicit source-checkout line endings only; no evidence bytes are written or normalized.
      assert(isUtf8(body), "Binary source drift: " + path);
      const lf = body.toString("utf8").replaceAll("\r\n", "\n");
      const variants = [
        ["source checkout LF", Buffer.from(lf)],
        ["source checkout CRLF", Buffer.from(lf.replaceAll("\n", "\r\n"))],
      ];
      const match = variants.find(
        ([, value]) => hash(value) === pins.sourceFiles[path],
      );
      if (match) encodings[path] = match[0];
      else {
        // A mixed-line-ending checkout cannot be inferred from a hash alone.
        // Require its actual recorded raw bytes and exact candidate text together.
        const local = readFileSync(rootedLocalFile(repo, path));
        assert.equal(
          hash(local),
          pins.sourceFiles[path],
          "Recorded source bytes unavailable/drifted: " + path,
        );
        assert(isUtf8(local), "Binary source mismatch: " + path);
        assert.equal(
          local.toString("utf8").replaceAll("\r\n", "\n"),
          lf,
          "Exact candidate source content drift: " + path,
        );
        encodings[path] =
          "recorded raw mixed source checkout; normalized content matches exact Git blob";
      }
    }
  }
  return {
    sourceCommit: pins.sourceCommit,
    sourceFilesVerified: paths.length,
    sourceManifestSha256: hash(Buffer.from(JSON.stringify(pins.sourceFiles))),
    encodings,
  };
}
export function loadExpectedBuildReceipt(audit, receiptPath, repo) {
  const path = rootedLocalFile(audit, receiptPath),
    raw = readFileSync(path),
    pins = JSON.parse(raw);
  const mainAsset = validateBuildReceipt(pins),
    artifact = rootedLocalFile(audit, pins.artifactPath, true);
  for (const [name, expected] of Object.entries(pins.artifactFiles))
    assertAsset(readFileSync(rootedLocalFile(artifact, name)), expected, name);
  const config = readFileSync(
    rootedLocalFile(artifact, "resources/config.js"),
    "utf8",
  );
  const commit = /GIT_COMMIT_HASH\s*=\s*["']([0-9a-f]{7,40})["']/.exec(
    config,
  )?.[1];
  assert(
    commit && pins.sourceCommit.startsWith(commit),
    "Configuration source stamp mismatch",
  );
  return {
    ...pins,
    mainAsset,
    expectedReceipt: { path, sha256: hash(raw) },
    sourceVerification: verifyGitSourceInputs(pins, repo),
  };
}
export function expectedLoadedAsset(pins, pathname, type, status) {
  if (status >= 400 || pathname.includes("/api/")) return null;
  const name =
    type === "document" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const expected = pins.artifactFiles[name];
  if (
    !expected &&
    [
      "document",
      "script",
      "stylesheet",
      "font",
      "image",
      "media",
      "manifest",
    ].includes(type)
  )
    assert.fail("Unpinned loaded asset: " + name);
  return expected ? { name, sha256: expected } : null;
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
        extras: {
          ...b.extras,
          pool: { id: 0, name: "Controlled fixture", slug: "default" },
        },
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
  assert(
    pins.mainAsset &&
      pins.sourceVerification?.sourceCommit === pins.sourceCommit,
    "Expected build receipt not verified",
  );
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
    frontendSource: pins.sourceCommit,
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
    const url = new URL(response.url());
    if (url.origin !== ORIGIN) return;
    try {
      const asset = expectedLoadedAsset(
        pins,
        url.pathname,
        response.request().resourceType(),
        response.status(),
      );
      if (asset)
        assetTasks.push(
          response
            .body()
            .then((bytes) => {
              assertAsset(bytes, asset.sha256, asset.name);
              loaded.set(asset.name, asset.sha256);
            })
            .catch((error) => report.errors.push(error.message)),
        );
    } catch (error) {
      report.errors.push(error.message);
    }
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
    loaded.has(pins.mainAsset) && loaded.has("resources/config.js"),
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
  assert.equal(
    realpathSync(audit),
    realpathSync(AUDIT_ROOT),
    "Only the existing audit root is allowed",
  );
  const repo = resolve(import.meta.dirname, "../../..");
  const explicit = process.argv[3];
  const pins = loadExpectedBuildReceipt(
    audit,
    explicit ?? "clock-history-preview-build-receipt-ac8ec2a64.json",
    repo,
  );
  if (!explicit)
    assert.equal(pins.sourceCommit, CANDIDATE, "Default ac8 history changed");
  for (const name of [pins.mainAsset, "resources/config.js"]) {
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
    "fee-clock-controlled-browser-" +
      pins.sourceCommit.slice(0, 12) +
      "-" +
      Date.now() +
      "-receipt.json",
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
    report.expectedBuildReceipt = pins.expectedReceipt;
    report.sourceVerification = pins.sourceVerification;
    report.playwrightPackageVersion =
      require("playwright/package.json").version;
    report.harnessSha256 = hash(readFileSync(new URL(import.meta.url)));
    report.fixtureModuleSha256 = hash(
      readFileSync(new URL("./fixtures.mjs", import.meta.url)),
    );
    report.assetPins = {
      main: pins.artifactFiles[pins.mainAsset],
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
