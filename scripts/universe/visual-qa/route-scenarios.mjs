/**
 * Single production route registry shared by every browser QA entry point.
 *
 * A route class records the Angular path, fixed parameter examples, and the
 * reason each QA class includes or excludes it. The static parity test reads
 * the Angular declarations and navigation targets and compares them with this
 * registry, so adding or removing a route cannot silently leave QA behind.
 */
import { assetSampleIds } from "./asset-fixtures.mjs";
import { chainSampleIds } from "./chain-fixtures.mjs";
import { sampleIds } from "./fixtures.mjs";
import { QA_PORTFOLIO_ID } from "./portfolio-fixture.mjs";

export const QA_TEST_CLASSES = Object.freeze([
  "visual",
  "mobile",
  "modes",
  "keyboard",
  "live",
  "acceptance",
  "performance",
]);

const MODE_SAMPLE =
  "A representative of this layout family runs in the mode gate.";
const KEYBOARD_SAMPLE = "A representative workflow runs in the keyboard gate.";
const LIVE_SAMPLE = "The live API gate samples data-backed representatives.";
const PERF_SAMPLE =
  "The performance gate samples shell and dense-page representatives.";
const FIXTURE_ONLY =
  "This local workflow has no remote API contract to forward.";
const CONDITIONAL_BUILD =
  "This path exists only when its production feature switch is enabled.";
const REDIRECT_ONLY =
  "The acceptance gate verifies this redirect without duplicating a visual page.";
const COMPONENT_ALIAS =
  "The primary path exercises the same component; acceptance verifies this alias.";
const PARENT_MOUNT = "This parent mount has no terminal page of its own.";
const INVALID_LOCAL_ACCOUNT =
  "The saved-account route guard unit tests exercise unknown local identifiers.";
const EXACT_LOCAL_FIXTURE =
  "No exact local request fixture exists yet; live and acceptance exercise this route.";

function decision(values) {
  const result = {};
  for (const testClass of QA_TEST_CLASSES) {
    const value = values[testClass];
    if (
      value !== true &&
      (typeof value !== "string" || value.trim().length < 12)
    ) {
      throw new Error(`route coverage decision missing for ${testClass}`);
    }
    result[testClass] = value;
  }
  return Object.freeze(result);
}

const COVERAGE = Object.freeze({
  core: decision({
    visual: true,
    mobile: true,
    modes: true,
    keyboard: true,
    live: LIVE_SAMPLE,
    acceptance: true,
    performance: true,
  }),
  detail: decision({
    visual: true,
    mobile: true,
    modes: MODE_SAMPLE,
    keyboard: KEYBOARD_SAMPLE,
    live: true,
    acceptance: true,
    performance: PERF_SAMPLE,
  }),
  product: decision({
    visual: true,
    mobile: true,
    modes: MODE_SAMPLE,
    keyboard: KEYBOARD_SAMPLE,
    live: true,
    acceptance: true,
    performance: PERF_SAMPLE,
  }),
  remote: decision({
    visual: EXACT_LOCAL_FIXTURE,
    mobile: EXACT_LOCAL_FIXTURE,
    modes: EXACT_LOCAL_FIXTURE,
    keyboard: KEYBOARD_SAMPLE,
    live: true,
    acceptance: true,
    performance: EXACT_LOCAL_FIXTURE,
  }),
  form: decision({
    visual: "The keyboard gate exercises this input workflow.",
    mobile: "The keyboard gate exercises this input workflow.",
    modes: MODE_SAMPLE,
    keyboard: true,
    live: FIXTURE_ONLY,
    acceptance: true,
    performance: PERF_SAMPLE,
  }),
  local: decision({
    visual: true,
    mobile: true,
    modes: MODE_SAMPLE,
    keyboard: true,
    live: FIXTURE_ONLY,
    acceptance: true,
    performance: PERF_SAMPLE,
  }),
  localAccount: decision({
    visual: true,
    mobile: true,
    modes: MODE_SAMPLE,
    keyboard: true,
    live: FIXTURE_ONLY,
    acceptance: true,
    performance: PERF_SAMPLE,
  }),
  redirect: decision({
    visual: REDIRECT_ONLY,
    mobile: REDIRECT_ONLY,
    modes: REDIRECT_ONLY,
    keyboard: REDIRECT_ONLY,
    live: REDIRECT_ONLY,
    acceptance: true,
    performance: REDIRECT_ONLY,
  }),
  alias: decision({
    visual: COMPONENT_ALIAS,
    mobile: COMPONENT_ALIAS,
    modes: COMPONENT_ALIAS,
    keyboard: COMPONENT_ALIAS,
    live: COMPONENT_ALIAS,
    acceptance: true,
    performance: COMPONENT_ALIAS,
  }),
  mount: decision({
    visual: PARENT_MOUNT,
    mobile: PARENT_MOUNT,
    modes: PARENT_MOUNT,
    keyboard: PARENT_MOUNT,
    live: PARENT_MOUNT,
    acceptance: PARENT_MOUNT,
    performance: PARENT_MOUNT,
  }),
  visualState: decision({
    visual: true,
    mobile: true,
    modes: "The closed homepage represents this route in the mode gate.",
    keyboard: "The closed homepage represents this route in the keyboard gate.",
    live: "This menu state does not change the live API contract.",
    acceptance:
      "The deployed route is the homepage already covered by acceptance.",
    performance: "The closed homepage carries the performance budget.",
  }),
  conditional: decision({
    visual: CONDITIONAL_BUILD,
    mobile: CONDITIONAL_BUILD,
    modes: CONDITIONAL_BUILD,
    keyboard: CONDITIONAL_BUILD,
    live: CONDITIONAL_BUILD,
    acceptance: CONDITIONAL_BUILD,
    performance: CONDITIONAL_BUILD,
  }),
  invalid: decision({
    visual: true,
    mobile: true,
    modes: MODE_SAMPLE,
    keyboard: KEYBOARD_SAMPLE,
    live: "Invalid identifiers use deterministic local 404 fixtures.",
    acceptance: "Invalid identifiers run against deterministic local fixtures.",
    performance: PERF_SAMPLE,
  }),
  remoteInvalid: decision({
    visual: EXACT_LOCAL_FIXTURE,
    mobile: EXACT_LOCAL_FIXTURE,
    modes: EXACT_LOCAL_FIXTURE,
    keyboard: EXACT_LOCAL_FIXTURE,
    live: EXACT_LOCAL_FIXTURE,
    acceptance: EXACT_LOCAL_FIXTURE,
    performance: EXACT_LOCAL_FIXTURE,
  }),
  invalidLocalAccount: decision({
    visual: INVALID_LOCAL_ACCOUNT,
    mobile: INVALID_LOCAL_ACCOUNT,
    modes: INVALID_LOCAL_ACCOUNT,
    keyboard: INVALID_LOCAL_ACCOUNT,
    live: FIXTURE_ONLY,
    acceptance: INVALID_LOCAL_ACCOUNT,
    performance: INVALID_LOCAL_ACCOUNT,
  }),
});

