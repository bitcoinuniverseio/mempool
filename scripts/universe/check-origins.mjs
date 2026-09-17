#!/usr/bin/env node
/**
 * Third-party data origin gate.
 *
 * Every figure this explorer publishes comes from infrastructure Bitcoin
 * Universe runs. A single call to a hosted blockchain API, public explorer, or
 * analytics service breaks that promise, and it is the kind of thing that slips
 * in through a well-meaning fallback. So it is checked.
 *
 * Usage:
 *   node scripts/universe/check-origins.mjs [--json] [path ...]
 *
 * With no path the repository source tree is scanned and build output is
 * skipped. A named directory (`frontend/dist`) is scanned as a built bundle:
 * every reference in it is runtime, comments do not exist any more, and no
 * path exemption applies.
 *
 * Policy (the exported lists are the policy; the tests pin them):
 *
 * 1. Hosts are read from parsed URLs and from bare host tokens, lower-cased
 *    with trailing dots removed. A forbidden provider matches by host equality
 *    or dot-suffix (`api.hiro.so` is `hiro.so`). A host that merely contains a
 *    forbidden provider between dots (`mempool.space.evil.example`) is a
 *    lookalike and is rejected the same way. `notmempool.space` shares no label
 *    boundary with `mempool.space`, so it is an unknown host, judged by the
 *    runtime policy below rather than by the denylist.
 * 2. Runtime call sites (fetch/axios/WebSocket/proxy_pass/curl lines) and
 *    runtime configuration values (docker templates, production configs, the
 *    sample configs) may only reference relative paths, loopback, single-label
 *    container names, Universe-operated hosts, or a documented metadata
 *    exemption. Anything else is an unapproved runtime origin.
 * 3. Build inputs (package registries, release downloads, distribution
 *    package repositories) are allowed in build-context files only.
 * 4. Documentation cites hosts without calling them. Citation files may name
 *    any host; a comment line or specification field in code may cite the
 *    protocol specification hosts listed below, never a runtime call.
 * 5. Credentials embedded in a URL are a finding wherever the host is not
 *    loopback. The credential is never printed, only the host.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';

export const REPOSITORY_ROOT = resolve(import.meta.dirname, '..', '..');

const SKIPPED_DIRECTORIES = new Set([
  '.git', 'node_modules', 'target', 'coverage', '.angular', '.cache', '.worktrees',
]);

/**
 * Build output is skipped when scanning the tree, because a stale bundle from a
 * previous build would fail the gate for code that no longer exists. Scanning a
 * bundle is a separate, explicit run against a named directory.
 */
const SKIPPED_WHEN_WALKING_ROOT = new Set(['dist', 'build']);

/**
 * Hosts that must never appear as a runtime data source: public blockchain
 * APIs and explorers across every chain this explorer serves, hosted protocol
 * indexers, Lightning graph services, analytics, and remote font and script
 * CDNs. Subdomains match too.
 */
export const FORBIDDEN_HOSTS = [
  // Bitcoin explorers and hosted APIs
  'mempool.space',
  'mempool.ninja',
  'mempoolhqx4isw62xs7abwphsq7ldayuidyx2v2oethdhhj6mlo2r6ad.onion',
  'blockstream.info',
  'esplora.blockstream.com',
  'blockchain.info',
  'blockchain.com',
  'blockchair.com',
  'blockcypher.com',
  'btc.com',
  'btcscan.org',
  'bitaps.com',
  'sochain.com',
  'chain.so',
  'smartbit.com.au',
  'oklink.com',
  'tokenview.io',
  'bitcoinexplorer.org',
  'trezor.io',
  '3xpl.com',
  // Ordinals, Runes, Stamps, BRC-20 indexers and marketplaces
  'unisat.io',
  'ordiscan.com',
  'ordinals.com',
  'ord.io',
  'hiro.so',
  'geniidata.com',
  'bestinslot.xyz',
  'openstamp.io',
  'stampchain.io',
  'magiceden.io',
  'xverse.app',
  'ordinalswallet.com',
  'simplehash.com',
  'luminex.io',
  // Other chains served here
  'dogechain.info',
  'zcha.in',
  'zecblockexplorer.com',
  'zcashblockexplorer.com',
  // Lightning graph services
  '1ml.com',
  'amboss.space',
  // Analytics and remote asset CDNs
  'google-analytics.com',
  'googletagmanager.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'unpkg.com',
];

