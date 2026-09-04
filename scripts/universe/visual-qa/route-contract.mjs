import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sampleIds } from './fixtures.mjs';
import { chainSampleIds } from './chain-fixtures.mjs';
import { assetSampleIds } from './asset-fixtures.mjs';

/**
 * Stable dynamic route sample dictionary.
 * Maps dynamic route segments to stable fixture identifiers.
 */
export const STABLE_DYNAMIC_SAMPLES = {
  ':txId': sampleIds.TXID_A,
  ':hash': sampleIds.BLOCK_HASH,
  ':address': sampleIds.ADDRESS,
  ':block': sampleIds.BLOCK_HASH,
  ':page': '1',
  ':dogeTxId': chainSampleIds.DOGE_TXID,
  ':dogeBlock': chainSampleIds.DOGE_BLOCK,
  ':dogeAddress': chainSampleIds.DOGE_ADDRESS,
  ':dogeDuneId': chainSampleIds.DOGE_DUNE_ID,
  ':zecTxId': chainSampleIds.ZEC_TXID,
  ':zecBlock': chainSampleIds.ZEC_BLOCK,
  ':zecAddress': chainSampleIds.ZEC_ADDRESS,
  ':zecZrc20': chainSampleIds.ZEC_ZRC20,
  ':outpointTxId': assetSampleIds.OUTPOINT_TXID,
  ':inscriptionId': assetSampleIds.INSCRIPTION_ID,
  ':runeName': assetSampleIds.RUNE_NAME,
  ':satNumber': assetSampleIds.SAT_NUMBER,
  ':endpointId': 'node-ashburn-01',
  ':publicKey': '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  ':shortId': '860000x120x1',
  ':txid': sampleIds.TXID_A,
  ':mintId': 'mint-cashu-legend',
  ':federationId': 'fed-global-civic',
  ':proposalId': 'bip-0119',
  ':providerId': 'prov-bitreserve-custody',
  ':snapshotId': 'snap-860395-bitreserve',
  ':oracleId': 'oracle-kormir-rates',
  ':eventId': 'event-btc-usd-2026-q4',
  ':programId': 'sim-multisig-v1',
  ':operatorId': 'sc-mercury-alpha',
  ':heightOrHash': '840000',
  ':sessionId': 'session-musig2-cold-01',
  ':shareId': 'share-datum-881290',
  ':delegationId': 'del-882001-allnodes',
  ':vtxoId': 'vtxo-864190-001',
  ':blockHash': '00000000000000000001a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3',
  ':raceId': 'race-863920',
  ':advisoryId': 'ADV-2026-001',
  ':caseId': 'case-div-tapscript-sigops-01',
  ':nodeId': 'node-prod-eu-01',
  ':roundId': 'rnd-ws-864198-01',
};

/**
 * Narrowly scoped exemptions.
 * Every exemption must be documented with pattern, reason, owner, creation date,
 * expiration date, and replacement coverage.
 */
export const ROUTE_EXEMPTIONS = [
  {
    pattern: '^/admin(/.*)?$',
    reason: 'Admin paths immediately redirect to central control plane before Angular mounts',
    owner: 'infrastructure-team',
    createdAt: '2026-08-30T00:00:00Z',
    expiresAt: '2027-08-30T00:00:00Z',
    replacementCoverage: 'scripts/universe/admin-redirect.test.mjs',
  },
  {
    pattern: '^/api(/.*)?$',
    reason: 'Pure API routes and documentation endpoints without graphical interface',
    owner: 'backend-team',
    createdAt: '2026-08-30T00:00:00Z',
    expiresAt: '2027-08-30T00:00:00Z',
    replacementCoverage: 'backend/src/__tests__/esplora-contract.test.ts',
  },
];

/**
 * Parse route declarations from Angular source files.
 * Extracts declared user-facing path strings and redirects.
 */
export function extractRoutesFromSource(sourceText) {
  const routes = [];
  // Match path: '...' declarations
  const routeBlockRegex = /path:\s*['"]([^'"]*)['"](?:[\s\S]*?(redirectTo:\s*['"]([^'"]*)['"]|component|loadComponent|loadChildren))/g;
  let match;
  while ((match = routeBlockRegex.exec(sourceText)) !== null) {
    const rawPath = match[1];
    const isRedirect = Boolean(match[2] && match[2].includes('redirectTo'));
    const redirectTo = match[3] ?? null;
    routes.push({
      path: rawPath,
      normalizedPath: '/' + rawPath.replace(/^\/+/, ''),
      isRedirect,
      redirectTo,
    });
  }
  return routes;
}

