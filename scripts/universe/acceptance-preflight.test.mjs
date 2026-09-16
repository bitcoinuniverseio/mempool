import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  parseArgs,
  localOrigin,
  preflight,
  GENESIS,
} from "./acceptance-preflight.mjs";
const hash = "ab".repeat(32);
for (const args of [
  [],
  ["--origin"],
  ["--network", "evil"],
  [
    "--origin",
    "http://127.0.0.1:1",
    "--network",
    "signet",
    "--out",
    "x",
    "--out",
    "y",
  ],
])
  test(
    "reject missing/duplicate/unsupported args " + JSON.stringify(args),
    () => assert.throws(() => parseArgs(args)),
  );
for (const origin of [
  "https://example.com",
  "http://user:secret@127.0.0.1:3",
  "http://127.0.0.1:3/path",
  "http://127.0.0.1:3/?x=secret",
])
  test("reject nonlocal or credential-bearing origin", () =>
    assert.throws(() => localOrigin(origin)));
function source(overrides = {}) {
  let heights = 0;
  return async (url) => {
    let text = '{"secret":"NEVER_SERIALIZE_ME"}';
    if (url.endsWith("/blocks/tip/height"))
      text = String(++heights === 1 ? 10 : (overrides.finalHeight ?? 10));
    if (url.endsWith("/blocks/tip/hash")) text = hash;
    if (url.endsWith("/block-height/0"))
      text = overrides.genesis ?? GENESIS.signet;
    if (url.endsWith("/block/" + hash))
      text = JSON.stringify({ id: hash, height: 10 });
    return { status: 200, type: "application/json", text };
  };
}
test("stable genesis/checkpoint assertions retain11historical transport probes without source-body leakage", async () => {
  const report = await preflight(
    { origin: "http://127.0.0.1:1", network: "signet" },
    source(),
  );
  assert.equal(report.apiAssertionsPassed, true);
  assert.equal(report.go, false);
  assert.equal(
    report.probes.filter(
      (p) => p.acceptance === "TRANSPORT_ONLY_NOT_OPERATION_PASS",
    ).length,
    11,
  );
  assert.equal(JSON.stringify(report).includes("NEVER_SERIALIZE_ME"), false);
  assert.equal(report.prerequisites, "NOT_EVALUATED");
});
test("wrong genesis does not establish selected network", async () => {
  assert.equal(
    (
      await preflight(
        { origin: "http://127.0.0.1:1", network: "signet" },
        source({ genesis: GENESIS.mainnet }),
      )
    ).apiAssertionsPassed,
    false,
  );
});
test("changing checkpoint fails", async () => {
  assert.equal(
    (
      await preflight(
        { origin: "http://127.0.0.1:1", network: "signet" },
        source({ finalHeight: 11 }),
      )
    ).apiAssertionsPassed,
    false,
  );
});
const require = createRequire(import.meta.url);
const handler = require("./acceptance-error-handler.cjs");
test("acceptance host distinguishes parsing/payload/server faults without leaking error", () => {
  for (const [error, status] of [
    [{ type: "entity.parse.failed" }, 400],
    [{ type: "entity.too.large" }, 413],
    [Error("SECRET"), 500],
  ]) {
    const res = {
      status(value) {
        this.code = value;
        return this;
      },
      json(value) {
        this.body = value;
        return this;
      },
    };
    handler(error, {}, res, () => assert.fail());
    assert.equal(res.code, status);
    assert.equal(JSON.stringify(res.body).includes("SECRET"), false);
  }
});
test("already started error response delegates instead of writing new headers", () => {
  const error = Error();
  let forwarded;
  handler(error, {}, { headersSent: true }, (value) => {
    forwarded = value;
  });
  assert.equal(forwarded, error);
});
import http from 'node:http';
import {readBounded} from './acceptance-preflight.mjs';
test('HTTP reader refuses redirects and bounds response bytes', async()=>{
 const server=http.createServer((req,res)=>{if(req.url==='/redirect'){res.writeHead(302,{location:'/secret'});res.end();}else{res.end('x'.repeat(2_000_001));}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 try{await assert.rejects(()=>readBounded(origin+'/redirect'));await assert.rejects(()=>readBounded(origin+'/large'),/bound/);}finally{await new Promise(resolve=>server.close(resolve));}
});