const routeClasses = [];
const scenarios = [];

function titleFromId(id) {
  return id
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function parameterNames(pattern) {
  return [...pattern.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/g)].map(
    (match) => match[1],
  );
}

function fill(pattern, values) {
  return pattern.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_, name) =>
    String(values[name]),
  );
}

function addRoute({
  id,
  pattern,
  family,
  params = {},
  coverage = COVERAGE.remote,
  invalidCoverage,
  name = titleFromId(id),
  fullMobileSweep = false,
  gateProgress = true,
  expect = "generic",
  timeline = false,
  redirectTo,
  invalid = true,
  open,
  overlayObscures = false,
  requiresPortfolioVault = false,
}) {
  const names = parameterNames(pattern);
  const resolvedInvalidCoverage =
    invalidCoverage ??
    (coverage.visual === true || coverage.mobile === true
      ? COVERAGE.invalid
      : COVERAGE.remoteInvalid);
  const validValues = {};
  const invalidValues = {};
  for (const parameter of names) {
    const fixture = params[parameter];
    if (
      !fixture ||
      fixture.valid === undefined ||
      fixture.invalid === undefined
    ) {
      throw new Error(
        `${pattern} needs valid and invalid values for :${parameter}`,
      );
    }
    validValues[parameter] = fixture.valid;
    invalidValues[parameter] = fixture.invalid;
  }
  const extra = Object.keys(params).filter(
    (parameter) => !names.includes(parameter),
  );
  if (extra.length)
    throw new Error(
      `${pattern} has unused fixture values: ${extra.join(", ")}`,
    );

  const routeClass = Object.freeze({
    id,
    pattern,
    family,
    parameters: Object.freeze(
      Object.fromEntries(
        names.map((parameter) => [
          parameter,
          Object.freeze({ ...params[parameter] }),
        ]),
      ),
    ),
  });
  routeClasses.push(routeClass);

  scenarios.push(
    Object.freeze({
      id,
      routeClassId: id,
      pattern,
      path: fill(pattern, validValues),
      family,
      name,
      variant: "valid",
      coverage,
      fullMobileSweep,
      gateProgress,
      expect,
      timeline,
      redirectTo,
      open,
      overlayObscures,
      requiresPortfolioVault,
    }),
  );

  if (names.length && invalid) {
    scenarios.push(
      Object.freeze({
        id: `${id}-invalid`,
        routeClassId: id,
        pattern,
        path: fill(pattern, invalidValues),
        family,
        name: `${name}, invalid identifier`,
        variant: "invalid",
        coverage: resolvedInvalidCoverage,
        fullMobileSweep: false,
        gateProgress,
        expect,
        timeline: false,
        requiresPortfolioVault,
      }),
    );
  }
}

const value = (valid, name) =>
  Object.freeze({ valid, invalid: `qa-invalid-${name}` });
const TXID = value(sampleIds.TXID_A, "txid");
const BLOCK = value(sampleIds.BLOCK_HASH, "block");
const ADDRESS = value(sampleIds.ADDRESS, "address");

