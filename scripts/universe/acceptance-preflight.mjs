import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
export const GENESIS = {
  mainnet: "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f",
  signet: "00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6",
  testnet: "000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943",
  testnet4: "00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043",
  regtest: "0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206",
};
export function localOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error("Explicit local HTTP origin required");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw Error(
      "Origin must be a literal loopback HTTP origin without credentials or path",
    );
  return url.origin;
}
export function parseArgs(args) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (
      !["--origin", "--network", "--out"].includes(key) ||
      values[key] !== undefined ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw Error("Use exactly --origin VALUE --network VALUE --out NEW_FILE");
    values[key] = args[++i];
  }
  if (
    Object.keys(values).length !== 3 ||
    !Object.hasOwn(GENESIS, values["--network"])
  )
    throw Error("Explicit supported network, origin and new output required");
  return {
    origin: localOrigin(values["--origin"]),
    network: values["--network"],
    out: resolve(values["--out"]),
  };
}
export async function readBounded(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(12000),
  });
  const reader = response.body?.getReader();
  const chunks = [];
  let size = 0;
  if (reader)
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2_000_000) throw Error("Response size exceeds proof bound");
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  return {
    status: response.status,
    type: response.headers.get("content-type") || "",
    text: Buffer.concat(chunks).toString("utf8"),
  };
}
const hash = (value) => createHash("sha256").update(value).digest("hex");
export const TRANSPORT_PATHS = [
  "/__gateway/health",
  "/api/v1/__acceptance",
  "/api/v1/backend-info",
  "/api/v1/capabilities",
  "/api/v1/universe/status",
  "/api/v1/anima/status",
  "/api/v1/anima/events?from=0&limit=1",
  "/api/v1/anima/events/invalid-acceptance-identity",
  "/api/v1/anima/organisms?offset=0&limit=1",
  "/api/v1/anima/organisms/invalid-acceptance-identity",
  "/api/v1/anima/organisms/invalid-acceptance-identity/history?limit=1",
];
export async function preflight({ origin, network }, read = readBounded) {
  const prefix = network === "mainnet" ? "" : `/${network}`;
  const records = [];
  async function get(path) {
    const result = await read(origin + path);
    records.push({
      path,
      status: result.status,
      bodySha256: hash(result.text),
      bytes: Buffer.byteLength(result.text),
    });
    if (result.status !== 200) throw Error("Required API assertion failed");
    return result.text;
  }
  const checkpoint = async () => {
    const height = await get(prefix + "/api/blocks/tip/height");
    const tip = await get(prefix + "/api/blocks/tip/hash");
    if (
      !/^\d{1,16}$/.test(height) ||
      !Number.isSafeInteger(Number(height)) ||
      !/^[0-9a-f]{64}$/.test(tip)
    )
      throw Error("Invalid checkpoint schema");
    return { height: Number(height), hash: tip };
  };
  let passed = false,
    checkpointValue = null;
  try {
    const before = await checkpoint();
    if ((await get(prefix + "/api/block-height/0")) !== GENESIS[network])
      throw Error("Network genesis mismatch");
    const block = JSON.parse(await get(prefix + "/api/block/" + before.hash));
    if (block.id !== before.hash || block.height !== before.height)
      throw Error("Block checkpoint mismatch");
    for (const bare of TRANSPORT_PATHS) {
      const path = bare.startsWith("/__gateway") ? bare : prefix + bare;
      try {
        const result = await read(origin + path);
        let json = false;
        try {
          const value = JSON.parse(result.text);
          json = value !== null;
        } catch {}
        records.push({
          path,
          status: result.status,
          bodySha256: hash(result.text),
          bytes: Buffer.byteLength(result.text),
          contract:
            result.type?.includes("application/json") && json
              ? "JSON"
              : "FAIL_NON_JSON",
          acceptance: "TRANSPORT_ONLY_NOT_OPERATION_PASS",
        });
      } catch {
        records.push({
          path,
          status: null,
          acceptance: "TRANSPORT_UNAVAILABLE",
        });
      }
    }
    const after = await checkpoint();
    if (before.height !== after.height || before.hash !== after.hash)
      throw Error("Checkpoint moved");
    checkpointValue = before;
    passed = true;
  } catch {
    /* Never serialize arbitrary source bodies/errors into public evidence. */
  }
  return {
    checkedAt: new Date().toISOString(),
    origin,
    network,
    scope:
      "Read-only API genesis and stable-tip assertions; no independent Core, database, wallet, UI or whole-product readiness proof.",
    apiAssertionsPassed: passed,
    checkpoint: checkpointValue,
    plannedTransportProbes: TRANSPORT_PATHS.map((path) =>
      path.startsWith("/__gateway") ? path : prefix + path,
    ),
    probes: records,
    prerequisites: "NOT_EVALUATED",
    uiVerified: false,
    go: false,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = await preflight(args);
    const root = resolve(import.meta.dirname, "../..");
    report.localSource = {
      revision: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
      binding:
        "Local file identity only; not an attestation of the remote process.",
      files: [
        "scripts/universe/acceptance-preflight.mjs",
        "scripts/universe/acceptance-server.cjs",
        "scripts/universe/gateway.mjs",
      ].map((path) => ({
        path,
        sha256: hash(readFileSync(resolve(root, path))),
      })),
    };
    writeFileSync(args.out, JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
    });
    console.log(
      JSON.stringify({
        apiAssertionsPassed: report.apiAssertionsPassed,
        go: false,
      }),
    );
    if (!report.apiAssertionsPassed) process.exitCode = 1;
  } catch {
    console.error(
      "Preflight failed: invalid arguments, unavailable evidence, or output already exists.",
    );
    process.exitCode = 1;
  }
}
