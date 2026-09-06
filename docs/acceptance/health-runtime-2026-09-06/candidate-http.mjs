import fs from 'node:fs';
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:4310';
const owned = JSON.parse(fs.readFileSync(new URL('owned-public-read-evidence.json', import.meta.url), 'utf8')).bitcoin;
const sha = '8b2aea3afd4b2f26e2ee5f1275171a937515cbc2';
const evidence = { startedAt: new Date().toISOString(), scope: 'actual candidate gateway and overlay with owned public Bitcoin read-only backend', overlay: sha, mempool: '64d9ebccd6deb1da07c14fbb3fe77596af1f3646', requests: [], checks: [] };
async function read(path, expectedStatus = 200) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(25000) });
  const text = await response.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  evidence.requests.push({ path, method: 'GET', status: response.status, observedAt: new Date().toISOString(), body });
  assert.equal(response.status, expectedStatus, path);
  return body;
}
async function check(name, fn) {
  try { evidence.checks.push({ name, status: 'PASS', actual: await fn() }); }
  catch (error) { evidence.checks.push({ name, status: 'FAIL', error: error.message }); }
  console.log(JSON.stringify(evidence.checks.at(-1)));
}
try {
  for (const network of ['mainnet', 'signet']) await check(`chain contexts and release ${network}`, async () => {
    const rows = await read(`/api/v1/chains?network=${network}`);
    assert.deepEqual(rows.map(r => [r.chain, r.network]), [['bitcoin', network], ['dogecoin', 'mainnet'], ['zcash', 'mainnet']]);
    for (const row of rows) { assert.equal(row.release.sha, sha); assert.equal(row.health.chain, row.chain); assert.equal(row.health.network, row.network); }
    if (network === 'mainnet') { assert.equal(rows[0].health.node.synced, true); assert.equal(rows[0].health.summary.servicesReady, false); }
    else assert.equal(rows[0].health.node.synced, null);
    return rows.map(r => ({ chain: r.chain, network: r.network, node: r.health.node.state, services: r.health.summary.servicesReady }));
  });
  for (const chain of ['bitcoin', 'dogecoin', 'zcash']) await check(`${chain} status candidate routing`, async () => {
    const result = await read(`/api/v1/${chain}/status?network=mainnet`);
    assert.equal(result.release.sha, sha); assert.equal(result.chain, chain); return { release: result.release, node: result.health.node.state };
  });
  for (const chain of ['dogecoin', 'zcash']) await check(`${chain} rejects Bitcoin-only network`, async () => {
    await read(`/api/v1/${chain}/status?network=signet`, 400); return '400 unsupported chain/network';
  });
  for (const route of ['status', 'sources', 'protocols']) await check(`universe ${route} candidate routing`, async () => {
    const result = await read(`/api/v1/universe/${route}?chain=bitcoin&network=mainnet`);
    return { schema: result.schemaVersion, release: result.release, count: Array.isArray(result) ? result.length : result.protocolCount };
  });
  await check('owned Bitcoin block identity through candidate', async () => {
    const block = await read(`/api/v1/block/${owned.blockHash}`);
    assert.equal(block.height, owned.height); assert.equal(block.id, owned.blockHash); assert.equal(block.tx_count, owned.blockTransactionCount);
    return { id: block.id, height: block.height, txCount: block.tx_count };
  });
  await check('owned Bitcoin transaction values and confirmation through candidate', async () => {
    const tx = await read(`/api/v1/tx/${owned.txid}`);
    assert.equal(tx.txid, owned.txid); assert.deepEqual(tx.status, owned.transaction.status); assert.deepEqual(tx.vout.map(v => v.value), owned.transaction.outputValues); assert.equal(tx.fee, owned.transaction.fee);
    return { txid: tx.txid, status: tx.status, outputValues: tx.vout.map(v => v.value), fee: tx.fee };
  });
  await check('owned Bitcoin address totals through candidate', async () => {
    const address = await read(`/api/v1/address/${owned.address}`);
    assert.deepEqual(address, owned.addressState); return address;
  });
  await check('owned Bitcoin spent state through candidate', async () => {
    const outspends = await read(`/api/v1/tx/${owned.txid}/outspends`);
    assert.deepEqual(outspends[0], owned.outspend); return outspends[0];
  });
  await check('backend-info remains distinct from overlay identity', async () => {
    const info = await read('/api/v1/backend-info');
    assert.notEqual(info.gitCommit, sha); return { gitCommit: info.gitCommit, chainSync: info.chainSync };
  });
} finally {
  evidence.finishedAt = new Date().toISOString();
  fs.writeFileSync(new URL('candidate-http-evidence.json', import.meta.url), JSON.stringify(evidence, null, 2));
}
