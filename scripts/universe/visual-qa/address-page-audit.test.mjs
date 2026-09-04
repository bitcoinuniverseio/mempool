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

test('bitcoin.routes.ts implements getAddressTransactionSummary correctly', () => {
  const routesPath = path.join(repoRoot, 'backend/src/api/bitcoin/bitcoin.routes.ts');
  const content = fs.readFileSync(routesPath, 'utf8');

  const summaryFnMatch = content.match(
    /private async getAddressTransactionSummary\(req: Request, res: Response\): Promise<void> \{([\s\S]*?)\n\s*private async getScriptHash/
  );
  assert.ok(summaryFnMatch, 'getAddressTransactionSummary method must exist');

  const fnBody = summaryFnMatch[1];
  assert.match(fnBody, /config\.MEMPOOL\.BACKEND !== 'esplora'/, 'checks for esplora backend');
  assert.match(fnBody, /sendAddressError\(req, res, 'address-backend-unavailable'/, 'sends address-backend-unavailable when not esplora');
  assert.match(fnBody, /ADDRESS_REGEX\.test\(req\.params\.address\)/, 'validates address parameter format');
  assert.match(fnBody, /bitcoinApi\.\$getAddressTransactionSummary\(req\.params\.address\)/, 'calls bitcoinApi.$getAddressTransactionSummary');
  assert.match(fnBody, /res\.json\(summary\)/, 'responds with json summary');
});