/** Universe-operated authorities. Subdomains match. */
export const APPROVED_RUNTIME_HOSTS = [
  'bitcoinuniverse.io',
];

export const LOOPBACK_HOSTS = new Set([
  'localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0', '[::]',
]);

/**
 * The one external runtime category with a documented exception: the Liquid
 * asset catalogue (asset names, tickers, icons, issuer metadata) read through
 * `EXTERNAL_DATA_SERVER.LIQUID_API` / `LIQUID_ONION`. Collection metadata
 * only; balances, ownership, transfers and history never come from it.
 */
export const METADATA_EXEMPT_HOSTS = [
  { host: 'liquid.network', reason: 'Liquid asset catalogue metadata (EXTERNAL_DATA_SERVER.LIQUID_API)' },
  { host: 'liquidmom47f6s3m53ebfxn47p76a6tlnxib3wp6deux7wuzotdr6cyd.onion', reason: 'Liquid asset catalogue metadata over Tor (EXTERNAL_DATA_SERVER.LIQUID_ONION)' },
];

/**
 * Protocol specification hosts a comment or a `specification_url` field may
 * cite. A citation is a link to spec text; it is never a fetch target, so the
 * exemption does not apply on a call-site line.
 */
export const CITATION_HOSTS = [
  { host: 'docs.ordinals.com', reason: 'Ordinals and Runes protocol specification text' },
];

/**
 * Build inputs. Allowed only in build-context files (Dockerfiles, workflows,
 * package manifests, the Docker init script): they are where the software
 * comes from, not where its data comes from.
 */
export const BUILD_DEPENDENCY_HOSTS = [
  'registry.npmjs.org',
  'npmjs.com',
  'crates.io',
  'github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  'api.github.com',
  'ghcr.io',
  'docker.io',
  'hub.docker.com',
  'deb.nodesource.com',
  'deb.debian.org',
  'security.debian.org',
  'dl-cdn.alpinelinux.org',
  'nodejs.org',
  'sh.rustup.rs',
  'static.rust-lang.org',
  'pypi.org',
  'files.pythonhosted.org',
  'playwright.azureedge.net',
  'cdn.playwright.dev',
];

/**
 * Files that cite hosts rather than call them: research that names
 * competitors, fork provenance, licences, upstream documentation, translations
 * of that documentation, and the policy documents themselves.
 */
export const CITATION_PATHS = [
  'frontend/src/app/docs/api-docs/api-docs.component.html',
  'docs/research/',
  'docs/legal/',
  'docs/architecture/',
  'docs/operations/UPSTREAM-SYNC.md',
  'UPSTREAM.md',
  'upstream-base.json',
  'COPYING.md',
  'CONTRIBUTING.md',
  'README.md',
  'contributors/',
  'audits/',
  'frontend/src/locale/',
  'backend/README.md',
  'frontend/README.md',
  'docker/README.md',
  'production/README.md',
  // The mining pool identification table: names, tags and website links of
  // pools, never a data source.
  'backend/src/tasks/pools/',
  // Inherited upstream mempool.space nginx deployment for its own hosts. The
  // Universe release ships only production/linux (see the release workflow).
  'production/nginx/',
  'production/freebsd/',
];

/** The gate and its tests name forbidden hosts in order to reject them. */
export const GATE_PATHS = [
  'scripts/universe/check-origins.mjs',
  'scripts/universe/check-origins.test.mjs',
  'scripts/universe/docker-runtime-defaults.test.mjs',
  'scripts/universe/check-branding.mjs',
];

/** Upstream test fixtures and sample data, never a runtime path. */
export const TEST_FIXTURE_PATHS = [
  'backend/src/__fixtures__/',
  'frontend/cypress/',
];

/** Build-context files, where build-dependency hosts are expected. */
export const BUILD_CONTEXT_PATHS = [
  '.github/workflows/',
  'docker/init.sh',
];
const BUILD_CONTEXT_BASENAMES = new Set([
  'Dockerfile', 'package.json', 'package-lock.json', 'Cargo.toml', 'Cargo.lock',
]);

/**
 * Runtime configuration: every absolute URL in these files is a value the
 * process will use, so each one is judged by the runtime policy.
 */
export const RUNTIME_CONFIG_PATHS = [
  'docker/backend/start.sh',
  'docker/backend/mempool-config.json',
  'docker/frontend/entrypoint.sh',
  'docker/docker-compose.yml',
  'production/mempool-config.',
  'production/mempool-frontend-config.',
  'backend/mempool-config.sample.json',
  'frontend/mempool-frontend-config.sample.json',
  'frontend/proxy.conf',
  'nginx.conf',
  'nginx-mempool.conf',
];

