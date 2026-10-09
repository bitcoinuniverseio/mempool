import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { clockSnapshotPath } from "./clock-history-semantic-review.mjs";

const prefix = "docs/acceptance/source-proof/mempool-fee-reviewed-2026-10-09/";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const lf = (bytes) =>
  Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n"));

/** Reviewed code/data flow only. Legacy execution assertions stay in their
 * original records; neither these definitions nor source tests are receipts.
 */
export function feeSemanticReview(historical, common, readProof) {
  const bindings = [];
  const paths = [
    "backend/src/api/fee-api.ts",
    "backend/src/api/bitcoin/bitcoin.routes.ts",
    "backend/src/api/websocket-handler.ts",
    "backend/src/api/bitcoin/bitcoin-source-observation.ts",
    "frontend/src/app/services/fee-estimate.ts",
    "frontend/src/app/services/state.service.ts",
    "frontend/src/app/services/websocket.service.ts",
    "frontend/src/app/components/fees-box/fees-box.component.ts",
    "frontend/src/app/components/fees-box/fees-box.component.html",
    "frontend/src/app/components/clock/clock.component.ts",
    "frontend/src/app/components/clock/clock.component.html",
  ];
  const allProof = paths.map((path) => {
    const snapshotPath = clockSnapshotPath(path, prefix + path);
    const sha256 = hash(lf(readProof(path)));
    assert.equal(
      hash(readProof(snapshotPath)),
      sha256,
      `Current fee source proof drift: ${path}`,
    );
    bindings.push({
      path,
      snapshotPath,
      sha256,
      encoding: "UTF-8 LF-normalized source, frozen snapshot bytes",
    });
    return { path: snapshotPath, sha256 };
  });
  const producerProof = allProof.filter((ref) =>
    ref.path.includes("/backend/"),
  );
  const clientProof = allProof.filter((ref) => ref.path.includes("/frontend/"));
  const definitions = [
    {
      id: "reviewed:signet-fees-rounded-rest",
      method: "GET",
      entryPoint: "/signet/api/v1/fees/recommended",
      inputContract:
        "No query/body; effective backend Bitcoin Signet profile; public read",
      outputContract:
        "Legacy five numeric sat/vB recommendations from cached rounded producer observation; HTTP503 when syncing, stale, unavailable or checkpoint-unverified; no versioned freshness in this legacy body alone",
      lifecycle:
        "Read cached producer observation only, never create a poll or refresh its timestamp; require complete shared poll/Core checkpoint agreement within120s",
      inputs: [
        "Ready owned Signet producer",
        "Unsynced/expired/missing/checkpoint-mismatched observation",
      ],
      execution: [
        "Call exact legacy route/handler",
        "Correlate rounded values with same-context versioned producer observation and503 transitions",
      ],
      assertions: [
        "getRecommendedFees uses getObservedRecommendedFee(false)",
        "Neither reader nor new block alone renews mempool observation",
        "No503 is converted to zero or current cached values",
      ],
      sources: producerProof,
    },
    {
      id: "reviewed:signet-fees-precise-rest",
      method: "GET",
      entryPoint: "/signet/api/v1/fees/precise",
      inputContract:
        "No query/body; effective backend Bitcoin Signet profile; public read",
      outputContract:
        "Same five sat/vB fields using fractional producer values rounded to0.001sat/vB; highest priority policy floors/offsets retained; HTTP503 unless observation ready",
      lifecycle:
        "Read the same dated shared producer observation as rounded REST, preserving fractional precision and availability independently of display rounding",
      inputs: [
        "Fractional fee values",
        "Same ready/unavailable/stale/checkpoint cases as rounded route",
      ],
      execution: [
        "Call getPreciseRecommendedFees",
        "Compare precise/rounded routes against one observation without treating numeric legacy bodies as standalone readiness",
      ],
      assertions: [
        "Handler uses getObservedRecommendedFee(true)",
        "Lower-priority fractional fees are not silently integer-rounded",
        "Both REST paths fail closed with shared producer state",
      ],
      sources: producerProof,
    },
    {
      id: "reviewed:signet-fee-bootstrap",
      method: "GET",
      entryPoint: "/signet/api/v1/init-data",
      inputContract:
        "Selected Signet bootstrap request captured by the owning HTTP/socket context generation",
      outputContract:
        "Serialized init data with refreshed universe-fee-estimate-v1 observation and nullable legacy fees, plus useful blocks and independently dated liveObservation; unavailable fees do not fail the whole bootstrap",
      lifecycle:
        "Refresh cached fee validity at serialization, not producer poll time; client scope validation before all state writes, closure ignores replacement contexts",
      inputs: [
        "Cached bootstrap after producer loses readiness",
        "Correctly scoped HTTP body with wrong explicit network/Core claim",
        "Late old-context bootstrap",
      ],
      execution: [
        "Serialize via getSerializedInitData after refreshFeeState",
        "Validate frame scope before installing bootstrap state",
      ],
      assertions: [
        "Read does not manufacture observedAt",
        "Useful block data can remain without fee currentness",
        "Late or explicit foreign context cannot install current fee state",
      ],
      sources: allProof,
    },
    {
      id: "reviewed:signet-fee-websocket",
      method: "WS",
      entryPoint: "/signet/api/v1/ws#feeEstimate",
      inputContract:
        "Existing shared producer complete/unchanged poll or block projection and scoped base websocket frame; universe-fee-estimate-v1 metadata",
      outputContract:
        "Fee values/currentness only from schema/network/timestamp/tip-validated fee observation; chain-data liveObservation remains separately validated; legacy raw fees do not substitute for missing feeEstimate",
      lifecycle:
        "Shared poll publication, bootstrap and updates, socket generation changes and independent observation expiry; block-only projection retains original poll age",
      inputs: [
        "Ready fee observation",
        "Wrong network/invalid/future/expired observation",
        "Legacy fees frame without fee metadata",
      ],
      execution: [
        "Publish through shared handleMempoolObservation/refreshFeeState",
        "Pass whole-frame scope ingress then FeeEstimateState decoding",
      ],
      assertions: [
        "One producer/shared state, no widget poll",
        "Incoming fee metadata cannot inherit prior ready state after invalid proof",
        "Chain freshness does not itself renew fee source age",
      ],
      sources: allProof,
    },
    {
      id: "reviewed:signet-fees-box-view",
      method: "UI",
      entryPoint: "/signet#fees-box",
      inputContract:
        "StateService feeEstimate$ shared snapshot and theme/unit state; no private fee RPC",
      outputContract:
        "Current ready fee display, or explicit stale/syncing/unavailable label and dated historical values when retained; per-display fee-rate/fiat formatting is separate from source precision",
      lifecycle:
        "Subscribe existing shared snapshot, theme gradient changes, source expiry/disconnect and bounded retry; Clock consumes the same state",
      inputs: [
        "Ready shared values",
        "Stale historical values",
        "Unavailable/syncing null values",
        "Retry while not syncing",
      ],
      execution: [
        "Render FeesBox status/age alongside values",
        "Use existing websocket reconnect retry and compare Clock state",
      ],
      assertions: [
        "Stale values are labeled historical, not current",
        "Null values produce loading/unavailable UI and no invented zero",
        "Display rounding/fiat/node/network variants still need required functional checks",
      ],
      sources: clientProof,
    },
    {
      id: "reviewed:signet-fee-network-recovery",
      method: "UI",
      entryPoint:
        "StateService.networkChanged$ / WebsocketService.reconnectWebsocket",
      inputContract:
        "Selected network change, connectionState transition, observation replay and explicit retry",
      outputContract:
        "Fee state reset on network change, bounded syncing->unavailable/stale at5s recovery or120s source age, onlyready snapshots feed legacy recommendedFees$",
      lifecycle:
        "A-B-A switching, disconnect/reconnect and timer ownership; reject pre-retry or non-monotonic ready observations, preserve original source age, require a newer valid observation for recovery",
      inputs: [
        "Signet->other network->Signet",
        "Disconnect and retry",
        "Old/replayed/wrong-network observations",
        "New valid owned observation",
      ],
      execution: [
        "Reset shared FeeEstimateState and socket generation",
        "Expire bounded recovery timer",
        "Accept only subsequent valid same-context observation",
      ],
      assertions: [
        "No prior-network values after reset",
        "Retry cannot relabel cached replay fresh",
        "Legacy recommendedFees$ receives null outside ready",
        "All actual switch/consumer/phone/desktop variants remain required",
      ],
      sources: clientProof,
    },
  ].map((definition) => ({
    ...common,
    ...definition,
    expectedResult:
      "Exact reviewed selected-context source behavior; original required consumer/context/lifecycle obligations and functional receipts remain unresolved",
  }));
  const candidates = definitions.map((operation) => ({
    id: "current:" + operation.id.slice(9) + "-20261009",
    reason:
      "Current repaired fee producer/shared state/consumer contract is separately reviewed; not a filename occurrence or historical PASS",
    sources: operation.sources,
  }));
  const mappings = candidates.map((candidate, index) => ({
    candidateId: candidate.id,
    operationIds: [definitions[index].id],
    reason:
      "Exact code path and typed data flow establish this definition; source presence/tests do not qualify functionality",
    sources: candidate.sources,
  }));
  const legacyRoutes = [
    ["/api/v1/fees/recommended", "this.getRecommendedFees", definitions[0].id],
    [
      "/api/v1/fees/precise",
      "this.getPreciseRecommendedFees",
      definitions[1].id,
    ],
    ["/api/v1/init-data", "this.getInitData", definitions[2].id],
  ];
  for (const [route, handler, operationId] of legacyRoutes) {
    const matches = historical.rows.filter(
      (row) =>
        row.kind === "api-candidate" &&
        row.method === "GET" &&
        row.route === route &&
        row.sourceFile === "backend/src/api/bitcoin/bitcoin.routes.ts" &&
        row.definition?.handlers?.includes(handler),
    );
    assert.equal(matches.length, 1, "Exact fee REST source lineage ambiguous");
    mappings.push({
      candidateId: matches[0].id,
      operationIds: [operationId],
      reason:
        "Exact method/registered route/handler lineage; selected Signet qualification and remaining required variants are separate",
      sources: producerProof,
    });
  }
  const coverageLinks = {
    "APP-FEE-ESTIMATE": definitions.map((operation) => operation.id),
    "APP-BOOTSTRAP": [definitions[2].id],
    "APP-REST-NETWORK": [
      definitions[0].id,
      definitions[1].id,
      definitions[2].id,
    ],
    "APP-CORE-WS": [
      "reviewed:signet-core-websocket",
      definitions[3].id,
      definitions[5].id,
    ],
    "APP-CLOCK": [
      "reviewed:signet-clock-route",
      definitions[4].id,
      definitions[5].id,
    ],
    "APP-DASHBOARD-LIVE": [definitions[3].id, definitions[4].id],
    "APP-SHARED-RECOVERY": [definitions[5].id],
    "PROOF-F-FE-001": [definitions[3].id, definitions[4].id, definitions[5].id],
  };
  return { definitions, candidates, mappings, bindings, coverageLinks };
}