// Core explorer classes and aliases mounted by the root and master routers.
addRoute({
  id: "home",
  pattern: "/",
  family: "core",
  coverage: COVERAGE.core,
  fullMobileSweep: true,
});
for (const network of ["testnet", "testnet4", "signet", "regtest"]) {
  addRoute({ id: network, pattern: `/${network}`, family: "network" });
}
for (const [network, walletPath, miningAlias] of [
  ["testnet", "widget/wallet", false],
  ["testnet4", "wallet", false],
  ["signet", "widget/wallet", true],
  ["regtest", "widget/wallet", true],
]) {
  addRoute({
    id: `${network}-wallet`,
    pattern: `/${network}/${walletPath}`,
    family: "network",
  });
  addRoute({
    id: `${network}-status`,
    pattern: `/${network}/status`,
    family: "network",
  });
  if (miningAlias) {
    addRoute({
      id: `${network}-mining-blocks-alias`,
      pattern: `/${network}/mining/blocks`,
      family: "network",
      coverage: COVERAGE.redirect,
      redirectTo: `/${network}/blocks`,
    });
  }
}
addRoute({
  id: "mining-blocks-alias",
  pattern: "/mining/blocks",
  family: "core",
  coverage: COVERAGE.redirect,
  redirectTo: "/blocks",
});
addRoute({
  id: "tx-push",
  pattern: "/tx/push",
  family: "core",
  coverage: COVERAGE.form,
});
addRoute({
  id: "pushtx",
  pattern: "/pushtx",
  family: "core",
  coverage: COVERAGE.alias,
});
addRoute({
  id: "tx-test",
  pattern: "/tx/test",
  family: "core",
  coverage: COVERAGE.form,
});
addRoute({ id: "blocks-stale", pattern: "/blocks/stale", family: "core" });
addRoute({
  id: "blocks-page",
  pattern: "/blocks/:page",
  family: "core",
  params: { page: value("1", "page") },
});
addRoute({
  id: "blocks",
  pattern: "/blocks",
  family: "core",
  coverage: COVERAGE.core,
  fullMobileSweep: true,
  redirectTo: "/blocks/1",
});
addRoute({
  id: "rbf",
  pattern: "/rbf",
  family: "core",
  coverage: COVERAGE.product,
});
addRoute({
  id: "stratum",
  pattern: "/stratum",
  family: "core",
  coverage: COVERAGE.conditional,
});
addRoute({
  id: "terms-of-service",
  pattern: "/terms-of-service",
  family: "core",
});
addRoute({ id: "privacy-policy", pattern: "/privacy-policy", family: "core" });
addRoute({
  id: "tx-root",
  pattern: "/tx",
  family: "core",
  coverage: COVERAGE.redirect,
  redirectTo: "/",
});
addRoute({
  id: "tx",
  pattern: "/tx/:id",
  family: "core",
  params: { id: TXID },
  coverage: COVERAGE.core,
  fullMobileSweep: true,
});
addRoute({
  id: "tx-preview",
  pattern: "/tx/preview",
  family: "core",
  coverage: COVERAGE.form,
});
addRoute({
  id: "block-root",
  pattern: "/block",
  family: "core",
  coverage: COVERAGE.redirect,
  redirectTo: "/",
});
addRoute({
  id: "block",
  pattern: "/block/:id",
  family: "core",
  params: { id: BLOCK },
  coverage: COVERAGE.detail,
  fullMobileSweep: true,
});
addRoute({
  id: "mempool-block",
  pattern: "/mempool-block/:id",
  family: "core",
  params: { id: value("0", "mempool-block") },
  coverage: COVERAGE.detail,
});
addRoute({
  id: "address",
  pattern: "/address/:id",
  family: "core",
  params: { id: ADDRESS },
  coverage: COVERAGE.core,
  fullMobileSweep: true,
});
addRoute({
  id: "wallet",
  pattern: "/wallet/:wallet",
  family: "core",
  params: { wallet: value("qa-wallet", "wallet") },
});
addRoute({
  id: "mining",
  pattern: "/mining",
  family: "core",
  coverage: COVERAGE.core,
});
addRoute({
  id: "graphs",
  pattern: "/graphs/mempool",
  family: "core",
  coverage: COVERAGE.core,
  fullMobileSweep: true,
});
addRoute({
  id: "docs-root",
  pattern: "/docs",
  family: "core",
  coverage: COVERAGE.redirect,
  redirectTo: "/docs/faq",
});
addRoute({
  id: "docs-api-root",
  pattern: "/docs/api",
  family: "core",
  coverage: COVERAGE.redirect,
  redirectTo: "/docs/api/rest",
});
addRoute({
  id: "docs",
  pattern: "/docs/api/:type",
  family: "core",
  params: { type: value("rest", "docs-type") },
  coverage: COVERAGE.core,
  fullMobileSweep: true,
});
addRoute({ id: "docs-faq", pattern: "/docs/faq", family: "core" });
addRoute({
  id: "api",
  pattern: "/api",
  family: "core",
  coverage: COVERAGE.redirect,
  redirectTo: "/api/faq",
});
addRoute({ id: "status", pattern: "/status", family: "core" });
addRoute({ id: "widget-wallet", pattern: "/widget/wallet", family: "embed" });
addRoute({
  id: "preview-root",
  pattern: "/preview",
  family: "preview",
  coverage: COVERAGE.mount,
});
for (const network of ["testnet", "testnet4", "signet", "regtest"]) {
  addRoute({
    id: `preview-${network}`,
    pattern: `/preview/${network}`,
    family: "preview",
    coverage: COVERAGE.mount,
  });
}
addRoute({
  id: "preview-block",
  pattern: "/preview/block/:id",
  family: "preview",
  params: { id: BLOCK },
});
addRoute({
  id: "preview-address",
  pattern: "/preview/address/:id",
  family: "preview",
  params: { id: ADDRESS },
});
addRoute({
  id: "preview-wallet",
  pattern: "/preview/wallet/:wallet",
  family: "preview",
  params: { wallet: value("qa-wallet", "preview-wallet") },
});
addRoute({
  id: "preview-tx",
  pattern: "/preview/tx/:id",
  family: "preview",
  params: { id: TXID },
});
addRoute({
  id: "preview-mining-pool",
  pattern: "/preview/mining/pool/:slug",
  family: "preview",
  params: { slug: value("foundry-usa", "preview-pool") },
});
addRoute({
  id: "preview-lightning",
  pattern: "/preview/lightning",
  family: "preview",
  coverage: COVERAGE.mount,
});
addRoute({
  id: "preview-lightning-node",
  pattern: "/preview/lightning/node/:public_key",
  family: "preview",
  params: {
    public_key: value(`02${"1".repeat(64)}`, "preview-lightning-node"),
  },
});
addRoute({
  id: "preview-lightning-channel",
  pattern: "/preview/lightning/channel/:short_id",
  family: "preview",
  params: { short_id: value("800000x1x0", "preview-lightning-channel") },
});
addRoute({
  id: "preview-lightning-isp",
  pattern: "/preview/lightning/nodes/isp/:isp",
  family: "preview",
  params: { isp: value("12345", "preview-lightning-isp") },
});
addRoute({
  id: "clock-root",
  pattern: "/clock",
  family: "embed",
  coverage: COVERAGE.redirect,
  redirectTo: "/clock/mempool/0",
});
addRoute({
  id: "clock-mode",
  pattern: "/clock/:mode",
  family: "embed",
  params: { mode: value("mempool", "clock-mode") },
  coverage: COVERAGE.redirect,
  redirectTo: "/clock/mempool/0",
});
addRoute({
  id: "clock",
  pattern: "/clock/:mode/:index",
  family: "embed",
  params: {
    mode: value("mempool", "clock-mode"),
    index: value("0", "clock-index"),
  },
});
addRoute({
  id: "view-block",
  pattern: "/view/block/:id",
  family: "embed",
  params: { id: BLOCK },
});
addRoute({
  id: "view-mempool-block",
  pattern: "/view/mempool-block/:index",
  family: "embed",
  params: { index: value("0", "view-mempool-index") },
});
addRoute({ id: "view-blocks", pattern: "/view/blocks", family: "embed" });
addRoute({ id: "lightning", pattern: "/lightning", family: "lightning" });
addRoute({
  id: "protocols",
  pattern: "/protocols",
  family: "protocols",
  coverage: COVERAGE.core,
  fullMobileSweep: true,
});
addRoute({
  id: "anima-protocol",
  pattern: "/protocols/:id",
  family: "protocols",
  params: { id: value("anima", "protocol") },
});