/** Tokens that mark a line as a runtime request site. */
export const CALL_SITE_TOKENS = [
  'fetch(', 'axios', '.get(', '.post(', '.put(', '.request(', 'http.get', 'https.get',
  'http.request', 'https.request', 'WebSocket(', 'httpClient', 'this.http', 'got(',
  'proxy_pass', 'curl ', 'wget ', 'EventSource(', 'XMLHttpRequest',
];

/**
 * Sentences that name a host in order to disclaim it rather than call it.
 * Recognised as whole phrases so a bundle scan still sees them after
 * minification.
 */
/**
 * A script that refuses a forbidden host has to name it. The line carries this
 * marker and the gate records nothing for the hosts on it. Bundles never
 * carry the marker: they are scanned as-is.
 */
export const DENY_MARKER = 'origin-gate:deny';

const DISCLAIMER_PHRASES = [
  'It is not affiliated with or endorsed by mempool.space.',
];

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.html', '.scss', '.css',
  '.md', '.yml', '.yaml', '.txt', '.sh', '.rs', '.sql', '.conf', '.map',
]);

const URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s"'`<>()[\]{},;\\$]+/gi;
const HOST_TOKEN_PATTERN = /(?<![A-Za-z0-9_.-])(?:[A-Za-z0-9-]+\.)+[A-Za-z][A-Za-z0-9-]{1,62}(?![A-Za-z0-9-])/g;
const COMMENT_LINE_PATTERN = /^\s*(?:\/\/|\/?\*|#|<!--|--)/;
/** Unit tests and their fixtures use invented hosts; only the denylist applies. */
const TEST_FILE_PATTERN = /(?:^|\/)(?:__tests__|__mocks__|__fixtures__|test-fixtures)\/|\.(?:test|spec)\.(?:[cm]?[jt]sx?|json)$|\.fixtures?\.[cm]?[jt]s$/;

export function normalizeHost(raw) {
  if (typeof raw !== 'string') return '';
  let host = raw.trim().toLowerCase();
  while (host.endsWith('.')) host = host.slice(0, -1);
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  return host;
}

export function hostMatches(host, listed) {
  const wanted = normalizeHost(listed);
  return host === wanted || host.endsWith(`.${wanted}`);
}

function lookalike(host, listed) {
  return !hostMatches(host, listed) && `.${host}.`.includes(`.${normalizeHost(listed)}.`);
}

/**
 * The policy verdict for one host. Categories, in precedence order:
 * citation (a specification host, exact or subdomain, listed before the
 * broader forbidden suffix it may sit under), forbidden, lookalike, loopback,
 * local (single-label container or service name), approved, metadata, onion
 * (a .onion host that is not the upstream explorer's), build, unknown.
 */
export function classifyHost(rawHost) {
  const host = normalizeHost(rawHost);
  if (!host) return { host, category: 'unknown' };
  for (const entry of CITATION_HOSTS) {
    if (hostMatches(host, entry.host)) return { host, category: 'citation', matched: entry.host, reason: entry.reason };
  }
  for (const listed of FORBIDDEN_HOSTS) {
    if (hostMatches(host, listed)) return { host, category: 'forbidden', matched: listed };
  }
  for (const listed of FORBIDDEN_HOSTS) {
    if (lookalike(host, listed)) return { host, category: 'lookalike', matched: listed };
  }
  if (LOOPBACK_HOSTS.has(host) || /^127\.\d+\.\d+\.\d+$/.test(host)) return { host, category: 'loopback' };
  if (!host.includes('.') && !host.includes(':')) return { host, category: 'local' };
  if (host.endsWith('.onion')) return { host, category: 'onion' };
  for (const listed of APPROVED_RUNTIME_HOSTS) {
    if (hostMatches(host, listed)) return { host, category: 'approved', matched: listed };
  }
  for (const entry of METADATA_EXEMPT_HOSTS) {
    if (hostMatches(host, entry.host)) return { host, category: 'metadata', matched: entry.host, reason: entry.reason };
  }
  for (const listed of BUILD_DEPENDENCY_HOSTS) {
    if (hostMatches(host, listed)) return { host, category: 'build', matched: listed };
  }
  return { host, category: 'unknown' };
}

/** Character ranges covered by a disclaimer sentence in this text. */
function disclaimerSpans(contents) {
  const spans = [];
  for (const phrase of DISCLAIMER_PHRASES) {
    let index = contents.indexOf(phrase);
    while (index !== -1) {
      spans.push([index, index + phrase.length]);
      index = contents.indexOf(phrase, index + phrase.length);
    }
  }
  return spans;
}

function lineAt(contents, index) {
  const start = contents.lastIndexOf('\n', index - 1) + 1;
  let end = contents.indexOf('\n', index);
  if (end === -1) end = contents.length;
  return { number: contents.slice(0, start).split('\n').length, text: contents.slice(start, end) };
}

/** The configuration key or shell variable a reference is assigned to, if any. */
function fieldOf(lineText) {
  const json = lineText.match(/"([A-Za-z0-9_.-]+)"\s*:/);
  if (json) return json[1];
  const shell = lineText.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/);
  if (shell) return shell[1];
  const assignment = lineText.match(/^\s*(?:const|let|var|private|public|readonly|static)?\s*([A-Za-z_$][A-Za-z0-9_$.]*)\s*[:=]/);
  if (assignment) return assignment[1];
  const directive = lineText.match(/^\s*(proxy_pass|set|rewrite|return)\b/);
  if (directive) return directive[1];
  return undefined;
}

