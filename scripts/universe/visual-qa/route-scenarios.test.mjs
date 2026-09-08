import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { matchFixtureRequest } from "./fixture-match.mjs";
import { VIEWPORTS as MOBILE_VIEWPORTS } from "./mobile-check.mjs";
import {
  addressFixtures,
  detailFixtures,
  failClosedProductRequests,
  fixtures,
  sampleIds,
} from "./fixtures.mjs";
import {
  PRODUCTION_ROUTE_CLASSES,
  PRODUCTION_ROUTE_SCENARIOS,
  QA_TEST_CLASSES,
  routePatternMatches,
  routesFor,
} from "./route-scenarios.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function read(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function pathDeclarations(source) {
  return [
    ...source.matchAll(
      /\bpath\s*:\s*(?:'([^'\r\n]*)'|"([^"\r\n]*)"|`([^`${}\r\n]*)`)/g,
    ),
  ].map((match) => ({
    index: match.index,
    value: match[1] ?? match[2] ?? match[3],
  }));
}

function literals(source) {
  return pathDeclarations(source).map((declaration) => declaration.value);
}

function pathLiterals(path) {
  return literals(read(path));
}

function concrete(paths) {
  return [...new Set(paths)].filter((path) => path && path !== "**");
}

function mounted(prefix, path) {
  return `${prefix}/${path}`.replace(/\/+/g, "/") || "/";
}

function routeObject(source, path, offset = 0) {
  const declaration = pathDeclarations(source).find(
    (candidate) => candidate.index >= offset && candidate.value === path,
  );
  assert.ok(declaration, `router declares ${path}`);
  const pathIndex = declaration.index;
  const start = source.lastIndexOf("{", pathIndex);
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`route object for ${path} is not closed`);
}

function balancedCall(source, openIndex) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex, index + 1);
    }
  }
  return source.slice(openIndex);
}

