import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

// Retains the recorded public vectors and reruns them through the real forms.
export async function checkParserForms(page, output) {
  const root = resolve(import.meta.dirname, '../..');
  const fixture = 'docs/acceptance/browser-parser-2026-09-06.json';
  const tests = JSON.parse(readFileSync(resolve(root, fixture), 'utf8')).checks;
  const checks = [];
  for (const test of tests) {
    const kind = test.id.startsWith('SP-05') ? 'address' : 'psbt';
    const prefix = test.network === 'mainnet' ? '' : '/' + test.network;
    await page.goto('http://localhost:4310' + prefix + '/payments/silent/' + kind, { waitUntil: 'domcontentloaded' });
    const host = page.locator('app-silent-payments-' + kind);
    await host.locator('textarea').fill(test.input);
    const responsePromise = page.waitForResponse(response => response.url().includes('/silent/validate-' + kind) && response.request().method() === 'POST', { timeout: 10000 });
    const [response] = await Promise.all([responsePromise, host.getByRole('button', { name: kind === 'address' ? 'Validate Address' : 'Inspect Fields', exact: true }).click()]);
    const data = await response.json();
    assert.equal(response.status(), test.expected.valid ? 200 : 400);
    assert.equal(new URL(response.url()).searchParams.get('network'), test.network);
    for (const [key, value] of Object.entries(test.expected)) assert.deepEqual(data[key], value, test.id + ' ' + key);
    if (test.expected.valid) {
      await host.getByRole('heading', { name: kind === 'address' ? /Valid BIP352 Address/ : 'PSBT Structure Inspection Result' }).waitFor();
      for (const key of ['scan_pubkey', 'spend_pubkey']) if (test.expected[key]) assert((await host.innerText()).includes(test.expected[key]));
    } else {
      await host.getByRole('alert').waitFor();
      assert((await host.getByRole('alert').innerText()).trim().length > 0);
    }
    checks.push({ id: test.id, status: 'PASS LOCAL', scope: 'Actual form -> compiled handler -> rendered result, offline parser only',
      network: test.network, inputSha256: createHash('sha256').update(test.input).digest('hex'),
      httpStatus: response.status(), requestUrl: response.url(), requestId: response.headers()['x-request-id'],
      expected: test.expected, actual: data, checkedAt: new Date().toISOString() });
  }
  writeFileSync(output, JSON.stringify({ checkedAt: new Date().toISOString(), origin: 'http://localhost:4310', publicFixtureSource: fixture,
    scope: 'Local parser forms; no blockchain or wallet interoperability acceptance', checks }, null, 2) + '\n');
  return { localParserFormChecks: checks.length };
}