export function isCallSite(lineText) {
  return CALL_SITE_TOKENS.some((token) => lineText.includes(token));
}

/**
 * Every host reference in a text: parsed absolute URLs first, then bare host
 * tokens that no URL already covered. Credentials are detected, never kept.
 */
export function extractReferences(contents) {
  const references = [];
  const covered = [];
  for (const match of contents.matchAll(URL_PATTERN)) {
    let url;
    try {
      url = new URL(match[0]);
    } catch {
      continue;
    }
    if (!url.hostname) continue;
    covered.push([match.index, match.index + match[0].length]);
    references.push({
      index: match.index,
      raw: match[0],
      origin: `${url.protocol}//${url.host}`,
      host: normalizeHost(url.hostname),
      port: url.port || '',
      protocol: url.protocol.replace(':', ''),
      hasCredentials: url.username !== '' || url.password !== '',
      absolute: true,
    });
  }
  for (const match of contents.matchAll(HOST_TOKEN_PATTERN)) {
    const start = match.index;
    if (covered.some(([from, to]) => start >= from && start < to)) continue;
    const host = normalizeHost(match[0]);
    // Only classified hosts are worth a bare-token finding; every dotted
    // identifier in a code base would otherwise be a host.
    const { category } = classifyHost(host);
    if (category !== 'forbidden' && category !== 'lookalike') continue;
    references.push({
      index: start, raw: match[0], origin: host, host, port: '', protocol: '',
      hasCredentials: false, absolute: false,
    });
  }
  return references.sort((a, b) => a.index - b.index);
}

function startsWithAny(posixPath, prefixes) {
  return prefixes.some((prefix) => posixPath.startsWith(prefix));
}

/** The scanning context of a repository-relative path. */
export function contextOf(relativePath) {
  const posix = relativePath.split(sep).join('/');
  const name = basename(posix);
  if (startsWithAny(posix, GATE_PATHS)) return 'gate';
  if (startsWithAny(posix, TEST_FIXTURE_PATHS)) return 'fixture';
  if (startsWithAny(posix, CITATION_PATHS)) return 'citation';
  if (startsWithAny(posix, BUILD_CONTEXT_PATHS) || BUILD_CONTEXT_BASENAMES.has(name)) return 'build';
  if (startsWithAny(posix, RUNTIME_CONFIG_PATHS)) return 'runtime-config';
  if (posix.endsWith('.md')) return 'documentation';
  if (TEST_FILE_PATTERN.test(posix)) return 'test';
  return 'source';
}

/**
 * Findings for one text. `context` is one of the values `contextOf` returns,
 * or `bundle` for built output, or `rendered-config` for configuration a
 * container start script produced.
 */