// Core graph, mining, acceleration, and Lightning children.
addRoute({
  id: "mining-pool",
  pattern: "/mining/pool/:slug",
  family: "mining",
  params: { slug: value("foundry-usa", "pool") },
});
addRoute({
  id: "acceleration",
  pattern: "/acceleration",
  family: "acceleration",
});
addRoute({
  id: "acceleration-list",
  pattern: "/acceleration/list",
  family: "acceleration",
  coverage: COVERAGE.redirect,
  redirectTo: "/acceleration/list/1",
});
addRoute({
  id: "acceleration-list-page",
  pattern: "/acceleration/list/:page",
  family: "acceleration",
  params: { page: value("1", "acceleration-page") },
});
addRoute({
  id: "graphs-root",
  pattern: "/graphs",
  family: "graphs",
  coverage: COVERAGE.redirect,
  redirectTo: "/graphs/mempool",
});
for (const child of [
  "mining/hashrate-difficulty",
  "mining/pools-dominance",
  "mining/pools",
  "mining/block-fees",
  "mining/block-fees-subsidy",
  "mining/block-rewards",
  "mining/block-fee-rates",
  "mining/block-sizes-weights",
  "acceleration/fees",
  "mining/block-health",
  "price",
]) {
  addRoute({
    id: `graphs-${child.replaceAll("/", "-")}`,
    pattern: `/graphs/${child}`,
    family: "graphs",
  });
}
addRoute({
  id: "graphs-lightning",
  pattern: "/graphs/lightning",
  family: "lightning",
  coverage: COVERAGE.mount,
});
for (const child of [
  "nodes-networks",
  "capacity",
  "nodes-per-isp",
  "nodes-per-country",
  "nodes-map",
  "nodes-channels-map",
]) {
  addRoute({
    id: `graphs-lightning-${child}`,
    pattern: `/graphs/lightning/${child}`,
    family: "lightning",
  });
}
addRoute({
  id: "treasuries",
  pattern: "/treasuries",
  family: "conditional",
  coverage: COVERAGE.conditional,
});
addRoute({
  id: "lightning-node",
  pattern: "/lightning/node/:public_key",
  family: "lightning",
  params: { public_key: value(`02${"1".repeat(64)}`, "lightning-node") },
});
addRoute({
  id: "lightning-channel",
  pattern: "/lightning/channel/:short_id",
  family: "lightning",
  params: { short_id: value("800000x1x0", "lightning-channel") },
});
addRoute({
  id: "lightning-country",
  pattern: "/lightning/nodes/country/:country",
  family: "lightning",
  params: { country: value("US", "country") },
});
addRoute({
  id: "lightning-isp",
  pattern: "/lightning/nodes/isp/:isp",
  family: "lightning",
  params: { isp: value("12345", "isp") },
});
for (const child of [
  "nodes/rankings",
  "nodes/rankings/liquidity",
  "nodes/rankings/connectivity",
  "nodes/oldest",
  "penalties",
]) {
  addRoute({
    id: `lightning-${child.replaceAll("/", "-")}`,
    pattern: `/lightning/${child}`,
    family: "lightning",
  });
}

