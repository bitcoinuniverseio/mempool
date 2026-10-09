import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtures, addressFixtures, REPRESENTATIVE_LEGACY_ADDRESS } from './fixtures.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

test('representative legacy address fixtures exist and are complete', () => {
  assert.equal(REPRESENTATIVE_LEGACY_ADDRESS, '1PuJjnF476W3zXfVYmJfGnouzFDAXakkL4');

  const addrKey = `/api/address/${REPRESENTATIVE_LEGACY_ADDRESS}`;
  const txsKey = `/api/address/${REPRESENTATIVE_LEGACY_ADDRESS}/txs`;
  const summaryKey = `/api/address/${REPRESENTATIVE_LEGACY_ADDRESS}/txs/summary`;
  const utxoKey = `/api/address/${REPRESENTATIVE_LEGACY_ADDRESS}/utxo`;

  assert.ok(addressFixtures[addrKey], 'address stats fixture must exist');
  assert.equal(addressFixtures[addrKey].address, REPRESENTATIVE_LEGACY_ADDRESS);
  assert.ok(Array.isArray(addressFixtures[txsKey]), 'txs fixture must be an array');
  assert.ok(Array.isArray(addressFixtures[summaryKey]), 'summary fixture must be an array');
  assert.ok(Array.isArray(addressFixtures[utxoKey]), 'utxo fixture must be an array');
});

test('state.service.ts initializes backend$ to null to prevent premature esplora assumptions', () => {
  const stateServicePath = path.join(repoRoot, 'frontend/src/app/services/state.service.ts');
  const content = fs.readFileSync(stateServicePath, 'utf8');

  // Verify backend and backend$ are initialized to null
  assert.match(
    content,
    /backend:\s*'esplora'\s*\|\s*'electrum'\s*\|\s*'none'\s*\|\s*null\s*=\s*null;/,
    'backend field must initialize to null'
  );
  assert.match(
    content,
    /backend\$\s*=\s*new BehaviorSubject<'esplora'\s*\|\s*'electrum'\s*\|\s*'none'\s*\|\s*null>\(null\);/,
    'backend$ BehaviorSubject must initialize to null'
  );
});

function addressSummaryBody(content) {
  const method = content.match(
    /private async getAddressTransactionSummary\(req: Request, res: Response\): Promise<void> \{([\s\S]*?)\n\s*private async getScriptHash/
  );
  assert.ok(method, 'getAddressTransactionSummary method must exist');
  return method[1];
}

function assertAddressSummaryCursorContract(body) {
  assert.match(body, /const afterTxid = req\.params\.afterTxid \?\? req\.query\.after_txid;/,
    'selects the path cursor or query cursor, preserving absent cursors');
  assert.match(body, /if \(req\.params\.afterTxid && req\.query\.after_txid !== undefined && req\.params\.afterTxid !== req\.query\.after_txid\) \{\s*sendAddressError\(req, res, 'invalid-address',[\s\S]*?return;/,
    'rejects conflicting path and query cursors before a source read');
  assert.match(body, /if \(afterTxid !== undefined && \(typeof afterTxid !== 'string' \|\| !TXID_REGEX\.test\(afterTxid\)\)\) \{\s*sendAddressError\(req, res, 'invalid-address',[\s\S]*?return;/,
    'rejects malformed cursors while allowing the absent cursor');
  assert.match(body, /const summary = await addressReadAdmission\.run\(\(\) => bitcoinApi\.\$getAddressTransactionSummary\(req\.params\.address, afterTxid as string \| undefined\)\);/,
    'forwards exactly the selected validated cursor within existing address admission');
}

test('bitcoin.routes.ts implements getAddressTransactionSummary correctly', () => {
  const routesPath = path.join(repoRoot, 'backend/src/api/bitcoin/bitcoin.routes.ts');
  const content = fs.readFileSync(routesPath, 'utf8');

  const fnBody = addressSummaryBody(content);
  assert.match(fnBody, /config\.MEMPOOL\.BACKEND !== 'esplora'/, 'checks for esplora backend');
  assert.match(fnBody, /sendAddressError\(req, res, 'address-backend-unavailable'/, 'sends address-backend-unavailable when not esplora');
  assert.match(fnBody, /ADDRESS_REGEX\.test\(req\.params\.address\)/, 'validates address parameter format');
  assertAddressSummaryCursorContract(fnBody);
  assert.match(fnBody, /res\.json\(summary\)/, 'responds with json summary');
});

test('the address summary gate rejects missing cursor forwarding, bypassed admission and broken cursor guards', () => {
  const content = fs.readFileSync(path.join(repoRoot, 'backend/src/api/bitcoin/bitcoin.routes.ts'), 'utf8');
  const body = addressSummaryBody(content);
  for (const [fault, mutation] of [
    ['missing cursor forwarding', body.replace(', afterTxid as string | undefined', '')],
    ['bypassed admission', body.replace('addressReadAdmission.run(() => bitcoinApi.', 'Promise.resolve(bitcoinApi.')],
    ['malformed cursor accepted', body.replace('!TXID_REGEX.test(afterTxid)', 'false')],
    ['conflicting cursor accepted', body.replace('req.params.afterTxid !== req.query.after_txid', 'false')],
    ['absent cursor rejected', body.replace('afterTxid !== undefined &&', 'afterTxid === undefined ||')],
  ]) {
    assert.notEqual(mutation, body, `${fault}: the fault control must actually change the checked route`);
    assert.throws(() => assertAddressSummaryCursorContract(mutation), assert.AssertionError, fault);
  }
});

test('the smoke navigates on the load event, never on network idle', () => {
  // The app polls and holds a WebSocket for the life of every page. Waiting
  // for idle on a slow origin times the navigation out before a single
  // assertion runs, and the run then reports a rendered page as empty.
  const source = fs.readFileSync(path.join(__dirname, 'address-page-smoke.mjs'), 'utf8');
  assert.equal(source.includes("'networkidle'"), false);
  assert.ok(source.includes("waitUntil: 'load'"));
});