/**
 * Discovers declared routes from the Angular frontend routing modules.
 */
export function discoverFrontendRoutes(repoRoot) {
  const targetFiles = [
    join(repoRoot, 'frontend', 'src', 'app', 'master-page.module.ts'),
    join(repoRoot, 'frontend', 'src', 'app', 'app-routing.module.ts'),
    join(repoRoot, 'frontend', 'src', 'app', 'universe', 'universe-routing.module.ts'),
    join(repoRoot, 'frontend', 'src', 'app', 'universe', 'anima', 'anima.routes.ts'),
  ];

  const declared = [];
  for (const filePath of targetFiles) {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf8');
      const found = extractRoutesFromSource(content);
      declared.push(...found);
    }
  }

  // Deduplicate and filter out empty paths unless it represents root
  const seen = new Set();
  const filtered = [];
  for (const item of declared) {
    const key = item.normalizedPath;
    if (!seen.has(key)) {
      seen.add(key);
      filtered.push(item);
    }
  }
  return filtered;
}

/**
 * Matches a registered scenario path against a route pattern.
 */
export function routeMatchesPattern(scenarioPath, routePattern) {
  if (routePattern === '/**' || routePattern === '**') {
    return true;
  }
  const cleanScenario = '/' + scenarioPath.replace(/^\/+/, '').split('?')[0];
  const regexPattern = '^' + routePattern
    .replace(/\/\*\*$/, '(?:/.*)?')
    .replace(/:[A-Za-z0-9_]+/g, '[^/]+')
    .replace(/\/\*$/, '(?:/.*)?') + '$';
  return new RegExp(regexPattern).test(cleanScenario);
}

/**
 * Validates the route coverage contract against registered visual scenarios.
 */
export function verifyRouteCoverageContract(declaredRoutes, visualScenarios, exemptions = ROUTE_EXEMPTIONS, now = new Date()) {
  const errors = [];
  const uncoveredRoutes = [];
  const expiredExemptions = [];
  const invalidScenarios = [];

  // Check exemption validity
  for (const exemption of exemptions) {
    const expiry = new Date(exemption.expiresAt);
    if (expiry <= now) {
      const msg = `Exemption for ${exemption.pattern} expired at ${exemption.expiresAt} (owner: ${exemption.owner})`;
      errors.push(msg);
      expiredExemptions.push(exemption.pattern);
    }
  }

  // Check each declared user-facing route has coverage or valid exemption
  for (const route of declaredRoutes) {
    if (route.isRedirect || route.path === '**' || route.normalizedPath === '/**') {
      continue; // Wildcards and pure redirects are not individual visual pages
    }

    const path = route.normalizedPath;

    // Check if exempted
    const isExempt = exemptions.some((e) => {
      const active = new Date(e.expiresAt) > now;
      return active && new RegExp(e.pattern).test(path);
    });

    if (isExempt) {
      continue;
    }

    // Match against visual scenarios
    const matchingScenarios = visualScenarios.filter((scenario) => {
      const scenarioPath = scenario.path;
      return routeMatchesPattern(scenarioPath, path);
    });

    if (matchingScenarios.length === 0) {
      uncoveredRoutes.push(path);
      errors.push(`Uncovered production route: ${path} has no visual screenshot scenario`);
    }
  }

  // Ensure no scenario matches non-existent route
  for (const scenario of visualScenarios) {
    const cleanScenario = '/' + scenario.path.replace(/^\/+/, '').split('?')[0];
    const matchesAnyDeclared = declaredRoutes.some((route) => {
      return routeMatchesPattern(cleanScenario, route.normalizedPath);
    });
    if (!matchesAnyDeclared) {
      // Check if it matches root or standard asset paths
      if (cleanScenario !== '/' && !cleanScenario.startsWith('/outpoint') && !cleanScenario.startsWith('/inscription') && !cleanScenario.startsWith('/rune') && !cleanScenario.startsWith('/sat')) {
        invalidScenarios.push(scenario.id);
        errors.push(`Orphan scenario '${scenario.id}' path '${scenario.path}' does not match any declared Angular route`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    uncoveredRoutes,
    expiredExemptions,
    invalidScenarios,
  };
}