// Universe release families mounted directly by the master router.
addRoute({
  id: "anima-root",
  pattern: "/anima",
  family: "anima",
  coverage: COVERAGE.redirect,
  redirectTo: "/anima/transitions",
});
addRoute({
  id: "wildkin",
  pattern: "/wildkin",
  family: "wildkin",
  coverage: COVERAGE.product,
});
addRoute({
  id: "wildkin-creatures",
  pattern: "/wildkin/creatures",
  family: "wildkin",
});
addRoute({
  id: "wildkin-creature",
  pattern: "/wildkin/creature/:id",
  family: "wildkin",
  params: { id: value("creature-001", "creature") },
});
addRoute({
  id: "wildkin-bloodlines",
  pattern: "/wildkin/bloodlines",
  family: "wildkin",
});
addRoute({
  id: "fractal",
  pattern: "/fractal",
  family: "fractal",
  coverage: COVERAGE.product,
});
addRoute({ id: "fractal-cat20", pattern: "/fractal/cat20", family: "fractal" });
addRoute({
  id: "fractal-cat20-token",
  pattern: "/fractal/cat20/token/:tokenId",
  family: "fractal",
  params: { tokenId: value("cat20-001", "cat20-token") },
});
addRoute({
  id: "zcash-privacy",
  pattern: "/zcash/privacy",
  family: "zcash-privacy",
  coverage: COVERAGE.product,
});
addRoute({
  id: "zcash-privacy-workspace",
  pattern: "/zcash/privacy/workspace",
  family: "zcash-privacy",
  coverage: COVERAGE.form,
});
addRoute({
  id: "liquid-observatory",
  pattern: "/liquid/observatory",
  family: "liquid",
  coverage: COVERAGE.product,
});
addRoute({
  id: "liquid-unblind",
  pattern: "/liquid/unblind",
  family: "liquid",
  coverage: COVERAGE.form,
});
addRoute({
  id: "data",
  pattern: "/data",
  family: "data",
  coverage: COVERAGE.product,
});
addRoute({ id: "data-live", pattern: "/data/live", family: "data" });
addRoute({
  id: "network-propagation",
  pattern: "/network/propagation",
  family: "network",
});
addRoute({
  id: "network-policy",
  pattern: "/network/policy",
  family: "network",
});
addRoute({ id: "network-nodes", pattern: "/network/nodes", family: "network" });
addRoute({
  id: "network-templates",
  pattern: "/network/templates",
  family: "network",
});
addRoute({
  id: "taproot-assets",
  pattern: "/taproot-assets",
  family: "taproot-assets",
  coverage: COVERAGE.product,
});
addRoute({
  id: "taproot-asset",
  pattern: "/taproot-assets/asset/:assetId",
  family: "taproot-assets",
  params: { assetId: value("tapasset-001", "taproot-asset") },
});
addRoute({
  id: "lightning-offers",
  pattern: "/lightning/offers",
  family: "lightning-standards",
  coverage: COVERAGE.product,
});
addRoute({
  id: "lightning-rfq",
  pattern: "/lightning/rfq",
  family: "lightning-standards",
});
addRoute({
  id: "ark",
  pattern: "/ark",
  family: "ark",
  coverage: COVERAGE.product,
});
addRoute({
  id: "rgb",
  pattern: "/rgb",
  family: "rgb",
  coverage: COVERAGE.local,
});
addRoute({
  id: "rgb-validate",
  pattern: "/rgb/validate",
  family: "rgb",
  coverage: COVERAGE.form,
});
addRoute({
  id: "stratum-v2",
  pattern: "/mining/stratum-v2",
  family: "stratum-v2",
  coverage: COVERAGE.product,
});
addRoute({
  id: "script",
  pattern: "/tools/script",
  family: "script",
  coverage: COVERAGE.local,
});
addRoute({
  id: "miniscript",
  pattern: "/tools/miniscript",
  family: "script",
  coverage: COVERAGE.form,
});
addRoute({
  id: "descriptor",
  pattern: "/tools/descriptor",
  family: "script",
  coverage: COVERAGE.form,
});
addRoute({
  id: "taproot",
  pattern: "/tools/taproot",
  family: "script",
  coverage: COVERAGE.form,
});
addRoute({
  id: "l2",
  pattern: "/l2",
  family: "layer-2",
  coverage: COVERAGE.product,
});
addRoute({
  id: "l2-system",
  pattern: "/l2/:systemId",
  family: "layer-2",
  params: { systemId: value("lightning", "l2-system") },
});
addRoute({
  id: "payment",
  pattern: "/tools/payment",
  family: "payment",
  coverage: COVERAGE.local,
});
addRoute({
  id: "bip21",
  pattern: "/tools/payment/bip21",
  family: "payment",
  coverage: COVERAGE.form,
});
addRoute({
  id: "bip353",
  pattern: "/tools/payment/bip353",
  family: "payment",
  coverage: COVERAGE.form,
});
addRoute({
  id: "utxo-set",
  pattern: "/utxo-set",
  family: "utxo",
  coverage: COVERAGE.product,
});
addRoute({ id: "utreexo", pattern: "/utreexo", family: "utxo" });
addRoute({
  id: "source",
  pattern: "/source",
  family: "core",
  coverage: COVERAGE.core,
});
addRoute({
  id: "outpoint",
  pattern: "/outpoint/:txid/:vout",
  family: "assets",
  params: {
    txid: value(assetSampleIds.OUTPOINT_TXID, "outpoint-txid"),
    vout: value("1", "vout"),
  },
  coverage: COVERAGE.detail,
});
addRoute({
  id: "provenance-graph",
  pattern: "/graph/tx/:txid",
  family: "graph",
  params: { txid: TXID },
});
addRoute({
  id: "pulse",
  pattern: "/pulse",
  family: "core",
  coverage: COVERAGE.product,
});
addRoute({ id: "live", pattern: "/live", family: "live" });
addRoute({ id: "mining-lab", pattern: "/labs/mining", family: "mining-lab" });
addRoute({
  id: "mining-lab-bitcoin",
  pattern: "/labs/mining/bitcoin",
  family: "mining-lab",
});
addRoute({
  id: "mining-lab-dogecoin",
  pattern: "/labs/mining/dogecoin",
  family: "mining-lab",
});
addRoute({
  id: "mining-lab-reorgs",
  pattern: "/labs/mining/reorgs",
  family: "mining-lab",
});
addRoute({
  id: "mempool-clusters",
  pattern: "/mempool/clusters",
  family: "mempool-intelligence",
});
addRoute({
  id: "mempool-cluster",
  pattern: "/mempool/clusters/:clusterId",
  family: "mempool-intelligence",
  params: { clusterId: value("cluster-001", "cluster") },
});
addRoute({
  id: "mempool-packages",
  pattern: "/mempool/packages",
  family: "mempool-intelligence",
});
addRoute({
  id: "feerate-diagram",
  pattern: "/mempool/feerate-diagram",
  family: "mempool-intelligence",
});
addRoute({
  id: "tx-bump",
  pattern: "/tx/:txid/bump",
  family: "mempool-intelligence",
  params: { txid: TXID },
});
addRoute({
  id: "tx-package",
  pattern: "/tx/:txid/package",
  family: "mempool-intelligence",
  params: { txid: TXID },
});
addRoute({
  id: "saved",
  pattern: "/saved",
  family: "local",
  coverage: COVERAGE.local,
});
addRoute({
  id: "offline",
  pattern: "/offline",
  family: "pwa",
  coverage: COVERAGE.local,
});
addRoute({
  id: "share",
  pattern: "/share",
  family: "pwa",
  coverage: COVERAGE.local,
});
addRoute({
  id: "portfolio-root",
  pattern: "/portfolio",
  family: "portfolio",
  coverage: COVERAGE.local,
});
addRoute({
  id: "inscription",
  pattern: "/inscription/:reference",
  family: "assets",
  params: { reference: value(assetSampleIds.INSCRIPTION_ID, "inscription") },
  coverage: COVERAGE.detail,
});
addRoute({
  id: "rune",
  pattern: "/rune/:reference",
  family: "assets",
  params: { reference: value(assetSampleIds.RUNE_NAME, "rune") },
  coverage: COVERAGE.detail,
});
addRoute({
  id: "sat",
  pattern: "/sat/:reference",
  family: "assets",
  params: { reference: value(assetSampleIds.SAT_NUMBER, "sat") },
  coverage: COVERAGE.detail,
});
addRoute({
  id: "calculator",
  pattern: "/tools/calculator",
  family: "tools",
  coverage: COVERAGE.form,
});
addRoute({ id: "node", pattern: "/node", family: "node" });
addRoute({
  id: "node-rpc",
  pattern: "/node/rpc",
  family: "node",
  coverage: COVERAGE.form,
});
addRoute({
  id: "privacy-lab",
  pattern: "/labs/privacy",
  family: "privacy",
  coverage: COVERAGE.form,
});
addRoute({
  id: "privacy-lab-tx",
  pattern: "/labs/privacy/:txid",
  family: "privacy",
  params: { txid: TXID },
  coverage: COVERAGE.form,
});
addRoute({
  id: "package-simulator",
  pattern: "/tools/package",
  family: "mempool-intelligence",
  coverage: COVERAGE.form,
});
addRoute({
  id: "psbt",
  pattern: "/tools/psbt",
  family: "tools",
  coverage: COVERAGE.form,
});
addRoute({
  id: "transaction-tool-alias",
  pattern: "/tools/transaction",
  family: "tools",
  coverage: COVERAGE.redirect,
  redirectTo: "/tx/preview",
});

