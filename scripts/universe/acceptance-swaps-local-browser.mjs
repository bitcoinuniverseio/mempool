import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Reuses the owner's one real page and actual localhost gateway. No routing
// interception, fabricated provider responses or chain claims.
export async function checkSwapLocalUi(page, output, screenshots) {
  const origin = 'http://localhost:4310';
  const checks = [], requests = [];
  mkdirSync(dirname(output), { recursive: true });
  const onRequest = request => {
    const url = new URL(request.url());
    if (url.pathname.includes('/intelligence/swaps/')) requests.push({ method: request.method(), path: url.pathname + url.search });
  };
  page.on('request', onRequest);
  const pass = (id, scope, actual) => checks.push({ id, status: 'PASS LOCAL', scope, actual });
  try {
    await page.goto(origin + '/swaps/providers', { waitUntil: 'domcontentloaded' });
    const providers = page.locator('app-swaps-providers');
    await providers.getByRole('alert').waitFor();
    assert.match(await providers.getByRole('alert').innerText(), /registry|configured|unavailable/i);
    assert.equal(await providers.getByText('No authenticated provider manifests are available for this network.', { exact: true }).count(), 0);
    assert.equal(await providers.locator('.row.g-4 .card').count(), 0);
    pass('SW-03-UNAVAILABLE-UI', 'Unavailable registry is a visible error, not a verified empty provider list; provider acceptance remains blocked PRE-04', { error: await providers.getByRole('alert').innerText() });
    await page.screenshot({ path: resolve(screenshots, 'swaps-provider-unavailable.png'), fullPage: true });

    // Deliberately malformed identity tests unavailable transport semantics only.
    await page.goto(origin + '/swaps/provider/invalid-acceptance-identity', { waitUntil: 'domcontentloaded' });
    const detail = page.locator('app-swaps-provider-detail');
    await detail.getByRole('alert').waitFor();
    assert.equal(await detail.getByText('Provider Manifest', { exact: true }).count(), 0);
    pass('SW-04-UNAVAILABLE-UI', 'No placeholder/default provider appears without registry evidence; this invalid-ID transport check does not accept a provider detail', { error: await detail.getByRole('alert').innerText() });

    for (const [path, method, body] of [
      ['/providers', 'GET'],
      ['/providers/invalid-acceptance-identity/history', 'GET'],
      ['/manifests/verify', 'POST', {}],
    ]) {
      const response = await page.request.fetch(origin + '/api/v1/intelligence/swaps' + path + '?chain=bitcoin&network=mainnet', { method, ...(body ? { data: body } : {}) });
      const data = await response.json();
      assert.equal(response.status(), 503);
      assert.match(JSON.stringify(data), /unavailable-registry/);
      if (body) assert.equal(data.valid, false);
      pass('SW-REGISTRY-HTTP-' + path, 'Actual compiled failure contract only; no authenticated registry, history or manifest pass', { httpStatus: response.status(), response: data });
    }

    await page.goto(origin + '/swaps/inspect', { waitUntil: 'domcontentloaded' });
    const inspect = page.locator('app-swaps-inspect');
    await inspect.getByRole('heading', { name: 'Public Swap Package Inspector' }).waitFor();
    const before = requests.length;
    await inspect.getByLabel('Public package JSON').fill(JSON.stringify({ chain: 'bitcoin', network: 'mainnet', swap_id: 'local-structure-check' }));
    await inspect.getByRole('button', { name: 'Check fields locally', exact: true }).click();
    await inspect.getByRole('status').waitFor();
    assert.match(await inspect.getByRole('status').innerText(), /accepted with 3 fields.*structure only/i);
    for (const input of ['{broken', JSON.stringify({ chain: 'bitcoin', network: 'signet' }), JSON.stringify({ chain: 'bitcoin', network: 'mainnet', preimage: 'controlled-private-field-rejection' })]) {
      await inspect.getByLabel('Public package JSON').fill(input);
      await inspect.getByRole('button', { name: 'Verify public chain evidence', exact: true }).click();
      await inspect.getByRole('alert').waitFor();
      assert.equal(await inspect.locator('section').count(), 0);
    }
    assert.equal(requests.length, before, 'Local inspection and rejected input must never reach evidence API');
    pass('SW-INSPECT-LOCAL', 'Actual local structural check accepts public-only matching network; malformed JSON, wrong network and private field are rejected before transmission', { evidenceApiRequests: 0 });

    await page.goto(origin + '/swaps/simulate', { waitUntil: 'domcontentloaded' });
    const simulate = page.locator('app-swaps-simulate');
    await simulate.getByRole('heading', { name: 'Atomic Swap Reorg Simulator' }).waitFor();
    const simulationStart = requests.length;
    await simulate.getByRole('button', { name: 'Run local simulation', exact: true }).click();
    const result = simulate.locator('section');
    await result.getByRole('heading', { name: 'Simulation only' }).waitFor();
    let text = await result.innerText();
    assert.match(text, /Common ancestor height: 197. Remaining lockup confirmations: 0/);
    assert.match(text, /lockup is displaced/);
    assert.match(text, /restored: 3/);
    assert.match(text, /below the hypothetical threshold/);
    pass('SW-SIMULATE-DISPLACED', 'Actual hypothetical form computation only', { ancestorHeight: 197, confirmations: 0, displaced: true, blocksUntilRefund: 3 });

    await simulate.getByLabel('Rollback depth (blocks)').fill('0');
    await simulate.getByLabel('Transaction fee rate (sat/vB)').fill('45');
    assert.equal(await result.count(), 0, 'Changing input removes stale simulation results');
    await simulate.getByRole('button', { name: 'Run local simulation', exact: true }).click();
    text = await result.innerText();
    assert.match(text, /Common ancestor height: 200. Remaining lockup confirmations: 3/);
    assert.match(text, /satisfied in this scenario/);
    assert.match(text, /at or above the hypothetical threshold/);
    pass('SW-SIMULATE-MATURE', 'Actual hypothetical zero-rollback and fee-boundary computation only', { ancestorHeight: 200, confirmations: 3, blocksUntilRefund: 0 });

    await simulate.getByLabel('Lockup inclusion height').fill('201');
    await simulate.getByRole('button', { name: 'Run local simulation', exact: true }).click();
    await simulate.getByRole('alert').waitFor();
    assert.match(await simulate.getByRole('alert').innerText(), /at or below/);
    assert.equal(await result.count(), 0);
    assert.equal(requests.length, simulationStart, 'Hypothetical simulation must not call swap evidence API');
    pass('SW-SIMULATE-INVALID', 'Impossible input rejected and previous output cleared; no swap evidence request', { evidenceApiRequests: 0 });
    await page.screenshot({ path: resolve(screenshots, 'swaps-local-simulation-invalid.png'), fullPage: true });
    const report = { checkedAt: new Date().toISOString(), origin, scope: 'Local computation and explicit unavailable states only; no network/provider/recovery acceptance', checks, requests };
    writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    return { localChecks: checks.length };
  } finally { page.off('request', onRequest); }
}

