import fs from 'node:fs';
const origin = 'https://explorer.bitcoinuniverse.io';
const result = { scope: 'public-live read-only; independent from candidate', startedAt: new Date().toISOString(), requests: [] };
async function read(path) {
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  result.requests.push({ method: 'GET', path, status: response.status });
  if (!response.ok) throw new Error(`GET ${path} returned ${response.status}`);
  return body;
}
try {
  const tip = Number(await read('/api/v1/blocks/tip/height'));
  const blockHash = await read(`/api/v1/block-height/${tip - 10}`);
  const block = await read(`/api/v1/block/${blockHash}`);
  const txids = await read(`/api/v1/block/${blockHash}/txids`);
  const txid = txids.at(-1);
  const transaction = await read(`/api/v1/tx/${txid}`);
  const address = transaction.vout.find(output => output.scriptpubkey_address)?.scriptpubkey_address;
  const outspend = (await read(`/api/v1/tx/${txid}/outspends`))[0];
  const addressState = address ? await read(`/api/v1/address/${address}`) : null;
  result.bitcoin = {
    chain: 'bitcoin', network: 'mainnet', blockHash, height: block.height,
    blockTransactionCount: block.tx_count, txid,
    transaction: { status: transaction.status, outputValues: transaction.vout.map(output => output.value), fee: transaction.fee },
    address, addressState, outspend,
  };
} catch (error) { result.bitcoinFailure = error.message; }
for (const chain of ['dogecoin', 'zcash']) {
  try {
    const status = await read(`/api/v1/${chain}/status?network=mainnet`);
    result[chain] = { release: status.release, tip: status.tip, ready: status.ready, coverage: status.coverage, degradedReasons: status.degradedReasons };
    if (status.tip?.heightAtomic) {
      const blockRef = (BigInt(status.tip.heightAtomic) - 10n).toString();
      const response = await fetch(`${origin}/api/v1/${chain}/block/${blockRef}?network=mainnet&limit=1`, { signal: AbortSignal.timeout(15000) });
      result.requests.push({ method: 'GET', path: `/api/v1/${chain}/block/${blockRef}?network=mainnet&limit=1`, status: response.status });
      result[chain].historicalBlockReadStatus = response.status;
      await response.body?.cancel();
    }
  } catch (error) { result[`${chain}Failure`] = error.message; }
}
result.finishedAt = new Date().toISOString();
fs.writeFileSync(new URL('owned-public-read-evidence.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ requests: result.requests, bitcoinRead: !!result.bitcoin, bitcoinFailure: result.bitcoinFailure, dogecoin: result.dogecoin?.historicalBlockReadStatus, zcash: result.zcash?.historicalBlockReadStatus }));
