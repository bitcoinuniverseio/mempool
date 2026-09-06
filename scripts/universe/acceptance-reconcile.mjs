// Run after acceptance-inventory.mjs and the final browser checks.
// This only reconciles saved local evidence. It never starts a test or service.
// node scripts/universe/acceptance-reconcile.mjs [--contract-log <final log>]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const directory = resolve(root, 'docs/acceptance');
const recorder = 'acceptance-reconcile-v1';
const now = new Date().toISOString();
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === '--contract-log'),
  'Usage: node scripts/universe/acceptance-reconcile.mjs [--contract-log <final log>]');
const artifacts = new Map();
function readArtifact(path) {
  const absolute = resolve(path);
  const bytes = readFileSync(absolute);
  const artifact = {
    path: relative(root, absolute).replaceAll('\\', '/'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  artifacts.set(artifact.path, artifact);
  return { ...artifact, text: bytes.toString('utf8').replace(/^\uFEFF/, '') };
}
function readJson(name) {
  const artifact = readArtifact(resolve(directory, name));
  return { ...artifact, value: JSON.parse(artifact.text) };
}
function evidence(artifact, scope, checkIds = []) {
  return { recordedBy: recorder, artifact: artifact.path, sha256: artifact.sha256, scope, checkIds };
}
function attach(row, items) {
  row.evidence = [...(row.evidence ?? []).filter(item => item?.recordedBy !== recorder), ...items];
}
function uniqueRows(rows, label) {
  assert(Array.isArray(rows), `${label} must be an array`);
  const result = new Map(rows.map(row => [row.id, row]));
  assert.equal(result.size, rows.length, `${label} contains duplicate IDs`);
  return result;
}
function expectedRows(rows, ids, label) {
  const result = uniqueRows(rows, label);
  assert.deepEqual([...result.keys()].sort(), [...ids].sort(), `${label} must preserve every original ID`);
  return result;
}
const range = (prefix, count, width = 2) => Array.from({ length: count }, (_, i) =>
  `${prefix}-${String(i + 1).padStart(width, '0')}`);
const inventoryArtifact = readJson('2026-09-05-inventory.json');
const controlsArtifact = readJson('2026-09-05-controls.json');
const inventory = inventoryArtifact.value;
const controls = controlsArtifact.value;
const navRows = expectedRows(inventory.navigation, range('NAV', 351, 3), 'navigation');
expectedRows(inventory.protocols, range('PRO', 39), 'protocols');
const operationRows = expectedRows(inventory.operations, [
  ...range('OV', 13), ...range('NET', 2), ...range('SP', 6), ...range('SW', 12),
  ...range('BASE', 3), 'DOC-01',
], 'named operations');
uniqueRows(controls.operations, 'UI candidates');
uniqueRows(controls.apiOperations, 'API candidates');
const originalIdentity = JSON.stringify({
  navigation: inventory.navigation.map(({ id, path, family }) => ({ id, path, family })),
  protocols: inventory.protocols,
  operations: inventory.operations.map(({ id, entry, operation, baselineStatus, defects }) =>
    ({ id, entry, operation, baselineStatus, defects })),
});
assert.equal(inventory.operationDenominatorReconciled, false, 'Do not overwrite a later completed acceptance run');
assert.equal(controls.operationDenominatorReconciled, false, 'Do not overwrite a later completed inventory');
assert.equal(inventory.realNetworkE2ePasses, 0, 'Preserve any later real-network acceptance separately');

const navigation = readJson('browser-navigation-2026-09-05.json');
const forms = readJson('browser-parser-2026-09-05.json');
const http = readJson('parser-http-2026-09-05.json');
const workflows = readJson('browser-workflows-2026-09-05.json');
for (const artifact of [navigation, forms]) {
  assert(artifact.value.completedAt, `${artifact.path} is incomplete; finish the browser run first`);
  assert(Date.parse(artifact.value.startedAt) >= Date.parse(controls.generatedAt),
    `${artifact.path} predates source enumeration; run the final browser checks against the enumerated candidate`);
  assert.equal(artifact.value.realNetworkE2ePasses, 0);
}
for (const artifact of [navigation, forms, http, workflows]) {
  assert.equal(artifact.value.origin, 'http://localhost:4310', 'Evidence must use the dedicated local application');
}
assert.equal(workflows.value.realNetworkE2ePasses, 0);
const navChecks = expectedRows(navigation.value.checks, [...navRows.keys()], 'browser navigation');
for (const [id, row] of navRows) {
  const check = navChecks.get(id);
  assert.equal(check.requestedPath, row.path, `${id} no longer matches its recorded route`);
  assert(['PASS', 'FAIL', 'NOT VERIFIED'].includes(check.renderStatus), `${id} has an unknown render result`);
  assert(['BLOCKED', 'NOT TESTED'].includes(check.operationStatus), `${id} must not inherit an operation pass from rendering`);
  row.baselineStatus ??= row.status;
  row.status = check.operationStatus;
  row.operationStatus = check.operationStatus;
  row.renderStatus = check.renderStatus;
  row.renderEvidence = {
    ...evidence(navigation, 'Route rendering only; dependent controls and valid parameter identities remain separate', [id]),
    checkedAt: check.checkedAt,
    exercisedPath: check.exercisedPath,
    actualPath: check.path,
    inputScope: check.inputScope,
    expectedSelectors: check.expectedSelectors ?? [],
    renderedComponents: check.renderedComponents ?? [],
    errors: check.errors ?? [],
    unavailableRequests: check.unavailableRequests ?? [],
    reason: check.reason ?? null,
  };
}

const httpChecks = uniqueRows(http.value.results, 'HTTP parser checks');
const formChecks = uniqueRows(forms.value.checks, 'parser form checks');
assert.equal(httpChecks.size, 42, 'Expected the complete 42-check HTTP parser run');
assert.equal(formChecks.size, 11, 'Expected the complete 11-check parser form run');
assert.equal(http.value.passed, 42);
assert.equal(http.value.failed, 0);
for (const check of [...httpChecks.values(), ...formChecks.values()]) {
  assert.equal(check.status, 'PASS', `Parser check ${check.id} did not pass`);
  assert([200, 400].includes(check.httpStatus), `${check.id} has an unexpected HTTP outcome`);
  assert(check.requestId, `${check.id} is missing request correlation`);
  assert.equal(check.httpStatus, check.expected.valid ? 200 : 400, `${check.id} status does not match its assertion`);
  for (const [key, expected] of Object.entries(check.expected)) {
    assert.deepEqual(check.actual[key], expected, `${check.id} response does not support ${key}`);
  }
  if (check.responseRequestId !== undefined) assert.equal(check.responseRequestId, check.requestId);
}

const ledgers = Object.fromEntries(['network-contract', 'silent-payments', 'swaps', 'protected-operations']
  .map(name => [name, readArtifact(resolve(directory, `${name}-2026-09-05.md`))]));
function tableRow(name, id) {
  const matches = ledgers[name].text.split(/\r?\n/).filter(line => line.startsWith(`| ${id} |`));
  assert.equal(matches.length, 1, `Expected one ${id} row in ${name}; reconcile changed ledger wording explicitly`);
  return matches[0].split('|').slice(1, -1).map(cell => cell.trim());
}
function blocked(id, name, tableId, dependencyColumn, actualColumn) {
  const row = operationRows.get(id);
  const cells = tableRow(name, tableId);
  assert(cells[dependencyColumn], `Missing prerequisite for ${id}`);
  row.status = 'BLOCKED';
  row.actual = cells[actualColumn];
  row.remainingPrerequisite = cells[dependencyColumn];
  row.prerequisiteLedger = { artifact: ledgers[name].path, rowId: tableId };
  row.acceptanceScope = 'Required operation remains unaccepted; linked local tests are supporting evidence only';
  attach(row, [evidence(ledgers[name], 'Current scoped operation result and exact prerequisite', [tableId])]);
}
for (const [ids, tableId] of [
  [['OV-01'], 'OV-01'], [['OV-02', 'OV-03'], 'OV-02, OV-03'],
  [['OV-04', 'OV-05', 'OV-06', 'OV-07'], 'OV-04 to OV-07'],
  [['OV-08', 'OV-09', 'OV-10'], 'OV-08 to OV-10'],
  [['OV-11', 'OV-12'], 'OV-11, OV-12'], [['OV-13'], 'OV-13'],
  [['NET-01', 'NET-02'], 'NET-01, NET-02'],
]) for (const id of ids) blocked(id, 'network-contract', tableId, 3, 2);
for (const id of ['SP-01', 'SP-02', 'SP-03']) {
  blocked(id, 'silent-payments', 'SP-01,02,03 / Q04 live', 2, 3);
}
blocked('SP-04', 'silent-payments', 'SP-04 live', 2, 3);
for (const id of range('SW', 12)) blocked(id, 'swaps', id, 4, 3);
const basePrerequisites = {
  'BASE-01': ['BLOCKED', 'Accessible owned Signet broadcast/readback backend, controlled signed transaction and intended signer; prove required confirmation, protocol recognition and correct UI after reload. No mainnet spend is required.'],
  'BASE-02': ['NOT TESTED', 'Exercise the actual /node/rpc consumer and registered read allowlist against the configured owned node; observe an allowed read and prove a disallowed privileged method is refused before forwarding.'],
  'BASE-03': ['BLOCKED', 'Connect the actual gateway WebSocket to its selected owned backend/overlay, subscribe to real updates, disconnect, reconnect and compare reconciled state with the source. Routing unit tests alone do not prove this transport lifecycle.'],
};
for (const [id, [status, prerequisite]] of Object.entries(basePrerequisites)) {
  const row = operationRows.get(id);
  row.status = status;
  row.actual = 'No accepted real consumer-to-authority journey is recorded for this operation.';
  row.remainingPrerequisite = prerequisite;
  attach(row, [evidence(ledgers['protected-operations'], 'Q07 service/transport acceptance remains separate from local guard checks', ['Q07'])]);
}

const parserScopes = new Map();
for (const [id, suffix, expectedHttp, expectedForms] of [
  ['SP-05', 'address', 9, 6], ['SP-06', 'psbt', 33, 5],
]) {
  const api = [...httpChecks.values()].filter(check => check.operation === id);
  const ui = [...formChecks.values()].filter(check => check.id.startsWith(`${id}-UI-`));
  assert.equal(api.length, expectedHttp, `${id} HTTP coverage changed`);
  assert.equal(ui.length, expectedForms, `${id} form coverage changed`);
  const endpoint = `/api/v1/intelligence/payments/silent/validate-${suffix}`;
  for (const check of [...api, ...ui]) {
    assert.equal(new URL(check.requestUrl ?? check.endpoint, http.value.origin).pathname, endpoint);
  }
  const scope = id === 'SP-05'
    ? 'Offline BIP352/BIP321 address decoding, expected public keys and malformed/wrong-network rejection through actual form and HTTP handler'
    : 'Offline complete PSBT structural inspection and standard-field detection through actual form and HTTP handler; no signature/DLEQ verification, signing or broadcast';
  const items = [evidence(http, scope, api.map(check => check.id)), evidence(forms, scope, ui.map(check => check.id))];
  const row = operationRows.get(id);
  row.status = 'PASS LOCAL';
  row.acceptanceScope = scope;
  row.role = 'Public offline parser';
  row.testedNetworks = [...new Set([...api, ...ui].map(check => check.network))];
  row.network = `${row.testedNetworks.join(', ')} request context; no chain transaction`;
  row.authority = 'Local standards decoder; no chain authority is required for this parser scope';
  row.dependencies = ['Candidate form', 'Compiled local HTTP parser handler', 'Recorded standards vectors'];
  row.steps = ['Submit recorded valid and invalid inputs through HTTP and the real form', 'Compare status and decoded fields with independent expectations', 'Observe the rendered success or rejection and preserve request correlation'];
  row.actual = `${api.length} HTTP checks and ${ui.length} real-form checks passed within the stated parser scope.`;
  row.remainingPrerequisite = 'None for the recorded parser checks. Untested version, encoding and context variants remain separate; this pass establishes no chain, payment, signing or settlement workflow.';
  row.checkedAt = forms.value.completedAt;
  row.revision = http.value.revision;
  row.sourceDiffSha256 = http.value.sourceDiffSha256;
  attach(row, items);
  parserScopes.set(id, { scope, items, networks: row.testedNetworks });
}

const contractLog = readArtifact(args[1] ?? resolve(root, '../.runtime/acceptance-final-gateway-contract.log'));
const cleanLog = contractLog.text.replace(/\u001b\[[0-9;]*m/g, '');
function count(name) {
  const values = [...cleanLog.matchAll(new RegExp(`^\\s*(?:#|ℹ)?\\s*${name} (\\d+)\\s*$`, 'gm'))];
  assert.equal(values.length, 1, `Expected one ${name} counter in the final gateway/contract log`);
  return Number(values[0][1]);
}
assert.equal(count('tests'), 52, 'Supply the completed 52-test gateway/protocol run');
assert.equal(count('pass'), 52);
for (const name of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(count(name), 0);
assert(cleanLog.includes('protocol overlay routes reach the overlay unchanged'));
assert(cleanLog.includes('a served roster identical to the pin reports nothing'));
const doc = operationRows.get('DOC-01');
doc.status = 'PASS LOCAL CONTRACT';
doc.acceptanceScope = 'Current local registry/manifest and gateway dispatch contract; not complete application operation coverage';
doc.actual = '52 gateway/protocol contract checks passed, with no failures or skips.';
doc.remainingPrerequisite = 'Full offering denominator and each authority-to-consumer journey remain unresolved; this local contract pass changes no protocol release or real-network status.';
attach(doc, [evidence(contractLog, doc.acceptanceScope), evidence(ledgers['network-contract'], 'Local registry 1.1.0, retained protocol identities and dispatch documentation', ['DOC-01'])]);

function candidate(rows, id, fields) {
  const matches = rows.filter(row => row.id === id);
  assert.equal(matches.length, 1, `Re-enumerate and review changed candidate ${id}`);
  for (const [key, value] of Object.entries(fields)) assert.deepEqual(matches[0][key], value, `${id} handler identity changed`);
  return matches[0];
}
function narrow(row, scope, items, networks = []) {
  // Do not replace a candidate's overall status: role/network/query variants
  // still need reconciliation even when one actual handler check has passed.
  assert.equal(row.status, 'NOT TESTED', `${row.id} has later acceptance; preserve it for explicit review`);
  row.localAcceptance = { status: 'PASS LOCAL', scope, testedNetworks: networks, variantCoverageComplete: false, recordedBy: recorder };
  attach(row, items);
}
for (const [operationId, uiId, apiId, suffix, expression] of [
  ['SP-05', 'UI-1309ff721a69', 'API-fce252521818', 'address', 'validate()'],
  ['SP-06', 'UI-07fc31393043', 'API-b4cca5e92776', 'psbt', 'inspect()'],
]) {
  const { scope, items, networks } = parserScopes.get(operationId);
  narrow(candidate(controls.operations, uiId, {
    source: `frontend/src/app/universe/silent-payments/silent-payments-${suffix}.component.ts`,
    event: 'ngSubmit', expression,
  }), scope, [items[1]], networks);
  narrow(candidate(controls.apiOperations, apiId, {
    source: 'backend/src/api/intelligence/silent-payments/silent-payments.routes.ts',
    method: 'POST', pathExpression: `prefix + 'validate-${suffix}'`,
  }), scope, items, networks);
}
const workflowChecks = uniqueRows(workflows.value.checks, 'browser workflow checks');
const simulationIds = ['SW-SIM-UI', 'SW-SIM-UI-INVALID'];
for (const id of simulationIds) assert.equal(workflowChecks.get(id)?.status, 'PASS', `${id} must pass before reconciliation`);
assert.equal(workflowChecks.get('SW-SIM-UI').scope, 'hypothetical calculation only');
narrow(candidate(controls.operations, 'UI-172e4d6e5ee2', {
  source: 'frontend/src/app/universe/swaps/swaps-simulate.component.ts',
  event: 'ngSubmit', expression: 'run()',
}), 'Actual simulation form: hypothetical arithmetic and invalid-input rejection only; no observed chain state or recovery result',
[evidence(workflows, 'Local simulation form only', simulationIds)]);

assert.equal(JSON.stringify({
  navigation: inventory.navigation.map(({ id, path, family }) => ({ id, path, family })),
  protocols: inventory.protocols,
  operations: inventory.operations.map(({ id, entry, operation, baselineStatus, defects }) =>
    ({ id, entry, operation, baselineStatus, defects })),
}), originalIdentity, 'Original inventory identity changed');
for (const document of [inventory, controls]) {
  document.operationDenominatorReconciled = false;
  document.realNetworkE2ePasses = 0;
  document.reconciliation = { recordedBy: recorder, checkedAt: now,
    scope: 'Saved local evidence linkage only; candidate statuses do not imply all variants passed' };
}
inventory.status = 'FUNCTIONAL NO-GO';
const summary = {
  schemaVersion: 1, checkedAt: now, status: inventory.status,
  operationDenominatorReconciled: false, realNetworkE2ePasses: 0,
  preserved: { navigation: navRows.size, protocols: inventory.protocols.length, namedOperations: operationRows.size },
  routeRendering: Object.fromEntries(['PASS', 'FAIL', 'NOT VERIFIED'].map(status =>
    [status, inventory.navigation.filter(row => row.renderStatus === status).length])),
  namedLocalPasses: ['SP-05', 'SP-06', 'DOC-01'],
  narrowCandidateEvidence: [...controls.operations, ...controls.apiOperations]
    .filter(row => row.localAcceptance?.recordedBy === recorder).map(row => ({ id: row.id, ...row.localAcceptance })),
  inputs: [...artifacts.values()],
  limitations: [
    'Route rendering is separate from an operation, valid parameter identity or dependency pass.',
    'Parser request network context establishes no real-network E2E pass.',
    'Only two parser forms, their two POST handlers and the simulation run handler receive narrow candidate evidence.',
    'Portfolio browser acceptance and every other unlisted handler remain unpromoted.',
    'The 37 named operations are a preserved starting inventory, not the final operation denominator.',
  ],
};
// All checks finish before either original ledger is written.
writeFileSync(resolve(directory, '2026-09-05-inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
writeFileSync(resolve(directory, '2026-09-05-controls.json'), JSON.stringify(controls, null, 2) + '\n');
writeFileSync(resolve(directory, 'reconciliation-2026-09-05.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ ...summary.preserved, routeRendering: summary.routeRendering,
  namedLocalPasses: summary.namedLocalPasses, narrowCandidateEvidence: summary.narrowCandidateEvidence.map(row => row.id),
  operationDenominatorReconciled: false, realNetworkE2ePasses: 0 }));
