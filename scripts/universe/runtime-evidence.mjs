import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HASH = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-zA-Z._/+-]{4,120}$/;
const IDENTIFIER = /^[a-zA-Z0-9._:-]{1,120}$/;
const safeHeight = value => Number.isSafeInteger(value) && value >= 0;
const digest = value => createHash('sha256').update(value).digest('hex');

/** Private acceptance runner primitive. Providers use existing authorized credentials;
 * only this projection may be persisted. Transport preflight is separate evidence.
 * Provider errors and arbitrary responses are deliberately never returned or logged.
 */
export async function collectRuntimeEvidence(config, providers, { now = () => new Date(), timeoutMs = 12000 } = {}) {
  const startedAt = now().toISOString();
  const failures = [];
  const fail = code => { if (!failures.includes(code)) failures.push(code); };
  if (!config || !IDENTIFIER.test(config.chain) || !IDENTIFIER.test(config.network) ||
      !HASH.test(config.genesis) || !HASH.test(config.artifactSha256) || !HASH.test(config.configurationSha256) ||
      !IDENTIFIER.test(config.databaseNamespace) || !REVISION.test(config.backendRevision) || !REVISION.test(config.nodeRevision) ||
      !safeHeight(config.schemaVersion) || !HASH.test(config.schemaSha256) ||
      !Number.isSafeInteger(config.maxIdentityAgeMs) || config.maxIdentityAgeMs < 1 || config.maxIdentityAgeMs > 300000 ||
      !Number.isSafeInteger(config.maximumLag) || config.maximumLag < 0 || config.maximumLag > 1000 ||
      !Array.isArray(config.authorities) || !config.authorities.length ||
      new Set(config.authorities.map(a => a.id)).size !== config.authorities.length ||
      config.authorities.some(a => !IDENTIFIER.test(a.id) || !REVISION.test(a.revision)) ||
      (config.network === 'signet' && !HASH.test(config.signetChallengeSha256))) throw Error('Invalid runtime evidence configuration');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw Error('Invalid runtime evidence deadline');
  const fresh = raw => {
    const age = now().getTime() - Date.parse(raw?.observedAt);
    return Number.isFinite(age) && age >= -5000 && age <= config.maxIdentityAgeMs;
  };
  async function call(provider, method, ...args) {
    const abort = new AbortController();
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => provider[method](...args, { signal: abort.signal })),
        new Promise((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(Error('deadline')); }, timeoutMs); }),
      ]);
    } finally { clearTimeout(timer); abort.abort(); }
  }
  function identity(raw, expectedRevision, id) {
    if (!raw || raw.chain !== config.chain || raw.network !== config.network || raw.genesis !== config.genesis) {
      fail(`${id}:network-identity`); return null;
    }
    if (config.network === 'signet' &&
        (typeof raw.signetChallenge !== 'string' || !/^(?:[0-9a-f]{2}){1,10000}$/.test(raw.signetChallenge) ||
         digest(Buffer.from(raw.signetChallenge, 'hex')) !== config.signetChallengeSha256)) {
      fail(`${id}:signet-challenge`); return null;
    }
    const age = now().getTime() - Date.parse(raw.observedAt);
    if (!Number.isFinite(age) || age < -5000 || age > config.maxIdentityAgeMs ||
        (expectedRevision && raw.revision !== expectedRevision) || !REVISION.test(raw.revision) ||
        typeof raw.version !== 'string' || !/^[a-zA-Z0-9._+-]{1,80}$/.test(raw.version) ||
        !safeHeight(raw.height) || !HASH.test(raw.blockHash)) {
      fail(`${id}:stale-or-malformed-identity`); return null;
    }
    return { id, chain: raw.chain, network: raw.network, genesis: raw.genesis,
      revision: raw.revision, version: raw.version, observedAt: raw.observedAt,
      height: raw.height, blockHash: raw.blockHash,
      ...(config.network === 'signet' ? { signetChallengeSha256: config.signetChallengeSha256 } : {}) };
  }
  let backend = null;
  let database = null;
  let components = [];
  let commonCheckpoint = null;
  try {
    const rawBackend = await call(providers.backend, 'identity');
    if (!fresh(rawBackend) || rawBackend?.revision !== config.backendRevision || rawBackend?.artifactSha256 !== config.artifactSha256 ||
        rawBackend?.configurationSha256 !== config.configurationSha256 || rawBackend?.databaseNamespace !== config.databaseNamespace ||
        rawBackend?.chain !== config.chain || rawBackend?.network !== config.network) fail('backend:binding');
    else backend = { revision: config.backendRevision, artifactSha256: config.artifactSha256,
      configurationSha256: config.configurationSha256, databaseNamespace: config.databaseNamespace };
  } catch { fail('backend:permission-transport-or-deadline'); }
  try {
    const rawDatabase = await call(providers.database, 'identity');
    if (!fresh(rawDatabase) || rawDatabase?.namespace !== config.databaseNamespace || rawDatabase?.schemaVersion !== config.schemaVersion ||
        rawDatabase?.schemaSha256 !== config.schemaSha256 || typeof rawDatabase?.version !== 'string' ||
        !/^[a-zA-Z0-9._+-]{1,80}$/.test(rawDatabase.version)) fail('database:binding');
    else database = { namespace: rawDatabase.namespace, schemaVersion: rawDatabase.schemaVersion,
      schemaSha256: rawDatabase.schemaSha256, version: rawDatabase.version };
  } catch { fail('database:permission-transport-or-deadline'); }
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const entries = [{ id: 'node', revision: config.nodeRevision, provider: providers.node },
        ...config.authorities.map(a => ({ ...a, provider: providers.authorities?.[a.id] }))];
      const states = await Promise.all(entries.map(async entry => identity(await call(entry.provider, 'identity'), entry.revision, entry.id)));
      components = states.filter(Boolean);
      if (states.some(state => state === null)) break;
      const height = Math.min(...states.map(state => state.height));
      if (states.some(state => states[0].height - state.height > config.maximumLag || state.height > states[0].height)) {
        fail('checkpoint:lag'); break;
      }
      const hashes = await Promise.all(entries.map(entry => call(entry.provider, 'blockHash', height)));
      if (hashes.some((hash, i) => !HASH.test(hash) || hash !== hashes[0] ||
          (states[i].height === height && states[i].blockHash !== hash))) { fail('checkpoint:fork'); break; }
      const final = await Promise.all(entries.map(async entry => identity(await call(entry.provider, 'identity'), entry.revision, entry.id)));
      components = final.filter(Boolean);
      if (final.some(state => state === null)) break;
      if (final.some((state, i) => state.height !== states[i].height || state.blockHash !== states[i].blockHash)) continue;
      const finalHashes = await Promise.all(entries.map(entry => call(entry.provider, 'blockHash', height)));
      if (finalHashes.some(hash => hash !== hashes[0])) continue;
      components = final;
      commonCheckpoint = { heightAtomic: String(height), blockHash: hashes[0] };
      break;
    }
    if (!commonCheckpoint && !failures.length) fail('checkpoint:unstable');
  } catch { fail('provider:permission-transport-or-deadline'); }
  return Object.freeze({ schemaVersion: 'universe-runtime-evidence-v1', evidenceKind: 'runtime-identity',
    startedAt, observedAt: now().toISOString(), status: failures.length ? 'BLOCKED' : 'IDENTITY VERIFIED', functionalAcceptance: false,
    chain: config.chain, network: config.network, backend, database, components, commonCheckpoint, failures });
}