export function scanText(contents, { file = '<text>', context = 'source' } = {}) {
  if (context === 'gate' || context === 'fixture' || context === 'citation') return [];
  const spans = disclaimerSpans(contents);
  const findings = [];
  const strict = context === 'bundle' || context === 'rendered-config' || context === 'runtime-config';
  for (const reference of extractReferences(contents)) {
    if (spans.some(([start, end]) => reference.index >= start && reference.index < end)) continue;
    const line = lineAt(contents, reference.index);
    const comment = !strict && COMMENT_LINE_PATTERN.test(line.text);
    const callSite = isCallSite(line.text);
    const verdict = classifyHost(reference.host);
    const base = {
      file, line: line.number, field: fieldOf(line.text), origin: reference.origin, host: reference.host,
      port: reference.port, category: verdict.category, matched: verdict.matched,
    };
    if (verdict.category === 'forbidden' || verdict.category === 'lookalike') {
      if (context === 'documentation' && !callSite) continue;
      if (context !== 'bundle' && line.text.includes(DENY_MARKER)) continue;
      findings.push({ ...base, kind: verdict.category === 'forbidden' ? 'forbidden-origin' : 'lookalike-origin' });
      continue;
    }
    if (reference.hasCredentials && verdict.category !== 'loopback' && context !== 'documentation' && context !== 'test') {
      findings.push({ ...base, kind: 'credential-in-url' });
    }
    if (!reference.absolute || context === 'documentation' || context === 'test') continue;
    if (verdict.category === 'loopback' || verdict.category === 'local' || verdict.category === 'approved') continue;
    if (verdict.category === 'metadata') continue;
    // A .onion host cannot be verified as owned by its name. It is accepted
    // only where an operator configured it as this deployment's onion
    // transport, which is a field named for that purpose.
    if (verdict.category === 'onion' && /ONION/i.test(base.field ?? '')) continue;
    if (verdict.category === 'citation') {
      if (callSite || strict) findings.push({ ...base, kind: 'citation-host-called' });
      continue;
    }
    if (verdict.category === 'build' && context === 'build') continue;
    if (context === 'bundle') continue;
    if (comment && !callSite) continue;
    if (strict || callSite) {
      findings.push({ ...base, kind: 'unapproved-runtime-origin' });
    }
    if (findings.length > 40) break;
  }
  return findings;
}

function hasTextExtension(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 && TEXT_EXTENSIONS.has(name.slice(dot));
}

function* walk(directory, skipBuildOutput) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      if (skipBuildOutput && SKIPPED_WHEN_WALKING_ROOT.has(entry.name)) continue;
      yield* walk(full, skipBuildOutput);
    } else if (entry.isFile() && (hasTextExtension(entry.name) || BUILD_CONTEXT_BASENAMES.has(entry.name))) {
      yield full;
    }
  }
}

export function scanFile(file, { bundle = false, root = REPOSITORY_ROOT } = {}) {
  const relativePath = relative(root, file).split(sep).join('/');
  let contents;
  try {
    contents = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const context = bundle ? 'bundle' : contextOf(relativePath);
  return scanText(contents, { file: relativePath, context });
}

/**
 * Scan the given targets. No target: the source tree, build output skipped.
 * A directory target: a built bundle. A file target: judged by its path.
 */
export function scanTargets(argv, { root = REPOSITORY_ROOT } = {}) {
  const targets = argv.length === 0 ? [root] : argv.map((entry) => resolve(root, entry));
  const findings = [];
  for (const target of targets) {
    const stats = statSync(target);
    if (stats.isDirectory()) {
      const bundle = argv.length > 0;
      for (const file of walk(target, argv.length === 0)) findings.push(...scanFile(file, { bundle, root }));
    } else {
      findings.push(...scanFile(target, { root }));
    }
  }
  return findings;
}

export function formatFinding(finding) {
  const field = finding.field ? ` [${finding.field}]` : '';
  return `  ${finding.file}:${finding.line}: ${finding.kind} ${finding.origin}${field}`;
}

function main(argv) {
  const json = argv.includes('--json');
  const paths = argv.filter((entry) => entry !== '--json');
  let findings;
  try {
    findings = scanTargets(paths);
  } catch (error) {
    console.error(`Origin gate: ${error.message}`);
    return 1;
  }
  if (json) {
    console.log(JSON.stringify({ findings }, null, 2));
    return findings.length > 0 ? 1 : 0;
  }
  if (findings.length > 0) {
    console.error(`Third-party or unapproved origins found in ${findings.length} place(s):`);
    for (const finding of findings.slice(0, 80)) console.error(formatFinding(finding));
    console.error('\nRuntime data must come from Bitcoin Universe infrastructure only.');
    return 1;
  }
  console.log('Origin gate passed: no third-party data origins found.');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.exitCode = main(process.argv.slice(2));
}