function staticNavigationTargets(source) {
  const regions = [];
  for (const match of source.matchAll(/\bnavigate(?:ByUrl)?\s*\(/g)) {
    const openIndex = source.indexOf("(", match.index);
    regions.push(balancedCall(source, openIndex));
  }
  for (const match of source.matchAll(/\brouterLink\b/g)) {
    const start = source.lastIndexOf("<", match.index);
    const end = source.indexOf(">", match.index);
    if (start >= 0 && end >= match.index) {
      regions.push(source.slice(start, end + 1));
    }
  }

  const targets = new Set();
  for (const region of regions) {
    for (const match of region.matchAll(/(['"`])(\/[^'"`\s]*)\1/g)) {
      const target =
        match[2]
          .replace(/\$\{[^}]+\}/g, "qa-value")
          .split(/[?#]/)[0]
          .replace(/\/+$/, "") || "/";
      targets.add(target);
    }
  }
  return targets;
}

test("route path scanner accepts every static string quote style", () => {
  const source = `[
    { path: 'single', marker: 'a' },
    { path: "double", marker: "b" },
    { path: \`template\`, marker: \`c\` },
  ]`;
  assert.deepEqual(literals(source), ["single", "double", "template"]);
  for (const path of literals(source)) {
    assert.match(routeObject(source, path), /marker/);
  }
});

test("static navigation scanner follows multiline declarations", () => {
  const source = `
    this.router.navigate(
      [
        "/portfolio/p/qa-portfolio-001/holdings",
      ],
    );
    this.router.navigateByUrl(
      \`/portfolio/manage\`,
    );
    <a
      [routerLink]="[
        '/portfolio/settings'
      ]"
    >Settings</a>
  `;
  assert.deepEqual([...staticNavigationTargets(source)].sort(), [
    "/portfolio/manage",
    "/portfolio/p/qa-portfolio-001/holdings",
    "/portfolio/settings",
  ]);
});

test("every scenario id and route class id is unique", () => {
  const scenarioIds = PRODUCTION_ROUTE_SCENARIOS.map((scenario) => scenario.id);
  const classIds = PRODUCTION_ROUTE_CLASSES.map((routeClass) => routeClass.id);
  assert.equal(new Set(scenarioIds).size, scenarioIds.length);
  assert.equal(new Set(classIds).size, classIds.length);
  const classPatterns = new Set(
    PRODUCTION_ROUTE_CLASSES.map((routeClass) => routeClass.pattern),
  );
  assert.equal(
    classPatterns.size,
    PRODUCTION_ROUTE_CLASSES.length,
    "route class patterns are unique",
  );
  for (const scenario of PRODUCTION_ROUTE_SCENARIOS) {
    assert.ok(
      classPatterns.has(scenario.pattern),
      `${scenario.id} refers to a live route class`,
    );
    assert.ok(
      routePatternMatches(scenario.pattern, scenario.path),
      `${scenario.id} path ${scenario.path} matches ${scenario.pattern}`,
    );
  }
});

test("each parameter class has fixed valid and invalid examples", () => {
  for (const routeClass of PRODUCTION_ROUTE_CLASSES) {
    const names = [
      ...routeClass.pattern.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/g),
    ].map((match) => match[1]);
    assert.deepEqual(
      Object.keys(routeClass.parameters).sort(),
      [...names].sort(),
      routeClass.pattern,
    );
    for (const name of names) {
      const fixture = routeClass.parameters[name];
      assert.notEqual(
        fixture.valid,
        fixture.invalid,
        `${routeClass.pattern} :${name}`,
      );
      assert.match(
        String(fixture.invalid),
        /^qa-invalid-/,
        `${routeClass.pattern} :${name}`,
      );
    }
    if (names.length) {
      const valid = PRODUCTION_ROUTE_SCENARIOS.find(
        (scenario) =>
          scenario.routeClassId === routeClass.id &&
          scenario.variant === "valid",
      );
      const invalid = PRODUCTION_ROUTE_SCENARIOS.find(
        (scenario) =>
          scenario.routeClassId === routeClass.id &&
          scenario.variant === "invalid",
      );
      assert.ok(valid, `${routeClass.id} needs a valid scenario`);
      assert.ok(invalid, `${routeClass.id} needs an invalid scenario`);
      assert.ok(
        !/:([A-Za-z][A-Za-z0-9_]*)/.test(valid.path),
        `${routeClass.id} valid path is materialized`,
      );
      assert.ok(
        !/:([A-Za-z][A-Za-z0-9_]*)/.test(invalid.path),
        `${routeClass.id} invalid path is materialized`,
      );
    }
  }
});

test("every scenario explicitly decides every QA class", () => {
  for (const scenario of PRODUCTION_ROUTE_SCENARIOS) {
    assert.deepEqual(
      Object.keys(scenario.coverage).sort(),
      [...QA_TEST_CLASSES].sort(),
      scenario.id,
    );
    for (const testClass of QA_TEST_CLASSES) {
      const choice = scenario.coverage[testClass];
      assert.ok(
        choice === true || (typeof choice === "string" && choice.length >= 12),
        `${scenario.id} needs an inclusion or exclusion for ${testClass}`,
      );
    }
  }
  for (const testClass of QA_TEST_CLASSES) {
    assert.ok(
      routesFor(testClass).length > 0,
      `${testClass} selects at least one scenario`,
    );
  }
});

test("every requested Universe release family is represented", () => {
  const families = new Set(
    PRODUCTION_ROUTE_CLASSES.map((routeClass) => routeClass.family),
  );
  for (const family of [
    "anima",
    "ark",
    "data",
    "fractal",
    "layer-2",
    "liquid",
    "network",
    "portfolio",
    "stratum-v2",
    "taproot-assets",
    "utxo",
    "wildkin",
    "zcash-privacy",
    "rgb",
    "script",
    "payment",
    "lightning-standards",
  ]) {
    assert.ok(families.has(family), `route registry includes ${family}`);
  }
});

test("release routes without exact local data have explicit local exclusions", () => {
  const pendingExactFixtures = new Set([
    "mempool-intelligence",
    "mining-lab",
    "network",
    "node",
  ]);
  for (const scenario of PRODUCTION_ROUTE_SCENARIOS) {
    if (
      scenario.variant !== "valid" ||
      !pendingExactFixtures.has(scenario.family)
    )
      continue;
    assert.notEqual(
      scenario.coverage.visual,
      true,
      `${scenario.id} needs exact fixtures before visual QA`,
    );
    assert.notEqual(
      scenario.coverage.mobile,
      true,
      `${scenario.id} needs exact fixtures before mobile QA`,
    );
    assert.ok(
      scenario.coverage.live === true || scenario.coverage.acceptance === true,
      `${scenario.id} remains covered against deployed data`,
    );
  }
});

test("new product families have visual and mobile coverage with no unmatched requests", () => {
  const expectedFamilies = [
    "ark",
    "data",
    "fractal",
    "layer-2",
    "lightning-standards",
    "liquid",
    "payment",
    "rgb",
    "script",
    "stratum-v2",
    "taproot-assets",
    "utxo",
    "wildkin",
    "zcash-privacy",
  ];
  assert.deepEqual(
    Object.keys(failClosedProductRequests).sort(),
    [...expectedFamilies].sort(),
  );

  for (const testClass of ["visual", "mobile"]) {
    const selected = routesFor(testClass);
    for (const family of expectedFamilies) {
      assert.ok(
        selected.some((scenario) => scenario.family === family),
        `${family} has a ${testClass} scenario`,
      );
    }
  }

  const localOnly = new Set(["payment", "rgb", "script"]);
  for (const [family, paths] of Object.entries(failClosedProductRequests)) {
    if (localOnly.has(family)) {
      assert.deepEqual(paths, [], `${family} makes no request on first render`);
      continue;
    }
    assert.ok(paths.length > 0, `${family} declares its fail-closed requests`);
    for (const path of paths) {
      const match = matchFixtureRequest({
        path,
        method: path === "/api/v1/data/query" ? "POST" : "GET",
        table: fixtures,
      });
      assert.notEqual(
        match.kind,
        "missing",
        `${family} request ${path} is matched`,
      );
      assert.equal(match.status, 503, `${family} request ${path} fails closed`);
      assert.equal(
        match.expectedFailure,
        true,
        `${family} request ${path} is expected`,
      );
    }
  }
});

test("selected core pages have exact fixtures for their overlay requests", () => {
  const table = { ...fixtures, ...detailFixtures, ...addressFixtures };
  const blockHeight = fixtures["/api/v1/blocks"][0].height;
  const requirements = [
    {
      scenarioIds: ["home", "chain-menu", "pulse"],
      method: "POST",
      path: "/api/v1/universe/transactions/batch",
    },
    {
      scenarioIds: ["block"],
      method: "GET",
      path: `/api/v1/universe/blocks/${blockHeight}/inscriptions`,
    },
    {
      scenarioIds: ["address"],
      method: "POST",
      path: "/api/v1/universe/outpoints/batch",
    },
  ];

  for (const testClass of ["visual", "mobile"]) {
    const selected = new Set(
      routesFor(testClass).map((scenario) => scenario.id),
    );
    for (const requirement of requirements) {
      for (const scenarioId of requirement.scenarioIds) {
        assert.ok(
          selected.has(scenarioId),
          `${scenarioId} remains selected for ${testClass}`,
        );
      }
      const match = matchFixtureRequest({
        path: requirement.path,
        method: requirement.method,
        table,
      });
      assert.equal(
        match.kind,
        "response",
        `${requirement.path} has an exact fixture`,
      );
      assert.equal(match.status, 200, `${requirement.path} fixture succeeds`);
    }
  }

  const transactionResults =
    fixtures["/api/v1/universe/transactions/batch"].results;
  assert.deepEqual(
    transactionResults.map((entry) => entry.txid),
    fixtures["/api/mempool/recent"].map((entry) => entry.txid),
    "transaction batch answers every deterministic socket transaction",
  );

  const addressUtxos =
    addressFixtures[`/api/address/${sampleIds.ADDRESS}/utxo`];
  const outpointResults =
    addressFixtures["/api/v1/universe/outpoints/batch"].results;
  assert.deepEqual(
    outpointResults.map((entry) => entry.outpoint),
    addressUtxos.map((entry) => `${entry.txid}:${entry.vout}`),
    "outpoint batch answers every deterministic address output",
  );
});

test("every browser entry point selects from the shared registry", () => {
  for (const [file, testClass] of [
    ["capture.mjs", "visual"],
    ["mobile-check.mjs", "mobile"],
    ["modes-check.mjs", "modes"],
    ["keyboard-check.mjs", "keyboard"],
    ["live-e2e.mjs", "live"],
    ["acceptance.mjs", "acceptance"],
    ["mobile-perf.mjs", "performance"],
  ]) {
    assert.match(
      read(`scripts/universe/visual-qa/${file}`),
      new RegExp(`routesFor\\(['"]${testClass}['"]\\)`),
      `${file} selects ${testClass}`,
    );
  }
});

test("saved Portfolio pages use a real encrypted browser lifecycle in every requested gate", () => {
  const savedIds = [
    "portfolio-project",
    "portfolio-overview",
    "portfolio-holdings",
    "portfolio-activity",
    "portfolio-performance",
    "portfolio-time-machine",
    "portfolio-utxos",
    "portfolio-insights",
    "portfolio-sources",
    "portfolio-reports",
  ];

  for (const testClass of ["visual", "mobile", "keyboard", "acceptance"]) {
    const selected = new Map(
      routesFor(testClass).map((scenario) => [scenario.id, scenario]),
    );
    for (const id of savedIds) {
      expectSavedRoute(selected.get(id), `${id} is selected for ${testClass}`);
    }
  }
  const mobile = new Map(
    routesFor("mobile").map((scenario) => [scenario.id, scenario]),
  );
  assert.equal(mobile.get("portfolio-overview")?.fullMobileSweep, true);
  assert.equal(mobile.get("portfolio-holdings")?.fullMobileSweep, true);

  for (const file of [
    "capture.mjs",
    "mobile-check.mjs",
    "keyboard-check.mjs",
    "acceptance.mjs",
  ]) {
    const contents = read(`scripts/universe/visual-qa/${file}`);
    assert.match(
      contents,
      /seedPortfolioVault\s*\(/,
      `${file} seeds the encrypted vault`,
    );
    assert.match(
      contents,
      /unlockPortfolioRoute\s*\(/,
      `${file} unlocks through the product UI`,
    );
  }
  assert.match(
    read("scripts/universe/visual-qa/portfolio-fixture.mjs"),
    /passphrase\.press\(["']Enter["']\)/,
    "the fixture submits the focused unlock form without selecting another form",
  );
});

test("saved Portfolio pages have exact populated API fixtures", () => {
  for (const endpoint of [
    "summary",
    "holdings",
    "activity",
    "utxos",
    "performance",
    "coverage",
    "delta",
  ]) {
    const path = `/api/v2/universe/portfolio/bitcoin/mainnet/${sampleIds.ADDRESS}/${endpoint}`;
    const match = matchFixtureRequest({ path, method: "GET", table: fixtures });
    assert.equal(match.kind, "response", `${endpoint} has an exact response`);
    assert.equal(match.status, 200, `${endpoint} fixture succeeds`);
  }
});

test("mobile gate keeps the complete phone and tablet viewport inventory", () => {
  const inventory = new Map(
    MOBILE_VIEWPORTS.map((viewport) => [viewport.id, viewport]),
  );
  for (const expected of [
    { id: "phone-320", width: 320, height: 568, compact: true },
    { id: "phone-360", width: 360, height: 740, compact: true },
    { id: "phone-375", width: 375, height: 812, compact: true },
    { id: "phone-390", width: 390, height: 844, compact: true },
    { id: "phone-412", width: 412, height: 915, compact: true },
    { id: "phone-430", width: 430, height: 932, compact: true },
    {
      id: "phone-landscape",
      width: 844,
      height: 390,
      compact: true,
      landscape: true,
    },
    { id: "tablet-768", width: 768, height: 1024, compact: true },
    {
      id: "tablet-landscape",
      width: 1024,
      height: 768,
      compact: true,
      landscape: true,
    },
    { id: "desktop-1024", width: 1024, height: 900, compact: false },
  ]) {
    assert.deepEqual(
      inventory.get(expected.id),
      { ...inventory.get(expected.id), ...expected },
      `${expected.id} keeps its required dimensions and input mode`,
    );
  }
  assert.equal(
    inventory.size,
    10,
    "viewport inventory changes require a test update",
  );

  const contents = read("scripts/universe/visual-qa/mobile-check.mjs");
  assert.match(
    contents,
    /NARROW_VIEWPORT_IDS\s*=\s*new Set\(\[\s*["']phone-320["'],\s*["']phone-390["'],\s*["']phone-landscape["'],?\s*\]\)/,
    "every route keeps the narrow three while full-sweep routes add the complete inventory",
  );
});

function expectSavedRoute(scenario, message) {
  assert.ok(scenario, message);
  assert.equal(
    scenario.requiresPortfolioVault,
    true,
    `${scenario.id} requires the local vault`,
  );
}

test("Angular production declarations and route classes stay in parity", () => {
  const registered = new Set(
    PRODUCTION_ROUTE_CLASSES.map((routeClass) => routeClass.pattern),
  );
  const declared = new Set(["/"]);

  for (const path of concrete(
    pathLiterals("frontend/src/app/master-page.module.ts"),
  )) {
    const pattern = mounted("", path);
    declared.add(pattern);
    assert.ok(
      registered.has(pattern),
      `master route ${pattern} needs a QA class`,
    );
  }

  const portfolioTop = new Set([
    "new",
    "manage",
    "settings",
    "workspace",
    "p/:portfolioId",
    "share/:shareId",
    ":chain/:network/:address",
  ]);
  for (const path of concrete(
    pathLiterals("frontend/src/app/universe/portfolio/portfolio.routes.ts"),
  )) {
    const pattern = portfolioTop.has(path)
      ? mounted("/portfolio", path)
      : mounted("/portfolio/p/:portfolioId", path);
    declared.add(pattern);
    assert.ok(
      registered.has(pattern),
      `Portfolio route ${pattern} needs a QA class`,
    );
  }
  declared.add("/portfolio");

  for (const path of concrete(
    pathLiterals("frontend/src/app/universe/anima/anima.routes.ts"),
  )) {
    const pattern = mounted("/anima", path);
    declared.add(pattern);
    assert.ok(
      registered.has(pattern),
      `ANIMA route ${pattern} needs a QA class`,
    );
  }
  declared.add("/anima");

  const chainChildren = concrete(
    pathLiterals(
      "frontend/src/app/universe/multichain-explorer/multichain-explorer.module.ts",
    ),
  );
  const chartBlock = read(
    "frontend/src/app/universe/chain-graphs/chain-chart-config.ts",
  )
    .split("export const CHART_ROUTE_CHILDREN")[1]
    .split("];")[0];
  const chartChildren = concrete(
    [...chartBlock.matchAll(/\bpath\s*:\s*'([^']*)'/g)].map(
      (match) => match[1],
    ),
  );
  for (const chain of ["dogecoin", "zcash"]) {
    declared.add(`/${chain}`);
    for (const path of chainChildren) {
      const pattern = mounted(`/${chain}`, path);
      declared.add(pattern);
      assert.ok(
        registered.has(pattern),
        `${chain} route ${pattern} needs a QA class`,
      );
    }
    for (const path of chartChildren) {
      const pattern = mounted(`/${chain}/graphs`, path);
      declared.add(pattern);
      assert.ok(
        registered.has(pattern),
        `${chain} chart ${pattern} needs a QA class`,
      );
    }
    const docsPattern = `/${chain}/docs/:section`;
    declared.add(docsPattern);
    assert.ok(
      registered.has(docsPattern),
      `${chain} docs section needs a QA class`,
    );
  }

  for (const path of concrete(
    pathLiterals("frontend/src/app/universe/universe-routing.module.ts"),
  )) {
    const pattern = mounted("/protocols", path);
    declared.add(pattern);
    assert.ok(
      registered.has(pattern),
      `protocol route ${pattern} needs a QA class`,
    );
  }
  declared.add("/protocols");

  const appPaths = pathLiterals("frontend/src/app/app-routing.module.ts");
  const appSource = read("frontend/src/app/app-routing.module.ts").split(
    "if (browserWindowEnv && browserWindowEnv.BASE_MODULE === 'liquid')",
  )[0];
  for (const path of [
    "status",
    "testnet",
    "testnet4",
    "signet",
    "regtest",
    "widget/wallet",
    "preview",
    "clock",
    "clock/:mode",
    "clock/:mode/:index",
    "view/block/:id",
    "view/mempool-block/:index",
    "view/blocks",
  ]) {
    assert.ok(appPaths.includes(path), `root router declares ${path}`);
    const pattern = `/${path}`;
    declared.add(pattern);
    assert.ok(
      registered.has(pattern),
      `root route ${pattern} needs a QA class`,
    );
  }

  for (const network of ["testnet", "testnet4", "signet", "regtest"]) {
    const pattern = `/preview/${network}`;
    declared.add(pattern);
    assert.ok(
      registered.has(pattern),
      `preview route ${pattern} needs a QA class`,
    );
  }

  let networkOffset = 0;
  for (const [network, expectedChildren] of [
    ["testnet", ["widget/wallet", "status"]],
    ["testnet4", ["wallet", "status"]],
    ["signet", ["mining/blocks", "widget/wallet", "status"]],
    ["regtest", ["mining/blocks", "widget/wallet", "status"]],
  ]) {
    const block = routeObject(appSource, network, networkOffset);
    networkOffset = appSource.indexOf(block, networkOffset) + block.length;
    const children = concrete(literals(block));
    for (const child of expectedChildren) {
      assert.ok(
        children.includes(child),
        `${network} router declares ${child}`,
      );
      const pattern = mounted(`/${network}`, child);
      declared.add(pattern);
      assert.ok(
        registered.has(pattern),
        `${network} route ${pattern} needs a QA class`,
      );
    }
  }

  const previewBlock = routeObject(appSource, "preview", networkOffset);
  for (const network of ["testnet", "testnet4", "signet", "regtest"]) {
    assert.ok(
      literals(previewBlock).includes(network),
      `preview router declares ${network}`,
    );
  }

  for (const path of concrete(
    pathLiterals("frontend/src/app/previews.routing.module.ts"),
  )) {
    const pattern = mounted("/preview", path);
    declared.add(pattern);
    assert.ok(
      registered.has(pattern),
      `preview route ${pattern} needs a QA class`,
    );
  }
  for (const path of concrete(
    pathLiterals(
      "frontend/src/app/lightning/lightning-previews.routing.module.ts",
    ),
  )) {
    const pattern = mounted("/preview/lightning", path);
    declared.add(pattern);
    assert.ok(
      registered.has(pattern),
      `Lightning preview ${pattern} needs a QA class`,
    );
  }

  const mountedSources = [
    ["frontend/src/app/components/transaction/transaction.module.ts", ["/tx"]],
    ["frontend/src/app/components/block/block.module.ts", ["/block"]],
    [
      "frontend/src/app/graphs/graphs.routing.module.ts",
      ["", "/graphs", "/graphs/lightning"],
    ],
    [
      "frontend/src/app/graphs/lightning-graphs.module.ts",
      ["/graphs/lightning"],
    ],
    ["frontend/src/app/lightning/lightning.routing.module.ts", ["/lightning"]],
    ["frontend/src/app/docs/docs.routing.module.ts", ["/docs"]],
  ];
  for (const [source, mounts] of mountedSources) {
    for (const path of concrete(pathLiterals(source))) {
      const candidates = mounts.map((prefix) => mounted(prefix, path));
      const matches = candidates.filter((candidate) =>
        registered.has(candidate),
      );
      assert.ok(matches.length, `${source} path ${path} needs a QA class`);
      for (const pattern of matches) declared.add(pattern);
    }
  }

  for (const pattern of registered) {
    assert.ok(declared.has(pattern), `stale QA route class ${pattern}`);
  }
});

function filesUnder(path) {
  const entries = readdirSync(path, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const target = join(path, entry.name);
    return entry.isDirectory() ? filesUnder(target) : [target];
  });
}

test("static Angular navigation targets resolve to a registered route class", () => {
  const roots = [
    join(ROOT, "frontend/src/app/universe"),
    join(ROOT, "frontend/src/app/components/master-page"),
  ];
  const targets = new Set();
  for (const file of roots
    .flatMap(filesUnder)
    .filter((path) => [".ts", ".html"].includes(extname(path)))) {
    for (const target of staticNavigationTargets(readFileSync(file, "utf8"))) {
      targets.add(target);
    }
  }

  const patterns = PRODUCTION_ROUTE_CLASSES.map(
    (routeClass) => routeClass.pattern,
  );
  for (const target of targets) {
    const covered = patterns.some(
      (pattern) =>
        routePatternMatches(pattern, target) ||
        pattern.startsWith(`${target}/`),
    );
    assert.ok(
      covered,
      `navigation target ${target} needs a registered route class`,
    );
  }
  assert.ok(
    targets.size > 25,
    `expected broad navigation coverage, found ${targets.size}`,
  );
});

test("unmatched fixtures fail and invalid parameter fixtures return 404", () => {
  const table = { "/api/known": [] };
  assert.equal(matchFixtureRequest({ path: "/api/known", table }).status, 200);

  const formerPrefixHit = matchFixtureRequest({
    path: "/api/known/child",
    table,
  });
  assert.equal(
    formerPrefixHit.kind,
    "missing",
    "fixture tables match exact paths only",
  );

  const missing = matchFixtureRequest({ path: "/api/not-listed", table });
  assert.equal(missing.kind, "missing");
  assert.equal(missing.status, 501);
  assert.match(missing.body, /qa-fixture-missing/);

  const invalid = matchFixtureRequest({
    path: "/api/tx/qa-invalid-txid",
    table,
  });
  assert.equal(invalid.kind, "response");
  assert.equal(invalid.status, 404);
  assert.equal(invalid.expectedFailure, true);

  const overridden = matchFixtureRequest({
    path: "/api/items/one/history",
    table,
    overrides: {
      "/api/items": { body: ["broad"] },
      "/api/items/one": { body: ["specific"] },
    },
  });
  assert.deepEqual(JSON.parse(overridden.body), ["specific"]);

  const trailingSlashOverride = matchFixtureRequest({
    path: "/api/charts/hashrate",
    table,
    overrides: {
      "/api/charts/": { status: 503 },
    },
  });
  assert.equal(trailingSlashOverride.status, 503);
  assert.equal(trailingSlashOverride.expectedFailure, true);

  for (const path of [
    "/api/v1/universe/sources",
    "/api/v1/anima/events/a907098%3A0",
    "/api/v1/anima/organisms/0aff",
    "/api/v1/anima/organisms/0aff/history",
  ]) {
    const exact = matchFixtureRequest({ path, table: fixtures });
    assert.equal(exact.kind, "response", `${path} has an exact fixture`);
    assert.equal(exact.status, 200, `${path} fixture succeeds`);
  }
});