for (const [id, pattern] of [
  ["monitoring", "/monitoring"],
  ["nodes", "/nodes"],
  ["faucet", "/faucet"],
  ["simpleproof", "/sp/verified"],
  ["simpleproof-cubo", "/sp/cubo"],
]) {
  addRoute({
    id,
    pattern,
    family: "conditional",
    coverage: COVERAGE.conditional,
  });
}

// Every Portfolio class, including redirect and local account children.
for (const [id, path, coverage] of [
  ["portfolio-new", "new", COVERAGE.form],
  ["portfolio-manage", "manage", COVERAGE.local],
  ["portfolio-settings", "settings", COVERAGE.local],
  ["portfolio-workspace", "workspace", COVERAGE.local],
]) {
  addRoute({
    id,
    pattern: `/portfolio/${path}`,
    family: "portfolio",
    coverage,
  });
}
const portfolioId = value(QA_PORTFOLIO_ID, "portfolio");
addRoute({
  id: "portfolio-project",
  pattern: "/portfolio/p/:portfolioId",
  family: "portfolio",
  params: { portfolioId },
  coverage: COVERAGE.localAccount,
  invalidCoverage: COVERAGE.invalidLocalAccount,
  redirectTo: `/portfolio/p/${QA_PORTFOLIO_ID}/overview`,
  requiresPortfolioVault: true,
});
for (const section of [
  "overview",
  "holdings",
  "activity",
  "performance",
  "time-machine",
  "utxos",
  "insights",
  "sources",
  "reports",
]) {
  addRoute({
    id: `portfolio-${section}`,
    pattern: `/portfolio/p/:portfolioId/${section}`,
    family: "portfolio",
    params: { portfolioId },
    coverage: COVERAGE.localAccount,
    invalidCoverage: COVERAGE.invalidLocalAccount,
    fullMobileSweep: section === "overview" || section === "holdings",
    requiresPortfolioVault: true,
  });
}
addRoute({
  id: "portfolio-share",
  pattern: "/portfolio/share/:shareId",
  family: "portfolio",
  params: { shareId: value("qa-share-001", "share") },
});
addRoute({
  id: "portfolio-address",
  pattern: "/portfolio/:chain/:network/:address",
  family: "portfolio",
  params: {
    chain: value("bitcoin", "portfolio-chain"),
    network: value("mainnet", "portfolio-network"),
    address: ADDRESS,
  },
});

