import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(resolve(root, 'backend/package.json'));
const { Psbt } = require('bitcoinjs-lib');
const { bech32m } = require('bech32');
const origin = 'http://localhost:4310';
const vectors = JSON.parse(readFileSync(resolve(root, 'backend/src/api/intelligence/silent-payments/bip375-public-vectors.json'), 'utf8'));
const address = 'sp1qqgste7k9hx0qftg6qmwlkqtwuy6cycyavzmzj85c6qdfhjdpdjtdgqjuexzk6murw56suy3e0rd2cgqvycxttddwsvgxe2usfpxumr70xc9pkqwv';
const scan = '0220bcfac5b99e04ad1a06ddfb016ee13582609d60b6291e98d01a9bc9a16c96d4';
const spend = '025cc9856d6f8375350e123978daac200c260cb5b5ae83106cab90484dcd8fcf36';
const cases = [];
const add = (id, field, input, expected, network = 'mainnet') => cases.push({ id, field, input, expected, network });
add('SP-05-OFFICIAL-KEYS', 'address', address, { valid: true, scan_pubkey: scan, spend_pubkey: spend });
add('SP-05-BIP321-URI', 'address', 'bitcoin:?sp=' + address, { valid: true, scan_pubkey: scan, spend_pubkey: spend });
add('SP-05-PUNCTUATION', 'address', 'sp1q' + '!'.repeat(113), { valid: false });
add('SP-05-CHECKSUM', 'address', address.slice(0, -1) + 'x', { valid: false });
add('SP-05-MIXED-CASE', 'address', 'SP' + address.slice(2), { valid: false });
add('SP-05-CURVE', 'address', bech32m.encode('sp', [0, ...bech32m.toWords(Buffer.alloc(66))], 1023), { valid: false });
add('SP-05-WRONG-NETWORK', 'address', address, { valid: false }, 'signet');
add('SP-05-TEST-FAMILY', 'address', bech32m.encode('tsp', bech32m.decode(address, 1023).words, 1023),
  { valid: true, network: 'signet', scan_pubkey: scan, spend_pubkey: spend }, 'signet');
add('SP-05-TYPE', 'address', {}, { valid: false });
for (const [index, value] of ['cHNidFg=', 'cHNidP8=', 'cHNidP8B', 'cHNidP8BAP///////w==', '!bad base64!', 'a'.repeat(1398105)].entries()) {
  add('SP-06-NEGATIVE-' + index, 'psbt', value, { valid: false });
}
const ordinary = new Psbt().addInput({ hash: '01'.repeat(32), index: 0 }).addOutput({ script: Buffer.from('51', 'hex'), value: 1 });
add('SP-06-ORDINARY', 'psbt', ordinary.toBase64(), { valid: true, bip375_present: false, bip376_present: false, cryptographically_verified: false });
for (const [index, vector] of vectors.valid.entries()) add('SP-06-BIP375-' + index, 'psbt', vector.psbt,
  { valid: true, bip375_present: true, cryptographically_verified: false });
for (const [index, vector] of vectors.invalid_structure.entries()) add('SP-06-BIP375-INVALID-' + index, 'psbt', vector.psbt, { valid: false });

const results = [];
for (const test of cases) {
  const requestId = randomUUID();
  const endpoint = `/api/v1/intelligence/payments/silent/validate-${test.field === 'address' ? 'address' : 'psbt'}?chain=bitcoin&network=${test.network}`;
  const response = await fetch(origin + endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': requestId },
    body: JSON.stringify({ [test.field]: test.input }), signal: AbortSignal.timeout(10000) });
  const actual = await response.json();
  let status = 'PASS';
  let reason = null;
  try {
    assert.equal(response.status, test.expected.valid ? 200 : 400);
    assert.equal(response.headers.get('x-request-id'), requestId);
    for (const [key, value] of Object.entries(test.expected)) assert.deepEqual(actual[key], value, key);
  } catch (error) { status = 'FAIL'; reason = error.message; }
  results.push({ id: test.id, operation: test.field === 'address' ? 'SP-05' : 'SP-06', network: test.network,
    scope: 'offline parser over actual compiled HTTP handler; no chain transaction claimed', endpoint, requestId,
    inputSha256: createHash('sha256').update(JSON.stringify(test.input)).digest('hex'), expected: test.expected,
    responseRequestId: response.headers.get('x-request-id'), httpStatus: response.status, actual, status, reason, checkedAt: new Date().toISOString() });
}
const artifact = { schemaVersion: 1, origin, revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceDiffSha256: createHash('sha256').update(execFileSync('git', ['diff', '--', 'backend/src/api/intelligence/silent-payments'], { cwd: root })).digest('hex'),
  results, passed: results.filter(row => row.status === 'PASS').length, failed: results.filter(row => row.status === 'FAIL').length };
writeFileSync(resolve(root, process.argv[2] || 'docs/acceptance/parser-http-2026-09-05.json'), JSON.stringify(artifact, null, 2) + '\n');
console.log(JSON.stringify({ passed: artifact.passed, failed: artifact.failed, scope: 'offline parser HTTP acceptance' }));
process.exitCode = artifact.failed ? 1 : 0;