/** The operated provider adapter remains private and pinned by raw-byte digest.
 * It must export createProviders(config), resolving credentials through existing
 * authorized providers and honoring every method's AbortSignal. This interface
 * avoids guessing an authority's health schema or embedding credentials here.
 */
export async function runPrivateRuntimeEvidence(configurationPath, providerPath, newOutputPath) {
  const config = JSON.parse(readFileSync(resolve(configurationPath), 'utf8'));
  const bytes = readFileSync(resolve(providerPath));
  if (!HASH.test(config.providerModuleSha256) || digest(bytes) !== config.providerModuleSha256) {
    throw Error('Private provider adapter digest mismatch');
  }
  const module = await import(pathToFileURL(resolve(providerPath)).href);
  if (typeof module.createProviders !== 'function') throw Error('Private provider adapter interface mismatch');
  const providers = await module.createProviders(config);
  const report = await collectRuntimeEvidence(config, providers);
  writeFileSync(resolve(newOutputPath), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 3) throw Error('Usage: runtime-evidence.mjs PRIVATE_CONFIGURATION_JSON PINNED_PRIVATE_PROVIDER_MODULE NEW_PRIVATE_OUTPUT_JSON');
  try {
    const report = await runPrivateRuntimeEvidence(...args);
    console.log(JSON.stringify({ status: report.status, failures: report.failures, functionalAcceptance: false }));
    if (report.status !== 'IDENTITY VERIFIED') process.exitCode = 1;
  } catch {
    console.error('Runtime evidence collection failed; no provider error or credential data exported.');
    process.exitCode = 1;
  }
}