// Every ANIMA class and its deterministic evidence identifiers.
addRoute({
  id: "anima-transitions",
  pattern: "/anima/transitions",
  family: "anima",
  coverage: COVERAGE.product,
});
addRoute({
  id: "anima-events",
  pattern: "/anima/events",
  family: "anima",
  coverage: COVERAGE.product,
});
addRoute({
  id: "anima-event",
  pattern: "/anima/event/:eventId",
  family: "anima",
  params: { eventId: value("a907098:0", "anima-event") },
  coverage: COVERAGE.detail,
});
addRoute({
  id: "anima-items",
  pattern: "/anima/items",
  family: "anima",
  coverage: COVERAGE.product,
});
addRoute({
  id: "anima-item",
  pattern: "/anima/item/:itemId",
  family: "anima",
  params: { itemId: value("0aff", "anima-item") },
  coverage: COVERAGE.detail,
});
addRoute({
  id: "anima-item-history",
  pattern: "/anima/item/:itemId/history",
  family: "anima",
  params: { itemId: value("0aff", "anima-item") },
  coverage: COVERAGE.detail,
});

const CHART_PATHS = [
  ["mempool", "graphs"],
  ["mining/hashrate-difficulty", "graphs-hashrate"],
  ["mining/pools-dominance", "graphs-pools-dominance"],
  ["mining/pools", "graphs-pools"],
  ["mining/block-fees", "graphs-block-fees"],
  ["mining/block-fees-subsidy", "graphs-block-fees-subsidy"],
  ["mining/block-rewards", "graphs-block-rewards"],
  ["mining/block-fee-rates", "graphs-block-fee-rates"],
  ["mining/block-sizes", "graphs-block-sizes"],
  ["mining/block-interval", "graphs-block-interval"],
];

