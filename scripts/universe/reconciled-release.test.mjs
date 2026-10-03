import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './reconciled-release-fixture.mjs';
const encode = value => Buffer.from(JSON.stringify(value));

test('structurally complete candidate-bound lifecycle receipt qualifies independently of historical source labels', () => {
  const f = fixture(); assert.equal(f.roster.operations[0].status, 'NOT TESTED');
  assert.equal(f.run().operationCount, 1);
});
test('unknown denominator and lost historical mappings cannot be released', () => {
  const f = fixture(); f.roster.operationDenominatorReconciled = false;
  assert.throws(() => f.run(encode(f.roster)), /denominator/);
  f.roster.operationDenominatorReconciled = true; f.roster.mappings = [];
  assert.throws(() => f.run(encode(f.roster)), /candidates were lost/);
});
test('PASS labels, omitted operations and component receipts are refused', () => {
  const f = fixture(); f.acceptance.operations[0].files = [];
  assert.throws(() => f.run(), /receipt is absent/);
  f.acceptance.operations = []; assert.throws(() => f.run(), /Missing or duplicate/);
  const g = fixture(); g.receipt.schemaVersion = 'component-test-v1'; g.updateReceipt();
  assert.throws(() => g.run(), /component evidence/);
});
test('byte drift, contract drift and component revision drift are rejected', () => {
  const f = fixture(); f.acceptance.operations[0].files[0].sha256 = '0'.repeat(64);
  assert.throws(() => f.run(), /byte drift/);
  const g = fixture(); g.receipt.operation.role = 'foreign owner'; g.updateReceipt();
  assert.throws(() => g.run(), /contract drift/);
  const h = fixture(); h.acceptance.componentBindings[0].revision = 'f'.repeat(40);
  assert.throws(() => h.run(), /source revision drift/);
});
test('Mainnet, regtest and arbitrary contexts cannot become required functional qualification', () => {
  for (const network of ['mainnet', 'regtest', 'invented-testnet']) {
    const f = fixture(); f.receipt.testContext = { chain: 'bitcoin', network, justification: 'claimed' }; f.updateReceipt();
    assert.throws(() => f.run(), /Unsupported functional test context/);
  }
});
test('missing observations, assertion readbacks or lifecycle recovery fail closed', () => {
  const f = fixture(); f.receipt.phases.refreshRecovery.result = 'NOT TESTED'; f.updateReceipt();
  assert.throws(() => f.run(), /Unaccepted lifecycle/);
  const g = fixture(); g.receipt.assertions = []; g.updateReceipt(); assert.throws(() => g.run(), /Unproved functional/);
});

test('another supported chain cannot qualify a Bitcoin operation', () => {
  const f = fixture(undefined, 'Bitcoin');
  f.receipt.testContext = { chain: 'dogecoin', network: 'testnet', justification: 'claimed' };
  f.updateReceipt();
  assert.throws(() => f.run(), /Functional chain drift/);
});

test('unpacked proof paths and malformed extra component bindings are refused', () => {
  const f = fixture(); f.acceptance.operations[0].files[0].path = 'unpacked/receipt.json';
  assert.throws(() => f.run(), /packed docs tree/);
  const g = fixture(); g.acceptance.componentBindings.push({ component: 'producer', revision: 'unverified' });
  assert.throws(() => g.run(), /Invalid component binding/);
});