function addChain(chain) {
  const isDoge = chain === "dogecoin";
  const txid = value(
    isDoge ? chainSampleIds.DOGE_TXID : chainSampleIds.ZEC_TXID,
    `${chain}-txid`,
  );
  const block = value(
    isDoge ? chainSampleIds.DOGE_BLOCK : chainSampleIds.ZEC_BLOCK,
    `${chain}-block`,
  );
  const address = value(
    isDoge ? chainSampleIds.DOGE_ADDRESS : chainSampleIds.ZEC_ADDRESS,
    `${chain}-address`,
  );
  const protocol = value(isDoge ? "drc20" : "zrc20", `${chain}-protocol`);
  const reference = value(
    isDoge ? chainSampleIds.DOGE_DUNE_ID : chainSampleIds.ZEC_ZRC20,
    `${chain}-protocol-reference`,
  );

  addRoute({
    id: chain,
    pattern: `/${chain}`,
    family: chain,
    coverage: COVERAGE.core,
    fullMobileSweep: true,
    expect: "chain",
    timeline: true,
  });
  addRoute({
    id: `${chain}-mining`,
    pattern: `/${chain}/mining`,
    family: chain,
    coverage: COVERAGE.product,
    expect: "chain",
    timeline: true,
    fullMobileSweep: !isDoge,
  });
  addRoute({
    id: `${chain}-graphs-root`,
    pattern: `/${chain}/graphs`,
    family: chain,
    coverage: COVERAGE.redirect,
    redirectTo: `/${chain}/graphs/mempool`,
  });
  for (const [child, suffix] of CHART_PATHS) {
    const id = `${chain}-${suffix}`;
    addRoute({
      id,
      pattern: `/${chain}/graphs/${child}`,
      family: chain,
      coverage: COVERAGE.product,
      expect: "charts",
      fullMobileSweep: isDoge && child === "mempool",
    });
  }
  addRoute({
    id: `${chain}-docs`,
    pattern: `/${chain}/docs`,
    family: chain,
    coverage: COVERAGE.product,
    expect: "docs",
    fullMobileSweep: !isDoge,
  });
  addRoute({
    id: `${chain}-docs-section`,
    pattern: `/${chain}/docs/:section`,
    family: chain,
    params: { section: value("api", `${chain}-docs-section`) },
    coverage: COVERAGE.product,
    expect: "docs",
  });
  addRoute({
    id: `${chain}-mempool`,
    pattern: `/${chain}/mempool`,
    family: chain,
    coverage: COVERAGE.product,
  });
  addRoute({
    id: `${chain}-block`,
    pattern: `/${chain}/block/:reference`,
    family: chain,
    params: { reference: block },
    coverage: COVERAGE.detail,
    fullMobileSweep: !isDoge,
  });
  addRoute({
    id: `${chain}-tx`,
    pattern: `/${chain}/tx/:txid`,
    family: chain,
    params: { txid },
    coverage: COVERAGE.detail,
    fullMobileSweep: isDoge,
  });
  addRoute({
    id: `${chain}-address`,
    pattern: `/${chain}/address/:reference`,
    family: chain,
    params: { reference: address },
    coverage: COVERAGE.detail,
  });
  addRoute({
    id: `${chain}-outpoint`,
    pattern: `/${chain}/outpoint/:txid/:vout`,
    family: chain,
    params: { txid, vout: value("0", `${chain}-vout`) },
  });
  addRoute({
    id: `${chain}-protocols`,
    pattern: `/${chain}/protocols`,
    family: chain,
    coverage: COVERAGE.product,
  });
  addRoute({
    id: `${chain}-${isDoge ? "drc20" : "zrc20"}`,
    pattern: `/${chain}/protocols/:protocol`,
    family: chain,
    params: { protocol },
    coverage: COVERAGE.detail,
  });
  addRoute({
    id: `${chain}-${isDoge ? "dune" : "zrc20-token"}`,
    pattern: `/${chain}/protocols/:protocol/:reference`,
    family: chain,
    params: {
      protocol: value(isDoge ? "dunes" : "zrc20", `${chain}-detail-protocol`),
      reference,
    },
    coverage: COVERAGE.detail,
  });
  addRoute({
    id: `${chain}-protocol-holders`,
    pattern: `/${chain}/protocols/:protocol/:reference/holders`,
    family: chain,
    params: { protocol, reference },
  });
  addRoute({
    id: `${chain}-protocol-events`,
    pattern: `/${chain}/protocols/:protocol/:reference/events`,
    family: chain,
    params: { protocol, reference },
  });
}

addChain("dogecoin");
addChain("zcash");

// Extra Dogecoin list example because DRC-20 and Dunes are separate products
// mounted by the same Angular parameter class.
scenarios.push(
  Object.freeze({
    ...scenarios.find((scenario) => scenario.id === "dogecoin-drc20"),
    id: "dogecoin-dunes",
    path: "/dogecoin/protocols/dunes",
    name: "Dogecoin Dunes",
  }),
);

// The menu-open scenario is a state of the homepage, not another route class.
scenarios.push(
  Object.freeze({
    ...scenarios.find((scenario) => scenario.id === "home"),
    id: "chain-menu",
    name: "Chain switcher, open",
    coverage: COVERAGE.visualState,
    open: ".chain-toggle",
    overlayObscures: true,
    fullMobileSweep: true,
  }),
);

export const PRODUCTION_ROUTE_CLASSES = Object.freeze(routeClasses);
export const PRODUCTION_ROUTE_SCENARIOS = Object.freeze(scenarios);

export function routesFor(testClass) {
  if (!QA_TEST_CLASSES.includes(testClass))
    throw new Error(`unknown QA test class: ${testClass}`);
  return PRODUCTION_ROUTE_SCENARIOS.filter(
    (scenario) => scenario.coverage[testClass] === true,
  );
}

export function routePatternMatches(pattern, target) {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/:[A-Za-z][A-Za-z0-9_]*/g, "[^/]+");
  return new RegExp(`^${escaped}/?$`).test(target);
}
